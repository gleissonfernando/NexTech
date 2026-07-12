import { randomUUID } from "node:crypto";
import { getMongoCollections, type MongoRhAdminAbsence, type MongoRhAdminAdornment, type MongoRhAdminLog, type MongoRhAdminSettings } from "../database/mongo";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoom } from "../realtime/events";

export const RH_ADMIN_MODULE_ID = "rh-admin";

export type RhAdminDashboard = {
  absences: RhAdminAbsenceDto[];
  adornments: RhAdminAdornmentDto[];
  logs: RhAdminLogDto[];
  settings: RhAdminSettingsDto;
  stats: {
    approvedAbsences: number;
    pendingAbsences: number;
    sentAdornments: number;
  };
};

export type RhAdminSettingsDto = ReturnType<typeof mapSettings>;
export type RhAdminAbsenceDto = ReturnType<typeof mapAbsence>;
export type RhAdminAdornmentDto = ReturnType<typeof mapAdornment>;
export type RhAdminLogDto = ReturnType<typeof mapLog>;
export type RhAdminAbsenceActionResult = {
  absence: RhAdminAbsenceDto;
  changed: boolean;
};

export async function getRhAdminDashboard(botId: string | null, guildId: string): Promise<RhAdminDashboard> {
  const collections = await getMongoCollections();
  const settings = await getRhAdminSettings(botId, guildId);
  const [absences, adornments, logs, pendingAbsences, approvedAbsences, sentAdornments] = await Promise.all([
    collections.rhAdminAbsences.find(scope(botId, guildId)).sort({ createdAt: -1 }).limit(80).toArray(),
    collections.rhAdminAdornments.find(scope(botId, guildId)).sort({ createdAt: -1 }).limit(80).toArray(),
    collections.rhAdminLogs.find(scope(botId, guildId)).sort({ createdAt: -1 }).limit(120).toArray(),
    collections.rhAdminAbsences.countDocuments({ ...scope(botId, guildId), status: "pending" }),
    collections.rhAdminAbsences.countDocuments({ ...scope(botId, guildId), status: "approved" }),
    collections.rhAdminAdornments.countDocuments(scope(botId, guildId))
  ]);

  return {
    absences: absences.map(mapAbsence),
    adornments: adornments.map(mapAdornment),
    logs: logs.map(mapLog),
    settings,
    stats: { approvedAbsences, pendingAbsences, sentAdornments }
  };
}

export async function getRhAdminSettings(botId: string | null, guildId: string) {
  const { rhAdminSettings } = await getMongoCollections();
  const existing = await rhAdminSettings.findOne(scope(botId, guildId));
  if (existing) return mapSettings(existing);

  const now = new Date();
  const doc: MongoRhAdminSettings = {
    _id: randomUUID(),
    botId,
    guildId,
    enabled: true,
    systemName: "RH Administrativo | North Police Department",
    color: "#1d4ed8",
    panelChannelId: null,
    absencePanelChannelId: null,
    absenceReviewChannelId: null,
    absenceLogChannelId: null,
    adornmentPanelChannelId: null,
    adornmentReviewChannelId: null,
    adornmentLogChannelId: null,
    generalLogChannelId: null,
    absenceRoleId: null,
    configUserIds: [],
    configRoleIds: [],
    approverUserIds: [],
    approverRoleIds: [],
    viewerUserIds: [],
    viewerRoleIds: [],
    panelBannerUrl: null,
    dmBannerUrl: null,
    approvalDmBannerUrl: null,
    rejectionDmBannerUrl: null,
    finishedDmBannerUrl: null,
    adornmentBannerUrl: null,
    panelDescription: "Bem-vindo ao sistema de RH Administrativo.\nPor este painel, você poderá solicitar uma ausência temporária ou registrar uma solicitação de adorno.\nLeia as informações com atenção antes de enviar sua solicitação.",
    adornmentDescription: "Envie a numeração in-game do adorno e um link válido de imagem para análise do RH.",
    approvalDmText: "Sua solicitação de ausência foi aprovada pelo RH Administrativo.",
    rejectionDmText: "Sua solicitação de ausência foi recusada pelo RH Administrativo.",
    finishedDmText: "O período da sua ausência foi finalizado.",
    sendAbsenceDm: true,
    mentionAdornmentUser: true,
    allowNonDirectImageLinks: true,
    checkIntervalMinutes: 30,
    buttonEmojis: { ...defaultButtonEmojis },
    mainPanelMessageId: null,
    mainPanelPublishedAt: null,
    lastPanelRequestedAt: null,
    updatedAt: now,
    updatedBy: null
  };
  await rhAdminSettings.insertOne(doc);
  return mapSettings(doc);
}

export async function saveRhAdminSettings(botId: string | null, guildId: string, input: Partial<Omit<RhAdminSettingsDto, "id" | "botId" | "guildId" | "updatedAt">>, actorId: string | null) {
  const { rhAdminSettings } = await getMongoCollections();
  await rhAdminSettings.updateOne(scope(botId, guildId), {
    $set: {
      ...cleanSettings(input),
      updatedAt: new Date(),
      updatedBy: actorId
    },
    $setOnInsert: {
      _id: randomUUID(),
      botId,
      guildId
    }
  }, { upsert: true });
  await logRhAdminAction(botId, guildId, "rh.settings_saved", actorId, actorId, "Configuração do RH Administrativo alterada.", "success", input);
  emitRealtime("rh-admin:settings", { botId, guildId });
  return getRhAdminSettings(botId, guildId);
}

export async function requestRhAdminPanelPublish(botId: string, guildId: string, actorId: string | null) {
  const settings = await getRhAdminSettings(botId, guildId);
  if (!settings.enabled) throw new Error("Ative o RH Administrativo antes de publicar o painel.");
  if (!settings.panelChannelId) throw new Error("Configure o canal de publicação do painel RH.");

  const { rhAdminSettings } = await getMongoCollections();
  const requestedAt = new Date();
  await rhAdminSettings.updateOne(scope(botId, guildId), {
    $set: {
      lastPanelRequestedAt: requestedAt,
      updatedAt: requestedAt,
      updatedBy: actorId
    },
    $setOnInsert: {
      _id: randomUUID(),
      botId,
      guildId
    }
  }, { upsert: true });

  const nextSettings = await getRhAdminSettings(botId, guildId);
  emitRealtimeToRoom(devBotRealtimeRoom(botId), "rh-admin:panel_publish", { botId, guildId, settings: nextSettings });
  await logRhAdminAction(botId, guildId, "rh.panel_publish_requested", null, actorId, "Publicação do painel RH solicitada pela dashboard.", "info", { channelId: nextSettings.panelChannelId });
  return nextSettings;
}

export async function createRhAbsence(botId: string | null, guildId: string, input: {
  reason: string;
  returnAt: Date;
  returnDate: string;
  serverName: string;
  startAt: Date;
  startDate: string;
  userId: string;
}) {
  const { rhAdminAbsences } = await getMongoCollections();
  const settings = await getRhAdminSettings(botId, guildId);
  const now = new Date();
  const doc: MongoRhAdminAbsence = {
    _id: randomUUID(),
    botId,
    guildId,
    userId: input.userId,
    serverName: input.serverName,
    startDate: input.startDate,
    returnDate: input.returnDate,
    startAt: input.startAt,
    returnAt: input.returnAt,
    reason: input.reason,
    status: "pending",
    absenceRoleId: settings.absenceRoleId,
    reviewerId: null,
    reviewedAt: null,
    rejectionReason: null,
    reviewChannelId: settings.absenceReviewChannelId,
    reviewMessageId: null,
    roleAddedAt: null,
    roleRemovedAt: null,
    autoRemoved: false,
    dmDelivered: null,
    createdAt: now,
    updatedAt: now
  };
  await rhAdminAbsences.insertOne(doc);
  await logRhAdminAction(botId, guildId, "rh.absence_requested", input.userId, input.userId, "Solicitação de ausência enviada.", "success", { absenceId: doc._id });
  emitRealtime("rh-admin:absence", { botId, guildId, absenceId: doc._id });
  return mapAbsence(doc);
}

export async function updateRhAbsenceMessage(botId: string | null, guildId: string, absenceId: string, input: { reviewChannelId?: string | null; reviewMessageId?: string | null }) {
  const { rhAdminAbsences } = await getMongoCollections();
  await rhAdminAbsences.updateOne({ _id: absenceId, ...scope(botId, guildId) }, { $set: { ...input, updatedAt: new Date() } });
  return getRhAbsence(botId, guildId, absenceId);
}

export async function getRhAbsence(botId: string | null, guildId: string, absenceId: string) {
  const { rhAdminAbsences } = await getMongoCollections();
  const absence = await rhAdminAbsences.findOne({ _id: absenceId, ...scope(botId, guildId) });
  return absence ? mapAbsence(absence) : null;
}

export async function decideRhAbsence(botId: string | null, guildId: string, absenceId: string, input: { actorId: string; rejectionReason?: string | null; status: "approved" | "rejected" }): Promise<RhAdminAbsenceActionResult | null> {
  const { rhAdminAbsences } = await getMongoCollections();
  const absence = await rhAdminAbsences.findOne({ _id: absenceId, ...scope(botId, guildId) });
  if (!absence) return null;
  if (absence.status !== "pending") {
    return {
      absence: mapAbsence(absence),
      changed: false
    };
  }
  const now = new Date();
  const result = await rhAdminAbsences.updateOne({ _id: absenceId, ...scope(botId, guildId), status: "pending" }, {
    $set: {
      reviewerId: input.actorId,
      reviewedAt: now,
      rejectionReason: input.status === "rejected" ? input.rejectionReason || "Sem motivo informado." : null,
      status: input.status,
      updatedAt: now
    }
  });
  const updated = await rhAdminAbsences.findOne({ _id: absenceId, ...scope(botId, guildId) });
  if (!updated) return null;
  const mapped = mapAbsence(updated);
  if (!result.modifiedCount) {
    return {
      absence: mapped,
      changed: false
    };
  }
  await logRhAdminAction(botId, guildId, `rh.absence_${input.status}`, absence.userId, input.actorId, input.status === "approved" ? "Ausência aprovada." : "Ausência recusada.", "success", { absenceId });
  emitRealtime("rh-admin:absence", { botId, guildId, absenceId });
  return {
    absence: mapped,
    changed: true
  };
}

export async function markRhAbsenceRoleAdded(botId: string | null, guildId: string, absenceId: string, roleAdded: boolean) {
  const { rhAdminAbsences } = await getMongoCollections();
  await rhAdminAbsences.updateOne({ _id: absenceId, ...scope(botId, guildId) }, { $set: { roleAddedAt: roleAdded ? new Date() : null, updatedAt: new Date() } });
  return getRhAbsence(botId, guildId, absenceId);
}

export async function finishRhAbsence(botId: string | null, guildId: string, absenceId: string, roleRemoved: boolean, dmDelivered: boolean | null): Promise<RhAdminAbsenceActionResult | null> {
  const { rhAdminAbsences } = await getMongoCollections();
  const current = await rhAdminAbsences.findOne({ _id: absenceId, ...scope(botId, guildId) });
  if (!current) return null;
  if (current.status !== "approved") {
    return {
      absence: mapAbsence(current),
      changed: false
    };
  }
  const result = await rhAdminAbsences.updateOne({ _id: absenceId, ...scope(botId, guildId), status: "approved" }, {
    $set: {
      autoRemoved: roleRemoved,
      dmDelivered,
      roleRemovedAt: roleRemoved ? new Date() : null,
      status: "finished",
      updatedAt: new Date()
    }
  });
  const absence = await getRhAbsence(botId, guildId, absenceId);
  if (!absence) return null;
  if (!result.modifiedCount) {
    return {
      absence,
      changed: false
    };
  }
  await logRhAdminAction(botId, guildId, "rh.absence_finished", absence.userId, null, "Ausência finalizada automaticamente.", roleRemoved ? "success" : "warning", { absenceId, roleRemoved });
  emitRealtime("rh-admin:absence", { botId, guildId, absenceId });
  return {
    absence,
    changed: true
  };
}

export async function listDueRhAbsences(botId: string | null, now = new Date()) {
  const { rhAdminAbsences } = await getMongoCollections();
  const query = botId ? { botId, status: "approved" as const, returnAt: { $lte: now } } : { status: "approved" as const, returnAt: { $lte: now } };
  return (await rhAdminAbsences.find(query).sort({ returnAt: 1 }).limit(100).toArray()).map(mapAbsence);
}

export async function createRhAdornment(botId: string | null, guildId: string, input: {
  imageUrl: string;
  number: string;
  observation?: string | null;
  serverName: string;
  userId: string;
}) {
  const { rhAdminAdornments } = await getMongoCollections();
  const doc: MongoRhAdminAdornment = {
    _id: randomUUID(),
    botId,
    guildId,
    userId: input.userId,
    serverName: input.serverName,
    number: input.number,
    imageUrl: input.imageUrl,
    observation: input.observation || null,
    channelId: null,
    messageId: null,
    createdAt: new Date()
  };
  await rhAdminAdornments.insertOne(doc);
  await logRhAdminAction(botId, guildId, "rh.adornment_requested", input.userId, input.userId, "Solicitação de adorno enviada.", "success", { adornmentId: doc._id });
  emitRealtime("rh-admin:adornment", { botId, guildId, adornmentId: doc._id });
  return mapAdornment(doc);
}

export async function updateRhAdornmentMessage(botId: string | null, guildId: string, adornmentId: string, input: { channelId?: string | null; messageId?: string | null }) {
  const { rhAdminAdornments } = await getMongoCollections();
  await rhAdminAdornments.updateOne({ _id: adornmentId, ...scope(botId, guildId) }, { $set: input });
  const adornment = await rhAdminAdornments.findOne({ _id: adornmentId, ...scope(botId, guildId) });
  return adornment ? mapAdornment(adornment) : null;
}

export async function logRhAdminAction(botId: string | null, guildId: string, action: string, userId: string | null, actorId: string | null, description: string, status: MongoRhAdminLog["status"], metadata: Record<string, unknown> = {}, channelId: string | null = null) {
  const { rhAdminLogs } = await getMongoCollections();
  const doc: MongoRhAdminLog = { _id: randomUUID(), botId, guildId, userId, action, actorId, description, status, metadata, channelId, createdAt: new Date() };
  await rhAdminLogs.insertOne(doc);
  emitRealtime("rh-admin:log", { botId, guildId });
  return mapLog(doc);
}

export function isRhManager(settings: RhAdminSettingsDto, userId: string, roleIds: string[], isAdministrator = false) {
  return isAdministrator
    || settings.configUserIds.includes(userId)
    || settings.configRoleIds.some((roleId) => roleIds.includes(roleId));
}

export function isRhApprover(settings: RhAdminSettingsDto, userId: string, roleIds: string[], isAdministrator = false) {
  return isAdministrator
    || settings.approverUserIds.includes(userId)
    || settings.approverRoleIds.some((roleId) => roleIds.includes(roleId))
    || isRhManager(settings, userId, roleIds, false);
}

const defaultButtonEmojis = {
  absence: "relogio",
  adornment: "homem",
  approve: "visto",
  reject: "porta",
  back: "porta",
  save: "prancheta_acertos",
  publish: "prancheta",
  logs: "prancheta_caneta"
};

function mapSettings(settings: MongoRhAdminSettings) {
  return {
    id: settings._id,
    botId: settings.botId,
    guildId: settings.guildId,
    enabled: settings.enabled,
    systemName: settings.systemName,
    color: settings.color,
    panelChannelId: settings.panelChannelId,
    absencePanelChannelId: settings.absencePanelChannelId,
    absenceReviewChannelId: settings.absenceReviewChannelId,
    absenceLogChannelId: settings.absenceLogChannelId,
    adornmentPanelChannelId: settings.adornmentPanelChannelId,
    adornmentReviewChannelId: settings.adornmentReviewChannelId,
    adornmentLogChannelId: settings.adornmentLogChannelId,
    generalLogChannelId: settings.generalLogChannelId,
    absenceRoleId: settings.absenceRoleId,
    configUserIds: settings.configUserIds ?? [],
    configRoleIds: settings.configRoleIds ?? [],
    approverUserIds: settings.approverUserIds ?? [],
    approverRoleIds: settings.approverRoleIds ?? [],
    viewerUserIds: settings.viewerUserIds ?? [],
    viewerRoleIds: settings.viewerRoleIds ?? [],
    panelBannerUrl: settings.panelBannerUrl,
    dmBannerUrl: settings.dmBannerUrl,
    approvalDmBannerUrl: settings.approvalDmBannerUrl,
    rejectionDmBannerUrl: settings.rejectionDmBannerUrl,
    finishedDmBannerUrl: settings.finishedDmBannerUrl,
    adornmentBannerUrl: settings.adornmentBannerUrl,
    panelDescription: settings.panelDescription,
    adornmentDescription: settings.adornmentDescription,
    approvalDmText: settings.approvalDmText,
    rejectionDmText: settings.rejectionDmText,
    finishedDmText: settings.finishedDmText,
    sendAbsenceDm: settings.sendAbsenceDm,
    mentionAdornmentUser: settings.mentionAdornmentUser,
    allowNonDirectImageLinks: settings.allowNonDirectImageLinks,
    checkIntervalMinutes: settings.checkIntervalMinutes,
    buttonEmojis: {
      ...settings.buttonEmojis,
      absence: defaultButtonEmojis.absence,
      adornment: defaultButtonEmojis.adornment,
      approve: defaultButtonEmojis.approve,
      reject: defaultButtonEmojis.reject,
      publish: defaultButtonEmojis.publish,
      logs: defaultButtonEmojis.logs
    },
    mainPanelMessageId: settings.mainPanelMessageId,
    mainPanelPublishedAt: settings.mainPanelPublishedAt?.toISOString() ?? null,
    lastPanelRequestedAt: settings.lastPanelRequestedAt?.toISOString() ?? null,
    updatedAt: settings.updatedAt.toISOString(),
    updatedBy: settings.updatedBy
  };
}

function mapAbsence(absence: MongoRhAdminAbsence) {
  return {
    id: absence._id,
    botId: absence.botId,
    guildId: absence.guildId,
    userId: absence.userId,
    serverName: absence.serverName,
    startDate: absence.startDate,
    returnDate: absence.returnDate,
    startAt: absence.startAt.toISOString(),
    returnAt: absence.returnAt.toISOString(),
    reason: absence.reason,
    status: absence.status,
    absenceRoleId: absence.absenceRoleId,
    reviewerId: absence.reviewerId,
    reviewedAt: absence.reviewedAt?.toISOString() ?? null,
    rejectionReason: absence.rejectionReason,
    reviewChannelId: absence.reviewChannelId,
    reviewMessageId: absence.reviewMessageId,
    roleAddedAt: absence.roleAddedAt?.toISOString() ?? null,
    roleRemovedAt: absence.roleRemovedAt?.toISOString() ?? null,
    autoRemoved: absence.autoRemoved,
    dmDelivered: absence.dmDelivered,
    createdAt: absence.createdAt.toISOString(),
    updatedAt: absence.updatedAt.toISOString()
  };
}

function mapAdornment(adornment: MongoRhAdminAdornment) {
  return {
    id: adornment._id,
    botId: adornment.botId,
    guildId: adornment.guildId,
    userId: adornment.userId,
    serverName: adornment.serverName,
    number: adornment.number,
    imageUrl: adornment.imageUrl,
    observation: adornment.observation,
    channelId: adornment.channelId,
    messageId: adornment.messageId,
    createdAt: adornment.createdAt.toISOString()
  };
}

function mapLog(log: MongoRhAdminLog) {
  return {
    id: log._id,
    botId: log.botId,
    guildId: log.guildId,
    userId: log.userId,
    action: log.action,
    actorId: log.actorId,
    description: log.description,
    status: log.status,
    metadata: log.metadata,
    channelId: log.channelId,
    createdAt: log.createdAt.toISOString()
  };
}

function cleanSettings(input: Partial<Omit<RhAdminSettingsDto, "id" | "botId" | "guildId" | "updatedAt">>) {
  const cleaned: Record<string, unknown> = { ...input };
  for (const key of [
    "adornmentBannerUrl",
    "adornmentLogChannelId",
    "adornmentPanelChannelId",
    "adornmentReviewChannelId",
    "approvalDmBannerUrl",
    "absenceLogChannelId",
    "absencePanelChannelId",
    "absenceReviewChannelId",
    "absenceRoleId",
    "dmBannerUrl",
    "finishedDmBannerUrl",
    "generalLogChannelId",
    "mainPanelMessageId",
    "panelBannerUrl",
    "panelChannelId",
    "rejectionDmBannerUrl"
  ]) {
    if (cleaned[key] === "") cleaned[key] = null;
  }
  return cleaned;
}

function scope(botId: string | null, guildId: string) {
  return { botId, guildId };
}

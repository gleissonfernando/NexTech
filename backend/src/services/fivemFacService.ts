import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fixedSystemEmojiText } from "../config/systemEmojis";
import {
  ensureGuild,
  getMongoCollections,
  type MongoFivemFacAbsence,
  type MongoFivemFacAbsenceStatus,
  type MongoFivemFacMessages,
  type MongoFivemFacSettings,
  type MongoPanelButtonAction,
  type MongoPanelButtonConfig,
  type MongoPanelButtonStyle,
  type MongoPanelButtonsPosition,
  type MongoPanelImagePosition,
  type MongoPanelVisualConfig
} from "../database/mongo";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoom } from "../realtime/events";
import { createLog } from "./logService";

export type FivemFacSettingsDto = {
  id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  panelChannelId: string | null;
  panelMessageId: string | null;
  absenceRoleId: string | null;
  autoApproveEnabled: boolean;
  autoApproveMaxDays: number | null;
  autoApproveRoleIds: string[];
  viewerRoleIds: string[];
  approverRoleIds: string[];
  memberRoleIds: string[];
  logChannelId: string | null;
  messages: MongoFivemFacMessages;
  panelVisual: MongoPanelVisualConfig;
  lastPanelRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FivemFacAbsenceDto = {
  id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string | null;
  reason: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  photoUrl: string | null;
  status: MongoFivemFacAbsenceStatus;
  privateChannelId: string | null;
  requestMessageId: string | null;
  moderatorId: string | null;
  approvedBy: string | null;
  rejectionReason: string | null;
  roleAddedAt: string | null;
  roleRemovedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FivemFacDashboardDto = {
  absences: FivemFacAbsenceDto[];
  settings: FivemFacSettingsDto;
};

export type FivemFacLifecycleResult = {
  absence: FivemFacAbsenceDto;
  changed: boolean;
};

export type FivemFacHistoryResetResult = {
  actorId: string;
  botId: string;
  deleted: {
    facAbsences: number;
    fivemGoalEntries: number;
    fivemGoalLogs: number;
    fivemGoalSubmissions: number;
    fivemGoalUserChannels: number;
    manualRegistrationLogs: number;
    manualRegistrationSubmissions: number;
    total: number;
  };
  discordChannelIds: {
    all: string[];
    facAbsencePrivate: string[];
    fivemGoalUser: string[];
  };
  guildId: string;
  resetAt: string;
};

export type SaveFivemFacSettingsInput = {
  enabled?: boolean;
  panelChannelId?: string | null;
  absenceRoleId?: string | null;
  autoApproveEnabled?: boolean;
  autoApproveMaxDays?: number | null;
  autoApproveRoleIds?: string[];
  viewerRoleIds?: string[];
  approverRoleIds?: string[];
  memberRoleIds?: string[];
  logChannelId?: string | null;
  messages?: Partial<MongoFivemFacMessages>;
  panelVisual?: Partial<MongoPanelVisualConfig>;
};

export type CreateFivemFacAbsenceInput = {
  botId: string;
  guildId: string;
  userId: string;
  username?: string | null;
  reason: string;
  startDate: string;
  endDate: string;
  notes?: string | null;
  requesterRoleIds?: string[];
};

export type ModerateFivemFacAbsenceInput = {
  absenceId: string;
  botId: string;
  moderatorId: string;
  moderatorRoleIds: string[];
  reason?: string | null;
};

const FAC_MODULE_ID = "fivem-fac";
const ACTIVE_ABSENCE_STATUSES: MongoFivemFacAbsenceStatus[] = ["pending", "approved", "active"];
const FAC_ABSENCE_UPLOAD_DIR = path.resolve(__dirname, "../../uploads/fivem-fac");
const FAC_PHOTO_MIME_EXTENSIONS: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};
const DEFAULT_MESSAGES: MongoFivemFacMessages = {
  panelTitle: `${fixedSystemEmojiText("calendario")} Solicitar Ausência`,
  panelDescription: "Informe a data de retorno e o motivo da sua ausência.",
  requestCreated: "Sua solicitação de ausência foi enviada para aprovação.",
  approved: "Sua ausência foi aprovada.",
  rejected: "Sua ausência foi reprovada.",
  started: "Sua ausência foi iniciada e o cargo configurado foi aplicado.",
  finished: "Sua ausência foi finalizada e o cargo configurado foi removido."
};
const DEFAULT_PANEL_VISUAL: MongoPanelVisualConfig = {
  panelColor: "#2b2d31",
  imageUrl: null,
  imagePosition: "none",
  buttonsPosition: "inside_panel",
  buttons: [
    {
      id: "request",
      label: "Solicitar Ausencia",
      emoji: fixedSystemEmojiText("calendario"),
      style: "primary",
      type: "action",
      action: "request_absence",
      url: null,
      order: 1,
      enabled: true
    },
    {
      id: "mine",
      label: "Minhas Ausencias",
      emoji: fixedSystemEmojiText("prancheta"),
      style: "secondary",
      type: "action",
      action: "my_absences",
      url: null,
      order: 2,
      enabled: true
    }
  ],
  componentsOrder: ["image", "text", "buttons"],
  enabledSections: {
    buttons: true,
    description: true,
    image: false
  }
};

export function defaultFivemFacSettings(botId: string, guildId: string): FivemFacSettingsDto {
  const now = new Date().toISOString();

  return {
    id: "",
    botId,
    guildId,
    enabled: false,
    panelChannelId: null,
    panelMessageId: null,
    absenceRoleId: null,
    autoApproveEnabled: false,
    autoApproveMaxDays: null,
    autoApproveRoleIds: [],
    viewerRoleIds: [],
    approverRoleIds: [],
    memberRoleIds: [],
    logChannelId: null,
    messages: DEFAULT_MESSAGES,
    panelVisual: DEFAULT_PANEL_VISUAL,
    lastPanelRequestedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

export async function getFivemFacDashboard(guildId: string, botId: string): Promise<FivemFacDashboardDto> {
  const { fivemFacAbsences } = await getMongoCollections();
  const [settings, absences] = await Promise.all([
    getFivemFacSettings(guildId, botId),
    fivemFacAbsences
      .find({ botId, guildId })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray()
  ]);

  return {
    absences: absences.map(toAbsenceDto),
    settings
  };
}

export async function getFivemFacSettings(guildId: string, botId: string): Promise<FivemFacSettingsDto> {
  const { fivemFacSettings } = await getMongoCollections();
  const settings = await fivemFacSettings.findOne({ botId, guildId });

  return settings ? toSettingsDto(settings) : defaultFivemFacSettings(botId, guildId);
}

export async function listActiveFivemFacSettings(botId: string | null) {
  const { fivemFacSettings } = await getMongoCollections();
  const settings = await fivemFacSettings
    .find({
      enabled: true,
      ...(botId ? { botId } : {})
    })
    .sort({ updatedAt: -1 })
    .toArray();

  return settings.map(toSettingsDto);
}

export async function saveFivemFacSettings(guildId: string, botId: string, input: SaveFivemFacSettingsInput, actorId: string) {
  const { fivemFacSettings } = await getMongoCollections();
  const current = await getFivemFacSettings(guildId, botId);
  const now = new Date();
  const next = {
    enabled: input.enabled ?? current.enabled,
    panelChannelId: normalizeNullableSnowflake(input.panelChannelId, current.panelChannelId),
    absenceRoleId: normalizeNullableSnowflake(input.absenceRoleId, current.absenceRoleId),
    autoApproveEnabled: input.autoApproveEnabled ?? current.autoApproveEnabled,
    autoApproveMaxDays: input.autoApproveMaxDays === undefined ? current.autoApproveMaxDays : normalizeAutoApproveMaxDays(input.autoApproveMaxDays),
    autoApproveRoleIds: input.autoApproveRoleIds ? normalizeSnowflakes(input.autoApproveRoleIds) : current.autoApproveRoleIds,
    viewerRoleIds: input.viewerRoleIds ? normalizeSnowflakes(input.viewerRoleIds) : current.viewerRoleIds,
    approverRoleIds: input.approverRoleIds ? normalizeSnowflakes(input.approverRoleIds) : current.approverRoleIds,
    memberRoleIds: input.memberRoleIds ? normalizeSnowflakes(input.memberRoleIds) : current.memberRoleIds,
    logChannelId: normalizeNullableSnowflake(input.logChannelId, current.logChannelId),
    messages: normalizeMessages({
      ...current.messages,
      ...(input.messages ?? {})
    }),
    panelVisual: normalizePanelVisual({
      ...current.panelVisual,
      ...(input.panelVisual ?? {})
    })
  };

  await ensureGuild(guildId);
  await fivemFacSettings.updateOne(
    {
      botId,
      guildId
    },
    {
      $set: {
        ...next,
        botId,
        guildId,
        updatedAt: now,
        updatedBy: actorId
      },
      $setOnInsert: {
        _id: randomUUID(),
        createdAt: now,
        createdBy: actorId,
        panelMessageId: null,
        lastPanelRequestedAt: null
      }
    },
    {
      upsert: true
    }
  );

  const saved = await getFivemFacSettings(guildId, botId);
  const log = await createFacLog({
    botId,
    guildId,
    type: "fivem.fac.settings_updated",
    userId: actorId,
    message: "Configuracao do FAC atualizada.",
    metadata: {
      action: "settings_updated",
      changedKeys: Object.keys(input),
      module: FAC_MODULE_ID,
      status: saved.enabled ? "enabled" : "disabled"
    }
  });

  emitRealtime("fivem:fac:settings_updated", saved);
  emitRealtimeToRoom(devBotRealtimeRoom(botId), "fivem:fac:settings_updated", {
    botId,
    guildId,
    settings: saved
  });
  if (saved.enabled && saved.panelChannelId && saved.panelMessageId) {
    emitRealtimeToRoom(devBotRealtimeRoom(botId), "fivem:fac:panel_publish", {
      botId,
      guildId,
      settings: saved
    });
  }
  if (log) {
    emitRealtime("logs:new", log);
  }

  return saved;
}

export async function requestFivemFacPanelPublish(guildId: string, botId: string, actorId: string) {
  const { fivemFacSettings } = await getMongoCollections();
  const settings = await getFivemFacSettings(guildId, botId);

  validateSettingsReady(settings);

  const requestedAt = new Date();
  await fivemFacSettings.updateOne(
    {
      botId,
      guildId
    },
    {
      $set: {
        lastPanelRequestedAt: requestedAt,
        updatedAt: requestedAt,
        updatedBy: actorId
      },
      $setOnInsert: {
        _id: randomUUID(),
        createdAt: requestedAt,
        createdBy: actorId
      }
    },
    {
      upsert: true
    }
  );

  const nextSettings = await getFivemFacSettings(guildId, botId);
  emitRealtimeToRoom(devBotRealtimeRoom(botId), "fivem:fac:panel_publish", {
    botId,
    guildId,
    settings: nextSettings
  });

  return nextSettings;
}

export async function updateFivemFacPanelMessageState(botId: string, guildId: string, messageId: string | null) {
  const { fivemFacSettings } = await getMongoCollections();
  const now = new Date();

  await fivemFacSettings.updateOne(
    {
      botId,
      guildId
    },
    {
      $set: {
        panelMessageId: normalizeNullableSnowflake(messageId, null),
        updatedAt: now
      }
    }
  );

  return getFivemFacSettings(guildId, botId);
}

export async function resetFivemFacTestHistory(input: { actorId: string; botId: string; guildId: string }): Promise<FivemFacHistoryResetResult> {
  const {
    fivemFacAbsences,
    fivemGoalEntries,
    fivemGoalLogs,
    fivemGoalSubmissions,
    fivemGoalUserChannels,
    manualRegistrationLogs,
    manualRegistrationSubmissions
  } = await getMongoCollections();
  const scope = { botId: input.botId, guildId: input.guildId };
  const [facAbsenceChannels, goalChannels] = await Promise.all([
    fivemFacAbsences
      .find(scope, { projection: { privateChannelId: 1 } })
      .toArray(),
    fivemGoalUserChannels
      .find(scope, { projection: { channelId: 1 } })
      .toArray()
  ]);
  const facAbsencePrivate = uniqueSnowflakes(facAbsenceChannels.map((absence) => absence.privateChannelId));
  const fivemGoalUser = uniqueSnowflakes(goalChannels.map((channel) => channel.channelId));
  const [facAbsences, manualSubmissions, manualLogs, goalUserChannels, goalEntries, goalSubmissions, goalLogs] = await Promise.all([
    fivemFacAbsences.deleteMany(scope),
    manualRegistrationSubmissions.deleteMany(scope),
    manualRegistrationLogs.deleteMany(scope),
    fivemGoalUserChannels.deleteMany(scope),
    fivemGoalEntries.deleteMany(scope),
    fivemGoalSubmissions.deleteMany(scope),
    fivemGoalLogs.deleteMany(scope)
  ]);
  const deleted = {
    facAbsences: facAbsences.deletedCount ?? 0,
    fivemGoalEntries: goalEntries.deletedCount ?? 0,
    fivemGoalLogs: goalLogs.deletedCount ?? 0,
    fivemGoalSubmissions: goalSubmissions.deletedCount ?? 0,
    fivemGoalUserChannels: goalUserChannels.deletedCount ?? 0,
    manualRegistrationLogs: manualLogs.deletedCount ?? 0,
    manualRegistrationSubmissions: manualSubmissions.deletedCount ?? 0,
    total: 0
  };

  deleted.total = Object.entries(deleted)
    .filter(([key]) => key !== "total")
    .reduce((sum, [, count]) => sum + count, 0);

  const resetAt = new Date().toISOString();
  const result: FivemFacHistoryResetResult = {
    actorId: input.actorId,
    botId: input.botId,
    deleted,
    discordChannelIds: {
      all: uniqueSnowflakes([...facAbsencePrivate, ...fivemGoalUser]),
      facAbsencePrivate,
      fivemGoalUser
    },
    guildId: input.guildId,
    resetAt
  };
  const log = await createFacLog({
    botId: input.botId,
    guildId: input.guildId,
    type: "fivem.fac.test_history_reset",
    userId: input.actorId,
    message: "Historico de teste do FAC limpo.",
    metadata: {
      action: "test_history_reset",
      deleted,
      discordChannelIds: result.discordChannelIds.all,
      module: FAC_MODULE_ID,
      resetAt
    }
  });

  emitRealtime("fivem:fac:history_reset", result);
  emitRealtimeToRoom(devBotRealtimeRoom(input.botId), "fivem:fac:history_reset", result);
  if (log) {
    emitRealtime("logs:new", log);
  }

  return result;
}

export async function createFivemFacAbsence(input: CreateFivemFacAbsenceInput) {
  const settings = await getFivemFacSettings(input.guildId, input.botId);
  validateSettingsReady(settings);
  const startDate = normalizeDateOnly(input.startDate);
  const endDate = normalizeDateOnly(input.endDate);

  validateAbsenceDates(startDate, endDate, true);

  const { fivemFacAbsences } = await getMongoCollections();
  const duplicate = await fivemFacAbsences.findOne({
    botId: input.botId,
    guildId: input.guildId,
    userId: input.userId,
    status: {
      $in: ACTIVE_ABSENCE_STATUSES
    }
  });

  if (duplicate) {
    throw createFacError("Voce ja possui uma ausencia pendente, aprovada ou ativa.", 409);
  }

  const now = new Date();
  const autoApproved = shouldAutoApproveAbsence(settings, startDate, endDate, input.requesterRoleIds ?? []);
  const absence: MongoFivemFacAbsence = {
    _id: randomUUID(),
    botId: input.botId,
    guildId: input.guildId,
    userId: input.userId,
    username: normalizeShortText(input.username, 100),
    reason: normalizeRequiredText(input.reason, 800, "Informe o motivo da ausencia."),
    startDate,
    endDate,
    notes: normalizeShortText(input.notes, 1000),
    photoUrl: null,
    status: autoApproved ? "approved" : "pending",
    privateChannelId: null,
    requestMessageId: null,
    moderatorId: null,
    approvedBy: autoApproved ? "automatic" : null,
    rejectionReason: null,
    roleAddedAt: null,
    roleRemovedAt: null,
    approvedAt: autoApproved ? now : null,
    rejectedAt: null,
    startedAt: null,
    finishedAt: null,
    closedAt: null,
    audit: autoApproved
      ? [
          auditEntry("created", input.userId, null, "pending", now),
          auditEntry("auto_approved", "automatic", null, "approved", now)
        ]
      : [auditEntry("created", input.userId, null, "pending", now)],
    createdAt: now,
    updatedAt: now
  };

  await fivemFacAbsences.insertOne(absence);
  const dto = toAbsenceDto(absence);
  const log = await createFacLog({
    botId: input.botId,
    guildId: input.guildId,
    type: "fivem.fac.request_created",
    userId: input.userId,
    message: "Solicitacao de ausencia criada.",
    metadata: auditMetadata(dto, {
      action: "request_created",
      date: now.toISOString(),
      moderatorId: null,
      module: FAC_MODULE_ID
    })
  });

  emitFacAbsenceEvent("created", dto, log);
  if (autoApproved) {
    const approvalLog = await createFacLog({
      botId: input.botId,
      guildId: input.guildId,
      type: "fivem.fac.request_auto_approved",
      userId: input.userId,
      message: "Solicitacao de ausencia aprovada automaticamente.",
      metadata: auditMetadata(dto, {
        action: "request_auto_approved",
        autoApproveMaxDays: settings.autoApproveMaxDays,
        autoApproveRoleIds: settings.autoApproveRoleIds,
        date: now.toISOString(),
        moderatorId: "automatic",
        module: FAC_MODULE_ID
      })
    });
    emitFacAbsenceEvent("approved", dto, approvalLog);
  }
  return dto;
}

export async function listFivemFacUserAbsences(botId: string, guildId: string, userId: string) {
  const { fivemFacAbsences } = await getMongoCollections();
  const absences = await fivemFacAbsences
    .find({ botId, guildId, userId })
    .sort({ createdAt: -1 })
    .limit(10)
    .toArray();

  return absences.map(toAbsenceDto);
}

export async function getFivemFacAbsence(absenceId: string, botId: string) {
  const { fivemFacAbsences } = await getMongoCollections();
  const absence = await fivemFacAbsences.findOne({ _id: absenceId, botId });

  return absence ? toAbsenceDto(absence) : null;
}

export async function updateFivemFacAbsenceChannel(
  absenceId: string,
  botId: string,
  input: {
    privateChannelId?: string | null;
    requestMessageId?: string | null;
  }
) {
  const { fivemFacAbsences } = await getMongoCollections();
  const now = new Date();

  await fivemFacAbsences.updateOne(
    {
      _id: absenceId,
      botId
    },
    {
      $set: {
        privateChannelId: normalizeNullableSnowflake(input.privateChannelId, null),
        requestMessageId: normalizeNullableSnowflake(input.requestMessageId, null),
        updatedAt: now
      }
    }
  );

  const updated = await getFivemFacAbsence(absenceId, botId);

  if (!updated) {
    throw createFacError("Ausencia nao encontrada.", 404);
  }

  return updated;
}

export async function approveFivemFacAbsence(input: ModerateFivemFacAbsenceInput) {
  const { fivemFacAbsences } = await getMongoCollections();
  const absence = await findModeratableAbsence(input.absenceId, input.botId);
  const settings = await getFivemFacSettings(absence.guildId, input.botId);

  ensureApprover(settings, input.moderatorRoleIds);

  if (absence.status === "approved") {
    return toAbsenceDto(absence);
  }

  if (absence.status !== "pending") {
    throw createFacError("Apenas solicitacoes pendentes podem ser aprovadas.", 409);
  }

  const now = new Date();
  await fivemFacAbsences.updateOne(
    {
      _id: absence._id,
      botId: input.botId
    },
    {
      $set: {
        status: "approved",
        moderatorId: input.moderatorId,
        approvedBy: input.moderatorId,
        approvedAt: absence.approvedAt ?? now,
        updatedAt: now
      },
      $push: {
        audit: auditEntry("approved", input.moderatorId, null, "approved", now)
      }
    }
  );

  const updated = await getFivemFacAbsence(input.absenceId, input.botId);

  if (!updated) {
    throw createFacError("Ausencia nao encontrada.", 404);
  }

  const log = await createFacLog({
    botId: input.botId,
    guildId: updated.guildId,
    type: "fivem.fac.request_approved",
    userId: updated.userId,
    message: "Solicitacao de ausencia aprovada.",
    metadata: auditMetadata(updated, {
      action: "request_approved",
      date: now.toISOString(),
      moderatorId: input.moderatorId,
      module: FAC_MODULE_ID
    })
  });

  emitFacAbsenceEvent("approved", updated, log);
  return updated;
}

export async function rejectFivemFacAbsence(input: ModerateFivemFacAbsenceInput) {
  const { fivemFacAbsences } = await getMongoCollections();
  const absence = await findModeratableAbsence(input.absenceId, input.botId);
  const settings = await getFivemFacSettings(absence.guildId, input.botId);
  const rejectionReason = normalizeRequiredText(input.reason, 800, "Informe o motivo da reprovacao.");

  ensureApprover(settings, input.moderatorRoleIds);

  if (absence.status !== "pending" && absence.status !== "approved") {
    throw createFacError("Esta solicitacao nao pode mais ser reprovada.", 409);
  }

  const now = new Date();
  await fivemFacAbsences.updateOne(
    {
      _id: absence._id,
      botId: input.botId
    },
    {
      $set: {
        status: "rejected",
        moderatorId: input.moderatorId,
        approvedBy: null,
        approvedAt: null,
        rejectionReason,
        rejectedAt: now,
        updatedAt: now
      },
      $push: {
        audit: auditEntry("rejected", input.moderatorId, rejectionReason, "rejected", now)
      }
    }
  );

  const updated = await getFivemFacAbsence(input.absenceId, input.botId);

  if (!updated) {
    throw createFacError("Ausencia nao encontrada.", 404);
  }

  const log = await createFacLog({
    botId: input.botId,
    guildId: updated.guildId,
    type: "fivem.fac.request_rejected",
    userId: updated.userId,
    message: "Solicitacao de ausencia reprovada.",
    metadata: auditMetadata(updated, {
      action: "request_rejected",
      date: now.toISOString(),
      moderatorId: input.moderatorId,
      module: FAC_MODULE_ID,
      reason: rejectionReason
    })
  });

  emitFacAbsenceEvent("rejected", updated, log);
  return updated;
}

export async function closeFivemFacAbsence(input: ModerateFivemFacAbsenceInput & { roleRemoved?: boolean }) {
  const { fivemFacAbsences } = await getMongoCollections();
  const absence = await findModeratableAbsence(input.absenceId, input.botId);
  const settings = await getFivemFacSettings(absence.guildId, input.botId);

  ensureApprover(settings, input.moderatorRoleIds);

  if (absence.status === "rejected" || absence.status === "finished" || absence.status === "closed") {
    throw createFacError("Esta ausencia ja foi encerrada.", 409);
  }

  const now = new Date();
  await fivemFacAbsences.updateOne(
    {
      _id: absence._id,
      botId: input.botId
    },
    {
      $set: {
        status: "closed",
        moderatorId: input.moderatorId,
        closedAt: now,
        roleRemovedAt: input.roleRemoved ? now : absence.roleRemovedAt,
        updatedAt: now
      },
      $push: {
        audit: auditEntry("closed", input.moderatorId, input.reason ?? null, "closed", now)
      }
    }
  );

  const updated = await getFivemFacAbsence(input.absenceId, input.botId);

  if (!updated) {
    throw createFacError("Ausencia nao encontrada.", 404);
  }

  const log = await createFacLog({
    botId: input.botId,
    guildId: updated.guildId,
    type: "fivem.fac.request_closed",
    userId: updated.userId,
    message: "Ausencia encerrada manualmente.",
    metadata: auditMetadata(updated, {
      action: "request_closed",
      date: now.toISOString(),
      moderatorId: input.moderatorId,
      module: FAC_MODULE_ID,
      reason: input.reason ?? null
    })
  });

  emitFacAbsenceEvent("closed", updated, log);
  return updated;
}

export async function saveFivemFacAbsencePhotoFile(
  guildId: string,
  absenceId: string,
  buffer: Buffer,
  mimeType: string
) {
  const extension = FAC_PHOTO_MIME_EXTENSIONS[mimeType];

  if (!extension) {
    throw createFacError("Formato invalido. Envie PNG, JPG, JPEG, WEBP ou GIF.", 400);
  }

  if (!buffer.length) {
    throw createFacError("Arquivo de imagem obrigatorio.", 400);
  }

  await fs.mkdir(FAC_ABSENCE_UPLOAD_DIR, { recursive: true });

  const safeGuildId = guildId.replace(/[^a-zA-Z0-9_-]/g, "");
  const safeAbsenceId = absenceId.replace(/[^a-zA-Z0-9_-]/g, "");
  const fileName = `${safeGuildId}-${safeAbsenceId}-${Date.now()}-${randomUUID()}.${extension}`;

  await fs.writeFile(path.join(FAC_ABSENCE_UPLOAD_DIR, fileName), buffer);

  return `/uploads/fivem-fac/${fileName}`;
}

export async function saveFivemFacPanelImageFile(
  guildId: string,
  botId: string,
  buffer: Buffer,
  mimeType: string,
  actorId: string
) {
  const extension = FAC_PHOTO_MIME_EXTENSIONS[mimeType];

  if (!extension) {
    throw createFacError("Formato invalido. Envie PNG, JPG, JPEG, WEBP ou GIF.", 400);
  }

  if (!buffer.length) {
    throw createFacError("Arquivo de imagem obrigatorio.", 400);
  }

  await fs.mkdir(FAC_ABSENCE_UPLOAD_DIR, { recursive: true });

  const safeGuildId = guildId.replace(/[^a-zA-Z0-9_-]/g, "");
  const fileName = `${safeGuildId}-panel-${Date.now()}-${randomUUID()}.${extension}`;
  const imageUrl = `/uploads/fivem-fac/${fileName}`;

  await fs.writeFile(path.join(FAC_ABSENCE_UPLOAD_DIR, fileName), buffer);

  return saveFivemFacSettings(guildId, botId, {
    panelVisual: {
      imageUrl,
      imagePosition: "top",
      enabledSections: {
        ...DEFAULT_PANEL_VISUAL.enabledSections,
        image: true
      }
    }
  }, actorId);
}

export async function updateFivemFacAbsencePhoto(
  absenceId: string,
  botId: string,
  guildId: string,
  photoUrl: string | null
) {
  const { fivemFacAbsences } = await getMongoCollections();
  const current = await fivemFacAbsences.findOne({
    _id: absenceId,
    botId,
    guildId
  });

  if (!current) {
    throw createFacError("Ausencia nao encontrada.", 404);
  }

  const now = new Date();
  await fivemFacAbsences.updateOne(
    {
      _id: absenceId,
      botId,
      guildId
    },
    {
      $set: {
        photoUrl,
        updatedAt: now
      }
    }
  );

  if (current.photoUrl && current.photoUrl !== photoUrl) {
    void removeLocalFacAbsencePhoto(current.photoUrl).catch(() => undefined);
  }

  const updated = await getFivemFacAbsence(absenceId, botId);

  if (!updated) {
    throw createFacError("Ausencia nao encontrada.", 404);
  }

  emitFacAbsenceEvent("photo_updated", updated, null);
  return updated;
}

export async function listFivemFacDueAbsences(botId: string, today = currentDateKey()) {
  const { fivemFacAbsences } = await getMongoCollections();
  const absences = await fivemFacAbsences
    .find({
      botId,
      status: {
        $in: ["approved", "active"]
      },
      $or: [
        {
          status: "approved",
          startDate: {
            $lte: today
          }
        },
        {
          status: "active",
          endDate: {
            $lte: today
          }
        }
      ]
    })
    .sort({ startDate: 1, endDate: 1 })
    .limit(100)
    .toArray();

  return absences.map(toAbsenceDto);
}

export async function markFivemFacAbsenceStarted(absenceId: string, botId: string, roleAdded = true): Promise<FivemFacLifecycleResult> {
  const { fivemFacAbsences } = await getMongoCollections();
  const absence = await findModeratableAbsence(absenceId, botId);

  if (absence.status === "active") {
    return {
      absence: toAbsenceDto(absence),
      changed: false
    };
  }

  if (absence.status !== "approved") {
    throw createFacError("Ausencia nao esta aprovada para iniciar.", 409);
  }

  const now = new Date();
  const result = await fivemFacAbsences.updateOne(
    {
      _id: absenceId,
      botId,
      status: "approved"
    },
    {
      $set: {
        status: "active",
        roleAddedAt: roleAdded ? (absence.roleAddedAt ?? now) : absence.roleAddedAt,
        startedAt: absence.startedAt ?? now,
        updatedAt: now
      },
      $push: {
        audit: auditEntry("started", null, null, "active", now)
      }
    }
  );

  const updated = await getFivemFacAbsence(absenceId, botId);

  if (!updated) {
    throw createFacError("Ausencia nao encontrada.", 404);
  }

  if (!result.modifiedCount) {
    return {
      absence: updated,
      changed: false
    };
  }

  const log = await createFacLog({
    botId,
    guildId: updated.guildId,
    type: "fivem.fac.absence_started",
    userId: updated.userId,
    message: "Ausencia iniciada automaticamente.",
    metadata: auditMetadata(updated, {
      action: "absence_started",
      date: now.toISOString(),
      moderatorId: updated.moderatorId,
      module: FAC_MODULE_ID
    })
  });

  emitFacAbsenceEvent("started", updated, log);
  return {
    absence: updated,
    changed: true
  };
}

export async function markFivemFacAbsenceFinished(absenceId: string, botId: string, roleRemoved = true): Promise<FivemFacLifecycleResult> {
  const { fivemFacAbsences } = await getMongoCollections();
  const absence = await findModeratableAbsence(absenceId, botId);

  if (absence.status === "finished" || absence.status === "closed" || absence.status === "rejected") {
    return {
      absence: toAbsenceDto(absence),
      changed: false
    };
  }

  const now = new Date();
  const result = await fivemFacAbsences.updateOne(
    {
      _id: absenceId,
      botId,
      status: {
        $in: ["active", "approved"]
      }
    },
    {
      $set: {
        status: "finished",
        roleRemovedAt: roleRemoved ? (absence.roleRemovedAt ?? now) : absence.roleRemovedAt,
        finishedAt: absence.finishedAt ?? now,
        updatedAt: now
      },
      $push: {
        audit: auditEntry("finished", null, null, "finished", now)
      }
    }
  );

  const updated = await getFivemFacAbsence(absenceId, botId);

  if (!updated) {
    throw createFacError("Ausencia nao encontrada.", 404);
  }

  if (!result.modifiedCount) {
    return {
      absence: updated,
      changed: false
    };
  }

  const log = await createFacLog({
    botId,
    guildId: updated.guildId,
    type: "fivem.fac.absence_finished",
    userId: updated.userId,
    message: "Ausencia finalizada automaticamente.",
    metadata: auditMetadata(updated, {
      action: "absence_finished",
      date: now.toISOString(),
      moderatorId: updated.moderatorId,
      module: FAC_MODULE_ID
    })
  });

  emitFacAbsenceEvent("finished", updated, log);
  return {
    absence: updated,
    changed: true
  };
}

export function currentDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
    year: "numeric"
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

function validateSettingsReady(settings: FivemFacSettingsDto) {
  if (!settings.enabled) {
    throw createFacError("O sistema FAC nao esta ativo na dashboard.", 403);
  }

  if (!settings.panelChannelId || !settings.absenceRoleId || !settings.approverRoleIds.length) {
    throw createFacError("Configure canal do painel, cargo de ausencia e cargos aprovadores antes de usar o FAC.", 400);
  }
}

function validateAbsenceDates(startDate: string, endDate: string, requireFuture: boolean) {
  if (startDate > endDate) {
    throw createFacError("A data inicial nao pode ser maior que a data final.", 400);
  }

  if (requireFuture && startDate < currentDateKey()) {
    throw createFacError("A data inicial nao pode ser anterior a data de hoje.", 400);
  }
}

function shouldAutoApproveAbsence(settings: FivemFacSettingsDto, startDate: string, endDate: string, requesterRoleIds: string[]) {
  if (!settings.autoApproveEnabled || !settings.autoApproveRoleIds.length) {
    return false;
  }

  const allowedRoles = new Set(settings.autoApproveRoleIds);
  if (!requesterRoleIds.some((roleId) => allowedRoles.has(roleId))) {
    return false;
  }

  return settings.autoApproveMaxDays === null
    || absenceDurationDays(startDate, endDate) <= settings.autoApproveMaxDays;
}

function absenceDurationDays(startDate: string, endDate: string) {
  const start = dateKeyToUtcMs(startDate);
  const end = dateKeyToUtcMs(endDate);

  if (start === null || end === null || end < start) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.round((end - start) / 86_400_000);
}

function dateKeyToUtcMs(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return null;
  }

  return Date.UTC(year, month - 1, day);
}

function normalizeDateOnly(value: string) {
  const normalized = value.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw createFacError("Use datas no formato AAAA-MM-DD.", 400);
  }

  const date = new Date(`${normalized}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw createFacError("Data invalida.", 400);
  }

  return normalized;
}

async function removeLocalFacAbsencePhoto(photoUrl: string) {
  if (!photoUrl.startsWith("/uploads/fivem-fac/")) {
    return;
  }

  const fileName = path.basename(photoUrl);
  const filePath = path.resolve(FAC_ABSENCE_UPLOAD_DIR, fileName);

  if (!filePath.startsWith(FAC_ABSENCE_UPLOAD_DIR)) {
    return;
  }

  await fs.unlink(filePath);
}

function normalizeMessages(messages: Partial<MongoFivemFacMessages>): MongoFivemFacMessages {
  return {
    panelTitle: normalizeMessage(messages.panelTitle, DEFAULT_MESSAGES.panelTitle, 120),
    panelDescription: normalizeMessage(messages.panelDescription, DEFAULT_MESSAGES.panelDescription, 1000),
    requestCreated: normalizeMessage(messages.requestCreated, DEFAULT_MESSAGES.requestCreated, 500),
    approved: normalizeMessage(messages.approved, DEFAULT_MESSAGES.approved, 500),
    rejected: normalizeMessage(messages.rejected, DEFAULT_MESSAGES.rejected, 500),
    started: normalizeMessage(messages.started, DEFAULT_MESSAGES.started, 500),
    finished: normalizeMessage(messages.finished, DEFAULT_MESSAGES.finished, 500)
  };
}

function normalizePanelVisual(input: Partial<MongoPanelVisualConfig>): MongoPanelVisualConfig {
  const defaults = DEFAULT_PANEL_VISUAL;
  return {
    panelColor: normalizePanelColor(input.panelColor, defaults.panelColor),
    imageUrl: normalizeImageUrl(input.imageUrl),
    imagePosition: normalizeEnum(input.imagePosition, ["right_small", "top", "bottom", "none"], defaults.imagePosition),
    buttonsPosition: normalizeEnum(input.buttonsPosition, ["inside_panel", "outside_panel", "below", "rows", "none"], defaults.buttonsPosition),
    buttons: normalizePanelButtons(input.buttons),
    componentsOrder: normalizeComponentsOrder(input.componentsOrder),
    enabledSections: {
      image: input.enabledSections?.image === true,
      buttons: input.enabledSections?.buttons !== false,
      description: input.enabledSections?.description !== false
    }
  };
}

function normalizePanelButtons(buttons: unknown): MongoPanelButtonConfig[] {
  const source = Array.isArray(buttons) ? buttons : DEFAULT_PANEL_VISUAL.buttons;
  return source
    .map((button, index) => normalizePanelButton(button, index))
    .filter((button): button is MongoPanelButtonConfig => Boolean(button))
    .sort((left, right) => left.order - right.order)
    .slice(0, 10);
}

function normalizePanelButton(button: unknown, index: number): MongoPanelButtonConfig | null {
  if (!button || typeof button !== "object") {
    return null;
  }

  const item = button as Partial<MongoPanelButtonConfig>;
  const type = item.type === "url" ? "url" : "action";
  const action = type === "url"
    ? "url"
    : normalizeEnum<MongoPanelButtonAction>(item.action, ["request_absence", "my_absences"], "request_absence");
  const url = type === "url" ? normalizeUrl(item.url) : null;

  if (type === "url" && !url) {
    return null;
  }

  return {
    id: normalizeShortText(item.id, 40) ?? `button_${index + 1}`,
    label: normalizeShortText(item.label, 80) ?? `Botao ${index + 1}`,
    emoji: normalizeShortText(item.emoji, 40),
    style: normalizeEnum<MongoPanelButtonStyle>(item.style, ["primary", "secondary", "success", "danger", "link"], type === "url" ? "link" : "primary"),
    type,
    action,
    url,
    order: Number.isFinite(item.order) ? Math.max(0, Math.trunc(Number(item.order))) : index + 1,
    enabled: item.enabled !== false
  };
}

function normalizeComponentsOrder(value: unknown): Array<"image" | "text" | "buttons"> {
  const allowed = new Set(["image", "text", "buttons"]);
  const items = Array.isArray(value) ? value.filter((item): item is "image" | "text" | "buttons" => allowed.has(String(item))) : [];
  const merged = [...items, ...DEFAULT_PANEL_VISUAL.componentsOrder];
  return [...new Set(merged)].slice(0, 3);
}

function normalizePanelColor(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : fallback;
}

function normalizeImageUrl(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized && (/^https?:\/\//i.test(normalized) || normalized.startsWith("/uploads/")) ? normalized : null;
}

function normalizeUrl(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return /^https?:\/\//i.test(normalized) ? normalized : null;
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

function normalizeMessage(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

function normalizeRequiredText(value: unknown, maxLength: number, message: string) {
  if (typeof value !== "string") {
    throw createFacError(message, 400);
  }

  const normalized = value.trim();

  if (!normalized) {
    throw createFacError(message, 400);
  }

  return normalized.slice(0, maxLength);
}

function normalizeShortText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeNullableSnowflake(value: unknown, fallback: string | null) {
  if (value === undefined) {
    return fallback;
  }

  if (value === null || value === "") {
    return null;
  }

  if (typeof value === "string" && /^\d{5,32}$/.test(value.trim())) {
    return value.trim();
  }

  throw createFacError("Um dos IDs informados nao e valido.", 400);
}

function normalizeSnowflakes(values: string[]) {
  return [...new Set(values.map((value) => normalizeNullableSnowflake(value, null)).filter((value): value is string => Boolean(value)))];
}

function uniqueSnowflakes(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && /^\d{5,32}$/.test(value)))];
}

function normalizeAutoApproveMaxDays(value: unknown) {
  if (value === null || value === "") {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw createFacError("O limite de dias para autoaprovacao nao e valido.", 400);
  }

  return Math.max(0, Math.min(365, Math.trunc(numeric)));
}

async function findModeratableAbsence(absenceId: string, botId: string) {
  const { fivemFacAbsences } = await getMongoCollections();
  const absence = await fivemFacAbsences.findOne({
    _id: absenceId,
    botId
  });

  if (!absence) {
    throw createFacError("Ausencia nao encontrada.", 404);
  }

  return absence;
}

function ensureApprover(settings: FivemFacSettingsDto, roleIds: string[]) {
  const allowed = new Set(settings.approverRoleIds);

  if (!roleIds.some((roleId) => allowed.has(roleId))) {
    throw createFacError("Voce nao tem cargo autorizado para moderar ausencias.", 403);
  }
}

function auditEntry(
  action: string,
  actorId: string | null,
  reason: string | null,
  status: MongoFivemFacAbsenceStatus,
  createdAt = new Date()
) {
  return {
    action,
    actorId,
    reason,
    status,
    createdAt
  };
}

function auditMetadata(absence: FivemFacAbsenceDto, extra: Record<string, unknown>) {
  return {
    absenceId: absence.id,
    discordId: absence.userId,
    endDate: absence.endDate,
    motivo: absence.reason,
    reason: absence.rejectionReason ?? absence.reason,
    startDate: absence.startDate,
    status: absence.status,
    usuario: absence.username ?? absence.userId,
    userId: absence.userId,
    ...extra
  };
}

async function createFacLog(input: Parameters<typeof createLog>[0]) {
  return createLog(input).catch((error) => {
    console.warn("[fivem-fac] nao foi possivel registrar log:", error instanceof Error ? error.message : error);
    return null;
  });
}

function emitFacAbsenceEvent(action: string, absence: FivemFacAbsenceDto, log: Awaited<ReturnType<typeof createFacLog>>) {
  const payload = {
    action,
    absence,
    botId: absence.botId,
    guildId: absence.guildId
  };

  emitRealtime("fivem:fac:absence_updated", payload);
  emitRealtimeToRoom(devBotRealtimeRoom(absence.botId), "fivem:fac:absence_updated", payload);

  if (log) {
    emitRealtime("logs:new", log);
  }
}

function toSettingsDto(settings: MongoFivemFacSettings): FivemFacSettingsDto {
  return {
    id: settings._id,
    botId: settings.botId,
    guildId: settings.guildId,
    enabled: settings.enabled === true,
    panelChannelId: settings.panelChannelId ?? null,
    panelMessageId: settings.panelMessageId ?? null,
    absenceRoleId: settings.absenceRoleId ?? null,
    autoApproveEnabled: settings.autoApproveEnabled === true,
    autoApproveMaxDays: typeof settings.autoApproveMaxDays === "number" && Number.isFinite(settings.autoApproveMaxDays) ? settings.autoApproveMaxDays : null,
    autoApproveRoleIds: normalizeSnowflakes(settings.autoApproveRoleIds ?? []),
    viewerRoleIds: normalizeSnowflakes(settings.viewerRoleIds ?? []),
    approverRoleIds: normalizeSnowflakes(settings.approverRoleIds ?? []),
    memberRoleIds: normalizeSnowflakes(settings.memberRoleIds ?? []),
    logChannelId: settings.logChannelId ?? null,
    messages: normalizeMessages(settings.messages ?? DEFAULT_MESSAGES),
    panelVisual: normalizePanelVisual(settings.panelVisual ?? DEFAULT_PANEL_VISUAL),
    lastPanelRequestedAt: settings.lastPanelRequestedAt?.toISOString?.() ?? null,
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString()
  };
}

function toAbsenceDto(absence: MongoFivemFacAbsence): FivemFacAbsenceDto {
  return {
    id: absence._id,
    botId: absence.botId,
    guildId: absence.guildId,
    userId: absence.userId,
    username: absence.username ?? null,
    reason: absence.reason,
    startDate: absence.startDate,
    endDate: absence.endDate,
    notes: absence.notes ?? null,
    photoUrl: absence.photoUrl ?? null,
    status: absence.status,
    privateChannelId: absence.privateChannelId ?? null,
    requestMessageId: absence.requestMessageId ?? null,
    moderatorId: absence.moderatorId ?? null,
    approvedBy: absence.approvedBy ?? absence.moderatorId ?? null,
    rejectionReason: absence.rejectionReason ?? null,
    roleAddedAt: absence.roleAddedAt?.toISOString?.() ?? null,
    roleRemovedAt: absence.roleRemovedAt?.toISOString?.() ?? null,
    approvedAt: absence.approvedAt?.toISOString?.() ?? null,
    rejectedAt: absence.rejectedAt?.toISOString?.() ?? null,
    startedAt: absence.startedAt?.toISOString?.() ?? null,
    finishedAt: absence.finishedAt?.toISOString?.() ?? null,
    closedAt: absence.closedAt?.toISOString?.() ?? null,
    createdAt: absence.createdAt.toISOString(),
    updatedAt: absence.updatedAt.toISOString()
  };
}

function createFacError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}

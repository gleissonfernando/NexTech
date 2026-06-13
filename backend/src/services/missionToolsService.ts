import { randomUUID } from "node:crypto";
import { ensureGuild, getMongoCollections, type MongoMissionToolMission, type MongoMissionToolParticipant, type MongoMissionToolStatus, type MongoMissionToolsMessages, type MongoMissionToolsSettings } from "../database/mongo";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoom } from "../realtime/events";
import { createLog } from "./logService";

export type MissionToolsSettingsDto = {
  id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  panelChannelId: string | null;
  panelMessageId: string | null;
  logChannelId: string | null;
  managerRoleIds: string[];
  participantRoleIds: string[];
  completionRoleId: string | null;
  messages: MongoMissionToolsMessages;
  lastPanelRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MissionToolParticipantDto = {
  userId: string;
  username: string | null;
  joinedAt: string;
  leftAt: string | null;
};

export type MissionToolMissionDto = {
  id: string;
  botId: string;
  guildId: string;
  title: string;
  description: string | null;
  status: MongoMissionToolStatus;
  participantLimit: number;
  participants: MissionToolParticipantDto[];
  activeParticipantCount: number;
  createdBy: string | null;
  startedBy: string | null;
  completedBy: string | null;
  cancelledBy: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
};

export type MissionToolsStatsDto = {
  activeParticipants: number;
  completedMissions: number;
  openMissions: number;
  totalMissions: number;
};

export type MissionToolsDashboardDto = {
  activeMission: MissionToolMissionDto | null;
  missions: MissionToolMissionDto[];
  settings: MissionToolsSettingsDto;
  stats: MissionToolsStatsDto;
};

export type SaveMissionToolsSettingsInput = {
  enabled?: boolean;
  panelChannelId?: string | null;
  logChannelId?: string | null;
  managerRoleIds?: string[];
  participantRoleIds?: string[];
  completionRoleId?: string | null;
  messages?: Partial<MongoMissionToolsMessages>;
};

export type CreateMissionToolMissionInput = {
  botId: string;
  guildId: string;
  title: string;
  description?: string | null;
  participantLimit?: number | null;
  createdBy?: string | null;
};

export type MissionToolActorInput = {
  actorId: string;
  actorRoleIds?: string[];
  skipManagerCheck?: boolean;
  username?: string | null;
};

const MODULE_ID = "mission-tools";
const ACTIVE_MISSION_STATUSES: MongoMissionToolStatus[] = ["open", "running"];
const DEFAULT_MESSAGES: MongoMissionToolsMessages = {
  panelTitle: "Mission Tools",
  panelDescription: "Entre na missao ativa, acompanhe a fila e veja o status pelo painel.",
  joinSuccess: "Voce entrou na missao.",
  leaveSuccess: "Voce saiu da missao.",
  missionStarted: "A missao foi iniciada.",
  missionCompleted: "A missao foi concluida."
};

export function defaultMissionToolsSettings(botId: string, guildId: string): MissionToolsSettingsDto {
  const now = new Date().toISOString();

  return {
    id: "",
    botId,
    guildId,
    enabled: false,
    panelChannelId: null,
    panelMessageId: null,
    logChannelId: null,
    managerRoleIds: [],
    participantRoleIds: [],
    completionRoleId: null,
    messages: DEFAULT_MESSAGES,
    lastPanelRequestedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

export async function getMissionToolsDashboard(guildId: string, botId: string): Promise<MissionToolsDashboardDto> {
  const { missionToolsMissions } = await getMongoCollections();
  const [settings, missions, stats] = await Promise.all([
    getMissionToolsSettings(guildId, botId),
    missionToolsMissions
      .find({ botId, guildId })
      .sort({ updatedAt: -1 })
      .limit(50)
      .toArray(),
    missionToolsStats(botId, guildId)
  ]);
  const missionDtos = missions.map(toMissionDto);

  return {
    activeMission: missionDtos.find((mission) => ACTIVE_MISSION_STATUSES.includes(mission.status)) ?? null,
    missions: missionDtos,
    settings,
    stats
  };
}

export async function getMissionToolsSettings(guildId: string, botId: string): Promise<MissionToolsSettingsDto> {
  const { missionToolsSettings } = await getMongoCollections();
  const settings = await missionToolsSettings.findOne({ botId, guildId });

  return settings ? toSettingsDto(settings) : defaultMissionToolsSettings(botId, guildId);
}

export async function listActiveMissionToolsSettings(botId: string | null) {
  const { missionToolsSettings } = await getMongoCollections();
  const settings = await missionToolsSettings
    .find({
      enabled: true,
      ...(botId ? { botId } : {})
    })
    .sort({ updatedAt: -1 })
    .toArray();

  return settings.map(toSettingsDto);
}

export async function saveMissionToolsSettings(guildId: string, botId: string, input: SaveMissionToolsSettingsInput, actorId: string | null) {
  const { missionToolsSettings } = await getMongoCollections();
  const current = await getMissionToolsSettings(guildId, botId);
  const now = new Date();
  const next = {
    enabled: input.enabled ?? current.enabled,
    panelChannelId: normalizeNullableSnowflake(input.panelChannelId, current.panelChannelId),
    logChannelId: normalizeNullableSnowflake(input.logChannelId, current.logChannelId),
    managerRoleIds: input.managerRoleIds ? normalizeSnowflakes(input.managerRoleIds) : current.managerRoleIds,
    participantRoleIds: input.participantRoleIds ? normalizeSnowflakes(input.participantRoleIds) : current.participantRoleIds,
    completionRoleId: normalizeNullableSnowflake(input.completionRoleId, current.completionRoleId),
    messages: normalizeMessages({
      ...current.messages,
      ...(input.messages ?? {})
    })
  };

  await ensureGuild(guildId);
  await missionToolsSettings.updateOne(
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

  const saved = await getMissionToolsSettings(guildId, botId);
  const log = await createMissionLog({
    botId,
    guildId,
    type: "mission_tools.settings_updated",
    userId: actorId,
    message: "Mission Tools atualizado.",
    metadata: {
      action: "settings_updated",
      changedKeys: Object.keys(input),
      module: MODULE_ID,
      status: saved.enabled ? "enabled" : "disabled"
    }
  });

  emitMissionSettings(saved);
  if (saved.enabled && saved.panelChannelId && saved.panelMessageId) {
    emitMissionPanelPublish(saved);
  }
  if (log) {
    emitRealtime("logs:new", log);
  }

  return saved;
}

export async function requestMissionToolsPanelPublish(guildId: string, botId: string, actorId: string | null) {
  const { missionToolsSettings } = await getMongoCollections();
  const settings = await getMissionToolsSettings(guildId, botId);

  validateSettingsReady(settings);

  const requestedAt = new Date();
  await missionToolsSettings.updateOne(
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

  const nextSettings = await getMissionToolsSettings(guildId, botId);
  emitMissionPanelPublish(nextSettings);

  await createMissionLog({
    botId,
    guildId,
    type: "mission_tools.panel_publish_requested",
    userId: actorId,
    message: "Publicacao do painel Mission Tools solicitada.",
    metadata: {
      action: "panel_publish_requested",
      module: MODULE_ID,
      panelChannelId: nextSettings.panelChannelId
    }
  });

  return nextSettings;
}

export async function updateMissionToolsPanelMessageState(botId: string, guildId: string, messageId: string | null) {
  const { missionToolsSettings } = await getMongoCollections();
  const now = new Date();

  await missionToolsSettings.updateOne(
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

  return getMissionToolsSettings(guildId, botId);
}

export async function createMissionToolMission(input: CreateMissionToolMissionInput) {
  const settings = await getMissionToolsSettings(input.guildId, input.botId);

  validateSettingsReady(settings);
  await assertNoActiveMission(input.botId, input.guildId);

  const { missionToolsMissions } = await getMongoCollections();
  const now = new Date();
  const mission: MongoMissionToolMission = {
    _id: randomUUID(),
    botId: input.botId,
    guildId: input.guildId,
    title: normalizeRequiredText(input.title, 120, "Informe o titulo da missao."),
    description: normalizeShortText(input.description, 1000),
    status: "open",
    participantLimit: normalizeParticipantLimit(input.participantLimit),
    participants: [],
    createdBy: input.createdBy ?? null,
    startedBy: null,
    completedBy: null,
    cancelledBy: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    updatedAt: now
  };

  await missionToolsMissions.insertOne(mission);
  const dto = toMissionDto(mission);
  const log = await createMissionLog({
    botId: input.botId,
    guildId: input.guildId,
    type: "mission_tools.mission_created",
    userId: input.createdBy ?? null,
    message: "Missao criada no Mission Tools.",
    metadata: missionMetadata(dto, {
      action: "mission_created",
      module: MODULE_ID
    })
  });

  emitMissionUpdated("created", dto, log);
  return dto;
}

export async function getMissionToolMission(missionId: string, botId: string) {
  const { missionToolsMissions } = await getMongoCollections();
  const mission = await missionToolsMissions.findOne({ _id: missionId, botId });

  return mission ? toMissionDto(mission) : null;
}

export async function getActiveMissionToolMission(guildId: string, botId: string) {
  const { missionToolsMissions } = await getMongoCollections();
  const mission = await missionToolsMissions.findOne({
    botId,
    guildId,
    status: {
      $in: ACTIVE_MISSION_STATUSES
    }
  });

  return mission ? toMissionDto(mission) : null;
}

export async function joinMissionToolMission(missionId: string, botId: string, actor: MissionToolActorInput) {
  const mission = await getMissionDocument(missionId, botId);
  const settings = await getMissionToolsSettings(mission.guildId, botId);

  validateSettingsReady(settings);
  ensureParticipantAllowed(settings, actor.actorRoleIds ?? []);

  if (!ACTIVE_MISSION_STATUSES.includes(mission.status)) {
    throw createMissionError("Esta missao nao esta aberta para entrada.", 409);
  }

  const now = new Date();
  const activeParticipants = mission.participants.filter((participant) => !participant.leftAt);
  const existingIndex = mission.participants.findIndex((participant) => participant.userId === actor.actorId);

  if (existingIndex >= 0 && !mission.participants[existingIndex]?.leftAt) {
    return toMissionDto(mission);
  }

  if (mission.participantLimit > 0 && activeParticipants.length >= mission.participantLimit) {
    throw createMissionError("A missao atingiu o limite de participantes.", 409);
  }

  const participants = [...mission.participants];
  const participant: MongoMissionToolParticipant = {
    userId: actor.actorId,
    username: normalizeShortText(actor.username, 100),
    joinedAt: now,
    leftAt: null
  };

  if (existingIndex >= 0) {
    participants[existingIndex] = participant;
  } else {
    participants.push(participant);
  }

  const updated = await updateMissionParticipants(mission, participants, now);
  const dto = toMissionDto(updated);
  const log = await createMissionLog({
    botId,
    guildId: dto.guildId,
    type: "mission_tools.participant_joined",
    userId: actor.actorId,
    message: "Participante entrou na missao.",
    metadata: missionMetadata(dto, {
      action: "participant_joined",
      module: MODULE_ID
    })
  });

  emitMissionUpdated("participant_joined", dto, log);
  return dto;
}

export async function leaveMissionToolMission(missionId: string, botId: string, actor: MissionToolActorInput) {
  const mission = await getMissionDocument(missionId, botId);

  if (!ACTIVE_MISSION_STATUSES.includes(mission.status)) {
    throw createMissionError("Esta missao nao aceita mais saidas.", 409);
  }

  const now = new Date();
  const participants = mission.participants.map((participant) => (
    participant.userId === actor.actorId && !participant.leftAt
      ? {
          ...participant,
          leftAt: now
        }
      : participant
  ));

  const updated = await updateMissionParticipants(mission, participants, now);
  const dto = toMissionDto(updated);
  const log = await createMissionLog({
    botId,
    guildId: dto.guildId,
    type: "mission_tools.participant_left",
    userId: actor.actorId,
    message: "Participante saiu da missao.",
    metadata: missionMetadata(dto, {
      action: "participant_left",
      module: MODULE_ID
    })
  });

  emitMissionUpdated("participant_left", dto, log);
  return dto;
}

export async function startMissionToolMission(missionId: string, botId: string, actor: MissionToolActorInput) {
  const mission = await getMissionDocument(missionId, botId);
  const settings = await getMissionToolsSettings(mission.guildId, botId);

  if (!actor.skipManagerCheck) {
    ensureManagerAllowed(settings, actor.actorRoleIds ?? []);
  }

  if (mission.status !== "open" && mission.status !== "running") {
    throw createMissionError("Esta missao nao pode ser iniciada.", 409);
  }

  return updateMissionStatus(mission, botId, "running", actor.actorId, "mission_tools.mission_started", "Missao iniciada.");
}

export async function completeMissionToolMission(missionId: string, botId: string, actor: MissionToolActorInput) {
  const mission = await getMissionDocument(missionId, botId);
  const settings = await getMissionToolsSettings(mission.guildId, botId);

  if (!actor.skipManagerCheck) {
    ensureManagerAllowed(settings, actor.actorRoleIds ?? []);
  }

  if (mission.status !== "open" && mission.status !== "running") {
    throw createMissionError("Esta missao nao pode ser concluida.", 409);
  }

  return updateMissionStatus(mission, botId, "completed", actor.actorId, "mission_tools.mission_completed", "Missao concluida.");
}

export async function cancelMissionToolMission(missionId: string, botId: string, actor: MissionToolActorInput) {
  const mission = await getMissionDocument(missionId, botId);
  const settings = await getMissionToolsSettings(mission.guildId, botId);

  if (!actor.skipManagerCheck) {
    ensureManagerAllowed(settings, actor.actorRoleIds ?? []);
  }

  if (mission.status === "completed" || mission.status === "cancelled") {
    return toMissionDto(mission);
  }

  return updateMissionStatus(mission, botId, "cancelled", actor.actorId, "mission_tools.mission_cancelled", "Missao cancelada.");
}

async function missionToolsStats(botId: string, guildId: string): Promise<MissionToolsStatsDto> {
  const { missionToolsMissions } = await getMongoCollections();
  const missions = await missionToolsMissions
    .find({ botId, guildId })
    .project<Pick<MongoMissionToolMission, "status" | "participants">>({
      status: 1,
      participants: 1
    })
    .toArray();
  const active = missions.filter((mission) => ACTIVE_MISSION_STATUSES.includes(mission.status));

  return {
    activeParticipants: active.reduce((total, mission) => total + activeParticipantCount(mission.participants ?? []), 0),
    completedMissions: missions.filter((mission) => mission.status === "completed").length,
    openMissions: active.length,
    totalMissions: missions.length
  };
}

async function assertNoActiveMission(botId: string, guildId: string) {
  const active = await getActiveMissionToolMission(guildId, botId);

  if (active) {
    throw createMissionError("Ja existe uma missao aberta ou em andamento.", 409);
  }
}

async function getMissionDocument(missionId: string, botId: string) {
  const { missionToolsMissions } = await getMongoCollections();
  const mission = await missionToolsMissions.findOne({ _id: missionId, botId });

  if (!mission) {
    throw createMissionError("Missao nao encontrada.", 404);
  }

  return mission;
}

async function updateMissionParticipants(mission: MongoMissionToolMission, participants: MongoMissionToolParticipant[], updatedAt: Date) {
  const { missionToolsMissions } = await getMongoCollections();

  await missionToolsMissions.updateOne(
    {
      _id: mission._id,
      botId: mission.botId
    },
    {
      $set: {
        participants,
        updatedAt
      }
    }
  );

  const updated = await missionToolsMissions.findOne({ _id: mission._id, botId: mission.botId });

  if (!updated) {
    throw createMissionError("Missao nao encontrada apos atualizar participantes.", 404);
  }

  return updated;
}

async function updateMissionStatus(
  mission: MongoMissionToolMission,
  botId: string,
  status: MongoMissionToolStatus,
  actorId: string,
  logType: string,
  logMessage: string
) {
  const { missionToolsMissions } = await getMongoCollections();
  const now = new Date();
  const set: Partial<MongoMissionToolMission> = {
    status,
    updatedAt: now
  };

  if (status === "running") {
    set.startedAt = mission.startedAt ?? now;
    set.startedBy = actorId;
  }

  if (status === "completed") {
    set.completedAt = mission.completedAt ?? now;
    set.completedBy = actorId;
  }

  if (status === "cancelled") {
    set.cancelledAt = mission.cancelledAt ?? now;
    set.cancelledBy = actorId;
  }

  await missionToolsMissions.updateOne(
    {
      _id: mission._id,
      botId
    },
    {
      $set: set
    }
  );

  const updated = await getMissionDocument(mission._id, botId);
  const dto = toMissionDto(updated);
  const log = await createMissionLog({
    botId,
    guildId: dto.guildId,
    type: logType,
    userId: actorId,
    message: logMessage,
    metadata: missionMetadata(dto, {
      action: status,
      module: MODULE_ID
    })
  });

  emitMissionUpdated(status, dto, log);
  return dto;
}

function validateSettingsReady(settings: MissionToolsSettingsDto) {
  if (!settings.enabled) {
    throw createMissionError("O Mission Tools nao esta ativo na dashboard.", 403);
  }

  if (!settings.panelChannelId) {
    throw createMissionError("Configure o canal do painel antes de usar o Mission Tools.", 400);
  }
}

function ensureParticipantAllowed(settings: MissionToolsSettingsDto, roleIds: string[]) {
  if (!settings.participantRoleIds.length) {
    return;
  }

  const allowed = new Set(settings.participantRoleIds);

  if (!roleIds.some((roleId) => allowed.has(roleId))) {
    throw createMissionError("Voce nao possui cargo autorizado para entrar nesta missao.", 403);
  }
}

function ensureManagerAllowed(settings: MissionToolsSettingsDto, roleIds: string[]) {
  if (!settings.managerRoleIds.length) {
    return;
  }

  const allowed = new Set(settings.managerRoleIds);

  if (!roleIds.some((roleId) => allowed.has(roleId))) {
    throw createMissionError("Voce nao possui cargo autorizado para gerenciar missoes.", 403);
  }
}

function normalizeMessages(messages: Partial<MongoMissionToolsMessages>): MongoMissionToolsMessages {
  return {
    panelTitle: normalizeMessage(messages.panelTitle, DEFAULT_MESSAGES.panelTitle, 120),
    panelDescription: normalizeMessage(messages.panelDescription, DEFAULT_MESSAGES.panelDescription, 1000),
    joinSuccess: normalizeMessage(messages.joinSuccess, DEFAULT_MESSAGES.joinSuccess, 500),
    leaveSuccess: normalizeMessage(messages.leaveSuccess, DEFAULT_MESSAGES.leaveSuccess, 500),
    missionStarted: normalizeMessage(messages.missionStarted, DEFAULT_MESSAGES.missionStarted, 500),
    missionCompleted: normalizeMessage(messages.missionCompleted, DEFAULT_MESSAGES.missionCompleted, 500)
  };
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
    throw createMissionError(message, 400);
  }

  const normalized = value.trim();

  if (!normalized) {
    throw createMissionError(message, 400);
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

  throw createMissionError("Um dos IDs informados nao e valido.", 400);
}

function normalizeSnowflakes(values: string[]) {
  return [...new Set(values.map((value) => normalizeNullableSnowflake(value, null)).filter((value): value is string => Boolean(value)))];
}

function normalizeParticipantLimit(value: number | null | undefined) {
  const normalized = Number(value ?? 0);

  if (!Number.isFinite(normalized)) {
    return 0;
  }

  return Math.max(0, Math.min(500, Math.trunc(normalized)));
}

function activeParticipantCount(participants: MongoMissionToolParticipant[]) {
  return participants.filter((participant) => !participant.leftAt).length;
}

function missionMetadata(mission: MissionToolMissionDto, extra: Record<string, unknown>) {
  return {
    activeParticipantCount: mission.activeParticipantCount,
    missionId: mission.id,
    status: mission.status,
    title: mission.title,
    ...extra
  };
}

async function createMissionLog(input: Parameters<typeof createLog>[0]) {
  return createLog(input).catch((error) => {
    console.warn("[mission-tools] nao foi possivel registrar log:", error instanceof Error ? error.message : error);
    return null;
  });
}

function emitMissionSettings(settings: MissionToolsSettingsDto) {
  const payload = {
    botId: settings.botId,
    guildId: settings.guildId,
    settings
  };

  emitRealtime("mission-tools:settings_updated", payload);
  emitRealtimeToRoom(devBotRealtimeRoom(settings.botId), "mission-tools:settings_updated", payload);
}

function emitMissionPanelPublish(settings: MissionToolsSettingsDto) {
  const payload = {
    botId: settings.botId,
    guildId: settings.guildId,
    settings
  };

  emitRealtimeToRoom(devBotRealtimeRoom(settings.botId), "mission-tools:panel_publish", payload);
}

function emitMissionUpdated(action: string, mission: MissionToolMissionDto, log: Awaited<ReturnType<typeof createMissionLog>>) {
  const payload = {
    action,
    botId: mission.botId,
    guildId: mission.guildId,
    mission
  };

  emitRealtime("mission-tools:mission_updated", payload);
  emitRealtimeToRoom(devBotRealtimeRoom(mission.botId), "mission-tools:mission_updated", payload);

  if (log) {
    emitRealtime("logs:new", log);
  }
}

function toSettingsDto(settings: MongoMissionToolsSettings): MissionToolsSettingsDto {
  return {
    id: settings._id,
    botId: settings.botId,
    guildId: settings.guildId,
    enabled: settings.enabled === true,
    panelChannelId: settings.panelChannelId ?? null,
    panelMessageId: settings.panelMessageId ?? null,
    logChannelId: settings.logChannelId ?? null,
    managerRoleIds: normalizeSnowflakes(settings.managerRoleIds ?? []),
    participantRoleIds: normalizeSnowflakes(settings.participantRoleIds ?? []),
    completionRoleId: settings.completionRoleId ?? null,
    messages: normalizeMessages(settings.messages ?? DEFAULT_MESSAGES),
    lastPanelRequestedAt: settings.lastPanelRequestedAt?.toISOString?.() ?? null,
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString()
  };
}

function toMissionDto(mission: MongoMissionToolMission): MissionToolMissionDto {
  const participants = (mission.participants ?? []).map(toParticipantDto);

  return {
    id: mission._id,
    botId: mission.botId,
    guildId: mission.guildId,
    title: mission.title,
    description: mission.description ?? null,
    status: mission.status,
    participantLimit: mission.participantLimit,
    participants,
    activeParticipantCount: participants.filter((participant) => !participant.leftAt).length,
    createdBy: mission.createdBy ?? null,
    startedBy: mission.startedBy ?? null,
    completedBy: mission.completedBy ?? null,
    cancelledBy: mission.cancelledBy ?? null,
    createdAt: mission.createdAt.toISOString(),
    startedAt: mission.startedAt?.toISOString?.() ?? null,
    completedAt: mission.completedAt?.toISOString?.() ?? null,
    cancelledAt: mission.cancelledAt?.toISOString?.() ?? null,
    updatedAt: mission.updatedAt.toISOString()
  };
}

function toParticipantDto(participant: MongoMissionToolParticipant): MissionToolParticipantDto {
  return {
    userId: participant.userId,
    username: participant.username ?? null,
    joinedAt: participant.joinedAt.toISOString(),
    leftAt: participant.leftAt?.toISOString?.() ?? null
  };
}

function createMissionError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}

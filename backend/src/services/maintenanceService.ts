import { randomUUID } from "node:crypto";
import { getMongoCollections, type MongoDevBot, type MongoMaintenanceLog, type MongoMaintenanceState } from "../database/mongo";
import { emitRealtime, emitRealtimeToRoom, devBotRealtimeRoom } from "../realtime/events";

export type MaintenanceAction =
  | "enabled"
  | "disabled"
  | "manual_alert"
  | "global_enabled"
  | "global_disabled"
  | "bot_released"
  | "bot_relocked";

export type MaintenanceBotDto = {
  avatarUrl: string | null;
  id: string;
  maintenance: boolean;
  mainGuildName: string | null;
  name: string;
  released: boolean;
  status: string | null;
  updatedAt: string | null;
};

export type MaintenanceStateDto = {
  active: boolean;
  activatedAt: string | null;
  affectedBots: number;
  botId: string | null;
  botName: string | null;
  bots: MaintenanceBotDto[];
  deactivatedAt: string | null;
  globalActive: boolean;
  logs: MaintenanceLogDto[];
  releasedBotIds: string[];
  updatedAt: string;
  updatedById: string | null;
  updatedByName: string | null;
};

export type MaintenanceLogDto = {
  id: string;
  action: MaintenanceAction;
  active: boolean;
  actorId: string | null;
  actorName: string | null;
  botId: string | null;
  botName: string | null;
  createdAt: string;
  message: string;
};

type MaintenanceCoreState = Omit<MaintenanceStateDto, "affectedBots" | "bots" | "logs">;

const STATE_ID = "global";
const MAINTENANCE_STARTED_MESSAGE = [
  "⚠️ MANUTENÇÃO INICIADA",
  "Este bot entrou em modo de manutenção.",
  "Os serviços deste bot estão temporariamente indisponíveis.",
  "Aguarde a liberação oficial da equipe de desenvolvimento."
].join("\n");

const initialUpdatedAt = new Date(0).toISOString();

let memoryGlobalState: MaintenanceCoreState = {
  active: false,
  activatedAt: null,
  botId: null,
  botName: null,
  deactivatedAt: null,
  globalActive: false,
  releasedBotIds: [],
  updatedAt: initialUpdatedAt,
  updatedById: null,
  updatedByName: null
};
const memoryBotStates = new Map<string, MaintenanceCoreState>();
let memoryLogs: MaintenanceLogDto[] = [];

export async function getMaintenanceState(botId?: string | null): Promise<MaintenanceStateDto> {
  const normalizedBotId = normalizeBotId(botId);

  try {
    const { devBots } = await getMongoCollections();
    const [globalState, botDocs, logs] = await Promise.all([
      readGlobalState(),
      devBots.find({}).sort({ createdAt: -1 }).toArray(),
      listMaintenanceLogs(normalizedBotId)
    ]);
    const bots = botDocs.map((bot) => toMaintenanceBotDto(bot, globalState));
    const state = normalizedBotId
      ? toScopedBotState(normalizedBotId, globalState, botDocs.find((bot) => bot._id === normalizedBotId) ?? null)
      : globalState;

    return withMaintenanceCollections(state, bots, logs);
  } catch (error) {
    console.warn("[maintenance] usando estado em memória:", error instanceof Error ? error.message : error);
    const state = normalizedBotId
      ? memoryBotStates.get(normalizedBotId) ?? defaultState(normalizedBotId, null, memoryGlobalState.active)
      : memoryGlobalState;
    const bots = [...memoryBotStates.values()].map((bot) => ({
      avatarUrl: null,
      id: bot.botId ?? "",
      maintenance: bot.active,
      mainGuildName: null,
      name: bot.botName ?? bot.botId ?? "Bot",
      released: !bot.active,
      status: null,
      updatedAt: bot.updatedAt
    })).filter((bot) => bot.id);
    const logs = normalizedBotId ? memoryLogs.filter((log) => log.botId === normalizedBotId) : memoryLogs;
    return withMaintenanceCollections(state, bots, logs);
  }
}

export async function isMaintenanceActive(botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  if (!normalizedBotId) return false;

  try {
    const globalState = await readGlobalState();

    if (!globalState.active) {
      return false;
    }

    return !globalState.releasedBotIds.includes(normalizedBotId);
  } catch (error) {
    console.warn("[maintenance] falha ao validar estado:", error instanceof Error ? error.message : error);
    return memoryGlobalState.active && memoryBotStates.get(normalizedBotId)?.active !== false;
  }
}

export async function setMaintenanceMode(input: {
  active: boolean;
  actorId?: string | null;
  actorName?: string | null;
  botId?: string | null;
}) {
  const botId = normalizeBotId(input.botId);
  return botId ? setBotMaintenanceMode({ ...input, botId }) : setGlobalMaintenanceMode(input);
}

export async function sendMaintenanceManualAlert(input: {
  actorId?: string | null;
  actorName?: string | null;
  botId: string;
}) {
  const state = await getMaintenanceState(input.botId);

  await appendMaintenanceLog({
    action: "manual_alert",
    active: state.active,
    actorId: input.actorId ?? null,
    actorName: input.actorName ?? null,
    botId: state.botId,
    botName: state.botName,
    message: "Alerta manual de manutenção enviado."
  });

  const dto = await getMaintenanceState(input.botId);
  emitMaintenanceUpdate(dto, "maintenance:manual_alert");
  return dto;
}

export function maintenanceBlockResponse() {
  return {
    code: "MAINTENANCE_MODE",
    message: "❌ Sistema em manutenção\nEste bot está em manutenção no momento.\nAguarde a nossa equipe liberar este bot para realizar novamente."
  };
}

async function setGlobalMaintenanceMode(input: {
  active: boolean;
  actorId?: string | null;
  actorName?: string | null;
}) {
  const now = new Date();
  const actorId = input.actorId ?? null;
  const actorName = input.actorName ?? null;
  const current = await getMaintenanceState();
  const next: MaintenanceCoreState = {
    ...current,
    active: input.active,
    activatedAt: input.active ? current.activatedAt ?? now.toISOString() : current.activatedAt,
    botId: null,
    botName: null,
    deactivatedAt: input.active ? null : now.toISOString(),
    globalActive: input.active,
    releasedBotIds: [],
    updatedAt: now.toISOString(),
    updatedById: actorId,
    updatedByName: actorName
  };
  const action: MaintenanceAction = input.active ? "global_enabled" : "global_disabled";
  const message = input.active
    ? "Modo de manutenção global ativado para todos os bots."
    : "Modo de manutenção global desativado. Todos os bots foram liberados.";

  await persistGlobalState(next, now);
  await setAllBotsMaintenance(input.active, now, actorId, actorName);
  await appendMaintenanceLog({
    action,
    active: next.active,
    actorId,
    actorName,
    botId: null,
    botName: null,
    message
  });

  const dto = await getMaintenanceState();
  emitMaintenanceUpdate(dto, input.active ? "maintenance:started" : "maintenance:ended");
  return dto;
}

async function setBotMaintenanceMode(input: {
  active: boolean;
  actorId?: string | null;
  actorName?: string | null;
  botId: string;
}) {
  const now = new Date();
  const actorId = input.actorId ?? null;
  const actorName = input.actorName ?? null;
  const current = await getMaintenanceState(input.botId);
  const action: MaintenanceAction = input.active ? "bot_relocked" : "bot_released";
  const message = input.active
    ? "Bot colocado novamente em manutenção."
    : "Bot liberado individualmente da manutenção.";
  const next: MaintenanceCoreState = {
    ...current,
    active: input.active,
    activatedAt: input.active ? current.activatedAt ?? now.toISOString() : current.activatedAt,
    deactivatedAt: input.active ? null : now.toISOString(),
    globalActive: current.globalActive,
    updatedAt: now.toISOString(),
    updatedById: actorId,
    updatedByName: actorName
  };

  await persistBotState(input.botId, next, now);
  await appendMaintenanceLog({
    action,
    active: next.active,
    actorId,
    actorName,
    botId: input.botId,
    botName: next.botName,
    message
  });

  const dto = await getMaintenanceState(input.botId);
  emitMaintenanceUpdate(dto, input.active ? "maintenance:started" : "maintenance:ended");
  return dto;
}

function emitMaintenanceUpdate(
  state: MaintenanceStateDto,
  action: MaintenanceAction | "maintenance:started" | "maintenance:ended" | "maintenance:manual_alert"
) {
  const payload = {
    action,
    alertMessage: MAINTENANCE_STARTED_MESSAGE,
    botId: state.botId,
    state
  };

  emitRealtime("maintenance:updated", payload);
  if (state.botId) {
    emitRealtimeToRoom(devBotRealtimeRoom(state.botId), "maintenance:updated", payload);
  }
}

async function readGlobalState(): Promise<MaintenanceCoreState> {
  const { maintenanceState } = await getMongoCollections();
  const doc = await maintenanceState.findOne({ _id: STATE_ID });

  if (!doc) {
    return defaultState(null);
  }

  return toStateDto(doc);
}

async function persistGlobalState(
  state: MaintenanceCoreState,
  now: Date
) {
  memoryGlobalState = state;

  try {
    const { maintenanceState } = await getMongoCollections();
    await maintenanceState.updateOne(
      { _id: STATE_ID },
      {
        $set: {
          active: state.active,
          activatedAt: state.activatedAt ? new Date(state.activatedAt) : null,
          deactivatedAt: state.deactivatedAt ? new Date(state.deactivatedAt) : null,
          releasedBotIds: [],
          updatedAt: now,
          updatedById: state.updatedById,
          updatedByName: state.updatedByName
        }
      },
      { upsert: true }
    );
  } catch (error) {
    console.warn("[maintenance] estado global mantido em memória:", error instanceof Error ? error.message : error);
  }
}

async function setAllBotsMaintenance(active: boolean, now: Date, actorId: string | null, actorName: string | null) {
  const patch = active
    ? {
      maintenance: true,
      maintenanceActivatedAt: now,
      maintenanceDeactivatedAt: null,
      maintenanceUpdatedAt: now,
      maintenanceUpdatedById: actorId,
      maintenanceUpdatedByName: actorName,
      updatedAt: now
    }
    : {
      maintenance: false,
      maintenanceDeactivatedAt: now,
      maintenanceUpdatedAt: now,
      maintenanceUpdatedById: actorId,
      maintenanceUpdatedByName: actorName,
      updatedAt: now
    };

  const { devBots } = await getMongoCollections();
  await devBots.updateMany({}, { $set: patch });
}

async function persistBotState(
  botId: string,
  state: MaintenanceCoreState,
  now: Date
) {
  memoryBotStates.set(botId, state);

  const { devBots, maintenanceState } = await getMongoCollections();
  const currentGlobalState = await readGlobalState().catch(() => defaultState(null));
  const result = await devBots.updateOne(
    { _id: botId },
    {
      $set: {
        maintenance: state.active,
        maintenanceActivatedAt: state.activatedAt ? new Date(state.activatedAt) : null,
        maintenanceDeactivatedAt: state.deactivatedAt ? new Date(state.deactivatedAt) : null,
        maintenanceUpdatedAt: now,
        maintenanceUpdatedById: state.updatedById,
        maintenanceUpdatedByName: state.updatedByName,
        updatedAt: now
      }
    }
  );

  if (!result.matchedCount) {
    throw new Error("Bot não encontrado para atualizar manutenção.");
  }

  const releasedBotIds = state.active
    ? currentGlobalState.releasedBotIds.filter((id) => id !== botId)
    : [...new Set([...currentGlobalState.releasedBotIds, botId])];
  await maintenanceState.updateOne(
    { _id: STATE_ID },
    {
      $set: { releasedBotIds, updatedAt: now, updatedById: state.updatedById, updatedByName: state.updatedByName },
      $setOnInsert: { active: false, activatedAt: null, deactivatedAt: null }
    },
    { upsert: true }
  );
}

async function appendMaintenanceLog(input: Omit<MaintenanceLogDto, "id" | "createdAt">) {
  const log: MaintenanceLogDto = {
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString()
  };

  memoryLogs = [log, ...memoryLogs].slice(0, 25);

  try {
    const { maintenanceLogs } = await getMongoCollections();
    const doc: MongoMaintenanceLog = {
      _id: log.id,
      action: log.action,
      active: log.active,
      actorId: log.actorId,
      actorName: log.actorName,
      botId: log.botId,
      botName: log.botName,
      createdAt: new Date(log.createdAt),
      message: log.message
    };

    await maintenanceLogs.insertOne(doc);
  } catch (error) {
    console.warn("[maintenance] log mantido em memória:", error instanceof Error ? error.message : error);
  }
}

async function listMaintenanceLogs(botId?: string | null) {
  try {
    const { maintenanceLogs } = await getMongoCollections();
    const query = botId ? { $or: [{ botId }, { botId: null }, { botId: { $exists: false } }] } : {};
    const docs = await maintenanceLogs.find(query).sort({ createdAt: -1 }).limit(25).toArray();
    return docs.map(toLogDto);
  } catch {
    return botId ? memoryLogs.filter((log) => log.botId === botId || !log.botId) : memoryLogs;
  }
}

function withMaintenanceCollections(
  state: MaintenanceCoreState,
  bots: MaintenanceBotDto[],
  logs: MaintenanceLogDto[]
): MaintenanceStateDto {
  const releasedBotIds = state.globalActive
    ? bots.filter((bot) => bot.released).map((bot) => bot.id)
    : bots.map((bot) => bot.id);
  return {
    ...state,
    affectedBots: state.globalActive ? bots.filter((bot) => bot.maintenance).length : 0,
    bots,
    logs,
    releasedBotIds
  };
}

function defaultState(
  botId: string | null,
  botName: string | null = null,
  globalActive = false
): MaintenanceCoreState {
  return {
    active: botId ? globalActive : false,
    activatedAt: null,
    botId,
    botName,
    deactivatedAt: null,
    globalActive,
    releasedBotIds: [],
    updatedAt: initialUpdatedAt,
    updatedById: null,
    updatedByName: null
  };
}

function toStateDto(doc: MongoMaintenanceState): MaintenanceCoreState {
  return {
    active: doc.active,
    activatedAt: doc.activatedAt?.toISOString() ?? null,
    botId: null,
    botName: null,
    deactivatedAt: doc.deactivatedAt?.toISOString() ?? null,
    globalActive: doc.active,
    releasedBotIds: doc.releasedBotIds ?? [],
    updatedAt: doc.updatedAt.toISOString(),
    updatedById: doc.updatedById ?? null,
    updatedByName: doc.updatedByName ?? null
  };
}

function toScopedBotState(
  botId: string,
  globalState: MaintenanceCoreState,
  bot: MongoDevBot | null
): MaintenanceCoreState {
  if (!bot) {
    return defaultState(botId, null, globalState.active);
  }

  const active = globalState.active && !globalState.releasedBotIds.includes(bot._id);

  return {
    active,
    activatedAt: active ? dateToIso(bot.maintenanceActivatedAt) ?? globalState.activatedAt : globalState.activatedAt,
    botId: bot._id,
    botName: bot.name,
    deactivatedAt: active ? null : dateToIso(bot.maintenanceDeactivatedAt) ?? globalState.deactivatedAt,
    globalActive: globalState.active,
    releasedBotIds: globalState.releasedBotIds,
    updatedAt: (bot.maintenanceUpdatedAt ?? bot.updatedAt ?? new Date(globalState.updatedAt)).toISOString(),
    updatedById: bot.maintenanceUpdatedById ?? globalState.updatedById,
    updatedByName: bot.maintenanceUpdatedByName ?? globalState.updatedByName
  };
}

function toMaintenanceBotDto(bot: MongoDevBot, globalState: MaintenanceCoreState): MaintenanceBotDto {
  const maintenance = globalState.active && !globalState.releasedBotIds.includes(bot._id);
  return {
    avatarUrl: bot.avatarUrl ?? null,
    id: bot._id,
    maintenance,
    mainGuildName: bot.mainGuildName ?? null,
    name: bot.name,
    released: !maintenance,
    status: bot.status ?? null,
    updatedAt: (bot.maintenanceUpdatedAt ?? bot.updatedAt)?.toISOString?.() ?? null
  };
}

function toLogDto(doc: MongoMaintenanceLog): MaintenanceLogDto {
  return {
    id: doc._id,
    action: doc.action,
    active: doc.active,
    actorId: doc.actorId,
    actorName: doc.actorName,
    botId: doc.botId ?? null,
    botName: doc.botName ?? null,
    createdAt: doc.createdAt.toISOString(),
    message: doc.message
  };
}

function normalizeBotId(botId?: string | null) {
  return typeof botId === "string" && botId.trim() ? botId.trim() : null;
}

function dateToIso(date?: Date | null) {
  return date instanceof Date ? date.toISOString() : null;
}

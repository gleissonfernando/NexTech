import { randomUUID } from "node:crypto";
import { getMongoCollections, type MongoDevBot, type MongoMaintenanceLog, type MongoMaintenanceState } from "../database/mongo";
import { emitRealtime, emitRealtimeToRoom, devBotRealtimeRoom } from "../realtime/events";

export type MaintenanceAction = "enabled" | "disabled" | "manual_alert";

export type MaintenanceStateDto = {
  active: boolean;
  activatedAt: string | null;
  affectedBots: number;
  botId: string | null;
  botName: string | null;
  deactivatedAt: string | null;
  logs: MaintenanceLogDto[];
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

const STATE_ID = "global";
const MAINTENANCE_STARTED_MESSAGE = [
  "⚠️ MANUTENÇÃO INICIADA",
  "Este bot entrou em modo de manutenção.",
  "Os serviços deste bot estão temporariamente indisponíveis.",
  "Aguarde a liberação oficial da equipe de desenvolvimento."
].join("\n");

let memoryState: MaintenanceStateDto = {
  active: false,
  activatedAt: null,
  affectedBots: 0,
  botId: null,
  botName: null,
  deactivatedAt: null,
  logs: [],
  updatedAt: new Date(0).toISOString(),
  updatedById: null,
  updatedByName: null
};

export async function getMaintenanceState(botId?: string | null): Promise<MaintenanceStateDto> {
  const [state, logs, affectedBots] = await Promise.all([
    readPersistedState(botId),
    listMaintenanceLogs(botId),
    countDevBots()
  ]);

  return {
    ...state,
    affectedBots,
    logs
  };
}

export async function isMaintenanceActive(botId?: string | null) {
  if (!botId) return false;
  return (await readPersistedState(botId)).active;
}

export async function setMaintenanceMode(input: {
  active: boolean;
  actorId?: string | null;
  actorName?: string | null;
  botId: string;
}) {
  const current = await getMaintenanceState(input.botId);
  const now = new Date();
  const actorId = input.actorId ?? null;
  const actorName = input.actorName ?? null;
  const next: MaintenanceStateDto = {
    ...current,
    active: input.active,
    activatedAt: input.active ? current.activatedAt ?? now.toISOString() : current.activatedAt,
    deactivatedAt: input.active ? null : now.toISOString(),
    updatedAt: now.toISOString(),
    updatedById: actorId,
    updatedByName: actorName
  };
  const action: MaintenanceAction = input.active ? "enabled" : "disabled";
  const message = input.active ? "Modo de manutenção do bot ativado." : "Modo de manutenção do bot desativado.";

  await persistState(next);
  await appendMaintenanceLog({
    action,
    active: next.active,
    actorId,
    actorName,
    botId: next.botId,
    botName: next.botName,
    message
  });

  const dto = await getMaintenanceState(input.botId);
  emitMaintenanceUpdate(dto, input.active ? "maintenance:started" : "maintenance:ended");
  return dto;
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
    message: "❌ Sistema em manutenção\nOs bots estão em manutenção no momento.\nAguarde a nossa equipe finalizar a manutenção para realizar novamente."
  };
}

function emitMaintenanceUpdate(state: MaintenanceStateDto, action: MaintenanceAction | "maintenance:started" | "maintenance:ended" | "maintenance:manual_alert") {
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

async function readPersistedState(botId?: string | null): Promise<Omit<MaintenanceStateDto, "affectedBots" | "logs">> {
  try {
    const { devBots, maintenanceState } = await getMongoCollections();
    if (botId) {
      const bot = await devBots.findOne({ _id: botId });
      if (!bot) return defaultState(botId);
      return toBotStateDto(bot);
    }

    const doc = await maintenanceState.findOne({ _id: STATE_ID });

    if (!doc) {
      return defaultState(null);
    }

    return toStateDto(doc);
  } catch (error) {
    console.warn("[maintenance] usando estado em memória:", error instanceof Error ? error.message : error);
    return botId ? defaultState(botId) : memoryState;
  }
}

async function persistState(state: MaintenanceStateDto) {
  memoryState = state;

  try {
    const { devBots, maintenanceState } = await getMongoCollections();
    if (state.botId) {
      const result = await devBots.updateOne(
        { _id: state.botId },
        {
          $set: {
            maintenance: state.active,
            maintenanceActivatedAt: state.activatedAt ? new Date(state.activatedAt) : null,
            maintenanceDeactivatedAt: state.deactivatedAt ? new Date(state.deactivatedAt) : null,
            maintenanceUpdatedAt: new Date(state.updatedAt),
            maintenanceUpdatedById: state.updatedById,
            maintenanceUpdatedByName: state.updatedByName,
            updatedAt: new Date(state.updatedAt)
          }
        }
      );
      if (!result.matchedCount) {
        throw new Error("Bot não encontrado para atualizar manutenção.");
      }
      return;
    }

    await maintenanceState.updateOne(
      { _id: STATE_ID },
      {
        $set: {
          active: state.active,
          activatedAt: state.activatedAt ? new Date(state.activatedAt) : null,
          deactivatedAt: state.deactivatedAt ? new Date(state.deactivatedAt) : null,
          updatedAt: new Date(state.updatedAt),
          updatedById: state.updatedById,
          updatedByName: state.updatedByName
        }
      },
      { upsert: true }
    );
  } catch (error) {
    if (state.botId) {
      throw error;
    }
    console.warn("[maintenance] estado mantido em memória:", error instanceof Error ? error.message : error);
  }
}

async function appendMaintenanceLog(input: Omit<MaintenanceLogDto, "id" | "createdAt">) {
  const log: MaintenanceLogDto = {
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString()
  };

  memoryState = {
    ...memoryState,
    logs: [log, ...memoryState.logs].slice(0, 25)
  };

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
    const docs = await maintenanceLogs.find(botId ? { botId } : {}).sort({ createdAt: -1 }).limit(25).toArray();
    return docs.map(toLogDto);
  } catch {
    return botId ? memoryState.logs.filter((log) => log.botId === botId) : memoryState.logs;
  }
}

async function countDevBots() {
  try {
    const { devBots } = await getMongoCollections();
    return await devBots.countDocuments({ maintenance: true });
  } catch {
    return 0;
  }
}

function defaultState(botId: string | null, botName: string | null = null): Omit<MaintenanceStateDto, "affectedBots" | "logs"> {
  return {
    active: false,
    activatedAt: null,
    botId,
    botName,
    deactivatedAt: null,
    updatedAt: new Date(0).toISOString(),
    updatedById: null,
    updatedByName: null
  };
}

function toStateDto(doc: MongoMaintenanceState): Omit<MaintenanceStateDto, "affectedBots" | "logs"> {
  return {
    active: doc.active,
    activatedAt: doc.activatedAt?.toISOString() ?? null,
    botId: null,
    botName: null,
    deactivatedAt: doc.deactivatedAt?.toISOString() ?? null,
    updatedAt: doc.updatedAt.toISOString(),
    updatedById: doc.updatedById ?? null,
    updatedByName: doc.updatedByName ?? null
  };
}

function toBotStateDto(bot: MongoDevBot): Omit<MaintenanceStateDto, "affectedBots" | "logs"> {
  return {
    active: bot.maintenance === true,
    activatedAt: bot.maintenanceActivatedAt?.toISOString() ?? null,
    botId: bot._id,
    botName: bot.name,
    deactivatedAt: bot.maintenanceDeactivatedAt?.toISOString() ?? null,
    updatedAt: (bot.maintenanceUpdatedAt ?? bot.updatedAt ?? new Date(0)).toISOString(),
    updatedById: bot.maintenanceUpdatedById ?? null,
    updatedByName: bot.maintenanceUpdatedByName ?? null
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

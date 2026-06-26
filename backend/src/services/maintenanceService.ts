import { randomUUID } from "node:crypto";
import { getMongoCollections, type MongoMaintenanceLog, type MongoMaintenanceState } from "../database/mongo";
import { emitRealtime, emitRealtimeToRoom, botRealtimeRoom } from "../realtime/events";

export type MaintenanceAction = "enabled" | "disabled" | "manual_alert";

export type MaintenanceStateDto = {
  active: boolean;
  activatedAt: string | null;
  affectedBots: number;
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
  createdAt: string;
  message: string;
};

const STATE_ID = "global";
const MAINTENANCE_STARTED_MESSAGE = [
  "⚠️ MANUTENÇÃO INICIADA",
  "O sistema entrou em modo de manutenção global.",
  "Todos os serviços estão temporariamente indisponíveis.",
  "Aguarde a liberação oficial da equipe de desenvolvimento."
].join("\n");

let memoryState: MaintenanceStateDto = {
  active: false,
  activatedAt: null,
  affectedBots: 0,
  deactivatedAt: null,
  logs: [],
  updatedAt: new Date(0).toISOString(),
  updatedById: null,
  updatedByName: null
};

export async function getMaintenanceState(): Promise<MaintenanceStateDto> {
  const [state, logs, affectedBots] = await Promise.all([
    readPersistedState(),
    listMaintenanceLogs(),
    countDevBots()
  ]);

  return {
    ...state,
    affectedBots,
    logs
  };
}

export async function isMaintenanceActive() {
  return (await readPersistedState()).active;
}

export async function setMaintenanceMode(input: {
  active: boolean;
  actorId?: string | null;
  actorName?: string | null;
}) {
  const current = await getMaintenanceState();
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
  const message = input.active ? "Modo de manutenção global ativado." : "Modo de manutenção global desativado.";

  await persistState(next);
  await appendMaintenanceLog({
    action,
    active: next.active,
    actorId,
    actorName,
    message
  });

  const dto = await getMaintenanceState();
  emitMaintenanceUpdate(dto, input.active ? "maintenance:started" : "maintenance:ended");
  return dto;
}

export async function sendMaintenanceManualAlert(input: {
  actorId?: string | null;
  actorName?: string | null;
}) {
  const state = await getMaintenanceState();

  await appendMaintenanceLog({
    action: "manual_alert",
    active: state.active,
    actorId: input.actorId ?? null,
    actorName: input.actorName ?? null,
    message: "Alerta manual de manutenção enviado."
  });

  const dto = await getMaintenanceState();
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
    state
  };

  emitRealtime("maintenance:updated", payload);
  emitRealtimeToRoom(botRealtimeRoom(), "maintenance:updated", payload);
}

async function readPersistedState(): Promise<Omit<MaintenanceStateDto, "affectedBots" | "logs">> {
  try {
    const { maintenanceState } = await getMongoCollections();
    const doc = await maintenanceState.findOne({ _id: STATE_ID });

    if (!doc) {
      return {
        active: false,
        activatedAt: null,
        deactivatedAt: null,
        updatedAt: new Date(0).toISOString(),
        updatedById: null,
        updatedByName: null
      };
    }

    return toStateDto(doc);
  } catch (error) {
    console.warn("[maintenance] usando estado em memória:", error instanceof Error ? error.message : error);
    return memoryState;
  }
}

async function persistState(state: MaintenanceStateDto) {
  memoryState = state;

  try {
    const { maintenanceState } = await getMongoCollections();
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
      createdAt: new Date(log.createdAt),
      message: log.message
    };

    await maintenanceLogs.insertOne(doc);
  } catch (error) {
    console.warn("[maintenance] log mantido em memória:", error instanceof Error ? error.message : error);
  }
}

async function listMaintenanceLogs() {
  try {
    const { maintenanceLogs } = await getMongoCollections();
    const docs = await maintenanceLogs.find({}).sort({ createdAt: -1 }).limit(25).toArray();
    return docs.map(toLogDto);
  } catch {
    return memoryState.logs;
  }
}

async function countDevBots() {
  try {
    const { devBots } = await getMongoCollections();
    return await devBots.countDocuments({});
  } catch {
    return 0;
  }
}

function toStateDto(doc: MongoMaintenanceState): Omit<MaintenanceStateDto, "affectedBots" | "logs"> {
  return {
    active: doc.active,
    activatedAt: doc.activatedAt?.toISOString() ?? null,
    deactivatedAt: doc.deactivatedAt?.toISOString() ?? null,
    updatedAt: doc.updatedAt.toISOString(),
    updatedById: doc.updatedById ?? null,
    updatedByName: doc.updatedByName ?? null
  };
}

function toLogDto(doc: MongoMaintenanceLog): MaintenanceLogDto {
  return {
    id: doc._id,
    action: doc.action,
    active: doc.active,
    actorId: doc.actorId,
    actorName: doc.actorName,
    createdAt: doc.createdAt.toISOString(),
    message: doc.message
  };
}

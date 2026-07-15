import { randomUUID } from "node:crypto";
import {
  getMongoCollections,
  type MongoFivemActionArchitecture,
  type MongoFivemActionDefinition,
  type MongoFivemActionMode,
  type MongoFivemActionParticipant,
  type MongoFivemActionSettings
} from "../database/mongo";
import { dashboardLogRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";

export const FIVEM_ACTIONS_MODULE_ID = "fivem-actions";
export const POLICE_ACTIONS_MODULE_ID = "police-actions";

export type ActionSettingsInput = Partial<Pick<MongoFivemActionSettings,
  "enabled" | "categoryId" | "panelChannelId" | "actionChannelId" | "reportChannelId" |
  "panelTitle" | "panelDescription" | "color" | "imageUrl" | "imagePosition"
>>;

export type ActionDefinitionInput = Partial<Pick<MongoFivemActionDefinition,
  "name" | "description" | "emoji" | "imageUrl" | "color" | "maxParticipants" | "enabled" | "order"
>>;

export async function getFivemActionDashboard(botId: string, guildId: string, architecture: MongoFivemActionArchitecture) {
  const { fivemActionDefinitions, fivemActionSessions } = await getMongoCollections();
  const [settings, actions, history] = await Promise.all([
    getFivemActionSettings(botId, guildId, architecture),
    fivemActionDefinitions.find({ botId, guildId, architecture }).sort({ order: 1, createdAt: 1 }).toArray(),
    fivemActionSessions.find({ botId, guildId, architecture }).sort({ createdAt: -1 }).limit(100).toArray()
  ]);
  return { settings: settingsDto(settings), actions: actions.map(actionDto), history: history.map(sessionDto) };
}

export async function getFivemActionSettings(botId: string, guildId: string, architecture: MongoFivemActionArchitecture) {
  const { fivemActionSettings } = await getMongoCollections();
  const existing = await fivemActionSettings.findOne({ botId, guildId, architecture });
  if (existing) return existing;
  const now = new Date();
  const settings: MongoFivemActionSettings = {
    _id: randomUUID(), botId, guildId, architecture, enabled: false, categoryId: null,
    panelChannelId: null, actionChannelId: null, reportChannelId: null, panelMessageId: null,
    panelTitle: architecture === "fac" ? "Ações da FAC" : "Operações da Polícia",
    panelDescription: "Escolha uma ação no menu abaixo para iniciar.", color: "#7c3aed",
    imageUrl: null, imagePosition: "none", lastPanelRequestedAt: null,
    createdAt: now, updatedAt: now, updatedBy: null
  };
  await fivemActionSettings.updateOne({ botId, guildId, architecture }, { $setOnInsert: settings }, { upsert: true });
  return (await fivemActionSettings.findOne({ botId, guildId, architecture })) ?? settings;
}

export async function saveFivemActionSettings(botId: string, guildId: string, architecture: MongoFivemActionArchitecture, input: ActionSettingsInput, actorId: string | null) {
  const current = await getFivemActionSettings(botId, guildId, architecture);
  const { fivemActionSettings } = await getMongoCollections();
  const now = new Date();
  const shouldRefreshPanel = current.enabled && Boolean(current.panelMessageId);
  await fivemActionSettings.updateOne(
    { botId, guildId, architecture },
    { $set: { ...input, ...(shouldRefreshPanel ? { lastPanelRequestedAt: now } : {}), updatedAt: now, updatedBy: actorId } }
  );
  const saved = settingsDto((await fivemActionSettings.findOne({ botId, guildId, architecture }))!);
  emitActionUpdated(botId, guildId, architecture, "settings");
  return saved;
}

export async function requestFivemActionPanel(botId: string, guildId: string, architecture: MongoFivemActionArchitecture, actorId: string) {
  return saveFivemActionSettings(botId, guildId, architecture, { enabled: true, lastPanelRequestedAt: new Date() } as ActionSettingsInput, actorId);
}

export async function updateFivemActionPanelState(botId: string, guildId: string, architecture: MongoFivemActionArchitecture, panelMessageId: string | null) {
  return saveFivemActionSettings(botId, guildId, architecture, { panelMessageId } as ActionSettingsInput, null);
}

export async function saveFivemActionDefinition(botId: string, guildId: string, architecture: MongoFivemActionArchitecture, actionId: string | null, input: ActionDefinitionInput, actorId: string) {
  const { fivemActionDefinitions, fivemActionSettings } = await getMongoCollections();
  const now = new Date();
  const id = actionId ?? randomUUID();
  await fivemActionDefinitions.updateOne({ _id: id, botId, guildId, architecture }, {
    $set: { ...input, updatedAt: now },
    $setOnInsert: { _id: id, botId, guildId, architecture, name: input.name ?? "Nova ação", description: input.description ?? "", emoji: input.emoji ?? null, imageUrl: input.imageUrl ?? null, color: input.color ?? "#7c3aed", maxParticipants: input.maxParticipants ?? 6, enabled: input.enabled ?? true, order: input.order ?? 0, createdAt: now, createdBy: actorId }
  }, { upsert: true });
  await fivemActionSettings.updateOne({ botId, guildId, architecture, enabled: true, panelMessageId: { $ne: null } }, { $set: { lastPanelRequestedAt: now, updatedAt: now } });
  const saved = actionDto((await fivemActionDefinitions.findOne({ _id: id, botId, guildId, architecture }))!);
  emitActionUpdated(botId, guildId, architecture, "action");
  return saved;
}

export async function deleteFivemActionDefinition(botId: string, guildId: string, architecture: MongoFivemActionArchitecture, actionId: string) {
  const { fivemActionDefinitions, fivemActionSettings } = await getMongoCollections();
  const deleted = await fivemActionDefinitions.findOneAndDelete({ _id: actionId, botId, guildId, architecture });
  if (deleted) {
    const now = new Date();
    await fivemActionSettings.updateOne({ botId, guildId, architecture, enabled: true, panelMessageId: { $ne: null } }, { $set: { lastPanelRequestedAt: now, updatedAt: now } });
    emitActionUpdated(botId, guildId, architecture, "action");
  }
  return deleted ? actionDto(deleted) : null;
}

export async function listActiveFivemActionSettings(botId: string, architectures?: MongoFivemActionArchitecture[]) {
  const { fivemActionSettings } = await getMongoCollections();
  const query = architectures?.length ? { botId, enabled: true, architecture: { $in: architectures } } : { botId, enabled: true };
  return (await fivemActionSettings.find(query).toArray()).map(settingsDto);
}

export async function createFivemActionSession(input: { botId: string; guildId: string; architecture: MongoFivemActionArchitecture; actionId: string; mode?: MongoFivemActionMode | null; openerId: string; openerName: string }) {
  const { fivemActionDefinitions, fivemActionSessions } = await getMongoCollections();
  const action = await fivemActionDefinitions.findOne({ _id: input.actionId, botId: input.botId, guildId: input.guildId, architecture: input.architecture, enabled: true });
  if (!action) throw serviceError("Ação não encontrada ou desativada.", 404);
  const now = new Date();
  const session = { _id: randomUUID(), ...input, mode: input.mode ?? null, actionName: action.name, actionDescription: action.description, actionEmoji: action.emoji, actionImageUrl: action.imageUrl, actionColor: action.color, channelId: null, messageId: null, status: "active" as const, maxParticipants: action.maxParticipants, participants: [], startedAt: now, finishedAt: null, createdAt: now, updatedAt: now };
  await fivemActionSessions.insertOne(session);
  emitActionUpdated(input.botId, input.guildId, input.architecture, "session");
  return sessionDto(session);
}

export async function updateFivemActionSessionMessage(botId: string, sessionId: string, channelId: string, messageId: string) {
  const { fivemActionSessions } = await getMongoCollections();
  await fivemActionSessions.updateOne({ _id: sessionId, botId }, { $set: { channelId, messageId, updatedAt: new Date() } });
  return sessionDto((await fivemActionSessions.findOne({ _id: sessionId, botId }))!);
}

export async function joinFivemActionSession(botId: string, sessionId: string, participant: Omit<MongoFivemActionParticipant, "joinedAt" | "leftAt">) {
  const { fivemActionSessions } = await getMongoCollections();
  const current = await fivemActionSessions.findOne({ _id: sessionId, botId });
  if (!current || current.status !== "active") throw serviceError("Esta ação não está mais ativa.", 409);
  if (current.participants.some((item) => item.userId === participant.userId && !item.leftAt)) return sessionDto(current);
  const activeCount = current.participants.filter((item) => !item.leftAt && participantPosition(item) === "confirmed").length;
  const position: MongoFivemActionParticipant["position"] = activeCount >= current.maxParticipants ? "reserve" : "confirmed";
  const updated = await fivemActionSessions.findOneAndUpdate(
    { _id: sessionId, botId, status: "active", participants: { $not: { $elemMatch: { userId: participant.userId, leftAt: null } } } },
    { $push: { participants: { ...participant, position, joinedAt: new Date(), leftAt: null } }, $set: { updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!updated) throw serviceError("Você já está nesta ação.", 409);
  emitActionUpdated(updated.botId, updated.guildId, updated.architecture, "session");
  return sessionDto(updated);
}

export async function leaveFivemActionSession(botId: string, sessionId: string, userId: string) {
  const { fivemActionSessions } = await getMongoCollections();
  const current = await fivemActionSessions.findOne({ _id: sessionId, botId });
  if (!current) throw serviceError("Ação não encontrada.", 404);
  const leaving = current.participants.find((item) => item.userId === userId && !item.leftAt);
  if (!leaving || current.status !== "active") return sessionDto(current);
  const participants = current.participants.map((item) => item.userId === userId && !item.leftAt ? { ...item, leftAt: new Date() } : item);
  if (participantPosition(leaving) === "confirmed") {
    const reserveIndex = participants.findIndex((item) => !item.leftAt && participantPosition(item) === "reserve");
    if (reserveIndex >= 0) {
      const reserve = participants[reserveIndex];
      if (reserve) {
        participants[reserveIndex] = { ...reserve, position: "confirmed" };
      }
    }
  }
  await fivemActionSessions.updateOne({ _id: sessionId, botId, status: "active" }, { $set: { participants, updatedAt: new Date() } });
  const session = await fivemActionSessions.findOne({ _id: sessionId, botId });
  if (!session) throw serviceError("Ação não encontrada.", 404);
  emitActionUpdated(session.botId, session.guildId, session.architecture, "session");
  return sessionDto(session);
}

export async function finishFivemActionSession(botId: string, sessionId: string, actorId: string, result: "victory" | "defeat") {
  const { fivemActionSessions } = await getMongoCollections();
  const now = new Date();
  const updated = await fivemActionSessions.findOneAndUpdate({ _id: sessionId, botId, status: "active", openerId: actorId }, { $set: { status: result, finishedAt: now, updatedAt: now } }, { returnDocument: "after" });
  if (updated) {
    emitActionUpdated(updated.botId, updated.guildId, updated.architecture, "session");
    return sessionDto(updated);
  }
  const session = await fivemActionSessions.findOne({ _id: sessionId, botId });
  if (!session) throw serviceError("Ação não encontrada.", 404);
  if (session.openerId !== actorId) throw serviceError("Você não é o responsável por esta ação.", 403);
  throw serviceError("Esta ação já foi encerrada.", 409);
}

export async function getFivemActionSession(botId: string, sessionId: string) {
  const { fivemActionSessions } = await getMongoCollections();
  const session = await fivemActionSessions.findOne({ _id: sessionId, botId });
  return session ? sessionDto(session) : null;
}

function settingsDto(value: MongoFivemActionSettings) { return { ...value, id: value._id, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString(), lastPanelRequestedAt: value.lastPanelRequestedAt?.toISOString() ?? null }; }
function actionDto(value: MongoFivemActionDefinition) { return { ...value, id: value._id, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString() }; }
function sessionDto(value: any) { return { ...value, id: value._id, mode: value.mode ?? null, startedAt: value.startedAt.toISOString(), finishedAt: value.finishedAt?.toISOString() ?? null, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString(), participants: value.participants.map((item: MongoFivemActionParticipant) => ({ ...item, position: participantPosition(item), joinedAt: item.joinedAt.toISOString(), leftAt: item.leftAt?.toISOString() ?? null })) }; }
function serviceError(message: string, statusCode: number) { return Object.assign(new Error(message), { statusCode }); }
function participantPosition(item: Pick<MongoFivemActionParticipant, "position">) { return item.position === "reserve" ? "reserve" : "confirmed"; }
function emitActionUpdated(botId: string, guildId: string, architecture: MongoFivemActionArchitecture, scope: "action" | "session" | "settings") {
  emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, botId), "fivem:actions:updated", { architecture, botId, guildId, scope });
}

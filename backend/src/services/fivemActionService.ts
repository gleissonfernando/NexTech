import { randomUUID } from "node:crypto";
import {
  getMongoCollections,
  type MongoFivemActionArchitecture,
  type MongoFivemActionDefinition,
  type MongoFivemActionMode,
  type MongoFivemActionParticipant,
  type MongoFivemActionSession,
  type MongoFivemActionSettings
} from "../database/mongo";
import { dashboardLogRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";
import { MISSING_GOOGLE_SHEETS_CREDENTIALS_MESSAGE, appendSheetRow, ensureSheetHeaders, getGoogleSheetsServiceAccountEmail, googleSheetsConfigured, updateSheetRow } from "./googleSheetsService";

export const FIVEM_ACTIONS_MODULE_ID = "fivem-actions";
export const POLICE_ACTIONS_MODULE_ID = "police-actions";

export type ActionSettingsInput = Partial<Pick<MongoFivemActionSettings,
  "enabled" | "categoryId" | "panelChannelId" | "actionChannelId" | "reportChannelId" |
  "panelTitle" | "panelDescription" | "color" | "imageUrl" | "imagePosition" |
  "managerRoleIds" | "spreadsheetEnabled" | "spreadsheetId" | "spreadsheetSheetName"
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
    managerRoleIds: [], spreadsheetEnabled: false, spreadsheetId: null, spreadsheetSheetName: architecture === "police" ? "Ações Polícia" : "Ações",
    spreadsheetLastSyncAt: null, spreadsheetSyncError: null,
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
  const patch = normalizeActionSettingsInput(input);
  const shouldRefreshPanel = current.enabled && Boolean(current.panelMessageId);
  const spreadsheetPatch = "spreadsheetEnabled" in patch || "spreadsheetId" in patch || "spreadsheetSheetName" in patch
    ? { spreadsheetLastSyncAt: null, spreadsheetSyncError: null }
    : {};
  await fivemActionSettings.updateOne(
    { botId, guildId, architecture },
    { $set: { ...patch, ...spreadsheetPatch, ...(shouldRefreshPanel ? { lastPanelRequestedAt: now } : {}), updatedAt: now, updatedBy: actorId } }
  );
  let savedRaw = (await fivemActionSettings.findOne({ botId, guildId, architecture }))!;
  if (architecture === "police" && shouldTestSpreadsheetConnection(patch, savedRaw)) {
    await testFivemActionSpreadsheet(savedRaw);
    savedRaw = (await fivemActionSettings.findOne({ botId, guildId, architecture }))!;
  }
  const saved = settingsDto(savedRaw);
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
  const patch = { ...input };
  const nextName = input.name?.trim();
  if (nextName) {
    const duplicate = await fivemActionDefinitions.findOne({ _id: { $ne: id }, botId, guildId, architecture, name: { $regex: `^${escapeRegExp(nextName)}$`, $options: "i" } });
    if (duplicate) throw serviceError("Já existe uma ação com esse nome nesta organização.", 409);
    patch.name = nextName;
  }
  const insertDefaults: Partial<MongoFivemActionDefinition> = {
    _id: id,
    botId,
    guildId,
    architecture,
    createdAt: now,
    createdBy: actorId
  };
  if (!("name" in patch)) insertDefaults.name = "Nova ação";
  if (!("description" in patch)) insertDefaults.description = "";
  if (!("emoji" in patch)) insertDefaults.emoji = null;
  if (!("imageUrl" in patch)) insertDefaults.imageUrl = null;
  if (!("color" in patch)) insertDefaults.color = "#7c3aed";
  if (!("maxParticipants" in patch)) insertDefaults.maxParticipants = 6;
  if (!("enabled" in patch)) insertDefaults.enabled = true;
  if (!("order" in patch)) insertDefaults.order = 0;
  await fivemActionDefinitions.updateOne({ _id: id, botId, guildId, architecture }, {
    $set: { ...patch, updatedAt: now },
    $setOnInsert: insertDefaults
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
  const session = { _id: randomUUID(), ...input, mode: input.mode ?? null, actionName: action.name, actionDescription: action.description, actionEmoji: action.emoji, actionImageUrl: action.imageUrl, actionColor: action.color, channelId: null, messageId: null, sheetRow: null, sheetSyncStatus: "pending" as const, sheetSyncError: null, sheetLastSyncAt: null, status: "forming" as const, maxParticipants: action.maxParticipants, participants: [], startedAt: null, cancelledAt: null, cancelledBy: null, cancellationReason: null, finishedAt: null, resultNote: null, resultSummary: null, resultOccurrence: null, createdAt: now, updatedAt: now };
  await fivemActionSessions.insertOne(session);
  await syncFivemActionSessionToSheet(input.botId, session._id, "created").catch(() => null);
  emitActionUpdated(input.botId, input.guildId, input.architecture, "session");
  return sessionDto((await fivemActionSessions.findOne({ _id: session._id, botId: input.botId })) ?? session);
}

export async function updateFivemActionSessionMessage(botId: string, sessionId: string, channelId: string, messageId: string) {
  const { fivemActionSessions } = await getMongoCollections();
  await fivemActionSessions.updateOne({ _id: sessionId, botId }, { $set: { channelId, messageId, updatedAt: new Date() } });
  const session = (await fivemActionSessions.findOne({ _id: sessionId, botId }))!;
  emitActionUpdated(session.botId, session.guildId, session.architecture, "session");
  return sessionDto(session);
}

export async function joinFivemActionSession(botId: string, sessionId: string, participant: Omit<MongoFivemActionParticipant, "joinedAt" | "leftAt">) {
  const { fivemActionSessions } = await getMongoCollections();
  const current = await fivemActionSessions.findOne({ _id: sessionId, botId });
  if (!current || current.status !== "forming") throw serviceError("Esta ação não aceita novas entradas.", 409);
  if (current.participants.some((item) => item.userId === participant.userId && !item.leftAt)) return sessionDto(current);
  const activeCount = current.participants.filter((item) => !item.leftAt && participantPosition(item) === "confirmed").length;
  if (activeCount >= current.maxParticipants) throw serviceError("Esta ação atingiu o limite máximo de participantes.", 409);
  const position: MongoFivemActionParticipant["position"] = "confirmed";
  const updated = await fivemActionSessions.findOneAndUpdate(
    { _id: sessionId, botId, status: "forming", participants: { $not: { $elemMatch: { userId: participant.userId, leftAt: null } } } },
    { $push: { participants: { ...participant, position, joinedAt: new Date(), leftAt: null } }, $set: { updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!updated) throw serviceError("Você já está nesta ação.", 409);
  await syncFivemActionSessionToSheet(updated.botId, updated._id, "participant_joined").catch(() => null);
  emitActionUpdated(updated.botId, updated.guildId, updated.architecture, "session");
  return sessionDto(updated);
}

export async function leaveFivemActionSession(botId: string, sessionId: string, userId: string) {
  const { fivemActionSessions } = await getMongoCollections();
  const current = await fivemActionSessions.findOne({ _id: sessionId, botId });
  if (!current) throw serviceError("Ação não encontrada.", 404);
  const leaving = current.participants.find((item) => item.userId === userId && !item.leftAt);
  if (!leaving || current.status !== "forming") return sessionDto(current);
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
  await fivemActionSessions.updateOne({ _id: sessionId, botId, status: "forming" }, { $set: { participants, updatedAt: new Date() } });
  const session = await fivemActionSessions.findOne({ _id: sessionId, botId });
  if (!session) throw serviceError("Ação não encontrada.", 404);
  await syncFivemActionSessionToSheet(botId, sessionId, "participant_left").catch(() => null);
  emitActionUpdated(session.botId, session.guildId, session.architecture, "session");
  return sessionDto(session);
}

export async function finishFivemActionSession(botId: string, sessionId: string, actorId: string, result: "victory" | "defeat" | "draw", details?: { occurrence?: string | null; note?: string | null; summary?: string | null }) {
  const { fivemActionSessions } = await getMongoCollections();
  const now = new Date();
  const updated = await fivemActionSessions.findOneAndUpdate({ _id: sessionId, botId, status: "active", openerId: actorId }, { $set: { status: result, finishedAt: now, resultNote: details?.note ?? null, resultSummary: details?.summary ?? null, resultOccurrence: details?.occurrence ?? null, updatedAt: now } }, { returnDocument: "after" });
  if (updated) {
    await syncFivemActionSessionToSheet(botId, sessionId, "finished").catch(() => null);
    emitActionUpdated(updated.botId, updated.guildId, updated.architecture, "session");
    return sessionDto((await fivemActionSessions.findOne({ _id: sessionId, botId })) ?? updated);
  }
  const session = await fivemActionSessions.findOne({ _id: sessionId, botId });
  if (!session) throw serviceError("Ação não encontrada.", 404);
  if (session.openerId !== actorId) throw serviceError("Você não é o responsável por esta ação.", 403);
  throw serviceError("Esta ação já foi encerrada.", 409);
}

export async function startFivemActionSession(botId: string, sessionId: string, actorId: string) {
  const { fivemActionSessions } = await getMongoCollections();
  const now = new Date();
  const updated = await fivemActionSessions.findOneAndUpdate(
    { _id: sessionId, botId, status: "forming", openerId: actorId, participants: { $elemMatch: { leftAt: null } } },
    { $set: { status: "active", startedAt: now, updatedAt: now } },
    { returnDocument: "after" }
  );
  if (updated) {
    await syncFivemActionSessionToSheet(botId, sessionId, "started").catch(() => null);
    emitActionUpdated(updated.botId, updated.guildId, updated.architecture, "session");
    return sessionDto((await fivemActionSessions.findOne({ _id: sessionId, botId })) ?? updated);
  }
  const session = await fivemActionSessions.findOne({ _id: sessionId, botId });
  if (!session) throw serviceError("Ação não encontrada.", 404);
  if (session.openerId !== actorId) throw serviceError("Você não é o responsável por esta ação.", 403);
  if (session.status !== "forming") throw serviceError("Esta ação não pode ser iniciada neste estado.", 409);
  throw serviceError("Adicione pelo menos um participante antes de iniciar a ação.", 409);
}

export async function cancelFivemActionSession(botId: string, sessionId: string, actorId: string, reason: string | null = null) {
  const { fivemActionSessions } = await getMongoCollections();
  const now = new Date();
  const updated = await fivemActionSessions.findOneAndUpdate(
    { _id: sessionId, botId, status: { $in: ["forming", "active"] }, openerId: actorId },
    { $set: { status: "cancelled", cancelledAt: now, cancelledBy: actorId, cancellationReason: reason, updatedAt: now } },
    { returnDocument: "after" }
  );
  if (updated) {
    await syncFivemActionSessionToSheet(botId, sessionId, "cancelled").catch(() => null);
    emitActionUpdated(updated.botId, updated.guildId, updated.architecture, "session");
    return sessionDto((await fivemActionSessions.findOne({ _id: sessionId, botId })) ?? updated);
  }
  const session = await fivemActionSessions.findOne({ _id: sessionId, botId });
  if (!session) throw serviceError("Ação não encontrada.", 404);
  if (session.openerId !== actorId) throw serviceError("Você não é o responsável por esta ação.", 403);
  throw serviceError("Esta ação não pode ser cancelada neste estado.", 409);
}

export async function getFivemActionSession(botId: string, sessionId: string) {
  const { fivemActionSessions } = await getMongoCollections();
  const session = await fivemActionSessions.findOne({ _id: sessionId, botId });
  return session ? sessionDto(session) : null;
}

const POLICE_ACTION_SHEET_HEADERS = [
  "ID", "Ação", "Tipo", "Responsável", "Status", "Data", "Hora Criação", "Hora Início", "Hora Final",
  "Duração", "Participantes", "Quantidade", "Limite", "Resultado", "Observação", "Resumo", "Ocorrência", "Última Atualização"
];

async function syncFivemActionSessionToSheet(botId: string, sessionId: string, reason: string) {
  const { fivemActionSessions, fivemActionSettings } = await getMongoCollections();
  const session = await fivemActionSessions.findOne({ _id: sessionId, botId });
  if (!session || session.architecture !== "police") return;
  const settings = await fivemActionSettings.findOne({ botId, guildId: session.guildId, architecture: "police" });
  if (!settings?.spreadsheetEnabled || !settings.spreadsheetId) return;
  if (!googleSheetsConfigured()) {
    await setSheetSyncFailure(botId, sessionId, MISSING_GOOGLE_SHEETS_CREDENTIALS_MESSAGE);
    return;
  }
  const sheetName = settings.spreadsheetSheetName?.trim() || "Ações Polícia";
  try {
    await ensureSheetHeaders({ headers: POLICE_ACTION_SHEET_HEADERS, sheetName, spreadsheetId: settings.spreadsheetId });
    const row = sessionRow(session);
    const now = new Date();
    if (session.sheetRow) {
      await updateSheetRow({ row: session.sheetRow, sheetName, spreadsheetId: settings.spreadsheetId, values: row });
      await fivemActionSessions.updateOne({ _id: sessionId, botId }, { $set: { sheetLastSyncAt: now, sheetSyncError: null, sheetSyncStatus: "synced", updatedAt: now } });
    } else {
      const sheetRow = await appendSheetRow({ sheetName, spreadsheetId: settings.spreadsheetId, values: row });
      await fivemActionSessions.updateOne({ _id: sessionId, botId }, { $set: { sheetLastSyncAt: now, sheetRow, sheetSyncError: null, sheetSyncStatus: "synced", updatedAt: now } });
    }
    await fivemActionSettings.updateOne({ botId, guildId: session.guildId, architecture: "police" }, { $set: { spreadsheetLastSyncAt: now, spreadsheetSyncError: null, updatedAt: now } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setSheetSyncFailure(botId, sessionId, `${reason}: ${message}`);
    await fivemActionSettings.updateOne({ botId, guildId: session.guildId, architecture: "police" }, { $set: { spreadsheetSyncError: message, updatedAt: new Date() } });
  }
}

function normalizeActionSettingsInput(input: ActionSettingsInput): ActionSettingsInput {
  const patch = { ...input };
  if ("spreadsheetId" in patch) {
    patch.spreadsheetId = normalizeSpreadsheetId(patch.spreadsheetId);
  }
  if ("spreadsheetSheetName" in patch && typeof patch.spreadsheetSheetName === "string") {
    patch.spreadsheetSheetName = patch.spreadsheetSheetName.trim() || "Ações Polícia";
  }
  return patch;
}

function normalizeSpreadsheetId(value: string | null | undefined) {
  if (value == null) return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed) && !/^https:\/\/docs\.google\.com\/spreadsheets\//i.test(trimmed)) {
    throw serviceError("Use um link do Google Planilhas. Links do OneDrive/Excel não são compatíveis com a integração Google Sheets.", 400);
  }
  const urlMatch = /\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/.exec(trimmed);
  const candidate = urlMatch?.[1] ?? trimmed;
  if (!/^[a-zA-Z0-9_-]{20,}$/.test(candidate)) {
    throw serviceError("Link ou ID da Google Sheets inválido.", 400);
  }
  return candidate;
}

function shouldTestSpreadsheetConnection(input: ActionSettingsInput, settings: MongoFivemActionSettings) {
  if (!settings.spreadsheetEnabled || !settings.spreadsheetId) return false;
  return "spreadsheetEnabled" in input || "spreadsheetId" in input || "spreadsheetSheetName" in input;
}

async function testFivemActionSpreadsheet(settings: MongoFivemActionSettings) {
  const { fivemActionSettings } = await getMongoCollections();
  const sheetName = settings.spreadsheetSheetName?.trim() || "Ações Polícia";
  if (!googleSheetsConfigured()) {
    await fivemActionSettings.updateOne(
      { _id: settings._id },
      { $set: { spreadsheetLastSyncAt: null, spreadsheetSyncError: MISSING_GOOGLE_SHEETS_CREDENTIALS_MESSAGE, updatedAt: new Date() } }
    );
    return;
  }
  try {
    await ensureSheetHeaders({ headers: POLICE_ACTION_SHEET_HEADERS, sheetName, spreadsheetId: settings.spreadsheetId! });
    await fivemActionSettings.updateOne(
      { _id: settings._id },
      { $set: { spreadsheetLastSyncAt: new Date(), spreadsheetSyncError: null, updatedAt: new Date() } }
    );
  } catch (error) {
    await fivemActionSettings.updateOne(
      { _id: settings._id },
      { $set: { spreadsheetLastSyncAt: null, spreadsheetSyncError: error instanceof Error ? error.message : String(error), updatedAt: new Date() } }
    );
  }
}

async function setSheetSyncFailure(botId: string, sessionId: string, message: string) {
  const { fivemActionSessions } = await getMongoCollections();
  await fivemActionSessions.updateOne({ _id: sessionId, botId }, { $set: { sheetSyncError: message, sheetSyncStatus: "failed", updatedAt: new Date() } });
}

function sessionRow(session: MongoFivemActionSession) {
  const active = session.participants.filter((item) => !item.leftAt && participantPosition(item) === "confirmed");
  const created = new Date(session.createdAt);
  const started = session.startedAt ? new Date(session.startedAt) : null;
  const finished = session.finishedAt ? new Date(session.finishedAt) : null;
  return [
    session._id.slice(0, 8).toUpperCase(),
    session.actionName,
    actionModeText(session.mode),
    session.openerName,
    sheetStatusText(session.status),
    formatDate(created),
    formatTime(created),
    started ? formatTime(started) : "",
    finished ? formatTime(finished) : "",
    started && finished ? `${Math.max(0, Math.round((finished.getTime() - started.getTime()) / 60000))} min` : "",
    active.map((item) => item.username).join(", "),
    active.length,
    session.maxParticipants,
    resultText(session.status),
    session.resultNote ?? "",
    session.resultSummary ?? "",
    session.resultOccurrence ?? "",
    formatDateTime(new Date())
  ];
}

function formatDate(value: Date) {
  return value.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function formatTime(value: Date) {
  return value.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}

function formatDateTime(value: Date) {
  return value.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function actionModeText(mode: MongoFivemActionMode | null | undefined) {
  return mode === "shootout" ? "Tiro" : mode === "escape" ? "Fuga de carro" : "";
}

function sheetStatusText(status: MongoFivemActionSession["status"]) {
  if (status === "forming") return "Preparando";
  if (status === "active") return "Em Andamento";
  if (status === "cancelled") return "Cancelada";
  return "Finalizada";
}

function resultText(status: MongoFivemActionSession["status"]) {
  if (status === "victory") return "Vitória";
  if (status === "defeat") return "Derrota";
  if (status === "draw") return "Empate";
  if (status === "cancelled") return "Cancelada";
  return "Pendente";
}

function settingsDto(value: MongoFivemActionSettings) { return { ...value, id: value._id, googleSheetsServiceAccountEmail: getGoogleSheetsServiceAccountEmail(), managerRoleIds: value.managerRoleIds ?? [], spreadsheetEnabled: value.spreadsheetEnabled ?? false, spreadsheetId: value.spreadsheetId ?? null, spreadsheetSheetName: value.spreadsheetSheetName ?? null, spreadsheetLastSyncAt: value.spreadsheetLastSyncAt?.toISOString() ?? null, spreadsheetSyncError: value.spreadsheetSyncError ?? null, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString(), lastPanelRequestedAt: value.lastPanelRequestedAt?.toISOString() ?? null }; }
function actionDto(value: MongoFivemActionDefinition) { return { ...value, id: value._id, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString() }; }
function sessionDto(value: any) { return { ...value, id: value._id, mode: value.mode ?? null, sheetRow: value.sheetRow ?? null, sheetSyncStatus: value.sheetSyncStatus ?? null, sheetSyncError: value.sheetSyncError ?? null, sheetLastSyncAt: value.sheetLastSyncAt?.toISOString() ?? null, startedAt: value.startedAt?.toISOString() ?? null, cancelledAt: value.cancelledAt?.toISOString() ?? null, cancelledBy: value.cancelledBy ?? null, cancellationReason: value.cancellationReason ?? null, finishedAt: value.finishedAt?.toISOString() ?? null, resultNote: value.resultNote ?? null, resultSummary: value.resultSummary ?? null, resultOccurrence: value.resultOccurrence ?? null, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString(), participants: value.participants.map((item: MongoFivemActionParticipant) => ({ ...item, position: participantPosition(item), joinedAt: item.joinedAt.toISOString(), leftAt: item.leftAt?.toISOString() ?? null })) }; }
function serviceError(message: string, statusCode: number) { return Object.assign(new Error(message), { statusCode }); }
function participantPosition(item: Pick<MongoFivemActionParticipant, "position">) { return item.position === "reserve" ? "reserve" : "confirmed"; }
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function emitActionUpdated(botId: string, guildId: string, architecture: MongoFivemActionArchitecture, scope: "action" | "session" | "settings") {
  emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, botId), "fivem:actions:updated", { architecture, botId, guildId, scope });
}

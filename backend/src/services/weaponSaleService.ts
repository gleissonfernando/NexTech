import { randomUUID } from "node:crypto";
import {
  ensureGuild,
  getMongoCollections,
  type MongoWeaponSaleConfig,
  type MongoWeaponSaleItem,
  type MongoWeaponSaleSession,
  type MongoWeaponSaleSessionStatus,
  type MongoWeaponSaleWeapon
} from "../database/mongo";
import { dashboardLogRealtimeRoom, devBotRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";
import { authorizeBotRuntimeModule } from "./devBotService";

export const WEAPON_SALE_MODULE_ID = "fivem-weapons";

export type WeaponSaleConfigInput = Partial<Omit<WeaponSaleConfigDto, "id" | "createdAt" | "updatedAt"> & {
  weapons: Array<{ active?: boolean; id?: string; name: string; unitPriceInCents: number }>;
}>;

export type WeaponSaleConfigDto = Omit<MongoWeaponSaleConfig, "_id" | "createdAt" | "updatedAt"> & { createdAt: string; id: string; updatedAt: string };
export type WeaponSaleWeaponDto = Omit<MongoWeaponSaleWeapon, "_id" | "createdAt" | "updatedAt"> & { createdAt: string; id: string; updatedAt: string };
export type WeaponSaleSessionDto = Omit<MongoWeaponSaleSession, "_id" | "createdAt" | "updatedAt" | "completedAt" | "expiresAt" | "lastActivityAt"> & {
  completedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
  id: string;
  lastActivityAt: string;
  updatedAt: string;
};
export type WeaponSaleFactionDto = { emoji: string | null; id: string; name: string };

const DEFAULT_TITLE = "Sistema de Armas";
const DEFAULT_DESCRIPTION = "Realize vendas de armas virtuais com registro e log.";
const DEFAULT_BUTTON = "Realizar venda de armas";

export async function getWeaponSaleDashboard(guildId: string, botId: string | null) {
  const [config, weapons, sessions, factions] = await Promise.all([
    getWeaponSaleConfig(guildId, botId),
    listWeaponSaleWeapons(guildId, botId, false),
    listWeaponSaleSessions(guildId, botId, 100),
    listWeaponSaleFactions(guildId, botId)
  ]);
  return { config, factions, sessions, weapons, report: summarizeSessions(sessions) };
}

export async function getWeaponSaleRuntime(guildId: string, botId: string | null) {
  if (botId) await authorizeBotRuntimeModule({ botId, guildId, moduleId: WEAPON_SALE_MODULE_ID });
  const [config, weapons, sessions, factions] = await Promise.all([
    getWeaponSaleConfig(guildId, botId),
    listWeaponSaleWeapons(guildId, botId, false),
    listWeaponSaleSessions(guildId, botId, 50),
    listWeaponSaleFactions(guildId, botId)
  ]);
  return { config, factions, sessions, weapons };
}

export async function getWeaponSaleConfig(guildId: string, botId: string | null) {
  const { weaponSaleConfigs } = await getMongoCollections();
  return toConfigDto(await weaponSaleConfigs.findOne(scope(guildId, botId)) ?? defaultConfig(guildId, botId));
}

export async function saveWeaponSaleConfig(guildId: string, botId: string | null, input: WeaponSaleConfigInput, actorId: string | null) {
  const current = await getWeaponSaleConfig(guildId, botId);
  const now = new Date();
  const next: Omit<MongoWeaponSaleConfig, "_id" | "createdAt"> = {
    accentColor: normalizeColor(input.accentColor ?? current.accentColor),
    botId,
    buttonText: normalizeText(input.buttonText, 80) ?? current.buttonText,
    cancelDeleteDelaySeconds: clamp(input.cancelDeleteDelaySeconds, 0, 86_400, current.cancelDeleteDelaySeconds),
    completedDeleteDelaySeconds: clamp(input.completedDeleteDelaySeconds, 0, 86_400, current.completedDeleteDelaySeconds),
    description: normalizeText(input.description, 1500) ?? current.description,
    enabled: input.enabled ?? current.enabled,
    expirationMinutes: clamp(input.expirationMinutes, 5, 10_080, current.expirationMinutes),
    footerImageUrl: normalizeUrl(input.footerImageUrl ?? current.footerImageUrl),
    guildId,
    imageUrl: normalizeUrl(input.imageUrl ?? current.imageUrl),
    logChannelId: normalizeSnowflake(input.logChannelId ?? current.logChannelId),
    managerRoleIds: normalizeSnowflakes(input.managerRoleIds ?? current.managerRoleIds),
    managerUserIds: normalizeSnowflakes(input.managerUserIds ?? current.managerUserIds),
    orientationText: normalizeText(input.orientationText, 1500) ?? current.orientationText,
    panelChannelId: normalizeSnowflake(input.panelChannelId ?? current.panelChannelId),
    panelMessageId: normalizeSnowflake(input.panelMessageId ?? current.panelMessageId),
    temporaryCategoryId: normalizeSnowflake(input.temporaryCategoryId ?? current.temporaryCategoryId),
    temporaryChannelText: normalizeText(input.temporaryChannelText, 1500) ?? current.temporaryChannelText,
    thumbnailUrl: normalizeUrl(input.thumbnailUrl ?? current.thumbnailUrl),
    title: normalizeText(input.title, 120) ?? current.title,
    updatedAt: now,
    updatedBy: actorId
  };
  const { weaponSaleConfigs } = await getMongoCollections();
  await ensureGuild(guildId);
  await weaponSaleConfigs.updateOne(scope(guildId, botId), { $set: next, $setOnInsert: { _id: current.id, createdAt: now } }, { upsert: true });
  if (input.weapons) await saveWeapons(guildId, botId, input.weapons, actorId);
  emitUpdated(guildId, botId);
  return getWeaponSaleConfig(guildId, botId);
}

export async function requestWeaponSalePanelPublish(guildId: string, botId: string | null) {
  const config = await getWeaponSaleConfig(guildId, botId);
  if (botId) emitRealtimeToRoom(devBotRealtimeRoom(botId), "fivem:weapons:panel_publish", { botId, guildId });
  return config;
}

export async function updateWeaponSalePanelState(guildId: string, botId: string | null, messageId: string | null) {
  return saveWeaponSaleConfig(guildId, botId, { panelMessageId: messageId }, null);
}

export async function listWeaponSaleWeapons(guildId: string, botId: string | null, activeOnly = true) {
  const { weaponSaleWeapons } = await getMongoCollections();
  const rows = await weaponSaleWeapons.find({ ...scope(guildId, botId), ...(activeOnly ? { active: true } : {}) }).sort({ name: 1 }).toArray();
  return rows.map(toWeaponDto);
}

export async function listWeaponSaleFactions(guildId: string, botId: string | null): Promise<WeaponSaleFactionDto[]> {
  const { fivemFinanceSettings, fivemFacSettings } = await getMongoCollections();
  const finance = await fivemFinanceSettings.find({ guildId, ...(botId ? { botId } : {}), enabled: true }).sort({ factionName: 1 }).toArray();
  if (finance.length) return finance.map((row) => ({ emoji: null, id: row.factionId || "default", name: row.factionName || "Facção" }));
  const fac = await fivemFacSettings.find({ guildId, ...(botId ? { botId } : {}) }).sort({ createdAt: 1 }).toArray().catch(() => []);
  return fac.map((row) => ({ emoji: null, id: row._id, name: "Facção" }));
}

export async function listWeaponSaleSessions(guildId: string, botId: string | null, limit = 100) {
  const { weaponSaleSessions } = await getMongoCollections();
  return (await weaponSaleSessions.find(scope(guildId, botId)).sort({ createdAt: -1 }).limit(Math.min(Math.max(limit, 1), 250)).toArray()).map(toSessionDto);
}

export async function createWeaponSaleSession(guildId: string, botId: string | null, input: { buyerFactionId: string; openedByUserId: string; sellerName?: string | null }) {
  const config = await getWeaponSaleConfig(guildId, botId);
  assertReady(config);
  const weapons = await listWeaponSaleWeapons(guildId, botId, true);
  if (!weapons.length) throw serviceError("Nenhuma arma ativa cadastrada.", 409);
  const faction = (await listWeaponSaleFactions(guildId, botId)).find((item) => item.id === input.buyerFactionId);
  if (!faction) throw serviceError("Facção selecionada não está mais disponível.", 400);
  const { weaponSaleSessions } = await getMongoCollections();
  const existing = await weaponSaleSessions.findOne({ ...scope(guildId, botId), openedByUserId: input.openedByUserId, status: { $in: ["aguardando_itens", "em_preenchimento", "aguardando_confirmacao", "processando"] } });
  if (existing) throw serviceError("Você já possui uma venda aberta.", 409);
  const now = new Date();
  const session: MongoWeaponSaleSession = {
    _id: randomUUID(),
    botId,
    buyerFactionId: faction.id,
    buyerFactionName: faction.name,
    channelId: null,
    completedAt: null,
    completedByUserId: null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + config.expirationMinutes * 60_000),
    guildId,
    items: [],
    lastActivityAt: now,
    logMessageId: null,
    openedByUserId: input.openedByUserId,
    panelMessageId: null,
    saleCode: await nextSaleCode(guildId, botId),
    sellerName: normalizeText(input.sellerName, 120),
    status: "aguardando_itens",
    totalQuantity: 0,
    totalValueInCents: 0,
    updatedAt: now
  };
  await weaponSaleSessions.insertOne(session);
  emitUpdated(guildId, botId);
  return toSessionDto(session);
}

export async function updateWeaponSaleSessionChannel(guildId: string, botId: string | null, sessionId: string, input: { channelId?: string | null; panelMessageId?: string | null }) {
  const { weaponSaleSessions } = await getMongoCollections();
  const row = await weaponSaleSessions.findOneAndUpdate({ _id: sessionId, ...scope(guildId, botId) }, { $set: { ...input, updatedAt: new Date() } }, { returnDocument: "after" });
  if (!row) throw serviceError("Sessão não encontrada.", 404);
  emitUpdated(guildId, botId);
  return toSessionDto(row);
}

export async function findWeaponSaleSessionByChannel(guildId: string, botId: string | null, channelId: string) {
  const { weaponSaleSessions } = await getMongoCollections();
  const row = await weaponSaleSessions.findOne({ ...scope(guildId, botId), channelId, status: { $in: ["aguardando_itens", "em_preenchimento", "aguardando_confirmacao"] } });
  return row ? toSessionDto(row) : null;
}

export async function addWeaponSaleItems(guildId: string, botId: string | null, sessionId: string, input: { actorId: string; items: Array<{ quantity: number; weaponId: string }>; messageContent?: string | null; messageId?: string | null }) {
  const { weaponSaleSessions } = await getMongoCollections();
  const session = await weaponSaleSessions.findOne({ _id: sessionId, ...scope(guildId, botId), status: { $in: ["aguardando_itens", "em_preenchimento"] } });
  if (!session) throw serviceError("Sessão não aceita novos itens.", 409);
  const weapons = new Map((await listWeaponSaleWeapons(guildId, botId, true)).map((weapon) => [weapon.id, weapon]));
  const map = new Map((session.items ?? []).map((item) => [item.weaponId, item]));
  for (const raw of input.items) {
    const weapon = weapons.get(raw.weaponId);
    if (!weapon) continue;
    const quantity = normalizeQuantity(raw.quantity);
    const nextQuantity = (map.get(weapon.id)?.quantity ?? 0) + quantity;
    map.set(weapon.id, itemFromWeapon(weapon, nextQuantity));
  }
  const items = [...map.values()].sort((a, b) => a.weaponName.localeCompare(b.weaponName, "pt-BR"));
  const totals = totalsOf(items);
  const now = new Date();
  const row = await weaponSaleSessions.findOneAndUpdate({ _id: sessionId, ...scope(guildId, botId), status: { $in: ["aguardando_itens", "em_preenchimento"] } }, {
    $set: { items, lastActivityAt: now, status: "em_preenchimento", totalQuantity: totals.quantity, totalValueInCents: totals.totalValueInCents, updatedAt: now }
  }, { returnDocument: "after" });
  await logMessage(guildId, botId, session, "ADD_ITEMS", input.actorId, input.messageId, input.messageContent, { items: input.items });
  emitUpdated(guildId, botId);
  return toSessionDto(row ?? session);
}

export async function clearWeaponSaleItems(guildId: string, botId: string | null, sessionId: string, actorId: string) {
  const { weaponSaleSessions } = await getMongoCollections();
  const row = await weaponSaleSessions.findOneAndUpdate({ _id: sessionId, ...scope(guildId, botId), status: { $in: ["aguardando_itens", "em_preenchimento"] } }, {
    $set: { items: [], status: "aguardando_itens", totalQuantity: 0, totalValueInCents: 0, updatedAt: new Date() }
  }, { returnDocument: "after" });
  if (!row) throw serviceError("Sessão não permite limpar itens.", 409);
  await logMessage(guildId, botId, row, "CLEAR_ITEMS", actorId, null, null, {});
  emitUpdated(guildId, botId);
  return toSessionDto(row);
}

export async function readyWeaponSaleSession(guildId: string, botId: string | null, sessionId: string, actorId: string) {
  const { weaponSaleSessions } = await getMongoCollections();
  const session = await weaponSaleSessions.findOne({ _id: sessionId, ...scope(guildId, botId), status: { $in: ["aguardando_itens", "em_preenchimento"] } });
  if (!session || session.totalQuantity <= 0 || !session.items.length) throw serviceError("Adicione ao menos uma arma antes de finalizar.", 409);
  const row = await weaponSaleSessions.findOneAndUpdate({ _id: sessionId, ...scope(guildId, botId), status: { $in: ["aguardando_itens", "em_preenchimento"] } }, {
    $set: { status: "aguardando_confirmacao", updatedAt: new Date() }
  }, { returnDocument: "after" });
  await logMessage(guildId, botId, session, "READY", actorId, null, null, {});
  emitUpdated(guildId, botId);
  return toSessionDto(row ?? session);
}

export async function reopenWeaponSaleSession(guildId: string, botId: string | null, sessionId: string, actorId: string) {
  const { weaponSaleSessions } = await getMongoCollections();
  const row = await weaponSaleSessions.findOneAndUpdate({ _id: sessionId, ...scope(guildId, botId), status: "aguardando_confirmacao" }, { $set: { status: "em_preenchimento", updatedAt: new Date() } }, { returnDocument: "after" });
  if (!row) throw serviceError("Sessão não pode ser reaberta.", 409);
  await logMessage(guildId, botId, row, "REOPEN", actorId, null, null, {});
  emitUpdated(guildId, botId);
  return toSessionDto(row);
}

export async function confirmWeaponSaleSession(guildId: string, botId: string | null, sessionId: string, actorId: string) {
  const { weaponSaleSessions } = await getMongoCollections();
  const processing = await weaponSaleSessions.findOneAndUpdate({ _id: sessionId, ...scope(guildId, botId), status: "aguardando_confirmacao" }, { $set: { status: "processando", updatedAt: new Date() } }, { returnDocument: "after" });
  if (!processing) {
    const existing = await weaponSaleSessions.findOne({ _id: sessionId, ...scope(guildId, botId) });
    if (existing?.status === "concluida") return toSessionDto(existing);
    throw serviceError("Venda não está aguardando confirmação.", 409);
  }
  const now = new Date();
  const row = await weaponSaleSessions.findOneAndUpdate({ _id: sessionId, ...scope(guildId, botId), status: "processando" }, {
    $set: { completedAt: now, completedByUserId: actorId, status: "concluida", updatedAt: now }
  }, { returnDocument: "after" });
  await logMessage(guildId, botId, processing, "CONFIRM", actorId, null, null, {});
  emitUpdated(guildId, botId);
  return toSessionDto(row ?? processing);
}

export async function cancelWeaponSaleSession(guildId: string, botId: string | null, sessionId: string, actorId: string) {
  const { weaponSaleSessions } = await getMongoCollections();
  const row = await weaponSaleSessions.findOneAndUpdate({ _id: sessionId, ...scope(guildId, botId), status: { $nin: ["concluida", "cancelada", "expirada"] } }, {
    $set: { completedAt: new Date(), completedByUserId: actorId, status: "cancelada", updatedAt: new Date() }
  }, { returnDocument: "after" });
  if (!row) throw serviceError("Venda não pode ser cancelada.", 409);
  await logMessage(guildId, botId, row, "CANCEL", actorId, null, null, {});
  emitUpdated(guildId, botId);
  return toSessionDto(row);
}

function defaultConfig(guildId: string, botId: string | null): MongoWeaponSaleConfig {
  const now = new Date();
  return {
    _id: randomUUID(), accentColor: "#ef4444", botId, buttonText: DEFAULT_BUTTON, cancelDeleteDelaySeconds: 300, completedDeleteDelaySeconds: 300, createdAt: now,
    description: DEFAULT_DESCRIPTION, enabled: false, expirationMinutes: 120, footerImageUrl: null, guildId, imageUrl: null, logChannelId: null, managerRoleIds: [], managerUserIds: [],
    orientationText: "Envie no chat o nome da arma seguido de X e da quantidade.", panelChannelId: null, panelMessageId: null, temporaryCategoryId: null,
    temporaryChannelText: "Envie AK X10 ou AK X10, Pistola X5. Clique em Pronto para confirmar.", thumbnailUrl: null, title: DEFAULT_TITLE, updatedAt: now, updatedBy: null
  };
}

async function saveWeapons(guildId: string, botId: string | null, weapons: NonNullable<WeaponSaleConfigInput["weapons"]>, actorId: string | null) {
  const { weaponSaleWeapons } = await getMongoCollections();
  const now = new Date();
  for (const raw of weapons) {
    const name = normalizeText(raw.name, 80);
    const unitPriceInCents = normalizeCents(raw.unitPriceInCents);
    if (!name || !unitPriceInCents) continue;
    const normalizedName = normalizeLookup(name);
    const existing = raw.id ? await weaponSaleWeapons.findOne({ _id: raw.id, ...scope(guildId, botId) }) : await weaponSaleWeapons.findOne({ ...scope(guildId, botId), normalizedName });
    const id = existing?._id ?? randomUUID();
    await weaponSaleWeapons.updateOne({ _id: id, ...scope(guildId, botId) }, {
      $set: { active: raw.active !== false, botId, guildId, name, normalizedName, unitPriceInCents, updatedAt: now },
      $setOnInsert: { _id: id, createdAt: now, createdBy: actorId }
    }, { upsert: true }).catch((error) => {
      if (!isDuplicateKeyError(error)) throw error;
    });
  }
}

function assertReady(config: WeaponSaleConfigDto) {
  if (!config.enabled) throw serviceError("Sistema de Armas desativado.", 403);
  if (!config.panelChannelId) throw serviceError("Canal do painel não configurado.", 409);
  if (!config.logChannelId) throw serviceError("Canal de logs não configurado.", 409);
  if (!config.temporaryCategoryId) throw serviceError("Categoria temporária não configurada.", 409);
}

async function nextSaleCode(guildId: string, botId: string | null) {
  const { weaponSaleSessions } = await getMongoCollections();
  const last = await weaponSaleSessions.findOne(scope(guildId, botId), { sort: { createdAt: -1 } });
  const next = (Number(last?.saleCode.replace(/^ARM-/, "")) || 0) + 1;
  return `ARM-${String(next).padStart(6, "0")}`;
}

function itemFromWeapon(weapon: WeaponSaleWeaponDto, quantity: number): MongoWeaponSaleItem {
  return { quantity, subtotalInCents: quantity * weapon.unitPriceInCents, unitPriceInCents: weapon.unitPriceInCents, weaponId: weapon.id, weaponName: weapon.name };
}

function totalsOf(items: MongoWeaponSaleItem[]) {
  return { quantity: items.reduce((sum, item) => sum + item.quantity, 0), totalValueInCents: items.reduce((sum, item) => sum + item.subtotalInCents, 0) };
}

function summarizeSessions(sessions: WeaponSaleSessionDto[]) {
  const completed = sessions.filter((session) => session.status === "concluida");
  return { completedCount: completed.length, totalQuantity: completed.reduce((sum, session) => sum + session.totalQuantity, 0), totalValueInCents: completed.reduce((sum, session) => sum + session.totalValueInCents, 0) };
}

async function logMessage(guildId: string, botId: string | null, session: MongoWeaponSaleSession, action: string, authorId: string, messageId: string | null | undefined, content: string | null | undefined, metadata: Record<string, unknown>) {
  const { weaponSaleMessageLogs } = await getMongoCollections();
  await weaponSaleMessageLogs.insertOne({ _id: randomUUID(), action, authorId, botId, channelId: session.channelId, content: normalizeText(content, 1000) ?? "", createdAt: new Date(), guildId, messageId: normalizeSnowflake(messageId), metadata, sessionId: session._id }).catch((error) => {
    if (!isDuplicateKeyError(error)) throw error;
  });
}

function toConfigDto(config: MongoWeaponSaleConfig): WeaponSaleConfigDto {
  const { _id, createdAt, updatedAt, ...rest } = config;
  return { ...rest, createdAt: createdAt.toISOString(), id: _id, updatedAt: updatedAt.toISOString() };
}

function toWeaponDto(weapon: MongoWeaponSaleWeapon): WeaponSaleWeaponDto {
  const { _id, createdAt, updatedAt, ...rest } = weapon;
  return { ...rest, createdAt: createdAt.toISOString(), id: _id, updatedAt: updatedAt.toISOString() };
}

function toSessionDto(session: MongoWeaponSaleSession): WeaponSaleSessionDto {
  const { _id, createdAt, updatedAt, completedAt, expiresAt, lastActivityAt, ...rest } = session;
  return { ...rest, completedAt: completedAt?.toISOString() ?? null, createdAt: createdAt.toISOString(), expiresAt: expiresAt?.toISOString() ?? null, id: _id, lastActivityAt: lastActivityAt.toISOString(), updatedAt: updatedAt.toISOString() };
}

function emitUpdated(guildId: string, botId: string | null) {
  if (!botId) return;
  emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, botId), "fivem:weapons:updated", { botId, guildId });
  emitRealtimeToRoom(devBotRealtimeRoom(botId), "fivem:weapons:updated", { botId, guildId });
}

function scope(guildId: string, botId: string | null) {
  return botId ? { botId, guildId } : { guildId, $or: [{ botId: null }, { botId: { $exists: false } }] };
}

function normalizeQuantity(value: number) {
  const quantity = Math.trunc(value);
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1_000_000) throw serviceError("Quantidade deve ser maior que zero.", 400);
  return quantity;
}
function normalizeCents(value: number | null | undefined) { const cents = Math.trunc(value ?? 0); return Number.isSafeInteger(cents) && cents > 0 ? cents : null; }
function normalizeSnowflake(value: string | null | undefined) { return /^\d{5,32}$/.test(value?.trim() ?? "") ? value!.trim() : null; }
function normalizeSnowflakes(values: string[] | undefined) { return [...new Set((values ?? []).map(normalizeSnowflake).filter((item): item is string => Boolean(item)))]; }
function normalizeText(value: string | null | undefined, max: number) { return value?.trim().slice(0, max) || null; }
function normalizeLookup(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function normalizeColor(value: string | null | undefined) { return /^#[0-9a-f]{6}$/i.test(value ?? "") ? value! : null; }
function normalizeUrl(value: string | null | undefined) { return /^https?:\/\/.{3,2040}$/i.test(value ?? "") ? value!.trim().slice(0, 2048) : null; }
function clamp(value: number | null | undefined, min: number, max: number, fallback: number) { return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : fallback; }
function isDuplicateKeyError(error: unknown) { return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000; }
function serviceError(message: string, status = 400) { const error = new Error(message) as Error & { status?: number; statusCode?: number }; error.status = status; error.statusCode = status; return error; }

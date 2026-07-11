import { randomUUID } from "node:crypto";
import { env } from "../config/env";
import { getMongoDb } from "../database/mongo";
import { listDevBots, type DevBotDto } from "./devBotService";

type DiscloudAction = "start" | "stop" | "restart" | "redeploy";

export type DiscloudBotSnapshot = {
  botId: string;
  botName: string;
  botAvatarUrl: string | null;
  clientId: string;
  appId: string;
  appName: string;
  status: "online" | "offline" | "restarting" | "deploy" | "suspended" | "maintenance" | "unknown";
  region: string | null;
  plan: string | null;
  uptime: string | null;
  onlineSince: string | null;
  lastStartedAt: string | null;
  nodeVersion: string | null;
  memoryUsedMb: number | null;
  memoryTotalMb: number | null;
  memoryUsagePercent: number | null;
  cpuUsagePercent: number | null;
  diskUsedMb: number | null;
  diskTotalMb: number | null;
  diskUsagePercent: number | null;
  networkDown: string | null;
  networkUp: string | null;
  requestCount: number | null;
  apiPingMs: number | null;
  botPingMs: number | null;
  lastDeployAt: string | null;
  lastSyncAt: string;
  alerts: string[];
  rawStatus: string | null;
};

export type DiscloudHistoryEvent = {
  id: string;
  appId: string;
  botId: string | null;
  event: string;
  message: string;
  createdAt: string;
};

type CacheEntry = {
  expiresAt: number;
  value: Promise<DiscloudMonitoringPayload>;
};

type DiscloudHistoryDocument = {
  _id: string;
  appId: string;
  botId: string | null;
  event: string;
  message: string;
  createdAt: Date;
};

type DiscloudMonitoringPayload = {
  configured: boolean;
  bots: DiscloudBotSnapshot[];
  history: DiscloudHistoryEvent[];
  updatedAt: string;
};

const CACHE_TTL_MS = 5_000;
let monitoringCache: CacheEntry | null = null;
const DISCLOUD_API_BASE_URL = "https://api.discloud.app/v2";

export async function getDiscloudMonitoring(force = false): Promise<DiscloudMonitoringPayload> {
  if (!force && monitoringCache && monitoringCache.expiresAt > Date.now()) {
    return monitoringCache.value;
  }

  const value = readDiscloudMonitoring();
  monitoringCache = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value
  };

  return value;
}

export async function getDiscloudLogsForBot(botId: string) {
  ensureDiscloudToken();
  const bot = (await listDevBots()).find((item) => item.id === botId);
  const appId = resolveAppId(bot, botId);

  if (!appId) {
    throw createDiscloudError("Aplicacao Discloud nao vinculada a este bot.", 404);
  }

  const logs = await discloudApi(`/app/${encodeURIComponent(appId)}/logs`);
  await recordDiscloudEvent({
    appId,
    botId,
    event: "logs",
    message: `Logs da aplicacao ${appId} consultados.`
  });

  return normalizeTerminal(logs);
}

export async function runDiscloudBotAction(botId: string, action: DiscloudAction) {
  ensureDiscloudToken();
  const bot = (await listDevBots()).find((item) => item.id === botId);
  const appId = resolveAppId(bot, botId);

  if (!bot || !appId) {
    throw createDiscloudError("Aplicacao Discloud nao vinculada a este bot.", 404);
  }

  if (action === "redeploy") {
    await recordDiscloudEvent({
      appId,
      botId,
      event: "redeploy_blocked",
      message: "Redeploy automatico bloqueado. Use deploy manual na Discloud."
    });
    throw createDiscloudError("Redeploy automatico nao foi habilitado. Use deploy manual na Discloud.", 409);
  }

  await discloudApi(`/app/${encodeURIComponent(appId)}/${action}`, {
    method: "PUT"
  });

  monitoringCache = null;
  await recordDiscloudEvent({
    appId,
    botId,
    event: action,
    message: `Acao ${action} enviada para ${bot.name}.`
  });

  return getDiscloudMonitoring(true);
}

export async function runDiscloudConsoleCommand(botId: string, command: string) {
  ensureDiscloudToken();
  const bot = (await listDevBots()).find((item) => item.id === botId);
  const appId = resolveAppId(bot, botId);

  if (!appId) {
    throw createDiscloudError("Aplicacao Discloud nao vinculada a este bot.", 404);
  }

  const result = await discloudApi(`/app/${encodeURIComponent(appId)}/exec`, {
    body: JSON.stringify({ cmd: command }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "PUT"
  });
  await recordDiscloudEvent({
    appId,
    botId,
    event: "console",
    message: `Comando enviado ao console da aplicacao ${appId}.`
  });

  return {
    online: readBoolean(readPayloadValue(result, "online")),
    stderr: String(readPayloadValue(result, "stderr") ?? readPayloadValue(result, "error") ?? ""),
    stdout: String(readPayloadValue(result, "stdout") ?? readPayloadValue(result, "output") ?? readPayloadValue(result, "message") ?? "")
  };
}

async function readDiscloudMonitoring(): Promise<DiscloudMonitoringPayload> {
  const now = new Date().toISOString();

  if (!env.DISCLOUD_TOKEN.trim()) {
    return {
      configured: false,
      bots: [],
      history: [],
      updatedAt: now
    };
  }

  ensureDiscloudToken();

  const startedAt = Date.now();
  const [devBots, apps, statuses] = await Promise.all([
    listDevBots(),
    fetchAllApps().catch(() => new Map()),
    fetchAllStatuses()
  ]);
  const appById = mapFromUnknown(apps);
  const statusById = mapFromUnknown(statuses);
  const appIds = appIdsForBots(devBots, appById);
  const snapshots = await Promise.all(appIds.map(async ({ bot, appId }) => {
    const app = appById.get(appId) ?? null;
    const status = statusById.get(appId) ?? await fetchStatus(appId).catch(() => null);
    return normalizeSnapshot({
      apiPingMs: Date.now() - startedAt,
      app,
      appId,
      bot,
      status
    });
  }));

  await persistSnapshots(snapshots).catch((error) => {
    console.warn("[discloud] nao foi possivel persistir snapshots:", error instanceof Error ? error.message : error);
  });

  return {
    configured: true,
    bots: snapshots,
    history: await readDiscloudHistory(),
    updatedAt: now
  };
}

async function fetchAllApps() {
  return mapDiscloudItems(await discloudApi("/app/all"));
}

async function fetchAllStatuses() {
  const statuses = mapDiscloudItems(await discloudApi("/app/all/status").catch(() => null));

  if (statuses.size > 0) {
    return statuses;
  }

  const apps = await fetchAllApps();
  const pairs = await Promise.all([...apps.keys()].map(async (appId) => [
    appId,
    await fetchStatus(appId).catch(() => null)
  ] as const));

  return new Map(pairs.filter(([, status]) => status));
}

async function fetchStatus(appId: string) {
  const status = await discloudApi(`/app/${encodeURIComponent(appId)}/status`);
  return readPayloadValue(status, "appStatus") ?? readPayloadValue(status, "status") ?? readPayloadValue(status, "apps") ?? status;
}

async function discloudApi(path: string, init: RequestInit = {}) {
  ensureDiscloudToken();

  const response = await fetch(`${DISCLOUD_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Accept": "application/json",
      "api-token": env.DISCLOUD_TOKEN.trim(),
      ...init.headers
    }
  });
  const text = await response.text();
  const data = parseJsonResponse(text);

  if (!response.ok) {
    const message = readString(readPayloadValue(data, "message"))
      ?? readString(readPayloadValue(data, "error"))
      ?? `Erro ${response.status} na API da Discloud.`;
    throw createDiscloudError(message, response.status);
  }

  return data;
}

function ensureDiscloudToken() {
  const token = env.DISCLOUD_TOKEN.trim();

  if (!token) {
    throw createDiscloudError("DISCLOUD_TOKEN nao configurado no backend.", 503);
  }
}

function parseJsonResponse(text: string) {
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

function appIdsForBots(devBots: DevBotDto[], appById: Map<string, unknown>) {
  const explicitIds = env.DISCLOUD_APP_IDS.split(",").map((item) => item.trim()).filter(Boolean);
  const pairs = devBots.map((bot) => ({
    bot,
    appId: resolveAppId(bot, null)
  })).filter((item): item is { bot: DevBotDto; appId: string } => Boolean(item.appId));
  const used = new Set(pairs.map((item) => item.appId));

  for (const appId of explicitIds) {
    if (!used.has(appId)) {
      pairs.push({
        bot: devBotPlaceholder(appId, appById.get(appId)),
        appId
      });
      used.add(appId);
    }
  }

  return pairs;
}

function resolveAppId(bot: DevBotDto | undefined | null, fallback: string | null) {
  const map = parseAppIdMap();
  const candidates = [
    bot?.id,
    bot?.clientId,
    bot?.slug,
    fallback
  ].filter((item): item is string => Boolean(item));

  for (const candidate of candidates) {
    const mapped = map.get(candidate);
    if (mapped) return mapped;
  }

  return bot?.clientId ?? fallback;
}

function parseAppIdMap() {
  const map = new Map<string, string>();
  const raw = env.DISCLOUD_APP_ID_BY_BOT.trim();

  if (!raw) {
    return map;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string" && value.trim()) {
          map.set(key, value.trim());
        }
      }
    }
  } catch {
    for (const item of raw.split(",")) {
      const [key, value] = item.split(":").map((part) => part.trim());
      if (key && value) map.set(key, value);
    }
  }

  return map;
}

function normalizeSnapshot(input: {
  apiPingMs: number;
  app: unknown;
  appId: string;
  bot: DevBotDto;
  status: unknown;
}): DiscloudBotSnapshot {
  const app = objectRecord(input.app);
  const status = objectRecord(input.status);
  const memory = parsePair(readString(status.memory));
  const disk = parsePair(readString(status.ssd));
  const cpu = parsePercent(readString(status.cpu));
  const container = readString(status.container);
  const rawStatus = container || (readBoolean(app.online) ? "Online" : "Offline");
  const normalizedStatus = normalizeDiscloudStatus(rawStatus);
  const alerts = alertsForMetrics(normalizedStatus, cpu, readNumber(status.memoryUsage), disk.percent);
  const startedAt = readDate(status.startedAt);
  const addedAt = readDateFromTimestamp(readNumber(app.addedTimestamp));

  return {
    botId: input.bot.id,
    botName: input.bot.name,
    botAvatarUrl: input.bot.avatarUrl,
    clientId: input.bot.clientId,
    appId: input.appId,
    appName: readString(app.name) || input.bot.name,
    status: normalizedStatus,
    region: readString(app.region),
    plan: readString(app.plan),
    uptime: readString(status.lastRestart),
    onlineSince: startedAt,
    lastStartedAt: startedAt,
    nodeVersion: readString(app.lang) || "node",
    memoryUsedMb: memory.used,
    memoryTotalMb: memory.total ?? readNumber(app.ram),
    memoryUsagePercent: readNumber(status.memoryUsage) ?? memory.percent,
    cpuUsagePercent: cpu,
    diskUsedMb: disk.used,
    diskTotalMb: disk.total,
    diskUsagePercent: disk.percent,
    networkDown: readNestedString(status.netIO, "down"),
    networkUp: readNestedString(status.netIO, "up"),
    requestCount: readNumber(status.requests),
    apiPingMs: input.apiPingMs,
    botPingMs: null,
    lastDeployAt: addedAt,
    lastSyncAt: new Date().toISOString(),
    alerts,
    rawStatus
  };
}

function normalizeTerminal(logs: unknown) {
  return {
    full: String(readPayloadValue(logs, "big") ?? readPayloadValue(logs, "full") ?? readPayloadValue(logs, "logs") ?? readPayloadValue(logs, "message") ?? ""),
    small: String(readPayloadValue(logs, "small") ?? readPayloadValue(logs, "summary") ?? ""),
    updatedAt: new Date().toISOString()
  };
}

async function persistSnapshots(snapshots: DiscloudBotSnapshot[]) {
  const db = await getMongoDb();
  const now = new Date();

  await Promise.all(snapshots.map(async (snapshot) => {
    const previous = await db.collection("discloud_bot_status").findOne({ appId: snapshot.appId });

    await db.collection("discloud_bot_status").updateOne(
      { appId: snapshot.appId },
      {
        $set: {
          ...snapshot,
          updatedAt: now
        },
        $setOnInsert: {
          createdAt: now
        }
      },
      { upsert: true }
    );

    if (previous?.status && previous.status !== snapshot.status) {
      await recordDiscloudEvent({
        appId: snapshot.appId,
        botId: snapshot.botId,
        event: "status_change",
        message: `${snapshot.appName} mudou de ${previous.status} para ${snapshot.status}.`
      });
    }

    for (const alert of snapshot.alerts) {
      await recordDiscloudEvent({
        appId: snapshot.appId,
        botId: snapshot.botId,
        event: "alert",
        message: alert
      });
    }
  }));
}

async function recordDiscloudEvent(input: { appId: string; botId: string | null; event: string; message: string }) {
  const db = await getMongoDb();
  const now = new Date();

  await db.collection<DiscloudHistoryDocument>("discloud_monitoring_history").insertOne({
    _id: randomUUID(),
    ...input,
    createdAt: now
  });
}

async function readDiscloudHistory(): Promise<DiscloudHistoryEvent[]> {
  const db = await getMongoDb();
  const items = await db.collection<DiscloudHistoryDocument>("discloud_monitoring_history")
    .find()
    .sort({ createdAt: -1 })
    .limit(80)
    .toArray();

  return items.map((item) => ({
    id: String(item._id),
    appId: String(item.appId ?? ""),
    botId: typeof item.botId === "string" ? item.botId : null,
    event: String(item.event ?? "event"),
    message: String(item.message ?? ""),
    createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : new Date().toISOString()
  }));
}

function alertsForMetrics(status: DiscloudBotSnapshot["status"], cpu: number | null, memory: number | null, disk: number | null) {
  const alerts: string[] = [];

  if (status === "offline") alerts.push("Bot offline na Discloud.");
  if ((cpu ?? 0) >= 90) alerts.push("CPU acima de 90%.");
  if ((memory ?? 0) >= 90) alerts.push("RAM acima de 90%.");
  if ((disk ?? 0) >= 90) alerts.push("Disco acima de 90%.");

  return alerts;
}

function normalizeDiscloudStatus(value: string): DiscloudBotSnapshot["status"] {
  const normalized = value.trim().toLowerCase();

  if (normalized.includes("online")) return "online";
  if (normalized.includes("restart") || normalized.includes("reinici")) return "restarting";
  if (normalized.includes("deploy") || normalized.includes("build")) return "deploy";
  if (normalized.includes("suspend")) return "suspended";
  if (normalized.includes("maintenance") || normalized.includes("manuten")) return "maintenance";
  if (normalized.includes("offline") || normalized.includes("stop")) return "offline";

  return "unknown";
}

function parsePair(value: string | null) {
  if (!value) return { percent: null, total: null, used: null };
  const numbers = [...value.matchAll(/(\d+(?:[.,]\d+)?)/g)].map((match) => Number((match[1] ?? "0").replace(",", ".")));
  const percent = parsePercent(value);

  return {
    used: numbers[0] ?? null,
    total: numbers[1] ?? null,
    percent
  };
}

function parsePercent(value: string | null) {
  if (!value) return null;
  const match = value.match(/(\d+(?:[.,]\d+)?)\s*%/);
  return match?.[1] ? Number(match[1].replace(",", ".")) : null;
}

function mapFromUnknown(value: unknown) {
  if (value instanceof Map) {
    return new Map([...value.entries()].map(([key, item]) => [String(key), item]));
  }

  return mapDiscloudItems(value);
}

function mapDiscloudItems(value: unknown) {
  const payload = readPayloadValue(value, "apps") ?? readPayloadValue(value, "app") ?? value;

  if (Array.isArray(payload)) {
    return new Map(payload.map((item) => [readItemId(item), item]).filter((item): item is [string, unknown] => Boolean(item[0])));
  }

  if (payload && typeof payload === "object") {
    const object = payload as Record<string, unknown>;
    return new Map(Object.entries(object).map(([key, item]) => [readItemId(item) ?? key, item]));
  }

  return new Map<string, unknown>();
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readItemId(value: unknown) {
  const object = objectRecord(value);
  return readString(object.id)
    ?? readString(object.appId)
    ?? readString(object.appID)
    ?? readString(object.app_id)
    ?? readString(object.containerId)
    ?? readString(object.containerID);
}

function readPayloadValue(value: unknown, key: string): unknown {
  const object = objectRecord(value);
  return object[key];
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBoolean(value: unknown) {
  return value === true;
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", ".").replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function readDateFromTimestamp(value: number | null) {
  if (!value) return null;
  const timestamp = value < 10_000_000_000 ? value * 1000 : value;
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function readNestedString(value: unknown, key: string) {
  const object = objectRecord(value);
  return readString(object[key]);
}

function devBotPlaceholder(appId: string, app: unknown): DevBotDto {
  const appObject = objectRecord(app);

  return {
    id: appId,
    name: readString(appObject.name) ?? appId,
    slug: appId,
    dashboardUrl: "",
    clientId: appId,
    databaseName: "",
    tokenMasked: "",
    secretConfigured: false,
    avatarUrl: readString(appObject.avatarURL),
    ownerId: "",
    ownerName: "",
    mainGuildId: "",
    mainGuildName: "",
    mainGuildIconUrl: null,
    mainGuildMemberCount: 0,
    mainGuildChannelCount: 0,
    botCreatedAt: null,
    guildIds: [],
    status: "offline",
    statusMessage: null,
    enabledModules: [],
    desiredOnline: true,
    accessLevel: "admin",
    permissions: {
      canAccessDashboard: true,
      canConfigureGuilds: true,
      canManageAccess: true,
      canManageBots: true,
      canManageDashboard: true,
      canManageGlobalSettings: true,
      canManageGuilds: true,
      canManageModules: true,
      canManageOwnServices: true,
      canManageUsers: true,
      canUsePremium: true,
      canViewUsers: true
    },
    createdBy: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function createDiscloudError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

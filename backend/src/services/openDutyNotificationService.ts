import { randomUUID } from "node:crypto";
import { getMongoCollections, type MongoOpenDutyNotification, type MongoOpenDutySettings } from "../database/mongo";
import { devBotRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";

export const OPEN_DUTY_MODULE_ID = "police-open-duty";

export type OpenDutySettingsDto = ReturnType<typeof mapSettings>;
export type OpenDutyNotificationDto = ReturnType<typeof mapNotification>;
export type OpenDutyDashboard = {
  counters: Array<{ lastNotifiedAt: string | null; total: number; userId: string }>;
  history: OpenDutyNotificationDto[];
  settings: OpenDutySettingsDto;
};

export type OpenDutyDeliveryInput = {
  edited: boolean;
  errorReason?: string | null;
  executorId: string;
  message: string;
  status: "sent" | "failed" | "cancelled" | "denied";
  targetId: string;
};

export const DEFAULT_OPEN_DUTY_MESSAGE = `Prezada(o) {usuario}:

Verificamos que seu ponto de serviço permanece aberto mesmo sem estar em atividade. Reforçamos que essa prática não está de acordo com as diretrizes do departamento.

Pedimos que, ao encerrar o serviço ou se ausentar, feche corretamente o ponto. Caso a situação continue ocorrendo, poderá haver aplicação de multa administrativa.

Se você esqueceu o ponto aberto, por favor, justifique em North Police Department 📑│justificar-ponto.`;

export const DEFAULT_OPEN_DUTY_ALERT = "O usuário atingiu 3 avisos verbais por manter o ponto aberto sem estar em atividade. Verifique a possibilidade de multa administrativa conforme as diretrizes do departamento.";

export async function getOpenDutyDashboard(botId: string | null, guildId: string): Promise<OpenDutyDashboard> {
  const { openDutyCounters, openDutyNotifications } = await getMongoCollections();
  const [settings, counters, history] = await Promise.all([
    getOpenDutySettings(botId, guildId),
    openDutyCounters.find(scope(botId, guildId)).sort({ updatedAt: -1 }).limit(100).toArray(),
    openDutyNotifications.find(scope(botId, guildId)).sort({ createdAt: -1 }).limit(100).toArray()
  ]);
  return {
    counters: counters.map((counter) => ({ userId: counter.userId, total: counter.total, lastNotifiedAt: counter.lastNotifiedAt?.toISOString() ?? null })),
    history: history.map(mapNotification),
    settings
  };
}

export async function getOpenDutySettings(botId: string | null, guildId: string) {
  const { openDutySettings } = await getMongoCollections();
  const existing = await openDutySettings.findOne(scope(botId, guildId));
  if (existing) return mapSettings(existing);

  const now = new Date();
  const doc: MongoOpenDutySettings = {
    _id: randomUUID(),
    botId,
    guildId,
    enabled: true,
    logChannelId: null,
    alertChannelId: null,
    allowedRoleIds: [],
    allowedUserIds: [],
    defaultMessage: DEFAULT_OPEN_DUTY_MESSAGE,
    alertMessage: DEFAULT_OPEN_DUTY_ALERT,
    dmBannerUrl: null,
    panelBannerUrl: null,
    footerImageUrl: null,
    footerText: "North Police Department",
    footerIconUrl: null,
    imagePosition: "top",
    panelColor: "#2563eb",
    buttonEmojis: {
      send: "📩",
      edit: "✏️",
      cancel: "❌",
      config: "⚙️",
      logs: "🧾",
      reset: "🔄",
      search: "🔍",
      save: "💾"
    },
    counterMode: "reset_after_3",
    updatedAt: now,
    updatedBy: null
  };
  await openDutySettings.insertOne(doc);
  return mapSettings(doc);
}

export async function saveOpenDutySettings(botId: string | null, guildId: string, input: Partial<Omit<OpenDutySettingsDto, "id" | "botId" | "guildId" | "updatedAt">>, actorId: string | null) {
  const { openDutySettings } = await getMongoCollections();
  const now = new Date();
  await openDutySettings.updateOne(scope(botId, guildId), {
    $set: {
      ...cleanSettings(input),
      updatedAt: now,
      updatedBy: actorId
    },
    $setOnInsert: {
      _id: randomUUID(),
      botId,
      guildId
    }
  }, { upsert: true });
  if (botId) {
    emitRealtimeToRoom(devBotRealtimeRoom(botId), "open-duty:settings_updated", { botId, guildId });
  }
  return getOpenDutySettings(botId, guildId);
}

export async function recordOpenDutyDelivery(botId: string | null, guildId: string, input: OpenDutyDeliveryInput) {
  const { openDutyCounters, openDutyNotifications } = await getMongoCollections();
  const settings = await getOpenDutySettings(botId, guildId);
  const now = new Date();
  let counterTotal = 0;
  let alertTriggered = false;

  if (input.status === "sent") {
    const current = await openDutyCounters.findOne({ ...scope(botId, guildId), userId: input.targetId });
    const nextTotal = (current?.total ?? 0) + 1;
    counterTotal = nextTotal;
    alertTriggered = shouldTriggerFineLog(nextTotal);
    const storedTotal = nextTotal >= 3 ? 0 : nextTotal;
    await openDutyCounters.updateOne({ ...scope(botId, guildId), userId: input.targetId }, {
      $set: {
        total: storedTotal,
        lastNotifiedAt: now,
        updatedAt: now
      },
      $setOnInsert: {
        _id: randomUUID(),
        botId,
        guildId,
        userId: input.targetId
      }
    }, { upsert: true });
  }

  const doc: MongoOpenDutyNotification = {
    _id: randomUUID(),
    botId,
    guildId,
    executorId: input.executorId,
    targetId: input.targetId,
    message: input.message,
    edited: input.edited,
    status: input.status,
    errorReason: input.errorReason ?? null,
    counterTotal,
    alertTriggered,
    createdAt: now
  };
  await openDutyNotifications.insertOne(doc);
  return { alertTriggered, counterTotal, notification: mapNotification(doc), settings };
}

export async function resetOpenDutyCounter(botId: string | null, guildId: string, userId: string) {
  const { openDutyCounters } = await getMongoCollections();
  const now = new Date();
  await openDutyCounters.updateOne({ ...scope(botId, guildId), userId }, {
    $set: { total: 0, updatedAt: now },
    $setOnInsert: { _id: randomUUID(), botId, guildId, userId, lastNotifiedAt: null }
  }, { upsert: true });
  return { userId, total: 0 };
}

function shouldTriggerFineLog(total: number) {
  return total === 2 || total >= 3;
}

function mapSettings(settings: MongoOpenDutySettings) {
  return {
    id: settings._id,
    botId: settings.botId,
    guildId: settings.guildId,
    enabled: settings.enabled,
    logChannelId: settings.logChannelId,
    alertChannelId: settings.alertChannelId,
    allowedRoleIds: settings.allowedRoleIds,
    allowedUserIds: settings.allowedUserIds,
    defaultMessage: settings.defaultMessage,
    alertMessage: settings.alertMessage,
    dmBannerUrl: settings.dmBannerUrl,
    panelBannerUrl: settings.panelBannerUrl,
    footerImageUrl: settings.footerImageUrl,
    footerText: settings.footerText,
    footerIconUrl: settings.footerIconUrl,
    imagePosition: settings.imagePosition,
    panelColor: settings.panelColor,
    buttonEmojis: settings.buttonEmojis,
    counterMode: settings.counterMode,
    updatedAt: settings.updatedAt.toISOString(),
    updatedBy: settings.updatedBy
  };
}

function mapNotification(notification: MongoOpenDutyNotification) {
  return {
    id: notification._id,
    botId: notification.botId,
    guildId: notification.guildId,
    executorId: notification.executorId,
    targetId: notification.targetId,
    message: notification.message,
    edited: notification.edited,
    status: notification.status,
    errorReason: notification.errorReason,
    counterTotal: notification.counterTotal,
    alertTriggered: notification.alertTriggered,
    createdAt: notification.createdAt.toISOString()
  };
}

function cleanSettings(input: Partial<Omit<OpenDutySettingsDto, "id" | "botId" | "guildId" | "updatedAt">>) {
  return {
    ...input,
    logChannelId: normalizeNullable(input.logChannelId),
    alertChannelId: normalizeNullable(input.alertChannelId),
    dmBannerUrl: normalizeNullable(input.dmBannerUrl),
    panelBannerUrl: normalizeNullable(input.panelBannerUrl),
    footerImageUrl: normalizeNullable(input.footerImageUrl),
    footerText: normalizeNullable(input.footerText),
    footerIconUrl: normalizeNullable(input.footerIconUrl)
  };
}

function normalizeNullable(value: string | null | undefined) {
  if (value === undefined) return undefined;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function scope(botId: string | null, guildId: string) {
  return { botId, guildId };
}

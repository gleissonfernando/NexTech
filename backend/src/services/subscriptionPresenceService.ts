import { randomUUID } from "node:crypto";
import type {
  MongoSubscriptionPresenceButton,
  MongoSubscriptionPresenceLog,
  MongoSubscriptionPresencePhotoMode,
  MongoSubscriptionPresencePlan,
  MongoSubscriptionPresenceProduct,
  MongoSubscriptionPresenceSettings
} from "../database/mongo";
import { getMongoCollections } from "../database/mongo";
import { createLog } from "./logService";

export const SUBSCRIPTION_PRESENCE_MODULE_ID = "subscription-presence";

export type SubscriptionPresenceButtonDto = MongoSubscriptionPresenceButton;
export type SubscriptionPresencePlanDto = MongoSubscriptionPresencePlan;
export type SubscriptionPresenceSettingsDto = Omit<MongoSubscriptionPresenceSettings, "_id" | "createdAt" | "updatedAt"> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};
export type SubscriptionPresenceProductDto = Omit<MongoSubscriptionPresenceProduct, "_id" | "createdAt" | "updatedAt"> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};
export type SubscriptionPresenceLogDto = Omit<MongoSubscriptionPresenceLog, "_id" | "createdAt"> & {
  id: string;
  createdAt: string;
};

export type SaveSubscriptionPresenceSettingsInput = Partial<{
  buttons: SubscriptionPresenceButtonDto[];
  channelId: string | null;
  companyAvatarUrl: string | null;
  companyDocsUrl: string | null;
  companyName: string;
  companySupportUrl: string | null;
  companyWebsiteUrl: string | null;
  enabled: boolean;
  footerText: string | null;
  messageEnabled: boolean;
  messageTemplate: string;
  panelColor: string;
  photoMode: MongoSubscriptionPresencePhotoMode;
  pingBuyer: boolean;
  pingRoles: boolean;
  showAvatar: boolean;
  showTimestamp: boolean;
  storeUrl: string | null;
  title: string;
}>;

export type SaveSubscriptionPresenceProductInput = {
  active: boolean;
  category: string;
  color: string;
  emoji?: string | null;
  iconUrl?: string | null;
  matchNames?: string[];
  name: string;
  order?: number;
  plans: SubscriptionPresencePlanDto[];
};

export type SubscriptionPresencePublicationInput = {
  amountCents: number;
  buyerId: string;
  buyerName?: string | null;
  currency: "BRL" | "USD" | "EUR";
  gateway?: string | null;
  moduleId?: string | null;
  paymentMethod?: string | null;
  approvedAt?: string | null;
  planName: string;
  productId?: string | null;
  productName?: string | null;
  productPlanType?: string | null;
  saleId: string;
};

export type SubscriptionPresencePublicationDto = {
  logId: string | null;
  product: SubscriptionPresenceProductDto | null;
  selectedPlan: SubscriptionPresencePlanDto | null;
  settings: SubscriptionPresenceSettingsDto;
  shouldSend: boolean;
  skipReason: string | null;
};

const DEFAULT_BUTTONS: SubscriptionPresenceButtonDto[] = [
  { enabled: true, emoji: ":dinheiro:", label: "Loja", order: 1, style: "link", type: "store", url: null },
  { enabled: true, emoji: ":folha:", label: "Documentação", order: 2, style: "link", type: "docs", url: null },
  { enabled: true, emoji: ":interrogacao:", label: "Suporte", order: 3, style: "link", type: "support", url: null },
  { enabled: true, emoji: ":link:", label: "Website", order: 4, style: "link", type: "website", url: null }
];

const DEFAULT_MESSAGE = [
  "Obrigado por confiar em nossa equipe.",
  "Desejamos uma excelente experiência com {produto}.",
  "Seja muito bem-vindo à {empresa}."
].join("\n");

const DEFAULT_PLANS: SubscriptionPresencePlanDto[] = [
  { color: null, emoji: ":calendario:", enabled: true, id: "mensal", name: "Mensal", order: 1, roleId: null },
  { color: null, emoji: ":relogio:", enabled: true, id: "trimestral", name: "Trimestral", order: 2, roleId: null },
  { color: null, emoji: ":prancheta:", enabled: true, id: "semestral", name: "Semestral", order: 3, roleId: null },
  { color: null, emoji: ":trofeu:", enabled: true, id: "anual", name: "Anual", order: 4, roleId: null },
  { color: null, emoji: ":visto:", enabled: true, id: "vitalicio", name: "Vitalício", order: 5, roleId: null }
];

export async function getSubscriptionPresenceDashboard(botId: string, guildId: string) {
  const { subscriptionPresenceLogs, subscriptionPresenceProducts } = await getMongoCollections();
  const settings = await ensureSubscriptionPresenceSettings(botId, guildId, null);
  const [products, logs] = await Promise.all([
    subscriptionPresenceProducts.find({ botId, guildId }).sort({ order: 1, updatedAt: -1 }).toArray(),
    subscriptionPresenceLogs.find({ botId, guildId }).sort({ createdAt: -1 }).limit(100).toArray()
  ]);

  return {
    logs: logs.map(toLogDto),
    products: products.map(toProductDto),
    settings: toSettingsDto(settings)
  };
}

export async function ensureSubscriptionPresenceSettings(botId: string, guildId: string, actorId: string | null) {
  const { subscriptionPresenceSettings } = await getMongoCollections();
  const existing = await subscriptionPresenceSettings.findOne({ botId, guildId });
  if (existing) return normalizeSettings(existing);

  const now = new Date();
  const settings: MongoSubscriptionPresenceSettings = {
    _id: randomUUID(),
    botId,
    buttons: DEFAULT_BUTTONS.map((button) => ({ ...button })),
    channelId: null,
    companyAvatarUrl: null,
    companyDocsUrl: null,
    companyName: "NextTech",
    companySupportUrl: null,
    companyWebsiteUrl: null,
    createdAt: now,
    enabled: false,
    footerText: "Obrigado por adquirir nossos produtos.\nEquipe NexTech.",
    guildId,
    messageEnabled: true,
    messageTemplate: DEFAULT_MESSAGE,
    panelColor: "#FFD500",
    photoMode: "avatar",
    pingBuyer: false,
    pingRoles: false,
    showAvatar: true,
    showTimestamp: true,
    storeUrl: null,
    title: "Nova Compra Realizada",
    updatedAt: now,
    updatedBy: actorId
  };

  await subscriptionPresenceSettings.insertOne(settings);
  return settings;
}

export async function saveSubscriptionPresenceSettings(
  botId: string,
  guildId: string,
  input: SaveSubscriptionPresenceSettingsInput,
  actorId: string
) {
  const current = await ensureSubscriptionPresenceSettings(botId, guildId, actorId);
  const now = new Date();
  const patch: Partial<MongoSubscriptionPresenceSettings> = {
    updatedAt: now,
    updatedBy: actorId
  };

  for (const key of [
    "channelId",
    "companyAvatarUrl",
    "companyDocsUrl",
    "companyName",
    "companySupportUrl",
    "companyWebsiteUrl",
    "enabled",
    "footerText",
    "messageEnabled",
    "messageTemplate",
    "photoMode",
    "pingBuyer",
    "pingRoles",
    "showAvatar",
    "showTimestamp",
    "storeUrl",
    "title"
  ] as const) {
    if (input[key] !== undefined) {
      (patch as Record<string, unknown>)[key] = normalizeNullableSetting(input[key]);
    }
  }

  if (input.panelColor !== undefined) patch.panelColor = normalizeColor(input.panelColor, current.panelColor);
  if (input.buttons !== undefined) patch.buttons = normalizeButtons(input.buttons, current.buttons);

  const { subscriptionPresenceSettings } = await getMongoCollections();
  await subscriptionPresenceSettings.updateOne({ botId, guildId }, { $set: patch });
  const saved = await subscriptionPresenceSettings.findOne({ botId, guildId });
  return toSettingsDto(saved ?? { ...current, ...patch });
}

export async function saveSubscriptionPresenceProduct(
  botId: string,
  guildId: string,
  productId: string | null,
  input: SaveSubscriptionPresenceProductInput,
  actorId: string
) {
  const { subscriptionPresenceProducts } = await getMongoCollections();
  const now = new Date();
  const product: MongoSubscriptionPresenceProduct = {
    _id: productId || randomUUID(),
    active: input.active !== false,
    botId,
    category: input.category?.trim().slice(0, 80) || "Produto digital",
    color: normalizeColor(input.color, "#FFD500"),
    createdAt: now,
    emoji: normalizeNullableText(input.emoji, 80),
    guildId,
    iconUrl: normalizeUrl(input.iconUrl),
    matchNames: normalizeMatchNames(input.matchNames?.length ? input.matchNames : [input.name]),
    name: input.name.trim().slice(0, 100),
    order: Math.max(0, Math.trunc(input.order ?? 0)),
    plans: normalizePlans(input.plans),
    updatedAt: now,
    updatedBy: actorId
  };

  if (!product.name) throw Object.assign(new Error("Nome do produto é obrigatório."), { statusCode: 400 });

  const existing = productId ? await subscriptionPresenceProducts.findOne({ _id: productId, botId, guildId }) : null;
  await subscriptionPresenceProducts.updateOne(
    { _id: product._id, botId, guildId },
    {
      $set: {
        active: product.active,
        category: product.category,
        color: product.color,
        emoji: product.emoji,
        iconUrl: product.iconUrl,
        matchNames: product.matchNames,
        name: product.name,
        order: product.order,
        plans: product.plans,
        updatedAt: now,
        updatedBy: actorId
      },
      $setOnInsert: {
        _id: product._id,
        botId,
        createdAt: existing?.createdAt ?? now,
        guildId
      }
    },
    { upsert: true }
  );

  const saved = await subscriptionPresenceProducts.findOne({ _id: product._id, botId, guildId });
  return toProductDto(saved ?? product);
}

export async function deleteSubscriptionPresenceProduct(botId: string, guildId: string, productId: string) {
  const { subscriptionPresenceProducts } = await getMongoCollections();
  await subscriptionPresenceProducts.deleteOne({ _id: productId, botId, guildId });
}

export async function createSubscriptionPresencePublication(
  botId: string,
  guildId: string,
  input: SubscriptionPresencePublicationInput
): Promise<SubscriptionPresencePublicationDto> {
  const { subscriptionPresenceLogs, subscriptionPresenceProducts } = await getMongoCollections();
  const settings = await ensureSubscriptionPresenceSettings(botId, guildId, null);
  const settingsDto = toSettingsDto(settings);
  const existing = await subscriptionPresenceLogs.findOne({ botId, guildId, saleId: input.saleId });

  if (existing) {
    return {
      logId: existing._id,
      product: null,
      selectedPlan: null,
      settings: settingsDto,
      shouldSend: false,
      skipReason: "Compra já processada pelo Pagamento de Presença."
    };
  }

  const product = await matchProduct(botId, guildId, input.productName ?? input.planName);
  const selectedPlan = matchPlan(product, input.planName, input.productPlanType);
  const productName = product?.name ?? input.productName ?? input.planName;
  const approvedAt = normalizeDate(input.approvedAt) ?? new Date();
  const log: MongoSubscriptionPresenceLog = {
    _id: randomUUID(),
    amountCents: input.amountCents,
    botId,
    buyerId: input.buyerId,
    buyerName: input.buyerName ?? null,
    channelId: settings.channelId,
    createdAt: new Date(),
    currency: input.currency,
    error: null,
    gateway: input.gateway ?? null,
    guildId,
    moduleId: input.moduleId ?? null,
    messageId: null,
    paymentMethod: input.paymentMethod ?? null,
    approvedAt,
    planName: selectedPlan?.name ?? input.planName,
    productId: input.productId ?? null,
    productName,
    saleId: input.saleId,
    status: settings.enabled && settings.messageEnabled && settings.channelId ? "pending" : "skipped"
  };

  let inserted = true;
  await subscriptionPresenceLogs.insertOne(log).catch((error: unknown) => {
    if (isDuplicateKeyError(error)) {
      inserted = false;
      return;
    }
    throw error;
  });

  if (!inserted) {
    const duplicate = await subscriptionPresenceLogs.findOne({ botId, guildId, saleId: input.saleId });
    return {
      logId: duplicate?._id ?? null,
      product: product ? toProductDto(product) : null,
      selectedPlan,
      settings: settingsDto,
      shouldSend: false,
      skipReason: "Compra já processada pelo Pagamento de Presença."
    };
  }

  if (!settings.enabled || !settings.messageEnabled) {
    await updateLogError(log._id, "Pagamento de Presença desativado.");
    return { logId: log._id, product: product ? toProductDto(product) : null, selectedPlan, settings: settingsDto, shouldSend: false, skipReason: "Sistema desativado." };
  }

  if (!settings.channelId) {
    await updateLogError(log._id, "Canal do Pagamento de Presença não configurado.");
    return { logId: log._id, product: product ? toProductDto(product) : null, selectedPlan, settings: settingsDto, shouldSend: false, skipReason: "Canal não configurado." };
  }

  return {
    logId: log._id,
    product: product ? toProductDto(product) : fallbackProductDto(botId, guildId, productName, input.productPlanType),
    selectedPlan,
    settings: settingsDto,
    shouldSend: true,
    skipReason: null
  };
}

export async function completeSubscriptionPresencePublication(
  botId: string,
  guildId: string,
  logId: string,
  input: { channelId?: string | null; error?: string | null; messageId?: string | null; saleId: string; status: "sent" | "failed" | "skipped" }
) {
  const { subscriptionPresenceLogs } = await getMongoCollections();
  await subscriptionPresenceLogs.updateOne(
    { _id: logId, botId, guildId, saleId: input.saleId },
    {
      $set: {
        channelId: input.channelId ?? null,
        error: input.error ?? null,
        messageId: input.messageId ?? null,
        status: input.status
      }
    }
  );

  await createLog({
    botId,
    guildId,
    message: input.status === "sent" ? "Pagamento de Presença publicado." : "Pagamento de Presença não publicado.",
    metadata: { logId, saleId: input.saleId, status: input.status, error: input.error ?? null },
    type: "payment_presence.publication"
  }).catch(() => null);
}

export function toSettingsDto(settings: MongoSubscriptionPresenceSettings): SubscriptionPresenceSettingsDto {
  const normalized = normalizeSettings(settings);
  return {
    ...normalized,
    id: normalized._id,
    createdAt: normalized.createdAt.toISOString(),
    updatedAt: normalized.updatedAt.toISOString()
  };
}

export function toProductDto(product: MongoSubscriptionPresenceProduct): SubscriptionPresenceProductDto {
  return {
    ...product,
    id: product._id,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString()
  };
}

function toLogDto(log: MongoSubscriptionPresenceLog): SubscriptionPresenceLogDto {
  return {
    ...log,
    id: log._id,
    createdAt: log.createdAt.toISOString()
  };
}

function normalizeSettings(settings: MongoSubscriptionPresenceSettings): MongoSubscriptionPresenceSettings {
  return {
    ...settings,
    buttons: normalizeButtons(settings.buttons, DEFAULT_BUTTONS),
    companyName: settings.companyName || "NextTech",
    footerText: settings.footerText ?? "Obrigado por adquirir nossos produtos.\nEquipe NexTech.",
    messageTemplate: settings.messageTemplate || DEFAULT_MESSAGE,
    panelColor: normalizeColor(settings.panelColor, "#FFD500"),
    photoMode: ["avatar", "company", "product"].includes(settings.photoMode) ? settings.photoMode : "avatar",
    showAvatar: settings.showAvatar !== false,
    showTimestamp: settings.showTimestamp !== false,
    title: settings.title || "Nova Compra Realizada"
  };
}

function normalizeButtons(value: unknown, fallback: SubscriptionPresenceButtonDto[]) {
  const source = Array.isArray(value) ? value : fallback;
  const buttons = source
    .map((item, index): SubscriptionPresenceButtonDto | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const type = ["store", "docs", "support", "website", "custom"].includes(String(record.type)) ? String(record.type) as SubscriptionPresenceButtonDto["type"] : "custom";
      const style = ["primary", "secondary", "success", "danger", "link"].includes(String(record.style)) ? String(record.style) as SubscriptionPresenceButtonDto["style"] : "link";
      const label = normalizeNullableText(record.label, 80) ?? "Abrir";
      return {
        enabled: record.enabled !== false,
        emoji: normalizeNullableText(record.emoji, 80),
        label,
        order: Math.max(1, Math.trunc(Number(record.order ?? index + 1))),
        style,
        type,
        url: normalizeUrl(record.url)
      };
    })
    .filter((button): button is SubscriptionPresenceButtonDto => Boolean(button))
    .slice(0, 4)
    .sort((left, right) => left.order - right.order)
    .map((button, index) => ({ ...button, order: index + 1 }));

  return buttons.length ? buttons : fallback.map((button) => ({ ...button }));
}

function normalizePlans(value: unknown): SubscriptionPresencePlanDto[] {
  const source = Array.isArray(value) && value.length ? value : DEFAULT_PLANS;
  const plans = source
    .map((item, index): SubscriptionPresencePlanDto | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const name = normalizeNullableText(record.name, 80);
      if (!name) return null;
      return {
        color: normalizeNullableText(record.color, 20),
        emoji: normalizeNullableText(record.emoji, 80),
        enabled: record.enabled !== false,
        id: normalizeNullableText(record.id, 80) ?? slug(name),
        name,
        order: Math.max(1, Math.trunc(Number(record.order ?? index + 1))),
        roleId: normalizeSnowflake(record.roleId)
      };
    })
    .filter((plan): plan is SubscriptionPresencePlanDto => Boolean(plan))
    .slice(0, 20)
    .sort((left, right) => left.order - right.order)
    .map((plan, index) => ({ ...plan, order: index + 1 }));

  return plans.length ? plans : DEFAULT_PLANS.map((plan) => ({ ...plan }));
}

async function matchProduct(botId: string, guildId: string, productName: string) {
  const { subscriptionPresenceProducts } = await getMongoCollections();
  const products = await subscriptionPresenceProducts.find({ botId, guildId, active: true }).sort({ order: 1, updatedAt: -1 }).toArray();
  const target = normalizeMatch(productName);
  return products.find((product) => product.matchNames.some((name) => normalizeMatch(name) === target) || normalizeMatch(product.name) === target) ?? null;
}

function matchPlan(product: MongoSubscriptionPresenceProduct | null, planName: string, productPlanType: string | null | undefined) {
  const plans = product?.plans.filter((plan) => plan.enabled !== false) ?? [];
  const targets = [planName, productPlanType ?? ""].map(normalizeMatch).filter(Boolean);
  return plans.find((plan) => targets.includes(normalizeMatch(plan.name)) || targets.includes(normalizeMatch(plan.id))) ?? null;
}

function fallbackProductDto(botId: string, guildId: string, productName: string, category: string | null | undefined): SubscriptionPresenceProductDto {
  const now = new Date().toISOString();
  return {
    active: true,
    botId,
    category: category || "Produto digital",
    color: "#FFD500",
    createdAt: now,
    emoji: ":caixa:",
    guildId,
    iconUrl: null,
    id: "runtime",
    matchNames: [productName],
    name: productName,
    order: 0,
    plans: DEFAULT_PLANS.map((plan) => ({ ...plan })),
    updatedAt: now,
    updatedBy: null
  };
}

function updateLogError(logId: string, error: string) {
  return getMongoCollections().then(({ subscriptionPresenceLogs }) => subscriptionPresenceLogs.updateOne({ _id: logId }, { $set: { error } }));
}

function normalizeNullableSetting(value: unknown) {
  return typeof value === "string" ? value.trim() || null : value;
}

function normalizeNullableText(value: unknown, maxLength: number) {
  const normalized = typeof value === "string" ? value.trim().slice(0, maxLength) : "";
  return normalized || null;
}

function normalizeUrl(value: unknown) {
  const normalized = normalizeNullableText(value, 2048);
  return normalized && /^https?:\/\//i.test(normalized) ? normalized : null;
}

function normalizeDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeColor(value: unknown, fallback: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : fallback;
}

function normalizeSnowflake(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^\d{5,32}$/.test(normalized) ? normalized : null;
}

function normalizeMatchNames(value: unknown) {
  return [...new Set((Array.isArray(value) ? value : []).map(String).map((item) => item.trim()).filter(Boolean).slice(0, 20))];
}

function normalizeMatch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function slug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || randomUUID();
}

function isDuplicateKeyError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === 11000;
}

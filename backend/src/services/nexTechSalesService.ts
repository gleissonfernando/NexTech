import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  MongoNexTechProduct,
  MongoNexTechProductFeatureKey,
  MongoNexTechProductPlanConfig,
  MongoNexTechSale,
  MongoNexTechSalePlanType,
  MongoNexTechSalesPaymentProvider,
  MongoNexTechSalesPlan,
  MongoNexTechSalesSettings,
  MongoNexTechSaleStatus,
  MongoNexTechSubscription
} from "../database/mongo";
import { getMongoCollections } from "../database/mongo";
import { env } from "../config/env";
import { createMercadoPagoPreference as createMercadoPagoCheckoutPreference } from "./mercadoPagoService";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoom } from "../realtime/events";
import { decryptSecret, encryptSecret } from "./secretCryptoService";

export const NEX_TECH_SALES_MODULE_ID = "nex-tech-sales";
export const NEX_TECH_PRIMARY_CLIENT_ID = "1492325134550302952";

export type NexTechSalesSettingsDto = Omit<MongoNexTechSalesSettings, "_id" | "createdAt" | "updatedAt" | "paymentProviders"> & {
  id: string;
  createdAt: string;
  updatedAt: string;
  paymentProviders: NexTechSalesPaymentProviderDto[];
};

export type NexTechSalesPaymentProviderDto = Omit<MongoNexTechSalesPaymentProvider, "secretEncrypted" | "webhookSecretEncrypted" | "updatedAt"> & {
  secretConfigured: boolean;
  secretMasked: string | null;
  webhookSecretConfigured: boolean;
  updatedAt: string;
};

export type NexTechSalesPlanDto = Omit<MongoNexTechSalesPlan, "_id" | "createdAt" | "updatedAt"> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type NexTechProductDto = Omit<MongoNexTechProduct, "_id" | "createdAt" | "updatedAt"> & {
  id: string;
  publicUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type NexTechSaleDto = Omit<MongoNexTechSale, "_id" | "createdAt" | "updatedAt" | "paidAt" | "expiresAt"> & {
  id: string;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  expiresAt: string | null;
};

export type NexTechSaleDeliveryResultInput = {
  deliveredRoleIds?: string[];
  error?: string | null;
  messageId?: string | null;
  saleId: string;
  status: "delivered" | "partial" | "failed";
};

export type NexTechSalesDashboardDto = {
  plans: NexTechSalesPlanDto[];
  products: NexTechProductDto[];
  sales: NexTechSaleDto[];
  settings: NexTechSalesSettingsDto;
  lifetimeLicenses: NexTechLifetimeLicenseDto[];
  stats: {
    activePlans: number;
    activeProducts: number;
    customers: number;
    inactiveProducts: number;
    paidSales: number;
    pendingSales: number;
    revenueCents: number;
    revenueTodayCents: number;
    salesToday: number;
    subscriptions: number;
    salesThisMonth: number;
    totalSales: number;
  };
};

export type NexTechLifetimeLicenseDto = {
  customerId: string;
  expiresAt: string | null;
  hostingFreeDaysRemaining: number;
  hostingFreeUntil: string | null;
  hostingPriceCents: number;
  hostingStatus: "active" | "pending_payment" | "suspended" | "not_required";
  licenseStatus: "active" | "cancelled";
  licenseType: "monthly" | "lifetime" | "manual";
  moduleName: string;
  nextHostingDueAt: string | null;
  ownerUserId: string;
  purchaseDate: string;
  saleId: string;
  storeId: string;
  subscriptionId: string;
  supportLevel: "standard" | "priority";
  updatesIncluded: boolean;
};

export type PublicNexTechProductDto = {
  paymentProviders: Array<Pick<NexTechSalesPaymentProviderDto, "gatewayId" | "id" | "label" | "provider">>;
  product: NexTechProductDto;
  settings: Pick<NexTechSalesSettingsDto, "currency" | "enabled" | "panelColor" | "storeId" | "termsUrl">;
};

export type SaveNexTechSalesSettingsInput = Partial<{
  currency: "BRL" | "USD" | "EUR";
  customerRoleId: string | null;
  enabled: boolean;
  logChannelId: string | null;
  panelColor: string;
  panelDescription: string;
  panelImageUrl: string | null;
  panelTitle: string;
  publicUrl: string;
  saleChannelId: string | null;
  supportRoleIds: string[];
  termsUrl: string | null;
  thumbnailUrl: string | null;
}>;

export type SavePaymentProviderInput = {
  enabled: boolean;
  id?: string | null;
  instructions?: string | null;
  label: string;
  provider: MongoNexTechSalesPaymentProvider["provider"];
  publicKey?: string | null;
  secret?: string | null;
  webhookSecret?: string | null;
  webhookUrl?: string | null;
};

export type SavePlanInput = {
  checkoutMessage?: string | null;
  description?: string | null;
  discordRoleId?: string | null;
  durationDays?: number | null;
  enabled: boolean;
  imageUrl?: string | null;
  moduleIds: string[];
  name: string;
  priceCents: number;
};

export type SaveProductInput = {
  active: boolean;
  additionalInfo?: string | null;
  bannerUrl?: string | null;
  category: string;
  fullDescription?: string | null;
  howItWorks?: string | null;
  layout?: Partial<MongoNexTechProduct["layout"]>;
  name: string;
  observations?: string | null;
  plans: {
    lifetime: Partial<MongoNexTechProductPlanConfig> & Pick<MongoNexTechProductPlanConfig, "enabled" | "name" | "priceCents">;
    monthly: Partial<MongoNexTechProductPlanConfig> & Pick<MongoNexTechProductPlanConfig, "enabled" | "name" | "priceCents">;
  };
  seo?: Partial<MongoNexTechProduct["seo"]>;
  shortDescription?: string | null;
  slug?: string | null;
  toggles?: Partial<Record<MongoNexTechProductFeatureKey, boolean>>;
  warnings?: string | null;
};

export type SaveSaleInput = {
  amountCents?: number | null;
  buyerId: string;
  buyerName?: string | null;
  externalReference?: string | null;
  notes?: string | null;
  paymentProviderId?: string | null;
  planId?: string | null;
  status: MongoNexTechSaleStatus;
};

export type ProductCheckoutInput = {
  buyerEmail?: string | null;
  buyerId?: string | null;
  buyerName?: string | null;
  paymentProviderId?: string | null;
  planType: Extract<MongoNexTechSalePlanType, "monthly" | "lifetime">;
};

export type ProductCheckoutDto = {
  checkoutUrl: string | null;
  gatewayId: string;
  instructions: string | null;
  provider: MongoNexTechSalesPaymentProvider["provider"];
  publicKey: string | null;
  sale: NexTechSaleDto;
  successUrl: string;
};

const PRODUCT_UPLOAD_DIR = path.resolve(__dirname, "../../uploads/nex-tech-products");
const LIFETIME_PLAN_PRICE_CENTS = 15000;
const LIFETIME_FREE_HOSTING_DAYS = 30;
const LIFETIME_HOSTING_PRICE_CENTS = 1200;
const PRODUCT_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

export type ProcessWebhookInput = {
  dataId?: string | null;
  eventId?: string | null;
  eventType?: string | null;
  payload: unknown;
  rawBody: string;
  requestId?: string | null;
  signature?: string | null;
};

export async function getNexTechSalesDashboard(botId: string, guildId: string, ownerUserId: string) {
  const { nexTechCustomers, nexTechProducts, nexTechSales, nexTechSalesPlans, nexTechSubscriptions } = await getMongoCollections();
  const settings = await ensureNexTechSalesSettings(botId, guildId, ownerUserId);
  const scope = tenantScope(botId, guildId, ownerUserId, settings.storeId);
  await reconcileLifetimeHostingCharges(settings);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [plans, products, sales, customers, subscriptions, lifetimeLicenses, totalSales, paidSales, pendingSales, salesToday, salesThisMonth, activeProducts, inactiveProducts, revenueRows, revenueTodayRows] = await Promise.all([
    nexTechSalesPlans.find(scope).sort({ createdAt: -1 }).toArray(),
    nexTechProducts.find(scope).sort({ updatedAt: -1 }).toArray(),
    nexTechSales.find(scope).sort({ createdAt: -1 }).limit(100).toArray(),
    nexTechCustomers.countDocuments(scope),
    nexTechSubscriptions.countDocuments({ ...scope, status: "active" }),
    nexTechSubscriptions.find({ ...scope, productPlanType: "lifetime" }).sort({ createdAt: -1 }).toArray(),
    nexTechSales.countDocuments(scope),
    nexTechSales.countDocuments({ ...scope, status: "paid" }),
    nexTechSales.countDocuments({ ...scope, status: "pending" }),
    nexTechSales.countDocuments({ ...scope, createdAt: { $gte: todayStart } }),
    nexTechSales.countDocuments({ ...scope, createdAt: { $gte: monthStart } }),
    nexTechProducts.countDocuments({ ...scope, active: true }),
    nexTechProducts.countDocuments({ ...scope, active: false }),
    nexTechSales.aggregate<{ total: number }>([
      { $match: { ...scope, status: "paid" } },
      { $group: { _id: null, total: { $sum: "$amountCents" } } }
    ]).toArray(),
    nexTechSales.aggregate<{ total: number }>([
      { $match: { ...scope, status: "paid", paidAt: { $gte: todayStart } } },
      { $group: { _id: null, total: { $sum: "$amountCents" } } }
    ]).toArray()
  ]);

  return toDashboardDto(settings, plans, products, sales, customers, subscriptions, lifetimeLicenses, {
    activeProducts,
    inactiveProducts,
    paidSales,
    pendingSales,
    revenueCents: revenueRows[0]?.total ?? 0,
    revenueTodayCents: revenueTodayRows[0]?.total ?? 0,
    salesThisMonth,
    salesToday,
    totalSales
  });
}

export async function ensureNexTechSalesSettings(botId: string, guildId: string, ownerUserId: string) {
  const { nexTechSalesSettings } = await getMongoCollections();
  const existing = await nexTechSalesSettings.findOne({ botId, guildId, ownerUserId });

  if (existing) {
    return normalizeExistingSettings(existing);
  }

  const now = new Date();
  const storeId = randomUUID();
  const settings: MongoNexTechSalesSettings = {
    _id: randomUUID(),
    botId,
    guildId,
    storeId,
    enabled: false,
    ownerUserId,
    publicUrl: `/nex-tech/${storeId}`,
    currency: "BRL",
    saleChannelId: null,
    logChannelId: null,
    supportRoleIds: [],
    customerRoleId: null,
    panelTitle: "Nex Tech Bot",
    panelDescription: "Planos, liberacoes e pagamentos do bot Nex Tech.",
    panelColor: "#7c3aed",
    panelImageUrl: null,
    thumbnailUrl: null,
    termsUrl: null,
    paymentProviders: [
      {
        id: randomUUID(),
        gatewayId: randomUUID(),
        ownerUserId,
        storeId,
        enabled: true,
        label: "Pagamento manual",
        provider: "manual",
        publicKey: null,
        secretEncrypted: null,
        webhookSecretEncrypted: null,
        webhookUrl: null,
        instructions: "Registre a venda como pendente e marque como paga depois da confirmação.",
        updatedAt: now
      }
    ],
    createdBy: ownerUserId,
    updatedBy: ownerUserId,
    createdAt: now,
    updatedAt: now
  };

  await nexTechSalesSettings.insertOne(settings);
  return settings;
}

async function normalizeExistingSettings(settings: MongoNexTechSalesSettings) {
  if (settings.storeId && settings.paymentProviders.every((provider) => provider.gatewayId && provider.ownerUserId && provider.storeId)) {
    return settings;
  }

  const { nexTechSalesSettings } = await getMongoCollections();
  const storeId = settings.storeId || randomUUID();
  const paymentProviders = settings.paymentProviders.map((provider) => ({
    ...provider,
    gatewayId: provider.gatewayId || randomUUID(),
    ownerUserId: provider.ownerUserId || settings.ownerUserId,
    storeId: provider.storeId || storeId,
    webhookSecretEncrypted: provider.webhookSecretEncrypted ?? null
  }));

  await nexTechSalesSettings.updateOne(
    { _id: settings._id, ownerUserId: settings.ownerUserId },
    {
      $set: {
        paymentProviders,
        storeId,
        updatedAt: new Date()
      }
    }
  );

  return {
    ...settings,
    paymentProviders,
    storeId
  };
}

export async function saveNexTechSalesSettings(botId: string, guildId: string, input: SaveNexTechSalesSettingsInput, actorId: string) {
  const current = await ensureNexTechSalesSettings(botId, guildId, actorId);
  const now = new Date();
  const patch: Partial<MongoNexTechSalesSettings> = {
    updatedAt: now,
    updatedBy: actorId
  };

  for (const key of [
    "currency",
    "customerRoleId",
    "enabled",
    "logChannelId",
    "panelColor",
    "panelDescription",
    "panelImageUrl",
    "panelTitle",
    "publicUrl",
    "saleChannelId",
    "supportRoleIds",
    "termsUrl",
    "thumbnailUrl"
  ] as const) {
    if (input[key] !== undefined) {
      (patch as Record<string, unknown>)[key] = input[key];
    }
  }

  const { nexTechSalesSettings } = await getMongoCollections();
  await nexTechSalesSettings.updateOne({ _id: current._id, ownerUserId: actorId }, { $set: patch });
  return (await nexTechSalesSettings.findOne({ _id: current._id, ownerUserId: actorId })) ?? current;
}

export async function saveNexTechPaymentProvider(botId: string, guildId: string, input: SavePaymentProviderInput, actorId: string) {
  const current = await ensureNexTechSalesSettings(botId, guildId, actorId);
  const now = new Date();
  const existing = current.paymentProviders.find((provider) => provider.id === input.id);
  const nextProvider: MongoNexTechSalesPaymentProvider = {
    id: existing?.id ?? randomUUID(),
    gatewayId: existing?.gatewayId ?? randomUUID(),
    ownerUserId: actorId,
    storeId: current.storeId,
    enabled: input.enabled,
    label: input.label.trim(),
    provider: input.provider,
    publicKey: normalizeNullable(input.publicKey),
    secretEncrypted: input.secret?.trim() ? encryptSecret(input.secret.trim()) : existing?.secretEncrypted ?? null,
    webhookSecretEncrypted: input.webhookSecret?.trim() ? encryptSecret(input.webhookSecret.trim()) : existing?.webhookSecretEncrypted ?? null,
    webhookUrl: normalizeNullable(input.webhookUrl),
    instructions: normalizeNullable(input.instructions),
    updatedAt: now
  };
  const paymentProviders = existing
    ? current.paymentProviders.map((provider) => provider.id === existing.id ? nextProvider : provider)
    : [nextProvider, ...current.paymentProviders];

  const { nexTechSalesSettings } = await getMongoCollections();
  await nexTechSalesSettings.updateOne(
    { _id: current._id, ownerUserId: actorId },
    {
      $set: {
        paymentProviders,
        updatedAt: now,
        updatedBy: actorId
      }
    }
  );

  return (await nexTechSalesSettings.findOne({ _id: current._id, ownerUserId: actorId })) ?? current;
}

export async function deleteNexTechPaymentProvider(botId: string, guildId: string, providerId: string, actorId: string) {
  const current = await ensureNexTechSalesSettings(botId, guildId, actorId);
  const nextProviders = current.paymentProviders.filter((provider) => provider.id !== providerId);

  const { nexTechSalesSettings } = await getMongoCollections();
  await nexTechSalesSettings.updateOne(
    { _id: current._id, ownerUserId: actorId },
    {
      $set: {
        paymentProviders: nextProviders,
        updatedAt: new Date(),
        updatedBy: actorId
      }
    }
  );

  return (await nexTechSalesSettings.findOne({ _id: current._id, ownerUserId: actorId })) ?? current;
}

export async function saveNexTechSalesPlan(botId: string, guildId: string, planId: string | null, input: SavePlanInput, actorId: string) {
  const { nexTechSalesPlans } = await getMongoCollections();
  const settings = await ensureNexTechSalesSettings(botId, guildId, actorId);
  const scope = tenantScope(botId, guildId, actorId, settings.storeId);
  const now = new Date();

  if (planId) {
    await nexTechSalesPlans.updateOne(
      { _id: planId, ...scope },
      {
        $set: {
          checkoutMessage: normalizeNullable(input.checkoutMessage),
          description: normalizeNullable(input.description),
          discordRoleId: normalizeSnowflake(input.discordRoleId),
          durationDays: input.durationDays ?? null,
          enabled: input.enabled,
          imageUrl: normalizeNullable(input.imageUrl),
          moduleIds: [...new Set(input.moduleIds)],
          name: input.name.trim(),
          priceCents: input.priceCents,
          updatedAt: now,
          updatedBy: actorId
        }
      }
    );

    return nexTechSalesPlans.findOne({ _id: planId, ...scope });
  }

  const plan: MongoNexTechSalesPlan = {
    _id: randomUUID(),
    botId,
    guildId,
    ownerUserId: actorId,
    storeId: settings.storeId,
    name: input.name.trim(),
    description: normalizeNullable(input.description),
    discordRoleId: normalizeSnowflake(input.discordRoleId),
    priceCents: input.priceCents,
    durationDays: input.durationDays ?? null,
    enabled: input.enabled,
    moduleIds: [...new Set(input.moduleIds)],
    imageUrl: normalizeNullable(input.imageUrl),
    checkoutMessage: normalizeNullable(input.checkoutMessage),
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: now,
    updatedAt: now
  };

  await nexTechSalesPlans.insertOne(plan);
  return plan;
}

export async function saveNexTechProduct(botId: string, guildId: string, productId: string | null, input: SaveProductInput, actorId: string) {
  const { nexTechProducts } = await getMongoCollections();
  const settings = await ensureNexTechSalesSettings(botId, guildId, actorId);
  const scope = tenantScope(botId, guildId, actorId, settings.storeId);
  const now = new Date();
  const slug = slugifyProduct(input.slug || input.name);
  const productPatch = productFieldsFromInput(input, settings);

  if (productId) {
    await nexTechProducts.updateOne(
      { _id: productId, ...scope },
      {
        $set: {
          ...productPatch,
          slug: productId ? slug : await uniqueProductSlug(settings.storeId, slug),
          updatedAt: now,
          updatedBy: actorId
        }
      }
    );

    return nexTechProducts.findOne({ _id: productId, ...scope });
  }

  const product: MongoNexTechProduct = {
    _id: randomUUID(),
    botId,
    guildId,
    ownerUserId: actorId,
    storeId: settings.storeId,
    slug: await uniqueProductSlug(settings.storeId, slug),
    createdBy: actorId,
    createdAt: now,
    updatedBy: actorId,
    updatedAt: now,
    ...productPatch
  };

  await nexTechProducts.insertOne(product);
  return product;
}

export async function duplicateNexTechProduct(botId: string, guildId: string, productId: string, actorId: string) {
  const { nexTechProducts } = await getMongoCollections();
  const settings = await ensureNexTechSalesSettings(botId, guildId, actorId);
  const scope = tenantScope(botId, guildId, actorId, settings.storeId);
  const product = await nexTechProducts.findOne({ _id: productId, ...scope });

  if (!product) return null;

  const now = new Date();
  const copy: MongoNexTechProduct = {
    ...product,
    _id: randomUUID(),
    name: `${product.name} Copia`,
    slug: await uniqueProductSlug(settings.storeId, `${product.slug}-copia`),
    active: false,
    createdAt: now,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId
  };

  await nexTechProducts.insertOne(copy);
  return copy;
}

export async function deleteNexTechProduct(botId: string, guildId: string, productId: string, actorId: string) {
  const { nexTechProducts } = await getMongoCollections();
  const settings = await ensureNexTechSalesSettings(botId, guildId, actorId);
  return nexTechProducts.findOneAndDelete({ _id: productId, ...tenantScope(botId, guildId, actorId, settings.storeId) });
}

export async function saveNexTechProductBannerUpload(input: {
  actorId: string;
  botId: string;
  buffer: Buffer;
  guildId: string;
  mimeType: string;
  productId: string;
}) {
  const extension = PRODUCT_IMAGE_EXTENSIONS[input.mimeType];

  if (!extension) {
    throw createNexTechSalesError("Formato de imagem não suportado.", 400);
  }

  const { nexTechProducts } = await getMongoCollections();
  const settings = await ensureNexTechSalesSettings(input.botId, input.guildId, input.actorId);
  const scope = tenantScope(input.botId, input.guildId, input.actorId, settings.storeId);
  const product = await nexTechProducts.findOne({ _id: input.productId, ...scope });

  if (!product) {
    throw createNexTechSalesError("Produto não encontrado.", 404);
  }

  await fs.mkdir(PRODUCT_UPLOAD_DIR, { recursive: true });
  const filename = `${settings.storeId}-${product._id}-${Date.now()}.${extension}`;
  const filePath = path.join(PRODUCT_UPLOAD_DIR, filename);
  await fs.writeFile(filePath, input.buffer);

  const bannerUrl = `/uploads/nex-tech-products/${filename}`;
  await nexTechProducts.updateOne(
    { _id: input.productId, ...scope },
    {
      $set: {
        bannerUrl,
        updatedAt: new Date(),
        updatedBy: input.actorId
      }
    }
  );

  return nexTechProducts.findOne({ _id: input.productId, ...scope });
}

export async function deleteScopedNexTechSalesPlan(botId: string, guildId: string, planId: string, ownerUserId: string) {
  const { nexTechSalesPlans } = await getMongoCollections();
  const settings = await ensureNexTechSalesSettings(botId, guildId, ownerUserId);
  const deleted = await nexTechSalesPlans.findOneAndDelete({ _id: planId, ...tenantScope(botId, guildId, ownerUserId, settings.storeId) });
  return deleted;
}

export async function saveNexTechSale(botId: string, guildId: string, input: SaveSaleInput, actorId: string) {
  const { nexTechCustomers, nexTechSales, nexTechSalesPlans, nexTechSubscriptions } = await getMongoCollections();
  const settings = await ensureNexTechSalesSettings(botId, guildId, actorId);
  const scope = tenantScope(botId, guildId, actorId, settings.storeId);
  const plan = input.planId ? await nexTechSalesPlans.findOne({ _id: input.planId, ...scope }) : null;
  const now = new Date();
  const provider = settings.paymentProviders.find((item) => item.id === input.paymentProviderId) ?? null;
  const customer = await upsertCustomer(nexTechCustomers, {
    botId,
    guildId,
    ownerUserId: actorId,
    storeId: settings.storeId,
    buyerId: input.buyerId.trim(),
    buyerName: normalizeNullable(input.buyerName),
    now
  });
  const amountCents = input.amountCents ?? plan?.priceCents ?? 0;
  const paidAt = input.status === "paid" ? now : null;
  const expiresAt = paidAt && plan?.durationDays ? new Date(paidAt.getTime() + plan.durationDays * 24 * 60 * 60 * 1000) : null;
  const sale: MongoNexTechSale = {
    _id: randomUUID(),
    botId,
    guildId,
    ownerUserId: actorId,
    storeId: settings.storeId,
    planId: plan?._id ?? null,
    planName: plan?.name ?? "Venda avulsa",
    customerId: customer._id,
    buyerId: input.buyerId.trim(),
    buyerName: normalizeNullable(input.buyerName),
    amountCents,
    currency: settings.currency,
    paymentGatewayId: provider?.gatewayId ?? null,
    paymentProviderId: provider?.id ?? null,
    paymentProviderLabel: provider?.label ?? null,
    productId: null,
    productName: null,
    productPlanType: "manual",
    productSlug: null,
    purchasedRoleId: plan?.discordRoleId ?? null,
    externalReference: normalizeNullable(input.externalReference),
    status: input.status,
    notes: normalizeNullable(input.notes),
    paidAt,
    expiresAt,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: now,
    updatedAt: now
  };

  await nexTechSales.insertOne(sale);
  if (sale.status === "paid" && plan) {
    await nexTechSubscriptions.insertOne({
      _id: randomUUID(),
      botId,
      guildId,
      ownerUserId: actorId,
      storeId: settings.storeId,
      customerId: customer._id,
      planId: plan._id,
      saleId: sale._id,
      status: "active",
      startsAt: paidAt ?? now,
      expiresAt,
      createdAt: now,
      updatedAt: now
    });
  }
  if (sale.status === "paid") {
    await activateNexTechSaleBenefits(settings, sale, now);
  }
  return sale;
}

export async function getPublicNexTechProduct(storeId: string, slug: string): Promise<PublicNexTechProductDto | null> {
  const { nexTechProducts, nexTechSalesSettings } = await getMongoCollections();
  const [settings, product] = await Promise.all([
    nexTechSalesSettings.findOne({ storeId }),
    nexTechProducts.findOne({ storeId, slug: slugifyProduct(slug), active: true })
  ]);

  if (!settings || !product || !settings.enabled) {
    return null;
  }

  return {
    settings: {
      currency: settings.currency,
      enabled: settings.enabled,
      panelColor: settings.panelColor,
      storeId: settings.storeId,
      termsUrl: settings.termsUrl
    },
    product: toProductDto(product),
    paymentProviders: settings.paymentProviders
      .filter((provider) => provider.enabled)
      .map((provider) => ({
        gatewayId: provider.gatewayId,
        id: provider.id,
        label: provider.label,
        provider: provider.provider
      }))
  };
}

export async function createProductCheckout(storeId: string, slug: string, input: ProductCheckoutInput): Promise<ProductCheckoutDto | null> {
  const { nexTechCustomers, nexTechProducts, nexTechSales, nexTechSalesSettings } = await getMongoCollections();
  const settings = await nexTechSalesSettings.findOne({ storeId });
  const product = await nexTechProducts.findOne({ storeId, slug: slugifyProduct(slug), active: true });

  if (!settings || !product || !settings.enabled) {
    return null;
  }

  const plan = product.plans[input.planType];

  if (!plan.enabled) {
    throw createNexTechSalesError("Plano indisponível para este produto.", 400);
  }

  const provider = settings.paymentProviders.find((item) => item.id === input.paymentProviderId && item.enabled)
    ?? settings.paymentProviders.find((item) => item.id === plan.paymentProviderId && item.enabled)
    ?? settings.paymentProviders.find((item) => item.enabled)
    ?? null;

  if (!provider) {
    throw createNexTechSalesError("Nenhum gateway de pagamento ativo nesta loja.", 400);
  }

  const now = new Date();
  const buyerId = input.buyerId?.trim() || `guest-${randomUUID()}`;
  const customer = await upsertCustomer(nexTechCustomers, {
    botId: settings.botId,
    guildId: settings.guildId,
    ownerUserId: settings.ownerUserId,
    storeId: settings.storeId,
    buyerId,
    buyerName: normalizeNullable(input.buyerName) ?? normalizeNullable(input.buyerEmail),
    now
  });
  const saleId = randomUUID();
  const successUrl = buildProductPaymentSuccessUrl(settings.storeId, product.slug, saleId);
  const checkout = await buildProviderCheckout(provider, settings, {
    amountCents: plan.priceCents,
    currency: settings.currency,
    payerEmail: mercadoPagoCheckoutPayerEmail(input.buyerEmail, buyerId, saleId),
    planName: plan.name,
    productName: product.name,
    saleId,
    successUrl
  });
  const sale: MongoNexTechSale = {
    _id: saleId,
    botId: settings.botId,
    guildId: settings.guildId,
    ownerUserId: settings.ownerUserId,
    storeId: settings.storeId,
    planId: null,
    planName: plan.name,
    customerId: customer._id,
    buyerId,
    buyerName: normalizeNullable(input.buyerName),
    amountCents: plan.priceCents,
    currency: settings.currency,
    paymentGatewayId: provider.gatewayId,
    paymentProviderId: provider.id,
    paymentProviderLabel: provider.label,
    checkoutUrl: checkout.checkoutUrl,
    successUrl,
    productId: product._id,
    productName: product.name,
    productPlanType: input.planType,
    productSlug: product.slug,
    purchasedRoleId: plan.discordRoleId,
    externalReference: checkout.externalReference,
    status: "pending",
    notes: `Checkout público ${input.planType}`,
    paidAt: null,
    expiresAt: null,
    createdBy: null,
    updatedBy: null,
    createdAt: now,
    updatedAt: now
  };

  await nexTechSales.insertOne(sale);
  return {
    checkoutUrl: checkout.checkoutUrl,
    gatewayId: provider.gatewayId,
    instructions: provider.instructions,
    provider: provider.provider,
    publicKey: provider.publicKey,
    sale: toSaleDto(sale),
    successUrl
  };
}

export async function updateNexTechSaleStatus(botId: string, guildId: string, saleId: string, status: MongoNexTechSaleStatus, actorId: string) {
  const { nexTechSales, nexTechSalesPlans, nexTechSubscriptions } = await getMongoCollections();
  const settings = await ensureNexTechSalesSettings(botId, guildId, actorId);
  const scope = tenantScope(botId, guildId, actorId, settings.storeId);
  const sale = await nexTechSales.findOne({ _id: saleId, ...scope });

  if (!sale) return null;

  const plan = sale.planId ? await nexTechSalesPlans.findOne({ _id: sale.planId, ...scope }) : null;
  const now = new Date();
  const paidAt = status === "paid" ? sale.paidAt ?? now : sale.paidAt;
  const expiresAt = status === "paid" && paidAt && plan?.durationDays
    ? sale.expiresAt ?? new Date(paidAt.getTime() + plan.durationDays * 24 * 60 * 60 * 1000)
    : sale.expiresAt;

  await nexTechSales.updateOne(
    { _id: saleId, ...scope },
    {
      $set: {
        expiresAt,
        paidAt,
        purchasedRoleId: sale.purchasedRoleId ?? plan?.discordRoleId ?? null,
        status,
        updatedAt: now,
        updatedBy: actorId
      }
    }
  );

  const updated = await nexTechSales.findOne({ _id: saleId, ...scope });
  if (updated?.status === "paid" && plan) {
    await nexTechSubscriptions.updateOne(
      { saleId: updated._id, ...scope },
      {
        $set: {
          expiresAt,
          status: "active",
          updatedAt: now
        },
        $setOnInsert: {
          _id: randomUUID(),
          botId,
          guildId,
          ownerUserId: actorId,
          storeId: settings.storeId,
          customerId: updated.customerId,
          planId: plan._id,
          saleId: updated._id,
          startsAt: paidAt ?? now,
          createdAt: now
        }
      },
      { upsert: true }
    );
  }
  if (updated?.status === "paid") {
    await activateNexTechSaleBenefits(settings, updated, now);
  }

  return updated;
}

export async function recordNexTechSaleDeliveryResult(botId: string | null, guildId: string, input: NexTechSaleDeliveryResultInput) {
  if (!botId) {
    throw createNexTechSalesError("Bot não identificado para registrar entrega da venda.", 400);
  }

  const { nexTechSales } = await getMongoCollections();
  const now = new Date();
  const deliveredRoleIds = [...new Set((input.deliveredRoleIds ?? []).map((roleId) => roleId.trim()).filter((roleId) => /^\d{5,32}$/.test(roleId)))];

  await nexTechSales.updateOne(
    { _id: input.saleId, botId, guildId },
    {
      $set: {
        deliveredAt: input.status === "delivered" || input.status === "partial" ? now : null,
        deliveredRoleIds,
        deliveryError: normalizeNullable(input.error),
        deliveryMessageId: normalizeSnowflake(input.messageId),
        deliveryStatus: input.status,
        updatedAt: now
      }
    }
  );

  return {
    ok: true
  };
}

export async function processNexTechPaymentWebhook(storeId: string, gatewayId: string, input: ProcessWebhookInput) {
  const { nexTechSalesSettings, nexTechWebhookLogs } = await getMongoCollections();
  const settings = await nexTechSalesSettings.findOne({ storeId });

  if (!settings) {
    return {
      accepted: false,
      reason: "store_not_found" as const,
      statusCode: 404
    };
  }

  const provider = settings.paymentProviders.find((item) => item.gatewayId === gatewayId);

  if (!provider) {
    return {
      accepted: false,
      reason: "gateway_not_found" as const,
      statusCode: 404
    };
  }

  const webhookDataId = normalizeNullable(input.dataId) ?? normalizeNullable(input.eventId) ?? readWebhookDataId(input.payload);
  const signatureValid = validateWebhookSignature(provider, {
    dataId: webhookDataId,
    rawBody: input.rawBody,
    requestId: input.requestId ?? null,
    signature: input.signature ?? null
  });
  const now = new Date();
  const saleIdFromPayload = readWebhookSaleId(input.payload);
  let processed = false;
  let saleId = saleIdFromPayload;
  let paymentStatus: string | null = null;

  await nexTechWebhookLogs.insertOne({
    _id: randomUUID(),
    botId: settings.botId,
    guildId: settings.guildId,
    ownerUserId: settings.ownerUserId,
    storeId: settings.storeId,
    paymentGatewayId: provider.gatewayId,
    eventId: normalizeNullable(input.eventId) ?? webhookDataId,
    eventType: normalizeNullable(input.eventType) ?? "payment.webhook",
    signatureValid,
    processed: false,
    saleId,
    createdAt: now
  });

  if (!signatureValid) {
    return {
      accepted: false,
      reason: "invalid_signature" as const,
      statusCode: 401
    };
  }

  if (provider.provider === "mercadopago" && webhookDataId && isPaymentWebhook(input.eventType, input.payload)) {
    const payment = await getMercadoPagoPayment(provider, webhookDataId).catch(() => null);
    saleId = readMercadoPagoExternalReference(payment) ?? saleId;
    paymentStatus = readMercadoPagoStatus(payment);

    if (saleId && paymentStatus) {
      processed = await applyMercadoPagoPaymentStatus(settings, saleId, paymentStatus);
    }
  }

  if (processed || saleId || paymentStatus) {
    await nexTechWebhookLogs.updateOne(
      {
        ownerUserId: settings.ownerUserId,
        paymentGatewayId: provider.gatewayId,
        storeId: settings.storeId,
        eventId: normalizeNullable(input.eventId) ?? webhookDataId,
        createdAt: now
      },
      {
        $set: {
          processed,
          saleId
        }
      }
    );
  }

  return {
    accepted: true,
    ownerUserId: settings.ownerUserId,
    processed,
    saleId,
    storeId: settings.storeId,
    statusCode: 200
  };
}

function toDashboardDto(
  settings: MongoNexTechSalesSettings,
  plans: MongoNexTechSalesPlan[],
  products: MongoNexTechProduct[],
  sales: MongoNexTechSale[],
  customers: number,
  subscriptions: number,
  lifetimeLicenses: MongoNexTechSubscription[],
  totals?: {
    activeProducts: number;
    inactiveProducts: number;
    paidSales: number;
    pendingSales: number;
    revenueCents: number;
    revenueTodayCents: number;
    salesThisMonth: number;
    salesToday: number;
    totalSales: number;
  }
): NexTechSalesDashboardDto {
  return {
    settings: toSettingsDto(settings),
    plans: plans.map(toPlanDto),
    products: products.map(toProductDto),
    sales: sales.map(toSaleDto),
    lifetimeLicenses: lifetimeLicenses.map(toLifetimeLicenseDto),
    stats: {
      activePlans: plans.filter((plan) => plan.enabled).length,
      activeProducts: totals?.activeProducts ?? products.filter((product) => product.active).length,
      customers,
      inactiveProducts: totals?.inactiveProducts ?? products.filter((product) => !product.active).length,
      paidSales: totals?.paidSales ?? sales.filter((sale) => sale.status === "paid").length,
      pendingSales: totals?.pendingSales ?? sales.filter((sale) => sale.status === "pending").length,
      revenueCents: totals?.revenueCents ?? sales.filter((sale) => sale.status === "paid").reduce((total, sale) => total + sale.amountCents, 0),
      revenueTodayCents: totals?.revenueTodayCents ?? 0,
      salesThisMonth: totals?.salesThisMonth ?? sales.length,
      salesToday: totals?.salesToday ?? 0,
      subscriptions,
      totalSales: totals?.totalSales ?? sales.length
    }
  };
}

function toLifetimeLicenseDto(subscription: MongoNexTechSubscription): NexTechLifetimeLicenseDto {
  const now = Date.now();
  const hostingFreeUntil = subscription.hostingFreeUntil ?? null;
  const hostingFreeDaysRemaining = hostingFreeUntil
    ? Math.max(0, Math.ceil((hostingFreeUntil.getTime() - now) / 86_400_000))
    : 0;

  return {
    customerId: subscription.customerId,
    expiresAt: subscription.expiresAt?.toISOString() ?? null,
    hostingFreeDaysRemaining,
    hostingFreeUntil: hostingFreeUntil?.toISOString() ?? null,
    hostingPriceCents: subscription.hostingPriceCents ?? LIFETIME_HOSTING_PRICE_CENTS,
    hostingStatus: subscription.hostingStatus ?? "active",
    licenseStatus: subscription.licenseStatus ?? "active",
    licenseType: subscription.licenseType ?? "lifetime",
    moduleName: subscription.productName ?? "Módulo",
    nextHostingDueAt: subscription.nextHostingDueAt?.toISOString() ?? null,
    ownerUserId: subscription.ownerUserId,
    purchaseDate: subscription.startsAt.toISOString(),
    saleId: subscription.saleId,
    storeId: subscription.storeId,
    subscriptionId: subscription._id,
    supportLevel: subscription.supportLevel ?? "priority",
    updatesIncluded: subscription.updatesIncluded !== false
  };
}

export function toSettingsDto(settings: MongoNexTechSalesSettings): NexTechSalesSettingsDto {
  return {
    ...settings,
    id: settings._id,
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString(),
    paymentProviders: settings.paymentProviders.map(toPaymentProviderDto)
  };
}

export function toPlanDto(plan: MongoNexTechSalesPlan): NexTechSalesPlanDto {
  return {
    ...plan,
    id: plan._id,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString()
  };
}

export function toProductDto(product: MongoNexTechProduct): NexTechProductDto {
  return {
    ...product,
    id: product._id,
    publicUrl: `/nex-tech/${product.storeId}/${product.slug}`,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString()
  };
}

export function toSaleDto(sale: MongoNexTechSale): NexTechSaleDto {
  return {
    ...sale,
    id: sale._id,
    paidAt: sale.paidAt?.toISOString() ?? null,
    expiresAt: sale.expiresAt?.toISOString() ?? null,
    createdAt: sale.createdAt.toISOString(),
    updatedAt: sale.updatedAt.toISOString()
  };
}

function toPaymentProviderDto(provider: MongoNexTechSalesPaymentProvider): NexTechSalesPaymentProviderDto {
  return {
    id: provider.id,
    gatewayId: provider.gatewayId,
    ownerUserId: provider.ownerUserId,
    storeId: provider.storeId,
    enabled: provider.enabled,
    label: provider.label,
    provider: provider.provider,
    publicKey: provider.publicKey,
    webhookUrl: provider.webhookUrl,
    instructions: provider.instructions,
    secretConfigured: Boolean(provider.secretEncrypted),
    secretMasked: provider.secretEncrypted ? "******** protegido" : null,
    webhookSecretConfigured: Boolean(provider.webhookSecretEncrypted),
    updatedAt: provider.updatedAt.toISOString()
  };
}

function tenantScope(botId: string, guildId: string, ownerUserId: string, storeId: string) {
  return {
    botId,
    guildId,
    ownerUserId,
    storeId
  };
}

function buildProductPaymentSuccessUrl(storeId: string, slug: string, saleId: string) {
  const origin = env.SITE_ORIGIN || env.FRONTEND_URL || env.BACKEND_URL;
  const path = `/nex-tech/${encodeURIComponent(storeId)}/${encodeURIComponent(slug)}/sucesso`;

  if (!origin) {
    return `${path}?saleId=${encodeURIComponent(saleId)}`;
  }

  const url = new URL(path, origin);
  url.searchParams.set("saleId", saleId);
  return url.toString();
}

function buildProductPaymentResultUrl(storeId: string, saleId: string, status: "failure" | "pending") {
  const origin = env.SITE_ORIGIN || env.FRONTEND_URL || env.BACKEND_URL;
  const path = `/nex-tech/${encodeURIComponent(storeId)}`;

  if (!origin) {
    return `${path}?saleId=${encodeURIComponent(saleId)}&status=${status}`;
  }

  const url = new URL(path, origin);
  url.searchParams.set("saleId", saleId);
  url.searchParams.set("status", status);
  return url.toString();
}

function buildMercadoPagoNotificationUrl(storeId: string, gatewayId: string) {
  const origin = env.BACKEND_URL || env.SITE_ORIGIN || env.FRONTEND_URL;

  if (!origin) {
    return null;
  }

  return new URL(
    `/api/nex-tech-sales/webhooks/${encodeURIComponent(storeId)}/${encodeURIComponent(gatewayId)}`,
    origin
  ).toString();
}

async function buildProviderCheckout(
  provider: MongoNexTechSalesPaymentProvider,
  settings: MongoNexTechSalesSettings,
  context: {
    amountCents: number;
    currency: "BRL" | "USD" | "EUR";
    payerEmail: string | null;
    planName: string;
    productName: string;
    saleId: string;
    successUrl: string;
  }
) {
  if (provider.provider === "mercadopago") {
    return createMercadoPagoProductPreference(provider, settings, context);
  }

  if (provider.provider !== "custom" || !provider.publicKey) {
    return {
      checkoutUrl: null,
      externalReference: context.saleId
    };
  }

  try {
    const url = new URL(provider.publicKey);
    url.searchParams.set("saleId", context.saleId);
    url.searchParams.set("externalReference", context.saleId);
    url.searchParams.set("successUrl", context.successUrl);
    url.searchParams.set("returnUrl", context.successUrl);
    url.searchParams.set("amountCents", String(context.amountCents));
    url.searchParams.set("currency", context.currency);
    url.searchParams.set("product", context.productName);
    return {
      checkoutUrl: url.toString(),
      externalReference: context.saleId
    };
  } catch {
    return {
      checkoutUrl: null,
      externalReference: context.saleId
    };
  }
}

async function createMercadoPagoProductPreference(
  provider: MongoNexTechSalesPaymentProvider,
  settings: MongoNexTechSalesSettings,
  context: {
    amountCents: number;
    currency: "BRL" | "USD" | "EUR";
    payerEmail: string | null;
    planName: string;
    productName: string;
    saleId: string;
    successUrl: string;
  }
) {
  const accessToken = decryptProviderSecret(provider, "Access Token do Mercado Pago não configurado.");
  const failureUrl = buildProductPaymentResultUrl(settings.storeId, context.saleId, "failure");
  const pendingUrl = buildProductPaymentResultUrl(settings.storeId, context.saleId, "pending");
  const notificationUrl = provider.webhookUrl || buildMercadoPagoNotificationUrl(settings.storeId, provider.gatewayId);
  const environment = mercadoPagoProviderEnvironment(provider, accessToken);

  const checkout = await createMercadoPagoCheckoutPreference({
    accessToken,
    backUrls: {
      failure: failureUrl,
      pending: pendingUrl,
      success: context.successUrl
    },
    environment,
    externalReference: context.saleId,
    items: [
      {
        currencyId: context.currency,
        description: context.planName,
        id: context.saleId,
        title: context.productName,
        unitPriceInCents: context.amountCents
      }
    ],
    metadata: {
      nextech_sale_id: context.saleId,
      source: "nextech_product_checkout",
      store_id: settings.storeId
    },
    notificationUrl,
    payerEmail: context.payerEmail
  }).catch((error) => {
    throw createNexTechSalesError(error instanceof Error ? error.message : "Mercado Pago recusou a criacao da preferencia.", (error as { statusCode?: number })?.statusCode ?? 502);
  });

  return {
    checkoutUrl: checkout.checkoutUrl,
    externalReference: checkout.preferenceId
  };
}

function mercadoPagoCheckoutPayerEmail(inputEmail: string | null | undefined, buyerId: string, saleId: string) {
  const email = normalizeNullable(inputEmail);

  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return email;
  }

  const normalizedBuyerId = buyerId.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 64) || "guest";
  const normalizedSaleId = saleId.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 64);
  return `checkout-${normalizedBuyerId}-${normalizedSaleId}@nextech.discloud.app`;
}

function mercadoPagoProviderEnvironment(provider: MongoNexTechSalesPaymentProvider, accessToken: string): "test" | "production" | undefined {
  const publicKey = provider.publicKey?.trim().toUpperCase() ?? "";
  const token = accessToken.trim().toUpperCase();

  if (publicKey.startsWith("TEST-") || token.startsWith("TEST-")) {
    return "test";
  }

  if (publicKey.startsWith("APP_USR-") || token.startsWith("APP_USR-")) {
    return "production";
  }

  return undefined;
}

async function getMercadoPagoPayment(provider: MongoNexTechSalesPaymentProvider, paymentId: string) {
  const accessToken = decryptProviderSecret(provider, "Access Token do Mercado Pago não configurado.");
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;

  if (!response.ok) {
    throw createNexTechSalesError(readMercadoPagoError(payload) ?? "Não foi possível consultar o pagamento no Mercado Pago.", 502);
  }

  return payload;
}

async function applyMercadoPagoPaymentStatus(settings: MongoNexTechSalesSettings, saleId: string, paymentStatus: string) {
  const nextStatus = mercadoPagoStatusToSaleStatus(paymentStatus);

  if (!nextStatus) {
    return false;
  }

  const { nexTechSales, nexTechSubscriptions } = await getMongoCollections();
  const current = await nexTechSales.findOne({
    _id: saleId,
    ownerUserId: settings.ownerUserId,
    storeId: settings.storeId
  });

  if (!current) {
    return false;
  }

  const now = new Date();
  const paidAt = nextStatus === "paid" ? current.paidAt ?? now : current.paidAt;
  await nexTechSales.updateOne(
    {
      _id: saleId,
      ownerUserId: settings.ownerUserId,
      storeId: settings.storeId
    },
    {
      $set: {
        paidAt,
        status: nextStatus,
        updatedAt: now,
        updatedBy: null
      }
    }
  );
  const updatedSale = {
    ...current,
    paidAt,
    status: nextStatus,
    updatedAt: now,
    updatedBy: null
  };

  if (nextStatus === "paid" && current.planId) {
    await nexTechSubscriptions.updateOne(
      {
        saleId,
        ownerUserId: settings.ownerUserId,
        storeId: settings.storeId
      },
      {
        $set: {
          status: "active",
          updatedAt: now
        },
        $setOnInsert: {
          _id: randomUUID(),
          botId: settings.botId,
          createdAt: now,
          customerId: current.customerId,
          expiresAt: null,
          guildId: settings.guildId,
          ownerUserId: settings.ownerUserId,
          planId: current.planId,
          saleId,
          startsAt: paidAt ?? now,
          storeId: settings.storeId
        }
      },
      { upsert: true }
    );
  }
  if (nextStatus === "paid") {
    await activateNexTechSaleBenefits(settings, updatedSale, now);
  }

  return true;
}

async function activateNexTechSaleBenefits(settings: MongoNexTechSalesSettings, sale: MongoNexTechSale, now: Date) {
  if (sale.productPlanType === "hosting") {
    await renewLifetimeHosting(settings, sale, now);
    await queueNexTechSaleDelivery(settings, sale, now);
    return;
  }

  if (sale.productPlanType !== "lifetime" && sale.productPlanType !== "monthly") {
    await queueNexTechSaleDelivery(settings, sale, now);
    return;
  }

  const { nexTechProducts, nexTechSubscriptions } = await getMongoCollections();
  const product = sale.productId
    ? await nexTechProducts.findOne({ _id: sale.productId, ownerUserId: settings.ownerUserId, storeId: settings.storeId })
    : null;
  const plan = product?.plans[sale.productPlanType];
  const isLifetime = sale.productPlanType === "lifetime";
  const freeHostingDays = isLifetime ? Math.max(0, Math.floor(plan?.freeHostingDays ?? LIFETIME_FREE_HOSTING_DAYS)) : null;
  const hostingFreeUntil = freeHostingDays ? new Date(now.getTime() + freeHostingDays * 86_400_000) : null;
  const hostingPriceCents = isLifetime ? Math.max(0, Math.round(plan?.hostingPriceCents ?? LIFETIME_HOSTING_PRICE_CENTS)) : null;

  await nexTechSubscriptions.updateOne(
    {
      customerId: sale.customerId,
      ownerUserId: settings.ownerUserId,
      productId: sale.productId ?? null,
      productPlanType: sale.productPlanType,
      storeId: settings.storeId
    },
    {
      $set: {
        expiresAt: isLifetime ? null : sale.expiresAt,
        hostingFreeUntil,
        hostingPriceCents,
        hostingStatus: isLifetime ? "active" : "not_required",
        lastHostingChargeAt: null,
        licenseExpiresAt: isLifetime ? null : sale.expiresAt,
        licenseStatus: "active",
        licenseType: sale.productPlanType,
        nextHostingDueAt: isLifetime ? hostingFreeUntil : null,
        productId: sale.productId ?? null,
        productName: sale.productName ?? product?.name ?? sale.planName,
        productPlanType: sale.productPlanType,
        productSlug: sale.productSlug ?? product?.slug ?? null,
        status: "active",
        supportLevel: isLifetime ? "priority" : "standard",
        updatesIncluded: true,
        updatedAt: now
      },
      $setOnInsert: {
        _id: randomUUID(),
        botId: settings.botId,
        createdAt: now,
        customerId: sale.customerId,
        guildId: settings.guildId,
        ownerUserId: settings.ownerUserId,
        planId: sale.planId ?? sale.productId ?? sale._id,
        saleId: sale._id,
        startsAt: sale.paidAt ?? now,
        storeId: settings.storeId
      }
    },
    { upsert: true }
  );
  await queueNexTechSaleDelivery(settings, sale, now, plan?.discordRoleId ?? null);
}

async function queueNexTechSaleDelivery(
  settings: MongoNexTechSalesSettings,
  sale: MongoNexTechSale,
  now: Date,
  fallbackPurchasedRoleId: string | null = null
) {
  const { nexTechSales } = await getMongoCollections();
  const buyerId = normalizeSnowflake(sale.buyerId);
  const customerRoleId = normalizeSnowflake(settings.customerRoleId);
  const purchasedRoleId = normalizeSnowflake(sale.purchasedRoleId ?? fallbackPurchasedRoleId);

  if (!buyerId) {
    await nexTechSales.updateOne(
      { _id: sale._id, ownerUserId: settings.ownerUserId, storeId: settings.storeId },
      {
        $set: {
          deliveryError: "Comprador sem ID Discord válido.",
          deliveryStatus: "failed",
          updatedAt: now
        }
      }
    );
    return;
  }

  const current = await nexTechSales.findOne({ _id: sale._id, ownerUserId: settings.ownerUserId, storeId: settings.storeId });
  if (current?.deliveryStatus === "delivered") {
    return;
  }

  if (current?.deliveryAttemptedAt && now.getTime() - current.deliveryAttemptedAt.getTime() < 60_000) {
    return;
  }

  await nexTechSales.updateOne(
    { _id: sale._id, ownerUserId: settings.ownerUserId, storeId: settings.storeId },
    {
      $set: {
        deliveryAttemptedAt: now,
        deliveryError: null,
        deliveryStatus: "pending",
        purchasedRoleId,
        updatedAt: now
      }
    }
  );

  const payload = {
    amountCents: sale.amountCents,
    botId: settings.botId,
    buyerId,
    buyerName: sale.buyerName,
    currency: sale.currency,
    customerRoleId,
    guildId: settings.guildId,
    logChannelId: normalizeSnowflake(settings.logChannelId),
    planName: sale.planName,
    productName: sale.productName ?? null,
    productPlanType: sale.productPlanType ?? null,
    purchasedRoleId,
    saleChannelId: normalizeSnowflake(settings.saleChannelId) ?? normalizeSnowflake(settings.logChannelId),
    saleId: sale._id
  };
  emitRealtime("nex-tech-sales:sale_paid", payload);
  emitRealtimeToRoom(devBotRealtimeRoom(settings.botId), "nex-tech-sales:sale_paid", payload);
}

async function renewLifetimeHosting(settings: MongoNexTechSalesSettings, sale: MongoNexTechSale, now: Date) {
  const { nexTechSubscriptions } = await getMongoCollections();
  const current = await nexTechSubscriptions.findOne({
    customerId: sale.customerId,
    ownerUserId: settings.ownerUserId,
    productId: sale.productId ?? null,
    productPlanType: "lifetime",
    storeId: settings.storeId
  });

  if (!current) {
    return;
  }

  const base = current.nextHostingDueAt && current.nextHostingDueAt > now ? current.nextHostingDueAt : now;
  const nextHostingDueAt = new Date(base.getTime() + 30 * 86_400_000);
  await nexTechSubscriptions.updateOne(
    { _id: current._id, ownerUserId: settings.ownerUserId, storeId: settings.storeId },
    {
      $set: {
        hostingStatus: "active",
        lastHostingChargeAt: now,
        nextHostingDueAt,
        status: "active",
        updatedAt: now
      }
    }
  );
}

async function reconcileLifetimeHostingCharges(settings: MongoNexTechSalesSettings) {
  const { nexTechCustomers, nexTechSales, nexTechSubscriptions } = await getMongoCollections();
  const now = new Date();
  const scope = tenantScope(settings.botId, settings.guildId, settings.ownerUserId, settings.storeId);
  const dueSubscriptions = await nexTechSubscriptions.find({
    ...scope,
    productPlanType: "lifetime",
    status: "active",
    nextHostingDueAt: { $ne: null, $lte: now }
  }).limit(100).toArray();

  for (const subscription of dueSubscriptions) {
    const productId = subscription.productId ?? null;
    const existingCharge = await nexTechSales.findOne({
      ...scope,
      customerId: subscription.customerId,
      productId,
      productPlanType: "hosting",
      status: "pending"
    });

    if (existingCharge) {
      await nexTechSubscriptions.updateOne(
        { _id: subscription._id, ...scope },
        { $set: { hostingStatus: "suspended", updatedAt: now } }
      );
      continue;
    }

    const customer = await nexTechCustomers.findOne({ _id: subscription.customerId, ...scope });
    const sale: MongoNexTechSale = {
      _id: randomUUID(),
      amountCents: subscription.hostingPriceCents ?? LIFETIME_HOSTING_PRICE_CENTS,
      botId: settings.botId,
      buyerId: customer?.discordId ?? subscription.customerId,
      buyerName: customer?.name ?? null,
      checkoutUrl: null,
      createdAt: now,
      createdBy: null,
      currency: settings.currency,
      customerId: subscription.customerId,
      expiresAt: new Date(now.getTime() + 7 * 86_400_000),
      externalReference: null,
      guildId: settings.guildId,
      notes: "Cobranca mensal de hospedagem do Plano Vitalicio.",
      ownerUserId: settings.ownerUserId,
      paidAt: null,
      paymentGatewayId: null,
      paymentProviderId: null,
      paymentProviderLabel: null,
      planId: null,
      planName: `Hospedagem - ${subscription.productName ?? "Plano Vitalicio"}`,
      productId,
      productName: subscription.productName ?? null,
      productPlanType: "hosting",
      productSlug: subscription.productSlug ?? null,
      status: "pending",
      storeId: settings.storeId,
      successUrl: null,
      updatedAt: now,
      updatedBy: null
    };

    await nexTechSales.insertOne(sale);
    await nexTechSubscriptions.updateOne(
      { _id: subscription._id, ...scope },
      {
        $set: {
          hostingStatus: "suspended",
          lastHostingChargeAt: now,
          updatedAt: now
        }
      }
    );
  }
}

async function upsertCustomer(
  collection: Awaited<ReturnType<typeof getMongoCollections>>["nexTechCustomers"],
  input: {
    botId: string;
    buyerId: string;
    buyerName: string | null;
    guildId: string;
    now: Date;
    ownerUserId: string;
    storeId: string;
  }
) {
  const existing = await collection.findOne({
    discordId: input.buyerId,
    ownerUserId: input.ownerUserId,
    storeId: input.storeId
  });

  if (existing) {
    await collection.updateOne(
      { _id: existing._id, ownerUserId: input.ownerUserId, storeId: input.storeId },
      {
        $set: {
          name: input.buyerName ?? existing.name,
          updatedAt: input.now
        }
      }
    );
    return (await collection.findOne({ _id: existing._id, ownerUserId: input.ownerUserId, storeId: input.storeId })) ?? existing;
  }

  const customer = {
    _id: randomUUID(),
    botId: input.botId,
    guildId: input.guildId,
    ownerUserId: input.ownerUserId,
    storeId: input.storeId,
    discordId: input.buyerId,
    name: input.buyerName,
    email: null,
    createdAt: input.now,
    updatedAt: input.now
  };

  await collection.insertOne(customer);
  return customer;
}

function normalizeNullable(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function normalizeSnowflake(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return /^\d{5,32}$/.test(normalized) ? normalized : null;
}

function validateWebhookSignature(
  provider: MongoNexTechSalesPaymentProvider,
  input: {
    dataId: string | null;
    rawBody: string;
    requestId: string | null;
    signature: string | null;
  }
) {
  if (!provider.webhookSecretEncrypted) {
    return true;
  }

  if (!input.signature) {
    return false;
  }

  try {
    const secret = decryptSecret(provider.webhookSecretEncrypted);
    const expected = provider.provider === "mercadopago"
      ? createMercadoPagoWebhookSignature(secret, input)
      : createHmac("sha256", secret).update(input.rawBody).digest("hex");
    const normalizedSignature = provider.provider === "mercadopago"
      ? readMercadoPagoSignaturePart(input.signature, "v1")
      : input.signature.replace(/^sha256=/i, "").trim();

    if (!normalizedSignature) {
      return false;
    }

    const expectedBuffer = Buffer.from(expected, "hex");
    const receivedBuffer = Buffer.from(normalizedSignature, "hex");

    return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
  } catch {
    return false;
  }
}

function createMercadoPagoWebhookSignature(
  secret: string,
  input: {
    dataId: string | null;
    requestId: string | null;
    signature: string | null;
  }
) {
  const ts = readMercadoPagoSignaturePart(input.signature, "ts");

  if (!input.dataId || !input.requestId || !ts) {
    return "";
  }

  const manifest = `id:${input.dataId};request-id:${input.requestId};ts:${ts};`;
  return createHmac("sha256", secret).update(manifest).digest("hex");
}

function readMercadoPagoSignaturePart(signature: string | null, key: string) {
  if (!signature) {
    return null;
  }

  for (const part of signature.split(",")) {
    const [partKey, ...valueParts] = part.split("=");

    if (partKey?.trim() === key) {
      return valueParts.join("=").trim();
    }
  }

  return null;
}

function readWebhookSaleId(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const saleId = record.saleId ?? record.sale_id ?? record.external_reference ?? record.externalReference;

  return typeof saleId === "string" ? saleId : null;
}

function readWebhookDataId(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const data = record.data;

  if (data && typeof data === "object" && !Array.isArray(data)) {
    const id = (data as Record<string, unknown>).id;
    return typeof id === "string" || typeof id === "number" ? String(id) : null;
  }

  return null;
}

function isPaymentWebhook(eventType: string | null | undefined, payload: unknown) {
  const normalizedType = eventType?.toLowerCase() ?? "";

  if (normalizedType === "payment" || normalizedType.startsWith("payment.")) {
    return true;
  }

  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return record.type === "payment" || (typeof record.action === "string" && record.action.startsWith("payment."));
}

function readMercadoPagoExternalReference(payload: Record<string, unknown> | null) {
  return readStringField(payload, "external_reference");
}

function readMercadoPagoStatus(payload: Record<string, unknown> | null) {
  return readStringField(payload, "status");
}

function mercadoPagoStatusToSaleStatus(status: string): MongoNexTechSaleStatus | null {
  switch (status) {
    case "approved":
    case "accredited":
      return "paid";
    case "cancelled":
    case "rejected":
      return "cancelled";
    case "refunded":
    case "charged_back":
      return "refunded";
    case "pending":
    case "in_process":
    case "in_mediation":
      return "pending";
    default:
      return null;
  }
}

function decryptProviderSecret(provider: MongoNexTechSalesPaymentProvider, message: string) {
  if (!provider.secretEncrypted) {
    throw createNexTechSalesError(message, 400);
  }

  return decryptSecret(provider.secretEncrypted);
}

function readMercadoPagoError(payload: Record<string, unknown> | null) {
  const message = readStringField(payload, "message");
  const error = readStringField(payload, "error");

  return message ?? error;
}

function readStringField(payload: Record<string, unknown> | null, key: string) {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function productFieldsFromInput(input: SaveProductInput, settings: MongoNexTechSalesSettings): Omit<
  MongoNexTechProduct,
  "_id" | "botId" | "createdAt" | "createdBy" | "guildId" | "ownerUserId" | "slug" | "storeId" | "updatedAt" | "updatedBy"
> {
  return {
    active: input.active,
    additionalInfo: normalizeNullable(input.additionalInfo) ?? "",
    bannerUrl: normalizeNullable(input.bannerUrl),
    category: input.category.trim() || "Produto digital",
    fullDescription: normalizeNullable(input.fullDescription) ?? "",
    howItWorks: normalizeNullable(input.howItWorks) ?? "",
    layout: {
      accentColor: input.layout?.accentColor?.trim() || settings.panelColor || "#7c3aed",
      glassEffect: input.layout?.glassEffect ?? true,
      theme: input.layout?.theme ?? "dark"
    },
    name: input.name.trim(),
    observations: normalizeNullable(input.observations) ?? "",
    plans: {
      monthly: normalizePlan(input.plans.monthly, "Plano Mensal", "Mensal", 30, settings.paymentProviders[0]?.id ?? null),
      lifetime: normalizePlan(input.plans.lifetime, "Plano Vitalicio", "Vitalicio", LIFETIME_PLAN_PRICE_CENTS, settings.paymentProviders[0]?.id ?? null)
    },
    seo: {
      description: normalizeNullable(input.seo?.description),
      title: normalizeNullable(input.seo?.title)
    },
    shortDescription: normalizeNullable(input.shortDescription) ?? "",
    toggles: normalizeFeatureToggles(input.toggles),
    warnings: normalizeNullable(input.warnings) ?? ""
  };
}

function normalizePlan(
  plan: SaveProductInput["plans"]["monthly"],
  fallbackName: string,
  fallbackButton: string,
  fallbackPrice: number,
  fallbackProviderId: string | null
): MongoNexTechProductPlanConfig {
  return {
    benefits: Array.isArray(plan.benefits) ? plan.benefits.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [],
    buttonColor: plan.buttonColor?.trim() || "#7c3aed",
    buttonText: plan.buttonText?.trim() || fallbackButton,
    description: plan.description?.trim() || "",
    discordRoleId: normalizeSnowflake(plan.discordRoleId),
    enabled: plan.enabled,
    freeHostingDays: Number.isFinite(plan.freeHostingDays) ? Math.max(0, Math.floor(plan.freeHostingDays ?? 0)) : null,
    hostingPriceCents: Number.isFinite(plan.hostingPriceCents) ? Math.max(0, Math.round(plan.hostingPriceCents ?? 0)) : null,
    name: plan.name.trim() || fallbackName,
    paymentProviderId: plan.paymentProviderId ?? fallbackProviderId,
    priceCents: Number.isFinite(plan.priceCents) ? plan.priceCents : fallbackPrice,
    priceText: plan.priceText?.trim() || ""
  };
}

function normalizeFeatureToggles(toggles: SaveProductInput["toggles"] = {}) {
  const keys: MongoNexTechProductFeatureKey[] = [
    "hosting",
    "updates",
    "support",
    "automaticContract",
    "automaticPix",
    "releaseCode",
    "coupons",
    "automaticRenewal",
    "passwordCreation",
    "automaticLogin",
    "activationKey"
  ];

  return Object.fromEntries(keys.map((key) => [key, Boolean(toggles[key])])) as Record<MongoNexTechProductFeatureKey, boolean>;
}

function slugifyProduct(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "produto";
}

async function uniqueProductSlug(storeId: string, wantedSlug: string) {
  const { nexTechProducts } = await getMongoCollections();
  const base = slugifyProduct(wantedSlug);
  let slug = base;
  let suffix = 2;

  while (await nexTechProducts.findOne({ storeId, slug }, { projection: { _id: 1 } })) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }

  return slug;
}

function createNexTechSalesError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}

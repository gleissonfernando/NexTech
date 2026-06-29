import { randomUUID } from "node:crypto";
import type {
  MongoOrvitechSale,
  MongoOrvitechSalesPaymentProvider,
  MongoOrvitechSalesPlan,
  MongoOrvitechSalesSettings,
  MongoOrvitechSaleStatus
} from "../database/mongo";
import { getMongoCollections } from "../database/mongo";
import { encryptSecret } from "./secretCryptoService";

export const ORVITECH_SALES_MODULE_ID = "orvitech-sales";
export const ORVITECH_PRIMARY_CLIENT_ID = "1492325134550302952";

export type OrvitechSalesSettingsDto = Omit<MongoOrvitechSalesSettings, "_id" | "createdAt" | "updatedAt" | "paymentProviders"> & {
  id: string;
  createdAt: string;
  updatedAt: string;
  paymentProviders: OrvitechSalesPaymentProviderDto[];
};

export type OrvitechSalesPaymentProviderDto = Omit<MongoOrvitechSalesPaymentProvider, "secretEncrypted" | "updatedAt"> & {
  secretConfigured: boolean;
  secretMasked: string | null;
  updatedAt: string;
};

export type OrvitechSalesPlanDto = Omit<MongoOrvitechSalesPlan, "_id" | "createdAt" | "updatedAt"> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type OrvitechSaleDto = Omit<MongoOrvitechSale, "_id" | "createdAt" | "updatedAt" | "paidAt" | "expiresAt"> & {
  id: string;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  expiresAt: string | null;
};

export type OrvitechSalesDashboardDto = {
  plans: OrvitechSalesPlanDto[];
  sales: OrvitechSaleDto[];
  settings: OrvitechSalesSettingsDto;
  stats: {
    activePlans: number;
    paidSales: number;
    pendingSales: number;
    revenueCents: number;
    salesThisMonth: number;
    totalSales: number;
  };
};

export type SaveOrvitechSalesSettingsInput = Partial<{
  currency: "BRL" | "USD" | "EUR";
  customerRoleId: string | null;
  enabled: boolean;
  logChannelId: string | null;
  ownerUserId: string;
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
  provider: MongoOrvitechSalesPaymentProvider["provider"];
  publicKey?: string | null;
  secret?: string | null;
  webhookUrl?: string | null;
};

export type SavePlanInput = {
  checkoutMessage?: string | null;
  description?: string | null;
  durationDays?: number | null;
  enabled: boolean;
  imageUrl?: string | null;
  moduleIds: string[];
  name: string;
  priceCents: number;
};

export type SaveSaleInput = {
  amountCents?: number | null;
  buyerId: string;
  buyerName?: string | null;
  externalReference?: string | null;
  notes?: string | null;
  paymentProviderId?: string | null;
  planId?: string | null;
  status: MongoOrvitechSaleStatus;
};

export async function getOrvitechSalesDashboard(botId: string, guildId: string) {
  const { orvitechSales, orvitechSalesPlans } = await getMongoCollections();
  const [settings, plans, sales] = await Promise.all([
    ensureOrvitechSalesSettings(botId, guildId),
    orvitechSalesPlans.find({ botId, guildId }).sort({ createdAt: -1 }).toArray(),
    orvitechSales.find({ botId, guildId }).sort({ createdAt: -1 }).limit(100).toArray()
  ]);

  return toDashboardDto(settings, plans, sales);
}

export async function ensureOrvitechSalesSettings(botId: string, guildId: string, actorId: string | null = null) {
  const { orvitechSalesSettings } = await getMongoCollections();
  const existing = await orvitechSalesSettings.findOne({ botId, guildId });

  if (existing) {
    return existing;
  }

  const now = new Date();
  const settings: MongoOrvitechSalesSettings = {
    _id: randomUUID(),
    botId,
    guildId,
    enabled: false,
    ownerUserId: ORVITECH_PRIMARY_CLIENT_ID,
    publicUrl: `/orvitech/${ORVITECH_PRIMARY_CLIENT_ID}`,
    currency: "BRL",
    saleChannelId: null,
    logChannelId: null,
    supportRoleIds: [],
    customerRoleId: null,
    panelTitle: "OrviTech Bot",
    panelDescription: "Planos, liberacoes e pagamentos do bot OrviTech.",
    panelColor: "#7c3aed",
    panelImageUrl: null,
    thumbnailUrl: null,
    termsUrl: null,
    paymentProviders: [
      {
        id: randomUUID(),
        enabled: true,
        label: "Pagamento manual",
        provider: "manual",
        publicKey: null,
        secretEncrypted: null,
        webhookUrl: null,
        instructions: "Registre a venda como pendente e marque como paga depois da confirmacao.",
        updatedAt: now
      }
    ],
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: now,
    updatedAt: now
  };

  await orvitechSalesSettings.insertOne(settings);
  return settings;
}

export async function saveOrvitechSalesSettings(botId: string, guildId: string, input: SaveOrvitechSalesSettingsInput, actorId: string) {
  const current = await ensureOrvitechSalesSettings(botId, guildId, actorId);
  const now = new Date();
  const patch: Partial<MongoOrvitechSalesSettings> = {
    updatedAt: now,
    updatedBy: actorId
  };

  for (const key of [
    "currency",
    "customerRoleId",
    "enabled",
    "logChannelId",
    "ownerUserId",
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

  const { orvitechSalesSettings } = await getMongoCollections();
  await orvitechSalesSettings.updateOne({ _id: current._id }, { $set: patch });
  return (await orvitechSalesSettings.findOne({ _id: current._id })) ?? current;
}

export async function saveOrvitechPaymentProvider(botId: string, guildId: string, input: SavePaymentProviderInput, actorId: string) {
  const current = await ensureOrvitechSalesSettings(botId, guildId, actorId);
  const now = new Date();
  const existing = current.paymentProviders.find((provider) => provider.id === input.id);
  const nextProvider: MongoOrvitechSalesPaymentProvider = {
    id: existing?.id ?? randomUUID(),
    enabled: input.enabled,
    label: input.label.trim(),
    provider: input.provider,
    publicKey: normalizeNullable(input.publicKey),
    secretEncrypted: input.secret?.trim() ? encryptSecret(input.secret.trim()) : existing?.secretEncrypted ?? null,
    webhookUrl: normalizeNullable(input.webhookUrl),
    instructions: normalizeNullable(input.instructions),
    updatedAt: now
  };
  const paymentProviders = existing
    ? current.paymentProviders.map((provider) => provider.id === existing.id ? nextProvider : provider)
    : [nextProvider, ...current.paymentProviders];

  const { orvitechSalesSettings } = await getMongoCollections();
  await orvitechSalesSettings.updateOne(
    { _id: current._id },
    {
      $set: {
        paymentProviders,
        updatedAt: now,
        updatedBy: actorId
      }
    }
  );

  return (await orvitechSalesSettings.findOne({ _id: current._id })) ?? current;
}

export async function deleteOrvitechPaymentProvider(botId: string, guildId: string, providerId: string, actorId: string) {
  const current = await ensureOrvitechSalesSettings(botId, guildId, actorId);
  const nextProviders = current.paymentProviders.filter((provider) => provider.id !== providerId);

  const { orvitechSalesSettings } = await getMongoCollections();
  await orvitechSalesSettings.updateOne(
    { _id: current._id },
    {
      $set: {
        paymentProviders: nextProviders,
        updatedAt: new Date(),
        updatedBy: actorId
      }
    }
  );

  return (await orvitechSalesSettings.findOne({ _id: current._id })) ?? current;
}

export async function saveOrvitechSalesPlan(botId: string, guildId: string, planId: string | null, input: SavePlanInput, actorId: string) {
  const { orvitechSalesPlans } = await getMongoCollections();
  const now = new Date();

  if (planId) {
    await orvitechSalesPlans.updateOne(
      { _id: planId, botId, guildId },
      {
        $set: {
          checkoutMessage: normalizeNullable(input.checkoutMessage),
          description: normalizeNullable(input.description),
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

    return orvitechSalesPlans.findOne({ _id: planId, botId, guildId });
  }

  const plan: MongoOrvitechSalesPlan = {
    _id: randomUUID(),
    botId,
    guildId,
    name: input.name.trim(),
    description: normalizeNullable(input.description),
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

  await orvitechSalesPlans.insertOne(plan);
  return plan;
}

export async function deleteOrvitechSalesPlan(botId: string, guildId: string, planId: string) {
  const { orvitechSalesPlans } = await getMongoCollections();
  const deleted = await orvitechSalesPlans.findOneAndDelete({ _id: planId, botId, guildId });
  return deleted;
}

export async function saveOrvitechSale(botId: string, guildId: string, input: SaveSaleInput, actorId: string) {
  const { orvitechSales, orvitechSalesPlans } = await getMongoCollections();
  const [settings, plan] = await Promise.all([
    ensureOrvitechSalesSettings(botId, guildId, actorId),
    input.planId ? orvitechSalesPlans.findOne({ _id: input.planId, botId, guildId }) : null
  ]);
  const now = new Date();
  const provider = settings.paymentProviders.find((item) => item.id === input.paymentProviderId) ?? null;
  const amountCents = input.amountCents ?? plan?.priceCents ?? 0;
  const paidAt = input.status === "paid" ? now : null;
  const expiresAt = paidAt && plan?.durationDays ? new Date(paidAt.getTime() + plan.durationDays * 24 * 60 * 60 * 1000) : null;
  const sale: MongoOrvitechSale = {
    _id: randomUUID(),
    botId,
    guildId,
    planId: plan?._id ?? null,
    planName: plan?.name ?? "Venda avulsa",
    buyerId: input.buyerId.trim(),
    buyerName: normalizeNullable(input.buyerName),
    amountCents,
    currency: settings.currency,
    paymentProviderId: provider?.id ?? null,
    paymentProviderLabel: provider?.label ?? null,
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

  await orvitechSales.insertOne(sale);
  return sale;
}

export async function updateOrvitechSaleStatus(botId: string, guildId: string, saleId: string, status: MongoOrvitechSaleStatus, actorId: string) {
  const { orvitechSales, orvitechSalesPlans } = await getMongoCollections();
  const sale = await orvitechSales.findOne({ _id: saleId, botId, guildId });

  if (!sale) return null;

  const plan = sale.planId ? await orvitechSalesPlans.findOne({ _id: sale.planId, botId, guildId }) : null;
  const now = new Date();
  const paidAt = status === "paid" ? sale.paidAt ?? now : sale.paidAt;
  const expiresAt = status === "paid" && paidAt && plan?.durationDays
    ? sale.expiresAt ?? new Date(paidAt.getTime() + plan.durationDays * 24 * 60 * 60 * 1000)
    : sale.expiresAt;

  await orvitechSales.updateOne(
    { _id: saleId, botId, guildId },
    {
      $set: {
        expiresAt,
        paidAt,
        status,
        updatedAt: now,
        updatedBy: actorId
      }
    }
  );

  return orvitechSales.findOne({ _id: saleId, botId, guildId });
}

function toDashboardDto(settings: MongoOrvitechSalesSettings, plans: MongoOrvitechSalesPlan[], sales: MongoOrvitechSale[]): OrvitechSalesDashboardDto {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  return {
    settings: toSettingsDto(settings),
    plans: plans.map(toPlanDto),
    sales: sales.map(toSaleDto),
    stats: {
      activePlans: plans.filter((plan) => plan.enabled).length,
      paidSales: sales.filter((sale) => sale.status === "paid").length,
      pendingSales: sales.filter((sale) => sale.status === "pending").length,
      revenueCents: sales.filter((sale) => sale.status === "paid").reduce((total, sale) => total + sale.amountCents, 0),
      salesThisMonth: sales.filter((sale) => sale.createdAt >= monthStart).length,
      totalSales: sales.length
    }
  };
}

export function toSettingsDto(settings: MongoOrvitechSalesSettings): OrvitechSalesSettingsDto {
  return {
    ...settings,
    id: settings._id,
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString(),
    paymentProviders: settings.paymentProviders.map(toPaymentProviderDto)
  };
}

export function toPlanDto(plan: MongoOrvitechSalesPlan): OrvitechSalesPlanDto {
  return {
    ...plan,
    id: plan._id,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString()
  };
}

export function toSaleDto(sale: MongoOrvitechSale): OrvitechSaleDto {
  return {
    ...sale,
    id: sale._id,
    paidAt: sale.paidAt?.toISOString() ?? null,
    expiresAt: sale.expiresAt?.toISOString() ?? null,
    createdAt: sale.createdAt.toISOString(),
    updatedAt: sale.updatedAt.toISOString()
  };
}

function toPaymentProviderDto(provider: MongoOrvitechSalesPaymentProvider): OrvitechSalesPaymentProviderDto {
  return {
    id: provider.id,
    enabled: provider.enabled,
    label: provider.label,
    provider: provider.provider,
    publicKey: provider.publicKey,
    webhookUrl: provider.webhookUrl,
    instructions: provider.instructions,
    secretConfigured: Boolean(provider.secretEncrypted),
    secretMasked: provider.secretEncrypted ? "******** protegido" : null,
    updatedAt: provider.updatedAt.toISOString()
  };
}

function normalizeNullable(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

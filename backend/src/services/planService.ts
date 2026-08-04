import { createCipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { env } from "../config/env";
import {
  getPaymentGatewayHealth,
  getMercadoPagoRuntimeConfig,
  getPagBankRuntimeConfig,
  getStripeRuntimeConfig,
  getAsaasRuntimeConfig,
  requireMercadoPagoOperational,
  requirePagBankOperational,
  requireStripeOperational,
  requireAsaasOperational
} from "../config/payments";
import type {
  MongoBotCredential,
  MongoPaymentEvent,
  MongoPaymentOrder,
  MongoPaymentProvider,
  MongoPaymentSettings,
  MongoPlan,
  MongoPlanAuditLog,
  MongoPlanBillingCycle,
  MongoPlanEntitlement,
  MongoPlanFeature,
  MongoPlanPaymentOrderStatus,
  MongoPlanSubscription,
  MongoPlanSubscriptionStatus,
  MongoPlanWorkspace
} from "../database/mongo";
import { getMongoCollections } from "../database/mongo";
import { buildAppUrl } from "../config/appUrl";
import { MercadoPagoPaymentProvider, PaymentManager, type ProviderPayment, type ProviderPixOrderResult } from "./paymentProviderService";
import type { MercadoPagoPixOrderResult } from "./mercadoPagoService";
import {
  createStripeCheckout,
  getStripeCheckoutSession,
  stripeSessionToProviderPayment,
  validateStripeWebhookSignature
} from "./stripeService";
import {
  AsaasPaymentService,
  asaasPaymentToProviderPayment,
  validateAsaasWebhookToken,
  type AsaasPayment
} from "./payments/asaasPaymentService";
import { PaymentService, checkoutMethodToPaymentMethod } from "./payments/paymentService";
import { PAYMENT_METHODS } from "./payments/types";
import { encryptSecret } from "./secretCryptoService";
import type { DashboardAuth } from "./tokenService";
import { moduleIdsFromPlanEntitlementKeys } from "./moduleEntitlementService";
import { markBotInvoicePaidFromAsaas } from "./botBillingService";
import { ensureContractForPaymentOrder, syncContractActivatedFromSubscription } from "./contractBillingService";

export type PlanActor = {
  id: string | null;
  ip?: string | null;
  name?: string | null;
  userAgent?: string | null;
};

type CheckoutBuyer = {
  cpfCnpj?: string | null;
  discordId: string;
  email: string | null;
  name: string | null;
  userId: string;
};

export type CheckoutPaymentMethod = "checkout" | "pix";

export type SavePlanInput = {
  badge?: string | null;
  billingCycle?: MongoPlanBillingCycle;
  botLimit?: number;
  buttonText?: string;
  color?: string;
  currency?: "BRL" | "USD" | "EUR";
  description?: string;
  entitlements?: MongoPlanEntitlement[];
  guildLimit?: number;
  icon?: string | null;
  imageUrl?: string | null;
  isActive?: boolean;
  isPublic?: boolean;
  isPurchasable?: boolean;
  isRecommended?: boolean;
  name: string;
  order?: number;
  priceInCents?: number;
  promotionalPriceInCents?: number | null;
  shortDescription?: string;
  slug?: string | null;
  validityDays?: number | null;
};

export type SavePlanFeatureInput = {
  category: MongoPlanFeature["category"];
  defaultLimit?: number | null;
  description?: string;
  isActive?: boolean;
  isPublic?: boolean;
  key: string;
  name: string;
  order?: number;
  unit?: string | null;
};

export type SavePaymentSettingsInput = {
  approvedRedirectUrl?: string | null;
  botDashboardBaseUrl?: string | null;
  botRegistrationUrl?: string | null;
  cancelRedirectUrl?: string | null;
  failureRedirectUrl?: string | null;
  pendingRedirectUrl?: string | null;
  plansPublicUrl?: string | null;
  provider?: MongoPaymentProvider;
  publicKey?: string | null;
  secret?: string | null;
  successRedirectUrl?: string | null;
  supportDiscordUrl?: string | null;
  webhookSecret?: string | null;
};

export type ManualActivationInput = {
  planId: string;
  userId: string;
  workspaceName?: string | null;
};

export type BotCredentialInput = {
  botClientId: string;
  botName: string;
  token: string;
};

export type BotRegistrationInput = {
  guildId: string;
  slug?: string | null;
  token: string;
};

export type PlanDto = Omit<MongoPlan, "_id" | "createdAt" | "updatedAt"> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type PlanFeatureDto = Omit<MongoPlanFeature, "_id" | "createdAt" | "updatedAt"> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type PlanSubscriptionDto = Omit<MongoPlanSubscription, "_id" | "createdAt" | "updatedAt" | "startedAt" | "endsAt" | "activatedAt" | "suspendedAt" | "cancelledAt"> & {
  id: string;
  activatedAt: string | null;
  createdAt: string;
  endsAt: string | null;
  plan: Pick<PlanDto, "id" | "name" | "slug" | "color" | "badge" | "botLimit" | "guildLimit"> | null;
  startedAt: string | null;
  suspendedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
  workspace: Pick<PlanWorkspaceDto, "id" | "name" | "slug" | "status"> | null;
};

export type PlanWorkspaceDto = Omit<MongoPlanWorkspace, "_id" | "createdAt" | "updatedAt"> & {
  id: string;
  botCount: number;
  bots?: BotCredentialDto[];
  createdAt: string;
  updatedAt: string;
};

export type BotCredentialDto = Omit<
  MongoBotCredential,
  "_id" | "createdAt" | "updatedAt" | "tokenCiphertext" | "tokenFingerprint" | "encryptedDataKey" | "iv" | "authTag" | "lastValidatedAt"
> & {
  id: string;
  createdAt: string;
  lastValidatedAt: string | null;
  tokenConfigured: true;
  updatedAt: string;
};

export type PaymentOrderDto = Omit<MongoPaymentOrder, "_id" | "accessActivatedAt" | "approvedAt" | "cancelledAt" | "createdAt" | "expiresAt" | "paidAt" | "refundedAt" | "rejectedAt" | "updatedAt"> & {
  accessActivatedAt: string | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  id: string;
  createdAt: string;
  expiresAt: string | null;
  paidAt: string | null;
  refundedAt: string | null;
  rejectedAt: string | null;
  updatedAt: string;
};

export type PaymentSettingsDto = Omit<MongoPaymentSettings, "_id" | "secretEncrypted" | "webhookSecretEncrypted" | "updatedAt"> & {
  id: "global";
  secretConfigured: boolean;
  updatedAt: string;
  webhookSecretConfigured: boolean;
};

export type MercadoPagoWebhookInput = {
  body: unknown;
  dataId: string | null;
  requestId: string | null;
  resourceType?: string | null;
  signature: string | null;
};

export type PagBankWebhookInput = {
  body: unknown;
  eventId?: string | null;
  requestId?: string | null;
  signature?: string | null;
  webhookToken?: string | null;
};

export type StripeWebhookInput = {
  rawBody: Buffer;
  requestId?: string | null;
  signature?: string | null;
};

export type AsaasWebhookInput = {
  body: unknown;
  eventId?: string | null;
  requestId?: string | null;
  webhookToken?: string | null;
};

const FEATURE_SEEDS: SavePlanFeatureInput[] = [
  { category: "streamer", key: "streamer.twitch_alerts", name: "Alertas Twitch", description: "Alertas de live, clips e eventos de stream.", order: 10 },
  { category: "streamer", key: "streamer.kick_alerts", name: "Alertas Kick", description: "Monitoramento de lives e notificações Kick.", order: 20 },
  { category: "streamer", key: "streamer.clip_automation", name: "Automacao de clips", description: "Registro e ranking de clips por comunidade.", order: 30 },
  { category: "streamer", key: "streamer.giveaways", name: "Sorteios", description: "Sorteios, campanhas e premiacoes da comunidade.", order: 31 },
  { category: "streamer", key: "streamer.vip", name: "Sistema VIP", description: "Controle de benefícios VIP para comunidades de stream.", order: 32 },
  { category: "streamer", key: "streamer.ranking", name: "Ranking", description: "Rankings de engajamento e atividades.", order: 33 },
  { category: "streamer", key: "streamer.ai", name: "IA", description: "Recursos assistidos por IA para operação da comunidade.", order: 34 },
  { category: "fivem", key: "fivem.finance", name: "Financeiro FiveM", description: "Controle de transacoes, metas e auditoria financeira.", order: 40 },
  { category: "fivem", key: "fivem.hierarchy", name: "Hierarquia FiveM", description: "Paineis de hierarquia e cargos por facção/corporacao.", order: 60 },
  { category: "fivem", key: "fivem.police_basic", name: "Polícia RP Básico", description: "Recursos essenciais de corporação, ações, QRU e ponto.", order: 61 },
  { category: "fivem", key: "fivem.police", name: "Polícia RP Completo", description: "Recursos completos para corporacoes, patentes, metas e plantao.", order: 62 },
  { category: "fivem", key: "fivem.faction_basic", name: "Facção RP Básico", description: "Recursos essenciais para facções, membros e ações.", order: 63 },
  { category: "fivem", key: "fivem.faction", name: "Facção RP Completo", description: "Recursos completos para facções, membros, metas e estoque.", order: 64 },
  { category: "discord", key: "discord.logs", name: "Logs Discord", description: "Logs do site e do Discord em tempo real.", order: 70 },
  { category: "discord", key: "discord.tickets", name: "Tickets", description: "Atendimento, transcripts e paineis de suporte.", order: 80 },
  { category: "discord", key: "discord.courses", name: "Cursos", description: "Cursos, provas e publicacoes para equipes.", order: 90 },
  { category: "discord", key: "discord.dashboard", name: "Dashboard", description: "Painel web para configuração e acompanhamento.", order: 91 },
  { category: "security", key: "security.anti_ban", name: "Anti Ban", description: "Proteção contra ações administrativas indevidas.", order: 100 },
  { category: "security", key: "security.self_bot", name: "SelfBot Protection", description: "Deteccao e mitigacao de selfbots.", order: 110 },
  { category: "security", key: "security.role_protection_basic", name: "Proteção de cargos básica", description: "Proteção essencial contra alterações indevidas.", order: 111 },
  { category: "security", key: "security.role_protection", name: "Proteção de cargos completa", description: "Proteção completa contra alterações indevidas de cargos e permissões.", order: 112 },
  { category: "support", key: "support.priority", name: "Suporte prioritario", description: "Atendimento prioritario para operação critica.", order: 120 },
  { category: "support", key: "support.24h", name: "Atendimento 24 horas", description: "Atendimento prioritario 24 horas para plano vitalicio.", order: 121 },
  { category: "billing", key: "billing.lifetime_license", name: "Licença vitalicia", description: "Licença permanente do módulo adquirido.", order: 130 },
  { category: "billing", key: "billing.future_updates", name: "Atualizacoes futuras", description: "Atualizacoes futuras e correções do módulo inclusas.", order: 131 },
  { category: "billing", key: "billing.free_hosting_30d", name: "Hospedagem gratis 30 dias", description: "Primeiro mes de hospedagem incluso na compra vitalicia.", order: 132 }
];

const PLAN_SEEDS: SavePlanInput[] = [
  {
    badge: "Sem hospedagem",
    botLimit: 1,
    color: "#FFD500",
    description: "Plano básico para streamers. Hospedagem não inclusa.",
    entitlements: entitlementsFor(["streamer.twitch_alerts", "streamer.kick_alerts", "streamer.clip_automation", "discord.dashboard"]),
    guildLimit: 1,
    icon: "radio",
    isActive: true,
    isPublic: true,
    isPurchasable: true,
    name: "Streamer Básico",
    order: 10,
    priceInCents: 2800,
    shortDescription: "Sistema streamer básico sem hospedagem.",
    slug: "streamer-basico",
    validityDays: 30
  },
  {
    badge: "Completo sem hospedagem",
    botLimit: 1,
    color: "#FFD500",
    description: "Plano completo para streamers com sorteios, VIP, ranking, IA e dashboard completa. Hospedagem não inclusa.",
    entitlements: entitlementsFor(["streamer.twitch_alerts", "streamer.kick_alerts", "streamer.clip_automation", "streamer.giveaways", "streamer.vip", "streamer.ranking", "streamer.ai", "discord.dashboard", "discord.logs", "support.priority"]),
    guildLimit: 1,
    icon: "radio",
    isActive: true,
    isPublic: true,
    isPurchasable: true,
    isRecommended: true,
    name: "Streamer Completo",
    order: 20,
    priceInCents: 5000,
    shortDescription: "Sistema streamer completo sem hospedagem.",
    slug: "streamer-completo",
    validityDays: 30
  },
  {
    badge: "Sem hospedagem",
    botLimit: 1,
    color: "#3DDC84",
    description: "Plano básico para sistema de Polícia RP. Hospedagem não inclusa.",
    entitlements: entitlementsFor(["fivem.police_basic", "fivem.hierarchy", "discord.logs", "discord.dashboard"]),
    guildLimit: 1,
    icon: "building",
    isActive: true,
    isPublic: true,
    isPurchasable: true,
    name: "Polícia RP Básico",
    order: 30,
    priceInCents: 2800,
    shortDescription: "Sistema policia RP básico sem hospedagem.",
    slug: "policia-rp-basico",
    validityDays: 30
  },
  {
    badge: "Completo sem hospedagem",
    botLimit: 1,
    color: "#3DDC84",
    description: "Plano completo para Polícia RP com financeiro, hierarquia, metas, logs e suporte prioritario. Hospedagem não inclusa.",
    entitlements: entitlementsFor(["fivem.police", "fivem.finance", "fivem.hierarchy", "discord.logs", "discord.dashboard", "support.priority"]),
    guildLimit: 1,
    icon: "building",
    isActive: true,
    isPublic: true,
    isPurchasable: true,
    isRecommended: true,
    name: "Polícia RP Completo",
    order: 40,
    priceInCents: 5000,
    shortDescription: "Sistema policia RP completo sem hospedagem.",
    slug: "policia-rp-completo",
    validityDays: 30
  },
  {
    badge: "Sem hospedagem",
    botLimit: 1,
    color: "#FFEA70",
    description: "Plano básico para sistema de Facção RP. Hospedagem não inclusa.",
    entitlements: entitlementsFor(["fivem.faction_basic", "discord.logs", "discord.dashboard"]),
    guildLimit: 1,
    icon: "users",
    isActive: true,
    isPublic: true,
    isPurchasable: true,
    name: "Facção RP Básico",
    order: 50,
    priceInCents: 2800,
    shortDescription: "Sistema facção RP básico sem hospedagem.",
    slug: "faccao-rp-basico",
    validityDays: 30
  },
  {
    badge: "Completo sem hospedagem",
    botLimit: 1,
    color: "#FFEA70",
    description: "Plano completo para Facção RP com financeiro, metas, logs e suporte prioritario. Hospedagem não inclusa.",
    entitlements: entitlementsFor(["fivem.faction", "fivem.finance", "fivem.hierarchy", "discord.logs", "discord.dashboard", "support.priority"]),
    guildLimit: 1,
    icon: "users",
    isActive: true,
    isPublic: true,
    isPurchasable: true,
    isRecommended: true,
    name: "Facção RP Completo",
    order: 60,
    priceInCents: 5000,
    shortDescription: "Sistema facção RP completo sem hospedagem.",
    slug: "faccao-rp-completo",
    validityDays: 30
  },
  {
    badge: "Sem hospedagem",
    botLimit: 1,
    color: "#8B5CF6",
    description: "Plano básico para proteção de cargos e ações administrativas. Hospedagem não inclusa.",
    entitlements: entitlementsFor(["security.role_protection_basic", "security.anti_ban", "discord.logs"]),
    guildLimit: 1,
    icon: "shield",
    isActive: true,
    isPublic: true,
    isPurchasable: true,
    name: "Proteção de Cargos Básico",
    order: 70,
    priceInCents: 2800,
    shortDescription: "Proteção de cargos basica sem hospedagem.",
    slug: "protecao-cargos-basico",
    validityDays: 30
  },
  {
    badge: "Completo sem hospedagem",
    botLimit: 1,
    color: "#8B5CF6",
    description: "Plano completo para proteção de cargos, anti-ban, selfbot protection, logs e suporte prioritario. Hospedagem não inclusa.",
    entitlements: entitlementsFor(["security.role_protection", "security.anti_ban", "security.self_bot", "discord.logs", "discord.dashboard", "support.priority"]),
    guildLimit: 1,
    icon: "shield",
    isActive: true,
    isPublic: true,
    isPurchasable: true,
    isRecommended: true,
    name: "Proteção de Cargos Completo",
    order: 80,
    priceInCents: 5000,
    shortDescription: "Proteção de cargos completa sem hospedagem.",
    slug: "protecao-cargos-completo",
    validityDays: 30
  },
  {
    badge: "Vitalicio",
    billingCycle: "lifetime",
    botLimit: 1,
    color: "#FFD500",
    description: "Licença permanente do Sistema de Streaming, com atualizacoes futuras, 1 mes de hospedagem gratis, suporte prioritario e atendimento 24 horas. Após o periodo gratuito será cobrada apenas a hospedagem, a partir de R$12,00 por mes.",
    entitlements: entitlementsFor(["streamer.twitch_alerts", "streamer.kick_alerts", "streamer.clip_automation", "streamer.giveaways", "streamer.vip", "streamer.ranking", "streamer.ai", "discord.dashboard", "discord.logs", "billing.lifetime_license", "billing.future_updates", "billing.free_hosting_30d", "support.priority", "support.24h"]),
    guildLimit: 1,
    icon: "radio",
    isActive: true,
    isPublic: true,
    isPurchasable: true,
    isRecommended: true,
    name: "Streaming Vitalicio",
    order: 90,
    priceInCents: 15000,
    shortDescription: "Licença vitalicia do módulo Streaming com 1 mes de hospedagem gratis.",
    slug: "streaming-vitalicio",
    validityDays: null
  },
  {
    badge: "Vitalicio",
    billingCycle: "lifetime",
    botLimit: 1,
    color: "#3DDC84",
    description: "Licença permanente do Sistema de Polícia RP, com atualizacoes futuras, 1 mes de hospedagem gratis, suporte prioritario e atendimento 24 horas. Após o periodo gratuito será cobrada apenas a hospedagem, a partir de R$12,00 por mes.",
    entitlements: entitlementsFor(["fivem.police", "fivem.finance", "fivem.hierarchy", "discord.logs", "discord.dashboard", "billing.lifetime_license", "billing.future_updates", "billing.free_hosting_30d", "support.priority", "support.24h"]),
    guildLimit: 1,
    icon: "building",
    isActive: true,
    isPublic: true,
    isPurchasable: true,
    isRecommended: true,
    name: "Polícia RP Vitalicio",
    order: 100,
    priceInCents: 15000,
    shortDescription: "Licença vitalicia do módulo Polícia RP com 1 mes de hospedagem gratis.",
    slug: "policia-rp-vitalicio",
    validityDays: null
  },
  {
    badge: "Vitalicio",
    billingCycle: "lifetime",
    botLimit: 1,
    color: "#FFEA70",
    description: "Licença permanente do Sistema de Facção RP, com atualizacoes futuras, 1 mes de hospedagem gratis, suporte prioritario e atendimento 24 horas. Após o periodo gratuito será cobrada apenas a hospedagem, a partir de R$12,00 por mes.",
    entitlements: entitlementsFor(["fivem.faction", "fivem.finance", "fivem.hierarchy", "discord.logs", "discord.dashboard", "billing.lifetime_license", "billing.future_updates", "billing.free_hosting_30d", "support.priority", "support.24h"]),
    guildLimit: 1,
    icon: "users",
    isActive: true,
    isPublic: true,
    isPurchasable: true,
    isRecommended: true,
    name: "Facção RP Vitalicio",
    order: 110,
    priceInCents: 15000,
    shortDescription: "Licença vitalicia do módulo Facção RP com 1 mes de hospedagem gratis.",
    slug: "faccao-rp-vitalicio",
    validityDays: null
  },
  {
    badge: "Vitalicio",
    billingCycle: "lifetime",
    botLimit: 1,
    color: "#8B5CF6",
    description: "Licença permanente do Sistema de Proteção Discord, com atualizacoes futuras, 1 mes de hospedagem gratis, suporte prioritario e atendimento 24 horas. Após o periodo gratuito será cobrada apenas a hospedagem, a partir de R$12,00 por mes.",
    entitlements: entitlementsFor(["security.role_protection", "security.anti_ban", "security.self_bot", "discord.logs", "discord.dashboard", "billing.lifetime_license", "billing.future_updates", "billing.free_hosting_30d", "support.priority", "support.24h"]),
    guildLimit: 1,
    icon: "shield",
    isActive: true,
    isPublic: true,
    isPurchasable: true,
    isRecommended: true,
    name: "Proteção Discord Vitalicio",
    order: 120,
    priceInCents: 15000,
    shortDescription: "Licença vitalicia do módulo Proteção Discord com 1 mes de hospedagem gratis.",
    slug: "protecao-discord-vitalicio",
    validityDays: null
  },
  {
    badge: "Vitalicio",
    billingCycle: "lifetime",
    botLimit: 1,
    color: "#38BDF8",
    description: "Licença permanente do Sistema Financeiro, com atualizacoes futuras, 1 mes de hospedagem gratis, suporte prioritario e atendimento 24 horas. Após o periodo gratuito será cobrada apenas a hospedagem, a partir de R$12,00 por mes.",
    entitlements: entitlementsFor(["fivem.finance", "discord.logs", "discord.dashboard", "billing.lifetime_license", "billing.future_updates", "billing.free_hosting_30d", "support.priority", "support.24h"]),
    guildLimit: 1,
    icon: "wallet",
    isActive: true,
    isPublic: true,
    isPurchasable: true,
    isRecommended: true,
    name: "Financeiro Vitalicio",
    order: 130,
    priceInCents: 15000,
    shortDescription: "Licença vitalicia do módulo Financeiro com 1 mes de hospedagem gratis.",
    slug: "financeiro-vitalicio",
    validityDays: null
  }
];

const LEGACY_PUBLIC_PLAN_SLUGS = ["streamer", "fivem", "discord-management"];
const LIFETIME_HOSTING_FREE_DAYS = 30;
const LIFETIME_HOSTING_MONTHLY_PRICE_IN_CENTS = 1200;

export async function ensurePlanSeed() {
  const { planFeatures, plans } = await getMongoCollections();
  const now = new Date();

  await Promise.all(FEATURE_SEEDS.map((feature) => planFeatures.updateOne(
    { key: feature.key },
    {
      $setOnInsert: {
        _id: randomUUID(),
        category: feature.category,
        createdAt: now,
        defaultLimit: feature.defaultLimit ?? null,
        description: feature.description ?? "",
        isActive: feature.isActive ?? true,
        isPublic: feature.isPublic ?? true,
        key: feature.key,
        name: feature.name,
        order: feature.order ?? 0,
        unit: feature.unit ?? null,
        updatedAt: now
      }
    },
    { upsert: true }
  )));

  await Promise.all(PLAN_SEEDS.map((plan) => plans.updateOne(
    { slug: slugify(plan.slug || plan.name) },
    {
      $setOnInsert: buildPlanDocument(plan, null, now)
    },
    { upsert: true }
  )));

  await plans.updateOne(
    { slug: "policia-rp-basico", "entitlements.key": "fivem.police" },
    {
      $set: {
        entitlements: entitlementsFor(["fivem.police_basic", "fivem.hierarchy", "discord.logs", "discord.dashboard"]),
        updatedAt: now
      }
    }
  );
  await plans.updateOne(
    { slug: "faccao-rp-basico", "entitlements.key": "fivem.faction" },
    {
      $set: {
        entitlements: entitlementsFor(["fivem.faction_basic", "discord.logs", "discord.dashboard"]),
        updatedAt: now
      }
    }
  );
  await plans.updateOne(
    { slug: "protecao-cargos-basico", "entitlements.key": "security.role_protection" },
    {
      $set: {
        entitlements: entitlementsFor(["security.role_protection_basic", "security.anti_ban", "discord.logs"]),
        updatedAt: now
      }
    }
  );

  await plans.updateMany(
    { slug: { $in: LEGACY_PUBLIC_PLAN_SLUGS } },
    { $set: { isPublic: false, isPurchasable: false, updatedAt: now } }
  );
  await plans.updateMany(
    { billingCycle: "lifetime" },
    { $set: { isPublic: false, isPurchasable: false, updatedAt: now } }
  );
}

export async function listPublicPlans() {
  await ensurePlanSeed();
  const { plans } = await getMongoCollections();
  const rows = await plans.find({ isActive: true, isPublic: true, billingCycle: { $ne: "lifetime" } }).sort({ order: 1, createdAt: 1 }).toArray();
  return rows.map(toPlanDto);
}

export async function getPublicPlan(slug: string) {
  await ensurePlanSeed();
  const { plans } = await getMongoCollections();
  const plan = await plans.findOne({ slug: slugify(slug), isActive: true, isPublic: true, billingCycle: { $ne: "lifetime" } });
  return plan ? toPlanDto(plan) : null;
}

export async function createPublicCheckoutInterest(
  planSlug: string,
  actor: PlanActor,
  paymentMethod: CheckoutPaymentMethod = "checkout",
  buyerInput: { cpfCnpj?: string | null } = {}
) {
  const anonymousId = `pending:${randomUUID()}`;
  return createCheckoutInterestForBuyer(planSlug, {
    cpfCnpj: normalizeCpfCnpj(buyerInput.cpfCnpj),
    discordId: anonymousId,
    email: null,
    name: null,
    userId: anonymousId
  }, actor, { checkExistingSubscription: false, paymentMethod, reusePendingOrder: false });
}

export async function createCheckoutInterest(
  planSlug: string,
  auth: DashboardAuth,
  actor: PlanActor,
  paymentMethod: CheckoutPaymentMethod = "checkout",
  buyerInput: { cpfCnpj?: string | null } = {}
) {
  return createCheckoutInterestForBuyer(planSlug, {
    cpfCnpj: normalizeCpfCnpj(buyerInput.cpfCnpj),
    discordId: auth.user.discordId,
    email: auth.user.email ?? null,
    name: auth.user.globalName || auth.user.username || null,
    userId: auth.user.id || auth.user.discordId
  }, actor, { checkExistingSubscription: true, paymentMethod, reusePendingOrder: true });
}

async function createCheckoutInterestForBuyer(
  planSlug: string,
  buyer: CheckoutBuyer,
  actor: PlanActor,
  options: { checkExistingSubscription: boolean; paymentMethod: CheckoutPaymentMethod; reusePendingOrder: boolean }
) {
  await ensurePlanSeed();
  const { paymentOrders, plans, planSubscriptions } = await getMongoCollections();
  const plan = await plans.findOne({
    $or: [{ _id: planSlug }, { slug: slugify(planSlug) }],
    isActive: true,
    isPublic: true
  });

  if (!plan) {
    throw httpError("Plano não encontrado.", 404);
  }

  const activeGateway = resolvePaymentGatewayForCheckoutMethod(options.paymentMethod);
  const selectedProvider = activeGateway.provider;
  const paymentsEnabled = activeGateway.enabled;
  const now = new Date();
  const amountInCents = plan.promotionalPriceInCents ?? plan.priceInCents;
  const shouldCreateCheckout = plan.isPurchasable && amountInCents > 0;
  const existingActiveSubscription = options.checkExistingSubscription
    ? await planSubscriptions.findOne({
      discordId: buyer.discordId,
      planId: plan._id,
      status: "active"
    })
    : null;

  if (existingActiveSubscription) {
    throw httpError("Você já possui uma assinatura ativa para este plano.", 409);
  }

  if (shouldCreateCheckout && !paymentsEnabled) {
    throw httpError("Pagamento temporariamente indisponível.", 503);
  }

  const checkoutExpiresAt = shouldCreateCheckout
    ? new Date(now.getTime() + activeGateway.checkoutExpirationMinutes * 60_000)
    : null;
  const reusableMethodQuery = options.paymentMethod === "pix"
    ? { paymentMethod: "pix", $or: [{ pixCode: { $ne: null } }, { checkoutUrl: { $ne: null } }] }
    : { checkoutUrl: { $ne: null }, paymentMethod: { $in: ["card", "credit_card", "debit_card"] } };
  const reusableOrder = options.reusePendingOrder && paymentsEnabled && shouldCreateCheckout
    ? await paymentOrders.findOne({
      amountInCents,
      currency: plan.currency,
      discordId: buyer.discordId,
      environment: activeGateway.environment,
      expiresAt: { $gt: now },
      planId: plan._id,
      provider: selectedProvider,
      status: { $in: ["created", "checkout_pending", "pending", "in_process", "in_review"] },
      ...reusableMethodQuery
    })
    : null;

  if (reusableOrder) {
    await writePlanAudit({
      ...actor,
      id: buyer.discordId,
      name: buyer.name
    }, "checkout_reused_pending_order", "payment", reusableOrder._id, {
      planSlug: plan.slug,
      provider: reusableOrder.provider,
      status: reusableOrder.status
    });

    return {
      order: sanitizePaymentOrderForUser(reusableOrder),
      payment: {
        enabled: true,
        message: "Pedido pendente reutilizado. Continue pelo link de checkout.",
        provider: reusableOrder.provider
      },
      plan: toPlanDto(plan)
    };
  }

  const idempotencyKey = randomUUID();
  const order: MongoPaymentOrder = {
    _id: randomUUID(),
    accessActivated: false,
    accessActivatedAt: null,
    amountInCents,
    approvedAt: null,
    cancelledAt: null,
    checkoutUrl: null,
    contractHolderSnapshot: {
      discordAvatar: null,
      discordDisplayName: buyer.name,
      discordUserId: buyer.discordId,
      discordUsername: buyer.name,
      email: buyer.email
    },
    contractId: null,
    contractIntent: "new_contract",
    billingContactUserId: buyer.discordId,
    createdAt: now,
    currency: plan.currency,
    discordId: buyer.discordId,
    environment: activeGateway.environment,
    expiresAt: checkoutExpiresAt,
    externalReference: null,
    idempotencyKey,
    merchantOrderId: null,
    mercadoPagoPaymentId: null,
    notes: paymentsEnabled
      ? "Pedido registrado. Provedor de pagamento pendente de integração."
      : "Interesse registrado. Pagamentos estao desativados e nenhum QR Code/cobranca foi gerado.",
    paidAt: null,
    paymentMethod: null,
    paymentType: null,
    pixCode: null,
    pixCopyPaste: null,
    pixExpiresAt: checkoutExpiresAt,
    pixQrCode: null,
    planId: plan._id,
    planSnapshot: snapshotPlan(plan),
    planSlug: plan.slug,
    provider: paymentsEnabled ? selectedProvider : "disabled",
    providerOrderId: null,
    qrCode: null,
    rawProviderStatus: null,
    refundedAt: null,
    rejectedAt: null,
    retryAttempts: 0,
    sandboxCheckoutUrl: null,
    statusDetail: null,
    status: paymentsEnabled && shouldCreateCheckout ? "created" : "interest_registered",
    statusHistory: [{
      at: now,
      from: null,
      source: "checkout_create",
      status: paymentsEnabled && shouldCreateCheckout ? "created" : "interest_registered"
    }],
    updatedAt: now,
    userId: buyer.userId
  };
  order.externalReference = order._id;

  await paymentOrders.insertOne(order);
  await ensureContractForPaymentOrder(order, plan, "checkout_create");

  if (paymentsEnabled && shouldCreateCheckout) {
    const checkout = await createPlanPayment(plan, order, buyer, options.paymentMethod).catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : `Falha ao criar ${options.paymentMethod === "pix" ? "Pix" : "checkout"} ${selectedProvider}.`;
      console.error("[payments] checkout creation failed", {
        amountInCents: order.amountInCents,
        currency: order.currency,
        environment: order.environment,
        error: cleanLogString(message),
        orderId: order._id,
        paymentMethod: options.paymentMethod,
        planId: plan._id,
        planSlug: plan.slug,
        provider: order.provider,
        timestamp: new Date().toISOString()
      });
      order.notes = `Falha ao criar checkout ${selectedProvider}.`;
      order.status = "error";
      order.statusHistory = appendStatusHistory({ ...order, status: "created" }, "error", `${selectedProvider}_checkout_failed`);
      order.updatedAt = new Date();
      await paymentOrders.updateOne(
        { _id: order._id },
        {
          $set: {
            notes: order.notes,
            status: order.status,
            statusHistory: order.statusHistory,
            updatedAt: order.updatedAt
          }
        }
      );
      await writePlanAudit(systemPaymentActor(), "payment_checkout_failed", "payment", order._id, {
        error: cleanLogString(message),
        planSlug: plan.slug,
        provider: selectedProvider
      });
      const publicMessage = "statusCode" in Object(error)
        ? message
        : "Não foi possível iniciar o pagamento. Tente novamente em alguns instantes.";
      throw httpError(publicMessage, 503);
    });
    order.checkoutUrl = checkout.checkoutUrl;
    order.notes = checkout.notes;
    order.paymentMethod = checkout.paymentMethod;
    order.paymentType = checkout.paymentType;
    order.pixCode = checkout.pixCode;
    order.pixCopyPaste = checkout.pixCode;
    order.pixExpiresAt = parseProviderPixExpiresAt(checkout.pixExpiresAt, order.pixExpiresAt);
    order.pixQrCode = checkout.qrCode;
    order.providerOrderId = checkout.providerOrderId;
    order.qrCode = checkout.qrCode;
    order.rawProviderStatus = checkout.rawProviderStatus;
    order.sandboxCheckoutUrl = checkout.sandboxCheckoutUrl;
    order.statusDetail = checkout.statusDetail;
    order.mercadoPagoPaymentId = checkout.mercadoPagoPaymentId;
    order.webhookSafeResponse = null;
    order.statusHistory = appendStatusHistory(order, "pending", checkout.statusSource);
    order.status = "pending";
    order.updatedAt = new Date();
    await paymentOrders.updateOne(
      { _id: order._id },
      {
        $set: {
          checkoutUrl: order.checkoutUrl,
          notes: order.notes,
          paymentMethod: order.paymentMethod,
          paymentType: order.paymentType,
          mercadoPagoPaymentId: order.mercadoPagoPaymentId,
          pixCode: order.pixCode,
          pixCopyPaste: order.pixCopyPaste,
          pixExpiresAt: order.pixExpiresAt,
          pixQrCode: order.pixQrCode,
          providerOrderId: order.providerOrderId,
          qrCode: order.qrCode,
          rawProviderStatus: order.rawProviderStatus,
          sandboxCheckoutUrl: order.sandboxCheckoutUrl,
          statusDetail: order.statusDetail,
          status: order.status,
          statusHistory: order.statusHistory,
          webhookSafeResponse: order.webhookSafeResponse,
          updatedAt: order.updatedAt
        }
      }
    );
  }

  await writePlanAudit({
    ...actor,
    id: buyer.discordId,
    name: buyer.name
  }, "checkout_interest", "payment", order._id, {
    planSlug: plan.slug,
    provider: order.provider,
    status: order.status
  });

  return {
    order: sanitizePaymentOrderForUser(order),
    payment: {
      enabled: paymentsEnabled && plan.isPurchasable,
      message: order.notes,
      provider: order.provider
    },
    plan: toPlanDto(plan)
  };
}

export async function getCustomerPlansDashboard(auth: DashboardAuth) {
  await ensurePlanSeed();
  const { botCredentials, paymentOrders, planSubscriptions, planWorkspaces, workspaceMembers } = await getMongoCollections();
  const discordId = auth.user.discordId;
  const [plans, subscriptions, memberRows, orders] = await Promise.all([
    listPublicPlans(),
    planSubscriptions.find({ discordId }).sort({ updatedAt: -1 }).toArray(),
    workspaceMembers.find({ discordId }).toArray(),
    paymentOrders.find({ discordId }).sort({ createdAt: -1 }).limit(30).toArray()
  ]);
  const memberWorkspaceIds = memberRows.map((member) => member.workspaceId);
  const workspaceQuery = memberWorkspaceIds.length > 0
    ? { $or: [{ ownerDiscordId: discordId }, { _id: { $in: memberWorkspaceIds } }] }
    : { ownerDiscordId: discordId };
  const workspaces = await planWorkspaces.find(workspaceQuery).sort({ updatedAt: -1 }).toArray();
  const workspaceIds = workspaces.map((workspace) => workspace._id);
  const bots = workspaceIds.length > 0
    ? await botCredentials.find({ workspaceId: { $in: workspaceIds }, status: { $ne: "disabled" } }).sort({ createdAt: -1 }).toArray()
    : [];
  const planRows = await getPlanRows();
  const workspaceRowsById = new Map(workspaces.map((workspace) => [workspace._id, workspace]));
  const planRowsById = new Map(planRows.map((plan) => [plan._id, plan]));

  return {
    orders: orders.map(sanitizePaymentOrderForUser),
    paymentSettings: toPaymentSettingsDto(await ensurePaymentSettings()),
    plans,
    subscriptions: subscriptions.map((subscription) => toSubscriptionDto(
      subscription,
      planRowsById.get(subscription.planId) ?? null,
      subscription.workspaceId ? workspaceRowsById.get(subscription.workspaceId) ?? null : null
    )),
    workspaces: workspaces.map((workspace) => toWorkspaceDto(workspace, bots.filter((bot) => bot.workspaceId === workspace._id)))
  };
}

export async function getCustomerPaymentOrder(orderId: string, auth: DashboardAuth) {
  const { paymentOrders, plans, planSubscriptions, planWorkspaces } = await getMongoCollections();
  const foundOrder = await paymentOrders.findOne({ _id: orderId, discordId: auth.user.discordId });
  if (!foundOrder) throw httpError("Pedido não encontrado.", 404);
  const order = await expirePaymentOrderIfNeeded(foundOrder, "customer_payment_status_expired");

  const [plan, subscription] = await Promise.all([
    plans.findOne({ _id: order.planId }),
    planSubscriptions.findOne({ "metadata.paymentOrderId": order._id } as Partial<MongoPlanSubscription>)
  ]);
  const workspace = subscription?.workspaceId ? await planWorkspaces.findOne({ _id: subscription.workspaceId }) : null;

  return {
    order: toPaymentOrderDto(order),
    plan: plan ? toPlanDto(plan) : null,
    subscription: subscription ? toSubscriptionDto(subscription, plan, workspace) : null
  };
}

export async function getPublicPaymentOrderStatus(orderId: string) {
  const { paymentOrders, planSubscriptions, planWorkspaces, plans } = await getMongoCollections();
  const foundOrder = await paymentOrders.findOne({ _id: orderId });
  if (!foundOrder) throw httpError("Pedido não encontrado.", 404);
  const order = await expirePaymentOrderIfNeeded(foundOrder, "public_payment_status_expired");
  const [plan, subscription] = await Promise.all([
    plans.findOne({ _id: order.planId }),
    planSubscriptions.findOne({ "metadata.paymentOrderId": order._id } as Partial<MongoPlanSubscription>)
  ]);
  const workspace = subscription?.workspaceId ? await planWorkspaces.findOne({ _id: subscription.workspaceId }) : null;

  return {
    order: sanitizePaymentOrderForUser(order),
    plan: plan ? toPlanDto(plan) : null,
    subscription: subscription ? toSubscriptionDto(subscription, plan, workspace) : null
  };
}

export async function getPaymentOrderStatus(orderId: string, auth: DashboardAuth) {
  const { paymentOrders, planSubscriptions, planWorkspaces, plans } = await getMongoCollections();
  const foundOrder = await paymentOrders.findOne({ _id: orderId, discordId: auth.user.discordId });
  if (!foundOrder) throw httpError("Pedido não encontrado.", 404);
  const order = await expirePaymentOrderIfNeeded(foundOrder, "authenticated_payment_status_expired");
  const [plan, subscription] = await Promise.all([
    plans.findOne({ _id: order.planId }),
    planSubscriptions.findOne({ "metadata.paymentOrderId": order._id } as Partial<MongoPlanSubscription>)
  ]);
  const workspace = subscription?.workspaceId ? await planWorkspaces.findOne({ _id: subscription.workspaceId }) : null;

  return {
    order: sanitizePaymentOrderForUser(order),
    plan: plan ? toPlanDto(plan) : null,
    subscription: subscription ? toSubscriptionDto(subscription, plan, workspace) : null
  };
}

export async function listMyPaymentOrders(auth: DashboardAuth) {
  const { paymentOrders } = await getMongoCollections();
  const orders = await paymentOrders.find({ discordId: auth.user.discordId }).sort({ createdAt: -1 }).limit(50).toArray();
  return {
    health: getPaymentGatewayHealth(),
    orders: orders.map(sanitizePaymentOrderForUser)
  };
}

export async function retryPaymentOrder(orderId: string, auth: DashboardAuth, actor: PlanActor) {
  const { paymentOrders, plans } = await getMongoCollections();
  const order = await paymentOrders.findOne({ _id: orderId, discordId: auth.user.discordId });
  if (!order) throw httpError("Pedido não encontrado.", 404);
  if (isFinalPaymentStatus(order.status) && order.status !== "expired") throw httpError("Pedido finalizado não pode ser reenviado ao checkout.", 409);
  if ((order.retryAttempts ?? 0) >= 3) throw httpError("Limite de tentativas deste pedido atingido.", 429);
  if (order.expiresAt && order.expiresAt > new Date() && (order.checkoutUrl || order.pixCode || order.providerOrderId)) {
    throw httpError("Checkout atual ainda está válido.", 409);
  }

  const plan = await plans.findOne({ _id: order.planId });
  if (!plan) throw httpError("Plano do pedido não encontrado.", 404);

  const now = new Date();
  const retryPaymentMethod = order.pixCode || order.paymentMethod === "pix" || order.provider === "asaas" ? "pix" : "checkout";
  const activeGateway = resolvePaymentGatewayForCheckoutMethod(retryPaymentMethod);
  const retryOrder: MongoPaymentOrder = {
    ...order,
    checkoutUrl: null,
    environment: activeGateway.environment,
    expiresAt: new Date(now.getTime() + activeGateway.checkoutExpirationMinutes * 60_000),
    idempotencyKey: randomUUID(),
    pixCode: null,
    providerOrderId: null,
    qrCode: null,
    retryAttempts: (order.retryAttempts ?? 0) + 1,
    status: "created",
    updatedAt: now
  };
  retryOrder.provider = activeGateway.provider;
  const checkout = await createPlanPayment(plan, retryOrder, {
    discordId: auth.user.discordId,
    email: auth.user.email ?? null,
    name: auth.user.globalName || auth.user.username || null,
    userId: auth.user.id || auth.user.discordId
  }, retryPaymentMethod);
  const statusHistory = appendStatusHistory(retryOrder, "pending", `retry_${checkout.statusSource}`);
  const updated = await paymentOrders.findOneAndUpdate(
    { _id: order._id, discordId: auth.user.discordId },
    {
      $set: {
        checkoutUrl: checkout.checkoutUrl,
        environment: retryOrder.environment,
        expiresAt: retryOrder.expiresAt,
        idempotencyKey: retryOrder.idempotencyKey,
        mercadoPagoPaymentId: checkout.mercadoPagoPaymentId,
        notes: checkout.notes,
        paymentMethod: checkout.paymentMethod,
        paymentType: checkout.paymentType,
        pixCode: checkout.pixCode,
        pixExpiresAt: parseProviderPixExpiresAt(checkout.pixExpiresAt, retryOrder.expiresAt),
        provider: retryOrder.provider,
        providerOrderId: checkout.providerOrderId,
        qrCode: checkout.qrCode,
        rawProviderStatus: checkout.rawProviderStatus,
        retryAttempts: retryOrder.retryAttempts,
        sandboxCheckoutUrl: checkout.sandboxCheckoutUrl,
        status: "pending",
        statusDetail: checkout.statusDetail,
        statusHistory,
        webhookSafeResponse: null,
        updatedAt: new Date()
      }
    },
    { returnDocument: "after" }
  );
  await writePlanAudit(actor, "payment_checkout_retried", "payment", order._id, {
    retryAttempts: retryOrder.retryAttempts
  });
  return {
    order: sanitizePaymentOrderForUser(updated ?? retryOrder)
  };
}

export async function retryPublicPaymentOrder(orderId: string, actor: PlanActor) {
  const { paymentOrders, plans } = await getMongoCollections();
  const order = await paymentOrders.findOne({ _id: orderId });
  if (!order) throw httpError("Pedido não encontrado.", 404);
  if (!isPendingPaymentDiscordId(order.discordId)) {
    throw httpError("Este pedido já está vinculado a uma conta Discord.", 409);
  }
  if (isFinalPaymentStatus(order.status) && order.status !== "expired") throw httpError("Pedido finalizado não pode ser reenviado ao checkout.", 409);
  if ((order.retryAttempts ?? 0) >= 3) throw httpError("Limite de tentativas deste pedido atingido.", 429);
  if (order.expiresAt && order.expiresAt > new Date() && (order.checkoutUrl || order.pixCode || order.providerOrderId)) {
    throw httpError("Checkout atual ainda está válido.", 409);
  }

  const plan = await plans.findOne({ _id: order.planId });
  if (!plan) throw httpError("Plano do pedido não encontrado.", 404);

  const now = new Date();
  const retryPaymentMethod = order.pixCode || order.paymentMethod === "pix" || order.provider === "asaas" ? "pix" : "checkout";
  const activeGateway = resolvePaymentGatewayForCheckoutMethod(retryPaymentMethod);
  const retryOrder: MongoPaymentOrder = {
    ...order,
    checkoutUrl: null,
    environment: activeGateway.environment,
    expiresAt: new Date(now.getTime() + activeGateway.checkoutExpirationMinutes * 60_000),
    idempotencyKey: randomUUID(),
    pixCode: null,
    providerOrderId: null,
    qrCode: null,
    retryAttempts: (order.retryAttempts ?? 0) + 1,
    status: "created",
    updatedAt: now
  };
  retryOrder.provider = activeGateway.provider;
  const checkout = await createPlanPayment(plan, retryOrder, {
    discordId: order.discordId,
    email: null,
    name: null,
    userId: order.userId
  }, retryPaymentMethod);
  const statusHistory = appendStatusHistory(retryOrder, "pending", `public_retry_${checkout.statusSource}`);
  const updated = await paymentOrders.findOneAndUpdate(
    { _id: order._id, discordId: order.discordId },
    {
      $set: {
        checkoutUrl: checkout.checkoutUrl,
        environment: retryOrder.environment,
        expiresAt: retryOrder.expiresAt,
        idempotencyKey: retryOrder.idempotencyKey,
        mercadoPagoPaymentId: checkout.mercadoPagoPaymentId,
        notes: checkout.notes,
        paymentMethod: checkout.paymentMethod,
        paymentType: checkout.paymentType,
        pixCode: checkout.pixCode,
        pixExpiresAt: parseProviderPixExpiresAt(checkout.pixExpiresAt, retryOrder.expiresAt),
        provider: retryOrder.provider,
        providerOrderId: checkout.providerOrderId,
        qrCode: checkout.qrCode,
        rawProviderStatus: checkout.rawProviderStatus,
        retryAttempts: retryOrder.retryAttempts,
        sandboxCheckoutUrl: checkout.sandboxCheckoutUrl,
        status: "pending",
        statusDetail: checkout.statusDetail,
        statusHistory,
        webhookSafeResponse: null,
        updatedAt: new Date()
      }
    },
    { returnDocument: "after" }
  );
  await writePlanAudit(actor, "payment_checkout_retried", "payment", order._id, {
    retryAttempts: retryOrder.retryAttempts
  });
  return {
    order: sanitizePaymentOrderForUser(updated ?? retryOrder)
  };
}

export async function listAdminPaymentOrders() {
  const { paymentOrders, plans } = await getMongoCollections();
  const [orders, planRows] = await Promise.all([
    paymentOrders.find({}).sort({ createdAt: -1 }).limit(250).toArray(),
    plans.find({}).toArray()
  ]);
  const plansById = new Map(planRows.map((plan) => [plan._id, plan]));
  return {
    health: getPaymentGatewayHealth(),
    orders: orders.map((order) => ({
      ...toPaymentOrderDto(order),
      plan: plansById.get(order.planId) ? {
        id: order.planId,
        name: plansById.get(order.planId)?.name ?? order.planSlug,
        slug: plansById.get(order.planId)?.slug ?? order.planSlug
      } : null
    }))
  };
}

export async function getAdminPaymentOrder(orderId: string) {
  const { paymentOrders, plans } = await getMongoCollections();
  const order = await paymentOrders.findOne({ _id: orderId });
  if (!order) throw httpError("Pedido não encontrado.", 404);
  const plan = await plans.findOne({ _id: order.planId });
  return {
    order: toPaymentOrderDto(order),
    plan: plan ? toPlanDto(plan) : null
  };
}

export async function reconcilePaymentOrder(orderId: string, actor: PlanActor) {
  const { paymentOrders, plans } = await getMongoCollections();
  const order = await paymentOrders.findOne({ _id: orderId });
  if (!order) throw httpError("Pedido não encontrado.", 404);
  const plan = await plans.findOne({ _id: order.planId });
  if (!plan) throw httpError("Plano do pedido não encontrado.", 404);

  if (order.provider === "pagbank" && order.providerOrderId) {
    const activeGateway = await resolveActivePaymentManager({ allowDisabled: true, provider: "pagbank" });
    const provider = (activeGateway as { manager: PaymentManager }).manager.getProvider();
    const providerOrder = await provider.getOrder(order.providerOrderId);
    const updatedOrder = await applyOfficialProviderOrderToOrder(order, providerOrder, "pagbank_admin_reconcile");
    await writePlanAudit(actor, "payment_reconciled", "payment", order._id, {
      provider: "pagbank",
      providerOrderId: order.providerOrderId,
      status: updatedOrder.status
    });
    return { order: toPaymentOrderDto(updatedOrder), reconciled: true };
  }

  if (order.provider === "stripe" && order.providerOrderId) {
    const stripeConfig = requireStripeOperational({ allowDisabled: true });
    const payment = await getStripeCheckoutSession(stripeConfig, order.providerOrderId);
    const updatedOrder = await applyStripePaymentToOrder(order, payment, "stripe_admin_reconcile");
    if (updatedOrder.status === "approved") {
      await activatePaidOrderOnce(updatedOrder, plan, actor, "stripe_admin_reconcile");
    }
    await writePlanAudit(actor, "payment_reconciled", "payment", order._id, {
      provider: "stripe",
      providerOrderId: order.providerOrderId,
      status: updatedOrder.status
    });
    return { order: toPaymentOrderDto(updatedOrder), reconciled: true };
  }

  if (order.provider === "asaas" && order.providerOrderId) {
    const asaasConfig = requireAsaasOperational({ allowDisabled: true });
    const service = new AsaasPaymentService(asaasConfig);
    const payment = await service.getPayment(order.providerOrderId);
    const updatedOrder = await applyAsaasPaymentToOrder(order, payment, "asaas_admin_reconcile");
    if (updatedOrder.status === "approved") {
      await activatePaidOrderOnce(updatedOrder, plan, actor, "asaas_admin_reconcile");
    }
    await writePlanAudit(actor, "payment_reconciled", "payment", order._id, {
      provider: "asaas",
      providerOrderId: order.providerOrderId,
      status: updatedOrder.status
    });
    return { order: toPaymentOrderDto(updatedOrder), reconciled: true };
  }

  if (!order.mercadoPagoPaymentId) {
    if (order.expiresAt && order.expiresAt <= new Date() && !isFinalPaymentStatus(order.status)) {
      const updated = await paymentOrders.findOneAndUpdate(
        { _id: order._id },
        {
          $set: {
            notes: "Checkout expirado sem pagamento vinculado.",
            status: "expired",
            statusHistory: appendStatusHistory(order, "expired", "mercadopago_reconcile_expired"),
            updatedAt: new Date()
          }
        },
        { returnDocument: "after" }
      );
      return { order: toPaymentOrderDto(updated ?? order), reconciled: true };
    }
    return { order: toPaymentOrderDto(order), reconciled: false };
  }

  const mercadoPagoConfig = requireMercadoPagoOperational({ allowDisabled: true });
  const provider = new MercadoPagoPaymentProvider(requireMercadoPagoAccessToken(mercadoPagoConfig), mercadoPagoConfig.webhookSecret);
  const payment = await provider.getPayment(order.mercadoPagoPaymentId);
  const updatedOrder = await applyOfficialPaymentToOrder(order, plan, payment, actor, "mercadopago_admin_reconcile");
  await writePlanAudit(actor, "payment_reconciled", "payment", order._id, {
    mercadoPagoPaymentId: order.mercadoPagoPaymentId,
    status: updatedOrder.status
  });
  return { order: toPaymentOrderDto(updatedOrder), reconciled: true };
}

export async function getWorkspaceDashboard(workspaceId: string, auth: DashboardAuth) {
  const access = await assertWorkspaceAccess(workspaceId, auth);
  const { botCredentials, planSubscriptions, plans } = await getMongoCollections();
  const [subscription, plan, bots] = await Promise.all([
    planSubscriptions.findOne({ _id: access.workspace.subscriptionId }),
    plans.findOne({ _id: access.workspace.planId }),
    botCredentials.find({ workspaceId, status: { $ne: "disabled" } }).sort({ createdAt: -1 }).toArray()
  ]);

  return {
    bots: bots.map(toBotCredentialDto),
    plan: plan ? toPlanDto(plan) : null,
    subscription: subscription ? toSubscriptionDto(subscription, plan ?? null, access.workspace) : null,
    workspace: toWorkspaceDto(access.workspace, bots)
  };
}

export async function createWorkspaceBotCredential(workspaceId: string, input: BotCredentialInput, auth: DashboardAuth, actor: PlanActor) {
  const access = await assertWorkspaceAccess(workspaceId, auth);
  const { botCredentials, planSubscriptions, plans, planWorkspaces } = await getMongoCollections();
  const [subscription, plan] = await Promise.all([
    planSubscriptions.findOne({ _id: access.workspace.subscriptionId }),
    plans.findOne({ _id: access.workspace.planId })
  ]);

  if (access.workspace.status !== "active" || subscription?.status !== "active") {
    throw httpError("Workspace sem assinatura ativa.", 403);
  }

  const botLimit = subscription.botLimit || plan?.botLimit || 0;
  const activeBotCount = await botCredentials.countDocuments({ workspaceId, status: { $ne: "disabled" } });

  if (activeBotCount >= botLimit) {
    throw httpError("Limite de bots do plano atingido.", 409);
  }

  const now = new Date();
  const protectedToken = encryptBotToken(input.token);
  const credential: MongoBotCredential = {
    _id: randomUUID(),
    authTag: protectedToken.authTag,
    botClientId: input.botClientId,
    botName: trimText(input.botName, 80) || "Bot Nex Tech",
    createdAt: now,
    encryptedDataKey: protectedToken.encryptedDataKey,
    iv: protectedToken.iv,
    keyVersion: protectedToken.keyVersion,
    lastError: null,
    lastValidatedAt: null,
    ownerUserId: auth.user.discordId,
    status: "stored",
    tokenCiphertext: protectedToken.tokenCiphertext,
    tokenFingerprint: protectedToken.tokenFingerprint,
    updatedAt: now,
    workspaceId
  };

  await botCredentials.insertOne(credential);
  await planWorkspaces.updateOne({ _id: workspaceId }, { $addToSet: { botIds: credential._id }, $set: { updatedAt: now } });
  await writePlanAudit(actor, "bot_credential_created", "bot_credential", credential._id, {
    botClientId: input.botClientId,
    workspaceId
  });

  return toBotCredentialDto(credential);
}

async function claimApprovedPaymentOrder(orderId: string, auth: DashboardAuth, actor: PlanActor) {
  const { paymentOrders, plans } = await getMongoCollections();
  const order = await paymentOrders.findOne({ _id: orderId });
  if (!order) throw httpError("Pedido aprovado não encontrado.", 404);
  if (order.status !== "approved" && order.status !== "paid") {
    throw httpError("Este pedido ainda não foi aprovado pelo gateway de pagamento.", 409);
  }
  if (!isPendingPaymentDiscordId(order.discordId) && order.discordId !== auth.user.discordId) {
    throw httpError("Este pedido já está vinculado a outra conta Discord.", 409);
  }

  const plan = await plans.findOne({ _id: order.planId });
  if (!plan) throw httpError("Plano do pedido não encontrado.", 404);

  const now = new Date();
  const linkedOrder = isPendingPaymentDiscordId(order.discordId)
    ? await paymentOrders.findOneAndUpdate(
      { _id: order._id, discordId: order.discordId },
      {
        $set: {
          discordId: auth.user.discordId,
          notes: order.notes ?? "Pagamento aprovado vinculado a conta Discord.",
          updatedAt: now,
          userId: auth.user.id || auth.user.discordId
        }
      },
      { returnDocument: "after" }
    )
    : order;

  const orderToActivate = linkedOrder ?? {
    ...order,
    discordId: auth.user.discordId,
    updatedAt: now,
    userId: auth.user.id || auth.user.discordId
  };
  const subscription = await activatePaidOrderOnce(orderToActivate, plan, {
    ...actor,
    id: auth.user.discordId,
    name: auth.user.globalName || auth.user.username || null
  }, "discord_connection_after_payment");

  await writePlanAudit({
    ...actor,
    id: auth.user.discordId,
    name: auth.user.globalName || auth.user.username || null
  }, "payment_claimed_after_discord_login", "payment", order._id, {
    planSlug: plan.slug,
    subscriptionId: subscription?.id ?? null
  });
}

export async function getBotRegistrationStatus(auth: DashboardAuth, approvedOrderId?: string | null) {
  if (approvedOrderId) {
    await claimApprovedPaymentOrder(approvedOrderId, auth, systemPaymentActor());
  }

  const dashboard = await getCustomerPlansDashboard(auth);
  const activeSubscriptions = dashboard.subscriptions.filter((subscription) => subscription.status === "active");
  const availableWorkspace = dashboard.workspaces.find((workspace) => {
    const subscription = activeSubscriptions.find((item) => item.workspaceId === workspace.id);
    return Boolean(subscription && workspace.status === "active" && workspace.botCount < subscription.botLimit);
  }) ?? null;

  return {
    activeSubscription: activeSubscriptions[0] ?? null,
    canRegister: Boolean(availableWorkspace),
    dashboardBaseUrl: (await ensurePaymentSettings()).botDashboardBaseUrl ?? buildAppUrl("/dashboard/"),
    message: availableWorkspace ? null : activeSubscriptions.length ? "Limite de bots atingido para a assinatura ativa." : "Nenhum plano aprovado foi encontrado para sua conta.",
    workspace: availableWorkspace
  };
}

export async function registerCustomerBot(input: BotRegistrationInput, auth: DashboardAuth, actor: PlanActor, discordAccessToken?: string | null) {
  const status = await getBotRegistrationStatus(auth);
  if (!status.workspace) {
    throw httpError(status.message ?? "Nenhuma vaga disponível para cadastrar bot.", 403);
  }
  if (!discordAccessToken) {
    throw httpError("Autenticacao recente do Discord necessaria para cadastrar o bot.", 401);
  }

  const workspaceId = status.workspace.id;
  const access = await assertWorkspaceAccess(workspaceId, auth);
  const { botCredentials, botGuildConfigs, devBots, guilds, planSubscriptions, plans, planWorkspaces } = await getMongoCollections();
  const [subscription, plan] = await Promise.all([
    planSubscriptions.findOne({ _id: access.workspace.subscriptionId }),
    plans.findOne({ _id: access.workspace.planId })
  ]);

  if (!subscription || subscription.status !== "active" || access.workspace.status !== "active") {
    throw httpError("Assinatura ativa necessaria para cadastrar bot.", 403);
  }

  const detected = await verifyDiscordBotRegistration(input.token, input.guildId, discordAccessToken, auth.user.discordId);
  const duplicateBot = await botCredentials.findOne({ botClientId: detected.bot.id, status: { $ne: "disabled" } });
  if (duplicateBot) throw httpError("Este bot já está cadastrado.", 409);
  const duplicateGuild = await botCredentials.findOne({ guildId: detected.guild.id, status: { $ne: "disabled" } });
  if (duplicateGuild) throw httpError("Este servidor já está associado a outro cliente.", 409);

  const now = new Date();
  const slug = await uniqueBotDashboardSlug(input.slug || detected.bot.username);
  const protectedToken = encryptBotToken(input.token);
  const snapshot = subscription.metadata?.planSnapshot;
  const snapshotEntitlements = isRecord(snapshot) && Array.isArray(snapshot.entitlements)
    ? snapshot.entitlements as MongoPlanEntitlement[]
    : [];
  const enabledModules = moduleIdsFromPlanEntitlementKeys(
    (plan?.entitlements ?? snapshotEntitlements)
      .filter((item) => item.enabled)
      .map((item) => item.key)
  );
  const credential: MongoBotCredential = {
    _id: randomUUID(),
    authTag: protectedToken.authTag,
    avatarUrl: detected.bot.avatarUrl,
    botClientId: detected.bot.id,
    botName: trimText(detected.bot.username, 80) || `Bot ${detected.bot.id}`,
    createdAt: now,
    encryptedDataKey: protectedToken.encryptedDataKey,
    guildIconUrl: detected.guild.iconUrl,
    guildId: detected.guild.id,
    guildName: detected.guild.name,
    iv: protectedToken.iv,
    keyVersion: protectedToken.keyVersion,
    lastError: null,
    lastValidatedAt: now,
    ownerUserId: auth.user.discordId,
    primaryAdminDiscordId: auth.user.discordId,
    slug,
    status: "validated",
    tokenCiphertext: protectedToken.tokenCiphertext,
    tokenFingerprint: protectedToken.tokenFingerprint,
    updatedAt: now,
    workspaceId
  };

  const devBot = {
    _id: credential._id,
    avatarUrl: detected.bot.avatarUrl,
    botCreatedAt: null,
    clientId: detected.bot.id,
    createdAt: now,
    createdBy: auth.user.discordId,
    databaseName: `bot_${detected.bot.id}`,
    desiredOnline: true,
    enabledModules,
    mainGuildIconUrl: detected.guild.iconUrl,
    mainGuildId: detected.guild.id,
    mainGuildMemberCount: detected.guild.memberCount,
    mainGuildName: detected.guild.name,
    name: credential.botName,
    ownerId: auth.user.discordId,
    ownerName: auth.user.globalName || auth.user.username,
    secretEncrypted: null,
    slug,
    status: "offline" as const,
    statusMessage: "Token validado. Aguardando inicializacao.",
    tokenEncrypted: encryptSecret(input.token),
    tokenLast4: tokenLast4(input.token),
    tokenPrefix: tokenPrefix(input.token),
    updatedAt: now
  };

  await botCredentials.insertOne(credential);
  await devBots.insertOne(devBot);
  await Promise.all([
    planWorkspaces.updateOne({ _id: workspaceId }, { $addToSet: { botIds: credential._id, guildIds: detected.guild.id }, $set: { updatedAt: now } }),
    guilds.updateOne(
      { _id: detected.guild.id },
      {
        $set: { botEnabled: true, icon: detected.guild.iconHash, name: detected.guild.name, ownerId: detected.guild.ownerId, updatedAt: now },
        $setOnInsert: { _id: detected.guild.id, createdAt: now }
      },
      { upsert: true }
    ),
    botGuildConfigs.updateOne(
      { botId: credential._id, guildId: detected.guild.id },
      {
        $set: { guildName: detected.guild.name, updatedAt: now },
        $setOnInsert: { _id: randomUUID(), botId: credential._id, createdAt: now, guildId: detected.guild.id, modules: {} }
      },
      { upsert: true }
    )
  ]);
  await writePlanAudit(actor, "bot_registered_by_customer", "bot_credential", credential._id, {
    botClientId: detected.bot.id,
    dashboardUrl: dashboardUrlForSlug(slug),
    guildId: detected.guild.id,
    workspaceId
  });

  return {
    bot: toBotCredentialDto(credential),
    dashboardUrl: dashboardUrlForSlug(slug),
    server: {
      iconUrl: detected.guild.iconUrl,
      id: detected.guild.id,
      name: detected.guild.name
    }
  };
}

export async function updateWorkspaceBotCredentialToken(workspaceId: string, credentialId: string, token: string, auth: DashboardAuth, actor: PlanActor) {
  await assertWorkspaceAccess(workspaceId, auth);
  const { botCredentials } = await getMongoCollections();
  const current = await botCredentials.findOne({ _id: credentialId, workspaceId, status: { $ne: "disabled" } });

  if (!current) {
    throw httpError("Bot não encontrado neste workspace.", 404);
  }

  const now = new Date();
  const protectedToken = encryptBotToken(token);
  await botCredentials.updateOne(
    { _id: credentialId, workspaceId },
    {
      $set: {
        authTag: protectedToken.authTag,
        encryptedDataKey: protectedToken.encryptedDataKey,
        iv: protectedToken.iv,
        keyVersion: protectedToken.keyVersion,
        lastError: null,
        lastValidatedAt: null,
        status: "stored",
        tokenCiphertext: protectedToken.tokenCiphertext,
        tokenFingerprint: protectedToken.tokenFingerprint,
        updatedAt: now
      }
    }
  );
  await writePlanAudit(actor, "bot_credential_token_rotated", "bot_credential", credentialId, { workspaceId });
  const updated = await botCredentials.findOne({ _id: credentialId, workspaceId });
  return toBotCredentialDto(updated ?? current);
}

export async function validateWorkspaceBotCredential(workspaceId: string, credentialId: string, auth: DashboardAuth, actor: PlanActor) {
  await assertWorkspaceAccess(workspaceId, auth);
  const { botCredentials } = await getMongoCollections();
  const now = new Date();
  const updated = await botCredentials.findOneAndUpdate(
    { _id: credentialId, workspaceId, status: { $ne: "disabled" } },
    {
      $set: {
        lastError: null,
        lastValidatedAt: now,
        status: "validated",
        updatedAt: now
      }
    },
    { returnDocument: "after" }
  );

  if (!updated) {
    throw httpError("Bot não encontrado neste workspace.", 404);
  }

  await writePlanAudit(actor, "bot_credential_validated", "bot_credential", credentialId, { workspaceId });
  return toBotCredentialDto(updated);
}

export async function deleteWorkspaceBotCredential(workspaceId: string, credentialId: string, auth: DashboardAuth, actor: PlanActor) {
  await assertWorkspaceAccess(workspaceId, auth);
  const { botCredentials, planWorkspaces } = await getMongoCollections();
  const deleted = await botCredentials.findOneAndDelete({ _id: credentialId, workspaceId });

  if (!deleted) {
    throw httpError("Bot não encontrado neste workspace.", 404);
  }

  await planWorkspaces.updateOne({ _id: workspaceId }, { $pull: { botIds: credentialId }, $set: { updatedAt: new Date() } });
  await writePlanAudit(actor, "bot_credential_deleted", "bot_credential", credentialId, { workspaceId });
  return toBotCredentialDto({ ...deleted, status: "disabled" });
}

export async function getDevPlansDashboard() {
  await ensurePlanSeed();
  const { paymentOrders, planAuditLogs, planFeatures, plans, planSubscriptions, planWorkspaces } = await getMongoCollections();
  const [planRows, featureRows, subscriptionRows, workspaceRows, orderRows, auditRows, settings] = await Promise.all([
    plans.find({}).sort({ order: 1, createdAt: 1 }).toArray(),
    planFeatures.find({}).sort({ category: 1, order: 1 }).toArray(),
    planSubscriptions.find({}).sort({ updatedAt: -1 }).limit(200).toArray(),
    planWorkspaces.find({}).sort({ updatedAt: -1 }).limit(200).toArray(),
    paymentOrders.find({}).sort({ createdAt: -1 }).limit(200).toArray(),
    planAuditLogs.find({}).sort({ createdAt: -1 }).limit(120).toArray(),
    ensurePaymentSettings()
  ]);
  const planRowsById = new Map(planRows.map((plan) => [plan._id, plan]));
  const workspaceRowsById = new Map(workspaceRows.map((workspace) => [workspace._id, workspace]));

  return {
    auditLogs: auditRows.map(toAuditLogDto),
    features: featureRows.map(toPlanFeatureDto),
    orders: orderRows.map(toPaymentOrderDto),
    paymentSettings: toPaymentSettingsDto(settings),
    plans: planRows.map(toPlanDto),
    subscriptions: subscriptionRows.map((subscription) => toSubscriptionDto(
      subscription,
      planRowsById.get(subscription.planId) ?? null,
      subscription.workspaceId ? workspaceRowsById.get(subscription.workspaceId) ?? null : null
    )),
    summary: {
      activePlans: planRows.filter((plan) => plan.isActive).length,
      activeSubscriptions: subscriptionRows.filter((subscription) => subscription.status === "active").length,
      interestOrders: orderRows.filter((order) => order.status === "interest_registered").length,
      paymentsEnabled: isResolvedPaymentProviderEnabled(resolveEnvPaymentProvider(), getMercadoPagoRuntimeConfig()),
      publicPlans: planRows.filter((plan) => plan.isPublic).length,
      workspaces: workspaceRows.length
    },
    workspaces: workspaceRows.map((workspace) => toWorkspaceDto(workspace))
  };
}

export async function saveDevPlan(planId: string | null, input: SavePlanInput, actor: PlanActor) {
  await ensurePlanSeed();
  const { plans } = await getMongoCollections();
  const now = new Date();

  if (planId) {
    const current = await plans.findOne({ _id: planId });
    if (!current) {
      throw httpError("Plano não encontrado.", 404);
    }

    const nextSlug = slugify(input.slug || input.name || current.slug);
    const duplicate = await plans.findOne({ slug: nextSlug, _id: { $ne: planId } });
    if (duplicate) {
      throw httpError("Já existe um plano com este slug.", 409);
    }

    await plans.updateOne(
      { _id: planId },
      {
        $set: {
          ...buildPlanPatch(input, current),
          slug: nextSlug,
          updatedAt: now,
          updatedBy: actor.id
        }
      }
    );
    await writePlanAudit(actor, "plan_updated", "plan", planId, { slug: nextSlug });
    const updated = await plans.findOne({ _id: planId });
    return toPlanDto(updated ?? current);
  }

  const document = buildPlanDocument(input, actor.id, now);
  const duplicate = await plans.findOne({ slug: document.slug });
  if (duplicate) {
    throw httpError("Já existe um plano com este slug.", 409);
  }

  await plans.insertOne(document);
  await writePlanAudit(actor, "plan_created", "plan", document._id, { slug: document.slug });
  return toPlanDto(document);
}

export async function duplicateDevPlan(planId: string, actor: PlanActor) {
  const { plans } = await getMongoCollections();
  const current = await plans.findOne({ _id: planId });
  if (!current) {
    throw httpError("Plano não encontrado.", 404);
  }

  const now = new Date();
  const copy: MongoPlan = {
    ...current,
    _id: randomUUID(),
    createdAt: now,
    createdBy: actor.id,
    isActive: false,
    name: `${current.name} Copia`,
    slug: await uniquePlanSlug(`${current.slug}-copia`),
    updatedAt: now,
    updatedBy: actor.id
  };

  await plans.insertOne(copy);
  await writePlanAudit(actor, "plan_duplicated", "plan", copy._id, { sourcePlanId: planId, slug: copy.slug });
  return toPlanDto(copy);
}

export async function setDevPlanActive(planId: string, active: boolean, actor: PlanActor) {
  const { plans } = await getMongoCollections();
  const now = new Date();
  const updated = await plans.findOneAndUpdate(
    { _id: planId },
    { $set: { isActive: active, updatedAt: now, updatedBy: actor.id } },
    { returnDocument: "after" }
  );

  if (!updated) {
    throw httpError("Plano não encontrado.", 404);
  }

  await writePlanAudit(actor, active ? "plan_activated" : "plan_deactivated", "plan", planId);
  return toPlanDto(updated);
}

export async function saveDevPlanFeature(featureId: string | null, input: SavePlanFeatureInput, actor: PlanActor) {
  const { planFeatures } = await getMongoCollections();
  const now = new Date();
  const key = normalizeFeatureKey(input.key);

  if (featureId) {
    const current = await planFeatures.findOne({ _id: featureId });
    if (!current) throw httpError("Feature não encontrada.", 404);
    const duplicate = await planFeatures.findOne({ key, _id: { $ne: featureId } });
    if (duplicate) throw httpError("Já existe uma feature com esta chave.", 409);

    await planFeatures.updateOne(
      { _id: featureId },
      {
        $set: {
          category: input.category,
          defaultLimit: input.defaultLimit ?? null,
          description: input.description ?? "",
          isActive: input.isActive ?? true,
          isPublic: input.isPublic ?? true,
          key,
          name: trimText(input.name, 120),
          order: input.order ?? current.order,
          unit: input.unit ?? null,
          updatedAt: now
        }
      }
    );
    await writePlanAudit(actor, "feature_updated", "feature", featureId, { key });
    return toPlanFeatureDto((await planFeatures.findOne({ _id: featureId })) ?? current);
  }

  const document: MongoPlanFeature = {
    _id: randomUUID(),
    category: input.category,
    createdAt: now,
    defaultLimit: input.defaultLimit ?? null,
    description: input.description ?? "",
    isActive: input.isActive ?? true,
    isPublic: input.isPublic ?? true,
    key,
    name: trimText(input.name, 120),
    order: input.order ?? 0,
    unit: input.unit ?? null,
    updatedAt: now
  };

  await planFeatures.insertOne(document);
  await writePlanAudit(actor, "feature_created", "feature", document._id, { key });
  return toPlanFeatureDto(document);
}

export async function manualActivateSubscription(input: ManualActivationInput, actor: PlanActor) {
  const { planSubscriptions, planWorkspaces, plans, workspaceMembers } = await getMongoCollections();
  const plan = await plans.findOne({ _id: input.planId });
  if (!plan) throw httpError("Plano não encontrado.", 404);

  const now = new Date();
  const subscriptionId = randomUUID();
  const workspaceId = randomUUID();
  const workspaceName = trimText(input.workspaceName || `${plan.name} Workspace`, 80) || `${plan.name} Workspace`;
  const workspace: MongoPlanWorkspace = {
    _id: workspaceId,
    botIds: [],
    createdAt: now,
    guildIds: [],
    name: workspaceName,
    ownerDiscordId: input.userId,
    ownerUserId: input.userId,
    planId: plan._id,
    slug: await uniqueWorkspaceSlug(workspaceName),
    status: "active",
    subscriptionId,
    updatedAt: now
  };
  const subscription: MongoPlanSubscription = {
    _id: subscriptionId,
    activatedAt: now,
    activatedBy: actor.id,
    botLimit: plan.botLimit,
    cancelledAt: null,
    createdAt: now,
    discordId: input.userId,
    endsAt: plan.validityDays ? new Date(now.getTime() + plan.validityDays * 86_400_000) : null,
    guildLimit: plan.guildLimit,
    metadata: buildSubscriptionMetadata({ activation: "manual", plan, now }),
    planId: plan._id,
    planSlug: plan.slug,
    startedAt: now,
    status: "active",
    suspendedAt: null,
    updatedAt: now,
    userId: input.userId,
    workspaceId
  };

  await planWorkspaces.insertOne(workspace);
  await planSubscriptions.insertOne(subscription);
  await workspaceMembers.updateOne(
    { workspaceId, discordId: input.userId },
    {
      $setOnInsert: {
        _id: randomUUID(),
        createdAt: now,
        discordId: input.userId,
        role: "owner",
        userId: input.userId,
        workspaceId
      },
      $set: {
        updatedAt: now
      }
    },
    { upsert: true }
  );

  await writePlanAudit(actor, "subscription_manual_activation", "subscription", subscriptionId, {
    planSlug: plan.slug,
    userId: input.userId,
    workspaceId
  });

  return toSubscriptionDto(subscription, plan, workspace);
}

export async function completeTestPaymentOrder(orderId: string, actor: PlanActor) {
  const { paymentOrders, planSubscriptions, planWorkspaces, plans, workspaceMembers } = await getMongoCollections();
  const order = await paymentOrders.findOne({ _id: orderId });
  if (!order) throw httpError("Pedido de pagamento não encontrado.", 404);

  const plan = await plans.findOne({ _id: order.planId });
  if (!plan) throw httpError("Plano do pedido não encontrado.", 404);

  const existingSubscription = await planSubscriptions.findOne({
    "metadata.paymentOrderId": order._id
  } as Partial<MongoPlanSubscription>);

  if ((order.status === "paid" || order.status === "approved") && existingSubscription) {
    const workspace = existingSubscription.workspaceId ? await planWorkspaces.findOne({ _id: existingSubscription.workspaceId }) : null;
    return {
      order: toPaymentOrderDto(order),
      subscription: toSubscriptionDto(existingSubscription, plan, workspace)
    };
  }

  if (["cancelled", "expired", "failed", "rejected", "refunded", "chargeback", "charged_back"].includes(order.status)) {
    throw httpError("Pedido finalizado não pode ser pago em teste.", 409);
  }

  const now = new Date();
  const subscriptionId = existingSubscription?._id ?? randomUUID();
  const workspaceId = existingSubscription?.workspaceId ?? randomUUID();
  const workspaceName = `${plan.name} Teste`;

  if (!existingSubscription) {
    const workspace: MongoPlanWorkspace = {
      _id: workspaceId,
      botIds: [],
      createdAt: now,
      guildIds: [],
      name: workspaceName,
      ownerDiscordId: order.discordId,
      ownerUserId: order.userId || order.discordId,
      planId: plan._id,
      slug: await uniqueWorkspaceSlug(workspaceName),
      status: "active",
      subscriptionId,
      updatedAt: now
    };
    const subscription: MongoPlanSubscription = {
      _id: subscriptionId,
      activatedAt: now,
      activatedBy: actor.id,
      botLimit: plan.botLimit,
      cancelledAt: null,
      createdAt: now,
      discordId: order.discordId,
      endsAt: plan.validityDays ? new Date(now.getTime() + plan.validityDays * 86_400_000) : null,
      guildLimit: plan.guildLimit,
      metadata: buildSubscriptionMetadata({ activation: "payment_test", paymentOrderId: order._id, plan, snapshot: order.planSnapshot, now }),
      planId: plan._id,
      planSlug: plan.slug,
      startedAt: now,
      status: "active",
      suspendedAt: null,
      updatedAt: now,
      userId: order.userId || order.discordId,
      workspaceId
    };

    await planWorkspaces.insertOne(workspace);
    await planSubscriptions.insertOne(subscription);
    await syncContractActivatedFromSubscription(subscription, order, plan, "payment_test");
    await workspaceMembers.updateOne(
      { workspaceId, discordId: order.discordId },
      {
        $setOnInsert: {
          _id: randomUUID(),
          createdAt: now,
          discordId: order.discordId,
          role: "owner",
          userId: order.userId || order.discordId,
          workspaceId
        },
        $set: {
          updatedAt: now
        }
      },
      { upsert: true }
    );
  } else {
    await planSubscriptions.updateOne(
      { _id: existingSubscription._id },
      {
        $set: {
          activatedAt: existingSubscription.activatedAt ?? now,
          activatedBy: existingSubscription.activatedBy ?? actor.id,
          cancelledAt: null,
          startedAt: existingSubscription.startedAt ?? now,
          status: "active",
          suspendedAt: null,
          updatedAt: now
        }
      }
    );
    if (existingSubscription.workspaceId) {
      await planWorkspaces.updateOne({ _id: existingSubscription.workspaceId }, { $set: { status: "active", updatedAt: now } });
    }
    await syncContractActivatedFromSubscription({ ...existingSubscription, activatedAt: existingSubscription.activatedAt ?? now, status: "active", updatedAt: now }, order, plan, "payment_test");
  }

  await paymentOrders.updateOne(
    { _id: order._id },
    {
      $set: {
        accessActivated: true,
        accessActivatedAt: now,
        notes: "Pagamento marcado como pago pelo modo de teste DEV.",
        paidAt: order.paidAt ?? now,
        approvedAt: order.approvedAt ?? now,
        status: "approved",
        statusHistory: appendStatusHistory(order, "approved", "dev_test"),
        updatedAt: now
      }
    }
  );

  await writePlanAudit(actor, "payment_test_paid", "payment", order._id, {
    planSlug: plan.slug,
    subscriptionId,
    workspaceId
  });

  const [updatedOrder, updatedSubscription, workspace] = await Promise.all([
    paymentOrders.findOne({ _id: order._id }),
    planSubscriptions.findOne({ _id: subscriptionId }),
    planWorkspaces.findOne({ _id: workspaceId })
  ]);

  return {
    order: toPaymentOrderDto(updatedOrder ?? order),
    subscription: updatedSubscription ? toSubscriptionDto(updatedSubscription, plan, workspace) : null
  };
}

export async function processMercadoPagoWebhook(input: MercadoPagoWebhookInput) {
  const { paymentEvents, paymentOrders, plans } = await getMongoCollections();
  const mercadoPagoConfig = requireMercadoPagoOperational({ allowDisabled: true, requireWebhook: true });
  const now = new Date();
  const payload = isRecord(input.body) ? input.body : {};
  const dataId = input.dataId ?? readNestedString(payload, ["data", "id"]);
  const eventType = readString(payload.type) ?? readString(payload.action) ?? "unknown";
  const eventId = readString(payload.id) ?? input.requestId ?? dataId ?? null;
  const payloadHash = sha256(JSON.stringify(payload));
  const eventDoc: MongoPaymentEvent = {
    _id: randomUUID(),
    attempts: 1,
    createdAt: now,
    environment: mercadoPagoConfig.environment,
    eventId,
    eventType,
    lastError: null,
    orderId: null,
    paymentId: dataId,
    payloadHash,
    processedAt: null,
    provider: "mercadopago",
    requestId: input.requestId,
    result: null,
    signatureValid: false,
    status: "received"
  };

  const existingProcessed = eventId
    ? await paymentEvents.findOne({ provider: "mercadopago", environment: mercadoPagoConfig.environment, eventId, status: "processed" })
    : await paymentEvents.findOne({ provider: "mercadopago", environment: mercadoPagoConfig.environment, payloadHash, status: "processed" });

  if (existingProcessed) {
    return {
      duplicate: true,
      event: mapPaymentEvent(existingProcessed),
      processed: true
    };
  }

  const insertedEvent = await paymentEvents.insertOne(eventDoc).then(() => eventDoc);

  try {
    const provider = new MercadoPagoPaymentProvider(
      requireMercadoPagoAccessToken(mercadoPagoConfig),
      mercadoPagoConfig.webhookSecret
    );
    const signatureValid = await provider.validateWebhook({
      dataId,
      requestId: input.requestId,
      signature: input.signature
    });
    await paymentEvents.updateOne({ _id: insertedEvent._id }, { $set: { signatureValid } });

    if (!signatureValid) {
      await markPaymentEvent(insertedEvent._id, "failed", "Assinatura Mercado Pago inválida.");
      throw httpError("Assinatura Mercado Pago inválida.", 401);
    }

    if (!dataId) {
      await markPaymentEvent(insertedEvent._id, "ignored", "Webhook sem data.id.");
      return { duplicate: false, event: mapPaymentEvent({ ...insertedEvent, status: "ignored", result: "Webhook sem data.id.", signatureValid: true, processedAt: new Date() }), processed: false };
    }

    if (isMercadoPagoOrderWebhook(payload, input.resourceType)) {
      const mercadoOrder = await provider.getOrder(dataId);
      const externalReference = mercadoOrder.externalReference;
      if (!externalReference) {
        await markPaymentEvent(insertedEvent._id, "ignored", "Order sem referencia externa.");
        return { duplicate: false, event: mapPaymentEvent({ ...insertedEvent, status: "ignored", result: "Order sem referencia externa.", signatureValid: true, processedAt: new Date() }), processed: false };
      }

      const order = await paymentOrders.findOne({ _id: externalReference });
      if (!order) {
        await markPaymentEvent(insertedEvent._id, "ignored", "Pedido interno não encontrado.", null);
        return { duplicate: false, event: mapPaymentEvent({ ...insertedEvent, orderId: null, status: "ignored", result: "Pedido interno não encontrado.", signatureValid: true, processedAt: new Date() }), processed: false };
      }

      await paymentEvents.updateOne({ _id: insertedEvent._id }, { $set: { orderId: order._id, paymentId: mercadoOrder.paymentId ?? dataId } });

      if (order.provider !== "mercadopago" || order.externalReference !== externalReference) {
        await markPaymentEvent(insertedEvent._id, "failed", "Referencia do pedido divergente.", order._id);
        throw httpError("Referencia do pedido divergente.", 409);
      }

      if (order.environment && order.environment !== mercadoPagoConfig.environment) {
        await markPaymentEvent(insertedEvent._id, "failed", "Ambiente da order divergente.", order._id);
        throw httpError("Ambiente da order divergente.", 409);
      }

      const updatedOrder = await applyOfficialMercadoPagoOrderToOrder(order, mercadoOrder, "mercadopago_order_webhook");
      let subscription = null;
      if (updatedOrder.status === "approved" && !isPendingPaymentDiscordId(updatedOrder.discordId)) {
        const plan = await plans.findOne({ _id: order.planId });
        if (!plan) {
          await markPaymentEvent(insertedEvent._id, "failed", "Plano do pedido não encontrado.", order._id);
          throw httpError("Plano do pedido não encontrado.", 404);
        }
        subscription = await activatePaidOrderOnce(updatedOrder, plan, systemPaymentActor(), "mercadopago_order_webhook");
      } else if (updatedOrder.status === "approved") {
        await writePlanAudit(systemPaymentActor(), "payment_approved_waiting_discord_connection", "payment", order._id, {
          mercadoPagoOrderId: mercadoOrder.orderId,
          mercadoPagoPaymentId: mercadoOrder.paymentId
        });
      }

      await markPaymentEvent(insertedEvent._id, "processed", `Order processada: ${mercadoOrder.rawStatus}.`, order._id);
      await writePlanAudit(systemPaymentActor(), "mercadopago_order_webhook_processed", "payment", order._id, {
        mercadoPagoOrderId: mercadoOrder.orderId,
        mercadoPagoPaymentId: mercadoOrder.paymentId,
        paymentMethod: mercadoOrder.paymentMethod,
        status: mercadoOrder.rawStatus
      });

      return {
        duplicate: false,
        event: mapPaymentEvent({ ...insertedEvent, orderId: order._id, paymentId: mercadoOrder.paymentId ?? dataId, processedAt: new Date(), result: `Order processada: ${mercadoOrder.rawStatus}.`, signatureValid: true, status: "processed" }),
        order: toPaymentOrderDto(updatedOrder),
        processed: true,
        subscription
      };
    }

    const payment = await provider.getPayment(dataId);
    const externalReference = payment.externalReference;
    const paymentId = payment.id;
    const status = payment.status;
    const amountInCents = payment.amountInCents;
    const currency = payment.currency;
    const paymentMethod = payment.method;
    const paymentType = payment.paymentType;
    const liveMode = typeof payment.raw.live_mode === "boolean" ? payment.raw.live_mode : null;
    const paymentEnvironment = liveMode === null ? null : liveMode ? "production" : "test";

    if (!externalReference) {
      await markPaymentEvent(insertedEvent._id, "ignored", "Pagamento sem referencia externa.");
      return { duplicate: false, event: mapPaymentEvent({ ...insertedEvent, status: "ignored", result: "Pagamento sem referencia externa.", signatureValid: true, processedAt: new Date() }), processed: false };
    }

    const order = await paymentOrders.findOne({ _id: externalReference });
    if (!order) {
      await markPaymentEvent(insertedEvent._id, "ignored", "Pedido interno não encontrado.", null);
      return { duplicate: false, event: mapPaymentEvent({ ...insertedEvent, orderId: null, status: "ignored", result: "Pedido interno não encontrado.", signatureValid: true, processedAt: new Date() }), processed: false };
    }

    await paymentEvents.updateOne({ _id: insertedEvent._id }, { $set: { orderId: order._id } });

    if (order.provider !== "mercadopago" || order.externalReference !== externalReference) {
      await markPaymentEvent(insertedEvent._id, "failed", "Referencia do pedido divergente.", order._id);
      throw httpError("Referencia do pedido divergente.", 409);
    }

    if (order.environment && order.environment !== mercadoPagoConfig.environment) {
      await markPaymentEvent(insertedEvent._id, "failed", "Ambiente da ordem divergente.", order._id);
      throw httpError("Ambiente da ordem divergente.", 409);
    }

    if (paymentEnvironment && paymentEnvironment !== mercadoPagoConfig.environment) {
      await markPaymentEvent(insertedEvent._id, "failed", "Ambiente do pagamento divergente.", order._id);
      await paymentOrders.updateOne({ _id: order._id }, {
        $set: {
          mercadoPagoPaymentId: paymentId,
          notes: "Pagamento Mercado Pago recusado por divergencia de ambiente.",
          rawProviderStatus: payment.rawStatus,
          status: "error",
          statusHistory: appendStatusHistory(order, "error", "mercadopago_environment_mismatch"),
          webhookSafeResponse: safePaymentWebhookResponse(payment.raw),
          updatedAt: new Date()
        }
      });
      throw httpError("Ambiente do pagamento divergente.", 409);
    }

    if (amountInCents !== order.amountInCents || currency !== order.currency) {
      await paymentOrders.updateOne({ _id: order._id }, {
        $set: {
          mercadoPagoPaymentId: paymentId,
          notes: "Pagamento Mercado Pago recusado por divergencia de valor ou moeda.",
          status: "rejected",
          statusHistory: appendStatusHistory(order, "rejected", "mercadopago_amount_mismatch"),
          updatedAt: new Date()
        }
      });
      await markPaymentEvent(insertedEvent._id, "failed", "Valor ou moeda divergente.", order._id);
      await writePlanAudit(systemPaymentActor(), "payment_amount_mismatch", "payment", order._id, {
        expectedAmountInCents: order.amountInCents,
        expectedCurrency: order.currency,
        receivedAmountInCents: amountInCents,
        receivedCurrency: currency,
        mercadoPagoPaymentId: paymentId
      });
      throw httpError("Valor ou moeda divergente.", 409);
    }

    const nextStatus = providerStatusToOrderStatus(status);
    const update: Partial<MongoPaymentOrder> = {
      approvedAt: nextStatus === "approved" ? order.approvedAt ?? new Date() : order.approvedAt ?? null,
      cancelledAt: nextStatus === "cancelled" ? order.cancelledAt ?? new Date() : order.cancelledAt ?? null,
      refundedAt: nextStatus === "refunded" ? order.refundedAt ?? new Date() : order.refundedAt ?? null,
      rejectedAt: nextStatus === "rejected" ? order.rejectedAt ?? new Date() : order.rejectedAt ?? null,
      merchantOrderId: readNestedString(payment.raw, ["order", "id"]),
      mercadoPagoPaymentId: paymentId,
      notes: `Status Mercado Pago confirmado: ${nextStatus}.`,
      paymentMethod,
      paymentType,
      rawProviderStatus: payment.rawStatus,
      status: nextStatus,
      statusDetail: payment.statusDetail,
      statusHistory: appendStatusHistory(order, nextStatus, "mercadopago_webhook"),
      webhookSafeResponse: safePaymentWebhookResponse(payment.raw),
      updatedAt: new Date()
    };
    if (nextStatus === "approved") update.paidAt = order.paidAt ?? new Date();

    await paymentOrders.updateOne({ _id: order._id }, { $set: update });

    let subscription = null;
    if (nextStatus === "approved" && !isPendingPaymentDiscordId(order.discordId)) {
      const plan = await plans.findOne({ _id: order.planId });
      if (!plan) {
        await markPaymentEvent(insertedEvent._id, "failed", "Plano do pedido não encontrado.", order._id);
        throw httpError("Plano do pedido não encontrado.", 404);
      }
      subscription = await activatePaidOrderOnce({ ...order, ...update, status: nextStatus }, plan, systemPaymentActor(), "mercadopago_webhook");
    } else if (nextStatus === "approved") {
      await writePlanAudit(systemPaymentActor(), "payment_approved_waiting_discord_connection", "payment", order._id, {
        mercadoPagoPaymentId: paymentId,
        paymentMethod
      });
    }

    await markPaymentEvent(insertedEvent._id, "processed", `Status processado: ${status}.`, order._id);
    await writePlanAudit(systemPaymentActor(), "mercadopago_webhook_processed", "payment", order._id, {
      mercadoPagoPaymentId: paymentId,
      paymentMethod,
      status
    });

    const updatedOrder = await paymentOrders.findOne({ _id: order._id });
    return {
      duplicate: false,
      event: mapPaymentEvent({ ...insertedEvent, orderId: order._id, processedAt: new Date(), result: `Status processado: ${status}.`, signatureValid: true, status: "processed" }),
      order: updatedOrder ? toPaymentOrderDto(updatedOrder) : null,
      processed: true,
      subscription
    };
  } catch (error) {
    if (!("statusCode" in Object(error))) {
      await markPaymentEvent(insertedEvent._id, "failed", error instanceof Error ? error.message : String(error));
    }
    throw error;
  }
}

export async function processPagBankWebhook(input: PagBankWebhookInput) {
  const { paymentEvents, paymentOrders, plans } = await getMongoCollections();
  const activeGateway = await resolveActivePaymentManager({ allowDisabled: true, provider: "pagbank" });
  const provider = (activeGateway as { manager: PaymentManager }).manager.getProvider();
  const now = new Date();
  const payload = isRecord(input.body) ? input.body : {};
  const orderId = readString(payload.id) ?? readNestedString(payload, ["order", "id"]) ?? null;
  const externalReference = readString(payload.reference_id) ?? readNestedString(payload, ["order", "reference_id"]);
  const eventType = readString(payload.type) ?? readString(payload.event_type) ?? readString(payload.status) ?? "pagbank.webhook";
  const eventId = input.eventId ?? readString(payload.id) ?? input.requestId ?? externalReference ?? null;
  const payloadHash = sha256(JSON.stringify(payload));
  const eventDoc: MongoPaymentEvent = {
    _id: randomUUID(),
    attempts: 1,
    createdAt: now,
    environment: activeGateway.environment,
    eventId,
    eventType,
    lastError: null,
    orderId: null,
    paymentId: orderId,
    payloadHash,
    processedAt: null,
    provider: "pagbank",
    requestId: input.requestId ?? null,
    result: null,
    signatureValid: false,
    status: "received"
  };
  const existingProcessed = eventId
    ? await paymentEvents.findOne({ provider: "pagbank", environment: activeGateway.environment, eventId, status: "processed" })
    : await paymentEvents.findOne({ provider: "pagbank", environment: activeGateway.environment, payloadHash, status: "processed" });

  if (existingProcessed) {
    return { duplicate: true, event: mapPaymentEvent(existingProcessed), processed: true };
  }

  const insertedEvent = await paymentEvents.insertOne(eventDoc).then(() => eventDoc);

  try {
    const signatureValid = await provider.validateWebhook({
      dataId: orderId,
      requestId: input.requestId ?? null,
      signature: input.signature ?? null,
      webhookToken: input.webhookToken ?? null
    });
    await paymentEvents.updateOne({ _id: insertedEvent._id }, { $set: { signatureValid } });

    if (!signatureValid) {
      await markPaymentEvent(insertedEvent._id, "failed", "Token PagBank inválido.");
      throw httpError("Token PagBank inválido.", 401);
    }

    if (!externalReference) {
      await markPaymentEvent(insertedEvent._id, "ignored", "Webhook PagBank sem reference_id.");
      return { duplicate: false, event: mapPaymentEvent({ ...insertedEvent, status: "ignored", result: "Webhook PagBank sem reference_id.", signatureValid: true, processedAt: new Date() }), processed: false };
    }

    const order = await paymentOrders.findOne({ _id: externalReference });
    if (!order) {
      await markPaymentEvent(insertedEvent._id, "ignored", "Pedido interno não encontrado.", null);
      return { duplicate: false, event: mapPaymentEvent({ ...insertedEvent, orderId: null, status: "ignored", result: "Pedido interno não encontrado.", signatureValid: true, processedAt: new Date() }), processed: false };
    }

    if (order.provider !== "pagbank" || order.externalReference !== externalReference) {
      await markPaymentEvent(insertedEvent._id, "failed", "Referencia do pedido PagBank divergente.", order._id);
      throw httpError("Referencia do pedido divergente.", 409);
    }

    await paymentEvents.updateOne({ _id: insertedEvent._id }, { $set: { orderId: order._id, paymentId: orderId } });
    const providerOrder = orderId && orderId !== order.providerOrderId
      ? await provider.getOrder(orderId).catch(() => normalizeProviderOrderFromPagBankWebhook(payload))
      : normalizeProviderOrderFromPagBankWebhook(payload);
    const updatedOrder = await applyOfficialProviderOrderToOrder(order, providerOrder, "pagbank_webhook");
    let subscription = null;

    if (updatedOrder.status === "approved" && !isPendingPaymentDiscordId(updatedOrder.discordId)) {
      const plan = await plans.findOne({ _id: order.planId });
      if (!plan) {
        await markPaymentEvent(insertedEvent._id, "failed", "Plano do pedido não encontrado.", order._id);
        throw httpError("Plano do pedido não encontrado.", 404);
      }
      subscription = await activatePaidOrderOnce(updatedOrder, plan, systemPaymentActor(), "pagbank_webhook");
    }

    await markPaymentEvent(insertedEvent._id, "processed", `PagBank processado: ${providerOrder.rawStatus}.`, order._id);
    await writePlanAudit(systemPaymentActor(), "pagbank_webhook_processed", "payment", order._id, {
      providerOrderId: providerOrder.orderId,
      paymentId: providerOrder.paymentId,
      status: providerOrder.rawStatus
    });

    return {
      duplicate: false,
      event: mapPaymentEvent({ ...insertedEvent, orderId: order._id, paymentId: providerOrder.paymentId ?? providerOrder.orderId, processedAt: new Date(), result: `PagBank processado: ${providerOrder.rawStatus}.`, signatureValid: true, status: "processed" }),
      order: toPaymentOrderDto(updatedOrder),
      processed: true,
      subscription
    };
  } catch (error) {
    if (!("statusCode" in Object(error))) {
      await markPaymentEvent(insertedEvent._id, "failed", error instanceof Error ? error.message : String(error));
    }
    throw error;
  }
}

export async function processStripeWebhook(input: StripeWebhookInput) {
  const { paymentEvents, paymentOrders, plans } = await getMongoCollections();
  const stripeConfig = requireStripeOperational({ allowDisabled: true, requireWebhook: true });
  const now = new Date();
  const payloadHash = sha256(input.rawBody.toString("utf8"));

  let validation;
  try {
    validation = validateStripeWebhookSignature({
      config: stripeConfig,
      rawBody: input.rawBody,
      signature: input.signature ?? null
    });
  } catch (error) {
    const eventDoc: MongoPaymentEvent = {
      _id: randomUUID(),
      attempts: 1,
      createdAt: now,
      environment: stripeConfig.environment,
      eventId: null,
      eventType: "stripe.invalid_signature",
      lastError: "Assinatura Stripe inválida.",
      orderId: null,
      paymentId: null,
      payloadHash,
      processedAt: now,
      provider: "stripe",
      requestId: input.requestId ?? null,
      result: "Assinatura Stripe inválida.",
      signatureValid: false,
      status: "failed"
    };
    await paymentEvents.insertOne(eventDoc);
    throw Object.assign(error instanceof Error ? error : new Error("Assinatura Stripe inválida."), { statusCode: 401 });
  }

  const event = validation.event;
  const eventId = event.id;
  const eventType = event.type;
  const session = isStripeCheckoutSessionEvent(event.type, event.data.object)
    ? event.data.object
    : null;
  const eventDoc: MongoPaymentEvent = {
    _id: randomUUID(),
    attempts: 1,
    createdAt: now,
    environment: stripeConfig.environment,
    eventId,
    eventType,
    lastError: null,
    orderId: null,
    paymentId: session?.id ?? null,
    payloadHash,
    processedAt: null,
    provider: "stripe",
    requestId: input.requestId ?? null,
    result: null,
    signatureValid: true,
    status: "received"
  };
  const existingProcessed = await paymentEvents.findOne({
    provider: "stripe",
    environment: stripeConfig.environment,
    eventId,
    status: "processed"
  });

  if (existingProcessed) {
    return { duplicate: true, event: mapPaymentEvent(existingProcessed), processed: true };
  }

  const insertedEvent = await paymentEvents.insertOne(eventDoc).then(() => eventDoc);

  try {
    if (!session) {
      await markPaymentEvent(insertedEvent._id, "ignored", `Evento Stripe ignorado: ${eventType}.`);
      return {
        duplicate: false,
        event: mapPaymentEvent({ ...insertedEvent, status: "ignored", result: `Evento Stripe ignorado: ${eventType}.`, processedAt: new Date() }),
        processed: false
      };
    }

    const payment = stripeSessionToProviderPayment(session);
    if (eventType === "checkout.session.async_payment_failed") {
      payment.rawStatus = eventType;
      payment.status = "rejected";
      payment.statusDetail = "async_payment_failed";
    }
    const externalReference = payment.externalReference;
    if (!externalReference) {
      await markPaymentEvent(insertedEvent._id, "ignored", "Checkout Stripe sem referência externa.");
      return {
        duplicate: false,
        event: mapPaymentEvent({ ...insertedEvent, status: "ignored", result: "Checkout Stripe sem referência externa.", processedAt: new Date() }),
        processed: false
      };
    }

    const order = await paymentOrders.findOne({ _id: externalReference });
    if (!order) {
      await markPaymentEvent(insertedEvent._id, "ignored", "Pedido interno não encontrado.", null);
      return {
        duplicate: false,
        event: mapPaymentEvent({ ...insertedEvent, orderId: null, status: "ignored", result: "Pedido interno não encontrado.", processedAt: new Date() }),
        processed: false
      };
    }

    await paymentEvents.updateOne({ _id: insertedEvent._id }, { $set: { orderId: order._id, paymentId: payment.id } });
    const updatedOrder = await applyStripePaymentToOrder(order, payment, "stripe_webhook");
    let subscription = null;

    if (updatedOrder.status === "approved" && !isPendingPaymentDiscordId(updatedOrder.discordId)) {
      const plan = await plans.findOne({ _id: order.planId });
      if (!plan) {
        await markPaymentEvent(insertedEvent._id, "failed", "Plano do pedido não encontrado.", order._id);
        throw httpError("Plano do pedido não encontrado.", 404);
      }
      subscription = await activatePaidOrderOnce(updatedOrder, plan, systemPaymentActor(), "stripe_webhook");
    } else if (updatedOrder.status === "approved") {
      await writePlanAudit(systemPaymentActor(), "payment_approved_waiting_discord_connection", "payment", order._id, {
        provider: "stripe",
        stripePaymentId: payment.id,
        stripeSessionId: readString(payment.raw.id)
      });
    }

    await markPaymentEvent(insertedEvent._id, "processed", `Stripe processado: ${payment.rawStatus}.`, order._id);
    await writePlanAudit(systemPaymentActor(), "stripe_webhook_processed", "payment", order._id, {
      paymentMethod: payment.method,
      status: payment.rawStatus,
      stripePaymentId: payment.id,
      stripeSessionId: readString(payment.raw.id)
    });

    return {
      duplicate: false,
      event: mapPaymentEvent({ ...insertedEvent, orderId: order._id, paymentId: payment.id, processedAt: new Date(), result: `Stripe processado: ${payment.rawStatus}.`, status: "processed" }),
      order: toPaymentOrderDto(updatedOrder),
      processed: true,
      subscription
    };
  } catch (error) {
    if (!("statusCode" in Object(error))) {
      await markPaymentEvent(insertedEvent._id, "failed", error instanceof Error ? error.message : String(error));
    }
    throw error;
  }
}

export async function processAsaasWebhook(input: AsaasWebhookInput) {
  const { paymentEvents, paymentOrders, plans } = await getMongoCollections();
  const asaasConfig = requireAsaasOperational({ allowDisabled: true });
  const now = new Date();
  const payload = isRecord(input.body) ? input.body : {};
  const paymentPayload = isRecord(payload.payment) ? payload.payment as unknown as AsaasPayment : null;
  const paymentId = readString(paymentPayload?.id);
  const eventType = readString(payload.event) ?? readString(payload.type) ?? readString(paymentPayload?.status) ?? "asaas.webhook";
  const eventId = input.eventId ?? readString(payload.id) ?? (paymentId ? `${eventType}:${paymentId}` : input.requestId ?? null);
  const payloadHash = sha256(JSON.stringify(payload));
  const eventDoc: MongoPaymentEvent = {
    _id: randomUUID(),
    attempts: 1,
    createdAt: now,
    environment: asaasConfig.environment,
    eventId,
    eventType,
    lastError: null,
    orderId: null,
    paymentId,
    payload,
    payloadHash,
    processedAt: null,
    provider: "asaas",
    requestId: input.requestId ?? null,
    result: null,
    signatureValid: false,
    status: "received"
  };
  const existingProcessed = eventId
    ? await paymentEvents.findOne({ provider: "asaas", environment: asaasConfig.environment, eventId, status: { $in: ["received", "processing", "processed"] } })
    : await paymentEvents.findOne({ provider: "asaas", environment: asaasConfig.environment, payloadHash, status: { $in: ["received", "processing", "processed"] } });

  if (existingProcessed) {
    return { duplicate: true, event: mapPaymentEvent(existingProcessed), processed: true };
  }

  const insertedEvent = await paymentEvents.insertOne(eventDoc).then(() => eventDoc);

  try {
    const signatureValid = validateAsaasWebhookToken(asaasConfig, input.webhookToken ?? null);
    await paymentEvents.updateOne({ _id: insertedEvent._id }, { $set: { signatureValid } });
    if (!signatureValid) {
      await markPaymentEvent(insertedEvent._id, "failed", "Token webhook Asaas inválido.");
      throw Object.assign(new Error("Token webhook Asaas inválido."), { statusCode: 401 });
    }

    await paymentEvents.updateOne({ _id: insertedEvent._id }, { $set: { status: "processing" } });

    if (!paymentPayload) {
      await markPaymentEvent(insertedEvent._id, "ignored", `Evento Asaas ignorado sem payment: ${eventType}.`);
      return {
        duplicate: false,
        event: mapPaymentEvent({ ...insertedEvent, status: "ignored", result: `Evento Asaas ignorado sem payment: ${eventType}.`, processedAt: new Date() }),
        processed: false
      };
    }

    const payment = asaasPaymentToProviderPayment(paymentPayload, paymentId ?? undefined);
    const externalReference = payment.externalReference;
    const customerId = readString(paymentPayload.customer);
    const order = externalReference
      ? await paymentOrders.findOne({ _id: externalReference })
      : payment.id
        ? await paymentOrders.findOne({ provider: "asaas", providerOrderId: payment.id })
        : customerId
          ? await paymentOrders.findOne({ provider: "asaas", "webhookSafeResponse.customer": customerId })
          : null;

    if (!order) {
      const paidInvoice = (eventType === "PAYMENT_CONFIRMED" || eventType === "PAYMENT_RECEIVED")
        ? await markBotInvoicePaidFromAsaas(payment.id, externalReference ?? null)
        : null;
      if (paidInvoice) {
        await paymentEvents.updateOne({ _id: insertedEvent._id }, { $set: { orderId: paidInvoice.id, paymentId: payment.id } });
        await markPaymentEvent(insertedEvent._id, "processed", `Fatura mensal de bot processada: ${payment.rawStatus}.`, paidInvoice.id);
        return {
          duplicate: false,
          event: mapPaymentEvent({ ...insertedEvent, orderId: paidInvoice.id, paymentId: payment.id, processedAt: new Date(), result: `Fatura mensal de bot processada: ${payment.rawStatus}.`, status: "processed" }),
          invoice: paidInvoice,
          processed: true
        };
      }
      await markPaymentEvent(insertedEvent._id, "ignored", "Pedido Asaas interno não encontrado.", null);
      return {
        duplicate: false,
        event: mapPaymentEvent({ ...insertedEvent, orderId: null, status: "ignored", result: "Pedido Asaas interno não encontrado.", processedAt: new Date() }),
        processed: false
      };
    }

    await paymentEvents.updateOne({ _id: insertedEvent._id }, { $set: { orderId: order._id, paymentId: payment.id } });
    const updatedOrder = await applyAsaasPaymentToOrder(order, payment, "asaas_webhook");
    let subscription = null;

    if (updatedOrder.status === "approved" && !isPendingPaymentDiscordId(updatedOrder.discordId)) {
      const plan = await plans.findOne({ _id: order.planId });
      if (!plan) {
        await markPaymentEvent(insertedEvent._id, "failed", "Plano do pedido não encontrado.", order._id);
        throw httpError("Plano do pedido não encontrado.", 404);
      }
      subscription = await activatePaidOrderOnce(updatedOrder, plan, systemPaymentActor(), "asaas_webhook");
    } else if (updatedOrder.status === "approved") {
      await writePlanAudit(systemPaymentActor(), "payment_approved_waiting_discord_connection", "payment", order._id, {
        asaasPaymentId: payment.id,
        provider: "asaas"
      });
    } else if (eventType === "PAYMENT_OVERDUE" || updatedOrder.status === "expired") {
      subscription = await updateSubscriptionFromAsaasPaymentEvent(updatedOrder, "suspended", "asaas_payment_overdue");
    } else if (eventType === "PAYMENT_REFUNDED" || updatedOrder.status === "refunded") {
      subscription = await updateSubscriptionFromAsaasPaymentEvent(updatedOrder, "cancelled", "asaas_payment_refunded");
    }

    await markPaymentEvent(insertedEvent._id, "processed", `Asaas processado: ${payment.rawStatus}.`, order._id);
    await writePlanAudit(systemPaymentActor(), "asaas_webhook_processed", "payment", order._id, {
      asaasPaymentId: payment.id,
      paymentMethod: payment.method,
      status: payment.rawStatus
    });

    return {
      duplicate: false,
      event: mapPaymentEvent({ ...insertedEvent, orderId: order._id, paymentId: payment.id, processedAt: new Date(), result: `Asaas processado: ${payment.rawStatus}.`, status: "processed" }),
      order: toPaymentOrderDto(updatedOrder),
      processed: true,
      subscription
    };
  } catch (error) {
    if (!("statusCode" in Object(error))) {
      await markPaymentEvent(insertedEvent._id, "failed", error instanceof Error ? error.message : String(error));
    }
    throw error;
  }
}

async function applyAsaasPaymentToOrder(
  order: MongoPaymentOrder,
  payment: ProviderPayment,
  source: string
) {
  const { paymentOrders } = await getMongoCollections();
  const asaasConfig = getAsaasRuntimeConfig();

  if (payment.externalReference && payment.externalReference !== order.externalReference && payment.externalReference !== order._id) {
    throw httpError("Referencia do pagamento Asaas divergente.", 409);
  }
  if (order.provider !== "asaas") {
    throw httpError("Provider do pedido não é Asaas.", 409);
  }
  if (order.environment && order.environment !== asaasConfig.environment) {
    throw httpError("Ambiente da ordem Asaas divergente.", 409);
  }

  if (payment.amountInCents !== order.amountInCents || payment.currency !== order.currency) {
    await paymentOrders.updateOne(
      { _id: order._id },
      {
        $set: {
          notes: "Pagamento Asaas recusado por divergencia de valor ou moeda.",
          providerOrderId: payment.id ?? order.providerOrderId,
          rawProviderStatus: payment.rawStatus,
          status: "rejected",
          statusHistory: appendStatusHistory(order, "rejected", `${source}_amount_mismatch`),
          webhookSafeResponse: safeAsaasWebhookResponse(payment.raw),
          updatedAt: new Date()
        }
      }
    );
    throw httpError("Valor ou moeda divergente.", 409);
  }

  const nextStatus = providerStatusToOrderStatus(payment.status);
  const paidAt = nextStatus === "approved"
    ? order.paidAt ?? readAsaasPaidAt(payment.raw) ?? new Date()
    : order.paidAt ?? null;
  const update: Partial<MongoPaymentOrder> = {
    approvedAt: nextStatus === "approved" ? order.approvedAt ?? paidAt : order.approvedAt ?? null,
    cancelledAt: nextStatus === "cancelled" ? order.cancelledAt ?? new Date() : order.cancelledAt ?? null,
    paidAt,
    paymentMethod: payment.method,
    paymentType: payment.paymentType,
    providerOrderId: payment.id ?? order.providerOrderId,
    rawProviderStatus: payment.rawStatus,
    refundedAt: nextStatus === "refunded" ? order.refundedAt ?? new Date() : order.refundedAt ?? null,
    rejectedAt: nextStatus === "rejected" ? order.rejectedAt ?? new Date() : order.rejectedAt ?? null,
    status: nextStatus,
    statusDetail: payment.statusDetail,
    statusHistory: appendStatusHistory(order, nextStatus, source),
    webhookSafeResponse: safeAsaasWebhookResponse(payment.raw),
    updatedAt: new Date()
  };

  await paymentOrders.updateOne({ _id: order._id }, { $set: update });
  return (await paymentOrders.findOne({ _id: order._id })) ?? { ...order, ...update, status: nextStatus };
}

async function applyStripePaymentToOrder(
  order: MongoPaymentOrder,
  payment: ProviderPayment,
  source: string
) {
  const { paymentOrders } = await getMongoCollections();
  const stripeConfig = getStripeRuntimeConfig();
  const paymentEnvironment = typeof payment.raw.livemode === "boolean" ? payment.raw.livemode ? "production" : "test" : null;

  if (payment.externalReference !== order.externalReference || order.provider !== "stripe") {
    throw httpError("Referencia do pagamento Stripe divergente.", 409);
  }
  if (order.environment && order.environment !== stripeConfig.environment) {
    throw httpError("Ambiente da ordem Stripe divergente.", 409);
  }
  if (paymentEnvironment && paymentEnvironment !== stripeConfig.environment) {
    throw httpError("Ambiente do pagamento Stripe divergente.", 409);
  }

  if (payment.amountInCents !== order.amountInCents || payment.currency !== order.currency) {
    await paymentOrders.updateOne(
      { _id: order._id },
      {
        $set: {
          notes: "Pagamento Stripe recusado por divergencia de valor ou moeda.",
          providerOrderId: readString(payment.raw.id) ?? order.providerOrderId,
          rawProviderStatus: payment.rawStatus,
          status: "rejected",
          statusHistory: appendStatusHistory(order, "rejected", `${source}_amount_mismatch`),
          webhookSafeResponse: safeStripeWebhookResponse(payment.raw),
          updatedAt: new Date()
        }
      }
    );
    throw httpError("Valor ou moeda divergente.", 409);
  }

  const nextStatus = providerStatusToOrderStatus(payment.status);
  const update: Partial<MongoPaymentOrder> = {
    approvedAt: nextStatus === "approved" ? order.approvedAt ?? new Date() : order.approvedAt ?? null,
    cancelledAt: nextStatus === "cancelled" ? order.cancelledAt ?? new Date() : order.cancelledAt ?? null,
    paidAt: nextStatus === "approved" ? order.paidAt ?? new Date() : order.paidAt ?? null,
    paymentMethod: payment.method,
    paymentType: payment.paymentType,
    providerOrderId: readString(payment.raw.id) ?? order.providerOrderId,
    rawProviderStatus: payment.rawStatus,
    refundedAt: nextStatus === "refunded" ? order.refundedAt ?? new Date() : order.refundedAt ?? null,
    rejectedAt: nextStatus === "rejected" ? order.rejectedAt ?? new Date() : order.rejectedAt ?? null,
    status: nextStatus,
    statusDetail: payment.statusDetail,
    statusHistory: appendStatusHistory(order, nextStatus, source),
    webhookSafeResponse: safeStripeWebhookResponse(payment.raw),
    updatedAt: new Date()
  };

  await paymentOrders.updateOne({ _id: order._id }, { $set: update });
  return (await paymentOrders.findOne({ _id: order._id })) ?? { ...order, ...update, status: nextStatus };
}

async function applyOfficialPaymentToOrder(
  order: MongoPaymentOrder,
  plan: MongoPlan,
  payment: ProviderPayment,
  actor: PlanActor,
  source: string
) {
  const { paymentOrders } = await getMongoCollections();
  const mercadoPagoConfig = getMercadoPagoRuntimeConfig();
  const paymentEnvironment = typeof payment.raw.live_mode === "boolean" ? payment.raw.live_mode ? "production" : "test" : null;

  if (payment.externalReference !== order.externalReference || order.provider !== "mercadopago") {
    throw httpError("Referencia do pagamento divergente.", 409);
  }
  if (order.environment && order.environment !== mercadoPagoConfig.environment) {
    throw httpError("Ambiente da ordem divergente.", 409);
  }
  if (paymentEnvironment && paymentEnvironment !== mercadoPagoConfig.environment) {
    throw httpError("Ambiente do pagamento divergente.", 409);
  }
  if (payment.amountInCents !== order.amountInCents || payment.currency !== order.currency) {
    await paymentOrders.updateOne(
      { _id: order._id },
      {
        $set: {
          mercadoPagoPaymentId: payment.id,
          notes: "Pagamento Mercado Pago recusado por divergencia de valor ou moeda.",
          rawProviderStatus: payment.rawStatus,
          status: "rejected",
          statusHistory: appendStatusHistory(order, "rejected", `${source}_amount_mismatch`),
          webhookSafeResponse: safePaymentWebhookResponse(payment.raw),
          updatedAt: new Date()
        }
      }
    );
    throw httpError("Valor ou moeda divergente.", 409);
  }

  const nextStatus = providerStatusToOrderStatus(payment.status);
  const update: Partial<MongoPaymentOrder> = {
    approvedAt: nextStatus === "approved" ? order.approvedAt ?? new Date() : order.approvedAt ?? null,
    cancelledAt: nextStatus === "cancelled" ? order.cancelledAt ?? new Date() : order.cancelledAt ?? null,
    refundedAt: nextStatus === "refunded" ? order.refundedAt ?? new Date() : order.refundedAt ?? null,
    rejectedAt: nextStatus === "rejected" ? order.rejectedAt ?? new Date() : order.rejectedAt ?? null,
    merchantOrderId: readNestedString(payment.raw, ["order", "id"]),
    mercadoPagoPaymentId: payment.id,
    notes: `Status Mercado Pago confirmado: ${nextStatus}.`,
    paymentMethod: payment.method,
    paymentType: payment.paymentType,
    rawProviderStatus: payment.rawStatus,
    status: nextStatus,
    statusDetail: payment.statusDetail,
    statusHistory: appendStatusHistory(order, nextStatus, source),
    webhookSafeResponse: safePaymentWebhookResponse(payment.raw),
    updatedAt: new Date()
  };
  if (nextStatus === "approved") update.paidAt = order.paidAt ?? new Date();

  await paymentOrders.updateOne({ _id: order._id }, { $set: update });

  if (nextStatus === "approved") {
    await activatePaidOrderOnce({ ...order, ...update, status: nextStatus }, plan, actor, source);
  }

  return (await paymentOrders.findOne({ _id: order._id })) ?? { ...order, ...update, status: nextStatus };
}

function normalizeProviderOrderFromPagBankWebhook(payload: Record<string, unknown>): ProviderPixOrderResult {
  const qrCodes = Array.isArray(payload.qr_codes) ? payload.qr_codes : Array.isArray(payload.qr_code) ? payload.qr_code : [];
  const qrCode = isRecord(qrCodes[0]) ? qrCodes[0] : {};
  const charges = Array.isArray(payload.charges) ? payload.charges : [];
  const charge = isRecord(charges[0]) ? charges[0] : {};
  const rawStatus = readString(charge.status) ?? readString(payload.status) ?? "PENDING";
  const amount = readNestedNumber(qrCode, ["amount", "value"]) ?? readNestedNumber(charge, ["amount", "value"]) ?? 0;

  return {
    amountInCents: amount,
    currency: "BRL",
    externalReference: readString(payload.reference_id),
    orderId: readString(payload.id) ?? "",
    paymentId: readString(charge.id) ?? readString(qrCode.id),
    paymentMethod: qrCode.id ? "pix" : readNestedString(charge, ["payment_method", "type"]),
    paymentType: qrCode.id ? "pix" : readNestedString(charge, ["payment_method", "type"]),
    pixCode: readString(qrCode.text),
    qrCode: null,
    raw: payload,
    rawStatus,
    status: providerStatusToOrderStatus(rawStatusToProviderStatus(rawStatus)),
    statusDetail: readString(charge.status_detail)
  };
}

async function applyOfficialProviderOrderToOrder(
  order: MongoPaymentOrder,
  providerOrder: ProviderPixOrderResult,
  source: string
) {
  const { paymentOrders } = await getMongoCollections();

  if (providerOrder.externalReference !== order.externalReference) {
    throw httpError("Referencia da order divergente.", 409);
  }

  if (providerOrder.amountInCents > 0 && providerOrder.amountInCents !== order.amountInCents) {
    await paymentOrders.updateOne(
      { _id: order._id },
      {
        $set: {
          notes: "Order recusada por divergencia de valor.",
          providerOrderId: providerOrder.orderId,
          rawProviderStatus: providerOrder.rawStatus,
          status: "rejected",
          statusHistory: appendStatusHistory(order, "rejected", `${source}_amount_mismatch`),
          webhookSafeResponse: safeOrderWebhookResponse(providerOrder.raw),
          updatedAt: new Date()
        }
      }
    );
    throw httpError("Valor da order divergente.", 409);
  }

  if (providerOrder.currency && providerOrder.currency !== order.currency) {
    await paymentOrders.updateOne(
      { _id: order._id },
      {
        $set: {
          notes: "Order recusada por divergencia de moeda.",
          providerOrderId: providerOrder.orderId,
          rawProviderStatus: providerOrder.rawStatus,
          status: "rejected",
          statusHistory: appendStatusHistory(order, "rejected", `${source}_currency_mismatch`),
          webhookSafeResponse: safeOrderWebhookResponse(providerOrder.raw),
          updatedAt: new Date()
        }
      }
    );
    throw httpError("Moeda da order divergente.", 409);
  }

  const nextStatus = providerStatusToOrderStatus(rawStatusToProviderStatus(providerOrder.status));
  const update: Partial<MongoPaymentOrder> = {
    approvedAt: nextStatus === "approved" ? order.approvedAt ?? new Date() : order.approvedAt ?? null,
    cancelledAt: nextStatus === "cancelled" ? order.cancelledAt ?? new Date() : order.cancelledAt ?? null,
    paidAt: nextStatus === "approved" ? order.paidAt ?? new Date() : order.paidAt ?? null,
    paymentMethod: providerOrder.paymentMethod,
    paymentType: providerOrder.paymentType,
    pixCode: providerOrder.pixCode ?? order.pixCode,
    providerOrderId: providerOrder.orderId || order.providerOrderId,
    qrCode: providerOrder.qrCode ?? order.qrCode,
    rawProviderStatus: providerOrder.rawStatus,
    status: nextStatus,
    statusDetail: providerOrder.statusDetail,
    statusHistory: appendStatusHistory(order, nextStatus, source),
    webhookSafeResponse: safeOrderWebhookResponse(providerOrder.raw),
    updatedAt: new Date()
  };

  await paymentOrders.updateOne({ _id: order._id }, { $set: update });
  return (await paymentOrders.findOne({ _id: order._id })) ?? { ...order, ...update, status: nextStatus };
}

function rawStatusToProviderStatus(status: string) {
  const normalized = status.toLowerCase();
  if (["approved", "paid"].includes(normalized)) return "approved";
  if (["in_process", "processing", "authorized", "in_analysis"].includes(normalized)) return "in_process";
  if (["cancelled", "canceled"].includes(normalized)) return "cancelled";
  if (["expired"].includes(normalized)) return "expired";
  if (["rejected", "declined"].includes(normalized)) return "rejected";
  if (["refunded"].includes(normalized)) return "refunded";
  if (["chargeback", "charged_back"].includes(normalized)) return "chargeback";
  return "pending";
}

async function applyOfficialMercadoPagoOrderToOrder(
  order: MongoPaymentOrder,
  mercadoOrder: MercadoPagoPixOrderResult,
  source: string
) {
  const { paymentOrders } = await getMongoCollections();

  if (mercadoOrder.externalReference !== order.externalReference || order.provider !== "mercadopago") {
    throw httpError("Referencia da order divergente.", 409);
  }

  if (mercadoOrder.amountInCents > 0 && mercadoOrder.amountInCents !== order.amountInCents) {
    await paymentOrders.updateOne(
      { _id: order._id },
      {
        $set: {
          mercadoPagoPaymentId: mercadoOrder.paymentId,
          notes: "Order Mercado Pago recusada por divergencia de valor.",
          providerOrderId: mercadoOrder.orderId,
          rawProviderStatus: mercadoOrder.rawStatus,
          status: "rejected",
          statusHistory: appendStatusHistory(order, "rejected", `${source}_amount_mismatch`),
          webhookSafeResponse: safeOrderWebhookResponse(mercadoOrder.raw),
          updatedAt: new Date()
        }
      }
    );
    throw httpError("Valor da order divergente.", 409);
  }

  if (mercadoOrder.currency && mercadoOrder.currency !== order.currency) {
    await paymentOrders.updateOne(
      { _id: order._id },
      {
        $set: {
          mercadoPagoPaymentId: mercadoOrder.paymentId,
          notes: "Order Mercado Pago recusada por divergencia de moeda.",
          providerOrderId: mercadoOrder.orderId,
          rawProviderStatus: mercadoOrder.rawStatus,
          status: "rejected",
          statusHistory: appendStatusHistory(order, "rejected", `${source}_currency_mismatch`),
          webhookSafeResponse: safeOrderWebhookResponse(mercadoOrder.raw),
          updatedAt: new Date()
        }
      }
    );
    throw httpError("Moeda da order divergente.", 409);
  }

  const nextStatus = providerStatusToOrderStatus(mercadoOrder.status);
  const update: Partial<MongoPaymentOrder> = {
    approvedAt: nextStatus === "approved" ? order.approvedAt ?? new Date() : order.approvedAt ?? null,
    cancelledAt: nextStatus === "cancelled" ? order.cancelledAt ?? new Date() : order.cancelledAt ?? null,
    checkoutUrl: null,
    mercadoPagoPaymentId: mercadoOrder.paymentId,
    notes: `Status Order Mercado Pago confirmado: ${nextStatus}.`,
    paymentMethod: mercadoOrder.paymentMethod,
    paymentType: mercadoOrder.paymentType,
    pixCode: mercadoOrder.pixCode ?? order.pixCode,
    providerOrderId: mercadoOrder.orderId,
    qrCode: mercadoOrder.qrCode ?? order.qrCode,
    rawProviderStatus: mercadoOrder.rawStatus,
    refundedAt: nextStatus === "refunded" ? order.refundedAt ?? new Date() : order.refundedAt ?? null,
    rejectedAt: nextStatus === "rejected" ? order.rejectedAt ?? new Date() : order.rejectedAt ?? null,
    status: nextStatus,
    statusDetail: mercadoOrder.statusDetail,
    statusHistory: appendStatusHistory(order, nextStatus, source),
    webhookSafeResponse: safeOrderWebhookResponse(mercadoOrder.raw),
    updatedAt: new Date()
  };
  if (nextStatus === "approved") update.paidAt = order.paidAt ?? new Date();

  await paymentOrders.updateOne({ _id: order._id }, { $set: update });
  return (await paymentOrders.findOne({ _id: order._id })) ?? { ...order, ...update, status: nextStatus };
}

async function activatePaidOrder(order: MongoPaymentOrder, plan: MongoPlan, actor: PlanActor, activation: string) {
  const { planSubscriptions, planWorkspaces, workspaceMembers } = await getMongoCollections();
  const now = new Date();
  const existingSubscription = await planSubscriptions.findOne({
    "metadata.paymentOrderId": order._id
  } as Partial<MongoPlanSubscription>);
  const snapshot = order.planSnapshot;
  const botLimit = readSnapshotNumber(snapshot, "botLimit") ?? plan.botLimit;
  const guildLimit = readSnapshotNumber(snapshot, "guildLimit") ?? plan.guildLimit;
  const validityDays = readSnapshotNumber(snapshot, "validityDays") ?? plan.validityDays;
  const subscriptionId = existingSubscription?._id ?? randomUUID();
  const workspaceId = existingSubscription?.workspaceId ?? randomUUID();
  const workspaceName = `${readSnapshotString(snapshot, "name") ?? plan.name} Workspace`;

  if (!existingSubscription) {
    const workspace: MongoPlanWorkspace = {
      _id: workspaceId,
      botIds: [],
      createdAt: now,
      guildIds: [],
      name: workspaceName,
      ownerDiscordId: order.discordId,
      ownerUserId: order.userId || order.discordId,
      planId: plan._id,
      slug: await uniqueWorkspaceSlug(workspaceName),
      status: "active",
      subscriptionId,
      updatedAt: now
    };
    const subscription: MongoPlanSubscription = {
      _id: subscriptionId,
      activatedAt: now,
      activatedBy: actor.id,
      botLimit,
      cancelledAt: null,
      createdAt: now,
      discordId: order.discordId,
      endsAt: validityDays ? new Date(now.getTime() + validityDays * 86_400_000) : null,
      guildLimit,
      metadata: buildSubscriptionMetadata({ activation, paymentOrderId: order._id, plan, snapshot, now }),
      planId: plan._id,
      planSlug: plan.slug,
      startedAt: now,
      status: "active",
      suspendedAt: null,
      updatedAt: now,
      userId: order.userId || order.discordId,
      workspaceId
    };

    await planWorkspaces.insertOne(workspace);
    await planSubscriptions.insertOne(subscription);
    await workspaceMembers.updateOne(
      { workspaceId, discordId: order.discordId },
      {
        $setOnInsert: {
          _id: randomUUID(),
          createdAt: now,
          discordId: order.discordId,
          role: "owner",
          userId: order.userId || order.discordId,
          workspaceId
        },
        $set: { updatedAt: now }
      },
      { upsert: true }
    );
  } else {
    await planSubscriptions.updateOne({ _id: existingSubscription._id }, {
      $set: {
        activatedAt: existingSubscription.activatedAt ?? now,
        activatedBy: existingSubscription.activatedBy ?? actor.id,
        botLimit,
        cancelledAt: null,
        guildLimit,
        startedAt: existingSubscription.startedAt ?? now,
        status: "active",
        suspendedAt: null,
        updatedAt: now
      }
    });
    if (existingSubscription.workspaceId) {
      await planWorkspaces.updateOne({ _id: existingSubscription.workspaceId }, { $set: { status: "active", updatedAt: now } });
    }
  }

  await writePlanAudit(actor, "subscription_activated_by_payment", "subscription", subscriptionId, {
    activation,
    paymentOrderId: order._id,
    planSlug: plan.slug,
    workspaceId
  });

  const [updatedSubscription, workspace] = await Promise.all([
    planSubscriptions.findOne({ _id: subscriptionId }),
    planWorkspaces.findOne({ _id: workspaceId })
  ]);

  if (updatedSubscription) {
    await syncContractActivatedFromSubscription(updatedSubscription, order, plan, activation);
  }

  return updatedSubscription ? toSubscriptionDto(updatedSubscription, plan, workspace) : null;
}

async function activatePaidOrderOnce(order: MongoPaymentOrder, plan: MongoPlan, actor: PlanActor, activation: string) {
  const { paymentOrders, planSubscriptions, planWorkspaces } = await getMongoCollections();
  const now = new Date();
  const locked = await paymentOrders.findOneAndUpdate(
    { _id: order._id, accessActivated: { $ne: true } },
    {
      $set: {
        accessActivated: true,
        accessActivatedAt: now,
        updatedAt: now
      }
    },
    { returnDocument: "after" }
  );

  if (!locked) {
    const existingSubscription = await planSubscriptions.findOne({
      "metadata.paymentOrderId": order._id
    } as Partial<MongoPlanSubscription>);
    const workspace = existingSubscription?.workspaceId ? await planWorkspaces.findOne({ _id: existingSubscription.workspaceId }) : null;
    await writePlanAudit(actor, "payment_activation_already_processed", "payment", order._id, {
      activation,
      mercadoPagoPaymentId: order.mercadoPagoPaymentId ?? null
    });
    return existingSubscription ? toSubscriptionDto(existingSubscription, plan, workspace) : null;
  }

  try {
    const subscription = await activatePaidOrder(locked, plan, actor, activation);
    await writePlanAudit(actor, "payment_access_activated", "payment", order._id, {
      activation,
      mercadoPagoPaymentId: order.mercadoPagoPaymentId ?? null
    });
    return subscription;
  } catch (error) {
    await paymentOrders.updateOne(
      { _id: order._id },
      {
        $set: {
          accessActivated: false,
          accessActivatedAt: null,
          notes: "Falha ao ativar acesso após pagamento aprovado.",
          updatedAt: new Date()
        }
      }
    );
    throw error;
  }
}

async function updateSubscriptionFromAsaasPaymentEvent(
  order: MongoPaymentOrder,
  status: Extract<MongoPlanSubscriptionStatus, "cancelled" | "suspended">,
  auditAction: string
) {
  const { planSubscriptions, planWorkspaces, plans } = await getMongoCollections();
  const now = new Date();
  const subscription = await planSubscriptions.findOne({
    "metadata.paymentOrderId": order._id
  } as Partial<MongoPlanSubscription>);

  if (!subscription) {
    await writePlanAudit(systemPaymentActor(), `${auditAction}_subscription_not_found`, "payment", order._id, {
      provider: "asaas",
      providerOrderId: order.providerOrderId
    });
    return null;
  }

  const patch: Partial<MongoPlanSubscription> = {
    metadata: {
      ...(subscription.metadata ?? {}),
      lastAsaasPaymentEvent: auditAction,
      lastAsaasPaymentEventAt: now.toISOString(),
      paymentOrderId: order._id
    },
    status,
    updatedAt: now
  };
  if (status === "suspended") {
    patch.suspendedAt = subscription.suspendedAt ?? now;
  }
  if (status === "cancelled") {
    patch.cancelledAt = subscription.cancelledAt ?? now;
    patch.suspendedAt = null;
  }

  const updated = await planSubscriptions.findOneAndUpdate(
    { _id: subscription._id },
    { $set: patch },
    { returnDocument: "after" }
  );

  if (subscription.workspaceId) {
    await planWorkspaces.updateOne(
      { _id: subscription.workspaceId },
      { $set: { status: status === "suspended" ? "suspended" : "cancelled", updatedAt: now } }
    );
  }

  await writePlanAudit(systemPaymentActor(), auditAction, "subscription", subscription._id, {
    paymentOrderId: order._id,
    provider: "asaas",
    providerOrderId: order.providerOrderId
  });

  const [plan, workspace] = await Promise.all([
    plans.findOne({ _id: subscription.planId }),
    subscription.workspaceId ? planWorkspaces.findOne({ _id: subscription.workspaceId }) : null
  ]);
  return updated ? toSubscriptionDto(updated, plan, workspace) : null;
}

function snapshotPlan(plan: MongoPlan) {
  return {
    botLimit: plan.botLimit,
    billingCycle: plan.billingCycle,
    currency: plan.currency,
    description: plan.description,
    entitlements: plan.entitlements,
    guildLimit: plan.guildLimit,
    name: plan.name,
    planId: plan._id,
    priceInCents: plan.promotionalPriceInCents ?? plan.priceInCents,
    regularPriceInCents: plan.priceInCents,
    shortDescription: plan.shortDescription,
    slug: plan.slug,
    snapshotAt: new Date().toISOString(),
    validityDays: plan.validityDays
  };
}

function buildSubscriptionMetadata(input: {
  activation: string;
  now: Date;
  paymentOrderId?: string;
  plan: MongoPlan;
  snapshot?: Record<string, unknown>;
}) {
  const planSnapshot = input.snapshot ?? snapshotPlan(input.plan);
  const metadata: Record<string, unknown> = {
    activation: input.activation,
    planSnapshot
  };

  if (input.paymentOrderId) {
    metadata.paymentOrderId = input.paymentOrderId;
  }

  if (input.plan.billingCycle === "lifetime") {
    const hostingFreeUntil = new Date(input.now.getTime() + LIFETIME_HOSTING_FREE_DAYS * 86_400_000);
    metadata.license = {
      expiresAt: null,
      status: "active",
      support: "priority",
      type: "lifetime",
      updatesIncluded: true
    };
    metadata.hosting = {
      freeDays: LIFETIME_HOSTING_FREE_DAYS,
      freeUntil: hostingFreeUntil.toISOString(),
      monthlyPriceInCents: LIFETIME_HOSTING_MONTHLY_PRICE_IN_CENTS,
      nextDueAt: hostingFreeUntil.toISOString(),
      status: "active"
    };
  }

  return metadata;
}

async function markPaymentEvent(eventId: string, status: MongoPaymentEvent["status"], result: string, orderId: string | null = null) {
  const { paymentEvents } = await getMongoCollections();
  await paymentEvents.updateOne({ _id: eventId }, {
    $set: {
      lastError: status === "failed" ? cleanLogString(result) : null,
      orderId,
      processedAt: new Date(),
      result: cleanLogString(result),
      status
    }
  });
}

function mapPaymentEvent(event: MongoPaymentEvent) {
  return {
    ...event,
    id: event._id,
    createdAt: event.createdAt.toISOString(),
    processedAt: event.processedAt ? event.processedAt.toISOString() : null
  };
}

function readString(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNestedString(value: Record<string, unknown>, pathParts: string[]) {
  let current: unknown = value;
  for (const part of pathParts) {
    if (!isRecord(current)) return null;
    current = current[part];
  }
  return readString(current);
}

function readNestedNumber(value: Record<string, unknown>, pathParts: string[]) {
  let current: unknown = value;
  for (const part of pathParts) {
    if (!isRecord(current)) return null;
    current = current[part];
  }
  const numberValue = typeof current === "number" ? current : Number(current);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeCpfCnpj(value?: string | null) {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length === 11 || digits.length === 14 ? digits : null;
}

function readSnapshotNumber(snapshot: unknown, key: string) {
  if (!isRecord(snapshot)) return null;
  const value = snapshot[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readSnapshotString(snapshot: unknown, key: string) {
  if (!isRecord(snapshot)) return null;
  return readString(snapshot[key]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function systemPaymentActor(): PlanActor {
  return { id: "system:payments", name: "Gateway de Pagamentos" };
}

export async function setSubscriptionStatus(subscriptionId: string, status: Exclude<MongoPlanSubscriptionStatus, "pending" | "expired">, actor: PlanActor) {
  const { planSubscriptions, planWorkspaces } = await getMongoCollections();
  const now = new Date();
  const patch: Partial<MongoPlanSubscription> = {
    status,
    updatedAt: now
  };

  if (status === "active") {
    patch.suspendedAt = null;
    patch.cancelledAt = null;
  }
  if (status === "suspended") patch.suspendedAt = now;
  if (status === "cancelled") patch.cancelledAt = now;

  const updated = await planSubscriptions.findOneAndUpdate(
    { _id: subscriptionId },
    { $set: patch },
    { returnDocument: "after" }
  );
  if (!updated) throw httpError("Assinatura não encontrada.", 404);

  if (updated.workspaceId) {
    await planWorkspaces.updateOne(
      { _id: updated.workspaceId },
      { $set: { status: status === "active" ? "active" : status === "suspended" ? "suspended" : "cancelled", updatedAt: now } }
    );
  }

  await writePlanAudit(actor, `subscription_${status}`, "subscription", subscriptionId);
  const [planRows, workspace] = await Promise.all([getPlanRows(), updated.workspaceId ? planWorkspaces.findOne({ _id: updated.workspaceId }) : null]);
  return toSubscriptionDto(updated, planRows.find((plan) => plan._id === updated.planId) ?? null, workspace);
}

export async function extendSubscription(subscriptionId: string, days: number, actor: PlanActor) {
  const { planSubscriptions, planWorkspaces } = await getMongoCollections();
  const current = await planSubscriptions.findOne({ _id: subscriptionId });
  if (!current) throw httpError("Assinatura não encontrada.", 404);

  const now = new Date();
  const base = current.endsAt && current.endsAt > now ? current.endsAt : now;
  const endsAt = new Date(base.getTime() + days * 86_400_000);
  await planSubscriptions.updateOne({ _id: subscriptionId }, { $set: { endsAt, updatedAt: now } });
  await writePlanAudit(actor, "subscription_extended", "subscription", subscriptionId, { days });
  const updated = await planSubscriptions.findOne({ _id: subscriptionId });
  const planRows = await getPlanRows();
  const workspace = updated?.workspaceId ? await planWorkspaces.findOne({ _id: updated.workspaceId }) : null;
  return toSubscriptionDto(updated ?? current, planRows.find((plan) => plan._id === (updated ?? current).planId) ?? null, workspace);
}

export async function savePaymentSettings(input: SavePaymentSettingsInput, actor: PlanActor) {
  const { paymentSettings } = await getMongoCollections();
  const current = await ensurePaymentSettings();
  const now = new Date();
  const mercadoPagoConfig = getMercadoPagoRuntimeConfig();
  const pagBankConfig = getPagBankRuntimeConfig();
  const stripeConfig = getStripeRuntimeConfig();
  const requestedProvider = normalizePaymentProviderInput(input.provider ?? current.provider);
  const patch: Partial<MongoPaymentSettings> = {
    approvedRedirectUrl: input.approvedRedirectUrl === undefined ? current.approvedRedirectUrl ?? null : normalizeValidUrl(input.approvedRedirectUrl, "URL de pagamento aprovado"),
    botDashboardBaseUrl: input.botDashboardBaseUrl === undefined ? current.botDashboardBaseUrl ?? null : normalizeValidUrl(input.botDashboardBaseUrl, "URL base das dashboards"),
    botRegistrationUrl: input.botRegistrationUrl === undefined ? current.botRegistrationUrl ?? null : normalizeValidUrl(input.botRegistrationUrl, "URL de cadastro do bot"),
    cancelRedirectUrl: input.cancelRedirectUrl === undefined ? current.cancelRedirectUrl ?? null : normalizeValidUrl(input.cancelRedirectUrl, "URL de cancelamento"),
    enabled: isResolvedPaymentProviderEnabled(requestedProvider, mercadoPagoConfig),
    failureRedirectUrl: input.failureRedirectUrl === undefined ? current.failureRedirectUrl ?? null : normalizeValidUrl(input.failureRedirectUrl, "URL de pagamento recusado"),
    pendingRedirectUrl: input.pendingRedirectUrl === undefined ? current.pendingRedirectUrl ?? null : normalizeValidUrl(input.pendingRedirectUrl, "URL de pagamento pendente"),
    plansPublicUrl: input.plansPublicUrl === undefined ? current.plansPublicUrl ?? null : normalizeValidUrl(input.plansPublicUrl, "URL publica de planos"),
    provider: requestedProvider,
    publicKey: requestedProvider === "pagbank"
      ? pagBankConfig.publicKey
      : requestedProvider === "stripe"
        ? stripeConfig.publishableKey
        : mercadoPagoConfig.publicKey,
    successRedirectUrl: input.successRedirectUrl === undefined ? current.successRedirectUrl ?? null : normalizeValidUrl(input.successRedirectUrl, "URL de redirecionamento após pagamento"),
    supportDiscordUrl: input.supportDiscordUrl === undefined ? current.supportDiscordUrl ?? null : normalizeValidUrl(input.supportDiscordUrl, "URL do Discord de suporte"),
    updatedAt: now,
    updatedBy: actor.id
  };

  if (input.publicKey && input.publicKey.trim()) {
    throw httpError("Public key do gateway deve ser configurada somente por variavel de ambiente.", 400);
  }

  if (input.secret && input.secret.trim()) {
    throw httpError("Credenciais do gateway devem ser configuradas somente por variaveis de ambiente.", 400);
  }

  if (input.webhookSecret && input.webhookSecret.trim()) {
    throw httpError("Webhook secret do gateway deve ser configurado somente por variavel de ambiente.", 400);
  }

  await paymentSettings.updateOne({ _id: "global" }, { $set: patch }, { upsert: true });
  await writePlanAudit(actor, "payment_settings_updated", "settings", "global", {
    enabled: patch.enabled,
    provider: patch.provider
  });

  return toPaymentSettingsDto((await ensurePaymentSettings()));
}

function normalizePaymentProviderInput(provider: MongoPaymentProvider) {
  if (provider === "mercadopago" || provider === "pagbank" || provider === "stripe") {
    return provider;
  }
  return resolveEnvPaymentProvider();
}

async function ensurePaymentSettings(): Promise<MongoPaymentSettings> {
  const { paymentSettings } = await getMongoCollections();
  const existing = await paymentSettings.findOne({ _id: "global" });

  if (existing) {
    return existing;
  }

  const now = new Date();
  const mercadoPagoConfig = getMercadoPagoRuntimeConfig();
  const pagBankConfig = getPagBankRuntimeConfig();
  const stripeConfig = getStripeRuntimeConfig();
  const envProvider = resolveEnvPaymentProvider();
  const settings: MongoPaymentSettings = {
    _id: "global",
    approvedRedirectUrl: env.MERCADOPAGO_SUCCESS_URL || buildAppUrl("/pagamento/sucesso"),
    botDashboardBaseUrl: buildAppUrl("/dashboard/"),
    botRegistrationUrl: buildAppUrl("/cadastrar-bot"),
    cancelRedirectUrl: buildAppUrl("/pagamento/falha"),
    enabled: isResolvedPaymentProviderEnabled(envProvider, mercadoPagoConfig),
    failureRedirectUrl: env.MERCADOPAGO_FAILURE_URL || buildAppUrl("/pagamento/falha"),
    pendingRedirectUrl: env.MERCADOPAGO_PENDING_URL || buildAppUrl("/pagamento/pendente"),
    plansPublicUrl: buildAppUrl("/planos"),
    provider: envProvider,
    publicKey: envProvider === "pagbank"
      ? pagBankConfig.publicKey
      : envProvider === "stripe"
        ? stripeConfig.publishableKey
        : envProvider === "asaas"
          ? null
          : mercadoPagoConfig.publicKey,
    secretEncrypted: null,
    successRedirectUrl: env.MERCADOPAGO_SUCCESS_URL || buildAppUrl("/pagamento/sucesso"),
    supportDiscordUrl: null,
    updatedAt: now,
    updatedBy: null,
    webhookSecretEncrypted: null
  };

  await paymentSettings.updateOne({ _id: "global" }, { $setOnInsert: settings }, { upsert: true });
  return settings;
}

async function createPlanPayment(
  plan: MongoPlan,
  order: MongoPaymentOrder,
  buyer: CheckoutBuyer,
  paymentMethod: CheckoutPaymentMethod
): Promise<PlanPaymentCreationResult> {
  const method = checkoutMethodToPaymentMethod(paymentMethod);
  if (method === PAYMENT_METHODS.PIX && order.provider !== "asaas") {
    throw httpError("Provider Pix deve ser Asaas.", 400);
  }
  if (method !== PAYMENT_METHODS.PIX && order.provider !== "stripe") {
    throw httpError("Provider de cartão deve ser Stripe.", 400);
  }

  const settings = await ensurePaymentSettings();
  const service = new PaymentService();
  const payment = await service.createPayment({
    amountInCents: order.amountInCents,
    cancelUrl: settings.cancelRedirectUrl ?? settings.failureRedirectUrl ?? getStripeRuntimeConfig().cancelUrl ?? buildAppUrl("/pagamento/falha"),
    currency: plan.currency,
    description: plan.shortDescription || plan.description || plan.name,
    expiresAt: order.expiresAt ?? null,
    idempotencyKey: order.idempotencyKey,
    itemId: plan._id,
    itemTitle: plan.name,
    metadata: {
      business: "nextech",
      cpf_cnpj_present: Boolean(buyer.cpfCnpj),
      discord_id: buyer.discordId,
      payment_order_id: order._id,
      payment_method: method,
      plan_id: plan._id,
      plan_slug: plan.slug
    },
    method,
    notificationUrl: method === PAYMENT_METHODS.PIX
      ? getAsaasRuntimeConfig().webhookUrl || buildAppUrl("/api/payments/asaas/webhook")
      : getStripeRuntimeConfig().webhookUrl || buildAppUrl("/api/payments/stripe/webhook"),
    orderId: order._id,
    payer: buyer,
    successUrl: method === PAYMENT_METHODS.PIX
      ? settings.approvedRedirectUrl ?? settings.successRedirectUrl ?? buildAppUrl(`/pagamento/sucesso?external_reference=${encodeURIComponent(order._id)}`)
      : stripeSuccessUrl(settings.approvedRedirectUrl ?? settings.successRedirectUrl ?? getStripeRuntimeConfig().successUrl ?? buildAppUrl("/pagamento/sucesso"))
  });

  return {
    checkoutUrl: payment.checkoutUrl,
    mercadoPagoPaymentId: null,
    notes: payment.notes,
    paymentMethod: payment.paymentMethod,
    paymentType: payment.paymentType,
    pixCode: payment.pixCode,
    pixExpiresAt: payment.pixExpiresAt,
    providerOrderId: payment.providerOrderId,
    qrCode: payment.qrCode,
    rawProviderStatus: payment.rawProviderStatus,
    sandboxCheckoutUrl: payment.sandboxCheckoutUrl,
    statusDetail: payment.statusDetail,
    statusSource: payment.statusSource
  };
}

async function createMercadoPagoPlanCheckoutPreference(
  plan: MongoPlan,
  order: MongoPaymentOrder,
  buyer: CheckoutBuyer,
  paymentMethod: CheckoutPaymentMethod = "checkout"
) {
  if (order.provider !== "mercadopago") {
    throw httpError("Provider de pagamento não suportado para checkout automático.", 400);
  }
  const mercadoPagoConfig = requireMercadoPagoOperational();
  const provider = new MercadoPagoPaymentProvider(requireMercadoPagoAccessToken(mercadoPagoConfig), mercadoPagoConfig.webhookSecret);
  const settings = await ensurePaymentSettings();
  return provider.createOneTimeCheckout({
    autoReturn: "approved",
    backUrls: {
      failure: settings.failureRedirectUrl ?? buildAppUrl("/pagamento/falha"),
      pending: settings.pendingRedirectUrl ?? buildAppUrl("/pagamento/pendente"),
      success: settings.approvedRedirectUrl ?? settings.successRedirectUrl ?? buildAppUrl("/pagamento/sucesso")
    },
    binaryMode: false,
    dateOfExpiration: order.expiresAt ?? null,
    defaultPaymentMethodId: paymentMethod === "checkout" ? "pix" : null,
    environment: mercadoPagoConfig.environment,
    excludedPaymentTypes: paymentMethod === "pix" ? ["credit_card", "debit_card", "ticket", "atm"] : undefined,
    externalReference: order._id,
    idempotencyKey: order.idempotencyKey,
    items: [{
      currencyId: plan.currency,
      description: plan.shortDescription || plan.description || plan.name,
      id: plan._id,
      quantity: 1,
      title: plan.name,
      unitPriceInCents: order.amountInCents
    }],
    maxInstallments: mercadoPagoConfig.maxInstallments,
    metadata: {
      payment_order_id: order._id,
      plan_id: plan._id,
      plan_slug: plan.slug,
      source: paymentMethod === "pix" ? "plans_pix_preference" : "plans_checkout_pix_card"
    },
    notificationUrl: mercadoPagoConfig.webhookUrl || buildAppUrl("/api/payments/mercadopago/webhook"),
    payerEmail: mercadoPagoPayerEmail(buyer),
    statementDescriptor: mercadoPagoConfig.statementDescriptor
  });
}

type PlanPaymentCreationResult = {
  checkoutUrl: string | null;
  mercadoPagoPaymentId: string | null;
  notes: string;
  paymentMethod: string | null;
  paymentType: string | null;
  pixCode: string | null;
  pixExpiresAt: string | null;
  providerOrderId: string | null;
  qrCode: string | null;
  rawProviderStatus: string | null;
  sandboxCheckoutUrl: string | null;
  statusDetail: string | null;
  statusSource: string;
};

async function createPagBankPlanPayment(
  plan: MongoPlan,
  order: MongoPaymentOrder,
  buyer: CheckoutBuyer,
  paymentMethod: CheckoutPaymentMethod
): Promise<PlanPaymentCreationResult> {
  if (order.provider !== "pagbank") {
    throw httpError("Provider de pagamento não suportado para PagBank.", 400);
  }

  const activeGateway = await resolveActivePaymentManager({ provider: "pagbank" });
  const provider = (activeGateway as { manager: PaymentManager }).manager.getProvider();
  const settings = await ensurePaymentSettings();
  const notificationUrl = activeGateway.pagBankConfig.webhookUrl || buildAppUrl("/api/payments/pagbank/webhook");

  if (paymentMethod === "pix") {
    const pix = await provider.createPixOrder({
      amountInCents: order.amountInCents,
      currencyId: plan.currency,
      description: plan.shortDescription || plan.description || plan.name,
      externalReference: order._id,
      idempotencyKey: order.idempotencyKey,
      itemId: plan._id,
      itemTitle: plan.name,
      notificationUrl,
      payerEmail: mercadoPagoPayerEmail(buyer),
      paymentExpiration: order.expiresAt ?? null
    });

    return {
      checkoutUrl: null,
      mercadoPagoPaymentId: null,
      notes: "Pagamento Pix criado no PagBank. Exiba QR Code ou código copia e cola.",
      paymentMethod: pix.paymentMethod ?? "pix",
      paymentType: pix.paymentType ?? "pix",
      pixCode: pix.pixCode,
      pixExpiresAt: order.expiresAt?.toISOString() ?? null,
      providerOrderId: pix.orderId,
      qrCode: pix.qrCode,
      rawProviderStatus: pix.rawStatus,
      sandboxCheckoutUrl: null,
      statusDetail: pix.statusDetail,
      statusSource: "pagbank_pix_created"
    };
  }

  const checkout = await provider.createOneTimeCheckout({
    amountInCents: order.amountInCents,
    currencyId: plan.currency,
    description: plan.shortDescription || plan.description || plan.name,
    externalReference: order._id,
    idempotencyKey: order.idempotencyKey,
    itemId: plan._id,
    itemTitle: plan.name,
    notificationUrl,
    payerEmail: mercadoPagoPayerEmail(buyer),
    paymentExpiration: order.expiresAt ?? null,
    returnUrl: settings.plansPublicUrl ?? buildAppUrl("/planos"),
    successUrl: settings.approvedRedirectUrl ?? settings.successRedirectUrl ?? buildAppUrl("/pagamento/sucesso")
  });

  return {
    checkoutUrl: checkout.checkoutUrl,
    mercadoPagoPaymentId: null,
    notes: "Checkout PagBank criado com Pix e cartão. Redirecione o comprador para o checkout.",
    paymentMethod: null,
    paymentType: null,
    pixCode: null,
    pixExpiresAt: null,
    providerOrderId: checkout.preferenceId,
    qrCode: null,
    rawProviderStatus: "checkout_created",
    sandboxCheckoutUrl: checkout.sandboxCheckoutUrl,
    statusDetail: null,
    statusSource: "pagbank_checkout_created"
  };
}

async function createStripePlanPayment(
  plan: MongoPlan,
  order: MongoPaymentOrder,
  buyer: CheckoutBuyer,
  paymentMethod: CheckoutPaymentMethod
): Promise<PlanPaymentCreationResult> {
  if (order.provider !== "stripe") {
    throw httpError("Provider de pagamento não suportado para Stripe.", 400);
  }

  const stripeConfig = requireStripeOperational();
  const settings = await ensurePaymentSettings();
  const checkout = await createStripeCheckout(stripeConfig, {
    amountInCents: order.amountInCents,
    cancelUrl: settings.cancelRedirectUrl ?? settings.failureRedirectUrl ?? stripeConfig.cancelUrl ?? buildAppUrl("/pagamento/falha"),
    currencyId: plan.currency,
    description: plan.shortDescription || plan.description || plan.name,
    externalReference: order._id,
    idempotencyKey: order.idempotencyKey,
    itemId: plan._id,
    itemTitle: plan.name,
    metadata: {
      business: "nextech",
      discord_id: buyer.discordId,
      payment_order_id: order._id,
      plan_id: plan._id,
      plan_slug: plan.slug
    },
    notificationUrl: stripeConfig.webhookUrl || buildAppUrl("/api/payments/stripe/webhook"),
    payerEmail: mercadoPagoPayerEmail(buyer),
    paymentExpiration: order.expiresAt ?? null,
    paymentMethodPreference: paymentMethod === "pix" ? "pix" : "card",
    successUrl: stripeSuccessUrl(settings.approvedRedirectUrl ?? settings.successRedirectUrl ?? stripeConfig.successUrl ?? buildAppUrl("/pagamento/sucesso"))
  });

  return {
    checkoutUrl: checkout.checkoutUrl,
    mercadoPagoPaymentId: null,
    notes: stripeConfig.automaticTaxEnabled
      ? "Checkout Stripe criado com invoice e cálculo automatico de impostos. Redirecione o comprador para o checkout."
      : "Checkout Stripe criado com invoice. Redirecione o comprador para o checkout.",
    paymentMethod: paymentMethod === "pix" ? "pix" : "card",
    paymentType: paymentMethod === "pix" ? "pix" : "card",
    pixCode: null,
    pixExpiresAt: null,
    providerOrderId: checkout.preferenceId,
    qrCode: null,
    rawProviderStatus: checkout.rawStatus,
    sandboxCheckoutUrl: checkout.sandboxCheckoutUrl,
    statusDetail: null,
    statusSource: "stripe_checkout_created"
  };
}

async function createMercadoPagoPlanPayment(
  plan: MongoPlan,
  order: MongoPaymentOrder,
  buyer: CheckoutBuyer,
  paymentMethod: CheckoutPaymentMethod
): Promise<PlanPaymentCreationResult> {
  if (paymentMethod === "pix") {
    try {
      const pix = await createMercadoPagoPlanPixPayment(plan, order, buyer);
      return {
        checkoutUrl: null,
        mercadoPagoPaymentId: pix.paymentId,
        notes: "Pagamento Pix criado no Mercado Pago. Exiba QR Code ou código copia e cola.",
        paymentMethod: pix.paymentMethod ?? "pix",
        paymentType: pix.paymentType ?? "bank_transfer",
        pixCode: pix.pixCode,
        pixExpiresAt: order.expiresAt?.toISOString() ?? null,
        providerOrderId: null,
        qrCode: pix.qrCode,
        rawProviderStatus: pix.rawStatus,
        sandboxCheckoutUrl: null,
        statusDetail: pix.statusDetail,
        statusSource: "mercadopago_pix_created"
      };
    } catch (error) {
      if (!isMercadoPagoLiveCredentialRestriction(error)) throw error;
      console.warn("[payments] Mercado Pago Pix direto bloqueado; usando preference Pix", {
        error: cleanLogString(error instanceof Error ? error.message : String(error)),
        orderId: order._id,
        planId: plan._id,
        timestamp: new Date().toISOString()
      });
      const preference = await createMercadoPagoPlanCheckoutPreference(plan, order, buyer, "pix");
      return {
        checkoutUrl: preference.checkoutUrl,
        mercadoPagoPaymentId: null,
        notes: "Preference Pix Mercado Pago criada. Redirecione o comprador para o checkout Pix.",
        paymentMethod: "pix",
        paymentType: "bank_transfer",
        pixCode: null,
        pixExpiresAt: null,
        providerOrderId: preference.preferenceId,
        qrCode: null,
        rawProviderStatus: "preference_created",
        sandboxCheckoutUrl: preference.sandboxCheckoutUrl,
        statusDetail: "pix_preference_fallback",
        statusSource: "mercadopago_pix_preference_created"
      };
    }
  }

  const preference = await createMercadoPagoPlanCheckoutPreference(plan, order, buyer, "checkout");
  return {
    checkoutUrl: preference.checkoutUrl,
    mercadoPagoPaymentId: null,
    notes: "Preference Mercado Pago criada com Pix e cartão. Redirecione o comprador para o checkout.",
    paymentMethod: null,
    paymentType: null,
    pixCode: null,
    pixExpiresAt: null,
    providerOrderId: preference.preferenceId,
    qrCode: null,
    rawProviderStatus: "preference_created",
    sandboxCheckoutUrl: preference.sandboxCheckoutUrl,
    statusDetail: null,
    statusSource: "mercadopago_preference_created"
  };
}

function isMercadoPagoLiveCredentialRestriction(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return normalized.includes("unauthorized use of live credentials")
    || (normalized.includes("code 7") && normalized.includes("status 401"));
}

async function createMercadoPagoPlanPixPayment(
  plan: MongoPlan,
  order: MongoPaymentOrder,
  buyer: CheckoutBuyer
) {
  if (order.provider !== "mercadopago") {
    throw httpError("Provider de pagamento não suportado para Pix automático.", 400);
  }
  const mercadoPagoConfig = requireMercadoPagoOperational();
  const provider = new MercadoPagoPaymentProvider(requireMercadoPagoAccessToken(mercadoPagoConfig), mercadoPagoConfig.webhookSecret);
  return provider.createPixPayment({
    amountInCents: order.amountInCents,
    currencyId: plan.currency,
    description: plan.shortDescription || plan.description || plan.name,
    externalReference: order._id,
    idempotencyKey: order.idempotencyKey,
    itemId: plan._id,
    itemTitle: plan.name,
    metadata: {
      payment_order_id: order._id,
      plan_id: plan._id,
      plan_slug: plan.slug,
      source: "plans_pix"
    },
    notificationUrl: mercadoPagoConfig.webhookUrl || buildAppUrl("/api/payments/mercadopago/webhook"),
    payerEmail: mercadoPagoPayerEmail(buyer),
    paymentExpiration: order.expiresAt ?? null,
    statementDescriptor: mercadoPagoConfig.statementDescriptor
  });
}

function mercadoPagoPayerEmail(buyer: CheckoutBuyer) {
  const email = buyer.email?.trim();
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return email;
  }

  const normalizedId = buyer.discordId.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
  return `checkout-${normalizedId}@nextech.discloud.app`;
}

function stripeSuccessUrl(url: string) {
  if (url.includes("{CHECKOUT_SESSION_ID}")) {
    return url;
  }
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}provider=stripe&session_id={CHECKOUT_SESSION_ID}`;
}

async function assertWorkspaceAccess(workspaceId: string, auth: DashboardAuth) {
  const { planWorkspaces, workspaceMembers } = await getMongoCollections();
  const workspace = await planWorkspaces.findOne({ _id: workspaceId });

  if (!workspace) {
    throw httpError("Workspace não encontrado.", 404);
  }

  if (workspace.ownerDiscordId === auth.user.discordId) {
    return { role: "owner" as const, workspace };
  }

  const member = await workspaceMembers.findOne({ workspaceId, discordId: auth.user.discordId });
  if (!member) {
    throw httpError("Sem permissão para acessar este workspace.", 403);
  }

  return { role: member.role, workspace };
}

async function getPlanRows() {
  const { plans } = await getMongoCollections();
  return plans.find({}).toArray();
}

async function uniquePlanSlug(base: string) {
  const { plans } = await getMongoCollections();
  let slug = slugify(base) || "plano";
  let suffix = 2;
  while (await plans.findOne({ slug }, { projection: { _id: 1 } })) {
    slug = `${slugify(base)}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

async function uniqueWorkspaceSlug(base: string) {
  const { planWorkspaces } = await getMongoCollections();
  let slug = slugify(base) || "workspace";
  let suffix = 2;
  while (await planWorkspaces.findOne({ slug }, { projection: { _id: 1 } })) {
    slug = `${slugify(base)}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

function buildPlanDocument(input: SavePlanInput, actorId: string | null, now: Date): MongoPlan {
  const slug = slugify(input.slug || input.name);
  return {
    _id: randomUUID(),
    badge: normalizeNullable(input.badge),
    billingCycle: input.billingCycle ?? "monthly",
    botLimit: input.botLimit ?? 1,
    buttonText: trimText(input.buttonText || "Tenho interesse", 40),
    color: normalizeColor(input.color),
    createdAt: now,
    createdBy: actorId,
    currency: input.currency ?? "BRL",
    description: trimText(input.description || "", 4000),
    entitlements: normalizeEntitlements(input.entitlements ?? []),
    guildLimit: input.guildLimit ?? 1,
    icon: normalizeNullable(input.icon),
    imageUrl: normalizeNullable(input.imageUrl),
    isActive: input.isActive ?? true,
    isPublic: input.isPublic ?? true,
    isPurchasable: input.isPurchasable ?? false,
    isRecommended: input.isRecommended ?? false,
    name: trimText(input.name, 120),
    order: input.order ?? 0,
    priceInCents: input.priceInCents ?? 0,
    promotionalPriceInCents: input.promotionalPriceInCents ?? null,
    shortDescription: trimText(input.shortDescription || "", 300),
    slug,
    updatedAt: now,
    updatedBy: actorId,
    validityDays: input.validityDays ?? null
  };
}

function buildPlanPatch(input: SavePlanInput, current: MongoPlan): Omit<Partial<MongoPlan>, "slug" | "updatedAt" | "updatedBy"> {
  return {
    badge: input.badge === undefined ? current.badge : normalizeNullable(input.badge),
    billingCycle: input.billingCycle ?? current.billingCycle,
    botLimit: input.botLimit ?? current.botLimit,
    buttonText: input.buttonText === undefined ? current.buttonText : trimText(input.buttonText, 40),
    color: input.color === undefined ? current.color : normalizeColor(input.color),
    currency: input.currency ?? current.currency,
    description: input.description === undefined ? current.description : trimText(input.description, 4000),
    entitlements: input.entitlements === undefined ? current.entitlements : normalizeEntitlements(input.entitlements),
    guildLimit: input.guildLimit ?? current.guildLimit,
    icon: input.icon === undefined ? current.icon : normalizeNullable(input.icon),
    imageUrl: input.imageUrl === undefined ? current.imageUrl : normalizeNullable(input.imageUrl),
    isActive: input.isActive ?? current.isActive,
    isPublic: input.isPublic ?? current.isPublic,
    isPurchasable: input.isPurchasable ?? current.isPurchasable,
    isRecommended: input.isRecommended ?? current.isRecommended,
    name: trimText(input.name || current.name, 120),
    order: input.order ?? current.order,
    priceInCents: input.priceInCents ?? current.priceInCents,
    promotionalPriceInCents: input.promotionalPriceInCents === undefined ? current.promotionalPriceInCents : input.promotionalPriceInCents,
    shortDescription: input.shortDescription === undefined ? current.shortDescription : trimText(input.shortDescription, 300),
    validityDays: input.validityDays === undefined ? current.validityDays : input.validityDays
  };
}

async function writePlanAudit(actor: PlanActor, action: string, targetType: MongoPlanAuditLog["targetType"], targetId: string | null, metadata?: Record<string, unknown>) {
  const { planAuditLogs } = await getMongoCollections();
  await planAuditLogs.insertOne({
    _id: randomUUID(),
    action: cleanLogString(action),
    actorId: actor.id,
    actorName: actor.name ? cleanLogString(actor.name) : null,
    createdAt: new Date(),
    ip: actor.ip ? cleanLogString(actor.ip) : null,
    metadata: metadata ? cleanMetadata(metadata) : undefined,
    targetId,
    targetType,
    userAgent: actor.userAgent ? cleanLogString(actor.userAgent) : null
  });
}

function encryptBotToken(token: string) {
  const dataKey = randomBytes(32);
  const tokenIv = randomBytes(12);
  const tokenCipher = createCipheriv("aes-256-gcm", dataKey, tokenIv);
  const tokenCiphertext = Buffer.concat([tokenCipher.update(token, "utf8"), tokenCipher.final()]);
  const tokenAuthTag = tokenCipher.getAuthTag();
  const wrapIv = randomBytes(12);
  const wrapCipher = createCipheriv("aes-256-gcm", planMasterKey(), wrapIv);
  const encryptedDataKey = Buffer.concat([wrapCipher.update(dataKey), wrapCipher.final()]);
  const wrapAuthTag = wrapCipher.getAuthTag();

  return {
    authTag: tokenAuthTag.toString("base64url"),
    encryptedDataKey: [
      env.PLAN_TOKEN_KEY_VERSION || "v1",
      wrapIv.toString("base64url"),
      wrapAuthTag.toString("base64url"),
      encryptedDataKey.toString("base64url")
    ].join("."),
    iv: tokenIv.toString("base64url"),
    keyVersion: env.PLAN_TOKEN_KEY_VERSION || "v1",
    tokenCiphertext: tokenCiphertext.toString("base64url"),
    tokenFingerprint: createHmac("sha256", planFingerprintKey()).update(token).digest("hex")
  };
}

function planMasterKey() {
  return createHash("sha256").update(env.PLAN_TOKEN_ENCRYPTION_KEY || `${env.JWT_SECRET}:plan-token`).digest();
}

function planFingerprintKey() {
  return createHash("sha256").update(env.PLAN_TOKEN_FINGERPRINT_KEY || `${env.JWT_SECRET}:plan-token-fingerprint`).digest();
}

function entitlementsFor(keys: string[]) {
  return keys.map((key) => ({
    enabled: true,
    key,
    limit: null,
    unit: null
  }));
}

function normalizeEntitlements(entitlements: MongoPlanEntitlement[]) {
  return entitlements
    .filter((item) => item?.key)
    .map((item) => ({
      enabled: item.enabled !== false,
      key: normalizeFeatureKey(item.key),
      limit: typeof item.limit === "number" && Number.isFinite(item.limit) ? Math.max(0, Math.floor(item.limit)) : null,
      metadata: item.metadata,
      unit: normalizeNullable(item.unit)
    }));
}

function normalizeFeatureKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120);
}

function normalizeColor(value?: string | null) {
  const color = value?.trim();
  return color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : "#FFD500";
}

function normalizeNullable(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeValidUrl(value: string | null | undefined, label: string) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("invalid protocol");
    }
    return url.toString();
  } catch {
    throw httpError(`${label} inválida.`, 400);
  }
}

async function uniqueBotDashboardSlug(base: string) {
  const { botCredentials, devBots } = await getMongoCollections();
  const reserved = new Set(["admin", "dev", "api", "login", "auth", "dashboard", "planos", "plans", "config", "cadastrar-bot"]);
  const normalizedBase = slugifyBot(base) || "bot";
  let slug = reserved.has(normalizedBase) ? `${normalizedBase}-bot` : normalizedBase;
  let suffix = 2;
  while (
    reserved.has(slug)
    || await botCredentials.findOne({ slug }, { projection: { _id: 1 } })
    || await devBots.findOne({ slug }, { projection: { _id: 1 } })
  ) {
    slug = `${normalizedBase}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

function slugifyBot(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80);
}

function dashboardUrlForSlug(slug: string) {
  return buildAppUrl(`/dashboard/${encodeURIComponent(slug)}`);
}

function tokenPrefix(token: string) {
  return token.trim().slice(0, 6);
}

function tokenLast4(token: string) {
  return token.trim().slice(-4);
}

async function verifyDiscordBotRegistration(token: string, guildId: string, userAccessToken: string, userDiscordId: string) {
  const normalizedToken = token.trim().replace(/^Bot\s+/i, "");
  const normalizedGuildId = guildId.trim();
  if (!/^\d{5,32}$/.test(normalizedGuildId)) throw httpError("ID do servidor inválido.", 400);

  const botHeaders = { Authorization: `Bot ${normalizedToken}` };
  const userHeaders = { Authorization: `Bearer ${userAccessToken}` };

  const [botUserResponse, guildResponse, userGuildsResponse] = await Promise.all([
    fetch("https://discord.com/api/v10/users/@me", { headers: botHeaders }),
    fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(normalizedGuildId)}?with_counts=true`, { headers: botHeaders }),
    fetch("https://discord.com/api/v10/users/@me/guilds", { headers: userHeaders })
  ]);

  if (botUserResponse.status === 401) throw httpError("Token do bot inválido.", 400);
  if (!botUserResponse.ok) throw httpError("Falha ao validar o token do bot no Discord.", 502);
  if (guildResponse.status === 404 || guildResponse.status === 403) throw httpError("Bot não está no servidor informado ou não possui acesso.", 400);
  if (!guildResponse.ok) throw httpError("Falha ao validar o servidor no Discord.", 502);
  if (!userGuildsResponse.ok) throw httpError("Não foi possível confirmar os servidores do usuário autenticado.", 403);

  const botUser = await botUserResponse.json() as { avatar?: string | null; bot?: boolean; id?: string; username?: string };
  if (!botUser.bot || !botUser.id) throw httpError("O token informado não pertence a um bot Discord.", 400);

  const guild = await guildResponse.json() as { approximate_member_count?: number; icon?: string | null; id?: string; name?: string; owner_id?: string | null };
  const userGuilds = await userGuildsResponse.json() as Array<{ id: string; owner?: boolean; permissions?: string }>;
  const userGuild = userGuilds.find((item) => item.id === normalizedGuildId);
  if (!userGuild) throw httpError("Usuário autenticado não pertence ao servidor informado.", 403);
  if (!userCanManageGuild(userGuild)) throw httpError("Usuário autenticado não possui autorizacao para administrar este servidor.", 403);

  return {
    bot: {
      avatarUrl: discordCdnAvatarUrl(botUser.id, botUser.avatar ?? null),
      id: botUser.id,
      username: botUser.username ?? `Bot ${botUser.id}`
    },
    guild: {
      iconHash: guild.icon ?? null,
      iconUrl: guild.id ? discordCdnGuildIconUrl(guild.id, guild.icon ?? null) : null,
      id: guild.id ?? normalizedGuildId,
      memberCount: guild.approximate_member_count ?? 0,
      name: guild.name ?? `Servidor ${normalizedGuildId}`,
      ownerId: guild.owner_id ?? null
    },
    userDiscordId
  };
}

function userCanManageGuild(guild: { owner?: boolean; permissions?: string }) {
  if (guild.owner) return true;
  try {
    const permissions = BigInt(guild.permissions ?? "0");
    return (permissions & 0x8n) === 0x8n || (permissions & 0x20n) === 0x20n;
  } catch {
    return false;
  }
}

function discordCdnAvatarUrl(userId: string, avatar: string | null) {
  return avatar ? `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=128` : null;
}

function discordCdnGuildIconUrl(guildId: string, icon: string | null) {
  return icon ? `https://cdn.discordapp.com/icons/${guildId}/${icon}.png?size=128` : null;
}

function providerStatusToOrderStatus(status: MongoPlanPaymentOrderStatus | string): MongoPlanPaymentOrderStatus {
  if (status === "paid") return "approved";
  if (status === "processed") return "approved";
  if (status === "created") return "checkout_pending";
  if (status === "action_required") return "pending";
  if (status === "failed") return "rejected";
  if (status === "charged_back") return "chargeback";
  return status as MongoPlanPaymentOrderStatus;
}

function isFinalPaymentStatus(status: MongoPlanPaymentOrderStatus) {
  return new Set<MongoPlanPaymentOrderStatus>([
    "approved",
    "paid",
    "cancelled",
    "expired",
    "rejected",
    "failed",
    "refunded",
    "chargeback",
    "charged_back",
    "error"
  ]).has(status);
}

function isPendingPaymentDiscordId(discordId: string) {
  return discordId.startsWith("pending:");
}

async function expirePaymentOrderIfNeeded(order: MongoPaymentOrder, source: string) {
  if (!order.expiresAt || order.expiresAt > new Date() || isFinalPaymentStatus(order.status)) {
    return order;
  }

  const { paymentOrders } = await getMongoCollections();
  const updated = await paymentOrders.findOneAndUpdate(
    { _id: order._id, status: order.status },
    {
      $set: {
        notes: "Checkout expirado sem pagamento confirmado.",
        status: "expired",
        statusHistory: appendStatusHistory(order, "expired", source),
        updatedAt: new Date()
      }
    },
    { returnDocument: "after" }
  );
  return updated ?? order;
}

function sanitizePaymentOrderForUser(order: MongoPaymentOrder): PaymentOrderDto {
  const dto = toPaymentOrderDto(order);
  return {
    ...dto,
    sandboxCheckoutUrl: null,
    statusHistory: Array.isArray(dto.statusHistory) ? dto.statusHistory.slice(-10) : undefined,
    webhookSafeResponse: null
  };
}

function requireMercadoPagoAccessToken(config: { accessToken: string | null }) {
  if (!config.accessToken) throw httpError("Mercado Pago indisponível por credencial ausente.", 503);
  return config.accessToken;
}

function appendStatusHistory(order: MongoPaymentOrder, status: MongoPlanPaymentOrderStatus, source: string) {
  const history = Array.isArray(order.statusHistory) ? order.statusHistory.slice(-49) : [];
  history.push({
    at: new Date(),
    from: order.status ?? null,
    source,
    status
  });
  return history;
}

function safePaymentWebhookResponse(raw: Record<string, unknown>) {
  return {
    currency_id: readString(raw.currency_id),
    external_reference: readString(raw.external_reference),
    id: readString(raw.id),
    payment_method_id: readString(raw.payment_method_id),
    status: readString(raw.status),
    status_detail: readString(raw.status_detail),
    transaction_amount: typeof raw.transaction_amount === "number" ? raw.transaction_amount : Number(raw.transaction_amount) || null
  };
}

function safeOrderWebhookResponse(raw: Record<string, unknown>) {
  const payment = readFirstPayment(raw);
  const paymentMethod = isRecord(payment.payment_method) ? payment.payment_method : {};
  return {
    currency: readString(raw.currency),
    external_reference: readString(raw.external_reference),
    id: readString(raw.id),
    payment_id: readString(payment.id),
    payment_method_id: readString(paymentMethod.id),
    payment_method_type: readString(paymentMethod.type),
    status: readString(raw.status),
    status_detail: readString(raw.status_detail),
    total_amount: readString(raw.total_amount)
  };
}

function safeStripeWebhookResponse(raw: Record<string, unknown>) {
  return {
    amount_total: typeof raw.amount_total === "number" ? raw.amount_total : null,
    client_reference_id: readString(raw.client_reference_id),
    currency: readString(raw.currency),
    id: readString(raw.id),
    livemode: typeof raw.livemode === "boolean" ? raw.livemode : null,
    payment_intent: typeof raw.payment_intent === "string" ? raw.payment_intent : readNestedString(raw, ["payment_intent", "id"]),
    payment_status: readString(raw.payment_status),
    status: readString(raw.status)
  };
}

function safeAsaasWebhookResponse(raw: Record<string, unknown>) {
  return {
    billingType: readString(raw.billingType),
    confirmedDate: readString(raw.confirmedDate),
    customer: readString(raw.customer),
    externalReference: readString(raw.externalReference),
    id: readString(raw.id),
    invoiceUrl: readString(raw.invoiceUrl),
    paymentDate: readString(raw.paymentDate),
    status: readString(raw.status),
    value: typeof raw.value === "number" ? raw.value : Number(raw.value) || null
  };
}

function readAsaasPaidAt(raw: Record<string, unknown>) {
  const value = readString(raw.confirmedDate) ?? readString(raw.paymentDate) ?? readString(raw.clientPaymentDate);
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isMercadoPagoOrderWebhook(payload: Record<string, unknown>, resourceType?: string | null) {
  const type = resourceType?.trim().toLowerCase() || readString(payload.type)?.toLowerCase();
  return type === "order";
}

function isStripeCheckoutSessionEvent(type: string, value: unknown): value is Stripe.Checkout.Session {
  return type.startsWith("checkout.session.") && isRecord(value) && value.object === "checkout.session";
}

function readFirstPayment(raw: Record<string, unknown>) {
  const transactions = isRecord(raw.transactions) ? raw.transactions : {};
  const payments = Array.isArray(transactions.payments) ? transactions.payments : [];
  const payment = payments[0];
  return isRecord(payment) ? payment : {};
}

function trimText(value: string, max: number) {
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 100) || "plano";
}

function cleanLogString(value: string) {
  return value.replace(/[\r\n\t]+/g, " ").slice(0, 1000);
}

function cleanMetadata(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value, (_key, item) => (
    typeof item === "string" ? cleanLogString(item) : item
  ))) as Record<string, unknown>;
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function toPlanDto(plan: MongoPlan): PlanDto {
  const { _id, createdAt, updatedAt, ...rest } = plan;
  return {
    ...rest,
    id: _id,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString()
  };
}

function toPlanFeatureDto(feature: MongoPlanFeature): PlanFeatureDto {
  const { _id, createdAt, updatedAt, ...rest } = feature;
  return {
    ...rest,
    id: _id,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString()
  };
}

function toSubscriptionDto(subscription: MongoPlanSubscription, plan: MongoPlan | null, workspace: MongoPlanWorkspace | null): PlanSubscriptionDto {
  const { _id, activatedAt, cancelledAt, createdAt, endsAt, startedAt, suspendedAt, updatedAt, ...rest } = subscription;
  return {
    ...rest,
    id: _id,
    activatedAt: toIso(activatedAt),
    cancelledAt: toIso(cancelledAt),
    createdAt: createdAt.toISOString(),
    endsAt: toIso(endsAt),
    plan: plan ? {
      badge: plan.badge,
      botLimit: plan.botLimit,
      color: plan.color,
      guildLimit: plan.guildLimit,
      id: plan._id,
      name: plan.name,
      slug: plan.slug
    } : null,
    startedAt: toIso(startedAt),
    suspendedAt: toIso(suspendedAt),
    updatedAt: updatedAt.toISOString(),
    workspace: workspace ? {
      id: workspace._id,
      name: workspace.name,
      slug: workspace.slug,
      status: workspace.status
    } : null
  };
}

function toWorkspaceDto(workspace: MongoPlanWorkspace, bots: MongoBotCredential[] = []): PlanWorkspaceDto {
  const { _id, createdAt, updatedAt, ...rest } = workspace;
  return {
    ...rest,
    id: _id,
    botCount: bots.length || workspace.botIds.length,
    bots: bots.length ? bots.map(toBotCredentialDto) : undefined,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString()
  };
}

function toBotCredentialDto(credential: MongoBotCredential): BotCredentialDto {
  const {
    _id,
    authTag,
    createdAt,
    encryptedDataKey,
    iv,
    lastValidatedAt,
    tokenCiphertext,
    tokenFingerprint,
    updatedAt,
    ...rest
  } = credential;
  void authTag;
  void encryptedDataKey;
  void iv;
  void tokenCiphertext;
  void tokenFingerprint;

  return {
    ...rest,
    id: _id,
    createdAt: createdAt.toISOString(),
    lastValidatedAt: toIso(lastValidatedAt),
    tokenConfigured: true,
    updatedAt: updatedAt.toISOString()
  };
}

function toPaymentOrderDto(order: MongoPaymentOrder): PaymentOrderDto {
  const { _id, accessActivatedAt, approvedAt, cancelledAt, createdAt, expiresAt, paidAt, refundedAt, rejectedAt, updatedAt, ...rest } = order;
  return {
    ...rest,
    accessActivatedAt: toIso(accessActivatedAt),
    approvedAt: toIso(approvedAt),
    cancelledAt: toIso(cancelledAt),
    id: _id,
    createdAt: createdAt.toISOString(),
    expiresAt: toIso(expiresAt),
    paidAt: toIso(paidAt),
    refundedAt: toIso(refundedAt),
    rejectedAt: toIso(rejectedAt),
    updatedAt: updatedAt.toISOString()
  };
}

function toPaymentSettingsDto(settings: MongoPaymentSettings): PaymentSettingsDto {
  const { _id, secretEncrypted, updatedAt, webhookSecretEncrypted, ...rest } = settings;
  const mercadoPagoConfig = getMercadoPagoRuntimeConfig();
  const pagBankConfig = getPagBankRuntimeConfig();
  const stripeConfig = getStripeRuntimeConfig();
  const provider = resolveStoredPaymentProvider(settings.provider);
  const providerPublicKey = provider === "pagbank"
    ? pagBankConfig.publicKey
    : provider === "stripe"
      ? stripeConfig.publishableKey
      : mercadoPagoConfig.publicKey;
  const credentialsConfigured = provider === "pagbank"
    ? pagBankConfig.credentialsConfigured
    : provider === "stripe"
      ? stripeConfig.credentialsConfigured
      : mercadoPagoConfig.credentialsConfigured;
  const webhookConfigured = provider === "pagbank"
    ? pagBankConfig.webhookConfigured
    : provider === "stripe"
      ? stripeConfig.webhookConfigured
      : mercadoPagoConfig.webhookConfigured;
  void secretEncrypted;
  void webhookSecretEncrypted;
  return {
    ...rest,
    enabled: isResolvedPaymentProviderEnabled(provider, mercadoPagoConfig),
    id: _id,
    provider,
    publicKey: providerPublicKey,
    secretConfigured: credentialsConfigured,
    updatedAt: updatedAt.toISOString(),
    webhookSecretConfigured: webhookConfigured
  };
}

async function resolveActivePaymentManager(options: { allowDisabled?: boolean; provider?: "mercadopago" | "pagbank" | "stripe" } = {}) {
  const settings = await ensurePaymentSettings();
  const requestedProvider = options.provider ?? resolveStoredPaymentProvider(settings.provider);

  if (requestedProvider === "mercadopago") {
    const mercadoPagoConfig = requireMercadoPagoOperational({ allowDisabled: options.allowDisabled });
    const pagBankConfig = getPagBankRuntimeConfig();
    return {
      checkoutExpirationMinutes: mercadoPagoConfig.checkoutExpirationMinutes,
      enabled: mercadoPagoConfig.enabled || Boolean(options.allowDisabled),
      environment: mercadoPagoConfig.environment,
      manager: new PaymentManager("mercadopago", mercadoPagoConfig, pagBankConfig),
      pagBankConfig,
      provider: "mercadopago" as const
    };
  }

  if (requestedProvider === "pagbank") {
    const mercadoPagoConfig = getMercadoPagoRuntimeConfig();
    const pagBankConfig = requirePagBankOperational({ allowDisabled: options.allowDisabled });
    return {
      checkoutExpirationMinutes: env.PIX_EXPIRATION_MINUTES,
      enabled: pagBankConfig.enabled || Boolean(options.allowDisabled),
      environment: pagBankConfig.environment === "sandbox" ? "test" as const : "production" as const,
      manager: new PaymentManager("pagbank", mercadoPagoConfig, pagBankConfig),
      pagBankConfig,
      provider: "pagbank" as const
    };
  }

  if (requestedProvider === "stripe") {
    const mercadoPagoConfig = getMercadoPagoRuntimeConfig();
    const pagBankConfig = getPagBankRuntimeConfig();
    const stripeConfig = requireStripeOperational({ allowDisabled: options.allowDisabled });
    return {
      checkoutExpirationMinutes: stripeConfig.checkoutExpirationMinutes,
      enabled: stripeConfig.enabled || Boolean(options.allowDisabled),
      environment: stripeConfig.environment,
      mercadoPagoConfig,
      pagBankConfig,
      provider: "stripe" as const,
      stripeConfig
    };
  }

  throw httpError("Pagamento temporariamente indisponível.", 503);
}

function resolveStoredPaymentProvider(provider: MongoPaymentProvider): "mercadopago" | "pagbank" | "stripe" | "disabled" {
  if (isPaymentDisabledByEnv()) return "disabled";
  const envProvider = resolveEnvPaymentProvider();
  if (envProvider === "mercadopago" || envProvider === "pagbank" || envProvider === "stripe") return envProvider;
  if (provider === "mercadopago" || provider === "pagbank" || provider === "stripe") return provider;
  return "disabled";
}

function resolvePaymentGatewayForCheckoutMethod(paymentMethod: CheckoutPaymentMethod) {
  if (isPaymentDisabledByEnv()) {
    return {
      checkoutExpirationMinutes: env.PIX_EXPIRATION_MINUTES,
      enabled: false,
      environment: "test" as const,
      provider: "disabled" as const
    };
  }

  if (paymentMethod === "pix") {
    const asaasConfig = getAsaasRuntimeConfig();
    return {
      asaasConfig,
      checkoutExpirationMinutes: asaasConfig.checkoutExpirationMinutes,
      enabled: asaasConfig.status === "operational",
      environment: asaasConfig.environment,
      provider: "asaas" as const
    };
  }

  const stripeConfig = getStripeRuntimeConfig();
  return {
    checkoutExpirationMinutes: stripeConfig.checkoutExpirationMinutes,
    enabled: stripeConfig.status === "operational",
    environment: stripeConfig.environment,
    provider: "stripe" as const,
    stripeConfig
  };
}

function resolveEnvPaymentProvider(): MongoPaymentProvider {
  if (isPaymentDisabledByEnv()) {
    return "disabled";
  }

  if (env.PAYMENT_PROVIDER === "asaas") {
    return "asaas";
  }

  if (env.PAYMENT_PROVIDER === "pagbank") {
    return "pagbank";
  }

  if (env.PAYMENT_PROVIDER === "stripe") {
    return "stripe";
  }

  if (env.PAYMENT_PROVIDER === "mercadopago" || env.MERCADOPAGO_ENABLED) {
    return "mercadopago";
  }

  return env.PAYMENT_PROVIDER;
}

function isResolvedPaymentProviderEnabled(provider: MongoPaymentProvider, mercadoPagoConfig: ReturnType<typeof getMercadoPagoRuntimeConfig>) {
  if (provider === "pagbank") {
    return getPagBankRuntimeConfig().enabled;
  }
  if (provider === "stripe") {
    return getStripeRuntimeConfig().enabled;
  }
  if (provider === "asaas") {
    return getAsaasRuntimeConfig().enabled;
  }
  return provider === "mercadopago" && mercadoPagoConfig.enabled;
}

function isPaymentDisabledByEnv() {
  return process.env.PAYMENTS_ENABLED?.trim().toLowerCase() === "false";
}

function toAuditLogDto(log: MongoPlanAuditLog) {
  return {
    ...log,
    id: log._id,
    createdAt: log.createdAt.toISOString()
  };
}

function httpError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

function parseProviderPixExpiresAt(value: string | null | undefined, fallback: Date | null | undefined) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

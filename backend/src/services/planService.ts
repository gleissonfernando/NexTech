import { createCipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { env } from "../config/env";
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
  MongoPlanSubscription,
  MongoPlanSubscriptionStatus,
  MongoPlanWorkspace
} from "../database/mongo";
import { getMongoCollections } from "../database/mongo";
import { buildAppUrl } from "../config/appUrl";
import { MercadoPagoPaymentProvider } from "./paymentProviderService";
import { decryptSecret, encryptSecret } from "./secretCryptoService";
import type { DashboardAuth } from "./tokenService";

export type PlanActor = {
  id: string | null;
  ip?: string | null;
  name?: string | null;
  userAgent?: string | null;
};

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
  enabled?: boolean;
  provider?: MongoPaymentProvider;
  publicKey?: string | null;
  secret?: string | null;
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
  "_id" | "createdAt" | "updatedAt" | "tokenCiphertext" | "encryptedDataKey" | "iv" | "authTag" | "lastValidatedAt"
> & {
  id: string;
  createdAt: string;
  lastValidatedAt: string | null;
  tokenConfigured: true;
  updatedAt: string;
};

export type PaymentOrderDto = Omit<MongoPaymentOrder, "_id" | "createdAt" | "updatedAt" | "paidAt"> & {
  id: string;
  createdAt: string;
  paidAt: string | null;
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
  signature: string | null;
};

const FEATURE_SEEDS: SavePlanFeatureInput[] = [
  { category: "streamer", key: "streamer.twitch_alerts", name: "Alertas Twitch", description: "Alertas de live, clips e eventos de stream.", order: 10 },
  { category: "streamer", key: "streamer.kick_alerts", name: "Alertas Kick", description: "Monitoramento de lives e notificacoes Kick.", order: 20 },
  { category: "streamer", key: "streamer.clip_automation", name: "Automacao de clips", description: "Registro e ranking de clips por comunidade.", order: 30 },
  { category: "fivem", key: "fivem.finance", name: "Financeiro FiveM", description: "Controle de transacoes, metas e auditoria financeira.", order: 40 },
  { category: "fivem", key: "fivem.orders", name: "Encomendas RP", description: "Pedidos, familias, drogas, armas e personalizados.", order: 50 },
  { category: "fivem", key: "fivem.hierarchy", name: "Hierarquia FiveM", description: "Paineis de hierarquia e cargos por faccao/corporacao.", order: 60 },
  { category: "discord", key: "discord.logs", name: "Logs Discord", description: "Logs do site e do Discord em tempo real.", order: 70 },
  { category: "discord", key: "discord.tickets", name: "Tickets", description: "Atendimento, transcripts e paineis de suporte.", order: 80 },
  { category: "discord", key: "discord.courses", name: "Cursos", description: "Cursos, provas e publicacoes para equipes.", order: 90 },
  { category: "security", key: "security.anti_ban", name: "Anti Ban", description: "Protecao contra acoes administrativas indevidas.", order: 100 },
  { category: "security", key: "security.self_bot", name: "SelfBot Protection", description: "Deteccao e mitigacao de selfbots.", order: 110 },
  { category: "support", key: "support.priority", name: "Suporte prioritario", description: "Atendimento prioritario para operacao critica.", order: 120 }
];

const PLAN_SEEDS: SavePlanInput[] = [
  {
    badge: "Para criadores",
    botLimit: 1,
    color: "#FFD500",
    description: "Plano inicial para streamers que precisam automatizar alertas, clips e integracoes sociais.",
    entitlements: entitlementsFor(["streamer.twitch_alerts", "streamer.kick_alerts", "streamer.clip_automation", "discord.logs"]),
    guildLimit: 1,
    icon: "radio",
    isActive: true,
    isPublic: true,
    isPurchasable: false,
    name: "Streamer",
    order: 10,
    priceInCents: 0,
    shortDescription: "Alertas e automacao para comunidades de stream.",
    slug: "streamer"
  },
  {
    badge: "RP",
    botLimit: 1,
    color: "#3DDC84",
    description: "Pacote para servidores FiveM com financeiro, encomendas, hierarquia, metas e logs.",
    entitlements: entitlementsFor(["fivem.finance", "fivem.orders", "fivem.hierarchy", "discord.logs", "support.priority"]),
    guildLimit: 2,
    icon: "building",
    isActive: true,
    isPublic: true,
    isPurchasable: false,
    isRecommended: true,
    name: "FiveM",
    order: 20,
    priceInCents: 0,
    shortDescription: "Gestao completa para operacoes FiveM.",
    slug: "fivem"
  },
  {
    badge: "Gestao",
    botLimit: 2,
    color: "#FFEA70",
    description: "Plano para administracao de comunidades Discord com tickets, logs, cursos e seguranca.",
    entitlements: entitlementsFor(["discord.logs", "discord.tickets", "discord.courses", "security.anti_ban", "security.self_bot"]),
    guildLimit: 3,
    icon: "shield",
    isActive: true,
    isPublic: true,
    isPurchasable: false,
    name: "Discord Management",
    order: 30,
    priceInCents: 0,
    shortDescription: "Moderacao, atendimento e operacao para servidores Discord.",
    slug: "discord-management"
  }
];

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
}

export async function listPublicPlans() {
  await ensurePlanSeed();
  const { plans } = await getMongoCollections();
  const rows = await plans.find({ isActive: true, isPublic: true }).sort({ order: 1, createdAt: 1 }).toArray();
  return rows.map(toPlanDto);
}

export async function getPublicPlan(slug: string) {
  await ensurePlanSeed();
  const { plans } = await getMongoCollections();
  const plan = await plans.findOne({ slug: slugify(slug), isActive: true, isPublic: true });
  return plan ? toPlanDto(plan) : null;
}

export async function createCheckoutInterest(planSlug: string, auth: DashboardAuth, actor: PlanActor) {
  await ensurePlanSeed();
  const { paymentOrders, plans } = await getMongoCollections();
  const plan = await plans.findOne({ slug: slugify(planSlug), isActive: true, isPublic: true });

  if (!plan) {
    throw httpError("Plano nao encontrado.", 404);
  }

  const settings = await ensurePaymentSettings();
  const paymentsEnabled = settings.enabled && settings.provider !== "disabled";
  const now = new Date();
  const amountInCents = plan.promotionalPriceInCents ?? plan.priceInCents;
  const reusableOrder = paymentsEnabled && plan.isPurchasable && amountInCents > 0
    ? await paymentOrders.findOne({
      amountInCents,
      currency: plan.currency,
      discordId: auth.user.discordId,
      planId: plan._id,
      provider: settings.provider,
      status: { $in: ["pending", "processing", "in_review"] },
      checkoutUrl: { $ne: null },
      createdAt: { $gte: new Date(now.getTime() - 10 * 60_000) }
    })
    : null;

  if (reusableOrder) {
    await writePlanAudit({
      ...actor,
      id: auth.user.discordId,
      name: auth.user.globalName || auth.user.username
    }, "checkout_reused_pending_order", "payment", reusableOrder._id, {
      planSlug: plan.slug,
      provider: reusableOrder.provider,
      status: reusableOrder.status
    });

    return {
      order: toPaymentOrderDto(reusableOrder),
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
    amountInCents,
    checkoutUrl: null,
    createdAt: now,
    currency: plan.currency,
    discordId: auth.user.discordId,
    externalReference: null,
    idempotencyKey,
    mercadoPagoPaymentId: null,
    notes: paymentsEnabled
      ? "Pedido registrado. Provedor de pagamento pendente de integracao."
      : "Interesse registrado. Pagamentos estao desativados e nenhum QR Code/cobranca foi gerado.",
    paidAt: null,
    paymentMethod: null,
    pixCode: null,
    planId: plan._id,
    planSnapshot: snapshotPlan(plan),
    planSlug: plan.slug,
    provider: paymentsEnabled ? settings.provider : "disabled",
    providerOrderId: null,
    qrCode: null,
    status: paymentsEnabled && plan.isPurchasable ? "pending" : "interest_registered",
    updatedAt: now,
    userId: auth.user.id || auth.user.discordId
  };
  order.externalReference = order._id;

  if (paymentsEnabled && plan.isPurchasable && amountInCents > 0) {
    const checkout = await createMercadoPagoPlanPreference(settings, plan, order, auth);
    order.checkoutUrl = checkout.checkoutUrl;
    order.notes = "Pedido criado no Mercado Pago. Continue pelo link de checkout.";
    order.providerOrderId = checkout.preferenceId;
  }

  await paymentOrders.insertOne(order);
  await writePlanAudit({
    ...actor,
    id: auth.user.discordId,
    name: auth.user.globalName || auth.user.username
  }, "checkout_interest", "payment", order._id, {
    planSlug: plan.slug,
    provider: order.provider,
    status: order.status
  });

  return {
    order: toPaymentOrderDto(order),
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
    orders: orders.map(toPaymentOrderDto),
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
  const order = await paymentOrders.findOne({ _id: orderId, discordId: auth.user.discordId });
  if (!order) throw httpError("Pedido nao encontrado.", 404);

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

export async function updateWorkspaceBotCredentialToken(workspaceId: string, credentialId: string, token: string, auth: DashboardAuth, actor: PlanActor) {
  await assertWorkspaceAccess(workspaceId, auth);
  const { botCredentials } = await getMongoCollections();
  const current = await botCredentials.findOne({ _id: credentialId, workspaceId, status: { $ne: "disabled" } });

  if (!current) {
    throw httpError("Bot nao encontrado neste workspace.", 404);
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
    throw httpError("Bot nao encontrado neste workspace.", 404);
  }

  await writePlanAudit(actor, "bot_credential_validated", "bot_credential", credentialId, { workspaceId });
  return toBotCredentialDto(updated);
}

export async function deleteWorkspaceBotCredential(workspaceId: string, credentialId: string, auth: DashboardAuth, actor: PlanActor) {
  await assertWorkspaceAccess(workspaceId, auth);
  const { botCredentials, planWorkspaces } = await getMongoCollections();
  const deleted = await botCredentials.findOneAndDelete({ _id: credentialId, workspaceId });

  if (!deleted) {
    throw httpError("Bot nao encontrado neste workspace.", 404);
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
      paymentsEnabled: settings.enabled && settings.provider !== "disabled",
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
      throw httpError("Plano nao encontrado.", 404);
    }

    const nextSlug = slugify(input.slug || input.name || current.slug);
    const duplicate = await plans.findOne({ slug: nextSlug, _id: { $ne: planId } });
    if (duplicate) {
      throw httpError("Ja existe um plano com este slug.", 409);
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
    throw httpError("Ja existe um plano com este slug.", 409);
  }

  await plans.insertOne(document);
  await writePlanAudit(actor, "plan_created", "plan", document._id, { slug: document.slug });
  return toPlanDto(document);
}

export async function duplicateDevPlan(planId: string, actor: PlanActor) {
  const { plans } = await getMongoCollections();
  const current = await plans.findOne({ _id: planId });
  if (!current) {
    throw httpError("Plano nao encontrado.", 404);
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
    throw httpError("Plano nao encontrado.", 404);
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
    if (!current) throw httpError("Feature nao encontrada.", 404);
    const duplicate = await planFeatures.findOne({ key, _id: { $ne: featureId } });
    if (duplicate) throw httpError("Ja existe uma feature com esta chave.", 409);

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
  if (!plan) throw httpError("Plano nao encontrado.", 404);

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
    metadata: {
      activation: "manual"
    },
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
  if (!order) throw httpError("Pedido de pagamento nao encontrado.", 404);

  const plan = await plans.findOne({ _id: order.planId });
  if (!plan) throw httpError("Plano do pedido nao encontrado.", 404);

  const existingSubscription = await planSubscriptions.findOne({
    "metadata.paymentOrderId": order._id
  } as Partial<MongoPlanSubscription>);

  if (order.status === "paid" && existingSubscription) {
    const workspace = existingSubscription.workspaceId ? await planWorkspaces.findOne({ _id: existingSubscription.workspaceId }) : null;
    return {
      order: toPaymentOrderDto(order),
      subscription: toSubscriptionDto(existingSubscription, plan, workspace)
    };
  }

  if (["cancelled", "expired", "failed"].includes(order.status)) {
    throw httpError("Pedido finalizado nao pode ser pago em teste.", 409);
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
      metadata: {
        activation: "payment_test",
        paymentOrderId: order._id
      },
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
  }

  await paymentOrders.updateOne(
    { _id: order._id },
    {
      $set: {
        notes: "Pagamento marcado como pago pelo modo de teste DEV.",
        paidAt: order.paidAt ?? now,
        status: "paid",
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
  const settings = await ensurePaymentSettings();
  const { paymentEvents, paymentOrders, plans } = await getMongoCollections();
  const now = new Date();
  const payload = isRecord(input.body) ? input.body : {};
  const dataId = input.dataId ?? readNestedString(payload, ["data", "id"]);
  const eventType = readString(payload.type) ?? readString(payload.action) ?? "unknown";
  const eventId = readString(payload.id) ?? input.requestId ?? dataId ?? null;
  const payloadHash = sha256(JSON.stringify(payload));
  const eventDoc: MongoPaymentEvent = {
    _id: randomUUID(),
    createdAt: now,
    eventId,
    eventType,
    orderId: null,
    payloadHash,
    processedAt: null,
    provider: "mercadopago",
    result: null,
    signatureValid: false,
    status: "received"
  };

  const existingProcessed = eventId
    ? await paymentEvents.findOne({ provider: "mercadopago", eventId, status: "processed" })
    : await paymentEvents.findOne({ provider: "mercadopago", payloadHash, status: "processed" });

  if (existingProcessed) {
    return {
      duplicate: true,
      event: mapPaymentEvent(existingProcessed),
      processed: true
    };
  }

  const insertedEvent = await paymentEvents.insertOne(eventDoc).then(() => eventDoc);

  try {
    if (settings.provider !== "mercadopago" || !settings.enabled) {
      await markPaymentEvent(insertedEvent._id, "ignored", "Mercado Pago desativado nas configuracoes.");
      return { duplicate: false, event: mapPaymentEvent({ ...insertedEvent, status: "ignored", result: "Mercado Pago desativado nas configuracoes.", processedAt: new Date() }), processed: false };
    }

    if (!settings.secretEncrypted) {
      await markPaymentEvent(insertedEvent._id, "failed", "Access Token Mercado Pago ausente.");
      throw httpError("Access Token Mercado Pago ausente.", 500);
    }

    if (!settings.webhookSecretEncrypted) {
      await markPaymentEvent(insertedEvent._id, "failed", "Webhook secret Mercado Pago ausente.");
      throw httpError("Assinatura do webhook nao configurada.", 401);
    }

    const provider = new MercadoPagoPaymentProvider(
      decryptSecret(settings.secretEncrypted),
      decryptSecret(settings.webhookSecretEncrypted)
    );
    const signatureValid = await provider.validateWebhook({
      dataId,
      requestId: input.requestId,
      signature: input.signature
    });
    await paymentEvents.updateOne({ _id: insertedEvent._id }, { $set: { signatureValid } });

    if (!signatureValid) {
      await markPaymentEvent(insertedEvent._id, "failed", "Assinatura Mercado Pago invalida.");
      throw httpError("Assinatura Mercado Pago invalida.", 401);
    }

    if (!dataId) {
      await markPaymentEvent(insertedEvent._id, "ignored", "Webhook sem data.id.");
      return { duplicate: false, event: mapPaymentEvent({ ...insertedEvent, status: "ignored", result: "Webhook sem data.id.", signatureValid: true, processedAt: new Date() }), processed: false };
    }

    const payment = await provider.getPayment(dataId);
    const externalReference = payment.externalReference;
    const paymentId = payment.id;
    const status = payment.status;
    const amountInCents = payment.amountInCents;
    const currency = payment.currency;
    const paymentMethod = payment.method;

    if (!externalReference) {
      await markPaymentEvent(insertedEvent._id, "ignored", "Pagamento sem referencia externa.");
      return { duplicate: false, event: mapPaymentEvent({ ...insertedEvent, status: "ignored", result: "Pagamento sem referencia externa.", signatureValid: true, processedAt: new Date() }), processed: false };
    }

    const order = await paymentOrders.findOne({ _id: externalReference });
    if (!order) {
      await markPaymentEvent(insertedEvent._id, "ignored", "Pedido interno nao encontrado.", null);
      return { duplicate: false, event: mapPaymentEvent({ ...insertedEvent, orderId: null, status: "ignored", result: "Pedido interno nao encontrado.", signatureValid: true, processedAt: new Date() }), processed: false };
    }

    await paymentEvents.updateOne({ _id: insertedEvent._id }, { $set: { orderId: order._id } });

    if (order.provider !== "mercadopago" || order.externalReference !== externalReference) {
      await markPaymentEvent(insertedEvent._id, "failed", "Referencia do pedido divergente.", order._id);
      throw httpError("Referencia do pedido divergente.", 409);
    }

    if (amountInCents !== order.amountInCents || currency !== order.currency) {
      await paymentOrders.updateOne({ _id: order._id }, {
        $set: {
          mercadoPagoPaymentId: paymentId,
          notes: "Pagamento Mercado Pago recusado por divergencia de valor ou moeda.",
          status: "failed",
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

    const nextStatus = status;
    const update: Partial<MongoPaymentOrder> = {
      mercadoPagoPaymentId: paymentId,
      notes: `Status Mercado Pago confirmado: ${status}.`,
      paymentMethod,
      status: nextStatus,
      updatedAt: new Date()
    };
    if (nextStatus === "paid") update.paidAt = order.paidAt ?? new Date();

    await paymentOrders.updateOne({ _id: order._id }, { $set: update });

    let subscription = null;
    if (nextStatus === "paid") {
      const plan = await plans.findOne({ _id: order.planId });
      if (!plan) {
        await markPaymentEvent(insertedEvent._id, "failed", "Plano do pedido nao encontrado.", order._id);
        throw httpError("Plano do pedido nao encontrado.", 404);
      }
      subscription = await activatePaidOrder(order, plan, systemPaymentActor(), "mercadopago_webhook");
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
      metadata: {
        activation,
        paymentOrderId: order._id,
        planSnapshot: snapshot ?? snapshotPlan(plan)
      },
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

  return updatedSubscription ? toSubscriptionDto(updatedSubscription, plan, workspace) : null;
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

async function markPaymentEvent(eventId: string, status: MongoPaymentEvent["status"], result: string, orderId: string | null = null) {
  const { paymentEvents } = await getMongoCollections();
  await paymentEvents.updateOne({ _id: eventId }, {
    $set: {
      orderId,
      processedAt: new Date(),
      result,
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
  return { id: "system:mercadopago", name: "Mercado Pago" };
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
  if (!updated) throw httpError("Assinatura nao encontrada.", 404);

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
  if (!current) throw httpError("Assinatura nao encontrada.", 404);

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
  const patch: Partial<MongoPaymentSettings> = {
    enabled: input.enabled ?? current.enabled,
    provider: input.provider ?? current.provider,
    publicKey: input.publicKey === undefined ? current.publicKey : normalizeNullable(input.publicKey),
    updatedAt: now,
    updatedBy: actor.id
  };

  if (input.secret !== undefined) {
    patch.secretEncrypted = input.secret ? encryptSecret(input.secret) : null;
  }

  if (input.webhookSecret !== undefined) {
    patch.webhookSecretEncrypted = input.webhookSecret ? encryptSecret(input.webhookSecret) : null;
  }

  await paymentSettings.updateOne({ _id: "global" }, { $set: patch }, { upsert: true });
  await writePlanAudit(actor, "payment_settings_updated", "settings", "global", {
    enabled: patch.enabled,
    provider: patch.provider
  });

  return toPaymentSettingsDto((await ensurePaymentSettings()));
}

async function ensurePaymentSettings(): Promise<MongoPaymentSettings> {
  const { paymentSettings } = await getMongoCollections();
  const existing = await paymentSettings.findOne({ _id: "global" });

  if (existing) {
    return existing;
  }

  const now = new Date();
  const settings: MongoPaymentSettings = {
    _id: "global",
    enabled: env.PAYMENTS_ENABLED,
    provider: env.PAYMENT_PROVIDER,
    publicKey: null,
    secretEncrypted: null,
    updatedAt: now,
    updatedBy: null,
    webhookSecretEncrypted: null
  };

  await paymentSettings.updateOne({ _id: "global" }, { $setOnInsert: settings }, { upsert: true });
  return settings;
}

async function createMercadoPagoPlanPreference(
  settings: MongoPaymentSettings,
  plan: MongoPlan,
  order: MongoPaymentOrder,
  auth: DashboardAuth
) {
  if (settings.provider !== "mercadopago") {
    throw httpError("Provider de pagamento nao suportado para checkout automatico.", 400);
  }
  if (!settings.secretEncrypted) {
    throw httpError("Access Token do Mercado Pago nao configurado.", 400);
  }

  const provider = new MercadoPagoPaymentProvider(decryptSecret(settings.secretEncrypted));
  return provider.createOneTimeCheckout({
    backUrls: {
      failure: buildAppUrl("/pagamento/falha"),
      pending: buildAppUrl("/pagamento/pendente"),
      success: buildAppUrl("/pagamento/sucesso")
    },
    externalReference: order._id,
    idempotencyKey: order.idempotencyKey,
    items: [
      {
        currencyId: plan.currency,
        description: plan.shortDescription || plan.description || plan.name,
        id: plan._id,
        title: plan.name,
        unitPriceInCents: order.amountInCents
      }
    ],
    notificationUrl: buildAppUrl("/api/payments/mercado-pago/webhook?source_news=webhooks"),
    payerEmail: auth.user.email
  });
}

async function assertWorkspaceAccess(workspaceId: string, auth: DashboardAuth) {
  const { planWorkspaces, workspaceMembers } = await getMongoCollections();
  const workspace = await planWorkspaces.findOne({ _id: workspaceId });

  if (!workspace) {
    throw httpError("Workspace nao encontrado.", 404);
  }

  if (workspace.ownerDiscordId === auth.user.discordId) {
    return { role: "owner" as const, workspace };
  }

  const member = await workspaceMembers.findOne({ workspaceId, discordId: auth.user.discordId });
  if (!member) {
    throw httpError("Sem permissao para acessar este workspace.", 403);
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
    updatedAt,
    ...rest
  } = credential;
  void authTag;
  void encryptedDataKey;
  void iv;
  void tokenCiphertext;

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
  const { _id, createdAt, paidAt, updatedAt, ...rest } = order;
  return {
    ...rest,
    id: _id,
    createdAt: createdAt.toISOString(),
    paidAt: toIso(paidAt),
    updatedAt: updatedAt.toISOString()
  };
}

function toPaymentSettingsDto(settings: MongoPaymentSettings): PaymentSettingsDto {
  const { _id, secretEncrypted, updatedAt, webhookSecretEncrypted, ...rest } = settings;
  return {
    ...rest,
    id: _id,
    secretConfigured: Boolean(secretEncrypted),
    updatedAt: updatedAt.toISOString(),
    webhookSecretConfigured: Boolean(webhookSecretEncrypted)
  };
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

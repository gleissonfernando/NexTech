import { randomUUID } from "node:crypto";
import { getAsaasRuntimeConfig } from "../config/payments";
import {
  getMongoCollections,
  type MongoBotBillingInvoice,
  type MongoBotBillingInvoiceStatus,
  type MongoBotBillingModel,
  type MongoDevBot
} from "../database/mongo";
import { emitRealtime } from "../realtime/events";
import type { AuthSessionUser } from "../types/session";
import { AsaasPaymentService } from "./payments/asaasPaymentService";
import { PAYMENT_METHODS } from "./payments/types";

export const BOT_HOSTING_AMOUNT_IN_CENTS = 1200;
const DEFAULT_MONTHLY_CONTRACT_AMOUNT_IN_CENTS = 1200;
const DUE_DAY = 8;
const BILLING_JOB_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type BotBillingAccessDto = {
  blocked: boolean;
  blockingInvoice: BotBillingInvoiceDto | null;
  currentInvoice: BotBillingInvoiceDto | null;
  dashboardOverrideActive: boolean;
  forceBotActive: boolean;
  model: MongoBotBillingModel;
  overdue: boolean;
  reason: string | null;
};

export type BotBillingInvoiceDto = {
  id: string;
  userId: string;
  botId: string;
  botName: string;
  billingModel: MongoBotBillingModel;
  chargeType: "hosting" | "monthly_plan";
  amountInCents: number;
  currency: "BRL";
  dueDate: string;
  dueMonth: string;
  status: MongoBotBillingInvoiceStatus;
  pixCode: string | null;
  pixQrCode: string | null;
  providerPaymentId: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BotBillingOverrideInput = {
  forceBotActive: boolean;
  forceDashboardAccess: boolean;
  expiresAt?: Date | null;
  reason: string;
};

let schedulerStarted = false;

export function startBotBillingScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  void processBotBillingCycle("scheduler_startup").catch(logBillingError);
  const timer = setInterval(() => {
    void processBotBillingCycle("scheduler_interval").catch(logBillingError);
  }, BILLING_JOB_INTERVAL_MS);
  timer.unref();
}

export async function processBotBillingCycle(source = "manual") {
  const migration = await migrateExistingBotBillingModels(source);
  const generated = await generateDueBotInvoices(source);
  const overdue = await markOverdueBotInvoices(source);
  return { generated, migration, overdue };
}

export async function migrateExistingBotBillingModels(source = "migration") {
  const { devBots, planSubscriptions, planWorkspaces, plans } = await getMongoCollections();
  const bots = await devBots.find({
    billingModel: { $exists: false }
  }).toArray();
  let lifetime = 0;
  let monthly = 0;

  for (const bot of bots) {
    const workspace = await planWorkspaces.findOne({
      $or: [
        { ownerDiscordId: bot.ownerId },
        { ownerUserId: bot.ownerId },
        { botIds: bot._id }
      ],
      status: { $ne: "cancelled" }
    });
    const subscription = workspace
      ? await planSubscriptions.findOne({ _id: workspace.subscriptionId })
      : await planSubscriptions.findOne({ discordId: bot.ownerId, status: "active" });
    const plan = subscription ? await plans.findOne({ _id: subscription.planId }) : null;
    const model: MongoBotBillingModel = plan?.billingCycle === "lifetime"
      || subscription?.metadata?.license && readNestedString(subscription.metadata, ["license", "type"]) === "lifetime"
      ? "lifetime"
      : "monthly";
    const contractAmount = model === "lifetime"
      ? BOT_HOSTING_AMOUNT_IN_CENTS
      : Math.max(0, Number(plan?.promotionalPriceInCents ?? plan?.priceInCents ?? DEFAULT_MONTHLY_CONTRACT_AMOUNT_IN_CENTS));

    const result = await devBots.updateOne(
      { _id: bot._id, billingModel: { $exists: false } },
      {
        $set: {
          billingModel: model,
          contractAmountInCents: contractAmount,
          updatedAt: new Date()
        }
      }
    );

    if (result.modifiedCount) {
      if (model === "lifetime") lifetime += 1;
      else monthly += 1;
      await writeBillingAudit(bot, model === "lifetime" ? "billing_migrated_lifetime" : "billing_migrated_monthly", null, model, source, null);
    }
  }

  return { lifetime, monthly };
}

export async function generateDueBotInvoices(source = "billing_cycle") {
  const today = new Date();
  if (today.getDate() < DUE_DAY) return { created: 0, skipped: true };
  const { devBots } = await getMongoCollections();
  const bots = await devBots.find({}).toArray();
  let created = 0;

  for (const bot of bots) {
    const invoice = await ensureMonthlyBotInvoice(bot, today, source);
    if (invoice.created) created += 1;
  }

  return { created, skipped: false };
}

export async function ensureMonthlyBotInvoice(bot: MongoDevBot, date = new Date(), source = "ensure") {
  const { botBillingInvoices } = await getMongoCollections();
  const dueMonth = monthKey(date);
  const existing = await botBillingInvoices.findOne({ botId: bot._id, dueMonth });
  if (existing) return { created: false, invoice: existing };

  const now = new Date();
  const model = bot.billingModel ?? "monthly";
  const invoice: MongoBotBillingInvoice = {
    _id: randomUUID(),
    amountInCents: invoiceAmount(bot),
    billingModel: model,
    botId: bot._id,
    botName: bot.name,
    chargeType: model === "lifetime" ? "hosting" : "monthly_plan",
    createdAt: now,
    currency: "BRL",
    dueDate: dueDateForMonth(date),
    dueMonth,
    idempotencyKey: `bot-invoice:${bot._id}:${dueMonth}`,
    notes: null,
    paidAt: null,
    paymentProvider: "asaas",
    pixCode: null,
    pixQrCode: null,
    providerPaymentId: null,
    status: "pending",
    statusHistory: [{ at: now, from: null, source, status: "pending" }],
    updatedAt: now,
    userId: bot.ownerId
  };

  try {
    await botBillingInvoices.insertOne(invoice);
    await writeBillingAudit(bot, "bot_invoice_created", null, model, source, invoice._id);
    return { created: true, invoice };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const duplicate = await botBillingInvoices.findOne({ botId: bot._id, dueMonth });
      if (duplicate) return { created: false, invoice: duplicate };
    }
    throw error;
  }
}

export async function markOverdueBotInvoices(source = "overdue_job") {
  const { botBillingInvoices, devBots } = await getMongoCollections();
  const now = new Date();
  const overdueCutoff = new Date(now);
  overdueCutoff.setHours(0, 0, 0, 0);
  const invoices = await botBillingInvoices.find({
    dueDate: { $lt: overdueCutoff },
    status: "pending"
  }).toArray();
  let updated = 0;

  for (const invoice of invoices) {
    const bot = await devBots.findOne({ _id: invoice.botId });
    const forceBotActive = bot ? hasValidBotOverride(bot, "bot") : false;
    const next = await botBillingInvoices.findOneAndUpdate(
      { _id: invoice._id, status: "pending" },
      {
        $set: {
          notes: "Fatura vencida sem pagamento confirmado.",
          status: "overdue",
          statusHistory: appendInvoiceHistory(invoice, "overdue", source),
          updatedAt: new Date()
        }
      },
      { returnDocument: "after" }
    );
    if (!next) continue;
    updated += 1;
    if (bot && !forceBotActive) {
      const { stopDevBotProcess } = await import("./devBotRuntimeService.js");
      await devBots.updateOne({ _id: bot._id }, { $set: { desiredOnline: false, updatedAt: new Date() } });
      await stopDevBotProcess(bot._id, {
        message: "Bot desligado automaticamente por fatura vencida.",
        notifyBot: true
      });
    }
    emitRealtime("bot:billing_updated", { botId: invoice.botId, invoice: toBotBillingInvoiceDto(next) });
  }

  return { updated };
}

export async function getBotBillingAccess(botId: string, user?: AuthSessionUser | null) {
  const { botBillingInvoices, devBots } = await getMongoCollections();
  const bot = await devBots.findOne({ _id: botId });
  if (!bot) return null;

  await ensureInvoiceWhenDashboardOpens(bot);
  await markOverdueBotInvoices("access_check");

  const [currentInvoice, blockingInvoice] = await Promise.all([
    botBillingInvoices.findOne({ botId, dueMonth: monthKey(new Date()), status: { $in: ["pending", "overdue"] } }, { sort: { dueDate: -1 } }),
    botBillingInvoices.findOne({ botId, status: "overdue" }, { sort: { dueDate: 1 } })
  ]);
  const dashboardOverrideActive = hasValidBotOverride(bot, "dashboard");
  const blocked = Boolean(blockingInvoice && !dashboardOverrideActive);

  return {
    blocked,
    blockingInvoice: blockingInvoice ? toBotBillingInvoiceDto(blockingInvoice) : null,
    currentInvoice: currentInvoice ? toBotBillingInvoiceDto(currentInvoice) : null,
    dashboardOverrideActive,
    forceBotActive: hasValidBotOverride(bot, "bot"),
    model: bot.billingModel ?? "monthly",
    overdue: Boolean(blockingInvoice),
    reason: blocked ? "Fatura vencida" : null,
    userIsOwner: user ? bot.ownerId === user.discordId || bot.createdBy === user.discordId : false
  };
}

export async function canStartBotByBilling(botId: string) {
  const { botBillingInvoices, devBots } = await getMongoCollections();
  const bot = await devBots.findOne({ _id: botId });
  if (!bot) return { allowed: false, reason: "Bot não encontrado." };
  await markOverdueBotInvoices("bot_start_check");
  const overdue = await botBillingInvoices.findOne({ botId, status: "overdue" });
  if (!overdue || hasValidBotOverride(bot, "bot")) return { allowed: true, reason: null };
  return { allowed: false, reason: "Bot bloqueado por fatura vencida." };
}

export async function generateBotInvoicePix(invoiceId: string, cpfCnpj: string, actor: AuthSessionUser) {
  const { botBillingInvoices, devBots } = await getMongoCollections();
  const invoice = await botBillingInvoices.findOne({ _id: invoiceId });
  if (!invoice) throw Object.assign(new Error("Fatura não encontrada."), { statusCode: 404 });
  const bot = await devBots.findOne({ _id: invoice.botId });
  if (!bot) throw Object.assign(new Error("Bot da fatura não encontrado."), { statusCode: 404 });
  if (bot.ownerId !== actor.discordId && bot.createdBy !== actor.discordId) {
    throw Object.assign(new Error("Você não tem acesso a esta fatura."), { statusCode: 403 });
  }
  if (invoice.status !== "pending" && invoice.status !== "overdue") {
    return toBotBillingInvoiceDto(invoice);
  }
  if (invoice.pixCode && invoice.pixQrCode) return toBotBillingInvoiceDto(invoice);

  const config = getAsaasRuntimeConfig();
  if (!config.enabled) throw Object.assign(new Error("Pagamento Asaas indisponível."), { statusCode: 503 });
  const service = new AsaasPaymentService(config);
  const checkout = await service.createPayment({
    amountInCents: invoice.amountInCents,
    currency: "BRL",
    description: `${invoice.chargeType === "hosting" ? "Hospedagem" : "Plano mensal"} - ${invoice.botName} - ${invoice.dueMonth}`,
    expiresAt: invoice.dueDate,
    idempotencyKey: invoice.idempotencyKey,
    itemId: invoice.botId,
    itemTitle: invoice.botName,
    metadata: {
      botId: invoice.botId,
      invoiceId: invoice._id,
      type: "bot_billing_invoice"
    },
    method: PAYMENT_METHODS.PIX,
    orderId: invoice._id,
    payer: {
      cpfCnpj,
      discordId: actor.discordId,
      email: actor.email ?? null,
      name: actor.globalName || actor.username,
      userId: actor.id ?? actor.discordId
    }
  });
  const updated = await botBillingInvoices.findOneAndUpdate(
    { _id: invoice._id },
    {
      $set: {
        notes: checkout.notes,
        paymentProvider: "asaas",
        pixCode: checkout.pixCode,
        pixQrCode: checkout.qrCode,
        providerPaymentId: checkout.providerOrderId,
        updatedAt: new Date()
      }
    },
    { returnDocument: "after" }
  );
  const next = updated ?? invoice;
  emitRealtime("bot:billing_updated", { botId: invoice.botId, invoice: toBotBillingInvoiceDto(next) });
  return toBotBillingInvoiceDto(next);
}

export async function setBotBillingModel(botId: string, model: MongoBotBillingModel, contractAmountInCents: number | null, actor: AuthSessionUser) {
  const { devBots } = await getMongoCollections();
  const bot = await devBots.findOne({ _id: botId });
  if (!bot) throw Object.assign(new Error("Bot não encontrado."), { statusCode: 404 });
  const previous = bot.billingModel ?? "monthly";
  const amount = model === "lifetime" ? BOT_HOSTING_AMOUNT_IN_CENTS : Math.max(0, contractAmountInCents ?? bot.contractAmountInCents ?? DEFAULT_MONTHLY_CONTRACT_AMOUNT_IN_CENTS);
  const updated = await devBots.findOneAndUpdate(
    { _id: botId },
    {
      $set: {
        billingModel: model,
        contractAmountInCents: amount,
        updatedAt: new Date()
      }
    },
    { returnDocument: "after" }
  );
  await writeBillingAudit(bot, "bot_billing_model_updated", previous, model, "admin", null, actor);
  emitRealtime("dev:bot_updated", { ...(updated ?? bot), billingModel: model });
  return updated;
}

export async function setBotBillingOverride(botId: string, input: BotBillingOverrideInput, actor: AuthSessionUser) {
  if (!input.reason.trim()) throw Object.assign(new Error("Justificativa obrigatória."), { statusCode: 400 });
  const { devBots } = await getMongoCollections();
  const bot = await devBots.findOne({ _id: botId });
  if (!bot) throw Object.assign(new Error("Bot não encontrado."), { statusCode: 404 });
  const now = new Date();
  const updated = await devBots.findOneAndUpdate(
    { _id: botId },
    {
      $set: {
        billingOverride: {
          forceBotActive: input.forceBotActive,
          forceDashboardAccess: input.forceDashboardAccess,
          expiresAt: input.expiresAt ?? null,
          reason: input.reason.trim(),
          createdBy: actor.discordId,
          createdByName: actor.globalName || actor.username,
          createdAt: now,
          updatedAt: now
        },
        updatedAt: now
      }
    },
    { returnDocument: "after" }
  );
  await writeBillingAudit(bot, "bot_billing_override_updated", null, bot.billingModel ?? "monthly", "admin_override", null, actor, {
    forceBotActive: input.forceBotActive,
    forceDashboardAccess: input.forceDashboardAccess,
    overrideExpiresAt: input.expiresAt?.toISOString() ?? null
  });
  return updated;
}

export async function clearBotBillingOverride(botId: string, actor: AuthSessionUser) {
  const { devBots } = await getMongoCollections();
  const bot = await devBots.findOne({ _id: botId });
  if (!bot) throw Object.assign(new Error("Bot não encontrado."), { statusCode: 404 });
  const updated = await devBots.findOneAndUpdate(
    { _id: botId },
    { $set: { billingOverride: null, updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  await writeBillingAudit(bot, "bot_billing_override_removed", null, bot.billingModel ?? "monthly", "admin_override", null, actor);
  return updated;
}

export async function markBotInvoicePaidManually(invoiceId: string, actor: AuthSessionUser, reason: string) {
  if (!reason.trim()) throw Object.assign(new Error("Justificativa obrigatória."), { statusCode: 400 });
  return markBotInvoicePaid(invoiceId, "manual_admin", actor, reason);
}

export async function markBotInvoicePaidFromAsaas(paymentId: string | null, externalReference: string | null) {
  const { botBillingInvoices } = await getMongoCollections();
  const invoice = externalReference
    ? await botBillingInvoices.findOne({ _id: externalReference })
    : paymentId
      ? await botBillingInvoices.findOne({ paymentProvider: "asaas", providerPaymentId: paymentId })
      : null;
  if (!invoice) return null;
  return markBotInvoicePaid(invoice._id, "asaas_webhook", null, null);
}

export async function getBotBillingInvoices(botId: string) {
  const { botBillingInvoices } = await getMongoCollections();
  const invoices = await botBillingInvoices.find({ botId }).sort({ dueDate: -1 }).limit(24).toArray();
  return invoices.map(toBotBillingInvoiceDto);
}

async function markBotInvoicePaid(invoiceId: string, source: string, actor: AuthSessionUser | null, reason: string | null) {
  const { botBillingInvoices, devBots } = await getMongoCollections();
  const invoice = await botBillingInvoices.findOne({ _id: invoiceId });
  if (!invoice) throw Object.assign(new Error("Fatura não encontrada."), { statusCode: 404 });
  if (invoice.status === "paid" || invoice.status === "manually_released") return toBotBillingInvoiceDto(invoice);
  const paidStatus: MongoBotBillingInvoiceStatus = source === "manual_admin" ? "manually_released" : "paid";
  const updated = await botBillingInvoices.findOneAndUpdate(
    { _id: invoiceId, status: { $in: ["pending", "overdue"] } },
    {
      $set: {
        notes: reason ?? "Pagamento confirmado.",
        paidAt: new Date(),
        status: paidStatus,
        statusHistory: appendInvoiceHistory(invoice, paidStatus, source),
        updatedAt: new Date()
      }
    },
    { returnDocument: "after" }
  );
  const bot = await devBots.findOne({ _id: invoice.botId });
  if (bot && bot.desiredOnline !== false) {
    const { startDevBotProcess } = await import("./devBotRuntimeService.js");
    await startDevBotProcess(bot._id).catch(logBillingError);
  }
  if (bot) await writeBillingAudit(bot, source === "manual_admin" ? "bot_invoice_manually_released" : "bot_invoice_paid", null, bot.billingModel ?? "monthly", source, invoiceId, actor, { reason });
  const dto = toBotBillingInvoiceDto(updated ?? invoice);
  emitRealtime("bot:billing_updated", { botId: invoice.botId, invoice: dto });
  return dto;
}

async function ensureInvoiceWhenDashboardOpens(bot: MongoDevBot) {
  const now = new Date();
  if (now.getDate() >= DUE_DAY) await ensureMonthlyBotInvoice(bot, now, "dashboard_access");
}

function invoiceAmount(bot: MongoDevBot) {
  if ((bot.billingModel ?? "monthly") === "lifetime") return BOT_HOSTING_AMOUNT_IN_CENTS;
  return Math.max(0, bot.contractAmountInCents ?? DEFAULT_MONTHLY_CONTRACT_AMOUNT_IN_CENTS);
}

function hasValidBotOverride(bot: MongoDevBot, mode: "bot" | "dashboard") {
  const override = bot.billingOverride;
  if (!override) return false;
  if (override.expiresAt && override.expiresAt.getTime() <= Date.now()) return false;
  return mode === "bot" ? override.forceBotActive === true : override.forceDashboardAccess === true;
}

function dueDateForMonth(date: Date) {
  const due = new Date(date);
  due.setDate(DUE_DAY);
  due.setHours(23, 59, 59, 999);
  return due;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function appendInvoiceHistory(invoice: MongoBotBillingInvoice, status: MongoBotBillingInvoiceStatus, source: string) {
  const history = Array.isArray(invoice.statusHistory) ? invoice.statusHistory.slice(-49) : [];
  history.push({ at: new Date(), from: invoice.status ?? null, source, status });
  return history;
}

function toBotBillingInvoiceDto(invoice: MongoBotBillingInvoice): BotBillingInvoiceDto {
  return {
    id: invoice._id,
    userId: invoice.userId,
    botId: invoice.botId,
    botName: invoice.botName,
    billingModel: invoice.billingModel,
    chargeType: invoice.chargeType,
    amountInCents: invoice.amountInCents,
    currency: invoice.currency,
    dueDate: invoice.dueDate.toISOString(),
    dueMonth: invoice.dueMonth,
    status: invoice.status,
    pixCode: invoice.pixCode,
    pixQrCode: invoice.pixQrCode,
    providerPaymentId: invoice.providerPaymentId,
    paidAt: invoice.paidAt?.toISOString() ?? null,
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString()
  };
}

async function writeBillingAudit(
  bot: MongoDevBot,
  action: string,
  previous: MongoBotBillingModel | null,
  next: MongoBotBillingModel,
  source: string,
  invoiceId: string | null,
  actor?: AuthSessionUser | null,
  metadata: Record<string, unknown> = {}
) {
  const { dashboardAuditLogs } = await getMongoCollections();
  await dashboardAuditLogs.insertOne({
    _id: randomUUID(),
    action,
    botId: bot._id,
    createdAt: new Date(),
    guildId: bot.mainGuildId,
    metadata: {
      botName: bot.name,
      invoiceId,
      next,
      previous,
      source,
      ...metadata
    },
    userId: actor?.discordId ?? null
  });
}

function readNestedString(source: Record<string, unknown> | undefined, path: string[]) {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.trim() ? current.trim() : null;
}

function isDuplicateKeyError(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000;
}

function logBillingError(error: unknown) {
  console.warn("[bot-billing] processamento falhou:", error instanceof Error ? error.message : error);
}

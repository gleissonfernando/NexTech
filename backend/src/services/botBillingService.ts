import { randomUUID } from "node:crypto";
import { getAsaasRuntimeConfig } from "../config/payments";
import {
  getMongoCollections,
  type MongoBotBillingInvoice,
  type MongoBotBillingInvoiceStatus,
  type MongoBotBillingModel,
  type MongoBotPlanPeriod,
  type MongoDevBot
} from "../database/mongo";
import { emitRealtime } from "../realtime/events";
import type { AuthSessionUser } from "../types/session";
import { emitContractInvoiceDm, ensureContractForBotInvoice } from "./contractBillingService";
import { AsaasPaymentService } from "./payments/asaasPaymentService";
import { PAYMENT_METHODS } from "./payments/types";

export const BOT_HOSTING_AMOUNT_IN_CENTS = 1200;
const DEFAULT_MONTHLY_CONTRACT_AMOUNT_IN_CENTS = 1200;
export const BOT_BILLING_DUE_DAY = 7;
const BILLING_JOB_INTERVAL_MS = 6 * 60 * 60 * 1000;
const BOT_BILLING_PAID_STATUSES: MongoBotBillingInvoiceStatus[] = ["paid", "manually_released"];
const OVERDUE_SHUTDOWN_GRACE_MS = 12 * 60 * 60 * 1000;

type MarkOverdueBotInvoicesOptions = {
  botId?: string;
  stopBots?: boolean;
};

export type BotBillingShutdownDecision = {
  allowed: boolean;
  reason: string;
  reasonCode:
    | "invoice_not_overdue"
    | "bot_not_found"
    | "administrative_override"
    | "within_grace_period"
    | "confirmed_overdue";
};

export type BotBillingAccessDto = {
  blocked: boolean;
  blockingInvoice: BotBillingInvoiceDto | null;
  currentInvoice: BotBillingInvoiceDto | null;
  dashboardOverrideActive: boolean;
  forceBotActive: boolean;
  model: MongoBotBillingModel;
  nextDueDate: string | null;
  nextInvoice: BotBillingInvoiceDto | null;
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
  contractedAt: string;
  amountInCents: number;
  currency: "BRL";
  daysOverdue: number;
  dueDate: string;
  dueMonth: string;
  nextDueDate: string;
  planPeriod: MongoBotPlanPeriod;
  status: MongoBotBillingInvoiceStatus;
  statusLabel: string;
  pixCode: string | null;
  pixQrCode: string | null;
  providerPaymentId: string | null;
  pixExpiresAt: string | null;
  dmStatus: "pending" | "sent" | "failed";
  dmSentAt: string | null;
  dmError: string | null;
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
  const overdue = await markOverdueBotInvoices(source, { stopBots: false });
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
  if (today.getDate() < BOT_BILLING_DUE_DAY) return { created: 0, skipped: true };
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
  const now = new Date();
  const model = bot.billingModel ?? "monthly";
  const contractedAt = bot.createdAt instanceof Date ? bot.createdAt : now;
  const planPeriod = planPeriodForBot(bot);
  const dueDate = nextDueDateForPeriod(contractedAt, planPeriod, date);
  const dueStart = new Date(dueDate);
  dueStart.setHours(0, 0, 0, 0);
  if (date.getTime() < dueStart.getTime()) return { created: false, invoice: null };

  const dueMonth = monthKey(dueDate);
  const existing = await botBillingInvoices.findOne({ botId: bot._id, dueMonth });
  if (existing) return { created: false, invoice: existing };

  const invoice: MongoBotBillingInvoice = {
    _id: randomUUID(),
    amountInCents: botBillingAmount(bot),
    billingModel: model,
    botId: bot._id,
    botName: bot.name,
    chargeType: model === "lifetime" ? "hosting" : "monthly_plan",
    contractedAt,
    createdAt: now,
    currency: "BRL",
    dueDate,
    dueMonth,
    idempotencyKey: `bot-invoice:${bot._id}:${dueMonth}`,
    notes: null,
    paidAt: null,
    paymentProvider: "asaas",
    planPeriod,
    pixCode: null,
    pixCopyPaste: null,
    pixExpiresAt: dueDate,
    pixQrCode: null,
    providerPaymentId: null,
    dmAttempts: 0,
    dmError: null,
    dmSentAt: null,
    dmStatus: "pending",
    status: "pending",
    statusHistory: [{ at: now, from: null, source, status: "pending" }],
    updatedAt: now,
    userId: bot.ownerId
  };

  try {
    await botBillingInvoices.insertOne(invoice);
    await ensureContractForBotInvoice(invoice, source);
    await emitContractInvoiceDm(invoice._id, "invoice_created", null).catch(logBillingError);
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

export async function markOverdueBotInvoices(source = "overdue_job", options: MarkOverdueBotInvoicesOptions = {}) {
  const { botBillingInvoices, devBots } = await getMongoCollections();
  const now = new Date();
  const overdueCutoff = new Date(now);
  overdueCutoff.setHours(0, 0, 0, 0);
  const invoices = await botBillingInvoices.find({
    ...(options.botId ? { botId: options.botId } : {}),
    dueDate: { $lt: overdueCutoff },
    status: "pending"
  }).toArray();
  let updated = 0;
  let stopped = 0;

  for (const invoice of invoices) {
    const bot = await devBots.findOne({ _id: invoice.botId });
    const decision = evaluateBotBillingShutdown(bot, invoice, null, now);
    const next = await botBillingInvoices.findOneAndUpdate(
      { _id: invoice._id, status: "pending" },
      {
        $set: {
          notes: decision.allowed
            ? "Fatura vencida sem pagamento confirmado."
            : `Fatura vencida registrada sem desligamento automático: ${decision.reason}`,
          status: "overdue",
          statusHistory: appendInvoiceHistory(invoice, "overdue", source),
          updatedAt: new Date()
        }
      },
      { returnDocument: "after" }
    );
    if (!next) continue;
    updated += 1;

    if (bot && options.stopBots !== false && decision.allowed) {
      const { stopDevBotProcess } = await import("./devBotRuntimeService.js");
      await devBots.updateOne({ _id: bot._id }, { $set: { desiredOnline: false, updatedAt: new Date() } });
      await stopDevBotProcess(bot._id, {
        finalStatus: "stopped_by_payment",
        message: `Bot desligado automaticamente por fatura vencida confirmada (${next._id}, vencimento ${next.dueDate.toISOString()}).`,
        notifyBot: true
      });
      stopped += 1;
    }
    await ensureContractForBotInvoice(next, source).catch(logBillingError);
    await emitContractInvoiceDm(next._id, "overdue", null).catch(logBillingError);
    emitRealtime("bot:billing_updated", { botId: invoice.botId, invoice: toBotBillingInvoiceDto(next) });
  }

  return { stopped, updated };
}

export async function getBotBillingAccess(botId: string, user?: AuthSessionUser | null) {
  const { botBillingInvoices, devBots } = await getMongoCollections();
  const bot = await devBots.findOne({ _id: botId });
  if (!bot) return null;

  await ensureInvoiceWhenDashboardOpens(bot);
  await normalizeOpenBotInvoiceDueDates(bot._id);
  await markOverdueBotInvoices("access_check", { botId, stopBots: false });

  const now = new Date();
  const [currentInvoice, blockingInvoice, nextInvoice, latestInvoice] = await Promise.all([
    botBillingInvoices.findOne({ botId, dueMonth: monthKey(new Date()), status: { $in: ["pending", "overdue"] } }, { sort: { dueDate: -1 } }),
    findBlockingBotBillingInvoice(botId),
    botBillingInvoices.findOne({ botId, status: "pending", dueDate: { $gte: now } }, { sort: { dueDate: 1 } }),
    botBillingInvoices.findOne({ botId }, { sort: { dueDate: -1 } })
  ]);
  const dashboardOverrideActive = hasValidBotOverride(bot, "dashboard", now);
  const blocked = Boolean(blockingInvoice && !dashboardOverrideActive);
  const nextDueDate = (nextInvoice ? normalizedOpenInvoiceDueDate(nextInvoice) : nextDueDateFromLatestInvoice(bot, latestInvoice))?.toISOString() ?? null;

  return {
    blocked,
    blockingInvoice: blockingInvoice ? toBotBillingInvoiceDto(blockingInvoice, bot) : null,
    currentInvoice: currentInvoice ? toBotBillingInvoiceDto(currentInvoice, bot) : null,
    dashboardOverrideActive,
    forceBotActive: hasValidBotOverride(bot, "bot", now),
    model: bot.billingModel ?? "monthly",
    nextDueDate,
    nextInvoice: nextInvoice ? toBotBillingInvoiceDto(nextInvoice, bot) : null,
    overdue: Boolean(blockingInvoice),
    reason: blocked ? "Fatura vencida" : null,
    userIsOwner: user ? bot.ownerId === user.discordId || bot.createdBy === user.discordId : false
  };
}

export async function canStartBotByBilling(botId: string) {
  const { devBots } = await getMongoCollections();
  const bot = await devBots.findOne({ _id: botId });
  if (!bot) return { allowed: false, reason: "Bot não encontrado." };
  if (hasValidBotOverride(bot, "bot")) {
    return { allowed: true, reason: null };
  }
  await normalizeOpenBotInvoiceDueDates(bot._id);
  await markOverdueBotInvoices("bot_start_check", { botId, stopBots: false });
  const overdue = await findBlockingBotBillingInvoice(botId);
  if (!overdue || hasValidBotOverride(bot, "bot")) return { allowed: true, reason: null };
  return { allowed: false, reason: "Bot bloqueado por fatura vencida." };
}

export function evaluateBotBillingShutdown(
  bot: MongoDevBot | null,
  invoice: MongoBotBillingInvoice,
  _latestPaid: MongoBotBillingInvoice | null,
  now = new Date()
): BotBillingShutdownDecision {
  if (!bot) {
    return {
      allowed: false,
      reason: "Bot da fatura não foi encontrado; desligamento automático bloqueado para evitar falso positivo.",
      reasonCode: "bot_not_found"
    };
  }

  if (hasValidBotOverride(bot, "bot", now)) {
    return {
      allowed: false,
      reason: "Bot possui liberação administrativa ativa.",
      reasonCode: "administrative_override"
    };
  }

  const dueAt = normalizedOpenInvoiceDueDate(invoice).getTime();
  if (!Number.isFinite(dueAt) || dueAt >= now.getTime()) {
    return {
      allowed: false,
      reason: "Fatura ainda não venceu de forma confirmada.",
      reasonCode: "invoice_not_overdue"
    };
  }

  if (now.getTime() - dueAt < OVERDUE_SHUTDOWN_GRACE_MS) {
    return {
      allowed: false,
      reason: "Fatura está dentro do período de tolerância para confirmação segura.",
      reasonCode: "within_grace_period"
    };
  }

  return {
    allowed: true,
    reason: "Fatura vencida confirmada sem pagamento posterior, plano vitalício ou liberação administrativa.",
    reasonCode: "confirmed_overdue"
  };
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
    return toBotBillingInvoiceDto(invoice, bot);
  }
  if (invoice.pixCode && invoice.pixQrCode) return toBotBillingInvoiceDto(invoice, bot);

  const config = getAsaasRuntimeConfig();
  if (!config.enabled) throw Object.assign(new Error("Pagamento Asaas indisponível."), { statusCode: 503 });
  const service = new AsaasPaymentService(config);
  const checkout = await service.createPayment({
    amountInCents: effectiveInvoiceAmount(invoice, bot),
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
        amountInCents: effectiveInvoiceAmount(invoice, bot),
        paymentProvider: "asaas",
        pixCode: checkout.pixCode,
        pixCopyPaste: checkout.pixCode,
        pixExpiresAt: normalizedOpenInvoiceDueDate(invoice),
        pixQrCode: checkout.qrCode,
        providerPaymentId: checkout.providerOrderId,
        updatedAt: new Date()
      }
    },
    { returnDocument: "after" }
  );
  const next = updated ?? invoice;
  await ensureContractForBotInvoice(next, "pix_generated");
  await emitContractInvoiceDm(next._id, next.status === "overdue" ? "overdue" : "invoice_created", actor).catch(logBillingError);
  emitRealtime("bot:billing_updated", { botId: invoice.botId, invoice: toBotBillingInvoiceDto(next, bot) });
  return toBotBillingInvoiceDto(next, bot);
}

export async function setBotBillingModel(botId: string, model: MongoBotBillingModel, contractAmountInCents: number | null, actor: AuthSessionUser) {
  const { devBots } = await getMongoCollections();
  const bot = await devBots.findOne({ _id: botId });
  if (!bot) throw Object.assign(new Error("Bot não encontrado."), { statusCode: 404 });
  const previous = bot.billingModel ?? "monthly";
  const amount = model === "lifetime"
    ? BOT_HOSTING_AMOUNT_IN_CENTS
    : Math.max(BOT_HOSTING_AMOUNT_IN_CENTS, contractAmountInCents ?? bot.contractAmountInCents ?? DEFAULT_MONTHLY_CONTRACT_AMOUNT_IN_CENTS);
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
  emitRealtime("bot:billing_updated", { botId });
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
  emitRealtime("bot:billing_updated", { botId });
  return updated;
}

export async function setBotBillingRecipients(botId: string, userIds: string[], actor: AuthSessionUser) {
  const { devBots } = await getMongoCollections();
  const bot = await devBots.findOne({ _id: botId });
  if (!bot) throw Object.assign(new Error("Bot não encontrado."), { statusCode: 404 });
  const recipients = normalizeBillingRecipientUserIds(userIds);
  const updated = await devBots.findOneAndUpdate(
    { _id: botId },
    {
      $set: {
        billingRecipientUserIds: recipients,
        updatedAt: new Date()
      }
    },
    { returnDocument: "after" }
  );
  await writeBillingAudit(bot, "bot_billing_recipients_updated", null, bot.billingModel ?? "monthly", "admin", null, actor, {
    recipientCount: recipients.length
  });
  emitRealtime("bot:billing_updated", { botId });
  return updated;
}

export async function sendBotBillingRecipientDm(botId: string, userId: string, actor: AuthSessionUser) {
  const normalizedUserId = normalizeBillingRecipientUserIds([userId])[0];
  if (!normalizedUserId) throw Object.assign(new Error("ID de usuário inválido."), { statusCode: 400 });

  const { botBillingInvoices, devBots } = await getMongoCollections();
  const bot = await devBots.findOne({ _id: botId });
  if (!bot) throw Object.assign(new Error("Bot não encontrado."), { statusCode: 404 });

  const configuredRecipients = normalizeBillingRecipientUserIds(bot.billingRecipientUserIds ?? []);
  if (!configuredRecipients.includes(normalizedUserId)) {
    throw Object.assign(new Error("Usuário não está cadastrado como destinatário desta cobrança."), { statusCode: 400 });
  }

  const invoice = await findLatestChargeableBotInvoice(botId);
  if (!invoice) {
    throw Object.assign(new Error("Nenhuma fatura pendente ou vencida encontrada para enviar."), { statusCode: 404 });
  }

  const dm = await emitContractInvoiceDm(
    invoice._id,
    invoice.status === "overdue" ? "overdue" : "invoice_created",
    actor,
    { recipientUserId: normalizedUserId }
  );
  await writeBillingAudit(bot, "bot_invoice_dm_sent_manually", null, bot.billingModel ?? "monthly", "admin", invoice._id, actor, {
    recipientUserId: normalizedUserId
  });
  return {
    dm,
    invoice: toBotBillingInvoiceDto(invoice, bot)
  };
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
  emitRealtime("bot:billing_updated", { botId });
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
  const { botBillingInvoices, devBots } = await getMongoCollections();
  await normalizeOpenBotInvoiceDueDates(botId);
  const [bot, invoices] = await Promise.all([
    devBots.findOne({ _id: botId }),
    botBillingInvoices.find({ botId }).sort({ dueDate: -1 }).limit(24).toArray()
  ]);
  return invoices.map((invoice) => toBotBillingInvoiceDto(invoice, bot));
}

async function markBotInvoicePaid(invoiceId: string, source: string, actor: AuthSessionUser | null, reason: string | null) {
  const { botBillingInvoices, devBots } = await getMongoCollections();
  const invoice = await botBillingInvoices.findOne({ _id: invoiceId });
  if (!invoice) throw Object.assign(new Error("Fatura não encontrada."), { statusCode: 404 });
  if (BOT_BILLING_PAID_STATUSES.includes(invoice.status)) {
    const bot = await devBots.findOne({ _id: invoice.botId });
    if (bot) {
      await ensureNextBotInvoiceAfterPayment(bot, invoice, source);
      await ensurePaidBotOnlineIfBillingAllows(bot);
    }
    return toBotBillingInvoiceDto(invoice, bot);
  }
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
  if (bot) {
    const paidInvoice = updated ?? { ...invoice, status: paidStatus, paidAt: new Date() };
    await ensureNextBotInvoiceAfterPayment(bot, paidInvoice, source);
    await ensurePaidBotOnlineIfBillingAllows(bot);
    await writeBillingAudit(bot, source === "manual_admin" ? "bot_invoice_manually_released" : "bot_invoice_paid", null, bot.billingModel ?? "monthly", source, invoiceId, actor, { reason });
  }
  const paidInvoice = updated ?? invoice;
  await ensureContractForBotInvoice(paidInvoice, source).catch(logBillingError);
  await emitContractInvoiceDm(paidInvoice._id, source === "manual_admin" ? "contract_activated" : "payment_confirmed", actor).catch(logBillingError);
  const dto = toBotBillingInvoiceDto(paidInvoice, bot);
  emitRealtime("bot:billing_updated", { botId: invoice.botId, invoice: dto });
  return dto;
}

async function findBlockingBotBillingInvoice(botId: string) {
  const { botBillingInvoices } = await getMongoCollections();
  return botBillingInvoices.findOne(
    {
      botId,
      status: "overdue"
    },
    { sort: { dueDate: 1 } }
  );
}

async function findLatestChargeableBotInvoice(botId: string) {
  const { botBillingInvoices } = await getMongoCollections();
  return botBillingInvoices.findOne(
    { botId, status: { $in: ["overdue", "pending"] } },
    { sort: { status: 1, dueDate: -1 } }
  );
}

async function normalizeOpenBotInvoiceDueDates(botId: string) {
  const { botBillingInvoices } = await getMongoCollections();
  const invoices = await botBillingInvoices.find({ botId, status: { $in: ["pending", "overdue"] } }).toArray();
  for (const invoice of invoices) {
    const dueDate = normalizedOpenInvoiceDueDate(invoice);
    if (dueDate.getTime() === invoice.dueDate.getTime() && monthKey(dueDate) === invoice.dueMonth) continue;
    await botBillingInvoices.updateOne(
      { _id: invoice._id },
      {
        $set: {
          dueDate,
          dueMonth: monthKey(dueDate),
          updatedAt: new Date()
        }
      }
    );
  }
}

async function ensureNextBotInvoiceAfterPayment(bot: MongoDevBot, paidInvoice: MongoBotBillingInvoice, source: string) {
  const { botBillingInvoices } = await getMongoCollections();
  const now = new Date();
  const planPeriod = paidInvoice.planPeriod ?? planPeriodForBot(bot);
  const nextDueDate = nextDueDateAfterInvoice(paidInvoice, planPeriod, now);
  const dueMonth = monthKey(nextDueDate);
  const existing = await botBillingInvoices.findOne({ botId: bot._id, dueMonth });
  if (existing) return existing;

  const invoice: MongoBotBillingInvoice = {
    _id: randomUUID(),
    amountInCents: botBillingAmount(bot),
    billingModel: bot.billingModel ?? paidInvoice.billingModel,
    botId: bot._id,
    botName: bot.name,
    chargeType: (bot.billingModel ?? paidInvoice.billingModel) === "lifetime" ? "hosting" : "monthly_plan",
    contractedAt: paidInvoice.contractedAt ?? paidInvoice.createdAt,
    createdAt: now,
    currency: "BRL",
    dueDate: nextDueDate,
    dueMonth,
    idempotencyKey: `bot-invoice:${bot._id}:${dueMonth}`,
    notes: null,
    paidAt: null,
    paymentProvider: "asaas",
    planPeriod,
    pixCode: null,
    pixCopyPaste: null,
    pixExpiresAt: nextDueDate,
    pixQrCode: null,
    providerPaymentId: null,
    dmAttempts: 0,
    dmError: null,
    dmSentAt: null,
    dmStatus: "pending",
    status: "pending",
    statusHistory: [{ at: now, from: null, source: `${source}_next_invoice`, status: "pending" }],
    updatedAt: now,
    userId: bot.ownerId
  };

  try {
    await botBillingInvoices.insertOne(invoice);
    await ensureContractForBotInvoice(invoice, `${source}_next_invoice`);
    emitRealtime("bot:billing_updated", { botId: bot._id, invoice: toBotBillingInvoiceDto(invoice, bot) });
    return invoice;
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return await botBillingInvoices.findOne({ botId: bot._id, dueMonth });
    }
    throw error;
  }
}

async function ensurePaidBotOnlineIfBillingAllows(bot: MongoDevBot) {
  if (!hasValidBotOverride(bot, "bot") && await findBlockingBotBillingInvoice(bot._id)) {
    return;
  }
  const { devBots } = await getMongoCollections();
  await devBots.updateOne({ _id: bot._id }, { $set: { desiredOnline: true, updatedAt: new Date() } });
  const { startDevBotProcess } = await import("./devBotRuntimeService.js");
  await startDevBotProcess(bot._id).catch(logBillingError);
}

async function ensureInvoiceWhenDashboardOpens(bot: MongoDevBot) {
  const now = new Date();
  if (now.getDate() >= BOT_BILLING_DUE_DAY) await ensureMonthlyBotInvoice(bot, now, "dashboard_access");
}

function botBillingAmount(bot: MongoDevBot) {
  if ((bot.billingModel ?? "monthly") === "lifetime") return BOT_HOSTING_AMOUNT_IN_CENTS;
  return Math.max(BOT_HOSTING_AMOUNT_IN_CENTS, bot.contractAmountInCents ?? DEFAULT_MONTHLY_CONTRACT_AMOUNT_IN_CENTS);
}

function effectiveInvoiceAmount(invoice: MongoBotBillingInvoice, bot?: MongoDevBot | null) {
  if (invoice.amountInCents > 0) return invoice.amountInCents;
  if (bot && invoice.chargeType === "monthly_plan") return botBillingAmount(bot);
  return BOT_HOSTING_AMOUNT_IN_CENTS;
}

function hasValidBotOverride(bot: MongoDevBot, mode: "bot" | "dashboard", now = new Date()) {
  const override = bot.billingOverride;
  if (!override) return false;
  if (override.expiresAt && override.expiresAt.getTime() <= now.getTime()) return false;
  return mode === "bot" ? override.forceBotActive === true : override.forceDashboardAccess === true;
}

function dueDateForMonth(date: Date) {
  const due = new Date(date);
  due.setDate(BOT_BILLING_DUE_DAY);
  due.setHours(23, 59, 59, 999);
  return due;
}

function planPeriodForBot(bot: MongoDevBot): MongoBotPlanPeriod {
  if ((bot.billingModel ?? "monthly") === "lifetime") return "lifetime";
  if (bot.billingPeriod === "quarterly" || bot.billingPeriod === "annual") return bot.billingPeriod;
  return "monthly";
}

function planPeriodMonths(period: MongoBotPlanPeriod) {
  if (period === "quarterly") return 3;
  if (period === "annual") return 12;
  return 1;
}

function nextDueDateForPeriod(contractedAt: Date, period: MongoBotPlanPeriod, referenceDate = new Date()) {
  const months = planPeriodMonths(period);
  const elapsedMonths = Math.max(
    0,
    (referenceDate.getFullYear() - contractedAt.getFullYear()) * 12 + referenceDate.getMonth() - contractedAt.getMonth()
  );
  const periodsElapsed = Math.max(1, Math.ceil((elapsedMonths || 1) / months));
  const due = dueDateForMonth(contractedAt);
  due.setMonth(contractedAt.getMonth() + periodsElapsed * months);
  due.setDate(BOT_BILLING_DUE_DAY);
  return due;
}

function nextDueDateAfterInvoice(invoice: MongoBotBillingInvoice, period: MongoBotPlanPeriod, referenceDate = new Date()) {
  const due = dueDateForMonth(invoice.dueDate);
  do {
    due.setMonth(due.getMonth() + planPeriodMonths(period));
    due.setDate(BOT_BILLING_DUE_DAY);
  } while (due.getTime() <= referenceDate.getTime());
  return due;
}

function nextDueDateFromLatestInvoice(bot: MongoDevBot, invoice: MongoBotBillingInvoice | null) {
  if (invoice) {
    return invoice.status === "pending" || invoice.status === "overdue"
      ? normalizedOpenInvoiceDueDate(invoice)
      : nextDueDateAfterInvoice(invoice, invoice.planPeriod ?? planPeriodForBot(bot));
  }
  return nextDueDateForPeriod(bot.createdAt, planPeriodForBot(bot));
}

export function nextBotBillingDueDateForTest(contractedAt: Date, period: MongoBotPlanPeriod, referenceDate = new Date()) {
  return nextDueDateForPeriod(contractedAt, period, referenceDate);
}

export function nextBotBillingDueDateAfterInvoiceForTest(invoice: MongoBotBillingInvoice, period: MongoBotPlanPeriod, referenceDate = new Date()) {
  return nextDueDateAfterInvoice(invoice, period, referenceDate);
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function appendInvoiceHistory(invoice: MongoBotBillingInvoice, status: MongoBotBillingInvoiceStatus, source: string) {
  const history = Array.isArray(invoice.statusHistory) ? invoice.statusHistory.slice(-49) : [];
  history.push({ at: new Date(), from: invoice.status ?? null, source, status });
  return history;
}

function normalizedOpenInvoiceDueDate(invoice: MongoBotBillingInvoice) {
  if (BOT_BILLING_PAID_STATUSES.includes(invoice.status) || invoice.status === "cancelled") return invoice.dueDate;
  return dueDateForMonth(invoice.dueDate);
}

function toBotBillingInvoiceDto(invoice: MongoBotBillingInvoice, bot?: MongoDevBot | null): BotBillingInvoiceDto {
  const contractedAt = invoice.contractedAt ?? invoice.createdAt;
  const planPeriod = invoice.planPeriod ?? (invoice.billingModel === "lifetime" ? "lifetime" : "monthly");
  const dueDate = normalizedOpenInvoiceDueDate(invoice);
  const daysOverdue = invoice.status === "overdue"
    ? Math.max(1, Math.floor((Date.now() - dueDate.getTime()) / 86_400_000))
    : 0;

  return {
    id: invoice._id,
    userId: invoice.userId,
    botId: invoice.botId,
    botName: invoice.botName,
    billingModel: invoice.billingModel,
    chargeType: invoice.chargeType,
    contractedAt: contractedAt.toISOString(),
    amountInCents: effectiveInvoiceAmount(invoice, bot),
    currency: invoice.currency,
    daysOverdue,
    dueDate: dueDate.toISOString(),
    dueMonth: invoice.dueMonth,
    nextDueDate: dueDate.toISOString(),
    planPeriod,
    status: invoice.status,
    statusLabel: invoiceStatusLabel(invoice.status),
    pixCode: invoice.pixCopyPaste ?? invoice.pixCode,
    pixQrCode: invoice.pixQrCode,
    providerPaymentId: invoice.providerPaymentId,
    pixExpiresAt: invoice.pixExpiresAt?.toISOString() ?? null,
    dmStatus: invoice.dmStatus ?? "pending",
    dmSentAt: invoice.dmSentAt?.toISOString() ?? null,
    dmError: invoice.dmError ?? null,
    paidAt: invoice.paidAt?.toISOString() ?? null,
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString()
  };
}

function invoiceStatusLabel(status: MongoBotBillingInvoiceStatus) {
  if (status === "overdue") return "Fatura vencida";
  if (status === "pending") return "Pagamento pendente";
  if (status === "paid") return "Ativo";
  if (status === "manually_released") return "Liberado manualmente";
  return "Cancelada";
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

export function normalizeBillingRecipientUserIds(userIds: string[]) {
  return [...new Set(userIds.map((id) => id.replace(/\D/g, "")).filter((id) => /^\d{5,32}$/.test(id)))].slice(0, 20);
}

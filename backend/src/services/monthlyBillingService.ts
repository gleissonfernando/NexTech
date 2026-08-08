import { randomUUID } from "node:crypto";
import {
  getMongoCollections,
  type MongoDevBot,
  type MongoMonthlyBillingCharge,
  type MongoMonthlyBillingCustomer,
  type MongoMonthlyBillingCustomerStatus
} from "../database/mongo";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoom } from "../realtime/events";
import type { AuthSessionUser } from "../types/session";

const DISCORD_ID_PATTERN = /^\d{5,32}$/;
const DEFAULT_SUPPORT_URL = "https://nextech.discloud.app/invite/nextech";
const DEFAULT_PAYMENT_URL = "https://nextech.discloud.app/planos";

export type MonthlyBillingCustomerInput = {
  discordUserId: string;
  customerName: string;
  monthlyAmountInCents: number;
  dueDate: Date;
  fixedDueDay: number;
  subscriptionStartDate: Date;
  planName: string;
  notes?: string | null;
  initialOverdueMonths?: number;
  supportUrl?: string | null;
  paymentUrl?: string | null;
  receiptUrl?: string | null;
};

export type MonthlyBillingPaymentInput = {
  amountInCents: number;
  installmentsPaid: number;
  paidAt: Date;
  method: string;
  transactionCode?: string | null;
  receiptUrl?: string | null;
  notes?: string | null;
};

export type MonthlyBillingCustomerPatchInput = Partial<Pick<MonthlyBillingCustomerInput,
  "customerName" | "monthlyAmountInCents" | "dueDate" | "fixedDueDay" | "subscriptionStartDate" | "planName" | "notes" | "supportUrl" | "paymentUrl" | "receiptUrl"
>>;

export type MonthlyBillingAdjustmentInput = {
  type: "manual_debit" | "discount" | "fine" | "interest";
  amountInCents: number;
  reason: string;
};

export async function listMonthlyBillingDashboard() {
  const { devBots, monthlyBillingCustomers, monthlyBillingCharges, monthlyBillingPayments, users } = await getMongoCollections();
  const [bots, customers, charges, payments] = await Promise.all([
    devBots.find({}).sort({ updatedAt: -1 }).toArray(),
    monthlyBillingCustomers.find({ deletedAt: null }).sort({ updatedAt: -1 }).toArray(),
    monthlyBillingCharges.find({ createdAt: { $gte: startOfMonth(new Date()) } }).toArray(),
    monthlyBillingPayments.find({ paidAt: { $gte: startOfMonth(new Date()) } }).toArray()
  ]);
  const usersById = new Map((await users.find({ discordId: { $in: customers.map((item) => item.discordUserId) } }).toArray()).map((user) => [user.discordId, user]));
  const customerDtos = customers.map((customer) => toCustomerDto(customer, bots.find((bot) => bot._id === customer.botId) ?? null, usersById.get(customer.discordUserId) ?? null));
  const botDtos = bots.map((bot) => {
    const scoped = customerDtos.filter((customer) => customer.botId === bot._id && customer.status !== "Cancelado");
    const overdueMonths = scoped.reduce((sum, customer) => sum + customer.overdueMonths, 0);
    return {
      id: bot._id,
      name: bot.name,
      avatarUrl: bot.avatarUrl,
      projectName: bot.mainGuildName ?? bot.mainGuildId,
      clientId: bot.clientId,
      status: bot.maintenance ? "maintenance" : normalizeBotStatus(bot.status),
      customerCount: scoped.length,
      overdueMonths,
      paidCustomers: scoped.filter((customer) => customer.overdueMonths === 0).length,
      totalPendingInCents: scoped.reduce((sum, customer) => sum + customer.totalDueInCents, 0),
      nextDueDate: minIso(scoped.map((customer) => customer.nextDueDate).filter(Boolean) as string[]),
      customers: scoped
    };
  });
  return {
    bots: botDtos,
    summary: {
      totalCustomers: customerDtos.filter((customer) => customer.status !== "Cancelado").length,
      paidCustomers: customerDtos.filter((customer) => customer.overdueMonths === 0 && customer.status !== "Cancelado").length,
      overdueCustomers: customerDtos.filter((customer) => customer.overdueMonths > 0 && customer.status !== "Cancelado").length,
      overdueMonths: customerDtos.reduce((sum, customer) => sum + customer.overdueMonths, 0),
      totalReceivableInCents: customerDtos.reduce((sum, customer) => sum + customer.totalDueInCents, 0),
      chargesSentThisMonth: charges.filter((charge) => charge.status === "sent").length,
      dmFailuresThisMonth: charges.filter((charge) => charge.status === "failed").length,
      suspendedServices: customerDtos.filter((customer) => customer.status === "Suspenso").length,
      paymentsReceivedThisMonthInCents: payments.reduce((sum, payment) => sum + payment.amountInCents, 0)
    }
  };
}

export async function createMonthlyBillingCustomer(botId: string, input: MonthlyBillingCustomerInput, actor: AuthSessionUser) {
  const { monthlyBillingCustomers, users } = await getMongoCollections();
  const bot = await requireActiveBot(botId);
  const discordUserId = normalizeDiscordId(input.discordUserId);
  const user = await users.findOne({ discordId: discordUserId });
  if (!user) throw Object.assign(new Error("Usuário Discord não encontrado na plataforma."), { statusCode: 404 });
  const existing = await monthlyBillingCustomers.findOne({ botId, discordUserId, deletedAt: null });
  if (existing) throw Object.assign(new Error("Este usuário já está cadastrado neste bot."), { statusCode: 409 });
  const now = new Date();
  const customer: MongoMonthlyBillingCustomer = {
    _id: randomUUID(),
    tenantId: tenantIdForBot(bot),
    botId,
    discordUserId,
    customerName: trimRequired(input.customerName, 100, "Nome do cliente"),
    planName: trimRequired(input.planName, 120, "Plano contratado"),
    monthlyAmountInCents: Math.max(0, Math.trunc(input.monthlyAmountInCents)),
    fixedDueDay: clamp(Math.trunc(input.fixedDueDay), 1, 28),
    firstDueDate: input.dueDate,
    subscriptionStartDate: input.subscriptionStartDate,
    initialOverdueMonths: clamp(Math.trunc(input.initialOverdueMonths ?? 0), 0, 60),
    paidInstallments: 0,
    discountInCents: 0,
    fineInCents: 0,
    interestInCents: 0,
    notes: trim(input.notes, 1000),
    supportUrl: trim(input.supportUrl, 2048) ?? DEFAULT_SUPPORT_URL,
    paymentUrl: trim(input.paymentUrl, 2048) ?? DEFAULT_PAYMENT_URL,
    receiptUrl: trim(input.receiptUrl, 2048) ?? DEFAULT_SUPPORT_URL,
    status: "active",
    suspendedAt: null,
    cancelledAt: null,
    deletedAt: null,
    lastChargeAt: null,
    lastChargeStatus: null,
    lastChargeError: null,
    lastPaymentAt: null,
    createdBy: actor.discordId,
    createdByName: actor.globalName || actor.username,
    createdAt: now,
    updatedAt: now
  };
  await monthlyBillingCustomers.insertOne(customer);
  await writeMonthlyLog(bot, customer, "customer_created", actor, "Cliente cadastrado em mensalidades.", { input: publicInput(input) });
  return listMonthlyBillingDashboard();
}

export async function updateMonthlyBillingCustomer(customerId: string, input: MonthlyBillingCustomerPatchInput, actor: AuthSessionUser) {
  const { devBots, monthlyBillingCustomers } = await getMongoCollections();
  const customer = await monthlyBillingCustomers.findOne({ _id: customerId, deletedAt: null });
  if (!customer) throw Object.assign(new Error("Cliente não encontrado."), { statusCode: 404 });
  const bot = await devBots.findOne({ _id: customer.botId });
  if (!bot) throw Object.assign(new Error("Bot não encontrado."), { statusCode: 404 });
  const patch: Partial<MongoMonthlyBillingCustomer> = { updatedAt: new Date() };
  if (input.customerName !== undefined) patch.customerName = trimRequired(input.customerName, 100, "Nome do cliente");
  if (input.planName !== undefined) patch.planName = trimRequired(input.planName, 120, "Plano contratado");
  if (input.monthlyAmountInCents !== undefined) patch.monthlyAmountInCents = Math.max(0, Math.trunc(input.monthlyAmountInCents));
  if (input.dueDate !== undefined) patch.firstDueDate = input.dueDate;
  if (input.fixedDueDay !== undefined) patch.fixedDueDay = clamp(Math.trunc(input.fixedDueDay), 1, 28);
  if (input.subscriptionStartDate !== undefined) patch.subscriptionStartDate = input.subscriptionStartDate;
  if (input.notes !== undefined) patch.notes = trim(input.notes, 1000);
  if (input.supportUrl !== undefined) patch.supportUrl = trim(input.supportUrl, 2048);
  if (input.paymentUrl !== undefined) patch.paymentUrl = trim(input.paymentUrl, 2048);
  if (input.receiptUrl !== undefined) patch.receiptUrl = trim(input.receiptUrl, 2048);
  await monthlyBillingCustomers.updateOne({ _id: customer._id }, { $set: patch });
  await writeMonthlyLog(bot, customer, "customer_updated", actor, "Cadastro do cliente atualizado.", { previous: customerSnapshot(customer), next: patch });
  return listMonthlyBillingDashboard();
}

export async function applyMonthlyBillingAdjustment(customerId: string, input: MonthlyBillingAdjustmentInput, actor: AuthSessionUser) {
  const { devBots, monthlyBillingCustomers } = await getMongoCollections();
  const customer = await monthlyBillingCustomers.findOne({ _id: customerId, deletedAt: null });
  if (!customer) throw Object.assign(new Error("Cliente não encontrado."), { statusCode: 404 });
  const bot = await devBots.findOne({ _id: customer.botId });
  if (!bot) throw Object.assign(new Error("Bot não encontrado."), { statusCode: 404 });
  const amount = Math.max(0, Math.trunc(input.amountInCents));
  const inc = input.type === "discount"
    ? { discountInCents: amount }
    : input.type === "fine"
      ? { fineInCents: amount }
      : input.type === "interest"
        ? { interestInCents: amount }
        : { fineInCents: amount };
  await monthlyBillingCustomers.updateOne({ _id: customer._id }, { $inc: inc, $set: { updatedAt: new Date() } });
  await writeMonthlyLog(bot, customer, input.type, actor, "Ajuste financeiro aplicado.", { amountInCents: amount, reason: trimRequired(input.reason, 500, "Motivo") });
  return listMonthlyBillingDashboard();
}

export async function setMonthlyBillingCustomerStatus(customerId: string, action: "suspend" | "reactivate" | "cancel" | "delete", actor: AuthSessionUser, reason?: string | null) {
  const { devBots, monthlyBillingCustomers } = await getMongoCollections();
  const customer = await monthlyBillingCustomers.findOne({ _id: customerId, deletedAt: null });
  if (!customer) throw Object.assign(new Error("Cliente não encontrado."), { statusCode: 404 });
  const bot = await devBots.findOne({ _id: customer.botId });
  if (!bot) throw Object.assign(new Error("Bot não encontrado."), { statusCode: 404 });
  const now = new Date();
  const patch: Partial<MongoMonthlyBillingCustomer> = { updatedAt: now };
  if (action === "suspend") {
    await sendMonthlyBillingCharge(customer._id, actor).catch(() => null);
    patch.status = "suspended";
    patch.suspendedAt = now;
  } else if (action === "reactivate") {
    patch.status = "active";
    patch.suspendedAt = null;
    patch.cancelledAt = null;
  } else if (action === "cancel") {
    patch.status = "cancelled";
    patch.cancelledAt = now;
  } else {
    patch.status = "deleted";
    patch.deletedAt = now;
  }
  await monthlyBillingCustomers.updateOne({ _id: customer._id }, { $set: patch });
  const actionMap = { cancel: "subscription_cancelled", delete: "customer_removed", reactivate: "service_reactivated", suspend: "service_suspended" };
  await writeMonthlyLog(bot, customer, actionMap[action], actor, "Status do cliente alterado.", { action, reason: trim(reason, 500), previousStatus: customer.status, nextStatus: patch.status });
  return listMonthlyBillingDashboard();
}

export async function sendMonthlyBillingCharge(customerId: string, actor: AuthSessionUser) {
  const { monthlyBillingCharges, monthlyBillingCustomers, users } = await getMongoCollections();
  const customer = await monthlyBillingCustomers.findOne({ _id: customerId, deletedAt: null });
  if (!customer) throw Object.assign(new Error("Cliente não encontrado."), { statusCode: 404 });
  const bot = await requireActiveBot(customer.botId);
  const computed = computeCustomerBilling(customer);
  const now = new Date();
  const charge: MongoMonthlyBillingCharge = {
    _id: randomUUID(),
    tenantId: customer.tenantId,
    botId: customer.botId,
    customerId: customer._id,
    discordUserId: customer.discordUserId,
    notificationType: computed.overdueMonths > 0 ? "overdue" : "invoice_created",
    overdueMonths: computed.overdueMonths,
    totalDueInCents: computed.totalDueInCents,
    oldestDueDate: computed.oldestDueDate,
    status: "pending",
    error: null,
    sentAt: null,
    createdBy: actor.discordId,
    createdByName: actor.globalName || actor.username,
    createdAt: now,
    updatedAt: now
  };
  await monthlyBillingCharges.insertOne(charge);
  await monthlyBillingCustomers.updateOne({ _id: customer._id }, { $set: { lastChargeAt: now, lastChargeStatus: "pending", lastChargeError: null, updatedAt: now } });
  const user = await users.findOne({ discordId: customer.discordUserId });
  const payload = {
    actionLinks: {
      paymentUrl: customer.paymentUrl ?? DEFAULT_PAYMENT_URL,
      receiptUrl: customer.receiptUrl ?? DEFAULT_SUPPORT_URL,
      supportUrl: customer.supportUrl ?? DEFAULT_SUPPORT_URL
    },
    botId: bot._id,
    contractId: customer._id,
    dashboardUrl: customer.paymentUrl ?? DEFAULT_PAYMENT_URL,
    event: charge.notificationType,
    invoice: {
      amountInCents: computed.totalDueInCents,
      currency: "BRL" as const,
      dueDate: computed.oldestDueDate?.toISOString() ?? computed.nextDueDate.toISOString(),
      id: charge._id,
      pixCopyPaste: null,
      pixExpiresAt: null,
      pixQrCode: null,
      status: computed.overdueMonths > 0 ? "atrasada" : "pendente"
    },
    items: [{ name: customer.planName, quantity: Math.max(1, computed.overdueMonths), status: computed.statusLabel }],
    planName: customer.planName,
    serverId: bot.mainGuildId,
    serverName: bot.mainGuildName ?? bot.mainGuildId,
    serviceName: bot.name,
    user: {
      discordAvatar: user?.avatarUrl ?? user?.avatar ?? null,
      discordDisplayName: customer.customerName,
      discordUserId: customer.discordUserId,
      discordUsername: user?.username ?? null,
      email: user?.email ?? null
    }
  };
  emitRealtimeToRoom(devBotRealtimeRoom(bot._id), "contract-billing:send_dm", payload);
  emitRealtime("contract-billing:send_dm", payload);
  await writeMonthlyLog(bot, customer, "charge_requested", actor, "Cobrança enviada para fila de DM.", { chargeId: charge._id });
  return { chargeId: charge._id, dashboard: await listMonthlyBillingDashboard() };
}

export async function sendMonthlyBillingBulkCharges(customerIds: string[], actor: AuthSessionUser) {
  const uniqueIds = [...new Set(customerIds.map((id) => id.trim()).filter(Boolean))].slice(0, 500);
  const results = [];
  for (const customerId of uniqueIds) {
    try {
      results.push({ customerId, ok: true, result: await sendMonthlyBillingCharge(customerId, actor) });
      await new Promise((resolve) => setTimeout(resolve, 900));
    } catch (error) {
      results.push({ customerId, ok: false, error: error instanceof Error ? error.message : "Falha ao enviar cobrança." });
    }
  }
  return { dashboard: await listMonthlyBillingDashboard(), results };
}

export async function registerMonthlyBillingPayment(customerId: string, input: MonthlyBillingPaymentInput, actor: AuthSessionUser) {
  const { devBots, monthlyBillingCustomers, monthlyBillingPayments } = await getMongoCollections();
  const customer = await monthlyBillingCustomers.findOne({ _id: customerId, deletedAt: null });
  if (!customer) throw Object.assign(new Error("Cliente não encontrado."), { statusCode: 404 });
  const bot = await devBots.findOne({ _id: customer.botId });
  if (!bot) throw Object.assign(new Error("Bot não encontrado."), { statusCode: 404 });
  const installmentsPaid = clamp(Math.trunc(input.installmentsPaid), 1, 60);
  const now = new Date();
  await monthlyBillingPayments.insertOne({
    _id: randomUUID(),
    tenantId: customer.tenantId,
    botId: customer.botId,
    customerId: customer._id,
    discordUserId: customer.discordUserId,
    amountInCents: Math.max(0, Math.trunc(input.amountInCents)),
    installmentsPaid,
    paidAt: input.paidAt,
    method: trimRequired(input.method, 80, "Forma de pagamento"),
    transactionCode: trim(input.transactionCode, 160),
    receiptUrl: trim(input.receiptUrl, 2048),
    notes: trim(input.notes, 1000),
    createdBy: actor.discordId,
    createdByName: actor.globalName || actor.username,
    createdAt: now
  });
  const nextPaidInstallments = customer.paidInstallments + installmentsPaid;
  const nextStatus: MongoMonthlyBillingCustomerStatus = customer.status === "suspended" && computeCustomerBilling({ ...customer, paidInstallments: nextPaidInstallments }).overdueMonths === 0
    ? "active"
    : customer.status;
  await monthlyBillingCustomers.updateOne(
    { _id: customer._id },
    { $set: { lastPaymentAt: input.paidAt, paidInstallments: nextPaidInstallments, status: nextStatus, updatedAt: now } }
  );
  await writeMonthlyLog(bot, customer, "payment_registered", actor, "Pagamento registrado.", { installmentsPaid, amountInCents: input.amountInCents });
  return listMonthlyBillingDashboard();
}

export async function getMonthlyBillingCustomerHistory(customerId: string) {
  const { monthlyBillingCharges, monthlyBillingLogs, monthlyBillingPayments } = await getMongoCollections();
  const [charges, logs, payments] = await Promise.all([
    monthlyBillingCharges.find({ customerId }).sort({ createdAt: -1 }).limit(100).toArray(),
    monthlyBillingLogs.find({ customerId }).sort({ createdAt: -1 }).limit(200).toArray(),
    monthlyBillingPayments.find({ customerId }).sort({ paidAt: -1 }).limit(100).toArray()
  ]);
  return {
    charges: charges.map((charge) => ({ ...charge, createdAt: charge.createdAt.toISOString(), updatedAt: charge.updatedAt.toISOString(), oldestDueDate: charge.oldestDueDate?.toISOString() ?? null, sentAt: charge.sentAt?.toISOString() ?? null })),
    logs: logs.map((log) => ({ ...log, createdAt: log.createdAt.toISOString() })),
    payments: payments.map((payment) => ({ ...payment, createdAt: payment.createdAt.toISOString(), paidAt: payment.paidAt.toISOString() }))
  };
}

export async function updateMonthlyBillingChargeResult(chargeId: string, ok: boolean, error?: string | null) {
  const { monthlyBillingCharges, monthlyBillingCustomers, monthlyBillingLogs } = await getMongoCollections();
  const now = new Date();
  const charge = await monthlyBillingCharges.findOneAndUpdate(
    { _id: chargeId },
    { $set: { error: ok ? null : trim(error, 500) ?? "Falha no envio - DM fechada.", sentAt: ok ? now : null, status: ok ? "sent" : "failed", updatedAt: now } },
    { returnDocument: "after" }
  );
  if (!charge) return false;
  await monthlyBillingCustomers.updateOne(
    { _id: charge.customerId },
    { $set: { lastChargeError: ok ? null : trim(error, 500) ?? "Falha no envio - DM fechada.", lastChargeStatus: ok ? "sent" : "failed", updatedAt: now } }
  );
  await monthlyBillingLogs.insertOne({
    _id: randomUUID(),
    tenantId: charge.tenantId,
    botId: charge.botId,
    customerId: charge.customerId,
    discordUserId: charge.discordUserId,
    action: ok ? "charge_sent" : "charge_failed",
    actorId: "bot",
    actorName: "Bot",
    message: ok ? "Cobrança entregue por DM." : "Falha no envio - DM fechada.",
    metadata: { chargeId, error: error ?? null },
    createdAt: now
  });
  return true;
}

function toCustomerDto(customer: MongoMonthlyBillingCustomer, bot: MongoDevBot | null, user: { avatarUrl?: string | null; avatar?: string | null; username?: string | null } | null) {
  const computed = computeCustomerBilling(customer);
  return {
    id: customer._id,
    tenantId: customer.tenantId,
    botId: customer.botId,
    botName: bot?.name ?? customer.botId,
    botAvatarUrl: bot?.avatarUrl ?? null,
    projectName: bot?.mainGuildName ?? bot?.mainGuildId ?? null,
    discordUserId: customer.discordUserId,
    discordAvatarUrl: user?.avatarUrl ?? user?.avatar ?? null,
    discordUsername: user?.username ?? null,
    customerName: customer.customerName,
    planName: customer.planName,
    monthlyAmountInCents: customer.monthlyAmountInCents,
    dueDate: customer.firstDueDate.toISOString(),
    fixedDueDay: customer.fixedDueDay,
    subscriptionStartDate: customer.subscriptionStartDate.toISOString(),
    lastPaymentAt: customer.lastPaymentAt?.toISOString() ?? null,
    nextDueDate: computed.nextDueDate.toISOString(),
    oldestDueDate: computed.oldestDueDate?.toISOString() ?? null,
    overdueMonths: computed.overdueMonths,
    totalDueInCents: computed.totalDueInCents,
    status: computed.statusLabel,
    rawStatus: customer.status,
    lastChargeAt: customer.lastChargeAt?.toISOString() ?? null,
    lastChargeStatus: customer.lastChargeStatus,
    lastChargeError: customer.lastChargeError,
    notes: customer.notes,
    supportUrl: customer.supportUrl,
    paymentUrl: customer.paymentUrl,
    receiptUrl: customer.receiptUrl,
    chargeText: buildChargeText(customer, bot, computed),
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString()
  };
}

function buildChargeText(customer: MongoMonthlyBillingCustomer, bot: MongoDevBot | null, computed: ReturnType<typeof computeCustomerBilling>) {
  return [
    "Mensalidade pendente - Nextech",
    "",
    `Olá, ${customer.customerName}.`,
    "",
    `Identificamos uma pendência relacionada ao seu plano no projeto ${bot?.mainGuildName ?? bot?.name ?? customer.botId}.`,
    "",
    "Resumo da cobrança",
    `Plano: ${customer.planName}`,
    `Valor mensal: ${formatMoney(customer.monthlyAmountInCents)}`,
    `Mensalidades atrasadas: ${computed.overdueMonths}`,
    `Valor total pendente: ${formatMoney(computed.totalDueInCents)}`,
    `Vencimento mais antigo: ${computed.oldestDueDate ? formatDate(computed.oldestDueDate) : "sem atraso"}`,
    `Situação: ${computed.statusLabel}`,
    "",
    "Regularize sua mensalidade para evitar a suspensão dos serviços vinculados ao seu bot.",
    "Caso o pagamento já tenha sido realizado, envie o comprovante pelo canal de atendimento."
  ].join("\n");
}

function computeCustomerBilling(customer: Pick<MongoMonthlyBillingCustomer, "firstDueDate" | "fixedDueDay" | "initialOverdueMonths" | "paidInstallments" | "monthlyAmountInCents" | "discountInCents" | "fineInCents" | "interestInCents" | "status" | "lastChargeStatus">) {
  const today = new Date();
  const dueCycles = countDueCycles(customer.firstDueDate, today);
  const overdueMonths = Math.max(0, customer.initialOverdueMonths + dueCycles - customer.paidInstallments);
  const oldestDueDate = overdueMonths > 0 ? addMonths(customer.firstDueDate, Math.max(0, customer.paidInstallments - customer.initialOverdueMonths)) : null;
  const nextDueDate = addMonths(customer.firstDueDate, Math.max(0, customer.paidInstallments - customer.initialOverdueMonths + overdueMonths));
  const base = customer.monthlyAmountInCents * overdueMonths;
  const totalDueInCents = Math.max(0, base + customer.fineInCents + customer.interestInCents - customer.discountInCents);
  return { nextDueDate, oldestDueDate, overdueMonths, statusLabel: customerStatusLabel(customer, overdueMonths, nextDueDate), totalDueInCents };
}

function customerStatusLabel(customer: Pick<MongoMonthlyBillingCustomer, "status" | "lastChargeStatus">, overdueMonths: number, nextDueDate: Date) {
  if (customer.status === "cancelled" || customer.status === "deleted") return "Cancelado";
  if (customer.status === "suspended") return "Suspenso";
  if (customer.status === "payment_review") return "Pagamento em análise";
  if (customer.lastChargeStatus === "sent" && overdueMonths > 0) return "Cobrança enviada";
  if (overdueMonths > 0) return "Atrasado";
  const today = startOfDay(new Date());
  const due = startOfDay(nextDueDate);
  if (due.getTime() === today.getTime()) return "Vence hoje";
  if (due.getTime() - today.getTime() <= 3 * 86400000) return "Próximo do vencimento";
  return "Em dia";
}

function countDueCycles(firstDueDate: Date, today: Date) {
  if (startOfDay(today).getTime() < startOfDay(firstDueDate).getTime()) return 0;
  let count = 0;
  let cursor = new Date(firstDueDate);
  while (startOfDay(cursor).getTime() <= startOfDay(today).getTime() && count < 240) {
    count += 1;
    cursor = addMonths(firstDueDate, count);
  }
  return count;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfMonth(date: Date) {
  const next = new Date(date);
  next.setDate(1);
  next.setHours(0, 0, 0, 0);
  return next;
}

async function requireActiveBot(botId: string) {
  const { devBots } = await getMongoCollections();
  const bot = await devBots.findOne({ _id: botId });
  if (!bot) throw Object.assign(new Error("Bot não encontrado."), { statusCode: 404 });
  if (bot.maintenance || bot.status === "maintenance") throw Object.assign(new Error("O bot selecionado está em manutenção."), { statusCode: 409 });
  return bot;
}

async function writeMonthlyLog(bot: MongoDevBot, customer: MongoMonthlyBillingCustomer, action: string, actor: AuthSessionUser, message: string, metadata: Record<string, unknown>) {
  const { monthlyBillingLogs } = await getMongoCollections();
  await monthlyBillingLogs.insertOne({
    _id: randomUUID(),
    tenantId: customer.tenantId,
    botId: bot._id,
    customerId: customer._id,
    discordUserId: customer.discordUserId,
    action,
    actorId: actor.discordId,
    actorName: actor.globalName || actor.username,
    message,
    metadata,
    createdAt: new Date()
  });
}

function normalizeDiscordId(value: string) {
  const id = value.replace(/\D/g, "");
  if (!DISCORD_ID_PATTERN.test(id)) throw Object.assign(new Error("ID do Discord inválido."), { statusCode: 400 });
  return id;
}

function normalizeBotStatus(status: MongoDevBot["status"]) {
  if (status === "online" || status === "ready") return "online";
  if (status === "maintenance") return "maintenance";
  return "offline";
}

function tenantIdForBot(bot: MongoDevBot) {
  return bot.mainGuildId || bot.ownerId || "nextech";
}

function trim(value: unknown, max: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function trimRequired(value: unknown, max: number, label: string) {
  const next = trim(value, max);
  if (!next) throw Object.assign(new Error(`${label} é obrigatório.`), { statusCode: 400 });
  return next;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function minIso(values: string[]) {
  return values.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
}

function publicInput(input: MonthlyBillingCustomerInput) {
  return {
    discordUserId: input.discordUserId,
    monthlyAmountInCents: input.monthlyAmountInCents,
    fixedDueDay: input.fixedDueDay,
    planName: input.planName
  };
}

function customerSnapshot(customer: MongoMonthlyBillingCustomer) {
  return {
    customerName: customer.customerName,
    fixedDueDay: customer.fixedDueDay,
    monthlyAmountInCents: customer.monthlyAmountInCents,
    planName: customer.planName,
    status: customer.status
  };
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("pt-BR", { currency: "BRL", style: "currency" }).format(cents / 100);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(date);
}

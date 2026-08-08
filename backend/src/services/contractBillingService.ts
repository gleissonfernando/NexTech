import { randomUUID } from "node:crypto";
import type {
  MongoBotBillingInvoice,
  MongoContract,
  MongoContractAuditLog,
  MongoContractItem,
  MongoPaymentOrder,
  MongoPlan,
  MongoPlanSubscription,
  MongoUser
} from "../database/mongo";
import { getMongoCollections } from "../database/mongo";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoom } from "../realtime/events";
import type { AuthSessionUser } from "../types/session";
import { updateMonthlyBillingChargeResult } from "./monthlyBillingService";
import type { PlanActor } from "./planService";

const DEFAULT_DASHBOARD_URL = "/dashboard";
const MANUAL_HOSTING_PIX_COPY_PASTE = "00020126330014br.gov.bcb.pix011105117656148520400005303986540512.005802BR5925GLEISSON FERNANDO CRUZ PE6007GOIANIA62070503***63043F2D";
const MANUAL_HOSTING_PIX_AMOUNT_IN_CENTS = 1200;

export type ContractDmPayload = {
  botId?: string | null;
  contractId: string | null;
  dashboardUrl: string;
  actionLinks?: {
    paymentUrl?: string | null;
    receiptUrl?: string | null;
    supportUrl?: string | null;
  };
  event: "invoice_created" | "due_reminder" | "due_today" | "overdue" | "payment_confirmed" | "contract_activated" | "upgrade_confirmed" | "qr_expired" | "payment_failed";
  invoice: {
    amountInCents: number;
    currency: "BRL";
    dueDate: string | null;
    id: string;
    pixCopyPaste: string | null;
    pixExpiresAt: string | null;
    pixQrCode: string | null;
    status: string;
  } | null;
  items: Array<{ name: string; quantity: number; status: string }>;
  planName: string;
  serverId: string | null;
  serverName: string | null;
  serviceName: string;
  user: {
    discordAvatar: string | null;
    discordDisplayName: string | null;
    discordUserId: string;
    discordUsername: string | null;
    email: string | null;
  };
};

export type ContractDmAck = {
  error?: string | null;
  invoiceId?: string | null;
  notificationType?: ContractDmPayload["event"];
  ok: boolean;
  userId?: string | null;
};

export async function ensureContractForPaymentOrder(order: MongoPaymentOrder, plan: MongoPlan | null, source: string) {
  const { contracts, contractAuditLogs, contractItems, users } = await getMongoCollections();
  const now = new Date();
  const user = await users.findOne({ discordId: order.discordId });
  const holder = contractHolderSnapshot(order, user);
  const existing = order.contractId
    ? await contracts.findOne({ _id: order.contractId })
    : await contracts.findOne({ paymentOrderId: order._id });
  const status: MongoContract["status"] = order.status === "approved" || order.status === "paid" ? "active" : "pending_payment";
  const nextDueDate = order.expiresAt ?? null;

  if (existing) {
    await contracts.updateOne(
      { _id: existing._id },
      {
        $set: {
          billingContactStatus: existing.billingContactStatus === "requires_review" ? "requires_review" : "confirmed",
          billingContactUserId: existing.billingContactUserId ?? holder.discordUserId,
          contractHolderUserId: existing.contractHolderUserId ?? holder.discordUserId,
          lastPaymentAt: status === "active" ? order.paidAt ?? order.approvedAt ?? now : existing.lastPaymentAt ?? null,
          nextDueDate,
          status,
          updatedAt: now
        }
      }
    );
    await ensureContractItem(existing._id, plan, order, status === "active" ? "active" : "pending_payment");
    return (await contracts.findOne({ _id: existing._id })) ?? existing;
  }

  const contract: MongoContract = {
    _id: randomUUID(),
    billingContactStatus: "confirmed",
    billingContactUserId: holder.discordUserId,
    billingModel: plan?.billingCycle === "lifetime" ? "lifetime" : "monthly",
    botId: null,
    contractHolderUserId: holder.discordUserId,
    createdAt: now,
    createdByUserId: holder.discordUserId,
    lastPaymentAt: status === "active" ? order.paidAt ?? order.approvedAt ?? now : null,
    metadata: {
      source,
      discord_display_name: holder.discordDisplayName,
      discord_username: holder.discordUsername,
      email: holder.email
    },
    nextDueDate,
    paymentOrderId: order._id,
    planId: order.planId,
    planSlug: order.planSlug,
    serverId: null,
    serverOwnerUserId: null,
    startDate: status === "active" ? now : null,
    status,
    subscriptionId: null,
    updatedAt: now
  };

  await contracts.insertOne(contract);
  await contractItems.insertOne(buildContractItem(contract._id, plan, order, status === "active" ? "active" : "pending_payment"));
  await contractAuditLogs.insertOne(auditLog("contract_created", holder.discordUserId, contract._id, null, holder.discordUserId, null, contract, source));
  await getMongoCollections().then(({ paymentOrders }) => paymentOrders.updateOne(
    { _id: order._id },
    {
      $set: {
        billingContactUserId: holder.discordUserId,
        contractHolderSnapshot: holder,
        contractId: contract._id,
        contractIntent: order.contractIntent ?? "new_contract",
        pixCopyPaste: order.pixCopyPaste ?? order.pixCode ?? null,
        pixQrCode: order.pixQrCode ?? order.qrCode ?? null,
        updatedAt: now
      }
    }
  ));
  return contract;
}

export async function syncContractActivatedFromSubscription(subscription: MongoPlanSubscription, order: MongoPaymentOrder, plan: MongoPlan, source: string) {
  const { contracts, contractAuditLogs, contractItems } = await getMongoCollections();
  const contract = await ensureContractForPaymentOrder(order, plan, source);
  const now = new Date();
  await contracts.updateOne(
    { _id: contract._id },
    {
      $set: {
        lastPaymentAt: order.paidAt ?? order.approvedAt ?? now,
        nextDueDate: subscription.endsAt ?? null,
        startDate: subscription.startedAt ?? now,
        status: "active",
        subscriptionId: subscription._id,
        updatedAt: now
      }
    }
  );
  await contractItems.updateMany({ contractId: contract._id, status: "pending_payment" }, { $set: { status: "active", updatedAt: now } });
  await contractAuditLogs.insertOne(auditLog("contract_activated", subscription.discordId, contract._id, null, subscription.discordId, "pending_payment", "active", source));
  return (await contracts.findOne({ _id: contract._id })) ?? contract;
}

export async function ensureContractForBotInvoice(invoice: MongoBotBillingInvoice, source: string) {
  const { contracts, contractAuditLogs, contractItems, devBots } = await getMongoCollections();
  const bot = await devBots.findOne({ _id: invoice.botId });
  const holderUserId = invoice.contractHolderUserId ?? invoice.billingContactUserId ?? bot?.createdBy ?? invoice.userId;
  const existing = invoice.contractId
    ? await contracts.findOne({ _id: invoice.contractId })
    : await contracts.findOne({ botId: invoice.botId, contractHolderUserId: holderUserId, status: { $ne: "cancelled" } });
  const now = new Date();

  if (existing) {
    await getMongoCollections().then(({ botBillingInvoices }) => botBillingInvoices.updateOne(
      { _id: invoice._id },
      {
        $set: {
          billingContactUserId: existing.billingContactUserId ?? holderUserId,
          contractHolderUserId: existing.contractHolderUserId ?? holderUserId,
          contractId: existing._id,
          dmStatus: invoice.dmStatus ?? "pending",
          pixCopyPaste: invoice.pixCopyPaste ?? invoice.pixCode ?? null,
          updatedAt: now
        }
      }
    ));
    return existing;
  }

  const contract: MongoContract = {
    _id: randomUUID(),
    billingContactStatus: bot?.createdBy || bot?.ownerId ? "inferred" : "requires_review",
    billingContactUserId: holderUserId,
    billingModel: invoice.billingModel,
    botId: invoice.botId,
    contractHolderUserId: holderUserId,
    createdAt: now,
    createdByUserId: bot?.createdBy ?? holderUserId,
    lastPaymentAt: invoice.paidAt ?? null,
    metadata: { source, botName: invoice.botName },
    nextDueDate: invoice.dueDate,
    paymentOrderId: null,
    planId: null,
    planSlug: null,
    serverId: bot?.mainGuildId ?? null,
    serverOwnerUserId: bot?.ownerId ?? null,
    startDate: invoice.contractedAt ?? bot?.createdAt ?? null,
    status: invoice.status === "paid" || invoice.status === "manually_released" ? "active" : invoice.status === "overdue" ? "suspended" : "pending_payment",
    subscriptionId: null,
    updatedAt: now
  };
  await contracts.insertOne(contract);
  await contractItems.insertOne({
    _id: randomUUID(),
    billingPeriod: invoice.planPeriod ?? "monthly",
    contractId: contract._id,
    createdAt: now,
    endsAt: null,
    itemType: invoice.chargeType === "hosting" ? "hosting" : "plan",
    name: invoice.chargeType === "hosting" ? "Hospedagem" : "Plano mensal",
    productId: invoice.botId,
    quantity: 1,
    startsAt: invoice.contractedAt ?? now,
    status: contract.status === "active" ? "active" : "pending_payment",
    unitPrice: invoice.amountInCents,
    updatedAt: now
  });
  await getMongoCollections().then(({ botBillingInvoices }) => botBillingInvoices.updateOne(
    { _id: invoice._id },
    {
      $set: {
        billingContactUserId: holderUserId,
        contractHolderUserId: holderUserId,
        contractId: contract._id,
        dmStatus: invoice.dmStatus ?? "pending",
        pixCopyPaste: invoice.pixCopyPaste ?? invoice.pixCode ?? null,
        updatedAt: now
      }
    }
  ));
  await contractAuditLogs.insertOne(auditLog("contract_inferred_from_bot_invoice", holderUserId, contract._id, invoice.botId, holderUserId, null, contract, source));
  return contract;
}

export async function listDeveloperMonthlyContracts() {
  const { botBillingInvoices, contractItems, contracts, devBots, users } = await getMongoCollections();
  const docs = await contracts.find({}).sort({ updatedAt: -1 }).limit(500).toArray();
  return {
    contracts: await Promise.all(docs.map(async (contract) => {
      const [holder, items, latestInvoice, bot] = await Promise.all([
        contract.contractHolderUserId ? users.findOne({ discordId: contract.contractHolderUserId }) : null,
        contractItems.find({ contractId: contract._id }).sort({ createdAt: 1 }).toArray(),
        botBillingInvoices.findOne({ contractId: contract._id }, { sort: { dueDate: -1 } }),
        contract.botId ? devBots.findOne({ _id: contract.botId }) : null
      ]);
      return {
        id: contract._id,
        billingContactStatus: contract.billingContactStatus,
        billingContactUserId: contract.billingContactUserId,
        botId: contract.botId,
        botName: bot?.name ?? latestInvoice?.botName ?? null,
        contractHolder: holderSummary(holder, contract.contractHolderUserId),
        hasAdministrativeRelease: Boolean(bot?.billingOverride),
        invoiceStatus: latestInvoice?.status ?? null,
        latestInvoiceId: latestInvoice?._id ?? null,
        isLifetimeBot: contract.billingModel === "lifetime",
        items: items.map(toItemDto),
        lastPaymentAt: (contract.lastPaymentAt ?? latestInvoice?.paidAt)?.toISOString() ?? null,
        monthlyAmountInCents: items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0) || latestInvoice?.amountInCents || 0,
        nextDueDate: (contract.nextDueDate ?? latestInvoice?.dueDate)?.toISOString() ?? null,
        serverId: contract.serverId,
        serverName: bot?.mainGuildName ?? null,
        status: contract.status,
        dmStatus: latestInvoice?.dmStatus ?? "pending",
        hostingCharged: items.some((item) => item.itemType === "hosting") || latestInvoice?.chargeType === "hosting"
      };
    }))
  };
}

export async function emitContractInvoiceDm(
  invoiceId: string,
  notificationType: ContractDmPayload["event"],
  actor?: AuthSessionUser | PlanActor | null,
  options: { recipientUserId?: string | null } = {}
) {
  const { botBillingInvoices, contractAuditLogs, contractItems, contracts, devBots, users } = await getMongoCollections();
  const invoice = await botBillingInvoices.findOne({ _id: invoiceId });
  if (!invoice) throw Object.assign(new Error("Fatura não encontrada."), { statusCode: 404 });
  const contract = await ensureContractForBotInvoice(invoice, `dm_${notificationType}`);
  const bot = await devBots.findOne({ _id: invoice.botId });
  const items = await contractItems.find({ contractId: contract._id }).sort({ createdAt: 1 }).toArray();
  const recipientIds = resolveContractDmRecipientIds(bot, contract, invoice, options.recipientUserId);
  const payloads = await Promise.all(recipientIds.map(async (userId) => {
    const user = await users.findOne({ discordId: userId });
    return buildDmPayload(notificationType, contract, invoice, items, user, bot, userId);
  }));
  await botBillingInvoices.updateOne(
    { _id: invoiceId },
    { $inc: { dmAttempts: Math.max(1, payloads.length) }, $set: { dmStatus: "pending", updatedAt: new Date() } }
  );
  for (const payload of payloads) {
    emitRealtimeToRoom(devBotRealtimeRoom(invoice.botId), "contract-billing:send_dm", payload);
    emitRealtime("contract-billing:send_dm", payload);
    await contractAuditLogs.insertOne(auditLog("dm_requested", payload.user.discordUserId, contract._id, invoice.botId, actorId(actor), null, notificationType, null));
  }
  return payloads[0] ?? null;
}

export async function recordContractDmResult(input: ContractDmAck) {
  const { botBillingInvoices, contractAuditLogs, invoiceNotifications } = await getMongoCollections();
  const now = new Date();
  const invoiceId = input.invoiceId?.trim() || null;
  if (invoiceId) {
    const invoice = await botBillingInvoices.findOneAndUpdate(
      { _id: invoiceId },
      {
        $set: {
          dmError: input.ok ? null : trim(input.error, 500) ?? "Falha ao enviar DM.",
          dmSentAt: input.ok ? now : null,
          dmStatus: input.ok ? "sent" : "failed",
          updatedAt: now
        }
      },
      { returnDocument: "after" }
    );
    if (!invoice && await updateMonthlyBillingChargeResult(invoiceId, input.ok, input.error ?? null)) {
      return;
    }
    await invoiceNotifications.updateOne(
      {
        channel: "dm",
        invoiceId,
        notificationType: input.notificationType ?? "invoice_created",
        userId: input.userId ?? invoice?.billingContactUserId ?? invoice?.contractHolderUserId ?? invoice?.userId ?? null
      },
      {
        $setOnInsert: { _id: randomUUID(), createdAt: now },
        $set: {
          error: input.ok ? null : trim(input.error, 500) ?? "Falha ao enviar DM.",
          sentAt: input.ok ? now : null,
          status: input.ok ? "sent" : "failed"
        }
      },
      { upsert: true }
    );
    await contractAuditLogs.insertOne(auditLog(input.ok ? "dm_sent" : "dm_failed", input.userId ?? null, invoice?.contractId ?? null, invoice?.botId ?? null, "bot", null, input.error ?? null, null));
  }
}

export async function createContractUpgrade(contractId: string, input: { itemName: string; itemType?: MongoContractItem["itemType"]; quantity?: number; unitPrice: number }, actor: AuthSessionUser) {
  const { contractAuditLogs, contractItems, contracts } = await getMongoCollections();
  const contract = await contracts.findOne({ _id: contractId });
  if (!contract) throw Object.assign(new Error("Contrato não encontrado."), { statusCode: 404 });
  if (contract.contractHolderUserId !== actor.discordId && contract.billingContactUserId !== actor.discordId) {
    throw Object.assign(new Error("Você não tem acesso a este contrato."), { statusCode: 403 });
  }
  const now = new Date();
  const item: MongoContractItem = {
    _id: randomUUID(),
    billingPeriod: "monthly",
    contractId,
    createdAt: now,
    endsAt: null,
    itemType: input.itemType ?? "upgrade",
    name: trim(input.itemName, 120) ?? "Upgrade",
    productId: null,
    quantity: Math.max(1, Math.trunc(input.quantity ?? 1)),
    startsAt: null,
    status: "pending_payment",
    unitPrice: Math.max(0, Math.trunc(input.unitPrice)),
    updatedAt: now
  };
  await contractItems.insertOne(item);
  await contractAuditLogs.insertOne(auditLog("upgrade_requested", actor.discordId, contractId, contract.botId, actor.discordId, null, item, null));
  return toItemDto(item);
}

function buildDmPayload(
  event: ContractDmPayload["event"],
  contract: MongoContract,
  invoice: MongoBotBillingInvoice,
  items: MongoContractItem[],
  user: MongoUser | null,
  bot: { name?: string; mainGuildName?: string } | null,
  fallbackUserId?: string | null
): ContractDmPayload {
  const holderId = fallbackUserId ?? contract.billingContactUserId ?? contract.contractHolderUserId ?? invoice.userId;
  const pixCopyPaste = invoice.pixCopyPaste ?? invoice.pixCode ?? manualHostingPixCopyPaste(invoice);
  const pixQrCode = invoice.pixQrCode ?? manualHostingPixQrCode(invoice);
  return {
    botId: invoice.botId,
    contractId: contract._id,
    dashboardUrl: DEFAULT_DASHBOARD_URL,
    event,
    invoice: {
      amountInCents: invoice.amountInCents,
      currency: "BRL",
      dueDate: invoice.dueDate?.toISOString() ?? null,
      id: invoice._id,
      pixCopyPaste,
      pixExpiresAt: invoice.pixExpiresAt?.toISOString() ?? null,
      pixQrCode,
      status: invoice.status
    },
    items: items.map(toItemDto),
    planName: items.find((item) => item.itemType === "plan")?.name ?? (invoice.chargeType === "hosting" ? "Hospedagem" : "Plano mensal"),
    serverId: contract.serverId,
    serverName: bot?.mainGuildName ?? null,
    serviceName: invoice.botName ?? bot?.name ?? "Bot contratado",
    user: holderSummary(user, holderId)
  };
}

function manualHostingPixCopyPaste(invoice: MongoBotBillingInvoice) {
  return shouldUseManualHostingPix(invoice) ? MANUAL_HOSTING_PIX_COPY_PASTE : null;
}

function manualHostingPixQrCode(invoice: MongoBotBillingInvoice) {
  if (!shouldUseManualHostingPix(invoice)) return null;
  return `https://api.qrserver.com/v1/create-qr-code/?size=640x640&margin=16&data=${encodeURIComponent(MANUAL_HOSTING_PIX_COPY_PASTE)}`;
}

function shouldUseManualHostingPix(invoice: MongoBotBillingInvoice) {
  return invoice.amountInCents === MANUAL_HOSTING_PIX_AMOUNT_IN_CENTS && (invoice.status === "pending" || invoice.status === "overdue");
}

function resolveContractDmRecipientIds(
  bot: { billingRecipientUserIds?: string[]; createdBy?: string; ownerId?: string } | null,
  contract: MongoContract,
  invoice: MongoBotBillingInvoice,
  recipientUserId?: string | null
) {
  if (recipientUserId && /^\d{5,32}$/.test(recipientUserId)) {
    return [recipientUserId];
  }
  const configured = Array.isArray(bot?.billingRecipientUserIds)
    ? bot.billingRecipientUserIds.filter((id) => /^\d{5,32}$/.test(id))
    : [];
  const fallback = contract.billingContactUserId ?? contract.contractHolderUserId ?? bot?.createdBy ?? bot?.ownerId ?? invoice.userId;
  return [...new Set(configured.length ? configured : [fallback].filter((id): id is string => Boolean(id)))];
}

function contractHolderSnapshot(order: MongoPaymentOrder, user: MongoUser | null) {
  return order.contractHolderSnapshot ?? {
    discordAvatar: user?.avatarUrl ?? user?.avatar ?? null,
    discordDisplayName: user?.globalName ?? null,
    discordUserId: order.discordId,
    discordUsername: user?.username ?? null,
    email: user?.email ?? null
  };
}

function buildContractItem(contractId: string, plan: MongoPlan | null, order: MongoPaymentOrder, status: MongoContractItem["status"]): MongoContractItem {
  const now = new Date();
  return {
    _id: randomUUID(),
    billingPeriod: plan?.billingCycle === "lifetime" ? "lifetime" : "monthly",
    contractId,
    createdAt: now,
    endsAt: null,
    itemType: "plan",
    name: plan?.name ?? String(order.planSnapshot?.name ?? "Plano contratado"),
    productId: plan?._id ?? order.planId,
    quantity: 1,
    startsAt: status === "active" ? now : null,
    status,
    unitPrice: order.amountInCents,
    updatedAt: now
  };
}

async function ensureContractItem(contractId: string, plan: MongoPlan | null, order: MongoPaymentOrder, status: MongoContractItem["status"]) {
  const { contractItems } = await getMongoCollections();
  const existing = await contractItems.findOne({ contractId, productId: order.planId, itemType: "plan" });
  if (existing) {
    await contractItems.updateOne({ _id: existing._id }, { $set: { status, updatedAt: new Date() } });
    return;
  }
  await contractItems.insertOne(buildContractItem(contractId, plan, order, status));
}

function toItemDto(item: MongoContractItem) {
  return {
    id: item._id,
    billingPeriod: item.billingPeriod,
    itemType: item.itemType,
    name: item.name,
    quantity: item.quantity,
    status: item.status,
    unitPrice: item.unitPrice
  };
}

function holderSummary(user: MongoUser | null, fallbackId: string | null) {
  return {
    discordAvatar: user?.avatarUrl ?? user?.avatar ?? null,
    discordDisplayName: user?.globalName ?? null,
    discordUserId: user?.discordId ?? fallbackId ?? "",
    discordUsername: user?.username ?? null,
    email: user?.email ?? null
  };
}

function auditLog(action: string, userId: string | null, contractId: string | null, botId: string | null, performedBy: string | null, previousValue: unknown, newValue: unknown, reason: string | null): MongoContractAuditLog {
  return { _id: randomUUID(), action, botId, contractId, createdAt: new Date(), newValue, performedBy, previousValue, reason, userId };
}

function actorId(actor?: AuthSessionUser | PlanActor | null) {
  if (!actor) return null;
  return "discordId" in actor ? actor.discordId : actor.id;
}

function trim(value: unknown, max: number) {
  const text = typeof value === "string" ? value.trim().slice(0, max) : "";
  return text || null;
}

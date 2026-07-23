import { randomUUID } from "node:crypto";
import type {
  MongoManualPaymentOrder,
  MongoManualPaymentOrderStatus,
  MongoManualPaymentReceipt,
  MongoManualPaymentReceiptAttachment,
  MongoManualPaymentService,
  MongoManualPaymentSettings
} from "../database/mongo";
import { getMongoCollections } from "../database/mongo";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoom } from "../realtime/events";
import { createLog } from "./logService";
import { savePersistentImage } from "./persistentImageStorageService";

export const MANUAL_PAYMENTS_MODULE_ID = "manual-payments";
const DEFAULT_RECEIPT_IMAGE_FORMATS = ["png", "jpg", "jpeg", "webp"] as const;

export type ManualPaymentSettingsDto = Omit<MongoManualPaymentSettings, "_id" | "updatedAt"> & {
  id: string;
  updatedAt: string;
};

export type ManualPaymentOrderDto = Omit<MongoManualPaymentOrder, "_id" | "approvedAt" | "createdAt" | "finalizedAt" | "paidAt" | "updatedAt"> & {
  approvedAt: string | null;
  createdAt: string;
  finalizedAt: string | null;
  id: string;
  paidAt: string | null;
  updatedAt: string;
};

export type SaveManualPaymentSettingsInput = Partial<Omit<MongoManualPaymentSettings, "_id" | "botId" | "guildId" | "updatedAt" | "updatedBy">>;

export type CreateManualPaymentOrderInput = {
  serviceId: string;
  userId: string;
  username?: string | null;
};

export type UpdateManualPaymentOrderInput = Partial<{
  action: string;
  channelId: string | null;
  paymentChannelId: string | null;
  paymentMessageId: string | null;
  paymentMethod: "PIX_KEY" | "PIX_QR_CODE" | null;
  proofMessageId: string | null;
  proofUrl: string | null;
  reason: string | null;
  serviceChannelId: string | null;
  staffId: string | null;
  staffMessageId: string | null;
  status: MongoManualPaymentOrderStatus;
}>;

export type RegisterManualPaymentReceiptInput = {
  attachments: MongoManualPaymentReceiptAttachment[];
  channelId: string;
  customerId: string;
  customerUsername?: string | null;
  messageId: string;
};

export async function getManualPaymentsDashboard(guildId: string, botId: string | null) {
  const settings = await ensureManualPaymentSettings(guildId, botId);
  const { manualPaymentOrderLogs, manualPaymentOrders } = await getMongoCollections();
  const [orders, logs] = await Promise.all([
    manualPaymentOrders.find({ botId: settings.botId, guildId }).sort({ createdAt: -1 }).limit(100).toArray(),
    manualPaymentOrderLogs.find({ botId: settings.botId, guildId }).sort({ createdAt: -1 }).limit(100).toArray()
  ]);

  return {
    logs: logs.map((log) => ({ ...log, id: log._id, createdAt: log.createdAt.toISOString() })),
    orders: orders.map(toOrderDto),
    settings: toSettingsDto(settings)
  };
}

export async function getManualPaymentRuntime(guildId: string, botId: string | null) {
  const settings = await ensureManualPaymentSettings(guildId, botId);
  const { manualPaymentOrders } = await getMongoCollections();
  const activeOrders = await manualPaymentOrders
    .find({ botId: settings.botId, guildId, status: { $nin: ["FINISHED", "CANCELLED_BY_CUSTOMER", "CANCELLED_BY_STAFF"] } })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();

  return {
    orders: activeOrders.map(toOrderDto),
    settings: toSettingsDto(settings)
  };
}

export async function ensureManualPaymentSettings(guildId: string, botId: string | null) {
  const resolvedBotId = botId ?? "default";
  const { manualPaymentSettings } = await getMongoCollections();
  const existing = await manualPaymentSettings.findOne({ botId: resolvedBotId, guildId });
  if (existing) return existing;

  const settings: MongoManualPaymentSettings = {
    _id: randomUUID(),
    allowedReceiptImageFormats: [...DEFAULT_RECEIPT_IMAGE_FORMATS],
    allowReceiptPdf: true,
    approveRoleIds: [],
    attendanceCategoryId: null,
    autoReceiptDetectionEnabled: true,
    bannerUrl: null,
    botId: resolvedBotId,
    color: "#22c55e",
    enabled: false,
    finalizeRoleIds: [],
    guildId,
    logChannelId: null,
    logViewRoleIds: [],
    maxPaymentMinutes: 60,
    paymentCategoryId: null,
    approvalMessage: "Seu pagamento foi aprovado. Seu pedido foi liberado para atendimento.",
    customerReceiptMessage: "Recebemos o seu comprovante de pagamento com sucesso. Seu pagamento foi encaminhado para análise da nossa equipe.",
    paymentInstructions: "Envie o pagamento via Pix e anexe uma foto do comprovante neste canal. A aprovação e feita manualmente pela equipe.",
    pixCopyPasteCode: null,
    pixKey: null,
    pixKeyType: "random",
    pixQrCodeUrl: null,
    receiverBank: null,
    receiverName: null,
    receiptChannelId: null,
    rejectRoleIds: [],
    rejectionMessage: "Seu pagamento foi recusado. Motivo: {reason}",
    salePanelChannelId: null,
    salePanelDescription: "Escolha um serviço abaixo para iniciar a compra com pagamento manual.",
    salePanelMessageId: null,
    salePanelTitle: "Servicos disponíveis",
    services: [],
    supportPanelChannelId: null,
    updatedAt: new Date(),
    updatedBy: null
  };

  await manualPaymentSettings.insertOne(settings);
  return settings;
}

export async function saveManualPaymentSettings(guildId: string, botId: string | null, input: SaveManualPaymentSettingsInput, actorId: string | null) {
  const current = await ensureManualPaymentSettings(guildId, botId);
  const patch = normalizeSettingsInput(input);
  const { manualPaymentSettings } = await getMongoCollections();
  await manualPaymentSettings.updateOne(
    { _id: current._id },
    { $set: { ...patch, updatedAt: new Date(), updatedBy: actorId } }
  );
  const settings = await manualPaymentSettings.findOne({ _id: current._id });
  await writeAudit(settings ?? current, actorId, "settings_updated", "Configuração de pagamentos manuais atualizada.");
  emitManualPaymentsUpdated((settings ?? current).botId, guildId);
  return toSettingsDto(settings ?? current);
}

export async function requestManualPaymentPanelPublish(guildId: string, botId: string | null, actorId: string | null) {
  const settings = await ensureManualPaymentSettings(guildId, botId);
  emitRealtime("manual-payments:panel_publish", { botId: settings.botId, guildId });
  await writeAudit(settings, actorId, "panel_publish_requested", "Publicação do painel de pagamentos solicitada.");
  return toSettingsDto(settings);
}

export async function updateManualPaymentPanelState(guildId: string, botId: string | null, messageId: string | null) {
  const settings = await ensureManualPaymentSettings(guildId, botId);
  const { manualPaymentSettings } = await getMongoCollections();
  await manualPaymentSettings.updateOne({ _id: settings._id }, { $set: { salePanelMessageId: messageId, updatedAt: new Date() } });
  emitManualPaymentsUpdated(settings.botId, guildId);
  return toSettingsDto((await manualPaymentSettings.findOne({ _id: settings._id })) ?? settings);
}

export async function uploadManualPaymentQrCode(input: {
  actorId: string | null;
  botId: string | null;
  buffer: Buffer;
  guildId: string;
  mimeType: string;
}) {
  const current = await ensureManualPaymentSettings(input.guildId, input.botId);
  const stored = await savePersistentImage({
    actorId: input.actorId,
    botId: current.botId,
    buffer: input.buffer,
    guildId: input.guildId,
    imageType: "qr-code",
    metadata: { field: "pixQrCodeUrl" },
    mimeType: input.mimeType,
    moduleId: MANUAL_PAYMENTS_MODULE_ID,
    previousUrl: current.pixQrCodeUrl
  });
  const { manualPaymentSettings } = await getMongoCollections();
  await manualPaymentSettings.updateOne(
    { _id: current._id },
    { $set: { pixQrCodeUrl: stored.publicUrl, updatedAt: new Date(), updatedBy: input.actorId } }
  );
  const settings = (await manualPaymentSettings.findOne({ _id: current._id })) ?? current;
  await writeAudit(settings, input.actorId, "qr_code_uploaded", "QR Code Pix enviado para armazenamento persistente.");
  emitManualPaymentsUpdated(settings.botId, input.guildId);
  return toSettingsDto(settings);
}

export async function createManualPaymentOrder(guildId: string, botId: string | null, input: CreateManualPaymentOrderInput) {
  const settings = await ensureManualPaymentSettings(guildId, botId);
  const service = settings.services.find((item) => item.id === input.serviceId && item.active);
  if (!settings.enabled || !service) return null;

  const { manualPaymentOrders } = await getMongoCollections();
  const existing = await manualPaymentOrders.findOne({
    botId: settings.botId,
    guildId,
    serviceId: service.id,
    userId: input.userId,
    status: { $in: ["PENDING_PAYMENT", "WAITING_STAFF_APPROVAL", "APPROVED", "IN_PROGRESS", "WAITING_CUSTOMER", "DELIVERED"] }
  });
  if (existing) return toOrderDto(existing);

  const now = new Date();
  const orderNumber = await nextOrderNumber(settings.botId, guildId);
  const order: MongoManualPaymentOrder = {
    _id: randomUUID(),
    amount: service.amount,
    approvedAt: null,
    approvedBy: null,
    botId: settings.botId,
    createdAt: now,
    finalizedAt: null,
    finalizedBy: null,
    guildId,
    orderNumber,
    paidAt: null,
    paymentChannelId: null,
    paymentMessageId: null,
    paymentMethod: null,
    proofMessageId: null,
    proofUrl: null,
    rejectedBy: null,
    rejectionReason: null,
    serviceChannelId: null,
    serviceId: service.id,
    serviceName: service.name,
    staffMessageId: null,
    status: "PENDING_PAYMENT",
    updatedAt: now,
    userId: input.userId,
    username: input.username ?? null
  };

  await manualPaymentOrders.insertOne(order);
  await writeOrderLog(order, "order_created", null, "PENDING_PAYMENT", input.userId, null, null);
  emitManualPaymentsUpdated(settings.botId, guildId);
  return toOrderDto(order);
}

export async function updateManualPaymentOrder(guildId: string, botId: string | null, orderId: string, input: UpdateManualPaymentOrderInput) {
  const settings = await ensureManualPaymentSettings(guildId, botId);
  const { manualPaymentOrders } = await getMongoCollections();
  const current = await manualPaymentOrders.findOne({ _id: orderId, botId: settings.botId, guildId });
  if (!current) return null;

  if (input.status === "APPROVED" && !current.proofUrl && !input.proofUrl) {
    throw Object.assign(new Error("Não e possível aprovar sem comprovante."), { statusCode: 400 });
  }
  if (input.status === "FINISHED" && current.status !== "DELIVERED") {
    throw Object.assign(new Error("Marque como entregue antes de finalizar."), { statusCode: 400 });
  }

  const nextStatus = input.status ?? current.status;
  const now = new Date();
  const patch: Partial<MongoManualPaymentOrder> = {
    paymentChannelId: input.paymentChannelId !== undefined ? input.paymentChannelId : current.paymentChannelId,
    paymentMessageId: input.paymentMessageId !== undefined ? input.paymentMessageId : current.paymentMessageId,
    paymentMethod: input.paymentMethod !== undefined ? input.paymentMethod : current.paymentMethod,
    proofMessageId: input.proofMessageId !== undefined ? input.proofMessageId : current.proofMessageId,
    proofUrl: input.proofUrl !== undefined ? input.proofUrl : current.proofUrl,
    serviceChannelId: input.serviceChannelId !== undefined ? input.serviceChannelId : current.serviceChannelId,
    staffMessageId: input.staffMessageId !== undefined ? input.staffMessageId : current.staffMessageId,
    status: nextStatus,
    updatedAt: now
  };

  if (input.proofUrl && !current.paidAt) patch.paidAt = now;
  if (nextStatus === "APPROVED" && current.status !== "APPROVED") {
    patch.approvedAt = now;
    patch.approvedBy = input.staffId ?? current.approvedBy;
  }
  if (nextStatus === "REJECTED") {
    patch.rejectedBy = input.staffId ?? current.rejectedBy;
    patch.rejectionReason = input.reason ?? current.rejectionReason;
  }
  if (nextStatus === "FINISHED") {
    patch.finalizedAt = now;
    patch.finalizedBy = input.staffId ?? current.finalizedBy;
  }

  await manualPaymentOrders.updateOne({ _id: current._id }, { $set: patch });
  const updated = (await manualPaymentOrders.findOne({ _id: current._id })) ?? current;
  await writeOrderLog(updated, input.action ?? "order_updated", current.status, updated.status, input.staffId ?? null, input.reason ?? null, input.channelId ?? updated.paymentChannelId ?? updated.serviceChannelId);
  if (updated.status === "APPROVED" && current.status !== "APPROVED") {
    emitManualPaymentApproved(settings, updated);
  }
  emitManualPaymentsUpdated(settings.botId, guildId);
  return toOrderDto(updated);
}

export async function registerManualPaymentReceipt(guildId: string, botId: string | null, orderId: string, input: RegisterManualPaymentReceiptInput) {
  const settings = await ensureManualPaymentSettings(guildId, botId);
  const { manualPaymentOrders, manualPaymentReceipts } = await getMongoCollections();
  const current = await manualPaymentOrders.findOne({ _id: orderId, botId: settings.botId, guildId });
  if (!current) return null;

  const validReceiptChannel = current.paymentChannelId === input.channelId || settings.receiptChannelId === input.channelId;
  if (!validReceiptChannel || current.userId !== input.customerId) {
    throw Object.assign(new Error("Comprovante não pertence a este pedido."), { statusCode: 403 });
  }

  const existingReceipt = await manualPaymentReceipts.findOne({ botId: settings.botId, guildId, messageId: input.messageId });
  if (existingReceipt) {
    return {
      duplicate: true,
      order: toOrderDto(current),
      receipt: toReceiptDto(existingReceipt)
    };
  }

  if (current.proofMessageId && current.status === "WAITING_STAFF_APPROVAL") {
    throw Object.assign(new Error("Um comprovante já foi recebido e está em análise."), { statusCode: 409 });
  }

  if (!["PENDING_PAYMENT", "REJECTED", "WAITING_STAFF_APPROVAL"].includes(current.status)) {
    throw Object.assign(new Error(`Status ${current.status} não aceita novo comprovante.`), { statusCode: 409 });
  }

  const now = new Date();
  const attachments = input.attachments.slice(0, 10).map((attachment) => ({
    contentType: normalizeNullable(attachment.contentType),
    extension: attachment.extension.trim().toLowerCase(),
    name: attachment.name.trim().slice(0, 180) || "comprovante",
    proxyUrl: normalizeNullable(attachment.proxyUrl),
    size: Math.max(0, Math.trunc(attachment.size)),
    url: attachment.url.trim()
  }));
  const imageAttachment = attachments.find(isReceiptImageAttachment) ?? null;
  const persistedProofUrl = await persistManualPaymentReceiptImage(settings, current, imageAttachment);
  const proofUrl = persistedProofUrl ?? attachments[0]?.url ?? null;
  const storedAttachments = persistedProofUrl
    ? attachments.map((attachment) => imageAttachment && attachment.url === imageAttachment.url
      ? { ...attachment, proxyUrl: attachment.url, url: persistedProofUrl }
      : attachment)
    : attachments;
  const receipt: MongoManualPaymentReceipt = {
    _id: randomUUID(),
    attachments: storedAttachments,
    botId: settings.botId,
    channelId: input.channelId,
    customerId: input.customerId,
    customerUsername: normalizeNullable(input.customerUsername),
    guildId,
    messageId: input.messageId,
    orderId: current._id,
    paymentId: current._id,
    status: "under_review",
    submittedAt: now
  };

  const updateResult = await manualPaymentOrders.updateOne(
    {
      _id: current._id,
      botId: settings.botId,
      guildId,
      $or: [
        { proofMessageId: null },
        { status: "REJECTED" }
      ],
      status: { $in: ["PENDING_PAYMENT", "REJECTED", "WAITING_STAFF_APPROVAL"] }
    },
    {
      $set: {
        paidAt: current.paidAt ?? now,
        proofMessageId: input.messageId,
        proofUrl,
        status: "WAITING_STAFF_APPROVAL",
        updatedAt: now
      }
    }
  );

  if (!updateResult.modifiedCount) {
    throw Object.assign(new Error("Este pedido já possui comprovante em análise."), { statusCode: 409 });
  }

  await manualPaymentReceipts.insertOne(receipt).catch(async (error: unknown) => {
    if (isDuplicateMongoKey(error)) {
      const duplicate = await manualPaymentReceipts.findOne({ botId: settings.botId, guildId, messageId: input.messageId });
      if (duplicate) {
        return;
      }
    }
    throw error;
  });

  const updated = (await manualPaymentOrders.findOne({ _id: current._id })) ?? current;
  await writeOrderLog(updated, "proof_uploaded", current.status, updated.status, null, null, input.channelId);
  await createLog({
    botId: settings.botId,
    guildId,
    message: "[MANUAL_PAYMENT_RECEIPT_RECEIVED]",
    metadata: {
      attachmentCount: attachments.length,
      channelId: input.channelId,
      contentTypes: storedAttachments.map((attachment) => attachment.contentType).filter(Boolean),
      customerId: input.customerId,
      guildId,
      messageId: input.messageId,
      orderId: current._id,
      paymentId: current._id,
      proofPersisted: Boolean(persistedProofUrl),
      sizes: storedAttachments.map((attachment) => attachment.size),
      submittedAt: now.toISOString()
    },
    type: "manual_payment.receipt_received"
  }).catch(() => null);
  emitManualPaymentsUpdated(settings.botId, guildId);

  return {
    duplicate: false,
    order: toOrderDto(updated),
    receipt: toReceiptDto(receipt)
  };
}

export async function getManualPaymentOrder(guildId: string, botId: string | null, orderId: string) {
  const settings = await ensureManualPaymentSettings(guildId, botId);
  const { manualPaymentOrders } = await getMongoCollections();
  const order = await manualPaymentOrders.findOne({ _id: orderId, botId: settings.botId, guildId });
  return order ? toOrderDto(order) : null;
}

function toSettingsDto(settings: MongoManualPaymentSettings): ManualPaymentSettingsDto {
  return {
    ...settings,
    allowedReceiptImageFormats: normalizeReceiptFormats(settings.allowedReceiptImageFormats),
    allowReceiptPdf: settings.allowReceiptPdf !== false,
    approvalMessage: settings.approvalMessage ?? "Seu pagamento foi aprovado. Seu pedido foi liberado para atendimento.",
    autoReceiptDetectionEnabled: settings.autoReceiptDetectionEnabled !== false,
    customerReceiptMessage: settings.customerReceiptMessage ?? "Recebemos o seu comprovante de pagamento com sucesso. Seu pagamento foi encaminhado para análise da nossa equipe.",
    id: settings._id,
    pixCopyPasteCode: settings.pixCopyPasteCode ?? null,
    receiptChannelId: settings.receiptChannelId ?? null,
    rejectionMessage: settings.rejectionMessage ?? "Seu pagamento foi recusado. Motivo: {reason}",
    updatedAt: settings.updatedAt.toISOString()
  };
}

function toOrderDto(order: MongoManualPaymentOrder): ManualPaymentOrderDto {
  return {
    ...order,
    approvedAt: order.approvedAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    finalizedAt: order.finalizedAt?.toISOString() ?? null,
    id: order._id,
    paidAt: order.paidAt?.toISOString() ?? null,
    updatedAt: order.updatedAt.toISOString()
  };
}

function toReceiptDto(receipt: MongoManualPaymentReceipt) {
  return {
    ...receipt,
    id: receipt._id,
    submittedAt: receipt.submittedAt.toISOString()
  };
}

function isDuplicateMongoKey(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === 11000);
}

function emitManualPaymentApproved(settings: MongoManualPaymentSettings, order: MongoManualPaymentOrder) {
  const service = settings.services.find((item) => item.id === order.serviceId);
  const payload = {
    amountCents: Math.round(order.amount * 100),
    botId: settings.botId,
    buyerId: order.userId,
    buyerName: order.username,
    currency: "BRL" as const,
    customerRoleId: null,
    guildId: settings.guildId,
    logChannelId: null,
    planName: service?.serviceType || "Manual",
    productName: order.serviceName,
    productPlanType: "manual",
    purchasedRoleId: null,
    saleChannelId: null,
    saleId: `manual-payment:${order._id}`
  };

  emitRealtime("nex-tech-sales:sale_paid", payload);
  if (settings.botId) {
    emitRealtimeToRoom(devBotRealtimeRoom(settings.botId), "nex-tech-sales:sale_paid", payload);
  }
}

function emitManualPaymentsUpdated(botId: string, guildId: string) {
  const payload = { botId, guildId };
  emitRealtime("manual-payments:updated", payload);
  if (botId) emitRealtimeToRoom(devBotRealtimeRoom(botId), "manual-payments:updated", payload);
}

function normalizeSettingsInput(input: SaveManualPaymentSettingsInput) {
  return {
    ...input,
    allowedReceiptImageFormats: input.allowedReceiptImageFormats ? normalizeReceiptFormats(input.allowedReceiptImageFormats) : undefined,
    allowReceiptPdf: input.allowReceiptPdf,
    approvalMessage: input.approvalMessage?.trim(),
    autoReceiptDetectionEnabled: input.autoReceiptDetectionEnabled,
    bannerUrl: normalizeNullable(input.bannerUrl),
    customerReceiptMessage: input.customerReceiptMessage?.trim(),
    logChannelId: normalizeNullable(input.logChannelId),
    paymentCategoryId: normalizeNullable(input.paymentCategoryId),
    attendanceCategoryId: normalizeNullable(input.attendanceCategoryId),
    pixCopyPasteCode: normalizeNullable(input.pixCopyPasteCode),
    pixKey: normalizeNullable(input.pixKey),
    pixQrCodeUrl: normalizeNullable(input.pixQrCodeUrl),
    receiverBank: normalizeNullable(input.receiverBank),
    receiverName: normalizeNullable(input.receiverName),
    receiptChannelId: normalizeNullable(input.receiptChannelId),
    rejectionMessage: input.rejectionMessage?.trim(),
    salePanelChannelId: normalizeNullable(input.salePanelChannelId),
    supportPanelChannelId: normalizeNullable(input.supportPanelChannelId),
    services: input.services?.map(normalizeService).sort((a, b) => a.order - b.order)
  };
}

function normalizeReceiptFormats(values: readonly string[] | null | undefined) {
  const allowed = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
  const normalized = [...new Set((values ?? DEFAULT_RECEIPT_IMAGE_FORMATS).map((value) => value.trim().toLowerCase()).filter((value) => allowed.has(value)))];
  return normalized.length ? normalized : [...DEFAULT_RECEIPT_IMAGE_FORMATS];
}

async function persistManualPaymentReceiptImage(
  settings: MongoManualPaymentSettings,
  order: MongoManualPaymentOrder,
  image: MongoManualPaymentReceiptAttachment | null
) {
  if (!image) return null;
  const url = image.url.trim();
  if (!isTrustedReceiptAttachmentUrl(url)) {
    throw Object.assign(new Error("URL do comprovante não pertence ao CDN do Discord."), { statusCode: 400 });
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    throw Object.assign(new Error("Não foi possível salvar o comprovante enviado. Tente enviar a imagem novamente."), { statusCode: 502 });
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const mimeType = image.contentType || response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || mimeTypeFromReceiptExtension(image.extension);
  const stored = await savePersistentImage({
    actorId: order.userId,
    botId: settings.botId,
    buffer,
    guildId: settings.guildId,
    imageType: `receipt-${order._id}`,
    metadata: {
      orderId: order._id,
      orderNumber: order.orderNumber,
      sourceMessageId: order.proofMessageId,
      sourceUrl: url
    },
    mimeType,
    moduleId: MANUAL_PAYMENTS_MODULE_ID,
    originalName: image.name,
    previousUrl: order.proofUrl
  });
  return stored.publicUrl;
}

function isReceiptImageAttachment(attachment: MongoManualPaymentReceiptAttachment) {
  const contentType = attachment.contentType?.split(";")[0]?.toLowerCase() ?? "";
  const extension = attachment.extension.trim().toLowerCase();
  return ["image/png", "image/jpeg", "image/jpg", "image/pjpeg", "image/webp", "image/gif"].includes(contentType) || ["png", "jpg", "jpeg", "webp", "gif"].includes(extension);
}

function mimeTypeFromReceiptExtension(extension: string) {
  const normalized = extension.trim().toLowerCase();
  if (normalized === "png") return "image/png";
  if (normalized === "jpg" || normalized === "jpeg") return "image/jpeg";
  if (normalized === "webp") return "image/webp";
  if (normalized === "gif") return "image/gif";
  return "application/octet-stream";
}

function isTrustedReceiptAttachmentUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["cdn.discordapp.com", "media.discordapp.net", "discord.com"].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function normalizeService(service: MongoManualPaymentService, index: number): MongoManualPaymentService {
  return {
    active: service.active !== false,
    amount: Number.isFinite(service.amount) ? service.amount : 0,
    bannerUrl: normalizeNullable(service.bannerUrl),
    createServiceChannel: service.createServiceChannel !== false,
    customText: normalizeNullable(service.customText),
    description: normalizeNullable(service.description),
    id: service.id?.trim() || randomUUID(),
    manualApproval: service.manualApproval !== false,
    name: service.name?.trim() || `Servico ${index + 1}`,
    order: Number.isFinite(service.order) ? service.order : index,
    serviceType: service.serviceType?.trim() || "serviço"
  };
}

function normalizeNullable(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

async function nextOrderNumber(botId: string, guildId: string) {
  const { manualPaymentOrders } = await getMongoCollections();
  const latest = await manualPaymentOrders.find({ botId, guildId }).sort({ orderNumber: -1 }).limit(1).next();
  return (latest?.orderNumber ?? 0) + 1;
}

async function writeOrderLog(
  order: MongoManualPaymentOrder,
  action: string,
  oldStatus: MongoManualPaymentOrderStatus | null,
  newStatus: MongoManualPaymentOrderStatus,
  staffId: string | null,
  reason: string | null,
  channelId: string | null
) {
  const { manualPaymentOrderLogs } = await getMongoCollections();
  await manualPaymentOrderLogs.insertOne({
    _id: randomUUID(),
    action,
    amount: order.amount,
    botId: order.botId,
    channelId,
    createdAt: new Date(),
    guildId: order.guildId,
    newStatus,
    oldStatus,
    orderId: order._id,
    proofUrl: order.proofUrl,
    reason,
    serviceName: order.serviceName,
    staffId,
    userId: order.userId
  });
  await createLog({
    botId: order.botId,
    guildId: order.guildId,
    message: `Pedido ${order.orderNumber} ${action}: ${order.serviceName}.`,
    metadata: { action, channelId, newStatus, oldStatus, orderId: order._id, proofUrl: order.proofUrl, reason },
    type: `manual_payments.${action}`,
    userId: staffId ?? order.userId
  }).catch(() => undefined);
}

async function writeAudit(settings: MongoManualPaymentSettings, actorId: string | null, action: string, message: string) {
  await createLog({
    botId: settings.botId,
    guildId: settings.guildId,
    message,
    metadata: { action },
    type: `manual_payments.${action}`,
    userId: actorId
  }).catch(() => undefined);
}

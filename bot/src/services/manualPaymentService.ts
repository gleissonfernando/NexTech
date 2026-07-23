import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
  type Attachment,
  type ButtonInteraction,
  type Client,
  type Guild,
  type Interaction,
  type Message,
  type ModalSubmitInteraction
} from "discord.js";
import { env } from "../config/env";
import type { BotContext } from "../types";
import type { ManualPaymentOrder, ManualPaymentOrderStatus, ManualPaymentReceiptAttachment, ManualPaymentService, ManualPaymentSettings } from "./apiClient";
import { renderComponentsV2Panel } from "./panelVisualRenderer";

const PREFIX = "manual_pay";
const MAX_RECEIPT_SIZE = env.MANUAL_PAYMENT_MAX_RECEIPT_MB * 1024 * 1024;
const RECEIPT_WARNING_COOLDOWN_MS = 20_000;
const receiptProcessingLocks = new Set<string>();
const receiptWarningCooldown = new Map<string, number>();
const allowedReceiptImageMimeTypes = new Set(["image/png", "image/jpeg", "image/jpg", "image/pjpeg", "image/webp"]);
const allowedReceiptImageExtensions = new Set(["png", "jpg", "jpeg", "webp"]);
const allowedReceiptPdfMimeTypes = new Set(["application/pdf"]);
const allowedReceiptPdfExtensions = new Set(["pdf"]);
type ReceiptAttachmentLike = Pick<Attachment, "contentType" | "name" | "url">;
type ReceiptFileCandidate = ReceiptAttachmentLike & { proxyURL?: string | null; proxyUrl?: string | null; size: number };
type StaffReceiptAttachment = ReceiptAttachmentLike & { size: number };

export function startManualPaymentService(client: Client<true>, context: BotContext) {
  context.socket.onManualPaymentPanelPublish((payload) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void publishManualPaymentPanel(guild, context);
  });
  void reconcileOpenPaymentChannelPrivacy(client, context);
}

export async function handleManualPaymentInteraction(interaction: Interaction, context: BotContext) {
  if (!("customId" in interaction) || !interaction.customId.startsWith(`${PREFIX}:`)) return false;
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:buy:`)) { await startPurchase(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:copy_key:`)) { await copyPixData(interaction, context, "key"); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:copy_code:`)) { await copyPixData(interaction, context, "code"); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:refresh_payment:`)) { await refreshPaymentStatus(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:pix_key:`)) { await choosePaymentMethod(interaction, context, "PIX_KEY"); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:pix_qr:`)) { await choosePaymentMethod(interaction, context, "PIX_QR_CODE"); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:paid:`)) { await confirmPaymentMade(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:cancel_customer:`)) { await showCustomerCancelConfirm(interaction); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:cancel_confirm:`)) { await customerCancel(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:approve:`)) { await approvePayment(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:reject:`)) { await showReasonModal(interaction, "reject"); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:new_proof:`)) { await requestNewProof(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:cancel_staff:`)) { await showReasonModal(interaction, "cancel_staff"); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:open:`)) { await openOrderChannel(interaction); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:status:`)) { await setServiceStatus(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:finish:`)) { await finishOrder(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:support:`)) { await openSupport(interaction); return true; }
  if (interaction.isButton() && (interaction.customId.startsWith(`${PREFIX}:add_staff:`) || interaction.customId.startsWith(`${PREFIX}:remove_staff:`) || interaction.customId.startsWith(`${PREFIX}:send_data:`))) { await interaction.reply({ content: "Use as permissões do canal para ajustar equipe ou envie os dados diretamente neste atendimento.", ephemeral: true }); return true; }
  if (interaction.isModalSubmit() && interaction.customId.startsWith(`${PREFIX}:reason:`)) { await submitReason(interaction, context); return true; }
  return false;
}

export async function handleManualPaymentMessage(message: Message, context: BotContext) {
  if (!message.guild || message.author.bot || message.webhookId) return false;
  if (!message.content.trim() && message.attachments.size === 0 && message.embeds.length === 0) return false;

  try {
    const runtime = await context.api.getManualPaymentRuntime(message.guild.id).catch((error) => {
      console.warn("[manual-payments] falha ao carregar runtime para processar comprovante:", {
        channelId: message.channelId,
        error: error instanceof Error ? error.message : String(error),
        guildId: message.guild?.id ?? null,
        messageId: message.id
      });
      return null;
    });
    if (!runtime) return false;
    const order = runtime.orders.find((item) => item.paymentChannelId === message.channelId && ["PENDING_PAYMENT", "REJECTED", "WAITING_STAFF_APPROVAL"].includes(item.status));
    if (!order) return false;

    await enforcePaymentChannelPrivacy(message.guild, runtime.settings, order);

    if (order.userId !== message.author.id) {
      logReceiptRejected("wrong_user", message, order);
      return true;
    }

    if (order.proofMessageId && order.status === "WAITING_STAFF_APPROVAL") {
      await sendReceiptWarning(message, "already_submitted", "⚠️ Um comprovante já foi recebido e está sendo analisado.\n\nAguarde a equipe finalizar a conferência antes de enviar outro arquivo.");
      logReceiptRejected("invalid_status", message, order);
      return true;
    }

    const attachments = receiptCandidatesFromMessage(message);
    if (attachments.length === 0) {
      await sendReceiptWarning(message, "missing_attachment", "Você precisa anexar uma foto do comprovante de pagamento.");
      logReceiptRejected("missing_attachment", message, order, []);
      return true;
    }

    const permissionError = validateReceiptChannelPermissions(message);
    if (permissionError) {
      console.warn(`[manual-payments] ${permissionError} guild=${message.guild.id} channel=${message.channelId} order=${order.id}`);
    }

    const lockKey = `${message.guild.id}:${order.id}:${message.id}`;
    if (receiptProcessingLocks.has(lockKey)) {
      logReceiptRejected("duplicate", message, order);
      return true;
    }
    receiptProcessingLocks.add(lockKey);

    try {
      const validAttachments = attachments.filter(isValidReceiptAttachment);
      if (!validAttachments.length) {
        await sendReceiptWarning(message, "invalid_type", "Formato não suportado. Envie uma imagem (PNG, JPG, JPEG ou WEBP).");
        logReceiptRejected("invalid_type", message, order, attachments);
        return true;
      }

      const filesWithinLimit = validAttachments.filter((attachment) => attachment.size <= MAX_RECEIPT_SIZE);
      if (!filesWithinLimit.length) {
        await sendReceiptWarning(message, "too_large", `❌ O arquivo enviado ultrapassa o tamanho máximo permitido.\n\nEnvie uma imagem PNG, JPG, JPEG ou WEBP com até ${env.MANUAL_PAYMENT_MAX_RECEIPT_MB} MB.`);
        logReceiptRejected("too_large", message, order, validAttachments);
        return true;
      }
      const receiptAttachments = filesWithinLimit.slice(0, 10);

      console.log("[MANUAL_PAYMENT_RECEIPT_RECEIVED]", {
        attachmentCount: receiptAttachments.length,
        channelId: message.channelId,
        contentTypes: receiptAttachments.map((attachment) => attachment.contentType ?? null),
        customerId: message.author.id,
        guildId: message.guild.id,
        messageId: message.id,
        orderId: order.id,
        paymentId: order.id,
        sizes: receiptAttachments.map((attachment) => attachment.size),
        submittedAt: new Date().toISOString()
      });

      const result = await context.api.registerManualPaymentReceipt(message.guild.id, order.id, {
        attachments: receiptAttachments.map(toReceiptAttachment),
        channelId: message.channelId,
        customerId: message.author.id,
        customerUsername: message.author.username,
        messageId: message.id
      });

      if (result.duplicate) {
        logReceiptRejected("duplicate", message, order, receiptAttachments);
        return true;
      }

      await message.react("✅").catch(() => null);
      await message.reply(createReceiptReceivedPanel(runtime.settings, result.order, message.createdAt)).catch(() => null);
      await refreshPaymentPanel(message.guild, context, runtime.settings, result.order);
      await sendStaffApprovalLog(message.guild, context, runtime.settings, result.order, result.receipt.attachments);
      return true;
    } finally {
      receiptProcessingLocks.delete(lockKey);
    }
  } catch (error) {
    console.error("[manual-payments] erro ao processar comprovante manual:", {
      channelId: message.channelId,
      error: error instanceof Error ? error.message : String(error),
      guildId: message.guild?.id ?? null,
      messageId: message.id
    });
    await sendReceiptWarning(message, "processing_error", "Não foi possível processar o comprovante agora. Tente novamente em instantes ou aguarde a equipe.").catch(() => null);
    return true;
  }
}

export function isValidReceiptAttachment(item: ReceiptAttachmentLike) {
  const contentType = item.contentType?.split(";")[0]?.toLowerCase() ?? "";
  const extension = receiptAttachmentExtension(item);
  return isReceiptImageAttachment(item) || Boolean((contentType && allowedReceiptPdfMimeTypes.has(contentType)) || allowedReceiptPdfExtensions.has(extension));
}

export function isReceiptImageAttachment(item: ReceiptAttachmentLike) {
  const contentType = item.contentType?.split(";")[0]?.toLowerCase() ?? "";
  const extension = receiptAttachmentExtension(item);
  return allowedReceiptImageMimeTypes.has(contentType) || allowedReceiptImageExtensions.has(extension);
}

function getUrlPathname(value: string) {
  try {
    return decodeURIComponent(new URL(value).pathname);
  } catch {
    return value.split("?")[0] ?? value;
  }
}

export function receiptAttachmentExtension(item: ReceiptAttachmentLike) {
  const fromName = getReceiptExtension(item.name ?? "");
  if (fromName) return fromName;
  return getReceiptExtension(getUrlPathname(item.url));
}

export function getReceiptExtension(value: string) {
  const lastDot = value.lastIndexOf(".");
  if (lastDot < 0 || lastDot === value.length - 1) return "";
  return value.slice(lastDot + 1).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toReceiptAttachment(attachment: ReceiptFileCandidate): ManualPaymentReceiptAttachment {
  return {
    contentType: attachment.contentType?.split(";")[0]?.toLowerCase() ?? null,
    extension: receiptAttachmentExtension(attachment),
    name: attachment.name ?? "comprovante",
    proxyUrl: attachment.proxyURL ?? attachment.proxyUrl ?? null,
    size: attachment.size,
    url: attachment.url
  };
}

async function sendReceiptWarning(message: Message, reason: string, content: string) {
  const key = `${message.channelId}:${message.author.id}:${reason}`;
  const now = Date.now();
  const last = receiptWarningCooldown.get(key) ?? 0;
  if (now - last < RECEIPT_WARNING_COOLDOWN_MS) return;
  receiptWarningCooldown.set(key, now);
  await message.reply(content).catch(() => null);
}

function logReceiptRejected(reason: string, message: Message, order: ManualPaymentOrder, attachments: ReceiptFileCandidate[] = receiptCandidatesFromMessage(message)) {
  console.log("[MANUAL_PAYMENT_RECEIPT_REJECTED]", {
    attachmentCount: attachments.length,
    channelId: message.channelId,
    contentTypes: attachments.map((attachment) => attachment.contentType ?? null),
    customerId: message.author.id,
    guildId: message.guild?.id ?? null,
    messageId: message.id,
    orderId: order.id,
    reason,
    sizes: attachments.map((attachment) => attachment.size)
  });
}

function receiptCandidatesFromMessage(message: Message): ReceiptFileCandidate[] {
  const attachments = [...message.attachments.values()].map((attachment) => ({
    contentType: attachment.contentType,
    name: attachment.name,
    proxyURL: attachment.proxyURL,
    size: attachment.size,
    url: attachment.url
  }));
  const embedImages = message.embeds.flatMap((embed, index) => [embed.image?.url, embed.thumbnail?.url]
    .filter((url): url is string => Boolean(url))
    .map((url, imageIndex) => {
      const extension = getReceiptExtension(getUrlPathname(url));
      return {
        contentType: extension ? receiptMimeTypeFromExtension(extension) : null,
        name: `comprovante-${index + 1}-${imageIndex + 1}${extension ? `.${extension}` : ""}`,
        proxyURL: null,
        size: 1,
        url
      };
    }));
  return [...attachments, ...embedImages];
}

function receiptMimeTypeFromExtension(extension: string) {
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "pdf") return "application/pdf";
  return null;
}

function validateReceiptChannelPermissions(message: Message) {
  if (!message.guild || !("permissionsFor" in message.channel)) return null;
  const me = message.guild.members.me;
  if (!me) return "Bot não encontrado no cache do servidor para validar permissões.";
  const permissions = message.channel.permissionsFor(me);
  const missing = [
    [PermissionFlagsBits.ViewChannel, "ViewChannel"],
    [PermissionFlagsBits.SendMessages, "SendMessages"],
    [PermissionFlagsBits.ReadMessageHistory, "ReadMessageHistory"],
    [PermissionFlagsBits.AttachFiles, "AttachFiles"],
    [PermissionFlagsBits.EmbedLinks, "EmbedLinks"]
  ].filter(([permission]) => !permissions?.has(permission as bigint)).map(([, label]) => label);
  return missing.length ? `Bot sem permissões no canal de pagamento: ${missing.join(", ")}.` : null;
}

async function publishManualPaymentPanel(guild: Guild, context: BotContext, fallbackChannelId?: string | null) {
  const { settings } = await context.api.getManualPaymentRuntime(guild.id);
  if (!settings.enabled) return null;
  const channelId = settings.salePanelChannelId ?? fallbackChannelId ?? null;
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) return null;
  const payload = createSalesPanel(settings);
  if (settings.salePanelMessageId && "messages" in channel) {
    const message = await channel.messages.fetch(settings.salePanelMessageId).catch(() => null);
    if (!message) return null;
    await message.edit(payload);
    return channel.id;
  }
  const message = await channel.send(payload);
  await context.api.updateManualPaymentPanelState(guild.id, message.id);
  return channel.id;
}

function createSalesPanel(settings: ManualPaymentSettings) {
  const services = settings.services.filter((item) => item.active).sort((a, b) => a.order - b.order).slice(0, 10);
  const actions: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let index = 0; index < services.length; index += 5) {
    actions.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      services.slice(index, index + 5).map((service) => new ButtonBuilder()
        .setCustomId(`${PREFIX}:buy:${service.id}`)
        .setEmoji(serviceEmoji(service))
        .setLabel(`Comprar ${limitButtonLabel(service.name)}`)
        .setStyle(ButtonStyle.Success))
    ));
  }
  const description = settings.salePanelDescription?.trim() || "Escolha um serviço abaixo para iniciar sua compra com pagamento manual.";
  return renderComponentsV2Panel({
    accentColor: parseColor(settings.color),
    actions,
    description: `${description}\n\n**${services.length ? `${services.length} serviço${services.length === 1 ? "" : "s"} disponível${services.length === 1 ? "" : "is"}` : "Nenhum serviço disponível no momento."}**`,
    fields: [
      "## 🛍️ Como comprar\n1️⃣ Escolha um serviço no catálogo.\n\n2️⃣ Clique no botão de compra.\n\n3️⃣ Um ticket privado será aberto automaticamente.\n\n4️⃣ Finalize o pagamento e envie o comprovante.",
      "## 🔒 Compra protegida\n• Atendimento feito em canal privado.\n\n• Pagamento manual via Pix.\n\n• Conferência realizada pela equipe.\n\n• Status atualizado dentro do ticket.",
      ...(services.length ? services.map(createSalesServiceCard) : ["## 📦 Catálogo\nNenhum serviço ativo foi configurado para este painel."])
    ],
    footer: { text: "NexTech • Loja de Serviços\nCompra protegida • Atendimento Manual" },
    image: settings.bannerUrl ? { imageEnabled: true, imagePosition: "top", imageUrl: settings.bannerUrl } : null,
    moduleId: "manual-payments",
    title: salePanelTitle(settings.salePanelTitle)
  });
}

async function startPurchase(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const serviceId = interaction.customId.split(":")[2] ?? "";
  const runtime = await context.api.getManualPaymentRuntime(interaction.guild.id);
  const service = runtime.settings.services.find((item) => item.id === serviceId && item.active);
  if (!runtime.settings.enabled || !service) return interaction.editReply("Servico indisponível.");
  const order = await context.api.createManualPaymentOrder(interaction.guild.id, { serviceId, userId: interaction.user.id, username: interaction.user.username });
  if (order.paymentChannelId) return interaction.editReply(`Você já tem um canal para este pedido: <#${order.paymentChannelId}>.`);
  const channel = await createPaymentChannel(interaction.guild, runtime.settings, order, interaction.user.id);
  const updated = await context.api.updateManualPaymentOrder(interaction.guild.id, order.id, { action: "payment_channel_created", paymentChannelId: channel.id });
  const message = await channel.send(createPaymentPanel(runtime.settings, updated, service));
  await context.api.updateManualPaymentOrder(interaction.guild.id, order.id, { action: "payment_panel_sent", paymentMessageId: message.id });
  setTimeout(() => void expirePaymentChannel(interaction.guild!, context, updated.id), Math.max(5, runtime.settings.maxPaymentMinutes) * 60_000).unref();
  await interaction.editReply(`Pedido criado: <#${channel.id}>.`);
}

async function createPaymentChannel(guild: Guild, settings: ManualPaymentSettings, order: ManualPaymentOrder, userId: string) {
  const member = await guild.members.fetch(userId).catch(() => null);
  const permissionOverwrites = buildPrivatePaymentChannelOverwrites(guild, settings, userId);
  const channel = await guild.channels.create({
    name: `pagamento-${slug(member?.displayName ?? order.username ?? userId)}-${String(order.orderNumber).padStart(3, "0")}`.slice(0, 90),
    parent: settings.paymentCategoryId ?? undefined,
    permissionOverwrites,
    reason: `Pagamento manual pedido ${order.orderNumber}`,
    type: ChannelType.GuildText
  }) as TextChannel;
  await channel.permissionOverwrites.set(permissionOverwrites, "Canal privado de pagamento manual: cliente, administradores e bot.").catch((error) => {
    console.warn("[manual-payments] falha ao reforçar permissões do canal de pagamento:", error instanceof Error ? error.message : error);
  });
  return channel;
}

export function buildPrivatePaymentChannelOverwrites(guild: Guild, settings: ManualPaymentSettings, userId: string) {
  const botUserId = guild.members.me?.id ?? guild.client.user.id;
  const adminRoleIds = paymentAdminRoleIds(guild, settings);
  const ownerId = guild.ownerId && guild.ownerId !== userId && guild.ownerId !== botUserId ? guild.ownerId : null;
  return [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] },
    { id: botUserId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory] },
    ...(ownerId ? [{ id: ownerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] }] : []),
    ...adminRoleIds.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] }))
  ];
}

function paymentAdminRoleIds(guild: Guild, settings: ManualPaymentSettings) {
  const roleIds = [...settings.approveRoleIds, ...settings.rejectRoleIds, ...settings.finalizeRoleIds, ...settings.logViewRoleIds];
  return [...new Set(roleIds)].filter((id) => {
    const role = guild.roles.cache.get(id);
    return Boolean(role && id !== guild.roles.everyone.id && role.permissions.has(PermissionFlagsBits.Administrator));
  });
}

async function enforcePaymentChannelPrivacy(guild: Guild, settings: ManualPaymentSettings, order: ManualPaymentOrder) {
  if (!order.paymentChannelId) return;
  const channel = await guild.channels.fetch(order.paymentChannelId).catch(() => null);
  if (!channel || !("permissionOverwrites" in channel)) return;
  await channel.permissionOverwrites.set(
    buildPrivatePaymentChannelOverwrites(guild, settings, order.userId),
    "Canal privado de pagamento manual: somente cliente, administradores e bot."
  ).then(() => {
    console.log(`[manual-payments] privacidade do canal de pagamento ${order.paymentChannelId} aplicada para o pedido ${order.orderNumber}.`);
  }).catch((error) => {
    console.warn(`[manual-payments] falha ao aplicar privacidade no canal ${order.paymentChannelId}:`, error instanceof Error ? error.message : error);
  });
}

async function reconcileOpenPaymentChannelPrivacy(client: Client<true>, context: BotContext) {
  for (const guild of client.guilds.cache.values()) {
    const runtime = await context.api.getManualPaymentRuntime(guild.id).catch((error) => {
      console.warn(`[manual-payments] falha ao carregar pedidos ativos do servidor ${guild.id}:`, error instanceof Error ? error.message : error);
      return null;
    });
    if (!runtime) continue;
    const orders = runtime.orders.filter((order) => order.paymentChannelId && ["PENDING_PAYMENT", "REJECTED", "WAITING_STAFF_APPROVAL"].includes(order.status));
    await Promise.all(orders.map((order) => enforcePaymentChannelPrivacy(guild, runtime.settings, order)));
  }
}

function createPaymentPanel(settings: ManualPaymentSettings, order: ManualPaymentOrder, service?: ManualPaymentService | null) {
  const visual = paymentStatusVisual(order);
  const canAct = ["PENDING_PAYMENT", "REJECTED"].includes(order.status) || (order.status === "WAITING_STAFF_APPROVAL" && !order.proofMessageId);
  const pixKey = settings.pixKey?.trim() || null;
  const explicitPixCopyCode = getExplicitPixCopyCode(settings);
  const shouldShowPixCopyCode = Boolean(explicitPixCopyCode && !isSamePixValue(explicitPixCopyCode, pixKey));
  const category = serviceCategoryLabel(service);
  const paymentActionButtons = [
    new ButtonBuilder().setCustomId(`${PREFIX}:copy_key:${order.id}`).setEmoji("🔵").setLabel("Copiar Chave Pix").setStyle(ButtonStyle.Primary).setDisabled(!pixKey),
    ...(shouldShowPixCopyCode
      ? [new ButtonBuilder().setCustomId(`${PREFIX}:copy_code:${order.id}`).setEmoji("🟣").setLabel("Copiar Código Pix").setStyle(ButtonStyle.Secondary)]
      : []),
    new ButtonBuilder().setCustomId(`${PREFIX}:paid:${order.id}`).setEmoji("🟢").setLabel("Já fiz o pagamento").setStyle(ButtonStyle.Success).setDisabled(!canAct)
  ];
  const actions = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(paymentActionButtons),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:refresh_payment:${order.id}`).setEmoji("🟠").setLabel("Atualizar Status").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}:cancel_customer:${order.id}`).setEmoji("🔴").setLabel("Cancelar Pedido").setStyle(ButtonStyle.Danger).setDisabled(!canAct)
    )
  ];
  const paymentInstructions = service?.customText?.trim() || settings.paymentInstructions?.trim() || "Envie uma foto ou imagem do comprovante de pagamento.\n\nFormatos aceitos: PNG, JPG, JPEG ou WEBP.";
  const qrSection = settings.pixQrCodeUrl
    ? "## 📱 QR Code disponível\nEscaneie utilizando o aplicativo do seu banco."
    : null;
  const proofSection = [
    order.proofUrl ? `📎 Comprovante: [abrir arquivo](${order.proofUrl})` : "📎 Comprovante: aguardando envio neste canal.",
    order.approvedAt ? `✅ Aprovado em: ${formatDateTime(order.approvedAt)}` : null,
    order.approvedBy ? `👤 Responsável: <@${order.approvedBy}>` : null,
    order.rejectionReason ? `📝 Motivo: ${limitText(order.rejectionReason, 500)}` : null
  ].filter(Boolean).join("\n");
  return renderComponentsV2Panel({
    accentColor: visual.color,
    actions,
    description: `Seu pedido foi criado com sucesso!\n\nFinalize o pagamento para que nossa equipe possa iniciar o processamento.\n\n**${visual.label}**\n${visual.description}`,
    fields: [
      `## 📦 Informações do Pedido\n🆔 Pedido: **${formatOrderNumber(order)}**\n👤 Cliente: <@${order.userId}>\n🛒 Produto: **${limitText(order.serviceName, 120)}**\n🏷️ Categoria: **${category}**\n💰 Valor: **${money(order.amount)}**\n📅 Criado em: ${formatDate(order.createdAt)}\n⏳ Status: **${visual.label}**`,
      createPaymentDataSection(settings, order, pixKey, shouldShowPixCopyCode ? explicitPixCopyCode : null),
      ...(qrSection ? [qrSection] : []),
      `## 📋 Instruções\n1️⃣ Faça o pagamento utilizando a chave Pix.\n\n2️⃣ Após realizar o pagamento, clique em **Já fiz o pagamento**.\n\n3️⃣ Envie uma foto ou imagem do comprovante de pagamento neste canal.\n\n4️⃣ Aguarde a conferência da equipe.\n\n**Formatos aceitos:** PNG, JPG, JPEG ou WEBP.\n\n⚠️ A aprovação é manual.\n\n${limitText(paymentInstructions, 900)}`,
      "## 🔔 Avisos\n• Não altere o valor.\n\n• Não feche este ticket.\n\n• Caso o pagamento não seja identificado, o pedido permanecerá pendente.\n\n• Após aprovado, o sistema atualizará automaticamente o status.",
      `## 🧾 Registro do Pedido\n${proofSection}`
    ],
    footer: { text: "NexTech • Sistema de Pagamentos\nPedido protegido • Atendimento Manual" },
    image: settings.pixQrCodeUrl ? { imageEnabled: true, imagePosition: "bottom", imageUrl: settings.pixQrCodeUrl } : null,
    moduleId: "manual-payments",
    title: "💳 Pagamento Manual"
  });
}

async function choosePaymentMethod(interaction: ButtonInteraction, context: BotContext, paymentMethod: "PIX_KEY" | "PIX_QR_CODE") {
  if (!interaction.guild) return;
  const orderId = interaction.customId.split(":")[2] ?? "";
  const runtime = await context.api.getManualPaymentRuntime(interaction.guild.id);
  const order = await context.api.updateManualPaymentOrder(interaction.guild.id, orderId, { action: paymentMethod === "PIX_KEY" ? "pix_key_selected" : "pix_qr_selected", channelId: interaction.channelId, paymentMethod });
  await refreshPaymentPanel(interaction.guild, context, runtime.settings, order);
  await interaction.reply({ content: paymentMethod === "PIX_KEY" ? copyablePixMessage("Chave Pix", runtime.settings.pixKey) : copyablePixMessage("QR Code Pix", runtime.settings.pixQrCodeUrl), ephemeral: true });
}

async function copyPixData(interaction: ButtonInteraction, context: BotContext, kind: "key" | "code") {
  if (!interaction.guild) return;
  const orderId = interaction.customId.split(":")[2] ?? "";
  const runtime = await context.api.getManualPaymentRuntime(interaction.guild.id);
  const order = await context.api.updateManualPaymentOrder(interaction.guild.id, orderId, {
    action: kind === "key" ? "pix_key_copied" : "pix_code_copied",
    channelId: interaction.channelId,
    paymentMethod: kind === "key" || !runtime.settings.pixQrCodeUrl ? "PIX_KEY" : "PIX_QR_CODE"
  });
  await refreshPaymentPanel(interaction.guild, context, runtime.settings, order);
  await interaction.reply({
    content: kind === "key" ? copyablePixMessage("Chave Pix", runtime.settings.pixKey) : copyablePixMessage("Código Pix Copia e Cola", getPixCopyCode(runtime.settings)),
    ephemeral: true
  });
}

async function refreshPaymentStatus(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const orderId = interaction.customId.split(":")[2] ?? "";
  const runtime = await context.api.getManualPaymentRuntime(interaction.guild.id);
  const order = runtime.orders.find((item) => item.id === orderId);
  if (!order) return interaction.editReply("Pedido não encontrado.");
  await interaction.message.edit(createPaymentPanel(runtime.settings, order, runtime.settings.services.find((item) => item.id === order.serviceId))).catch(() => null);
  await interaction.editReply(`Status atualizado: ${paymentStatusVisual(order).label}.`);
}

async function confirmPaymentMade(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const orderId = interaction.customId.split(":")[2] ?? "";
  await interaction.deferReply({ ephemeral: true });
  const runtime = await context.api.getManualPaymentRuntime(interaction.guild.id);
  const current = runtime.orders.find((item) => item.id === orderId);
  if (!current) return interaction.editReply("Pedido não encontrado.");
  if (!["PENDING_PAYMENT", "REJECTED", "WAITING_STAFF_APPROVAL"].includes(current.status)) return interaction.editReply(`Este pedido está com status ${statusLabel(current.status)}.`);
  const order = await context.api.updateManualPaymentOrder(interaction.guild.id, orderId, {
    action: "payment_marked_paid",
    channelId: interaction.channelId,
    status: "WAITING_STAFF_APPROVAL"
  });
  await refreshPaymentPanel(interaction.guild, context, runtime.settings, order);
  await interaction.editReply("Envie uma foto ou imagem do comprovante de pagamento.");
}

async function showCustomerCancelConfirm(interaction: ButtonInteraction) {
  const orderId = interaction.customId.split(":")[2] ?? "";
  await interaction.reply({
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:cancel_confirm:${orderId}`).setEmoji("🔴").setLabel("Confirmar cancelamento").setStyle(ButtonStyle.Danger)
      )
    ],
    content: "Tem certeza que deseja cancelar este pedido? Esta ação fechará o canal de pagamento.",
    ephemeral: true
  });
}

async function customerCancel(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const orderId = interaction.customId.split(":")[2] ?? "";
  await interaction.deferReply({ ephemeral: true });
  const runtime = await context.api.getManualPaymentRuntime(interaction.guild.id);
  const order = await context.api.updateManualPaymentOrder(interaction.guild.id, orderId, { action: "cancelled_by_customer", channelId: interaction.channelId, status: "CANCELLED_BY_CUSTOMER" });
  await refreshPaymentPanel(interaction.guild, context, runtime.settings, order);
  await interaction.editReply("Compra cancelada.");
  setTimeout(() => void interaction.guild?.channels.cache.get(order.paymentChannelId ?? "")?.delete("Compra cancelada pelo cliente").catch(() => null), 2000).unref();
}

function createReceiptReceivedPanel(settings: ManualPaymentSettings, order: ManualPaymentOrder, submittedAt: Date) {
  return renderComponentsV2Panel({
    accentColor: 0x22c55e,
    description: settings.customerReceiptMessage?.trim() || "Recebemos o seu comprovante de pagamento com sucesso.\n\nSeu pagamento foi encaminhado para análise da nossa equipe. Aguarde a conferência antes de realizar um novo envio.",
    fields: [
      `## ✅ Comprovante recebido\nStatus: **Em análise**\nPedido: **${formatOrderNumber(order)}**\nEnviado em: ${formatDateTime(submittedAt.toISOString())}`
    ],
    footer: { text: "NexTech • Conferência manual de pagamento" },
    moduleId: "manual-payments",
    title: "✅ Comprovante recebido"
  });
}

async function sendStaffApprovalLog(guild: Guild, context: BotContext, settings: ManualPaymentSettings, order: ManualPaymentOrder, attachments?: StaffReceiptAttachment[]) {
  if (!settings.logChannelId) return null;
  const channel = await guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel?.isSendable()) return null;
  const visualAttachment = order.proofUrl ? { url: order.proofUrl } : attachments?.find(isReceiptImageAttachment) ?? null;
  const pdfAttachments = attachments?.filter((attachment) => {
    const extension = receiptAttachmentExtension(attachment);
    const contentType = attachment.contentType?.split(";")[0]?.toLowerCase() ?? "";
    return extension === "pdf" || contentType === "application/pdf";
  }) ?? [];
  const proofLinks = (attachments?.length ? attachments : []).map((attachment, index) => {
    const label = receiptAttachmentExtension(attachment).toUpperCase() || `ARQUIVO ${index + 1}`;
    return `• [${limitText(attachment.name ?? `comprovante-${index + 1}`, 80)}](${attachment.url}) (${label}, ${formatBytes(attachment.size)})`;
  });
  const payload = renderComponentsV2Panel({
    accentColor: 0xf59e0b,
    actions: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:approve:${order.id}`).setEmoji("✅").setLabel("Aprovar").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${PREFIX}:reject:${order.id}`).setEmoji("❌").setLabel("Recusar").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setEmoji("🔍").setLabel("Abrir Pedido").setStyle(ButtonStyle.Link).setURL(order.paymentChannelId ? `https://discord.com/channels/${guild.id}/${order.paymentChannelId}` : `https://discord.com/channels/${guild.id}`)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...pdfAttachments.slice(0, 3).map((attachment, index) => new ButtonBuilder().setLabel(`Abrir PDF ${index + 1}`).setStyle(ButtonStyle.Link).setURL(attachment.url)),
        new ButtonBuilder().setCustomId(`${PREFIX}:new_proof:${order.id}`).setLabel("Solicitar novo comprovante").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${PREFIX}:cancel_staff:${order.id}`).setLabel("Cancelar pedido").setStyle(ButtonStyle.Danger)
      )
    ],
    description: "Um novo comprovante foi recebido e precisa de conferência manual.",
    fields: [
      [
        "## Informações",
        `Cliente: <@${order.userId}>`,
        `Nome do Discord: **${limitText(order.username ?? "Não informado", 80)}**`,
        `ID: \`${order.userId}\``,
        `Produto: **${limitText(order.serviceName, 120)}**`,
        `Plano: **${serviceCategoryLabel(settings.services.find((service) => service.id === order.serviceId))}**`,
        "Quantidade: **1**",
        `Valor: **${money(order.amount)}**`,
        `Forma de pagamento: **${paymentMethodLabel(order)}**`,
        `Data: ${formatDate(order.updatedAt)}`,
        `Hora: ${formatTime(order.updatedAt)}`,
        `ID do Pedido: \`${order.id}\``,
        "Status: **⏳ Aguardando aprovação**",
        `Canal do pedido: ${order.paymentChannelId ? `<#${order.paymentChannelId}>` : "não informado"}`
      ].join("\n"),
      proofLinks.length ? `## Comprovante\n${proofLinks.join("\n")}` : order.proofUrl ? `## Comprovante\n[abrir comprovante](${order.proofUrl})` : "## Comprovante\nSem comprovante anexado."
    ],
    image: visualAttachment?.url ? { imageEnabled: true, imagePosition: "bottom", imageUrl: visualAttachment.url } : null,
    moduleId: "manual-payments",
    title: "Pagamento Manual Recebido"
  });
  const message = await channel.send(payload);
  await context.api.updateManualPaymentOrder(guild.id, order.id, { action: "staff_log_sent", staffMessageId: message.id });
  return message;
}

async function approvePayment(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const orderId = interaction.customId.split(":")[2] ?? "";
  const runtime = await context.api.getManualPaymentRuntime(interaction.guild.id);
  if (!(await hasAnyRole(interaction.guild, interaction.user.id, runtime.settings.approveRoleIds))) return interaction.editReply("Você não pode aprovar pagamentos.");
  const current = await context.api.getManualPaymentOrder(interaction.guild.id, orderId);
  if (!current?.proofUrl) return interaction.editReply("Não e possível aprovar sem comprovante.");
  const approved = await context.api.updateManualPaymentOrder(interaction.guild.id, orderId, { action: "payment_approved", channelId: interaction.channelId, staffId: interaction.user.id, status: "APPROVED" });
  await refreshPaymentPanel(interaction.guild, context, runtime.settings, approved);
  const serviceChannel = await createServiceChannel(interaction.guild, runtime.settings, approved, interaction.user.id);
  const updated = await context.api.updateManualPaymentOrder(interaction.guild.id, orderId, { action: "service_channel_created", serviceChannelId: serviceChannel.id, staffId: interaction.user.id, status: "IN_PROGRESS" });
  await serviceChannel.send(createServicePanel(runtime.settings, updated));
  await notifyCustomer(interaction.guild, approved.userId, buildApprovalMessage(runtime.settings, approved)).catch(() => null);
  if (approved.paymentChannelId) setTimeout(() => void interaction.guild?.channels.cache.get(approved.paymentChannelId ?? "")?.delete("Pagamento aprovado").catch(() => null), 3000).unref();
  await interaction.editReply(`Pagamento aprovado. Atendimento criado: <#${serviceChannel.id}>.`);
}

async function createServiceChannel(guild: Guild, settings: ManualPaymentSettings, order: ManualPaymentOrder, staffId: string) {
  const staffRoleIds = [...new Set([...settings.approveRoleIds, ...settings.finalizeRoleIds, ...settings.logViewRoleIds])];
  return guild.channels.create({
    name: `atendimento-${slug(order.username ?? order.userId)}-${String(order.orderNumber).padStart(3, "0")}`.slice(0, 90),
    parent: settings.attendanceCategoryId ?? undefined,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: order.userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] },
      { id: staffId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: guild.members.me?.id ?? guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
      ...staffRoleIds.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))
    ],
    reason: `Atendimento pedido ${order.orderNumber}`,
    type: ChannelType.GuildText
  }) as Promise<TextChannel>;
}

function createServicePanel(settings: ManualPaymentSettings, order: ManualPaymentOrder) {
  return renderComponentsV2Panel({
    accentColor: parseColor(settings.color),
    actions: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:send_data:${order.id}`).setLabel("Enviar dados").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${PREFIX}:status:IN_PROGRESS:${order.id}`).setLabel("Em produção").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${PREFIX}:status:WAITING_CUSTOMER:${order.id}`).setLabel("Aguardando cliente").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${PREFIX}:status:DELIVERED:${order.id}`).setLabel("Marcar entregue").setStyle(ButtonStyle.Success)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:finish:${order.id}`).setLabel("Acabou / Finalizar pedido").setStyle(ButtonStyle.Danger).setDisabled(order.status !== "DELIVERED"),
        new ButtonBuilder().setCustomId(`${PREFIX}:support:${order.id}`).setLabel("Abrir suporte").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${PREFIX}:add_staff:${order.id}`).setLabel("Adicionar staff").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${PREFIX}:remove_staff:${order.id}`).setLabel("Remover staff").setStyle(ButtonStyle.Secondary)
      )
    ],
    description: `Pedido #${String(order.orderNumber).padStart(3, "0")} - ${statusLabel(order.status)}`,
    fields: [`Cliente: <@${order.userId}>\nServico: **${order.serviceName}**\nValor pago: **${money(order.amount)}**\nAprovado por: ${order.approvedBy ? `<@${order.approvedBy}>` : "staff"}`, "Cliente e equipe podem conversar neste canal até a entrega. Depois de finalizado, use apenas o sistema de ticket/suporte."],
    image: settings.bannerUrl ? { imageEnabled: true, imagePosition: "top", imageUrl: settings.bannerUrl } : null,
    moduleId: "manual-payments",
    title: "Atendimento / Produção"
  });
}

async function setServiceStatus(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const [, , status, orderId] = interaction.customId.split(":");
  await interaction.deferReply({ ephemeral: true });
  const runtime = await context.api.getManualPaymentRuntime(interaction.guild.id);
  if (!(await hasAnyRole(interaction.guild, interaction.user.id, runtime.settings.finalizeRoleIds))) return interaction.editReply("Você não pode atualizar este atendimento.");
  const order = await context.api.updateManualPaymentOrder(interaction.guild.id, orderId ?? "", { action: `status_${status}`, channelId: interaction.channelId, staffId: interaction.user.id, status: status as ManualPaymentOrderStatus });
  await interaction.message.edit(createServicePanel(runtime.settings, order)).catch(() => null);
  await interaction.editReply(`Status atualizado para ${statusLabel(order.status)}.`);
}

async function finishOrder(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const orderId = interaction.customId.split(":")[2] ?? "";
  await interaction.deferReply({ ephemeral: true });
  const runtime = await context.api.getManualPaymentRuntime(interaction.guild.id);
  if (!(await hasAnyRole(interaction.guild, interaction.user.id, runtime.settings.finalizeRoleIds))) return interaction.editReply("Você não pode finalizar este pedido.");
  const order = await context.api.updateManualPaymentOrder(interaction.guild.id, orderId, { action: "order_finished", channelId: interaction.channelId, staffId: interaction.user.id, status: "FINISHED" });
  await interaction.editReply("Pedido finalizado. Este canal será fechado.");
  if (order.serviceChannelId) setTimeout(() => void interaction.guild?.channels.cache.get(order.serviceChannelId ?? "")?.delete("Pedido finalizado").catch(() => null), 5000).unref();
}

async function showReasonModal(interaction: ButtonInteraction, kind: "reject" | "cancel_staff") {
  const orderId = interaction.customId.split(":")[2] ?? "";
  const modal = new ModalBuilder().setCustomId(`${PREFIX}:reason:${kind}:${orderId}`).setTitle(kind === "reject" ? "Recusar pagamento" : "Cancelar pedido");
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("reason").setLabel("Motivo").setRequired(true).setStyle(TextInputStyle.Paragraph)));
  await interaction.showModal(modal);
}

async function submitReason(interaction: ModalSubmitInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const [, , kind, orderId] = interaction.customId.split(":");
  const runtime = await context.api.getManualPaymentRuntime(interaction.guild.id);
  const roleIds = kind === "reject" ? runtime.settings.rejectRoleIds : runtime.settings.finalizeRoleIds;
  if (!(await hasAnyRole(interaction.guild, interaction.user.id, roleIds))) return interaction.editReply("Você não possui permissão.");
  const reason = interaction.fields.getTextInputValue("reason");
  const status = kind === "reject" ? "REJECTED" : "CANCELLED_BY_STAFF";
  const order = await context.api.updateManualPaymentOrder(interaction.guild.id, orderId ?? "", { action: kind === "reject" ? "payment_rejected" : "cancelled_by_staff", channelId: interaction.channelId, reason, staffId: interaction.user.id, status });
  if (kind === "reject" && order.paymentChannelId) {
    const channel = interaction.guild.channels.cache.get(order.paymentChannelId);
    if (channel?.isSendable()) await channel.send(`Pagamento recusado: **${reason}**\nEnvie um novo comprovante ou cancele a compra.`).catch(() => null);
  }
  if (kind === "reject") {
    await notifyCustomer(interaction.guild, order.userId, buildRejectionMessage(runtime.settings, order, reason)).catch(() => null);
  }
  await refreshPaymentPanel(interaction.guild, context, runtime.settings, order);
  await interaction.editReply(kind === "reject" ? "Pagamento recusado." : "Pedido cancelado.");
}

async function requestNewProof(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const orderId = interaction.customId.split(":")[2] ?? "";
  await interaction.deferReply({ ephemeral: true });
  const runtime = await context.api.getManualPaymentRuntime(interaction.guild.id);
  if (!(await hasAnyRole(interaction.guild, interaction.user.id, runtime.settings.rejectRoleIds))) return interaction.editReply("Você não pode solicitar comprovante.");
  const order = await context.api.updateManualPaymentOrder(interaction.guild.id, orderId, { action: "new_proof_requested", channelId: interaction.channelId, proofMessageId: null, proofUrl: null, staffId: interaction.user.id, status: "PENDING_PAYMENT" });
  const channel = order.paymentChannelId ? interaction.guild.channels.cache.get(order.paymentChannelId) : null;
  if (channel?.isSendable()) await channel.send(`<@${order.userId}> envie um novo comprovante neste canal.`).catch(() => null);
  await refreshPaymentPanel(interaction.guild, context, runtime.settings, order);
  await interaction.editReply("Novo comprovante solicitado.");
}

async function refreshPaymentPanel(guild: Guild, context: BotContext, settings: ManualPaymentSettings, order: ManualPaymentOrder) {
  if (!order.paymentChannelId || !order.paymentMessageId) return;
  const channel = await guild.channels.fetch(order.paymentChannelId).catch(() => null);
  if (!channel || !("messages" in channel)) return;
  const message = await channel.messages.fetch(order.paymentMessageId).catch(() => null);
  if (message) await message.edit(createPaymentPanel(settings, order, settings.services.find((item) => item.id === order.serviceId))).catch(() => null);
}

async function expirePaymentChannel(guild: Guild, context: BotContext, orderId: string) {
  const runtime = await context.api.getManualPaymentRuntime(guild.id).catch(() => null);
  const order = runtime?.orders.find((item) => item.id === orderId);
  if (!runtime || !order || order.status !== "PENDING_PAYMENT") return;
  await context.api.updateManualPaymentOrder(guild.id, order.id, { action: "payment_expired", status: "CANCELLED_BY_STAFF", reason: "Tempo máximo de pagamento expirado." }).catch(() => null);
  if (order.paymentChannelId) await guild.channels.cache.get(order.paymentChannelId)?.delete("Pagamento expirado").catch(() => null);
}

async function openOrderChannel(interaction: ButtonInteraction) {
  await interaction.reply({ content: "Use o botão/link do próprio Discord para abrir o canal do pedido.", ephemeral: true });
}

async function openSupport(interaction: ButtonInteraction) {
  await interaction.reply({ content: "Depois da finalização, use o painel normal de tickets/suporte do servidor.", ephemeral: true });
}

async function hasAnyRole(guild: Guild, userId: string, roleIds: string[]) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return false;
  return member.permissions.has(PermissionFlagsBits.Administrator) || member.roles.cache.some((role) => roleIds.includes(role.id));
}

function createSalesServiceCard(service: ManualPaymentService) {
  const description = service.description?.trim() || "Serviço disponível para compra.";
  return `## ${serviceEmoji(service)} ${limitText(service.name, 100)}\n💰 Valor: **${money(service.amount)}**\n🏷️ Categoria: **${serviceCategoryLabel(service)}**\n📌 ${limitText(description, 450)}`;
}

function salePanelTitle(value: string | null | undefined) {
  const title = value?.trim() || "Serviços disponíveis";
  return /^[^\p{L}\p{N}]/u.test(title) ? title : `🛒 ${title}`;
}

function serviceEmoji(service: ManualPaymentService) {
  const category = service.serviceType?.trim().toLowerCase();
  if (category === "product") return "📦";
  if (category === "subscription") return "🔁";
  if (category === "custom") return "✨";
  return "🛒";
}

function limitButtonLabel(value: string) {
  return limitText(value, 58);
}

function paymentStatusVisual(order: ManualPaymentOrder) {
  if (["APPROVED", "IN_PROGRESS", "WAITING_CUSTOMER", "DELIVERED", "FINISHED"].includes(order.status)) {
    return {
      color: 0x22c55e,
      description: "Pagamento confirmado!\n\nSeu pedido foi liberado e será iniciado.",
      label: "🟢 Pagamento aprovado"
    };
  }
  if (order.status === "WAITING_STAFF_APPROVAL") {
    return {
      color: 0x3b82f6,
      description: order.proofUrl
        ? "Seu comprovante foi enviado.\n\nNossa equipe irá analisar em breve."
        : "Recebemos sua confirmação.\n\nEnvie o comprovante neste canal para nossa equipe analisar.",
      label: order.proofUrl ? "🔵 Comprovante enviado" : "🔵 Aguardando comprovante"
    };
  }
  if (order.status === "REJECTED") {
    return {
      color: 0xef4444,
      description: "Não foi possível validar o pagamento.\n\nEntre em contato com nossa equipe.",
      label: "🔴 Pagamento recusado"
    };
  }
  if (["CANCELLED_BY_CUSTOMER", "CANCELLED_BY_STAFF"].includes(order.status)) {
    return {
      color: 0xef4444,
      description: "Este pedido foi cancelado.",
      label: "🔴 Pedido cancelado"
    };
  }
  return {
    color: 0xf59e0b,
    description: "Estamos aguardando seu pagamento.",
    label: "🟡 Aguardando pagamento"
  };
}

function createPaymentDataSection(settings: ManualPaymentSettings, order: ManualPaymentOrder, pixKey: string | null, pixCopyCode: string | null) {
  return [
    "## 💸 Dados para Pagamento",
    `🏦 Método: **${paymentMethodLabel(order)}**`,
    "",
    "👤 Recebedor:",
    `**${settings.receiverName?.trim() || "Não informado"}**`,
    "",
    "🏛 Banco:",
    `**${settings.receiverBank?.trim() || "Não informado"}**`,
    "",
    "🔑 Chave Pix:",
    `\`${pixKey ?? "Não configurada"}\``,
    ...(pixCopyCode ? ["", "🧾 Código Pix Copia e Cola:", `\`${pixCopyCode}\``] : [])
  ].join("\n");
}

function getExplicitPixCopyCode(settings: ManualPaymentSettings) {
  return settings.pixCopyPasteCode?.trim() || null;
}

function getPixCopyCode(settings: ManualPaymentSettings) {
  return getExplicitPixCopyCode(settings) || settings.pixKey?.trim() || null;
}

function isSamePixValue(left: string | null | undefined, right: string | null | undefined) {
  return Boolean(left && right && left.trim() === right.trim());
}

function copyablePixMessage(label: string, value: string | null | undefined) {
  const text = value?.trim();
  if (!text) return `${label} não configurado. Avise a equipe para revisar os dados de pagamento.`;
  return `**${label}:**\n\`\`\`\n${text.replace(/```/g, "'''")}\n\`\`\``;
}

function formatOrderNumber(order: ManualPaymentOrder) {
  return `#${String(order.orderNumber).padStart(4, "0")}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Não informado";
  return new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Não informado";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
}

function formatTime(value: string | null | undefined) {
  if (!value) return "Não informado";
  return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function paymentMethodLabel(order: ManualPaymentOrder) {
  if (order.paymentMethod === "PIX_QR_CODE") return "Pix QR Code";
  return "Pix";
}

function serviceCategoryLabel(service: ManualPaymentService | null | undefined) {
  const value = service?.serviceType?.trim();
  if (!value) return "Manual";
  return ({
    custom: "Personalizado",
    product: "Produto",
    service: "Serviço",
    subscription: "Assinatura"
  } as Record<string, string>)[value] ?? value;
}

function limitText(value: string, limit: number) {
  const text = value.trim();
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 3))}...` : text;
}

function statusLabel(status: ManualPaymentOrderStatus) {
  return ({
    APPROVED: "Pagamento aprovado",
    CANCELLED_BY_CUSTOMER: "Cancelado pelo cliente",
    CANCELLED_BY_STAFF: "Cancelado pelo staff",
    DELIVERED: "Servico entregue",
    FINISHED: "Finalizado",
    IN_PROGRESS: "Em produção",
    PENDING_PAYMENT: "Aguardando pagamento",
    REJECTED: "Pagamento recusado",
    WAITING_CUSTOMER: "Aguardando cliente",
    WAITING_STAFF_APPROVAL: "Aguardando aprovação do staff"
  } as const)[status];
}

async function notifyCustomer(guild: Guild, userId: string, content: string) {
  const member = await guild.members.fetch(userId).catch(() => null);
  await (member?.user ?? await guild.client.users.fetch(userId).catch(() => null))?.send(content);
}

function buildApprovalMessage(settings: ManualPaymentSettings, order: ManualPaymentOrder) {
  return fillManualPaymentMessageTemplate(
    settings.approvalMessage?.trim() || "Seu pagamento foi aprovado. Seu pedido foi liberado para atendimento.",
    order
  );
}

function buildRejectionMessage(settings: ManualPaymentSettings, order: ManualPaymentOrder, reason: string) {
  return fillManualPaymentMessageTemplate(
    settings.rejectionMessage?.trim() || "Seu pagamento foi recusado. Motivo: {reason}",
    order,
    reason
  );
}

function fillManualPaymentMessageTemplate(template: string, order: ManualPaymentOrder, reason = "") {
  return template
    .replaceAll("{order}", formatOrderNumber(order))
    .replaceAll("{orderId}", order.id)
    .replaceAll("{product}", order.serviceName)
    .replaceAll("{value}", money(order.amount))
    .replaceAll("{reason}", reason || order.rejectionReason || "Não informado");
}

function parseColor(value: string) {
  return Number.parseInt(value.replace("#", ""), 16) || 0x22c55e;
}

function money(value: number) {
  return value.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
}

function slug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cliente";
}

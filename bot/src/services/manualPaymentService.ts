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
  type ButtonInteraction,
  type Client,
  type Guild,
  type Interaction,
  type Message,
  type ModalSubmitInteraction
} from "discord.js";
import type { BotContext } from "../types";
import type { ManualPaymentOrder, ManualPaymentOrderStatus, ManualPaymentService, ManualPaymentSettings } from "./apiClient";
import { renderComponentsV2Panel } from "./panelVisualRenderer";

const PREFIX = "manual_pay";

export function startManualPaymentService(client: Client<true>, context: BotContext) {
  context.socket.onManualPaymentPanelPublish((payload) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void publishManualPaymentPanel(guild, context);
  });
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
  if (!message.guild || message.author.bot || !message.attachments.size) return false;
  const runtime = await context.api.getManualPaymentRuntime(message.guild.id).catch(() => null);
  const order = runtime?.orders.find((item) => item.paymentChannelId === message.channelId && ["PENDING_PAYMENT", "REJECTED", "WAITING_STAFF_APPROVAL"].includes(item.status));
  if (!runtime || !order || order.userId !== message.author.id) return false;
  const attachment = message.attachments.find(isValidProofAttachment);
  if (!attachment) {
    await message.reply("Não consegui reconhecer esse arquivo como comprovante. Envie uma imagem ou PDF como anexo neste canal.").catch(() => null);
    return true;
  }
  const updated = await context.api.updateManualPaymentOrder(message.guild.id, order.id, {
    action: "proof_uploaded",
    channelId: message.channelId,
    proofMessageId: message.id,
    proofUrl: attachment.url,
    status: "WAITING_STAFF_APPROVAL"
  });
  await message.react("✅").catch(() => null);
  await refreshPaymentPanel(message.guild, context, runtime.settings, updated);
  await sendStaffApprovalLog(message.guild, context, runtime.settings, updated);
  return true;
}

function isValidProofAttachment(item: { contentType?: string | null; name?: string | null; url: string }) {
  const contentType = item.contentType?.toLowerCase() ?? "";
  if (contentType.startsWith("image/") || contentType === "application/pdf") return true;
  return hasProofFileExtension(item.name ?? "") || hasProofFileExtension(getUrlPathname(item.url));
}

function getUrlPathname(value: string) {
  try {
    return decodeURIComponent(new URL(value).pathname);
  } catch {
    return value.split("?")[0] ?? value;
  }
}

function hasProofFileExtension(value: string) {
  return /\.(png|jpe?g|webp|gif|pdf|heic|heif|bmp)$/i.test(value);
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
    footer: { text: "NexTechK • Loja de Serviços\nCompra protegida • Atendimento Manual" },
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
  const staffRoleIds = [...new Set([...settings.approveRoleIds, ...settings.rejectRoleIds, ...settings.logViewRoleIds])];
  return guild.channels.create({
    name: `pagamento-${slug(member?.displayName ?? order.username ?? userId)}-${String(order.orderNumber).padStart(3, "0")}`.slice(0, 90),
    parent: settings.paymentCategoryId ?? undefined,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] },
      { id: guild.members.me?.id ?? guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
      ...staffRoleIds.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))
    ],
    reason: `Pagamento manual pedido ${order.orderNumber}`,
    type: ChannelType.GuildText
  }) as Promise<TextChannel>;
}

function createPaymentPanel(settings: ManualPaymentSettings, order: ManualPaymentOrder, service?: ManualPaymentService | null) {
  const visual = paymentStatusVisual(order);
  const canAct = ["PENDING_PAYMENT", "REJECTED", "WAITING_STAFF_APPROVAL"].includes(order.status);
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
  const paymentInstructions = service?.customText?.trim() || settings.paymentInstructions?.trim() || "Faça o pagamento utilizando os dados abaixo e envie o comprovante neste canal.";
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
      `## 📋 Instruções\n1️⃣ Faça o pagamento utilizando a chave Pix.\n\n2️⃣ Após realizar o pagamento, clique em **Já fiz o pagamento**.\n\n3️⃣ Envie o comprovante neste canal.\n\n4️⃣ Aguarde a conferência da equipe.\n\n⚠️ A aprovação é manual.\n\n${limitText(paymentInstructions, 900)}`,
      "## 🔔 Avisos\n• Não altere o valor.\n\n• Não feche este ticket.\n\n• Caso o pagamento não seja identificado, o pedido permanecerá pendente.\n\n• Após aprovado, o sistema atualizará automaticamente o status.",
      `## 🧾 Registro do Pedido\n${proofSection}`
    ],
    footer: { text: "NexTechK • Sistema de Pagamentos\nPedido protegido • Atendimento Manual" },
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
  await interaction.editReply("Confirmação recebida. Envie o comprovante como imagem ou PDF neste canal para a equipe validar.");
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

async function sendStaffApprovalLog(guild: Guild, context: BotContext, settings: ManualPaymentSettings, order: ManualPaymentOrder) {
  if (!settings.logChannelId) return null;
  const channel = await guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel?.isSendable()) return null;
  const payload = renderComponentsV2Panel({
    accentColor: 0xf59e0b,
    actions: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:approve:${order.id}`).setLabel("Aprovar pagamento").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${PREFIX}:reject:${order.id}`).setLabel("Recusar pagamento").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`${PREFIX}:new_proof:${order.id}`).setLabel("Solicitar novo comprovante").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setLabel("Abrir canal").setStyle(ButtonStyle.Link).setURL(order.paymentChannelId ? `https://discord.com/channels/${guild.id}/${order.paymentChannelId}` : `https://discord.com/channels/${guild.id}`)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:cancel_staff:${order.id}`).setLabel("Cancelar pedido").setStyle(ButtonStyle.Danger)
      )
    ],
    description: `Pedido #${String(order.orderNumber).padStart(3, "0")} aguardando aprovacao manual.`,
    fields: [`Cliente: <@${order.userId}>\nServico: **${order.serviceName}**\nValor: **${money(order.amount)}**\nStatus: ${statusLabel(order.status)}\nCanal: ${order.paymentChannelId ? `<#${order.paymentChannelId}>` : "não informado"}`, order.proofUrl ? `Comprovante: ${order.proofUrl}` : "Sem comprovante."],
    image: order.proofUrl ? { imageEnabled: true, imagePosition: "bottom", imageUrl: order.proofUrl } : null,
    moduleId: "manual-payments",
    title: "Aprovação de pagamento"
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
  await refreshPaymentPanel(interaction.guild, context, runtime.settings, order);
  await interaction.editReply(kind === "reject" ? "Pagamento recusado." : "Pedido cancelado.");
}

async function requestNewProof(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const orderId = interaction.customId.split(":")[2] ?? "";
  await interaction.deferReply({ ephemeral: true });
  const runtime = await context.api.getManualPaymentRuntime(interaction.guild.id);
  if (!(await hasAnyRole(interaction.guild, interaction.user.id, runtime.settings.rejectRoleIds))) return interaction.editReply("Você não pode solicitar comprovante.");
  const order = await context.api.updateManualPaymentOrder(interaction.guild.id, orderId, { action: "new_proof_requested", channelId: interaction.channelId, staffId: interaction.user.id, status: "PENDING_PAYMENT" });
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
      label: "🔵 Comprovante enviado"
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

function parseColor(value: string) {
  return Number.parseInt(value.replace("#", ""), 16) || 0x22c55e;
}

function money(value: number) {
  return value.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
}

function slug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cliente";
}

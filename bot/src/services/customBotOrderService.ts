import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type Guild,
  type Interaction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction
} from "discord.js";
import type { BotContext } from "../types";
import type { CustomBotOrder, CustomBotOrderSettings, CustomBotOrderStatus } from "./apiClient";
import { renderComponentsV2Panel } from "./panelVisualRenderer";
import { replaceSystemEmojis, systemComponentEmoji, systemEmojiText } from "./systemEmojiService";

const PREFIX = "custom_bot_order";
const FINAL_STATUSES = new Set(["FINISHED", "CANCELLED"]);

export function startCustomBotOrderService(client: Client<true>, context: BotContext) {
  context.socket.onCustomBotOrderPanelPublish((payload) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void publishCustomBotOrderPanel(guild, context);
  });
  context.socket.onCustomBotOrderPanelDelete((payload) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void deleteCustomBotOrderPanel(guild, context);
  });
}

export async function handleCustomBotOrderInteraction(interaction: Interaction, context: BotContext) {
  if (!("customId" in interaction) || !interaction.customId.startsWith(`${PREFIX}:`)) return false;
  if (interaction.isButton() && interaction.customId === `${PREFIX}:open`) { await showOrderModal(interaction); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:open_existing:`)) { await interaction.reply({ content: "Use o botão de link para ir ao seu ticket.", ephemeral: true }); return true; }
  if (interaction.isModalSubmit() && interaction.customId === `${PREFIX}:modal`) { await submitOrderModal(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:claim:`)) { await claimOrder(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:notice:`)) { await sendNotice(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:status:`)) { await showStatusSelect(interaction, context); return true; }
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(`${PREFIX}:status_select:`)) { await applyStatus(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:note:`)) { await showNoteModal(interaction); return true; }
  if (interaction.isModalSubmit() && interaction.customId.startsWith(`${PREFIX}:note_modal:`)) { await submitNote(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:close:`)) { await showCloseModal(interaction); return true; }
  if (interaction.isModalSubmit() && interaction.customId.startsWith(`${PREFIX}:close_modal:`)) { await closeOrder(interaction, context); return true; }
  return false;
}

async function publishCustomBotOrderPanel(guild: Guild, context: BotContext) {
  const { settings } = await context.api.getCustomBotOrderRuntime(guild.id);
  if (!settings.enabled || !settings.panelChannelId) return null;
  const channel = await guild.channels.fetch(settings.panelChannelId).catch(() => null);
  if (!channel?.isSendable()) return null;

  const payload = createPublicPanel(settings, guild);
  if (settings.panelMessageId && "messages" in channel) {
    const current = await channel.messages.fetch(settings.panelMessageId).catch(() => null);
    if (current) {
      await current.edit(payload);
      return current.id;
    }
  }

  const message = await channel.send(payload);
  await context.api.updateCustomBotOrderPanelState(guild.id, message.id);
  return message.id;
}

async function deleteCustomBotOrderPanel(guild: Guild, context: BotContext) {
  const { settings } = await context.api.getCustomBotOrderRuntime(guild.id);
  if (settings.panelChannelId && settings.panelMessageId) {
    const channel = await guild.channels.fetch(settings.panelChannelId).catch(() => null);
    if (channel && "messages" in channel) {
      const message = await channel.messages.fetch(settings.panelMessageId).catch(() => null);
      await message?.delete().catch(() => null);
    }
  }
  await context.api.updateCustomBotOrderPanelState(guild.id, null);
}

function createPublicPanel(settings: CustomBotOrderSettings, guild?: Guild | null) {
  const panelEmoji = displayEmoji(settings.panelEmoji, "robo", guild);
  const buttonEmoji = displayEmoji(settings.buttonEmoji, "caixa", guild);
  const benefits = [
    "Bots personalizados para Discord",
    "Sistemas administrativos",
    "Dashboards integradas",
    "Sistemas de tickets e vendas",
    "Integrações com APIs",
    "Sistemas para FiveM",
    "Automações personalizadas",
    "Painéis em Componentes V2"
  ];
  return renderComponentsV2Panel({
    accentColor: parseColor(settings.color),
    actions: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:open`).setEmoji(buttonEmoji).setLabel(settings.buttonLabel || "Faça o seu pedido!").setStyle(ButtonStyle.Primary)
      )
    ],
    description: `**${settings.subtitle}**\n\n${settings.description}`,
    fields: [
      `## ${panelEmoji} O que podemos desenvolver:\n${benefits.map((item) => `- ${item}`).join("\n")}`,
      `## Interessado?\n${settings.introText}`
    ],
    footer: { image: settings.footerImageUrl, text: settings.footerText },
    image: settings.bannerUrl ? { imageEnabled: true, imagePosition: "bottom", imageUrl: settings.bannerUrl } : settings.thumbnailUrl ? { imageEnabled: true, imagePosition: "thumbnail", imageUrl: settings.thumbnailUrl } : null,
    moduleId: "custom-bot-orders",
    title: `${panelEmoji} ${settings.title}`
  });
}

async function showOrderModal(interaction: ButtonInteraction) {
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:modal`)
    .setTitle("Pedido de Bot Personalizado")
    .addComponents(
      modalInput("projectName", "Nome do projeto", TextInputStyle.Short, true, "Ex: Bot de vendas automático"),
      modalInput("type", "Tipo de bot", TextInputStyle.Short, true, "Discord, FiveM, vendas, dashboard..."),
      modalInput("description", "Descrição completa do projeto", TextInputStyle.Paragraph, true),
      modalInput("features", "Funcionalidades desejadas", TextInputStyle.Paragraph, true),
      modalInput("budgetDeadline", "Prazo, orçamento, referências e observações", TextInputStyle.Paragraph, false)
    );
  await interaction.showModal(modal);
}

async function submitOrderModal(interaction: ModalSubmitInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const { settings } = await context.api.getCustomBotOrderRuntime(interaction.guild.id);
  const combined = field(interaction, "budgetDeadline");

  try {
    const order = await context.api.createCustomBotOrder(interaction.guild.id, {
      budget: combined,
      customerId: interaction.user.id,
      customerName: interaction.user.username,
      deadline: combined,
      description: field(interaction, "description"),
      features: field(interaction, "features"),
      notes: combined,
      projectName: field(interaction, "projectName"),
      references: combined,
      type: field(interaction, "type")
    });
    const channel = await createOrderChannel(interaction.guild, settings, order);
    const panel = await channel.send(createInternalPanel(settings, { ...order, channelId: channel.id }, interaction.guild));
    const updated = await context.api.updateCustomBotOrder(interaction.guild.id, order.id, { action: "ticket_channel_created", channelId: channel.id, panelMessageId: panel.id });
    const mention = [interaction.user.toString(), settings.mentionRoleId ? `<@&${settings.mentionRoleId}>` : null].filter(Boolean).join(" ");
    await channel.send({ allowedMentions: { roles: settings.mentionRoleId ? [settings.mentionRoleId] : [], users: [interaction.user.id] }, content: `${mention}\nPedido ${order.ticketId} aberto.` }).catch(() => null);
    await panel.edit(createInternalPanel(settings, updated, interaction.guild)).catch(() => null);
    await interaction.editReply(`Pedido criado: <#${channel.id}>.`);
  } catch (error) {
    const active = (error as { response?: { data?: { activeOrder?: CustomBotOrder | null; message?: string } } }).response?.data?.activeOrder ?? null;
    if (active?.channelId) {
      await interaction.editReply({
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setLabel("Ir para o meu ticket").setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${interaction.guild.id}/${active.channelId}`))],
        content: "Você já possui um pedido em andamento."
      });
      return;
    }
    await interaction.editReply(readApiMessage(error) || "Não foi possível abrir o pedido agora.");
  }
}

async function createOrderChannel(guild: Guild, settings: CustomBotOrderSettings, order: CustomBotOrder) {
  const staffRoleIds = [...new Set([...settings.staffRoleIds, ...settings.responsibleRoleIds, ...settings.assignRoleIds, ...settings.closeRoleIds, ...settings.adminRoleIds])];
  return guild.channels.create({
    name: `bot-${String(order.orderNumber).padStart(4, "0")}-${slug(order.customerName ?? order.customerId)}`.slice(0, 90),
    parent: settings.categoryId ?? undefined,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: order.customerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] },
      { id: guild.members.me?.id ?? guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
      ...staffRoleIds.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] }))
    ],
    reason: `Pedido de bot personalizado ${order.ticketId}`,
    type: ChannelType.GuildText
  }) as Promise<TextChannel>;
}

function createInternalPanel(settings: CustomBotOrderSettings, order: CustomBotOrder, guild?: Guild | null) {
  const status = statusDefinition(settings, order.status);
  return renderComponentsV2Panel({
    accentColor: parseColor(status.color || settings.color),
    actions: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:claim:${order.id}`).setEmoji(systemComponentEmoji("homem", guild)).setLabel(order.assignedStaffId ? "Transferir atendimento" : "Assumir ticket").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${PREFIX}:notice:${order.id}`).setEmoji(systemComponentEmoji("alerta", guild)).setLabel("Enviar aviso").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${PREFIX}:status:${order.id}`).setEmoji(systemComponentEmoji("relogio", guild)).setLabel("Alterar status").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${PREFIX}:note:${order.id}`).setEmoji(systemComponentEmoji("prancheta_caneta", guild)).setLabel("Adicionar observação").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${PREFIX}:close:${order.id}`).setEmoji(systemComponentEmoji("porta", guild)).setLabel("Fechar ticket").setStyle(ButtonStyle.Danger)
      )
    ],
    description: `${replaceSystemEmojis(status.emoji, guild)} **${status.name}**\nPedido **${order.ticketId}**`,
    fields: [
      [
        `## Dados do pedido`,
        `Cliente: <@${order.customerId}>`,
        `ID: \`${order.customerId}\``,
        `Aberto em: ${formatDateTime(order.createdAt)}`,
        `Projeto: **${limit(order.projectName, 120)}**`,
        `Tipo: **${limit(order.type, 120)}**`,
        `Prazo: ${order.deadline || "Não informado"}`,
        `Orçamento: ${order.budget || "Não informado"}`,
        `Responsável: ${order.assignedStaffId ? `<@${order.assignedStaffId}>` : "Aguardando atendimento"}`
      ].join("\n"),
      `## Descrição\n${limit(order.description, 1000)}`,
      `## Funcionalidades\n${limit(order.features, 1000)}`,
      order.references || order.notes ? `## Referências e observações\n${limit([order.references, order.notes].filter(Boolean).join("\n"), 900)}` : ""
    ].filter(Boolean),
    footer: { text: `NexTech • Atualizado em ${formatDateTime(order.updatedAt)}` },
    moduleId: "custom-bot-orders",
    title: "Pedido de Bot Personalizado"
  });
}

async function claimOrder(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const orderId = idPart(interaction.customId);
  const runtime = await context.api.getCustomBotOrderRuntime(interaction.guild.id);
  if (!(await hasStaffPermission(interaction, runtime.settings, "assign"))) return interaction.editReply("Você não pode assumir este ticket.");
  const order = await context.api.updateCustomBotOrder(interaction.guild.id, orderId, { action: "ticket_claimed", actorId: interaction.user.id, actorName: interaction.user.username, assignedStaffId: interaction.user.id });
  await refreshOrderPanel(interaction.guild, runtime.settings, order);
  await interaction.editReply("Ticket assumido.");
}

async function sendNotice(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const orderId = idPart(interaction.customId);
  const runtime = await context.api.getCustomBotOrderRuntime(interaction.guild.id);
  const order = runtime.orders.find((item) => item.id === orderId);
  if (!order) return interaction.editReply("Pedido não encontrado.");
  if (!(await hasStaffPermission(interaction, runtime.settings, "staff"))) return interaction.editReply("Você não pode enviar aviso.");
  if (order.lastNoticeAt && Date.now() - Date.parse(order.lastNoticeAt) < runtime.settings.noticeCooldownMinutes * 60_000) return interaction.editReply(`Aguarde ${runtime.settings.noticeCooldownMinutes} minutos entre avisos.`);
  const user = await interaction.client.users.fetch(order.customerId).catch(() => null);
  if (!user) return interaction.editReply("Cliente não encontrado.");
  const url = order.channelId ? `https://discord.com/channels/${interaction.guild.id}/${order.channelId}` : `https://discord.com/channels/${interaction.guild.id}`;
  await user.send(renderComponentsV2Panel({
    accentColor: 0x8b5cf6,
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setEmoji(systemComponentEmoji("link", interaction.guild)).setLabel("Abrir meu ticket").setStyle(ButtonStyle.Link).setURL(url))],
    description: "A equipe responsável pelo seu pedido enviou um aviso e está aguardando sua resposta no ticket.",
    fields: [`Pedido: **${order.ticketId}**\nProjeto: **${order.projectName}**\nResponsável: <@${interaction.user.id}>\nServidor: **${interaction.guild.name}**\nData: ${formatDateTime(new Date().toISOString())}`],
    moduleId: "custom-bot-orders",
    title: `${systemEmojiText("alerta", interaction.guild)} Sua equipe chamou você`
  })).catch(async () => {
    await context.api.updateCustomBotOrder(interaction.guild!.id, order.id, { action: "dm_failed", actorId: interaction.user.id, actorName: interaction.user.username });
    throw new Error("Não consegui enviar DM para o cliente.");
  });
  const updated = await context.api.updateCustomBotOrder(interaction.guild.id, order.id, { action: "notice_sent", actorId: interaction.user.id, actorName: interaction.user.username, notice: true });
  await refreshOrderPanel(interaction.guild, runtime.settings, updated);
  await interaction.editReply("Cliente notificado por DM.");
}

async function showStatusSelect(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const runtime = await context.api.getCustomBotOrderRuntime(interaction.guild.id);
  if (!(await hasStaffPermission(interaction, runtime.settings, "staff"))) return interaction.reply({ content: "Você não pode alterar status.", ephemeral: true });
  const orderId = idPart(interaction.customId);
  await interaction.reply({
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}:status_select:${orderId}`)
        .setPlaceholder("Selecione o novo status")
        .addOptions(runtime.settings.statusDefinitions.slice(0, 25).map((status) => ({ emoji: replaceSystemEmojis(status.emoji, interaction.guild), label: status.name, value: status.id })))
    )],
    content: "Escolha o novo status do pedido.",
    ephemeral: true
  });
}

async function applyStatus(interaction: StringSelectMenuInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const orderId = idPart(interaction.customId);
  const status = interaction.values[0] as CustomBotOrderStatus;
  const runtime = await context.api.getCustomBotOrderRuntime(interaction.guild.id);
  const order = await context.api.updateCustomBotOrder(interaction.guild.id, orderId, { action: "status_changed", actorId: interaction.user.id, actorName: interaction.user.username, status });
  await refreshOrderPanel(interaction.guild, runtime.settings, order);
  await interaction.editReply(`Status alterado para ${statusDefinition(runtime.settings, status).name}.`);
}

async function showNoteModal(interaction: ButtonInteraction) {
  await interaction.showModal(new ModalBuilder()
    .setCustomId(`${PREFIX}:note_modal:${idPart(interaction.customId)}`)
    .setTitle("Observação interna")
    .addComponents(modalInput("note", "Observação interna", TextInputStyle.Paragraph, true)));
}

async function submitNote(interaction: ModalSubmitInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const runtime = await context.api.getCustomBotOrderRuntime(interaction.guild.id);
  if (!(await hasStaffPermission(interaction, runtime.settings, "staff"))) return interaction.editReply("Você não pode adicionar observações.");
  await context.api.addCustomBotOrderNote(interaction.guild.id, idPart(interaction.customId), { authorId: interaction.user.id, authorName: interaction.user.username, content: field(interaction, "note") });
  await interaction.editReply("Observação interna registrada.");
}

async function showCloseModal(interaction: ButtonInteraction) {
  await interaction.showModal(new ModalBuilder()
    .setCustomId(`${PREFIX}:close_modal:${idPart(interaction.customId)}`)
    .setTitle("Fechar pedido")
    .addComponents(
      modalInput("reason", "Motivo do fechamento", TextInputStyle.Paragraph, true),
      modalInput("result", "Resultado do pedido", TextInputStyle.Paragraph, false)
    ));
}

async function closeOrder(interaction: ModalSubmitInteraction, context: BotContext) {
  if (!interaction.guild || !interaction.channel?.isTextBased()) return;
  await interaction.deferReply({ ephemeral: true });
  const orderId = idPart(interaction.customId);
  const runtime = await context.api.getCustomBotOrderRuntime(interaction.guild.id);
  const current = runtime.orders.find((item) => item.id === orderId);
  if (!current) return interaction.editReply("Pedido não encontrado.");
  if (!(await hasStaffPermission(interaction, runtime.settings, "close"))) return interaction.editReply("Você não pode fechar este ticket.");
  const messages = await collectTranscript(interaction.channel as TextChannel);
  const transcript = buildTranscript(current, messages, field(interaction, "reason"), field(interaction, "result"));
  const order = await context.api.updateCustomBotOrder(interaction.guild.id, orderId, {
    action: "ticket_closed",
    actorId: interaction.user.id,
    actorName: interaction.user.username,
    closedById: interaction.user.id,
    closeReason: field(interaction, "reason"),
    result: field(interaction, "result"),
    status: "FINISHED",
    transcriptAdminText: transcript,
    transcriptCustomerText: transcript
  });
  await sendTranscriptDm(interaction.guild, runtime.settings, order, transcript).catch(() => null);
  await refreshOrderPanel(interaction.guild, runtime.settings, order);
  await interaction.editReply("Pedido fechado e transcript gerado.");
}

async function refreshOrderPanel(guild: Guild, settings: CustomBotOrderSettings, order: CustomBotOrder) {
  if (!order.channelId || !order.panelMessageId) return;
  const channel = await guild.channels.fetch(order.channelId).catch(() => null);
  if (!channel || !("messages" in channel)) return;
  const message = await channel.messages.fetch(order.panelMessageId).catch(() => null);
  await message?.edit(createInternalPanel(settings, order, guild)).catch(() => null);
}

async function sendTranscriptDm(guild: Guild, settings: CustomBotOrderSettings, order: CustomBotOrder, transcript: string) {
  const user = await guild.client.users.fetch(order.customerId).catch(() => null);
  const file = new AttachmentBuilder(Buffer.from(transcript, "utf8"), { name: `${order.ticketId}.txt` });
  const payload = renderComponentsV2Panel({
    accentColor: 0x22c55e,
    description: "Seu pedido de bot personalizado foi encerrado pela nossa equipe.",
    fields: [`Pedido: **${order.ticketId}**\nProjeto: **${order.projectName}**\nAberto em: ${formatDateTime(order.createdAt)}\nEncerrado em: ${formatDateTime(new Date().toISOString())}\nStatus final: **${statusDefinition(settings, order.status).name}**\nMotivo: ${order.closeReason || "Não informado"}`],
    moduleId: "custom-bot-orders",
    title: `${systemEmojiText("caixa", guild)} Pedido finalizado`
  });
  await user?.send({ ...payload, files: [file] });
}

async function collectTranscript(channel: TextChannel) {
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  return [...(messages?.values() ?? [])]
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map((message) => `[${formatDateTime(message.createdAt.toISOString())}] ${message.author.tag}: ${message.content || "(sem texto)"}${message.attachments.size ? `\nAnexos: ${message.attachments.map((a) => a.url).join(", ")}` : ""}`)
    .join("\n");
}

function buildTranscript(order: CustomBotOrder, messages: string, reason: string, result: string) {
  return [
    `Pedido: ${order.ticketId}`,
    `Projeto: ${order.projectName}`,
    `Cliente: ${order.customerName ?? order.customerId}`,
    `Status: ${order.status}`,
    `Motivo: ${reason}`,
    `Resultado: ${result}`,
    "",
    "Informações do formulário",
    `Tipo: ${order.type}`,
    `Descrição: ${order.description}`,
    `Funcionalidades: ${order.features}`,
    `Prazo: ${order.deadline ?? "Não informado"}`,
    `Orçamento: ${order.budget ?? "Não informado"}`,
    `Referências: ${order.references ?? "Não informado"}`,
    "",
    "Histórico",
    messages
  ].join("\n");
}

async function hasStaffPermission(interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction, settings: CustomBotOrderSettings, level: "staff" | "assign" | "close") {
  if (!interaction.guild) return false;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const roleIds = new Set([
    ...settings.adminRoleIds,
    ...settings.staffRoleIds,
    ...settings.responsibleRoleIds,
    ...(level === "assign" ? settings.assignRoleIds : []),
    ...(level === "close" ? settings.closeRoleIds : [])
  ]);
  return member.roles.cache.some((role) => roleIds.has(role.id));
}

function modalInput(id: string, label: string, style: TextInputStyle, required: boolean, placeholder?: string) {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setRequired(required)
    .setMaxLength(style === TextInputStyle.Paragraph ? 1500 : 120);
  if (placeholder) input.setPlaceholder(placeholder);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

function field(interaction: ModalSubmitInteraction, id: string) {
  return interaction.fields.getTextInputValue(id).trim();
}

function idPart(customId: string) {
  return customId.split(":").pop() ?? "";
}

function statusDefinition(settings: CustomBotOrderSettings, id: string) {
  return settings.statusDefinitions.find((status) => status.id === id) ?? settings.statusDefinitions[0] ?? { color: settings.color, emoji: systemEmojiText("prancheta"), id, name: id, order: 0, dmEnabled: false };
}

function displayEmoji(value: string | null | undefined, fallback: Parameters<typeof systemEmojiText>[0], guild?: Guild | null) {
  const normalized = value?.trim();
  return normalized ? replaceSystemEmojis(normalized, guild) : systemEmojiText(fallback, guild);
}

function parseColor(value: string) {
  const normalized = value.replace("#", "").trim();
  return /^[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized, 16) : 0x8b5cf6;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function limit(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function slug(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cliente";
}

function readApiMessage(error: unknown) {
  return (error as { response?: { data?: { message?: string } } }).response?.data?.message;
}

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Attachment,
  type ButtonInteraction,
  type Client,
  type Guild,
  type Interaction,
  type Message,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction
} from "discord.js";
import type { BotContext } from "../types";
import type { FivemGoalSettings } from "./apiClient";

const PREFIX = "fivem_goal";
const REQUEST_CHANNEL_CUSTOM_ID = `${PREFIX}:request_channel`;
const ALLOWED_IMAGE_EXTENSIONS = /\.(png|jpe?g|webp)(?:\?.*)?$/i;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const pendingImages = new Map<string, { channelId: string; expiresAt: number; imageUrl: string; metaId: string | null; userId: string }>();

export function startFivemGoalService(client: Client<true>, context: BotContext) {
  context.socket.onFivemGoalPanelPublish((payload) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void publishGoalRequestPanel(guild, context);
  });
}

export async function ensureFivemGoalChannelForUser(context: BotContext, guild: Guild, userId: string, username: string, categoryId?: string | null) {
  const settings = await context.api.getFivemGoalSettings(guild.id).catch(() => null);
  if (!settings?.enabled) return null;

  const existing = await context.api.getFivemGoalChannelByUser(guild.id, userId).catch(() => null);
  if (existing?.channelId) {
    const existingChannel = await guild.channels.fetch(existing.channelId).catch(() => null);
    if (existingChannel?.isTextBased() && !existingChannel.isDMBased() && "messages" in existingChannel) {
      const recent = await existingChannel.messages.fetch({ limit: 30 }).catch(() => null);
      const hasPanel = recent?.some((message) => message.author.id === guild.client.user.id && JSON.stringify(message.components.map((component) => component.toJSON())).includes(`${PREFIX}:user:refresh:${userId}`));
      if (!hasPanel) await existingChannel.send(await createUserGoalPanel(context, guild.id, userId, username)).catch(() => null);
    }
    return existing.channelId;
  }

  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) return null;
  const member = await guild.members.fetch(userId).catch(() => null);
  const channelName = renderChannelName(settings.channelNameTemplate, username, userId);
  const channel = await guild.channels.create({
    name: channelName,
    parent: categoryId ?? settings.categoryId ?? undefined,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
      ...(settings.viewRoleId ? [{ id: settings.viewRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] }] : []),
      ...(settings.managerRoleId ? [{ id: settings.managerRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory] }] : []),
      { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] }
    ],
    reason: `Canal de metas FiveM para ${userId}`,
    type: ChannelType.GuildText
  });

  await context.api.saveFivemGoalChannel({ channelId: channel.id, guildId: guild.id, userId });
  await channel.send(await createUserGoalPanel(context, guild.id, userId, username)).catch(() => null);

  return channel.id;
}

export async function handleFivemGoalMessage(message: Message, context: BotContext) {
  if (!message.guild || message.author.bot || !message.attachments.size) return false;
  const goalChannel = await context.api.getFivemGoalChannelByChannel(message.channel.id).catch(() => null);

  if (!goalChannel) {
    return false;
  }

  if (goalChannel.userId !== message.author.id) {
    await message.reply("Essa call/canal de meta pertence a outro usuário. Envie sua foto apenas no seu canal individual de meta.").catch(() => null);
    await context.api.postLog({
      guildId: message.guild.id,
      message: "Foto de meta enviada no canal individual errado.",
      metadata: {
        channelId: message.channel.id,
        ownerId: goalChannel.userId
      },
      type: "fivem.goals.photo_wrong_channel",
      userId: message.author.id
    }).catch(() => null);
    return true;
  }

  const settings = await context.api.getFivemGoalSettings(message.guild.id).catch(() => null);
  if (!settings?.enabled) return false;

  const image = message.attachments.find(isAllowedGoalImage);

  if (!image) {
    await message.reply("Envie uma imagem válida em PNG, JPG, JPEG ou WEBP no seu canal de meta. Outros arquivos não são aceitos.").catch(() => null);
    await context.api.postLog({
      guildId: message.guild.id,
      message: "Foto de meta recusada por formato inválido.",
      metadata: {
        channelId: message.channel.id,
        attachmentCount: message.attachments.size,
        allowedFormats: ["png", "jpg", "jpeg", "webp"]
      },
      type: "fivem.goals.photo_invalid",
      userId: message.author.id
    }).catch(() => null);
    return true;
  }

  await message.reply(createImageReviewPayload(message.author.id, message.channel.id, image.url, settings));
  await context.api.postLog({
    guildId: message.guild.id,
    message: "Foto de meta recebida no canal individual.",
    metadata: {
      channelId: message.channel.id,
      imageUrl: image.url
    },
    type: "fivem.goals.photo_received",
    userId: message.author.id
  }).catch(() => null);
  return true;
}

export async function handleFivemGoalInteraction(interaction: Interaction, context: BotContext) {
  if (!("customId" in interaction) || !interaction.customId.startsWith(`${PREFIX}:`)) return false;

  if (interaction.isButton() && interaction.customId === REQUEST_CHANNEL_CUSTOM_ID) {
    await handleGoalChannelRequest(interaction, context);
    return true;
  }

  if (interaction.isButton() && interaction.customId === `${PREFIX}:help`) {
    await interaction.reply({ content: "Clique em Solicitar canal de meta. Depois envie suas fotos apenas no seu canal individual para registrar comprovantes.", ephemeral: true });
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:user:`)) {
    await handleUserGoalPanelAction(interaction, context);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:register:`)) {
    await showGoalModal(interaction, context);
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(`${PREFIX}:choose:`)) {
    const token = interaction.customId.split(":")[2] ?? "";
    const pending = pendingImages.get(token);
    if (pending) pending.metaId = interaction.values[0] ?? null;
    await showGoalModal(interaction, context);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith(`${PREFIX}:modal:`)) {
    await submitGoalModal(interaction, context);
    return true;
  }

  return false;
}

async function handleGoalChannelRequest(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const settings = await context.api.getFivemGoalSettings(interaction.guild.id).catch(() => null);
  if (!settings?.enabled) {
    await interaction.editReply("O sistema de metas nao esta ativo neste servidor.");
    return;
  }
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const channelId = await ensureFivemGoalChannelForUser(context, interaction.guild, interaction.user.id, member?.displayName ?? interaction.user.username);
  if (!channelId) {
    await interaction.editReply("Nao foi possivel criar seu canal de meta. Avise a administracao para conferir categoria e permissoes do bot.");
    return;
  }
  await interaction.editReply(`Seu canal individual de meta esta pronto: <#${channelId}>`);
}

async function publishGoalRequestPanel(guild: Guild, context: BotContext) {
  const settings = await context.api.getFivemGoalSettings(guild.id);
  if (!settings.enabled || !settings.requestPanelEnabled || !settings.requestPanelChannelId) return;
  const channel = await guild.channels.fetch(settings.requestPanelChannelId).catch(() => null);
  if (!channel || !("send" in channel) || !("messages" in channel)) return;
  const payload = createGoalRequestPanelPayload(settings.requestPanelTitle, settings.requestPanelDescription);
  if (settings.requestPanelMessageId) {
    const message = await channel.messages.fetch(settings.requestPanelMessageId).catch(() => null);
    if (!message) return;
    await message.edit(payload).catch(() => null);
    return;
  }
  const message = await channel.send(payload).catch(() => null);
  if (message) {
    await context.api.updateFivemGoalPanelState({ guildId: guild.id, messageId: message.id }).catch(() => null);
  }
}

function createGoalRequestPanelPayload(title: string, description: string) {
  return {
    allowedMentions: { parse: [] as never[] },
    components: [
      {
        type: 17,
        accent_color: 0x22c55e,
        components: [
          { type: 10, content: `# ${title || "Sistema de Metas FiveM"}\n${description || "Solicite seu canal individual de meta para enviar comprovantes e acompanhar seu progresso."}` },
          { type: 10, content: "Use o botao abaixo para criar ou localizar seu canal individual de meta." }
        ]
      },
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(REQUEST_CHANNEL_CUSTOM_ID).setLabel("Solicitar canal de meta").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${PREFIX}:help`).setLabel("Ajuda").setStyle(ButtonStyle.Secondary)
      )
    ],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

async function showGoalModal(interaction: ButtonInteraction | StringSelectMenuInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const [, , imageToken] = interaction.customId.split(":");
  const pending = pendingImages.get(imageToken ?? "");

  if (!pending || pending.expiresAt < Date.now()) {
    pendingImages.delete(imageToken ?? "");
    await interaction.reply({ content: "Essa foto expirou. Envie a imagem novamente no seu canal de meta.", ephemeral: true });
    return;
  }

  if (pending.userId !== interaction.user.id || pending.channelId !== interaction.channelId) {
    await interaction.reply({ content: "Somente o dono do canal de meta pode registrar essa foto, dentro do próprio canal.", ephemeral: true });
    return;
  }

  const settings = await context.api.getFivemGoalSettings(interaction.guild.id);
  const activeConfig = settings.configs?.find((config) => config.id === pending.metaId) ?? settings.configs?.find((config) => config.status === "active") ?? settings.configs?.[0] ?? null;
  pending.metaId = activeConfig?.id ?? null;
  const fieldsToRender = (activeConfig?.fields?.length ? activeConfig.fields : settings.fields).slice(0, 5);
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:${encodeURIComponent(imageToken ?? "")}`)
    .setTitle((activeConfig?.name ?? "Registrar Meta").slice(0, 45));

  fieldsToRender.forEach((field) => {
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(field.label.slice(0, 45))
      .setPlaceholder(field.placeholder ?? "Digite aqui")
      .setRequired(field.required)
      .setStyle(field.style === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short);
    if (field.minLength !== null) input.setMinLength(field.minLength);
    if (field.maxLength !== null) input.setMaxLength(field.maxLength);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  });

  await interaction.showModal(modal);
}

async function submitGoalModal(interaction: ModalSubmitInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const token = interaction.customId.split(":")[2] ?? "";
  const pending = pendingImages.get(token);

  if (!pending || pending.expiresAt < Date.now()) {
    pendingImages.delete(token);
    await interaction.editReply("Essa foto expirou. Envie a imagem novamente no seu canal de meta.");
    return;
  }

  if (pending.userId !== interaction.user.id || pending.channelId !== interaction.channelId) {
    await interaction.editReply("Essa foto só pode ser registrada pelo dono, no canal individual de meta correto.");
    return;
  }

  const imageUrl = pending.imageUrl;
  const settings = await context.api.getFivemGoalSettings(interaction.guild.id);
  const activeConfig = settings.configs?.find((config) => config.id === pending.metaId) ?? settings.configs?.find((config) => config.status === "active") ?? settings.configs?.[0] ?? null;
  const fieldsToRead = (activeConfig?.fields?.length ? activeConfig.fields : settings.fields).slice(0, 5);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const fields = fieldsToRead.map((field) => ({
    id: field.id,
    label: field.label,
    value: interaction.fields.getTextInputValue(field.id) || "-"
  }));
  const valueField = fields.find((field) => /giro|euro|dinheiro|valor|money/i.test(`${field.id} ${field.label}`))
    ?? fields.find((field) => /quantidade|qtd/i.test(`${field.id} ${field.label}`));
  const quantity = valueField ? parseGoalNumericValue(valueField.value) : null;

  await context.api.createFivemGoalEntry({
    channelId: interaction.channelId ?? "",
    fields,
    guildId: interaction.guild.id,
    imageUrl,
    metaId: activeConfig?.id ?? null,
    quantity: Number.isFinite(quantity) ? quantity : null,
    roleIdsSnapshot: member ? [...member.roles.cache.keys()] : [],
    userId: interaction.user.id
  });
  pendingImages.delete(token);
  await context.api.postLog({
    guildId: interaction.guild.id,
    message: "Meta registrada a partir de foto enviada no canal individual.",
    metadata: {
      channelId: interaction.channelId,
      imageUrl,
      quantity
    },
    type: "fivem.goals.entry_created",
    userId: interaction.user.id
  }).catch(() => null);

  await interaction.editReply("Meta registrada com sucesso.");
  await refreshUserGoalPanel(context, interaction.guild.id, interaction.channelId ?? "", interaction.user.id).catch(() => null);
}

async function handleUserGoalPanelAction(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const action = interaction.customId.split(":")[2] ?? "";
  const ownerId = interaction.customId.split(":")[3] ?? "";
  if (interaction.user.id !== ownerId && action !== "ranking") {
    await interaction.reply({ content: "Este painel pertence a outro membro.", ephemeral: true });
    return;
  }
  if (action === "add") {
    await interaction.reply({ content: "Envie a imagem do comprovante neste canal. Assim que ela chegar, o bot mostrara o botao **Registrar Meta**.", ephemeral: true });
    return;
  }
  const runtime = await context.api.getFivemGoalUserRuntime(interaction.guild.id, ownerId);
  if (action === "history") {
    const configs = new Map(runtime.configs.map((item) => [item.id, item.name]));
    const lines = runtime.submissions.slice(0, 20).map((item) => `• **${configs.get(item.metaId) ?? "Meta"}** — ${formatGoalValue(item.value)} — ${goalStatus(item.status)} — <t:${Math.floor(Date.parse(item.createdAt) / 1000)}:d>`);
    await interaction.reply({ content: lines.join("\n") || "Nenhum registro encontrado.", ephemeral: true });
    return;
  }
  if (action === "ranking") {
    const lines = runtime.ranking.slice(0, 25).map((item) => `${item.rank <= 3 ? ["🥇", "🥈", "🥉"][item.rank - 1] : `**${item.rank}.**`} <@${item.userId}> — ${formatGoalValue(item.total)}`);
    await interaction.reply({ content: `## Ranking de Metas\n${lines.join("\n") || "Ainda nao existem valores aprovados."}`, ephemeral: true });
    return;
  }
  if (action === "review") {
    await context.api.postLog({ guildId: interaction.guild.id, message: "Revisao de meta solicitada pelo membro.", metadata: { channelId: interaction.channelId }, type: "fivem.goals.review_requested", userId: ownerId }).catch(() => null);
    await interaction.reply({ content: "Revisao solicitada. A equipe responsavel foi registrada nos logs.", ephemeral: true });
    return;
  }
  if (action === "refresh") {
    await interaction.update(await createUserGoalPanel(context, interaction.guild.id, ownerId, interaction.user.username));
  }
}

async function createUserGoalPanel(context: BotContext, guildId: string, userId: string, username: string) {
  const runtime = await context.api.getFivemGoalUserRuntime(guildId, userId);
  const active = runtime.configs.find((item) => item.status === "active") ?? runtime.configs[0] ?? null;
  const approved = runtime.submissions.filter((item) => item.status === "approved" && (!active || item.metaId === active.id));
  const current = approved.reduce((total, item) => total + item.value, 0);
  const target = Math.max(1, active?.targetValue ?? 1);
  const percent = Math.min(100, Math.floor(current / target * 100));
  const filled = Math.round(percent / 10);
  const rank = runtime.ranking.find((item) => item.userId === userId)?.rank ?? null;
  const content = [
    `# 📊 Painel Individual de Metas`,
    `👤 **Responsavel:** <@${userId}> (${username})`,
    `🏷️ **Meta atual:** ${active?.name ?? "Nenhuma meta ativa"}`,
    `📅 **Criado:** <t:${Math.floor(Date.now() / 1000)}:d>`,
    `📈 **Progresso:** ${formatGoalValue(current)} / ${formatGoalValue(target)}`,
    `\`${"█".repeat(filled)}${"░".repeat(10 - filled)}\` **${percent}%**`,
    `🏆 **Ranking geral:** ${rank ? `#${rank}` : "Ainda sem posicao"}`,
    `🟢 **Status:** ${percent >= 100 ? "Meta concluida" : "Em andamento"}`
  ].join("\n");
  return {
    allowedMentions: { parse: [] as never[] },
    components: [{ type: 17, accent_color: percent >= 100 ? 0x22c55e : 0x3b82f6, components: [{ type: 10, content }] }, new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:user:add:${userId}`).setLabel("Adicionar Meta").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${PREFIX}:user:history:${userId}`).setLabel("Historico").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}:user:ranking:${userId}`).setLabel("Ranking").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}:user:refresh:${userId}`).setLabel("Atualizar").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PREFIX}:user:review:${userId}`).setLabel("Solicitar Revisao").setStyle(ButtonStyle.Secondary)
    )],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

async function refreshUserGoalPanel(context: BotContext, guildId: string, channelId: string, userId: string) {
  const channel = await context.client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased() || !("messages" in channel)) return;
  const messages = await channel.messages.fetch({ limit: 30 });
  const panel = messages.find((message) => message.author.id === context.client.user?.id && message.components.some((row) => JSON.stringify(row.toJSON()).includes(`${PREFIX}:user:refresh:${userId}`)));
  if (panel) await panel.edit(await createUserGoalPanel(context, guildId, userId, userId));
}

function formatGoalValue(value: number) { return new Intl.NumberFormat("pt-BR").format(Math.max(0, value)); }
function goalStatus(status: "pending" | "approved" | "refused") { return status === "approved" ? "Aprovado" : status === "refused" ? "Recusado" : "Pendente"; }

function createImageReviewPayload(userId: string, channelId: string, imageUrl: string, settings: FivemGoalSettings) {
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const configs = (settings.configs ?? []).filter((item) => item.status === "active");
  pendingImages.set(token, { channelId, expiresAt: Date.now() + 60 * 60 * 1000, imageUrl, metaId: configs.length === 1 ? configs[0]?.id ?? null : null, userId });
  cleanupPendingImages();

  return {
    allowedMentions: { parse: [] as never[] },
    components: [
      {
        type: 17,
        accent_color: 0x22c55e,
        components: [
          { type: 12, items: [{ media: { url: imageUrl }, description: "meta image" }] },
          { type: 10, content: `## Foto de meta enviada\nUsuario: <@${userId}>\nData: <t:${Math.floor(Date.now() / 1000)}:F>` }
        ]
      },
      ...(configs.length > 1 ? [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(`${PREFIX}:choose:${token}`).setPlaceholder("Selecione o tipo de meta").addOptions(configs.slice(0, 25).map((item) => ({ description: item.description?.slice(0, 100) || undefined, label: item.name.slice(0, 100), value: item.id })))
      )] : [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:register:${token}`).setLabel("Registrar Meta").setStyle(ButtonStyle.Success)
      )])
    ],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function isAllowedGoalImage(attachment: Attachment) {
  const contentType = attachment.contentType?.split(";")[0]?.toLowerCase() ?? "";
  return ALLOWED_IMAGE_TYPES.has(contentType) || ALLOWED_IMAGE_EXTENSIONS.test(attachment.url);
}

function cleanupPendingImages() {
  const now = Date.now();
  for (const [token, item] of pendingImages) {
    if (item.expiresAt < now) pendingImages.delete(token);
  }
}

function parseGoalNumericValue(value: string) {
  const normalized = value.trim().replace(/[^\d.,-]/g, "");
  if (!normalized || normalized === "-") return null;
  const negative = normalized.startsWith("-");
  const unsigned = normalized.replace(/-/g, "");
  const comma = unsigned.lastIndexOf(",");
  const dot = unsigned.lastIndexOf(".");
  let numeric: string;

  if (comma >= 0 && dot >= 0) {
    const decimalSeparator = comma > dot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    numeric = unsigned.split(thousandsSeparator).join("").replace(decimalSeparator, ".");
  } else if (/^\d{1,3}([.,]\d{3})+$/.test(unsigned)) {
    numeric = unsigned.replace(/[.,]/g, "");
  } else if (comma >= 0) {
    numeric = unsigned.replace(/\./g, "").replace(",", ".");
  } else {
    numeric = unsigned.replace(/,/g, "");
  }

  const parsed = Number(`${negative ? "-" : ""}${numeric}`);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function renderChannelName(template: string, username: string, userId: string) {
  return (template || "📈・{username}")
    .replace(/\{username\}/gi, username)
    .replace(/\{user\}/gi, username)
    .replace(/\{id\}/gi, userId)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .slice(0, 90);
}

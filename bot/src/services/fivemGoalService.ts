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
import { replaceSystemEmojis, systemComponentEmoji, systemEmojiText } from "./systemEmojiService";

const PREFIX = "fivem_goal";
const WEEKLY_RANKING_LIMIT = 10;
const REQUEST_CHANNEL_CUSTOM_ID = `${PREFIX}:request_channel`;
const FARM_ROOM_CLOSE_CUSTOM_ID_PREFIX = `${PREFIX}:room:close`;
const ALLOWED_IMAGE_EXTENSIONS = /\.(png|jpe?g|webp)(?:\?.*)?$/i;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const pendingImages = new Map<string, { channelId: string; expiresAt: number; imageUrl: string; metaId: string | null; userId: string }>();

export function startFivemGoalService(client: Client<true>, context: BotContext) {
  context.socket.onFivemGoalPanelPublish((payload) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void publishGoalRequestPanel(guild, context);
  });
  for (const guild of client.guilds.cache.values()) {
    void publishGoalRequestPanel(guild, context);
  }
}

export type FivemGoalSetIntegrationResult = {
  channelId: string | null;
  error: string | null;
  moved: boolean;
  previousCategoryId: string | null;
  targetCategoryId: string | null;
};

export async function ensureFivemGoalChannelForUser(context: BotContext, guild: Guild, userId: string, username: string, categoryId?: string | null, gameId?: string | null) {
  const result = await ensureFivemGoalChannelForApprovedSet(context, guild, userId, username, categoryId, false, gameId);
  return result.channelId;
}

export async function ensureFivemGoalChannelForApprovedSet(
  context: BotContext,
  guild: Guild,
  userId: string,
  username: string,
  categoryId?: string | null,
  requireConfiguredCategory = true,
  gameId?: string | null
): Promise<FivemGoalSetIntegrationResult> {
  const settings = await context.api.getFivemGoalSettings(guild.id).catch(() => null);
  if (!settings?.enabled) return goalSetIntegrationResult(null, null, null, false, "Sistema de metas desativado.");

  const targetCategoryId = categoryId ?? settings.categoryId ?? null;
  const categoryValidation = await validateGoalTargetCategory(guild, targetCategoryId, requireConfiguredCategory);
  if (!categoryValidation.ok) {
    return goalSetIntegrationResult(null, null, targetCategoryId, false, categoryValidation.error);
  }

  const existing = await context.api.getFivemGoalChannelByUser(guild.id, userId).catch(() => null);
  if (existing?.channelId) {
    const existingChannel = await guild.channels.fetch(existing.channelId).catch(() => null);
    if (existingChannel?.isTextBased() && !existingChannel.isDMBased() && "messages" in existingChannel) {
      const recent = await existingChannel.messages.fetch({ limit: 30 }).catch(() => null);
      const hasPanel = recent?.some((message) => message.author.id === guild.client.user.id && messageHasFarmRoomPanel(message, userId));
      if (!hasPanel) {
        const legacyPanel = recent?.find((message) => message.author.id === guild.client.user.id && messageHasLegacyGoalPanel(message, userId));
        if (legacyPanel) await legacyPanel.edit(createFarmRoomPanelPayload(guild, settings, userId)).catch(() => null);
        else await existingChannel.send(createFarmRoomPanelPayload(guild, settings, userId)).catch(() => null);
      }

      const previousCategoryId = "parentId" in existingChannel ? existingChannel.parentId ?? null : null;
      if (targetCategoryId && previousCategoryId !== targetCategoryId && "setParent" in existingChannel) {
        await existingChannel.setParent(targetCategoryId, { lockPermissions: false, reason: `Pedir Set aprovado para ${userId}` });
        return goalSetIntegrationResult(existing.channelId, previousCategoryId, targetCategoryId, true, null);
      }
      return goalSetIntegrationResult(existing.channelId, previousCategoryId, targetCategoryId, false, null);
    }
    return goalSetIntegrationResult(existing.channelId, null, targetCategoryId, false, "Canal de metas salvo não foi encontrado ou não é um canal de texto.");
  }

  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return goalSetIntegrationResult(null, null, targetCategoryId, false, "Bot sem permissão Gerenciar Canais.");
  }
  const member = await guild.members.fetch(userId).catch(() => null);
  const channelName = gameId?.trim() ? renderApprovedSetChannelName(username, gameId) : renderChannelName(settings.channelNameTemplate, username, userId);
  const channel = await guild.channels.create({
    name: channelName,
    parent: targetCategoryId ?? undefined,
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
  await channel.send(createFarmRoomPanelPayload(guild, settings, userId)).catch(() => null);

  return goalSetIntegrationResult(channel.id, null, targetCategoryId, Boolean(targetCategoryId), null);
}

function goalSetIntegrationResult(channelId: string | null, previousCategoryId: string | null, targetCategoryId: string | null, moved: boolean, error: string | null): FivemGoalSetIntegrationResult {
  return { channelId, error, moved, previousCategoryId, targetCategoryId };
}

async function validateGoalTargetCategory(guild: Guild, categoryId: string | null, required: boolean) {
  if (!categoryId) {
    return required
      ? { error: "Categoria de metas não configurada no painel administrativo.", ok: false as const }
      : { error: null, ok: true as const };
  }

  const category = await guild.channels.fetch(categoryId).catch(() => null);
  if (!category || category.type !== ChannelType.GuildCategory) {
    return { error: "Categoria de metas configurada não existe mais ou não é uma categoria.", ok: false as const };
  }

  const botMember = guild.members.me;
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels) || !category.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageChannels)) {
    return { error: "Bot sem permissão para mover canais para a categoria de metas configurada.", ok: false as const };
  }

  return { error: null, ok: true as const };
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

  if (interaction.isButton() && interaction.customId.startsWith(`${FARM_ROOM_CLOSE_CUSTOM_ID_PREFIX}:`)) {
    await closeFarmRoom(interaction, context);
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
    await interaction.editReply("O sistema de metas não está ativo neste servidor.");
    return;
  }
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const channelId = await ensureFivemGoalChannelForUser(context, interaction.guild, interaction.user.id, member?.displayName ?? interaction.user.username);
  if (!channelId) {
    await interaction.editReply("Não foi possível criar seu canal de meta. Avise a administracao para conferir categoria e permissões do bot.");
    return;
  }
  await interaction.editReply(`Seu canal individual de meta esta pronto: <#${channelId}>`);
}

async function closeFarmRoom(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild || !interaction.channelId) return;
  const room = await context.api.getFivemGoalChannelByChannel(interaction.channelId).catch(() => null);
  if (!room) {
    await interaction.reply({ content: "Esta sala de farm não está mais registrada no sistema.", ephemeral: true });
    return;
  }

  const settings = await context.api.getFivemGoalSettings(interaction.guild.id).catch(() => null);
  if (!(await canCloseFarmRoom(interaction, room.userId, settings))) {
    await interaction.reply({ content: "Você não possui permissão para fechar esta sala.", ephemeral: true });
    return;
  }

  await interaction.reply({ content: "Fechando esta sala de farm.", ephemeral: true });
  await context.api.deleteFivemGoalChannelByChannel(interaction.channelId).catch(() => null);
  const channel = interaction.channel;
  if (channel && channel.type === ChannelType.GuildText && channel.deletable) {
    setTimeout(() => void channel.delete(`Sala de farm fechada por ${interaction.user.tag}`).catch((error) => {
      void context.api.postLog({
        guildId: interaction.guild!.id,
        message: error instanceof Error ? error.message : "Não foi possível apagar a sala de farm.",
        metadata: { channelId: interaction.channelId },
        type: "fivem.goals.room_close_failed",
        userId: interaction.user.id
      }).catch(() => null);
    }), 1_000).unref();
  }
}

async function canCloseFarmRoom(interaction: ButtonInteraction, ownerId: string, settings: FivemGoalSettings | null) {
  if (!interaction.guild) return false;
  if (interaction.user.id === ownerId || interaction.guild.ownerId === interaction.user.id) return true;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageChannels)) return true;
  const managerRoleIds = new Set([settings?.managerRoleId].filter((value): value is string => Boolean(value)));
  return member.roles.cache.some((role) => managerRoleIds.has(role.id));
}

async function publishGoalRequestPanel(guild: Guild, context: BotContext) {
  const settings = await context.api.getFivemGoalSettings(guild.id);
  if (!settings.enabled || !settings.requestPanelEnabled || !settings.requestPanelChannelId) return;
  const channel = await guild.channels.fetch(settings.requestPanelChannelId).catch(() => null);
  if (!channel || !("send" in channel) || !("messages" in channel)) return;
  const payload = createGoalRequestPanelPayload(settings.requestPanelTitle, settings.requestPanelDescription);
  if (settings.requestPanelMessageId) {
    const message = await channel.messages.fetch(settings.requestPanelMessageId).catch(() => null);
    if (message) {
      await message.edit(payload).catch(() => null);
      return;
    }
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
          { type: 10, content: "Use o botão abaixo para criar ou localizar seu canal individual de meta." },
          { type: 14, divider: true, spacing: 1 },
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(REQUEST_CHANNEL_CUSTOM_ID).setEmoji(systemComponentEmoji("prancheta_acertos")).setLabel("Solicitar canal de meta").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`${PREFIX}:help`).setEmoji(systemComponentEmoji("interrogacao")).setLabel("Ajuda").setStyle(ButtonStyle.Secondary)
          )
        ]
      }
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
  if (!Number.isFinite(quantity) || !quantity || quantity <= 0) {
    await interaction.editReply("Informe uma quantidade válida maior que zero.");
    return;
  }

  await context.api.createFivemGoalEntry({
    channelId: interaction.channelId ?? "",
    fields,
    guildId: interaction.guild.id,
    imageUrl,
    metaId: activeConfig?.id ?? null,
    quantity,
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
  const channel = interaction.channel;
  if (channel?.isSendable()) {
    await channel.send(createFarmRegisteredPayload(interaction.user.id, imageUrl, fields, quantity, interaction.guild, settings)).catch(() => null);
  }
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
    await interaction.reply({ content: "Envie a imagem do comprovante neste canal. Assim que ela chegar, o bot mostrara o botão **Registrar Meta**.", ephemeral: true });
    return;
  }
  const runtime = await context.api.getFivemGoalUserRuntime(interaction.guild.id, ownerId);
  if (action === "history") {
    const configs = new Map(runtime.configs.map((item) => [item.id, item.name]));
    const lines = runtime.submissions.slice(0, 20).map((item) => `• **${configs.get(item.metaId) ?? "Meta"}** — ${formatGoalValue(item.value)} — ${goalStatus(item.status)} — <t:${Math.floor(Date.parse(item.createdAt) / 1000)}:d>`);
    await interaction.reply(lines.length ? { content: lines.join("\n"), ephemeral: true } : noRecordsPayload(ownerId, interaction.guild));
    return;
  }
  if (action === "ranking") {
    const lines = runtime.ranking.slice(0, WEEKLY_RANKING_LIMIT).map((item) => `${rankEmoji(item.rank, interaction.guild)} <@${item.userId}> — ${formatGoalValue(item.total)}`);
    await interaction.reply({ content: `## Ranking de Metas\n${lines.join("\n") || "Ainda não existem valores aprovados."}`, ephemeral: true });
    return;
  }
  if (action === "review") {
    await context.api.postLog({ guildId: interaction.guild.id, message: "Revisao de meta solicitada pelo membro.", metadata: { channelId: interaction.channelId }, type: "fivem.goals.review_requested", userId: ownerId }).catch(() => null);
    await interaction.reply({ content: "Revisao solicitada. A equipe responsável foi registrada nos logs.", ephemeral: true });
    return;
  }
  if (action === "refresh") {
    const settings = await context.api.getFivemGoalSettings(interaction.guild.id).catch(() => null);
    await interaction.update(createFarmRoomPanelPayload(interaction.guild, settings, ownerId));
  }
}

export function createFarmRoomPanelPayload(guild: Guild | null, settings: Pick<FivemGoalSettings, "managerRoleId"> | null, userId: string) {
  const managerMention = settings?.managerRoleId ? `<@&${settings.managerRoleId}>` : "Gerente de Farm";
  const iconUrl = guild?.iconURL({ size: 256 }) ?? null;
  return {
    allowedMentions: { parse: [] as never[] },
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          iconUrl ? {
            type: 9,
            components: [{
              type: 10,
              content: [
                `# ${systemEmojiText("VORTEXtrabalho", guild)} SALA DE FARM`,
                "",
                `${systemEmojiText("interrogacao", guild)} Sala criada para organizar o registro do farm.`,
                "",
                `- Para dúvidas, contate ${managerMention}.`,
                "- Ao concluir, peça o fechamento quando necessário."
              ].join("\n")
            }],
            accessory: { type: 11, media: { url: iconUrl } }
          } : {
            type: 10,
            content: [
              `# ${systemEmojiText("VORTEXtrabalho", guild)} SALA DE FARM`,
              "",
              `${systemEmojiText("interrogacao", guild)} Sala criada para organizar o registro do farm.`,
              "",
              `- Para dúvidas, contate ${managerMention}.`,
              "- Ao concluir, peça o fechamento quando necessário."
            ].join("\n")
          },
          { type: 14, divider: false, spacing: 1 },
          {
            type: 10,
            content: `### ${systemEmojiText("porta", guild)} Fechar sala\nSolicita o fechamento da sala.`
          },
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`${FARM_ROOM_CLOSE_CUSTOM_ID_PREFIX}:${userId}`)
              .setEmoji(systemComponentEmoji("porta", guild))
              .setLabel("Fechar Canal")
              .setStyle(ButtonStyle.Danger)
          ),
          { type: 14, divider: true, spacing: 1 },
          { type: 10, content: "-# BalaCloud - Todos os direitos reservados" }
        ]
      }
    ],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function messageHasFarmRoomPanel(message: Message, userId: string) {
  return JSON.stringify(message.components.map((component) => component.toJSON())).includes(`${FARM_ROOM_CLOSE_CUSTOM_ID_PREFIX}:${userId}`);
}

function messageHasLegacyGoalPanel(message: Message, userId: string) {
  return JSON.stringify(message.components.map((component) => component.toJSON())).includes(`${PREFIX}:user:refresh:${userId}`);
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
          { type: 10, content: replaceSystemEmojis(`## ${systemEmojiText("prancheta_acertos")} Registrar Meta\n${systemEmojiText("homem")} Usuário: <@${userId}>\n${systemEmojiText("calendario")} Data: <t:${Math.floor(Date.now() / 1000)}:F>\n\nSelecione abaixo qual item está sendo registrado com esta imagem.`, null) },
          { type: 14, divider: true, spacing: 1 },
          ...(configs.length > 1 ? [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId(`${PREFIX}:choose:${token}`).setPlaceholder("Selecione o tipo de meta").addOptions(configs.slice(0, 25).map((item) => ({ description: item.description?.slice(0, 100) || undefined, label: item.name.slice(0, 100), value: item.id })))
          )] : [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`${PREFIX}:register:${token}`).setEmoji(systemComponentEmoji("prancheta_acertos")).setLabel("Registrar Meta").setStyle(ButtonStyle.Success)
          )])
        ]
      }
    ],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function createFarmRegisteredPayload(userId: string, imageUrl: string, fields: Array<{ id: string; label: string; value: string }>, quantity: number, guild: Guild, settings: FivemGoalSettings) {
  const itemLabel = fields.find((field) => /item|tipo|meta/i.test(`${field.id} ${field.label}`))?.value?.trim() || "Farm";
  return {
    allowedMentions: { parse: [] as never[], users: [userId] },
    components: [{
      type: 17,
      accent_color: 0x22c55e,
      components: [
        {
          type: 9,
          components: [{
            type: 10,
            content: [
              `## ${systemEmojiText("visto", guild)} Farm registrado`,
              "",
              `${systemEmojiText("homem", guild)} **Usuário:** <@${userId}> | ${userId}`,
              "",
              `${systemEmojiText("prancheta", guild)} **Resumo**`,
              `- ${systemEmojiText("caixa", guild)} ${itemLabel}: ${formatGoalValue(quantity)}`,
              "",
              `**Status:** ${systemEmojiText("visto", guild)} Registrado`,
              `${systemEmojiText("relogio", guild)} Data: ${formatBrazilDateTime(new Date())}`
            ].join("\n")
          }],
          accessory: { type: 11, media: { url: imageUrl } }
        },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: "-# *BalaCloud - Todos os direitos reservados*" }
      ]
    }],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function noRecordsPayload(userId: string, guild: Guild | null) {
  return {
    allowedMentions: { parse: [] as never[], users: [userId] },
    components: [{
      type: 17,
      accent_color: 0x9ca3af,
      components: [
        { type: 10, content: [`## ${systemEmojiText("perigo", guild)} Sem registros`, "", `${systemEmojiText("homem", guild)} <@${userId}> não possui registros de farm no momento.`].join("\n") },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: "-# *BalaCloud - Todos os direitos reservados*" }
      ]
    }],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 as const
  };
}

function rankEmoji(rank: number, guild: Guild | null) {
  if (rank <= 3) return systemEmojiText(rank === 1 ? "trofeu" : "trofeu_alt", guild);
  return `**${rank}.**`;
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
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function renderChannelName(template: string, username: string, userId: string) {
  return (template || "meta-{username}")
    .replace(/\{username\}/gi, username)
    .replace(/\{user\}/gi, username)
    .replace(/\{id\}/gi, userId)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .slice(0, 90);
}

function formatBrazilDateTime(value: Date) {
  return value.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" });
}

export function renderApprovedSetChannelName(username: string, gameId: string) {
  return `📕┋${username} | ${gameId}`
    .toLowerCase()
    .replace(/\s+/g, "-")
    .slice(0, 90);
}

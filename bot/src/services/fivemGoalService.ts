import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type Attachment,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type Interaction,
  type Message,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction
} from "discord.js";
import type { BotContext } from "../types";
import type { BotCommand } from "../types";
import type { FivemGoalCorrectionRequest, FivemGoalEntry, FivemGoalSettings } from "./apiClient";
import { replaceSystemEmojis, systemComponentEmoji, systemEmojiText } from "./systemEmojiService";

const PREFIX = "fivem_goal";
const WEEKLY_RANKING_LIMIT = 10;
const REQUEST_CHANNEL_CUSTOM_ID = `${PREFIX}:request_channel`;
const FARM_ROOM_CLOSE_CUSTOM_ID_PREFIX = `${PREFIX}:room:close`;
const EDIT_USER_SELECT_CUSTOM_ID = `${PREFIX}:edit:user`;
const EDIT_RECORD_SELECT_CUSTOM_ID_PREFIX = `${PREFIX}:edit:record`;
const EDIT_REASON_MODAL_PREFIX = `${PREFIX}:edit:reason`;
const EDIT_CONFIRM_PREFIX = `${PREFIX}:edit:confirm`;
const ALLOWED_IMAGE_EXTENSIONS = /\.(png|jpe?g|webp)(?:\?.*)?$/i;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const pendingImages = new Map<string, { attachmentId: string; channelId: string; correctionRequestId: string | null; expiresAt: number; imageUrl: string; metaId: string | null; replacementForRegistrationId: string | null; sourceMessageId: string; userId: string }>();
const pendingConfirmations = new Map<string, { attachmentId: string; channelId: string; correctionRequestId: string | null; expiresAt: number; fields: Array<{ id: string; label: string; value: string }>; imageUrl: string; metaId: string | null; quantity: number; replacementForRegistrationId: string | null; sourceMessageId: string; userId: string }>();
const pendingEditSelections = new Map<string, { entries: FivemGoalEntry[]; expiresAt: number; guildId: string; managerId: string; targetUserId: string }>();
const pendingEditConfirmations = new Map<string, { entry: FivemGoalEntry; expiresAt: number; guildId: string; managerId: string; managerName: string; reason: string; targetUserId: string }>();

export const editarMetaCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("editar-meta").setDescription("Solicita que um usuário refaça um registro de meta confirmado."),
  moduleId: "fivem-goals",
  async execute(interaction, context) {
    await showEditMetaPanel(interaction, context);
  }
};

export const cancelarEdicaoMetaCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("cancelar-edicao-meta")
    .setDescription("Cancela uma solicitação pendente de correção de meta.")
    .addStringOption((option) => option.setName("registro").setDescription("ID interno do registro original.").setRequired(true))
    .addStringOption((option) => option.setName("motivo").setDescription("Motivo do cancelamento.").setMinLength(8).setMaxLength(1000).setRequired(true))
    .addBooleanOption((option) => option.setName("restaurar").setDescription("Restaurar o valor original na contagem?").setRequired(true)),
  moduleId: "fivem-goals",
  async execute(interaction, context) {
    await cancelEditMeta(interaction, context);
  }
};

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
        try {
          if (legacyPanel) await legacyPanel.edit(createFarmRoomPanelPayload(guild, settings, userId));
          else await existingChannel.send(createFarmRoomPanelPayload(guild, settings, userId));
        } catch (error) {
          return goalSetIntegrationResult(existing.channelId, null, targetCategoryId, false, error instanceof Error ? `Não foi possível publicar o painel da Sala de Farm: ${error.message}` : "Não foi possível publicar o painel da Sala de Farm.");
        }
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

  const permissionValidation = validateGoalBotPermissions(guild, targetCategoryId);
  if (!permissionValidation.ok) {
    return goalSetIntegrationResult(null, null, targetCategoryId, false, permissionValidation.error);
  }
  const botMember = guild.members.me;
  if (!botMember) {
    return goalSetIntegrationResult(null, null, targetCategoryId, false, "Bot não encontrado como membro do servidor.");
  }
  const member = await guild.members.fetch(userId).catch(() => null);
  const channelName = gameId?.trim() ? renderApprovedSetChannelName(username, gameId) : renderChannelName(settings.channelNameTemplate, username, userId);
  const viewerRoleIds = uniqueRoleIds([...(settings.viewerRoleIds ?? []), settings.viewRoleId]);
  const managerRoleIds = uniqueRoleIds([...(settings.managerRoleIds ?? []), settings.managerRoleId]);
  const channel = await guild.channels.create({
    name: channelName,
    parent: targetCategoryId ?? undefined,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
      ...viewerRoleIds.map((roleId) => ({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] })),
      ...managerRoleIds.map((roleId) => ({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory] })),
      { id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] }
    ],
    reason: `Canal de metas FiveM para ${userId}`,
    type: ChannelType.GuildText
  });

  try {
    await channel.send(createFarmRoomPanelPayload(guild, settings, userId));
    await context.api.saveFivemGoalChannel({ channelId: channel.id, guildId: guild.id, userId });
  } catch (error) {
    await channel.delete("Falha ao publicar painel da Sala de Farm").catch(() => null);
    return goalSetIntegrationResult(null, null, targetCategoryId, false, error instanceof Error ? `Não foi possível concluir a Sala de Farm: ${error.message}` : "Não foi possível concluir a Sala de Farm.");
  }

  return goalSetIntegrationResult(channel.id, null, targetCategoryId, Boolean(targetCategoryId), null);
}

function goalSetIntegrationResult(channelId: string | null, previousCategoryId: string | null, targetCategoryId: string | null, moved: boolean, error: string | null): FivemGoalSetIntegrationResult {
  return { channelId, error, moved, previousCategoryId, targetCategoryId };
}

function validateGoalBotPermissions(guild: Guild, categoryId: string | null) {
  const botMember = guild.members.me;
  if (!botMember) {
    return { error: "Bot não encontrado como membro do servidor.", ok: false as const };
  }
  const required = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.UseApplicationCommands
  ];
  const missing = required.filter((permission) => !botMember.permissions.has(permission));
  const category = categoryId ? guild.channels.cache.get(categoryId) : null;
  const categoryMissing = category && "permissionsFor" in category
    ? required.filter((permission) => !category.permissionsFor(botMember)?.has(permission))
    : [];
  const allMissing = [...new Set([...missing, ...categoryMissing].map(goalPermissionName))];
  return allMissing.length
    ? { error: `Bot sem permissões obrigatórias para metas: ${allMissing.join(", ")}.`, ok: false as const }
    : { error: null, ok: true as const };
}

function goalPermissionName(permission: bigint) {
  const names = new Map<bigint, string>([
    [PermissionFlagsBits.ViewChannel, "Ver Canal"],
    [PermissionFlagsBits.ManageChannels, "Gerenciar Canais"],
    [PermissionFlagsBits.ManageRoles, "Gerenciar Cargos"],
    [PermissionFlagsBits.SendMessages, "Enviar Mensagens"],
    [PermissionFlagsBits.EmbedLinks, "Inserir Links"],
    [PermissionFlagsBits.AttachFiles, "Anexar Arquivos"],
    [PermissionFlagsBits.ReadMessageHistory, "Ver Histórico de Mensagens"],
    [PermissionFlagsBits.UseApplicationCommands, "Usar Comandos de Aplicativo"]
  ]);
  return names.get(permission) ?? permission.toString();
}

function uniqueRoleIds(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function goalFieldsForModal(fields: FivemGoalSettings["fields"]) {
  const configured = fields.slice(0, 5);
  return configured.length ? configured : [{
    id: "quantidade",
    label: "Quantidade",
    maxLength: 80,
    minLength: 1,
    placeholder: "Ex: 50000",
    required: true,
    style: "short" as const
  }];
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

  const pendingCorrections = await context.api.getPendingFivemGoalCorrections(message.guild.id, message.author.id, message.channel.id).catch(() => []);
  await message.reply(createImageReviewPayload(message.author.id, message.channel.id, message.id, image.id, image.url, settings, pendingCorrections));
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

  if (interaction.isButton() && isScopedCustomId(interaction.customId, REQUEST_CHANNEL_CUSTOM_ID, interaction.guildId)) {
    await handleGoalChannelRequest(interaction, context);
    return true;
  }

  if (interaction.isButton() && isScopedCustomId(interaction.customId, `${PREFIX}:help`, interaction.guildId)) {
    await interaction.reply({ content: "Clique em Solicitar canal de meta. Depois envie suas fotos apenas no seu canal individual para registrar comprovantes.", ephemeral: true });
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(`${FARM_ROOM_CLOSE_CUSTOM_ID_PREFIX}:`)) {
    await closeFarmRoom(interaction, context);
    return true;
  }

  if (interaction.isUserSelectMenu() && interaction.customId === EDIT_USER_SELECT_CUSTOM_ID) {
    await handleEditMetaUserSelection(interaction, context);
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(`${EDIT_RECORD_SELECT_CUSTOM_ID_PREFIX}:`)) {
    await handleEditMetaRecordSelection(interaction);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith(`${EDIT_REASON_MODAL_PREFIX}:`)) {
    await handleEditMetaReason(interaction);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(`${EDIT_CONFIRM_PREFIX}:`)) {
    await handleEditMetaConfirmation(interaction, context);
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

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(`${PREFIX}:correct:`)) {
    const token = interaction.customId.split(":")[2] ?? "";
    const pending = pendingImages.get(token);
    const requestId = interaction.values[0] ?? null;
    if (pending) {
      const correction = await context.api.getPendingFivemGoalCorrections(interaction.guildId ?? "", interaction.user.id, interaction.channelId).then((items) => items.find((item) => item.id === requestId)).catch(() => null);
      pending.correctionRequestId = correction?.id ?? null;
      pending.replacementForRegistrationId = correction?.originalRegistrationId ?? null;
      pending.metaId = correction?.originalRegistration?.metaId ?? pending.metaId;
    }
    await showGoalModal(interaction, context);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith(`${PREFIX}:modal:`)) {
    await submitGoalModal(interaction, context);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:confirm:`)) {
    await confirmGoalRegistration(interaction, context);
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

async function showEditMetaPanel(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const settings = await context.api.getFivemGoalSettings(interaction.guild.id).catch(() => null);
  if (!settings?.enabled || !(await canUseGoalCorrectionCommand(interaction, settings))) {
    await interaction.reply({
      content: "❌ Acesso negado\n\nSomente os gerentes de metas autorizados podem utilizar este comando.",
      ephemeral: true
    });
    return;
  }

  await interaction.reply({
    allowedMentions: { parse: [] },
    components: [{
      type: 17,
      accent_color: 0xf59e0b,
      components: [
        { type: 10, content: "## 📝 Editar registro de meta\n\nUtilize esta função somente quando for necessário solicitar que um usuário refaça um registro já confirmado." },
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
          new UserSelectMenuBuilder().setCustomId(EDIT_USER_SELECT_CUSTOM_ID).setPlaceholder("Selecionar usuário").setMinValues(1).setMaxValues(1)
        ),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${EDIT_CONFIRM_PREFIX}:cancel`).setLabel("Cancelar").setStyle(ButtonStyle.Secondary)
        )
      ]
    }],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  });
}

async function cancelEditMeta(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const settings = await context.api.getFivemGoalSettings(interaction.guild.id).catch(() => null);
  if (!settings?.enabled || !(await canUseGoalCorrectionCommand(interaction, settings))) {
    await interaction.reply({
      content: "❌ Acesso negado\n\nSomente os gerentes de metas autorizados podem utilizar este comando.",
      ephemeral: true
    });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const originalRegistrationId = interaction.options.getString("registro", true).trim();
  const cancellationReason = interaction.options.getString("motivo", true).trim();
  const restoreOriginalOnCancel = interaction.options.getBoolean("restaurar", true);
  const correction = await context.api.cancelFivemGoalCorrection(interaction.guild.id, {
    cancelledByUserId: interaction.user.id,
    cancellationReason,
    originalRegistrationId,
    restoreOriginalOnCancel
  }).catch((error) => ({ error }));
  if ("error" in correction) {
    await interaction.editReply(readApiError(correction.error, "Não foi possível cancelar essa correção."));
    return;
  }
  await interaction.editReply("Solicitação de correção cancelada.");
  const room = await interaction.guild.channels.fetch(correction.roomId).catch(() => null);
  if (room?.isSendable()) {
    await room.send({ content: "ℹ️ Solicitação de correção cancelada\n\nA solicitação para refazer sua meta foi cancelada pelo gerente.", allowedMentions: { parse: [] } }).catch(() => null);
  }
  await sendGoalLog(interaction.guild, context, `ℹ️ Correção de meta cancelada\n\nCancelado por: <@${interaction.user.id}> | ${interaction.user.id}\nUsuário: <@${correction.userId}> | ${correction.userId}\nRegistro original: ${correction.originalRegistrationId}\nMotivo: ${cancellationReason}\nValor original restaurado: ${restoreOriginalOnCancel ? "sim" : "não"}\nData: ${formatBrazilDateTime(new Date())}\nEstado final: cancelled`, correction);
}

async function canUseGoalCorrectionCommand(interaction: ChatInputCommandInteraction | ButtonInteraction | UserSelectMenuInteraction, settings: FivemGoalSettings) {
  if (!interaction.guild) return false;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return false;
  const managerRoleIds = new Set([
    settings.correctionManagement?.managerRoleId,
    settings.managerRoleId,
    ...(settings.managerRoleIds ?? [])
  ].filter((value): value is string => Boolean(value)));
  if (managerRoleIds.size && member.roles.cache.some((role) => managerRoleIds.has(role.id))) return true;
  return settings.correctionManagement?.allowAdministrators === true && member.permissions.has(PermissionFlagsBits.Administrator);
}

async function handleEditMetaUserSelection(interaction: UserSelectMenuInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferUpdate();
  const settings = await context.api.getFivemGoalSettings(interaction.guild.id).catch(() => null);
  if (!settings || !(await canUseGoalCorrectionCommand(interaction, settings))) {
    await interaction.followUp({ content: "❌ Acesso negado\n\nSomente os gerentes de metas autorizados podem utilizar este comando.", ephemeral: true });
    return;
  }
  const targetUserId = interaction.values[0];
  if (!targetUserId) {
    await interaction.followUp({ content: "Selecione um usuário válido.", ephemeral: true });
    return;
  }
  const entries = await context.api.getFivemGoalCorrectionCandidates(interaction.guild.id, targetUserId).catch(() => []);
  if (!entries.length) {
    await interaction.editReply(noCorrectionRecordsPayload(targetUserId, interaction.guild));
    return;
  }
  const token = createToken();
  pendingEditSelections.set(token, { entries, expiresAt: Date.now() + 10 * 60 * 1000, guildId: interaction.guild.id, managerId: interaction.user.id, targetUserId });
  await interaction.editReply(createCorrectionRecordSelectPayload(token, targetUserId, entries, settings));
}

async function handleEditMetaRecordSelection(interaction: StringSelectMenuInteraction) {
  const token = interaction.customId.split(":")[3] ?? "";
  const pending = pendingEditSelections.get(token);
  if (!pending || pending.expiresAt < Date.now() || pending.managerId !== interaction.user.id) {
    pendingEditSelections.delete(token);
    await interaction.reply({ content: "Essa seleção expirou. Execute /editar-meta novamente.", ephemeral: true });
    return;
  }
  const entry = pending.entries.find((item) => item.id === interaction.values[0]);
  if (!entry) {
    await interaction.reply({ content: "Registro inválido para esta seleção.", ephemeral: true });
    return;
  }
  const modal = new ModalBuilder()
    .setCustomId(`${EDIT_REASON_MODAL_PREFIX}:${token}:${entry.id}`)
    .setTitle("Motivo da solicitação");
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId("reason")
      .setLabel("Motivo da solicitação")
      .setPlaceholder("Ex: Imagem incorreta, comprovante ilegível...")
      .setMinLength(8)
      .setMaxLength(1000)
      .setRequired(true)
      .setStyle(TextInputStyle.Paragraph)
  ));
  await interaction.showModal(modal);
}

async function handleEditMetaReason(interaction: ModalSubmitInteraction) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const [, , , token, entryId] = interaction.customId.split(":");
  const pending = pendingEditSelections.get(token ?? "");
  const reason = interaction.fields.getTextInputValue("reason").trim();
  if (!pending || pending.expiresAt < Date.now() || pending.managerId !== interaction.user.id || pending.guildId !== interaction.guild.id) {
    pendingEditSelections.delete(token ?? "");
    await interaction.editReply("Essa seleção expirou. Execute /editar-meta novamente.");
    return;
  }
  if (reason.length < 8) {
    await interaction.editReply("O motivo da correção deve ter pelo menos 8 caracteres.");
    return;
  }
  const entry = pending.entries.find((item) => item.id === entryId);
  if (!entry) {
    await interaction.editReply("Registro inválido para esta seleção.");
    return;
  }
  const confirmToken = createToken();
  pendingEditConfirmations.set(confirmToken, { entry, expiresAt: Date.now() + 10 * 60 * 1000, guildId: pending.guildId, managerId: interaction.user.id, managerName: interaction.user.tag, reason, targetUserId: pending.targetUserId });
  pendingEditSelections.delete(token ?? "");
  await interaction.editReply(createCorrectionConfirmPayload(confirmToken, pending.targetUserId, entry, reason, interaction.guild));
}

async function handleEditMetaConfirmation(interaction: ButtonInteraction, context: BotContext) {
  if (interaction.customId === `${EDIT_CONFIRM_PREFIX}:cancel`) {
    await interaction.update({ content: "Operação cancelada.", components: [] });
    return;
  }
  if (!interaction.guild) return;
  const [, , , action, token] = interaction.customId.split(":");
  const pending = pendingEditConfirmations.get(token ?? "");
  if (!pending || pending.expiresAt < Date.now() || pending.managerId !== interaction.user.id || pending.guildId !== interaction.guild.id) {
    pendingEditConfirmations.delete(token ?? "");
    await interaction.reply({ content: "Essa confirmação expirou. Execute /editar-meta novamente.", ephemeral: true });
    return;
  }
  if (action === "back") {
    pendingEditConfirmations.delete(token ?? "");
    await interaction.update({ content: "Volte executando /editar-meta novamente para selecionar outro registro.", components: [] });
    return;
  }
  if (action !== "apply") return;
  await interaction.deferUpdate();
  const correction = await context.api.requestFivemGoalCorrection(interaction.guild.id, {
    originalRegistrationId: pending.entry.id,
    reason: pending.reason,
    requestedByName: pending.managerName,
    requestedByUserId: interaction.user.id
  }).catch((error) => ({ error }));
  if ("error" in correction) {
    await interaction.followUp({ content: readApiError(correction.error, "Não foi possível abrir a correção para este registro."), ephemeral: true });
    return;
  }
  pendingEditConfirmations.delete(token ?? "");
  await interaction.editReply({ content: "Solicitação de correção aberta.", components: [] });
  const room = await interaction.guild.channels.fetch(correction.roomId).catch(() => null);
  if (room?.isSendable()) {
    await room.send(createCorrectionRequestedPayload(correction, pending.entry, interaction.user.id, interaction.guild)).catch(() => null);
  }
  await sendGoalLog(interaction.guild, context, `📝 Correção de meta solicitada\n\nGerente: <@${interaction.user.id}> | ${interaction.user.id}\nUsuário: <@${correction.userId}> | ${correction.userId}\nItem: ${entryLabel(pending.entry)}\nQuantidade original: ${formatGoalValue(pending.entry.quantity ?? 0)}\nRegistro original: ${pending.entry.id}\nMotivo: ${pending.reason}\nData: ${formatBrazilDateTime(new Date())}`, correction);
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
  const managerRoleIds = new Set([settings?.managerRoleId, ...(settings?.managerRoleIds ?? [])].filter((value): value is string => Boolean(value)));
  return member.roles.cache.some((role) => managerRoleIds.has(role.id));
}

async function publishGoalRequestPanel(guild: Guild, context: BotContext) {
  let settings: FivemGoalSettings | null = null;
  try {
    settings = await context.api.getFivemGoalSettings(guild.id);
    await logGoalPanelPublish(context, guild.id, settings, "start", "Iniciando publicação do painel de solicitação de sala de meta.");

    if (!settings.enabled) throw new Error("Sistema de metas desativado na dashboard.");
    if (!settings.requestPanelEnabled) throw new Error("Painel de solicitação de sala de meta desativado na dashboard.");
    if (!settings.requestPanelChannelId) throw new Error("Canal do painel de solicitação de meta não configurado.");

    const channel = await guild.channels.fetch(settings.requestPanelChannelId);
    if (!channel) throw new Error(`Canal configurado não encontrado: ${settings.requestPanelChannelId}.`);
    if ("guildId" in channel && channel.guildId !== guild.id) {
      throw new Error(`Canal configurado pertence a outro servidor: ${channel.guildId}.`);
    }
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
      throw new Error(`Canal configurado não é canal de texto/anúncio: tipo ${channel.type}.`);
    }
    if (!("send" in channel) || !("messages" in channel) || !channel.isSendable()) {
      throw new Error("Canal configurado não aceita envio de mensagens pelo bot.");
    }

    const botMember = guild.members.me;
    if (!botMember) throw new Error("Bot não encontrado como membro do servidor.");
    const requiredPermissions = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.UseApplicationCommands
    ];
    const permissions = channel.permissionsFor(botMember);
    const missingPermissions = requiredPermissions.filter((permission) => !permissions?.has(permission)).map(goalPermissionName);
    if (missingPermissions.length) {
      throw new Error(`Bot sem permissões no canal <#${channel.id}>: ${missingPermissions.join(", ")}.`);
    }

    const payload = createGoalRequestPanelPayload(settings.requestPanelTitle, settings.requestPanelDescription, guild.id, settings.botId, guild);
    if (settings.requestPanelMessageId) {
      const message = await channel.messages.fetch(settings.requestPanelMessageId).catch(() => null);
      if (message) {
        const edited = await message.edit(payload);
        await context.api.updateFivemGoalPanelState({ channelId: channel.id, guildId: guild.id, messageId: edited.id });
        await logGoalPanelPublish(context, guild.id, settings, "updated", "Painel de solicitação de sala de meta atualizado no Discord.", { channelId: channel.id, messageId: edited.id });
        return;
      }
      await logGoalPanelPublish(context, guild.id, settings, "old_message_missing", "Mensagem antiga do painel não encontrada; publicando uma nova.", { channelId: channel.id, messageId: settings.requestPanelMessageId });
    }

    const message = await channel.send(payload);
    await context.api.updateFivemGoalPanelState({ channelId: channel.id, guildId: guild.id, messageId: message.id });
    await logGoalPanelPublish(context, guild.id, settings, "sent", "Painel de solicitação de sala de meta publicado no Discord.", { channelId: channel.id, messageId: message.id });
  } catch (error) {
    await logGoalPanelPublish(context, guild.id, settings, "error", readUnknownError(error), {}, error);
  }
}

export function createGoalRequestPanelPayload(_title: string, _description: string, guildId?: string | null, botId?: string | null, guild?: Guild | null) {
  const requestCustomId = scopedCustomId(REQUEST_CHANNEL_CUSTOM_ID, guildId, botId);
  const iconUrl = guild?.iconURL({ size: 256 }) ?? null;
  const mainContent = [
    `# ${systemEmojiText("VORTEXtrabalho", guild)} CRIAR SALA DE FARM`,
    "",
    "**Bem-vindo(a) ao Sistema de Farm!**",
    "",
    "Clique no botão abaixo para criar sua sala privada automaticamente.",
    "",
    "• Apenas você terá acesso à sua sala",
    "• Use com organização",
    "• Para dúvidas, chame a gerência"
  ].join("\n");
  return {
    allowedMentions: { parse: [] as never[] },
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          iconUrl ? {
            type: 9,
            components: [{ type: 10, content: mainContent }],
            accessory: { type: 11, media: { url: iconUrl } }
          } : { type: 10, content: mainContent },
          { type: 14, divider: true, spacing: 1 },
          { type: 10, content: "### Criar sala de farm\nCria automaticamente uma sala privada para registrar seu farm." },
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(requestCustomId).setLabel("Solicitar Sala de Farm").setStyle(ButtonStyle.Secondary)
          ),
          { type: 14, divider: true, spacing: 1 },
          { type: 10, content: "-# *NexTech - Todos os direitos reservados*" }
        ]
      }
    ],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function scopedCustomId(base: string, guildId?: string | null, botId?: string | null) {
  return guildId ? `${base}:${guildId}:${encodeURIComponent(botId ?? "default")}` : base;
}

function isScopedCustomId(customId: string, base: string, guildId?: string | null) {
  if (customId === base) return true;
  const prefix = `${base}:`;
  if (!customId.startsWith(prefix)) return false;
  const [, scopedGuildId] = customId.slice(prefix.length).match(/^([^:]+)/) ?? [];
  return Boolean(scopedGuildId && guildId && scopedGuildId === guildId);
}

async function logGoalPanelPublish(
  context: BotContext,
  guildId: string,
  settings: FivemGoalSettings | null,
  stage: string,
  message: string,
  metadata: Record<string, unknown> = {},
  error?: unknown
) {
  await context.api.postLog({
    guildId,
    message,
    metadata: {
      marker: stage === "error" ? "[FARM_PANEL_PUBLISH_ERROR]" : "[FARM_PANEL_PUBLISH_START]",
      botId: settings?.botId ?? null,
      channelId: settings?.requestPanelChannelId ?? null,
      messageId: settings?.requestPanelMessageId ?? null,
      requestPanelEnabled: settings?.requestPanelEnabled ?? null,
      stage,
      ...metadata,
      ...(error instanceof Error ? { errorName: error.name, errorMessage: error.message, errorStack: error.stack?.slice(0, 1500) } : {})
    },
    type: stage === "error" ? "fivem.goals.request_panel_publish_failed" : "fivem.goals.request_panel_publish",
    userId: null
  }).catch(() => null);
}

function readUnknownError(error: unknown) {
  return error instanceof Error ? error.message : "Falha desconhecida ao publicar o painel de solicitação de sala de meta.";
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
  const fieldsToRender = goalFieldsForModal(activeConfig?.fields?.length ? activeConfig.fields : settings.fields);
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:${encodeURIComponent(imageToken ?? "")}`)
    .setTitle((activeConfig?.name ?? "Registrar Farm").slice(0, 45));

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
  const fieldsToRead = goalFieldsForModal(activeConfig?.fields?.length ? activeConfig.fields : settings.fields);
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

  const confirmationToken = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  pendingConfirmations.set(confirmationToken, {
    attachmentId: pending.attachmentId,
    channelId: pending.channelId,
    correctionRequestId: pending.correctionRequestId,
    expiresAt: Date.now() + 10 * 60 * 1000,
    fields,
    imageUrl,
    metaId: activeConfig?.id ?? null,
    quantity,
    replacementForRegistrationId: pending.replacementForRegistrationId,
    sourceMessageId: pending.sourceMessageId,
    userId: interaction.user.id
  });
  pendingImages.delete(token);
  cleanupPendingImages();

  await interaction.editReply(createGoalConfirmationPayload(confirmationToken, interaction.user.id, imageUrl, fields, quantity, interaction.guild));
}

async function confirmGoalRegistration(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferUpdate();
  const token = interaction.customId.split(":")[2] ?? "";
  const pending = pendingConfirmations.get(token);

  if (!pending || pending.expiresAt < Date.now()) {
    pendingConfirmations.delete(token);
    await interaction.followUp({ content: "Essa confirmação expirou. Envie a imagem novamente no seu canal de meta.", ephemeral: true });
    return;
  }

  if (pending.userId !== interaction.user.id || pending.channelId !== interaction.channelId) {
    await interaction.followUp({ content: "Somente o dono do canal de meta pode confirmar esse registro.", ephemeral: true });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const saved = await context.api.createFivemGoalEntry({
    attachmentId: pending.attachmentId,
    channelId: interaction.channelId ?? "",
    fields: pending.fields,
    guildId: interaction.guild.id,
    imageUrl: pending.imageUrl,
    metaId: pending.metaId,
    quantity: pending.quantity,
    correctionRequestId: pending.correctionRequestId,
    replacementForRegistrationId: pending.replacementForRegistrationId,
    roleIdsSnapshot: member ? [...member.roles.cache.keys()] : [],
    sourceMessageId: pending.sourceMessageId,
    userId: interaction.user.id
  }).catch((error) => ({ error }));
  if ("error" in saved) {
    await interaction.followUp({ content: "Não foi possível registrar essa meta. Confira se essa imagem já foi usada.", ephemeral: true });
    return;
  }

  pendingConfirmations.delete(token);
  await context.api.postLog({
    guildId: interaction.guild.id,
    message: "Meta confirmada a partir de foto enviada no canal individual.",
    metadata: {
      channelId: interaction.channelId,
      imageUrl: pending.imageUrl,
      quantity: pending.quantity,
      sourceMessageId: pending.sourceMessageId
    },
    type: "fivem.goals.entry_confirmed",
    userId: interaction.user.id
  }).catch(() => null);

  await interaction.editReply(createConfirmedInteractionPayload(interaction.guild));
  const channel = interaction.channel;
  if (channel?.isSendable()) {
    await channel.send(createFarmRegisteredPayload(interaction.user.id, pending.imageUrl, pending.fields, pending.quantity, interaction.guild)).catch(() => null);
    if (pending.correctionRequestId && pending.replacementForRegistrationId) {
      await channel.send(createCorrectionCompletedPayload(pending, interaction.guild)).catch(() => null);
    }
  }
  if (pending.correctionRequestId && pending.replacementForRegistrationId) {
    await sendGoalLog(interaction.guild, context, `✅ Correção de meta concluída\n\nUsuário: <@${interaction.user.id}>\nRegistro original: ${pending.replacementForRegistrationId}\nNovo registro: ${"entry" in saved ? saved.entry?.id ?? "-" : "-"}\nItem: ${fieldItemLabel(pending.fields)}\nNova quantidade: ${formatGoalValue(pending.quantity)}`, { id: pending.correctionRequestId });
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
    await interaction.reply({ content: "Envie a imagem do comprovante neste canal. Assim que ela chegar, o bot mostrara o botão **Registrar Farm**.", ephemeral: true });
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

export function createFarmRoomPanelPayload(guild: Guild | null, settings: Pick<FivemGoalSettings, "managerRoleId" | "managerRoleIds"> | null, userId: string) {
  const managerIds = uniqueRoleIds([...(settings?.managerRoleIds ?? []), settings?.managerRoleId]);
  const managerMention = managerIds.length ? managerIds.map((roleId) => `<@&${roleId}>`).join(", ") : "Gerente de Farm";
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
          { type: 10, content: "-# NexTech - Todos os direitos reservados" }
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
function goalStatus(status: "pending" | "approved" | "refused" | "correction_requested") {
  return status === "approved" ? "Aprovado" : status === "refused" ? "Recusado" : status === "correction_requested" ? "Correção pendente" : "Pendente";
}

function createToken() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function noCorrectionRecordsPayload(userId: string, guild: Guild | null) {
  void guild;
  return {
    allowedMentions: { parse: [] as never[], users: [userId] },
    components: [{
      type: 17,
      accent_color: 0xf59e0b,
      components: [
        { type: 10, content: `## ⚠️ Nenhum registro encontrado\n\nEsse usuário não possui registros confirmados no período atual.` }
      ]
    }],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function createCorrectionRecordSelectPayload(token: string, userId: string, entries: FivemGoalEntry[], settings: FivemGoalSettings) {
  const configs = new Map((settings.configs ?? []).map((config) => [config.id, config.name]));
  return {
    allowedMentions: { parse: [] as never[], users: [userId] },
    components: [{
      type: 17,
      accent_color: 0xf59e0b,
      components: [
        { type: 10, content: `## 📝 Editar registro de meta\n\n👤 Usuário: <@${userId}>\n\nSelecione o registro que precisa ser refeito:` },
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${EDIT_RECORD_SELECT_CUSTOM_ID_PREFIX}:${token}`)
            .setPlaceholder("Selecionar registro confirmado")
            .addOptions(entries.slice(0, 25).map((entry) => ({
              description: `Registrado em ${formatBrazilDateTime(new Date(entry.createdAt))} · ID: ${entry.id.slice(0, 18)}`,
              label: `${entryLabel(entry, configs)} - ${formatGoalValue(entry.quantity ?? 0)}`.slice(0, 100),
              value: entry.id
            })))
        )
      ]
    }],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function createCorrectionConfirmPayload(token: string, userId: string, entry: FivemGoalEntry, reason: string, guild: Guild) {
  void guild;
  return {
    allowedMentions: { parse: [] as never[], users: [userId] },
    components: [{
      type: 17,
      accent_color: 0xf59e0b,
      components: [
        { type: 10, content: [
          "## ⚠️ Confirmar solicitação de correção",
          "",
          `Usuário: <@${userId}>`,
          `Item: ${entryLabel(entry)}`,
          `Quantidade registrada: ${formatGoalValue(entry.quantity ?? 0)}`,
          `Data do registro: ${formatBrazilDateTime(new Date(entry.createdAt))}`,
          `Motivo: ${reason}`,
          "",
          "O registro atual será retirado temporariamente da contagem e o usuário deverá refazê-lo."
        ].join("\n") },
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${EDIT_CONFIRM_PREFIX}:apply:${token}`).setLabel("Confirmar solicitação").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`${EDIT_CONFIRM_PREFIX}:back:${token}`).setLabel("Voltar").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`${EDIT_CONFIRM_PREFIX}:cancel`).setLabel("Cancelar").setStyle(ButtonStyle.Secondary)
        )
      ]
    }],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function createCorrectionRequestedPayload(correction: FivemGoalCorrectionRequest, entry: FivemGoalEntry, managerId: string, guild: Guild) {
  return {
    allowedMentions: { parse: [] as never[], users: [correction.userId, managerId] },
    components: [{
      type: 17,
      accent_color: 0xf59e0b,
      components: [
        { type: 10, content: [
          "## ⚠️ Você precisa refazer uma meta",
          "",
          `👤 Usuário: <@${correction.userId}>`,
          `📋 Item: ${entryLabel(entry)}`,
          `📅 Registro original: ${formatBrazilDateTime(new Date(entry.createdAt))}`,
          "",
          "📝 Motivo:",
          correction.reason,
          "",
          "Envie uma nova imagem neste canal para refazer essa meta.",
          "",
          `Solicitado por: <@${managerId}>`
        ].join("\n") }
      ]
    }],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function createCorrectionCompletedPayload(pending: { fields: Array<{ id: string; label: string; value: string }>; replacementForRegistrationId: string | null }, guild: Guild) {
  void guild;
  return {
    components: [{
      type: 17,
      accent_color: 0x22c55e,
      components: [
        { type: 10, content: `## ✅ Meta refeita com sucesso\n\nO novo registro de ${fieldItemLabel(pending.fields)} foi confirmado e substituiu o registro anterior na contagem semanal.` }
      ]
    }],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

async function sendGoalLog(guild: Guild, context: BotContext, content: string, metadata: unknown) {
  const settings = await context.api.getFivemGoalSettings(guild.id).catch(() => null);
  const logChannelId = settings?.correctionManagement?.logChannelId ?? settings?.logChannelId ?? null;
  if (logChannelId) {
    const channel = await guild.channels.fetch(logChannelId).catch(() => null);
    if (channel?.isSendable()) await channel.send({ content, allowedMentions: { parse: [] } }).catch(() => null);
  }
  await context.api.postLog({ guildId: guild.id, message: content, metadata, type: "fivem.goals.correction", userId: null }).catch(() => null);
}

function entryLabel(entry: FivemGoalEntry, configs = new Map<string, string>()) {
  const configName = entry.metaId ? configs.get(entry.metaId) : null;
  return configName ?? fieldItemLabel(entry.fields);
}

function fieldItemLabel(fields: Array<{ id: string; label: string; value: string }>) {
  return fields.find((field) => /item|tipo|meta/i.test(`${field.id} ${field.label}`))?.value?.trim() || "Farm";
}

function correctionOptionLabel(correction: FivemGoalCorrectionRequest) {
  const entry = correction.originalRegistration;
  return `${entry ? entryLabel(entry) : "Meta"} - ${entry?.quantity ? formatGoalValue(entry.quantity) : correction.originalRegistrationId}`;
}

function readApiError(error: unknown, fallback: string) {
  const message = (error as any)?.response?.data?.message ?? (error instanceof Error ? error.message : null);
  return typeof message === "string" && message.trim() ? message : fallback;
}

function createImageReviewPayload(userId: string, channelId: string, sourceMessageId: string, attachmentId: string, imageUrl: string, settings: FivemGoalSettings, corrections: FivemGoalCorrectionRequest[] = []) {
  const token = createToken();
  const configs = (settings.configs ?? []).filter((item) => item.status === "active");
  const onlyCorrection = corrections.length === 1 ? corrections[0] : null;
  pendingImages.set(token, {
    attachmentId,
    channelId,
    correctionRequestId: onlyCorrection?.id ?? null,
    expiresAt: Date.now() + 60 * 60 * 1000,
    imageUrl,
    metaId: onlyCorrection?.originalRegistration?.metaId ?? (configs.length === 1 ? configs[0]?.id ?? null : null),
    replacementForRegistrationId: onlyCorrection?.originalRegistrationId ?? null,
    sourceMessageId,
    userId
  });
  cleanupPendingImages();
  const correctionIntro = corrections.length ? "\n\n⚠️ Existe correção pendente. Esta imagem será usada para refazer uma meta solicitada." : "";

  return {
    allowedMentions: { parse: [] as never[] },
    components: [
      {
        type: 17,
        accent_color: 0x22c55e,
        components: [
          { type: 12, items: [{ media: { url: imageUrl }, description: "meta image" }] },
          { type: 10, content: replaceSystemEmojis(`## ${systemEmojiText("prancheta_acertos")} Registro de Farm\n\n${systemEmojiText("homem")} Usuário: <@${userId}>\n${systemEmojiText("interrogacao")} Foto recebida. Clique no botão abaixo para registrar os itens.${correctionIntro}`, null) },
          { type: 14, divider: true, spacing: 1 },
          ...(corrections.length > 1 ? [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId(`${PREFIX}:correct:${token}`).setPlaceholder("Qual meta você está refazendo?").addOptions(corrections.slice(0, 25).map((item) => ({ description: item.reason.slice(0, 100), label: correctionOptionLabel(item).slice(0, 100), value: item.id })))
          )] : configs.length > 1 && !onlyCorrection ? [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId(`${PREFIX}:choose:${token}`).setPlaceholder("Selecione o tipo de meta").addOptions(configs.slice(0, 25).map((item) => ({ description: item.description?.slice(0, 100) || undefined, label: item.name.slice(0, 100), value: item.id })))
          )] : [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`${PREFIX}:register:${token}`).setEmoji(systemComponentEmoji("prancheta_acertos")).setLabel("Registrar Farm").setStyle(ButtonStyle.Primary)
          )])
        ]
      }
    ],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function createGoalConfirmationPayload(token: string, userId: string, imageUrl: string, fields: Array<{ id: string; label: string; value: string }>, quantity: number, guild: Guild) {
  const itemLabel = fields.find((field) => /item|tipo|meta/i.test(`${field.id} ${field.label}`))?.value?.trim() || "Farm";
  return {
    allowedMentions: { parse: [] as never[], users: [userId] },
    components: [{
      type: 17,
      accent_color: 0xfacc15,
      components: [
        { type: 12, items: [{ media: { url: imageUrl }, description: "comprovante de meta" }] },
        {
          type: 10,
          content: [
            `## ${systemEmojiText("alerta", guild)} Confirmar registro`,
            "",
            `${systemEmojiText("homem", guild)} **Usuário:** <@${userId}> | ${userId}`,
            `${systemEmojiText("caixa", guild)} **Item:** ${itemLabel}`,
            `${systemEmojiText("prancheta", guild)} **Quantidade:** ${formatGoalValue(quantity)}`,
            `${systemEmojiText("calendario", guild)} **Data:** ${formatBrazilDateTime(new Date())}`
          ].join("\n")
        },
        { type: 14, divider: true, spacing: 1 },
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:confirm:${token}`).setEmoji(systemComponentEmoji("visto", guild)).setLabel("Confirmar").setStyle(ButtonStyle.Success)
        )
      ]
    }],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 as const
  };
}

function createConfirmedInteractionPayload(guild: Guild) {
  return {
    components: [{
      type: 17,
      accent_color: 0x22c55e,
      components: [
        { type: 10, content: `## ${systemEmojiText("visto", guild)} Registro confirmado\nA meta foi salva e o comprovante foi publicado no canal.` }
      ]
    }],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function createFarmRegisteredPayload(userId: string, imageUrl: string, fields: Array<{ id: string; label: string; value: string }>, quantity: number, guild: Guild) {
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
        { type: 10, content: "-# *NexTech - Todos os direitos reservados*" }
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
        { type: 10, content: "-# *NexTech - Todos os direitos reservados*" }
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
  for (const [token, item] of pendingConfirmations) {
    if (item.expiresAt < now) pendingConfirmations.delete(token);
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

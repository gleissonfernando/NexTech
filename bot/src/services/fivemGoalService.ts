import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
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
import type { FivemGoalCorrectionRequest, FivemGoalEntry, FivemGoalItem, FivemGoalRankingRuntime, FivemGoalSettings } from "./apiClient";
import { FIXED_SYSTEM_EMOJI_BY_KEY, SYSTEM_EMOJI_BY_KEY, isSystemEmojiKey, type SystemEmojiKey } from "../config/systemEmojis";
import { replaceSystemEmojis, systemComponentEmoji, systemEmojiText } from "./systemEmojiService";

const PREFIX = "fivem_goal";
const RANKING_PAGE_SIZE = 15;
const RANKING_PANEL_PREFIX = `${PREFIX}:ranking`;
const SUMMARY_PANEL_PREFIX = `${PREFIX}:summary`;
const REQUEST_CHANNEL_CUSTOM_ID = `${PREFIX}:request_channel`;
const FARM_ROOM_CLOSE_CUSTOM_ID_PREFIX = `${PREFIX}:room:close`;
const EDIT_USER_SELECT_CUSTOM_ID = `${PREFIX}:edit:user`;
const EDIT_RECORD_SELECT_CUSTOM_ID_PREFIX = `${PREFIX}:edit:record`;
const EDIT_REASON_MODAL_PREFIX = `${PREFIX}:edit:reason`;
const EDIT_CONFIRM_PREFIX = `${PREFIX}:edit:confirm`;
const MANAGEMENT_PREFIX = `${PREFIX}:manage`;
const ALLOWED_IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif)(?:\?.*)?$/i;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const pendingFarmItems = new Set<string>();
const processedGoalImageTriggers = new Map<string, number>();
const pendingFarmModalContexts = new Map<string, FarmComponentContext & { expiresAt: number }>();
const pendingEditSelections = new Map<string, { entries: FivemGoalEntry[]; expiresAt: number; guildId: string; managerId: string; targetUserId: string }>();
const pendingEditConfirmations = new Map<string, { entry: FivemGoalEntry; expiresAt: number; guildId: string; managerId: string; managerName: string; reason: string; targetUserId: string }>();

type PanelPublishResult = {
  error?: string;
  messageId?: string | null;
  ok: boolean;
  skipped?: boolean;
};

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

export const gerenciamentoFarmingCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("gerenciamento-farming").setDescription("Abre o painel administrativo do Sistema de Metas/Farming."),
  moduleId: "fivem-goals",
  async execute(interaction, context) {
    await showFarmingManagementPanel(interaction, context);
  }
};

export const fechamentoMetaCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("fechamento-meta").setDescription("Abre a confirmação para finalizar o período atual de metas."),
  moduleId: "fivem-goals",
  async execute(interaction, context) {
    await showFarmingFinalizePanel(interaction, context);
  }
};

export const fechaMetaCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("fecha")
    .setDescription("Fecha meta individual.")
    .addSubcommand((subcommand) => subcommand
      .setName("meta")
      .setDescription("Fecha a meta de uma pessoa no período atual.")
      .addUserOption((option) => option.setName("usuario").setDescription("Pessoa que terá a meta fechada.").setRequired(true))),
  moduleId: "fivem-goals",
  async execute(interaction, context) {
    if (interaction.options.getSubcommand() !== "meta") return;
    await closeSingleUserGoal(interaction, context);
  }
};

export const resumoMetaCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("resumo-meta").setDescription("Mostra o resumo semanal de metas de todos os usuários."),
  moduleId: "fivem-goals",
  async execute(interaction, context) {
    await showGoalSummaryCommand(interaction, context);
  }
};

export function startFivemGoalService(client: Client<true>, context: BotContext) {
  context.socket.onFivemGoalPanelPublish((payload, ack) => {
    const cachedGuild = client.guilds.cache.get(payload.guildId) ?? null;
    if (!cachedGuild) {
      void context.api.postLog({
        guildId: payload.guildId,
        message: "Guild do painel de metas não estava no cache; tentando buscar no Discord antes de publicar.",
        metadata: { botId: payload.botId ?? null },
        type: "fivem.goals.panel_publish_cache_miss",
        userId: null
      }).catch(() => null);
    }
    void (async () => {
      const guild = cachedGuild ?? (await client.guilds.fetch(payload.guildId).catch(() => null));
      if (!guild) {
        ack?.({ ok: false, error: "Bot não está conectado ao servidor configurado." });
        return;
      }
      const [requestPanel, rankingPanel] = await Promise.all([
        publishGoalRequestPanel(guild, context),
        refreshFivemGoalRankingPanel(guild, context)
      ]);
      const ok = requestPanel.ok || rankingPanel.ok;
      ack?.({
        ok,
        error: ok ? undefined : requestPanel.error ?? rankingPanel.error ?? "Nenhum painel de metas foi publicado. Verifique os canais configurados.",
        rankingMessageId: rankingPanel.messageId ?? null,
        requestPanelMessageId: requestPanel.messageId ?? null
      });
    })().catch((error) => {
      ack?.({ ok: false, error: readUnknownError(error) });
    });
  });
  for (const guild of client.guilds.cache.values()) {
    void publishGoalRequestPanel(guild, context);
    void refreshFivemGoalRankingPanel(guild, context);
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
    if (isReusableFarmRoomChannel(existingChannel)) {
      const farmChannel = existingChannel as typeof existingChannel & { messages: { fetch(input: { limit: number }): Promise<unknown> }; send(payload: unknown): Promise<unknown> };
      const recent = await farmChannel.messages.fetch({ limit: 30 }).catch(() => null) as { find(predicate: (message: Message) => boolean): Message | undefined; some(predicate: (message: Message) => boolean): boolean } | null;
      const hasPanel = recent?.some((message) => message.author.id === guild.client.user.id && messageHasFarmRoomPanel(message, userId));
      if (!hasPanel) {
        const legacyPanel = recent?.find((message) => message.author.id === guild.client.user.id && messageHasLegacyGoalPanel(message, userId));
        try {
          if (legacyPanel) await legacyPanel.edit(createFarmRoomPanelPayload(guild, settings, userId));
          else await farmChannel.send(createFarmRoomPanelPayload(guild, settings, userId));
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
    await discardStaleFivemGoalChannel(context, guild.id, existing.channelId, userId);
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
  }).catch((error) => null);

  if (!channel) {
    return goalSetIntegrationResult(null, null, targetCategoryId, false, "O Discord recusou a criação do canal de meta. Verifique se o bot possui Gerenciar Canais na categoria de metas e se o servidor não atingiu o limite de canais.");
  }

  try {
    await channel.send(createFarmRoomPanelPayload(guild, settings, userId));
    await context.api.saveFivemGoalChannel({ channelId: channel.id, guildId: guild.id, userId });
  } catch (error) {
    await channel.delete("Falha ao publicar painel da Sala de Farm").catch(() => null);
    return goalSetIntegrationResult(null, null, targetCategoryId, false, error instanceof Error ? `Não foi possível concluir a Sala de Farm: ${error.message}` : "Não foi possível concluir a Sala de Farm.");
  }

  return goalSetIntegrationResult(channel.id, null, targetCategoryId, Boolean(targetCategoryId), null);
}

export function isReusableFarmRoomChannel(channel: unknown): channel is { isDMBased(): boolean; isTextBased(): boolean; messages: { fetch(input: { limit: number }): Promise<unknown> }; parentId?: string | null } {
  return Boolean(
    channel
    && typeof channel === "object"
    && "isTextBased" in channel
    && typeof (channel as { isTextBased?: unknown }).isTextBased === "function"
    && (channel as { isTextBased(): boolean }).isTextBased()
    && "isDMBased" in channel
    && typeof (channel as { isDMBased?: unknown }).isDMBased === "function"
    && !(channel as { isDMBased(): boolean }).isDMBased()
    && "messages" in channel
  );
}

async function discardStaleFivemGoalChannel(context: BotContext, guildId: string, channelId: string, userId: string) {
  await context.api.deleteFivemGoalChannelByChannel(channelId).catch(() => null);
  await context.api.postLog({
    guildId,
    message: "Vínculo antigo de sala de farm removido porque o canal não existe mais no Discord.",
    metadata: { channelId, userId },
    type: "fivem.goals.room_stale_channel_removed",
    userId
  }).catch(() => null);
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
  if (!message.guild || message.author.bot) return false;
  const goalChannel = await context.api.getFivemGoalChannelByChannel(message.channel.id).catch(() => null);

  if (!goalChannel) {
    return false;
  }

  const image = message.attachments.find(isAllowedGoalImage);
  if (!image) return true;

  const settings = await context.api.getFivemGoalSettings(message.guild.id).catch(() => null);
  if (!settings?.enabled) return true;

  const authorized = message.author.id === goalChannel.userId || await canSubmitGoalImageMessage(message, settings);
  if (!authorized) return true;

  if (settings.setRequestEnabled && !(await hasApprovedSetRegistration(context, message.guild.id, goalChannel.userId))) {
    await quarantineUnregisteredFarmChannel(message, context, goalChannel.userId);
    return true;
  }

  const triggerKey = goalImageTriggerKey(message.guild.id, message.channel.id, message.id, image);
  if (isGoalImageTriggerProcessed(triggerKey)) return true;
  markGoalImageTriggerProcessed(triggerKey);

  const pendingCorrections = await context.api.getPendingFivemGoalCorrections(message.guild.id, goalChannel.userId, message.channel.id).catch(() => []);
  const reviewPayload = createImageReviewPayload(goalChannel.userId, message.channel.id, message.id, image.id, image.url, settings, pendingCorrections, message.guild);
  await message.reply(reviewPayload);
  await context.api.postLog({
    guildId: message.guild.id,
    message: "Foto de meta recebida no canal individual e painel de registro publicado na sala.",
    metadata: {
      channelId: message.channel.id,
      imageUrl: image.url,
      sourceAuthorId: message.author.id,
      reviewDelivery: "channel"
    },
    type: "fivem.goals.photo_received",
    userId: goalChannel.userId
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

  if (interaction.customId.startsWith(`${MANAGEMENT_PREFIX}:`)) {
    await handleFarmingManagementInteraction(interaction, context);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(`${RANKING_PANEL_PREFIX}:`)) {
    await handleRankingPagination(interaction, context);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(`${SUMMARY_PANEL_PREFIX}:`)) {
    await handleSummaryPagination(interaction, context);
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

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(`${PREFIX}:correct:`)) {
    await showGoalModal(interaction, context, interaction.values[0] ?? null);
    return true;
  }

  if (interaction.isModalSubmit() && (interaction.customId.startsWith(`${PREFIX}:modal:`) || interaction.customId.startsWith(`${PREFIX}:modal_ref:`))) {
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
  if (settings.setRequestEnabled && !(await hasApprovedSetRegistration(context, interaction.guild.id, interaction.user.id))) {
    await interaction.editReply("Você ainda não possui um Pedido de Set aprovado. Faça seu registro no canal de Pedido de Set; sem esse cadastro aprovado, suas metas não serão contabilizadas.");
    await context.api.postLog({
      guildId: interaction.guild.id,
      message: "Solicitação de sala de farm bloqueada porque o usuário não possui Pedido de Set aprovado.",
      metadata: { setRequestEnabled: true },
      type: "fivem.goals.room_request_without_set",
      userId: interaction.user.id
    }).catch(() => null);
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

async function hasApprovedSetRegistration(context: BotContext, guildId: string, userId: string) {
  const submission = await context.api.getLatestManualRegistrationSubmission(guildId, userId).catch(() => null);
  return submission?.status === "approved";
}

async function quarantineUnregisteredFarmChannel(message: Message, context: BotContext, ownerId: string) {
  await message.delete().catch(() => null);
  const warning = [
    "⚠️ Cadastro de Set obrigatório",
    "",
    `<@${ownerId}>, este canal de farm está vinculado a uma pessoa que não possui Pedido de Set aprovado.`,
    "",
    "Caso você ainda não tenha feito o Pedido de Set no canal de registro, faça o cadastro e aguarde aprovação.",
    "Enquanto o Set não estiver aprovado, as metas enviadas aqui não serão contabilizadas.",
    "",
    "Este canal será removido para evitar registros inválidos."
  ].join("\n");
  if (message.channel.isSendable()) {
    await message.channel.send({ allowedMentions: { users: [ownerId] }, content: warning }).catch(() => null);
  }
  await context.api.postLog({
    guildId: message.guild?.id ?? "",
    message: "Canal de farm removido porque o usuário não possui Pedido de Set aprovado.",
    metadata: {
      channelId: message.channel.id,
      ownerId,
      triggerMessageAuthorId: message.author.id
    },
    type: "fivem.goals.orphan_room_removed",
    userId: ownerId
  }).catch(() => null);
  await context.api.deleteFivemGoalChannelByChannel(message.channel.id).catch(() => null);
  if (!message.channel.isDMBased() && "delete" in message.channel) {
    setTimeout(() => {
      void message.channel.delete("Sala de farm removida: usuário sem Pedido de Set aprovado.").catch(() => null);
    }, 5000);
  }
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
  await refreshFivemGoalRankingPanel(interaction.guild, context).catch(() => null);
}

async function canUseGoalCorrectionCommand(interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction | UserSelectMenuInteraction, settings: FivemGoalSettings) {
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

async function canSubmitGoalImageMessage(message: Message, settings: FivemGoalSettings) {
  if (!message.guild) return false;
  const member = await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return false;
  const managerRoleIds = new Set([
    settings.correctionManagement?.managerRoleId,
    settings.managerRoleId,
    ...(settings.managerRoleIds ?? [])
  ].filter((value): value is string => Boolean(value)));
  if (managerRoleIds.size && member.roles.cache.some((role) => managerRoleIds.has(role.id))) return true;
  return settings.correctionManagement?.allowAdministrators === true && member.permissions.has(PermissionFlagsBits.Administrator);
}

async function showFarmingManagementPanel(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const settings = await context.api.getFivemGoalSettings(interaction.guild.id).catch(() => null);
  if (!settings?.enabled || !(await canUseGoalCorrectionCommand(interaction, settings))) {
    await interaction.reply({
      content: "❌ Acesso negado\n\nSomente os gerentes de metas autorizados podem utilizar este comando.",
      ephemeral: true
    });
    return;
  }
  await interaction.reply(createFarmingManagementPayload(settings, interaction.guild, null));
}

async function showFarmingFinalizePanel(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const settings = await context.api.getFivemGoalSettings(interaction.guild.id).catch(() => null);
  if (!settings?.enabled || !(await canUseGoalCorrectionCommand(interaction, settings))) {
    await interaction.reply({
      content: "❌ Acesso negado\n\nSomente os gerentes de metas autorizados podem finalizar a meta.",
      ephemeral: true
    });
    return;
  }
  await interaction.reply(createFarmingFinalizeConfirmPayload(settings, interaction.guild));
}

async function closeSingleUserGoal(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const settings = await context.api.getFivemGoalSettings(interaction.guild.id).catch(() => null);
  if (!settings?.enabled || !(await canUseGoalCorrectionCommand(interaction, settings))) {
    await interaction.reply({
      content: "❌ Acesso negado\n\nSomente os gerentes de metas autorizados podem fechar a meta de uma pessoa.",
      ephemeral: true
    });
    return;
  }

  const target = interaction.options.getUser("usuario", true);
  await interaction.deferReply({ ephemeral: true });

  const result = await context.api.finalizeFivemGoalUserPeriod(interaction.guild.id, {
    actorId: interaction.user.id,
    userId: target.id
  }).catch((error) => ({ error }));

  if ("error" in result) {
    await interaction.editReply(readApiError(result.error, "Não foi possível fechar a meta desta pessoa."));
    return;
  }

  const report = result.report;
  const periodText = `${formatBrazilDateTime(new Date(report.periodStart))} até ${formatBrazilDateTime(new Date(report.periodEnd))}`;
  if (!result.alreadyFinalized) {
    await sendGoalLog(interaction.guild, context, [
      "✅ Meta individual fechada",
      "",
      `Gerente: <@${interaction.user.id}> | ${interaction.user.id}`,
      `Pessoa: <@${target.id}> | ${target.id}`,
      `Período: ${periodText}`,
      `Registros: ${report.totalRecords}`,
      `Aprovadas: ${report.approvedCount}`,
      `Pendentes: ${report.pendingCount}`,
      `Reprovadas: ${report.refusedCount}`,
      `Total aprovado: ${formatGoalValue(report.totalApprovedValue)}`,
      `Data: ${formatBrazilDateTime(new Date())}`
    ].join("\n"), { periodEnd: report.periodEnd, periodStart: report.periodStart, targetUserId: target.id });
  }

  await interaction.editReply([
    result.alreadyFinalized ? "⚠️ A meta dessa pessoa já estava fechada neste período." : "✅ Meta da pessoa fechada neste período.",
    "",
    `Pessoa: <@${target.id}>`,
    `Período: ${periodText}`,
    `Registros: ${report.totalRecords}`,
    `Aprovadas: ${report.approvedCount}`,
    `Pendentes: ${report.pendingCount}`,
    `Reprovadas: ${report.refusedCount}`,
    `Total aprovado: ${formatGoalValue(report.totalApprovedValue)}`
  ].join("\n"));
}

async function handleFarmingManagementInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.guild || !("customId" in interaction)) return;
  const settings = await context.api.getFivemGoalSettings(interaction.guild.id).catch(() => null);
  if (!settings?.enabled || !(interaction.isModalSubmit() || interaction.isButton() || interaction.isStringSelectMenu()) || !(await canUseGoalCorrectionCommand(interaction, settings))) {
    if (interaction.isRepliable()) {
      await interaction.reply({ content: "❌ Acesso negado\n\nSomente os gerentes de metas autorizados podem utilizar este comando.", ephemeral: true }).catch(() => null);
    }
    return;
  }

  const action = interaction.customId.split(":")[2] ?? "";
  if (interaction.isButton() && action === "refresh") {
    await interaction.update(createFarmingManagementPayload(settings, interaction.guild, "Painel atualizado."));
    return;
  }
  if (interaction.isButton() && action === "publish") {
    await interaction.deferUpdate();
    await publishGoalRequestPanel(interaction.guild, context);
    const next = await context.api.getFivemGoalSettings(interaction.guild.id).catch(() => settings);
    await interaction.editReply(createFarmingManagementPayload(next, interaction.guild, "Painel de solicitação atualizado no canal configurado."));
    return;
  }
  if (interaction.isButton() && action === "add_item") {
    const modal = new ModalBuilder()
      .setCustomId(`${MANAGEMENT_PREFIX}:add_item_modal`)
      .setTitle("Adicionar item");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("name").setLabel("Nome").setPlaceholder("Dinheiro Sujo").setMaxLength(80).setRequired(true).setStyle(TextInputStyle.Short)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("emoji").setLabel("Emoji").setPlaceholder("💵").setMaxLength(80).setRequired(true).setStyle(TextInputStyle.Short)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("requiredAmount").setLabel("Valor interno").setPlaceholder("100000").setMaxLength(20).setRequired(true).setStyle(TextInputStyle.Short)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("type").setLabel("Tipo").setPlaceholder("Obrigatório, adicional ou opcional").setMaxLength(20).setRequired(true).setStyle(TextInputStyle.Short))
    );
    await interaction.showModal(modal);
    return;
  }
  if (interaction.isModalSubmit() && action === "add_item_modal") {
    await interaction.deferReply({ ephemeral: true });
    const name = interaction.fields.getTextInputValue("name").trim();
    const emoji = interaction.fields.getTextInputValue("emoji").trim();
    const requiredAmount = parseGoalNumericValue(interaction.fields.getTextInputValue("requiredAmount"));
    const typeText = interaction.fields.getTextInputValue("type").trim().toLowerCase();
    const type = typeText.startsWith("adic") ? "additional" : typeText.startsWith("opc") ? "optional" : "required";
    if (!emoji) {
      await interaction.editReply("Informe um emoji para o item.");
      return;
    }
    if (!requiredAmount || !Number.isSafeInteger(requiredAmount)) {
      await interaction.editReply("Informe um valor interno válido para o item.");
      return;
    }
    const saved = await context.api.addFivemGoalItem(interaction.guild.id, { actorId: interaction.user.id, emoji, name, requiredAmount, type }).catch((error) => ({ error }));
    if ("error" in saved) {
      await interaction.editReply(readApiError(saved.error, "Não foi possível adicionar o item."));
      return;
    }
    await sendGoalLog(interaction.guild, context, `📝 Item de meta adicionado\n\nGerente: <@${interaction.user.id}> | ${interaction.user.id}\nItem: ${emoji ? `${emoji} ` : ""}${name}\nValor interno: ${formatGoalValue(requiredAmount)}\nTipo: ${goalItemTypeLabel(type)}\nData: ${formatBrazilDateTime(new Date())}`, { itemId: saved.item.id });
    await interaction.editReply(createFarmingManagementPayload(saved.settings, interaction.guild, "Item adicionado. Ele já aparecerá nos próximos registros."));
    return;
  }
  if (interaction.isButton() && action === "items") {
    await interaction.update(createFarmingItemsPayload(settings, interaction.guild));
    return;
  }
  if (interaction.isStringSelectMenu() && action === "item_select") {
    const item = activeGoalItems({ ...settings, items: settings.items }).concat(settings.items.filter((entry) => entry.enabled === false)).find((entry) => entry.id === interaction.values[0]);
    await interaction.update(createFarmingItemDetailPayload(settings, interaction.guild, item ?? null));
    return;
  }
  if (interaction.isButton() && (action === "item_enable" || action === "item_disable" || action === "item_remove")) {
    await interaction.deferUpdate();
    const itemId = interaction.customId.split(":")[3] ?? "";
    const next = await context.api.updateFivemGoalItem(interaction.guild.id, itemId, {
      action: action === "item_enable" ? "enable" : action === "item_disable" ? "disable" : "remove",
      actorId: interaction.user.id
    }).catch((error) => ({ error }));
    if ("error" in next) {
      await interaction.followUp({ content: readApiError(next.error, "Não foi possível atualizar o item."), ephemeral: true });
      return;
    }
    await sendGoalLog(interaction.guild, context, `📝 Item de meta atualizado\n\nGerente: <@${interaction.user.id}> | ${interaction.user.id}\nItem: ${itemId}\nAção: ${action.replace("item_", "")}\nData: ${formatBrazilDateTime(new Date())}`, { itemId });
    await interaction.editReply(createFarmingItemsPayload(next, interaction.guild, "Item atualizado."));
    return;
  }
  if (interaction.isButton() && action === "finalize") {
    await interaction.update(createFarmingFinalizeConfirmPayload(settings, interaction.guild));
    return;
  }
  if (interaction.isButton() && action === "finalize_cancel") {
    await interaction.update(createFarmingManagementPayload(settings, interaction.guild, "Finalização cancelada."));
    return;
  }
  if (interaction.isButton() && action === "finalize_confirm") {
    await interaction.deferUpdate();
    const result = await context.api.finalizeFivemGoalPeriod(interaction.guild.id, {
      actorId: interaction.user.id,
      finalizationType: "manual"
    }).catch((error) => ({ error }));
    if ("error" in result) {
      await interaction.followUp({ content: readApiError(result.error, "Não foi possível finalizar a meta."), ephemeral: true });
      return;
    }
    const report = result.report;
    const periodText = `${formatBrazilDateTime(new Date(report.periodStart))} até ${formatBrazilDateTime(new Date(report.periodEnd))}`;
    if (!result.alreadyFinalized) {
      await sendGoalLog(interaction.guild, context, [
        "✅ Meta finalizada",
        "",
        `Gerente: <@${interaction.user.id}> | ${interaction.user.id}`,
        `Período: ${periodText}`,
        `Participantes: ${report.participantCount}`,
        `Registros: ${report.totalRecords}`,
        `Aprovadas: ${report.approvedCount}`,
        `Pendentes: ${report.pendingCount}`,
        `Reprovadas: ${report.refusedCount}`,
        `Total aprovado: ${formatGoalValue(report.totalApprovedValue)}`,
        `Data: ${formatBrazilDateTime(new Date())}`
      ].join("\n"), { periodEnd: report.periodEnd, periodStart: report.periodStart });
    }
    const next = await context.api.getFivemGoalSettings(interaction.guild.id).catch(() => settings);
    await interaction.editReply(createFarmingManagementPayload(next, interaction.guild, result.alreadyFinalized ? "Este período já estava finalizado." : "Meta finalizada e log registrada."));
    return;
  }
}

function createFarmingManagementPayload(settings: FivemGoalSettings, guild: Guild, notice: string | null) {
  const activeConfig = settings.configs?.find((config) => config.status === "active") ?? settings.configs?.[0] ?? null;
  const activeItems = activeGoalItems(settings);
  const correctionManagers = uniqueRoleIds([settings.correctionManagement?.managerRoleId, settings.managerRoleId, ...(settings.managerRoleIds ?? [])]);
  return {
    allowedMentions: { parse: [] as never[] },
    components: [{
      type: 17,
      accent_color: 0x22c55e,
      components: [
        { type: 10, content: [
          `## ${systemEmojiText("prancheta", guild)} GERENCIAMENTO DE FARMING`,
          "",
          "Gerencie a configuração ativa do Sistema de Metas.",
          notice ? `\n${systemEmojiText("visto", guild)} ${notice}` : "",
          "",
          `Período atual: ${activeConfig ? goalPeriodLabel(activeConfig.period) : "Sem meta ativa"}`,
          `Finalização: ${weekdayName(settings.cycle?.startDay ?? 1)} às ${settings.cycle?.startTime ?? "00:00"}`,
          `Modo: ${settings.weeklySummaryEnabled === false ? "Manual" : "Automático"}`,
          `Itens ativos: ${activeItems.length}`,
          `Gerentes: ${correctionManagers.length ? correctionManagers.map((id) => `<@&${id}>`).join(", ") : "Nenhum cargo configurado"}`
        ].filter(Boolean).join("\n") },
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${MANAGEMENT_PREFIX}:add_item`).setEmoji(systemComponentEmoji("salvar", guild)).setLabel("Adicionar item").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`${MANAGEMENT_PREFIX}:items`).setEmoji(systemComponentEmoji("prancheta", guild)).setLabel("Gerenciar itens").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`${MANAGEMENT_PREFIX}:finalize`).setEmoji(systemComponentEmoji("relogio", guild)).setLabel("Finalizar meta").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`${MANAGEMENT_PREFIX}:publish`).setEmoji(systemComponentEmoji("acessar", guild)).setLabel("Atualizar painel").setStyle(ButtonStyle.Primary)
        ),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${MANAGEMENT_PREFIX}:refresh`).setEmoji(systemComponentEmoji("engrenagem", guild)).setLabel("Ver configuração").setStyle(ButtonStyle.Secondary)
        ),
        { type: 10, content: "-# NexTech - Todos os direitos reservados" }
      ]
    }],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 as const
  };
}

function createFarmingItemsPayload(settings: FivemGoalSettings, guild: Guild, notice: string | null = null) {
  const items = settings.items.slice().sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.name.localeCompare(right.name, "pt-BR"));
  return {
    allowedMentions: { parse: [] as never[] },
    components: [{
      type: 17,
      accent_color: 0x22c55e,
      components: [
        { type: 10, content: `## ${systemEmojiText("prancheta", guild)} Gerenciar itens\n\n${notice ? `${systemEmojiText("visto", guild)} ${notice}\n\n` : ""}Selecione um item para ativar, desativar ou remover.` },
        ...(items.length ? [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${MANAGEMENT_PREFIX}:item_select`)
            .setPlaceholder("Selecione um item")
            .addOptions(items.slice(0, 25).map((item) => ({
              description: `${goalItemTypeLabel(item.type)} · ${item.enabled ? "Ativo" : "Inativo"} · valor interno ${formatGoalValue(item.requiredAmount ?? 1)}`.slice(0, 100),
              emoji: goalItemSelectEmoji(item, guild),
              label: item.name.slice(0, 100),
              value: item.id
            })))
        )] : [{ type: 10, content: "Nenhum item cadastrado." }]),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${MANAGEMENT_PREFIX}:refresh`).setEmoji(systemComponentEmoji("voltar", guild)).setLabel("Voltar").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`${MANAGEMENT_PREFIX}:add_item`).setEmoji(systemComponentEmoji("salvar", guild)).setLabel("Adicionar item").setStyle(ButtonStyle.Success)
        )
      ]
    }],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 as const
  };
}

function createFarmingFinalizeConfirmPayload(settings: FivemGoalSettings, guild: Guild) {
  const activeConfig = settings.configs?.find((config) => config.status === "active") ?? settings.configs?.[0] ?? null;
  return {
    allowedMentions: { parse: [] as never[] },
    components: [{
      type: 17,
      accent_color: 0xf59e0b,
      components: [
        { type: 10, content: [
          `## ${systemEmojiText("alerta", guild)} Confirmar finalização`,
          "",
          `Meta: ${activeConfig?.name ?? "Meta semanal"}`,
          `Período: ${activeConfig ? goalPeriodLabel(activeConfig.period) : "Sem meta ativa"}`,
          `Relatórios: ${settings.weeklySummaryEnabled === false ? "Manual" : "Automático"}`,
          "",
          "Ao confirmar, o sistema registra o fechamento do período atual e envia o log. A mesma semana não será finalizada duas vezes."
        ].join("\n") },
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${MANAGEMENT_PREFIX}:finalize_confirm`).setEmoji(systemComponentEmoji("visto", guild)).setLabel("Confirmar finalização").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`${MANAGEMENT_PREFIX}:finalize_cancel`).setEmoji(systemComponentEmoji("voltar", guild)).setLabel("Voltar").setStyle(ButtonStyle.Secondary)
        ),
        { type: 10, content: "-# NexTech - Todos os direitos reservados" }
      ]
    }],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 as const
  };
}

function createFarmingItemDetailPayload(settings: FivemGoalSettings, guild: Guild, item: FivemGoalItem | null) {
  if (!item) return createFarmingItemsPayload(settings, guild, "Item não encontrado.");
  return {
    allowedMentions: { parse: [] as never[] },
    components: [{
      type: 17,
      accent_color: item.enabled ? 0x22c55e : 0x71717a,
      components: [
        { type: 10, content: [
          `## ${item.emoji ?? systemEmojiText("caixa", guild)} ${item.name}`,
          "",
          `Tipo: ${goalItemTypeLabel(item.type)}`,
          `Status: ${item.enabled ? "Ativo" : "Inativo"}`,
          `Valor interno: ${formatGoalValue(item.requiredAmount ?? 1)}`,
          `Ordem: ${item.order ?? 0}`
        ].join("\n") },
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${MANAGEMENT_PREFIX}:${item.enabled ? "item_disable" : "item_enable"}:${item.id}`).setLabel(item.enabled ? "Desativar item" : "Ativar item").setStyle(item.enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`${MANAGEMENT_PREFIX}:item_remove:${item.id}`).setLabel("Remover item").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`${MANAGEMENT_PREFIX}:items`).setEmoji(systemComponentEmoji("voltar", guild)).setLabel("Voltar").setStyle(ButtonStyle.Secondary)
        )
      ]
    }],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 as const
  };
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
  await refreshFivemGoalRankingPanel(interaction.guild, context).catch(() => null);
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

async function publishGoalRequestPanel(guild: Guild, context: BotContext): Promise<PanelPublishResult> {
  let settings: FivemGoalSettings | null = null;
  try {
    settings = await context.api.getFivemGoalSettings(guild.id);

    if (!settings.enabled) return { ok: false, skipped: true };
    if (!settings.requestPanelEnabled || !settings.requestPanelChannelId) return { ok: false, skipped: true };
    await logGoalPanelPublish(context, guild.id, settings, "start", "Iniciando publicação do painel de solicitação de sala de meta.");

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
        return { ok: true, messageId: edited.id };
      }
      await logGoalPanelPublish(context, guild.id, settings, "old_message_missing", "Mensagem antiga do painel não encontrada; publicando uma nova.", { channelId: channel.id, messageId: settings.requestPanelMessageId });
    }

    const message = await channel.send(payload);
    await context.api.updateFivemGoalPanelState({ channelId: channel.id, guildId: guild.id, messageId: message.id });
    await logGoalPanelPublish(context, guild.id, settings, "sent", "Painel de solicitação de sala de meta publicado no Discord.", { channelId: channel.id, messageId: message.id });
    return { ok: true, messageId: message.id };
  } catch (error) {
    await logGoalPanelPublish(context, guild.id, settings, "error", readUnknownError(error), {}, error);
    return { ok: false, error: readUnknownError(error) };
  }
}

export function createGoalRequestPanelPayload(_title: string, _description: string, guildId?: string | null, botId?: string | null, guild?: Guild | null) {
  const requestCustomId = scopedCustomId(REQUEST_CHANNEL_CUSTOM_ID, guildId, botId);
  const iconUrl = guild?.iconURL({ size: 256 }) ?? null;
  const client = guild?.client ?? null;
  const mainContent = [
    `# ${systemEmojiText("VORTEXtrabalho", guild, client)} CRIAR SALA DE FARM`,
    "",
    "**Bem-vindo(a) ao Sistema de Farm!**",
    "",
    "Clique no botão abaixo para criar sua sala privada automaticamente.",
    "",
    `${systemEmojiText("visto", guild, client)} Apenas você terá acesso à sua sala`,
    `${systemEmojiText("prancheta", guild, client)} Use com organização`,
    `${systemEmojiText("interrogacao", guild, client)} Para dúvidas, chame a gerência`
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
          { type: 10, content: `### ${systemEmojiText("mais", guild, client)} Criar sala de farm\nCria automaticamente uma sala privada para registrar seu farm.` },
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(requestCustomId).setEmoji(systemComponentEmoji("mais", guild, client)).setLabel("Solicitar Sala de Farm").setStyle(ButtonStyle.Secondary)
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

async function showGoalModal(interaction: ButtonInteraction | StringSelectMenuInteraction, context: BotContext, correctionRequestId: string | null = null) {
  const component = parseFarmComponentContext(interaction.customId);
  const guild = await resolveFarmGuild(interaction, component.guildId);
  if (!guild) return;
  const correctionId = correctionRequestId ?? component.correctionRequestId;
  const pending = await recoverFarmImageContext(interaction, context, component.sourceMessageId, correctionId, component.guildId, component.channelId);

  if (!pending) {
    await interaction.reply({ content: "Essa foto não foi localizada. Envie a imagem novamente no seu canal de meta.", ...privateReplyOptions(interaction) });
    return;
  }

  if (pending.userId !== interaction.user.id) {
    await interaction.reply({ content: "Este painel pertence a outro usuário.", ...privateReplyOptions(interaction) });
    return;
  }

  const settings = await context.api.getFivemGoalSettings(guild.id).catch(() => null);
  const items = activeGoalItems(settings);
  if (!items.length) {
    await interaction.reply({ content: "Não existem itens de meta ativos disponíveis para registro.", ...privateReplyOptions(interaction) });
    return;
  }

  const modal = createGoalRegistrationModal(
    farmModalCustomId(pending.sourceMessageId, "select", interaction.user.id, pending.correctionRequestId ?? correctionId, pending.channelId, guild.id, interaction.message?.id ?? null),
    items,
    guild
  );

  await interaction.showModal(modal);
}

export function createGoalRegistrationModal(customId: string, items: FivemGoalItem[], guild: Guild | null = null) {
  const itemSelect = new StringSelectMenuBuilder()
    .setCustomId("meta_item_select")
    .setPlaceholder("Selecione o item que deseja registrar")
    .setMinValues(1)
    .setMaxValues(1)
    .setRequired(true)
    .addOptions(items.slice(0, 25).map((item) => {
      const option = new StringSelectMenuOptionBuilder()
        .setLabel(item.name.slice(0, 100))
        .setValue(item.id)
        .setDescription((item.category || `Registrar ${item.name}`).slice(0, 100));
      const emoji = guild ? goalItemSelectEmoji(item, guild) : undefined;
      if (emoji) option.setEmoji(emoji);
      return option;
    }));

  const itemLabel = new LabelBuilder()
    .setLabel("Selecione o item que deseja registrar")
    .setDescription("Escolha um dos itens ativos da meta.")
    .setStringSelectMenuComponent(itemSelect);

  const quantidadeInput = new TextInputBuilder()
    .setCustomId("meta_quantidade")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Digite a quantidade")
    .setRequired(true);

  const quantidadeLabel = new LabelBuilder()
    .setLabel("Quantidade")
    .setDescription("Informe a quantidade que será registrada.")
    .setTextInputComponent(quantidadeInput);

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle("Registrar Farm")
    .addLabelComponents(itemLabel, quantidadeLabel);
}

async function submitGoalModal(interaction: ModalSubmitInteraction, context: BotContext) {
  const component = parseFarmComponentContext(interaction.customId);
  const guild = await resolveFarmGuild(interaction, component.guildId);
  if (!guild) return;
  if (interaction.guild) await interaction.deferReply({ ephemeral: true });
  else await interaction.deferReply();
  const selectedItemId = interaction.fields.fields.has("meta_item_select")
    ? interaction.fields.getStringSelectValues("meta_item_select")[0] ?? ""
    : component.itemId === "select" ? "" : component.itemId ?? "";
  const itemId = selectedItemId.trim();
  const lockKey = `${guild.id}:${component.sourceMessageId}:${interaction.user.id}:${itemId}`;
  if (pendingFarmItems.has(lockKey)) {
    await interaction.editReply("Esse item já está sendo registrado. Aguarde alguns instantes.");
    return;
  }
  pendingFarmItems.add(lockKey);

  try {
    const pending = await recoverFarmImageContext(interaction, context, component.sourceMessageId, component.correctionRequestId, component.guildId, component.channelId);

    if (!pending || !itemId) {
      await interaction.editReply("Essa foto não foi localizada. Envie a imagem novamente no seu canal de meta.");
      return;
    }

    if (pending.userId !== interaction.user.id || pending.userId !== component.ownerId) {
      await interaction.editReply("Este painel pertence a outro usuário.");
      return;
    }

    const settings = await context.api.getFivemGoalSettings(guild.id).catch(() => null);
    const selectedItem = activeGoalItems(settings).find((item) => item.id === itemId);
    if (!selectedItem) {
      await interaction.editReply("O item selecionado não está mais cadastrado ou foi desativado.");
      return;
    }

    const quantityInput = interaction.fields.fields.has("meta_quantidade") ? interaction.fields.getTextInputValue("meta_quantidade") : interaction.fields.getTextInputValue("quantity");
    const quantity = parseGoalNumericValue(quantityInput);
    if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity <= 0) {
      await interaction.editReply("Informe uma quantidade válida maior que zero.");
      return;
    }
    const quantityValue = quantity as number;

    const activeConfig = settings?.configs?.find((config) => config.status === "active") ?? settings?.configs?.[0] ?? null;
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    const fields = [
      { id: "item", label: "Item", value: selectedItem.name },
      { id: "quantity", label: "Quantidade", value: String(quantity) }
    ];
    const idempotencyKey = `${guild.id}:${pending.sourceMessageId}:${interaction.user.id}:${selectedItem.id}`;
    const saved = await context.api.createFivemGoalEntry({
      attachmentId: pending.attachmentId,
      channelId: pending.channelId,
      fields,
      guildId: guild.id,
      idempotencyKey,
      imageUrl: pending.imageUrl,
      itemId: selectedItem.id,
      metaId: pending.metaId ?? activeConfig?.id ?? null,
      quantity: quantityValue,
      correctionRequestId: pending.correctionRequestId,
      replacementForRegistrationId: pending.replacementForRegistrationId,
      roleIdsSnapshot: member ? [...member.roles.cache.keys()] : [],
      sourceMessageId: pending.sourceMessageId,
      userId: interaction.user.id
    }).catch((error) => ({ error }));
    if ("error" in saved) {
      await interaction.editReply("Não foi possível registrar essa meta. Tente novamente em alguns instantes.");
      return;
    }

    await context.api.postLog({
      guildId: guild.id,
      message: "Meta confirmada a partir de foto enviada no canal individual.",
      metadata: {
        channelId: pending.channelId,
        imageUrl: pending.imageUrl,
        itemId: selectedItem.id,
        quantity: quantityValue,
        sourceMessageId: pending.sourceMessageId
      },
      type: "fivem.goals.entry_confirmed",
      userId: interaction.user.id
    }).catch(() => null);

    await interaction.editReply("Farm registrado.");
    const channel = await guild.channels.fetch(pending.channelId).catch(() => null);
    if (channel?.isSendable()) {
      const registeredMessage = await channel.send(createFarmRegisteredPayload(interaction.user.id, fields, quantityValue, guild, selectedItem.emoji)).catch(() => null);
      if (registeredMessage) await deleteFarmReviewMessage(channel, component.reviewMessageId ?? null);
      if (pending.correctionRequestId && pending.replacementForRegistrationId) {
        await channel.send(createCorrectionCompletedPayload({ fields, replacementForRegistrationId: pending.replacementForRegistrationId }, guild)).catch(() => null);
      }
    }
    if (pending.correctionRequestId && pending.replacementForRegistrationId) {
      await sendGoalLog(guild, context, `✅ Correção de meta concluída\n\nUsuário: <@${interaction.user.id}>\nRegistro original: ${pending.replacementForRegistrationId}\nNovo registro: ${"entry" in saved ? saved.entry?.id ?? "-" : "-"}\nItem: ${selectedItem.name}\nNova quantidade: ${formatGoalValue(quantityValue)}`, { id: pending.correctionRequestId });
    }
    await refreshFivemGoalRankingPanel(guild, context).catch(() => null);
  } finally {
    pendingFarmItems.delete(lockKey);
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
    const rankingRuntime = await context.api.getFivemGoalRankingRuntime(interaction.guild.id);
    const visible = await visibleRankingMembers(interaction.guild, rankingRuntime);
    await interaction.reply({ ...createGoalRankingPayload(interaction.guild, { ...rankingRuntime, members: visible, totalPlayers: visible.length }, 0), ephemeral: true });
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

async function showGoalSummaryCommand(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const runtime = await context.api.getFivemGoalRankingRuntime(interaction.guild.id);
  const visible = await visibleRankingMembers(interaction.guild, runtime);
  await interaction.editReply(createGoalSummaryPayload(interaction.guild, { ...runtime, members: visible, totalPlayers: visible.length }, 0));
}

async function handleRankingPagination(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const page = Math.max(0, Number(interaction.customId.split(":")[2] ?? 0) || 0);
  const runtime = await context.api.getFivemGoalRankingRuntime(interaction.guild.id);
  const visible = await visibleRankingMembers(interaction.guild, runtime);
  await interaction.update(createGoalRankingPayload(interaction.guild, { ...runtime, members: visible, totalPlayers: visible.length }, page));
}

async function handleSummaryPagination(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const page = Math.max(0, Number(interaction.customId.split(":")[2] ?? 0) || 0);
  const runtime = await context.api.getFivemGoalRankingRuntime(interaction.guild.id);
  const visible = await visibleRankingMembers(interaction.guild, runtime);
  await interaction.update(createGoalSummaryPayload(interaction.guild, { ...runtime, members: visible, totalPlayers: visible.length }, page));
}

export async function refreshFivemGoalRankingPanel(guild: Guild, context: BotContext): Promise<PanelPublishResult> {
  const settings = await context.api.getFivemGoalSettings(guild.id).catch(() => null);
  const runtime = await context.api.getFivemGoalRankingRuntime(guild.id).catch(async (error) => {
    await logGoalPanelPublish(context, guild.id, settings, "ranking_runtime_error", readUnknownError(error), {}, error);
    return null;
  });
  if (!runtime?.settings.rankingChannelId) return { ok: false, skipped: true };
  await logGoalPanelPublish(context, guild.id, settings, "ranking_start", "Iniciando publicação do ranking de farm.", { channelId: runtime.settings.rankingChannelId });
  const visible = await visibleRankingMembers(guild, runtime);
  const nextRuntime = { ...runtime, members: visible, totalPlayers: visible.length };
  const channel = await guild.channels.fetch(runtime.settings.rankingChannelId).catch((error) => {
    void logGoalPanelPublish(context, guild.id, settings, "ranking_channel_fetch_error", readUnknownError(error), { channelId: runtime.settings.rankingChannelId }, error);
    return null;
  });
  if (!channel?.isSendable() || !("messages" in channel)) {
    await logGoalPanelPublish(context, guild.id, settings, "ranking_channel_invalid", "Canal do ranking não encontrado ou não aceita envio de mensagens pelo bot.", { channelId: runtime.settings.rankingChannelId });
    await context.api.updateFivemGoalRankingPanelState({ channelId: null, guildId: guild.id, messageId: null }).catch(() => null);
    return { ok: false, error: "Canal do ranking não encontrado ou não aceita envio de mensagens pelo bot." };
  }
  const payload = createGoalRankingPayload(guild, nextRuntime, 0);
  const existingMessageId = runtime.settings.rankingMessageId ?? null;
  if (existingMessageId) {
    const message = await channel.messages.fetch(existingMessageId).catch(() => null);
    if (message) {
      const edited = await message.edit(payload).catch(async (error) => {
        await logGoalPanelPublish(context, guild.id, settings, "ranking_edit_error", readUnknownError(error), { channelId: channel.id, messageId: existingMessageId }, error);
        return null;
      });
      if (edited) {
        await context.api.updateFivemGoalRankingPanelState({ channelId: channel.id, guildId: guild.id, messageId: edited.id }).catch(() => null);
        await logGoalPanelPublish(context, guild.id, settings, "ranking_updated", "Ranking de farm atualizado no Discord.", { channelId: channel.id, messageId: edited.id });
        return { ok: true, messageId: edited.id };
      }
    }
    await logGoalPanelPublish(context, guild.id, settings, "ranking_old_message_missing", "Mensagem antiga do ranking não encontrada; publicando uma nova.", { channelId: channel.id, messageId: existingMessageId });
  }
  const sent = await channel.send(payload).catch(async (error) => {
    await logGoalPanelPublish(context, guild.id, settings, "ranking_send_error", readUnknownError(error), { channelId: channel.id }, error);
    return null;
  });
  if (sent) {
    await context.api.updateFivemGoalRankingPanelState({ channelId: channel.id, guildId: guild.id, messageId: sent.id }).catch(() => null);
    await logGoalPanelPublish(context, guild.id, settings, "ranking_sent", "Ranking de farm publicado no Discord.", { channelId: channel.id, messageId: sent.id });
    return { ok: true, messageId: sent.id };
  }
  return { ok: false, error: "Não foi possível enviar a mensagem do ranking no canal configurado." };
}

async function visibleRankingMembers(guild: Guild, runtime: FivemGoalRankingRuntime) {
  const rows: FivemGoalRankingRuntime["members"] = [];
  for (const member of runtime.members) {
    const guildMember = await guild.members.fetch(member.userId).catch(() => null);
    if (guildMember) rows.push(member);
  }
  return rows.map((member, index) => ({ ...member, rank: index + 1 }));
}

function createGoalRankingPayload(guild: Guild, runtime: FivemGoalRankingRuntime, page: number) {
  const totalPages = Math.max(1, Math.ceil(runtime.members.length / RANKING_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const rows = runtime.members.slice(safePage * RANKING_PAGE_SIZE, (safePage + 1) * RANKING_PAGE_SIZE);
  const lines = [
    `# ${systemEmojiText("trofeu", guild, guild.client)} RANKING DE FARM`,
    "",
    `${systemEmojiText("trofeu", guild, guild.client)} Página atual: ${safePage + 1}/${totalPages}`,
    `${systemEmojiText("homem", guild, guild.client)} Total de jogadores: ${runtime.totalPlayers}`,
    `${systemEmojiText("caixa", guild, guild.client)} Fonte: farm_logs`,
    "",
    rows.length ? rows.map((member) => rankingMemberLine(member, guild)).join("\n\n") : "Nenhum farm confirmado nesta semana."
  ].join("\n");
  const text = replaceSystemEmojis(lines.slice(0, 3800), guild, guild.client);
  return {
    allowedMentions: { parse: [] as never[] },
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          guild.iconURL({ size: 256 })
            ? { type: 9, components: [{ type: 10, content: text }], accessory: { type: 11, media: { url: guild.iconURL({ size: 256 })! } } }
            : { type: 10, content: text },
          { type: 14, divider: true, spacing: 1 },
          { type: 10, content: "-# *NexTech - Todos os direitos reservados*" }
        ]
      },
      rankingButtons(safePage, totalPages, RANKING_PANEL_PREFIX)
    ],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function createGoalSummaryPayload(guild: Guild, runtime: FivemGoalRankingRuntime, page: number) {
  const totalPages = Math.max(1, Math.ceil(runtime.members.length / RANKING_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const rows = runtime.members.slice(safePage * RANKING_PAGE_SIZE, (safePage + 1) * RANKING_PAGE_SIZE);
  const lines = [
    `# ${systemEmojiText("prancheta", guild, guild.client)} RESUMO DE METAS`,
    "",
    `Página: ${safePage + 1}/${totalPages}`,
    `Período: ${formatBrazilDateTime(new Date(runtime.periodStart))} até ${formatBrazilDateTime(new Date(runtime.periodEnd))}`,
    "",
    rows.length ? rows.map((member) => {
      const percent = Math.min(999, Math.floor((member.total / Math.max(1, member.targetValue)) * 100));
      return `**${member.registeredName}**\nFarm: ${formatGoalValue(member.total)}\nMeta: ${percent}%`;
    }).join("\n\n") : "Nenhum farm confirmado nesta semana."
  ].join("\n");
  return {
    allowedMentions: { parse: [] as never[] },
    components: [
      { type: 17, accent_color: 0x22c55e, components: [{ type: 10, content: replaceSystemEmojis(lines.slice(0, 3900), guild, guild.client) }] },
      rankingButtons(safePage, totalPages, SUMMARY_PANEL_PREFIX)
    ],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function rankingMemberLine(member: FivemGoalRankingRuntime["members"][number], guild: Guild) {
  const medal = member.rank === 1 ? "🥇 " : member.rank === 2 ? "🥈 " : member.rank === 3 ? "🥉 " : "";
  const itemLines = member.items.slice(0, 6).map((item) => {
    const emoji = item.emoji ? renderFarmConfiguredEmoji(item.emoji, guild, "caixa") : farmSystemEmojiText("caixa", guild, guild.client);
    return `${emoji} ${item.name}: ${formatGoalValue(item.quantity)}`;
  });
  return [`${medal}#${member.rank} - ${member.registeredName} - ${formatGoalValue(member.total)} itens`, ...itemLines].join("\n");
}

function rankingButtons(page: number, totalPages: number, prefix: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}:${Math.max(0, page - 1)}`).setEmoji(systemComponentEmoji("voltar")).setLabel("Anterior").setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(`${prefix}:${Math.min(totalPages - 1, page + 1)}`).setEmoji(systemComponentEmoji("visto")).setLabel("Próxima").setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1)
  );
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
function goalItemTypeLabel(type: FivemGoalItem["type"] | null | undefined) {
  return type === "additional" ? "Adicional" : type === "optional" ? "Opcional" : "Obrigatório";
}
function goalPeriodLabel(period: string | null | undefined) {
  return period === "monthly" ? "Mensal" : period === "daily" ? "Diário" : period === "custom" ? "Personalizado" : "Semanal";
}
function weekdayName(day: number) {
  return ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"][day] ?? "Segunda-feira";
}
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

type FarmComponentContext = {
  channelId: string | null;
  correctionRequestId: string | null;
  guildId: string | null;
  itemId: string | null;
  ownerId: string | null;
  reviewMessageId?: string | null;
  sourceMessageId: string;
};

function correctionIdOrNull(value: string | null | undefined) {
  return value && value !== "none" ? value : null;
}

function farmComponentCustomId(action: "register" | "correct", sourceMessageId: string, channelId: string | null, guildId: string | null) {
  return guildId && channelId ? `${PREFIX}:${action}:${guildId}:${channelId}:${sourceMessageId}` : `${PREFIX}:${action}:${sourceMessageId}`;
}

function farmModalCustomId(sourceMessageId: string, itemId: string, ownerId: string, correctionRequestId: string | null, channelId: string | null, guildId: string | null, reviewMessageId: string | null = null) {
  const fullContext = { channelId, correctionRequestId, guildId, itemId, ownerId, reviewMessageId, sourceMessageId };
  const legacyCustomId = `${PREFIX}:modal:${sourceMessageId}:${itemId}:${ownerId}:${correctionRequestId ?? "none"}`;
  if (!reviewMessageId && (!guildId || !channelId || legacyCustomId.length <= 100)) return legacyCustomId;
  return `${PREFIX}:modal_ref:${storeFarmModalContext(fullContext)}`;
}

function parseFarmComponentContext(customId: string): FarmComponentContext {
  const parts = customId.split(":");
  const action = parts[1] ?? "";
  if (action === "modal_ref") {
    return readFarmModalContext(parts[2] ?? "") ?? { channelId: null, correctionRequestId: null, guildId: null, itemId: null, ownerId: null, sourceMessageId: "" };
  }
  if ((action === "register" || action === "correct") && parts.length >= 5) {
    return { channelId: parts[3] ?? null, correctionRequestId: null, guildId: parts[2] ?? null, itemId: null, ownerId: null, sourceMessageId: parts[4] ?? "" };
  }
  if ((action === "register" || action === "correct") && parts.length >= 3) {
    return { channelId: null, correctionRequestId: null, guildId: null, itemId: null, ownerId: null, sourceMessageId: parts[2] ?? "" };
  }
  if (action === "item" && parts.length >= 7) {
    return { channelId: parts[3] ?? null, correctionRequestId: correctionIdOrNull(parts[6]), guildId: parts[2] ?? null, itemId: null, ownerId: parts[5] ?? null, sourceMessageId: parts[4] ?? "" };
  }
  if (action === "item") {
    return { channelId: null, correctionRequestId: correctionIdOrNull(parts[4]), guildId: null, itemId: null, ownerId: parts[3] ?? null, sourceMessageId: parts[2] ?? "" };
  }
  if (action === "modal" && parts.length >= 8) {
    return { channelId: parts[3] ?? null, correctionRequestId: correctionIdOrNull(parts[7]), guildId: parts[2] ?? null, itemId: parts[5] ?? null, ownerId: parts[6] ?? null, sourceMessageId: parts[4] ?? "" };
  }
  if (action === "modal") {
    return { channelId: null, correctionRequestId: correctionIdOrNull(parts[5]), guildId: null, itemId: parts[3] ?? null, ownerId: parts[4] ?? null, sourceMessageId: parts[2] ?? "" };
  }
  return { channelId: null, correctionRequestId: null, guildId: null, itemId: null, ownerId: null, sourceMessageId: "" };
}

function storeFarmModalContext(context: FarmComponentContext) {
  cleanupFarmModalContexts();
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  pendingFarmModalContexts.set(token, { ...context, expiresAt: Date.now() + 15 * 60 * 1000 });
  return token;
}

function readFarmModalContext(token: string) {
  cleanupFarmModalContexts();
  const context = pendingFarmModalContexts.get(token);
  if (!context) return null;
  if (context.expiresAt <= Date.now()) {
    pendingFarmModalContexts.delete(token);
    return null;
  }
  return context;
}

function cleanupFarmModalContexts() {
  const now = Date.now();
  for (const [token, context] of pendingFarmModalContexts) {
    if (context.expiresAt <= now) pendingFarmModalContexts.delete(token);
  }
}

async function resolveFarmGuild(interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction, guildId: string | null) {
  return interaction.guild ?? (guildId ? await interaction.client.guilds.fetch(guildId).catch(() => null) : null);
}

function privateReplyOptions(interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction) {
  return interaction.guild ? { ephemeral: true } : {};
}

type FarmImageContext = {
  attachmentId: string;
  channelId: string;
  correctionRequestId: string | null;
  imageUrl: string;
  metaId: string | null;
  replacementForRegistrationId: string | null;
  sourceMessageId: string;
  userId: string;
};

async function recoverFarmImageContext(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  context: BotContext,
  sourceMessageId: string,
  correctionRequestId: string | null = null,
  guildId: string | null = null,
  channelId: string | null = null
): Promise<FarmImageContext | null> {
  const guild = await resolveFarmGuild(interaction, guildId);
  const sourceChannelId = channelId ?? interaction.channelId ?? "";
  if (!guild || !sourceMessageId || !sourceChannelId) return null;
  const sourceChannel = channelId ? await guild.channels.fetch(sourceChannelId).catch(() => null) : interaction.channel;
  if (!sourceChannel || !("messages" in sourceChannel)) return null;
  const goalChannel = await context.api.getFivemGoalChannelByChannel(sourceChannelId).catch(() => null);
  if (!goalChannel) return null;
  const sourceMessage = await sourceChannel.messages.fetch(sourceMessageId).catch(() => null);
  if (!sourceMessage) return null;
  const settings = await context.api.getFivemGoalSettings(guild.id).catch(() => null);
  const authorized = sourceMessage.author.id === goalChannel.userId || (settings ? await canSubmitGoalImageMessage(sourceMessage, settings) : false);
  if (!authorized) return null;
  const image = sourceMessage.attachments.find(isAllowedGoalImage);
  if (!image) return null;

  const correction = correctionRequestId
    ? await context.api.getPendingFivemGoalCorrections(guild.id, goalChannel.userId, sourceChannelId).then((items) => items.find((item) => item.id === correctionRequestId) ?? null).catch(() => null)
    : null;
  const autoCorrection = correction ?? await context.api.getPendingFivemGoalCorrections(guild.id, goalChannel.userId, sourceChannelId).then((items) => items.length === 1 ? items[0] ?? null : null).catch(() => null);

  return {
    attachmentId: image.id,
    channelId: sourceChannelId,
    correctionRequestId: autoCorrection?.id ?? null,
    imageUrl: image.url,
    metaId: autoCorrection?.originalRegistration?.metaId ?? null,
    replacementForRegistrationId: autoCorrection?.originalRegistrationId ?? null,
    sourceMessageId,
    userId: goalChannel.userId
  };
}

function activeGoalItems(settings: FivemGoalSettings | null | undefined): FivemGoalItem[] {
  return (settings?.items ?? [])
    .filter((item) => item.enabled !== false && item.id && item.name.trim())
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.name.localeCompare(right.name, "pt-BR"));
}

function farmSystemEmojiText(key: SystemEmojiKey, guild: Guild | null, client: Client | null = guild?.client ?? null) {
  const fixed = FIXED_SYSTEM_EMOJI_BY_KEY[key];
  const definition = SYSTEM_EMOJI_BY_KEY.get(key);
  const names = [...new Set([key, fixed?.name, definition?.name, ...(definition?.aliases ?? [])].filter((name): name is string => Boolean(name)))];
  const guildEmoji = guild?.emojis.cache.find((emoji) => Boolean(emoji.name && names.includes(emoji.name) && emoji.available !== false));
  if (guildEmoji) return `<${guildEmoji.animated ? "a" : ""}:${guildEmoji.name}:${guildEmoji.id}>`;
  return systemEmojiText(key, guild, client);
}

function renderFarmConfiguredEmoji(value: string | null | undefined, guild: Guild, fallbackKey: SystemEmojiKey = "caixa") {
  const raw = value?.trim();
  if (!raw) return farmSystemEmojiText(fallbackKey, guild, guild.client);
  const normalized = replaceSystemEmojis(raw, guild, guild.client)
    .replace(/:([a-zA-Z0-9_]{2,64}):/g, (match, alias: string) => isSystemEmojiKey(alias) ? farmSystemEmojiText(alias, guild, guild.client) : match)
    .trim();
  return normalized || farmSystemEmojiText(fallbackKey, guild, guild.client);
}

function goalItemSelectEmoji(item: FivemGoalItem, guild: Guild) {
  const rendered = renderFarmConfiguredEmoji(item.emoji, guild);
  return rendered ? rendered.slice(0, 100) : undefined;
}

export function createImageReviewPayload(userId: string, channelId: string, sourceMessageId: string, _attachmentId: string, _imageUrl: string, _settings: FivemGoalSettings, corrections: FivemGoalCorrectionRequest[] = [], guild: Guild | null = null) {
  const correctionIntro = corrections.length ? "\n\n⚠️ Existe correção pendente. Esta imagem será usada para refazer uma meta solicitada." : "";
  const guildId = guild?.id ?? null;
  const client = guild?.client ?? null;
  const registerCustomId = farmComponentCustomId("register", sourceMessageId, channelId, guildId);
  const correctCustomId = farmComponentCustomId("correct", sourceMessageId, channelId, guildId);

  return {
    allowedMentions: { parse: [] as never[] },
    components: [
      {
        type: 17,
        accent_color: 0x22c55e,
        components: [
          { type: 10, content: replaceSystemEmojis(`## ${farmSystemEmojiText("prancheta_acertos", guild, client)} Registro de Farm\n\n${farmSystemEmojiText("homem", guild, client)} Usuário: <@${userId}>\n${farmSystemEmojiText("interrogacao", guild, client)} Foto recebida. Clique no botão abaixo para registrar os itens.${correctionIntro}`, guild, client) },
          { type: 14, divider: true, spacing: 1 },
          ...(corrections.length > 1 ? [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId(correctCustomId).setPlaceholder("Qual meta você está refazendo?").addOptions(corrections.slice(0, 25).map((item) => ({ description: item.reason.slice(0, 100), label: correctionOptionLabel(item).slice(0, 100), value: item.id })))
          )] : [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(registerCustomId).setEmoji(systemComponentEmoji("prancheta_acertos", guild, client)).setLabel("Registrar Farm").setStyle(ButtonStyle.Primary)
          )])
        ]
      }
    ],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

export function createFarmRegisteredPayload(userId: string, fields: Array<{ id: string; label: string; value: string }>, quantity: number, guild: Guild, itemEmoji?: string | null) {
  const itemLabel = fields.find((field) => /item|tipo|meta/i.test(`${field.id} ${field.label}`))?.value?.trim() || "Farm";
  const client = guild.client;
  const itemIcon = renderFarmConfiguredEmoji(itemEmoji, guild);
  const serverIconUrl = farmRegisteredAccessoryUrl(guild);
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
              `## ${farmSystemEmojiText("visto", guild, client)} Farm registrado`,
              "",
              `${farmSystemEmojiText("homem", guild, client)} **Usuário:** <@${userId}> | ${userId}`,
              "",
              `${farmSystemEmojiText("prancheta", guild, client)} **Resumo**`,
              `- ${itemIcon} ${itemLabel}: ${formatGoalValue(quantity)}`,
              "",
              `**Status:** ${farmSystemEmojiText("visto", guild, client)} Registrado`,
              `${farmSystemEmojiText("relogio", guild, client)} Data: ${formatBrazilDateTime(new Date())}`
            ].join("\n")
          }],
          ...(serverIconUrl ? { accessory: { type: 11, media: { url: serverIconUrl } } } : {})
        },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: "-# *NexTech - Todos os direitos reservados*" }
      ]
    }],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

async function deleteFarmReviewMessage(channel: { messages?: { fetch: (id: string) => Promise<{ delete: () => Promise<unknown> } | null> } }, reviewMessageId: string | null) {
  if (!reviewMessageId || !channel.messages) return;
  const reviewMessage = await channel.messages.fetch(reviewMessageId).catch(() => null);
  await reviewMessage?.delete().catch(() => null);
}

function farmRegisteredAccessoryUrl(guild: Guild) {
  return guild.iconURL({ extension: "png", size: 256 }) ?? guild.client.user?.displayAvatarURL({ extension: "png", size: 256 }) ?? null;
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

export function isAllowedGoalImage(attachment: Attachment) {
  const contentType = attachment.contentType?.split(";")[0]?.toLowerCase() ?? "";
  return ALLOWED_IMAGE_TYPES.has(contentType) || ALLOWED_IMAGE_EXTENSIONS.test(attachment.url);
}

function goalImageTriggerKey(guildId: string, channelId: string, messageId: string, attachment: Attachment) {
  return [guildId, channelId, messageId, attachment.id, attachment.url].join(":");
}

function isGoalImageTriggerProcessed(key: string) {
  cleanupProcessedGoalImageTriggers();
  return processedGoalImageTriggers.has(key);
}

function markGoalImageTriggerProcessed(key: string) {
  cleanupProcessedGoalImageTriggers();
  processedGoalImageTriggers.set(key, Date.now() + 60 * 60 * 1000);
}

function cleanupProcessedGoalImageTriggers() {
  const now = Date.now();
  for (const [key, expiresAt] of processedGoalImageTriggers) {
    if (expiresAt <= now) processedGoalImageTriggers.delete(key);
  }
  if (processedGoalImageTriggers.size <= 1000) return;
  const overflow = processedGoalImageTriggers.size - 1000;
  for (const key of [...processedGoalImageTriggers.keys()].slice(0, overflow)) {
    processedGoalImageTriggers.delete(key);
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

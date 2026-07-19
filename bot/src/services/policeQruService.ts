import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type GuildMember,
  type Interaction,
  type Message,
  type MessageCreateOptions,
  type ModalSubmitInteraction,
  type User
} from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import type { BotCommand, BotContext } from "../types";
import { systemComponentEmoji, systemEmojiText } from "./systemEmojiService";
import type { PoliceQruOfficer, PoliceQruRecord, PoliceQruSettings } from "./apiClient";

const MODULE_ID = "police-qru";
const PREFIX = "police_qru";
const SETTINGS_TTL_MS = 30_000;
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

type QruStep = "officers" | "date" | "bo" | "type" | "vehicle" | "evidence" | "seizures" | "notes" | "confirm";

type QruSession = {
  authorId: string;
  authorName: string;
  boNumber: string | null;
  channelId: string;
  createdAt: number;
  evidenceUrl: string | null;
  guildId: string;
  occurrenceDate: string | null;
  officers: PoliceQruOfficer[];
  recordId: string | null;
  qruType: string | null;
  seizures: string | null;
  settings: PoliceQruSettings;
  step: QruStep;
  notes: string | null;
  vehicle: string | null;
};

const settingsCache = new Map<string, { expiresAt: number; settings: PoliceQruSettings }>();
const sessions = new Map<string, QruSession>();

export const qruCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("qru")
    .setDescription("Sistema de registro de QRU.")
    .addStringOption((option) => option
      .setName("acao")
      .setDescription("Ação desejada.")
      .setRequired(false)
      .addChoices(
        { name: "Publicar painel", value: "painel" },
        { name: "Registrar QRU", value: "registrar" },
        { name: "Perfil individual", value: "perfil" },
        { name: "Pesquisar registros", value: "pesquisar" }
      ))
    .addUserOption((option) => option.setName("usuario").setDescription("Usuário para perfil ou pesquisa.").setRequired(false))
    .addStringOption((option) => option.setName("bo").setDescription("Número do B.O para pesquisa.").setRequired(false))
    .addStringOption((option) => option.setName("data").setDescription("Data da ocorrência para pesquisa.").setRequired(false))
    .addStringOption((option) => option.setName("tipo").setDescription("Tipo da QRU para pesquisa.").setRequired(false)),
  async execute(interaction, context) {
    if (!interaction.guild || !interaction.inCachedGuild()) {
      await interaction.reply({ content: "Este comando só pode ser usado em servidor.", ephemeral: true });
      return;
    }

    const settings = await getSettings(context, interaction.guild.id);
    const member = interaction.member as GuildMember;
    if (!canUseQru(member, settings, false)) {
      await interaction.reply({ content: "❌ Você não possui permissão para utilizar este comando.", ephemeral: true });
      return;
    }

    const action = interaction.options.getString("acao") ?? "painel";
    if (action === "perfil") {
      await showQruProfile(interaction, context);
      return;
    }

    if (action === "pesquisar") {
      await showQruSearch(interaction, context, settings);
      return;
    }

    if (action === "registrar") {
      await openQruChannel(interaction, context, settings);
      return;
    }

    await publishQruPanel(interaction, settings);
  },
  moduleId: MODULE_ID
};

export const rankCommand: BotCommand = rankingCommand("rank");
export const rankingCommandQru: BotCommand = rankingCommand("ranking");

export async function handlePoliceQruInteraction(interaction: Interaction, context: BotContext) {
  if (!isBotModuleEnabled(MODULE_ID)) {
    return false;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith(`${PREFIX}:reject_modal:`)) {
    await handleRejectModal(interaction, context);
    return true;
  }

  if (!interaction.isButton() || !interaction.customId.startsWith(`${PREFIX}:`)) return false;

  if (!interaction.guild || !interaction.inCachedGuild()) {
    await interaction.reply({ content: "Interação inválida.", ephemeral: true });
    return true;
  }

  const [, action] = interaction.customId.split(":");
  const settings = await getSettings(context, interaction.guild.id);
  const member = interaction.member as GuildMember;

  if (action === "open") {
    if (!canUseQru(member, settings, false)) {
      await interaction.reply({ content: "❌ Você não possui permissão para registrar QRU.", ephemeral: true });
      return true;
    }
    await openQruChannel(interaction, context, settings);
    return true;
  }

  if (action === "confirm") {
    await submitQruForApproval(interaction, context);
    return true;
  }

  if (action === "approve") {
    await approveQru(interaction, context);
    return true;
  }

  if (action === "reject") {
    if (!canApproveQru(member, settings)) {
      await interaction.reply({ content: "❌ Você não possui permissão para recusar QRU.", ephemeral: true });
      return true;
    }
    await openRejectModal(interaction);
    return true;
  }

  if (action === "resubmit") {
    await resubmitQru(interaction, context);
    return true;
  }

  if (action === "cancel") {
    await cancelQru(interaction, context);
    return true;
  }

  if (action === "rank_refresh") {
    await interaction.update(rankingPayload(await context.api.getPoliceQruRanking(interaction.guild.id, 20), settings, false, interaction.guild, context.client) as any);
    await rememberRankingPanel(context, interaction.guild.id, interaction.message.channelId, interaction.message.id);
    return true;
  }

  if (action === "rank_full") {
    if (!canUseQru(member, settings, true)) {
      await interaction.reply({ content: "❌ Você não possui permissão para ver o ranking completo.", ephemeral: true });
      return true;
    }
    await openFullRankingChannel(interaction, context, settings);
    return true;
  }

  return false;
}

export async function handlePoliceQruMessage(message: Message, context: BotContext) {
  if (!isBotModuleEnabled(MODULE_ID) || message.author.bot || !message.guild) return false;
  const session = sessions.get(message.channelId);
  if (!session || session.authorId !== message.author.id) return false;

  if (session.step === "officers") {
    const officers = [...message.mentions.users.values()].map(userToOfficer);
    if (!officers.length) {
      await sendStepMessage(message.channel, "Mencione pelo menos um oficial envolvido nesta ocorrência.");
      return true;
    }
    session.officers = officers.some((officer) => officer.id === message.author.id) ? officers : [userToOfficer(message.author), ...officers];
    session.step = "date";
    await sendStepMessage(message.channel, "Informe a DATA da ocorrência.\n\nExemplo: `15/07/2026`");
    return true;
  }

  if (session.step === "date") {
    session.occurrenceDate = clip(message.content, 20);
    session.step = "bo";
    await sendStepMessage(message.channel, "Informe o número do B.O.\n\nExemplo: `BO-14587`");
    return true;
  }

  if (session.step === "bo") {
    session.boNumber = clip(message.content, 80);
    session.step = "type";
    await sendStepMessage(message.channel, "Informe qual foi a QRU.\n\nExemplos: `Roubo`, `Sequestro`, `Tráfico`, `Homicídio`, `Operação`, `Mandado`.");
    return true;
  }

  if (session.step === "type") {
    session.qruType = clip(message.content, 120);
    session.step = "vehicle";
    await sendStepMessage(message.channel, "Informe o veículo usado ou envolvido na QRU.\n\nExemplos: `Moto`, `Sultan RS`, `Viatura`, `Nenhum`.");
    return true;
  }

  if (session.step === "vehicle") {
    session.vehicle = clip(message.content, 120);
    if (!session.vehicle) {
      await sendStepMessage(message.channel, "Informe o veículo usado ou envolvido na QRU. Se não houver veículo, responda `Nenhum`.");
      return true;
    }
    session.step = "evidence";
    await sendStepMessage(message.channel, "Envie o print do B.O. como anexo ou link direto. São aceitas imagens `jpg`, `jpeg`, `png` e `webp`.");
    return true;
  }

  if (session.step === "evidence") {
    const evidenceUrl = resolveEvidenceImageUrl(message);
    if (!evidenceUrl) {
      await sendStepMessage(message.channel, "Envie uma imagem válida do B.O. como anexo ou link direto (`jpg`, `jpeg`, `png` ou `webp`).");
      return true;
    }

    session.evidenceUrl = evidenceUrl;
    session.step = "seizures";
    await sendStepMessage(message.channel, "Informe as apreensões da QRU.\n\nExemplo: `2 armas, 15 munições, R$ 5.000`.\nSe não houver, responda `Nenhuma`.");
    return true;
  }

  if (session.step === "seizures") {
    session.seizures = clip(message.content, 500);
    if (!session.seizures) {
      await sendStepMessage(message.channel, "Informe as apreensões. Se não houver, responda `Nenhuma`.");
      return true;
    }
    session.step = "notes";
    await sendStepMessage(message.channel, "Informe as observações da QRU.\n\nSe não houver, responda `Nenhuma`.");
    return true;
  }

  if (session.step === "notes") {
    session.notes = clip(message.content, 1000);
    if (!session.notes) {
      await sendStepMessage(message.channel, "Informe as observações. Se não houver, responda `Nenhuma`.");
      return true;
    }
    session.step = "confirm";
    if ("send" in message.channel) {
      await message.channel.send(confirmationPayload(session) as any);
    }
    return true;
  }

  return true;
}

export function clearPoliceQruSettingsCache(guildId?: string | null) {
  for (const key of settingsCache.keys()) {
    if (!guildId || key.endsWith(`:${guildId}`)) settingsCache.delete(key);
  }
}

async function publishQruPanel(interaction: ChatInputCommandInteraction, settings: PoliceQruSettings) {
  if (!settings.enabled) {
    await interaction.reply({ content: "❌ O sistema de QRU está desativado.", ephemeral: true });
    return;
  }

  if (!interaction.channel?.isTextBased() || interaction.channel.isDMBased()) {
    await interaction.reply({ content: "Canal inválido para publicar o painel.", ephemeral: true });
    return;
  }

  await interaction.channel.send(qruPanelPayload(settings) as any);
  await interaction.reply({ content: "✅ Painel de QRU publicado.", ephemeral: true });
}

async function openQruChannel(interaction: ButtonInteraction<"cached"> | ChatInputCommandInteraction<"cached">, context: BotContext, settings: PoliceQruSettings) {
  if (!interaction.guild || !interaction.inCachedGuild()) return;
  if (!settings.recordChannelId) {
    await interaction.reply({ content: "❌ Configure o canal de registros antes de usar o QRU.", ephemeral: true });
    return;
  }
  if (!settings.approvalChannelId) {
    await interaction.reply({ content: "❌ Configure o canal de aprovação antes de usar o QRU.", ephemeral: true });
    return;
  }

  const temporaryCategoryId = await resolveTemporaryCategoryId(interaction.guild, settings);
  const channel = await interaction.guild.channels.create({
    name: `qru-${sanitizeChannelName(interaction.user.username)}`,
    parent: temporaryCategoryId ?? undefined,
    permissionOverwrites: [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
      { id: context.client.user!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
      ...(settings.teamRoleId ? [{ id: settings.teamRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }] : [])
    ],
    type: ChannelType.GuildText
  });

  sessions.set(channel.id, {
    authorId: interaction.user.id,
    authorName: displayName(interaction.member as GuildMember, interaction.user),
    boNumber: null,
    channelId: channel.id,
    createdAt: Date.now(),
    evidenceUrl: null,
    guildId: interaction.guild.id,
    occurrenceDate: null,
    officers: [],
    recordId: null,
    qruType: null,
    seizures: null,
    settings,
    step: "officers",
    notes: null,
    vehicle: null
  });

  await context.api.createPoliceQruLog({ action: "qru.channel_created", actorId: interaction.user.id, actorName: interaction.user.username, guildId: interaction.guild.id, metadata: { channelId: channel.id } }).catch(() => null);
  await channel.send(qruIntroPayload(interaction.user, settings) as any);
  await interaction.reply({ content: `✅ Canal criado: ${channel}`, ephemeral: true });
}

async function submitQruForApproval(interaction: ButtonInteraction<"cached">, context: BotContext) {
  const session = sessions.get(interaction.channelId);
  if (!session || session.authorId !== interaction.user.id || !isComplete(session)) {
    await interaction.reply({ content: "Sessão de QRU inválida ou incompleta.", ephemeral: true });
    return;
  }

  const approvalChannel = await interaction.guild?.channels.fetch(session.settings.approvalChannelId!).catch(() => null);
  if (!approvalChannel?.isTextBased() || approvalChannel.isDMBased()) {
    await interaction.reply({ content: "Canal de aprovação inválido.", ephemeral: true });
    return;
  }

  const payload = {
    approvalChannelId: approvalChannel.id,
    authorId: session.authorId,
    authorName: session.authorName,
    boNumber: session.boNumber,
    evidenceUrl: session.evidenceUrl,
    guildId: session.guildId,
    notes: session.notes,
    occurrenceDate: session.occurrenceDate,
    officers: session.officers,
    qruType: session.qruType,
    seizures: session.seizures,
    temporaryChannelId: session.channelId,
    vehicle: session.vehicle
  };
  const record = session.recordId
    ? await context.api.resubmitPoliceQruRecord(session.recordId, payload)
    : await context.api.createPoliceQruRecord(payload);

  session.recordId = record.id;
  const sent = await approvalChannel.send(approvalPayload(record, session.settings) as any);
  const saved = await context.api.updatePoliceQruApprovalMessage(record.id, { approvalChannelId: approvalChannel.id, approvalMessageId: sent.id }).catch(() => record);
  await lockTemporaryChannel(interaction, session);
  await context.api.createPoliceQruLog({ action: record.status === "rejected" ? "qru.resubmitted" : "qru.submitted", actorId: interaction.user.id, actorName: interaction.user.username, guildId: session.guildId, metadata: { channelId: session.channelId }, recordId: saved.id }).catch(() => null);
  await interaction.update(submittedPayload(saved) as any);
}

async function approveQru(interaction: ButtonInteraction<"cached">, context: BotContext) {
  const recordId = interaction.customId.split(":")[2];
  if (!recordId) return;
  const settings = await getSettings(context, interaction.guild.id);
  if (!canApproveQru(interaction.member as GuildMember, settings)) {
    await interaction.reply({ content: "❌ Você não possui permissão para aprovar QRU.", ephemeral: true });
    return;
  }

  if (!settings.recordChannelId) {
    await interaction.reply({ content: "❌ Configure o canal oficial de registros antes de aprovar QRUs.", ephemeral: true });
    return;
  }
  const recordChannel = await interaction.guild.channels.fetch(settings.recordChannelId).catch(() => null);
  if (!recordChannel?.isTextBased() || recordChannel.isDMBased()) {
    await interaction.reply({ content: "❌ Canal oficial de registros inválido.", ephemeral: true });
    return;
  }

  await interaction.deferUpdate();
  let record: PoliceQruRecord;
  try {
    record = await context.api.approvePoliceQruRecord(recordId, { supervisorId: interaction.user.id, supervisorName: displayName(interaction.member as GuildMember, interaction.user) });
  } catch (error) {
    await interaction.followUp({ content: readApiError(error, "Não foi possível aprovar esta QRU."), ephemeral: true });
    return;
  }

  const sent = await recordChannel.send(recordPayload(record, settings) as any);
  await context.api.updatePoliceQruRecordMessage(record.id, { recordChannelId: recordChannel.id, recordMessageId: sent.id }).catch(() => null);

  await interaction.message.edit(approvalPayload(record, settings, "approved") as any).catch(() => null);
  await updateOfficialRankingPanel(context, interaction.guild.id, settings);
  await closeTemporaryQruChannel(interaction, record, settings);
}

async function openRejectModal(interaction: ButtonInteraction<"cached">) {
  const recordId = interaction.customId.split(":")[2];
  if (!recordId) return;
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:reject_modal:${recordId}`)
    .setTitle("Recusar QRU");
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId("reason")
      .setLabel("Motivo da recusa")
      .setMaxLength(1000)
      .setMinLength(3)
      .setRequired(true)
      .setStyle(TextInputStyle.Paragraph)
  ));
  await interaction.showModal(modal);
}

async function handleRejectModal(interaction: ModalSubmitInteraction, context: BotContext) {
  if (!interaction.guild || !interaction.inCachedGuild()) {
    await interaction.reply({ content: "Interação inválida.", ephemeral: true });
    return;
  }
  const recordId = interaction.customId.split(":")[2];
  if (!recordId) return;
  const settings = await getSettings(context, interaction.guild.id);
  if (!canApproveQru(interaction.member as GuildMember, settings)) {
    await interaction.reply({ content: "❌ Você não possui permissão para recusar QRU.", ephemeral: true });
    return;
  }
  const reason = interaction.fields.getTextInputValue("reason");
  let record: PoliceQruRecord;
  try {
    record = await context.api.rejectPoliceQruRecord(recordId, { reason, supervisorId: interaction.user.id, supervisorName: displayName(interaction.member as GuildMember, interaction.user) });
  } catch (error) {
    await interaction.reply({ content: readApiError(error, "Não foi possível recusar esta QRU."), ephemeral: true });
    return;
  }

  await interaction.reply({ content: "QRU recusada e devolvida para correção.", ephemeral: true });
  if (interaction.message) await interaction.message.edit(approvalPayload(record, settings, "rejected") as any).catch(() => null);
  await reopenTemporaryQruChannel(interaction, record, settings, reason);
}

async function resubmitQru(interaction: ButtonInteraction<"cached">, context: BotContext) {
  const recordId = interaction.customId.split(":")[2];
  if (!recordId) return;
  const session = sessions.get(interaction.channelId);
  if (!session || session.authorId !== interaction.user.id || session.recordId !== recordId) {
    await interaction.reply({ content: "Sessão de QRU inválida para reenvio.", ephemeral: true });
    return;
  }
  session.step = "officers";
  session.officers = [];
  session.occurrenceDate = null;
  session.boNumber = null;
  session.qruType = null;
  session.vehicle = null;
  session.evidenceUrl = null;
  session.seizures = null;
  session.notes = null;
  await interaction.update(qruIntroPayload(interaction.user, session.settings) as any);
}

async function cancelQru(interaction: ButtonInteraction<"cached">, context: BotContext) {
  const session = sessions.get(interaction.channelId);
  if (!session || session.authorId !== interaction.user.id) {
    await interaction.reply({ content: "Sessão de QRU inválida.", ephemeral: true });
    return;
  }

  await context.api.createPoliceQruLog({ action: "qru.cancelled", actorId: interaction.user.id, actorName: interaction.user.username, guildId: session.guildId, metadata: { channelId: session.channelId } }).catch(() => null);
  sessions.delete(interaction.channelId);
  await interaction.update(cancelledPayload() as any);
  scheduleChannelDelete(interaction.channel, session.settings.deleteChannelSeconds);
}

async function showQruProfile(interaction: ChatInputCommandInteraction, context: BotContext) {
  const user = interaction.options.getUser("usuario") ?? interaction.user;
  const profile = await context.api.getPoliceQruProfile(interaction.guildId!, user.id);
  await interaction.reply({
    components: [{
      type: 17,
      accent_color: 0x2563eb,
      components: [{ type: 10, content: [
        `# 👮 Perfil QRU — ${escapeMarkdown(user.globalName ?? user.username)}`,
        `**Total de QRUs:** ${profile.total}`,
        `**B.O registrados como autor:** ${profile.registeredBos}`,
        `**Primeira QRU:** ${profile.firstQruAt ? formatDate(profile.firstQruAt) : "-"}`,
        `**Última QRU:** ${profile.lastQruAt ? formatDate(profile.lastQruAt) : "-"}`,
        `**Posição no Ranking:** ${profile.position ? `${profile.position}º` : "-"}`
      ].join("\n") }]
    }],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
  } as any);
}

async function showQruSearch(interaction: ChatInputCommandInteraction, context: BotContext, settings: PoliceQruSettings) {
  const member = interaction.member as GuildMember;
  if (!canUseQru(member, settings, true)) {
    await interaction.reply({ content: "❌ Você não possui permissão para pesquisar QRUs.", ephemeral: true });
    return;
  }
  const user = interaction.options.getUser("usuario");
  const records = await context.api.searchPoliceQruRecords(interaction.guildId!, {
    authorId: null,
    boNumber: interaction.options.getString("bo"),
    occurrenceDate: interaction.options.getString("data"),
    officerId: user?.id,
    qruType: interaction.options.getString("tipo"),
    limit: 10
  });

  await interaction.reply(searchPayload(records, settings) as any);
}

function rankingCommand(name: "rank" | "ranking"): BotCommand {
  return {
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription("Publica rankings do servidor.")
      .addStringOption((option) => option
        .setName("tipo")
        .setDescription("Tipo de ranking.")
        .setRequired(false)
        .addChoices({ name: "QRU", value: "qru" })),
    async execute(interaction, context) {
      if (!interaction.guild || !interaction.inCachedGuild()) {
        await interaction.reply({ content: "Este comando só pode ser usado em servidor.", ephemeral: true });
        return;
      }
      const type = interaction.options.getString("tipo") ?? "qru";
      if (type !== "qru") {
        await interaction.reply({ content: "Ranking não suportado.", ephemeral: true });
        return;
      }
      const settings = await getSettings(context, interaction.guild.id);
      if (!canUseQru(interaction.member as GuildMember, settings, false)) {
        await interaction.reply({ content: "❌ Você não possui permissão para ver o ranking.", ephemeral: true });
        return;
      }
      const ranking = await context.api.getPoliceQruRanking(interaction.guild.id, 20);
      await interaction.reply(rankingPayload(ranking, settings, false, interaction.guild, context.client) as any);
      const message = await interaction.fetchReply().catch(() => null);
      if (message) await rememberRankingPanel(context, interaction.guild.id, message.channelId, message.id);
    },
    moduleId: MODULE_ID
  };
}

async function openFullRankingChannel(interaction: ButtonInteraction<"cached">, context: BotContext, settings: PoliceQruSettings) {
  const ranking = await context.api.getPoliceQruRanking(interaction.guildId!, 500);
  const temporaryCategoryId = await resolveTemporaryCategoryId(interaction.guild!, settings);
  const channel = await interaction.guild!.channels.create({
    name: `ranking-qru-${sanitizeChannelName(interaction.user.username)}`,
    parent: temporaryCategoryId ?? undefined,
    permissionOverwrites: [
      { id: interaction.guild!.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
      { id: context.client.user!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
      ...(settings.teamRoleId ? [{ id: settings.teamRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] }] : [])
    ],
    type: ChannelType.GuildText
  });
  await channel.send(rankingPayload(ranking, settings, true, interaction.guild, context.client) as any);
  scheduleChannelDelete(channel, 300);
  await interaction.reply({ content: `📄 Ranking completo aberto em ${channel}.`, ephemeral: true });
}

async function rememberRankingPanel(context: BotContext, guildId: string, channelId: string | null, messageId: string | null) {
  const settings = await context.api.savePoliceQruSettings(guildId, { rankingChannelId: channelId, rankingMessageId: messageId }).catch(() => null);
  if (settings) settingsCache.set(`${MODULE_ID}:${guildId}`, { expiresAt: Date.now() + SETTINGS_TTL_MS, settings });
}

async function updateOfficialRankingPanel(context: BotContext, guildId: string, fallbackSettings: PoliceQruSettings) {
  const settings = fallbackSettings.rankingChannelId && fallbackSettings.rankingMessageId
    ? fallbackSettings
    : await context.api.getPoliceQruSettings(guildId).catch(() => fallbackSettings);
  if (!settings.rankingChannelId || !settings.rankingMessageId) return;

  const channel = await context.client.channels.fetch(settings.rankingChannelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased() || !("messages" in channel)) return;

  const message = await channel.messages.fetch(settings.rankingMessageId).catch(() => null);
  if (!message) {
    await rememberRankingPanel(context, guildId, null, null).catch(() => null);
    return;
  }

  const ranking = await context.api.getPoliceQruRanking(guildId, 20);
  const guild = context.client.guilds.cache.get(guildId) ?? null;
  await message.edit(rankingPayload(ranking, settings, false, guild, context.client) as any).catch(() => null);
}

async function resolveTemporaryCategoryId(guild: NonNullable<ButtonInteraction<"cached">["guild"]>, settings: PoliceQruSettings) {
  if (!settings.temporaryCategoryId) return null;
  const channel = await guild.channels.fetch(settings.temporaryCategoryId).catch(() => null);
  return channel?.type === ChannelType.GuildCategory ? channel.id : null;
}

function qruPanelPayload(settings: PoliceQruSettings): MessageCreateOptions {
  const components: any[] = [
    { type: 10, content: `# ${clip(settings.panelTitle, 200)}\n${clip(settings.panelDescription, 1200)}` },
  ];
  if (settings.panelImageUrl) {
    components.push({ type: 12, items: [{ media: { url: settings.panelImageUrl }, description: "Imagem do painel de QRU" }] });
  }
  components.push(
    { type: 14, divider: true, spacing: 1 },
    { type: 10, content: qruPanelExplanation() },
    { type: 14, divider: true, spacing: 1 },
    { type: 10, content: `**Iniciar registro**\n${clip(settings.panelMessage, 1200)}` }
  );
  components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:open`).setEmoji("✅").setLabel("Registrar QRU").setStyle(ButtonStyle.Success)
  ));
  return { allowedMentions: { parse: [] }, components: [{ type: 17, accent_color: parseColor(settings.color), components }], flags: MessageFlags.IsComponentsV2 };
}

function qruPanelExplanation() {
  return [
    "## Modo explicativo",
    "**1. Abra o atendimento:** clique em **Registrar QRU** para criar um canal temporário privado.",
    "**2. Informe os dados:** mencione os oficiais envolvidos, a data, o número do B.O., o tipo da QRU, o veículo, as apreensões e as observações.",
    "**3. Envie o comprovante:** anexe a foto ou print do B.O. ou informe um link direto de imagem.",
    "**4. Aguarde aprovação:** ao confirmar, o canal fica bloqueado para o registrante e a QRU vai para análise da supervisão.",
    "**5. Correção:** se for recusada, o acesso ao canal volta para ajustes e reenvio."
  ].join("\n");
}

function qruIntroPayload(user: User, settings: PoliceQruSettings): MessageCreateOptions {
  return {
    components: [{
      type: 17,
      accent_color: parseColor(settings.color),
      components: [{ type: 10, content: `# 🚔 Registro de QRU\n${user}, mencione todos os oficiais envolvidos nesta ocorrência.\n\nExemplo:\n<@${user.id}> <@123456789012345678>` }]
    }],
    flags: MessageFlags.IsComponentsV2
  };
}

function confirmationPayload(session: QruSession): MessageCreateOptions {
  return {
    components: [{
      type: 17,
      accent_color: parseColor(session.settings.color),
      components: [
        { type: 10, content: [
          "# Confirmação da QRU",
          `**📅 Data:** ${escapeMarkdown(session.occurrenceDate ?? "-")}`,
          `**📄 B.O:** \`${escapeInlineCode(session.boNumber ?? "-")}\``,
          `**🚓 QRU:** ${escapeMarkdown(session.qruType ?? "-")}`,
          `**🚗 Veículo:** ${escapeMarkdown(session.vehicle ?? "-")}`,
          `**📦 Apreensões:** ${escapeMarkdown(session.seizures ?? "-")}`,
          `**📝 Observações:** ${escapeMarkdown(session.notes ?? "-")}`,
          `**👮 Oficiais:** ${session.officers.map((officer) => officer.mention).join(" ") || "-"}`
        ].join("\n") },
        { type: 12, items: [{ media: { url: session.evidenceUrl! }, description: "Print do B.O." }] },
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:confirm`).setEmoji("✅").setLabel("Enviar para aprovação").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`${PREFIX}:cancel`).setEmoji("❌").setLabel("Cancelar").setStyle(ButtonStyle.Danger)
        )
      ]
    }],
    flags: MessageFlags.IsComponentsV2
  };
}

function approvalPayload(record: PoliceQruRecord, settings: PoliceQruSettings, state: "pending" | "approved" | "rejected" = "pending"): MessageCreateOptions {
  const disabled = state !== "pending";
  const statusText = state === "approved" ? "Aprovada" : state === "rejected" ? "Recusada" : "Aguardando aprovação";
  return {
    allowedMentions: { parse: [] },
    components: [{
      type: 17,
      accent_color: state === "approved" ? 0x22c55e : state === "rejected" ? 0xef4444 : parseColor(settings.color),
      components: [
        { type: 10, content: [
          "# Sistema de Aprovação de QRU",
          `**Status:** ${statusText}`,
          `**Registrante:** <@${record.authorId}>`,
          `**Data:** ${escapeMarkdown(record.occurrenceDate)}`,
          `**Tipo da QRU:** ${escapeMarkdown(record.qruType)}`,
          `**Oficiais envolvidos:** ${record.officers.map((officer) => officer.mention).join(" ") || "-"}`,
          `**Apreensões:** ${escapeMarkdown(record.seizures ?? "Nenhuma")}`,
          `**Observações:** ${escapeMarkdown(record.notes ?? "Nenhuma")}`,
          `**B.O:** \`${escapeInlineCode(record.boNumber)}\``,
          `**Horário:** ${formatDate(record.createdAt)}`,
          `**ID da ocorrência:** \`${record.id}\``,
          record.rejectionCount ? `**Recusas:** ${record.rejectionCount}` : null
        ].filter(Boolean).join("\n") },
        { type: 12, items: [{ media: { url: record.evidenceUrl }, description: "Imagem do B.O." }] },
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:approve:${record.id}`).setEmoji("🟢").setLabel("Aceitar QRU").setStyle(ButtonStyle.Success).setDisabled(disabled),
          new ButtonBuilder().setCustomId(`${PREFIX}:reject:${record.id}`).setEmoji("🔴").setLabel("Recusar QRU").setStyle(ButtonStyle.Danger).setDisabled(disabled)
        )
      ]
    }],
    flags: MessageFlags.IsComponentsV2
  };
}

function submittedPayload(record: PoliceQruRecord): MessageCreateOptions {
  return {
    components: [{
      type: 17,
      accent_color: 0xf59e0b,
      components: [{ type: 10, content: `# QRU enviada para aprovação\nA ocorrência \`${record.id}\` foi bloqueada para edição e encaminhada aos supervisores.` }]
    }],
    flags: MessageFlags.IsComponentsV2
  };
}

function recordPayload(record: PoliceQruRecord, settings: PoliceQruSettings): MessageCreateOptions {
  const officerMentions = record.officers.map((officer) => officer.mention).join("\n") || "-";
  const mentionUserIds = [...new Set([record.authorId, ...record.officers.map((officer) => officer.id)].filter(Boolean))];
  const headerContent = [
    "# 🚔 REGISTRO DE QRU",
    `**${escapeMarkdown(record.qruType)}** | **B.O:** \`${escapeInlineCode(record.boNumber)}\``,
    `**Registrado por** <@${record.authorId}>  •  **Registrado em** ${formatDate(record.createdAt)}`
  ].join("\n");
  const headerComponent = settings.panelImageUrl
    ? { type: 9, components: [{ type: 10, content: headerContent }], accessory: { type: 11, media: { url: settings.panelImageUrl }, description: "Imagem do painel de QRU" } }
    : { type: 10, content: headerContent };
  return {
    allowedMentions: { users: mentionUserIds },
    components: [{
      type: 17,
      accent_color: parseColor(settings.color),
      components: [
        headerComponent,
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: [
          "### 📅 Data da ocorrência",
          escapeMarkdown(record.occurrenceDate),
          "",
          "### 🚓 QRU",
          escapeMarkdown(record.qruType),
          "",
          "### 🚗 Veículo",
          escapeMarkdown(record.vehicle ?? "Não informado"),
          "",
          "### 📦 Apreensões",
          escapeMarkdown(record.seizures ?? "Nenhuma"),
          "",
          "### 📝 Observações",
          escapeMarkdown(record.notes ?? "Nenhuma"),
          "",
          "### 👮 Oficiais envolvidos",
          officerMentions
        ].join("\n") },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: [
          "### 📄 Comprovante / B.O",
          `\`${escapeInlineCode(record.boNumber)}\``,
          record.evidenceUrl
        ].join("\n") },
        { type: 12, items: [{ media: { url: record.evidenceUrl }, description: "Evidência do B.O." }] },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: `-# ID do registro: ${record.id} • Aprovada por ${record.approvedById ? `<@${record.approvedById}>` : "supervisor"} • ${record.approvedAt ? formatDate(record.approvedAt) : formatDate(record.createdAt)}` }
      ]
    }],
    flags: MessageFlags.IsComponentsV2
  };
}

function rankingPayload(ranking: Awaited<ReturnType<BotContext["api"]["getPoliceQruRanking"]>>, settings: PoliceQruSettings, full: boolean, guild?: NonNullable<ButtonInteraction<"cached">["guild"]> | null, client?: BotContext["client"] | null): MessageCreateOptions {
  const trophy = systemEmojiText("trofeu", guild, client);
  const clock = systemEmojiText("relogio", guild, client);
  const officersIcon = systemEmojiText("homem", guild, client);
  const checklist = systemEmojiText("prancheta_acertos", guild, client);
  const listIcon = systemEmojiText("prancheta", guild, client);
  const visibleRanking = ranking.slice(0, full ? 50 : 10);
  const podium = visibleRanking.slice(0, 3).map((entry) => `${medal(entry.position, guild, client)} <@${entry.officerId}> — **${entry.total} QRUs**`).join("\n") || "Nenhuma QRU registrada.";
  const others = visibleRanking.slice(3).map((entry) => `${systemEmojiText("VORTEX1505360210200049", guild, client)} **${entry.position}º** <@${entry.officerId}> — **${entry.total} QRUs**`).join("\n");
  const totalVisible = visibleRanking.reduce((total, entry) => total + entry.total, 0);
  const updatedAt = Math.floor(Date.now() / 1000);
  return {
    allowedMentions: { parse: [] },
    components: [{
      type: 17,
      accent_color: parseColor(settings.color),
      components: [
        { type: 10, content: [
          `# ${trophy} Ranking de QRUs`,
          full ? "Ranking completo temporário." : "Painel oficial com atualização automática após cada QRU confirmada.",
          "",
          `**${clock} Última atualização:** <t:${updatedAt}:f>`,
          `**${officersIcon} Oficiais listados:** ${visibleRanking.length}`,
          `**${checklist} QRUs no recorte:** ${totalVisible}`,
          "",
          `## ${trophy} Pódio`,
          podium,
          ...(others ? ["", `## ${listIcon} Demais posições`, others] : [])
        ].join("\n") },
        ...(full ? [] : [new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:rank_refresh`).setEmoji(systemComponentEmoji("relogio", guild, client)).setLabel("Atualizar").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`${PREFIX}:rank_full`).setEmoji(systemComponentEmoji("folha", guild, client)).setLabel("Ver Completo").setStyle(ButtonStyle.Primary)
        )])
      ]
    }],
    flags: MessageFlags.IsComponentsV2
  };
}

function searchPayload(records: PoliceQruRecord[], settings: PoliceQruSettings): MessageCreateOptions {
  const rows = records.map((record) => `**${escapeMarkdown(record.boNumber)}** • ${escapeMarkdown(record.qruType)} • ${escapeMarkdown(record.vehicle ?? "Não informado")} • ${escapeMarkdown(record.occurrenceDate)} • ${record.officers.length} oficial(is)`).join("\n");
  return {
    components: [{ type: 17, accent_color: parseColor(settings.color), components: [{ type: 10, content: `# 🔎 Pesquisa de QRUs\n${rows || "Nenhuma ocorrência encontrada."}` }] }],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
  } as any;
}

function successPayload(record: PoliceQruRecord): MessageCreateOptions {
  return { components: [{ type: 17, accent_color: 0x22c55e, components: [{ type: 10, content: `# ✅ QRU registrada\nB.O \`${escapeInlineCode(record.boNumber)}\` enviado para o canal configurado.` }] }], flags: MessageFlags.IsComponentsV2 };
}

function cancelledPayload(): MessageCreateOptions {
  return { components: [{ type: 17, accent_color: 0xef4444, components: [{ type: 10, content: "# ❌ QRU cancelada\nEste canal será removido automaticamente." }] }], flags: MessageFlags.IsComponentsV2 };
}

async function sendStepMessage(channel: Message["channel"], content: string) {
  if (!("send" in channel)) return;
  await channel.send({ components: [{ type: 17, accent_color: 0x2563eb, components: [{ type: 10, content }] }], flags: MessageFlags.IsComponentsV2 } as any);
}

async function sendLog(interaction: ButtonInteraction<"cached">, context: BotContext, settings: PoliceQruSettings, action: string, record: PoliceQruRecord) {
  await context.api.createPoliceQruLog({ action, actorId: interaction.user.id, actorName: interaction.user.username, guildId: record.guildId, recordId: record.id }).catch(() => null);
  if (!settings.logChannelId || !interaction.guild) return;
  const channel = await interaction.guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return;
  await channel.send({ components: [{ type: 17, accent_color: parseColor(settings.color), components: [{ type: 10, content: `# 🚔 QRU registrada\n**B.O:** ${escapeMarkdown(record.boNumber)}\n**QRU:** ${escapeMarkdown(record.qruType)}\n**Veículo:** ${escapeMarkdown(record.vehicle ?? "Não informado")}\n**Autor:** <@${record.authorId}>\n**Oficiais:** ${record.officers.map((officer) => officer.mention).join(" ")}` }] }], flags: MessageFlags.IsComponentsV2 } as any).catch(() => null);
}

async function lockTemporaryChannel(interaction: ButtonInteraction<"cached">, session: QruSession) {
  const channel = interaction.channel;
  if (!channel || channel.isDMBased() || !("permissionOverwrites" in channel)) return;
  await channel.permissionOverwrites.edit(session.authorId, {
    AttachFiles: false,
    ReadMessageHistory: false,
    SendMessages: false,
    ViewChannel: false
  }).catch(() => null);
}

async function reopenTemporaryQruChannel(interaction: ModalSubmitInteraction<"cached">, record: PoliceQruRecord, settings: PoliceQruSettings, reason: string) {
  if (!record.temporaryChannelId) return;
  const channel = await interaction.guild.channels.fetch(record.temporaryChannelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased() || !("permissionOverwrites" in channel)) return;
  await channel.permissionOverwrites.edit(record.authorId, {
    AttachFiles: true,
    ReadMessageHistory: true,
    SendMessages: true,
    ViewChannel: true
  }).catch(() => null);
  sessions.set(channel.id, {
    authorId: record.authorId,
    authorName: record.authorName,
    boNumber: record.boNumber,
    channelId: channel.id,
    createdAt: Date.now(),
    evidenceUrl: record.evidenceUrl,
    guildId: record.guildId,
    notes: record.notes,
    occurrenceDate: record.occurrenceDate,
    officers: record.officers,
    qruType: record.qruType,
    recordId: record.id,
    seizures: record.seizures,
    settings,
    step: "confirm",
    vehicle: record.vehicle
  });
  await channel.send(rejectedCorrectionPayload(interaction.user, reason, record.id) as any).catch(() => null);
}

async function closeTemporaryQruChannel(interaction: ButtonInteraction<"cached">, record: PoliceQruRecord, settings: PoliceQruSettings) {
  if (!record.temporaryChannelId) return;
  const channel = await interaction.guild.channels.fetch(record.temporaryChannelId).catch(() => null);
  if (!channel || channel.isDMBased()) return;
  if ("send" in channel) {
    await channel.send({ components: [{ type: 17, accent_color: 0x22c55e, components: [{ type: 10, content: `# QRU aprovada\nA ocorrência \`${record.id}\` foi aprovada por <@${interaction.user.id}> e enviada ao canal oficial.` }] }], flags: MessageFlags.IsComponentsV2 } as any).catch(() => null);
  }
  sessions.delete(channel.id);
  if ("delete" in channel) scheduleChannelDelete(channel, settings.deleteChannelSeconds);
}

function rejectedCorrectionPayload(supervisor: User, reason: string, recordId: string): MessageCreateOptions {
  return {
    components: [{
      type: 17,
      accent_color: 0xef4444,
      components: [
        { type: 10, content: [
          "# QRU recusada",
          `**Supervisor:** <@${supervisor.id}>`,
          "",
          "**Motivo:**",
          escapeMarkdown(reason),
          "",
          "Corrija as informações solicitadas e clique em **Reenviar QRU**."
        ].join("\n") },
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:resubmit:${recordId}`).setEmoji("🔄").setLabel("Reenviar QRU").setStyle(ButtonStyle.Primary)
        )
      ]
    }],
    flags: MessageFlags.IsComponentsV2
  };
}

async function getSettings(context: BotContext, guildId: string) {
  const key = `${MODULE_ID}:${guildId}`;
  const cached = settingsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.settings;
  const settings = await context.api.getPoliceQruSettings(guildId);
  settingsCache.set(key, { expiresAt: Date.now() + SETTINGS_TTL_MS, settings });
  return settings;
}

function canUseQru(member: GuildMember | null, settings: PoliceQruSettings, supervisor: boolean) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  const roleIds = supervisor ? [...settings.allowedRoleIds, ...settings.supervisorRoleIds] : settings.allowedRoleIds;
  if (!roleIds.length) return true;
  return member.roles.cache.some((role) => roleIds.includes(role.id));
}

function canApproveQru(member: GuildMember | null, settings: PoliceQruSettings) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  if (!settings.supervisorRoleIds.length) return false;
  return member.roles.cache.some((role) => settings.supervisorRoleIds.includes(role.id));
}

function isComplete(session: QruSession): session is QruSession & { boNumber: string; evidenceUrl: string; notes: string; occurrenceDate: string; qruType: string; seizures: string; vehicle: string } {
  return Boolean(session.boNumber && session.evidenceUrl && session.notes && session.occurrenceDate && session.qruType && session.seizures && session.vehicle && session.officers.length);
}

function resolveEvidenceImageUrl(message: Message) {
  const attachment = message.attachments.find((item) => {
    const type = item.contentType?.toLowerCase() ?? "";
    const extension = item.name?.split(".").pop()?.toLowerCase() ?? item.url.split("?")[0]?.split(".").pop()?.toLowerCase() ?? "";
    return (type.startsWith("image/") && IMAGE_EXTENSIONS.has(type.slice("image/".length))) || IMAGE_EXTENSIONS.has(extension);
  });
  return attachment?.url ?? directImageUrlFromText(message.content);
}

function directImageUrlFromText(content: string) {
  const matches = content.match(/https?:\/\/[^\s<>()]+/gi) ?? [];
  for (const match of matches) {
    const url = match.replace(/[.,;!?]+$/g, "");
    if (isDirectImageUrl(url)) return url;
  }
  return null;
}

function isDirectImageUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const extension = url.pathname.split("/").pop()?.split(".").pop()?.toLowerCase() ?? "";
    return IMAGE_EXTENSIONS.has(extension);
  } catch {
    return false;
  }
}

function userToOfficer(user: User): PoliceQruOfficer {
  return { id: user.id, mention: `<@${user.id}>`, name: user.globalName ?? user.username };
}

function displayName(member: GuildMember | null, user: User) {
  return member?.displayName ?? user.globalName ?? user.username;
}

function scheduleChannelDelete(channel: (Pick<NonNullable<Interaction["channel"]>, "isDMBased"> & { delete?: () => Promise<unknown> }) | null, seconds: number) {
  if (!channel || channel.isDMBased()) return;
  const deleteChannel = channel.delete;
  if (!deleteChannel) return;
  windowlessTimeout(() => deleteChannel.call(channel).catch(() => null), Math.max(seconds, 1) * 1000);
}

function windowlessTimeout(callback: () => void, timeoutMs: number) {
  setTimeout(callback, timeoutMs).unref?.();
}

function sanitizeChannelName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "usuario";
}

function medal(position: number, guild?: NonNullable<ButtonInteraction<"cached">["guild"]> | null, client?: BotContext["client"] | null) {
  if (position === 1) return systemEmojiText("CHATBlack_Crown", guild, client);
  if (position === 2) return systemEmojiText("trofeu_alt", guild, client);
  if (position === 3) return systemEmojiText("trofeu", guild, client);
  return `${position}°`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value));
}

function parseColor(value: string) {
  const hex = value.replace("#", "");
  return /^[0-9a-f]{6}$/i.test(hex) ? Number.parseInt(hex, 16) : 0x2563eb;
}

function clip(value: string, maxLength: number) {
  const text = String(value ?? "").trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text;
}

function escapeInlineCode(value: string) {
  return value.replace(/`/g, "'");
}

function escapeMarkdown(value: string) {
  return value.replace(/([\\*_`~|])/g, "\\$1");
}

function readApiError(error: unknown, fallback: string) {
  return (error as any)?.response?.data?.message ?? fallback;
}

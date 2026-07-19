import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  type Interaction,
  type Message,
  type MessageCreateOptions,
  type User
} from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import type { BotCommand, BotContext } from "../types";
import type { PoliceQruOfficer, PoliceQruRecord, PoliceQruSettings } from "./apiClient";

const MODULE_ID = "police-qru";
const PREFIX = "police_qru";
const SETTINGS_TTL_MS = 30_000;
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

type QruStep = "officers" | "date" | "bo" | "type" | "evidence" | "confirm";

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
  qruType: string | null;
  settings: PoliceQruSettings;
  step: QruStep;
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

    await publishQruPanel(interaction, settings);
  },
  moduleId: MODULE_ID
};

export const rankCommand: BotCommand = rankingCommand("rank");
export const rankingCommandQru: BotCommand = rankingCommand("ranking");

export async function handlePoliceQruInteraction(interaction: Interaction, context: BotContext) {
  if (!isBotModuleEnabled(MODULE_ID) || !interaction.isButton() || !interaction.customId.startsWith(`${PREFIX}:`)) {
    return false;
  }

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
    await confirmQru(interaction, context);
    return true;
  }

  if (action === "cancel") {
    await cancelQru(interaction, context);
    return true;
  }

  if (action === "rank_refresh") {
    await interaction.update(rankingPayload(await context.api.getPoliceQruRanking(interaction.guild.id, 20), settings, false) as any);
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
    session.step = "evidence";
    await sendStepMessage(message.channel, "Envie o print do B.O. São aceitas imagens `jpg`, `jpeg`, `png` e `webp`.");
    return true;
  }

  if (session.step === "evidence") {
    const evidenceUrl = imageUrl(message);
    if (!evidenceUrl) {
      await sendStepMessage(message.channel, "Envie uma imagem válida do B.O. (`jpg`, `jpeg`, `png` ou `webp`).");
      return true;
    }

    session.evidenceUrl = evidenceUrl;
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

async function openQruChannel(interaction: ButtonInteraction<"cached">, context: BotContext, settings: PoliceQruSettings) {
  if (!interaction.guild || !interaction.inCachedGuild()) return;
  if (!settings.recordChannelId) {
    await interaction.reply({ content: "❌ Configure o canal de registros antes de usar o QRU.", ephemeral: true });
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
    qruType: null,
    settings,
    step: "officers"
  });

  await context.api.createPoliceQruLog({ action: "qru.channel_created", actorId: interaction.user.id, actorName: interaction.user.username, guildId: interaction.guild.id, metadata: { channelId: channel.id } }).catch(() => null);
  await channel.send(qruIntroPayload(interaction.user, settings) as any);
  await interaction.reply({ content: `✅ Canal criado: ${channel}`, ephemeral: true });
}

async function confirmQru(interaction: ButtonInteraction<"cached">, context: BotContext) {
  const session = sessions.get(interaction.channelId);
  if (!session || session.authorId !== interaction.user.id || !isComplete(session)) {
    await interaction.reply({ content: "Sessão de QRU inválida ou incompleta.", ephemeral: true });
    return;
  }

  const recordChannel = await interaction.guild?.channels.fetch(session.settings.recordChannelId!).catch(() => null);
  if (!recordChannel?.isTextBased() || recordChannel.isDMBased()) {
    await interaction.reply({ content: "Canal de registros inválido.", ephemeral: true });
    return;
  }

  const record = await context.api.createPoliceQruRecord({
    authorId: session.authorId,
    authorName: session.authorName,
    boNumber: session.boNumber,
    evidenceUrl: session.evidenceUrl,
    guildId: session.guildId,
    occurrenceDate: session.occurrenceDate,
    officers: session.officers,
    qruType: session.qruType,
    recordChannelId: session.settings.recordChannelId,
    temporaryChannelId: session.channelId
  });
  const sent = await recordChannel.send(recordPayload(record, session.settings) as any);
  await context.api.updatePoliceQruRecordMessage(record.id, { recordChannelId: recordChannel.id, recordMessageId: sent.id }).catch(() => null);
  await sendLog(interaction, context, session.settings, "qru.confirmed", record);
  await interaction.update(successPayload(record) as any);
  scheduleChannelDelete(interaction.channel, session.settings.deleteChannelSeconds);
  sessions.delete(interaction.channelId);
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
      await interaction.reply(rankingPayload(ranking, settings, false) as any);
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
  await channel.send(rankingPayload(ranking, settings, true) as any);
  scheduleChannelDelete(channel, 300);
  await interaction.reply({ content: `📄 Ranking completo aberto em ${channel}.`, ephemeral: true });
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
    "**2. Informe os dados:** mencione os oficiais envolvidos, a data, o número do B.O. e o tipo da QRU.",
    "**3. Envie o comprovante:** anexe a foto ou print do B.O. para validar o registro.",
    "**4. Revise e confirme:** o sistema salva a QRU, publica no canal configurado e atualiza o ranking automaticamente."
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
          `**👮 Oficiais:** ${session.officers.map((officer) => officer.mention).join(" ") || "-"}`
        ].join("\n") },
        { type: 12, items: [{ media: { url: session.evidenceUrl! }, description: "Print do B.O." }] },
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:confirm`).setEmoji("✅").setLabel("Registrar QRU").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`${PREFIX}:cancel`).setEmoji("❌").setLabel("Cancelar").setStyle(ButtonStyle.Danger)
        )
      ]
    }],
    flags: MessageFlags.IsComponentsV2
  };
}

function recordPayload(record: PoliceQruRecord, settings: PoliceQruSettings): MessageCreateOptions {
  return {
    allowedMentions: { users: record.officers.map((officer) => officer.id) },
    components: [{
      type: 17,
      accent_color: parseColor(settings.color),
      components: [
        { type: 10, content: [
          "# 🚔 REGISTRO DE QRU",
          "## 📅 Data",
          escapeMarkdown(record.occurrenceDate),
          "",
          "## 📄 B.O",
          `\`${escapeInlineCode(record.boNumber)}\``,
          "",
          "## 🚓 QRU",
          escapeMarkdown(record.qruType),
          "",
          "## 👮 Oficiais",
          record.officers.map((officer) => officer.mention).join("\n"),
          "",
          "## Registrado por",
          `<@${record.authorId}>`
        ].join("\n") },
        { type: 14, divider: true, spacing: 1 },
        { type: 12, items: [{ media: { url: record.evidenceUrl }, description: "Evidência do B.O." }] },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: `-# ID do registro: ${record.id} • ${formatDate(record.createdAt)}` }
      ]
    }],
    flags: MessageFlags.IsComponentsV2
  };
}

function rankingPayload(ranking: Awaited<ReturnType<BotContext["api"]["getPoliceQruRanking"]>>, settings: PoliceQruSettings, full: boolean): MessageCreateOptions {
  const lines = ranking.map((entry) => `${medal(entry.position)} ${escapeMarkdown(entry.officerName)} — **${entry.total} QRUs**`).join("\n") || "Nenhuma QRU registrada.";
  return {
    components: [{
      type: 17,
      accent_color: parseColor(settings.color),
      components: [
        { type: 10, content: `# 🏆 Ranking de QRUs\nTop oficiais com mais participações.\n\n${lines}` },
        ...(full ? [] : [new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:rank_refresh`).setEmoji("🔄").setLabel("Atualizar").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`${PREFIX}:rank_full`).setEmoji("📄").setLabel("Ver Completo").setStyle(ButtonStyle.Primary)
        )])
      ]
    }],
    flags: MessageFlags.IsComponentsV2
  };
}

function searchPayload(records: PoliceQruRecord[], settings: PoliceQruSettings): MessageCreateOptions {
  const rows = records.map((record) => `**${escapeMarkdown(record.boNumber)}** • ${escapeMarkdown(record.qruType)} • ${escapeMarkdown(record.occurrenceDate)} • ${record.officers.length} oficial(is)`).join("\n");
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
  await channel.send({ components: [{ type: 17, accent_color: parseColor(settings.color), components: [{ type: 10, content: `# 🚔 QRU registrada\n**B.O:** ${escapeMarkdown(record.boNumber)}\n**QRU:** ${escapeMarkdown(record.qruType)}\n**Autor:** <@${record.authorId}>\n**Oficiais:** ${record.officers.map((officer) => officer.mention).join(" ")}` }] }], flags: MessageFlags.IsComponentsV2 } as any).catch(() => null);
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

function isComplete(session: QruSession): session is QruSession & { boNumber: string; evidenceUrl: string; occurrenceDate: string; qruType: string } {
  return Boolean(session.boNumber && session.evidenceUrl && session.occurrenceDate && session.qruType && session.officers.length);
}

function imageUrl(message: Message) {
  const attachment = message.attachments.find((item) => {
    const type = item.contentType?.toLowerCase() ?? "";
    const extension = item.name?.split(".").pop()?.toLowerCase() ?? item.url.split("?")[0]?.split(".").pop()?.toLowerCase() ?? "";
    return (type.startsWith("image/") && IMAGE_EXTENSIONS.has(type.slice("image/".length))) || IMAGE_EXTENSIONS.has(extension);
  });
  return attachment?.url ?? null;
}

function userToOfficer(user: User): PoliceQruOfficer {
  return { id: user.id, mention: `<@${user.id}>`, name: user.globalName ?? user.username };
}

function displayName(member: GuildMember | null, user: User) {
  return member?.displayName ?? user.globalName ?? user.username;
}

function scheduleChannelDelete(channel: Interaction["channel"], seconds: number) {
  if (!channel || channel.isDMBased()) return;
  if (!("delete" in channel)) return;
  windowlessTimeout(() => channel.delete().catch(() => null), Math.max(seconds, 1) * 1000);
}

function windowlessTimeout(callback: () => void, timeoutMs: number) {
  setTimeout(callback, timeoutMs).unref?.();
}

function sanitizeChannelName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "usuario";
}

function medal(position: number) {
  if (position === 1) return "🥇";
  if (position === 2) return "🥈";
  if (position === 3) return "🥉";
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

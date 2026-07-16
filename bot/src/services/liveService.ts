import {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type Interaction,
  type Presence,
  type Role,
  type RoleSelectMenuInteraction
} from "discord.js";
import type { LiveDetectionSettings } from "./apiClient";
import type { BotCommand, BotContext } from "../types";
import { currentRuntimeBotId } from "../config/env";

const PREFIX = "live-detection";
const ACCENT = 0x22c55e;

type LiveState = {
  startedAt: number;
  title: string | null;
  url: string | null;
};

const settingsCache = new Map<string, LiveDetectionSettings>();
const liveStates = new Map<string, LiveState>();
let serviceStarted = false;

export const livesCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("lives")
    .setDescription("Configura o Sistema Detecta Lives.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  moduleId: "live",
  async execute(interaction, context) {
    await showLivesPanel(interaction, context);
  }
};

export function startLiveDetectionService(client: Client, context: BotContext) {
  if (serviceStarted) {
    void syncCurrentPresences(client, context);
    return;
  }

  serviceStarted = true;
  context.socket.onLiveDetectionSettingsUpdated((settings) => {
    if (!settingsMatchesRuntime(settings.botId ?? null)) return;
    settingsCache.set(settings.guildId, normalizeSettings(settings));
    const guild = client.guilds.cache.get(settings.guildId);
    if (guild) void syncGuildPresences(guild, context);
  });

  void syncCurrentPresences(client, context);
}

export function clearLiveDetectionCache(guildId?: string) {
  if (guildId) {
    settingsCache.delete(guildId);
    for (const key of [...liveStates.keys()]) {
      if (key.startsWith(`${guildId}:`)) liveStates.delete(key);
    }
    return;
  }

  settingsCache.clear();
  liveStates.clear();
}

export async function handleLivesInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.isButton() && !interaction.isRoleSelectMenu() && !interaction.isChannelSelectMenu()) {
    return false;
  }

  if (!interaction.customId.startsWith(`${PREFIX}:`)) {
    return false;
  }

  if (!interaction.guild) {
    await interaction.reply({ content: "Use este painel dentro de um servidor.", ephemeral: true });
    return true;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!canManageLives(member)) {
    await interaction.reply({ content: "Você não possui permissão para configurar este sistema.", ephemeral: true });
    return true;
  }

  const action = interaction.customId.split(":")[1] ?? "";
  const settings = await getSettings(interaction.guild.id, context, true);

  if (interaction.isButton()) {
    await handleLivesButton(interaction, context, action, settings);
    return true;
  }

  if (interaction.isRoleSelectMenu()) {
    await handleRoleSelection(interaction, context, settings);
    return true;
  }

  if (interaction.isChannelSelectMenu()) {
    await handleChannelSelection(interaction, context, settings);
    return true;
  }

  return true;
}

export async function handlePresenceUpdate(context: BotContext, oldPresence: Presence | null, newPresence: Presence) {
  const guild = newPresence.guild ?? oldPresence?.guild ?? null;
  const guildId = guild?.id;
  const userId = newPresence.userId;

  if (!guild || !guildId || !userId) return;

  const settings = await getSettings(guildId, context);
  if (!settings.enabled || !settings.liveRoleId) return;

  const streaming = newPresence.activities.find((activity) => activity.type === ActivityType.Streaming);
  const stateKey = liveKey(guildId, userId);
  const wasStreaming = liveStates.has(stateKey) || context.liveCache.has(stateKey);

  if (streaming && !wasStreaming) {
    context.liveCache.add(stateKey);
    liveStates.set(stateKey, {
      startedAt: Date.now(),
      title: streaming.name ?? null,
      url: streaming.url ?? null
    });
    await applyLiveRole(guild, userId, settings, context, streaming.name ?? null, streaming.url ?? null);
    return;
  }

  if (!streaming && wasStreaming) {
    const previous = liveStates.get(stateKey);
    context.liveCache.delete(stateKey);
    liveStates.delete(stateKey);
    await removeLiveRole(guild, userId, settings, context, previous);
  }
}

async function showLivesPanel(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!canManageLives(member)) {
    await interaction.reply({ content: "Você não possui permissão para configurar este sistema.", ephemeral: true });
    return;
  }

  const settings = await getSettings(interaction.guild.id, context, true);
  await interaction.reply(renderPanel(settings, interaction.guild));
}

async function handleLivesButton(
  interaction: ButtonInteraction,
  context: BotContext,
  action: string,
  settings: LiveDetectionSettings
) {
  if (!interaction.guild) return;

  if (action === "refresh" || action === "status") {
    if (action === "status") await syncGuildPresences(interaction.guild, context);
    const fresh = await getSettings(interaction.guild.id, context, true);
    await interaction.update(renderPanel(fresh, interaction.guild, action === "status" ? "Status verificado e presenças sincronizadas." : null, false));
    return;
  }

  if (action === "test") {
    await interaction.deferReply({ ephemeral: true });
    await sendLog(interaction.guild, settings, "Sistema Detecta Lives", "Teste enviado pelo painel de configuração.", 0xf59e0b);
    await interaction.editReply("Teste enviado para o canal de logs configurado.");
    return;
  }

  if (action === "reset") {
    await context.api.removeLiveDetectionSettings(interaction.guild.id);
    const fresh = await getSettings(interaction.guild.id, context, true);
    await interaction.update(renderPanel(fresh, interaction.guild, "Configuração removida.", false));
    return;
  }

  if (action === "enable" || action === "disable") {
    const next = await context.api.saveLiveDetectionSettings({
      actorId: interaction.user.id,
      enabled: action === "enable",
      guildId: interaction.guild.id,
      liveRoleId: settings.liveRoleId,
      logChannelId: settings.logChannelId
    });
    settingsCache.set(interaction.guild.id, next);
    if (next.enabled) await syncGuildPresences(interaction.guild, context);
    await interaction.update(renderPanel(next, interaction.guild, action === "enable" ? "Sistema ativado." : "Sistema desativado.", false));
    return;
  }

  await interaction.reply({ content: "Ação desconhecida.", ephemeral: true });
}

async function handleRoleSelection(interaction: RoleSelectMenuInteraction, context: BotContext, settings: LiveDetectionSettings) {
  if (!interaction.guild) return;
  const roleId = interaction.values[0] ?? null;
  const next = await context.api.saveLiveDetectionSettings({
    actorId: interaction.user.id,
    enabled: settings.enabled,
    guildId: interaction.guild.id,
    liveRoleId: roleId,
    logChannelId: settings.logChannelId
  });
  settingsCache.set(interaction.guild.id, next);
  await interaction.update(renderPanel(next, interaction.guild, "Cargo de live atualizado.", false));
}

async function handleChannelSelection(interaction: ChannelSelectMenuInteraction, context: BotContext, settings: LiveDetectionSettings) {
  if (!interaction.guild) return;
  const channelId = interaction.values[0] ?? null;
  const next = await context.api.saveLiveDetectionSettings({
    actorId: interaction.user.id,
    enabled: settings.enabled,
    guildId: interaction.guild.id,
    liveRoleId: settings.liveRoleId,
    logChannelId: channelId
  });
  settingsCache.set(interaction.guild.id, next);
  await interaction.update(renderPanel(next, interaction.guild, "Canal de logs atualizado.", false));
}

async function applyLiveRole(guild: Guild, userId: string, settings: LiveDetectionSettings, context: BotContext, title: string | null, url: string | null) {
  const role = settings.liveRoleId ? guild.roles.cache.get(settings.liveRoleId) ?? await guild.roles.fetch(settings.liveRoleId).catch(() => null) : null;
  const member = await guild.members.fetch(userId).catch(() => null);
  const validation = validateRoleOperation(guild, member, role);
  const streamer = member?.displayName ?? userId;

  if (!validation.ok) {
    await logLiveError(guild, settings, streamer, validation.reason, context, "started", userId, title, url);
    return;
  }

  let applied = false;
  if (!member!.roles.cache.has(role!.id)) {
    await member!.roles.add(role!, "Sistema Detecta Lives: live iniciada").then(() => {
      applied = true;
    });
  }

  await context.api.notifyLive({
    guildId: guild.id,
    roleApplied: applied,
    roleId: role!.id,
    streamer,
    title: title ?? undefined,
    type: "started",
    url: url ?? undefined,
    userId
  }).catch(() => undefined);
  await sendLog(guild, settings, "Live iniciada", `${member} iniciou uma transmissão.${applied ? `\nCargo aplicado: ${role}` : ""}${url ? `\n${url}` : ""}`, ACCENT);
}

async function removeLiveRole(guild: Guild, userId: string, settings: LiveDetectionSettings, context: BotContext, previous?: LiveState) {
  const role = settings.liveRoleId ? guild.roles.cache.get(settings.liveRoleId) ?? await guild.roles.fetch(settings.liveRoleId).catch(() => null) : null;
  const member = await guild.members.fetch(userId).catch(() => null);
  const validation = validateRoleOperation(guild, member, role);
  const streamer = member?.displayName ?? userId;
  const durationMs = previous ? Date.now() - previous.startedAt : null;

  if (!validation.ok) {
    await logLiveError(guild, settings, streamer, validation.reason, context, "ended", userId, previous?.title ?? null, previous?.url ?? null);
    return;
  }

  let removed = false;
  if (member!.roles.cache.has(role!.id)) {
    await member!.roles.remove(role!, "Sistema Detecta Lives: live encerrada").then(() => {
      removed = true;
    });
  }

  await context.api.notifyLive({
    durationMs,
    guildId: guild.id,
    roleId: role!.id,
    roleRemoved: removed,
    streamer,
    title: previous?.title ?? undefined,
    type: "ended",
    url: previous?.url ?? undefined,
    userId
  }).catch(() => undefined);
  await sendLog(guild, settings, "Live encerrada", `${member} encerrou a transmissão.${removed ? `\nCargo removido: ${role}` : ""}${durationMs ? `\nDuração: ${formatDuration(durationMs)}` : ""}`, 0xef4444);
}

async function logLiveError(
  guild: Guild,
  settings: LiveDetectionSettings,
  streamer: string,
  reason: string,
  context: BotContext,
  type: "started" | "ended",
  userId: string,
  title: string | null,
  url: string | null
) {
  await context.api.notifyLive({
    error: reason,
    guildId: guild.id,
    roleId: settings.liveRoleId,
    streamer,
    title: title ?? undefined,
    type,
    url: url ?? undefined,
    userId
  }).catch(() => undefined);
  await sendLog(guild, settings, "Erro no Sistema Detecta Lives", `${streamer}: ${reason}`, 0xef4444);
}

function validateRoleOperation(guild: Guild, member: GuildMember | null, role: Role | null) {
  if (!member) return { ok: false, reason: "Não consegui localizar o membro no servidor." };
  if (!role) return { ok: false, reason: "Cargo de live não encontrado." };

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { ok: false, reason: "O bot precisa da permissão Gerenciar Cargos." };
  }

  if (role.managed) return { ok: false, reason: "O cargo configurado é gerenciado por integração e não pode ser aplicado." };
  if (me.roles.highest.comparePositionTo(role) <= 0) {
    return { ok: false, reason: "O cargo de live precisa ficar abaixo do cargo do bot na hierarquia." };
  }

  return { ok: true, reason: "" };
}

async function syncCurrentPresences(client: Client, context: BotContext) {
  await Promise.all(client.guilds.cache.map((guild) => syncGuildPresences(guild, context)));
}

async function syncGuildPresences(guild: Guild, context: BotContext) {
  const settings = await getSettings(guild.id, context);
  if (!settings.enabled || !settings.liveRoleId) return;

  for (const presence of guild.presences.cache.values()) {
    await handlePresenceUpdate(context, null, presence);
  }
}

async function getSettings(guildId: string, context: BotContext, refresh = false) {
  const cached = settingsCache.get(guildId);
  if (cached && !refresh) return cached;

  const settings = await context.api.getLiveDetectionSettings(guildId);
  settingsCache.set(guildId, settings);
  return settings;
}

async function sendLog(guild: Guild, settings: LiveDetectionSettings, title: string, description: string, color: number) {
  if (!settings.logChannelId) return;
  const channel = await guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel || !("send" in channel) || !channel.isTextBased()) return;

  await channel.send({
    components: [{
      type: 17,
      accent_color: color,
      components: [{
        type: 10,
        content: `## ${title}\n${description}\n\nServidor: **${guild.name}**\nData: <t:${Math.floor(Date.now() / 1000)}:F>`
      }]
    }],
    flags: MessageFlags.IsComponentsV2
  }).catch(() => undefined);
}

function renderPanel(settings: LiveDetectionSettings, guild: Guild, feedback?: string | null, ephemeral = true) {
  const roleText = settings.liveRoleId ? `<@&${settings.liveRoleId}>` : "Não configurado";
  const channelText = settings.logChannelId ? `<#${settings.logChannelId}>` : "Não configurado";
  const status = settings.enabled ? "Ativo" : "Desativado";
  const ready = settings.enabled && settings.liveRoleId ? "Pronto para detectar lives." : "Configure um cargo e ative o sistema.";
  const content = [
    "## Sistema Detecta Lives",
    "Detecta automaticamente quando um membro entra em live pelo status do Discord.",
    "",
    `**Status:** ${status}`,
    `**Cargo de live:** ${roleText}`,
    `**Canal de logs:** ${channelText}`,
    `**Servidor:** ${guild.name}`,
    "",
    ready,
    feedback ? `\n${feedback}` : null
  ].filter(Boolean).join("\n");

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(`${PREFIX}:role`)
    .setPlaceholder("Selecione o cargo aplicado durante a live")
    .setMinValues(0)
    .setMaxValues(1);

  if (settings.liveRoleId) roleSelect.setDefaultRoles(settings.liveRoleId);

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(`${PREFIX}:channel`)
    .setPlaceholder("Selecione o canal de logs")
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(0)
    .setMaxValues(1);

  if (settings.logChannelId) channelSelect.setDefaultChannels(settings.logChannelId);

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(settings.enabled ? `${PREFIX}:disable` : `${PREFIX}:enable`)
      .setLabel(settings.enabled ? "Desativar" : "Ativar")
      .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:status`)
      .setLabel("Status")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:test`)
      .setLabel("Testar logs")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!settings.logChannelId),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:reset`)
      .setLabel("Remover")
      .setStyle(ButtonStyle.Danger)
  );

  return {
    components: [{
      type: 17,
      accent_color: ACCENT,
      components: [
        { type: 10, content },
        new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(roleSelect),
        new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(channelSelect),
        buttons
      ]
    }],
    flags: (ephemeral ? MessageFlags.Ephemeral : 0) | MessageFlags.IsComponentsV2
  } as const;
}

function canManageLives(member: GuildMember | null) {
  return Boolean(member?.permissions.has(PermissionFlagsBits.ManageGuild) || member?.permissions.has(PermissionFlagsBits.Administrator));
}

function liveKey(guildId: string, userId: string) {
  return `${guildId}:${userId}`;
}

function settingsMatchesRuntime(botId: string | null) {
  const runtimeBotId = currentRuntimeBotId();
  return !botId || !runtimeBotId || botId === runtimeBotId;
}

function normalizeSettings(settings: Partial<LiveDetectionSettings> & { guildId: string }): LiveDetectionSettings {
  const now = new Date().toISOString();
  return {
    botId: settings.botId ?? null,
    guildId: settings.guildId,
    enabled: Boolean(settings.enabled),
    liveRoleId: settings.liveRoleId ?? null,
    logChannelId: settings.logChannelId ?? null,
    createdAt: settings.createdAt ?? now,
    updatedAt: settings.updatedAt ?? now,
    updatedBy: settings.updatedBy ?? null
  };
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}min ${seconds}s`;
  if (minutes > 0) return `${minutes}min ${seconds}s`;
  return `${seconds}s`;
}

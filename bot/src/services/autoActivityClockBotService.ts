import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type Interaction,
  type ModalSubmitInteraction,
  type Presence,
  type RoleSelectMenuInteraction,
  type TextBasedChannel
} from "discord.js";
import type { AutoActivityClockCity, AutoActivityClockDashboard, AutoActivityClockPanelState, AutoActivityClockRuntime, AutoActivityClockSettings } from "./apiClient";
import type { BotCommand, BotContext } from "../types";

const MODULE_ID = "auto-activity-clock";
const PREFIX = "auto_activity_clock";
const ACCENT = 0xf59e0b;
const RUNTIME_CACHE_TTL_MS = 30_000;
const DASHBOARD_CACHE_TTL_MS = 2_000;
const PANEL_IMAGES_CACHE_TTL_MS = 60_000;
const PANEL_UPDATE_DEBOUNCE_MS = 1_500;
const PRESENCE_RECONCILE_INTERVAL_MS = 60_000;
const DEFAULT_EXIT_CONFIRMATION_SECONDS = 15;
const MIN_EXIT_CONFIRMATION_SECONDS = 10;
const MAX_EXIT_CONFIRMATION_SECONDS = 20;
const PRESENCE_TEXT_LIMIT = 200;
const ACTIVITY_TEXT_FIELDS_LIMIT = 80;
const FIVEM_MARKERS = ["fivem", "five m", "citizenfx", "citizen fx", "cfx re", "cfx", "fxserver"];
const activeCache = new Map<string, string>();
const pendingDetections = new Map<string, { activityName: string; cityId: string; cityName: string; expiresAt: number; timer: NodeJS.Timeout }>();
const pendingClosures = new Map<string, { expiresAt: number; reason: string; statusDiscord: string | null; timer: NodeJS.Timeout }>();
const runtimeCache = new Map<string, { expiresAt: number; promise?: Promise<AutoActivityClockRuntime>; value?: AutoActivityClockRuntime }>();
const dashboardCache = new Map<string, { expiresAt: number; promise?: Promise<AutoActivityClockDashboard>; value?: AutoActivityClockDashboard }>();
const panelStateCache = new Map<string, { expiresAt: number; promise?: Promise<AutoActivityClockPanelState>; value?: AutoActivityClockPanelState }>();
const panelImagesCache = new Map<string, { expiresAt: number; urls: string[] }>();
const panelUpdateTimers = new Map<string, NodeJS.Timeout>();
let presenceReconcileStarted = false;

type ActivityCityMatch = {
  city: AutoActivityClockCity;
  keyword: string;
};

type ActivityAnalysis = {
  activityIndex: number;
  activityName: string;
  cityMatch: ActivityCityMatch | null;
  isFiveM: boolean;
  rawText: string;
  normalizedText: string;
  startedAtMs: number | null;
  textFields: string[];
};

export const pontosCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("pontos")
    .setDescription("Gerencia o Sistema de Ponto Automático.")
    .addSubcommand((subcommand) => subcommand.setName("painel").setDescription("Publica ou atualiza o painel de ponto."))
    .addSubcommand((subcommand) => subcommand.setName("config").setDescription("Abre as configurações rápidas do Ponto Automático.")),
  moduleId: MODULE_ID,
  async execute(interaction, context) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "config") {
      await showConfig(interaction, context);
      return;
    }
    await publishPanel(interaction, context);
  }
};

export const fecharPontoCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("fechar")
    .setDescription("Executa fechamentos administrativos.")
    .addSubcommand((subcommand) => subcommand
      .setName("ponto")
      .setDescription("Fecha o ponto aberto de um usuário.")
      .addUserOption((option) => option.setName("usuario").setDescription("Usuário que terá o ponto fechado.").setRequired(true))
      .addStringOption((option) => option.setName("motivo").setDescription("Motivo do fechamento administrativo.").setRequired(false).setMaxLength(300))),
  moduleId: MODULE_ID,
  async execute(interaction, context) {
    await forceClosePoint(interaction, context);
  }
};

export const consultaPontosCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("consulta")
    .setDescription("Consulta relatórios do Ponto Automático.")
    .addSubcommand((subcommand) => subcommand
      .setName("pontos")
      .setDescription("Consulta pontos semanais, mensais, por usuário ou ranking geral.")
      .addStringOption((option) => option
        .setName("periodo")
        .setDescription("Período do relatório.")
        .addChoices({ name: "Semanal", value: "weekly" }, { name: "Mensal", value: "monthly" })
        .setRequired(false))
      .addUserOption((option) => option.setName("usuario").setDescription("Usuário específico.").setRequired(false))),
  moduleId: MODULE_ID,
  async execute(interaction, context) {
    await showReport(interaction, context);
  }
};

export const pontosAutomaticosCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("pontos-automaticos")
    .setDescription("Mostra o painel do Ponto Automático por atividade.")
    .addUserOption((option) => option.setName("usuario").setDescription("Filtrar um usuário.").setRequired(false)),
  moduleId: MODULE_ID,
  async execute(interaction, context) {
    await showLegacyReport(interaction, context);
  }
};

export function startAutoActivityClockService(client: Client<true>, context: BotContext) {
  context.socket.onAutoActivityClockPanelRefresh((payload) => {
    if (!payload.guildId) return;
    invalidateGuildCaches(payload.guildId);
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) scheduleConfiguredPanelUpdate(guild, context);
  });

  if (presenceReconcileStarted) {
    return;
  }

  presenceReconcileStarted = true;
  const run = () => {
    void reconcileCachedPresences(client, context).catch((error) => {
      console.warn("[auto-activity-clock] falha ao reconciliar presenças:", error instanceof Error ? error.message : error);
    });
  };

  run();
  const interval = setInterval(run, PRESENCE_RECONCILE_INTERVAL_MS);
  interval.unref();
}

async function reconcileCachedPresences(client: Client<true>, context: BotContext) {
  for (const guild of client.guilds.cache.values()) {
    await hydrateActiveCache(guild.id, context);

    for (const presence of guild.presences.cache.values()) {
      await handleAutoActivityPresenceUpdate(context, null, presence);
    }
  }
}

async function hydrateActiveCache(guildId: string, context: BotContext) {
  const panel = await getPanelState(guildId, context).catch(() => null);

  if (!panel?.settings.enabled) {
    return;
  }

  for (const session of panel.active) {
    activeCache.set(`${guildId}:${session.userId}`, session.cityId);
  }
}

export async function handleAutoActivityPresenceUpdate(context: BotContext, oldPresence: Presence | null, newPresence: Presence) {
  const guild = newPresence.guild ?? oldPresence?.guild ?? null;
  if (!guild) return;
  const userId = newPresence.userId;
  const key = `${guild.id}:${userId}`;

  const runtime = await getRuntime(guild.id, context).catch(() => null);
  if (!runtime?.settings.enabled) {
    clearPending(key);
    clearPendingClosure(key);
    return;
  }

  const detection = detectFiveMCityActivity(newPresence, runtime);

  if (!detection?.cityMatch) {
    clearPending(key);
    if (activeCache.has(key)) {
      scheduleAutomaticClose(guild, context, newPresence, runtime, "FiveM/cidade configurada não detectada após atualização da presença.");
    }
    return;
  }

  clearPendingClosure(key);
  const city = detection.cityMatch.city;
  const activityName = presenceStatusText(detection);

  if (activeCache.get(key) === city.id) {
    clearPending(key);
    return;
  }
  if (pendingDetections.get(key)?.cityId === city.id) return;

  const confirmMs = 0;
  const activityElapsedMs = detection.startedAtMs ? Math.max(0, Date.now() - detection.startedAtMs) : 0;
  const delayMs = Math.max(0, confirmMs - activityElapsedMs);
  clearPending(key);

  const open = async () => {
    const pending = pendingDetections.get(key);
    if (!pending || pending.cityId !== city.id) return;
    pendingDetections.delete(key);
    const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
    await context.api.openAutoActivityClockSession(guild.id, {
      cityId: city.id,
      cityName: city.name,
      origin: "automatic",
      statusDiscord: pending.activityName,
      userId,
      username: member?.displayName ?? newPresence.user?.tag ?? userId
    }).then(async () => {
      activeCache.set(key, city.id);
      await sendLog(guild, context, `Entrada automática\nUsuário: <@${userId}>\nCidade: **${city.name}**\nAtividade analisada: **${detection.activityName || "Rich Presence"}**\nCampos analisados: **${detection.textFields.length}**\nPalavra detectada: **${detection.cityMatch?.keyword ?? city.name}**`);
      invalidateDashboardCache(guild.id);
      scheduleConfiguredPanelUpdate(guild, context);
    }).catch(() => undefined);
  };

  const timer = setTimeout(open, delayMs);
  timer.unref();
  pendingDetections.set(key, { activityName, cityId: city.id, cityName: city.name, expiresAt: Date.now() + delayMs, timer });

  if (delayMs === 0) {
    clearTimeout(timer);
    await open();
  }
}

function scheduleAutomaticClose(guild: Guild, context: BotContext, presence: Presence, runtime: AutoActivityClockRuntime, reason: string) {
  const userId = presence.userId;
  const key = `${guild.id}:${userId}`;
  if (pendingClosures.has(key)) return;

  const statusDiscord = summarizePresence(presence);
  const confirmationMs = exitConfirmationMs(runtime);
  const timer = setTimeout(async () => {
    pendingClosures.delete(key);

    if (!activeCache.has(key)) {
      return;
    }

    const latestRuntime = await getRuntime(guild.id, context).catch(() => runtime);
    const latestPresence = guild.presences.cache.get(userId);

    if (latestPresence && detectFiveMCityActivity(latestPresence, latestRuntime)) {
      return;
    }

    activeCache.delete(key);
    await context.api.closeAutoActivityClockSession(guild.id, { reason, statusDiscord, userId }).then(async () => {
      await sendLog(guild, context, `Saída automática\nUsuário: <@${userId}>\nMotivo: ${reason}\nConfirmação: ${Math.round(confirmationMs / 1000)}s sem FiveM/cidade configurada`);
      invalidateDashboardCache(guild.id);
      scheduleConfiguredPanelUpdate(guild, context);
    }).catch(() => undefined);
  }, confirmationMs);

  timer.unref();
  pendingClosures.set(key, { expiresAt: Date.now() + confirmationMs, reason, statusDiscord, timer });
}

export async function handleAutoActivityClockInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.guild || !isAutoActivityInteraction(interaction)) return false;

  if (interaction.isButton()) {
    const action = interaction.customId.split(":")[1] ?? "";
    if (action === "enter") return enterService(interaction, context);
    if (action === "exit") return exitService(interaction, context);
    if (action === "mine") return myTime(interaction, context);
    if (action === "history") return history(interaction, context);
    if (action === "refresh") return refreshPanel(interaction, context);
    if (action === "config") return configHome(interaction, context);
    if (action === "channels") return configChannels(interaction, context);
    if (action === "roles") return configRoles(interaction, context);
    if (action === "cities") return configCityModal(interaction);
    if (action === "back") return configHome(interaction, context);
  }

  if (interaction.isChannelSelectMenu()) return handleChannelSelect(interaction, context);
  if (interaction.isRoleSelectMenu()) return handleRoleSelect(interaction, context);
  if (interaction.isModalSubmit()) return handleCityModal(interaction, context);
  return false;
}

async function publishPanel(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild || !interaction.channel?.isTextBased()) {
    await interaction.reply({ content: "Use este comando em um canal de texto.", ephemeral: true });
    return;
  }
  const dashboard = await getPanelState(interaction.guild.id, context, true);
  if (!dashboard.settings.enabled) {
    await interaction.reply({ content: "O Sistema de Ponto Automático está desativado na dashboard.", ephemeral: true });
    return;
  }
  if (!canManage(interaction.member as GuildMember, dashboard.settings)) {
    await interaction.reply({ content: "Você não possui permissão para gerenciar este módulo.", ephemeral: true });
    return;
  }
  const target = await resolvePanelChannel(interaction.channel, dashboard.settings);
  const message = await (target as TextBasedChannel & { send: (payload: unknown) => Promise<{ id: string }> }).send(await panelPayload(interaction.guild, context, dashboard));
  await context.api.saveAutoActivityClockSettings(interaction.guild.id, { panelChannelId: target.id, panelMessageId: message.id }, interaction.user.id).catch(() => undefined);
  await interaction.reply({ content: `Painel publicado em ${target}.`, ephemeral: true });
}

async function showConfig(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
    return;
  }
  const dashboard = await getDashboard(interaction.guild.id, context);
  if (!canManage(interaction.member as GuildMember, dashboard.settings)) {
    await interaction.reply({ content: "Você não possui permissão para gerenciar este módulo.", ephemeral: true });
    return;
  }
  await interaction.reply({ ...configPayload(dashboard), flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
}

async function forceClosePoint(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
    return;
  }
  const settings = await getRuntime(interaction.guild.id, context).then((runtime) => runtime.settings);
  if (!canForceClose(interaction.member as GuildMember, settings)) {
    await interaction.reply({ content: "Você não possui permissão para gerenciar este módulo.", ephemeral: true });
    return;
  }
  const target = interaction.options.getUser("usuario", true);
  const session = await context.api.closeAutoActivityClockSession(interaction.guild.id, {
    closedBy: interaction.user.id,
    forced: true,
    reason: interaction.options.getString("motivo") ?? "Fechamento administrativo.",
    userId: target.id
  });
  activeCache.delete(`${interaction.guild.id}:${target.id}`);
  await sendLog(interaction.guild, context, `Fechamento administrativo\nAdministrador: <@${interaction.user.id}>\nUsuário: <@${target.id}>\nTempo: **${formatDuration(session.durationMs ?? 0)}**`);
  invalidateDashboardCache(interaction.guild.id);
  scheduleConfiguredPanelUpdate(interaction.guild, context);
  await interaction.reply({ content: `Ponto de ${target} fechado. Tempo total: ${formatDuration(session.durationMs ?? 0)}.`, ephemeral: true });
}

async function enterService(interaction: ButtonInteraction, context: BotContext) {
  const member = interaction.member as GuildMember;
  const dashboard = await getDashboard(interaction.guildId!, context);
  if (!canManualEntry(member, dashboard.settings)) {
    await interaction.reply({ content: "Você não possui permissão para iniciar ponto manual.", ephemeral: true });
    return true;
  }
  const session = await context.api.openAutoActivityClockSession(interaction.guildId!, {
    cityId: "manual",
    cityName: "Manual",
    createdBy: interaction.user.id,
    origin: "manual",
    statusDiscord: "Manual",
    userId: interaction.user.id,
    username: member.displayName
  });
  activeCache.set(`${interaction.guildId}:${interaction.user.id}`, session.cityId);
  await sendLog(interaction.guild!, context, `Entrada manual\nUsuário: <@${interaction.user.id}>`);
  invalidateDashboardCache(interaction.guildId!);
  scheduleConfiguredPanelUpdate(interaction.guild!, context);
  await interaction.reply({ content: `Entrada registrada às <t:${unix(session.startedAt)}:t>.`, ephemeral: true });
  return true;
}

async function exitService(interaction: ButtonInteraction, context: BotContext) {
  const member = interaction.member as GuildMember;
  const settings = await getRuntime(interaction.guildId!, context).then((runtime) => runtime.settings);
  if (!canManualExit(member, settings)) {
    await interaction.reply({ content: "Você não possui permissão para sair manualmente.", ephemeral: true });
    return true;
  }
  const session = await context.api.closeAutoActivityClockSession(interaction.guildId!, { closedBy: interaction.user.id, reason: "Saída manual.", userId: interaction.user.id });
  activeCache.delete(`${interaction.guildId}:${interaction.user.id}`);
  await sendLog(interaction.guild!, context, `Saída manual\nUsuário: <@${interaction.user.id}>\nTempo: **${formatDuration(session.durationMs ?? 0)}**`);
  invalidateDashboardCache(interaction.guildId!);
  scheduleConfiguredPanelUpdate(interaction.guild!, context);
  await interaction.reply({ content: `Saída registrada. Tempo total: ${formatDuration(session.durationMs ?? 0)}.`, ephemeral: true });
  return true;
}

async function myTime(interaction: ButtonInteraction, context: BotContext) {
  const dashboard = await getDashboard(interaction.guildId!, context);
  const active = dashboard.active.find((item) => item.userId === interaction.user.id);
  const history = dashboard.history.filter((item) => item.userId === interaction.user.id);
  const totalMs = history.reduce((total, item) => total + (item.durationMs ?? 0), 0);
  await interaction.reply({ content: active ? `Você está em serviço desde <t:${unix(active.startedAt)}:t> em **${active.cityName}**. Histórico recente: ${formatDuration(totalMs)}.` : `Você não está em serviço. Histórico recente: ${formatDuration(totalMs)}.`, ephemeral: true });
  return true;
}

async function history(interaction: ButtonInteraction, context: BotContext) {
  const dashboard = await getDashboard(interaction.guildId!, context);
  const rows = dashboard.history.slice(0, 10).map((item) => `${item.username}: ${item.cityName} - ${formatDuration(item.durationMs ?? 0)} - <t:${unix(item.startedAt)}:d>`);
  await interaction.reply({ content: rows.length ? rows.join("\n") : "Sem histórico registrado.", ephemeral: true });
  return true;
}

async function refreshPanel(interaction: ButtonInteraction, context: BotContext) {
  const dashboard = await getDashboard(interaction.guildId!, context, true);
  await interaction.update(await panelPayload(interaction.guild!, context, dashboard, false));
  return true;
}

async function configHome(interaction: ButtonInteraction, context: BotContext) {
  const dashboard = await getDashboard(interaction.guildId!, context);
  if (!canManage(interaction.member as GuildMember, dashboard.settings)) {
    await interaction.reply({ content: "Você não possui permissão para gerenciar este módulo.", ephemeral: true });
    return true;
  }
  await interaction.update(configPayload(dashboard));
  return true;
}

async function configChannels(interaction: ButtonInteraction, context: BotContext) {
  const settings = await getRuntime(interaction.guildId!, context).then((runtime) => runtime.settings);
  if (!canManage(interaction.member as GuildMember, settings)) {
    await interaction.reply({ content: "Você não possui permissão para gerenciar este módulo.", ephemeral: true });
    return true;
  }
  await interaction.update({
    components: [{
      type: 17,
      accent_color: ACCENT,
      components: [
        { type: 10, content: "# Configuração de Canais\nSelecione o canal do painel e o canal de logs." },
        new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId(`${PREFIX}:channel:panel`).setPlaceholder("Canal do Painel de Ponto").setChannelTypes(ChannelType.GuildText)),
        new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId(`${PREFIX}:channel:logs`).setPlaceholder("Canal de Logs").setChannelTypes(ChannelType.GuildText)),
        backRow()
      ]
    }]
  });
  return true;
}

async function configRoles(interaction: ButtonInteraction, context: BotContext) {
  const settings = await getRuntime(interaction.guildId!, context).then((runtime) => runtime.settings);
  if (!canManage(interaction.member as GuildMember, settings)) {
    await interaction.reply({ content: "Você não possui permissão para gerenciar este módulo.", ephemeral: true });
    return true;
  }
  await interaction.update({
    components: [{
      type: 17,
      accent_color: ACCENT,
      components: [
        { type: 10, content: "# Configuração de Cargos\nSelecione os cargos autorizados a configurar, fechar pontos e consultar relatórios gerais." },
        new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(new RoleSelectMenuBuilder().setCustomId(`${PREFIX}:roles:admin`).setPlaceholder("Cargos autorizados").setMinValues(1).setMaxValues(20)),
        backRow()
      ]
    }]
  });
  return true;
}

async function configCityModal(interaction: ButtonInteraction) {
  const modal = new ModalBuilder().setCustomId(`${PREFIX}:city_modal`).setTitle("Cadastrar cidade");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("name").setLabel("Nome da cidade").setStyle(TextInputStyle.Short).setMaxLength(80).setRequired(true)),
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("aliases").setLabel("Aliases separados por vírgula").setStyle(TextInputStyle.Paragraph).setMaxLength(600).setRequired(false))
  );
  await interaction.showModal(modal);
  return true;
}

async function handleChannelSelect(interaction: ChannelSelectMenuInteraction, context: BotContext) {
  const action = interaction.customId.split(":")[2] ?? "";
  const settings = await getRuntime(interaction.guildId!, context).then((runtime) => runtime.settings);
  if (!canManage(interaction.member as GuildMember, settings)) {
    await interaction.reply({ content: "Você não possui permissão para gerenciar este módulo.", ephemeral: true });
    return true;
  }
  const channelId = interaction.values[0] ?? null;
  await context.api.saveAutoActivityClockSettings(interaction.guildId!, action === "logs" ? { logChannelId: channelId } : { panelChannelId: channelId }, interaction.user.id);
  invalidateGuildCaches(interaction.guildId!);
  await interaction.reply({ content: "Configuração de canal salva.", ephemeral: true });
  scheduleConfiguredPanelUpdate(interaction.guild!, context);
  return true;
}

async function handleRoleSelect(interaction: RoleSelectMenuInteraction, context: BotContext) {
  const settings = await getRuntime(interaction.guildId!, context).then((runtime) => runtime.settings);
  if (!canManage(interaction.member as GuildMember, settings)) {
    await interaction.reply({ content: "Você não possui permissão para gerenciar este módulo.", ephemeral: true });
    return true;
  }
  const roleIds = interaction.values;
  await context.api.saveAutoActivityClockSettings(interaction.guildId!, {
    adminRoleIds: roleIds,
    cityManagerRoleIds: roleIds,
    closeRoleIds: roleIds,
    exportRoleIds: roleIds,
    historyRoleIds: roleIds,
    updatePanelRoleIds: roleIds,
    viewRoleIds: roleIds
  }, interaction.user.id);
  invalidateGuildCaches(interaction.guildId!);
  await interaction.reply({ content: "Cargos autorizados salvos.", ephemeral: true });
  return true;
}

async function handleCityModal(interaction: ModalSubmitInteraction, context: BotContext) {
  const settings = await getRuntime(interaction.guildId!, context).then((runtime) => runtime.settings);
  if (!canManage(interaction.member as GuildMember, settings)) {
    await interaction.reply({ content: "Você não possui permissão para gerenciar este módulo.", ephemeral: true });
    return true;
  }
  const name = interaction.fields.getTextInputValue("name").trim();
  const aliases = interaction.fields.getTextInputValue("aliases").split(",").map((item) => item.trim()).filter(Boolean);
  await context.api.saveAutoActivityClockCity(interaction.guildId!, { aliases, name }, interaction.user.id);
  invalidateGuildCaches(interaction.guildId!);
  await interaction.reply({ content: `Cidade **${name}** cadastrada.`, ephemeral: true });
  scheduleConfiguredPanelUpdate(interaction.guild!, context);
  return true;
}

async function showReport(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
    return;
  }
  const dashboard = await getDashboard(interaction.guild.id, context);
  const settings = dashboard.settings;
  if (!canReadReports(interaction.member as GuildMember, settings)) {
    await interaction.reply({ content: "Você não possui permissão para consultar relatórios gerais.", ephemeral: true });
    return;
  }
  const period = (interaction.options.getString("periodo") ?? "weekly") as "weekly" | "monthly";
  const user = interaction.options.getUser("usuario");
  const rows = dashboard.reports[period];
  const title = period === "weekly" ? "Relatório Semanal" : "Relatório Mensal";
  const selected = user ? rows.filter((item) => item.userId === user.id) : rows;
  const content = user
    ? individualReport(title, selected[0] ?? null, user.id)
    : generalReport(title, selected);
  await interaction.reply({ components: [{ type: 17, accent_color: ACCENT, components: [{ type: 10, content }] }], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
}

async function showLegacyReport(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
    return;
  }
  const dashboard = await getDashboard(interaction.guild.id, context);
  const user = interaction.options.getUser("usuario");
  const history = user ? dashboard.history.filter((item) => item.userId === user.id) : dashboard.history;
  const totalMs = history.reduce((total, item) => total + (item.durationMs ?? 0), 0);
  await interaction.reply({
    ...autoPanelPayload(dashboard, user ? `Usuário: ${user}\nRegistros: **${history.length}**\nTotal: **${formatDuration(totalMs)}**` : null),
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  });
}

async function updateConfiguredPanel(guild: Guild, context: BotContext) {
  const dashboard = await getPanelState(guild.id, context, true).catch(() => null);
  if (!dashboard?.settings.panelChannelId || !dashboard.settings.panelMessageId || !dashboard.settings.autoUpdatePanel) return;
  const channel = guild.channels.cache.get(dashboard.settings.panelChannelId) ?? await guild.channels.fetch(dashboard.settings.panelChannelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return;
  const message = await channel.messages.fetch(dashboard.settings.panelMessageId).catch(() => null);
  if (!message) return;
  await message.edit(await panelPayload(guild, context, dashboard, false)).catch(() => undefined);
}

async function panelPayload(guild: Guild, context: BotContext, dashboard: AutoActivityClockPanelState, includeFlags = true) {
  const active = dashboard.active.find((item) => item.userId === context.client.user?.id);
  void active;
  const images = await loadPanelImages(guild.id, context);
  const content = renderOperationalPanel(dashboard);
  const payload = {
    components: [{
      type: 17,
      accent_color: ACCENT,
      components: [
        ...images.map((url, index) => ({ type: 12, items: [{ media: { url }, description: `Imagem ${index + 1} do painel de ponto` }] })),
        { type: 10, content },
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:enter`).setLabel("Entrar em Serviço").setEmoji("🟢").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`${PREFIX}:exit`).setLabel("Encerrar Serviço").setEmoji("🔴").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`${PREFIX}:mine`).setLabel("Consultar Pontos").setEmoji("📊").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`${PREFIX}:refresh`).setLabel("Atualizar").setStyle(ButtonStyle.Primary)
        )
      ]
    }]
  };
  return includeFlags ? { ...payload, flags: MessageFlags.IsComponentsV2 as const } : payload;
}

function renderOperationalPanel(dashboard: AutoActivityClockPanelState) {
  const separator = "──────────────────────────────────────────────────────";
  const divider = "══════════════════════════════════════════════════════";
  const activeRows = dashboard.active.slice(0, 16).flatMap((item, index) => {
    const startedAt = Date.parse(item.startedAt);
    const elapsed = Number.isFinite(startedAt) ? Date.now() - startedAt : 0;
    const rows = [
      "",
      `👮 ${item.username || `<@${item.userId}>`}`,
      `🕒 Entrada: ${formatClockTime(item.startedAt)}`,
      `⏱ Tempo em Serviço: ${formatDurationLong(elapsed)}`,
      ""
    ];

    if (index < Math.min(dashboard.active.length, 16) - 1) {
      rows.push(separator);
    }

    return rows;
  });
  const overflow = dashboard.active.length > 16
    ? ["", `+ ${dashboard.active.length - 16} policial(is) em serviço não exibidos nesta página.`, ""]
    : [];
  const activeContent = activeRows.length ? activeRows.join("\n") : "\nNenhum policial em serviço no momento.\n";

  return [
    "```",
    "╔════════════════════════════════════════════════════╗",
    "                 🚔 POLICIAIS EM SERVIÇO",
    "            Central Operacional • Tempo Real",
    divider,
    "",
    `🟢 Em Serviço Agora: ${dashboard.active.length} ${dashboard.active.length === 1 ? "Policial" : "Policiais"}`,
    "",
    divider,
    activeContent,
    ...overflow,
    divider,
    "",
    "🟢 Entrar em Serviço",
    "🔴 Encerrar Serviço",
    "",
    "╚════════════════════════════════════════════════════╝",
    "```"
  ].join("\n");
}

function configPayload(dashboard: AutoActivityClockDashboard) {
  return {
    components: [{
      type: 17,
      accent_color: ACCENT,
      components: [
        { type: 10, content: `# Configurações\nStatus: **${dashboard.settings.enabled ? "Ativado" : "Desativado"}**\nCanal do painel: ${dashboard.settings.panelChannelId ? `<#${dashboard.settings.panelChannelId}>` : "Não configurado"}\nCanal de logs: ${dashboard.settings.logChannelId ? `<#${dashboard.settings.logChannelId}>` : "Não configurado"}\nCidades monitoradas: **${dashboard.cities.length}**` },
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:channels`).setLabel("Configuração de canais").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`${PREFIX}:roles`).setLabel("Configuração de cargos").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`${PREFIX}:cities`).setLabel("Cadastrar cidades").setStyle(ButtonStyle.Secondary)
        )
      ]
    }]
  };
}

function autoPanelPayload(dashboard: AutoActivityClockDashboard, extra: string | null) {
  return {
    components: [{
      type: 17,
      accent_color: ACCENT,
      components: [{
        type: 10,
        content: `${renderOperationalPanel(dashboard)}${extra ? `\n\n${extra}` : ""}`
      }]
    }]
  };
}

async function getRuntime(guildId: string, context: BotContext) {
  const now = Date.now();
  const cached = runtimeCache.get(guildId);
  if (cached?.value && cached.expiresAt > now) return cached.value;
  if (cached?.promise) return cached.promise;

  const promise = context.api.getAutoActivityClockRuntime(guildId)
    .then((value) => {
      runtimeCache.set(guildId, { expiresAt: Date.now() + RUNTIME_CACHE_TTL_MS, value });
      return value;
    })
    .finally(() => {
      const current = runtimeCache.get(guildId);
      if (current?.promise === promise) {
        runtimeCache.set(guildId, current.value
          ? { expiresAt: current.expiresAt, value: current.value }
          : { expiresAt: 0 });
      }
    });

  runtimeCache.set(guildId, { expiresAt: now + RUNTIME_CACHE_TTL_MS, promise, value: cached?.value });
  return promise;
}

async function getDashboard(guildId: string, context: BotContext, fresh = false) {
  const now = Date.now();
  const cached = dashboardCache.get(guildId);
  if (!fresh && cached?.value && cached.expiresAt > now) return cached.value;
  if (!fresh && cached?.promise) return cached.promise;

  const promise = context.api.getAutoActivityClockDashboard(guildId)
    .then((value) => {
      dashboardCache.set(guildId, { expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS, value });
      return value;
    })
    .finally(() => {
      const current = dashboardCache.get(guildId);
      if (current?.promise === promise) {
        dashboardCache.set(guildId, current.value
          ? { expiresAt: current.expiresAt, value: current.value }
          : { expiresAt: 0 });
      }
    });

  dashboardCache.set(guildId, { expiresAt: now + DASHBOARD_CACHE_TTL_MS, promise, value: fresh ? undefined : cached?.value });
  return promise;
}

async function getPanelState(guildId: string, context: BotContext, fresh = false) {
  const now = Date.now();
  const cached = panelStateCache.get(guildId);
  if (!fresh && cached?.value && cached.expiresAt > now) return cached.value;
  if (!fresh && cached?.promise) return cached.promise;

  const promise = context.api.getAutoActivityClockPanelState(guildId)
    .then((value) => {
      panelStateCache.set(guildId, { expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS, value });
      return value;
    })
    .finally(() => {
      const current = panelStateCache.get(guildId);
      if (current?.promise === promise) {
        panelStateCache.set(guildId, current.value
          ? { expiresAt: current.expiresAt, value: current.value }
          : { expiresAt: 0 });
      }
    });

  panelStateCache.set(guildId, { expiresAt: now + DASHBOARD_CACHE_TTL_MS, promise, value: fresh ? undefined : cached?.value });
  return promise;
}

function scheduleConfiguredPanelUpdate(guild: Guild, context: BotContext) {
  const current = panelUpdateTimers.get(guild.id);
  if (current) clearTimeout(current);
  const timer = setTimeout(() => {
    panelUpdateTimers.delete(guild.id);
    void updateConfiguredPanel(guild, context);
  }, PANEL_UPDATE_DEBOUNCE_MS);
  timer.unref();
  panelUpdateTimers.set(guild.id, timer);
}

function invalidateDashboardCache(guildId: string) {
  dashboardCache.delete(guildId);
  panelStateCache.delete(guildId);
}

function invalidateGuildCaches(guildId: string) {
  runtimeCache.delete(guildId);
  dashboardCache.delete(guildId);
  panelStateCache.delete(guildId);
  panelImagesCache.delete(guildId);
}

function individualReport(title: string, item: AutoActivityClockDashboard["reports"]["weekly"][number] | null, userId: string) {
  if (!item) return `# ${title}\nUsuário: <@${userId}>\nSem pontos fechados no período.`;
  return `# ${title}\nUsuário: <@${item.userId}>\nHoras trabalhadas: **${formatDuration(item.totalDurationMs)}**\nQuantidade de entradas: **${item.entries}**\nÚltimo acesso: ${item.lastAccessAt ? `<t:${unix(item.lastAccessAt)}:R>` : "-"}\nDias sem logar: **${item.daysWithoutLogin ?? "-"}**\nMeta: **${formatDuration(item.weeklyGoalMs)}**\nStatus: **${metaStatus(item.metaStatus)}**`;
}

function generalReport(title: string, rows: AutoActivityClockDashboard["reports"]["weekly"]) {
  const ranking = rows.slice(0, 10).map((item, index) => `${index + 1}. <@${item.userId}> - Horas: **${formatDuration(item.totalDurationMs)}**`);
  return `# ${title}\nRanking de atividade\n\n${ranking.length ? ranking.join("\n") : "Sem pontos fechados no período."}`;
}

async function loadPanelImages(guildId: string, context: BotContext) {
  const cached = panelImagesCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.urls;
  const urls: string[] = [];
  for (let index = 1; index <= 10; index += 1) {
    const panelId = index === 1 ? "auto-activity-clock" : `auto-activity-clock-banner-${index}`;
    const visual = await context.api.getPanelVisualSettings(guildId, panelId).catch(() => null);
    if (visual?.imageEnabled && visual.imageUrl) urls.push(visual.imageUrl);
  }
  panelImagesCache.set(guildId, { expiresAt: Date.now() + PANEL_IMAGES_CACHE_TTL_MS, urls });
  return urls;
}

async function sendLog(guild: Guild, context: BotContext, content: string) {
  const settings = await getRuntime(guild.id, context).then((runtime) => runtime.settings).catch(() => null);
  if (!settings?.logChannelId) return;
  const channel = guild.channels.cache.get(settings.logChannelId) ?? await guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return;
  await channel.send({ components: [{ type: 17, accent_color: ACCENT, components: [{ type: 10, content: `# Log do Ponto Automático\n${content}\nData: <t:${Math.floor(Date.now() / 1000)}:F>` }] }], flags: MessageFlags.IsComponentsV2 }).catch(() => undefined);
}

function isAutoActivityInteraction(interaction: Interaction) {
  if (interaction.isButton() || interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu() || interaction.isModalSubmit()) {
    return interaction.customId.startsWith(`${PREFIX}:`);
  }
  return false;
}

function backRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:back`).setLabel("Voltar").setStyle(ButtonStyle.Secondary));
}

async function resolvePanelChannel(current: TextBasedChannel, settings: AutoActivityClockSettings) {
  if (!settings.panelChannelId || !("guild" in current)) return current;
  const channel = await current.guild.channels.fetch(settings.panelChannelId).catch(() => null);
  return channel?.isTextBased() ? channel : current;
}

function canManage(member: GuildMember, settings: AutoActivityClockSettings) {
  return member.permissions.has(PermissionFlagsBits.Administrator) || hasAny(member, [...settings.adminRoleIds, ...settings.cityManagerRoleIds, ...settings.updatePanelRoleIds]);
}
function canForceClose(member: GuildMember, settings: AutoActivityClockSettings) {
  return member.permissions.has(PermissionFlagsBits.Administrator) || hasAny(member, [...settings.adminRoleIds, ...settings.closeRoleIds]);
}
function canManualEntry(member: GuildMember, settings: AutoActivityClockSettings) {
  return settings.manualEntryRoleIds.length === 0 || member.permissions.has(PermissionFlagsBits.Administrator) || hasAny(member, [...settings.adminRoleIds, ...settings.manualEntryRoleIds]);
}
function canManualExit(member: GuildMember, settings: AutoActivityClockSettings) {
  return settings.manualExitRoleIds.length === 0 || member.permissions.has(PermissionFlagsBits.Administrator) || hasAny(member, [...settings.adminRoleIds, ...settings.manualExitRoleIds]);
}
function canReadReports(member: GuildMember, settings: AutoActivityClockSettings) {
  return member.permissions.has(PermissionFlagsBits.Administrator) || hasAny(member, [...settings.adminRoleIds, ...settings.historyRoleIds, ...settings.exportRoleIds, ...settings.viewRoleIds]);
}
function hasAny(member: GuildMember, roleIds: string[]) { return roleIds.some((id) => member.roles.cache.has(id)); }
function detectFiveMCityActivity(presence: Presence, runtime: AutoActivityClockRuntime) {
  const analyses = presence.activities.map((activity, index): ActivityAnalysis => {
    const textFields = collectPresenceActivityText(activity);
    const rawText = textFields.join(" ");
    const normalizedText = normalize(rawText);
    const cityMatch = matchRuntimeCityFromText(runtime, normalizedText);
    const analysis: ActivityAnalysis = {
      activityIndex: index,
      activityName: String(activity.name ?? "").trim(),
      cityMatch,
      isFiveM: false,
      rawText,
      normalizedText,
      startedAtMs: activityStartedAtMs(activity),
      textFields
    };
    analysis.isFiveM = isFiveMActivity(activity, analysis);
    return analysis;
  });

  return analyses.find((analysis) => analysis.isFiveM && analysis.cityMatch) ?? null;
}

function collectPresenceActivityText(activity: Presence["activities"][number]) {
  const activityLike = activity as unknown as Record<string, unknown>;
  const fields: string[] = [];

  collectActivityText([
    activity.name,
    activity.state,
    activity.details,
    activity.url,
    activity.applicationId,
    activity.timestamps,
    activity.assets,
    activity.buttons,
    activity.emoji,
    activityLike.application,
    activityLike.applicationName,
    activityLike.metadata,
    activityLike.party,
    activityLike.secrets,
    activityLike.syncId
  ], fields, new WeakSet<object>());
  collectActivityText(activity, fields, new WeakSet<object>());

  return uniqueText(fields).slice(0, ACTIVITY_TEXT_FIELDS_LIMIT);
}

function collectActivityText(value: unknown, output: string[], seen: WeakSet<object>, depth = 0) {
  if (output.length >= ACTIVITY_TEXT_FIELDS_LIMIT || value === null || value === undefined || depth > 5) return;

  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    const text = String(value).trim();
    if (text) output.push(text);
    return;
  }

  if (value instanceof Date) {
    output.push(value.toISOString());
    return;
  }

  if (typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) collectActivityText(item, output, seen, depth + 1);
    return;
  }

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "client" || key === "guild" || key === "user") continue;
    collectActivityText(item, output, seen, depth + 1);
  }
}

function matchRuntimeCityFromText(runtime: AutoActivityClockRuntime, normalizedText: string): ActivityCityMatch | null {
  const compactText = compact(normalizedText);

  for (const city of runtime.cities) {
    for (const keyword of [city.name, ...city.aliases]) {
      const normalizedKeyword = normalize(keyword);
      if (!normalizedKeyword) continue;
      if (normalizedText.includes(normalizedKeyword) || compactText.includes(compact(normalizedKeyword))) {
        return { city, keyword };
      }
    }
  }

  return null;
}

function isFiveMActivity(activity: Presence["activities"][number], analysis: ActivityAnalysis) {
  const compactText = compact(analysis.normalizedText);
  const hasFiveMMarker = FIVEM_MARKERS.some((marker) => {
    const normalizedMarker = normalize(marker);
    return analysis.normalizedText.includes(normalizedMarker) || compactText.includes(compact(normalizedMarker));
  });

  if (hasFiveMMarker) return true;

  const activityLike = activity as unknown as Record<string, unknown>;
  const hasRichPresenceSignals = Boolean(
    activity.applicationId ||
    activity.assets ||
    activity.buttons?.length ||
    activityLike.application ||
    activityLike.metadata ||
    activityLike.party ||
    activityLike.secrets
  );

  return Boolean(analysis.cityMatch && hasRichPresenceSignals);
}
function activityStartedAtMs(activity: Presence["activities"][number]) {
  const start = activity.timestamps?.start;

  if (!start) {
    return null;
  }

  const value = start instanceof Date ? start.getTime() : Number(start);
  return Number.isFinite(value) ? value : null;
}
function presenceStatusText(analysis: ActivityAnalysis) {
  return trimPresenceText(analysis.rawText || analysis.activityName || "FiveM");
}
function summarizePresence(presence: Presence) {
  const text = presence.activities.map((activity) => collectPresenceActivityText(activity).join(" ")).filter(Boolean).join(" | ");
  return text ? trimPresenceText(text) : null;
}
function exitConfirmationMs(runtime: AutoActivityClockRuntime) {
  const seconds = Number.isFinite(runtime.settings.confirmMinutes)
    ? runtime.settings.confirmMinutes
    : DEFAULT_EXIT_CONFIRMATION_SECONDS;
  return Math.max(MIN_EXIT_CONFIRMATION_SECONDS, Math.min(MAX_EXIT_CONFIRMATION_SECONDS, seconds)) * 1000;
}
function trimPresenceText(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > PRESENCE_TEXT_LIMIT ? `${normalized.slice(0, PRESENCE_TEXT_LIMIT - 3)}...` : normalized;
}
function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function compact(value: string) {
  return value.replace(/\s+/g, "");
}
function uniqueText(values: string[]) {
  return [...new Set(values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean))];
}
function clearPending(key: string) {
  const pending = pendingDetections.get(key);
  if (pending) clearTimeout(pending.timer);
  pendingDetections.delete(key);
}
function clearPendingClosure(key: string) {
  const pending = pendingClosures.get(key);
  if (pending) clearTimeout(pending.timer);
  pendingClosures.delete(key);
}
function unix(value: string) { return Math.floor(Date.parse(value) / 1000); }
function formatDuration(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h ${rest}m` : `${rest}m`;
}
function formatDurationLong(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}h ${String(rest).padStart(2, "0")}min`;
}
function formatClockTime(value: string) {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "--:--";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo"
  }).format(date);
}
function metaStatus(status: "above" | "below" | "met") {
  if (status === "above") return "Acima da meta";
  if (status === "met") return "Meta atingida";
  return "Abaixo da meta";
}

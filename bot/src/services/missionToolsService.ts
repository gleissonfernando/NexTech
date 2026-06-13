import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  type ButtonInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type Interaction
} from "discord.js";
import { env, isBotModuleEnabled } from "../config/env";
import type { BotContext } from "../types";
import type { MissionToolMission, MissionToolsSettings } from "./apiClient";
import { assertPanelChannelPermissions, pinPanelMessage } from "./panelDeliveryService";

const MODULE_ID = "mission-tools";
const MISSION_PREFIX = "mission_tools";
const JOIN_PREFIX = `${MISSION_PREFIX}:join`;
const LEAVE_PREFIX = `${MISSION_PREFIX}:leave`;
const START_PREFIX = `${MISSION_PREFIX}:start`;
const COMPLETE_PREFIX = `${MISSION_PREFIX}:complete`;
const CANCEL_PREFIX = `${MISSION_PREFIX}:cancel`;
const PANEL_REQUEST_CHECK_INTERVAL_MS = 15_000;

let serviceStarted = false;
let panelRequestCheckRunning = false;
const handledPanelRequests = new Map<string, string>();
const panelPublishPromises = new Map<string, Promise<MissionToolsSettings>>();
const panelRequestErrorLogAt = new Map<string, number>();

export function startMissionToolsService(client: Client, context: BotContext) {
  if (!isBotModuleEnabled(MODULE_ID) || serviceStarted) {
    return;
  }

  serviceStarted = true;

  context.socket.onMissionToolsSettingsUpdated((payload) => {
    if (!isPayloadForThisBot(payload.botId)) {
      return;
    }

    console.log(`[mission-tools] configuracao atualizada para ${payload.guildId}.`);
  });

  context.socket.onMissionToolsPanelPublish((payload) => {
    if (!isPayloadForThisBot(payload.botId)) {
      return;
    }

    void publishRequestedMissionToolsPanel(client, context, payload.guildId).catch((error) => {
      console.error(`[mission-tools] falha ao publicar painel em ${payload.guildId}:`, errorMessage(error));
    });
  });

  context.socket.onMissionToolsMissionUpdated((payload) => {
    if (!isPayloadForThisBot(payload.botId) || !isMissionPayload(payload.mission)) {
      return;
    }

    void refreshMissionToolsPanel(client, context, payload.guildId).catch((error) => {
      console.warn(`[mission-tools] falha ao atualizar painel em ${payload.guildId}:`, errorMessage(error));
    });
  });

  void context.api.getActiveMissionToolsConfigs()
    .then((configs) => console.log(`[mission-tools] ${configs.length} configuracao(oes) ativa(s) carregada(s).`))
    .catch((error) => console.warn("[mission-tools] nao foi possivel carregar configuracoes:", errorMessage(error)));

  void processPendingMissionToolsPanelRequests(client, context);
  const interval = setInterval(() => {
    void processPendingMissionToolsPanelRequests(client, context);
  }, PANEL_REQUEST_CHECK_INTERVAL_MS);

  interval.unref();
}

export async function handleMissionToolsInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.isButton()) {
    return false;
  }

  if (!interaction.customId.startsWith(`${MISSION_PREFIX}:`)) {
    return false;
  }

  if (!isBotModuleEnabled(MODULE_ID)) {
    await replySafely(interaction, "O Mission Tools nao foi liberado para este bot na dashboard.");
    return true;
  }

  if (!interaction.guild) {
    await replySafely(interaction, "Este recurso esta disponivel apenas em servidores.");
    return true;
  }

  await handleMissionButton(interaction, context);
  return true;
}

export async function handleMissionPanelPublishCommand(interaction: ChatInputCommandInteraction, context: BotContext) {
  await interaction.deferReply({
    ephemeral: true
  });

  if (!interaction.guild) {
    await interaction.editReply("Este comando so funciona em servidores.");
    return;
  }

  try {
    await publishRequestedMissionToolsPanel(context.client, context, interaction.guild.id);
    await interaction.editReply("Painel Mission Tools publicado/atualizado.");
  } catch (error) {
    await interaction.editReply(readRequestErrorMessage(error) ?? "Nao foi possivel publicar o painel Mission Tools.");
  }
}

export async function handleMissionCreateCommand(interaction: ChatInputCommandInteraction, context: BotContext) {
  await interaction.deferReply({
    ephemeral: true
  });

  if (!interaction.guild) {
    await interaction.editReply("Este comando so funciona em servidores.");
    return;
  }

  const title = interaction.options.getString("titulo", true);
  const description = interaction.options.getString("descricao") ?? null;
  const participantLimit = interaction.options.getInteger("limite") ?? 0;

  try {
    const mission = await context.api.createMissionToolMission({
      createdBy: interaction.user.id,
      description,
      guildId: interaction.guild.id,
      participantLimit,
      title
    });

    await refreshMissionToolsPanel(context.client, context, interaction.guild.id);
    await interaction.editReply(`Missao criada: ${mission.title}`);
  } catch (error) {
    await interaction.editReply(readRequestErrorMessage(error) ?? "Nao foi possivel criar a missao.");
  }
}

export async function handleMissionStartCommand(interaction: ChatInputCommandInteraction, context: BotContext) {
  await runActiveMissionCommand(interaction, context, "start");
}

export async function handleMissionCompleteCommand(interaction: ChatInputCommandInteraction, context: BotContext) {
  await runActiveMissionCommand(interaction, context, "complete");
}

export async function handleMissionCancelCommand(interaction: ChatInputCommandInteraction, context: BotContext) {
  await runActiveMissionCommand(interaction, context, "cancel");
}

async function runActiveMissionCommand(
  interaction: ChatInputCommandInteraction,
  context: BotContext,
  action: "start" | "complete" | "cancel"
) {
  await interaction.deferReply({
    ephemeral: true
  });

  if (!interaction.guild) {
    await interaction.editReply("Este comando so funciona em servidores.");
    return;
  }

  try {
    const active = await context.api.getActiveMissionToolMission(interaction.guild.id);

    if (!active) {
      await interaction.editReply("Nenhuma missao aberta ou em andamento.");
      return;
    }

    const actor = actorPayload(interaction);
    const mission = action === "start"
      ? await context.api.startMissionToolMission(active.id, actor)
      : action === "complete"
        ? await context.api.completeMissionToolMission(active.id, actor)
        : await context.api.cancelMissionToolMission(active.id, actor);

    if (action === "complete") {
      const settings = await context.api.getMissionToolsSettings(interaction.guild.id);
      const assigned = await assignCompletionRole(interaction.guild, settings, mission);
      await sendMissionLog(interaction.guild, settings, "Missao concluida", mission, interaction.user.id, assigned ? `${assigned} cargo(s) aplicado(s).` : null);
    }

    await refreshMissionToolsPanel(context.client, context, interaction.guild.id);
    await interaction.editReply(action === "start" ? "Missao iniciada." : action === "complete" ? "Missao concluida." : "Missao cancelada.");
  } catch (error) {
    await interaction.editReply(readRequestErrorMessage(error) ?? "Nao foi possivel atualizar a missao.");
  }
}

async function handleMissionButton(interaction: ButtonInteraction, context: BotContext) {
  const [prefix, action, missionId] = interaction.customId.split(":");

  if (prefix !== MISSION_PREFIX || !missionId) {
    await interaction.reply({
      content: "Acao do Mission Tools invalida.",
      ephemeral: true
    });
    return;
  }

  if (action === "join") {
    await joinMission(interaction, context, missionId);
    return;
  }

  if (action === "leave") {
    await leaveMission(interaction, context, missionId);
    return;
  }

  if (action === "start") {
    await updateMissionFromButton(interaction, context, missionId, "start");
    return;
  }

  if (action === "complete") {
    await updateMissionFromButton(interaction, context, missionId, "complete");
    return;
  }

  if (action === "cancel") {
    await updateMissionFromButton(interaction, context, missionId, "cancel");
    return;
  }

  await interaction.reply({
    content: "Acao do Mission Tools nao reconhecida.",
    ephemeral: true
  });
}

async function joinMission(interaction: ButtonInteraction, context: BotContext, missionId: string) {
  await interaction.deferReply({
    ephemeral: true
  });

  try {
    const mission = await context.api.joinMissionToolMission(missionId, actorPayload(interaction));
    const settings = await context.api.getMissionToolsSettings(mission.guildId);

    await refreshMissionToolsPanel(context.client, context, mission.guildId);
    await sendMissionLog(interaction.guild, settings, "Participante entrou", mission, interaction.user.id);
    await interaction.editReply(settings.messages.joinSuccess);
  } catch (error) {
    await interaction.editReply(readRequestErrorMessage(error) ?? "Nao foi possivel entrar na missao.");
  }
}

async function leaveMission(interaction: ButtonInteraction, context: BotContext, missionId: string) {
  await interaction.deferReply({
    ephemeral: true
  });

  try {
    const mission = await context.api.leaveMissionToolMission(missionId, actorPayload(interaction));
    const settings = await context.api.getMissionToolsSettings(mission.guildId);

    await refreshMissionToolsPanel(context.client, context, mission.guildId);
    await sendMissionLog(interaction.guild, settings, "Participante saiu", mission, interaction.user.id);
    await interaction.editReply(settings.messages.leaveSuccess);
  } catch (error) {
    await interaction.editReply(readRequestErrorMessage(error) ?? "Nao foi possivel sair da missao.");
  }
}

async function updateMissionFromButton(
  interaction: ButtonInteraction,
  context: BotContext,
  missionId: string,
  action: "start" | "complete" | "cancel"
) {
  await interaction.deferReply({
    ephemeral: true
  });

  try {
    const actor = actorPayload(interaction);
    const mission = action === "start"
      ? await context.api.startMissionToolMission(missionId, actor)
      : action === "complete"
        ? await context.api.completeMissionToolMission(missionId, actor)
        : await context.api.cancelMissionToolMission(missionId, actor);
    const settings = await context.api.getMissionToolsSettings(mission.guildId);

    if (action === "complete" && interaction.guild) {
      const assigned = await assignCompletionRole(interaction.guild, settings, mission);
      await sendMissionLog(interaction.guild, settings, "Missao concluida", mission, interaction.user.id, assigned ? `${assigned} cargo(s) aplicado(s).` : null);
    } else {
      await sendMissionLog(interaction.guild, settings, action === "start" ? "Missao iniciada" : "Missao cancelada", mission, interaction.user.id);
    }

    await refreshMissionToolsPanel(context.client, context, mission.guildId);
    await interaction.editReply(action === "start" ? settings.messages.missionStarted : action === "complete" ? settings.messages.missionCompleted : "Missao cancelada.");
  } catch (error) {
    await interaction.editReply(readRequestErrorMessage(error) ?? "Nao foi possivel atualizar a missao.");
  }
}

async function publishRequestedMissionToolsPanel(client: Client, context: BotContext, guildId: string) {
  const key = panelRequestKey(guildId);
  const current = panelPublishPromises.get(key);

  if (current) {
    return current;
  }

  const next = publishMissionToolsPanel(client, context, guildId)
    .then((settings) => {
      rememberHandledPanelRequest(settings);
      return settings;
    })
    .finally(() => {
      panelPublishPromises.delete(key);
    });

  panelPublishPromises.set(key, next);
  return next;
}

async function publishMissionToolsPanel(client: Client, context: BotContext, guildId: string) {
  const guild = await client.guilds.fetch(guildId);
  const settings = await context.api.getMissionToolsSettings(guildId);

  if (!settings.enabled || !settings.panelChannelId) {
    throw new Error("Mission Tools nao esta ativo ou sem canal de painel.");
  }

  const channel = await guild.channels.fetch(settings.panelChannelId);

  if (!channel || !channel.isTextBased() || !("messages" in channel)) {
    throw new Error("Canal de painel Mission Tools invalido.");
  }

  assertPanelChannelPermissions(channel, client, "Mission Tools");

  const mission = await context.api.getActiveMissionToolMission(guildId);
  const payload = buildPanelPayload(settings, mission);
  let messageId: string | null = null;

  if (settings.panelMessageId) {
    const oldMessage = await channel.messages.fetch(settings.panelMessageId).catch(() => null);

    if (oldMessage) {
      const edited = await oldMessage.edit(payload);
      await pinPanelMessage(edited, "Mission Tools");
      messageId = edited.id;
    }
  }

  if (!messageId) {
    const message = await channel.send(payload);
    await pinPanelMessage(message, "Mission Tools");
    messageId = message.id;
  }

  const saved = await context.api.updateMissionToolsPanelState({
    guildId,
    messageId
  });
  await sendMissionLog(guild, settings, "Painel publicado", mission, client.user?.id ?? null);
  console.log(`[mission-tools] painel publicado em ${guild.name}.`);
  return saved;
}

async function refreshMissionToolsPanel(client: Client, context: BotContext, guildId: string) {
  const settings = await context.api.getMissionToolsSettings(guildId);

  if (!settings.enabled || !settings.panelChannelId || !settings.panelMessageId) {
    return;
  }

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  const channel = await guild.channels.fetch(settings.panelChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("messages" in channel)) return;

  const message = await channel.messages.fetch(settings.panelMessageId).catch(() => null);
  if (!message) return;

  const mission = await context.api.getActiveMissionToolMission(guildId);
  await message.edit(buildPanelPayload(settings, mission)).catch((error) => {
    console.warn("[mission-tools] painel nao pode ser editado:", errorMessage(error));
  });
}

async function processPendingMissionToolsPanelRequests(client: Client, context: BotContext) {
  if (panelRequestCheckRunning || !isBotModuleEnabled(MODULE_ID)) {
    return;
  }

  panelRequestCheckRunning = true;

  try {
    const configs = await context.api.getActiveMissionToolsConfigs();

    for (const settings of configs) {
      if (!settings.lastPanelRequestedAt) {
        continue;
      }

      const key = panelRequestKey(settings.guildId);

      if (handledPanelRequests.get(key) === settings.lastPanelRequestedAt) {
        continue;
      }

      await publishRequestedMissionToolsPanel(client, context, settings.guildId).catch((error) => {
        logPanelRequestError(key, `[mission-tools] falha ao publicar painel pendente em ${settings.guildId}:`, error);
      });
    }
  } catch (error) {
    console.warn("[mission-tools] falha ao verificar pedidos pendentes:", errorMessage(error));
  } finally {
    panelRequestCheckRunning = false;
  }
}

function buildPanelPayload(settings: MissionToolsSettings, mission: MissionToolMission | null) {
  const embed = new EmbedBuilder()
    .setColor(mission ? statusColor(mission.status) : 0x2b2d31)
    .setTitle(settings.messages.panelTitle)
    .setDescription(panelDescription(settings, mission))
    .setTimestamp(new Date());

  if (mission) {
    embed.addFields(
      { name: "Status", value: statusLabel(mission.status), inline: true },
      { name: "Participantes", value: participantCountLabel(mission), inline: true },
      { name: "Criada em", value: formatDateTime(mission.createdAt), inline: true }
    );
  }

  return {
    allowedMentions: {
      parse: []
    },
    embeds: [embed],
    components: mission ? buildMissionComponents(mission) : []
  };
}

function buildMissionComponents(mission: MissionToolMission) {
  const closed = mission.status === "completed" || mission.status === "cancelled";

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${JOIN_PREFIX}:${mission.id}`)
        .setDisabled(closed)
        .setLabel("Entrar")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${LEAVE_PREFIX}:${mission.id}`)
        .setDisabled(closed)
        .setLabel("Sair")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${START_PREFIX}:${mission.id}`)
        .setDisabled(closed || mission.status === "running")
        .setLabel("Iniciar")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${COMPLETE_PREFIX}:${mission.id}`)
        .setDisabled(closed)
        .setLabel("Concluir")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${CANCEL_PREFIX}:${mission.id}`)
        .setDisabled(closed)
        .setLabel("Cancelar")
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

async function assignCompletionRole(guild: Guild, settings: MissionToolsSettings, mission: MissionToolMission) {
  if (!settings.completionRoleId) {
    return 0;
  }

  let assigned = 0;
  const activeParticipants = mission.participants.filter((participant) => !participant.leftAt);

  for (const participant of activeParticipants) {
    const member = await guild.members.fetch(participant.userId).catch(() => null);

    if (!member || member.roles.cache.has(settings.completionRoleId)) {
      continue;
    }

    await member.roles.add(settings.completionRoleId, `Conclusao da missao ${mission.title}`).then(() => {
      assigned += 1;
    }).catch((error) => {
      console.warn(`[mission-tools] falha ao aplicar cargo para ${participant.userId}:`, errorMessage(error));
    });
  }

  return assigned;
}

async function sendMissionLog(
  guild: Guild | null,
  settings: MissionToolsSettings,
  title: string,
  mission: MissionToolMission | null,
  actorId: string | null,
  detail?: string | null
) {
  if (!guild || !settings.logChannelId) {
    return;
  }

  const channel = await guild.channels.fetch(settings.logChannelId).catch(() => null);

  if (!channel?.isTextBased() || !channel.isSendable()) {
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(`Mission Tools - ${title}`)
    .setTimestamp(new Date());

  if (mission) {
    embed.addFields(
      { name: "Missao", value: truncate(mission.title, 256), inline: true },
      { name: "Status", value: statusLabel(mission.status), inline: true },
      { name: "Participantes", value: participantCountLabel(mission), inline: true }
    );
  }

  if (actorId) {
    embed.addFields({ name: "Responsavel", value: `<@${actorId}>`, inline: true });
  }

  if (detail) {
    embed.addFields({ name: "Detalhe", value: truncate(detail, 1024), inline: false });
  }

  await channel.send({
    embeds: [embed]
  }).catch(() => null);
}

function actorPayload(interaction: ButtonInteraction | ChatInputCommandInteraction) {
  return {
    actorId: interaction.user.id,
    actorRoleIds: interactionRoleIds(interaction),
    username: interaction.member instanceof Object && "displayName" in interaction.member
      ? interaction.member.displayName
      : interaction.user.username
  };
}

function interactionRoleIds(interaction: ButtonInteraction | ChatInputCommandInteraction) {
  const member = interaction.member;
  const roleIds = new Set<string>();

  if (interaction.guildId) {
    roleIds.add(interaction.guildId);
  }

  if (!member) {
    return [...roleIds];
  }

  if (member instanceof Object && "roles" in member) {
    const roles = member.roles;

    if (Array.isArray(roles)) {
      roles.forEach((roleId) => roleIds.add(roleId));
    } else if (roles instanceof Object && "cache" in roles) {
      [...(roles as GuildMember["roles"]).cache.keys()].forEach((roleId) => roleIds.add(roleId));
    }
  }

  return [...roleIds];
}

function panelDescription(settings: MissionToolsSettings, mission: MissionToolMission | null) {
  if (!mission) {
    return `${settings.messages.panelDescription}\n\nNenhuma missao ativa no momento.`;
  }

  return [
    settings.messages.panelDescription,
    "",
    `**Missao:** ${mission.title}`,
    mission.description ? `**Descricao:** ${mission.description}` : null,
    `**Participantes:** ${participantCountLabel(mission)}`
  ].filter(Boolean).join("\n");
}

function participantCountLabel(mission: MissionToolMission) {
  return mission.participantLimit > 0
    ? `${mission.activeParticipantCount}/${mission.participantLimit}`
    : String(mission.activeParticipantCount);
}

function statusLabel(status: MissionToolMission["status"]) {
  const labels: Record<MissionToolMission["status"], string> = {
    cancelled: "Cancelada",
    completed: "Concluida",
    open: "Aberta",
    running: "Em andamento"
  };

  return labels[status];
}

function statusColor(status: MissionToolMission["status"]) {
  const colors: Record<MissionToolMission["status"], number> = {
    cancelled: 0xef4444,
    completed: 0x22c55e,
    open: 0x3b82f6,
    running: 0xf59e0b
  };

  return colors[status];
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function isMissionPayload(value: unknown): value is MissionToolMission {
  return Boolean(
    value
      && typeof value === "object"
      && "id" in value
      && "guildId" in value
      && "botId" in value
  );
}

function isPayloadForThisBot(botId: string | null | undefined) {
  return !botId || !env.DASHBOARD_BOT_ID || botId === env.DASHBOARD_BOT_ID;
}

function panelRequestKey(guildId: string) {
  return `${env.DASHBOARD_BOT_ID || "bot"}:${guildId}`;
}

function rememberHandledPanelRequest(settings: MissionToolsSettings) {
  if (settings.lastPanelRequestedAt) {
    handledPanelRequests.set(panelRequestKey(settings.guildId), settings.lastPanelRequestedAt);
  }
}

function logPanelRequestError(key: string, message: string, error: unknown) {
  const now = Date.now();
  const lastLogAt = panelRequestErrorLogAt.get(key) ?? 0;

  if (now - lastLogAt < 60_000) {
    return;
  }

  panelRequestErrorLogAt.set(key, now);
  console.warn(message, errorMessage(error));
}

async function replySafely(interaction: Interaction, content: string) {
  if (!interaction.isRepliable()) {
    return;
  }

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({
      content,
      ephemeral: true
    });
    return;
  }

  await interaction.reply({
    content,
    ephemeral: true
  });
}

function readRequestErrorMessage(error: unknown) {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return null;
  }

  const response = (error as { response?: { data?: { message?: unknown } } }).response;
  return typeof response?.data?.message === "string" ? response.data.message : null;
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 3))}...` : value;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

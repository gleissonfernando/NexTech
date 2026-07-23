import {
  ActionRowBuilder,
  ActivityType,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  PermissionFlagsBits,
  TextDisplayBuilder,
  type Interaction,
  type Message
} from "discord.js";
import { existsSync } from "node:fs";
import path from "node:path";
import type { MaintenanceState } from "./apiClient";
import { currentRuntimeBotId, env } from "../config/env";
import { getCachedGuildSettings } from "./guildSettingsCache";
import type { BotContext, GuildSettings } from "../types";

type MessageChannelWithMessages = Message["channel"] & {
  messages: Message["channel"]["messages"];
  send: (payload: Parameters<Extract<Message["channel"], { send: unknown }>["send"]>[0]) => Promise<Message>;
};

export const MAINTENANCE_INTERACTION_MESSAGE = "O sistema entrou em manutenção. Entre em contato com o suporte em caso de dúvida.";
const MAINTENANCE_SUPPORT_URL = "https://discord.gg/KAGgfuTcDS";

const MAINTENANCE_ALERT_MESSAGE = [
  "MANUTENÇÃO INICIADA",
  "Este bot entrou em manutenção.",
  "Os serviços deste bot estão temporariamente indisponíveis.",
  "Aguarde a liberação oficial da equipe de desenvolvimento."
].join("\n");
const MAINTENANCE_PANEL_TITLE = "MANUTENÇÃO INICIADA";
const MAINTENANCE_PANEL_DESCRIPTION = [
  "Este bot entrou em manutenção.",
  "Todos os serviços do bot estão temporariamente indisponíveis.",
  "Aguarde a equipe finalizar a manutenção para utilizar novamente."
].join("\n");
const MAINTENANCE_PRESENCE_NAME = "Sistema em manutenção";
const MAINTENANCE_GIF_FILE_NAME = "nft-coding.gif";
const MAINTENANCE_GIF_PATH = resolveAssetPath(`maintenance/${MAINTENANCE_GIF_FILE_NAME}`);
const MAINTENANCE_BYPASS_COMMANDS = new Set(["ping"]);

let maintenanceState: MaintenanceState = {
  active: false,
  activatedAt: null,
  affectedBots: 0,
  botId: null,
  botName: null,
  deactivatedAt: null,
  updatedAt: new Date(0).toISOString(),
  updatedById: null,
  updatedByName: null
};
let started = false;
let appliedInitialMaintenanceState = false;
const maintenanceStateListeners = new Set<(state: MaintenanceState, previousActive: boolean, action: string) => void>();

export function isMaintenanceModeActive() {
  return maintenanceState.active;
}

export function onMaintenanceStateChanged(listener: (state: MaintenanceState, previousActive: boolean, action: string) => void) {
  maintenanceStateListeners.add(listener);
  return () => maintenanceStateListeners.delete(listener);
}

export async function refreshMaintenanceState(context: BotContext) {
  const previousActive = maintenanceState.active;
  const state = await context.api.getMaintenanceState().catch((error) => {
    console.warn("[maintenance] não foi possível carregar estado:", error instanceof Error ? error.message : error);
    return null;
  });

  if (state) {
    maintenanceState = state;
    await applyMaintenanceState(context, previousActive, MAINTENANCE_ALERT_MESSAGE);
    notifyMaintenanceStateChanged(previousActive, "maintenance:poll");
  }
}

export function startMaintenanceService(context: BotContext, options: { refreshImmediately?: boolean } = {}) {
  if (started) {
    return;
  }

  started = true;
  if (options.refreshImmediately ?? true) {
    void refreshMaintenanceState(context);
  }

  context.socket.onMaintenanceUpdated((payload) => {
    const runtimeBotId = (currentRuntimeBotId() ?? env.DASHBOARD_BOT_ID) || null;
    const payloadBotId = payload.botId ?? payload.state?.botId ?? null;
    if (payloadBotId && runtimeBotId && payloadBotId !== runtimeBotId) {
      return;
    }
    const previousActive = maintenanceState.active;
    maintenanceState = payload.state;
    void applyMaintenanceState(context, previousActive, payload.alertMessage || MAINTENANCE_ALERT_MESSAGE, payload.action)
      .finally(() => notifyMaintenanceStateChanged(previousActive, payload.action));
  });

  const interval = setInterval(() => {
    void refreshMaintenanceState(context);
  }, 60_000);

  interval.unref();
}

function notifyMaintenanceStateChanged(previousActive: boolean, action: string) {
  if (previousActive === maintenanceState.active) {
    return;
  }

  for (const listener of maintenanceStateListeners) {
    try {
      listener(maintenanceState, previousActive, action);
    } catch (error) {
      console.warn("[maintenance] listener falhou:", error instanceof Error ? error.message : error);
    }
  }
}

export async function blockInteractionIfMaintenance(interaction: Interaction, context: BotContext) {
  if (!maintenanceState.active) {
    return false;
  }

  if (await canBypassMaintenanceInteraction(interaction, context)) {
    return false;
  }

  if (!interaction.isRepliable()) {
    return true;
  }

  const payload = maintenanceInteractionPayload();

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload).catch(() => undefined);
    return true;
  }

  await interaction.reply(payload).catch(() => undefined);
  return true;
}

export async function blockMessageIfMaintenance(message: Message, context: BotContext) {
  if (!maintenanceState.active) {
    return false;
  }

  if (message.author.bot) {
    return true;
  }

  const mentioned = message.client.user ? message.mentions.has(message.client.user) : false;
  const looksLikeCommand = message.content.trim().startsWith("/") || message.content.trim().startsWith("!");

  if (mentioned || looksLikeCommand) {
    if (await canBypassMaintenanceMessage(message, context)) {
      return false;
    }

    await sendMaintenancePrivateMessage(message).catch(() => undefined);
  }

  return true;
}

async function applyMaintenanceState(
  context: BotContext,
  previousActive: boolean,
  message: string,
  action = maintenanceState.active ? "maintenance:started" : "maintenance:ended"
) {
  const shouldCleanInactivePanels = !maintenanceState.active && (previousActive || !appliedInitialMaintenanceState);

  updateMaintenancePresence(context, maintenanceState.active);

  if (maintenanceState.active && (!previousActive || action === "maintenance:manual_alert")) {
    void message;
    appliedInitialMaintenanceState = true;
    return;
  }

  if (shouldCleanInactivePanels) {
    await removeMaintenancePanels(context);
  }

  appliedInitialMaintenanceState = true;
}

function updateMaintenancePresence(context: BotContext, active: boolean) {
  if (!context.client.user) {
    return;
  }

  if (active) {
    context.client.user.setPresence({
      activities: [
        {
          name: MAINTENANCE_PRESENCE_NAME,
          type: ActivityType.Watching
        }
      ],
      status: "dnd"
    });
    return;
  }

  context.client.user.setPresence({
    activities: [],
    status: "online"
  });
}

async function ensureMaintenancePanels(context: BotContext, message: string) {
  const sentChannels = new Set<string>();

  for (const guild of context.client.guilds.cache.values()) {
    const settings = await getCachedGuildSettings(context, guild.id, context.client.user?.id).catch(() => null);

    if (!settings) {
      continue;
    }

    for (const channelId of maintenanceChannelIds(settings)) {
      const key = `${guild.id}:${channelId}`;

      if (sentChannels.has(key)) {
        continue;
      }

      sentChannels.add(key);
      const channel = await guild.channels.fetch(channelId).catch(() => null);

      if (channel?.isTextBased() && channel.isSendable() && "messages" in channel) {
        await ensureMaintenancePanel(channel as MessageChannelWithMessages, message).catch((error) => {
          console.warn("[maintenance] falha ao publicar painel:", error instanceof Error ? error.message : error);
        });
      }
    }
  }
}

async function removeMaintenancePanels(context: BotContext) {
  const checkedChannels = new Set<string>();

  for (const guild of context.client.guilds.cache.values()) {
    const settings = await getCachedGuildSettings(context, guild.id, context.client.user?.id).catch(() => null);

    if (!settings) {
      continue;
    }

    for (const channelId of maintenanceChannelIds(settings)) {
      const key = `${guild.id}:${channelId}`;

      if (checkedChannels.has(key)) {
        continue;
      }

      checkedChannels.add(key);
      const channel = await guild.channels.fetch(channelId).catch(() => null);

      if (channel?.isTextBased() && "messages" in channel) {
        await deleteMaintenancePanelsFromChannel(channel as MessageChannelWithMessages).catch((error) => {
          console.warn("[maintenance] falha ao apagar painel:", error instanceof Error ? error.message : error);
        });
      }
    }
  }
}

async function ensureMaintenancePanel(channel: MessageChannelWithMessages, message: string) {
  const messages = await channel.messages.fetch({ limit: 100 });
  const panels = messages.filter((item) => isMaintenancePanelMessage(item));
  const currentPanel = panels.find((item) => isCurrentMaintenancePanelMessage(item));

  if (!currentPanel) {
    await channel.send(maintenancePanelPayload(message));
  }

  await Promise.allSettled(
    panels
      .filter((item) => item.id !== currentPanel?.id)
      .map((item) => item.delete())
  );
}

async function deleteMaintenancePanelsFromChannel(channel: MessageChannelWithMessages) {
  const messages = await channel.messages.fetch({ limit: 100 });
  await Promise.allSettled(
    messages
      .filter((item) => isMaintenancePanelMessage(item))
      .map((item) => item.delete())
  );
}

function maintenancePanelPayload(message: string) {
  return {
    allowedMentions: {
      parse: [] as never[]
    },
    components: [maintenancePanelComponent(message)],
    files: maintenancePanelFiles(),
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function maintenanceInteractionPayload() {
  return {
    allowedMentions: {
      parse: [] as never[]
    },
    components: [maintenancePanelComponent(MAINTENANCE_INTERACTION_MESSAGE, false)],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  };
}

function maintenanceMessageReplyPayload() {
  return {
    allowedMentions: {
      parse: [] as never[]
    },
    components: [maintenancePanelComponent(MAINTENANCE_INTERACTION_MESSAGE, false)],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

async function sendMaintenancePrivateMessage(message: Message) {
  await message.author.send(maintenanceMessageReplyPayload());
}

function maintenancePanelComponent(message: string, includeMedia = true) {
  const container = new ContainerBuilder().setAccentColor(0xf59e0b);

  if (includeMedia && existsSync(MAINTENANCE_GIF_PATH)) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(`attachment://${MAINTENANCE_GIF_FILE_NAME}`)
          .setDescription("Bot em manutenção")
      )
    );
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${MAINTENANCE_PANEL_TITLE}`),
    new TextDisplayBuilder().setContent(MAINTENANCE_PANEL_DESCRIPTION),
    new TextDisplayBuilder().setContent(message)
  );

  return container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel("Servidor de suporte")
        .setStyle(ButtonStyle.Link)
        .setURL(MAINTENANCE_SUPPORT_URL)
    )
  );
}

async function canBypassMaintenanceInteraction(interaction: Interaction, context: BotContext) {
  if (interaction.isChatInputCommand() && MAINTENANCE_BYPASS_COMMANDS.has(interaction.commandName)) {
    return true;
  }

  if (!interaction.guildId) {
    return false;
  }

  if ("memberPermissions" in interaction && interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  return canBypassMaintenanceBySettings(context, interaction.guildId, interaction.user.id, readInteractionRoleIds(interaction));
}

async function canBypassMaintenanceMessage(message: Message, context: BotContext) {
  if (!message.guildId) {
    return false;
  }

  if (message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  return canBypassMaintenanceBySettings(context, message.guildId, message.author.id, [...(message.member?.roles.cache.keys() ?? [])]);
}

async function canBypassMaintenanceBySettings(context: BotContext, guildId: string, userId: string, roleIds: string[]) {
  const settings = await getCachedGuildSettings(context, guildId, context.client.user?.id).catch(() => null);

  if (!settings) {
    return false;
  }

  if (settings.dashboardUserPermissions?.[userId]) {
    return true;
  }

  return roleIds.some((roleId) => Boolean(settings.dashboardRolePermissions?.[roleId]));
}

function readInteractionRoleIds(interaction: Interaction) {
  const roles = interaction.member && typeof interaction.member === "object" && "roles" in interaction.member
    ? interaction.member.roles
    : null;

  if (Array.isArray(roles)) {
    return roles;
  }

  if (roles && typeof roles === "object" && "cache" in roles && roles.cache && typeof roles.cache === "object" && "keys" in roles.cache) {
    return [...roles.cache.keys()] as string[];
  }

  return [];
}

function maintenancePanelFiles() {
  if (!existsSync(MAINTENANCE_GIF_PATH)) {
    return [];
  }

  return [
    new AttachmentBuilder(MAINTENANCE_GIF_PATH, {
      name: MAINTENANCE_GIF_FILE_NAME
    })
  ];
}

function isMaintenancePanelMessage(message: Message) {
  if (message.author.id !== message.client.user?.id) {
    return false;
  }

  const serialized = serializedMessageComponents(message);
  return serialized.includes(MAINTENANCE_PANEL_TITLE)
    || serialized.includes("MANUTENÇÃO INICIADA")
    || serialized.includes("MANUTENCAO INICIADA")
    || message.content.includes("MANUTENCAO INICIADA");
}

function isCurrentMaintenancePanelMessage(message: Message) {
  const serialized = serializedMessageComponents(message);
  return message.flags.has(MessageFlags.IsComponentsV2)
    && serialized.includes(MAINTENANCE_PANEL_DESCRIPTION)
    && (!existsSync(MAINTENANCE_GIF_PATH) || serialized.includes(MAINTENANCE_GIF_FILE_NAME));
}

function serializedMessageComponents(message: Message) {
  try {
    return JSON.stringify(message.components.map((component) => component.toJSON()));
  } catch {
    return "";
  }
}

function maintenanceChannelIds(settings: GuildSettings) {
  return [
    settings.logChannelId,
    settings.welcomeChannelId,
    settings.welcomeDisplayChannelId,
    settings.leaveChannelId,
    settings.leaveDisplayChannelId,
    settings.accountAgeLogChannelId,
    settings.safeBotChannelId,
    settings.safeBotLogChannelId
  ].filter((channelId): channelId is string => Boolean(channelId));
}

function resolveAssetPath(fileName: string) {
  const candidates = [
    path.resolve(process.cwd(), "bot", "assets", fileName),
    path.resolve(process.cwd(), "assets", fileName)
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0] ?? fileName;
}

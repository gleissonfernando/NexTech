import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type Interaction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type TextBasedChannel
} from "discord.js";
import { env, isBotModuleEnabled } from "../config/env";
import type { BotContext } from "../types";
import type {
  MissionToolsFeatureId,
  MissionToolsRichPresenceConfig,
  MissionToolsSettings,
  MissionToolsTokenResponse,
  MissionToolsUserPanel,
  MissionToolsUserPatch
} from "./apiClient";
import { assertPanelChannelPermissions, pinPanelMessage } from "./panelDeliveryService";
import {
  DiscordRichPresenceSession,
  DiscordUsernameChecker,
  DiscordVoiceSession,
  MissionQueue,
  fetchDiscordGuildOptions,
  fetchDiscordVoiceChannelOptions,
  isDiscordTokenAuthError,
  runDiscordDmCleanup,
  runMissionFlow,
  type CheckerStats,
  type DiscordGuildOption,
  type DiscordVoiceChannelOption,
  type MissionStatusUpdate
} from "./missionToolsRuntime";

type PanelType = "clear" | "mission" | "voice" | "richPresence" | "usernameChecker";

type PanelRenderOptions = {
  guildOptions?: DiscordGuildOption[];
  voiceChannelOptions?: DiscordVoiceChannelOption[];
};

const MODULE_ID = "mission-tools";
const PREFIX = "mission_tools";
const MAIN_CLEAR_VALUE = "clear";
const MAIN_DELETE_DM_VALUE = "delete-bot-dm";
const MAIN_MISSION_VALUE = "mission";
const MAIN_RICH_PRESENCE_VALUE = "rich-presence";
const MAIN_USERNAME_CHECKER_VALUE = "username-checker";
const MAIN_VOICE_VALUE = "voice";
const PANEL_ACCENT = 0x4b5563;
const PANEL_REQUEST_CHECK_INTERVAL_MS = 15_000;
const DM_REPLY_CLEANUP_DELAY_MS = 2_500;
const USER_TOKEN_FEATURES_DISABLED_MESSAGE =
  "Fake token detected. Mission Tools never stores or executes Discord user-account tokens. Use official bot or OAuth permissions only.";

let serviceStarted = false;
let panelRequestCheckRunning = false;
const handledPanelRequests = new Map<string, string>();
const panelPublishPromises = new Map<string, Promise<MissionToolsSettings>>();
const panelRequestErrorLogAt = new Map<string, number>();
const missionQueue = new MissionQueue();
const cleanupControllers = new Map<string, AbortController>();
const voiceSessions = new Map<string, { session: DiscordVoiceSession; token: string; tokenUpdatedAt: string }>();
const richPresenceSessions = new Map<string, { session: DiscordRichPresenceSession; token: string; tokenUpdatedAt: string }>();
const usernameCheckerSessions = new Map<string, DiscordUsernameChecker>();
const missionRunVersions = new Map<string, number>();

type MissionReplyInteraction = ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;

export function startMissionToolsService(client: Client, context: BotContext) {
  if (!isBotModuleEnabled(MODULE_ID) || serviceStarted) {
    return;
  }

  serviceStarted = true;

  context.socket.onMissionToolsSettingsUpdated((payload) => {
    if (!isBotModuleEnabled(MODULE_ID) || !isPayloadForThisBot(payload.botId)) {
      return;
    }

    console.log(`[mission-tools] settings updated for ${payload.guildId}.`);
  });

  context.socket.onMissionToolsPanelPublish((payload) => {
    if (!isBotModuleEnabled(MODULE_ID) || !isPayloadForThisBot(payload.botId)) {
      return;
    }

    void publishRequestedMissionToolsPanel(client, context, payload.guildId).catch((error) => {
      console.error(`[mission-tools] failed to publish panel in ${payload.guildId}:`, errorMessage(error));
    });
  });

  context.socket.onMissionToolsUserUpdated((payload) => {
    if (!isBotModuleEnabled(MODULE_ID) || !isPayloadForThisBot(payload.botId)) {
      return;
    }

    invalidateRuntimeSessionsFromUserPayload(payload.guildId, payload.user);
    void refreshExistingUserDmPanels(context, payload.guildId, payload.user)
      .then((updated) => {
        console.log(`[mission-tools] user panel updated in ${payload.guildId}: ${updated} message(s).`);
      })
      .catch((error) => {
        console.warn(`[mission-tools] failed to update private panel in ${payload.guildId}:`, errorMessage(error));
      });
  });

  void context.api.getActiveMissionToolsConfigs()
    .then((configs) => console.log(`[mission-tools] ${configs.length} active configuration(s) loaded.`))
    .catch((error) => console.warn("[mission-tools] settings could not be loaded:", errorMessage(error)));

  void processPendingMissionToolsPanelRequests(client, context);
  const interval = setInterval(() => {
    void processPendingMissionToolsPanelRequests(client, context);
  }, PANEL_REQUEST_CHECK_INTERVAL_MS);

  interval.unref();
}

export async function handleMissionToolsInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) {
    return false;
  }

  if (!interaction.customId.startsWith(`${PREFIX}:`)) {
    return false;
  }

  if (!isBotModuleEnabled(MODULE_ID)) {
    await replySafely(interaction, "Mission Tools has not been enabled for this bot by an administrator.");
    return true;
  }

  try {
    if (interaction.isStringSelectMenu()) {
      await handleSelectMenu(interaction, context);
      return true;
    }

    if (interaction.isModalSubmit()) {
      await handleModal(interaction, context);
      return true;
    }

    await handleButton(interaction, context);
  } catch (error) {
    console.error("[mission-tools] failed to process interaction:", error);
    await replySafely(interaction, readRequestErrorMessage(error) ?? "This Mission Tools interaction could not be processed.");
  }

  return true;
}

async function handleSelectMenu(interaction: StringSelectMenuInteraction, context: BotContext) {
  const parts = interaction.customId.split(":");
  const scope = parts[1];
  const action = parts[2];
  const guildId = parts[3];
  const selected = interaction.values[0];

  if (!guildId) {
    await replySafely(interaction, "Invalid Mission Tools panel.");
    return;
  }

  if (scope === "main" && action === "select") {
    if (selected === MAIN_DELETE_DM_VALUE) {
      await deleteBotDmPanels(interaction, context, guildId);
      await resetMainPanelSelection(interaction, context, guildId);
      return;
    }

    const panelType = panelTypeFromMainValue(selected);
    if (!panelType) {
      await replySafely(interaction, "Invalid Mission Tools module.");
      await resetMainPanelSelection(interaction, context, guildId);
      return;
    }

    await sendDmPanel(interaction, context, guildId, panelType);
    await resetMainPanelSelection(interaction, context, guildId);
    return;
  }

  if (scope === "voice" && action === "guild" && selected) {
    await deferMissionReply(interaction);
    const token = await requireUserToken(interaction, context, guildId);
    if (!token) return;

    const options = await fetchVoiceOptionsSafely(interaction, context, guildId, token, selected);
    if (!options) return;
    const selectedGuild = options.guildOptions.find((guild) => guild.id === selected);
    await context.api.updateMissionToolsUser(guildId, interaction.user.id, {
      username: displayUserName(interaction),
      voiceChannelId: null,
      voiceChannelName: null,
      voiceGuildId: selected,
      voiceGuildName: selectedGuild?.name ?? selected
    });
    await editOrCreateDmPanel(context, guildId, interaction.user.id, "voice", {
      guildOptions: options.guildOptions,
      voiceChannelOptions: options.voiceChannelOptions
    });
    await editMissionReply(interaction, "Voice server selected. Now choose a channel.");
    return;
  }

  if (scope === "voice" && action === "channel" && selected) {
    await deferMissionReply(interaction);
    const record = await context.api.getMissionToolsUser(guildId, interaction.user.id);
    const token = await requireUserToken(interaction, context, guildId);
    if (!token) return;
    const options = record.voiceGuildId
      ? await fetchVoiceOptionsSafely(interaction, context, guildId, token, record.voiceGuildId)
      : {
          guildOptions: [],
          voiceChannelOptions: []
        };
    if (!options) return;
    const channelOptions = options.voiceChannelOptions;
    const selectedChannel = channelOptions.find((channel) => channel.id === selected);

    await context.api.updateMissionToolsUser(guildId, interaction.user.id, {
      username: displayUserName(interaction),
      voiceChannelId: selected,
      voiceChannelName: selectedChannel?.name ?? selected
    });
    await editOrCreateDmPanel(context, guildId, interaction.user.id, "voice", {
      voiceChannelOptions: channelOptions
    });
    await editMissionReply(interaction, "Voice channel selected.");
    return;
  }

  await replySafely(interaction, "Unknown Mission Tools selection.");
}

async function handleButton(interaction: ButtonInteraction, context: BotContext) {
  const parts = interaction.customId.split(":");
  const scope = parts[1];
  const action = parts[2];
  const guildId = parts[3];

  if (!scope || !action || !guildId) {
    await replySafely(interaction, "Invalid Mission Tools action.");
    return;
  }

  if (action === "token") {
    await replySafely(interaction, USER_TOKEN_FEATURES_DISABLED_MESSAGE);
    return;
  }

  if (scope === "mission") {
    await handleMissionButton(interaction, context, guildId, action);
    return;
  }

  if (scope === "clear") {
    await handleClearButton(interaction, context, guildId, action);
    return;
  }

  if (scope === "voice") {
    await handleVoiceButton(interaction, context, guildId, action);
    return;
  }

  if (scope === "rich") {
    await handleRichPresenceButton(interaction, context, guildId, action);
    return;
  }

  if (scope === "username") {
    await handleUsernameCheckerButton(interaction, context, guildId, action);
    return;
  }

  await replySafely(interaction, "Unknown Mission Tools action.");
}

async function handleModal(interaction: ModalSubmitInteraction, context: BotContext) {
  const parts = interaction.customId.split(":");
  const modal = parts[2];
  const guildId = parts[3];

  if (!modal || !guildId) {
    await replySafely(interaction, "Invalid Mission Tools form.");
    return;
  }

  if (modal === "token") {
    await replySafely(interaction, USER_TOKEN_FEATURES_DISABLED_MESSAGE);
    return;
  }

  if (modal === "clear-target") {
    await handleClearTargetModal(interaction, context, guildId);
    return;
  }

  if (modal === "voice-config") {
    await handleVoiceConfigModal(interaction, context, guildId);
    return;
  }

  if (modal === "rich-config") {
    await handleRichPresenceConfigModal(interaction, context, guildId);
    return;
  }

  if (modal === "rich-button") {
    await handleRichPresenceButtonModal(interaction, context, guildId);
    return;
  }

  if (modal === "rich-advanced") {
    await handleRichPresenceAdvancedModal(interaction, context, guildId);
    return;
  }

  if (modal === "username-config") {
    await handleUsernameCheckerConfigModal(interaction, context, guildId);
    return;
  }

  await replySafely(interaction, "Unknown Mission Tools form.");
}

async function handleMissionButton(interaction: ButtonInteraction, context: BotContext, guildId: string, action: string) {
  if (action === "start") {
    await deferMissionReply(interaction);
    invalidateMissionRunVersion(guildId, interaction.user.id);
    await updateUserAndPanel(context, guildId, interaction.user.id, "mission", {
      currentMission: "User-token quests disabled",
      missionDetail: USER_TOKEN_FEATURES_DISABLED_MESSAGE,
      missionStatus: "error",
      progress: 0,
      totalMissions: 0,
      username: displayUserName(interaction)
    });
    await editMissionReply(interaction, USER_TOKEN_FEATURES_DISABLED_MESSAGE);
    return;
  }

  if (action === "deactivate") {
    await deferMissionReply(interaction);
    const cancelled = missionQueue.cancelUser(sessionKey(guildId, interaction.user.id), "Mission System deactivated by the user.");
    invalidateMissionRunVersion(guildId, interaction.user.id);
    await updateUserAndPanel(context, guildId, interaction.user.id, "mission", {
      missionDetail: cancelled ? "Operation cancelled." : "No operation is currently running.",
      missionStatus: "deactivated",
      progress: 0
    });
    await editMissionReply(interaction, "Mission System deactivated.");
  }
}

async function handleClearButton(interaction: ButtonInteraction, context: BotContext, guildId: string, action: string) {
  if (action === "bulk") {
    await deferMissionReply(interaction);
    await updateUserAndPanel(context, guildId, interaction.user.id, "clear", {
      clearMode: "bulk",
      username: displayUserName(interaction)
    });
    await editMissionReply(interaction, "Cleanup mode changed to bulk.");
    return;
  }

  if (action === "target") {
    const record = await context.api.getMissionToolsUser(guildId, interaction.user.id);
    const modal = new ModalBuilder()
      .setCustomId(`${PREFIX}:modal:clear-target:${guildId}`)
      .setTitle("Clean DM by User ID")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("clear_target_user_id")
            .setLabel("Target user ID")
            .setMaxLength(32)
            .setMinLength(5)
            .setRequired(true)
            .setStyle(TextInputStyle.Short)
            .setValue(record.clearTargetUserId ?? "")
        )
      );
    await interaction.showModal(modal);
    return;
  }

  if (action === "start") {
    await deferMissionReply(interaction);
    const tokenRecord = await requireUserTokenRecord(interaction, context, guildId);
    if (!tokenRecord) return;
    const token = tokenRecord.token;
    const record = await context.api.getMissionToolsUser(guildId, interaction.user.id);
    const key = sessionKey(guildId, interaction.user.id);

    if (cleanupControllers.has(key)) {
      await editMissionReply(interaction, "Clean System is already running.");
      return;
    }

    const controller = new AbortController();
    cleanupControllers.set(key, controller);
    await updateUserAndPanel(context, guildId, interaction.user.id, "clear", {
      clearStatus: "running",
      currentMission: record.clearMode === "userDm" ? "Cleaning DM by ID" : "Bulk cleanup",
      username: displayUserName(interaction)
    });
    void runDiscordDmCleanup({
      signal: controller.signal,
      targetUserId: record.clearMode === "userDm" ? record.clearTargetUserId : null,
      token
    })
      .then(async () => {
        await updateUserAndPanel(context, guildId, interaction.user.id, "clear", {
          clearStatus: "completed",
          currentMission: "Cleanup completed"
        });
      })
      .catch(async (error) => {
        const authFailed = await recordTokenAuthFailure(context, guildId, interaction.user.id, error, "clear", "clear");
        await updateUserAndPanel(context, guildId, interaction.user.id, "clear", {
          clearStatus: controller.signal.aborted ? "deactivated" : "error",
          currentMission: authFailed ? "Fake token detected; use an official bot or OAuth flow." : errorMessage(error)
        });
      })
      .finally(() => cleanupControllers.delete(key));
    await editMissionReply(interaction, "Clean System started.");
    return;
  }

  if (action === "deactivate") {
    await deferMissionReply(interaction);
    cleanupControllers.get(sessionKey(guildId, interaction.user.id))?.abort("Clean System deactivated by the user.");
    cleanupControllers.delete(sessionKey(guildId, interaction.user.id));
    await updateUserAndPanel(context, guildId, interaction.user.id, "clear", {
      clearStatus: "deactivated",
      currentMission: "System deactivated"
    });
    await editMissionReply(interaction, "Clean System deactivated.");
  }
}

async function handleVoiceButton(interaction: ButtonInteraction, context: BotContext, guildId: string, action: string) {
  if (action === "load") {
    await deferMissionReply(interaction);
    const token = await requireUserToken(interaction, context, guildId);
    if (!token) return;
    const record = await context.api.getMissionToolsUser(guildId, interaction.user.id);
    const options = record.voiceGuildId
      ? await fetchVoiceOptionsSafely(interaction, context, guildId, token, record.voiceGuildId)
      : await fetchVoiceOptionsSafely(interaction, context, guildId, token);
    if (!options) return;
    await editOrCreateDmPanel(context, guildId, interaction.user.id, "voice", {
      guildOptions: options.guildOptions,
      voiceChannelOptions: options.voiceChannelOptions
    });
    await editMissionReply(interaction, "Server and channel list updated.");
    return;
  }

  if (action === "manual") {
    const record = await context.api.getMissionToolsUser(guildId, interaction.user.id);
    const modal = new ModalBuilder()
      .setCustomId(`${PREFIX}:modal:voice-config:${guildId}`)
      .setTitle("Configurar Voice Session")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("voice_guild_id")
            .setLabel("Server ID")
            .setMaxLength(32)
            .setMinLength(5)
            .setRequired(true)
            .setStyle(TextInputStyle.Short)
            .setValue(record.voiceGuildId ?? "")
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("voice_channel_id")
            .setLabel("Voice channel ID")
            .setMaxLength(32)
            .setMinLength(5)
            .setRequired(true)
            .setStyle(TextInputStyle.Short)
            .setValue(record.voiceChannelId ?? "")
        )
      );
    await interaction.showModal(modal);
    return;
  }

  if (action === "start") {
    await deferMissionReply(interaction);
    const tokenRecord = await requireUserTokenRecord(interaction, context, guildId);
    if (!tokenRecord) return;
    const token = tokenRecord.token;
    const record = await context.api.getMissionToolsUser(guildId, interaction.user.id);

    if (!record.voiceGuildId || !record.voiceChannelId) {
      await editMissionReply(interaction, "Select or configure a voice server and channel first.");
      return;
    }

    const key = sessionKey(guildId, interaction.user.id);
    const current = voiceSessions.get(key);
    if (current && (current.token !== token || current.tokenUpdatedAt !== tokenRecord.updatedAt)) {
      current.session.stop();
    }
    const session = current?.token === token && current.tokenUpdatedAt === tokenRecord.updatedAt
      ? current.session
      : new DiscordVoiceSession(token, (update) => {
          void updateUserAndPanel(context, guildId, interaction.user.id, "voice", {
            voiceConnectedAt: update.connectedAt ?? null,
            voiceStatus: update.status
          });
        }, (error) => {
          void recordTokenAuthFailure(context, guildId, interaction.user.id, error, "voice-gateway", "voice");
        });
    voiceSessions.set(key, { session, token, tokenUpdatedAt: tokenRecord.updatedAt });
    session.start(record.voiceGuildId, record.voiceChannelId);
    await updateUserAndPanel(context, guildId, interaction.user.id, "voice", {
      voiceStatus: "reconnecting"
    });
    await editMissionReply(interaction, "Voice Session started.");
    return;
  }

  if (action === "stop") {
    await deferMissionReply(interaction);
    const key = sessionKey(guildId, interaction.user.id);
    voiceSessions.get(key)?.session.stop();
    voiceSessions.delete(key);
    await updateUserAndPanel(context, guildId, interaction.user.id, "voice", {
      voiceConnectedAt: null,
      voiceStatus: "disconnected"
    });
    await editMissionReply(interaction, "Voice Session disconnected.");
  }
}

async function handleRichPresenceButton(interaction: ButtonInteraction, context: BotContext, guildId: string, action: string) {
  const record = await context.api.getMissionToolsUser(guildId, interaction.user.id);

  if (action === "config") {
    await openRichPresenceConfigModal(interaction, guildId, record.richPresenceConfig);
    return;
  }

  if (action === "button") {
    await openRichPresenceButtonModal(interaction, guildId, record.richPresenceConfig);
    return;
  }

  if (action === "advanced") {
    await openRichPresenceAdvancedModal(interaction, guildId, record.richPresenceConfig);
    return;
  }

  if (action === "start") {
    await deferMissionReply(interaction);
    const tokenRecord = await requireUserTokenRecord(interaction, context, guildId);
    if (!tokenRecord) return;
    const token = tokenRecord.token;
    const validation = validateRichPresenceConfig(record.richPresenceConfig);
    if (validation) {
      await editMissionReply(interaction, validation);
      return;
    }

    const key = sessionKey(guildId, interaction.user.id);
    const current = richPresenceSessions.get(key);
    if (current && (current.token !== token || current.tokenUpdatedAt !== tokenRecord.updatedAt)) {
      current.session.stop();
    }
    const session = current?.token === token && current.tokenUpdatedAt === tokenRecord.updatedAt
      ? current.session
      : new DiscordRichPresenceSession(token, (status) => {
          void updateUserAndPanel(context, guildId, interaction.user.id, "richPresence", {
            richPresenceStatus: status
          });
        }, (error) => {
          void recordTokenAuthFailure(context, guildId, interaction.user.id, error, "rich-presence-gateway", "richPresence");
        });
    richPresenceSessions.set(key, { session, token, tokenUpdatedAt: tokenRecord.updatedAt });
    session.start(record.richPresenceConfig);
    await updateUserAndPanel(context, guildId, interaction.user.id, "richPresence", {
      richPresenceStatus: "active"
    });
    await editMissionReply(interaction, "Rich Presence ativado.");
    return;
  }

  if (action === "stop") {
    await deferMissionReply(interaction);
    const key = sessionKey(guildId, interaction.user.id);
    richPresenceSessions.get(key)?.session.stop();
    richPresenceSessions.delete(key);
    await updateUserAndPanel(context, guildId, interaction.user.id, "richPresence", {
      richPresenceStatus: "inactive"
    });
    await editMissionReply(interaction, "Rich Presence deactivated.");
    return;
  }

  if (action === "reset") {
    await deferMissionReply(interaction);
    await updateUserAndPanel(context, guildId, interaction.user.id, "richPresence", {
      richPresenceConfig: {},
      richPresenceStatus: "inactive",
      richPresenceUpdatedAt: new Date().toISOString()
    });
    await editMissionReply(interaction, "Configs do Rich Presence resetadas.");
  }
}

async function handleUsernameCheckerButton(interaction: ButtonInteraction, context: BotContext, guildId: string, action: string) {
  if (action === "config") {
    const record = await context.api.getMissionToolsUser(guildId, interaction.user.id);
    const modal = new ModalBuilder()
      .setCustomId(`${PREFIX}:modal:username-config:${guildId}`)
      .setTitle("Configurar Username Checker")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("username_length")
            .setLabel("Tamanho do username")
            .setMaxLength(2)
            .setRequired(true)
            .setStyle(TextInputStyle.Short)
            .setValue(String(record.usernameCheckerOptions.usernameLength ?? 4))
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("username_delay")
            .setLabel("Delay per attempt in ms")
            .setMaxLength(6)
            .setRequired(true)
            .setStyle(TextInputStyle.Short)
            .setValue(String(record.usernameCheckerOptions.requestDelay ?? 2000))
        )
      );
    await interaction.showModal(modal);
    return;
  }

  if (action === "start") {
    await deferMissionReply(interaction);
    const key = sessionKey(guildId, interaction.user.id);
    if (usernameCheckerSessions.has(key)) {
      await editMissionReply(interaction, "Username Checker is already running.");
      return;
    }

    const record = await context.api.getMissionToolsUser(guildId, interaction.user.id);
    const checker = new DiscordUsernameChecker();
    usernameCheckerSessions.set(key, checker);
    checker.on("stats", (stats: CheckerStats) => {
      void updateUserAndPanel(context, guildId, interaction.user.id, "usernameChecker", {
        usernameCheckerStats: stats,
        usernameCheckerStatus: "running",
        usernameCheckerUpdatedAt: new Date().toISOString()
      });
    });
    checker.on("hit", (username: string) => {
      void context.api.updateMissionToolsUser(guildId, interaction.user.id, {
        usernameCheckerLastEvent: `Disponivel: ${username}`,
        usernameCheckerUpdatedAt: new Date().toISOString()
      });
    });
    checker.on("taken", (username: string) => {
      void context.api.updateMissionToolsUser(guildId, interaction.user.id, {
        usernameCheckerLastEvent: `Em uso: ${username}`,
        usernameCheckerUpdatedAt: new Date().toISOString()
      });
    });
    checker.on("error", (payload: { message?: string }) => {
      void context.api.updateMissionToolsUser(guildId, interaction.user.id, {
        usernameCheckerLastEvent: payload.message ?? "Checker error",
        usernameCheckerUpdatedAt: new Date().toISOString()
      });
    });
    checker.on("stopped", () => {
      usernameCheckerSessions.delete(key);
      void updateUserAndPanel(context, guildId, interaction.user.id, "usernameChecker", {
        usernameCheckerStatus: "inactive"
      });
    });
    void checker.start(record.usernameCheckerOptions).catch((error) => {
      usernameCheckerSessions.delete(key);
      void updateUserAndPanel(context, guildId, interaction.user.id, "usernameChecker", {
        usernameCheckerLastEvent: errorMessage(error),
        usernameCheckerStatus: "error"
      });
    });
    await updateUserAndPanel(context, guildId, interaction.user.id, "usernameChecker", {
      username: displayUserName(interaction),
      usernameCheckerStatus: "running"
    });
    await editMissionReply(interaction, "Username Checker started.");
    return;
  }

  if (action === "stop") {
    await deferMissionReply(interaction);
    const key = sessionKey(guildId, interaction.user.id);
    await usernameCheckerSessions.get(key)?.stop();
    usernameCheckerSessions.delete(key);
    await updateUserAndPanel(context, guildId, interaction.user.id, "usernameChecker", {
      usernameCheckerStatus: "inactive"
    });
    await editMissionReply(interaction, "Username Checker stopped.");
  }
}

async function handleClearTargetModal(interaction: ModalSubmitInteraction, context: BotContext, guildId: string) {
  await deferMissionReply(interaction);
  const targetUserId = interaction.fields.getTextInputValue("clear_target_user_id").trim();
  await updateUserAndPanel(context, guildId, interaction.user.id, "clear", {
    clearMode: "userDm",
    clearTargetUserId: targetUserId,
    username: displayUserName(interaction)
  });
  await editMissionReply(interaction, "DM-by-ID cleanup configured.");
}

async function handleVoiceConfigModal(interaction: ModalSubmitInteraction, context: BotContext, guildId: string) {
  await deferMissionReply(interaction);
  const voiceGuildId = interaction.fields.getTextInputValue("voice_guild_id").trim();
  const voiceChannelId = interaction.fields.getTextInputValue("voice_channel_id").trim();
  await updateUserAndPanel(context, guildId, interaction.user.id, "voice", {
    username: displayUserName(interaction),
    voiceChannelId,
    voiceChannelName: voiceChannelId,
    voiceGuildId,
    voiceGuildName: voiceGuildId
  });
  await editMissionReply(interaction, "Voice Session configured.");
}

async function handleRichPresenceConfigModal(interaction: ModalSubmitInteraction, context: BotContext, guildId: string) {
  await deferMissionReply(interaction);
  const record = await context.api.getMissionToolsUser(guildId, interaction.user.id);
  const config = {
    ...record.richPresenceConfig,
    details: optionalField(interaction, "rich_details"),
    largeText: optionalField(interaction, "rich_large_text"),
    name: optionalField(interaction, "rich_name"),
    state: optionalField(interaction, "rich_state")
  };

  if (!config.name) {
    await editMissionReply(interaction, "Activity name is required.");
    return;
  }

  await applyRichConfig(context, guildId, interaction.user.id, config);
  await editMissionReply(interaction, "Rich Presence updated.");
}

async function handleRichPresenceButtonModal(interaction: ModalSubmitInteraction, context: BotContext, guildId: string) {
  await deferMissionReply(interaction);
  const record = await context.api.getMissionToolsUser(guildId, interaction.user.id);
  const config = {
    ...record.richPresenceConfig,
    buttonLabel: optionalField(interaction, "rich_button_label"),
    buttonUrl: optionalField(interaction, "rich_button_url")
  };

  if (Boolean(config.buttonLabel) !== Boolean(config.buttonUrl)) {
    await editMissionReply(interaction, "Provide both the button label and URL, or leave both empty.");
    return;
  }

  await applyRichConfig(context, guildId, interaction.user.id, config);
  await editMissionReply(interaction, "Rich Presence button updated.");
}

async function handleRichPresenceAdvancedModal(interaction: ModalSubmitInteraction, context: BotContext, guildId: string) {
  await deferMissionReply(interaction);
  const record = await context.api.getMissionToolsUser(guildId, interaction.user.id);
  const rawType = Number(optionalField(interaction, "rich_activity_type") ?? 0);
  const config = {
    ...record.richPresenceConfig,
    activityType: ([0, 1, 2, 3, 5].includes(rawType) ? rawType : 0) as MissionToolsRichPresenceConfig["activityType"],
    applicationId: optionalField(interaction, "rich_application_id"),
    largeImage: optionalField(interaction, "rich_large_image"),
    smallImage: optionalField(interaction, "rich_small_image"),
    startTimestamp: optionalField(interaction, "rich_start_time")
  };

  await applyRichConfig(context, guildId, interaction.user.id, config);
  await editMissionReply(interaction, "Advanced configuration updated.");
}

async function handleUsernameCheckerConfigModal(interaction: ModalSubmitInteraction, context: BotContext, guildId: string) {
  await deferMissionReply(interaction);
  const usernameLength = Number(interaction.fields.getTextInputValue("username_length"));
  const requestDelay = Number(interaction.fields.getTextInputValue("username_delay"));
  await updateUserAndPanel(context, guildId, interaction.user.id, "usernameChecker", {
    usernameCheckerOptions: {
      requestDelay,
      usernameLength
    },
    username: displayUserName(interaction)
  });
  await editMissionReply(interaction, "Username Checker configured.");
}

async function applyRichConfig(context: BotContext, guildId: string, userId: string, config: MissionToolsRichPresenceConfig) {
  await updateUserAndPanel(context, guildId, userId, "richPresence", {
    richPresenceConfig: config,
    richPresenceUpdatedAt: new Date().toISOString()
  });
  const key = sessionKey(guildId, userId);
  const session = richPresenceSessions.get(key);
  if (session) {
    session.session.update(config);
  }
}

async function updateMissionStatus(context: BotContext, guildId: string, userId: string, update: MissionStatusUpdate) {
  await updateUserAndPanel(context, guildId, userId, "mission", {
    completedCount: update.state === "Completed" && update.currentIndex ? update.currentIndex : undefined,
    currentMission: update.currentMission ?? null,
    missionDetail: update.detail ?? null,
    missionStatus: update.state === "Waiting"
      ? "waiting"
      : update.state === "Running"
        ? "running"
        : update.state === "Completed"
          ? "completed"
          : "error",
    progress: update.progress ?? undefined,
    totalMissions: update.totalMissions ?? undefined
  });
}

async function updateUserAndPanel(context: BotContext, guildId: string, userId: string, panelType: PanelType, input: MissionToolsUserPatch) {
  await context.api.updateMissionToolsUser(guildId, userId, input);
  await editOrCreateDmPanel(context, guildId, userId, panelType);
}

async function requireUserToken(interaction: ButtonInteraction | StringSelectMenuInteraction, context: BotContext, guildId: string) {
  void context;
  void guildId;
  await editReplySafely(interaction, USER_TOKEN_FEATURES_DISABLED_MESSAGE);
  return null;
}

async function requireUserTokenRecord(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  context: BotContext,
  guildId: string
): Promise<MissionToolsTokenResponse | null> {
  void context;
  void guildId;
  await editReplySafely(interaction, USER_TOKEN_FEATURES_DISABLED_MESSAGE);
  return null;
}

async function recordTokenAuthFailure(
  context: BotContext,
  guildId: string,
  userId: string,
  error: unknown,
  source: string,
  panelType: PanelType
) {
  if (!isDiscordTokenAuthError(error)) {
    return false;
  }

  try {
    const result = await context.api.markMissionToolsTokenAuthFailure(guildId, userId, {
      reason: error.message,
      source: error.source || source,
      statusCode: error.statusCode
    });
    stopUserRuntimeSessions(guildId, userId);
    await editOrCreateDmPanel(context, guildId, userId, panelType).catch(() => null);
    await refreshExistingUserDmPanels(context, guildId, result.user).catch(() => null);
  } catch (reportError) {
    console.warn("[mission-tools] failed to record rejected token:", errorMessage(reportError));
  }

  return true;
}

async function fetchVoiceOptionsSafely(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  context: BotContext,
  guildId: string,
  token: string,
  selectedGuildId?: string
) {
  try {
    const guildOptions = await fetchDiscordGuildOptions(token);
    const voiceChannelOptions = selectedGuildId
      ? await fetchDiscordVoiceChannelOptions(token, selectedGuildId)
      : [];

    return {
      guildOptions,
      voiceChannelOptions
    };
  } catch (error) {
    if (await recordTokenAuthFailure(context, guildId, interaction.user.id, error, "voice-options", "voice")) {
      await editReplySafely(interaction, errorMessage(error));
      return null;
    }

    throw error;
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

export async function publishConfiguredMissionToolsPanel(client: Client, context: BotContext, guildId: string) {
  return publishRequestedMissionToolsPanel(client, context, guildId);
}

async function publishMissionToolsPanel(client: Client, context: BotContext, guildId: string) {
  const guild = await client.guilds.fetch(guildId);
  const settings = await context.api.getMissionToolsSettings(guildId);

  if (!settings.enabled || !settings.panelChannelId) {
    throw new Error("Mission Tools is disabled or has no panel channel configured.");
  }

  const channel = await guild.channels.fetch(settings.panelChannelId);

  if (!channel || !channel.isTextBased() || !("messages" in channel)) {
    throw new Error("Invalid Mission Tools panel channel.");
  }

  assertPanelChannelPermissions(channel, client, "Mission Tools");

  const payload = buildMainPanelPayload(settings);
  let messageId: string | null = null;

  if (settings.panelMessageId) {
    const oldMessage = await channel.messages.fetch(settings.panelMessageId).catch(() => null);

    if (oldMessage) {
      if (oldMessage.flags.has(MessageFlags.IsComponentsV2)) {
        const edited = await oldMessage.edit(payload);
        await pinPanelMessage(edited, "Mission Tools");
        messageId = edited.id;
      } else {
        await oldMessage.delete().catch(() => null);
      }
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
  console.log(`[mission-tools] panel published in ${guild.name}.`);
  return saved;
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
        logPanelRequestError(key, `[mission-tools] failed to publish pending panel in ${settings.guildId}:`, error);
      });
    }
  } catch (error) {
    console.warn("[mission-tools] failed to check pending requests:", errorMessage(error));
  } finally {
    panelRequestCheckRunning = false;
  }
}

function buildMainPanelPayload(settings: MissionToolsSettings) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:main:select:${settings.guildId}`)
    .setPlaceholder("Select a module")
    .addOptions(
      featureOption(settings, "mission", "Mission System", "Manage mission automations and progress", MAIN_MISSION_VALUE),
      featureOption(settings, "clear", "Clean System", "Manage system cleanup operations", MAIN_CLEAR_VALUE),
      featureOption(settings, "voice", "Voice Session", "Manage a persistent voice channel session", MAIN_VOICE_VALUE),
      featureOption(settings, "rich-presence", "Rich Presence", "Manage profile activity display", MAIN_RICH_PRESENCE_VALUE),
      featureOption(settings, "username-checker", "Username Checker", "Manage username availability checks", MAIN_USERNAME_CHECKER_VALUE),
      new StringSelectMenuOptionBuilder()
        .setDescription("Remove panel messages sent by the bot in DM")
        .setLabel("Delete Bot DM")
        .setValue(MAIN_DELETE_DM_VALUE)
    );
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  const container = new ContainerBuilder()
    .setAccentColor(PANEL_ACCENT)
    .addTextDisplayComponents(text("# Control Center\nSelect a module to open its dedicated interface by direct message."))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(`**Status:** ${settings.enabled ? "Active" : "Inactive"}\n**Enabled modules:** ${settings.enabledFeatures.length}`))
    .addActionRowComponents(row);

  return componentsV2Payload(container);
}

function buildClearPanelPayload(record: MissionToolsUserPanel) {
  const modeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(`${PREFIX}:clear:bulk:${record.guildId}`, "Bulk", record.clearMode === "bulk" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    button(`${PREFIX}:clear:target:${record.guildId}`, "DM by ID", record.clearMode === "userDm" ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );
  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(`${PREFIX}:clear:start:${record.guildId}`, "Start", ButtonStyle.Secondary),
    button(`${PREFIX}:clear:token:${record.guildId}`, "Fake token", ButtonStyle.Secondary),
    button(`${PREFIX}:clear:deactivate:${record.guildId}`, "Deactivate", ButtonStyle.Secondary)
  );
  const container = new ContainerBuilder()
    .setAccentColor(PANEL_ACCENT)
    .addTextDisplayComponents(text("# Clean System\nCleanup operations and account maintenance."))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      `**System Status:** ${statusLabel(record.clearStatus)}\n`
      + `**Configured Token:** ${tokenLabel(record.tokenConfigured, record.tokenStatus)}\n`
      + `**Cleanup mode:** ${record.clearMode === "userDm" ? "DM by ID" : "Bulk"}\n`
      + `**Target user ID:** ${record.clearTargetUserId ?? "Not defined"}\n`
      + `**Current Execution:** ${record.currentMission ?? "No execution in progress"}\n`
      + `**Last Synchronization:** ${formatUpdatedAt(record.updatedAt)}`
    ))
    .addSeparatorComponents(separator())
    .addActionRowComponents(modeRow)
    .addActionRowComponents(actionRow);

  return componentsV2Payload(container);
}

function buildMissionPanelPayload(record: MissionToolsUserPanel) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(`${PREFIX}:mission:start:${record.guildId}`, "Start", ButtonStyle.Secondary),
    button(`${PREFIX}:mission:token:${record.guildId}`, "Fake token", ButtonStyle.Secondary),
    button(`${PREFIX}:mission:deactivate:${record.guildId}`, "Deactivate", ButtonStyle.Secondary)
  );
  const container = new ContainerBuilder()
    .setAccentColor(PANEL_ACCENT)
    .addTextDisplayComponents(text("# Mission System\nMission automation status and execution controls."))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      `**System:** Mission System\n`
      + `**Status:** ${statusLabel(record.missionStatus)}\n`
      + `**Token:** ${tokenLabel(record.tokenConfigured, record.tokenStatus)}\n`
      + `**Current Mission:** ${record.currentMission ?? "No mission in progress"}\n`
      + `**Detail:** ${record.missionDetail ?? "No recent event"}\n`
      + `**Progress:** ${Math.round(record.progress)}%\n`
      + `**Last Synchronization:** ${formatUpdatedAt(record.updatedAt)}`
    ))
    .addSeparatorComponents(separator())
    .addActionRowComponents(row);

  return componentsV2Payload(container);
}

function buildVoicePanelPayload(record: MissionToolsUserPanel, options: PanelRenderOptions = {}) {
  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(`${PREFIX}:voice:token:${record.guildId}`, "Fake token", ButtonStyle.Secondary),
    button(`${PREFIX}:voice:load:${record.guildId}`, "Load channels", ButtonStyle.Secondary),
    button(`${PREFIX}:voice:manual:${record.guildId}`, "Manual IDs", ButtonStyle.Secondary),
    button(`${PREFIX}:voice:start:${record.guildId}`, "Connect", ButtonStyle.Secondary),
    button(`${PREFIX}:voice:stop:${record.guildId}`, "Disconnect", ButtonStyle.Secondary)
  );
  const container = new ContainerBuilder()
    .setAccentColor(PANEL_ACCENT)
    .addTextDisplayComponents(text("# Voice Session\nManage a persistent voice-channel session."))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      `**Connected server:** ${record.voiceGuildName ?? "Not selected"}\n`
      + `**Current channel:** ${record.voiceChannelName ?? "Not selected"}\n`
      + `**Active connection time:** ${durationLabel(record.voiceConnectedAt)}\n`
      + `**Session status:** ${voiceStatusLabel(record.voiceStatus)}\n`
      + `**Token state:** ${tokenLabel(record.tokenConfigured, record.tokenStatus)}`
    ))
    .addSeparatorComponents(separator());

  if (options.guildOptions?.length) {
    container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      selectMenu(`${PREFIX}:voice:guild:${record.guildId}`, record.voiceGuildName ?? "Select server", options.guildOptions.map((guild) => ({
        label: guild.name,
        value: guild.id
      })))
    ));
  }

  if (options.voiceChannelOptions?.length) {
    container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      selectMenu(`${PREFIX}:voice:channel:${record.guildId}`, record.voiceChannelName ?? "Select voice channel", options.voiceChannelOptions.map((channel) => ({
        label: channel.name,
        value: channel.id
      })))
    ));
  }

  container.addActionRowComponents(controls);
  return componentsV2Payload(container);
}

function buildRichPresencePanelPayload(record: MissionToolsUserPanel) {
  const config = record.richPresenceConfig;
  const rowOne = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(`${PREFIX}:rich:start:${record.guildId}`, "Activate", ButtonStyle.Success),
    button(`${PREFIX}:rich:stop:${record.guildId}`, "Deactivate", ButtonStyle.Secondary),
    button(`${PREFIX}:rich:reset:${record.guildId}`, "Reset", ButtonStyle.Danger)
  );
  const rowTwo = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(`${PREFIX}:rich:config:${record.guildId}`, "Edit text", ButtonStyle.Primary),
    button(`${PREFIX}:rich:button:${record.guildId}`, "Button", ButtonStyle.Secondary),
    button(`${PREFIX}:rich:advanced:${record.guildId}`, "Advanced", ButtonStyle.Secondary),
    button(`${PREFIX}:rich:token:${record.guildId}`, "Fake token", ButtonStyle.Secondary)
  );
  const container = new ContainerBuilder()
    .setAccentColor(PANEL_ACCENT)
    .addTextDisplayComponents(text("# Customize Rich Presence\nAdjust the fields and activate the configuration when ready."))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      `**Status:** ${record.richPresenceStatus === "active" ? "Active" : "Inactive"}\n`
      + `**Token:** ${tokenLabel(record.tokenConfigured, record.tokenStatus)}\n`
      + `**Name:** ${codeValue(config.name)}\n`
      + `**Details:** ${codeValue(config.details)}\n`
      + `**State:** ${codeValue(config.state)}\n`
      + `**Button:** ${config.buttonLabel && config.buttonUrl ? `${config.buttonLabel} -> ${config.buttonUrl}` : "not defined"}\n`
      + `**Large image:** ${config.largeImage ?? "not defined"}`
    ))
    .addSeparatorComponents(separator())
    .addActionRowComponents(rowOne)
    .addActionRowComponents(rowTwo);

  return componentsV2Payload(container);
}

function buildUsernameCheckerPanelPayload(record: MissionToolsUserPanel) {
  const stats = record.usernameCheckerStats;
  const options = record.usernameCheckerOptions;
  const isRunning = record.usernameCheckerStatus === "running" || record.usernameCheckerStatus === "waiting";
  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(`${PREFIX}:username:start:${record.guildId}`, "Start", ButtonStyle.Secondary, isRunning),
    button(`${PREFIX}:username:config:${record.guildId}`, "Configure", ButtonStyle.Secondary, isRunning),
    button(`${PREFIX}:username:stop:${record.guildId}`, "Stop", ButtonStyle.Danger, !isRunning)
  );
  const container = new ContainerBuilder()
    .setAccentColor(PANEL_ACCENT)
    .addTextDisplayComponents(text("# Username Checker\nUsername availability status and controls."))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      `**Status:** ${statusLabel(record.usernameCheckerStatus)}\n`
      + `**Length:** ${options.usernameLength ?? 4}\n`
      + `**Delay:** ${options.requestDelay ?? 2000}ms\n`
      + `**Last Event:** ${record.usernameCheckerLastEvent ?? "No recent event"}\n`
      + `**Last Update:** ${record.usernameCheckerUpdatedAt ? formatUpdatedAt(record.usernameCheckerUpdatedAt) : "Never"}`
    ))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      `**Hits:** ${stats.hits}\n`
      + `**Taken:** ${stats.taken}\n`
      + `**Errors:** ${stats.errors}\n`
      + `**Workers Running:** ${stats.workersRunning}`
    ))
    .addSeparatorComponents(separator())
    .addActionRowComponents(controls);

  return componentsV2Payload(container);
}

async function sendDmPanel(interaction: StringSelectMenuInteraction, context: BotContext, guildId: string, panelType: PanelType) {
  await deferMissionReply(interaction);
  const settings = await context.api.getMissionToolsSettings(guildId);
  const feature = featureFromPanelType(panelType);

  if (!settings.enabled || !isFeatureEnabled(settings, feature)) {
    await editMissionReply(interaction, "This Mission Tools module is not enabled in the dashboard.");
    return;
  }

  if (!(await userCanUsePanel(interaction, settings))) {
    await editMissionReply(interaction, "You do not have an authorized role for Mission Tools.");
    return;
  }

  await context.api.updateMissionToolsUser(guildId, interaction.user.id, {
    username: displayUserName(interaction)
  });
  await editOrCreateDmPanel(context, guildId, interaction.user.id, panelType);
  await editMissionReply(interaction, "I sent the panel by direct message.");
}

async function editOrCreateDmPanel(context: BotContext, guildId: string, userId: string, panelType: PanelType, options: PanelRenderOptions = {}) {
  const user = await context.client.users.fetch(userId);
  const dm = await user.createDM();
  const record = await context.api.getMissionToolsUser(guildId, userId);
  const messageId = messageIdForPanel(record, panelType);
  const payload = payloadForPanel(record, panelType, options);

  if (messageId) {
    const message = await dm.messages.fetch(messageId).catch(() => null);
    if (message) {
      await message.edit(payload).catch(() => null);
      await context.api.updateMissionToolsUser(guildId, userId, {
        dmChannelId: dm.id,
        ...messagePatchForPanel(panelType, message.id)
      });
      return record;
    }
  }

  const message = await dm.send(payload);
  await context.api.updateMissionToolsUser(guildId, userId, {
    dmChannelId: dm.id,
    ...messagePatchForPanel(panelType, message.id)
  });
  return record;
}

async function refreshExistingUserDmPanels(context: BotContext, guildId: string, payloadUser: unknown) {
  const userId = missionToolsPayloadUserId(payloadUser);
  if (!userId) {
    return 0;
  }

  const record = await context.api.getMissionToolsUser(guildId, userId);
  const user = await context.client.users.fetch(userId).catch(() => null);
  if (!user) {
    return 0;
  }

  const dm = await user.createDM().catch(() => null);
  if (!dm) {
    return 0;
  }

  let updated = 0;
  const panelTypes: PanelType[] = ["clear", "mission", "voice", "richPresence", "usernameChecker"];

  for (const panelType of panelTypes) {
    const messageId = messageIdForPanel(record, panelType);
    if (!messageId) {
      continue;
    }

    const message = await dm.messages.fetch(messageId).catch(() => null);
    if (!message) {
      continue;
    }

    const payload = payloadForPanel(record, panelType, {});
    const edited = await message.edit(payload).then(() => true).catch(() => false);
    if (edited) {
      updated += 1;
    }
  }

  return updated;
}

async function deleteBotDmPanels(interaction: StringSelectMenuInteraction, context: BotContext, guildId: string) {
  await deferMissionReply(interaction);
  const user = await context.client.users.fetch(interaction.user.id);
  const dm = await user.createDM();
  const messages = await dm.messages.fetch({ limit: 100 }).catch(() => null);
  let deleted = 0;

  if (messages) {
    for (const message of messages.values()) {
      if (message.author.id !== context.client.user?.id) continue;
      if (!message.components.length) continue;
      await message.delete().then(() => {
        deleted += 1;
      }).catch(() => null);
    }
  }

  await context.api.updateMissionToolsUser(guildId, interaction.user.id, {
    clearMessageId: null,
    dmChannelId: dm.id,
    missionMessageId: null,
    richPresenceMessageId: null,
    usernameCheckerMessageId: null,
    voiceMessageId: null
  });
  await editMissionReply(interaction, `Mission Tools direct messages removed: ${deleted}.`);
}

async function resetMainPanelSelection(interaction: StringSelectMenuInteraction, context: BotContext, guildId: string) {
  if (!interaction.message.editable) {
    return;
  }

  const settings = await context.api.getMissionToolsSettings(guildId);
  await interaction.message.edit(buildMainPanelPayload(settings)).catch(() => null);
}

function payloadForPanel(record: MissionToolsUserPanel, panelType: PanelType, options: PanelRenderOptions) {
  if (panelType === "clear") return buildClearPanelPayload(record);
  if (panelType === "mission") return buildMissionPanelPayload(record);
  if (panelType === "voice") return buildVoicePanelPayload(record, options);
  if (panelType === "richPresence") return buildRichPresencePanelPayload(record);
  return buildUsernameCheckerPanelPayload(record);
}

function messageIdForPanel(record: MissionToolsUserPanel, panelType: PanelType) {
  if (panelType === "clear") return record.clearMessageId;
  if (panelType === "mission") return record.missionMessageId;
  if (panelType === "voice") return record.voiceMessageId;
  if (panelType === "richPresence") return record.richPresenceMessageId;
  return record.usernameCheckerMessageId;
}

function messagePatchForPanel(panelType: PanelType, messageId: string) {
  if (panelType === "clear") return { clearMessageId: messageId };
  if (panelType === "mission") return { missionMessageId: messageId };
  if (panelType === "voice") return { voiceMessageId: messageId };
  if (panelType === "richPresence") return { richPresenceMessageId: messageId };
  return { usernameCheckerMessageId: messageId };
}

function openRichPresenceConfigModal(interaction: ButtonInteraction, guildId: string, config: MissionToolsRichPresenceConfig) {
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:rich-config:${guildId}`)
    .setTitle("Rich Presence Content")
    .addComponents(
      textInputRow("rich_name", "Activity name", config.name, true),
      textInputRow("rich_details", "Details", config.details, false),
      textInputRow("rich_state", "State", config.state, false),
      textInputRow("rich_large_text", "Large image text", config.largeText, false)
    );
  return interaction.showModal(modal);
}

function openRichPresenceButtonModal(interaction: ButtonInteraction, guildId: string, config: MissionToolsRichPresenceConfig) {
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:rich-button:${guildId}`)
    .setTitle("Configure Button")
    .addComponents(
      textInputRow("rich_button_label", "Button label", config.buttonLabel, false),
      textInputRow("rich_button_url", "Button URL", config.buttonUrl, false)
    );
  return interaction.showModal(modal);
}

function openRichPresenceAdvancedModal(interaction: ButtonInteraction, guildId: string, config: MissionToolsRichPresenceConfig) {
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:rich-advanced:${guildId}`)
    .setTitle("Advanced Rich Presence")
    .addComponents(
      textInputRow("rich_activity_type", "Type: 0, 1, 2, 3, or 5", String(config.activityType ?? 0), false),
      textInputRow("rich_application_id", "Application ID", config.applicationId, false),
      textInputRow("rich_large_image", "Large image URL/asset", config.largeImage, false, TextInputStyle.Paragraph),
      textInputRow("rich_small_image", "Small image URL/asset", config.smallImage, false, TextInputStyle.Paragraph),
      textInputRow("rich_start_time", "Optional start time", config.startTimestamp, false)
    );
  return interaction.showModal(modal);
}

function textInputRow(customId: string, label: string, value: string | undefined, required: boolean, style: TextInputStyle = TextInputStyle.Short) {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setMaxLength(style === TextInputStyle.Paragraph ? 1024 : 128)
      .setRequired(required)
      .setStyle(style)
      .setValue(value ?? "")
  );
}

function optionalField(interaction: ModalSubmitInteraction, customId: string) {
  const value = interaction.fields.getTextInputValue(customId).trim();
  return value || undefined;
}

function validateRichPresenceConfig(config: MissionToolsRichPresenceConfig) {
  if (!config.name?.trim()) {
    return "Configure o nome da atividade antes de ativar.";
  }

  if (config.activityType === 1 && !isSupportedStreamingUrl(config.buttonUrl)) {
    return "Para usar Transmitindo, a URL precisa ser Twitch ou YouTube.";
  }

  return null;
}

function isSupportedStreamingUrl(value?: string) {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "twitch.tv" || hostname.endsWith(".twitch.tv") || hostname === "youtube.com" || hostname.endsWith(".youtube.com") || hostname === "youtu.be";
  } catch {
    return false;
  }
}

function selectMenu(customId: string, placeholder: string, options: Array<{ label: string; value: string }>) {
  return new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(truncate(placeholder, 150))
    .addOptions(options.slice(0, 25).map((option) => new StringSelectMenuOptionBuilder()
      .setLabel(truncate(option.label, 100))
      .setValue(option.value)));
}

function featureOption(settings: MissionToolsSettings, feature: MissionToolsFeatureId, label: string, description: string, value: string) {
  return new StringSelectMenuOptionBuilder()
    .setDefault(false)
    .setDescription(isFeatureEnabled(settings, feature) ? description : "Module disabled in the dashboard")
    .setLabel(label)
    .setValue(value);
}

function text(content: string) {
  return new TextDisplayBuilder().setContent(content);
}

function separator() {
  return new SeparatorBuilder().setDivider(true);
}

function componentsV2Payload(container: ContainerBuilder) {
  return {
    allowedMentions: {
      parse: []
    },
    components: [container],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function button(customId: string, label: string, style: ButtonStyle, disabled = false) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setDisabled(disabled)
    .setLabel(label)
    .setStyle(style);
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    active: "Active",
    completed: "Completed",
    deactivated: "Deactivated",
    error: "Error",
    inactive: "Inactive",
    running: "Running",
    waiting: "Waiting"
  };

  return labels[status] ?? status;
}

function voiceStatusLabel(status: string) {
  const labels: Record<string, string> = {
    connected: "Connected",
    disconnected: "Disconnected",
    reconnecting: "Reconnecting"
  };

  return labels[status] ?? status;
}

function durationLabel(value?: string | null) {
  if (!value) return "No active connection";

  const startedAt = new Date(value).getTime();
  if (Number.isNaN(startedAt)) return "Unavailable";

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  return hours > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`;
}

function tokenLabel(tokenConfigured: boolean, status?: string | null) {
  void tokenConfigured;
  void status;
  return status === "fake" ? "Fake token" : "Blocked for safety";
}

function codeValue(value?: string) {
  return `\`${value || "not defined"}\``;
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(date);
}

function missionToolsPayloadUserId(value: unknown) {
  if (!value || typeof value !== "object" || !("userId" in value)) {
    return null;
  }

  const userId = (value as { userId?: unknown }).userId;
  return typeof userId === "string" && /^\d{5,32}$/.test(userId) ? userId : null;
}

function missionToolsPayloadTokenStatus(value: unknown) {
  if (!value || typeof value !== "object" || !("tokenStatus" in value)) {
    return null;
  }

  const status = (value as { tokenStatus?: unknown }).tokenStatus;
  return typeof status === "string" ? status : null;
}

function missionToolsPayloadTokenUpdatedAt(value: unknown) {
  if (!value || typeof value !== "object" || !("tokenUpdatedAt" in value)) {
    return null;
  }

  const updatedAt = (value as { tokenUpdatedAt?: unknown }).tokenUpdatedAt;
  return typeof updatedAt === "string" && updatedAt ? updatedAt : null;
}

function invalidateRuntimeSessionsFromUserPayload(guildId: string, payloadUser: unknown) {
  const userId = missionToolsPayloadUserId(payloadUser);
  if (!userId) {
    return;
  }

  const status = missionToolsPayloadTokenStatus(payloadUser);
  const tokenUpdatedAt = missionToolsPayloadTokenUpdatedAt(payloadUser);
  const key = sessionKey(guildId, userId);

  if (status && status !== "connected") {
    stopUserRuntimeSessions(guildId, userId);
    return;
  }

  const voiceSession = voiceSessions.get(key);
  const richSession = richPresenceSessions.get(key);
  if (
    tokenUpdatedAt
    && ((voiceSession && voiceSession.tokenUpdatedAt !== tokenUpdatedAt)
      || (richSession && richSession.tokenUpdatedAt !== tokenUpdatedAt))
  ) {
    stopUserRuntimeSessions(guildId, userId);
  }
}

function panelTypeFromMainValue(value: string | undefined): PanelType | null {
  if (value === MAIN_CLEAR_VALUE) return "clear";
  if (value === MAIN_MISSION_VALUE) return "mission";
  if (value === MAIN_VOICE_VALUE) return "voice";
  if (value === MAIN_RICH_PRESENCE_VALUE) return "richPresence";
  if (value === MAIN_USERNAME_CHECKER_VALUE) return "usernameChecker";
  return null;
}

function panelTypeFromScope(scope: string | undefined): PanelType {
  if (scope === "clear") return "clear";
  if (scope === "voice") return "voice";
  if (scope === "rich") return "richPresence";
  if (scope === "username") return "usernameChecker";
  return "mission";
}

function featureFromPanelType(panelType: PanelType): MissionToolsFeatureId {
  if (panelType === "richPresence") return "rich-presence";
  if (panelType === "usernameChecker") return "username-checker";
  return panelType;
}

function isFeatureEnabled(settings: MissionToolsSettings, feature: MissionToolsFeatureId) {
  return settings.enabledFeatures.includes(feature);
}

async function userCanUsePanel(interaction: StringSelectMenuInteraction, settings: MissionToolsSettings) {
  if (!settings.allowedRoleIds.length) {
    return true;
  }

  if (!interaction.inCachedGuild()) {
    return false;
  }

  const memberRoleIds = new Set(interaction.member.roles.cache.keys());
  return settings.allowedRoleIds.some((roleId) => memberRoleIds.has(roleId));
}

function sessionKey(guildId: string, userId: string) {
  return `${env.DASHBOARD_BOT_ID || "bot"}:${guildId}:${userId}`;
}

function invalidateMissionRunVersion(guildId: string, userId: string) {
  const key = sessionKey(guildId, userId);
  missionRunVersions.set(key, (missionRunVersions.get(key) ?? 0) + 1);
}

function stopUserRuntimeSessions(guildId: string, userId: string) {
  const key = sessionKey(guildId, userId);
  cleanupControllers.get(key)?.abort("Fake token detected; use an official bot or OAuth flow.");
  cleanupControllers.delete(key);
  voiceSessions.get(key)?.session.stop();
  voiceSessions.delete(key);
  richPresenceSessions.get(key)?.session.stop();
  richPresenceSessions.delete(key);
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

function isPayloadForThisBot(botId: string | null | undefined) {
  return !botId || !env.DASHBOARD_BOT_ID || botId === env.DASHBOARD_BOT_ID;
}

async function replySafely(interaction: Interaction, content: string) {
  if (!interaction.isRepliable()) {
    return;
  }

  try {
    if (interaction.replied || interaction.deferred) {
      const message = await interaction.followUp(missionReplyPayload(interaction, content));
      scheduleDmMessageDelete(interaction, message);
      return;
    }

    await interaction.reply(missionReplyPayload(interaction, content));
    scheduleDmReplyDelete(interaction);
  } catch (error) {
    console.warn("[mission-tools] interaction response failed:", errorMessage(error));
  }
}

async function editReplySafely(interaction: ButtonInteraction | StringSelectMenuInteraction, content: string) {
  try {
    if (interaction.replied || interaction.deferred) {
      await editMissionReply(interaction, content);
      return;
    }

    await interaction.reply(missionReplyPayload(interaction, content));
    scheduleDmReplyDelete(interaction);
  } catch (error) {
    console.warn("[mission-tools] interaction response could not be edited:", errorMessage(error));
  }
}

async function editMissionReply(interaction: MissionReplyInteraction, content: string) {
  await interaction.editReply(content);
  scheduleDmReplyDelete(interaction);
}

function scheduleDmReplyDelete(interaction: Interaction) {
  if (interaction.inGuild() || !interaction.isRepliable()) {
    return;
  }

  const timer = setTimeout(() => {
    void interaction.deleteReply().catch(() => null);
  }, DM_REPLY_CLEANUP_DELAY_MS);
  timer.unref?.();
}

function scheduleDmMessageDelete(interaction: Interaction, message: unknown) {
  if (interaction.inGuild()) {
    return;
  }

  const deletable = message as { delete?: () => Promise<unknown> };
  if (typeof deletable.delete !== "function") {
    return;
  }
  const deleteMessage = deletable.delete.bind(deletable);

  const timer = setTimeout(() => {
    void deleteMessage().catch(() => null);
  }, DM_REPLY_CLEANUP_DELAY_MS);
  timer.unref?.();
}

async function deferMissionReply(interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction) {
  const options = missionReplyOptions(interaction);

  if (options) {
    await interaction.deferReply(options);
    return;
  }

  await interaction.deferReply();
}

function missionReplyPayload(interaction: Interaction, content: string) {
  return interaction.inGuild()
    ? {
        content,
        flags: MessageFlags.Ephemeral as const
      }
    : {
        content
      };
}

function missionReplyOptions(interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction) {
  return interaction.inGuild()
    ? { flags: MessageFlags.Ephemeral as const }
    : undefined;
}

function displayUserName(interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction) {
  if (interaction.member && typeof interaction.member === "object" && "displayName" in interaction.member) {
    return interaction.member.displayName;
  }

  return interaction.user.globalName || interaction.user.username;
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

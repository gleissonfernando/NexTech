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

let serviceStarted = false;
let panelRequestCheckRunning = false;
const handledPanelRequests = new Map<string, string>();
const panelPublishPromises = new Map<string, Promise<MissionToolsSettings>>();
const panelRequestErrorLogAt = new Map<string, number>();
const missionQueue = new MissionQueue();
const cleanupControllers = new Map<string, AbortController>();
const voiceSessions = new Map<string, { session: DiscordVoiceSession; token: string }>();
const richPresenceSessions = new Map<string, { session: DiscordRichPresenceSession; token: string }>();
const usernameCheckerSessions = new Map<string, DiscordUsernameChecker>();

export function startMissionToolsService(client: Client, context: BotContext) {
  if (!isBotModuleEnabled(MODULE_ID) || serviceStarted) {
    return;
  }

  serviceStarted = true;

  context.socket.onMissionToolsSettingsUpdated((payload) => {
    if (!isBotModuleEnabled(MODULE_ID) || !isPayloadForThisBot(payload.botId)) {
      return;
    }

    console.log(`[mission-tools] configuracao atualizada para ${payload.guildId}.`);
  });

  context.socket.onMissionToolsPanelPublish((payload) => {
    if (!isBotModuleEnabled(MODULE_ID) || !isPayloadForThisBot(payload.botId)) {
      return;
    }

    void publishRequestedMissionToolsPanel(client, context, payload.guildId).catch((error) => {
      console.error(`[mission-tools] falha ao publicar painel em ${payload.guildId}:`, errorMessage(error));
    });
  });

  context.socket.onMissionToolsUserUpdated((payload) => {
    if (!isBotModuleEnabled(MODULE_ID) || !isPayloadForThisBot(payload.botId)) {
      return;
    }

    void refreshExistingUserDmPanels(context, payload.guildId, payload.user)
      .then((updated) => {
        console.log(`[mission-tools] painel de usuario atualizado em ${payload.guildId}: ${updated} mensagem(ns).`);
      })
      .catch((error) => {
        console.warn(`[mission-tools] falha ao atualizar painel privado em ${payload.guildId}:`, errorMessage(error));
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
  if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) {
    return false;
  }

  if (!interaction.customId.startsWith(`${PREFIX}:`)) {
    return false;
  }

  if (!isBotModuleEnabled(MODULE_ID)) {
    await replySafely(interaction, "O Mission Tools nao foi liberado para este bot na dashboard.");
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
    console.error("[mission-tools] falha ao processar interacao:", error);
    await replySafely(interaction, readRequestErrorMessage(error) ?? "Nao foi possivel processar essa interacao do Mission Tools.");
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
    await replySafely(interaction, "Painel Mission Tools invalido.");
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
      await replySafely(interaction, "Modulo Mission Tools invalido.");
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

    const guildOptions = await fetchDiscordGuildOptions(token);
    const selectedGuild = guildOptions.find((guild) => guild.id === selected);
    const channelOptions = await fetchDiscordVoiceChannelOptions(token, selected);
    await context.api.updateMissionToolsUser(guildId, interaction.user.id, {
      username: displayUserName(interaction),
      voiceChannelId: null,
      voiceChannelName: null,
      voiceGuildId: selected,
      voiceGuildName: selectedGuild?.name ?? selected
    });
    await editOrCreateDmPanel(context, guildId, interaction.user.id, "voice", {
      guildOptions,
      voiceChannelOptions: channelOptions
    });
    await interaction.editReply("Servidor de voz selecionado. Agora escolha o canal.");
    return;
  }

  if (scope === "voice" && action === "channel" && selected) {
    await deferMissionReply(interaction);
    const record = await context.api.getMissionToolsUser(guildId, interaction.user.id);
    const token = await requireUserToken(interaction, context, guildId);
    if (!token) return;
    const channelOptions = record.voiceGuildId
      ? await fetchDiscordVoiceChannelOptions(token, record.voiceGuildId)
      : [];
    const selectedChannel = channelOptions.find((channel) => channel.id === selected);

    await context.api.updateMissionToolsUser(guildId, interaction.user.id, {
      username: displayUserName(interaction),
      voiceChannelId: selected,
      voiceChannelName: selectedChannel?.name ?? selected
    });
    await editOrCreateDmPanel(context, guildId, interaction.user.id, "voice", {
      voiceChannelOptions: channelOptions
    });
    await interaction.editReply("Canal de voz selecionado.");
    return;
  }

  await replySafely(interaction, "Selecao do Mission Tools nao reconhecida.");
}

async function handleButton(interaction: ButtonInteraction, context: BotContext) {
  const parts = interaction.customId.split(":");
  const scope = parts[1];
  const action = parts[2];
  const guildId = parts[3];

  if (!scope || !action || !guildId) {
    await replySafely(interaction, "Acao Mission Tools invalida.");
    return;
  }

  if (action === "token") {
    await showTokenDashboardInstructions(interaction, guildId);
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

  await replySafely(interaction, "Acao Mission Tools nao reconhecida.");
}

async function handleModal(interaction: ModalSubmitInteraction, context: BotContext) {
  const parts = interaction.customId.split(":");
  const modal = parts[2];
  const guildId = parts[3];

  if (!modal || !guildId) {
    await replySafely(interaction, "Formulario Mission Tools invalido.");
    return;
  }

  if (modal === "token") {
    await handleTokenModal(interaction, guildId);
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

  await replySafely(interaction, "Formulario Mission Tools nao reconhecido.");
}

async function handleMissionButton(interaction: ButtonInteraction, context: BotContext, guildId: string, action: string) {
  if (action === "start") {
    await deferMissionReply(interaction);
    const token = await requireUserToken(interaction, context, guildId);
    if (!token) return;

    const queued = missionQueue.enqueue({
      userId: sessionKey(guildId, interaction.user.id),
      onCancelled: async (reason) => {
        await updateUserAndPanel(context, guildId, interaction.user.id, "mission", {
          missionDetail: reason,
          missionStatus: "deactivated"
        });
      },
      onFailed: async (reason) => {
        await updateUserAndPanel(context, guildId, interaction.user.id, "mission", {
          missionDetail: reason,
          missionStatus: "error"
        });
      },
      onQueued: async (position) => {
        await updateUserAndPanel(context, guildId, interaction.user.id, "mission", {
          currentMission: `Fila #${position}`,
          missionDetail: "Aguardando execucao.",
          missionStatus: "waiting",
          username: displayUserName(interaction)
        });
      },
      onRejected: async (reason) => {
        await interaction.editReply(reason);
      },
      run: async (signal) => {
        await runMissionFlow(token, async (update) => {
          await updateMissionStatus(context, guildId, interaction.user.id, update);
        }, signal);
      }
    });
    if (queued) {
      await interaction.editReply("Mission System iniciado. Acompanhe pelo painel privado.");
    }
    return;
  }

  if (action === "deactivate") {
    await deferMissionReply(interaction);
    const cancelled = missionQueue.cancelUser(sessionKey(guildId, interaction.user.id), "Mission System desativado pelo usuario.");
    await updateUserAndPanel(context, guildId, interaction.user.id, "mission", {
      missionDetail: cancelled ? "Operacao cancelada." : "Nenhuma operacao em andamento.",
      missionStatus: "deactivated",
      progress: 0
    });
    await interaction.editReply("Mission System desativado.");
  }
}

async function handleClearButton(interaction: ButtonInteraction, context: BotContext, guildId: string, action: string) {
  if (action === "bulk") {
    await deferMissionReply(interaction);
    await updateUserAndPanel(context, guildId, interaction.user.id, "clear", {
      clearMode: "bulk",
      username: displayUserName(interaction)
    });
    await interaction.editReply("Modo de limpeza alterado para em massa.");
    return;
  }

  if (action === "target") {
    const record = await context.api.getMissionToolsUser(guildId, interaction.user.id);
    const modal = new ModalBuilder()
      .setCustomId(`${PREFIX}:modal:clear-target:${guildId}`)
      .setTitle("Limpar DM por User ID")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("clear_target_user_id")
            .setLabel("User ID da pessoa")
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
    const token = await requireUserToken(interaction, context, guildId);
    if (!token) return;
    const record = await context.api.getMissionToolsUser(guildId, interaction.user.id);
    const key = sessionKey(guildId, interaction.user.id);

    if (cleanupControllers.has(key)) {
      await interaction.editReply("Clean System ja esta rodando.");
      return;
    }

    const controller = new AbortController();
    cleanupControllers.set(key, controller);
    await updateUserAndPanel(context, guildId, interaction.user.id, "clear", {
      clearStatus: "running",
      currentMission: record.clearMode === "userDm" ? "Limpando DM por ID" : "Limpeza em massa",
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
          currentMission: "Limpeza finalizada"
        });
      })
      .catch(async (error) => {
        await updateUserAndPanel(context, guildId, interaction.user.id, "clear", {
          clearStatus: controller.signal.aborted ? "deactivated" : "error",
          currentMission: errorMessage(error)
        });
      })
      .finally(() => cleanupControllers.delete(key));
    await interaction.editReply("Clean System iniciado.");
    return;
  }

  if (action === "deactivate") {
    await deferMissionReply(interaction);
    cleanupControllers.get(sessionKey(guildId, interaction.user.id))?.abort("Clean System desativado pelo usuario.");
    cleanupControllers.delete(sessionKey(guildId, interaction.user.id));
    await updateUserAndPanel(context, guildId, interaction.user.id, "clear", {
      clearStatus: "deactivated",
      currentMission: "Sistema desativado"
    });
    await interaction.editReply("Clean System desativado.");
  }
}

async function handleVoiceButton(interaction: ButtonInteraction, context: BotContext, guildId: string, action: string) {
  if (action === "load") {
    await deferMissionReply(interaction);
    const token = await requireUserToken(interaction, context, guildId);
    if (!token) return;
    const guildOptions = await fetchDiscordGuildOptions(token);
    const record = await context.api.getMissionToolsUser(guildId, interaction.user.id);
    const channelOptions = record.voiceGuildId ? await fetchDiscordVoiceChannelOptions(token, record.voiceGuildId) : [];
    await editOrCreateDmPanel(context, guildId, interaction.user.id, "voice", {
      guildOptions,
      voiceChannelOptions: channelOptions
    });
    await interaction.editReply("Lista de servidores/canais atualizada.");
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
            .setLabel("ID do servidor")
            .setMaxLength(32)
            .setMinLength(5)
            .setRequired(true)
            .setStyle(TextInputStyle.Short)
            .setValue(record.voiceGuildId ?? "")
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("voice_channel_id")
            .setLabel("ID do canal de voz")
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
    const token = await requireUserToken(interaction, context, guildId);
    if (!token) return;
    const record = await context.api.getMissionToolsUser(guildId, interaction.user.id);

    if (!record.voiceGuildId || !record.voiceChannelId) {
      await interaction.editReply("Selecione ou configure o servidor e canal de voz primeiro.");
      return;
    }

    const key = sessionKey(guildId, interaction.user.id);
    const current = voiceSessions.get(key);
    const session = current?.token === token
      ? current.session
      : new DiscordVoiceSession(token, (update) => {
          void updateUserAndPanel(context, guildId, interaction.user.id, "voice", {
            voiceConnectedAt: update.connectedAt ?? null,
            voiceStatus: update.status
          });
        });
    voiceSessions.set(key, { session, token });
    session.start(record.voiceGuildId, record.voiceChannelId);
    await updateUserAndPanel(context, guildId, interaction.user.id, "voice", {
      voiceStatus: "reconnecting"
    });
    await interaction.editReply("Voice Session iniciada.");
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
    await interaction.editReply("Voice Session desconectada.");
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
    const token = await requireUserToken(interaction, context, guildId);
    if (!token) return;
    const validation = validateRichPresenceConfig(record.richPresenceConfig);
    if (validation) {
      await interaction.editReply(validation);
      return;
    }

    const key = sessionKey(guildId, interaction.user.id);
    const current = richPresenceSessions.get(key);
    const session = current?.token === token
      ? current.session
      : new DiscordRichPresenceSession(token, (status) => {
          void updateUserAndPanel(context, guildId, interaction.user.id, "richPresence", {
            richPresenceStatus: status
          });
        });
    richPresenceSessions.set(key, { session, token });
    session.start(record.richPresenceConfig);
    await updateUserAndPanel(context, guildId, interaction.user.id, "richPresence", {
      richPresenceStatus: "active"
    });
    await interaction.editReply("Rich Presence ativado.");
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
    await interaction.editReply("Rich Presence desativado.");
    return;
  }

  if (action === "reset") {
    await deferMissionReply(interaction);
    await updateUserAndPanel(context, guildId, interaction.user.id, "richPresence", {
      richPresenceConfig: {},
      richPresenceStatus: "inactive",
      richPresenceUpdatedAt: new Date().toISOString()
    });
    await interaction.editReply("Configs do Rich Presence resetadas.");
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
            .setLabel("Delay por tentativa em ms")
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
      await interaction.editReply("Username Checker ja esta rodando.");
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
        usernameCheckerLastEvent: payload.message ?? "Erro no checker",
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
    await interaction.editReply("Username Checker iniciado.");
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
    await interaction.editReply("Username Checker parado.");
  }
}

async function showTokenDashboardInstructions(interaction: ButtonInteraction, guildId: string) {
  await deferMissionReply(interaction);
  await interaction.editReply(tokenDashboardInstructions(interaction.user.id, guildId));
}

async function handleTokenModal(interaction: ModalSubmitInteraction, guildId: string) {
  await deferMissionReply(interaction);
  await interaction.editReply(tokenDashboardInstructions(interaction.user.id, guildId));
}

async function handleClearTargetModal(interaction: ModalSubmitInteraction, context: BotContext, guildId: string) {
  await deferMissionReply(interaction);
  const targetUserId = interaction.fields.getTextInputValue("clear_target_user_id").trim();
  await updateUserAndPanel(context, guildId, interaction.user.id, "clear", {
    clearMode: "userDm",
    clearTargetUserId: targetUserId,
    username: displayUserName(interaction)
  });
  await interaction.editReply("DM por ID configurada.");
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
  await interaction.editReply("Voice Session configurada.");
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
    await interaction.editReply("Nome da atividade e obrigatorio.");
    return;
  }

  await applyRichConfig(context, guildId, interaction.user.id, config);
  await interaction.editReply("Rich Presence atualizado.");
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
    await interaction.editReply("Preencha o texto e a URL do botao, ou deixe os dois vazios.");
    return;
  }

  await applyRichConfig(context, guildId, interaction.user.id, config);
  await interaction.editReply("Botao do Rich Presence atualizado.");
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
  await interaction.editReply("Configuracao avancada atualizada.");
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
  await interaction.editReply("Username Checker configurado.");
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
  try {
    const token = await context.api.getMissionToolsToken(guildId, interaction.user.id);
    return token.token;
  } catch (error) {
    await editReplySafely(interaction, readRequestErrorMessage(error) ?? "Token invalido ou ausente. Configure o token novamente.");
    return null;
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
  console.log(`[mission-tools] painel publicado em ${guild.name}.`);
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
        logPanelRequestError(key, `[mission-tools] falha ao publicar painel pendente em ${settings.guildId}:`, error);
      });
    }
  } catch (error) {
    console.warn("[mission-tools] falha ao verificar pedidos pendentes:", errorMessage(error));
  } finally {
    panelRequestCheckRunning = false;
  }
}

function buildMainPanelPayload(settings: MissionToolsSettings) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:main:select:${settings.guildId}`)
    .setPlaceholder("Selecione um modulo")
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
    .addTextDisplayComponents(text("# Control Center\nSelecione um modulo para abrir a interface dedicada por mensagem direta."))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(`**Status:** ${settings.enabled ? "Ativo" : "Inativo"}\n**Modulos liberados:** ${settings.enabledFeatures.length}`))
    .addActionRowComponents(row);

  return componentsV2Payload(container);
}

function buildClearPanelPayload(record: MissionToolsUserPanel) {
  const modeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(`${PREFIX}:clear:bulk:${record.guildId}`, "Em massa", record.clearMode === "bulk" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    button(`${PREFIX}:clear:target:${record.guildId}`, "DM por ID", record.clearMode === "userDm" ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );
  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(`${PREFIX}:clear:start:${record.guildId}`, "Start", ButtonStyle.Secondary),
    button(`${PREFIX}:clear:token:${record.guildId}`, "Token Dashboard", ButtonStyle.Secondary),
    button(`${PREFIX}:clear:deactivate:${record.guildId}`, "Deactivate", ButtonStyle.Secondary)
  );
  const container = new ContainerBuilder()
    .setAccentColor(PANEL_ACCENT)
    .addTextDisplayComponents(text("# Clean System\nCleanup operations and account maintenance."))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      `**System Status:** ${statusLabel(record.clearStatus)}\n`
      + `**Configured Token:** ${tokenLabel(record.tokenConfigured)}\n`
      + `**Modo de limpeza:** ${record.clearMode === "userDm" ? "DM por ID" : "Em massa"}\n`
      + `**User ID alvo:** ${record.clearTargetUserId ?? "Nao definido"}\n`
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
    button(`${PREFIX}:mission:token:${record.guildId}`, "Token Dashboard", ButtonStyle.Secondary),
    button(`${PREFIX}:mission:deactivate:${record.guildId}`, "Deactivate", ButtonStyle.Secondary)
  );
  const container = new ContainerBuilder()
    .setAccentColor(PANEL_ACCENT)
    .addTextDisplayComponents(text("# Mission System\nMission automation status and execution controls."))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      `**System:** Mission System\n`
      + `**Status:** ${statusLabel(record.missionStatus)}\n`
      + `**Configured Token:** ${tokenLabel(record.tokenConfigured)}\n`
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
    button(`${PREFIX}:voice:token:${record.guildId}`, "Token Dashboard", ButtonStyle.Secondary),
    button(`${PREFIX}:voice:load:${record.guildId}`, "Buscar canais", ButtonStyle.Secondary),
    button(`${PREFIX}:voice:manual:${record.guildId}`, "IDs manuais", ButtonStyle.Secondary),
    button(`${PREFIX}:voice:start:${record.guildId}`, "Conectar", ButtonStyle.Secondary),
    button(`${PREFIX}:voice:stop:${record.guildId}`, "Desconectar", ButtonStyle.Secondary)
  );
  const container = new ContainerBuilder()
    .setAccentColor(PANEL_ACCENT)
    .addTextDisplayComponents(text("# Voice Session\nGerenciamento de sessao persistente em canal de voz."))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      `**Servidor conectado:** ${record.voiceGuildName ?? "Nao selecionado"}\n`
      + `**Canal atual:** ${record.voiceChannelName ?? "Nao selecionado"}\n`
      + `**Tempo de conexao ativo:** ${durationLabel(record.voiceConnectedAt)}\n`
      + `**Status da sessao:** ${voiceStatusLabel(record.voiceStatus)}\n`
      + `**Token configurado:** ${tokenLabel(record.tokenConfigured)}`
    ))
    .addSeparatorComponents(separator());

  if (options.guildOptions?.length) {
    container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      selectMenu(`${PREFIX}:voice:guild:${record.guildId}`, record.voiceGuildName ?? "Selecionar servidor", options.guildOptions.map((guild) => ({
        label: guild.name,
        value: guild.id
      })))
    ));
  }

  if (options.voiceChannelOptions?.length) {
    container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      selectMenu(`${PREFIX}:voice:channel:${record.guildId}`, record.voiceChannelName ?? "Selecionar canal de voz", options.voiceChannelOptions.map((channel) => ({
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
    button(`${PREFIX}:rich:start:${record.guildId}`, "Ativar Rich", ButtonStyle.Success),
    button(`${PREFIX}:rich:stop:${record.guildId}`, "Desativar", ButtonStyle.Secondary),
    button(`${PREFIX}:rich:reset:${record.guildId}`, "Resetar", ButtonStyle.Danger)
  );
  const rowTwo = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(`${PREFIX}:rich:config:${record.guildId}`, "Editar textos", ButtonStyle.Primary),
    button(`${PREFIX}:rich:button:${record.guildId}`, "Botao", ButtonStyle.Secondary),
    button(`${PREFIX}:rich:advanced:${record.guildId}`, "Avancado", ButtonStyle.Secondary),
    button(`${PREFIX}:rich:token:${record.guildId}`, "Token Dashboard", ButtonStyle.Secondary)
  );
  const container = new ContainerBuilder()
    .setAccentColor(PANEL_ACCENT)
    .addTextDisplayComponents(text("# Personalizar Rich Presence\nAjuste os campos e clique em ativar para refletir no Discord."))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      `**Status:** ${record.richPresenceStatus === "active" ? "Ativo" : "Inativo"}\n`
      + `**Token:** ${tokenLabel(record.tokenConfigured)}\n`
      + `**Nome:** ${codeValue(config.name)}\n`
      + `**Detalhes:** ${codeValue(config.details)}\n`
      + `**Estado:** ${codeValue(config.state)}\n`
      + `**Botao:** ${config.buttonLabel && config.buttonUrl ? `${config.buttonLabel} -> ${config.buttonUrl}` : "nao definido"}\n`
      + `**Imagem grande:** ${config.largeImage ?? "nao definida"}`
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
    await interaction.editReply("Este modulo do Mission Tools nao esta liberado na dashboard.");
    return;
  }

  if (!(await userCanUsePanel(interaction, settings))) {
    await interaction.editReply("Voce nao possui cargo autorizado para usar o Mission Tools.");
    return;
  }

  await context.api.updateMissionToolsUser(guildId, interaction.user.id, {
    username: displayUserName(interaction)
  });
  await editOrCreateDmPanel(context, guildId, interaction.user.id, panelType);
  await interaction.editReply("Enviei o painel no seu privado.");
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
  await interaction.editReply(`Mensagens do Mission Tools removidas do privado: ${deleted}.`);
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
    .setTitle("Conteudo do Rich Presence")
    .addComponents(
      textInputRow("rich_name", "Nome da atividade", config.name, true),
      textInputRow("rich_details", "Detalhes", config.details, false),
      textInputRow("rich_state", "Estado", config.state, false),
      textInputRow("rich_large_text", "Texto imagem grande", config.largeText, false)
    );
  return interaction.showModal(modal);
}

function openRichPresenceButtonModal(interaction: ButtonInteraction, guildId: string, config: MissionToolsRichPresenceConfig) {
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:rich-button:${guildId}`)
    .setTitle("Configurar Botao")
    .addComponents(
      textInputRow("rich_button_label", "Texto do botao", config.buttonLabel, false),
      textInputRow("rich_button_url", "URL do botao", config.buttonUrl, false)
    );
  return interaction.showModal(modal);
}

function openRichPresenceAdvancedModal(interaction: ButtonInteraction, guildId: string, config: MissionToolsRichPresenceConfig) {
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:rich-advanced:${guildId}`)
    .setTitle("Rich Presence avancado")
    .addComponents(
      textInputRow("rich_activity_type", "Tipo: 0,1,2,3 ou 5", String(config.activityType ?? 0), false),
      textInputRow("rich_application_id", "Application ID", config.applicationId, false),
      textInputRow("rich_large_image", "Imagem grande URL/asset", config.largeImage, false, TextInputStyle.Paragraph),
      textInputRow("rich_small_image", "Imagem pequena URL/asset", config.smallImage, false, TextInputStyle.Paragraph),
      textInputRow("rich_start_time", "Inicio opcional", config.startTimestamp, false)
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
    .setDescription(isFeatureEnabled(settings, feature) ? description : "Modulo desativado na dashboard")
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
    connected: "Conectado",
    disconnected: "Desconectado",
    reconnecting: "Reconectando"
  };

  return labels[status] ?? status;
}

function durationLabel(value?: string | null) {
  if (!value) return "Sem conexao ativa";

  const startedAt = new Date(value).getTime();
  if (Number.isNaN(startedAt)) return "Indisponivel";

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  return hours > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`;
}

function tokenLabel(tokenConfigured: boolean) {
  return tokenConfigured ? "Configurado" : "Nao configurado";
}

function codeValue(value?: string) {
  return `\`${value || "nao definido"}\``;
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(date);
}

function tokenDashboardInstructions(userId: string, guildId: string) {
  const dashboardUrl = missionDashboardUrl();
  const dashboardLine = dashboardUrl
    ? `Dashboard: ${dashboardUrl}`
    : "Dashboard: abra o painel web do bot e entre em Mission Tools.";

  return [
    "O Discord pode bloquear envio de token em formulario de bot.",
    "Configure o token pela dashboard para evitar o erro do modal.",
    dashboardLine,
    `User ID: ${userId}`,
    `Servidor: ${guildId}`,
    "No Mission Tools, use Meu token do Mission Tools e depois volte ao painel privado."
  ].join("\n");
}

function missionDashboardUrl() {
  const origin = dashboardOrigin();
  return origin ? `${origin}/dashboard` : null;
}

function dashboardOrigin() {
  const candidates = [
    env.FRONTEND_URL,
    env.BACKEND_SOCKET_URL,
    env.BACKEND_API_URL
  ];

  for (const candidate of candidates) {
    const origin = originFromUrl(candidate);
    if (origin) {
      return origin;
    }
  }

  return null;
}

function originFromUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function missionToolsPayloadUserId(value: unknown) {
  if (!value || typeof value !== "object" || !("userId" in value)) {
    return null;
  }

  const userId = (value as { userId?: unknown }).userId;
  return typeof userId === "string" && /^\d{5,32}$/.test(userId) ? userId : null;
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
      await interaction.followUp(missionReplyPayload(interaction, content));
      return;
    }

    await interaction.reply(missionReplyPayload(interaction, content));
  } catch (error) {
    console.warn("[mission-tools] nao foi possivel responder interacao:", errorMessage(error));
  }
}

async function editReplySafely(interaction: ButtonInteraction | StringSelectMenuInteraction, content: string) {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply(content);
      return;
    }

    await interaction.reply(missionReplyPayload(interaction, content));
  } catch (error) {
    console.warn("[mission-tools] nao foi possivel editar resposta da interacao:", errorMessage(error));
  }
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

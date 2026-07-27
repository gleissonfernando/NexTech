import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type Client,
  type Guild,
  type Interaction,
  MessageFlags,
  type TextChannel
} from "discord.js";
import { currentRuntimeBotId, env, isBotModuleEnabled } from "../config/env";
import type { BotContext } from "../types";
import type { FivemCommandsPanelAck, FivemCommandsPanelEvent } from "../websocket/socketClient";
import { renderComponentsV2Panel } from "./panelVisualRenderer";
import { isRuntimeModuleAuthorized } from "./runtimeModuleGuard";

const MODULE_ID = "fivem-commands";
const SOUND_BUTTON_ID = "fivem_sound_mode";
const CROSSHAIR_BUTTON_ID = "fivem_crosshair";
let serviceStarted = false;

type FivemCommandsConfig = {
  contentText: string;
  crosshairButtonEmoji: string;
  crosshairButtonLabel: string;
  crosshairChannelId: string | null;
  description: string;
  enabled: boolean;
  panelChannelId: string | null;
  panelMessageId: string | null;
  soundButtonEmoji: string;
  soundButtonLabel: string;
  soundChannelId: string | null;
  title: string;
};

export function startFivemCommandsService(client: Client, context: BotContext) {
  if (serviceStarted) return;
  serviceStarted = true;

  context.socket.onFivemCommandsPanelPublish((payload, ack) => {
    if (!isCurrentRuntime(payload.botId)) {
      ack?.({ ok: false, error: "Evento destinado a outro bot." });
      return;
    }
    const guild = client.guilds.cache.get(payload.guildId);
    if (!guild) {
      ack?.({ ok: false, error: "O bot não está conectado ao servidor selecionado." });
      return;
    }
    void publishConfiguredPanel(guild, context, payload, ack);
  });

  context.socket.onFivemCommandsPanelUpdate((payload) => {
    if (!isCurrentRuntime(payload.botId)) return;
    const guild = client.guilds.cache.get(payload.guildId);
    if (!guild) return;
    void publishConfiguredPanel(guild, context, payload).catch((error) => {
      console.warn("[fivem-commands] falha ao atualizar painel:", error instanceof Error ? error.message : error);
    });
  });

  context.socket.onFivemCommandsPanelDelete((payload, ack) => {
    if (!isCurrentRuntime(payload.botId)) {
      ack?.({ ok: false, error: "Evento destinado a outro bot." });
      return;
    }
    const guild = client.guilds.cache.get(payload.guildId);
    if (!guild) {
      ack?.({ ok: false, error: "O bot não está conectado ao servidor selecionado." });
      return;
    }
    void deleteConfiguredPanel(guild, payload.settings)
      .then(() => ack?.({ ok: true, messageId: null }))
      .catch((error) => ack?.({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  });
}

export async function handleFivemCommandsInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.isButton() || (interaction.customId !== SOUND_BUTTON_ID && interaction.customId !== CROSSHAIR_BUTTON_ID)) return false;
  if (!interaction.guild) return true;

  if (!isBotModuleEnabled(MODULE_ID) || !(await isRuntimeModuleAuthorized(context, interaction.guild.id, MODULE_ID))) {
    await interaction.reply({ content: "Comandos FiveM não está liberado neste servidor.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const settings = normalizeConfig((await context.api.getRuntimeModuleConfig(interaction.guild.id, MODULE_ID)).config);
  if (!settings.enabled) {
    await interaction.reply({ content: "Comandos FiveM está desativado no momento.", flags: MessageFlags.Ephemeral });
    return true;
  }

  await redirectToConfiguredChannel(interaction, settings);
  return true;
}

async function publishConfiguredPanel(guild: Guild, context: BotContext, payload: FivemCommandsPanelEvent, ack?: FivemCommandsPanelAck) {
  try {
    if (!isBotModuleEnabled(MODULE_ID) || !(await isRuntimeModuleAuthorized(context, guild.id, MODULE_ID))) {
      throw new Error("Comandos FiveM não está liberado para este servidor.");
    }

    const settings = normalizeConfig(payload.settings ?? (await context.api.getRuntimeModuleConfig(guild.id, MODULE_ID)).config);
    if (!settings.enabled || !settings.panelChannelId) {
      ack?.({ ok: true, messageId: settings.panelMessageId });
      return;
    }

    const channel = await guild.channels.fetch(settings.panelChannelId).catch(() => null);
    if (!channel?.isTextBased() || !channel.isSendable() || !("messages" in channel)) {
      throw new Error("Não foi possível acessar o canal do painel. Verifique permissões do bot.");
    }

    const textChannel = channel as TextChannel;
    const payloadBody = fivemCommandsPanelPayload(guild, settings);
    let message = settings.panelMessageId
      ? await textChannel.messages.fetch(settings.panelMessageId).catch(() => null)
      : null;

    message = message ? await message.edit(payloadBody) : await textChannel.send(payloadBody);
    ack?.({ ok: true, messageId: message.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[fivem-commands] falha ao publicar painel:", message);
    ack?.({ ok: false, error: message });
    if (!ack) throw error;
  }
}

async function deleteConfiguredPanel(guild: Guild, eventSettings: unknown) {
  const settings = normalizeConfig(eventSettings);
  if (!settings.panelChannelId || !settings.panelMessageId) return;

  const channel = await guild.channels.fetch(settings.panelChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("messages" in channel)) return;

  const message = await (channel as TextChannel).messages.fetch(settings.panelMessageId).catch(() => null);
  await message?.delete().catch(() => undefined);
}

async function redirectToConfiguredChannel(interaction: ButtonInteraction, settings: FivemCommandsConfig) {
  const isSound = interaction.customId === SOUND_BUTTON_ID;
  const channelId = isSound ? settings.soundChannelId : settings.crosshairChannelId;
  const missing = isSound ? "Este botão ainda não possui um canal configurado." : "Canal de miras não configurado.";

  if (!channelId) {
    await interaction.reply({ content: missing, flags: MessageFlags.Ephemeral });
    return;
  }

  const channel = await interaction.guild?.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    await interaction.reply({ content: missing, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({
    content: `➡️ Você foi direcionado para:\n<#${channelId}>\nhttps://discord.com/channels/${interaction.guildId}/${channelId}`,
    flags: MessageFlags.Ephemeral
  });
}

function fivemCommandsPanelPayload(guild: Guild, settings: FivemCommandsConfig) {
  const action = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(SOUND_BUTTON_ID)
      .setEmoji(settings.soundButtonEmoji || "📂")
      .setLabel(settings.soundButtonLabel || "Modo Som")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(CROSSHAIR_BUTTON_ID)
      .setEmoji(settings.crosshairButtonEmoji || "📂")
      .setLabel(settings.crosshairButtonLabel || "Miras")
      .setStyle(ButtonStyle.Secondary)
  );

  return renderComponentsV2Panel({
    accentColor: 0x3f4148,
    actions: [action],
    description: settings.description,
    fields: splitPanelText(settings.contentText),
    footer: { enabled: false },
    guild,
    moduleId: MODULE_ID,
    title: settings.title
  });
}

function splitPanelText(value: string) {
  const paragraphs = value
    .split(/\n{2,}/)
    .flatMap((item) => splitLongPanelParagraph(item.trim()))
    .filter(Boolean);
  const blocks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > 1700 && current) {
      blocks.push(current);
      current = paragraph;
    } else {
      current = next;
    }
  }

  if (current) blocks.push(current);
  return blocks.length ? blocks.slice(0, 10) : [defaultContent()];
}

function splitLongPanelParagraph(paragraph: string) {
  if (paragraph.length <= 1700) return [paragraph];

  const chunks: string[] = [];
  let current = "";
  for (const line of paragraph.split("\n")) {
    if (line.length > 1700) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let index = 0; index < line.length; index += 1700) {
        chunks.push(line.slice(index, index + 1700));
      }
      continue;
    }

    const next = current ? `${current}\n${line}` : line;
    if (next.length > 1700 && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);

  return chunks;
}

function normalizeConfig(value: unknown): FivemCommandsConfig {
  const record = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  return {
    contentText: stringValue(record.contentText) ?? defaultContent(),
    crosshairButtonEmoji: stringValue(record.crosshairButtonEmoji) ?? "📂",
    crosshairButtonLabel: stringValue(record.crosshairButtonLabel) ?? "Miras",
    crosshairChannelId: stringValue(record.crosshairChannelId),
    description: stringValue(record.description) ?? "Abaixo pode-se encontrar alguns comandos essenciais.",
    enabled: record.enabled === true,
    panelChannelId: stringValue(record.panelChannelId),
    panelMessageId: stringValue(record.panelMessageId),
    soundButtonEmoji: stringValue(record.soundButtonEmoji) ?? "📂",
    soundButtonLabel: stringValue(record.soundButtonLabel) ?? "Modo Som",
    soundChannelId: stringValue(record.soundChannelId),
    title: stringValue(record.title) ?? "COMANDOS PARA FIVEM"
  };
}

function defaultContent() {
  return [
    "## BIND (ATALHOS)",
    "Criar bind: `bind keyboard \"tecla\" \"comando\"`",
    "Remover bind: `unbind keyboard \"tecla\"`",
    "Remover todos: `unbind all`",
    "",
    "## MIRA E VISÃO",
    "Tamanho da mira: `profile_reticulesize`",
    "Brilho: `profile_gamma`",
    "FOV: `profile_fpsFieldOfView`",
    "",
    "## TROCAR ENTRE MIRA SIMPLES E COMPLEXA",
    "`bind keyboard \"tecla\" \"toggle_profile_reticule 0 1\"`",
    "`bind keyboard \"tecla\" \"toggle_profile_reticule 0 -2\"`",
    "",
    "## ATIVAR MIRA FIXA",
    "Ativar → `cl_customCrosshair true`",
    "Desativar → `cl_customCrosshair false`",
    "",
    "## MOUSE",
    "Sensibilidade: `profile_mouseonfootscale`",
    "Sem aceleração: `profile_aimAcceleration 0`",
    "Sem deadzone: `profile_aimDeadzone 0`",
    "",
    "## PERFORMANCE & FPS",
    "Mostrar FPS: `cl_drawfps 1` | desativar: `cl_drawfps 0`",
    "Mostrar Performance: `cl_drawperf 1` | desativar: `cl_drawperf 0`",
    "",
    "## DESTRAVAR FPS (ÁUDIO):",
    "Ativar → `game_useSynchronousAudio true`",
    "Desativar → `game_useSynchronousAudio false`"
  ].join("\n");
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isCurrentRuntime(botId: string | null | undefined) {
  const runtimeBotId = (currentRuntimeBotId() ?? env.DASHBOARD_BOT_ID) || null;
  return !botId || !runtimeBotId || botId === runtimeBotId;
}

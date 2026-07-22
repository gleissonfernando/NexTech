import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type Client,
  type Guild,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Interaction,
  type ModalSubmitInteraction,
  type TextChannel
} from "discord.js";
import { currentRuntimeBotId, env, isBotModuleEnabled } from "../config/env";
import type { BotContext } from "../types";
import type { FivemCaptchaPanelPublishAck } from "../websocket/socketClient";
import { renderComponentsV2Panel } from "./panelVisualRenderer";
import { isRuntimeModuleAuthorized } from "./runtimeModuleGuard";
import { systemComponentEmoji, systemEmojiText } from "./systemEmojiService";

const MODULE_ID = "fivem-captcha";
const PREFIX = "fivem_captcha";
const challengeCache = new Map<string, { answer: string; expiresAt: number; guildId: string; userId: string }>();
let serviceStarted = false;

type FivemCaptchaConfig = {
  challengeMode: "button" | "code" | "math";
  cooldownSeconds: number;
  deletePromptAfterVerify: boolean;
  enabled: boolean;
  expiresMinutes: number;
  failureAction: "ban" | "kick" | "log_only";
  logChannelId: string | null;
  maxAttempts: number;
  panelChannelId: string | null;
  panelMessageId: string | null;
  roleId: string | null;
};

export function startFivemCaptchaService(client: Client, context: BotContext) {
  if (serviceStarted) return;
  serviceStarted = true;

  context.socket.onFivemCaptchaPanelPublish((payload, ack?: FivemCaptchaPanelPublishAck) => {
    const runtimeBotId = (currentRuntimeBotId() ?? env.DASHBOARD_BOT_ID) || null;
    if (payload.botId && runtimeBotId && payload.botId !== runtimeBotId) {
      ack?.({ ok: false, error: "Evento destinado a outro bot." });
      return;
    }

    const guild = client.guilds.cache.get(payload.guildId);
    if (!guild) {
      ack?.({ ok: false, error: "O bot não está conectado ao servidor selecionado." });
      return;
    }

    void publishConfiguredFivemCaptchaPanel(guild, context, payload.settings)
      .then((messageId) => ack?.({ ok: true, messageId }))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[fivem-captcha] falha ao publicar painel:", message);
        ack?.({ ok: false, error: message });
      });
  });
}

export async function handleFivemCaptchaInteraction(interaction: Interaction, context: BotContext) {
  if (!("customId" in interaction) || !interaction.customId.startsWith(`${PREFIX}:`)) return false;
  if (!interaction.guild) return true;

  if (interaction.isButton() && interaction.customId === `${PREFIX}:start`) {
    await startCaptchaChallenge(interaction, context);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith(`${PREFIX}:answer:`)) {
    await finishCaptchaChallenge(interaction, context);
    return true;
  }

  return true;
}

async function publishConfiguredFivemCaptchaPanel(guild: Guild, context: BotContext, eventSettings: unknown) {
  if (!isBotModuleEnabled(MODULE_ID) || !(await isRuntimeModuleAuthorized(context, guild.id, MODULE_ID))) {
    throw new Error("CAPTCHA FiveM não está liberado para este servidor.");
  }

  const settings = normalizeConfig(eventSettings ?? (await context.api.getRuntimeModuleConfig(guild.id, MODULE_ID)).config);
  if (!settings.enabled) throw new Error("Ative e salve o CAPTCHA FiveM antes de publicar.");
  if (!settings.panelChannelId) throw new Error("Configure o canal do painel antes de publicar.");

  const channel = await guild.channels.fetch(settings.panelChannelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.isSendable() || !("messages" in channel)) {
    throw new Error("Não foi possível acessar o canal do painel. Verifique permissões do bot.");
  }

  const textChannel = channel as TextChannel;
  const payload = captchaPanelPayload(guild);
  let message = settings.panelMessageId
    ? await textChannel.messages.fetch(settings.panelMessageId).catch(() => null)
    : null;

  message = message ? await message.edit(payload) : await textChannel.send(payload);
  return message.id;
}

async function startCaptchaChallenge(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  if (!isBotModuleEnabled(MODULE_ID) || !(await isRuntimeModuleAuthorized(context, interaction.guild.id, MODULE_ID))) {
    await interaction.reply({ content: "CAPTCHA FiveM não está liberado neste servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  const settings = normalizeConfig((await context.api.getRuntimeModuleConfig(interaction.guild.id, MODULE_ID)).config);
  if (!settings.enabled) {
    await interaction.reply({ content: "CAPTCHA FiveM está desativado no momento.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (settings.challengeMode === "button") {
    await grantCaptchaRole(interaction, context, settings);
    return;
  }

  const challenge = createChallenge(settings.challengeMode);
  const challengeId = `${interaction.id.slice(-8)}${Math.random().toString(36).slice(2, 8)}`;
  challengeCache.set(challengeId, {
    answer: challenge.answer,
    expiresAt: Date.now() + Math.max(1, settings.expiresMinutes) * 60_000,
    guildId: interaction.guild.id,
    userId: interaction.user.id
  });

  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:answer:${challengeId}`)
    .setTitle("CAPTCHA FiveM")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("answer")
        .setLabel(challenge.label)
        .setMaxLength(24)
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
    ));

  await interaction.showModal(modal);
}

async function finishCaptchaChallenge(interaction: ModalSubmitInteraction, context: BotContext) {
  const challengeId = interaction.customId.split(":")[2] ?? "";
  const challenge = challengeCache.get(challengeId);
  challengeCache.delete(challengeId);

  if (!challenge || challenge.guildId !== interaction.guildId || challenge.userId !== interaction.user.id || challenge.expiresAt < Date.now()) {
    await interaction.reply({ content: "Seu CAPTCHA expirou. Clique no botão do painel e tente novamente.", flags: MessageFlags.Ephemeral });
    return;
  }

  const answer = interaction.fields.getTextInputValue("answer").trim().toLowerCase();
  const expected = challenge.answer.trim().toLowerCase();

  if (answer !== expected) {
    await interaction.reply({ content: "Código incorreto. Tente novamente pelo botão do painel.", flags: MessageFlags.Ephemeral });
    return;
  }

  const settings = normalizeConfig((await context.api.getRuntimeModuleConfig(interaction.guildId!, MODULE_ID)).config);
  await grantCaptchaRole(interaction, context, settings);
}

async function grantCaptchaRole(interaction: ButtonInteraction | ModalSubmitInteraction, context: BotContext, settings: FivemCaptchaConfig) {
  if (!interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (settings.roleId) {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    await member.roles.add(settings.roleId, "CAPTCHA FiveM validado").catch((error) => {
      throw new Error(`Não foi possível entregar o cargo configurado: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  await context.api.postLog({
    action: "captcha_verified",
    botId: currentRuntimeBotId() ?? env.DASHBOARD_BOT_ID ?? null,
    guildId: interaction.guild.id,
    module: "CAPTCHA FiveM",
    status: "success",
    type: "fivem_captcha.verified",
    userId: interaction.user.id,
    message: `CAPTCHA FiveM validado por ${interaction.user.tag}.`,
    metadata: {
      roleId: settings.roleId
    }
  }).catch(() => null);

  await interaction.editReply(settings.roleId
    ? "CAPTCHA validado. Seu acesso FiveM foi liberado."
    : "CAPTCHA validado. Nenhum cargo automático foi configurado.");
}

function captchaPanelPayload(guild: Guild) {
  const action = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:start`)
      .setEmoji(systemComponentEmoji("alerta", guild))
      .setLabel("Iniciar CAPTCHA")
      .setStyle(ButtonStyle.Primary)
  );

  return renderComponentsV2Panel({
    accentColor: 0xffd500,
    actions: [action],
    description: [
      "Clique no botão abaixo para iniciar a verificação FiveM.",
      "O processo é individual, rápido e protege a entrada da comunidade contra acessos indevidos."
    ].join("\n"),
    fields: [
      `${systemEmojiText("visto", guild)} **Validação segura**\nA resposta é conferida automaticamente pelo bot.`,
      `${systemEmojiText("relogio", guild)} **Tempo limitado**\nSe o desafio expirar, basta iniciar novamente.`
    ],
    guild,
    moduleId: MODULE_ID,
    title: `${systemEmojiText("alerta", guild)} CAPTCHA FiveM`
  });
}

function createChallenge(mode: "code" | "math") {
  if (mode === "code") {
    const answer = Math.random().toString(36).slice(2, 8).toUpperCase();
    return {
      answer,
      label: `Digite o código ${answer}`
    };
  }

  const left = Math.floor(Math.random() * 8) + 2;
  const right = Math.floor(Math.random() * 8) + 2;
  return {
    answer: String(left + right),
    label: `Quanto é ${left} + ${right}?`
  };
}

function normalizeConfig(value: unknown): FivemCaptchaConfig {
  const record = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  return {
    challengeMode: record.challengeMode === "button" || record.challengeMode === "code" || record.challengeMode === "math" ? record.challengeMode : "math",
    cooldownSeconds: numberValue(record.cooldownSeconds, 10),
    deletePromptAfterVerify: record.deletePromptAfterVerify !== false,
    enabled: record.enabled === true,
    expiresMinutes: numberValue(record.expiresMinutes, 5),
    failureAction: record.failureAction === "ban" || record.failureAction === "kick" || record.failureAction === "log_only" ? record.failureAction : "log_only",
    logChannelId: stringValue(record.logChannelId),
    maxAttempts: numberValue(record.maxAttempts, 3),
    panelChannelId: stringValue(record.panelChannelId),
    panelMessageId: stringValue(record.panelMessageId),
    roleId: stringValue(record.roleId)
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

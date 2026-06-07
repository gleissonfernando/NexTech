import { EmbedBuilder, type GuildMember, type PartialGuildMember } from "discord.js";
import { env } from "../config/env";
import type { BotContext } from "../types";

const DEFAULT_WELCOME_IMAGE_URL = "/uploads/welcome/default.gif?v=3";
const DEFAULT_WELCOME_MESSAGE = [
  "Seja bem-vindo(a), {user}, \u00e0 nossa comunidade de lives.",
  "Aqui a galera acompanha transmiss\u00f5es, eventos da comunidade, avisos e momentos ao vivo juntos."
].join("\n");
const DEFAULT_WELCOME_RULES_TITLE = "Algumas dicas:";
const DEFAULT_WELCOME_RULES = [
  "Leia as regras antes de participar.",
  "Aguarde os avisos oficiais de lives e eventos.",
  "Respeite streamers, espectadores e moderadores.",
  "N\u00e3o divulgue links ou canais sem autoriza\u00e7\u00e3o.",
  "Converse, fa\u00e7a amizades e aproveite sua estadia."
].join("\n");
const DEFAULT_WELCOME_CHANNEL_LABEL = "Acesse o canal:";
const DEFAULT_WELCOME_FOOTER_TEXT = "Ricardin98 - Comunidade de Lives";
const LEGACY_WELCOME_FOOTER_TEXT = "Ricardinn98 - Comunidade de lives";
const DEFAULT_LEAVE_TITLE = "Ricardinn98";
const DEFAULT_LEAVE_MESSAGE = [
  "Ate mais, {user}. Obrigado por ter feito parte da nossa comunidade de lives.",
  "As portas continuam abertas para quando quiser voltar e acompanhar as transmissoes com a galera."
].join("\n");
const DEFAULT_LEAVE_RULES_TITLE = "Registro de saida:";
const DEFAULT_LEAVE_RULES = [
  "A saida foi registrada automaticamente pelo bot.",
  "Os canais oficiais continuam disponiveis para a comunidade.",
  "Respeite as regras se decidir retornar ao servidor.",
  "A equipe segue por aqui para organizar eventos e avisos.",
  "Valeu pela passagem e ate a proxima."
].join("\n");
const DEFAULT_LEAVE_CHANNEL_LABEL = "Canal da comunidade:";
const DEFAULT_LEAVE_FOOTER_TEXT = "Ricardinn98 - Comunidade de lives";

export async function sendWelcomeMessage(context: BotContext, member: GuildMember) {
  const settings = await context.api.getSettings(member.guild.id, member.client.user.id).catch(() => null);

  if (!settings?.welcomeEnabled || !settings.welcomeChannelId) {
    return;
  }

  const channel = await resolveTextChannel(member, settings.welcomeChannelId);

  if (!channel) {
    return;
  }

  const displayChannelId = settings.welcomeDisplayChannelId ?? settings.welcomeChannelId;
  const imageUrl = resolveImageUrl(settings.welcomeImageUrl ?? DEFAULT_WELCOME_IMAGE_URL);
  const embeds = createWelcomeMessageEmbeds(settings, `<@${member.id}>`, displayChannelId, imageUrl);

  await channel.send({
    allowedMentions: {
      parse: []
    },
    embeds
  });
}

export async function sendLeaveMessage(context: BotContext, member: GuildMember | PartialGuildMember) {
  const settings = await context.api.getSettings(member.guild.id, member.client.user.id).catch(() => null);

  if (!settings?.leaveEnabled || !settings.leaveChannelId) {
    return;
  }

  const channel = await resolveTextChannel(member, settings.leaveChannelId);

  if (!channel) {
    return;
  }

  const displayChannelId = settings.leaveDisplayChannelId ?? settings.leaveChannelId;
  const imageUrl = resolveImageUrl(settings.leaveImageUrl ?? DEFAULT_WELCOME_IMAGE_URL);
  const embed = new EmbedBuilder()
    .setColor(0xef4444)
    .setTitle(settings.leaveTitle?.trim() || DEFAULT_LEAVE_TITLE)
    .setDescription(leavePanelDescription(settings, `<@${member.id}>`, displayChannelId))
    .setFooter({
      text: settings.leaveFooterText?.trim() || DEFAULT_LEAVE_FOOTER_TEXT
    });

  if (imageUrl) {
    embed.setImage(imageUrl);
  }

  await channel.send({
    allowedMentions: {
      parse: []
    },
    embeds: [embed]
  });
}

function welcomePanelDescription(
  settings: Awaited<ReturnType<BotContext["api"]["getSettings"]>>,
  userMention: string,
  channelId: string | null
) {
  return memberPanelDescription({
    channelId,
    channelLabel: settings.welcomeChannelLabel,
    defaultChannelLabel: DEFAULT_WELCOME_CHANNEL_LABEL,
    defaultMessage: DEFAULT_WELCOME_MESSAGE,
    defaultRules: DEFAULT_WELCOME_RULES,
    defaultRulesTitle: DEFAULT_WELCOME_RULES_TITLE,
    message: settings.welcomeMessage,
    rules: settings.welcomeRules,
    rulesTitle: settings.welcomeRulesTitle,
    userMention
  });
}

function createWelcomeMessageEmbeds(
  settings: Awaited<ReturnType<BotContext["api"]["getSettings"]>>,
  userMention: string,
  displayChannelId: string | null,
  imageUrl: string | null
) {
  const embeds: EmbedBuilder[] = [];

  if (imageUrl) {
    embeds.push(
      new EmbedBuilder()
        .setColor(0xef4444)
        .setImage(imageUrl)
    );
  }

  embeds.push(
    new EmbedBuilder()
      .setColor(0xef4444)
      .setDescription(welcomePanelDescription(settings, userMention, displayChannelId))
      .setFooter({
        text: welcomeFooterText(settings.welcomeFooterText)
      })
  );

  return embeds;
}

function leavePanelDescription(
  settings: Awaited<ReturnType<BotContext["api"]["getSettings"]>>,
  userMention: string,
  channelId: string | null
) {
  return memberPanelDescription({
    channelId,
    channelLabel: settings.leaveChannelLabel,
    defaultChannelLabel: DEFAULT_LEAVE_CHANNEL_LABEL,
    defaultMessage: DEFAULT_LEAVE_MESSAGE,
    defaultRules: DEFAULT_LEAVE_RULES,
    defaultRulesTitle: DEFAULT_LEAVE_RULES_TITLE,
    message: settings.leaveMessage,
    rules: settings.leaveRules,
    rulesTitle: settings.leaveRulesTitle,
    userMention
  });
}

function memberPanelDescription({
  channelId,
  channelLabel,
  defaultChannelLabel,
  defaultMessage,
  defaultRules,
  defaultRulesTitle,
  message,
  rules,
  rulesTitle,
  userMention
}: {
  channelId: string | null;
  channelLabel: string | null;
  defaultChannelLabel: string;
  defaultMessage: string;
  defaultRules: string;
  defaultRulesTitle: string;
  message: string | null;
  rules: string | null;
  rulesTitle: string | null;
  userMention: string;
}) {
  const channelMention = channelId ? `<#${channelId}>` : "<#coloque_o_id_do_canal_de_lives_aqui>";
  const ruleLines = formatRuleLines(rules, defaultRules);

  return [
    formatPanelMessage(message, userMention, defaultMessage),
    "",
    `**${rulesTitle?.trim() || defaultRulesTitle}**`,
    ...ruleLines.map((rule, index) => `**${index + 1}.** ${rule}`),
    "",
    `\u{1F517} ${channelLabel?.trim() || defaultChannelLabel} ${channelMention}`
  ].join("\n");
}

function resolveImageUrl(value: string | null) {
  if (!value) {
    return null;
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  const backendOrigin = env.BACKEND_API_URL ? new URL(env.BACKEND_API_URL).origin : "";
  return backendOrigin ? `${backendOrigin}${value.startsWith("/") ? value : `/${value}`}` : null;
}

async function resolveTextChannel(member: GuildMember | PartialGuildMember, channelId: string) {
  const channel = member.guild.channels.cache.get(channelId)
    ?? await member.guild.channels.fetch(channelId).catch(() => null);

  return channel?.isTextBased() ? channel : null;
}

function formatPanelMessage(message: string | null, userMention: string, fallback: string) {
  return (message?.trim() || fallback).replace(/\{user\}/gi, userMention);
}

function welcomeFooterText(value: string | null) {
  const normalized = value?.trim();
  return !normalized || normalized === LEGACY_WELCOME_FOOTER_TEXT ? DEFAULT_WELCOME_FOOTER_TEXT : normalized;
}

function formatRuleLines(rules: string | null, fallback: string) {
  return (rules?.trim() || fallback)
    .split(/\r?\n/)
    .map((rule) => rule.replace(/^\s*(?:\d+[.)-]\s*|\*\*\d+[.)-]?\*\*\s*)/, "").trim())
    .filter(Boolean);
}

import { EmbedBuilder, type GuildMember } from "discord.js";
import { env } from "../config/env";
import type { BotContext } from "../types";

const DEFAULT_WELCOME_IMAGE_URL = "/uploads/welcome/default.gif?v=3";

export async function sendWelcomeMessage(context: BotContext, member: GuildMember) {
  const settings = await context.api.getSettings(member.guild.id).catch(() => null);

  if (!settings?.welcomeEnabled || !settings.welcomeChannelId) {
    return;
  }

  const channel = member.guild.channels.cache.get(settings.welcomeChannelId);

  if (!channel?.isTextBased()) {
    return;
  }

  const displayChannelId = settings.welcomeDisplayChannelId ?? settings.welcomeChannelId;
  const imageUrl = resolveImageUrl(settings.welcomeImageUrl ?? DEFAULT_WELCOME_IMAGE_URL);
  const embed = new EmbedBuilder()
    .setColor(0xef4444)
    .setTitle("\u{1F47E} Ricardinn98")
    .setDescription(welcomePanelDescription(`<@${member.id}>`, displayChannelId))
    .setFooter({
      text: "Ricardinn98 - Comunidade de lives"
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

export async function sendLeaveMessage(context: BotContext, member: GuildMember) {
  const settings = await context.api.getSettings(member.guild.id).catch(() => null);

  if (!settings?.leaveEnabled || !settings.leaveChannelId) {
    return;
  }

  const channel = member.guild.channels.cache.get(settings.leaveChannelId);

  if (!channel?.isTextBased()) {
    return;
  }

  const displayChannelId = settings.leaveDisplayChannelId ?? settings.leaveChannelId;
  const imageUrl = resolveImageUrl(settings.leaveImageUrl ?? DEFAULT_WELCOME_IMAGE_URL);
  const embed = new EmbedBuilder()
    .setColor(0xef4444)
    .setTitle("\u{1F47E} Ricardinn98")
    .setDescription(leavePanelDescription(`<@${member.id}>`, displayChannelId))
    .setFooter({
      text: "Ricardinn98 - Comunidade de lives"
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

function welcomePanelDescription(userMention: string, channelId: string | null) {
  const channelMention = channelId ? `<#${channelId}>` : "<#coloque_o_id_do_canal_de_lives_aqui>";

  return [
    `Seja bem-vindo(a), ${userMention}, a nossa comunidade de lives.`,
    "Aqui a galera acompanha transmissoes, eventos da comunidade, avisos e momentos ao vivo juntos.",
    "",
    "**Algumas dicas:**",
    "**1.** Leia as regras antes de participar.",
    "**2.** Aguarde os avisos oficiais de lives e eventos.",
    "**3.** Respeite streamers, espectadores e moderadores.",
    "**4.** Nao divulgue lives, links ou canais sem autorizacao.",
    "**5.** Converse, faca amizades e aproveite sua estadia.",
    "",
    `\u{1F517} Acesse o canal: ${channelMention}`
  ].join("\n");
}

function leavePanelDescription(userMention: string, channelId: string | null) {
  const channelMention = channelId ? `<#${channelId}>` : "<#coloque_o_id_do_canal_de_lives_aqui>";

  return [
    `Ate mais, ${userMention}. Obrigado por ter feito parte da nossa comunidade de lives.`,
    "As portas continuam abertas para quando quiser voltar e acompanhar as transmissoes com a galera.",
    "",
    "**Registro de saida:**",
    "**1.** A saida foi registrada automaticamente pelo bot.",
    "**2.** Os canais oficiais continuam disponiveis para a comunidade.",
    "**3.** Respeite as regras se decidir retornar ao servidor.",
    "**4.** A equipe segue por aqui para organizar eventos e avisos.",
    "**5.** Valeu pela passagem e ate a proxima.",
    "",
    `\u{1F517} Canal da comunidade: ${channelMention}`
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

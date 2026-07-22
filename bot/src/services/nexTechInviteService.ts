import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type Client,
  EmbedBuilder,
  type Guild,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Message,
  type TextChannel
} from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import type { NexTechInviteRuntimeInvite } from "./apiClient";
import type { BotCommand, BotContext } from "../types";
import { deleteMessageWithAudit } from "./deletedMessageLogService";
import { renderComponentsV2Panel } from "./panelVisualRenderer";
import { isRuntimeModuleAuthorized } from "./runtimeModuleGuard";
import type { NexTechInvitePanelPublishAck } from "../websocket/socketClient";

const MODULE_ID = "nextech-invites";
const DISCORD_INVITE_PATTERN = /(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)([a-z0-9-]+)/gi;
const runtimeCache = new Map<string, { expiresAt: number; invite: NexTechInviteRuntimeInvite | null }>();
const RUNTIME_TTL_MS = 5_000;
let nexTechInviteServiceStarted = false;

export const nexTechInviteCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("nexttech-convites")
    .setDescription("Gerencia o painel público de Convites NextTech.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand
      .setName("publicar")
      .setDescription("Publica ou atualiza o painel do convite oficial.")
      .addChannelOption((option) => option
        .setName("canal")
        .setDescription("Canal onde o painel será publicado.")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false))),
  moduleId: MODULE_ID,
  async execute(interaction, context) {
    await publishNexTechInvitePanel(interaction, context);
  }
};

async function publishNexTechInvitePanel(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!(await isRuntimeModuleAuthorized(context, interaction.guild.id, MODULE_ID))) {
    await interaction.reply({ content: "O Sistema de Convites NextTech não está liberado para este servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const optionChannel = interaction.options.getChannel("canal", false, [ChannelType.GuildText]);
  const result = await publishConfiguredNexTechInvitePanel(interaction.guild, context, {
    actorId: interaction.user.id,
    channelId: optionChannel?.id ?? null,
    fallbackChannelId: interaction.channelId
  });

  await interaction.editReply(`Painel de convite oficial publicado em <#${result.channelId}>.`);
}

export function startNexTechInviteService(client: Client, context: BotContext) {
  if (nexTechInviteServiceStarted) return;
  nexTechInviteServiceStarted = true;

  context.socket.onNexTechInvitePanelPublish((payload, ack?: NexTechInvitePanelPublishAck) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (!guild) {
      ack?.({ ok: false, error: "O bot não está conectado ao servidor selecionado." });
      return;
    }

    void publishConfiguredNexTechInvitePanel(guild, context)
      .then((result) => ack?.({ ok: true, messageId: result.messageId }))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[nextech-invites] falha ao publicar via dashboard:", message);
        ack?.({ ok: false, error: message });
      });
  });
}

export async function publishConfiguredNexTechInvitePanel(guild: Guild, context: BotContext, options: { actorId?: string | null; channelId?: string | null; fallbackChannelId?: string | null } = {}) {
  if (!(await isRuntimeModuleAuthorized(context, guild.id, MODULE_ID))) {
    throw new Error("O Sistema de Convites NextTech não está liberado para este servidor.");
  }

  const invite = await context.api.getNexTechInviteRuntime(guild.id)
    .then((runtime) => runtime.invite)
    .catch((error) => {
      console.warn("[nextech-invites] falha ao buscar painel para publicação:", errorMessage(error));
      return null;
    });

  if (!invite || invite.status !== "active" || !invite.inviteUrl) {
    throw new Error("Cadastre um convite oficial ativo na Dashboard antes de publicar o painel.");
  }

  const channelId = options.channelId ?? invite.panelChannelId ?? options.fallbackChannelId;
  if (!channelId) {
    throw new Error("Configure o canal do painel antes de publicar.");
  }

  const channel = await guild.channels.fetch(channelId).catch(() => null);

  if (!channel?.isTextBased() || !channel.isSendable() || !("messages" in channel)) {
    throw new Error("Não foi possível acessar o canal do painel. Verifique o canal configurado e as permissões do bot.");
  }

  const textChannel = channel as TextChannel;
  const payload = buildInvitePanelPayload(guild, invite);
  let panelMessage = invite.panelMessageId
    ? await textChannel.messages.fetch(invite.panelMessageId).catch(() => null)
    : null;

  panelMessage = panelMessage
    ? await panelMessage.edit(payload)
    : await textChannel.send(payload);

  await context.api.updateNexTechInvitePanelState(guild.id, {
    inviteId: invite.id,
    messageId: panelMessage.id
  }).catch((error) => {
    console.warn("[nextech-invites] falha ao salvar mensagem do painel:", errorMessage(error));
  });
  clearNexTechInviteRuntimeCache(guild.id);

  await context.api.postLog({
    action: "publish_panel",
    botId: invite.botId ?? null,
    channelId: textChannel.id,
    guildId: guild.id,
    module: "Sistema de Convites NextTech",
    status: "success",
    type: "nextech_invites.panel_published",
    userId: options.actorId ?? context.client.user?.id ?? "system",
    message: `Painel de convite oficial publicado em #${textChannel.name}.`,
    metadata: {
      inviteId: invite.id,
      messageId: panelMessage.id
    }
  }).catch(() => null);

  return {
    channelId: textChannel.id,
    messageId: panelMessage.id
  };
}

export async function handleNexTechInviteMessage(message: Message, context: BotContext) {
  if (!isBotModuleEnabled(MODULE_ID) || !message.guild || message.author.bot || message.webhookId) {
    return false;
  }

  const inviteCodes = extractDiscordInviteCodes(message.content);
  if (!inviteCodes.length) {
    return false;
  }

  if (!(await isRuntimeModuleAuthorized(context, message.guild.id, MODULE_ID))) {
    return false;
  }

  const invite = await getRuntimeInvite(context, message.guild.id).catch((error) => {
    console.warn("[nextech-invites] falha ao buscar configuração:", errorMessage(error));
    return null;
  });

  if (!invite || invite.status !== "active" || !invite.blockUnknownInvites) {
    return false;
  }

  const allowedCodes = officialInviteCodes(invite);
  if (!allowedCodes.size) {
    return false;
  }

  const blockedCode = inviteCodes.find((code) => !allowedCodes.has(code));
  if (!blockedCode) {
    return false;
  }

  await deleteMessageWithAudit(context, message, {
    action: "AUTO_DELETE",
    deletionType: "AUTOMATIC",
    module: "Sistema de Convites NextTech",
    reason: `Convite Discord externo bloqueado: ${blockedCode}.`,
    ruleId: MODULE_ID
  }).catch((error) => {
    console.warn("[nextech-invites] não foi possível apagar convite externo:", errorMessage(error));
  });

  await context.api.recordNexTechInviteBlocked(message.guild.id, {
    channelId: message.channelId,
    inviteCode: blockedCode,
    messageId: message.id,
    userId: message.author.id,
    userName: message.author.tag
  }).catch((error) => {
    console.warn("[nextech-invites] não foi possível registrar convite bloqueado:", errorMessage(error));
  });

  await notifyAuthor(message).catch((error) => {
    console.warn("[nextech-invites] não foi possível avisar usuário:", errorMessage(error));
  });

  await sendInviteLog(message, invite, blockedCode).catch((error) => {
    console.warn("[nextech-invites] não foi possível enviar log:", errorMessage(error));
  });

  return true;
}

export function clearNexTechInviteRuntimeCache(guildId?: string | null) {
  if (!guildId) {
    runtimeCache.clear();
    return;
  }

  for (const key of runtimeCache.keys()) {
    if (key.endsWith(`:${guildId}`)) runtimeCache.delete(key);
  }
}

async function getRuntimeInvite(context: BotContext, guildId: string) {
  const key = `${context.client.user?.id ?? "unknown"}:${guildId}`;
  const cached = runtimeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.invite;
  }

  const runtime = await context.api.getNexTechInviteRuntime(guildId);
  const record = {
    expiresAt: Date.now() + RUNTIME_TTL_MS,
    invite: runtime.invite
  };
  runtimeCache.set(key, record);
  return record.invite;
}

function extractDiscordInviteCodes(content: string) {
  DISCORD_INVITE_PATTERN.lastIndex = 0;
  const codes = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = DISCORD_INVITE_PATTERN.exec(content))) {
    const code = normalizeInviteCode(match[1]);
    if (code) codes.add(code);
  }

  return [...codes];
}

function officialInviteCodes(invite: NexTechInviteRuntimeInvite) {
  const codes = new Set<string>();
  const code = normalizeInviteCode(invite.code);
  const urlCode = normalizeInviteCode(extractInviteCodeFromUrl(invite.inviteUrl));

  if (code) codes.add(code);
  if (urlCode) codes.add(urlCode);

  return codes;
}

function buildInvitePanelPayload(guild: NonNullable<Message["guild"]>, invite: NexTechInviteRuntimeInvite) {
  const button = new ButtonBuilder()
    .setLabel((invite.buttonLabel || "Entrar no Servidor").slice(0, 80))
    .setStyle(ButtonStyle.Link)
    .setURL(invite.inviteUrl ?? `https://discord.gg/${invite.code}`);

  if (invite.buttonEmoji) {
    try {
      button.setEmoji(invite.buttonEmoji);
    } catch {
      // Emoji personalizado inválido não deve impedir a publicação do painel.
    }
  }

  const actions = [new ActionRowBuilder<ButtonBuilder>().addComponents(button)];
  const videoField = invite.videoUrl ? [`**Vídeo:** ${invite.videoUrl}`] : [];

  return renderComponentsV2Panel({
    accentColor: parsePanelColor(invite.panelColor),
    actions,
    description: invite.description || "Entre utilizando nosso convite oficial.\nClique abaixo para entrar.",
    fields: videoField,
    footer: invite.footerText || "NextTech",
    guild,
    image: invite.imageUrl || invite.bannerUrl
      ? {
          imageEnabled: true,
          imagePosition: "banner",
          imageUrl: invite.imageUrl ?? invite.bannerUrl ?? null
        }
      : null,
    moduleId: MODULE_ID,
    title: invite.panelTitle || "NEXTTECH"
  });
}

function extractInviteCodeFromUrl(value: string | null | undefined) {
  if (!value) return null;
  DISCORD_INVITE_PATTERN.lastIndex = 0;
  return DISCORD_INVITE_PATTERN.exec(value)?.[1] ?? null;
}

function normalizeInviteCode(value: string | null | undefined) {
  const code = value?.trim().replace(/[^\w-]/g, "").toLowerCase() ?? "";
  return code || null;
}

function parsePanelColor(value: string | null | undefined) {
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) return 0xffd500;
  return Number.parseInt(value.slice(1), 16);
}

async function notifyAuthor(message: Message) {
  const text = `Seu convite foi bloqueado. Use apenas o convite oficial deste servidor.`;

  await message.author.send(text).catch(async () => {
    if (!message.channel.isSendable()) return;
    const warning = await message.channel.send({
      allowedMentions: { users: [message.author.id] },
      content: `<@${message.author.id}> ${text}`
    });
    const timer = setTimeout(() => void warning.delete().catch(() => undefined), 12_000);
    timer.unref();
  });
}

async function sendInviteLog(message: Message, invite: NexTechInviteRuntimeInvite, blockedCode: string) {
  const guild = message.guild;
  if (!guild) return;
  const channelId = invite.alertChannelId ?? invite.logChannelId;
  if (!channelId) return;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.isSendable()) return;

  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (me && "permissionsFor" in channel) {
    const permissions = channel.permissionsFor(me);
    if (!permissions?.has(PermissionFlagsBits.SendMessages)) return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xffd500)
    .setTitle("Convite externo bloqueado")
    .setDescription([
      `**Usuário:** ${message.author.tag} (${message.author.id})`,
      `**Canal:** <#${message.channelId}>`,
      `**Convite bloqueado:** ${blockedCode}`,
      `**Convite oficial:** ${invite.inviteUrl ?? invite.code}`
    ].join("\n"))
    .setTimestamp();

  await channel.send({ allowedMentions: { parse: [] }, embeds: [embed] });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

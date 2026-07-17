import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  UserSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type Interaction,
  type Message,
  type TextBasedChannel,
  type TextChannel
} from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import type { BotCommand, BotContext } from "../types";
import type { VisibleMessageUser } from "./apiClient";

const MODULE_ID = "visible-message";
const WEBHOOK_NAME = "NexTech Mensagem Visível";
const PREFIX = "visible_message";
const CACHE_TTL_MS = 30_000;
const activeUserCache = new Map<string, { enabled: boolean; expiresAt: number }>();

export const visibleMessageActivateCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("mensagem-ativar")
    .setDescription("Abre o painel para ativar mensagens visíveis para usuários.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  moduleId: MODULE_ID,
  async execute(interaction, context) {
    await openVisibleMessagePanel(interaction, context);
  }
};

export const visibleMessageDeactivateCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("mensagem-desativar")
    .setDescription("Abre o painel para remover usuários da Mensagem Visível.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  moduleId: MODULE_ID,
  async execute(interaction, context) {
    await openVisibleMessagePanel(interaction, context, "remove");
  }
};

export async function handleVisibleMessageInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.guild || !interaction.isRepliable() || !("customId" in interaction)) return false;
  const customId = String(interaction.customId);
  if (!customId.startsWith(`${PREFIX}:`)) return false;

  if (!interaction.member || !canManage(interaction.member as GuildMember)) {
    await interaction.reply({ content: "Você não tem permissão para gerenciar a Mensagem Visível.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.isButton() && customId === `${PREFIX}:add`) {
    await interaction.update(panelPayload(await context.api.listVisibleMessageUsers(interaction.guild.id), "add"));
    return true;
  }

  if (interaction.isButton() && customId === `${PREFIX}:remove`) {
    await interaction.update(panelPayload(await context.api.listVisibleMessageUsers(interaction.guild.id), "remove"));
    return true;
  }

  if (interaction.isButton() && customId === `${PREFIX}:refresh`) {
    await interaction.update(panelPayload(await context.api.listVisibleMessageUsers(interaction.guild.id)));
    return true;
  }

  if (interaction.isButton() && customId === `${PREFIX}:clear`) {
    await context.api.clearVisibleMessageUsers(interaction.guild.id, interaction.user.id);
    clearVisibleMessageCache(interaction.guild.id);
    await interaction.update(panelPayload([]));
    return true;
  }

  if (interaction.isUserSelectMenu() && customId === `${PREFIX}:select_add`) {
    const userId = interaction.values[0];
    const member = userId ? await interaction.guild.members.fetch(userId).catch(() => null) : null;
    const user = member?.user ?? (userId ? await interaction.client.users.fetch(userId).catch(() => null) : null);
    if (!userId || !user) {
      await interaction.reply({ content: "Não foi possível identificar o usuário selecionado.", flags: MessageFlags.Ephemeral });
      return true;
    }

    await context.api.addVisibleMessageUser(interaction.guild.id, {
      avatarUrl: member?.displayAvatarURL({ forceStatic: false, size: 128 }) ?? user.displayAvatarURL({ forceStatic: false, size: 128 }),
      userId,
      username: member?.displayName ?? user.globalName ?? user.username
    }, interaction.user.id);
    clearVisibleMessageCache(interaction.guild.id, userId);
    await interaction.update(panelPayload(await context.api.listVisibleMessageUsers(interaction.guild.id)));
    return true;
  }

  if (interaction.isUserSelectMenu() && customId === `${PREFIX}:select_remove`) {
    const userId = interaction.values[0];
    if (userId) {
      await context.api.removeVisibleMessageUser(interaction.guild.id, userId, interaction.user.id);
      clearVisibleMessageCache(interaction.guild.id, userId);
    }
    await interaction.update(panelPayload(await context.api.listVisibleMessageUsers(interaction.guild.id)));
    return true;
  }

  return false;
}

export async function handleVisibleMessageMessage(message: Message, context: BotContext) {
  if (!isBotModuleEnabled(MODULE_ID) || !message.guild || message.author.bot || message.webhookId) return false;

  const enabled = await isActiveVisibleUser(message.guild.id, message.author.id, context).catch((error) => {
    console.warn("[visible-message] falha ao consultar usuário:", error instanceof Error ? error.message : error);
    return false;
  });
  if (!enabled) return false;

  if (!message.channel.isTextBased() || message.channel.isDMBased() || !("permissionsFor" in message.channel)) return false;
  const channel = message.channel as TextBasedChannel & TextChannel;
  const me = message.guild.members.me ?? await message.guild.members.fetchMe().catch(() => null);
  const permissions = me ? channel.permissionsFor(me) : null;
  if (!permissions?.has(PermissionFlagsBits.SendMessages) || !permissions.has(PermissionFlagsBits.ManageMessages) || !permissions.has(PermissionFlagsBits.ManageWebhooks)) {
    console.warn(`[visible-message] permissões insuficientes guild=${message.guild.id} channel=${message.channelId}`);
    return false;
  }

  const payload = relayPayload(message);
  if (!payload.content && !payload.files?.length && !payload.embeds?.length) return false;

  const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
  const identity = resolveVisibleIdentity(message, member);

  try {
    const webhook = await getOrCreateVisibleWebhook(channel);
    await message.delete();
    await webhook.send({
      allowedMentions: { parse: [] },
      avatarURL: identity.avatarURL,
      content: payload.content,
      embeds: payload.embeds,
      files: payload.files,
      username: identity.username
    });
    return true;
  } catch (error) {
    console.error("[visible-message] falha ao retransmitir:", error instanceof Error ? error.message : error);
    return false;
  }
}

export function clearVisibleMessageCache(guildId?: string | null, userId?: string | null) {
  if (!guildId) {
    activeUserCache.clear();
    return;
  }

  if (userId) {
    activeUserCache.delete(cacheKey(guildId, userId));
    return;
  }

  for (const key of activeUserCache.keys()) {
    if (key.startsWith(`${guildId}:`)) activeUserCache.delete(key);
  }
}

async function openVisibleMessagePanel(interaction: ChatInputCommandInteraction, context: BotContext, mode?: "remove") {
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!canManage(interaction.member as GuildMember)) {
    await interaction.reply({ content: "Apenas Administrador ou Gerenciar Servidor pode gerenciar a Mensagem Visível.", flags: MessageFlags.Ephemeral });
    return;
  }

  const users = await context.api.listVisibleMessageUsers(interaction.guild.id);
  await interaction.reply(panelPayload(users, mode));
}

function panelPayload(users: VisibleMessageUser[], mode?: "add" | "remove") {
  const components: any[] = [
    {
      type: 17,
      accent_color: 0x22c55e,
      components: [
        { type: 10, content: panelText(users) },
        actionRow()
      ]
    }
  ];

  if (mode === "add") {
    components[0].components.push(
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(`${PREFIX}:select_add`)
          .setPlaceholder("Selecione o usuário para cadastrar")
          .setMinValues(1)
          .setMaxValues(1)
      )
    );
  }

  if (mode === "remove") {
    components[0].components.push(removeSelect(users));
  }

  return {
    components,
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  };
}

function panelText(users: VisibleMessageUser[]) {
  const lines = users.slice(0, 40).map((user) => `• ${user.username || `<@${user.userId}>`}`);
  const hidden = users.length > 40 ? `\n• ... mais ${users.length - 40} usuário(s)` : "";
  return [
    "# Mensagem Visível",
    "━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "## Usuários ativos",
    lines.length ? lines.join("\n") + hidden : "Nenhum usuário cadastrado.",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
    "",
    `**Total:** ${users.length} usuário(s)`
  ].join("\n");
}

function actionRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:add`).setLabel("Cadastrar Pessoa").setEmoji("➕").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}:remove`).setLabel("Remover Pessoa").setEmoji("➖").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`${PREFIX}:refresh`).setLabel("Atualizar").setEmoji("🔄").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}:clear`).setLabel("Limpar Todos").setEmoji("🗑️").setStyle(ButtonStyle.Secondary)
  );
}

function removeSelect(users: VisibleMessageUser[]) {
  const select = new UserSelectMenuBuilder()
    .setCustomId(`${PREFIX}:select_remove`)
    .setPlaceholder(users.length ? "Selecione o usuário para remover" : "Nenhum usuário cadastrado")
    .setMinValues(1)
    .setMaxValues(1)
    .setDisabled(!users.length);

  return new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(select);
}

async function isActiveVisibleUser(guildId: string, userId: string, context: BotContext) {
  const key = cacheKey(guildId, userId);
  const cached = activeUserCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.enabled;

  const enabled = await context.api.isVisibleMessageUserEnabled(guildId, userId);
  activeUserCache.set(key, { enabled, expiresAt: Date.now() + CACHE_TTL_MS });
  return enabled;
}

function relayPayload(message: Message) {
  return {
    content: message.content ? message.content.slice(0, 2000) : undefined,
    embeds: message.embeds.map((embed) => embed.toJSON()).slice(0, 10),
    files: message.attachments.map((attachment) => ({
      attachment: attachment.url,
      name: attachment.name ?? `arquivo-${attachment.id}`
    })).slice(0, 10)
  };
}

function resolveVisibleIdentity(message: Message, member: GuildMember | null) {
  const displayName = member?.displayName || message.author.globalName || message.author.username;
  const avatarURL = member?.avatarURL({ forceStatic: false, size: 256 })
    ?? member?.displayAvatarURL({ forceStatic: false, size: 256 })
    ?? message.author.displayAvatarURL({ forceStatic: false, size: 256 });

  return {
    avatarURL,
    username: sanitizeWebhookUsername(displayName)
  };
}

async function getOrCreateVisibleWebhook(channel: TextChannel) {
  const webhooks = await channel.fetchWebhooks();
  const existing = webhooks.find((webhook) => webhook.name === WEBHOOK_NAME && webhook.owner?.id === channel.client.user?.id);
  if (existing) return existing;
  return channel.createWebhook({ name: WEBHOOK_NAME, reason: "Mensagem Visível" });
}

function sanitizeWebhookUsername(username: string) {
  const normalized = username
    .replace(/@everyone/gi, "everyone")
    .replace(/@here/gi, "here")
    .trim()
    .slice(0, 80);

  return normalized || "Usuário";
}

function canManage(member: GuildMember) {
  return member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild);
}

function cacheKey(guildId: string, userId: string) {
  return `${guildId}:${userId}`;
}

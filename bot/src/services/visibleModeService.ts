import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type GuildMember
} from "discord.js";
import { currentRuntimeBotId } from "../config/env";
import type { BotCommand, BotContext } from "../types";
import type { VisibleUser } from "./apiClient";

const MODULE_ID = "visible-mode";
const CACHE_TTL_MS = 5 * 60_000;
const guildCache = new Map<string, { expiresAt: number; users: Set<string> }>();

export const visibleCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("visivel")
    .setDescription("Mostra se você está liberado para responder em Modo Visível."),
  moduleId: MODULE_ID,
  async execute(interaction, context) {
    await handleVisibleStatus(interaction, context);
  }
};

export const visibleConfigCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("visivel-config")
    .setDescription("Configura usuários liberados para responder em Modo Visível.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand
      .setName("adicionar")
      .setDescription("Libera um usuário para responder com a própria identidade.")
      .addUserOption((option) => option.setName("usuario").setDescription("Usuário liberado.").setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("remover")
      .setDescription("Remove um usuário do Modo Visível.")
      .addUserOption((option) => option.setName("usuario").setDescription("Usuário removido.").setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("buscar")
      .setDescription("Pesquisa um usuário cadastrado.")
      .addUserOption((option) => option.setName("usuario").setDescription("Usuário pesquisado.").setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName("listar").setDescription("Lista os usuários cadastrados."))
    .addSubcommand((subcommand) => subcommand.setName("quantidade").setDescription("Mostra a quantidade de usuários cadastrados."))
    .addSubcommand((subcommand) => subcommand.setName("limpar").setDescription("Remove todos os usuários cadastrados.")),
  moduleId: MODULE_ID,
  async execute(interaction, context) {
    await handleVisibleConfig(interaction, context);
  }
};

export async function preloadVisibleModeUsers(client: Client<true>, context: BotContext) {
  await Promise.allSettled(client.guilds.cache.map((guild) => refreshGuildVisibleUsers(context, guild.id)));
}

export function clearVisibleModeCache(guildId?: string | null) {
  if (!guildId) {
    guildCache.clear();
    return;
  }
  guildCache.delete(guildId);
}

export async function isUserInVisibleMode(context: BotContext, guildId: string, userId: string) {
  const cached = guildCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.users.has(userId);
  }

  try {
    const users = await context.api.listVisibleUsers(guildId);
    setGuildCache(guildId, users);
    return users.some((user) => user.userId === userId);
  } catch (error) {
    console.warn("[visible-mode] falha ao consultar usuarios; mantendo modo atual:", error instanceof Error ? error.message : error);
    return false;
  }
}

async function handleVisibleStatus(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
    return;
  }

  const enabled = await isUserInVisibleMode(context, interaction.guild.id, interaction.user.id);
  await interaction.reply({
    content: enabled
      ? "Você está liberado para responder em Modo Visível neste servidor."
      : "Você não está cadastrado no Modo Visível neste servidor.",
    ephemeral: true
  });
}

async function handleVisibleConfig(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
    return;
  }

  if (!canManageVisibleMode(interaction.member as GuildMember)) {
    await interaction.reply({ content: "Você precisa ser administrador ou ter Gerenciar Servidor para configurar o Modo Visível.", ephemeral: true });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  if (subcommand === "adicionar") {
    const user = interaction.options.getUser("usuario", true);
    await context.api.addVisibleUser(guildId, user.id, interaction.user.id);
    await refreshGuildVisibleUsers(context, guildId);
    await interaction.reply({ content: `<@${user.id}> foi liberado para responder em Modo Visível.`, ephemeral: true, allowedMentions: { users: [user.id] } });
    return;
  }

  if (subcommand === "remover") {
    const user = interaction.options.getUser("usuario", true);
    const result = await context.api.removeVisibleUser(guildId, user.id, interaction.user.id);
    await refreshGuildVisibleUsers(context, guildId);
    await interaction.reply({ content: result.removed ? `<@${user.id}> foi removido do Modo Visível.` : `<@${user.id}> não estava cadastrado no Modo Visível.`, ephemeral: true, allowedMentions: { users: [user.id] } });
    return;
  }

  if (subcommand === "buscar") {
    const user = interaction.options.getUser("usuario", true);
    const enabled = await isUserInVisibleMode(context, guildId, user.id);
    await interaction.reply({ content: enabled ? `<@${user.id}> está cadastrado no Modo Visível.` : `<@${user.id}> não está cadastrado no Modo Visível.`, ephemeral: true, allowedMentions: { users: [user.id] } });
    return;
  }

  if (subcommand === "listar") {
    const users = await refreshGuildVisibleUsers(context, guildId);
    await interaction.reply({ content: formatVisibleUserList(users), ephemeral: true });
    return;
  }

  if (subcommand === "quantidade") {
    const users = await refreshGuildVisibleUsers(context, guildId);
    await interaction.reply({ content: `Modo Visível possui ${users.length} usuário(s) cadastrado(s) neste servidor.`, ephemeral: true });
    return;
  }

  if (subcommand === "limpar") {
    const result = await context.api.clearVisibleUsers(guildId, interaction.user.id);
    clearVisibleModeCache(guildId);
    await interaction.reply({ content: `${result.removed} usuário(s) removido(s) do Modo Visível.`, ephemeral: true });
  }
}

async function refreshGuildVisibleUsers(context: BotContext, guildId: string) {
  const users = await context.api.listVisibleUsers(guildId);
  setGuildCache(guildId, users);
  return users;
}

function setGuildCache(guildId: string, users: VisibleUser[]) {
  guildCache.set(guildId, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    users: new Set(users.map((user) => user.userId))
  });
}

function formatVisibleUserList(users: VisibleUser[]) {
  if (!users.length) return "Nenhum usuário cadastrado no Modo Visível.";
  const lines = users.slice(0, 25).map((user, index) => `${index + 1}. <@${user.userId}> (${user.userId})`);
  const suffix = users.length > lines.length ? `\n...e mais ${users.length - lines.length} usuário(s).` : "";
  return [`Usuários cadastrados no Modo Visível:`, ...lines].join("\n").concat(suffix).slice(0, 1900);
}

function canManageVisibleMode(member: GuildMember) {
  return member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild);
}

export function visibleModeSocketMatches(payload: { botId?: string | null; guildId: string }) {
  const runtimeBotId = currentRuntimeBotId();
  return !runtimeBotId || !payload.botId || payload.botId === runtimeBotId;
}

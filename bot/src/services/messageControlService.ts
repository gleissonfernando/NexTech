import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type Interaction,
  type Message
} from "discord.js";
import type { BotCommand, BotContext } from "../types";
import type { MessageControlStatus, MessageControlUser } from "./apiClient";

const PREFIX = "message_control";
const CACHE_TTL_MS = 30_000;
const userConfigCache = new Map<string, { expiresAt: number; user: MessageControlUser | null }>();
const managerSettingsCache = new Map<string, { expiresAt: number; roleIds: string[]; userIds: string[] }>();

export const messageControlCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("mensagem")
    .setDescription("Controla o modo de mensagem individual.")
    .addSubcommand((subcommand) => subcommand
      .setName("config")
      .setDescription("Abre o painel de configuração do controle individual."))
    .addSubcommand((subcommand) => subcommand
      .setName("ativar")
      .setDescription("Reativa o modo oculto para suas mensagens."))
    .addSubcommand((subcommand) => subcommand
      .setName("desativar")
      .setDescription("Deixa suas mensagens passarem pela sua própria conta Discord."))
    .addSubcommand((subcommand) => subcommand
      .setName("reativar")
      .setDescription("Atalho para reativar o modo oculto para suas mensagens.")),
  moduleId: undefined,
  async execute(interaction, context) {
    if (!isMessageControlEnabled()) {
      await interaction.reply({ content: "O sistema /mensagem não está liberado para este bot.", flags: MessageFlags.Ephemeral });
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "config") {
      await openMessageControlPanel(interaction, context);
      return;
    }

    if (subcommand === "desativar") {
      await setOwnMessageControlStatus(interaction, context, "pessoal");
      return;
    }

    if (subcommand === "ativar" || subcommand === "reativar") {
      await setOwnMessageControlStatus(interaction, context, "equipe");
    }
  }
};

export const messageControlActivateAliasCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("mensagem-ativar")
    .setDescription("Legado: reativa o modo oculto para suas mensagens."),
  moduleId: undefined,
  async execute(interaction, context) {
    await setOwnMessageControlStatus(interaction, context, "equipe");
  }
};

export const messageControlDeactivateAliasCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("mensagem-desativar")
    .setDescription("Legado: deixa suas mensagens passarem pela sua própria conta Discord."),
  moduleId: undefined,
  async execute(interaction, context) {
    await setOwnMessageControlStatus(interaction, context, "pessoal");
  }
};

export async function handleMessageControlInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.guild || !interaction.isRepliable() || !("customId" in interaction)) return false;
  const customId = String(interaction.customId);
  if (!customId.startsWith(`${PREFIX}:`)) return false;

  if (!await canManageMessageControl(interaction, context)) {
    await interaction.reply({ content: "Você não tem permissão para gerenciar o /mensagem config.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.isButton() && customId === `${PREFIX}:add`) {
    await interaction.update(panelPayload(await context.api.listMessageControlUsers(interaction.guild.id), "add"));
    return true;
  }

  if (interaction.isButton() && customId === `${PREFIX}:remove`) {
    await interaction.update(panelPayload(await context.api.listMessageControlUsers(interaction.guild.id), "remove"));
    return true;
  }

  if (interaction.isButton() && customId === `${PREFIX}:personal`) {
    await interaction.update(panelPayload(await context.api.listMessageControlUsers(interaction.guild.id), "personal"));
    return true;
  }

  if (interaction.isButton() && customId === `${PREFIX}:team`) {
    await interaction.update(panelPayload(await context.api.listMessageControlUsers(interaction.guild.id), "team"));
    return true;
  }

  if (interaction.isButton() && customId === `${PREFIX}:refresh`) {
    await interaction.update(panelPayload(await context.api.listMessageControlUsers(interaction.guild.id)));
    return true;
  }

  if (interaction.isButton() && customId === `${PREFIX}:permissions`) {
    await interaction.update(await permissionsPayload(interaction.guild.id, context));
    return true;
  }

  if (interaction.isButton() && customId === `${PREFIX}:clear`) {
    await context.api.clearMessageControlUsers(interaction.guild.id, interaction.user.id);
    clearMessageControlCache(interaction.guild.id);
    await interaction.update(panelPayload([]));
    return true;
  }

  if (interaction.isUserSelectMenu() && customId === `${PREFIX}:select_add`) {
    const discordId = interaction.values[0];
    const member = discordId ? await interaction.guild.members.fetch(discordId).catch(() => null) : null;
    const user = member?.user ?? (discordId ? await interaction.client.users.fetch(discordId).catch(() => null) : null);
    if (!discordId || !user) {
      await interaction.reply({ content: "Não foi possível identificar o usuário selecionado.", flags: MessageFlags.Ephemeral });
      return true;
    }

    await context.api.addMessageControlUser(interaction.guild.id, {
      avatarUrl: member?.displayAvatarURL({ forceStatic: false, size: 128 }) ?? user.displayAvatarURL({ forceStatic: false, size: 128 }),
      discordId,
      username: member?.displayName ?? user.globalName ?? user.username
    }, interaction.user.id);
    clearMessageControlCache(interaction.guild.id, discordId);
    await interaction.update(panelPayload(await context.api.listMessageControlUsers(interaction.guild.id)));
    return true;
  }

  if (interaction.isUserSelectMenu() && customId === `${PREFIX}:manager_users`) {
    await context.api.saveMessageControlSettings(interaction.guild.id, { managerUserIds: interaction.values }, interaction.user.id);
    clearMessageControlCache(interaction.guild.id);
    await interaction.update(await permissionsPayload(interaction.guild.id, context, `Usuários gerentes atualizados: ${interaction.values.length}.`));
    return true;
  }

  if (interaction.isRoleSelectMenu() && customId === `${PREFIX}:manager_roles`) {
    await context.api.saveMessageControlSettings(interaction.guild.id, { managerRoleIds: interaction.values }, interaction.user.id);
    clearMessageControlCache(interaction.guild.id);
    await interaction.update(await permissionsPayload(interaction.guild.id, context, `Cargos gerentes atualizados: ${interaction.values.length}.`));
    return true;
  }

  if (interaction.isStringSelectMenu() && customId === `${PREFIX}:select_remove`) {
    const discordId = interaction.values[0];
    if (discordId && discordId !== "none") {
      await context.api.removeMessageControlUser(interaction.guild.id, discordId, interaction.user.id);
      clearMessageControlCache(interaction.guild.id, discordId);
    }
    await interaction.update(panelPayload(await context.api.listMessageControlUsers(interaction.guild.id)));
    return true;
  }

  if (interaction.isStringSelectMenu() && (customId === `${PREFIX}:select_personal` || customId === `${PREFIX}:select_team`)) {
    const discordId = interaction.values[0];
    const status: MessageControlStatus = customId === `${PREFIX}:select_personal` ? "pessoal" : "equipe";
    if (discordId && discordId !== "none") {
      await context.api.setMessageControlUserStatus(interaction.guild.id, discordId, status, interaction.user.id);
      clearMessageControlCache(interaction.guild.id, discordId);
    }
    await interaction.update(panelPayload(await context.api.listMessageControlUsers(interaction.guild.id)));
    return true;
  }

  return false;
}

export async function shouldBypassMessageControl(message: Message, context: BotContext) {
  if (!isMessageControlEnabled() || !message.guild || message.author.bot || message.webhookId) return false;
  const config = await getMessageControlUserConfig(message.guild.id, message.author.id, context).catch((error) => {
    console.warn("[message-control] falha ao consultar configuração individual:", error instanceof Error ? error.message : error);
    return null;
  });
  return Boolean(config?.autorizado && config.status === "pessoal");
}

export function clearMessageControlCache(guildId?: string | null, discordId?: string | null) {
  if (!guildId) {
    userConfigCache.clear();
    managerSettingsCache.clear();
    return;
  }

  if (discordId) {
    userConfigCache.delete(cacheKey(guildId, discordId));
    return;
  }

  for (const key of userConfigCache.keys()) {
    if (key.startsWith(`${guildId}:`)) userConfigCache.delete(key);
  }
  managerSettingsCache.delete(guildId);
}

async function openMessageControlPanel(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!await canManageMessageControl(interaction, context)) {
    await interaction.reply({ content: "Você não tem permissão para abrir o /mensagem config.", flags: MessageFlags.Ephemeral });
    return;
  }

  const users = await context.api.listMessageControlUsers(interaction.guild.id);
  await interaction.reply(panelPayload(users));
}

async function setOwnMessageControlStatus(interaction: ChatInputCommandInteraction, context: BotContext, status: MessageControlStatus) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  const current = await context.api.getMessageControlUser(interaction.guild.id, interaction.user.id).catch((error) => {
    console.warn("[message-control] falha ao consultar usuário individual:", error instanceof Error ? error.message : error);
    return null;
  });

  if (!current?.autorizado) {
    await interaction.reply({
      content: "Você não está cadastrado no /mensagem config e não pode alterar o modo individual.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const updated = await context.api.setMessageControlUserStatus(interaction.guild.id, interaction.user.id, status, interaction.user.id);
  clearMessageControlCache(interaction.guild.id, interaction.user.id);
  await interaction.reply({
    content: updated.status === "pessoal"
      ? "Modo pessoal ativado. Suas próximas mensagens ficam normais pela sua conta Discord."
      : "Modo oculto ativado. Suas próximas mensagens voltam ao fluxo padrão do bot/equipe.",
    flags: MessageFlags.Ephemeral
  });
}

function panelPayload(users: MessageControlUser[], mode?: "add" | "remove" | "personal" | "team") {
  const components: any[] = [
    {
      type: 17,
      accent_color: 0x22c55e,
      components: [
        { type: 10, content: panelText(users) },
        actionRow(),
        clearRow()
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

  if (mode === "remove") components[0].components.push(removeSelect(users));
  if (mode === "personal" || mode === "team") components[0].components.push(statusSelect(users, mode === "personal" ? "pessoal" : "equipe"));

  return {
    components,
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  };
}

function panelText(users: MessageControlUser[]) {
  const lines = users.slice(0, 40).map((user) => `• ${user.username || `<@${user.discordId}>`} - **${modeLabel(user.status)}**`);
  const hidden = users.length > 40 ? `\n• ... mais ${users.length - 40} usuário(s)` : "";
  return [
    "# /mensagem config",
    "━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "## Controle individual de mensagem",
    lines.length ? lines.join("\n") + hidden : "Nenhum usuário cadastrado.",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
    "",
    `**Total:** ${users.length} usuário(s)`,
    "",
    "Usuários cadastrados podem alternar entre **oculto** e **pessoal**. `/mensagem ativar` reativa o modo oculto; `/mensagem desativar` libera a mensagem normal pela conta Discord."
  ].join("\n");
}

function actionRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:add`).setLabel("Adicionar usuário").setEmoji("➕").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}:remove`).setLabel("Remover usuário").setEmoji("➖").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`${PREFIX}:personal`).setLabel("Ativar pessoal").setEmoji("👤").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}:team`).setLabel("Ativar oculto").setEmoji("🛡️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}:refresh`).setLabel("Visualizar usuários").setEmoji("🔄").setStyle(ButtonStyle.Secondary)
  );
}

function clearRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:permissions`).setLabel("Permissões").setEmoji("⚙️").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}:clear`).setLabel("Limpar Todos").setEmoji("🗑️").setStyle(ButtonStyle.Secondary)
  );
}

function removeSelect(users: MessageControlUser[]) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:select_remove`)
    .setPlaceholder(users.length ? "Selecione o usuário para remover" : "Nenhum usuário cadastrado")
    .setMinValues(1)
    .setMaxValues(1)
    .setDisabled(!users.length)
    .addOptions(registeredUserOptions(users));

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

function statusSelect(users: MessageControlUser[], status: MessageControlStatus) {
  const candidates = users.filter((user) => user.status !== status);
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:select_${status === "pessoal" ? "personal" : "team"}`)
    .setPlaceholder(status === "pessoal" ? "Selecione quem ficará pessoal" : "Selecione quem voltará ao oculto")
    .setMinValues(1)
    .setMaxValues(1)
    .setDisabled(!candidates.length)
    .addOptions(registeredUserOptions(candidates));

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

async function permissionsPayload(guildId: string, context: BotContext, message?: string) {
  const settings = await context.api.getMessageControlSettings(guildId);
  return {
    components: [
      {
        type: 17,
        accent_color: 0x22c55e,
        components: [
          {
            type: 10,
            content: [
              "# Permissões do Sistema",
              "",
              "Selecione quem pode abrir `/mensagem config`, adicionar usuários, remover usuários e alterar permissões.",
              "",
              `**Cargos gerentes:** ${settings.managerRoleIds.length ? settings.managerRoleIds.map((id) => `<@&${id}>`).join(", ") : "nenhum"}`,
              `**Usuários gerentes:** ${settings.managerUserIds.length ? settings.managerUserIds.map((id) => `<@${id}>`).join(", ") : "nenhum"}`,
              message ? `\n${message}` : null
            ].filter(Boolean).join("\n")
          },
          new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
            new RoleSelectMenuBuilder()
              .setCustomId(`${PREFIX}:manager_roles`)
              .setPlaceholder("Cargos que podem gerenciar")
              .setMinValues(0)
              .setMaxValues(10)
          ),
          new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
            new UserSelectMenuBuilder()
              .setCustomId(`${PREFIX}:manager_users`)
              .setPlaceholder("Usuários que podem gerenciar")
              .setMinValues(0)
              .setMaxValues(10)
          ),
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`${PREFIX}:refresh`).setLabel("Voltar").setStyle(ButtonStyle.Secondary)
          )
        ]
      }
    ],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  };
}

function registeredUserOptions(users: MessageControlUser[]) {
  const options = users.slice(0, 25).map((user) => ({
    description: `${modeLabel(user.status)} - ${user.discordId}`.slice(0, 100),
    label: (user.username || user.discordId).slice(0, 100),
    value: user.discordId
  }));

  return options.length ? options : [{ label: "Nenhum usuário disponível", value: "none" }];
}

async function getMessageControlUserConfig(guildId: string, discordId: string, context: BotContext) {
  const key = cacheKey(guildId, discordId);
  const cached = userConfigCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  const user = await context.api.getMessageControlUser(guildId, discordId);
  userConfigCache.set(key, { user, expiresAt: Date.now() + CACHE_TTL_MS });
  return user;
}

function modeLabel(status: MessageControlStatus) {
  return status === "pessoal" ? "pessoal" : "oculto";
}

function canManage(member: GuildMember) {
  return member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild);
}

async function canManageMessageControl(interaction: Interaction, context: BotContext) {
  if (!interaction.guild || !interaction.member) return false;
  const member = interaction.member as GuildMember;
  if (canManage(member)) return true;

  const settings = await getMessageControlManagerSettings(interaction.guild.id, context).catch(() => null);
  if (!settings) return false;
  return settings.userIds.includes(interaction.user.id)
    || settings.roleIds.some((roleId) => member.roles.cache.has(roleId));
}

async function getMessageControlManagerSettings(guildId: string, context: BotContext) {
  const cached = managerSettingsCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const settings = await context.api.getMessageControlSettings(guildId);
  const value = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    roleIds: settings.managerRoleIds,
    userIds: settings.managerUserIds
  };
  managerSettingsCache.set(guildId, value);
  return value;
}

function cacheKey(guildId: string, discordId: string) {
  return `${guildId}:${discordId}`;
}

function isMessageControlEnabled() {
  return true;
}

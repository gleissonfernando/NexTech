import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type Interaction,
  type ModalSubmitInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
  type TextChannel
} from "discord.js";
import type { BotCommand, BotContext } from "../types";
import type { DafScaleActionResult, DafScaleRole, DafScaleSettings, DafScaleState } from "./apiClient";
import { systemComponentEmoji, systemEmojiText, systemStatusEmoji } from "./systemEmojiService";

const PREFIX = "daf_scale";
const MODULE_ID = "police-daf-roster";
const COOLDOWN_MS = 3000;
const cooldowns = new Map<string, number>();

export const dafCommand = createDafCommand("daf");
export const escalaDafCommand = createDafCommand("escala-daf");

export async function handleDafScaleInteraction(interaction: Interaction, context: BotContext) {
  if (!("customId" in interaction) || !String(interaction.customId).startsWith(`${PREFIX}:`)) return false;
  if (!interaction.guild || !interaction.isRepliable()) return true;

  try {
    const [, action] = String(interaction.customId).split(":");
    if (interaction.isButton()) {
      if (action === "config") await showConfig(interaction, context);
      else if (action === "toggle") await toggleEnabled(interaction, context);
      else if (action === "limits") await showLimitsModal(interaction);
      else if (action === "publish") await publishPanel(interaction, context);
      else if (action === "join") await showJoinMenu(interaction, context);
      else if (action === "leave") await leaveScale(interaction, context);
      else if (action === "refresh") await refreshPanel(interaction, context);
      else await interaction.reply({ content: "Interação inválida.", ephemeral: true });
      return true;
    }
    if (interaction.isChannelSelectMenu()) {
      await saveChannel(interaction, context, action ?? "");
      return true;
    }
    if (interaction.isRoleSelectMenu()) {
      await saveRole(interaction, context, action ?? "");
      return true;
    }
    if (interaction.isStringSelectMenu() && action === "role") {
      await joinScale(interaction, context, readSelectedDafRole(interaction));
      return true;
    }
    if (interaction.isModalSubmit() && action === "limits") {
      await saveLimits(interaction, context);
      return true;
    }
  } catch (error) {
    console.warn("[daf-scale] falha ao processar interação:", errorMessage(error));
    await replyDafError(interaction, error);
    return true;
  }
  return true;
}

function createDafCommand(name: "daf" | "escala-daf"): BotCommand {
  return {
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription("Sistema de Escala DAF.")
      .addSubcommand((subcommand) => subcommand.setName("config").setDescription("Configura a Escala DAF."))
      .addSubcommand((subcommand) => subcommand.setName("painel").setDescription("Publica ou atualiza o painel da Escala DAF.")),
    moduleId: MODULE_ID,
    async execute(interaction, context) {
      await executeDafCommand(interaction, context);
    }
  };
}

async function executeDafCommand(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
    return;
  }
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "config") {
    if (!await canConfigure(interaction, context)) return;
    await showConfig(interaction, context);
    return;
  }
  if (!await canConfigure(interaction, context)) return;
  await publishPanel(interaction, context);
}

async function showConfig(interaction: ChatInputCommandInteraction | ButtonInteraction, context: BotContext) {
  const state = await context.api.getDafScaleState(interaction.guildId!);
  const payload = configPayload(state, interaction.guild!);
  if (interaction.isButton()) {
    await interaction.update(payload);
    return;
  }
  await interaction.reply(payload);
}

async function toggleEnabled(interaction: ButtonInteraction, context: BotContext) {
  if (!await canConfigure(interaction, context)) return;
  const state = await context.api.getDafScaleState(interaction.guildId!);
  await context.api.saveDafScaleSettings(interaction.guildId!, { enabled: !state.settings.enabled }, interaction.user.id);
  await context.api.recordDafScaleAudit(interaction.guildId!, { action: "config", metadata: { enabled: !state.settings.enabled }, userId: interaction.user.id, username: interaction.user.username });
  await interaction.update(configPayload(await context.api.getDafScaleState(interaction.guildId!), interaction.guild!));
}

async function saveChannel(interaction: ChannelSelectMenuInteraction, context: BotContext, action: string) {
  if (!await canConfigure(interaction, context)) return;
  const channelId = interaction.values[0] ?? null;
  const patch = action === "panel_channel" ? { panelChannelId: channelId } : action === "log_channel" ? { logChannelId: channelId } : null;
  if (!patch) return void await interaction.reply({ content: "Configuração inválida.", ephemeral: true });
  await context.api.saveDafScaleSettings(interaction.guildId!, patch, interaction.user.id);
  await interaction.update(configPayload(await context.api.getDafScaleState(interaction.guildId!), interaction.guild!));
}

async function saveRole(interaction: RoleSelectMenuInteraction, context: BotContext, action: string) {
  if (!await canConfigure(interaction, context)) return;
  const roleId = interaction.values[0] ?? null;
  const keyByAction: Record<string, keyof Pick<DafScaleSettings, "configRoleId" | "participantRoleId" | "pilotRoleId" | "shooterRoleId">> = {
    config_role: "configRoleId",
    participant_role: "participantRoleId",
    pilot_role: "pilotRoleId",
    shooter_role: "shooterRoleId"
  };
  const key = keyByAction[action];
  if (!key) return void await interaction.reply({ content: "Configuração inválida.", ephemeral: true });
  await context.api.saveDafScaleSettings(interaction.guildId!, { [key]: roleId }, interaction.user.id);
  await interaction.update(configPayload(await context.api.getDafScaleState(interaction.guildId!), interaction.guild!));
}

async function showLimitsModal(interaction: ButtonInteraction) {
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:limits`)
    .setTitle("Limites da Escala DAF")
    .addComponents(
      inputRow("maxPilots", "Limite máximo de pilotos", "4"),
      inputRow("maxShooters", "Limite máximo de atiradores", "6")
    );
  await interaction.showModal(modal);
}

async function saveLimits(interaction: ModalSubmitInteraction, context: BotContext) {
  if (!await canConfigure(interaction, context)) return;
  await interaction.deferReply({ ephemeral: true });
  const maxPilots = Number(interaction.fields.getTextInputValue("maxPilots"));
  const maxShooters = Number(interaction.fields.getTextInputValue("maxShooters"));
  if (!Number.isFinite(maxPilots) || !Number.isFinite(maxShooters)) {
    await interaction.editReply("Informe limites válidos.");
    return;
  }
  await context.api.saveDafScaleSettings(interaction.guildId!, { maxPilots, maxShooters }, interaction.user.id);
  await interaction.editReply("Limites da Escala DAF salvos.");
}

async function publishPanel(interaction: ChatInputCommandInteraction | ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  if (!await canConfigure(interaction, context)) return;
  await deferConfigInteraction(interaction);
  const state = await context.api.getDafScaleState(interaction.guild.id);
  const channel = await resolvePanelChannel(interaction.guild, state.settings.panelChannelId);
  if (!channel) {
    await editConfigInteraction(interaction, "Configure o canal do painel antes de publicar.");
    return;
  }
  const payload = scalePanelPayload(state, interaction.guild);
  let messageId = state.settings.panelMessageId;
  const existing = messageId ? await channel.messages.fetch(messageId).catch(() => null) : null;
  if (existing) {
    await existing.edit(payload);
  } else {
    const message = await channel.send(payload);
    messageId = message.id;
    await context.api.updateDafScalePanelMessage(interaction.guild.id, messageId, interaction.user.id);
  }
  await context.api.recordDafScaleAudit(interaction.guild.id, { action: "publish", metadata: { channelId: channel.id, messageId }, userId: interaction.user.id, username: interaction.user.username });
  await editConfigInteraction(interaction, "Painel da Escala DAF publicado/atualizado.");
}

async function showJoinMenu(interaction: ButtonInteraction, context: BotContext) {
  if (!await checkCooldown(interaction)) return;
  const state = await context.api.getDafScaleState(interaction.guildId!);
  if (!state.settings.enabled) return void await interaction.reply({ content: "A Escala DAF está desativada.", ephemeral: true });
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:role`)
    .setPlaceholder("Escolha sua função")
    .addOptions(
      { label: "Piloto", value: "pilot", emoji: "🚁", description: `${state.pilots.length}/${state.settings.maxPilots}` },
      { label: "Atirador", value: "shooter", emoji: "🎯", description: `${state.shooters.length}/${state.settings.maxShooters}` }
    );
  await interaction.reply({
    components: [{
      type: 17,
      accent_color: 0x0ea5e9,
      components: [
        { type: 10, content: `## ${systemEmojiText("acessar", interaction.guild)} Entrar na Escala DAF\nEscolha uma função para entrar ou trocar sua posição atual.` },
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)
      ]
    }],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  });
}

async function joinScale(interaction: StringSelectMenuInteraction, context: BotContext, role: DafScaleRole) {
  if (!await checkCooldown(interaction)) return;
  await interaction.deferReply({ ephemeral: true });
  const member = await interaction.guild!.members.fetch(interaction.user.id);
  const result = await context.api.joinDafScale(interaction.guildId!, {
    role,
    roleIds: member.roles.cache.map((item) => item.id),
    userId: interaction.user.id,
    username: displayName(member)
  });
  await updatePanelFromState(interaction.guild!, context, result.state);
  await sendLog(interaction.guild!, context, result, interaction.user.id, displayName(member));
  const text = result.action === "none"
    ? `Você já está como ${roleLabel(role)}.`
    : result.action === "switch"
      ? `Função alterada para ${roleLabel(role)}.`
      : `Você entrou como ${roleLabel(role)}.`;
  await interaction.editReply(text);
}

async function leaveScale(interaction: ButtonInteraction, context: BotContext) {
  if (!await checkCooldown(interaction)) return;
  await interaction.deferReply({ ephemeral: true });
  const member = await interaction.guild!.members.fetch(interaction.user.id);
  const result = await context.api.leaveDafScale(interaction.guildId!, { userId: interaction.user.id, username: displayName(member) });
  await updatePanelFromState(interaction.guild!, context, result.state);
  await sendLog(interaction.guild!, context, result, interaction.user.id, displayName(member));
  await interaction.editReply(result.action === "none" ? "Você não estava na Escala DAF." : "Você saiu da Escala DAF.");
}

async function refreshPanel(interaction: ButtonInteraction, context: BotContext) {
  if (!await checkCooldown(interaction)) return;
  await interaction.deferReply({ ephemeral: true });
  const state = await context.api.getDafScaleState(interaction.guildId!);
  await updatePanelFromState(interaction.guild!, context, state);
  await context.api.recordDafScaleAudit(interaction.guildId!, { action: "refresh", userId: interaction.user.id, username: interaction.user.username });
  await interaction.editReply("Painel atualizado.");
}

async function updatePanelFromState(guild: Guild, _context: BotContext, state: DafScaleState) {
  const channel = await resolvePanelChannel(guild, state.settings.panelChannelId);
  if (!channel || !state.settings.panelMessageId) return;
  const message = await channel.messages.fetch(state.settings.panelMessageId).catch(() => null);
  if (message) await message.edit(scalePanelPayload(state, guild));
}

async function sendLog(guild: Guild, _context: BotContext, result: DafScaleActionResult, userId: string, username: string) {
  if (result.action === "none" || !result.state.settings.logChannelId) return;
  const channel = await guild.channels.fetch(result.state.settings.logChannelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return;
  const role = result.entry?.role ?? result.previousRole;
  const changeText = result.action === "switch"
    ? `**Alteração:**\n${roleLabel(result.previousRole)}\n➡\n${roleLabel(result.entry?.role ?? null)}`
    : `**Ação:**\n${result.action === "join" ? "Entrou na escala" : "Saiu da escala"}\n\n**Função:**\n${roleLabel(role)}`;
  await channel.send({
    components: [{
      type: 17,
      accent_color: 0x0ea5e9,
      components: [{ type: 10, content: [
        `# 🚁 Escala DAF`,
        `**Usuário:**\n<@${userId}> (${username})`,
        changeText,
        `**Horário:**\n${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}`,
        "",
        "━━━━━━━━━━━━━━━━━━━━━━",
        "## ESCALA ATUAL",
        `**Pilotos (${result.state.pilots.length}/${result.state.settings.maxPilots})**`,
        listEntries(result.state.pilots, "🚁"),
        "",
        `**Atiradores (${result.state.shooters.length}/${result.state.settings.maxShooters})**`,
        listEntries(result.state.shooters, "🎯"),
        "━━━━━━━━━━━━━━━━━━━━━━"
      ].join("\n") }]
    }],
    flags: MessageFlags.IsComponentsV2
  });
}

function configPayload(state: DafScaleState, guild: Guild) {
  const s = state.settings;
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:toggle`).setLabel(s.enabled ? "Desativar" : "Ativar").setEmoji(s.enabled ? systemComponentEmoji("perigo", guild) : systemComponentEmoji("visto", guild)).setStyle(s.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}:limits`).setLabel("Limites").setEmoji(systemComponentEmoji("engrenagem", guild)).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}:publish`).setLabel("Publicar painel").setEmoji(systemComponentEmoji("acessar", guild)).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}:config`).setLabel("Atualizar").setEmoji("🔄").setStyle(ButtonStyle.Secondary)
  );
  return {
    components: [{
      type: 17,
      accent_color: s.enabled ? 0x22c55e : 0xf59e0b,
      components: [
        { type: 10, content: [
          `# 🚁 Configuração da Escala DAF`,
          `Status: ${s.enabled ? `${systemStatusEmoji("success", guild)} Ativa` : `${systemStatusEmoji("warning", guild)} Desativada`}`,
          `Painel: ${s.panelChannelId ? `<#${s.panelChannelId}>` : "não configurado"}`,
          `Logs: ${s.logChannelId ? `<#${s.logChannelId}>` : "não configurado"}`,
          `Participação: ${s.participantRoleId ? `<@&${s.participantRoleId}>` : "qualquer membro"}`,
          `Configuração: ${s.configRoleId ? `<@&${s.configRoleId}>` : "Gerenciar Servidor"}`,
          `Pilotos: ${state.pilots.length}/${s.maxPilots} | Atiradores: ${state.shooters.length}/${s.maxShooters}`
        ].join("\n") },
        channelSelect(`${PREFIX}:panel_channel`, "Canal onde ficará o painel", s.panelChannelId),
        channelSelect(`${PREFIX}:log_channel`, "Canal de logs", s.logChannelId),
        roleSelect(`${PREFIX}:participant_role`, "Cargo permitido para participar", s.participantRoleId),
        roleSelect(`${PREFIX}:config_role`, "Cargo permitido para configurar", s.configRoleId),
        roleSelect(`${PREFIX}:pilot_role`, "Cargo de Piloto opcional", s.pilotRoleId),
        roleSelect(`${PREFIX}:shooter_role`, "Cargo de Atirador opcional", s.shooterRoleId),
        buttons
      ]
    }],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  } as const;
}

function scalePanelPayload(state: DafScaleState, guild: Guild) {
  const s = state.settings;
  const icons = {
    active: systemStatusEmoji("success", guild),
    refresh: systemComponentEmoji("relogio", guild),
    enter: systemComponentEmoji("visto", guild),
    leave: systemComponentEmoji("porta", guild),
    pilot: systemEmojiText("acessar", guild),
    shooter: systemEmojiText("interrogacao", guild),
    status: systemEmojiText("prancheta_acertos", guild),
    warning: systemStatusEmoji("danger", guild)
  };
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:join`).setLabel("Entrar na Escala").setEmoji(icons.enter).setStyle(ButtonStyle.Success).setDisabled(!s.enabled),
    new ButtonBuilder().setCustomId(`${PREFIX}:leave`).setLabel("Sair da Escala").setEmoji(icons.leave).setStyle(ButtonStyle.Secondary).setDisabled(!s.enabled),
    new ButtonBuilder().setCustomId(`${PREFIX}:refresh`).setLabel("Atualizar Painel").setEmoji(icons.refresh).setStyle(ButtonStyle.Primary)
  );
  const pilotList = state.pilots.length ? numberedEntries(state.pilots, icons.pilot) : `${icons.active} Nenhum piloto na escala.`;
  const shooterList = state.shooters.length ? numberedEntries(state.shooters, icons.shooter) : `${icons.warning} Nenhum atirador na escala.`;
  return {
    components: [{
      type: 17,
      accent_color: s.enabled ? 0x0ea5e9 : 0x71717a,
      components: [
        { type: 10, content: [
          `# ${icons.pilot} ESCALA DAF`,
          `${icons.status} **Status:** ${s.enabled ? `${icons.active} Ativa` : `${icons.warning} Desativada`}  •  **Atualizada:** <t:${Math.floor(Date.now() / 1000)}:R>`,
          "",
          "**Operação ativa para composição da equipe aérea.**"
        ].join("\n") },
        separator(),
        { type: 10, content: [
          `## ${icons.pilot} Pilotos`,
          dafOccupancyLine(state.pilots.length, s.maxPilots),
          "",
          pilotList
        ].join("\n") },
        separator(),
        { type: 10, content: [
          `## ${icons.shooter} Atiradores`,
          dafOccupancyLine(state.shooters.length, s.maxShooters),
          "",
          shooterList
        ].join("\n") },
        separator(),
        { type: 10, content: [
          "### Resumo",
          `${icons.pilot} **Pilotos:** ${state.pilots.length}/${s.maxPilots}`,
          `${icons.shooter} **Atiradores:** ${state.shooters.length}/${s.maxShooters}`,
          `${icons.status} **Vagas disponíveis:** ${Math.max(0, s.maxPilots - state.pilots.length) + Math.max(0, s.maxShooters - state.shooters.length)}`
        ].join("\n") },
        separator(),
        row
      ]
    }],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function separator() {
  return { type: 14, divider: true, spacing: 1 };
}

function dafOccupancyLine(current: number, max: number) {
  const capacity = Math.max(1, max);
  const totalBlocks = 12;
  const filled = Math.max(0, Math.min(totalBlocks, Math.round((current / capacity) * totalBlocks)));
  const empty = totalBlocks - filled;
  return `\`${"█".repeat(filled)}${"░".repeat(empty)}\` **${current}/${max}**`;
}

async function canConfigure(interaction: ChatInputCommandInteraction | ButtonInteraction | ChannelSelectMenuInteraction | RoleSelectMenuInteraction | ModalSubmitInteraction, context: BotContext) {
  if (!interaction.guild) return false;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return false;
  const state = await context.api.getDafScaleState(interaction.guild.id).catch(() => null);
  const allowed = member.permissions.has(PermissionFlagsBits.ManageGuild) || Boolean(state?.settings.configRoleId && member.roles.cache.has(state.settings.configRoleId));
  if (!allowed) {
    const payload = { content: "Você precisa de Gerenciar Servidor ou do cargo configurado para gerenciar a Escala DAF.", ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => undefined);
    else await interaction.reply(payload).catch(() => undefined);
  }
  return allowed;
}

async function checkCooldown(interaction: ButtonInteraction | StringSelectMenuInteraction) {
  const key = `${interaction.guildId}:${interaction.user.id}`;
  const now = Date.now();
  const last = cooldowns.get(key) ?? 0;
  if (now - last < COOLDOWN_MS) {
    await interaction.reply({ content: "Aguarde alguns segundos antes de usar novamente.", ephemeral: true }).catch(() => undefined);
    return false;
  }
  cooldowns.set(key, now);
  return true;
}

async function resolvePanelChannel(guild: Guild, channelId: string | null) {
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased() && !channel.isDMBased() ? channel as TextChannel : null;
}

async function deferConfigInteraction(interaction: ChatInputCommandInteraction | ButtonInteraction) {
  if (interaction.isButton()) await interaction.deferReply({ ephemeral: true });
  else await interaction.deferReply({ ephemeral: true });
}

async function editConfigInteraction(interaction: ChatInputCommandInteraction | ButtonInteraction, content: string) {
  await interaction.editReply({ content });
}

function inputRow(customId: string, label: string, value: string) {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder().setCustomId(customId).setLabel(label).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2).setValue(value)
  );
}

function channelSelect(customId: string, placeholder: string, value: string | null) {
  const select = new ChannelSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1);
  if (value) select.setDefaultChannels(value);
  return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select);
}

function roleSelect(customId: string, placeholder: string, value: string | null) {
  const select = new RoleSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(0).setMaxValues(1);
  if (value) select.setDefaultRoles(value);
  return new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(select);
}

function displayName(member: GuildMember) {
  return member.displayName || member.user.globalName || member.user.username;
}

function numberedEntries(entries: Array<{ username: string; userId: string }>, emoji: string) {
  return entries.map((entry, index) => `${index + 1}. ${emoji} ${entry.username} (<@${entry.userId}>)`).join("\n");
}

function listEntries(entries: Array<{ username: string; userId: string }>, emoji: string) {
  return entries.length ? entries.map((entry) => `${emoji} ${entry.username} (<@${entry.userId}>)`).join("\n") : "Nenhum.";
}

function roleLabel(role: DafScaleRole | null | undefined) {
  if (role === "pilot") return "Piloto";
  if (role === "shooter") return "Atirador";
  return "Nenhuma";
}

function readSelectedDafRole(interaction: StringSelectMenuInteraction): DafScaleRole {
  const role = interaction.values[0];
  if (role === "pilot" || role === "shooter") {
    return role;
  }

  throw new Error("Função da Escala DAF inválida.");
}

async function replyDafError(interaction: Interaction, error: unknown) {
  if (!interaction.isRepliable()) {
    return;
  }

  const content = errorMessage(error) || "Não foi possível concluir esta interação da Escala DAF.";
  if (interaction.deferred) {
    await interaction.editReply({ content }).catch(() => undefined);
    return;
  }

  if (interaction.replied) {
    await interaction.followUp({ content, ephemeral: true }).catch(() => undefined);
    return;
  }

  await interaction.reply({ content, ephemeral: true }).catch(() => undefined);
}

function errorMessage(error: unknown) {
  const response = (error as { response?: { data?: { message?: unknown } } })?.response;
  if (typeof response?.data?.message === "string") {
    return response.data.message;
  }

  return error instanceof Error ? error.message : String(error);
}

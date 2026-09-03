import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type Interaction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
  type TextChannel,
  type UserSelectMenuInteraction
} from "discord.js";
import type { BotCommand, BotContext } from "../types";
import type { DafScaleActionResult, DafScaleEntry, DafScaleRole, DafScaleSession, DafScaleSettings, DafScaleState } from "./apiClient";
import { systemComponentEmoji, systemEmojiText, systemStatusEmoji } from "./systemEmojiService";

const PREFIX = "daf_scale";
const MODULE_ID = "police-daf-roster";
const COOLDOWN_MS = 3000;
const cooldowns = new Map<string, number>();

export const dafCommand = createCommand("daf");
export const escalaDafCommand = createCommand("escala-daf");

export async function handleDafScaleInteraction(interaction: Interaction, context: BotContext) {
  if (!("customId" in interaction) || !String(interaction.customId).startsWith(`${PREFIX}:`)) return false;
  if (!interaction.guild || !interaction.isRepliable()) return true;

  try {
    const [, action] = String(interaction.customId).split(":");
    if (interaction.isButton()) {
      if (action === "config") await showConfig(interaction, context);
      else if (action === "toggle") await toggleEnabled(interaction, context);
      else if (action === "publish") await publishPanel(interaction, context);
      else if (action === "join") await joinScale(interaction, context);
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
    if (interaction.isUserSelectMenu() && action === "assign_user") {
      await assignScale(interaction, context, interaction.values[0] ?? null);
      return true;
    }
  } catch (error) {
    console.warn("[daf-scale] falha ao processar interação:", errorMessage(error));
    await replyError(interaction, error);
    return true;
  }

  return true;
}

function createCommand(name: "daf" | "escala-daf"): BotCommand {
  return {
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription("Sistema de Escala Aerea.")
      .addSubcommand((subcommand) => subcommand.setName("config").setDescription("Configura a Escala Aerea."))
      .addSubcommand((subcommand) => subcommand.setName("painel").setDescription("Publica ou atualiza o painel da Escala Aerea."))
      .addSubcommand((subcommand) => subcommand.setName("escalar").setDescription("Escala um policial manualmente.")),
    moduleId: MODULE_ID,
    async execute(interaction, context) {
      await execute(interaction, context);
    }
  };
}

async function execute(interaction: ChatInputCommandInteraction, context: BotContext) {
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

  if (subcommand === "escalar") {
    if (!await canConfigure(interaction, context)) return;
    await showManualScaleUserMenu(interaction);
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
  const keyByAction: Record<string, keyof Pick<DafScaleSettings, "configRoleId" | "participantRoleId" | "pilotRoleId" | "copilotRoleId" | "gunnerRoleId" | "shooterRoleId">> = {
    config_role: "configRoleId",
    copilot_role: "copilotRoleId",
    gunner_role: "gunnerRoleId",
    participant_role: "participantRoleId",
    pilot_role: "pilotRoleId",
    shooter_role: "shooterRoleId"
  };
  const key = keyByAction[action];
  if (!key) return void await interaction.reply({ content: "Configuração inválida.", ephemeral: true });
  await context.api.saveDafScaleSettings(interaction.guildId!, { [key]: roleId }, interaction.user.id);
  await interaction.update(configPayload(await context.api.getDafScaleState(interaction.guildId!), interaction.guild!));
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
  await editConfigInteraction(interaction, "Painel da Escala Aerea publicado/atualizado.");
}

async function showManualScaleUserMenu(interaction: ChatInputCommandInteraction) {
  const select = new UserSelectMenuBuilder()
    .setCustomId(`${PREFIX}:assign_user`)
    .setPlaceholder("Selecione o policial")
    .setMinValues(1)
    .setMaxValues(1);

  await interaction.reply({
    components: [{
      type: 17,
      accent_color: 0x0ea5e9,
      components: [
        { type: 10, content: `## ${systemEmojiText("homem", interaction.guild)} Escalar policial\nSelecione o policial que sera adicionado na Escala Aerea.` },
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(select)
      ]
    }],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  });
}

async function joinScale(interaction: ButtonInteraction | StringSelectMenuInteraction, context: BotContext) {
  if (!await checkCooldown(interaction)) return;
  await interaction.deferReply({ ephemeral: true });
  const member = await interaction.guild!.members.fetch(interaction.user.id);
  const result = await context.api.joinDafScale(interaction.guildId!, {
    roleIds: member.roles.cache.map((item) => item.id),
    userId: interaction.user.id,
    username: displayName(member)
  });
  await updatePanelFromState(interaction.guild!, result.state);
  await sendLog(interaction.guild!, result, interaction.user.id, displayName(member));
  await interaction.editReply(result.action === "none" ? "Voce ja esta na Escala Aerea." : "Voce entrou na Escala Aerea.");
}

async function assignScale(interaction: UserSelectMenuInteraction, context: BotContext, targetId: string | null) {
  if (!await canConfigure(interaction, context)) return;
  if (!targetId) {
    await interaction.reply({ content: "Policial invalido para escala.", ephemeral: true });
    return;
  }

  await interaction.deferUpdate();
  const target = await interaction.guild!.members.fetch(targetId).catch(() => null);
  if (!target) {
    await interaction.editReply(manualScaleResultPayload(interaction.guild!, `${systemStatusEmoji("danger", interaction.guild)} Nao consegui encontrar esse policial no servidor.`, 0xef4444));
    return;
  }

  const actor = await interaction.guild!.members.fetch(interaction.user.id).catch(() => null);
  const result = await context.api.joinDafScale(interaction.guildId!, {
    actorId: interaction.user.id,
    actorName: actor ? displayName(actor) : interaction.user.username,
    roleIds: target.roles.cache.map((item) => item.id),
    userId: target.id,
    username: displayName(target)
  });
  await updatePanelFromState(interaction.guild!, result.state);
  await sendLog(interaction.guild!, result, target.id, displayName(target), {
    actorId: interaction.user.id,
    actorName: actor ? displayName(actor) : interaction.user.username,
    manual: true
  });
  await interaction.editReply(manualScaleResultPayload(interaction.guild!, `${systemStatusEmoji("success", interaction.guild)} <@${target.id}> foi escalado na Escala Aerea.`, 0x22c55e));
}

async function leaveScale(interaction: ButtonInteraction, context: BotContext) {
  if (!await checkCooldown(interaction)) return;
  await interaction.deferReply({ ephemeral: true });
  const member = await interaction.guild!.members.fetch(interaction.user.id);
  const result = await context.api.leaveDafScale(interaction.guildId!, { userId: interaction.user.id, username: displayName(member) });
  await updatePanelFromState(interaction.guild!, result.state);
  await sendLog(interaction.guild!, result, interaction.user.id, displayName(member));
  await interaction.editReply(result.action === "none" ? "Voce nao estava na Escala Aerea." : "Voce saiu da Escala Aerea.");
}

async function refreshPanel(interaction: ButtonInteraction, context: BotContext) {
  if (!await checkCooldown(interaction)) return;
  await interaction.deferReply({ ephemeral: true });
  const state = await context.api.getDafScaleState(interaction.guildId!);
  await updatePanelFromState(interaction.guild!, state);
  await context.api.recordDafScaleAudit(interaction.guildId!, { action: "refresh", userId: interaction.user.id, username: interaction.user.username });
  await interaction.editReply("Painel atualizado.");
}

async function updatePanelFromState(guild: Guild, state: DafScaleState) {
  const channel = await resolvePanelChannel(guild, state.settings.panelChannelId);
  if (!channel || !state.settings.panelMessageId) return;
  const message = await channel.messages.fetch(state.settings.panelMessageId).catch(() => null);
  if (message) await message.edit(scalePanelPayload(state, guild));
}

async function sendLog(guild: Guild, result: DafScaleActionResult, userId: string, username: string, options?: { actorId?: string; actorName?: string; manual?: boolean }) {
  if (result.action === "none" || !result.state.settings.logChannelId) return;
  const channel = await guild.channels.fetch(result.state.settings.logChannelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return;
  const entry = result.entry ?? null;
  const session = entry ? result.state.sessions.find((item) => item.id === entry.sessionId) ?? null : null;
  const changeText = result.action === "switch"
    ? `**Alteracao:**\n${seatLabel(result.previousRole)}\n➡\n${seatLabel(result.entry?.role ?? null)}`
    : `**Acao:**\n${options?.manual && result.action === "join" ? "Escalado manualmente" : result.action === "join" ? "Entrou na escala" : "Saiu da escala"}\n\n**Funcao:**\n${seatLabel(entry?.role ?? result.previousRole)}`;

  await channel.send({
    components: [{
      type: 17,
      accent_color: 0x0ea5e9,
      components: [{
        type: 10,
        content: [
          `# ${seatEmoji("pilot", guild)} Escala Aerea`,
          `**Usuario:**\n<@${userId}> (${username})`,
          options?.actorId ? `**Responsavel:**\n<@${options.actorId}> (${options.actorName ?? options.actorId})` : null,
          session ? `**Aeronave:**\n#${session.aircraftNumber}${session.title ? ` - ${session.title}` : ""}` : null,
          changeText,
          `**Horario:**\n${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}`,
          "",
          "━━━━━━━━━━━━━━━━━━━━━━",
          "## ESCALA ATUAL",
          ...result.state.sessions.map((item) => [
            `**Aeronave #${item.aircraftNumber}${item.title ? ` - ${item.title}` : ""}**`,
            item.occupants.length ? listEntries(item.occupants) : "Nenhum ocupante.",
            ""
          ]).flat(),
          "━━━━━━━━━━━━━━━━━━━━━━"
        ].filter(Boolean).join("\n")
      }]
    }],
    flags: MessageFlags.IsComponentsV2
  });
}

function configPayload(state: DafScaleState, guild: Guild) {
  const s = state.settings;
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:toggle`).setLabel(s.enabled ? "Desativar" : "Ativar").setEmoji(s.enabled ? systemComponentEmoji("perigo", guild) : systemComponentEmoji("visto", guild)).setStyle(s.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}:publish`).setLabel("Publicar painel").setEmoji(systemComponentEmoji("acessar", guild)).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}:config`).setLabel("Atualizar").setEmoji(systemComponentEmoji("relogio", guild)).setStyle(ButtonStyle.Secondary)
  );
  return {
    components: [{
      type: 17,
      accent_color: s.enabled ? 0x22c55e : 0xf59e0b,
      components: [
        { type: 10, content: [
          `# ${seatEmoji("pilot", guild)} Configuracao da Escala Aerea`,
          `Status: ${s.enabled ? `${systemStatusEmoji("success", guild)} Ativa` : `${systemStatusEmoji("warning", guild)} Desativada`}`,
          `Painel: ${s.panelChannelId ? `<#${s.panelChannelId}>` : "nao configurado"}`,
          `Logs: ${s.logChannelId ? `<#${s.logChannelId}>` : "nao configurado"}`,
          `Participacao: ${s.participantRoleId ? `<@&${s.participantRoleId}>` : "qualquer membro"}`,
          `Escala ativa: ${state.summary.activeAircraft} aeronaves / ${state.summary.totalOccupants} ocupantes`
        ].join("\n") },
        channelSelect(`${PREFIX}:panel_channel`, "Canal onde ficara o painel", s.panelChannelId),
        channelSelect(`${PREFIX}:log_channel`, "Canal de logs", s.logChannelId),
        roleSelect(`${PREFIX}:participant_role`, "Cargo permitido para participar", s.participantRoleId),
        roleSelect(`${PREFIX}:config_role`, "Cargo permitido para configurar", s.configRoleId),
        roleSelect(`${PREFIX}:pilot_role`, "Cargo de Piloto opcional", s.pilotRoleId),
        roleSelect(`${PREFIX}:copilot_role`, "Cargo de Copiloto opcional", s.copilotRoleId),
        roleSelect(`${PREFIX}:gunner_role`, "Cargo de Atirador opcional", s.gunnerRoleId ?? s.shooterRoleId),
        buttons
      ]
    }],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  } as const;
}

function scalePanelPayload(state: DafScaleState, guild: Guild) {
  const s = state.settings;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:join`).setLabel("Entrar na Escala").setEmoji(systemComponentEmoji("visto", guild)).setStyle(ButtonStyle.Success).setDisabled(!s.enabled),
    new ButtonBuilder().setCustomId(`${PREFIX}:leave`).setLabel("Sair da Escala").setEmoji(systemComponentEmoji("porta", guild)).setStyle(ButtonStyle.Secondary).setDisabled(!s.enabled),
    new ButtonBuilder().setCustomId(`${PREFIX}:refresh`).setLabel("Atualizar").setEmoji(systemComponentEmoji("relogio", guild)).setStyle(ButtonStyle.Secondary).setDisabled(!s.enabled)
  );
  return {
    components: [{
      type: 17,
      accent_color: s.enabled ? 0x0ea5e9 : 0x71717a,
      components: [
        { type: 10, content: [
          `# ${seatEmoji("pilot", guild)} Escala Aerea`,
          `${systemStatusEmoji(s.enabled ? "success" : "warning", guild)} **Status:** ${s.enabled ? "Ativa" : "Desativada"}  •  **Atualizada:** <t:${Math.floor(Date.now() / 1000)}:R>`,
          "",
          `Aeronaves em operacao: **${state.summary.activeAircraft}**`,
          `Ocupantes ativos: **${state.summary.totalOccupants}**`,
          `Vagas livres: **${state.summary.availableSeats}**`
        ].join("\n") },
        ...state.sessions.flatMap((session) => [
          separator(),
          { type: 10, content: [
            `## Aeronave #${session.aircraftNumber}${session.title ? ` - ${session.title}` : ""}`,
            `**Status:** ${session.status === "open" ? `${systemStatusEmoji("success", guild)} Aberta` : `${systemStatusEmoji("warning", guild)} Fechada`}`,
            `**Vagas:** ${session.occupants.length}/3`,
            "",
            session.occupants.length ? listEntries(session.occupants) : "Nenhum ocupante."
          ].join("\n") }
        ]),
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

async function canConfigure(interaction: ChatInputCommandInteraction | ButtonInteraction | ChannelSelectMenuInteraction | RoleSelectMenuInteraction | StringSelectMenuInteraction | UserSelectMenuInteraction, context: BotContext) {
  if (!interaction.guild) return false;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return false;
  const state = await context.api.getDafScaleState(interaction.guild.id).catch(() => null);
  const allowed = member.permissions.has(PermissionFlagsBits.ManageGuild) || Boolean(state?.settings.configRoleId && member.roles.cache.has(state.settings.configRoleId));
  if (!allowed) {
    const payload = { content: "Voce precisa de Gerenciar Servidor ou do cargo configurado para gerenciar a Escala Aerea.", ephemeral: true };
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
  await interaction.deferReply({ ephemeral: true });
}

async function editConfigInteraction(interaction: ChatInputCommandInteraction | ButtonInteraction, content: string) {
  await interaction.editReply({ content });
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

function listEntries(entries: Array<{ role: DafScaleRole; username: string; userId: string }>) {
  return entries
    .map((entry) => `${seatEmoji(entry.role, null)} ${seatLabel(entry.role)}: ${entry.username} (<@${entry.userId}>)`)
    .join("\n");
}

function seatLabel(role: DafScaleRole | null | undefined) {
  if (role === "pilot") return "Piloto";
  if (role === "copilot") return "Copiloto";
  if (role === "gunner") return "Atirador";
  return "Nenhuma";
}

function seatEmoji(role: DafScaleRole, guild: Guild | null) {
  if (role === "pilot") return findGuildEmojiText(guild, ["helicoptero", "helicóptero", "helicopter", "heli", "daf_helicoptero"], "🚁");
  if (role === "copilot") return systemComponentEmoji("acessar", guild);
  return systemEmojiText("arma", guild);
}

function findGuildEmojiText(guild: Guild | null, names: string[], fallback: string) {
  if (!guild) return fallback;
  const expected = new Set(names.map(normalizeEmojiName));
  const emoji = guild.emojis.cache.find((item) => item.name ? expected.has(normalizeEmojiName(item.name)) : false);
  return emoji ? `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>` : fallback;
}

function normalizeEmojiName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function replyError(interaction: Interaction, error: unknown) {
  if (!interaction.isRepliable()) return;
  const content = errorMessage(error) || "Nao foi possivel concluir esta interacao da Escala Aerea.";
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
  if (typeof response?.data?.message === "string") return response.data.message;
  return error instanceof Error ? error.message : String(error);
}

function manualScaleResultPayload(_guild: Guild, content: string, accentColor: number) {
  return {
    components: [{
      type: 17,
      accent_color: accentColor,
      components: [{ type: 10, content }]
    }],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  } as const;
}

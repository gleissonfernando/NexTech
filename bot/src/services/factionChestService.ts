import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type Interaction,
  type ModalSubmitInteraction,
  type TextChannel
} from "discord.js";
import { isBotModuleEnabled, setRuntimeEnabledModules } from "../config/env";
import type { BotCommand, BotContext } from "../types";
import type { FactionChestLog, FactionChestSettings } from "./apiClient";
import { replaceSystemEmojis, systemComponentEmoji, systemEmojiText } from "./systemEmojiService";

const MODULE_ID = "faction-chest";
const PREFIX = "faction_chest";
const handledRequests = new Map<string, string>();
let polling = false;

export const bauCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("bau")
    .setDescription("Sistema de Baú da facção.")
    .addSubcommand((subcommand) => subcommand
      .setName("config")
      .setDescription("Configura canais do painel de baú."))
    .addSubcommand((subcommand) => subcommand
      .setName("publicar")
      .setDescription("Publica ou atualiza o painel de entrada e saída do baú.")),
  moduleId: MODULE_ID,
  async execute(interaction: ChatInputCommandInteraction, context: BotContext) {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
      return;
    }

    await refreshFactionChestRuntimeModules(context).catch(() => null);
    if (!isBotModuleEnabled(MODULE_ID)) {
      await interaction.reply({ content: "Este módulo não está liberado para este bot.", flags: MessageFlags.Ephemeral });
      return;
    }

    const dashboard = await context.api.getFactionChestDashboard(interaction.guildId);
    if (!canManageChest(interaction.member, interaction, dashboard.settings)) {
      await interaction.reply({ content: "Você precisa de Gerenciar Servidor ou cargo administrador do baú.", flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.options.getSubcommand() === "config") {
      await interaction.reply(chestConfigPanel(dashboard.settings, true));
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!dashboard.settings.panelChannelId) {
      await context.api.saveFactionChestSettings(interaction.guildId, { panelChannelId: interaction.channelId }, interaction.user.id);
    }
    const settings = await context.api.requestFactionChestPanelPublish(interaction.guildId, interaction.user.id);
    await publishRequestedPanel(interaction.client, context, settings);
    await interaction.editReply(`Painel do baú publicado/atualizado em <#${settings.panelChannelId ?? interaction.channelId}>.`);
  }
};

export function startFactionChestService(client: Client, context: BotContext) {
  if (!isBotModuleEnabled(MODULE_ID)) return;
  void processPanelRequests(client, context);
  const interval = setInterval(() => void processPanelRequests(client, context), 15_000);
  interval.unref();
}

export async function handleFactionChestInteraction(interaction: Interaction, context: BotContext) {
  if (!(interaction.isButton() || interaction.isChannelSelectMenu() || interaction.isModalSubmit()) || !interaction.customId.startsWith(`${PREFIX}:`)) {
    return false;
  }

  if (!isBotModuleEnabled(MODULE_ID)) {
    await interaction.reply({ content: "Este módulo não está liberado para este bot.", ephemeral: true });
    return true;
  }

  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({ content: "Use este sistema dentro de um servidor.", ephemeral: true });
    return true;
  }

  const [, action] = interaction.customId.split(":");
  if (interaction.isButton() && action === "add") await openMovementModal(interaction, "add");
  else if (interaction.isButton() && action === "remove") await openMovementModal(interaction, "remove");
  else if (interaction.isButton() && action === "config") await showConfig(interaction, context);
  else if (interaction.isButton() && action === "publish") await requestPublish(interaction, context);
  else if (interaction.isChannelSelectMenu() && action?.startsWith("channel_")) await saveChannel(interaction, context, action);
  else if (interaction.isModalSubmit() && action === "movement") await submitMovement(interaction, context);
  else return false;

  return true;
}

async function processPanelRequests(client: Client, context: BotContext) {
  if (polling) return;
  polling = true;
  try {
    const configs = await context.api.getActiveFactionChestConfigs();
    for (const config of configs) {
      if (!config.lastPanelRequestedAt) continue;
      const key = `${config.botId}:${config.guildId}`;
      if (handledRequests.get(key) === config.lastPanelRequestedAt) continue;
      await publishRequestedPanel(client, context, config).catch((error) => {
        console.warn("[faction-chest] falha ao publicar painel pendente:", errorMessage(error));
      });
    }
  } catch (error) {
    console.warn("[faction-chest] falha ao processar painéis:", errorMessage(error));
  } finally {
    polling = false;
  }
}

async function publishRequestedPanel(client: Client, context: BotContext, settings: FactionChestSettings) {
  const guild = await client.guilds.fetch(settings.guildId).catch(() => null);
  if (!guild) throw new Error("Servidor não encontrado.");

  const channel = await resolveTextChannel(guild, settings.panelChannelId);
  if (!channel) throw new Error("Canal do painel não configurado ou inacessível.");

  const payload = chestPanelPayload(settings, guild);
  let message = settings.panelMessageId ? await channel.messages.fetch(settings.panelMessageId).catch(() => null) : null;
  if (message) {
    await message.edit(payload);
  } else {
    message = await channel.send(payload);
  }

  await context.api.updateFactionChestPanelState({ guildId: settings.guildId, panelMessageId: message.id });
  if (settings.lastPanelRequestedAt) handledRequests.set(`${settings.botId}:${settings.guildId}`, settings.lastPanelRequestedAt);
}

async function showConfig(interaction: ButtonInteraction, context: BotContext) {
  const dashboard = await context.api.getFactionChestDashboard(interaction.guildId!);
  if (!canManageChest(interaction.member, interaction, dashboard.settings)) {
    await interaction.reply({ content: "Você precisa de Gerenciar Servidor ou cargo administrador do baú.", ephemeral: true });
    return;
  }
  await interaction.update(chestConfigPanel(dashboard.settings, false));
}

async function requestPublish(interaction: ButtonInteraction, context: BotContext) {
  const dashboard = await context.api.getFactionChestDashboard(interaction.guildId!);
  if (!canManageChest(interaction.member, interaction, dashboard.settings)) {
    await interaction.reply({ content: "Você precisa de Gerenciar Servidor ou cargo administrador do baú.", ephemeral: true });
    return;
  }
  await interaction.deferUpdate();
  const settings = await context.api.requestFactionChestPanelPublish(interaction.guildId!, interaction.user.id);
  await publishRequestedPanel(interaction.client, context, settings);
  await interaction.editReply(chestConfigPanel(settings, false));
}

async function saveChannel(interaction: ChannelSelectMenuInteraction, context: BotContext, action: string) {
  const dashboard = await context.api.getFactionChestDashboard(interaction.guildId!);
  if (!canManageChest(interaction.member, interaction, dashboard.settings)) {
    await interaction.reply({ content: "Você precisa de Gerenciar Servidor ou cargo administrador do baú.", ephemeral: true });
    return;
  }

  await interaction.deferUpdate();
  const channelId = interaction.values[0] ?? null;
  const patch = action === "channel_panel"
    ? { panelChannelId: channelId }
    : action === "channel_audit"
      ? { auditChannelId: channelId }
      : { logChannelId: channelId };
  const settings = await context.api.saveFactionChestSettings(interaction.guildId!, patch, interaction.user.id);
  await interaction.editReply(chestConfigPanel(settings, false));
}

async function openMovementModal(interaction: ButtonInteraction, action: "add" | "remove") {
  const title = action === "add" ? "Registrar Adição" : "Registrar Remoção";
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:movement:${action}`)
    .setTitle(title)
    .addComponents(
      inputRow("item", "Item", TextInputStyle.Short, true, 80, "Ex: Drogas / Pente / Colete"),
      inputRow("quantity", "Quantidade", TextInputStyle.Short, true, 12, "Ex: 5"),
      inputRow("reason", "Motivo", TextInputStyle.Paragraph, true, 500, "Ex: Uso / Entrega / Apreensão / Retirada")
    );
  await interaction.showModal(modal);
}

async function submitMovement(interaction: ModalSubmitInteraction, context: BotContext) {
  const action = interaction.customId.split(":")[2] as "add" | "remove" | undefined;
  if (action !== "add" && action !== "remove") {
    await interaction.reply({ content: "Ação inválida.", ephemeral: true });
    return;
  }

  const dashboard = await context.api.getFactionChestDashboard(interaction.guildId!);
  if (!canRegisterMovement(interaction.member, interaction, dashboard.settings)) {
    await interaction.reply({ content: "Você não possui cargo autorizado para movimentar o baú.", ephemeral: true });
    return;
  }

  const quantity = Number.parseInt(interaction.fields.getTextInputValue("quantity").trim(), 10);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    await interaction.reply({ content: "Informe uma quantidade maior que zero.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const movement = await context.api.recordFactionChestMovement(interaction.guildId!, {
    action,
    actorId: interaction.user.id,
    actorName: displayName(interaction.member) || interaction.user.username,
    channelId: interaction.channelId,
    item: interaction.fields.getTextInputValue("item"),
    quantity,
    reason: interaction.fields.getTextInputValue("reason")
  });

  const payload = movementLogPayload(dashboard.settings, movement.log, interaction.guild!);
  const sourceChannel = interaction.channel;
  if (sourceChannel && "send" in sourceChannel) {
    await (sourceChannel as TextChannel).send(payload).catch((error: unknown) => {
      console.warn("[faction-chest] falha ao enviar registro público:", errorMessage(error));
    });
  }

  const logChannelId = action === "remove" ? dashboard.settings.auditChannelId ?? dashboard.settings.logChannelId : dashboard.settings.logChannelId;
  if (logChannelId && logChannelId !== interaction.channelId) {
    const channel = await resolveTextChannel(interaction.guild!, logChannelId);
    await channel?.send(payload).catch((error) => {
      console.warn("[faction-chest] falha ao enviar log do registro:", errorMessage(error));
    });
  }

  await interaction.editReply(action === "add" ? "Adição registrada no baú." : "Remoção registrada no baú.");
}

function chestPanelPayload(settings: FactionChestSettings, guild: Guild) {
  const embed = new EmbedBuilder()
    .setColor(parseColor(settings.color))
    .setTitle(`${systemEmojiText("caixa", guild)} ${settings.systemName}`)
    .setDescription(replaceSystemEmojis([
      "🧾 **Sistema de registro manual do baú**",
      "",
      "• Informe exatamente o item e a quantidade Adicionada/Retirada do baú",
      "",
      "⚠️ *Qualquer ação é controlada pelo gerente de baú*",
      "",
      "➕ **Adicionar**",
      "Para adicionar um item no baú, clique em **Adicionar**.",
      "",
      "➖ **Remover**",
      "Para remover um item no baú, clique em **Remover**."
    ].join("\n"), guild))
    .setFooter({ text: "BalaCloud — Todos os direitos reservados" });

  const thumbnail = settings.panelImageUrl || guild.iconURL({ size: 128 });
  if (thumbnail) embed.setThumbnail(thumbnail);

  const rows = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:add`).setLabel("Adicionar").setEmoji(systemComponentEmoji("mais", guild)).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}:remove`).setLabel("Remover").setEmoji(systemComponentEmoji("porta", guild)).setStyle(ButtonStyle.Danger)
    )
  ];

  return { allowedMentions: { parse: [] }, components: rows, embeds: [embed] };
}

function movementLogPayload(settings: FactionChestSettings, log: FactionChestLog, guild: Guild) {
  const adding = log.action === "add";
  const embed = new EmbedBuilder()
    .setColor(adding ? 0x22c55e : 0xef4444)
    .setTitle(`${systemEmojiText("caixa", guild)} ${settings.systemName} — ${adding ? "ADIÇÃO" : "REMOÇÃO"}`)
    .setDescription(replaceSystemEmojis([
      `${adding ? "➕" : "➖"} **Ação:** ${adding ? "ADIÇÃO" : "REMOÇÃO"}`,
      `📝 **Item:** ${log.itemName}`,
      `🧾 **Quantidade:** ${log.quantity}`,
      `📋 **Motivo:** ${log.reason || "-"}`,
      `👤 **Registrado por:** ${log.actorName} | ${log.actorId}`
    ].join("\n"), guild))
    .setFooter({ text: "BalaCloud — Todos os direitos reservados" })
    .setTimestamp(new Date(log.createdAt));

  const thumbnail = settings.panelImageUrl || guild.iconURL({ size: 128 });
  if (thumbnail) embed.setThumbnail(thumbnail);
  return { allowedMentions: { parse: [] }, embeds: [embed] };
}

function chestConfigPanel(settings: FactionChestSettings, ephemeral: boolean): any {
  const embed = new EmbedBuilder()
    .setColor(parseColor(settings.color))
    .setTitle(`${systemEmojiText("caixa")} Sistema de Baú`)
    .setDescription([
      `**Status:** ${settings.enabled ? "Ativo" : "Inativo"}`,
      `**Painel:** ${settings.panelChannelId ? `<#${settings.panelChannelId}>` : "não configurado"}`,
      `**Logs:** ${settings.logChannelId ? `<#${settings.logChannelId}>` : "não configurado"}`,
      `**Auditoria:** ${settings.auditChannelId ? `<#${settings.auditChannelId}>` : "não configurado"}`,
      `**Mensagem:** ${settings.panelMessageId ? `\`${settings.panelMessageId}\`` : "não publicada"}`
    ].join("\n"));

  const rows = [
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId(`${PREFIX}:channel_panel`).setPlaceholder("Canal onde será criado o painel").setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1)),
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId(`${PREFIX}:channel_log`).setPlaceholder("Canal de logs").setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1)),
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId(`${PREFIX}:channel_audit`).setPlaceholder("Canal de auditoria").setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1)),
    new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:publish`).setLabel(settings.panelMessageId ? "Atualizar painel" : "Publicar painel").setEmoji(systemComponentEmoji("prancheta")).setStyle(ButtonStyle.Success).setDisabled(!settings.panelChannelId))
  ];

  return { components: rows, embeds: [embed], flags: ephemeral ? MessageFlags.Ephemeral : undefined };
}

function inputRow(customId: string, label: string, style: TextInputStyle, required: boolean, maxLength: number, placeholder: string) {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setMaxLength(maxLength)
      .setPlaceholder(placeholder)
      .setRequired(required)
      .setStyle(style)
  );
}

async function resolveTextChannel(guild: Guild, channelId: string | null | undefined): Promise<TextChannel | null> {
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased() && !channel.isDMBased() ? channel as TextChannel : null;
}

function canRegisterMovement(member: unknown, interaction: { memberPermissions?: { has(permission: bigint): boolean } | null }, settings: FactionChestSettings) {
  if (canManageChest(member, interaction, settings)) return true;
  return hasAnyRole(member, settings.registerRoleIds);
}

function canManageChest(member: unknown, interaction: { memberPermissions?: { has(permission: bigint): boolean } | null }, settings: FactionChestSettings) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  return hasAnyRole(member, settings.adminRoleIds);
}

function hasAnyRole(member: unknown, roleIds: string[]) {
  if (!roleIds.length) return false;
  const roles = (member as GuildMember | null)?.roles;
  return roleIds.some((roleId) => roles?.cache?.has(roleId));
}

async function refreshFactionChestRuntimeModules(context: BotContext) {
  const runtime = await context.api.getRuntimeModules();
  setRuntimeEnabledModules(runtime.active ? runtime.enabledModules : [], runtime.botId);
}

function displayName(member: unknown) {
  return (member as GuildMember | null)?.displayName ?? null;
}

function parseColor(value: string) {
  return Number.parseInt(value.replace("#", ""), 16) || 0x22c55e;
}

function errorMessage(error: unknown) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: unknown } } }).response;
    if (typeof response?.data?.message === "string") return response.data.message;
  }
  return error instanceof Error ? error.message : String(error);
}

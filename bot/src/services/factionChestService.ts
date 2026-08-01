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
const pendingMovements = new Map<string, { action: "add" | "remove"; actorId: string; actorName: string; channelId: string | null; expiresAt: number; guildId: string; items: string; reason: string | null }>();
let polling = false;

export const bauCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("bau")
    .setDescription("Sistema de Baú da facção.")
    .addSubcommand((subcommand) => subcommand
      .setName("config")
      .setDescription("Configura canais do painel de baú."))
    .addSubcommand((subcommand) => subcommand
      .setName("gerenciamento")
      .setDescription("Abre o gerenciamento do Sistema de Baú."))
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

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "config" || subcommand === "gerenciamento") {
      await interaction.reply(chestManagementPanel(dashboard.settings, dashboard.summary.itemCount, true, interaction.guild));
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
  else if (interaction.isButton() && action === "confirm") await confirmMovement(interaction, context);
  else if (interaction.isButton() && action === "cancel") await cancelMovement(interaction);
  else if (interaction.isButton() && action === "close") await interaction.update({ components: [], content: "Gerenciamento fechado." });
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
      inputRow("items", "Itens e quantidades", TextInputStyle.Paragraph, true, 1000, "Ex: Lockpick x5\nG3 x2\nMunição de G3 x500"),
      inputRow("reason", "Motivo", TextInputStyle.Paragraph, false, 500, "Ex: Uso / Entrega / Apreensão / Retirada")
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

  const items = interaction.fields.getTextInputValue("items").trim();
  const parsed = parseMovementPreview(items);
  if ("error" in parsed) {
    await interaction.reply({ content: parsed.error, ephemeral: true });
    return;
  }

  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const reason = interaction.fields.getTextInputValue("reason").trim() || null;
  pendingMovements.set(token, {
    action,
    actorId: interaction.user.id,
    actorName: displayName(interaction.member) || interaction.user.username,
    channelId: interaction.channelId,
    expiresAt: Date.now() + 60_000,
    guildId: interaction.guildId!,
    items,
    reason
  });

  await interaction.reply(confirmationPayload(token, action, parsed.items, reason, interaction.guild));
}

async function confirmMovement(interaction: ButtonInteraction, context: BotContext) {
  const token = interaction.customId.split(":")[2] ?? "";
  const pending = pendingMovements.get(token);
  if (!pending || pending.expiresAt < Date.now()) {
    pendingMovements.delete(token);
    await interaction.reply({ content: "Esta confirmação expirou. Envie a movimentação novamente.", ephemeral: true });
    return;
  }
  if (pending.actorId !== interaction.user.id || pending.guildId !== interaction.guildId) {
    await interaction.reply({ content: "Esta confirmação pertence a outro usuário.", ephemeral: true });
    return;
  }

  await interaction.deferUpdate();
  pendingMovements.delete(token);

  const dashboard = await context.api.getFactionChestDashboard(interaction.guildId!);
  if (!canRegisterMovement(interaction.member, interaction, dashboard.settings)) {
    await interaction.editReply({ content: "Você não possui cargo autorizado para movimentar o baú.", components: [] });
    return;
  }

  const movement = await context.api.recordFactionChestMovement(interaction.guildId!, {
    action: pending.action,
    actorId: pending.actorId,
    actorName: pending.actorName,
    channelId: pending.channelId,
    items: pending.items,
    reason: pending.reason
  });

  const payload = movementLogPayload(dashboard.settings, movement.logs, movement.operationCode, interaction.guild!);
  const sourceChannel = interaction.channel;
  if (sourceChannel && "send" in sourceChannel) {
    await (sourceChannel as TextChannel).send(payload).catch((error: unknown) => {
      console.warn("[faction-chest] falha ao enviar registro público:", errorMessage(error));
    });
  }

  const logChannelId = pending.action === "remove" ? dashboard.settings.auditChannelId ?? dashboard.settings.logChannelId : dashboard.settings.logChannelId;
  if (logChannelId && logChannelId !== interaction.channelId) {
    const channel = await resolveTextChannel(interaction.guild!, logChannelId);
    await channel?.send(payload).catch((error) => {
      console.warn("[faction-chest] falha ao enviar log do registro:", errorMessage(error));
    });
  }

  await interaction.editReply({ content: pending.action === "add" ? "Movimentação registrada com sucesso." : "Movimentação registrada com sucesso.", components: [] });
}

async function cancelMovement(interaction: ButtonInteraction) {
  const token = interaction.customId.split(":")[2] ?? "";
  const pending = pendingMovements.get(token);
  if (pending?.actorId !== interaction.user.id) {
    await interaction.reply({ content: "Esta confirmação pertence a outro usuário.", ephemeral: true });
    return;
  }
  pendingMovements.delete(token);
  await interaction.update({ content: "Operação cancelada. Nenhum item foi alterado.", components: [] });
}

function chestPanelPayload(settings: FactionChestSettings, guild: Guild) {
  const imageUrl = settings.panelImageUrl || guild.iconURL({ size: 128 });
  const intro = [
      `# ${systemEmojiText("caixa", guild)} ${settings.systemName}`,
      "",
      `${systemEmojiText("prancheta", guild)} Sistema de registro manual do baú`,
      "",
      `${systemEmojiText("interrogacao", guild)} Informe exatamente os itens e as quantidades adicionadas ou retiradas do baú.`,
      "Toda ação será registrada e poderá ser consultada pela gerência.",
      "",
      `${systemEmojiText("mais", guild)} **Adicionar**`,
      "Para adicionar um ou vários itens ao baú, clique em **Adicionar**.",
      "",
      `${systemEmojiText("porta", guild)} **Remover**`,
      "Para retirar um ou vários itens do baú, clique em **Remover**."
    ].join("\n");

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:add`).setLabel("Adicionar").setEmoji(systemComponentEmoji("mais", guild)).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}:remove`).setLabel("Remover").setEmoji(systemComponentEmoji("porta", guild)).setStyle(ButtonStyle.Danger)
  );

  return {
    allowedMentions: { parse: [] as never[] },
    components: [{
      type: 17,
      accent_color: parseColor(settings.color),
      components: [
        imageUrl ? { type: 9, components: [{ type: 10, content: replaceSystemEmojis(intro, guild) }], accessory: { type: 11, media: { url: imageUrl } } } : { type: 10, content: replaceSystemEmojis(intro, guild) },
        { type: 14, divider: true, spacing: 1 },
        row,
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: "-# BalaCloud - Todos os direitos reservados" }
      ]
    }],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function movementLogPayload(settings: FactionChestSettings, logs: FactionChestLog[], operationCode: string, guild: Guild) {
  const first = logs[0];
  const adding = first?.action === "add";
  const imageUrl = settings.panelImageUrl || guild.iconURL({ size: 128 });
  const total = logs.reduce((sum, log) => sum + log.quantity, 0);
  const items = logs.map((log) => `- ${log.itemName} x${log.quantity}`).join("\n");
  const balances = logs.map((log) => `- ${log.itemName}: ${log.previousQuantity ?? 0} → ${log.nextQuantity ?? 0}`).join("\n");
  const content = [
    `# ${systemEmojiText("caixa", guild)} ${settings.systemName} — ${adding ? "ADIÇÃO" : "REMOÇÃO"}`,
    `${adding ? systemEmojiText("mais", guild) : systemEmojiText("porta", guild)} **Ação:** ${adding ? "ADIÇÃO" : "REMOÇÃO"}`,
    `${systemEmojiText("prancheta", guild)} **Itens:**`,
    items,
    `${systemEmojiText("caixa", guild)} **Quantidade total:** ${total}`,
    `${systemEmojiText("folha", guild)} **Motivo:** ${first?.reason || "Não informado"}`,
    `${systemEmojiText("homem", guild)} **Registrado por:** ${first?.actorName ?? "-"} | ${first?.actorId ?? "-"}`,
    `${systemEmojiText("relogio", guild)} **Horário:** ${first ? formatDateTime(first.createdAt) : "-"}`,
    `${systemEmojiText("prancheta", guild)} **Identificação:** ${operationCode}`,
    "",
    "**Saldos:**",
    balances
  ].join("\n");

  return {
    allowedMentions: { parse: [] as never[] },
    components: [{
      type: 17,
      accent_color: adding ? 0x22c55e : 0xef4444,
      components: [
        imageUrl ? { type: 9, components: [{ type: 10, content: replaceSystemEmojis(content, guild) }], accessory: { type: 11, media: { url: imageUrl } } } : { type: 10, content: replaceSystemEmojis(content, guild) },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: "-# BalaCloud - Todos os direitos reservados" }
      ]
    }],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function confirmationPayload(token: string, action: "add" | "remove", items: Array<{ name: string; quantity: number }>, reason: string | null, guild: Guild | null) {
  const total = items.reduce((sum, item) => sum + item.quantity, 0);
  const content = [
    `# ${systemEmojiText("prancheta", guild)} Confirme a movimentação`,
    "",
    `**Ação:** ${action === "add" ? "ADIÇÃO" : "REMOÇÃO"}`,
    "",
    items.map((item) => `- ${item.name} x${item.quantity}`).join("\n"),
    "",
    `**Quantidade total:** ${total}`,
    `**Motivo:** ${reason || "Não informado"}`
  ].join("\n");
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:confirm:${token}`).setLabel("Confirmar").setEmoji(systemComponentEmoji("visto", guild)).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}:cancel:${token}`).setLabel("Cancelar").setEmoji(systemComponentEmoji("porta", guild)).setStyle(ButtonStyle.Secondary)
  );
  return {
    allowedMentions: { parse: [] as never[] },
    components: [{ type: 17, accent_color: action === "add" ? 0x22c55e : 0xef4444, components: [{ type: 10, content: replaceSystemEmojis(content, guild) }, row] }],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  };
}

function chestManagementPanel(settings: FactionChestSettings, itemCount: number, ephemeral: boolean, guild: Guild | null): any {
  const content = [
    `# ${systemEmojiText("caixa", guild)} GERENCIAMENTO DO SISTEMA DE BAÚ`,
    "",
    "Utilize as opções abaixo para configurar e administrar os baús deste servidor.",
    "",
    `**Baú selecionado:** ${settings.systemName}`,
    `**Status:** ${settings.enabled ? "Ativo" : "Inativo"}`,
    `**Itens cadastrados:** ${itemCount}`,
    `**Painel publicado:** ${settings.panelMessageId ? "Sim" : "Não"}`,
    `**Canal do painel:** ${settings.panelChannelId ? `<#${settings.panelChannelId}>` : "não configurado"}`,
    `**Canal de logs:** ${settings.logChannelId ? `<#${settings.logChannelId}>` : "não configurado"}`,
    "**Planilha:** Não configurada"
  ].join("\n");
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:config`).setLabel("Configurar canais").setEmoji(systemComponentEmoji("engrenagem", guild)).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}:publish`).setLabel(settings.panelMessageId ? "Atualizar painel" : "Publicar painel").setEmoji(systemComponentEmoji("prancheta", guild)).setStyle(ButtonStyle.Success).setDisabled(!settings.panelChannelId),
    new ButtonBuilder().setCustomId(`${PREFIX}:close`).setLabel("Fechar").setEmoji(systemComponentEmoji("porta", guild)).setStyle(ButtonStyle.Secondary)
  );
  return {
    allowedMentions: { parse: [] as never[] },
    components: [{ type: 17, accent_color: parseColor(settings.color), components: [{ type: 10, content: replaceSystemEmojis(content, guild) }, { type: 14, divider: true, spacing: 1 }, buttons] }],
    flags: (ephemeral ? MessageFlags.Ephemeral : 0) | MessageFlags.IsComponentsV2
  };
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

function parseMovementPreview(value: string): { items: Array<{ name: string; quantity: number }> } | { error: string } {
  const text = value.trim();
  if (!text) return { error: "Informe os itens no formato Nome do item xQuantidade." };
  const lines = text.includes("\n") ? text.split(/\r?\n/) : splitInlineItems(text);
  const merged = new Map<string, { name: string; quantity: number }>();
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^(.+?)(?:\s*[xX]\s*|\s+)(\d+)$/);
    if (!match) return { error: `Formato não reconhecido: ${line}` };
    const name = (match[1] ?? "").trim();
    const quantity = Number.parseInt(match[2] ?? "", 10);
    if (!name) return { error: "Item sem nome." };
    if (!Number.isInteger(quantity) || quantity <= 0) return { error: `Quantidade inválida para ${name}.` };
    const key = normalizeItemName(name);
    const current = merged.get(key);
    merged.set(key, { name: current?.name ?? name, quantity: (current?.quantity ?? 0) + quantity });
  }
  return { items: [...merged.values()] };
}

function splitInlineItems(value: string) {
  const matches = [...value.matchAll(/(.+?)(?:\s*[xX]\s*|\s+)(\d+)(?=\s+\S.+?(?:\s*[xX]\s*|\s+)\d+|$)/g)];
  return matches.length ? matches.map((match) => `${match[1]?.trim()} x${match[2]}`) : [value];
}

function normalizeItemName(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ");
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value));
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

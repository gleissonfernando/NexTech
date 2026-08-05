import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type Interaction,
  type Message,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction
} from "discord.js";
import type { BotCommand, BotContext } from "../types";
import type { AmmunitionConfig, AmmunitionOrder, AmmunitionPermissionType, AmmunitionRuntime, AmmunitionType, AmmunitionWeeklySummary } from "./apiClient";
import { renderComponentsV2Panel } from "./panelVisualRenderer";
import { systemComponentEmoji, systemEmojiText } from "./systemEmojiService";

const PREFIX = "ammo";
const MODULE_ID = "fivem-ammunition";

export const municaoCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("municao")
    .setDescription("Publica ou exibe o painel operacional de venda de munição."),
  moduleId: MODULE_ID,
  async execute(interaction, context) {
    await publishAmmunitionPanel(interaction, context);
  }
};

export const municaoConfiguracaoCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("municao-configuracao")
    .setDescription("Abre o painel administrativo do Sistema de Venda de Munição."),
  moduleId: MODULE_ID,
  async execute(interaction, context) {
    await showAmmunitionConfigPanel(interaction, context);
  }
};

export function startAmmunitionService(client: import("discord.js").Client<true>, context: BotContext) {
  context.socket.onFivemAmmunitionPanelPublish((payload) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void publishConfiguredPanel(guild, context);
  });
}

export async function handleAmmunitionInteraction(interaction: Interaction, context: BotContext) {
  if (!("customId" in interaction) || !interaction.customId.startsWith(`${PREFIX}:`)) return false;
  if (!interaction.guild) return true;
  const [, action, arg] = interaction.customId.split(":");
  if (!action) return false;

  if (interaction.isButton() && action === "sale") {
    await handleSaleStart(interaction, context);
    return true;
  }
  if (interaction.isStringSelectMenu() && action === "buyer") {
    await handleBuyerSelected(interaction, context);
    return true;
  }
  if (interaction.isModalSubmit() && action === "quantity") {
    await handleQuantitySubmit(interaction, context, arg ?? "");
    return true;
  }
  if (interaction.isButton() && action === "summary") {
    await handleSummary(interaction, context);
    return true;
  }
  if (interaction.isButton() && action === "complete") {
    await handleComplete(interaction, context, arg ?? "");
    return true;
  }
  if (interaction.isButton() && action === "cancel") {
    await handleCancel(interaction, context, arg ?? "");
    return true;
  }
  if (interaction.isButton() && action === "reopen") {
    await handleReopen(interaction, context, arg ?? "");
    return true;
  }
  if (interaction.isButton() && action === "cfg") {
    await handleConfigButton(interaction, context, arg ?? "main");
    return true;
  }
  if (interaction.isModalSubmit() && action.startsWith("cfg_")) {
    await handleConfigModal(interaction, context, action);
    return true;
  }
  return false;
}

async function publishAmmunitionPanel(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const channelId = await publishConfiguredPanel(interaction.guild, context, interaction.channelId);
  await interaction.reply({
    content: channelId ? `Painel de munição publicado em <#${channelId}>.` : "Configure e ative o Sistema de Venda de Munição antes de publicar.",
    flags: MessageFlags.Ephemeral
  });
}

async function publishConfiguredPanel(guild: Guild, context: BotContext, fallbackChannelId?: string | null) {
  const runtime = await context.api.getAmmunitionRuntime(guild.id).catch(() => null);
  if (!runtime?.config.enabled) return null;
  const channelId = runtime.config.panelChannelId ?? fallbackChannelId;
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) return null;
  const payload = mainPanel(runtime, guild);
  const oldMessage = runtime.config.panelMessageId && "messages" in channel
    ? await channel.messages.fetch(runtime.config.panelMessageId).catch(() => null)
    : null;
  if (oldMessage) await oldMessage.edit(payload);
  else {
    const sent = await channel.send(payload);
    await context.api.updateAmmunitionPanelState(guild.id, sent.id).catch(() => null);
  }
  return channel.id;
}

async function showAmmunitionConfigPanel(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const runtime = await context.api.getAmmunitionRuntime(interaction.guild.id);
  if (!(await hasPermission(interaction.guild, interaction.user.id, runtime.config, "MANAGE_CONFIG"))) {
    await interaction.reply(v2("Acesso negado", "Seu cargo não possui permissão para configurar o Sistema de Munição.", interaction.guild));
    return;
  }
  await interaction.reply(configPanel(runtime, interaction.guild));
}

async function handleSaleStart(interaction: ButtonInteraction, context: BotContext) {
  const runtime = await context.api.getAmmunitionRuntime(interaction.guildId!);
  const missing = missingConfig(runtime);
  if (missing.length) {
    await interaction.reply(v2("Configuração pendente", missing.join("\n"), interaction.guild));
    return;
  }
  if (!(await hasPermission(interaction.guild!, interaction.user.id, runtime.config, "CREATE_ORDER"))) {
    await interaction.reply(v2("Acesso negado", "Seu cargo não pode abrir vendas de munição.", interaction.guild));
    return;
  }
  const buyers = runtime.factions.filter((faction) => faction.id !== runtime.config.sellerFactionId).slice(0, 25);
  if (!buyers.length) {
    await interaction.reply(v2("Sem FAC compradora", "Cadastre/ative caixas de outras FACs para aparecerem como compradoras.", interaction.guild));
    return;
  }
  await interaction.reply({
    ...v2("Venda de Munição", "Selecione a FAC compradora. Depois informe as munições no canal temporário da encomenda.", interaction.guild),
    components: [
      ...v2("Venda de Munição", "Selecione a FAC compradora. Depois informe as munições no canal temporário da encomenda.", interaction.guild).components,
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${PREFIX}:buyer`)
          .setPlaceholder("FAC compradora")
          .addOptions(buyers.map((faction) => ({ description: `ID interno: ${faction.id}`.slice(0, 100), label: faction.name.slice(0, 100), value: faction.id.slice(0, 100) })))
      )
    ],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  });
}

async function handleBuyerSelected(interaction: StringSelectMenuInteraction, context: BotContext) {
  const buyerFactionId = interaction.values[0];
  if (!buyerFactionId) return;
  const runtime = await context.api.getAmmunitionRuntime(interaction.guildId!);
  if (!(await hasPermission(interaction.guild!, interaction.user.id, runtime.config, "CREATE_ORDER"))) {
    await interaction.reply(v2("Acesso negado", "Seu cargo não pode abrir vendas de munição.", interaction.guild));
    return;
  }
  await interaction.deferUpdate();
  const member = await interaction.guild!.members.fetch(interaction.user.id);
  const order = await context.api.createAmmunitionOrder(interaction.guildId!, {
    buyerFactionId,
    openedByUserId: interaction.user.id,
    sellerUserId: interaction.user.id
  });
  const channel = await createOrderChannel(interaction.guild!, member, order, context);
  const sent = await channel.send(orderPanel(order, interaction.guild!));
  await context.api.updateAmmunitionOrderChannel(interaction.guildId!, order.id, { panelMessageId: sent.id, temporaryChannelId: channel.id });
  await interaction.editReply(v2("Encomenda criada", `Encomenda #${order.orderNumber} criada em <#${channel.id}>. Envie as munições no canal usando exemplos como \`Pistola 500\`, \`Pistola x500\` ou \`500 Pistola\`.`, interaction.guild));
}

async function handleQuantitySubmit(interaction: ModalSubmitInteraction, context: BotContext, buyerFactionId: string) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const quantity = parseQuantity(interaction.fields.getTextInputValue("quantity"));
  if (!quantity) {
    await interaction.editReply(v2("Quantidade inválida", "Informe um número inteiro maior que zero dentro do limite seguro.", interaction.guild));
    return;
  }
  const member = await interaction.guild!.members.fetch(interaction.user.id);
  const order = await context.api.createAmmunitionOrder(interaction.guildId!, {
    buyerFactionId,
    openedByUserId: interaction.user.id,
    quantity,
    sellerUserId: interaction.user.id
  });
  const channel = await createOrderChannel(interaction.guild!, member, order, context);
  const sent = await channel.send(orderPanel(order, interaction.guild!));
  await context.api.updateAmmunitionOrderChannel(interaction.guildId!, order.id, { panelMessageId: sent.id, temporaryChannelId: channel.id });
  await interaction.editReply(v2("Encomenda criada", `Encomenda #${order.orderNumber} criada em <#${channel.id}>. O caixa ainda não foi alterado.`, interaction.guild));
}

async function handleComplete(interaction: ButtonInteraction, context: BotContext, orderId: string) {
  const runtime = await context.api.getAmmunitionRuntime(interaction.guildId!);
  if (!(await hasPermission(interaction.guild!, interaction.user.id, runtime.config, "COMPLETE_ORDER"))) {
    await interaction.reply(v2("Acesso negado", "Seu cargo não pode concluir encomendas.", interaction.guild));
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const member = await interaction.guild!.members.fetch(interaction.user.id);
  const order = await context.api.completeAmmunitionOrder(interaction.guildId!, orderId, {
    avatarUrl: interaction.user.displayAvatarURL({ size: 256 }),
    id: interaction.user.id,
    name: member.displayName
  });
  await refreshOrderMessage(interaction.guild!, order);
  await sendOrderLog(interaction.guild!, runtime.config, order, "delivered");
  scheduleChannelDelete(interaction.guild!, order.temporaryChannelId, runtime.config.completedChannelDeleteDelaySeconds);
  await interaction.editReply(v2("Encomenda entregue", `A encomenda #${order.orderNumber} foi concluída e adicionada ao caixa da FAC vendedora.`, interaction.guild));
}

async function handleCancel(interaction: ButtonInteraction, context: BotContext, orderId: string) {
  const runtime = await context.api.getAmmunitionRuntime(interaction.guildId!);
  if (!(await hasPermission(interaction.guild!, interaction.user.id, runtime.config, "CANCEL_ORDER"))) {
    await interaction.reply(v2("Acesso negado", "Seu cargo não pode cancelar encomendas.", interaction.guild));
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const order = await context.api.cancelAmmunitionOrder(interaction.guildId!, orderId, { actorId: interaction.user.id });
  await refreshOrderMessage(interaction.guild!, order);
  await sendOrderLog(interaction.guild!, runtime.config, order, "cancelled");
  scheduleChannelDelete(interaction.guild!, order.temporaryChannelId, runtime.config.cancelledChannelDeleteDelaySeconds);
  await interaction.editReply(v2("Encomenda cancelada", `A encomenda #${order.orderNumber} foi cancelada. Nenhum valor foi adicionado ao caixa.`, interaction.guild));
}

async function handleReopen(interaction: ButtonInteraction, context: BotContext, orderId: string) {
  const runtime = await context.api.getAmmunitionRuntime(interaction.guildId!);
  if (!(await hasPermission(interaction.guild!, interaction.user.id, runtime.config, "MANAGE_CONFIG"))) {
    await interaction.reply(v2("Acesso negado", "Seu cargo não pode reabrir a edição.", interaction.guild));
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const order = await context.api.setAmmunitionOrderItemLock(interaction.guildId!, orderId, { actorId: interaction.user.id, locked: false });
  await refreshOrderMessage(interaction.guild!, order);
  await interaction.editReply(v2("Edição reaberta", "Os itens da encomenda podem ser alterados novamente.", interaction.guild));
}

export async function handleAmmunitionMessage(message: Message, context: BotContext) {
  if (!message.guild || message.author.bot || !message.content.trim()) return false;
  const order = await context.api.getPendingAmmunitionOrderByChannel(message.guild.id, message.channelId).catch(() => null);
  if (!order || order.status !== "PENDING") return false;
  const runtime = await context.api.getAmmunitionRuntime(message.guild.id);
  if (!(await canProcessOrderMessage(message.guild, message.author.id, runtime.config, order))) return true;

  const content = message.content.trim();
  const command = normalizeLookup(content);
  if (command === "limpar itens") {
    if (order.itemEditingLocked) return replyText(message, "O pedido está finalizado. Use o botão de reabrir edição antes de alterar itens.");
    const updated = await context.api.clearAmmunitionOrderItems(message.guild.id, order.id, { actorId: message.author.id, messageContent: content, messageId: message.id });
    await refreshOrderMessage(message.guild, updated);
    await replyText(message, "Todos os itens foram removidos da encomenda.");
    return true;
  }
  if (command === "listar itens") {
    await context.api.recordAmmunitionOrderMessage(message.guild.id, order.id, { action: "LIST_ITEMS", actorId: message.author.id, messageContent: content, messageId: message.id });
    await replyText(message, orderItemsText(order));
    return true;
  }
  if (command === "finalizar pedido") {
    try {
      const updated = await context.api.setAmmunitionOrderItemLock(message.guild.id, order.id, { actorId: message.author.id, locked: true, messageContent: content, messageId: message.id });
      await refreshOrderMessage(message.guild, updated);
      await replyText(message, "Pedido finalizado. Entrega e cancelamento liberados no painel.");
    } catch {
      await replyText(message, "Adicione ao menos uma munição válida e quantidade maior que zero antes de finalizar.");
    }
    return true;
  }
  if (command.startsWith("remover ")) {
    if (order.itemEditingLocked) return replyText(message, "O pedido está finalizado. Use o botão de reabrir edição antes de alterar itens.");
    const name = content.replace(/^remover\s+/i, "").trim();
    const type = matchAmmunitionType(name, runtime.ammunitionTypes);
    if (!type) {
      await context.api.recordAmmunitionOrderMessage(message.guild.id, order.id, { action: "REJECTED", actorId: message.author.id, messageContent: content, messageId: message.id, metadata: { rejected: [name] } });
      await replyText(message, `Munição não reconhecida: ${name}\nVálidas: ${validTypeNames(runtime.ammunitionTypes)}`);
      return true;
    }
    const updated = await context.api.removeAmmunitionOrderItem(message.guild.id, order.id, type.id, { actorId: message.author.id, messageContent: content, messageId: message.id });
    await refreshOrderMessage(message.guild, updated);
    await replyText(message, `${type.name} removida da encomenda.`);
    return true;
  }
  if (order.itemEditingLocked) return false;

  const parsed = parseAmmunitionMessage(content, runtime.ammunitionTypes);
  if (!parsed.recognized.length && !parsed.rejected.length) return false;
  let updated = order;
  if (parsed.recognized.length) {
    updated = await context.api.addAmmunitionOrderItems(message.guild.id, order.id, {
      actorId: message.author.id,
      items: parsed.recognized.map((item) => ({ ammunitionTypeId: item.type.id, quantity: item.quantity })),
      messageContent: content,
      messageId: message.id
    });
    await refreshOrderMessage(message.guild, updated);
  }
  if (parsed.rejected.length) {
    await context.api.recordAmmunitionOrderMessage(message.guild.id, order.id, { action: "REJECTED", actorId: message.author.id, messageContent: content, messageId: message.id, metadata: { rejected: parsed.rejected } });
    await replyText(message, `Itens não reconhecidos: ${parsed.rejected.join(", ")}\nVálidas: ${validTypeNames(runtime.ammunitionTypes)}`);
  } else {
    await message.react("✅").catch(() => null);
  }
  return true;
}

async function handleSummary(interaction: ButtonInteraction, context: BotContext) {
  const runtime = await context.api.getAmmunitionRuntime(interaction.guildId!);
  if (!(await hasPermission(interaction.guild!, interaction.user.id, runtime.config, "VIEW_REPORT"))) {
    await interaction.reply(v2("Acesso negado", "Seu cargo não pode consultar o resumo semanal.", interaction.guild));
    return;
  }
  const summary = await context.api.getAmmunitionWeeklySummary(interaction.guildId!);
  await interaction.reply(summaryPanel(summary, interaction.guild!));
}

async function handleConfigButton(interaction: ButtonInteraction, context: BotContext, section: string) {
  const runtime = await context.api.getAmmunitionRuntime(interaction.guildId!);
  if (!(await hasPermission(interaction.guild!, interaction.user.id, runtime.config, "MANAGE_CONFIG"))) {
    await interaction.reply(v2("Acesso negado", "Seu cargo não possui permissão de configuração.", interaction.guild));
    return;
  }
  if (section === "main") {
    await interaction.update(configPanel(runtime, interaction.guild!));
    return;
  }
  if (section === "channels") {
    await interaction.showModal(configChannelsModal(runtime.config));
    return;
  }
  if (section === "ammo") {
    await interaction.showModal(configAmmoModal(runtime.config));
    return;
  }
  if (section === "roles") {
    await interaction.showModal(configRolesModal(runtime.config));
  }
}

async function handleConfigModal(interaction: ModalSubmitInteraction, context: BotContext, action: string) {
  const runtime = await context.api.getAmmunitionRuntime(interaction.guildId!);
  if (!(await hasPermission(interaction.guild!, interaction.user.id, runtime.config, "MANAGE_CONFIG"))) {
    await interaction.reply(v2("Acesso negado", "Seu cargo não possui permissão de configuração.", interaction.guild));
    return;
  }
  const [reportRoles = "", manageRoles = ""] = action === "cfg_roles" ? field(interaction, "report").split(";") : [];
  const input = action === "cfg_channels"
    ? {
        logChannelId: field(interaction, "logChannelId"),
        panelChannelId: field(interaction, "panelChannelId"),
        temporaryCategoryId: field(interaction, "temporaryCategoryId")
      }
    : action === "cfg_ammo"
      ? {
          completedChannelDeleteDelaySeconds: Number(field(interaction, "completedDelay") || 300),
          cancelledChannelDeleteDelaySeconds: Number(field(interaction, "cancelledDelay") || 300),
          enabled: field(interaction, "enabled").toLowerCase() !== "false",
          sellerFactionId: field(interaction, "sellerFactionId"),
          unitPriceInCents: parseMoneyToCents(field(interaction, "unitPrice"))
        }
      : {
          roles: {
            CREATE_ORDER: parseIds(field(interaction, "create")),
            VIEW_CHANNEL: parseIds(field(interaction, "view")),
            COMPLETE_ORDER: parseIds(field(interaction, "complete")),
            CANCEL_ORDER: parseIds(field(interaction, "cancel")),
            VIEW_REPORT: parseIds(reportRoles),
            MANAGE_CONFIG: parseIds(manageRoles)
          }
        };
  const config = await context.api.saveAmmunitionRuntimeSettings(interaction.guildId!, input);
  await interaction.reply(v2("Configuração salva", `Sistema de Munição atualizado. Status: ${config.enabled ? "ativo" : "desativado"}.`, interaction.guild));
}

function mainPanel(runtime: AmmunitionRuntime, guild: Guild) {
  const seller = runtime.factions.find((faction) => faction.id === runtime.config.sellerFactionId);
  return renderComponentsV2Panel({
    guild,
    moduleId: MODULE_ID,
    accentColor: 0xf59e0b,
    title: `${systemEmojiText("caixa", guild)} Sistema de Venda de Munição`,
    description: [
      `**FAC vendedora:** ${seller?.name ?? runtime.config.sellerFactionId ?? "Não configurada"}`,
      `**Valor por unidade:** ${money(runtime.config.unitPriceInCents ?? 0)}`,
      "Abra uma encomenda, selecione a FAC compradora e informe a quantidade. O caixa só recebe valor após a entrega."
    ].join("\n"),
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:sale`).setLabel("Venda de Munição").setEmoji(systemComponentEmoji("dinheiro", guild)).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${PREFIX}:summary`).setLabel("Resumo de Vendas").setEmoji(systemComponentEmoji("prancheta", guild)).setStyle(ButtonStyle.Secondary)
    )]
  });
}

function orderPanel(order: AmmunitionOrder, guild: Guild) {
  const closed = order.status !== "PENDING";
  const buttonsDisabled = closed || !order.itemEditingLocked || order.quantity <= 0;
  const itemLines = order.items.length
    ? order.items.map((item) => `• **${item.name}** — ${item.quantity.toLocaleString("pt-BR")} un. × ${money(item.unitPriceInCents)} = **${money(item.subtotalInCents)}**`).join("\n")
    : "Nenhuma munição registrada. Envie mensagens como `Pistola 500`, `Pistola x500`, `500 Pistola` ou `Pistola: 500`.";
  return renderComponentsV2Panel({
    guild,
    moduleId: MODULE_ID,
    accentColor: order.status === "DELIVERED" ? 0x22c55e : order.status === "CANCELLED" ? 0xef4444 : 0xf59e0b,
    title: `${systemEmojiText("caixa", guild)} Encomenda de Munição #${order.orderNumber}`,
    description: [
      `**ID:** ${order.id}`,
      `**Status:** ${order.status}`,
      `**Aberta por:** <@${order.openedByUserId}>`,
      `**Responsável pela venda:** <@${order.sellerUserId}>`,
      `**FAC vendedora:** ${order.sellerFactionName} (${order.sellerFactionId})`,
      `**FAC compradora:** ${order.buyerFactionName} (${order.buyerFactionId})`,
      `**Edição dos itens:** ${order.itemEditingLocked ? "Finalizada" : "Aberta"}`,
      "",
      "**Munições registradas**",
      itemLines,
      "",
      `**Quantidade total:** ${order.quantity.toLocaleString("pt-BR")}`,
      `**Valor total acumulado:** ${money(order.totalValueInCents)}`,
      `**Aberta em:** ${date(order.createdAt)}`
    ].join("\n"),
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:complete:${order.id}`).setLabel("Encomenda Entregue").setStyle(ButtonStyle.Success).setDisabled(buttonsDisabled),
      new ButtonBuilder().setCustomId(`${PREFIX}:cancel:${order.id}`).setLabel("Encomenda Cancelada").setStyle(ButtonStyle.Danger).setDisabled(buttonsDisabled),
      new ButtonBuilder().setCustomId(`${PREFIX}:reopen:${order.id}`).setLabel("Reabrir Edição").setStyle(ButtonStyle.Secondary).setDisabled(closed || !order.itemEditingLocked)
    )]
  });
}

function configPanel(runtime: AmmunitionRuntime, guild: Guild) {
  const config = runtime.config;
  return {
    ...renderComponentsV2Panel({
      guild,
      moduleId: MODULE_ID,
      accentColor: 0xf59e0b,
      title: "Configuração do Sistema de Munição",
      description: [
        `**Status:** ${config.enabled ? "Ativo" : "Desativado"}`,
        `**FAC vendedora:** ${config.sellerFactionId ?? "Não configurada"}`,
        `**Canal do painel:** ${config.panelChannelId ? `<#${config.panelChannelId}>` : "Não configurado"}`,
        `**Categoria temporária:** ${config.temporaryCategoryId ?? "Não configurada"}`,
        `**Canal de logs:** ${config.logChannelId ? `<#${config.logChannelId}>` : "Não configurado"}`,
        `**Valor unitário:** ${money(config.unitPriceInCents ?? 0)}`
      ].join("\n"),
      actions: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:cfg:channels`).setLabel("Configurações de Canais").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`${PREFIX}:cfg:ammo`).setLabel("Configurações de Munição").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`${PREFIX}:cfg:roles`).setLabel("Configuração de Gerência").setStyle(ButtonStyle.Secondary)
        )
      ]
    }),
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  };
}

function configChannelsModal(config: AmmunitionConfig) {
  return new ModalBuilder().setCustomId(`${PREFIX}:cfg_channels`).setTitle("Canais da Munição").addComponents(
    input("panelChannelId", "Canal do painel", config.panelChannelId ?? "", false),
    input("temporaryCategoryId", "Categoria temporária", config.temporaryCategoryId ?? "", false),
    input("logChannelId", "Canal de logs", config.logChannelId ?? "", false)
  );
}

function configAmmoModal(config: AmmunitionConfig) {
  return new ModalBuilder().setCustomId(`${PREFIX}:cfg_ammo`).setTitle("Configuração de Munição").addComponents(
    input("enabled", "Ativo? true/false", String(config.enabled), true),
    input("sellerFactionId", "ID da FAC vendedora", config.sellerFactionId ?? "", true),
    input("unitPrice", "Valor unitário", String((config.unitPriceInCents ?? 0) / 100), true),
    input("completedDelay", "Excluir canal entregue em segundos", String(config.completedChannelDeleteDelaySeconds), true),
    input("cancelledDelay", "Excluir canal cancelado em segundos", String(config.cancelledChannelDeleteDelaySeconds), true)
  );
}

function configRolesModal(config: AmmunitionConfig) {
  return new ModalBuilder().setCustomId(`${PREFIX}:cfg_roles`).setTitle("Cargos de Gerência").addComponents(
    input("create", "Cargos que podem vender", config.roles.CREATE_ORDER.join(","), false),
    input("view", "Cargos que visualizam canais", config.roles.VIEW_CHANNEL.join(","), false),
    input("complete", "Cargos que concluem", config.roles.COMPLETE_ORDER.join(","), false),
    input("cancel", "Cargos que cancelam", config.roles.CANCEL_ORDER.join(","), false),
    input("report", "Relatórios; Config após ;", `${config.roles.VIEW_REPORT.join(",")};${config.roles.MANAGE_CONFIG.join(",")}`, false)
  );
}

function input(id: string, label: string, value: string, required: boolean) {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label.slice(0, 45)).setRequired(required).setStyle(TextInputStyle.Short).setValue(value.slice(0, 4000)));
}

async function createOrderChannel(guild: Guild, member: GuildMember, order: AmmunitionOrder, context: BotContext) {
  const runtime = await context.api.getAmmunitionRuntime(guild.id);
  if (!runtime.config.temporaryCategoryId) throw new Error("Categoria temporária não configurada.");
  const viewRoles = new Set([...runtime.config.roles.VIEW_CHANNEL, ...runtime.config.roles.COMPLETE_ORDER, ...runtime.config.roles.CANCEL_ORDER]);
  return guild.channels.create({
    name: `municao-${slug(order.buyerFactionName)}-${String(order.orderNumber).padStart(4, "0")}`.slice(0, 90),
    parent: runtime.config.temporaryCategoryId,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
      { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      ...[...viewRoles].map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))
    ],
    type: ChannelType.GuildText
  });
}

async function refreshOrderMessage(guild: Guild, order: AmmunitionOrder) {
  if (!order.temporaryChannelId || !order.panelMessageId) return;
  const channel = await guild.channels.fetch(order.temporaryChannelId).catch(() => null);
  if (!channel || !("messages" in channel)) return;
  const message = await channel.messages.fetch(order.panelMessageId).catch(() => null);
  await message?.edit(orderPanel(order, guild)).catch(() => null);
}

async function sendOrderLog(guild: Guild, config: AmmunitionConfig, order: AmmunitionOrder, type: "delivered" | "cancelled") {
  if (!config.logChannelId) return;
  const channel = await guild.channels.fetch(config.logChannelId).catch(() => null);
  if (!channel?.isSendable()) return;
  await channel.send(renderComponentsV2Panel({
    guild,
    moduleId: MODULE_ID,
    accentColor: type === "delivered" ? 0x22c55e : 0xef4444,
    title: type === "delivered" ? "Venda de munição concluída" : "Venda de munição cancelada",
    description: [
      `**Encomenda:** #${order.orderNumber} (${order.id})`,
      `**FAC vendedora:** ${order.sellerFactionName}`,
      `**FAC compradora:** ${order.buyerFactionName}`,
      `**Quantidade:** ${order.quantity.toLocaleString("pt-BR")}`,
      `**Valor total:** ${money(order.totalValueInCents)}`,
      `**Aberta por:** <@${order.openedByUserId}>`,
      type === "delivered" ? `**Confirmada por:** <@${order.completedByUserId}>` : `**Cancelada por:** <@${order.cancelledByUserId}>`,
      type === "delivered" ? `**Movimentação no caixa:** ${order.cashTransactionId}` : "**Caixa:** nenhum valor adicionado"
    ].join("\n")
  }));
}

function summaryPanel(summary: AmmunitionWeeklySummary, guild: Guild) {
  return {
    ...renderComponentsV2Panel({
      guild,
      moduleId: MODULE_ID,
      accentColor: 0xf59e0b,
      title: "Resumo semanal - Munição",
      description: [
        `**Período:** ${date(summary.start)} até ${date(summary.end)}`,
        `**FAC vendedora:** ${summary.sellerFactionName ?? summary.sellerFactionId ?? "Não identificada"}`,
        `**Vendas concluídas:** ${summary.orderCount}`,
        `**Unidades vendidas:** ${summary.totalUnits.toLocaleString("pt-BR")}`,
        `**Valor total:** ${money(summary.totalValueInCents)}`,
        "",
        "**Compras por FAC**",
        summary.buyers.length ? summary.buyers.map((row) => `${row.name}: ${money(row.totalValueInCents)} • ${row.totalUnits.toLocaleString("pt-BR")} un.`).join("\n") : "Nenhuma venda entregue na semana."
      ].join("\n")
    }),
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  };
}

async function hasPermission(guild: Guild, userId: string, config: AmmunitionConfig, permission: AmmunitionPermissionType) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return false;
  if (guild.ownerId === userId) return true;
  const allowed = new Set([...(config.roles[permission] ?? []), ...(config.roles.MANAGE_CONFIG ?? [])]);
  return member.roles.cache.some((role) => allowed.has(role.id));
}

async function canProcessOrderMessage(guild: Guild, userId: string, config: AmmunitionConfig, order: AmmunitionOrder) {
  if (userId === order.openedByUserId || userId === order.sellerUserId) return true;
  return hasPermission(guild, userId, config, "MANAGE_CONFIG");
}

function parseAmmunitionMessage(content: string, types: AmmunitionType[]) {
  const recognized: Array<{ quantity: number; type: AmmunitionType }> = [];
  const rejected: string[] = [];
  const chunks = content.split(/[,;\n]+/).map((chunk) => chunk.trim()).filter(Boolean);
  for (const chunk of chunks) {
    const parsed = parseItemChunk(chunk);
    if (!parsed) continue;
    const type = matchAmmunitionType(parsed.name, types);
    if (!type) rejected.push(parsed.name);
    else recognized.push({ quantity: parsed.quantity, type });
  }
  return { recognized, rejected };
}

function parseItemChunk(chunk: string) {
  const patterns = [
    /^(.+?)\s*:\s*(\d{1,9})$/i,
    /^(.+?)\s+x\s*(\d{1,9})$/i,
    /^(.+?)\s+(\d{1,9})$/i,
    /^(\d{1,9})\s+(.+?)$/i
  ];
  for (const pattern of patterns) {
    const match = chunk.match(pattern);
    if (!match) continue;
    const firstIsQuantity = /^\d+$/.test(match[1] ?? "");
    const quantity = Number(firstIsQuantity ? match[1] : match[2]);
    const name = (firstIsQuantity ? match[2] : match[1])?.trim() ?? "";
    if (Number.isSafeInteger(quantity) && quantity > 0 && name) return { name, quantity };
  }
  return null;
}

function matchAmmunitionType(name: string, types: AmmunitionType[]) {
  const normalized = normalizeLookup(name);
  return types.filter((type) => type.active).find((type) => normalizeLookup(type.name) === normalized || type.aliases.some((alias) => normalizeLookup(alias) === normalized)) ?? null;
}

function validTypeNames(types: AmmunitionType[]) {
  const names = types.filter((type) => type.active).map((type) => type.name);
  return names.length ? names.join(", ") : "nenhuma munição ativa cadastrada";
}

function orderItemsText(order: AmmunitionOrder) {
  if (!order.items.length) return "Nenhuma munição registrada nesta encomenda.";
  return [
    "Itens atuais:",
    ...order.items.map((item) => `${item.name} — ${item.quantity.toLocaleString("pt-BR")} unidades (${money(item.subtotalInCents)})`),
    `Total: ${order.quantity.toLocaleString("pt-BR")} unidades • ${money(order.totalValueInCents)}`
  ].join("\n");
}

async function replyText(message: Message, content: string) {
  await message.reply({ content: content.slice(0, 1900), allowedMentions: { repliedUser: false } }).catch(() => null);
  return true;
}

function missingConfig(runtime: AmmunitionRuntime) {
  const missing: string[] = [];
  if (!runtime.config.enabled) missing.push("- Ativar o módulo.");
  if (!runtime.config.sellerFactionId) missing.push("- Configurar a FAC vendedora.");
  if (!runtime.config.temporaryCategoryId) missing.push("- Configurar a categoria temporária.");
  if (!runtime.config.logChannelId) missing.push("- Configurar o canal de logs.");
  if (!runtime.config.unitPriceInCents) missing.push("- Configurar o valor unitário.");
  if (!runtime.factions.some((faction) => faction.id === runtime.config.sellerFactionId)) missing.push("- Ativar/configurar o Caixa da FAC vendedora.");
  return missing;
}

function v2(title: string, description: string, guild: Guild | null) {
  return { ...renderComponentsV2Panel({ guild, moduleId: MODULE_ID, accentColor: 0xf59e0b, title, description }), flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 };
}

function field(interaction: ModalSubmitInteraction, id: string) {
  return interaction.fields.getTextInputValue(id).trim();
}

function parseIds(value: string) {
  return value.split(/[,\s;]+/).map((item) => item.replace(/[<@&>]/g, "").trim()).filter((item) => /^\d{5,32}$/.test(item));
}

function parseQuantity(value: string) {
  if (!/^\d+$/.test(value.trim())) return null;
  const quantity = Number(value.trim());
  return Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 1_000_000 ? quantity : null;
}

function parseMoneyToCents(value: string) {
  const normalized = value.trim().replace(/^R\$\s*/i, "").replace(/\./g, "").replace(",", ".");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

function scheduleChannelDelete(guild: Guild, channelId: string | null, seconds: number) {
  if (!channelId || seconds <= 0) return;
  const timer = setTimeout(() => {
    void (async () => {
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (channel) await channel.delete("Sistema de Munição: encerramento automático").catch(() => null);
    })();
  }, seconds * 1000);
  timer.unref();
}

function money(cents: number) {
  return (Math.max(0, cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function date(value: string) {
  return new Date(value).toLocaleString("pt-BR");
}

function slug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "fac";
}

function normalizeLookup(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

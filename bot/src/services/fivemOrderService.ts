import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type Interaction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction
} from "discord.js";
import type { BotContext } from "../types";
import type { FivemOrder, FivemOrderProduct, FivemOrderSettings, FivemOrderStatus } from "./apiClient";
import { getFreshGuildSettings } from "./guildSettingsCache";
import { renderComponentsV2Panel } from "./panelVisualRenderer";

const PREFIX = "fivem_order";
const CLIENT_ACTION_PREFIX = "order";
const cooldowns = new Map<string, number>();

export function startFivemOrderService(client: Client<true>, context: BotContext) {
  context.socket.onFivemOrderPanelPublish((payload) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void publishConfiguredOrderPanel(guild, context);
  });
  context.socket.onFivemOrderStatusUpdated((payload) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void notifyOrderStatusChange(guild, context, payload.order, payload.actorId ?? null).catch((error) => {
      console.warn("[fivem-orders] falha ao notificar status via socket:", error instanceof Error ? error.message : error);
    });
  });
}

export async function publishFivemOrderPanel(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) return interaction.reply({ content: "Use este comando em um servidor.", ephemeral: true });
  const result = await publishConfiguredOrderPanel(interaction.guild, context, interaction.channelId);
  await interaction.reply({ content: result ? `Painel de encomendas publicado em <#${result}>.` : "Configure e ative o sistema de encomendas antes de publicar.", ephemeral: true });
}

export async function showFivemOrderCreate(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const runtime = await context.api.getFivemOrderRuntime(interaction.guild.id);
  if (!(await canCreate(interaction.guild, interaction.user.id, runtime.settings))) return interaction.reply({ content: "Voce nao possui permissao para criar encomendas.", ephemeral: true });
  await replyWithFamilySelect(interaction, runtime.families, "all");
}

export async function showFivemOrderStatus(interaction: ChatInputCommandInteraction, context: BotContext, orderNumber: number) {
  if (!interaction.guild) return;
  const order = await context.api.getFivemOrder(interaction.guild.id, orderNumber, interaction.user.id);
  await interaction.reply({ content: order ? orderSummary(order) : "Encomenda nao encontrada para este usuario.", ephemeral: true });
}

export async function updateFivemOrderByNumber(interaction: ChatInputCommandInteraction, context: BotContext, orderNumber: number, status: FivemOrderStatus) {
  if (!interaction.guild) return;
  const runtime = await context.api.getFivemOrderRuntime(interaction.guild.id);
  if (!(await canManage(interaction.guild, interaction.user.id, runtime.settings, status))) return interaction.reply({ content: "Voce nao possui permissao para esta acao.", ephemeral: true });
  const order = await context.api.getFivemOrder(interaction.guild.id, orderNumber);
  if (!order) return interaction.reply({ content: "Encomenda nao encontrada.", ephemeral: true });
  const saved = await context.api.updateFivemOrderStatus({ actorId: interaction.user.id, guildId: interaction.guild.id, orderId: order.id, status });
  await interaction.reply({ content: orderSummary(saved), ephemeral: true });
}

export async function showFivemOrderReport(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const runtime = await context.api.getFivemOrderRuntime(interaction.guild.id);
  const products = runtime.products.map((item) => `${item.emoji ?? "-"} ${item.name}: estoque ${item.useStock ? item.stock ?? 0 : "livre"}`).join("\n") || "Nenhum produto ativo.";
  await interaction.reply({ content: `**Relatorio rapido de encomendas**\n${products}`, ephemeral: true });
}

export async function handleFivemOrderInteraction(interaction: Interaction, context: BotContext) {
  if (!("customId" in interaction)) return false;
  if (interaction.customId.startsWith(`${CLIENT_ACTION_PREFIX}_`)) {
    if (interaction.isButton()) {
      await handleOrderActionButton(interaction, context);
      return true;
    }
    return false;
  }
  if (!interaction.customId.startsWith(`${PREFIX}:`)) return false;
  if (interaction.isStringSelectMenu() && interaction.customId === `${PREFIX}:category`) { await selectCategory(interaction, context); return true; }
  if (interaction.isStringSelectMenu() && interaction.customId === `${PREFIX}:type`) { await selectOrderType(interaction, context); return true; }
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(`${PREFIX}:family:`)) { await selectFamily(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId === `${PREFIX}:create`) { await startCreate(interaction, context); return true; }
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(`${PREFIX}:product:`)) { await showOrderModal(interaction, context); return true; }
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(`${PREFIX}:washing_percentage:`)) { await showWashingModal(interaction, context); return true; }
  if (interaction.isModalSubmit() && interaction.customId.startsWith(`${PREFIX}:modal:`)) { await submitOrder(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId === `${PREFIX}:status`) { await showStatusModal(interaction); return true; }
  if (interaction.isButton() && interaction.customId === `${PREFIX}:families`) { await showFamilies(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId === `${PREFIX}:help`) { await showOrderHelp(interaction); return true; }
  if (interaction.isModalSubmit() && interaction.customId === `${PREFIX}:status_modal`) { await submitStatusLookup(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:action:`)) { await updateOrderFromButton(interaction, context); return true; }
  return false;
}

async function publishConfiguredOrderPanel(guild: Guild, context: BotContext, fallbackChannelId?: string | null) {
  const { products, settings } = await context.api.getFivemOrderRuntime(guild.id);
  if (!settings.enabled) return null;
  const channelId = settings.panelChannelId ?? fallbackChannelId ?? null;
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) return null;
  const payload = createMainPanel(settings, products);
  let message = settings.panelMessageId && "messages" in channel ? await channel.messages.fetch(settings.panelMessageId).catch(() => null) : null;
  if (message) await message.edit(payload).catch(() => null); else message = await channel.send(payload);
  await context.api.updateFivemOrderPanelState(guild.id, message.id);
  return channel.id;
}

function createMainPanel(settings: FivemOrderSettings, products: FivemOrderProduct[]) {
  const categories = [...new Set(products.map((item) => item.category))].slice(0, 25);
  const rows: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>> = [];
  if (categories.length) rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`${PREFIX}:category`).setPlaceholder("Selecione uma categoria").addOptions(categories.map((category) => ({ label: category.slice(0, 100), value: category.slice(0, 100) })))));
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:create`).setLabel("Criar Encomenda").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}:status`).setLabel("Ver Encomenda").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}:families`).setLabel("Ver Familias").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}:help`).setLabel("Como Funciona").setStyle(ButtonStyle.Secondary)
  ));
  return renderComponentsV2Panel({ accentColor: parseColor(settings.color), actions: rows, description: settings.panelDescription, fields: [`**Produtos ativos:** ${products.length}\n**Categorias:** ${categories.join(", ") || "Nenhuma"}`, ...(settings.footerText ? [`-# ${settings.footerText}`] : [])], image: settings.panelImage, moduleId: "fivem-orders", title: settings.panelTitle });
}

async function selectCategory(interaction: StringSelectMenuInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const runtime = await context.api.getFivemOrderRuntime(interaction.guild.id);
  if (!(await canCreate(interaction.guild, interaction.user.id, runtime.settings))) return interaction.reply({ content: "Voce nao possui permissao para criar encomendas.", ephemeral: true });
  await replyWithFamilySelect(interaction, runtime.families, "all");
}

async function startCreate(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const runtime = await context.api.getFivemOrderRuntime(interaction.guild.id);
  if (!(await canCreate(interaction.guild, interaction.user.id, runtime.settings))) return interaction.reply({ content: "Voce nao possui permissao para criar encomendas.", ephemeral: true });
  const enabled = new Set(runtime.settings.enabledOrderModules ?? ["washing", "ammo", "drug", "weapon", "custom"]);
  const types = [{ label: "Lavagem", value: "washing" }, { label: "Municao", value: "ammo" }, { label: "Drogas", value: "drug" }, { label: "Armas", value: "weapon" }, { label: "Itens personalizados", value: "custom" }].filter((item) => enabled.has(item.value as never) && runtime.products.some((product) => normalizeProductModule(product.type) === item.value));
  if (!types.length) return interaction.reply({ content: "Nenhum modulo possui itens ativos. Configure os modulos na dashboard.", ephemeral: true });
  const select = new StringSelectMenuBuilder().setCustomId(`${PREFIX}:type`).setPlaceholder("Escolha o tipo de encomenda").addOptions(types);
  await interaction.reply({ components: [{ type: 17, accent_color: 0x22c55e, components: [{ type: 10, content: "## Criar Encomenda\nPrimeiro escolha o tipo. Depois selecione a familia e o item." }] }, new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
}

async function replyWithFamilySelect(interaction: ButtonInteraction | StringSelectMenuInteraction | ChatInputCommandInteraction, families: Awaited<ReturnType<BotContext["api"]["getFivemOrderRuntime"]>>["families"], type: string) {
  const availableFamilies = families.filter((family) => familyMatchesOrderType(family, type));
  if (!availableFamilies.length) return interaction.reply({ content: "Nenhuma familia ativa foi cadastrada para este tipo de encomenda. Configure as familias na dashboard.", ephemeral: true });
  const select = new StringSelectMenuBuilder().setCustomId(`${PREFIX}:family:${type}`).setPlaceholder("Escolha a familia").addOptions(availableFamilies.slice(0, 25).map((family) => ({ label: family.name.slice(0, 100), value: family.id, description: family.notes?.slice(0, 100) || "Familia ativa" })));
  return interaction.reply({ components: [{ type: 17, accent_color: 0x22c55e, components: [{ type: 10, content: "## Escolha a familia\nToda encomenda deve ficar vinculada a uma familia cadastrada." }] }, new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
}

async function selectOrderType(interaction: StringSelectMenuInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const runtime = await context.api.getFivemOrderRuntime(interaction.guild.id);
  await replyWithFamilySelect(interaction, runtime.families, interaction.values[0] ?? "custom");
}

async function selectFamily(interaction: StringSelectMenuInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const runtime = await context.api.getFivemOrderRuntime(interaction.guild.id);
  const familyId = interaction.values[0] ?? "";
  const type = interaction.customId.split(":")[2] ?? "all";
  if (!runtime.families.some((family) => family.id === familyId && familyMatchesOrderType(family, type))) return interaction.reply({ content: "Familia indisponivel para este tipo de encomenda.", ephemeral: true });
  await replyWithProductSelect(interaction, runtime.products.filter((product) => type === "all" || normalizeProductModule(product.type) === type), null, familyId);
}

async function showFamilies(interaction: ButtonInteraction, context: BotContext) { if (!interaction.guild) return; const runtime = await context.api.getFivemOrderRuntime(interaction.guild.id); await interaction.reply({ content: runtime.families.length ? runtime.families.map((family) => `• **${family.name}** - <@&${family.roleId}>`).join("\n").slice(0, 1900) : "Nenhuma familia cadastrada.", ephemeral: true }); }
async function showOrderHelp(interaction: ButtonInteraction) { await interaction.reply({ content: "**Como criar uma encomenda**\n1. Escolha o tipo.\n2. Selecione a familia.\n3. Escolha o item.\n4. Informe quantidade/valor no modal.\n5. Confirme e acompanhe pelo numero ENC.", ephemeral: true }); }

async function replyWithProductSelect(interaction: ButtonInteraction | StringSelectMenuInteraction | ChatInputCommandInteraction, products: FivemOrderProduct[], category: string | null, familyId: string) {
  const filtered = products.filter((item) => !category || item.category === category).slice(0, 25);
  if (!filtered.length) return interaction.reply({ content: "Nenhum produto disponivel nesta categoria.", ephemeral: true });
  const select = new StringSelectMenuBuilder().setCustomId(`${PREFIX}:product:${familyId}`).setPlaceholder("Escolha o produto").addOptions(filtered.map((item) => ({ label: item.name.slice(0, 100), value: item.id, description: `${item.category} - ${formatMoney(item.price)}`.slice(0, 100), emoji: item.emoji || undefined })));
  return interaction.reply({ components: [{ type: 17, accent_color: 0x22c55e, components: [{ type: 10, content: `## Escolha o produto${category ? `\nCategoria: **${category}**` : ""}` }] }, new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
}

async function showOrderModal(interaction: StringSelectMenuInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const runtime = await context.api.getFivemOrderRuntime(interaction.guild.id);
  const familyId = interaction.customId.split(":")[2] ?? "";
  if (!runtime.families.some((family) => family.id === familyId)) return interaction.reply({ content: "Familia indisponivel.", ephemeral: true });
  const product = runtime.products.find((item) => item.id === interaction.values[0]);
  if (!product) return interaction.reply({ content: "Produto indisponivel.", ephemeral: true });
  if (product.type === "washing") {
    await openOrderModal(interaction, product, familyId, null, runtime.settings);
    return;
  }
  await openOrderModal(interaction, product, familyId, null, runtime.settings);
}

async function showWashingModal(interaction: StringSelectMenuInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const runtime = await context.api.getFivemOrderRuntime(interaction.guild.id);
  const productId = interaction.customId.split(":")[2] ?? "";
  const familyId = interaction.customId.split(":")[3] ?? "";
  const product = runtime.products.find((item) => item.id === productId && item.type === "washing");
  if (!product) return interaction.reply({ content: "Lavagem indisponivel.", ephemeral: true });
  const percentage = Number(interaction.values[0]);
  const allowed = product.washingPercentages?.length ? product.washingPercentages : [product.factionPercentage];
  if (!allowed.includes(percentage)) return interaction.reply({ content: "Percentual nao permitido.", ephemeral: true });
  await openOrderModal(interaction, product, familyId, percentage, runtime.settings);
}

async function openOrderModal(interaction: StringSelectMenuInteraction, product: FivemOrderProduct, familyId: string, washingPercentage: number | null, settings: FivemOrderSettings) {
  const modal = new ModalBuilder().setCustomId(`${PREFIX}:modal:${product.id}:${familyId}${washingPercentage === null ? "" : `:${washingPercentage}`}`).setTitle(`Encomenda - ${product.name}`.slice(0, 45));
  modal.addComponents(inputRow("quantity", product.type === "washing" ? "Valor entregue pela familia" : "Quantidade", product.type === "washing" ? "Ex: 100000" : "Ex: 10", true));
  if (product.type === "washing") return interaction.showModal(modal);
  if (product.allowNotes) modal.addComponents(inputRow("notes", "Observacao", "Detalhes adicionais", false, true));
  if (settings.allowAttachments) modal.addComponents(inputRow("proof", "Link do comprovante", "https://...", false));
  modal.addComponents(inputRow("delivery", "Entrega prevista", "AAAA-MM-DD", false));
  await interaction.showModal(modal);
}

async function submitOrder(interaction: ModalSubmitInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const key = `${interaction.guild.id}:${interaction.user.id}`;
  if ((cooldowns.get(key) ?? 0) > Date.now()) return interaction.reply({ content: "Aguarde alguns segundos antes de enviar outra encomenda.", ephemeral: true });
  cooldowns.set(key, Date.now() + 10_000);
  await interaction.deferReply({ ephemeral: true });
  const runtime = await context.api.getFivemOrderRuntime(interaction.guild.id);
  const productId = interaction.customId.split(":")[2] ?? "";
  const familyId = interaction.customId.split(":")[3] ?? "";
  const washingPercentage = interaction.customId.split(":")[4] ? Number(interaction.customId.split(":")[4]) : null;
  const product = runtime.products.find((item) => item.id === productId);
  if (!product) return interaction.editReply("Produto indisponivel.");
  const numeric = parseBrazilianNumber(interaction.fields.getTextInputValue("quantity"));
  if (numeric === null || numeric <= 0) return interaction.editReply("Informe uma quantidade ou valor valido.");
  const readOptional = (id: string) => interaction.fields.fields.has(id) ? interaction.fields.getTextInputValue(id).trim() || null : null;
  const family = runtime.families.find((item) => item.id === familyId);
  if (!family) return interaction.editReply("Familia indisponivel.");
  const order = await context.api.createFivemOrder({ clientName: family.name, expectedDelivery: readOptional("delivery"), familyId, grossValue: product.type === "washing" ? numeric : null, guildId: interaction.guild.id, notes: readOptional("notes"), productId, proofUrl: readOptional("proof"), quantity: product.type === "washing" ? 1 : numeric, sourceId: interaction.id, userId: interaction.user.id, washingPercentage });
  const reviewChannelId = runtime.settings.approvalChannelId ?? runtime.settings.logChannelId;
  const reviewChannel = reviewChannelId ? await interaction.guild.channels.fetch(reviewChannelId).catch(() => null) : null;
  if (reviewChannel?.isSendable()) await reviewChannel.send(createOrderAdminPanel(runtime.settings, order)).catch(() => null);
  await sendClientOrderNotification(interaction.guild, runtime.settings, order, null);
  await interaction.editReply(`${runtime.settings.orderCreatedMessage}\n\n${orderSummary(order)}`);
}

async function showStatusModal(interaction: ButtonInteraction) {
  const modal = new ModalBuilder().setCustomId(`${PREFIX}:status_modal`).setTitle("Consultar Encomenda");
  modal.addComponents(inputRow("number", "Numero da encomenda", "Ex: 24", true));
  await interaction.showModal(modal);
}

async function submitStatusLookup(interaction: ModalSubmitInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const number = Number(interaction.fields.getTextInputValue("number"));
  const order = Number.isInteger(number) && number > 0 ? await context.api.getFivemOrder(interaction.guild.id, number, interaction.user.id) : null;
  await interaction.reply({ content: order ? orderSummary(order) : "Encomenda nao encontrada.", ephemeral: true });
}

async function updateOrderFromButton(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const [, , statusValue, orderId] = interaction.customId.split(":");
  const status = statusValue as FivemOrderStatus;
  const runtime = await context.api.getFivemOrderRuntime(interaction.guild.id);
  if (!(await canManage(interaction.guild, interaction.user.id, runtime.settings, status))) return interaction.editReply("Voce nao possui permissao para esta acao.");
  const saved = await context.api.updateFivemOrderStatus({ actorId: interaction.user.id, guildId: interaction.guild.id, orderId: orderId ?? "", status });
  await interaction.message.edit(createOrderAdminPanel(runtime.settings, saved)).catch(() => null);
  await interaction.editReply(`Encomenda #${saved.orderNumber} atualizada para ${statusLabel(saved.status)}.`);
}

async function handleOrderActionButton(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const [action, value, rawId] = parseOrderAction(interaction.customId);

  if (action === "view_details") {
    await showOrderDetailsFromButton(interaction, context, Number(value));
    return;
  }

  if (action === "cancel") {
    await cancelOrderFromClientButton(interaction, context, Number(value));
    return;
  }

  if (action === "contact_staff") {
    await contactStaffFromClientButton(interaction, context, Number(value));
    return;
  }

  if (action === "contact_client") {
    await contactClientFromStaffButton(interaction, context, Number(value));
    return;
  }

  const status = actionToStatus(action, value);
  if (!status) {
    await interaction.reply({ content: "Acao de encomenda invalida.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const runtime = await context.api.getFivemOrderRuntime(interaction.guild.id);
  if (!(await canManage(interaction.guild, interaction.user.id, runtime.settings, status))) {
    await interaction.editReply("Voce nao possui permissao para esta acao.");
    return;
  }

  const saved = await context.api.updateFivemOrderStatus({
    actorId: interaction.user.id,
    guildId: interaction.guild.id,
    orderId: rawId ?? value,
    status
  });

  await interaction.message.edit(createOrderAdminPanel(runtime.settings, saved)).catch(() => null);
  await interaction.editReply(`Encomenda ENC-${String(saved.orderNumber).padStart(4, "0")} atualizada para ${statusLabel(saved.status)}.`);
}

async function showOrderDetailsFromButton(interaction: ButtonInteraction, context: BotContext, orderNumber: number) {
  if (!interaction.guild || !Number.isInteger(orderNumber)) return interaction.reply({ content: "Encomenda invalida.", ephemeral: true });
  await interaction.deferReply({ ephemeral: true });
  const runtime = await context.api.getFivemOrderRuntime(interaction.guild.id);
  const scopedOrder = await context.api.getFivemOrder(interaction.guild.id, orderNumber, interaction.user.id);
  const canSeeAll = await canManage(interaction.guild, interaction.user.id, runtime.settings, "approved");
  const order = scopedOrder ?? (canSeeAll ? await context.api.getFivemOrder(interaction.guild.id, orderNumber) : null);
  if (!order) return interaction.editReply("Encomenda nao encontrada ou voce nao tem permissao para ve-la.");
  await interaction.editReply({ embeds: [createOrderEmbed(runtime.settings, order, { title: `Detalhes da encomenda ENC-${String(order.orderNumber).padStart(4, "0")}` })], components: [createClientOrderActions(order)] });
}

async function cancelOrderFromClientButton(interaction: ButtonInteraction, context: BotContext, orderNumber: number) {
  if (!interaction.guild || !Number.isInteger(orderNumber)) return interaction.reply({ content: "Encomenda invalida.", ephemeral: true });
  await interaction.deferReply({ ephemeral: true });
  const runtime = await context.api.getFivemOrderRuntime(interaction.guild.id);
  const order = await context.api.getFivemOrder(interaction.guild.id, orderNumber, interaction.user.id);
  if (!order) return interaction.editReply("Encomenda nao encontrada para este usuario.");
  if (!["open", "pending_approval", "approved"].includes(order.status)) return interaction.editReply("Esta encomenda nao pode mais ser cancelada pelo cliente.");
  const saved = await context.api.updateFivemOrderStatus({ actorId: interaction.user.id, guildId: interaction.guild.id, note: "Cancelada pelo cliente via Discord.", orderId: order.id, status: "cancelled" });
  await interaction.editReply(`Encomenda ENC-${String(saved.orderNumber).padStart(4, "0")} cancelada.`);
}

async function contactStaffFromClientButton(interaction: ButtonInteraction, context: BotContext, orderNumber: number) {
  if (!interaction.guild || !Number.isInteger(orderNumber)) return interaction.reply({ content: "Encomenda invalida.", ephemeral: true });
  await interaction.deferReply({ ephemeral: true });
  const order = await context.api.getFivemOrder(interaction.guild.id, orderNumber, interaction.user.id);
  if (!order) return interaction.editReply("Encomenda nao encontrada para este usuario.");
  const channel = await createOrderContactTicket(interaction.guild, context, order);
  if (channel) {
    await interaction.editReply(`Atendimento aberto para esta encomenda: <#${channel.id}>.`);
    return;
  }
  const runtime = await context.api.getFivemOrderRuntime(interaction.guild.id);
  const notified = await notifyStaffContactRequest(interaction.guild, runtime.settings, order, interaction.user.id);
  await interaction.editReply(notified ? "A equipe foi notificada para falar com voce sobre esta encomenda." : "Nao consegui abrir ticket nem localizar canal de equipe. Avise um administrador.");
}

async function contactClientFromStaffButton(interaction: ButtonInteraction, context: BotContext, orderNumber: number) {
  if (!interaction.guild || !Number.isInteger(orderNumber)) return interaction.reply({ content: "Encomenda invalida.", ephemeral: true });
  await interaction.deferReply({ ephemeral: true });
  const runtime = await context.api.getFivemOrderRuntime(interaction.guild.id);
  if (!(await canManage(interaction.guild, interaction.user.id, runtime.settings, "approved"))) return interaction.editReply("Voce nao possui permissao para contatar clientes.");
  const order = await context.api.getFivemOrder(interaction.guild.id, orderNumber);
  if (!order) return interaction.editReply("Encomenda nao encontrada.");
  const user = await interaction.client.users.fetch(order.userId).catch(() => null);
  const sent = await user?.send({
    embeds: [createOrderEmbed(runtime.settings, order, {
      description: `Um responsavel da equipe quer falar com voce sobre a encomenda. Responsavel: <@${interaction.user.id}>.`,
      title: `Contato solicitado - ENC-${String(order.orderNumber).padStart(4, "0")}`
    })],
    components: [createClientOrderActions(order)]
  }).then(() => true).catch(() => false);
  if (!sent) await notifyStaffContactRequest(interaction.guild, runtime.settings, order, interaction.user.id, "Nao consegui enviar DM ao cliente. Use o canal/log para combinar o contato.");
  await interaction.editReply(sent ? "Cliente notificado por DM." : "DM fechada. Registrei o fallback no canal de equipe, se configurado.");
}

function createOrderAdminPanel(settings: FivemOrderSettings, order: FivemOrder) {
  const terminal = ["delivered", "cancelled", "rejected"].includes(order.status);
  return {
    allowedMentions: { parse: [] as never[] },
    embeds: [createOrderEmbed(settings, order, {
      description: "Use os botoes abaixo para conduzir a encomenda. As acoes atualizam o status real no sistema.",
      title: `Encomenda ENC-${String(order.orderNumber).padStart(4, "0")}`
    })],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`order_accept:${order.id}`).setLabel("Aceitar").setStyle(ButtonStyle.Success).setDisabled(terminal || order.status !== "pending_approval"),
        new ButtonBuilder().setCustomId(`order_reject:${order.id}`).setLabel("Recusar").setStyle(ButtonStyle.Danger).setDisabled(terminal || !["pending_approval", "open", "approved"].includes(order.status)),
        new ButtonBuilder().setCustomId(`order_status_in_production:${order.id}`).setLabel("Em producao").setStyle(ButtonStyle.Primary).setDisabled(terminal || !["open", "approved"].includes(order.status)),
        new ButtonBuilder().setCustomId(`order_status_ready:${order.id}`).setLabel("Pronta").setStyle(ButtonStyle.Primary).setDisabled(terminal || order.status !== "in_production"),
        new ButtonBuilder().setCustomId(`order_status_delivered:${order.id}`).setLabel("Entregue").setStyle(ButtonStyle.Success).setDisabled(terminal || order.status !== "ready")
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`order_view_details:${order.orderNumber}`).setLabel("Abrir pedido").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`order_contact_client:${order.orderNumber}`).setLabel("Contatar cliente").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`order_status_cancelled:${order.id}`).setLabel("Cancelar").setStyle(ButtonStyle.Danger).setDisabled(terminal)
      )
    ]
  };
}

async function notifyOrderStatusChange(guild: Guild, context: BotContext, order: FivemOrder, actorId: string | null) {
  const runtime = await context.api.getFivemOrderRuntime(guild.id);
  await sendClientOrderNotification(guild, runtime.settings, order, actorId);
  await sendStaffOrderStatusNotification(guild, runtime.settings, order, actorId);
}

async function sendClientOrderNotification(guild: Guild, settings: FivemOrderSettings, order: FivemOrder, actorId: string | null) {
  const user = await guild.client.users.fetch(order.userId).catch(() => null);
  if (!user) {
    await notifyStaffContactRequest(guild, settings, order, actorId ?? order.userId, "Nao consegui localizar o usuario para enviar DM.");
    return false;
  }

  const sent = await user.send({
    embeds: [createOrderEmbed(settings, order, {
      description: clientStatusDescription(order, actorId),
      title: clientStatusTitle(order)
    })],
    components: [createClientOrderActions(order)]
  }).then(() => true).catch(() => false);

  if (!sent) {
    await notifyStaffContactRequest(guild, settings, order, actorId ?? order.userId, "Cliente com DM fechada. Notificacao privada nao entregue.");
  }

  return sent;
}

async function sendStaffOrderStatusNotification(guild: Guild, settings: FivemOrderSettings, order: FivemOrder, actorId: string | null) {
  const channelId = settings.logChannelId ?? settings.approvalChannelId;
  if (!channelId) return false;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) return false;
  await channel.send({
    allowedMentions: { parse: [] },
    embeds: [createOrderEmbed(settings, order, {
      description: `Status alterado para **${statusLabel(order.status)}**${actorId ? ` por <@${actorId}>` : ""}.`,
      title: `Atualizacao de encomenda ENC-${String(order.orderNumber).padStart(4, "0")}`
    })],
    components: createStaffNotificationActions(order)
  }).catch(() => null);
  return true;
}

function createOrderEmbed(settings: FivemOrderSettings, order: FivemOrder, options: { description?: string; title?: string } = {}) {
  const embed = new EmbedBuilder()
    .setColor(parseColor(settings.color))
    .setTitle(options.title ?? `Encomenda ENC-${String(order.orderNumber).padStart(4, "0")}`)
    .setDescription(options.description ?? "Detalhes da encomenda.")
    .addFields(
      { name: "Cliente", value: `<@${order.userId}>`, inline: true },
      { name: "Familia", value: order.familyName || "Nao informada", inline: true },
      { name: "Status", value: statusLabel(order.status), inline: true },
      { name: "Produto", value: `${order.productName} (${order.category})`.slice(0, 1024), inline: true },
      { name: "Quantidade", value: String(order.quantity), inline: true },
      { name: "Valor", value: formatMoney(order.finalValue), inline: true }
    )
    .setFooter({ text: settings.footerText || "Sistema de Encomendas" })
    .setTimestamp(new Date(order.updatedAt ?? order.createdAt));

  if (order.responsibleId) embed.addFields({ name: "Responsavel", value: `<@${order.responsibleId}>`, inline: true });
  if (order.washingPercentage !== null && order.washingPercentage !== undefined) {
    embed.addFields(
      { name: "Valor entregue", value: formatMoney(order.grossValue), inline: true },
      { name: "Percentual", value: `${order.washingPercentage}%`, inline: true }
    );
  }
  if (order.expectedDelivery) embed.addFields({ name: "Previsao", value: order.expectedDelivery, inline: true });
  if (order.notes) embed.addFields({ name: "Observacao", value: order.notes.slice(0, 1024), inline: false });
  if (order.proofUrl) embed.addFields({ name: "Comprovante", value: order.proofUrl.slice(0, 1024), inline: false });
  return embed;
}

function createClientOrderActions(order: FivemOrder) {
  const canCancel = ["open", "pending_approval", "approved"].includes(order.status);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`order_contact_staff:${order.orderNumber}`).setLabel("Falar com responsavel").setStyle(ButtonStyle.Primary).setDisabled(["delivered", "cancelled", "rejected"].includes(order.status)),
    new ButtonBuilder().setCustomId(`order_view_details:${order.orderNumber}`).setLabel("Ver detalhes do pedido").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`order_cancel:${order.orderNumber}`).setLabel("Cancelar pedido").setStyle(ButtonStyle.Danger).setDisabled(!canCancel)
  );
}

function createStaffNotificationActions(order: FivemOrder) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`order_view_details:${order.orderNumber}`).setLabel("Abrir pedido").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`order_status_in_production:${order.id}`).setLabel("Marcar em producao").setStyle(ButtonStyle.Primary).setDisabled(!["open", "approved"].includes(order.status)),
      new ButtonBuilder().setCustomId(`order_status_delivered:${order.id}`).setLabel("Marcar entregue").setStyle(ButtonStyle.Success).setDisabled(order.status !== "ready"),
      new ButtonBuilder().setCustomId(`order_contact_client:${order.orderNumber}`).setLabel("Contatar cliente").setStyle(ButtonStyle.Secondary)
    )
  ];
}

function clientStatusTitle(order: FivemOrder) {
  const number = String(order.orderNumber).padStart(4, "0");
  return ({
    approved: `Encomenda ENC-${number} aceita`,
    cancelled: `Encomenda ENC-${number} cancelada`,
    delivered: `Encomenda ENC-${number} entregue`,
    in_production: `Encomenda ENC-${number} em producao`,
    open: `Encomenda ENC-${number} recebida`,
    pending_approval: `Encomenda ENC-${number} aguardando aprovacao`,
    ready: `Encomenda ENC-${number} pronta`,
    rejected: `Encomenda ENC-${number} recusada`
  } as const)[order.status];
}

function clientStatusDescription(order: FivemOrder, actorId: string | null) {
  const responsible = order.responsibleId ?? actorId;
  const suffix = responsible ? `\n\nResponsavel: <@${responsible}>.` : "";
  return ({
    approved: `Sua encomenda foi aceita pela equipe. O proximo passo e iniciar a producao.${suffix}`,
    cancelled: "Sua encomenda foi cancelada. Se isso nao foi solicitado por voce, fale com a equipe.",
    delivered: "Sua encomenda foi marcada como entregue. Confira os detalhes abaixo.",
    in_production: `Sua encomenda entrou em producao. A equipe avisara quando estiver pronta.${suffix}`,
    open: "Sua encomenda foi registrada e ja esta na fila da equipe.",
    pending_approval: "Sua encomenda foi registrada e aguarda aprovacao da equipe.",
    ready: `Sua encomenda esta pronta para entrega. Fale com o responsavel para combinar os detalhes.${suffix}`,
    rejected: "Sua encomenda foi recusada pela equipe. Confira os detalhes abaixo ou fale com um responsavel."
  } as const)[order.status];
}

function parseOrderAction(customId: string) {
  if (customId.startsWith("order_status_")) {
    const [head, orderId] = customId.split(":");
    return ["status", (head ?? "").replace("order_status_", ""), orderId ?? null] as const;
  }
  const parts = customId.split(":");
  return [parts[0]?.replace(/^order_/, "") ?? "", parts[1] ?? "", parts[2] ?? null] as const;
}

function actionToStatus(action: string, value: string): FivemOrderStatus | null {
  if (action === "accept") return "approved";
  if (action === "reject") return "rejected";
  if (action === "status") {
    const allowed: FivemOrderStatus[] = ["approved", "in_production", "ready", "delivered", "cancelled", "rejected"];
    return allowed.includes(value as FivemOrderStatus) ? value as FivemOrderStatus : null;
  }
  return null;
}

async function createOrderContactTicket(guild: Guild, context: BotContext, order: FivemOrder) {
  const settings = await getFreshGuildSettings(context, guild.id, guild.client.user?.id).catch(() => null);
  if (!settings?.ticketEnabled) return null;
  const orderRuntime = await context.api.getFivemOrderRuntime(guild.id).catch(() => null);
  const staffRoleIds = orderRuntime?.settings.adminRoleIds ?? [];

  let channel: TextChannel | null = null;
  if (settings.ticketCategoryId && guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    channel = await guild.channels.create({
      name: `ticket-enc-${String(order.orderNumber).padStart(4, "0")}-${order.userId.slice(-4)}`,
      parent: settings.ticketCategoryId,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: order.userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
        ...staffRoleIds.map((roleId) => ({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))
      ],
      reason: `Contato solicitado na encomenda ENC-${String(order.orderNumber).padStart(4, "0")}`,
      type: ChannelType.GuildText
    }).then((created) => created as TextChannel).catch(() => null);
  }

  await context.api.createTicket({
    channelId: channel?.id ?? null,
    guildId: guild.id,
    openerId: order.userId,
    subject: `Encomenda ENC-${String(order.orderNumber).padStart(4, "0")}`
  }).catch(() => null);

  if (channel) {
    await channel.send({
      allowedMentions: { users: [order.userId] },
      embeds: [createOrderEmbed({ color: settings.ticketPanelColor, footerText: settings.ticketPanelFooterText } as FivemOrderSettings, order, {
        description: "Canal aberto para tratar esta encomenda com a equipe.",
        title: `Atendimento da encomenda ENC-${String(order.orderNumber).padStart(4, "0")}`
      })],
      content: `<@${order.userId}>`
    }).catch(() => null);
  }

  return channel;
}

async function notifyStaffContactRequest(guild: Guild, settings: FivemOrderSettings, order: FivemOrder, actorId: string, note?: string) {
  const channelId = settings.approvalChannelId ?? settings.logChannelId;
  if (!channelId) return false;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) return false;
  await channel.send({
    allowedMentions: { parse: [] },
    embeds: [createOrderEmbed(settings, order, {
      description: `${note ?? "Cliente solicitou contato com a equipe."}\nSolicitante/responsavel: <@${actorId}>.`,
      title: `Contato necessario - ENC-${String(order.orderNumber).padStart(4, "0")}`
    })],
    components: createStaffNotificationActions(order)
  }).catch(() => null);
  return true;
}

async function sendOrderLog(guild: Guild, settings: FivemOrderSettings, order: FivemOrder, actorId: string) {
  if (!settings.logChannelId) return;
  const channel = await guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel?.isSendable()) return;
  await channel.send({ components: [{ type: 17, accent_color: parseColor(settings.color), components: [{ type: 10, content: `## Encomenda #${order.orderNumber} atualizada\nStatus: **${statusLabel(order.status)}**\nResponsavel: <@${actorId}>\nData: <t:${Math.floor(Date.now() / 1000)}:F>` }] }], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
}

async function canCreate(guild: Guild, userId: string, settings: FivemOrderSettings) {
  const member = await guild.members.fetch(userId).catch(() => null); if (!member) return false;
  return !settings.createRoleIds.length || guild.ownerId === userId || member.permissions.has(PermissionFlagsBits.Administrator) || member.roles.cache.some((role) => settings.createRoleIds.includes(role.id) || settings.adminRoleIds.includes(role.id));
}
async function canManage(guild: Guild, userId: string, settings: FivemOrderSettings, status: FivemOrderStatus) {
  const member = await guild.members.fetch(userId).catch(() => null); if (!member) return false;
  if (guild.ownerId === userId || member.permissions.has(PermissionFlagsBits.Administrator) || member.roles.cache.some((role) => settings.adminRoleIds.includes(role.id))) return true;
  const roles = status === "cancelled" || status === "rejected" ? settings.cancelRoleIds : settings.finishRoleIds;
  return member.roles.cache.some((role) => roles.includes(role.id));
}
function inputRow(id: string, label: string, placeholder: string, required: boolean, paragraph = false) { return new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label.slice(0, 45)).setPlaceholder(placeholder).setRequired(required).setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)); }
function orderSummary(order: FivemOrder) { return `**Encomenda ENC-${String(order.orderNumber).padStart(4, "0")}**\nFamilia: ${order.familyName}\nProduto: ${order.productName}${order.washingPercentage !== null && order.washingPercentage !== undefined ? `\nValor entregue: ${formatMoney(order.grossValue)}\nPercentual: ${order.washingPercentage}%\nValor para familia: ${formatMoney(order.finalValue)}` : `\nValor: ${formatMoney(order.finalValue)}`}\nStatus: ${statusLabel(order.status)}\nCriada: <t:${Math.floor(new Date(order.createdAt).getTime() / 1000)}:F>`; }
function statusLabel(status: FivemOrderStatus) { return ({ open: "Aberta", pending_approval: "Aguardando aprovacao", approved: "Aprovada", in_production: "Em producao", ready: "Pronta", delivered: "Entregue", cancelled: "Cancelada", rejected: "Recusada" } as const)[status]; }
function normalizeProductModule(type: FivemOrderProduct["type"]) { return type === "standard" ? "custom" : type; }
function familyMatchesOrderType(family: Awaited<ReturnType<BotContext["api"]["getFivemOrderRuntime"]>>["families"][number], type: string) { return type === "all" || !family.orderModules?.length || family.orderModules.includes(type as "washing" | "ammo" | "drug" | "weapon" | "custom"); }
function formatMoney(value: number) { return new Intl.NumberFormat("pt-BR", { currency: "BRL", style: "currency" }).format(value); }
function parseColor(value: string) { return Number.parseInt(value.replace("#", ""), 16) || 0x22c55e; }
function parseBrazilianNumber(value: string) { const raw = value.trim().replace(/[^\d.,-]/g, ""); if (!raw) return null; const comma = raw.lastIndexOf(","); const dot = raw.lastIndexOf("."); let normalized = raw; if (comma >= 0 && dot >= 0) normalized = comma > dot ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, ""); else if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) normalized = raw.replace(/[.,]/g, ""); else if (comma >= 0) normalized = raw.replace(",", "."); const number = Number(normalized); return Number.isFinite(number) ? number : null; }

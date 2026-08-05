import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type Interaction,
  type ModalSubmitInteraction
} from "discord.js";
import type { BotCommand, BotContext } from "../types";
import type { FivemExpenseConfig, FivemExpenseItem, FivemExpenseRecord, FivemExpenseRuntime } from "./apiClient";
import { renderComponentsV2Panel } from "./panelVisualRenderer";
import { systemComponentEmoji, systemEmojiText } from "./systemEmojiService";

const PREFIX = "fivem_expenses";
const CONFIRM_TTL_MS = 5 * 60_000;

type PendingExpense = {
  channelId: string;
  description: string | null;
  expires: number;
  guildId: string;
  interactionId: string;
  itemId: string;
  organizationId: string;
  quantity: number | null;
  totalAmountCents: number;
  unitAmountCents: number | null;
  userAvatar: string | null;
  userDisplayName: string;
  userId: string;
};

const pending = new Map<string, PendingExpense>();

export function startFivemExpenseService(client: Client<true>, context: BotContext) {
  context.socket.onFivemExpensePanelPublish((payload) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void publishConfiguredExpensePanel(guild, context, payload.organizationId);
  });

  const timer = setInterval(() => {
    for (const [key, value] of pending) {
      if (value.expires < Date.now()) pending.delete(key);
    }
  }, 60_000);
  timer.unref();
}

export async function handleFivemExpenseInteraction(interaction: Interaction, context: BotContext) {
  if (!("customId" in interaction) || !interaction.customId.startsWith(`${PREFIX}:`)) return false;
  if (!interaction.guild) return true;

  const [, action, arg] = interaction.customId.split(":");
  const runtime = await context.api.getFivemExpenseRuntime(interaction.guild.id, arg || undefined);

  if (interaction.isStringSelectMenu() && action === "panel") {
    const selected = interaction.values[0];
    if (!(await canUse(interaction.guild, interaction.user.id, runtime.config, false))) {
      await denied(interaction);
      return true;
    }
    if (selected === "register") {
      await showExpenseModal(interaction, runtime);
      return true;
    }
    if (selected === "summary") {
      await showSummary(interaction, runtime, true);
      return true;
    }
  }

  if (interaction.isModalSubmit() && action === "modal") {
    if (!(await canUse(interaction.guild, interaction.user.id, runtime.config, false))) {
      await denied(interaction);
      return true;
    }
    await submitExpenseModal(interaction, context, runtime);
    return true;
  }

  if (interaction.isButton() && action === "confirm") {
    await confirmExpense(interaction, context, arg ?? "");
    return true;
  }

  if (interaction.isButton() && action === "cancel") {
    const row = pending.get(arg ?? "");
    if (row?.userId && row.userId !== interaction.user.id) {
      await interaction.reply(v2("Ação recusada", "Somente quem iniciou a operação pode cancelar.", interaction.guild));
      return true;
    }
    pending.delete(arg ?? "");
    await interaction.update(v2("Operação cancelada", "Nenhum gasto foi registrado e o caixa não foi alterado.", interaction.guild));
    return true;
  }

  return false;
}

export const gastosCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("gastos")
    .setDescription("Mostra o ranking de gastos da organização.")
    .addStringOption((option) => option.setName("organizacao").setDescription("ID da organização/facção vinculada ao módulo"))
    .addStringOption((option) => option.setName("tipo").setDescription("Tipo de ranking").addChoices(
      { name: "Usuários por valor", value: "users_value" },
      { name: "Itens por valor", value: "items_value" },
      { name: "Compras por item", value: "items_count" }
    ))
    .addIntegerOption((option) => option.setName("quantidade").setDescription("Quantidade de posições").setMinValue(3).setMaxValue(20)),
  moduleId: "fivem-expenses",
  async execute(interaction, context) {
    if (!interaction.guild) return;
    const organizationId = interaction.options.getString("organizacao")?.trim() || undefined;
    const runtime = await context.api.getFivemExpenseRuntime(interaction.guild.id, organizationId);
    if (!(await canUse(interaction.guild, interaction.user.id, runtime.config, false))) {
      await denied(interaction);
      return;
    }
    const type = interaction.options.getString("tipo") ?? "users_value";
    const limit = interaction.options.getInteger("quantidade") ?? 10;
    await interaction.reply(v2(`🏆 Ranking de Gastos — ${runtime.config.organizationName}`, rankingText(runtime.records, type, limit), interaction.guild));
  }
};

export const resetarGastosCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("resetar-gastos")
    .setDescription("Arquiva relatórios de gastos sem alterar o saldo do Caixa da FAC.")
    .addStringOption((option) => option.setName("confirmacao").setDescription("Digite CONFIRMAR RESET").setRequired(true))
    .addStringOption((option) => option.setName("organizacao").setDescription("ID da organização/facção vinculada ao módulo"))
    .addStringOption((option) => option.setName("motivo").setDescription("Motivo do reset lógico").setMaxLength(500)),
  moduleId: "fivem-expenses",
  async execute(interaction, context) {
    if (!interaction.guild) return;
    const organizationId = interaction.options.getString("organizacao")?.trim() || undefined;
    const runtime = await context.api.getFivemExpenseRuntime(interaction.guild.id, organizationId);
    if (!(await canUse(interaction.guild, interaction.user.id, runtime.config, true))) {
      await denied(interaction);
      return;
    }
    if (interaction.options.getString("confirmacao", true) !== "CONFIRMAR RESET") {
      await interaction.reply(v2("Confirmação obrigatória", "Digite exatamente `CONFIRMAR RESET` para arquivar os relatórios de gastos.", interaction.guild));
      return;
    }
    const result = await context.api.resetFivemExpenses(interaction.guild.id, {
      actorId: interaction.user.id,
      organizationId: runtime.config.organizationId,
      reason: interaction.options.getString("motivo")
    });
    await interaction.reply(v2("Reset lógico concluído", `Registros arquivados: **${result.affected}**\nLote: **${result.resetBatchId}**\nO saldo do Caixa da FAC não foi alterado.`, interaction.guild));
  }
};

async function publishConfiguredExpensePanel(guild: Guild, context: BotContext, organizationId?: string | null) {
  const runtime = await context.api.getFivemExpenseRuntime(guild.id, organizationId);
  const config = runtime.config;
  if (!config.enabled || !config.panelChannelId) return null;
  const channel = await guild.channels.fetch(config.panelChannelId).catch(() => null);
  if (!channel?.isSendable()) return null;

  const payload = panelPayload(runtime, guild);
  const oldMessage = config.panelMessageId && "messages" in channel
    ? await channel.messages.fetch(config.panelMessageId).catch(() => null)
    : null;
  if (oldMessage) await oldMessage.edit(payload);
  else {
    const message = await channel.send(payload);
    await context.api.updateFivemExpensePanelState(guild.id, { messageId: message.id, organizationId: config.organizationId });
  }
  return channel.id;
}

function panelPayload(runtime: FivemExpenseRuntime, guild: Guild) {
  const config = runtime.config;
  const menu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:panel:${config.organizationId}`)
    .setPlaceholder("Selecione uma ação")
    .addOptions([
      { label: "Registrar gasto", value: "register", emoji: systemComponentEmoji("dinheiro", guild), description: "Abrir o formulário de gastos" },
      { label: "Resumo de gastos", value: "summary", emoji: systemComponentEmoji("prancheta_acertos", guild), description: "Consultar resumo privado" }
    ]));
  return renderComponentsV2Panel({
    guild,
    moduleId: "fivem-expenses",
    accentColor: color(config.color),
    title: config.panelTitle,
    description: [
      config.panelDescription,
      "",
      `**Organização:** ${config.organizationName}`,
      `**Saldo do caixa:** ${money(runtime.report.balanceCents)}`,
      "Somente pessoas autorizadas podem utilizar este sistema."
    ].join("\n"),
    actions: [menu]
  });
}

async function showExpenseModal(interaction: { showModal: (modal: ModalBuilder) => Promise<unknown> }, runtime: FivemExpenseRuntime) {
  const items = runtime.items.filter((item) => item.enabled).slice(0, 25);
  if (!items.length) {
    await (interaction as any).reply(v2("Sem itens ativos", "Cadastre ou reative pelo menos um item de gasto na dashboard.", null));
    return;
  }
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:${runtime.config.organizationId}`)
    .setTitle("Registrar Gasto")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Categoria do gasto")
        .setDescription("Selecione a categoria da despesa realizada")
        .setStringSelectMenuComponent(new StringSelectMenuBuilder()
          .setCustomId("item")
          .setPlaceholder("Selecione a categoria do gasto")
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(items.map((item) => ({
            label: item.name.slice(0, 100),
            value: item.id,
            description: (item.description ?? "Item de gasto").slice(0, 100),
            emoji: item.emoji ?? undefined
          })))),
      new LabelBuilder().setLabel("Quantidade").setDescription("Quantas unidades foram compradas").setTextInputComponent(new TextInputBuilder().setCustomId("quantity").setRequired(false).setStyle(TextInputStyle.Short).setMaxLength(40)),
      new LabelBuilder().setLabel("Valor gasto").setDescription("Valor total pago ou unitário, conforme o item").setTextInputComponent(new TextInputBuilder().setCustomId("amount").setRequired(true).setStyle(TextInputStyle.Short).setMaxLength(80)),
      new LabelBuilder().setLabel("Observação").setDescription("Detalhes adicionais da compra").setTextInputComponent(new TextInputBuilder().setCustomId("description").setRequired(false).setStyle(TextInputStyle.Paragraph).setMaxLength(1000))
    );
  await interaction.showModal(modal);
}

async function submitExpenseModal(interaction: ModalSubmitInteraction, context: BotContext, runtime: FivemExpenseRuntime) {
  const itemId = interaction.fields.getStringSelectValues("item")[0] ?? "";
  const item = runtime.items.find((entry) => entry.id === itemId && entry.enabled);
  if (!item) {
    await interaction.reply(v2("Item indisponível", "O item selecionado não está mais ativo.", interaction.guild));
    return;
  }
  const quantity = parseQuantity(interaction.fields.getTextInputValue("quantity"));
  const amountCents = parseMoneyToCents(interaction.fields.getTextInputValue("amount"));
  const description = interaction.fields.getTextInputValue("description").trim();
  if (item.requiresQuantity && !quantity) {
    await interaction.reply(v2("Quantidade inválida", "Informe uma quantidade inteira maior que zero.", interaction.guild));
    return;
  }
  if (!amountCents) {
    await interaction.reply(v2("Valor inválido", "Use formatos como `10000`, `10.000,50` ou `R$ 10.000,50`.", interaction.guild));
    return;
  }
  if (item.requiresDescription && !description) {
    await interaction.reply(v2("Observação obrigatória", "Este item exige uma observação.", interaction.guild));
    return;
  }
  const totalAmountCents = item.amountMode === "UNIT_PRICE" && quantity ? amountCents * quantity : amountCents;
  const unitAmountCents = item.amountMode === "UNIT_PRICE" ? amountCents : quantity ? Math.round(totalAmountCents / quantity) : null;
  const balanceAfter = runtime.report.balanceCents - totalAmountCents;
  if (!runtime.config.allowNegativeBalance && balanceAfter < 0) {
    await interaction.reply(v2("❌ Saldo insuficiente", `Saldo atual: **${money(runtime.report.balanceCents)}**\nValor solicitado: **${money(totalAmountCents)}**\nValor faltante: **${money(Math.abs(balanceAfter))}**`, interaction.guild));
    return;
  }
  const member = await interaction.guild!.members.fetch(interaction.user.id);
  const token = Math.random().toString(36).slice(2, 10);
  pending.set(token, {
    channelId: interaction.channelId ?? interaction.channel?.id ?? interaction.guildId!,
    description: description || null,
    expires: Date.now() + CONFIRM_TTL_MS,
    guildId: interaction.guildId!,
    interactionId: interaction.id,
    itemId,
    organizationId: runtime.config.organizationId,
    quantity,
    totalAmountCents,
    unitAmountCents,
    userAvatar: interaction.user.displayAvatarURL({ size: 256 }),
    userDisplayName: member.displayName,
    userId: interaction.user.id
  });
  await interaction.reply(confirmPayload(token, runtime, item, quantity, unitAmountCents, totalAmountCents, balanceAfter, interaction.guild));
}

async function confirmExpense(interaction: ButtonInteraction, context: BotContext, token: string) {
  const row = pending.get(token);
  if (!row || row.expires < Date.now()) {
    await interaction.reply(v2("Confirmação expirada", "Abra o formulário novamente.", interaction.guild));
    return;
  }
  if (row.userId !== interaction.user.id) {
    await interaction.reply(v2("Ação recusada", "Somente quem iniciou o gasto pode confirmar.", interaction.guild));
    return;
  }
  pending.delete(token);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const record = await context.api.registerFivemExpense(interaction.guildId!, row);
  const runtime = await context.api.getFivemExpenseRuntime(interaction.guildId!, row.organizationId);
  await sendExpenseLog(interaction.guild!, runtime.config, record);
  await publishConfiguredExpensePanel(interaction.guild!, context, row.organizationId);
  await interaction.editReply(renderComponentsV2Panel({
    guild: interaction.guild,
    moduleId: "fivem-expenses",
    accentColor: 0x22c55e,
      title: "Gasto registrado",
    description: `**${record.transactionId}**\nCategoria: ${record.itemName} • ${money(record.totalAmountCents)}\nSaldo: ${money(record.balanceBeforeCents)} → ${money(record.balanceAfterCents)}`
  }));
}

async function sendExpenseLog(guild: Guild, config: FivemExpenseConfig, record: FivemExpenseRecord) {
  if (!config.logsChannelId) return;
  const channel = await guild.channels.fetch(config.logsChannelId).catch(() => null);
  if (!channel?.isSendable()) return;
  await channel.send({
    ...renderComponentsV2Panel({
      guild,
      moduleId: "fivem-expenses",
      accentColor: 0xef4444,
      title: "💸 Novo Gasto Registrado",
      description: [
        `**Responsável pelo gasto:** <@${record.userId}> (${record.userDisplayName})`,
        `**Organização:** ${record.organizationName}`,
        `**Categoria:** ${record.itemEmoji ?? ""} ${record.itemName}`.trim(),
        `**Quantidade comprada:** ${record.quantity ?? "Não informada"}`,
        `**Valor unitário:** ${record.unitAmountCents ? money(record.unitAmountCents) : "Não informado"}`,
        `**Valor total gasto:** ${money(record.totalAmountCents)}`,
        `**Motivo da compra:** ${record.description ?? "Sem observação"}`,
        "",
        `**Saldo anterior:** ${money(record.balanceBeforeCents)}`,
        `**Saldo atualizado:** ${money(record.balanceAfterCents)}`,
        `**ID da transação:** ${record.transactionId}`,
        `**ID do caixa:** ${record.cashTransactionId ?? "Não registrado"}`,
        `**Canal de origem:** <#${record.channelId}>`,
        `**Registrado em:** ${date(record.createdAt)}`
      ].join("\n")
    }),
    allowedMentions: { users: [record.userId], roles: [], parse: [] },
    content: `<@${record.userId}>`
  });
}

async function showSummary(interaction: any, runtime: FivemExpenseRuntime, update = false) {
  const report = runtime.report;
  const text = [
    `**Total gasto:** ${money(report.totalCents)}`,
    `**Registros:** ${report.count}`,
    `**Maior gasto:** ${report.biggest ? `${report.biggest.itemName} • ${money(report.biggest.totalAmountCents)}` : "Nenhum"}`,
    `**Último gasto:** ${report.last ? `${report.last.itemName} • ${date(report.last.createdAt)}` : "Nenhum"}`,
    `**Categoria com maior gasto:** ${report.byItem[0]?.itemName ?? "Nenhum"}`,
    `**Saldo atual do caixa:** ${money(report.balanceCents)}`,
    "",
    report.byItem.slice(0, 8).map((item) => `• ${item.itemName}: ${money(item.totalAmountCents)} (${item.count})`).join("\n") || "Sem despesas por categoria."
  ].join("\n");
  const payload = v2(`📊 Resumo de Gastos — ${runtime.config.organizationName}`, text, interaction.guild);
  update ? await interaction.update(payload) : await interaction.reply(payload);
}

function confirmPayload(token: string, runtime: FivemExpenseRuntime, item: FivemExpenseItem, quantity: number | null, unitAmountCents: number | null, totalAmountCents: number, balanceAfter: number, guild: Guild | null) {
  return {
    ...v2("Confirmar registro de gasto", [
      `**Categoria:** ${item.name}`,
      `**Quantidade:** ${quantity ?? "Não informada"}`,
      `**Valor unitário:** ${unitAmountCents ? money(unitAmountCents) : "Não informado"}`,
      `**Valor total:** ${money(totalAmountCents)}`,
      `**Saldo atual:** ${money(runtime.report.balanceCents)}`,
      `**Saldo após:** ${money(balanceAfter)}`
    ].join("\n"), guild),
    components: [{
      type: 17,
      accent_color: 0xef4444,
      components: [
        { type: 10, content: `## Confirmar gasto\n**${item.name}** • ${money(totalAmountCents)}\nSaldo: ${money(runtime.report.balanceCents)} → ${money(balanceAfter)}` },
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:confirm:${token}`).setLabel("Confirmar gasto").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`${PREFIX}:cancel:${token}`).setLabel("Cancelar").setStyle(ButtonStyle.Secondary)
        )
      ]
    }]
  };
}

async function canUse(guild: Guild, userId: string, config: FivemExpenseConfig, admin: boolean) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return false;
  if (config.allowAdministrators && member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const roles = admin ? config.adminRoleIds : [...config.authorizedRoleIds, ...config.adminRoleIds];
  return member.roles.cache.some((role) => roles.includes(role.id));
}

async function denied(interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction | any) {
  await interaction.reply(v2("❌ Acesso negado", "Você não é gerente ou não possui autorização para utilizar este sistema.\n\nPeça para um responsável realizar o seu cadastro ou adicionar um cargo autorizado.", interaction.guild));
}

function rankingText(records: FivemExpenseRecord[], type: string, limit: number) {
  const active = records.filter((record) => record.status === "COMPLETED" && !record.archived);
  const map = new Map<string, { label: string; total: number; count: number }>();
  for (const record of active) {
    const key = type === "users_value" ? record.userId : record.itemId;
    const label = type === "users_value" ? `<@${record.userId}>` : record.itemName;
    const current = map.get(key) ?? { label, total: 0, count: 0 };
    current.total += record.totalAmountCents;
    current.count += 1;
    map.set(key, current);
  }
  const rows = [...map.values()].sort((a, b) => type === "items_count" ? b.count - a.count : b.total - a.total).slice(0, limit);
  return rows.length ? rows.map((row, index) => `**${index + 1}.** ${row.label} — ${money(row.total)} (${row.count})`).join("\n") : "Nenhum gasto registrado.";
}

function v2(title: string, description: string, guild: Guild | null) {
  return { ...renderComponentsV2Panel({ guild, moduleId: "fivem-expenses", accentColor: 0xef4444, title, description }), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral };
}
function color(value: string) { return Number.parseInt(value.replace("#", ""), 16) || 0xef4444; }
function parseQuantity(value: string) { const trimmed = value.trim(); if (!trimmed) return null; const parsed = Number(trimmed); return Number.isInteger(parsed) && parsed > 0 ? parsed : null; }
function parseMoneyToCents(value: string) {
  const cleaned = value.trim().replace(/^R\$\s*/i, "").replace(/\s+/g, "");
  if (!cleaned || /[^\d.,]/.test(cleaned)) return null;
  const separators = [...cleaned.matchAll(/[.,]/g)].map((match) => match.index ?? -1);
  if (!separators.length) return safeCents(cleaned, "00");
  const last = separators[separators.length - 1] ?? -1;
  const before = cleaned.slice(0, last).replace(/[.,]/g, "");
  const after = cleaned.slice(last + 1);
  const decimal = after.length > 0 && after.length <= 2 && (separators.length > 1 || before.length > 3 || cleaned[last] === ",");
  return decimal ? safeCents(before, after.padEnd(2, "0")) : safeCents(cleaned.replace(/[.,]/g, ""), "00");
}
function safeCents(reais: string, cents: string) {
  if (!/^\d+$/.test(reais) || !/^\d{2}$/.test(cents)) return null;
  const value = Number(`${reais}${cents}`);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
function money(cents: number) { return (cents / 100).toLocaleString("pt-BR", { currency: "BRL", style: "currency" }); }
function date(value: string) { return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); }

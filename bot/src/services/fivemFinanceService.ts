import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
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
import type { BotContext } from "../types";
import type { FivemFinanceSettings, FivemFinanceTransaction } from "./apiClient";
import { renderComponentsV2Panel } from "./panelVisualRenderer";
import { systemComponentEmoji, systemEmojiText } from "./systemEmojiService";

const PREFIX = "fivem_finance";
const CONFIRM_TTL_MS = 5 * 60_000;

type FinanceAction = "add" | "remove" | "withdraw" | "history" | "refresh" | "managers";
type PendingTransaction = {
  expires: number;
  guildId: string;
  input: Parameters<BotContext["api"]["createFivemFinanceTransaction"]>[1];
  userId: string;
};

const pending = new Map<string, PendingTransaction>();
const historySearches = new Map<string, string>();

export function startFivemFinanceService(client: Client<true>, context: BotContext) {
  context.socket.onFivemFinancePanelPublish((payload) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void publishConfiguredFinancePanel(guild, context);
  });

  const timer = setInterval(() => {
    for (const [key, value] of pending) {
      if (value.expires < Date.now()) pending.delete(key);
    }
  }, 60_000);
  timer.unref();
}

export async function publishFivemFinancePanel(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Use este comando em um servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  const channelId = await publishConfiguredFinancePanel(interaction.guild, context, interaction.channelId);
  await interaction.reply({
    content: channelId ? `Painel financeiro publicado em <#${channelId}>.` : "Configure e ative o financeiro antes de publicar.",
    flags: MessageFlags.Ephemeral
  });
}

export async function showFivemFinanceBalance(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const runtime = await context.api.getFivemFinanceRuntime(interaction.guild.id);
  await interaction.reply(v2Ephemeral("Saldo financeiro", summary(runtime.settings, runtime.transactions), interaction.guild));
}

export async function handleFivemFinanceInteraction(interaction: Interaction, context: BotContext) {
  if (!("customId" in interaction) || !interaction.customId.startsWith(`${PREFIX}:`)) return false;
  if (!interaction.guild) return true;

  const [, action, arg] = interaction.customId.split(":");
  const runtime = await context.api.getFivemFinanceRuntime(interaction.guild.id);

  if (interaction.isButton() && isTransactionAction(action)) {
    if (!(await canUseAction(interaction.guild, interaction.user.id, runtime.settings, action))) {
      await denied(interaction, context);
      return true;
    }
    await showTransactionModal(interaction, action, runtime.settings);
    return true;
  }

  if (interaction.isModalSubmit() && isTransactionModalAction(action)) {
    const type = action.replace("_modal", "") as "add" | "remove" | "withdraw";
    if (!(await canUseAction(interaction.guild, interaction.user.id, runtime.settings, type))) {
      await denied(interaction, context);
      return true;
    }
    await submitModal(interaction, context, runtime.settings, type);
    return true;
  }

  if (interaction.isButton() && action === "confirm") {
    await confirmPending(interaction, context, arg ?? "");
    return true;
  }

  if (interaction.isButton() && action === "cancel_pending") {
    const row = pending.get(arg ?? "");
    if (row && row.userId !== interaction.user.id) {
      await interaction.reply(v2Ephemeral("Ação recusada", "Somente quem iniciou a operação pode cancelar esta confirmação.", interaction.guild));
      return true;
    }
    pending.delete(arg ?? "");
    await interaction.update(v2Ephemeral("Operação cancelada", "Nenhuma movimentação foi registrada.", interaction.guild));
    return true;
  }

  if (interaction.isButton() && action === "history") {
    if (!(await canUseAction(interaction.guild, interaction.user.id, runtime.settings, "history"))) {
      await denied(interaction, context);
      return true;
    }
    await showHistory(interaction, runtime.transactions, runtime.settings, 0, "all", "all");
    return true;
  }

  if (interaction.isButton() && action === "history_search") {
    await interaction.showModal(new ModalBuilder()
      .setCustomId(`${PREFIX}:history_search_modal`)
      .setTitle("Pesquisar histórico")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("query")
          .setLabel("Usuário, ID, valor, motivo ou transação")
          .setRequired(false)
          .setStyle(TextInputStyle.Short)
          .setMaxLength(100)
      )));
    return true;
  }

  if (interaction.isModalSubmit() && action === "history_search_modal") {
    historySearches.set(`${interaction.guildId}:${interaction.user.id}`, interaction.fields.getTextInputValue("query").trim().toLowerCase());
    await showHistory(interaction, runtime.transactions, runtime.settings, 0, "all", "all");
    return true;
  }

  if (interaction.isStringSelectMenu() && action === "history_filter") {
    const [type = "all", period = "all"] = (interaction.values[0] ?? "all_all").split("_");
    await showHistory(interaction, runtime.transactions, runtime.settings, 0, type, period, true);
    return true;
  }

  if (interaction.isButton() && action === "history_page") {
    const [page = "0", type = "all", period = "all"] = (arg ?? "0-all-all").split("-");
    await showHistory(interaction, runtime.transactions, runtime.settings, Number(page), type, period, true);
    return true;
  }

  if (interaction.isButton() && action === "managers") {
    if (!(await canUseAction(interaction.guild, interaction.user.id, runtime.settings, "managers"))) {
      await denied(interaction, context);
      return true;
    }
    await showManagers(interaction, runtime.transactions);
    return true;
  }

  if (interaction.isButton() && action === "refresh") {
    if (!(await canUseAction(interaction.guild, interaction.user.id, runtime.settings, "refresh"))) {
      await denied(interaction, context);
      return true;
    }
    await publishConfiguredFinancePanel(interaction.guild, context);
    await interaction.reply(v2Ephemeral("Painel atualizado", "Os dados financeiros foram sincronizados.", interaction.guild));
    return true;
  }

  return false;
}

async function publishConfiguredFinancePanel(guild: Guild, context: BotContext, fallback?: string | null) {
  const runtime = await context.api.getFivemFinanceRuntime(guild.id);
  const settings = runtime.settings;
  if (!settings.enabled) return null;

  const channelId = settings.panelChannelId ?? fallback;
  if (!channelId) return null;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) return null;

  const payload = mainPanel(settings, runtime.transactions, guild);
  const oldMessage = settings.panelMessageId && "messages" in channel
    ? await channel.messages.fetch(settings.panelMessageId).catch(() => null)
    : null;

  if (oldMessage) {
    await oldMessage.edit(payload);
  } else {
    const message = await channel.send(payload);
    await context.api.updateFivemFinancePanelState(guild.id, message.id);
  }

  return channel.id;
}

function mainPanel(settings: FivemFinanceSettings, transactions: FivemFinanceTransaction[], guild: Guild) {
  const active = activeTransactions(transactions);
  const totals = financeTotals(settings, active);
  const last = active[0] ?? null;
  const factionName = settings.factionName?.trim() || "Caixa da Facção";
  const lastMovement = last
    ? `${transactionTypeName(last.type)} • ${money(last.amount)} • ${last.managerName ?? last.username} • ${date(last.createdAt)}`
    : "Nenhuma movimentação registrada";

  return renderComponentsV2Panel({
    guild,
    moduleId: "fivem-finance",
    accentColor: color(settings.color),
    title: `${systemEmojiText("dinheiro", guild)} ${settings.panelTitle || "Sistema Financeiro"}`,
    description: [
      `## ${systemEmojiText("caixa", guild)} ${factionName}`,
      settings.panelDescription,
      "",
      `**Saldo atual:** ${money(totals.balance)}`,
      `**Total de entradas:** ${money(totals.totalIn)}`,
      `**Total de saídas:** ${money(totals.totalOut)}`,
      `**Movimentações realizadas:** ${totals.count}`,
      `**Última movimentação:** ${lastMovement}`
    ].filter(Boolean).join("\n"),
    image: settings.bannerMode === "none" ? null : settings.panelImage,
    actions: [createFinancePanelActionRow(guild)]
  });
}

export function createFinancePanelActionRow(guild: Guild | null = null) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:add`).setLabel("Adicionar dinheiro").setEmoji(systemComponentEmoji("dinheiro", guild)).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}:remove`).setLabel("Remover dinheiro").setEmoji(systemComponentEmoji("porta", guild)).setStyle(ButtonStyle.Danger)
  );
}

async function showTransactionModal(interaction: ButtonInteraction, type: "add" | "remove" | "withdraw", settings: FivemFinanceSettings) {
  const title = type === "add" ? "Adicionar dinheiro" : type === "withdraw" ? "Sacar dinheiro" : "Remover dinheiro";
  const amountLabel = type === "withdraw" ? "Quantidade sacada" : "Valor";
  const reasonLabel = type === "add" ? "Descrição ou motivo da entrada" : type === "withdraw" ? "Motivo do saque" : "Descrição ou motivo da retirada";
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:${type}_modal`)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("amount")
          .setLabel(amountLabel)
          .setPlaceholder("Ex: 5000")
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
          .setMaxLength(120)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel(reasonLabel)
          .setPlaceholder("Ex: Compras para a facção")
          .setRequired(settings.requireReason)
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(4000)
      )
    );

  await interaction.showModal(modal);
}

async function submitModal(interaction: ModalSubmitInteraction, context: BotContext, settings: FivemFinanceSettings, type: "add" | "remove" | "withdraw") {
  const amountCents = parseMoneyToCents(interaction.fields.getTextInputValue("amount"));
  const reason = interaction.fields.getTextInputValue("reason").trim();

  if (!amountCents || amountCents <= 0) {
    await interaction.reply(v2Ephemeral("Valor inválido", "Informe um valor maior que zero. Exemplos válidos: 5000, 5.000, 5,000 ou R$ 5000.", interaction.guild));
    return;
  }

  if (amountCents > reaisToCents(settings.maxTransactionAmount)) {
    await interaction.reply(v2Ephemeral("Valor acima do limite", `O valor não pode ultrapassar ${money(settings.maxTransactionAmount)}.`, interaction.guild));
    return;
  }

  const latestRuntime = await context.api.getFivemFinanceRuntime(interaction.guildId!);
  const currentBalance = financeTotals(latestRuntime.settings, activeTransactions(latestRuntime.transactions)).balance;
  const amount = centsToReais(amountCents);

  if (type !== "add" && !settings.allowNegativeBalance && currentBalance - amount < 0) {
    await sendRefusedLog(interaction.guild!, latestRuntime.settings, type, amount, currentBalance, reason, interaction.user.id, context);
    await interaction.reply(v2Ephemeral("Saldo insuficiente", `**Saldo disponível:** ${money(currentBalance)}\n**Valor solicitado:** ${money(amount)}`, interaction.guild));
    return;
  }

  const member = await interaction.guild!.members.fetch(interaction.user.id);
  const input = {
    amount,
    amountCents,
    factionId: settings.factionId,
    factionName: settings.factionName,
    proofImageUrl: "",
    type,
    userId: interaction.user.id,
    username: member.displayName,
    managerId: interaction.user.id,
    managerName: member.displayName,
    metadata: responsibleRoleMetadata(member, settings),
    personName: member.displayName,
    targetUserId: interaction.user.id,
    reason,
    userAvatar: interaction.user.displayAvatarURL({ size: 256 })
  };

  const requiresConfirmation = type === "withdraw" ? settings.confirmWithdraw !== false : type === "remove" ? settings.confirmRemove !== false : settings.confirmAdd === true;
  if (requiresConfirmation) {
    const token = Math.random().toString(36).slice(2, 10);
    pending.set(token, { guildId: interaction.guildId!, input, userId: interaction.user.id, expires: Date.now() + CONFIRM_TTL_MS });
    await interaction.reply(confirmPayload(type, amount, reason, currentBalance, token, interaction.guild));
    return;
  }

  await execute(interaction, context, input);
}

async function confirmPending(interaction: ButtonInteraction, context: BotContext, token: string) {
  const row = pending.get(token);
  if (!row || row.expires < Date.now()) {
    await interaction.reply(v2Ephemeral("Confirmação expirada", "Abra o modal novamente.", interaction.guild));
    return;
  }
  if (row.userId !== interaction.user.id) {
    await interaction.reply(v2Ephemeral("Ação recusada", "Somente quem iniciou a operação pode confirmar esta movimentação.", interaction.guild));
    return;
  }
  pending.delete(token);
  await execute(interaction, context, row.input);
}

async function execute(interaction: ButtonInteraction | ModalSubmitInteraction, context: BotContext, input: PendingTransaction["input"]) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const transaction = await context.api.createFivemFinanceTransaction(interaction.guildId!, input);
  const runtime = await context.api.getFivemFinanceRuntime(interaction.guildId!);
  await sendLog(interaction.guild!, runtime.settings, transaction, context);
  await publishConfiguredFinancePanel(interaction.guild!, context);
  await interaction.editReply(renderComponentsV2Panel({
    guild: interaction.guild,
    moduleId: "fivem-finance",
    accentColor: transaction.type === "add" ? 0x22c55e : transaction.type === "withdraw" ? 0xf59e0b : 0xef4444,
    title: transaction.type === "withdraw" ? "Saque realizado" : "Movimentação concluída",
    description: `**${transaction.transactionId}**\n${money(transaction.oldBalance)} → ${money(transaction.newBalance)}\nPainel, histórico e estatísticas atualizados.`
  }));
}

async function sendLog(guild: Guild, settings: FivemFinanceSettings, transaction: FivemFinanceTransaction, context: BotContext) {
  if (!settings.logChannelId) return;
  const channel = await guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel?.isSendable()) return;

  const roleName = typeof transaction.metadata?.responsibleRoleName === "string" ? transaction.metadata.responsibleRoleName : "Cargo não identificado";
  const sent = await channel.send(renderComponentsV2Panel({
    guild,
    moduleId: "fivem-finance",
    accentColor: transaction.type === "add" ? 0x22c55e : transaction.type === "withdraw" ? 0xf59e0b : 0xef4444,
    title: `${transactionIcon(transaction.type, guild)} ${transactionTypeName(transaction.type)}`,
    description: [
      `**Tipo:** ${transactionTypeName(transaction.type)}`,
      `**Facção:** ${transaction.factionName ?? settings.factionName ?? "Caixa da Facção"}`,
      `**Valor anterior:** ${money(transaction.oldBalance)}`,
      `**Valor movimentado:** ${money(transaction.amount)}`,
      `**Novo saldo:** ${money(transaction.newBalance)}`,
      `**Motivo:** ${transaction.reason ?? transaction.notes ?? "Sem motivo informado"}`,
      `**Responsável:** <@${transaction.managerId ?? transaction.userId}> (${transaction.managerName ?? transaction.username})`,
      `**Cargo:** ${roleName}`,
      `**ID do usuário:** ${transaction.managerId ?? transaction.userId}`,
      `**Data e horário:** ${date(transaction.createdAt)}`,
      `**ID da movimentação:** ${transaction.transactionId}`
    ].join("\n")
  }));

  await context.api.updateFivemFinanceTransactionLog(guild.id, transaction.id, { logChannelId: settings.logChannelId, logMessageId: sent.id }).catch(() => null);
}

async function sendRefusedLog(guild: Guild, settings: FivemFinanceSettings, type: "remove" | "withdraw", amount: number, balance: number, reason: string, userId: string, context: BotContext) {
  await context.api.postLog({
    guildId: guild.id,
    userId,
    executorId: userId,
    module: "fivem-finance",
    action: `${type}.refused`,
    type: "fivem.finance.refused",
    message: "Tentativa recusada por saldo insuficiente.",
    metadata: { amount, balance, factionId: settings.factionId, reason }
  }).catch(() => null);

  if (!settings.logChannelId) return;
  const channel = await guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel?.isSendable()) return;
  await channel.send(renderComponentsV2Panel({
    guild,
    moduleId: "fivem-finance",
    accentColor: 0xef4444,
    title: `${systemEmojiText("perigo", guild)} Operação recusada`,
    description: `**Tipo:** ${transactionTypeName(type)}\n**Facção:** ${settings.factionName ?? "Caixa da Facção"}\n**Valor solicitado:** ${money(amount)}\n**Saldo disponível:** ${money(balance)}\n**Motivo:** ${reason || "Sem motivo informado"}\n**Usuário:** <@${userId}>`
  })).catch(() => null);
}

async function showHistory(interaction: any, all: FivemFinanceTransaction[], settings: FivemFinanceSettings, page: number, type: string, period: string, update = false) {
  const query = historySearches.get(`${interaction.guildId}:${interaction.user.id}`) ?? "";
  let rows = activeTransactions(all).filter((item) => type === "all" || item.type === type);
  if (query) {
    rows = rows.filter((item) => `${item.transactionId} ${item.managerName ?? item.username} ${item.managerId ?? item.userId} ${item.targetUserId ?? ""} ${item.amount} ${item.reason ?? item.notes ?? ""}`.toLowerCase().includes(query));
  }

  const days = period === "24h" ? 1 : period === "7d" ? 7 : period === "30d" ? 30 : 0;
  if (days) rows = rows.filter((item) => Date.now() - new Date(item.createdAt).getTime() <= days * 86_400_000);

  const size = settings.historyPageSize;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const safePage = Math.min(Math.max(page, 0), pages - 1);
  const slice = rows.slice(safePage * size, (safePage + 1) * size);
  const filter = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:history_filter`)
    .setPlaceholder("Filtrar histórico")
    .addOptions([
      { label: "Todos", value: "all_all" },
      { label: "Apenas entradas", value: "add_all" },
      { label: "Apenas retiradas", value: "remove_all" },
      { label: "Apenas saques", value: "withdraw_all" },
      { label: "Últimas 24 horas", value: "all_24h" },
      { label: "Últimos 7 dias", value: "all_7d" },
      { label: "Últimos 30 dias", value: "all_30d" }
    ]));
  const nav = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:history_page:${safePage - 1}-${type}-${period}`).setLabel("Anterior").setStyle(ButtonStyle.Secondary).setDisabled(safePage === 0),
    new ButtonBuilder().setCustomId(`${PREFIX}:history_search`).setLabel(query ? `Busca: ${query.slice(0, 20)}` : "Pesquisar").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}:history_page:${safePage + 1}-${type}-${period}`).setLabel("Próxima").setStyle(ButtonStyle.Secondary).setDisabled(safePage >= pages - 1)
  );
  const payload = renderComponentsV2Panel({
    guild: interaction.guild,
    moduleId: "fivem-finance",
    accentColor: 0x22c55e,
    title: `${systemEmojiText("prancheta_acertos", interaction.guild)} Histórico • ${safePage + 1}/${pages}`,
    description: slice.length ? slice.map((item) => [
      `${transactionIcon(item.type, interaction.guild)} ${transactionTypeName(item.type)} • **${money(item.amount)}**`,
      `Responsável: ${item.managerName ?? item.username} (${item.managerId ?? item.userId})`,
      `Motivo: ${item.reason ?? item.notes ?? "Sem motivo informado"}`,
      `Saldo depois: ${money(item.newBalance)}`,
      `ID: ${item.transactionId}`,
      date(item.createdAt)
    ].join("\n")).join("\n\n") : "Nenhuma movimentação encontrada.",
    actions: [filter, nav]
  });
  const out = { ...payload, flags: Number(payload.flags) | MessageFlags.Ephemeral };
  update ? await interaction.update(out) : await interaction.reply(out);
}

async function showManagers(interaction: any, all: FivemFinanceTransaction[]) {
  const map = new Map<string, { add: number; count: number; last: string; name: string; remove: number; withdraw: number }>();
  for (const item of activeTransactions(all)) {
    const id = item.managerId ?? item.userId;
    const current = map.get(id) ?? { add: 0, count: 0, last: item.createdAt, name: item.managerName ?? item.username, remove: 0, withdraw: 0 };
    current[item.type] += item.amount;
    current.count += 1;
    if (item.createdAt > current.last) current.last = item.createdAt;
    map.set(id, current);
  }
  const rows = [...map].sort((a, b) => (b[1].add + b[1].remove + b[1].withdraw) - (a[1].add + a[1].remove + a[1].withdraw));
  await interaction.reply(v2Ephemeral(
    `${systemEmojiText("homem", interaction.guild)} Responsáveis`,
    rows.length ? rows.map(([id, value], index) => `**${index + 1}. ${value.name}** • ${id}\nEntradas: ${money(value.add)} • Retiradas: ${money(value.remove)} • Saques: ${money(value.withdraw)}\nOperações: ${value.count}\nÚltima: ${date(value.last)}`).join("\n\n") : "Nenhuma movimentação registrada.",
    interaction.guild
  ));
}

async function canUseAction(guild: Guild, userId: string, settings: FivemFinanceSettings, action: FinanceAction) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  const actionRoles = action === "add"
    ? settings.addRoleIds ?? []
    : action === "remove"
      ? settings.removeRoleIds ?? []
      : action === "withdraw"
        ? settings.withdrawRoleIds ?? []
        : action === "history"
          ? settings.historyRoleIds ?? []
          : settings.viewerRoleIds ?? [];
  const fallbackRoles = [...(settings.useRoleIds ?? []), ...(settings.adminRoleIds ?? [])];
  const allowed = new Set([...actionRoles, ...fallbackRoles]);
  return member.roles.cache.some((role) => allowed.has(role.id));
}

async function denied(interaction: any, context: BotContext) {
  await context.api.postLog({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    executorId: interaction.user.id,
    module: "fivem-finance",
    action: "access.denied",
    type: "security",
    message: "Tentativa sem permissão no sistema financeiro"
  }).catch(() => null);
  await interaction.reply(v2Ephemeral("Acesso negado", "Seu cargo não possui permissão para usar esta ação do Financeiro.", interaction.guild));
}

function confirmPayload(type: "add" | "remove" | "withdraw", amount: number, reason: string, balance: number, token: string, guild: Guild | null) {
  const nextBalance = type === "add" ? balance + amount : balance - amount;
  return {
    ...v2Ephemeral(
      type === "withdraw" ? "Confirmar saque" : "Confirmar movimentação",
      `**Tipo:** ${transactionTypeName(type)}\n**Valor:** ${money(amount)}\n**Motivo:** ${reason || "Sem motivo informado"}\n**Saldo atual:** ${money(balance)}\n**Saldo após:** ${money(nextBalance)}`,
      guild
    ),
    components: [{
      type: 17,
      accent_color: type === "add" ? 0x22c55e : type === "withdraw" ? 0xf59e0b : 0xef4444,
      components: [
        {
          type: 10,
          content: `## ${type === "withdraw" ? "Confirmar saque" : "Confirmar movimentação"}\n**Valor:** ${money(amount)}\n**Saldo atual:** ${money(balance)}\n**Saldo após:** ${money(nextBalance)}`
        },
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:confirm:${token}`).setLabel(type === "withdraw" ? "Confirmar saque" : "Confirmar").setStyle(type === "add" ? ButtonStyle.Success : ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`${PREFIX}:cancel_pending:${token}`).setLabel("Cancelar").setStyle(ButtonStyle.Secondary)
        )
      ]
    }]
  };
}

function responsibleRoleMetadata(member: GuildMember, settings: FivemFinanceSettings) {
  const role = identifyResponsibleRole(member, settings);
  return {
    responsibleRoleId: role?.id ?? null,
    responsibleRoleName: role?.name ?? "Cargo não identificado"
  };
}

function identifyResponsibleRole(member: GuildMember, settings: FivemFinanceSettings) {
  if (settings.factionRoleId && member.roles.cache.has(settings.factionRoleId)) return member.roles.cache.get(settings.factionRoleId) ?? null;
  if (settings.defaultOperationRoleId && member.roles.cache.has(settings.defaultOperationRoleId)) return member.roles.cache.get(settings.defaultOperationRoleId) ?? null;
  return member.roles.cache
    .filter((role) => role.id !== member.guild.id && !role.managed)
    .sort((left, right) => right.position - left.position)
    .first() ?? null;
}

function summary(settings: FivemFinanceSettings, transactions: FivemFinanceTransaction[]) {
  const totals = financeTotals(settings, activeTransactions(transactions));
  return `**Facção:** ${settings.factionName ?? "Caixa da Facção"}\n**Saldo:** ${money(totals.balance)}\n**Entradas:** ${money(totals.totalIn)}\n**Saídas:** ${money(totals.totalOut)}\n**Movimentações:** ${totals.count}`;
}

function activeTransactions(transactions: FivemFinanceTransaction[]) {
  return transactions.filter((item) => item.status !== "cancelled");
}

function financeTotals(settings: FivemFinanceSettings, transactions: FivemFinanceTransaction[]) {
  const balanceFromSettings = typeof settings.balanceCents === "number" ? centsToReais(settings.balanceCents) : null;
  const totalInFromSettings = typeof settings.totalInCents === "number" ? centsToReais(settings.totalInCents) : null;
  const totalOutFromSettings = typeof settings.totalOutCents === "number" ? centsToReais(settings.totalOutCents) : null;
  const countFromSettings = typeof settings.transactionCount === "number" ? settings.transactionCount : null;
  const totalIn = totalInFromSettings ?? transactions.filter((item) => item.type === "add").reduce((sum, item) => sum + item.amount, 0);
  const totalOut = totalOutFromSettings ?? transactions.filter((item) => item.type !== "add").reduce((sum, item) => sum + item.amount, 0);
  return {
    balance: balanceFromSettings ?? totalIn - totalOut,
    count: countFromSettings ?? transactions.length,
    totalIn,
    totalOut
  };
}

function transactionIcon(type: "add" | "remove" | "withdraw", guild: Guild | null) {
  if (type === "add") return systemEmojiText("dinheiro", guild);
  if (type === "withdraw") return systemEmojiText("caixa", guild);
  return systemEmojiText("porta", guild);
}

function transactionTypeName(type: "add" | "remove" | "withdraw") {
  if (type === "add") return "Entrada de dinheiro";
  if (type === "withdraw") return "Saque";
  return "Saída de dinheiro";
}

function v2Ephemeral(title: string, description: string, guild?: Guild | null) {
  return {
    ...renderComponentsV2Panel({ guild, moduleId: "fivem-finance", accentColor: 0x22c55e, title, description }),
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
  };
}

function isTransactionAction(value: string | undefined): value is "add" | "remove" | "withdraw" {
  return value === "add" || value === "remove" || value === "withdraw";
}

function isTransactionModalAction(value: string | undefined): value is "add_modal" | "remove_modal" | "withdraw_modal" {
  return value === "add_modal" || value === "remove_modal" || value === "withdraw_modal";
}

function parseMoneyToCents(value: string) {
  const cleaned = value.trim().replace(/^R\$\s*/i, "").replace(/\s+/g, "");
  if (!cleaned || /[^\d.,]/.test(cleaned)) return null;

  const separators = [...cleaned.matchAll(/[.,]/g)].map((match) => match.index ?? -1);
  if (!separators.length) return safeCents(cleaned, "00");

  const lastSeparator = separators[separators.length - 1] ?? -1;
  if (lastSeparator < 0) return safeCents(cleaned.replace(/[.,]/g, ""), "00");
  const before = cleaned.slice(0, lastSeparator).replace(/[.,]/g, "");
  const after = cleaned.slice(lastSeparator + 1);
  const hasDecimalCents = after.length > 0 && after.length <= 2 && (separators.length > 1 || before.length > 3 || cleaned[lastSeparator] === ",");
  if (hasDecimalCents) return safeCents(before, after.padEnd(2, "0"));

  return safeCents(cleaned.replace(/[.,]/g, ""), "00");
}

function safeCents(reais: string, cents: string) {
  if (!/^\d+$/.test(reais) || !/^\d{2}$/.test(cents)) return null;
  const value = Number(`${reais}${cents}`);
  return Number.isSafeInteger(value) && Number.isFinite(value) ? value : null;
}

function reaisToCents(value: number) {
  return Math.round(value * 100);
}

function centsToReais(value: number) {
  return Math.round(value) / 100;
}

function money(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function date(value: string) {
  return new Date(value).toLocaleString("pt-BR");
}

function color(value: string) {
  return Number.parseInt(value.replace("#", ""), 16) || 0x22c55e;
}

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type Interaction,
  type Message,
  type ModalSubmitInteraction
} from "discord.js";
import type { BotContext } from "../types";
import type { FivemFinanceSettings } from "./apiClient";
import { renderComponentsV2Panel } from "./panelVisualRenderer";

const PREFIX = "fivem_finance";
const sessions = new Map<string, { amount: number | null; openerId: string; proofMessageId: string | null; proofUrl: string | null; type: "add" | "remove" }>();

export function startFivemFinanceService(client: Client<true>, context: BotContext) {
  context.socket.onFivemFinancePanelPublish((payload) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void publishConfiguredFinancePanel(guild, context);
  });
  client.on("messageCreate", (message) => void captureProof(message));
}

export async function publishFivemFinancePanel(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) return interaction.reply({ content: "Use este comando em um servidor.", ephemeral: true });
  const result = await publishConfiguredFinancePanel(interaction.guild, context, interaction.channelId);
  await interaction.reply({ content: result ? `Painel financeiro publicado em <#${result}>.` : "Configure e ative o financeiro antes de publicar.", ephemeral: true });
}

export async function showFivemFinanceBalance(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const runtime = await context.api.getFivemFinanceRuntime(interaction.guild.id);
  if (!runtime.settings.enabled || !runtime.settings.allowBalanceQuery) return interaction.reply({ content: "Consulta de saldo indisponivel.", ephemeral: true });
  const report = buildReport(runtime.transactions);
  await interaction.reply({ content: `**Saldo atual:** ${money(report.balance)}\n**Entradas:** ${money(report.totalIn)}\n**Saidas:** ${money(report.totalOut)}\n**Ultima movimentacao:** ${runtime.transactions[0]?.createdAt ? new Date(runtime.transactions[0].createdAt).toLocaleString("pt-BR") : "nenhuma"}`, ephemeral: true });
}

export async function handleFivemFinanceInteraction(interaction: Interaction, context: BotContext) {
  if (!("customId" in interaction) || !interaction.customId.startsWith(`${PREFIX}:`)) return false;
  if (interaction.isButton() && interaction.customId === `${PREFIX}:add`) { await startTransaction(interaction, context, "add"); return true; }
  if (interaction.isButton() && interaction.customId === `${PREFIX}:remove`) { await startTransaction(interaction, context, "remove"); return true; }
  if (interaction.isButton() && interaction.customId === `${PREFIX}:balance`) { await showBalanceButton(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId === `${PREFIX}:amount`) { await showAmountModal(interaction); return true; }
  if (interaction.isModalSubmit() && interaction.customId === `${PREFIX}:amount_modal`) { await saveAmount(interaction); return true; }
  if (interaction.isButton() && interaction.customId === `${PREFIX}:finish`) { await finishTransaction(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId === `${PREFIX}:close`) { await interaction.channel?.delete("Canal financeiro fechado").catch(() => null); return true; }
  return false;
}

async function publishConfiguredFinancePanel(guild: Guild, context: BotContext, fallbackChannelId?: string | null) {
  const { settings } = await context.api.getFivemFinanceRuntime(guild.id);
  if (!settings.enabled) return null;
  const channelId = settings.panelChannelId ?? fallbackChannelId ?? null;
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) return null;
  const payload = createMainPanel(settings, buildReport((await context.api.getFivemFinanceRuntime(guild.id)).transactions).balance);
  let message = settings.panelMessageId && "messages" in channel ? await channel.messages.fetch(settings.panelMessageId).catch(() => null) : null;
  if (message) await message.edit(payload).catch(() => null); else message = await channel.send(payload);
  await context.api.updateFivemFinancePanelState(guild.id, message.id);
  return channel.id;
}

function createMainPanel(settings: FivemFinanceSettings, balance: number) {
  const rows = [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:add`).setLabel("Adicionar dinheiro").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}:remove`).setLabel("Retirar dinheiro").setStyle(ButtonStyle.Danger),
    ...(settings.allowBalanceQuery ? [new ButtonBuilder().setCustomId(`${PREFIX}:balance`).setLabel("Consultar saldo").setStyle(ButtonStyle.Secondary)] : [])
  )];
  return renderComponentsV2Panel({ accentColor: parseColor(settings.color), actions: rows, description: settings.panelDescription, fields: [`**Saldo atual:** ${money(balance)}`, "**Regras obrigatorias**\n- Envie sempre uma imagem do comprovante.\n- Informe o valor correto.\n- Todas as movimentacoes sao registradas automaticamente."], image: settings.bannerMode === "none" ? null : settings.panelImage, moduleId: "fivem-finance", title: settings.panelTitle });
}

async function startTransaction(interaction: ButtonInteraction, context: BotContext, type: "add" | "remove") {
  if (!interaction.guild) return;
  const runtime = await context.api.getFivemFinanceRuntime(interaction.guild.id);
  if (!runtime.settings.enabled) return interaction.reply({ content: "Sistema financeiro desativado.", ephemeral: true });
  if (!(await canUse(interaction.guild, interaction.user.id, runtime.settings))) return interaction.reply({ content: "Voce nao possui permissao para usar o financeiro.", ephemeral: true });
  const channel = await createTempChannel(interaction.guild, interaction.user.id, runtime.settings, type);
  sessions.set(channel.id, { amount: null, openerId: interaction.user.id, proofMessageId: null, proofUrl: null, type });
  await channel.send(tempPanel(type, interaction.user.id));
  setTimeout(() => { if (sessions.has(channel.id)) void channel.delete("Financeiro expirado").catch(() => null); sessions.delete(channel.id); }, Math.max(1, runtime.settings.autoCloseMinutes) * 60_000).unref();
  await interaction.reply({ content: `Canal financeiro criado: <#${channel.id}>`, ephemeral: true });
}

async function createTempChannel(guild: Guild, userId: string, settings: FivemFinanceSettings, type: "add" | "remove") {
  const member = await guild.members.fetch(userId);
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] },
    { id: guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
    ...settings.adminRoleIds.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))
  ];
  return guild.channels.create({ name: `financeiro-${type === "add" ? "add" : "retirar"}-${slug(member.displayName)}`.slice(0, 90), parent: settings.tempCategoryId ?? undefined, permissionOverwrites: overwrites, type: ChannelType.GuildText });
}

function tempPanel(type: "add" | "remove", userId: string) {
  const action = type === "add" ? "entrada/adicionar dinheiro" : "saida/retirar dinheiro";
  return { components: [{ type: 17, accent_color: type === "add" ? 0x22c55e : 0xef4444, components: [{ type: 10, content: `# Registro financeiro\n**Tipo:** ${action}\n**Usuario:** <@${userId}>\n\nInforme o valor pelo botao abaixo e envie uma imagem do comprovante neste canal. O registro so finaliza quando houver valor e imagem.` }, new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:amount`).setLabel("Informar valor").setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`${PREFIX}:finish`).setLabel("Finalizar registro").setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`${PREFIX}:close`).setLabel("Fechar canal").setStyle(ButtonStyle.Secondary))] }], flags: MessageFlags.IsComponentsV2 as const };
}

async function showAmountModal(interaction: ButtonInteraction) {
  const modal = new ModalBuilder().setCustomId(`${PREFIX}:amount_modal`).setTitle("Valor da movimentacao");
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("amount").setLabel("Valor").setPlaceholder("Ex: 150000").setRequired(true).setStyle(TextInputStyle.Short)));
  await interaction.showModal(modal);
}

async function saveAmount(interaction: ModalSubmitInteraction) {
  const session = interaction.channelId ? sessions.get(interaction.channelId) : null;
  if (!session) return interaction.reply({ content: "Sessao financeira nao encontrada.", ephemeral: true });
  if (interaction.user.id !== session.openerId) return interaction.reply({ content: "Apenas quem abriu o registro pode informar o valor.", ephemeral: true });
  const amount = parseMoney(interaction.fields.getTextInputValue("amount"));
  if (!amount || amount <= 0) return interaction.reply({ content: "Informe um valor numerico valido.", ephemeral: true });
  session.amount = amount;
  await interaction.reply({ content: `Valor registrado: ${money(amount)}. Agora envie a imagem do comprovante e finalize.`, ephemeral: true });
}

async function captureProof(message: Message) {
  if (!message.guild || message.author.bot) return;
  const session = sessions.get(message.channelId);
  if (!session || message.author.id !== session.openerId) return;
  const attachment = message.attachments.find((item) => item.contentType?.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(item.url));
  if (!attachment) return;
  session.proofUrl = attachment.url;
  session.proofMessageId = message.id;
  await message.react("✅").catch(() => null);
}

async function finishTransaction(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild || !interaction.channelId) return;
  const session = sessions.get(interaction.channelId);
  if (!session) return interaction.reply({ content: "Sessao financeira nao encontrada.", ephemeral: true });
  const runtime = await context.api.getFivemFinanceRuntime(interaction.guild.id);
  const admin = await canAdmin(interaction.guild, interaction.user.id, runtime.settings);
  if (interaction.user.id !== session.openerId && !admin) return interaction.reply({ content: "Voce nao pode finalizar o registro de outro usuario.", ephemeral: true });
  if (!session.amount || session.amount <= 0) return interaction.reply({ content: "Informe o valor antes de finalizar este registro.", ephemeral: true });
  if (!session.proofUrl) return interaction.reply({ content: "Voce precisa enviar uma imagem de comprovante antes de finalizar este registro.", ephemeral: true });
  await interaction.deferReply({ ephemeral: true });
  const transaction = await context.api.createFivemFinanceTransaction(interaction.guild.id, { amount: session.amount, proofImageUrl: session.proofUrl, proofMessageId: session.proofMessageId, tempChannelId: interaction.channelId, type: session.type, userAvatar: interaction.user.displayAvatarURL({ size: 256 }), userId: session.openerId, username: interaction.user.username });
  const logMessage = await sendFinanceLog(interaction.guild, runtime.settings, transaction);
  if (logMessage) await context.api.updateFivemFinanceTransactionLog(interaction.guild.id, transaction.id, { logChannelId: logMessage.channelId, logMessageId: logMessage.id }).catch(() => null);
  sessions.delete(interaction.channelId);
  await interaction.editReply({ content: `Movimentacao registrada: ${transaction.transactionId}` });
  setTimeout(() => void interaction.channel?.delete("Financeiro finalizado").catch(() => null), 5000).unref();
}

async function sendFinanceLog(guild: Guild, settings: FivemFinanceSettings, transaction: Awaited<ReturnType<BotContext["api"]["createFivemFinanceTransaction"]>>) {
  if (!settings.logChannelId) return null;
  const channel = await guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!(channel instanceof TextChannel)) return null;
  const embed = new EmbedBuilder().setColor(transaction.type === "add" ? 0x22c55e : 0xef4444).setTitle(transaction.type === "add" ? "Entrada financeira" : "Saida financeira").setDescription(`Movimentacao **${transaction.transactionId}** registrada.`).addFields({ name: "Usuario", value: `<@${transaction.userId}>\n${transaction.userId}`, inline: true }, { name: "Valor", value: money(transaction.amount), inline: true }, { name: "Saldo", value: `${money(transaction.oldBalance)} -> ${money(transaction.newBalance)}`, inline: true }, { name: "Status", value: transaction.status, inline: true }, { name: "Comprovante", value: `[Abrir imagem](${transaction.proofImageUrl})`, inline: true }).setImage(transaction.proofImageUrl).setTimestamp(new Date(transaction.createdAt));
  return channel.send({ embeds: [embed] });
}

async function showBalanceButton(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const runtime = await context.api.getFivemFinanceRuntime(interaction.guild.id);
  if (!runtime.settings.allowBalanceQuery) return interaction.reply({ content: "Consulta de saldo desativada.", ephemeral: true });
  if (!(await canUse(interaction.guild, interaction.user.id, runtime.settings))) return interaction.reply({ content: "Voce nao possui permissao.", ephemeral: true });
  const report = buildReport(runtime.transactions);
  await interaction.reply({ content: `**Saldo atual:** ${money(report.balance)}\n**Entradas:** ${money(report.totalIn)}\n**Saidas:** ${money(report.totalOut)}`, ephemeral: true });
}

async function canUse(guild: Guild, userId: string, settings: FivemFinanceSettings) { if (!settings.useRoleIds.length) return true; const member = await guild.members.fetch(userId).catch(() => null); return Boolean(member?.roles.cache.some((role) => settings.useRoleIds.includes(role.id)) || member?.permissions.has(PermissionFlagsBits.Administrator)); }
async function canAdmin(guild: Guild, userId: string, settings: FivemFinanceSettings) { const member = await guild.members.fetch(userId).catch(() => null); return Boolean(member?.roles.cache.some((role) => settings.adminRoleIds.includes(role.id)) || member?.permissions.has(PermissionFlagsBits.Administrator)); }
function buildReport(transactions: Array<{ amount: number; status: string; type: "add" | "remove" }>) { const active = transactions.filter((item) => item.status !== "cancelled"); const totalIn = active.filter((item) => item.type === "add").reduce((sum, item) => sum + item.amount, 0); const totalOut = active.filter((item) => item.type === "remove").reduce((sum, item) => sum + item.amount, 0); return { balance: totalIn - totalOut, totalIn, totalOut }; }
function parseColor(value: string) { return Number.parseInt(value.replace("#", ""), 16) || 0x22c55e; }
function parseMoney(value: string) { const normalized = value.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, ""); return Number(normalized); }
function money(value: number) { return value.toLocaleString("pt-BR", { currency: "BRL", style: "currency" }); }
function slug(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "usuario"; }

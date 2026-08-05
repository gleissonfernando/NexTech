import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type Interaction,
  type Message,
  type StringSelectMenuInteraction
} from "discord.js";
import type { BotCommand, BotContext } from "../types";
import type { WeaponSaleConfig, WeaponSaleRuntime, WeaponSaleSession, WeaponSaleWeapon } from "./apiClient";
import { renderComponentsV2Panel } from "./panelVisualRenderer";

const PREFIX = "armas";
const MODULE_ID = "fivem-weapons";

export const armasConfigCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("armas-config").setDescription("Abre o painel administrativo do Sistema de Armas."),
  moduleId: MODULE_ID,
  async execute(interaction, context) {
    await showConfig(interaction, context);
  }
};

export function startWeaponSaleService(client: import("discord.js").Client<true>, context: BotContext) {
  context.socket.onWeaponSalePanelPublish((payload) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void publishPublicPanel(guild, context);
  });
}

export async function handleWeaponSaleInteraction(interaction: Interaction, context: BotContext) {
  if (!("customId" in interaction) || !interaction.customId.startsWith(`${PREFIX}:`)) return false;
  if (!interaction.guild) return true;
  const [, action, arg] = interaction.customId.split(":");
  if (!action) return false;
  if (interaction.isButton() && action === "start") return startSale(interaction, context);
  if (interaction.isStringSelectMenu() && action === "faction") return selectFaction(interaction, context);
  if (interaction.isButton() && action === "ready") return readySale(interaction, context, arg ?? "");
  if (interaction.isButton() && action === "confirm") return confirmSale(interaction, context, arg ?? "");
  if (interaction.isButton() && action === "reopen") return reopenSale(interaction, context, arg ?? "");
  if (interaction.isButton() && action === "clear") return clearItems(interaction, context, arg ?? "");
  if (interaction.isButton() && action === "cancel") return cancelSale(interaction, context, arg ?? "");
  if (interaction.isButton() && action === "publish") return publishFromConfig(interaction, context);
  return false;
}

async function showConfig(interaction: ChatInputCommandInteraction, context: BotContext) {
  const runtime = await context.api.getWeaponSaleRuntime(interaction.guildId!);
  if (!(await canManage(interaction.guild!, interaction.user.id, runtime.config))) {
    await interaction.reply(v2(interaction.guild, "Acesso negado", "Você não possui autorização para usar /armas-config."));
    return;
  }
  await interaction.reply({
    ...configPanel(interaction.guild!, runtime),
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  });
}

async function publishFromConfig(interaction: ButtonInteraction, context: BotContext) {
  const runtime = await context.api.getWeaponSaleRuntime(interaction.guildId!);
  if (!(await canManage(interaction.guild!, interaction.user.id, runtime.config))) return deny(interaction);
  const channelId = await publishPublicPanel(interaction.guild!, context);
  await interaction.reply(v2(interaction.guild, "Publicação", channelId ? `Painel publicado em <#${channelId}>.` : "Configure canal do painel, categoria, logs e ao menos uma arma ativa."));
  return true;
}

async function publishPublicPanel(guild: Guild, context: BotContext) {
  const runtime = await context.api.getWeaponSaleRuntime(guild.id).catch(() => null);
  if (!runtime?.config.enabled || !runtime.config.panelChannelId) return null;
  const channel = await guild.channels.fetch(runtime.config.panelChannelId).catch(() => null);
  if (!channel?.isSendable()) return null;
  const payload = publicPanel(guild, runtime);
  const old = runtime.config.panelMessageId && "messages" in channel ? await channel.messages.fetch(runtime.config.panelMessageId).catch(() => null) : null;
  if (old) await old.edit(payload);
  else {
    const sent = await channel.send(payload);
    await context.api.updateWeaponSalePanelState(guild.id, sent.id).catch(() => null);
  }
  return channel.id;
}

async function startSale(interaction: ButtonInteraction, context: BotContext) {
  const runtime = await context.api.getWeaponSaleRuntime(interaction.guildId!);
  const missing = missingConfig(runtime);
  if (missing.length) {
    await interaction.reply(v2(interaction.guild, "Configuração pendente", missing.join("\n")));
    return true;
  }
  if (!(await canManage(interaction.guild!, interaction.user.id, runtime.config))) return deny(interaction);
  await interaction.reply({
    ...v2(interaction.guild, "Venda de armas", "Selecione a facção compradora."),
    components: [
      ...v2(interaction.guild, "Venda de armas", "Selecione a facção compradora.").components,
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(`${PREFIX}:faction`).setPlaceholder("Facção compradora").addOptions(runtime.factions.slice(0, 25).map((faction) => ({ label: faction.name.slice(0, 100), value: faction.id.slice(0, 100), description: faction.id.slice(0, 100) })))
      )
    ],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  });
  return true;
}

async function selectFaction(interaction: StringSelectMenuInteraction, context: BotContext) {
  const buyerFactionId = interaction.values[0];
  if (!buyerFactionId) return true;
  await interaction.deferUpdate();
  const member = await interaction.guild!.members.fetch(interaction.user.id);
  const session = await context.api.createWeaponSaleSession(interaction.guildId!, { buyerFactionId, openedByUserId: interaction.user.id, sellerName: member.displayName });
  const channel = await createTempChannel(interaction.guild!, member, session, context);
  const sent = await channel.send(sessionPanel(interaction.guild!, session));
  await context.api.updateWeaponSaleSessionChannel(interaction.guildId!, session.id, { channelId: channel.id, panelMessageId: sent.id });
  await interaction.editReply(v2(interaction.guild, "Venda iniciada", `Canal temporário criado em <#${channel.id}>.`));
  return true;
}

export async function handleWeaponSaleMessage(message: Message, context: BotContext) {
  if (!message.guild || message.author.bot || !message.content.trim()) return false;
  const session = await context.api.getWeaponSaleSessionByChannel(message.guild.id, message.channelId).catch(() => null);
  if (!session || !["aguardando_itens", "em_preenchimento"].includes(session.status)) return false;
  const runtime = await context.api.getWeaponSaleRuntime(message.guild.id);
  if (message.author.id !== session.openedByUserId && !(await canManage(message.guild, message.author.id, runtime.config))) return true;
  const parsed = parseWeaponMessage(message.content, runtime.weapons);
  if (!parsed.recognized.length && !parsed.rejected.length) return false;
  let updated = session;
  if (parsed.recognized.length) {
    updated = await context.api.addWeaponSaleItems(message.guild.id, session.id, { actorId: message.author.id, items: parsed.recognized.map((item) => ({ quantity: item.quantity, weaponId: item.weapon.id })), messageContent: message.content, messageId: message.id });
    await refreshSessionPanel(message.guild, updated);
  }
  if (parsed.rejected.length) {
    await message.reply({ allowedMentions: { repliedUser: false }, content: `Arma não cadastrada: ${parsed.rejected.join(", ")}\nDisponíveis: ${runtime.weapons.filter((weapon) => weapon.active).map((weapon) => weapon.name).slice(0, 20).join(", ") || "nenhuma arma ativa"}` }).catch(() => null);
  } else {
    await message.react("✅").catch(() => null);
  }
  return true;
}

async function readySale(interaction: ButtonInteraction, context: BotContext, sessionId: string) {
  if (!(await canManageFromRuntime(interaction, context))) return true;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const session = await context.api.readyWeaponSaleSession(interaction.guildId!, sessionId, interaction.user.id);
  await refreshSessionPanel(interaction.guild!, session);
  await interaction.editReply(confirmPanel(interaction.guild!, session));
  return true;
}

async function confirmSale(interaction: ButtonInteraction, context: BotContext, sessionId: string) {
  if (!(await canManageFromRuntime(interaction, context))) return true;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const runtime = await context.api.getWeaponSaleRuntime(interaction.guildId!);
  const session = await context.api.confirmWeaponSaleSession(interaction.guildId!, sessionId, interaction.user.id);
  await refreshSessionPanel(interaction.guild!, session);
  await sendLog(interaction.guild!, runtime.config, session, "Venda de armas registrada");
  scheduleDelete(interaction.guild!, session.channelId, runtime.config.completedDeleteDelaySeconds);
  await interaction.editReply(v2(interaction.guild, "Venda registrada", `Venda ${session.saleCode} registrada com sucesso.`));
  return true;
}

async function reopenSale(interaction: ButtonInteraction, context: BotContext, sessionId: string) {
  if (!(await canManageFromRuntime(interaction, context))) return true;
  const session = await context.api.reopenWeaponSaleSession(interaction.guildId!, sessionId, interaction.user.id);
  await refreshSessionPanel(interaction.guild!, session);
  await interaction.reply(v2(interaction.guild, "Edição reaberta", "A venda voltou para preenchimento."));
  return true;
}

async function clearItems(interaction: ButtonInteraction, context: BotContext, sessionId: string) {
  if (!(await canManageFromRuntime(interaction, context))) return true;
  const session = await context.api.clearWeaponSaleItems(interaction.guildId!, sessionId, interaction.user.id);
  await refreshSessionPanel(interaction.guild!, session);
  await interaction.reply(v2(interaction.guild, "Itens removidos", "Todos os itens foram removidos."));
  return true;
}

async function cancelSale(interaction: ButtonInteraction, context: BotContext, sessionId: string) {
  if (!(await canManageFromRuntime(interaction, context))) return true;
  const runtime = await context.api.getWeaponSaleRuntime(interaction.guildId!);
  const session = await context.api.cancelWeaponSaleSession(interaction.guildId!, sessionId, interaction.user.id);
  await refreshSessionPanel(interaction.guild!, session);
  await sendLog(interaction.guild!, runtime.config, session, "Venda de armas cancelada");
  scheduleDelete(interaction.guild!, session.channelId, runtime.config.cancelDeleteDelaySeconds);
  await interaction.reply(v2(interaction.guild, "Venda cancelada", "Atendimento cancelado e registrado."));
  return true;
}

function publicPanel(guild: Guild, runtime: WeaponSaleRuntime) {
  return renderComponentsV2Panel({
    accentColor: colorInt(runtime.config.accentColor),
    description: [runtime.config.description, "", `Armas ativas: ${runtime.weapons.filter((weapon) => weapon.active).length}`].join("\n"),
    extraImages: runtime.config.imageUrl ? [{ imageUrl: runtime.config.imageUrl }] : undefined,
    guild,
    moduleId: MODULE_ID,
    title: runtime.config.title,
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:start`).setLabel(runtime.config.buttonText).setStyle(ButtonStyle.Primary))]
  });
}

function configPanel(guild: Guild, runtime: WeaponSaleRuntime) {
  return renderComponentsV2Panel({
    accentColor: colorInt(runtime.config.accentColor),
    description: [`Status: ${runtime.config.enabled ? "Ativo" : "Inativo"}`, `Canal do painel: ${runtime.config.panelChannelId ? `<#${runtime.config.panelChannelId}>` : "não configurado"}`, `Logs: ${runtime.config.logChannelId ? `<#${runtime.config.logChannelId}>` : "não configurado"}`, `Categoria temporária: ${runtime.config.temporaryCategoryId ?? "não configurada"}`, `Armas cadastradas: ${runtime.weapons.length}`].join("\n"),
    guild,
    moduleId: MODULE_ID,
    title: "Configuração do Sistema de Armas",
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:publish`).setLabel("Publicar ou atualizar painel").setStyle(ButtonStyle.Primary))]
  });
}

function sessionPanel(guild: Guild, session: WeaponSaleSession) {
  const filling = ["aguardando_itens", "em_preenchimento"].includes(session.status);
  const confirming = session.status === "aguardando_confirmacao";
  return renderComponentsV2Panel({
    accentColor: session.status === "concluida" ? 0x22c55e : session.status === "cancelada" ? 0xef4444 : 0xf59e0b,
    description: [`Facção compradora: ${session.buyerFactionName}`, `Vendedor: <@${session.openedByUserId}>`, `Status: ${session.status}`, `Aberta em: ${date(session.createdAt)}`, "", "Itens atuais:", itemsText(session), "", `Quantidade total: ${session.totalQuantity.toLocaleString("pt-BR")}`, `Valor parcial: ${money(session.totalValueInCents)}`, "", "Envie no chat: AK X10, Pistola X5 ou várias linhas."].join("\n"),
    guild,
    moduleId: MODULE_ID,
    title: `Venda de armas ${session.saleCode}`,
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:ready:${session.id}`).setLabel("Pronto").setStyle(ButtonStyle.Success).setDisabled(!filling || session.totalQuantity <= 0),
      new ButtonBuilder().setCustomId(`${PREFIX}:clear:${session.id}`).setLabel("Limpar itens").setStyle(ButtonStyle.Secondary).setDisabled(!filling),
      new ButtonBuilder().setCustomId(`${PREFIX}:cancel:${session.id}`).setLabel("Cancelar venda").setStyle(ButtonStyle.Danger).setDisabled(!filling && !confirming),
      new ButtonBuilder().setCustomId(`${PREFIX}:reopen:${session.id}`).setLabel("Voltar e editar").setStyle(ButtonStyle.Secondary).setDisabled(!confirming),
      new ButtonBuilder().setCustomId(`${PREFIX}:confirm:${session.id}`).setLabel("Confirmar venda").setStyle(ButtonStyle.Primary).setDisabled(!confirming)
    )]
  });
}

function confirmPanel(guild: Guild, session: WeaponSaleSession) {
  return { ...sessionPanel(guild, session), flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 };
}

async function createTempChannel(guild: Guild, member: GuildMember, session: WeaponSaleSession, context: BotContext) {
  const runtime = await context.api.getWeaponSaleRuntime(guild.id);
  if (!runtime.config.temporaryCategoryId) throw new Error("Categoria temporária não configurada.");
  const managers = new Set([...runtime.config.managerRoleIds]);
  return guild.channels.create({
    name: `venda-armas-${slug(session.buyerFactionName)}-${session.saleCode.slice(-4).toLowerCase()}`.slice(0, 90),
    parent: runtime.config.temporaryCategoryId,
    permissionOverwrites: [
      { id: guild.id, deny: ["ViewChannel"] },
      { id: guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
      { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      ...[...managers].map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))
    ],
    type: ChannelType.GuildText
  });
}

async function refreshSessionPanel(guild: Guild, session: WeaponSaleSession) {
  if (!session.channelId || !session.panelMessageId) return;
  const channel = await guild.channels.fetch(session.channelId).catch(() => null);
  if (!channel || !("messages" in channel)) return;
  const message = await channel.messages.fetch(session.panelMessageId).catch(() => null);
  await message?.edit(sessionPanel(guild, session)).catch(() => null);
}

async function sendLog(guild: Guild, config: WeaponSaleConfig, session: WeaponSaleSession, title: string) {
  if (!config.logChannelId) return;
  const channel = await guild.channels.fetch(config.logChannelId).catch(() => null);
  if (!channel?.isSendable()) return;
  await channel.send(renderComponentsV2Panel({ accentColor: 0x22c55e, description: [`ID: ${session.saleCode}`, `Facção: ${session.buyerFactionName}`, `Vendedor: <@${session.openedByUserId}>`, "", itemsText(session), "", `Total: ${session.totalQuantity} unidades • ${money(session.totalValueInCents)}`, session.channelId ? `Canal: <#${session.channelId}>` : ""].join("\n"), guild, moduleId: MODULE_ID, title }));
}

function parseWeaponMessage(content: string, weapons: WeaponSaleWeapon[]) {
  const recognized: Array<{ quantity: number; weapon: WeaponSaleWeapon }> = [];
  const rejected: string[] = [];
  for (const chunk of content.split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean)) {
    const parsed = parseChunk(chunk);
    if (!parsed) continue;
    const matches = weapons.filter((weapon) => weapon.active && normalize(weapon.name) === normalize(parsed.name));
    if (matches.length === 1 && matches[0]) recognized.push({ quantity: parsed.quantity, weapon: matches[0] });
    else rejected.push(parsed.name);
  }
  return { recognized, rejected };
}

function parseChunk(chunk: string) {
  const patterns = [/^(.+?)\s+x\s*(\d{1,8})$/i, /^(.+?)\s+(\d{1,8})x?$/i, /^(\d{1,8})x?\s+(.+?)$/i];
  for (const pattern of patterns) {
    const match = chunk.match(pattern);
    if (!match) continue;
    const firstNumber = /^\d+$/.test(match[1] ?? "");
    const quantity = Number(firstNumber ? match[1] : match[2]);
    const name = (firstNumber ? match[2] : match[1])?.trim() ?? "";
    if (Number.isSafeInteger(quantity) && quantity > 0 && name) return { name, quantity };
  }
  return null;
}

async function canManageFromRuntime(interaction: ButtonInteraction, context: BotContext) {
  const runtime = await context.api.getWeaponSaleRuntime(interaction.guildId!);
  if (await canManage(interaction.guild!, interaction.user.id, runtime.config)) return true;
  await deny(interaction);
  return false;
}

async function canManage(guild: Guild, userId: string, config: WeaponSaleConfig) {
  if (guild.ownerId === userId || config.managerUserIds.includes(userId)) return true;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return false;
  if (member.permissions.has("Administrator")) return true;
  return member.roles.cache.some((role) => config.managerRoleIds.includes(role.id));
}

async function deny(interaction: ButtonInteraction) {
  await interaction.reply(v2(interaction.guild, "Acesso negado", "Você não possui autorização para usar este sistema."));
  return true;
}

function missingConfig(runtime: WeaponSaleRuntime) {
  const missing: string[] = [];
  if (!runtime.config.enabled) missing.push("- Ativar o módulo.");
  if (!runtime.config.panelChannelId) missing.push("- Configurar canal do painel.");
  if (!runtime.config.logChannelId) missing.push("- Configurar canal de logs.");
  if (!runtime.config.temporaryCategoryId) missing.push("- Configurar categoria temporária.");
  if (!runtime.weapons.some((weapon) => weapon.active)) missing.push("- Cadastrar ao menos uma arma ativa.");
  if (!runtime.factions.length) missing.push("- Cadastrar ao menos uma facção disponível.");
  return missing;
}

function itemsText(session: WeaponSaleSession) {
  return session.items.length ? session.items.map((item) => `${item.weaponName} — X${item.quantity} — ${money(item.unitPriceInCents)} — ${money(item.subtotalInCents)}`).join("\n") : "Nenhum item adicionado.";
}
function v2(guild: Guild | null, title: string, description: string) { return { ...renderComponentsV2Panel({ accentColor: 0xef4444, description, guild, moduleId: MODULE_ID, title }), flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 }; }
function money(cents: number) { return (Math.max(0, cents) / 100).toLocaleString("pt-BR", { currency: "BRL", style: "currency" }); }
function date(value: string) { return new Date(value).toLocaleString("pt-BR"); }
function slug(value: string) { return normalize(value).replace(/\s+/g, "-") || "fac"; }
function normalize(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function colorInt(value: string | null) { return value && /^#[0-9a-f]{6}$/i.test(value) ? Number.parseInt(value.slice(1), 16) : 0xef4444; }
function scheduleDelete(guild: Guild, channelId: string | null, seconds: number) {
  if (!channelId || seconds <= 0) return;
  const timer = setTimeout(() => {
    void (async () => {
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (channel) await channel.delete("Sistema de Armas: encerramento automático").catch(() => null);
    })();
  }, seconds * 1000);
  timer.unref();
}

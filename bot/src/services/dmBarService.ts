import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
  type Interaction,
  type ModalSubmitInteraction,
  type User,
  type UserSelectMenuInteraction
} from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import type { DmBarConfig } from "./apiClient";
import { buildV2Container, resolvePanelImageUrl } from "./panelVisualRenderer";
import type { BotCommand, BotContext } from "../types";

const MODULE_ID = "police-dm";
const PREFIX = "dm_bar";
const cache = new Map<string, { config: DmBarConfig; expiresAt: number }>();
const cooldowns = new Map<string, number>();
const drafts = new Map<string, { guildId: string; message: string; observation: string; targetId: string; title: string }>();

export const dmBarCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("dm").setDescription("Envia uma DM visual para um membro autorizado pelo sistema Barra DM."),
  moduleId: MODULE_ID,
  async execute(interaction, context) {
    await openDmBar(interaction, context);
  }
};

export async function openDmBar(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild || !interaction.member) return interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
  const config = await getConfig(context, interaction.guild.id);
  if (!config.enabled) return interaction.reply({ content: "O sistema de DM está temporariamente desativado.", ephemeral: true });
  if (!canUse(interaction.member as GuildMember, interaction.user.id, config)) {
    await log(context, config, interaction.guild.id, interaction.user.id, null, "Tentativa sem permissão", "", "denied", null);
    return interaction.reply({ content: "❌ Você não possui permissão para usar o sistema de DM.", ephemeral: true });
  }
  const cooldown = consumeCooldown(interaction.guild.id, interaction.user.id, config.cooldownSeconds);
  if (cooldown > 0) return interaction.reply({ content: `Aguarde ${cooldown}s para usar o /dm novamente.`, ephemeral: true });

  const select = new UserSelectMenuBuilder().setCustomId(`${PREFIX}:target`).setPlaceholder("Selecione o usuário que receberá a DM").setMinValues(1).setMaxValues(1);
  return interaction.reply({
    components: [{ type: 17, accent_color: color(config.accentColor), components: [{ type: 10, content: `# ${config.emoji} Barra DM\nSelecione o usuário que receberá a mensagem privada.` }, new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(select)] }],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  });
}

export async function handleDmBarInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.guild || !interaction.isRepliable() || !("customId" in interaction)) return false;
  const customId = String(interaction.customId);
  if (!customId.startsWith(`${PREFIX}:`)) return false;
  if (interaction.isUserSelectMenu() && customId === `${PREFIX}:target`) return selectTarget(interaction, context);
  if (interaction.isModalSubmit() && customId.startsWith(`${PREFIX}:modal:`)) return submitModal(interaction, context, customId.slice(`${PREFIX}:modal:`.length));
  if (interaction.isButton() && customId.startsWith(`${PREFIX}:send:`)) return sendDraft(interaction, context, customId.slice(`${PREFIX}:send:`.length));
  if (interaction.isButton() && customId.startsWith(`${PREFIX}:edit:`)) return editDraft(interaction, customId.slice(`${PREFIX}:edit:`.length));
  if (interaction.isButton() && customId.startsWith(`${PREFIX}:cancel:`)) return cancelDraft(interaction, context, customId.slice(`${PREFIX}:cancel:`.length));
  return false;
}

export function clearDmBarConfigCache(guildId?: string | null) {
  if (!guildId) cache.clear();
  else cache.delete(guildId);
}

async function selectTarget(interaction: UserSelectMenuInteraction, context: BotContext) {
  const targetId = interaction.values[0]!;
  const config = await getConfig(context, interaction.guildId!);
  await interaction.showModal(dmModal(targetId, config.titleTemplate, ""));
  return true;
}

async function submitModal(interaction: ModalSubmitInteraction, context: BotContext, targetId: string) {
  const title = sanitize(interaction.fields.getTextInputValue("title"), 100);
  const message = sanitize(interaction.fields.getTextInputValue("message"), 1800);
  const observation = "";
  const draftId = `${interaction.id}-${Date.now()}`;
  drafts.set(draftId, { guildId: interaction.guildId!, message, observation, targetId, title });
  const config = await getConfig(context, interaction.guildId!);
  const target = await interaction.client.users.fetch(targetId).catch(() => null);
  const preview = previewPayload(config, interaction.user, target, title, message, observation);
  await interaction.reply({
    ...preview,
    ephemeral: true,
    components: [
      ...(preview.components ?? []),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:send:${draftId}`).setLabel("Enviar DM").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${PREFIX}:edit:${draftId}`).setLabel("Editar mensagem").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${PREFIX}:cancel:${draftId}`).setLabel("Cancelar").setStyle(ButtonStyle.Danger)
      )
    ]
  });
  return true;
}

async function sendDraft(interaction: ButtonInteraction, context: BotContext, draftId: string) {
  await interaction.deferUpdate();
  const draft = drafts.get(draftId);
  if (!draft) return interaction.followUp({ content: "Rascunho expirado. Use /dm novamente.", ephemeral: true });
  const config = await getConfig(context, draft.guildId);
  const target = await interaction.client.users.fetch(draft.targetId).catch(() => null);
  if (!target) return interaction.followUp({ content: "❌ Usuário inválido ou não encontrado.", ephemeral: true });
  try {
    await target.send(dmPayload(config, interaction.user, target, draft.title, draft.message, draft.observation, interaction.guild?.name ?? "Servidor"));
    drafts.delete(draftId);
    await log(context, config, draft.guildId, interaction.user.id, target.id, draft.title, draft.message, "sent", null);
    await sendLogChannel(interaction, config, target, draft, "sent", null);
    return interaction.followUp({ content: `✅ DM enviada com sucesso para ${target}.`, ephemeral: true });
  } catch {
    await log(context, config, draft.guildId, interaction.user.id, target.id, draft.title, draft.message, "failed", "Privado bloqueado.");
    await sendLogChannel(interaction, config, target, draft, "failed", "Privado bloqueado.");
    return interaction.followUp({ content: `❌ Não foi possível enviar a DM para ${target}. O usuário provavelmente está com mensagens privadas bloqueadas.`, ephemeral: true });
  }
}

async function editDraft(interaction: ButtonInteraction, draftId: string) {
  const draft = drafts.get(draftId);
  if (!draft) return interaction.reply({ content: "Rascunho expirado. Use /dm novamente.", ephemeral: true });
  await interaction.showModal(dmModal(draft.targetId, draft.title, draft.message));
  return true;
}

async function cancelDraft(interaction: ButtonInteraction, context: BotContext, draftId: string) {
  const draft = drafts.get(draftId);
  drafts.delete(draftId);
  await interaction.update({ components: [], content: "Envio cancelado." });
  if (draft) {
    const config = await getConfig(context, draft.guildId).catch(() => null);
    if (config) await log(context, config, draft.guildId, interaction.user.id, draft.targetId, draft.title, draft.message, "cancelled", null);
  }
  return true;
}

function dmModal(targetId: string, title: string, message: string) {
  return new ModalBuilder().setCustomId(`${PREFIX}:modal:${targetId}`).setTitle("Enviar DM").addComponents(
    row("title", "Título da mensagem", "Ex: Comunicado Oficial", true, title, TextInputStyle.Short, 100),
    row("message", "Mensagem", "Digite a mensagem que será enviada", true, message, TextInputStyle.Paragraph, 1800)
  );
}

function dmPayload(config: DmBarConfig, author: User, target: User, title: string, message: string, observation: string, guildName: string) {
  const vars = variables(author, target, guildName, message, title, observation);
  const components: unknown[] = [];
  const mainImage = config.mainImageUrl ? resolvePanelImageUrl(config.mainImageUrl) : null;
  const renderedTitle = title || applyVars(config.titleTemplate, vars);
  const renderedDescription = renderDmDescription(config.descriptionTemplate, vars, message);
  const pushImage = () => { if (mainImage) components.push({ type: 12, items: [{ media: { url: mainImage }, description: renderedTitle }] }); };
  if (mainImage && config.imagePosition === "top") pushImage();
  components.push({ type: 10, content: `# ${renderedTitle}\n${renderedDescription}`.slice(0, 3900) });
  if (mainImage && (config.imagePosition === "middle" || config.imagePosition === "gallery" || config.imagePosition === "thumbnail")) pushImage();
  if (observation) components.push({ type: 10, content: `**Observação:**\n${observation}` });
  if (mainImage && config.imagePosition === "bottom") pushImage();
  const footer = config.footerEnabled
    ? { image: config.footerIconUrl, text: `${config.emoji} ${applyVars(stripSenderLines(config.footerText), vars)}`.trim() }
    : { enabled: false };
  return {
    allowedMentions: config.allowMentions ? undefined : { parse: [] as never[] },
    components: [buildV2Container({ accentColor: color(config.accentColor), components, footer })],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function previewPayload(config: DmBarConfig, author: User, target: User | null, title: string, message: string, observation: string) {
  return dmPayload(config, author, target ?? author, title, message, observation, "Servidor");
}

async function getConfig(context: BotContext, guildId: string) {
  const cached = cache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.config;
  const config = await context.api.getDmBarConfig(guildId);
  cache.set(guildId, { config, expiresAt: Date.now() + 20_000 });
  return config;
}

function canUse(member: GuildMember, userId: string, config: DmBarConfig) {
  if (config.allowAdmins && member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (config.allowedUserIds.includes(userId)) return true;
  return config.allowedRoleIds.some((roleId) => member.roles.cache.has(roleId));
}
function consumeCooldown(guildId: string, userId: string, seconds: number) {
  if (seconds <= 0) return 0;
  const key = `${guildId}:${userId}`;
  const until = cooldowns.get(key) ?? 0;
  const now = Date.now();
  if (until > now) return Math.ceil((until - now) / 1000);
  cooldowns.set(key, now + seconds * 1000);
  return 0;
}
async function log(context: BotContext, config: DmBarConfig, guildId: string, senderId: string, targetId: string | null, title: string, message: string, status: "sent" | "failed" | "denied" | "cancelled" | "test", errorReason: string | null) {
  if (!config.logsEnabled) return;
  await context.api.createDmBarLog(guildId, { errorReason, message, senderId, status, targetId, title }).catch(() => null);
}
async function sendLogChannel(interaction: ButtonInteraction, config: DmBarConfig, target: User, draft: { title: string; message: string }, status: string, error: string | null) {
  if (!config.logsEnabled || !config.logChannelId || !interaction.guild) return;
  const channel = await interaction.guild.channels.fetch(config.logChannelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return;
  await channel.send({ components: [{ type: 17, accent_color: status === "sent" ? 0x22c55e : 0xef4444, components: [{ type: 10, content: `# Log Barra DM\n**Status:** ${status}\n**Enviado por:** <@${interaction.user.id}> (${interaction.user.id})\n**Recebeu:** <@${target.id}> (${target.id})\n**Título:** ${draft.title}\n**Conteúdo:**\n${draft.message.slice(0, 1500)}${error ? `\n**Erro:** ${error}` : ""}\n**Data:** <t:${Math.floor(Date.now() / 1000)}:F>` }] }], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
}
function variables(author: User, target: User, guildName: string, message: string, title: string, observation: string) {
  const now = new Date();
  return { "{usuario}": `<@${target.id}>`, "{usuario_nome}": target.username, "{usuario_nick}": target.username, "{autor}": `<@${author.id}>`, "{autor_nome}": author.username, "{servidor}": guildName, "{data}": now.toLocaleDateString("pt-BR"), "{hora}": now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }), "{id_usuario}": target.id, "{id_autor}": author.id, "{mensagem}": message, "{titulo}": title, "{observacao}": observation };
}
function stripSenderLines(text: string) {
  return text
    .split(/\r?\n/)
    .filter((line) => !/\{autor(?:_nome)?\}|\{id_autor\}|enviado\s+por/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function applyVars(text: string, vars: Record<string, string>) { return Object.entries(vars).reduce((value, [key, replacement]) => value.replaceAll(key, replacement), text); }
function renderDmDescription(template: string, vars: Record<string, string>, message: string) {
  const rendered = applyVars(stripSenderLines(template), vars);
  return template.includes("{mensagem}") ? rendered : `${rendered}\n\n**Mensagem:**\n${message}`.trim();
}
function sanitize(value: string, max: number) { return value.replace(/@everyone/gi, "@\u200beveryone").replace(/@here/gi, "@\u200bhere").trim().slice(0, max); }
function row(id: string, label: string, placeholder: string, required: boolean, value: string, style: TextInputStyle, max: number) { return new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder).setRequired(required).setStyle(style).setMaxLength(max).setValue(value.slice(0, max))); }
function color(value: string) { return Number.parseInt(value.replace("#", ""), 16) || 0x22c55e; }

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type Interaction,
  type ModalSubmitInteraction,
  type User
} from "discord.js";
import type { OpenDutySettings } from "../services/apiClient";
import { buildV2Container, renderComponentsV2Panel, resolvePanelImageUrl } from "../services/panelVisualRenderer";
import { replaceSystemEmojis, systemComponentEmoji, systemEmojiText } from "../services/systemEmojiService";
import type { BotCommand, BotContext } from "../types";

const MODULE_ID = "police-open-duty";
const PREFIX = "open_duty_notify";
type NotificationDraft = { edited: boolean; executorId: string; guildId: string; message: string; targetId: string };
const drafts = new Map<string, NotificationDraft>();

export const notificarCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("notificar")
    .setDescription("Envia notificação oficial de ponto aberto.")
    .addUserOption((option) => option.setName("usuario").setDescription("Usuário que receberá a notificação.").setRequired(false))
    .addStringOption((option) => option.setName("acao").setDescription("Ações do sistema.").addChoices({ name: "config", value: "config" }).setRequired(false)),
  moduleId: MODULE_ID,
  async execute(interaction, context) {
    if (interaction.options.getString("acao") === "config") {
      await openConfigSummary(interaction, context);
      return;
    }

    const target = interaction.options.getUser("usuario");
    if (!target) {
      await interaction.reply({ content: "Informe o usuário que receberá a notificação.", ephemeral: true });
      return;
    }

    await openNotificationPanel(interaction, context, target);
  }
};

export async function handleOpenDutyNotificationInteraction(interaction: Interaction, context: BotContext) {
  if (!("customId" in interaction) || !String(interaction.customId).startsWith(`${PREFIX}:`)) return false;
  const customId = String(interaction.customId);
  if (interaction.isButton() && customId.startsWith(`${PREFIX}:send:`)) return sendDraft(interaction, context, customId.slice(`${PREFIX}:send:`.length));
  if (interaction.isButton() && customId.startsWith(`${PREFIX}:edit:`)) return editDraft(interaction, context, customId.slice(`${PREFIX}:edit:`.length));
  if (interaction.isButton() && customId.startsWith(`${PREFIX}:cancel:`)) return cancelDraft(interaction, context, customId.slice(`${PREFIX}:cancel:`.length));
  if (interaction.isChannelSelectMenu() && customId === `${PREFIX}:config:mention`) return updateConfigChannel(interaction, context, "mentionChannelId");
  if (interaction.isChannelSelectMenu() && customId === `${PREFIX}:config:log`) return updateConfigChannel(interaction, context, "logChannelId");
  if (interaction.isChannelSelectMenu() && customId === `${PREFIX}:config:alert`) return updateConfigChannel(interaction, context, "alertChannelId");
  if (interaction.isModalSubmit() && customId.startsWith(`${PREFIX}:modal:`)) return submitEdit(interaction, context, customId.slice(`${PREFIX}:modal:`.length));
  return false;
}

async function openNotificationPanel(interaction: ChatInputCommandInteraction, context: BotContext, target: User) {
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
    return;
  }

  const settings = await getSettingsWithResolvedMentionChannel(interaction.guild, context);
  if (!settings.enabled) {
    await interaction.reply({ content: "O sistema de Ponto Aberto está desativado.", ephemeral: true });
    return;
  }

  if (!canUse(interaction.member as GuildMember, interaction.user.id, settings)) {
    await context.api.recordOpenDutyDelivery(interaction.guild.id, {
      edited: false,
      executorId: interaction.user.id,
      message: "",
      status: "denied",
      targetId: target.id
    }).catch(() => null);
    await interaction.reply({ content: "Você não possui permissão para usar este comando.", ephemeral: true });
    return;
  }

  const message = renderMessage(settings.defaultMessage, target, settings);
  const draftId = `${interaction.id}:${target.id}`;
  drafts.set(draftId, { edited: false, executorId: interaction.user.id, guildId: interaction.guild.id, message, targetId: target.id });
  await interaction.reply({
    ...panel(settings, {
      actions: [actionRow(draftId, settings)],
      description: `Usuário selecionado: ${target}\n\nPrevia da mensagem que será enviada por DM:`,
      fields: [
        `**Canal mencionado na DM:** ${settings.mentionChannelId ? `<#${settings.mentionChannelId}>` : "não configurado"}\n**Variavel de canal:** ${hasChannelVariable(settings.defaultMessage) ? "ativa" : "adicione {canal} ou {channel} na mensagem padrão"}`,
        message
      ],
      title: "Notificação de Ponto Aberto"
    }),
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  });
}

async function openConfigSummary(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) return interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
  const settings = await getSettingsWithResolvedMentionChannel(interaction.guild, context);
  await interaction.reply({
    ...configPanel(settings),
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  });
}

async function updateConfigChannel(interaction: ChannelSelectMenuInteraction, context: BotContext, key: "alertChannelId" | "logChannelId" | "mentionChannelId") {
  if (!interaction.guildId) return false;
  const channelId = interaction.values[0] ?? null;
  const settings = await context.api.saveOpenDutySettings(interaction.guildId, { [key]: channelId }, interaction.user.id);
  await interaction.update({
    ...configPanel(settings),
    flags: MessageFlags.IsComponentsV2
  });
  return true;
}

async function sendDraft(interaction: ButtonInteraction, context: BotContext, draftId: string) {
  await interaction.deferUpdate();
  const draft = await resolveDraft(interaction, context, draftId);
  if (!draft) return interaction.followUp({ content: "Não consegui recuperar os dados deste painel. Execute /notificar novamente.", ephemeral: true });
  const settings = interaction.guild
    ? await getSettingsWithResolvedMentionChannel(interaction.guild, context)
    : await context.api.getOpenDutySettings(draft.guildId);
  const target = await interaction.client.users.fetch(draft.targetId).catch(() => null);
  if (!target) return interaction.followUp({ content: "Usuário não encontrado.", ephemeral: true });
  const finalMessage = draft.edited
    ? ensureMentionTargets(draft.message, target, settings)
    : renderMessage(settings.defaultMessage, target, settings);
  const finalDraft = { ...draft, message: finalMessage };

  try {
    await target.send(dmPayload(settings, target, finalMessage));
    drafts.delete(draftId);
    const result = await context.api.recordOpenDutyDelivery(draft.guildId, {
      edited: draft.edited,
      executorId: draft.executorId,
      message: finalMessage,
      status: "sent",
      targetId: draft.targetId
    });
    await sendLog(interaction, settings, target, finalDraft, "sent", null, result.counterTotal);
    if (result.alertTriggered) await sendAlert(interaction, settings, target, result.counterTotal);
    return interaction.followUp({ content: `Notificação enviada com sucesso para ${target}.`, ephemeral: true });
  } catch {
    await context.api.recordOpenDutyDelivery(draft.guildId, {
      edited: draft.edited,
      errorReason: "DM fechada ou bloqueada.",
      executorId: draft.executorId,
      message: finalMessage,
      status: "failed",
      targetId: draft.targetId
    }).catch(() => null);
    await sendLog(interaction, settings, target, finalDraft, "failed", "DM fechada ou bloqueada.", 0);
    return interaction.followUp({ content: `Não foi possível enviar DM para ${target}.`, ephemeral: true });
  }
}

async function editDraft(interaction: ButtonInteraction, context: BotContext, draftId: string) {
  const draft = await resolveDraft(interaction, context, draftId);
  if (!draft) return interaction.reply({ content: "Não consegui recuperar os dados deste painel. Execute /notificar novamente.", ephemeral: true });
  await interaction.showModal(new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:${draftId}`)
    .setTitle("Editar notificação")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
      .setCustomId("message")
      .setLabel("Mensagem da DM")
      .setMaxLength(3000)
      .setRequired(true)
      .setStyle(TextInputStyle.Paragraph)
      .setValue(draft.message))));
  return true;
}

async function submitEdit(interaction: ModalSubmitInteraction, context: BotContext, draftId: string) {
  const draft = await resolveDraft(interaction, context, draftId);
  if (!draft) return interaction.reply({ content: "Não consegui recuperar os dados deste painel. Execute /notificar novamente.", ephemeral: true });
  const settings = interaction.guild
    ? await getSettingsWithResolvedMentionChannel(interaction.guild, context)
    : await context.api.getOpenDutySettings(draft.guildId);
  const target = await interaction.client.users.fetch(draft.targetId).catch(() => null);
  const message = interaction.fields.getTextInputValue("message");
  const previewMessage = target ? ensureMentionTargets(message, target, settings) : message;
  drafts.set(draftId, { ...draft, edited: true, message: previewMessage });
  await interaction.reply({
    ...panel(settings, {
      actions: [confirmEditedRow(draftId, settings)],
      description: `Previa editada para ${target ? `${target}` : `<@${draft.targetId}>`}:`,
      fields: [previewMessage],
      title: "Confirmar Envio"
    }),
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  });
  return true;
}

async function cancelDraft(interaction: ButtonInteraction, context: BotContext, draftId: string) {
  const draft = drafts.get(draftId);
  drafts.delete(draftId);
  await interaction.update({ components: [], content: "Notificação cancelada." });
  if (draft) {
    await context.api.recordOpenDutyDelivery(draft.guildId, {
      edited: draft.edited,
      executorId: draft.executorId,
      message: draft.message,
      status: "cancelled",
      targetId: draft.targetId
    }).catch(() => null);
  }
  return true;
}

async function resolveDraft(interaction: ButtonInteraction | ModalSubmitInteraction, context: BotContext, draftId: string): Promise<NotificationDraft | null> {
  const existing = drafts.get(draftId);
  if (existing) return existing;
  const guildId = interaction.guildId;
  if (!guildId) return null;
  const sourceMessage = "message" in interaction ? interaction.message : null;
  const targetId = extractTargetIdFromDraftId(draftId) ?? (sourceMessage ? extractTargetIdFromMessage(sourceMessage) : null);
  if (!targetId) return null;
  const target = await interaction.client.users.fetch(targetId).catch(() => null);
  if (!target) return null;
  const settings = interaction.guild
    ? await getSettingsWithResolvedMentionChannel(interaction.guild, context)
    : await context.api.getOpenDutySettings(guildId);
  const recoveredMessage = sourceMessage ? extractNotificationMessage(sourceMessage) : null;
  const draft: NotificationDraft = {
    edited: Boolean(recoveredMessage),
    executorId: interaction.user.id,
    guildId,
    message: recoveredMessage ?? renderMessage(settings.defaultMessage, target, settings),
    targetId
  };
  drafts.set(draftId, draft);
  return draft;
}

async function getSettingsWithResolvedMentionChannel(guild: Guild, context: BotContext) {
  const settings = await context.api.getOpenDutySettings(guild.id);

  if (settings.mentionChannelId) {
    return settings;
  }

  const channel = guild.channels.cache.find((item) => {
    if (item.type !== ChannelType.GuildText && item.type !== ChannelType.GuildAnnouncement) {
      return false;
    }

    return normalizeChannelName(item.name) === "justificar-ponto";
  });

  if (!channel) {
    return settings;
  }

  const saved = await context.api.saveOpenDutySettings(guild.id, {
    mentionChannelId: channel.id
  }, context.client.user?.id ?? null).catch(() => null);

  return saved ?? {
    ...settings,
    mentionChannelId: channel.id
  };
}

function dmPayload(settings: OpenDutySettings, target: User, message: string) {
  const components: unknown[] = [];
  const banner = settings.dmBannerUrl ? resolvePanelImageUrl(settings.dmBannerUrl) : null;
  const footerImage = settings.footerImageUrl ? resolvePanelImageUrl(settings.footerImageUrl) : null;
  const pushBanner = () => { if (banner) components.push({ type: 12, items: [{ media: { url: banner }, description: "Ponto Aberto" }] }); };
  if (settings.imagePosition === "top") pushBanner();
  components.push({ type: 10, content: replaceSystemEmojis(`# ⚠️ Notificação de Ponto Aberto\n\n${ensureMentionTargets(message, target, settings)}`).slice(0, 3900) });
  if (settings.imagePosition === "middle") pushBanner();
  if (settings.imagePosition === "bottom") pushBanner();
  return {
    allowedMentions: { users: [target.id] },
    components: [buildV2Container({
      accentColor: color(settings.panelColor),
      components,
      footer: footer(settings, footerImage ?? banner)
    })],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

async function sendLog(interaction: ButtonInteraction, settings: OpenDutySettings, target: User, draft: { edited: boolean; executorId: string; message: string }, status: string, error: string | null, counterTotal: number) {
  if (!settings.logChannelId || !interaction.guild) return;
  const channel = await interaction.guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return;
  await channel.send(panel(settings, {
    description: "Registro interno do sistema de Ponto Aberto.",
    fields: [
      `**Executor:** <@${draft.executorId}> (${draft.executorId})\n**Usuário notificado:** <@${target.id}> (${target.id})\n**Status:** ${status}\n**Avisos atuais:** ${counterTotal}`,
      `**Mensagem ${draft.edited ? "editada" : "padrao"}:**\n${draft.message.slice(0, 1500)}${error ? `\n**Erro:** ${error}` : ""}`
    ],
    title: "Log Ponto Aberto"
  })).catch(() => null);
}

async function sendAlert(interaction: ButtonInteraction, settings: OpenDutySettings, target: User, total: number) {
  const channelId = settings.alertChannelId ?? settings.logChannelId;
  if (!channelId || !interaction.guild) return;
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return;
  await channel.send(panel(settings, {
    description: `${settings.alertMessage}\n\nO contador foi zerado automaticamente e uma nova contagem foi iniciada.`,
    fields: [
      `**Usuário:** <@${target.id}>\n**ID:** ${target.id}\n**Progresso:** ${Math.min(total, 3)}/3\n**Última notificação:** <t:${Math.floor(Date.now() / 1000)}:F>`
    ],
    title: "Alerta de Multa - 3/3 Avisos"
  })).catch(() => null);
}

function actionRow(draftId: string, settings: OpenDutySettings) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:send:${draftId}`).setEmoji(systemComponentEmoji("visto")).setLabel("Enviar mensagem padrão").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}:edit:${draftId}`).setEmoji(systemComponentEmoji("prancheta_caneta")).setLabel("Editar mensagem").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}:cancel:${draftId}`).setEmoji(systemComponentEmoji("porta")).setLabel("Cancelar").setStyle(ButtonStyle.Secondary)
  ).toJSON();
}

function confirmEditedRow(draftId: string, settings: OpenDutySettings) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:send:${draftId}`).setEmoji(systemComponentEmoji("visto")).setLabel("Confirmar envio").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}:edit:${draftId}`).setEmoji(systemComponentEmoji("prancheta_caneta")).setLabel("Editar novamente").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}:cancel:${draftId}`).setEmoji(systemComponentEmoji("porta")).setLabel("Cancelar").setStyle(ButtonStyle.Secondary)
  ).toJSON();
}

function configPanel(settings: OpenDutySettings) {
  return panel(settings, {
    actions: [
      channelSelectRow(`${PREFIX}:config:mention`, "Canal que será mencionado na DM", settings.mentionChannelId),
      channelSelectRow(`${PREFIX}:config:log`, "Canal de logs internas", settings.logChannelId),
      channelSelectRow(`${PREFIX}:config:alert`, "Canal de multas 3/3", settings.alertChannelId)
    ],
    description: "Resumo da configuração principal. Selecione os canais abaixo para salvar direto pelo Discord.",
    fields: [
      `**Logs internas:** ${settings.logChannelId ? `<#${settings.logChannelId}>` : "não configurado"}\n**Canal de multas:** ${settings.alertChannelId ? `<#${settings.alertChannelId}>` : "não configurado"}\n**Canal mencionado na DM:** ${settings.mentionChannelId ? `<#${settings.mentionChannelId}>` : "não configurado"}`,
      `**Variavel de canal na mensagem:** ${hasChannelVariable(settings.defaultMessage) ? "configurada" : "ausente - use {canal} ou {channel}"}\n**Cargos autorizados:** ${settings.allowedRoleIds.length ? settings.allowedRoleIds.map((id) => `<@&${id}>`).join(", ") : "nenhum"}\n**Regra:** envia multa ao chegar em 3/3; zera e inicia uma nova contagem.`
    ],
    title: "Configurar Ponto Aberto"
  });
}

function channelSelectRow(customId: string, placeholder: string, selectedChannelId: string | null) {
  const select = new ChannelSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(1);
  if (selectedChannelId) select.setDefaultChannels(selectedChannelId);
  return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select).toJSON();
}

function panel(settings: OpenDutySettings, input: { actions?: unknown[]; description: string; fields?: string[]; title: string }) {
  return renderComponentsV2Panel({
    accentColor: color(settings.panelColor),
    actions: input.actions,
    description: input.description,
    fields: input.fields,
    footer: footer(settings, settings.footerImageUrl ? resolvePanelImageUrl(settings.footerImageUrl) : null),
    image: settings.panelBannerUrl ? { imageEnabled: true, imagePosition: "top", imageUrl: settings.panelBannerUrl } : null,
    moduleId: MODULE_ID,
    title: `${systemEmojiText(input.title.toLowerCase().includes("alerta") ? "alerta" : input.title.toLowerCase().includes("log") ? "folha" : "engrenagem")} ${input.title}`
  });
}

function footer(settings: OpenDutySettings, imageUrl: string | null) {
  return {
    image: settings.imagePosition === "footer" ? imageUrl : null,
    text: settings.footerText ?? "NexTechK"
  };
}

function canUse(member: GuildMember, userId: string, settings: OpenDutySettings) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (settings.allowedUserIds.includes(userId)) return true;
  return settings.allowedRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

function renderMessage(template: string, target: User, settings: OpenDutySettings) {
  const channelMention = mentionChannel(settings);
  return ensureMentionTargets(template
    .replaceAll("{usuário}", `<@${target.id}>`)
    .replaceAll("{usuario}", `<@${target.id}>`)
    .replaceAll("<@usuário>", `<@${target.id}>`)
    .replaceAll("{canal}", channelMention)
    .replaceAll("{channel}", channelMention), target, settings);
}

function ensureMentionTargets(message: string, target: User, settings: OpenDutySettings) {
  const userMention = `<@${target.id}>`;
  const channelMention = mentionChannel(settings);
  let next = message.trim();

  if (!next.includes(userMention)) {
    next = `Prezada(o) ${userMention},\n\n${next}`;
  }

  if (settings.mentionChannelId && !next.includes(channelMention)) {
    next = `${next}\n\nCanal de justificativa: ${channelMention}`;
  }

  return next;
}

function mentionChannel(settings: OpenDutySettings) {
  return settings.mentionChannelId ? `<#${settings.mentionChannelId}>` : "#justificar-ponto";
}

function normalizeChannelName(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function hasChannelVariable(template: string) {
  return /\{(?:canal|channel)\}/i.test(template);
}

function extractTargetIdFromDraftId(draftId: string) {
  const [, targetId] = draftId.split(":");
  return /^\d{5,32}$/.test(targetId ?? "") ? targetId : null;
}

function extractTargetIdFromMessage(message: ButtonInteraction["message"]) {
  return collectMessageText(message)
    .join("\n")
    .match(/Usuario selecionado:\s*<@!?(\d{5,32})>|Previa editada para\s*<@!?(\d{5,32})>|Prezada\(o\)\s*<@!?(\d{5,32})>/i)?.slice(1).find(Boolean) ?? null;
}

function extractNotificationMessage(message: ButtonInteraction["message"]) {
  const texts = collectMessageText(message).map((text) => text.trim()).filter(Boolean);
  const directMessage = [...texts].reverse().find((text) => /Prezada\(o\)|Verificamos que seu ponto|Se voce esqueceu|Se você esqueceu/i.test(text));
  if (directMessage) return directMessage.replace(/^#+\s*Confirmar Envio\s*/i, "").trim().slice(0, 3000);
  const joined = texts.join("\n\n");
  const previewIndex = joined.search(/Previa da mensagem que sera enviada por DM:|Previa editada para/i);
  return previewIndex >= 0 ? joined.slice(previewIndex).replace(/^.*?(?:DM:|:)\s*/s, "").trim().slice(0, 3000) || null : null;
}

function collectMessageText(message: ButtonInteraction["message"]) {
  const output: string[] = [];
  collectComponentText(message.content, output);
  collectComponentText(message.components, output);
  if (typeof message.toJSON === "function") collectComponentText(message.toJSON(), output);
  return [...new Set(output)];
}

function collectComponentText(value: unknown, output: string[] = []) {
  if (!value) return output;
  if (Array.isArray(value)) {
    value.forEach((item) => collectComponentText(item, output));
    return output;
  }
  if (typeof value !== "object") return output;
  const record = value as Record<string, unknown>;
  if (typeof record.content === "string") output.push(record.content);
  if (record.data) collectComponentText(record.data, output);
  if (record.components) collectComponentText(record.components, output);
  if (record.items) collectComponentText(record.items, output);
  if (record.component) collectComponentText(record.component, output);
  return output;
}

function color(value: string) {
  const parsed = Number.parseInt(value.replace("#", ""), 16);
  return Number.isFinite(parsed) ? parsed : 0x2563eb;
}

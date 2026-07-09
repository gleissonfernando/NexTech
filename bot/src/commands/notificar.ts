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
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
  type Interaction,
  type ModalSubmitInteraction,
  type User
} from "discord.js";
import type { OpenDutySettings } from "../services/apiClient";
import { buildV2Container, renderComponentsV2Panel, resolvePanelImageUrl } from "../services/panelVisualRenderer";
import type { BotCommand, BotContext } from "../types";

const MODULE_ID = "police-open-duty";
const PREFIX = "open_duty_notify";
const drafts = new Map<string, { edited: boolean; executorId: string; guildId: string; message: string; targetId: string }>();

export const notificarCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("notificar")
    .setDescription("Envia notificacao oficial de ponto aberto.")
    .addUserOption((option) => option.setName("usuario").setDescription("Usuario que recebera a notificacao.").setRequired(false))
    .addStringOption((option) => option.setName("acao").setDescription("Acoes do sistema.").addChoices({ name: "config", value: "config" }).setRequired(false)),
  moduleId: MODULE_ID,
  async execute(interaction, context) {
    if (interaction.options.getString("acao") === "config") {
      await openConfigSummary(interaction, context);
      return;
    }

    const target = interaction.options.getUser("usuario");
    if (!target) {
      await interaction.reply({ content: "Informe o usuario que recebera a notificacao.", ephemeral: true });
      return;
    }

    await openNotificationPanel(interaction, context, target);
  }
};

export async function handleOpenDutyNotificationInteraction(interaction: Interaction, context: BotContext) {
  if (!("customId" in interaction) || !String(interaction.customId).startsWith(`${PREFIX}:`)) return false;
  const customId = String(interaction.customId);
  if (interaction.isButton() && customId.startsWith(`${PREFIX}:send:`)) return sendDraft(interaction, context, customId.slice(`${PREFIX}:send:`.length));
  if (interaction.isButton() && customId.startsWith(`${PREFIX}:edit:`)) return editDraft(interaction, customId.slice(`${PREFIX}:edit:`.length));
  if (interaction.isButton() && customId.startsWith(`${PREFIX}:cancel:`)) return cancelDraft(interaction, context, customId.slice(`${PREFIX}:cancel:`.length));
  if (interaction.isModalSubmit() && customId.startsWith(`${PREFIX}:modal:`)) return submitEdit(interaction, context, customId.slice(`${PREFIX}:modal:`.length));
  return false;
}

async function openNotificationPanel(interaction: ChatInputCommandInteraction, context: BotContext, target: User) {
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
    return;
  }

  const settings = await context.api.getOpenDutySettings(interaction.guild.id);
  if (!settings.enabled) {
    await interaction.reply({ content: "O sistema de Ponto Aberto esta desativado.", ephemeral: true });
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
  const draftId = `${interaction.id}-${Date.now()}`;
  drafts.set(draftId, { edited: false, executorId: interaction.user.id, guildId: interaction.guild.id, message, targetId: target.id });
  await interaction.reply({
    ...panel(settings, {
      actions: [actionRow(draftId, settings)],
      description: `Usuario selecionado: ${target}\n\nPrevia da mensagem que sera enviada por DM:`,
      fields: [message],
      title: "Notificacao de Ponto Aberto"
    }),
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  });
}

async function openConfigSummary(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) return interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
  const settings = await context.api.getOpenDutySettings(interaction.guild.id);
  await interaction.reply({
    ...panel(settings, {
      description: "Resumo da configuracao principal. Use a dashboard para editar todos os campos.",
      fields: [
        `**Logs internas:** ${settings.logChannelId ? `<#${settings.logChannelId}>` : "nao configurado"}\n**Canal de multas:** ${settings.alertChannelId ? `<#${settings.alertChannelId}>` : "nao configurado"}\n**Canal mencionado na DM:** ${settings.mentionChannelId ? `<#${settings.mentionChannelId}>` : "nao configurado"}`,
        `**Cargos autorizados:** ${settings.allowedRoleIds.length ? settings.allowedRoleIds.map((id) => `<@&${id}>`).join(", ") : "nenhum"}\n**Regra:** envia multa ao chegar em 3/3; zera e inicia uma nova contagem.`
      ],
      title: "Configurar Ponto Aberto"
    }),
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  });
}

async function sendDraft(interaction: ButtonInteraction, context: BotContext, draftId: string) {
  await interaction.deferUpdate();
  const draft = drafts.get(draftId);
  if (!draft) return interaction.followUp({ content: "Painel expirado. Execute /notificar novamente.", ephemeral: true });
  const settings = await context.api.getOpenDutySettings(draft.guildId);
  const target = await interaction.client.users.fetch(draft.targetId).catch(() => null);
  if (!target) return interaction.followUp({ content: "Usuario nao encontrado.", ephemeral: true });

  try {
    await target.send(dmPayload(settings, target, draft.message));
    drafts.delete(draftId);
    const result = await context.api.recordOpenDutyDelivery(draft.guildId, {
      edited: draft.edited,
      executorId: draft.executorId,
      message: draft.message,
      status: "sent",
      targetId: draft.targetId
    });
    await sendLog(interaction, settings, target, draft, "sent", null, result.counterTotal);
    if (result.alertTriggered) await sendAlert(interaction, settings, target, result.counterTotal);
    return interaction.followUp({ content: `Notificação enviada com sucesso para ${target}.`, ephemeral: true });
  } catch {
    await context.api.recordOpenDutyDelivery(draft.guildId, {
      edited: draft.edited,
      errorReason: "DM fechada ou bloqueada.",
      executorId: draft.executorId,
      message: draft.message,
      status: "failed",
      targetId: draft.targetId
    }).catch(() => null);
    await sendLog(interaction, settings, target, draft, "failed", "DM fechada ou bloqueada.", 0);
    return interaction.followUp({ content: `Nao foi possivel enviar DM para ${target}.`, ephemeral: true });
  }
}

async function editDraft(interaction: ButtonInteraction, draftId: string) {
  const draft = drafts.get(draftId);
  if (!draft) return interaction.reply({ content: "Painel expirado. Execute /notificar novamente.", ephemeral: true });
  await interaction.showModal(new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:${draftId}`)
    .setTitle("Editar notificacao")
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
  const draft = drafts.get(draftId);
  if (!draft) return interaction.reply({ content: "Painel expirado. Execute /notificar novamente.", ephemeral: true });
  const settings = await context.api.getOpenDutySettings(draft.guildId);
  const target = await interaction.client.users.fetch(draft.targetId).catch(() => null);
  const message = interaction.fields.getTextInputValue("message");
  drafts.set(draftId, { ...draft, edited: true, message });
  await interaction.reply({
    ...panel(settings, {
      actions: [confirmEditedRow(draftId, settings)],
      description: `Previa editada para ${target ? `${target}` : `<@${draft.targetId}>`}:`,
      fields: [message],
      title: "Confirmar Envio"
    }),
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  });
  return true;
}

async function cancelDraft(interaction: ButtonInteraction, context: BotContext, draftId: string) {
  const draft = drafts.get(draftId);
  drafts.delete(draftId);
  await interaction.update({ components: [], content: "Notificacao cancelada." });
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

function dmPayload(settings: OpenDutySettings, target: User, message: string) {
  const components: unknown[] = [];
  const banner = settings.dmBannerUrl ? resolvePanelImageUrl(settings.dmBannerUrl) : null;
  const footerImage = settings.footerImageUrl ? resolvePanelImageUrl(settings.footerImageUrl) : null;
  const pushBanner = () => { if (banner) components.push({ type: 12, items: [{ media: { url: banner }, description: "Ponto Aberto" }] }); };
  if (settings.imagePosition === "top") pushBanner();
  components.push({ type: 10, content: `# Notificacao de Ponto Aberto\n${message}`.slice(0, 3900) });
  if (settings.imagePosition === "middle") pushBanner();
  if (settings.imagePosition === "bottom") pushBanner();
  return {
    allowedMentions: { users: [target.id] },
    components: [buildV2Container({
      accentColor: color(settings.panelColor),
      components,
      footer: { image: footerImage ?? (settings.imagePosition === "footer" ? banner : null), text: settings.footerText ?? "OrviteK" }
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
      `**Executor:** <@${draft.executorId}> (${draft.executorId})\n**Usuario notificado:** <@${target.id}> (${target.id})\n**Status:** ${status}\n**Avisos atuais:** ${counterTotal}`,
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
      `**Usuario:** <@${target.id}>\n**ID:** ${target.id}\n**Progresso:** ${Math.min(total, 3)}/3\n**Ultima notificacao:** <t:${Math.floor(Date.now() / 1000)}:F>`
    ],
    title: "Alerta de Multa - 3/3 Avisos"
  })).catch(() => null);
}

function actionRow(draftId: string, settings: OpenDutySettings) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:send:${draftId}`).setLabel(`${settings.buttonEmojis.send} Enviar mensagem padrao`).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}:edit:${draftId}`).setLabel(`${settings.buttonEmojis.edit} Editar mensagem`).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}:cancel:${draftId}`).setLabel(`${settings.buttonEmojis.cancel} Cancelar`).setStyle(ButtonStyle.Secondary)
  ).toJSON();
}

function confirmEditedRow(draftId: string, settings: OpenDutySettings) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:send:${draftId}`).setLabel(`${settings.buttonEmojis.send} Confirmar envio`).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}:edit:${draftId}`).setLabel(`${settings.buttonEmojis.edit} Editar novamente`).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}:cancel:${draftId}`).setLabel(`${settings.buttonEmojis.cancel} Cancelar`).setStyle(ButtonStyle.Secondary)
  ).toJSON();
}

function panel(settings: OpenDutySettings, input: { actions?: unknown[]; description: string; fields?: string[]; title: string }) {
  return renderComponentsV2Panel({
    accentColor: color(settings.panelColor),
    actions: input.actions,
    description: input.description,
    fields: input.fields,
    image: settings.panelBannerUrl ? { imageEnabled: true, imagePosition: "top", imageUrl: settings.panelBannerUrl } : null,
    moduleId: MODULE_ID,
    title: input.title
  });
}

function canUse(member: GuildMember, userId: string, settings: OpenDutySettings) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (settings.allowedUserIds.includes(userId)) return true;
  return settings.allowedRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

function renderMessage(template: string, target: User, settings: OpenDutySettings) {
  const channelMention = settings.mentionChannelId ? `<#${settings.mentionChannelId}>` : "";
  return template
    .replaceAll("{usuario}", `<@${target.id}>`)
    .replaceAll("<@usuário>", `<@${target.id}>`)
    .replaceAll("<@usuario>", `<@${target.id}>`)
    .replaceAll("{canal}", channelMention)
    .replaceAll("{channel}", channelMention);
}

function color(value: string) {
  const parsed = Number.parseInt(value.replace("#", ""), 16);
  return Number.isFinite(parsed) ? parsed : 0x2563eb;
}

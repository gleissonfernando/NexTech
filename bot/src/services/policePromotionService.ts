import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type Interaction,
  type Message,
  type MessageCreateOptions,
  type ModalSubmitInteraction
} from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import type { BotCommand, BotContext } from "../types";
import { systemComponentEmoji, systemEmojiText } from "./systemEmojiService";
import type { PolicePromotionAnswer, PolicePromotionDefinition, PolicePromotionQuestion, PolicePromotionRequest, PolicePromotionSettings } from "./apiClient";

const MODULE_ID = "police-promotions";
const PREFIX = "police_promotions";
const SETTINGS_TTL_MS = 30_000;
const DIVIDER = "━━━━━━━━━━━━━━━━━━━━━━";

type PromotionFormSession = {
  answers: PolicePromotionAnswer[];
  createdAt: number;
  guildId: string;
  index: number;
  promotion: PolicePromotionDefinition;
  requesterId: string;
  requesterName: string;
  settings: PolicePromotionSettings;
};

const settingsCache = new Map<string, { expiresAt: number; settings: PolicePromotionSettings }>();
const formSessions = new Map<string, PromotionFormSession>();
const evaluationDrafts = new Map<string, { notes: string; requestId: string }>();

export const policePromotionsCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("promocoes")
    .setDescription("Sistema de solicitação de promoção de patente.")
    .addStringOption((option) => option
      .setName("acao")
      .setDescription("Ação desejada.")
      .setRequired(false)
      .addChoices(
        { name: "Publicar painel", value: "painel" },
        { name: "Listar promoções", value: "listar" }
      )),
  async execute(interaction, context) {
    if (!interaction.guild || !interaction.inCachedGuild()) {
      await interaction.reply({ content: "Este comando só pode ser usado em servidor.", ephemeral: true });
      return;
    }

    const settings = await getSettings(context, interaction.guild.id);
    if (!settings.enabled) {
      await interaction.reply({ content: "O Sistema de Promoções está desativado.", ephemeral: true });
      return;
    }

    const action = interaction.options.getString("acao") ?? "painel";
    if (action === "listar") {
      await interaction.reply(promotionListPayload(settings, interaction.guild) as any);
      return;
    }

    await publishPromotionPanel(interaction, settings);
  },
  moduleId: MODULE_ID
};

export async function handlePolicePromotionInteraction(interaction: Interaction, context: BotContext) {
  if (!isBotModuleEnabled(MODULE_ID)) return false;
  if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return false;
  if (!interaction.customId.startsWith(`${PREFIX}:`)) return false;

  if (!interaction.guild || !interaction.inCachedGuild()) {
    if (interaction.isRepliable()) await interaction.reply({ content: "Interação inválida.", ephemeral: true });
    return true;
  }

  const [, action] = interaction.customId.split(":");
  if (action === "choose" && interaction.isStringSelectMenu()) return handlePromotionChoose(interaction, context);
  if (action === "question" && interaction.isModalSubmit()) return handleQuestionModal(interaction, context);
  if (action === "select" && interaction.isStringSelectMenu()) return handleQuestionSelect(interaction, context);
  if (action === "continue" && interaction.isButton()) return promptCurrentQuestion(interaction, context);
  if (action === "confirm" && interaction.isStringSelectMenu()) return handleConfirmationSelect(interaction, context);
  if (action === "send" && interaction.isButton()) return submitPromotionRequest(interaction, context);
  if (action === "assign" && interaction.isButton()) return assignEvaluation(interaction, context);
  if (action === "finish" && interaction.isButton()) return openEvaluationModal(interaction, context);
  if (action === "finish_modal" && interaction.isModalSubmit()) return handleEvaluationModal(interaction, context);
  if (action === "eval_result" && interaction.isButton()) return handleEvaluationResult(interaction, context);
  if (action === "approve" && interaction.isButton()) return openDecisionModal(interaction, "approved", context);
  if (action === "reject" && interaction.isButton()) return openDecisionModal(interaction, "rejected", context);
  if (action === "decision_modal" && interaction.isModalSubmit()) return handleDecisionModal(interaction, context);
  if (action === "new_eval" && interaction.isButton()) return requestNewEvaluation(interaction, context);
  if (action === "cancel" && interaction.isButton()) return closeTicket(interaction, context, "cancelled");
  if (action === "close" && interaction.isButton()) return closeTicket(interaction, context, "closed");

  return true;
}

export async function handlePolicePromotionMessage(message: Message, context: BotContext) {
  if (!isBotModuleEnabled(MODULE_ID) || message.author.bot || !message.guild) return false;
  const request = await context.api.getPolicePromotionRequestByChannel(message.channelId).catch(() => null);
  if (!request) return false;
  await context.api.addPolicePromotionHistory(request.id, {
    action: "ticket.message",
    actorId: message.author.id,
    actorName: message.author.username,
    metadata: {
      attachmentUrls: message.attachments.map((item) => item.url),
      content: message.content.slice(0, 1500),
      messageId: message.id
    }
  }).catch(() => null);
  return false;
}

export function clearPolicePromotionSettingsCache(guildId?: string | null) {
  for (const key of settingsCache.keys()) {
    if (!guildId || key.endsWith(`:${guildId}`)) settingsCache.delete(key);
  }
}

async function publishPromotionPanel(interaction: ChatInputCommandInteraction<"cached">, settings: PolicePromotionSettings) {
  const channelId = settings.defaultPanelChannelId;
  const target = channelId ? await interaction.guild.channels.fetch(channelId).catch(() => null) : interaction.channel;
  if (!target?.isTextBased() || target.isDMBased()) {
    await interaction.reply({ content: "Canal do painel inválido.", ephemeral: true });
    return;
  }

  await target.send(panelPayload(settings, interaction.guild) as any);
  await interaction.reply({ content: "Painel de promoções publicado.", ephemeral: true });
}

async function handlePromotionChoose(interaction: StringSelectMenuInteraction<"cached">, context: BotContext) {
  const settings = await getSettings(context, interaction.guild.id);
  const promotion = settings.promotions.find((item) => item.id === interaction.values[0] && item.active);
  if (!promotion) {
    await interaction.reply({ content: "Promoção não encontrada ou desativada.", ephemeral: true });
    return true;
  }

  const session = {
    answers: [],
    createdAt: Date.now(),
    guildId: interaction.guild.id,
    index: 0,
    promotion,
    requesterId: interaction.user.id,
    requesterName: displayName(interaction.member as GuildMember, interaction.user.username),
    settings
  };
  formSessions.set(sessionKey(interaction.guild.id, interaction.user.id), session);
  await promptCurrentQuestion(interaction, context);
  return true;
}

async function promptCurrentQuestion(interaction: ButtonInteraction<"cached"> | StringSelectMenuInteraction<"cached">, _context: BotContext) {
  const session = getSession(interaction);
  if (!session) {
    await replyOrUpdate(interaction, { content: "Sessão de formulário expirada. Clique no painel novamente.", ephemeral: true });
    return true;
  }

  const questions = activeQuestions(session.promotion);
  const question = questions[session.index];
  if (!question) {
    await replyOrUpdate(interaction, confirmationPayload(session) as any);
    return true;
  }

  if (isModalQuestion(question)) {
    const modal = new ModalBuilder()
      .setCustomId(`${PREFIX}:question:${question.id}`)
      .setTitle(clip(question.label, 45));
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("value")
        .setLabel(clip(question.label, 45))
        .setMaxLength(Math.min(question.maxLength ?? (question.type === "paragraph" ? 1000 : 300), 1000))
        .setPlaceholder(question.placeholder ?? question.description ?? "")
        .setRequired(question.required)
        .setStyle(question.type === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setValue(String(question.defaultValue ?? answerFor(session, question)?.value ?? ""))
    ));
    await interaction.showModal(modal);
    return true;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:select:${question.id}`)
    .setPlaceholder(question.label)
    .setMinValues(question.required ? 1 : 0)
    .setMaxValues(question.type === "checkbox" ? Math.min(Math.max(question.options.length, 1), 25) : 1)
    .addOptions((question.options.length ? question.options : ["Sim", "Não"]).slice(0, 25).map((option) => ({ label: clip(option, 80), value: option.slice(0, 100) })));
  await replyOrUpdate(interaction, {
    components: [{
      type: 17,
      accent_color: parseColor(session.promotion.color),
      components: [
        { type: 10, content: [`# ${icon("prancheta_caneta", interaction.guild)} ${escapeMarkdown(question.label)}`, question.description ? escapeMarkdown(question.description) : "Selecione uma opção para continuar."].join("\n") },
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)
      ]
    }],
    ephemeral: true,
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  } as any);
  return true;
}

async function handleQuestionModal(interaction: ModalSubmitInteraction<"cached">, context: BotContext) {
  const questionId = interaction.customId.split(":")[2];
  const session = getSession(interaction);
  const question = session?.promotion.questions.find((item) => item.id === questionId);
  if (!session || !question) {
    await interaction.reply({ content: "Sessão expirada.", ephemeral: true });
    return true;
  }

  setAnswer(session, question, interaction.fields.getTextInputValue("value"));
  session.index += 1;
  await interaction.reply(nextStepPayload(session) as any);
  return true;
}

async function handleQuestionSelect(interaction: StringSelectMenuInteraction<"cached">, context: BotContext) {
  const questionId = interaction.customId.split(":")[2];
  const session = getSession(interaction);
  const question = session?.promotion.questions.find((item) => item.id === questionId);
  if (!session || !question) {
    await interaction.reply({ content: "Sessão expirada.", ephemeral: true });
    return true;
  }

  setAnswer(session, question, question.type === "checkbox" ? interaction.values : interaction.values[0] ?? "");
  session.index += 1;
  return promptCurrentQuestion(interaction, context);
}

async function handleConfirmationSelect(interaction: StringSelectMenuInteraction<"cached">, _context: BotContext) {
  const session = getSession(interaction);
  if (!session) {
    await interaction.reply({ content: "Sessão expirada.", ephemeral: true });
    return true;
  }

  if (interaction.values.length < 2) {
    await interaction.update(confirmationPayload(session, "Marque as duas confirmações antes de enviar.") as any);
    return true;
  }

  await interaction.update(confirmationPayload(session, null, true) as any);
  return true;
}

async function submitPromotionRequest(interaction: ButtonInteraction<"cached">, context: BotContext) {
  const session = getSession(interaction);
  if (!session) {
    await interaction.reply({ content: "Sessão expirada.", ephemeral: true });
    return true;
  }

  await interaction.deferUpdate();
  const request = await context.api.createPolicePromotionRequest({
    answers: session.answers,
    guildId: interaction.guild.id,
    promotionId: session.promotion.id,
    requesterId: interaction.user.id,
    requesterName: session.requesterName
  });
  formSessions.delete(sessionKey(interaction.guild.id, interaction.user.id));
  const updated = await createPromotionTicket(interaction.guild, context, session.settings, session.promotion, request);
  await interaction.editReply({
    components: [{
      type: 17,
      accent_color: 0x22c55e,
      components: [{ type: 10, content: `# ${icon("visto", interaction.guild)} Solicitação enviada\nSeu ticket foi criado: <#${updated.channelId}>` }]
    }],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  } as any);
  return true;
}

async function createPromotionTicket(guild: Guild, context: BotContext, settings: PolicePromotionSettings, promotion: PolicePromotionDefinition, request: PolicePromotionRequest) {
  const categoryId = promotion.categoryId ?? settings.defaultCategoryId;
  const channel = await guild.channels.create({
    name: `avaliacao-${sanitizeChannelName(promotion.receivedRankName)}-${sanitizeChannelName(request.requesterName)}`.slice(0, 90),
    parent: categoryId ?? undefined,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: request.requesterId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
      { id: guild.members.me!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
      ...promotion.evaluatorRoleIds.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))
    ],
    type: ChannelType.GuildText
  });

  let saved = await context.api.updatePolicePromotionTicketState(request.id, { channelId: channel.id, logChannelId: promotion.logChannelId ?? settings.defaultLogChannelId });
  const sent = await channel.send(ticketPayload(saved, promotion, guild) as any);
  saved = await context.api.updatePolicePromotionTicketState(request.id, { channelMessageId: sent.id });
  await sent.edit(ticketPayload(saved, promotion, guild) as any).catch(() => null);
  return saved;
}

async function assignEvaluation(interaction: ButtonInteraction<"cached">, context: BotContext) {
  const request = await requestFromInteraction(interaction, context);
  const settings = await getSettings(context, interaction.guild.id);
  const promotion = promotionFor(settings, request);
  if (!promotion || !hasAnyRole(interaction.member as GuildMember, promotion.evaluatorRoleIds)) {
    await interaction.reply({ content: "Você não possui permissão para assumir esta avaliação.", ephemeral: true });
    return true;
  }

  const updated = await context.api.assignPolicePromotionEvaluator(request.id, { evaluatorId: interaction.user.id, evaluatorName: displayName(interaction.member as GuildMember, interaction.user.username) });
  await interaction.update(ticketPayload(updated, promotion, interaction.guild) as any);
  return true;
}

async function openEvaluationModal(interaction: ButtonInteraction<"cached">, context: BotContext) {
  const request = await requestFromInteraction(interaction, context);
  if (request.evaluatorId !== interaction.user.id) {
    await interaction.reply({ content: "Você não é o responsável por esta avaliação.", ephemeral: true });
    return true;
  }

  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:finish_modal:${request.id}`)
    .setTitle("Finalizar Avaliação");
  for (const [id, label] of [["observations", "Observações"], ["verdict", "Parecer"], ["grades", "Notas"], ["comments", "Comentários"]] as const) {
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId(id).setLabel(label).setMaxLength(500).setRequired(true).setStyle(TextInputStyle.Paragraph)
    ));
  }
  await interaction.showModal(modal);
  return true;
}

async function handleEvaluationModal(interaction: ModalSubmitInteraction<"cached">, context: BotContext) {
  const requestId = interaction.customId.split(":")[2]!;
  const request = await context.api.getPolicePromotionRequest(requestId);
  if (request.evaluatorId !== interaction.user.id) {
    await interaction.reply({ content: "Você não é o responsável por esta avaliação.", ephemeral: true });
    return true;
  }

  const notes = [
    `Observações:\n${interaction.fields.getTextInputValue("observations")}`,
    `Parecer:\n${interaction.fields.getTextInputValue("verdict")}`,
    `Notas:\n${interaction.fields.getTextInputValue("grades")}`,
    `Comentários:\n${interaction.fields.getTextInputValue("comments")}`
  ].join("\n\n");
  const settings = await getSettings(context, interaction.guild.id);
  const promotion = promotionFor(settings, request);
  if (!promotion) {
    await interaction.reply({ content: "Configuração da promoção não encontrada.", ephemeral: true });
    return true;
  }

  evaluationDrafts.set(evaluationDraftKey(request.id, interaction.user.id), { notes, requestId: request.id });
  await interaction.reply(evaluationResultPayload(request, promotion, interaction.guild) as any);
  return true;
}

async function handleEvaluationResult(interaction: ButtonInteraction<"cached">, context: BotContext) {
  const [, , requestId, result] = interaction.customId.split(":");
  if (!requestId || (result !== "approved" && result !== "rejected")) return true;
  const request = await context.api.getPolicePromotionRequest(requestId);
  if (request.evaluatorId !== interaction.user.id) {
    await interaction.reply({ content: "Você não é o responsável por esta avaliação.", ephemeral: true });
    return true;
  }

  const draft = evaluationDrafts.get(evaluationDraftKey(request.id, interaction.user.id));
  if (!draft) {
    await interaction.reply({ content: "Rascunho da avaliação expirado. Abra o modal e envie novamente.", ephemeral: true });
    return true;
  }

  const settings = await getSettings(context, interaction.guild.id);
  const promotion = promotionFor(settings, request);
  if (!promotion) {
    await interaction.reply({ content: "Configuração da promoção não encontrada.", ephemeral: true });
    return true;
  }

  await interaction.deferUpdate();
  const updated = await context.api.finishPolicePromotionEvaluation(request.id, { evaluatorId: interaction.user.id, evaluationNotes: draft.notes, evaluationResult: result });
  evaluationDrafts.delete(evaluationDraftKey(request.id, interaction.user.id));
  await sendApprovalPanel(interaction.guild, context, settings, promotion, updated);
  await interaction.editReply({
    components: [{
      type: 17,
      accent_color: result === "approved" ? 0x22c55e : 0xef4444,
      components: [{ type: 10, content: `# ${icon(result === "approved" ? "visto" : "exclamacao", interaction.guild)} Avaliação encerrada\nResultado registrado como **${result === "approved" ? "aprovada" : "reprovada"}** e enviado para a fila de aprovação.` }]
    }],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  } as any);
  if (interaction.channel?.isTextBased() && !interaction.channel.isDMBased() && "messages" in interaction.channel && updated.channelMessageId) {
    const message = await interaction.channel.messages.fetch(updated.channelMessageId).catch(() => null);
    await message?.edit(ticketPayload(updated, promotion, interaction.guild) as any).catch(() => null);
  }
  return true;
}

async function sendApprovalPanel(guild: Guild, context: BotContext, settings: PolicePromotionSettings, promotion: PolicePromotionDefinition, request: PolicePromotionRequest) {
  const approvalChannelId = settings.defaultApprovalChannelId ?? promotion.historyChannelId ?? settings.defaultHistoryChannelId;
  const channel = approvalChannelId ? await guild.channels.fetch(approvalChannelId).catch(() => null) : null;
  if (!channel?.isTextBased() || channel.isDMBased()) return;
  const sent = await channel.send(approvalPayload(request, promotion, guild) as any);
  await context.api.updatePolicePromotionApprovalMessage(request.id, { approvalChannelId: channel.id, approvalMessageId: sent.id }).catch(() => null);
}

async function openDecisionModal(interaction: ButtonInteraction<"cached">, result: "approved" | "rejected", context: BotContext) {
  const request = await context.api.getPolicePromotionRequest(interaction.customId.split(":")[2]!);
  if (request.status !== "pending_approval") {
    await interaction.reply({ content: "Esta solicitação não está aguardando aprovação.", ephemeral: true });
    return true;
  }
  const settings = await getSettings(context, interaction.guild.id);
  const promotion = promotionFor(settings, request);
  const roleIds = result === "approved" ? promotion?.approvalRoleIds ?? [] : promotion?.rejectedRoleIds ?? [];
  if (!promotion || !hasAnyRole(interaction.member as GuildMember, roleIds)) {
    await interaction.reply({ content: "Você não possui permissão para decidir esta promoção.", ephemeral: true });
    return true;
  }

  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:decision_modal:${request.id}:${result}`)
    .setTitle(result === "approved" ? "Aprovar Promoção" : "Reprovar Promoção");
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId("reason")
      .setLabel(result === "approved" ? "Motivo da aprovação" : "Motivo da reprovação")
      .setMaxLength(1000)
      .setRequired(result === "rejected")
      .setStyle(TextInputStyle.Paragraph)
  ));
  await interaction.showModal(modal);
  return true;
}

async function handleDecisionModal(interaction: ModalSubmitInteraction<"cached">, context: BotContext) {
  const [, , requestId, result] = interaction.customId.split(":");
  if (!requestId || (result !== "approved" && result !== "rejected")) return true;
  const request = await context.api.getPolicePromotionRequest(requestId);
  const settings = await getSettings(context, interaction.guild.id);
  const promotion = promotionFor(settings, request);
  if (!promotion) {
    await interaction.reply({ content: "Configuração da promoção não encontrada.", ephemeral: true });
    return true;
  }

  const updated = await context.api.decidePolicePromotionRequest(request.id, {
    actorId: interaction.user.id,
    actorName: displayName(interaction.member as GuildMember, interaction.user.username),
    approvalReason: interaction.fields.getTextInputValue("reason") || null,
    result
  });

  if (result === "approved") await applyPromotionRoles(interaction.guild, promotion, updated);
  await notifyRequester(interaction.guild, updated, promotion).catch(() => null);
  await interaction.reply({ content: result === "approved" ? "Promoção aprovada." : "Promoção reprovada.", ephemeral: true });
  if (interaction.message) await interaction.message.edit(approvalPayload(updated, promotion, interaction.guild, true) as any).catch(() => null);
  return true;
}

async function requestNewEvaluation(interaction: ButtonInteraction<"cached">, context: BotContext) {
  const request = await context.api.getPolicePromotionRequest(interaction.customId.split(":")[2]!);
  const settings = await getSettings(context, interaction.guild.id);
  const promotion = promotionFor(settings, request);
  if (!promotion?.requestNewEvaluationEnabled) {
    await interaction.reply({ content: "Nova avaliação não está habilitada para esta promoção.", ephemeral: true });
    return true;
  }
  if (!hasAnyRole(interaction.member as GuildMember, [...promotion.approvalRoleIds, ...promotion.rejectedRoleIds])) {
    await interaction.reply({ content: "Você não possui permissão para solicitar nova avaliação.", ephemeral: true });
    return true;
  }

  const cloned = await context.api.clonePolicePromotionRequest(request.id, { actorId: interaction.user.id, actorName: interaction.user.username });
  const updated = await createPromotionTicket(interaction.guild, context, settings, promotion, cloned);
  await interaction.reply({ content: `Nova avaliação criada: <#${updated.channelId}>`, ephemeral: true });
  return true;
}

async function closeTicket(interaction: ButtonInteraction<"cached">, context: BotContext, status: "cancelled" | "closed") {
  const request = await requestFromInteraction(interaction, context);
  const settings = await getSettings(context, interaction.guild.id);
  const promotion = promotionFor(settings, request);
  if (status === "cancelled" && request.requesterId !== interaction.user.id && !hasAnyRole(interaction.member as GuildMember, promotion?.evaluatorRoleIds ?? [])) {
    await interaction.reply({ content: "Você não pode cancelar esta solicitação.", ephemeral: true });
    return true;
  }
  await context.api.closePolicePromotionRequest(request.id, { actorId: interaction.user.id, actorName: interaction.user.username, status });
  await interaction.reply({ content: status === "cancelled" ? "Solicitação cancelada. O canal será removido." : "Ticket fechado. O canal será removido.", ephemeral: true });
  setTimeout(() => {
    if (interaction.channel && !interaction.channel.isDMBased() && "delete" in interaction.channel) {
      void interaction.channel.delete().catch(() => null);
    }
  }, 3000).unref?.();
  return true;
}

async function requestFromInteraction(interaction: ButtonInteraction<"cached">, context: BotContext) {
  const requestId = interaction.customId.split(":")[2];
  return requestId ? context.api.getPolicePromotionRequest(requestId) : context.api.getPolicePromotionRequestByChannel(interaction.channelId).then((request) => {
    if (!request) throw new Error("Solicitação não encontrada.");
    return request;
  });
}

function panelPayload(settings: PolicePromotionSettings, guild: Guild): MessageCreateOptions {
  const promotions = settings.promotions.filter((item) => item.active);
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:choose`)
    .setPlaceholder("Selecione a promoção desejada")
    .addOptions(promotions.slice(0, 25).map((promotion) => ({
      description: clip(promotion.description, 90),
      emoji: promotion.emoji ?? undefined,
      label: clip(promotion.name, 80),
      value: promotion.id
    })));
  return {
    allowedMentions: { parse: [] },
    components: [{
      type: 17,
      accent_color: parseColor(promotions[0]?.color ?? "#2563eb"),
      components: [
        { type: 10, content: [`# ${icon("prancheta_acertos", guild)} Sistema de Promoções`, "Solicite sua avaliação de promoção pelo seletor abaixo.", "", promotions.map((item) => `• ${item.emoji ?? icon("prancheta", guild)} **${escapeMarkdown(item.name)}** → ${escapeMarkdown(item.receivedRankName)}`).join("\n") || "Nenhuma promoção ativa configurada."].join("\n") },
        ...(promotions.length ? [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)] : [])
      ]
    }],
    flags: MessageFlags.IsComponentsV2
  };
}

function promotionListPayload(settings: PolicePromotionSettings, guild: Guild): MessageCreateOptions {
  return {
    components: [{
      type: 17,
      accent_color: 0x2563eb,
      components: [{ type: 10, content: [`# ${icon("prancheta", guild)} Promoções configuradas`, settings.promotions.map((item) => `• ${item.active ? icon("visto", guild) : icon("porta", guild)} **${escapeMarkdown(item.name)}** - ${escapeMarkdown(item.receivedRankName)}`).join("\n") || "Nenhuma promoção configurada."].join("\n") }]
    }],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  };
}

function ticketPayload(request: PolicePromotionRequest, promotion: PolicePromotionDefinition, guild: Guild): MessageCreateOptions {
  const status = statusLabel(request.status);
  const rows = [
    `# ${icon("prancheta_acertos", guild)} Solicitação de Avaliação - ${escapeMarkdown(request.targetRank)}`,
    DIVIDER,
    `${icon("homem", guild)} Nome\n<@${request.requesterId}>`,
    "",
    `${icon("prancheta", guild)} Patente Atual\n${escapeMarkdown(request.currentRank)}`,
    "",
    `${icon("trofeu", guild)} Patente Solicitada\n${escapeMarkdown(request.targetRank)}`,
    "",
    `${icon("discord", guild)} ID In Game\n${escapeMarkdown(request.inGameId)}`,
    "",
    `${icon("calendario", guild)} Data e Horário\n${escapeMarkdown(request.requestedDate)} • ${escapeMarkdown(request.requestedTime)}`,
    "",
    `${icon("relogio", guild)} Status\n${status}`,
    request.evaluatorId ? `\n${icon("homem", guild)} Instrutor Responsável\n<@${request.evaluatorId}>` : ""
  ].join("\n");
  const buttons = request.status === "ticket_open"
    ? new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:assign:${request.id}`).setEmoji(systemComponentEmoji("acessar", guild)).setLabel("Assumir Avaliação").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PREFIX}:cancel:${request.id}`).setEmoji(systemComponentEmoji("exclamacao", guild)).setLabel("Cancelar").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`${PREFIX}:close:${request.id}`).setEmoji(systemComponentEmoji("porta", guild)).setLabel("Fechar Ticket").setStyle(ButtonStyle.Secondary)
    )
    : new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:finish:${request.id}`).setEmoji(systemComponentEmoji("visto", guild)).setLabel("Finalizar Avaliação").setStyle(ButtonStyle.Success).setDisabled(request.status !== "in_evaluation"),
      new ButtonBuilder().setCustomId(`${PREFIX}:close:${request.id}`).setEmoji(systemComponentEmoji("porta", guild)).setLabel("Fechar Ticket").setStyle(ButtonStyle.Secondary)
    );
  return {
    allowedMentions: { users: [request.requesterId, ...(request.evaluatorId ? [request.evaluatorId] : [])] },
    components: [{
      type: 17,
      accent_color: parseColor(promotion.color),
      components: [
        { type: 10, content: rows },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: `## ${icon("folha", guild)} Respostas do formulário\n${answersText(request)}` },
        buttons
      ]
    }],
    flags: MessageFlags.IsComponentsV2
  };
}

function approvalPayload(request: PolicePromotionRequest, promotion: PolicePromotionDefinition, guild: Guild, disabled = false): MessageCreateOptions {
  return {
    allowedMentions: { parse: [] },
    components: [{
      type: 17,
      accent_color: request.status === "approved" ? 0x22c55e : request.status === "rejected" ? 0xef4444 : parseColor(promotion.color),
      components: [
        { type: 10, content: [
          `# ${icon("visto", guild)} Fila de Aprovação - ${escapeMarkdown(request.targetRank)}`,
          DIVIDER,
          `${icon("homem", guild)} Solicitante\n<@${request.requesterId}>`,
          "",
          `${icon("prancheta", guild)} Patente Atual\n${escapeMarkdown(request.currentRank)}`,
          "",
          `${icon("trofeu", guild)} Patente Destino\n${escapeMarkdown(request.targetRank)}`,
          "",
          `${icon("homem", guild)} Instrutor\n${request.evaluatorId ? `<@${request.evaluatorId}>` : "Não informado"}`,
          "",
          `${icon("folha", guild)} Resultado da avaliação\n${escapeMarkdown(request.evaluationResult ?? "Aguardando decisão")}`,
          "",
          `${icon("prancheta_caneta", guild)} Observações\n${escapeMarkdown(request.evaluationNotes ?? "Nenhuma observação registrada.")}`,
          "",
          `${icon("relogio", guild)} Tempo da avaliação\n${evaluationDuration(request)}`,
          "",
          `${icon("discord", guild)} ID da solicitação\n\`${request.id}\``
        ].join("\n") },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: `## ${icon("folha", guild)} Respostas\n${answersText(request)}` },
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:approve:${request.id}`).setEmoji(systemComponentEmoji("visto", guild)).setLabel("Aprovar Promoção").setStyle(ButtonStyle.Success).setDisabled(disabled),
          new ButtonBuilder().setCustomId(`${PREFIX}:reject:${request.id}`).setEmoji(systemComponentEmoji("exclamacao", guild)).setLabel("Reprovar Promoção").setStyle(ButtonStyle.Danger).setDisabled(disabled),
          new ButtonBuilder().setCustomId(`${PREFIX}:new_eval:${request.id}`).setEmoji(systemComponentEmoji("relogio", guild)).setLabel("Solicitar Nova Avaliação").setStyle(ButtonStyle.Secondary).setDisabled(disabled || !promotion.requestNewEvaluationEnabled)
        )
      ]
    }],
    flags: MessageFlags.IsComponentsV2
  };
}

function confirmationPayload(session: PromotionFormSession, warning: string | null = null, confirmed = false): MessageCreateOptions {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:confirm`)
    .setPlaceholder("Confirme seus dados")
    .setMinValues(2)
    .setMaxValues(2)
    .addOptions([
      { label: "Confirmo que todas as informações são verdadeiras", value: "truth", emoji: "✔️" },
      { label: "Estou ciente que informações falsas resultarão em reprovação", value: "aware", emoji: "✔️" }
    ]);
  return {
    components: [{
      type: 17,
      accent_color: parseColor(session.promotion.color),
      components: [
        { type: 10, content: [`# Confirme seus dados`, warning ? `${icon("exclamacao")} ${warning}` : "Revise as respostas e confirme para enviar.", "", answersText({ answers: session.answers } as PolicePromotionRequest)].join("\n") },
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
        new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:send`).setEmoji(systemComponentEmoji("visto")).setLabel("Enviar Solicitação").setStyle(ButtonStyle.Success).setDisabled(!confirmed))
      ]
    }],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  };
}

function evaluationResultPayload(request: PolicePromotionRequest, promotion: PolicePromotionDefinition, guild: Guild): MessageCreateOptions {
  return {
    components: [{
      type: 17,
      accent_color: parseColor(promotion.color),
      components: [
        { type: 10, content: [`# ${icon("prancheta_caneta", guild)} Confirmar resultado da avaliação`, `Solicitação: \`${request.id}\``, "", "Escolha o resultado final da avaliação para enviar à fila de aprovação."].join("\n") },
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:eval_result:${request.id}:approved`).setEmoji(systemComponentEmoji("visto", guild)).setLabel("Aprovar Avaliação").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`${PREFIX}:eval_result:${request.id}:rejected`).setEmoji(systemComponentEmoji("exclamacao", guild)).setLabel("Reprovar Avaliação").setStyle(ButtonStyle.Danger)
        )
      ]
    }],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  };
}

function nextStepPayload(session: PromotionFormSession): MessageCreateOptions {
  return {
    components: [{
      type: 17,
      accent_color: parseColor(session.promotion.color),
      components: [
        { type: 10, content: `# Resposta registrada\nClique em **Continuar** para avançar no formulário.` },
        new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:continue`).setEmoji(systemComponentEmoji("acessar")).setLabel("Continuar").setStyle(ButtonStyle.Primary))
      ]
    }],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  };
}

async function applyPromotionRoles(guild: Guild, promotion: PolicePromotionDefinition, request: PolicePromotionRequest) {
  const member = await guild.members.fetch(request.requesterId).catch(() => null);
  if (!member) return;
  if (promotion.grantedRoleId) await member.roles.add(promotion.grantedRoleId, `Promoção aprovada ${request.id}`).catch(() => null);
  if (promotion.removedRoleId) await member.roles.remove(promotion.removedRoleId, `Promoção aprovada ${request.id}`).catch(() => null);
}

async function notifyRequester(guild: Guild, request: PolicePromotionRequest, promotion: PolicePromotionDefinition) {
  const user = await guild.client.users.fetch(request.requesterId);
  await user.send({
    components: [{
      type: 17,
      accent_color: request.status === "approved" ? 0x22c55e : 0xef4444,
      components: [{ type: 10, content: request.status === "approved"
        ? [`# Parabéns!`, `Sua solicitação para promoção à patente de **${escapeMarkdown(request.targetRank)}** foi aprovada.`, "", `Responsável: ${request.approvedById ? `<@${request.approvedById}>` : "Administrador"}`, `Data: ${request.approvedAt ? formatDate(request.approvedAt) : formatDate(new Date().toISOString())}`, "", `Observações:\n${escapeMarkdown(request.approvalReason ?? "Nenhuma observação registrada.")}`].join("\n")
        : [`# Solicitação reprovada`, `Sua solicitação para promoção foi reprovada.`, "", `Motivo:\n${escapeMarkdown(request.approvalReason ?? "Não informado")}`, "", "Você poderá solicitar uma nova avaliação posteriormente."].join("\n")
      }]
    }],
    flags: MessageFlags.IsComponentsV2
  } as any);
}

function activeQuestions(promotion: PolicePromotionDefinition) {
  return promotion.questions.filter((item) => item.active).sort((a, b) => a.order - b.order);
}

function isModalQuestion(question: PolicePromotionQuestion) {
  return ["short", "paragraph", "number", "date", "time"].includes(question.type);
}

function setAnswer(session: PromotionFormSession, question: PolicePromotionQuestion, value: string | string[]) {
  const answer: PolicePromotionAnswer = { questionId: question.id, label: question.label, type: question.type, value };
  session.answers = [...session.answers.filter((item) => item.questionId !== question.id), answer];
}

function answerFor(session: PromotionFormSession, question: PolicePromotionQuestion) {
  return session.answers.find((item) => item.questionId === question.id) ?? null;
}

function getSession(interaction: Interaction) {
  return formSessions.get(sessionKey(interaction.guildId!, interaction.user.id)) ?? null;
}

function sessionKey(guildId: string, userId: string) {
  return `${guildId}:${userId}`;
}

function evaluationDraftKey(requestId: string, userId: string) {
  return `${requestId}:${userId}`;
}

function promotionFor(settings: PolicePromotionSettings, request: PolicePromotionRequest) {
  return settings.promotions.find((item) => item.id === request.promotionId) ?? null;
}

async function getSettings(context: BotContext, guildId: string) {
  const key = `${MODULE_ID}:${guildId}`;
  const cached = settingsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.settings;
  const settings = await context.api.getPolicePromotionSettings(guildId);
  settingsCache.set(key, { expiresAt: Date.now() + SETTINGS_TTL_MS, settings });
  return settings;
}

function hasAnyRole(member: GuildMember | null, roleIds: string[]) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  if (!roleIds.length) return false;
  return member.roles.cache.some((role) => roleIds.includes(role.id));
}

function answersText(request: Pick<PolicePromotionRequest, "answers">) {
  return request.answers.map((answer) => {
    const value = Array.isArray(answer.value) ? answer.value.join(", ") : answer.value;
    return `▸ **${escapeMarkdown(answer.label)}**\n${escapeMarkdown(value || "Não informado")}`;
  }).join("\n\n") || "Nenhuma resposta registrada.";
}

function statusLabel(status: PolicePromotionRequest["status"]) {
  const labels: Record<PolicePromotionRequest["status"], string> = {
    approved: "Aprovado",
    cancelled: "Cancelado",
    closed: "Fechado",
    in_evaluation: "Em Avaliação",
    pending_approval: "Aguardando Aprovação",
    rejected: "Reprovado",
    submitted: "Enviado",
    ticket_open: "Aguardando Instrutor"
  };
  return labels[status];
}

function evaluationDuration(request: PolicePromotionRequest) {
  if (!request.evaluationStartedAt || !request.evaluationEndedAt) return "Não calculado";
  const minutes = Math.max(0, Math.round((Date.parse(request.evaluationEndedAt) - Date.parse(request.evaluationStartedAt)) / 60000));
  return `${minutes} minuto(s)`;
}

async function replyOrUpdate(interaction: ButtonInteraction<"cached"> | StringSelectMenuInteraction<"cached"> | ModalSubmitInteraction<"cached">, payload: any) {
  if (interaction.isModalSubmit()) return interaction.reply(payload);
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  if (interaction.isButton() || interaction.isStringSelectMenu()) {
    return interaction.customId.includes(":choose") ? interaction.reply(payload) : interaction.update(payload);
  }
}

function displayName(member: GuildMember | null, fallback: string) {
  return member?.displayName ?? fallback;
}

function icon(key: Parameters<typeof systemEmojiText>[0], guild?: Guild | null) {
  return systemEmojiText(key, guild);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value));
}

function parseColor(value: string) {
  const hex = value.replace("#", "");
  return /^[0-9a-f]{6}$/i.test(hex) ? Number.parseInt(hex, 16) : 0x2563eb;
}

function clip(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength - 1) : value;
}

function escapeMarkdown(value: string) {
  return String(value ?? "").replace(/([\\*_`~|])/g, "\\$1");
}

function sanitizeChannelName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "usuario";
}

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
  type Client,
  type Guild,
  type GuildMember,
  type Interaction,
  type Message,
  type MessageCreateOptions,
  type ModalSubmitInteraction
} from "discord.js";
import { currentRuntimeBotId, env, isBotModuleEnabled } from "../config/env";
import { FIXED_SYSTEM_EMOJI_BY_KEY, normalizeFixedSystemEmojiText, SYSTEM_EMOJIS, type SystemEmojiKey } from "../config/systemEmojis";
import type { BotCommand, BotContext } from "../types";
import { cacheGuildSystemEmojis, fetchApplicationEmojis, refreshSystemEmojis, replaceSystemEmojis, systemComponentEmoji, systemEmojiText } from "./systemEmojiService";
import type { PolicePromotionAnswer, PolicePromotionDefinition, PolicePromotionQuestion, PolicePromotionRequest, PolicePromotionSettings } from "./apiClient";
import type { PolicePromotionPanelPublishAck } from "../websocket/socketClient";
import { resolvePanelImageUrl, type PanelVisualConfig } from "./panelVisualRenderer";

const MODULE_ID = "police-promotions";
const PREFIX = "police_promotions";
const SETTINGS_TTL_MS = 30_000;
const DIVIDER = "━━━━━━━━━━━━━━━━━━━━━━";
const CUSTOM_EMOJI_PATTERN = /^<a?:[a-zA-Z0-9_]{2,32}:\d{5,32}>$/;
const SYSTEM_PROMOTION_EMOJI_KEYS = new Set<SystemEmojiKey>([
  "visto",
  "trofeu_alt",
  "trofeu",
  "robo",
  "relogio",
  "prancheta",
  "prancheta_caneta",
  "porta",
  "perigo",
  "link",
  "liga",
  "interrogacao",
  "engrenagem",
  "homem",
  "folha",
  "exclamacao",
  "discord",
  "dinheiro",
  "prancheta_acertos",
  "calendario",
  "caixa",
  "aniversario",
  "alerta",
  "acessar",
  "nuvem",
  "arma"
]);
const SYSTEM_PROMOTION_EMOJI_KEY_BY_ALIAS = new Map<string, SystemEmojiKey>(
  SYSTEM_EMOJIS.flatMap((item) => [item.key, item.name, ...(item.aliases ?? [])].map((alias) => [alias, item.key] as const))
    .filter(([, key]) => SYSTEM_PROMOTION_EMOJI_KEYS.has(key))
);
const SYSTEM_PROMOTION_EMOJI_KEY_BY_ID = new Map<string, SystemEmojiKey>(
  Object.entries(FIXED_SYSTEM_EMOJI_BY_KEY)
    .filter(([key]) => SYSTEM_PROMOTION_EMOJI_KEYS.has(key as SystemEmojiKey))
    .map(([key, item]) => [item.emojiId, key as SystemEmojiKey])
);

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

type EvaluationDraft = {
  finalResult: "approved" | "rejected";
  notes: string;
  requestId: string;
  scoreLine: string;
};

type EvaluationStep = "patrol" | "operational" | "conduct" | "notes" | "final";

type EvaluationQuestionnaireDraft = {
  awaitingStep?: EvaluationStep;
  conduct?: string;
  final?: string;
  guildId: string;
  notes?: string;
  operational?: string;
  pending?: { answer: string; messageId?: string; step: EvaluationStep };
  patrol?: string;
  requestId: string;
  updatedAt: number;
  userId: string;
};

const settingsCache = new Map<string, { expiresAt: number; settings: PolicePromotionSettings }>();
const formSessions = new Map<string, PromotionFormSession>();
const evaluationQuestionnaireDrafts = new Map<string, EvaluationQuestionnaireDraft>();
const evaluationDrafts = new Map<string, EvaluationDraft>();
let serviceStarted = false;

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

    await publishPromotionPanel(interaction, context, settings);
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
  if (action === "eval_step" && interaction.isButton()) return openEvaluationStepModal(interaction, context);
  if (action === "eval_step_modal" && interaction.isModalSubmit()) return handleEvaluationStepModal(interaction, context);
  if (action === "eval_step_confirm" && interaction.isButton()) return confirmEvaluationStep(interaction, context);
  if (action === "eval_step_edit" && interaction.isButton()) return editPendingEvaluationStep(interaction, context);
  if (action === "eval_panel" && interaction.isButton()) return showEvaluationPanel(interaction, context);
  if (action === "eval_review" && interaction.isButton()) return handleEvaluationReview(interaction, context);
  if (action === "eval_submit" && interaction.isButton()) return submitEvaluationReview(interaction, context);
  if (action === "eval_cancel" && interaction.isButton()) return cancelEvaluationQuestionnaire(interaction, context);
  if (action === "eval_cancel_confirm" && interaction.isButton()) return confirmCancelEvaluationQuestionnaire(interaction, context);
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
  if (await captureEvaluationStepMessage(message, context, request)) return true;
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

async function captureEvaluationStepMessage(message: Message, context: BotContext, request: PolicePromotionRequest) {
  if (request.status !== "in_evaluation" || request.evaluatorId !== message.author.id || !request.evaluatorId) return false;
  const draft = evaluationQuestionnaireDrafts.get(evaluationDraftKey(request.id, request.evaluatorId)) ?? evaluationDraftFromRequest(request, request.evaluatorId, message.guild!.id);
  const step = draft.awaitingStep;
  if (!step || draft.pending || step !== nextAvailableEvaluationStep(draft)) return false;
  const answer = clip(message.content.trim(), 1800);
  if (!answer) return false;

  const settings = await getSettings(context, message.guild!.id);
  const promotion = promotionFor(settings, request);
  if (!promotion) return false;

  draft.awaitingStep = undefined;
  draft.pending = { answer, messageId: message.id, step };
  draft.updatedAt = Date.now();
  evaluationQuestionnaireDrafts.set(evaluationDraftKey(request.id, request.evaluatorId), draft);
  await context.api.addPolicePromotionHistory(request.id, {
    action: "request.evaluation_step_pending",
    actorId: message.author.id,
    actorName: message.author.username,
    metadata: {
      answer,
      channelId: message.channelId,
      messageId: message.id,
      step,
      stepName: evaluationStepTitle(step)
    }
  }).catch(() => null);
  await message.delete().catch(() => null);
  const panelImage = await loadPromotionPanelImage(message.guild!.id, context);
  await updateEvaluationChannelMessage(message, request, evaluationStepConfirmationPayload(request, promotion, message.guild!, draft, step, false, panelImage));
  return true;
}

export function clearPolicePromotionSettingsCache(guildId?: string | null) {
  for (const key of settingsCache.keys()) {
    if (!guildId || key.endsWith(`:${guildId}`)) settingsCache.delete(key);
  }
}

export function startPolicePromotionService(client: Client, context: BotContext) {
  if (serviceStarted) return;
  serviceStarted = true;
  context.socket.onPolicePromotionPanelPublish((payload, ack?: PolicePromotionPanelPublishAck) => {
    const runtimeBotId = (currentRuntimeBotId() ?? env.DASHBOARD_BOT_ID) || null;
    if (!isBotModuleEnabled(MODULE_ID) || (payload.botId && runtimeBotId && payload.botId !== runtimeBotId)) return;
    void publishConfiguredPromotionPanel(client, context, payload.guildId)
      .then((messageId) => ack?.({ ok: true, messageId }))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[police-promotions] falha ao publicar painel em ${payload.guildId}:`, message);
        ack?.({ ok: false, error: message });
      });
  });
}

async function publishPromotionPanel(interaction: ChatInputCommandInteraction<"cached">, context: BotContext, settings: PolicePromotionSettings) {
  const channelId = settings.defaultPanelChannelId;
  const target = channelId ? await interaction.guild.channels.fetch(channelId).catch(() => null) : interaction.channel;
  if (!target?.isTextBased() || target.isDMBased()) {
    await interaction.reply({ content: "Canal do painel inválido.", ephemeral: true });
    return;
  }

  await refreshPromotionSystemEmojis(interaction.guild, context);
  const panelImage = await loadPromotionPanelImage(interaction.guild.id, context);
  await target.send(panelPayload(settings, interaction.guild, panelImage) as any);
  await interaction.reply({ content: "Painel de promoções publicado.", ephemeral: true });
}

async function publishConfiguredPromotionPanel(client: Client, context: BotContext, guildId: string) {
  clearPolicePromotionSettingsCache(guildId);
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) throw new Error("O bot não está conectado ao servidor selecionado.");
  const settings = await getSettings(context, guild.id);
  if (!settings.enabled) throw new Error("Sistema de Promoções desativado.");
  if (!settings.defaultPanelChannelId) throw new Error("Canal padrão do painel não configurado.");
  const channel = await guild.channels.fetch(settings.defaultPanelChannelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) throw new Error("Canal padrão do painel inválido.");
  await refreshPromotionSystemEmojis(guild, context);
  if (!("send" in channel)) throw new Error("O canal padrão não permite envio de mensagens pelo bot.");
  const panelImage = await loadPromotionPanelImage(guild.id, context);
  const message = await channel.send(panelPayload(settings, guild, panelImage) as any);
  return message.id;
}

async function handlePromotionChoose(interaction: StringSelectMenuInteraction<"cached">, context: BotContext) {
  await resetPromotionSelectDisplay(interaction);

  if (!interaction.values.length) {
    formSessions.delete(sessionKey(interaction.guild.id, interaction.user.id));
    await interaction.reply({ content: "Seleção removida.", ephemeral: true });
    return true;
  }

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

async function resetPromotionSelectDisplay(interaction: StringSelectMenuInteraction<"cached">) {
  const components = interaction.message.components.map((component) => component.toJSON());
  if (!components.length) return;
  await interaction.message.edit({ components } as any).catch(() => null);
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
  await interaction.deferUpdate();
  try {
    const request = await requestFromInteraction(interaction, context);
    const settings = await getSettings(context, interaction.guild.id);
    const promotion = promotionFor(settings, request);
    if (!promotion || !hasAnyRole(interaction.member as GuildMember, promotion.evaluatorRoleIds)) {
      await interaction.followUp({ content: "Você não possui permissão para assumir esta avaliação.", ephemeral: true });
      return true;
    }

    const updated = await context.api.assignPolicePromotionEvaluator(request.id, { evaluatorId: interaction.user.id, evaluatorName: displayName(interaction.member as GuildMember, interaction.user.username) });
    await interaction.editReply(ticketPayload(updated, promotion, interaction.guild) as any);
  } catch (error) {
    console.error("[police-promotions] failed to assign evaluation", error);
    await interaction.followUp({ content: "Não foi possível assumir esta avaliação agora. Verifique se o ticket ainda existe e tente novamente.", ephemeral: true }).catch(() => null);
  }
  return true;
}

async function openEvaluationModal(interaction: ButtonInteraction<"cached">, context: BotContext) {
  const request = await requestFromInteraction(interaction, context);
  if (request.evaluatorId !== interaction.user.id) {
    await interaction.reply({ content: "Você não é o responsável por esta avaliação.", ephemeral: true });
    return true;
  }

  const settings = await getSettings(context, interaction.guild.id);
  const promotion = promotionFor(settings, request);
  if (!promotion) {
    await interaction.reply({ content: "Configuração da promoção não encontrada.", ephemeral: true });
    return true;
  }

  const key = evaluationDraftKey(request.id, interaction.user.id);
  const draft = evaluationQuestionnaireDrafts.get(key) ?? evaluationDraftFromRequest(request, interaction.user.id, interaction.guild.id);
  evaluationQuestionnaireDrafts.set(key, draft);
  const panelImage = await loadPromotionPanelImage(interaction.guild.id, context);
  await interaction.update(evaluationQuestionnairePayload(request, promotion, interaction.guild, draft, null, false, panelImage) as any);
  return true;
}

async function openEvaluationStepModal(interaction: ButtonInteraction<"cached">, context: BotContext) {
  const [, , requestId, step] = interaction.customId.split(":");
  if (!requestId || !isEvaluationStep(step)) return true;
  const request = await context.api.getPolicePromotionRequest(requestId);
  if (request.evaluatorId !== interaction.user.id) {
    await interaction.reply({ content: "Esta avaliação pertence a outro avaliador.", ephemeral: true });
    return true;
  }
  if (request.status !== "in_evaluation") {
    await interaction.reply({ content: "Esta avaliação não está em preenchimento.", ephemeral: true });
    return true;
  }
  const settings = await getSettings(context, interaction.guild.id);
  const promotion = promotionFor(settings, request);
  if (!promotion) {
    await interaction.reply({ content: "Configuração da promoção não encontrada.", ephemeral: true });
    return true;
  }
  const key = evaluationDraftKey(requestId, interaction.user.id);
  const draft = evaluationQuestionnaireDrafts.get(key) ?? evaluationDraftFromRequest(request, interaction.user.id, interaction.guild.id);
  if (draft.pending) {
    await interaction.reply({ content: "Já existe uma resposta aguardando confirmação. Confirme, refaça ou cancele antes de iniciar outra etapa.", ephemeral: true });
    return true;
  }
  if (draft.awaitingStep && draft.awaitingStep !== step) {
    await interaction.reply({ content: "Já existe uma etapa aguardando resposta. Cancele ou conclua a etapa aberta antes de continuar.", ephemeral: true });
    return true;
  }
  const nextStep = nextAvailableEvaluationStep(draft);
  if (step !== nextStep) {
    await interaction.reply({ content: "Esta etapa ainda não está disponível. Conclua a etapa anterior para continuar.", ephemeral: true });
    return true;
  }
  draft.awaitingStep = step;
  draft.updatedAt = Date.now();
  evaluationQuestionnaireDrafts.set(key, draft);
  await context.api.addPolicePromotionHistory(request.id, {
    action: "request.evaluation_step_started",
    actorId: interaction.user.id,
    actorName: displayName(interaction.member as GuildMember, interaction.user.username),
    metadata: { channelId: interaction.channelId, step, stepName: evaluationStepTitle(step) }
  }).catch(() => null);
  const panelImage = await loadPromotionPanelImage(interaction.guild.id, context);
  await interaction.update(evaluationQuestionnairePayload(request, promotion, interaction.guild, draft, "Envie sua resposta no canal. A próxima mensagem enviada por você será capturada.", false, panelImage) as any);
  return true;
}

async function handleEvaluationStepModal(interaction: ModalSubmitInteraction<"cached">, context: BotContext) {
  const [, , requestId, step] = interaction.customId.split(":");
  if (!requestId || !isEvaluationStep(step)) return true;
  const request = await context.api.getPolicePromotionRequest(requestId);
  if (request.evaluatorId !== interaction.user.id) {
    await interaction.reply({ content: "Você não é o responsável por esta avaliação.", ephemeral: true });
    return true;
  }

  const settings = await getSettings(context, interaction.guild.id);
  const promotion = promotionFor(settings, request);
  if (!promotion) {
    await interaction.reply({ content: "Configuração da promoção não encontrada.", ephemeral: true });
    return true;
  }

  const key = evaluationDraftKey(request.id, interaction.user.id);
  const draft = evaluationQuestionnaireDrafts.get(key) ?? evaluationDraftFromRequest(request, interaction.user.id, interaction.guild.id);
  draft.pending = { answer: evaluationStepAnswer(step, interaction), step };
  draft.updatedAt = Date.now();
  evaluationQuestionnaireDrafts.set(key, draft);
  await updateModalMessageOrReply(interaction, evaluationStepConfirmationPayload(request, promotion, interaction.guild, draft, step));
  return true;
}

async function confirmEvaluationStep(interaction: ButtonInteraction<"cached">, context: BotContext) {
  const requestId = interaction.customId.split(":")[2];
  if (!requestId) return true;
  const request = await context.api.getPolicePromotionRequest(requestId);
  if (request.evaluatorId !== interaction.user.id) {
    await interaction.reply({ content: "Esta avaliação pertence a outro avaliador.", ephemeral: true });
    return true;
  }
  if (request.status !== "in_evaluation") {
    await interaction.reply({ content: "Esta avaliação não está em preenchimento.", ephemeral: true });
    return true;
  }

  const settings = await getSettings(context, interaction.guild.id);
  const promotion = promotionFor(settings, request);
  if (!promotion) {
    await interaction.reply({ content: "Configuração da promoção não encontrada.", ephemeral: true });
    return true;
  }

  const key = evaluationDraftKey(request.id, interaction.user.id);
  const draft = evaluationQuestionnaireDrafts.get(key) ?? evaluationDraftFromRequest(request, interaction.user.id, interaction.guild.id);
  const pending = draft.pending;
  if (!pending || pending.step !== nextAvailableEvaluationStep(draft)) {
    await interaction.reply({ content: "Não foi possível confirmar esta etapa. Reabra a etapa disponível e tente novamente.", ephemeral: true });
    return true;
  }

  setEvaluationStepAnswer(draft, pending.step, pending.answer);
  draft.awaitingStep = undefined;
  draft.pending = undefined;
  draft.updatedAt = Date.now();
  evaluationQuestionnaireDrafts.set(key, draft);
  await context.api.addPolicePromotionHistory(request.id, {
    action: "request.evaluation_step_saved",
    actorId: interaction.user.id,
    actorName: displayName(interaction.member as GuildMember, interaction.user.username),
    metadata: {
      answer: pending.answer,
      completedSteps: completedEvaluationSteps(draft),
      messageId: pending.messageId ?? null,
      step: pending.step,
      stepName: evaluationStepTitle(pending.step)
    }
  }).catch(() => null);
  const nextStep = nextAvailableEvaluationStep(draft);
  const successMessage = nextStep
    ? `Etapa concluída. A próxima etapa foi liberada: ${evaluationStepTitle(nextStep)}.`
    : "Etapa concluída. A revisão final foi liberada.";
  const panelImage = await loadPromotionPanelImage(interaction.guild.id, context);
  await interaction.update(evaluationQuestionnairePayload(request, promotion, interaction.guild, draft, successMessage, false, panelImage) as any);
  return true;
}

async function editPendingEvaluationStep(interaction: ButtonInteraction<"cached">, context: BotContext) {
  const requestId = interaction.customId.split(":")[2];
  if (!requestId) return true;
  const request = await context.api.getPolicePromotionRequest(requestId);
  if (request.evaluatorId !== interaction.user.id) {
    await interaction.reply({ content: "Esta avaliação pertence a outro avaliador.", ephemeral: true });
    return true;
  }
  const settings = await getSettings(context, interaction.guild.id);
  const promotion = promotionFor(settings, request);
  if (!promotion) {
    await interaction.reply({ content: "Configuração da promoção não encontrada.", ephemeral: true });
    return true;
  }
  const draft = evaluationQuestionnaireDrafts.get(evaluationDraftKey(requestId, interaction.user.id));
  if (!draft?.pending) {
    await interaction.reply({ content: "Não existe resposta pendente para editar.", ephemeral: true });
    return true;
  }
  const step = draft.pending.step;
  draft.pending = undefined;
  draft.awaitingStep = step;
  draft.updatedAt = Date.now();
  evaluationQuestionnaireDrafts.set(evaluationDraftKey(requestId, interaction.user.id), draft);
  await context.api.addPolicePromotionHistory(request.id, {
    action: "request.evaluation_step_started",
    actorId: interaction.user.id,
    actorName: displayName(interaction.member as GuildMember, interaction.user.username),
    metadata: { channelId: interaction.channelId, refilled: true, step, stepName: evaluationStepTitle(step) }
  }).catch(() => null);
  const panelImage = await loadPromotionPanelImage(interaction.guild.id, context);
  await interaction.update(evaluationQuestionnairePayload(request, promotion, interaction.guild, draft, "Resposta descartada. Envie novamente a resposta desta etapa no canal.", false, panelImage) as any);
  return true;
}

async function showEvaluationPanel(interaction: ButtonInteraction<"cached">, context: BotContext) {
  const requestId = interaction.customId.split(":")[2];
  if (!requestId) return true;
  const request = await context.api.getPolicePromotionRequest(requestId);
  if (request.evaluatorId !== interaction.user.id) {
    await interaction.reply({ content: "Esta avaliação pertence a outro avaliador.", ephemeral: true });
    return true;
  }
  const settings = await getSettings(context, interaction.guild.id);
  const promotion = promotionFor(settings, request);
  if (!promotion) return true;
  const key = evaluationDraftKey(request.id, interaction.user.id);
  const draft = evaluationQuestionnaireDrafts.get(key) ?? evaluationDraftFromRequest(request, interaction.user.id, interaction.guild.id);
  const cancelledStep = draft.pending?.step ?? draft.awaitingStep ?? null;
  draft.pending = undefined;
  draft.awaitingStep = undefined;
  evaluationQuestionnaireDrafts.set(key, draft);
  if (cancelledStep) {
    await context.api.addPolicePromotionHistory(request.id, {
      action: "request.evaluation_step_cancelled",
      actorId: interaction.user.id,
      actorName: displayName(interaction.member as GuildMember, interaction.user.username),
      metadata: { channelId: interaction.channelId, step: cancelledStep, stepName: evaluationStepTitle(cancelledStep) }
    }).catch(() => null);
  }
  const panelImage = await loadPromotionPanelImage(interaction.guild.id, context);
  await interaction.update(evaluationQuestionnairePayload(request, promotion, interaction.guild, draft, cancelledStep ? "Preenchimento cancelado. Nenhuma informação foi salva." : null, false, panelImage) as any);
  return true;
}

async function handleEvaluationReview(interaction: ButtonInteraction<"cached">, context: BotContext) {
  const requestId = interaction.customId.split(":")[2];
  if (!requestId) return true;
  const request = await context.api.getPolicePromotionRequest(requestId);
  if (request.evaluatorId !== interaction.user.id) {
    await interaction.reply({ content: "Você não é o responsável por esta avaliação.", ephemeral: true });
    return true;
  }

  const settings = await getSettings(context, interaction.guild.id);
  const promotion = promotionFor(settings, request);
  if (!promotion) {
    await interaction.reply({ content: "Configuração da promoção não encontrada.", ephemeral: true });
    return true;
  }

  const draft = evaluationQuestionnaireDrafts.get(evaluationDraftKey(request.id, interaction.user.id));
  const missingSteps = missingEvaluationQuestionnaireSteps(draft);
  if (missingSteps.length) {
    const activeDraft = draft ?? createEvaluationQuestionnaireDraft(request, interaction);
    evaluationQuestionnaireDrafts.set(evaluationDraftKey(request.id, interaction.user.id), activeDraft);
    const panelImage = await loadPromotionPanelImage(interaction.guild.id, context);
    await interaction.update(evaluationQuestionnairePayload(request, promotion, interaction.guild, activeDraft, `Ainda falta preencher: ${missingSteps.join(", ")}.`, false, panelImage) as any);
    return true;
  }

  const evaluation = buildPlainClothesEvaluation({
    conduct: draft?.conduct ?? "",
    final: draft?.final ?? "",
    instructorId: interaction.user.id,
    instructorName: displayName(interaction.member as GuildMember, interaction.user.username),
    notes: draft?.notes ?? "",
    operational: draft?.operational ?? "",
    patrol: draft?.patrol ?? "",
    request
  });
  if (evaluation.errors.length) {
    await interaction.reply(validationErrorPayload(evaluation.errors, interaction.guild) as any);
    return true;
  }

  evaluationDrafts.set(evaluationDraftKey(request.id, interaction.user.id), evaluation.draft);
  const panelImage = await loadPromotionPanelImage(interaction.guild.id, context);
  await interaction.update(evaluationReviewPayload(request, promotion, interaction.guild, draft!, evaluation.draft, false, panelImage) as any);
  return true;
}

async function submitEvaluationReview(interaction: ButtonInteraction<"cached">, context: BotContext) {
  const requestId = interaction.customId.split(":")[2];
  if (!requestId) return true;
  const request = await context.api.getPolicePromotionRequest(requestId);
  if (request.evaluatorId !== interaction.user.id) {
    await interaction.reply({ content: "Esta avaliação pertence a outro avaliador.", ephemeral: true });
    return true;
  }
  if (request.status !== "in_evaluation") {
    await interaction.reply({ content: "Esta avaliação já foi enviada ou encerrada.", ephemeral: true });
    return true;
  }

  const settings = await getSettings(context, interaction.guild.id);
  const promotion = promotionFor(settings, request);
  if (!promotion) {
    await interaction.reply({ content: "Configuração da promoção não encontrada.", ephemeral: true });
    return true;
  }

  const draft = evaluationQuestionnaireDrafts.get(evaluationDraftKey(request.id, interaction.user.id)) ?? evaluationDraftFromRequest(request, interaction.user.id, interaction.guild.id);
  const missingSteps = missingEvaluationQuestionnaireSteps(draft);
  if (missingSteps.length) {
    await interaction.reply({ content: "Não foi possível enviar esta avaliação porque ainda existem etapas pendentes.", ephemeral: true });
    return true;
  }

  const evaluation = buildPlainClothesEvaluation({
    conduct: draft.conduct ?? "",
    final: draft.final ?? "",
    instructorId: interaction.user.id,
    instructorName: displayName(interaction.member as GuildMember, interaction.user.username),
    notes: draft.notes ?? "",
    operational: draft.operational ?? "",
    patrol: draft.patrol ?? "",
    request
  });
  if (evaluation.errors.length) {
    await interaction.reply(validationErrorPayload(evaluation.errors, interaction.guild) as any);
    return true;
  }

  await interaction.deferUpdate();
  const updated = await context.api.finishPolicePromotionEvaluation(request.id, { evaluatorId: interaction.user.id, evaluationNotes: evaluation.draft.notes, evaluationResult: evaluation.draft.finalResult });
  evaluationDrafts.delete(evaluationDraftKey(request.id, interaction.user.id));
  evaluationQuestionnaireDrafts.delete(evaluationDraftKey(request.id, interaction.user.id));
  await sendApprovalPanel(interaction.guild, context, settings, promotion, updated);
  await interaction.editReply(evaluationSubmittedPayload(updated, promotion, interaction.guild, false) as any);
  if (interaction.channel?.isTextBased() && !interaction.channel.isDMBased() && "messages" in interaction.channel && updated.channelMessageId) {
    const message = await interaction.channel.messages.fetch(updated.channelMessageId).catch(() => null);
    await message?.edit(ticketPayload(updated, promotion, interaction.guild) as any).catch(() => null);
  }
  return true;
}

async function cancelEvaluationQuestionnaire(interaction: ButtonInteraction<"cached">, context: BotContext) {
  const requestId = interaction.customId.split(":")[2];
  if (!requestId) return true;
  const request = await context.api.getPolicePromotionRequest(requestId);
  if (request.evaluatorId !== interaction.user.id) {
    await interaction.reply({ content: "Esta avaliação pertence a outro avaliador.", ephemeral: true });
    return true;
  }
  await interaction.update({
    components: [{
      type: 17,
      accent_color: 0xef4444,
      components: [
        { type: 10, content: `# ${icon("exclamacao", interaction.guild)} Cancelar avaliação\nTem certeza de que deseja cancelar esta avaliação? Os dados ainda não enviados serão encerrados.` },
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:eval_cancel_confirm:${requestId}`).setEmoji(systemComponentEmoji("exclamacao", interaction.guild)).setLabel("Confirmar cancelamento").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`${PREFIX}:eval_panel:${requestId}`).setEmoji(systemComponentEmoji("porta", interaction.guild)).setLabel("Voltar").setStyle(ButtonStyle.Secondary)
        )
      ]
    }],
    flags: MessageFlags.IsComponentsV2
  } as any);
  return true;
}

async function confirmCancelEvaluationQuestionnaire(interaction: ButtonInteraction<"cached">, context: BotContext) {
  const requestId = interaction.customId.split(":")[2];
  if (requestId) {
    const request = await context.api.getPolicePromotionRequest(requestId);
    if (request.evaluatorId !== interaction.user.id) {
      await interaction.reply({ content: "Esta avaliação pertence a outro avaliador.", ephemeral: true });
      return true;
    }
    evaluationQuestionnaireDrafts.delete(evaluationDraftKey(requestId, interaction.user.id));
    evaluationDrafts.delete(evaluationDraftKey(requestId, interaction.user.id));
    await context.api.addPolicePromotionHistory(requestId, {
      action: "request.evaluation_cancelled",
      actorId: interaction.user.id,
      actorName: displayName(interaction.member as GuildMember, interaction.user.username),
      metadata: { channelId: interaction.channelId }
    }).catch(() => null);
  }
  await interaction.update({
    components: [{
      type: 17,
      accent_color: 0xef4444,
      components: [{ type: 10, content: `# ${icon("exclamacao", interaction.guild)} Avaliação cancelada\nO rascunho desta sessão foi descartado.` }]
    }],
    flags: MessageFlags.IsComponentsV2
  } as any);
  return true;
}

async function handleEvaluationModal(interaction: ModalSubmitInteraction<"cached">, context: BotContext) {
  const requestId = interaction.customId.split(":")[2]!;
  const request = await context.api.getPolicePromotionRequest(requestId);
  if (request.evaluatorId !== interaction.user.id) {
    await interaction.reply({ content: "Você não é o responsável por esta avaliação.", ephemeral: true });
    return true;
  }

  const settings = await getSettings(context, interaction.guild.id);
  const promotion = promotionFor(settings, request);
  if (!promotion) {
    await interaction.reply({ content: "Configuração da promoção não encontrada.", ephemeral: true });
    return true;
  }

  const evaluation = buildPlainClothesEvaluation({
    conduct: interaction.fields.getTextInputValue("conduct"),
    final: interaction.fields.getTextInputValue("final"),
    instructorId: interaction.user.id,
    instructorName: displayName(interaction.member as GuildMember, interaction.user.username),
    notes: interaction.fields.getTextInputValue("notes"),
    operational: interaction.fields.getTextInputValue("operational"),
    patrol: interaction.fields.getTextInputValue("patrol"),
    request
  });
  if (evaluation.errors.length) {
    await interaction.reply(validationErrorPayload(evaluation.errors, interaction.guild) as any);
    return true;
  }

  evaluationDrafts.set(evaluationDraftKey(request.id, interaction.user.id), evaluation.draft);
  await interaction.reply(evaluationResultPayload(request, promotion, interaction.guild, evaluation.draft) as any);
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
  if (result !== draft.finalResult) {
    await interaction.reply({ content: "O resultado selecionado não corresponde ao resultado final informado na avaliação.", ephemeral: true });
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
  evaluationQuestionnaireDrafts.delete(evaluationDraftKey(request.id, interaction.user.id));
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

function panelPayload(settings: PolicePromotionSettings, guild: Guild, panelImage: PanelVisualConfig | null = null): MessageCreateOptions {
  const promotions = settings.promotions.filter((item) => item.active);
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:choose`)
    .setPlaceholder("Selecione a promoção desejada")
    .setMinValues(0)
    .addOptions(promotions.slice(0, 25).map((promotion) => ({
      description: clip(promotion.description, 90),
      emoji: fixedComponentEmoji("prancheta"),
      label: clip(promotion.name, 80),
      value: promotion.id
    })));
  const components: any[] = [];
  const bannerUrl = panelImage?.imageEnabled && panelImage.imageUrl ? resolvePanelImageUrl(panelImage.imageUrl) : null;
  if (bannerUrl && ["banner", "top"].includes(panelImage?.imagePosition ?? "none")) {
    components.push({ type: 12, items: [{ media: { url: bannerUrl }, description: "Sistema de Promoções" }] });
  }
  components.push({ type: 10, content: [`# ${icon("prancheta_acertos", guild)} Sistema de Promoções`, "Solicite sua avaliação de promoção pelo seletor abaixo.", "", promotions.map((item) => `• ${icon("prancheta", guild)} **${escapeMarkdown(item.name)}** → ${escapeMarkdown(item.receivedRankName)}`).join("\n") || "Nenhuma promoção ativa configurada."].join("\n") });
  if (bannerUrl && !["banner", "top"].includes(panelImage?.imagePosition ?? "none")) {
    components.push({ type: 12, items: [{ media: { url: bannerUrl }, description: "Sistema de Promoções" }] });
  }
  if (promotions.length) components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  return {
    allowedMentions: { parse: [] },
    components: [{
      type: 17,
      accent_color: parseColor(promotions[0]?.color ?? "#2563eb"),
      components
    }],
    flags: MessageFlags.IsComponentsV2
  };
}

function topPanelMediaComponents(panelImage: PanelVisualConfig | null, description: string) {
  const bannerUrl = panelImage?.imageEnabled && panelImage.imageUrl ? resolvePanelImageUrl(panelImage.imageUrl) : null;
  return bannerUrl ? [{ type: 12, items: [{ media: { url: bannerUrl }, description }] }] : [];
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
    allowedMentions: { users: uniqueMentionUsers(request.requesterId, request.evaluatorId) },
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
          `# ${icon("prancheta_acertos", guild)} Plain Clothes Day`,
          `## Avaliação aguardando decisão`,
          DIVIDER,
          `${icon("homem", guild)} Avaliado\n<@${request.requesterId}>`,
          "",
          `${icon("prancheta", guild)} Patente Atual\n${escapeMarkdown(request.currentRank)}`,
          "",
          `${icon("trofeu", guild)} Patente Destino\n${escapeMarkdown(request.targetRank)}`,
          "",
          `${icon("homem", guild)} Instrutor\n${request.evaluatorId ? `<@${request.evaluatorId}>` : "Não informado"}`,
          "",
          `${icon("folha", guild)} Recomendação do avaliador\n${escapeMarkdown(request.evaluationResult === "approved" ? "Apto" : request.evaluationResult === "rejected" ? "Não apto" : "Aguardando decisão")}`,
          "",
          `${icon("relogio", guild)} Status administrativo\n${request.status === "approved" ? "APROVADO" : request.status === "rejected" ? "REPROVADO" : "Aguardando análise administrativa"}`,
          request.approvedById ? `\n${icon("homem", guild)} Analisado por\n<@${request.approvedById}>` : "",
          request.approvedAt ? `\n${icon("calendario", guild)} Data da decisão\n${formatDate(request.approvedAt)}` : "",
          "",
          `${icon("prancheta_caneta", guild)} Observações\n${escapeMarkdown(clip(request.evaluationNotes ?? "Nenhuma observação registrada.", 1800))}`,
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

function evaluationResultPayload(request: PolicePromotionRequest, promotion: PolicePromotionDefinition, guild: Guild, draft: EvaluationDraft): MessageCreateOptions {
  const approved = draft.finalResult === "approved";
  return {
    components: [{
      type: 17,
      accent_color: parseColor(promotion.color),
      components: [
        { type: 10, content: [`# ${icon("prancheta_caneta", guild)} Revisão da avaliação`, `Solicitação: \`${request.id}\``, "", draft.scoreLine, "", `Resultado final informado: **${approved ? "Apto" : "Não apto"}**`, "", "Envie a avaliação para a fila de aprovação da promoção."].join("\n") },
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:eval_result:${request.id}:approved`).setEmoji(systemComponentEmoji("visto", guild)).setLabel("Enviar como Apto").setStyle(ButtonStyle.Success).setDisabled(!approved),
          new ButtonBuilder().setCustomId(`${PREFIX}:eval_result:${request.id}:rejected`).setEmoji(systemComponentEmoji("exclamacao", guild)).setLabel("Enviar como Não apto").setStyle(ButtonStyle.Danger).setDisabled(approved)
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

function componentV2Flags(ephemeral = false) {
  return ephemeral ? MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 : MessageFlags.IsComponentsV2;
}

async function updateEvaluationChannelMessage(message: Message, request: PolicePromotionRequest, payload: MessageCreateOptions) {
  if (message.channel.isDMBased() || !("messages" in message.channel)) return;
  const mainMessageId = request.channelMessageId;
  const target = mainMessageId ? await message.channel.messages.fetch(mainMessageId).catch(() => null) : null;
  if (target) {
    await target.edit(payload as any).catch(() => null);
    return;
  }
  await message.channel.send(payload as any).catch(() => null);
}

async function updateModalMessageOrReply(interaction: ModalSubmitInteraction<"cached">, payload: MessageCreateOptions) {
  if (interaction.isFromMessage()) {
    return interaction.update(payload as any).catch(() => interaction.reply(payload as any));
  }
  return interaction.reply(payload as any);
}

function uniqueMentionUsers(...userIds: Array<string | null | undefined>) {
  return [...new Set(userIds.filter((userId): userId is string => Boolean(userId)))];
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

const PCD_RATING_POINTS: Record<string, number> = {
  excelente: 4,
  bom: 3,
  regular: 2,
  ruim: 1
};

const PCD_CRITERIA = [
  { aliases: ["decisoes", "decisao"], section: "operational", title: "Decisões rápidas e eficazes" },
  { aliases: ["abordagens", "abordagem"], section: "operational", title: "Abordagens seguras e profissionais" },
  { aliases: ["acompanhamentos", "acompanhamento"], section: "operational", title: "Acompanhamentos adequados" },
  { aliases: ["comportamento", "profissional"], section: "conduct", title: "Comportamento profissional" },
  { aliases: ["comunicacao", "comunicar"], section: "conduct", title: "Comunicação com colegas e civis" },
  { aliases: ["adaptacao", "adaptar"], section: "conduct", title: "Adaptação a imprevistos" }
] as const;

const EVALUATION_STEPS: EvaluationStep[] = ["patrol", "operational", "conduct", "notes", "final"];

function evaluationQuestionnairePayload(request: PolicePromotionRequest, promotion: PolicePromotionDefinition, guild: Guild, draft: EvaluationQuestionnaireDraft, message: string | null = null, ephemeral = true, panelImage: PanelVisualConfig | null = null): MessageCreateOptions {
  const progress = EVALUATION_STEPS.map((step) => [step, evaluationStepTitle(step), evaluationStepAnswerFor(draft, step)] as const);
  const missingSteps = missingEvaluationQuestionnaireSteps(draft);
  const captureOpen = Boolean(draft.awaitingStep || draft.pending);
  const canReview = missingSteps.length === 0 && !captureOpen;
  const completedCount = completedEvaluationSteps(draft).length;
  const activeStep = draft.awaitingStep ?? draft.pending?.step ?? null;
  const progressMessage = captureOpen
    ? "Conclua ou cancele a etapa em andamento para continuar."
    : missingSteps.length
      ? `Falta preencher: ${escapeMarkdown(missingSteps.join(", "))}.`
      : "Todas as etapas foram concluídas. A avaliação já pode ser revisada e enviada.";
  const components: any[] = [
    ...topPanelMediaComponents(panelImage, "Avaliação Plain Clothes Day"),
    { type: 10, content: [
      `# ${icon("prancheta_caneta", guild)} Avaliação Plain Clothes Day`,
      "Preencha cada etapa do questionário do avaliador.",
      "",
      `${icon("homem", guild)} Avaliado\n<@${request.requesterId}>`,
      "",
      `${icon("homem", guild)} Instrutor\n<@${draft.userId}>`,
      "",
      `${icon("trofeu", guild)} Promoção\n${escapeMarkdown(request.currentRank)} → ${escapeMarkdown(request.targetRank)}`,
      "",
      `${icon("folha", guild)} Progresso\n${completedCount} de ${EVALUATION_STEPS.length} etapas concluídas`,
      message ? `\n${icon(canReview ? "visto" : "alerta", guild)} ${escapeMarkdown(message)}` : "",
      activeStep ? `\n${icon("relogio", guild)} Etapa em andamento\n${escapeMarkdown(evaluationStepTitle(activeStep))}` : "",
      `\n${icon(canReview ? "visto" : "relogio", guild)} ${progressMessage}`
    ].join("\n") },
    { type: 14, divider: true, spacing: 1 },
    { type: 10, content: progress.map(([step, label]) => `${evaluationStepStatusIcon(draft, step, guild)} ${label}`).join("\n") },
    draft.awaitingStep ? { type: 10, content: evaluationStepInstruction(draft.awaitingStep, guild) } : null,
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      evaluationStepButton(request.id, draft, "patrol", "1 Patrulha", guild),
      evaluationStepButton(request.id, draft, "operational", "2 Operacional", guild),
      evaluationStepButton(request.id, draft, "conduct", "3 Conduta", guild)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      evaluationStepButton(request.id, draft, "notes", "4 Observações", guild),
      evaluationStepButton(request.id, draft, "final", "5 Final", guild),
      new ButtonBuilder().setCustomId(`${PREFIX}:eval_review:${request.id}`).setEmoji(systemComponentEmoji("visto", guild)).setLabel("Revisar / Enviar").setStyle(ButtonStyle.Success).setDisabled(!canReview),
      new ButtonBuilder().setCustomId(`${PREFIX}:eval_cancel:${request.id}`).setEmoji(systemComponentEmoji("exclamacao", guild)).setLabel("Cancelar").setStyle(ButtonStyle.Danger)
    )
  ].filter(Boolean);
  return {
    components: [{
      type: 17,
      accent_color: parseColor(promotion.color),
      components
    }],
    flags: componentV2Flags(ephemeral)
  };
}

function evaluationStepConfirmationPayload(request: PolicePromotionRequest, promotion: PolicePromotionDefinition, guild: Guild, draft: EvaluationQuestionnaireDraft, step: EvaluationStep, ephemeral = true, panelImage: PanelVisualConfig | null = null): MessageCreateOptions {
  const answer = draft.pending?.step === step ? draft.pending.answer : "";
  return {
    components: [{
      type: 17,
      accent_color: parseColor(promotion.color),
      components: [
        ...topPanelMediaComponents(panelImage, "Confirmar resposta da avaliação"),
        { type: 10, content: [
          `# ${icon("prancheta_caneta", guild)} Confirmar informações`,
          `## ${escapeMarkdown(evaluationStepTitle(step))}`,
          "",
          "Confira os dados informados abaixo antes de salvar definitivamente.",
          "",
          DIVIDER,
          "",
          escapeMarkdown(answer || "Nenhuma informação registrada.")
        ].join("\n") },
        { type: 14, divider: true, spacing: 1 },
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:eval_step_confirm:${request.id}`).setEmoji(systemComponentEmoji("visto", guild)).setLabel("Confirmar resposta").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`${PREFIX}:eval_step_edit:${request.id}`).setEmoji(systemComponentEmoji("prancheta", guild)).setLabel("Refazer resposta").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`${PREFIX}:eval_panel:${request.id}`).setEmoji(systemComponentEmoji("porta", guild)).setLabel("Cancelar preenchimento").setStyle(ButtonStyle.Danger)
        )
      ]
    }],
    flags: componentV2Flags(ephemeral)
  };
}

function evaluationReviewPayload(request: PolicePromotionRequest, promotion: PolicePromotionDefinition, guild: Guild, draft: EvaluationQuestionnaireDraft, evaluation: EvaluationDraft, ephemeral = true, panelImage: PanelVisualConfig | null = null): MessageCreateOptions {
  return {
    components: [{
      type: 17,
      accent_color: parseColor(promotion.color),
      components: [
        ...topPanelMediaComponents(panelImage, "Revisão da avaliação"),
        { type: 10, content: [
          `# ${icon("prancheta_caneta", guild)} Revisão da Avaliação`,
          "",
          `${icon("homem", guild)} Avaliado\n<@${request.requesterId}>`,
          "",
          `${icon("homem", guild)} Instrutor\n<@${draft.userId}>`,
          "",
          evaluation.scoreLine
        ].join("\n") },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: EVALUATION_STEPS.map((step, index) => `## ${index + 1}. ${escapeMarkdown(evaluationStepTitle(step))}\n${escapeMarkdown(evaluationStepAnswerFor(draft, step) || "Não informado")}`).join("\n\n") },
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:eval_submit:${request.id}`).setEmoji(systemComponentEmoji("visto", guild)).setLabel("Confirmar e enviar").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`${PREFIX}:eval_panel:${request.id}`).setEmoji(systemComponentEmoji("porta", guild)).setLabel("Voltar").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`${PREFIX}:eval_cancel:${request.id}`).setEmoji(systemComponentEmoji("exclamacao", guild)).setLabel("Cancelar avaliação").setStyle(ButtonStyle.Danger)
        )
      ]
    }],
    flags: componentV2Flags(ephemeral)
  };
}

function evaluationSubmittedPayload(request: PolicePromotionRequest, promotion: PolicePromotionDefinition, guild: Guild, ephemeral = true): MessageCreateOptions {
  const now = new Date();
  return {
    components: [{
      type: 17,
      accent_color: parseColor(promotion.color),
      components: [{ type: 10, content: [
        `# ${icon("visto", guild)} Avaliação enviada`,
        "",
        "A avaliação foi enviada com sucesso para análise.",
        "",
        `${icon("relogio", guild)} Status\nAguardando aprovação`,
        "",
        `${icon("homem", guild)} Enviado por\n${request.evaluatorId ? `<@${request.evaluatorId}>` : "Instrutor"}`,
        "",
        `${icon("calendario", guild)} Data e horário\n${formatDate(now.toISOString())}`
      ].join("\n") }]
    }],
    flags: componentV2Flags(ephemeral)
  };
}

function evaluationStepButton(requestId: string, draft: EvaluationQuestionnaireDraft, step: EvaluationStep, label: string, guild: Guild) {
  const completed = Boolean(evaluationStepAnswerFor(draft, step));
  const active = draft.awaitingStep === step || draft.pending?.step === step;
  const captureOpen = Boolean(draft.awaitingStep || draft.pending);
  const available = !captureOpen && nextAvailableEvaluationStep(draft) === step;
  return new ButtonBuilder()
    .setCustomId(`${PREFIX}:eval_step:${requestId}:${step}`)
    .setEmoji(systemComponentEmoji(completed ? "visto" : active ? "relogio" : available ? "prancheta" : "porta", guild))
    .setLabel(label)
    .setStyle(completed ? ButtonStyle.Success : active ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(completed || active || !available);
}

function evaluationStepModal(requestId: string, step: EvaluationStep, draft: EvaluationQuestionnaireDraft) {
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:eval_step_modal:${requestId}:${step}`)
    .setTitle(evaluationStepTitle(step));
  if (step === "patrol") {
    const current = modalValueForStep(draft, step);
    modal.addComponents(
      evaluationShortInput("patrol_date", "Data da patrulha", "DD/MM/AAAA", valueFromLine(current, "Data")),
      evaluationShortInput("patrol_start", "Horário inicial", "10:00", valueFromLine(current, "Inicio")),
      evaluationShortInput("patrol_end", "Horário final", "12:00", valueFromLine(current, "Fim"))
    );
    return modal;
  }
  if (step === "operational") {
    const current = modalValueForStep(draft, step);
    modal.addComponents(
      evaluationInput("decisions", "Decisões rápidas", "Bom - justificativa detalhada", 500, valueFromLine(current, "Decisões")),
      evaluationInput("approaches", "Abordagens seguras", "Excelente - justificativa detalhada", 500, valueFromLine(current, "Abordagens")),
      evaluationInput("pursuits", "Acompanhamentos adequados", "Regular - justificativa detalhada", 500, valueFromLine(current, "Acompanhamentos"))
    );
    return modal;
  }
  if (step === "conduct") {
    const current = modalValueForStep(draft, step);
    modal.addComponents(
      evaluationInput("professional", "Comportamento profissional", "Bom - justificativa detalhada", 500, valueFromLine(current, "Comportamento")),
      evaluationInput("communication", "Comunicação", "Bom - justificativa detalhada", 500, valueFromLine(current, "Comunicação")),
      evaluationInput("adaptation", "Adaptação a imprevistos", "Excelente - justificativa detalhada", 500, valueFromLine(current, "Adaptação"))
    );
    return modal;
  }
  if (step === "notes") {
    const current = modalValueForStep(draft, step);
    modal.addComponents(
      evaluationInput("strengths", "Pontos fortes", "Descreva os principais pontos positivos.", 800, valueFromLine(current, "Pontos fortes")),
      evaluationInput("improvements", "Áreas de melhoria", "Descreva o que precisa evoluir.", 800, valueFromLine(current, "Melhorias")),
      evaluationInput("intervention", "Intervenção do FTO", "Não ou Sim - descreva a intervenção", 800, valueFromLine(current, "Intervenção"))
    );
    return modal;
  }
  const current = modalValueForStep(draft, step);
  modal.addComponents(
    evaluationShortInput("apt", "Cadet apto?", "Sim ou Não", valueFromLine(current, "Apto")),
    evaluationInput("final_justification", "Justificativa final", "Explique a decisão final.", 1000, valueFromLine(current, "Justificativa"))
  );
  return modal;
}

function evaluationInput(id: string, label: string, placeholder: string, maxLength: number, value?: string) {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setMaxLength(maxLength)
    .setPlaceholder(placeholder)
    .setRequired(true)
    .setStyle(TextInputStyle.Paragraph);
  if (value) input.setValue(clip(value, maxLength));
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

function evaluationShortInput(id: string, label: string, placeholder: string, value?: string) {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setMaxLength(80)
    .setPlaceholder(placeholder)
    .setRequired(true)
    .setStyle(TextInputStyle.Short);
  if (value) input.setValue(clip(value, 80));
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

function createEvaluationQuestionnaireDraft(request: PolicePromotionRequest, interaction: ButtonInteraction<"cached"> | ModalSubmitInteraction<"cached">): EvaluationQuestionnaireDraft {
  return {
    guildId: interaction.guild.id,
    requestId: request.id,
    updatedAt: Date.now(),
    userId: interaction.user.id
  };
}

function evaluationDraftFromRequest(request: PolicePromotionRequest, userId: string, guildId: string): EvaluationQuestionnaireDraft {
  const draft: EvaluationQuestionnaireDraft = {
    guildId,
    requestId: request.id,
    updatedAt: Date.now(),
    userId
  };
  for (const entry of request.history ?? []) {
    const step = typeof entry.metadata?.step === "string" && isEvaluationStep(entry.metadata.step) ? entry.metadata.step : null;
    const answer = typeof entry.metadata?.answer === "string" ? entry.metadata.answer : "";
    const actorId = typeof entry.actorId === "string" ? entry.actorId : null;
    if (actorId && actorId !== userId) continue;
    if (entry.action === "request.evaluation_step_started" && step && step === nextAvailableEvaluationStep(draft)) {
      draft.awaitingStep = step;
      draft.pending = undefined;
    }
    if (entry.action === "request.evaluation_step_pending" && step && answer && step === nextAvailableEvaluationStep(draft)) {
      draft.awaitingStep = undefined;
      draft.pending = {
        answer,
        messageId: typeof entry.metadata?.messageId === "string" ? entry.metadata.messageId : undefined,
        step
      };
    }
    if (entry.action === "request.evaluation_step_cancelled" && step && (draft.awaitingStep === step || draft.pending?.step === step)) {
      draft.awaitingStep = undefined;
      draft.pending = undefined;
    }
    if (entry.action === "request.evaluation_step_saved" && step && answer) {
      setEvaluationStepAnswer(draft, step, answer);
      if (draft.awaitingStep === step || draft.pending?.step === step) {
        draft.awaitingStep = undefined;
        draft.pending = undefined;
      }
    }
    if (entry.action === "request.evaluation_cancelled" || entry.action === "request.evaluation_finished") {
      draft.awaitingStep = undefined;
      draft.pending = undefined;
    }
  }
  return draft;
}

function evaluationStepAnswer(step: EvaluationStep, interaction: ModalSubmitInteraction<"cached">) {
  if (step === "patrol") {
    return [
      `Data: ${interaction.fields.getTextInputValue("patrol_date")}`,
      `Inicio: ${interaction.fields.getTextInputValue("patrol_start")}`,
      `Fim: ${interaction.fields.getTextInputValue("patrol_end")}`
    ].join("\n");
  }
  if (step === "operational") {
    return [
      `Decisões: ${oneLineEvaluationValue(interaction.fields.getTextInputValue("decisions"))}`,
      `Abordagens: ${oneLineEvaluationValue(interaction.fields.getTextInputValue("approaches"))}`,
      `Acompanhamentos: ${oneLineEvaluationValue(interaction.fields.getTextInputValue("pursuits"))}`
    ].join("\n");
  }
  if (step === "conduct") {
    return [
      `Comportamento: ${oneLineEvaluationValue(interaction.fields.getTextInputValue("professional"))}`,
      `Comunicação: ${oneLineEvaluationValue(interaction.fields.getTextInputValue("communication"))}`,
      `Adaptação: ${oneLineEvaluationValue(interaction.fields.getTextInputValue("adaptation"))}`
    ].join("\n");
  }
  if (step === "notes") {
    return [
      `Pontos fortes: ${oneLineEvaluationValue(interaction.fields.getTextInputValue("strengths"))}`,
      `Melhorias: ${oneLineEvaluationValue(interaction.fields.getTextInputValue("improvements"))}`,
      `Intervenção: ${oneLineEvaluationValue(interaction.fields.getTextInputValue("intervention"))}`
    ].join("\n");
  }
  return [
    `Apto: ${oneLineEvaluationValue(interaction.fields.getTextInputValue("apt"))}`,
    `Justificativa: ${oneLineEvaluationValue(interaction.fields.getTextInputValue("final_justification"))}`
  ].join("\n");
}

function evaluationStepTitle(step: EvaluationStep) {
  const titles: Record<EvaluationStep, string> = {
    conduct: "Comportamento e Conduta",
    final: "Avaliação Final",
    notes: "Observações Gerais",
    operational: "Avaliação Operacional",
    patrol: "Identificação da Patrulha"
  };
  return titles[step];
}

function evaluationStepInstruction(step: EvaluationStep, guild: Guild) {
  const instructions: Record<EvaluationStep, string> = {
    conduct: [
      `## ${icon("homem", guild)} Etapa 3 - Avaliação de Comportamento e Conduta`,
      "Avalie os seguintes itens.",
      "",
      "Utilize:",
      "Excelente",
      "Bom",
      "Regular",
      "Ruim",
      "",
      "Justifique todas as respostas.",
      "",
      `${icon("folha", guild)} Modelo obrigatório:`,
      "",
      "1. Demonstração de comportamento profissional durante a patrulha",
      "",
      "Nota:",
      "Excelente",
      "",
      "Justificativa:",
      "Manteve postura profissional durante toda a patrulha.",
      "",
      DIVIDER,
      "",
      "2. Comunicação com colegas e civis",
      "",
      "Nota:",
      "Bom",
      "",
      "Justificativa:",
      "Comunicou-se corretamente, porém pode melhorar a objetividade.",
      "",
      DIVIDER,
      "",
      "3. Capacidade de adaptação a situações imprevistas",
      "",
      "Nota:",
      "Excelente",
      "",
      "Justificativa:",
      "Adaptou-se rapidamente às mudanças de cenário.",
      "",
      "Envie agora a resposta neste canal. A próxima mensagem enviada por você será capturada pelo sistema."
    ].join("\n"),
    final: [
      `## ${icon("trofeu", guild)} Etapa 5 - Avaliação Final`,
      "Informe o resultado final da avaliação.",
      "",
      `${icon("folha", guild)} Modelo:`,
      "",
      "O Cadet está apto para se tornar Officer?",
      "",
      "Sim ou Não",
      "",
      DIVIDER,
      "",
      "Justificativa:",
      "",
      "[Resposta completa]",
      "",
      `${icon("folha", guild)} Exemplo:`,
      "",
      "Resultado:",
      "",
      "Sim",
      "",
      DIVIDER,
      "",
      "Justificativa:",
      "",
      "O avaliado demonstrou domínio dos procedimentos operacionais, boa postura, respeito à hierarquia e capacidade de atuar de forma segura durante toda a avaliação.",
      "",
      "Envie agora a resposta neste canal. A próxima mensagem enviada por você será capturada pelo sistema."
    ].join("\n"),
    notes: [
      `## ${icon("folha", guild)} Etapa 4 - Observações Gerais`,
      "Responda todos os itens abaixo.",
      "",
      `${icon("folha", guild)} Modelo:`,
      "",
      "Pontos fortes do avaliado:",
      "",
      "[Resposta]",
      "",
      DIVIDER,
      "",
      "Áreas que precisam ser melhoradas:",
      "",
      "[Resposta]",
      "",
      DIVIDER,
      "",
      "Foi necessária intervenção do F.T.O?",
      "",
      "Sim ou Não",
      "",
      DIVIDER,
      "",
      "Caso tenha respondido SIM, descreva:",
      "",
      "[Resposta]",
      "",
      `${icon("folha", guild)} Exemplo:`,
      "",
      "Pontos fortes:",
      "",
      "Excelente comunicação e postura profissional.",
      "",
      DIVIDER,
      "",
      "Pontos a melhorar:",
      "",
      "Melhorar a velocidade de resposta via rádio.",
      "",
      DIVIDER,
      "",
      "Intervenção do F.T.O?",
      "",
      "Sim",
      "",
      DIVIDER,
      "",
      "Descrição:",
      "",
      "Foi necessário orientar durante uma perseguição para manter distância segura.",
      "",
      "Envie agora a resposta neste canal. A próxima mensagem enviada por você será capturada pelo sistema."
    ].join("\n"),
    operational: [
      `## ${icon("engrenagem", guild)} Etapa 2 - Avaliação de Habilidades Operacionais`,
      "Avalie cada item utilizando:",
      "",
      "Excelente",
      "Bom",
      "Regular",
      "Ruim",
      "",
      "Após cada nota, justifique sua resposta.",
      "",
      `${icon("folha", guild)} Modelo obrigatório:`,
      "",
      "1. Capacidade de tomar decisões rápidas e eficazes",
      "",
      "Nota:",
      "Excelente",
      "",
      "Justificativa:",
      "Demonstrou excelente tomada de decisão durante todas as ocorrências.",
      "",
      DIVIDER,
      "",
      "2. Condução de abordagens de forma segura e profissional",
      "",
      "Nota:",
      "Bom",
      "",
      "Justificativa:",
      "Realizou abordagens corretas, porém apresentou pequenas falhas de posicionamento.",
      "",
      DIVIDER,
      "",
      "3. Capacidade de conduzir acompanhamentos de forma adequada",
      "",
      "Nota:",
      "Excelente",
      "",
      "Justificativa:",
      "Conduziu o acompanhamento respeitando todos os protocolos operacionais.",
      "",
      "Envie agora a resposta neste canal. A próxima mensagem enviada por você será capturada pelo sistema."
    ].join("\n"),
    patrol: [
      `## ${icon("prancheta", guild)} Etapa 1 - Identificação da Patrulha`,
      "Objetivo",
      "",
      "Coletar todas as informações iniciais da avaliação.",
      "",
      "Responda no chat seguindo este modelo:",
      "",
      "Nome do F.T.O:",
      "Nome do avaliado:",
      "Data da patrulha:",
      "Duração da patrulha:",
      "",
      `${icon("folha", guild)} Exemplo:`,
      "",
      "Nome do F.T.O:",
      "PC Lucas Bennett | 2164",
      "",
      "Nome do avaliado:",
      "Cb João Silva | 1234",
      "",
      "Data da patrulha:",
      "15/08/2026",
      "",
      "Duração:",
      "2 horas",
      "19:00 às 21:00",
      "",
      "Envie agora a sua resposta neste canal. A próxima mensagem enviada por você será capturada pelo sistema."
    ].join("\n")
  };
  return instructions[step];
}

function isEvaluationStep(value: string | undefined): value is EvaluationStep {
  return value === "patrol" || value === "operational" || value === "conduct" || value === "notes" || value === "final";
}

function evaluationStepAnswerFor(draft: EvaluationQuestionnaireDraft, step: EvaluationStep) {
  if (step === "patrol") return draft.patrol ?? "";
  if (step === "operational") return draft.operational ?? "";
  if (step === "conduct") return draft.conduct ?? "";
  if (step === "notes") return draft.notes ?? "";
  return draft.final ?? "";
}

function modalValueForStep(draft: EvaluationQuestionnaireDraft, step: EvaluationStep) {
  return draft.pending?.step === step ? draft.pending.answer : evaluationStepAnswerFor(draft, step);
}

function setEvaluationStepAnswer(draft: EvaluationQuestionnaireDraft, step: EvaluationStep, answer: string) {
  if (step === "patrol") draft.patrol = answer;
  else if (step === "operational") draft.operational = answer;
  else if (step === "conduct") draft.conduct = answer;
  else if (step === "notes") draft.notes = answer;
  else draft.final = answer;
}

function completedEvaluationSteps(draft: EvaluationQuestionnaireDraft) {
  return EVALUATION_STEPS.filter((step) => Boolean(evaluationStepAnswerFor(draft, step)));
}

function nextAvailableEvaluationStep(draft: EvaluationQuestionnaireDraft) {
  return EVALUATION_STEPS.find((step) => !evaluationStepAnswerFor(draft, step)) ?? null;
}

function evaluationStepStatusIcon(draft: EvaluationQuestionnaireDraft, step: EvaluationStep, guild: Guild) {
  if (evaluationStepAnswerFor(draft, step)) return icon("visto", guild);
  if (draft.pending?.step === step) return icon("alerta", guild);
  if (draft.awaitingStep === step) return icon("relogio", guild);
  if (nextAvailableEvaluationStep(draft) === step) return icon("relogio", guild);
  return icon("porta", guild);
}

function missingEvaluationQuestionnaireSteps(draft: EvaluationQuestionnaireDraft | null | undefined) {
  if (!draft) return ["Patrulha", "Operacional", "Conduta", "Observações", "Final"];
  return EVALUATION_STEPS
    .filter((step) => !evaluationStepAnswerFor(draft, step))
    .map((step) => evaluationStepTitle(step));
}

function oneLineEvaluationValue(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(" - ");
}

function valueFromLine(text: string | undefined, label: string) {
  if (!text) return "";
  const normalizedLabel = normalizePlainText(label);
  const line = text.split(/\r?\n/).find((item) => normalizePlainText(item).startsWith(normalizedLabel));
  return line?.replace(/^.*?:\s*/, "").trim() ?? "";
}

function buildPlainClothesEvaluation(input: {
  conduct: string;
  final: string;
  instructorId: string;
  instructorName: string;
  notes: string;
  operational: string;
  patrol: string;
  request: PolicePromotionRequest;
}): { draft: EvaluationDraft; errors: string[] } {
  const errors: string[] = [];
  const patrol = parsePatrol(input.patrol);

  const criteria = PCD_CRITERIA.map((criterion) => {
    const source = criterion.section === "operational" ? input.operational : input.conduct;
    const parsed = parseCriterion(source, criterion.aliases);
    if (!parsed) {
      return { ...criterion, justification: clip(source.trim() || "Avaliação narrativa registrada.", 500), rating: "narrativo", score: 0 };
    }
    return { ...criterion, ...parsed, score: PCD_RATING_POINTS[parsed.rating] ?? 0 };
  });

  const intervention = parseIntervention(input.notes);

  const finalDecision = parseFinalDecision(input.final);
  if (!finalDecision.result) errors.push("Resultado final: informe Aprovação/Reprovação ou Apto/Não apto.");
  if (!finalDecision.justification) errors.push("Justificativa final da decisão.");

  const score = criteria.reduce((total, item) => total + item.score, 0);
  const ratedCriteria = criteria.filter((item) => item.rating !== "narrativo");
  const maximumScore = ratedCriteria.length * 4;
  const percentage = maximumScore ? (score / maximumScore) * 100 : 0;
  const classification = maximumScore ? classificationFor(percentage) : "Narrativa";
  const finalResult = finalDecision.result === "approved" ? "approved" : "rejected";
  const scoreLine = maximumScore
    ? `Pontuação: **${score}/${maximumScore}** - Aproveitamento: **${percentage.toFixed(2).replace(".", ",")}%** - Classificação: **${classification}**`
    : `Avaliação narrativa registrada - Resultado recomendado: **${finalResult === "approved" ? "Apto" : "Não apto"}**`;
  const notes = [
    "AVALIAÇÃO PLAIN CLOTHES DAY",
    DIVIDER,
    `Aluno avaliado: <@${input.request.requesterId}> (${input.request.requesterName})`,
    `FTO responsável: <@${input.instructorId}> (${input.instructorName})`,
    `Patente solicitada: ${input.request.targetRank}`,
    "",
    "IDENTIFICAÇÃO DA PATRULHA",
    input.patrol.trim(),
    "",
    `Data: ${patrol.date ?? "Não identificada"}`,
    `Início: ${patrol.startTime ?? "Não identificado"}`,
    `Fim: ${patrol.endTime ?? "Não identificado"}`,
    `Duração: ${patrol.durationLabel ?? "Não calculada"}`,
    "",
    "AVALIAÇÃO OPERACIONAL",
    input.operational.trim(),
    "",
    ...criteria.slice(0, 3).map((item) => item.rating === "narrativo" ? `${item.title}: Avaliação narrativa` : `${item.title}: ${ratingLabel(item.rating)} (${item.score}/4)\nJustificativa: ${item.justification}`),
    "",
    "COMPORTAMENTO E CONDUTA",
    input.conduct.trim(),
    "",
    ...criteria.slice(3).map((item) => item.rating === "narrativo" ? `${item.title}: Avaliação narrativa` : `${item.title}: ${ratingLabel(item.rating)} (${item.score}/4)\nJustificativa: ${item.justification}`),
    "",
    "OBSERVAÇÕES GERAIS",
    input.notes.trim(),
    intervention.value ? `Intervenção do FTO: ${intervention.value === "sim" ? `Sim${intervention.description ? ` - ${intervention.description}` : ""}` : "Não"}` : "Intervenção do FTO: Não informada",
    "",
    "PONTUAÇÃO",
    maximumScore ? `Pontuação: ${score}/${maximumScore}` : "Pontuação: avaliação narrativa",
    maximumScore ? `Aproveitamento: ${percentage.toFixed(2).replace(".", ",")}%` : "Aproveitamento: não calculado",
    `Classificação geral: ${classification}`,
    "",
    "RESULTADO FINAL",
    `Resultado: ${finalResult === "approved" ? "Apto" : "Não apto"}`,
    `Justificativa: ${finalDecision.justification}`
  ].join("\n");

  return {
    draft: {
      finalResult,
      notes: clip(notes, 6000),
      requestId: input.request.id,
      scoreLine
    },
    errors
  };
}

function validationErrorPayload(errors: string[], guild: Guild): MessageCreateOptions {
  return {
    components: [{
      type: 17,
      accent_color: 0xef4444,
      components: [{ type: 10, content: [`# ${icon("exclamacao", guild)} Não foi possível enviar a avaliação`, "Campos pendentes:", ...errors.map((item) => `• ${escapeMarkdown(item)}`)].join("\n") }]
    }],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  };
}

function parseCriterion(text: string, aliases: readonly string[]) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const lineIndex = lines.findIndex((item) => {
    const normalized = normalizePlainText(item);
    return aliases.some((alias) => normalized.includes(alias));
  });
  if (lineIndex < 0) return null;
  const blockEnd = lines.findIndex((item, index) => index > lineIndex && (isDividerLine(item) || isCriterionHeaderLine(item)));
  const block = lines.slice(lineIndex, blockEnd > lineIndex ? blockEnd : undefined);
  const rating = Object.keys(PCD_RATING_POINTS).find((item) => block.some((line, index) => {
    const normalized = normalizePlainText(line).replace(/[:?]+$/g, "").trim();
    if (normalized === "nota") {
      const next = normalizePlainText(block[index + 1] ?? "");
      return next === item;
    }
    return normalized.includes(item);
  }));
  if (!rating) return null;
  const justification = extractValueAfterLabel(block, "justificativa");
  if (justification.length < 8) return null;
  return { justification: clip(justification, 500), rating };
}

function isCriterionHeaderLine(value: string) {
  const normalized = normalizePlainText(value);
  return PCD_CRITERIA.some((criterion) => criterion.aliases.some((alias) => {
    if (normalized.startsWith(alias)) return true;
    return /^\d+\s*[.)-]/.test(normalized) && normalized.includes(alias);
  }));
}

function isDividerLine(value: string) {
  return /^[━─\-_\s]{6,}$/.test(value);
}

function parsePatrol(text: string) {
  const errors: string[] = [];
  const date = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  let dateLabel: string | null = null;
  if (!date || !isValidBrazilianDate(Number(date[1]), Number(date[2]), Number(date[3]))) {
    errors.push("Data da patrulha válida no formato DD/MM/AAAA.");
  } else {
    dateLabel = `${date[1]!.padStart(2, "0")}/${date[2]!.padStart(2, "0")}/${date[3]}`;
  }

  const times = [...text.matchAll(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/gi)].map((match) => `${match[1]!.padStart(2, "0")}:${match[2]}`);
  if (times.length < 2) errors.push("Horário inicial e final da patrulha.");
  const startMinutes = times[0] ? minutesFromTime(times[0]) : null;
  const endMinutes = times[1] ? minutesFromTime(times[1]) : null;
  const durationMinutes = startMinutes !== null && endMinutes !== null ? endMinutes - startMinutes : null;
  if (durationMinutes !== null && durationMinutes <= 0) errors.push("Horário final maior que o horário inicial.");

  return {
    date: dateLabel,
    durationLabel: durationMinutes && durationMinutes > 0 ? durationLabel(durationMinutes) : null,
    endTime: times[1] ?? null,
    errors,
    startTime: times[0] ?? null
  };
}

function parseIntervention(text: string) {
  const normalized = normalizePlainText(text);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const interventionIndex = lines.findIndex((line) => normalizePlainText(line).includes("intervencao"));
  if (interventionIndex >= 0) {
    const inline = normalizePlainText(lines[interventionIndex] ?? "");
    const next = normalizePlainText(nextMeaningfulLine(lines, interventionIndex + 1) ?? "");
    const value = /\bnao\b/.test(inline) || next === "nao"
      ? "nao"
      : /\bsim\b/.test(inline) || next === "sim"
        ? "sim"
        : null;
    const description = value === "sim"
      ? extractValueAfterAnyLabel(lines, ["caso tenha respondido sim, descreva", "descricao"])
      : "";
    return { description: description.length >= 8 ? description : "", value };
  }
  if (!normalized.includes("intervencao")) return { description: "", value: null as string | null };
  if (/\bintervencao\b.*\bnao\b/.test(normalized)) return { description: "", value: "nao" };
  if (/\bintervencao\b.*\bsim\b/.test(normalized)) {
    const line = text.split(/\r?\n/).find((item) => normalizePlainText(item).includes("intervencao")) ?? "";
    const description = line.replace(/.*?\bsim\b\s*[-:|.]?/i, "").trim();
    return { description: description.length >= 8 ? description : "", value: "sim" };
  }
  return { description: "", value: null as string | null };
}

function parseFinalDecision(text: string) {
  const normalized = normalizePlainText(text).replace(/\s+/g, " ");
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const resultAnswer = extractValueAfterAnyLabel(lines, ["resultado", "o cadet esta apto para se tornar officer", "apto"]);
  const normalizedResultAnswer = normalizePlainText(resultAnswer).replace(/\s+/g, " ");
  const decisionSource = normalizedResultAnswer || normalized;
  const result = /\b(nao|reprovado|reprovacao|inapto)\b/.test(decisionSource)
    ? "rejected"
    : /\b(sim|aprovado|aprovacao|apto)\b/.test(decisionSource)
      ? "approved"
      : null;
  const justification = extractValueAfterLabel(lines, "justificativa") || text.trim();
  return { justification: justification.length >= 10 ? clip(justification, 800) : "", result };
}

function extractValueAfterAnyLabel(lines: string[], labels: string[]) {
  for (const label of labels) {
    const value = extractValueAfterLabel(lines, label);
    if (value) return value;
  }
  return "";
}

function extractValueAfterLabel(lines: string[], label: string) {
  const normalizedLabel = normalizePlainText(label);
  const index = lines.findIndex((line) => {
    const normalized = normalizePlainText(line).replace(/[:?]+$/g, "").trim();
    return normalized.includes(normalizedLabel);
  });
  if (index < 0) return "";
  const inline = lines[index]!.replace(/^.*?[:?]\s*/i, "").trim();
  if (inline && normalizePlainText(inline) !== normalizePlainText(lines[index]!)) return inline;
  return nextMeaningfulLine(lines, index + 1) ?? "";
}

function nextMeaningfulLine(lines: string[], startIndex: number) {
  for (const line of lines.slice(startIndex)) {
    if (!line || isDividerLine(line)) continue;
    return line;
  }
  return null;
}

function isValidBrazilianDate(day: number, month: number, year: number) {
  const date = new Date(year, month - 1, day);
  const futureLimit = new Date();
  futureLimit.setDate(futureLimit.getDate() + 30);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day && date <= futureLimit;
}

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours ? `${hours} hora(s)` : "", rest ? `${rest} minuto(s)` : ""].filter(Boolean).join(" e ") || "0 minuto(s)";
}

function classificationFor(percentage: number) {
  if (percentage >= 90) return "Excelente";
  if (percentage >= 75) return "Bom";
  if (percentage >= 60) return "Regular";
  return "Insuficiente";
}

function ratingLabel(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function normalizePlainText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
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

async function refreshPromotionSystemEmojis(guild: Guild, context: BotContext) {
  await fetchApplicationEmojis(guild.client).catch(() => undefined);
  await cacheGuildSystemEmojis(guild, context).catch(() => undefined);
  await refreshSystemEmojis(context).catch(() => undefined);
}

async function loadPromotionPanelImage(guildId: string, context: BotContext): Promise<PanelVisualConfig | null> {
  const image = await context.api.getPanelVisualSettings(guildId, "police-promotions").catch(() => null);
  return image?.imageEnabled && image.imageUrl ? image : null;
}

function icon(key: SystemEmojiKey, guild?: Guild | null) {
  return systemEmojiText(key, guild, guild?.client ?? null);
}

function fixedComponentEmoji(key: SystemEmojiKey) {
  const emoji = FIXED_SYSTEM_EMOJI_BY_KEY[key];
  return emoji
    ? { animated: emoji.animated, id: emoji.emojiId, name: emoji.name }
    : systemComponentEmoji(key);
}

function promotionEmojiText(promotion: PolicePromotionDefinition, guild: Guild) {
  const raw = normalizePromotionEmojiMarkup(promotion.emoji);
  const key = systemEmojiKeyFromValue(raw);
  if (key) return icon(key, guild);
  if (!raw) return icon("prancheta", guild);
  if (CUSTOM_EMOJI_PATTERN.test(raw)) return raw;

  const replaced = replaceSystemEmojis(raw, guild, guild.client);
  return replaced !== raw ? replaced : raw;
}

function promotionEmojiComponent(promotion: PolicePromotionDefinition, guild: Guild) {
  const raw = normalizePromotionEmojiMarkup(promotion.emoji);
  const key = systemEmojiKeyFromValue(raw);
  if (key) return systemComponentEmoji(key, guild, guild.client);
  if (!raw) return systemComponentEmoji("prancheta", guild, guild.client);
  return raw;
}

function normalizePromotionEmojiMarkup(value: string | null | undefined) {
  const raw = value?.trim();
  return raw ? normalizeFixedSystemEmojiText(raw).trim() : null;
}

function systemEmojiKeyFromValue(value: string | null | undefined): SystemEmojiKey | null {
  const raw = value?.trim();
  if (!raw) return null;

  const customMatch = /^<a?:([a-zA-Z0-9_]{2,32}):(\d{5,32})>$/.exec(raw);
  const idKey = customMatch ? SYSTEM_PROMOTION_EMOJI_KEY_BY_ID.get(customMatch[2]!) : null;
  if (idKey) return idKey;

  const token = customMatch?.[1] ?? raw.replace(/^:/, "").replace(/:$/, "");
  return SYSTEM_PROMOTION_EMOJI_KEY_BY_ALIAS.get(token) ?? null;
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

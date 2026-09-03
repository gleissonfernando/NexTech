import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags, ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
  type ButtonInteraction, type ChatInputCommandInteraction, type Client, type Guild, type GuildMember, type Interaction,
  type ModalSubmitInteraction, type RoleSelectMenuInteraction, type StringSelectMenuInteraction, type TextBasedChannel, type TextChannel, type UserSelectMenuInteraction
} from "discord.js";
import { currentRuntimeBotId, env, isBotModuleEnabled } from "../config/env";
import type { BotContext } from "../types";
import type { PoliceRecruitmentQuestion, PoliceRecruitmentReport, PoliceRecruitmentSession, PoliceRecruitmentSettings } from "./apiClient";
import { systemComponentEmoji, systemEmojiText } from "./systemEmojiService";

const PREFIX = "police_recruitment";

export function startPoliceRecruitmentService(client: Client, context: BotContext) {
  if (!isBotModuleEnabled("police-recruitment") && !isBotModuleEnabled("police_reports")) return;
  registerPoliceRecruitmentRealtimeHandlers(client, context);
  void expireSessions(client, context);
  const interval = setInterval(() => void expireSessions(client, context), 60_000);
  interval.unref();
}

export async function publishPoliceRecruitmentPanel(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
    return;
  }
  const current = await context.api.getPoliceRecruitmentSettings(interaction.guild.id);
  if (!hasPoliceConfigAccess(interaction.member as GuildMember, current)) {
    await interaction.reply({ content: "Apenas administradores ou cargos configurados podem publicar este painel.", ephemeral: true });
    return;
  }

  const forum = interaction.options.getChannel("forum", false, [ChannelType.GuildForum]);
  const temporaryCategory = interaction.options.getChannel("categoria", false, [ChannelType.GuildCategory]);
  const logChannel = interaction.options.getChannel("logs", false, [ChannelType.GuildText, ChannelType.GuildAnnouncement]);
  const authorizedRole = interaction.options.getRole("cargo-autorizado");
  const supervisorRole = interaction.options.getRole("cargo-supervisor");
  const corporationName = interaction.options.getString("corporacao")?.trim();
  const settings = await context.api.savePoliceRecruitmentSettings(interaction.guild.id, {
    createReportRoleIds: authorizedRole ? unique([...current.createReportRoleIds, authorizedRole.id]) : current.createReportRoleIds,
    corporationName: corporationName || current.corporationName,
    configured: true,
    enabled: true,
    forumChannelId: forum?.id ?? current.forumChannelId,
    logChannelId: logChannel?.id ?? current.logChannelId,
    reportsForumChannelId: forum?.id ?? current.reportsForumChannelId ?? current.forumChannelId,
    recruiterRoleIds: authorizedRole ? unique([...current.recruiterRoleIds, authorizedRole.id]) : current.recruiterRoleIds,
    supervisorRoleIds: supervisorRole ? unique([...current.supervisorRoleIds, supervisorRole.id]) : current.supervisorRoleIds,
    temporaryCategoryId: temporaryCategory?.id ?? current.temporaryCategoryId
  }, interaction.user.id);

  const message = interaction.channel && "send" in interaction.channel ? await interaction.channel.send(await panelPayload(context, interaction.guild, settings)) : null;
  if (message) {
    await context.api.savePoliceRecruitmentSettings(interaction.guild.id, { panelChannelId: message.channel.id, panelMessageId: message.id }, interaction.user.id);
  }
  await interaction.reply({ content: "Painel de recrutamento publicado.", ephemeral: true });
}

export async function handlePoliceRecruitmentInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.guild || !("customId" in interaction) || !String(interaction.customId).startsWith(`${PREFIX}:`)) return false;
  const [, action, target] = String(interaction.customId).split(":");
  if (interaction.isButton() && action === "start") await startSession(interaction, context);
  else if (interaction.isUserSelectMenu() && action === "recruited") await selectRecruited(interaction, context, target!);
  else if (interaction.isButton() && action === "answer") await showAnswerModal(interaction, context, target!);
  else if (interaction.isModalSubmit() && action === "answer") await submitAnswer(interaction, context, target!);
  else if (interaction.isStringSelectMenu() && action === "select") await submitSelect(interaction, context, target!);
  else if (interaction.isUserSelectMenu() && action === "user_answer") await submitEntitySelect(interaction, context, target!);
  else if (interaction.isRoleSelectMenu() && action === "role_answer") await submitEntitySelect(interaction, context, target!);
  else if (interaction.isButton() && action === "move") await moveQuestion(interaction, context, target === "previous" ? "previous" : "next");
  else if (interaction.isButton() && action === "review") await showReview(interaction, context, target!);
  else if (interaction.isButton() && action === "edit") await editAnswers(interaction, context, target!);
  else if (interaction.isButton() && action === "finish") await finishSession(interaction, context, target!);
  else if (interaction.isButton() && action === "cancel") await confirmCancel(interaction, target!);
  else if (interaction.isButton() && action === "cancel_confirm") await cancelSession(interaction, context, target!);
  else if (interaction.isButton() && action === "cancel_keep") await refreshSessionMessage(interaction, context, target!);
  else if (interaction.isButton() && action === "search") await showSearchModal(interaction, target!);
  else if (interaction.isModalSubmit() && action === "search") await searchReports(interaction, context, target!);
  else return false;
  return true;
}

export function registerPoliceRecruitmentRealtimeHandlers(client: Client, context: BotContext) {
  if (!context.socket || !isBotModuleEnabled("police-recruitment") && !isBotModuleEnabled("police_reports")) return;
  context.socket.onPoliceRecruitmentPanelPublish((payload, ack) => {
    const runtimeBotId = (currentRuntimeBotId() ?? env.DASHBOARD_BOT_ID) || null;
    if (payload.botId && runtimeBotId && payload.botId !== runtimeBotId) return;
    void publishConfiguredPanel(client, context, payload.guildId)
      .then((messageId) => ack?.({ ok: true, messageId }))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        ack?.({ ok: false, error: message });
      });
  });
}

async function startSession(interaction: ButtonInteraction, context: BotContext) {
  await interaction.deferReply({ ephemeral: true });
  const settings = await context.api.getPoliceRecruitmentSettings(interaction.guildId!);
  if (!settings.enabled) return interaction.editReply("O módulo ainda não foi liberado.");
  if (!settings.configured) return interaction.editReply("O módulo ainda não foi configurado.");
  const member = interaction.member as GuildMember;
  if (!hasPoliceRecruitmentAccess(member, settings)) return interaction.editReply("❌ Você não possui autorização para registrar recrutamentos.");
  const session = await context.api.createPoliceRecruitmentSession({
    guildId: interaction.guildId!,
    recruiter: { avatar: interaction.user.displayAvatarURL(), discordId: interaction.user.id, displayName: member.displayName, policeId: extractPoliceId(member.displayName), username: interaction.user.username }
  });
  if (session.channelId) {
    await interaction.editReply({ content: `⚠️ Você já possui um relatório em andamento: <#${session.channelId}>` });
    return;
  }
  const channel = await createSessionChannel(interaction.guild!, settings, session, member);
  const control = await channel.send(sessionStartPayload(session, interaction.guild!));
  await context.api.setPoliceRecruitmentSessionChannel(session.id, channel.id, control.id);
  await sendLog(interaction.guild!, settings, "relatório iniciado", interaction.user.id, session.id);
  await interaction.editReply(`Canal criado: <#${channel.id}>.`);
}

async function selectRecruited(interaction: UserSelectMenuInteraction, context: BotContext, sessionId: string) {
  await interaction.deferUpdate();
  const user = interaction.users.first();
  if (!user) return;
  const member = await interaction.guild!.members.fetch(user.id).catch(() => null);
  const session = await context.api.selectPoliceRecruitmentUser(sessionId, { actorId: interaction.user.id, avatar: user.displayAvatarURL(), discordId: user.id, displayName: member?.displayName ?? user.globalName ?? user.username, username: user.username });
  await updateControl(interaction.channel, session, context, interaction.guild!);
}

async function showAnswerModal(interaction: ButtonInteraction, context: BotContext, sessionId: string) {
  const [session, questions] = await Promise.all([context.api.getPoliceRecruitmentSession(sessionId), context.api.listPoliceRecruitmentQuestions(interaction.guildId!)]);
  const question = questions[session.currentQuestion];
  if (!question || !["TEXT", "LONG_TEXT", "NUMBER"].includes(question.type)) return interaction.reply({ content: "Esta pergunta usa menu de seleção.", ephemeral: true });
  const previous = answerValue(session, question.id);
  await interaction.showModal(new ModalBuilder().setCustomId(`${PREFIX}:answer:${sessionId}`).setTitle(question.title.slice(0, 45)).addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("value").setLabel(question.title.slice(0, 45)).setPlaceholder(question.description ?? "").setRequired(question.required).setStyle(question.type === "LONG_TEXT" ? TextInputStyle.Paragraph : TextInputStyle.Short).setMaxLength(question.type === "LONG_TEXT" ? 1800 : 200).setValue(typeof previous === "string" || typeof previous === "number" ? String(previous).slice(0, question.type === "LONG_TEXT" ? 1800 : 200) : ""))
  ));
}

async function submitAnswer(interaction: ModalSubmitInteraction, context: BotContext, sessionId: string) {
  await interaction.deferReply({ ephemeral: true });
  const session = await context.api.getPoliceRecruitmentSession(sessionId);
  const questions = await context.api.listPoliceRecruitmentQuestions(interaction.guildId!);
  const question = questions[session.currentQuestion];
  if (!question) return interaction.editReply("Pergunta não encontrada.");
  const updated = await context.api.savePoliceRecruitmentAnswer(sessionId, { actorId: interaction.user.id, questionId: question.id, value: interaction.fields.getTextInputValue("value"), move: "next" });
  await updateControl(interaction.channel, updated, context, interaction.guild!);
  await interaction.deleteReply().catch(() => null);
}

async function submitSelect(interaction: StringSelectMenuInteraction, context: BotContext, sessionId: string) {
  await interaction.deferUpdate();
  const session = await context.api.getPoliceRecruitmentSession(sessionId);
  const questions = await context.api.listPoliceRecruitmentQuestions(interaction.guildId!);
  const question = questions[session.currentQuestion];
  if (!question) return;
  const value = question.type === "BOOLEAN" ? interaction.values[0] === "Sim" : interaction.values[0] ?? null;
  const updated = await context.api.savePoliceRecruitmentAnswer(sessionId, { actorId: interaction.user.id, questionId: question.id, value, move: "next" });
  await updateControl(interaction.channel, updated, context, interaction.guild!);
}

async function submitEntitySelect(interaction: UserSelectMenuInteraction | RoleSelectMenuInteraction, context: BotContext, sessionId: string) {
  await interaction.deferUpdate();
  const session = await context.api.getPoliceRecruitmentSession(sessionId);
  const questions = await context.api.listPoliceRecruitmentQuestions(interaction.guildId!);
  const question = questions[session.currentQuestion];
  if (!question) return;
  const updated = await context.api.savePoliceRecruitmentAnswer(sessionId, { actorId: interaction.user.id, questionId: question.id, value: interaction.values, move: "next" });
  await updateControl(interaction.channel, updated, context, interaction.guild!);
}

async function moveQuestion(interaction: ButtonInteraction, context: BotContext, direction: "next" | "previous") {
  await interaction.deferUpdate();
  const sessionId = channelSessionId(interaction);
  if (!sessionId) return;
  const session = await context.api.getPoliceRecruitmentSession(sessionId);
  const questions = await context.api.listPoliceRecruitmentQuestions(interaction.guildId!);
  if (direction === "next" && !canLeaveQuestion(session, questions[session.currentQuestion])) {
    await interaction.followUp({ content: "Responda a pergunta obrigatória antes de avançar.", ephemeral: true });
    return;
  }
  const updated = await context.api.movePoliceRecruitmentQuestion(sessionId, { actorId: interaction.user.id, direction });
  await updateControl(interaction.channel, updated, context, interaction.guild!);
}

async function showReview(interaction: ButtonInteraction, context: BotContext, sessionId: string) {
  await interaction.deferUpdate();
  const session = await context.api.getPoliceRecruitmentSession(sessionId);
  const questions = await context.api.listPoliceRecruitmentQuestions(interaction.guildId!);
  if (questions.some((question) => !canLeaveQuestion(session, question))) {
    await interaction.followUp({ content: "Existem perguntas obrigatórias sem resposta.", ephemeral: true });
    return;
  }
  await interaction.message.edit(reviewPayload(session, interaction.guild!));
}

async function editAnswers(interaction: ButtonInteraction, context: BotContext, sessionId: string) {
  await interaction.deferUpdate();
  const session = await context.api.getPoliceRecruitmentSession(sessionId);
  await updateControl(interaction.channel, session, context, interaction.guild!);
}

async function finishSession(interaction: ButtonInteraction, context: BotContext, sessionId: string) {
  await interaction.deferReply({ ephemeral: true });
  const settings = await context.api.getPoliceRecruitmentSettings(interaction.guildId!);
  if (!(settings.reportsForumChannelId ?? settings.forumChannelId)) return interaction.editReply("Configure o fórum de relatórios antes de finalizar.");
  const report = await context.api.finishPoliceRecruitmentSession(sessionId, interaction.user.id);
  if (report.forumThreadId && report.forumMessageId) {
    await interaction.editReply(`✅ Relatório ${report.reportCode} já estava publicado em <#${report.forumThreadId}>.`);
    return;
  }
  const published = await publishReport(interaction.guild!, context, settings, report);
  await context.api.updatePoliceRecruitmentReportPublication(report.id, published);
  await sendLog(interaction.guild!, settings, "relatório finalizado", interaction.user.id, report.reportCode);
  await interaction.editReply(`✅ Relatório ${report.reportCode} publicado em <#${published.forumThreadId}>.`);
  setTimeout(() => void (interaction.channel as TextChannel | null)?.delete(`Relatório ${report.reportCode} finalizado`).catch(() => null), settings.deleteDelaySeconds * 1000).unref();
}

async function confirmCancel(interaction: ButtonInteraction, sessionId: string) {
  await interaction.reply({ components: [{ type: 17, accent_color: 0xef4444, components: [{ type: 10, content: "## Cancelar relatório\nTem certeza que deseja cancelar este relatório?" }, new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:cancel_confirm:${sessionId}`).setLabel("Sim, cancelar").setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`${PREFIX}:cancel_keep:${sessionId}`).setLabel("Continuar relatório").setStyle(ButtonStyle.Secondary))] }], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
}

async function cancelSession(interaction: ButtonInteraction, context: BotContext, sessionId: string) {
  await interaction.deferReply({ ephemeral: true });
  const settings = await context.api.getPoliceRecruitmentSettings(interaction.guildId!);
  await context.api.cancelPoliceRecruitmentSession(sessionId, interaction.user.id, "CANCELLED");
  await sendLog(interaction.guild!, settings, "relatório cancelado", interaction.user.id, sessionId);
  await interaction.editReply("Relatório cancelado. O canal será removido.");
  setTimeout(() => void (interaction.channel as TextChannel | null)?.delete("Relatório de recrutamento cancelado").catch(() => null), settings.deleteDelaySeconds * 1000).unref();
}

async function refreshSessionMessage(interaction: ButtonInteraction, context: BotContext, sessionId: string) {
  await interaction.deferUpdate();
  const session = await context.api.getPoliceRecruitmentSession(sessionId);
  await updateControl(interaction.channel, session, context, interaction.guild!);
}

async function publishReport(guild: Guild, context: BotContext, settings: PoliceRecruitmentSettings, report: PoliceRecruitmentReport) {
  const forumChannelId = settings.reportsForumChannelId ?? settings.forumChannelId;
  const forum = await guild.channels.fetch(forumChannelId!).catch(() => null);
  if (!forum || forum.type !== ChannelType.GuildForum) throw new Error("Fórum de recrutamento inválido.");
  const recruiter = await context.api.getPoliceRecruitmentRecruiter(guild.id, report.recruiterDiscordId);
  let thread = recruiter?.forumThreadId ? await guild.channels.fetch(recruiter.forumThreadId).catch(() => null) : null;
  if (!thread || !thread.isThread()) {
    const created = await forum.threads.create({ name: `✅・${report.recruiterName} | ${report.recruiterPoliceId ?? report.recruiterDiscordId}`.slice(0, 100), message: recruiterHeaderPayload(report, recruiter), reason: `Histórico de recrutamentos ${report.recruiterDiscordId}` });
    thread = created;
  }
  const message = await thread.send(reportPayload(report, guild));
  await thread.send(recruiterControlsPayload(report.recruiterDiscordId, guild)).catch(() => null);
  return { forumMessageId: message.id, forumThreadId: thread.id };
}

async function updateControl(channel: TextBasedChannel | null, session: PoliceRecruitmentSession, context: BotContext, guild: Guild) {
  if (!channel?.isTextBased() || !session.panelMessageId) return;
  const message = await channel.messages.fetch(session.panelMessageId).catch(() => null);
  await message?.edit(await questionPayload(context, guild, session)).catch(() => null);
}

async function createSessionChannel(guild: Guild, settings: PoliceRecruitmentSettings, session: PoliceRecruitmentSession, member: GuildMember) {
  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks] },
    { id: session.recruiterDiscordId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    ...settings.adminRoleIds.concat(settings.supervisorRoleIds).map((roleId) => ({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))
  ];
  return guild.channels.create({ name: `recrutamento-${slug(member.displayName)}`, type: ChannelType.GuildText, parent: settings.temporaryCategoryId ?? undefined, permissionOverwrites: overwrites, reason: `Recrutamento ${session.id}` });
}

async function panelPayload(context: BotContext, guild: Guild, settings: PoliceRecruitmentSettings) {
  const reports = await context.api.listPoliceRecruitmentReports(guild.id).catch(() => []);
  const month = new Date().toISOString().slice(0, 7);
  const monthCount = reports.filter((item) => item.createdAt.startsWith(month)).length;
  return { components: [{ type: 17, accent_color: parseColor(settings.panelColor), components: [{ type: 10, content: `# 📋 Sistema de Recrutamento\nUtilize o botão abaixo para iniciar um novo relatório de recrutamento.\n\n**Corporação:** ${settings.corporationName}\n**Servidor:** ${guild.name}\n**Recrutamentos realizados:** ${reports.length}\n**Recrutamentos no mês:** ${monthCount}\n**Última atualização:** <t:${Math.floor(Date.now() / 1000)}:f>` }, new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:start`).setEmoji(systemComponentEmoji("prancheta_caneta", guild)).setLabel("Iniciar Relatório").setStyle(ButtonStyle.Success))] }], flags: MessageFlags.IsComponentsV2 as const, allowedMentions: { parse: [] } };
}

function sessionStartPayload(session: PoliceRecruitmentSession, guild: Guild) {
  return { components: [{ type: 17, accent_color: 0x22c55e, components: [{ type: 10, content: `# ${systemEmojiText("prancheta", guild)} Novo relatório de recrutamento\n**Recrutador:** <@${session.recruiterDiscordId}>\n\nSelecione abaixo o usuário que está sendo recrutado.` }, new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder().setCustomId(`${PREFIX}:recruited:${session.id}`).setPlaceholder("Selecione o recrutado").setMinValues(1).setMaxValues(1)), cancelRow(session.id)] }], flags: MessageFlags.IsComponentsV2 as const };
}

async function questionPayload(context: BotContext, guild: Guild, session: PoliceRecruitmentSession) {
  const questions = await context.api.listPoliceRecruitmentQuestions(guild.id);
  const question = questions[session.currentQuestion];
  if (!question) return reviewPayload(session, guild);
  const components: unknown[] = [{ type: 10, content: questionText(session, question, questions.length, guild) }];
  if (question.type === "SELECT" || question.type === "BOOLEAN") components.push(selectRow(session.id, question));
  else if (question.type === "USER_SELECT") components.push(new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder().setCustomId(`${PREFIX}:user_answer:${session.id}`).setPlaceholder("Selecione um usuário").setMinValues(1).setMaxValues(1)));
  else if (question.type === "ROLE_SELECT") components.push(new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(new RoleSelectMenuBuilder().setCustomId(`${PREFIX}:role_answer:${session.id}`).setPlaceholder("Selecione um cargo").setMinValues(1).setMaxValues(1)));
  else components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:answer:${session.id}`).setLabel("Responder").setEmoji(systemComponentEmoji("prancheta_caneta", guild)).setStyle(ButtonStyle.Primary)));
  components.push(navRow(session.id, session.currentQuestion, questions.length));
  return { components: [{ type: 17, accent_color: 0x22c55e, components }], flags: MessageFlags.IsComponentsV2 as const, allowedMentions: { parse: [] } };
}

function questionText(session: PoliceRecruitmentSession, question: PoliceRecruitmentQuestion, total: number, guild: Guild) {
  const previous = answerValue(session, question.id);
  return `# ${systemEmojiText("prancheta", guild)} Relatório de Recrutamento\n**Recrutador:** <@${session.recruiterDiscordId}>\n**Recrutado:** ${session.recruitedDiscordId ? `<@${session.recruitedDiscordId}>` : "-"}\n\n## Pergunta ${session.currentQuestion + 1}/${total}\n**${question.title}**\n${question.description ?? ""}\n\n**Resposta atual:** ${formatAnswer(previous)}`;
}

async function publishConfiguredPanel(client: Client, context: BotContext, guildId: string) {
  const guild = await client.guilds.fetch(guildId);
  const settings = await context.api.getPoliceRecruitmentSettings(guild.id);
  if (!settings.enabled) throw new Error("O módulo ainda não foi liberado.");
  if (!settings.configured) throw new Error("O módulo ainda não foi configurado.");
  if (!settings.panelChannelId) throw new Error("Canal do painel não configurado.");
  const panelChannel = await guild.channels.fetch(settings.panelChannelId).catch(() => null);
  if (!panelChannel?.isTextBased() || panelChannel.isDMBased()) throw new Error("Canal do painel inválido.");
  const payload = await panelPayload(context, guild, settings);
  const message = await panelChannel.send(payload);
  await context.api.savePoliceRecruitmentSettings(guild.id, { panelMessageId: message.id }, null).catch(() => null);
  return message.id;
}

function reviewPayload(session: PoliceRecruitmentSession, guild: Guild) {
  return { components: [{ type: 17, accent_color: 0xf8c537, components: [{ type: 10, content: reviewText(session, guild) }, new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:finish:${session.id}`).setLabel("Finalizar").setEmoji(systemComponentEmoji("visto", guild)).setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`${PREFIX}:edit:${session.id}`).setLabel("Editar respostas").setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(`${PREFIX}:cancel:${session.id}`).setLabel("Cancelar").setStyle(ButtonStyle.Danger))] }], flags: MessageFlags.IsComponentsV2 as const, allowedMentions: { parse: [] } };
}

function reviewText(session: PoliceRecruitmentSession, guild: Guild) {
  return [`# 📋 RELATÓRIO DE RECRUTAMENTO`, `**Recrutador:** <@${session.recruiterDiscordId}> | ${session.recruiterPoliceId ?? "-"}`, `**Recrutado:** ${session.recruitedDiscordId ? `<@${session.recruitedDiscordId}>` : "-"}\n`, ...session.answers.map((item) => `**${item.title.replace(/\.$/, "")}:** ${formatAnswer(item.value)}`), `\n${systemEmojiText("alerta", guild)} Revise tudo antes de finalizar.`].join("\n").slice(0, 3900);
}

function reportPayload(report: PoliceRecruitmentReport, guild: Guild) {
  const color = report.result === "APPROVED" ? 0x22c55e : report.result === "REJECTED" ? 0xef4444 : 0xf59e0b;
  const result = report.result === "APPROVED" ? "✅ APROVADO" : report.result === "REJECTED" ? "❌ REPROVADO" : "⚠️ PENDENTE";
  return { components: [{ type: 17, accent_color: color, components: [{ type: 10, content: `# 📋 RECRUTAMENTO — Registro realizado\n**🆔 Relatório:** ${report.reportCode}\n**👮 Recrutador:** <@${report.recruiterDiscordId}> | ${report.recruiterPoliceId ?? "-"}\n**👤 Recrutado:** ${report.recruitedDiscordId ? `<@${report.recruitedDiscordId}>` : report.recruitedName ?? "-"} | ${report.recruitedPoliceId ?? "-"}\n**📚 Prova Teórica:** ${report.theoreticalScore ?? "-"} / 10\n**🚓 Prova Prática:** ${report.practicalScore ?? "-"} / 10\n**📌 Resultado:** ${result}\n**📝 Observações:** ${report.observations ?? "-"}\n**📅 Data:** <t:${Math.floor(Date.parse(report.createdAt) / 1000)}:f>` }] }], flags: MessageFlags.IsComponentsV2 as const, allowedMentions: { parse: [] } };
}

function recruiterHeaderPayload(report: PoliceRecruitmentReport, recruiter: Awaited<ReturnType<BotContext["api"]["getPoliceRecruitmentRecruiter"]>>) {
  return { components: [{ type: 17, accent_color: 0x22c55e, components: [{ type: 10, content: `# 👮 HISTÓRICO DE RECRUTAMENTOS\n**Recrutador:** <@${report.recruiterDiscordId}>\n**Total de recrutamentos:** ${recruiter?.totalRecruitments ?? 0}\n**Aprovados:** ${recruiter?.approved ?? 0}\n**Reprovados:** ${recruiter?.rejected ?? 0}\n**Pendentes:** ${recruiter?.pending ?? 0}\n\nEsta postagem contém todo o histórico de recrutamentos deste membro.` }] }], flags: MessageFlags.IsComponentsV2 as const, allowedMentions: { parse: [] } };
}

function recruiterControlsPayload(recruiterDiscordId: string, guild: Guild) {
  return { components: [{ type: 17, accent_color: 0x64748b, components: [{ type: 10, content: "## 📊 Administração\nUse as ações abaixo para consultar o histórico deste recrutador." }, new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:search:${recruiterDiscordId}`).setLabel("Buscar relatório").setEmoji(systemComponentEmoji("prancheta", guild)).setStyle(ButtonStyle.Secondary))] }], flags: MessageFlags.IsComponentsV2 as const };
}

async function showSearchModal(interaction: ButtonInteraction, recruiterDiscordId: string) {
  await interaction.showModal(new ModalBuilder().setCustomId(`${PREFIX}:search:${recruiterDiscordId}`).setTitle("Buscar relatório").addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("query").setLabel("ID, nome, Discord ID ou ID policial").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100))));
}

async function searchReports(interaction: ModalSubmitInteraction, context: BotContext, recruiterDiscordId: string) {
  await interaction.deferReply({ ephemeral: true });
  const reports = await context.api.listPoliceRecruitmentReports(interaction.guildId!, { q: interaction.fields.getTextInputValue("query"), recruiterDiscordId });
  await interaction.editReply(reports.slice(0, 10).map((item) => `${item.reportCode} • ${item.recruitedName ?? "-"} • ${item.result} • <t:${Math.floor(Date.parse(item.createdAt) / 1000)}:D>`).join("\n") || "Nenhum relatório encontrado.");
}

async function expireSessions(client: Client, context: BotContext) {
  const sessions = await context.api.listPoliceRecruitmentExpiredSessions().catch(() => []);
  for (const session of sessions) {
    const guild = await client.guilds.fetch(session.guildId).catch(() => null);
    const settings = guild ? await context.api.getPoliceRecruitmentSettings(guild.id).catch(() => null) : null;
    await context.api.cancelPoliceRecruitmentSession(session.id, session.recruiterDiscordId, "EXPIRED").catch(() => null);
    const channel = session.channelId && guild ? await guild.channels.fetch(session.channelId).catch(() => null) : null;
    await sendLog(guild, settings, "relatório expirado", session.recruiterDiscordId, session.id);
    await channel?.delete("Relatório de recrutamento expirado").catch(() => null);
  }
}

async function sendLog(guild: Guild | null, settings: PoliceRecruitmentSettings | null, action: string, actorId: string, reference: string) {
  if (!guild || !settings?.logChannelId) return;
  const channel = await guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return;
  await channel.send({ components: [{ type: 17, accent_color: 0x22c55e, components: [{ type: 10, content: `# 📋 Log de Recrutamento\n**Ação:** ${action}\n**Usuário:** <@${actorId}>\n**Referência:** ${reference}\n**Data:** <t:${Math.floor(Date.now() / 1000)}:f>` }] }], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }).catch(() => null);
}

function selectRow(sessionId: string, question: PoliceRecruitmentQuestion) {
  const options = (question.type === "BOOLEAN" ? ["Sim", "Não"] : question.options).slice(0, 25).map((item) => ({ label: item.slice(0, 100), value: item.slice(0, 100) }));
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`${PREFIX}:select:${sessionId}`).setPlaceholder("Selecione uma resposta").addOptions(options));
}

function navRow(sessionId: string, index: number, total: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:move:previous`).setLabel("Anterior").setStyle(ButtonStyle.Secondary).setDisabled(index <= 0),
    new ButtonBuilder().setCustomId(`${PREFIX}:move:next`).setLabel("Próxima").setStyle(ButtonStyle.Secondary).setDisabled(index >= total - 1),
    new ButtonBuilder().setCustomId(`${PREFIX}:review:${sessionId}`).setLabel("Revisar").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}:cancel:${sessionId}`).setLabel("Cancelar").setStyle(ButtonStyle.Danger)
  );
}

function cancelRow(sessionId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:cancel:${sessionId}`).setLabel("Cancelar").setStyle(ButtonStyle.Danger));
}

function canLeaveQuestion(session: PoliceRecruitmentSession, question: PoliceRecruitmentQuestion | undefined) {
  if (!question?.required) return true;
  const value = answerValue(session, question.id);
  return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && String(value).trim() !== "";
}

function channelSessionId(interaction: ButtonInteraction) {
  const first = (interaction.message.components[0] as any)?.components?.find((component: any) => typeof component.customId === "string" && component.customId.includes(`${PREFIX}:`)) as any;
  return first?.customId?.split(":").at(-1) ?? null;
}

function answerValue(session: PoliceRecruitmentSession, questionId: string) {
  return session.answers.find((item) => item.questionId === questionId)?.value ?? null;
}

function formatAnswer(value: unknown) {
  if (Array.isArray(value)) return value.join(", ") || "-";
  if (value === true) return "Sim";
  if (value === false) return "Não";
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

function hasRoleOrAdmin(member: GuildMember, roleIds: string[]) {
  return roleIds.some((roleId) => member.roles.cache.has(roleId));
}

function hasPoliceConfigAccess(member: GuildMember, settings: PoliceRecruitmentSettings) {
  return hasRoleOrAdmin(member, [
    ...settings.manageConfigurationRoleIds,
    ...settings.adminRoleIds,
    ...settings.authorizedRoleIds,
    ...settings.createReportRoleIds
  ]);
}

function hasPoliceRecruitmentAccess(member: GuildMember, settings: PoliceRecruitmentSettings) {
  return hasRoleOrAdmin(member, [
    ...settings.recruiterRoleIds,
    ...settings.createReportRoleIds,
    ...settings.authorizedRoleIds
  ]);
}

function parseColor(value: string) {
  const parsed = Number.parseInt(value.replace("#", ""), 16);
  return Number.isFinite(parsed) ? parsed : 0x22c55e;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function slug(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 35) || "recrutamento";
}

function extractPoliceId(value: string) {
  return value.match(/\b\d{2,8}\b/)?.[0] ?? null;
}

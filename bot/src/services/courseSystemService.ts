import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type GuildMember,
  type Interaction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type TextChannel,
  type UserSelectMenuInteraction,
  type RoleSelectMenuInteraction,
  type ChannelSelectMenuInteraction
} from "discord.js";
import type { BotCommand, BotContext } from "../types";
import { renderComponentsV2Panel } from "./panelVisualRenderer";
import type { Course, CoursePublication, CourseScheduleRequest, CourseSettings } from "./apiClient";

const IDS = {
  addCourse: "course_config_add",
  back: "course_config_back",
  channels: "course_config_channels",
  close: "course_config_close",
  managers: "course_config_managers",
  publishSelect: "course_publish_select",
  scheduleSelect: "course_schedule_select",
  reportSelect: "course_report_select",
  reportAdd: "course_report_add",
  reportLaunch: "course_report_launch",
  reportCancel: "course_report_cancel",
  reportUserSelect: "course_report_user",
  saveManagers: "course_managers_save",
  managerUsers: "course_manager_users",
  managerRoles: "course_manager_roles",
  channelPublish: "course_channel_publish",
  channelSchedule: "course_channel_schedule",
  channelReport: "course_channel_report",
  channelLogs: "course_channel_logs",
  publicPublish: "course_public_publish",
  publicSchedule: "course_public_schedule",
  publicReport: "course_public_report"
} as const;

const reportDrafts = new Map<string, { courseId: string; students: Array<{ note: string; observation: string | null; userId: string }> }>();
let serviceStarted = false;

export function startCourseSystemService(client: Client, context: BotContext) {
  if (serviceStarted) return;
  serviceStarted = true;
  context.socket.onCoursePanelPublish((payload) => {
    void publishPublicCoursesPanel(client, context, payload.guildId).catch((error) => {
      console.error(`[courses] failed to publish panel in ${payload.guildId}:`, error instanceof Error ? error.message : error);
    });
  });
}

export const configCourseCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("config")
    .setDescription("Configura módulos do bot.")
    .addSubcommand((subcommand) => subcommand.setName("curso").setDescription("Abre a configuração do Sistema de Cursos.")),
  moduleId: "courses",
  async execute(interaction, context) {
    if (interaction.options.getSubcommand() !== "curso") return;
    await openCourseConfig(interaction, context);
  }
};

export const courseCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("curso")
    .setDescription("Gerencia cursos.")
    .addSubcommand((subcommand) => subcommand.setName("publicar").setDescription("Publica um curso disponível."))
    .addSubcommand((subcommand) => subcommand.setName("horario").setDescription("Solicita um horário de curso.")),
  moduleId: "courses",
  async execute(interaction, context) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "publicar") {
      await startPublishFlow(interaction, context);
      return;
    }
    if (subcommand === "horario") {
      await startScheduleFlow(interaction, context);
    }
  }
};

export const courseReportCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("relatorio")
    .setDescription("Lança relatórios.")
    .addSubcommand((subcommand) => subcommand.setName("curso").setDescription("Lança relatório de curso.")),
  moduleId: "courses",
  async execute(interaction, context) {
    if (interaction.options.getSubcommand() !== "curso") return;
    await startReportFlow(interaction, context);
  }
};

export async function executeCourseReportCommand(interaction: ChatInputCommandInteraction, context: BotContext) {
  await startReportFlow(interaction, context);
}

export async function handleCourseSystemInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.guild) return false;
  const customId = "customId" in interaction ? interaction.customId : "";
  if (!customId.startsWith("course_")) return false;

  if (interaction.isButton()) await handleButton(interaction, context);
  else if (interaction.isStringSelectMenu()) await handleStringSelect(interaction, context);
  else if (interaction.isUserSelectMenu()) await handleUserSelect(interaction, context);
  else if (interaction.isRoleSelectMenu()) await handleRoleSelect(interaction, context);
  else if (interaction.isChannelSelectMenu()) await handleChannelSelect(interaction, context);
  else if (interaction.isModalSubmit()) await handleModal(interaction, context);
  return true;
}

async function openCourseConfig(interaction: ChatInputCommandInteraction | ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const settings = await context.api.getCourseSettings(interaction.guild.id);
  const payload = courseConfigPanel(settings);
  if (interaction.isButton()) {
    await interaction.update(payload).catch(async () => interaction.reply(ephemeral(payload)));
  } else {
    await interaction.reply(ephemeral(payload));
  }
}

async function startPublishFlow(interaction: ChatInputCommandInteraction | ButtonInteraction, context: BotContext) {
  const courses = await manageableCourses(interaction, context);
  if (!courses.length) {
    await interaction.reply(ephemeral(accessDeniedPanel(await context.api.getCourseSettings(interaction.guildId!), interaction.guild!)));
    return;
  }
  if (courses.length === 1) {
    await interaction.showModal(publicationModal(courses[0]!.id));
    return;
  }
  await interaction.reply(ephemeral(selectCoursePanel("Selecione o curso que deseja publicar.", IDS.publishSelect, courses)));
}

async function startScheduleFlow(interaction: ChatInputCommandInteraction | ButtonInteraction, context: BotContext) {
  const courses = await manageableCourses(interaction, context);
  if (!courses.length) {
    await interaction.reply(ephemeral(accessDeniedPanel(await context.api.getCourseSettings(interaction.guildId!), interaction.guild!)));
    return;
  }
  if (courses.length === 1) {
    await interaction.showModal(scheduleModal(courses[0]!.id));
    return;
  }
  await interaction.reply(ephemeral(selectCoursePanel("Selecione o curso para solicitar horário.", IDS.scheduleSelect, courses)));
}

async function startReportFlow(interaction: ChatInputCommandInteraction | ButtonInteraction, context: BotContext) {
  const courses = await manageableCourses(interaction, context);
  if (!courses.length) {
    await interaction.reply(ephemeral(accessDeniedPanel(await context.api.getCourseSettings(interaction.guildId!), interaction.guild!)));
    return;
  }
  await interaction.reply(ephemeral(selectCoursePanel("Selecione o curso aplicado para iniciar o relatório.", IDS.reportSelect, courses)));
}

async function handleButton(interaction: ButtonInteraction, context: BotContext) {
  if (interaction.customId === IDS.close) {
    await interaction.update({ components: [], content: "Painel fechado." });
    return;
  }
  if (interaction.customId === IDS.back) {
    await openCourseConfig(interaction, context);
    return;
  }
  if (interaction.customId === IDS.addCourse) {
    await interaction.showModal(new ModalBuilder()
      .setCustomId("course_modal_create")
      .setTitle("Cadastrar Curso")
      .addComponents(
        inputRow("name", "Nome do curso", TextInputStyle.Short, true, 120),
        inputRow("description", "Descrição do curso", TextInputStyle.Paragraph, false, 900),
        inputRow("emoji", "Emoji do curso", TextInputStyle.Short, false, 40),
        inputRow("active", "Status inicial: ativo? Sim/Não", TextInputStyle.Short, true, 3, "Sim")
      ));
    return;
  }
  if (interaction.customId === IDS.managers) {
    await interaction.update(managersPanel(await context.api.getCourseSettings(interaction.guildId!)));
    return;
  }
  if (interaction.customId === IDS.channels) {
    await interaction.update(channelsPanel(await context.api.getCourseSettings(interaction.guildId!)));
    return;
  }
  if (interaction.customId === IDS.publicPublish) {
    await startPublishFlow(interaction, context);
    return;
  }
  if (interaction.customId === IDS.publicSchedule) {
    await startScheduleFlow(interaction, context);
    return;
  }
  if (interaction.customId === IDS.publicReport) {
    await startReportFlow(interaction, context);
    return;
  }
  if (interaction.customId.startsWith("course_join:")) {
    await joinPublication(interaction, context, idFromCustomId(interaction.customId));
    return;
  }
  if (interaction.customId.startsWith("course_leave:")) {
    await leavePublication(interaction, context, idFromCustomId(interaction.customId));
    return;
  }
  if (interaction.customId.startsWith("course_start:")) {
    await changePublicationStatus(interaction, context, idFromCustomId(interaction.customId), "started");
    return;
  }
  if (interaction.customId.startsWith("course_cancel:")) {
    await changePublicationStatus(interaction, context, idFromCustomId(interaction.customId), "cancelled");
    return;
  }
  if (interaction.customId.startsWith("course_schedule_approve:") || interaction.customId.startsWith("course_schedule_reject:")) {
    await decideSchedule(interaction, context);
    return;
  }
  if (interaction.customId === IDS.reportAdd) {
    await interaction.reply(ephemeral({
      components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder().setCustomId(IDS.reportUserSelect).setPlaceholder("Selecione o oficial avaliado").setMinValues(1).setMaxValues(1))],
      content: "Selecione o oficial avaliado."
    }));
    return;
  }
  if (interaction.customId === IDS.reportLaunch) {
    await launchReport(interaction, context);
    return;
  }
  if (interaction.customId === IDS.reportCancel) {
    reportDrafts.delete(draftKey(interaction));
    await interaction.update({ components: [], content: "Relatório cancelado." });
  }
}

async function handleStringSelect(interaction: StringSelectMenuInteraction, _context: BotContext) {
  const courseId = interaction.values[0] ?? "";
  if (interaction.customId === IDS.publishSelect) {
    await interaction.showModal(publicationModal(courseId));
    return;
  }
  if (interaction.customId === IDS.scheduleSelect) {
    await interaction.showModal(scheduleModal(courseId));
    return;
  }
  if (interaction.customId === IDS.reportSelect) {
    reportDrafts.set(draftKey(interaction), { courseId, students: [] });
    await interaction.update(reportDraftPanel(interaction.user.id, courseId, []));
  }
}

async function handleUserSelect(interaction: UserSelectMenuInteraction, context: BotContext) {
  if (interaction.customId === IDS.managerUsers) {
    const settings = await context.api.saveCourseSettings(interaction.guildId!, { managerUserIds: interaction.values }, interaction.user.id);
    await interaction.update(managersPanel(settings, "Gestores da unidade atualizados com sucesso."));
    return;
  }
  if (interaction.customId === IDS.reportUserSelect) {
    const draft = reportDrafts.get(draftKey(interaction));
    if (!draft) {
      await interaction.update({ components: [], content: "Relatório expirado. Execute /relatorio curso novamente." });
      return;
    }
    await interaction.showModal(new ModalBuilder()
      .setCustomId(`course_report_note:${interaction.values[0]}`)
      .setTitle("Nota do Oficial")
      .addComponents(
        inputRow("note", "Nota de 0 a 10", TextInputStyle.Short, true, 4),
        inputRow("observation", "Observação", TextInputStyle.Paragraph, false, 500)
      ));
  }
}

async function handleRoleSelect(interaction: RoleSelectMenuInteraction, context: BotContext) {
  if (interaction.customId === IDS.managerRoles) {
    const settings = await context.api.saveCourseSettings(interaction.guildId!, { managerRoleIds: interaction.values }, interaction.user.id);
    await interaction.update(managersPanel(settings, "Gestores da unidade atualizados com sucesso."));
  }
}

async function handleChannelSelect(interaction: ChannelSelectMenuInteraction, context: BotContext) {
  const patch: Partial<CourseSettings> = {};
  const value = interaction.values[0] ?? null;
  if (interaction.customId === IDS.channelPublish) patch.publishChannelId = value;
  if (interaction.customId === IDS.channelSchedule) patch.scheduleChannelId = value;
  if (interaction.customId === IDS.channelReport) patch.reportChannelId = value;
  if (interaction.customId === IDS.channelLogs) patch.logChannelId = value;
  const settings = await context.api.saveCourseSettings(interaction.guildId!, patch, interaction.user.id);
  await interaction.update(channelsPanel(settings, "Configuração de publicação salva com sucesso."));
}

async function handleModal(interaction: ModalSubmitInteraction, context: BotContext) {
  if (interaction.customId === "course_modal_create") {
    const course = await context.api.createCourse(interaction.guildId!, {
      active: /^s/i.test(interaction.fields.getTextInputValue("active")),
      description: interaction.fields.getTextInputValue("description") || null,
      emoji: interaction.fields.getTextInputValue("emoji") || null,
      name: interaction.fields.getTextInputValue("name")
    }, interaction.user.id);
    await interaction.reply(ephemeral(responsiblesPanel(course, "Curso cadastrado com sucesso.")));
    return;
  }
  if (interaction.customId.startsWith("course_publish_modal:")) {
    await publishCourse(interaction, context, idFromCustomId(interaction.customId));
    return;
  }
  if (interaction.customId.startsWith("course_schedule_modal:")) {
    await requestSchedule(interaction, context, idFromCustomId(interaction.customId));
    return;
  }
  if (interaction.customId.startsWith("course_report_note:")) {
    await addReportStudent(interaction);
  }
}

async function publishCourse(interaction: ModalSubmitInteraction, context: BotContext, courseId: string) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const [settings, course] = await Promise.all([
    context.api.getCourseSettings(interaction.guildId!),
    context.api.getCourse(interaction.guildId!, courseId)
  ]);
  if (!settings.publishChannelId) {
    await interaction.editReply("Canal padrão de publicação dos cursos não configurado.");
    return;
  }
  const channel = await interaction.guild!.channels.fetch(settings.publishChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) {
    await interaction.editReply("Canal de publicação inválido ou sem permissão de envio.");
    return;
  }
  const publication = await context.api.createCoursePublication(interaction.guildId!, {
    capacity: Number(interaction.fields.getTextInputValue("capacity")) || 1,
    channelId: settings.publishChannelId,
    courseId,
    instructorId: interaction.user.id,
    location: interaction.fields.getTextInputValue("location"),
    notes: interaction.fields.getTextInputValue("notes") || null,
    scheduledFor: interaction.fields.getTextInputValue("time")
  });
  const message = await (channel as TextChannel).send(coursePublicationPanel(course, publication, settings, interaction.guild!));
  await context.api.updateCoursePublicationMessage(interaction.guildId!, publication.id, message.id);
  await interaction.editReply("Curso publicado com sucesso.");
}

async function requestSchedule(interaction: ModalSubmitInteraction, context: BotContext, courseId: string) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const [settings, course] = await Promise.all([
    context.api.getCourseSettings(interaction.guildId!),
    context.api.getCourse(interaction.guildId!, courseId)
  ]);
  if (!settings.scheduleChannelId) {
    await interaction.editReply("Canal de agendamentos não configurado.");
    return;
  }
  const channel = await interaction.guild!.channels.fetch(settings.scheduleChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) {
    await interaction.editReply("Canal de agendamentos inválido ou sem permissão de envio.");
    return;
  }
  const request = await context.api.createCourseSchedule(interaction.guildId!, {
    channelId: settings.scheduleChannelId,
    courseId,
    instructorId: interaction.user.id,
    location: interaction.fields.getTextInputValue("location"),
    notes: interaction.fields.getTextInputValue("notes") || null,
    requestedDate: interaction.fields.getTextInputValue("date"),
    requestedTime: interaction.fields.getTextInputValue("time")
  });
  const message = await (channel as TextChannel).send(schedulePanel(course, request));
  await context.api.updateCourseScheduleMessage(interaction.guildId!, request.id, message.id);
  await interaction.editReply("Solicitação de horário enviada para os gestores.");
}

async function joinPublication(interaction: ButtonInteraction, context: BotContext, publicationId: string) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await context.api.joinCoursePublication(interaction.guildId!, publicationId, interaction.user.id);
  if (result.error === "full") return interaction.editReply("Este curso está com todas as vagas preenchidas.");
  if (result.error === "started") return interaction.editReply("Este curso já foi iniciado. Novas entradas não são mais permitidas.");
  if (result.error === "closed") return interaction.editReply("Este curso não está aberto para entrada.");
  if (result.error === "already") return interaction.editReply("Você já está inscrito neste curso.");
  if (!result.publication) return interaction.editReply("Curso não encontrado.");
  await refreshPublicationMessage(interaction, context, result.publication);
  await interaction.editReply("Você entrou no curso com sucesso.");
}

async function leavePublication(interaction: ButtonInteraction, context: BotContext, publicationId: string) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const publication = await context.api.leaveCoursePublication(interaction.guildId!, publicationId, interaction.user.id);
  await refreshPublicationMessage(interaction, context, publication);
  await interaction.editReply("Você saiu do curso com sucesso.");
}

async function changePublicationStatus(interaction: ButtonInteraction, context: BotContext, publicationId: string, status: "started" | "cancelled") {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const publication = await context.api.getCoursePublication(interaction.guildId!, publicationId);
  const allowed = await canManagePublication(interaction, context, publication);
  if (!allowed) {
    await interaction.editReply("Você não tem permissão para gerenciar este curso.");
    return;
  }
  const updated = await context.api.setCoursePublicationStatus(interaction.guildId!, publicationId, status, interaction.user.id);
  await refreshPublicationMessage(interaction, context, updated);
  await interaction.editReply(status === "started" ? "Curso iniciado. Novas entradas foram bloqueadas." : "Curso cancelado.");
}

async function decideSchedule(interaction: ButtonInteraction, context: BotContext) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const [, , action, requestId] = interaction.customId.split("_").join(":").split(":");
  if (!requestId) {
    await interaction.editReply("Solicitação inválida.");
    return;
  }
  const request = await context.api.getCourseSchedule(interaction.guildId!, requestId);
  if (!(await canManageCourse(interaction, context, request.courseId))) {
    await interaction.editReply("Você não tem permissão para aprovar horários.");
    return;
  }
  const status = action === "approve" ? "approved" : "rejected";
  const updated = await context.api.decideCourseSchedule(interaction.guildId!, requestId, status, interaction.user.id);
  const course = await context.api.getCourse(interaction.guildId!, request.courseId);
  await interaction.message.edit(schedulePanel(course, updated)).catch(() => null);
  const member = await interaction.guild!.members.fetch(request.instructorId).catch(() => null);
  await member?.send(status === "approved" ? "Seu horário para o curso foi aprovado." : "Seu horário para o curso foi recusado.").catch(() => null);
  await interaction.editReply(status === "approved" ? "Horário aprovado." : "Horário recusado.");
}

async function addReportStudent(interaction: ModalSubmitInteraction) {
  const userId = idFromCustomId(interaction.customId);
  if (!userId) {
    await interaction.reply({ content: "Oficial inválido.", flags: MessageFlags.Ephemeral });
    return;
  }
  const note = interaction.fields.getTextInputValue("note").replace(",", ".");
  if (!/^(10(?:\.0)?|[0-9](?:\.[0-9])?)$/.test(note)) {
    await interaction.reply({ content: "Nota inválida. Use valores de 0 a 10, como 9.5.", flags: MessageFlags.Ephemeral });
    return;
  }
  const key = draftKey(interaction);
  const draft = reportDrafts.get(key);
  if (!draft) {
    await interaction.reply({ content: "Relatório expirado. Execute /relatorio curso novamente.", flags: MessageFlags.Ephemeral });
    return;
  }
  draft.students = [...draft.students.filter((student) => student.userId !== userId), {
    note,
    observation: interaction.fields.getTextInputValue("observation") || null,
    userId
  }];
  reportDrafts.set(key, draft);
  await interaction.reply(ephemeral(reportDraftPanel(interaction.user.id, draft.courseId, draft.students)));
}

async function launchReport(interaction: ButtonInteraction, context: BotContext) {
  const draft = reportDrafts.get(draftKey(interaction));
  if (!draft?.students.length) {
    await interaction.reply({ content: "Nenhum aluno selecionado no relatório.", flags: MessageFlags.Ephemeral });
    return;
  }
  const [settings, course] = await Promise.all([
    context.api.getCourseSettings(interaction.guildId!),
    context.api.getCourse(interaction.guildId!, draft.courseId)
  ]);
  if (!settings.reportChannelId) {
    await interaction.reply({ content: "Canal de relatório não configurado.", flags: MessageFlags.Ephemeral });
    return;
  }
  const channel = await interaction.guild!.channels.fetch(settings.reportChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) {
    await interaction.reply({ content: "Canal de relatório inválido ou sem permissão.", flags: MessageFlags.Ephemeral });
    return;
  }
  const now = new Date();
  const reportPayload = {
    channelId: settings.reportChannelId,
    courseId: draft.courseId,
    instructorId: interaction.user.id,
    reportDate: now.toLocaleDateString("pt-BR"),
    reportTime: now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    students: draft.students
  };
  const message = await (channel as TextChannel).send(reportPanel(course, reportPayload, settings));
  await context.api.createCourseReport(interaction.guildId!, { ...reportPayload, messageId: message.id });
  reportDrafts.delete(draftKey(interaction));
  await interaction.reply({ content: "Relatório de curso lançado com sucesso.", flags: MessageFlags.Ephemeral });
}

async function refreshPublicationMessage(interaction: ButtonInteraction, context: BotContext, publication: CoursePublication) {
  const [course, settings] = await Promise.all([
    context.api.getCourse(interaction.guildId!, publication.courseId),
    context.api.getCourseSettings(interaction.guildId!)
  ]);
  await interaction.message.edit(coursePublicationPanel(course, publication, settings, interaction.guild!)).catch(() => null);
}

async function publishPublicCoursesPanel(client: Client, context: BotContext, guildId: string) {
  const [settings, courses] = await Promise.all([
    context.api.getCourseSettings(guildId),
    context.api.getManageableCourses(guildId, { isAdministrator: true, roleIds: [], userId: client.user?.id ?? "00000" })
  ]);
  if (!settings.publishChannelId) throw new Error("Course publish channel is not configured.");
  const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
  const channel = await guild?.channels.fetch(settings.publishChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) throw new Error("Course publish channel is invalid or missing send permission.");
  const payload = publicCoursesPanel(settings, courses);
  const message = settings.panelMessageId && "messages" in channel
    ? await channel.messages.fetch(settings.panelMessageId).catch(() => null)
    : null;
  const nextMessage = message
    ? await message.edit(payload)
    : await (channel as TextChannel).send(payload);
  await context.api.updateCoursePanelMessage(guildId, nextMessage.id);
}

async function manageableCourses(interaction: ChatInputCommandInteraction | ButtonInteraction, context: BotContext) {
  const member = interaction.member as GuildMember | null;
  return context.api.getManageableCourses(interaction.guildId!, {
    isAdministrator: Boolean(member?.permissions.has(PermissionFlagsBits.Administrator)),
    roleIds: member?.roles.cache.map((role) => role.id) ?? [],
    userId: interaction.user.id
  });
}

async function canManagePublication(interaction: ButtonInteraction, context: BotContext, publication: CoursePublication) {
  if (publication.instructorId === interaction.user.id) return true;
  return canManageCourse(interaction, context, publication.courseId);
}

async function canManageCourse(interaction: ButtonInteraction, context: BotContext, courseId: string) {
  const member = interaction.member as GuildMember | null;
  const courses = await context.api.getManageableCourses(interaction.guildId!, {
    isAdministrator: Boolean(member?.permissions.has(PermissionFlagsBits.Administrator)),
    roleIds: member?.roles.cache.map((role) => role.id) ?? [],
    userId: interaction.user.id
  });
  return courses.some((course) => course.id === courseId);
}

function courseConfigPanel(settings: CourseSettings) {
  return renderComponentsV2Panel({
    accentColor: 0x2563eb,
    actions: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(IDS.addCourse).setLabel("Cadastrar Curso").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(IDS.managers).setLabel("Configurar Gestores").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(IDS.channels).setLabel("Configurar Canais").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(IDS.close).setLabel("Fechar").setStyle(ButtonStyle.Danger)
      )
    ],
    description: "Gerencie os cursos, instrutores, gestores, canais de publicação, agendamentos e relatórios.",
    fields: [
      `Publicação: ${settings.publishChannelId ? `<#${settings.publishChannelId}>` : "não configurado"}`,
      `Agendamentos: ${settings.scheduleChannelId ? `<#${settings.scheduleChannelId}>` : "não configurado"}`,
      `Relatórios: ${settings.reportChannelId ? `<#${settings.reportChannelId}>` : "não configurado"}`,
      `Logs: ${settings.logChannelId ? `<#${settings.logChannelId}>` : "não configurado"}`
    ],
    moduleId: "courses",
    title: "Configuração do Sistema de Cursos"
  });
}

function publicCoursesPanel(settings: CourseSettings, courses: Course[]) {
  const activeCourses = courses.filter((course) => course.active);
  return renderComponentsV2Panel({
    accentColor: 0x2563eb,
    actions: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(IDS.publicPublish).setLabel(`${settings.buttonEmojis.enter} Publicar Curso`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(IDS.publicSchedule).setLabel("Solicitar Horário").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(IDS.publicReport).setLabel("Lançar Relatório").setStyle(ButtonStyle.Success)
      )
    ],
    description: "Use este painel para publicar cursos disponíveis, solicitar horários e lançar relatórios de aplicação.",
    fields: [
      `Cursos ativos: ${activeCourses.length}`,
      activeCourses.slice(0, 12).map((course) => `${course.emoji ?? "📚"} ${course.name}`).join("\n") || "Nenhum curso ativo cadastrado."
    ],
    image: settings.globalBannerUrl ? { imageEnabled: true, imagePosition: "top", imageUrl: settings.globalBannerUrl } : null,
    moduleId: "courses",
    title: "Sistema de Cursos"
  });
}

function managersPanel(settings: CourseSettings, message?: string) {
  return renderComponentsV2Panel({
    accentColor: 0x2563eb,
    actions: [
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder().setCustomId(IDS.managerUsers).setPlaceholder("Selecione usuários gestores").setMinValues(0).setMaxValues(10)),
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(new RoleSelectMenuBuilder().setCustomId(IDS.managerRoles).setPlaceholder("Selecione cargos gestores").setMinValues(0).setMaxValues(10)),
      new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(IDS.back).setLabel("Voltar").setStyle(ButtonStyle.Secondary))
    ],
    description: "Configure quem poderá supervisionar os cursos, aprovar horários e auxiliar instrutores.",
    fields: [
      message ? `**${message}**` : "",
      `Usuários gestores: ${settings.managerUserIds.map((id) => `<@${id}>`).join(", ") || "nenhum"}`,
      `Cargos gestores: ${settings.managerRoleIds.map((id) => `<@&${id}>`).join(", ") || "nenhum"}`
    ].filter(Boolean),
    moduleId: "courses",
    title: "Gestores da Unidade"
  });
}

function channelsPanel(settings: CourseSettings, message?: string) {
  const channelSelect = (id: string, placeholder: string) => new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1)
  );
  return renderComponentsV2Panel({
    accentColor: 0x2563eb,
    actions: [
      channelSelect(IDS.channelPublish, "Canal padrão de publicação"),
      channelSelect(IDS.channelSchedule, "Canal de agendamentos"),
      channelSelect(IDS.channelReport, "Canal de relatórios"),
      channelSelect(IDS.channelLogs, "Canal de logs"),
      new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(IDS.back).setLabel("Voltar").setStyle(ButtonStyle.Secondary))
    ],
    description: "Defina onde os cursos serão publicados, agendados, registrados e auditados.",
    fields: [
      message ? `**${message}**` : "",
      `Publicação: ${settings.publishChannelId ? `<#${settings.publishChannelId}>` : "não configurado"}`,
      `Agendamentos: ${settings.scheduleChannelId ? `<#${settings.scheduleChannelId}>` : "não configurado"}`,
      `Relatórios: ${settings.reportChannelId ? `<#${settings.reportChannelId}>` : "não configurado"}`,
      `Logs: ${settings.logChannelId ? `<#${settings.logChannelId}>` : "não configurado"}`
    ].filter(Boolean),
    moduleId: "courses",
    title: "Publicação dos Cursos"
  });
}

function responsiblesPanel(course: Course, message: string) {
  return renderComponentsV2Panel({
    accentColor: parseColor(course.color),
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(IDS.back).setLabel("Voltar para Configuração de Cursos").setStyle(ButtonStyle.Secondary))],
    description: "Selecione responsáveis pela dashboard em Cursos ou edite o curso no painel web para definir usuários e cargos instrutores.",
    fields: [`**${message}**`, `Curso: ${course.emoji ?? "📚"} ${course.name}`],
    moduleId: "courses",
    title: "Responsáveis pelo curso"
  });
}

function accessDeniedPanel(settings: CourseSettings, guild: { roles: { cache: Map<string, unknown> } }) {
  const managers = [
    ...settings.managerUserIds.map((id) => `<@${id}>`),
    ...settings.managerRoleIds.map((id) => `<@&${id}>`)
  ].join(", ") || "nenhum gestor configurado";
  return renderComponentsV2Panel({
    accentColor: 0xdc2626,
    description: settings.noPermissionMessage,
    fields: [`Gestores disponíveis: ${managers}`],
    moduleId: "courses",
    title: "Acesso negado"
  });
}

function selectCoursePanel(description: string, customId: string, courses: Course[]) {
  return renderComponentsV2Panel({
    accentColor: 0x2563eb,
    actions: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(customId)
          .setPlaceholder("Selecione um curso")
          .addOptions(courses.slice(0, 25).map((course) => ({ label: course.name.slice(0, 100), value: course.id, description: course.description?.slice(0, 100) || undefined })))
      )
    ],
    description,
    moduleId: "courses",
    title: "Sistema de Cursos"
  });
}

function coursePublicationPanel(course: Course, publication: CoursePublication, settings: CourseSettings, guild: { members: { cache: Map<string, GuildMember> } }) {
  const students = publication.students.map((id, index) => `${index + 1}. <@${id}>`).join("\n") || "Nenhum aluno inscrito ainda.";
  const statusText = publication.status === "open" ? "Aberto" : publication.status === "started" ? "Iniciado" : publication.status === "cancelled" ? "Cancelado" : "Encerrado";
  const statusNotice = publication.status === "started" ? settings.startedMessage : publication.status === "cancelled" ? (course.cancelledText || settings.cancelledMessage) : "Clique em Entrar no Curso para participar.";
  return renderComponentsV2Panel({
    accentColor: parseColor(course.color),
    actions: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`course_join:${publication.id}`).setLabel(`${settings.buttonEmojis.enter} ${course.buttonLabels.enter}`).setStyle(ButtonStyle.Success).setDisabled(publication.status !== "open"),
        new ButtonBuilder().setCustomId(`course_leave:${publication.id}`).setLabel(`${settings.buttonEmojis.leave} ${course.buttonLabels.leave}`).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`course_start:${publication.id}`).setLabel(`${settings.buttonEmojis.start} ${course.buttonLabels.start}`).setStyle(ButtonStyle.Primary).setDisabled(publication.status !== "open"),
        new ButtonBuilder().setCustomId(`course_cancel:${publication.id}`).setLabel(`${settings.buttonEmojis.cancel} ${course.buttonLabels.cancel}`).setStyle(ButtonStyle.Danger).setDisabled(publication.status === "cancelled")
      )
    ],
    description: course.publishText || course.description || "Curso disponível para inscrição.",
    fields: [
      `Instrutor: <@${publication.instructorId}>\nLocal: ${publication.location}\nHorário: ${publication.scheduledFor}\nVagas: ${publication.students.length}/${publication.capacity}\nStatus: ${statusText}`,
      publication.notes ? `Observações: ${publication.notes}` : "",
      statusNotice,
      `Alunos inscritos:\n${students}`,
      publication.status === "cancelled" ? `Cancelado por: ${publication.cancelledBy ? `<@${publication.cancelledBy}>` : "-"}\nData: ${publication.cancelledAt ? new Date(publication.cancelledAt).toLocaleString("pt-BR") : "-"}` : ""
    ].filter(Boolean),
    image: course.bannerUrl ? { imageEnabled: true, imagePosition: course.imagePosition === "side" ? "side" : course.imagePosition === "footer" ? "footer" : course.imagePosition, imageUrl: course.bannerUrl } : null,
    moduleId: "courses",
    title: publication.status === "cancelled" ? "Curso Cancelado" : `Curso de ${course.name}`
  });
}

function schedulePanel(course: Course, request: CourseScheduleRequest) {
  const status = request.status === "pending" ? "Pendente" : request.status === "approved" ? "Aprovado" : "Recusado";
  return renderComponentsV2Panel({
    accentColor: parseColor(course.color),
    actions: request.status === "pending"
      ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`course_schedule_approve:${request.id}`).setLabel("Aprovar Horário").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`course_schedule_reject:${request.id}`).setLabel("Recusar Horário").setStyle(ButtonStyle.Danger)
      )]
      : [],
    description: "Solicitação de Horário de Curso",
    fields: [
      `Instrutor solicitante: <@${request.instructorId}>\nCurso: ${course.name}\nData: ${request.requestedDate}\nHorário: ${request.requestedTime}\nLocal: ${request.location}`,
      `Observação: ${request.notes || "Sem observação"}\nStatus: ${status}`
    ],
    moduleId: "courses",
    title: "Solicitação de Horário de Curso"
  });
}

function reportDraftPanel(instructorId: string, courseId: string, students: Array<{ note: string; observation: string | null; userId: string }>) {
  return renderComponentsV2Panel({
    accentColor: 0x2563eb,
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(IDS.reportAdd).setLabel("Adicionar Oficial").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(IDS.reportLaunch).setLabel("Lançar Nota").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(IDS.reportCancel).setLabel("Cancelar Relatório").setStyle(ButtonStyle.Danger)
    )],
    description: "Selecione os oficiais avaliados, informe as notas e lance o relatório no canal configurado.",
    fields: [
      `Instrutor: <@${instructorId}>\nCurso ID: ${courseId}\nData: ${new Date().toLocaleDateString("pt-BR")}\nHorário: ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
      `Alunos adicionados:\n${students.map((student, index) => `${index + 1}. <@${student.userId}> - Nota: ${student.note} - Observação: ${student.observation || "Sem observação"}`).join("\n") || "Nenhum aluno adicionado."}`
    ],
    moduleId: "courses",
    title: "Relatório de Curso"
  });
}

function reportPanel(course: Course, report: { instructorId: string; reportDate: string; reportTime: string; students: Array<{ note: string; observation?: string | null; userId: string }> }, settings: CourseSettings) {
  return renderComponentsV2Panel({
    accentColor: parseColor(course.color),
    description: "Relatório gerado automaticamente pelo sistema de cursos.",
    fields: [
      `Instrutor:\n<@${report.instructorId}>`,
      `Curso:\n${course.name}`,
      `Data: ${report.reportDate}\nHorário: ${report.reportTime}`,
      `Oficiais avaliados:\n${report.students.map((student, index) => `${index + 1}. <@${student.userId}>\nNota: ${student.note}\nObservação: ${student.observation || "Sem observação"}`).join("\n\n")}`
    ],
    image: settings.reportImageUrl ? { imageEnabled: true, imagePosition: "footer", imageUrl: settings.reportImageUrl } : null,
    moduleId: "courses",
    title: "Relatório de Curso"
  });
}

function publicationModal(courseId: string) {
  return new ModalBuilder()
    .setCustomId(`course_publish_modal:${courseId}`)
    .setTitle("Publicar Curso")
    .addComponents(
      inputRow("location", "Local do curso", TextInputStyle.Short, true, 120),
      inputRow("time", "Horário do curso", TextInputStyle.Short, true, 80),
      inputRow("capacity", "Quantidade de vagas", TextInputStyle.Short, true, 4),
      inputRow("notes", "Observações", TextInputStyle.Paragraph, false, 900)
    );
}

function scheduleModal(courseId: string) {
  return new ModalBuilder()
    .setCustomId(`course_schedule_modal:${courseId}`)
    .setTitle("Solicitar Horário")
    .addComponents(
      inputRow("date", "Data desejada", TextInputStyle.Short, true, 40),
      inputRow("time", "Horário desejado", TextInputStyle.Short, true, 40),
      inputRow("location", "Local desejado", TextInputStyle.Short, true, 120),
      inputRow("notes", "Observação", TextInputStyle.Paragraph, false, 900)
    );
}

function inputRow(customId: string, label: string, style: TextInputStyle, required: boolean, maxLength: number, value?: string) {
  const input = new TextInputBuilder().setCustomId(customId).setLabel(label).setStyle(style).setRequired(required).setMaxLength(maxLength);
  if (value) input.setValue(value);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

function ephemeral<T extends Record<string, unknown>>(payload: T) {
  return { ...payload, flags: Number(payload.flags ?? 0) | MessageFlags.Ephemeral };
}

function draftKey(interaction: { guildId: string | null; user: { id: string } }) {
  return `${interaction.guildId}:${interaction.user.id}`;
}

function parseColor(value: string | null | undefined) {
  const parsed = Number.parseInt((value ?? "").replace("#", ""), 16);
  return Number.isFinite(parsed) ? parsed : 0x2563eb;
}

function idFromCustomId(customId: string) {
  return customId.split(":")[1] ?? "";
}

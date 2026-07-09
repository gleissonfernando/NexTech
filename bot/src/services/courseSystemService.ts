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
  type Message,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type TextChannel,
  type UserSelectMenuInteraction,
  type RoleSelectMenuInteraction,
  type ChannelSelectMenuInteraction
} from "discord.js";
import type { BotCommand, BotContext } from "../types";
import { resetSelectMenuMessage, showModalAndResetSelect } from "../utils/selectMenuReset";
import { renderComponentsV2Panel, type PanelVisualConfig } from "./panelVisualRenderer";
import type { Course, CourseExamAnswer, CourseExamAttempt, CourseExamQuestion, CourseExamSettings, CoursePublication, CourseScheduleRequest, CourseSettings } from "./apiClient";
import { openReportSystemAdmin } from "./reportSystemService";

type CourseActionInteraction = ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;

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
  editCourse: "course_config_edit_course",
  editCourseInfo: "course_edit_info",
  editSelect: "course_edit_select",
  courseInstructorUsers: "course_instructor_users",
  courseInstructorRoles: "course_instructor_roles",
  coursePublishChannel: "course_course_publish_channel",
  generalInstructorRoles: "course_general_instructor_roles",
  publicPublish: "course_public_publish",
  publicSchedule: "course_public_schedule",
  publicReport: "course_public_report",
  sync: "course_config_sync",
  examApproveModal: "course_exam_approve_modal",
  proofSelect: "course_proof_select",
  startSelect: "course_start_select"
} as const;

const reportDrafts = new Map<string, { courseId: string; students: Array<{ note: string; observation: string | null; userId: string }> }>();
const pendingExamAnswers = new Map<string, { question: CourseExamQuestion; selectedAlternativeId?: string | null; writtenAnswer?: string | null }>();
let serviceStarted = false;

export function startCourseSystemService(client: Client, context: BotContext) {
  if (serviceStarted) return;
  serviceStarted = true;
  context.socket.onCoursePanelPublish((payload) => {
    void publishPublicCoursesPanel(client, context, payload.guildId).catch((error) => {
      console.error(`[courses] failed to publish panel in ${payload.guildId}:`, error instanceof Error ? error.message : error);
    });
  });
  const refreshExistingPanels = () => {
    void refreshActiveCoursePublicationPanels(client, context).catch((error) => {
      console.error("[courses] failed to refresh active publication panels:", error instanceof Error ? error.message : error);
    });
  };
  if (client.isReady()) refreshExistingPanels();
  else client.once("ready", refreshExistingPanels);
}

export const configCourseCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("config")
    .setDescription("Configura módulos do bot.")
    .addSubcommand((subcommand) => subcommand.setName("curso").setDescription("Abre a configuração do Sistema de Cursos."))
    .addSubcommand((subcommand) => subcommand.setName("iab").setDescription("Abre o painel IAB Config.")),
  moduleId: "courses",
  async execute(interaction, context) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "curso") {
      await openCourseConfig(interaction, context);
      return;
    }
    if (subcommand === "iab") {
      await openReportSystemAdmin(interaction, context);
    }
  }
};

export const courseCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("curso")
    .setDescription("Gerencia cursos.")
    .addSubcommand((subcommand) => subcommand.setName("config").setDescription("Abre a configuração do Sistema de Cursos."))
    .addSubcommand((subcommand) => subcommand.setName("publicar").setDescription("Publica um curso disponível."))
    .addSubcommand((subcommand) => subcommand.setName("horario").setDescription("Solicita um horário de curso.")),
  moduleId: "courses",
  async execute(interaction, context) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "config") {
      await openCourseConfig(interaction, context);
      return;
    }
    if (subcommand === "publicar") {
      await startPublishFlow(interaction, context);
      return;
    }
    if (subcommand === "horario") {
      await startScheduleFlow(interaction, context);
    }
  }
};

export const configCursoCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("configcurso")
    .setDescription("Abre a configuração do Sistema de Cursos."),
  moduleId: "courses",
  async execute(interaction, context) {
    await openCourseConfig(interaction, context);
  }
};

export const publicarCursoCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("publicarcurso")
    .setDescription("Publica um curso disponível."),
  moduleId: "courses",
  async execute(interaction, context) {
    await startPublishFlow(interaction, context);
  }
};

export const startCourseCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("iniciar")
    .setDescription("Inicia sistemas em andamento.")
    .addSubcommand((subcommand) => subcommand.setName("curso").setDescription("Inicia uma publicação de curso aberta."))
    .addSubcommand((subcommand) => subcommand.setName("prova").setDescription("Inicia a prova de uma aula já iniciada.")),
  moduleId: "courses",
  async execute(interaction, context) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "curso") {
      await startCourseStartFlow(interaction, context);
      return;
    }
    if (subcommand === "prova") {
      await startCourseProofFlow(interaction, context);
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
  const [settings, panelVisual] = await Promise.all([
    context.api.getCourseSettings(interaction.guild.id),
    getCoursePanelVisual(context, interaction.guild.id)
  ]);
  if (!(await canOpenCourseConfig(interaction, settings))) {
    const payload = accessDeniedPanel(settings, interaction.guild);
    if (interaction.isButton()) await interaction.reply(ephemeral(payload));
    else await interaction.reply(ephemeral(payload));
    return;
  }
  const payload = courseConfigPanel(settings, panelVisual);
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
  await interaction.reply(ephemeral(selectCoursePanel("Selecione o curso que deseja publicar.", IDS.publishSelect, courses)));
}

async function startEditCourseFlow(interaction: ButtonInteraction, context: BotContext) {
  const courses = await manageableCourses(interaction, context);
  if (!courses.length) {
    await interaction.reply(ephemeral(accessDeniedPanel(await context.api.getCourseSettings(interaction.guildId!), interaction.guild!)));
    return;
  }
  await interaction.update(selectCoursePanel("Selecione o curso que deseja editar.", IDS.editSelect, courses));
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

async function startCourseStartFlow(interaction: ChatInputCommandInteraction | ButtonInteraction, context: BotContext) {
  const [settings, publications, courses] = await Promise.all([
    context.api.getCourseSettings(interaction.guildId!),
    context.api.listCoursePublications(interaction.guildId!, "open"),
    manageableCourses(interaction, context)
  ]);
  const manageableIds = new Set(courses.map((course) => course.id));
  const allowed = publications.filter((publication) => publication.instructorId === interaction.user.id || manageableIds.has(publication.courseId));
  if (!allowed.length) {
    await interaction.reply(ephemeral(renderComponentsV2Panel({
      accentColor: 0xdc2626,
      description: "Nenhum curso aberto foi encontrado para iniciar com suas permissões atuais.",
      fields: [`Gestores configurados: ${settings.managerUserIds.map((id) => `<@${id}>`).concat(settings.managerRoleIds.map((id) => `<@&${id}>`)).join(", ") || "nenhum"}`],
      moduleId: "courses",
      title: "Iniciar Curso"
    })));
    return;
  }
  if (allowed.length === 1) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const message = await startPublicationById(interaction, context, allowed[0]!.id);
    await interaction.editReply(message);
    return;
  }
  const courseNames = new Map(courses.map((course) => [course.id, `${course.emoji ?? "📚"} ${course.name}`]));
  await interaction.reply(ephemeral(renderComponentsV2Panel({
    accentColor: 0x2563eb,
    actions: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(IDS.startSelect)
          .setPlaceholder("Selecione o curso que será iniciado")
          .addOptions(allowed.slice(0, 25).map((publication) => ({
            label: (courseNames.get(publication.courseId) ?? `Curso ${publication.courseId}`).slice(0, 100),
            value: publication.id,
            description: `${publication.scheduledFor} • ${publication.students.length}/${publication.capacity} inscritos`.slice(0, 100)
          })))
      )
    ],
    description: "Escolha uma publicação aberta para bloquear novas inscrições e marcar o curso como iniciado.",
    moduleId: "courses",
    title: "Iniciar Curso"
  })));
}

async function startCourseProofFlow(interaction: ChatInputCommandInteraction | ButtonInteraction, context: BotContext) {
  const [settings, publications, courses] = await Promise.all([
    context.api.getCourseSettings(interaction.guildId!),
    context.api.listCoursePublications(interaction.guildId!, "started"),
    manageableCourses(interaction, context)
  ]);
  const manageableIds = new Set(courses.map((course) => course.id));
  const allowed = publications.filter((publication) => publication.instructorId === interaction.user.id || manageableIds.has(publication.courseId));
  if (!allowed.length) {
    await interaction.reply(ephemeral(renderComponentsV2Panel({
      accentColor: 0xdc2626,
      description: "Nenhuma aula iniciada foi encontrada para abrir prova com suas permissões atuais.",
      fields: [`Gestores configurados: ${settings.managerUserIds.map((id) => `<@${id}>`).concat(settings.managerRoleIds.map((id) => `<@&${id}>`)).join(", ") || "nenhum"}`],
      moduleId: "courses",
      title: "📝 Iniciar Prova"
    })));
    return;
  }
  if (allowed.length === 1) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const message = await startCourseExamById(interaction, context, allowed[0]!.id);
    await interaction.editReply(message);
    return;
  }
  const courseNames = new Map(courses.map((course) => [course.id, `${course.emoji ?? "📚"} ${course.name}`]));
  await interaction.reply(ephemeral(renderComponentsV2Panel({
    accentColor: 0x16a34a,
    actions: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(IDS.proofSelect)
          .setPlaceholder("Selecione a aula que vai entrar em prova")
          .addOptions(allowed.slice(0, 25).map((publication) => ({
            label: (courseNames.get(publication.courseId) ?? `Curso ${publication.courseId}`).slice(0, 100),
            value: publication.id,
            description: `${publication.scheduledFor} • ${publication.students.length}/${publication.capacity} inscritos`.slice(0, 100)
          })))
      )
    ],
    description: "Escolha uma aula iniciada para criar os canais individuais de prova dos alunos.",
    moduleId: "courses",
    title: "📝 Iniciar Prova"
  })));
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
        inputRow("code", "Código do curso", TextInputStyle.Short, false, 40),
        inputRow("bannerUrl", "Imagem/banner do curso (URL)", TextInputStyle.Short, false, 300),
        inputRow("active", "Status inicial: ativo? Sim/Não", TextInputStyle.Short, true, 3, "Sim")
      ));
    return;
  }
  if (interaction.customId === IDS.editCourse) {
    await startEditCourseFlow(interaction, context);
    return;
  }
  if (interaction.customId.startsWith(`${IDS.editCourseInfo}:`)) {
    const course = await context.api.getCourse(interaction.guildId!, idFromCustomId(interaction.customId));
    await interaction.showModal(courseEditModal(course));
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
  if (interaction.customId === IDS.sync) {
    await openCourseConfig(interaction, context);
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
  if (interaction.customId.startsWith("course_exam_start:")) {
    await startCourseExam(interaction, context, idFromCustomId(interaction.customId));
    return;
  }
  if (interaction.customId.startsWith("course_exam_begin:")) {
    await beginStudentExam(interaction, context);
    return;
  }
  if (interaction.customId.startsWith("course_exam_retry:")) {
    await retryExamQuestion(interaction, context);
    return;
  }
  if (interaction.customId.startsWith("course_exam_next:")) {
    await commitExamAnswer(interaction, context);
    return;
  }
  if (interaction.customId.startsWith("course_exam_written_continue:")) {
    await commitExamAnswer(interaction, context);
    return;
  }
  if (interaction.customId.startsWith("course_exam_finish:")) {
    await finishExam(interaction, context);
    return;
  }
  if (interaction.customId.startsWith("course_exam_review:")) {
    await reviewExam(interaction, context);
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

async function handleStringSelect(interaction: StringSelectMenuInteraction, context: BotContext) {
  const courseId = interaction.values[0] ?? "";
  if (interaction.customId.startsWith("course_exam_answer:")) {
    await selectExamAnswer(interaction, context);
    return;
  }
  if (interaction.customId === IDS.publishSelect) {
    const course = await context.api.getCourse(interaction.guildId!, courseId);
    await showModalAndResetSelect(interaction, publicationModal(course));
    return;
  }
  if (interaction.customId === IDS.editSelect) {
    const course = await context.api.getCourse(interaction.guildId!, courseId);
    await interaction.update(courseEditPanel(course, "Edite os dados, instrutores, cargos e canal deste curso."));
    return;
  }
  if (interaction.customId === IDS.scheduleSelect) {
    await showModalAndResetSelect(interaction, scheduleModal(courseId));
    return;
  }
  if (interaction.customId === IDS.reportSelect) {
    reportDrafts.set(draftKey(interaction), { courseId, students: [] });
    await interaction.update(reportDraftPanel(interaction.user.id, courseId, []));
    return;
  }
  if (interaction.customId === IDS.startSelect) {
    await interaction.deferUpdate();
    void resetSelectMenuMessage(interaction);
    const message = await startPublicationById(interaction, context, courseId);
    await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.customId === IDS.proofSelect) {
    await interaction.deferUpdate();
    void resetSelectMenuMessage(interaction);
    const message = await startCourseExamById(interaction, context, courseId);
    await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
  }
}

async function handleUserSelect(interaction: UserSelectMenuInteraction, context: BotContext) {
  if (interaction.customId.startsWith(`${IDS.courseInstructorUsers}:`)) {
    await handleCourseUserSelect(interaction, context);
    return;
  }
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
    await showModalAndResetSelect(interaction, new ModalBuilder()
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
    return;
  }
  if (interaction.customId === IDS.generalInstructorRoles) {
    const settings = await context.api.saveCourseSettings(interaction.guildId!, { generalInstructorRoleIds: interaction.values }, interaction.user.id);
    await interaction.update(channelsPanel(settings, "Cargos gerais de instrutor atualizados com sucesso."));
    return;
  }
  if (interaction.customId.startsWith(`${IDS.courseInstructorRoles}:`)) {
    const courseId = idFromCustomId(interaction.customId);
    const course = await context.api.updateCourse(interaction.guildId!, courseId, { instructorRoleIds: interaction.values }, interaction.user.id);
    await interaction.update(courseEditPanel(course, "Cargos autorizados atualizados."));
  }
}

async function handleChannelSelect(interaction: ChannelSelectMenuInteraction, context: BotContext) {
  if (interaction.customId.startsWith(`${IDS.coursePublishChannel}:`)) {
    const courseId = idFromCustomId(interaction.customId);
    const course = await context.api.updateCourse(interaction.guildId!, courseId, { publishChannelId: interaction.values[0] ?? null }, interaction.user.id);
    await interaction.update(courseEditPanel(course, "Canal de publicação do curso atualizado."));
    return;
  }
  const patch: Partial<CourseSettings> = {};
  const value = interaction.values[0] ?? null;
  if (interaction.customId === IDS.channelPublish) patch.publishChannelId = value;
  if (interaction.customId === IDS.channelSchedule) patch.scheduleChannelId = value;
  if (interaction.customId === IDS.channelReport) patch.reportChannelId = value;
  if (interaction.customId === IDS.channelLogs) patch.logChannelId = value;
  const settings = await context.api.saveCourseSettings(interaction.guildId!, patch, interaction.user.id);
  await interaction.update(channelsPanel(settings, "Configuração de publicação salva com sucesso."));
  return;
}

async function handleCourseUserSelect(interaction: UserSelectMenuInteraction, context: BotContext) {
  const courseId = idFromCustomId(interaction.customId);
  const course = await context.api.updateCourse(interaction.guildId!, courseId, { instructorUserIds: interaction.values }, interaction.user.id);
  await interaction.update(courseEditPanel(course, "Instrutores responsáveis atualizados."));
}

async function handleModal(interaction: ModalSubmitInteraction, context: BotContext) {
  if (interaction.customId === "course_modal_create") {
    const course = await context.api.createCourse(interaction.guildId!, {
      active: /^s/i.test(interaction.fields.getTextInputValue("active")),
      bannerUrl: interaction.fields.getTextInputValue("bannerUrl") || null,
      code: interaction.fields.getTextInputValue("code") || null,
      description: interaction.fields.getTextInputValue("description") || null,
      name: interaction.fields.getTextInputValue("name")
    }, interaction.user.id);
    await interaction.reply(ephemeral(courseEditPanel(course, "Curso cadastrado com sucesso. Selecione os instrutores e cargos que podem publicar este curso.")));
    return;
  }
  if (interaction.customId.startsWith("course_publish_modal:")) {
    await publishCourse(interaction, context, idFromCustomId(interaction.customId));
    return;
  }
  if (interaction.customId.startsWith("course_edit_modal:")) {
    await editCourseInfo(interaction, context, idFromCustomId(interaction.customId));
    return;
  }
  if (interaction.customId.startsWith("course_schedule_modal:")) {
    await requestSchedule(interaction, context, idFromCustomId(interaction.customId));
    return;
  }
  if (interaction.customId.startsWith("course_report_note:")) {
    await addReportStudent(interaction);
    return;
  }
  if (interaction.customId.startsWith(`${IDS.examApproveModal}:`)) {
    await approveExamWithManualScore(interaction, context);
  }
}

async function publishCourse(interaction: ModalSubmitInteraction, context: BotContext, courseId: string) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const [settings, course] = await Promise.all([
    context.api.getCourseSettings(interaction.guildId!),
    context.api.getCourse(interaction.guildId!, courseId)
  ]);
  const targetChannelId = course.publishChannelId || settings.publishChannelId;
  if (!targetChannelId) {
    await interaction.editReply("Canal padrão de publicação dos cursos não configurado.");
    return;
  }
  const channel = await interaction.guild!.channels.fetch(targetChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) {
    await interaction.editReply("Canal de publicação inválido ou sem permissão de envio.");
    return;
  }
  const date = interaction.fields.getTextInputValue("date").trim();
  const time = interaction.fields.getTextInputValue("time").trim();
  const location = interaction.fields.getTextInputValue("location").trim();
  const capacity = Number(interaction.fields.getTextInputValue("capacity").trim());
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) {
    await interaction.editReply("Informe uma quantidade de vagas válida entre 1 e 500.");
    return;
  }
  if (!date || !time || !location) {
    await interaction.editReply("Informe data, horário e local do curso.");
    return;
  }
  const publication = await context.api.createCoursePublication(interaction.guildId!, {
    capacity,
    channelId: targetChannelId,
    courseId,
    instructorId: interaction.user.id,
    location,
    notes: interaction.fields.getTextInputValue("notes") || null,
    scheduledFor: `${date} ${time}`.trim()
  });
  const message = await (channel as TextChannel).send(coursePublicationPanel(course, publication, settings, interaction.guild!));
  await context.api.updateCoursePublicationMessage(interaction.guildId!, publication.id, message.id);
  await sendCourseLog(interaction, settings, `📚 Curso publicado\nCurso: ${course.name}${course.code ? ` (${course.code})` : ""}\nInstrutor: <@${interaction.user.id}>\nCanal: <#${targetChannelId}>\nHorário: ${publication.scheduledFor}\nLocal: ${publication.location}\nVagas: ${publication.capacity}`);
  await interaction.editReply("Curso publicado com sucesso.");
}

async function editCourseInfo(interaction: ModalSubmitInteraction, context: BotContext, courseId: string) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const maxStudents = Number(interaction.fields.getTextInputValue("maxStudents").trim());
  const name = interaction.fields.getTextInputValue("name").trim();
  if (!name) {
    await interaction.editReply("Informe o nome do curso.");
    return;
  }
  if (!Number.isInteger(maxStudents) || maxStudents < 1 || maxStudents > 500) {
    await interaction.editReply("Informe um limite padrão de vagas entre 1 e 500.");
    return;
  }
  const course = await context.api.updateCourse(interaction.guildId!, courseId, {
    active: !/^n/i.test(interaction.fields.getTextInputValue("active").trim()),
    code: interaction.fields.getTextInputValue("code").trim() || null,
    location: interaction.fields.getTextInputValue("location").trim() || null,
    maxStudents,
    name
  }, interaction.user.id);
  await interaction.editReply("Curso atualizado com sucesso.");
  await interaction.followUp(ephemeral(courseEditPanel(course, "Curso atualizado. Continue ajustando responsáveis, cargos ou canal se precisar."))).catch(() => null);
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
  await sendPublicationLog(interaction, context, result.publication, `✅ Usuário entrou no curso\nUsuário: <@${interaction.user.id}>\nInscritos: ${result.publication.students.length}/${result.publication.capacity}`);
  await interaction.editReply("Você entrou no curso com sucesso.");
}

async function leavePublication(interaction: ButtonInteraction, context: BotContext, publicationId: string) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await context.api.leaveCoursePublication(interaction.guildId!, publicationId, interaction.user.id);
  if (result.error === "not_joined") return interaction.editReply("🚫 Você não está inscrito neste curso.");
  if (!result.publication) return interaction.editReply("Curso não encontrado.");
  await refreshPublicationMessage(interaction, context, result.publication);
  await sendPublicationLog(interaction, context, result.publication, `🚪 Usuário saiu do curso\nUsuário: <@${interaction.user.id}>\nInscritos: ${result.publication.students.length}/${result.publication.capacity}`);
  await interaction.editReply("Você saiu do curso com sucesso.");
}

async function changePublicationStatus(interaction: ButtonInteraction, context: BotContext, publicationId: string, status: "started" | "cancelled") {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const publication = await context.api.getCoursePublication(interaction.guildId!, publicationId);
  const allowed = await canManagePublication(interaction, context, publication);
  if (!allowed) {
    await interaction.editReply("Você não possui permissão para usar este sistema.");
    return;
  }
  const updated = await context.api.setCoursePublicationStatus(interaction.guildId!, publicationId, status, interaction.user.id);
  await refreshPublicationMessage(interaction, context, updated);
  await sendPublicationLog(interaction, context, updated, `${status === "started" ? "▶️ Curso iniciado" : "❌ Curso cancelado"}\nResponsável: <@${interaction.user.id}>\nStatus: ${status}`);
  await interaction.editReply(status === "started" ? "Curso iniciado. Novas entradas foram bloqueadas." : "Curso cancelado.");
}

async function startPublicationById(interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction, context: BotContext, publicationId: string) {
  const publication = await context.api.getCoursePublication(interaction.guildId!, publicationId).catch(() => null);
  if (!publication) return "Publicação de curso não encontrada.";
  if (publication.status !== "open") return "Este curso não está aberto para iniciar.";
  if (!(await canManagePublication(interaction, context, publication))) {
    return "Você não possui permissão para usar este sistema.";
  }
  const updated = await context.api.setCoursePublicationStatus(interaction.guildId!, publicationId, "started", interaction.user.id);
  await refreshPublicationMessageByRecord(interaction, context, updated);
  return "Curso iniciado. Novas entradas foram bloqueadas.";
}

async function startCourseExam(interaction: ButtonInteraction, context: BotContext, publicationId: string) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.editReply(await startCourseExamById(interaction, context, publicationId));
}

async function startCourseExamById(interaction: ButtonInteraction | ChatInputCommandInteraction | StringSelectMenuInteraction, context: BotContext, publicationId: string) {
  const [publication, settings] = await Promise.all([
    context.api.getCoursePublication(interaction.guildId!, publicationId).catch(() => null),
    context.api.getCourseSettings(interaction.guildId!)
  ]);
  if (!publication) {
    return "Publicação de curso não encontrada.";
  }
  if (publication.status !== "started") {
    return "Inicie a aula antes de iniciar a prova.";
  }
  if (!(await canManagePublication(interaction, context, publication))) {
    return "Você não possui permissão para usar este sistema.";
  }
  if (!publication.students.length) {
    return "Não há alunos inscritos para criar canais de prova.";
  }

  const [course, runtime] = await Promise.all([
    context.api.getCourse(interaction.guildId!, publication.courseId),
    context.api.getCourseExamRuntime(interaction.guildId!, publication.courseId)
  ]);
  const proofReady = validateRuntimeProof(runtime.questions);
  if (!runtime.settings.enabled || !proofReady.ok) {
    return proofReady.message;
  }
  const temporaryCategoryId = runtime.settings.temporaryCategoryId || settings.tempProofCategoryId || settings.temporaryCategoryId;
  if (!temporaryCategoryId) {
    return "Configure a categoria dos canais temporários de prova.";
  }
  const proofPublication = await context.api.setCoursePublicationStatus(interaction.guildId!, publicationId, "proof", interaction.user.id);
  await refreshPublicationMessageByRecord(interaction, context, proofPublication);
  const created: string[] = [];
  const reused: string[] = [];
  const failed: string[] = [];

  for (const studentId of publication.students) {
    try {
      const member = await interaction.guild!.members.fetch(studentId).catch(() => null);
      const channelName = examChannelName(member?.displayName ?? studentId, course.name);
      const existing = interaction.guild!.channels.cache.find((channel) => channel.type === ChannelType.GuildText && channel.name === channelName);
      const channel = existing ?? await interaction.guild!.channels.create({
        name: channelName,
        parent: temporaryCategoryId,
        permissionOverwrites: [
          { deny: [PermissionFlagsBits.ViewChannel], id: interaction.guild!.roles.everyone.id },
          { allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory], id: studentId },
          { allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory], id: publication.instructorId },
          ...settings.adminRoleIds.map((id) => ({ allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory], id })),
          ...settings.evaluatorRoleIds.map((id) => ({ allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory], id })),
          { allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels], id: context.client.user!.id }
        ],
        reason: `Prova do curso ${course.name}`
      });
      if (channel.isTextBased() && "send" in channel && !existing) {
        await (channel as TextChannel).send(studentExamWelcomePanel(course, proofPublication, studentId));
      }
      (existing ? reused : created).push(`<#${channel.id}>`);
    } catch (error) {
      failed.push(`<@${studentId}>: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await sendPublicationLog(interaction, context, proofPublication, `📝 Prova iniciada\nCurso: ${course.name}\nInstrutor: <@${interaction.user.id}>\nCanais criados: ${created.length}\nCanais reutilizados: ${reused.length}\nFalhas: ${failed.length}`);
  return [
    `Prova iniciada para ${publication.students.length} aluno(s).`,
    created.length ? `Canais criados:\n${created.join("\n")}` : "",
    reused.length ? `Canais já existentes:\n${reused.join("\n")}` : "",
    failed.length ? `Falhas:\n${failed.join("\n")}` : ""
  ].filter(Boolean).join("\n\n").slice(0, 1900);
}

async function beginStudentExam(interaction: ButtonInteraction, context: BotContext) {
  const [, publicationId, studentId] = interaction.customId.split(":");
  if (!publicationId || !studentId) {
    await interaction.reply({ content: "Painel de prova inválido.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.user.id !== studentId) {
    await interaction.reply({ content: "Somente o aluno deste canal pode iniciar esta prova.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const publication = await context.api.getCoursePublication(interaction.guildId!, publicationId).catch(() => null);
  if (!publication) return interaction.editReply("Publicação de curso não encontrada.");
  const [course, runtime] = await Promise.all([
    context.api.getCourse(interaction.guildId!, publication.courseId),
    context.api.getCourseExamRuntime(interaction.guildId!, publication.courseId)
  ]);
  if (!runtime.settings.enabled) return interaction.editReply("A prova deste curso está desativada na dashboard.");
  if (!runtime.questions.length) return interaction.editReply("A prova deste curso ainda não possui perguntas ativas.");
  const attempt = await context.api.createCourseExamAttempt(interaction.guildId!, {
    channelId: interaction.channelId,
    courseId: publication.courseId,
    instructorId: publication.instructorId,
    publicationId,
    studentId
  });
  await interaction.editReply("Prova iniciada. A primeira pergunta foi enviada no canal.");
  const channel = interaction.channel;
  if (!channel?.isTextBased() || !("send" in channel)) return;
  await channel.send(examIntroPanel(course, runtime.settings)).catch(() => null);
  await sendExamQuestion(interaction.channel as TextChannel, runtime.settings, course, attempt, runtime.questions);
}

export async function handleCourseExamMessage(message: Message, context: BotContext) {
  if (!message.guild || message.author.bot || !message.channel.isTextBased()) return false;
  const attempt = await context.api.getCourseExamAttemptByChannel(message.guild.id, message.channel.id).catch(() => null);
  if (!attempt || attempt.studentId !== message.author.id || attempt.status !== "in_progress") return false;
  const [course, runtime] = await Promise.all([
    context.api.getCourse(message.guild.id, attempt.courseId),
    context.api.getCourseExamRuntime(message.guild.id, attempt.courseId)
  ]);
  const question = runtime.questions[attempt.currentQuestionIndex];
  if (!question || question.type !== "written") return false;
  pendingExamAnswers.set(examPendingKey(attempt.id), { question, writtenAnswer: message.content.trim().slice(0, 3000) });
  if (runtime.settings.deleteWrittenAnswers) await message.delete().catch(() => null);
  if ("send" in message.channel) await message.channel.send(writtenCapturedPanel(course, attempt, question));
  return true;
}

async function selectExamAnswer(interaction: StringSelectMenuInteraction, context: BotContext) {
  const attemptId = idFromCustomId(interaction.customId);
  const bundle = await context.api.getCourseExamAttempt(interaction.guildId!, attemptId).catch(() => null);
  if (!bundle || bundle.attempt.studentId !== interaction.user.id || bundle.attempt.status !== "in_progress") {
    await interaction.reply({ content: "Tentativa de prova inválida.", flags: MessageFlags.Ephemeral });
    return;
  }
  const runtime = await context.api.getCourseExamRuntime(interaction.guildId!, bundle.attempt.courseId);
  const question = runtime.questions[bundle.attempt.currentQuestionIndex];
  if (!question || question.type !== "selection") {
    await interaction.reply({ content: "Pergunta inválida.", flags: MessageFlags.Ephemeral });
    return;
  }
  pendingExamAnswers.set(examPendingKey(attemptId), { question, selectedAlternativeId: interaction.values[0] ?? null });
  await interaction.update(answerConfirmationPanel(question, attemptId, runtime.settings));
}

async function retryExamQuestion(interaction: ButtonInteraction, context: BotContext) {
  await interaction.deferUpdate();
  const attemptId = idFromCustomId(interaction.customId);
  pendingExamAnswers.delete(examPendingKey(attemptId));
  const bundle = await context.api.getCourseExamAttempt(interaction.guildId!, attemptId);
  const [course, runtime] = await Promise.all([
    context.api.getCourse(interaction.guildId!, bundle.attempt.courseId),
    context.api.getCourseExamRuntime(interaction.guildId!, bundle.attempt.courseId)
  ]);
  await interaction.message.edit({ components: [] }).catch(() => null);
  await sendExamQuestion(interaction.channel as TextChannel, runtime.settings, course, bundle.attempt, runtime.questions);
}

async function commitExamAnswer(interaction: ButtonInteraction, context: BotContext) {
  await interaction.deferUpdate();
  const attemptId = idFromCustomId(interaction.customId);
  const pending = pendingExamAnswers.get(examPendingKey(attemptId));
  if (!pending) {
    await interaction.followUp({ content: "Responda a pergunta antes de continuar.", flags: MessageFlags.Ephemeral });
    return;
  }
  const answer = await context.api.saveCourseExamAnswer(interaction.guildId!, attemptId, pending);
  pendingExamAnswers.delete(examPendingKey(attemptId));
  const bundle = await context.api.getCourseExamAttempt(interaction.guildId!, attemptId);
  const [course, runtime] = await Promise.all([
    context.api.getCourse(interaction.guildId!, bundle.attempt.courseId),
    context.api.getCourseExamRuntime(interaction.guildId!, bundle.attempt.courseId)
  ]);
  await interaction.message.edit({ components: [] }).catch(() => null);
  await sendCourseLog(interaction, await context.api.getCourseSettings(interaction.guildId!), `📝 Pergunta respondida\nTentativa: ${attemptId}\nAluno: <@${bundle.attempt.studentId}>\nPergunta: ${pending.question.prompt}\nResposta: ${answer.type === "selection" ? answer.selectedAlternativeId : "discursiva"}`);
  await sendExamQuestion(interaction.channel as TextChannel, runtime.settings, course, bundle.attempt, runtime.questions);
}

async function finishExam(interaction: ButtonInteraction, context: BotContext) {
  await interaction.deferUpdate();
  const attemptId = idFromCustomId(interaction.customId);
  const result = await context.api.finalizeCourseExamAttempt(interaction.guildId!, attemptId);
  const [course, settings] = await Promise.all([
    context.api.getCourse(interaction.guildId!, result.attempt.courseId),
    context.api.getCourseSettings(interaction.guildId!)
  ]);
  await interaction.message.edit({ components: [] }).catch(() => null);
  await interaction.followUp({ content: "Prova finalizada e enviada para correção.", flags: MessageFlags.Ephemeral });
  await sendExamCorrectionPanel(interaction, context, course, result.attempt, result.questions, result.answers);
  await sendCourseLog(interaction, settings, `✅ Prova finalizada\nTentativa: ${attemptId}\nAluno: <@${result.attempt.studentId}>\nNota: ${result.attempt.score}/${result.attempt.maxScore} (${result.attempt.percent}%)`);
}

async function reviewExam(interaction: ButtonInteraction, context: BotContext) {
  const [, , status, attemptId] = interaction.customId.split(":");
  if (!attemptId) {
    await interaction.reply({ content: "Tentativa de prova inválida.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (status === "approved") {
    await interaction.showModal(new ModalBuilder()
      .setCustomId(`${IDS.examApproveModal}:${attemptId}`)
      .setTitle("Nota Manual da Prova")
      .addComponents(inputRow("manualScore", "Nota das questões discursivas", TextInputStyle.Short, true, 8, "0")));
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const reviewed = await completeExamReview(interaction, context, attemptId, "rejected", 0);
  if (reviewed) await interaction.editReply("Prova reprovada e painel atualizado.");
}

async function approveExamWithManualScore(interaction: ModalSubmitInteraction, context: BotContext) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const attemptId = idFromCustomId(interaction.customId);
  const rawScore = interaction.fields.getTextInputValue("manualScore").trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(rawScore)) {
    await interaction.editReply("Informe uma nota numérica válida, como 0, 7 ou 15.");
    return;
  }
  const manualScore = Number(rawScore);
  if (!Number.isFinite(manualScore) || manualScore < 0 || manualScore > 1000) {
    await interaction.editReply("A nota manual deve ficar entre 0 e 1000.");
    return;
  }
  const reviewed = await completeExamReview(interaction, context, attemptId, "approved", manualScore);
  if (reviewed) await interaction.editReply("Prova aprovada, nota final calculada e painel atualizado.");
}

async function completeExamReview(interaction: ButtonInteraction | ModalSubmitInteraction, context: BotContext, attemptId: string, status: "approved" | "rejected", manualScore: number) {
  const bundle = await context.api.getCourseExamAttempt(interaction.guildId!, attemptId);
  if (!(await canReviewExam(interaction, context, bundle.attempt))) {
    await interaction.editReply("Você não tem permissão para corrigir esta prova.");
    return null;
  }
  if (bundle.attempt.result) {
    await interaction.editReply("Esta prova já foi corrigida.");
    return null;
  }
  const reviewed = await context.api.reviewCourseExamAttempt(interaction.guildId!, attemptId, { actorId: interaction.user.id, manualScore, status });
  const [course, runtime, courseSettings] = await Promise.all([
    context.api.getCourse(interaction.guildId!, reviewed.courseId),
    context.api.getCourseExamRuntime(interaction.guildId!, reviewed.courseId),
    context.api.getCourseSettings(interaction.guildId!)
  ]);
  await editExamCorrectionPanel(interaction, context, course, courseSettings, runtime.settings, reviewed, runtime.questions, bundle.answers);
  await sendExamResultPanel(interaction, courseSettings, runtime.settings, course, reviewed);
  const student = await interaction.guild!.members.fetch(reviewed.studentId).catch(() => null);
  await student?.send(status === "approved" ? runtime.settings.approvalMessage : runtime.settings.rejectionMessage).catch(() => null);
  return reviewed;
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
  await refreshPublicationMessageByRecord(interaction, context, publication);
}

async function refreshPublicationMessageByRecord(interaction: { guild: ChatInputCommandInteraction["guild"]; guildId: string | null }, context: BotContext, publication: CoursePublication) {
  const [course, settings] = await Promise.all([
    context.api.getCourse(interaction.guildId!, publication.courseId),
    context.api.getCourseSettings(interaction.guildId!)
  ]);
  const channel = await interaction.guild?.channels.fetch(publication.channelId).catch(() => null);
  if (!channel?.isTextBased() || !("messages" in channel) || !publication.messageId) return;
  const message = await channel.messages.fetch(publication.messageId).catch(() => null);
  await message?.edit(coursePublicationPanel(course, publication, settings, interaction.guild!)).catch(() => null);
}

async function publishPublicCoursesPanel(client: Client, context: BotContext, guildId: string) {
  const [settings, courses, panelVisual] = await Promise.all([
    context.api.getCourseSettings(guildId),
    context.api.getManageableCourses(guildId, { isAdministrator: true, roleIds: [], userId: client.user?.id ?? "00000" }),
    getCoursePanelVisual(context, guildId)
  ]);
  if (!settings.publishChannelId) throw new Error("Course publish channel is not configured.");
  const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
  const channel = await guild?.channels.fetch(settings.publishChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) throw new Error("Course publish channel is invalid or missing send permission.");
  const payload = publicCoursesPanel(settings, courses, panelVisual);
  const message = settings.panelMessageId && "messages" in channel
    ? await channel.messages.fetch(settings.panelMessageId).catch(() => null)
    : null;
  const nextMessage = message
    ? await message.edit(payload)
    : await (channel as TextChannel).send(payload);
  await context.api.updateCoursePanelMessage(guildId, nextMessage.id);
}

async function refreshActiveCoursePublicationPanels(client: Client, context: BotContext) {
  for (const guild of client.guilds.cache.values()) {
    const publications = await Promise.all([
      context.api.listCoursePublications(guild.id, "open").catch(() => []),
      context.api.listCoursePublications(guild.id, "started").catch(() => [])
    ]);
    for (const publication of publications.flat()) {
      await refreshPublicationMessageByRecord({ guild, guildId: guild.id }, context, publication);
    }
  }
}

async function manageableCourses(interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction, context: BotContext) {
  const member = interaction.member as GuildMember | null;
  return context.api.getManageableCourses(interaction.guildId!, {
    isAdministrator: Boolean(member?.permissions.has(PermissionFlagsBits.Administrator)),
    roleIds: member?.roles.cache.map((role) => role.id) ?? [],
    userId: interaction.user.id
  });
}

async function getCoursePanelVisual(context: BotContext, guildId: string): Promise<PanelVisualConfig | null> {
  const visual = await context.api.getPanelVisualSettings(guildId, "courses").catch(() => null);
  if (!visual?.imageEnabled && !visual?.blocks?.length) return null;
  return {
    blocks: visual.blocks ?? [],
    imageEnabled: visual.imageEnabled,
    imagePosition: visual.imagePosition,
    imageUrl: visual.imageUrl
  };
}

async function canOpenCourseConfig(interaction: ChatInputCommandInteraction | ButtonInteraction, settings: CourseSettings) {
  if (!interaction.guild) return false;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  const member = interaction.member as GuildMember | null;
  if (member?.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const roleIds = member?.roles.cache.map((role) => role.id) ?? [];
  return settings.adminUserIds.includes(interaction.user.id)
    || settings.managerUserIds.includes(interaction.user.id)
    || settings.configUserIds.includes(interaction.user.id)
    || settings.adminRoleIds.some((roleId) => roleIds.includes(roleId))
    || settings.managerRoleIds.some((roleId) => roleIds.includes(roleId))
    || settings.configRoleIds.some((roleId) => roleIds.includes(roleId));
}

async function canManagePublication(interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction, context: BotContext, publication: CoursePublication) {
  if (publication.instructorId === interaction.user.id) return true;
  return canManageCourse(interaction, context, publication.courseId);
}

async function canManageCourse(interaction: CourseActionInteraction, context: BotContext, courseId: string) {
  const member = interaction.member as GuildMember | null;
  const courses = await context.api.getManageableCourses(interaction.guildId!, {
    isAdministrator: Boolean(member?.permissions.has(PermissionFlagsBits.Administrator)),
    roleIds: member?.roles.cache.map((role) => role.id) ?? [],
    userId: interaction.user.id
  });
  return courses.some((course) => course.id === courseId);
}

async function canReviewExam(interaction: CourseActionInteraction, context: BotContext, attempt: CourseExamAttempt) {
  if (!interaction.guild) return false;
  if (attempt.instructorId === interaction.user.id) return true;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  const settings = await context.api.getCourseSettings(interaction.guildId!);
  const member = interaction.member as GuildMember | null;
  if (member?.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const roleIds = member?.roles.cache.map((role) => role.id) ?? [];
  return settings.evaluatorUserIds.includes(interaction.user.id)
    || settings.adminUserIds.includes(interaction.user.id)
    || settings.managerUserIds.includes(interaction.user.id)
    || settings.evaluatorRoleIds.some((roleId) => roleIds.includes(roleId))
    || settings.adminRoleIds.some((roleId) => roleIds.includes(roleId))
    || settings.managerRoleIds.some((roleId) => roleIds.includes(roleId))
    || await canManageCourse(interaction, context, attempt.courseId);
}

function courseConfigPanel(settings: CourseSettings, panelVisual: PanelVisualConfig | null = null) {
  return renderComponentsV2Panel({
    accentColor: 0x2563eb,
    actions: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(IDS.addCourse).setLabel("➕ Cadastrar Curso").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(IDS.editCourse).setLabel("✏️ Editar Curso").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(IDS.channels).setLabel("📡 Canais").setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(IDS.sync).setLabel("📝 Provas").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(IDS.managers).setLabel("🛡️ Administradores").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(IDS.close).setLabel("✖️ Fechar").setStyle(ButtonStyle.Danger)
      )
    ],
    description: "Central de operação dos cursos. Configure canais, gestores, publicações e provas sem sair do Discord.",
    fields: [
      `Publicação: ${settings.publishChannelId ? `<#${settings.publishChannelId}>` : "não configurado"}`,
      `Logs de prova: ${settings.proofLogChannelId ? `<#${settings.proofLogChannelId}>` : "não configurado"}`,
      `Avaliação: ${settings.evaluationChannelId ? `<#${settings.evaluationChannelId}>` : "não configurado"}`,
      `Resultados: ${settings.resultChannelId ? `<#${settings.resultChannelId}>` : "não configurado"}`
    ],
    image: panelVisual,
    moduleId: "courses",
    title: "🎓 Sistema de Cursos"
  });
}

function publicCoursesPanel(settings: CourseSettings, courses: Course[], panelVisual: PanelVisualConfig | null = null) {
  const activeCourses = courses.filter((course) => course.active);
  return renderComponentsV2Panel({
    accentColor: 0x2563eb,
    actions: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(IDS.publicPublish).setLabel("📣 Publicar Curso").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(IDS.publicSchedule).setLabel("🗓️ Solicitar Horário").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(IDS.publicReport).setLabel("📊 Lançar Relatório").setStyle(ButtonStyle.Success)
      )
    ],
    description: "Painel de trabalho dos instrutores. Publique cursos, solicite horários e registre relatórios de aplicação em um só lugar.",
    fields: [
      `**Cursos ativos:** ${activeCourses.length}`,
      activeCourses.slice(0, 12).map((course) => `${course.emoji ?? "📚"} ${course.name}`).join("\n") || "Nenhum curso ativo cadastrado."
    ],
    image: panelVisual || resolveCourseImage(settings, "module") || (settings.globalBannerUrl ? { imageEnabled: true, imagePosition: "top", imageUrl: settings.globalBannerUrl } : null),
    moduleId: "courses",
    title: "🎓 Sistema de Cursos"
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
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(new RoleSelectMenuBuilder().setCustomId(IDS.generalInstructorRoles).setPlaceholder("Cargo geral dos instrutores").setMinValues(0).setMaxValues(10)),
      new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(IDS.back).setLabel("Voltar").setStyle(ButtonStyle.Secondary))
    ],
    description: "Defina onde os cursos serão publicados, agendados, registrados e auditados.",
    fields: [
      message ? `**${message}**` : "",
      `Publicação: ${settings.publishChannelId ? `<#${settings.publishChannelId}>` : "não configurado"}`,
      `Agendamentos: ${settings.scheduleLogChannelId ? `<#${settings.scheduleLogChannelId}>` : "não configurado"}`,
      `Provas: ${settings.proofLogChannelId ? `<#${settings.proofLogChannelId}>` : "não configurado"}`,
      `Avaliação: ${settings.evaluationChannelId ? `<#${settings.evaluationChannelId}>` : "não configurado"}`,
      `Resultados: ${settings.resultChannelId ? `<#${settings.resultChannelId}>` : "não configurado"}`,
      `Logs: ${settings.adminLogChannelId ? `<#${settings.adminLogChannelId}>` : "não configurado"}`,
      `Cargos gerais de instrutor: ${settings.generalInstructorRoleIds.map((id) => `<@&${id}>`).join(", ") || "nenhum"}`
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

function courseEditPanel(course: Course, message: string) {
  const channelSelect = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(`${IDS.coursePublishChannel}:${course.id}`)
      .setPlaceholder("Canal de publicação específico do curso")
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(0)
      .setMaxValues(1)
  );
  return renderComponentsV2Panel({
    accentColor: parseColor(course.color),
    actions: [
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder().setCustomId(`${IDS.courseInstructorUsers}:${course.id}`).setPlaceholder("Selecione instrutores responsáveis").setMinValues(0).setMaxValues(10)),
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(new RoleSelectMenuBuilder().setCustomId(`${IDS.courseInstructorRoles}:${course.id}`).setPlaceholder("Selecione cargos autorizados").setMinValues(0).setMaxValues(10)),
      channelSelect,
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${IDS.editCourseInfo}:${course.id}`).setLabel("✏️ Editar dados").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(IDS.back).setLabel("Voltar").setStyle(ButtonStyle.Secondary)
      )
    ],
    description: "Edite os dados do curso e configure quem pode publicar. Usuários específicos e cargos autorizados funcionam ao mesmo tempo.",
    fields: [
      `**${message}**`,
      `Curso: ${course.emoji ?? "🎓"} ${course.name}${course.code ? `\nCódigo: ${course.code}` : ""}`,
      `Local padrão: ${course.location ?? "não configurado"}\nLimite padrão: ${course.maxStudents ?? 30} vaga(s)\nStatus: ${course.active ? "ativo" : "inativo"}`,
      `Instrutores: ${course.instructorUserIds.map((id) => `<@${id}>`).join(", ") || "nenhum"}`,
      `Cargos autorizados: ${course.instructorRoleIds.map((id) => `<@&${id}>`).join(", ") || "nenhum"}`,
      `Cargo geral de instrutor: ${course.allowGeneralInstructorRoles ? "liberado" : "bloqueado"}`,
      `Canal próprio: ${course.publishChannelId ? `<#${course.publishChannelId}>` : "usa o canal padrão"}`
    ],
    image: course.bannerUrl ? { imageEnabled: true, imagePosition: "top", imageUrl: course.bannerUrl } : null,
    moduleId: "courses",
    title: "✏️ Editar Curso"
  });
}

function accessDeniedPanel(settings: CourseSettings, guild: { roles: { cache: Map<string, unknown> } }) {
  const managers = [
    ...settings.adminUserIds.map((id) => `<@${id}>`),
    ...settings.configUserIds.map((id) => `<@${id}>`),
    ...settings.adminRoleIds.map((id) => `<@&${id}>`),
    ...settings.configRoleIds.map((id) => `<@&${id}>`)
  ].join(", ") || "nenhum gestor configurado";
  return renderComponentsV2Panel({
    accentColor: 0xdc2626,
    description: "Você não possui permissão para usar este sistema.",
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
  const full = publication.students.length >= publication.capacity;
  const statusText = coursePublicationStatusLabel(publication, full);
  const statusNotice = coursePublicationStatusNotice(course, settings, publication, full);
  const canJoin = publication.status === "open" && !full;
  const canLeave = publication.status === "open" || publication.status === "started";
  const canStartClass = publication.status === "open";
  const canStartExam = publication.status === "started";
  const canCancel = !["cancelled", "proof", "finished", "closed"].includes(publication.status);
  const primaryAction = canStartExam
    ? new ButtonBuilder().setCustomId(`course_exam_start:${publication.id}`).setLabel("📝 Iniciar Prova").setStyle(ButtonStyle.Success)
    : new ButtonBuilder().setCustomId(`course_start:${publication.id}`).setLabel(`${settings.buttonEmojis.start ?? "▶️"} Iniciar Aula`).setStyle(ButtonStyle.Primary).setDisabled(!canStartClass);
  return renderComponentsV2Panel({
    accentColor: parseColor(course.color),
    actions: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`course_join:${publication.id}`).setLabel(`${settings.buttonEmojis.enter ?? "✅"} ${course.buttonLabels.enter || "Entrar no Curso"}`).setStyle(ButtonStyle.Success).setDisabled(!canJoin),
        new ButtonBuilder().setCustomId(`course_leave:${publication.id}`).setLabel(`${settings.buttonEmojis.leave ?? "🚪"} ${course.buttonLabels.leave || "Sair do Curso"}`).setStyle(ButtonStyle.Secondary).setDisabled(!canLeave)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        primaryAction,
        new ButtonBuilder().setCustomId(`course_cancel:${publication.id}`).setLabel(`${settings.buttonEmojis.cancel ?? "❌"} ${course.buttonLabels.cancel || "Cancelar Curso"}`).setStyle(ButtonStyle.Danger).setDisabled(!canCancel)
      )
    ],
    description: course.publishText || course.description || "Curso disponível para inscrição. Acompanhe o status, entre na lista e aguarde o instrutor iniciar a aula.",
    fields: [
      [
        `**Instrutor:** <@${publication.instructorId}>`,
        `**Local:** ${publication.location}`,
        `**Horário:** ${publication.scheduledFor}`,
        `**Vagas:** ${publication.students.length}/${publication.capacity}`,
        `**Status:** ${statusText}`
      ].join("\n"),
      publication.notes ? `**Observações:** ${publication.notes}` : "",
      statusNotice,
      `**Alunos inscritos:**\n${students}`,
      publication.status === "cancelled" ? `**Cancelamento:**\nResponsável: ${publication.cancelledBy ? `<@${publication.cancelledBy}>` : "-"}\nData: ${publication.cancelledAt ? new Date(publication.cancelledAt).toLocaleString("pt-BR") : "-"}` : ""
    ].filter(Boolean),
    image: course.bannerUrl ? { imageEnabled: true, imagePosition: course.imagePosition === "side" ? "side" : course.imagePosition === "footer" ? "footer" : course.imagePosition, imageUrl: course.bannerUrl } : null,
    moduleId: "courses",
    title: `${coursePublicationStatusEmoji(publication, full)} ${publication.status === "cancelled" ? "Curso Cancelado" : course.name}`
  });
}

function studentExamWelcomePanel(course: Course, publication: CoursePublication, studentId: string) {
  return renderComponentsV2Panel({
    accentColor: parseColor(course.color),
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`course_exam_begin:${publication.id}:${studentId}`).setLabel("📝 Iniciar Prova").setStyle(ButtonStyle.Success)
    )],
    description: course.proofInstructionText || "Sua prova foi liberada em um canal individual. Leia as instruções com atenção e clique em Iniciar Prova somente quando estiver pronto.",
    fields: [
      `**Curso:** ${course.name}`,
      `**Aluno:** <@${studentId}>`,
      `**Instrutor:** <@${publication.instructorId}>`
    ],
    image: (course.proofBannerUrl || course.bannerUrl) ? { imageEnabled: true, imagePosition: "top", imageUrl: course.proofBannerUrl || course.bannerUrl! } : null,
    moduleId: "courses",
    title: "📝 Prova do Curso"
  });
}

function coursePublicationStatusLabel(publication: CoursePublication, full: boolean) {
  if (publication.status === "open" && full) return "🟠 Lotado";
  const labels: Record<CoursePublication["status"], string> = {
    cancelled: "🔴 Cancelado",
    closed: "✅ Encerrado",
    finished: "✅ Finalizado",
    open: "🟢 Inscrições abertas",
    proof: "📝 Prova em andamento",
    started: "🔵 Aula iniciada"
  };
  return labels[publication.status];
}

function coursePublicationStatusEmoji(publication: CoursePublication, full: boolean) {
  if (publication.status === "open" && full) return "🟠";
  const emojis: Record<CoursePublication["status"], string> = {
    cancelled: "🔴",
    closed: "✅",
    finished: "✅",
    open: "📚",
    proof: "📝",
    started: "🔵"
  };
  return emojis[publication.status];
}

function coursePublicationStatusNotice(course: Course, settings: CourseSettings, publication: CoursePublication, full: boolean) {
  if (publication.status === "open" && full) return "🟠 **Turma lotada.** Aguarde uma vaga abrir ou uma nova publicação do curso.";
  if (publication.status === "open") return "🟢 **Inscrições abertas.** Clique em Entrar no Curso para participar.";
  if (publication.status === "started") return course.startedText || settings.startedMessage || "🔵 **Aula iniciada.** Novas inscrições foram bloqueadas. O instrutor pode iniciar a prova quando estiver pronto.";
  if (publication.status === "proof") return "📝 **Prova em andamento.** Canais individuais foram criados para os alunos.";
  if (publication.status === "cancelled") return course.cancelledText || settings.cancelledMessage || "🔴 **Curso cancelado.** Esta publicação não aceita novas ações.";
  return "✅ **Curso finalizado.** Esta publicação foi encerrada.";
}

function examIntroPanel(course: Course, settings: CourseExamSettings) {
  return renderComponentsV2Panel({
    accentColor: parseColor(course.color),
    description: settings.initialMessage,
    fields: [`Curso: ${course.name}`],
    image: (course.proofBannerUrl || course.bannerUrl) ? { imageEnabled: true, imagePosition: "top", imageUrl: course.proofBannerUrl || course.bannerUrl! } : null,
    moduleId: "courses",
    title: "Início da Prova"
  });
}

async function sendExamQuestion(channel: TextChannel, settings: CourseExamSettings, course: Course, attempt: CourseExamAttempt, questions: CourseExamQuestion[]) {
  const question = questions[attempt.currentQuestionIndex];
  if (!question) {
    await channel.send(examFinishPanel(course, settings, attempt));
    return;
  }
  if (question.type === "selection") {
    await channel.send(selectionQuestionPanel(course, attempt, question, attempt.currentQuestionIndex + 1, questions.length));
    return;
  }
  await channel.send(writtenQuestionPanel(course, attempt, question, attempt.currentQuestionIndex + 1, questions.length));
}

function selectionQuestionPanel(course: Course, attempt: CourseExamAttempt, question: CourseExamQuestion, index: number, total: number) {
  return renderComponentsV2Panel({
    accentColor: parseColor(course.color),
    actions: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`course_exam_answer:${attempt.id}`)
          .setPlaceholder("Marque uma alternativa")
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(question.alternatives.slice(0, 5).map((alternative) => ({
            label: `Alternativa ${alternative.id}`.slice(0, 100),
            value: alternative.id,
            description: alternative.text.slice(0, 100)
          })))
      )
    ],
    description: question.description || "Selecione uma alternativa para continuar.",
    fields: [
      `Pergunta ${index}/${total}\nValor: ${question.points}`,
      `**${question.prompt}**`,
      question.alternatives.map((alternative) => `○ ${alternative.text}`).join("\n")
    ],
    moduleId: "courses",
    title: "Questão Objetiva"
  });
}

function writtenQuestionPanel(course: Course, attempt: CourseExamAttempt, question: CourseExamQuestion, index: number, total: number) {
  return renderComponentsV2Panel({
    accentColor: parseColor(course.color),
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`course_exam_written_continue:${attempt.id}`).setLabel("Continuar").setStyle(ButtonStyle.Success)
    )],
    description: "Clique em Continuar após enviar sua resposta em texto neste canal. Em ambientes com suporte a modal, a pergunta final pode ser migrada para modal sem alterar o banco.",
    fields: [
      `Pergunta ${index}/${total}\nValor: ${question.points}`,
      `**${question.prompt}**`,
      question.description || question.placeholder || "Envie sua resposta em uma mensagem abaixo."
    ],
    moduleId: "courses",
    title: "Questão Discursiva"
  });
}

function writtenCapturedPanel(course: Course, attempt: CourseExamAttempt, question: CourseExamQuestion) {
  return renderComponentsV2Panel({
    accentColor: parseColor(course.color),
    actions: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`course_exam_retry:${attempt.id}`).setLabel("Responder Novamente").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`course_exam_next:${attempt.id}`).setLabel("Próxima Pergunta").setStyle(ButtonStyle.Success)
      )
    ],
    description: "Resposta escrita capturada. Escolha uma opção.",
    fields: [`Pergunta: ${question.prompt}`],
    moduleId: "courses",
    title: "Pergunta respondida"
  });
}

function answerConfirmationPanel(question: CourseExamQuestion, attemptId: string, settings: CourseExamSettings) {
  return renderComponentsV2Panel({
    accentColor: 0x2563eb,
    actions: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`course_exam_retry:${attemptId}`).setLabel("Responder Novamente").setStyle(ButtonStyle.Secondary).setDisabled(!settings.allowCurrentQuestionReview),
        new ButtonBuilder().setCustomId(`course_exam_next:${attemptId}`).setLabel("Próxima Pergunta").setStyle(ButtonStyle.Success)
      )
    ],
    description: "Pergunta respondida. Escolha uma opção.",
    fields: [`Pergunta: ${question.prompt}`],
    moduleId: "courses",
    title: "Confirmação da Resposta"
  });
}

function examFinishPanel(course: Course, settings: CourseExamSettings, attempt: CourseExamAttempt) {
  return renderComponentsV2Panel({
    accentColor: parseColor(course.color),
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`course_exam_finish:${attempt.id}`).setLabel("Finalizar Prova").setStyle(ButtonStyle.Success)
    )],
    description: settings.finalMessage,
    fields: [`Curso: ${course.name}`, `Aluno: <@${attempt.studentId}>`],
    moduleId: "courses",
    title: "Prova concluída"
  });
}

async function sendExamCorrectionPanel(interaction: ButtonInteraction, context: BotContext, course: Course, attempt: CourseExamAttempt, questions: CourseExamQuestion[], answers: CourseExamAnswer[]) {
  const runtime = await context.api.getCourseExamRuntime(interaction.guildId!, attempt.courseId);
  const courseSettings = await context.api.getCourseSettings(interaction.guildId!);
  const channel = await fetchTextChannel(interaction, examCorrectionChannelId(courseSettings, runtime.settings));
  if (!channel) return;
  const message = await channel.send(examCorrectionPanel(course, courseSettings, attempt, questions, answers));
  await context.api.setCourseExamCorrectionMessage(interaction.guildId!, attempt.id, message.id).catch(() => null);
}

async function editExamCorrectionPanel(interaction: ButtonInteraction | ModalSubmitInteraction, context: BotContext, course: Course, courseSettings: CourseSettings, examSettings: CourseExamSettings, attempt: CourseExamAttempt, questions: CourseExamQuestion[], answers: CourseExamAnswer[]) {
  const payload = examCorrectionPanel(course, courseSettings, attempt, questions, answers);
  const sourceMessage = "message" in interaction ? interaction.message : null;
  if (sourceMessage?.editable) {
    await sourceMessage.edit(payload).catch(() => null);
    return;
  }
  if (!attempt.correctionMessageId) return;
  const channel = await fetchTextChannel(interaction, examCorrectionChannelId(courseSettings, examSettings));
  const message = await channel?.messages.fetch(attempt.correctionMessageId).catch(() => null);
  await message?.edit(payload).catch(() => null);
}

async function sendExamResultPanel(interaction: ButtonInteraction | ModalSubmitInteraction, courseSettings: CourseSettings, examSettings: CourseExamSettings, course: Course, attempt: CourseExamAttempt) {
  const channel = await fetchTextChannel(interaction, examSettings.resultChannelId || courseSettings.resultChannelId);
  if (!channel) return;
  const correctedAt = attempt.correctedAt ? Math.floor(new Date(attempt.correctedAt).getTime() / 1000) : Math.floor(Date.now() / 1000);
  await channel.send(renderComponentsV2Panel({
    accentColor: parseColor(course.color),
    description: `${courseSettings.resultMentionRoleId ? `<@&${courseSettings.resultMentionRoleId}>\n` : ""}Resultado final da prova corrigida.`,
    fields: [
      [
        `Nome do aluno: <@${attempt.studentId}>`,
        `Curso: ${course.name}`,
        `Nota automática: ${formatScore(attempt.automaticScore ?? attempt.score)}`,
        `Nota manual: ${formatScore(attempt.manualScore ?? 0)}`,
        `Nota final: ${formatScore(attempt.finalScore ?? attempt.score)}`,
        `Status: ${examReviewStatusLabel(attempt)}`,
        `Avaliador: ${attempt.correctedBy ? `<@${attempt.correctedBy}>` : `<@${interaction.user.id}>`}`,
        `Data da correção: <t:${correctedAt}:F>`
      ].join("\n")
    ],
    moduleId: "courses",
    title: "Resultado de Prova"
  })).catch(() => null);
}

function examCorrectionPanel(course: Course, courseSettings: CourseSettings, attempt: CourseExamAttempt, questions: CourseExamQuestion[], answers: CourseExamAnswer[]) {
  const answerByQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
  const reviewed = attempt.result === "approved" || attempt.result === "rejected";
  const objectiveTotal = questions.filter((question) => question.type === "selection").length;
  const writtenTotal = questions.filter((question) => question.type === "written").length;
  const finalScore = attempt.finalScore ?? attempt.automaticScore ?? attempt.score;
  const fields = [
    [
      `Aluno: <@${attempt.studentId}>`,
      `Curso: ${course.name}`,
      `Instrutor: <@${attempt.instructorId}>`,
      `Início: <t:${Math.floor(new Date(attempt.startedAt).getTime() / 1000)}:F>`,
      `Fim: ${attempt.finishedAt ? `<t:${Math.floor(new Date(attempt.finishedAt).getTime() / 1000)}:F>` : "-"}`,
      `Tempo gasto: ${formatExamDuration(attempt.startedAt, attempt.finishedAt)}`,
      `Nota automática: ${formatScore(attempt.automaticScore ?? attempt.score)}`,
      `Nota manual: ${attempt.manualScore === null || attempt.manualScore === undefined ? "Aguardando Correção" : formatScore(attempt.manualScore)}`,
      `Nota final: ${formatScore(finalScore)}`,
      `Status: ${examReviewStatusLabel(attempt)}`,
      `Questões objetivas: ${attempt.objectiveCorrect} corretas / ${attempt.objectiveWrong} erradas (${objectiveTotal} total)`,
      `Questões discursivas: ${attempt.writtenCount || writtenTotal}`
    ].join("\n"),
    ...questions.slice(0, 12).map((question, index) => {
      const answer = answerByQuestion.get(question.id);
      if (question.type === "selection") {
        const marked = answer?.selectedAlternativeId ?? "-";
        return `${index + 1}. ${question.prompt}\nMarcada: ${marked}\nCorreta: ${question.correctAlternativeId ?? "-"}\nResultado: ${answer?.correct ? "✅ Correta" : "❌ Errada"}\nPontos: ${answer?.pointsEarned ?? 0}/${question.points}`;
      }
      return `${index + 1}. ${question.prompt}\nResposta:\n${answer?.writtenAnswer?.slice(0, 700) || "-"}\nCorreção: manual`;
    })
  ];
  return renderComponentsV2Panel({
    accentColor: parseColor(course.color),
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`course_exam_review:approved:${attempt.id}`).setLabel("✅ Aprovar").setStyle(ButtonStyle.Success).setDisabled(reviewed),
      new ButtonBuilder().setCustomId(`course_exam_review:rejected:${attempt.id}`).setLabel("❌ Reprovar").setStyle(ButtonStyle.Danger).setDisabled(reviewed)
    )],
    description: `${courseSettings.evaluatorMentionRoleId ? `<@&${courseSettings.evaluatorMentionRoleId}>\n` : ""}Painel de avaliação manual da prova.`,
    fields,
    moduleId: "courses",
    title: "Correção de Prova"
  });
}

function examCorrectionChannelId(courseSettings: CourseSettings, examSettings: CourseExamSettings) {
  return examSettings.correctionChannelId || courseSettings.evaluationChannelId || examSettings.logChannelId || courseSettings.reportChannelId;
}

async function fetchTextChannel(interaction: ButtonInteraction | ModalSubmitInteraction, channelId: string | null | undefined) {
  if (!channelId || !interaction.guild) return null;
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) return null;
  return channel as TextChannel;
}

function examReviewStatusLabel(attempt: CourseExamAttempt) {
  if (attempt.result === "approved" || attempt.status === "approved") return "✅ Aprovado";
  if (attempt.result === "rejected" || attempt.status === "rejected") return "❌ Reprovado";
  return "Aguardando Correção";
}

function formatScore(value: number | null | undefined) {
  const score = Number(value ?? 0);
  return Number.isInteger(score) ? String(score) : score.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function formatExamDuration(startedAt: string, finishedAt: string | null) {
  if (!finishedAt) return "-";
  const seconds = Math.max(0, Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
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

async function sendPublicationLog(interaction: { guild: ChatInputCommandInteraction["guild"]; guildId: string | null }, context: BotContext, publication: CoursePublication, content: string) {
  const settings = await context.api.getCourseSettings(interaction.guildId!);
  await sendCourseLog(interaction, settings, `${content}\nPublicação: ${publication.id}\nCanal: <#${publication.channelId}>`);
}

async function sendCourseLog(interaction: { guild: ChatInputCommandInteraction["guild"] }, settings: CourseSettings, content: string) {
  const channelId = settings.proofLogChannelId || settings.adminLogChannelId || settings.logChannelId;
  if (!channelId) return;
  const channel = await interaction.guild?.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) return;
  await (channel as TextChannel).send(renderComponentsV2Panel({
    accentColor: 0x2563eb,
    description: content,
    fields: [`Data: ${new Date().toLocaleString("pt-BR")}`],
    moduleId: "courses",
    title: "🧾 Log do Sistema de Cursos"
  })).catch(() => null);
}

function publicationModal(course: Course) {
  return new ModalBuilder()
    .setCustomId(`course_publish_modal:${course.id}`)
    .setTitle("Publicar Curso")
    .addComponents(
      inputRow("date", "Data do curso", TextInputStyle.Short, true, 40),
      inputRow("time", "Horário do curso", TextInputStyle.Short, true, 40),
      inputRow("location", "Local do curso", TextInputStyle.Short, true, 120, course.location ?? ""),
      inputRow("capacity", "Quantidade de pessoas/vagas", TextInputStyle.Short, true, 4, String(course.maxStudents ?? 30)),
      inputRow("notes", "Observações", TextInputStyle.Paragraph, false, 900)
    );
}

function courseEditModal(course: Course) {
  return new ModalBuilder()
    .setCustomId(`course_edit_modal:${course.id}`)
    .setTitle("Editar Curso")
    .addComponents(
      inputRow("name", "Nome do curso", TextInputStyle.Short, true, 120, course.name),
      inputRow("code", "Código/número", TextInputStyle.Short, false, 40, course.code ?? ""),
      inputRow("location", "Local padrão do curso", TextInputStyle.Short, false, 120, course.location ?? ""),
      inputRow("maxStudents", "Limite padrão de vagas", TextInputStyle.Short, true, 4, String(course.maxStudents ?? 30)),
      inputRow("active", "Curso ativo? Sim/Não", TextInputStyle.Short, true, 3, course.active ? "Sim" : "Não")
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

function examChannelName(studentName: string, courseName: string) {
  return `prova-${slugPart(studentName)}-${slugPart(courseName)}`.slice(0, 100);
}

function validateRuntimeProof(questions: CourseExamQuestion[]) {
  const ordered = [...questions].sort((a, b) => (a.questionNumber ?? a.order + 1) - (b.questionNumber ?? b.order + 1));
  if (ordered.length !== 9) return { ok: false, message: "A prova só pode ser iniciada com exatamente 9 perguntas configuradas." };
  for (let index = 0; index < 8; index += 1) {
    const question = ordered[index];
    if (!question || question.type !== "selection") return { ok: false, message: `A pergunta ${index + 1} precisa ser objetiva.` };
    if (question.alternatives.length < 2) return { ok: false, message: `A pergunta ${index + 1} precisa ter pelo menos 2 alternativas.` };
    if (!question.points || question.points <= 0) return { ok: false, message: `A pergunta ${index + 1} precisa ter nota máxima configurada.` };
  }
  const finalQuestion = ordered[8];
  if (!finalQuestion || finalQuestion.type !== "written" || !finalQuestion.prompt.trim()) {
    return { ok: false, message: "A pergunta 9 precisa ser discursiva e ter texto configurado." };
  }
  return { ok: true, message: "Prova completa." };
}

function resolveCourseImage(settings: CourseSettings, type: string) {
  const image = settings.images.find((item) => item.type === type && item.active && item.default) ?? settings.images.find((item) => item.type === type && item.active);
  return image ? { imageEnabled: true, imagePosition: "top" as const, imageUrl: image.url } : null;
}

function slugPart(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "aluno";
}

function ephemeral<T extends Record<string, unknown>>(payload: T) {
  return { ...payload, flags: Number(payload.flags ?? 0) | MessageFlags.Ephemeral };
}

function draftKey(interaction: { guildId: string | null; user: { id: string } }) {
  return `${interaction.guildId}:${interaction.user.id}`;
}

function examPendingKey(attemptId: string) {
  return `exam:${attemptId}`;
}

function parseColor(value: string | null | undefined) {
  const parsed = Number.parseInt((value ?? "").replace("#", ""), 16);
  return Number.isFinite(parsed) ? parsed : 0x2563eb;
}

function idFromCustomId(customId: string) {
  return customId.split(":")[1] ?? "";
}

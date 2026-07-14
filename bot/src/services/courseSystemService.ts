import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits,
  PermissionsBitField,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type Interaction,
  type Message,
  type ModalSubmitInteraction,
  type PermissionResolvable,
  type StringSelectMenuInteraction,
  type TextChannel,
  type UserSelectMenuInteraction,
  type RoleSelectMenuInteraction,
  type ChannelSelectMenuInteraction
} from "discord.js";
import type { BotCommand, BotContext } from "../types";
import { currentRuntimeBotId, env } from "../config/env";
import { showModalAndResetSelect } from "../utils/selectMenuReset";
import { componentsV2Payload, renderComponentsV2Panel, resolvePanelImageUrl, type PanelVisualConfig } from "./panelVisualRenderer";
import type { Course, CourseDepartment, CourseEnrollment, CourseExamAnswer, CourseExamAttempt, CourseExamQuestion, CourseExamSettings, CoursePublication, CourseSettings } from "./apiClient";
import { replaceSystemEmojis, systemComponentEmoji, systemEmojiText, systemStatusEmoji } from "./systemEmojiService";

type CourseActionInteraction = ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;
type CourseGuildContext = { guild: Guild | null; guildId: string | null };

const IDS = {
  addCourse: "course_config_add",
  back: "course_config_back",
  channels: "course_config_channels",
  close: "course_config_close",
  managers: "course_config_managers",
  departments: "course_config_departments",
  departmentAdd: "course_department_add",
  departmentBack: "course_department_back",
  departmentDeleteCancel: "course_department_delete_cancel",
  departmentSelect: "course_department_select",
  departmentCreateModal: "course_department_create_modal",
  departmentEditModal: "course_department_edit_modal",
  publicationDepartmentSelect: "course_publication_department_select",
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
  channelEvaluation: "course_channel_evaluation",
  channelProofLogs: "course_channel_proof_logs",
  channelResult: "course_channel_result",
  channelTempProofCategory: "course_channel_temp_proof_category",
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

const DEACTIVATED_COURSE_PANEL_MESSAGE = "Este painel foi desativado. Utilize o novo sistema de cursos.";
const COURSE_EXAM_CHANNEL_TOPIC_PREFIX = "nex-tech-course-exam";
const DEFAULT_EXAM_CHANNEL_EXPIRATION_HOURS = 24;
const MAX_EXAM_CHANNEL_TIMER_DELAY = 7 * 24 * 60 * 60 * 1000;
const EXAM_CHANNEL_ACTIVE_RECHECK_DELAY = 15 * 60 * 1000;
const EXAM_CHANNEL_DELETE_RETRY_DELAY = 5 * 60 * 1000;
const EXAM_CHANNEL_STATE_RETRY_MAX_DELAY = 60 * 60 * 1000;
const COURSE_EVENT_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_COURSE_EVENT_TIMER_DELAY = 7 * 24 * 60 * 60 * 1000;
const MAX_COURSE_EVENT_LOCATION_LENGTH = 100;
const MAX_EXAM_SELECT_OPTIONS = 25;
const EXAM_TOTAL_SCORE = 10;
const MAX_QUESTION_SCORE = 1;

const startedCourseClients = new WeakSet<Client>();
const examProvisioning = new Map<string, Promise<string>>();
const studentExamStarting = new Map<string, Promise<unknown>>();
const examChannelDeletionTimers = new Map<string, NodeJS.Timeout>();
const examChannelDeletionGenerations = new Map<string, symbol>();
const examChannelStateRetryTimers = new Map<string, NodeJS.Timeout>();
const courseEventLifecycleTimers = new Map<string, { end?: NodeJS.Timeout; start?: NodeJS.Timeout }>();
const courseEventLifecycleGenerations = new Map<string, symbol>();
const pendingExamSelections = new Map<string, string[]>();

export function startCourseSystemService(client: Client, context: BotContext) {
  if (startedCourseClients.has(client)) return;
  startedCourseClients.add(client);
  context.socket.onCoursePanelPublish((payload) => {
    const runtimeBotId = (currentRuntimeBotId() ?? env.DASHBOARD_BOT_ID) || null;
    if (payload.botId && runtimeBotId && payload.botId !== runtimeBotId) return;
    void publishPublicCoursesPanel(client, context, payload.guildId).catch((error) => {
      console.error(`[courses] failed to publish panel in ${payload.guildId}:`, error instanceof Error ? error.message : error);
    });
  });
  context.socket.onCourseExamReviewed((payload) => {
    void publishDashboardReviewedExamResult(client, context, payload).catch((error) => {
      console.error(`[courses] failed to publish dashboard exam review ${payload.attemptId}:`, error instanceof Error ? error.message : error);
    });
  });
  client.on("channelDelete", (channel) => {
    if (channel.type !== ChannelType.GuildText) return;
    const marker = parseCourseExamChannelTopic(channel.topic);
    if (!marker) return;
    void context.api.expireCourseEnrollmentChannel(channel.guild.id, channel.id)
      .then(async () => {
        const publication = await context.api.getCoursePublication(channel.guild.id, marker.publicationId).catch(() => null);
        if (publication) await refreshPublicationMessageByRecord({ guild: channel.guild, guildId: channel.guild.id }, context, publication);
      })
      .catch((error) => {
        console.error(`[courses] failed to persist removed exam channel ${channel.id}:`, error instanceof Error ? error.message : error);
      });
  });
  const restoreRuntimeState = () => {
    void restoreTemporaryExamChannelCleanup(client, context).catch((error) => {
      console.error("[courses] failed to restore temporary exam channel cleanup:", error instanceof Error ? error.message : error);
    });
  };
  if (client.isReady()) restoreRuntimeState();
  else client.once("ready", restoreRuntimeState);
}

export const courseCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("curso")
    .setDescription("Gerencia cursos.")
    .addSubcommand((subcommand) => subcommand.setName("config").setDescription("Abre a configuração do Sistema de Cursos."))
    .addSubcommand((subcommand) => subcommand.setName("agendamento").setDescription("Agenda um curso cadastrado e cria o evento no Discord.")),
  moduleId: "courses",
  async execute(interaction, context) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "config") {
      await openCourseConfig(interaction, context);
      return;
    }
    if (subcommand === "agendamento") {
      await startPublishFlow(interaction, context, IDS.scheduleSelect);
    }
  }
};

export const publicarCursoCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("publicar")
    .setDescription("Publica painéis.")
    .addSubcommand((subcommand) => subcommand.setName("curso").setDescription("Seleciona e publica um curso cadastrado.")),
  moduleId: "courses",
  async execute(interaction, context) {
    if (interaction.options.getSubcommand() !== "curso") return;
    await startPublishFlow(interaction, context);
  }
};

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

async function startPublishFlow(interaction: ChatInputCommandInteraction | ButtonInteraction, context: BotContext, selectId: string = IDS.publishSelect) {
  const courses = await manageableCourses(interaction, context);
  if (!courses.length) {
    await interaction.reply(ephemeral(accessDeniedPanel(await context.api.getCourseSettings(interaction.guildId!), interaction.guild!)));
    return;
  }
  await interaction.reply(ephemeral(selectCoursePanel(selectId === IDS.scheduleSelect ? "Selecione o curso que deseja agendar." : "Selecione o curso que deseja publicar.", selectId, courses)));
}

async function startEditCourseFlow(interaction: ButtonInteraction, context: BotContext) {
  const courses = await manageableCourses(interaction, context);
  if (!courses.length) {
    await interaction.reply(ephemeral(accessDeniedPanel(await context.api.getCourseSettings(interaction.guildId!), interaction.guild!)));
    return;
  }
  await interaction.update(selectCoursePanel("Selecione o curso que deseja editar.", IDS.editSelect, courses));
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
  if (interaction.customId === IDS.departments) {
    if (!(await canOpenCourseConfig(interaction, await context.api.getCourseSettings(interaction.guildId!)))) {
      await interaction.reply(ephemeral(accessDeniedPanel(await context.api.getCourseSettings(interaction.guildId!), interaction.guild!)));
      return;
    }
    await interaction.update(departmentsPanel(await context.api.listCourseDepartments(interaction.guildId!)));
    return;
  }
  if (interaction.customId === IDS.departmentAdd) {
    if (!(await canOpenCourseConfig(interaction, await context.api.getCourseSettings(interaction.guildId!)))) {
      await interaction.reply(ephemeral(accessDeniedPanel(await context.api.getCourseSettings(interaction.guildId!), interaction.guild!)));
      return;
    }
    await interaction.showModal(new ModalBuilder()
      .setCustomId(IDS.departmentCreateModal)
      .setTitle("Cadastrar DP")
      .addComponents(inputRow("name", "Nome da DP", TextInputStyle.Short, true, 80)));
    return;
  }
  if (interaction.customId === IDS.departmentBack || interaction.customId === IDS.departmentDeleteCancel) {
    await interaction.update(departmentsPanel(await context.api.listCourseDepartments(interaction.guildId!)));
    return;
  }
  if (interaction.customId.startsWith("course_department_edit:")) {
    if (!(await canOpenCourseConfig(interaction, await context.api.getCourseSettings(interaction.guildId!)))) {
      await interaction.reply(ephemeral(accessDeniedPanel(await context.api.getCourseSettings(interaction.guildId!), interaction.guild!)));
      return;
    }
    const departmentId = idFromCustomId(interaction.customId);
    const department = (await context.api.listCourseDepartments(interaction.guildId!)).find((item) => item.id === departmentId);
    if (!department) {
      await interaction.reply(ephemeralText("DP não encontrada."));
      return;
    }
    await interaction.showModal(new ModalBuilder()
      .setCustomId(`${IDS.departmentEditModal}:${department.id}`)
      .setTitle("Editar DP")
      .addComponents(inputRow("name", "Nome da DP", TextInputStyle.Short, true, 80, department.name)));
    return;
  }
  if (interaction.customId.startsWith("course_department_toggle:")) {
    if (!(await canOpenCourseConfig(interaction, await context.api.getCourseSettings(interaction.guildId!)))) {
      await interaction.reply(ephemeral(accessDeniedPanel(await context.api.getCourseSettings(interaction.guildId!), interaction.guild!)));
      return;
    }
    const departmentId = idFromCustomId(interaction.customId);
    const department = (await context.api.listCourseDepartments(interaction.guildId!)).find((item) => item.id === departmentId);
    if (!department) {
      await interaction.reply(ephemeralText("DP não encontrada."));
      return;
    }
    await context.api.updateCourseDepartment(interaction.guildId!, department.id, { active: !department.active }, interaction.user.id);
    await interaction.update(departmentsPanel(await context.api.listCourseDepartments(interaction.guildId!), `DP ${department.active ? "desativada" : "ativada"} com sucesso.`));
    return;
  }
  if (interaction.customId.startsWith("course_department_delete_confirm:")) {
    if (!(await canOpenCourseConfig(interaction, await context.api.getCourseSettings(interaction.guildId!)))) {
      await interaction.reply(ephemeral(accessDeniedPanel(await context.api.getCourseSettings(interaction.guildId!), interaction.guild!)));
      return;
    }
    const result = await context.api.deleteCourseDepartment(interaction.guildId!, idFromCustomId(interaction.customId), interaction.user.id);
    await interaction.update(departmentsPanel(await context.api.listCourseDepartments(interaction.guildId!), result.deleted ? "DP excluída com sucesso." : "DP possui cursos vinculados e foi desativada para preservar o histórico."));
    return;
  }
  if (interaction.customId.startsWith("course_department_delete:")) {
    if (!(await canOpenCourseConfig(interaction, await context.api.getCourseSettings(interaction.guildId!)))) {
      await interaction.reply(ephemeral(accessDeniedPanel(await context.api.getCourseSettings(interaction.guildId!), interaction.guild!)));
      return;
    }
    const departmentId = idFromCustomId(interaction.customId);
    const department = (await context.api.listCourseDepartments(interaction.guildId!)).find((item) => item.id === departmentId);
    if (!department) {
      await interaction.reply(ephemeralText("DP não encontrada."));
      return;
    }
    await interaction.update(departmentDeleteConfirmationPanel(department));
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
    await startPublishFlow(interaction, context, IDS.scheduleSelect);
    return;
  }
  if (interaction.customId === IDS.publicReport) {
    await replyDeactivatedPanel(interaction);
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
  if (interaction.customId.startsWith("course_finish:")) {
    await changePublicationStatus(interaction, context, idFromCustomId(interaction.customId), "finished");
    return;
  }
  if (interaction.customId.startsWith("course_exam_realize:") || interaction.customId.startsWith("course_exam_start:")) {
    await realizeCourseExam(interaction, context, idFromCustomId(interaction.customId));
    return;
  }
  if (interaction.customId.startsWith("course_exam_begin:")) {
    await beginStudentExam(interaction, context);
    return;
  }
  if (interaction.customId.startsWith("course_exam_ident_name:")) {
    await showIdentificationNameModal(interaction);
    return;
  }
  if (interaction.customId.startsWith("course_exam_ident_id:")) {
    await showIdentificationIdModal(interaction);
    return;
  }
  if (interaction.customId.startsWith("course_exam_ident_confirm:")) {
    await confirmExamIdentification(interaction, context);
    return;
  }
  if (interaction.customId.startsWith("course_exam_ident_correct:")) {
    await resetExamIdentificationPanel(interaction, context);
    return;
  }
  if (interaction.customId.startsWith("course_exam_ident_cancel:")) {
    await cancelExamIdentification(interaction, context);
    return;
  }
  if (interaction.customId.startsWith("course_exam_confirm_answer:")) {
    await confirmExamAnswer(interaction, context);
    return;
  }
  if (interaction.customId.startsWith("course_exam_retry:")) {
    await retryExamQuestion(interaction, context);
    return;
  }
  if (interaction.customId.startsWith("course_exam_next:")) {
    await replyDeactivatedPanel(interaction);
    return;
  }
  if (interaction.customId.startsWith("course_exam_written_continue:")) {
    await replyDeactivatedPanel(interaction);
    return;
  }
  if (interaction.customId.startsWith("course_exam_written:")) {
    await showWrittenAnswerModal(interaction, context);
    return;
  }
  if (interaction.customId.startsWith("course_exam_finish:")) {
    await finishExam(interaction, context);
    return;
  }
  if (interaction.customId.startsWith("course_exam_result_answers:")) {
    await showExamResultAnswers(interaction, context);
    return;
  }
  if (interaction.customId.startsWith("course_exam_result_details:")) {
    await showExamResultDetails(interaction, context);
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
    await replyDeactivatedPanel(interaction);
    return;
  }
  if (interaction.customId === IDS.reportAdd) {
    await replyDeactivatedPanel(interaction);
    return;
  }
  if (interaction.customId === IDS.reportLaunch) {
    await replyDeactivatedPanel(interaction);
    return;
  }
  if (interaction.customId === IDS.reportCancel) {
    await replyDeactivatedPanel(interaction);
  }
}

async function handleStringSelect(interaction: StringSelectMenuInteraction, context: BotContext) {
  const courseId = interaction.values[0] ?? "";
  if (interaction.customId.startsWith("course_exam_answer:")) {
    await selectExamAnswer(interaction, context);
    return;
  }
  if (interaction.customId.startsWith("course_exam_ident_rank:")) {
    await selectIdentificationRank(interaction, context);
    return;
  }
  if (interaction.customId === IDS.publishSelect) {
    const course = await context.api.getCourse(interaction.guildId!, courseId);
    await showPublicationModal(interaction, context, course);
    return;
  }
  if (interaction.customId === IDS.editSelect) {
    const course = await context.api.getCourse(interaction.guildId!, courseId);
    await interaction.update(courseEditPanel(course, "Edite os dados, instrutores, cargos e canal deste curso."));
    return;
  }
  if (interaction.customId === IDS.scheduleSelect) {
    const course = await context.api.getCourse(interaction.guildId!, courseId);
    await showPublicationModal(interaction, context, course, "agendamento");
    return;
  }
  if (interaction.customId === IDS.departmentSelect) {
    const departmentId = interaction.values[0] ?? null;
    await interaction.update(departmentsPanel(await context.api.listCourseDepartments(interaction.guildId!), undefined, departmentId));
    return;
  }
  if (interaction.customId === IDS.reportSelect) {
    await replyDeactivatedPanel(interaction);
    return;
  }
  if (interaction.customId === IDS.startSelect) {
    await replyDeactivatedPanel(interaction);
    return;
  }
  if (interaction.customId === IDS.proofSelect) {
    await replyDeactivatedPanel(interaction);
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
    await replyDeactivatedPanel(interaction);
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
    await replyDeactivatedPanel(interaction);
    return;
  }
  if (interaction.customId === IDS.channelSchedule || interaction.customId === IDS.channelReport) {
    await replyDeactivatedPanel(interaction);
    return;
  }
  const patch: Partial<CourseSettings> = {};
  const value = interaction.values[0] ?? null;
  if (interaction.customId === IDS.channelPublish) patch.publishChannelId = value;
  if (interaction.customId === IDS.channelSchedule) patch.scheduleChannelId = value;
  if (interaction.customId === IDS.channelReport) patch.reportChannelId = value;
  if (interaction.customId === IDS.channelLogs) patch.logChannelId = value;
  if (interaction.customId === IDS.channelEvaluation) patch.evaluationChannelId = value;
  if (interaction.customId === IDS.channelProofLogs) patch.proofLogChannelId = value;
  if (interaction.customId === IDS.channelResult) patch.resultChannelId = value;
  if (interaction.customId === IDS.channelTempProofCategory) patch.tempProofCategoryId = value;
  const settings = await context.api.saveCourseSettings(interaction.guildId!, patch, interaction.user.id);
  await interaction.update(channelsPanel(settings, "Configuração de canais salva com sucesso."));
  return;
}

async function handleCourseUserSelect(interaction: UserSelectMenuInteraction, context: BotContext) {
  const courseId = idFromCustomId(interaction.customId);
  const course = await context.api.updateCourse(interaction.guildId!, courseId, { instructorUserIds: interaction.values }, interaction.user.id);
  await interaction.update(courseEditPanel(course, "Instrutores responsáveis atualizados."));
}

async function handleModal(interaction: ModalSubmitInteraction, context: BotContext) {
  if (interaction.customId === IDS.departmentCreateModal) {
    await saveDepartmentFromModal(interaction, context, "create");
    return;
  }
  if (interaction.customId.startsWith(`${IDS.departmentEditModal}:`)) {
    await saveDepartmentFromModal(interaction, context, "edit", idFromCustomId(interaction.customId));
    return;
  }
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
    await replyDeactivatedPanel(interaction);
    return;
  }
  if (interaction.customId.startsWith("course_report_note:")) {
    await replyDeactivatedPanel(interaction);
    return;
  }
  if (interaction.customId.startsWith("course_exam_written_modal:")) {
    await submitWrittenAnswer(interaction, context);
    return;
  }
  if (interaction.customId.startsWith("course_exam_ident_name_modal:")) {
    await submitIdentificationName(interaction, context);
    return;
  }
  if (interaction.customId.startsWith("course_exam_ident_id_modal:")) {
    await submitIdentificationId(interaction, context);
    return;
  }
  if (interaction.customId.startsWith(`${IDS.examApproveModal}:`)) {
    await approveExamWithManualScore(interaction, context);
  }
}

async function saveDepartmentFromModal(interaction: ModalSubmitInteraction, context: BotContext, mode: "create" | "edit", departmentId?: string) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const settings = await context.api.getCourseSettings(interaction.guildId!);
  if (!(await canOpenCourseConfig(interaction, settings))) {
    await interaction.editReply("Você não possui permissão para gerenciar DPs.");
    return;
  }
  const name = interaction.fields.getTextInputValue("name").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 80) {
    await interaction.editReply("O nome da DP deve ter entre 2 e 80 caracteres.");
    return;
  }
  try {
    if (mode === "create") await context.api.createCourseDepartment(interaction.guildId!, name, interaction.user.id);
    else if (departmentId) await context.api.updateCourseDepartment(interaction.guildId!, departmentId, { name }, interaction.user.id);
  } catch (error) {
    await interaction.editReply(courseDepartmentApiErrorMessage(error));
    return;
  }
  await interaction.editReply(mode === "create" ? "DP cadastrada com sucesso." : "DP atualizada com sucesso.");
}

async function showPublicationModal(interaction: StringSelectMenuInteraction, context: BotContext, course: Course, mode: "publicacao" | "agendamento" = "publicacao") {
  const departments = await context.api.listCourseDepartments(interaction.guildId!, true).catch((error) => {
    console.error(`[courses] failed to load departments for modal guild=${interaction.guildId} user=${interaction.user.id}:`, error instanceof Error ? error.stack ?? error.message : error);
    return [];
  });
  if (!departments.length) {
    await interaction.reply(ephemeralText("Nenhuma DP ativa cadastrada. Cadastre uma DP na configuração de cursos antes de agendar."));
    return;
  }
  if (departments.length > 25) {
    await interaction.reply(ephemeralText("Existem mais de 25 DPs ativas. O select do Discord em modal suporta no máximo 25 opções; desative ou remova DPs antigas antes de agendar."));
    return;
  }
  await showModalAndResetSelect(interaction, publicationModal(course, departments, mode));
}

async function publishCourse(interaction: ModalSubmitInteraction, context: BotContext, courseId: string) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const [settings, course] = await Promise.all([
    context.api.getCourseSettings(interaction.guildId!),
    context.api.getCourse(interaction.guildId!, courseId)
  ]);
  const targetChannelId = settings.publishChannelId;
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
  const departmentId = selectedModalStringValue(interaction, IDS.publicationDepartmentSelect);
  const capacity = Number(interaction.fields.getTextInputValue("capacity").trim());
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000000) {
    await interaction.editReply("Informe uma quantidade de vagas válida.");
    return;
  }
  if (!date || !time || !departmentId) {
    await interaction.editReply("Informe data, horário e DP do curso.");
    return;
  }
  const department = (await context.api.listCourseDepartments(interaction.guildId!, true).catch((error) => {
    console.error(`[courses] failed to validate selected DP guild=${interaction.guildId} user=${interaction.user.id} dpId=${departmentId}:`, error instanceof Error ? error.stack ?? error.message : error);
    return [];
  })).find((item) => item.id === departmentId);
  if (!department) {
    await interaction.editReply("A DP selecionada não existe mais, está desativada ou pertence a outro servidor. Abra o modal novamente e selecione uma DP ativa.");
    return;
  }
  const scheduleWindow = parseCourseScheduleWindow(date, time);
  if (!scheduleWindow) {
    await interaction.editReply("Informe data e horário válidos. Use data DD/MM e horário HH:mm.");
    return;
  }
  if (scheduleWindow.startAt.getTime() <= Date.now()) {
    await interaction.editReply("A data do curso não pode estar no passado.");
    return;
  }
  const previousOpen = (await context.api.listCoursePublications(interaction.guildId!, "open").catch(() => []))
    .find((item) => item.courseId === courseId) ?? null;
  const publication = await context.api.createCoursePublication(interaction.guildId!, {
    capacity,
    channelId: targetChannelId,
    courseId,
    discordEventType: "EXTERNAL",
    dpId: department.id,
    dpNameSnapshot: department.name,
    instructorId: interaction.user.id,
    legacyLocation: null,
    location: department.name,
    notes: interaction.fields.getTextInputValue("notes") || null,
    scheduledEndAt: scheduleWindow.endAt.toISOString(),
    scheduledFor: `${scheduleWindow.displayDate} ${time}`.trim(),
    scheduledStartAt: scheduleWindow.startAt.toISOString()
  });
  let publicationWithEvent = publication;
  try {
    publicationWithEvent = await createOrUpdateCourseScheduledEvent(interaction.guild!, context, course, publication);
  } catch (error) {
    const errorMessage = scheduledEventErrorMessage(error);
    logCourseFlowError("scheduled_event_create", error, {
      courseId: course.id,
      guildId: interaction.guildId,
      publicationId: publication.id,
      scheduledEndAt: publication.scheduledEndAt,
      scheduledStartAt: publication.scheduledStartAt
    });
    await context.api.updateCoursePublicationEvent(interaction.guildId!, publication.id, { discordEventId: null, discordEventUrl: null, syncError: errorMessage }).catch(() => null);
    await sendCourseLog(interaction, settings, `Falha ao criar evento do Discord\nCurso: ${course.name}\nPublicação: ${publication.id}\nErro: ${errorMessage}`).catch(() => null);
    await interaction.editReply("❌ Não foi possível concluir a publicação do curso. O evento do Discord não foi criado; verifique os logs.");
    return;
  }
  let existingMessage = publication.messageId && "messages" in channel
    ? await channel.messages.fetch(publication.messageId).catch(() => null)
    : null;
  if (!existingMessage && previousOpen?.messageId && previousOpen.channelId !== targetChannelId) {
    const oldChannel = await interaction.guild!.channels.fetch(previousOpen.channelId).catch(() => null);
    if (oldChannel?.isTextBased() && "messages" in oldChannel) {
      const oldMessage = await oldChannel.messages.fetch(previousOpen.messageId).catch(() => null);
      await oldMessage?.delete().catch(() => null);
    }
  } else if (!existingMessage && previousOpen?.messageId && previousOpen.channelId === targetChannelId && "messages" in channel) {
    existingMessage = await channel.messages.fetch(previousOpen.messageId).catch(() => null);
  }
  const message = existingMessage
    ? await existingMessage.edit(coursePublicationPanel(course, publicationWithEvent, settings, interaction.guild!))
    : await (channel as TextChannel).send(coursePublicationPanel(course, publicationWithEvent, settings, interaction.guild!));
  const publicationWithPanel = await context.api.updateCoursePublicationMessage(interaction.guildId!, publication.id, message.id);
  await sendCourseLog(interaction, settings, `Curso agendado\nCurso: ${course.name}${course.code ? ` (${course.code})` : ""}\nInstrutor: <@${interaction.user.id}>\nCanal: <#${targetChannelId}>\nPainel: ${message.id}\nHorário: ${publicationWithPanel.scheduledFor}\nDP: ${publicationWithPanel.dpNameSnapshot ?? publicationWithPanel.location}\nVagas: ${publicationWithPanel.capacity}\nEvento do Discord: criado`);
  await interaction.editReply("✅ Curso agendado, painel publicado e evento criado com sucesso.");
}

async function editCourseInfo(interaction: ModalSubmitInteraction, context: BotContext, courseId: string) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const maxStudents = Number(interaction.fields.getTextInputValue("maxStudents").trim());
  const name = interaction.fields.getTextInputValue("name").trim();
  if (!name) {
    await interaction.editReply("Informe o nome do curso.");
    return;
  }
  if (!Number.isInteger(maxStudents) || maxStudents < 1 || maxStudents > 1000000) {
    await interaction.editReply("Informe um limite padrão de vagas válido.");
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

async function joinPublication(interaction: ButtonInteraction, context: BotContext, publicationId: string) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const member = interaction.member && "displayName" in interaction.member ? interaction.member as GuildMember : null;
  const studentName = member?.displayName || interaction.user.displayName || interaction.user.username;
  const result = await context.api.joinCoursePublication(interaction.guildId!, publicationId, interaction.user.id, studentName);
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
  if (result.error === "closed") return interaction.editReply("Este curso não está aberto para saída.");
  if (!result.publication) return interaction.editReply("Curso não encontrado.");
  await refreshPublicationMessage(interaction, context, result.publication);
  await sendPublicationLog(interaction, context, result.publication, `🚪 Usuário saiu do curso\nUsuário: <@${interaction.user.id}>\nInscritos: ${result.publication.students.length}/${result.publication.capacity}`);
  await interaction.editReply("Você saiu do curso com sucesso.");
}

async function changePublicationStatus(interaction: ButtonInteraction, context: BotContext, publicationId: string, status: "started" | "cancelled" | "finished") {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const publication = await context.api.getCoursePublication(interaction.guildId!, publicationId);
  const allowed = status === "started"
    ? publication.instructorId === interaction.user.id
    : await canManagePublication(interaction, context, publication);
  if (!allowed) {
    await interaction.editReply(status === "started" ? "Somente o instrutor que criou esta turma pode iniciar o curso." : "Você não possui permissão para usar este sistema.");
    return;
  }
  const updated = await context.api.setCoursePublicationStatus(interaction.guildId!, publicationId, status, interaction.user.id).catch(() => null);
  if (!updated) {
    await interaction.editReply("Esta ação já foi executada ou o curso mudou de estado.");
    return;
  }
  const course = await context.api.getCourse(interaction.guildId!, updated.courseId).catch(() => null);
  if (course) await syncCourseScheduledEventStatus(interaction.guild!, course, updated).then(async () => {
    if (updated.discordEventId) {
      await context.api.updateCoursePublicationEvent(interaction.guildId!, updated.id, { discordEventId: updated.discordEventId, discordEventUrl: updated.discordEventUrl, syncError: null }).catch(() => null);
    }
  }).catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    await context.api.updateCoursePublicationEvent(interaction.guildId!, updated.id, { discordEventId: updated.discordEventId, discordEventUrl: updated.discordEventUrl, syncError: message }).catch(() => null);
    await sendPublicationLog(interaction, context, updated, `⚠️ Falha ao sincronizar evento do Discord\nResponsável: <@${interaction.user.id}>\nStatus do curso: ${status}\nEvento: ${updated.discordEventId ?? "não vinculado"}\nErro: ${message}`).catch(() => null);
  });
  await refreshPublicationMessage(interaction, context, updated);
  if (status === "finished") {
    await lockFinishedCourseChannel(interaction, context, updated).catch(async (error) => {
      await sendPublicationLog(interaction, context, updated, `⚠️ Falha ao bloquear canal após finalização\nResponsável: <@${interaction.user.id}>\nErro: ${error instanceof Error ? error.message : String(error)}`).catch(() => null);
    });
  }
  const logTitle = status === "started" ? "▶️ Curso iniciado" : status === "finished" ? "✅ Curso finalizado" : "❌ Curso cancelado";
  await sendPublicationLog(interaction, context, updated, `${logTitle}\nResponsável: <@${interaction.user.id}>\nInscritos: ${updated.students.length}\nStatus: ${status}${status === "finished" ? `\nDuração: ${formatCourseDuration(updated.startedAt, updated.finishedAt)}` : ""}`);
  await interaction.editReply(status === "started" ? "Curso iniciado. A opção Realizar prova foi liberada aos alunos inscritos." : status === "finished" ? "Curso finalizado. O painel foi bloqueado e o evento foi encerrado." : "Curso cancelado.");
}

async function lockFinishedCourseChannel(interaction: ButtonInteraction, context: BotContext, publication: CoursePublication) {
  const channel = await interaction.guild?.channels.fetch(publication.channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return;
  const me = interaction.guild?.members.me ?? await interaction.guild?.members.fetchMe().catch(() => null);
  const permissions = me ? channel.permissionsFor(me) : null;
  if (!permissions?.has(PermissionFlagsBits.ManageChannels)) {
    await sendPublicationLog(interaction, context, publication, `⚠️ Canal não bloqueado após finalização\nCanal: <#${channel.id}>\nMotivo: o bot não possui permissão Gerenciar Canais.`);
    return;
  }
  await channel.permissionOverwrites.edit(interaction.guild!.roles.everyone.id, {
    SendMessages: false,
    SendMessagesInThreads: false
  }, { reason: `Curso finalizado: ${publication.id}` });
}

function parseCourseScheduleWindow(dateInput: string, timeInput: string) {
  const date = dateInput.trim();
  const time = timeInput.trim();
  const dateMatch = /^(\d{2})\/(\d{2})$/.exec(date);
  if (!dateMatch) return null;
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!timeMatch) return null;

  const day = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (!Number.isInteger(day) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  const year = new Date().getFullYear();
  const maxDay = new Date(year, month, 0).getDate();
  if (day < 1 || day > maxDay) return null;

  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  const yyyy = String(year);
  const hh = (timeMatch[1] ?? "").padStart(2, "0");
  const min = timeMatch[2] ?? "";
  const startAt = new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:00-03:00`);
  if (Number.isNaN(startAt.getTime())) return null;
  return {
    displayDate: `${dd}/${mm}/${yyyy}`,
    endAt: new Date(startAt.getTime() + COURSE_EVENT_DURATION_MS),
    startAt
  };
}

async function createOrUpdateCourseScheduledEvent(guild: Guild, context: BotContext, course: Course, publication: CoursePublication) {
  if (!publication.scheduledStartAt || !publication.scheduledEndAt) return publication;
  const startAt = new Date(publication.scheduledStartAt);
  const endAt = new Date(publication.scheduledEndAt);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    throw new Error("Data do evento inválida.");
  }
  if (startAt.getTime() <= Date.now()) {
    throw new Error("A data do evento precisa estar no futuro.");
  }
  if (endAt.getTime() <= startAt.getTime()) {
    throw new Error("A data final do evento precisa ser maior que a data inicial.");
  }
  await assertCourseScheduledEventPermissions(guild);
  const payload = {
    description: courseScheduledEventDescription(course, publication, "📅 Agendado"),
    entityMetadata: { location: coursePublicationDepartmentLabel(publication).slice(0, MAX_COURSE_EVENT_LOCATION_LENGTH) },
    entityType: GuildScheduledEventEntityType.External,
    name: `📅 Curso agendado - ${course.name}`.slice(0, 100),
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    reason: `Agendamento automático do curso ${course.id}`,
    scheduledEndTime: endAt,
    scheduledStartTime: startAt
  };
  let eventId = publication.discordEventId;
  if (eventId) {
    const existingEvent = await guild.scheduledEvents.fetch(eventId).catch(() => null);
    if (existingEvent) {
      const editedEvent = await existingEvent.edit({
        description: payload.description,
        entityMetadata: payload.entityMetadata,
        name: payload.name,
        reason: `Atualização automática do curso ${course.id}`,
        scheduledEndTime: payload.scheduledEndTime,
        scheduledStartTime: payload.scheduledStartTime
      });
      eventId = editedEvent.id;
      await assertCourseScheduledEventExists(guild, eventId, publication.id);
    } else {
      eventId = null;
    }
  }
  if (!eventId) {
    const event = await guild.scheduledEvents.create(course.bannerUrl ? { ...payload, image: course.bannerUrl } : payload).catch(async (error) => {
      if (!course.bannerUrl) throw error;
      console.warn(`[courses] failed to create scheduled event with banner for publication ${publication.id}; retrying without image:`, error instanceof Error ? error.message : error);
      return guild.scheduledEvents.create(payload);
    });
    eventId = event.id;
    await assertCourseScheduledEventExists(guild, eventId, publication.id);
  }
  const updated = await context.api.updateCoursePublicationEvent(guild.id, publication.id, {
    discordEventId: eventId,
    discordEventUrl: scheduledEventUrl(guild.id, eventId),
    syncError: null
  });
  if (updated) scheduleCourseEventLifecycle(guild, context, updated, course);
  return updated;
}

async function assertCourseScheduledEventExists(guild: Guild, eventId: string, publicationId: string) {
  const fetched = await guild.scheduledEvents.fetch(eventId).catch(() => null);
  if (!fetched) {
    throw new Error(`Evento do Discord ${eventId} não ficou acessível após a criação da publicação ${publicationId}.`);
  }
  console.info(`[courses:scheduled_event_ready]`, {
    eventId: fetched.id,
    guildId: guild.id,
    publicationId,
    scheduledStartAt: fetched.scheduledStartAt?.toISOString() ?? null,
    status: fetched.status
  });
}

async function assertCourseScheduledEventPermissions(guild: Guild) {
  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  const permissions = me?.permissions;
  if (!permissions) throw new Error("Não foi possível validar as permissões do bot para criar eventos.");
  if (permissions.has(PermissionFlagsBits.Administrator)) return;
  const canCreate = permissions.has(PermissionFlagsBits.CreateEvents);
  const canManage = permissions.has(PermissionFlagsBits.ManageEvents);
  if (!canCreate) {
    throw new Error(`O bot não possui a permissão Criar Eventos no servidor. Permissões atuais: ${permissions.toArray().join(", ") || "nenhuma"}.`);
  }
  if (!canManage) {
    console.warn(`[courses] bot can create scheduled events in guild ${guild.id}, but does not have ManageEvents; updates to events not created by this bot may fail.`);
  }
}

async function syncCourseScheduledEventStatus(guild: Guild, course: Course, publication: CoursePublication) {
  if (!publication.discordEventId) return;
  const event = await guild.scheduledEvents.fetch(publication.discordEventId).catch(() => null);
  if (!event) throw new Error("Evento agendado não encontrado no Discord.");
  if (publication.status === "started") {
    await event.edit({
      description: courseScheduledEventDescription(course, publication, "🟢 Curso Iniciado"),
      name: `🟢 Curso iniciado - ${course.name}`.slice(0, 100),
      status: event.status === GuildScheduledEventStatus.Scheduled ? GuildScheduledEventStatus.Active : undefined
    });
  } else if (publication.status === "finished" || publication.status === "closed") {
    let currentEvent = event;
    if (currentEvent.status === GuildScheduledEventStatus.Scheduled) {
      currentEvent = await currentEvent.edit({ status: GuildScheduledEventStatus.Active }).catch(() => currentEvent);
    }
    await currentEvent.edit({
      description: courseScheduledEventDescription(course, publication, "✅ Curso Finalizado"),
      name: `✅ Curso finalizado - ${course.name}`.slice(0, 100),
      status: currentEvent.status === GuildScheduledEventStatus.Completed ? undefined : GuildScheduledEventStatus.Completed
    });
    clearCourseEventLifecycle(publication.id);
  } else if (publication.status === "cancelled") {
    const terminalStatus = event.status === GuildScheduledEventStatus.Active
      ? GuildScheduledEventStatus.Completed
      : event.status === GuildScheduledEventStatus.Canceled
        ? undefined
        : GuildScheduledEventStatus.Canceled;
    await event.edit({
      description: courseScheduledEventDescription(course, publication, "Cancelado"),
      name: `Curso cancelado - ${course.name}`.slice(0, 100),
      status: terminalStatus
    });
    clearCourseEventLifecycle(publication.id);
  }
}

function scheduleCourseEventLifecycle(guild: Guild, context: BotContext, publication: CoursePublication, course?: Course | null) {
  clearCourseEventLifecycle(publication.id);
  void guild;
  void context;
  void publication;
  void course;
}

function scheduleCourseEventTimer(publicationId: string, kind: "start" | "end", delayMs: number, generation: symbol, action: () => Promise<void>) {
  const scheduleNext = (remainingMs: number) => {
    const timeout = setTimeout(() => {
      if (courseEventLifecycleGenerations.get(publicationId) !== generation) return;
      const remaining = remainingMs - MAX_COURSE_EVENT_TIMER_DELAY;
      if (remaining > 0) {
        scheduleNext(remaining);
        return;
      }
      void action().catch((error) => {
        console.error(`[courses] failed to ${kind} scheduled event for publication ${publicationId}:`, error instanceof Error ? error.message : error);
      });
    }, Math.min(Math.max(remainingMs, 0), MAX_COURSE_EVENT_TIMER_DELAY));
    const timers = courseEventLifecycleTimers.get(publicationId) ?? {};
    if (timers[kind]) clearTimeout(timers[kind]);
    timers[kind] = timeout;
    courseEventLifecycleTimers.set(publicationId, timers);
  };
  scheduleNext(delayMs);
}

async function runCourseEventTransition(guild: Guild, context: BotContext, publicationId: string, transition: "start" | "end", courseHint?: Course | null) {
  const publication = await context.api.getCoursePublication(guild.id, publicationId).catch(() => null);
  if (!publication?.discordEventId || ["cancelled", "closed", "finished"].includes(publication.status)) return;
  const course = courseHint?.id === publication.courseId ? courseHint : await context.api.getCourse(guild.id, publication.courseId).catch(() => null);
  if (!course) return;
  let event = await guild.scheduledEvents.fetch(publication.discordEventId).catch(() => null);
  if (!event) throw new Error("Evento agendado não encontrado no Discord.");
  if (transition === "start") {
    if (event.status === GuildScheduledEventStatus.Scheduled) {
      await event.edit({
        description: courseScheduledEventDescription(course, publication, "Curso em andamento"),
        name: `Curso iniciado - ${course.name}`.slice(0, 100),
        status: GuildScheduledEventStatus.Active
      });
    }
    await context.api.updateCoursePublicationEvent(guild.id, publication.id, { discordEventId: publication.discordEventId, discordEventUrl: publication.discordEventUrl, syncError: null }).catch(() => null);
    return;
  }
  if (event.status === GuildScheduledEventStatus.Canceled || event.status === GuildScheduledEventStatus.Completed) return;
  if (event.status === GuildScheduledEventStatus.Scheduled) {
    event = await event.edit({ status: GuildScheduledEventStatus.Active }).catch(() => event);
  }
  if (!event) return;
  await event.edit({
    description: courseScheduledEventDescription(course, publication, "Encerrado automaticamente"),
    name: `Curso encerrado - ${course.name}`.slice(0, 100),
    status: GuildScheduledEventStatus.Completed
  });
  clearCourseEventLifecycle(publication.id);
  await context.api.updateCoursePublicationEvent(guild.id, publication.id, { discordEventId: publication.discordEventId, discordEventUrl: publication.discordEventUrl, syncError: null }).catch(() => null);
}

function clearCourseEventLifecycle(publicationId: string) {
  const timers = courseEventLifecycleTimers.get(publicationId);
  if (timers?.start) clearTimeout(timers.start);
  if (timers?.end) clearTimeout(timers.end);
  courseEventLifecycleTimers.delete(publicationId);
  courseEventLifecycleGenerations.delete(publicationId);
}

function courseScheduledEventDescription(course: Course, publication: CoursePublication, status: string) {
  return [
    `Curso: ${course.name}`,
    `Instrutor: <@${publication.instructorId}>`,
    `Horario: ${publication.scheduledFor}`,
    `DP: ${coursePublicationDepartmentLabel(publication)}`,
    `Vagas: ${publication.capacity}`,
    `Situacao: ${status}`,
    `Agendamento: ${publication.id}`,
    publication.notes ? `Observacoes: ${publication.notes}` : null
  ].filter(Boolean).join("\n").slice(0, 1000);
}

function coursePublicationDepartmentLabel(publication: CoursePublication) {
  return publication.dpNameSnapshot || publication.location || "não informado";
}

function scheduledEventUrl(guildId: string, eventId: string) {
  return `https://discord.com/events/${guildId}/${eventId}`;
}

async function realizeCourseExam(interaction: ButtonInteraction, context: BotContext, publicationId: string) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const publication = await context.api.getCoursePublication(interaction.guildId!, publicationId).catch(() => null);
  if (!publication) return void await interaction.editReply("Publicação de curso não encontrada.");
  if (!publication.students.includes(interaction.user.id)) return void await interaction.editReply("Você não está inscrito nesta turma e, por isso, não pode realizar esta prova.");
  if (publication.status === "cancelled") return void await interaction.editReply("Este curso foi cancelado e a prova não pode ser realizada.");
  if (publication.status === "closed" || publication.status === "finished") return void await interaction.editReply("Este curso já foi finalizado.");
  if (publication.status !== "started" && publication.status !== "proof") return void await interaction.editReply("A prova ainda não está disponível. Aguarde o instrutor iniciar o curso.");

  const member = await interaction.guild!.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return void await interaction.editReply("Você não possui acesso válido a este servidor.");
  const [course, runtime, settings] = await Promise.all([
    context.api.getCourse(interaction.guildId!, publication.courseId),
    context.api.getCourseExamRuntime(interaction.guildId!, publication.courseId),
    context.api.getCourseSettings(interaction.guildId!)
  ]);
  if (!runtime.settings.enabled) return void await interaction.editReply("A prova vinculada a este curso está desativada na dashboard.");
  const proofReady = validateRuntimeProof(runtime.questions);
  if (!proofReady.ok) return void await interaction.editReply("A prova vinculada a este curso não foi encontrada.");
  const temporaryCategoryId = settings.tempProofCategoryId || settings.temporaryCategoryId;
  if (!temporaryCategoryId) return void await interaction.editReply("A categoria dos canais temporários de prova ainda não foi configurada.");
  const category = await interaction.guild!.channels.fetch(temporaryCategoryId).catch(() => null);
  if (!category || category.type !== ChannelType.GuildCategory) return void await interaction.editReply("A categoria configurada para a prova não foi encontrada.");

  const reservation = await context.api.reserveCourseExamStart(interaction.guildId!, publicationId, interaction.user.id).catch(() => null);
  if (!reservation) return void await interaction.editReply("Não foi possível iniciar sua prova neste momento. A equipe responsável foi notificada.");
  if (reservation.error === "completed") return void await interaction.editReply("Esta prova já foi finalizada e não pode ser realizada novamente.");
  if (reservation.error === "in_progress") {
    const channel = reservation.enrollment?.examChannelId
      ? await interaction.guild!.channels.fetch(reservation.enrollment.examChannelId).catch(() => null)
      : null;
    return void await interaction.editReply(channel ? `Você já possui uma prova em andamento para este curso: <#${channel.id}>.` : "Você já possui uma prova em andamento para este curso.");
  }
  if (reservation.error === "exam_disabled") return void await interaction.editReply("A prova vinculada a este curso está desativada na dashboard.");
  if (reservation.error === "exam_missing") return void await interaction.editReply("Este curso não possui uma prova vinculada.");
  if (reservation.error) return void await interaction.editReply("Não foi possível realizar esta prova devido ao estado atual do curso.");

  let channel: TextChannel | null = null;
  try {
    await interaction.guild!.channels.fetch().catch(() => null);
    const marker = courseExamChannelTopic(publication.id, interaction.user.id);
    const expectedName = examChannelName(member.displayName, course.name);
    const existing = interaction.guild!.channels.cache.find((candidate): candidate is TextChannel => (
      candidate.type === ChannelType.GuildText && isCourseExamChannelFor(candidate.topic, publication.id, interaction.user.id)
    ));
    channel = existing ?? await interaction.guild!.channels.create({
      name: uniqueExamChannelName(interaction.guild!, expectedName, interaction.user.id),
      parent: temporaryCategoryId,
      permissionOverwrites: examPermissionOverwrites(interaction.guild!, context, publication, interaction.user.id),
      reason: `Avaliativo individual do curso ${course.name}`,
      topic: marker,
      type: ChannelType.GuildText
    });
    await context.api.setCourseEnrollmentExamChannel(interaction.guildId!, publication.id, {
      channelId: channel.id, studentId: interaction.user.id, studentName: member.displayName
    });
    const welcome = await channel.send(studentExamWelcomePanel(course, publication, runtime.settings, interaction.user.id, member.displayName, runtime.questions, true));
    const attempt = await context.api.createCourseExamAttempt(interaction.guildId!, {
      channelId: channel.id,
      courseId: publication.courseId,
      instructorId: publication.instructorId,
      publicationId,
      studentId: interaction.user.id
    });
    await welcome.edit(studentExamWelcomePanel(course, publication, runtime.settings, interaction.user.id, member.displayName, runtime.questions, false));
    await channel.setTopic(`${marker}:ready`, `Canal individual da prova do curso ${course.name}`);
    scheduleExamChannelDeletion(channel, examChannelFallbackDeleteAt(channel, settings), context);
    await refreshPublicationMessageByRecord(interaction, context, publication);
    await sendPublicationLog(interaction, context, publication, [
      "📝 Prova iniciada",
      `Aluno: ${member.displayName} (<@${interaction.user.id}>)`,
      `ID do aluno: ${interaction.user.id}`,
      `Curso: ${course.name}`,
      `ID do curso: ${course.id}`,
      `Prova: Prova de ${course.name}`,
      `ID da tentativa: ${attempt.id}`,
      `Canal: <#${channel.id}>`,
      `Instrutor: <@${publication.instructorId}>`,
      `Servidor: ${interaction.guild!.name} (${interaction.guildId})`,
      `Bot: ${interaction.client.user.username} (${interaction.client.user.id})`,
      `Status: Realizando prova`,
      `Horário: ${new Date(attempt.startedAt).toLocaleString("pt-BR")}`
    ].join("\n"));
    await interaction.editReply(`Seu canal de prova foi criado: <#${channel.id}>.`);
  } catch (error) {
    if (channel) await channel.delete("Revertendo canal após falha ao iniciar o avaliativo").catch(() => null);
    await context.api.releaseCourseExamStart(interaction.guildId!, publication.id, interaction.user.id).catch(() => null);
    console.error(`[courses] failed to create individual exam for ${interaction.user.id}:`, error instanceof Error ? error.message : error);
    await sendPublicationLog(interaction, context, publication, `⚠️ Falha ao criar canal da prova\nAluno: ${member.displayName} (<@${interaction.user.id}>)\nCurso: ${course.name}\nErro: ${error instanceof Error ? error.message : String(error)}`).catch(() => null);
    await interaction.editReply("Não foi possível criar o canal da prova. Verifique as permissões do bot ou tente novamente.");
  }
}

async function startCourseExam(interaction: ButtonInteraction, context: BotContext, publicationId: string) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.editReply(await startCourseExamById(interaction, context, publicationId));
}

async function startCourseExamById(interaction: ButtonInteraction | ChatInputCommandInteraction | StringSelectMenuInteraction, context: BotContext, publicationId: string) {
  const publication = await context.api.getCoursePublication(interaction.guildId!, publicationId).catch(() => null);
  if (!publication) return "Publicação de curso não encontrada.";
  if (!(await canManagePublication(interaction, context, publication))) {
    return "Você não possui permissão para usar este sistema.";
  }

  const key = `${interaction.guildId}:${publicationId}`;
  const pending = examProvisioning.get(key);
  if (pending) return "A preparação dos canais desta prova já está em andamento. Aguarde a conclusão.";

  const operation = provisionCourseExamChannels(interaction, context, publication);
  examProvisioning.set(key, operation);
  try {
    return await operation;
  } finally {
    if (examProvisioning.get(key) === operation) examProvisioning.delete(key);
  }
}

async function provisionCourseExamChannels(interaction: ButtonInteraction | ChatInputCommandInteraction | StringSelectMenuInteraction, context: BotContext, publication: CoursePublication) {
  const settings = await context.api.getCourseSettings(interaction.guildId!);
  if (publication.status !== "started" && publication.status !== "proof") {
    return "Inicie a aula antes de iniciar a prova.";
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
  const temporaryCategoryId = settings.tempProofCategoryId || settings.temporaryCategoryId;
  if (!temporaryCategoryId) {
    return "Configure a categoria dos canais temporários de prova.";
  }
  const guild = interaction.guild!;
  const temporaryCategory = await guild.channels.fetch(temporaryCategoryId).catch(() => null);
  if (!temporaryCategory || temporaryCategory.type !== ChannelType.GuildCategory) {
    return "A categoria configurada para os canais temporários da prova não existe mais ou não é uma categoria válida.";
  }
  await guild.channels.fetch().catch(() => null);
  const created: string[] = [];
  const reused: string[] = [];
  const failed: string[] = [];
  const readyChannels: TextChannel[] = [];

  for (const studentId of publication.students) {
    let provisionalChannel: TextChannel | null = null;
    let createdNewChannel = false;
    try {
      const member = await guild.members.fetch(studentId).catch(() => null);
      const marker = courseExamChannelTopic(publication.id, studentId);
      const expectedName = examChannelName(member?.displayName ?? studentId, course.name);
      const markedChannel = guild.channels.cache.find((channel): channel is TextChannel => (
        channel.type === ChannelType.GuildText
        && isCourseExamChannelFor(channel.topic, publication.id, studentId)
      ));
      const existing = markedChannel ?? findLegacyExamChannel(guild, publication, temporaryCategoryId, studentId, expectedName);
      const isLegacyChannel = Boolean(existing && !markedChannel);
      const existingMarker = parseCourseExamChannelTopic(existing?.topic);
      let existingAttempt: CourseExamAttempt | null = null;
      if (existing) {
        try {
          existingAttempt = await context.api.getCourseExamAttemptByChannel(guild.id, existing.id);
        } catch (error) {
          throw new Error(`não foi possível verificar a tentativa vinculada ao canal: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const studentOverwrite = existing?.permissionOverwrites.cache.get(studentId);
      const studentIsLocked = Boolean(studentOverwrite?.deny.has(PermissionFlagsBits.SendMessages));
      const attemptIsFinished = Boolean(existingAttempt && existingAttempt.status !== "in_progress");
      if (existing && (existingMarker?.state === "finished" || studentIsLocked || attemptIsFinished)) {
        const deleteAt = existingMarker?.deleteAt ?? examChannelAttemptDeleteAt(existing, settings, existingAttempt);
        await persistFinishedExamChannelState(existing, studentId, `${marker}:finished:${Math.floor(deleteAt / 1000)}`);
        scheduleExamChannelDeletion(existing, deleteAt, context);
        readyChannels.push(existing);
        reused.push(`<#${existing.id}>`);
        continue;
      }
      const channelName = existing?.name
        ?? uniqueExamChannelName(guild, expectedName, studentId);
      const overwrites = examPermissionOverwrites(guild, context, publication, studentId);
      const alreadyReady = isLegacyChannel || existingMarker?.state === "ready";
      const channel = existing
        ? await existing.edit({
          name: channelName,
          parent: temporaryCategoryId,
          permissionOverwrites: overwrites,
          reason: `Reconciliando canal da prova do curso ${course.name}`,
          topic: alreadyReady ? `${marker}:ready` : marker
        })
        : await guild.channels.create({
          name: channelName,
          parent: temporaryCategoryId,
          permissionOverwrites: overwrites,
          reason: `Prova do curso ${course.name}`,
          topic: marker,
          type: ChannelType.GuildText
        });
      if (channel.type !== ChannelType.GuildText) {
        throw new Error("o canal criado não é um canal de texto");
      }
      provisionalChannel = channel;
      createdNewChannel = !existing;
      if (!alreadyReady) {
        await channel.send(studentExamWelcomePanel(course, publication, runtime.settings, studentId, member?.displayName ?? studentId, runtime.questions));
      }
      await context.api.setCourseEnrollmentExamChannel(guild.id, publication.id, {
        channelId: channel.id, studentId, studentName: member?.displayName ?? studentId
      });
      if (!alreadyReady) await channel.setTopic(`${marker}:ready`, `Canal individual da prova do curso ${course.name}`);
      scheduleExamChannelDeletion(channel, examChannelFallbackDeleteAt(channel, settings), context);
      readyChannels.push(channel);
      (existing ? reused : created).push(`<#${channel.id}>`);
    } catch (error) {
      if (createdNewChannel && provisionalChannel) {
        await provisionalChannel.delete("Revertendo canal de prova após falha de persistência").catch(() => null);
      }
      failed.push(`<@${studentId}>: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failed.length) {
    await sendPublicationLog(interaction, context, publication, `⚠️ Preparação da prova incompleta\nCurso: ${course.name}\nInstrutor: <@${interaction.user.id}>\nCanais criados: ${created.length}\nCanais reutilizados: ${reused.length}\nFalhas: ${failed.length}`);
    return [
      publication.status === "proof"
        ? "A prova está liberada, mas ainda faltam canais individuais. Corrija as falhas e tente novamente."
        : "Não foi possível preparar o canal de todos os alunos. Corrija as falhas e tente **Realizar prova** novamente.",
      created.length ? `Canais criados:\n${created.join("\n")}` : "",
      reused.length ? `Canais já preparados:\n${reused.join("\n")}` : "",
      `Falhas:\n${failed.join("\n")}`
    ].filter(Boolean).join("\n\n").slice(0, 1900);
  }

  const proofPublication = publication.status === "proof"
    ? publication
    : await context.api.setCoursePublicationStatus(interaction.guildId!, publication.id, "proof", interaction.user.id).catch(() => null);
  if (!proofPublication) {
    return "Os canais individuais foram preparados, mas o curso mudou de estado antes da liberação. Atualize o painel e tente novamente.";
  }
  await refreshPublicationMessageByRecord(interaction, context, proofPublication);
  await sendPublicationLog(interaction, context, proofPublication, `${publication.status === "proof" ? "🔧 Canais da prova verificados" : "📝 Prova iniciada"}\nCurso: ${course.name}\nInstrutor: <@${interaction.user.id}>\nCanais criados: ${created.length}\nCanais reutilizados: ${reused.length}\nFalhas: ${failed.length}`);
  return [
    publication.status === "proof"
      ? `Canais verificados para ${readyChannels.length} aluno(s). Cada participante possui um canal individual e temporário.`
      : `Prova liberada para ${readyChannels.length} aluno(s). Cada participante recebeu um canal individual e temporário.`,
    created.length ? `Canais criados:\n${created.join("\n")}` : "",
    reused.length ? `Canais já existentes:\n${reused.join("\n")}` : "",
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
  if (!isCourseExamChannelFor("topic" in interaction.channel! ? interaction.channel.topic : null, publicationId, studentId)) {
    await interaction.reply({ content: "Este componente não pertence ao seu canal de prova.", flags: MessageFlags.Ephemeral });
    return;
  }
  const startingKey = `${interaction.guildId}:${publicationId}:${studentId}`;
  if (studentExamStarting.has(startingKey)) {
    await interaction.reply({ content: "Sua prova já está sendo iniciada. Aguarde.", flags: MessageFlags.Ephemeral });
    return;
  }
  const operation = beginStudentExamOnce(interaction, context, publicationId, studentId);
  studentExamStarting.set(startingKey, operation);
  try {
    await operation;
  } finally {
    if (studentExamStarting.get(startingKey) === operation) studentExamStarting.delete(startingKey);
  }
}

async function beginStudentExamOnce(interaction: ButtonInteraction, context: BotContext, publicationId: string, studentId: string) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const publication = await context.api.getCoursePublication(interaction.guildId!, publicationId).catch(() => null);
  if (!publication) return interaction.editReply("Publicação de curso não encontrada.");
  if (publication.status !== "started" && publication.status !== "proof") return void await interaction.editReply("A prova ainda não está disponível. Aguarde o instrutor iniciar o curso.");
  if (!publication.students.includes(studentId)) return void await interaction.editReply("Você não está inscrito nesta turma e, por isso, não pode realizar esta prova.");
  const member = await interaction.guild!.members.fetch(studentId).catch(() => null);
  if (!member) return void await interaction.editReply("Você não possui acesso válido a este servidor.");
  const [course, runtime] = await Promise.all([
    context.api.getCourse(interaction.guildId!, publication.courseId),
    context.api.getCourseExamRuntime(interaction.guildId!, publication.courseId)
  ]);
  if (!runtime.settings.enabled) return void await interaction.editReply("Este curso não possui uma prova vinculada. Configure a prova correspondente antes de liberar o avaliativo.");
  if (!runtime.questions.length) return void await interaction.editReply("A prova vinculada a este curso não foi encontrada.");
  let attempt = await context.api.getCourseExamAttemptByChannel(interaction.guildId!, interaction.channelId).catch(() => null);
  if (!attempt) {
    attempt = await context.api.createCourseExamAttempt(interaction.guildId!, {
      channelId: interaction.channelId,
      courseId: publication.courseId,
      instructorId: publication.instructorId,
      publicationId,
      studentId
    }).catch(() => null);
  }
  if (!attempt || attempt.studentId !== studentId) return void await interaction.editReply("Tentativa de prova inválida para este canal.");
  if (attempt.status !== "in_progress") return void await interaction.editReply("Esta prova já foi finalizada e não pode ser realizada novamente.");
  if (!attempt.identificationConfirmedAt) {
    await context.api.updateCourseExamIdentification(interaction.guildId!, attempt.id, {
      discordDisplayName: interaction.user.globalName ?? interaction.user.username,
      discordUsername: interaction.user.username,
      guildNickname: member.nickname ?? null
    }).catch(() => null);
    const updated = await context.api.getCourseExamAttempt(interaction.guildId!, attempt.id);
    await interaction.message.edit(examIdentificationPanel(course, publication, runtime.settings, updated.attempt, member.displayName)).catch(() => null);
    await interaction.editReply(updated.attempt.studentIdentification?.rpFullName || updated.attempt.studentIdentification?.currentRank || updated.attempt.studentIdentification?.rpId
      ? "Sua tentativa foi restaurada. Continue a identificação no painel."
      : "Preencha sua identificação antes de iniciar as perguntas.");
    return;
  }
  const scheduled = runtime.settings.releaseMode === "scheduled" && runtime.settings.releaseAt && Date.parse(runtime.settings.releaseAt) > Date.now();
  if (scheduled || runtime.settings.releaseMode === "instructor") {
    await interaction.message.edit(examReleasePanel(course, runtime.settings, attempt)).catch(() => null);
    await interaction.editReply(scheduled ? "Sua prova ainda não foi liberada no horário configurado." : "Sua prova ainda aguarda liberação do instrutor.");
    return;
  }
  const bundle = await context.api.getCourseExamAttempt(interaction.guildId!, attempt.id);
  await interaction.message.edit({ components: [] }).catch(() => null);
  await interaction.editReply(bundle.attempt.currentQuestionIndex > 0 ? "Prova retomada do ponto salvo." : "Você pode começar a responder. A primeira pergunta foi enviada no canal.");
  const channel = interaction.channel;
  if (!channel?.isTextBased() || !("send" in channel)) return;
  if (bundle.attempt.currentQuestionIndex === 0) await channel.send(examIntroPanel(course, runtime.settings)).catch(() => null);
  await sendExamQuestion(interaction.channel as TextChannel, runtime.settings, course, bundle.attempt, bundle.questions.length ? bundle.questions : runtime.questions);
}

async function showIdentificationNameModal(interaction: ButtonInteraction) {
  const attemptId = idFromCustomId(interaction.customId);
  await interaction.showModal(new ModalBuilder()
    .setCustomId(`course_exam_ident_name_modal:${attemptId}:${interaction.message.id}`)
    .setTitle("Identificação do Aluno")
    .addComponents(inputRow("rpFullName", "Nome completo (RP)", TextInputStyle.Short, true, 120)));
}

async function submitIdentificationName(interaction: ModalSubmitInteraction, context: BotContext) {
  const [, attemptId, messageId] = interaction.customId.split(":");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const rpFullName = interaction.fields.getTextInputValue("rpFullName");
  let errorMessage = "Não foi possível salvar o nome.";
  const attempt = await context.api.updateCourseExamIdentification(interaction.guildId!, attemptId!, { rpFullName }).catch((error) => {
    errorMessage = error instanceof Error ? error.message : errorMessage;
    return null;
  });
  if (!attempt) {
    await interaction.editReply(errorMessage);
    return;
  }
  await updateIdentificationMessage(interaction, context, attempt, messageId);
  await interaction.editReply("Nome salvo. Selecione a patente atual.");
}

async function selectIdentificationRank(interaction: StringSelectMenuInteraction, context: BotContext) {
  const attemptId = idFromCustomId(interaction.customId);
  const rank = interaction.values[0] as "CADET" | "OFFICER" | "SENIOR_OFFICER" | undefined;
  await interaction.deferUpdate();
  const attempt = await context.api.updateCourseExamIdentification(interaction.guildId!, attemptId, { currentRank: rank ?? null });
  await interaction.message.edit(await identificationPanelForAttempt(interaction, context, attempt)).catch(() => null);
  await interaction.followUp({ content: "Patente salva. Informe o ID.", flags: MessageFlags.Ephemeral }).catch(() => null);
}

async function showIdentificationIdModal(interaction: ButtonInteraction) {
  const attemptId = idFromCustomId(interaction.customId);
  await interaction.showModal(new ModalBuilder()
    .setCustomId(`course_exam_ident_id_modal:${attemptId}:${interaction.message.id}`)
    .setTitle("Identificação do Aluno")
    .addComponents(inputRow("rpId", "ID", TextInputStyle.Short, true, 100, "")));
}

async function submitIdentificationId(interaction: ModalSubmitInteraction, context: BotContext) {
  const [, attemptId, messageId] = interaction.customId.split(":");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const rpId = interaction.fields.getTextInputValue("rpId");
  let errorMessage = "Não foi possível salvar o ID.";
  const attempt = await context.api.updateCourseExamIdentification(interaction.guildId!, attemptId!, { rpId }).catch((error) => {
    errorMessage = error instanceof Error ? error.message : errorMessage;
    return null;
  });
  if (!attempt) {
    await interaction.editReply(errorMessage);
    return;
  }
  await updateIdentificationMessage(interaction, context, attempt, messageId);
  await interaction.editReply("ID salvo. Confirme seus dados para liberar a prova.");
}

async function confirmExamIdentification(interaction: ButtonInteraction, context: BotContext) {
  await interaction.deferUpdate();
  const attemptId = idFromCustomId(interaction.customId);
  const attempt = await context.api.updateCourseExamIdentification(interaction.guildId!, attemptId, {
    discordDisplayName: interaction.user.globalName ?? interaction.user.username,
    discordUsername: interaction.user.username,
    guildNickname: (interaction.member as GuildMember | null)?.nickname ?? null,
    confirm: true
  }).catch(() => null);
  if (!attempt) {
    await interaction.followUp({ content: "Preencha nome completo, patente e ID antes de confirmar.", flags: MessageFlags.Ephemeral });
    return;
  }
  const [course, runtime] = await Promise.all([
    context.api.getCourse(interaction.guildId!, attempt.courseId),
    context.api.getCourseExamRuntime(interaction.guildId!, attempt.courseId)
  ]);
  await interaction.message.edit(examReleasePanel(course, runtime.settings, attempt)).catch(() => null);
  await interaction.followUp({ content: "Dados confirmados. Você já pode iniciar a prova.", flags: MessageFlags.Ephemeral }).catch(() => null);
}

async function resetExamIdentificationPanel(interaction: ButtonInteraction, context: BotContext) {
  await interaction.deferUpdate();
  const attemptId = idFromCustomId(interaction.customId);
  const bundle = await context.api.getCourseExamAttempt(interaction.guildId!, attemptId).catch(() => null);
  if (!bundle || bundle.attempt.studentId !== interaction.user.id) {
    await interaction.followUp({ content: "Esta interação pertence a outro usuário.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.message.edit(await identificationPanelForAttempt(interaction, context, bundle.attempt)).catch(() => null);
}

async function cancelExamIdentification(interaction: ButtonInteraction, context: BotContext) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const attemptId = idFromCustomId(interaction.customId);
  const bundle = await context.api.getCourseExamAttempt(interaction.guildId!, attemptId).catch(() => null);
  if (!bundle || bundle.attempt.studentId !== interaction.user.id) {
    await interaction.editReply("Esta interação pertence a outro usuário.");
    return;
  }
  await context.api.releaseCourseExamStart(interaction.guildId!, bundle.attempt.publicationId, interaction.user.id).catch(() => null);
  await sendCourseLog(interaction, await context.api.getCourseSettings(interaction.guildId!), `Prova cancelada pelo aluno\nTentativa: ${attemptId}\nAluno: <@${interaction.user.id}>\n${examStudentIdentificationSummary(bundle.attempt)}`).catch(() => null);
  if (interaction.channel?.isTextBased() && "delete" in interaction.channel) {
    await interaction.editReply("Prova cancelada. O canal temporário será encerrado.");
    await (interaction.channel as TextChannel).delete("Prova cancelada pelo aluno.").catch(() => null);
    return;
  }
  await interaction.editReply("Prova cancelada.");
}

async function updateIdentificationMessage(interaction: ModalSubmitInteraction, context: BotContext, attempt: CourseExamAttempt, messageId?: string) {
  if (!messageId || !interaction.channel?.isTextBased() || !("messages" in interaction.channel)) return;
  const message = await interaction.channel.messages.fetch(messageId).catch(() => null);
  await message?.edit(await identificationPanelForAttempt(interaction, context, attempt)).catch(() => null);
}

async function identificationPanelForAttempt(interaction: { guildId: string | null; guild: ButtonInteraction["guild"] }, context: BotContext, attempt: CourseExamAttempt) {
  const [course, publication, runtime] = await Promise.all([
    context.api.getCourse(interaction.guildId!, attempt.courseId),
    context.api.getCoursePublication(interaction.guildId!, attempt.publicationId),
    context.api.getCourseExamRuntime(interaction.guildId!, attempt.courseId)
  ]);
  const member = await interaction.guild?.members.fetch(attempt.studentId).catch(() => null);
  return examIdentificationPanel(course, publication, runtime.settings, attempt, member?.displayName ?? attempt.studentId);
}

export async function handleCourseExamMessage(message: Message, context: BotContext) {
  void message;
  void context;
  return false;
}

async function selectExamAnswer(interaction: StringSelectMenuInteraction, context: BotContext) {
  const [, attemptId, questionIndexRaw] = interaction.customId.split(":");
  const questionIndex = Number(questionIndexRaw);
  if (!attemptId) {
    await interaction.reply({ content: "Tentativa de prova inválida.", flags: MessageFlags.Ephemeral });
    return;
  }
  const bundle = await context.api.getCourseExamAttempt(interaction.guildId!, attemptId).catch(() => null);
  if (!bundle || bundle.attempt.studentId !== interaction.user.id || bundle.attempt.status !== "in_progress") {
    await interaction.reply({ content: "Tentativa de prova inválida.", flags: MessageFlags.Ephemeral });
    return;
  }
  const question = bundle.questions[bundle.attempt.currentQuestionIndex];
  if (!question || (question.type !== "selection" && question.type !== "multiple")) {
    await interaction.reply({ content: "Pergunta inválida.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!Number.isInteger(questionIndex) || questionIndex !== bundle.attempt.currentQuestionIndex) {
    await interaction.reply({ content: "Esta questão já foi respondida ou não está mais ativa.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  const selectedAlternativeIds = interaction.values;
  pendingExamSelections.set(pendingExamSelectionKey(interaction.guildId!, attemptId, questionIndex), selectedAlternativeIds);
  const course = await context.api.getCourse(interaction.guildId!, bundle.attempt.courseId);
  await interaction.message.edit(pendingSelectionQuestionPanel(course, bundle.attempt, question, questionIndex + 1, bundle.questions.length, selectedAlternativeIds)).catch(() => null);
}

async function confirmExamAnswer(interaction: ButtonInteraction, context: BotContext) {
  const [, attemptId, questionIndexRaw] = interaction.customId.split(":");
  const questionIndex = Number(questionIndexRaw);
  const selectionKey = pendingExamSelectionKey(interaction.guildId!, attemptId ?? "", questionIndex);
  const selectedAlternativeIds = pendingExamSelections.get(selectionKey) ?? [];
  if (!attemptId || !Number.isInteger(questionIndex) || !selectedAlternativeIds.length) {
    await interaction.reply({ content: "Responda à questão antes de continuar.", flags: MessageFlags.Ephemeral });
    return;
  }
  const bundle = await context.api.getCourseExamAttempt(interaction.guildId!, attemptId).catch(() => null);
  if (!bundle || bundle.attempt.studentId !== interaction.user.id || bundle.attempt.status !== "in_progress") {
    await interaction.reply({ content: "Tentativa de prova inválida.", flags: MessageFlags.Ephemeral });
    return;
  }
  const question = bundle.questions[bundle.attempt.currentQuestionIndex];
  if (!question || !Number.isInteger(questionIndex) || questionIndex !== bundle.attempt.currentQuestionIndex) {
    await interaction.reply({ content: "Esta questão já foi respondida ou não está mais ativa.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  const answer = await context.api.saveCourseExamAnswer(interaction.guildId!, attemptId, {
    questionId: question.id,
    questionIndex,
    selectedAlternativeId: question.type === "selection" ? selectedAlternativeIds[0] : null,
    selectedAlternativeIds: question.type === "multiple" ? selectedAlternativeIds : null
  }).catch(() => null);
  if (!answer) {
    await interaction.followUp({ content: "Esta questão já foi respondida ou não está mais ativa.", flags: MessageFlags.Ephemeral });
    return;
  }
  pendingExamSelections.delete(selectionKey);
  await interaction.message.edit(answeredSelectionQuestionPanel(bundle.attempt, question, questionIndex + 1, bundle.questions.length, selectedAlternativeIds)).catch(() => null);
  const updated = await context.api.getCourseExamAttempt(interaction.guildId!, attemptId);
  const [course, runtime] = await Promise.all([
    context.api.getCourse(interaction.guildId!, updated.attempt.courseId),
    context.api.getCourseExamRuntime(interaction.guildId!, updated.attempt.courseId)
  ]);
  await sendExamQuestion(interaction.channel as TextChannel, runtime.settings, course, updated.attempt, updated.questions);
}

async function showWrittenAnswerModal(interaction: ButtonInteraction, context: BotContext) {
  const [, attemptId, questionIndexRaw] = interaction.customId.split(":");
  const questionIndex = Number(questionIndexRaw);
  if (!attemptId) {
    await interaction.reply({ content: "Tentativa de prova inválida.", flags: MessageFlags.Ephemeral });
    return;
  }
  const bundle = await context.api.getCourseExamAttempt(interaction.guildId!, attemptId).catch(() => null);
  if (!bundle || bundle.attempt.studentId !== interaction.user.id || bundle.attempt.status !== "in_progress") {
    await interaction.reply({ content: "Tentativa de prova inválida.", flags: MessageFlags.Ephemeral });
    return;
  }
  const question = bundle.questions[bundle.attempt.currentQuestionIndex];
  if (!question || question.type !== "written" || !Number.isInteger(questionIndex) || questionIndex !== bundle.attempt.currentQuestionIndex) {
    await interaction.reply({ content: "Esta questão já foi respondida ou não está mais ativa.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.showModal(new ModalBuilder()
    .setCustomId(`course_exam_written_modal:${attemptId}:${questionIndex}:${interaction.message.id}`)
    .setTitle(`Questão ${questionIndex + 1}`)
    .addComponents(inputRow("answer", "Resposta", TextInputStyle.Paragraph, true, 3000)));
}

async function submitWrittenAnswer(interaction: ModalSubmitInteraction, context: BotContext) {
  const [, attemptId, questionIndexRaw, messageId] = interaction.customId.split(":");
  const questionIndex = Number(questionIndexRaw);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!attemptId) {
    await interaction.editReply("Tentativa de prova inválida.");
    return;
  }
  const bundle = await context.api.getCourseExamAttempt(interaction.guildId!, attemptId).catch(() => null);
  if (!bundle || bundle.attempt.studentId !== interaction.user.id || bundle.attempt.status !== "in_progress") {
    await interaction.editReply("Tentativa de prova inválida.");
    return;
  }
  const question = bundle.questions[bundle.attempt.currentQuestionIndex];
  if (!question || question.type !== "written" || !Number.isInteger(questionIndex) || questionIndex !== bundle.attempt.currentQuestionIndex) {
    await interaction.editReply("Esta questão já foi respondida ou não está mais ativa.");
    return;
  }
  const writtenAnswer = interaction.fields.getTextInputValue("answer").trim();
  const answer = await context.api.saveCourseExamAnswer(interaction.guildId!, attemptId, { questionId: question.id, questionIndex, writtenAnswer }).catch(() => null);
  if (!answer) {
    await interaction.editReply("Não foi possível salvar sua resposta. Tente novamente.");
    return;
  }
  const channel = interaction.channel;
  if (messageId && channel?.isTextBased() && "messages" in channel) {
    const questionMessage = await channel.messages.fetch(messageId).catch(() => null);
    await questionMessage?.edit(answeredWrittenQuestionPanel(bundle.attempt, question, questionIndex + 1, bundle.questions.length)).catch(() => null);
  }
  const updated = await context.api.getCourseExamAttempt(interaction.guildId!, attemptId);
  const [course, runtime] = await Promise.all([
    context.api.getCourse(interaction.guildId!, updated.attempt.courseId),
    context.api.getCourseExamRuntime(interaction.guildId!, updated.attempt.courseId)
  ]);
  await interaction.editReply("Resposta registrada com sucesso. Continue para a próxima questão.");
  if (channel?.isTextBased() && "send" in channel) {
    await sendExamQuestion(channel as TextChannel, runtime.settings, course, updated.attempt, updated.questions);
  }
}

async function retryExamQuestion(interaction: ButtonInteraction, context: BotContext) {
  const [, attemptId, questionIndexRaw] = interaction.customId.split(":");
  const questionIndex = Number(questionIndexRaw);
  const bundle = await context.api.getCourseExamAttempt(interaction.guildId!, attemptId ?? "").catch(() => null);
  if (!bundle || bundle.attempt.studentId !== interaction.user.id || bundle.attempt.status !== "in_progress") {
    await interaction.reply({ content: "Tentativa de prova inválida.", flags: MessageFlags.Ephemeral });
    return;
  }
  const question = bundle.questions[bundle.attempt.currentQuestionIndex];
  if (!question || !Number.isInteger(questionIndex) || questionIndex !== bundle.attempt.currentQuestionIndex) {
    await interaction.reply({ content: "Esta questão já foi respondida ou não está mais ativa.", flags: MessageFlags.Ephemeral });
    return;
  }
  const course = await context.api.getCourse(interaction.guildId!, bundle.attempt.courseId);
  pendingExamSelections.delete(pendingExamSelectionKey(interaction.guildId!, attemptId ?? "", questionIndex));
  await interaction.update(selectionQuestionPanel(course, bundle.attempt, question, questionIndex + 1, bundle.questions.length));
}

async function commitExamAnswer(interaction: ButtonInteraction, context: BotContext) {
  void context;
  await replyDeactivatedPanel(interaction);
}

async function finishExam(interaction: ButtonInteraction, context: BotContext) {
  await interaction.deferUpdate();
  const attemptId = idFromCustomId(interaction.customId);
  const currentBundle = await getStudentExamAttempt(interaction, context, attemptId);
  if (!currentBundle) return;
  logCourseFlow("exam_finalize_requested", { attemptId, guildId: interaction.guildId, studentId: interaction.user.id });
  let finalizeFailureMessage = "A prova ja foi finalizada ou ainda possui questoes pendentes.";
  const result = await context.api.finalizeCourseExamAttempt(interaction.guildId!, attemptId).catch(async (error) => {
    logCourseFlowError("exam_finalize_api_failed", error, { attemptId, guildId: interaction.guildId, studentId: interaction.user.id });
    finalizeFailureMessage = examFinalizeFailureMessage(error);
    const settings = await context.api.getCourseSettings(interaction.guildId!).catch(() => null);
    if (settings) await sendCourseLog(interaction, settings, `Falha ao finalizar prova\nTentativa: ${attemptId}\nAluno: <@${interaction.user.id}>\nErro: ${errorDetails(error)}`).catch(() => null);
    return null;
  });
  if (!result) {
    await interaction.followUp({ content: finalizeFailureMessage, flags: MessageFlags.Ephemeral });
    return;
  }
  const [course, settings] = await Promise.all([
    context.api.getCourse(interaction.guildId!, result.attempt.courseId),
    context.api.getCourseSettings(interaction.guildId!)
  ]);
  await interaction.message.edit({ components: [] }).catch(() => null);
  logCourseFlow("exam_finalize_saved", { attemptId, courseId: result.attempt.courseId, guildId: interaction.guildId, score: result.attempt.score, percent: result.attempt.percent, answers: result.answers.length });
  const correctionPanelSent = await sendExamCorrectionPanel(interaction, context, course, result.attempt, result.questions, result.answers).catch(async (error) => {
    logCourseFlowError("exam_correction_panel_unhandled_failed", error, { attemptId, courseId: result.attempt.courseId, guildId: interaction.guildId });
    await sendCourseLog(interaction, settings, `Falha inesperada ao enviar painel de correção\nTentativa: ${attemptId}\nCurso: ${course.name}\nErro: ${errorDetails(error)}`).catch(() => null);
    return false;
  });
  await interaction.followUp({
    content: correctionPanelSent
      ? "Prova finalizada. A equipe responsável recebeu o painel de aprovação."
      : "Prova finalizada e salva, mas o painel de aprovação não foi enviado. Verifique o canal de avaliação em /curso config e as permissões do bot.",
    flags: MessageFlags.Ephemeral
  });
  if (!correctionPanelSent) {
    logCourseFlow("exam_correction_panel_not_sent_after_finalize", { attemptId, courseId: result.attempt.courseId, guildId: interaction.guildId });
  }
  const postFinalizeResults = await Promise.allSettled([
    sendExamDetailedLog(interaction, settings, course, result.attempt, result.questions, result.answers),
    context.api.getCoursePublication(interaction.guildId!, result.attempt.publicationId)
      .then((publication) => refreshPublicationMessageByRecord(interaction, context, publication))
  ]);
  for (const failed of postFinalizeResults.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected")) {
    logCourseFlowError("exam_post_finalize_action_failed", failed.reason, { attemptId, courseId: result.attempt.courseId, guildId: interaction.guildId });
    await sendCourseLog(interaction, settings, `Falha em ação pós-finalização\nTentativa: ${attemptId}\nCurso: ${course.name}\nErro: ${errorDetails(failed.reason)}`).catch(() => null);
  }
  if (!correctionPanelSent) return;
  await deleteFinishedExamChannel(interaction, context);
}

async function getStudentExamAttempt(interaction: ButtonInteraction, context: BotContext, attemptId: string) {
  const bundle = await context.api.getCourseExamAttempt(interaction.guildId!, attemptId).catch(() => null);
  if (!bundle || bundle.attempt.studentId !== interaction.user.id || bundle.attempt.status !== "in_progress") {
    await interaction.followUp({ content: "Tentativa de prova inválida para este usuário.", flags: MessageFlags.Ephemeral });
    return null;
  }
  return bundle;
}

async function reviewExam(interaction: ButtonInteraction, context: BotContext) {
  const [, status, attemptId] = interaction.customId.split(":");
  if (!attemptId) {
    await interaction.reply({ content: "Tentativa de prova inválida.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (status !== "approved" && status !== "rejected") {
    await interaction.reply({ content: "Ação de avaliação inválida.", flags: MessageFlags.Ephemeral });
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
  if (!/^\d+(?:\.\d+)?$/.test(rawScore)) {
    await interaction.editReply("Informe uma nota numérica válida, como 0, 0.5 ou 1.0.");
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
    const [course, runtime, courseSettings] = await Promise.all([
      context.api.getCourse(interaction.guildId!, bundle.attempt.courseId),
      context.api.getCourseExamRuntime(interaction.guildId!, bundle.attempt.courseId),
      context.api.getCourseSettings(interaction.guildId!)
    ]);
    await editExamCorrectionPanel(interaction, context, course, courseSettings, runtime.settings, bundle.attempt, bundle.questions, bundle.answers);
    await interaction.editReply("Esta prova já foi corrigida e o painel foi atualizado.");
    return null;
  }
  const reviewed = await context.api.reviewCourseExamAttempt(interaction.guildId!, attemptId, { actorId: interaction.user.id, manualScore, status });
  if (!reviewed) {
    await interaction.editReply("Esta prova já foi corrigida ou não pode mais ser analisada.");
    return null;
  }
  const [course, runtime, courseSettings] = await Promise.all([
    context.api.getCourse(interaction.guildId!, reviewed.courseId),
    context.api.getCourseExamRuntime(interaction.guildId!, reviewed.courseId),
    context.api.getCourseSettings(interaction.guildId!)
  ]);
  const correctionPanelUpdated = await editExamCorrectionPanel(interaction, context, course, courseSettings, runtime.settings, reviewed, bundle.questions, bundle.answers);
  if (!correctionPanelUpdated) {
    await sendCourseLog(interaction, courseSettings, `Falha ao desativar botões do painel de correção\nTentativa: ${attemptId}\nCurso: ${course.name}\nAluno: <@${reviewed.studentId}>`).catch(() => null);
  }
  const resultDelivery = await sendExamResultPanel(interaction, courseSettings, runtime.settings, course, reviewed, bundle.questions, bundle.answers);
  if (resultDelivery.ok && resultDelivery.channelId && resultDelivery.messageId) {
    await context.api.setCourseExamResultDelivery(interaction.guildId!, reviewed.id, { channelId: resultDelivery.channelId, messageId: resultDelivery.messageId }).catch((error) => logCourseFlowError("exam_result_delivery_persist_failed", error, { attemptId: reviewed.id, channelId: resultDelivery.channelId, messageId: resultDelivery.messageId }));
  }
  await sendFinalExamLog(interaction, courseSettings, course, reviewed, bundle.questions, bundle.answers, interaction.user.id);
  await sendCourseLog(interaction, courseSettings, `Prova corrigida\nTentativa: ${attemptId}\nAluno: <@${reviewed.studentId}>\n${examStudentIdentificationSummary(reviewed)}\nResultado: ${status === "approved" ? "Aprovado" : "Reprovado"}\nNota automática: ${formatScore(reviewed.automaticScore ?? reviewed.score)}\nNota manual: ${formatScore(reviewed.manualScore ?? 0)}\nNota final: ${formatScore(reviewed.finalScore ?? reviewed.score)}\nAvaliador: <@${interaction.user.id}>`).catch(() => null);
  const student = await interaction.guild!.members.fetch(reviewed.studentId).catch(() => null);
  await student?.send(examDecisionDm(course, runtime.settings, reviewed, status)).catch(() => null);
  const publication = await context.api.getCoursePublication(interaction.guildId!, reviewed.publicationId).catch(() => null);
  if (publication) await refreshPublicationMessageByRecord(interaction, context, publication);
  return reviewed;
}

async function publishDashboardReviewedExamResult(
  client: Client,
  context: BotContext,
  payload: { actorId?: string | null; attemptId: string; botId?: string | null; courseId: string; guildId: string; status: "approved" | "rejected" }
) {
  const runtimeBotId = (currentRuntimeBotId() ?? env.DASHBOARD_BOT_ID) || null;
  if (payload.botId && runtimeBotId && payload.botId !== runtimeBotId) return;

  const guild = client.guilds.cache.get(payload.guildId) ?? await client.guilds.fetch(payload.guildId).catch(() => null);
  if (!guild) return;

  const bundle = await context.api.getCourseExamAttempt(payload.guildId, payload.attemptId).catch(() => null);
  if (!bundle || bundle.attempt.courseId !== payload.courseId || !bundle.attempt.result) return;

  const [course, runtime, courseSettings] = await Promise.all([
    context.api.getCourse(payload.guildId, payload.courseId),
    context.api.getCourseExamRuntime(payload.guildId, payload.courseId),
    context.api.getCourseSettings(payload.guildId)
  ]);
  const reviewed = bundle.attempt;
  const interaction = { guild, guildId: guild.id } as unknown as ButtonInteraction;

  await editExamCorrectionPanel(interaction, context, course, courseSettings, runtime.settings, reviewed, bundle.questions, bundle.answers);
  const resultDelivery = await sendExamResultPanel(interaction, courseSettings, runtime.settings, course, reviewed, bundle.questions, bundle.answers);
  if (resultDelivery.ok && resultDelivery.channelId && resultDelivery.messageId) {
    await context.api.setCourseExamResultDelivery(payload.guildId, reviewed.id, { channelId: resultDelivery.channelId, messageId: resultDelivery.messageId }).catch((error) => logCourseFlowError("exam_result_delivery_persist_failed", error, { attemptId: reviewed.id, channelId: resultDelivery.channelId, messageId: resultDelivery.messageId }));
  }
  await sendFinalExamLog(interaction, courseSettings, course, reviewed, bundle.questions, bundle.answers, payload.actorId ?? null);
  await sendCourseLog(interaction, courseSettings, `Prova corrigida pela dashboard\nTentativa: ${payload.attemptId}\nAluno: <@${reviewed.studentId}>\n${examStudentIdentificationSummary(reviewed)}\nResultado: ${payload.status === "approved" ? "Aprovado" : "Reprovado"}\nNota automática: ${formatScore(reviewed.automaticScore ?? reviewed.score)}\nNota manual: ${formatScore(reviewed.manualScore ?? 0)}\nNota final: ${formatScore(reviewed.finalScore ?? reviewed.score)}\nAvaliador: ${payload.actorId ? `<@${payload.actorId}>` : "Dashboard"}`).catch(() => null);
  const student = await guild.members.fetch(reviewed.studentId).catch(() => null);
  await student?.send(examDecisionDm(course, runtime.settings, reviewed, payload.status)).catch(() => null);
  const publication = await context.api.getCoursePublication(payload.guildId, reviewed.publicationId).catch(() => null);
  if (publication) await refreshPublicationMessageByRecord(interaction, context, publication);
}

async function refreshPublicationMessage(interaction: ButtonInteraction, context: BotContext, publication: CoursePublication) {
  await refreshPublicationMessageByRecord(interaction, context, publication);
}

async function refreshPublicationMessageByRecord(interaction: { guild: ChatInputCommandInteraction["guild"]; guildId: string | null }, context: BotContext, publication: CoursePublication) {
  const [course, settings, enrollments] = await Promise.all([
    context.api.getCourse(interaction.guildId!, publication.courseId),
    context.api.getCourseSettings(interaction.guildId!),
    context.api.getCoursePublicationEnrollments(interaction.guildId!, publication.id).catch(() => [])
  ]);
  const channel = await interaction.guild?.channels.fetch(publication.channelId).catch(() => null);
  if (!channel?.isTextBased() || !("messages" in channel) || !publication.messageId) return;
  const message = await channel.messages.fetch(publication.messageId).catch(() => null);
  await message?.edit(coursePublicationPanel(course, publication, settings, interaction.guild!, enrollments)).catch(() => null);
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

async function restoreTemporaryExamChannelCleanup(client: Client, context: BotContext) {
  for (const guild of client.guilds.cache.values()) {
    const settings = await context.api.getCourseSettings(guild.id).catch(() => null);
    if (!settings) continue;
    await guild.channels.fetch().catch(() => null);
    for (const channel of guild.channels.cache.values()) {
      if (channel.type !== ChannelType.GuildText) continue;
      const marker = parseCourseExamChannelTopic(channel.topic);
      if (!marker) continue;
      const deleteAt = marker.deleteAt ?? examChannelFallbackDeleteAt(channel, settings);
      scheduleExamChannelDeletion(channel, deleteAt, context);
    }
  }
}

async function manageableCourses(interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction, context: BotContext) {
  return context.api.getManageableCourses(interaction.guildId!, {
    isAdministrator: isGuildOwnerOrAdministrator(interaction),
    roleIds: memberRoleIds(interaction.member),
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

async function canOpenCourseConfig(interaction: CourseActionInteraction, settings: CourseSettings) {
  if (!interaction.guild) return false;
  if (isGuildOwnerOrAdministrator(interaction)) return true;
  const roleIds = memberRoleIds(interaction.member);
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
  const courses = await context.api.getManageableCourses(interaction.guildId!, {
    isAdministrator: isGuildOwnerOrAdministrator(interaction),
    roleIds: memberRoleIds(interaction.member),
    userId: interaction.user.id
  });
  return courses.some((course) => course.id === courseId);
}

async function canReviewExam(interaction: CourseActionInteraction, context: BotContext, attempt: CourseExamAttempt) {
  if (!interaction.guild) return false;
  if (attempt.instructorId === interaction.user.id) return true;
  if (isGuildOwnerOrAdministrator(interaction)) return true;
  const settings = await context.api.getCourseSettings(interaction.guildId!);
  const roleIds = memberRoleIds(interaction.member);
  return settings.evaluatorUserIds.includes(interaction.user.id)
    || settings.adminUserIds.includes(interaction.user.id)
    || settings.managerUserIds.includes(interaction.user.id)
    || settings.evaluatorRoleIds.some((roleId) => roleIds.includes(roleId))
    || settings.adminRoleIds.some((roleId) => roleIds.includes(roleId))
    || settings.managerRoleIds.some((roleId) => roleIds.includes(roleId))
    || await canManageCourse(interaction, context, attempt.courseId);
}

function isGuildOwnerOrAdministrator(interaction: CourseActionInteraction) {
  return interaction.guild?.ownerId === interaction.user.id
    || memberHasPermission(interaction.member, PermissionFlagsBits.Administrator);
}

function memberRoleIds(member: CourseActionInteraction["member"] | GuildMember | null) {
  if (!member || !("roles" in member)) return [];
  if (Array.isArray(member.roles)) return member.roles;
  return member.roles.cache.map((role) => role.id);
}

function memberHasPermission(member: CourseActionInteraction["member"] | GuildMember | null, permission: PermissionResolvable) {
  if (!member || !("permissions" in member) || member.permissions == null) return false;
  const permissions = member.permissions;
  if (typeof (permissions as { has?: unknown }).has === "function") {
    return Boolean((permissions as PermissionsBitField).has(permission));
  }

  try {
    return new PermissionsBitField(BigInt(String(permissions))).has(permission);
  } catch {
    return false;
  }
}

function courseConfigPanel(settings: CourseSettings, panelVisual: PanelVisualConfig | null = null) {
  return renderComponentsV2Panel({
    accentColor: 0x2563eb,
    actions: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(IDS.addCourse).setEmoji(systemComponentEmoji("prancheta_caneta")).setLabel("Cadastrar Curso").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(IDS.editCourse).setEmoji(systemComponentEmoji("engrenagem")).setLabel("Editar Curso").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(IDS.channels).setEmoji(systemComponentEmoji("discord")).setLabel("Canais").setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(IDS.sync).setEmoji(systemComponentEmoji("prancheta_acertos")).setLabel("Provas").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(IDS.departments).setEmoji(systemComponentEmoji("discord")).setLabel("DPs").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(IDS.managers).setEmoji(systemComponentEmoji("homem")).setLabel("Administradores").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(IDS.close).setEmoji(systemComponentEmoji("porta")).setLabel("Fechar").setStyle(ButtonStyle.Danger)
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
    title: `${systemEmojiText("trofeu")} Sistema de Cursos`
  });
}

function publicCoursesPanel(settings: CourseSettings, courses: Course[], panelVisual: PanelVisualConfig | null = null) {
  const activeCourses = courses.filter((course) => course.active);
  return renderComponentsV2Panel({
    accentColor: 0x2563eb,
    actions: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(IDS.publicPublish).setEmoji(systemComponentEmoji("prancheta")).setLabel("Publicar Curso").setStyle(ButtonStyle.Primary)
      )
    ],
    description: "Painel de trabalho dos instrutores. Use /publicar curso ou o botão abaixo para selecionar um curso cadastrado e publicar o painel individual.",
    fields: [
      `**Cursos ativos:** ${activeCourses.length}`,
      activeCourses.slice(0, 12).map((course) => replaceSystemEmojis(`${course.emoji ?? systemEmojiText("trofeu")} ${course.name}`)).join("\n") || "Nenhum curso ativo cadastrado."
    ],
    image: panelVisual || resolveCourseImage(settings, "module") || (settings.globalBannerUrl ? { imageEnabled: true, imagePosition: "top", imageUrl: settings.globalBannerUrl } : null),
    moduleId: "courses",
    title: `${systemEmojiText("trofeu")} Sistema de Cursos`
  });
}

function managersPanel(settings: CourseSettings, message?: string) {
  return renderComponentsV2Panel({
    accentColor: 0x2563eb,
    actions: [
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder().setCustomId(IDS.managerUsers).setPlaceholder("Selecione usuários gestores").setMinValues(0).setMaxValues(10)),
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(new RoleSelectMenuBuilder().setCustomId(IDS.managerRoles).setPlaceholder("Selecione cargos gestores").setMinValues(0).setMaxValues(10)),
      new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(IDS.back).setEmoji(systemComponentEmoji("porta")).setLabel("Voltar").setStyle(ButtonStyle.Secondary))
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

function departmentsPanel(departments: CourseDepartment[], message?: string, selectedId?: string | null) {
  const selected = departments.find((department) => department.id === selectedId) ?? null;
  const visibleDepartments = departments.slice(0, 25);
  const fields = [
    message ? `**${message}**` : "",
    departments.length > 25 ? "**Limite:** há mais de 25 DPs cadastradas. O select do Discord mostra apenas as primeiras 25; reduza ou desative DPs antigas antes de usar no agendamento." : "",
    departments.length
      ? departments.map((department) => `${department.active ? "🟢" : "⚫"} ${department.name}`).slice(0, 20).join("\n")
      : "Nenhuma DP cadastrada.",
    selected ? `Selecionada: **${selected.name}**\nStatus: ${selected.active ? "ativa" : "desativada"}` : ""
  ].filter(Boolean);
  const actions = [
    visibleDepartments.length ? new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(IDS.departmentSelect)
        .setPlaceholder("Selecione uma DP para gerenciar")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(visibleDepartments.map((department) => ({
          default: department.id === selected?.id,
          description: department.active ? "Ativa" : "Desativada",
          label: department.name.slice(0, 100),
          value: department.id
        })))
    ) : null,
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(IDS.departmentAdd).setLabel("Cadastrar DP").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(selected ? `course_department_edit:${selected.id}` : "course_department_edit:none").setLabel("Editar").setStyle(ButtonStyle.Secondary).setDisabled(!selected),
      new ButtonBuilder().setCustomId(selected ? `course_department_toggle:${selected.id}` : "course_department_toggle:none").setLabel(selected?.active ? "Desativar" : "Ativar").setStyle(ButtonStyle.Secondary).setDisabled(!selected),
      new ButtonBuilder().setCustomId(selected ? `course_department_delete:${selected.id}` : "course_department_delete:none").setLabel("Excluir").setStyle(ButtonStyle.Danger).setDisabled(!selected)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(IDS.back).setEmoji(systemComponentEmoji("porta")).setLabel("Voltar").setStyle(ButtonStyle.Secondary)
    )
  ].filter((row): row is ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder> => Boolean(row));
  return renderComponentsV2Panel({
    accentColor: 0x2563eb,
    actions,
    description: "Gerencie as DPs disponíveis no agendamento de cursos.",
    fields,
    moduleId: "courses",
    title: "DPs dos Cursos"
  });
}

function departmentDeleteConfirmationPanel(department: CourseDepartment) {
  return renderComponentsV2Panel({
    accentColor: 0xdc2626,
    actions: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`course_department_delete_confirm:${department.id}`).setLabel("Confirmar exclusão").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(IDS.departmentDeleteCancel).setLabel("Cancelar").setStyle(ButtonStyle.Secondary)
      )
    ],
    description: "Confirme a exclusão da DP. Se ela estiver vinculada a cursos existentes, o sistema irá desativar em vez de apagar para preservar o histórico.",
    fields: [`DP: **${department.name}**`, `Status atual: ${department.active ? "ativa" : "desativada"}`],
    moduleId: "courses",
    title: "Excluir DP"
  });
}

function channelsPanel(settings: CourseSettings, message?: string) {
  const channelSelect = (id: string, placeholder: string, ...types: ChannelType[]) => new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).setChannelTypes(...(types.length ? types : [ChannelType.GuildText, ChannelType.GuildAnnouncement])).setMinValues(1).setMaxValues(1)
  );
  return renderComponentsV2Panel({
    accentColor: 0x2563eb,
    actions: [
      channelSelect(IDS.channelPublish, "Canal padrão de publicação"),
      channelSelect(IDS.channelEvaluation, "Canal de aprovação das provas"),
      channelSelect(IDS.channelProofLogs, "Canal de logs das provas"),
      channelSelect(IDS.channelResult, "Canal de resultados das provas"),
      channelSelect(IDS.channelTempProofCategory, "Categoria de canais temporários", ChannelType.GuildCategory),
      channelSelect(IDS.channelLogs, "Canal de logs administrativos"),
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(new RoleSelectMenuBuilder().setCustomId(IDS.generalInstructorRoles).setPlaceholder("Cargo geral dos instrutores").setMinValues(0).setMaxValues(10)),
      new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(IDS.back).setEmoji(systemComponentEmoji("porta")).setLabel("Voltar").setStyle(ButtonStyle.Secondary))
    ],
    description: "Defina onde os cursos serão publicados, registrados e auditados.",
    fields: [
      message ? `**${message}**` : "",
      `Publicação: ${settings.publishChannelId ? `<#${settings.publishChannelId}>` : "não configurado"}`,
      `Canal de aprovação das provas: ${settings.evaluationChannelId ? `<#${settings.evaluationChannelId}>` : "não configurado"}`,
      `Canal de logs das provas: ${settings.proofLogChannelId ? `<#${settings.proofLogChannelId}>` : "não configurado"}`,
      `Canal de resultados das provas: ${settings.resultChannelId ? `<#${settings.resultChannelId}>` : "não configurado"}`,
      `Categoria de provas: ${settings.tempProofCategoryId ? `<#${settings.tempProofCategoryId}>` : "não configurado"}`,
      `Logs administrativos: ${settings.adminLogChannelId ? `<#${settings.adminLogChannelId}>` : settings.logChannelId ? `<#${settings.logChannelId}>` : "não configurado"}`,
      `Cargos gerais de instrutor: ${settings.generalInstructorRoleIds.map((id) => `<@&${id}>`).join(", ") || "nenhum"}`
    ].filter(Boolean),
    moduleId: "courses",
    title: "Publicação dos Cursos"
  });
}

function responsiblesPanel(course: Course, message: string) {
  return renderComponentsV2Panel({
    accentColor: parseColor(course.color),
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(IDS.back).setEmoji(systemComponentEmoji("porta")).setLabel("Voltar para Configuração de Cursos").setStyle(ButtonStyle.Secondary))],
    description: "Selecione responsáveis pela dashboard em Cursos ou edite o curso no painel web para definir usuários e cargos instrutores.",
    fields: [`**${message}**`, replaceSystemEmojis(`Curso: ${course.emoji ?? systemEmojiText("trofeu")} ${course.name}`)],
    moduleId: "courses",
    title: "Responsáveis pelo curso"
  });
}

function courseEditPanel(course: Course, message: string) {
  return renderComponentsV2Panel({
    accentColor: parseColor(course.color),
    actions: [
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder().setCustomId(`${IDS.courseInstructorUsers}:${course.id}`).setPlaceholder("Selecione instrutores responsáveis").setMinValues(0).setMaxValues(10)),
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(new RoleSelectMenuBuilder().setCustomId(`${IDS.courseInstructorRoles}:${course.id}`).setPlaceholder("Selecione cargos autorizados").setMinValues(0).setMaxValues(10)),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${IDS.editCourseInfo}:${course.id}`).setEmoji(systemComponentEmoji("prancheta_caneta")).setLabel("Editar dados").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(IDS.back).setEmoji(systemComponentEmoji("porta")).setLabel("Voltar").setStyle(ButtonStyle.Secondary)
      )
    ],
    description: "Edite os dados do curso e configure quem pode publicar. Os canais de cursos e provas são definidos somente na Configuração de Canais.",
    fields: [
      `**${message}**`,
      replaceSystemEmojis(`Curso: ${course.emoji ?? systemEmojiText("trofeu")} ${course.name}${course.code ? `\nCódigo: ${course.code}` : ""}`),
      `Local padrão: ${course.location ?? "não configurado"}\nLimite padrão: ${course.maxStudents ?? 30} vaga(s)\nStatus: ${course.active ? "ativo" : "inativo"}`,
      `Instrutores: ${course.instructorUserIds.map((id) => `<@${id}>`).join(", ") || "nenhum"}`,
      `Cargos autorizados: ${course.instructorRoleIds.map((id) => `<@&${id}>`).join(", ") || "nenhum"}`,
      `Cargo geral de instrutor: ${course.allowGeneralInstructorRoles ? "liberado" : "bloqueado"}`
    ],
    image: course.bannerUrl ? { imageEnabled: true, imagePosition: "top", imageUrl: course.bannerUrl } : null,
    moduleId: "courses",
    title: `${systemEmojiText("prancheta_caneta")} Editar Curso`
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

function coursePublicationPanel(course: Course, publication: CoursePublication, settings: CourseSettings, guild: { members: { cache: Map<string, GuildMember> } }, enrollments: CourseEnrollment[] = []) {
  void guild;
  const students = publication.students.map((id, index) => `${index + 1}. <@${id}>`).join("\n") || "Nenhum aluno inscrito ainda.";
  const full = publication.students.length >= publication.capacity;
  const statusText = coursePublicationStatusLabel(publication, full);
  const statusNotice = coursePublicationStatusNotice(course, settings, publication, full);
  const canJoin = publication.status === "open" && !full;
  const canLeave = publication.status === "open";
  const canStartClass = publication.status === "open";
  const canStartExam = publication.status === "started" || publication.status === "proof";
  const canFinishClass = publication.status === "started" || publication.status === "proof";
  const canCancel = !["cancelled", "proof", "finished", "closed"].includes(publication.status);
  const joinAction = buttonRow(new ButtonBuilder().setCustomId(`course_join:${publication.id}`).setLabel("Entrar").setStyle(ButtonStyle.Success).setDisabled(!canJoin));
  const leaveAction = buttonRow(new ButtonBuilder().setCustomId(`course_leave:${publication.id}`).setLabel("Sair").setStyle(ButtonStyle.Secondary).setDisabled(!canLeave));
  const startAction = buttonRow(new ButtonBuilder().setCustomId(`course_start:${publication.id}`).setLabel("Iniciar").setStyle(ButtonStyle.Primary).setDisabled(!canStartClass));
  const examAction = buttonRow(new ButtonBuilder().setCustomId(`course_exam_realize:${publication.id}`).setLabel("Realizar Prova").setStyle(ButtonStyle.Success).setDisabled(!canStartExam));
  const finishAction = buttonRow(new ButtonBuilder().setCustomId(`course_finish:${publication.id}`).setLabel("Finalizar").setStyle(ButtonStyle.Secondary).setDisabled(!canFinishClass));
  const cancelAction = buttonRow(new ButtonBuilder().setCustomId(`course_cancel:${publication.id}`).setLabel("Cancelar").setStyle(ButtonStyle.Danger).setDisabled(!canCancel));
  const examProgress = enrollments
    .filter((enrollment) => ["STARTING", "IN_PROGRESS", "COMPLETED", "APPROVED", "FAILED"].includes(enrollment.examStatus))
    .map((enrollment) => {
      const label = enrollment.examStatus === "APPROVED" ? "Aprovado"
        : enrollment.examStatus === "FAILED" ? "Reprovado"
          : enrollment.examStatus === "COMPLETED" ? "Prova concluída" : "Realizando prova";
      const referenceTime = enrollment.completedAt ?? enrollment.examStartedAt;
      return `• ${enrollment.studentName} — ${label}${referenceTime ? ` — ${new Date(referenceTime).toLocaleString("pt-BR")}` : ""}`;
    });
  const bannerUrl = resolvePanelImageUrl(course.bannerUrl);
  const components: unknown[] = [
    ...(bannerUrl ? [{ type: 12, items: [{ media: { url: bannerUrl }, description: course.name }] }] : []),
    textBlock(`# 📚 ${course.name.toUpperCase()}\n${course.code ? `${course.code} • ` : ""}Curso Oficial`),
    separator(),
    textBlock(`## 📖 Sobre o Curso\n\n${course.publishText || course.description || "Curso disponível para inscrição. Acompanhe o status, entre na lista e aguarde o instrutor iniciar a aula."}`),
    separator(),
    textBlock(`## 📋 Regulamento\n\n${coursePublicationRules(course)}`),
    separator(),
    textBlock([
      "## 📅 Informações",
      "",
      `👤 **Instrutor:** <@${publication.instructorId}>`,
      `🏢 **DP:** ${coursePublicationDepartmentLabel(publication)}`,
      `📅 **Data:** ${coursePublicationDateLabel(publication)}`,
      `🕒 **Horário:** ${coursePublicationTimeLabel(publication)}`,
      `👥 **Vagas:** ${publication.students.length}/${publication.capacity}`,
      `📌 **Status:** ${statusText}`,
      publication.discordEventUrl ? `🔗 **Evento:** ${publication.discordEventUrl}` : null,
      "",
      statusNotice
    ].filter((line): line is string => line !== null).join("\n")),
    separator(),
    textBlock(`## 📝 Observações\n\n${publication.notes || "Sem observações."}`),
    separator(),
    textBlock(`## 👥 Alunos Inscritos\n\n${students}`),
    ...(examProgress.length ? [
      separator(),
      textBlock(`## 🧾 Situação das Provas\n\n${examProgress.join("\n")}\n\n**Em andamento:** ${enrollments.filter((item) => item.examStatus === "STARTING" || item.examStatus === "IN_PROGRESS").length} | **Concluídas:** ${enrollments.filter((item) => ["COMPLETED", "APPROVED", "FAILED"].includes(item.examStatus)).length}`)
    ] : []),
    ...(publication.startedAt || publication.proofStartedAt || publication.finishedAt || publication.status === "cancelled" ? [
      separator(),
      textBlock([
        publication.startedAt ? `🟢 **Início:** ${new Date(publication.startedAt).toLocaleString("pt-BR")} por ${publication.startedBy ? `<@${publication.startedBy}>` : `<@${publication.instructorId}>`}` : null,
        publication.proofStartedAt ? `📝 **Prova liberada:** ${new Date(publication.proofStartedAt).toLocaleString("pt-BR")} por ${publication.proofStartedBy ? `<@${publication.proofStartedBy}>` : `<@${publication.instructorId}>`}` : null,
        publication.finishedAt ? `✅ **Finalização:** ${new Date(publication.finishedAt).toLocaleString("pt-BR")} por ${publication.finishedBy ? `<@${publication.finishedBy}>` : "-"}\n**Duração total:** ${formatCourseDuration(publication.startedAt, publication.finishedAt)}` : null,
        publication.status === "cancelled" ? `🚫 **Cancelamento:** ${publication.cancelledBy ? `<@${publication.cancelledBy}>` : "-"}${publication.cancelledAt ? ` em ${new Date(publication.cancelledAt).toLocaleString("pt-BR")}` : ""}` : null
      ].filter(Boolean).join("\n"))
    ] : []),
    separator(),
    joinAction,
    leaveAction,
    separator(),
    textBlock("## Administração"),
    startAction,
    examAction,
    finishAction,
    cancelAction,
    separator()
  ];
  return componentsV2Payload({
    accentColor: parseColor(course.color),
    components,
    footer: "© NexTech Systems"
  }) as ReturnType<typeof renderComponentsV2Panel>;
}

function textBlock(content: string) {
  return { type: 10, content: content.slice(0, 4000) };
}

function separator() {
  return { type: 14, divider: true, spacing: 1 };
}

function buttonRow(button: ButtonBuilder) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(button).toJSON();
}

function coursePublicationRules(course: Course) {
  const configured = course.proofInstructionText?.trim();
  if (configured) {
    return configured
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 8)
      .map((line) => line.startsWith("•") || line.startsWith("-") ? line : `• ${line}`)
      .join("\n");
  }
  return [
    "• Siga as orientações do instrutor.",
    "• Mantenha sua inscrição ativa no painel.",
    "• Aguarde a liberação da prova quando o curso iniciar."
  ].join("\n");
}

function coursePublicationDateLabel(publication: CoursePublication) {
  if (publication.scheduledStartAt) {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "America/Sao_Paulo",
      year: "numeric"
    }).format(new Date(publication.scheduledStartAt));
  }
  return publication.scheduledFor.trim().split(/\s+/)[0] || publication.scheduledFor || "-";
}

function coursePublicationTimeLabel(publication: CoursePublication) {
  if (publication.scheduledStartAt) {
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      timeZone: "America/Sao_Paulo"
    }).format(new Date(publication.scheduledStartAt));
  }
  return publication.scheduledFor.trim().split(/\s+/)[1] || publication.scheduledFor || "-";
}

function studentExamWelcomePanel(course: Course, publication: CoursePublication, settings: CourseExamSettings, studentId: string, studentName: string, questions: CourseExamQuestion[], disabled = false) {
  const linkButton = settings.externalLinkEnabled && settings.externalLinkUrl
    ? new ButtonBuilder()
      .setLabel(`${settings.externalLinkEmoji ? `${settings.externalLinkEmoji} ` : ""}${settings.externalLinkText || "Acessar material da prova"}`.slice(0, 80))
      .setStyle(ButtonStyle.Link)
      .setURL(settings.externalLinkUrl)
    : null;
  const actions = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`course_exam_begin:${publication.id}:${studentId}`).setEmoji(systemComponentEmoji("acessar")).setLabel("Começar a responder").setStyle(ButtonStyle.Success).setDisabled(disabled)
    )
  ];
  if (linkButton) actions.push(new ActionRowBuilder<ButtonBuilder>().addComponents(linkButton));
  return renderComponentsV2Panel({
    accentColor: parseColor(course.color),
    actions,
    description: course.proofInstructionText || "Sua prova foi liberada em um canal individual. Leia as instruções com atenção e clique em Começar a responder quando estiver pronto.",
    fields: [
      `**Curso:** ${course.name}`,
      `**Aluno:** ${studentName} (<@${studentId}>)`,
      `**Instrutor:** <@${publication.instructorId}>`,
      `**Início:** ${new Date().toLocaleString("pt-BR")}`,
      `**Prova:** Prova de ${course.name}`,
      `**Questões:** ${questions.length}\n**Tempo limite:** ${settings.maxTimeMinutes ? `${settings.maxTimeMinutes} minuto(s)` : "não configurado"}\n**Pontuação total:** ${formatScore(EXAM_TOTAL_SCORE)}\n**Nota mínima:** ${formatScore(settings.minScore)}`,
      settings.externalLinkEnabled && settings.externalLinkDescription ? `**Material:** ${settings.externalLinkDescription}` : "",
      "Respostas enviadas não poderão ser alteradas."
    ].filter(Boolean),
    image: (course.proofBannerUrl || course.bannerUrl) ? { imageEnabled: true, imagePosition: "top", imageUrl: course.proofBannerUrl || course.bannerUrl! } : null,
    moduleId: "courses",
    title: `Avaliativo de ${course.name} — ${studentName}`.slice(0, 256)
  });
}

function examIdentificationPanel(course: Course, publication: CoursePublication, settings: CourseExamSettings, attempt: CourseExamAttempt, studentName: string) {
  void publication;
  void settings;
  const identification = attempt.studentIdentification;
  const completed = Boolean(identification?.rpFullName && identification.currentRank && identification.rpId);
  const actions = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`course_exam_ident_name:${attempt.id}`).setEmoji(systemComponentEmoji("prancheta_caneta")).setLabel(identification?.rpFullName ? "Corrigir nome" : "Informar nome").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`course_exam_ident_id:${attempt.id}`).setEmoji(systemComponentEmoji("homem")).setLabel(identification?.rpId ? "Corrigir ID" : "Informar ID").setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`course_exam_ident_rank:${attempt.id}`)
        .setPlaceholder("Patente atual")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions([
          { label: "Cadet", value: "CADET", default: identification?.currentRank === "CADET" },
          { label: "Officer", value: "OFFICER", default: identification?.currentRank === "OFFICER" },
          { label: "Senior Officer", value: "SENIOR_OFFICER", default: identification?.currentRank === "SENIOR_OFFICER" }
        ])
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`course_exam_ident_confirm:${attempt.id}`).setEmoji(systemComponentEmoji("visto")).setLabel("Confirmar dados").setStyle(ButtonStyle.Success).setDisabled(!completed),
      new ButtonBuilder().setCustomId(`course_exam_ident_correct:${attempt.id}`).setEmoji(systemComponentEmoji("prancheta")).setLabel("Corrigir dados").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`course_exam_ident_cancel:${attempt.id}`).setEmoji(systemComponentEmoji("porta")).setLabel("Cancelar prova").setStyle(ButtonStyle.Danger)
    )
  ];
  return renderComponentsV2Panel({
    accentColor: parseColor(course.color),
    actions,
    description: "Confirme seus dados antes de iniciar as perguntas. Cada etapa é salva automaticamente.",
    fields: [
      `**Nome completo (RP):** ${identification?.rpFullName || "Pendente"}`,
      `**Patente atual:** ${rankLabel(identification?.currentRank)}`,
      `**ID:** ${identification?.rpId || "Pendente"}`,
      `**Usuário:** ${studentName}`,
      `**Curso:** ${course.name}`
    ],
    moduleId: "courses",
    title: "Confirme seus dados"
  });
}

function examReleasePanel(course: Course, settings: CourseExamSettings, attempt: CourseExamAttempt) {
  const scheduled = settings.releaseMode === "scheduled" && settings.releaseAt && Date.parse(settings.releaseAt) > Date.now();
  const instructor = settings.releaseMode === "instructor";
  const disabled = scheduled || instructor;
  const description = scheduled
    ? "Sua identificação foi concluída. Aguarde o horário de início da prova."
    : instructor
      ? "Aguardando liberação do instrutor."
      : "Sua identificação foi concluída. Clique em Iniciar prova quando estiver pronto.";
  return renderComponentsV2Panel({
    accentColor: parseColor(course.color),
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`course_exam_begin:${attempt.publicationId}:${attempt.studentId}`).setEmoji(systemComponentEmoji("acessar")).setLabel("Iniciar prova").setStyle(ButtonStyle.Success).setDisabled(disabled),
      new ButtonBuilder().setCustomId(`course_exam_ident_correct:${attempt.id}`).setEmoji(systemComponentEmoji("prancheta_caneta")).setLabel("Corrigir dados").setStyle(ButtonStyle.Secondary)
    )],
    description,
    fields: [
      `**Curso:** ${course.name}`,
      `**Aluno:** <@${attempt.studentId}>`,
      scheduled ? `**Liberação:** <t:${Math.floor(Date.parse(settings.releaseAt!) / 1000)}:F>` : `**Liberação:** ${settings.releaseMode === "instructor" ? "Instrutor" : "Imediata"}`
    ],
    moduleId: "courses",
    title: "Prova liberada"
  });
}

function rankLabel(rank: "CADET" | "OFFICER" | "SENIOR_OFFICER" | null | undefined) {
  if (rank === "CADET") return "Cadet";
  if (rank === "OFFICER") return "Officer";
  if (rank === "SENIOR_OFFICER") return "Senior Officer";
  return "Pendente";
}

function coursePublicationStatusLabel(publication: CoursePublication, full: boolean) {
  if (publication.status === "open" && full) return `${systemStatusEmoji("warning")} Lotado`;
  const labels: Record<CoursePublication["status"], string> = {
    cancelled: `${systemStatusEmoji("danger")} Cancelado`,
    closed: `${systemStatusEmoji("success")} Encerrado`,
    finished: `${systemStatusEmoji("success")} Finalizado`,
    open: "📅 Agendado",
    proof: `${systemEmojiText("prancheta_caneta")} Prova em andamento`,
    started: "🟢 Curso Iniciado"
  };
  return labels[publication.status];
}

function coursePublicationStatusEmoji(publication: CoursePublication, full: boolean) {
  if (publication.status === "open" && full) return systemStatusEmoji("warning");
  const emojis: Record<CoursePublication["status"], string> = {
    cancelled: systemStatusEmoji("danger"),
    closed: systemStatusEmoji("success"),
    finished: "✅",
    open: "📅",
    proof: systemEmojiText("prancheta_caneta"),
    started: "🟢"
  };
  return emojis[publication.status];
}

function coursePublicationStatusNotice(course: Course, settings: CourseSettings, publication: CoursePublication, full: boolean) {
  if (publication.status === "open" && full) return `${systemStatusEmoji("warning")} **Turma lotada.** Aguarde uma vaga abrir ou uma nova publicação do curso.`;
  if (publication.status === "open") return `📅 **Agendado.** Clique em Entrar no Curso para participar.`;
  if (publication.status === "started") return course.startedText || settings.startedMessage || `🟢 **Curso Iniciado.** Novas inscrições foram bloqueadas. Alunos inscritos já podem clicar em Realizar prova.`;
  if (publication.status === "proof") return `${systemEmojiText("prancheta_caneta")} **Prova disponível.** Alunos inscritos podem clicar em Realizar prova para abrir o canal individual.`;
  if (publication.status === "cancelled") return course.cancelledText || settings.cancelledMessage || `${systemStatusEmoji("danger")} **Curso cancelado.** Esta publicação não aceita novas ações.`;
  return `✅ **Curso Finalizado.** Esta publicação foi encerrada e permanece apenas como histórico.`;
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
  if (question.type === "selection" || question.type === "multiple") {
    await channel.send(selectionQuestionPanel(course, attempt, question, attempt.currentQuestionIndex + 1, questions.length));
    return;
  }
  await channel.send(writtenQuestionPanel(course, attempt, question, attempt.currentQuestionIndex + 1, questions.length));
}

function selectionQuestionPanel(course: Course, attempt: CourseExamAttempt, question: CourseExamQuestion, index: number, total: number) {
  const isMultiple = question.type === "multiple";
  return renderComponentsV2Panel({
    accentColor: parseColor(course.color),
    actions: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`course_exam_answer:${attempt.id}:${index - 1}`)
          .setPlaceholder(isMultiple ? "Selecione uma ou mais alternativas" : "Selecione uma alternativa")
          .setMinValues(1)
          .setMaxValues(isMultiple ? Math.min(MAX_EXAM_SELECT_OPTIONS, question.alternatives.length) : 1)
          .addOptions(question.alternatives.slice(0, MAX_EXAM_SELECT_OPTIONS).map((alternative) => ({
            label: `Alternativa ${alternative.id}`.slice(0, 100),
            value: alternative.id,
            description: alternative.text.slice(0, 100)
          })))
      )
    ],
    description: question.description || "Selecione sua resposta.",
    fields: [
      `Curso: ${course.name}\nQuestão ${index} de ${total}\n${questionScoreLine(question)}`,
      `**${question.prompt}**`,
      question.alternatives.map((alternative) => `( ) ${alternative.text}`).join("\n")
    ],
    moduleId: "courses",
    title: `Questão ${String(index).padStart(2, "0")}`
  });
}

function pendingSelectionQuestionPanel(course: Course, attempt: CourseExamAttempt, question: CourseExamQuestion, index: number, total: number, selectedIds: string[]) {
  return renderComponentsV2Panel({
    accentColor: parseColor(course.color),
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`course_exam_confirm_answer:${attempt.id}:${index - 1}`).setEmoji(systemComponentEmoji("visto")).setLabel("Continuar").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`course_exam_retry:${attempt.id}:${index - 1}`).setEmoji(systemComponentEmoji("voltar")).setLabel("Alterar seleção").setStyle(ButtonStyle.Secondary)
    )],
    description: "Revise sua seleção e confirme para salvar. Depois de confirmada, a resposta não poderá ser alterada.",
    fields: [
      `Curso: ${course.name}\nQuestão ${index} de ${total}\n${questionScoreLine(question)}`,
      `**${question.prompt}**`,
      question.alternatives.map((alternative) => `${selectedIds.includes(alternative.id) ? "(X)" : "( )"} ${alternative.text}`).join("\n")
    ],
    moduleId: "courses",
    title: "Confirmar resposta"
  });
}

function answeredSelectionQuestionPanel(attempt: CourseExamAttempt, question: CourseExamQuestion, index: number, total: number, selectedIds: string[]) {
  void attempt;
  return renderComponentsV2Panel({
    accentColor: 0x16a34a,
    description: "Resposta registrada com sucesso. Continue para a próxima questão.",
    fields: [
      `Pergunta ${index}/${total}\n${questionScoreLine(question)}`,
      `**${question.prompt}**`,
      question.alternatives.map((alternative) => `${selectedIds.includes(alternative.id) ? "(X)" : "( )"} ${alternative.text}`).join("\n")
    ],
    moduleId: "courses",
    title: "Questão Respondida"
  });
}

function writtenQuestionPanel(course: Course, attempt: CourseExamAttempt, question: CourseExamQuestion, index: number, total: number) {
  return renderComponentsV2Panel({
    accentColor: parseColor(course.color),
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`course_exam_written:${attempt.id}:${index - 1}`).setEmoji(systemComponentEmoji("prancheta_caneta")).setLabel("Responder questão").setStyle(ButtonStyle.Success)
    )],
    description: "Abra o modal, envie sua resposta e aguarde a próxima etapa. Depois de enviada, a resposta não poderá ser alterada.",
    fields: [
      `Pergunta ${index}/${total}\n${questionScoreLine(question)}`,
      `**${question.prompt}**`,
      question.description || question.placeholder || "Envie sua resposta em uma mensagem abaixo."
    ],
    moduleId: "courses",
    title: "Questão Discursiva"
  });
}

function answeredWrittenQuestionPanel(attempt: CourseExamAttempt, question: CourseExamQuestion, index: number, total: number) {
  void attempt;
  return renderComponentsV2Panel({
    accentColor: 0x16a34a,
    description: "Resposta registrada com sucesso. Continue para a próxima questão.",
    fields: [
      `Pergunta ${index}/${total}\n${questionScoreLine(question)}`,
      `**${question.prompt}**`
    ],
    moduleId: "courses",
    title: "Questão Respondida"
  });
}

function examFinishPanel(course: Course, settings: CourseExamSettings, attempt: CourseExamAttempt) {
  return renderComponentsV2Panel({
    accentColor: parseColor(course.color),
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`course_exam_finish:${attempt.id}`).setEmoji(systemComponentEmoji("visto")).setLabel("Finalizar Prova").setStyle(ButtonStyle.Success)
    )],
    description: settings.finalMessage,
    fields: [`Curso: ${course.name}`, `Aluno: <@${attempt.studentId}>`],
    moduleId: "courses",
    title: "Prova concluída"
  });
}

async function sendExamCorrectionPanel(interaction: ButtonInteraction, context: BotContext, course: Course, attempt: CourseExamAttempt, questions: CourseExamQuestion[], answers: CourseExamAnswer[]) {
  return upsertExamCorrectionPanel(interaction, context, course, attempt, questions, answers);
}

async function upsertExamCorrectionPanel(interaction: CourseGuildContext, context: BotContext, course: Course, attempt: CourseExamAttempt, questions: CourseExamQuestion[], answers: CourseExamAnswer[]) {
  if (!["finished", "awaiting_review", "manual_reviewed"].includes(attempt.status)) {
    logCourseFlow("exam_correction_panel_skipped_unfinished_attempt", { attemptId: attempt.id, courseId: attempt.courseId, guildId: interaction.guildId, status: attempt.status });
    return false;
  }
  const runtime = await context.api.getCourseExamRuntime(interaction.guildId!, attempt.courseId);
  const courseSettings = await context.api.getCourseSettings(interaction.guildId!);
  const configuredIds = examCorrectionChannelIds(courseSettings, runtime.settings);
  logCourseFlow("exam_correction_channel_lookup", { attemptId: attempt.id, courseId: attempt.courseId, guildId: interaction.guildId, configuredIds });
  const channel = await fetchFirstTextChannel(interaction, configuredIds);
  if (!channel) {
    const diagnostics = await diagnoseTextChannels(interaction, configuredIds);
    logCourseFlow("exam_correction_channel_missing", { attemptId: attempt.id, courseId: attempt.courseId, guildId: interaction.guildId, configuredIds, diagnostics });
    await sendCourseLog(interaction, courseSettings, `Falha ao enviar painel de correção\nTentativa: ${attempt.id}\nCurso: ${course.name}\nAluno: <@${attempt.studentId}>\nCanais configurados: ${configuredIds.map((id) => `<#${id}>`).join(", ") || "nenhum"}\nMotivo: nenhum canal de avaliação válido foi encontrado.\nDiagnóstico: ${diagnostics.join(" | ") || "sem diagnóstico"}`).catch(() => null);
    return false;
  }
  const payload = withRoleMention(examCorrectionPanel(course, attempt, questions, answers, interaction.guild, courseSettings.evaluatorMentionRoleId), courseSettings.evaluatorMentionRoleId);
  if (attempt.correctionMessageId) {
    const existing = await channel.messages.fetch(attempt.correctionMessageId).catch(() => null);
    if (existing) {
      try {
        await existing.edit(payload);
        await context.api.setCourseExamCorrectionDelivery(interaction.guildId!, attempt.id, { channelId: channel.id, messageId: existing.id }).catch((error) => logCourseFlowError("exam_correction_delivery_persist_failed", error, { attemptId: attempt.id, channelId: channel.id, messageId: existing.id }));
        await sendCourseLog(interaction, courseSettings, `Painel de correção atualizado\nTentativa: ${attempt.id}\nCanal: <#${channel.id}>\nMensagem: ${existing.id}\nCurso: ${course.name}\nAluno: <@${attempt.studentId}>`).catch(() => null);
        return true;
      } catch (error) {
        logCourseFlowError("exam_correction_panel_edit_failed", error, { attemptId: attempt.id, channelId: channel.id, messageId: attempt.correctionMessageId });
        await sendCourseLog(interaction, courseSettings, `Falha ao atualizar painel de correção\nTentativa: ${attempt.id}\nCanal: <#${channel.id}>\nMensagem: ${attempt.correctionMessageId}\nErro: ${errorDetails(error)}`).catch(() => null);
        return false;
      }
    }
    await sendCourseLog(interaction, courseSettings, `Painel de correção antigo não encontrado; novo painel não foi recriado automaticamente\nTentativa: ${attempt.id}\nCanal: <#${channel.id}>\nMensagem antiga: ${attempt.correctionMessageId}\nCurso: ${course.name}\nAluno: <@${attempt.studentId}>`).catch(() => null);
    logCourseFlow("exam_correction_panel_not_recreated_missing_existing_message", { attemptId: attempt.id, channelId: channel.id, messageId: attempt.correctionMessageId, courseId: course.id, guildId: interaction.guildId });
    return false;
  }
  if (attempt.correctionSentAt) {
    await sendCourseLog(interaction, courseSettings, `Painel de correção já havia sido enviado; novo painel não foi recriado automaticamente\nTentativa: ${attempt.id}\nCanal: <#${channel.id}>\nCurso: ${course.name}\nAluno: <@${attempt.studentId}>`).catch(() => null);
    logCourseFlow("exam_correction_panel_not_recreated_existing_delivery", { attemptId: attempt.id, channelId: channel.id, courseId: course.id, guildId: interaction.guildId });
    return false;
  }
  const message = await channel.send(payload).catch(async (error) => {
    logCourseFlowError("exam_correction_panel_send_failed", error, { attemptId: attempt.id, channelId: channel.id, courseId: course.id, guildId: interaction.guildId });
    await sendCourseLog(interaction, courseSettings, `Falha ao enviar painel de correção\nTentativa: ${attempt.id}\nCanal: <#${channel.id}>\nCurso: ${course.name}\nErro: ${errorDetails(error)}`).catch(() => null);
    return null;
  });
  if (!message) return false;
  await context.api.setCourseExamCorrectionDelivery(interaction.guildId!, attempt.id, { channelId: channel.id, messageId: message.id }).catch((error) => logCourseFlowError("exam_correction_delivery_persist_failed", error, { attemptId: attempt.id, channelId: channel.id, messageId: message.id }));
  await sendExamQuestionContinuationMessages(channel, interaction, course, attempt, questions, answers, "Correção de Prova - Questões", 12);
  await sendCourseLog(interaction, courseSettings, `Painel de correção enviado\nTentativa: ${attempt.id}\nCanal: <#${channel.id}>\nCurso: ${course.name}\nAluno: <@${attempt.studentId}>`).catch(() => null);
  logCourseFlow("exam_correction_panel_sent", { attemptId: attempt.id, channelId: channel.id, messageId: message.id, courseId: course.id, guildId: interaction.guildId });
  return true;
}

async function editExamCorrectionPanel(interaction: ButtonInteraction | ModalSubmitInteraction, context: BotContext, course: Course, courseSettings: CourseSettings, examSettings: CourseExamSettings, attempt: CourseExamAttempt, questions: CourseExamQuestion[], answers: CourseExamAnswer[]) {
  const payload = examCorrectionPanel(course, attempt, questions, answers, interaction.guild, courseSettings.evaluatorMentionRoleId);
  const sourceMessage = "message" in interaction ? interaction.message : null;
  if (sourceMessage?.editable) {
    const updated = await sourceMessage.edit(payload).then(() => true).catch((error) => {
      logCourseFlowError("exam_correction_source_message_edit_failed", error, { attemptId: attempt.id, messageId: sourceMessage.id });
      return false;
    });
    if (updated) return true;
  }
  if (!attempt.correctionMessageId) return false;
  const channel = await fetchFirstTextChannel(interaction, examCorrectionChannelIds(courseSettings, examSettings));
  const message = await channel?.messages.fetch(attempt.correctionMessageId).catch(() => null);
  if (!message) return false;
  return message.edit(payload).then(() => true).catch((error) => {
    logCourseFlowError("exam_correction_stored_message_edit_failed", error, { attemptId: attempt.id, channelId: channel?.id, messageId: attempt.correctionMessageId });
    return false;
  });
}

async function sendExamResultPanel(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  courseSettings: CourseSettings,
  examSettings: CourseExamSettings,
  course: Course,
  attempt: CourseExamAttempt,
  questions: CourseExamQuestion[] = [],
  answers: CourseExamAnswer[] = []
) {
  const configuredIds = uniqueIds([courseSettings.resultChannelId]);
  logCourseFlow("exam_result_channel_lookup", { attemptId: attempt.id, courseId: course.id, guildId: interaction.guildId, configuredIds });
  if (!configuredIds.length) {
    const message = `Erro ao localizar canal de resultado da prova\nTentativa: ${attempt.id}\nCurso: ${course.name}\nAluno: <@${attempt.studentId}>\nMotivo: nenhum Canal de Aprovação/Resultado das Provas foi configurado.`;
    console.warn(`[courses] ${message.replace(/\n/g, " | ")}`);
    await sendCourseLog(interaction, courseSettings, message).catch(() => null);
    return { ok: false as const };
  }

  const channel = await fetchFirstTextChannel(interaction, configuredIds);
  if (!channel) {
    const diagnostics = await diagnoseTextChannels(interaction, configuredIds);
    const message = `Erro ao localizar canal de resultado da prova\nTentativa: ${attempt.id}\nCurso: ${course.name}\nAluno: <@${attempt.studentId}>\nCanais configurados: ${configuredIds.map((id) => `<#${id}>`).join(", ")}\nMotivo: o bot não encontrou um canal de texto válido ou não possui acesso.`;
    logCourseFlow("exam_result_channel_missing", { attemptId: attempt.id, courseId: course.id, guildId: interaction.guildId, configuredIds, diagnostics });
    await sendCourseLog(interaction, courseSettings, `${message}\nDiagnóstico: ${diagnostics.join(" | ") || "sem diagnóstico"}`).catch(() => null);
    return { ok: false as const };
  }

  await sendCourseLog(interaction, courseSettings, `Canal de aprovação localizado\nTentativa: ${attempt.id}\nCanal: <#${channel.id}>\nCurso: ${course.name}\nAluno: <@${attempt.studentId}>`).catch(() => null);
  const payload = withRoleMention(await examResultPanel(interaction, course, attempt, questions, answers, courseSettings.resultMentionRoleId), courseSettings.resultMentionRoleId);
  const sent = await channel.send(payload).catch(async (error) => {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[courses] failed to send exam result panel ${attempt.id}:`, reason);
    logCourseFlowError("exam_result_panel_send_failed", error, { attemptId: attempt.id, channelId: channel.id, courseId: course.id, guildId: interaction.guildId });
    await sendCourseLog(interaction, courseSettings, `Erro ao enviar painel de resultado\nTentativa: ${attempt.id}\nCanal: <#${channel.id}>\nCurso: ${course.name}\nAluno: <@${attempt.studentId}>\nErro: ${errorDetails(error)}`).catch(() => null);
    return null;
  });
  if (!sent) return { ok: false as const };
  await sendExamQuestionContinuationMessages(channel, interaction, course, attempt, questions, answers, "Resultado da Prova - Questões", 12);
  await sendCourseLog(interaction, courseSettings, `Painel de resultado enviado com sucesso\nTentativa: ${attempt.id}\nCanal: <#${channel.id}>\nCurso: ${course.name}\nAluno: <@${attempt.studentId}>\nNota: ${formatScore(attempt.finalScore ?? attempt.score)}/${formatScore(attempt.maxScore)}\nStatus: ${examReviewStatusLabel(attempt)}`).catch(() => null);
  logCourseFlow("exam_result_panel_sent", { attemptId: attempt.id, channelId: channel.id, messageId: sent.id, courseId: course.id, guildId: interaction.guildId });
  return { ok: true as const, channelId: channel.id, messageId: sent.id };
}

async function examResultPanel(interaction: ButtonInteraction | ModalSubmitInteraction, course: Course, attempt: CourseExamAttempt, questions: CourseExamQuestion[], answers: CourseExamAnswer[], mentionRoleId?: string | null) {
  const member = await interaction.guild?.members.fetch(attempt.studentId).catch(() => null);
  const timestamp = Math.floor(new Date(attempt.correctedAt ?? attempt.finishedAt ?? attempt.updatedAt).getTime() / 1000);
  const finalScore = attempt.finalScore ?? attempt.score;
  const status = examFinalStatusLabel(attempt);
  const totalQuestions = questions.length || answers.length || attempt.objectiveCorrect + attempt.objectiveWrong + attempt.writtenCount;
  const identification = attempt.studentIdentification;
  const answerByQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
  return renderComponentsV2Panel({
    accentColor: examResultAccent(attempt),
    description: "Resultado final da prova avaliada.",
    fields: [
      [
        `Participante: ${member?.displayName ?? `<@${attempt.studentId}>`}`,
        `ID Discord: ${attempt.studentId}`,
        `Nome RP: ${identification?.rpFullName || "não informado"}`,
        `Cargo: ${studentRankLabel(identification?.currentRank)}`,
        `Curso: ${course.name}`,
        `Instrutor: <@${attempt.instructorId}>`,
        `Avaliador: ${attempt.correctedBy && attempt.correctedBy !== "automatic" ? `<@${attempt.correctedBy}>` : "não informado"}`,
        `Cargo notificado: ${mentionRoleId ? `<@&${mentionRoleId}>` : "não configurado"}`,
        `Data/Hora: <t:${timestamp}:F>`
      ].join("\n"),
      [
        `Questões: ${totalQuestions}`,
        `Acertos: ${attempt.objectiveCorrect}`,
        `Erros: ${attempt.objectiveWrong}`,
        `Aproveitamento: ${formatScore(attempt.percent)}%`,
        `Nota: ${formatScore(finalScore)}/${formatScore(attempt.maxScore)}`,
        `Tempo gasto: ${formatExamDuration(attempt.startedAt, attempt.finishedAt)}`,
        `Status: ${status}`
      ].join("\n"),
      ...questions.slice(0, 12).map((question, index) => formatAnswerSummary(question, answerByQuestion.get(question.id), index + 1))
    ],
    guild: interaction.guild,
    image: member ? { imageEnabled: true, imagePosition: "thumbnail", imageUrl: member.displayAvatarURL({ size: 128 }) } : null,
    moduleId: "courses",
    title: "Resultado da Prova"
  });
}

async function showExamResultAnswers(interaction: ButtonInteraction, context: BotContext) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const attemptId = idFromCustomId(interaction.customId);
  const bundle = await context.api.getCourseExamAttempt(interaction.guildId!, attemptId).catch(() => null);
  if (!bundle) {
    await interaction.editReply("Resultado de prova não encontrado.");
    return;
  }
  if (!(await canReviewExam(interaction, context, bundle.attempt))) {
    await interaction.editReply("Você não tem permissão para ver as respostas desta prova.");
    return;
  }
  const course = await context.api.getCourse(interaction.guildId!, bundle.attempt.courseId);
  const answerByQuestion = new Map(bundle.answers.map((answer) => [answer.questionId, answer]));
  const fields = bundle.questions.map((question, index) => formatAnswerSummary(question, answerByQuestion.get(question.id), index + 1));
  await replyWithResultChunks(interaction, course, "Respostas da Prova", `Tentativa: ${bundle.attempt.id}\nAluno: <@${bundle.attempt.studentId}>`, fields);
}

async function showExamResultDetails(interaction: ButtonInteraction, context: BotContext) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const attemptId = idFromCustomId(interaction.customId);
  const bundle = await context.api.getCourseExamAttempt(interaction.guildId!, attemptId).catch(() => null);
  if (!bundle) {
    await interaction.editReply("Resultado de prova não encontrado.");
    return;
  }
  if (!(await canReviewExam(interaction, context, bundle.attempt))) {
    await interaction.editReply("Você não tem permissão para ver os detalhes desta prova.");
    return;
  }
  const course = await context.api.getCourse(interaction.guildId!, bundle.attempt.courseId);
  const attempt = bundle.attempt;
  await interaction.editReply(renderComponentsV2Panel({
    accentColor: examResultAccent(attempt),
    description: "Detalhes persistidos do resultado individual.",
    fields: [
      [
        `Tentativa: ${attempt.id}`,
        `Aluno: <@${attempt.studentId}>`,
        ...examStudentIdentificationLines(attempt),
        `Curso: ${course.name}`,
        `Questões: ${bundle.questions.length}`,
        `Acertos: ${attempt.objectiveCorrect}`,
        `Erros: ${attempt.objectiveWrong}`,
        `Pontuação: ${formatScore(attempt.finalScore ?? attempt.score)}/${formatScore(attempt.maxScore)}`,
        `Aproveitamento: ${formatScore(attempt.percent)}%`,
        `Status: ${examFinalStatusLabel(attempt)}`,
        `Início: <t:${Math.floor(new Date(attempt.startedAt).getTime() / 1000)}:F>`,
        `Fim: ${attempt.finishedAt ? `<t:${Math.floor(new Date(attempt.finishedAt).getTime() / 1000)}:F>` : "-"}`,
        `Tempo gasto: ${formatExamDuration(attempt.startedAt, attempt.finishedAt)}`
      ].join("\n")
    ],
    guild: interaction.guild,
    moduleId: "courses",
    title: "Detalhes da Prova"
  }));
}

async function replyWithResultChunks(interaction: ButtonInteraction, course: Course, title: string, description: string, fields: string[]) {
  const chunks: string[][] = [];
  for (let index = 0; index < fields.length; index += 6) chunks.push(fields.slice(index, index + 6));
  const first = chunks.shift() ?? ["Nenhuma resposta encontrada."];
  await interaction.editReply(renderComponentsV2Panel({
    accentColor: parseColor(course.color),
    description,
    fields: first,
    guild: interaction.guild,
    moduleId: "courses",
    title
  }));
  for (let index = 0; index < chunks.length; index += 1) {
    await interaction.followUp(ephemeral(renderComponentsV2Panel({
      accentColor: parseColor(course.color),
      description: `${description}\nPágina ${index + 2}`,
      fields: chunks[index],
      guild: interaction.guild,
      moduleId: "courses",
      title
    }))).catch(() => null);
  }
}

async function sendExamQuestionContinuationMessages(channel: TextChannel, interaction: CourseGuildContext, course: Course, attempt: CourseExamAttempt, questions: CourseExamQuestion[], answers: CourseExamAnswer[], title: string, startIndex: number) {
  if (questions.length <= startIndex) return;
  const answerByQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
  for (let index = startIndex; index < questions.length; index += 12) {
    const pageQuestions = questions.slice(index, index + 12);
    const page = Math.floor(index / 12) + 1;
    const payload = renderComponentsV2Panel({
      accentColor: parseColor(course.color),
      description: `Tentativa: ${attempt.id}\nAluno: <@${attempt.studentId}>\nPágina ${page}`,
      fields: pageQuestions.map((question, itemIndex) => formatAnswerSummary(question, answerByQuestion.get(question.id), index + itemIndex + 1)),
      guild: interaction.guild,
      moduleId: "courses",
      title
    });
    await channel.send(payload).catch((error) => {
      logCourseFlowError("exam_question_continuation_send_failed", error, { attemptId: attempt.id, channelId: channel.id, courseId: course.id, page });
      return null;
    });
  }
}

async function sendFinalExamLog(interaction: ButtonInteraction | ModalSubmitInteraction, settings: CourseSettings, course: Course, attempt: CourseExamAttempt, questions: CourseExamQuestion[], answers: CourseExamAnswer[], reviewerId: string | null) {
  const channelId = settings.proofLogChannelId || settings.adminLogChannelId || settings.logChannelId;
  if (!channelId) {
    logCourseFlow("exam_final_log_skipped", { attemptId: attempt.id, courseId: course.id, guildId: interaction.guildId, reason: "log_channel_not_configured" });
    return;
  }
  const channel = await fetchTextChannel(interaction, channelId);
  if (!channel) {
    const diagnostics = await diagnoseTextChannels(interaction, [channelId]);
    logCourseFlow("exam_final_log_channel_missing", { attemptId: attempt.id, channelId, courseId: course.id, guildId: interaction.guildId, diagnostics });
    await sendCourseLog(interaction, settings, `Falha ao enviar log final da prova\nTentativa: ${attempt.id}\nCanal configurado: <#${channelId}>\nCurso: ${course.name}\nAluno: <@${attempt.studentId}>\nDiagnóstico: ${diagnostics.join(" | ") || "sem diagnóstico"}`).catch(() => null);
    return;
  }

  const member = await interaction.guild?.members.fetch(attempt.studentId).catch(() => null);
  const reviewerLabel = reviewerId ? `<@${reviewerId}>` : attempt.correctedBy ? `<@${attempt.correctedBy}>` : "Dashboard";
  const timestamp = Math.floor(new Date(attempt.correctedAt ?? attempt.finishedAt ?? attempt.updatedAt).getTime() / 1000);
  const answerByQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
  const payload = renderComponentsV2Panel({
    accentColor: examResultAccent(attempt),
    description: "Resultado final persistido após análise da prova.",
    fields: [
      [
        `Aluno: ${member?.displayName ?? `<@${attempt.studentId}>`} (${attempt.studentId})`,
        `Curso: ${course.name}`,
        `Instrutor: <@${attempt.instructorId}>`,
        `Nota: ${formatScore(attempt.finalScore ?? attempt.score)}/${formatScore(attempt.maxScore)}`,
        `Quantidade de acertos: ${attempt.objectiveCorrect}`,
        `Quantidade de erros: ${attempt.objectiveWrong}`,
        `Status: ${examFinalStatusLabel(attempt)}`,
        `Responsável pela análise: ${reviewerLabel}`,
        `Data: <t:${timestamp}:F>`,
        `Tentativa: ${attempt.id}`
      ].join("\n"),
      ...questions.slice(0, 12).map((question, index) => formatAnswerSummary(question, answerByQuestion.get(question.id), index + 1))
    ],
    guild: interaction.guild,
    moduleId: "courses",
    title: "📋 RESULTADO FINAL DA PROVA"
  });
  const sent = await channel.send(payload).catch((error) => {
    logCourseFlowError("exam_final_log_send_failed", error, { attemptId: attempt.id, channelId: channel.id, courseId: course.id, guildId: interaction.guildId });
    return null;
  });
  if (!sent) return;
  await sendExamQuestionContinuationMessages(channel, interaction, course, attempt, questions, answers, "Resultado Final da Prova - Perguntas", 12);
  logCourseFlow("exam_final_log_sent", { attemptId: attempt.id, channelId: channel.id, messageId: sent.id, courseId: course.id, guildId: interaction.guildId });
}

function examCorrectionPanel(course: Course, attempt: CourseExamAttempt, questions: CourseExamQuestion[], answers: CourseExamAnswer[], guild?: Guild | null, mentionRoleId?: string | null) {
  const reviewed = attempt.result === "approved" || attempt.result === "rejected" || attempt.status === "approved" || attempt.status === "rejected";
  const reviewable = ["finished", "awaiting_review", "manual_reviewed"].includes(attempt.status);
  const finalScore = attempt.finalScore ?? attempt.automaticScore ?? attempt.score;
  const status = reviewed
    ? attempt.result === "approved" || attempt.status === "approved" ? "APROVADO" : "REPROVADO"
    : "Aguardando análise";
  const fields = [
    [
      `Aluno: <@${attempt.studentId}>`,
      `ID Discord: ${attempt.studentId}`,
      `Curso: ${course.name}`,
      `Instrutor: <@${attempt.instructorId}>`,
      `Data/Hora: ${attempt.finishedAt ? `<t:${Math.floor(new Date(attempt.finishedAt).getTime() / 1000)}:F>` : "-"}`,
      `Resultado: Nota ${formatScore(finalScore)}/${formatScore(attempt.maxScore)}`,
      `Acertos: ${attempt.objectiveCorrect}`,
      `Erros: ${attempt.objectiveWrong}`,
      `Status: ${status}`,
      `Avaliadores: ${mentionRoleId ? `<@&${mentionRoleId}>` : "não configurado"}`
    ].join("\n")
  ];
  return renderComponentsV2Panel({
    accentColor: parseColor(course.color),
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`course_exam_review:approved:${attempt.id}`).setLabel("Aprova aluno").setStyle(ButtonStyle.Success).setDisabled(reviewed || !reviewable),
      new ButtonBuilder().setCustomId(`course_exam_review:rejected:${attempt.id}`).setLabel("Reprova aluno").setStyle(ButtonStyle.Danger).setDisabled(reviewed || !reviewable)
    )],
    description: reviewable ? "Aguardando análise da equipe responsável." : "Avaliação já analisada.",
    fields,
    guild,
    moduleId: "courses",
    title: "📚 AVALIAÇÃO DE CURSO"
  });
}

function examCorrectionChannelIds(courseSettings: CourseSettings, examSettings: CourseExamSettings) {
  void examSettings;
  return uniqueIds([
    courseSettings.evaluationChannelId,
    courseSettings.resultChannelId,
    courseSettings.reportChannelId,
    courseSettings.proofLogChannelId,
    courseSettings.adminLogChannelId,
    courseSettings.logChannelId
  ]);
}

function withRoleMention<T extends Record<string, unknown>>(payload: T, roleId: string | null | undefined): T {
  if (!roleId) return payload;
  return {
    ...payload,
    allowedMentions: { roles: [roleId] }
  };
}

function logCourseFlow(stage: string, data: Record<string, unknown>) {
  console.info(`[courses:${stage}]`, data);
}

function logCourseFlowError(stage: string, error: unknown, data: Record<string, unknown>) {
  console.error(`[courses:${stage}]`, {
    ...data,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : null
  });
}

function errorDetails(error: unknown) {
  if (error instanceof Error) return `${error.message}${error.stack ? `\n${error.stack}` : ""}`;
  return String(error);
}

function scheduledEventErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  const details = message.toLowerCase();
  if (code === "50013" || details.includes("missing permissions")) {
    return "O bot não possui permissão para criar eventos. Ative a permissão Criar Eventos no servidor para o cargo do bot.";
  }
  if (code === "30038" || details.includes("maximum number of guild scheduled events")) {
    return "O servidor atingiu o limite de eventos agendados ativos. Encerre ou apague eventos antigos e tente novamente.";
  }
  if (code === "50035" || details.includes("invalid form body")) {
    return `O Discord recusou os dados do evento. Verifique data, horário e DP. Detalhe: ${message}`.slice(0, 900);
  }
  return message.slice(0, 900);
}

function examFinalizeFailureMessage(error: unknown) {
  const details = errorDetails(error).toLowerCase();
  if (details.includes("space quota") || details.includes("writes are blocked") || details.includes("atlaserror")) {
    return "Nao foi possivel salvar a finalizacao da prova porque o banco MongoDB/Atlas esta bloqueando gravacoes por limite de espaco. O painel de aprovacao so sera enviado depois que o banco voltar a aceitar escritas.";
  }
  return "Nao foi possivel salvar a finalizacao da prova agora. O painel de aprovacao nao foi enviado; verifique os logs do bot/backend e tente novamente.";
}

async function fetchTextChannel(interaction: CourseGuildContext, channelId: string | null | undefined) {
  if (!channelId || !interaction.guild) return null;
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) return null;
  const me = interaction.guild.members.me ?? await interaction.guild.members.fetchMe().catch(() => null);
  const permissions = me && "permissionsFor" in channel ? channel.permissionsFor(me) : null;
  if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.SendMessages)) return null;
  return channel as TextChannel;
}

async function diagnoseTextChannels(interaction: CourseGuildContext, channelIds: Array<string | null | undefined>) {
  const diagnostics: string[] = [];
  if (!interaction.guild) return ["guild indisponível"];
  for (const channelId of channelIds.filter(Boolean)) {
    const channel = await interaction.guild.channels.fetch(channelId!).catch((error) => {
      diagnostics.push(`${channelId}: fetch falhou (${error instanceof Error ? error.message : String(error)})`);
      return null;
    });
    if (!channel) {
      if (!diagnostics.some((item) => item.startsWith(`${channelId}:`))) diagnostics.push(`${channelId}: canal não encontrado`);
      continue;
    }
    if (!channel.isTextBased() || !("send" in channel)) {
      diagnostics.push(`${channelId}: canal não é textual enviável (tipo ${channel.type})`);
      continue;
    }
    const me = interaction.guild.members.me ?? await interaction.guild.members.fetchMe().catch(() => null);
    const permissions = me && "permissionsFor" in channel ? channel.permissionsFor(me) : null;
    const missing = permissions
      ? [
        permissions.has(PermissionFlagsBits.ViewChannel) ? null : "ViewChannel",
        permissions.has(PermissionFlagsBits.SendMessages) ? null : "SendMessages",
        permissions.has(PermissionFlagsBits.ReadMessageHistory) ? null : "ReadMessageHistory"
      ].filter(Boolean)
      : [];
    diagnostics.push(`${channelId}: encontrado ${missing.length ? `sem permissões ${missing.join(",")}` : "com permissões básicas"}`);
  }
  if (!channelIds.filter(Boolean).length) diagnostics.push("nenhum ID configurado");
  return diagnostics;
}

async function fetchFirstTextChannel(interaction: CourseGuildContext, channelIds: Array<string | null | undefined>) {
  for (const channelId of channelIds) {
    const channel = await fetchTextChannel(interaction, channelId);
    if (channel) return channel;
  }
  return null;
}

function uniqueIds(ids: Array<string | null | undefined>) {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

function examReviewStatusLabel(attempt: CourseExamAttempt) {
  if (attempt.result === "approved" || attempt.status === "approved") return `${systemStatusEmoji("success")} Aprovado`;
  if (attempt.result === "rejected" || attempt.status === "rejected") return `${systemStatusEmoji("danger")} Reprovado`;
  return "🟡 Aguardando Avaliação";
}

function examFinalStatusLabel(attempt: CourseExamAttempt) {
  if (attempt.result === "approved" || attempt.status === "approved") return `${systemStatusEmoji("success")} APROVADO`;
  if (attempt.result === "rejected" || attempt.status === "rejected") return `${systemStatusEmoji("danger")} REPROVADO`;
  return "AGUARDANDO";
}

function examResultAccent(attempt: CourseExamAttempt) {
  if (attempt.result === "approved" || attempt.status === "approved") return 0x16a34a;
  if (attempt.result === "rejected" || attempt.status === "rejected") return 0xdc2626;
  return 0xfacc15;
}

function examStudentIdentificationLines(attempt: CourseExamAttempt) {
  const identification = attempt.studentIdentification;
  if (!identification) {
    return ["Dados informados: não preenchidos"];
  }

  return [
    "Dados informados:",
    `Nome RP: ${identification.rpFullName || "não informado"}`,
    `Patente: ${studentRankLabel(identification.currentRank)}`,
    `ID: ${identification.rpId || "não informado"}`,
    `Discord: ${identification.discordDisplayName || identification.discordUsername || "não informado"} (${identification.discordUserId})`,
    `Nick no servidor: ${identification.guildNickname || "não informado"}`
  ];
}

function examStudentIdentificationSummary(attempt: CourseExamAttempt) {
  const identification = attempt.studentIdentification;
  if (!identification) return "Dados informados: não preenchidos";
  return `Dados informados: ${identification.rpFullName || "nome não informado"} | Patente: ${studentRankLabel(identification.currentRank)} | ID: ${identification.rpId || "não informado"}`;
}

function studentRankLabel(rank: string | null | undefined) {
  if (rank === "CADET") return "Cadete";
  if (rank === "OFFICER") return "Oficial";
  if (rank === "SENIOR_OFFICER") return "Oficial Sênior";
  return "não informada";
}

function examDecisionDm(course: Course, settings: CourseExamSettings, attempt: CourseExamAttempt, status: "approved" | "rejected") {
  const base = status === "approved"
    ? settings.approvalMessage || `Sua prova do curso "${course.name}" foi aprovada.`
    : settings.rejectionMessage || `Sua prova do curso "${course.name}" foi reprovada.`;
  const lines = [
    base,
    "",
    `Nota: ${formatScore(attempt.finalScore ?? attempt.score)}/${formatScore(attempt.maxScore)}`,
    status === "rejected" ? `Nota mínima: ${formatScore(settings.minScore)}` : null,
    "Responsável pela avaliação: Equipe de Cursos"
  ].filter(Boolean);
  return lines.join("\n");
}

function formatAnswerSummary(question: CourseExamQuestion, answer: CourseExamAnswer | undefined, index: number) {
  if (!answer) {
    return [
      `QUESTÃO ${String(index).padStart(2, "0")}`,
      questionScoreLine(question),
      question.prompt,
      "",
      "Status: aguardando resposta"
    ].join("\n").slice(0, 1900);
  }
  const pointsEarned = Number(answer?.pointsEarned ?? 0);
  const maxScore = Number(answer?.maxScore ?? questionMaxScore(question));
  if (question.type === "written") {
    const status = answer?.correct === true ? "✅ Correta" : answer?.correct === false ? "❌ Incorreta" : "🟡 Correção manual";
    return [
      `QUESTÃO ${String(index).padStart(2, "0")}`,
      questionScoreLine(question),
      question.prompt,
      "",
      `Resposta do aluno: ${answer?.writtenAnswer ? answer.writtenAnswer.slice(0, 900) : "Sem resposta salva."}`,
      `Resposta correta: ${question.correctText || "não configurada"}`,
      `Status: ${status}`,
      `Pontuação obtida: ${formatScore(pointsEarned)} de ${formatScore(maxScore)}`
    ].join("\n").slice(0, 1900);
  }
  const alternatives = answer?.alternativesSnapshot?.length ? answer.alternativesSnapshot : question.alternatives;
  const selectedIds = answer?.selectedAlternativeIds?.length ? answer.selectedAlternativeIds : answer?.selectedAlternativeId ? [answer.selectedAlternativeId] : [];
  const expectedIds = question.correctAlternativeIds?.length ? question.correctAlternativeIds : question.alternatives.filter((alternative) => isExpectedAlternative(question, alternative)).map((alternative) => alternative.id);
  const selectedTexts = alternatives.filter((alternative) => selectedIds.includes(alternative.id)).map((alternative) => alternative.text);
  const expectedTexts = alternatives.filter((alternative) => expectedIds.includes(alternative.id)).map((alternative) => alternative.text);
  const status = answer?.correct ? "✅ Correta" : pointsEarned > 0 && pointsEarned < maxScore ? "🟡 Parcialmente correta" : "❌ Incorreta";
  return [
    `QUESTÃO ${String(index).padStart(2, "0")}`,
    questionScoreLine(question),
    answer?.questionText || question.prompt,
    "",
    `Resposta do aluno: ${selectedTexts.length ? selectedTexts.join(" | ") : "Sem resposta salva."}`,
    `Resposta correta: ${expectedTexts.length ? expectedTexts.join(" | ") : expectedIds.length ? expectedIds.join(", ") : "não configurada"}`,
    `Status: ${status}`,
    `Pontuação obtida: ${formatScore(pointsEarned)} de ${formatScore(maxScore)}`
  ].join("\n").slice(0, 1900);
}

function questionScoreLine(question: CourseExamQuestion) {
  return `Valor da questão: ${formatScore(questionMaxScore(question))} ponto(s)`;
}

function questionMaxScore(question: CourseExamQuestion) {
  if (question.type === "written") return Math.max(0, Number(question.points) || 0);
  const expected = question.alternatives.filter((alternative) => isExpectedAlternative(question, alternative));
  if (!expected.length) return Math.max(0, Number(question.points) || 0);
  if (question.type === "selection") return expected.map((alternative) => alternativeScoreValue(question, alternative)).reduce((highest, score) => score > highest ? score : highest, 0);
  return decimalSum(expected.map((alternative) => alternativeScoreValue(question, alternative)));
}

function alternativeScoreValue(question: CourseExamQuestion, alternative: CourseExamQuestion["alternatives"][number], fallback = Number(question.points) || 0) {
  const score = Number(alternative.score ?? fallback);
  return Math.max(0, Number.isFinite(score) ? score : fallback);
}

function decimalSum(values: unknown[]) {
  const parts = values.map((value) => decimalParts(value));
  const scale = parts.reduce((highest, part) => part.scale > highest ? part.scale : highest, 0);
  const multiplier = (partScale: number) => 10n ** BigInt(scale - partScale);
  const units = parts.reduce((total, part) => total + part.units * multiplier(part.scale), 0n);
  return decimalPartsToNumber({ scale, units });
}

function decimalParts(value: unknown) {
  const text = decimalText(value);
  const negative = text.startsWith("-");
  const unsigned = negative || text.startsWith("+") ? text.slice(1) : text;
  const [integerPart = "0", decimalPart = ""] = unsigned.split(".");
  const digits = `${integerPart.replace(/^0+(?=\d)/, "") || "0"}${decimalPart}`;
  const units = BigInt(digits || "0") * (negative ? -1n : 1n);
  return { scale: decimalPart.length, units };
}

function decimalText(value: unknown) {
  const raw = typeof value === "number"
    ? Number.isFinite(value) ? value.toString() : "0"
    : String(value ?? "0").trim().replace(",", ".");
  if (!/[eE]/.test(raw)) return raw || "0";
  return Number(raw).toFixed(20).replace(/0+$/, "").replace(/\.$/, "");
}

function decimalPartsToNumber(input: { scale: number; units: bigint }) {
  const negative = input.units < 0n;
  const absolute = (negative ? -input.units : input.units).toString().padStart(input.scale + 1, "0");
  if (input.scale === 0) return Number(`${negative ? "-" : ""}${absolute}`);
  const integerPart = absolute.slice(0, -input.scale) || "0";
  const decimalPart = absolute.slice(-input.scale);
  return Number(`${negative ? "-" : ""}${integerPart}.${decimalPart}`);
}

function formatScore(value: number | null | undefined) {
  const score = Number(value ?? 0);
  if (!Number.isFinite(score)) return "0,0";
  return Number.isInteger(score) ? `${score},0` : score.toString().replace(".", ",");
}

function formatExamDuration(startedAt: string, finishedAt: string | null) {
  if (!finishedAt) return "-";
  const seconds = Math.max(0, Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatCourseDuration(startedAt: string | null, finishedAt: string | null) {
  if (!startedAt || !finishedAt) return "-";
  const seconds = Math.max(0, Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

async function sendPublicationLog(interaction: { guild: ChatInputCommandInteraction["guild"]; guildId: string | null }, context: BotContext, publication: CoursePublication, content: string) {
  const settings = await context.api.getCourseSettings(interaction.guildId!);
  await sendCourseLog(interaction, settings, `${content}\nPublicação: ${publication.id}\nCanal: <#${publication.channelId}>`);
}

async function sendExamDetailedLog(interaction: { guild: ChatInputCommandInteraction["guild"] }, settings: CourseSettings, course: Course, attempt: CourseExamAttempt, questions: CourseExamQuestion[], answers: CourseExamAnswer[]) {
  const channelId = settings.proofLogChannelId || settings.adminLogChannelId || settings.logChannelId;
  if (!channelId) return;
  const channel = await interaction.guild?.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) return;
  const answerByQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
  const finishedAt = attempt.finishedAt ? new Date(attempt.finishedAt) : new Date();
  await (channel as TextChannel).send(renderComponentsV2Panel({
    accentColor: parseColor(course.color),
    description: "Log detalhado da prova enviada para avaliação.",
    fields: [
      [
        `Curso: ${course.name}`,
        `ID do curso: ${course.id}`,
        `Instrutor: <@${attempt.instructorId}>`,
        `Participante: <@${attempt.studentId}>`,
        ...examStudentIdentificationLines(attempt),
        `Questões: ${questions.length}`,
        `Questões respondidas: ${answers.length}`,
        `Acertos: ${attempt.objectiveCorrect}`,
        `Erros: ${attempt.objectiveWrong}`,
        `Pontuação: ${formatScore(attempt.score)}/${formatScore(attempt.maxScore)}`,
        `Porcentagem: ${formatScore(attempt.percent)}%`,
        `Resultado: ${examReviewStatusLabel(attempt)}`,
        `Início: <t:${Math.floor(new Date(attempt.startedAt).getTime() / 1000)}:F>`,
        `Finalização: <t:${Math.floor(finishedAt.getTime() / 1000)}:F>`,
        `Tempo utilizado: ${formatExamDuration(attempt.startedAt, attempt.finishedAt)}`,
        `Sessão: ${attempt.id}`,
        `Canal temporário: <#${attempt.channelId}>`
      ].join("\n"),
      ...questions.map((question, index) => formatAnswerSummary(question, answerByQuestion.get(question.id), index + 1)).slice(0, 12)
    ],
    moduleId: "courses",
    title: "Log de Prova"
  })).catch(() => null);
}

async function sendCourseLog(interaction: { guild: ChatInputCommandInteraction["guild"] }, settings: CourseSettings, content: string) {
  const channelId = settings.adminLogChannelId || settings.logChannelId;
  if (!channelId) return;
  const channel = await interaction.guild?.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) return;
  await (channel as TextChannel).send(renderComponentsV2Panel({
    accentColor: 0x2563eb,
    description: content,
    fields: [`Data: ${new Date().toLocaleString("pt-BR")}`],
    moduleId: "courses",
    title: "Log do Sistema de Cursos"
  })).catch(() => null);
}

async function deleteFinishedExamChannel(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.channel || !interaction.channel.isTextBased() || !("permissionOverwrites" in interaction.channel)) return;
  const channel = interaction.channel as TextChannel;
  const deletionTimer = examChannelDeletionTimers.get(channel.id);
  if (deletionTimer) clearTimeout(deletionTimer);
  examChannelDeletionTimers.delete(channel.id);
  examChannelDeletionGenerations.delete(channel.id);
  const stateRetryTimer = examChannelStateRetryTimers.get(channel.id);
  if (stateRetryTimer) clearTimeout(stateRetryTimer);
  examChannelStateRetryTimers.delete(channel.id);
  try {
    await channel.delete("Prova finalizada pelo aluno.");
  } catch (error) {
    if (isUnknownChannelError(error)) return;
    console.error(`[courses] failed to delete finalized exam channel ${channel.id}; scheduling retry:`, error instanceof Error ? error.message : error);
    scheduleExamChannelDeletion(channel, Date.now(), context);
  }
}

async function persistFinishedExamChannelState(channel: TextChannel, studentId: string, topic: string, attempt = 0): Promise<boolean> {
  const results = await Promise.allSettled([
    channel.permissionOverwrites.edit(studentId, { SendMessages: false, ViewChannel: true }),
    channel.setTopic(topic, "Prova finalizada; canal temporário aguardando exclusão.")
  ]);
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (!failures.length) {
    const current = examChannelStateRetryTimers.get(channel.id);
    if (current) clearTimeout(current);
    examChannelStateRetryTimers.delete(channel.id);
    return true;
  }
  if (failures.some((failure) => isUnknownChannelError(failure.reason))) {
    examChannelStateRetryTimers.delete(channel.id);
    return true;
  }

  console.error(`[courses] failed to persist finished state for exam channel ${channel.id}; retrying:`, failures.map((failure) => failure.reason instanceof Error ? failure.reason.message : String(failure.reason)).join("; "));
  const current = examChannelStateRetryTimers.get(channel.id);
  if (current) clearTimeout(current);
  const delay = Math.min(EXAM_CHANNEL_DELETE_RETRY_DELAY * (2 ** Math.min(attempt, 4)), EXAM_CHANNEL_STATE_RETRY_MAX_DELAY);
  const timer = setTimeout(() => {
    void persistFinishedExamChannelState(channel, studentId, topic, attempt + 1);
  }, delay);
  timer.unref();
  examChannelStateRetryTimers.set(channel.id, timer);
  return false;
}

function publicationModal(course: Course, departments: CourseDepartment[], mode: "publicacao" | "agendamento" = "publicacao") {
  return new ModalBuilder()
    .setCustomId(`course_publish_modal:${course.id}`)
    .setTitle(mode === "agendamento" ? "Agendar Curso" : "Publicar Curso")
    .addLabelComponents(
      inputLabel("date", "Data do curso (DD/MM)", TextInputStyle.Short, true, 5),
      inputLabel("time", "Início (HH:mm)", TextInputStyle.Short, true, 40),
      new LabelBuilder()
        .setLabel("DP")
        .setDescription("Selecione a DP onde o curso será realizado")
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId(IDS.publicationDepartmentSelect)
            .setPlaceholder("Selecione uma DP")
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(departments.map((department) => ({
              default: Boolean(course.location && department.name.localeCompare(course.location, "pt-BR", { sensitivity: "accent" }) === 0),
              description: "DP ativa cadastrada para cursos",
              label: department.name.slice(0, 100),
              value: department.id
            })))
        ),
      inputLabel("capacity", "Quantidade de pessoas/vagas", TextInputStyle.Short, true, 10, String(course.maxStudents ?? 30)),
      inputLabel("notes", "Observações", TextInputStyle.Paragraph, false, 900)
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
      inputRow("maxStudents", "Limite padrão de vagas", TextInputStyle.Short, true, 10, String(course.maxStudents ?? 30)),
      inputRow("active", "Curso ativo? Sim/Não", TextInputStyle.Short, true, 3, course.active ? "Sim" : "Não")
    );
}

function inputRow(customId: string, label: string, style: TextInputStyle, required: boolean, maxLength: number, value?: string) {
  const input = new TextInputBuilder().setCustomId(customId).setLabel(label).setStyle(style).setRequired(required).setMaxLength(maxLength);
  if (value) input.setValue(value);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

function inputLabel(customId: string, label: string, style: TextInputStyle, required: boolean, maxLength: number, value?: string) {
  const input = new TextInputBuilder().setCustomId(customId).setStyle(style).setRequired(required).setMaxLength(maxLength);
  if (value) input.setValue(value);
  return new LabelBuilder().setLabel(label).setTextInputComponent(input);
}

function selectedModalStringValue(interaction: ModalSubmitInteraction, customId: string) {
  try {
    const values = interaction.fields.getStringSelectValues(customId);
    return values.length === 1 ? values[0] ?? null : null;
  } catch {
    return null;
  }
}

function courseDepartmentApiErrorMessage(error: unknown) {
  const status = typeof error === "object" && error !== null && "response" in error
    ? (error as { response?: { status?: number; data?: { code?: string; message?: string } } }).response
    : null;
  if (status?.data?.message) return status.data.message;
  if (status?.status === 403) return "Você não possui permissão para gerenciar DPs.";
  if (status?.status === 404) return "DP não encontrada.";
  if (status?.status === 409) return "Não foi possível salvar: já existe uma DP ativa com esse nome ou a DP está indisponível.";
  return "Não foi possível salvar a DP. Tente novamente e verifique os logs.";
}

export function courseExamChannelTopic(publicationId: string, studentId: string) {
  return `${COURSE_EXAM_CHANNEL_TOPIC_PREFIX}:${publicationId}:${studentId}`;
}

export function parseCourseExamChannelTopic(topic: string | null | undefined) {
  if (!topic) return null;
  const [prefix, publicationId, studentId, state, deleteAtRaw] = topic.split(":");
  if (prefix !== COURSE_EXAM_CHANNEL_TOPIC_PREFIX || !publicationId || !studentId) return null;
  const deleteAtSeconds = state === "finished" ? Number(deleteAtRaw) : Number.NaN;
  return {
    deleteAt: Number.isSafeInteger(deleteAtSeconds) && deleteAtSeconds > 0 ? deleteAtSeconds * 1000 : null,
    publicationId,
    state: state === "ready" || state === "finished" ? state : "preparing",
    studentId
  } as const;
}

export function isCourseExamChannelFor(topic: string | null | undefined, publicationId: string, studentId: string) {
  const marker = parseCourseExamChannelTopic(topic);
  return marker?.publicationId === publicationId && marker.studentId === studentId;
}

export function shouldDeferExamChannelDeletion(topic: string | null | undefined, hasActiveAttempt: boolean) {
  return hasActiveAttempt && parseCourseExamChannelTopic(topic)?.state !== "finished";
}

function examChannelExpirationMs(settings: CourseSettings) {
  const configured = Number(settings.defaultExpirationHours ?? DEFAULT_EXAM_CHANNEL_EXPIRATION_HOURS);
  const hours = Number.isFinite(configured) && configured >= 1
    ? Math.min(configured, 720)
    : DEFAULT_EXAM_CHANNEL_EXPIRATION_HOURS;
  return hours * 60 * 60 * 1000;
}

function examChannelFallbackDeleteAt(channel: TextChannel, settings: CourseSettings) {
  return channel.createdTimestamp + examChannelExpirationMs(settings);
}

function examChannelAttemptDeleteAt(channel: TextChannel, settings: CourseSettings, attempt: CourseExamAttempt | null) {
  const referenceTime = attempt ? Date.parse(attempt.finishedAt ?? attempt.updatedAt) : Number.NaN;
  return Number.isFinite(referenceTime)
    ? referenceTime + examChannelExpirationMs(settings)
    : examChannelFallbackDeleteAt(channel, settings);
}

function scheduleExamChannelDeletion(channel: TextChannel, deleteAt: number, context: BotContext) {
  const current = examChannelDeletionTimers.get(channel.id);
  if (current) clearTimeout(current);
  const generation = Symbol(channel.id);
  examChannelDeletionGenerations.set(channel.id, generation);

  const isCurrent = () => examChannelDeletionGenerations.get(channel.id) === generation;
  const scheduleNext = (targetAt: number) => {
    if (!isCurrent()) return;
    const remaining = targetAt - Date.now();
    if (remaining <= 0) {
      examChannelDeletionTimers.delete(channel.id);
      void deleteExamChannelWhenEligible();
      return;
    }
    const timer = setTimeout(() => scheduleNext(targetAt), Math.min(remaining, MAX_EXAM_CHANNEL_TIMER_DELAY));
    timer.unref();
    examChannelDeletionTimers.set(channel.id, timer);
  };

  const retry = (delay: number) => scheduleNext(Date.now() + delay);
  const deleteExamChannelWhenEligible = async () => {
    if (!isCurrent()) return;
    const marker = parseCourseExamChannelTopic(channel.topic);
    if (marker?.state !== "finished") {
      let activeAttempt: CourseExamAttempt | null;
      try {
        activeAttempt = await context.api.getCourseExamAttemptByChannel(channel.guildId, channel.id);
      } catch (error) {
        console.error(`[courses] failed to check active exam attempt for channel ${channel.id}; retrying cleanup:`, error instanceof Error ? error.message : error);
        retry(EXAM_CHANNEL_DELETE_RETRY_DELAY);
        return;
      }
      if (!isCurrent()) return;
      if (shouldDeferExamChannelDeletion(channel.topic, activeAttempt?.status === "in_progress")) {
        retry(EXAM_CHANNEL_ACTIVE_RECHECK_DELAY);
        return;
      }
    }

    try {
      await channel.delete("Prazo do canal temporário de prova encerrado.");
      if (isCurrent()) {
        examChannelDeletionGenerations.delete(channel.id);
        examChannelDeletionTimers.delete(channel.id);
      }
    } catch (error) {
      if (isUnknownChannelError(error)) {
        if (isCurrent()) {
          examChannelDeletionGenerations.delete(channel.id);
          examChannelDeletionTimers.delete(channel.id);
        }
        return;
      }
      console.error(`[courses] failed to delete temporary exam channel ${channel.id}; retrying:`, error instanceof Error ? error.message : error);
      retry(EXAM_CHANNEL_DELETE_RETRY_DELAY);
    }
  };

  scheduleNext(deleteAt);
}

function isUnknownChannelError(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return Number((error as { code: number | string }).code) === 10003;
}

function examChannelName(studentName: string, courseName: string) {
  return `avaliativo-${slugPart(courseName)}-${slugPart(studentName)}`.slice(0, 100);
}

function uniqueExamChannelName(guild: NonNullable<ButtonInteraction["guild"]>, baseName: string, studentId: string) {
  const normalizedBase = baseName.slice(0, 86);
  if (!guild.channels.cache.some((channel) => channel.type === ChannelType.GuildText && channel.name === normalizedBase)) return normalizedBase;
  const withUser = `${normalizedBase}-${studentId.slice(-4)}`.slice(0, 95);
  if (!guild.channels.cache.some((channel) => channel.type === ChannelType.GuildText && channel.name === withUser)) return withUser;
  for (let index = 2; index <= 99; index += 1) {
    const candidate = `${withUser}-${index}`.slice(0, 100);
    if (!guild.channels.cache.some((channel) => channel.type === ChannelType.GuildText && channel.name === candidate)) return candidate;
  }
  return `${withUser}-${Date.now().toString(36).slice(-4)}`.slice(0, 100);
}

function findLegacyExamChannel(guild: NonNullable<ButtonInteraction["guild"]>, publication: CoursePublication, categoryId: string, studentId: string, expectedName: string) {
  if (publication.status !== "proof" || !publication.proofStartedAt) return undefined;
  const proofStartedAt = Date.parse(publication.proofStartedAt);
  if (!Number.isFinite(proofStartedAt)) return undefined;
  const earliestCreatedAt = proofStartedAt - 60_000;
  const latestCreatedAt = proofStartedAt + 6 * 60 * 60 * 1000;
  const normalizedName = expectedName.slice(0, 86);
  const userSuffix = studentId.slice(-4);
  return guild.channels.cache.find((channel): channel is TextChannel => {
    if (channel.type !== ChannelType.GuildText || channel.topic || channel.parentId !== categoryId) return false;
    if (channel.createdTimestamp < earliestCreatedAt || channel.createdTimestamp > latestCreatedAt) return false;
    if (channel.name !== normalizedName && !channel.name.startsWith(`${normalizedName}-${userSuffix}`)) return false;
    return Boolean(channel.permissionOverwrites.cache.get(studentId)?.allow.has(PermissionFlagsBits.ViewChannel));
  });
}

export function examPermissionOverwrites(guild: NonNullable<ButtonInteraction["guild"]>, context: BotContext, publication: CoursePublication, studentId: string) {
  const overwrites = new Map<string, { allow?: bigint[]; deny?: bigint[]; id: string; type: OverwriteType }>();
  const viewSend = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory];
  overwrites.set(guild.roles.everyone.id, { deny: [PermissionFlagsBits.ViewChannel], id: guild.roles.everyone.id, type: OverwriteType.Role });
  for (const id of [studentId, publication.instructorId].filter(Boolean)) {
    overwrites.set(id, { allow: viewSend, id, type: OverwriteType.Member });
  }
  overwrites.set(context.client.user!.id, {
    allow: [...viewSend, PermissionFlagsBits.ManageChannels],
    id: context.client.user!.id,
    type: OverwriteType.Member
  });
  return [...overwrites.values()];
}

function validateRuntimeProof(questions: CourseExamQuestion[]) {
  const ordered = [...questions].sort((a, b) => (a.questionNumber ?? a.order + 1) - (b.questionNumber ?? b.order + 1));
  if (!ordered.length) return { ok: false, message: "A prova precisa ter pelo menos 1 pergunta ativa configurada." };
  for (let index = 0; index < ordered.length; index += 1) {
    const question = ordered[index];
    if (!question?.prompt.trim()) return { ok: false, message: `A pergunta ${index + 1} precisa ter texto configurado.` };
    if (!question.points || question.points <= 0) return { ok: false, message: `A pergunta ${index + 1} precisa ter pontuação configurada.` };
    if (question.type === "selection" || question.type === "multiple") {
      if (question.alternatives.length < 2) return { ok: false, message: `A pergunta ${index + 1} precisa ter pelo menos 2 alternativas.` };
      if (!question.alternatives.some((alternative) => isExpectedAlternative(question, alternative))) return { ok: false, message: `A pergunta ${index + 1} precisa ter uma alternativa correta definida.` };
    }
  }
  return { ok: true, message: "Prova completa." };
}

function isExpectedAlternative(question: CourseExamQuestion, alternative: CourseExamQuestion["alternatives"][number]) {
  return alternative.isCorrect === true
    || Number(alternative.score ?? 0) > 0
    || alternative.id === question.correctAlternativeId
    || question.correctAlternativeIds?.includes(alternative.id);
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

function ephemeralText(content: string) {
  return { content, flags: Number(MessageFlags.Ephemeral) };
}

async function replyDeactivatedPanel(interaction: ButtonInteraction | ChannelSelectMenuInteraction | StringSelectMenuInteraction | UserSelectMenuInteraction | ModalSubmitInteraction) {
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ content: DEACTIVATED_COURSE_PANEL_MESSAGE, flags: MessageFlags.Ephemeral }).catch(() => null);
    return;
  }
  await interaction.reply({ content: DEACTIVATED_COURSE_PANEL_MESSAGE, flags: MessageFlags.Ephemeral }).catch(() => null);
}

function parseColor(value: string | null | undefined) {
  const parsed = Number.parseInt((value ?? "").replace("#", ""), 16);
  return Number.isFinite(parsed) ? parsed : 0x2563eb;
}

function idFromCustomId(customId: string) {
  return customId.split(":")[1] ?? "";
}

function pendingExamSelectionKey(guildId: string, attemptId: string, questionIndex: number) {
  return `${guildId}:${attemptId}:${questionIndex}`;
}

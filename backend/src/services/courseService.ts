import { randomUUID } from "node:crypto";
import { getMongoCollections, type MongoCourse, type MongoCourseImage, type MongoCoursePublication, type MongoCourseReport, type MongoCourseScheduleRequest, type MongoCourseSettings } from "../database/mongo";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoom } from "../realtime/events";

export const COURSES_MODULE_ID = "courses";

export type CourseDashboard = {
  courses: CourseDto[];
  publications: CoursePublicationDto[];
  reports: CourseReportDto[];
  scheduleRequests: CourseScheduleRequestDto[];
  settings: CourseSettingsDto;
  logs: CourseLogDto[];
};

export type CourseSettingsDto = ReturnType<typeof mapSettings>;
export type CourseDto = ReturnType<typeof mapCourse>;
export type CoursePublicationDto = ReturnType<typeof mapPublication>;
export type CourseScheduleRequestDto = ReturnType<typeof mapScheduleRequest>;
export type CourseReportDto = ReturnType<typeof mapReport>;
export type CourseLogDto = ReturnType<typeof mapLog>;
export type CourseImageDto = ReturnType<typeof mapImage>;

export async function getCoursesDashboard(botId: string | null, guildId: string): Promise<CourseDashboard> {
  const collections = await getMongoCollections();
  const settings = await getCourseSettings(botId, guildId);
  const [courses, publications, scheduleRequests, reports, logs] = await Promise.all([
    collections.courses.find(scope(botId, guildId)).sort({ updatedAt: -1 }).toArray(),
    collections.coursePublications.find(scope(botId, guildId)).sort({ createdAt: -1 }).limit(50).toArray(),
    collections.courseScheduleRequests.find(scope(botId, guildId)).sort({ createdAt: -1 }).limit(50).toArray(),
    collections.courseReports.find(scope(botId, guildId)).sort({ createdAt: -1 }).limit(50).toArray(),
    collections.courseLogs.find(scope(botId, guildId)).sort({ createdAt: -1 }).limit(25).toArray()
  ]);

  return {
    courses: courses.map(mapCourse),
    publications: publications.map(mapPublication),
    reports: reports.map(mapReport),
    scheduleRequests: scheduleRequests.map(mapScheduleRequest),
    settings,
    logs: logs.map(mapLog)
  };
}

export async function getCourseSettings(botId: string | null, guildId: string) {
  const { courseSettings } = await getMongoCollections();
  const existing = await courseSettings.findOne(scope(botId, guildId));
  if (existing) return mapSettings(existing);

  const now = new Date();
  const doc: MongoCourseSettings = {
    _id: randomUUID(),
    botId,
    guildId,
    publishChannelId: null,
    scheduleChannelId: null,
    scheduleLogChannelId: null,
    proofLogChannelId: null,
    resultChannelId: null,
    evaluationChannelId: null,
    reportChannelId: null,
    logChannelId: null,
    adminLogChannelId: null,
    temporaryCategoryId: null,
    tempProofCategoryId: null,
    evaluatorMentionRoleId: null,
    resultMentionRoleId: null,
    adminUserIds: [],
    adminRoleIds: [],
    managerUserIds: [],
    managerRoleIds: [],
    generalInstructorRoleIds: [],
    globalInstructorUserIds: [],
    globalInstructorRoleIds: [],
    evaluatorUserIds: [],
    evaluatorRoleIds: [],
    configUserIds: [],
    configRoleIds: [],
    permissionMatrix: {},
    images: [],
    defaultExpirationHours: null,
    noPermissionMessage: "Você não possui permissão para usar este sistema.",
    cancelledMessage: "Curso cancelado.",
    startedMessage: "O curso foi iniciado. Novas entradas estão bloqueadas.",
    globalBannerUrl: null,
    reportImageUrl: null,
    panelMessageId: null,
    lastPanelRequestedAt: null,
    buttonEmojis: {
      cancel: "❌",
      enter: "✅",
      leave: "🚪",
      start: "🚀"
    },
    updatedAt: now,
    updatedBy: null
  };
  await courseSettings.insertOne(doc);
  return mapSettings(doc);
}

export async function saveCourseSettings(botId: string | null, guildId: string, input: Partial<Omit<CourseSettingsDto, "id" | "botId" | "guildId" | "updatedAt">>, actorId: string | null) {
  const { courseSettings } = await getMongoCollections();
  const now = new Date();
  await courseSettings.updateOne(scope(botId, guildId), {
    $set: {
      ...cleanSettings(input),
      updatedAt: now,
      updatedBy: actorId
    },
    $setOnInsert: {
      _id: randomUUID(),
      botId,
      guildId
    }
  }, { upsert: true });
  await logCourseAction(botId, guildId, "course.settings_saved", actorId, null, null, input);
  emitRealtime("courses:settings", { botId, guildId });
  return getCourseSettings(botId, guildId);
}

export async function requestCoursePanelPublish(botId: string, guildId: string, actorId: string | null) {
  const settings = await getCourseSettings(botId, guildId);
  if (!settings.publishChannelId) throw new Error("Configure o canal de publicação dos cursos.");

  const { courseSettings } = await getMongoCollections();
  const requestedAt = new Date();
  await courseSettings.updateOne(scope(botId, guildId), {
    $set: {
      lastPanelRequestedAt: requestedAt,
      updatedAt: requestedAt,
      updatedBy: actorId
    },
    $setOnInsert: {
      _id: randomUUID(),
      botId,
      guildId
    }
  }, { upsert: true });

  const nextSettings = await getCourseSettings(botId, guildId);
  emitRealtimeToRoom(devBotRealtimeRoom(botId), "courses:panel_publish", { botId, guildId, settings: nextSettings });
  await logCourseAction(botId, guildId, "course.panel_publish_requested", actorId, null, null, { channelId: nextSettings.publishChannelId });
  return nextSettings;
}

export async function updateCoursePanelMessage(botId: string | null, guildId: string, messageId: string | null) {
  const { courseSettings } = await getMongoCollections();
  await courseSettings.updateOne(scope(botId, guildId), { $set: { panelMessageId: messageId, updatedAt: new Date() } });
  return getCourseSettings(botId, guildId);
}

export async function createCourse(botId: string | null, guildId: string, input: Partial<CourseDto> & { name: string }, actorId: string | null) {
  const { courses } = await getMongoCollections();
  const now = new Date();
  const doc: MongoCourse = {
    _id: randomUUID(),
    botId,
    guildId,
    name: input.name.trim(),
    code: input.code?.trim() || null,
    description: input.description?.trim() || null,
    emoji: input.emoji?.trim() || null,
    color: input.color || "#2563eb",
    bannerUrl: input.bannerUrl || null,
    proofBannerUrl: input.proofBannerUrl || null,
    footerImageUrl: input.footerImageUrl || null,
    thumbnailUrl: input.thumbnailUrl || null,
    imagePosition: input.imagePosition ?? "top",
    publishText: input.publishText || null,
    proofInstructionText: input.proofInstructionText || null,
    startedText: input.startedText || null,
    cancelledText: input.cancelledText || null,
    buttonLabels: {
      cancel: input.buttonLabels?.cancel || "Cancelar Curso",
      enter: input.buttonLabels?.enter || "Entrar no Curso",
      leave: input.buttonLabels?.leave || "Sair do Curso",
      start: input.buttonLabels?.start || "Iniciar Curso"
    },
    instructorUserIds: input.instructorUserIds ?? [],
    instructorRoleIds: input.instructorRoleIds ?? [],
    allowGeneralInstructorRoles: input.allowGeneralInstructorRoles ?? true,
    publishChannelId: input.publishChannelId || null,
    maxStudents: Math.max(1, Number(input.maxStudents ?? 30) || 30),
    location: input.location || null,
    defaultSchedule: input.defaultSchedule || null,
    active: input.active ?? true,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: now,
    updatedAt: now
  };
  await courses.insertOne(doc);
  await logCourseAction(botId, guildId, "course.created", actorId, doc._id, null, { name: doc.name });
  emitRealtime("courses:changed", { botId, guildId, courseId: doc._id });
  return mapCourse(doc);
}

export async function updateCourse(botId: string | null, guildId: string, courseId: string, input: Partial<CourseDto>, actorId: string | null) {
  const { courses } = await getMongoCollections();
  await courses.updateOne({ _id: courseId, ...scope(botId, guildId) }, {
    $set: {
      ...cleanCourse(input),
      updatedBy: actorId,
      updatedAt: new Date()
    }
  });
  const course = await courses.findOne({ _id: courseId, ...scope(botId, guildId) });
  if (!course) return null;
  await logCourseAction(botId, guildId, "course.updated", actorId, courseId, null, input);
  emitRealtime("courses:changed", { botId, guildId, courseId });
  return mapCourse(course);
}

export async function deleteCourse(botId: string | null, guildId: string, courseId: string, actorId: string | null) {
  const { courses } = await getMongoCollections();
  const course = await courses.findOneAndDelete({ _id: courseId, ...scope(botId, guildId) });
  if (!course) return null;
  await logCourseAction(botId, guildId, "course.deleted", actorId, courseId, null, { name: course.name });
  emitRealtime("courses:changed", { botId, guildId, courseId });
  return mapCourse(course);
}

export async function getManageableCourses(botId: string | null, guildId: string, userId: string, roleIds: string[], isAdministrator = false) {
  const settings = await getCourseSettings(botId, guildId);
  const { courses } = await getMongoCollections();
  const all = await courses.find({ ...scope(botId, guildId), active: true }).sort({ name: 1 }).toArray();

  if (isAdministrator || isCourseManager(settings, userId, roleIds)) {
    return all.map(mapCourse);
  }

  return all
    .filter((course) => course.instructorUserIds.includes(userId)
      || course.instructorRoleIds.some((roleId) => roleIds.includes(roleId))
      || (course.allowGeneralInstructorRoles !== false && (settings.generalInstructorRoleIds ?? []).some((roleId) => roleIds.includes(roleId))))
    .map(mapCourse);
}

export async function getCourse(botId: string | null, guildId: string, courseId: string) {
  const { courses } = await getMongoCollections();
  const course = await courses.findOne({ _id: courseId, ...scope(botId, guildId) });
  return course ? mapCourse(course) : null;
}

export async function createCoursePublication(botId: string | null, guildId: string, input: {
  capacity: number;
  channelId: string;
  courseId: string;
  instructorId: string;
  location: string;
  notes?: string | null;
  scheduledFor: string;
}) {
  const { coursePublications } = await getMongoCollections();
  const now = new Date();
  const doc: MongoCoursePublication = {
    _id: randomUUID(),
    botId,
    guildId,
    courseId: input.courseId,
    channelId: input.channelId,
    messageId: null,
    instructorId: input.instructorId,
    location: input.location,
    scheduledFor: input.scheduledFor,
    capacity: Math.max(1, input.capacity),
    students: [],
    notes: input.notes || null,
    status: "open",
    cancelledBy: null,
    cancelledAt: null,
    startedAt: null,
    proofStartedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now
  };
  await coursePublications.insertOne(doc);
  await logCourseAction(botId, guildId, "course.published", input.instructorId, input.courseId, doc._id, input);
  emitRealtime("courses:publication", { botId, guildId, publicationId: doc._id });
  return mapPublication(doc);
}

export async function updateCoursePublicationMessage(botId: string | null, guildId: string, publicationId: string, messageId: string | null) {
  const { coursePublications } = await getMongoCollections();
  await coursePublications.updateOne({ _id: publicationId, ...scope(botId, guildId) }, { $set: { messageId, updatedAt: new Date() } });
  const publication = await coursePublications.findOne({ _id: publicationId, ...scope(botId, guildId) });
  return publication ? mapPublication(publication) : null;
}

export async function getCoursePublication(botId: string | null, guildId: string, publicationId: string) {
  const { coursePublications } = await getMongoCollections();
  const publication = await coursePublications.findOne({ _id: publicationId, ...scope(botId, guildId) });
  return publication ? mapPublication(publication) : null;
}

export async function listCoursePublications(botId: string | null, guildId: string, status?: MongoCoursePublication["status"] | null) {
  const { coursePublications } = await getMongoCollections();
  const query = {
    ...scope(botId, guildId),
    ...(status ? { status } : {})
  };
  const publications = await coursePublications.find(query).sort({ createdAt: -1 }).limit(50).toArray();
  return publications.map(mapPublication);
}

export async function joinCoursePublication(botId: string | null, guildId: string, publicationId: string, userId: string) {
  const { coursePublications } = await getMongoCollections();
  const publication = await coursePublications.findOne({ _id: publicationId, ...scope(botId, guildId) });
  if (!publication) return { error: "not_found" as const };
  if (publication.status === "started") return { error: "started" as const, publication: mapPublication(publication) };
  if (publication.status !== "open") return { error: "closed" as const, publication: mapPublication(publication) };
  if (publication.students.includes(userId)) return { error: "already" as const, publication: mapPublication(publication) };
  if (publication.students.length >= publication.capacity) return { error: "full" as const, publication: mapPublication(publication) };
  await coursePublications.updateOne({ _id: publicationId, ...scope(botId, guildId) }, { $addToSet: { students: userId }, $set: { updatedAt: new Date() } });
  const updated = await coursePublications.findOne({ _id: publicationId, ...scope(botId, guildId) });
  await logCourseAction(botId, guildId, "course.student_joined", userId, publication.courseId, publicationId, { userId });
  emitRealtime("courses:publication", { botId, guildId, publicationId });
  return { publication: mapPublication(updated ?? publication) };
}

export async function leaveCoursePublication(botId: string | null, guildId: string, publicationId: string, userId: string) {
  const { coursePublications } = await getMongoCollections();
  const publication = await coursePublications.findOne({ _id: publicationId, ...scope(botId, guildId) });
  if (!publication) return { error: "not_found" as const };
  if (!publication.students.includes(userId)) return { error: "not_joined" as const, publication: mapPublication(publication) };
  await coursePublications.updateOne({ _id: publicationId, ...scope(botId, guildId) }, { $pull: { students: userId }, $set: { updatedAt: new Date() } });
  const updated = await coursePublications.findOne({ _id: publicationId, ...scope(botId, guildId) });
  await logCourseAction(botId, guildId, "course.student_left", userId, publication.courseId, publicationId, { userId });
  emitRealtime("courses:publication", { botId, guildId, publicationId });
  return { publication: mapPublication(updated ?? publication) };
}

export async function setCoursePublicationStatus(botId: string | null, guildId: string, publicationId: string, status: "started" | "cancelled" | "closed" | "proof" | "finished", actorId: string) {
  const { coursePublications } = await getMongoCollections();
  const publication = await coursePublications.findOne({ _id: publicationId, ...scope(botId, guildId) });
  if (!publication) return null;
  const now = new Date();
  await coursePublications.updateOne({ _id: publicationId, ...scope(botId, guildId) }, {
    $set: {
      cancelledAt: status === "cancelled" ? now : publication.cancelledAt,
      cancelledBy: status === "cancelled" ? actorId : publication.cancelledBy,
      startedAt: status === "started" ? now : publication.startedAt ?? null,
      proofStartedAt: status === "proof" ? now : publication.proofStartedAt ?? null,
      finishedAt: status === "finished" || status === "closed" ? now : publication.finishedAt ?? null,
      status,
      updatedAt: now
    }
  });
  const updated = await coursePublications.findOne({ _id: publicationId, ...scope(botId, guildId) });
  await logCourseAction(botId, guildId, `course.${status}`, actorId, publication.courseId, publicationId, { from: publication.status, to: status });
  emitRealtime("courses:publication", { botId, guildId, publicationId });
  return mapPublication(updated ?? publication);
}

export async function createScheduleRequest(botId: string | null, guildId: string, input: {
  courseId: string;
  instructorId: string;
  requestedDate: string;
  requestedTime: string;
  location: string;
  notes?: string | null;
  channelId?: string | null;
}) {
  const { courseScheduleRequests } = await getMongoCollections();
  const now = new Date();
  const doc: MongoCourseScheduleRequest = {
    _id: randomUUID(),
    botId,
    guildId,
    courseId: input.courseId,
    instructorId: input.instructorId,
    requestedDate: input.requestedDate,
    requestedTime: input.requestedTime,
    location: input.location,
    notes: input.notes || null,
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    channelId: input.channelId ?? null,
    messageId: null,
    createdAt: now,
    updatedAt: now
  };
  await courseScheduleRequests.insertOne(doc);
  await logCourseAction(botId, guildId, "course.schedule_requested", input.instructorId, input.courseId, null, input);
  emitRealtime("courses:schedule", { botId, guildId, requestId: doc._id });
  return mapScheduleRequest(doc);
}

export async function updateScheduleRequest(botId: string | null, guildId: string, requestId: string, input: Partial<Pick<MongoCourseScheduleRequest, "messageId" | "status" | "decidedBy" | "decidedAt">>) {
  const { courseScheduleRequests } = await getMongoCollections();
  await courseScheduleRequests.updateOne({ _id: requestId, ...scope(botId, guildId) }, { $set: { ...input, updatedAt: new Date() } });
  const request = await courseScheduleRequests.findOne({ _id: requestId, ...scope(botId, guildId) });
  if (!request) return null;
  if (input.status) await logCourseAction(botId, guildId, `course.schedule_${input.status}`, input.decidedBy ?? null, request.courseId, null, { requestId });
  emitRealtime("courses:schedule", { botId, guildId, requestId });
  return mapScheduleRequest(request);
}

export async function getScheduleRequest(botId: string | null, guildId: string, requestId: string) {
  const { courseScheduleRequests } = await getMongoCollections();
  const request = await courseScheduleRequests.findOne({ _id: requestId, ...scope(botId, guildId) });
  return request ? mapScheduleRequest(request) : null;
}

export async function createCourseReport(botId: string | null, guildId: string, input: {
  channelId?: string | null;
  courseId: string;
  instructorId: string;
  messageId?: string | null;
  reportDate: string;
  reportTime: string;
  students: MongoCourseReport["students"];
}) {
  const { courseReports } = await getMongoCollections();
  const doc: MongoCourseReport = {
    _id: randomUUID(),
    botId,
    guildId,
    courseId: input.courseId,
    instructorId: input.instructorId,
    reportDate: input.reportDate,
    reportTime: input.reportTime,
    students: input.students,
    channelId: input.channelId ?? null,
    messageId: input.messageId ?? null,
    createdAt: new Date()
  };
  await courseReports.insertOne(doc);
  await logCourseAction(botId, guildId, "course.report_created", input.instructorId, input.courseId, null, { students: input.students.length });
  emitRealtime("courses:report", { botId, guildId, reportId: doc._id });
  return mapReport(doc);
}

export function isCourseManager(settings: CourseSettingsDto, userId: string, roleIds: string[]) {
  return settings.adminUserIds.includes(userId)
    || settings.managerUserIds.includes(userId)
    || settings.configUserIds.includes(userId)
    || settings.adminRoleIds.some((roleId) => roleIds.includes(roleId))
    || settings.managerRoleIds.some((roleId) => roleIds.includes(roleId))
    || settings.configRoleIds.some((roleId) => roleIds.includes(roleId));
}

export function hasCourseModulePermission(settings: CourseSettingsDto, userId: string, roleIds: string[], permission: string) {
  if (isCourseManager(settings, userId, roleIds)) return true;
  const rule = settings.permissionMatrix?.[permission];
  if (!rule) return false;
  return rule.userIds.includes(userId) || rule.roleIds.some((roleId) => roleIds.includes(roleId));
}

export async function logCourseAction(botId: string | null, guildId: string, action: string, actorId: string | null, courseId: string | null, publicationId: string | null, data: Record<string, unknown>) {
  const { courseLogs } = await getMongoCollections();
  await courseLogs.insertOne({
    _id: randomUUID(),
    botId,
    guildId,
    action,
    actorId,
    courseId,
    publicationId,
    data,
    createdAt: new Date()
  });
}

function mapSettings(settings: MongoCourseSettings) {
  const images = settings.images ?? [];
  return {
    id: settings._id,
    botId: settings.botId,
    guildId: settings.guildId,
    publishChannelId: settings.publishChannelId,
    scheduleChannelId: settings.scheduleChannelId,
    scheduleLogChannelId: settings.scheduleLogChannelId ?? settings.scheduleChannelId,
    proofLogChannelId: settings.proofLogChannelId ?? settings.logChannelId,
    resultChannelId: settings.resultChannelId ?? settings.reportChannelId,
    evaluationChannelId: settings.evaluationChannelId ?? settings.reportChannelId,
    reportChannelId: settings.reportChannelId,
    logChannelId: settings.logChannelId,
    adminLogChannelId: settings.adminLogChannelId ?? settings.logChannelId,
    temporaryCategoryId: settings.temporaryCategoryId,
    tempProofCategoryId: settings.tempProofCategoryId ?? settings.temporaryCategoryId,
    evaluatorMentionRoleId: settings.evaluatorMentionRoleId ?? null,
    resultMentionRoleId: settings.resultMentionRoleId ?? null,
    adminUserIds: settings.adminUserIds ?? [],
    adminRoleIds: settings.adminRoleIds ?? [],
    managerUserIds: settings.managerUserIds ?? [],
    managerRoleIds: settings.managerRoleIds ?? [],
    generalInstructorRoleIds: settings.generalInstructorRoleIds ?? [],
    globalInstructorUserIds: settings.globalInstructorUserIds ?? [],
    globalInstructorRoleIds: settings.globalInstructorRoleIds ?? settings.generalInstructorRoleIds ?? [],
    evaluatorUserIds: settings.evaluatorUserIds ?? [],
    evaluatorRoleIds: settings.evaluatorRoleIds ?? [],
    configUserIds: settings.configUserIds ?? [],
    configRoleIds: settings.configRoleIds ?? [],
    permissionMatrix: settings.permissionMatrix ?? {},
    images: images.map(mapImage),
    defaultExpirationHours: settings.defaultExpirationHours ?? null,
    noPermissionMessage: settings.noPermissionMessage,
    cancelledMessage: settings.cancelledMessage,
    startedMessage: settings.startedMessage,
    globalBannerUrl: settings.globalBannerUrl ?? null,
    reportImageUrl: settings.reportImageUrl ?? null,
    panelMessageId: settings.panelMessageId ?? null,
    lastPanelRequestedAt: settings.lastPanelRequestedAt?.toISOString() ?? null,
    buttonEmojis: settings.buttonEmojis,
    updatedAt: settings.updatedAt.toISOString()
  };
}

function mapCourse(course: MongoCourse) {
  return {
    id: course._id,
    botId: course.botId,
    guildId: course.guildId,
    name: course.name,
    code: course.code ?? null,
    description: course.description,
    emoji: course.emoji,
    color: course.color,
    bannerUrl: course.bannerUrl,
    proofBannerUrl: course.proofBannerUrl ?? null,
    footerImageUrl: course.footerImageUrl,
    thumbnailUrl: course.thumbnailUrl,
    imagePosition: course.imagePosition,
    publishText: course.publishText,
    proofInstructionText: course.proofInstructionText ?? null,
    startedText: course.startedText,
    cancelledText: course.cancelledText,
    buttonLabels: course.buttonLabels,
    instructorUserIds: course.instructorUserIds,
    instructorRoleIds: course.instructorRoleIds,
    allowGeneralInstructorRoles: course.allowGeneralInstructorRoles ?? true,
    publishChannelId: course.publishChannelId ?? null,
    maxStudents: course.maxStudents ?? 30,
    location: course.location ?? null,
    defaultSchedule: course.defaultSchedule ?? null,
    active: course.active,
    createdBy: course.createdBy,
    updatedBy: course.updatedBy ?? null,
    createdAt: course.createdAt.toISOString(),
    updatedAt: course.updatedAt.toISOString()
  };
}

function mapPublication(publication: MongoCoursePublication) {
  return {
    id: publication._id,
    botId: publication.botId,
    guildId: publication.guildId,
    courseId: publication.courseId,
    channelId: publication.channelId,
    messageId: publication.messageId,
    instructorId: publication.instructorId,
    location: publication.location,
    scheduledFor: publication.scheduledFor,
    capacity: publication.capacity,
    students: publication.students,
    notes: publication.notes,
    status: publication.status,
    cancelledBy: publication.cancelledBy,
    cancelledAt: publication.cancelledAt?.toISOString() ?? null,
    startedAt: publication.startedAt?.toISOString() ?? null,
    proofStartedAt: publication.proofStartedAt?.toISOString() ?? null,
    finishedAt: publication.finishedAt?.toISOString() ?? null,
    createdAt: publication.createdAt.toISOString(),
    updatedAt: publication.updatedAt.toISOString()
  };
}

function mapScheduleRequest(request: MongoCourseScheduleRequest) {
  return {
    id: request._id,
    botId: request.botId,
    guildId: request.guildId,
    courseId: request.courseId,
    instructorId: request.instructorId,
    requestedDate: request.requestedDate,
    requestedTime: request.requestedTime,
    location: request.location,
    notes: request.notes,
    status: request.status,
    decidedBy: request.decidedBy,
    decidedAt: request.decidedAt?.toISOString() ?? null,
    channelId: request.channelId,
    messageId: request.messageId,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString()
  };
}

function mapReport(report: MongoCourseReport) {
  return {
    id: report._id,
    botId: report.botId,
    guildId: report.guildId,
    courseId: report.courseId,
    instructorId: report.instructorId,
    reportDate: report.reportDate,
    reportTime: report.reportTime,
    students: report.students,
    channelId: report.channelId,
    messageId: report.messageId,
    createdAt: report.createdAt.toISOString()
  };
}

function mapLog(log: { _id: string; action: string; actorId: string | null; courseId: string | null; publicationId: string | null; data: Record<string, unknown>; createdAt: Date }) {
  return {
    id: log._id,
    action: log.action,
    type: (log as { type?: string }).type ?? log.action,
    actorId: log.actorId,
    authorId: (log as { authorId?: string | null }).authorId ?? log.actorId,
    targetId: (log as { targetId?: string | null }).targetId ?? null,
    courseId: log.courseId,
    publicationId: log.publicationId,
    sessionId: (log as { sessionId?: string | null }).sessionId ?? null,
    channelId: (log as { channelId?: string | null }).channelId ?? null,
    status: (log as { status?: string | null }).status ?? null,
    data: log.data,
    metadata: (log as { metadata?: Record<string, unknown> }).metadata ?? log.data,
    createdAt: log.createdAt.toISOString()
  };
}

function mapImage(image: MongoCourseImage) {
  const raw = image as MongoCourseImage & { id?: string; createdAt?: Date | string };
  const createdAt = raw.createdAt instanceof Date ? raw.createdAt : new Date(raw.createdAt ?? Date.now());
  return {
    id: image._id ?? raw.id,
    botId: image.botId,
    guildId: image.guildId,
    name: image.name,
    type: image.type,
    url: image.url,
    createdAt: createdAt.toISOString(),
    createdBy: image.createdBy,
    active: image.active,
    default: image.default
  };
}

function cleanSettings(input: Partial<Omit<CourseSettingsDto, "id" | "botId" | "guildId" | "updatedAt">>) {
  const cleaned: Record<string, unknown> = { ...input };
  cleaned.publishChannelId = input.publishChannelId || null;
  cleaned.scheduleChannelId = input.scheduleChannelId || null;
  cleaned.scheduleLogChannelId = input.scheduleLogChannelId || null;
  cleaned.proofLogChannelId = input.proofLogChannelId || null;
  cleaned.resultChannelId = input.resultChannelId || null;
  cleaned.evaluationChannelId = input.evaluationChannelId || null;
  cleaned.reportChannelId = input.reportChannelId || null;
  cleaned.logChannelId = input.logChannelId || null;
  cleaned.adminLogChannelId = input.adminLogChannelId || null;
  cleaned.temporaryCategoryId = input.temporaryCategoryId || null;
  cleaned.tempProofCategoryId = input.tempProofCategoryId || null;
  delete cleaned.lastPanelRequestedAt;
  return cleaned;
}

function cleanCourse(input: Partial<CourseDto>) {
  const allowed: Partial<MongoCourse> = {};
  for (const key of [
    "active",
    "bannerUrl",
    "proofBannerUrl",
    "buttonLabels",
    "cancelledText",
    "color",
    "code",
    "description",
    "emoji",
    "footerImageUrl",
    "imagePosition",
    "instructorRoleIds",
    "instructorUserIds",
    "allowGeneralInstructorRoles",
    "maxStudents",
    "location",
    "name",
    "defaultSchedule",
    "proofInstructionText",
    "publishChannelId",
    "publishText",
    "startedText",
    "thumbnailUrl"
  ] as const) {
    if (input[key] !== undefined) (allowed as Record<string, unknown>)[key] = input[key];
  }
  return allowed;
}

function scope(botId: string | null, guildId: string) {
  return { botId, guildId };
}

import axios, { type AxiosInstance } from "axios";
import { env } from "../config/env";
import type { GuildSettings } from "../types";

export type CreateLogInput = {
  botId?: string | null;
  guildId: string;
  userId?: string | null;
  executorId?: string | null;
  channelId?: string | null;
  logChannelId?: string | null;
  module?: string | null;
  action?: string | null;
  caseId?: string | null;
  status?: string | null;
  transcriptId?: string | null;
  type: string;
  message: string;
  metadata?: unknown;
};
export type Pd7Config = { _id:string; botId:string; guildId:string; factionId:string; factionName:string; enabled:boolean; categoryPD7:string|null; panelChannelPD7:string|null; logChannelPD7:string|null; allowedRolesPD7:string[]; responsibleUsersPD7:string[]; approvedRolePD7:string|null; rejectedRolePD7:string|null; fields:Array<{id:string;label:string;placeholder:string|null;required:boolean;style:"short"|"paragraph";order:number}>; autoDeleteMinutes:number|null; panelMessageId:string|null; publishRequestedAt:string|null };
export type Pd7Request = { _id:string; botId:string; guildId:string; factionId:string; userId:string; username:string; fields:Array<{id:string;label:string;value:string}>; status:"pending"|"approved"|"rejected"|"closed"; channelId:string|null; panelMessageId:string|null; handledBy:string|null; rejectionReason:string|null; createdAt:string; resolvedAt:string|null };

export type TicketRecord = {
  id: string;
  botId: string | null;
  guildId: string;
  channelId: string | null;
  openerId: string;
  ownerId?: string;
  subject: string;
  categoryId?: string | null;
  categoryName?: string | null;
  responsibleRoleId?: string | null;
  responsibleUserId?: string | null;
  status: string;
  closeReason?: string | null;
  finalResult?: string | null;
  isIncomplete?: boolean;
  createdAt: string;
  closedAt?: string | null;
};

export type HierarchyForwardingRule = {
  id: string;
  botId: string | null;
  guildId: string;
  denouncedRoleId: string;
  destinationCategoryId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TranscriptCreateResult = {
  publicUrl: string;
  temporaryPassword: string | null;
  temporaryPasswordExpiresAt: string | null;
  transcript: {
    id: string;
    botId: string | null;
    guildId: string;
    ticketId: string | null;
    type: string;
    status: string;
    isPartial: boolean;
    htmlPath: string;
    publicUrl?: string | null;
    createdAt: string;
    closedAt?: string | null;
    expiresAt: string | null;
    channelId?: string | null;
    channelName?: string | null;
    categoryName?: string | null;
    messageCount?: number;
    attachmentCount?: number;
    participantCount?: number;
  };
};

export type SystemEmojiRuntimeConfig = {
  botId: string | null;
  guildId?: string | null;
  definitions: Array<{ key: string; name: string; aliases?: string[]; fallback: string; label: string; description: string }>;
  emojis: Array<{
    key: string;
    name: string;
    emojiId: string | null;
    animated: boolean;
    sourceGuildId: string | null;
    enabled: boolean;
    fallback: string;
    guildId?: string | null;
    scope: "global" | "bot" | "guild" | "default";
  }>;
};

export type SystemEmojiValidationPayload = {
  extraEmojiNames?: string[];
  guildId?: string | null;
  emojis: Array<{
    key: string;
    name?: string | null;
    emojiId?: string | null;
    animated?: boolean;
    found: boolean;
    sourceGuildId?: string | null;
  }>;
};

export type CourseSettings = {
  id: string;
  botId: string | null;
  guildId: string;
  publishChannelId: string | null;
  scheduleChannelId: string | null;
  scheduleLogChannelId: string | null;
  proofLogChannelId: string | null;
  resultChannelId: string | null;
  evaluationChannelId: string | null;
  reportChannelId: string | null;
  logChannelId: string | null;
  adminLogChannelId: string | null;
  temporaryCategoryId: string | null;
  tempProofCategoryId: string | null;
  publicationMentionRoleId: string | null;
  evaluatorMentionRoleId: string | null;
  resultMentionRoleId: string | null;
  adminUserIds: string[];
  adminRoleIds: string[];
  managerUserIds: string[];
  managerRoleIds: string[];
  generalInstructorRoleIds: string[];
  globalInstructorUserIds: string[];
  globalInstructorRoleIds: string[];
  evaluatorUserIds: string[];
  evaluatorRoleIds: string[];
  configUserIds: string[];
  configRoleIds: string[];
  permissionMatrix: Record<string, { userIds: string[]; roleIds: string[] }>;
  images: Array<{ id: string; name: string; type: string; url: string; active: boolean; default: boolean; createdAt: string; createdBy: string | null }>;
  defaultExpirationHours: number | null;
  noPermissionMessage: string;
  cancelledMessage: string;
  startedMessage: string;
  globalBannerUrl: string | null;
  reportImageUrl: string | null;
  panelMessageId: string | null;
  lastPanelRequestedAt: string | null;
  buttonEmojis: { cancel: string; enter: string; leave: string; start: string } & Record<string, string | undefined>;
  updatedAt: string;
};

export type Course = {
  id: string;
  botId: string | null;
  guildId: string;
  name: string;
  code: string | null;
  description: string | null;
  emoji: string | null;
  color: string;
  bannerUrl: string | null;
  proofBannerUrl: string | null;
  footerImageUrl: string | null;
  thumbnailUrl: string | null;
  imagePosition: "top" | "bottom" | "side" | "footer";
  publishText: string | null;
  proofInstructionText: string | null;
  startedText: string | null;
  cancelledText: string | null;
  buttonLabels: { cancel: string; enter: string; leave: string; start: string };
  instructorUserIds: string[];
  instructorRoleIds: string[];
  allowGeneralInstructorRoles: boolean;
  publishChannelId: string | null;
  maxStudents: number;
  location: string | null;
  defaultSchedule: string | null;
  active: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CoursePublication = {
  id: string;
  botId: string | null;
  guildId: string;
  courseId: string;
  channelId: string;
  messageId: string | null;
  discordEventId: string | null;
  discordEventUrl: string | null;
  discordEventType: "EXTERNAL" | "VOICE" | "STAGE";
  voiceChannelId: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  lastSyncAt: string | null;
  syncError: string | null;
  instructorId: string;
  location: string;
  legacyLocation: string | null;
  dpId: string | null;
  dpNameSnapshot: string | null;
  scheduledFor: string;
  capacity: number;
  students: string[];
  notes: string | null;
  status: "open" | "started" | "cancelled" | "closed" | "proof" | "finished";
  workflowStatus: string;
  cancelledBy: string | null;
  cancelledAt: string | null;
  startedBy: string | null;
  startedAt: string | null;
  proofStartedBy: string | null;
  proofStartedAt: string | null;
  finishedBy: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CourseDepartment = {
  id: string;
  botId: string | null;
  guildId: string;
  name: string;
  normalizedName: string;
  active: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CourseEnrollment = {
  id: string;
  botId: string | null;
  guildId: string;
  courseId: string;
  publicationId: string;
  studentId: string;
  studentName: string;
  publicationChannelId: string;
  enrolledAt: string;
  enrollmentStatus: "ENROLLED" | "LEFT";
  examId: string | null;
  examStatus: "NOT_AVAILABLE" | "AVAILABLE" | "STARTING" | "IN_PROGRESS" | "COMPLETED" | "APPROVED" | "FAILED" | "CANCELED" | "EXPIRED";
  studentStatus: "INSCRITO" | "PROVA_DISPONIVEL" | "REALIZANDO_PROVA" | "PROVA_CONCLUIDA" | "APROVADO" | "REPROVADO" | "CANCELED" | "EXPIRED";
  attemptId: string | null;
  attemptNumber: number;
  examChannelId: string | null;
  examStartedAt: string | null;
  score: number | null;
  correctAnswers: number | null;
  result: "approved" | "rejected" | null;
  completedAt: string | null;
  correctedBy: string | null;
  transcriptId: string | null;
  updatedAt: string;
};

export type CourseScheduleRequest = {
  id: string;
  botId: string | null;
  guildId: string;
  courseId: string;
  instructorId: string;
  requestedDate: string;
  requestedTime: string;
  location: string;
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  decidedBy: string | null;
  decidedAt: string | null;
  channelId: string | null;
  messageId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CourseReport = {
  id: string;
  botId: string | null;
  guildId: string;
  courseId: string;
  instructorId: string;
  reportDate: string;
  reportTime: string;
  students: Array<{ note: string; observation: string | null; userId: string }>;
  channelId: string | null;
  messageId: string | null;
  createdAt: string;
};

export type CourseExamSettings = {
  id: string;
  botId: string | null;
  guildId: string;
  courseId: string;
  enabled: boolean;
  minScore: number;
  maxTimeMinutes: number | null;
  correctionChannelId: string | null;
  resultChannelId: string | null;
  temporaryCategoryId: string | null;
  logChannelId: string | null;
  deleteWrittenAnswers: boolean;
  allowCurrentQuestionReview: boolean;
  initialMessage: string;
  finalMessage: string;
  approvalMessage: string;
  rejectionMessage: string;
  manualQuestionMaxScore: number;
  manualApproval: boolean;
  automaticApproval: boolean;
  releaseMode: "immediate" | "scheduled" | "instructor";
  releaseAt: string | null;
  attemptLimit: number | null;
  allowAnswerChange: boolean;
  showAnswersAfterExam: boolean;
  version: number;
  examKey: string | null;
  externalLinkEnabled: boolean;
  externalLinkText: string;
  externalLinkUrl: string | null;
  externalLinkDescription: string | null;
  externalLinkEmoji: string | null;
  updatedAt: string;
  updatedBy: string | null;
};

export type CourseExamQuestion = {
  id: string;
  botId: string | null;
  guildId: string;
  courseId: string;
  order: number;
  questionNumber: number;
  type: "selection" | "multiple" | "written";
  prompt: string;
  title: string;
  description: string | null;
  points: number;
  alternatives: Array<{ id: string; text: string; value?: string; score?: number; isCorrect?: boolean; order?: number }>;
  correctAlternativeId: string | null;
  correctAlternativeIds: string[];
  correctText: string | null;
  placeholder: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
};

export type CourseExamAttempt = {
  id: string;
  botId: string | null;
  guildId: string;
  courseId: string;
  examId: string | null;
  publicationId: string;
  channelId: string;
  studentId: string;
  instructorId: string;
  status: "in_progress" | "finished" | "approved" | "rejected" | "awaiting_review" | "manual_reviewed";
  examVersion: number;
  attemptNumber: number;
  studentIdentification: {
    discordUserId: string;
    discordUsername: string;
    discordDisplayName: string;
    guildNickname: string | null;
    rpFullName: string;
    currentRank: "CADET" | "OFFICER" | "SENIOR_OFFICER" | null;
    rpId: string;
    guildId: string;
    courseId: string;
    examId: string;
    attemptId: string;
    temporaryChannelId: string;
    startedAt: string;
    identificationCompletedAt: string | null;
  } | null;
  identificationConfirmedAt: string | null;
  startedAt: string;
  finishedAt: string | null;
  correctedAt: string | null;
  correctedBy: string | null;
  currentQuestionIndex: number;
  objectiveCorrect: number;
  objectiveWrong: number;
  writtenCount: number;
  score: number;
  automaticScore: number;
  manualScore: number | null;
  finalScore: number | null;
  manualObservation: string | null;
  result: "approved" | "rejected" | null;
  maxScore: number;
  percent: number;
  correctionChannelId: string | null;
  correctionMessageId: string | null;
  correctionSentAt: string | null;
  resultChannelId: string | null;
  resultMessageId: string | null;
  resultSentAt: string | null;
  rejectionReason: string | null;
  updatedAt: string;
};

export type CourseInstructorSettings = {
  id: string;
  botId: string | null;
  guildId: string;
  enabled: boolean;
  authorizedRoleIds: string[];
  logChannelId: string | null;
  autoWeeklyReset: boolean;
  timezone: string;
  updatedAt: string;
  updatedBy: string | null;
};

export type CourseInstructorEvent = {
  id?: string;
  _id?: string;
  botId: string | null;
  guildId: string;
  instructorId: string;
  instructorName: string;
  courseId: string;
  courseName: string;
  publicationId: string | null;
  status: "started" | "cancelled" | "finished" | "closed";
  statusLabel: string;
  weekKey: string;
  weekNumber: number;
  year: number;
  date: string;
  time: string;
  timestamp: string;
  createdAt: string;
  updatedAt: string;
};

export type CourseInstructorReport = {
  events: CourseInstructorEvent[];
  instructors: Array<{ instructorId: string; instructorName: string; started: number; cancelled: number; finished: number; closed: number; total: number; lastEventAt: string | null }>;
  settings: CourseInstructorSettings;
  weekKey: string;
};

export type CourseHistorySettings = {
  id: string;
  botId: string | null;
  guildId: string;
  enabled: boolean;
  viewRoleIds: string[];
  removeRoleIds: string[];
  logChannelId: string | null;
  retentionDays: number | null;
  updatedAt: string;
  updatedBy: string | null;
};

export type CourseStudentHistory = {
  _id: string;
  botId: string | null;
  guildId: string;
  studentId: string;
  studentName: string;
  instructorId: string;
  instructorName: string;
  courseId: string;
  courseName: string;
  publicationId: string | null;
  attemptId: string | null;
  score: number;
  result: "approved";
  status: "approved";
  date: string;
  time: string;
  timestamp: string;
  removedAt: string | null;
  removedBy?: string | null;
  removalReason?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CourseStudentHistoryPage = {
  items: CourseStudentHistory[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type CourseExamAnswer = {
  id: string;
  botId: string | null;
  guildId: string;
  attemptId: string;
  courseId: string;
  questionId: string;
  questionOrder: number;
  questionText: string | null;
  type: "selection" | "multiple" | "written";
  selectedAlternativeId: string | null;
  selectedAlternativeIds: string[];
  selectedAlternativeText: string | null;
  alternativesSnapshot: Array<{ id: string; text: string; value?: string; score?: number; isCorrect?: boolean; order?: number }>;
  writtenAnswer: string | null;
  correct: boolean | null;
  pointsEarned: number;
  maxScore: number;
  answeredAt: string;
};

export type RhAdminSettings = {
  id: string;
  botId: string | null;
  guildId: string;
  enabled: boolean;
  systemName: string;
  color: string;
  panelChannelId: string | null;
  absencePanelChannelId: string | null;
  absenceReviewChannelId: string | null;
  absenceLogChannelId: string | null;
  adornmentPanelChannelId: string | null;
  adornmentReviewChannelId: string | null;
  adornmentLogChannelId: string | null;
  generalLogChannelId: string | null;
  absenceRoleId: string | null;
  configUserIds: string[];
  configRoleIds: string[];
  approverUserIds: string[];
  approverRoleIds: string[];
  approvedRoleId: string | null;
  manualRegistrationRoleIds: string[];
  requestCategoryId: string | null;
  viewerUserIds: string[];
  viewerRoleIds: string[];
  panelBannerUrl: string | null;
  dmBannerUrl: string | null;
  approvalDmBannerUrl: string | null;
  rejectionDmBannerUrl: string | null;
  finishedDmBannerUrl: string | null;
  adornmentBannerUrl: string | null;
  panelDescription: string;
  adornmentDescription: string;
  approvalDmText: string;
  rejectionDmText: string;
  finishedDmText: string;
  sendAbsenceDm: boolean;
  mentionAdornmentUser: boolean;
  allowNonDirectImageLinks: boolean;
  checkIntervalMinutes: number;
  buttonEmojis: { absence: string; adornment: string; approve: string; reject: string; back: string; save: string; publish: string; logs: string };
  mainPanelMessageId: string | null;
  mainPanelPublishedAt: string | null;
  lastPanelRequestedAt: string | null;
  updatedAt: string;
  updatedBy: string | null;
};

export type RhAdminAbsence = {
  id: string;
  botId: string | null;
  guildId: string;
  userId: string;
  serverName: string;
  startDate: string;
  returnDate: string;
  startAt: string;
  returnAt: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "finished";
  absenceRoleId: string | null;
  reviewerId: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  reviewChannelId: string | null;
  reviewMessageId: string | null;
  roleAddedAt: string | null;
  roleRemovedAt: string | null;
  autoRemoved: boolean;
  dmDelivered: boolean | null;
  createdAt: string;
  updatedAt: string;
};

export type RhAdminAbsenceActionResult = {
  absence: RhAdminAbsence;
  changed: boolean;
};

export type RhAdminAdornment = {
  id: string;
  botId: string | null;
  guildId: string;
  userId: string;
  serverName: string;
  number: string;
  imageUrl: string;
  observation: string | null;
  channelId: string | null;
  messageId: string | null;
  createdAt: string;
};

export type LiveEventInput = {
  botId?: string | null;
  guildId: string;
  type: "started" | "ended";
  streamer: string;
  title?: string;
  url?: string;
};

export type BotCommandAuthorization = {
  allowed: boolean;
  botId: string | null;
  checkedAt: string;
  commandName: string;
  guildId: string;
  moduleId: string | null;
  policy: "fail_closed";
  reason: string;
  reasonCode: string;
};

export type BotRuntimeModules = {
  active: boolean;
  botId: string;
  checkedAt: string;
  enabledModules: string[];
  status: "online" | "offline" | "invalid_token" | "error";
};

export type BotRuntimeStatusInput = {
  botGuilds?: Array<{
    id: string;
    name: string;
  }>;
  botProfile?: {
    avatarUrl?: string | null;
    id: string;
    username: string;
  };
  online: boolean;
};

export type MaintenanceState = {
  active: boolean;
  activatedAt: string | null;
  affectedBots: number;
  deactivatedAt: string | null;
  updatedAt: string;
  updatedById: string | null;
  updatedByName: string | null;
};

export type FivemActionArchitecture = "fac" | "police";
export type FivemActionMode = "shootout" | "escape";
export type FivemActionSettings = { id: string; botId: string; guildId: string; architecture: FivemActionArchitecture; enabled: boolean; categoryId: string | null; panelChannelId: string | null; actionChannelId: string | null; reportChannelId: string | null; managerRoleIds: string[]; spreadsheetEnabled: boolean; spreadsheetId: string | null; spreadsheetSheetName: string | null; spreadsheetLastSyncAt: string | null; spreadsheetSyncError: string | null; panelMessageId: string | null; panelTitle: string; panelDescription: string; color: string; imageUrl: string | null; imagePosition: "top" | "center" | "bottom" | "none"; lastPanelRequestedAt: string | null; updatedAt: string };
export type FivemActionDefinition = { id: string; architecture: FivemActionArchitecture; name: string; description: string; emoji: string | null; imageUrl: string | null; color: string; maxParticipants: number; enabled: boolean; order: number };
export type FivemActionParticipant = { userId: string; username: string; roleIds: string[]; position: "confirmed" | "reserve"; joinedAt: string; leftAt: string | null };
export type FivemActionSession = { id: string; botId: string; guildId: string; architecture: FivemActionArchitecture; actionId: string; actionName: string; actionDescription: string; actionEmoji: string | null; actionImageUrl: string | null; actionColor: string; mode: FivemActionMode | null; openerId: string; openerName: string; channelId: string | null; messageId: string | null; sheetRow: number | null; sheetSyncStatus: "pending" | "synced" | "failed" | null; sheetSyncError: string | null; sheetLastSyncAt: string | null; status: "forming" | "active" | "victory" | "defeat" | "draw" | "cancelled"; maxParticipants: number; participants: FivemActionParticipant[]; startedAt: string | null; cancelledAt: string | null; cancelledBy: string | null; cancellationReason: string | null; finishedAt: string | null; resultNote: string | null; resultSummary: string | null; resultOccurrence: string | null; createdAt: string; updatedAt: string };
export type PolicePatrolSettings = { id: string; botId: string; guildId: string; enabled: boolean; creatorRoleIds: string[]; viewerRoleIds: string[]; deleteRoleIds: string[]; supervisorRoleIds: string[]; logChannelId: string | null; temporaryCategoryId: string | null; deleteDelayMinutes: number; defaultExportFormat: "html" | "pdf" | "json" };
export type PolicePatrolReport = { id: string; botId: string; guildId: string; officerId: string; officerName: string; authorId: string; authorName: string; patrolType: string | null; initialNotes: string | null; patrolStart: string | null; patrolEnd: string | null; durationMinutes: number | null; channelId: string | null; panelMessageId: string | null; lastAuthorMessageId: string | null; messageCount: number; attachmentCount: number; status: "draft" | "active" | "finished" | "cancelled"; createdAt: string; startedAt: string | null; finishedAt: string | null; deleteAt: string | null };
export type PolicePatrolMessage = { id: string; discordMessageId: string; authorId: string; content: string; attachments: Array<{ id: string; name: string; url: string; contentType: string | null; size: number }>; embeds: unknown[]; stickers: Array<{ id: string; name: string; format: number }>; emojis: string[]; createdAt: string };
export type PoliceHiddenChannelSettings = { id: string; botId: string; guildId: string; enabled: boolean; channelId: string | null; allowedRoleId: string | null; logChannelId: string | null; createdBy: string | null; createdAt: string; updatedBy: string | null; updatedAt: string };
export type VisibleUser = { id: string; botId: string; guildId: string; userId: string; addedBy: string | null; createdAt: string; updatedAt: string };
export type DmBarConfig = { id: string; botId: string; guildId: string; enabled: boolean; allowedRoleIds: string[]; allowedUserIds: string[]; allowAdmins: boolean; logChannelId: string | null; logsEnabled: boolean; titleTemplate: string; descriptionTemplate: string; footerText: string; mainImageUrl: string | null; footerIconUrl: string | null; imagePosition: "top" | "middle" | "bottom" | "gallery" | "thumbnail" | "none"; accentColor: string; emoji: string; cooldownSeconds: number; allowMentions: boolean; showSender: boolean; showDate: boolean; showServer: boolean; showTargetId: boolean; footerEnabled: boolean; signature: string; createdAt: string; updatedAt: string; updatedBy: string | null };

export type ManualRegistrationField = {
  enabled: boolean;
  id: string;
  label: string;
  maxLength: number | null;
  minLength: number | null;
  name: string;
  placeholder: string | null;
  required: boolean;
  style: "short" | "paragraph";
};

export type ManualRegistrationSettings = {
  approvalChannelId: string | null;
  allowOnlyOneRequest: boolean;
  allowResubmit: boolean;
  approvalMessage: string;
  approvedRoleId: string | null;
  approverRoleIds: string[];
  automaticApproval: boolean;
  autoRoleIds: string[];
  bannerPosition: "top" | "bottom" | "none";
  botId: string | null;
  color: string;
  description: string | null;
  cooldownMinutes: number;
  dmNotifications: boolean;
  enabled: boolean;
  emoji: string | null;
  fields: ManualRegistrationField[];
  footerText: string | null;
  guildId: string;
  logChannelId: string | null;
  manualRegistrationRoleIds: string[];
  name: string;
  panelCategoryId: string | null;
  panelChannelId: string | null;
  panelMessageId: string | null;
  requestCategoryId: string | null;
  panelImage: {
    blocks?: import("./panelVisualRenderer").PanelBlock[];
    imageEnabled: boolean;
    imagePosition: import("./panelVisualRenderer").PanelVisualPosition;
    imageUrl: string;
    useGlobalDefault?: boolean;
  } | null;
  rejectionMessage: string;
  removeRoleIds: string[];
  setRoles: Array<{ description: string | null; emoji: string | null; enabled: boolean; id: string; name: string; order: number; requestable: boolean; roleId: string }>;
  staffRoleIds: string[];
  successMessage: string;
  thumbnailUrl: string | null;
  title: string;
  tutorial: string;
  updatedAt: string | null;
};

export type ManualRegistrationSubmission = {
  createdAt: string;
  id: string;
  guildId: string;
  userId: string;
  username: string;
  status: "pending" | "approved" | "rejected" | "removed";
  channelId: string | null;
  requestedName: string;
  registrationType: "request" | "manual";
  removedAt: string | null;
  removedBy: string | null;
  removalReason: string | null;
  fields: Array<{ id: string; label: string; value: string }>;
  messageId: string | null;
  rejectionReason: string | null;
  requestedRoleId: string | null;
};

export type FivemGoalField = {
  id: string;
  label: string;
  maxLength: number | null;
  minLength: number | null;
  placeholder: string | null;
  required: boolean;
  style: "short" | "paragraph";
};

export type FivemGoalItem = {
  emoji: string | null;
  enabled: boolean;
  id: string;
  name: string;
};

export type FivemGoalSettings = {
  configs?: FivemGoalConfig[];
  autoCreateWithManualRegistration: boolean;
  categoryId: string | null;
  channelNameTemplate: string;
  enabled: boolean;
  fields: FivemGoalField[];
  guildId: string;
  items: FivemGoalItem[];
  logChannelId: string | null;
  managerRoleId: string | null;
  requestPanelChannelId: string | null;
  requestPanelDescription: string;
  requestPanelEnabled: boolean;
  requestPanelMessageId: string | null;
  requestPanelTitle: string;
  requestRequiresApproval: boolean;
  viewRoleId: string | null;
};

export type FivemGoalConfig = {
  approverRoleIds: string[];
  currentValue: number;
  description: string | null;
  fields: FivemGoalField[];
  id: string;
  logChannelId: string | null;
  managerRoleIds: string[];
  name: string;
  panelChannelId: string | null;
  participantRoleIds: string[];
  period: "daily" | "weekly" | "monthly" | "custom";
  requiresApproval: boolean;
  requiresProof: boolean;
  status: "active" | "paused" | "finished";
  targetValue: number;
  type: string;
  viewerRoleIds: string[];
};
export type FivemGoalSubmission = { createdAt: string; description: string | null; id: string; metaId: string; proofUrl: string | null; status: "pending" | "approved" | "refused"; userId: string; value: number };
export type FivemGoalUserRuntime = { configs: FivemGoalConfig[]; ranking: Array<{ rank: number; total: number; userId: string }>; submissions: FivemGoalSubmission[]; userId: string };

export type FivemOrderStatus = "open" | "pending_approval" | "approved" | "in_production" | "ready" | "delivered" | "cancelled" | "rejected";
export type FivemOrderSettings = {
  adminRoleIds: string[]; allowAnonymous: boolean; allowAttachments: boolean; allowCustomNotes: boolean; approvalChannelId: string | null; approvalRequired: boolean;
  approveRoleIds: string[]; cancelRoleIds: string[]; color: string; createRoleIds: string[]; deliveryChannelId: string | null; enabled: boolean; enabledOrderModules: Array<"washing" | "ammo" | "drug" | "weapon" | "custom">; errorMessage: string; finishRoleIds: string[];
  footerText: string | null; guildId: string; logChannelId: string | null; maxOpenHours: number; orderCancelledMessage: string; orderCreatedMessage: string;
  orderDeliveredMessage: string; panelChannelId: string | null; panelDescription: string; panelMessageId: string | null; panelTitle: string;
  panelImage: { blocks?: import("./panelVisualRenderer").PanelBlock[]; imageEnabled: boolean; imagePosition: import("./panelVisualRenderer").PanelVisualPosition; imageUrl: string; useGlobalDefault?: boolean } | null;
};
export type FivemOrderFamily = { active: boolean; id: string; leaderName?: string | null; logChannelId: string | null; name: string; notes: string | null; orderModules: Array<"washing" | "ammo" | "drug" | "weapon" | "custom">; responsibleId: string; roleId: string; type?: "pista" | "produto" | "sem_produto" };
export type FivemOrderProduct = {
  active: boolean; allowCustomQuantity: boolean; allowNotes: boolean; category: string; cost: number; description: string | null; emoji: string | null;
  config?: {
    adminRoleIds?: string[];
    allowAttachments?: boolean | null;
    allowCustomNotes?: boolean | null;
    approvalChannelId?: string | null;
    approvalRequired?: boolean | null;
    approveRoleIds?: string[];
    cancelRoleIds?: string[];
    color?: string | null;
    createRoleIds?: string[];
    deliveryChannelId?: string | null;
    finishRoleIds?: string[];
    footerText?: string | null;
    logChannelId?: string | null;
    orderCancelledMessage?: string | null;
    orderCreatedMessage?: string | null;
    orderDeliveredMessage?: string | null;
  };
  factionPercentage: number; washingPercentages?: number[]; featured: boolean; id: string; name: string; order: number; price: number; sellerPercentage: number;
  defaultQuantity: number; maximumQuantity: number; minimumQuantity: number; type: "standard" | "washing" | "ammo" | "drug" | "weapon" | "custom";
};
export type FivemOrder = {
  category: string; clientName: string; costTotal: number; createdAt: string; expectedDelivery: string | null; familyId: string; familyName: string; finalValue: number; grossValue: number; id: string;
  notes: string | null; orderNumber: number; productId: string; productName: string; profit: number; proofUrl: string | null; quantity: number;
  responsibleId: string | null; status: FivemOrderStatus; unitPrice: number; updatedAt?: string | null; userId: string; washingPercentage?: number | null;
};

export type FivemFinanceSettings = {
  adminRoleIds: string[];
  allowBalanceQuery: boolean;
  allowNegativeBalance: boolean;
  confirmAdd: boolean;
  confirmRemove: boolean;
  historyEnabled: boolean;
  historyPageSize: number;
  maxTransactionAmount: number;
  requireReason: boolean;
  autoCloseMinutes: number;
  bannerMode: "above" | "inside" | "below" | "none";
  color: string;
  enabled: boolean;
  footerImageUrl: string | null;
  footerText: string | null;
  guildId: string;
  logChannelId: string | null;
  panelChannelId: string | null;
  panelDescription: string;
  panelImage: { blocks?: import("./panelVisualRenderer").PanelBlock[]; imageEnabled: boolean; imagePosition: import("./panelVisualRenderer").PanelVisualPosition; imageUrl: string; useGlobalDefault?: boolean } | null;
  panelMessageId: string | null;
  panelTitle: string;
  tempCategoryId: string | null;
  useRoleIds: string[];
};
export type FivemFinanceTransaction = {
  amount: number; createdAt: string; id: string; logChannelId: string | null; logMessageId: string | null; newBalance: number; oldBalance: number;
  proofImageUrl: string; proofMessageId: string | null; status: "completed" | "reviewed" | "cancelled" | "corrected"; tempChannelId: string | null; transactionId: string;
  type: "add" | "remove"; updatedAt: string; userAvatar: string | null; userId: string; username: string;
  managerId?: string; managerName?: string; personName?: string; reason?: string; targetUserId?: string; notes?: string | null;
};

export type FivemGoalUserChannel = {
  channelId: string;
  guildId: string;
  userId: string;
};

export type FivemHierarchyEntry = {
  active: boolean;
  color: string | null;
  description: string | null;
  emoji: string | null;
  id: string;
  limit: number | null;
  name: string;
  order: number;
  roleId: string;
  roleName?: string | null;
};

export type FivemHierarchyPanel = {
  allowedRoleIds: string[];
  botId: string | null;
  color: string;
  configRevision: number;
  contentHash: string | null;
  description: string | null;
  createdAt: string;
  createdBy: string | null;
  enabled: boolean;
  footerEnabled: boolean;
  footerIconUrl: string | null;
  footerText: string | null;
  guildId: string;
  hierarchies: FivemHierarchyEntry[];
  id: string;
  imagePosition: "top" | "bottom" | "thumbnail" | "none";
  imageUrl: string | null;
  logChannelId: string | null;
  managerUserIds: string[];
  managerRoleIds: string[];
  commandUserIds: string[];
  commandRoleIds: string[];
  name: string;
  panelChannelId: string | null;
  panelMessageId: string | null;
  panelVersion: number;
  publishedAt: string | null;
  status: "draft" | "completed" | "published" | "disabled";
  title: string;
  updatedAt: string;
  updatedBy?: string | null;
};

export type SafeBotMessageState = {
  botId: string | null;
  guildId: string;
  channelId: string;
  messageId: string;
  updatedAt: string;
};

export type BotRuntimeModuleAuthorization = {
  allowed: boolean;
  botAuthorized: boolean;
  botId: string | null;
  botStatus: "online" | "offline" | "invalid_token" | "error" | null;
  checkedAt: string;
  guildAuthorized: boolean;
  guildId: string;
  licenseExpiresAt: string | null;
  licenseStatus: string | null;
  licenseValid: boolean;
  moduleEnabled: boolean;
  moduleId: string;
  moduleReleased: boolean;
  plan: string | null;
  policy: "fail_closed";
  reason: string;
  reasonCode: string;
  releaseModuleId: string | null;
};

export type AntiBanConfig = {
  botId: string;
  guildId: string;
  enabled: boolean;
  banLimit: number;
  kickLimit: number;
  timeWindow: number;
  logChannelId: string | null;
  whitelistUsers: string[];
  whitelistRoles: string[];
  whitelistRoleMode: "ignore" | "log_only";
  protectedRoles: string[];
  actionOnTrigger: "log_only" | "remove_admin_roles" | "kick_executor" | "ban_executor" | "remove_dangerous_permissions" | "block_future_actions";
  autoRecovery: "alert_only" | "unban" | "restore_permissions";
};

export type ImageAntiSpamSettings = {
  id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  logChannelId: string | null;
  immuneRoleIds: string[];
  ignoredChannelIds: string[];
  maxImages: number;
  windowSeconds: number;
  warningsEnabled: boolean;
  progressiveTimeoutEnabled: boolean;
  autoKickEnabled: boolean;
  maxWarnings: number;
  ignoreAdministrators: boolean;
  warningResetDays: number;
  createdAt: string;
  updatedAt: string;
};

export type ImageAntiSpamIncident = {
  id: string;
  botId: string;
  guildId: string;
  incidentKey: string;
  userId: string;
  username: string | null;
  channelId: string;
  channelIds: string[];
  mediaTypes: string[];
  messageIds: string[];
  removedImages: number;
  removedMessages: number;
  warningCount: number;
  timeoutMs: number;
  action: "none" | "warning" | "timeout" | "kick";
  actionSucceeded: boolean | null;
  actionError: string | null;
  reason: string;
  status: "pending" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
};

export type ImageAntiSpamUser = {
  id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string | null;
  warningCount: number;
  totalImagesRemoved: number;
  lastInfractionAt: string | null;
  lastPunishment: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ImageAntiSpamIncidentResult = {
  duplicate: boolean;
  incident: ImageAntiSpamIncident;
  settings: ImageAntiSpamSettings;
  user: ImageAntiSpamUser;
};

export type VoiceRecorderSettings = {
  id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  logChannelId: string | null;
  allowedRoleIds: string[];
  maxDurationMinutes: number;
  retentionDays: number;
  createdAt: string;
  updatedAt: string;
};

export type VoiceRecordingStatus = "starting" | "recording" | "processing" | "completed" | "failed" | "deleted";

export type VoiceRecording = {
  id: string;
  botId: string;
  guildId: string;
  guildName: string | null;
  channelId: string;
  channelName: string | null;
  startedById: string;
  startedByTag: string | null;
  stoppedById: string | null;
  stoppedByTag: string | null;
  source: "discord" | "dashboard";
  participants: Array<{
    userId: string;
    username: string | null;
    joinedAt: string;
    leftAt: string | null;
    speakingMs: number;
  }>;
  events: Array<{
    type: string;
    userId: string | null;
    username: string | null;
    message: string;
    createdAt: string;
    metadata?: Record<string, unknown>;
  }>;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  fileName: string | null;
  fileSize: number;
  fileUrl: string | null;
  downloadUrl: string | null;
  mimeType: string | null;
  status: VoiceRecordingStatus;
  error: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VoiceRecordingStartResult = {
  recording: VoiceRecording;
  settings: VoiceRecorderSettings;
};

export type SelfBotProtectionModuleId =
  | "anti-spam"
  | "anti-flood"
  | "anti-imagens"
  | "anti-gif"
  | "anti-mencoes"
  | "anti-emojis"
  | "anti-convites"
  | "anti-links"
  | "anti-scam"
  | "anti-raid"
  | "anti-caps-lock"
  | "anti-texto-repetido"
  | "anti-copypasta"
  | "anti-flood-multi-canais"
  | "anti-anexos"
  | "anti-webhook"
  | "anti-bots"
  | "anti-contas-novas"
  | "anti-token-grabber"
  | "anti-phishing"
  | "anti-nitro-scam"
  | "anti-mass-ping"
  | "anti-divulgacao"
  | "anti-auto-spam"
  | "anti-comandos-em-massa"
  | "anti-stickers"
  | "anti-nome"
  | "anti-cargos"
  | "anti-canais"
  | "anti-emojis-servidor";

export type SelfBotPunishmentAction =
  | "delete_message"
  | "warn"
  | "log"
  | "timeout"
  | "remove_role"
  | "add_role"
  | "kick"
  | "ban";

export type PunishmentDuration = {
  dias: number;
  horas: number;
  minutos: number;
  segundos: number;
};

export type SelfBotPunishmentStep = {
  id: string;
  acao: SelfBotPunishmentAction;
  ativado: boolean;
  limite: number;
  proximaAcao: SelfBotPunishmentAction | null;
  apagarMensagem: boolean;
  enviarAviso: boolean;
  registrarLog: boolean;
  tempoTimeout: PunishmentDuration;
  cargoAdicionarId: string | null;
  cargoRemoverId: string | null;
  banApagarMensagensSegundos: number;
};

export type ResolvedSelfBotPunishment = {
  actionCount: number;
  step: SelfBotPunishmentStep;
  totalOccurrences: number;
};

export type SelfBotProtectionSettings = {
  id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  moduleToggles: Record<SelfBotProtectionModuleId, boolean>;
  ignoredChannelIds: string[];
  ignoredUserIds: string[];
  ignoredRoleIds: string[];
  ignoredBotIds: string[];
  ignoredCategoryIds: string[];
  protectedChannelIds: string[];
  mediaChannelIds: string[];
  linkChannelIds: string[];
  allowedDomains: string[];
  allowedInviteGuildIds: string[];
  blockedFileExtensions: string[];
  blockImages: boolean;
  blockGifs: boolean;
  blockVideos: boolean;
  blockAudio: boolean;
  logChannelId: string | null;
  punishmentLogChannelId: string | null;
  logWebhookUrl: string | null;
  embedColor: string;
  punishmentSequence: SelfBotPunishmentAction[];
  punishmentSteps: SelfBotPunishmentStep[];
  addRoleId: string | null;
  removeRoleId: string | null;
  timeoutSeconds: number;
  floodLimit: number;
  floodWindowSeconds: number;
  imageLimit: number;
  imageWindowSeconds: number;
  mentionLimit: number;
  emojiLimit: number;
  stickerLimit: number;
  stickerWindowSeconds: number;
  nicknameChangeLimit: number;
  nicknameWindowSeconds: number;
  antiBotAction: "allow" | "kick" | "ban" | "manual";
  raidLockdownEnabled: boolean;
  dmWarningEnabled: boolean;
  dmWarningMessage: string;
  moduleLogChannelIds: Partial<Record<SelfBotProtectionModuleId, string>>;
  capsMinLength: number;
  capsPercentage: number;
  repeatedTextLimit: number;
  repeatedTextWindowSeconds: number;
  multiChannelLimit: number;
  multiChannelWindowSeconds: number;
  raidJoinLimit: number;
  raidWindowSeconds: number;
  newAccountMaxAgeHours: number;
  suspiciousDomains: string[];
  blockedTerms: string[];
  createdAt: string;
  updatedAt: string;
};

export type SelfBotRoleAssignment = {
  botId: string;
  guildId: string;
  lastIncidentId: string;
  lastPunishedAt: string;
  roleId: string | null;
  userId: string;
  username: string | null;
};

export type SelfBotProtectionIncident = {
  id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string | null;
  channelId: string | null;
  messageId: string | null;
  messageContent: string | null;
  moduleId: SelfBotProtectionModuleId;
  infractionType: string;
  punishmentActions: SelfBotPunishmentAction[];
  punishmentSucceeded: boolean;
  punishmentError: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type SafeBotWarningAction = "record_only" | "dm" | "channel_message" | "add_role" | "remove_role" | "timeout" | "kick" | "ban" | "notify_staff" | "open_ticket" | "block_channels" | "custom";
export type SafeBotWarningLevel = {
  id: string; number: number; name: string; description: string; defaultReason: string;
  action: SafeBotWarningAction | null; actions?: SafeBotWarningAction[]; durationSeconds: number | null; roleId: string | null;
  channelId: string | null; targetChannelIds: string[]; logChannelId: string | null;
  userMessage: string; staffMessage: string; customAction: string; enabled: boolean;
};
export type SafeBotWarningSettings = {
  id: string; botId: string; guildId: string; enabled: boolean; authorizedRoleIds: string[];
  defaultLogChannelId: string | null; overflowMode: "repeat_last" | "record_only" | "block" | "final_action";
  finalLevel: SafeBotWarningLevel | null; levels: SafeBotWarningLevel[]; createdAt: string; updatedAt: string;
};
export type SafeBotWarningPreview = {
  enabled: boolean; configuredLevels: number; authorizedRoleIds: string[]; currentWarnings: number;
  nextWarningNumber: number; level: SafeBotWarningLevel | null; blocked: boolean;
  action: SafeBotWarningAction; note: string | null;
};
export type SafeBotWarningRecord = {
  id: string; botId: string; guildId: string; userId: string; username: string | null;
  staffId: string; staffName: string | null; reason: string; warningNumber: number; infractionNumber?: number;
  idempotencyKey?: string | null; channelId?: string | null; ruleId?: string | null; ruleName?: string | null;
  level: SafeBotWarningLevel | null; configuredAction: SafeBotWarningAction | null;
  executedAction: string | null; status: "pending" | "recorded" | "success" | "failed" | "removed";
  error: string | null; createdAt: string; updatedAt: string;
};
export type TemporaryVoiceSettings = { botId: string; guildId: string; enabled: boolean; panelChannelId: string | null; panelMessageId: string | null; categoryId: string | null; defaultUserLimit: number; emptyDeleteMinutes: number; logChannelId: string | null; autoDeleteChannelIds: string[] };
export type TemporaryCall = { id: string; botId: string; guildId: string; ownerId: string; channelId: string; channelName: string; userLimit: number; isPrivate: boolean; allowedUsers: string[]; bannedUsers: string[]; createdAt: string; updatedAt: string; emptySince: string | null };
export type AutomatedLogSettings = { id: string; botId: string; guildId: string; enabled: boolean; categoryId: string | null; channels: { site: string | null; absence: string | null; messages: string | null; calls: string | null; verification: string | null; punishment: string | null }; enabledChannels: { site: boolean; absence: boolean; messages: boolean; calls: boolean; verification: boolean; punishment: boolean }; allowedRoleIds: string[]; lastError: string | null; lastSyncedAt: string | null; lastSyncRequestedAt: string | null; createdAt: string; updatedAt: string };

export type SocialNotification = {
  id: string;
  botId: string | null;
  guildId: string;
  userId: string;
  platform: "twitch";
  twitchChannelName: string;
  twitchChannelUrl: string;
  twitchUserId?: string | null;
  twitchAvatar?: string | null;
  discordChannelId: string;
  mentionRoleId?: string | null;
  customMessage?: string | null;
  embedColor?: string | null;
  enabled: boolean;
  isLive: boolean;
  lastLiveAt?: string | null;
  lastStreamId?: string | null;
  lastMessageId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KickNotification = {
  id: string;
  botId: string | null;
  guildId: string;
  userId: string;
  platform: "kick";
  kickChannelName: string;
  kickChannelUrl: string;
  kickChannelId?: string | null;
  kickUserId?: string | null;
  kickDisplayName?: string | null;
  kickAvatar?: string | null;
  kickBanner?: string | null;
  kickFollowers?: number | null;
  kickVerified?: boolean | null;
  kickCategory?: string | null;
  discordChannelId: string;
  mentionRoleId?: string | null;
  customMessage?: string | null;
  embedColor?: string | null;
  enabled: boolean;
  isLive: boolean;
  lastLiveAt?: string | null;
  lastEndedAt?: string | null;
  lastStreamId?: string | null;
  lastMessageId?: string | null;
  peakViewers?: number | null;
  createdAt: string;
  updatedAt: string;
};

export type KickStream = {
  id: string;
  broadcasterUserId: string;
  channelId: string | null;
  slug: string;
  displayName: string;
  categoryName: string;
  title: string;
  viewerCount: number;
  thumbnailUrl: string | null;
  startedAt: string;
  avatar: string | null;
  url: string;
};

export type ClipMentionType = "none" | "everyone" | "role";
export type ClipPlatform = "twitch" | "kick";

export type ClipRewardRole = {
  clipCount: number;
  label: string;
  roleId: string;
};

export type ClipRewardAssignment = ClipRewardRole & {
  userId: string;
};

export type ClipsConfig = {
  id: string;
  guildId: string;
  botId: string | null;
  platform: ClipPlatform;
  channelName: string;
  broadcasterId: string;
  displayName: string | null;
  avatar: string | null;
  channelUrl: string | null;
  captureAvailable: boolean;
  providerStatus: string;
  twitchChannelName: string;
  twitchBroadcasterId: string;
  twitchDisplayName: string | null;
  twitchAvatar: string | null;
  kickChannelName: string | null;
  kickChannelUrl: string | null;
  kickChannelId: string | null;
  kickUserId: string | null;
  kickDisplayName: string | null;
  kickAvatar: string | null;
  kickFollowers: number | null;
  discordChannelId: string | null;
  enabled: boolean;
  allowedRoleIds: string[];
  mentionType: ClipMentionType;
  mentionRoleId: string | null;
  embedColor: string;
  customMessage: string | null;
  clipRewards: ClipRewardRole[];
  lastCheckAt: string | null;
  activeLiveSessionId: string | null;
  activeLiveStartedAt: string | null;
  activeLiveTitle: string | null;
  activeLiveThumbnail: string | null;
  totalSent: number;
  createdAt: string;
  updatedAt: string;
};

export type GiveawayParticipant = {
  id: string;
  accountId: string | null;
  platform: "twitch" | "kick";
  platformUserId: string;
  username: string;
  displayName: string;
  subscriber: boolean;
  follower: boolean;
  source: "twitch" | "kick";
  subTier: string | null;
  subTierLabel: string | null;
  subMonths: number | null;
  isPrime: boolean;
  isVip: boolean;
  isModerator: boolean;
  isEditor: boolean;
  tickets: number;
  eligible: boolean;
  invalidReason: string | null;
  validatedAt: string;
};

export type GiveawayWinner = {
  participantId: string;
  username: string;
  displayName: string;
  wonAt: string;
};

export type GiveawayStatus = "waiting" | "running" | "ended";

export type Giveaway = {
  id: string;
  botId: string | null;
  guildId: string;
  ownerId: string;
  discordChannelId: string | null;
  title: string;
  liveName: string;
  liveUrl: string;
  livePlatform: "twitch" | "kick" | "multi";
  twitchBroadcasterId: string;
  twitchChannelName: string | null;
  kickChannelName: string | null;
  kickUserId: string | null;
  kickChannelId: string | null;
  participantMode: "twitch_subs" | "twitch_followers" | "twitch_subs_followers" | "kick_subs" | "kick_followers" | "twitch_kick" | "all";
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  prizeName: string;
  participants: GiveawayParticipant[];
  winners: GiveawayWinner[];
  status: GiveawayStatus;
  rouletteToken: string;
  rouletteUrl: string;
  panelMessageId: string | null;
  winnerCount: number;
  allowRepeatWinners: boolean;
  startDelayMinutes: number;
  endDelayMinutes: number;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  customMessage: string | null;
  schedulerError: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
};

export type SocialPlatform =
  | "twitter"
  | "instagram"
  | "twitch"
  | "youtube"
  | "tiktok"
  | "kick"
  | "facebook"
  | "website";

export type SocialMember = {
  id: string;
  botId: string | null;
  guildId: string;
  userId: string | null;
  discordId: string | null;
  name: string;
  avatar: string | null;
  role: string | null;
  links: Record<SocialPlatform, string>;
  createdAt: string;
  updatedAt: string;
};

export type SocialPanel = {
  id: string;
  botId: string | null;
  guildId: string;
  channelId: string | null;
  messageId: string | null;
  embedColor: string;
  published: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
  lastPublishedAt: string | null;
};

export type SocialPanelPayload = {
  members: SocialMember[];
  panel: SocialPanel;
};

export type XApiStatus = "idle" | "ok" | "error";

export type XAccount = {
  id: string;
  botId: string | null;
  guildId: string;
  channelId: string;
  xUserId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  active: boolean;
  lastSyncAt: string | null;
  lastPostId: string | null;
  lastPostAt: string | null;
  lastApiStatus: XApiStatus;
  lastApiError: string | null;
  totalPostsSent: number;
  createdAt: string;
  updatedAt: string;
};

export type XPost = {
  id: string;
  text: string;
  createdAt: string;
  url: string;
  mediaUrls: string[];
};

export type XSyncResult = {
  account: XAccount;
  posts: XPost[];
};

export type FivemFacMessages = {
  panelTitle: string;
  panelDescription: string;
  requestCreated: string;
  approved: string;
  rejected: string;
  started: string;
  finished: string;
};

export type FivemFacPanelButton = {
  id: string;
  label: string;
  emoji: string | null;
  style: "primary" | "secondary" | "success" | "danger" | "link";
  type: "action" | "url";
  action: "request_absence" | "my_absences" | "url";
  url: string | null;
  order: number;
  enabled: boolean;
};

export type FivemFacPanelVisual = {
  panelColor: string;
  imageUrl: string | null;
  imagePosition: "right_small" | "top" | "bottom" | "none";
  buttonsPosition: "inside_panel" | "outside_panel" | "below" | "rows" | "none";
  buttons: FivemFacPanelButton[];
  componentsOrder: Array<"image" | "text" | "buttons">;
  enabledSections: {
    image: boolean;
    buttons: boolean;
    description: boolean;
  };
};

export type FivemFacSettings = {
  id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  panelChannelId: string | null;
  panelMessageId: string | null;
  absenceRoleId: string | null;
  autoApproveEnabled: boolean;
  autoApproveMaxDays: number | null;
  autoApproveRoleIds: string[];
  viewerRoleIds: string[];
  approverRoleIds: string[];
  memberRoleIds: string[];
  logChannelId: string | null;
  messages: FivemFacMessages;
  panelVisual: FivemFacPanelVisual;
  lastPanelRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FivemFacAbsenceStatus = "pending" | "approved" | "active" | "rejected" | "finished" | "closed";

export type FivemFacAbsence = {
  id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string | null;
  reason: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  photoUrl: string | null;
  status: FivemFacAbsenceStatus;
  privateChannelId: string | null;
  requestMessageId: string | null;
  moderatorId: string | null;
  approvedBy: string | null;
  rejectionReason: string | null;
  roleAddedAt: string | null;
  roleRemovedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FivemFacLifecycleResult = {
  absence: FivemFacAbsence;
  changed: boolean;
};

export type FivemFacHistoryResetResult = {
  actorId: string;
  botId: string;
  deleted: {
    facAbsences: number;
    fivemGoalEntries: number;
    fivemGoalLogs: number;
    fivemGoalSubmissions: number;
    fivemGoalUserChannels: number;
    manualRegistrationLogs: number;
    manualRegistrationSubmissions: number;
    total: number;
  };
  discordChannelIds: {
    all: string[];
    facAbsencePrivate: string[];
    fivemGoalUser: string[];
  };
  guildId: string;
  resetAt: string;
};

export type OpenDutySettings = {
  id: string;
  botId: string | null;
  guildId: string;
  enabled: boolean;
  logChannelId: string | null;
  alertChannelId: string | null;
  mentionChannelId: string | null;
  allowedRoleIds: string[];
  allowedUserIds: string[];
  defaultMessage: string;
  alertMessage: string;
  dmBannerUrl: string | null;
  panelBannerUrl: string | null;
  footerImageUrl: string | null;
  footerText: string | null;
  footerIconUrl: string | null;
  imagePosition: "top" | "middle" | "bottom" | "footer" | "none";
  panelColor: string;
  buttonEmojis: { cancel: string; config: string; edit: string; logs: string; reset: string; save: string; search: string; send: string };
  counterMode: "accumulate" | "reset_after_3" | "cycles";
  updatedAt: string;
  updatedBy: string | null;
};

export type MissionToolsFeatureId =
  | "mission"
  | "clear"
  | "voice"
  | "rich-presence"
  | "username-checker";

export type MissionToolsStatus =
  | "active"
  | "inactive"
  | "deactivated"
  | "waiting"
  | "running"
  | "completed"
  | "error";

export type MissionToolsClearMode = "bulk" | "userDm";
export type MissionToolsVoiceStatus = "connected" | "disconnected" | "reconnecting";
export type MissionToolsRichPresenceStatus = "active" | "inactive";
export type MissionToolsRichPresenceActivityType = 0 | 1 | 2 | 3 | 5;
export type MissionToolsTokenStatus = "connected" | "invalid" | "expired" | "disconnected" | "fake";

export type MissionToolsRichPresenceConfig = {
  applicationId?: string;
  activityType?: MissionToolsRichPresenceActivityType;
  name?: string;
  description?: string;
  state?: string;
  details?: string;
  buttonLabel?: string;
  buttonUrl?: string;
  largeImage?: string;
  largeText?: string;
  smallImage?: string;
  smallText?: string;
  startTimestamp?: string;
};

export type MissionToolsUsernameCheckerOptions = {
  usernameLength?: number;
  concurrency?: number;
  requestDelay?: number;
};

export type MissionToolsUsernameCheckerStats = {
  hits: number;
  taken: number;
  errors: number;
  activeProxies: number;
  deadProxies: number;
  bannedProxies: number;
  workersRunning: number;
};

export type MissionToolsSettings = {
  id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  panelChannelId: string | null;
  panelMessageId: string | null;
  logChannelId: string | null;
  managerRoleIds: string[];
  allowedRoleIds: string[];
  enabledFeatures: MissionToolsFeatureId[];
  lastPanelRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MissionToolsUserPanel = {
  id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string | null;
  dmChannelId: string | null;
  clearMessageId: string | null;
  missionMessageId: string | null;
  voiceMessageId: string | null;
  richPresenceMessageId: string | null;
  usernameCheckerMessageId: string | null;
  tokenConfigured: boolean;
  tokenStatus: MissionToolsTokenStatus;
  tokenLast4: string | null;
  tokenUpdatedAt: string | null;
  tokenLastValidatedAt: string | null;
  tokenInvalidReason: string | null;
  clearStatus: MissionToolsStatus;
  clearMode: MissionToolsClearMode;
  clearTargetUserId: string | null;
  missionStatus: MissionToolsStatus;
  voiceStatus: MissionToolsVoiceStatus;
  richPresenceStatus: MissionToolsRichPresenceStatus;
  usernameCheckerStatus: MissionToolsStatus;
  currentMission: string | null;
  missionDetail: string | null;
  voiceGuildId: string | null;
  voiceGuildName: string | null;
  voiceChannelId: string | null;
  voiceChannelName: string | null;
  voiceConnectedAt: string | null;
  richPresenceConfig: MissionToolsRichPresenceConfig;
  richPresenceUpdatedAt: string | null;
  usernameCheckerOptions: MissionToolsUsernameCheckerOptions;
  usernameCheckerStats: MissionToolsUsernameCheckerStats;
  usernameCheckerLastEvent: string | null;
  usernameCheckerUpdatedAt: string | null;
  completedCount: number;
  totalMissions: number;
  progress: number;
  createdAt: string;
  updatedAt: string;
};

export type MissionToolsUserPatch = Partial<Omit<
  MissionToolsUserPanel,
  "id" | "botId" | "guildId" | "userId" | "createdAt" | "updatedAt"
>>;

export type MissionToolsTokenResponse = {
  token: string;
  tokenConfigured: boolean;
  tokenLast4: string | null;
  tokenStatus: MissionToolsTokenStatus;
  invalidReason: string | null;
  lastValidatedAt: string | null;
  updatedAt: string;
};

export type PriceTableItem = {
  active: boolean;
  billingText: string | null;
  billingType: "one_time" | "monthly" | "weekly" | "custom";
  description: string | null;
  highlight: boolean;
  id: string;
  name: string;
  order: number;
  price: number;
  priceText: string | null;
};

export type PriceTable = {
  id: string;
  botId: string;
  buttonText: { plans: string; quote: string; support: string };
  color: string;
  currency: "BRL" | "USD" | "EUR" | "CUSTOM";
  currencyFormat: string;
  description: string | null;
  discordChannelId: string | null;
  footerText: string | null;
  guildId: string;
  imagePosition: "top" | "bottom" | "thumbnail" | "none";
  imageUrl: string | null;
  isActive: boolean;
  items: PriceTableItem[];
  logChannelId: string | null;
  messageId: string | null;
  modalText: {
    contactLabel: string;
    contactPlaceholder: string;
    detailsLabel: string;
    detailsPlaceholder: string;
    productLabel: string;
    productPlaceholder: string;
    title: string;
    userNameLabel: string;
    userNamePlaceholder: string;
  };
  name: string;
  supportCategoryId: string | null;
  supportRoleIds: string[];
  ticketInitialMessage: string;
  panelEmojis: { products: string; systems: string; advantages: string; support: string };
  panelSections: {
    includedTitle: string; includedItems: string[]; systemsTitle: string; systemsText: string;
    advantagesTitle: string; advantages: string[]; supportTitle: string; supportText: string;
  };
  title: string;
  updatedAt: string;
};

export type ManualPaymentService = {
  active: boolean;
  amount: number;
  bannerUrl: string | null;
  createServiceChannel: boolean;
  customText: string | null;
  description: string | null;
  id: string;
  manualApproval: boolean;
  name: string;
  order: number;
  serviceType: string;
};

export type ManualPaymentSettings = {
  id: string;
  approveRoleIds: string[];
  attendanceCategoryId: string | null;
  bannerUrl: string | null;
  botId: string;
  color: string;
  enabled: boolean;
  finalizeRoleIds: string[];
  guildId: string;
  logChannelId: string | null;
  logViewRoleIds: string[];
  maxPaymentMinutes: number;
  paymentCategoryId: string | null;
  paymentInstructions: string;
  pixKey: string | null;
  pixKeyType: "cpf" | "cnpj" | "phone" | "email" | "random";
  pixQrCodeUrl: string | null;
  receiverBank: string | null;
  receiverName: string | null;
  rejectRoleIds: string[];
  salePanelChannelId: string | null;
  salePanelDescription: string;
  salePanelMessageId: string | null;
  salePanelTitle: string;
  services: ManualPaymentService[];
  supportPanelChannelId: string | null;
  updatedAt: string;
};

export type ManualPaymentOrderStatus = "PENDING_PAYMENT" | "WAITING_STAFF_APPROVAL" | "APPROVED" | "REJECTED" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "DELIVERED" | "FINISHED" | "CANCELLED_BY_CUSTOMER" | "CANCELLED_BY_STAFF";

export type ManualPaymentOrder = {
  id: string;
  amount: number;
  approvedAt: string | null;
  approvedBy: string | null;
  botId: string;
  createdAt: string;
  finalizedAt: string | null;
  finalizedBy: string | null;
  guildId: string;
  orderNumber: number;
  paidAt: string | null;
  paymentChannelId: string | null;
  paymentMessageId: string | null;
  paymentMethod: "PIX_KEY" | "PIX_QR_CODE" | null;
  proofMessageId: string | null;
  proofUrl: string | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
  serviceChannelId: string | null;
  serviceId: string;
  serviceName: string;
  staffMessageId: string | null;
  status: ManualPaymentOrderStatus;
  updatedAt: string;
  userId: string;
  username: string | null;
};

export type BotGuildRuntimeConfig = {
  id: string;
  botId: string;
  guildId: string;
  guildName: string;
  modules: Record<string, Record<string, unknown>>;
  enabledModules: string[];
  createdAt: string;
  updatedAt: string;
};

export type TagVerificationRuntimeStatus = {
  lastCheckAt: string;
  nextCheckAt: string | null;
  totalChecked: number;
  totalAssigned: number;
  totalRemoved: number;
  totalIgnored: number;
  totalUnavailable: number;
  totalErrors: number;
  lastError: string | null;
};

export class ApiClient {
  private readonly http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: env.BACKEND_API_URL,
      headers: {
        "x-bot-token": env.BOT_API_TOKEN,
        ...(env.DASHBOARD_BOT_ID ? { "x-dashboard-bot-id": env.DASHBOARD_BOT_ID } : {})
      },
      timeout: 8000
    });

    this.http.interceptors.request.use((config) => {
      if (!env.BACKEND_API_URL) {
        throw new Error("BACKEND_API_URL nao configurado.");
      }

      recordApiRequest(config.method, config.url);
      return config;
    });
  }

  setDiscordClientId(clientId: string) {
    this.http.defaults.headers.common["x-discord-bot-client-id"] = clientId;
  }

  async postLog(input: CreateLogInput) {
    const { data } = await this.http.post("/logs", input);
    return data;
  }

  async notifyLive(input: LiveEventInput) {
    const { data } = await this.http.post("/lives/events", input);
    return data;
  }

  async authorizeCommand(input: { channelId?: string | null; commandName: string; guildId: string; userId?: string | null }) {
    try {
      const { data } = await this.http.post<{ authorization: BotCommandAuthorization }>(
        `/bot/guilds/${input.guildId}/commands/${encodeURIComponent(input.commandName)}/authorize`,
        {
          channelId: input.channelId ?? null,
          userId: input.userId ?? null
        },
        {
          timeout: 10_000
        }
      );

      return data.authorization;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const authorization = readAuthorizationResponse(error.response?.data);

        if (authorization) {
          return authorization;
        }
      }

      throw error;
    }
  }

  async getRuntimeModules() {
    const { data } = await this.http.get<BotRuntimeModules>("/bot/runtime/modules");
    return data;
  }

  async reportRuntimeStatus(input: BotRuntimeStatusInput) {
    const { data } = await this.http.post<{ botId: string; status: BotRuntimeModules["status"] }>(
      "/bot/runtime/status",
      input,
      {
        timeout: 8_000
      }
    );
    return data;
  }

  async getMaintenanceState() {
    const { data } = await this.http.get<{ maintenance: MaintenanceState }>("/bot/maintenance");
    return data.maintenance;
  }

  async authorizeRuntimeModule(guildId: string, moduleId: string) {
    const { data } = await this.http.get<{ authorization: BotRuntimeModuleAuthorization }>(
      `/bot/runtime/guilds/${guildId}/modules/${encodeURIComponent(moduleId)}/authorize`,
      {
        timeout: 8_000
      }
    );
    return data.authorization;
  }

  async getAntiBanConfig(guildId: string) {
    const { data } = await this.http.get<{ config: AntiBanConfig }>(`/anti-ban/bot/${guildId}`, { timeout: 8_000 });
    return data.config;
  }

  async createAntiBanLog(guildId: string, input: {
    executorId: string | null;
    targetId: string | null;
    actionType: string;
    amount: number;
    limit: number;
    punishment: string;
    success: boolean;
    errorMessage: string | null;
    metadata?: unknown;
  }) {
    const { data } = await this.http.post(`/anti-ban/bot/${guildId}/logs`, input, { timeout: 8_000 });
    return data;
  }

  async getBotGuildConfig(botId: string, guildId: string) {
    const { data } = await this.http.get<BotGuildRuntimeConfig>(
      `/bot/${encodeURIComponent(botId)}/guild/${encodeURIComponent(guildId)}/config`,
      {
        timeout: 8_000
      }
    );

    return data;
  }

  async reportTagVerificationStatus(guildId: string, status: TagVerificationRuntimeStatus) {
    const { data } = await this.http.post<{ ok: boolean }>(
      `/bot/runtime/guilds/${encodeURIComponent(guildId)}/tag-verification/status`,
      status,
      { timeout: 8_000 }
    );
    return data;
  }

  async notifyApplicationEmojiGuildEvent(input: {
    action: "created" | "deleted" | "updated";
    animated: boolean;
    emojiId: string;
    guildId: string;
    name: string;
  }) {
    const { data } = await this.http.post("/emoji-cloner/application/bot/guild-event", input, {
      timeout: 15_000
    });
    return data;
  }

  async createTicket(input: {
    allowedRoleIds?: string[];
    categoryId?: string | null;
    categoryName?: string | null;
    guildId: string;
    channelId?: string | null;
    openerId: string;
    responsibleRoleId?: string | null;
    status?: string;
    subject: string;
  }) {
    const { data } = await this.http.post("/tickets", input);
    return data as { ticket: TicketRecord };
  }

  async resolveHierarchyForwarding(guildId: string, denouncedRoleIds: string[]) {
    const { data } = await this.http.post<{ rule: HierarchyForwardingRule }>(`/report-forwarding/bot/${guildId}/resolve`, {
      denouncedRoleIds
    });
    return data.rule;
  }

  async getTicketByChannel(channelId: string) {
    const { data } = await this.http.get<{ ticket: TicketRecord | null }>(`/tickets/bot/channel/${channelId}`);
    return data.ticket;
  }

  async getTicket(ticketId: string) {
    const { data } = await this.http.get<{ ticket: TicketRecord | null }>(`/tickets/bot/${ticketId}`);
    return data.ticket;
  }

  async updateTicketStatus(ticketId: string, input: Record<string, unknown>) {
    const { data } = await this.http.patch<{ ticket: TicketRecord | null }>(`/tickets/bot/${ticketId}/status`, input);
    return data.ticket;
  }

  async claimTicket(ticketId: string, responsibleUserId: string) {
    try {
      const { data } = await this.http.post<{ claimed: boolean; ticket: TicketRecord | null }>(`/tickets/bot/${ticketId}/claim`, { responsibleUserId });
      return data;
    } catch (error) {
      if (typeof error === "object" && error && "response" in error) {
        const response = (error as { response?: { data?: { claimed?: boolean; ticket?: TicketRecord | null }; status?: number } }).response;
        if (response?.status === 409) return { claimed: false, ticket: response.data?.ticket ?? null };
      }
      throw error;
    }
  }

  async recordTicketEvent(ticketId: string, input: { authorId?: string | null; content: string; eventType: string; guildId: string; metadata?: Record<string, unknown> }) {
    await this.http.post(`/tickets/bot/${ticketId}/events`, input);
  }

  async createTranscript(input: Record<string, unknown>) {
    const { data } = await this.http.post<TranscriptCreateResult>("/transcripts/bot", input, { timeout: 60_000 });
    return data;
  }

  async createTranscriptTemporaryPassword(transcriptId: string, ttlHours = 72) {
    const { data } = await this.http.post<{ password: string; expiresAt: string }>(`/transcripts/bot/${transcriptId}/passwords`, { ttlHours });
    return data;
  }

  async revokeTranscriptTemporaryPasswords(transcriptId: string) {
    await this.http.post(`/transcripts/bot/${transcriptId}/passwords/revoke`);
  }

  async getCourseSettings(guildId: string) {
    const { data } = await this.http.get<{ settings: CourseSettings }>(`/courses/bot/${guildId}/settings`);
    return data.settings;
  }

  async getCourseInstructorSettings(guildId: string) {
    const { data } = await this.http.get<{ settings: CourseInstructorSettings }>(`/courses/bot/${guildId}/instructors/settings`);
    return data.settings;
  }

  async getCourseInstructorReport(guildId: string, weekKey?: string | null) {
    const { data } = await this.http.get<CourseInstructorReport>(`/courses/bot/${guildId}/instructors/report`, {
      params: weekKey ? { weekKey } : undefined
    });
    return data;
  }

  async recordCourseInstructorEvent(guildId: string, input: {
    courseId: string;
    courseName: string;
    instructorId: string;
    instructorName?: string | null;
    publicationId?: string | null;
    status: "started" | "cancelled" | "finished" | "closed";
    timestamp?: string | null;
  }) {
    const { data } = await this.http.post<{ event: CourseInstructorEvent | null }>(`/courses/bot/${guildId}/instructors/events`, input);
    return data.event;
  }

  async getCourseHistorySettings(guildId: string) {
    const { data } = await this.http.get<{ settings: CourseHistorySettings }>(`/courses/bot/${guildId}/history/settings`);
    return data.settings;
  }

  async listCourseStudentHistory(guildId: string, studentId: string, page = 0) {
    const { data } = await this.http.get<CourseStudentHistoryPage>(`/courses/bot/${guildId}/history/${studentId}`, {
      params: { page }
    });
    return data;
  }

  async removeCourseStudentHistory(guildId: string, historyId: string, input: { actorId: string; reason?: string | null }) {
    const { data } = await this.http.delete<{ item: CourseStudentHistory }>(`/courses/bot/${guildId}/history/items/${historyId}`, { data: input });
    return data.item;
  }

  async saveCourseSettings(guildId: string, input: Partial<CourseSettings>, actorId?: string | null) {
    const { data } = await this.http.post<{ settings: CourseSettings }>(`/courses/bot/${guildId}/settings`, input, {
      headers: actorId ? { "x-actor-id": actorId } : undefined
    });
    return data.settings;
  }

  async updateCoursePanelMessage(guildId: string, messageId: string | null) {
    const { data } = await this.http.patch<{ settings: CourseSettings }>(`/courses/bot/${guildId}/panel-message`, { messageId });
    return data.settings;
  }

  async createCourse(guildId: string, input: Partial<Course> & { name: string }, actorId?: string | null) {
    const { data } = await this.http.post<{ course: Course }>(`/courses/bot/${guildId}/courses`, input, {
      headers: actorId ? { "x-actor-id": actorId } : undefined
    });
    return data.course;
  }

  async updateCourse(guildId: string, courseId: string, input: Partial<Course>, actorId?: string | null) {
    const { data } = await this.http.patch<{ course: Course }>(`/courses/bot/${guildId}/courses/${courseId}`, input, {
      headers: actorId ? { "x-actor-id": actorId } : undefined
    });
    return data.course;
  }

  async getCourse(guildId: string, courseId: string) {
    const { data } = await this.http.get<{ course: Course }>(`/courses/bot/${guildId}/courses/${courseId}`);
    return data.course;
  }

  async listCourseDepartments(guildId: string, activeOnly = false) {
    const { data } = await this.http.get<{ departments: CourseDepartment[] }>(`/courses/bot/${guildId}/departments`, {
      params: activeOnly ? { activeOnly: "true" } : undefined
    });
    return data.departments;
  }

  async createCourseDepartment(guildId: string, name: string, actorId: string) {
    const { data } = await this.http.post<{ department: CourseDepartment }>(`/courses/bot/${guildId}/departments`, { name }, { headers: { "x-actor-id": actorId } });
    return data.department;
  }

  async updateCourseDepartment(guildId: string, departmentId: string, input: { active?: boolean; name?: string }, actorId: string) {
    const { data } = await this.http.patch<{ department: CourseDepartment }>(`/courses/bot/${guildId}/departments/${departmentId}`, input, { headers: { "x-actor-id": actorId } });
    return data.department;
  }

  async deleteCourseDepartment(guildId: string, departmentId: string, actorId: string) {
    const { data } = await this.http.delete<{ deleted: boolean; department: CourseDepartment }>(`/courses/bot/${guildId}/departments/${departmentId}`, { headers: { "x-actor-id": actorId } });
    return data;
  }

  async getManageableCourses(guildId: string, input: { isAdministrator?: boolean; roleIds: string[]; userId: string }) {
    const { data } = await this.http.post<{ courses: Course[] }>(`/courses/bot/${guildId}/manageable`, input);
    return data.courses;
  }

  async createCoursePublication(guildId: string, input: {
    capacity: number;
    channelId: string;
    courseId: string;
    discordEventType?: "EXTERNAL" | "VOICE" | "STAGE" | null;
    dpId?: string | null;
    dpNameSnapshot?: string | null;
    instructorId: string;
    legacyLocation?: string | null;
    location: string;
    notes?: string | null;
    scheduledFor: string;
    scheduledStartAt?: string | null;
    scheduledEndAt?: string | null;
    voiceChannelId?: string | null;
  }) {
    const { data } = await this.http.post<{ publication: CoursePublication }>(`/courses/bot/${guildId}/publications`, input);
    return data.publication;
  }

  async getCoursePublication(guildId: string, publicationId: string) {
    const { data } = await this.http.get<{ publication: CoursePublication }>(`/courses/bot/${guildId}/publications/${publicationId}`);
    return data.publication;
  }

  async getCoursePublicationEnrollments(guildId: string, publicationId: string) {
    const { data } = await this.http.get<{ enrollments: CourseEnrollment[] }>(`/courses/bot/${guildId}/publications/${publicationId}/enrollments`);
    return data.enrollments;
  }

  async reserveCourseExamStart(guildId: string, publicationId: string, studentId: string) {
    const { data } = await this.http.post<{ error?: "not_found" | "not_enrolled" | "cancelled" | "finished" | "not_started" | "exam_missing" | "exam_disabled" | "completed" | "in_progress"; enrollment?: CourseEnrollment }>(`/courses/bot/${guildId}/publications/${publicationId}/exam-reservation`, { studentId });
    return data;
  }

  async releaseCourseExamStart(guildId: string, publicationId: string, studentId: string) {
    await this.http.delete(`/courses/bot/${guildId}/publications/${publicationId}/exam-reservation`, { data: { studentId } });
  }

  async listCoursePublications(guildId: string, status?: CoursePublication["status"] | null) {
    const { data } = await this.http.get<{ publications: CoursePublication[] }>(`/courses/bot/${guildId}/publications`, {
      params: status ? { status } : undefined
    });
    return data.publications;
  }

  async updateCoursePublicationMessage(guildId: string, publicationId: string, messageId: string | null) {
    const { data } = await this.http.patch<{ publication: CoursePublication }>(`/courses/bot/${guildId}/publications/${publicationId}/message`, { messageId });
    return data.publication;
  }

  async updateCoursePublicationEvent(guildId: string, publicationId: string, input: { discordEventId?: string | null; discordEventUrl?: string | null; syncError?: string | null }) {
    const { data } = await this.http.patch<{ publication: CoursePublication }>(`/courses/bot/${guildId}/publications/${publicationId}/event`, input);
    return data.publication;
  }

  async joinCoursePublication(guildId: string, publicationId: string, userId: string, studentName: string) {
    const { data } = await this.http.post<{ error?: "not_found" | "started" | "closed" | "already" | "full"; publication?: CoursePublication }>(`/courses/bot/${guildId}/publications/${publicationId}/join`, { studentName, userId });
    return data;
  }

  async leaveCoursePublication(guildId: string, publicationId: string, userId: string) {
    const { data } = await this.http.post<{ error?: "not_found" | "not_joined" | "closed"; publication?: CoursePublication }>(`/courses/bot/${guildId}/publications/${publicationId}/leave`, { userId });
    return data;
  }

  async setCourseEnrollmentExamChannel(guildId: string, publicationId: string, input: { channelId: string; studentId: string; studentName: string }) {
    await this.http.patch(`/courses/bot/${guildId}/publications/${publicationId}/enrollment-channel`, input);
  }

  async expireCourseEnrollmentChannel(guildId: string, channelId: string) {
    await this.http.delete(`/courses/bot/${guildId}/exam-channels/${channelId}`);
  }

  async setCoursePublicationStatus(guildId: string, publicationId: string, status: "started" | "cancelled" | "closed" | "proof" | "finished", actorId: string) {
    const { data } = await this.http.post<{ publication: CoursePublication }>(`/courses/bot/${guildId}/publications/${publicationId}/status`, { actorId, status });
    return data.publication;
  }

  async createCourseSchedule(guildId: string, input: {
    channelId?: string | null;
    courseId: string;
    instructorId: string;
    location: string;
    notes?: string | null;
    requestedDate: string;
    requestedTime: string;
  }) {
    const { data } = await this.http.post<{ request: CourseScheduleRequest }>(`/courses/bot/${guildId}/schedules`, input);
    return data.request;
  }

  async getCourseSchedule(guildId: string, requestId: string) {
    const { data } = await this.http.get<{ request: CourseScheduleRequest }>(`/courses/bot/${guildId}/schedules/${requestId}`);
    return data.request;
  }

  async updateCourseScheduleMessage(guildId: string, requestId: string, messageId: string | null) {
    const { data } = await this.http.patch<{ request: CourseScheduleRequest }>(`/courses/bot/${guildId}/schedules/${requestId}/message`, { messageId });
    return data.request;
  }

  async decideCourseSchedule(guildId: string, requestId: string, status: "approved" | "rejected", actorId: string) {
    const { data } = await this.http.post<{ request: CourseScheduleRequest }>(`/courses/bot/${guildId}/schedules/${requestId}/decision`, { actorId, status });
    return data.request;
  }

  async createCourseReport(guildId: string, input: {
    channelId?: string | null;
    courseId: string;
    instructorId: string;
    messageId?: string | null;
    reportDate: string;
    reportTime: string;
    students: Array<{ note: string; observation?: string | null; userId: string }>;
  }) {
    const { data } = await this.http.post<{ report: CourseReport }>(`/courses/bot/${guildId}/reports`, input);
    return data.report;
  }

  async getCourseExamRuntime(guildId: string, courseId: string) {
    const { data } = await this.http.get<{ questions: CourseExamQuestion[]; settings: CourseExamSettings }>(`/courses/bot/${guildId}/courses/${courseId}/exam`);
    return data;
  }

  async createCourseExamAttempt(guildId: string, input: { channelId: string; courseId: string; instructorId: string; publicationId: string; questionsSnapshot?: CourseExamQuestion[]; studentId: string }) {
    const { data } = await this.http.post<{ attempt: CourseExamAttempt }>(`/courses/bot/${guildId}/exam-attempts`, input);
    return data.attempt;
  }

  async getCourseExamAttemptByChannel(guildId: string, channelId: string) {
    const { data } = await this.http.get<{ attempt: CourseExamAttempt | null }>(`/courses/bot/${guildId}/exam-attempts/channel/${channelId}`);
    return data.attempt;
  }

  async getCourseExamAttempt(guildId: string, attemptId: string) {
    const { data } = await this.http.get<{ answers: CourseExamAnswer[]; attempt: CourseExamAttempt; questions: CourseExamQuestion[] }>(`/courses/bot/${guildId}/exam-attempts/${attemptId}`);
    return data;
  }

  async listPendingCourseExamCorrections(guildId: string) {
    const { data } = await this.http.get<{ attempts: CourseExamAttempt[] }>(`/courses/bot/${guildId}/exam-attempts/pending-corrections`);
    return data.attempts;
  }

  async updateCourseExamIdentification(guildId: string, attemptId: string, input: {
    discordUsername?: string | null;
    discordDisplayName?: string | null;
    guildNickname?: string | null;
    rpFullName?: string | null;
    currentRank?: "CADET" | "OFFICER" | "SENIOR_OFFICER" | null;
    rpId?: string | null;
    confirm?: boolean;
  }) {
    const { data } = await this.http.patch<{ attempt: CourseExamAttempt }>(`/courses/bot/${guildId}/exam-attempts/${attemptId}/identification`, input);
    return data.attempt;
  }

  async saveCourseExamAnswer(guildId: string, attemptId: string, input: { questionId?: string | null; questionIndex?: number | null; selectedAlternativeId?: string | null; selectedAlternativeIds?: string[] | null; writtenAnswer?: string | null }) {
    const { data } = await this.http.post<{ answer: CourseExamAnswer }>(`/courses/bot/${guildId}/exam-attempts/${attemptId}/answers`, input);
    return data.answer;
  }

  async finalizeCourseExamAttempt(guildId: string, attemptId: string) {
    const { data } = await this.http.post<{ answers: CourseExamAnswer[]; attempt: CourseExamAttempt; questions: CourseExamQuestion[] }>(`/courses/bot/${guildId}/exam-attempts/${attemptId}/finalize`, {});
    return data;
  }

  async reviewCourseExamAttempt(guildId: string, attemptId: string, input: { actorId: string; manualScore?: number | null; rejectionReason?: string | null; status: "approved" | "rejected" }) {
    const { data } = await this.http.post<{ attempt: CourseExamAttempt }>(`/courses/bot/${guildId}/exam-attempts/${attemptId}/review`, input);
    return data.attempt;
  }

  async setCourseExamCorrectionMessage(guildId: string, attemptId: string, messageId: string) {
    await this.http.patch(`/courses/bot/${guildId}/exam-attempts/${attemptId}/correction-message`, { messageId });
  }

  async setCourseExamCorrectionDelivery(guildId: string, attemptId: string, input: { channelId: string; messageId: string }) {
    await this.http.patch(`/courses/bot/${guildId}/exam-attempts/${attemptId}/correction-delivery`, input);
  }

  async setCourseExamResultDelivery(guildId: string, attemptId: string, input: { channelId: string; messageId: string }) {
    await this.http.patch(`/courses/bot/${guildId}/exam-attempts/${attemptId}/result-delivery`, input);
  }

  async getRhAdminSettings(guildId: string) {
    const { data } = await this.http.get<{ settings: RhAdminSettings }>(`/rh-admin/bot/${guildId}/settings`);
    return data.settings;
  }

  async saveRhAdminSettings(guildId: string, input: Partial<RhAdminSettings>, actorId?: string | null) {
    const { data } = await this.http.post<{ settings: RhAdminSettings }>(`/rh-admin/bot/${guildId}/settings`, input, {
      headers: actorId ? { "x-actor-id": actorId } : undefined
    });
    return data.settings;
  }

  async canApproveRhAbsence(guildId: string, input: { isAdministrator?: boolean; roleIds: string[]; userId: string }) {
    const { data } = await this.http.post<{ allowed: boolean }>(`/rh-admin/bot/${guildId}/permissions/approver`, input);
    return data.allowed;
  }

  async createRhAbsence(guildId: string, input: { reason: string; returnAt: string; returnDate: string; serverName: string; startAt: string; startDate: string; userId: string }) {
    const { data } = await this.http.post<{ absence: RhAdminAbsence }>(`/rh-admin/bot/${guildId}/absences`, input);
    return data.absence;
  }

  async getRhAbsence(guildId: string, absenceId: string) {
    const { data } = await this.http.get<{ absence: RhAdminAbsence }>(`/rh-admin/bot/${guildId}/absences/${absenceId}`);
    return data.absence;
  }

  async updateRhAbsenceMessage(guildId: string, absenceId: string, input: { reviewChannelId?: string | null; reviewMessageId?: string | null }) {
    const { data } = await this.http.patch<{ absence: RhAdminAbsence }>(`/rh-admin/bot/${guildId}/absences/${absenceId}/message`, input);
    return data.absence;
  }

  async decideRhAbsence(guildId: string, absenceId: string, input: { actorId: string; isAdministrator?: boolean; rejectionReason?: string | null; roleIds: string[]; status: "approved" | "rejected" }) {
    const { data } = await this.http.post<RhAdminAbsenceActionResult>(`/rh-admin/bot/${guildId}/absences/${absenceId}/decision`, input);
    return data;
  }

  async markRhAbsenceRoleAdded(guildId: string, absenceId: string, roleAdded = true) {
    const { data } = await this.http.post<{ absence: RhAdminAbsence }>(`/rh-admin/bot/${guildId}/absences/${absenceId}/role-added`, { roleAdded });
    return data.absence;
  }

  async finishRhAbsence(guildId: string, absenceId: string, input: { dmDelivered?: boolean | null; roleRemoved?: boolean }) {
    const { data } = await this.http.post<RhAdminAbsenceActionResult>(`/rh-admin/bot/${guildId}/absences/${absenceId}/finish`, input);
    return data;
  }

  async getDueRhAbsences() {
    const { data } = await this.http.get<{ absences: RhAdminAbsence[] }>("/rh-admin/bot/absences/due");
    return data.absences;
  }

  async createRhAdornment(guildId: string, input: { imageUrl: string; number: string; observation?: string | null; serverName: string; userId: string }) {
    const { data } = await this.http.post<{ adornment: RhAdminAdornment }>(`/rh-admin/bot/${guildId}/adornments`, input);
    return data.adornment;
  }

  async updateRhAdornmentMessage(guildId: string, adornmentId: string, input: { channelId?: string | null; messageId?: string | null }) {
    const { data } = await this.http.patch<{ adornment: RhAdminAdornment }>(`/rh-admin/bot/${guildId}/adornments/${adornmentId}/message`, input);
    return data.adornment;
  }

  async createRhAdminLog(guildId: string, input: { action: string; actorId?: string | null; channelId?: string | null; description: string; metadata?: Record<string, unknown>; status?: "success" | "warning" | "error" | "denied" | "info"; userId?: string | null }) {
    await this.http.post(`/rh-admin/bot/${guildId}/logs`, input);
  }

  async getSettings(guildId: string, discordBotClientId?: string | null) {
    const { data } = await this.http.get<{ settings: GuildSettings }>(`/settings/${guildId}`, {
      headers: discordBotClientId
        ? {
            "x-discord-bot-client-id": discordBotClientId
          }
        : undefined
    });
    return data.settings;
  }

  async updateSettingsFromBot(guildId: string, input: Partial<GuildSettings>) {
    const { data } = await this.http.patch<{ settings: GuildSettings }>(`/settings/bot/${guildId}`, input);
    return data.settings;
  }

  async updateTicketPanelState(guildId: string, input: { channelId?: string | null; messageId?: string | null }) {
    const patch: Partial<GuildSettings> = {};
    if ("channelId" in input) patch.ticketPanelChannelId = input.channelId ?? null;
    if ("messageId" in input) patch.ticketPanelMessageId = input.messageId ?? null;
    return this.updateSettingsFromBot(guildId, patch);
  }

  async getManualRegistrationSettings(guildId: string) {
    const { data } = await this.http.get<{ settings: ManualRegistrationSettings }>(`/manual-registration/${guildId}/settings`);
    return data.settings;
  }

  async createManualRegistrationSubmission(input: {
    fields: Array<{ id: string; label: string; value: string }>;
    guildId: string;
    messageId?: string | null;
    requestedRoleId?: string | null;
    userAvatar?: string | null;
    userId: string;
    username: string;
    registrationType?: "request" | "manual";
  }) {
    const { data } = await this.http.post<{ submission: ManualRegistrationSubmission }>("/manual-registration/bot/submissions", input);
    return data.submission;
  }

  async getLatestManualRegistrationSubmission(guildId: string, userId: string) {
    const { data } = await this.http.get<{ submission: ManualRegistrationSubmission | null }>(`/manual-registration/bot/${guildId}/users/${userId}/submission`);
    return data.submission;
  }

  async updateManualRegistrationSubmissionMessage(id: string, messageId: string | null) {
    await this.http.patch(`/manual-registration/bot/submissions/${id}/message`, { messageId });
  }
  async updateManualRegistrationSubmissionChannel(id: string, channelId: string, messageId: string | null) { const {data}=await this.http.patch<{submission:ManualRegistrationSubmission}>(`/manual-registration/bot/submissions/${id}/message`,{channelId,messageId}); return data.submission; }

  async reviewManualRegistrationSubmission(input: { actorId: string; actorRoleIds?: string[]; actorIsAdministrator?: boolean; guildId: string; id: string; rejectionReason?: string | null; status: "approved" | "rejected" }) {
    const { data } = await this.http.patch<{ submission: ManualRegistrationSubmission }>(`/manual-registration/bot/submissions/${input.id}/status`, input);
    return data.submission;
  }

  async updateManualRegistrationSubmissionRole(input: { actorId: string; guildId: string; id: string; requestedRoleId: string }) {
    const { data } = await this.http.patch<{ submission: ManualRegistrationSubmission }>(`/manual-registration/bot/submissions/${input.id}/role`, input);
    return data.submission;
  }

  async saveManualRegistrationSettings(guildId: string, input: Partial<ManualRegistrationSettings>) {
    const { data } = await this.http.put<{ settings: ManualRegistrationSettings }>(`/manual-registration/bot/${guildId}/settings`, input);
    return data.settings;
  }

  async cleanupUserLinksAfterGuildLeave(guildId: string, userId: string) {
    const { data } = await this.http.post<{
      result: {
        botId: string | null;
        channelIds: string[];
        deletedTotal: number;
        errors: Array<{ collection: string; message: string; module: string }>;
        guildId: string;
        modules: Array<{ collection: string; deleted: number; module: string }>;
        userId: string;
      };
    }>(`/database-maintenance/bot/guilds/${encodeURIComponent(guildId)}/member-left/${encodeURIComponent(userId)}`, undefined, {
      timeout: 30_000
    });
    return data.result;
  }

  async getSystemEmojis() {
    const { data } = await this.http.get<SystemEmojiRuntimeConfig>("/bot/system-emojis");
    return data;
  }

  async reportSystemEmojiValidation(input: SystemEmojiValidationPayload) {
    const { data } = await this.http.post("/bot/system-emojis/validation", input);
    return data;
  }

  async reportNexTechSaleDeliveryResult(guildId: string, input: {
    deliveredRoleIds?: string[];
    error?: string | null;
    messageId?: string | null;
    saleId: string;
    status: "delivered" | "partial" | "failed";
  }) {
    const { data } = await this.http.post(`/bot/guilds/${guildId}/nex-tech-sales/delivery-result`, input);
    return data;
  }

  async recordGlobalBlacklistSafeBotInfraction(input: {
    actionTaken?: string | null;
    actorId?: string | null;
    evidence?: Record<string, unknown>;
    guildId: string;
    infractionType: string;
    reason: string;
    safeBotModule?: string | null;
    userId: string;
  }) {
    const { data } = await this.http.post("/global-blacklist/bot/safebot/infractions", input);
    return data;
  }

  async getFivemGoalSettings(guildId: string) {
    const { data } = await this.http.get<{ configs?: FivemGoalConfig[]; settings: FivemGoalSettings }>(`/fivem/bot/goals/${guildId}`);
    return { ...data.settings, configs: data.configs ?? [] };
  }

  async getFivemOrderRuntime(guildId: string) {
    const { data } = await this.http.get<{ families: FivemOrderFamily[]; products: FivemOrderProduct[]; settings: FivemOrderSettings }>(`/fivem-orders/bot/${guildId}/runtime`);
    return data;
  }

  async getPanelVisualSettings(guildId: string, panelId: string) {
    const { data } = await this.http.get<{ settings: { blocks?: import("./panelVisualRenderer").PanelBlock[]; imageEnabled: boolean; imagePosition: import("./panelVisualRenderer").PanelVisualPosition; imageUrl: string; useGlobalDefault: boolean } }>(`/panel-images/bot/${guildId}/${encodeURIComponent(panelId)}`);
    return data.settings;
  }

  async createFivemOrder(input: { clientName: string; expectedDelivery?: string | null; familyId: string; grossValue?: number | null; guildId: string; notes?: string | null; productId: string; proofUrl?: string | null; quantity: number; sourceId?: string | null; userId: string; washingPercentage?: number | null }) {
    const { data } = await this.http.post<{ order: FivemOrder }>("/fivem-orders/bot/orders", input);
    return data.order;
  }

  async getFivemOrder(guildId: string, orderNumber: number, userId?: string | null) {
    const { data } = await this.http.get<{ order: FivemOrder | null }>(`/fivem-orders/bot/${guildId}/orders/${orderNumber}`, { params: userId ? { userId } : undefined });
    return data.order;
  }

  async updateFivemOrderStatus(input: { actorId: string; guildId: string; note?: string | null; orderId: string; status: FivemOrderStatus }) {
    const { data } = await this.http.patch<{ order: FivemOrder }>(`/fivem-orders/bot/orders/${input.orderId}/status`, input);
    return data.order;
  }

  async createFivemOrderProduct(guildId: string, input: Partial<FivemOrderProduct> & { actorId: string }) {
    const { data } = await this.http.post<{ product: FivemOrderProduct }>(`/fivem-orders/bot/${guildId}/products`, input);
    return data.product;
  }

  async createFivemOrderFamily(guildId: string, input: Partial<FivemOrderFamily> & { actorId: string }) {
    const { data } = await this.http.post<{ family: FivemOrderFamily }>(`/fivem-orders/bot/${guildId}/families`, input);
    return data.family;
  }

  async updateFivemOrderFamily(guildId: string, familyId: string, input: Partial<FivemOrderFamily> & { actorId: string }) {
    const { data } = await this.http.patch<{ family: FivemOrderFamily }>(`/fivem-orders/bot/${guildId}/families/${familyId}`, input);
    return data.family;
  }

  async deleteFivemOrderFamily(guildId: string, familyId: string, actorId: string) {
    const { data } = await this.http.delete<{ family: FivemOrderFamily }>(`/fivem-orders/bot/${guildId}/families/${familyId}`, { params: { actorId } });
    return data.family;
  }

  async updateFivemOrderProduct(guildId: string, productId: string, input: Partial<FivemOrderProduct> & { actorId: string }) {
    const { data } = await this.http.patch<{ product: FivemOrderProduct }>(`/fivem-orders/bot/${guildId}/products/${productId}`, input);
    return data.product;
  }

  async deleteFivemOrderProduct(guildId: string, productId: string, actorId: string) {
    await this.http.delete(`/fivem-orders/bot/${guildId}/products/${productId}`, { params: { actorId } });
  }

  async updateFivemOrderPanelState(guildId: string, messageId: string | null) {
    const { data } = await this.http.put<{ settings: FivemOrderSettings }>(`/fivem-orders/bot/${guildId}/panel-state`, { messageId });
    return data.settings;
  }

  async getPriceTableRuntime(guildId: string, tableId: string) {
    const { data } = await this.http.get<{ table: PriceTable }>(`/price-tables/bot/${guildId}/${tableId}/runtime`);
    return data.table;
  }

  async updatePriceTablePanelState(guildId: string, tableId: string, messageId: string | null) {
    const { data } = await this.http.put<{ table: PriceTable | null }>(`/price-tables/bot/${guildId}/${tableId}/panel-state`, { messageId });
    return data.table;
  }

  async createPriceTableRequest(guildId: string, input: {
    contact: string;
    details: string;
    itemId?: string | null;
    itemName: string;
    tableId: string;
    ticketChannelId?: string | null;
    userId: string;
    userName: string;
  }) {
    const { data } = await this.http.post(`/price-tables/bot/${guildId}/requests`, input);
    return data;
  }

  async getManualPaymentRuntime(guildId: string) {
    const { data } = await this.http.get<{ orders: ManualPaymentOrder[]; settings: ManualPaymentSettings }>(`/manual-payments/bot/${guildId}/runtime`);
    return data;
  }

  async updateManualPaymentPanelState(guildId: string, messageId: string | null) {
    const { data } = await this.http.put<{ settings: ManualPaymentSettings }>(`/manual-payments/bot/${guildId}/panel-state`, { messageId });
    return data.settings;
  }

  async createManualPaymentOrder(guildId: string, input: { serviceId: string; userId: string; username?: string | null }) {
    const { data } = await this.http.post<{ order: ManualPaymentOrder }>(`/manual-payments/bot/${guildId}/orders`, input);
    return data.order;
  }

  async getManualPaymentOrder(guildId: string, orderId: string) {
    const { data } = await this.http.get<{ order: ManualPaymentOrder | null }>(`/manual-payments/bot/${guildId}/orders/${orderId}`);
    return data.order;
  }

  async updateManualPaymentOrder(guildId: string, orderId: string, input: Partial<{
    action: string;
    channelId: string | null;
    paymentChannelId: string | null;
    paymentMessageId: string | null;
    paymentMethod: "PIX_KEY" | "PIX_QR_CODE" | null;
    proofMessageId: string | null;
    proofUrl: string | null;
    reason: string | null;
    serviceChannelId: string | null;
    staffId: string | null;
    staffMessageId: string | null;
    status: ManualPaymentOrderStatus;
  }>) {
    const { data } = await this.http.patch<{ order: ManualPaymentOrder }>(`/manual-payments/bot/${guildId}/orders/${orderId}`, input);
    return data.order;
  }

  async getFivemFinanceRuntime(guildId: string) {
    const { data } = await this.http.get<{ settings: FivemFinanceSettings; transactions: FivemFinanceTransaction[] }>(`/fivem-finance/bot/${guildId}/runtime`);
    return data;
  }

  async createFivemFinanceTransaction(guildId: string, input: { amount: number; logChannelId?: string | null; logMessageId?: string | null; proofImageUrl?: string; proofMessageId?: string | null; tempChannelId?: string | null; type: "add" | "remove"; userAvatar?: string | null; userId: string; username: string; managerId?:string;managerName?:string;personName?:string;reason?:string;targetUserId?:string }) {
    const { data } = await this.http.post<{ transaction: FivemFinanceTransaction }>(`/fivem-finance/bot/${guildId}/transactions`, input);
    return data.transaction;
  }

  async updateFivemFinanceTransactionLog(guildId: string, transactionId: string, input: { logChannelId?: string | null; logMessageId?: string | null }) {
    const { data } = await this.http.patch<{ transaction: FivemFinanceTransaction }>(`/fivem-finance/bot/${guildId}/transactions/${transactionId}/log`, input);
    return data.transaction;
  }

  async updateFivemFinancePanelState(guildId: string, messageId: string | null) {
    const { data } = await this.http.put<{ settings: FivemFinanceSettings }>(`/fivem-finance/bot/${guildId}/panel-state`, { messageId });
    return data.settings;
  }

  async getFivemGoalChannelByChannel(channelId: string) {
    const { data } = await this.http.get<{ channel: FivemGoalUserChannel | null }>(`/fivem/bot/goals/channel/${channelId}`);
    return data.channel;
  }

  async getFivemGoalChannelByUser(guildId: string, userId: string) {
    const { data } = await this.http.get<{ channel: FivemGoalUserChannel | null }>(`/fivem/bot/goals/${guildId}/users/${userId}/channel`);
    return data.channel;
  }

  async getFivemGoalUserRuntime(guildId: string, userId: string) {
    const { data } = await this.http.get<FivemGoalUserRuntime>(`/fivem/bot/goals/${guildId}/users/${userId}/runtime`);
    return data;
  }

  async saveFivemGoalChannel(input: { channelId: string; guildId: string; userId: string }) {
    const { data } = await this.http.post<{ channel: FivemGoalUserChannel }>("/fivem/bot/goals/channels", input);
    return data.channel;
  }

  async createFivemGoalEntry(input: {
    channelId: string;
    fields: Array<{ id: string; label: string; value: string }>;
    guildId: string;
    imageUrl: string;
    itemId?: string | null;
    metaId?: string | null;
    quantity?: number | null;
    roleIdsSnapshot?: string[];
    userId: string;
  }) {
    const { data } = await this.http.post("/fivem/bot/goals/entries", input);
    return data;
  }

  async updateFivemGoalPanelState(input: { guildId: string; messageId?: string | null }) {
    const { data } = await this.http.post<{ settings: FivemGoalSettings }>("/fivem/bot/goals/panel-state", input);
    return data.settings;
  }

  async getActiveFivemHierarchyPanels() {
    const { data } = await this.http.get<{ panels: FivemHierarchyPanel[] }>("/fivem/bot/hierarchy/configs");
    return data.panels;
  }

  async getManageableFivemHierarchyPanels(input: { actorId: string; actorRoleIds: string[]; guildId: string; isGuildManager: boolean }) {
    const { data } = await this.http.post<{ panels: FivemHierarchyPanel[] }>("/fivem/bot/hierarchy/manageable", input);
    return data.panels;
  }

  async recordFivemHierarchyAudit(input: { action: string; details?: Record<string, unknown>; guildId: string; panelId?: string | null; userId?: string | null }) {
    await this.http.post("/fivem/bot/hierarchy/audit", input);
  }

  async createFivemHierarchyPanelFromBot(input: { actorId: string; actorRoleIds: string[]; clientRequestId: string; guildId: string; isGuildManager: boolean; panel: Partial<FivemHierarchyPanel> }) {
    const { data } = await this.http.post<{ panel: FivemHierarchyPanel }>("/fivem/bot/hierarchy/panels", input);
    return data.panel;
  }

  async updateFivemHierarchyPanelFromBot(panelId: string, input: { actorId: string; actorRoleIds: string[]; guildId: string; isGuildManager: boolean; panel: Partial<FivemHierarchyPanel> }) {
    const { data } = await this.http.patch<{ panel: FivemHierarchyPanel }>(`/fivem/bot/hierarchy/panels/${encodeURIComponent(panelId)}`, input);
    return data.panel;
  }

  async deleteFivemHierarchyPanelFromBot(panelId: string, input: { actorId: string; actorRoleIds: string[]; guildId: string; isGuildManager: boolean }) {
    const { data } = await this.http.delete<{ panel: FivemHierarchyPanel | null }>(`/fivem/bot/hierarchy/panels/${encodeURIComponent(panelId)}`, { data: input });
    return data.panel;
  }

  async publishFivemHierarchyPanelFromBot(panelId: string, input: { actorId: string; actorRoleIds: string[]; guildId: string; isGuildManager: boolean; remove?: boolean }) {
    const { data } = await this.http.post<{ panel: FivemHierarchyPanel }>(`/fivem/bot/hierarchy/panels/${encodeURIComponent(panelId)}/publish`, input);
    return data.panel;
  }

  async updateFivemHierarchyPanelState(input: { configRevision: number; contentHash: string; guildId: string; instanceId: string; lockToken: string; messageId: string; panelId: string; panelVersion?: number }) {
    const { data } = await this.http.post<{ panel: FivemHierarchyPanel | null }>("/fivem/bot/hierarchy/panel-state", input);
    return data.panel;
  }

  async acquireFivemHierarchyPanelLock(input: { guildId: string; instanceId: string; panelId: string; ttlMs?: number }) {
    const { data } = await this.http.post<{ acquired: boolean; configRevision: number; expiresAt: string | null; lockToken: string | null }>("/fivem/bot/hierarchy/panel-lock", { ...input, action: "acquire" });
    return data;
  }

  async releaseFivemHierarchyPanelLock(input: { guildId: string; instanceId: string; lockToken: string; panelId: string }) {
    await this.http.post("/fivem/bot/hierarchy/panel-lock", { ...input, action: "release" });
  }

  async syncSelfBotRole(input: { guildId: string; roleId: string; roleName?: string | null }) {
    const { data } = await this.http.post<{ settings: GuildSettings }>(
      `/settings/bot/${input.guildId}/self-bot-role`,
      {
        roleId: input.roleId,
        roleName: input.roleName ?? undefined
      }
    );
    return data.settings;
  }

  async syncSafeBotSetup(input: {
    filterChannelId: string;
    filterChannelName?: string | null;
    guildId: string;
    logChannelId: string;
    logChannelName?: string | null;
    roleId: string;
    roleName?: string | null;
  }) {
    const { data } = await this.http.post<{ settings: GuildSettings }>(
      `/settings/bot/${input.guildId}/safe-bot-setup`,
      {
        filterChannelId: input.filterChannelId,
        filterChannelName: input.filterChannelName ?? undefined,
        logChannelId: input.logChannelId,
        logChannelName: input.logChannelName ?? undefined,
        roleId: input.roleId,
        roleName: input.roleName ?? undefined
      }
    );
    return data.settings;
  }

  async getSafeBotMessageState(guildId: string) {
    const { data } = await this.http.get<{ state: SafeBotMessageState | null }>(
      `/settings/bot/${guildId}/safe-bot-message`
    );
    return data.state;
  }

  async saveSafeBotMessageState(guildId: string, input: { channelId: string; messageId: string }) {
    const { data } = await this.http.put<{ state: SafeBotMessageState }>(
      `/settings/bot/${guildId}/safe-bot-message`,
      input
    );
    return data.state;
  }

  async clearSafeBotMessageState(guildId: string) {
    await this.http.delete<{ ok: boolean }>(`/settings/bot/${guildId}/safe-bot-message`);
  }

  async getImageAntiSpamSettings(guildId: string) {
    const { data } = await this.http.get<{ settings: ImageAntiSpamSettings }>(
      `/image-anti-spam/bot/${guildId}`
    );
    return data.settings;
  }

  async recordImageAntiSpamIncident(input: {
    guildId: string;
    incidentKey: string;
    userId: string;
    username?: string | null;
    channelId: string;
    channelIds?: string[];
    mediaTypes?: string[];
    messageIds?: string[];
    removedImages: number;
    removedMessages?: number;
  }) {
    const { data } = await this.http.post<ImageAntiSpamIncidentResult>(
      "/image-anti-spam/bot/incidents",
      input
    );
    return data;
  }

  async completeImageAntiSpamIncident(
    incidentId: string,
    input: {
      actionSucceeded: boolean;
      actionError?: string | null;
    }
  ) {
    const { data } = await this.http.patch<{ incident: ImageAntiSpamIncident }>(
      `/image-anti-spam/bot/incidents/${incidentId}`,
      input
    );
    return data.incident;
  }

  async getVoiceRecorderSettings(guildId: string) {
    const { data } = await this.http.get<{ settings: VoiceRecorderSettings }>(
      `/voice-recorder/bot/${guildId}/settings`
    );
    return data.settings;
  }

  async startVoiceRecording(input: {
    actorId: string;
    actorRoleIds: string[];
    actorTag?: string | null;
    channelId: string;
    channelName?: string | null;
    guildId: string;
    guildName?: string | null;
    source: "discord" | "dashboard";
  }) {
    const { data } = await this.http.post<VoiceRecordingStartResult>("/voice-recorder/bot/start", input, {
      timeout: 12_000
    });
    return data;
  }

  async reconcileVoiceRecordings() {
    const { data } = await this.http.post<{ recordings: VoiceRecording[] }>("/voice-recorder/bot/reconcile", {});
    return data.recordings;
  }

  async markVoiceRecordingStarted(recordingId: string, input: {
    channelName?: string | null;
    guildName?: string | null;
  }) {
    const { data } = await this.http.post<{ recording: VoiceRecording }>(
      `/voice-recorder/bot/recordings/${recordingId}/started`,
      input
    );
    return data.recording;
  }

  async stopVoiceRecording(input: {
    actorId: string;
    actorRoleIds: string[];
    actorTag?: string | null;
    guildId: string;
    recordingId?: string | null;
  }) {
    const { data } = await this.http.post<{ recording: VoiceRecording }>("/voice-recorder/bot/stop", input, {
      timeout: 12_000
    });
    return data.recording;
  }

  async markDashboardVoiceRecordingProcessing(recordingId: string, input: {
    actorId: string;
    actorTag?: string | null;
    guildId: string;
  }) {
    const { data } = await this.http.post<{ recording: VoiceRecording }>(
      `/voice-recorder/bot/recordings/${recordingId}/processing`,
      input,
      {
        timeout: 12_000
      }
    );
    return data.recording;
  }

  async completeVoiceRecording(recordingId: string, input: {
    durationMs: number;
    endedAt?: string | null;
    filePath: string;
    fileSize: number;
    participants: Array<{
      userId: string;
      username?: string | null;
      joinedAt: string;
      leftAt?: string | null;
      speakingMs?: number;
    }>;
  }) {
    const { data } = await this.http.post<{ recording: VoiceRecording }>(
      `/voice-recorder/bot/recordings/${recordingId}/complete`,
      input,
      {
        timeout: 20_000
      }
    );
    return data.recording;
  }

  async failVoiceRecording(recordingId: string, input: {
    error: string;
    guildId?: string | null;
  }) {
    const { data } = await this.http.post<{ recording: VoiceRecording | null }>(
      `/voice-recorder/bot/recordings/${recordingId}/fail`,
      input
    );
    return data.recording;
  }

  async recordVoiceRecordingEvent(recordingId: string, input: {
    guildId: string;
    message: string;
    metadata?: Record<string, unknown>;
    type: string;
    userId?: string | null;
    username?: string | null;
  }) {
    const { data } = await this.http.post<{ recording: VoiceRecording }>(
      `/voice-recorder/bot/recordings/${recordingId}/events`,
      input
    );
    return data.recording;
  }

  async getSelfBotProtectionSettings(guildId: string) {
    const { data } = await this.http.get<{ settings: SelfBotProtectionSettings }>(
      `/self-bot-protection/bot/${guildId}`
    );
    return data.settings;
  }

  async getSelfBotRoleAssignments(guildId: string) {
    const { data } = await this.http.get<{ assignments: SelfBotRoleAssignment[] }>(
      `/self-bot-protection/bot/${guildId}/role-assignments`
    );
    return data.assignments;
  }

  async getSafeBotWarningSettings(guildId: string) {
    const { data } = await this.http.get<{ settings: SafeBotWarningSettings }>(`/self-bot-protection/bot/${guildId}/warnings/settings`);
    return data.settings;
  }

  async getSafeBotWarningPreview(guildId: string, userId: string) {
    const { data } = await this.http.get<{ preview: SafeBotWarningPreview }>(`/self-bot-protection/bot/${guildId}/warnings/users/${userId}/preview`);
    return data.preview;
  }

  async getSafeBotWarningHistory(guildId: string, userId: string) {
    const { data } = await this.http.get<{ totalWarnings: number; internalNote: string; warnings: SafeBotWarningRecord[] }>(`/self-bot-protection/bot/${guildId}/warnings/users/${userId}/history`);
    return data;
  }

  async issueSafeBotWarning(guildId: string, input: { userId: string; username?: string | null; staffId: string; staffName?: string | null; reason?: string | null; idempotencyKey?: string | null; channelId?: string | null; ruleId?: string | null; ruleName?: string | null }) {
    const { data } = await this.http.post<{ warning: SafeBotWarningRecord }>(`/self-bot-protection/bot/${guildId}/warnings`, input);
    return data.warning;
  }

  async completeSafeBotWarning(guildId: string, warningId: string, input: { success: boolean; executedAction?: string | null; error?: string | null }) {
    const { data } = await this.http.patch<{ warning: SafeBotWarningRecord }>(`/self-bot-protection/bot/${guildId}/warnings/${warningId}/outcome`, input);
    return data.warning;
  }

  async getTemporaryVoiceSettings(guildId: string) { const { data } = await this.http.get<{ settings: TemporaryVoiceSettings }>(`/temporary-voice/bot/${guildId}/settings`); return data.settings; }
  async updateTemporaryVoicePanelState(guildId: string, messageId: string | null) { const { data } = await this.http.post<{ settings: TemporaryVoiceSettings }>(`/temporary-voice/bot/${guildId}/panel-state`, { messageId }); return data.settings; }
  async listTemporaryCalls(guildId: string) { const { data } = await this.http.get<{ calls: TemporaryCall[] }>(`/temporary-voice/bot/${guildId}/calls`); return data.calls; }
  async getTemporaryCallByOwner(guildId: string, ownerId: string) { const { data } = await this.http.get<{ call: TemporaryCall | null }>(`/temporary-voice/bot/${guildId}/owners/${ownerId}`); return data.call; }
  async getTemporaryCallByChannel(guildId: string, channelId: string) { const { data } = await this.http.get<{ call: TemporaryCall | null }>(`/temporary-voice/bot/${guildId}/channels/${channelId}`); return data.call; }
  async createTemporaryCall(guildId: string, input: Omit<TemporaryCall, "id" | "botId" | "guildId" | "createdAt" | "updatedAt" | "emptySince">) { const { data } = await this.http.post<{ call: TemporaryCall }>(`/temporary-voice/bot/${guildId}/calls`, input); return data.call; }
  async updateTemporaryCall(guildId: string, callId: string, input: Partial<Pick<TemporaryCall, "channelName" | "userLimit" | "isPrivate" | "allowedUsers" | "bannedUsers" | "emptySince">>) { const { data } = await this.http.patch<{ call: TemporaryCall }>(`/temporary-voice/bot/${guildId}/calls/${callId}`, input); return data.call; }
  async deleteTemporaryCall(guildId: string, callId: string) { const { data } = await this.http.delete<{ call: TemporaryCall }>(`/temporary-voice/bot/${guildId}/calls/${callId}`); return data.call; }
  async getAutomatedLogSettings(guildId: string) { const { data } = await this.http.get<{ settings: AutomatedLogSettings }>(`/automated-logs/bot/${guildId}`); return data.settings; }
  async updateAutomatedLogRuntime(guildId: string, input: Partial<Pick<AutomatedLogSettings, "categoryId" | "channels" | "lastError">> & { synced?: boolean }) { const { data } = await this.http.patch<{ settings: AutomatedLogSettings }>(`/automated-logs/bot/${guildId}/runtime`, input); return data.settings; }

  async recordSelfBotProtectionIncident(input: {
    guildId: string;
    userId: string;
    username?: string | null;
    channelId?: string | null;
    messageId?: string | null;
    messageContent?: string | null;
    moduleId: SelfBotProtectionModuleId;
    infractionType: string;
    punishmentActions: SelfBotPunishmentAction[];
    punishmentSucceeded: boolean;
    punishmentError?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const { data } = await this.http.post<{ incident: SelfBotProtectionIncident }>(
      "/self-bot-protection/bot/incidents",
      input
    );
    return data.incident;
  }

  async resolveSelfBotPunishment(input: {
    guildId: string;
    moduleId: SelfBotProtectionModuleId;
    userId: string;
  }) {
    const { data } = await this.http.post<{ punishment: ResolvedSelfBotPunishment }>(
      "/self-bot-protection/bot/punishments/next",
      input
    );
    return data.punishment;
  }

  async getActiveTwitchNotifications() {
    const { data } = await this.http.get<{ notifications: SocialNotification[] }>("/social-notifications/bot/twitch-active", {
      timeout: 30_000
    });
    return data.notifications;
  }

  async updateTwitchNotificationState(id: string, input: { isLive?: boolean; lastLiveAt?: string | null; lastStreamId?: string | null; lastMessageId?: string | null; twitchAvatar?: string | null }) {
    const { data } = await this.http.patch<{ notification: SocialNotification }>(`/social-notifications/bot/twitch/${id}/state`, input);
    return data.notification;
  }

  async claimTwitchLiveStart(id: string, input: { lastLiveAt: string; streamId: string }) {
    const { data } = await this.http.post<{ claimed: boolean; notification: SocialNotification | null }>(
      `/social-notifications/bot/twitch/${id}/claim-start`,
      input,
      { timeout: 8_000 }
    );
    return data;
  }

  async getActiveKickNotifications() {
    const { data } = await this.http.get<{ notifications: KickNotification[] }>("/kick-integration/bot/active", {
      timeout: 30_000
    });
    return data.notifications;
  }

  async getActiveKickStreams() {
    const { data } = await this.http.get<{ streams: KickStream[] }>("/kick-integration/bot/streams", {
      timeout: 30_000
    });
    return new Map(data.streams.map((stream) => [stream.broadcasterUserId, stream]));
  }

  async updateKickNotificationState(id: string, input: {
    isLive?: boolean;
    kickAvatar?: string | null;
    kickCategory?: string | null;
    lastEndedAt?: string | null;
    lastLiveAt?: string | null;
    lastMessageId?: string | null;
    lastStreamId?: string | null;
    peakViewers?: number | null;
  }) {
    const { data } = await this.http.patch<{ notification: KickNotification }>(`/kick-integration/bot/${id}/state`, input);
    return data.notification;
  }

  async claimKickLiveStart(id: string, input: {
    kickAvatar?: string | null;
    kickCategory?: string | null;
    lastLiveAt: string;
    peakViewers?: number | null;
    streamId: string;
  }) {
    const { data } = await this.http.post<{ claimed: boolean; notification: KickNotification | null }>(
      `/kick-integration/bot/${id}/claim-start`,
      input,
      { timeout: 8_000 }
    );
    return data;
  }

  async getActiveClipConfigs() {
    const { data } = await this.http.get<{ configs: ClipsConfig[] }>("/clips/bot/configs");
    return data.configs;
  }

  async isClipSent(configId: string, clipId: string) {
    const { data } = await this.http.get<{ sent: boolean }>(`/clips/bot/configs/${configId}/sent/${encodeURIComponent(clipId)}`);
    return data.sent;
  }

  async updateClipConfigCheck(configId: string, lastCheckAt = new Date().toISOString()) {
    await this.http.patch<{ ok: boolean }>(`/clips/bot/configs/${configId}/check`, {
      lastCheckAt
    });
  }

  async updateClipLiveSession(configId: string, input: {
    isLive: boolean;
    startedAt?: string | null;
    streamId?: string | null;
    thumbnailUrl?: string | null;
    title?: string | null;
  }) {
    await this.http.patch<{ ok: boolean }>(`/clips/bot/configs/${configId}/live-session`, input);
  }

  async recordClipSent(configId: string, input: {
    clipId: string;
    clipTitle: string;
    clipUrl: string;
    clipThumbnail?: string | null;
    clipCreatorName?: string | null;
    clipDuration?: number | null;
    createdAtTwitch: string;
    discordChannelId?: string | null;
    discordMessageId?: string | null;
  }) {
    const { data } = await this.http.post<{
      clip: unknown;
      rewards: ClipRewardAssignment[];
    }>(`/clips/bot/configs/${configId}/sent`, input);
    return data;
  }

  async getActiveGiveaways() {
    const { data } = await this.http.get<{ giveaways: Giveaway[] }>("/giveaways/bot/active");
    return data.giveaways;
  }

  async getGiveaway(giveawayId: string) {
    const { data } = await this.http.get<{ giveaway: Giveaway }>(`/giveaways/bot/${giveawayId}`);
    return data.giveaway;
  }

  async updateGiveawayPanelState(giveawayId: string, input: { panelMessageId?: string | null }) {
    const { data } = await this.http.patch<{ giveaway: Giveaway }>(`/giveaways/bot/${giveawayId}/panel-state`, input);
    return data.giveaway;
  }

  async getSocialPanels() {
    const { data } = await this.http.get<{ panels: SocialPanelPayload[] }>("/socials/bot/panels");
    return data.panels;
  }

  async getSocialPanel(panelId: string) {
    const { data } = await this.http.get<SocialPanelPayload>(`/socials/bot/panels/${panelId}`);
    return data;
  }

  async updateSocialPanelState(panelId: string, input: { messageId?: string | null; published?: boolean }) {
    const { data } = await this.http.patch<{ panel: SocialPanel }>(`/socials/bot/panels/${panelId}/state`, input);
    return data.panel;
  }

  async getActiveXAccounts() {
    const { data } = await this.http.get<{ accounts: XAccount[] }>("/x-monitor/bot/accounts");
    return data.accounts;
  }

  async syncXAccount(accountId: string) {
    const { data } = await this.http.post<XSyncResult>(`/x-monitor/bot/accounts/${accountId}/sync`, undefined, {
      timeout: 30_000
    });
    return data;
  }

  async recordXPostSent(accountId: string, input: {
    channelId: string;
    discordMessageId?: string | null;
    xPostCreatedAt?: string | null;
    xPostId: string;
    xPostUrl: string;
  }) {
    const { data } = await this.http.post(`/x-monitor/bot/accounts/${accountId}/sent`, input);
    return data;
  }

  async recordXDiscordFailure(accountId: string, message: string) {
    await this.http.post(`/x-monitor/bot/accounts/${accountId}/discord-error`, {
      message
    });
  }

  async getActiveFivemFacConfigs() {
    const { data } = await this.http.get<{ configs: FivemFacSettings[] }>("/fivem/bot/fac/configs");
    return data.configs;
  }

  async getActiveFivemActionConfigs() {
    const { data } = await this.http.get<{ configs: FivemActionSettings[] }>("/fivem-actions/bot/configs/active");
    return data.configs;
  }

  async getPolicePatrolSettings(guildId: string) { const { data } = await this.http.get<{ settings: PolicePatrolSettings }>(`/police-patrol-reports/bot/${guildId}/settings`); return data.settings; }
  async createPolicePatrolReport(input: { guildId: string; officerId: string; officerName: string; authorId: string; authorName: string; patrolType?: string | null; initialNotes?: string | null }) { const { data } = await this.http.post<{ report: PolicePatrolReport }>("/police-patrol-reports/bot/reports", input); return data.report; }
  async setPolicePatrolChannel(reportId: string, channelId: string, panelMessageId: string) { const { data } = await this.http.patch<{ report: PolicePatrolReport }>(`/police-patrol-reports/bot/reports/${reportId}/channel`, { channelId, panelMessageId }); return data.report; }
  async startPolicePatrolReport(reportId: string, input: { actorId: string; patrolStart: string; patrolEnd: string }) { const { data } = await this.http.post<{ report: PolicePatrolReport }>(`/police-patrol-reports/bot/reports/${reportId}/start`, input); return data.report; }
  async appendPolicePatrolMessage(reportId: string, input: Record<string, unknown>) { await this.http.post(`/police-patrol-reports/bot/reports/${reportId}/messages`, input); }
  async finishPolicePatrolReport(reportId: string, actorId: string, deleteDelayMinutes: number) { const { data } = await this.http.post<{ report: PolicePatrolReport; messages: PolicePatrolMessage[] }>(`/police-patrol-reports/bot/reports/${reportId}/finish`, { actorId, deleteDelayMinutes }); return data; }
  async cancelPolicePatrolReport(reportId: string, actorId: string, deleteDelayMinutes: number) { const { data } = await this.http.post<{ report: PolicePatrolReport }>(`/police-patrol-reports/bot/reports/${reportId}/cancel`, { actorId, deleteDelayMinutes }); return data.report; }
  async getPolicePatrolReport(reportId: string) { const { data } = await this.http.get<{ report: PolicePatrolReport; messages: PolicePatrolMessage[] }>(`/police-patrol-reports/bot/reports/${reportId}`); return data; }
  async getPolicePatrolReportByChannel(channelId: string) { const { data } = await this.http.get<{ report: PolicePatrolReport | null }>(`/police-patrol-reports/bot/reports/channel/${channelId}`); return data.report; }
  async listPolicePatrolReports(guildId: string, officerId?: string) { const { data } = await this.http.get<{ reports: PolicePatrolReport[] }>(`/police-patrol-reports/bot/${guildId}/reports`, { params: officerId ? { officerId } : undefined }); return data.reports; }
  async getPolicePatrolChannelsDue() { const { data } = await this.http.get<{ reports: PolicePatrolReport[] }>("/police-patrol-reports/bot/channels/due"); return data.reports; }
  async clearPolicePatrolChannel(reportId: string) { await this.http.post(`/police-patrol-reports/bot/reports/${reportId}/channel-cleared`); }
  async deletePolicePatrolReport(reportId: string, actorId: string) { await this.http.post(`/police-patrol-reports/bot/reports/${reportId}/delete`, { actorId }); }
  async storePolicePatrolAttachment(reportId: string, attachmentId: string, name: string, mimeType: string, buffer: Buffer) { const safeName = name.replace(/[^\x20-\x7e]/g, "_").slice(0, 200) || `attachment-${attachmentId}`; const { data } = await this.http.put<{ file: { id: string; url: string; size: number } }>(`/police-patrol-reports/bot/reports/${reportId}/files/${attachmentId}`, buffer, { headers: { "Content-Type": mimeType || "application/octet-stream", "x-file-name": safeName }, maxBodyLength: 30 * 1024 * 1024, timeout: 30000 }); return data.file; }
  async getPoliceHiddenChannelSettings(guildId: string) { const { data } = await this.http.get<{ settings: PoliceHiddenChannelSettings }>(`/police-hidden-channel/bot/${guildId}/settings`); return data.settings; }
  async savePoliceHiddenChannelSettings(guildId: string, input: Partial<Pick<PoliceHiddenChannelSettings, "enabled" | "channelId" | "allowedRoleId" | "logChannelId">>, actorId?: string | null) { const { data } = await this.http.patch<{ settings: PoliceHiddenChannelSettings }>(`/police-hidden-channel/bot/${guildId}/settings`, input, { headers: actorId ? { "x-actor-id": actorId } : undefined }); return data.settings; }
  async createPoliceHiddenChannelLog(input: { attachmentUrls?: string[]; authorId: string; authorTag: string; channelId: string; content: string; embedCount?: number; errorMessage?: string | null; guildId: string; logChannelId?: string | null; originalMessageId: string; relayedMessageId?: string | null; status: "relayed" | "failed"; stickerIds?: string[] }) { await this.http.post("/police-hidden-channel/bot/logs", input); }
  async listVisibleUsers(guildId: string) { const { data } = await this.http.get<{ users: VisibleUser[] }>(`/visible-mode/bot/${guildId}/users`); return data.users; }
  async isVisibleUser(guildId: string, userId: string) { const { data } = await this.http.get<{ enabled: boolean; user: VisibleUser | null }>(`/visible-mode/bot/${guildId}/users/${userId}`); return data; }
  async addVisibleUser(guildId: string, userId: string, actorId?: string | null) { const { data } = await this.http.put<{ user: VisibleUser }>(`/visible-mode/bot/${guildId}/users/${userId}`, null, { headers: actorId ? { "x-actor-id": actorId } : undefined }); return data.user; }
  async removeVisibleUser(guildId: string, userId: string, actorId?: string | null) { const { data } = await this.http.delete<{ removed: boolean }>(`/visible-mode/bot/${guildId}/users/${userId}`, { headers: actorId ? { "x-actor-id": actorId } : undefined }); return data; }
  async clearVisibleUsers(guildId: string, actorId?: string | null) { const { data } = await this.http.delete<{ removed: number }>(`/visible-mode/bot/${guildId}/users`, { headers: actorId ? { "x-actor-id": actorId } : undefined }); return data; }
  async getDmBarConfig(guildId: string) { const { data } = await this.http.get<{ config: DmBarConfig }>(`/dm-bar/bot/${guildId}/config`); return data.config; }
  async createDmBarLog(guildId: string, input: { errorReason?: string | null; message: string; senderId: string; status: "sent" | "failed" | "denied" | "cancelled" | "test"; targetId?: string | null; title: string }) { await this.http.post(`/dm-bar/bot/${guildId}/logs`, input); }

  async getOpenDutySettings(guildId: string) {
    const { data } = await this.http.get<{ settings: OpenDutySettings }>(`/open-duty-notifications/bot/${guildId}/config`);
    return data.settings;
  }

  async saveOpenDutySettings(guildId: string, input: Partial<OpenDutySettings>, actorId?: string | null) {
    const { data } = await this.http.patch<{ settings: OpenDutySettings }>(`/open-duty-notifications/bot/${guildId}/config`, input, { headers: actorId ? { "x-actor-id": actorId } : undefined });
    return data.settings;
  }

  async recordOpenDutyDelivery(guildId: string, input: { edited: boolean; errorReason?: string | null; executorId: string; message: string; status: "sent" | "failed" | "cancelled" | "denied"; targetId: string }) {
    const { data } = await this.http.post<{ alertTriggered: boolean; counterTotal: number; settings: OpenDutySettings }>("/open-duty-notifications/bot/" + guildId + "/deliveries", input);
    return data;
  }

  async getFivemActionDashboard(guildId: string, architecture: FivemActionArchitecture) {
    const { data } = await this.http.get<{ settings: FivemActionSettings; actions: FivemActionDefinition[] }>(`/fivem-actions/bot/${guildId}/${architecture}`);
    return data;
  }

  async saveFivemActionSettings(guildId: string, architecture: FivemActionArchitecture, input: Partial<FivemActionSettings>, actorId?: string | null) {
    const { data } = await this.http.patch<{ settings: FivemActionSettings }>(`/fivem-actions/bot/${guildId}/${architecture}/settings`, input, { headers: actorId ? { "x-actor-id": actorId } : undefined });
    return data.settings;
  }

  async createFivemActionDefinition(guildId: string, architecture: FivemActionArchitecture, input: Partial<FivemActionDefinition>, actorId?: string | null) {
    const { data } = await this.http.post<{ action: FivemActionDefinition }>(`/fivem-actions/bot/${guildId}/${architecture}/actions`, input, { headers: actorId ? { "x-actor-id": actorId } : undefined });
    return data.action;
  }

  async requestFivemActionPanelPublish(guildId: string, architecture: FivemActionArchitecture, actorId?: string | null) {
    const { data } = await this.http.post<{ settings: FivemActionSettings }>(`/fivem-actions/bot/${guildId}/${architecture}/publish`, undefined, { headers: actorId ? { "x-actor-id": actorId } : undefined });
    return data.settings;
  }

  async updateFivemActionPanelState(input: { guildId: string; architecture: FivemActionArchitecture; panelMessageId: string | null }) {
    const { data } = await this.http.post<{ settings: FivemActionSettings }>("/fivem-actions/bot/panel-state", input); return data.settings;
  }

  async createFivemActionSession(input: { guildId: string; architecture: FivemActionArchitecture; actionId: string; mode?: FivemActionMode | null; openerId: string; openerName: string }) {
    const { data } = await this.http.post<{ session: FivemActionSession }>("/fivem-actions/bot/sessions", input); return data.session;
  }

  async updateFivemActionSessionMessage(sessionId: string, input: { channelId: string; messageId: string }) {
    const { data } = await this.http.patch<{ session: FivemActionSession }>(`/fivem-actions/bot/sessions/${sessionId}/message`, input); return data.session;
  }

  async getFivemActionSession(sessionId: string) { const { data } = await this.http.get<{ session: FivemActionSession }>(`/fivem-actions/bot/sessions/${sessionId}`); return data.session; }
  async joinFivemActionSession(sessionId: string, input: { userId: string; username: string; roleIds: string[] }) { const { data } = await this.http.post<{ session: FivemActionSession }>(`/fivem-actions/bot/sessions/${sessionId}/join`, input); return data.session; }
  async leaveFivemActionSession(sessionId: string, userId: string) { const { data } = await this.http.post<{ session: FivemActionSession }>(`/fivem-actions/bot/sessions/${sessionId}/leave`, { userId }); return data.session; }
  async startFivemActionSession(sessionId: string, actorId: string) { const { data } = await this.http.post<{ session: FivemActionSession }>(`/fivem-actions/bot/sessions/${sessionId}/start`, { actorId }); return data.session; }
  async cancelFivemActionSession(sessionId: string, actorId: string, reason?: string | null) { const { data } = await this.http.post<{ session: FivemActionSession }>(`/fivem-actions/bot/sessions/${sessionId}/cancel`, { actorId, reason: reason ?? null }); return data.session; }
  async finishFivemActionSession(sessionId: string, actorId: string, result: "victory" | "defeat" | "draw", details?: { note?: string | null; occurrence?: string | null; summary?: string | null }) { const { data } = await this.http.post<{ session: FivemActionSession }>(`/fivem-actions/bot/sessions/${sessionId}/finish`, { actorId, result, ...details }); return data.session; }

  async getFivemFacSettings(guildId: string) {
    const { data } = await this.http.get<{ settings: FivemFacSettings }>(`/fivem/bot/fac/${guildId}`);
    return data.settings;
  }

  async getPd7Configs() { const {data}=await this.http.get<{configs:Pd7Config[]}>("/fivem-pd7/bot/configs"); return data.configs; }
  async createPd7Request(input:{guildId:string;factionId:string;userId:string;username:string;fields:Array<{id:string;label:string;value:string}>}) { const {data}=await this.http.post<{request:Pd7Request}>("/fivem-pd7/bot/requests",input); return data.request; }
  async getPd7Request(id:string) { const {data}=await this.http.get<{request:Pd7Request}>(`/fivem-pd7/bot/requests/${id}`); return data.request; }
  async updatePd7Request(id:string,patch:Partial<Pd7Request>) { const {data}=await this.http.patch<{request:Pd7Request}>(`/fivem-pd7/bot/requests/${id}`,patch); return data.request; }
  async updatePd7PanelState(input:{guildId:string;factionId:string;panelMessageId:string|null}) { const {data}=await this.http.post<{settings:Pd7Config}>("/fivem-pd7/bot/panel-state",input); return data.settings; }

  async updateFivemFacPanelState(input: { guildId: string; messageId?: string | null }) {
    const { data } = await this.http.post<{ settings: FivemFacSettings }>("/fivem/bot/fac/panel-state", input);
    return data.settings;
  }

  async resetFivemFacTestHistory(input: { actorId: string; guildId: string }) {
    const { data } = await this.http.post<{ result: FivemFacHistoryResetResult }>("/fivem/bot/fac/history/reset", input);
    return data.result;
  }

  async createFivemFacAbsence(input: {
    guildId: string;
    userId: string;
    username?: string | null;
    reason: string;
    startDate: string;
    endDate: string;
    notes?: string | null;
    requesterRoleIds?: string[];
  }) {
    const { data } = await this.http.post<{ absence: FivemFacAbsence }>("/fivem/bot/fac/absences", input);
    return data.absence;
  }

  async getFivemFacAbsence(absenceId: string) {
    const { data } = await this.http.get<{ absence: FivemFacAbsence }>(`/fivem/bot/fac/absences/${absenceId}`);
    return data.absence;
  }

  async getFivemFacUserAbsences(guildId: string, userId: string) {
    const { data } = await this.http.get<{ absences: FivemFacAbsence[] }>("/fivem/bot/fac/absences/user", {
      params: {
        guildId,
        userId
      }
    });
    return data.absences;
  }

  async getFivemFacDueAbsences(today?: string) {
    const { data } = await this.http.get<{ absences: FivemFacAbsence[] }>("/fivem/bot/fac/absences/due", {
      params: today ? { today } : undefined
    });
    return data.absences;
  }

  async updateFivemFacAbsenceChannel(absenceId: string, input: { privateChannelId?: string | null; requestMessageId?: string | null }) {
    const { data } = await this.http.patch<{ absence: FivemFacAbsence }>(`/fivem/bot/fac/absences/${absenceId}/channel`, input);
    return data.absence;
  }

  async approveFivemFacAbsence(absenceId: string, input: { moderatorId: string; moderatorRoleIds: string[] }) {
    const { data } = await this.http.post<{ absence: FivemFacAbsence }>(`/fivem/bot/fac/absences/${absenceId}/approve`, input);
    return data.absence;
  }

  async rejectFivemFacAbsence(absenceId: string, input: { moderatorId: string; moderatorRoleIds: string[]; reason: string }) {
    const { data } = await this.http.post<{ absence: FivemFacAbsence }>(`/fivem/bot/fac/absences/${absenceId}/reject`, input);
    return data.absence;
  }

  async closeFivemFacAbsence(absenceId: string, input: { moderatorId: string; moderatorRoleIds: string[]; reason?: string | null; roleRemoved?: boolean }) {
    const { data } = await this.http.post<{ absence: FivemFacAbsence }>(`/fivem/bot/fac/absences/${absenceId}/close`, input);
    return data.absence;
  }

  async markFivemFacAbsenceStarted(absenceId: string, roleAdded = true) {
    const { data } = await this.http.post<FivemFacLifecycleResult>(`/fivem/bot/fac/absences/${absenceId}/start`, {
      roleAdded
    });
    return data;
  }

  async markFivemFacAbsenceFinished(absenceId: string, roleRemoved = true) {
    const { data } = await this.http.post<FivemFacLifecycleResult>(`/fivem/bot/fac/absences/${absenceId}/finish`, {
      roleRemoved
    });
    return data;
  }

  async getActiveMissionToolsConfigs() {
    const { data } = await this.http.get<{ configs: MissionToolsSettings[] }>("/mission-tools/bot/configs");
    return data.configs;
  }

  async getMissionToolsSettings(guildId: string) {
    const { data } = await this.http.get<{ settings: MissionToolsSettings }>(`/mission-tools/bot/${guildId}`);
    return data.settings;
  }

  async saveMissionToolsSettings(guildId: string, input: Partial<Pick<
    MissionToolsSettings,
    "allowedRoleIds" | "enabled" | "enabledFeatures" | "logChannelId" | "managerRoleIds" | "panelChannelId"
  >>) {
    const { data } = await this.http.patch<{ settings: MissionToolsSettings }>(
      `/mission-tools/bot/${guildId}/settings`,
      input
    );
    return data.settings;
  }

  async updateMissionToolsPanelState(input: { guildId: string; messageId?: string | null }) {
    const { data } = await this.http.post<{ settings: MissionToolsSettings }>("/mission-tools/bot/panel-state", input);
    return data.settings;
  }

  async getMissionToolsUser(guildId: string, userId: string) {
    const { data } = await this.http.get<{ user: MissionToolsUserPanel }>(
      `/mission-tools/bot/${guildId}/users/${userId}`
    );
    return data.user;
  }

  async updateMissionToolsUser(guildId: string, userId: string, input: MissionToolsUserPatch) {
    const { data } = await this.http.patch<{ user: MissionToolsUserPanel }>(
      `/mission-tools/bot/${guildId}/users/${userId}`,
      input
    );
    return data.user;
  }

  async saveMissionToolsToken(guildId: string, userId: string, token: string) {
    const { data } = await this.http.post<{
      accepted: false;
      fake: true;
      tokenConfigured: boolean;
      tokenLast4: string | null;
      tokenStatus: MissionToolsTokenStatus;
      user: MissionToolsUserPanel;
    }>(
      `/mission-tools/bot/${guildId}/users/${userId}/token`,
      { token }
    );
    return data;
  }

  async deleteMissionToolsToken(guildId: string, userId: string) {
    const { data } = await this.http.delete<{ tokenConfigured: boolean }>(
      `/mission-tools/bot/${guildId}/users/${userId}/token`
    );
    return data;
  }

  async getMissionToolsToken(guildId: string, userId: string) {
    const { data } = await this.http.get<MissionToolsTokenResponse>(
      `/mission-tools/bot/${guildId}/users/${userId}/token`
    );
    return data;
  }

  async markMissionToolsTokenAuthFailure(guildId: string, userId: string, input: {
    reason?: string | null;
    source?: string | null;
    statusCode?: number | null;
  }) {
    const { data } = await this.http.post<{
      tokenStatus: MissionToolsTokenStatus;
      user: MissionToolsUserPanel;
    }>(
      `/mission-tools/bot/${guildId}/users/${userId}/token/auth-failure`,
      input
    );
    return data;
  }

  async recordEmojiCloneJob(input: {
    guildId: string;
    userId: string;
    sourceGuildId?: string | null;
    status: "pending" | "running" | "completed" | "cancelled";
    total: number;
    success: number;
    failed: number;
    prefix?: string | null;
    createdAt?: string | null;
    finishedAt?: string | null;
    items: Array<{
      originalEmojiId: string;
      originalName: string;
      originalUrl?: string | null;
      newEmojiId?: string | null;
      newName?: string | null;
      animated: boolean;
      status: "pending" | "success" | "failed";
      errorReason?: string | null;
    }>;
  }) {
    const { data } = await this.http.post("/emoji-cloner/bot/jobs", input, {
      timeout: 12_000
    });
    return data;
  }
}

const API_REQUEST_WINDOW_MS = 60_000;
const API_REQUEST_WARN_THRESHOLD = 40;
const apiRequestCounters = new Map<string, { count: number; resetAt: number; warnedAt: number }>();

function recordApiRequest(method = "GET", url = "") {
  const now = Date.now();
  const key = `${method.toUpperCase()} ${normalizeApiMetricUrl(url)}`;
  const current = apiRequestCounters.get(key);

  if (!current || current.resetAt <= now) {
    apiRequestCounters.set(key, {
      count: 1,
      resetAt: now + API_REQUEST_WINDOW_MS,
      warnedAt: 0
    });
    cleanupApiRequestCounters(now);
    return;
  }

  current.count += 1;

  if (current.count > API_REQUEST_WARN_THRESHOLD && now - current.warnedAt > API_REQUEST_WINDOW_MS) {
    current.warnedAt = now;
    console.warn(`[api-client] alto volume de requests: ${key} count=${current.count}/min`);
  }
}

function normalizeApiMetricUrl(url: string) {
  return url
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":uuid")
    .replace(/\b\d{15,22}\b/g, ":snowflake")
    .replace(/\/sent\/[^/?]+/g, "/sent/:id")
    .split("?")[0] || "/";
}

function cleanupApiRequestCounters(now: number) {
  if (apiRequestCounters.size < 500) {
    return;
  }

  for (const [key, value] of apiRequestCounters.entries()) {
    if (value.resetAt <= now) {
      apiRequestCounters.delete(key);
    }
  }
}

function readAuthorizationResponse(value: unknown): BotCommandAuthorization | null {
  if (!value || typeof value !== "object" || !("authorization" in value)) {
    return null;
  }

  const authorization = (value as { authorization?: unknown }).authorization;

  if (!authorization || typeof authorization !== "object" || !("allowed" in authorization)) {
    return null;
  }

  return authorization as BotCommandAuthorization;
}

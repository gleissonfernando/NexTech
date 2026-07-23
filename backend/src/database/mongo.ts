import { MongoClient, type Collection, type Db } from "mongodb";
import { env } from "../config/env";

export type MongoUser = {
  _id: string;
  discordId: string;
  username: string;
  globalName?: string | null;
  discriminator?: string | null;
  avatar: string | null;
  avatarUrl?: string | null;
  email: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  discordRoleIdsByGuild?: Record<string, string[]>;
  accessStatus?: "allowed" | "denied" | "pending";
  permissionLevel?: "admin" | "moderator" | "premium" | "basic" | "viewer";
  lastAccessSyncAt?: Date | null;
  selectedGuildId?: string | null;
  authSessionVersion?: number;
  activeSessionId?: string | null;
  activeSessionScope?: "dashboard" | "customer" | null;
  activeSessionBotId?: string | null;
  activeSessionCreatedAt?: Date | null;
  activeSessionLastAccessAt?: Date | null;
  activeSessionExpiresAt?: Date | null;
  activeSessionIp?: string | null;
  activeSessionUserAgent?: string | null;
  activeSessionStatus?: "active" | "invalidated" | "logged_out" | null;
  activeSessionInvalidatedAt?: Date | null;
  activeSessionInvalidationReason?: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoGuild = {
  _id: string;
  name: string;
  icon: string | null;
  ownerId: string | null;
  botEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoGuildSettings = {
  _id: string;
  botId?: string | null;
  guildId: string;
  welcomeEnabled: boolean;
  welcomeChannelId: string | null;
  welcomeDisplayChannelId?: string | null;
  welcomeImageUrl?: string | null;
  welcomeTitle?: string | null;
  welcomeSubtitle?: string | null;
  welcomeMessage: string | null;
  welcomeRulesTitle?: string | null;
  welcomeRules?: string | null;
  welcomeSections?: Array<{
    description: string;
    emoji?: string | null;
    enabled?: boolean;
    id: string;
    order?: number;
    title: string;
  }>;
  welcomeChannelLabel?: string | null;
  welcomeFooterText?: string | null;
  welcomeColor?: string | null;
  leaveEnabled?: boolean;
  leaveChannelId?: string | null;
  leaveDisplayChannelId?: string | null;
  leaveImageUrl?: string | null;
  leaveTitle?: string | null;
  leaveSubtitle?: string | null;
  leaveMessage?: string | null;
  leaveRulesTitle?: string | null;
  leaveRules?: string | null;
  leaveSections?: Array<{
    description: string;
    emoji?: string | null;
    enabled?: boolean;
    id: string;
    order?: number;
    title: string;
  }>;
  leaveChannelLabel?: string | null;
  leaveFooterText?: string | null;
  leaveColor?: string | null;
  autoRoleEnabled: boolean;
  autoRoleIds: string[];
  twitchRoleId: string | null;
  boosterRoleId: string | null;
  ticketEnabled: boolean;
  ticketCategoryId: string | null;
  ticketPanelChannelId?: string | null;
  ticketPanelMessageId?: string | null;
  ticketPanelTitle?: string | null;
  ticketPanelDescription?: string | null;
  ticketPanelInfoText?: string | null;
  ticketPanelFooterText?: string | null;
  ticketPanelColor?: string | null;
  ticketPanelPlaceholder?: string | null;
  ticketPanelOptions?: Array<{
    categoryId?: string | null;
    description?: string | null;
    emoji?: string | null;
    enabled?: boolean;
    label: string;
    value: string;
  }>;
  reportSystem?: Record<string, unknown>;
  logChannelId: string | null;
  discordLogsEnabled?: boolean;
  siteLogsEnabled?: boolean;
  discordLogCategories?: Array<"members" | "messages" | "roles" | "moderation" | "dashboard" | "automation">;
  siteLogCategories?: Array<"members" | "messages" | "roles" | "moderation" | "dashboard" | "automation">;
  globalLogConfig?: {
    transcriptChannelId: string | null;
    logViewRoleId: string | null;
    transcriptViewRoleId: string | null;
    transcriptRequired: boolean;
    transcriptWebsiteEnabled: boolean;
    transcriptTextEnabled: boolean;
    transcriptExpirationDays: number | null;
    panelBannerUrl: string | null;
    panelFooterText: string | null;
    panelColor: string;
    moduleEmoji: string | null;
    moduleName: string | null;
    showAnonymousAuthorToRoleIds: string[];
  };
  moderationEnabled: boolean;
  accountAgeSecurityEnabled?: boolean;
  accountAgeMinDays?: number;
  accountAgeLogChannelId?: string | null;
  accountAgeAllowedUserIds?: string[];
  safeBotEnabled?: boolean;
  safeBotChannelId?: string | null;
  safeBotRoleId?: string | null;
  safeBotLogChannelId?: string | null;
  emojiCloneEnabled?: boolean;
  emojiCloneAllowedRoleIds?: string[];
  emojiCloneLogChannelId?: string | null;
  emojiCloneDefaultPrefix?: string | null;
  emojiCloneAllowAnimated?: boolean;
  emojiCloneMaxPerRun?: number;
  emojiCloneAllowedBotIds?: string[];
  rulesEnabled?: boolean;
  rulesChannelId?: string | null;
  rulesRoleId?: string | null;
  rulesTitle?: string | null;
  rulesMessage?: string | null;
  rulesButtonLabel?: string | null;
  rulesColor?: string | null;
  rulesPanelMessageId?: string | null;
  verificationEnabled: boolean;
  verificationRoleId: string | null;
  verificationRoleIds?: string[];
  dashboardRolePermissions?: Record<string, "admin" | "moderator" | "premium" | "basic">;
  dashboardUserPermissions?: Record<string, "admin" | "moderator" | "premium" | "basic">;
  updatedAt: Date;
};

export type MongoSafeBotMessageState = {
  _id: string;
  botId?: string | null;
  guildId: string;
  channelId: string;
  messageId: string;
  updatedAt: Date;
};

export type MongoTicket = {
  _id: string;
  botId?: string | null;
  guildId: string;
  channelId: string | null;
  openerId: string;
  ownerId?: string;
  subject: string;
  categoryId?: string | null;
  categoryName?: string | null;
  responsibleRoleId?: string | null;
  responsibleUserId?: string | null;
  allowedRoleIds?: string[];
  status: "OPEN" | "PENDING" | "CLOSED" | "IN_ANALYSIS" | "WAITING_EVIDENCE" | "WAITING_USER" | "RESOLVED" | "DENIED" | "ARCHIVED" | "INCOMPLETE";
  closeReason?: string | null;
  finalResult?: string | null;
  internalNotes?: string | null;
  closedById?: string | null;
  isIncomplete?: boolean;
  logs?: Record<string, string | null>;
  createdAt: Date;
  closedAt: Date | null;
};

export type MongoHierarchyForwardingRule = {
  _id: string;
  botId: string | null;
  guildId: string;
  denouncedRoleId: string;
  destinationCategoryId: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
  updatedById: string | null;
  deletedAt?: Date | null;
};

export type MongoTranscriptMessage = {
  id: string;
  authorAvatarUrl: string | null;
  authorId: string | null;
  authorName: string;
  authorRoleIds: string[];
  content: string;
  attachments: Array<{ contentType: string | null; id: string; name: string; size: number; url: string }>;
  embeds: unknown[];
  createdAt: Date;
  editedAt?: Date | null;
  system?: boolean;
  anonymous?: boolean;
  botRelayed?: boolean;
};

export type MongoTranscript = {
  _id: string;
  ticketId: string | null;
  guildId: string;
  botId: string | null;
  ownerId: string | null;
  channelId: string | null;
  channelName: string | null;
  guildName: string | null;
  type: "Denúncia" | "Ticket" | "Canal Temporário" | "Suporte" | "Outro";
  categoryName: string | null;
  htmlPath: string;
  pdfPath: string | null;
  txtPath?: string | null;
  htmlContent: string;
  textContent?: string;
  websiteUrl?: string | null;
  status: "Finalizado" | "Incompleto";
  createdAt: Date;
  closedAt: Date | null;
  expiresAt: Date | null;
  isPartial: boolean;
  partialReason: string | null;
  accessCount: number;
  openedById: string | null;
  responsibleUserId: string | null;
  closedById: string | null;
  closeReason: string | null;
  openReason?: string | null;
  finalResult: string | null;
  internalNotes: string | null;
  rolesInvolved?: string[];
  metadata?: Record<string, unknown>;
  participants: Array<{ id: string | null; name: string; role: string | null }>;
  messages: MongoTranscriptMessage[];
  attachments: Array<{ contentType: string | null; id: string; name: string; size: number; url: string }>;
  events: Array<{ authorId: string | null; content: string; eventType: string; metadata?: Record<string, unknown>; createdAt: Date }>;
  deletedAt?: Date | null;
};

export type MongoTranscriptPassword = {
  _id: string;
  transcriptId: string;
  passwordHash: string;
  type: "temporary" | "master";
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

export type MongoTranscriptAccessLog = {
  _id: string;
  transcriptId: string;
  guildId: string;
  botId: string | null;
  accessType: "temporary" | "master" | "unknown";
  success: boolean;
  reason: string;
  createdAt: Date;
  maskedIp: string | null;
  userAgent: string | null;
};

export type MongoTicketEvent = {
  _id: string;
  ticketId: string;
  guildId: string;
  botId: string | null;
  eventType: string;
  authorId: string | null;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type MongoCourseSettings = {
  _id: string;
  botId: string | null;
  guildId: string;
  publishChannelId: string | null;
  scheduleChannelId: string | null;
  scheduleLogChannelId?: string | null;
  proofLogChannelId?: string | null;
  resultChannelId?: string | null;
  evaluationChannelId?: string | null;
  reportChannelId: string | null;
  logChannelId: string | null;
  adminLogChannelId?: string | null;
  temporaryCategoryId: string | null;
  tempProofCategoryId?: string | null;
  publicationMentionRoleId?: string | null;
  evaluatorMentionRoleId?: string | null;
  resultMentionRoleId?: string | null;
  adminUserIds: string[];
  adminRoleIds: string[];
  managerUserIds: string[];
  managerRoleIds: string[];
  generalInstructorRoleIds?: string[];
  globalInstructorUserIds?: string[];
  globalInstructorRoleIds?: string[];
  evaluatorUserIds?: string[];
  evaluatorRoleIds?: string[];
  configUserIds?: string[];
  configRoleIds?: string[];
  permissionMatrix?: Record<string, { userIds: string[]; roleIds: string[] }>;
  images?: MongoCourseImage[];
  defaultExpirationHours: number | null;
  noPermissionMessage: string;
  cancelledMessage: string;
  startedMessage: string;
  globalBannerUrl: string | null;
  reportImageUrl: string | null;
  panelMessageId?: string | null;
  lastPanelRequestedAt?: Date | null;
  buttonEmojis: {
    cancel: string;
    course?: string;
    error?: string;
    full?: string;
    enter: string;
    instructor?: string;
    leave: string;
    location?: string;
    logs?: string;
    participants?: string;
    save?: string;
    start: string;
    status?: string;
    success?: string;
    time?: string;
    vacancies?: string;
  };
  updatedAt: Date;
  updatedBy: string | null;
};

export type MongoCourseImage = {
  _id: string;
  botId: string | null;
  guildId: string;
  name: string;
  type: "main_banner" | "proof_banner" | "logs_banner" | "approved_result" | "rejected_result" | "module";
  url: string;
  createdAt: Date;
  createdBy: string | null;
  active: boolean;
  default: boolean;
};

export type MongoCourse = {
  _id: string;
  botId: string | null;
  guildId: string;
  name: string;
  code?: string | null;
  description: string | null;
  emoji: string | null;
  color: string;
  bannerUrl: string | null;
  proofBannerUrl?: string | null;
  footerImageUrl: string | null;
  thumbnailUrl: string | null;
  imagePosition: "top" | "bottom" | "side" | "footer";
  publishText: string | null;
  proofInstructionText?: string | null;
  startedText: string | null;
  cancelledText: string | null;
  buttonLabels: {
    cancel: string;
    enter: string;
    leave: string;
    start: string;
  };
  instructorUserIds: string[];
  instructorRoleIds: string[];
  allowGeneralInstructorRoles?: boolean;
  publishChannelId?: string | null;
  maxStudents?: number;
  location?: string | null;
  defaultSchedule?: string | null;
  updatedBy?: string | null;
  active: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoCoursePublication = {
  _id: string;
  botId: string | null;
  guildId: string;
  courseId: string;
  channelId: string;
  messageId: string | null;
  discordEventId?: string | null;
  discordEventUrl?: string | null;
  discordEventType?: "EXTERNAL" | "VOICE" | "STAGE" | null;
  voiceChannelId?: string | null;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
  lastSyncAt?: Date | null;
  syncError?: string | null;
  instructorId: string;
  location: string;
  legacyLocation?: string | null;
  dpId?: string | null;
  dpNameSnapshot?: string | null;
  scheduledFor: string;
  capacity: number;
  students: string[];
  notes: string | null;
  status: "open" | "started" | "cancelled" | "closed" | "proof" | "finished";
  cancelledBy: string | null;
  cancelledAt: Date | null;
  startedBy?: string | null;
  startedAt?: Date | null;
  proofStartedBy?: string | null;
  proofStartedAt?: Date | null;
  finishedBy?: string | null;
  finishedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoCourseDepartment = {
  _id: string;
  botId: string | null;
  guildId: string;
  name: string;
  normalizedName: string;
  active: boolean;
  createdBy: string | null;
  updatedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CourseEnrollmentExamStatus =
  | "NOT_AVAILABLE"
  | "AVAILABLE"
  | "STARTING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "APPROVED"
  | "FAILED"
  | "CANCELED"
  | "EXPIRED";

export type MongoCourseEnrollment = {
  _id: string;
  botId: string | null;
  guildId: string;
  courseId: string;
  publicationId: string;
  studentId: string;
  studentName: string;
  publicationChannelId: string;
  enrolledAt: Date;
  enrollmentStatus: "ENROLLED" | "LEFT";
  examId: string | null;
  examStatus: CourseEnrollmentExamStatus;
  attemptId: string | null;
  examChannelId: string | null;
  examStartedAt?: Date | null;
  score: number | null;
  correctAnswers: number | null;
  result: "approved" | "rejected" | null;
  completedAt: Date | null;
  correctedBy: string | null;
  transcriptId: string | null;
  updatedAt: Date;
};

export type MongoCourseScheduleRequest = {
  _id: string;
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
  decidedAt: Date | null;
  channelId: string | null;
  messageId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoCourseReport = {
  _id: string;
  botId: string | null;
  guildId: string;
  courseId: string;
  instructorId: string;
  reportDate: string;
  reportTime: string;
  students: Array<{ note: string; observation: string | null; userId: string }>;
  channelId: string | null;
  messageId: string | null;
  createdAt: Date;
};

export type MongoCourseLog = {
  _id: string;
  botId: string | null;
  guildId: string;
  action: string;
  type?: string;
  actorId: string | null;
  authorId?: string | null;
  targetId?: string | null;
  courseId: string | null;
  publicationId: string | null;
  sessionId?: string | null;
  instructorId?: string | null;
  channelId?: string | null;
  status?: string | null;
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: Date;
};

export type MongoCourseExamSettings = {
  _id: string;
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
  manualQuestionMaxScore?: number;
  manualApproval?: boolean;
  automaticApproval?: boolean;
  releaseMode?: "immediate" | "scheduled" | "instructor";
  releaseAt?: Date | null;
  attemptLimit?: number | null;
  allowAnswerChange?: boolean;
  showAnswersAfterExam?: boolean;
  version?: number;
  examKey?: string | null;
  externalLinkEnabled?: boolean;
  externalLinkText?: string | null;
  externalLinkUrl?: string | null;
  externalLinkDescription?: string | null;
  externalLinkEmoji?: string | null;
  updatedAt: Date;
  updatedBy: string | null;
};

export type MongoCourseExamQuestion = {
  _id: string;
  botId: string | null;
  guildId: string;
  courseId: string;
  order: number;
  questionNumber?: number;
  type: "selection" | "multiple" | "written";
  prompt: string;
  title?: string;
  description: string | null;
  points: number;
  alternatives: Array<{ id: string; text: string; value?: string; score?: number; isCorrect?: boolean; order?: number }>;
  correctAlternativeId: string | null;
  correctAlternativeIds?: string[];
  correctText?: string | null;
  placeholder: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
};

export type MongoCourseExamAttempt = {
  _id: string;
  botId: string | null;
  guildId: string;
  courseId: string;
  examId?: string | null;
  publicationId: string;
  channelId: string;
  studentId: string;
  instructorId: string;
  status: "in_progress" | "finished" | "approved" | "rejected" | "awaiting_review" | "manual_reviewed";
  questionsSnapshot?: MongoCourseExamQuestion[];
  examVersion?: number;
  attemptNumber?: number;
  studentIdentification?: {
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
    startedAt: Date;
    identificationCompletedAt: Date | null;
  } | null;
  identificationConfirmedAt?: Date | null;
  startedAt: Date;
  finishedAt: Date | null;
  correctedAt: Date | null;
  correctedBy: string | null;
  currentQuestionIndex: number;
  objectiveCorrect: number;
  objectiveWrong: number;
  writtenCount: number;
  score: number;
  automaticScore?: number;
  manualScore?: number | null;
  finalScore?: number | null;
  manualObservation?: string | null;
  result?: "approved" | "rejected" | null;
  maxScore: number;
  percent: number;
  correctionChannelId?: string | null;
  correctionMessageId: string | null;
  correctionSentAt?: Date | null;
  resultChannelId?: string | null;
  resultMessageId?: string | null;
  resultSentAt?: Date | null;
  rejectionReason: string | null;
  updatedAt: Date;
};

export type MongoCourseExamAnswer = {
  _id: string;
  botId: string | null;
  guildId: string;
  attemptId: string;
  courseId: string;
  questionId: string;
  questionOrder: number;
  questionText?: string;
  type: "selection" | "multiple" | "written";
  selectedAlternativeId: string | null;
  selectedAlternativeIds?: string[];
  selectedAlternativeText?: string | null;
  alternativesSnapshot?: Array<{ id: string; text: string; value?: string; score?: number; isCorrect?: boolean; order?: number }>;
  writtenAnswer: string | null;
  correct: boolean | null;
  pointsEarned: number;
  maxScore?: number;
  answeredAt: Date;
};

export type MongoCourseInstructorSettings = {
  _id: string;
  botId: string | null;
  guildId: string;
  enabled: boolean;
  authorizedRoleIds: string[];
  logChannelId: string | null;
  autoWeeklyReset: boolean;
  timezone: string;
  updatedAt: Date;
  updatedBy: string | null;
};

export type MongoCourseInstructorEvent = {
  _id: string;
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
  timestamp: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoCourseHistorySettings = {
  _id: string;
  botId: string | null;
  guildId: string;
  enabled: boolean;
  viewRoleIds: string[];
  removeRoleIds: string[];
  logChannelId: string | null;
  retentionDays: number | null;
  updatedAt: Date;
  updatedBy: string | null;
};

export type MongoCourseStudentHistory = {
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
  timestamp: Date;
  removedAt?: Date | null;
  removedBy?: string | null;
  removalReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoOpenDutyCounterMode = "accumulate" | "reset_after_3" | "cycles";

export type MongoOpenDutySettings = {
  _id: string;
  botId: string | null;
  guildId: string;
  enabled: boolean;
  logChannelId: string | null;
  alertChannelId: string | null;
  mentionChannelId?: string | null;
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
  buttonEmojis: {
    send: string;
    edit: string;
    cancel: string;
    config: string;
    logs: string;
    reset: string;
    search: string;
    save: string;
  };
  counterMode: MongoOpenDutyCounterMode;
  updatedAt: Date;
  updatedBy: string | null;
};

export type MongoOpenDutyWarningCounter = {
  _id: string;
  botId: string | null;
  guildId: string;
  userId: string;
  total: number;
  lastNotifiedAt: Date | null;
  updatedAt: Date;
};

export type MongoOpenDutyNotification = {
  _id: string;
  botId: string | null;
  guildId: string;
  executorId: string;
  targetId: string;
  message: string;
  edited: boolean;
  status: "sent" | "failed" | "cancelled" | "denied";
  errorReason: string | null;
  counterTotal: number;
  alertTriggered: boolean;
  createdAt: Date;
};

export type MongoRhAdminSettings = {
  _id: string;
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
  buttonEmojis: {
    absence: string;
    adornment: string;
    approve: string;
    reject: string;
    back: string;
    save: string;
    publish: string;
    logs: string;
  };
  mainPanelMessageId: string | null;
  mainPanelPublishedAt: Date | null;
  lastPanelRequestedAt?: Date | null;
  updatedAt: Date;
  updatedBy: string | null;
};

export type MongoRhAdminAbsence = {
  _id: string;
  botId: string | null;
  guildId: string;
  userId: string;
  serverName: string;
  startDate: string;
  returnDate: string;
  startAt: Date;
  returnAt: Date;
  reason: string;
  status: "pending" | "approved" | "rejected" | "finished";
  absenceRoleId: string | null;
  reviewerId: string | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  reviewChannelId: string | null;
  reviewMessageId: string | null;
  roleAddedAt: Date | null;
  roleRemovedAt: Date | null;
  autoRemoved: boolean;
  dmDelivered: boolean | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoRhAdminAdornment = {
  _id: string;
  botId: string | null;
  guildId: string;
  userId: string;
  serverName: string;
  number: string;
  imageUrl: string;
  observation: string | null;
  channelId: string | null;
  messageId: string | null;
  createdAt: Date;
};

export type MongoRhAdminLog = {
  _id: string;
  botId: string | null;
  guildId: string;
  userId: string | null;
  action: string;
  actorId: string | null;
  description: string;
  status: "success" | "warning" | "error" | "denied" | "info";
  metadata: Record<string, unknown>;
  channelId: string | null;
  createdAt: Date;
};

export type MongoManualRegistrationField = {
  enabled?: boolean;
  id: string;
  label: string;
  maxLength?: number | null;
  minLength?: number | null;
  name: string;
  placeholder?: string | null;
  required: boolean;
  style: "short" | "paragraph";
};

export type MongoManualRegistrationSetRole = {
  description: string | null;
  emoji: string | null;
  enabled: boolean;
  id: string;
  name: string;
  order: number;
  requestable: boolean;
  roleId: string;
};

export type MongoManualRegistrationSettings = {
  _id: string;
  approvalChannelId: string | null;
  allowOnlyOneRequest?: boolean;
  allowResubmit?: boolean;
  approvalMessage?: string | null;
  approverRoleIds?: string[];
  approvedRoleId?: string | null;
  manualRegistrationRoleIds?: string[];
  requestCategoryId?: string | null;
  automaticApproval?: boolean;
  autoRoleIds: string[];
  bannerPosition: "top" | "bottom" | "none";
  botId: string | null;
  color: string;
  description: string | null;
  cooldownMinutes?: number;
  dmNotifications?: boolean;
  enabled: boolean;
  emoji: string | null;
  fields: MongoManualRegistrationField[];
  footerText: string | null;
  guildId: string;
  logChannelId?: string | null;
  name: string;
  panelCategoryId?: string | null;
  panelChannelId?: string | null;
  panelMessageId?: string | null;
  rejectionMessage?: string | null;
  removeRoleIds: string[];
  setRoles?: MongoManualRegistrationSetRole[];
  staffRoleIds?: string[];
  successMessage?: string | null;
  thumbnailUrl: string | null;
  title: string;
  tutorial?: string | null;
  updatedAt: Date;
  updatedBy?: string | null;
};

export type MongoManualRegistrationSubmission = {
  _id: string;
  approvedAt?: Date | null;
  approvedBy?: string | null;
  botId: string | null;
  createdAt: Date;
  fields: Array<{ id: string; label: string; value: string }>;
  guildId: string;
  channelId?: string | null;
  requestedName?: string | null;
  registrationType?: "request" | "manual";
  registrationVersion?: number;
  removedAt?: Date | null;
  removedBy?: string | null;
  removalReason?: string | null;
  messageId?: string | null;
  rejectedAt?: Date | null;
  rejectedBy?: string | null;
  rejectionReason?: string | null;
  requestedRoleId?: string | null;
  status: "pending" | "approved" | "rejected" | "removed";
  updatedAt: Date;
  userAvatar?: string | null;
  userId: string;
  username: string;
};

export type MongoManualRegistrationLog = {
  _id: string;
  action: string;
  botId: string | null;
  createdAt: Date;
  data: Record<string, unknown>;
  executorId: string | null;
  guildId: string;
  submissionId: string | null;
  targetUserId: string | null;
};

export type MongoFivemGoalField = {
  id: string;
  label: string;
  maxLength?: number | null;
  minLength?: number | null;
  placeholder?: string | null;
  required: boolean;
  style: "short" | "paragraph";
};

export type MongoFivemGoalItem = {
  category: string | null;
  color: string | null;
  emoji: string | null;
  enabled: boolean;
  id: string;
  name: string;
  order: number;
};

export type MongoFivemGoalSettings = {
  _id: string;
  botId: string | null;
  categoryId: string | null;
  channelNameTemplate: string;
  enabled: boolean;
  fields: MongoFivemGoalField[];
  guildId: string;
  items: MongoFivemGoalItem[];
  logChannelId: string | null;
  managerRoleId: string | null;
  requestPanelChannelId?: string | null;
  requestPanelDescription?: string | null;
  requestPanelEnabled?: boolean;
  requestPanelMessageId?: string | null;
  requestPanelTitle?: string | null;
  requestRequiresApproval?: boolean;
  autoCreateWithManualRegistration?: boolean;
  updatedAt: Date;
  updatedBy?: string | null;
  viewRoleId: string | null;
};

export type MongoFivemGoalUserChannel = {
  _id: string;
  botId: string | null;
  channelId: string;
  createdAt: Date;
  guildId: string;
  updatedAt: Date;
  userId: string;
};

export type MongoFivemGoalEntry = {
  _id: string;
  botId: string | null;
  channelId: string;
  createdAt: Date;
  fields: Array<{ id: string; label: string; value: string }>;
  guildId: string;
  imageUrl: string;
  itemId: string | null;
  quantity: number | null;
  updatedAt: Date;
  userId: string;
};

export type MongoFivemGoalConfigStatus = "active" | "paused" | "finished";
export type MongoFivemGoalConfigPeriod = "daily" | "weekly" | "monthly" | "custom";

export type MongoFivemGoalResetConfig = {
  enabled: boolean;
  frequency: "none" | "daily" | "weekly" | "monthly" | "custom";
  customDate: string | null;
};

export type MongoFivemGoalConfig = {
  _id: string;
  botId: string | null;
  createdAt: Date;
  createdBy: string | null;
  description: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
  editRoleIds: string[];
  approverRoleIds: string[];
  deleteRoleIds: string[];
  fields: MongoFivemGoalField[];
  guildId: string;
  logChannelId: string | null;
  managerRoleIds: string[];
  name: string;
  order?: number;
  panelChannelId: string | null;
  panelMessageId: string | null;
  participantRoleIds: string[];
  period: MongoFivemGoalConfigPeriod;
  requiresApproval: boolean;
  requiresProof: boolean;
  resetConfig: MongoFivemGoalResetConfig;
  rules: string | null;
  status: MongoFivemGoalConfigStatus;
  targetValue: number;
  type: string;
  unit?: string;
  updatedAt: Date;
  updatedBy?: string | null;
  viewerRoleIds: string[];
};

export type MongoFivemGoalSubmission = {
  _id: string;
  approvedAt?: Date | null;
  approvedBy?: string | null;
  botId: string | null;
  createdAt: Date;
  description: string | null;
  fields: Array<{ id: string; label: string; value: string }>;
  guildId: string;
  idempotencyKey?: string | null;
  metaId: string;
  proofUrl: string | null;
  refusedAt?: Date | null;
  refusedBy?: string | null;
  refusalReason?: string | null;
  roleIdsSnapshot: string[];
  status: "pending" | "approved" | "refused";
  updatedAt: Date;
  userId: string;
  value: number;
};

export type MongoFivemGoalLog = {
  _id: string;
  action: string;
  botId: string | null;
  createdAt: Date;
  details: Record<string, unknown>;
  guildId: string;
  metaId: string | null;
  userId: string | null;
};

export type MongoFivemOrderSettings = {
  _id: string;
  adminRoleIds: string[];
  allowAnonymous: boolean;
  allowAttachments: boolean;
  allowCustomNotes: boolean;
  approvalChannelId: string | null;
  approvalRequired: boolean;
  approveRoleIds: string[];
  botId: string | null;
  cancelRoleIds: string[];
  color: string;
  createRoleIds: string[];
  deliveryChannelId: string | null;
  enabled: boolean;
  errorMessage: string;
  finishRoleIds: string[];
  editValueRoleIds: string[];
  footerText: string | null;
  guildId: string;
  logChannelId: string | null;
  maxOpenHours: number;
  enabledOrderModules: Array<"washing" | "ammo" | "drug" | "weapon" | "custom">;
  orderCancelledMessage: string;
  orderCreatedMessage: string;
  orderDeliveredMessage: string;
  panelChannelId: string | null;
  panelDescription: string;
  panelMessageId: string | null;
  panelTitle: string;
  updatedAt: Date;
  updatedBy?: string | null;
};

export type MongoFivemOrderFamily = {
  _id: string;
  active: boolean;
  botId: string | null;
  createdBy?: string | null;
  createdAt: Date;
  deletedAt?: Date | null;
  deletedBy?: string | null;
  guildId: string;
  leaderName?: string | null;
  logChannelId: string | null;
  name: string;
  notes: string | null;
  orderModules?: Array<"washing" | "ammo" | "drug" | "weapon" | "custom">;
  responsibleId: string;
  roleId: string;
  type?: "pista" | "produto" | "sem_produto";
  updatedAt: Date;
  updatedBy?: string | null;
};

export type MongoFivemOrderProduct = {
  _id: string;
  active: boolean;
  allowCustomQuantity: boolean;
  allowNotes: boolean;
  botId: string | null;
  category: string;
  cost: number;
  createdAt: Date;
  description: string | null;
  emoji: string | null;
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
  factionPercentage: number;
  washingPercentages?: number[];
  featured: boolean;
  guildId: string;
  defaultQuantity: number;
  minimumQuantity: number;
  maximumQuantity: number;
  name: string;
  order: number;
  price: number;
  sellerPercentage: number;
  type: "standard" | "washing" | "ammo" | "drug" | "weapon" | "custom";
  updatedAt: Date;
};

export type MongoFivemOrderStatus = "open" | "pending_approval" | "approved" | "in_production" | "ready" | "delivered" | "cancelled" | "rejected";

export type MongoFivemOrder = {
  _id: string;
  botId: string | null;
  category: string;
  clientName: string;
  costTotal: number;
  createdAt: Date;
  expectedDelivery: string | null;
  familyId: string;
  familyName: string;
  finalValue: number;
  grossValue: number;
  washingPercentage?: number | null;
  guildId: string;
  history: Array<{ actorId: string | null; at: Date; from: MongoFivemOrderStatus | null; note: string | null; to: MongoFivemOrderStatus }>;
  notes: string | null;
  orderNumber: number;
  productId: string;
  productName: string;
  profit: number;
  proofUrl: string | null;
  quantity: number;
  responsibleId: string | null;
  financialTransactionId?: string | null;
  sourceId: string | null;
  status: MongoFivemOrderStatus;
  unitPrice: number;
  updatedAt: Date;
  userId: string;
};

export type MongoFivemOrderLog = {
  _id: string;
  action: string;
  actorId: string | null;
  botId: string | null;
  createdAt: Date;
  data: Record<string, unknown>;
  guildId: string;
  orderId: string | null;
  productId: string | null;
};

export type MongoFivemFinanceSettings = {
  _id: string;
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
  botId: string | null;
  color: string;
  enabled: boolean;
  footerImageUrl: string | null;
  footerText: string | null;
  guildId: string;
  logChannelId: string | null;
  panelChannelId: string | null;
  panelDescription: string;
  panelMessageId: string | null;
  panelTitle: string;
  tempCategoryId: string | null;
  useRoleIds: string[];
  updatedAt: Date;
  updatedBy?: string | null;
};

export type MongoFivemFinanceTransactionStatus = "completed" | "reviewed" | "cancelled" | "corrected";

export type MongoFivemFinanceTransaction = {
  _id: string;
  amount: number;
  botId: string | null;
  createdAt: Date;
  guildId: string;
  logChannelId: string | null;
  logMessageId: string | null;
  newBalance: number;
  notes: string | null;
  managerId?: string;
  managerName?: string;
  metadata?: Record<string, unknown>;
  personName?: string;
  reason?: string;
  targetUserId?: string;
  oldBalance: number;
  proofImageUrl: string;
  proofMessageId: string | null;
  status: MongoFivemFinanceTransactionStatus;
  tempChannelId: string | null;
  transactionId: string;
  type: "add" | "remove";
  updatedAt: Date;
  userAvatar: string | null;
  userId: string;
  username: string;
};

export type MongoFivemFinanceLog = {
  _id: string;
  action: string;
  actorId: string | null;
  botId: string | null;
  createdAt: Date;
  data: Record<string, unknown>;
  guildId: string;
  transactionId: string | null;
};

export type MongoFivemHierarchyEntry = {
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

export type MongoFivemHierarchyPendingCleanup = {
  channelId: string;
  createdAt: Date;
  id: string;
  messageId: string;
  reason: "channel_changed" | "panel_deleted" | "migration_duplicate";
};

export type MongoFivemHierarchyPanel = {
  _id: string;
  allowedRoleIds: string[];
  botId: string | null;
  color: string;
  configRevision?: number;
  contentHash?: string | null;
  creationKey?: string | null;
  createdAt: Date;
  createdBy?: string | null;
  deletedAt?: Date | null;
  description: string | null;
  enabled: boolean;
  footerEnabled: boolean;
  footerIconUrl: string | null;
  footerText: string | null;
  guildId: string;
  hierarchies: MongoFivemHierarchyEntry[];
  imagePosition: "top" | "bottom" | "thumbnail" | "none";
  imageUrl: string | null;
  linkedToFivem: boolean;
  legacyCleanupPending?: boolean;
  logChannelId: string | null;
  managerUserIds?: string[];
  managerRoleIds?: string[];
  commandUserIds?: string[];
  commandRoleIds?: string[];
  migrationVersion?: number;
  name: string;
  panelChannelId: string | null;
  panelMessageId: string | null;
  panelVersion?: number;
  publishedAt?: Date | null;
  status?: "draft" | "completed" | "published" | "disabled";
  pendingCleanup?: MongoFivemHierarchyPendingCleanup[];
  stateUpdatedAt?: Date | null;
  title: string;
  updateLock?: {
    expiresAt: Date;
    instanceId: string;
    lockToken: string;
    revision: number;
  } | null;
  updatedAt: Date;
  updatedBy?: string | null;
};

export type MongoFivemHierarchyLog = {
  _id: string;
  action: string;
  botId: string | null;
  createdAt: Date;
  details: Record<string, unknown>;
  guildId: string;
  panelId: string | null;
  userId: string | null;
};

export type MongoGlobalBlacklistSafeBotSettings = {
  _id: string;
  autoBlacklistOnSafeBotBan: boolean;
  botId: string | null;
  directActions: string[];
  enabledSafeBotModules: string[];
  guildId: string;
  infractionLimit: number;
  kickMode: "history_only" | "alert" | "blacklist";
  logChannelId: string | null;
  requireApprovalAfterRemoval: boolean;
  updatedAt: Date;
  updatedBy?: string | null;
};

export type MongoGlobalBlacklistEntry = {
  _id: string;
  active: boolean;
  addedAt: Date;
  addedBy: string | null;
  addedByType: "safebot" | "staff";
  botId: string | null;
  evidence: Record<string, unknown>;
  guildId: string;
  reason: string;
  removedAt?: Date | null;
  removedBy?: string | null;
  removedReason?: string | null;
  requiresApprovalAfterRemoval?: boolean;
  safeBotModule: string | null;
  updatedAt: Date;
  userId: string;
};

export type MongoGlobalBlacklistHistory = {
  _id: string;
  action: "infraction" | "blacklisted" | "removed" | "monitored" | "approval_required";
  actorId: string | null;
  botId: string | null;
  createdAt: Date;
  evidence: Record<string, unknown>;
  guildId: string;
  infractionType: string;
  reason: string;
  safeBotModule: string | null;
  userId: string;
};

export type MongoServerBackupSettings = {
  _id: string;
  autoEnabled: boolean;
  authorizedRoleIds: string[];
  botId: string;
  frequency: "6h" | "12h" | "daily" | "weekly" | "monthly";
  guildId: string;
  limit: number;
  logChannelId: string | null;
  updatedAt: Date;
  updatedBy?: string | null;
};

export type MongoServerBackupSnapshot = {
  _id: string;
  botId: string;
  checksum?: string | null;
  counts: {
    categories: number;
    channels: number;
    emojis: number;
    roles: number;
    stickers: number;
  };
  createdAt: Date;
  createdBy: string | null;
  guildId: string;
  guildName: string;
  kind: "manual" | "automatic";
  snapshotVersion?: number;
  snapshot: Record<string, unknown>;
  status: "pending" | "completed" | "failed" | "partial";
  statusMessage: string | null;
  updatedAt: Date;
};

export type MongoServerBackupRestoreJob = {
  _id: string;
  backupId: string;
  botId: string;
  completedAt: Date | null;
  createdAt: Date;
  createdBy: string | null;
  guildId: string;
  options: string[];
  progress?: number;
  preview: Record<string, unknown>;
  result: Record<string, unknown> | null;
  sourceGuildId?: string | null;
  status: "pending" | "running" | "completed" | "failed" | "partial";
  targetGuildId?: string | null;
  updatedAt: Date;
};

export type MongoBackgroundJob = {
  _id: string;
  attempts: number;
  availableAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  idempotencyKey: string;
  lastError: string | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  lockedUntil: Date | null;
  logs: Array<{ at: Date; message: string; status: string }>;
  maxAttempts: number;
  payload: Record<string, unknown>;
  priority: number;
  status: "pending" | "running" | "completed" | "failed";
  type: string;
  updatedAt: Date;
};

export type MongoServiceHeartbeat = {
  _id: string;
  expiresAt: Date;
  instanceId: string;
  metadata: Record<string, unknown>;
  service: string;
  startedAt: Date;
  updatedAt: Date;
};

export type MongoLogEntry = {
  _id: string;
  botId: string;
  guildId: string;
  userId: string | null;
  executorId?: string | null;
  channelId?: string | null;
  logChannelId?: string | null;
  module?: string | null;
  action?: string | null;
  caseId?: string | null;
  status?: "success" | "warning" | "error" | "denied" | "info" | string;
  transcriptId?: string | null;
  type: string;
  message: string;
  metadata?: unknown;
  createdAt: Date;
};

export type MongoSocialNotification = {
  _id: string;
  botId?: string | null;
  guildId: string;
  userId: string;
  createdBy?: string;
  updatedBy?: string | null;
  platform: "twitch" | "kick";
  twitchChannelName?: string | null;
  twitchChannelUrl?: string | null;
  twitchUserId?: string | null;
  twitchAvatar?: string | null;
  kickChannelName?: string | null;
  kickChannelUrl?: string | null;
  kickChannelId?: string | null;
  kickUserId?: string | null;
  kickDisplayName?: string | null;
  kickAvatar?: string | null;
  kickBanner?: string | null;
  kickFollowers?: number | null;
  kickVerified?: boolean | null;
  kickCategory?: string | null;
  discordChannelId: string;
  mentionRoleId: string | null;
  customMessage: string | null;
  embedColor?: string | null;
  enabled: boolean;
  isLive: boolean;
  lastLiveAt?: Date | null;
  lastEndedAt?: Date | null;
  lastStreamId: string | null;
  lastMessageId: string | null;
  peakViewers?: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoLiveDetectionSettings = {
  _id?: string;
  botId: string | null;
  guildId: string;
  enabled: boolean;
  liveRoleId: string | null;
  logChannelId: string | null;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
};

export type MongoPoliceTimeClockSettings = {
  _id?: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  panelChannelId: string | null;
  panelMessageId: string | null;
  logChannelId: string | null;
  managerRoleId: string | null;
  closeRoleId: string | null;
  reportRoleId: string | null;
  exportRoleId: string | null;
  adminRoleId: string | null;
  allowManualEntry: boolean;
  allowManualExit: boolean;
  allowAutomaticEntry: boolean;
  allowForcedClose: boolean;
  allowHistory: boolean;
  allowExport: boolean;
  maxHours: number | null;
  timezone: string;
  timeFormat: "24h" | "12h";
  autoUpdatePanel: boolean;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
};

export type MongoPoliceTimeClockSession = {
  _id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string;
  roleNames: string[];
  status: "open" | "closed" | "forced";
  origin: "manual" | "automatic" | "forced";
  startedAt: Date;
  endedAt: Date | null;
  durationMs: number | null;
  netDurationMs: number | null;
  createdBy: string | null;
  closedBy: string | null;
  closeReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoPoliceTimeClockLog = {
  _id: string;
  botId: string;
  guildId: string;
  userId: string | null;
  adminId: string | null;
  action: string;
  result: "success" | "error" | "denied" | "info";
  message: string;
  metadata?: unknown;
  createdAt: Date;
};

export type MongoAutoActivityClockSettings = {
  _id?: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  panelChannelId: string | null;
  panelMessageId: string | null;
  logChannelId: string | null;
  viewRoleIds: string[];
  manualEntryRoleIds: string[];
  manualExitRoleIds: string[];
  closeRoleIds: string[];
  historyRoleIds: string[];
  exportRoleIds: string[];
  updatePanelRoleIds: string[];
  adminRoleIds: string[];
  cityManagerRoleIds: string[];
  allowedUserIds: string[];
  blockedUserIds: string[];
  confirmMinutes?: number;
  weeklyGoalMinutes?: number;
  minMinutes: number;
  maxHours: number | null;
  autoUpdatePanel: boolean;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
};

export type MongoAutoActivityClockCity = {
  _id: string;
  botId: string;
  guildId: string;
  name: string;
  aliases: string[];
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
};

export type MongoAutoActivityClockSession = {
  _id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string;
  cityId: string;
  cityName: string;
  statusDiscord: string;
  status: "open" | "closed" | "forced";
  origin: "automatic" | "manual" | "forced";
  startedAt: Date;
  endedAt: Date | null;
  durationMs: number | null;
  createdBy?: string | null;
  closedBy?: string | null;
  closeReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoAutoActivityClockLog = {
  _id: string;
  botId: string;
  guildId: string;
  userId: string | null;
  adminId: string | null;
  action: string;
  result: "success" | "error" | "denied" | "info";
  message: string;
  metadata?: unknown;
  createdAt: Date;
};

export type MongoKickApiConfig = {
  _id: string;
  botId?: string | null;
  guildId: string;
  clientId: string;
  clientSecretEncrypted: string;
  redirectUri: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoSocialMember = {
  _id: string;
  botId?: string | null;
  guildId: string;
  userId?: string | null;
  discordId?: string | null;
  name: string;
  avatar: string | null;
  role?: string | null;
  twitter: string | null;
  instagram: string | null;
  twitch: string | null;
  youtube: string | null;
  tiktok: string | null;
  kick: string | null;
  facebook: string | null;
  website: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoSocialPanel = {
  _id: string;
  botId?: string | null;
  guildId: string;
  channelId: string | null;
  messageId: string | null;
  embedColor: string | null;
  published: boolean;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastPublishedAt?: Date | null;
};

export type MongoXAccount = {
  _id: string;
  botId?: string | null;
  guildId: string;
  channelId: string;
  xUserId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  active: boolean;
  lastSyncAt: Date | null;
  lastPostId: string | null;
  lastPostAt: Date | null;
  lastApiStatus: "idle" | "ok" | "error";
  lastApiError: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoXPostSent = {
  _id: string;
  botId?: string | null;
  guildId: string;
  channelId: string;
  accountId: string;
  xPostId: string;
  xPostUrl: string;
  discordMessageId: string | null;
  sentAt: Date;
};

export type MongoClipMentionType = "none" | "everyone" | "role";
export type MongoClipPlatform = "twitch" | "kick";

export type MongoClipRewardRole = {
  clipCount: number;
  label: string;
  roleId: string;
};

export type MongoClipsConfig = {
  _id: string;
  guildId: string;
  botId?: string | null;
  platform?: MongoClipPlatform;
  twitchChannelName?: string | null;
  twitchBroadcasterId?: string | null;
  twitchDisplayName?: string | null;
  twitchAvatar?: string | null;
  kickChannelName?: string | null;
  kickChannelUrl?: string | null;
  kickChannelId?: string | null;
  kickUserId?: string | null;
  kickDisplayName?: string | null;
  kickAvatar?: string | null;
  kickFollowers?: number | null;
  kickApiTokenEncrypted?: string | null;
  discordChannelId: string | null;
  enabled: boolean;
  allowedRoleIds: string[];
  mentionType: MongoClipMentionType;
  mentionRoleId: string | null;
  embedColor: string | null;
  customMessage: string | null;
  clipRewards?: MongoClipRewardRole[];
  checkInterval: number;
  lastCheckAt: Date | null;
  activeLiveSessionId?: string | null;
  activeLiveStartedAt?: Date | null;
  activeLiveTitle?: string | null;
  activeLiveThumbnail?: string | null;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoClipSent = {
  _id: string;
  guildId: string;
  botId?: string | null;
  configId?: string | null;
  platform?: MongoClipPlatform;
  twitchChannelName?: string | null;
  twitchBroadcasterId?: string | null;
  kickChannelName?: string | null;
  kickUserId?: string | null;
  clipId: string;
  clipTitle: string;
  clipUrl: string;
  clipThumbnail: string | null;
  clipCreatorName: string | null;
  clipDuration?: number | null;
  createdAtTwitch: Date;
  discordChannelId: string | null;
  discordMessageId: string | null;
  sentAt: Date;
};

export type MongoClipLog = {
  _id: string;
  guildId: string;
  botId?: string | null;
  platform?: MongoClipPlatform;
  action: string;
  userId: string | null;
  message: string;
  createdAt: Date;
};

export type MongoClipLiveSession = {
  _id: string;
  guildId: string;
  botId?: string | null;
  configId: string;
  platform: MongoClipPlatform;
  streamId: string;
  channelName: string;
  title: string | null;
  thumbnailUrl: string | null;
  startedAt: Date;
  endedAt: Date | null;
  status: "active" | "ended";
  createdAt: Date;
  updatedAt: Date;
};

export type MongoGiveawayStatus = "waiting" | "running" | "ended";
export type MongoGiveawayParticipantSource = "twitch" | "kick";
export type MongoGiveawayParticipantMode =
  | "twitch_subs"
  | "twitch_followers"
  | "twitch_subs_followers"
  | "kick_subs"
  | "kick_followers"
  | "twitch_kick"
  | "all";

export type MongoGiveawayParticipant = {
  id: string;
  accountId?: string | null;
  platform?: MongoGiveawayParticipantSource;
  platformUserId?: string;
  username: string;
  displayName: string;
  subscriber?: boolean;
  follower?: boolean;
  source: MongoGiveawayParticipantSource;
  subTier?: "prime" | "1000" | "2000" | "3000" | string | null;
  subTierLabel?: string | null;
  subMonths?: number | null;
  isPrime?: boolean;
  isVip?: boolean;
  isModerator?: boolean;
  isEditor?: boolean;
  tickets?: number;
  eligible?: boolean;
  invalidReason?: string | null;
  validatedAt: Date;
};

export type MongoGiveawayWinner = {
  participantId: string;
  username: string;
  displayName: string;
  wonAt: Date;
};

export type MongoGiveaway = {
  _id: string;
  botId?: string | null;
  guildId: string;
  ownerId: string;
  discordChannelId: string | null;
  title: string;
  liveName: string;
  liveUrl: string;
  livePlatform: "twitch" | "kick" | "multi";
  twitchBroadcasterId: string;
  twitchChannelName?: string | null;
  kickChannelName?: string | null;
  kickUserId?: string | null;
  kickChannelId?: string | null;
  participantMode?: MongoGiveawayParticipantMode;
  lastSyncedAt?: Date | null;
  lastSyncError?: string | null;
  prizeName: string;
  participants: MongoGiveawayParticipant[];
  winners: MongoGiveawayWinner[];
  status: MongoGiveawayStatus;
  rouletteToken: string;
  rouletteUrl: string;
  panelMessageId: string | null;
  winnerCount: number;
  allowRepeatWinners: boolean;
  startDelayMinutes: number;
  endDelayMinutes: number;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  customMessage: string | null;
  schedulerError?: string | null;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  updatedAt: Date;
};

export type MongoGiveawayPlatformAccount = {
  _id: string;
  platform: MongoGiveawayParticipantSource;
  platformUserId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  scopes: string[];
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastVerifiedAt: Date | null;
};

export type MongoGiveawayKickEvent = {
  _id: string;
  broadcasterUserId: string | null;
  channelSlug: string | null;
  userId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  isFollower: boolean;
  isSubscriber: boolean;
  lastChatAt: Date | null;
  lastFollowedAt: Date | null;
  lastSubscribedAt: Date | null;
  subExpiresAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
};

export type MongoFivemFacMessages = {
  panelTitle: string;
  panelDescription: string;
  requestCreated: string;
  approved: string;
  rejected: string;
  started: string;
  finished: string;
};

export type MongoPanelImagePosition = "right_small" | "top" | "bottom" | "none";
export type MongoPanelButtonsPosition = "inside_panel" | "outside_panel" | "below" | "rows" | "none";
export type MongoPanelButtonStyle = "primary" | "secondary" | "success" | "danger" | "link";
export type MongoPanelButtonAction = "request_absence" | "my_absences" | "url";

export type MongoPanelButtonConfig = {
  id: string;
  label: string;
  emoji: string | null;
  style: MongoPanelButtonStyle;
  type: "action" | "url";
  action: MongoPanelButtonAction;
  url: string | null;
  order: number;
  enabled: boolean;
};

export type MongoPanelVisualConfig = {
  panelColor: string;
  imageUrl: string | null;
  imagePosition: MongoPanelImagePosition;
  buttonsPosition: MongoPanelButtonsPosition;
  buttons: MongoPanelButtonConfig[];
  componentsOrder: Array<"image" | "text" | "buttons">;
  enabledSections: {
    image: boolean;
    buttons: boolean;
    description: boolean;
  };
};

export type MongoFivemFacSettings = {
  _id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  categoryId?: string | null;
  channelCloseMode?: "keep" | "lock" | "delete";
  panelChannelId: string | null;
  panelMessageId: string | null;
  absenceRoleId: string | null;
  autoApproveEnabled?: boolean;
  autoApproveMaxDays?: number | null;
  autoApproveRoleIds?: string[];
  viewerRoleIds: string[];
  approverRoleIds: string[];
  memberRoleIds?: string[];
  logChannelId: string | null;
  messages: MongoFivemFacMessages;
  panelVisual?: MongoPanelVisualConfig | null;
  lastPanelRequestedAt?: Date | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoFivemFacAbsenceStatus = "pending" | "approved" | "active" | "rejected" | "finished" | "closed";

export type MongoFivemFacAuditEntry = {
  action: string;
  actorId: string | null;
  reason: string | null;
  status: MongoFivemFacAbsenceStatus;
  createdAt: Date;
};

export type MongoFivemFacAbsence = {
  _id: string;
  approvedBy?: string | null;
  botId: string;
  guildId: string;
  userId: string;
  username: string | null;
  reason: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  photoUrl?: string | null;
  status: MongoFivemFacAbsenceStatus;
  privateChannelId: string | null;
  requestMessageId: string | null;
  moderatorId: string | null;
  rejectionReason: string | null;
  roleAddedAt: Date | null;
  roleRemovedAt: Date | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  closedAt: Date | null;
  audit: MongoFivemFacAuditEntry[];
  createdAt: Date;
  updatedAt: Date;
};

export type MongoFivemModule = {
  _id: string;
  title: string;
  description: string;
  permissions: string;
  builtIn: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoFivemActionArchitecture = "fac" | "police";
export type MongoFivemActionImagePosition = "top" | "center" | "bottom" | "none";
export type MongoFivemActionMode = "shootout" | "escape";

export type MongoFivemActionSettings = {
  _id: string;
  botId: string;
  guildId: string;
  architecture: MongoFivemActionArchitecture;
  enabled: boolean;
  categoryId: string | null;
  panelChannelId: string | null;
  actionChannelId: string | null;
  reportChannelId: string | null;
  managerRoleIds?: string[];
  spreadsheetEnabled?: boolean;
  spreadsheetId?: string | null;
  spreadsheetSheetName?: string | null;
  spreadsheetLastSyncAt?: Date | null;
  spreadsheetSyncError?: string | null;
  panelMessageId: string | null;
  panelTitle: string;
  panelDescription: string;
  color: string;
  imageUrl: string | null;
  imagePosition: MongoFivemActionImagePosition;
  reportBannerUrls?: string[];
  lastPanelRequestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
};

export type MongoFivemActionDefinition = {
  _id: string;
  botId: string;
  guildId: string;
  architecture: MongoFivemActionArchitecture;
  name: string;
  description: string;
  emoji: string | null;
  imageUrl: string | null;
  color: string;
  maxParticipants: number;
  enabled: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
};

export type MongoFivemActionParticipant = {
  userId: string;
  username: string;
  roleIds: string[];
  position?: "confirmed" | "reserve";
  joinedAt: Date;
  leftAt: Date | null;
};

export type MongoFivemActionSession = {
  _id: string;
  botId: string;
  guildId: string;
  architecture: MongoFivemActionArchitecture;
  actionId: string;
  actionName: string;
  actionDescription: string;
  actionEmoji: string | null;
  actionImageUrl: string | null;
  actionColor: string;
  mode?: MongoFivemActionMode | null;
  openerId: string;
  openerName: string;
  channelId: string | null;
  messageId: string | null;
  sheetRow?: number | null;
  sheetSyncStatus?: "pending" | "synced" | "failed" | null;
  sheetSyncError?: string | null;
  sheetLastSyncAt?: Date | null;
  status: "forming" | "active" | "victory" | "defeat" | "draw" | "cancelled";
  maxParticipants: number;
  participants: MongoFivemActionParticipant[];
  startedAt: Date | null;
  cancelledAt?: Date | null;
  cancelledBy?: string | null;
  cancellationReason?: string | null;
  finishedAt: Date | null;
  resultNote?: string | null;
  resultSummary?: string | null;
  resultOccurrence?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoFactionChestSettings = {
  _id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  categoryId: string | null;
  panelChannelId: string | null;
  logChannelId: string | null;
  auditChannelId: string | null;
  registerRoleIds: string[];
  auditRoleIds: string[];
  viewRoleIds: string[];
  adminRoleIds: string[];
  systemName: string;
  panelImageUrl: string | null;
  color: string;
  panelMessageId: string | null;
  lastPanelRequestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
};

export type MongoFactionChestItem = {
  _id: string;
  botId: string;
  guildId: string;
  name: string;
  normalizedName: string;
  quantity: number;
  category: string;
  description: string | null;
  imageUrl: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoFactionChestLog = {
  _id: string;
  botId: string;
  guildId: string;
  action: "add" | "remove" | "create" | "update" | "delete" | "publish" | "config" | "view" | "audit" | "export";
  itemId: string | null;
  itemName: string;
  quantity: number;
  previousQuantity: number | null;
  nextQuantity: number | null;
  reason: string | null;
  actorId: string;
  actorName: string;
  channelId: string | null;
  messageId: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
};

export type MongoDafScaleRole = "pilot" | "shooter";

export type MongoDafScaleSettings = {
  _id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  panelChannelId: string | null;
  logChannelId: string | null;
  participantRoleId: string | null;
  configRoleId: string | null;
  pilotRoleId: string | null;
  shooterRoleId: string | null;
  maxPilots: number;
  maxShooters: number;
  panelMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
};

export type MongoDafScaleEntry = {
  _id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string;
  role: MongoDafScaleRole;
  joinedAt: Date;
  updatedAt: Date;
};

export type MongoDafScaleAudit = {
  _id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string;
  action: "join" | "leave" | "switch" | "refresh" | "publish" | "config";
  role: MongoDafScaleRole | null;
  previousRole: MongoDafScaleRole | null;
  createdAt: Date;
  metadata?: Record<string, unknown> | null;
};

export type MongoPolicePatrolSettings = {
  _id: string; botId: string; guildId: string; enabled: boolean;
  creatorRoleIds: string[]; viewerRoleIds: string[]; deleteRoleIds: string[]; supervisorRoleIds: string[];
  logChannelId: string | null; temporaryCategoryId: string | null; deleteDelayMinutes: number;
  defaultExportFormat: "html" | "pdf" | "json"; createdAt: Date; updatedAt: Date; updatedBy: string | null;
};

export type MongoPolicePatrolReport = {
  _id: string; botId: string; guildId: string; officerId: string; officerName: string; authorId: string; authorName: string;
  openKey?: string;
  patrolType: string | null; initialNotes: string | null; patrolStart: string | null; patrolEnd: string | null; durationMinutes: number | null;
  channelId: string | null; panelMessageId: string | null; lastAuthorMessageId: string | null;
  messageCount: number; attachmentCount: number; status: "draft" | "active" | "finished" | "cancelled";
  createdAt: Date; startedAt: Date | null; finishedAt: Date | null; cancelledAt: Date | null; deleteAt: Date | null; updatedAt: Date;
};

export type MongoPolicePatrolMessage = {
  _id: string; reportId: string; botId: string; guildId: string; discordMessageId: string; authorId: string;
  content: string; attachments: Array<{ id: string; name: string; url: string; contentType: string | null; size: number }>;
  embeds: unknown[]; stickers: Array<{ id: string; name: string; format: number }>;
  emojis: string[]; createdAt: Date;
};

export type MongoPolicePatrolAudit = {
  _id: string; reportId: string; botId: string; guildId: string; actorId: string | null; action: string; metadata: Record<string, unknown>; createdAt: Date;
};
export type MongoPolicePatrolFile = { _id: string; reportId: string; botId: string; guildId: string; discordAttachmentId: string; name: string; mimeType: string; size: number; buffer: Buffer; createdAt: Date };

export type MongoVehicleAbandonmentSettings = {
  _id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  systemChannelId: string | null;
  recordChannelId: string | null;
  logChannelId: string | null;
  allowedRoleIds: string[];
  mentionRoleId: string | null;
  color: string;
  emoji: string;
  systemName: string;
  embedTitle: string;
  footerText: string;
  thumbnailUrl: string | null;
  defaultImageUrl: string | null;
  successMessage: string;
  errorMessage: string;
  deleteOriginalMessage: boolean;
  logsEnabled: boolean;
  allowMultipleAttachments: boolean;
  maxImages: number;
  allowRecordEditing: boolean;
  confirmationBeforeSend: boolean;
  explanatoryPanelAllowedRoleIds: string[];
  explanatoryPanelButtonEnabled: boolean;
  explanatoryPanelChannelId: string | null;
  explanatoryPanelColor: string;
  explanatoryPanelCommandEnabled: boolean;
  explanatoryPanelCommonErrorsText: string;
  explanatoryPanelDescription: string;
  explanatoryPanelEmoji: string;
  explanatoryPanelExampleText: string;
  explanatoryPanelFinalText: string;
  explanatoryPanelHowItWorksText: string;
  explanatoryPanelImageUrl: string | null;
  explanatoryPanelModalContent: string;
  explanatoryPanelModalTitle: string;
  explanatoryPanelNotesText: string;
  explanatoryPanelRequiredFieldsText: string;
  explanatoryPanelThumbnailUrl: string | null;
  explanatoryPanelTitle: string;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
};

export type MongoVehicleAbandonmentRecord = {
  _id: string;
  botId: string;
  guildId: string;
  systemChannelId: string;
  recordChannelId: string;
  sourceMessageId: string;
  recordMessageId: string | null;
  authorId: string;
  authorName: string;
  model: string;
  plate: string;
  report: string;
  imageUrls: string[];
  status: "registered" | "failed";
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoVehicleAbandonmentLog = {
  _id: string;
  botId: string;
  guildId: string;
  recordId: string | null;
  actorId: string | null;
  action: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type MongoPoliceQruSettings = {
  _id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  recordChannelId: string | null;
  logChannelId: string | null;
  approvalChannelId?: string | null;
  temporaryCategoryId: string | null;
  allowedRoleIds: string[];
  supervisorRoleIds: string[];
  teamRoleId: string | null;
  deleteChannelSeconds: number;
  color: string;
  panelTitle: string;
  panelDescription: string;
  panelImageUrl: string | null;
  panelMessage: string;
  rankingChannelId?: string | null;
  rankingMessageId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
};

export type MongoPoliceQruOfficer = {
  id: string;
  name: string;
  mention: string;
};

export type MongoPoliceQruRecord = {
  _id: string;
  botId: string;
  guildId: string;
  boNumber: string;
  qruType: string;
  occurrenceDate: string;
  evidenceUrl: string;
  seizures?: string | null;
  notes?: string | null;
  vehicle?: string | null;
  status?: "pending" | "approved" | "rejected";
  authorId: string;
  authorName: string;
  officers: MongoPoliceQruOfficer[];
  temporaryChannelId: string | null;
  recordChannelId: string | null;
  recordMessageId: string | null;
  approvalChannelId?: string | null;
  approvalMessageId?: string | null;
  approvedById?: string | null;
  approvedByName?: string | null;
  approvedAt?: Date | null;
  rejectionCount?: number;
  rejections?: Array<{
    reason: string;
    rejectedAt: Date;
    supervisorId: string;
    supervisorName: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoPoliceQruLog = {
  _id: string;
  botId: string;
  guildId: string;
  recordId: string | null;
  actorId: string | null;
  actorName: string | null;
  action: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type MongoPolicePromotionQuestionType = "short" | "paragraph" | "number" | "date" | "time" | "select" | "checkbox" | "radio";

export type MongoPolicePromotionQuestion = {
  id: string;
  active: boolean;
  defaultValue: string | null;
  description: string | null;
  label: string;
  maxLength: number | null;
  options: string[];
  order: number;
  placeholder: string | null;
  required: boolean;
  type: MongoPolicePromotionQuestionType;
};

export type MongoPolicePromotionDefinition = {
  id: string;
  active: boolean;
  approvalRoleIds: string[];
  categoryId: string | null;
  color: string;
  description: string;
  evaluatorRoleIds: string[];
  grantedRoleId: string | null;
  historyChannelId: string | null;
  logChannelId: string | null;
  name: string;
  panelChannelId: string | null;
  panelDescription: string;
  panelMessageId: string | null;
  panelTitle: string;
  receivedRankName: string;
  rejectedRoleIds: string[];
  removedRoleId: string | null;
  requestNewEvaluationEnabled: boolean;
  questions: MongoPolicePromotionQuestion[];
  emoji: string | null;
};

export type MongoPolicePromotionSettings = {
  _id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  defaultApprovalChannelId: string | null;
  defaultCategoryId: string | null;
  defaultHistoryChannelId: string | null;
  defaultLogChannelId: string | null;
  defaultPanelChannelId: string | null;
  promotions: MongoPolicePromotionDefinition[];
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
};

export type MongoPolicePromotionAnswer = {
  questionId: string;
  label: string;
  type: MongoPolicePromotionQuestionType;
  value: string | string[];
};

export type MongoPolicePromotionHistoryEntry = {
  action: string;
  actorId: string | null;
  actorName: string | null;
  at: Date;
  metadata: Record<string, unknown>;
};

export type MongoPolicePromotionRequest = {
  _id: string;
  approvalChannelId: string | null;
  approvalMessageId: string | null;
  approvalReason: string | null;
  approvalResult: "approved" | "rejected" | null;
  approvedAt: Date | null;
  approvedById: string | null;
  approvedByName: string | null;
  answers: MongoPolicePromotionAnswer[];
  botId: string;
  channelId: string | null;
  channelMessageId: string | null;
  createdAt: Date;
  currentRank: string;
  evaluationEndedAt: Date | null;
  evaluationAttemptNumber: number | null;
  evaluationNotes: string | null;
  evaluationResult: "approved" | "rejected" | null;
  evaluationStartedAt: Date | null;
  evaluatorId: string | null;
  evaluatorName: string | null;
  guildId: string;
  history: MongoPolicePromotionHistoryEntry[];
  inGameId: string;
  logChannelId: string | null;
  previousRequestId: string | null;
  promotionId: string;
  promotionName: string;
  requesterId: string;
  requesterName: string;
  requestedDate: string;
  requestedTime: string;
  status: "submitted" | "ticket_open" | "in_evaluation" | "pending_approval" | "approved" | "rejected" | "cancelled" | "closed";
  targetRank: string;
  updatedAt: Date;
};

export type MongoPolicePromotionLog = {
  _id: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  botId: string;
  createdAt: Date;
  guildId: string;
  metadata: Record<string, unknown>;
  requestId: string | null;
};

export type MongoPoliceHiddenChannelSettings = {
  _id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  channelId: string | null;
  allowedRoleId: string | null;
  logChannelId: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedBy: string | null;
  updatedAt: Date;
};

export type MongoPoliceHiddenChannelLog = {
  _id: string;
  botId: string;
  guildId: string;
  channelId: string;
  logChannelId: string | null;
  originalMessageId: string;
  relayedMessageId: string | null;
  authorId: string;
  authorTag: string;
  content: string;
  attachmentUrls: string[];
  stickerIds: string[];
  embedCount: number;
  status: "relayed" | "failed";
  errorMessage: string | null;
  createdAt: Date;
};

export type MongoVisibleMessageUser = {
  _id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  enabled: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedBy: string | null;
  updatedAt: Date;
};

export type MongoMessageControlUser = {
  _id: string;
  autorizado: boolean;
  avatarUrl: string | null;
  botId: string;
  createdAt: Date;
  createdBy: string | null;
  discordId: string;
  guildId: string;
  status: "equipe" | "pessoal";
  updatedAt: Date;
  updatedBy: string | null;
  username: string | null;
};

export type MongoMessageControlSettings = {
  _id: string;
  botId: string;
  guildId: string;
  managerRoleIds: string[];
  managerUserIds: string[];
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
};

export type MongoDmBarConfig = {
  _id: string;
  accentColor: string;
  allowAdmins: boolean;
  allowedRoleIds: string[];
  allowedUserIds: string[];
  allowMentions: boolean;
  botId: string;
  cooldownSeconds: number;
  createdAt: Date;
  descriptionTemplate: string;
  enabled: boolean;
  emoji: string;
  footerEnabled: boolean;
  footerIconUrl: string | null;
  footerText: string;
  guildId: string;
  imagePosition: "top" | "middle" | "bottom" | "gallery" | "thumbnail" | "none";
  logChannelId: string | null;
  logsEnabled: boolean;
  mainImageUrl: string | null;
  showDate: boolean;
  showSender: boolean;
  showServer: boolean;
  showTargetId: boolean;
  signature: string;
  titleTemplate: string;
  updatedAt: Date;
  updatedBy: string | null;
};

export type MongoDmBarLog = {
  _id: string;
  botId: string;
  guildId: string;
  senderId: string;
  targetId: string | null;
  title: string;
  message: string;
  status: "sent" | "failed" | "denied" | "cancelled" | "test";
  errorReason: string | null;
  sentAt: Date;
};

export type MongoImageAntiSpamSettings = {
  _id: string;
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
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoImageAntiSpamUser = {
  _id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string | null;
  warningCount: number;
  totalImagesRemoved: number;
  lastInfractionAt: Date | null;
  lastPunishment: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoImageAntiSpamIncident = {
  _id: string;
  botId: string;
  guildId: string;
  incidentKey: string;
  userId: string;
  username: string | null;
  channelId: string;
  channelIds?: string[];
  mediaTypes?: string[];
  messageIds?: string[];
  removedImages: number;
  removedMessages?: number;
  warningCount: number;
  timeoutMs: number;
  action: "none" | "warning" | "timeout" | "kick";
  actionSucceeded: boolean | null;
  actionError: string | null;
  reason: string;
  status: "pending" | "completed" | "failed";
  createdAt: Date;
  updatedAt: Date;
};

export type MongoVoiceRecorderStatus = "starting" | "recording" | "processing" | "completed" | "failed" | "deleted";

export type MongoVoiceRecorderSettings = {
  _id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  logChannelId: string | null;
  allowedRoleIds: string[];
  maxDurationMinutes: number;
  retentionDays: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoVoiceRecordingParticipant = {
  userId: string;
  username: string | null;
  joinedAt: Date;
  leftAt: Date | null;
  speakingMs: number;
};

export type MongoVoiceRecordingEvent = {
  type: string;
  userId: string | null;
  username: string | null;
  message: string;
  createdAt: Date;
  metadata?: Record<string, unknown>;
};

export type MongoVoiceRecording = {
  _id: string;
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
  participants: MongoVoiceRecordingParticipant[];
  events: MongoVoiceRecordingEvent[];
  startedAt: Date;
  endedAt: Date | null;
  durationMs: number;
  filePath: string | null;
  fileName: string | null;
  fileSize: number;
  mimeType: string | null;
  accessToken: string | null;
  status: MongoVoiceRecorderStatus;
  error: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoEmojiCloneJob = {
  _id: string;
  botId: string | null;
  guildId: string;
  userId: string;
  sourceGuildId: string | null;
  status: "pending" | "running" | "completed" | "cancelled";
  total: number;
  success: number;
  failed: number;
  prefix: string | null;
  createdAt: Date;
  finishedAt: Date | null;
};

export type MongoEmojiCloneItem = {
  _id: string;
  jobId: string;
  originalEmojiId: string;
  originalName: string;
  newEmojiId: string | null;
  newName: string | null;
  animated: boolean;
  status: "pending" | "success" | "failed";
  errorReason: string | null;
};

export type MongoEmojiLibraryItem = {
  _id: string;
  animated: boolean;
  botId: string;
  category?: string | null;
  destinationGuildId: string;
  importedAt: Date;
  lastUpdatedAt: Date;
  localFilePath?: string | null;
  name: string;
  originalEmojiId: string;
  sourceGuildId: string | null;
  targetEmojiId: string | null;
  targetEmojiName: string | null;
  url: string;
  userId: string;
};

export type MongoMediaLibraryItem = {
  _id: string;
  botId: string;
  guildId: string;
  type: "emoji" | "sound";
  name: string;
  originalName: string;
  fileUrl: string;
  localPath: string;
  discordEmojiId: string | null;
  animated: boolean | null;
  category: string | null;
  format: string;
  mimeType: string;
  size: number;
  source: "clone" | "zip_import" | "manual_upload";
  status: "active" | "error" | "deleted";
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoMediaImportJob = {
  _id: string;
  botId: string;
  guildId: string;
  uploadedBy: string;
  zipFileName: string;
  tempDirectory: string;
  status: "pending" | "extracting" | "waiting_confirmation" | "importing" | "completed" | "failed" | "cancelled";
  duplicateMode: "ignore" | "rename" | "replace";
  totalFiles: number;
  totalEmojis: number;
  totalSounds: number;
  successCount: number;
  errorCount: number;
  duplicateCount: number;
  logs: string[];
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

export type MongoMediaImportJobItem = {
  _id: string;
  jobId: string;
  type: "emoji" | "sound";
  name: string;
  originalName: string;
  filePath: string;
  format: string;
  mimeType: string;
  size: number;
  animated: boolean | null;
  status: "pending" | "success" | "error" | "duplicate" | "ignored";
  errorMessage: string | null;
  discordEmojiId: string | null;
};

export type MongoMediaSettings = {
  _id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  allowAuthorizedUsers: boolean;
  devOnly: boolean;
  duplicateMode: "ignore" | "rename" | "replace";
  soundsLocalOnly: boolean;
  maxZipSizeMb: number;
  maxFilesPerZip: number;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
};

export type MongoApplicationEmojiItem = {
  _id: string;
  animated: boolean;
  applicationEmojiId: string;
  applicationId: string;
  applicationName: string;
  botId: string;
  hash: string | null;
  originalEmojiId: string;
  originalName: string;
  size: number;
  sourceGuildId: string | null;
  syncedAt: Date;
  updatedAt: Date;
  url: string;
  userId: string | null;
};

export type MongoApplicationEmojiJob = {
  _id: string;
  botId: string;
  guildId: string;
  userId: string;
  status: "running" | "completed" | "failed";
  total: number;
  sent: number;
  skipped: number;
  updated: number;
  removed: number;
  failed: number;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

export type MongoApplicationEmojiSettings = {
  _id: string;
  autoSync: boolean;
  botId: string;
  guildId: string;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoNexTechInviteStatus = "active" | "paused" | "expired" | "cancelled";
export type MongoNexTechInvitePermissionRole = "administrator" | "manager" | "moderator" | "viewer";

export type MongoNexTechInviteUsage = {
  guildId: string;
  guildName: string;
  ipAddress: string | null;
  usedAt: Date;
  usedById: string | null;
  usedByName: string | null;
};

export type MongoNexTechInvite = {
  _id: string;
  adminChannelId?: string | null;
  alertChannelId?: string | null;
  bannerUrl?: string | null;
  blockUnknownInvites?: boolean;
  botId?: string | null;
  buttonEmoji?: string | null;
  buttonLabel?: string | null;
  channelId?: string | null;
  clicks?: number;
  clientName: string;
  code: string;
  conversionCount?: number;
  createdAt: Date;
  createdBy: string | null;
  description?: string | null;
  discordInviteId?: string | null;
  expiresAt: Date | null;
  footerText?: string | null;
  guildId?: string | null;
  guildName?: string | null;
  imageUrl?: string | null;
  inviteUrl?: string | null;
  logChannelId?: string | null;
  maxUses: number | null;
  name: string;
  notes: string | null;
  panelChannelId?: string | null;
  panelColor?: string | null;
  panelMessageId?: string | null;
  panelTitle?: string | null;
  permissions?: Partial<Record<MongoNexTechInvitePermissionRole, string[]>>;
  status: MongoNexTechInviteStatus;
  statsChannelId?: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  usages: MongoNexTechInviteUsage[];
  usedCount: number;
  videoUrl?: string | null;
};

export type MongoNexTechInviteLog = {
  _id: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  createdAt: Date;
  data: Record<string, unknown>;
  guildId: string | null;
  guildName: string | null;
  inviteCode: string | null;
  inviteId: string | null;
};

export type MongoNexTechSalesPaymentProvider = {
  id: string;
  gatewayId: string;
  ownerUserId: string;
  storeId: string;
  accountCountry?: string | null;
  accountEmail?: string | null;
  accountName?: string | null;
  clientId?: string | null;
  clientSecretEncrypted?: string | null;
  connectionStatus?: "untested" | "online" | "offline";
  enabled: boolean;
  environment?: "sandbox" | "production";
  lastConnectionError?: string | null;
  lastTestedAt?: Date | null;
  label: string;
  provider: "manual" | "pix" | "mercadopago" | "pagbank" | "stripe" | "paypal" | "custom";
  publicKey: string | null;
  secretEncrypted: string | null;
  webhookSecretEncrypted?: string | null;
  webhookUrl: string | null;
  instructions: string | null;
  updatedAt: Date;
};

export type MongoNexTechSalesSettings = {
  _id: string;
  botId: string;
  guildId: string;
  storeId: string;
  enabled: boolean;
  ownerUserId: string;
  publicUrl: string;
  currency: "BRL" | "USD" | "EUR";
  saleChannelId: string | null;
  logChannelId: string | null;
  supportRoleIds: string[];
  customerRoleId: string | null;
  panelTitle: string;
  panelDescription: string;
  panelColor: string;
  panelImageUrl: string | null;
  thumbnailUrl: string | null;
  termsUrl: string | null;
  paymentProviders: MongoNexTechSalesPaymentProvider[];
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoSalesTicketSettings = {
  _id: string;
  botId: string;
  guildId: string;
  ownerUserId: string;
  enabled: boolean;
  panelChannelId: string | null;
  panelMessageId: string | null;
  panelTitle: string;
  panelDescription: string;
  panelImageUrl: string | null;
  panelColor: string;
  panelPlaceholder: string;
  closeDeleteDelaySeconds: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoSalesTicketType = {
  _id: string;
  botId: string;
  guildId: string;
  ownerUserId: string;
  active: boolean;
  name: string;
  emoji: string | null;
  description: string;
  categoryId: string | null;
  supportRoleIds: string[];
  initialMessage: string;
  channelNamePattern: string;
  ticketLimit: number | null;
  order: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoSalesTicket = {
  _id: string;
  botId: string;
  guildId: string;
  ownerUserId: string;
  typeId: string;
  typeName: string;
  userId: string;
  userName: string | null;
  channelId: string | null;
  status: "open" | "claimed" | "closed";
  claimedById: string | null;
  claimedByName: string | null;
  closeReason: string | null;
  transcriptId: string | null;
  passwordId: string | null;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
};

export type MongoSalesTicketLog = {
  _id: string;
  botId: string;
  guildId: string;
  ticketId: string | null;
  event: string;
  actorId: string | null;
  actorName: string | null;
  message: string;
  data: Record<string, unknown>;
  createdAt: Date;
};

export type MongoSalesTicketTranscript = {
  _id: string;
  botId: string;
  guildId: string;
  ticketId: string;
  channelId: string | null;
  userId: string;
  messages: Array<Record<string, unknown>>;
  messageCount: number;
  createdAt: Date;
};

export type MongoSalesTicketPassword = {
  _id: string;
  botId: string;
  encryptedPassword?: string | null;
  guildId: string;
  ticketId: string;
  transcriptId: string;
  passwordHash: string;
  salt: string;
  createdAt: Date;
};

export type MongoPriceTableItem = {
  active: boolean;
  billingType: "one_time" | "monthly" | "weekly" | "custom";
  billingText: string | null;
  description: string | null;
  highlight: boolean;
  id: string;
  name: string;
  order: number;
  price: number;
  priceText: string | null;
};

export type MongoPriceTableButtonText = {
  quote: string;
  plans: string;
  support: string;
};

export type MongoPriceTableModalText = {
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

export type MongoPriceTableRequest = {
  _id: string;
  botId: string;
  contact: string;
  createdAt: Date;
  details: string;
  guildId: string;
  itemId: string | null;
  itemName: string;
  tableId: string;
  ticketChannelId: string | null;
  userId: string;
  userName: string;
};

export type MongoPriceTableLog = {
  _id: string;
  action: string;
  actorId: string | null;
  botId: string;
  createdAt: Date;
  data: Record<string, unknown>;
  guildId: string;
  tableId: string | null;
};

export type MongoPriceTable = {
  _id: string;
  botId: string;
  buttonText: MongoPriceTableButtonText;
  color: string;
  createdAt: Date;
  createdBy: string | null;
  currency: "BRL" | "USD" | "EUR" | "CUSTOM";
  currencyFormat: string;
  description: string | null;
  discordChannelId: string | null;
  footerText: string | null;
  guildId: string;
  imagePosition: "top" | "bottom" | "thumbnail" | "none";
  imageUrl: string | null;
  isActive: boolean;
  items: MongoPriceTableItem[];
  logChannelId: string | null;
  messageId: string | null;
  modalText: MongoPriceTableModalText;
  name: string;
  supportCategoryId: string | null;
  supportRoleIds: string[];
  ticketInitialMessage: string;
  panelEmojis: {
    products: string;
    systems: string;
    advantages: string;
    support: string;
  };
  panelSections: {
    includedTitle: string;
    includedItems: string[];
    systemsTitle: string;
    systemsText: string;
    advantagesTitle: string;
    advantages: string[];
    supportTitle: string;
    supportText: string;
  };
  title: string;
  updatedAt: Date;
  updatedBy: string | null;
};

export type MongoManualPaymentService = {
  active: boolean;
  amount: number;
  bannerUrl: string | null;
  createServiceChannel: boolean;
  description: string | null;
  id: string;
  manualApproval: boolean;
  name: string;
  order: number;
  serviceType: string;
  customText: string | null;
};

export type MongoManualPaymentSettings = {
  _id: string;
  allowedReceiptImageFormats: string[];
  allowReceiptPdf: boolean;
  approveRoleIds: string[];
  attendanceCategoryId: string | null;
  autoReceiptDetectionEnabled: boolean;
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
  approvalMessage: string;
  customerReceiptMessage: string;
  paymentInstructions: string;
  pixCopyPasteCode: string | null;
  pixKey: string | null;
  pixKeyType: "cpf" | "cnpj" | "phone" | "email" | "random";
  pixQrCodeUrl: string | null;
  receiverBank: string | null;
  receiverName: string | null;
  receiptChannelId: string | null;
  rejectRoleIds: string[];
  rejectionMessage: string;
  salePanelChannelId: string | null;
  salePanelDescription: string;
  salePanelMessageId: string | null;
  salePanelTitle: string;
  services: MongoManualPaymentService[];
  supportPanelChannelId: string | null;
  updatedAt: Date;
  updatedBy: string | null;
};

export type MongoManualPaymentOrderStatus =
  | "PENDING_PAYMENT"
  | "WAITING_STAFF_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "IN_PROGRESS"
  | "WAITING_CUSTOMER"
  | "DELIVERED"
  | "FINISHED"
  | "CANCELLED_BY_CUSTOMER"
  | "CANCELLED_BY_STAFF";

export type MongoManualPaymentOrder = {
  _id: string;
  amount: number;
  approvedAt: Date | null;
  approvedBy: string | null;
  botId: string;
  createdAt: Date;
  finalizedAt: Date | null;
  finalizedBy: string | null;
  guildId: string;
  orderNumber: number;
  paidAt: Date | null;
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
  status: MongoManualPaymentOrderStatus;
  updatedAt: Date;
  userId: string;
  username: string | null;
};

export type MongoManualPaymentReceiptAttachment = {
  contentType: string | null;
  extension: string;
  name: string;
  proxyUrl: string | null;
  size: number;
  url: string;
};

export type MongoManualPaymentReceipt = {
  _id: string;
  attachments: MongoManualPaymentReceiptAttachment[];
  botId: string;
  channelId: string;
  customerId: string;
  customerUsername: string | null;
  guildId: string;
  messageId: string;
  orderId: string;
  paymentId: string;
  status: "under_review";
  submittedAt: Date;
};

export type MongoManualPaymentOrderLog = {
  _id: string;
  action: string;
  amount: number;
  botId: string;
  channelId: string | null;
  createdAt: Date;
  guildId: string;
  newStatus: MongoManualPaymentOrderStatus;
  oldStatus: MongoManualPaymentOrderStatus | null;
  orderId: string;
  proofUrl: string | null;
  reason: string | null;
  serviceName: string;
  staffId: string | null;
  userId: string;
};

export type MongoZtkWebhookEventType = "recruitment" | "domination" | "player_connected" | "player_disconnected" | "unknown";

export type MongoZtkWebhookClan = {
  _id: string;
  active: boolean;
  botId: string;
  clanName: string;
  createdAt: Date;
  discordWebhookChannelId?: string | null;
  discordWebhookId?: string | null;
  discordWebhookUrl?: string | null;
  guildId: string;
  lastEventAt: Date | null;
  onlineChannelId?: string | null;
  onlineRankingMessageId?: string | null;
  ownerUserId: string;
  participationRankingMessageId?: string | null;
  rankingChannelId: string | null;
  rankingMessageId?: string | null;
  recruitmentChannelId: string | null;
  recruitmentRankingMessageId?: string | null;
  dominationChannelId: string | null;
  rewardChannelId: string | null;
  settingsChannelId: string | null;
  updatedAt: Date;
  webhookCreatedAt: Date | null;
  webhookEnabled: boolean;
  webhookToken: string | null;
};

export type MongoZtkWebhookLog = {
  _id: string;
  botId: string;
  channelId?: string | null;
  clanId: string;
  clanName: string;
  createdAt: Date;
  dedupeKey: string;
  eventTimestamp: Date;
  eventType: MongoZtkWebhookEventType;
  guildId: string;
  hash: string;
  initialRole?: string | null;
  playerId: string | null;
  playerName: string | null;
  messageId?: string | null;
  normalizedGangName?: string | null;
  normalizedZoneName?: string | null;
  participantCount?: number | null;
  participants?: Array<{
    id: string | null;
    name: string;
    normalizedName: string;
  }>;
  processingStatus?: "processed" | "unknown";
  rawPayload: unknown;
  rawText: string;
  recruiterName: string | null;
  recruiterId: string | null;
  rivalGangs?: Array<{
    name: string;
    normalizedName: string;
    players: number;
  }>;
  location: string | null;
  onlineSeconds: number;
  totalPlayersInZone?: number | null;
  webhookId?: string | null;
};

export type MongoZtkWebhookPlayerStat = {
  _id: string;
  activeSessionStartedAt: Date | null;
  botId: string;
  clanId: string;
  clanName: string;
  dominations: number;
  guildId: string;
  lastSeenAt: Date | null;
  onlineSeconds: number;
  playerId: string | null;
  playerName: string;
  recruitments: number;
  updatedAt: Date;
};

export type MongoZtkRecruiterRanking = {
  _id: string;
  avatar: string | null;
  botId: string;
  cargo: string | null;
  clan_id: string;
  created_at: Date;
  discord_id: string | null;
  guildId: string;
  nome: string;
  normalized_nome: string;
  total_recrutamentos: number;
  ultima_data: string | null;
  ultima_hora: string | null;
  ultimo_recrutado: string | null;
  updated_at: Date;
};

export type MongoZtkWebhookReward = {
  _id: string;
  active: boolean;
  botId: string;
  clanId: string;
  createdAt: Date;
  guildId: string;
  name: string;
  rankingType: "domination" | "recruitment" | "online";
  rewardDate: Date | null;
  updatedAt: Date;
  winners: Array<{
    place: number;
    value: string;
  }>;
};

export type MongoNexTechSalesPlan = {
  _id: string;
  botId: string;
  guildId: string;
  ownerUserId: string;
  storeId: string;
  name: string;
  description: string | null;
  priceCents: number;
  durationDays: number | null;
  enabled: boolean;
  discordRoleId: string | null;
  moduleIds: string[];
  imageUrl: string | null;
  checkoutMessage: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoNexTechProductFeatureKey =
  | "hosting"
  | "updates"
  | "support"
  | "automaticContract"
  | "automaticPix"
  | "releaseCode"
  | "coupons"
  | "automaticRenewal"
  | "passwordCreation"
  | "automaticLogin"
  | "activationKey";

export type MongoNexTechProductPlanConfig = {
  benefits: string[];
  buttonColor: string;
  buttonText: string;
  description: string;
  discordRoleId: string | null;
  enabled: boolean;
  freeHostingDays?: number | null;
  hostingPriceCents?: number | null;
  name: string;
  paymentProviderId: string | null;
  priceCents: number;
  priceText: string;
};

export type MongoNexTechProduct = {
  _id: string;
  active: boolean;
  bannerExtension?: string | null;
  bannerIsAnimated?: boolean;
  bannerMimeType?: string | null;
  bannerSizeBytes?: number | null;
  bannerUploadedAt?: Date | null;
  additionalInfo: string;
  bannerUrl: string | null;
  botId: string;
  category: string;
  createdAt: Date;
  createdBy: string | null;
  fullDescription: string;
  guildId: string;
  howItWorks: string;
  layout: {
    accentColor: string;
    glassEffect: boolean;
    theme: "dark" | "purple";
  };
  name: string;
  observations: string;
  ownerUserId: string;
  plans: {
    lifetime: MongoNexTechProductPlanConfig;
    monthly: MongoNexTechProductPlanConfig;
  };
  seo: {
    description: string | null;
    title: string | null;
  };
  shortDescription: string;
  slug: string;
  storeId: string;
  toggles: Record<MongoNexTechProductFeatureKey, boolean>;
  updatedAt: Date;
  updatedBy: string | null;
  warnings: string;
};

export type MongoNexTechSaleStatus = "pending" | "paid" | "cancelled" | "refunded";
export type MongoNexTechSalePlanType = "monthly" | "lifetime" | "hosting" | "manual";
export type MongoNexTechSaleDeliveryStatus = "pending" | "delivered" | "partial" | "failed";

export type MongoNexTechSale = {
  _id: string;
  botId: string;
  guildId: string;
  ownerUserId: string;
  storeId: string;
  planId: string | null;
  planName: string;
  customerId: string;
  buyerId: string;
  buyerName: string | null;
  amountCents: number;
  currency: "BRL" | "USD" | "EUR";
  paymentGatewayId: string | null;
  paymentProviderId: string | null;
  paymentProviderLabel: string | null;
  checkoutUrl?: string | null;
  successUrl?: string | null;
  productId?: string | null;
  productName?: string | null;
  productSlug?: string | null;
  productPlanType?: MongoNexTechSalePlanType;
  purchasedRoleId?: string | null;
  externalReference: string | null;
  status: MongoNexTechSaleStatus;
  deliveryStatus?: MongoNexTechSaleDeliveryStatus | null;
  deliveryAttemptedAt?: Date | null;
  deliveredAt?: Date | null;
  deliveredRoleIds?: string[];
  deliveryMessageId?: string | null;
  deliveryError?: string | null;
  notes: string | null;
  paidAt: Date | null;
  expiresAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoNexTechCustomer = {
  _id: string;
  botId: string;
  guildId: string;
  ownerUserId: string;
  storeId: string;
  discordId: string | null;
  name: string | null;
  email: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoNexTechSubscription = {
  _id: string;
  botId: string;
  guildId: string;
  ownerUserId: string;
  storeId: string;
  customerId: string;
  planId: string;
  saleId: string;
  status: "active" | "cancelled" | "expired";
  startsAt: Date;
  expiresAt: Date | null;
  hostingFreeUntil?: Date | null;
  hostingPriceCents?: number | null;
  hostingStatus?: "active" | "pending_payment" | "suspended" | "not_required";
  lastHostingChargeAt?: Date | null;
  licenseExpiresAt?: Date | null;
  licenseStatus?: "active" | "cancelled";
  licenseType?: "monthly" | "lifetime" | "manual";
  nextHostingDueAt?: Date | null;
  productId?: string | null;
  productName?: string | null;
  productPlanType?: MongoNexTechSalePlanType;
  productSlug?: string | null;
  supportLevel?: "standard" | "priority";
  updatesIncluded?: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoNexTechWebhookLog = {
  _id: string;
  botId: string;
  guildId: string;
  ownerUserId: string;
  storeId: string;
  paymentGatewayId: string;
  eventId: string | null;
  eventType: string;
  signatureValid: boolean;
  processed: boolean;
  saleId: string | null;
  createdAt: Date;
};

export type MongoSubscriptionPresenceButton = {
  enabled: boolean;
  emoji: string | null;
  label: string;
  order: number;
  style: "primary" | "secondary" | "success" | "danger" | "link";
  type: "store" | "docs" | "support" | "website" | "custom";
  url: string | null;
};

export type MongoSubscriptionPresencePhotoMode = "avatar" | "company" | "product";

export type MongoSubscriptionPresenceSettings = {
  _id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  channelId: string | null;
  messageEnabled: boolean;
  pingBuyer: boolean;
  pingRoles: boolean;
  title: string;
  messageTemplate: string;
  footerText: string | null;
  companyName: string;
  companyAvatarUrl: string | null;
  companyWebsiteUrl: string | null;
  companyDocsUrl: string | null;
  companySupportUrl: string | null;
  storeUrl: string | null;
  photoMode: MongoSubscriptionPresencePhotoMode;
  panelColor: string;
  buttons: MongoSubscriptionPresenceButton[];
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
};

export type MongoSubscriptionPresencePlan = {
  color: string | null;
  emoji: string | null;
  enabled: boolean;
  id: string;
  name: string;
  order: number;
  roleId: string | null;
};

export type MongoSubscriptionPresenceProduct = {
  _id: string;
  botId: string;
  guildId: string;
  active: boolean;
  category: string;
  color: string;
  emoji: string | null;
  iconUrl: string | null;
  matchNames: string[];
  name: string;
  order: number;
  plans: MongoSubscriptionPresencePlan[];
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
};

export type MongoSubscriptionPresenceLog = {
  _id: string;
  amountCents: number;
  botId: string;
  buyerId: string;
  buyerName: string | null;
  channelId: string | null;
  currency: "BRL" | "USD" | "EUR";
  error: string | null;
  gateway: string | null;
  guildId: string;
  messageId: string | null;
  planName: string;
  productName: string;
  saleId: string;
  status: "pending" | "sent" | "skipped" | "failed";
  createdAt: Date;
};

export type MongoMissionToolsFeatureId =
  | "mission"
  | "clear"
  | "voice"
  | "rich-presence"
  | "username-checker";

export type MongoMissionToolsStatus =
  | "active"
  | "inactive"
  | "deactivated"
  | "waiting"
  | "running"
  | "completed"
  | "error";

export type MongoMissionToolsVoiceStatus =
  | "connected"
  | "disconnected"
  | "reconnecting";

export type MongoMissionToolsClearMode = "bulk" | "userDm";

export type MongoMissionToolsRichPresenceStatus = "active" | "inactive";

export type MongoMissionToolsRichPresenceActivityType = 0 | 1 | 2 | 3 | 5;
export type MongoMissionToolsTokenStatus = "connected" | "invalid" | "expired" | "disconnected" | "fake";

export type MongoMissionToolsRichPresenceConfig = {
  applicationId?: string;
  activityType?: MongoMissionToolsRichPresenceActivityType;
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

export type MongoMissionToolsUsernameCheckerStats = {
  hits: number;
  taken: number;
  errors: number;
  activeProxies: number;
  deadProxies: number;
  bannedProxies: number;
  workersRunning: number;
};

export type MongoMissionToolsUsernameCheckerOptions = {
  usernameLength?: number;
  concurrency?: number;
  requestDelay?: number;
};

export type MongoMissionToolsSettings = {
  _id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  panelChannelId: string | null;
  panelMessageId: string | null;
  logChannelId: string | null;
  managerRoleIds: string[];
  allowedRoleIds: string[];
  enabledFeatures: MongoMissionToolsFeatureId[];
  lastPanelRequestedAt?: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoMissionToolsUserPanel = {
  _id: string;
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
  clearStatus: MongoMissionToolsStatus;
  clearMode: MongoMissionToolsClearMode;
  clearTargetUserId: string | null;
  missionStatus: MongoMissionToolsStatus;
  voiceStatus: MongoMissionToolsVoiceStatus;
  richPresenceStatus: MongoMissionToolsRichPresenceStatus;
  usernameCheckerStatus: MongoMissionToolsStatus;
  currentMission: string | null;
  missionDetail: string | null;
  voiceGuildId: string | null;
  voiceGuildName: string | null;
  voiceChannelId: string | null;
  voiceChannelName: string | null;
  voiceConnectedAt: string | null;
  richPresenceConfig: MongoMissionToolsRichPresenceConfig;
  richPresenceUpdatedAt: string | null;
  usernameCheckerOptions: MongoMissionToolsUsernameCheckerOptions;
  usernameCheckerStats: MongoMissionToolsUsernameCheckerStats;
  usernameCheckerLastEvent: string | null;
  usernameCheckerUpdatedAt: string | null;
  completedCount: number;
  totalMissions: number;
  progress: number;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoMissionToolsToken = {
  _id: string;
  botId: string;
  guildId: string;
  userId: string;
  tokenEncrypted: string;
  tokenHash?: string | null;
  tokenLast4: string | null;
  tokenStatus?: MongoMissionToolsTokenStatus;
  tokenUserId?: string | null;
  tokenUsername?: string | null;
  invalidReason?: string | null;
  lastValidatedAt?: Date | null;
  lastAuthFailureAt?: Date | null;
  authFailureCount?: number;
  statusUpdatedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoSelfBotProtectionModuleId =
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

export type MongoSelfBotPunishmentAction =
  | "delete_message"
  | "warn"
  | "log"
  | "timeout"
  | "remove_role"
  | "add_role"
  | "kick"
  | "ban";

export type MongoPunishmentDuration = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

export type MongoSelfBotPunishmentStep = {
  id: string;
  action: MongoSelfBotPunishmentAction;
  enabled: boolean;
  limit: number;
  nextAction: MongoSelfBotPunishmentAction | null;
  deleteMessage?: boolean;
  sendWarning?: boolean;
  registerLog?: boolean;
  timeoutDuration?: MongoPunishmentDuration;
  addRoleId?: string | null;
  removeRoleId?: string | null;
  banDeleteMessageSeconds?: number;
};

export type MongoSelfBotProtectionSettings = {
  _id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  moduleToggles: Partial<Record<MongoSelfBotProtectionModuleId, boolean>>;
  ignoredChannelIds: string[];
  ignoredUserIds?: string[];
  ignoredRoleIds?: string[];
  ignoredBotIds?: string[];
  ignoredCategoryIds?: string[];
  protectedChannelIds: string[];
  mediaChannelIds: string[];
  linkChannelIds: string[];
  allowedDomains?: string[];
  allowedInviteGuildIds?: string[];
  blockedFileExtensions?: string[];
  blockImages?: boolean;
  blockGifs?: boolean;
  blockVideos?: boolean;
  blockAudio?: boolean;
  logChannelId: string | null;
  punishmentLogChannelId?: string | null;
  logWebhookUrl: string | null;
  embedColor: string;
  punishmentSequence: MongoSelfBotPunishmentAction[];
  punishmentSteps?: MongoSelfBotPunishmentStep[];
  addRoleId: string | null;
  removeRoleId: string | null;
  timeoutSeconds: number;
  floodLimit: number;
  floodWindowSeconds: number;
  imageLimit: number;
  imageWindowSeconds: number;
  mentionLimit: number;
  emojiLimit: number;
  stickerLimit?: number;
  stickerWindowSeconds?: number;
  nicknameChangeLimit?: number;
  nicknameWindowSeconds?: number;
  antiBotAction?: "allow" | "kick" | "ban" | "manual";
  raidLockdownEnabled?: boolean;
  dmWarningEnabled?: boolean;
  dmWarningMessage?: string;
  moduleLogChannelIds?: Partial<Record<MongoSelfBotProtectionModuleId, string>>;
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
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoSelfBotPunishmentState = {
  _id: string;
  botId: string;
  guildId: string;
  userId: string;
  moduleId: MongoSelfBotProtectionModuleId;
  currentAction: MongoSelfBotPunishmentAction;
  currentStepId?: string | null;
  currentStepIndex?: number | null;
  actionCount: number;
  totalOccurrences: number;
  lastPunishmentActions: MongoSelfBotPunishmentAction[];
  lastInfractionAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoSelfBotProtectionIncident = {
  _id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string | null;
  channelId: string | null;
  messageId: string | null;
  messageContent: string | null;
  moduleId: MongoSelfBotProtectionModuleId;
  infractionType: string;
  punishmentActions: MongoSelfBotPunishmentAction[];
  punishmentSucceeded: boolean;
  punishmentError: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type MongoSelfBotRoleAssignment = {
  _id: string;
  active: boolean;
  botId: string;
  guildId: string;
  lastIncidentId: string;
  lastPunishedAt: Date;
  roleId: string | null;
  userId: string;
  username: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoSafeBotWarningAction =
  | "record_only"
  | "dm"
  | "channel_message"
  | "add_role"
  | "remove_role"
  | "timeout"
  | "kick"
  | "ban"
  | "notify_staff"
  | "open_ticket"
  | "block_channels"
  | "custom";

export type MongoSafeBotWarningLevel = {
  id: string;
  number: number;
  name: string;
  description: string;
  defaultReason: string;
  action: MongoSafeBotWarningAction | null;
  actions?: MongoSafeBotWarningAction[];
  durationSeconds: number | null;
  roleId: string | null;
  channelId: string | null;
  targetChannelIds: string[];
  logChannelId: string | null;
  userMessage: string;
  staffMessage: string;
  customAction: string;
  enabled: boolean;
};

export type MongoSafeBotWarningSettings = {
  _id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  authorizedRoleIds: string[];
  defaultLogChannelId: string | null;
  overflowMode: "repeat_last" | "record_only" | "block" | "final_action";
  finalLevel: MongoSafeBotWarningLevel | null;
  levels: MongoSafeBotWarningLevel[];
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoSafeBotWarningUser = {
  _id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string | null;
  totalWarnings: number;
  totalInfractions?: number;
  firstInfractionAt?: Date | null;
  lastInfractionAt?: Date | null;
  lastRuleId?: string | null;
  lastPunishment?: string | null;
  recentEventKeys?: string[];
  internalNote: string;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoSafeBotWarningRecord = {
  _id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string | null;
  staffId: string;
  staffName: string | null;
  reason: string;
  idempotencyKey?: string | null;
  channelId?: string | null;
  ruleId?: string | null;
  ruleName?: string | null;
  infractionNumber?: number;
  warningNumber: number;
  level: MongoSafeBotWarningLevel | null;
  configuredAction: MongoSafeBotWarningAction | null;
  executedAction: string | null;
  status: "pending" | "recorded" | "success" | "failed" | "removed";
  error: string | null;
  removedBy: string | null;
  removedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoTemporaryCall = {
  _id: string;
  botId: string;
  guildId: string;
  ownerId: string;
  channelId: string;
  channelName: string;
  userLimit: number;
  isPrivate: boolean;
  allowedUsers: string[];
  bannedUsers: string[];
  createdAt: Date;
  updatedAt: Date;
  emptySince: Date | null;
};

export type MongoAutomatedLogSettings = {
  _id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  categoryId: string | null;
  channels: {
    site: string | null;
    absence: string | null;
    messages: string | null;
    calls: string | null;
    verification: string | null;
    punishment: string | null;
  };
  enabledChannels?: {
    site: boolean;
    absence: boolean;
    messages: boolean;
    calls: boolean;
    verification: boolean;
    punishment: boolean;
  };
  allowedRoleIds: string[];
  lastError: string | null;
  lastSyncedAt: Date | null;
  lastSyncRequestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoSecurityFeatureAccess = {
  _id: string;
  botId: string;
  featureKey: "security_protection";
  enabledByDev: boolean;
  enabledBy: string | null;
  enabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoDevBotStatus =
  | "online"
  | "offline"
  | "starting"
  | "authenticating"
  | "syncing_config"
  | "ready"
  | "degraded"
  | "stopping"
  | "invalid_token"
  | "error";

export type MongoDevBot = {
  _id: string;
  name: string;
  slug?: string | null;
  clientId: string;
  databaseName?: string | null;
  tokenEncrypted: string;
  tokenPrefix?: string | null;
  tokenLast4?: string | null;
  secretEncrypted: string | null;
  avatarUrl: string | null;
  botCreatedAt?: Date | null;
  ownerId: string;
  ownerName: string;
  mainGuildId: string;
  mainGuildName?: string;
  mainGuildIconUrl?: string | null;
  mainGuildMemberCount?: number;
  mainGuildChannelCount?: number;
  status: MongoDevBotStatus;
  statusMessage?: string | null;
  enabledModules: string[];
  desiredOnline?: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoBotGuildModuleConfig = {
  enabled?: boolean;
  channelId?: string | null;
  message?: string | null;
  interval?: number | null;
  roleId?: string | null;
  [key: string]: unknown;
};

export type MongoBotGuildConfig = {
  _id: string;
  botId: string;
  guildId: string;
  guildName: string;
  modules: Record<string, MongoBotGuildModuleConfig>;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoAntiBanAction = "log_only" | "remove_admin_roles" | "kick_executor" | "ban_executor" | "remove_dangerous_permissions" | "block_future_actions";
export type MongoAntiBanRecovery = "alert_only" | "unban" | "restore_permissions";

export type MongoAntiBanConfig = {
  _id: string;
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
  actionOnTrigger: MongoAntiBanAction;
  autoRecovery: MongoAntiBanRecovery;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoAntiBanLog = {
  _id: string;
  botId: string;
  guildId: string;
  executorId: string | null;
  targetId: string | null;
  actionType: string;
  amount: number;
  limit: number;
  punishment: string;
  success: boolean;
  errorMessage: string | null;
  metadata?: unknown;
  createdAt: Date;
};

export type MongoDevPermission = {
  _id: string;
  userId: string;
  role: "owner" | "dev" | "admin";
  canCreateBot: boolean;
  canEditBot: boolean;
  canDeleteBot: boolean;
  canManageModules: boolean;
  createdAt: Date;
};

export type MongoMaintenanceState = {
  _id: "global";
  active: boolean;
  activatedAt: Date | null;
  deactivatedAt: Date | null;
  updatedAt: Date;
  updatedById: string | null;
  updatedByName: string | null;
};

export type MongoMaintenanceLog = {
  _id: string;
  action: "enabled" | "disabled" | "manual_alert";
  active: boolean;
  actorId: string | null;
  actorName: string | null;
  createdAt: Date;
  message: string;
};

export type MongoSystemEmoji = {
  _id: string;
  key: string;
  botId: string | null;
  guildId?: string | null;
  name: string;
  emojiId: string | null;
  animated: boolean;
  sourceGuildId: string | null;
  enabled: boolean;
  fallback: string;
  extraEmojiNames?: string[];
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastFoundAt?: Date | null;
  lastMissingAt?: Date | null;
  lastValidatedAt?: Date | null;
  lastValidationBotId?: string | null;
};

export type MongoDashboardAuditLog = {
  _id: string;
  action: string;
  userId: string | null;
  botId?: string | null;
  guildId?: string | null;
  dashboardSlug?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: Date;
};

export type MongoPlanBillingCycle = "monthly" | "quarterly" | "semiannual" | "annual" | "lifetime" | "custom";
export type MongoPaymentProvider = "disabled" | "mercadopago" | "pagbank" | "asaas" | "efi" | "custom";
export type MongoPlanSubscriptionStatus = "pending" | "active" | "suspended" | "cancelled" | "expired";
export type MongoPlanWorkspaceStatus = "active" | "suspended" | "cancelled";
export type MongoPlanPaymentOrderStatus =
  | "interest_registered"
  | "created"
  | "checkout_pending"
  | "pending"
  | "processing"
  | "in_process"
  | "approved"
  | "paid"
  | "cancelled"
  | "expired"
  | "rejected"
  | "failed"
  | "refunded"
  | "chargeback"
  | "charged_back"
  | "in_review"
  | "error";
export type MongoBotCredentialStatus = "stored" | "validated" | "invalid" | "disabled";

export type MongoPlanEntitlement = {
  enabled: boolean;
  key: string;
  limit: number | null;
  metadata?: Record<string, unknown>;
  unit: string | null;
};

export type MongoPlanFeature = {
  _id: string;
  category: "streamer" | "fivem" | "discord" | "security" | "support" | "billing";
  createdAt: Date;
  defaultLimit: number | null;
  description: string;
  isActive: boolean;
  isPublic: boolean;
  key: string;
  name: string;
  order: number;
  unit: string | null;
  updatedAt: Date;
};

export type MongoPlan = {
  _id: string;
  badge: string | null;
  billingCycle: MongoPlanBillingCycle;
  botLimit: number;
  buttonText: string;
  color: string;
  createdAt: Date;
  createdBy: string | null;
  currency: "BRL" | "USD" | "EUR";
  description: string;
  entitlements: MongoPlanEntitlement[];
  guildLimit: number;
  icon: string | null;
  imageUrl: string | null;
  isActive: boolean;
  isPublic: boolean;
  isPurchasable: boolean;
  isRecommended: boolean;
  name: string;
  order: number;
  priceInCents: number;
  promotionalPriceInCents: number | null;
  shortDescription: string;
  slug: string;
  updatedAt: Date;
  updatedBy: string | null;
  validityDays: number | null;
};

export type MongoPlanSubscription = {
  _id: string;
  activatedAt: Date | null;
  activatedBy: string | null;
  botLimit: number;
  cancelledAt: Date | null;
  createdAt: Date;
  discordId: string;
  endsAt: Date | null;
  guildLimit: number;
  metadata?: Record<string, unknown>;
  planId: string;
  planSlug: string;
  startedAt: Date | null;
  status: MongoPlanSubscriptionStatus;
  suspendedAt: Date | null;
  updatedAt: Date;
  userId: string;
  workspaceId: string | null;
};

export type MongoPlanWorkspace = {
  _id: string;
  botIds: string[];
  createdAt: Date;
  guildIds: string[];
  name: string;
  ownerDiscordId: string;
  ownerUserId: string;
  planId: string;
  slug: string;
  status: MongoPlanWorkspaceStatus;
  subscriptionId: string;
  updatedAt: Date;
};

export type MongoWorkspaceMember = {
  _id: string;
  createdAt: Date;
  discordId: string;
  role: "owner" | "admin" | "member";
  updatedAt: Date;
  userId: string;
  workspaceId: string;
};

export type MongoBotCredential = {
  _id: string;
  authTag: string;
  avatarUrl?: string | null;
  botClientId: string;
  botName: string;
  createdAt: Date;
  encryptedDataKey: string;
  guildIconUrl?: string | null;
  guildId?: string | null;
  guildName?: string | null;
  iv: string;
  keyVersion: string;
  lastError: string | null;
  lastValidatedAt: Date | null;
  primaryAdminDiscordId?: string | null;
  slug?: string | null;
  ownerUserId: string;
  status: MongoBotCredentialStatus;
  tokenCiphertext: string;
  tokenFingerprint: string;
  updatedAt: Date;
  workspaceId: string;
};

export type MongoPaymentOrder = {
  _id: string;
  accessActivated?: boolean;
  accessActivatedAt?: Date | null;
  amountInCents: number;
  approvedAt?: Date | null;
  cancelledAt?: Date | null;
  checkoutUrl: string | null;
  createdAt: Date;
  currency: "BRL" | "USD" | "EUR";
  discordId: string;
  environment?: "test" | "production";
  expiresAt?: Date | null;
  externalReference?: string | null;
  idempotencyKey?: string | null;
  merchantOrderId?: string | null;
  mercadoPagoPaymentId?: string | null;
  notes: string | null;
  paidAt: Date | null;
  paymentMethod?: string | null;
  paymentType?: string | null;
  pixCode: string | null;
  planId: string;
  planSnapshot?: Record<string, unknown>;
  planSlug: string;
  provider: MongoPaymentProvider;
  providerOrderId: string | null;
  qrCode: string | null;
  rawProviderStatus?: string | null;
  refundedAt?: Date | null;
  rejectedAt?: Date | null;
  retryAttempts?: number;
  sandboxCheckoutUrl?: string | null;
  statusDetail?: string | null;
  statusHistory?: Array<{ at: Date; from: MongoPlanPaymentOrderStatus | null; source: string; status: MongoPlanPaymentOrderStatus }>;
  webhookSafeResponse?: Record<string, unknown> | null;
  status: MongoPlanPaymentOrderStatus;
  updatedAt: Date;
  userId: string;
};

export type MongoPaymentEvent = {
  _id: string;
  attempts?: number;
  createdAt: Date;
  environment?: "test" | "production";
  eventId: string | null;
  eventType: string;
  lastError?: string | null;
  orderId: string | null;
  payloadHash: string;
  processedAt: Date | null;
  provider: MongoPaymentProvider;
  requestId?: string | null;
  paymentId?: string | null;
  result?: string | null;
  signatureValid?: boolean;
  status: "received" | "processing" | "ignored" | "processed" | "failed";
};

export type MongoPaymentSettings = {
  _id: "global";
  approvedRedirectUrl?: string | null;
  botDashboardBaseUrl?: string | null;
  botRegistrationUrl?: string | null;
  cancelRedirectUrl?: string | null;
  enabled: boolean;
  failureRedirectUrl?: string | null;
  pendingRedirectUrl?: string | null;
  plansPublicUrl?: string | null;
  provider: MongoPaymentProvider;
  publicKey: string | null;
  secretEncrypted: string | null;
  successRedirectUrl?: string | null;
  supportDiscordUrl?: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  webhookSecretEncrypted: string | null;
};

export type MongoPlanAuditLog = {
  _id: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  createdAt: Date;
  ip: string | null;
  metadata?: Record<string, unknown>;
  targetId: string | null;
  targetType: "plan" | "feature" | "subscription" | "workspace" | "bot_credential" | "payment" | "settings";
  userAgent: string | null;
};

export type MongoGlobalPanelImagePosition = "banner" | "thumbnail" | "top" | "below_title" | "middle" | "bottom" | "side" | "footer" | "before_buttons" | "below_text" | "above_buttons" | "none";
export type MongoGlobalPanelImageSize = "small" | "medium" | "large" | "full_banner" | "custom";
export type MongoGlobalPanelImageLayoutMode = "embed" | "components_v2";
export type MongoPanelBlock =
  | { editable?: boolean; id: string; order: number; type: "text"; content: string }
  | { divider?: boolean; id: string; order: number; spacing?: "small" | "large" | number; type: "separator" }
  | { id: string; items: Array<{ description?: string | null; spoiler?: boolean; url: string }>; order: number; type: "media_gallery" }
  | { accessory?: { kind: "thumbnail"; description?: string | null; url: string } | { kind: "button"; customId?: string; disabled?: boolean; label: string; style?: "primary" | "secondary" | "success" | "danger" | "link"; url?: string } | null; id: string; order: number; texts: string[]; type: "section" }
  | { altText?: string | null; attachmentName?: string | null; imageUrl?: string | null; id: string; order: number; text: string; type: "footer" }
  | { buttons: Array<{ customId?: string; disabled?: boolean; label: string; style?: "primary" | "secondary" | "success" | "danger" | "link"; url?: string }>; id: string; order: number; type: "action_row" };

export type MongoPanelImageSettings = {
  _id: string;
  blocks?: MongoPanelBlock[];
  botId: string;
  guildId: string;
  panelId: string;
  imageEnabled: boolean;
  imageUrl: string;
  imagePosition: MongoGlobalPanelImagePosition;
  imageSize: MongoGlobalPanelImageSize;
  customWidth: number | null;
  customHeight: number | null;
  layoutMode: MongoGlobalPanelImageLayoutMode;
  mediaAutoplay?: boolean;
  mediaControls?: boolean;
  mediaFit?: "cover" | "contain";
  mediaLoop?: boolean;
  mediaMuted?: boolean;
  mediaPosterUrl?: string | null;
  mediaPreload?: "none" | "metadata" | "auto";
  mediaThumbnailUrl?: string | null;
  mediaVolume?: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  useGlobalDefault?: boolean;
};

export type MongoPersistentImage = {
  _id: string;
  animated?: boolean;
  botId: string | null;
  buffer?: Buffer | null;
  createdAt: Date;
  extension?: string;
  fileName: string;
  fileId?: string | null;
  guildId: string;
  imageType: string;
  metadata?: Record<string, unknown>;
  mimeType: string;
  moduleId: string;
  originalName: string | null;
  originalMimeType?: string | null;
  originalSize?: number | null;
  posterBuffer?: Buffer | null;
  posterFileId?: string | null;
  posterMimeType?: string | null;
  processingError?: string | null;
  processingStatus?: "stored" | "converted" | "failed";
  publicUrl: string;
  size: number;
  storageProvider: "mongodb" | "gridfs";
  uploadedAt: Date;
  uploadedBy: string | null;
};

const globalForMongo = globalThis as unknown as {
  mongoClient?: MongoClient;
  mongoIndexes?: Promise<void>;
};

function databaseNameFromUri(uri: string) {
  const configuredName = process.env.MONGODB_DATABASE_NAME || process.env.MONGODB_DB_NAME;
  const defaultName = "NexTech";
  const legacyNames: Record<string, string> = {
    ricardinho98: defaultName
  };

  const rawName = configuredName || uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/i)?.[1] || "";
  const dbName = decodeURIComponent(rawName.replace(/^\/+/, "").split("/")[0] ?? "");

  return legacyNames[dbName] || dbName || defaultName;
}

export function botDatabaseName(botId: string) {
  const prefix = (process.env.BOT_DATABASE_PREFIX || "NexTech_bot").trim() || "NexTech_bot";
  const normalizedBotId = botId.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");

  if (!normalizedBotId) {
    throw new Error("botId inválido para banco de dados do bot.");
  }

  return `${prefix}_${normalizedBotId}`.slice(0, 63);
}

function getMongoClient() {
  if (!env.MONGODB_URI) {
    throw new Error("MONGODB_URI não configurada.");
  }

  if (!globalForMongo.mongoClient) {
    globalForMongo.mongoClient = new MongoClient(env.MONGODB_URI);
  }

  return globalForMongo.mongoClient;
}

export async function getMongoDb() {
  const client = getMongoClient();
  await client.connect();
  return client.db(databaseNameFromUri(env.MONGODB_URI));
}

export async function getBotMongoDb(botId: string) {
  const client = getMongoClient();
  await client.connect();
  return client.db(botDatabaseName(botId));
}

export async function getBotMongoCollections(botId: string) {
  const db = await getBotMongoDb(botId);

  return {
    db,
    metadata: db.collection("bot_metadata"),
    runtimeState: db.collection("runtime_state"),
    moduleState: db.collection("module_state"),
    logs: db.collection("logs")
  };
}

export async function getMongoCollections() {
  const db = await getMongoDb();
  await ensureMongoIndexes(db);

  return {
    users: db.collection<MongoUser>("User"),
    guilds: db.collection<MongoGuild>("Guild"),
    guildSettings: db.collection<MongoGuildSettings>("GuildSettings"),
    safeBotMessageStates: db.collection<MongoSafeBotMessageState>("safe_bot_message_states"),
    hierarchyForwarding: db.collection<MongoHierarchyForwardingRule>("hierarchy_forwarding"),
    tickets: db.collection<MongoTicket>("Ticket"),
    transcripts: db.collection<MongoTranscript>("transcripts"),
    transcriptPasswords: db.collection<MongoTranscriptPassword>("transcript_passwords"),
    transcriptAccessLogs: db.collection<MongoTranscriptAccessLog>("transcript_access_logs"),
    ticketEvents: db.collection<MongoTicketEvent>("ticket_events"),
    courseSettings: db.collection<MongoCourseSettings>("course_settings"),
    courses: db.collection<MongoCourse>("courses"),
    courseDepartments: db.collection<MongoCourseDepartment>("course_departments"),
    coursePublications: db.collection<MongoCoursePublication>("course_publications"),
    courseEnrollments: db.collection<MongoCourseEnrollment>("course_enrollments"),
    courseScheduleRequests: db.collection<MongoCourseScheduleRequest>("course_schedule_requests"),
    courseReports: db.collection<MongoCourseReport>("course_reports"),
    courseLogs: db.collection<MongoCourseLog>("course_logs"),
    courseExamSettings: db.collection<MongoCourseExamSettings>("course_exam_settings"),
    courseExamQuestions: db.collection<MongoCourseExamQuestion>("course_exam_questions"),
    courseExamAttempts: db.collection<MongoCourseExamAttempt>("course_exam_attempts"),
    courseExamAnswers: db.collection<MongoCourseExamAnswer>("course_exam_answers"),
    courseInstructorSettings: db.collection<MongoCourseInstructorSettings>("course_instructor_settings"),
    courseInstructorEvents: db.collection<MongoCourseInstructorEvent>("course_instructor_events"),
    courseHistorySettings: db.collection<MongoCourseHistorySettings>("course_history_settings"),
    courseStudentHistory: db.collection<MongoCourseStudentHistory>("course_student_history"),
    openDutySettings: db.collection<MongoOpenDutySettings>("open_duty_settings"),
    openDutyCounters: db.collection<MongoOpenDutyWarningCounter>("open_duty_counters"),
    openDutyNotifications: db.collection<MongoOpenDutyNotification>("open_duty_notifications"),
    rhAdminSettings: db.collection<MongoRhAdminSettings>("rh_admin_settings"),
    rhAdminAbsences: db.collection<MongoRhAdminAbsence>("rh_admin_absences"),
    rhAdminAdornments: db.collection<MongoRhAdminAdornment>("rh_admin_adornments"),
    rhAdminLogs: db.collection<MongoRhAdminLog>("rh_admin_logs"),
    manualRegistrationSettings: db.collection<MongoManualRegistrationSettings>("manual_registration_settings"),
    manualRegistrationSubmissions: db.collection<MongoManualRegistrationSubmission>("manual_registration_submissions"),
    manualRegistrationLogs: db.collection<MongoManualRegistrationLog>("manual_registration_logs"),
    fivemGoalSettings: db.collection<MongoFivemGoalSettings>("fivem_goal_settings"),
    fivemGoalUserChannels: db.collection<MongoFivemGoalUserChannel>("fivem_goal_user_channels"),
    fivemGoalEntries: db.collection<MongoFivemGoalEntry>("fivem_goal_entries"),
    fivemGoalConfigs: db.collection<MongoFivemGoalConfig>("fivem_goal_configs"),
    fivemGoalSubmissions: db.collection<MongoFivemGoalSubmission>("fivem_goal_submissions"),
    fivemGoalLogs: db.collection<MongoFivemGoalLog>("fivem_goal_logs"),
    fivemOrderSettings: db.collection<MongoFivemOrderSettings>("fivem_order_settings"),
    fivemOrderFamilies: db.collection<MongoFivemOrderFamily>("fivem_order_families"),
    fivemOrderProducts: db.collection<MongoFivemOrderProduct>("fivem_order_products"),
    fivemOrders: db.collection<MongoFivemOrder>("fivem_orders"),
    fivemOrderLogs: db.collection<MongoFivemOrderLog>("fivem_order_logs"),
    fivemFinanceSettings: db.collection<MongoFivemFinanceSettings>("fivem_finance_settings"),
    fivemFinanceTransactions: db.collection<MongoFivemFinanceTransaction>("fivem_finance_transactions"),
    fivemFinanceLogs: db.collection<MongoFivemFinanceLog>("fivem_finance_logs"),
    fivemHierarchyPanels: db.collection<MongoFivemHierarchyPanel>("fivem_hierarchy_panels"),
    fivemHierarchyLogs: db.collection<MongoFivemHierarchyLog>("fivem_hierarchy_logs"),
    ztkWebhookClans: db.collection<MongoZtkWebhookClan>("ztk_webhook_clans"),
    ztkWebhookLogs: db.collection<MongoZtkWebhookLog>("ztk_webhook_logs"),
    ztkWebhookPlayerStats: db.collection<MongoZtkWebhookPlayerStat>("ztk_webhook_player_stats"),
    ztkRecruiterRankings: db.collection<MongoZtkRecruiterRanking>("ranking_recrutadores"),
    ztkWebhookRewards: db.collection<MongoZtkWebhookReward>("ztk_webhook_rewards"),
    globalBlacklistSettings: db.collection<MongoGlobalBlacklistSafeBotSettings>("global_blacklist_settings"),
    globalBlacklistEntries: db.collection<MongoGlobalBlacklistEntry>("global_blacklist_entries"),
    globalBlacklistHistory: db.collection<MongoGlobalBlacklistHistory>("global_blacklist_history"),
    serverBackupSettings: db.collection<MongoServerBackupSettings>("server_backup_settings"),
    serverBackupSnapshots: db.collection<MongoServerBackupSnapshot>("server_backup_snapshots"),
    serverBackupRestoreJobs: db.collection<MongoServerBackupRestoreJob>("server_backup_restore_jobs"),
    backgroundJobs: db.collection<MongoBackgroundJob>("background_jobs"),
    serviceHeartbeats: db.collection<MongoServiceHeartbeat>("service_heartbeats"),
    logEntries: db.collection<MongoLogEntry>("LogEntry"),
    liveDetectionSettings: db.collection<MongoLiveDetectionSettings>("live_detection_settings"),
    policeTimeClockSettings: db.collection<MongoPoliceTimeClockSettings>("police_time_clock_settings"),
    policeTimeClockSessions: db.collection<MongoPoliceTimeClockSession>("police_time_clock_sessions"),
    policeTimeClockLogs: db.collection<MongoPoliceTimeClockLog>("police_time_clock_logs"),
    autoActivityClockSettings: db.collection<MongoAutoActivityClockSettings>("auto_activity_clock_settings"),
    autoActivityClockCities: db.collection<MongoAutoActivityClockCity>("auto_activity_clock_cities"),
    autoActivityClockSessions: db.collection<MongoAutoActivityClockSession>("auto_activity_clock_sessions"),
    autoActivityClockLogs: db.collection<MongoAutoActivityClockLog>("auto_activity_clock_logs"),
    socialNotifications: db.collection<MongoSocialNotification>("social_notifications"),
    kickApiConfigs: db.collection<MongoKickApiConfig>("kick_api_configs"),
    socialMembers: db.collection<MongoSocialMember>("social_members"),
    socialPanels: db.collection<MongoSocialPanel>("social_panels"),
    xAccounts: db.collection<MongoXAccount>("x_accounts"),
    xPostsSent: db.collection<MongoXPostSent>("x_posts_sent"),
    clipsConfig: db.collection<MongoClipsConfig>("clips_config"),
    clipsSent: db.collection<MongoClipSent>("clips_sent"),
    clipsLogs: db.collection<MongoClipLog>("clips_logs"),
    clipLiveSessions: db.collection<MongoClipLiveSession>("clip_live_sessions"),
    giveaways: db.collection<MongoGiveaway>("giveaways"),
    giveawayPlatformAccounts: db.collection<MongoGiveawayPlatformAccount>("giveaway_platform_accounts"),
    giveawayKickEvents: db.collection<MongoGiveawayKickEvent>("giveaway_kick_events"),
    fivemModules: db.collection<MongoFivemModule>("fivem_modules"),
    fivemActionSettings: db.collection<MongoFivemActionSettings>("fivem_action_settings"),
    fivemActionDefinitions: db.collection<MongoFivemActionDefinition>("fivem_action_definitions"),
    fivemActionSessions: db.collection<MongoFivemActionSession>("fivem_action_sessions"),
    factionChestSettings: db.collection<MongoFactionChestSettings>("faction_chest_settings"),
    factionChestItems: db.collection<MongoFactionChestItem>("faction_chest_items"),
    factionChestLogs: db.collection<MongoFactionChestLog>("faction_chest_logs"),
    dafScaleSettings: db.collection<MongoDafScaleSettings>("daf_scale_settings"),
    dafScaleEntries: db.collection<MongoDafScaleEntry>("daf_scale_entries"),
    dafScaleAudits: db.collection<MongoDafScaleAudit>("daf_scale_audits"),
    policePatrolSettings: db.collection<MongoPolicePatrolSettings>("police_patrol_settings"),
    policePatrolReports: db.collection<MongoPolicePatrolReport>("police_patrol_reports"),
    policePatrolMessages: db.collection<MongoPolicePatrolMessage>("police_patrol_messages"),
    policePatrolAudits: db.collection<MongoPolicePatrolAudit>("police_patrol_audits"),
    policePatrolFiles: db.collection<MongoPolicePatrolFile>("police_patrol_files"),
    vehicleAbandonmentSettings: db.collection<MongoVehicleAbandonmentSettings>("vehicle_abandonment_settings"),
    vehicleAbandonmentRecords: db.collection<MongoVehicleAbandonmentRecord>("vehicle_abandonment_records"),
    vehicleAbandonmentLogs: db.collection<MongoVehicleAbandonmentLog>("vehicle_abandonment_logs"),
    policeQruSettings: db.collection<MongoPoliceQruSettings>("police_qru_settings"),
    policeQruRecords: db.collection<MongoPoliceQruRecord>("police_qru_records"),
    policeQruLogs: db.collection<MongoPoliceQruLog>("police_qru_logs"),
    policePromotionSettings: db.collection<MongoPolicePromotionSettings>("police_promotion_settings"),
    policePromotionRequests: db.collection<MongoPolicePromotionRequest>("police_promotion_requests"),
    policePromotionLogs: db.collection<MongoPolicePromotionLog>("police_promotion_logs"),
    policeHiddenChannelSettings: db.collection<MongoPoliceHiddenChannelSettings>("police_hidden_channel_settings"),
    policeHiddenChannelLogs: db.collection<MongoPoliceHiddenChannelLog>("police_hidden_channel_logs"),
    visibleMessageUsers: db.collection<MongoVisibleMessageUser>("visible_message_users"),
    messageControlUsers: db.collection<MongoMessageControlUser>("message_control_users"),
    messageControlSettings: db.collection<MongoMessageControlSettings>("message_control_settings"),
    dmBarConfigs: db.collection<MongoDmBarConfig>("dm_bar_configs"),
    dmBarLogs: db.collection<MongoDmBarLog>("dm_bar_logs"),
    fivemFacSettings: db.collection<MongoFivemFacSettings>("fivem_fac_settings"),
    fivemFacAbsences: db.collection<MongoFivemFacAbsence>("fivem_fac_absences"),
    imageAntiSpamSettings: db.collection<MongoImageAntiSpamSettings>("image_anti_spam_settings"),
    imageAntiSpamUsers: db.collection<MongoImageAntiSpamUser>("image_anti_spam_users"),
    imageAntiSpamIncidents: db.collection<MongoImageAntiSpamIncident>("image_anti_spam_incidents"),
    voiceRecorderSettings: db.collection<MongoVoiceRecorderSettings>("voice_recorder_settings"),
    voiceRecordings: db.collection<MongoVoiceRecording>("voice_recordings"),
    emojiCloneJobs: db.collection<MongoEmojiCloneJob>("emoji_clone_jobs"),
    emojiCloneItems: db.collection<MongoEmojiCloneItem>("emoji_clone_items"),
    emojiLibrary: db.collection<MongoEmojiLibraryItem>("emoji_library"),
    mediaLibrary: db.collection<MongoMediaLibraryItem>("media_library"),
    mediaImportJobs: db.collection<MongoMediaImportJob>("media_import_jobs"),
    mediaImportJobItems: db.collection<MongoMediaImportJobItem>("media_import_job_items"),
    mediaSettings: db.collection<MongoMediaSettings>("media_settings"),
    applicationEmojiItems: db.collection<MongoApplicationEmojiItem>("application_emojis"),
    applicationEmojiJobs: db.collection<MongoApplicationEmojiJob>("application_emoji_jobs"),
    applicationEmojiSettings: db.collection<MongoApplicationEmojiSettings>("application_emoji_settings"),
    nexTechInvites: db.collection<MongoNexTechInvite>("nextech_invites"),
    nexTechInviteLogs: db.collection<MongoNexTechInviteLog>("nextech_invite_logs"),
    nexTechSalesSettings: db.collection<MongoNexTechSalesSettings>("nexTech_sales_settings"),
    nexTechSalesPlans: db.collection<MongoNexTechSalesPlan>("nexTech_sales_plans"),
    nexTechProducts: db.collection<MongoNexTechProduct>("nexTech_products"),
    nexTechSales: db.collection<MongoNexTechSale>("nexTech_sales"),
    nexTechCustomers: db.collection<MongoNexTechCustomer>("nexTech_customers"),
    nexTechSubscriptions: db.collection<MongoNexTechSubscription>("nexTech_subscriptions"),
    nexTechWebhookLogs: db.collection<MongoNexTechWebhookLog>("nexTech_webhook_logs"),
    subscriptionPresenceSettings: db.collection<MongoSubscriptionPresenceSettings>("subscription_presence_settings"),
    subscriptionPresenceProducts: db.collection<MongoSubscriptionPresenceProduct>("subscription_presence_products"),
    subscriptionPresenceLogs: db.collection<MongoSubscriptionPresenceLog>("subscription_presence_logs"),
    salesTicketSettings: db.collection<MongoSalesTicketSettings>("salesTicketSettings"),
    salesTicketTypes: db.collection<MongoSalesTicketType>("salesTicketTypes"),
    salesTickets: db.collection<MongoSalesTicket>("salesTickets"),
    salesTicketLogs: db.collection<MongoSalesTicketLog>("salesTicketLogs"),
    salesTicketTranscripts: db.collection<MongoSalesTicketTranscript>("salesTicketTranscripts"),
    salesTicketPasswords: db.collection<MongoSalesTicketPassword>("salesTicketPasswords"),
    priceTables: db.collection<MongoPriceTable>("price_tables"),
    priceTableRequests: db.collection<MongoPriceTableRequest>("price_table_requests"),
    priceTableLogs: db.collection<MongoPriceTableLog>("price_table_logs"),
    manualPaymentSettings: db.collection<MongoManualPaymentSettings>("manual_payment_settings"),
    manualPaymentOrders: db.collection<MongoManualPaymentOrder>("manual_payment_orders"),
    manualPaymentReceipts: db.collection<MongoManualPaymentReceipt>("manual_payment_receipts"),
    manualPaymentOrderLogs: db.collection<MongoManualPaymentOrderLog>("manual_payment_order_logs"),
    missionToolsSettings: db.collection<MongoMissionToolsSettings>("mission_tools_settings"),
    missionToolsUsers: db.collection<MongoMissionToolsUserPanel>("mission_tools_users"),
    missionToolsTokens: db.collection<MongoMissionToolsToken>("mission_tools_tokens"),
    selfBotProtectionSettings: db.collection<MongoSelfBotProtectionSettings>("self_bot_protection_settings"),
    selfBotPunishmentStates: db.collection<MongoSelfBotPunishmentState>("self_bot_punishment_states"),
    selfBotProtectionIncidents: db.collection<MongoSelfBotProtectionIncident>("self_bot_protection_incidents"),
    selfBotRoleAssignments: db.collection<MongoSelfBotRoleAssignment>("self_bot_role_assignments"),
    safeBotWarningSettings: db.collection<MongoSafeBotWarningSettings>("safe_bot_warning_settings"),
    safeBotWarningUsers: db.collection<MongoSafeBotWarningUser>("safe_bot_warning_users"),
    safeBotWarningRecords: db.collection<MongoSafeBotWarningRecord>("safe_bot_warning_records"),
    temporaryCalls: db.collection<MongoTemporaryCall>("temporary_calls"),
    automatedLogSettings: db.collection<MongoAutomatedLogSettings>("automated_log_settings"),
    securityFeatureAccess: db.collection<MongoSecurityFeatureAccess>("security_feature_access"),
    plans: db.collection<MongoPlan>("plans"),
    planFeatures: db.collection<MongoPlanFeature>("plan_features"),
    planSubscriptions: db.collection<MongoPlanSubscription>("plan_subscriptions"),
    planWorkspaces: db.collection<MongoPlanWorkspace>("plan_workspaces"),
    workspaceMembers: db.collection<MongoWorkspaceMember>("workspace_members"),
    botCredentials: db.collection<MongoBotCredential>("bot_credentials"),
    paymentOrders: db.collection<MongoPaymentOrder>("payment_orders"),
    paymentEvents: db.collection<MongoPaymentEvent>("payment_events"),
    paymentSettings: db.collection<MongoPaymentSettings>("payment_settings"),
    planAuditLogs: db.collection<MongoPlanAuditLog>("plan_audit_logs"),
    devBots: db.collection<MongoDevBot>("Bot"),
    botGuildConfigs: db.collection<MongoBotGuildConfig>("BotGuildConfig"),
    antiBanConfigs: db.collection<MongoAntiBanConfig>("anti_ban_configs"),
    antiBanLogs: db.collection<MongoAntiBanLog>("anti_ban_logs"),
    devPermissions: db.collection<MongoDevPermission>("DevPermission"),
    maintenanceState: db.collection<MongoMaintenanceState>("MaintenanceState"),
    maintenanceLogs: db.collection<MongoMaintenanceLog>("MaintenanceLog"),
    systemEmojis: db.collection<MongoSystemEmoji>("system_emojis"),
    dashboardAuditLogs: db.collection<MongoDashboardAuditLog>("DashboardAuditLog"),
    panelImageSettings: db.collection<MongoPanelImageSettings>("panel_image_settings"),
    persistentImages: db.collection<MongoPersistentImage>("persistent_images")
  };
}

export async function ensureGuild(guildId: string) {
  const { guilds } = await getMongoCollections();
  const now = new Date();

  await guilds.updateOne(
    {
      _id: guildId
    },
    {
      $set: {
        updatedAt: now
      },
      $setOnInsert: {
        _id: guildId,
        name: `Guild ${guildId}`,
        icon: null,
        ownerId: null,
        botEnabled: false,
        createdAt: now
      }
    },
    {
      upsert: true
    }
  );
}

async function ensureMongoIndexes(db: Db) {
  if (!globalForMongo.mongoIndexes) {
    globalForMongo.mongoIndexes = createMongoIndexes(db).catch((error) => {
      console.warn("[mongo] não foi possível criar indices:", error instanceof Error ? error.message : error);
    });
  }

  await globalForMongo.mongoIndexes;
}

async function createMongoIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoUser>("User").createIndex(
      { discordId: 1 },
      {
        name: "User_discordId_key",
        unique: true
      }
    ),
    ensureGuildSettingsIndexes(db),
    db.collection<MongoTicket>("Ticket").createIndex({ guildId: 1, createdAt: -1 }),
    db.collection<MongoTicket>("Ticket").createIndex({ botId: 1, guildId: 1, channelId: 1 }),
    db.collection<MongoTicket>("Ticket").createIndex({ botId: 1, guildId: 1, status: 1, createdAt: -1 }),
    db.collection<MongoHierarchyForwardingRule>("hierarchy_forwarding").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoHierarchyForwardingRule>("hierarchy_forwarding").createIndex(
      { botId: 1, guildId: 1, denouncedRoleId: 1 },
      { unique: true, partialFilterExpression: { enabled: true, deletedAt: null } }
    ),
    db.collection<MongoTranscript>("transcripts").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoTranscript>("transcripts").createIndex({ ticketId: 1 }),
    db.collection<MongoTranscriptPassword>("transcript_passwords").createIndex({ transcriptId: 1, type: 1, createdAt: -1 }),
    db.collection<MongoTranscriptAccessLog>("transcript_access_logs").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoTranscriptAccessLog>("transcript_access_logs").createIndex({ transcriptId: 1, createdAt: -1 }),
    db.collection<MongoTicketEvent>("ticket_events").createIndex({ ticketId: 1, createdAt: 1 }),
    db.collection<MongoTicketEvent>("ticket_events").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoCourseSettings>("course_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoCourse>("courses").createIndex({ botId: 1, guildId: 1, active: 1, updatedAt: -1 }),
    db.collection<MongoCourseDepartment>("course_departments").createIndex({ botId: 1, guildId: 1, active: 1, name: 1 }),
    db.collection<MongoCourseDepartment>("course_departments").createIndex(
      { botId: 1, guildId: 1, normalizedName: 1 },
      { unique: true, partialFilterExpression: { active: true } }
    ),
    db.collection<MongoCoursePublication>("course_publications").createIndex({ botId: 1, guildId: 1, status: 1, createdAt: -1 }),
    db.collection<MongoCoursePublication>("course_publications").createIndex({ botId: 1, guildId: 1, messageId: 1 }),
    db.collection<MongoCoursePublication>("course_publications").createIndex({ botId: 1, guildId: 1, discordEventId: 1 }),
    db.collection<MongoCoursePublication>("course_publications").createIndex({ botId: 1, guildId: 1, courseId: 1, scheduledStartAt: 1 }),
    db.collection<MongoCourseEnrollment>("course_enrollments").createIndex(
      { botId: 1, guildId: 1, publicationId: 1, studentId: 1 },
      { unique: true }
    ),
    db.collection<MongoCourseEnrollment>("course_enrollments").createIndex({ botId: 1, guildId: 1, courseId: 1, examStatus: 1, updatedAt: -1 }),
    db.collection<MongoCourseScheduleRequest>("course_schedule_requests").createIndex({ botId: 1, guildId: 1, status: 1, createdAt: -1 }),
    db.collection<MongoCourseReport>("course_reports").createIndex({ botId: 1, guildId: 1, courseId: 1, createdAt: -1 }),
    db.collection<MongoCourseLog>("course_logs").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoCourseExamAttempt>("course_exam_attempts").createIndex({ botId: 1, guildId: 1, publicationId: 1, studentId: 1, status: 1 }),
    db.collection<MongoCourseExamAttempt>("course_exam_attempts").createIndex({ botId: 1, guildId: 1, publicationId: 1, studentId: 1, startedAt: -1 }),
    db.collection<MongoCourseExamAttempt>("course_exam_attempts").createIndex({ botId: 1, guildId: 1, channelId: 1, status: 1 }),
    db.collection<MongoCourseExamAnswer>("course_exam_answers").createIndex({ botId: 1, guildId: 1, attemptId: 1, questionId: 1 }),
    db.collection<MongoCourseInstructorSettings>("course_instructor_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoCourseInstructorEvent>("course_instructor_events").createIndex({ botId: 1, guildId: 1, weekKey: 1, instructorId: 1, timestamp: -1 }),
    db.collection<MongoCourseInstructorEvent>("course_instructor_events").createIndex(
      { botId: 1, guildId: 1, publicationId: 1, status: 1 },
      { unique: true, partialFilterExpression: { publicationId: { $type: "string" } } }
    ),
    db.collection<MongoCourseHistorySettings>("course_history_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoCourseStudentHistory>("course_student_history").createIndex({ botId: 1, guildId: 1, studentId: 1, timestamp: -1 }),
    db.collection<MongoCourseStudentHistory>("course_student_history").createIndex(
      { botId: 1, guildId: 1, attemptId: 1 },
      { unique: true, partialFilterExpression: { attemptId: { $type: "string" } } }
    ),
    db.collection<MongoOpenDutySettings>("open_duty_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoOpenDutyWarningCounter>("open_duty_counters").createIndex({ botId: 1, guildId: 1, userId: 1 }, { unique: true }),
    db.collection<MongoOpenDutyNotification>("open_duty_notifications").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoOpenDutyNotification>("open_duty_notifications").createIndex({ botId: 1, guildId: 1, targetId: 1, createdAt: -1 }),
    db.collection<MongoRhAdminSettings>("rh_admin_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoRhAdminAbsence>("rh_admin_absences").createIndex({ botId: 1, guildId: 1, status: 1, createdAt: -1 }),
    db.collection<MongoRhAdminAbsence>("rh_admin_absences").createIndex({ botId: 1, status: 1, returnAt: 1, autoRemoved: 1 }),
    db.collection<MongoRhAdminAbsence>("rh_admin_absences").createIndex({ botId: 1, guildId: 1, reviewMessageId: 1 }),
    db.collection<MongoRhAdminAdornment>("rh_admin_adornments").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoRhAdminLog>("rh_admin_logs").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoManualRegistrationSettings>("manual_registration_settings").createIndex(
      { botId: 1, guildId: 1 },
      { unique: true }
    ),
    db.collection<MongoManualRegistrationSubmission>("manual_registration_submissions").createIndex(
      { botId: 1, guildId: 1, createdAt: -1 }
    ),
    db.collection<MongoManualRegistrationSubmission>("manual_registration_submissions").createIndex(
      { botId: 1, guildId: 1, userId: 1, status: 1, createdAt: -1 }
    ),
    db.collection<MongoManualRegistrationSubmission>("manual_registration_submissions").createIndex(
      { botId: 1, guildId: 1, userId: 1 }, { name: "manual_registration_pending_user_unique", unique: true, partialFilterExpression: { status: "pending", registrationVersion: 2 } }
    ),
    db.collection<MongoManualRegistrationSubmission>("manual_registration_submissions").createIndex(
      { botId: 1, guildId: 1, userId: 1 }, { name: "manual_registration_active_user_unique", unique: true, partialFilterExpression: { status: "approved", registrationVersion: 2 } }
    ),
    db.collection<MongoManualRegistrationLog>("manual_registration_logs").createIndex(
      { botId: 1, guildId: 1, createdAt: -1 }
    ),
    db.collection<MongoFivemGoalSettings>("fivem_goal_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoFivemGoalUserChannel>("fivem_goal_user_channels").createIndex({ botId: 1, guildId: 1, userId: 1 }, { unique: true }),
    db.collection<MongoFivemGoalUserChannel>("fivem_goal_user_channels").createIndex({ botId: 1, channelId: 1 }, { unique: true }),
    db.collection<MongoFivemGoalEntry>("fivem_goal_entries").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoFivemGoalConfig>("fivem_goal_configs").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoFivemGoalConfig>("fivem_goal_configs").createIndex({ botId: 1, guildId: 1, status: 1 }),
    db.collection<MongoFivemGoalSubmission>("fivem_goal_submissions").createIndex({ botId: 1, guildId: 1, metaId: 1, createdAt: -1 }),
    db.collection<MongoFivemGoalSubmission>("fivem_goal_submissions").createIndex({ botId: 1, guildId: 1, userId: 1, createdAt: -1 }),
    db.collection<MongoFivemGoalSubmission>("fivem_goal_submissions").createIndex({ botId: 1, guildId: 1, status: 1, createdAt: -1 }),
    db.collection<MongoFivemGoalLog>("fivem_goal_logs").createIndex({ botId: 1, guildId: 1, metaId: 1, createdAt: -1 }),
    db.collection<MongoFivemOrderSettings>("fivem_order_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoFivemOrderFamily>("fivem_order_families").createIndex(
      { botId: 1, guildId: 1, name: 1, active: 1 },
      { partialFilterExpression: { active: true }, unique: true }
    ),
    db.collection<MongoFivemOrderFamily>("fivem_order_families").createIndex({ botId: 1, guildId: 1, active: 1, updatedAt: -1 }),
    db.collection<MongoFivemOrderProduct>("fivem_order_products").createIndex({ botId: 1, guildId: 1, order: 1 }),
    db.collection<MongoFivemOrder>("fivem_orders").createIndex({ botId: 1, guildId: 1, orderNumber: -1 }, { unique: true }),
    db.collection<MongoFivemOrder>("fivem_orders").createIndex({ botId: 1, guildId: 1, status: 1, createdAt: -1 }),
    db.collection<MongoFivemOrder>("fivem_orders").createIndex({ botId: 1, guildId: 1, familyId: 1, status: 1 }),
    db.collection<MongoFivemOrder>("fivem_orders").createIndex({ botId: 1, guildId: 1, financialTransactionId: 1 }),
    db.collection<MongoFivemOrder>("fivem_orders").createIndex({ botId: 1, guildId: 1, userId: 1, createdAt: -1 }),
    db.collection<MongoFivemOrderLog>("fivem_order_logs").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoFivemFinanceSettings>("fivem_finance_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoFivemFinanceTransaction>("fivem_finance_transactions").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoFivemFinanceTransaction>("fivem_finance_transactions").createIndex({ botId: 1, guildId: 1, transactionId: 1 }, { unique: true }),
    db.collection<MongoFivemFinanceTransaction>("fivem_finance_transactions").createIndex(
      { botId: 1, guildId: 1, "metadata.laundryOrderId": 1 },
      { partialFilterExpression: { "metadata.laundryOrderId": { $type: "string" } }, unique: true }
    ),
    db.collection<MongoFivemFinanceTransaction>("fivem_finance_transactions").createIndex({ botId: 1, guildId: 1, userId: 1, createdAt: -1 }),
    db.collection<MongoFivemFinanceLog>("fivem_finance_logs").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoFivemHierarchyPanel>("fivem_hierarchy_panels").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoFivemHierarchyPanel>("fivem_hierarchy_panels").createIndex({ botId: 1, guildId: 1, deletedAt: 1, enabled: 1 }),
    db.collection<MongoFivemHierarchyPanel>("fivem_hierarchy_panels").createIndex(
      { creationKey: 1 },
      {
        name: "fivem_hierarchy_creation_key_unique",
        partialFilterExpression: { creationKey: { $type: "string" } },
        unique: true
      }
    ),
    db.collection<MongoFivemHierarchyPanel>("fivem_hierarchy_panels").createIndex({ botId: 1, legacyCleanupPending: 1, deletedAt: 1 }),
    db.collection<MongoFivemHierarchyLog>("fivem_hierarchy_logs").createIndex({ botId: 1, guildId: 1, panelId: 1, createdAt: -1 }),
    db.collection<MongoZtkWebhookClan>("ztk_webhook_clans").createIndex({ botId: 1, guildId: 1, ownerUserId: 1, clanName: 1 }, { unique: true }),
    db.collection<MongoZtkWebhookClan>("ztk_webhook_clans").createIndex({ webhookToken: 1 }, { unique: true, partialFilterExpression: { webhookToken: { $type: "string" } } }),
    db.collection<MongoZtkWebhookClan>("ztk_webhook_clans").createIndex({ botId: 1, guildId: 1, discordWebhookId: 1 }, { unique: true, partialFilterExpression: { discordWebhookId: { $type: "string" } } }),
    db.collection<MongoZtkWebhookLog>("ztk_webhook_logs").createIndex({ botId: 1, guildId: 1, clanId: 1, createdAt: -1 }),
    db.collection<MongoZtkWebhookLog>("ztk_webhook_logs").createIndex({ botId: 1, guildId: 1, clanId: 1, dedupeKey: 1 }, { unique: true }),
    db.collection<MongoZtkWebhookLog>("ztk_webhook_logs").createIndex({ botId: 1, guildId: 1, clanId: 1, eventType: 1, eventTimestamp: -1 }),
    db.collection<MongoZtkWebhookLog>("ztk_webhook_logs").createIndex({ botId: 1, guildId: 1, clanId: 1, messageId: 1, webhookId: 1, channelId: 1 }, { partialFilterExpression: { messageId: { $type: "string" } } }),
    db.collection<MongoZtkWebhookLog>("ztk_webhook_logs").createIndex({ botId: 1, guildId: 1, clanId: 1, normalizedGangName: 1, eventTimestamp: -1 }),
    db.collection<MongoZtkWebhookLog>("ztk_webhook_logs").createIndex({ botId: 1, guildId: 1, clanId: 1, eventType: 1, recruiterName: 1, eventTimestamp: -1 }),
    db.collection<MongoZtkWebhookPlayerStat>("ztk_webhook_player_stats").createIndex({ botId: 1, guildId: 1, clanId: 1, playerName: 1 }, { unique: true }),
    db.collection<MongoZtkWebhookPlayerStat>("ztk_webhook_player_stats").createIndex({ botId: 1, guildId: 1, clanId: 1, dominations: -1 }),
    db.collection<MongoZtkWebhookPlayerStat>("ztk_webhook_player_stats").createIndex({ botId: 1, guildId: 1, clanId: 1, recruitments: -1 }),
    db.collection<MongoZtkWebhookPlayerStat>("ztk_webhook_player_stats").createIndex({ botId: 1, guildId: 1, clanId: 1, onlineSeconds: -1 }),
    db.collection<MongoZtkRecruiterRanking>("ranking_recrutadores").createIndex({ botId: 1, guildId: 1, clan_id: 1, normalized_nome: 1 }, { unique: true }),
    db.collection<MongoZtkRecruiterRanking>("ranking_recrutadores").createIndex({ botId: 1, guildId: 1, clan_id: 1, total_recrutamentos: -1, updated_at: -1 }),
    db.collection<MongoZtkWebhookReward>("ztk_webhook_rewards").createIndex({ botId: 1, guildId: 1, clanId: 1, rankingType: 1, createdAt: -1 }),
    db.collection<MongoGlobalBlacklistSafeBotSettings>("global_blacklist_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoGlobalBlacklistEntry>("global_blacklist_entries").createIndex({ userId: 1, active: 1 }),
    db.collection<MongoGlobalBlacklistEntry>("global_blacklist_entries").createIndex({ botId: 1, guildId: 1, active: 1 }),
    db.collection<MongoGlobalBlacklistHistory>("global_blacklist_history").createIndex({ userId: 1, createdAt: -1 }),
    db.collection<MongoServerBackupSettings>("server_backup_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoServerBackupSnapshot>("server_backup_snapshots").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoServerBackupRestoreJob>("server_backup_restore_jobs").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoBackgroundJob>("background_jobs").createIndex({ status: 1, availableAt: 1, priority: -1, createdAt: 1 }),
    db.collection<MongoBackgroundJob>("background_jobs").createIndex({ type: 1, idempotencyKey: 1 }, { unique: true }),
    db.collection<MongoBackgroundJob>("background_jobs").createIndex({ lockedUntil: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }),
    db.collection<MongoServiceHeartbeat>("service_heartbeats").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection<MongoServiceHeartbeat>("service_heartbeats").createIndex({ service: 1, updatedAt: -1 }),
    db.collection<MongoLogEntry>("LogEntry").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoLogEntry>("LogEntry").createIndex({ botId: 1, guildId: 1, module: 1, action: 1, createdAt: -1 }),
    db.collection<MongoLogEntry>("LogEntry").createIndex({ botId: 1, guildId: 1, caseId: 1, createdAt: -1 }),
    db.collection<MongoLiveDetectionSettings>("live_detection_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoLiveDetectionSettings>("live_detection_settings").createIndex({ botId: 1, enabled: 1, updatedAt: -1 }),
    db.collection<MongoPoliceTimeClockSettings>("police_time_clock_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoPoliceTimeClockSession>("police_time_clock_sessions").createIndex({ botId: 1, guildId: 1, status: 1, startedAt: -1 }),
    db.collection<MongoPoliceTimeClockSession>("police_time_clock_sessions").createIndex({ botId: 1, guildId: 1, userId: 1, status: 1 }),
    db.collection<MongoPoliceTimeClockSession>("police_time_clock_sessions").createIndex({ botId: 1, guildId: 1, userId: 1, startedAt: -1 }),
    db.collection<MongoPoliceTimeClockLog>("police_time_clock_logs").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoAutoActivityClockSettings>("auto_activity_clock_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoAutoActivityClockCity>("auto_activity_clock_cities").createIndex({ botId: 1, guildId: 1, name: 1 }, { unique: true }),
    db.collection<MongoAutoActivityClockCity>("auto_activity_clock_cities").createIndex({ botId: 1, guildId: 1, enabled: 1, updatedAt: -1 }),
    db.collection<MongoAutoActivityClockSession>("auto_activity_clock_sessions").createIndex({ botId: 1, guildId: 1, status: 1, startedAt: -1 }),
    db.collection<MongoAutoActivityClockSession>("auto_activity_clock_sessions").createIndex({ botId: 1, guildId: 1, userId: 1, status: 1 }),
    db.collection<MongoAutoActivityClockSession>("auto_activity_clock_sessions").createIndex({ botId: 1, guildId: 1, userId: 1, startedAt: -1 }),
    db.collection<MongoAutoActivityClockLog>("auto_activity_clock_logs").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoTranscript>("transcripts").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoTranscript>("transcripts").createIndex({ botId: 1, guildId: 1, ticketId: 1 }),
    db.collection<MongoTranscript>("transcripts").createIndex({ botId: 1, guildId: 1, type: 1, status: 1, createdAt: -1 }),
    db.collection<MongoTranscriptPassword>("transcript_passwords").createIndex({ transcriptId: 1, type: 1, createdAt: -1 }),
    db.collection<MongoTranscriptAccessLog>("transcript_access_logs").createIndex({ transcriptId: 1, createdAt: -1 }),
    db.collection<MongoPanelImageSettings>("panel_image_settings").createIndex(
      { botId: 1, guildId: 1, panelId: 1 },
      { unique: true }
    ),
    db.collection<MongoPersistentImage>("persistent_images").createIndex({ guildId: 1, moduleId: 1, imageType: 1, uploadedAt: -1 }),
    db.collection<MongoPersistentImage>("persistent_images").createIndex({ createdAt: -1 }),
    ensureSocialNotificationIndexes(db),
    ensureKickApiIndexes(db),
    ensureSocialNetworkIndexes(db),
    ensureXMonitorIndexes(db),
    ensureClipsIndexes(db),
    ensureGiveawayIndexes(db),
    ensureFivemModuleIndexes(db),
    ensureFivemFacIndexes(db),
    ensureImageAntiSpamIndexes(db),
    ensureVoiceRecorderIndexes(db),
    ensureEmojiCloneIndexes(db),
    ensureNexTechInviteIndexes(db),
    ensureNexTechSalesIndexes(db),
    ensureSubscriptionPresenceIndexes(db),
    ensureSalesTicketIndexes(db),
    ensurePriceTableIndexes(db),
    ensureManualPaymentIndexes(db),
    ensureMissionToolsIndexes(db),
    ensureSelfBotProtectionIndexes(db),
    ensureSafeBotWarningIndexes(db),
    ensureTemporaryCallIndexes(db),
    ensureAutomatedLogIndexes(db),
    ensureSecurityFeatureAccessIndexes(db),
    ensureAntiBanIndexes(db),
    ensurePlanIndexes(db),
    db.collection<MongoSocialNotification>("social_notifications").createIndex(
      {
        guildId: 1,
        platform: 1
      },
      {
        name: "social_notifications_guildId_platform_idx"
      }
    ),
    db.collection<MongoSocialNotification>("social_notifications").createIndex(
      {
        platform: 1,
        enabled: 1
      },
      {
        name: "social_notifications_platform_enabled_idx"
      }
    ),
    db.collection<MongoSocialNotification>("social_notifications").createIndex(
      {
        botId: 1,
        platform: 1,
        enabled: 1,
        updatedAt: 1
      },
      {
        name: "social_notifications_bot_platform_enabled_updated_idx"
      }
    ),
    db.collection<MongoSocialNotification>("social_notifications").createIndex(
      {
        botId: 1,
        guildId: 1,
        platform: 1,
        createdAt: -1
      },
      {
        name: "social_notifications_bot_guild_platform_created_idx"
      }
    ),
    ensureDevBotIndexes(db),
    db.collection<MongoBotGuildConfig>("BotGuildConfig").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoDevPermission>("DevPermission").createIndex({ userId: 1 }, { unique: true }),
    ensureSystemEmojiIndexes(db),
    ensureDashboardAuditLogIndexes(db)
  ]);
}

async function ensureSystemEmojiIndexes(db: Db) {
  const collection = db.collection<MongoSystemEmoji>("system_emojis");

  await collection.updateMany({ guildId: { $exists: false } }, { $set: { guildId: null } });
  await collection.dropIndex("botId_1_key_1").catch(() => undefined);

  await Promise.all([
    collection.createIndex({ botId: 1, guildId: 1, key: 1 }, { unique: true }),
    collection.createIndex({ botId: 1, guildId: 1, updatedAt: -1 }),
    collection.createIndex({ updatedAt: -1 }),
    collection.createIndex({ lastValidatedAt: -1 })
  ]);
}

async function ensurePlanIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoPlan>("plans").createIndex({ slug: 1 }, { unique: true }),
    db.collection<MongoPlan>("plans").createIndex({ isPublic: 1, isActive: 1, order: 1 }),
    db.collection<MongoPlan>("plans").createIndex({ updatedAt: -1 }),
    db.collection<MongoPlanFeature>("plan_features").createIndex({ key: 1 }, { unique: true }),
    db.collection<MongoPlanFeature>("plan_features").createIndex({ category: 1, order: 1 }),
    db.collection<MongoPlanSubscription>("plan_subscriptions").createIndex({ discordId: 1, status: 1, updatedAt: -1 }),
    db.collection<MongoPlanSubscription>("plan_subscriptions").createIndex({ userId: 1, status: 1, updatedAt: -1 }),
    db.collection<MongoPlanSubscription>("plan_subscriptions").createIndex({ planId: 1, status: 1, updatedAt: -1 }),
    db.collection<MongoPlanSubscription>("plan_subscriptions").createIndex({ workspaceId: 1 }),
    db.collection<MongoPlanSubscription>("plan_subscriptions").createIndex({ "metadata.paymentOrderId": 1 }, { sparse: true, unique: true }),
    db.collection<MongoPlanWorkspace>("plan_workspaces").createIndex({ ownerDiscordId: 1, status: 1, updatedAt: -1 }),
    db.collection<MongoPlanWorkspace>("plan_workspaces").createIndex({ slug: 1 }, { unique: true }),
    db.collection<MongoWorkspaceMember>("workspace_members").createIndex({ workspaceId: 1, discordId: 1 }, { unique: true }),
    db.collection<MongoWorkspaceMember>("workspace_members").createIndex({ discordId: 1, workspaceId: 1 }),
    db.collection<MongoBotCredential>("bot_credentials").createIndex({ workspaceId: 1, createdAt: -1 }),
    db.collection<MongoBotCredential>("bot_credentials").createIndex({ workspaceId: 1, botClientId: 1 }, { unique: true }),
    db.collection<MongoBotCredential>("bot_credentials").createIndex({ slug: 1 }, { sparse: true, unique: true }),
    db.collection<MongoBotCredential>("bot_credentials").createIndex({ guildId: 1 }, { sparse: true }),
    db.collection<MongoBotCredential>("bot_credentials").createIndex({ tokenFingerprint: 1 }, { unique: true }),
    db.collection<MongoPaymentOrder>("payment_orders").createIndex({ discordId: 1, createdAt: -1 }),
    db.collection<MongoPaymentOrder>("payment_orders").createIndex({ planId: 1, status: 1, createdAt: -1 }),
    db.collection<MongoPaymentOrder>("payment_orders").createIndex({ provider: 1, providerOrderId: 1 }),
    db.collection<MongoPaymentOrder>("payment_orders").createIndex({ environment: 1, status: 1, createdAt: -1 }),
    db.collection<MongoPaymentOrder>("payment_orders").createIndex({ environment: 1, mercadoPagoPaymentId: 1 }, { sparse: true }),
    db.collection<MongoPaymentOrder>("payment_orders").createIndex({ idempotencyKey: 1 }, { sparse: true, unique: true }),
    db.collection<MongoPaymentOrder>("payment_orders").createIndex({ externalReference: 1 }, { sparse: true, unique: true }),
    db.collection<MongoPaymentOrder>("payment_orders").createIndex({ mercadoPagoPaymentId: 1 }, { sparse: true }),
    db.collection<MongoPaymentEvent>("payment_events").createIndex({ provider: 1, eventId: 1 }),
    db.collection<MongoPaymentEvent>("payment_events").createIndex({ provider: 1, environment: 1, paymentId: 1, eventType: 1, requestId: 1 }, { sparse: true }),
    db.collection<MongoPaymentEvent>("payment_events").createIndex({ provider: 1, payloadHash: 1 }),
    db.collection<MongoPaymentEvent>("payment_events").createIndex({ createdAt: -1 }),
    db.collection<MongoPlanAuditLog>("plan_audit_logs").createIndex({ createdAt: -1 }),
    db.collection<MongoPlanAuditLog>("plan_audit_logs").createIndex({ actorId: 1, createdAt: -1 }),
    db.collection<MongoPlanAuditLog>("plan_audit_logs").createIndex({ targetType: 1, targetId: 1, createdAt: -1 })
  ]);
}

async function ensureAntiBanIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoAntiBanConfig>("anti_ban_configs").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoAntiBanLog>("anti_ban_logs").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoAntiBanLog>("anti_ban_logs").createIndex({ botId: 1, guildId: 1, executorId: 1, createdAt: -1 })
  ]);
}

async function ensureDevBotIndexes(db: Db) {
  const collection = db.collection<MongoDevBot>("Bot");

  await ensureDevBotSlugs(collection);
  await collection.createIndex({ clientId: 1 }, { unique: true });
  await collection.createIndex({ slug: 1 }, { unique: true });
  await collection.createIndex({ ownerId: 1, createdAt: -1 });
  await collection.createIndex({ _id: 1, slug: 1 }, { name: "Bot_botId_dashboardSlug_idx" });
  await collection.createIndex({ mainGuildId: 1, updatedAt: -1 });
}

async function ensureDashboardAuditLogIndexes(db: Db) {
  const collection = db.collection<MongoDashboardAuditLog>("DashboardAuditLog");

  await Promise.all([
    collection.createIndex({ createdAt: -1 }),
    collection.createIndex({ userId: 1, createdAt: -1 }),
    collection.createIndex({ botId: 1, createdAt: -1 }),
    collection.createIndex({ guildId: 1, createdAt: -1 }),
    collection.createIndex({ dashboardSlug: 1, createdAt: -1 }),
    collection.createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    collection.createIndex({ botId: 1, dashboardSlug: 1, createdAt: -1 })
  ]);
}

async function ensureDevBotSlugs(collection: Collection<MongoDevBot>) {
  const bots = await collection
    .find(
      {},
      {
        projection: {
          _id: 1,
          name: 1,
          slug: 1,
          createdAt: 1
        }
      }
    )
    .sort({ createdAt: 1 })
    .toArray();
  const reservedSlugs = new Set<string>();

  for (const bot of bots) {
    const currentSlug = bot.slug ? slugifyBotName(bot.slug) : "";
    const baseSlug = currentSlug || slugifyBotName(bot.name);
    const nextSlug = uniqueSlugFromReserved(baseSlug, reservedSlugs);

    reservedSlugs.add(nextSlug);

    if (bot.slug !== nextSlug) {
      await collection.updateOne(
        {
          _id: bot._id
        },
        {
          $set: {
            slug: nextSlug,
            updatedAt: new Date()
          }
        }
      );
    }
  }
}

function uniqueSlugFromReserved(baseSlug: string, reservedSlugs: Set<string>) {
  const base = baseSlug || "bot";
  let slug = base;
  let suffix = 2;

  while (reservedSlugs.has(slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }

  return slug;
}

function slugifyBotName(value: string) {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return slug || "bot";
}

async function ensureGuildSettingsIndexes(db: Db) {
  const collection = db.collection<MongoGuildSettings>("GuildSettings");

  await Promise.all([
    collection.dropIndex("guildId_1").catch(() => undefined),
    collection.dropIndex("GuildSettings_guildId_key").catch(() => undefined)
  ]);
  await collection.createIndex({ botId: 1, guildId: 1 }, { unique: true });
  await db.collection<MongoSafeBotMessageState>("safe_bot_message_states").createIndex(
    { botId: 1, guildId: 1 },
    { unique: true }
  );
}

async function ensureKickApiIndexes(db: Db) {
  await db.collection<MongoKickApiConfig>("kick_api_configs").createIndex(
    {
      botId: 1,
      guildId: 1
    },
    {
      unique: true
    }
  );
}

async function ensureSocialNotificationIndexes(db: Db) {
  const collection = db.collection<MongoSocialNotification>("social_notifications");

  await collection.dropIndex("guildId_1_platform_1_twitchChannelName_1").catch(() => undefined);
  await collection.dropIndex("botId_1_guildId_1_userId_1_platform_1_twitchChannelName_1").catch(() => undefined);
  await collection.dropIndex("botId_1_guildId_1_platform_1_twitchChannelName_1").catch(() => undefined);
  await collection.dropIndex("botId_1_guildId_1_platform_1_kickChannelName_1").catch(() => undefined);
  await collection.createIndex({
    botId: 1,
    guildId: 1
  });
  await collection.createIndex(
    {
      botId: 1,
      guildId: 1,
      platform: 1,
      twitchChannelName: 1
    },
    {
      name: "social_notifications_twitch_channel_unique",
      partialFilterExpression: {
        platform: "twitch",
        twitchChannelName: {
          $type: "string"
        }
      },
      unique: true
    }
  );
  await collection.createIndex(
    {
      botId: 1,
      guildId: 1,
      platform: 1,
      kickChannelName: 1
    },
    {
      name: "social_notifications_kick_channel_unique",
      partialFilterExpression: {
        platform: "kick",
        kickChannelName: {
          $type: "string"
        }
      },
      unique: true
    }
  );
}

async function ensureSocialNetworkIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoSocialMember>("social_members").createIndex({
      botId: 1,
      guildId: 1,
      createdAt: -1
    }),
    db.collection<MongoSocialMember>("social_members").createIndex({
      botId: 1,
      guildId: 1,
      name: 1
    }),
    db.collection<MongoSocialPanel>("social_panels").createIndex(
      {
        botId: 1,
        guildId: 1
      },
      {
        unique: true
      }
    ),
    db.collection<MongoSocialPanel>("social_panels").createIndex({
      botId: 1,
      published: 1,
      updatedAt: 1
    })
  ]);
}

async function ensureXMonitorIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoXAccount>("x_accounts").createIndex({
      botId: 1,
      guildId: 1,
      createdAt: -1
    }),
    db.collection<MongoXAccount>("x_accounts").createIndex(
      {
        botId: 1,
        guildId: 1,
        username: 1
      },
      {
        unique: true
      }
    ),
    db.collection<MongoXAccount>("x_accounts").createIndex({
      botId: 1,
      active: 1,
      lastSyncAt: 1
    }),
    db.collection<MongoXPostSent>("x_posts_sent").createIndex(
      {
        botId: 1,
        accountId: 1,
        xPostId: 1
      },
      {
        unique: true
      }
    ),
    db.collection<MongoXPostSent>("x_posts_sent").createIndex({
      botId: 1,
      guildId: 1,
      sentAt: -1
    })
  ]);
}

async function ensureClipsIndexes(db: Db) {
  const clipsConfig = db.collection<MongoClipsConfig>("clips_config");
  const clipsSent = db.collection<MongoClipSent>("clips_sent");
  const clipLiveSessions = db.collection<MongoClipLiveSession>("clip_live_sessions");

  await Promise.all([
    clipsConfig.dropIndex("botId_1_guildId_1").catch(() => undefined),
    clipsConfig.dropIndex("clips_config_scope_platform_unique").catch(() => undefined),
    clipsSent.dropIndex("botId_1_guildId_1_clipId_1").catch(() => undefined),
    clipsSent.dropIndex("clips_sent_scope_platform_clip_unique").catch(() => undefined)
  ]);

  await Promise.all([
    clipsConfig.createIndex({ botId: 1, guildId: 1, platform: 1, updatedAt: -1 }, { name: "clips_config_scope_platform_idx" }),
    clipsConfig.createIndex(
      { botId: 1, guildId: 1, platform: 1, twitchBroadcasterId: 1 },
      {
        name: "clips_config_twitch_channel_unique",
        partialFilterExpression: { platform: "twitch", twitchBroadcasterId: { $type: "string" }, deletedAt: null },
        unique: true
      }
    ),
    clipsConfig.createIndex(
      { botId: 1, guildId: 1, platform: 1, kickUserId: 1 },
      {
        name: "clips_config_kick_channel_unique",
        partialFilterExpression: { platform: "kick", kickUserId: { $type: "string" }, deletedAt: null },
        unique: true
      }
    ),
    clipsConfig.createIndex({ enabled: 1, botId: 1, platform: 1, deletedAt: 1, lastCheckAt: 1 }),
    clipsSent.createIndex({ botId: 1, configId: 1, clipId: 1 }, { name: "clips_sent_config_clip_unique", unique: true }),
    clipsSent.createIndex({ botId: 1, guildId: 1, platform: 1, sentAt: -1 }),
    clipsSent.createIndex({ botId: 1, guildId: 1, platform: 1, clipCreatorName: 1, sentAt: -1 }),
    clipLiveSessions.createIndex({ botId: 1, configId: 1, streamId: 1 }, { unique: true }),
    clipLiveSessions.createIndex({ botId: 1, guildId: 1, platform: 1, startedAt: -1 }),
    db.collection<MongoClipLog>("clips_logs").createIndex({ botId: 1, guildId: 1, createdAt: -1 })
  ]);
}

async function ensureGiveawayIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoGiveaway>("giveaways").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoGiveaway>("giveaways").createIndex({ botId: 1, status: 1, scheduledStartAt: 1 }),
    db.collection<MongoGiveaway>("giveaways").createIndex({ botId: 1, status: 1, scheduledEndAt: 1 }),
    db.collection<MongoGiveaway>("giveaways").createIndex({ rouletteToken: 1 }, { unique: true }),
    db.collection<MongoGiveawayPlatformAccount>("giveaway_platform_accounts").createIndex(
      {
        platform: 1,
        platformUserId: 1
      },
      {
        unique: true
      }
    ),
    db.collection<MongoGiveawayKickEvent>("giveaway_kick_events").createIndex(
      {
        broadcasterUserId: 1,
        channelSlug: 1,
        userId: 1
      },
      {
        unique: true
      }
    ),
    db.collection<MongoGiveawayKickEvent>("giveaway_kick_events").createIndex({
      broadcasterUserId: 1,
      isFollower: 1,
      isSubscriber: 1,
      updatedAt: -1
    })
  ]);
}

async function ensureFivemModuleIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoFivemModule>("fivem_modules").createIndex({ builtIn: 1, createdAt: -1 }),
    db.collection<MongoFivemModule>("fivem_modules").createIndex({ title: 1 }),
    db.collection<MongoFivemActionSettings>("fivem_action_settings").createIndex({ botId: 1, guildId: 1, architecture: 1 }, { unique: true }),
    db.collection<MongoFivemActionDefinition>("fivem_action_definitions").createIndex({ botId: 1, guildId: 1, architecture: 1, order: 1 }),
    db.collection<MongoFivemActionSession>("fivem_action_sessions").createIndex({ botId: 1, guildId: 1, architecture: 1, createdAt: -1 }),
    db.collection<MongoFivemActionSession>("fivem_action_sessions").createIndex({ botId: 1, guildId: 1, status: 1 }),
    db.collection<MongoFactionChestSettings>("faction_chest_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoFactionChestSettings>("faction_chest_settings").createIndex({ botId: 1, enabled: 1, updatedAt: -1 }),
    db.collection<MongoFactionChestItem>("faction_chest_items").createIndex({ botId: 1, guildId: 1, normalizedName: 1 }, { unique: true }),
    db.collection<MongoFactionChestItem>("faction_chest_items").createIndex({ botId: 1, guildId: 1, category: 1, name: 1 }),
    db.collection<MongoFactionChestLog>("faction_chest_logs").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoFactionChestLog>("faction_chest_logs").createIndex({ botId: 1, guildId: 1, itemId: 1, createdAt: -1 }),
    db.collection<MongoDafScaleSettings>("daf_scale_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoDafScaleEntry>("daf_scale_entries").createIndex({ botId: 1, guildId: 1, userId: 1 }, { unique: true }),
    db.collection<MongoDafScaleEntry>("daf_scale_entries").createIndex({ botId: 1, guildId: 1, role: 1, joinedAt: 1 }),
    db.collection<MongoDafScaleAudit>("daf_scale_audits").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoPolicePatrolSettings>("police_patrol_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoPolicePatrolReport>("police_patrol_reports").createIndex({ botId: 1, guildId: 1, officerId: 1, createdAt: -1 }),
    db.collection<MongoPolicePatrolReport>("police_patrol_reports").createIndex({ openKey: 1 }, { unique: true, partialFilterExpression: { openKey: { $type: "string" } } }),
    db.collection<MongoPolicePatrolReport>("police_patrol_reports").createIndex({ botId: 1, channelId: 1, status: 1 }),
    db.collection<MongoPolicePatrolMessage>("police_patrol_messages").createIndex({ reportId: 1, createdAt: 1 }),
    db.collection<MongoPolicePatrolMessage>("police_patrol_messages").createIndex({ botId: 1, discordMessageId: 1 }, { unique: true }),
    db.collection<MongoPolicePatrolAudit>("police_patrol_audits").createIndex({ reportId: 1, createdAt: 1 }),
    db.collection<MongoPolicePatrolFile>("police_patrol_files").createIndex({ botId: 1, discordAttachmentId: 1 }, { unique: true }),
    db.collection<MongoPolicePatrolFile>("police_patrol_files").createIndex({ reportId: 1, createdAt: 1 }),
    db.collection<MongoVehicleAbandonmentSettings>("vehicle_abandonment_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoVehicleAbandonmentSettings>("vehicle_abandonment_settings").createIndex({ botId: 1, guildId: 1, systemChannelId: 1 }),
    db.collection<MongoVehicleAbandonmentRecord>("vehicle_abandonment_records").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoVehicleAbandonmentRecord>("vehicle_abandonment_records").createIndex({ botId: 1, sourceMessageId: 1 }, { unique: true }),
    db.collection<MongoVehicleAbandonmentLog>("vehicle_abandonment_logs").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoPoliceQruSettings>("police_qru_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoPoliceQruRecord>("police_qru_records").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoPoliceQruRecord>("police_qru_records").createIndex({ botId: 1, guildId: 1, status: 1, createdAt: -1 }),
    db.collection<MongoPoliceQruRecord>("police_qru_records").createIndex({ botId: 1, guildId: 1, boNumber: 1 }),
    db.collection<MongoPoliceQruRecord>("police_qru_records").createIndex({ botId: 1, guildId: 1, occurrenceDate: 1 }),
    db.collection<MongoPoliceQruRecord>("police_qru_records").createIndex({ botId: 1, guildId: 1, qruType: 1 }),
    db.collection<MongoPoliceQruRecord>("police_qru_records").createIndex({ botId: 1, guildId: 1, authorId: 1, createdAt: -1 }),
    db.collection<MongoPoliceQruRecord>("police_qru_records").createIndex({ botId: 1, guildId: 1, "officers.id": 1, createdAt: -1 }),
    db.collection<MongoPoliceQruLog>("police_qru_logs").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoPoliceQruLog>("police_qru_logs").createIndex({ botId: 1, guildId: 1, recordId: 1, createdAt: -1 }),
    db.collection<MongoPolicePromotionSettings>("police_promotion_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoPolicePromotionRequest>("police_promotion_requests").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoPolicePromotionRequest>("police_promotion_requests").createIndex({ botId: 1, guildId: 1, status: 1, createdAt: -1 }),
    db.collection<MongoPolicePromotionRequest>("police_promotion_requests").createIndex({ botId: 1, guildId: 1, requesterId: 1, createdAt: -1 }),
    db.collection<MongoPolicePromotionRequest>("police_promotion_requests").createIndex({ botId: 1, guildId: 1, channelId: 1 }, { sparse: true }),
    db.collection<MongoPolicePromotionRequest>("police_promotion_requests").createIndex({ botId: 1, guildId: 1, promotionId: 1, createdAt: -1 }),
    db.collection<MongoPolicePromotionLog>("police_promotion_logs").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoPolicePromotionLog>("police_promotion_logs").createIndex({ botId: 1, guildId: 1, requestId: 1, createdAt: -1 }),
    db.collection<MongoPoliceHiddenChannelSettings>("police_hidden_channel_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoPoliceHiddenChannelSettings>("police_hidden_channel_settings").createIndex({ botId: 1, guildId: 1, channelId: 1 }),
    db.collection<MongoPoliceHiddenChannelLog>("police_hidden_channel_logs").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoPoliceHiddenChannelLog>("police_hidden_channel_logs").createIndex({ botId: 1, originalMessageId: 1 }, { unique: true }),
    db.collection<MongoVisibleMessageUser>("visible_message_users").createIndex({ botId: 1, guildId: 1, userId: 1 }, { unique: true }),
    db.collection<MongoVisibleMessageUser>("visible_message_users").createIndex({ botId: 1, guildId: 1, enabled: 1, updatedAt: -1 }),
    db.collection<MongoMessageControlUser>("message_control_users").createIndex({ botId: 1, guildId: 1, discordId: 1 }, { unique: true }),
    db.collection<MongoMessageControlUser>("message_control_users").createIndex({ botId: 1, guildId: 1, autorizado: 1, updatedAt: -1 }),
    db.collection<MongoMessageControlSettings>("message_control_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoDmBarConfig>("dm_bar_configs").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoDmBarLog>("dm_bar_logs").createIndex({ botId: 1, guildId: 1, sentAt: -1 }),
    db.collection<MongoDmBarLog>("dm_bar_logs").createIndex({ botId: 1, senderId: 1, sentAt: -1 })
  ]);
}

async function ensureFivemFacIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoFivemFacSettings>("fivem_fac_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoFivemFacSettings>("fivem_fac_settings").createIndex({ botId: 1, enabled: 1, updatedAt: -1 }),
    db.collection<MongoFivemFacAbsence>("fivem_fac_absences").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoFivemFacAbsence>("fivem_fac_absences").createIndex({ botId: 1, guildId: 1, userId: 1, status: 1 }),
    db.collection<MongoFivemFacAbsence>("fivem_fac_absences").createIndex({ botId: 1, status: 1, startDate: 1, endDate: 1 })
  ]);
}

async function ensureImageAntiSpamIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoImageAntiSpamSettings>("image_anti_spam_settings").createIndex(
      { botId: 1, guildId: 1 },
      { unique: true }
    ),
    db.collection<MongoImageAntiSpamSettings>("image_anti_spam_settings").createIndex({
      botId: 1,
      enabled: 1,
      updatedAt: -1
    }),
    db.collection<MongoImageAntiSpamUser>("image_anti_spam_users").createIndex(
      { botId: 1, guildId: 1, userId: 1 },
      { unique: true }
    ),
    db.collection<MongoImageAntiSpamUser>("image_anti_spam_users").createIndex({
      botId: 1,
      guildId: 1,
      warningCount: -1,
      lastInfractionAt: -1
    }),
    db.collection<MongoImageAntiSpamIncident>("image_anti_spam_incidents").createIndex(
      { botId: 1, guildId: 1, incidentKey: 1 },
      { unique: true }
    ),
    db.collection<MongoImageAntiSpamIncident>("image_anti_spam_incidents").createIndex({
      botId: 1,
      guildId: 1,
      createdAt: -1
    })
  ]);
}

async function ensureVoiceRecorderIndexes(db: Db) {
  const settings = db.collection<MongoVoiceRecorderSettings>("voice_recorder_settings");
  const recordings = db.collection<MongoVoiceRecording>("voice_recordings");

  await Promise.all([
    settings.createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    recordings.createIndex({ botId: 1, guildId: 1, startedAt: -1 }),
    recordings.createIndex({ botId: 1, guildId: 1, status: 1, startedAt: -1 }),
    recordings.createIndex({ botId: 1, guildId: 1, channelId: 1, startedAt: -1 }),
    recordings.createIndex({ botId: 1, guildId: 1, startedById: 1, startedAt: -1 }),
    recordings.createIndex(
      { botId: 1, guildId: 1, status: 1 },
      {
        name: "voice_recordings_active_unique",
        partialFilterExpression: {
          status: {
            $in: ["starting", "recording", "processing"]
          }
        },
        unique: true
      }
    )
  ]);
}

async function ensureEmojiCloneIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoEmojiCloneJob>("emoji_clone_jobs").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoEmojiCloneJob>("emoji_clone_jobs").createIndex({ botId: 1, status: 1, createdAt: -1 }),
    db.collection<MongoEmojiCloneItem>("emoji_clone_items").createIndex({ jobId: 1 }),
    db.collection<MongoEmojiCloneItem>("emoji_clone_items").createIndex({ jobId: 1, status: 1 }),
    db.collection<MongoEmojiLibraryItem>("emoji_library").createIndex({ botId: 1, userId: 1, importedAt: -1 }),
    db.collection<MongoEmojiLibraryItem>("emoji_library").createIndex({ botId: 1, userId: 1, name: 1 }),
    db.collection<MongoEmojiLibraryItem>("emoji_library").createIndex(
      { botId: 1, userId: 1, originalEmojiId: 1 },
      { unique: true }
    ),
    db.collection<MongoMediaLibraryItem>("media_library").createIndex({ botId: 1, guildId: 1, type: 1, createdAt: -1 }),
    db.collection<MongoMediaLibraryItem>("media_library").createIndex({ botId: 1, guildId: 1, name: 1 }),
    db.collection<MongoMediaImportJob>("media_import_jobs").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoMediaImportJobItem>("media_import_job_items").createIndex({ jobId: 1, status: 1 }),
    db.collection<MongoMediaSettings>("media_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoApplicationEmojiItem>("application_emojis").createIndex({ botId: 1, syncedAt: -1 }),
    db.collection<MongoApplicationEmojiItem>("application_emojis").createIndex({ botId: 1, sourceGuildId: 1, syncedAt: -1 }),
    db.collection<MongoApplicationEmojiItem>("application_emojis").createIndex({ botId: 1, applicationName: 1 }),
    db.collection<MongoApplicationEmojiItem>("application_emojis").createIndex(
      { botId: 1, applicationEmojiId: 1 },
      { unique: true }
    ),
    db.collection<MongoApplicationEmojiItem>("application_emojis").createIndex(
      { botId: 1, sourceGuildId: 1, originalEmojiId: 1 },
      { unique: true }
    ),
    db.collection<MongoApplicationEmojiJob>("application_emoji_jobs").createIndex({ botId: 1, guildId: 1, startedAt: -1 }),
    db.collection<MongoApplicationEmojiSettings>("application_emoji_settings").createIndex(
      { botId: 1, guildId: 1 },
      { unique: true }
    )
  ]);
}

async function ensureMissionToolsIndexes(db: Db) {
  const settings = db.collection<MongoMissionToolsSettings>("mission_tools_settings");
  const users = db.collection<MongoMissionToolsUserPanel>("mission_tools_users");
  const tokens = db.collection<MongoMissionToolsToken>("mission_tools_tokens");

  await Promise.all([
    settings.createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    settings.createIndex({ botId: 1, enabled: 1, updatedAt: -1 }),
    users.createIndex({ botId: 1, guildId: 1, updatedAt: -1 }),
    users.createIndex({ botId: 1, guildId: 1, userId: 1 }, { unique: true }),
    tokens.createIndex({ botId: 1, guildId: 1, userId: 1 }, { unique: true }),
    tokens.createIndex({ botId: 1, guildId: 1, tokenHash: 1 })
  ]);
}

async function ensureNexTechInviteIndexes(db: Db) {
  await db.collection<MongoNexTechInvite>("nextech_invites").dropIndex("code_1").catch(() => undefined);
  await Promise.all([
    db.collection<MongoNexTechInvite>("nextech_invites").createIndex({ botId: 1, guildId: 1, code: 1 }, { unique: true }),
    db.collection<MongoNexTechInvite>("nextech_invites").createIndex({ botId: 1, guildId: 1, status: 1, updatedAt: -1 }),
    db.collection<MongoNexTechInvite>("nextech_invites").createIndex({ status: 1, updatedAt: -1 }),
    db.collection<MongoNexTechInvite>("nextech_invites").createIndex({ clientName: 1, createdAt: -1 }),
    db.collection<MongoNexTechInviteLog>("nextech_invite_logs").createIndex({ createdAt: -1 }),
    db.collection<MongoNexTechInviteLog>("nextech_invite_logs").createIndex({ guildId: 1, createdAt: -1 }),
    db.collection<MongoNexTechInviteLog>("nextech_invite_logs").createIndex({ inviteId: 1, createdAt: -1 }),
    db.collection<MongoNexTechInviteLog>("nextech_invite_logs").createIndex({ inviteCode: 1, createdAt: -1 })
  ]);
}

async function ensureNexTechSalesIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoNexTechSalesSettings>("nexTech_sales_settings").createIndex(
      { ownerUserId: 1, botId: 1, guildId: 1 },
      { unique: true }
    ),
    db.collection<MongoNexTechSalesSettings>("nexTech_sales_settings").createIndex({ storeId: 1 }, { unique: true }),
    db.collection<MongoNexTechSalesSettings>("nexTech_sales_settings").createIndex({ ownerUserId: 1, enabled: 1, updatedAt: -1 }),
    db.collection<MongoNexTechSalesPlan>("nexTech_sales_plans").createIndex({ ownerUserId: 1, storeId: 1, enabled: 1, updatedAt: -1 }),
    db.collection<MongoNexTechProduct>("nexTech_products").createIndex({ ownerUserId: 1, storeId: 1, updatedAt: -1 }),
    db.collection<MongoNexTechProduct>("nexTech_products").createIndex({ storeId: 1, slug: 1 }, { unique: true }),
    db.collection<MongoNexTechProduct>("nexTech_products").createIndex({ storeId: 1, active: 1, updatedAt: -1 }),
    db.collection<MongoNexTechSale>("nexTech_sales").createIndex({ ownerUserId: 1, storeId: 1, createdAt: -1 }),
    db.collection<MongoNexTechSale>("nexTech_sales").createIndex({ ownerUserId: 1, storeId: 1, status: 1, createdAt: -1 }),
    db.collection<MongoNexTechSale>("nexTech_sales").createIndex({ ownerUserId: 1, storeId: 1, buyerId: 1, createdAt: -1 }),
    db.collection<MongoNexTechSale>("nexTech_sales").createIndex({ ownerUserId: 1, storeId: 1, customerId: 1, productId: 1, productPlanType: 1, status: 1 }),
    db.collection<MongoNexTechSale>("nexTech_sales").createIndex({ botId: 1, guildId: 1, deliveryStatus: 1, updatedAt: -1 }),
    db.collection<MongoNexTechCustomer>("nexTech_customers").createIndex({ ownerUserId: 1, storeId: 1, discordId: 1 }),
    db.collection<MongoNexTechSubscription>("nexTech_subscriptions").createIndex({ ownerUserId: 1, storeId: 1, customerId: 1, status: 1 }),
    db.collection<MongoNexTechSubscription>("nexTech_subscriptions").createIndex({ ownerUserId: 1, storeId: 1, productPlanType: 1, nextHostingDueAt: 1, status: 1 }),
    db.collection<MongoNexTechWebhookLog>("nexTech_webhook_logs").createIndex({ ownerUserId: 1, storeId: 1, createdAt: -1 })
  ]);
}

async function ensureSubscriptionPresenceIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoSubscriptionPresenceSettings>("subscription_presence_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoSubscriptionPresenceProduct>("subscription_presence_products").createIndex({ botId: 1, guildId: 1, order: 1, updatedAt: -1 }),
    db.collection<MongoSubscriptionPresenceProduct>("subscription_presence_products").createIndex({ botId: 1, guildId: 1, active: 1, category: 1 }),
    db.collection<MongoSubscriptionPresenceLog>("subscription_presence_logs").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoSubscriptionPresenceLog>("subscription_presence_logs").createIndex({ botId: 1, guildId: 1, saleId: 1 }, { unique: true })
  ]);
}

async function ensureSalesTicketIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoSalesTicketSettings>("salesTicketSettings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoSalesTicketType>("salesTicketTypes").createIndex({ botId: 1, guildId: 1, order: 1, updatedAt: -1 }),
    db.collection<MongoSalesTicketType>("salesTicketTypes").createIndex({ botId: 1, guildId: 1, active: 1, order: 1 }),
    db.collection<MongoSalesTicket>("salesTickets").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoSalesTicket>("salesTickets").createIndex({ botId: 1, guildId: 1, typeId: 1, userId: 1, status: 1 }),
    db.collection<MongoSalesTicket>("salesTickets").createIndex({ botId: 1, guildId: 1, channelId: 1 }),
    db.collection<MongoSalesTicketLog>("salesTicketLogs").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoSalesTicketLog>("salesTicketLogs").createIndex({ botId: 1, guildId: 1, ticketId: 1, createdAt: -1 }),
    db.collection<MongoSalesTicketTranscript>("salesTicketTranscripts").createIndex({ botId: 1, guildId: 1, ticketId: 1 }),
    db.collection<MongoSalesTicketPassword>("salesTicketPasswords").createIndex({ transcriptId: 1 }, { unique: true })
  ]);
}

async function ensurePriceTableIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoPriceTable>("price_tables").createIndex({ botId: 1, guildId: 1, updatedAt: -1 }),
    db.collection<MongoPriceTable>("price_tables").createIndex({ botId: 1, guildId: 1, isActive: 1 }),
    db.collection<MongoPriceTableRequest>("price_table_requests").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoPriceTableRequest>("price_table_requests").createIndex({ botId: 1, tableId: 1, createdAt: -1 }),
    db.collection<MongoPriceTableLog>("price_table_logs").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoPriceTableLog>("price_table_logs").createIndex({ botId: 1, tableId: 1, createdAt: -1 })
  ]);
}

async function ensureManualPaymentIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoManualPaymentSettings>("manual_payment_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoManualPaymentOrder>("manual_payment_orders").createIndex({ botId: 1, guildId: 1, orderNumber: 1 }, { unique: true })
  ]);
  await Promise.all([
    db.collection<MongoManualPaymentOrder>("manual_payment_orders").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoManualPaymentOrder>("manual_payment_orders").createIndex({ botId: 1, guildId: 1, userId: 1, createdAt: -1 }),
    db.collection<MongoManualPaymentOrder>("manual_payment_orders").createIndex({ botId: 1, guildId: 1, status: 1, updatedAt: -1 }),
    db.collection<MongoManualPaymentReceipt>("manual_payment_receipts").createIndex({ botId: 1, guildId: 1, messageId: 1 }, { unique: true }),
    db.collection<MongoManualPaymentReceipt>("manual_payment_receipts").createIndex({ botId: 1, guildId: 1, orderId: 1, submittedAt: -1 }),
    db.collection<MongoManualPaymentOrderLog>("manual_payment_order_logs").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoManualPaymentOrderLog>("manual_payment_order_logs").createIndex({ botId: 1, orderId: 1, createdAt: -1 })
  ]);
}

async function ensureSecurityFeatureAccessIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoSecurityFeatureAccess>("security_feature_access").createIndex(
      { botId: 1, featureKey: 1 },
      { unique: true }
    ),
    db.collection<MongoSecurityFeatureAccess>("security_feature_access").createIndex({
      featureKey: 1,
      enabledByDev: 1,
      updatedAt: -1
    })
  ]);
}

async function ensureSelfBotProtectionIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoSelfBotProtectionSettings>("self_bot_protection_settings").createIndex(
      { botId: 1, guildId: 1 },
      { unique: true }
    ),
    db.collection<MongoSelfBotProtectionSettings>("self_bot_protection_settings").createIndex({
      botId: 1,
      enabled: 1,
      updatedAt: -1
    }),
    db.collection<MongoSelfBotProtectionIncident>("self_bot_protection_incidents").createIndex({
      botId: 1,
      guildId: 1,
      createdAt: -1
    }),
    db.collection<MongoSelfBotProtectionIncident>("self_bot_protection_incidents").createIndex({
      botId: 1,
      guildId: 1,
      moduleId: 1,
      createdAt: -1
    }),
    db.collection<MongoSelfBotProtectionIncident>("self_bot_protection_incidents").createIndex({
      botId: 1,
      guildId: 1,
      userId: 1,
      createdAt: -1
    }),
    db.collection<MongoSelfBotPunishmentState>("self_bot_punishment_states").createIndex(
      {
        botId: 1,
        guildId: 1,
        userId: 1,
        moduleId: 1
      },
      { unique: true }
    ),
    db.collection<MongoSelfBotPunishmentState>("self_bot_punishment_states").createIndex({
      botId: 1,
      guildId: 1,
      updatedAt: -1
    }),
    db.collection<MongoSelfBotRoleAssignment>("self_bot_role_assignments").createIndex(
      {
        botId: 1,
        guildId: 1,
        userId: 1
      },
      { unique: true }
    ),
    db.collection<MongoSelfBotRoleAssignment>("self_bot_role_assignments").createIndex({
      active: 1,
      botId: 1,
      guildId: 1,
      updatedAt: -1
    })
  ]);
}

async function ensureSafeBotWarningIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoSafeBotWarningSettings>("safe_bot_warning_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoSafeBotWarningUser>("safe_bot_warning_users").createIndex({ botId: 1, guildId: 1, userId: 1 }, { unique: true }),
    db.collection<MongoSafeBotWarningUser>("safe_bot_warning_users").createIndex({ botId: 1, guildId: 1, totalWarnings: -1 }),
    db.collection<MongoSafeBotWarningRecord>("safe_bot_warning_records").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoSafeBotWarningRecord>("safe_bot_warning_records").createIndex({ botId: 1, guildId: 1, userId: 1, createdAt: -1 }),
    db.collection<MongoSafeBotWarningRecord>("safe_bot_warning_records").createIndex(
      { botId: 1, guildId: 1, idempotencyKey: 1 },
      { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
    )
  ]);
}

async function ensureTemporaryCallIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoTemporaryCall>("temporary_calls").createIndex({ botId: 1, guildId: 1, ownerId: 1 }, { unique: true }),
    db.collection<MongoTemporaryCall>("temporary_calls").createIndex({ botId: 1, guildId: 1, channelId: 1 }, { unique: true }),
    db.collection<MongoTemporaryCall>("temporary_calls").createIndex({ botId: 1, emptySince: 1 })
  ]);
}

async function ensureAutomatedLogIndexes(db: Db) {
  await db.collection<MongoAutomatedLogSettings>("automated_log_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true });
}

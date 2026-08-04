import { randomUUID } from "node:crypto";
import {
  ensureGuild,
  getMongoCollections,
  type MongoSelfBotProtectionIncident,
  type MongoSelfBotProtectionModuleId,
  type MongoSelfBotProtectionSettings,
  type MongoSelfBotPunishmentStep,
  type MongoSelfBotRoleAssignment,
  type MongoSelfBotPunishmentAction
} from "../database/mongo";

export type SelfBotProtectionModuleId = MongoSelfBotProtectionModuleId;
export type SelfBotPunishmentAction = MongoSelfBotPunishmentAction;

export type PunishmentDurationDto = {
  dias: number;
  horas: number;
  minutos: number;
  segundos: number;
};

export type SelfBotPunishmentStepDto = {
  id: string;
  acao: SelfBotPunishmentAction;
  ativado: boolean;
  limite: number;
  proximaAcao: SelfBotPunishmentAction | null;
  apagarMensagem: boolean;
  enviarAviso: boolean;
  registrarLog: boolean;
  tempoTimeout: PunishmentDurationDto;
  cargoAdicionarId: string | null;
  cargoRemoverId: string | null;
  banApagarMensagensSegundos: number;
};

type SelfBotPunishmentStepInput = Omit<Partial<SelfBotPunishmentStepDto>, "tempoTimeout"> & {
  tempoTimeout?: Partial<PunishmentDurationDto>;
};

export type SelfBotProtectionSettingsDto = {
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
  allowSubdomains: boolean;
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
  punishmentSteps: SelfBotPunishmentStepDto[];
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

export type SelfBotProtectionIncidentDto = {
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

export type SelfBotProtectionStatsDto = {
  blockedSpam: number;
  removedImages: number;
  blockedLinks: number;
  punishedUsers: number;
  infractionsToday: number;
  infractionsWeek: number;
  infractionsMonth: number;
  byModule: Array<{
    moduleId: SelfBotProtectionModuleId;
    total: number;
  }>;
  daily: Array<{
    label: string;
    value: number;
  }>;
};

export type SelfBotProtectionDashboardDto = {
  incidents: SelfBotProtectionIncidentDto[];
  settings: SelfBotProtectionSettingsDto;
  stats: SelfBotProtectionStatsDto;
};

export type SelfBotRoleAssignmentDto = {
  botId: string;
  guildId: string;
  lastIncidentId: string;
  lastPunishedAt: string;
  roleId: string | null;
  userId: string;
  username: string | null;
};

export type SaveSelfBotProtectionSettingsInput = Partial<Omit<
  SelfBotProtectionSettingsDto,
  "id" | "botId" | "guildId" | "createdAt" | "updatedAt" | "moduleToggles" | "punishmentSteps"
>> & {
  moduleToggles?: Partial<Record<SelfBotProtectionModuleId, boolean>>;
  punishmentSteps?: SelfBotPunishmentStepInput[];
};

export type RecordSelfBotProtectionIncidentInput = {
  botId: string;
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
};

export type ResolveSelfBotPunishmentInput = {
  botId: string;
  guildId: string;
  moduleId: SelfBotProtectionModuleId;
  userId: string;
};

export type ResolvedSelfBotPunishmentDto = {
  actionCount: number;
  step: SelfBotPunishmentStepDto;
  totalOccurrences: number;
};

export const SELF_BOT_PROTECTION_MODULES: Array<{
  id: SelfBotProtectionModuleId;
  label: string;
}> = [
  { id: "anti-spam", label: "Anti Spam" },
  { id: "anti-flood", label: "Anti Flood" },
  { id: "anti-imagens", label: "Anti-Spam de Imagens" },
  { id: "anti-gif", label: "Anti GIF" },
  { id: "anti-mencoes", label: "Anti Mencoes" },
  { id: "anti-emojis", label: "Anti Emojis" },
  { id: "anti-convites", label: "Anti Convites" },
  { id: "anti-links", label: "Anti-Flood de Links" },
  { id: "anti-scam", label: "Anti Scam" },
  { id: "anti-raid", label: "Anti Raid" },
  { id: "anti-caps-lock", label: "Anti Caps Lock" },
  { id: "anti-texto-repetido", label: "Anti Texto Repetido" },
  { id: "anti-copypasta", label: "Anti Copypasta" },
  { id: "anti-flood-multi-canais", label: "Anti Flood Multi-Canais" },
  { id: "anti-anexos", label: "Anti Anexos" },
  { id: "anti-webhook", label: "Anti Webhook" },
  { id: "anti-bots", label: "Anti Bots" },
  { id: "anti-contas-novas", label: "Anti Contas Novas" },
  { id: "anti-token-grabber", label: "Anti Token Grabber" },
  { id: "anti-phishing", label: "Anti Phishing" },
  { id: "anti-nitro-scam", label: "Anti Nitro Scam" },
  { id: "anti-mass-ping", label: "Anti Mass Ping" },
  { id: "anti-divulgacao", label: "Anti Divulgacao" },
  { id: "anti-auto-spam", label: "Anti Auto Spam" },
  { id: "anti-comandos-em-massa", label: "Anti Comandos em Massa" }
  ,{ id: "anti-stickers", label: "Anti Stickers" }
  ,{ id: "anti-nome", label: "Anti Nome" }
  ,{ id: "anti-cargos", label: "Anti Cargos" }
  ,{ id: "anti-canais", label: "Anti Canais" }
  ,{ id: "anti-emojis-servidor", label: "Anti Emojis do Servidor" }
];

export const SELF_BOT_PUNISHMENT_ACTIONS: SelfBotPunishmentAction[] = [
  "delete_message",
  "warn",
  "log",
  "add_role",
  "timeout",
  "remove_role",
  "kick",
  "ban"
];

const moduleIds = SELF_BOT_PROTECTION_MODULES.map((module) => module.id);
const moduleIdSet = new Set<SelfBotProtectionModuleId>(moduleIds);
const punishmentActionSet = new Set<SelfBotPunishmentAction>(SELF_BOT_PUNISHMENT_ACTIONS);
const DEFAULT_EMBED_COLOR = "#7c3aed";
const DEFAULT_SUSPICIOUS_DOMAINS = [
  "discord-gift.com",
  "discord-nitro.com",
  "discordnitro",
  "discorcl",
  "dlscord",
  "steamcomminuty",
  "steamcommunlty",
  "robloxgift",
  "mercadopago-pix",
  "pix-premiado"
];
const DEFAULT_BLOCKED_TERMS = [
  "nitro gratis",
  "free nitro",
  "discord gift",
  "steam gift",
  "robux gratis",
  "pix dobrado",
  "mercado pago gratis",
  "token grabber"
];

export function defaultSelfBotProtectionSettings(guildId: string, botId: string): SelfBotProtectionSettingsDto {
  const now = new Date().toISOString();

  return {
    id: "",
    botId,
    guildId,
    enabled: false,
    moduleToggles: defaultSafeBotModuleToggles(),
    ignoredChannelIds: [],
    ignoredUserIds: [],
    ignoredRoleIds: [],
    ignoredBotIds: [],
    ignoredCategoryIds: [],
    protectedChannelIds: [],
    mediaChannelIds: [],
    linkChannelIds: [],
    allowedDomains: ["youtube.com", "youtu.be", "twitch.tv", "kick.com", "github.com"],
    allowSubdomains: true,
    allowedInviteGuildIds: [],
    blockedFileExtensions: ["zip", "rar", "exe", "bat", "js", "html", "dll", "scr", "apk", "msi"],
    blockImages: true,
    blockGifs: true,
    blockVideos: true,
    blockAudio: true,
    logChannelId: null,
    punishmentLogChannelId: null,
    logWebhookUrl: null,
    embedColor: DEFAULT_EMBED_COLOR,
    punishmentSequence: ["delete_message", "log"] as SelfBotPunishmentAction[],
    punishmentSteps: defaultPunishmentSteps(),
    addRoleId: null,
    removeRoleId: null,
    timeoutSeconds: 300,
    floodLimit: 5,
    floodWindowSeconds: 10,
    imageLimit: 3,
    imageWindowSeconds: 15,
    mentionLimit: 5,
    emojiLimit: 12,
    stickerLimit: 3,
    stickerWindowSeconds: 15,
    nicknameChangeLimit: 3,
    nicknameWindowSeconds: 60,
    antiBotAction: "manual",
    raidLockdownEnabled: false,
    dmWarningEnabled: false,
    dmWarningMessage: "Você violou a proteção {proteção} no servidor {servidor}.",
    moduleLogChannelIds: {},
    capsMinLength: 12,
    capsPercentage: 70,
    repeatedTextLimit: 3,
    repeatedTextWindowSeconds: 60,
    multiChannelLimit: 4,
    multiChannelWindowSeconds: 15,
    raidJoinLimit: 8,
    raidWindowSeconds: 30,
    newAccountMaxAgeHours: 72,
    suspiciousDomains: DEFAULT_SUSPICIOUS_DOMAINS,
    blockedTerms: DEFAULT_BLOCKED_TERMS,
    createdAt: now,
    updatedAt: now
  };
}

export async function getSelfBotProtectionDashboard(guildId: string, botId: string): Promise<SelfBotProtectionDashboardDto> {
  const { selfBotProtectionIncidents } = await getMongoCollections();
  const [settings, incidents, stats] = await Promise.all([
    getSelfBotProtectionSettings(guildId, botId),
    selfBotProtectionIncidents
      .find({ botId, guildId })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray(),
    getSelfBotProtectionStats(guildId, botId)
  ]);

  return {
    incidents: incidents.map(toIncidentDto),
    settings,
    stats
  };
}

export async function getSelfBotProtectionSettings(guildId: string, botId: string) {
  const { selfBotProtectionSettings } = await getMongoCollections();
  const settings = await selfBotProtectionSettings.findOne({ botId, guildId });

  return settings ? toSettingsDto(settings) : defaultSelfBotProtectionSettings(guildId, botId);
}

export async function getSelfBotRoleAssignments(
  guildId: string,
  botId: string,
  limit = 500
): Promise<SelfBotRoleAssignmentDto[]> {
  const { selfBotRoleAssignments } = await getMongoCollections();
  const assignments = await selfBotRoleAssignments
    .find({
      active: true,
      botId,
      guildId
    })
    .sort({ updatedAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 1000))
    .toArray();

  return assignments.map(toRoleAssignmentDto);
}

export async function saveSelfBotProtectionSettings(
  guildId: string,
  botId: string,
  input: SaveSelfBotProtectionSettingsInput,
  actorId: string | null
) {
  const current = await getSelfBotProtectionSettings(guildId, botId);
  const now = new Date();
  const next = normalizeSettings({
    ...current,
    ...input,
    botId,
    guildId,
    moduleToggles: {
      ...current.moduleToggles,
      ...(input.moduleToggles ?? {})
    },
    punishmentSteps: normalizePunishmentSteps(input.punishmentSteps ?? current.punishmentSteps)
  });

  await ensureGuild(guildId);
  const { selfBotProtectionSettings } = await getMongoCollections();
  await selfBotProtectionSettings.updateOne(
    { botId, guildId },
    {
      $set: {
        botId,
        guildId,
        enabled: next.enabled,
        moduleToggles: next.moduleToggles,
        ignoredChannelIds: next.ignoredChannelIds,
        ignoredUserIds: next.ignoredUserIds,
        ignoredRoleIds: next.ignoredRoleIds,
        ignoredBotIds: next.ignoredBotIds,
        ignoredCategoryIds: next.ignoredCategoryIds,
        protectedChannelIds: next.protectedChannelIds,
        mediaChannelIds: next.mediaChannelIds,
        linkChannelIds: next.linkChannelIds,
        allowedDomains: next.allowedDomains,
        allowSubdomains: next.allowSubdomains,
        allowedInviteGuildIds: next.allowedInviteGuildIds,
        blockedFileExtensions: next.blockedFileExtensions,
        blockImages: next.blockImages,
        blockGifs: next.blockGifs,
        blockVideos: next.blockVideos,
        blockAudio: next.blockAudio,
        logChannelId: next.logChannelId,
        punishmentLogChannelId: next.punishmentLogChannelId,
        logWebhookUrl: next.logWebhookUrl,
        embedColor: next.embedColor,
        punishmentSequence: next.punishmentSequence,
        punishmentSteps: toMongoPunishmentSteps(next.punishmentSteps),
        addRoleId: next.addRoleId,
        removeRoleId: next.removeRoleId,
        timeoutSeconds: next.timeoutSeconds,
        floodLimit: next.floodLimit,
        floodWindowSeconds: next.floodWindowSeconds,
        imageLimit: next.imageLimit,
        imageWindowSeconds: next.imageWindowSeconds,
        mentionLimit: next.mentionLimit,
        emojiLimit: next.emojiLimit,
        stickerLimit: next.stickerLimit,
        stickerWindowSeconds: next.stickerWindowSeconds,
        nicknameChangeLimit: next.nicknameChangeLimit,
        nicknameWindowSeconds: next.nicknameWindowSeconds,
        antiBotAction: next.antiBotAction,
        raidLockdownEnabled: next.raidLockdownEnabled,
        dmWarningEnabled: next.dmWarningEnabled,
        dmWarningMessage: next.dmWarningMessage,
        moduleLogChannelIds: next.moduleLogChannelIds,
        capsMinLength: next.capsMinLength,
        capsPercentage: next.capsPercentage,
        repeatedTextLimit: next.repeatedTextLimit,
        repeatedTextWindowSeconds: next.repeatedTextWindowSeconds,
        multiChannelLimit: next.multiChannelLimit,
        multiChannelWindowSeconds: next.multiChannelWindowSeconds,
        raidJoinLimit: next.raidJoinLimit,
        raidWindowSeconds: next.raidWindowSeconds,
        newAccountMaxAgeHours: next.newAccountMaxAgeHours,
        suspiciousDomains: next.suspiciousDomains,
        blockedTerms: next.blockedTerms,
        updatedBy: actorId,
        updatedAt: now
      },
      $setOnInsert: {
        _id: randomUUID(),
        createdBy: actorId,
        createdAt: now
      }
    },
    { upsert: true }
  );

  return getSelfBotProtectionSettings(guildId, botId);
}

export async function resolveSelfBotPunishment(
  input: ResolveSelfBotPunishmentInput
): Promise<ResolvedSelfBotPunishmentDto> {
  const settings = await getSelfBotProtectionSettings(input.guildId, input.botId);
  const steps = settings.punishmentSteps.length
    ? settings.punishmentSteps.filter((step) => step.ativado)
    : sequenceToPunishmentSteps(settings.punishmentSequence, settings);
  const fallback = steps[0] ?? defaultPunishmentSteps()[0]!;
  const { selfBotPunishmentStates } = await getMongoCollections();
  const now = new Date();
  const current = await selfBotPunishmentStates.findOne({
    botId: input.botId,
    guildId: input.guildId,
    moduleId: input.moduleId,
    userId: input.userId
  });
  const currentStepIndex = resolveCurrentStepIndex(steps, current, fallback);
  const currentStep = steps[currentStepIndex] ?? fallback;
  const actionCount = (current?.actionCount ?? 0) + 1;
  const limit = Math.max(1, currentStep.limite);
  const nextStep = actionCount > limit
    ? resolveNextStep(steps, currentStep, currentStepIndex)
    : currentStep;
  const nextActionCount = actionCount > limit ? 1 : actionCount;
  const nextStepIndex = Math.max(0, steps.findIndex((step) => step.id === nextStep.id));
  const totalOccurrences = (current?.totalOccurrences ?? 0) + 1;

  await selfBotPunishmentStates.updateOne(
    {
      botId: input.botId,
      guildId: input.guildId,
      moduleId: input.moduleId,
      userId: input.userId
    },
    {
      $set: {
        botId: input.botId,
        guildId: input.guildId,
        userId: input.userId,
        moduleId: input.moduleId,
        currentAction: nextStep.acao,
        currentStepId: nextStep.id,
        currentStepIndex: nextStepIndex,
        actionCount: nextActionCount,
        totalOccurrences,
        lastPunishmentActions: [nextStep.acao],
        lastInfractionAt: now,
        updatedAt: now
      },
      $setOnInsert: {
        _id: randomUUID(),
        createdAt: now
      }
    },
    { upsert: true }
  );

  return {
    actionCount: nextActionCount,
    step: nextStep,
    totalOccurrences
  };
}

export async function recordSelfBotProtectionIncident(input: RecordSelfBotProtectionIncidentInput) {
  const { selfBotProtectionIncidents } = await getMongoCollections();
  const now = new Date();
  const incident: MongoSelfBotProtectionIncident = {
    _id: randomUUID(),
    botId: input.botId,
    guildId: input.guildId,
    userId: input.userId,
    username: normalizeText(input.username, 120),
    channelId: normalizeSnowflake(input.channelId),
    messageId: normalizeSnowflake(input.messageId),
    messageContent: normalizeText(input.messageContent, 1900),
    moduleId: moduleIdSet.has(input.moduleId) ? input.moduleId : "anti-spam",
    infractionType: normalizeText(input.infractionType, 120) ?? input.moduleId,
    punishmentActions: normalizePunishmentSequence(input.punishmentActions),
    punishmentSucceeded: input.punishmentSucceeded,
    punishmentError: normalizeText(input.punishmentError, 500),
    metadata: input.metadata ?? {},
    createdAt: now
  };

  await selfBotProtectionIncidents.insertOne(incident);
  await persistRoleAssignmentFromIncident(incident);

  return toIncidentDto(incident);
}

function resolveCurrentStepIndex(
  steps: SelfBotPunishmentStepDto[],
  current: { currentAction?: SelfBotPunishmentAction; currentStepId?: string | null; currentStepIndex?: number | null } | null,
  fallback: SelfBotPunishmentStepDto
) {
  if (!steps.length) {
    return 0;
  }

  if (Number.isInteger(current?.currentStepIndex)) {
    const byIndex = Number(current?.currentStepIndex);
    if (byIndex >= 0 && byIndex < steps.length) {
      if (!current?.currentStepId || steps[byIndex]?.id === current.currentStepId) {
        return byIndex;
      }
    }
  }

  if (current?.currentStepId) {
    const byId = steps.findIndex((step) => step.id === current.currentStepId);
    if (byId >= 0) {
      return byId;
    }
  }

  if (Number.isInteger(current?.currentStepIndex)) {
    const byIndex = Number(current?.currentStepIndex);
    if (byIndex >= 0 && byIndex < steps.length) {
      return byIndex;
    }
  }

  if (current?.currentAction) {
    const byLegacyAction = steps.findIndex((step) => step.acao === current.currentAction);
    if (byLegacyAction >= 0) {
      return byLegacyAction;
    }
  }

  return Math.max(0, steps.findIndex((step) => step.id === fallback.id));
}

function resolveNextStep(
  steps: SelfBotPunishmentStepDto[],
  currentStep: SelfBotPunishmentStepDto,
  currentStepIndex: number
) {
  if (!currentStep.proximaAcao) {
    return currentStep;
  }

  return steps.find((step, index) => index > currentStepIndex && step.acao === currentStep.proximaAcao)
    ?? steps.find((step) => step.acao === currentStep.proximaAcao)
    ?? currentStep;
}

export async function getSelfBotProtectionStats(guildId: string, botId: string): Promise<SelfBotProtectionStatsDto> {
  const { selfBotProtectionIncidents } = await getMongoCollections();
  const now = new Date();
  const todayStart = startOfDay(now);
  const weekStart = new Date(now.getTime() - 7 * 86_400_000);
  const monthStart = new Date(now.getTime() - 30 * 86_400_000);
  const baseQuery = { botId, guildId };
  const [
    infractionsToday,
    infractionsWeek,
    infractionsMonth,
    blockedSpam,
    removedImages,
    blockedLinks,
    punishedUsers,
    byModule,
    daily
  ] = await Promise.all([
    selfBotProtectionIncidents.countDocuments({ ...baseQuery, createdAt: { $gte: todayStart } }),
    selfBotProtectionIncidents.countDocuments({ ...baseQuery, createdAt: { $gte: weekStart } }),
    selfBotProtectionIncidents.countDocuments({ ...baseQuery, createdAt: { $gte: monthStart } }),
    selfBotProtectionIncidents.countDocuments({
      ...baseQuery,
      moduleId: { $in: ["anti-spam", "anti-flood", "anti-texto-repetido", "anti-copypasta", "anti-auto-spam", "anti-flood-multi-canais"] }
    }),
    selfBotProtectionIncidents.countDocuments({
      ...baseQuery,
      moduleId: { $in: ["anti-imagens", "anti-gif", "anti-anexos"] }
    }),
    selfBotProtectionIncidents.countDocuments({
      ...baseQuery,
      moduleId: { $in: ["anti-links", "anti-convites", "anti-divulgacao", "anti-scam", "anti-phishing", "anti-token-grabber", "anti-nitro-scam"] }
    }),
    selfBotProtectionIncidents.distinct("userId", baseQuery),
    selfBotProtectionIncidents.aggregate<{ _id: SelfBotProtectionModuleId; total: number }>([
      { $match: baseQuery },
      { $group: { _id: "$moduleId", total: { $sum: 1 } } },
      { $sort: { total: -1 } },
      { $limit: 12 }
    ]).toArray(),
    selfBotProtectionIncidents.aggregate<{ _id: string; total: number }>([
      { $match: { ...baseQuery, createdAt: { $gte: weekStart } } },
      {
        $group: {
          _id: {
            $dateToString: {
              date: "$createdAt",
              format: "%d/%m",
              timezone: "America/Sao_Paulo"
            }
          },
          total: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]).toArray()
  ]);

  return {
    blockedSpam,
    removedImages,
    blockedLinks,
    punishedUsers: punishedUsers.length,
    infractionsToday,
    infractionsWeek,
    infractionsMonth,
    byModule: byModule.map((entry) => ({
      moduleId: entry._id,
      total: entry.total
    })),
    daily: daily.map((entry) => ({
      label: entry._id,
      value: entry.total
    }))
  };
}

function toSettingsDto(settings: MongoSelfBotProtectionSettings): SelfBotProtectionSettingsDto {
  return normalizeSettings({
    id: settings._id,
    botId: settings.botId,
    guildId: settings.guildId,
    enabled: settings.enabled,
    moduleToggles: {
      ...emptyModuleToggles(),
      ...(settings.moduleToggles ?? {})
    },
    ignoredChannelIds: settings.ignoredChannelIds ?? [],
    ignoredUserIds: settings.ignoredUserIds ?? [],
    ignoredRoleIds: settings.ignoredRoleIds ?? [],
    ignoredBotIds: settings.ignoredBotIds ?? [],
    ignoredCategoryIds: settings.ignoredCategoryIds ?? [],
    protectedChannelIds: settings.protectedChannelIds ?? [],
    mediaChannelIds: settings.mediaChannelIds ?? [],
    linkChannelIds: settings.linkChannelIds ?? [],
    allowedDomains: settings.allowedDomains ?? [],
    allowSubdomains: settings.allowSubdomains ?? true,
    allowedInviteGuildIds: settings.allowedInviteGuildIds ?? [],
    blockedFileExtensions: settings.blockedFileExtensions ?? [],
    blockImages: settings.blockImages ?? true,
    blockGifs: settings.blockGifs ?? true,
    blockVideos: settings.blockVideos ?? true,
    blockAudio: settings.blockAudio ?? true,
    logChannelId: settings.logChannelId,
    punishmentLogChannelId: settings.punishmentLogChannelId ?? null,
    logWebhookUrl: settings.logWebhookUrl,
    embedColor: settings.embedColor,
    punishmentSequence: settings.punishmentSequence ?? [],
    punishmentSteps: settings.punishmentSteps ? fromMongoPunishmentSteps(settings.punishmentSteps) : [],
    addRoleId: settings.addRoleId,
    removeRoleId: settings.removeRoleId,
    timeoutSeconds: settings.timeoutSeconds,
    floodLimit: settings.floodLimit,
    floodWindowSeconds: settings.floodWindowSeconds,
    imageLimit: settings.imageLimit,
    imageWindowSeconds: settings.imageWindowSeconds,
    mentionLimit: settings.mentionLimit,
    emojiLimit: settings.emojiLimit,
    stickerLimit: settings.stickerLimit ?? 3,
    stickerWindowSeconds: settings.stickerWindowSeconds ?? 15,
    nicknameChangeLimit: settings.nicknameChangeLimit ?? 3,
    nicknameWindowSeconds: settings.nicknameWindowSeconds ?? 60,
    antiBotAction: settings.antiBotAction ?? "manual",
    raidLockdownEnabled: settings.raidLockdownEnabled ?? false,
    dmWarningEnabled: settings.dmWarningEnabled ?? false,
    dmWarningMessage: settings.dmWarningMessage ?? "",
    moduleLogChannelIds: settings.moduleLogChannelIds ?? {},
    capsMinLength: settings.capsMinLength,
    capsPercentage: settings.capsPercentage,
    repeatedTextLimit: settings.repeatedTextLimit,
    repeatedTextWindowSeconds: settings.repeatedTextWindowSeconds,
    multiChannelLimit: settings.multiChannelLimit,
    multiChannelWindowSeconds: settings.multiChannelWindowSeconds,
    raidJoinLimit: settings.raidJoinLimit,
    raidWindowSeconds: settings.raidWindowSeconds,
    newAccountMaxAgeHours: settings.newAccountMaxAgeHours,
    suspiciousDomains: settings.suspiciousDomains ?? [],
    blockedTerms: settings.blockedTerms ?? [],
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString()
  });
}

function toIncidentDto(incident: MongoSelfBotProtectionIncident): SelfBotProtectionIncidentDto {
  return {
    id: incident._id,
    botId: incident.botId,
    guildId: incident.guildId,
    userId: incident.userId,
    username: incident.username,
    channelId: incident.channelId,
    messageId: incident.messageId,
    messageContent: incident.messageContent,
    moduleId: incident.moduleId,
    infractionType: incident.infractionType,
    punishmentActions: incident.punishmentActions ?? [],
    punishmentSucceeded: incident.punishmentSucceeded,
    punishmentError: incident.punishmentError,
    metadata: incident.metadata ?? {},
    createdAt: incident.createdAt.toISOString()
  };
}

function toRoleAssignmentDto(assignment: MongoSelfBotRoleAssignment): SelfBotRoleAssignmentDto {
  return {
    botId: assignment.botId,
    guildId: assignment.guildId,
    lastIncidentId: assignment.lastIncidentId,
    lastPunishedAt: assignment.lastPunishedAt.toISOString(),
    roleId: assignment.roleId,
    userId: assignment.userId,
    username: assignment.username
  };
}

async function persistRoleAssignmentFromIncident(incident: MongoSelfBotProtectionIncident) {
  if (!incident.punishmentActions.includes("add_role")) {
    return;
  }

  const roleId = readMetadataSnowflake(incident.metadata, "punishmentRoleId")
    ?? readMetadataSnowflake(incident.metadata, "roleId");
  const { selfBotRoleAssignments } = await getMongoCollections();
  const now = new Date();

  await selfBotRoleAssignments.updateOne(
    {
      botId: incident.botId,
      guildId: incident.guildId,
      userId: incident.userId
    },
    {
      $set: {
        active: true,
        botId: incident.botId,
        guildId: incident.guildId,
        lastIncidentId: incident._id,
        lastPunishedAt: incident.createdAt,
        roleId,
        userId: incident.userId,
        username: incident.username,
        updatedAt: now
      },
      $setOnInsert: {
        _id: randomUUID(),
        createdAt: now
      }
    },
    { upsert: true }
  );
}

async function getLegacySelfBotRoleAssignments(
  guildId: string,
  botId: string,
  limit: number
): Promise<SelfBotRoleAssignmentDto[]> {
  const { selfBotProtectionIncidents } = await getMongoCollections();
  const assignments = await selfBotProtectionIncidents
    .aggregate<{
      _id: string;
      botId: string;
      guildId: string;
      lastIncidentId: string;
      lastPunishedAt: Date;
      roleId?: string | null;
      username: string | null;
    }>([
      {
        $match: {
          botId,
          guildId,
          punishmentActions: "add_role"
        }
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$userId",
          botId: { $first: "$botId" },
          guildId: { $first: "$guildId" },
          lastIncidentId: { $first: "$_id" },
          lastPunishedAt: { $first: "$createdAt" },
          roleId: {
            $first: {
              $ifNull: ["$metadata.punishmentRoleId", "$metadata.roleId"]
            }
          },
          username: { $first: "$username" }
        }
      },
      { $limit: Math.min(Math.max(limit, 1), 1000) }
    ])
    .toArray();

  return assignments.map((assignment) => ({
    botId: assignment.botId,
    guildId: assignment.guildId,
    lastIncidentId: assignment.lastIncidentId,
    lastPunishedAt: assignment.lastPunishedAt.toISOString(),
    roleId: normalizeSnowflake(assignment.roleId),
    userId: assignment._id,
    username: assignment.username
  }));
}

function normalizeSettings(settings: SelfBotProtectionSettingsDto): SelfBotProtectionSettingsDto {
  const defaults = defaultSelfBotProtectionSettings(settings.guildId, settings.botId);

  return {
    ...defaults,
    ...settings,
    moduleToggles: normalizeModuleToggles(settings.moduleToggles),
    ignoredChannelIds: normalizeSnowflakes(settings.ignoredChannelIds),
    ignoredUserIds: normalizeSnowflakes(settings.ignoredUserIds),
    ignoredRoleIds: normalizeSnowflakes(settings.ignoredRoleIds),
    ignoredBotIds: normalizeSnowflakes(settings.ignoredBotIds),
    ignoredCategoryIds: normalizeSnowflakes(settings.ignoredCategoryIds),
    protectedChannelIds: normalizeSnowflakes(settings.protectedChannelIds),
    mediaChannelIds: normalizeSnowflakes(settings.mediaChannelIds),
    linkChannelIds: normalizeSnowflakes(settings.linkChannelIds),
    allowedDomains: normalizeDomainList(settings.allowedDomains),
    allowSubdomains: settings.allowSubdomains !== false,
    allowedInviteGuildIds: normalizeSnowflakes(settings.allowedInviteGuildIds),
    blockedFileExtensions: normalizeExtensionList(settings.blockedFileExtensions),
    blockImages: settings.blockImages !== false,
    blockGifs: settings.blockGifs !== false,
    blockVideos: settings.blockVideos !== false,
    blockAudio: settings.blockAudio !== false,
    logChannelId: normalizeSnowflake(settings.logChannelId),
    punishmentLogChannelId: normalizeSnowflake(settings.punishmentLogChannelId),
    logWebhookUrl: normalizeWebhookUrl(settings.logWebhookUrl),
    embedColor: normalizeColor(settings.embedColor),
    punishmentSequence: normalizePunishmentSequence(settings.punishmentSequence),
    punishmentSteps: normalizePunishmentSteps(
      settings.punishmentSteps?.length
        ? settings.punishmentSteps
        : sequenceToPunishmentSteps(settings.punishmentSequence, settings)
    ),
    addRoleId: normalizeSnowflake(settings.addRoleId),
    removeRoleId: normalizeSnowflake(settings.removeRoleId),
    timeoutSeconds: clampInteger(settings.timeoutSeconds, 5, 2_419_200, defaults.timeoutSeconds),
    floodLimit: clampInteger(settings.floodLimit, 2, 50, defaults.floodLimit),
    floodWindowSeconds: clampInteger(settings.floodWindowSeconds, 1, 3_600, defaults.floodWindowSeconds),
    imageLimit: clampInteger(settings.imageLimit, 1, 50, defaults.imageLimit),
    imageWindowSeconds: clampInteger(settings.imageWindowSeconds, 1, 3_600, defaults.imageWindowSeconds),
    mentionLimit: clampInteger(settings.mentionLimit, 1, 100, defaults.mentionLimit),
    emojiLimit: clampInteger(settings.emojiLimit, 1, 200, defaults.emojiLimit),
    stickerLimit: clampInteger(settings.stickerLimit, 1, 50, defaults.stickerLimit),
    stickerWindowSeconds: clampInteger(settings.stickerWindowSeconds, 1, 3_600, defaults.stickerWindowSeconds),
    nicknameChangeLimit: clampInteger(settings.nicknameChangeLimit, 1, 50, defaults.nicknameChangeLimit),
    nicknameWindowSeconds: clampInteger(settings.nicknameWindowSeconds, 1, 3_600, defaults.nicknameWindowSeconds),
    antiBotAction: ["allow", "kick", "ban", "manual"].includes(settings.antiBotAction) ? settings.antiBotAction : defaults.antiBotAction,
    raidLockdownEnabled: settings.raidLockdownEnabled === true,
    dmWarningEnabled: false,
    dmWarningMessage: "",
    moduleLogChannelIds: normalizeModuleLogChannels(settings.moduleLogChannelIds),
    capsMinLength: clampInteger(settings.capsMinLength, 4, 500, defaults.capsMinLength),
    capsPercentage: clampInteger(settings.capsPercentage, 40, 100, defaults.capsPercentage),
    repeatedTextLimit: clampInteger(settings.repeatedTextLimit, 2, 25, defaults.repeatedTextLimit),
    repeatedTextWindowSeconds: clampInteger(settings.repeatedTextWindowSeconds, 1, 3_600, defaults.repeatedTextWindowSeconds),
    multiChannelLimit: clampInteger(settings.multiChannelLimit, 2, 100, defaults.multiChannelLimit),
    multiChannelWindowSeconds: clampInteger(settings.multiChannelWindowSeconds, 1, 3_600, defaults.multiChannelWindowSeconds),
    raidJoinLimit: clampInteger(settings.raidJoinLimit, 2, 500, defaults.raidJoinLimit),
    raidWindowSeconds: clampInteger(settings.raidWindowSeconds, 5, 3_600, defaults.raidWindowSeconds),
    newAccountMaxAgeHours: clampInteger(settings.newAccountMaxAgeHours, 1, 87_600, defaults.newAccountMaxAgeHours),
    suspiciousDomains: normalizeTextList(settings.suspiciousDomains, 250),
    blockedTerms: normalizeTextList(settings.blockedTerms, 250)
  };
}

function emptyModuleToggles(): Record<SelfBotProtectionModuleId, boolean> {
  return Object.fromEntries(moduleIds.map((moduleId) => [moduleId, false])) as Record<SelfBotProtectionModuleId, boolean>;
}

function defaultSafeBotModuleToggles(): Record<SelfBotProtectionModuleId, boolean> {
  return {
    ...emptyModuleToggles(),
    "anti-anexos": true,
    "anti-auto-spam": true,
    "anti-convites": true,
    "anti-flood": true,
    "anti-flood-multi-canais": true,
    "anti-gif": true,
    "anti-imagens": true,
    "anti-links": true,
    "anti-mencoes": true,
    "anti-spam": true,
    "anti-texto-repetido": true
  };
}

function normalizeModuleToggles(value: Partial<Record<SelfBotProtectionModuleId, boolean>> | undefined) {
  const normalized = emptyModuleToggles();

  for (const [moduleId, enabled] of Object.entries(value ?? {})) {
    if (moduleIdSet.has(moduleId as SelfBotProtectionModuleId)) {
      normalized[moduleId as SelfBotProtectionModuleId] = enabled === true;
    }
  }

  return normalized;
}

function normalizePunishmentSequence(value: readonly string[]) {
  const normalized = value.filter((action): action is SelfBotPunishmentAction => punishmentActionSet.has(action as SelfBotPunishmentAction));
  return normalized.length ? [...new Set(normalized)] : ["delete_message", "log"] as SelfBotPunishmentAction[];
}

function defaultPunishmentSteps(): SelfBotPunishmentStepDto[] {
  return [
    buildPunishmentStep("delete_message", 2, "warn", { apagarMensagem: true }),
    buildPunishmentStep("warn", 1, "timeout", { enviarAviso: true }),
    buildPunishmentStep("timeout", 2, "add_role", { tempoTimeout: { dias: 0, horas: 0, minutos: 5, segundos: 0 } }),
    buildPunishmentStep("add_role", 1, "kick"),
    buildPunishmentStep("kick", 1, "ban"),
    buildPunishmentStep("ban", 1, null)
  ];
}

function buildPunishmentStep(
  acao: SelfBotPunishmentAction,
  limite: number,
  proximaAcao: SelfBotPunishmentAction | null,
  overrides: Partial<SelfBotPunishmentStepDto> = {}
): SelfBotPunishmentStepDto {
  return {
    id: acao,
    acao,
    ativado: true,
    limite,
    proximaAcao,
    apagarMensagem: acao === "delete_message",
    enviarAviso: acao === "warn",
    registrarLog: true,
    tempoTimeout: { dias: 0, horas: 0, minutos: 5, segundos: 0 },
    cargoAdicionarId: null,
    cargoRemoverId: null,
    banApagarMensagensSegundos: 3_600,
    ...overrides
  };
}

function sequenceToPunishmentSteps(
  sequence: readonly SelfBotPunishmentAction[] | undefined,
  settings: Pick<SelfBotProtectionSettingsDto, "addRoleId" | "removeRoleId" | "timeoutSeconds">
) {
  const normalized = normalizePunishmentSequence(sequence ?? []);
  return normalized.map((action, index) => {
    const step = buildPunishmentStep(action, 1, normalized[index + 1] ?? null);
    if (action === "timeout") {
      step.tempoTimeout = secondsToDuration(settings.timeoutSeconds);
    }
    if (action === "add_role") {
      step.cargoAdicionarId = settings.addRoleId;
    }
    if (action === "remove_role") {
      step.cargoRemoverId = settings.removeRoleId;
    }
    return step;
  });
}

function normalizePunishmentSteps(value: readonly SelfBotPunishmentStepInput[]) {
  const normalized = value
    .map((step, index) => normalizePunishmentStep(step, index))
    .filter((step): step is SelfBotPunishmentStepDto => Boolean(step));
  return normalized.length ? normalized.slice(0, 12) : defaultPunishmentSteps();
}

function normalizePunishmentStep(step: SelfBotPunishmentStepInput, index: number): SelfBotPunishmentStepDto | null {
  if (!punishmentActionSet.has(step.acao as SelfBotPunishmentAction)) {
    return null;
  }

  const acao = step.acao as SelfBotPunishmentAction;
  return {
    id: normalizeText(step.id, 80) ?? `${acao}-${index}`,
    acao,
    ativado: step.ativado !== false,
    limite: clampInteger(step.limite, 1, 100, 1),
    proximaAcao: punishmentActionSet.has(step.proximaAcao as SelfBotPunishmentAction) ? step.proximaAcao as SelfBotPunishmentAction : null,
    apagarMensagem: step.apagarMensagem === true || acao === "delete_message",
    enviarAviso: step.enviarAviso === true || acao === "warn",
    registrarLog: step.registrarLog !== false,
    tempoTimeout: normalizeDuration(step.tempoTimeout),
    cargoAdicionarId: normalizeSnowflake(step.cargoAdicionarId),
    cargoRemoverId: normalizeSnowflake(step.cargoRemoverId),
    banApagarMensagensSegundos: clampInteger(step.banApagarMensagensSegundos, 0, 604_800, 3_600)
  };
}

function normalizeDuration(value: Partial<PunishmentDurationDto> | undefined): PunishmentDurationDto {
  return {
    dias: clampInteger(value?.dias, 0, 28, 0),
    horas: clampInteger(value?.horas, 0, 23, 0),
    minutos: clampInteger(value?.minutos, 0, 59, 5),
    segundos: clampInteger(value?.segundos, 0, 59, 0)
  };
}

function secondsToDuration(totalSeconds: number): PunishmentDurationDto {
  let remaining = clampInteger(totalSeconds, 1, 2_419_200, 300);
  const dias = Math.floor(remaining / 86_400);
  remaining -= dias * 86_400;
  const horas = Math.floor(remaining / 3_600);
  remaining -= horas * 3_600;
  const minutos = Math.floor(remaining / 60);
  const segundos = remaining - minutos * 60;
  return { dias, horas, minutos, segundos };
}

function fromMongoPunishmentSteps(steps: MongoSelfBotPunishmentStep[]) {
  return normalizePunishmentSteps(steps.map((step) => ({
    id: step.id,
    acao: step.action,
    ativado: step.enabled,
    limite: step.limit,
    proximaAcao: step.nextAction,
    apagarMensagem: step.deleteMessage,
    enviarAviso: step.sendWarning,
    registrarLog: step.registerLog,
    tempoTimeout: step.timeoutDuration ? {
      dias: step.timeoutDuration.days,
      horas: step.timeoutDuration.hours,
      minutos: step.timeoutDuration.minutes,
      segundos: step.timeoutDuration.seconds
    } : undefined,
    cargoAdicionarId: step.addRoleId,
    cargoRemoverId: step.removeRoleId,
    banApagarMensagensSegundos: step.banDeleteMessageSeconds
  })));
}

function toMongoPunishmentSteps(steps: SelfBotPunishmentStepDto[]): MongoSelfBotPunishmentStep[] {
  return normalizePunishmentSteps(steps).map((step) => ({
    id: step.id,
    action: step.acao,
    enabled: step.ativado,
    limit: step.limite,
    nextAction: step.proximaAcao,
    deleteMessage: step.apagarMensagem,
    sendWarning: step.enviarAviso,
    registerLog: step.registrarLog,
    timeoutDuration: {
      days: step.tempoTimeout.dias,
      hours: step.tempoTimeout.horas,
      minutes: step.tempoTimeout.minutos,
      seconds: step.tempoTimeout.segundos
    },
    addRoleId: step.cargoAdicionarId,
    removeRoleId: step.cargoRemoverId,
    banDeleteMessageSeconds: step.banApagarMensagensSegundos
  }));
}

function normalizeSnowflakes(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter((value) => /^\d{5,32}$/.test(value)))];
}

function normalizeSnowflake(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && /^\d{5,32}$/.test(normalized) ? normalized : null;
}

function readMetadataSnowflake(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" ? normalizeSnowflake(value) : null;
}

function normalizeText(value: string | null | undefined, maxLength: number) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeTextList(values: string[], maxItems: number) {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))].slice(0, maxItems);
}

function normalizeDomainList(values: string[]) {
  return normalizeTextList(values, 250)
    .map((value) => value.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "")
    .filter((value) => /^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(value));
}

function normalizeExtensionList(values: string[]) {
  return normalizeTextList(values, 100)
    .map((value) => value.replace(/^\.+/, ""))
    .filter((value) => /^[a-z0-9]{1,12}$/.test(value));
}

function normalizeModuleLogChannels(value: Partial<Record<SelfBotProtectionModuleId, string>>) {
  const result: Partial<Record<SelfBotProtectionModuleId, string>> = {};
  for (const [moduleId, channelId] of Object.entries(value ?? {})) {
    const normalized = normalizeSnowflake(channelId);
    if (moduleIdSet.has(moduleId as SelfBotProtectionModuleId) && normalized) {
      result[moduleId as SelfBotProtectionModuleId] = normalized;
    }
  }
  return result;
}

function normalizeWebhookUrl(value: string | null | undefined) {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  return /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d{5,32}\/[-_a-zA-Z0-9]+/.test(normalized)
    ? normalized.slice(0, 500)
    : null;
}

function normalizeColor(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toLowerCase() : DEFAULT_EMBED_COLOR;
}

function clampInteger(value: number | null | undefined, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(Number(value))));
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

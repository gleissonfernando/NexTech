import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { areGuildRoles, getGuildLiveOptions, isGuildTextChannel, validateGuildPanelChannel } from "../services/discordOptionsService";
import { canReadDevBotModule, canUseDevBotModule, getBotApiPermissions, getDevBotToken } from "../services/devBotService";
import {
  deleteMissionToolsToken,
  getMissionToolsDashboard,
  getMissionToolsSettings,
  getMissionToolsUserPanel,
  listActiveMissionToolsSettings,
  markMissionToolsTokenAuthFailure,
  requestMissionToolsPanelPublish,
  saveMissionToolsSettings,
  saveMissionToolsUserPanel,
  updateMissionToolsPanelMessageState
} from "../services/missionToolsService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import type { AuthSessionUser } from "../types/session";

const MODULE_ID = "mission-tools";
const guildIdSchema = z.string().regex(/^\d{5,32}$/);
const snowflakeSchema = z.string().regex(/^\d{5,32}$/);
const optionalSnowflakeSchema = z.union([snowflakeSchema, z.literal(""), z.null()]).optional();
const statusSchema = z.enum(["active", "inactive", "deactivated", "waiting", "running", "completed", "error"]);
const voiceStatusSchema = z.enum(["connected", "disconnected", "reconnecting"]);
const richPresenceStatusSchema = z.enum(["active", "inactive"]);
const clearModeSchema = z.enum(["bulk", "userDm"]);
const featureSchema = z.enum(["mission", "clear", "voice", "rich-presence", "username-checker"]);
const activityTypeSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(5)]);

const settingsSchema = z.object({
  allowedRoleIds: z.array(snowflakeSchema).max(100).optional(),
  enabled: z.boolean().optional(),
  enabledFeatures: z.array(featureSchema).max(5).optional(),
  logChannelId: optionalSnowflakeSchema,
  managerRoleIds: z.array(snowflakeSchema).max(100).optional(),
  panelChannelId: optionalSnowflakeSchema
});

const botPanelStateSchema = z.object({
  guildId: guildIdSchema,
  messageId: optionalSnowflakeSchema
});

const userPatchSchema = z.object({
  username: z.string().max(120).nullable().optional(),
  dmChannelId: optionalSnowflakeSchema,
  clearMessageId: optionalSnowflakeSchema,
  missionMessageId: optionalSnowflakeSchema,
  voiceMessageId: optionalSnowflakeSchema,
  richPresenceMessageId: optionalSnowflakeSchema,
  usernameCheckerMessageId: optionalSnowflakeSchema,
  tokenConfigured: z.boolean().optional(),
  clearStatus: statusSchema.optional(),
  clearMode: clearModeSchema.optional(),
  clearTargetUserId: optionalSnowflakeSchema,
  missionStatus: statusSchema.optional(),
  voiceStatus: voiceStatusSchema.optional(),
  richPresenceStatus: richPresenceStatusSchema.optional(),
  usernameCheckerStatus: statusSchema.optional(),
  currentMission: z.string().max(256).nullable().optional(),
  missionDetail: z.string().max(1000).nullable().optional(),
  voiceGuildId: optionalSnowflakeSchema,
  voiceGuildName: z.string().max(120).nullable().optional(),
  voiceChannelId: optionalSnowflakeSchema,
  voiceChannelName: z.string().max(120).nullable().optional(),
  voiceConnectedAt: z.string().max(80).nullable().optional(),
  richPresenceConfig: z.object({
    applicationId: z.string().max(32).optional(),
    activityType: activityTypeSchema.optional(),
    name: z.string().max(128).optional(),
    description: z.string().max(256).optional(),
    state: z.string().max(128).optional(),
    details: z.string().max(128).optional(),
    buttonLabel: z.string().max(80).optional(),
    buttonUrl: z.string().max(512).optional(),
    largeImage: z.string().max(1024).optional(),
    largeText: z.string().max(128).optional(),
    smallImage: z.string().max(1024).optional(),
    smallText: z.string().max(128).optional(),
    startTimestamp: z.string().max(64).optional()
  }).partial().optional(),
  richPresenceUpdatedAt: z.string().max(80).nullable().optional(),
  usernameCheckerOptions: z.object({
    usernameLength: z.coerce.number().int().min(2).max(20).optional(),
    concurrency: z.coerce.number().int().min(1).max(5).optional(),
    requestDelay: z.coerce.number().int().min(1500).max(60000).optional()
  }).partial().optional(),
  usernameCheckerStats: z.object({
    hits: z.coerce.number().int().min(0).optional(),
    taken: z.coerce.number().int().min(0).optional(),
    errors: z.coerce.number().int().min(0).optional(),
    activeProxies: z.coerce.number().int().min(0).optional(),
    deadProxies: z.coerce.number().int().min(0).optional(),
    bannedProxies: z.coerce.number().int().min(0).optional(),
    workersRunning: z.coerce.number().int().min(0).optional()
  }).partial().optional(),
  usernameCheckerLastEvent: z.string().max(500).nullable().optional(),
  usernameCheckerUpdatedAt: z.string().max(80).nullable().optional(),
  completedCount: z.coerce.number().int().min(0).optional(),
  totalMissions: z.coerce.number().int().min(0).optional(),
  progress: z.coerce.number().int().min(0).max(100).optional()
});

const tokenSchema = z.object({
  token: z.string().min(10).max(4096)
});
const dashboardTokenSchema = tokenSchema.extend({
  username: z.string().max(120).nullable().optional()
});
const tokenAuthFailureSchema = z.object({
  reason: z.string().max(500).nullable().optional(),
  source: z.string().max(80).nullable().optional(),
  statusCode: z.coerce.number().int().min(100).max(4999).nullable().optional()
});
const USER_TOKEN_FEATURES_DISABLED_MESSAGE =
  "Por seguranca, o Mission Tools nao aceita token de conta Discord. Use apenas recursos oficiais do bot/OAuth.";

export const missionToolsRouter = Router();

missionToolsRouter.get("/bot/configs", requireBot, async (req, res, next) => {
  try {
    const botId = await readRequiredBotId(req);
    await assertBotMissionToolsLicense(botId);

    return res.json({
      configs: await listActiveMissionToolsSettings(botId)
    });
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.post("/bot/panel-state", requireBot, async (req, res, next) => {
  try {
    const input = botPanelStateSchema.parse(req.body);
    const botId = await readRequiredBotId(req);
    await assertBotMissionToolsLicense(botId);

    return res.json({
      settings: await updateMissionToolsPanelMessageState(botId, input.guildId, input.messageId ?? null)
    });
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.get("/bot/:guildId", requireBot, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    await assertBotMissionToolsLicense(botId);

    return res.json({
      settings: await getMissionToolsSettings(guildId, botId)
    });
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.get("/bot/:guildId/users/:userId", requireBot, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const userId = snowflakeSchema.parse(req.params.userId);
    const botId = await readRequiredBotId(req);
    await assertBotMissionToolsLicense(botId);

    return res.json({
      user: await getMissionToolsUserPanel(guildId, botId, userId)
    });
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.patch("/bot/:guildId/users/:userId", requireBot, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const userId = snowflakeSchema.parse(req.params.userId);
    const input = userPatchSchema.parse(req.body);
    const botId = await readRequiredBotId(req);
    await assertBotMissionToolsLicense(botId);

    return res.json({
      user: await saveMissionToolsUserPanel(guildId, botId, userId, input)
    });
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.post("/bot/:guildId/users/:userId/token", requireBot, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const userId = snowflakeSchema.parse(req.params.userId);
    tokenSchema.parse(req.body);
    const botId = await readRequiredBotId(req);
    await assertBotMissionToolsLicense(botId);
    void guildId;
    void userId;

    throw createRouteError(USER_TOKEN_FEATURES_DISABLED_MESSAGE, 403);
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.delete("/bot/:guildId/users/:userId/token", requireBot, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const userId = snowflakeSchema.parse(req.params.userId);
    const botId = await readRequiredBotId(req);
    await assertBotMissionToolsLicense(botId);

    return res.json(await deleteMissionToolsToken(guildId, botId, userId));
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.post("/bot/:guildId/users/:userId/token/auth-failure", requireBot, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const userId = snowflakeSchema.parse(req.params.userId);
    const input = tokenAuthFailureSchema.parse(req.body);
    const botId = await readRequiredBotId(req);
    await assertBotMissionToolsLicense(botId);

    return res.json(await markMissionToolsTokenAuthFailure(guildId, botId, userId, input));
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.get("/bot/:guildId/users/:userId/token", requireBot, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const userId = snowflakeSchema.parse(req.params.userId);
    const botId = await readRequiredBotId(req);
    await assertBotMissionToolsLicense(botId);
    void guildId;
    void userId;

    throw createRouteError(USER_TOKEN_FEATURES_DISABLED_MESSAGE, 403);
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.post("/:guildId/users/:userId/token", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const userId = snowflakeSchema.parse(req.params.userId);
    dashboardTokenSchema.parse(req.body);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    if (user.discordId !== userId) {
      throw createRouteError("Voce so pode gerenciar o seu proprio token.", 403);
    }

    await assertCanReadMissionTools(user, guildId, botId);

    throw createRouteError(USER_TOKEN_FEATURES_DISABLED_MESSAGE, 403);
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.post("/:guildId/me/token", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    tokenSchema.parse(req.body);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanReadMissionTools(user, guildId, botId);

    throw createRouteError(USER_TOKEN_FEATURES_DISABLED_MESSAGE, 403);
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.get("/:guildId/me/token", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanReadMissionTools(user, guildId, botId);

    return res.json({
      user: await getMissionToolsUserPanel(guildId, botId, user.discordId)
    });
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.delete("/:guildId/me/token", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanReadMissionTools(user, guildId, botId);

    return res.json(await deleteMissionToolsToken(guildId, botId, user.discordId));
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanReadMissionTools(user, guildId, botId);

    return res.json(await getMissionToolsDashboard(guildId, botId));
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.get("/:guildId/options", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanReadMissionTools(user, guildId, botId);

    return res.json({
      options: await getGuildLiveOptions(guildId, await getDevBotToken(botId))
    });
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.patch("/:guildId/settings", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    const input = settingsSchema.parse(req.body);

    await assertCanManageMissionTools(user, guildId, botId);
    await validateMissionToolsResources(guildId, botId, input);

    return res.json({
      settings: await saveMissionToolsSettings(guildId, botId, normalizeSettingsInput(input), user.discordId)
    });
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.post("/:guildId/panel", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageMissionTools(user, guildId, botId);
    const settings = await getMissionToolsSettings(guildId, botId);

    if (settings.panelChannelId) {
      await assertPanelChannelReady(guildId, botId, settings.panelChannelId);
    }

    return res.json({
      settings: await requestMissionToolsPanelPublish(guildId, botId, user.discordId)
    });
  } catch (error) {
    return next(error);
  }
});

async function readRequiredBotId(req: Parameters<typeof resolveRequestBotId>[0]) {
  const botId = await resolveRequestBotId(req);

  if (!botId) {
    throw createRouteError("Escolha um bot cadastrado para usar o Mission Tools.", 400);
  }

  return botId;
}

async function assertCanReadMissionTools(user: AuthSessionUser, guildId: string, botId: string) {
  await assertBotMissionToolsLicense(botId);

  if (await canReadDevBotModule(user, botId, guildId, MODULE_ID)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para acessar o Mission Tools deste bot.", 403);
}

async function assertCanManageMissionTools(user: AuthSessionUser, guildId: string, botId: string) {
  await assertBotMissionToolsLicense(botId);

  if (await canUseDevBotModule(user, botId, guildId, MODULE_ID)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para configurar o Mission Tools deste bot.", 403);
}

async function assertBotMissionToolsLicense(botId: string) {
  const permissions = await getBotApiPermissions(botId);

  if (!permissions) {
    throw createRouteError("Bot nao encontrado.", 404);
  }

  if (!permissions.enabledModules.includes(MODULE_ID)) {
    throw createRouteError("O Mission Tools nao foi liberado para este bot.", 403);
  }
}

async function validateMissionToolsResources(guildId: string, botId: string, input: z.infer<typeof settingsSchema>) {
  const botToken = await getDevBotToken(botId);
  const channelIds = [
    input.panelChannelId,
    input.logChannelId
  ].filter((channelId): channelId is string => typeof channelId === "string" && Boolean(channelId));

  const channelChecks = await Promise.all(
    [...new Set(channelIds)].map((channelId) => isGuildTextChannel(guildId, channelId, botToken))
  );

  if (!channelChecks.every(Boolean)) {
    throw createRouteError("Um dos canais selecionados nao pertence a este servidor.", 400);
  }

  if (input.panelChannelId) {
    await assertPanelChannelReady(guildId, botId, input.panelChannelId);
  }

  const roleIds = [
    ...(input.managerRoleIds ?? []),
    ...(input.allowedRoleIds ?? [])
  ];

  if (roleIds.length && !(await areGuildRoles(guildId, [...new Set(roleIds)], botToken))) {
    throw createRouteError("Um dos cargos selecionados nao pertence a este servidor.", 400);
  }
}

async function assertPanelChannelReady(guildId: string, botId: string, channelId: string) {
  const validation = await validateGuildPanelChannel(guildId, channelId, await getDevBotToken(botId));

  if (!validation.ok) {
    throw createRouteError(
      validation.reason ?? "Nao foi possivel validar as permissoes do bot no canal do painel.",
      400
    );
  }
}

function normalizeSettingsInput(input: z.infer<typeof settingsSchema>) {
  const normalized = { ...input };

  if ("logChannelId" in input) {
    normalized.logChannelId = normalizeOptionalId(input.logChannelId);
  }

  if ("panelChannelId" in input) {
    normalized.panelChannelId = normalizeOptionalId(input.panelChannelId);
  }

  return normalized;
}

function normalizeOptionalId(value: string | null | undefined) {
  return value?.trim() || null;
}

function createRouteError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}

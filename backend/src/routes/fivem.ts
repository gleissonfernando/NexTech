import { Router, raw } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { canReadDevBotModule, canUseDevBotModule, getBotApiPermissions, getDevBotToken } from "../services/devBotService";
import { areGuildAssignableRoles, areGuildRoles, getGuildLiveOptions, isGuildCategoryChannel, isGuildTextChannel, validateGuildPanelChannel } from "../services/discordOptionsService";
import {
    approveFivemFacAbsence,
    closeFivemFacAbsence,
    createFivemFacAbsence,
    getFivemFacAbsence,
    getFivemFacDashboard,
    getFivemFacSettings,
    listActiveFivemFacSettings,
    listFivemFacDueAbsences,
    listFivemFacUserAbsences,
    markFivemFacAbsenceFinished,
    markFivemFacAbsenceStarted,
    rejectFivemFacAbsence,
    requestFivemFacPanelPublish,
    resetFivemFacTestHistory,
    saveFivemFacAbsencePhotoFile,
    saveFivemFacPanelImageFile,
    saveFivemFacSettings,
    updateFivemFacAbsenceChannel,
    updateFivemFacAbsencePhoto,
    updateFivemFacPanelMessageState
} from "../services/fivemFacService";
import { listFivemModules } from "../services/fivemModuleService";
import {
  acquireFivemHierarchyPanelLock,
  deleteFivemHierarchyPanel,
  FIVEM_HIERARCHY_MODULE_ID,
  getFivemHierarchyDashboard,
  listActiveFivemHierarchyPanels,
  releaseFivemHierarchyPanelLock,
  requestFivemHierarchyPanelPublish,
  saveFivemHierarchyPanel,
  updateFivemHierarchyPanelState
} from "../services/fivemHierarchyService";
import {
  createFivemGoalConfig,
  createFivemGoalEntry,
  FIVEM_GOALS_MODULE_ID,
  deleteFivemGoalConfig,
  getFivemGoalDashboard,
  getFivemGoalSettings,
  getFivemGoalUserChannelByChannel,
  getFivemGoalUserChannelByUser,
  listFivemGoalConfigs,
  listFivemGoalEntries,
  listFivemGoalSubmissions,
  moderateFivemGoalSubmission,
  requestFivemGoalPanelPublish,
  saveFivemGoalSettings,
  updateFivemGoalRequestPanelState,
  updateFivemGoalConfig,
  upsertFivemGoalUserChannel
} from "../services/fivemGoalService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import type { AuthSessionUser } from "../types/session";

const guildIdSchema = z.string().regex(/^\d{5,32}$/);
const snowflakeSchema = z.string().regex(/^\d{5,32}$/);
const optionalSnowflakeSchema = z.union([snowflakeSchema, z.literal(""), z.null()]).optional();
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const facSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  panelChannelId: optionalSnowflakeSchema,
  absenceRoleId: optionalSnowflakeSchema,
  autoApproveEnabled: z.boolean().optional(),
  autoApproveMaxDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  autoApproveRoleIds: z.array(snowflakeSchema).optional(),
  viewerRoleIds: z.array(snowflakeSchema).optional(),
  approverRoleIds: z.array(snowflakeSchema).optional(),
  memberRoleIds: z.array(snowflakeSchema).optional(),
  logChannelId: optionalSnowflakeSchema,
  messages: z.object({
    panelTitle: z.string().max(120).optional(),
    panelDescription: z.string().max(1000).optional(),
    requestCreated: z.string().max(500).optional(),
    approved: z.string().max(500).optional(),
    rejected: z.string().max(500).optional(),
    started: z.string().max(500).optional(),
    finished: z.string().max(500).optional()
  }).partial().optional(),
  panelVisual: z.object({
    panelColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    imageUrl: z.string().max(2048).nullable().optional(),
    imagePosition: z.enum(["right_small", "top", "bottom", "none"]).optional(),
    buttonsPosition: z.enum(["inside_panel", "outside_panel", "below", "rows", "none"]).optional(),
    buttons: z.array(z.object({
      id: z.string().max(40),
      label: z.string().min(1).max(80),
      emoji: z.string().max(40).nullable().optional(),
      style: z.enum(["primary", "secondary", "success", "danger", "link"]),
      type: z.enum(["action", "url"]),
      action: z.enum(["request_absence", "my_absences", "url"]),
      url: z.string().max(2048).nullable().optional(),
      order: z.coerce.number().int().min(0).max(100),
      enabled: z.boolean()
    })).max(10).optional(),
    componentsOrder: z.array(z.enum(["image", "text", "buttons"])).max(3).optional(),
    enabledSections: z.object({
      image: z.boolean().optional(),
      buttons: z.boolean().optional(),
      description: z.boolean().optional()
    }).partial().optional()
  }).partial().optional()
});
const createAbsenceSchema = z.object({
  guildId: guildIdSchema,
  userId: snowflakeSchema,
  username: z.string().max(100).nullable().optional(),
  reason: z.string().min(1).max(800),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  notes: z.string().max(1000).nullable().optional(),
  requesterRoleIds: z.array(snowflakeSchema).max(100).optional()
});
const facHistoryResetSchema = z.object({
  actorId: snowflakeSchema,
  guildId: guildIdSchema
});
const goalFieldSchema = z.object({
  id: z.string().max(80),
  label: z.string().min(1).max(80),
  maxLength: z.coerce.number().int().min(1).max(1500).nullable().optional().default(null),
  minLength: z.coerce.number().int().min(0).max(1500).nullable().optional().default(null),
  placeholder: z.string().max(100).nullable().optional().default(null),
  required: z.boolean(),
  style: z.enum(["short", "paragraph"])
});
const goalItemSchema = z.object({
  category: z.string().max(80).nullable().optional().default(null),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional().default(null),
  emoji: z.string().max(80).nullable().optional().default(null),
  enabled: z.boolean(),
  id: z.string().max(80),
  name: z.string().min(1).max(80),
  order: z.coerce.number().int().min(0).max(10000)
});
const goalSettingsSchema = z.object({
  autoCreateWithManualRegistration: z.boolean().optional(),
  categoryId: optionalSnowflakeSchema,
  channelNameTemplate: z.string().max(80).optional(),
  enabled: z.boolean().optional(),
  fields: z.array(goalFieldSchema).max(5).optional(),
  items: z.array(goalItemSchema).max(100).optional(),
  logChannelId: optionalSnowflakeSchema,
  managerRoleId: optionalSnowflakeSchema,
  requestPanelChannelId: optionalSnowflakeSchema,
  requestPanelDescription: z.string().max(900).optional(),
  requestPanelEnabled: z.boolean().optional(),
  requestPanelMessageId: optionalSnowflakeSchema,
  requestPanelTitle: z.string().max(120).optional(),
  requestRequiresApproval: z.boolean().optional(),
  viewRoleId: optionalSnowflakeSchema
});
const goalConfigSchema = z.object({
  approverRoleIds: z.array(snowflakeSchema).max(100).optional(),
  deleteRoleIds: z.array(snowflakeSchema).max(100).optional(),
  description: z.string().max(1000).nullable().optional(),
  editRoleIds: z.array(snowflakeSchema).max(100).optional(),
  fields: z.array(goalFieldSchema).max(5).optional(),
  logChannelId: optionalSnowflakeSchema,
  managerRoleIds: z.array(snowflakeSchema).max(100).optional(),
  name: z.string().min(1).max(100).optional(),
  panelChannelId: optionalSnowflakeSchema,
  panelMessageId: optionalSnowflakeSchema,
  participantRoleIds: z.array(snowflakeSchema).max(100).optional(),
  period: z.enum(["daily", "weekly", "monthly", "custom"]).optional(),
  requiresApproval: z.boolean().optional(),
  requiresProof: z.boolean().optional(),
  resetConfig: z.object({
    customDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    enabled: z.boolean().optional(),
    frequency: z.enum(["none", "daily", "weekly", "monthly", "custom"]).optional()
  }).partial().optional(),
  rules: z.string().max(2000).nullable().optional(),
  status: z.enum(["active", "paused", "finished"]).optional(),
  targetValue: z.coerce.number().int().min(1).max(1_000_000_000).optional(),
  type: z.string().max(80).optional(),
  viewerRoleIds: z.array(snowflakeSchema).max(100).optional()
});
const goalUserChannelSchema = z.object({
  channelId: snowflakeSchema,
  guildId: guildIdSchema,
  userId: snowflakeSchema
});
const goalEntrySchema = z.object({
  channelId: snowflakeSchema,
  fields: z.array(z.object({ id: z.string().max(80), label: z.string().max(100), value: z.string().max(1500) })).max(5),
  guildId: guildIdSchema,
  imageUrl: z.string().max(2048),
  itemId: z.string().max(80).nullable().optional(),
  metaId: z.string().max(80).nullable().optional(),
  quantity: z.coerce.number().nullable().optional(),
  roleIdsSnapshot: z.array(snowflakeSchema).max(100).optional(),
  userId: snowflakeSchema
});
const hierarchyEntrySchema = z.object({
  active: z.boolean().optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
  description: z.string().max(300).nullable().optional(),
  emoji: z.string().max(40).nullable().optional(),
  id: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).nullable().optional(),
  name: z.string().min(1).max(80),
  order: z.coerce.number().int().min(0).max(1000),
  roleId: snowflakeSchema
});
const hierarchyPanelSchema = z.object({
  allowedRoleIds: z.array(snowflakeSchema).max(100).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  description: z.string().max(1200).nullable().optional(),
  enabled: z.boolean().optional(),
  footerEnabled: z.boolean().optional(),
  footerIconUrl: z.string().max(2048).nullable().optional(),
  footerText: z.string().max(200).nullable().optional(),
  hierarchies: z.array(hierarchyEntrySchema).max(50).optional(),
  id: z.string().max(80).optional(),
  imagePosition: z.enum(["top", "bottom", "thumbnail", "none"]).optional(),
  imageUrl: z.string().max(2048).nullable().optional(),
  linkedToFivem: z.boolean().optional(),
  logChannelId: optionalSnowflakeSchema,
  name: z.string().min(1).max(100).optional(),
  panelChannelId: optionalSnowflakeSchema,
  panelMessageId: optionalSnowflakeSchema,
  title: z.string().min(1).max(120).optional()
});
const userAbsenceSchema = z.object({
  guildId: guildIdSchema,
  userId: snowflakeSchema
});
const channelStateSchema = z.object({
  privateChannelId: optionalSnowflakeSchema,
  requestMessageId: optionalSnowflakeSchema
});
const panelStateSchema = z.object({
  messageId: optionalSnowflakeSchema
});
const moderationSchema = z.object({
  moderatorId: snowflakeSchema,
  moderatorRoleIds: z.array(snowflakeSchema).default([]),
  reason: z.string().max(800).nullable().optional()
});
const lifecycleSchema = z.object({
  roleAdded: z.boolean().optional(),
  roleRemoved: z.boolean().optional()
});
const facPhotoUpload = raw({
  limit: "10mb",
  type: ["image/gif", "image/jpeg", "image/png", "image/webp"]
});
const allowedFacPhotoMimeTypes = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const FAC_MODULE_IDS = ["fivem-absences", "fivem-fac", "police-absences"] as const;

export const fivemRouter = Router();

fivemRouter.get("/modules", requireAuth, async (_req, res, next) => {
  try {
    return res.json({
      modules: await listFivemModules()
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.get("/:guildId/fac", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanReadFac(user, guildId, botId);

    return res.json(await getFivemFacDashboard(guildId, botId));
  } catch (error) {
    return next(error);
  }
});

fivemRouter.get("/:guildId/fac/options", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanReadFac(user, guildId, botId);

    return res.json({
      options: await getGuildLiveOptions(guildId, await getDevBotToken(botId))
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.get("/:guildId/goals", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId) throw createRouteError("Selecione um bot DEV para acessar metas FiveM.", 400);
    await assertCanReadFivemGoals(res.locals.dashboardAuth.user, guildId, botId);
    return res.json(await getFivemGoalDashboard(guildId, botId));
  } catch (error) {
    return next(error);
  }
});

fivemRouter.get("/:guildId/hierarchy", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId) throw createRouteError("Selecione um bot DEV para acessar Hierarquia FAQ.", 400);
    await assertCanReadFivemHierarchy(res.locals.dashboardAuth.user, guildId, botId);
    return res.json(await getFivemHierarchyDashboard(guildId, botId));
  } catch (error) {
    return next(error);
  }
});

fivemRouter.post("/:guildId/hierarchy/panels", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId) throw createRouteError("Selecione um bot DEV para criar Hierarquia FAQ.", 400);
    await assertCanManageFivemHierarchy(res.locals.dashboardAuth.user, guildId, botId);
    const input = hierarchyPanelSchema.parse(req.body);
    await validateHierarchyResources(guildId, botId, input);
    return res.status(201).json({ panel: await saveFivemHierarchyPanel(guildId, botId, normalizeHierarchyPanelInput(input), res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.patch("/:guildId/hierarchy/panels/:panelId", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const panelId = z.string().min(1).max(80).parse(req.params.panelId);
    const botId = await resolveRequestBotId(req);
    if (!botId) throw createRouteError("Selecione um bot DEV para editar Hierarquia FAQ.", 400);
    await assertCanManageFivemHierarchy(res.locals.dashboardAuth.user, guildId, botId);
    const input = hierarchyPanelSchema.partial().parse(req.body);
    await validateHierarchyResources(guildId, botId, input);
    return res.json({ panel: await saveFivemHierarchyPanel(guildId, botId, { ...normalizeHierarchyPanelInput(input), id: panelId }, res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.delete("/:guildId/hierarchy/panels/:panelId", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const panelId = z.string().min(1).max(80).parse(req.params.panelId);
    const botId = await resolveRequestBotId(req);
    if (!botId) throw createRouteError("Selecione um bot DEV para excluir Hierarquia FAQ.", 400);
    await assertCanManageFivemHierarchy(res.locals.dashboardAuth.user, guildId, botId);
    const panel = await deleteFivemHierarchyPanel(guildId, botId, panelId, res.locals.dashboardAuth.user.discordId);
    if (!panel) throw createRouteError("Painel de hierarquia nao encontrado.", 404);
    return res.json({ panel });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.post("/:guildId/hierarchy/panels/:panelId/publish", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const panelId = z.string().min(1).max(80).parse(req.params.panelId);
    const botId = await resolveRequestBotId(req);
    if (!botId) throw createRouteError("Selecione um bot DEV para publicar Hierarquia FAQ.", 400);
    await assertCanManageFivemHierarchy(res.locals.dashboardAuth.user, guildId, botId);
    return res.json({ panel: await requestFivemHierarchyPanelPublish(guildId, botId, panelId, res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.post("/:guildId/goals/configs", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId) throw createRouteError("Selecione um bot DEV para criar metas FiveM.", 400);
    await assertCanManageFivemGoals(res.locals.dashboardAuth.user, guildId, botId);
    const input = goalConfigSchema.parse(req.body);
    await validateGoalConfigResources(guildId, botId, input);
    return res.status(201).json({
      config: await createFivemGoalConfig(guildId, botId, normalizeGoalConfigInput(input), res.locals.dashboardAuth.user.discordId)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.patch("/:guildId/goals/configs/:metaId", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const metaId = z.string().min(1).max(80).parse(req.params.metaId);
    const botId = await resolveRequestBotId(req);
    if (!botId) throw createRouteError("Selecione um bot DEV para editar metas FiveM.", 400);
    await assertCanManageFivemGoals(res.locals.dashboardAuth.user, guildId, botId);
    const input = goalConfigSchema.partial().parse(req.body);
    await validateGoalConfigResources(guildId, botId, input);
    const config = await updateFivemGoalConfig(guildId, botId, metaId, normalizeGoalConfigInput(input), res.locals.dashboardAuth.user.discordId);
    if (!config) throw createRouteError("Meta nao encontrada.", 404);
    return res.json({ config });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.delete("/:guildId/goals/configs/:metaId", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const metaId = z.string().min(1).max(80).parse(req.params.metaId);
    const botId = await resolveRequestBotId(req);
    if (!botId) throw createRouteError("Selecione um bot DEV para excluir metas FiveM.", 400);
    await assertCanManageFivemGoals(res.locals.dashboardAuth.user, guildId, botId);
    const deleteHistory = req.query.history === "1" || req.query.history === "true";
    const config = await deleteFivemGoalConfig(guildId, botId, metaId, res.locals.dashboardAuth.user.discordId, deleteHistory);
    if (!config) throw createRouteError("Meta nao encontrada.", 404);
    return res.json({ config });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.patch("/:guildId/goals/submissions/:submissionId", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const submissionId = z.string().min(1).max(80).parse(req.params.submissionId);
    const botId = await resolveRequestBotId(req);
    if (!botId) throw createRouteError("Selecione um bot DEV para moderar metas FiveM.", 400);
    await assertCanManageFivemGoals(res.locals.dashboardAuth.user, guildId, botId);
    const input = z.object({
      refusalReason: z.string().max(800).nullable().optional(),
      status: z.enum(["approved", "refused"])
    }).parse(req.body);
    const submission = await moderateFivemGoalSubmission(guildId, botId, submissionId, res.locals.dashboardAuth.user.discordId, input.status, input.refusalReason);
    if (!submission) throw createRouteError("Envio de meta nao encontrado.", 404);
    return res.json({ submission });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.patch("/:guildId/goals", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId) throw createRouteError("Selecione um bot DEV para configurar metas FiveM.", 400);
    await assertCanManageFivemGoals(res.locals.dashboardAuth.user, guildId, botId);
    const input = goalSettingsSchema.parse(req.body);
    await validateGoalResources(guildId, botId, input);
    if (input.enabled === true && input.requestPanelEnabled !== false && !input.requestPanelChannelId) {
      const current = await getFivemGoalSettings(guildId, botId);
      if (!current.requestPanelChannelId) {
        throw createRouteError("Voce precisa configurar o canal do painel de solicitacao de meta, pois o Pedido Set esta desativado.", 400);
      }
    }
    return res.json({
      settings: await saveFivemGoalSettings(guildId, botId, normalizeGoalSettingsInput(input), res.locals.dashboardAuth.user.discordId)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.post("/:guildId/goals/panel", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId) throw createRouteError("Selecione um bot DEV para publicar o painel de metas.", 400);
    await assertCanManageFivemGoals(res.locals.dashboardAuth.user, guildId, botId);
    return res.json({
      settings: await requestFivemGoalPanelPublish(guildId, botId, res.locals.dashboardAuth.user.discordId)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.get("/bot/goals/:guildId", requireBot, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    return res.json({
      configs: await listFivemGoalConfigs(guildId, botId, true),
      settings: await getFivemGoalSettings(guildId, botId),
      submissions: await listFivemGoalSubmissions(guildId, botId)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.get("/bot/hierarchy/configs", requireBot, async (req, res, next) => {
  try {
    const botId = await readRequiredBotId(req);
    await assertBotFivemHierarchyLicense(botId);
    return res.json({ panels: await listActiveFivemHierarchyPanels(botId) });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.post("/bot/hierarchy/panel-state", requireBot, async (req, res, next) => {
  try {
    const input = z.object({
      contentHash: z.string().regex(/^[a-f0-9]{64}$/i).nullable().optional(),
      guildId: guildIdSchema,
      messageId: optionalSnowflakeSchema,
      panelId: z.string().min(1).max(80),
      panelVersion: z.literal(2).optional()
    }).parse(req.body);
    const botId = await readRequiredBotId(req);
    await assertBotFivemHierarchyLicense(botId);
    const panel = await updateFivemHierarchyPanelState(input.guildId, botId, input.panelId, {
      contentHash: input.contentHash ?? null,
      messageId: input.messageId ?? null,
      panelVersion: input.panelVersion ?? 2
    });
    return res.json({ panel });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.post("/bot/hierarchy/panel-lock", requireBot, async (req, res, next) => {
  try {
    const input = z.object({
      action: z.enum(["acquire", "release"]),
      guildId: guildIdSchema,
      instanceId: z.string().min(1).max(120),
      panelId: z.string().min(1).max(80),
      ttlMs: z.coerce.number().int().min(5_000).max(120_000).optional()
    }).parse(req.body);
    const botId = await readRequiredBotId(req);
    await assertBotFivemHierarchyLicense(botId);
    if (input.action === "release") {
      await releaseFivemHierarchyPanelLock(input.guildId, botId, input.panelId, input.instanceId);
      return res.json({ acquired: false, released: true });
    }
    return res.json({ acquired: await acquireFivemHierarchyPanelLock(input.guildId, botId, input.panelId, input.instanceId, input.ttlMs ?? 30_000) });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.get("/bot/goals/channel/:channelId", requireBot, async (req, res, next) => {
  try {
    const channelId = snowflakeSchema.parse(req.params.channelId);
    const botId = await resolveRequestBotId(req);
    return res.json({ channel: await getFivemGoalUserChannelByChannel(channelId, botId) });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.get("/bot/goals/:guildId/users/:userId/channel", requireBot, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const userId = snowflakeSchema.parse(req.params.userId);
    const botId = await resolveRequestBotId(req);
    return res.json({ channel: await getFivemGoalUserChannelByUser(guildId, userId, botId) });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.post("/bot/goals/channels", requireBot, async (req, res, next) => {
  try {
    const input = goalUserChannelSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    return res.status(201).json({ channel: await upsertFivemGoalUserChannel({ ...input, botId }) });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.post("/bot/goals/entries", requireBot, async (req, res, next) => {
  try {
    const input = goalEntrySchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    return res.status(201).json({ entry: await createFivemGoalEntry({ ...input, botId }) });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.post("/bot/goals/panel-state", requireBot, async (req, res, next) => {
  try {
    const input = z.object({
      guildId: guildIdSchema,
      messageId: optionalSnowflakeSchema
    }).parse(req.body);
    const botId = await resolveRequestBotId(req);
    return res.json({
      settings: await updateFivemGoalRequestPanelState(input.guildId, botId, input.messageId ?? null)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.patch("/:guildId/fac", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    const input = facSettingsSchema.parse(req.body);

    await assertCanManageFac(user, guildId, botId);
    await validateFacResources(guildId, botId, input);

    return res.json({
      settings: await saveFivemFacSettings(guildId, botId, normalizeFacSettingsInput(input), user.discordId)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.post("/:guildId/fac/panel", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageFac(user, guildId, botId);
    const settings = await getFivemFacSettings(guildId, botId);

    if (settings.panelChannelId) {
      await assertPanelChannelReady(guildId, botId, settings.panelChannelId);
    }

    return res.json({
      settings: await requestFivemFacPanelPublish(guildId, botId, user.discordId)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.put("/:guildId/fac/panel-image", requireAuth, facPhotoUpload, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageFac(user, guildId, botId);
    const mimeType = req.header("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";

    if (!allowedFacPhotoMimeTypes.has(mimeType)) {
      throw createRouteError("Formato invalido. Envie PNG, JPG, JPEG, WEBP ou GIF.", 400);
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw createRouteError("Arquivo de imagem obrigatorio.", 400);
    }

    return res.json({
      settings: await saveFivemFacPanelImageFile(guildId, botId, req.body, mimeType, user.discordId)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.put("/:guildId/fac/absences/:absenceId/photo", requireAuth, facPhotoUpload, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const absenceId = z.string().min(1).parse(req.params.absenceId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageFac(user, guildId, botId);

    const mimeType = req.header("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";

    if (!allowedFacPhotoMimeTypes.has(mimeType)) {
      throw createRouteError("Formato invalido. Envie PNG, JPG, JPEG, WEBP ou GIF.", 400);
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw createRouteError("Arquivo de imagem obrigatorio.", 400);
    }

    const photoUrl = await saveFivemFacAbsencePhotoFile(guildId, absenceId, req.body, mimeType);

    return res.json({
      absence: await updateFivemFacAbsencePhoto(absenceId, botId, guildId, photoUrl)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.delete("/:guildId/fac/absences/:absenceId/photo", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const absenceId = z.string().min(1).parse(req.params.absenceId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageFac(user, guildId, botId);

    return res.json({
      absence: await updateFivemFacAbsencePhoto(absenceId, botId, guildId, null)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.get("/bot/fac/configs", requireBot, async (req, res, next) => {
  try {
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);

    return res.json({
      configs: await listActiveFivemFacSettings(botId)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.post("/bot/fac/panel-state", requireBot, async (req, res, next) => {
  try {
    const input = z.object({
      guildId: guildIdSchema,
      messageId: optionalSnowflakeSchema
    }).parse(req.body);
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);

    return res.json({
      settings: await updateFivemFacPanelMessageState(botId, input.guildId, input.messageId ?? null)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.post("/bot/fac/history/reset", requireBot, async (req, res, next) => {
  try {
    const input = facHistoryResetSchema.parse(req.body);
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);

    return res.json({
      result: await resetFivemFacTestHistory({
        actorId: input.actorId,
        botId,
        guildId: input.guildId
      })
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.get("/bot/fac/:guildId", requireBot, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);

    return res.json({
      settings: await getFivemFacSettings(guildId, botId)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.post("/bot/fac/absences", requireBot, async (req, res, next) => {
  try {
    const input = createAbsenceSchema.parse(req.body);
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);

    return res.status(201).json({
      absence: await createFivemFacAbsence({
        ...input,
        botId,
        requesterRoleIds: input.requesterRoleIds ?? []
      })
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.get("/bot/fac/absences/user", requireBot, async (req, res, next) => {
  try {
    const input = userAbsenceSchema.parse(req.query);
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);

    return res.json({
      absences: await listFivemFacUserAbsences(botId, input.guildId, input.userId)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.get("/bot/fac/absences/due", requireBot, async (req, res, next) => {
  try {
    const today = typeof req.query.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.today)
      ? req.query.today
      : undefined;
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);

    return res.json({
      absences: await listFivemFacDueAbsences(botId, today)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.get("/bot/fac/absences/:absenceId", requireBot, async (req, res, next) => {
  try {
    const absenceId = z.string().min(1).parse(req.params.absenceId);
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);
    const absence = await getFivemFacAbsence(absenceId, botId);

    if (!absence) {
      return res.status(404).json({
        message: "Ausencia nao encontrada."
      });
    }

    return res.json({
      absence
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.patch("/bot/fac/absences/:absenceId/channel", requireBot, async (req, res, next) => {
  try {
    const absenceId = z.string().min(1).parse(req.params.absenceId);
    const input = channelStateSchema.parse(req.body);
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);

    return res.json({
      absence: await updateFivemFacAbsenceChannel(absenceId, botId, input)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.post("/bot/fac/absences/:absenceId/approve", requireBot, async (req, res, next) => {
  try {
    const absenceId = z.string().min(1).parse(req.params.absenceId);
    const input = moderationSchema.parse(req.body);
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);

    return res.json({
      absence: await approveFivemFacAbsence({
        absenceId,
        botId,
        moderatorId: input.moderatorId,
        moderatorRoleIds: input.moderatorRoleIds
      })
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.post("/bot/fac/absences/:absenceId/reject", requireBot, async (req, res, next) => {
  try {
    const absenceId = z.string().min(1).parse(req.params.absenceId);
    const input = moderationSchema.parse(req.body);
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);

    return res.json({
      absence: await rejectFivemFacAbsence({
        absenceId,
        botId,
        moderatorId: input.moderatorId,
        moderatorRoleIds: input.moderatorRoleIds,
        reason: input.reason ?? null
      })
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.post("/bot/fac/absences/:absenceId/close", requireBot, async (req, res, next) => {
  try {
    const absenceId = z.string().min(1).parse(req.params.absenceId);
    const input = moderationSchema.extend({
      roleRemoved: z.boolean().optional()
    }).parse(req.body);
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);

    return res.json({
      absence: await closeFivemFacAbsence({
        absenceId,
        botId,
        moderatorId: input.moderatorId,
        moderatorRoleIds: input.moderatorRoleIds,
        reason: input.reason ?? null,
        roleRemoved: input.roleRemoved === true
      })
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.post("/bot/fac/absences/:absenceId/start", requireBot, async (req, res, next) => {
  try {
    const absenceId = z.string().min(1).parse(req.params.absenceId);
    const input = lifecycleSchema.parse(req.body ?? {});
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);

    return res.json({
      absence: await markFivemFacAbsenceStarted(absenceId, botId, input.roleAdded !== false)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.post("/bot/fac/absences/:absenceId/finish", requireBot, async (req, res, next) => {
  try {
    const absenceId = z.string().min(1).parse(req.params.absenceId);
    const input = lifecycleSchema.parse(req.body ?? {});
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);

    return res.json({
      absence: await markFivemFacAbsenceFinished(absenceId, botId, input.roleRemoved !== false)
    });
  } catch (error) {
    return next(error);
  }
});

async function readRequiredBotId(req: Parameters<typeof resolveRequestBotId>[0]) {
  const botId = await resolveRequestBotId(req);

  if (!botId) {
    throw createRouteError("Bot vinculado obrigatorio para o modulo FiveM.", 400);
  }

  return botId;
}

async function assertCanReadFac(user: AuthSessionUser, guildId: string, botId: string) {
  await assertBotFacLicense(botId);

  if (await canReadAnyFacModule(user, guildId, botId)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para acessar o FAC deste bot.", 403);
}

async function assertCanManageFac(user: AuthSessionUser, guildId: string, botId: string) {
  await assertBotFacLicense(botId);

  if (await canUseAnyFacModule(user, guildId, botId)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para configurar o FAC deste bot.", 403);
}

async function assertCanReadFivemGoals(user: AuthSessionUser, guildId: string, botId: string) {
  await assertBotFivemGoalsLicense(botId);

  if (await canReadDevBotModule(user, botId, guildId, FIVEM_GOALS_MODULE_ID)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para acessar metas FiveM deste bot.", 403);
}

async function assertCanManageFivemGoals(user: AuthSessionUser, guildId: string, botId: string) {
  await assertBotFivemGoalsLicense(botId);

  if (await canUseDevBotModule(user, botId, guildId, FIVEM_GOALS_MODULE_ID)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para configurar metas FiveM deste bot.", 403);
}

async function assertCanReadFivemHierarchy(user: AuthSessionUser, guildId: string, botId: string) {
  await assertBotFivemHierarchyLicense(botId);

  if (await canReadDevBotModule(user, botId, guildId, FIVEM_HIERARCHY_MODULE_ID)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para acessar Hierarquia FAQ deste bot.", 403);
}

async function assertCanManageFivemHierarchy(user: AuthSessionUser, guildId: string, botId: string) {
  await assertBotFivemHierarchyLicense(botId);

  if (await canUseDevBotModule(user, botId, guildId, FIVEM_HIERARCHY_MODULE_ID)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para configurar Hierarquia FAQ deste bot.", 403);
}

async function assertBotFivemGoalsLicense(botId: string) {
  const permissions = await getBotApiPermissions(botId);

  if (!permissions) {
    throw createRouteError("Bot nao encontrado.", 404);
  }

  if (!permissions.enabledModules.includes(FIVEM_GOALS_MODULE_ID)) {
    throw createRouteError("O sistema de metas FiveM nao foi liberado para este cliente.", 403);
  }
}

async function assertBotFivemHierarchyLicense(botId: string) {
  const permissions = await getBotApiPermissions(botId);

  if (!permissions) {
    throw createRouteError("Bot nao encontrado.", 404);
  }

  if (!permissions.enabledModules.includes(FIVEM_HIERARCHY_MODULE_ID)) {
    throw createRouteError("O sistema Hierarquia FAQ FiveM nao foi liberado para este cliente.", 403);
  }
}

async function assertBotFacLicense(botId: string) {
  const permissions = await getBotApiPermissions(botId);

  if (!permissions) {
    throw createRouteError("Bot nao encontrado.", 404);
  }

  if (!hasAnyFacModule(permissions.enabledModules)) {
    throw createRouteError("O sistema FAC nao foi liberado para este cliente FiveM.", 403);
  }
}

async function canReadAnyFacModule(user: AuthSessionUser, guildId: string, botId: string) {
  const checks = await Promise.all(
    FAC_MODULE_IDS.map((moduleId) => canReadDevBotModule(user, botId, guildId, moduleId))
  );

  return checks.some(Boolean);
}

async function canUseAnyFacModule(user: AuthSessionUser, guildId: string, botId: string) {
  const checks = await Promise.all(
    FAC_MODULE_IDS.map((moduleId) => canUseDevBotModule(user, botId, guildId, moduleId))
  );

  return checks.some(Boolean);
}

function hasAnyFacModule(enabledModules: string[]) {
  return FAC_MODULE_IDS.some((moduleId) => enabledModules.includes(moduleId));
}

async function validateFacResources(guildId: string, botId: string, input: z.infer<typeof facSettingsSchema>) {
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
    input.absenceRoleId,
    ...(input.autoApproveRoleIds ?? []),
    ...(input.viewerRoleIds ?? []),
    ...(input.approverRoleIds ?? []),
    ...(input.memberRoleIds ?? [])
  ].filter((roleId): roleId is string => typeof roleId === "string" && Boolean(roleId));

  if (roleIds.length && !(await areGuildRoles(guildId, [...new Set(roleIds)], botToken))) {
    throw createRouteError("Um dos cargos selecionados nao pertence a este servidor.", 400);
  }

  if (
    input.absenceRoleId
    && !(await areGuildAssignableRoles(guildId, [input.absenceRoleId], botToken))
  ) {
    throw createRouteError("O cargo de ausencia precisa ficar abaixo do cargo do bot e o bot precisa gerenciar cargos.", 400);
  }
}

async function validateGoalResources(guildId: string, botId: string, input: z.infer<typeof goalSettingsSchema>) {
  const botToken = await getDevBotToken(botId);
  const channelIds = [input.logChannelId, input.requestPanelChannelId].filter((channelId): channelId is string => typeof channelId === "string" && Boolean(channelId));

  const channelChecks = await Promise.all(
    [...new Set(channelIds)].map((channelId) => isGuildTextChannel(guildId, channelId, botToken))
  );

  if (!channelChecks.every(Boolean)) {
    throw createRouteError("Um dos canais selecionados nao pertence a este servidor.", 400);
  }

  if (input.categoryId) {
    if (!(await isGuildCategoryChannel(guildId, input.categoryId, botToken))) {
      throw createRouteError("A categoria de metas nao pertence a este servidor.", 400);
    }
  }
  if (input.requestPanelChannelId) {
    await assertPanelChannelReady(guildId, botId, input.requestPanelChannelId);
  }

  const roleIds = [input.viewRoleId, input.managerRoleId].filter((roleId): roleId is string => typeof roleId === "string" && Boolean(roleId));
  if (roleIds.length && !(await areGuildRoles(guildId, [...new Set(roleIds)], botToken))) {
    throw createRouteError("Um dos cargos selecionados nao pertence a este servidor.", 400);
  }
}

async function validateGoalConfigResources(guildId: string, botId: string, input: Partial<z.infer<typeof goalConfigSchema>>) {
  const botToken = await getDevBotToken(botId);
  const channelIds = [input.logChannelId, input.panelChannelId].filter((channelId): channelId is string => typeof channelId === "string" && Boolean(channelId));

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
    ...(input.participantRoleIds ?? []),
    ...(input.managerRoleIds ?? []),
    ...(input.approverRoleIds ?? []),
    ...(input.editRoleIds ?? []),
    ...(input.deleteRoleIds ?? []),
    ...(input.viewerRoleIds ?? [])
  ];

  if (roleIds.length && !(await areGuildRoles(guildId, [...new Set(roleIds)], botToken))) {
    throw createRouteError("Um dos cargos selecionados nao pertence a este servidor.", 400);
  }
}

async function validateHierarchyResources(guildId: string, botId: string, input: Partial<z.infer<typeof hierarchyPanelSchema>>) {
  const botToken = await getDevBotToken(botId);
  const channelIds = [input.panelChannelId, input.logChannelId].filter((channelId): channelId is string => typeof channelId === "string" && Boolean(channelId));
  const channelChecks = await Promise.all([...new Set(channelIds)].map((channelId) => isGuildTextChannel(guildId, channelId, botToken)));

  if (!channelChecks.every(Boolean)) {
    throw createRouteError("Um dos canais selecionados nao pertence a este servidor.", 400);
  }

  const roleIds = [
    ...(input.allowedRoleIds ?? []),
    ...(input.hierarchies ?? []).map((item) => item.roleId)
  ].filter(Boolean);

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

function normalizeFacSettingsInput(input: z.infer<typeof facSettingsSchema>) {
  const normalized: any = {
    ...input
  };

  if ("absenceRoleId" in input) {
    normalized.absenceRoleId = normalizeOptionalId(input.absenceRoleId);
  }

  if ("logChannelId" in input) {
    normalized.logChannelId = normalizeOptionalId(input.logChannelId);
  }

  if ("panelChannelId" in input) {
    normalized.panelChannelId = normalizeOptionalId(input.panelChannelId);
  }

  if (normalized.panelVisual?.buttons) {
    normalized.panelVisual = {
      ...normalized.panelVisual,
      buttons: normalized.panelVisual.buttons.map((button: any) => ({
        id: button.id,
        type: button.type,
        action: button.action,
        enabled: button.enabled,
        label: button.label,
        style: button.style,
        order: button.order,
        emoji: button.emoji ?? null,
        url: button.url ?? null
      }))
    };
  }

  return normalized;
}

function normalizeGoalSettingsInput(input: z.infer<typeof goalSettingsSchema>) {
  return {
    ...input,
    categoryId: normalizeOptionalId(input.categoryId),
    logChannelId: normalizeOptionalId(input.logChannelId),
    managerRoleId: normalizeOptionalId(input.managerRoleId),
    requestPanelChannelId: normalizeOptionalId(input.requestPanelChannelId),
    requestPanelMessageId: normalizeOptionalId(input.requestPanelMessageId),
    viewRoleId: normalizeOptionalId(input.viewRoleId)
  };
}

function normalizeGoalConfigInput(input: Partial<z.infer<typeof goalConfigSchema>>) {
  return {
    ...input,
    logChannelId: normalizeOptionalId(input.logChannelId),
    panelChannelId: normalizeOptionalId(input.panelChannelId),
    panelMessageId: normalizeOptionalId(input.panelMessageId),
    resetConfig: input.resetConfig ? {
      customDate: input.resetConfig.customDate ?? null,
      enabled: input.resetConfig.enabled === true,
      frequency: input.resetConfig.frequency ?? "none"
    } : undefined
  };
}

function normalizeHierarchyPanelInput(input: Partial<z.infer<typeof hierarchyPanelSchema>>) {
  return {
    ...input,
    hierarchies: input.hierarchies?.map((item, index) => ({
      active: item.active !== false,
      color: item.color ?? null,
      description: item.description ?? null,
      emoji: item.emoji ?? null,
      id: item.id ?? `hierarquia-${index + 1}`,
      limit: item.limit ?? null,
      name: item.name,
      order: item.order,
      roleId: item.roleId
    })),
    logChannelId: normalizeOptionalId(input.logChannelId),
    panelChannelId: normalizeOptionalId(input.panelChannelId),
    panelMessageId: normalizeOptionalId(input.panelMessageId)
  };
}

function normalizeOptionalId(value: string | null | undefined) {
  return value?.trim() || null;
}

function createRouteError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}

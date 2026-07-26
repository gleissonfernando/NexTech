import { Router, type Request } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { canManageDashboardGuild } from "../services/dashboardGuildAccessService";
import { canReadDevBotModule, canUseDevBotModule, getDevBotToken } from "../services/devBotService";
import { validateGuildPanelChannel } from "../services/discordOptionsService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import {
  CUSTOM_PANELS_MODULE_ID,
  createCustomPanel,
  createCustomPanelCategory,
  createServiceError,
  deleteCustomPanel,
  deleteCustomPanelCategory,
  duplicateCustomPanel,
  getCustomPanelsDashboard,
  getBotCustomPanel,
  listBotCustomPanels,
  publishCustomPanel,
  updateCustomPanel,
  updateCustomPanelCategory,
  updateCustomPanelMessageState
} from "../services/customPanelService";
import type { AuthSessionUser } from "../types/session";

const snowflakeSchema = z.union([z.string().regex(/^\d{5,32}$/), z.literal(""), z.null()]).optional();
const optionalTextSchema = (max: number) => z.union([z.string().max(max), z.literal(""), z.null()]).optional();
const optionalUrlSchema = z.union([z.string().url().max(2048), z.literal(""), z.null()]).optional();

const componentSchema = z.object({
  customId: optionalTextSchema(100),
  disabled: z.boolean().optional(),
  emoji: optionalTextSchema(80),
  label: optionalTextSchema(80),
  maxValues: z.number().int().min(0).max(25).nullable().optional(),
  minValues: z.number().int().min(0).max(25).nullable().optional(),
  options: z.array(z.object({
    description: optionalTextSchema(100),
    emoji: optionalTextSchema(80),
    label: z.string().min(1).max(80),
    value: z.string().min(1).max(100)
  })).max(25).optional(),
  placeholder: optionalTextSchema(120),
  style: z.enum(["primary", "secondary", "success", "danger", "link"]).optional(),
  type: z.enum(["button", "select", "modal", "dropdown", "url_button", "link_button"]),
  url: optionalUrlSchema
}).passthrough();

const categorySchema = z.object({
  description: optionalTextSchema(240),
  name: z.string().min(1).max(80),
  order: z.number().int().min(1).max(9999).nullable().optional()
});

const panelSchema = z.object({
  afterMessage: optionalTextSchema(1900),
  authorName: optionalTextSchema(120),
  bannerUrl: optionalUrlSchema,
  beforeMessage: optionalTextSchema(1900),
  categoryId: z.string().min(1).max(100),
  channelId: snowflakeSchema,
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional().nullable(),
  components: z.array(componentSchema).max(25).optional(),
  description: optionalTextSchema(4000),
  emoji: optionalTextSchema(80),
  footerText: optionalTextSchema(300),
  mentionRoleId: snowflakeSchema,
  name: z.string().min(1).max(100),
  panelType: optionalTextSchema(80),
  thumbnailUrl: optionalUrlSchema
});

const panelPatchSchema = panelSchema.partial();
const panelStateSchema = z.object({
  messageId: z.string().regex(/^\d{5,32}$/).nullable().optional(),
  published: z.boolean().optional()
});

export const panelsRouter = Router();

panelsRouter.get("/bot/panels", requireBot, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    return res.json(await listBotCustomPanels(botId));
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

panelsRouter.get("/bot/panels/:panelId", requireBot, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    return res.json(await getBotCustomPanel(requiredParam(req.params.panelId, "panelId"), botId));
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

panelsRouter.patch("/bot/panels/:panelId/state", requireBot, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const input = panelStateSchema.parse(req.body);
    const panel = await updateCustomPanelMessageState(requiredParam(req.params.panelId, "panelId"), botId, input);
    return res.json({ panel });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

panelsRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = requiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    await assertCanReadGuild(req, guildId, botId, "visualizar painéis");
    return res.json(await getCustomPanelsDashboard(guildId, botId));
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

panelsRouter.post("/:guildId/categories", requireAuth, async (req, res, next) => {
  try {
    const guildId = requiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    await assertCanManageGuild(req, guildId, botId, "criar categoria de painel");
    const category = await createCustomPanelCategory(guildId, botId, { ...categorySchema.parse(req.body), userId: user.discordId });
    return res.status(201).json({ category });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

panelsRouter.patch("/:guildId/categories/:categoryId", requireAuth, async (req, res, next) => {
  try {
    const guildId = requiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    await assertCanManageGuild(req, guildId, botId, "editar categoria de painel");
    const category = await updateCustomPanelCategory(guildId, botId, requiredParam(req.params.categoryId, "categoryId"), { ...categorySchema.partial().parse(req.body), userId: user.discordId });
    return res.json({ category });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

panelsRouter.delete("/:guildId/categories/:categoryId", requireAuth, async (req, res, next) => {
  try {
    const guildId = requiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    await assertCanManageGuild(req, guildId, botId, "excluir categoria de painel");
    const category = await deleteCustomPanelCategory(guildId, botId, requiredParam(req.params.categoryId, "categoryId"), user.discordId);
    return res.json({ category });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

panelsRouter.post("/:guildId/panels", requireAuth, async (req, res, next) => {
  try {
    const guildId = requiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    await assertCanManageGuild(req, guildId, botId, "criar painel");
    const input = panelSchema.parse(req.body);
    if (input.channelId) await assertPanelChannelReady(guildId, input.channelId, botId);
    const panel = await createCustomPanel(guildId, botId, { ...input, userId: user.discordId });
    return res.status(201).json({ panel });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

panelsRouter.patch("/:guildId/panels/:panelId", requireAuth, async (req, res, next) => {
  try {
    const guildId = requiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    await assertCanManageGuild(req, guildId, botId, "editar painel");
    const input = panelPatchSchema.parse(req.body);
    if (input.channelId) await assertPanelChannelReady(guildId, input.channelId, botId);
    const panel = await updateCustomPanel(guildId, botId, requiredParam(req.params.panelId, "panelId"), { ...input, userId: user.discordId });
    return res.json({ panel });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

panelsRouter.post("/:guildId/panels/:panelId/duplicate", requireAuth, async (req, res, next) => {
  try {
    const guildId = requiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    await assertCanManageGuild(req, guildId, botId, "duplicar painel");
    const panel = await duplicateCustomPanel(guildId, botId, requiredParam(req.params.panelId, "panelId"), user.discordId);
    return res.status(201).json({ panel });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

panelsRouter.delete("/:guildId/panels/:panelId", requireAuth, async (req, res, next) => {
  try {
    const guildId = requiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    await assertCanManageGuild(req, guildId, botId, "excluir painel");
    const panel = await deleteCustomPanel(guildId, botId, requiredParam(req.params.panelId, "panelId"), user.discordId);
    return res.json({ panel });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

panelsRouter.post("/:guildId/panels/:panelId/publish", requireAuth, async (req, res, next) => {
  try {
    const guildId = requiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    await assertCanManageGuild(req, guildId, botId, "publicar painel");
    const panelId = requiredParam(req.params.panelId, "panelId");
    const dashboard = await getCustomPanelsDashboard(guildId, botId);
    const current = dashboard.panels.find((item) => item.id === panelId);
    if (!current) throw createServiceError("Painel não encontrado.", 404);
    if (!current.channelId) throw createServiceError("Selecione um canal antes de publicar o painel.", 400);
    await assertPanelChannelReady(guildId, current.channelId, botId);
    const panel = await publishCustomPanel(guildId, botId, panelId, user.discordId);
    return res.json({ panel });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

async function assertCanManageGuild(req: Request, guildId: string, botId: string | null, action: string) {
  const user = req.res?.locals.dashboardAuth.user as AuthSessionUser;
  if (botId ? !(await canUseDevBotModule(user, botId, guildId, CUSTOM_PANELS_MODULE_ID)) : !canManageDashboardGuild(user, guildId)) {
    throw createServiceError(`Você não tem permissão para ${action}.`, 403);
  }
}

async function assertCanReadGuild(req: Request, guildId: string, botId: string | null, action: string) {
  const user = req.res?.locals.dashboardAuth.user as AuthSessionUser;
  if (botId ? !(await canReadDevBotModule(user, botId, guildId, CUSTOM_PANELS_MODULE_ID)) : !canManageDashboardGuild(user, guildId)) {
    throw createServiceError(`Você não tem permissão para ${action}.`, 403);
  }
}

async function assertPanelChannelReady(guildId: string, channelId: string, botId: string | null) {
  const validation = await validateGuildPanelChannel(guildId, channelId, await getDevBotToken(botId));
  if (!validation.ok) {
    throw createServiceError(validation.reason ?? "Não foi possível validar o canal do painel.", 400);
  }
}

function requiredParam(value: string | undefined, name: string) {
  if (!value) throw createServiceError(`${name} obrigatório.`, 400);
  return value;
}

function handleRouteError(error: unknown, res: { status: (code: number) => { json: (body: unknown) => unknown } }, next: (error: unknown) => unknown) {
  const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number" ? (error as { statusCode: number }).statusCode : null;
  if (statusCode) {
    return res.status(statusCode).json({
      message: error instanceof Error ? error.message : "Erro inesperado."
    });
  }
  return next(error);
}

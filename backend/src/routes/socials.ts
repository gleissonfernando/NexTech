import { Router, type Request } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { canManageDashboardGuild } from "../services/dashboardGuildAccessService";
import { canReadDevBotModule, canUseDevBotModule, getDevBotToken } from "../services/devBotService";
import { isGuildTextChannel } from "../services/discordOptionsService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import {
  createServiceError,
  createSocialMember,
  deleteSocialMember,
  getBotSocialPanel,
  getSocialNetwork,
  listBotSocialPanels,
  publishSocialPanel,
  removeSocialPanel,
  saveSocialPanelConfig,
  sendSocialPanelTest,
  SOCIAL_PLATFORMS,
  updateSocialMember,
  updateSocialPanelMessageState,
  type SocialPlatform
} from "../services/socialNetworkService";
import { getBotGuildIds } from "../services/statsService";
import type { AuthSessionUser } from "../types/session";

const optionalUrlSchema = z.union([z.string().url().max(2048), z.literal(""), z.null()]).optional();
const socialLinksSchema = z.object(
  Object.fromEntries(SOCIAL_PLATFORMS.map((platform) => [platform, optionalUrlSchema])) as Record<SocialPlatform, typeof optionalUrlSchema>
).partial();

const createMemberSchema = z.object({
  name: z.string().min(1).max(80),
  avatar: optionalUrlSchema,
  discordId: z.union([z.string().regex(/^\d{5,32}$/), z.literal(""), z.null()]).optional(),
  role: z.union([z.string().max(80), z.literal(""), z.null()]).optional(),
  links: socialLinksSchema.default({})
});

const updateMemberSchema = createMemberSchema.partial();

const panelSchema = z.object({
  channelId: z.string().regex(/^\d{5,32}$/),
  embedColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional().nullable()
});

const updatePanelSchema = z.object({
  guildId: z.string().regex(/^\d{5,32}$/),
  channelId: z.string().regex(/^\d{5,32}$/).optional(),
  embedColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional().nullable()
});

const panelStateSchema = z.object({
  messageId: z.string().regex(/^\d{5,32}$/).nullable().optional(),
  published: z.boolean().optional()
});

export const socialsRouter = Router();

socialsRouter.get("/bot/panels", requireBot, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const panels = await listBotSocialPanels(botId);
    const botGuildIds = getBotGuildIds();

    return res.json({
      panels: botId ? panels : botGuildIds.size > 0 ? panels.filter((payload) => botGuildIds.has(payload.panel.guildId)) : []
    });
  } catch (error) {
    return next(error);
  }
});

socialsRouter.get("/bot/panels/:panelId", requireBot, async (req, res, next) => {
  try {
    const panelId = getRequiredParam(req.params.panelId, "panelId");
    const botId = await resolveRequestBotId(req);

    return res.json(await getBotSocialPanel(panelId, botId));
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

socialsRouter.patch("/bot/panels/:panelId/state", requireBot, async (req, res, next) => {
  try {
    const panelId = getRequiredParam(req.params.panelId, "panelId");
    const botId = await resolveRequestBotId(req);
    const input = panelStateSchema.parse(req.body);
    const panel = await updateSocialPanelMessageState(panelId, input, botId);

    return res.json({
      panel
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

socialsRouter.post("/update", requireAuth, async (req, res, next) => {
  try {
    const input = updatePanelSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageGuild(req, input.guildId, botId, "publicou a Network");

    if (input.channelId) {
      await assertChannelBelongsToGuild(input.guildId, input.channelId, botId);
    }

    const result = await publishSocialPanel(input.guildId, {
      channelId: input.channelId,
      embedColor: input.embedColor,
      userId: user.discordId
    }, botId);

    return res.json(result);
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

socialsRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);

    await assertCanReadGuild(req, guildId, botId, "visualizou a Network");

    return res.json(await getSocialNetwork(guildId, botId));
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

socialsRouter.post("/:guildId/members", requireAuth, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageGuild(req, guildId, botId, "adicionou membro na Network");

    const input = createMemberSchema.parse(req.body);
    const member = await createSocialMember(guildId, {
      ...input,
      actorId: user.discordId,
      botId
    });

    return res.status(201).json({
      member
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

socialsRouter.patch("/:guildId/members/:memberId", requireAuth, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const memberId = getRequiredParam(req.params.memberId, "memberId");
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageGuild(req, guildId, botId, "editou membro da Network");

    const input = updateMemberSchema.parse(req.body);
    const member = await updateSocialMember(guildId, memberId, input, user.discordId, botId);

    return res.json({
      member
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

socialsRouter.delete("/:guildId/members/:memberId", requireAuth, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const memberId = getRequiredParam(req.params.memberId, "memberId");
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageGuild(req, guildId, botId, "removeu membro da Network");

    const member = await deleteSocialMember(guildId, memberId, user.discordId, botId);

    return res.json({
      member
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

socialsRouter.put("/:guildId/panel", requireAuth, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageGuild(req, guildId, botId, "configurou o canal da Network");

    const input = panelSchema.parse(req.body);
    await assertChannelBelongsToGuild(guildId, input.channelId, botId);

    const panel = await saveSocialPanelConfig(guildId, {
      ...input,
      userId: user.discordId
    }, botId);

    return res.json({
      panel
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

socialsRouter.post("/:guildId/panel/test", requireAuth, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageGuild(req, guildId, botId, "testar o painel Network");

    const input = panelSchema.parse(req.body);
    await assertChannelBelongsToGuild(guildId, input.channelId, botId);

    const result = await sendSocialPanelTest(guildId, {
      ...input,
      botToken: await getDevBotToken(botId),
      userId: user.discordId
    }, botId);

    return res.json({
      ok: true,
      ...result
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

socialsRouter.post("/:guildId/panel/remove", requireAuth, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageGuild(req, guildId, botId, "removeu o painel Network");

    const panel = await removeSocialPanel(guildId, user.discordId, botId);

    return res.json({
      panel
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

async function assertCanManageGuild(req: Request, guildId: string, botId: string | null, action: string) {
  const user = req.res?.locals.dashboardAuth.user as AuthSessionUser;

  if (botId ? !(await canUseDevBotModule(user, botId, guildId, "network")) : !canManageDashboardGuild(user, guildId)) {
    throw createServiceError(`Voce nao tem permissao para ${action} deste servidor.`, 403);
  }
}

async function assertCanReadGuild(req: Request, guildId: string, botId: string | null, action: string) {
  const user = req.res?.locals.dashboardAuth.user as AuthSessionUser;

  if (botId ? !(await canReadDevBotModule(user, botId, guildId, "network")) : !canManageDashboardGuild(user, guildId)) {
    throw createServiceError(`Voce nao tem permissao para ${action} deste servidor.`, 403);
  }
}

async function assertChannelBelongsToGuild(guildId: string, channelId: string, botId: string | null) {
  const validChannel = await isGuildTextChannel(guildId, channelId, await getDevBotToken(botId));

  if (!validChannel) {
    throw createServiceError("Selecione um canal de texto que pertence ao servidor configurado.", 400);
  }
}

function getRequiredParam(value: string | undefined, name: string) {
  if (!value) {
    throw createServiceError(`${name} obrigatorio.`, 400);
  }

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

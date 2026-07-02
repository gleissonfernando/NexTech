import { Router, raw } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { canAccessDevBotGuild, canManageDevBotGuild, canReadDevBotModule, canUseDevBotModule } from "../services/devBotService";
import {
  getPanelImageSettings,
  listPanelImageSettings,
  savePanelImageUpload,
  savePanelImageSettings
} from "../services/panelImageSettingsService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import type { AuthSessionUser } from "../types/session";

const MODULE_ID = "verification";
const guildIdSchema = z.string().regex(/^\d{5,32}$/);
const panelIdSchema = z.string().min(2).max(80).regex(/^[a-z0-9_-]+$/i);
const settingsSchema = z.object({
  customHeight: z.coerce.number().int().min(16).max(2000).nullable().optional(),
  customWidth: z.coerce.number().int().min(16).max(2000).nullable().optional(),
  imageEnabled: z.boolean().optional(),
  imagePosition: z.enum(["banner", "thumbnail", "top", "below_title", "middle", "bottom", "side", "footer", "before_buttons", "below_text", "above_buttons", "none"]).optional(),
  imageSize: z.enum(["small", "medium", "large", "full_banner", "custom"]).optional(),
  imageUrl: z.string().max(2048).optional(),
  layoutMode: z.enum(["embed", "components_v2"]).optional(),
  useGlobalDefault: z.boolean().optional()
});
const panelImageUpload = raw({
  limit: "10mb",
  type: ["image/gif", "image/jpeg", "image/png", "image/webp"]
});

export const panelImagesRouter = Router();

panelImagesRouter.get("/bot/:guildId/:panelId", requireBot, async (req, res, next) => {
  try { const guildId = guildIdSchema.parse(req.params.guildId); const panelId = panelIdSchema.parse(req.params.panelId); const botId = await readRequiredBotId(req); return res.json({ settings: await getPanelImageSettings(guildId, botId, panelId) }); } catch (error) { return next(error); }
});

panelImagesRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);

    await assertCanRead(res.locals.dashboardAuth.user, guildId, botId);

    return res.json({
      settings: await listPanelImageSettings(guildId, botId)
    });
  } catch (error) {
    return next(error);
  }
});

panelImagesRouter.get("/:guildId/:panelId", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const panelId = panelIdSchema.parse(req.params.panelId);
    const botId = await readRequiredBotId(req);

    await assertCanRead(res.locals.dashboardAuth.user, guildId, botId, moduleIdForPanel(panelId));

    return res.json({
      settings: await getPanelImageSettings(guildId, botId, panelId)
    });
  } catch (error) {
    return next(error);
  }
});

panelImagesRouter.put("/:guildId/:panelId", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const panelId = panelIdSchema.parse(req.params.panelId);
    const botId = await readRequiredBotId(req);
    const input = settingsSchema.parse(req.body);
    const user = res.locals.dashboardAuth.user;

    await assertCanManage(user, guildId, botId, moduleIdForPanel(panelId));

    return res.json({
      settings: await savePanelImageSettings(guildId, botId, panelId, input, user.discordId)
    });
  } catch (error) {
    return next(error);
  }
});

panelImagesRouter.put("/:guildId/:panelId/upload", requireAuth, panelImageUpload, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const panelId = panelIdSchema.parse(req.params.panelId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user;
    const mimeType = req.header("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";

    await assertCanManage(user, guildId, botId, moduleIdForPanel(panelId));

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw createRouteError("Envie uma imagem para o painel.", 400);
    }

    return res.json({
      settings: await savePanelImageUpload({
        actorId: user.discordId,
        botId,
        buffer: req.body,
        guildId,
        mimeType,
        panelId
      })
    });
  } catch (error) {
    return next(error);
  }
});

async function readRequiredBotId(req: Parameters<typeof resolveRequestBotId>[0]) {
  const botId = await resolveRequestBotId(req);

  if (!botId) {
    throw createRouteError("Escolha um bot cadastrado para configurar imagens de painel.", 400);
  }

  return botId;
}

async function assertCanRead(user: AuthSessionUser, guildId: string, botId: string, moduleId = MODULE_ID) {
  if (await canReadDevBotModule(user, botId, guildId, moduleId) || await canAccessDevBotGuild(user, botId, guildId)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para ver imagens dos paineis deste bot.", 403);
}

async function assertCanManage(user: AuthSessionUser, guildId: string, botId: string, moduleId = MODULE_ID) {
  if (await canUseDevBotModule(user, botId, guildId, moduleId) || await canManageDevBotGuild(user, botId, guildId)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para configurar imagens dos paineis deste bot.", 403);
}

function moduleIdForPanel(panelId: string) {
  if (panelId === "manual-registration") return "manual-registration";
  if (panelId === "fivem-orders") return "fivem-orders";
  return MODULE_ID;
}

function createRouteError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}

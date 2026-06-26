import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { canReadDevBotModule, canUseDevBotModule } from "../services/devBotService";
import {
  getPanelImageSettings,
  listPanelImageSettings,
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
  imagePosition: z.enum(["banner", "thumbnail", "top", "below_text", "above_buttons", "footer", "none"]).optional(),
  imageSize: z.enum(["small", "medium", "large", "full_banner", "custom"]).optional(),
  imageUrl: z.string().max(2048).optional(),
  layoutMode: z.enum(["embed", "components_v2"]).optional()
});

export const panelImagesRouter = Router();

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

    await assertCanRead(res.locals.dashboardAuth.user, guildId, botId);

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

    await assertCanManage(user, guildId, botId);

    return res.json({
      settings: await savePanelImageSettings(guildId, botId, panelId, input, user.discordId)
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

async function assertCanRead(user: AuthSessionUser, guildId: string, botId: string) {
  if (await canReadDevBotModule(user, botId, guildId, MODULE_ID)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para ver imagens dos paineis deste bot.", 403);
}

async function assertCanManage(user: AuthSessionUser, guildId: string, botId: string) {
  if (await canUseDevBotModule(user, botId, guildId, MODULE_ID)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para configurar imagens dos paineis deste bot.", 403);
}

function createRouteError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}

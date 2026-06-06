import { Router, raw } from "express";
import { z } from "zod";
import { isBotRequest, requireAdminAccess, requireAuth, requireAuthOrBot } from "../middleware/auth";
import { emitRealtime } from "../realtime/events";
import { canManageDashboardGuild, canReadDashboardGuild } from "../services/dashboardGuildAccessService";
import { getGuildSettings, updateGuildSettings } from "../services/settingsService";
import { saveWelcomeImage, sendWelcomePanelToDiscord } from "../services/welcomePanelService";

const settingsSchema = z.object({
  welcomeEnabled: z.boolean().optional(),
  welcomeChannelId: z.string().nullable().optional(),
  welcomeDisplayChannelId: z.string().nullable().optional(),
  welcomeImageUrl: z.string().max(2048).nullable().optional(),
  welcomeMessage: z.string().nullable().optional(),
  autoRoleEnabled: z.boolean().optional(),
  autoRoleIds: z.array(z.string()).optional(),
  twitchRoleId: z.string().nullable().optional(),
  boosterRoleId: z.string().nullable().optional(),
  ticketEnabled: z.boolean().optional(),
  ticketCategoryId: z.string().nullable().optional(),
  logChannelId: z.string().nullable().optional(),
  moderationEnabled: z.boolean().optional(),
  verificationEnabled: z.boolean().optional(),
  verificationRoleId: z.string().nullable().optional()
});

export const settingsRouter = Router();
const welcomeImageUpload = raw({
  limit: "10mb",
  type: ["image/gif", "image/jpeg", "image/png", "image/webp"]
});

settingsRouter.get("/:guildId", requireAuthOrBot, async (req, res) => {
  const { guildId } = req.params;

  if (!guildId) {
    return res.status(400).json({
      message: "guildId obrigatorio."
    });
  }

  if (!isBotRequest(req) && !canReadDashboardGuild(res.locals.dashboardAuth.user, guildId)) {
    return res.status(403).json({
      message: "Servidor nao encontrado ou sem o bot."
    });
  }

  return res.json({
    settings: await getGuildSettings(guildId)
  });
});

settingsRouter.put("/:guildId/welcome-image", requireAuth, requireAdminAccess, welcomeImageUpload, async (req, res, next) => {
  try {
    const { guildId } = req.params;

    if (!guildId) {
      return res.status(400).json({
        message: "guildId obrigatorio."
      });
    }

    if (!canManageDashboardGuild(res.locals.dashboardAuth.user, guildId)) {
      return res.status(403).json({
        message: "Voce nao tem permissao para configurar este servidor."
      });
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({
        message: "Arquivo de imagem obrigatorio."
      });
    }

    const mimeType = req.header("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    const welcomeImageUrl = await saveWelcomeImage(guildId, req.body, mimeType);
    const settings = await updateGuildSettings(guildId, {
      welcomeImageUrl
    });

    emitRealtime("settings:updated", settings);

    return res.json({
      settings
    });
  } catch (error) {
    return next(error);
  }
});

settingsRouter.post("/:guildId/welcome-test", requireAuth, requireAdminAccess, async (req, res, next) => {
  try {
    const { guildId } = req.params;
    const user = res.locals.dashboardAuth.user;

    if (!guildId) {
      return res.status(400).json({
        message: "guildId obrigatorio."
      });
    }

    if (!canManageDashboardGuild(user, guildId)) {
      return res.status(403).json({
        message: "Voce nao tem permissao para configurar este servidor."
      });
    }

    const settings = await getGuildSettings(guildId);

    await sendWelcomePanelToDiscord(settings, `<@${user.discordId}>`);

    return res.json({
      ok: true
    });
  } catch (error) {
    if (error instanceof Error) {
      return res.status(400).json({
        message: error.message
      });
    }

    return next(error);
  }
});

settingsRouter.patch("/:guildId", requireAuth, requireAdminAccess, async (req, res, next) => {
  try {
    const { guildId } = req.params;

    if (!guildId) {
      return res.status(400).json({
        message: "guildId obrigatorio."
      });
    }

    if (!canManageDashboardGuild(res.locals.dashboardAuth.user, guildId)) {
      return res.status(403).json({
        message: "Voce nao tem permissao para configurar este servidor."
      });
    }

    const input = settingsSchema.parse(req.body);
    const settings = await updateGuildSettings(guildId, input);

    emitRealtime("settings:updated", settings);

    return res.json({
      settings
    });
  } catch (error) {
    return next(error);
  }
});

import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAuthOrBot } from "../middleware/auth";
import { emitRealtime } from "../realtime/events";
import { getGuildSettings, updateGuildSettings } from "../services/settingsService";

const settingsSchema = z.object({
  welcomeEnabled: z.boolean().optional(),
  welcomeChannelId: z.string().nullable().optional(),
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

settingsRouter.get("/:guildId", requireAuthOrBot, async (req, res) => {
  const { guildId } = req.params;

  if (!guildId) {
    return res.status(400).json({
      message: "guildId obrigatorio."
    });
  }

  return res.json({
    settings: await getGuildSettings(guildId)
  });
});

settingsRouter.patch("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const { guildId } = req.params;

    if (!guildId) {
      return res.status(400).json({
        message: "guildId obrigatorio."
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

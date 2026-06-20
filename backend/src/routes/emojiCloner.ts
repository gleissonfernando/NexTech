import { Router } from "express";
import { z } from "zod";
import { requireBot } from "../middleware/auth";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import { recordEmojiCloneJob } from "../services/emojiCloneService";

const itemSchema = z.object({
  originalEmojiId: z.string().min(1).max(64),
  originalName: z.string().min(1).max(64),
  newEmojiId: z.string().max(64).nullable().optional(),
  newName: z.string().max(64).nullable().optional(),
  animated: z.boolean(),
  status: z.enum(["pending", "success", "failed"]),
  errorReason: z.string().max(500).nullable().optional()
});

const jobSchema = z.object({
  guildId: z.string().regex(/^\d{5,32}$/),
  userId: z.string().regex(/^\d{5,32}$/),
  sourceGuildId: z.string().regex(/^\d{5,32}$/).nullable().optional(),
  status: z.enum(["pending", "running", "completed", "cancelled"]),
  total: z.number().int().min(0).max(100),
  success: z.number().int().min(0).max(100),
  failed: z.number().int().min(0).max(100),
  prefix: z.string().max(24).nullable().optional(),
  createdAt: z.string().datetime().nullable().optional(),
  finishedAt: z.string().datetime().nullable().optional(),
  items: z.array(itemSchema).max(100)
});

export const emojiClonerRouter = Router();

emojiClonerRouter.post("/bot/jobs", requireBot, async (req, res, next) => {
  try {
    const input = jobSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    const job = await recordEmojiCloneJob({
      ...input,
      botId
    });

    return res.json({ job });
  } catch (error) {
    return next(error);
  }
});

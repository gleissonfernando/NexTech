import { Router, type Request } from "express";
import { z } from "zod";
import {
  getPublicNexTechInvitePage,
  recordPublicNexTechInviteClick,
  recordPublicNexTechInviteView
} from "../services/nexTechInviteService";

const codeSchema = z.string().min(2).max(80).regex(/^[a-z0-9_-]+$/i);
const clickSchema = z.object({
  target: z.enum(["app", "browser", "official"]).default("official")
});

export const invitePagesRouter = Router();

invitePagesRouter.get("/:code", async (req, res, next) => {
  try {
    const code = codeSchema.parse(req.params.code);
    const page = await getPublicNexTechInvitePage(code);
    if (!page) return res.status(404).json({ message: "Convite inválido ou expirado." });
    await recordPublicNexTechInviteView(page.invite.id, {
      ip: clientIp(req),
      referrer: req.get("referer") ?? null,
      source: typeof req.query.source === "string" ? req.query.source : null,
      userAgent: req.get("user-agent") ?? null
    }).catch(() => undefined);
    res.setHeader("Cache-Control", page.valid ? "public, max-age=60" : "no-store");
    return res.json(page);
  } catch (error) {
    return next(error);
  }
});

invitePagesRouter.post("/:code/click", async (req, res, next) => {
  try {
    const code = codeSchema.parse(req.params.code);
    const { target } = clickSchema.parse(req.body ?? {});
    const page = await getPublicNexTechInvitePage(code);
    if (!page) return res.status(404).json({ message: "Convite inválido ou expirado." });
    await recordPublicNexTechInviteClick(page.invite.id, target);
    return res.json({ ok: true, redirectUrl: page.redirectUrl });
  } catch (error) {
    return next(error);
  }
});

function clientIp(req: Request) {
  const forwarded = req.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.socket.remoteAddress || null;
}

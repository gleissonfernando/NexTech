import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { canReadDevBotModule, canUseDevBotModule, getBotApiPermissions } from "../services/devBotService";
import {
  createDmBarLog,
  DM_BAR_MODULE_ID,
  getDmBarConfig,
  getDmBarDashboard,
  removeDmBarImage,
  resetDmBarConfig,
  saveDmBarConfig,
  uploadDmBarImage
} from "../services/dmBarService";
import { PERSISTENT_IMAGE_MAX_BYTES } from "../services/persistentImageStorageService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: PERSISTENT_IMAGE_MAX_BYTES, files: 1, fields: 3 } });
const snowflake = z.string().regex(/^\d{5,32}$/);
const imageType = z.enum(["main", "footer"]);
const configSchema = z.object({
  accentColor: z.string().optional(),
  allowAdmins: z.boolean().optional(),
  allowedRoleIds: z.array(snowflake).max(100).optional(),
  allowedUserIds: z.array(snowflake).max(100).optional(),
  allowMentions: z.boolean().optional(),
  cooldownSeconds: z.coerce.number().int().min(0).max(3600).optional(),
  descriptionTemplate: z.string().max(3000).optional(),
  enabled: z.boolean().optional(),
  emoji: z.string().max(80).optional(),
  footerEnabled: z.boolean().optional(),
  footerIconUrl: z.string().nullable().optional(),
  footerText: z.string().max(300).optional(),
  imagePosition: z.enum(["top", "middle", "bottom", "gallery", "thumbnail", "none"]).optional(),
  logChannelId: snowflake.nullable().optional(),
  logsEnabled: z.boolean().optional(),
  mainImageUrl: z.string().nullable().optional(),
  showDate: z.boolean().optional(),
  showSender: z.boolean().optional(),
  showServer: z.boolean().optional(),
  showTargetId: z.boolean().optional(),
  signature: z.string().max(300).optional(),
  titleTemplate: z.string().max(120).optional()
});
const logSchema = z.object({
  errorReason: z.string().max(1000).nullable().optional(),
  message: z.string().max(4000).default(""),
  senderId: snowflake,
  status: z.enum(["sent", "failed", "denied", "cancelled", "test"]),
  targetId: snowflake.nullable().optional(),
  title: z.string().max(180).default("Barra DM")
});

export const dmBarRouter = Router();

dmBarRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, false);
    res.json(await getDmBarDashboard(botId, guildId));
  } catch (error) { next(error); }
});

dmBarRouter.patch("/:guildId/config", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json({ config: await saveDmBarConfig(botId, guildId, configSchema.parse(req.body), res.locals.dashboardAuth.user.discordId) });
  } catch (error) { next(error); }
});

dmBarRouter.post("/:guildId/reset", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json({ config: await resetDmBarConfig(botId, guildId, res.locals.dashboardAuth.user.discordId) });
  } catch (error) { next(error); }
});

dmBarRouter.post("/:guildId/images/:imageType", requireAuth, upload.single("file"), async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const kind = imageType.parse(req.params.imageType);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    if (!req.file) throw routeError("Arquivo de imagem obrigatório.", 400);
    res.status(201).json(await uploadDmBarImage({ actorId: res.locals.dashboardAuth.user.discordId, botId, buffer: req.file.buffer, guildId, imageType: kind, mimeType: req.file.mimetype, originalName: req.file.originalname }));
  } catch (error) { next(error); }
});

dmBarRouter.delete("/:guildId/images/:imageType", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const kind = imageType.parse(req.params.imageType);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json({ config: await removeDmBarImage(botId, guildId, kind, res.locals.dashboardAuth.user.discordId) });
  } catch (error) { next(error); }
});

dmBarRouter.get("/bot/:guildId/config", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json({ config: await getDmBarConfig(botId, snowflake.parse(req.params.guildId)) });
  } catch (error) { next(error); }
});

dmBarRouter.post("/bot/:guildId/logs", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    const guildId = snowflake.parse(req.params.guildId);
    const input = logSchema.parse(req.body);
    res.status(201).json({ log: await createDmBarLog(botId, guildId, { ...input, errorReason: input.errorReason ?? null, targetId: input.targetId ?? null }) });
  } catch (error) { next(error); }
});

async function botIdFor(req: any) {
  const value = await resolveRequestBotId(req);
  if (!value) throw routeError("Bot não identificado.", 400);
  return value;
}
async function licensed(botId: string) {
  const permissions = await getBotApiPermissions(botId);
  if (!permissions) throw routeError("Bot não encontrado.", 404);
  if (!permissions.enabledModules.includes(DM_BAR_MODULE_ID)) throw routeError("Barra DM não liberado.", 403);
}
async function authorize(user: any, botId: string, guildId: string, manage: boolean) {
  await licensed(botId);
  const allowed = manage ? await canUseDevBotModule(user, botId, guildId, DM_BAR_MODULE_ID) : await canReadDevBotModule(user, botId, guildId, DM_BAR_MODULE_ID);
  if (!allowed) throw routeError("Sem permissão para Barra DM.", 403);
}
function routeError(message: string, statusCode: number) { return Object.assign(new Error(message), { statusCode }); }

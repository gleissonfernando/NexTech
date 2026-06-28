import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { canUseDevBotModule } from "../services/devBotService";
import { isDevUser } from "../services/devAccessService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import {
  MEDIA_LIMITS,
  addManualMedia,
  cancelImportJob,
  confirmImportJob,
  createImportJob,
  deleteMediaItem,
  getImportJob,
  getMediaSettings,
  listImportJobs,
  listMediaLibrary,
  saveMediaSettings,
  streamMediaExport
} from "../services/mediaLibraryService";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MEDIA_LIMITS.maxZipBytes, files: 1, fields: 12 }
});
const singleUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MEDIA_LIMITS.maxSoundBytes, files: 1, fields: 12 }
});
const guildSchema = z.string().regex(/^\d{5,32}$/);
const duplicateSchema = z.enum(["ignore", "rename", "replace"]);
const settingsSchema = z.object({
  enabled: z.boolean(),
  allowAuthorizedUsers: z.boolean(),
  devOnly: z.boolean(),
  duplicateMode: duplicateSchema,
  soundsLocalOnly: z.boolean(),
  maxZipSizeMb: z.number().int().min(1).max(50),
  maxFilesPerZip: z.number().int().min(1).max(300)
});

export const mediaRouter = Router();
mediaRouter.use(requireAuth);

mediaRouter.get("/settings", async (req, res, next) => {
  try {
    const scope = await resolveScope(req, res, false);
    return res.json({ settings: await getMediaSettings(scope.botId, scope.guildId) });
  } catch (error) { return next(error); }
});

mediaRouter.patch("/settings", async (req, res, next) => {
  try {
    const scope = await resolveScope(req, res, false);
    if (!isDevUser(res.locals.dashboardAuth.user)) return res.status(403).json({ message: "Somente o Dev pode alterar a configuração da Biblioteca de Mídia." });
    const settings = settingsSchema.parse(req.body);
    return res.json({ settings: await saveMediaSettings({ ...scope, settings }) });
  } catch (error) { return next(error); }
});

mediaRouter.post("/upload-zip", upload.single("file"), async (req, res, next) => {
  try {
    const scope = await resolveScope(req, res);
    if (!req.file) return res.status(400).json({ message: "Envie um arquivo ZIP no campo file." });
    const duplicateMode = req.body.duplicateMode ? duplicateSchema.parse(req.body.duplicateMode) : undefined;
    const job = await createImportJob({ ...scope, originalName: req.file.originalname, zip: req.file.buffer, duplicateMode });
    return res.status(201).json({ job });
  } catch (error) { return next(error); }
});

mediaRouter.get("/import-jobs", async (req, res, next) => {
  try { const scope = await resolveScope(req, res); return res.json({ jobs: await listImportJobs(scope.botId, scope.guildId) }); }
  catch (error) { return next(error); }
});

mediaRouter.get("/import-jobs/:jobId", async (req, res, next) => {
  try { const scope = await resolveScope(req, res); return res.json({ job: await getImportJob(req.params.jobId!, scope.botId, scope.guildId) }); }
  catch (error) { return next(error); }
});

mediaRouter.post("/import-jobs/:jobId/confirm", async (req, res, next) => {
  try { const scope = await resolveScope(req, res); const mode = req.body?.duplicateMode ? duplicateSchema.parse(req.body.duplicateMode) : undefined; return res.status(202).json({ job: await confirmImportJob(req.params.jobId!, scope.botId, scope.guildId, scope.userId, mode) }); }
  catch (error) { return next(error); }
});

mediaRouter.post("/import-jobs/:jobId/cancel", async (req, res, next) => {
  try { const scope = await resolveScope(req, res); return res.json(await cancelImportJob(req.params.jobId!, scope.botId, scope.guildId, scope.userId)); }
  catch (error) { return next(error); }
});

mediaRouter.get("/library", async (req, res, next) => {
  try { const scope = await resolveScope(req, res); const type = z.enum(["all", "emoji", "sound"]).optional().parse(req.query.type); const query = z.string().max(80).optional().parse(req.query.q); return res.json({ items: await listMediaLibrary({ botId: scope.botId, guildId: scope.guildId, type, query }) }); }
  catch (error) { return next(error); }
});

mediaRouter.get("/export.zip", async (req, res, next) => {
  try {
    const scope = await resolveScope(req, res);
    const type = z.enum(["all", "static", "animated", "sounds"]).default("all").parse(req.query.type);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=\"emojis-exportados.zip\"");
    res.setHeader("Cache-Control", "no-store");
    await streamMediaExport({ ...scope, type }, res);
  } catch (error) { if (!res.headersSent) return next(error); res.end(); }
});

mediaRouter.post("/emoji", singleUpload.single("file"), async (req, res, next) => {
  try { const scope = await resolveScope(req, res); if (!req.file) return res.status(400).json({ message: "Arquivo do emoji obrigatório." }); const name = z.string().min(2).max(32).parse(req.body.name); const item = await addManualMedia({ ...scope, name, file: req.file.buffer, originalName: req.file.originalname, mimeType: req.file.mimetype, type: "emoji", animated: req.body.animated === "true" }); return res.status(201).json({ item }); }
  catch (error) { return next(error); }
});

mediaRouter.post("/sound", singleUpload.single("file"), async (req, res, next) => {
  try { const scope = await resolveScope(req, res); if (!req.file) return res.status(400).json({ message: "Arquivo de áudio obrigatório." }); const name = z.string().min(1).max(64).parse(req.body.name); const category = z.string().max(64).optional().parse(req.body.category || undefined); const item = await addManualMedia({ ...scope, name, category, file: req.file.buffer, originalName: req.file.originalname, mimeType: req.file.mimetype, type: "sound" }); return res.status(201).json({ item }); }
  catch (error) { return next(error); }
});

mediaRouter.delete("/:id", async (req, res, next) => {
  try { const scope = await resolveScope(req, res); return res.json(await deleteMediaItem(req.params.id!, scope.botId, scope.guildId, scope.userId)); }
  catch (error) { return next(error); }
});

async function resolveScope(req: Parameters<typeof resolveRequestBotId>[0], res: any, enforceMediaAccess = true) {
  const botId = await resolveRequestBotId(req);
  const guildId = guildSchema.parse(typeof req.query.guildId === "string" ? req.query.guildId : req.body?.guildId);
  const user = res.locals.dashboardAuth.user;
  if (!botId) throw Object.assign(new Error("Selecione um bot."), { statusCode: 400 });
  if (!(await canUseDevBotModule(user, botId, guildId, "emoji-cloner"))) throw Object.assign(new Error("Biblioteca de Mídia não liberada para este bot ou servidor."), { statusCode: 403 });
  if (enforceMediaAccess) {
    const settings = await getMediaSettings(botId, guildId);
    if ((settings.devOnly || !settings.allowAuthorizedUsers) && !isDevUser(user)) throw Object.assign(new Error("A Biblioteca de Mídia está liberada somente para o Dev."), { statusCode: 403 });
  }
  return { botId, guildId, userId: user.discordId };
}

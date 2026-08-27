import { Router, type Request } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot, requireBot } from "../middleware/auth";
import { getMongoDb } from "../database/mongo";
import { canManageDashboardGuild, canReadDashboardGuild } from "../services/dashboardGuildAccessService";
import { authorizeBotRuntimeModule, canReadDevBotModule, canUseDevBotModule } from "../services/devBotService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import {
  createSystemUpdate,
  deleteUpdateCategory,
  deleteUpdateRule,
  getUpdatesDashboard,
  previewSystemUpdate,
  publishSystemUpdate,
  saveUpdateCategory,
  saveUpdateRule,
  saveUpdateSettings,
  UPDATES_MODULE_ID
} from "../services/updateSystemService";

const COLLECTION = "system_update_changelogs";

export const systemUpdatesRouter = Router();

const snowflake = z.string().regex(/^\d{5,32}$/);
const optionalSnowflake = z.union([snowflake, z.literal(""), z.null()]).optional();

const changeSchema = z.union([
  z.string().min(1).max(220),
  z.object({
    id: z.string().max(80).optional(),
    text: z.string().min(1).max(220),
    type: z.enum(["added", "fixed", "improved", "removed", "security", "performance", "interface", "config", "other"]).optional(),
    categoryId: z.string().max(120).nullable().optional()
  })
]);

const updateSchema = z.object({
  autoClassify: z.boolean().optional(),
  bannerUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  changes: z.array(changeSchema).max(60).optional(),
  date: z.string().max(80).nullable().optional(),
  description: z.string().max(1800).nullable().optional(),
  finalCategoryIds: z.array(z.string().max(120)).max(12).optional(),
  publishNow: z.boolean().optional(),
  scheduledFor: z.string().max(80).nullable().optional(),
  sourceEvent: z.string().max(80).nullable().optional(),
  sourceModule: z.string().max(80).nullable().optional(),
  status: z.enum(["DRAFT", "SCHEDULED", "PUBLISHED", "CANCELLED", "ERROR"]).optional(),
  title: z.string().min(1).max(180),
  version: z.string().max(48).nullable().optional()
});

const settingsSchema = z.object({
  autoPublishInternalEvents: z.boolean().optional(),
  lowConfidenceThreshold: z.coerce.number().int().min(1).max(100).optional(),
  mode: z.enum(["single", "per_category"]).optional(),
  requireConfirmationBelowThreshold: z.boolean().optional(),
  singleChannelId: optionalSnowflake
});

const categorySchema = z.object({
  autoClassificationEnabled: z.boolean().optional(),
  channelId: optionalSnowflake,
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  emoji: z.string().max(24).optional(),
  enabled: z.boolean().optional(),
  id: z.string().max(120).optional(),
  keywords: z.array(z.string().max(80)).max(40).optional(),
  name: z.string().min(1).max(80),
  priority: z.coerce.number().int().min(0).max(1000).optional(),
  slug: z.string().max(80).optional()
});

const ruleSchema = z.object({
  categoryId: z.string().min(1).max(120),
  enabled: z.boolean().optional(),
  id: z.string().max(120).optional(),
  priority: z.coerce.number().int().min(0).max(1000).optional(),
  terms: z.array(z.string().min(1).max(80)).min(1).max(40)
});

systemUpdatesRouter.use((req, res, next) => {
  if (req.path.startsWith("/internal/changelog")) return next();
  return requireAuthOrBot(req, res, next);
});

systemUpdatesRouter.get("/:guildId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId) return res.status(400).json({ message: "botId obrigatório." });
    if (isBotRequest(req)) await assertRuntime(botId, guildId);
    else if (!(await canRead(req, guildId, botId))) return res.status(403).json({ message: "Sistema de Atualizações não liberado." });
    return res.json(await getUpdatesDashboard(botId, guildId));
  } catch (error) {
    return next(error);
  }
});

systemUpdatesRouter.put("/:guildId/settings", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId) return res.status(400).json({ message: "botId obrigatório." });
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para configurar atualizações." });
    return res.json({ settings: await saveUpdateSettings(botId, guildId, settingsSchema.parse(req.body ?? {}), res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    return next(error);
  }
});

systemUpdatesRouter.post("/:guildId/preview", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId) return res.status(400).json({ message: "botId obrigatório." });
    if (isBotRequest(req) || !(await canRead(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para ver preview." });
    return res.json({ preview: await previewSystemUpdate(botId, guildId, updateSchema.parse(req.body ?? {})) });
  } catch (error) {
    return next(error);
  }
});

systemUpdatesRouter.post("/:guildId/updates", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId) return res.status(400).json({ message: "botId obrigatório." });
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para criar atualizações." });
    const update = await createSystemUpdate(botId, guildId, updateSchema.parse(req.body ?? {}), res.locals.dashboardAuth.user.discordId);
    return res.status(201).json({ update });
  } catch (error) {
    return next(error);
  }
});

systemUpdatesRouter.post("/:guildId/updates/:updateId/publish", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const updateId = z.string().min(1).max(120).parse(req.params.updateId);
    const botId = await resolveRequestBotId(req);
    if (!botId) return res.status(400).json({ message: "botId obrigatório." });
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para publicar atualizações." });
    return res.json({ update: await publishSystemUpdate(botId, guildId, updateId, res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    return next(error);
  }
});

systemUpdatesRouter.post("/:guildId/categories", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId) return res.status(400).json({ message: "botId obrigatório." });
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para configurar categorias." });
    return res.status(201).json({ category: await saveUpdateCategory(botId, guildId, categorySchema.parse(req.body ?? {}), res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    return next(error);
  }
});

systemUpdatesRouter.patch("/:guildId/categories/:categoryId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId) return res.status(400).json({ message: "botId obrigatório." });
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para configurar categorias." });
    return res.json({ category: await saveUpdateCategory(botId, guildId, { ...categorySchema.partial().parse(req.body ?? {}), id: req.params.categoryId }, res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    return next(error);
  }
});

systemUpdatesRouter.delete("/:guildId/categories/:categoryId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const categoryId = z.string().min(1).max(120).parse(req.params.categoryId);
    const botId = await resolveRequestBotId(req);
    if (!botId) return res.status(400).json({ message: "botId obrigatório." });
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para excluir categorias." });
    return res.json({ category: await deleteUpdateCategory(botId, guildId, categoryId) });
  } catch (error) {
    return next(error);
  }
});

systemUpdatesRouter.post("/:guildId/rules", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId) return res.status(400).json({ message: "botId obrigatório." });
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para configurar regras." });
    return res.status(201).json({ rule: await saveUpdateRule(botId, guildId, ruleSchema.parse(req.body ?? {})) });
  } catch (error) {
    return next(error);
  }
});

systemUpdatesRouter.delete("/:guildId/rules/:ruleId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const ruleId = z.string().min(1).max(120).parse(req.params.ruleId);
    const botId = await resolveRequestBotId(req);
    if (!botId) return res.status(400).json({ message: "botId obrigatório." });
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para excluir regras." });
    return res.json({ rule: await deleteUpdateRule(botId, guildId, ruleId) });
  } catch (error) {
    return next(error);
  }
});

systemUpdatesRouter.post("/bot/:guildId/events", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId) return res.status(400).json({ message: "botId obrigatório." });
    await assertRuntime(botId, guildId);
    const update = await createSystemUpdate(botId, guildId, { ...updateSchema.parse(req.body ?? {}), publishNow: true }, null);
    return res.status(201).json({ update });
  } catch (error) {
    return next(error);
  }
});

systemUpdatesRouter.post("/internal/changelog", async (req, res, next) => {
  try {
    if (!isBotRequest(req)) {
      return res.status(401).json({ error: "Token interno inválido." });
    }

    const changelog = normalizeChangelog(req.body?.changelog);
    const publication = req.body?.publication && typeof req.body.publication === "object" ? req.body.publication : {};
    if (!changelog) {
      return res.status(400).json({ error: "Changelog inválido." });
    }

    const db = await getMongoDb();
    const collection = db.collection(COLLECTION);
    await collection.createIndex({ commitHash: 1 }, { unique: true });
    await collection.createIndex({ publishedAt: -1 });
    await collection.updateOne(
      { commitHash: changelog.commitHash },
      {
        $set: {
          ...changelog,
          publication,
          updatedAt: new Date().toISOString()
        },
        $setOnInsert: {
          createdAt: new Date().toISOString()
        }
      },
      { upsert: true }
    );

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

function normalizeChangelog(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const commitHash = asText(record.commitHash, 128);
  const version = asText(record.version, 48);
  const title = asText(record.title, 180);
  const publishedAt = asText(record.publishedAt, 64);
  if (!commitHash || !version || !title || !publishedAt) return null;

  return {
    ...record,
    affectedModules: Array.isArray(record.affectedModules) ? record.affectedModules.map((item) => asText(item, 120)).filter(Boolean) : [],
    categories: normalizeCategories(record.categories),
    commitHash,
    commitShort: asText(record.commitShort, 24),
    description: asText(record.description, 240),
    files: Array.isArray(record.files) ? record.files.slice(0, 250) : [],
    id: asText(record.id, 128) || commitHash,
    importantInfo: Array.isArray(record.importantInfo) ? record.importantInfo.map((item) => asText(item, 220)).filter(Boolean) : [],
    internalIdentifier: asText(record.internalIdentifier, 160),
    publishedAt,
    responsible: asText(record.responsible, 120),
    restartRequired: Boolean(record.restartRequired),
    status: asText(record.status, 48),
    statusLabel: asText(record.statusLabel, 160),
    title,
    version
  };
}

function normalizeCategories(value: unknown) {
  const categories = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    correcoes: normalizeItems(categories.correcoes),
    melhorias: normalizeItems(categories.melhorias),
    novidades: normalizeItems(categories.novidades)
  };
}

function normalizeItems(value: unknown) {
  return Array.isArray(value) ? value.map((item) => asText(item, 220)).filter(Boolean).slice(0, 20) : [];
}

function asText(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

async function canRead(req: Request, guildId: string, botId: string | null) {
  if (!botId) return canReadDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
  return canReadDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, UPDATES_MODULE_ID);
}

async function canManage(req: Request, guildId: string, botId: string | null) {
  if (!botId) return canManageDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
  return canUseDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, UPDATES_MODULE_ID);
}

async function assertRuntime(botId: string | null, guildId: string) {
  const authorization = await authorizeBotRuntimeModule({ botId, guildId, moduleId: UPDATES_MODULE_ID });
  if (!authorization.allowed) throw Object.assign(new Error(authorization.reason), { statusCode: 403 });
}

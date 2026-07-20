import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { canReadDevBotModule, canUseDevBotModule, getBotApiPermissions } from "../services/devBotService";
import {
  approvePoliceQruRecord,
  createPoliceQruLog,
  createPoliceQruRecord,
  getPoliceQruDashboard,
  getPoliceQruProfile,
  getPoliceQruRanking,
  getPoliceQruSettings,
  listPoliceQruRecords,
  POLICE_QRU_MODULE_ID,
  rejectPoliceQruRecord,
  resubmitPoliceQruRecord,
  savePoliceQruSettings,
  updatePoliceQruApprovalMessage,
  updatePoliceQruRecordMessage
} from "../services/policeQruService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

const snowflake = z.string().regex(/^\d{5,32}$/);
const id = z.string().uuid();
const nullableSnowflake = snowflake.nullable();
const httpUrl = z.string().url().max(2048).nullable();
const MAX_EVIDENCE_LINKS = 10;
const MAX_EVIDENCE_TEXT_LENGTH = 12_000;
const officerSchema = z.object({
  id: snowflake,
  mention: z.string().max(80),
  name: z.string().min(1).max(100)
});
const settingsSchema = z.object({
  allowedRoleIds: z.array(snowflake).max(100).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  deleteChannelSeconds: z.coerce.number().int().min(0).max(3600).optional(),
  enabled: z.boolean().optional(),
  approvalChannelId: nullableSnowflake.optional(),
  logChannelId: nullableSnowflake.optional(),
  panelDescription: z.string().max(1200).optional(),
  panelImageUrl: httpUrl.optional(),
  panelMessage: z.string().max(1200).optional(),
  panelTitle: z.string().max(200).optional(),
  recordChannelId: nullableSnowflake.optional(),
  rankingChannelId: nullableSnowflake.optional(),
  rankingMessageId: nullableSnowflake.optional(),
  supervisorRoleIds: z.array(snowflake).max(100).optional(),
  teamRoleId: nullableSnowflake.optional(),
  temporaryCategoryId: nullableSnowflake.optional()
});
const recordSchema = z.object({
  authorId: snowflake,
  authorName: z.string().max(100),
  approvalChannelId: snowflake.nullable().optional(),
  approvalMessageId: snowflake.nullable().optional(),
  boNumber: z.string().min(1).max(80),
  evidenceUrl: z.string().max(MAX_EVIDENCE_TEXT_LENGTH).transform(normalizeEvidenceUrls).pipe(z.string().min(1)),
  guildId: snowflake,
  notes: z.string().max(1000).nullable().optional(),
  occurrenceDate: z.string().min(1).max(20),
  officers: z.array(officerSchema).min(1).max(100),
  qruType: z.string().min(1).max(120),
  recordChannelId: snowflake.nullable().optional(),
  recordMessageId: snowflake.nullable().optional(),
  seizures: z.string().max(500).nullable().optional(),
  status: z.enum(["pending", "approved"]).optional(),
  temporaryChannelId: snowflake.nullable().optional(),
  vehicle: z.string().trim().min(1).max(120)
});
const approvalMessageSchema = z.object({
  approvalChannelId: snowflake.nullable().optional(),
  approvalMessageId: snowflake.nullable().optional()
});
const recordMessageSchema = z.object({
  recordChannelId: snowflake.nullable().optional(),
  recordMessageId: snowflake.nullable().optional()
});
const supervisorActionSchema = z.object({
  reason: z.string().min(1).max(1000).optional(),
  supervisorId: snowflake,
  supervisorName: z.string().min(1).max(100)
});

export const policeQruRouter = Router();

policeQruRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, false);
    res.json(await getPoliceQruDashboard(botId, guildId));
  } catch (error) {
    next(error);
  }
});

policeQruRouter.patch("/:guildId/settings", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json({
      settings: await savePoliceQruSettings(botId, guildId, settingsSchema.parse(req.body), res.locals.dashboardAuth.user.discordId)
    });
  } catch (error) {
    next(error);
  }
});

policeQruRouter.get("/:guildId/records", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, false);
    res.json({
      records: await listPoliceQruRecords(botId, guildId, {
        authorId: stringQuery(req.query.authorId),
        boNumber: stringQuery(req.query.boNumber),
        occurrenceDate: stringQuery(req.query.occurrenceDate),
        officerId: stringQuery(req.query.officerId),
        qruType: stringQuery(req.query.qruType)
      }, Number(req.query.limit ?? 50))
    });
  } catch (error) {
    next(error);
  }
});

policeQruRouter.get("/:guildId/ranking", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, false);
    res.json({ ranking: await getPoliceQruRanking(botId, guildId, Number(req.query.limit ?? 20)) });
  } catch (error) {
    next(error);
  }
});

policeQruRouter.get("/bot/:guildId/settings", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json({ settings: await getPoliceQruSettings(botId, snowflake.parse(req.params.guildId)) });
  } catch (error) {
    next(error);
  }
});

policeQruRouter.patch("/bot/:guildId/settings", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    const guildId = snowflake.parse(req.params.guildId);
    await licensed(botId);
    res.json({ settings: await savePoliceQruSettings(botId, guildId, settingsSchema.parse(req.body), null) });
  } catch (error) {
    next(error);
  }
});

policeQruRouter.post("/bot/records", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.status(201).json({ record: await createPoliceQruRecord(botId, recordSchema.parse(req.body)) });
  } catch (error) {
    next(error);
  }
});

policeQruRouter.put("/bot/records/:recordId", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json({ record: await resubmitPoliceQruRecord(botId, id.parse(req.params.recordId), recordSchema.parse(req.body)) });
  } catch (error) {
    next(error);
  }
});

policeQruRouter.patch("/bot/records/:recordId/approval-message", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json({ record: await updatePoliceQruApprovalMessage(botId, id.parse(req.params.recordId), approvalMessageSchema.parse(req.body)) });
  } catch (error) {
    next(error);
  }
});

policeQruRouter.post("/bot/records/:recordId/approve", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    const input = supervisorActionSchema.parse(req.body);
    res.json({ record: await approvePoliceQruRecord(botId, id.parse(req.params.recordId), input) });
  } catch (error) {
    next(error);
  }
});

policeQruRouter.post("/bot/records/:recordId/reject", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    const input = supervisorActionSchema.required({ reason: true }).parse(req.body);
    res.json({ record: await rejectPoliceQruRecord(botId, id.parse(req.params.recordId), input as { reason: string; supervisorId: string; supervisorName: string }) });
  } catch (error) {
    next(error);
  }
});

policeQruRouter.patch("/bot/records/:recordId/message", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json({ record: await updatePoliceQruRecordMessage(botId, id.parse(req.params.recordId), recordMessageSchema.parse(req.body)) });
  } catch (error) {
    next(error);
  }
});

policeQruRouter.get("/bot/:guildId/ranking", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json({ ranking: await getPoliceQruRanking(botId, snowflake.parse(req.params.guildId), Number(req.query.limit ?? 20)) });
  } catch (error) {
    next(error);
  }
});

policeQruRouter.get("/bot/:guildId/profile/:officerId", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json({ profile: await getPoliceQruProfile(botId, snowflake.parse(req.params.guildId), snowflake.parse(req.params.officerId)) });
  } catch (error) {
    next(error);
  }
});

policeQruRouter.get("/bot/:guildId/records", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json({
      records: await listPoliceQruRecords(botId, snowflake.parse(req.params.guildId), {
        authorId: stringQuery(req.query.authorId),
        boNumber: stringQuery(req.query.boNumber),
        occurrenceDate: stringQuery(req.query.occurrenceDate),
        officerId: stringQuery(req.query.officerId),
        qruType: stringQuery(req.query.qruType)
      }, Number(req.query.limit ?? 20))
    });
  } catch (error) {
    next(error);
  }
});

policeQruRouter.post("/bot/logs", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    const body = z.object({
      action: z.string().min(1).max(120),
      actorId: snowflake.nullable().optional(),
      actorName: z.string().max(100).nullable().optional(),
      guildId: snowflake,
      metadata: z.record(z.unknown()).optional(),
      recordId: id.nullable().optional()
    }).parse(req.body);
    await createPoliceQruLog(botId, body.guildId, body);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

async function botIdFor(req: any) {
  const value = await resolveRequestBotId(req);
  if (!value) throw routeError("Bot não identificado.", 400);
  return value;
}

async function licensed(botId: string) {
  const permissions = await getBotApiPermissions(botId);
  if (!permissions) throw routeError("Bot não encontrado.", 404);
  if (!permissions.enabledModules.includes(POLICE_QRU_MODULE_ID)) throw routeError("QRU não liberado.", 403);
}

async function authorize(user: any, botId: string, guildId: string, manage: boolean) {
  await licensed(botId);
  const allowed = manage
    ? await canUseDevBotModule(user, botId, guildId, POLICE_QRU_MODULE_ID)
    : await canReadDevBotModule(user, botId, guildId, POLICE_QRU_MODULE_ID);

  if (!allowed) throw routeError("Sem permissão para QRU.", 403);
}

function stringQuery(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeEvidenceUrls(value: string) {
  const matches = value.match(/https?:\/\/[^\s<>()]+/gi) ?? [];
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const match of matches) {
    const url = match.trim().replace(/[.,;!?]+$/g, "");
    if (seen.has(url) || !isHttpUrl(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length >= MAX_EVIDENCE_LINKS) break;
  }

  return urls.join("\n");
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function routeError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

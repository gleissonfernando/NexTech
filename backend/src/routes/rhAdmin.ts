import dns from "node:dns";
import { lookup as lookupPromise } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import axios from "axios";
import { Router, type Request } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot, requireBot } from "../middleware/auth";
import { canManageDashboardGuild, canReadDashboardGuild } from "../services/dashboardGuildAccessService";
import { authorizeBotRuntimeModule, canReadDevBotModule, canUseDevBotModule } from "../services/devBotService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import {
  createRhAbsence,
  createRhAdornment,
  decideRhAbsence,
  finishRhAbsence,
  getRhAbsence,
  getRhAdminDashboard,
  getRhAdminSettings,
  isRhApprover,
  listDueRhAbsences,
  logRhAdminAction,
  markRhAbsenceRoleAdded,
  requestRhAdminPanelPublish,
  RH_ADMIN_MODULE_ID,
  saveRhAdminSettings,
  updateRhAbsenceMessage,
  updateRhAdornmentMessage
} from "../services/rhAdminService";

export const rhAdminRouter = Router();
const IMAGE_PROXY_MAX_BYTES = 10 * 1024 * 1024;
const imageProxyHttpAgent = new http.Agent({ lookup: safeDnsLookup as never });
const imageProxyHttpsAgent = new https.Agent({ lookup: safeDnsLookup as never });

const snowflake = z.string().regex(/^\d{5,32}$/);
const optionalSnowflake = snowflake.nullable().optional().or(z.literal(""));
const settingsSchema = z.object({
  absenceLogChannelId: optionalSnowflake,
  absencePanelChannelId: optionalSnowflake,
  absenceReviewChannelId: optionalSnowflake,
  absenceRoleId: optionalSnowflake,
  adornmentBannerUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  adornmentDescription: z.string().max(1200).optional(),
  adornmentLogChannelId: optionalSnowflake,
  adornmentPanelChannelId: optionalSnowflake,
  adornmentReviewChannelId: optionalSnowflake,
  allowNonDirectImageLinks: z.boolean().optional(),
  approvalDmBannerUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  approvalDmText: z.string().max(1200).optional(),
  approverRoleIds: z.array(snowflake).optional(),
  approverUserIds: z.array(snowflake).optional(),
  buttonEmojis: z.object({
    absence: z.string().max(32),
    adornment: z.string().max(32),
    approve: z.string().max(32),
    back: z.string().max(32),
    logs: z.string().max(32),
    publish: z.string().max(32),
    reject: z.string().max(32),
    save: z.string().max(32)
  }).optional(),
  checkIntervalMinutes: z.number().int().min(5).max(1440).optional(),
  color: z.string().max(24).optional(),
  configRoleIds: z.array(snowflake).optional(),
  configUserIds: z.array(snowflake).optional(),
  dmBannerUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  enabled: z.boolean().optional(),
  finishedDmBannerUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  finishedDmText: z.string().max(1200).optional(),
  generalLogChannelId: optionalSnowflake,
  mainPanelMessageId: optionalSnowflake,
  mentionAdornmentUser: z.boolean().optional(),
  panelBannerUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  panelChannelId: optionalSnowflake,
  panelDescription: z.string().max(1800).optional(),
  rejectionDmBannerUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  rejectionDmText: z.string().max(1200).optional(),
  sendAbsenceDm: z.boolean().optional(),
  systemName: z.string().min(1).max(160).optional(),
  viewerRoleIds: z.array(snowflake).optional(),
  viewerUserIds: z.array(snowflake).optional()
});
const absenceSchema = z.object({
  reason: z.string().min(1).max(900),
  returnAt: z.coerce.date(),
  returnDate: z.string().min(1).max(20),
  serverName: z.string().min(1).max(120),
  startAt: z.coerce.date(),
  startDate: z.string().min(1).max(20),
  userId: snowflake
});
const adornmentSchema = z.object({
  imageUrl: z.string().trim().min(1).max(4096).refine(isPublicHttpUrl, "URL da imagem inválida."),
  number: z.string().min(1).max(80),
  observation: z.string().max(900).nullable().optional().or(z.literal("")),
  serverName: z.string().min(1).max(120),
  userId: snowflake
});
const messageSchema = z.object({ channelId: optionalSnowflake, messageId: optionalSnowflake, reviewChannelId: optionalSnowflake, reviewMessageId: optionalSnowflake });
const decisionSchema = z.object({ actorId: snowflake, isAdministrator: z.boolean().optional(), rejectionReason: z.string().max(900).nullable().optional(), roleIds: z.array(snowflake).default([]), status: z.enum(["approved", "rejected"]) });
const roleStateSchema = z.object({ dmDelivered: z.boolean().nullable().optional(), roleAdded: z.boolean().optional(), roleRemoved: z.boolean().optional() });
const permissionSchema = z.object({ isAdministrator: z.boolean().optional(), roleIds: z.array(snowflake).default([]), userId: snowflake });
const logSchema = z.object({
  action: z.string().min(1).max(100),
  actorId: snowflake.nullable().optional(),
  channelId: optionalSnowflake,
  description: z.string().min(1).max(900),
  metadata: z.record(z.unknown()).optional(),
  status: z.enum(["success", "warning", "error", "denied", "info"]).default("info"),
  userId: snowflake.nullable().optional()
});

rhAdminRouter.get("/image-proxy", async (req, res, next) => {
  try {
    const rawUrl = z.string().min(8).max(4096).parse(req.query.url);
    const image = await fetchProxyImage(rawUrl, 0);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Content-Type", image.contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(image.buffer);
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.use(requireAuthOrBot);

rhAdminRouter.get("/:guildId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canRead(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para ver o Departamento de RH." });
    return res.json(await getRhAdminDashboard(botId, guildId));
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.patch("/:guildId/settings", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para configurar o Departamento de RH." });
    const settings = await saveRhAdminSettings(botId, guildId, sanitizeSettings(settingsSchema.parse(req.body ?? {})), res.locals.dashboardAuth.user.discordId);
    return res.json({ settings });
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.post("/:guildId/panel", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para publicar painel RH." });
    const settings = await requestRhAdminPanelPublish(botId, guildId, res.locals.dashboardAuth.user.discordId);
    return res.json({ settings });
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.get("/bot/:guildId/settings", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    return res.json({ settings: await getRhAdminSettings(botId, guildId) });
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.post("/bot/:guildId/settings", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const settings = await saveRhAdminSettings(botId, guildId, sanitizeSettings(settingsSchema.parse(req.body ?? {})), req.get("x-actor-id") ?? null);
    return res.json({ settings });
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.post("/bot/:guildId/permissions/approver", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const input = permissionSchema.parse(req.body ?? {});
    const settings = await getRhAdminSettings(botId, guildId);
    return res.json({ allowed: isRhApprover(settings, input.userId, input.roleIds, input.isAdministrator) });
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.post("/bot/:guildId/absences", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    return res.status(201).json({ absence: await createRhAbsence(botId, guildId, absenceSchema.parse(req.body ?? {})) });
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.get("/bot/:guildId/absences/:absenceId", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const absence = await getRhAbsence(botId, guildId, routeParam(req, "absenceId"));
    if (!absence) return res.status(404).json({ message: "Solicitação de ausência não encontrada." });
    return res.json({ absence });
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.patch("/bot/:guildId/absences/:absenceId/message", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const input = messageSchema.parse(req.body ?? {});
    return res.json({ absence: await updateRhAbsenceMessage(botId, guildId, routeParam(req, "absenceId"), { reviewChannelId: input.reviewChannelId || input.channelId || null, reviewMessageId: input.reviewMessageId || input.messageId || null }) });
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.post("/bot/:guildId/absences/:absenceId/decision", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const input = decisionSchema.parse(req.body ?? {});
    const settings = await getRhAdminSettings(botId, guildId);
    if (!isRhApprover(settings, input.actorId, input.roleIds, input.isAdministrator)) return res.status(403).json({ message: "Você não tem permissão para analisar solicitações de ausência." });
    const result = await decideRhAbsence(botId, guildId, routeParam(req, "absenceId"), input);
    if (!result) return res.status(404).json({ message: "Solicitação de ausência não encontrada." });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.post("/bot/:guildId/absences/:absenceId/role-added", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const input = roleStateSchema.parse(req.body ?? {});
    return res.json({ absence: await markRhAbsenceRoleAdded(botId, guildId, routeParam(req, "absenceId"), input.roleAdded ?? true) });
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.post("/bot/:guildId/absences/:absenceId/finish", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const input = roleStateSchema.parse(req.body ?? {});
    const result = await finishRhAbsence(botId, guildId, routeParam(req, "absenceId"), input.roleRemoved ?? true, input.dmDelivered ?? null);
    if (!result) return res.status(404).json({ message: "Solicitação de ausência não encontrada." });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.get("/bot/absences/due", requireBot, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    if (!botId) return res.status(403).json({ message: "Bot não identificado." });
    return res.json({ absences: await listDueRhAbsences(botId) });
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.post("/bot/:guildId/adornments", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const input = adornmentSchema.parse(req.body ?? {});
    return res.status(201).json({ adornment: await createRhAdornment(botId, guildId, { ...input, observation: input.observation || null }) });
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.patch("/bot/:guildId/adornments/:adornmentId/message", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const input = messageSchema.parse(req.body ?? {});
    return res.json({ adornment: await updateRhAdornmentMessage(botId, guildId, routeParam(req, "adornmentId"), { channelId: input.channelId || null, messageId: input.messageId || null }) });
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.post("/bot/:guildId/logs", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const input = logSchema.parse(req.body ?? {});
    return res.status(201).json({ log: await logRhAdminAction(botId, guildId, input.action, input.userId ?? null, input.actorId ?? null, input.description, input.status, input.metadata ?? {}, input.channelId || null) });
  } catch (error) {
    return next(error);
  }
});

async function canRead(req: Request, guildId: string, botId: string) {
  return (await canReadDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, RH_ADMIN_MODULE_ID))
    || canReadDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
}

async function canManage(req: Request, guildId: string, botId: string) {
  return (await canUseDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, RH_ADMIN_MODULE_ID))
    || canManageDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
}

async function assertRuntime(botId: string | null, guildId: string) {
  const validGuildId = snowflake.parse(guildId);
  if (!botId) throw Object.assign(new Error("Bot não identificado."), { statusCode: 403 });
  const authorization = await authorizeBotRuntimeModule({ botId, guildId: validGuildId, moduleId: RH_ADMIN_MODULE_ID });
  if (!authorization.allowed) throw Object.assign(new Error("O módulo Departamento de RH não está liberado para este servidor. Entre em contato com a administração do bot."), { statusCode: 403 });
  return botId;
}

async function fetchProxyImage(rawUrl: string, depth: number): Promise<{ buffer: Buffer; contentType: string }> {
  const url = await assertSafePublicUrl(rawUrl);
  const response = await axios.get<ArrayBuffer>(url.href, {
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,text/html;q=0.7,*/*;q=0.5",
      "User-Agent": "NexTech-RH-Image-Proxy/1.0"
    },
    httpAgent: imageProxyHttpAgent,
    httpsAgent: imageProxyHttpsAgent,
    maxBodyLength: IMAGE_PROXY_MAX_BYTES,
    maxContentLength: IMAGE_PROXY_MAX_BYTES,
    maxRedirects: 3,
    responseType: "arraybuffer",
    timeout: 10_000,
    validateStatus: (status) => status >= 200 && status < 300
  });
  const contentType = String(response.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
  const buffer = Buffer.from(response.data);
  if (buffer.length > IMAGE_PROXY_MAX_BYTES) throw Object.assign(new Error("Imagem acima do limite permitido."), { statusCode: 413 });
  if (contentType.startsWith("image/")) return { buffer, contentType };

  if (depth < 1 && /(?:text\/html|application\/xhtml\+xml)/i.test(contentType)) {
    const nestedImageUrl = extractHtmlImageUrl(buffer.toString("utf8", 0, Math.min(buffer.length, 512_000)), url);
    if (nestedImageUrl) return fetchProxyImage(nestedImageUrl, depth + 1);
  }

  throw Object.assign(new Error("O link não retornou uma imagem renderizável."), { statusCode: 415 });
}

async function assertSafePublicUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw Object.assign(new Error("URL da imagem inválida."), { statusCode: 400 });
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw Object.assign(new Error("URL da imagem inválida."), { statusCode: 400 });
  }
  const addresses = await lookupPromise(url.hostname, { all: true }).catch(() => []);
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw Object.assign(new Error("URL de imagem bloqueada por segurança."), { statusCode: 400 });
  }
  return url;
}

function extractHtmlImageUrl(html: string, baseUrl: URL) {
  const patterns = [
    /<meta\s+[^>]*(?:property|name)=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta\s+[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image(?::secure_url)?["'][^>]*>/i,
    /<meta\s+[^>]*(?:property|name)=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta\s+[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']twitter:image(?::src)?["'][^>]*>/i,
    /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    try {
      return new URL(decodeHtmlAttribute(match[1]), baseUrl).href;
    } catch {
      continue;
    }
  }
  return null;
}

function decodeHtmlAttribute(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function isPublicHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function safeDnsLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void
) {
  dns.lookup(hostname, { ...options, all: false }, (error, address, family) => {
    if (error) return callback(error, "", 0);
    if (isPrivateAddress(address)) {
      const blocked = Object.assign(new Error("Blocked private address"), { code: "ENOTFOUND" }) as NodeJS.ErrnoException;
      return callback(blocked, "", 0);
    }
    return callback(null, address, family);
  });
}

function isPrivateAddress(address: string) {
  if (address.includes(":")) {
    const normalized = address.toLowerCase();
    return normalized === "::1"
      || normalized === "::"
      || normalized.startsWith("fc")
      || normalized.startsWith("fd")
      || /^fe[89ab]/.test(normalized)
      || normalized.startsWith("::ffff:10.")
      || normalized.startsWith("::ffff:127.")
      || normalized.startsWith("::ffff:192.168.")
      || /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(normalized);
  }

  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  return a === 0
    || a === 10
    || a === 127
    || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19));
}

function sanitizeSettings(input: z.infer<typeof settingsSchema>) {
  return {
    ...input,
    adornmentBannerUrl: normalizeOptionalUrl(input.adornmentBannerUrl),
    approvalDmBannerUrl: normalizeOptionalUrl(input.approvalDmBannerUrl),
    dmBannerUrl: normalizeOptionalUrl(input.dmBannerUrl),
    finishedDmBannerUrl: normalizeOptionalUrl(input.finishedDmBannerUrl),
    panelBannerUrl: normalizeOptionalUrl(input.panelBannerUrl),
    rejectionDmBannerUrl: normalizeOptionalUrl(input.rejectionDmBannerUrl)
  };
}

function routeParam(req: Request, name: string) {
  return z.string().min(1).parse(req.params[name]);
}

function normalizeOptionalUrl(value: string | null | undefined) {
  const normalized = typeof value === "string" ? value.trim() : value;
  return normalized || null;
}

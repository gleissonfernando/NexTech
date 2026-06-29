import { Router } from "express";
import { z } from "zod";
import { requireBot } from "../middleware/auth";
import { authorizeBotRuntimeModule, getBotApiPermissions } from "../services/devBotService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import { createTemporaryCall, deleteTemporaryCall, getTemporaryCallByChannel, getTemporaryCallByOwner, getTemporaryVoiceSettings, listTemporaryCalls, updateTemporaryCall, updateTemporaryVoicePanelState } from "../services/temporaryCallService";

const guildId = z.string().regex(/^\d{5,32}$/); const snowflake = guildId; const uuid = z.string().uuid();
const createSchema = z.object({ ownerId: snowflake, channelId: snowflake, channelName: z.string().min(1).max(100), userLimit: z.number().int().min(1).max(99), isPrivate: z.boolean(), allowedUsers: z.array(snowflake).max(100), bannedUsers: z.array(snowflake).max(100) });
const patchSchema = z.object({ channelName: z.string().min(1).max(100).optional(), userLimit: z.number().int().min(1).max(99).optional(), isPrivate: z.boolean().optional(), allowedUsers: z.array(snowflake).max(100).optional(), bannedUsers: z.array(snowflake).max(100).optional(), emptySince: z.string().datetime().nullable().optional() });
export const temporaryVoiceRouter = Router();
temporaryVoiceRouter.use(requireBot);

temporaryVoiceRouter.get("/bot/:guildId/settings", async (req, res, next) => { try { const scope = await scoped(req, req.params.guildId); return res.json({ settings: await getTemporaryVoiceSettings(scope.botId, scope.guildId) }); } catch (e) { return next(e); } });
temporaryVoiceRouter.post("/bot/:guildId/panel-state", async (req, res, next) => { try { const scope = await scoped(req, req.params.guildId); const messageId = z.object({ messageId: snowflake.nullable() }).parse(req.body).messageId; return res.json({ settings: await updateTemporaryVoicePanelState(scope.botId, scope.guildId, messageId) }); } catch (e) { return next(e); } });
temporaryVoiceRouter.get("/bot/:guildId/calls", async (req, res, next) => { try { const scope = await scoped(req, req.params.guildId); return res.json({ calls: await listTemporaryCalls(scope.botId, scope.guildId) }); } catch (e) { return next(e); } });
temporaryVoiceRouter.get("/bot/:guildId/owners/:ownerId", async (req, res, next) => { try { const scope = await scoped(req, req.params.guildId); return res.json({ call: await getTemporaryCallByOwner(scope.botId, scope.guildId, snowflake.parse(req.params.ownerId)) }); } catch (e) { return next(e); } });
temporaryVoiceRouter.get("/bot/:guildId/channels/:channelId", async (req, res, next) => { try { const scope = await scoped(req, req.params.guildId); return res.json({ call: await getTemporaryCallByChannel(scope.botId, scope.guildId, snowflake.parse(req.params.channelId)) }); } catch (e) { return next(e); } });
temporaryVoiceRouter.post("/bot/:guildId/calls", async (req, res, next) => { try { const scope = await scoped(req, req.params.guildId); return res.status(201).json({ call: await createTemporaryCall({ ...createSchema.parse(req.body), ...scope }) }); } catch (e) { return next(e); } });
temporaryVoiceRouter.patch("/bot/:guildId/calls/:callId", async (req, res, next) => { try { const scope = await scoped(req, req.params.guildId); return res.json({ call: await updateTemporaryCall(scope.botId, scope.guildId, uuid.parse(req.params.callId), patchSchema.parse(req.body)) }); } catch (e) { return next(e); } });
temporaryVoiceRouter.delete("/bot/:guildId/calls/:callId", async (req, res, next) => { try { const scope = await scoped(req, req.params.guildId); return res.json({ call: await deleteTemporaryCall(scope.botId, scope.guildId, uuid.parse(req.params.callId)) }); } catch (e) { return next(e); } });

async function scoped(req: Parameters<typeof resolveRequestBotId>[0], rawGuildId: unknown) { const parsedGuild = guildId.parse(rawGuildId); const botId = await resolveRequestBotId(req); if (!botId) throw error("Bot scope is required.", 400); const permissions = await getBotApiPermissions(botId); if (!permissions?.enabledModules.includes("temporary-voice")) throw error("Temporary Voice is not enabled for this bot.", 403); const authorization = await authorizeBotRuntimeModule({ botId, guildId: parsedGuild, moduleId: "temporary-voice" }); if (!authorization.allowed) throw error(authorization.reason, 403); return { botId, guildId: parsedGuild }; }
function error(message: string, statusCode: number) { return Object.assign(new Error(message), { statusCode }); }

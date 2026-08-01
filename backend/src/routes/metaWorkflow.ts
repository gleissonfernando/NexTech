import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { canReadDevBotModule, canUseDevBotModule, getBotApiPermissions } from "../services/devBotService";
import { FIVEM_GOALS_MODULE_ID } from "../services/fivemGoalService";
import {
  claimMetaCycleFinalization,
  cleanupMetaMember,
  completeMetaCycleFinalization,
  confirmMetaPendingProof,
  createMetaPendingProof,
  createMetaSetRequest,
  decideMetaSetRequest,
  ensureMetaCycle,
  getMetaPendingProof,
  getMetaSetRequest,
  listMetaWorkflowDashboard,
  updateMetaSetRequestMessage
} from "../services/metaWorkflowService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

const snowflake = z.string().regex(/^\d{5,32}$/);
const identifier = z.string().min(1).max(100);
const botScoped = Router();
export const metaWorkflowRouter = Router();

metaWorkflowRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await requiredBotId(req);
    await assertAccess(res.locals.dashboardAuth.user, guildId, botId, false);
    return res.json(await listMetaWorkflowDashboard(guildId, botId));
  } catch (error) { return next(error); }
});

botScoped.post("/set-requests", requireBot, async (req, res, next) => {
  try {
    const input = z.object({ guildId: snowflake, userId: snowflake, approvalChannelId: snowflake.nullable().optional(), formData: z.array(z.object({ fieldId: identifier, label: z.string().min(1).max(100), value: z.string().max(1500) })).min(1).max(10) }).parse(req.body);
    const botId = await resolveRequestBotId(req);
    return res.status(201).json({ request: await createMetaSetRequest({ ...input, botId }) });
  } catch (error) { return next(error); }
});

botScoped.get("/set-requests/:guildId/:requestId", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const requestId = identifier.parse(req.params.requestId);
    const request = await getMetaSetRequest(guildId, requestId, await resolveRequestBotId(req));
    if (!request) throw routeError("Solicitação não encontrada.", 404);
    return res.json({ request });
  } catch (error) { return next(error); }
});

botScoped.patch("/set-requests/:guildId/:requestId/message", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const requestId = identifier.parse(req.params.requestId);
    const { approvalMessageId } = z.object({ approvalMessageId: snowflake }).parse(req.body);
    const request = await updateMetaSetRequestMessage(guildId, requestId, await resolveRequestBotId(req), approvalMessageId);
    if (!request) throw routeError("Solicitação não encontrada.", 404);
    return res.json({ request });
  } catch (error) { return next(error); }
});

botScoped.post("/set-requests/:guildId/:requestId/decision", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const requestId = identifier.parse(req.params.requestId);
    const input = z.object({ actorId: snowflake, approvalTypeId: identifier.nullable().optional(), reason: z.string().max(800).nullable().optional(), status: z.enum(["approved", "rejected"]) }).parse(req.body);
    return res.json({ request: await decideMetaSetRequest({ ...input, botId: await resolveRequestBotId(req), guildId, requestId }) });
  } catch (error) { return next(error); }
});

botScoped.post("/proofs", requireBot, async (req, res, next) => {
  try {
    const input = z.object({ attachmentId: identifier, attachmentUrl: z.string().url().max(2048), channelId: snowflake, guildId: snowflake, sourceMessageId: snowflake, userId: snowflake }).parse(req.body);
    return res.status(201).json({ proof: await createMetaPendingProof({ ...input, botId: await resolveRequestBotId(req) }) });
  } catch (error) { return next(error); }
});

botScoped.get("/proofs/:guildId/:proofId", requireBot, async (req, res, next) => {
  try {
    const proof = await getMetaPendingProof(snowflake.parse(req.params.guildId), identifier.parse(req.params.proofId), await resolveRequestBotId(req));
    if (!proof) throw routeError("Comprovante expirado ou já processado.", 404);
    return res.json({ proof });
  } catch (error) { return next(error); }
});

botScoped.post("/proofs/:guildId/:proofId/confirm", requireBot, async (req, res, next) => {
  try {
    const input = z.object({ amountMinor: z.string().regex(/^\d{1,30}$/), cycleId: identifier, metaTypeId: identifier, userId: snowflake }).parse(req.body);
    return res.status(201).json({ registration: await confirmMetaPendingProof({ ...input, botId: await resolveRequestBotId(req), guildId: snowflake.parse(req.params.guildId), proofId: identifier.parse(req.params.proofId) }) });
  } catch (error) { return next(error); }
});

botScoped.post("/cycles/ensure", requireBot, async (req, res, next) => {
  try {
    const input = z.object({ configurationSnapshot: z.record(z.unknown()), endsAt: z.coerce.date(), guildId: snowflake, startsAt: z.coerce.date() }).parse(req.body);
    return res.json({ cycle: await ensureMetaCycle({ ...input, botId: await resolveRequestBotId(req) }) });
  } catch (error) { return next(error); }
});

botScoped.post("/cycles/:guildId/:cycleId/claim", requireBot, async (req, res, next) => {
  try { return res.json({ cycle: await claimMetaCycleFinalization(snowflake.parse(req.params.guildId), identifier.parse(req.params.cycleId), await resolveRequestBotId(req)) }); }
  catch (error) { return next(error); }
});

botScoped.post("/cycles/:guildId/:cycleId/complete", requireBot, async (req, res, next) => {
  try {
    const { summaryMessageIds } = z.object({ summaryMessageIds: z.array(snowflake).max(500) }).parse(req.body);
    return res.json({ cycle: await completeMetaCycleFinalization(snowflake.parse(req.params.guildId), identifier.parse(req.params.cycleId), await resolveRequestBotId(req), summaryMessageIds) });
  } catch (error) { return next(error); }
});

botScoped.post("/member-cleanup", requireBot, async (req, res, next) => {
  try {
    const input = z.object({ guildId: snowflake, userId: snowflake }).parse(req.body);
    return res.json(await cleanupMetaMember(input.guildId, input.userId, await resolveRequestBotId(req)));
  } catch (error) { return next(error); }
});

metaWorkflowRouter.use("/bot", botScoped);

async function requiredBotId(req: Parameters<typeof resolveRequestBotId>[0]) {
  const botId = await resolveRequestBotId(req);
  if (!botId) throw routeError("Selecione um bot DEV para acessar o sistema de metas.", 400);
  return botId;
}

async function assertAccess(user: { discordId: string; accessLevel: string }, guildId: string, botId: string, manage: boolean) {
  const permissions = await getBotApiPermissions(botId);
  if (!permissions) throw routeError("Bot não encontrado.", 404);
  if (!permissions.enabledModules.includes(FIVEM_GOALS_MODULE_ID)) throw routeError("O módulo de metas não está liberado para este bot.", 403);
  const allowed = manage ? await canUseDevBotModule(user as never, botId, guildId, FIVEM_GOALS_MODULE_ID) : await canReadDevBotModule(user as never, botId, guildId, FIVEM_GOALS_MODULE_ID);
  if (!allowed) throw routeError("Você não tem permissão para acessar as metas deste servidor.", 403);
}

function routeError(message: string, statusCode: number) { return Object.assign(new Error(message), { statusCode }); }

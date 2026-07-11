import { randomUUID } from "node:crypto";
import { getMongoDb } from "../database/mongo";

export type Pd7Field = { id: string; label: string; placeholder: string | null; required: boolean; style: "short" | "paragraph"; order: number };
export type Pd7Settings = {
  _id: string; botId: string; guildId: string; factionId: string; factionName: string; enabled: boolean;
  categoryPD7: string | null; panelChannelPD7: string | null; logChannelPD7: string | null;
  allowedRolesPD7: string[]; responsibleUsersPD7: string[]; approvedRolePD7: string | null; rejectedRolePD7: string | null;
  fields: Pd7Field[]; autoDeleteMinutes: number | null; panelMessageId: string | null; publishRequestedAt: Date | null;
  createdAt: Date; updatedAt: Date;
};
export type Pd7Request = {
  _id: string; botId: string; guildId: string; factionId: string; userId: string; username: string;
  fields: Array<{ id: string; label: string; value: string }>; status: "pending" | "approved" | "rejected" | "closed";
  channelId: string | null; panelMessageId: string | null; handledBy: string | null; rejectionReason: string | null;
  createdAt: Date; updatedAt: Date; resolvedAt: Date | null;
};

const defaults = (guildId: string, botId: string, factionId: string): Pd7Settings => ({
  _id: `${botId}:${guildId}:${factionId}`, botId, guildId, factionId, factionName: "Nova facção", enabled: false,
  categoryPD7: null, panelChannelPD7: null, logChannelPD7: null, allowedRolesPD7: [], responsibleUsersPD7: [],
  approvedRolePD7: null, rejectedRolePD7: null, autoDeleteMinutes: 60, panelMessageId: null, publishRequestedAt: null,
  fields: [
    { id: "ingame_name", label: "Nome In-game", placeholder: "Informe seu nome", required: true, style: "short", order: 0 },
    { id: "id", label: "ID", placeholder: "Informe seu ID", required: true, style: "short", order: 1 },
    { id: "role", label: "Cargo", placeholder: "Cargo atual", required: true, style: "short", order: 2 },
    { id: "reason", label: "Motivo", placeholder: "Explique a solicitação", required: true, style: "paragraph", order: 3 },
    { id: "notes", label: "Observações", placeholder: "Opcional", required: false, style: "paragraph", order: 4 }
  ], createdAt: new Date(), updatedAt: new Date()
});

async function collections() { const db = await getMongoDb(); return { settings: db.collection<Pd7Settings>("fivem_pd7_settings"), requests: db.collection<Pd7Request>("fivem_pd7_requests") }; }
export async function getPd7Settings(guildId: string, botId: string, factionId: string) { const { settings } = await collections(); return await settings.findOne({ botId, guildId, factionId }) ?? defaults(guildId, botId, factionId); }
export async function listPd7Settings(guildId: string, botId: string) { const { settings } = await collections(); return settings.find({ botId, guildId }).sort({ factionName: 1 }).toArray(); }
export async function listActivePd7Settings(botId: string) { const { settings } = await collections(); return settings.find({ botId, enabled: true }).toArray(); }
export async function savePd7Settings(guildId: string, botId: string, factionId: string, input: Partial<Pd7Settings>) {
  const { settings } = await collections(); const current = await getPd7Settings(guildId, botId, factionId); const now = new Date();
  const next = { ...current, ...input, _id: current._id, botId, guildId, factionId, fields: input.fields ? [...input.fields].sort((a,b) => a.order-b.order) : current.fields, updatedAt: now };
  await settings.replaceOne({ _id: next._id }, next, { upsert: true }); return next;
}
export async function requestPd7Publish(guildId: string, botId: string, factionId: string) { return savePd7Settings(guildId, botId, factionId, { publishRequestedAt: new Date() }); }
export async function updatePd7PanelState(guildId: string, botId: string, factionId: string, panelMessageId: string | null) { return savePd7Settings(guildId, botId, factionId, { panelMessageId, publishRequestedAt: null }); }
export async function createPd7Request(input: Omit<Pd7Request, "_id"|"status"|"channelId"|"panelMessageId"|"handledBy"|"rejectionReason"|"createdAt"|"updatedAt"|"resolvedAt">) {
  const { requests } = await collections(); const now = new Date(); const row: Pd7Request = { ...input, _id: randomUUID(), status: "pending", channelId: null, panelMessageId: null, handledBy: null, rejectionReason: null, createdAt: now, updatedAt: now, resolvedAt: null }; await requests.insertOne(row); return row;
}
export async function getPd7Request(id: string, botId: string) { const { requests } = await collections(); return requests.findOne({ _id: id, botId }); }
export async function updatePd7Request(id: string, botId: string, patch: Partial<Pd7Request>) { const { requests } = await collections(); await requests.updateOne({ _id: id, botId }, { $set: { ...patch, updatedAt: new Date() } }); return requests.findOne({ _id: id, botId }); }
export async function getPd7Dashboard(guildId: string, botId: string, factionId: string) {
  const { requests } = await collections(); const rows = await requests.find({ guildId, botId, factionId }).sort({ createdAt: -1 }).limit(50).toArray();
  const resolved = rows.filter(r => r.resolvedAt); const averageAnalysisMinutes = resolved.length ? Math.round(resolved.reduce((n,r) => n + ((r.resolvedAt!.getTime()-r.createdAt.getTime())/60000),0)/resolved.length) : 0;
  const responsible = new Map<string,number>(); resolved.forEach(r => r.handledBy && responsible.set(r.handledBy,(responsible.get(r.handledBy)??0)+1));
  return { settings: await getPd7Settings(guildId, botId, factionId), requests: rows, stats: { total: rows.length, pending: rows.filter(r=>r.status==="pending").length, approved: rows.filter(r=>r.status==="approved").length, rejected: rows.filter(r=>r.status==="rejected").length, averageAnalysisMinutes, activeResponsible: [...responsible].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([userId,total])=>({userId,total})) } };
}

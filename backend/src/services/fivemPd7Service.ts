import { randomUUID } from "node:crypto";
import { getMongoDb } from "../database/mongo";

export type Pd7Field = {
  id: string;
  label: string;
  placeholder: string | null;
  required: boolean;
  style: "short" | "paragraph";
  order: number;
};

export type Pd7Settings = {
  _id: string;
  botId: string;
  guildId: string;
  factionId: string;
  factionName: string;
  enabled: boolean;
  categoryPD7: string | null;
  panelChannelPD7: string | null;
  logChannelPD7: string | null;
  allowedRolesPD7: string[];
  responsibleUsersPD7: string[];
  approvedRolePD7: string | null;
  rejectedRolePD7: string | null;
  fields: Pd7Field[];
  autoDeleteMinutes: number | null;
  panelMessageId: string | null;
  publishRequestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type Pd7Request = {
  _id: string;
  botId: string;
  guildId: string;
  factionId: string;
  userId: string;
  username: string;
  fields: Array<{ id: string; label: string; value: string }>;
  status: "pending" | "approved" | "rejected" | "closed";
  channelId: string | null;
  panelMessageId: string | null;
  handledBy: string | null;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
};

const defaultFields: Pd7Field[] = [
  { id: "ingame_name", label: "Nome In-game", placeholder: "Informe seu nome", required: true, style: "short", order: 0 },
  { id: "id", label: "ID", placeholder: "Informe seu ID", required: true, style: "short", order: 1 },
  { id: "role", label: "Cargo", placeholder: "Cargo atual", required: true, style: "short", order: 2 },
  { id: "reason", label: "Motivo", placeholder: "Explique a solicitação", required: true, style: "paragraph", order: 3 },
  { id: "notes", label: "Observações", placeholder: "Opcional", required: false, style: "paragraph", order: 4 }
];

const defaults = (guildId: string, botId: string, factionId: string): Pd7Settings => ({
  _id: `${botId}:${guildId}:${factionId}`,
  allowedRolesPD7: [],
  approvedRolePD7: null,
  autoDeleteMinutes: 60,
  botId,
  categoryPD7: null,
  createdAt: new Date(),
  enabled: false,
  factionId,
  factionName: "Nova facção",
  fields: defaultFields,
  guildId,
  logChannelPD7: null,
  panelChannelPD7: null,
  panelMessageId: null,
  publishRequestedAt: null,
  rejectedRolePD7: null,
  responsibleUsersPD7: [],
  updatedAt: new Date()
});

async function collections() {
  const db = await getMongoDb();
  return {
    requests: db.collection<Pd7Request>("fivem_pd7_requests"),
    settings: db.collection<Pd7Settings>("fivem_pd7_settings")
  };
}

export async function getPd7Settings(guildId: string, botId: string, factionId: string) {
  const { settings } = await collections();
  return await settings.findOne({ botId, guildId, factionId }) ?? defaults(guildId, botId, factionId);
}

export async function listPd7Settings(guildId: string, botId: string) {
  const { settings } = await collections();
  return settings.find({ botId, guildId }).sort({ factionName: 1 }).toArray();
}

export async function listActivePd7Settings(botId: string) {
  const { settings } = await collections();
  return settings.find({ botId, enabled: true }).toArray();
}

export async function savePd7Settings(guildId: string, botId: string, factionId: string, input: Partial<Pd7Settings>) {
  const { settings } = await collections();
  const current = await getPd7Settings(guildId, botId, factionId);
  const now = new Date();
  const next: Pd7Settings = {
    ...current,
    ...input,
    _id: current._id,
    botId,
    fields: input.fields ? [...input.fields].sort((a, b) => a.order - b.order) : current.fields,
    factionId,
    guildId,
    updatedAt: now
  };
  await settings.replaceOne({ _id: next._id }, next, { upsert: true });
  return next;
}

export async function requestPd7Publish(guildId: string, botId: string, factionId: string) {
  return savePd7Settings(guildId, botId, factionId, { publishRequestedAt: new Date() });
}

export async function updatePd7PanelState(guildId: string, botId: string, factionId: string, panelMessageId: string | null) {
  return savePd7Settings(guildId, botId, factionId, { panelMessageId, publishRequestedAt: null });
}

export async function createPd7Request(input: Omit<Pd7Request, "_id" | "status" | "channelId" | "panelMessageId" | "handledBy" | "rejectionReason" | "createdAt" | "updatedAt" | "resolvedAt">) {
  const { requests } = await collections();
  const now = new Date();
  const row: Pd7Request = {
    ...input,
    _id: randomUUID(),
    channelId: null,
    createdAt: now,
    handledBy: null,
    panelMessageId: null,
    rejectionReason: null,
    resolvedAt: null,
    status: "pending",
    updatedAt: now
  };
  await requests.insertOne(row);
  return row;
}

export async function getPd7Request(id: string, botId: string) {
  const { requests } = await collections();
  return requests.findOne({ _id: id, botId });
}

export async function updatePd7Request(id: string, botId: string, patch: Partial<Pd7Request>) {
  const { requests } = await collections();
  await requests.updateOne({ _id: id, botId }, { $set: { ...patch, updatedAt: new Date() } });
  return requests.findOne({ _id: id, botId });
}

export async function getPd7Dashboard(guildId: string, botId: string, factionId: string) {
  const { requests } = await collections();
  const rows = await requests.find({ botId, factionId, guildId }).sort({ createdAt: -1 }).limit(50).toArray();
  const resolved = rows.filter((row) => row.resolvedAt);
  const averageAnalysisMinutes = resolved.length
    ? Math.round(resolved.reduce((total, row) => total + ((row.resolvedAt!.getTime() - row.createdAt.getTime()) / 60_000), 0) / resolved.length)
    : 0;
  const responsible = new Map<string, number>();
  resolved.forEach((row) => {
    if (row.handledBy) responsible.set(row.handledBy, (responsible.get(row.handledBy) ?? 0) + 1);
  });
  return {
    requests: rows,
    settings: await getPd7Settings(guildId, botId, factionId),
    stats: {
      activeResponsible: [...responsible].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([userId, total]) => ({ total, userId })),
      approved: rows.filter((row) => row.status === "approved").length,
      averageAnalysisMinutes,
      pending: rows.filter((row) => row.status === "pending").length,
      rejected: rows.filter((row) => row.status === "rejected").length,
      total: rows.length
    }
  };
}

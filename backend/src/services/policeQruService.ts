import { randomUUID } from "node:crypto";
import { getMongoCollections, type MongoPoliceQruOfficer, type MongoPoliceQruRecord, type MongoPoliceQruSettings } from "../database/mongo";
import { emitRealtime } from "../realtime/events";

export const POLICE_QRU_MODULE_ID = "police-qru";

export type PoliceQruSettingsDto = Omit<MongoPoliceQruSettings, "_id" | "createdAt" | "updatedAt"> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type PoliceQruRecordDto = Omit<MongoPoliceQruRecord, "_id" | "approvedAt" | "createdAt" | "rejections" | "updatedAt"> & {
  approvedAt: string | null;
  id: string;
  rejections: Array<{
    reason: string;
    rejectedAt: string;
    supervisorId: string;
    supervisorName: string;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type PoliceQruRankingEntryDto = {
  firstQruAt: string | null;
  lastQruAt: string | null;
  officerId: string;
  officerName: string;
  position: number;
  total: number;
};

export type PoliceQruDashboardDto = {
  logs: Array<{ action: string; actorId: string | null; actorName: string | null; createdAt: string; id: string; recordId: string | null }>;
  ranking: PoliceQruRankingEntryDto[];
  records: PoliceQruRecordDto[];
  settings: PoliceQruSettingsDto;
  stats: {
    officers: number;
    qrusMonth: number;
    qrusToday: number;
    qrusWeek: number;
    topAuthor: { id: string; name: string; total: number } | null;
    topOfficer: PoliceQruRankingEntryDto | null;
    total: number;
  };
};

export type SavePoliceQruSettingsInput = Partial<Pick<
  MongoPoliceQruSettings,
  | "allowedRoleIds"
  | "approvalChannelId"
  | "color"
  | "deleteChannelSeconds"
  | "enabled"
  | "logChannelId"
  | "panelDescription"
  | "panelImageUrl"
  | "panelMessage"
  | "panelTitle"
  | "recordChannelId"
  | "rankingChannelId"
  | "rankingMessageId"
  | "supervisorRoleIds"
  | "teamRoleId"
  | "temporaryCategoryId"
>>;

export type CreatePoliceQruRecordInput = {
  authorId: string;
  authorName: string;
  approvalChannelId?: string | null;
  approvalMessageId?: string | null;
  boNumber: string;
  evidenceUrl: string;
  guildId: string;
  notes?: string | null;
  occurrenceDate: string;
  officers: MongoPoliceQruOfficer[];
  qruType: string;
  recordChannelId?: string | null;
  recordMessageId?: string | null;
  seizures?: string | null;
  status?: "pending" | "approved";
  temporaryChannelId?: string | null;
  vehicle: string;
};

export type PoliceQruSearchInput = {
  authorId?: string | null;
  boNumber?: string | null;
  occurrenceDate?: string | null;
  officerId?: string | null;
  qruType?: string | null;
};

export async function getPoliceQruDashboard(botId: string, guildId: string): Promise<PoliceQruDashboardDto> {
  const [settings, records, ranking, stats, logs] = await Promise.all([
    getPoliceQruSettings(botId, guildId),
    listPoliceQruRecords(botId, guildId, {}, 100),
    getPoliceQruRanking(botId, guildId, 20),
    getPoliceQruStats(botId, guildId),
    listPoliceQruLogs(botId, guildId, 50)
  ]);

  return {
    logs,
    ranking,
    records,
    settings,
    stats: {
      ...stats,
      topOfficer: ranking[0] ?? null
    }
  };
}

export async function getPoliceQruSettings(botId: string, guildId: string) {
  const { policeQruSettings } = await getMongoCollections();
  const current = await policeQruSettings.findOne({ botId, guildId });
  if (current) return settingsDto(current);

  const row = defaultSettings(botId, guildId);
  await policeQruSettings.insertOne(row);
  return settingsDto(row);
}

export async function savePoliceQruSettings(botId: string, guildId: string, input: SavePoliceQruSettingsInput, actorId: string | null) {
  const { policeQruSettings } = await getMongoCollections();
  const current = await getPoliceQruSettings(botId, guildId);
  const now = new Date();
  const next: MongoPoliceQruSettings = {
    ...current,
    _id: current.id,
    createdAt: new Date(current.createdAt),
    updatedAt: now,
    updatedBy: actorId,
    ...sanitizeSettingsInput(input)
  };

  await policeQruSettings.updateOne({ _id: next._id }, { $set: next }, { upsert: true });
  const dto = settingsDto(next);
  emitRealtime("police-qru:settings_updated", { botId, guildId, settings: dto });
  return dto;
}

export async function createPoliceQruRecord(botId: string, input: CreatePoliceQruRecordInput) {
  const { policeQruRecords } = await getMongoCollections();
  const now = new Date();
  const row: MongoPoliceQruRecord = {
    _id: randomUUID(),
    approvalChannelId: input.approvalChannelId ?? null,
    approvalMessageId: input.approvalMessageId ?? null,
    approvedAt: input.status === "approved" ? now : null,
    approvedById: null,
    approvedByName: null,
    authorId: input.authorId,
    authorName: input.authorName.trim().slice(0, 100),
    boNumber: normalizeText(input.boNumber, 80),
    botId,
    createdAt: now,
    evidenceUrl: input.evidenceUrl,
    guildId: input.guildId,
    notes: normalizeText(input.notes ?? "", 1000) || null,
    occurrenceDate: normalizeText(input.occurrenceDate, 20),
    officers: uniqueOfficers(input.officers),
    qruType: normalizeText(input.qruType, 120),
    recordChannelId: input.recordChannelId ?? null,
    recordMessageId: input.recordMessageId ?? null,
    rejectionCount: 0,
    rejections: [],
    seizures: normalizeText(input.seizures ?? "", 500) || null,
    status: input.status ?? "pending",
    temporaryChannelId: input.temporaryChannelId ?? null,
    updatedAt: now,
    vehicle: normalizeText(input.vehicle, 120)
  };

  await policeQruRecords.insertOne(row);
  await createPoliceQruLog(botId, input.guildId, {
    action: "qru.created",
    actorId: input.authorId,
    actorName: input.authorName,
    metadata: {
      boNumber: row.boNumber,
      officerIds: row.officers.map((officer) => officer.id),
      qruType: row.qruType,
      status: row.status,
      vehicle: row.vehicle
    },
    recordId: row._id
  });
  emitRealtime("police-qru:record_created", { botId, guildId: input.guildId, record: recordDto(row) });
  return recordDto(row);
}

export async function updatePoliceQruApprovalMessage(botId: string, recordId: string, input: { approvalChannelId?: string | null; approvalMessageId?: string | null }) {
  const { policeQruRecords } = await getMongoCollections();
  const now = new Date();
  await policeQruRecords.updateOne({ _id: recordId, botId }, {
    $set: {
      ...(input.approvalChannelId !== undefined ? { approvalChannelId: input.approvalChannelId } : {}),
      ...(input.approvalMessageId !== undefined ? { approvalMessageId: input.approvalMessageId } : {}),
      updatedAt: now
    }
  });
  const updated = await policeQruRecords.findOne({ _id: recordId, botId });
  if (!updated) throw Object.assign(new Error("Registro QRU não encontrado."), { statusCode: 404 });
  return recordDto(updated);
}

export async function approvePoliceQruRecord(botId: string, recordId: string, input: { supervisorId: string; supervisorName: string }) {
  const { policeQruRecords } = await getMongoCollections();
  const now = new Date();
  const updated = await policeQruRecords.findOneAndUpdate(
    { _id: recordId, botId, status: "pending" },
    {
      $set: {
        approvedAt: now,
        approvedById: input.supervisorId,
        approvedByName: normalizeText(input.supervisorName, 100),
        status: "approved",
        updatedAt: now
      }
    },
    { returnDocument: "after" }
  );
  if (!updated) throw Object.assign(new Error("QRU já foi concluída por outro supervisor."), { statusCode: 409 });
  await createPoliceQruLog(botId, updated.guildId, {
    action: "qru.approved",
    actorId: input.supervisorId,
    actorName: input.supervisorName,
    metadata: { boNumber: updated.boNumber, qruType: updated.qruType },
    recordId: updated._id
  });
  return recordDto(updated);
}

export async function rejectPoliceQruRecord(botId: string, recordId: string, input: { reason: string; supervisorId: string; supervisorName: string }) {
  const { policeQruRecords } = await getMongoCollections();
  const now = new Date();
  const reason = normalizeText(input.reason, 1000);
  const updated = await policeQruRecords.findOneAndUpdate(
    { _id: recordId, botId, status: "pending" },
    {
      $inc: { rejectionCount: 1 },
      $push: {
        rejections: {
          reason,
          rejectedAt: now,
          supervisorId: input.supervisorId,
          supervisorName: normalizeText(input.supervisorName, 100)
        }
      },
      $set: {
        status: "rejected",
        updatedAt: now
      }
    },
    { returnDocument: "after" }
  );
  if (!updated) throw Object.assign(new Error("QRU já foi concluída por outro supervisor."), { statusCode: 409 });
  await createPoliceQruLog(botId, updated.guildId, {
    action: "qru.rejected",
    actorId: input.supervisorId,
    actorName: input.supervisorName,
    metadata: { boNumber: updated.boNumber, reason },
    recordId: updated._id
  });
  return recordDto(updated);
}

export async function resubmitPoliceQruRecord(botId: string, recordId: string, input: CreatePoliceQruRecordInput) {
  const { policeQruRecords } = await getMongoCollections();
  const now = new Date();
  const updated = await policeQruRecords.findOneAndUpdate(
    { _id: recordId, botId, status: "rejected", authorId: input.authorId },
    {
      $set: {
        approvalChannelId: input.approvalChannelId ?? null,
        approvalMessageId: input.approvalMessageId ?? null,
        boNumber: normalizeText(input.boNumber, 80),
        evidenceUrl: input.evidenceUrl,
        notes: normalizeText(input.notes ?? "", 1000) || null,
        occurrenceDate: normalizeText(input.occurrenceDate, 20),
        officers: uniqueOfficers(input.officers),
        qruType: normalizeText(input.qruType, 120),
        seizures: normalizeText(input.seizures ?? "", 500) || null,
        status: "pending",
        temporaryChannelId: input.temporaryChannelId ?? null,
        updatedAt: now,
        vehicle: normalizeText(input.vehicle, 120)
      }
    },
    { returnDocument: "after" }
  );
  if (!updated) throw Object.assign(new Error("QRU não está disponível para reenvio."), { statusCode: 409 });
  await createPoliceQruLog(botId, updated.guildId, {
    action: "qru.resubmitted",
    actorId: input.authorId,
    actorName: input.authorName,
    metadata: { boNumber: updated.boNumber, qruType: updated.qruType },
    recordId: updated._id
  });
  return recordDto(updated);
}

export async function updatePoliceQruRecordMessage(botId: string, recordId: string, input: { recordChannelId?: string | null; recordMessageId?: string | null }) {
  const { policeQruRecords } = await getMongoCollections();
  const now = new Date();
  await policeQruRecords.updateOne({ _id: recordId, botId }, {
    $set: {
      ...(input.recordChannelId !== undefined ? { recordChannelId: input.recordChannelId } : {}),
      ...(input.recordMessageId !== undefined ? { recordMessageId: input.recordMessageId } : {}),
      updatedAt: now
    }
  });
  const updated = await policeQruRecords.findOne({ _id: recordId, botId });
  if (!updated) throw Object.assign(new Error("Registro QRU não encontrado."), { statusCode: 404 });
  return recordDto(updated);
}

export async function listPoliceQruRecords(botId: string, guildId: string, search: PoliceQruSearchInput = {}, limit = 50) {
  const { policeQruRecords } = await getMongoCollections();
  const query: Record<string, unknown> = { botId, guildId, $or: [{ status: "approved" }, { status: { $exists: false } }] };
  if (search.boNumber) query.boNumber = { $regex: escapeRegex(search.boNumber), $options: "i" };
  if (search.qruType) query.qruType = { $regex: escapeRegex(search.qruType), $options: "i" };
  if (search.occurrenceDate) query.occurrenceDate = search.occurrenceDate;
  if (search.authorId) query.authorId = search.authorId;
  if (search.officerId) query["officers.id"] = search.officerId;

  return (await policeQruRecords.find(query).sort({ createdAt: -1 }).limit(Math.min(Math.max(limit, 1), 200)).toArray()).map(recordDto);
}

export async function getPoliceQruRanking(botId: string, guildId: string, limit = 20): Promise<PoliceQruRankingEntryDto[]> {
  const { policeQruRecords } = await getMongoCollections();
  const rows = await policeQruRecords.aggregate<{
    _id: string;
    firstQruAt: Date;
    lastQruAt: Date;
    officerName: string;
    total: number;
  }>([
    { $match: { botId, guildId, $or: [{ status: "approved" }, { status: { $exists: false } }] } },
    { $unwind: "$officers" },
    {
      $group: {
        _id: "$officers.id",
        firstQruAt: { $min: "$createdAt" },
        lastQruAt: { $max: "$createdAt" },
        officerName: { $last: "$officers.name" },
        total: { $sum: 1 }
      }
    },
    { $sort: { total: -1, officerName: 1 } },
    { $limit: Math.min(Math.max(limit, 1), 500) }
  ]).toArray();

  return rows.map((row, index) => ({
    firstQruAt: row.firstQruAt?.toISOString() ?? null,
    lastQruAt: row.lastQruAt?.toISOString() ?? null,
    officerId: row._id,
    officerName: row.officerName,
    position: index + 1,
    total: row.total
  }));
}

export async function getPoliceQruProfile(botId: string, guildId: string, officerId: string) {
  const { policeQruRecords } = await getMongoCollections();
  const [records, ranking] = await Promise.all([
    policeQruRecords.find({ botId, guildId, "officers.id": officerId, $or: [{ status: "approved" }, { status: { $exists: false } }] }).sort({ createdAt: 1 }).toArray(),
    getPoliceQruRanking(botId, guildId, 500)
  ]);
  const registeredBos = await policeQruRecords.countDocuments({ botId, guildId, authorId: officerId, $or: [{ status: "approved" }, { status: { $exists: false } }] });
  const position = ranking.find((entry) => entry.officerId === officerId)?.position ?? null;
  const officer = records.at(-1)?.officers.find((item) => item.id === officerId) ?? null;

  return {
    firstQruAt: records[0]?.createdAt.toISOString() ?? null,
    lastQruAt: records.at(-1)?.createdAt.toISOString() ?? null,
    officerId,
    officerName: officer?.name ?? null,
    position,
    registeredBos,
    total: records.length
  };
}

export async function createPoliceQruLog(botId: string, guildId: string, input: { action: string; actorId?: string | null; actorName?: string | null; metadata?: Record<string, unknown>; recordId?: string | null }) {
  const { policeQruLogs } = await getMongoCollections();
  const row = {
    _id: randomUUID(),
    action: input.action,
    actorId: input.actorId ?? null,
    actorName: input.actorName ?? null,
    botId,
    createdAt: new Date(),
    guildId,
    metadata: input.metadata ?? {},
    recordId: input.recordId ?? null
  };
  await policeQruLogs.insertOne(row);
  emitRealtime("police-qru:log_created", { botId, guildId, log: { ...row, id: row._id, createdAt: row.createdAt.toISOString() } });
}

async function getPoliceQruStats(botId: string, guildId: string) {
  const { policeQruRecords } = await getMongoCollections();
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 6);
  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);

  const [total, qrusToday, qrusWeek, qrusMonth, officerCount, topAuthorRows] = await Promise.all([
    policeQruRecords.countDocuments({ botId, guildId, $or: [{ status: "approved" }, { status: { $exists: false } }] }),
    policeQruRecords.countDocuments({ botId, guildId, createdAt: { $gte: todayStart }, $or: [{ status: "approved" }, { status: { $exists: false } }] }),
    policeQruRecords.countDocuments({ botId, guildId, createdAt: { $gte: weekStart }, $or: [{ status: "approved" }, { status: { $exists: false } }] }),
    policeQruRecords.countDocuments({ botId, guildId, createdAt: { $gte: monthStart }, $or: [{ status: "approved" }, { status: { $exists: false } }] }),
    policeQruRecords.distinct("officers.id", { botId, guildId, $or: [{ status: "approved" }, { status: { $exists: false } }] }).then((ids) => ids.length),
    policeQruRecords.aggregate<{ _id: string; name: string; total: number }>([
      { $match: { botId, guildId, $or: [{ status: "approved" }, { status: { $exists: false } }] } },
      { $group: { _id: "$authorId", name: { $last: "$authorName" }, total: { $sum: 1 } } },
      { $sort: { total: -1, name: 1 } },
      { $limit: 1 }
    ]).toArray()
  ]);

  return {
    officers: officerCount,
    qrusMonth,
    qrusToday,
    qrusWeek,
    topAuthor: topAuthorRows[0] ? { id: topAuthorRows[0]._id, name: topAuthorRows[0].name, total: topAuthorRows[0].total } : null,
    total
  };
}

async function listPoliceQruLogs(botId: string, guildId: string, limit = 50) {
  const { policeQruLogs } = await getMongoCollections();
  return (await policeQruLogs.find({ botId, guildId }).sort({ createdAt: -1 }).limit(limit).toArray()).map((log) => ({
    action: log.action,
    actorId: log.actorId,
    actorName: log.actorName,
    createdAt: log.createdAt.toISOString(),
    id: log._id,
    recordId: log.recordId
  }));
}

function defaultSettings(botId: string, guildId: string): MongoPoliceQruSettings {
  const now = new Date();
  return {
    _id: `${botId}:${guildId}`,
    allowedRoleIds: [],
    approvalChannelId: null,
    botId,
    color: "#2563eb",
    createdAt: now,
    deleteChannelSeconds: 15,
    enabled: false,
    guildId,
    logChannelId: null,
    panelDescription: "Utilize este painel para registrar uma nova ocorrência (QRU).",
    panelImageUrl: null,
    panelMessage: "Clique no botão abaixo para iniciar o atendimento da ocorrência.",
    panelTitle: "🚔 Sistema de Registro de QRU",
    rankingChannelId: null,
    rankingMessageId: null,
    recordChannelId: null,
    supervisorRoleIds: [],
    teamRoleId: null,
    temporaryCategoryId: null,
    updatedAt: now,
    updatedBy: null
  };
}

function settingsDto(row: MongoPoliceQruSettings): PoliceQruSettingsDto {
  const { _id, createdAt, updatedAt, ...rest } = row;
  return {
    ...rest,
    approvalChannelId: row.approvalChannelId ?? null,
    id: _id,
    createdAt: createdAt.toISOString(),
    rankingChannelId: row.rankingChannelId ?? null,
    rankingMessageId: row.rankingMessageId ?? null,
    updatedAt: updatedAt.toISOString()
  };
}

function recordDto(row: MongoPoliceQruRecord): PoliceQruRecordDto {
  const { _id, createdAt, updatedAt, ...rest } = row;
  return {
    ...rest,
    approvalChannelId: row.approvalChannelId ?? null,
    approvalMessageId: row.approvalMessageId ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    approvedById: row.approvedById ?? null,
    approvedByName: row.approvedByName ?? null,
    createdAt: createdAt.toISOString(),
    id: _id,
    notes: row.notes ?? null,
    rejectionCount: row.rejectionCount ?? 0,
    rejections: (row.rejections ?? []).map((item) => ({ ...item, rejectedAt: item.rejectedAt.toISOString() })),
    seizures: row.seizures ?? null,
    status: row.status ?? "approved",
    updatedAt: updatedAt.toISOString(),
    vehicle: row.vehicle ?? null
  };
}

function sanitizeSettingsInput(input: SavePoliceQruSettingsInput) {
  const next: SavePoliceQruSettingsInput = { ...input };
  if (next.allowedRoleIds !== undefined) next.allowedRoleIds = uniqueStrings(next.allowedRoleIds).slice(0, 100);
  if (next.approvalChannelId !== undefined) next.approvalChannelId = normalizeSnowflake(next.approvalChannelId);
  if (next.supervisorRoleIds !== undefined) next.supervisorRoleIds = uniqueStrings(next.supervisorRoleIds).slice(0, 100);
  if (next.recordChannelId !== undefined) next.recordChannelId = normalizeSnowflake(next.recordChannelId);
  if (next.logChannelId !== undefined) next.logChannelId = normalizeSnowflake(next.logChannelId);
  if (next.rankingChannelId !== undefined) next.rankingChannelId = normalizeSnowflake(next.rankingChannelId);
  if (next.rankingMessageId !== undefined) next.rankingMessageId = normalizeSnowflake(next.rankingMessageId);
  if (next.temporaryCategoryId !== undefined) next.temporaryCategoryId = normalizeSnowflake(next.temporaryCategoryId);
  if (next.teamRoleId !== undefined) next.teamRoleId = normalizeSnowflake(next.teamRoleId);
  if (next.color !== undefined) next.color = /^#[0-9a-f]{6}$/i.test(next.color) ? next.color : "#2563eb";
  if (next.deleteChannelSeconds !== undefined) next.deleteChannelSeconds = Math.min(Math.max(Math.round(next.deleteChannelSeconds), 0), 3600);
  if (next.panelTitle !== undefined) next.panelTitle = normalizeText(next.panelTitle, 200) || "🚔 Sistema de Registro de QRU";
  if (next.panelDescription !== undefined) next.panelDescription = normalizeText(next.panelDescription, 1200) || "Utilize este painel para registrar uma nova ocorrência (QRU).";
  if (next.panelMessage !== undefined) next.panelMessage = normalizeText(next.panelMessage, 1200) || "Clique no botão abaixo para iniciar o atendimento da ocorrência.";
  if (next.panelImageUrl !== undefined) next.panelImageUrl = next.panelImageUrl?.trim() || null;
  return next;
}

function uniqueOfficers(officers: MongoPoliceQruOfficer[]) {
  const seen = new Set<string>();
  const result: MongoPoliceQruOfficer[] = [];
  for (const officer of officers) {
    if (!officer.id || seen.has(officer.id)) continue;
    seen.add(officer.id);
    result.push({
      id: officer.id,
      mention: officer.mention || `<@${officer.id}>`,
      name: normalizeText(officer.name, 100) || officer.id
    });
  }
  return result.slice(0, 100);
}

function normalizeText(value: string, maxLength: number) {
  return String(value ?? "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxLength);
}

function normalizeSnowflake(value: string | null | undefined) {
  const text = value?.trim() ?? "";
  return /^\d{5,32}$/.test(text) ? text : null;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter((value) => /^\d{5,32}$/.test(value)))];
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

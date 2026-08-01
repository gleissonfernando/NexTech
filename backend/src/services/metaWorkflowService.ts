import { createHash, randomUUID } from "node:crypto";
import type { Collection, Db } from "mongodb";
import { getMongoDb } from "../database/mongo";

export type MetaRequestStatus = "pending" | "approved" | "rejected" | "cancelled";
export type MetaProofStatus = "pending" | "confirmed" | "discarded" | "invalidated";
export type MetaAbsenceStatus = "pending" | "approved" | "rejected" | "finished";

export type MetaSetRequestDocument = {
  _id: string;
  approvalChannelId: string | null;
  approvalMessageId: string | null;
  approvalTypeId: string | null;
  botId: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  formData: Array<{ fieldId: string; label: string; value: string }>;
  guildId: string;
  history: Array<{ action: string; actorId: string | null; at: Date; details?: Record<string, unknown> }>;
  rejectionReason: string | null;
  status: MetaRequestStatus;
  updatedAt: Date;
  userId: string;
};

export type MetaPendingProofDocument = {
  _id: string;
  attachmentHash: string;
  attachmentId: string;
  attachmentUrl: string;
  botId: string | null;
  channelId: string;
  confirmationMessageId: string | null;
  createdAt: Date;
  expiresAt: Date;
  guildId: string;
  metaTypeId: string | null;
  sourceMessageId: string;
  status: MetaProofStatus;
  updatedAt: Date;
  userId: string;
};

export type MetaRegistrationDocument = {
  _id: string;
  amountMinor: string;
  attachmentHash: string;
  attachmentId: string;
  attachmentUrl: string;
  botId: string | null;
  channelId: string;
  confirmationMessageId: string | null;
  createdAt: Date;
  cycleId: string;
  deletedAt: Date | null;
  deletedBy: string | null;
  editHistory: Array<{ actorId: string; at: Date; beforeAmountMinor: string; beforeMetaTypeId: string; reason: string }>;
  guildId: string;
  metaTypeId: string;
  sourceMessageId: string;
  status: "confirmed" | "invalidated" | "deleted";
  updatedAt: Date;
  userId: string;
};

export type MetaCycleDocument = {
  _id: string;
  botId: string | null;
  configurationSnapshot: Record<string, unknown>;
  createdAt: Date;
  endsAt: Date;
  finalizedAt: Date | null;
  guildId: string;
  lockExpiresAt: Date | null;
  startsAt: Date;
  status: "open" | "processing" | "finalized";
  summaryMessageIds: string[];
  updatedAt: Date;
};

export type MetaAbsenceDocument = {
  _id: string;
  approvedAt: Date | null;
  approvedBy: string | null;
  botId: string | null;
  createdAt: Date;
  endsAt: Date;
  exemptionType: "total" | "partial" | "proportional" | "informational";
  guildId: string;
  reason: string | null;
  reductionAmountMinor: string | null;
  startsAt: Date;
  status: MetaAbsenceStatus;
  updatedAt: Date;
  userId: string;
};

export type MetaAuditDocument = {
  _id: string;
  action: string;
  actorId: string | null;
  afterData: Record<string, unknown> | null;
  beforeData: Record<string, unknown> | null;
  botId: string | null;
  createdAt: Date;
  entityId: string | null;
  entityType: string;
  guildId: string;
  metadata: Record<string, unknown>;
  source: "dashboard" | "discord" | "system";
  targetUserId: string | null;
};

let indexesPromise: Promise<void> | null = null;

function scope(guildId: string, botId?: string | null) {
  const normalizedBotId = botId?.trim() || null;
  return normalizedBotId ? { botId: normalizedBotId, guildId } : { guildId, $or: [{ botId: null }, { botId: { $exists: false } }] };
}

async function collections() {
  const db = await getMongoDb();
  indexesPromise ??= ensureMetaWorkflowIndexes(db).catch((error) => {
    indexesPromise = null;
    throw error;
  });
  await indexesPromise;
  return {
    absences: db.collection<MetaAbsenceDocument>("meta_absences"),
    audits: db.collection<MetaAuditDocument>("meta_audit_logs"),
    cycles: db.collection<MetaCycleDocument>("meta_cycles"),
    pendingProofs: db.collection<MetaPendingProofDocument>("meta_pending_proofs"),
    registrations: db.collection<MetaRegistrationDocument>("meta_registrations"),
    setRequests: db.collection<MetaSetRequestDocument>("meta_set_requests")
  };
}

async function ensureMetaWorkflowIndexes(db: Db) {
  await Promise.all([
    db.collection("meta_set_requests").createIndex({ botId: 1, guildId: 1, userId: 1, status: 1 }, { name: "meta_set_request_user_status" }),
    db.collection("meta_set_requests").createIndex({ botId: 1, guildId: 1, userId: 1 }, { name: "meta_set_one_pending_per_user", partialFilterExpression: { status: "pending" }, unique: true }),
    db.collection("meta_pending_proofs").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "meta_pending_proof_ttl" }),
    db.collection("meta_pending_proofs").createIndex({ botId: 1, guildId: 1, sourceMessageId: 1, attachmentId: 1 }, { name: "meta_proof_source_attachment", unique: true }),
    db.collection("meta_registrations").createIndex({ botId: 1, guildId: 1, attachmentHash: 1 }, { name: "meta_registration_attachment_hash", unique: true }),
    db.collection("meta_registrations").createIndex({ botId: 1, guildId: 1, cycleId: 1, userId: 1, status: 1 }, { name: "meta_registration_progress" }),
    db.collection("meta_cycles").createIndex({ botId: 1, guildId: 1, startsAt: 1, endsAt: 1 }, { name: "meta_cycle_period", unique: true }),
    db.collection("meta_absences").createIndex({ botId: 1, guildId: 1, userId: 1, startsAt: 1, endsAt: 1 }, { name: "meta_absence_user_period" }),
    db.collection("meta_audit_logs").createIndex({ botId: 1, guildId: 1, createdAt: -1 }, { name: "meta_audit_timeline" })
  ]);
}

export async function createMetaSetRequest(input: {
  approvalChannelId?: string | null;
  botId?: string | null;
  formData: Array<{ fieldId: string; label: string; value: string }>;
  guildId: string;
  userId: string;
}) {
  const { setRequests } = await collections();
  const now = new Date();
  const document: MetaSetRequestDocument = {
    _id: randomUUID(), approvalChannelId: input.approvalChannelId ?? null, approvalMessageId: null, approvalTypeId: null,
    botId: input.botId?.trim() || null, createdAt: now, decidedAt: null, decidedBy: null,
    formData: input.formData.slice(0, 10).map((field) => ({ fieldId: safeText(field.fieldId, 80), label: safeText(field.label, 100), value: safeText(field.value, 1500) })),
    guildId: input.guildId, history: [{ action: "created", actorId: input.userId, at: now }], rejectionReason: null,
    status: "pending", updatedAt: now, userId: input.userId
  };
  try {
    await setRequests.insertOne(document);
  } catch (error) {
    if (isDuplicateKey(error)) throw workflowError("Você já possui uma solicitação pendente.", "SET_REQUEST_PENDING");
    throw error;
  }
  await writeMetaAudit({ action: "set.requested", actorId: input.userId, botId: document.botId, entityId: document._id, entityType: "set_request", guildId: input.guildId, source: "discord", targetUserId: input.userId });
  return serialize(document);
}

export async function decideMetaSetRequest(input: {
  actorId: string;
  approvalTypeId?: string | null;
  botId?: string | null;
  guildId: string;
  reason?: string | null;
  requestId: string;
  status: "approved" | "rejected";
}) {
  const { setRequests } = await collections();
  const now = new Date();
  const updated = await setRequests.findOneAndUpdate(
    { _id: input.requestId, ...scope(input.guildId, input.botId), status: "pending" },
    { $push: { history: { action: input.status, actorId: input.actorId, at: now, details: { approvalTypeId: input.approvalTypeId ?? null, reason: input.reason ?? null } } }, $set: { approvalTypeId: input.approvalTypeId ?? null, decidedAt: now, decidedBy: input.actorId, rejectionReason: input.status === "rejected" ? safeOptionalText(input.reason, 800) : null, status: input.status, updatedAt: now } },
    { returnDocument: "after" }
  );
  if (!updated) throw workflowError("Esta solicitação já foi analisada por outro administrador.", "SET_REQUEST_DECIDED");
  await writeMetaAudit({ action: `set.${input.status}`, actorId: input.actorId, botId: input.botId ?? null, entityId: input.requestId, entityType: "set_request", guildId: input.guildId, metadata: { approvalTypeId: input.approvalTypeId ?? null, reason: input.reason ?? null }, source: "discord", targetUserId: updated.userId });
  return serialize(updated);
}

export async function updateMetaSetRequestMessage(guildId: string, requestId: string, botId: string | null | undefined, approvalMessageId: string) {
  const { setRequests } = await collections();
  const updated = await setRequests.findOneAndUpdate({ _id: requestId, ...scope(guildId, botId) }, { $set: { approvalMessageId, updatedAt: new Date() } }, { returnDocument: "after" });
  return updated ? serialize(updated) : null;
}

export async function getMetaSetRequest(guildId: string, requestId: string, botId?: string | null) {
  const { setRequests } = await collections();
  const row = await setRequests.findOne({ _id: requestId, ...scope(guildId, botId) });
  return row ? serialize(row) : null;
}

export async function createMetaPendingProof(input: { attachmentId: string; attachmentUrl: string; botId?: string | null; channelId: string; guildId: string; sourceMessageId: string; userId: string }) {
  const { pendingProofs, registrations } = await collections();
  const now = new Date();
  const attachmentHash = createHash("sha256").update(`${input.guildId}:${input.attachmentId}:${input.attachmentUrl}`).digest("hex");
  if (await registrations.findOne({ ...scope(input.guildId, input.botId), attachmentHash })) throw workflowError("Esta imagem já foi utilizada em um registro.", "PROOF_USED");
  const document: MetaPendingProofDocument = {
    _id: randomUUID(), attachmentHash, attachmentId: safeText(input.attachmentId, 100), attachmentUrl: safeText(input.attachmentUrl, 2048),
    botId: input.botId?.trim() || null, channelId: input.channelId, confirmationMessageId: null, createdAt: now,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000), guildId: input.guildId, metaTypeId: null,
    sourceMessageId: input.sourceMessageId, status: "pending", updatedAt: now, userId: input.userId
  };
  try {
    await pendingProofs.insertOne(document);
  } catch (error) {
    if (isDuplicateKey(error)) throw workflowError("Esta imagem já está aguardando confirmação.", "PROOF_PENDING");
    throw error;
  }
  return serialize(document);
}

export async function getMetaPendingProof(guildId: string, proofId: string, botId?: string | null) {
  const { pendingProofs } = await collections();
  const row = await pendingProofs.findOne({ _id: proofId, ...scope(guildId, botId), status: "pending", expiresAt: { $gt: new Date() } });
  return row ? serialize(row) : null;
}

export async function confirmMetaPendingProof(input: { amountMinor: string; botId?: string | null; cycleId: string; guildId: string; metaTypeId: string; proofId: string; userId: string }) {
  const amountMinor = normalizeMinorAmount(input.amountMinor);
  const { pendingProofs, registrations } = await collections();
  const now = new Date();
  const proof = await pendingProofs.findOneAndUpdate(
    { _id: input.proofId, ...scope(input.guildId, input.botId), status: "pending", userId: input.userId, expiresAt: { $gt: now } },
    { $set: { metaTypeId: input.metaTypeId, status: "confirmed", updatedAt: now } },
    { returnDocument: "after" }
  );
  if (!proof) throw workflowError("Este comprovante expirou ou já foi processado.", "PROOF_NOT_PENDING");
  const registration: MetaRegistrationDocument = {
    _id: randomUUID(), amountMinor, attachmentHash: proof.attachmentHash, attachmentId: proof.attachmentId, attachmentUrl: proof.attachmentUrl,
    botId: proof.botId, channelId: proof.channelId, confirmationMessageId: proof.confirmationMessageId, createdAt: now,
    cycleId: input.cycleId, deletedAt: null, deletedBy: null, editHistory: [], guildId: proof.guildId,
    metaTypeId: input.metaTypeId, sourceMessageId: proof.sourceMessageId, status: "confirmed", updatedAt: now, userId: proof.userId
  };
  try {
    await registrations.insertOne(registration);
  } catch (error) {
    await pendingProofs.updateOne({ _id: proof._id, status: "confirmed" }, { $set: { status: "pending", updatedAt: new Date() } }).catch(() => null);
    if (isDuplicateKey(error)) throw workflowError("Esta imagem já foi utilizada em um registro.", "PROOF_USED");
    throw error;
  }
  await writeMetaAudit({ action: "registration.created", actorId: input.userId, botId: proof.botId, entityId: registration._id, entityType: "registration", guildId: proof.guildId, metadata: { amountMinor, metaTypeId: input.metaTypeId }, source: "discord", targetUserId: proof.userId });
  return serialize(registration);
}

export async function ensureMetaCycle(input: { botId?: string | null; configurationSnapshot: Record<string, unknown>; endsAt: Date; guildId: string; startsAt: Date }) {
  const { cycles } = await collections();
  const now = new Date();
  await cycles.updateOne(
    { ...scope(input.guildId, input.botId), startsAt: input.startsAt, endsAt: input.endsAt },
    { $setOnInsert: { _id: randomUUID(), botId: input.botId?.trim() || null, configurationSnapshot: input.configurationSnapshot, createdAt: now, finalizedAt: null, guildId: input.guildId, lockExpiresAt: null, startsAt: input.startsAt, endsAt: input.endsAt, status: "open", summaryMessageIds: [], updatedAt: now } },
    { upsert: true }
  );
  const cycle = await cycles.findOne({ ...scope(input.guildId, input.botId), startsAt: input.startsAt, endsAt: input.endsAt });
  if (!cycle) throw new Error("Não foi possível criar o ciclo de metas.");
  return serialize(cycle);
}

export async function claimMetaCycleFinalization(guildId: string, cycleId: string, botId?: string | null) {
  const { cycles } = await collections();
  const now = new Date();
  const cycle = await cycles.findOneAndUpdate(
    { _id: cycleId, ...scope(guildId, botId), $or: [{ status: "open" }, { status: "processing", lockExpiresAt: { $lt: now } }] },
    { $set: { lockExpiresAt: new Date(now.getTime() + 5 * 60 * 1000), status: "processing", updatedAt: now } },
    { returnDocument: "after" }
  );
  return cycle ? serialize(cycle) : null;
}

export async function completeMetaCycleFinalization(guildId: string, cycleId: string, botId: string | null | undefined, summaryMessageIds: string[]) {
  const { cycles } = await collections();
  const now = new Date();
  const cycle = await cycles.findOneAndUpdate(
    { _id: cycleId, ...scope(guildId, botId), status: "processing" },
    { $set: { finalizedAt: now, lockExpiresAt: null, status: "finalized", summaryMessageIds: [...new Set(summaryMessageIds)].slice(0, 500), updatedAt: now } },
    { returnDocument: "after" }
  );
  return cycle ? serialize(cycle) : null;
}

export async function listMetaWorkflowDashboard(guildId: string, botId?: string | null) {
  const { absences, audits, cycles, registrations, setRequests } = await collections();
  const query = scope(guildId, botId);
  const [requestRows, registrationRows, cycleRows, absenceRows, auditRows] = await Promise.all([
    setRequests.find(query).sort({ createdAt: -1 }).limit(200).toArray(),
    registrations.find(query).sort({ createdAt: -1 }).limit(500).toArray(),
    cycles.find(query).sort({ startsAt: -1 }).limit(52).toArray(),
    absences.find(query).sort({ createdAt: -1 }).limit(200).toArray(),
    audits.find(query).sort({ createdAt: -1 }).limit(300).toArray()
  ]);
  return { absences: serialize(absenceRows), audits: serialize(auditRows), cycles: serialize(cycleRows), registrations: serialize(registrationRows), setRequests: serialize(requestRows) };
}

export async function cleanupMetaMember(guildId: string, userId: string, botId?: string | null) {
  const { absences, pendingProofs, registrations, setRequests } = await collections();
  const query = { ...scope(guildId, botId), userId };
  const now = new Date();
  const [requests, proofs, absenceResult] = await Promise.all([
    setRequests.updateMany({ ...query, status: "pending" }, { $push: { history: { action: "cancelled_member_left", actorId: null, at: now } }, $set: { status: "cancelled", updatedAt: now } }),
    pendingProofs.updateMany({ ...query, status: "pending" }, { $set: { status: "discarded", updatedAt: now } }),
    absences.updateMany({ ...query, status: { $in: ["pending", "approved"] } }, { $set: { status: "finished", updatedAt: now } })
  ]);
  const registrationsPreserved = await registrations.countDocuments(query);
  await writeMetaAudit({ action: "member.cleaned", actorId: null, botId: botId ?? null, entityId: userId, entityType: "member", guildId, metadata: { absencesFinished: absenceResult.modifiedCount, pendingProofsDiscarded: proofs.modifiedCount, registrationsPreserved, setRequestsCancelled: requests.modifiedCount }, source: "system", targetUserId: userId });
  return { absencesFinished: absenceResult.modifiedCount, pendingProofsDiscarded: proofs.modifiedCount, registrationsPreserved, setRequestsCancelled: requests.modifiedCount };
}

export async function writeMetaAudit(input: Omit<MetaAuditDocument, "_id" | "afterData" | "beforeData" | "createdAt" | "metadata" | "targetUserId"> & Partial<Pick<MetaAuditDocument, "afterData" | "beforeData" | "metadata" | "targetUserId">>) {
  const db = await getMongoDb();
  const audits: Collection<MetaAuditDocument> = db.collection("meta_audit_logs");
  await audits.insertOne({ _id: randomUUID(), action: safeText(input.action, 120), actorId: input.actorId ?? null, afterData: input.afterData ?? null, beforeData: input.beforeData ?? null, botId: input.botId?.trim() || null, createdAt: new Date(), entityId: input.entityId ?? null, entityType: safeText(input.entityType, 80), guildId: input.guildId, metadata: input.metadata ?? {}, source: input.source, targetUserId: input.targetUserId ?? null });
}

export function normalizeMinorAmount(value: string) {
  const normalized = value.trim();
  if (!/^\d{1,30}$/.test(normalized)) throw workflowError("Informe uma quantidade válida e maior que zero.", "INVALID_AMOUNT");
  const amount = BigInt(normalized);
  if (amount <= 0n) throw workflowError("Informe uma quantidade válida e maior que zero.", "INVALID_AMOUNT");
  return amount.toString();
}

function safeText(value: string, limit: number) { return value.trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, limit); }
function safeOptionalText(value: string | null | undefined, limit: number) { const result = value ? safeText(value, limit) : ""; return result || null; }
function isDuplicateKey(error: unknown) { return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: number }).code === 11000); }
function workflowError(message: string, code: string) { return Object.assign(new Error(message), { code, status: 409 }); }
function serialize<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

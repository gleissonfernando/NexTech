import { randomUUID } from "node:crypto";
import {
  getMongoCollections,
  type MongoDafScaleEntry,
  type MongoDafScaleHistory,
  type MongoDafScaleRole,
  type MongoDafScaleSession,
  type MongoDafScaleSettings
} from "../database/mongo";

const AIRCRAFT_CAPACITY = 3;
const SEAT_ORDER: MongoDafScaleRole[] = ["pilot", "copilot", "gunner"];

export type DafScaleSettingsPatch = Partial<Pick<MongoDafScaleSettings,
  "configRoleId" | "enabled" | "gunnerRoleId" | "logChannelId" |
  "panelChannelId" | "panelMessageId" | "participantRoleId" | "pilotRoleId" | "shooterRoleId"
>> & {
  copilotRoleId?: string | null;
};

export type DafScaleMemberInput = {
  actorId?: string | null;
  actorName?: string | null;
  roleIds: string[];
  userId: string;
  username: string;
};

export type DafScaleActionResult = {
  action: "join" | "leave" | "switch" | "none";
  entry: ReturnType<typeof entryDto> | null;
  previousRole: MongoDafScaleRole | null;
  settings: ReturnType<typeof settingsDto>;
  state: Awaited<ReturnType<typeof getDafScaleState>>;
};

type Occupancy = {
  entries: MongoDafScaleEntry[];
  sessions: MongoDafScaleSession[];
};

export async function getDafScaleState(botId: string, guildId: string) {
  const settings = await getDafScaleSettings(botId, guildId);
  await migrateLegacyEntriesIfNeeded(botId, guildId);
  const { dafScaleEntries, dafScaleHistory, dafScaleSessions } = await getMongoCollections();
  const [entries, sessions, history] = await Promise.all([
    dafScaleEntries.find({ botId, guildId, sessionId: { $type: "string" } }).sort({ aircraftNumber: 1, role: 1, joinedAt: 1 }).toArray(),
    dafScaleSessions.find({ botId, guildId, status: "open" }).sort({ aircraftNumber: 1 }).toArray(),
    dafScaleHistory.find({ botId, guildId }).sort({ closedAt: -1 }).limit(20).toArray()
  ]);
  const sessionDtos = sessions.map((session) => sessionDto(session, entries));
  const pilots = entries.filter((entry) => entry.role === "pilot").map(entryDto);
  const copilots = entries.filter((entry) => entry.role === "copilot").map(entryDto);
  const gunners = entries.filter((entry) => entry.role === "gunner").map(entryDto);
  const totalOccupants = entries.length;
  return {
    aircraftCapacity: AIRCRAFT_CAPACITY,
    entries: entries.map(entryDto),
    history: history.map(historyDto),
    copilots,
    seats: SEAT_ORDER,
    settings: settingsDto(settings),
    sessions: sessionDtos,
    pilots,
    gunners,
    summary: {
      activeAircraft: sessionDtos.length,
      availableSeats: Math.max(0, sessionDtos.length * AIRCRAFT_CAPACITY - totalOccupants),
      closedAircraft: history.length,
      totalOccupants
    }
  };
}

export async function getDafScaleSettings(botId: string, guildId: string) {
  const { dafScaleSettings } = await getMongoCollections();
  const existing = await dafScaleSettings.findOne({ botId, guildId });
  if (existing) {
    if (existing.gunnerRoleId === undefined || existing.copilotRoleId === undefined) {
      const now = new Date();
      const migrated = {
        copilotRoleId: existing.copilotRoleId ?? null,
        gunnerRoleId: existing.gunnerRoleId ?? existing.shooterRoleId ?? null,
        updatedAt: now
      };
      await dafScaleSettings.updateOne({ botId, guildId }, { $set: migrated });
      return { ...existing, ...migrated };
    }
    return existing;
  }
  const now = new Date();
  const settings: MongoDafScaleSettings = {
    _id: randomUUID(),
    botId,
    configRoleId: null,
    copilotRoleId: null,
    createdAt: now,
    enabled: false,
    guildId,
    gunnerRoleId: null,
    logChannelId: null,
    maxPilots: 4,
    maxShooters: 6,
    panelChannelId: null,
    panelMessageId: null,
    participantRoleId: null,
    pilotRoleId: null,
    shooterRoleId: null,
    updatedAt: now,
    updatedBy: null
  };
  await dafScaleSettings.insertOne(settings);
  return settings;
}

export async function saveDafScaleSettings(botId: string, guildId: string, patch: DafScaleSettingsPatch, actorId: string | null) {
  const { dafScaleSettings } = await getMongoCollections();
  await getDafScaleSettings(botId, guildId);
  const now = new Date();
  const normalized = normalizeSettingsPatch(patch);
  await dafScaleSettings.updateOne(
    { botId, guildId },
    { $set: { ...normalized, updatedAt: now, updatedBy: actorId } }
  );
  await recordDafScaleAudit(botId, guildId, {
    action: "config",
    metadata: { patch: Object.keys(normalized) },
    previousRole: null,
    role: null,
    userId: actorId ?? "system",
    username: actorId ?? "system"
  });
  return settingsDto((await dafScaleSettings.findOne({ botId, guildId }))!);
}

export async function setDafScalePanelMessage(botId: string, guildId: string, messageId: string | null, actorId: string | null) {
  return saveDafScaleSettings(botId, guildId, { panelMessageId: messageId }, actorId);
}

export async function joinDafScale(botId: string, guildId: string, role: MongoDafScaleRole | null, member: DafScaleMemberInput) {
  const settings = await getDafScaleSettings(botId, guildId);
  assertEnabled(settings);
  assertMemberAllowed(settings, role, member.roleIds);
  await migrateLegacyEntriesIfNeeded(botId, guildId);

  const { dafScaleEntries } = await getMongoCollections();
  const existing = await dafScaleEntries.findOne({ botId, guildId, userId: member.userId, sessionId: { $type: "string" } });
  const target = await findAvailableSeat(botId, guildId, role, existing?._id ?? null);

  if (existing?.sessionId === target.session._id && existing.role === target.role) {
    return buildResult(botId, guildId, "none", existing, existing.role);
  }

  const now = new Date();
  const entry: MongoDafScaleEntry = {
    _id: existing?._id ?? randomUUID(),
    aircraftNumber: target.session.aircraftNumber,
    botId,
    guildId,
    joinedAt: existing?.joinedAt ?? now,
    role: target.role,
    sessionId: target.session._id,
    updatedAt: now,
    userId: member.userId,
    username: member.username
  };

  await upsertEntryWithRetry(botId, guildId, role, member, entry, existing);
  const saved = await dafScaleEntries.findOne({ botId, guildId, userId: member.userId });
  const action = existing ? "switch" : "join";
  await recordDafScaleAudit(botId, guildId, {
    action,
    metadata: {
      actorId: member.actorId ?? null,
      actorName: member.actorName ?? null,
      aircraftNumber: saved?.aircraftNumber ?? entry.aircraftNumber,
      sessionId: saved?.sessionId ?? entry.sessionId
    },
    previousRole: existing?.role ?? null,
    role: saved?.role ?? entry.role,
    userId: member.userId,
    username: member.username
  });
  return buildResult(botId, guildId, action, saved ?? entry, existing?.role ?? null);
}

export async function leaveDafScale(botId: string, guildId: string, member: Pick<DafScaleMemberInput, "userId" | "username">) {
  const { dafScaleEntries } = await getMongoCollections();
  const existing = await dafScaleEntries.findOne({ botId, guildId, userId: member.userId });
  if (!existing) {
    return buildResult(botId, guildId, "none", null, null);
  }

  await dafScaleEntries.deleteOne({ botId, guildId, userId: member.userId });
  await maybeCloseEmptySession(botId, guildId, existing.sessionId, member.userId, "Sem ocupantes ativos");
  await recordDafScaleAudit(botId, guildId, {
    action: "leave",
    metadata: { aircraftNumber: existing.aircraftNumber, sessionId: existing.sessionId },
    previousRole: existing.role,
    role: existing.role,
    userId: member.userId,
    username: member.username
  });
  return buildResult(botId, guildId, "leave", null, existing.role);
}

export async function recordDafScaleAudit(botId: string, guildId: string, input: {
  action: "join" | "leave" | "switch" | "refresh" | "publish" | "config" | "create_session" | "close_session" | "migrate";
  metadata?: Record<string, unknown> | null;
  previousRole: MongoDafScaleRole | null;
  role: MongoDafScaleRole | null;
  userId: string;
  username: string;
}) {
  const { dafScaleAudits } = await getMongoCollections();
  await dafScaleAudits.insertOne({
    _id: randomUUID(),
    botId,
    createdAt: new Date(),
    guildId,
    metadata: input.metadata ?? null,
    ...input
  });
}

async function upsertEntryWithRetry(
  botId: string,
  guildId: string,
  preferredRole: MongoDafScaleRole | null,
  member: DafScaleMemberInput,
  firstEntry: MongoDafScaleEntry,
  existing: MongoDafScaleEntry | null
) {
  const { dafScaleEntries } = await getMongoCollections();
  let entry = firstEntry;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await dafScaleEntries.updateOne(
        { botId, guildId, userId: member.userId },
        { $set: entry, $setOnInsert: { _id: entry._id } },
        { upsert: true }
      );
      return;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const target = await findAvailableSeat(botId, guildId, preferredRole, existing?._id ?? null);
      entry = {
        ...entry,
        aircraftNumber: target.session.aircraftNumber,
        role: target.role,
        sessionId: target.session._id,
        updatedAt: new Date()
      };
    }
  }
  throw serviceError("Nao foi possivel reservar uma vaga livre na Escala Aerea. Tente novamente.", 409);
}

async function findAvailableSeat(botId: string, guildId: string, preferredRole: MongoDafScaleRole | null, currentEntryId: string | null) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const occupancy = await readOccupancy(botId, guildId);
    const seats = preferredRole ? [preferredRole] : SEAT_ORDER;
    for (const session of occupancy.sessions) {
      for (const role of seats) {
        if (isSeatFree(occupancy.entries, session._id, role, currentEntryId)) {
          return { role, session };
        }
      }
    }
    const session = await createSession(botId, guildId);
    return { role: preferredRole ?? "pilot", session };
  }
  throw serviceError("Nao foi possivel encontrar vaga disponivel na Escala Aerea.", 409);
}

async function readOccupancy(botId: string, guildId: string): Promise<Occupancy> {
  const { dafScaleEntries, dafScaleSessions } = await getMongoCollections();
  const [entries, sessions] = await Promise.all([
    dafScaleEntries.find({ botId, guildId, sessionId: { $type: "string" } }).toArray(),
    dafScaleSessions.find({ botId, guildId, status: "open" }).sort({ aircraftNumber: 1 }).toArray()
  ]);
  if (sessions.length) return { entries, sessions };
  return { entries, sessions: [await createSession(botId, guildId)] };
}

async function createSession(botId: string, guildId: string) {
  const { dafScaleCounters, dafScaleSessions } = await getMongoCollections();
  const now = new Date();
  const counter = await dafScaleCounters.findOneAndUpdate(
    { botId, guildId },
    {
      $inc: { nextAircraftNumber: 1 },
      $set: { updatedAt: now },
      $setOnInsert: { _id: randomUUID(), botId, guildId, nextAircraftNumber: 1 }
    },
    { returnDocument: "after", upsert: true }
  );
  const aircraftNumber = Math.max(1, (counter?.nextAircraftNumber ?? 1) - 1);
  const session: MongoDafScaleSession = {
    _id: randomUUID(),
    aircraftNumber,
    botId,
    closeReason: null,
    closedAt: null,
    closedBy: null,
    createdAt: now,
    guildId,
    status: "open",
    title: null,
    updatedAt: now
  };
  await dafScaleSessions.insertOne(session);
  await recordDafScaleAudit(botId, guildId, {
    action: "create_session",
    metadata: { aircraftNumber, sessionId: session._id },
    previousRole: null,
    role: null,
    userId: "system",
    username: "system"
  });
  return session;
}

async function maybeCloseEmptySession(botId: string, guildId: string, sessionId: string | null, closedBy: string | null, reason: string | null) {
  if (!sessionId) return;
  const { dafScaleEntries, dafScaleHistory, dafScaleSessions } = await getMongoCollections();
  const session = await dafScaleSessions.findOne({ _id: sessionId, botId, guildId, status: "open" });
  if (!session) return;
  const occupants = await dafScaleEntries.find({ botId, guildId, sessionId }).sort({ role: 1, joinedAt: 1 }).toArray();
  if (occupants.length) return;
  const now = new Date();
  const updated = await dafScaleSessions.updateOne(
    { _id: sessionId, botId, guildId, status: "open" },
    { $set: { closedAt: now, closedBy, closeReason: reason, status: "closed", updatedAt: now } }
  );
  if (!updated.modifiedCount) return;
  const history: MongoDafScaleHistory = {
    _id: randomUUID(),
    aircraftNumber: session.aircraftNumber,
    botId,
    closedAt: now,
    closedBy,
    closeReason: reason,
    createdAt: now,
    guildId,
    occupants: occupants.map((entry) => ({
      aircraftNumber: entry.aircraftNumber,
      joinedAt: entry.joinedAt,
      role: entry.role,
      userId: entry.userId,
      username: entry.username
    })),
    sessionId,
    title: session.title ?? null
  };
  await dafScaleHistory.insertOne(history);
  await recordDafScaleAudit(botId, guildId, {
    action: "close_session",
    metadata: { aircraftNumber: session.aircraftNumber, reason, sessionId },
    previousRole: null,
    role: null,
    userId: closedBy ?? "system",
    username: closedBy ?? "system"
  });
}

async function migrateLegacyEntriesIfNeeded(botId: string, guildId: string) {
  const { dafScaleEntries, dafScaleSessions } = await getMongoCollections();
  const legacyEntries = await dafScaleEntries.find({
    botId,
    guildId,
    $or: [{ sessionId: { $exists: false } }, { sessionId: null }, { aircraftNumber: { $exists: false } }]
  }).sort({ role: 1, joinedAt: 1 }).toArray();
  if (!legacyEntries.length) return;

  const openSessions = await dafScaleSessions.find({ botId, guildId, status: "open" }).sort({ aircraftNumber: 1 }).toArray();
  let currentSession = openSessions[0] ?? await createSession(botId, guildId);
  const usedSeats = new Map<string, Set<MongoDafScaleRole>>();

  for (const session of openSessions) {
    usedSeats.set(session._id, new Set());
  }
  usedSeats.set(currentSession._id, usedSeats.get(currentSession._id) ?? new Set());

  for (const entry of legacyEntries) {
    const role = legacyRoleToSeat(entry.role);
    if (usedSeats.get(currentSession._id)?.has(role)) {
      currentSession = await createSession(botId, guildId);
      usedSeats.set(currentSession._id, new Set());
    }
    usedSeats.get(currentSession._id)!.add(role);
    await dafScaleEntries.updateOne(
      { _id: entry._id },
      {
        $set: {
          aircraftNumber: currentSession.aircraftNumber,
          role,
          sessionId: currentSession._id,
          updatedAt: new Date()
        }
      }
    );
  }

  await recordDafScaleAudit(botId, guildId, {
    action: "migrate",
    metadata: { entries: legacyEntries.length },
    previousRole: null,
    role: null,
    userId: "system",
    username: "system"
  });
}

async function buildResult(botId: string, guildId: string, action: DafScaleActionResult["action"], entry: MongoDafScaleEntry | null, previousRole: MongoDafScaleRole | null) {
  const state = await getDafScaleState(botId, guildId);
  return {
    action,
    entry: entry ? entryDto(entry) : null,
    previousRole,
    settings: state.settings,
    state
  };
}

function normalizeSettingsPatch(patch: DafScaleSettingsPatch) {
  const normalized = { ...patch };
  if (Object.prototype.hasOwnProperty.call(normalized, "shooterRoleId") && !Object.prototype.hasOwnProperty.call(normalized, "gunnerRoleId")) {
    normalized.gunnerRoleId = normalized.shooterRoleId ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(normalized, "gunnerRoleId")) {
    normalized.shooterRoleId = normalized.gunnerRoleId ?? null;
  }
  return normalized;
}

function assertEnabled(settings: MongoDafScaleSettings) {
  if (!settings.enabled) throw serviceError("A Escala Aerea esta desativada.", 403);
}

function assertMemberAllowed(settings: MongoDafScaleSettings, role: MongoDafScaleRole | null, roleIds: string[]) {
  if (settings.participantRoleId && !roleIds.includes(settings.participantRoleId)) {
    throw serviceError("Voce nao tem o cargo necessario para participar da Escala Aerea.", 403);
  }
  if (role === "pilot" && settings.pilotRoleId && !roleIds.includes(settings.pilotRoleId)) {
    throw serviceError("Voce nao tem o cargo de Piloto para ocupar essa funcao.", 403);
  }
  if (role === "copilot" && settings.copilotRoleId && !roleIds.includes(settings.copilotRoleId)) {
    throw serviceError("Voce nao tem o cargo de Copiloto para ocupar essa funcao.", 403);
  }
  const gunnerRoleId = settings.gunnerRoleId ?? settings.shooterRoleId ?? null;
  if (role === "gunner" && gunnerRoleId && !roleIds.includes(gunnerRoleId)) {
    throw serviceError("Voce nao tem o cargo de Atirador para ocupar essa funcao.", 403);
  }
}

function settingsDto(settings: MongoDafScaleSettings) {
  const gunnerRoleId = settings.gunnerRoleId ?? settings.shooterRoleId ?? null;
  return {
    aircraftCapacity: AIRCRAFT_CAPACITY,
    id: settings._id,
    botId: settings.botId,
    configRoleId: settings.configRoleId ?? null,
    copilotRoleId: settings.copilotRoleId ?? null,
    createdAt: settings.createdAt.toISOString(),
    enabled: settings.enabled,
    guildId: settings.guildId,
    gunnerRoleId,
    logChannelId: settings.logChannelId ?? null,
    maxPilots: settings.maxPilots,
    maxShooters: settings.maxShooters,
    panelChannelId: settings.panelChannelId ?? null,
    panelMessageId: settings.panelMessageId ?? null,
    participantRoleId: settings.participantRoleId ?? null,
    pilotRoleId: settings.pilotRoleId ?? null,
    shooterRoleId: gunnerRoleId,
    updatedAt: settings.updatedAt.toISOString(),
    updatedBy: settings.updatedBy ?? null
  };
}

function sessionDto(session: MongoDafScaleSession, entries: MongoDafScaleEntry[]) {
  const occupants = entries.filter((entry) => entry.sessionId === session._id).map(entryDto).sort((left, right) => seatIndex(left.role) - seatIndex(right.role));
  return {
    aircraftNumber: session.aircraftNumber,
    availableSeats: Math.max(0, AIRCRAFT_CAPACITY - occupants.length),
    closedAt: session.closedAt?.toISOString() ?? null,
    closedBy: session.closedBy ?? null,
    closeReason: session.closeReason ?? null,
    createdAt: session.createdAt.toISOString(),
    id: session._id,
    occupants,
    status: session.status,
    title: session.title ?? null,
    updatedAt: session.updatedAt.toISOString()
  };
}

function entryDto(entry: MongoDafScaleEntry) {
  return {
    aircraftNumber: entry.aircraftNumber ?? 0,
    botId: entry.botId,
    guildId: entry.guildId,
    id: entry._id,
    joinedAt: entry.joinedAt.toISOString(),
    role: legacyRoleToSeat(entry.role),
    sessionId: entry.sessionId ?? null,
    updatedAt: entry.updatedAt.toISOString(),
    userId: entry.userId,
    username: entry.username
  };
}

function historyDto(history: MongoDafScaleHistory) {
  return {
    aircraftNumber: history.aircraftNumber,
    botId: history.botId,
    closedAt: history.closedAt.toISOString(),
    closedBy: history.closedBy ?? null,
    closeReason: history.closeReason ?? null,
    createdAt: history.createdAt.toISOString(),
    guildId: history.guildId,
    id: history._id,
    occupants: history.occupants.map((entry) => ({
      aircraftNumber: entry.aircraftNumber,
      joinedAt: entry.joinedAt.toISOString(),
      role: entry.role,
      userId: entry.userId,
      username: entry.username
    })),
    sessionId: history.sessionId,
    title: history.title ?? null
  };
}

function isSeatFree(entries: MongoDafScaleEntry[], sessionId: string, role: MongoDafScaleRole, currentEntryId: string | null) {
  return !entries.some((entry) => entry.sessionId === sessionId && entry.role === role && entry._id !== currentEntryId);
}

function legacyRoleToSeat(role: MongoDafScaleRole | "shooter"): MongoDafScaleRole {
  return role === "shooter" ? "gunner" : role;
}

function seatIndex(role: MongoDafScaleRole) {
  return SEAT_ORDER.indexOf(role);
}

function isDuplicateKeyError(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000;
}

function serviceError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

import { randomUUID } from "node:crypto";
import { ensureGuild, getMongoCollections, type MongoLogEntry } from "../database/mongo";

export type LogEntryDto = {
  id: string;
  guildId: string;
  userId?: string | null;
  type: string;
  message: string;
  metadata?: unknown;
  createdAt: string;
};

export type CreateLogInput = {
  guildId: string;
  userId?: string | null;
  type: string;
  message: string;
  metadata?: unknown;
};

const memoryLogs: LogEntryDto[] = [];

export async function createLog(input: CreateLogInput) {
  const log: LogEntryDto = {
    id: randomUUID(),
    guildId: input.guildId,
    userId: input.userId,
    type: input.type,
    message: input.message,
    metadata: input.metadata,
    createdAt: new Date().toISOString()
  };

  memoryLogs.unshift(log);

  try {
    await ensureGuild(input.guildId);

    const { logEntries } = await getMongoCollections();
    const doc: MongoLogEntry = {
      _id: randomUUID(),
      guildId: input.guildId,
      userId: input.userId ?? null,
      type: input.type,
      message: input.message,
      createdAt: new Date()
    };

    if (input.metadata !== undefined) {
      doc.metadata = input.metadata;
    }

    await logEntries.insertOne(doc);

    return {
      ...log,
      id: doc._id,
      userId: doc.userId,
      createdAt: doc.createdAt.toISOString()
    };
  } catch (error) {
    console.warn("[mongo] log mantido em memoria:", error instanceof Error ? error.message : error);
    return log;
  }
}

export async function listLogs(guildId?: string) {
  try {
    const { logEntries } = await getMongoCollections();
    const logs = await logEntries
      .find(guildId ? { guildId } : {})
      .sort({
        createdAt: -1
      })
      .limit(50)
      .toArray();

    return logs.map((log) => ({
      id: log._id,
      guildId: log.guildId,
      userId: log.userId,
      type: log.type,
      message: log.message,
      metadata: log.metadata,
      createdAt: log.createdAt.toISOString()
    }));
  } catch {
    return guildId ? memoryLogs.filter((log) => log.guildId === guildId) : memoryLogs.slice(0, 50);
  }
}

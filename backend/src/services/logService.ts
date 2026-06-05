import { randomUUID } from "node:crypto";
import { prisma } from "../database/prisma";

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
    await prisma.guild.upsert({
      where: {
        discordId: input.guildId
      },
      create: {
        discordId: input.guildId,
        name: `Guild ${input.guildId}`
      },
      update: {}
    });

    const saved = await prisma.logEntry.create({
      data: {
        guildId: input.guildId,
        userId: input.userId,
        type: input.type,
        message: input.message,
        metadata: input.metadata as object | undefined
      }
    });

    return {
      ...log,
      id: saved.id,
      createdAt: saved.createdAt.toISOString()
    };
  } catch (error) {
    console.warn("[prisma] log mantido em memoria:", error instanceof Error ? error.message : error);
    return log;
  }
}

export async function listLogs(guildId?: string) {
  try {
    const logs = await prisma.logEntry.findMany({
      where: guildId
        ? {
            guildId
          }
        : undefined,
      orderBy: {
        createdAt: "desc"
      },
      take: 50
    });

    return logs.map((log) => ({
      id: log.id,
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

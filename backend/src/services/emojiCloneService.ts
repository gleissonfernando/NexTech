import { randomUUID } from "node:crypto";
import { ensureGuild, getMongoCollections, type MongoEmojiCloneItem, type MongoEmojiCloneJob } from "../database/mongo";
import { createLog } from "./logService";

export type RecordEmojiCloneJobInput = {
  botId?: string | null;
  guildId: string;
  userId: string;
  sourceGuildId?: string | null;
  status: MongoEmojiCloneJob["status"];
  total: number;
  success: number;
  failed: number;
  prefix?: string | null;
  createdAt?: string | null;
  finishedAt?: string | null;
  items: Array<{
    originalEmojiId: string;
    originalName: string;
    newEmojiId?: string | null;
    newName?: string | null;
    animated: boolean;
    status: MongoEmojiCloneItem["status"];
    errorReason?: string | null;
  }>;
};

export async function recordEmojiCloneJob(input: RecordEmojiCloneJobInput) {
  const now = new Date();
  const job: MongoEmojiCloneJob = {
    _id: randomUUID(),
    botId: normalizeBotId(input.botId),
    guildId: input.guildId,
    userId: input.userId,
    sourceGuildId: normalizeBotId(input.sourceGuildId),
    status: input.status,
    total: input.total,
    success: input.success,
    failed: input.failed,
    prefix: input.prefix?.trim() || null,
    createdAt: input.createdAt ? new Date(input.createdAt) : now,
    finishedAt: input.finishedAt ? new Date(input.finishedAt) : now
  };
  const items: MongoEmojiCloneItem[] = input.items.map((item) => ({
    _id: randomUUID(),
    jobId: job._id,
    originalEmojiId: item.originalEmojiId,
    originalName: item.originalName,
    newEmojiId: item.newEmojiId ?? null,
    newName: item.newName ?? null,
    animated: item.animated,
    status: item.status,
    errorReason: item.errorReason ?? null
  }));

  await ensureGuild(job.guildId);
  const { emojiCloneItems, emojiCloneJobs } = await getMongoCollections();
  await emojiCloneJobs.insertOne(job);
  if (items.length) {
    await emojiCloneItems.insertMany(items);
  }

  await createLog({
    botId: job.botId,
    guildId: job.guildId,
    userId: job.userId,
    type: "emoji_clone.completed",
    message: `Clonagem de emojis finalizada: ${job.success}/${job.total} com sucesso.`,
    metadata: {
      failed: job.failed,
      jobId: job._id,
      prefix: job.prefix,
      sourceGuildId: job.sourceGuildId,
      total: job.total
    }
  }).catch(() => undefined);

  return {
    ...job,
    id: job._id,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
    items: items.map((item) => ({ ...item, id: item._id }))
  };
}

function normalizeBotId(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

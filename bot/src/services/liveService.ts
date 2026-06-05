import { ActivityType, type Presence } from "discord.js";
import type { BotContext } from "../types";

export async function handlePresenceUpdate(context: BotContext, oldPresence: Presence | null, newPresence: Presence) {
  const guildId = newPresence.guild?.id ?? oldPresence?.guild?.id;
  const userId = newPresence.userId;

  if (!guildId || !userId) {
    return;
  }

  const key = `${guildId}:${userId}`;
  const streaming = newPresence.activities.find((activity) => activity.type === ActivityType.Streaming);
  const wasStreaming = context.liveCache.has(key);

  if (streaming && !wasStreaming) {
    context.liveCache.add(key);

    const payload = {
      guildId,
      streamer: newPresence.user?.tag ?? userId,
      title: streaming.name,
      url: streaming.url ?? undefined
    };

    await context.api.notifyLive({
      ...payload,
      type: "started"
    });

    context.socket.emitLiveStarted(payload);
    return;
  }

  if (!streaming && wasStreaming) {
    context.liveCache.delete(key);

    const payload = {
      guildId,
      streamer: newPresence.user?.tag ?? userId
    };

    await context.api.notifyLive({
      ...payload,
      type: "ended"
    });

    context.socket.emitLiveEnded(payload);
  }
}

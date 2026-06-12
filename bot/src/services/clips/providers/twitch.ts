import { getTwitchClips, getTwitchStream } from "../../twitchApiService";
import type { ClipsConfig } from "../../apiClient";
import type { ClipProvider } from "./types";

export function createTwitchClipProvider(): ClipProvider {
  return {
    platform: "twitch",
    supportsClipCapture: true,
    async getLiveSession(config: ClipsConfig) {
      const stream = config.twitchChannelName ? await getTwitchStream(config.twitchChannelName) : null;

      return {
        isLive: Boolean(stream),
        streamId: stream?.id ?? null,
        startedAt: stream?.startedAt ?? null,
        title: stream?.title ?? null,
        thumbnailUrl: stream?.thumbnailUrl ?? null
      };
    },
    async listClips(config: ClipsConfig, input) {
      if (!config.twitchBroadcasterId) {
        return [];
      }

      const clips = await getTwitchClips({
        broadcasterId: config.twitchBroadcasterId,
        endedAt: input.endedAt,
        first: input.first,
        startedAt: input.startedAt
      });

      return clips.map((clip) => ({
        id: clip.id,
        url: clip.url,
        broadcasterId: clip.broadcasterId,
        broadcasterName: clip.broadcasterName,
        creatorName: clip.creatorName,
        title: clip.title,
        thumbnailUrl: clip.thumbnailUrl,
        durationSeconds: null,
        createdAt: clip.createdAt
      }));
    }
  };
}

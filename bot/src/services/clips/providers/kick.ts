import { getKickLivestreamsByUserIds } from "../../kickApiService";
import type { ClipsConfig } from "../../apiClient";
import type { ClipProvider } from "./types";

export function createKickClipProvider(): ClipProvider {
  return {
    platform: "kick",
    supportsClipCapture: false,
    async getLiveSession(config: ClipsConfig) {
      if (!config.kickUserId) {
        return emptySession();
      }

      const streams = await getKickLivestreamsByUserIds([config.kickUserId]);
      const stream = streams.get(config.kickUserId) ?? null;

      if (!stream) {
        return emptySession();
      }

      return {
        isLive: true,
        streamId: stream.id,
        startedAt: stream.startedAt,
        title: stream.title,
        thumbnailUrl: stream.thumbnailUrl
      };
    },
    async listClips() {
      return [];
    }
  };
}

function emptySession() {
  return {
    isLive: false,
    streamId: null,
    startedAt: null,
    title: null,
    thumbnailUrl: null
  };
}

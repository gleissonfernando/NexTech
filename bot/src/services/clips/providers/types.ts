import type { ClipsConfig } from "../../apiClient";

export type ProviderClip = {
  id: string;
  url: string;
  broadcasterId: string;
  broadcasterName: string;
  creatorName: string;
  title: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  createdAt: string;
};

export type ProviderLiveSession = {
  isLive: boolean;
  streamId: string | null;
  startedAt: string | null;
  title: string | null;
  thumbnailUrl: string | null;
};

export type ClipProvider = {
  platform: ClipsConfig["platform"];
  supportsClipCapture: boolean;
  getLiveSession: (config: ClipsConfig) => Promise<ProviderLiveSession>;
  listClips: (config: ClipsConfig, input: {
    endedAt: string;
    first: number;
    startedAt: string;
  }) => Promise<ProviderClip[]>;
};

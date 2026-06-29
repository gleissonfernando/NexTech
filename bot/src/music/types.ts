import type { Player } from "shoukaku";
import type { Guild, GuildMember, GuildTextBasedChannel, Message } from "discord.js";

export type MusicLoopMode = "off" | "track" | "queue";

export type MusicTrack = {
  id: string;
  title: string;
  author: string;
  durationMs: number;
  url: string;
  thumbnail: string | null;
  requestedById: string;
  requestedByTag: string;
  addedAt: Date;
  source: "link" | "search" | "artist" | "playlist" | "spotify" | "soundcloud" | "direct";
  provider: "youtube" | "soundcloud" | "direct";
  encoded: string;
};

export type MusicConfig = {
  enabled: boolean;
  commandChannelId: string | null;
  allowedChannelIds: string[];
  blockedChannelIds: string[];
  djRoleId: string | null;
  permissionMode: "everyone" | "roles" | "administrators";
  allowedRoleIds: string[];
  blockedUserIds: string[];
  defaultVolume: number;
  queueLimit: number;
  playlistLimit: number;
  artistLimit: number;
  cooldownSeconds: number;
  maxTrackMinutes: number;
  idleDisconnectSeconds: number;
  allowPlaylists: boolean;
  allowLinks: boolean;
  allowArtistSearch: boolean;
  logChannelId: string | null;
};

export type MusicSession = {
  guild: Guild;
  config: MusicConfig;
  voiceChannelId: string;
  textChannel: GuildTextBasedChannel;
  player: Player;
  current: MusicTrack | null;
  queue: MusicTrack[];
  history: MusicTrack[];
  loopMode: MusicLoopMode;
  shuffled: boolean;
  volume: number;
  logChannelId: string | null;
  panelMessage: Message | null;
  idleTimer: NodeJS.Timeout | null;
  aloneTimer: NodeJS.Timeout | null;
  playbackTimer: NodeJS.Timeout | null;
  trackEndTimer: NodeJS.Timeout | null;
  idleDisconnectMs: number;
  stopping: boolean;
  recovering: boolean;
  suppressedEndTrack: string | null;
};

export type MusicActor = {
  id: string;
  tag: string;
  member: GuildMember;
};

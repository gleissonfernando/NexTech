import axios, { type AxiosInstance } from "axios";
import { env } from "../config/env";
import type { GuildSettings } from "../types";

export type CreateLogInput = {
  botId?: string | null;
  guildId: string;
  userId?: string | null;
  type: string;
  message: string;
  metadata?: unknown;
};

export type LiveEventInput = {
  botId?: string | null;
  guildId: string;
  type: "started" | "ended";
  streamer: string;
  title?: string;
  url?: string;
};

export type SocialNotification = {
  id: string;
  botId: string | null;
  guildId: string;
  userId: string;
  platform: "twitch";
  twitchChannelName: string;
  twitchChannelUrl: string;
  twitchUserId?: string | null;
  twitchAvatar?: string | null;
  discordChannelId: string;
  mentionRoleId?: string | null;
  customMessage?: string | null;
  embedColor?: string | null;
  enabled: boolean;
  isLive: boolean;
  lastLiveAt?: string | null;
  lastStreamId?: string | null;
  lastMessageId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ClipMentionType = "none" | "everyone" | "role";

export type ClipsConfig = {
  id: string;
  guildId: string;
  botId: string | null;
  twitchChannelName: string;
  twitchBroadcasterId: string;
  twitchDisplayName: string | null;
  twitchAvatar: string | null;
  discordChannelId: string | null;
  enabled: boolean;
  allowedRoleIds: string[];
  mentionType: ClipMentionType;
  mentionRoleId: string | null;
  embedColor: string;
  customMessage: string | null;
  checkInterval: number;
  lastCheckAt: string | null;
  totalSent: number;
  createdAt: string;
  updatedAt: string;
};

export class ApiClient {
  private readonly http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: env.BACKEND_API_URL,
      headers: {
        "x-bot-token": env.BOT_API_TOKEN,
        ...(env.DASHBOARD_BOT_ID ? { "x-dashboard-bot-id": env.DASHBOARD_BOT_ID } : {})
      },
      timeout: 8000
    });

    this.http.interceptors.request.use((config) => {
      if (!env.BACKEND_API_URL) {
        throw new Error("BACKEND_API_URL nao configurado.");
      }

      return config;
    });
  }

  setDiscordClientId(clientId: string) {
    this.http.defaults.headers.common["x-discord-bot-client-id"] = clientId;
  }

  async postLog(input: CreateLogInput) {
    const { data } = await this.http.post("/logs", input);
    return data;
  }

  async notifyLive(input: LiveEventInput) {
    const { data } = await this.http.post("/lives/events", input);
    return data;
  }

  async createTicket(input: { guildId: string; channelId?: string | null; openerId: string; subject: string }) {
    const { data } = await this.http.post("/tickets", input);
    return data;
  }

  async getSettings(guildId: string, discordBotClientId?: string | null) {
    const { data } = await this.http.get<{ settings: GuildSettings }>(`/settings/${guildId}`, {
      headers: discordBotClientId
        ? {
            "x-discord-bot-client-id": discordBotClientId
          }
        : undefined
    });
    return data.settings;
  }

  async getActiveTwitchNotifications() {
    const { data } = await this.http.get<{ notifications: SocialNotification[] }>("/social-notifications/bot/twitch-active");
    return data.notifications;
  }

  async updateTwitchNotificationState(id: string, input: { isLive?: boolean; lastLiveAt?: string | null; lastStreamId?: string | null; lastMessageId?: string | null; twitchAvatar?: string | null }) {
    const { data } = await this.http.patch<{ notification: SocialNotification }>(`/social-notifications/bot/twitch/${id}/state`, input);
    return data.notification;
  }

  async getActiveClipConfigs() {
    const { data } = await this.http.get<{ configs: ClipsConfig[] }>("/clips/bot/configs");
    return data.configs;
  }

  async isClipSent(configId: string, clipId: string) {
    const { data } = await this.http.get<{ sent: boolean }>(`/clips/bot/configs/${configId}/sent/${encodeURIComponent(clipId)}`);
    return data.sent;
  }

  async updateClipConfigCheck(configId: string, lastCheckAt = new Date().toISOString()) {
    await this.http.patch<{ ok: boolean }>(`/clips/bot/configs/${configId}/check`, {
      lastCheckAt
    });
  }

  async recordClipSent(configId: string, input: {
    clipId: string;
    clipTitle: string;
    clipUrl: string;
    clipThumbnail?: string | null;
    clipCreatorName?: string | null;
    createdAtTwitch: string;
    discordChannelId?: string | null;
    discordMessageId?: string | null;
  }) {
    const { data } = await this.http.post(`/clips/bot/configs/${configId}/sent`, input);
    return data;
  }
}

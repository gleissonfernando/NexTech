import axios, { type AxiosInstance } from "axios";
import { env } from "../config/env";
import type { GuildSettings } from "../types";

export type CreateLogInput = {
  guildId: string;
  userId?: string | null;
  type: string;
  message: string;
  metadata?: unknown;
};

export type LiveEventInput = {
  guildId: string;
  type: "started" | "ended";
  streamer: string;
  title?: string;
  url?: string;
};

export type SocialNotification = {
  id: string;
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
  enabled: boolean;
  isLive: boolean;
  lastStreamId?: string | null;
  lastMessageId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export class ApiClient {
  private readonly http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: env.BACKEND_API_URL,
      headers: {
        "x-bot-token": env.BOT_API_TOKEN
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

  async getSettings(guildId: string) {
    const { data } = await this.http.get<{ settings: GuildSettings }>(`/settings/${guildId}`);
    return data.settings;
  }

  async getActiveTwitchNotifications() {
    const { data } = await this.http.get<{ notifications: SocialNotification[] }>("/social-notifications/bot/twitch-active");
    return data.notifications;
  }

  async updateTwitchNotificationState(id: string, input: { isLive?: boolean; lastStreamId?: string | null; lastMessageId?: string | null; twitchAvatar?: string | null }) {
    const { data } = await this.http.patch<{ notification: SocialNotification }>(`/social-notifications/bot/twitch/${id}/state`, input);
    return data.notification;
  }
}

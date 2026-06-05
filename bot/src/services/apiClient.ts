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
}

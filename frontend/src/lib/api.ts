import axios from "axios";
import type { AuthResponse, GuildSettings, LiveEvent, LogEntry, Ticket } from "../types";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true
});

export async function getSession() {
  const { data } = await api.get<AuthResponse>("/auth/me");
  return data;
}

export async function loginDev() {
  const { data } = await api.post<AuthResponse>("/auth/dev");
  return data;
}

export async function logout() {
  await api.post("/auth/logout");
}

export async function getGuildSettings(guildId: string) {
  const { data } = await api.get<{ settings: GuildSettings }>(`/settings/${guildId}`);
  return data.settings;
}

export async function patchGuildSettings(guildId: string, payload: Partial<GuildSettings>) {
  const { data } = await api.patch<{ settings: GuildSettings }>(`/settings/${guildId}`, payload);
  return data.settings;
}

export async function getLogs(guildId?: string) {
  const { data } = await api.get<{ logs: LogEntry[] }>("/logs", {
    params: {
      guildId
    }
  });
  return data.logs;
}

export async function getLives(guildId?: string) {
  const { data } = await api.get<{ lives: LiveEvent[] }>("/lives", {
    params: {
      guildId
    }
  });
  return data.lives;
}

export async function getTickets(guildId?: string) {
  const { data } = await api.get<{ tickets: Ticket[] }>("/tickets", {
    params: {
      guildId
    }
  });
  return data.tickets;
}

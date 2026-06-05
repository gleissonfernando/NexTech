import type { Client } from "discord.js";
import { io, type Socket } from "socket.io-client";
import { env } from "../config/env";

export class BotSocketClient {
  private socket: Socket | null = null;

  connect(client: Client) {
    if (!env.BACKEND_SOCKET_URL) {
      console.warn("[socket] BACKEND_SOCKET_URL nao configurado; conexao em tempo real desativada.");
      return;
    }

    if (!env.BOT_API_TOKEN) {
      console.warn("[socket] BOT_API_TOKEN nao configurado; eventos em tempo real do bot serao ignorados pelo backend.");
    }

    this.socket?.disconnect();
    this.socket = io(env.BACKEND_SOCKET_URL, {
      auth: {
        token: env.BOT_API_TOKEN
      },
      reconnection: true,
      reconnectionDelay: 1000,
      timeout: 10000,
      transports: ["websocket", "polling"]
    });

    this.socket.on("connect", () => {
      console.log(`[socket] conectado ao backend em ${env.BACKEND_SOCKET_URL}`);
      this.emitStatus(client, true);
    });

    this.socket.on("connect_error", (error) => {
      console.warn("[socket] falha ao conectar no backend:", error.message);
    });

    this.socket.on("disconnect", (reason) => {
      console.warn(`[socket] desconectado do backend: ${reason}`);
    });
  }

  emitStatus(client: Client, online = true) {
    const users = client.guilds.cache.reduce((total, guild) => total + (guild.memberCount ?? 0), 0);

    this.socket?.emit("bot:status", {
      online,
      latency: Math.max(0, Math.round(client.ws.ping)),
      guilds: client.guilds.cache.size,
      users
    });
  }

  emitLog(payload: { guildId: string; type: string; message: string; userId?: string | null; metadata?: unknown }) {
    this.socket?.emit("bot:log", payload);
  }

  emitLiveStarted(payload: { guildId: string; streamer: string; title?: string; url?: string }) {
    this.socket?.emit("live:started", payload);
  }

  emitLiveEnded(payload: { guildId: string; streamer: string; title?: string; url?: string }) {
    this.socket?.emit("live:ended", payload);
  }

  disconnect(client: Client) {
    this.emitStatus(client, false);
    this.socket?.disconnect();
  }
}

import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { env } from "../config/env";
import { createLiveEvent } from "../services/liveService";
import { createLog } from "../services/logService";
import { getBotStatus, updateBotStatus } from "../services/statsService";
import {
  authorizeBotRuntimeModule,
  findDevBotIdByClientId,
  runtimeModuleIdForLogType,
  syncDevBotGuilds,
  syncDevBotProfile,
  updateDevBotRuntimeStatus
} from "../services/devBotService";
import { botRealtimeRoom, devBotRealtimeRoom, setRealtimeServer } from "./events";

const BOT_SOCKET_OFFLINE_GRACE_MS = 45_000;
const RECENT_BOT_OFFLINE_SIGNAL_MS = 60_000;
const pendingBotDisconnects = new Map<string, NodeJS.Timeout>();
const recentBotOfflineSignals = new Map<string, number>();

export function createSocketServer(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: env.FRONTEND_URL || true,
      credentials: true
    }
  });

  setRealtimeServer(io);

  io.on("connection", async (socket) => {
    const token = socket.handshake.auth?.token;
    const configuredBotId = typeof socket.handshake.auth?.botId === "string" && socket.handshake.auth.botId.trim()
      ? socket.handshake.auth.botId.trim()
      : null;
    const clientId = typeof socket.handshake.auth?.clientId === "string" && socket.handshake.auth.clientId.trim()
      ? socket.handshake.auth.clientId.trim()
      : null;
    const isBot = Boolean(env.BOT_API_TOKEN && token === env.BOT_API_TOKEN);
    const botId = configuredBotId
      ?? (isBot && clientId ? await findDevBotIdByClientId(clientId).catch(() => null) : null);

    socket.data.isBot = isBot;
    socket.data.botId = botId;
    if (isBot) {
      await socket.join(botRealtimeRoom());
    }
    if (botId) {
      clearPendingBotDisconnect(botId);
      await socket.join(devBotRealtimeRoom(botId));
    }
    socket.emit("bot:status", getBotStatus());

    socket.on("disconnect", () => {
      if (!socket.data.isBot) {
        return;
      }

      if (socket.data.botId) {
        if (hasRecentBotOfflineSignal(socket.data.botId)) {
          return;
        }

        scheduleBotDisconnectOffline(io, socket.data.botId);
      }
    });

    socket.on("bot:status", (payload: Parameters<typeof updateBotStatus>[0]) => {
      if (!socket.data.isBot) {
        return;
      }

      const statusBotId = socket.data.botId
        ?? (typeof payload.botId === "string" && payload.botId.trim() ? payload.botId.trim() : null);

      if (statusBotId) {
        if (payload.online === false) {
          noteBotOfflineSignal(statusBotId);
        } else {
          recentBotOfflineSignals.delete(statusBotId);
          clearPendingBotDisconnect(statusBotId);
        }

        void syncDevBotProfile(statusBotId, payload.botProfile);

        if (payload.botGuilds) {
          void syncDevBotGuilds(
            statusBotId,
            payload.botGuilds.map((guild) => ({
              id: guild.id,
              name: guild.name
            }))
          );
        }

        void updateDevBotRuntimeStatus(
          statusBotId,
          payload.online === false ? "offline" : "online",
          payload.online === false ? "Bot offline." : "Bot conectado ao Discord."
        );
      }

      io.emit("bot:status", updateBotStatus(payload));
    });

    socket.on("bot:log", async (payload: { botId?: string | null; guildId: string; type: string; message: string; userId?: string; metadata?: unknown }) => {
      if (!socket.data.isBot) {
        return;
      }

      const botId = socket.data.botId ?? payload.botId ?? null;
      const moduleId = runtimeModuleIdForLogType(payload.type);

      if (moduleId) {
        const authorization = await authorizeBotRuntimeModule({
          botId,
          guildId: payload.guildId,
          moduleId
        }).catch(() => null);

        if (!authorization?.allowed) {
          return;
        }
      }

      const log = await createLog({
        ...payload,
        botId
      });
      io.emit("logs:new", log);
    });

    socket.on("live:started", async (payload: { botId?: string | null; guildId: string; streamer: string; title?: string; url?: string }) => {
      if (!socket.data.isBot) {
        return;
      }

      const eventBotId = socket.data.botId ?? payload.botId ?? null;
      const event = createLiveEvent({
        ...payload,
        botId: eventBotId,
        type: "started"
      });
      const log = await createLog({
        botId: eventBotId,
        guildId: payload.guildId,
        type: "live:started",
        message: `${payload.streamer} iniciou uma live.`,
        metadata: {
          ...payload,
          type: "started"
        }
      });

      io.emit("logs:new", log);
      io.emit("live:started", event);
    });

    socket.on("live:ended", async (payload: { botId?: string | null; guildId: string; streamer: string; title?: string; url?: string }) => {
      if (!socket.data.isBot) {
        return;
      }

      const eventBotId = socket.data.botId ?? payload.botId ?? null;
      const event = createLiveEvent({
        ...payload,
        botId: eventBotId,
        type: "ended"
      });
      const log = await createLog({
        botId: eventBotId,
        guildId: payload.guildId,
        type: "live:ended",
        message: `${payload.streamer} encerrou uma live.`,
        metadata: {
          ...payload,
          type: "ended"
        }
      });

      io.emit("logs:new", log);
      io.emit("live:ended", event);
    });
  });

  return io;
}

function scheduleBotDisconnectOffline(io: Server, botId: string) {
  clearPendingBotDisconnect(botId);

  const timer = setTimeout(() => {
    pendingBotDisconnects.delete(botId);
    void updateDevBotRuntimeStatus(botId, "offline", "Bot sem conexao realtime com o backend.");

    if ((getBotStatus().botId ?? null) === botId) {
      io.emit("bot:status", updateBotStatus({
        botId,
        online: false
      }));
    }
  }, BOT_SOCKET_OFFLINE_GRACE_MS);

  timer.unref();
  pendingBotDisconnects.set(botId, timer);
}

function clearPendingBotDisconnect(botId: string) {
  const timer = pendingBotDisconnects.get(botId);

  if (!timer) {
    return;
  }

  clearTimeout(timer);
  pendingBotDisconnects.delete(botId);
}

function noteBotOfflineSignal(botId: string) {
  recentBotOfflineSignals.set(botId, Date.now());
  clearPendingBotDisconnect(botId);
}

function hasRecentBotOfflineSignal(botId: string) {
  const signaledAt = recentBotOfflineSignals.get(botId);

  if (!signaledAt) {
    return false;
  }

  if (Date.now() - signaledAt <= RECENT_BOT_OFFLINE_SIGNAL_MS) {
    return true;
  }

  recentBotOfflineSignals.delete(botId);
  return false;
}

import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { env } from "../config/env";
import { createLiveEvent } from "../services/liveService";
import { createLog } from "../services/logService";
import { getBotStatus, updateBotStatus } from "../services/statsService";
import { setRealtimeServer } from "./events";

export function createSocketServer(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: env.FRONTEND_URL || true,
      credentials: true
    }
  });

  setRealtimeServer(io);

  io.on("connection", (socket) => {
    const token = socket.handshake.auth?.token;
    const isBot = Boolean(env.BOT_API_TOKEN && token === env.BOT_API_TOKEN);

    socket.data.isBot = isBot;
    socket.emit("bot:status", getBotStatus());

    socket.on("disconnect", () => {
      if (!socket.data.isBot) {
        return;
      }

      io.emit("bot:status", updateBotStatus({ online: false }));
    });

    socket.on("bot:status", (payload: Parameters<typeof updateBotStatus>[0]) => {
      if (!socket.data.isBot) {
        return;
      }

      io.emit("bot:status", updateBotStatus(payload));
    });

    socket.on("bot:log", async (payload: { guildId: string; type: string; message: string; userId?: string; metadata?: unknown }) => {
      if (!socket.data.isBot) {
        return;
      }

      const log = await createLog(payload);
      io.emit("logs:new", log);
    });

    socket.on("live:started", async (payload: { guildId: string; streamer: string; title?: string; url?: string }) => {
      if (!socket.data.isBot) {
        return;
      }

      const event = createLiveEvent({
        ...payload,
        type: "started"
      });
      const log = await createLog({
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

    socket.on("live:ended", async (payload: { guildId: string; streamer: string; title?: string; url?: string }) => {
      if (!socket.data.isBot) {
        return;
      }

      const event = createLiveEvent({
        ...payload,
        type: "ended"
      });
      const log = await createLog({
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

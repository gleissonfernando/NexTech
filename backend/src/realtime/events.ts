import type { Server } from "socket.io";

let io: Server | null = null;

export function botRealtimeRoom() {
  return "bot-runtime";
}

export function devBotRealtimeRoom(botId: string) {
  return `dev-bot:${botId}`;
}

export function dashboardLogRealtimeRoom(guildId: string, botId: string) {
  const normalizedBotId = botId.trim();
  if (!normalizedBotId) {
    throw new Error("botId obrigatorio para room de logs.");
  }

  return `dashboard-logs:${normalizedBotId}:${guildId}`;
}

export function setRealtimeServer(server: Server) {
  io = server;
}

export function emitRealtime<TPayload>(event: string, payload: TPayload) {
  if (event === "logs:new") {
    if (isDashboardLogPayload(payload)) {
      io?.to(dashboardLogRealtimeRoom(payload.guildId, payload.botId)).emit(event, payload);
    } else {
      console.warn("[socket] log sem escopo de servidor foi descartado.");
    }

    return;
  }

  io?.emit(event, payload);
}

export function emitRealtimeToRoom<TPayload>(room: string, event: string, payload: TPayload) {
  io?.to(room).emit(event, payload);
}

export async function emitRealtimeToRoomWithAck<TPayload, TResponse>(
  room: string,
  event: string,
  payload: TPayload,
  timeoutMs = 30_000
) {
  if (!io) {
    return [] as TResponse[];
  }

  return (io.to(room).timeout(timeoutMs).emitWithAck(event, payload) as Promise<TResponse[]>)
    .catch(() => [] as TResponse[]);
}

function isDashboardLogPayload(payload: unknown): payload is { botId: string; guildId: string } {
  return Boolean(
    payload
    && typeof payload === "object"
    && "guildId" in payload
    && typeof payload.guildId === "string"
    && payload.guildId.trim()
    && "botId" in payload
    && typeof payload.botId === "string"
    && payload.botId.trim()
  );
}

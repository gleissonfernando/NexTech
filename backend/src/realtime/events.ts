import type { Server } from "socket.io";

let io: Server | null = null;

export function botRealtimeRoom() {
  return "bot-runtime";
}

export function devBotRealtimeRoom(botId: string) {
  return `dev-bot:${botId}`;
}

export function dashboardLogRealtimeRoom(guildId: string, botId?: string | null) {
  return `dashboard-logs:${botId?.trim() || "default"}:${guildId}`;
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

function isDashboardLogPayload(payload: unknown): payload is { botId?: string | null; guildId: string } {
  return Boolean(
    payload
    && typeof payload === "object"
    && "guildId" in payload
    && typeof payload.guildId === "string"
    && payload.guildId.trim()
  );
}

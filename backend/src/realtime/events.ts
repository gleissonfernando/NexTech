import type { Server } from "socket.io";

let io: Server | null = null;

export function botRealtimeRoom() {
  return "bot-runtime";
}

export function devBotRealtimeRoom(botId: string) {
  return `dev-bot:${botId}`;
}

export function setRealtimeServer(server: Server) {
  io = server;
}

export function emitRealtime<TPayload>(event: string, payload: TPayload) {
  io?.emit(event, payload);
}

export function emitRealtimeToRoom<TPayload>(room: string, event: string, payload: TPayload) {
  io?.to(room).emit(event, payload);
}

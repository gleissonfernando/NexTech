import type { Server } from "socket.io";

let io: Server | null = null;

export function setRealtimeServer(server: Server) {
  io = server;
}

export function emitRealtime<TPayload>(event: string, payload: TPayload) {
  io?.emit(event, payload);
}

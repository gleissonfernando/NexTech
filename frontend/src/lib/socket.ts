import { io } from "socket.io-client";
import { publicOrigin } from "./urls";

export const SOCKET_URL = publicOrigin();

export function createDashboardSocket() {
  return io(SOCKET_URL, {
    withCredentials: true,
    transports: ["websocket", "polling"]
  });
}

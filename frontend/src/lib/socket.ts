import { io } from "socket.io-client";
import { readTabVerification } from "./api";
import { publicOrigin } from "./urls";

export const SOCKET_URL = publicOrigin();

export function createDashboardSocket() {
  return io(SOCKET_URL, {
    auth: {
      verificationToken: readTabVerification()
    },
    withCredentials: true,
    transports: ["websocket", "polling"]
  });
}

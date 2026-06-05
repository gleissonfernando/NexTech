import { createServer } from "node:http";
import { app } from "./app";
import { env } from "./config/env";
import { createSocketServer } from "./realtime/socket";

const httpServer = createServer(app);

createSocketServer(httpServer);

httpServer.listen(env.PORT, env.HOST, () => {
  const publicUrl = env.NODE_ENV === "production" ? env.FRONTEND_URL : `http://localhost:${env.PORT}`;
  console.log(`[api] rodando em ${publicUrl} (${env.HOST}:${env.PORT})`);
});

function shutdown(signal: string) {
  console.log(`[api] encerrando por ${signal}`);
  httpServer.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

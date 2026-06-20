import "./types/session";
import fs from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import { errorHandler } from "./middleware/errorHandler";
import { sessionMiddleware } from "./middleware/session";
import { apiRouter } from "./routes";
import { authRouter } from "./routes/auth";
import { kickWebhookPublicRouter } from "./routes/kickNotifications";

export const app = express();
const frontendDistPath = path.resolve(__dirname, "../../frontend/dist");
const uploadsPath = path.resolve(__dirname, "../uploads");
const corsOrigin = env.FRONTEND_URL || true;

if (env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "img-src": [
          "'self'",
          "data:",
          "blob:",
          "https://cdn.discordapp.com",
          "https://media.discordapp.net",
          "https://images-ext-1.discordapp.net",
          "https://images-ext-2.discordapp.net",
          "https://static-cdn.jtvnw.net",
          "https://kick.com",
          "https://files.kick.com",
          "https://img.kick.com",
          "https://cdn.kick.com"
        ]
      }
    },
    crossOriginResourcePolicy: {
      policy: "cross-origin"
    }
  })
);
app.use(
  cors({
    origin: corsOrigin,
    credentials: true
  })
);
app.use(cookieParser());
app.use(express.json({
  limit: "1mb",
  verify: (req, _res, buf) => {
    (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
  }
}));
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));
app.use("/uploads", express.static(uploadsPath));

app.use("/auth", authRouter);
app.use("/webhooks", kickWebhookPublicRouter);
app.get(["/health", "/_shardcloud/health"], (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString()
  });
});
app.use("/api", apiRouter);

if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(frontendDistPath, "index.html"));
  });
} else {
  app.get("/", (_req, res) => {
    res.json({
      name: "Painel de OrviteK Bots API",
      status: "online"
    });
  });
}

app.use(errorHandler);

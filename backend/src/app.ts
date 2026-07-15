import "./types/session";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import { errorHandler } from "./middleware/errorHandler";
import { maintenanceMiddleware } from "./middleware/maintenance";
import { rateLimitMiddleware } from "./middleware/rateLimit";
import { requestMetricsMiddleware } from "./middleware/requestMetrics";
import { sessionMiddleware } from "./middleware/session";
import { apiRouter } from "./routes";
import { authRouter } from "./routes/auth";
import { healthRouter } from "./routes/health";
import { kickWebhookPublicRouter } from "./routes/kickNotifications";
import { publicTranscriptsRouter } from "./routes/transcripts";

export const app = express();
const frontendDistPath = path.resolve(__dirname, "../../frontend/dist");
const frontendIndexPath = path.join(frontendDistPath, "index.html");
const uploadsPath = path.resolve(__dirname, "../uploads");
const corsOrigin = env.APP_BASE_URL;

ensureFrontendBuild();

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
    credentials: true,
    exposedHeaders: ["Content-Disposition", "Content-Length", "X-Emoji-Count", "X-Emoji-Failed", "X-Emoji-Total"]
  })
);
app.use(cookieParser());
app.use(express.json({
  limit: "10mb",
  verify: (req, _res, buf) => {
    (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
  }
}));
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev", {
  skip: (req) => req.path.startsWith("/health")
}));
app.use(requestMetricsMiddleware);
app.use(rateLimitMiddleware);
app.use("/uploads", express.static(uploadsPath));

app.use("/health", healthRouter);
app.use("/auth", authRouter);
app.use(maintenanceMiddleware);
app.use("/webhooks", kickWebhookPublicRouter);
app.use("/transcripts", publicTranscriptsRouter);
app.use("/api", apiRouter);

if (fs.existsSync(frontendIndexPath)) {
  app.use(express.static(frontendDistPath));
  app.get("*", (_req, res) => {
    res.sendFile(frontendIndexPath);
  });
} else {
  app.get("*", (_req, res) => {
    res.json({
      message: "Frontend build ausente. Execute npm run build antes de servir o painel.",
      name: "Painel de NexTech Systems Bots API",
      status: "online"
    });
  });
}

app.use(errorHandler);

function ensureFrontendBuild() {
  if (env.NODE_ENV !== "production" || fs.existsSync(frontendIndexPath)) {
    return;
  }

  const frontendPackagePath = path.resolve(__dirname, "../../frontend/package.json");

  if (!fs.existsSync(frontendPackagePath)) {
    console.warn("[frontend] build ausente e fontes do frontend nao foram encontradas.");
    return;
  }

  console.warn("[frontend] build ausente; gerando frontend/dist antes de iniciar rotas.");
  const result = spawnSync("npm", ["--prefix", "frontend", "run", "build"], {
    env: process.env,
    shell: process.platform === "win32",
    stdio: "inherit"
  });

  if (result.status !== 0 || !fs.existsSync(frontendIndexPath)) {
    console.error("[frontend] nao foi possivel gerar frontend/dist/index.html.");
  }
}

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

export const app = express();
const frontendDistPath = path.resolve(__dirname, "../../frontend/dist");
const corsOrigin = env.FRONTEND_URL || true;

if (env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.use(
  helmet({
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
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

app.use("/auth", authRouter);
app.use("/api", apiRouter);

if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(frontendDistPath, "index.html"));
  });
} else {
  app.get("/", (_req, res) => {
    res.json({
      name: "Discord Dashboard API",
      status: "online"
    });
  });
}

app.use(errorHandler);

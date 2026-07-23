import type { NextFunction, Request, Response } from "express";
import { isBotRequest } from "./auth";
import { isMaintenanceActive, maintenanceBlockResponse } from "../services/maintenanceService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

const ASSET_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".mjs",
  ".map",
  ".ico",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".woff",
  ".woff2",
  ".ttf"
]);

export async function maintenanceMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    if (isMaintenanceBypass(req)) {
      return next();
    }

    if (isMaintenanceInternalBotBypass(req)) {
      return next();
    }

    const botId = await resolveRequestBotId(req);
    if (!botId || !(await isMaintenanceActive(botId))) {
      return next();
    }

    if (req.path.startsWith("/api") || req.path.startsWith("/webhooks")) {
      return res.status(503).json({
        ...maintenanceBlockResponse(),
        botId,
        maintenance: true
      });
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

function isMaintenanceBypass(req: Request) {
  const path = req.path;
  const method = req.method.toUpperCase();

  if (
    path === "/health"
    || path.startsWith("/api/health")
    || path.startsWith("/auth")
    || path.startsWith("/api/auth")
    || path.startsWith("/api/persistent-images")
    || path.startsWith("/dev")
    || path.startsWith("/api/dev")
    || path.startsWith("/api/bot/maintenance")
    || path.startsWith("/api/dashboard/maintenance")
    || path.startsWith("/uploads")
  ) {
    return true;
  }

  if (requestCameFromDevPanel(req) && isDevPanelApiBypassPath(path)) {
    return true;
  }

  if (path.startsWith("/assets")) {
    return true;
  }

  const extension = path.includes(".") ? path.slice(path.lastIndexOf(".")).toLowerCase() : "";
  return ASSET_EXTENSIONS.has(extension);
}

function requestCameFromDevPanel(req: Request) {
  if (req.get("x-dev-dashboard") === "true") {
    return true;
  }

  const referer = req.get("referer") ?? req.get("referrer") ?? "";

  if (!referer) {
    return false;
  }

  try {
    const url = new URL(referer);
    return url.pathname === "/dev" || url.pathname.startsWith("/dev/");
  } catch {
    return referer.includes("/dev");
  }
}

function isDevPanelApiBypassPath(path: string) {
  return path === "/api/dashboard/me" || path.startsWith("/api/logs");
}

function isMaintenanceInternalBotBypass(req: Request) {
  if (!isBotRequest(req)) {
    return false;
  }

  const path = req.path;
  const method = req.method.toUpperCase();

  if (
    path === "/api/bot/runtime/modules"
    || path === "/api/bot/runtime/status"
    || path.startsWith("/api/bot/system-emojis")
  ) {
    return true;
  }

  return method === "GET" && /^\/api\/settings\/\d{5,32}$/.test(path);
}

function maintenanceHtml() {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sistema em manutenção</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: radial-gradient(circle at top, rgba(124,58,237,.22), transparent 34%), #050505;
        color: #fff;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        width: min(92vw, 560px);
        border: 1px solid rgba(124,58,237,.28);
        border-radius: 16px;
        background: rgba(18,18,22,.86);
        box-shadow: 0 24px 80px rgba(0,0,0,.45), 0 0 44px rgba(124,58,237,.12);
        padding: 32px;
        text-align: center;
        backdrop-filter: blur(16px);
      }
      h1 { margin: 0 0 12px; font-size: 28px; }
      p { margin: 0; color: #d4d4d8; line-height: 1.6; font-weight: 600; }
    </style>
  </head>
  <body>
    <main>
      <h1>❌ Sistema em manutenção</h1>
      <p>Os bots estão em manutenção no momento.<br />Aguarde a nossa equipe finalizar a manutenção para realizar novamente.</p>
    </main>
  </body>
</html>`;
}

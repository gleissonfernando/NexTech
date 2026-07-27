import type { Request } from "express";
import { createDashboardAuditLog } from "./dashboardAuditService";
import { createLog } from "./logService";

export type AccessAuditResult = "allowed" | "denied";

export async function recordAccessAttempt(req: Request, input: {
  action?: string;
  userId?: string | null;
  username?: string | null;
  dashboardSlug?: string | null;
  botId?: string | null;
  guildId?: string | null;
  result: AccessAuditResult;
  reason?: string | null;
}) {
  const action = input.action ?? `access.${input.result}`;
  await createDashboardAuditLog({
    action,
    userId: input.userId,
    botId: input.botId,
    guildId: input.guildId,
    dashboardSlug: input.dashboardSlug,
    ip: req.ip,
    userAgent: req.get("user-agent") ?? null,
    metadata: {
      method: req.method,
      path: req.originalUrl,
      reason: input.reason ?? null,
      result: input.result,
      username: input.username ?? null
    }
  }).catch((error) => {
    console.warn("[access] não foi possível registrar auditoria:", error instanceof Error ? error.message : error);
  });

  if (input.result === "allowed" && input.botId && input.guildId) {
    const isLogout = action === "access.logout" || action === "dashboard.logout";
    await createLog({
      action: isLogout ? "access.logout" : "access.allowed",
      botId: input.botId,
      guildId: input.guildId,
      module: "dashboard",
      status: "success",
      type: isLogout ? "dashboard.access.logout" : "dashboard.access.allowed",
      userId: input.userId ?? null,
      message: isLogout
        ? `${input.username ?? "Usuário"} saiu da dashboard deste bot.`
        : `${input.username ?? "Usuário"} entrou na dashboard deste bot.`,
      metadata: {
        action,
        dashboardSlug: input.dashboardSlug ?? null,
        method: req.method,
        path: req.originalUrl,
        reason: input.reason ?? null,
        username: input.username ?? null
      }
    }).catch((error) => {
      console.warn("[access] não foi possível registrar entrada da dashboard:", error instanceof Error ? error.message : error);
    });
  }
}

import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { recordOperationMetric } from "../services/monitoringService";

export function performanceTraceMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = req.header("x-request-id")?.trim() || randomUUID();
  const startedAt = Date.now();

  req.performanceTrace = {
    addStep: (name, durationMs, metadata) => {
      const [type = "processing", ...operationParts] = name.split(":");
      recordOperationMetric({
        botId: req.performanceTrace?.botId,
        durationMs,
        metadata,
        module: req.performanceTrace?.module ?? moduleFromPath(req.path),
        operation: operationParts.join(":") || name,
        requestId,
        status: res.statusCode >= 500 ? "error" : "ok",
        type: operationMetricType(type)
      });
    },
    id: requestId,
    module: moduleFromPath(req.path),
    operation: `${req.method.toUpperCase()} ${req.path}`,
    startedAt
  };

  res.setHeader("X-Request-Id", requestId);
  res.on("finish", () => {
    recordOperationMetric({
      botId: req.performanceTrace?.botId,
      durationMs: Date.now() - startedAt,
      module: req.performanceTrace?.module ?? moduleFromPath(req.path),
      operation: req.performanceTrace?.operation ?? `${req.method.toUpperCase()} ${req.path}`,
      requestId,
      status: res.statusCode >= 500 ? "error" : "ok",
      type: "processing"
    });
  });

  next();
}

function moduleFromPath(path: string) {
  const normalized = path.replace(/^\/api\//, "/");
  const part = normalized.split("/").filter(Boolean)[0];
  return part || "root";
}

function operationMetricType(value: string): "cache" | "database" | "externalApi" | "processing" | "queue" | "redis" {
  if (value === "cache" || value === "database" || value === "externalApi" || value === "queue" || value === "redis") {
    return value;
  }

  return "processing";
}

import type { NextFunction, Request, Response } from "express";

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  const message = error instanceof Error ? error.message : "Erro inesperado.";
  const uploadErrorCode = (error as { code?: unknown })?.code;
  const statusCode = uploadErrorCode === "LIMIT_FILE_SIZE" ? 413 : typeof (error as { statusCode?: unknown })?.statusCode === "number"
    ? (error as { statusCode: number }).statusCode
    : 500;

  console.error("[api]", error);
  res.status(statusCode).json({
    message
  });
}

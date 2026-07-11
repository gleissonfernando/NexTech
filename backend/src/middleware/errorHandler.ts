import type { NextFunction, Request, Response } from "express";

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  const rawMessage = error instanceof Error ? error.message : "Erro inesperado.";
  const message = publicErrorMessage(rawMessage);
  const uploadErrorCode = (error as { code?: unknown })?.code;
  const statusCode = isMongoStorageQuotaError(rawMessage) ? 507 : uploadErrorCode === "LIMIT_FILE_SIZE" ? 413 : typeof (error as { statusCode?: unknown })?.statusCode === "number"
    ? (error as { statusCode: number }).statusCode
    : 500;

  if (statusCode >= 500) {
    console.error("[api]", error);
  }

  res.status(statusCode).json({
    message
  });
}

function publicErrorMessage(message: string) {
  if (isMongoStorageQuotaError(message)) {
    return "Armazenamento do banco no limite. Limpe dados antigos ou aumente o plano do MongoDB Atlas para salvar novos banners.";
  }

  return message;
}

function isMongoStorageQuotaError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("over your space quota") || normalized.includes("writes are blocked on your cluster");
}

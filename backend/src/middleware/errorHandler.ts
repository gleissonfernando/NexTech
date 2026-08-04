import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      message: formatZodError(error)
    });
  }

  const rawMessage = error instanceof Error ? error.message : "Erro inesperado.";
  const message = isPayloadTooLarge(error) ? "Arquivo muito grande. O limite configurado para upload de mídia do painel foi excedido." : publicErrorMessage(rawMessage);
  const uploadErrorCode = (error as { code?: unknown })?.code;
  const errorStatus = (error as { status?: unknown; statusCode?: unknown })?.statusCode ?? (error as { status?: unknown })?.status;
  const statusCode = isMongoStorageQuotaError(rawMessage) ? 507 : isTransientMongoConnectionError(error, rawMessage) ? 503 : uploadErrorCode === "LIMIT_FILE_SIZE" ? 413 : typeof errorStatus === "number"
    ? errorStatus
    : isPayloadTooLarge(error) ? 413 : typeof (error as { statusCode?: unknown })?.statusCode === "number"
    ? (error as { statusCode: number }).statusCode
    : 500;

  if (statusCode >= 500) {
    console.error("[api]", error);
  }

  res.status(statusCode).json({
    message
  });
}

function formatZodError(error: ZodError) {
  const first = error.issues[0];

  if (!first) {
    return "Dados inválidos.";
  }

  const field = first.path.length ? first.path.join(".") : "payload";
  return `Dados inválidos em ${field}: ${first.message}`;
}

function publicErrorMessage(message: string) {
  if (isMongoStorageQuotaError(message)) {
    return "Armazenamento do banco no limite. Limpe dados antigos ou aumente o plano do MongoDB Atlas para salvar novos banners.";
  }

  if (isTransientMongoConnectionError(null, message)) {
    return "Banco de dados temporariamente indisponível. Tente novamente em alguns instantes.";
  }

  return message;
}

function isPayloadTooLarge(error: unknown) {
  return typeof error === "object"
    && error !== null
    && ((error as { type?: unknown }).type === "entity.too.large" || (error as { status?: unknown }).status === 413);
}

function isMongoStorageQuotaError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("over your space quota") || normalized.includes("writes are blocked on your cluster");
}

function isTransientMongoConnectionError(error: unknown, message: string) {
  const errorName = error instanceof Error ? error.name : "";
  return /Mongo(ServerSelection|Network|NetworkTimeout|PoolCleared)Error/.test(errorName)
    || /Server selection timed out|connection \d+ to .* timed out|Connection pool .* was cleared/i.test(message);
}

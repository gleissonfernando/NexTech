import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import { errorHandler } from "./errorHandler";

test("erro transitorio de Mongo nao expoe host interno na resposta", () => {
  const error = new Error("Connection pool for vilaofpss376:27017 was cleared because another operation failed with: \"connection 25 to 10.3.224.2:27017 timed out\"");
  error.name = "MongoPoolClearedError";
  const originalConsoleError = console.error;
  let statusCode: number | null = null;
  let payload: unknown = null;
  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      payload = body;
      return this;
    }
  } as Response;

  console.error = () => undefined;
  try {
    errorHandler(error, {} as Request, response, (() => undefined) as NextFunction);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(statusCode, 503);
  assert.deepEqual(payload, {
    message: "Banco de dados temporariamente indisponível. Tente novamente em alguns instantes."
  });
});

import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { processMercadoPagoWebhook } from "../services/planService";

export const paymentsRouter = Router();
export const paymentWebhooksRouter = Router();

paymentsRouter.post("/mercado-pago/webhook", handleMercadoPagoWebhook);
paymentWebhooksRouter.post("/mercado-pago", handleMercadoPagoWebhook);

async function handleMercadoPagoWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const dataId = readQuery(req.query["data.id"]) ?? readQuery(req.query.data_id);
    const result = await processMercadoPagoWebhook({
      body: req.body,
      dataId,
      requestId: req.get("x-request-id") ?? null,
      signature: req.get("x-signature") ?? null
    });

    return res.status(result.processed || result.duplicate ? 200 : 202).json({
      duplicate: result.duplicate,
      processed: result.processed
    });
  } catch (error) {
    return next(error);
  }
}

function readQuery(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

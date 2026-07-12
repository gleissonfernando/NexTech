import { Router } from "express";
import { processMercadoPagoWebhook } from "../services/planService";

export const paymentsRouter = Router();

paymentsRouter.post("/mercado-pago/webhook", async (req, res, next) => {
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
});

function readQuery(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

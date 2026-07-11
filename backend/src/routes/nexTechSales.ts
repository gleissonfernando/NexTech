import { Router } from "express";
import { z } from "zod";
import {
  createProductCheckout,
  getPublicNexTechProduct,
  processNexTechPaymentWebhook
} from "../services/nexTechSalesService";

export const nexTechSalesRouter = Router();

const webhookParamsSchema = z.object({
  gatewayId: z.string().min(8).max(120),
  storeId: z.string().min(8).max(120)
});

const productParamsSchema = z.object({
  slug: z.string().min(1).max(120),
  storeId: z.string().min(8).max(120)
});

const checkoutSchema = z.object({
  buyerEmail: z.string().email().nullable().optional().or(z.literal("")),
  buyerId: z.string().max(64).nullable().optional().or(z.literal("")),
  buyerName: z.string().max(100).nullable().optional().or(z.literal("")),
  paymentProviderId: z.string().max(120).nullable().optional(),
  planType: z.enum(["monthly", "lifetime"])
});

nexTechSalesRouter.get("/stores/:storeId/products/:slug", async (req, res, next) => {
  try {
    const params = productParamsSchema.parse(req.params);
    const product = await getPublicNexTechProduct(params.storeId, params.slug);

    if (!product) {
      return res.status(404).json({
        message: "Produto nao encontrado."
      });
    }

    return res.json(product);
  } catch (error) {
    return next(error);
  }
});

nexTechSalesRouter.post("/stores/:storeId/products/:slug/checkout", async (req, res, next) => {
  try {
    const params = productParamsSchema.parse(req.params);
    const input = checkoutSchema.parse(req.body ?? {});
    const checkout = await createProductCheckout(params.storeId, params.slug, {
      ...input,
      buyerEmail: input.buyerEmail === "" ? null : input.buyerEmail,
      buyerId: input.buyerId === "" ? null : input.buyerId,
      buyerName: input.buyerName === "" ? null : input.buyerName
    });

    if (!checkout) {
      return res.status(404).json({
        message: "Produto nao encontrado."
      });
    }

    return res.status(201).json(checkout);
  } catch (error) {
    return next(error);
  }
});

nexTechSalesRouter.post("/webhooks/:storeId/:gatewayId", async (req, res, next) => {
  try {
    const params = webhookParamsSchema.parse(req.params);
    const rawBody = ((req as typeof req & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}))).toString("utf8");
    const signature = req.header("x-nex-tech-signature")
      ?? req.header("x-hub-signature-256")
      ?? req.header("x-signature")
      ?? null;

    const result = await processNexTechPaymentWebhook(params.storeId, params.gatewayId, {
      eventId: readString(req.body?.id) ?? readString(req.body?.eventId) ?? readString(req.body?.data?.id),
      eventType: readString(req.body?.type) ?? readString(req.body?.eventType) ?? readString(req.body?.action),
      payload: req.body,
      rawBody,
      signature
    });

    return res.status(result.statusCode).json(result);
  } catch (error) {
    return next(error);
  }
});

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

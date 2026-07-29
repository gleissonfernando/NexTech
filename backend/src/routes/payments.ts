import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { requireAsaasOperational } from "../config/payments";
import { requireAdminAccess, requireAuth, requireAuthenticated } from "../middleware/auth";
import {
  createCheckoutInterest,
  createPublicCheckoutInterest,
  getAdminPaymentOrder,
  getPaymentOrderStatus,
  getPublicPaymentOrderStatus,
  listAdminPaymentOrders,
  listMyPaymentOrders,
  processAsaasWebhook,
  processPagBankWebhook,
  processMercadoPagoWebhook,
  processStripeWebhook,
  reconcilePaymentOrder,
  retryPublicPaymentOrder,
  retryPaymentOrder,
  type PlanActor
} from "../services/planService";
import { AsaasPaymentService, validateAsaasWebhookToken } from "../services/payments/asaasPaymentService";
import type { DashboardAuth } from "../services/tokenService";

export const paymentsRouter = Router();
export const paymentWebhooksRouter = Router();
export const paymentAdminRouter = Router();
export const subscriptionsPaymentsRouter = Router();

const checkoutSchema = z.object({
  paymentMethod: z.enum(["checkout", "pix", "card", "credit_card", "debit_card"]).default("checkout")
    .transform((value) => value === "pix" ? "pix" as const : "checkout" as const),
  planId: z.string().min(1).max(120)
});

const orderIdSchema = z.string().min(8).max(120);
const asaasCustomerSchema = z.object({
  id: z.string().min(1).max(120).optional()
}).passthrough();
const asaasChargeSchema = z.object({
  customer: asaasCustomerSchema,
  description: z.string().max(500).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  externalReference: z.string().min(1).max(120).optional(),
  value: z.coerce.number().positive()
}).passthrough();
const asaasCardSchema = asaasChargeSchema.extend({
  creditCard: z.record(z.unknown()),
  creditCardHolderInfo: z.record(z.unknown())
});
const asaasSubscriptionSchema = z.object({
  billingType: z.enum(["PIX", "CREDIT_CARD", "BOLETO", "UNDEFINED"]).default("PIX"),
  creditCard: z.record(z.unknown()).optional(),
  creditCardHolderInfo: z.record(z.unknown()).optional(),
  customer: asaasCustomerSchema,
  cycle: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "BIMONTHLY", "QUARTERLY", "SEMIANNUALLY", "YEARLY"]).default("MONTHLY"),
  description: z.string().max(500).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  externalReference: z.string().min(1).max(120).optional(),
  nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.coerce.number().positive()
});

paymentsRouter.post("/mercadopago/checkout", checkoutRateLimit, async (req, res, next) => {
  try {
    const input = checkoutSchema.parse(req.body ?? {});
    const result = await createPublicCheckoutInterest(input.planId, actorFrom(req), input.paymentMethod);
    return sendCheckoutResult(res, result);
  } catch (error) {
    return next(error);
  }
});

paymentsRouter.post("/stripe/checkout", checkoutRateLimit, async (req, res, next) => {
  try {
    const input = checkoutSchema.parse(req.body ?? {});
    const result = await createPublicCheckoutInterest(input.planId, actorFrom(req), input.paymentMethod);
    return sendCheckoutResult(res, result);
  } catch (error) {
    return next(error);
  }
});

paymentsRouter.post("/create-checkout", checkoutRateLimit, async (req, res, next) => {
  try {
    const input = checkoutSchema.parse(req.body ?? {});
    const result = await createPublicCheckoutInterest(input.planId, actorFrom(req), input.paymentMethod);
    return sendCheckoutResult(res, result);
  } catch (error) {
    return next(error);
  }
});

paymentsRouter.post("/pix", checkoutRateLimit, async (req, res, next) => {
  try {
    if (typeof req.body?.planId === "string") {
      const input = checkoutSchema.parse({ ...req.body, paymentMethod: "pix" });
      const result = await createPublicCheckoutInterest(input.planId, actorFrom(req), "pix");
      return sendCheckoutResult(res, result);
    }

    const input = asaasChargeSchema.parse(req.body ?? {});
    const service = new AsaasPaymentService();
    const result = await service.createPixCharge({
      ...input,
      billingType: "PIX",
      remoteIp: req.ip ?? null
    });
    return res.status(201).json({ success: true, provider: "asaas", result });
  } catch (error) {
    return next(error);
  }
});

paymentsRouter.post("/card", checkoutRateLimit, async (req, res, next) => {
  try {
    const input = asaasCardSchema.parse(req.body ?? {});
    const service = new AsaasPaymentService();
    const result = await service.createCardCharge({
      ...input,
      billingType: "CREDIT_CARD",
      remoteIp: req.ip ?? null
    });
    return res.status(201).json({ success: true, provider: "asaas", result });
  } catch (error) {
    return next(error);
  }
});

async function handleCreateAsaasSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    const input = asaasSubscriptionSchema.parse(req.body ?? {});
    const service = new AsaasPaymentService();
    const result = await service.createSubscription({
      ...input,
      remoteIp: req.ip ?? null
    });
    return res.status(201).json({ success: true, provider: "asaas", result });
  } catch (error) {
    return next(error);
  }
}

paymentsRouter.post("/subscriptions/create", checkoutRateLimit, handleCreateAsaasSubscription);
subscriptionsPaymentsRouter.post("/create", checkoutRateLimit, handleCreateAsaasSubscription);

paymentsRouter.post("/mercadopago/checkout/authenticated", requireAuthenticated, checkoutRateLimit, async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const input = checkoutSchema.parse(req.body ?? {});
    const result = await createCheckoutInterest(input.planId, auth, actorFrom(req, auth), input.paymentMethod);
    return sendCheckoutResult(res, result);
  } catch (error) {
    return next(error);
  }
});

paymentsRouter.post("/stripe/checkout/authenticated", requireAuthenticated, checkoutRateLimit, async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const input = checkoutSchema.parse(req.body ?? {});
    const result = await createCheckoutInterest(input.planId, auth, actorFrom(req, auth), input.paymentMethod);
    return sendCheckoutResult(res, result);
  } catch (error) {
    return next(error);
  }
});

paymentsRouter.get("/orders/:orderId/status", statusRateLimit, async (req, res, next) => {
  try {
    const orderId = orderIdSchema.parse(req.params.orderId);
    return res.json(await getPublicPaymentOrderStatus(orderId));
  } catch (error) {
    return next(error);
  }
});

paymentsRouter.get("/orders/:orderId/status/authenticated", requireAuthenticated, statusRateLimit, async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const orderId = orderIdSchema.parse(req.params.orderId);
    return res.json(await getPaymentOrderStatus(orderId, auth));
  } catch (error) {
    return next(error);
  }
});

paymentsRouter.post("/orders/:orderId/retry", checkoutRateLimit, async (req, res, next) => {
  try {
    const orderId = orderIdSchema.parse(req.params.orderId);
    return res.json(await retryPublicPaymentOrder(orderId, actorFrom(req)));
  } catch (error) {
    return next(error);
  }
});

paymentsRouter.post("/orders/:orderId/retry/authenticated", requireAuthenticated, checkoutRateLimit, async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const orderId = orderIdSchema.parse(req.params.orderId);
    return res.json(await retryPaymentOrder(orderId, auth, actorFrom(req, auth)));
  } catch (error) {
    return next(error);
  }
});

paymentsRouter.get("/me", requireAuthenticated, async (_req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    return res.json(await listMyPaymentOrders(auth));
  } catch (error) {
    return next(error);
  }
});

paymentsRouter.post("/mercadopago/webhook", handleMercadoPagoWebhook);
paymentsRouter.post("/mercado-pago/webhook", handleMercadoPagoWebhook);
paymentsRouter.post("/pagbank/webhook", handlePagBankWebhook);
paymentsRouter.post("/stripe/webhook", handleStripeWebhook);
paymentsRouter.post("/asaas/webhook", handleAsaasWebhook);
paymentWebhooksRouter.post("/mercadopago", handleMercadoPagoWebhook);
paymentWebhooksRouter.post("/mercado-pago", handleMercadoPagoWebhook);
paymentWebhooksRouter.post("/pagbank", handlePagBankWebhook);
paymentWebhooksRouter.post("/stripe", handleStripeWebhook);
paymentWebhooksRouter.post("/asaas", handleAsaasWebhook);

paymentAdminRouter.use(requireAuth, requireAdminAccess);

paymentAdminRouter.get("/", async (_req, res, next) => {
  try {
    return res.json(await listAdminPaymentOrders());
  } catch (error) {
    return next(error);
  }
});

paymentAdminRouter.get("/:orderId", async (req, res, next) => {
  try {
    const orderId = orderIdSchema.parse(req.params.orderId);
    return res.json(await getAdminPaymentOrder(orderId));
  } catch (error) {
    return next(error);
  }
});

paymentAdminRouter.post("/:orderId/reconcile", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const orderId = orderIdSchema.parse(req.params.orderId);
    return res.json(await reconcilePaymentOrder(orderId, actorFrom(req, auth)));
  } catch (error) {
    return next(error);
  }
});

async function handleMercadoPagoWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const dataId = readQuery(req.query["data.id"]) ?? readQuery(req.query.data_id);
    const result = await processMercadoPagoWebhook({
      body: req.body,
      dataId,
      requestId: req.get("x-request-id") ?? null,
      resourceType: readQuery(req.query.type),
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

async function handlePagBankWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await processPagBankWebhook({
      body: req.body,
      eventId: readQuery(req.query.event_id) ?? readQuery(req.query.id),
      requestId: req.get("x-request-id") ?? null,
      signature: req.get("x-signature") ?? req.get("x-pagbank-signature") ?? null,
      webhookToken: req.get("x-webhook-token") ?? req.get("x-pagbank-token") ?? readQuery(req.query.token)
    });

    return res.status(result.processed || result.duplicate ? 200 : 202).json({
      duplicate: result.duplicate,
      processed: result.processed
    });
  } catch (error) {
    return next(error);
  }
}

async function handleStripeWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      return res.status(400).json({ message: "Corpo bruto ausente para validar webhook Stripe." });
    }
    const result = await processStripeWebhook({
      rawBody,
      requestId: req.get("request-id") ?? req.get("x-request-id") ?? null,
      signature: req.get("stripe-signature") ?? null
    });

    return res.status(result.processed || result.duplicate ? 200 : 202).json({
      duplicate: result.duplicate,
      processed: result.processed
    });
  } catch (error) {
    return next(error);
  }
}

async function handleAsaasWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const input = {
      body: req.body,
      eventId: readQuery(req.query.event_id) ?? readQuery(req.query.id),
      requestId: req.get("x-request-id") ?? null,
      webhookToken: req.get("x-webhook-token")
        ?? req.get("x-asaas-webhook-token")
        ?? req.get("asaas-access-token")
        ?? req.get("access_token")
        ?? readQuery(req.query.token)
    };
    const asaasConfig = requireAsaasOperational({ allowDisabled: true, requireWebhook: true });
    if (!validateAsaasWebhookToken(asaasConfig, input.webhookToken ?? null)) {
      return res.status(401).json({ message: "Token webhook Asaas inválido." });
    }

    res.status(200).json({ accepted: true, provider: "asaas" });
    setImmediate(() => {
      processAsaasWebhook(input).catch((error) => {
        console.error("[payments][asaas] webhook background processing failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: input.requestId
        });
      });
    });
    return undefined;
  } catch (error) {
    return next(error);
  }
}

function readQuery(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function actorFrom(req: Request, auth?: DashboardAuth): PlanActor {
  return {
    id: auth?.user.discordId ?? null,
    ip: req.ip ?? null,
    name: auth?.user.globalName || auth?.user.username || null,
    userAgent: req.header("user-agent") ?? null
  };
}

function sendCheckoutResult(res: Response, result: Awaited<ReturnType<typeof createPublicCheckoutInterest>>) {
  return res.status(201).json({
    success: true,
    orderId: result.order.id,
    environment: result.order.environment ?? null,
    checkoutUrl: result.order.checkoutUrl,
    order: result.order,
    payment: result.payment,
    plan: result.plan
  });
}

type Bucket = { count: number; resetAt: number };
const checkoutBuckets = new Map<string, Bucket>();
const statusBuckets = new Map<string, Bucket>();

function checkoutRateLimit(req: Request, res: Response, next: NextFunction) {
  return consumeLocalRateLimit(checkoutBuckets, req, res, next, 5, 10 * 60_000);
}

function statusRateLimit(req: Request, res: Response, next: NextFunction) {
  return consumeLocalRateLimit(statusBuckets, req, res, next, 90, 60_000);
}

function consumeLocalRateLimit(
  buckets: Map<string, Bucket>,
  req: Request,
  res: Response,
  next: NextFunction,
  limit: number,
  windowMs: number
) {
  const auth = res.locals.dashboardAuth as DashboardAuth | undefined;
  const identity = `${auth?.user.discordId ?? "anon"}:${req.ip ?? "ip"}`;
  const now = Date.now();
  const bucket = buckets.get(identity);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(identity, { count: 1, resetAt: now + windowMs });
    return next();
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return res.status(429).json({ message: "Muitas tentativas. Aguarde antes de tentar novamente." });
  }

  return next();
}

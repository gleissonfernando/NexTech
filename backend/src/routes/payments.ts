import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { requireAdminAccess, requireAuth, requireAuthenticated } from "../middleware/auth";
import {
  createCheckoutInterest,
  createPublicCheckoutInterest,
  getAdminPaymentOrder,
  getPaymentOrderStatus,
  getPublicPaymentOrderStatus,
  listAdminPaymentOrders,
  listMyPaymentOrders,
  processMercadoPagoWebhook,
  reconcilePaymentOrder,
  retryPublicPaymentOrder,
  retryPaymentOrder,
  type PlanActor
} from "../services/planService";
import type { DashboardAuth } from "../services/tokenService";

export const paymentsRouter = Router();
export const paymentWebhooksRouter = Router();
export const paymentAdminRouter = Router();

const checkoutSchema = z.object({
  planId: z.string().min(1).max(120)
});

const orderIdSchema = z.string().min(8).max(120);

paymentsRouter.post("/mercadopago/checkout", checkoutRateLimit, async (req, res, next) => {
  try {
    const input = checkoutSchema.parse(req.body ?? {});
    const result = await createPublicCheckoutInterest(input.planId, actorFrom(req));
    return sendCheckoutResult(res, result);
  } catch (error) {
    return next(error);
  }
});

paymentsRouter.post("/create-checkout", checkoutRateLimit, async (req, res, next) => {
  try {
    const input = checkoutSchema.parse(req.body ?? {});
    const result = await createPublicCheckoutInterest(input.planId, actorFrom(req));
    return sendCheckoutResult(res, result);
  } catch (error) {
    return next(error);
  }
});

paymentsRouter.post("/mercadopago/checkout/authenticated", requireAuthenticated, checkoutRateLimit, async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const input = checkoutSchema.parse(req.body ?? {});
    const result = await createCheckoutInterest(input.planId, auth, actorFrom(req, auth));
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
paymentWebhooksRouter.post("/mercadopago", handleMercadoPagoWebhook);
paymentWebhooksRouter.post("/mercado-pago", handleMercadoPagoWebhook);

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

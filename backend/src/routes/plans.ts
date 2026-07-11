import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { getMongoCollections } from "../database/mongo";
import {
  createCheckoutInterest,
  createWorkspaceBotCredential,
  deleteWorkspaceBotCredential,
  duplicateDevPlan,
  extendSubscription,
  getCustomerPlansDashboard,
  getDevPlansDashboard,
  getPublicPlan,
  getWorkspaceDashboard,
  listPublicPlans,
  manualActivateSubscription,
  saveDevPlan,
  saveDevPlanFeature,
  savePaymentSettings,
  setDevPlanActive,
  setSubscriptionStatus,
  updateWorkspaceBotCredentialToken,
  validateWorkspaceBotCredential,
  type PlanActor
} from "../services/planService";
import type { DashboardAuth } from "../services/tokenService";

export const plansRouter = Router();
export const checkoutRouter = Router();
export const customerPlansRouter = Router();
export const workspacePlansRouter = Router();
export const devPlansRouter = Router();

const entitlementSchema = z.object({
  enabled: z.boolean().default(true),
  key: z.string().min(1).max(120),
  limit: z.number().int().min(0).nullable().optional().transform((value) => value ?? null),
  metadata: z.record(z.unknown()).optional(),
  unit: z.string().max(40).nullable().optional().transform((value) => value ?? null)
});

const planPayloadSchema = z.object({
  badge: z.string().max(80).nullable().optional().or(z.literal("")),
  billingCycle: z.enum(["monthly", "quarterly", "semiannual", "annual", "lifetime", "custom"]).optional(),
  botLimit: z.number().int().min(0).max(1000).optional(),
  buttonText: z.string().min(1).max(40).optional(),
  color: z.string().min(4).max(16).optional(),
  currency: z.enum(["BRL", "USD", "EUR"]).optional(),
  description: z.string().max(4000).optional(),
  entitlements: z.array(entitlementSchema).optional(),
  guildLimit: z.number().int().min(0).max(1000).optional(),
  icon: z.string().max(80).nullable().optional().or(z.literal("")),
  imageUrl: z.string().url().max(2048).nullable().optional().or(z.literal("")),
  isActive: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  isPurchasable: z.boolean().optional(),
  isRecommended: z.boolean().optional(),
  name: z.string().min(2).max(120),
  order: z.number().int().min(0).max(100000).optional(),
  priceInCents: z.number().int().min(0).max(100000000).optional(),
  promotionalPriceInCents: z.number().int().min(0).max(100000000).nullable().optional(),
  shortDescription: z.string().max(300).optional(),
  slug: z.string().max(120).nullable().optional().or(z.literal("")),
  validityDays: z.number().int().min(1).max(3650).nullable().optional()
});

const featurePayloadSchema = z.object({
  category: z.enum(["streamer", "fivem", "discord", "security", "support", "billing"]),
  defaultLimit: z.number().int().min(0).max(100000000).nullable().optional(),
  description: z.string().max(1200).optional(),
  isActive: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  key: z.string().min(2).max(120),
  name: z.string().min(2).max(120),
  order: z.number().int().min(0).max(100000).optional(),
  unit: z.string().max(40).nullable().optional().or(z.literal(""))
});

const checkoutPayloadSchema = z.object({
  planSlug: z.string().min(1).max(120)
});

const manualActivationSchema = z.object({
  planId: z.string().min(8).max(120),
  userId: z.string().regex(/^\d{5,32}$/),
  workspaceName: z.string().max(80).nullable().optional().or(z.literal(""))
});

const paymentSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  provider: z.enum(["disabled", "mercadopago"]).optional(),
  publicKey: z.string().max(512).nullable().optional().or(z.literal("")),
  secret: z.string().max(2048).nullable().optional().or(z.literal("")),
  webhookSecret: z.string().max(2048).nullable().optional().or(z.literal(""))
});

const botCredentialSchema = z.object({
  botClientId: z.string().regex(/^\d{5,32}$/),
  botName: z.string().min(2).max(80),
  token: z.string().min(20).max(512)
});

const tokenPatchSchema = z.object({
  token: z.string().min(20).max(512)
});

const extensionSchema = z.object({
  days: z.number().int().min(1).max(3650)
});

plansRouter.get("/", async (_req, res, next) => {
  try {
    return res.json({
      plans: await listPublicPlans()
    });
  } catch (error) {
    return next(error);
  }
});

plansRouter.get("/:slug", async (req, res, next) => {
  try {
    const slug = z.string().min(1).max(120).parse(req.params.slug);
    const plan = await getPublicPlan(slug);

    if (!plan) {
      return res.status(404).json({ message: "Plano nao encontrado." });
    }

    return res.json({ plan });
  } catch (error) {
    return next(error);
  }
});

checkoutRouter.post("/", requireAuth, async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const input = checkoutPayloadSchema.parse(req.body ?? {});
    return res.status(201).json(await createCheckoutInterest(input.planSlug, auth, actorFrom(req, auth)));
  } catch (error) {
    return next(error);
  }
});

checkoutRouter.post("/plans/:planSlug", requireAuth, async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const planSlug = z.string().min(1).max(120).parse(req.params.planSlug);
    return res.status(201).json(await createCheckoutInterest(planSlug, auth, actorFrom(req, auth)));
  } catch (error) {
    return next(error);
  }
});

customerPlansRouter.use(requireAuth);

customerPlansRouter.get("/plans-dashboard", async (_req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    return res.json(await getCustomerPlansDashboard(auth));
  } catch (error) {
    return next(error);
  }
});

customerPlansRouter.get("/plans", async (_req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    return res.json(await getCustomerPlansDashboard(auth));
  } catch (error) {
    return next(error);
  }
});

customerPlansRouter.get("/subscription", async (_req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const dashboard = await getCustomerPlansDashboard(auth);
    return res.json({
      subscriptions: dashboard.subscriptions,
      workspaces: dashboard.workspaces
    });
  } catch (error) {
    return next(error);
  }
});

workspacePlansRouter.use(requireAuth);

workspacePlansRouter.get("/:workspaceId", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    return res.json(await getWorkspaceDashboard(req.params.workspaceId, auth));
  } catch (error) {
    return next(error);
  }
});

workspacePlansRouter.get("/:workspaceId/entitlements", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const dashboard = await getWorkspaceDashboard(req.params.workspaceId, auth);
    return res.json({
      entitlements: dashboard.plan?.entitlements ?? []
    });
  } catch (error) {
    return next(error);
  }
});

workspacePlansRouter.get("/:workspaceId/bots", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const dashboard = await getWorkspaceDashboard(req.params.workspaceId, auth);
    return res.json({
      bots: dashboard.bots
    });
  } catch (error) {
    return next(error);
  }
});

workspacePlansRouter.post("/:workspaceId/bots", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const input = botCredentialSchema.parse(req.body ?? {});
    return res.status(201).json({
      bot: await createWorkspaceBotCredential(req.params.workspaceId, input, auth, actorFrom(req, auth))
    });
  } catch (error) {
    return next(error);
  }
});

workspacePlansRouter.put("/:workspaceId/bots/:credentialId/token", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const input = tokenPatchSchema.parse(req.body ?? {});
    return res.json({
      bot: await updateWorkspaceBotCredentialToken(req.params.workspaceId, req.params.credentialId, input.token, auth, actorFrom(req, auth))
    });
  } catch (error) {
    return next(error);
  }
});

workspacePlansRouter.post("/:workspaceId/bots/:credentialId/validate", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    return res.json({
      bot: await validateWorkspaceBotCredential(req.params.workspaceId, req.params.credentialId, auth, actorFrom(req, auth))
    });
  } catch (error) {
    return next(error);
  }
});

workspacePlansRouter.delete("/:workspaceId/bots/:credentialId", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    return res.json({
      bot: await deleteWorkspaceBotCredential(req.params.workspaceId, req.params.credentialId, auth, actorFrom(req, auth))
    });
  } catch (error) {
    return next(error);
  }
});

devPlansRouter.get("/plans-dashboard", async (_req, res, next) => {
  try {
    return res.json(await getDevPlansDashboard());
  } catch (error) {
    return next(error);
  }
});

devPlansRouter.get("/plans", async (_req, res, next) => {
  try {
    const dashboard = await getDevPlansDashboard();
    return res.json({
      features: dashboard.features,
      plans: dashboard.plans,
      summary: dashboard.summary
    });
  } catch (error) {
    return next(error);
  }
});

devPlansRouter.post("/plans", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const input = planPayloadSchema.parse(req.body ?? {});
    return res.status(201).json({
      plan: await saveDevPlan(null, input, actorFrom(req, auth))
    });
  } catch (error) {
    return next(error);
  }
});

devPlansRouter.put("/plans/:planId", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const input = planPayloadSchema.parse(req.body ?? {});
    return res.json({
      plan: await saveDevPlan(req.params.planId, input, actorFrom(req, auth))
    });
  } catch (error) {
    return next(error);
  }
});

devPlansRouter.post("/plans/:planId/duplicate", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    return res.status(201).json({
      plan: await duplicateDevPlan(req.params.planId, actorFrom(req, auth))
    });
  } catch (error) {
    return next(error);
  }
});

devPlansRouter.post("/plans/:planId/activate", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    return res.json({
      plan: await setDevPlanActive(req.params.planId, true, actorFrom(req, auth))
    });
  } catch (error) {
    return next(error);
  }
});

devPlansRouter.post("/plans/:planId/deactivate", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    return res.json({
      plan: await setDevPlanActive(req.params.planId, false, actorFrom(req, auth))
    });
  } catch (error) {
    return next(error);
  }
});

devPlansRouter.post("/plan-features", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const input = featurePayloadSchema.parse(req.body ?? {});
    return res.status(201).json({
      feature: await saveDevPlanFeature(null, input, actorFrom(req, auth))
    });
  } catch (error) {
    return next(error);
  }
});

devPlansRouter.put("/plan-features/:featureId", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const input = featurePayloadSchema.parse(req.body ?? {});
    return res.json({
      feature: await saveDevPlanFeature(req.params.featureId, input, actorFrom(req, auth))
    });
  } catch (error) {
    return next(error);
  }
});

devPlansRouter.get("/subscriptions", async (_req, res, next) => {
  try {
    const dashboard = await getDevPlansDashboard();
    return res.json({
      subscriptions: dashboard.subscriptions
    });
  } catch (error) {
    return next(error);
  }
});

devPlansRouter.post("/subscriptions/manual-activate", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const input = manualActivationSchema.parse(req.body ?? {});
    return res.status(201).json({
      subscription: await manualActivateSubscription(input, actorFrom(req, auth))
    });
  } catch (error) {
    return next(error);
  }
});

devPlansRouter.post("/subscriptions/:subscriptionId/suspend", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    return res.json({
      subscription: await setSubscriptionStatus(req.params.subscriptionId, "suspended", actorFrom(req, auth))
    });
  } catch (error) {
    return next(error);
  }
});

devPlansRouter.post("/subscriptions/:subscriptionId/reactivate", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    return res.json({
      subscription: await setSubscriptionStatus(req.params.subscriptionId, "active", actorFrom(req, auth))
    });
  } catch (error) {
    return next(error);
  }
});

devPlansRouter.post("/subscriptions/:subscriptionId/cancel", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    return res.json({
      subscription: await setSubscriptionStatus(req.params.subscriptionId, "cancelled", actorFrom(req, auth))
    });
  } catch (error) {
    return next(error);
  }
});

devPlansRouter.post("/subscriptions/:subscriptionId/extend", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const input = extensionSchema.parse(req.body ?? {});
    return res.json({
      subscription: await extendSubscription(req.params.subscriptionId, input.days, actorFrom(req, auth))
    });
  } catch (error) {
    return next(error);
  }
});

devPlansRouter.get("/payment-orders", async (_req, res, next) => {
  try {
    const dashboard = await getDevPlansDashboard();
    return res.json({
      orders: dashboard.orders
    });
  } catch (error) {
    return next(error);
  }
});

devPlansRouter.get("/payment-events", async (_req, res, next) => {
  try {
    const { paymentEvents } = await getMongoCollections();
    const events = await paymentEvents.find({}).sort({ createdAt: -1 }).limit(200).toArray();
    return res.json({
      events: events.map((event) => ({
        ...event,
        id: event._id,
        createdAt: event.createdAt.toISOString(),
        processedAt: event.processedAt ? event.processedAt.toISOString() : null
      }))
    });
  } catch (error) {
    return next(error);
  }
});

devPlansRouter.get("/clients", async (_req, res, next) => {
  try {
    const dashboard = await getDevPlansDashboard();
    const clients = [...new Map(dashboard.subscriptions.map((subscription) => [
      subscription.discordId,
      {
        activeSubscriptions: dashboard.subscriptions.filter((item) => item.discordId === subscription.discordId && item.status === "active").length,
        discordId: subscription.discordId,
        subscriptions: dashboard.subscriptions.filter((item) => item.discordId === subscription.discordId).length
      }
    ])).values()];
    return res.json({ clients });
  } catch (error) {
    return next(error);
  }
});

devPlansRouter.get("/plan-bots", async (_req, res, next) => {
  try {
    const { botCredentials } = await getMongoCollections();
    const bots = await botCredentials.find({}, { projection: { tokenCiphertext: 0, encryptedDataKey: 0, iv: 0, authTag: 0 } }).sort({ createdAt: -1 }).limit(200).toArray();
    return res.json({
      bots: bots.map((bot) => ({
        ...bot,
        id: bot._id,
        createdAt: bot.createdAt.toISOString(),
        lastValidatedAt: bot.lastValidatedAt ? bot.lastValidatedAt.toISOString() : null,
        tokenConfigured: true,
        updatedAt: bot.updatedAt.toISOString()
      }))
    });
  } catch (error) {
    return next(error);
  }
});

devPlansRouter.get("/payment-settings", async (_req, res, next) => {
  try {
    const dashboard = await getDevPlansDashboard();
    return res.json({
      settings: dashboard.paymentSettings
    });
  } catch (error) {
    return next(error);
  }
});

devPlansRouter.put("/payment-settings", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const input = paymentSettingsSchema.parse(req.body ?? {});
    return res.json({
      settings: await savePaymentSettings(input, actorFrom(req, auth))
    });
  } catch (error) {
    return next(error);
  }
});

devPlansRouter.get("/plan-audit-logs", async (_req, res, next) => {
  try {
    const dashboard = await getDevPlansDashboard();
    return res.json({
      auditLogs: dashboard.auditLogs
    });
  } catch (error) {
    return next(error);
  }
});

function actorFrom(req: Request, auth?: DashboardAuth): PlanActor {
  return {
    id: auth?.user.discordId ?? null,
    ip: req.ip ?? null,
    name: auth?.user.globalName || auth?.user.username || null,
    userAgent: req.header("user-agent") ?? null
  };
}

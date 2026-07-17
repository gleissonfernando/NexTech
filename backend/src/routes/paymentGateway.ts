import { Router, type Request } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { canReadDevBotModule, canUseDevBotModule } from "../services/devBotService";
import {
  deleteNexTechPaymentProvider,
  getNexTechSalesDashboard,
  NEX_TECH_SALES_MODULE_ID,
  saveNexTechPaymentProvider,
  testNexTechPaymentProvider,
  toSettingsDto
} from "../services/nexTechSalesService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import type { DashboardAuth } from "../services/tokenService";

export const PAYMENT_GATEWAY_MODULE_ID = "payment-gateway";
export const paymentGatewayRouter = Router();

paymentGatewayRouter.use(requireAuth);

const snowflake = z.string().regex(/^\d{5,32}$/);
const paymentProviderSchema = z.object({
  clientId: z.string().max(256).nullable().optional().or(z.literal("")),
  clientSecret: z.string().max(2048).nullable().optional().or(z.literal("")),
  enabled: z.boolean().default(true),
  environment: z.enum(["sandbox", "production"]).default("production"),
  id: z.string().min(1).max(120).nullable().optional(),
  instructions: z.string().max(1200).nullable().optional().or(z.literal("")),
  label: z.string().min(2).max(80),
  provider: z.enum(["mercadopago"]),
  publicKey: z.string().max(512).nullable().optional().or(z.literal("")),
  secret: z.string().max(2048).nullable().optional().or(z.literal("")),
  webhookSecret: z.string().max(2048).nullable().optional().or(z.literal("")),
  webhookUrl: z.string().url().max(2048).nullable().optional().or(z.literal(""))
});

paymentGatewayRouter.get("/:guildId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequiredBotId(req);

    if (!(await canReadGateway(req, guildId, botId))) {
      return res.status(403).json({ message: "Módulo de pagamento automático não liberado." });
    }

    const auth = res.locals.dashboardAuth as DashboardAuth;
    return res.json(await getNexTechSalesDashboard(botId, guildId, auth.user.discordId));
  } catch (error) {
    return next(error);
  }
});

paymentGatewayRouter.post("/:guildId/providers", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequiredBotId(req);

    if (!(await canManageGateway(req, guildId, botId))) {
      return res.status(403).json({ message: "Sem permissão para configurar pagamento automático." });
    }

    const auth = res.locals.dashboardAuth as DashboardAuth;
    const input = paymentProviderSchema.parse(req.body ?? {});
    const settings = await saveNexTechPaymentProvider(botId, guildId, sanitizeProvider(input), auth.user.discordId);

    return res.json({ settings: toSettingsDto(settings) });
  } catch (error) {
    return next(error);
  }
});

paymentGatewayRouter.post("/:guildId/providers/test", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequiredBotId(req);

    if (!(await canManageGateway(req, guildId, botId))) {
      return res.status(403).json({ message: "Sem permissão para testar pagamento automático." });
    }

    const auth = res.locals.dashboardAuth as DashboardAuth;
    const input = paymentProviderSchema.parse(req.body ?? {});
    const result = await testNexTechPaymentProvider(botId, guildId, sanitizeProvider(input), auth.user.discordId);

    return res.json({ result });
  } catch (error) {
    return next(error);
  }
});

paymentGatewayRouter.delete("/:guildId/providers/:providerId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequiredBotId(req);

    if (!(await canManageGateway(req, guildId, botId))) {
      return res.status(403).json({ message: "Sem permissão para remover pagamento automático." });
    }

    const auth = res.locals.dashboardAuth as DashboardAuth;
    const settings = await deleteNexTechPaymentProvider(botId, guildId, req.params.providerId, auth.user.discordId);

    return res.json({ settings: toSettingsDto(settings) });
  } catch (error) {
    return next(error);
  }
});

async function resolveRequiredBotId(req: Request) {
  const botId = await resolveRequestBotId(req);
  if (!botId) {
    throw Object.assign(new Error("Selecione um bot DEV para configurar o pagamento automático."), { statusCode: 400 });
  }
  return botId;
}

async function canReadGateway(req: Request, guildId: string, botId: string) {
  const user = req.res?.locals.dashboardAuth.user;
  return (
    await canReadDevBotModule(user, botId, guildId, PAYMENT_GATEWAY_MODULE_ID)
  ) || (
    await canReadDevBotModule(user, botId, guildId, NEX_TECH_SALES_MODULE_ID)
  );
}

async function canManageGateway(req: Request, guildId: string, botId: string) {
  const user = req.res?.locals.dashboardAuth.user;
  return (
    await canUseDevBotModule(user, botId, guildId, PAYMENT_GATEWAY_MODULE_ID)
  ) || (
    await canUseDevBotModule(user, botId, guildId, NEX_TECH_SALES_MODULE_ID)
  );
}

function sanitizeProvider(input: z.infer<typeof paymentProviderSchema>) {
  return {
    ...input,
    clientId: input.clientId === "" ? null : input.clientId,
    clientSecret: input.clientSecret === "" ? null : input.clientSecret,
    instructions: input.instructions === "" ? null : input.instructions,
    publicKey: input.publicKey === "" ? null : input.publicKey,
    secret: input.secret === "" ? null : input.secret,
    webhookSecret: input.webhookSecret === "" ? null : input.webhookSecret,
    webhookUrl: input.webhookUrl === "" ? null : input.webhookUrl
  };
}

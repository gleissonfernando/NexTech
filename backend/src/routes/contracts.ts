import { Router } from "express";
import { z } from "zod";
import { requireAuthenticated, requireBot } from "../middleware/auth";
import { requireDevAccess } from "../services/devAccessService";
import {
  createContractUpgrade,
  emitContractInvoiceDm,
  listDeveloperMonthlyContracts,
  recordContractDmResult
} from "../services/contractBillingService";
import type { DashboardAuth } from "../services/tokenService";

export const contractsRouter = Router();

const dmResultSchema = z.object({
  error: z.string().max(500).nullable().optional(),
  invoiceId: z.string().min(1).max(120).nullable().optional(),
  notificationType: z.enum(["invoice_created", "due_reminder", "due_today", "overdue", "payment_confirmed", "contract_activated", "upgrade_confirmed", "qr_expired", "payment_failed"]).optional(),
  ok: z.boolean(),
  userId: z.string().regex(/^\d{5,32}$/).nullable().optional()
});

const resendDmSchema = z.object({
  notificationType: z.enum(["invoice_created", "due_reminder", "due_today", "overdue", "payment_confirmed", "contract_activated", "upgrade_confirmed", "qr_expired", "payment_failed"]).default("invoice_created")
});

const upgradeSchema = z.object({
  itemName: z.string().min(2).max(120),
  itemType: z.enum(["plan", "hosting", "module", "limit", "premium_feature", "integration", "bot", "service", "upgrade"]).optional(),
  quantity: z.number().int().min(1).max(1000).optional(),
  unitPrice: z.number().int().min(0).max(100000000)
});
const routeIdSchema = z.string().min(1).max(120);

contractsRouter.post("/bot/dm-result", requireBot, async (req, res, next) => {
  try {
    const input = dmResultSchema.parse(req.body ?? {});
    await recordContractDmResult(input);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

contractsRouter.post("/:contractId/upgrades", requireAuthenticated, async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const contractId = routeIdSchema.parse(req.params.contractId);
    const input = upgradeSchema.parse(req.body ?? {});
    return res.status(201).json({
      item: await createContractUpgrade(contractId, input, auth.user)
    });
  } catch (error) {
    return next(error);
  }
});

contractsRouter.get("/dev/monthly-contracts", requireDevAccess, async (_req, res, next) => {
  try {
    return res.json(await listDeveloperMonthlyContracts());
  } catch (error) {
    return next(error);
  }
});

contractsRouter.post("/dev/invoices/:invoiceId/resend-dm", requireDevAccess, async (req, res, next) => {
  try {
    const input = resendDmSchema.parse(req.body ?? {});
    const invoiceId = routeIdSchema.parse(req.params.invoiceId);
    return res.json({
      dm: await emitContractInvoiceDm(invoiceId, input.notificationType, res.locals.dashboardAuth?.user ?? null)
    });
  } catch (error) {
    return next(error);
  }
});

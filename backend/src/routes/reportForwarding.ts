import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { devBotRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";
import { canManageDashboardGuild, canReadDashboardGuild } from "../services/dashboardGuildAccessService";
import { canAccessDevBotGuild, canManageDevBotGuild, canUseDevBotModule } from "../services/devBotService";
import {
  createHierarchyForwardingRule,
  deleteHierarchyForwardingRule,
  duplicateHierarchyForwardingRule,
  listHierarchyForwardingRules,
  resolveHierarchyForwarding,
  updateHierarchyForwardingRule
} from "../services/hierarchyForwardingService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import { getGuildSettings, type ReportSystemCategoryDto } from "../services/settingsService";

export const reportForwardingRouter = Router();

const snowflake = z.string().regex(/^\d{5,32}$/);
const ruleSchema = z.object({
  denouncedRoleId: snowflake,
  destinationCategoryId: z.string().trim().min(1).max(120),
  enabled: z.boolean().optional()
});
const patchRuleSchema = ruleSchema.partial();
const resolveSchema = z.object({
  denouncedRoleIds: z.array(snowflake).min(1).max(50)
});

reportForwardingRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);

    if (!(await canRead(req, res, guildId, botId))) {
      return res.status(403).json({ message: "Voce nao tem permissao para visualizar o encaminhamento da Corregedoria." });
    }

    return res.json({ rules: await listHierarchyForwardingRules(guildId, botId) });
  } catch (error) {
    return next(error);
  }
});

reportForwardingRouter.post("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    const input = ruleSchema.parse(req.body ?? {});

    if (!(await canManage(req, res, guildId, botId))) {
      return res.status(403).json({ message: "Voce nao tem permissao para gerenciar o encaminhamento da Corregedoria." });
    }

    const rule = await createHierarchyForwardingRule(guildId, botId, input, actorId(res));
    await emitForwardingUpdate(guildId, botId);

    return res.status(201).json({ rule });
  } catch (error) {
    return next(error);
  }
});

reportForwardingRouter.patch("/:guildId/:ruleId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    const ruleId = z.string().min(1).max(120).parse(req.params.ruleId);
    const input = patchRuleSchema.parse(req.body ?? {});

    if (!(await canManage(req, res, guildId, botId))) {
      return res.status(403).json({ message: "Voce nao tem permissao para gerenciar o encaminhamento da Corregedoria." });
    }

    const rule = await updateHierarchyForwardingRule(guildId, botId, ruleId, input, actorId(res));
    await emitForwardingUpdate(guildId, botId);

    return res.json({ rule });
  } catch (error) {
    return next(error);
  }
});

reportForwardingRouter.post("/:guildId/:ruleId/duplicate", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    const ruleId = z.string().min(1).max(120).parse(req.params.ruleId);

    if (!(await canManage(req, res, guildId, botId))) {
      return res.status(403).json({ message: "Voce nao tem permissao para gerenciar o encaminhamento da Corregedoria." });
    }

    const rule = await duplicateHierarchyForwardingRule(guildId, botId, ruleId, actorId(res));
    await emitForwardingUpdate(guildId, botId);

    return res.status(201).json({ rule });
  } catch (error) {
    return next(error);
  }
});

reportForwardingRouter.delete("/:guildId/:ruleId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    const ruleId = z.string().min(1).max(120).parse(req.params.ruleId);

    if (!(await canManage(req, res, guildId, botId))) {
      return res.status(403).json({ message: "Voce nao tem permissao para gerenciar o encaminhamento da Corregedoria." });
    }

    await deleteHierarchyForwardingRule(guildId, botId, ruleId, actorId(res));
    await emitForwardingUpdate(guildId, botId);

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

reportForwardingRouter.post("/bot/:guildId/resolve", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    const input = resolveSchema.parse(req.body ?? {});
    const settings = await getGuildSettings(guildId, botId);
    const categoryRule = resolveCategoryEscalation(guildId, botId, settings.reportSystem.categories, input.denouncedRoleIds);
    if (categoryRule) return res.json({ rule: categoryRule });

    const rule = await resolveHierarchyForwarding(guildId, botId, input.denouncedRoleIds);

    return res.json({ rule });
  } catch (error) {
    return next(error);
  }
});

async function canRead(_req: any, res: any, guildId: string, botId: string | null) {
  return canReadDashboardGuild(res.locals.dashboardAuth.user, guildId)
    || await canAccessDevBotGuild(res.locals.dashboardAuth.user, botId, guildId);
}

async function canManage(req: any, res: any, guildId: string, botId: string | null) {
  void req;
  const hasGuildAccess = canManageDashboardGuild(res.locals.dashboardAuth.user, guildId)
    || await canManageDevBotGuild(res.locals.dashboardAuth.user, botId, guildId);

  return hasGuildAccess
    && (
      !botId
      || await canUseDevBotModule(res.locals.dashboardAuth.user, botId, guildId, "police-iab")
      || await canUseDevBotModule(res.locals.dashboardAuth.user, botId, guildId, "tickets")
    );
}

function actorId(res: { locals: { dashboardAuth?: { user?: { discordId?: string | null; id?: string | null } } } }) {
  return res.locals.dashboardAuth?.user?.discordId ?? res.locals.dashboardAuth?.user?.id ?? null;
}

function resolveCategoryEscalation(
  guildId: string,
  botId: string | null,
  categories: ReportSystemCategoryDto[],
  denouncedRoleIds: string[]
) {
  const roleIds = new Set(denouncedRoleIds);
  const orderedCategories = [...categories].sort((left, right) => left.order - right.order);

  for (const category of orderedCategories) {
    if (!category.enabled) continue;
    const denouncedRoleId = category.responsibleRoleIds.find((roleId) => roleIds.has(roleId));
    if (!denouncedRoleId || !category.escalateToCategoryId) continue;

    const destination = categories.find((item) => item.enabled && item.id === category.escalateToCategoryId);
    if (!destination) continue;

    const now = new Date().toISOString();
    return {
      botId,
      createdAt: now,
      createdById: null,
      denouncedRoleId,
      destinationCategoryId: destination.id,
      enabled: true,
      guildId,
      id: `report-category:${category.id}:${destination.id}`,
      updatedAt: now,
      updatedById: null
    };
  }

  return null;
}

async function emitForwardingUpdate(guildId: string, botId: string | null) {
  if (botId) {
    emitRealtimeToRoom(devBotRealtimeRoom(botId), "corregedoria:forwarding_updated", { botId, guildId });
  }
}

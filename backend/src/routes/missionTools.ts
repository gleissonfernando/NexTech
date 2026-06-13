import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { areGuildAssignableRoles, areGuildRoles, getGuildLiveOptions, isGuildTextChannel, validateGuildPanelChannel } from "../services/discordOptionsService";
import { canReadDevBotModule, canUseDevBotModule, getBotApiPermissions, getDevBotToken } from "../services/devBotService";
import {
  cancelMissionToolMission,
  completeMissionToolMission,
  createMissionToolMission,
  getActiveMissionToolMission,
  getMissionToolMission,
  getMissionToolsDashboard,
  getMissionToolsSettings,
  joinMissionToolMission,
  leaveMissionToolMission,
  listActiveMissionToolsSettings,
  requestMissionToolsPanelPublish,
  saveMissionToolsSettings,
  startMissionToolMission,
  updateMissionToolsPanelMessageState
} from "../services/missionToolsService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import type { AuthSessionUser } from "../types/session";

const MODULE_ID = "mission-tools";
const guildIdSchema = z.string().regex(/^\d{5,32}$/);
const snowflakeSchema = z.string().regex(/^\d{5,32}$/);
const optionalSnowflakeSchema = z.union([snowflakeSchema, z.literal(""), z.null()]).optional();
const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  panelChannelId: optionalSnowflakeSchema,
  logChannelId: optionalSnowflakeSchema,
  managerRoleIds: z.array(snowflakeSchema).max(100).optional(),
  participantRoleIds: z.array(snowflakeSchema).max(100).optional(),
  completionRoleId: optionalSnowflakeSchema,
  messages: z.object({
    panelTitle: z.string().max(120).optional(),
    panelDescription: z.string().max(1000).optional(),
    joinSuccess: z.string().max(500).optional(),
    leaveSuccess: z.string().max(500).optional(),
    missionStarted: z.string().max(500).optional(),
    missionCompleted: z.string().max(500).optional()
  }).partial().optional()
});
const createMissionSchema = z.object({
  description: z.string().max(1000).nullable().optional(),
  participantLimit: z.coerce.number().int().min(0).max(500).nullable().optional(),
  title: z.string().min(1).max(120)
});
const botPanelStateSchema = z.object({
  guildId: guildIdSchema,
  messageId: optionalSnowflakeSchema
});
const botCreateMissionSchema = createMissionSchema.extend({
  guildId: guildIdSchema,
  createdBy: snowflakeSchema.nullable().optional()
});
const botActorSchema = z.object({
  actorId: snowflakeSchema,
  actorRoleIds: z.array(snowflakeSchema).default([]),
  username: z.string().max(100).nullable().optional()
});

export const missionToolsRouter = Router();

missionToolsRouter.get("/bot/configs", requireBot, async (req, res, next) => {
  try {
    const botId = await readRequiredBotId(req);
    await assertBotMissionToolsLicense(botId);

    return res.json({
      configs: await listActiveMissionToolsSettings(botId)
    });
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.post("/bot/panel-state", requireBot, async (req, res, next) => {
  try {
    const input = botPanelStateSchema.parse(req.body);
    const botId = await readRequiredBotId(req);
    await assertBotMissionToolsLicense(botId);

    return res.json({
      settings: await updateMissionToolsPanelMessageState(botId, input.guildId, input.messageId ?? null)
    });
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.get("/bot/:guildId", requireBot, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    await assertBotMissionToolsLicense(botId);

    return res.json({
      settings: await getMissionToolsSettings(guildId, botId)
    });
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.get("/bot/:guildId/active", requireBot, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    await assertBotMissionToolsLicense(botId);

    return res.json({
      mission: await getActiveMissionToolMission(guildId, botId)
    });
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.post("/bot/missions", requireBot, async (req, res, next) => {
  try {
    const input = botCreateMissionSchema.parse(req.body);
    const botId = await readRequiredBotId(req);
    await assertBotMissionToolsLicense(botId);

    return res.status(201).json({
      mission: await createMissionToolMission({
        botId,
        createdBy: input.createdBy ?? null,
        description: input.description ?? null,
        guildId: input.guildId,
        participantLimit: input.participantLimit ?? 0,
        title: input.title
      })
    });
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.get("/bot/missions/:missionId", requireBot, async (req, res, next) => {
  try {
    const missionId = z.string().min(1).max(80).parse(req.params.missionId);
    const botId = await readRequiredBotId(req);
    await assertBotMissionToolsLicense(botId);
    const mission = await getMissionToolMission(missionId, botId);

    if (!mission) {
      return res.status(404).json({
        message: "Missao nao encontrada."
      });
    }

    return res.json({
      mission
    });
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.post("/bot/missions/:missionId/join", requireBot, async (req, res, next) => {
  try {
    const missionId = z.string().min(1).max(80).parse(req.params.missionId);
    const input = botActorSchema.parse(req.body);
    const botId = await readRequiredBotId(req);
    await assertBotMissionToolsLicense(botId);

    return res.json({
      mission: await joinMissionToolMission(missionId, botId, input)
    });
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.post("/bot/missions/:missionId/leave", requireBot, async (req, res, next) => {
  try {
    const missionId = z.string().min(1).max(80).parse(req.params.missionId);
    const input = botActorSchema.parse(req.body);
    const botId = await readRequiredBotId(req);
    await assertBotMissionToolsLicense(botId);

    return res.json({
      mission: await leaveMissionToolMission(missionId, botId, input)
    });
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.post("/bot/missions/:missionId/start", requireBot, async (req, res, next) => {
  try {
    const missionId = z.string().min(1).max(80).parse(req.params.missionId);
    const input = botActorSchema.parse(req.body);
    const botId = await readRequiredBotId(req);
    await assertBotMissionToolsLicense(botId);

    return res.json({
      mission: await startMissionToolMission(missionId, botId, input)
    });
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.post("/bot/missions/:missionId/complete", requireBot, async (req, res, next) => {
  try {
    const missionId = z.string().min(1).max(80).parse(req.params.missionId);
    const input = botActorSchema.parse(req.body);
    const botId = await readRequiredBotId(req);
    await assertBotMissionToolsLicense(botId);

    return res.json({
      mission: await completeMissionToolMission(missionId, botId, input)
    });
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.post("/bot/missions/:missionId/cancel", requireBot, async (req, res, next) => {
  try {
    const missionId = z.string().min(1).max(80).parse(req.params.missionId);
    const input = botActorSchema.parse(req.body);
    const botId = await readRequiredBotId(req);
    await assertBotMissionToolsLicense(botId);

    return res.json({
      mission: await cancelMissionToolMission(missionId, botId, input)
    });
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanReadMissionTools(user, guildId, botId);

    return res.json(await getMissionToolsDashboard(guildId, botId));
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.get("/:guildId/options", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanReadMissionTools(user, guildId, botId);

    return res.json({
      options: await getGuildLiveOptions(guildId, await getDevBotToken(botId))
    });
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.patch("/:guildId/settings", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    const input = settingsSchema.parse(req.body);

    await assertCanManageMissionTools(user, guildId, botId);
    await validateMissionToolsResources(guildId, botId, input);

    return res.json({
      settings: await saveMissionToolsSettings(guildId, botId, normalizeSettingsInput(input), user.discordId)
    });
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.post("/:guildId/panel", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageMissionTools(user, guildId, botId);
    const settings = await getMissionToolsSettings(guildId, botId);

    if (settings.panelChannelId) {
      await assertPanelChannelReady(guildId, botId, settings.panelChannelId);
    }

    return res.json({
      settings: await requestMissionToolsPanelPublish(guildId, botId, user.discordId)
    });
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.post("/:guildId/missions", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    const input = createMissionSchema.parse(req.body);

    await assertCanManageMissionTools(user, guildId, botId);

    return res.status(201).json({
      mission: await createMissionToolMission({
        botId,
        createdBy: user.discordId,
        description: input.description ?? null,
        guildId,
        participantLimit: input.participantLimit ?? 0,
        title: input.title
      })
    });
  } catch (error) {
    return next(error);
  }
});

missionToolsRouter.post("/:guildId/missions/:missionId/start", requireAuth, async (req, res, next) => {
  return runDashboardMissionAction(req, res, next, "start");
});

missionToolsRouter.post("/:guildId/missions/:missionId/complete", requireAuth, async (req, res, next) => {
  return runDashboardMissionAction(req, res, next, "complete");
});

missionToolsRouter.post("/:guildId/missions/:missionId/cancel", requireAuth, async (req, res, next) => {
  return runDashboardMissionAction(req, res, next, "cancel");
});

async function runDashboardMissionAction(
  req: Request,
  res: Response,
  next: NextFunction,
  action: "start" | "complete" | "cancel"
) {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const missionId = z.string().min(1).max(80).parse(req.params.missionId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageMissionTools(user, guildId, botId);

    const actor = {
      actorId: user.discordId,
      actorRoleIds: [],
      skipManagerCheck: true,
      username: user.globalName || user.username
    };
    const mission = action === "start"
      ? await startMissionToolMission(missionId, botId, actor)
      : action === "complete"
        ? await completeMissionToolMission(missionId, botId, actor)
        : await cancelMissionToolMission(missionId, botId, actor);

    return res.json({
      mission
    });
  } catch (error) {
    return next(error);
  }
}

async function readRequiredBotId(req: Parameters<typeof resolveRequestBotId>[0]) {
  const botId = await resolveRequestBotId(req);

  if (!botId) {
    throw createRouteError("Escolha um bot cadastrado para usar o Mission Tools.", 400);
  }

  return botId;
}

async function assertCanReadMissionTools(user: AuthSessionUser, guildId: string, botId: string) {
  await assertBotMissionToolsLicense(botId);

  if (await canReadDevBotModule(user, botId, guildId, MODULE_ID)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para acessar o Mission Tools deste bot.", 403);
}

async function assertCanManageMissionTools(user: AuthSessionUser, guildId: string, botId: string) {
  await assertBotMissionToolsLicense(botId);

  if (await canUseDevBotModule(user, botId, guildId, MODULE_ID)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para configurar o Mission Tools deste bot.", 403);
}

async function assertBotMissionToolsLicense(botId: string) {
  const permissions = await getBotApiPermissions(botId);

  if (!permissions) {
    throw createRouteError("Bot nao encontrado.", 404);
  }

  if (!permissions.enabledModules.includes(MODULE_ID)) {
    throw createRouteError("O Mission Tools nao foi liberado para este bot.", 403);
  }
}

async function validateMissionToolsResources(guildId: string, botId: string, input: z.infer<typeof settingsSchema>) {
  const botToken = await getDevBotToken(botId);
  const channelIds = [
    input.panelChannelId,
    input.logChannelId
  ].filter((channelId): channelId is string => typeof channelId === "string" && Boolean(channelId));

  const channelChecks = await Promise.all(
    [...new Set(channelIds)].map((channelId) => isGuildTextChannel(guildId, channelId, botToken))
  );

  if (!channelChecks.every(Boolean)) {
    throw createRouteError("Um dos canais selecionados nao pertence a este servidor.", 400);
  }

  if (input.panelChannelId) {
    await assertPanelChannelReady(guildId, botId, input.panelChannelId);
  }

  const roleIds = [
    ...(input.managerRoleIds ?? []),
    ...(input.participantRoleIds ?? []),
    input.completionRoleId
  ].filter((roleId): roleId is string => typeof roleId === "string" && Boolean(roleId));

  if (roleIds.length && !(await areGuildRoles(guildId, [...new Set(roleIds)], botToken))) {
    throw createRouteError("Um dos cargos selecionados nao pertence a este servidor.", 400);
  }

  if (input.completionRoleId && !(await areGuildAssignableRoles(guildId, [input.completionRoleId], botToken))) {
    throw createRouteError("O cargo de conclusao precisa ficar abaixo do cargo do bot e o bot precisa gerenciar cargos.", 400);
  }
}

async function assertPanelChannelReady(guildId: string, botId: string, channelId: string) {
  const validation = await validateGuildPanelChannel(guildId, channelId, await getDevBotToken(botId));

  if (!validation.ok) {
    throw createRouteError(
      validation.reason ?? "Nao foi possivel validar as permissoes do bot no canal do painel.",
      400
    );
  }
}

function normalizeSettingsInput(input: z.infer<typeof settingsSchema>) {
  const normalized = {
    ...input,
  };

  if ("completionRoleId" in input) {
    normalized.completionRoleId = normalizeOptionalId(input.completionRoleId);
  }

  if ("logChannelId" in input) {
    normalized.logChannelId = normalizeOptionalId(input.logChannelId);
  }

  if ("panelChannelId" in input) {
    normalized.panelChannelId = normalizeOptionalId(input.panelChannelId);
  }

  return normalized;
}

function normalizeOptionalId(value: string | null | undefined) {
  return value?.trim() || null;
}

function createRouteError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}

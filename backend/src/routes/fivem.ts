import { Router, raw } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { canReadDevBotModule, canUseDevBotModule, getBotApiPermissions, getDevBotToken } from "../services/devBotService";
import { areGuildAssignableRoles, areGuildRoles, getGuildLiveOptions, isGuildTextChannel, validateGuildPanelChannel } from "../services/discordOptionsService";
import {
    approveFivemFacAbsence,
    closeFivemFacAbsence,
    createFivemFacAbsence,
    getFivemFacAbsence,
    getFivemFacDashboard,
    getFivemFacSettings,
    listActiveFivemFacSettings,
    listFivemFacDueAbsences,
    listFivemFacUserAbsences,
    markFivemFacAbsenceFinished,
    markFivemFacAbsenceStarted,
    rejectFivemFacAbsence,
    requestFivemFacPanelPublish,
    saveFivemFacAbsencePhotoFile,
    saveFivemFacPanelImageFile,
    saveFivemFacSettings,
    updateFivemFacAbsenceChannel,
    updateFivemFacAbsencePhoto,
    updateFivemFacPanelMessageState
} from "../services/fivemFacService";
import { listFivemModules } from "../services/fivemModuleService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import type { AuthSessionUser } from "../types/session";

const guildIdSchema = z.string().regex(/^\d{5,32}$/);
const snowflakeSchema = z.string().regex(/^\d{5,32}$/);
const optionalSnowflakeSchema = z.union([snowflakeSchema, z.literal(""), z.null()]).optional();
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const facSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  panelChannelId: optionalSnowflakeSchema,
  absenceRoleId: optionalSnowflakeSchema,
  viewerRoleIds: z.array(snowflakeSchema).optional(),
  approverRoleIds: z.array(snowflakeSchema).optional(),
  memberRoleIds: z.array(snowflakeSchema).optional(),
  logChannelId: optionalSnowflakeSchema,
  messages: z.object({
    panelTitle: z.string().max(120).optional(),
    panelDescription: z.string().max(1000).optional(),
    requestCreated: z.string().max(500).optional(),
    approved: z.string().max(500).optional(),
    rejected: z.string().max(500).optional(),
    started: z.string().max(500).optional(),
    finished: z.string().max(500).optional()
  }).partial().optional(),
  panelVisual: z.object({
    panelColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    imageUrl: z.string().max(2048).nullable().optional(),
    imagePosition: z.enum(["right_small", "top", "bottom", "none"]).optional(),
    buttonsPosition: z.enum(["inside_panel", "outside_panel", "below", "rows", "none"]).optional(),
    buttons: z.array(z.object({
      id: z.string().max(40),
      label: z.string().min(1).max(80),
      emoji: z.string().max(40).nullable().optional(),
      style: z.enum(["primary", "secondary", "success", "danger", "link"]),
      type: z.enum(["action", "url"]),
      action: z.enum(["request_absence", "my_absences", "url"]),
      url: z.string().max(2048).nullable().optional(),
      order: z.coerce.number().int().min(0).max(100),
      enabled: z.boolean()
    })).max(10).optional(),
    componentsOrder: z.array(z.enum(["image", "text", "buttons"])).max(3).optional(),
    enabledSections: z.object({
      image: z.boolean().optional(),
      buttons: z.boolean().optional(),
      description: z.boolean().optional()
    }).partial().optional()
  }).partial().optional()
});
const createAbsenceSchema = z.object({
  guildId: guildIdSchema,
  userId: snowflakeSchema,
  username: z.string().max(100).nullable().optional(),
  reason: z.string().min(1).max(800),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  notes: z.string().max(1000).nullable().optional()
});
const userAbsenceSchema = z.object({
  guildId: guildIdSchema,
  userId: snowflakeSchema
});
const channelStateSchema = z.object({
  privateChannelId: optionalSnowflakeSchema,
  requestMessageId: optionalSnowflakeSchema
});
const panelStateSchema = z.object({
  messageId: optionalSnowflakeSchema
});
const moderationSchema = z.object({
  moderatorId: snowflakeSchema,
  moderatorRoleIds: z.array(snowflakeSchema).default([]),
  reason: z.string().max(800).nullable().optional()
});
const lifecycleSchema = z.object({
  roleAdded: z.boolean().optional(),
  roleRemoved: z.boolean().optional()
});
const facPhotoUpload = raw({
  limit: "10mb",
  type: ["image/gif", "image/jpeg", "image/png", "image/webp"]
});
const allowedFacPhotoMimeTypes = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const FAC_MODULE_IDS = ["fivem-absences", "fivem-fac"] as const;

export const fivemRouter = Router();

fivemRouter.get("/modules", requireAuth, async (_req, res, next) => {
  try {
    return res.json({
      modules: await listFivemModules()
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.get("/:guildId/fac", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanReadFac(user, guildId, botId);

    return res.json(await getFivemFacDashboard(guildId, botId));
  } catch (error) {
    return next(error);
  }
});

fivemRouter.get("/:guildId/fac/options", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanReadFac(user, guildId, botId);

    return res.json({
      options: await getGuildLiveOptions(guildId, await getDevBotToken(botId))
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.patch("/:guildId/fac", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    const input = facSettingsSchema.parse(req.body);

    await assertCanManageFac(user, guildId, botId);
    await validateFacResources(guildId, botId, input);

    return res.json({
      settings: await saveFivemFacSettings(guildId, botId, normalizeFacSettingsInput(input), user.discordId)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.post("/:guildId/fac/panel", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageFac(user, guildId, botId);
    const settings = await getFivemFacSettings(guildId, botId);

    if (settings.panelChannelId) {
      await assertPanelChannelReady(guildId, botId, settings.panelChannelId);
    }

    return res.json({
      settings: await requestFivemFacPanelPublish(guildId, botId, user.discordId)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.put("/:guildId/fac/panel-image", requireAuth, facPhotoUpload, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageFac(user, guildId, botId);
    const mimeType = req.header("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";

    if (!allowedFacPhotoMimeTypes.has(mimeType)) {
      throw createRouteError("Formato invalido. Envie PNG, JPG, JPEG, WEBP ou GIF.", 400);
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw createRouteError("Arquivo de imagem obrigatorio.", 400);
    }

    return res.json({
      settings: await saveFivemFacPanelImageFile(guildId, botId, req.body, mimeType, user.discordId)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.put("/:guildId/fac/absences/:absenceId/photo", requireAuth, facPhotoUpload, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const absenceId = z.string().min(1).parse(req.params.absenceId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageFac(user, guildId, botId);

    const mimeType = req.header("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";

    if (!allowedFacPhotoMimeTypes.has(mimeType)) {
      throw createRouteError("Formato invalido. Envie PNG, JPG, JPEG, WEBP ou GIF.", 400);
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw createRouteError("Arquivo de imagem obrigatorio.", 400);
    }

    const photoUrl = await saveFivemFacAbsencePhotoFile(guildId, absenceId, req.body, mimeType);

    return res.json({
      absence: await updateFivemFacAbsencePhoto(absenceId, botId, guildId, photoUrl)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.delete("/:guildId/fac/absences/:absenceId/photo", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const absenceId = z.string().min(1).parse(req.params.absenceId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageFac(user, guildId, botId);

    return res.json({
      absence: await updateFivemFacAbsencePhoto(absenceId, botId, guildId, null)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.get("/bot/fac/configs", requireBot, async (req, res, next) => {
  try {
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);

    return res.json({
      configs: await listActiveFivemFacSettings(botId)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.post("/bot/fac/panel-state", requireBot, async (req, res, next) => {
  try {
    const input = z.object({
      guildId: guildIdSchema,
      messageId: optionalSnowflakeSchema
    }).parse(req.body);
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);

    return res.json({
      settings: await updateFivemFacPanelMessageState(botId, input.guildId, input.messageId ?? null)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.get("/bot/fac/:guildId", requireBot, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);

    return res.json({
      settings: await getFivemFacSettings(guildId, botId)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.post("/bot/fac/absences", requireBot, async (req, res, next) => {
  try {
    const input = createAbsenceSchema.parse(req.body);
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);

    return res.status(201).json({
      absence: await createFivemFacAbsence({
        ...input,
        botId
      })
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.get("/bot/fac/absences/user", requireBot, async (req, res, next) => {
  try {
    const input = userAbsenceSchema.parse(req.query);
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);

    return res.json({
      absences: await listFivemFacUserAbsences(botId, input.guildId, input.userId)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.get("/bot/fac/absences/due", requireBot, async (req, res, next) => {
  try {
    const today = typeof req.query.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.today)
      ? req.query.today
      : undefined;
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);

    return res.json({
      absences: await listFivemFacDueAbsences(botId, today)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.get("/bot/fac/absences/:absenceId", requireBot, async (req, res, next) => {
  try {
    const absenceId = z.string().min(1).parse(req.params.absenceId);
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);
    const absence = await getFivemFacAbsence(absenceId, botId);

    if (!absence) {
      return res.status(404).json({
        message: "Ausencia nao encontrada."
      });
    }

    return res.json({
      absence
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.patch("/bot/fac/absences/:absenceId/channel", requireBot, async (req, res, next) => {
  try {
    const absenceId = z.string().min(1).parse(req.params.absenceId);
    const input = channelStateSchema.parse(req.body);
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);

    return res.json({
      absence: await updateFivemFacAbsenceChannel(absenceId, botId, input)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.post("/bot/fac/absences/:absenceId/approve", requireBot, async (req, res, next) => {
  try {
    const absenceId = z.string().min(1).parse(req.params.absenceId);
    const input = moderationSchema.parse(req.body);
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);

    return res.json({
      absence: await approveFivemFacAbsence({
        absenceId,
        botId,
        moderatorId: input.moderatorId,
        moderatorRoleIds: input.moderatorRoleIds
      })
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.post("/bot/fac/absences/:absenceId/reject", requireBot, async (req, res, next) => {
  try {
    const absenceId = z.string().min(1).parse(req.params.absenceId);
    const input = moderationSchema.parse(req.body);
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);

    return res.json({
      absence: await rejectFivemFacAbsence({
        absenceId,
        botId,
        moderatorId: input.moderatorId,
        moderatorRoleIds: input.moderatorRoleIds,
        reason: input.reason ?? null
      })
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.post("/bot/fac/absences/:absenceId/close", requireBot, async (req, res, next) => {
  try {
    const absenceId = z.string().min(1).parse(req.params.absenceId);
    const input = moderationSchema.extend({
      roleRemoved: z.boolean().optional()
    }).parse(req.body);
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);

    return res.json({
      absence: await closeFivemFacAbsence({
        absenceId,
        botId,
        moderatorId: input.moderatorId,
        moderatorRoleIds: input.moderatorRoleIds,
        reason: input.reason ?? null,
        roleRemoved: input.roleRemoved === true
      })
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.post("/bot/fac/absences/:absenceId/start", requireBot, async (req, res, next) => {
  try {
    const absenceId = z.string().min(1).parse(req.params.absenceId);
    const input = lifecycleSchema.parse(req.body ?? {});
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);

    return res.json({
      absence: await markFivemFacAbsenceStarted(absenceId, botId, input.roleAdded !== false)
    });
  } catch (error) {
    return next(error);
  }
});

fivemRouter.post("/bot/fac/absences/:absenceId/finish", requireBot, async (req, res, next) => {
  try {
    const absenceId = z.string().min(1).parse(req.params.absenceId);
    const input = lifecycleSchema.parse(req.body ?? {});
    const botId = await readRequiredBotId(req);
    await assertBotFacLicense(botId);

    return res.json({
      absence: await markFivemFacAbsenceFinished(absenceId, botId, input.roleRemoved !== false)
    });
  } catch (error) {
    return next(error);
  }
});

async function readRequiredBotId(req: Parameters<typeof resolveRequestBotId>[0]) {
  const botId = await resolveRequestBotId(req);

  if (!botId) {
    throw createRouteError("Bot vinculado obrigatorio para o modulo FiveM.", 400);
  }

  return botId;
}

async function assertCanReadFac(user: AuthSessionUser, guildId: string, botId: string) {
  await assertBotFacLicense(botId);

  if (await canReadAnyFacModule(user, guildId, botId)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para acessar o FAC deste bot.", 403);
}

async function assertCanManageFac(user: AuthSessionUser, guildId: string, botId: string) {
  await assertBotFacLicense(botId);

  if (await canUseAnyFacModule(user, guildId, botId)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para configurar o FAC deste bot.", 403);
}

async function assertBotFacLicense(botId: string) {
  const permissions = await getBotApiPermissions(botId);

  if (!permissions) {
    throw createRouteError("Bot nao encontrado.", 404);
  }

  if (!hasAnyFacModule(permissions.enabledModules)) {
    throw createRouteError("O sistema FAC nao foi liberado para este cliente FiveM.", 403);
  }
}

async function canReadAnyFacModule(user: AuthSessionUser, guildId: string, botId: string) {
  const checks = await Promise.all(
    FAC_MODULE_IDS.map((moduleId) => canReadDevBotModule(user, botId, guildId, moduleId))
  );

  return checks.some(Boolean);
}

async function canUseAnyFacModule(user: AuthSessionUser, guildId: string, botId: string) {
  const checks = await Promise.all(
    FAC_MODULE_IDS.map((moduleId) => canUseDevBotModule(user, botId, guildId, moduleId))
  );

  return checks.some(Boolean);
}

function hasAnyFacModule(enabledModules: string[]) {
  return FAC_MODULE_IDS.some((moduleId) => enabledModules.includes(moduleId));
}

async function validateFacResources(guildId: string, botId: string, input: z.infer<typeof facSettingsSchema>) {
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
    input.absenceRoleId,
    ...(input.viewerRoleIds ?? []),
    ...(input.approverRoleIds ?? []),
    ...(input.memberRoleIds ?? [])
  ].filter((roleId): roleId is string => typeof roleId === "string" && Boolean(roleId));

  if (roleIds.length && !(await areGuildRoles(guildId, [...new Set(roleIds)], botToken))) {
    throw createRouteError("Um dos cargos selecionados nao pertence a este servidor.", 400);
  }

  if (
    input.absenceRoleId
    && !(await areGuildAssignableRoles(guildId, [input.absenceRoleId], botToken))
  ) {
    throw createRouteError("O cargo de ausencia precisa ficar abaixo do cargo do bot e o bot precisa gerenciar cargos.", 400);
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

function normalizeFacSettingsInput(input: z.infer<typeof facSettingsSchema>) {
  const normalized: any = {
    ...input
  };

  if ("absenceRoleId" in input) {
    normalized.absenceRoleId = normalizeOptionalId(input.absenceRoleId);
  }

  if ("logChannelId" in input) {
    normalized.logChannelId = normalizeOptionalId(input.logChannelId);
  }

  if ("panelChannelId" in input) {
    normalized.panelChannelId = normalizeOptionalId(input.panelChannelId);
  }

  if (normalized.panelVisual?.buttons) {
    normalized.panelVisual = {
      ...normalized.panelVisual,
      buttons: normalized.panelVisual.buttons.map((button: any) => ({
        id: button.id,
        type: button.type,
        action: button.action,
        enabled: button.enabled,
        label: button.label,
        style: button.style,
        order: button.order,
        emoji: button.emoji ?? null,
        url: button.url ?? null
      }))
    };
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

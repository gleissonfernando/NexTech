import { Router } from "express";
import { z } from "zod";
import { emitRealtime } from "../realtime/events";
import { requireAuth, requireBot } from "../middleware/auth";
import { canUseDevBotModule, getDevBotToken } from "../services/devBotService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import {
  createApplicationEmojiZip,
  getApplicationEmojiPage,
  getApplicationEmojiSettings,
  handleApplicationEmojiGuildEvent,
  refreshApplicationEmojis,
  removeAllApplicationEmojis,
  saveApplicationEmojiSettings,
  syncGuildEmojisToApplication
} from "../services/applicationEmojiService";
import { createEmojiLibraryZip, listEmojiLibrary, recordEmojiCloneJob } from "../services/emojiCloneService";

const itemSchema = z.object({
  originalEmojiId: z.string().min(1).max(64),
  originalName: z.string().min(1).max(64),
  originalUrl: z.string().max(2048).nullable().optional(),
  newEmojiId: z.string().max(64).nullable().optional(),
  newName: z.string().max(64).nullable().optional(),
  animated: z.boolean(),
  status: z.enum(["pending", "success", "failed"]),
  errorReason: z.string().max(500).nullable().optional()
});

const jobSchema = z.object({
  guildId: z.string().regex(/^\d{5,32}$/),
  userId: z.string().regex(/^\d{5,32}$/),
  sourceGuildId: z.string().regex(/^\d{5,32}$/).nullable().optional(),
  status: z.enum(["pending", "running", "completed", "cancelled"]),
  total: z.number().int().min(0).max(100),
  success: z.number().int().min(0).max(100),
  failed: z.number().int().min(0).max(100),
  prefix: z.string().max(24).nullable().optional(),
  createdAt: z.string().datetime().nullable().optional(),
  finishedAt: z.string().datetime().nullable().optional(),
  items: z.array(itemSchema).max(100)
});
const cloneSchema = z.object({
  image: z.string().min(1).max(1_000_000),
  name: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_]+$/),
  sourceLabel: z.string().max(120).nullable().optional()
});
const libraryQuerySchema = z.object({
  animated: z.enum(["all", "true", "false"]).optional().default("all"),
  q: z.string().max(80).optional()
});
const applicationEmojiQuerySchema = z.object({
  animated: z.enum(["all", "true", "false"]).optional().default("all"),
  q: z.string().max(80).optional(),
  sort: z.enum(["date", "name", "size"]).optional().default("date")
});
const applicationSyncSchema = z.object({
  guildId: z.string().regex(/^\d{5,32}$/)
});
const applicationSettingsSchema = z.object({
  autoSync: z.boolean()
});
const applicationBotEventSchema = z.object({
  action: z.enum(["created", "updated", "deleted"]),
  animated: z.boolean().optional().default(false),
  emojiId: z.string().regex(/^\d{5,32}$/),
  guildId: z.string().regex(/^\d{5,32}$/),
  name: z.string().min(1).max(64)
});
const resendSchema = z.object({
  guildId: z.string().regex(/^\d{5,32}$/),
  name: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_]+$/).optional()
});
const fakeTokenSchema = z.object({
  sourceGuildId: z.string().regex(/^\d{5,32}$/),
  targetGuildId: z.string().regex(/^\d{5,32}$/),
  token: z.string().min(1).max(512)
});
const botTokenSchema = z.object({
  sourceGuildId: z.string().regex(/^\d{5,32}$/),
  targetGuildId: z.string().regex(/^\d{5,32}$/),
  token: z.string().min(1).max(512)
});
const bulkCloneSchema = botTokenSchema.extend({
  emojis: z.array(z.object({
    animated: z.boolean(),
    id: z.string().regex(/^\d{5,32}$/),
    name: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_]+$/),
    url: z.string().url().max(500)
  })).min(1).max(50),
  prefix: z.string().max(24).nullable().optional()
});
const emojiCloneQueues = new Map<string, Promise<unknown>>();

export const emojiClonerRouter = Router();

emojiClonerRouter.post("/application/bot/guild-event", requireBot, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const input = applicationBotEventSchema.parse(req.body);

    if (!botId) {
      return res.status(400).json({ message: "Bot nao identificado." });
    }

    return res.json(await handleApplicationEmojiGuildEvent({
      action: input.action,
      animated: input.animated,
      botId,
      emojiId: input.emojiId,
      guildId: input.guildId,
      name: input.name
    }));
  } catch (error) {
    return next(error);
  }
});

emojiClonerRouter.post("/bot-token/validate", requireAuth, async (req, res, next) => {
  try {
    const input = botTokenSchema.parse(req.body);
    const user = res.locals.dashboardAuth.user;
    const token = normalizeDiscordBotToken(input.token, user.discordId, input.targetGuildId);

    await createEmojiCloneLog(null, input.targetGuildId, user.discordId, "emoji_clone.token.validating", "[INFO] Validando token do bot.").catch(() => undefined);
    const validation = await validateEmojiBotToken(token, input.sourceGuildId, input.targetGuildId);
    await createEmojiCloneLog(null, input.targetGuildId, user.discordId, "emoji_clone.token.validated", "[INFO] Token validado com sucesso.").catch(() => undefined);

    return res.json(validation);
  } catch (error) {
    return next(error);
  }
});

emojiClonerRouter.post("/bot-token/emojis", requireAuth, async (req, res, next) => {
  try {
    const input = botTokenSchema.parse(req.body);
    const user = res.locals.dashboardAuth.user;
    const token = normalizeDiscordBotToken(input.token, user.discordId, input.targetGuildId);

    await validateEmojiBotToken(token, input.sourceGuildId, input.targetGuildId);
    await createEmojiCloneLog(null, input.targetGuildId, user.discordId, "emoji_clone.fetch.started", `[INFO] Buscando emojis do servidor ${input.sourceGuildId}.`).catch(() => undefined);
    const emojis = await fetchGuildEmojis(input.sourceGuildId, token);
    await createEmojiCloneLog(null, input.targetGuildId, user.discordId, "emoji_clone.fetch.completed", `[INFO] ${emojis.length} emojis encontrados.`).catch(() => undefined);

    return res.json({ emojis });
  } catch (error) {
    return next(error);
  }
});

emojiClonerRouter.post("/bot-token/clone-selected", requireAuth, async (req, res, next) => {
  try {
    const input = bulkCloneSchema.parse(req.body);
    const user = res.locals.dashboardAuth.user;
    const botId = await resolveRequestBotId(req);

    if (botId && !(await canUseDevBotModule(user, botId, input.targetGuildId, "emoji-cloner"))) {
      return res.status(403).json({ message: "Modulo de clonagem de emojis nao liberado para este bot neste servidor." });
    }

    const token = normalizeDiscordBotToken(input.token, user.discordId, input.targetGuildId);
    const queueKey = `${user.discordId}:${input.targetGuildId}`;
    const previous = emojiCloneQueues.get(queueKey) ?? Promise.resolve();
    const task = previous
      .catch(() => undefined)
      .then(() => cloneSelectedEmojisWithBotToken({
        botId,
        prefix: input.prefix ?? null,
        sourceGuildId: input.sourceGuildId,
        targetGuildId: input.targetGuildId,
        token,
        userId: user.discordId,
        emojis: input.emojis
      }))
      .finally(() => {
        if (emojiCloneQueues.get(queueKey) === task) {
          emojiCloneQueues.delete(queueKey);
        }
      });

    emojiCloneQueues.set(queueKey, task);
    return res.json(await task);
  } catch (error) {
    return next(error);
  }
});

emojiClonerRouter.post("/fake-token/validate", requireAuth, async (req, res, next) => {
  try {
    const input = fakeTokenSchema.parse(req.body);
    const enabled = process.env.ENABLE_FAKE_EMOJI_CLONE_TOKEN === "true";
    const prefix = process.env.FAKE_TOKEN_PREFIX?.trim() || "FAKE_USER_TOKEN_";

    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({
        message: "Modo de teste indisponivel em producao."
      });
    }

    if (!enabled) {
      return res.status(403).json({
        message: "Sistema de token  para clonagem de emojis esta desativado."
      });
    }

    if (looksLikeDiscordUserToken(input.token) || !input.token.startsWith(prefix)) {
      return res.status(400).json({
        message: "Token de usuario invalido."
      });
    }

    await recordEmojiCloneTestLog({
      sourceGuildId: input.sourceGuildId,
      targetGuildId: input.targetGuildId,
      tokenMasked: maskFakeToken(input.token, prefix),
      userId: res.locals.dashboardAuth.user.discordId
    }).catch(() => undefined);

    return res.json({
      accepted: true,
      message: "Token do usuario aceito. Modo de teste ativado para clonagem de emojis.",
      tokenMasked: maskFakeToken(input.token, prefix)
    });
  } catch (error) {
    return next(error);
  }
});

emojiClonerRouter.post("/:guildId/clone", requireAuth, async (req, res, next) => {
  try {
    const { guildId } = req.params;
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user;
    const input = cloneSchema.parse(req.body);

    if (!guildId) {
      return res.status(400).json({ message: "guildId obrigatorio." });
    }

    if (!botId || !(await canUseDevBotModule(user, botId, guildId, "emoji-cloner"))) {
      return res.status(403).json({ message: "Modulo de clonagem de emojis nao liberado para este bot neste servidor." });
    }

    return res.json(await cloneEmojiForDashboard({
      botId,
      guildId,
      image: input.image,
      name: input.name,
      sourceLabel: input.sourceLabel ?? null,
      userId: user.discordId
    }));
  } catch (error) {
    return next(error);
  }
});

emojiClonerRouter.get("/application", requireAuth, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const input = applicationEmojiQuerySchema.parse(req.query);

    if (!botId) {
      return res.status(400).json({ message: "Selecione um bot do Portal do Desenvolvedor." });
    }

    const animated = input.animated === "all" ? null : input.animated === "true";
    return res.json(await getApplicationEmojiPage({
      animated,
      botId,
      query: input.q,
      sort: input.sort
    }));
  } catch (error) {
    return next(error);
  }
});

emojiClonerRouter.post("/application/sync", requireAuth, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user;
    const input = applicationSyncSchema.parse(req.body);

    if (!botId || !(await canUseDevBotModule(user, botId, input.guildId, "emoji-cloner"))) {
      return res.status(403).json({ message: "Modulo de emojis nao liberado para este bot neste servidor." });
    }

    return res.json(await syncGuildEmojisToApplication({
      botId,
      guildId: input.guildId,
      userId: user.discordId
    }));
  } catch (error) {
    return next(error);
  }
});

emojiClonerRouter.post("/application/refresh", requireAuth, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user;

    if (!botId) {
      return res.status(400).json({ message: "Selecione um bot do Portal do Desenvolvedor." });
    }

    return res.json(await refreshApplicationEmojis({
      botId,
      userId: user.discordId
    }));
  } catch (error) {
    return next(error);
  }
});

emojiClonerRouter.delete("/application", requireAuth, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user;

    if (!botId) {
      return res.status(400).json({ message: "Selecione um bot do Portal do Desenvolvedor." });
    }

    return res.json(await removeAllApplicationEmojis({
      botId,
      userId: user.discordId
    }));
  } catch (error) {
    return next(error);
  }
});

emojiClonerRouter.get("/application/download", requireAuth, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const guildId = typeof req.query.guildId === "string" ? req.query.guildId : null;

    if (!botId) {
      return res.status(400).json({ message: "Selecione um bot do Portal do Desenvolvedor." });
    }

    const zip = await createApplicationEmojiZip({
      botId,
      guildId
    });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=\"application-emojis.zip\"");
    res.setHeader("Cache-Control", "no-store");
    return res.send(zip.buffer);
  } catch (error) {
    return next(error);
  }
});

emojiClonerRouter.get("/application/settings/:guildId", requireAuth, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const guildId = z.string().regex(/^\d{5,32}$/).parse(req.params.guildId);

    if (!botId) {
      return res.status(400).json({ message: "Selecione um bot do Portal do Desenvolvedor." });
    }

    return res.json({ settings: await getApplicationEmojiSettings(botId, guildId) });
  } catch (error) {
    return next(error);
  }
});

emojiClonerRouter.patch("/application/settings/:guildId", requireAuth, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user;
    const guildId = z.string().regex(/^\d{5,32}$/).parse(req.params.guildId);
    const input = applicationSettingsSchema.parse(req.body);

    if (!botId || !(await canUseDevBotModule(user, botId, guildId, "emoji-cloner"))) {
      return res.status(403).json({ message: "Modulo de emojis nao liberado para este bot neste servidor." });
    }

    return res.json({
      settings: await saveApplicationEmojiSettings({
        autoSync: input.autoSync,
        botId,
        guildId,
        userId: user.discordId
      })
    });
  } catch (error) {
    return next(error);
  }
});

emojiClonerRouter.get("/library", requireAuth, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user;
    const input = libraryQuerySchema.parse(req.query);

    if (!botId) {
      return res.status(400).json({ message: "Selecione um bot do Portal do Desenvolvedor." });
    }

    const animated = input.animated === "all" ? null : input.animated === "true";

    return res.json({
      items: await listEmojiLibrary({
        animated,
        botId,
        query: input.q,
        userId: user.discordId
      })
    });
  } catch (error) {
    return next(error);
  }
});

emojiClonerRouter.get("/library/download", requireAuth, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user;
    const guildId = typeof req.query.guildId === "string" ? req.query.guildId : null;

    if (!botId) {
      return res.status(400).json({ message: "Selecione um bot do Portal do Desenvolvedor." });
    }

    const zip = await createEmojiLibraryZip({
      botId,
      guildId,
      userId: user.discordId
    });

    await createEmojiCloneLog(botId, guildId ?? "global", user.discordId, "emoji_clone.download", `Download realizado: ${zip.count} emoji(s).`).catch(() => undefined);

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=\"emojis.zip\"");
    res.setHeader("Cache-Control", "no-store");
    return res.send(zip.buffer);
  } catch (error) {
    return next(error);
  }
});

emojiClonerRouter.post("/library/:emojiId/resend", requireAuth, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user;
    const input = resendSchema.parse(req.body);

    if (!botId || !(await canUseDevBotModule(user, botId, input.guildId, "emoji-cloner"))) {
      return res.status(403).json({ message: "Modulo de clonagem de emojis nao liberado para este bot neste servidor." });
    }

    const library = await listEmojiLibrary({
      botId,
      query: null,
      userId: user.discordId
    });
    const item = library.find((entry) => entry.id === req.params.emojiId);

    if (!item) {
      return res.status(404).json({ message: "Emoji nao encontrado na sua Biblioteca." });
    }

    return res.json(await cloneEmojiForDashboard({
      botId,
      guildId: input.guildId,
      image: item.url,
      name: input.name ?? item.name,
      sourceLabel: item.name,
      userId: user.discordId
    }));
  } catch (error) {
    return next(error);
  }
});

async function cloneEmojiForDashboard(input: {
  botId: string;
  guildId: string;
  image: string;
  name: string;
  sourceLabel: string | null;
  userId: string;
}) {
  const botToken = await getDevBotToken(input.botId);

  if (!botToken) {
    throw Object.assign(new Error("Bot sem credencial valida cadastrada."), { statusCode: 400 });
  }

  await createEmojiCloneLog(input.botId, input.guildId, input.userId, "emoji_clone.received", `Emoji recebido: ${input.name}.`);
  const resolved = await resolveEmojiImage(input.image);
  const existingEmoji = await findGuildEmojiByName(input.guildId, botToken, input.name);

  if (existingEmoji) {
    const job = await recordEmojiCloneJob({
      botId: input.botId,
      failed: 0,
      guildId: input.guildId,
      items: [{
        animated: Boolean(existingEmoji.animated ?? resolved.animated),
        newEmojiId: existingEmoji.id,
        newName: existingEmoji.name ?? input.name,
        originalEmojiId: resolved.originalEmojiId,
        originalName: input.sourceLabel ?? input.name,
        originalUrl: resolved.url,
        status: "success"
      }],
      status: "completed",
      success: 1,
      total: 1,
      userId: input.userId
    });

    emitRealtime("emoji-cloner:notification", {
      botId: input.botId,
      guildId: input.guildId,
      kind: "duplicate",
      message: "Emoji ja existente.",
      userId: input.userId
    });
    await createEmojiCloneLog(input.botId, input.guildId, input.userId, "emoji_clone.duplicate", `Emoji ja existente: ${input.name}.`);

    return {
      duplicate: true,
      emoji: existingEmoji,
      job
    };
  }

  const response = await fetch(`https://discord.com/api/v10/guilds/${input.guildId}/emojis`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      image: resolved.dataUri,
      name: input.name
    })
  });

  const payload = await response.json().catch(() => null) as { id?: string; name?: string; animated?: boolean; message?: string } | null;

  if (!response.ok || !payload?.id) {
    emitRealtime("emoji-cloner:notification", {
      botId: input.botId,
      guildId: input.guildId,
      kind: "failed",
      message: "Falha ao importar.",
      userId: input.userId
    });
    await createEmojiCloneLog(input.botId, input.guildId, input.userId, "emoji_clone.failed", friendlyDiscordEmojiError(payload?.message, response.status));

    throw Object.assign(new Error(friendlyDiscordEmojiError(payload?.message, response.status)), {
      statusCode: response.status === 403 ? 403 : 400
    });
  }

  const job = await recordEmojiCloneJob({
    botId: input.botId,
    failed: 0,
    guildId: input.guildId,
    items: [{
      animated: Boolean(payload.animated),
      newEmojiId: payload.id,
      newName: payload.name ?? input.name,
      originalEmojiId: resolved.originalEmojiId,
      originalName: input.sourceLabel ?? input.name,
      originalUrl: resolved.url,
      status: "success"
    }],
    status: "completed",
    success: 1,
    total: 1,
    userId: input.userId
  });

  emitRealtime("emoji-cloner:notification", {
    botId: input.botId,
    guildId: input.guildId,
    kind: "success",
    message: "Emoji enviado para o servidor e salvo na Biblioteca.",
    userId: input.userId
  });
  await createEmojiCloneLog(input.botId, input.guildId, input.userId, "emoji_clone.sent", `Emoji enviado ao servidor: ${payload.name ?? input.name}.`);

  return {
    duplicate: false,
    emoji: payload,
    job
  };
}

emojiClonerRouter.post("/bot/jobs", requireBot, async (req, res, next) => {
  try {
    const input = jobSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    const job = await recordEmojiCloneJob({
      ...input,
      botId
    });

    return res.json({ job });
  } catch (error) {
    return next(error);
  }
});

async function resolveEmojiImage(value: string): Promise<{
  animated: boolean;
  dataUri: string;
  originalEmojiId: string;
  url: string;
}> {
  const trimmed = value.trim();
  const custom = trimmed.match(/^<(?<animated>a?):(?<name>[a-zA-Z0-9_]{2,32}):(?<id>\d{5,32})>$/);

  if (custom?.groups) {
    const animated = custom.groups.animated === "a";
    const url = `https://cdn.discordapp.com/emojis/${custom.groups.id}.${animated ? "gif" : "png"}?size=128&quality=lossless`;
    return {
      animated,
      dataUri: await downloadImageAsDataUri(url),
      originalEmojiId: custom.groups.id!,
      url
    };
  }

  if (/^data:image\/(png|gif|webp|jpe?g);base64,/i.test(trimmed)) {
    assertImageSize(trimmed);
    return {
      animated: /^data:image\/gif/i.test(trimmed),
      dataUri: trimmed,
      originalEmojiId: `upload:${createDataUriFingerprint(trimmed)}`,
      url: trimmed
    };
  }

  const url = trimmed.match(/^https:\/\/cdn\.discordapp\.com\/emojis\/\d{5,32}\.(?:png|gif|webp|jpg|jpeg)(?:\?[^\s]*)?$/i)
    ? trimmed
    : /^https?:\/\//i.test(trimmed)
      ? trimmed
      : null;

  if (!url) {
    throw Object.assign(new Error("Informe um upload, URL de imagem ou codigo de emoji valido."), { statusCode: 400 });
  }

  const idMatch = url.match(/\/emojis\/(?<id>\d{5,32})\.(?<ext>png|gif|webp|jpg|jpeg)/i);

  return {
    animated: idMatch?.groups?.ext?.toLowerCase() === "gif",
    dataUri: await downloadImageAsDataUri(url),
    originalEmojiId: idMatch?.groups?.id ?? `url:${createUrlFingerprint(url)}`,
    url
  };
}

async function validateEmojiBotToken(token: string, sourceGuildId: string, targetGuildId: string) {
  const bot = await discordJson<{ id: string; username?: string }>("/users/@me", token, {
    label: "validar token"
  }).catch((error) => {
    throw Object.assign(new Error(discordFriendlyError(error, "Token inválido.")), { statusCode: 400 });
  });
  const [sourceEmojis, targetGuild] = await Promise.all([
    fetchGuildEmojis(sourceGuildId, token).catch((error) => {
      throw Object.assign(new Error(discordFriendlyError(error, "Servidor de origem não encontrado ou bot não está presente.")), { statusCode: 404 });
    }),
    discordJson<{ id: string; name?: string }>(`/guilds/${targetGuildId}`, token, { label: "buscar servidor destino" })
      .catch((error) => {
        throw Object.assign(new Error(discordFriendlyError(error, "Servidor de destino não encontrado ou bot não está presente.")), { statusCode: 404 });
      })
  ]);

  return {
    accepted: true,
    bot: {
      id: bot.id,
      username: bot.username ?? "Bot"
    },
    emojiCount: sourceEmojis.length,
    sourceGuild: {
      id: sourceGuildId,
      name: `Servidor ${sourceGuildId}`
    },
    targetGuild,
    message: "Token validado com sucesso."
  };
}

async function fetchGuildEmojis(guildId: string, token: string) {
  const emojis = await discordJson<Array<{ animated?: boolean; id: string; name: string }>>(`/guilds/${guildId}/emojis`, token, {
    label: "buscar emojis"
  });

  return emojis.map((emoji) => ({
    animated: emoji.animated === true,
    id: emoji.id,
    name: emoji.name,
    selected: false,
    status: "ready" as const,
    url: `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}?size=128&quality=lossless`
  }));
}

async function cloneSelectedEmojisWithBotToken(input: {
  botId: string | null;
  emojis: Array<{ animated: boolean; id: string; name: string; url: string }>;
  prefix: string | null;
  sourceGuildId: string;
  targetGuildId: string;
  token: string;
  userId: string;
}) {
  await validateEmojiBotToken(input.token, input.sourceGuildId, input.targetGuildId);
  await createEmojiCloneLog(input.botId, input.targetGuildId, input.userId, "emoji_clone.bulk.started", `[INFO] Iniciando clonagem de ${input.emojis.length} emoji(s).`);

  const existing = await fetchGuildEmojis(input.targetGuildId, input.token).catch(() => []);
  const existingNames = new Map(existing.map((emoji) => [emoji.name.toLowerCase(), emoji]));
  const items: Array<{
    animated: boolean;
    errorReason?: string | null;
    newEmojiId?: string | null;
    newName?: string | null;
    originalEmojiId: string;
    originalName: string;
    originalUrl?: string | null;
    status: "success" | "failed";
  }> = [];
  let success = 0;
  let failed = 0;

  for (const [index, emoji] of input.emojis.entries()) {
    const name = sanitizeEmojiCloneName(`${input.prefix ?? ""}${emoji.name}`);
    await createEmojiCloneLog(input.botId, input.targetGuildId, input.userId, "emoji_clone.item.started", `[INFO] Clonando emoji: ${name}.`);

    try {
      const duplicate = existingNames.get(name.toLowerCase());

      if (duplicate) {
        success += 1;
        items.push({
          animated: duplicate.animated,
          newEmojiId: duplicate.id,
          newName: duplicate.name,
          originalEmojiId: emoji.id,
          originalName: emoji.name,
          originalUrl: emoji.url,
          status: "success"
        });
        await createEmojiCloneLog(input.botId, input.targetGuildId, input.userId, "emoji_clone.item.duplicate", `[SUCCESS] Emoji já existia: ${name}.`);
      } else {
        await createEmojiCloneLog(input.botId, input.targetGuildId, input.userId, "emoji_clone.item.download", `[INFO] Baixando emoji: ${emoji.name}.`);
        const image = await downloadImageAsDataUri(emoji.url);
        await createEmojiCloneLog(input.botId, input.targetGuildId, input.userId, "emoji_clone.item.upload", `[INFO] Criando emoji: ${name}.`);
        const created = await discordJson<{ animated?: boolean; id: string; name: string }>(`/guilds/${input.targetGuildId}/emojis`, input.token, {
          body: {
            image,
            name
          },
          label: `criar emoji ${name}`,
          method: "POST"
        });
        success += 1;
        existingNames.set(created.name.toLowerCase(), {
          animated: Boolean(created.animated),
          id: created.id,
          name: created.name,
          selected: false,
          status: "ready",
          url: `https://cdn.discordapp.com/emojis/${created.id}.${created.animated ? "gif" : "png"}?size=128&quality=lossless`
        });
        items.push({
          animated: Boolean(created.animated ?? emoji.animated),
          newEmojiId: created.id,
          newName: created.name,
          originalEmojiId: emoji.id,
          originalName: emoji.name,
          originalUrl: emoji.url,
          status: "success"
        });
        await createEmojiCloneLog(input.botId, input.targetGuildId, input.userId, "emoji_clone.item.success", `[SUCCESS] Emoji criado com sucesso: ${created.name}.`);
      }
    } catch (error) {
      const message = discordFriendlyError(error, "Falha ao criar emoji.");
      failed += 1;
      items.push({
        animated: emoji.animated,
        errorReason: message,
        originalEmojiId: emoji.id,
        originalName: emoji.name,
        originalUrl: emoji.url,
        status: "failed"
      });
      await createEmojiCloneLog(input.botId, input.targetGuildId, input.userId, "emoji_clone.item.failed", `[ERROR] Falha ao criar emoji ${name}: ${message}.`);
    }

    emitRealtime("emoji-cloner:progress", {
      botId: input.botId,
      current: index + 1,
      failed,
      guildId: input.targetGuildId,
      success,
      total: input.emojis.length,
      userId: input.userId
    });
    await wait(900);
  }

  const job = await recordEmojiCloneJob({
    botId: input.botId,
    failed,
    guildId: input.targetGuildId,
    items,
    prefix: input.prefix,
    sourceGuildId: input.sourceGuildId,
    status: "completed",
    success,
    total: input.emojis.length,
    userId: input.userId
  });
  await createEmojiCloneLog(input.botId, input.targetGuildId, input.userId, "emoji_clone.bulk.completed", `[INFO] Processo concluído. ${success}/${input.emojis.length} emoji(s) clonados.`);

  return {
    failed,
    job,
    items,
    success,
    total: input.emojis.length
  };
}

async function discordJson<T>(
  path: string,
  token: string,
  options: {
    body?: unknown;
    label: string;
    method?: "GET" | "POST";
  }
): Promise<T> {
  let attempt = 0;

  while (true) {
    const response = await fetch(`https://discord.com/api/v10${path}`, {
      body: options.body ? JSON.stringify(options.body) : undefined,
      headers: {
        Authorization: `Bot ${token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {})
      },
      method: options.method ?? "GET"
    }).catch((error) => {
      throw Object.assign(new Error(`Erro ao conectar com a API do Discord: ${error instanceof Error ? error.message : String(error)}`), { statusCode: 502 });
    });
    const raw = await response.text();
    console.log(`[emoji-cloner][discord] ${options.label} status=${response.status} path=${path} body=${truncateDiscordLog(raw)}`);
    const payload = safeJson(raw) as { message?: string; retry_after?: number } | null;

    if (response.status === 429 && attempt < 4) {
      const retryAfterMs = Math.ceil((payload?.retry_after ?? 1) * 1_000);
      await wait(Math.min(15_000, retryAfterMs + attempt * 500));
      attempt += 1;
      continue;
    }

    if (!response.ok) {
      throw Object.assign(new Error(payload?.message ?? `Discord HTTP ${response.status} em ${options.label}`), {
        discordStatus: response.status,
        statusCode: response.status === 401 ? 400 : response.status
      });
    }

    return payload as T;
  }
}

function normalizeDiscordBotToken(value: string, userId: string, guildId: string) {
  const token = value
    .trim()
    .replace(/^authorization:\s*/i, "")
    .replace(/^bot\s+/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, "");
  const unsupportedReason = unsupportedCredentialReason(token);

  if (unsupportedReason) {
    void createEmojiCloneLog(null, guildId, userId, "emoji_clone.auth.unsupported", `[ERROR] Credencial não suportada: ${unsupportedReason}.`);
    throw Object.assign(new Error(unsupportedReason), {
      statusCode: 400
    });
  }

  console.log(`[emoji-cloner][auth] credential received type=bot-candidate length=${token.length} fingerprint=${tokenFingerprint(token)}`);
  return token;
}

function sanitizeEmojiCloneName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || "emoji";
}

function discordFriendlyError(error: unknown, fallback: string) {
  const status = typeof error === "object" && error && "discordStatus" in error ? Number((error as { discordStatus?: unknown }).discordStatus) : 0;
  const message = error instanceof Error ? error.message : fallback;

  if (status === 401) return `Token de bot inválido. Discord HTTP ${status}.`;
  if (status === 403) return `Falha de autenticação ou permissão. Discord HTTP ${status}.`;
  if (status === 404) return `O bot não possui acesso ao servidor informado. Discord HTTP ${status}.`;
  if (status === 429) return `Rate limit do Discord. Discord HTTP ${status}. Tente novamente em alguns segundos.`;
  if (/Maximum number of emojis/i.test(message)) return "Limite de emojis do servidor atingido.";
  if (/Missing Permissions/i.test(message)) return "O bot não possui a permissão \"Gerenciar Emojis e Figurinhas\".";
  return message || fallback;
}

function unsupportedCredentialReason(token: string) {
  if (!token) return "Credencial vazia.";
  if (/^bearer\s+/i.test(token)) return "Credencial não suportada por este sistema. Informe um token de bot, não Bearer/OAuth.";
  if (/^mfa\.[\w-]{20,}$/i.test(token)) return "Credencial não suportada por este sistema. Token de usuário não é aceito.";
  if (/discord(?:app)?\.com\/api\/webhooks\//i.test(token)) return "Credencial não suportada por este sistema. Webhook não é token de bot.";
  if (/^[a-f0-9]{32}$/i.test(token)) return "Credencial não suportada por este sistema. Client secret não é token de bot.";
  if (/^[0-9]{15,32}$/.test(token)) return "Credencial não suportada por este sistema. ID de aplicação não é token de bot.";
  return null;
}

function tokenFingerprint(token: string) {
  return Buffer.from(token.slice(0, 8)).toString("base64url").slice(0, 10);
}

function safeJson(value: string) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function truncateDiscordLog(value: string) {
  return value.replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/g, "[masked-token]").slice(0, 800);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findGuildEmojiByName(guildId: string, botToken: string, name: string) {
  const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/emojis`, {
    headers: {
      Authorization: `Bot ${botToken}`
    }
  });

  if (!response.ok) {
    return null;
  }

  const emojis = await response.json().catch(() => []) as Array<{ animated?: boolean; id: string; name: string }>;
  return emojis.find((emoji) => emoji.name.toLowerCase() === name.toLowerCase()) ?? null;
}

async function downloadImageAsDataUri(url: string) {
  const response = await fetch(url);

  if (!response.ok) {
    throw Object.assign(new Error("Nao foi possivel baixar a imagem do emoji."), { statusCode: 400 });
  }

  const contentType = response.headers.get("content-type")?.split(";")[0]?.toLowerCase() ?? "";

  if (!/^image\/(png|gif|webp|jpe?g)$/.test(contentType)) {
    throw Object.assign(new Error("Formato de imagem invalido para emoji."), { statusCode: 400 });
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (buffer.length > 256 * 1024) {
    throw Object.assign(new Error("Emoji muito grande. Limite maximo: 256 KiB."), { statusCode: 400 });
  }

  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

function assertImageSize(dataUri: string) {
  const base64 = dataUri.split(",", 2)[1] ?? "";
  const bytes = Buffer.byteLength(base64, "base64");

  if (bytes > 256 * 1024) {
    throw Object.assign(new Error("Emoji muito grande. Limite maximo: 256 KiB."), { statusCode: 400 });
  }
}

function friendlyDiscordEmojiError(message: string | undefined, status: number) {
  if (status === 403) return "O bot precisa da permissao Criar Expressoes ou Gerenciar Expressoes neste servidor.";
  if (status === 429) return "O Discord limitou as requisicoes. Aguarde alguns segundos e tente novamente.";
  if (message) return message;
  return "Nao foi possivel criar o emoji no Discord.";
}

function createDataUriFingerprint(value: string) {
  return Buffer.from(value.slice(0, 512)).toString("base64url").slice(0, 32);
}

function createUrlFingerprint(value: string) {
  return Buffer.from(value.trim()).toString("base64url").slice(0, 32);
}

function looksLikeDiscordUserToken(value: string) {
  return /mfa\.[\w-]{20,}/i.test(value) || /^[\w-]{20,}\.[\w-]{6,}\.[\w-]{20,}$/.test(value);
}

function maskFakeToken(token: string, prefix: string) {
  return token.startsWith(prefix) ? `${prefix}****` : "****";
}

async function recordEmojiCloneTestLog(input: {
  sourceGuildId: string;
  targetGuildId: string;
  tokenMasked: string;
  userId: string;
}) {
  const { createLog } = await import("../services/logService");

  await createLog({
    guildId: input.targetGuildId,
    userId: input.userId,
    type: "emoji_clone.test_token.accepted",
    message: "[TESTE - CLONAGEM DE EMOJIS] Token falso aceito para teste de clonagem.",
    metadata: {
      action: "Iniciou teste de clonagem de emojis",
      createdAt: new Date().toISOString(),
      sourceGuildId: input.sourceGuildId,
      targetGuildId: input.targetGuildId,
      token: input.tokenMasked
    }
  });
}

async function createEmojiCloneLog(botId: string | null, guildId: string, userId: string, type: string, message: string) {
  const { createLog } = await import("../services/logService");

  await createLog({
    botId,
    guildId,
    userId,
    type,
    message,
    metadata: {
      botId,
      guildId,
      userId
    }
  }).catch(() => undefined);
}

import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { canUseDevBotModule, getDevBotToken } from "../services/devBotService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import { recordEmojiCloneJob } from "../services/emojiCloneService";

const itemSchema = z.object({
  originalEmojiId: z.string().min(1).max(64),
  originalName: z.string().min(1).max(64),
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
const fakeTokenSchema = z.object({
  sourceGuildId: z.string().regex(/^\d{5,32}$/),
  targetGuildId: z.string().regex(/^\d{5,32}$/),
  token: z.string().min(1).max(512)
});

export const emojiClonerRouter = Router();

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
        message: "Sistema de token falso para clonagem de emojis esta desativado."
      });
    }

    if (looksLikeDiscordUserToken(input.token) || !input.token.startsWith(prefix)) {
      return res.status(400).json({
        message: "Token invalido. Use apenas token falso gerado pelo sistema de testes."
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
      message: "Token falso aceito. Modo de teste ativado para clonagem de emojis.",
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

    const botToken = await getDevBotToken(botId);

    if (!botToken) {
      return res.status(400).json({ message: "Bot sem credencial valida cadastrada." });
    }

    const image = await resolveEmojiImage(input.image);
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/emojis`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        image,
        name: input.name
      })
    });

    const payload = await response.json().catch(() => null) as { id?: string; name?: string; animated?: boolean; message?: string } | null;

    if (!response.ok || !payload?.id) {
      return res.status(response.status === 403 ? 403 : 400).json({
        message: friendlyDiscordEmojiError(payload?.message, response.status)
      });
    }

    const job = await recordEmojiCloneJob({
      botId,
      failed: 0,
      guildId,
      items: [{
        animated: Boolean(payload.animated),
        newEmojiId: payload.id,
        newName: payload.name ?? input.name,
        originalEmojiId: input.sourceLabel ?? "upload",
        originalName: input.sourceLabel ?? input.name,
        status: "success"
      }],
      status: "completed",
      success: 1,
      total: 1,
      userId: user.discordId
    });

    return res.json({
      emoji: payload,
      job
    });
  } catch (error) {
    return next(error);
  }
});

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

async function resolveEmojiImage(value: string) {
  const trimmed = value.trim();
  const custom = trimmed.match(/^<(?<animated>a?):(?<name>[a-zA-Z0-9_]{2,32}):(?<id>\d{5,32})>$/);

  if (custom?.groups) {
    const animated = custom.groups.animated === "a";
    return downloadImageAsDataUri(`https://cdn.discordapp.com/emojis/${custom.groups.id}.${animated ? "gif" : "png"}?size=128&quality=lossless`);
  }

  if (/^data:image\/(png|gif|webp|jpe?g);base64,/i.test(trimmed)) {
    assertImageSize(trimmed);
    return trimmed;
  }

  const url = trimmed.match(/^https:\/\/cdn\.discordapp\.com\/emojis\/\d{5,32}\.(?:png|gif|webp|jpg|jpeg)(?:\?[^\s]*)?$/i)
    ? trimmed
    : /^https?:\/\//i.test(trimmed)
      ? trimmed
      : null;

  if (!url) {
    throw Object.assign(new Error("Informe um upload, URL de imagem ou codigo de emoji valido."), { statusCode: 400 });
  }

  return downloadImageAsDataUri(url);
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

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { requireAuth, requireBot } from "../middleware/auth";
import { canManageDashboardGuild, canReadDashboardGuild } from "../services/dashboardGuildAccessService";
import { canReadDevBotModule, canUseDevBotModule, getBotApiPermissions, getDevBotToken } from "../services/devBotService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import {
  createGiveaway,
  endGiveaway,
  enterGiveaway,
  getGiveaway,
  getGiveawayIdentity,
  getRouletteGiveaway,
  listBotGiveaways,
  listGiveaways,
  publishGiveawayPanel,
  spinGiveawayRoulette,
  startGiveaway,
  syncGiveawayParticipants,
  updateGiveaway,
  updateGiveawayPanelState
} from "../services/giveawayService";
import { buildKickOAuthUrl, exchangeKickOAuthCode, getKickAuthenticatedUser } from "../services/kickService";
import { saveKickGiveawayAccount, saveTwitchGiveawayAccount } from "../services/giveawayIdentityService";
import { buildTwitchOAuthUrl, exchangeTwitchOAuthCode, getTwitchAuthenticatedUser } from "../services/twitchService";
import type { AuthSessionUser } from "../types/session";

const guildIdSchema = z.string().regex(/^\d{5,32}$/);
const giveawayIdSchema = z.string().min(8).max(128);
const rouletteTokenSchema = z.string().min(20).max(128);
const participantModeSchema = z.enum([
  "all",
  "kick_followers",
  "kick_subs",
  "twitch_followers",
  "twitch_kick",
  "twitch_subs",
  "twitch_subs_followers"
]);
const saveGiveawaySchema = z.object({
  allowRepeatWinners: z.boolean().optional(),
  customMessage: z.string().max(1200).nullable().optional(),
  discordChannelId: z.string().regex(/^\d{5,32}$/).nullable().optional(),
  endDelayMinutes: z.coerce.number().int().min(0).max(60 * 24 * 30).nullable().optional(),
  kickChannelInput: z.string().max(300).nullable().optional(),
  liveUrl: z.string().min(1).max(300),
  participantMode: participantModeSchema.nullable().optional(),
  prizeName: z.string().min(1).max(160),
  startDelayMinutes: z.coerce.number().int().min(0).max(60 * 24 * 30).nullable().optional(),
  title: z.string().min(1).max(120),
  winnerCount: z.coerce.number().int().min(1).max(50).nullable().optional()
});
const panelStateSchema = z.object({
  panelMessageId: z.string().regex(/^\d{5,32}$/).nullable().optional()
});
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const rouletteRateLimits = new Map<string, { count: number; resetAt: number }>();

export const giveawaysRouter = Router();

giveawaysRouter.get("/roulette/:token", async (req, res, next) => {
  try {
    const token = rouletteTokenSchema.parse(req.params.token);

    return res.json({
      giveaway: await getRouletteGiveaway(token)
    });
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.post("/roulette/:token/spin", async (req, res, next) => {
  try {
    const token = rouletteTokenSchema.parse(req.params.token);

    return res.json(await spinGiveawayRoulette(token));
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.get("/roulette/:token/identity", async (req, res, next) => {
  try {
    const token = rouletteTokenSchema.parse(req.params.token);

    return res.json({
      identity: await getGiveawayIdentity(token, req.session.giveawayPlatformAccounts)
    });
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.post("/roulette/:token/entry", async (req, res, next) => {
  try {
    assertRouletteRateLimit(req, "entry", 10, 60_000);
    const token = rouletteTokenSchema.parse(req.params.token);

    return res.json(await enterGiveaway(token, req.session.giveawayPlatformAccounts ?? {}));
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.get("/roulette/:token/connect/twitch", async (req, res, next) => {
  try {
    assertRouletteRateLimit(req, "connect:twitch", 20, 60_000);
    const token = rouletteTokenSchema.parse(req.params.token);
    const state = await createGiveawayOAuthState(req, "twitch", token);

    return res.redirect(buildTwitchOAuthUrl({
      redirectUri: twitchRedirectUri(),
      state
    }));
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.get("/roulette/:token/connect/kick", async (req, res, next) => {
  try {
    assertRouletteRateLimit(req, "connect:kick", 20, 60_000);
    const token = rouletteTokenSchema.parse(req.params.token);
    const codeVerifier = randomBytes(48).toString("base64url");
    const state = await createGiveawayOAuthState(req, "kick", token, codeVerifier);

    return res.redirect(buildKickOAuthUrl({
      codeChallenge: pkceChallenge(codeVerifier),
      redirectUri: kickRedirectUri(),
      state
    }));
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.get("/oauth/twitch/callback", async (req, res, next) => {
  try {
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;
    const oauth = verifyGiveawayOAuthState(req, "twitch", state);

    if (!code || !oauth) {
      return res.redirect(rouletteRedirectUrl(null, "twitch_oauth"));
    }

    const token = await exchangeTwitchOAuthCode(code, twitchRedirectUri());
    const user = await getTwitchAuthenticatedUser(token);
    const account = await saveTwitchGiveawayAccount(user);

    req.session.giveawayPlatformAccounts = {
      ...(req.session.giveawayPlatformAccounts ?? {}),
      twitch: account.id
    };
    req.session.giveawayOAuth = undefined;
    await saveSession(req);

    return res.redirect(rouletteRedirectUrl(oauth.token, "twitch_connected"));
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.get("/oauth/kick/callback", async (req, res, next) => {
  try {
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;
    const oauth = verifyGiveawayOAuthState(req, "kick", state);

    if (!code || !oauth?.codeVerifier) {
      return res.redirect(rouletteRedirectUrl(null, "kick_oauth"));
    }

    const token = await exchangeKickOAuthCode(code, kickRedirectUri(), oauth.codeVerifier);
    const user = await getKickAuthenticatedUser(token);
    const account = await saveKickGiveawayAccount(user);

    req.session.giveawayPlatformAccounts = {
      ...(req.session.giveawayPlatformAccounts ?? {}),
      kick: account.id
    };
    req.session.giveawayOAuth = undefined;
    await saveSession(req);

    return res.redirect(rouletteRedirectUrl(oauth.token, "kick_connected"));
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.get("/bot/active", requireBot, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);

    return res.json({
      giveaways: await listBotGiveaways(botId)
    });
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.get("/bot/:giveawayId", requireBot, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const giveawayId = giveawayIdSchema.parse(req.params.giveawayId);
    const giveaway = await getGiveaway(giveawayId, botId);

    if (!giveaway) {
      return res.status(404).json({
        message: "Sorteio nao encontrado."
      });
    }

    return res.json({
      giveaway
    });
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.patch("/bot/:giveawayId/panel-state", requireBot, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const giveawayId = giveawayIdSchema.parse(req.params.giveawayId);
    const input = panelStateSchema.parse(req.body ?? {});

    return res.json({
      giveaway: await updateGiveawayPanelState(giveawayId, input, botId)
    });
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.use(requireAuth);

giveawaysRouter.get("/:guildId", async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);

    await assertCanReadGiveaway(res.locals.dashboardAuth.user, guildId, botId);

    return res.json({
      giveaways: await listGiveaways(guildId, botId)
    });
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.post("/:guildId", async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const input = saveGiveawaySchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageGiveaway(user, guildId, botId);

    return res.status(201).json({
      giveaway: await createGiveaway(guildId, input, user.discordId, botId, await getDevBotToken(botId))
    });
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.patch("/:guildId/:giveawayId", async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const giveawayId = giveawayIdSchema.parse(req.params.giveawayId);
    const input = saveGiveawaySchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageGiveaway(user, guildId, botId);
    await assertGiveawayBelongsToGuild(giveawayId, guildId, botId);

    const giveaway = await updateGiveaway(giveawayId, input, user.discordId, botId, await getDevBotToken(botId));

    return res.json({
      giveaway
    });
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.post("/:guildId/:giveawayId/panel", async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const giveawayId = giveawayIdSchema.parse(req.params.giveawayId);
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageGiveaway(user, guildId, botId);
    await assertGiveawayBelongsToGuild(giveawayId, guildId, botId);

    const giveaway = await publishGiveawayPanel(giveawayId, user.discordId, botId);

    return res.json({
      giveaway
    });
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.post("/:guildId/:giveawayId/start", async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const giveawayId = giveawayIdSchema.parse(req.params.giveawayId);
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageGiveaway(user, guildId, botId);
    await assertGiveawayBelongsToGuild(giveawayId, guildId, botId);

    const giveaway = await startGiveaway(giveawayId, user.discordId, botId);

    return res.json({
      giveaway
    });
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.post("/:guildId/:giveawayId/sync", async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const giveawayId = giveawayIdSchema.parse(req.params.giveawayId);
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageGiveaway(user, guildId, botId);
    await assertGiveawayBelongsToGuild(giveawayId, guildId, botId);

    const giveaway = await syncGiveawayParticipants(giveawayId, user.discordId, botId);

    return res.json({
      giveaway
    });
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.post("/:guildId/:giveawayId/end", async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const giveawayId = giveawayIdSchema.parse(req.params.giveawayId);
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageGiveaway(user, guildId, botId);
    await assertGiveawayBelongsToGuild(giveawayId, guildId, botId);

    const giveaway = await endGiveaway(giveawayId, user.discordId, botId);

    return res.json({
      giveaway
    });
  } catch (error) {
    return next(error);
  }
});

async function assertCanReadGiveaway(user: AuthSessionUser, guildId: string, botId: string | null) {
  if (botId) {
    const permissions = await getBotApiPermissions(botId);

    if (!permissions?.enabledModules.includes("giveaway")) {
      throw createRouteError("O modulo de sorteio nao foi liberado para este bot.", 403);
    }

    if (await canReadDevBotModule(user, botId, guildId, "giveaway")) {
      return;
    }
  } else if (canReadDashboardGuild(user, guildId)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para acessar sorteios deste servidor.", 403);
}

async function assertCanManageGiveaway(user: AuthSessionUser, guildId: string, botId: string | null) {
  if (botId) {
    const permissions = await getBotApiPermissions(botId);

    if (!permissions?.enabledModules.includes("giveaway")) {
      throw createRouteError("O modulo de sorteio nao foi liberado para este bot.", 403);
    }

    if (await canUseDevBotModule(user, botId, guildId, "giveaway")) {
      return;
    }
  } else if (canManageDashboardGuild(user, guildId)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para configurar sorteios deste servidor.", 403);
}

async function assertGiveawayBelongsToGuild(giveawayId: string, guildId: string, botId: string | null) {
  const giveaway = await getGiveaway(giveawayId, botId);

  if (!giveaway || giveaway.guildId !== guildId) {
    throw createRouteError("Sorteio nao encontrado neste servidor.", 404);
  }
}

function createRouteError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}

function twitchRedirectUri() {
  const redirectUri = env.TWITCH_OAUTH_REDIRECT_URI || (env.SITE_ORIGIN ? `${env.SITE_ORIGIN}/api/giveaways/oauth/twitch/callback` : "");

  if (!redirectUri) {
    throw createRouteError("TWITCH_OAUTH_REDIRECT_URI precisa estar configurada.", 503);
  }

  return redirectUri;
}

function kickRedirectUri() {
  const redirectUri = env.KICK_OAUTH_REDIRECT_URI || (env.SITE_ORIGIN ? `${env.SITE_ORIGIN}/api/giveaways/oauth/kick/callback` : "");

  if (!redirectUri) {
    throw createRouteError("KICK_OAUTH_REDIRECT_URI precisa estar configurada.", 503);
  }

  return redirectUri;
}

async function createGiveawayOAuthState(
  req: Request,
  platform: "twitch" | "kick",
  token: string,
  codeVerifier?: string
) {
  const payload = Buffer.from(JSON.stringify({
    exp: Date.now() + OAUTH_STATE_TTL_MS,
    nonce: randomBytes(16).toString("base64url"),
    platform,
    token,
    ua: requestFingerprint(req)
  }), "utf8").toString("base64url");
  const signature = createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url");
  const state = `${payload}.${signature}`;

  req.session.giveawayOAuth = {
    codeVerifier,
    platform,
    redirectPath: `/roulette/${encodeURIComponent(token)}`,
    state,
    token
  };
  await saveSession(req);

  return state;
}

function verifyGiveawayOAuthState(req: Request, platform: "twitch" | "kick", state: string | null) {
  if (!state || req.session.giveawayOAuth?.state !== state || req.session.giveawayOAuth.platform !== platform) {
    return null;
  }

  const [payload, signature] = state.split(".");

  if (!payload || !signature) {
    return null;
  }

  const expected = createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url");
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: number;
      platform?: string;
      token?: string;
      ua?: string;
    };

    if (
      parsed.exp === undefined ||
      parsed.exp < Date.now() ||
      parsed.platform !== platform ||
      parsed.token !== req.session.giveawayOAuth.token ||
      parsed.ua !== requestFingerprint(req)
    ) {
      return null;
    }

    return req.session.giveawayOAuth;
  } catch {
    return null;
  }
}

function requestFingerprint(req: Request) {
  return createHash("sha256")
    .update(req.get("user-agent") ?? "")
    .digest("base64url");
}

function pkceChallenge(codeVerifier: string) {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

function rouletteRedirectUrl(token: string | null, status: string) {
  const path = token ? `/roulette/${encodeURIComponent(token)}?status=${encodeURIComponent(status)}` : `/auth/error?reason=${encodeURIComponent(status)}`;
  return env.SITE_ORIGIN ? `${env.SITE_ORIGIN}${path}` : path;
}

function saveSession(req: Request) {
  return new Promise<void>((resolve, reject) => {
    req.session.save((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function assertRouletteRateLimit(req: Request, action: string, limit: number, windowMs: number) {
  const now = Date.now();
  const key = `${action}:${req.ip ?? "unknown"}`;
  const current = rouletteRateLimits.get(key);

  if (!current || current.resetAt <= now) {
    rouletteRateLimits.set(key, {
      count: 1,
      resetAt: now + windowMs
    });
    return;
  }

  if (current.count >= limit) {
    throw createRouteError("Muitas tentativas em pouco tempo. Aguarde um instante.", 429);
  }

  current.count += 1;
}

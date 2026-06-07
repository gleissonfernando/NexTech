import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { Router } from "express";
import { env } from "../config/env";
import {
  buildDiscordAuthUrl,
  discordAvatarUrl,
  discordUserTag,
  exchangeDiscordCode,
  fetchDiscordGuilds,
  fetchDiscordUser
} from "../services/discordOAuthService";
import { toDashboardGuilds } from "../services/guildService";
import { requireAuthenticated } from "../middleware/auth";
import {
  applyDashboardAccessValidation,
  evaluateDashboardAccess
} from "../services/accessControlService";
import {
  clearAuthCookies,
  createAuthResponse,
  issueAuthCookies,
  issueVerificationToken,
  refreshAuthFromRequest,
  resolveAuthFromRequest
} from "../services/tokenService";
import { getBotStatus, refreshBotGuildsFromDiscord } from "../services/statsService";
import { saveDiscordUser } from "../services/userService";

export const authRouter = Router();
const dashboardPath = "/dashboard";
const errorPath = "/auth/error";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function isApiAuthMount(req: Request) {
  return req.baseUrl.replace(/\/+$/, "") === "/api/auth";
}

function canonicalAuthUrl(path: string, query = "") {
  return env.SITE_ORIGIN ? `${env.SITE_ORIGIN}/auth${path}${query}` : `/auth${path}${query}`;
}

function dashboardRedirectUrl() {
  return env.SITE_ORIGIN ? `${env.SITE_ORIGIN}${dashboardPath}` : dashboardPath;
}

function errorRedirectUrl(reason: string) {
  const path = `${errorPath}?reason=${encodeURIComponent(reason)}`;
  return env.SITE_ORIGIN ? `${env.SITE_ORIGIN}${path}` : path;
}

function requestFingerprint(req: Request) {
  return createHash("sha256")
    .update(req.get("user-agent") ?? "")
    .digest("base64url");
}

function createOAuthState(req: Request) {
  const payload = Buffer.from(
    JSON.stringify({
      exp: Date.now() + OAUTH_STATE_TTL_MS,
      nonce: randomUUID(),
      ua: requestFingerprint(req)
    }),
    "utf8"
  ).toString("base64url");
  const signature = createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url");

  return `${payload}.${signature}`;
}

function verifyOAuthState(token: string, req: Request) {
  const [payload, signature] = token?.split(".") ?? [];

  if (!payload || !signature) {
    return false;
  }

  const expected = createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url");
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return false;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: number;
      nonce?: unknown;
      ua?: unknown;
    };

    if (
      typeof parsed.exp !== "number" ||
      parsed.exp < Date.now() ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.ua !== "string" ||
      parsed.ua !== requestFingerprint(req)
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
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

function destroySession(req: Request) {
  return new Promise<void>((resolve, reject) => {
    req.session.destroy((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function ensureBotGuildsLoaded() {
  if (getBotStatus().botGuilds.length === 0) {
    await refreshBotGuildsFromDiscord();
  }
}

authRouter.get("/discord", async (req, res) => {
  if (isApiAuthMount(req)) {
    return res.redirect(canonicalAuthUrl("/discord"));
  }

  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.DISCORD_OAUTH_REDIRECT_URI) {
    return res.status(503).json({
      message: "OAuth2 Discord ainda nao esta configurado."
    });
  }

  const state = createOAuthState(req);

  return res.redirect(buildDiscordAuthUrl(state));
});

authRouter.get("/discord/callback", async (req, res, next) => {
  if (isApiAuthMount(req)) {
    const queryIndex = req.originalUrl.indexOf("?");
    const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : "";

    return res.redirect(canonicalAuthUrl("/discord/callback", query));
  }

  try {
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;

    if (!code || !state || !verifyOAuthState(state, req)) {
      clearAuthCookies(res);
      return res.redirect(errorRedirectUrl("callback"));
    }

    const tokens = await exchangeDiscordCode(code);
    await ensureBotGuildsLoaded();
    const discordUser = await fetchDiscordUser(tokens.access_token);
    const discordGuilds = await fetchDiscordGuilds(tokens.access_token);
    const user = await saveDiscordUser(discordUser, tokens);
    const guilds = toDashboardGuilds(discordGuilds);
    const baseUser = {
      id: user.id,
      discordId: discordUser.id,
      username: discordUser.global_name ?? discordUser.username,
      globalName: discordUser.global_name ?? null,
      discriminator: discordUser.discriminator ?? null,
      tag: discordUserTag(discordUser),
      avatar: discordUser.avatar,
      avatarUrl: discordAvatarUrl(discordUser),
      email: discordUser.email ?? null,
      guilds,
      selectedGuildId: user.selectedGuildId && guilds.some((guild) => guild.id === user.selectedGuildId)
        ? user.selectedGuildId
        : guilds[0]?.id ?? null,
      accessLevel: "viewer" as const,
      authorized: false,
      lastLoginAt: user.lastLoginAt?.toISOString?.() ?? new Date().toISOString()
    };
    req.session.user = baseUser;
    req.session.verified = false;
    req.session.oauthState = undefined;
    req.session.discordAccessToken = tokens.access_token;
    req.session.discordRefreshToken = tokens.refresh_token;

    issueAuthCookies(res, req.session.user, false);
    await saveSession(req);
    return res.redirect(dashboardRedirectUrl());
  } catch (error) {
    clearAuthCookies(res);
    if (req.session) {
      req.session.oauthState = undefined;
      await saveSession(req).catch(() => undefined);
    }

    if (!res.headersSent) {
      return res.redirect(errorRedirectUrl("oauth"));
    }

    return next(error);
  }
});

authRouter.get("/me", async (req, res) => {
  await ensureBotGuildsLoaded();
  const auth = resolveAuthFromRequest(req, res);

  if (!auth) {
    return res.status(401).json({
      message: "Sessao nao autenticada."
    });
  }

  req.session.user = auth.user;
  if (auth.verified) {
    req.session.verified = true;
  }
  await saveSession(req);

  return res.json(createAuthResponse(auth));
});

authRouter.post("/refresh", async (req, res) => {
  await ensureBotGuildsLoaded();
  const auth = refreshAuthFromRequest(req, res);

  if (!auth) {
    return res.status(401).json({
      message: "Sessao expirada."
    });
  }

  req.session.user = auth.user;
  if (auth.verified) {
    req.session.verified = true;
  }
  await saveSession(req);

  return res.json(createAuthResponse(auth));
});

authRouter.get("/access-check", requireAuthenticated, async (_req, res) => {
  const auth = res.locals.dashboardAuth;
  const validation = await evaluateDashboardAccess(auth.user);

  return res.json({
    validation
  });
});

authRouter.post("/verify", requireAuthenticated, async (req, res) => {
  await ensureBotGuildsLoaded();
  const auth = res.locals.dashboardAuth;
  const validation = await evaluateDashboardAccess(auth.user);
  const validatedUser = applyDashboardAccessValidation(auth.user, validation);

  if (!validation.allowed) {
    const deniedAuth = issueAuthCookies(res, validatedUser, false);
    req.session.user = deniedAuth.user;
    req.session.verified = false;
    req.session.accessValidatedAt = Date.now();
    await saveSession(req);

    return res.status(403).json({
      message: "Seu usuario nao possui o cargo liberado para acessar este painel.",
      validation
    });
  }

  const verifiedAuth = issueAuthCookies(
    res,
    validatedUser,
    true
  );

  req.session.user = verifiedAuth.user;
  req.session.verified = verifiedAuth.verified;
  req.session.accessValidatedAt = Date.now();
  await saveSession(req);

  return res.json({
    ...createAuthResponse(verifiedAuth),
    validation,
    verificationToken: issueVerificationToken(verifiedAuth.user)
  });
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    clearAuthCookies(res);
    await destroySession(req);
    res.clearCookie("discord_dashboard.sid");

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

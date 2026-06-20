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
  createDeniedAccessUser,
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
import { clearStoredDiscordTokens, saveDiscordUser } from "../services/userService";
import type { AuthSessionUser } from "../types/session";

export const authRouter = Router();
const dashboardPath = "/dashboard";
const errorPath = "/auth/error";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const ACCESS_DENIED_MESSAGE = "Você não está liberado para acessar esta dashboard.";
const AUTH_STAGE_TIMEOUT_MS = 15_000;

function isApiAuthMount(req: Request) {
  return req.baseUrl.replace(/\/+$/, "") === "/api/auth";
}

function canonicalAuthUrl(path: string, query = "") {
  return env.SITE_ORIGIN ? `${env.SITE_ORIGIN}/auth${path}${query}` : `/auth${path}${query}`;
}

function dashboardRedirectUrl(botSlug?: string | null) {
  const path = botSlug ? `${dashboardPath}/${encodeURIComponent(botSlug)}` : dashboardPath;
  return env.SITE_ORIGIN ? `${env.SITE_ORIGIN}${path}` : path;
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
  const botSlug = readAccessBotSlug(req);
  const payload = Buffer.from(
    JSON.stringify({
      botSlug,
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
      botSlug?: unknown;
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

    return {
      botSlug: typeof parsed.botSlug === "string" ? parsed.botSlug : null
    };
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

function readAccessBotSlug(req: Request) {
  const body = req.body as { botSlug?: unknown } | undefined;
  const value = typeof req.query.botSlug === "string"
    ? req.query.botSlug
    : typeof body?.botSlug === "string"
      ? body.botSlug
      : null;
  const botSlug = value?.trim();

  return botSlug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(botSlug) ? botSlug : null;
}

function accessValidationOptions(req: Request) {
  return {
    botSlug: readAccessBotSlug(req),
    discordAccessToken: req.session.discordAccessToken ?? null,
    discordRefreshToken: req.session.discordRefreshToken ?? null,
    onDiscordTokensRefreshed: (tokens: { accessToken: string; refreshToken: string | null }) => {
      req.session.discordAccessToken = tokens.accessToken;
      req.session.discordRefreshToken = tokens.refreshToken ?? req.session.discordRefreshToken;
    }
  };
}

async function ensureBotGuildsLoaded() {
  if (getBotStatus().botGuilds.length === 0) {
    await refreshBotGuildsFromDiscord();
  }
}

authRouter.get("/discord", async (req, res) => {
  if (isApiAuthMount(req)) {
    const queryIndex = req.originalUrl.indexOf("?");
    const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : "";

    return res.redirect(canonicalAuthUrl("/discord", query));
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
    const verifiedState = state ? verifyOAuthState(state, req) : false;

    if (!code || !state || !verifiedState) {
      console.warn("[auth] callback recusado: state ausente ou invalido.");
      clearAuthCookies(res);
      return res.redirect(errorRedirectUrl("callback"));
    }

    console.info("[auth] oauth: trocando code do Discord.");
    const tokens = await withAuthTimeout("discord_token_exchange", exchangeDiscordCode(code));
    await withAuthTimeout("bot_guilds_refresh", ensureBotGuildsLoaded());
    console.info("[auth] oauth: buscando usuario e guilds do Discord.");
    const [discordUser, discordGuilds] = await Promise.all([
      withAuthTimeout("discord_user_fetch", fetchDiscordUser(tokens.access_token)),
      withAuthTimeout("discord_guilds_fetch", fetchDiscordGuilds(tokens.access_token))
    ]);
    const guilds = toDashboardGuilds(discordGuilds);
    const baseUser = {
      id: discordUser.id,
      discordId: discordUser.id,
      username: discordUser.global_name ?? discordUser.username,
      globalName: discordUser.global_name ?? null,
      discriminator: discordUser.discriminator ?? null,
      tag: discordUserTag(discordUser),
      avatar: discordUser.avatar,
      avatarUrl: discordAvatarUrl(discordUser),
      email: discordUser.email ?? null,
      guilds,
      selectedGuildId: guilds[0]?.id ?? null,
      accessLevel: "viewer" as const,
      authorized: false,
      lastLoginAt: new Date().toISOString()
    };
    console.info(`[auth] oauth: validando liberacao da dashboard para ${discordUser.id}.`);
    const validation = await withAuthTimeout(
      "dashboard_access_validation",
      evaluateDashboardAccess(baseUser, {
        botSlug: verifiedState.botSlug,
        discordAccessToken: tokens.access_token,
        discordRefreshToken: tokens.refresh_token
      })
    );

    if (!validation.allowed) {
      console.warn(`[auth] oauth: acesso negado para ${discordUser.id}: ${validation.rejectionReasons.join(" | ") || "sem motivo detalhado"}`);
      clearAuthCookies(res);
      req.session.user = undefined;
      req.session.verified = false;
      req.session.discordAccessToken = undefined;
      req.session.discordRefreshToken = undefined;
      req.session.oauthState = undefined;
      await saveSession(req).catch(() => undefined);
      return res.redirect(errorRedirectUrl("denied"));
    }

    const user = await withAuthTimeout("dashboard_user_save", saveDiscordUser(discordUser, tokens));
    const sessionBaseUser = {
      ...baseUser,
      id: user.id,
      selectedGuildId: user.selectedGuildId && guilds.some((guild) => guild.id === user.selectedGuildId)
        ? user.selectedGuildId
        : baseUser.selectedGuildId,
      lastLoginAt: user.lastLoginAt?.toISOString?.() ?? baseUser.lastLoginAt
    };

    req.session.user = applyDashboardAccessValidation(sessionBaseUser, validation);
    req.session.verified = false;
    req.session.oauthState = undefined;
    req.session.discordAccessToken = tokens.access_token;
    req.session.discordRefreshToken = tokens.refresh_token;
    req.session.accessValidatedAt = Date.now();

    issueAuthCookies(res, req.session.user, false);
    await saveSession(req);
    console.info(`[auth] oauth: sessao temporaria criada para ${discordUser.id}.`);
    return res.redirect(dashboardRedirectUrl(verifiedState.botSlug));
  } catch (error) {
    console.error("[auth] oauth: falha no callback:", error instanceof Error ? error.message : error);
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

authRouter.get("/me", async (req, res, next) => {
  try {
    await withAuthTimeout("bot_guilds_refresh", ensureBotGuildsLoaded());
    const auth = resolveAuthFromRequest(req, res);

    if (!auth) {
      return res.status(401).json({
        message: "Sessao nao autenticada."
      });
    }

    const refreshedUser = await withAuthTimeout("auth_user_guild_refresh", refreshAuthUserGuilds(req, auth.user));
    const currentAuth = refreshedUser === auth.user ? auth : issueAuthCookies(res, refreshedUser, auth.verified);

    req.session.user = currentAuth.user;
    if (currentAuth.verified) {
      req.session.verified = true;
    }
    await saveSession(req);

    return res.json(createAuthResponse(currentAuth));
  } catch (error) {
    return next(error);
  }
});

authRouter.post("/refresh", async (req, res, next) => {
  try {
    await withAuthTimeout("bot_guilds_refresh", ensureBotGuildsLoaded());
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
  } catch (error) {
    return next(error);
  }
});

authRouter.get("/access-check", requireAuthenticated, async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth;
    const refreshedUser = await refreshAuthUserGuilds(req, auth.user);
    const currentAuth = refreshedUser === auth.user ? auth : issueAuthCookies(res, refreshedUser, auth.verified);
    const validation = await withAuthTimeout("dashboard_access_check", evaluateDashboardAccess(currentAuth.user, accessValidationOptions(req)));

    req.session.user = currentAuth.user;
    if (currentAuth.verified) {
      req.session.verified = true;
    }
    await saveSession(req);

    return res.json({
      validation
    });
  } catch (error) {
    return next(error);
  }
});

authRouter.post("/verify", requireAuthenticated, async (req, res, next) => {
  try {
    await withAuthTimeout("bot_guilds_refresh", ensureBotGuildsLoaded());
    const auth = res.locals.dashboardAuth;
    const refreshedUser = await refreshAuthUserGuilds(req, auth.user);
    const validation = await withAuthTimeout("dashboard_verify_access", evaluateDashboardAccess(refreshedUser, accessValidationOptions(req)));

    if (!validation.allowed) {
      const deniedAuth = issueAuthCookies(res, createDeniedAccessUser(refreshedUser), false);
      req.session.user = deniedAuth.user;
      req.session.verified = false;
      req.session.accessValidatedAt = Date.now();
      await saveSession(req);

      return res.status(403).json({
        message: ACCESS_DENIED_MESSAGE,
        validation
      });
    }

    const validatedUser = applyDashboardAccessValidation(refreshedUser, validation);
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
  } catch (error) {
    return next(error);
  }
});

async function refreshAuthUserGuilds(req: Request, user: AuthSessionUser) {
  const accessToken = req.session.discordAccessToken;

  if (!accessToken) {
    return user;
  }

  try {
    const guilds = toDashboardGuilds(await fetchDiscordGuilds(accessToken));
    const selectedGuildId = user.selectedGuildId && guilds.some((guild) => guild.id === user.selectedGuildId)
      ? user.selectedGuildId
      : guilds[0]?.id ?? null;

    return {
      ...user,
      guilds,
      selectedGuildId
    };
  } catch (error) {
    console.warn("[auth] nao foi possivel atualizar servidores do usuario:", error instanceof Error ? error.message : error);
    return user;
  }
}

authRouter.post("/logout", async (req, res, next) => {
  try {
    const discordId = req.session.user?.discordId;
    clearAuthCookies(res);
    if (discordId) {
      await clearStoredDiscordTokens(discordId);
    }
    await destroySession(req);
    res.clearCookie("discord_dashboard.sid");

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

function withAuthTimeout<T>(stage: string, promise: Promise<T>, timeoutMs = AUTH_STAGE_TIMEOUT_MS): Promise<T> {
  console.info(`[auth] etapa iniciada: ${stage}`);

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timeout = setTimeout(() => {
      const error = Object.assign(new Error(`Timeout na etapa de autenticacao: ${stage}.`), {
        statusCode: 504
      });
      console.warn(`[auth] etapa travou: ${stage} apos ${timeoutMs}ms.`);
      reject(error);
    }, timeoutMs);

    void promise
      .then((value) => {
        console.info(`[auth] etapa concluida: ${stage} em ${Date.now() - startedAt}ms.`);
        resolve(value);
      })
      .catch((error) => {
        console.warn(`[auth] etapa falhou: ${stage}:`, error instanceof Error ? error.message : error);
        reject(error);
      })
      .finally(() => clearTimeout(timeout));
  });
}

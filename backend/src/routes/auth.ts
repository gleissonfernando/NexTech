import { createHash, randomUUID } from "node:crypto";
import type { Request } from "express";
import { Router } from "express";
import { env } from "../config/env";
import {
  buildDiscordAuthUrl,
  discordAvatarUrl,
  discordUserTag,
  exchangeDiscordCode,
  fetchDiscordGuilds,
  fetchDiscordUser,
  getDiscordOAuthDiagnostics
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
import { getDevBot, getDevBotBySlug } from "../services/devBotService";
import { canAccessDevDashboard } from "../services/devPermissionService";

export const authRouter = Router();
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

function appRedirectUrl(path: string) {
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

async function createOAuthState(req: Request, input: {
  botId?: string;
  botSlug?: string;
  returnTo: string;
  type: "dev" | "bot";
}) {
  const state = randomUUID();

  req.session.oauthState = {
    ...input,
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
    state,
    ua: requestFingerprint(req)
  };
  await saveSession(req);
  return state;
}

function consumeOAuthState(req: Request, state: string) {
  const saved = req.session.oauthState;
  req.session.oauthState = undefined;

  if (
    !saved ||
    saved.state !== state ||
    saved.expiresAt < Date.now() ||
    saved.ua !== requestFingerprint(req) ||
    !isAllowedReturnTo(saved.returnTo, saved.botSlug)
  ) {
    return null;
  }

  return saved;
}

function isAllowedReturnTo(returnTo: string, botSlug?: string | null) {
  if (returnTo === "/dev") {
    return true;
  }

  return Boolean(
    botSlug &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(botSlug) &&
    returnTo === `/${botSlug}/dashboard`
  );
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

function ensureOAuthConfigured(res: Parameters<Parameters<typeof authRouter.get>[1]>[1]) {
  const diagnostics = getDiscordOAuthDiagnostics();

  console.info(`[auth] oauth config: client_id=${diagnostics.clientId} redirect_uri=${diagnostics.redirectUri} scopes=${diagnostics.scopes}.`);

  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.DISCORD_OAUTH_REDIRECT_URI) {
    console.warn(`[auth] oauth config incompleto: client_id=${diagnostics.clientId} redirect_uri=${diagnostics.redirectUri} client_secret=${diagnostics.clientSecret}.`);
    res.status(503).json({
      message: "OAuth2 Discord ainda nao esta configurado."
    });
    return false;
  }

  return true;
}

authRouter.get("/discord/dev", async (req, res, next) => {
  if (isApiAuthMount(req)) {
    const queryIndex = req.originalUrl.indexOf("?");
    const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : "";

    return res.redirect(canonicalAuthUrl("/discord/dev", query));
  }

  if (!ensureOAuthConfigured(res)) {
    return;
  }

  try {
    const state = await createOAuthState(req, {
      type: "dev",
      returnTo: "/dev"
    });
    const diagnostics = getDiscordOAuthDiagnostics();
    console.info(`[auth] login Discord iniciado: type=dev returnTo=/dev client_id=${diagnostics.clientId} redirect_uri=${diagnostics.redirectUri}.`);

    return res.redirect(buildDiscordAuthUrl(state));
  } catch (error) {
    return next(error);
  }
});

authRouter.get("/discord/bot/:slug", async (req, res, next) => {
  if (isApiAuthMount(req)) {
    const queryIndex = req.originalUrl.indexOf("?");
    const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : "";

    return res.redirect(canonicalAuthUrl(`/discord/bot/${encodeURIComponent(req.params.slug)}`, query));
  }

  if (!ensureOAuthConfigured(res)) {
    return;
  }

  try {
    const slug = req.params.slug.trim().toLowerCase();

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return res.status(400).json({
        message: "Dashboard invalida."
      });
    }

    const bot = await getDevBotBySlug(slug);

    if (!bot) {
      return res.status(404).json({
        message: "Bot nao encontrado."
      });
    }

    const returnTo = `/${bot.slug}/dashboard`;
    const state = await createOAuthState(req, {
      type: "bot",
      botId: bot.id,
      botSlug: bot.slug,
      returnTo
    });
    const diagnostics = getDiscordOAuthDiagnostics();
    console.info(`[auth] login Discord iniciado: type=bot slug=${bot.slug} botId=${bot.id} returnTo=${returnTo} client_id=${diagnostics.clientId} redirect_uri=${diagnostics.redirectUri}.`);

    return res.redirect(buildDiscordAuthUrl(state));
  } catch (error) {
    return next(error);
  }
});

authRouter.get("/discord", async (req, res) => {
  if (isApiAuthMount(req)) {
    const queryIndex = req.originalUrl.indexOf("?");
    const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : "";

    return res.redirect(canonicalAuthUrl("/discord", query));
  }

  const botSlug = readAccessBotSlug(req);

  if (botSlug) {
    return res.redirect(`/auth/discord/bot/${encodeURIComponent(botSlug)}`);
  }

  return res.redirect("/auth/discord/dev");
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
    const verifiedState = state ? consumeOAuthState(req, state) : null;
    const diagnostics = getDiscordOAuthDiagnostics();

    console.info(`[auth] callback Discord recebido: code=${code ? "present" : "missing"} state=${state ? "present" : "missing"} client_id=${diagnostics.clientId} redirect_uri=${diagnostics.redirectUri}.`);

    if (!code || !state || !verifiedState) {
      console.warn("[auth] callback recusado: state ausente ou invalido.");
      clearAuthCookies(res);
      await saveSession(req).catch(() => undefined);
      return res.redirect(errorRedirectUrl("callback"));
    }

    console.info(`[auth] callback Discord validado: type=${verifiedState.type} slug=${verifiedState.botSlug ?? "none"}.`);
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
    console.info(`[auth] oauth: usuario autenticado discordId=${discordUser.id}.`);

    let botSlugForAccess: string | null = null;
    let redirectTo = verifiedState.returnTo;

    if (verifiedState.type === "bot") {
      if (!verifiedState.botId || !verifiedState.botSlug) {
        console.warn(`[auth] oauth bot negado: state sem botId/botSlug para discordId=${discordUser.id}.`);
        clearAuthCookies(res);
        await saveSession(req).catch(() => undefined);
        return res.redirect(errorRedirectUrl("callback"));
      }

      const bot = await withAuthTimeout("dashboard_bot_lookup", getDevBot(verifiedState.botId));

      if (!bot || bot.slug !== verifiedState.botSlug) {
        console.warn(`[auth] oauth bot negado: bot inexistente ou slug divergente botId=${verifiedState.botId} slug=${verifiedState.botSlug}.`);
        clearAuthCookies(res);
        await saveSession(req).catch(() => undefined);
        return res.redirect(errorRedirectUrl("permission"));
      }

      botSlugForAccess = bot.slug;
      redirectTo = `/${bot.slug}/dashboard`;
    }

    console.info(`[auth] oauth: validando acesso type=${verifiedState.type} discordId=${discordUser.id} slug=${botSlugForAccess ?? "dev"}.`);
    const validation = await withAuthTimeout(
      "dashboard_access_validation",
      evaluateDashboardAccess(baseUser, {
        botSlug: botSlugForAccess,
        discordAccessToken: tokens.access_token,
        discordRefreshToken: tokens.refresh_token
      })
    );

    if (verifiedState.type === "dev" && !(await canAccessDevDashboard(discordUser.id))) {
      console.warn(`[auth] oauth dev negado: discordId=${discordUser.id}.`);
      clearAuthCookies(res);
      req.session.user = undefined;
      req.session.verified = false;
      req.session.discordAccessToken = undefined;
      req.session.discordRefreshToken = undefined;
      req.session.oauthState = undefined;
      await saveSession(req).catch(() => undefined);
      return res.redirect(errorRedirectUrl("permission"));
    }

    if (!validation.allowed) {
      console.warn(`[auth] oauth: acesso negado para ${discordUser.id}: ${validation.rejectionReasons.join(" | ") || "sem motivo detalhado"}`);
      clearAuthCookies(res);
      req.session.user = undefined;
      req.session.verified = false;
      req.session.discordAccessToken = undefined;
      req.session.discordRefreshToken = undefined;
      req.session.oauthState = undefined;
      await saveSession(req).catch(() => undefined);
      return res.redirect(errorRedirectUrl("permission"));
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
    console.info(`[auth] oauth: sessao temporaria criada para ${discordUser.id}; redirect=${redirectTo}.`);
    return res.redirect(appRedirectUrl(redirectTo));
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

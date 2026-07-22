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
  fetchDiscordUser,
  getDiscordOAuthDiagnostics
} from "../services/discordOAuthService";
import { toDashboardGuilds } from "../services/guildService";
import { ACCESS_DENIED_MESSAGE, SUPPORT_DISCORD_URL, requireAuthenticated } from "../middleware/auth";
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
  resolveAuthFromRequest
} from "../services/tokenService";
import { getBotStatus, refreshBotGuildsFromDiscord } from "../services/statsService";
import { clearStoredDiscordTokens, saveDiscordUser } from "../services/userService";
import type { AuthSessionUser } from "../types/session";
import { getDevBot, getDevBotBySlug, listAccessibleDashboardBots } from "../services/devBotService";
import { canAccessDevDashboard } from "../services/devPermissionService";

export const authRouter = Router();
const errorPath = "/auth/error";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
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

function cleanAppRedirectUrl(path: string) {
  return appRedirectUrl(stripAuthTemporaryParams(path));
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
  type: "dev" | "bot" | "dashboard" | "customer";
}) {
  const payload = {
    ...input,
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
    nonce: randomUUID(),
    ua: requestFingerprint(req)
  };

  return signOAuthState(payload);
}

function consumeOAuthState(req: Request, state: string) {
  const saved = verifyOAuthState(state);

  if (
    !saved ||
    saved.expiresAt < Date.now() ||
    saved.ua !== requestFingerprint(req) ||
    !isAllowedReturnTo(saved.returnTo, saved.botSlug)
  ) {
    return null;
  }

  return saved;
}

type SignedOAuthState = {
  botId?: string;
  botSlug?: string;
  expiresAt: number;
  nonce: string;
  returnTo: string;
  type: "dev" | "bot" | "dashboard" | "customer";
  ua: string;
};

function signOAuthState(payload: SignedOAuthState) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", env.SESSION_SECRET).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function verifyOAuthState(state: string): SignedOAuthState | null {
  const [encodedPayload, signature] = state.split(".");

  if (!encodedPayload || !signature) {
    return null;
  }

  const expected = createHmac("sha256", env.SESSION_SECRET).update(encodedPayload).digest("base64url");
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<SignedOAuthState>;

    if (
      typeof parsed.expiresAt !== "number" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.returnTo !== "string" ||
      (parsed.type !== "dev" && parsed.type !== "bot" && parsed.type !== "dashboard" && parsed.type !== "customer") ||
      typeof parsed.ua !== "string"
    ) {
      return null;
    }

    return parsed as SignedOAuthState;
  } catch {
    return null;
  }
}

function readReturnTo(req: Request, fallback: string, botSlug?: string | null) {
  const requested = typeof req.query.returnTo === "string" ? req.query.returnTo : null;
  return normalizeReturnTo(requested, fallback, botSlug);
}

function normalizeReturnTo(value: string | null | undefined, fallback: string, botSlug?: string | null) {
  const candidate = stripAuthTemporaryParams(toRelativeAppPath(value) ?? fallback);
  return isAllowedReturnTo(candidate, botSlug) ? candidate : fallback;
}

function toRelativeAppPath(value: string | null | undefined) {
  const trimmed = value?.trim();

  if (!trimmed || trimmed.startsWith("//")) {
    return null;
  }

  try {
    const base = env.SITE_ORIGIN || "https://nextech.local";
    const parsed = new URL(trimmed, base);

    if (/^https?:\/\//i.test(trimmed) && env.SITE_ORIGIN && parsed.origin !== new URL(env.SITE_ORIGIN).origin) {
      return null;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

function stripAuthTemporaryParams(path: string) {
  const base = env.SITE_ORIGIN || "https://nextech.local";

  try {
    const parsed = new URL(path, base);
    for (const param of ["auth", "code", "state", "error", "error_description"]) {
      parsed.searchParams.delete(param);
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return path.startsWith("/") && !path.startsWith("//") ? path : "/dashboard";
  }
}

function isAllowedReturnTo(returnTo: string, botSlug?: string | null) {
  const parsed = new URL(returnTo, env.SITE_ORIGIN || "https://nextech.local");
  const pathname = parsed.pathname;

  if (pathname === "/dev" || pathname.startsWith("/dev/")) {
    return true;
  }

  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    return true;
  }

  if (pathname === "/planos" || pathname.startsWith("/planos/")) {
    return true;
  }

  if (pathname === "/cadastrar-bot" || pathname.startsWith("/cadastrar-bot/")) {
    const params = [...parsed.searchParams.keys()];
    return params.length === 0 || (params.length === 1 && /^[a-zA-Z0-9:-]{8,120}$/.test(parsed.searchParams.get("orderId") ?? ""));
  }

  return Boolean(
    botSlug &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(botSlug) &&
    (pathname === `/${botSlug}/dashboard` || pathname.startsWith(`/${botSlug}/dashboard/`))
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

function clearSessionAuthState(req: Request, res: Parameters<Parameters<typeof authRouter.get>[1]>[1]) {
  clearAuthCookies(res);
  req.session.user = undefined;
  req.session.verified = false;
  req.session.oauth2VerifiedAt = undefined;
  req.session.oauthState = undefined;
  req.session.discordAccessToken = undefined;
  req.session.discordRefreshToken = undefined;
  req.session.accessValidatedAt = undefined;
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

function scopedBotSlug(req: Request) {
  return readAccessBotSlug(req) ?? req.session.user?.dashboardBotSlug ?? null;
}

function accessValidationOptions(req: Request) {
  return {
    botSlug: scopedBotSlug(req),
    discordAccessToken: req.session.discordAccessToken ?? null,
    discordRefreshToken: null,
    onDiscordTokensRefreshed: (tokens: { accessToken: string; refreshToken: string | null }) => {
      req.session.discordAccessToken = tokens.accessToken;
      req.session.discordRefreshToken = undefined;
    }
  };
}

function isDevDashboardRequest(req: Request) {
  return req.header("x-dev-dashboard") === "true";
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
      message: "OAuth2 Discord ainda não está configurado."
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
    const returnTo = readReturnTo(req, "/dev");
    const currentAuth = resolveAuthFromRequest(req, res);
    if (currentAuth?.verified) {
      console.info(`[auth] login Discord ignorado: sessão existente; type=dev redirect=${returnTo}.`);
      return res.redirect(cleanAppRedirectUrl(returnTo));
    }

    clearSessionAuthState(req, res);
    const state = await createOAuthState(req, {
      type: "dev",
      returnTo
    });
    const diagnostics = getDiscordOAuthDiagnostics();
    console.info(`[auth] login Discord iniciado: type=dev returnTo=${returnTo} client_id=${diagnostics.clientId} redirect_uri=${diagnostics.redirectUri}.`);

    return res.redirect(buildDiscordAuthUrl(state));
  } catch (error) {
    return next(error);
  }
});

authRouter.get("/discord/dashboard", async (req, res, next) => {
  if (isApiAuthMount(req)) {
    const queryIndex = req.originalUrl.indexOf("?");
    const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : "";

    return res.redirect(canonicalAuthUrl("/discord/dashboard", query));
  }

  if (!ensureOAuthConfigured(res)) {
    return;
  }

  try {
    const returnTo = readReturnTo(req, "/dashboard");
    const currentAuth = resolveAuthFromRequest(req, res);
    if (currentAuth?.verified) {
      console.info(`[auth] login Discord ignorado: sessão existente; type=dashboard redirect=${returnTo}.`);
      return res.redirect(cleanAppRedirectUrl(returnTo));
    }

    clearSessionAuthState(req, res);
    const state = await createOAuthState(req, {
      type: "dashboard",
      returnTo
    });
    const diagnostics = getDiscordOAuthDiagnostics();
    console.info(`[auth] login Discord iniciado: type=dashboard returnTo=${returnTo} client_id=${diagnostics.clientId} redirect_uri=${diagnostics.redirectUri}.`);

    return res.redirect(buildDiscordAuthUrl(state));
  } catch (error) {
    return next(error);
  }
});

authRouter.get("/discord/customer", async (req, res, next) => {
  if (isApiAuthMount(req)) {
    const queryIndex = req.originalUrl.indexOf("?");
    const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : "";

    return res.redirect(canonicalAuthUrl("/discord/customer", query));
  }

  if (!ensureOAuthConfigured(res)) {
    return;
  }

  try {
    const requestedReturnTo = typeof req.query.returnTo === "string" ? req.query.returnTo : "/planos";
    const returnTo = normalizeReturnTo(requestedReturnTo, "/planos");
    const currentAuth = resolveAuthFromRequest(req, res);
    if (currentAuth?.verified) {
      console.info(`[auth] login Discord ignorado: sessão existente; type=customer redirect=${returnTo}.`);
      return res.redirect(cleanAppRedirectUrl(returnTo));
    }

    clearSessionAuthState(req, res);
    const state = await createOAuthState(req, {
      type: "customer",
      returnTo
    });
    const diagnostics = getDiscordOAuthDiagnostics();
    console.info(`[auth] login Discord iniciado: type=customer returnTo=${returnTo} client_id=${diagnostics.clientId} redirect_uri=${diagnostics.redirectUri}.`);

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
        message: "Dashboard inválida."
      });
    }

    const bot = await getDevBotBySlug(slug);

    if (!bot) {
      return res.status(404).json({
        message: "Bot não encontrado."
      });
    }

    const returnTo = readReturnTo(req, `/${bot.slug}/dashboard`, bot.slug);
    const currentAuth = resolveAuthFromRequest(req, res);
    if (currentAuth?.verified) {
      console.info(`[auth] login Discord ignorado: sessão existente; type=bot slug=${bot.slug} redirect=${returnTo}.`);
      return res.redirect(cleanAppRedirectUrl(returnTo));
    }

    clearSessionAuthState(req, res);
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
    const returnTo = readReturnTo(req, `/${botSlug}/dashboard`, botSlug);
    return res.redirect(`/auth/discord/bot/${encodeURIComponent(botSlug)}?returnTo=${encodeURIComponent(returnTo)}`);
  }

  const returnTo = readReturnTo(req, "/dashboard");
  return res.redirect(`/auth/discord/dashboard?returnTo=${encodeURIComponent(returnTo)}`);
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
    const discordError = typeof req.query.error === "string" ? req.query.error : null;
    const discordErrorDescription = typeof req.query.error_description === "string" ? req.query.error_description : null;
    const verifiedState = state ? consumeOAuthState(req, state) : null;
    const diagnostics = getDiscordOAuthDiagnostics();

    console.info(`[auth] callback Discord recebido: code=${code ? "present" : "missing"} state=${state ? "present" : "missing"} error=${discordError ?? "none"} client_id=${diagnostics.clientId} redirect_uri=${diagnostics.redirectUri}.`);

    if (discordError) {
      console.warn(`[auth] callback recusado pelo Discord: error=${discordError} description=${discordErrorDescription ?? "none"}.`);
      clearSessionAuthState(req, res);
      await saveSession(req).catch(() => undefined);
      return res.redirect(errorRedirectUrl(discordError === "access_denied" ? "denied" : "oauth"));
    }

    if (!code || !state || !verifiedState) {
      console.warn("[auth] callback recusado: state ausente ou inválido.");
      clearSessionAuthState(req, res);
      await saveSession(req).catch(() => undefined);
      return res.redirect(errorRedirectUrl("callback"));
    }

    console.info(`[auth] callback Discord validado: type=${verifiedState.type} slug=${verifiedState.botSlug ?? "none"}.`);
    console.info("[auth] oauth: trocando code do Discord.");
    const tokens = await withAuthTimeout("discord_token_exchange", exchangeDiscordCode(code));
    await withAuthTimeout("bot_guilds_refresh", ensureBotGuildsLoaded());
    console.info("[auth] oauth: buscando usuário e guilds do Discord.");
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
    console.info(`[auth] oauth: usuário autenticado discordId=${discordUser.id}.`);

    let botSlugForAccess: string | null = null;
    let redirectTo = verifiedState.returnTo;

    if (verifiedState.type === "customer") {
      const user = await withAuthTimeout("customer_user_save", saveDiscordUser(discordUser, tokens));
      const customerUser = {
        ...baseUser,
        dashboardBotId: null,
        dashboardBotSlug: null,
        id: user.id,
        selectedGuildId: user.selectedGuildId && guilds.some((guild) => guild.id === user.selectedGuildId)
          ? user.selectedGuildId
          : baseUser.selectedGuildId,
        lastLoginAt: user.lastLoginAt?.toISOString?.() ?? baseUser.lastLoginAt
      };

      req.session.user = customerUser;
      req.session.verified = false;
      req.session.oauth2VerifiedAt = new Date().toISOString();
      req.session.oauthState = undefined;
      req.session.discordAccessToken = tokens.access_token;
      req.session.discordRefreshToken = undefined;
      req.session.accessValidatedAt = Date.now();

      issueAuthCookies(res, req.session.user, false);
      await saveSession(req);
      console.info(`[auth] oauth: sessão de cliente criada para ${discordUser.id}; redirect=${redirectTo}.`);
      return res.redirect(cleanAppRedirectUrl(redirectTo));
    }

    if (verifiedState.type === "bot") {
      if (!verifiedState.botId || !verifiedState.botSlug) {
        console.warn(`[auth] oauth bot negado: state sem botId/botSlug para discordId=${discordUser.id}.`);
        clearSessionAuthState(req, res);
        await saveSession(req).catch(() => undefined);
        return res.redirect(errorRedirectUrl("callback"));
      }

      const bot = await withAuthTimeout("dashboard_bot_lookup", getDevBot(verifiedState.botId));

      if (!bot || bot.slug !== verifiedState.botSlug) {
        console.warn(`[auth] oauth bot negado: bot inexistente ou slug divergente botId=${verifiedState.botId} slug=${verifiedState.botSlug}.`);
        clearSessionAuthState(req, res);
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
      clearSessionAuthState(req, res);
      await saveSession(req).catch(() => undefined);
      return res.redirect(errorRedirectUrl("permission"));
    }

    if (!validation.allowed) {
      console.warn(`[auth] oauth: acesso negado para ${discordUser.id}: ${validation.rejectionReasons.join(" | ") || "sem motivo detalhado"}`);
      clearSessionAuthState(req, res);
      await saveSession(req).catch(() => undefined);
      return res.redirect(errorRedirectUrl("permission"));
    }

    const user = await withAuthTimeout("dashboard_user_save", saveDiscordUser(discordUser, tokens));
    const sessionBaseUser = {
      ...baseUser,
      dashboardBotId: verifiedState.type === "bot" ? verifiedState.botId ?? null : null,
      dashboardBotSlug: botSlugForAccess,
      id: user.id,
      selectedGuildId: user.selectedGuildId && guilds.some((guild) => guild.id === user.selectedGuildId)
        ? user.selectedGuildId
        : baseUser.selectedGuildId,
      lastLoginAt: user.lastLoginAt?.toISOString?.() ?? baseUser.lastLoginAt
    };

    const validatedUserBase = applyDashboardAccessValidation(sessionBaseUser, validation);
    const defaultDashboardBotSlug = verifiedState.type === "dashboard"
      ? await withAuthTimeout("dashboard_default_bot_lookup", resolveDashboardBotSlugForRedirect(validatedUserBase, validatedUserBase.dashboardBotSlug))
      : validatedUserBase.dashboardBotSlug;
    const validatedUser = defaultDashboardBotSlug === validatedUserBase.dashboardBotSlug
      ? validatedUserBase
      : {
          ...validatedUserBase,
          dashboardBotSlug: defaultDashboardBotSlug
        };

    if (verifiedState.type === "dev") {
      redirectTo = "/dev";
    } else if (verifiedState.type === "dashboard") {
      redirectTo = await withAuthTimeout(
        "dashboard_redirect_resolve",
        resolvePostAuthRedirectTo(validatedUser, defaultDashboardBotSlug, { preferDevWhenNoBotSlug: true })
      );
    }

    req.session.user = validatedUser;
    req.session.verified = true;
    req.session.oauth2VerifiedAt = new Date().toISOString();
    req.session.oauthState = undefined;
    req.session.discordAccessToken = tokens.access_token;
    req.session.discordRefreshToken = undefined;
    req.session.accessValidatedAt = Date.now();

    issueAuthCookies(res, req.session.user, true);
    await saveSession(req);
    console.info(`[auth] oauth: sessão autenticada e verificada criada para ${discordUser.id}; redirect=${redirectTo}.`);
    return res.redirect(cleanAppRedirectUrl(redirectTo));
  } catch (error) {
    console.error("[auth] oauth: falha no callback:", error instanceof Error ? error.message : error);
    clearAuthCookies(res);
    if (req.session) {
      req.session.oauthState = undefined;
      req.session.oauth2VerifiedAt = undefined;
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
      console.info("[auth] /me sem sessão válida.");
      return res.status(401).json({
        message: "Sessão não autenticada."
      });
    }

    const refreshedUser = await withAuthTimeout("auth_user_guild_refresh", refreshAuthUserGuilds(req, auth.user));
    let currentAuth = refreshedUser === auth.user ? auth : issueAuthCookies(res, refreshedUser, auth.verified);
    let validation: Awaited<ReturnType<typeof evaluateDashboardAccess>> | null = null;

    if (!currentAuth.verified) {
      validation = await withAuthTimeout("dashboard_access_check", evaluateDashboardAccess(currentAuth.user, accessValidationOptions(req)));

      if (validation.allowed) {
        currentAuth = issueAuthCookies(res, applyDashboardAccessValidation(currentAuth.user, validation), false);
      } else {
        currentAuth = issueAuthCookies(res, createDeniedAccessUser(currentAuth.user), false);
      }

      req.session.accessValidatedAt = Date.now();
    }

    req.session.user = currentAuth.user;
    req.session.oauth2VerifiedAt ??= new Date().toISOString();
    if (currentAuth.verified) {
      req.session.verified = true;
    } else {
      req.session.verified = false;
    }
    await saveSession(req);

    const redirectTo = await withAuthTimeout(
      "dashboard_me_redirect_resolve",
      resolvePostAuthRedirectTo(currentAuth.user, currentAuth.user.dashboardBotSlug, {
        preferDevWhenNoBotSlug: !currentAuth.user.dashboardBotSlug
      })
    );

    console.info(`[auth] /me sessão válida: discordId=${currentAuth.user.discordId} verified=${currentAuth.verified} redirect=${redirectTo}.`);

    return res.json({
      ...createAuthResponse(currentAuth),
      validation: validation ?? undefined,
      redirectTo,
      verificationToken: currentAuth.verified ? issueVerificationToken(currentAuth.user) : undefined
    });
  } catch (error) {
    return next(error);
  }
});

authRouter.post("/refresh", async (req, res, next) => {
  try {
    clearAuthCookies(res);
    req.session.user = undefined;
    req.session.verified = false;
    req.session.oauth2VerifiedAt = undefined;
    req.session.discordAccessToken = undefined;
    req.session.discordRefreshToken = undefined;
    await saveSession(req);

    return res.status(401).json({
      message: "Renovacao automática de sessão desativada. Autentique novamente pelo Discord."
    });
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
    req.session.oauth2VerifiedAt ??= new Date().toISOString();
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
      req.session.oauth2VerifiedAt ??= new Date().toISOString();
      req.session.accessValidatedAt = Date.now();
      await saveSession(req);

      return res.status(403).json({
        message: ACCESS_DENIED_MESSAGE,
        supportUrl: SUPPORT_DISCORD_URL,
        validation
      });
    }

    const validatedUserBase = applyDashboardAccessValidation(refreshedUser, validation);
    const requestedBotSlug = readAccessBotSlug(req) ?? validatedUserBase.dashboardBotSlug;
    const defaultDashboardBotSlug = await withAuthTimeout(
      "dashboard_default_bot_lookup",
      resolveDashboardBotSlugForRedirect(validatedUserBase, requestedBotSlug)
    );
    const validatedUser = defaultDashboardBotSlug === validatedUserBase.dashboardBotSlug
      ? validatedUserBase
      : {
          ...validatedUserBase,
          dashboardBotSlug: defaultDashboardBotSlug
        };
    const redirectTo = await withAuthTimeout(
      "dashboard_verify_redirect_resolve",
      resolvePostAuthRedirectTo(validatedUser, defaultDashboardBotSlug, {
        preferDevWhenNoBotSlug: isDevDashboardRequest(req) || !requestedBotSlug
      })
    );
    const verifiedAuth = issueAuthCookies(
      res,
      validatedUser,
      true
    );

    req.session.user = verifiedAuth.user;
    req.session.verified = verifiedAuth.verified;
    req.session.oauth2VerifiedAt ??= new Date().toISOString();
    req.session.accessValidatedAt = Date.now();
    await saveSession(req);

    return res.json({
      ...createAuthResponse(verifiedAuth),
      validation,
      redirectTo,
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
    console.warn("[auth] não foi possível atualizar servidores do usuário:", error instanceof Error ? error.message : error);
    return user;
  }
}

async function resolveDashboardBotSlugForRedirect(user: AuthSessionUser, currentSlug: string | null | undefined) {
  if (currentSlug) {
    return currentSlug;
  }

  const bots = await listAccessibleDashboardBots(user).catch(() => []);
  return bots[0]?.slug ?? null;
}

async function resolvePostAuthRedirectTo(
  user: AuthSessionUser,
  botSlug: string | null | undefined,
  options: { preferDevWhenNoBotSlug?: boolean } = {}
) {
  if (!botSlug && options.preferDevWhenNoBotSlug && await canAccessDevDashboard(user.discordId)) {
    return "/dev";
  }

  const resolvedBotSlug = await resolveDashboardBotSlugForRedirect(user, botSlug);
  return resolvedBotSlug ? `/${resolvedBotSlug}/dashboard` : "/dashboard";
}

authRouter.post("/logout", async (req, res, next) => {
  try {
    const discordId = req.session.user?.discordId;
    clearAuthCookies(res);
    if (discordId) {
      await clearStoredDiscordTokens(discordId);
    }
    await destroySession(req);
    res.clearCookie("discord_dashboard.sid", {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      path: "/"
    });
    console.info(`[auth] logout concluído: discordId=${discordId ?? "unknown"}.`);

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

import { randomUUID } from "node:crypto";
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
import { demoGuilds, toDashboardGuilds } from "../services/guildService";
import { requireAuthenticated } from "../middleware/auth";
import { requireDashboardAccessValidation } from "../middleware/roleValidation";
import { evaluateDashboardAccess } from "../services/accessControlService";
import {
  clearAuthCookies,
  createAuthResponse,
  issueAuthCookies,
  refreshAuthFromRequest,
  resolveAuthFromRequest
} from "../services/tokenService";
import { issueLocalAccess } from "../services/localAccessService";
import { saveDiscordUser } from "../services/userService";

export const authRouter = Router();
const dashboardPath = "/dashboard";
const errorPath = "/auth/error";

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

authRouter.get("/discord", async (req, res) => {
  if (isApiAuthMount(req)) {
    return res.redirect(canonicalAuthUrl("/discord"));
  }

  if (!env.DASHBOARD_AUTH_REQUIRED) {
    await issueLocalAccess(req, res);
    return res.redirect(dashboardRedirectUrl());
  }

  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.DISCORD_OAUTH_REDIRECT_URI) {
    return res.status(503).json({
      message: "OAuth2 Discord ainda nao esta configurado."
    });
  }

  const state = randomUUID();
  req.session.oauthState = state;
  await saveSession(req);

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

    if (!code || !state || state !== req.session.oauthState) {
      clearAuthCookies(res);
      return res.redirect(errorRedirectUrl("callback"));
    }

    const tokens = await exchangeDiscordCode(code);
    const discordUser = await fetchDiscordUser(tokens.access_token);
    const discordGuilds = await fetchDiscordGuilds(tokens.access_token);
    const user = await saveDiscordUser(discordUser, tokens);
    const guilds = toDashboardGuilds(discordGuilds);
    const baseUser = {
      id: user.id,
      discordId: discordUser.id,
      username: discordUser.global_name ?? discordUser.username,
      tag: discordUserTag(discordUser),
      avatar: discordAvatarUrl(discordUser),
      email: discordUser.email,
      guilds,
      accessLevel: "viewer" as const,
      authorized: false,
      lastLoginAt: user.lastLoginAt?.toISOString?.() ?? new Date().toISOString()
    };
    const validation = await evaluateDashboardAccess(baseUser);

    req.session.user = {
      ...baseUser,
      accessLevel: validation.accessLevel,
      authorized: validation.authorizedUser
    };
    req.session.oauthState = undefined;

    issueAuthCookies(res, req.session.user, validation.allowed);
    await saveSession(req);
    return res.redirect(validation.allowed ? dashboardRedirectUrl() : errorRedirectUrl("permission"));
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

authRouter.post("/dev", async (req, res) => {
  if (!env.DEV_AUTH_ENABLED) {
    return res.status(404).json({
      message: "Login de desenvolvimento desativado."
    });
  }

  req.session.user = {
    id: "dev-user",
    discordId: "100000000000000000",
    username: "Admin Dev",
    tag: "admin-dev",
    avatar: null,
    email: "admin@example.local",
    guilds: demoGuilds,
    accessLevel: "admin",
    authorized: true,
    lastLoginAt: new Date().toISOString()
  };

  const auth = issueAuthCookies(res, req.session.user, true);
  await saveSession(req);

  return res.json(createAuthResponse(auth));
});

authRouter.get("/me", async (req, res) => {
  if (!env.DASHBOARD_AUTH_REQUIRED) {
    const auth = await issueLocalAccess(req, res);
    return res.json(createAuthResponse(auth));
  }

  const auth = resolveAuthFromRequest(req, res);

  if (!auth) {
    return res.status(401).json({
      message: "Sessao nao autenticada."
    });
  }

  req.session.user = auth.user;
  await saveSession(req);

  return res.json(createAuthResponse(auth));
});

authRouter.post("/refresh", async (req, res) => {
  if (!env.DASHBOARD_AUTH_REQUIRED) {
    const auth = await issueLocalAccess(req, res);
    return res.json(createAuthResponse(auth));
  }

  const auth = refreshAuthFromRequest(req, res);

  if (!auth) {
    return res.status(401).json({
      message: "Sessao expirada."
    });
  }

  req.session.user = auth.user;
  await saveSession(req);

  return res.json(createAuthResponse(auth));
});

authRouter.post("/verify", requireAuthenticated, requireDashboardAccessValidation, async (req, res) => {
  const auth = res.locals.dashboardAuth;
  const validation = res.locals.accessValidation;
  const verifiedAuth = issueAuthCookies(
    res,
    {
      ...auth.user,
      accessLevel: validation.accessLevel,
      authorized: validation.authorizedUser
    },
    validation.allowed
  );

  req.session.user = verifiedAuth.user;
  await saveSession(req);

  return res.json({
    ...createAuthResponse(verifiedAuth),
    validation
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

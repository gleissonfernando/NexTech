import type { Request, Response } from "express";
import jwt, { TokenExpiredError, type JwtPayload } from "jsonwebtoken";
import { env } from "../config/env";
import type { AuthSessionUser } from "../types/session";
import { filterGuildsForBot } from "./statsService";

const ACCESS_COOKIE = "dashboard.access_token";
const REFRESH_COOKIE = "dashboard.refresh_token";

type DashboardTokenPayload = JwtPayload & {
  type: "access" | "refresh";
  user: AuthSessionUser;
  verified: boolean;
};

export type DashboardAuth = {
  user: AuthSessionUser;
  verified: boolean;
  tokenExpiresAt: string;
};

export function issueAuthCookies(res: Response, user: AuthSessionUser, verified: boolean) {
  const accessToken = signToken("access", user, verified, env.JWT_ACCESS_TTL_SECONDS);
  const refreshToken = signToken("refresh", user, verified, env.JWT_REFRESH_TTL_SECONDS);

  setAuthCookie(res, ACCESS_COOKIE, accessToken, env.JWT_ACCESS_TTL_SECONDS);
  setAuthCookie(res, REFRESH_COOKIE, refreshToken, env.JWT_REFRESH_TTL_SECONDS);

  return buildAuthFromToken(accessToken);
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, cookieOptions());
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
}

export function createAuthResponse(auth: DashboardAuth) {
  const user = normalizeAuthUser(auth.user);
  const canManageDashboard = user.accessLevel === "admin";

  return {
    user,
    guilds: user.guilds,
    permissions: {
      canManageGuilds: canManageDashboard,
      canManageDashboard,
      canConfigureGuilds: canManageDashboard
    },
    access: {
      authenticated: true,
      verified: auth.verified,
      level: user.accessLevel,
      verificationMode: env.DASHBOARD_VERIFICATION_MODE,
      tokenExpiresAt: auth.tokenExpiresAt
    }
  };
}

export function resolveAuthFromRequest(req: Request, res: Response) {
  const accessToken = readCookie(req, ACCESS_COOKIE);

  if (accessToken) {
    try {
      return buildAuthFromToken(accessToken);
    } catch (error) {
      if (!(error instanceof TokenExpiredError)) {
        clearAuthCookies(res);
        return issueAuthFromSession(req, res);
      }
    }
  }

  return refreshAuthFromRequest(req, res);
}

export function refreshAuthFromRequest(req: Request, res: Response) {
  const refreshToken = readCookie(req, REFRESH_COOKIE);

  if (!refreshToken) {
    return issueAuthFromSession(req, res);
  }

  try {
    const payload = verifyToken(refreshToken, "refresh");
    return issueAuthCookies(res, payload.user, payload.verified);
  } catch {
    clearAuthCookies(res);
    return issueAuthFromSession(req, res);
  }
}

function issueAuthFromSession(req: Request, res: Response) {
  if (!req.session.user) {
    return null;
  }

  return issueAuthCookies(res, req.session.user, req.session.verified === true);
}

function signToken(type: "access" | "refresh", user: AuthSessionUser, verified: boolean, expiresIn: number) {
  return jwt.sign(
    {
      type,
      user: normalizeAuthUser(user),
      verified
    },
    env.JWT_SECRET,
    {
      expiresIn
    }
  );
}

function buildAuthFromToken(token: string): DashboardAuth {
  const payload = verifyToken(token, "access");

  return {
    user: normalizeAuthUser(payload.user),
    verified: payload.verified,
    tokenExpiresAt: new Date((payload.exp ?? 0) * 1000).toISOString()
  };
}

function verifyToken(token: string, expectedType: "access" | "refresh") {
  const payload = jwt.verify(token, env.JWT_SECRET) as DashboardTokenPayload;

  if (payload.type !== expectedType || !payload.user) {
    throw new Error("Token invalido.");
  }

  return payload;
}

function normalizeAuthUser(user: AuthSessionUser): AuthSessionUser {
  const guilds = filterGuildsForBot(user.guilds);
  const authorized = user.authorized ?? getAuthorizedUserIds().has(user.discordId);
  const hasAdminGuild = guilds.some((guild) => guild.owner || guild.isAdmin);
  const accessLevel = authorized || hasAdminGuild ? "admin" : "viewer";

  return {
    ...user,
    guilds,
    accessLevel,
    authorized,
    lastLoginAt: user.lastLoginAt ?? new Date().toISOString()
  };
}

function getAuthorizedUserIds() {
  return new Set(
    env.DASHBOARD_AUTHORIZED_USER_IDS.split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );
}

function setAuthCookie(res: Response, name: string, value: string, maxAgeSeconds: number) {
  res.cookie(name, value, {
    ...cookieOptions(),
    maxAge: maxAgeSeconds * 1000
  });
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production",
    path: "/"
  };
}

function readCookie(req: Request, name: string) {
  return typeof req.cookies?.[name] === "string" ? (req.cookies[name] as string) : null;
}

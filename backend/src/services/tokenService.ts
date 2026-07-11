import type { Request, Response } from "express";
import jwt, { TokenExpiredError, type JwtPayload } from "jsonwebtoken";
import { isDashboardDevUserId } from "../config/devOwner";
import { env } from "../config/env";
import type { AuthSessionUser } from "../types/session";
import {
  dashboardPermissionsForLevel,
  normalizeSessionAccessLevel
} from "./dashboardPermissionService";
import { getDiscordAvatarUrl } from "./discordAssetService";
import { mergeAuthorizedBotGuilds } from "./statsService";

const ACCESS_COOKIE = "dashboard.access_token";
const REFRESH_COOKIE = "dashboard.refresh_token";
const VERIFICATION_COOKIE = "dashboard.verification_session";

type DashboardTokenPayload = JwtPayload & {
  type: "access" | "refresh";
  user: AuthSessionUser;
  verified: boolean;
};

type DashboardVerificationPayload = JwtPayload & {
  type: "verification";
  discordId: string;
};

export type DashboardAuth = {
  user: AuthSessionUser;
  verified: boolean;
  tokenExpiresAt: string;
};

export function issueAuthCookies(res: Response, user: AuthSessionUser, verified: boolean) {
  const accessToken = signToken("access", user, verified, env.JWT_ACCESS_TTL_SECONDS);

  setAuthCookie(res, ACCESS_COOKIE, accessToken, env.JWT_ACCESS_TTL_SECONDS);
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
  clearVerificationCookie(res);

  return buildAuthFromToken(accessToken);
}

export function issueVerificationToken(user: AuthSessionUser) {
  return signVerificationToken(user);
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, cookieOptions());
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
  clearVerificationCookie(res);
}

export function createAuthResponse(auth: DashboardAuth) {
  const user = normalizeAuthUser(auth.user);
  const permissions = dashboardPermissionsForLevel(user.accessLevel);

  return {
    user,
    guilds: user.guilds,
    permissions: {
      ...permissions,
      canManageGuilds: permissions.canManageGuilds,
      canManageDashboard: permissions.canManageDashboard || permissions.canManageOwnServices,
      canConfigureGuilds: permissions.canConfigureGuilds
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
      return applyBrowserVerification(req, buildAuthFromToken(accessToken));
    } catch (error) {
      if (!(error instanceof TokenExpiredError)) {
        clearAuthCookies(res);
      }
    }
  }

  return null;
}

export function resolveAuthFromCookieHeader(cookieHeader: string | undefined) {
  const accessToken = readCookieHeader(cookieHeader, ACCESS_COOKIE);

  if (!accessToken) {
    return null;
  }

  try {
    return buildAuthFromToken(accessToken);
  } catch {
    return null;
  }
}

export function isValidDashboardVerificationToken(token: unknown, discordId: string) {
  if (typeof token !== "string" || !token.trim()) {
    return false;
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as DashboardVerificationPayload;
    return payload.type === "verification" && payload.discordId === discordId;
  } catch {
    return false;
  }
}

export function refreshAuthFromRequest(req: Request, res: Response) {
  void req;
  clearAuthCookies(res);
  return null;
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

function applyBrowserVerification(req: Request, auth: DashboardAuth): DashboardAuth {
  if (!auth.verified || hasVerificationHeader(req, auth.user)) {
    return auth;
  }

  return {
    ...auth,
    verified: false
  };
}

function normalizeAuthUser(user: AuthSessionUser): AuthSessionUser {
  // `user.authorized` is only written after the server validates the account
  // against the persisted DEV permissions. Keep that signed authorization in
  // the session token instead of downgrading every non-owner DEV to viewer.
  // Access is still revalidated by the auth middleware and DEV routes, so a
  // removed permission is revoked on the next request/recheck.
  const authorized = isDashboardDevUserId(user.discordId) || user.authorized === true;
  const guilds = authorized ? mergeAuthorizedBotGuilds(user.guilds) : user.guilds;
  const accessLevel = authorized
    ? "admin"
    : normalizeSessionAccessLevel(user.accessLevel);
  const selectedGuildId =
    user.selectedGuildId && guilds.some((guild) => guild.id === user.selectedGuildId)
      ? user.selectedGuildId
      : guilds[0]?.id ?? null;

  return {
    ...user,
    globalName: user.globalName ?? null,
    discriminator: user.discriminator ?? null,
    avatarUrl: normalizeAvatarUrl(user),
    guilds,
    selectedGuildId,
    accessLevel,
    authorized,
    lastLoginAt: user.lastLoginAt ?? new Date().toISOString()
  };
}

function normalizeAvatarUrl(user: AuthSessionUser) {
  if (user.avatarUrl) {
    return user.avatarUrl;
  }

  if (!user.avatar) {
    return null;
  }

  if (/^https?:\/\//i.test(user.avatar)) {
    return user.avatar;
  }

  return getDiscordAvatarUrl(user.discordId, user.avatar);
}

function setAuthCookie(res: Response, name: string, value: string, _maxAgeSeconds: number) {
  res.cookie(name, value, {
    ...cookieOptions()
  });
}

function clearVerificationCookie(res: Response) {
  res.clearCookie(VERIFICATION_COOKIE, cookieOptions());
}

function signVerificationToken(user: AuthSessionUser) {
  return jwt.sign(
    {
      type: "verification",
      discordId: user.discordId
    },
    env.JWT_SECRET,
    {
      expiresIn: env.JWT_REFRESH_TTL_SECONDS
    }
  );
}

function hasVerificationHeader(req: Request, user: AuthSessionUser) {
  return isValidDashboardVerificationToken(req.header("x-dashboard-verification"), user.discordId);
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: env.NODE_ENV === "production",
    path: "/"
  };
}

function readCookie(req: Request, name: string) {
  return typeof req.cookies?.[name] === "string" ? (req.cookies[name] as string) : null;
}

function readCookieHeader(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");

    if (separator < 0 || part.slice(0, separator).trim() !== name) {
      continue;
    }

    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }

  return null;
}

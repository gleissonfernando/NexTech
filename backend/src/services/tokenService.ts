import type { Request, Response } from "express";
import jwt, { TokenExpiredError, type JwtPayload } from "jsonwebtoken";
import { env } from "../config/env";
import type { AuthSessionUser } from "../types/session";
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
  const refreshToken = signToken("refresh", user, verified, env.JWT_REFRESH_TTL_SECONDS);

  setAuthCookie(res, ACCESS_COOKIE, accessToken, env.JWT_ACCESS_TTL_SECONDS);
  setAuthCookie(res, REFRESH_COOKIE, refreshToken, env.JWT_REFRESH_TTL_SECONDS);
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
      return applyBrowserVerification(req, buildAuthFromToken(accessToken));
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
    return applyBrowserVerification(req, issueAuthCookies(res, payload.user, payload.verified));
  } catch {
    clearAuthCookies(res);
    return issueAuthFromSession(req, res);
  }
}

function issueAuthFromSession(req: Request, res: Response) {
  if (!req.session.user) {
    return null;
  }

  return applyBrowserVerification(req, issueAuthCookies(res, req.session.user, req.session.verified === true));
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
  const authorized = user.authorized ?? getAuthorizedUserIds().has(user.discordId);
  const guilds = authorized ? mergeAuthorizedBotGuilds(user.guilds) : user.guilds;
  const accessLevel = authorized || user.accessLevel === "admin" ? "admin" : "viewer";
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
  const token = req.header("x-dashboard-verification")?.trim();

  if (!token) {
    return false;
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as DashboardVerificationPayload;
    return payload.type === "verification" && payload.discordId === user.discordId;
  } catch {
    return false;
  }
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

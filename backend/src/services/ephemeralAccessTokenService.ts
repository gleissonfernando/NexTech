import { randomBytes, randomUUID } from "node:crypto";
import jwt, { JsonWebTokenError, TokenExpiredError, type Algorithm, type JwtPayload } from "jsonwebtoken";
import type { AuthSessionUser } from "../types/session";
import { env } from "../config/env";
import { dashboardPermissionsForLevel } from "./dashboardPermissionService";

export const EPHEMERAL_TOKEN_TTL_SECONDS = 15 * 60;

export const EPHEMERAL_TOKEN_SCOPES = [
  "api:read",
  "api:write",
  "dashboard:read",
  "dashboard:write",
  "dev:read",
  "dev:write"
] as const;

export type EphemeralTokenScope = (typeof EPHEMERAL_TOKEN_SCOPES)[number];

export type EphemeralTokenValidation =
  | { ok: true; payload: EphemeralAccessTokenPayload; remainingRequests: number }
  | { ok: false; status: number; code: EphemeralTokenErrorCode; message: string };

export type EphemeralTokenErrorCode =
  | "TOKEN_MISSING"
  | "INVALID_TOKEN"
  | "TOKEN_EXPIRED"
  | "INVALID_SIGNATURE"
  | "INSUFFICIENT_SCOPE"
  | "RATE_LIMITED";

export type EphemeralAccessTokenPayload = JwtPayload & {
  aud: string;
  exp: number;
  iat: number;
  iss: string;
  jti: string;
  rnd: string;
  scopes: EphemeralTokenScope[];
  sid: string;
  sub: string;
  typ: "ephemeral_access";
  ver: 1;
};

type IssueInput = {
  audience?: string | null;
  requestedScopes?: string[] | null;
  sessionId?: string | null;
  user: AuthSessionUser;
};

type MemoryCounter = {
  count: number;
  resetAt: number;
};

type RevokedToken = {
  expiresAt: number;
  userId: string;
};

const generationCounters = new Map<string, MemoryCounter>();
const requestCounters = new Map<string, MemoryCounter>();
const revokedTokens = new Map<string, RevokedToken>();

export function issueEphemeralAccessToken(input: IssueInput) {
  const nowMs = Date.now();
  const generation = consumeGenerationLimit(input.user.discordId, nowMs);

  if (!generation.allowed) {
    logTokenEvent("token_rate_limited", input.user.discordId, input.sessionId ?? null, { resetAt: new Date(generation.resetAt).toISOString() });
    return {
      ok: false as const,
      retryAfterSeconds: Math.max(1, Math.ceil((generation.resetAt - nowMs) / 1000))
    };
  }

  const now = Math.floor(nowMs / 1000);
  const expiresAt = now + EPHEMERAL_TOKEN_TTL_SECONDS;
  const audience = normalizeAudience(input.audience);
  const scopes = normalizeRequestedScopes(input.requestedScopes, scopesForUser(input.user));
  const jti = randomUUID();
  const payload: EphemeralAccessTokenPayload = {
    aud: audience,
    exp: expiresAt,
    iat: now,
    iss: env.EPHEMERAL_TOKEN_ISSUER,
    jti,
    rnd: randomBytes(24).toString("base64url"),
    scopes,
    sid: input.sessionId || input.user.sessionId || randomUUID(),
    sub: input.user.discordId,
    typ: "ephemeral_access",
    ver: 1
  };

  const token = jwt.sign(payload, signingSecret(), {
    algorithm: env.EPHEMERAL_TOKEN_ALGORITHM as Algorithm
  });

  logTokenEvent("token_issued", input.user.discordId, payload.sid, { audience, expiresAt: new Date(expiresAt * 1000).toISOString(), jti, scopes });

  return {
    ok: true as const,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    expiresInSeconds: EPHEMERAL_TOKEN_TTL_SECONDS,
    issuedAt: new Date(now * 1000).toISOString(),
    jti,
    token,
    tokenType: "Bearer",
    scopes
  };
}

export function validateEphemeralAccessToken(
  token: string | null | undefined,
  options: { audience?: string | null; requiredScopes?: string[] | null; consumeRequest?: boolean } = {}
): EphemeralTokenValidation {
  const rawToken = token?.trim();

  if (!rawToken) {
    return tokenError(401, "TOKEN_MISSING", "The temporary access token is required.");
  }

  if (!looksLikeJwt(rawToken)) {
    return tokenError(401, "INVALID_TOKEN", "The temporary access token is malformed.");
  }

  let payload: EphemeralAccessTokenPayload;

  try {
    payload = jwt.verify(rawToken, signingSecret(), {
      algorithms: [env.EPHEMERAL_TOKEN_ALGORITHM as Algorithm],
      audience: normalizeAudience(options.audience),
      clockTolerance: env.EPHEMERAL_TOKEN_CLOCK_SKEW_SECONDS,
      issuer: env.EPHEMERAL_TOKEN_ISSUER
    }) as EphemeralAccessTokenPayload;
  } catch (error) {
    const mapped = mapJwtError(error);
    logTokenEvent(mapped.code === "TOKEN_EXPIRED" ? "token_expired" : "token_rejected", null, null, {
      code: mapped.code,
      reason: error instanceof Error ? error.message : "unknown"
    });
    return mapped;
  }

  if (!isEphemeralPayload(payload)) {
    logTokenEvent("token_rejected", null, null, { code: "INVALID_TOKEN", reason: "payload_shape" });
    return tokenError(401, "INVALID_TOKEN", "The temporary access token is invalid.");
  }

  if (revokedTokens.has(payload.jti)) {
    logTokenEvent("token_rejected", payload.sub, payload.sid, { code: "INVALID_TOKEN", jti: payload.jti, reason: "revoked" });
    return tokenError(401, "INVALID_TOKEN", "The temporary access token is invalid.");
  }

  const missingScope = missingRequiredScope(payload.scopes, options.requiredScopes);
  if (missingScope) {
    logTokenEvent("token_rejected", payload.sub, payload.sid, { code: "INSUFFICIENT_SCOPE", jti: payload.jti, missingScope });
    return tokenError(403, "INSUFFICIENT_SCOPE", "The temporary access token does not include the required permission.");
  }

  const remainingRequests = options.consumeRequest === false ? remainingTokenRequests(payload.jti) : consumeTokenRequest(payload);
  if (remainingRequests < 0) {
    logTokenEvent("token_rate_limited", payload.sub, payload.sid, { jti: payload.jti });
    return tokenError(429, "RATE_LIMITED", "The temporary access token request limit was exceeded.");
  }

  logTokenEvent("token_validated", payload.sub, payload.sid, { audience: payload.aud, jti: payload.jti, scopes: payload.scopes });
  return { ok: true, payload, remainingRequests };
}

export function revokeEphemeralAccessToken(token: string | null | undefined) {
  const validation = validateEphemeralAccessToken(token, { consumeRequest: false });

  if (!validation.ok) {
    return validation;
  }

  revokedTokens.set(validation.payload.jti, {
    expiresAt: validation.payload.exp * 1000,
    userId: validation.payload.sub
  });
  cleanupMemory(Date.now());
  logTokenEvent("token_revoked", validation.payload.sub, validation.payload.sid, { jti: validation.payload.jti });
  return { ok: true as const, jti: validation.payload.jti };
}

export function extractBearerToken(header: string | undefined) {
  const value = header?.trim();
  if (!value) return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function normalizeAudience(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || env.EPHEMERAL_TOKEN_AUDIENCE;
}

function normalizeRequestedScopes(requestedScopes: string[] | null | undefined, allowedScopes: EphemeralTokenScope[]) {
  const allowed = new Set(allowedScopes);
  const requested = Array.isArray(requestedScopes)
    ? requestedScopes.map((scope) => scope.trim()).filter(Boolean)
    : ["api:read"];
  const normalized = requested.filter((scope): scope is EphemeralTokenScope => isEphemeralTokenScope(scope) && allowed.has(scope));
  return normalized.length ? [...new Set(normalized)] : (["api:read"] satisfies EphemeralTokenScope[]);
}

function scopesForUser(user: AuthSessionUser): EphemeralTokenScope[] {
  const permissions = dashboardPermissionsForLevel(user.accessLevel);
  const scopes = new Set<EphemeralTokenScope>(["api:read", "dashboard:read"]);

  if (permissions.canManageDashboard || permissions.canManageOwnServices || permissions.canConfigureGuilds) {
    scopes.add("api:write");
    scopes.add("dashboard:write");
  }

  if (permissions.canManageBots || permissions.canManageGlobalSettings || permissions.canManageUsers) {
    scopes.add("dev:read");
    scopes.add("dev:write");
  }

  return [...scopes];
}

function isEphemeralTokenScope(value: string): value is EphemeralTokenScope {
  return (EPHEMERAL_TOKEN_SCOPES as readonly string[]).includes(value);
}

function signingSecret() {
  return `${env.JWT_SECRET}:ephemeral-access:v1`;
}

function consumeGenerationLimit(userId: string, now: number) {
  const key = `user:${userId}`;
  const bucket = generationCounters.get(key);
  const resetAt = now + EPHEMERAL_TOKEN_TTL_SECONDS * 1000;

  cleanupMemory(now);

  if (!bucket || bucket.resetAt <= now) {
    generationCounters.set(key, { count: 1, resetAt });
    return { allowed: true, resetAt };
  }

  bucket.count += 1;
  return { allowed: bucket.count <= env.EPHEMERAL_TOKEN_GENERATION_LIMIT, resetAt: bucket.resetAt };
}

function consumeTokenRequest(payload: EphemeralAccessTokenPayload) {
  const now = Date.now();
  const expiresAt = payload.exp * 1000;
  const bucket = requestCounters.get(payload.jti);

  cleanupMemory(now);

  if (!bucket || bucket.resetAt <= now) {
    requestCounters.set(payload.jti, { count: 1, resetAt: expiresAt });
    return env.EPHEMERAL_TOKEN_REQUEST_LIMIT - 1;
  }

  bucket.count += 1;
  return env.EPHEMERAL_TOKEN_REQUEST_LIMIT - bucket.count;
}

function remainingTokenRequests(jti: string) {
  const bucket = requestCounters.get(jti);
  return Math.max(0, env.EPHEMERAL_TOKEN_REQUEST_LIMIT - (bucket?.count ?? 0));
}

function cleanupMemory(now: number) {
  for (const [key, bucket] of generationCounters.entries()) {
    if (bucket.resetAt <= now) generationCounters.delete(key);
  }

  for (const [key, bucket] of requestCounters.entries()) {
    if (bucket.resetAt <= now) requestCounters.delete(key);
  }

  for (const [key, value] of revokedTokens.entries()) {
    if (value.expiresAt <= now) revokedTokens.delete(key);
  }
}

function looksLikeJwt(value: string) {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

function isEphemeralPayload(value: unknown): value is EphemeralAccessTokenPayload {
  const payload = value as Partial<EphemeralAccessTokenPayload> | null;
  return Boolean(
    payload
    && payload.typ === "ephemeral_access"
    && payload.ver === 1
    && typeof payload.jti === "string"
    && typeof payload.sub === "string"
    && typeof payload.sid === "string"
    && typeof payload.iss === "string"
    && typeof payload.aud === "string"
    && typeof payload.iat === "number"
    && typeof payload.exp === "number"
    && Array.isArray(payload.scopes)
    && payload.exp - payload.iat === EPHEMERAL_TOKEN_TTL_SECONDS
  );
}

function missingRequiredScope(scopes: EphemeralTokenScope[], requiredScopes: string[] | null | undefined) {
  const required = Array.isArray(requiredScopes) ? requiredScopes.map((scope) => scope.trim()).filter(Boolean) : [];
  const available = new Set(scopes);
  return required.find((scope) => !available.has(scope as EphemeralTokenScope)) ?? null;
}

function mapJwtError(error: unknown): Extract<EphemeralTokenValidation, { ok: false }> {
  if (error instanceof TokenExpiredError) {
    return tokenError(401, "TOKEN_EXPIRED", "The temporary access token has expired.");
  }

  if (error instanceof JsonWebTokenError && /signature/i.test(error.message)) {
    return tokenError(401, "INVALID_SIGNATURE", "The temporary access token signature is invalid.");
  }

  return tokenError(401, "INVALID_TOKEN", "The temporary access token is invalid.");
}

function tokenError(status: number, code: EphemeralTokenErrorCode, message: string): Extract<EphemeralTokenValidation, { ok: false }> {
  return { ok: false, status, code, message };
}

function logTokenEvent(event: string, userId: string | null, sessionId: string | null, metadata: Record<string, unknown> = {}) {
  console.info("[ephemeral-token]", JSON.stringify({
    event,
    metadata,
    sessionId,
    timestamp: new Date().toISOString(),
    userId
  }));
}

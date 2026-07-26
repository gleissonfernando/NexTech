import { randomUUID } from "node:crypto";
import { getMongoCollections } from "../database/mongo";
import { env } from "../config/env";
import { emitRealtime } from "../realtime/events";
import type { SessionAccessLevel } from "./dashboardPermissionService";
import type { DiscordTokenResponse, DiscordUser } from "./discordOAuthService";
import { discordAvatarUrl } from "./discordOAuthService";

type DashboardSessionScope = "dashboard" | "customer";

function dashboardSessionInvalidationCode(reason: string) {
  switch (reason) {
    case "logout":
      return "SESSION_LOGGED_OUT";
    case "session_expired":
      return "SESSION_EXPIRED";
    case "session_revoked":
      return "SESSION_REVOKED";
    default:
      return "SESSION_INVALIDATED";
  }
}

export type DashboardSessionState = {
  activeSessionExpiresAt: Date | null;
  activeSessionId: string | null;
  activeSessionScope: DashboardSessionScope | null;
  activeSessionStatus: "active" | "invalidated" | "logged_out" | null;
  authSessionVersion: number;
};

type RotateDashboardSessionInput = {
  botId?: string | null;
  ip?: string | null;
  scope: DashboardSessionScope;
  sessionId: string;
  userAgent?: string | null;
};

export async function saveDiscordUser(user: DiscordUser, tokens: DiscordTokenResponse) {
  const lastLoginAt = new Date();
  const username = user.global_name ?? user.username;
  const globalName = user.global_name ?? null;
  const discriminator = user.discriminator ?? null;
  const avatarUrl = discordAvatarUrl(user);
  const email = user.email ?? null;

  try {
    const { users } = await getMongoCollections();
    const now = new Date();

    await users.updateOne(
      {
        discordId: user.id
      },
      {
        $set: {
          username,
          globalName,
          discriminator,
          avatar: user.avatar,
          avatarUrl,
          email,
          accessToken: null,
          refreshToken: null,
          accessStatus: "allowed",
          lastLoginAt,
          updatedAt: now
        },
        $setOnInsert: {
          _id: randomUUID(),
          discordId: user.id,
          createdAt: now
        }
      },
      {
        upsert: true
      }
    );

    const saved = await users.findOne({
      discordId: user.id
    });

    return {
      id: saved?._id ?? user.id,
      discordId: user.id,
      username,
      globalName,
      discriminator,
      avatar: user.avatar,
      avatarUrl,
      email,
      selectedGuildId: saved?.selectedGuildId ?? null,
      lastLoginAt
    };
  } catch (error) {
    console.warn("[mongo] usuário mantido apenas em sessão:", error instanceof Error ? error.message : error);
    return {
      id: user.id,
      discordId: user.id,
      username,
      globalName,
      discriminator,
      avatar: user.avatar,
      avatarUrl,
      email,
      selectedGuildId: null,
      lastLoginAt
    };
  }
}

export async function rotateDashboardSession(discordId: string, input: RotateDashboardSessionInput) {
  const { users } = await getMongoCollections();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.SESSION_TTL_SECONDS * 1000);

  const updated = await users.findOneAndUpdate(
    {
      discordId
    },
    {
      $inc: {
        authSessionVersion: 1
      },
      $set: {
        activeSessionId: input.sessionId,
        activeSessionScope: input.scope,
        activeSessionBotId: input.botId ?? null,
        activeSessionCreatedAt: now,
        activeSessionLastAccessAt: now,
        activeSessionExpiresAt: expiresAt,
        activeSessionIp: input.ip ?? null,
        activeSessionUserAgent: input.userAgent ?? null,
        activeSessionStatus: "active",
        activeSessionInvalidatedAt: null,
        activeSessionInvalidationReason: null,
        updatedAt: now
      }
    },
    {
      returnDocument: "after",
      projection: {
        authSessionVersion: 1
      }
    }
  );

  const sessionVersion = updated?.authSessionVersion ?? 1;
  console.info(`[auth] sessão ativa rotacionada: discordId=${discordId} sessionId=${input.sessionId} scope=${input.scope} version=${sessionVersion}.`);
  return {
    expiresAt,
    sessionVersion
  };
}

export async function getUserDashboardSessionState(discordId: string): Promise<DashboardSessionState | null> {
  const { users } = await getMongoCollections();
  const user = await users.findOne(
    {
      discordId
    },
    {
      projection: {
        activeSessionId: 1,
        activeSessionExpiresAt: 1,
        activeSessionScope: 1,
        activeSessionStatus: 1,
        authSessionVersion: 1
      }
    }
  );

  if (!user) {
    return null;
  }

  return {
    activeSessionExpiresAt: user.activeSessionExpiresAt ?? null,
    activeSessionId: user.activeSessionId ?? null,
    activeSessionScope: user.activeSessionScope ?? null,
    activeSessionStatus: user.activeSessionStatus ?? null,
    authSessionVersion: user.authSessionVersion ?? 0
  };
}

export async function touchDashboardSession(discordId: string, sessionId: string) {
  const { users } = await getMongoCollections();
  await users.updateOne(
    {
      discordId,
      activeSessionId: sessionId,
      activeSessionStatus: "active"
    },
    {
      $set: {
        activeSessionLastAccessAt: new Date(),
        updatedAt: new Date()
      }
    }
  );
}

export async function invalidateDashboardSession(discordId: string, sessionId: string | null | undefined, reason = "logout") {
  const { users } = await getMongoCollections();
  const now = new Date();
  const filter = sessionId
    ? {
        discordId,
        activeSessionId: sessionId
      }
    : {
        discordId
      };

  const result = await users.updateOne(
    filter,
    {
      $inc: {
        authSessionVersion: 1
      },
      $set: {
        accessToken: null,
        refreshToken: null,
        activeSessionId: null,
        activeSessionStatus: "logged_out",
        activeSessionInvalidatedAt: now,
        activeSessionInvalidationReason: reason,
        updatedAt: now
      }
    }
  );

  if (result.modifiedCount > 0) {
    emitRealtime("auth:session_invalidated", {
      at: now.toISOString(),
      code: dashboardSessionInvalidationCode(reason),
      discordIds: [discordId],
      reason
    });
  }
}

export async function invalidateDashboardSessionsForDiscordIds(discordIds: Array<string | null | undefined>, reason: string) {
  const ids = [...new Set(discordIds.map((id) => id?.trim()).filter((id): id is string => Boolean(id)))];

  if (!ids.length) {
    return 0;
  }

  const { users } = await getMongoCollections();
  const now = new Date();
  const result = await users.updateMany(
    {
      discordId: {
        $in: ids
      }
    },
    {
      $inc: {
        authSessionVersion: 1
      },
      $set: {
        accessToken: null,
        refreshToken: null,
        activeSessionId: null,
        activeSessionStatus: "invalidated",
        activeSessionInvalidatedAt: now,
        activeSessionInvalidationReason: reason,
        updatedAt: now
      }
    }
  );

  if (result.modifiedCount > 0) {
    emitRealtime("auth:session_invalidated", {
      at: now.toISOString(),
      code: dashboardSessionInvalidationCode(reason),
      discordIds: ids,
      reason
    });
    console.info(`[auth] sessões invalidadas: users=${ids.length} reason=${reason}.`);
  }

  return result.modifiedCount;
}

export async function invalidateAllActiveDashboardSessions(reason: string) {
  const { users } = await getMongoCollections();
  const now = new Date();
  const result = await users.updateMany(
    {
      activeSessionScope: "dashboard",
      activeSessionStatus: "active"
    },
    {
      $inc: {
        authSessionVersion: 1
      },
      $set: {
        accessToken: null,
        refreshToken: null,
        activeSessionId: null,
        activeSessionStatus: "invalidated",
        activeSessionInvalidatedAt: now,
        activeSessionInvalidationReason: reason,
        updatedAt: now
      }
    }
  );

  if (result.modifiedCount > 0) {
    emitRealtime("auth:session_invalidated", {
      all: true,
      at: now.toISOString(),
      code: dashboardSessionInvalidationCode(reason),
      reason
    });
    console.info(`[auth] todas as sessões de dashboard foram invalidadas: count=${result.modifiedCount} reason=${reason}.`);
  }

  return result.modifiedCount;
}

export async function getStoredDiscordTokens(discordId: string) {
  try {
    const { users } = await getMongoCollections();
    const user = await users.findOne(
      {
        discordId
      },
      {
        projection: {
          accessToken: 1,
          refreshToken: 1
        }
      }
    );

    return user?.accessToken
      ? {
          accessToken: user.accessToken,
          refreshToken: user.refreshToken ?? null
        }
      : null;
  } catch (error) {
    console.warn("[mongo] não foi possível ler token OAuth do usuário:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function updateStoredDiscordTokens(discordId: string, tokens: DiscordTokenResponse) {
  try {
    const { users } = await getMongoCollections();
    await users.updateOne(
      {
        discordId
      },
      {
        $set: {
          accessToken: null,
          refreshToken: null,
          updatedAt: new Date()
        }
      }
    );
  } catch (error) {
    console.warn("[mongo] não foi possível atualizar token OAuth do usuário:", error instanceof Error ? error.message : error);
  }
}

export async function clearStoredDiscordTokens(discordId: string) {
  try {
    const { users } = await getMongoCollections();
    await users.updateOne(
      { discordId },
      {
        $set: {
          accessToken: null,
          refreshToken: null,
          updatedAt: new Date()
        }
      }
    );
  } catch (error) {
    console.warn("[mongo] não foi possível limpar tokens OAuth do usuário:", error instanceof Error ? error.message : error);
  }
}

export async function saveDiscordAccessSnapshot(
  discordId: string,
  input: {
    accessStatus: "allowed" | "denied" | "pending";
    permissionLevel: SessionAccessLevel;
    roleIdsByGuild: Record<string, string[]>;
  }
) {
  try {
    const { users } = await getMongoCollections();
    await users.updateOne(
      {
        discordId
      },
      {
        $set: {
          discordRoleIdsByGuild: input.roleIdsByGuild,
          accessStatus: input.accessStatus,
          permissionLevel: input.permissionLevel,
          lastAccessSyncAt: new Date(),
          updatedAt: new Date()
        }
      }
    );
  } catch (error) {
    console.warn("[mongo] snapshot de acesso mantido apenas em sessão:", error instanceof Error ? error.message : error);
  }
}

export async function saveSelectedGuild(userId: string, selectedGuildId: string) {
  try {
    const { users } = await getMongoCollections();
    await users.updateOne(
      {
        discordId: userId
      },
      {
        $set: {
          selectedGuildId,
          updatedAt: new Date()
        }
      }
    );
  } catch (error) {
    console.warn("[mongo] selectedGuildId mantido apenas em sessão:", error instanceof Error ? error.message : error);
  }
}

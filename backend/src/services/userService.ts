import { randomUUID } from "node:crypto";
import { getMongoCollections } from "../database/mongo";
import type { SessionAccessLevel } from "./dashboardPermissionService";
import type { DiscordTokenResponse, DiscordUser } from "./discordOAuthService";
import { discordAvatarUrl } from "./discordOAuthService";

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
    console.warn("[mongo] usuario mantido apenas em sessao:", error instanceof Error ? error.message : error);
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
    console.warn("[mongo] nao foi possivel ler token OAuth do usuario:", error instanceof Error ? error.message : error);
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
    console.warn("[mongo] nao foi possivel atualizar token OAuth do usuario:", error instanceof Error ? error.message : error);
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
    console.warn("[mongo] nao foi possivel limpar tokens OAuth do usuario:", error instanceof Error ? error.message : error);
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
    console.warn("[mongo] snapshot de acesso mantido apenas em sessao:", error instanceof Error ? error.message : error);
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
    console.warn("[mongo] selectedGuildId mantido apenas em sessao:", error instanceof Error ? error.message : error);
  }
}

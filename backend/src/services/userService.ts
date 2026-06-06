import { randomUUID } from "node:crypto";
import { getMongoCollections } from "../database/mongo";
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
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
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

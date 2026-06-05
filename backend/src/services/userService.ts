import { randomUUID } from "node:crypto";
import { getMongoCollections } from "../database/mongo";
import type { DiscordTokenResponse, DiscordUser } from "./discordOAuthService";

export async function saveDiscordUser(user: DiscordUser, tokens: DiscordTokenResponse) {
  const lastLoginAt = new Date();
  const username = user.global_name ?? user.username;

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
          avatar: user.avatar,
          email: user.email,
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
      avatar: user.avatar,
      email: user.email,
      lastLoginAt
    };
  } catch (error) {
    console.warn("[mongo] usuario mantido apenas em sessao:", error instanceof Error ? error.message : error);
    return {
      id: user.id,
      discordId: user.id,
      username,
      avatar: user.avatar,
      email: user.email,
      lastLoginAt
    };
  }
}

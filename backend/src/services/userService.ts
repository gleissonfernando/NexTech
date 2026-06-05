import { prisma } from "../database/prisma";
import type { DiscordTokenResponse, DiscordUser } from "./discordOAuthService";

export async function saveDiscordUser(user: DiscordUser, tokens: DiscordTokenResponse) {
  const lastLoginAt = new Date();

  try {
    return await prisma.user.upsert({
      where: {
        discordId: user.id
      },
      create: {
        discordId: user.id,
        username: user.global_name ?? user.username,
        avatar: user.avatar,
        email: user.email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        lastLoginAt
      },
      update: {
        username: user.global_name ?? user.username,
        avatar: user.avatar,
        email: user.email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        lastLoginAt
      }
    });
  } catch (error) {
    console.warn("[prisma] usuario mantido apenas em sessao:", error instanceof Error ? error.message : error);
    return {
      id: user.id,
      discordId: user.id,
      username: user.global_name ?? user.username,
      avatar: user.avatar,
      email: user.email,
      lastLoginAt
    };
  }
}

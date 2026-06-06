import axios from "axios";
import { env } from "../config/env";
import { getDiscordAvatarUrl } from "./discordAssetService";

const DISCORD_API = "https://discord.com/api/v10";

type DiscordBotUser = {
  id: string;
  username: string;
  avatar: string | null;
};

export type BotProfile = {
  id: string | null;
  username: string;
  avatarUrl: string | null;
  connected: boolean;
};

export async function fetchBotProfile(): Promise<BotProfile> {
  if (!env.DISCORD_BOT_TOKEN) {
    return disconnectedBotProfile();
  }

  try {
    const { data } = await axios.get<DiscordBotUser>(`${DISCORD_API}/users/@me`, {
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`
      },
      timeout: 3500
    });

    return {
      id: data.id,
      username: data.username,
      avatarUrl: getDiscordAvatarUrl(data.id, data.avatar, "bot"),
      connected: true
    };
  } catch (error) {
    console.warn("[discord] nao foi possivel buscar perfil do bot:", error instanceof Error ? error.message : error);
    return disconnectedBotProfile();
  }
}

function disconnectedBotProfile(): BotProfile {
  return {
    id: null,
    username: "Bot Discord",
    avatarUrl: null,
    connected: false
  };
}

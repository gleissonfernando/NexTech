import { randomUUID } from "node:crypto";
import { ensureGuild, getMongoCollections, type MongoGuildSettings } from "../database/mongo";

export type GuildSettingsDto = {
  guildId: string;
  welcomeEnabled: boolean;
  welcomeChannelId: string | null;
  welcomeMessage: string | null;
  autoRoleEnabled: boolean;
  autoRoleIds: string[];
  twitchRoleId: string | null;
  boosterRoleId: string | null;
  ticketEnabled: boolean;
  ticketCategoryId: string | null;
  logChannelId: string | null;
  moderationEnabled: boolean;
  verificationEnabled: boolean;
  verificationRoleId: string | null;
};

const memorySettings = new Map<string, GuildSettingsDto>();

export function defaultSettings(guildId: string): GuildSettingsDto {
  return {
    guildId,
    welcomeEnabled: true,
    welcomeChannelId: null,
    welcomeMessage: "Bem-vindo(a), {user}!",
    autoRoleEnabled: false,
    autoRoleIds: [],
    twitchRoleId: null,
    boosterRoleId: null,
    ticketEnabled: true,
    ticketCategoryId: null,
    logChannelId: null,
    moderationEnabled: true,
    verificationEnabled: false,
    verificationRoleId: null
  };
}

export async function getGuildSettings(guildId: string) {
  try {
    const { guildSettings } = await getMongoCollections();
    const settings = await guildSettings.findOne({
      guildId
    });

    if (settings) {
      return toDto(settings);
    }
  } catch (error) {
    console.warn("[mongo] usando settings em memoria:", error instanceof Error ? error.message : error);
  }

  return memorySettings.get(guildId) ?? defaultSettings(guildId);
}

export async function updateGuildSettings(guildId: string, input: Partial<GuildSettingsDto>) {
  const current = await getGuildSettings(guildId);
  const next: GuildSettingsDto = {
    ...current,
    ...input,
    guildId
  };

  memorySettings.set(guildId, next);

  try {
    await ensureGuild(guildId);

    const { guildSettings } = await getMongoCollections();
    await guildSettings.updateOne(
      {
        guildId
      },
      {
        $set: {
          welcomeEnabled: next.welcomeEnabled,
          welcomeChannelId: next.welcomeChannelId,
          welcomeMessage: next.welcomeMessage,
          autoRoleEnabled: next.autoRoleEnabled,
          autoRoleIds: next.autoRoleIds,
          twitchRoleId: next.twitchRoleId,
          boosterRoleId: next.boosterRoleId,
          ticketEnabled: next.ticketEnabled,
          ticketCategoryId: next.ticketCategoryId,
          logChannelId: next.logChannelId,
          moderationEnabled: next.moderationEnabled,
          verificationEnabled: next.verificationEnabled,
          verificationRoleId: next.verificationRoleId,
          updatedAt: new Date()
        },
        $setOnInsert: {
          _id: randomUUID(),
          guildId
        }
      },
      {
        upsert: true
      }
    );
  } catch (error) {
    console.warn("[mongo] settings mantidas em memoria:", error instanceof Error ? error.message : error);
  }

  return next;
}

function toDto(settings: MongoGuildSettings): GuildSettingsDto {
  return {
    guildId: settings.guildId,
    welcomeEnabled: settings.welcomeEnabled,
    welcomeChannelId: settings.welcomeChannelId,
    welcomeMessage: settings.welcomeMessage,
    autoRoleEnabled: settings.autoRoleEnabled,
    autoRoleIds: settings.autoRoleIds,
    twitchRoleId: settings.twitchRoleId,
    boosterRoleId: settings.boosterRoleId,
    ticketEnabled: settings.ticketEnabled,
    ticketCategoryId: settings.ticketCategoryId,
    logChannelId: settings.logChannelId,
    moderationEnabled: settings.moderationEnabled,
    verificationEnabled: settings.verificationEnabled,
    verificationRoleId: settings.verificationRoleId
  };
}

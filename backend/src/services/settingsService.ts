import { randomUUID } from "node:crypto";
import { ensureGuild, getMongoCollections, type MongoGuildSettings } from "../database/mongo";

export type GuildSettingsDto = {
  guildId: string;
  welcomeEnabled: boolean;
  welcomeChannelId: string | null;
  welcomeDisplayChannelId: string | null;
  welcomeImageUrl: string | null;
  welcomeMessage: string | null;
  leaveEnabled: boolean;
  leaveChannelId: string | null;
  leaveDisplayChannelId: string | null;
  leaveImageUrl: string | null;
  leaveMessage: string | null;
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
const DEFAULT_WELCOME_IMAGE_URL = "/uploads/welcome/default.gif?v=3";

export function defaultSettings(guildId: string): GuildSettingsDto {
  return {
    guildId,
    welcomeEnabled: true,
    welcomeChannelId: null,
    welcomeDisplayChannelId: null,
    welcomeImageUrl: DEFAULT_WELCOME_IMAGE_URL,
    welcomeMessage: "Bem-vindo(a), {user}!",
    leaveEnabled: true,
    leaveChannelId: null,
    leaveDisplayChannelId: null,
    leaveImageUrl: DEFAULT_WELCOME_IMAGE_URL,
    leaveMessage: "Ate mais, {user}.",
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
          welcomeDisplayChannelId: next.welcomeDisplayChannelId,
          welcomeImageUrl: next.welcomeImageUrl,
          welcomeMessage: next.welcomeMessage,
          leaveEnabled: next.leaveEnabled,
          leaveChannelId: next.leaveChannelId,
          leaveDisplayChannelId: next.leaveDisplayChannelId,
          leaveImageUrl: next.leaveImageUrl,
          leaveMessage: next.leaveMessage,
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
  const defaults = defaultSettings(settings.guildId);

  return {
    guildId: settings.guildId,
    welcomeEnabled: settings.welcomeEnabled,
    welcomeChannelId: settings.welcomeChannelId,
    welcomeDisplayChannelId: settings.welcomeDisplayChannelId ?? null,
    welcomeImageUrl: normalizeWelcomeImageUrl(settings.welcomeImageUrl),
    welcomeMessage: settings.welcomeMessage,
    leaveEnabled: settings.leaveEnabled ?? defaults.leaveEnabled,
    leaveChannelId: settings.leaveChannelId ?? defaults.leaveChannelId,
    leaveDisplayChannelId: settings.leaveDisplayChannelId ?? defaults.leaveDisplayChannelId,
    leaveImageUrl: normalizeWelcomeImageUrl(settings.leaveImageUrl ?? defaults.leaveImageUrl),
    leaveMessage: settings.leaveMessage ?? defaults.leaveMessage,
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

function normalizeWelcomeImageUrl(value: string | null | undefined) {
  return !value || value === "/uploads/welcome/default.gif" ? DEFAULT_WELCOME_IMAGE_URL : value;
}

import { prisma } from "../database/prisma";

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
    const settings = await prisma.guildSettings.findUnique({
      where: {
        guildId
      }
    });

    if (settings) {
      return {
        guildId,
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
  } catch (error) {
    console.warn("[prisma] usando settings em memoria:", error instanceof Error ? error.message : error);
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
    await prisma.guild.upsert({
      where: {
        discordId: guildId
      },
      create: {
        discordId: guildId,
        name: `Guild ${guildId}`
      },
      update: {}
    });

    await prisma.guildSettings.upsert({
      where: {
        guildId
      },
      create: next,
      update: {
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
        verificationRoleId: next.verificationRoleId
      }
    });
  } catch (error) {
    console.warn("[prisma] settings mantidas em memoria:", error instanceof Error ? error.message : error);
  }

  return next;
}

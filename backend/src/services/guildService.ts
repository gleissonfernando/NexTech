export type DiscordGuild = {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
};

export type DashboardGuild = {
  id: string;
  name: string;
  iconUrl: string | null;
  owner: boolean;
  isAdmin: boolean;
  botEnabled: boolean;
  memberCount: number;
  channelCount: number;
};

const ADMINISTRATOR = 0x8n;

export function hasAdministratorPermission(guild: Pick<DiscordGuild, "owner" | "permissions">) {
  if (guild.owner) {
    return true;
  }

  try {
    const permissions = BigInt(guild.permissions || "0");
    return (permissions & ADMINISTRATOR) === ADMINISTRATOR;
  } catch {
    return false;
  }
}

export function discordGuildIconUrl(guild: Pick<DiscordGuild, "id" | "icon">) {
  if (!guild.icon) {
    return null;
  }

  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`;
}

export function toDashboardGuild(guild: DiscordGuild): DashboardGuild {
  const seed = Number(BigInt(`0x${guild.id.slice(-6)}`) % 1000n);

  return {
    id: guild.id,
    name: guild.name,
    iconUrl: discordGuildIconUrl(guild),
    owner: guild.owner,
    isAdmin: hasAdministratorPermission(guild),
    botEnabled: false,
    memberCount: 750 + seed,
    channelCount: 14 + (seed % 48)
  };
}

export function toDashboardGuilds(guilds: DiscordGuild[]) {
  return guilds.map(toDashboardGuild).filter((guild) => guild.isAdmin);
}

export const demoGuilds: DashboardGuild[] = [
  {
    id: "110000000000000001",
    name: "Comunidade Ricardinho",
    iconUrl: null,
    owner: true,
    isAdmin: true,
    botEnabled: true,
    memberCount: 1842,
    channelCount: 42
  },
  {
    id: "110000000000000002",
    name: "Lives e Eventos",
    iconUrl: null,
    owner: false,
    isAdmin: true,
    botEnabled: true,
    memberCount: 936,
    channelCount: 31
  }
];

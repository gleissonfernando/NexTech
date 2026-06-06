const DEFAULT_USER_AVATAR_URL = "https://cdn.discordapp.com/embed/avatars/0.png";
const DEFAULT_SERVER_ICON_URL = "https://cdn.discordapp.com/embed/avatars/1.png";

export function getDiscordAvatarUrl(id: string, avatar: string | null | undefined, _type: "user" | "bot" = "user") {
  if (!avatar) {
    return DEFAULT_USER_AVATAR_URL;
  }

  const extension = avatar.startsWith("a_") ? "gif" : "png";

  return `https://cdn.discordapp.com/avatars/${id}/${avatar}.${extension}?size=256`;
}

export function getGuildIconUrl(guildId: string, icon: string | null | undefined) {
  if (!icon) {
    return DEFAULT_SERVER_ICON_URL;
  }

  const extension = icon.startsWith("a_") ? "gif" : "png";

  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.${extension}?size=256`;
}

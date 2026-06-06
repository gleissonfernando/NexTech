import { Twitch } from "lucide-react";
import { SocialCard } from "./SocialCard";
import { TwitchChannelItem } from "./TwitchChannelItem";
import type { GuildChannelOption, GuildRoleOption, SocialNotification } from "../../types";

type TwitchNotificationCardProps = {
  notifications: SocialNotification[];
  channels: GuildChannelOption[];
  roles: GuildRoleOption[];
  onAdd: () => void;
  onEdit: (notification: SocialNotification) => void;
  onDelete: (notification: SocialNotification) => void;
  onTest: (notification: SocialNotification) => void;
  testingId: string | null;
};

export function TwitchNotificationCard({ channels, notifications, onAdd, onDelete, onEdit, onTest, roles, testingId }: TwitchNotificationCardProps) {
  const twitchNotifications = notifications.filter((notification) => notification.platform === "twitch");
  const count = twitchNotifications.length;

  return (
    <SocialCard
      actionLabel="Adicionar Canal"
      count={`${count}/5`}
      description="Cadastre a URL da Twitch e selecione o canal Discord que recebera o painel de live."
      disabled={count >= 5}
      icon={Twitch}
      iconClassName="text-[#9146ff]"
      onAction={onAdd}
      title="Twitch"
    >
      {twitchNotifications.length ? (
        <div className="space-y-3">
          {twitchNotifications.map((notification) => (
            <TwitchChannelItem
              channelName={formatChannelName(channels, notification.discordChannelId)}
              key={notification.id}
              notification={notification}
              onDelete={onDelete}
              onEdit={onEdit}
              onTest={onTest}
              roleName={formatRoleName(roles, notification.mentionRoleId)}
              testing={testingId === notification.id}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/70 p-5 text-sm text-zinc-500">
          Nenhum canal Twitch cadastrado.
        </div>
      )}
    </SocialCard>
  );
}

function formatChannelName(channels: GuildChannelOption[], channelId: string) {
  const channel = channels.find((item) => item.id === channelId);
  return channel ? `#${channel.name}` : channelId;
}

function formatRoleName(roles: GuildRoleOption[], roleId?: string | null) {
  if (!roleId || roleId === "everyone") {
    return "@everyone";
  }

  const role = roles.find((item) => item.id === roleId);
  return role ? `@${role.name}` : roleId;
}

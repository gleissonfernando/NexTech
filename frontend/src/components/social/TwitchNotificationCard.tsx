import { Twitch } from "lucide-react";
import { SocialCard } from "./SocialCard";
import { TwitchChannelItem } from "./TwitchChannelItem";
import type { SocialNotification } from "../../types";

type TwitchNotificationCardProps = {
  notifications: SocialNotification[];
  onAdd: () => void;
  onEdit: (notification: SocialNotification) => void;
  onDelete: (notification: SocialNotification) => void;
};

export function TwitchNotificationCard({ notifications, onAdd, onDelete, onEdit }: TwitchNotificationCardProps) {
  const twitchNotifications = notifications.filter((notification) => notification.platform === "twitch");
  const count = twitchNotifications.length;

  return (
    <SocialCard
      actionLabel="Add channel"
      count={`${count}/5`}
      description="Live updating notifications for Twitch streams."
      disabled={count >= 5}
      icon={Twitch}
      iconClassName="text-[#9146ff]"
      onAction={onAdd}
      title="Twitch"
    >
      {twitchNotifications.length ? (
        <div className="space-y-3">
          {twitchNotifications.map((notification) => (
            <TwitchChannelItem key={notification.id} notification={notification} onDelete={onDelete} onEdit={onEdit} />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[#36414e] bg-[#252d37] p-5 text-sm text-[#b8bec8]">
          Nenhum canal Twitch cadastrado.
        </div>
      )}
    </SocialCard>
  );
}

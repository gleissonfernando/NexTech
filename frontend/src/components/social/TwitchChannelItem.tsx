import { Settings, Trash2 } from "lucide-react";
import { Avatar } from "../ui/avatar";
import { Button } from "../ui/button";
import type { SocialNotification } from "../../types";

type TwitchChannelItemProps = {
  notification: SocialNotification;
  onEdit: (notification: SocialNotification) => void;
  onDelete: (notification: SocialNotification) => void;
};

export function TwitchChannelItem({ notification, onDelete, onEdit }: TwitchChannelItemProps) {
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-[#36414e] bg-[#252d37] p-4 transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_50px_rgba(0,0,0,0.38)] sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="h-12 w-12 rounded-2xl" fallback={notification.twitchChannelName} src={notification.twitchAvatar} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">@{notification.twitchChannelName}</p>
          <a className="block truncate text-xs text-[#b8bec8] hover:text-white" href={notification.twitchChannelUrl} rel="noreferrer" target="_blank">
            {notification.twitchChannelUrl}
          </a>
          <p className="mt-1 text-xs text-[#b8bec8]">{notification.enabled ? "Ativo" : "Desativado"} • Canal Discord: {notification.discordChannelId}</p>
        </div>
      </div>

      <div className="flex shrink-0 gap-2">
        <Button className="h-9 px-3 text-xs" onClick={() => onEdit(notification)} type="button" variant="outline">
          <Settings className="h-3.5 w-3.5" />
          Configurar
        </Button>
        <Button className="h-9 px-3 text-xs" onClick={() => onDelete(notification)} type="button" variant="outline">
          <Trash2 className="h-3.5 w-3.5" />
          Excluir
        </Button>
      </div>
    </article>
  );
}

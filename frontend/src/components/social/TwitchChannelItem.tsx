import { ExternalLink, FlaskConical, Settings, Trash2 } from "lucide-react";
import { Avatar } from "../ui/avatar";
import { Button } from "../ui/button";
import type { SocialNotification } from "../../types";

type TwitchChannelItemProps = {
  notification: SocialNotification;
  channelName: string;
  roleName: string;
  testing: boolean;
  onEdit: (notification: SocialNotification) => void;
  onDelete: (notification: SocialNotification) => void;
  onTest: (notification: SocialNotification) => void;
};

export function TwitchChannelItem({ channelName, notification, onDelete, onEdit, onTest, roleName, testing }: TwitchChannelItemProps) {
  const embedColor = notification.embedColor ?? "#9146FF";

  return (
    <article className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/70 shadow-[0_18px_60px_rgba(0,0,0,0.34)] transition duration-300 hover:-translate-y-0.5 hover:border-[#9146ff]/50 hover:bg-[#120d1f]">
      <div className="border-l-4 p-4" style={{ borderColor: embedColor }}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar className="h-14 w-14 rounded-lg" fallback={notification.twitchChannelName} src={notification.twitchAvatar} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-base font-semibold text-white">@{notification.twitchChannelName}</p>
                <StatusPill live={notification.isLive} />
              </div>
              <a className="mt-1 flex max-w-full items-center gap-1 truncate text-xs text-zinc-500 hover:text-white" href={notification.twitchChannelUrl} rel="noreferrer" target="_blank">
                {notification.twitchChannelUrl}
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
              <p className="mt-1 truncate font-mono text-[11px] text-zinc-600">ID Twitch: {notification.twitchUserId ?? "sincronizando"}</p>
            </div>
          </div>

          <div className="grid gap-2 text-xs text-zinc-500 sm:grid-cols-3 lg:min-w-[420px]">
            <Fact label="Canal Discord" value={channelName} />
            <Fact label="Mencao" value={roleName} />
            <div className="rounded-lg border border-zinc-900 bg-black/40 p-3">
              <p>Cor da embed</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: embedColor }} />
                <span className="font-mono text-zinc-200">{embedColor}</span>
              </div>
            </div>
          </div>
        </div>

        {notification.lastLiveAt ? (
          <p className="mt-3 text-xs text-zinc-500">Ultima live detectada: {formatDateTime(notification.lastLiveAt)}</p>
        ) : null}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button className="h-9 px-3 text-xs" disabled={testing} onClick={() => onTest(notification)} type="button" variant="outline">
            <FlaskConical className="h-3.5 w-3.5" />
            {testing ? "Testando..." : "Testar"}
          </Button>
          <Button className="h-9 px-3 text-xs" onClick={() => onEdit(notification)} type="button" variant="outline">
            <Settings className="h-3.5 w-3.5" />
            Configurar
          </Button>
          <Button className="h-9 px-3 text-xs" onClick={() => onDelete(notification)} type="button" variant="outline">
            <Trash2 className="h-3.5 w-3.5" />
            Excluir
          </Button>
        </div>
      </div>
    </article>
  );
}

function StatusPill({ live }: { live: boolean }) {
  return (
    <span className={live ? "rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300" : "rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-300"}>
      {live ? "Online" : "Offline"}
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-900 bg-black/40 p-3">
      <p>{label}</p>
      <p className="mt-1 truncate font-medium text-zinc-200">{value}</p>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

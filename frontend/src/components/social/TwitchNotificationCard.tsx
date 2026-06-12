import { ChevronLeft, ChevronRight, Search, Twitch } from "lucide-react";
import { Button } from "../ui/button";
import { SocialCard } from "./SocialCard";
import { TwitchChannelItem } from "./TwitchChannelItem";
import type { GuildChannelOption, GuildRoleOption, SocialNotification } from "../../types";

type TwitchNotificationCardProps = {
  notifications: SocialNotification[];
  total: number;
  filteredTotal: number;
  limit: number;
  page: number;
  totalPages: number;
  search: string;
  channels: GuildChannelOption[];
  roles: GuildRoleOption[];
  onAdd: () => void;
  onEdit: (notification: SocialNotification) => void;
  onDelete: (notification: SocialNotification) => void;
  onPreview: (notification: SocialNotification) => void;
  onTest: (notification: SocialNotification) => void;
  onPageChange: (page: number) => void;
  onSearchChange: (value: string) => void;
  testingId: string | null;
  previewingId: string | null;
};

export function TwitchNotificationCard({
  channels,
  filteredTotal,
  limit,
  notifications,
  onAdd,
  onDelete,
  onEdit,
  onPageChange,
  onPreview,
  onSearchChange,
  onTest,
  page,
  previewingId,
  roles,
  search,
  testingId,
  total,
  totalPages
}: TwitchNotificationCardProps) {
  const twitchNotifications = notifications.filter((notification) => notification.platform === "twitch");

  return (
    <SocialCard
      actionLabel="Adicionar Canal"
      count={`${total.toLocaleString("pt-BR")} / ${limit.toLocaleString("pt-BR")}`}
      description="Cadastre a URL da Twitch e selecione o canal Discord que recebera o painel de live."
      disabled={total >= limit}
      icon={Twitch}
      iconClassName="text-[#9146ff]"
      onAction={onAdd}
      title="Twitch"
    >
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        <input
          className="social-input h-11 pl-10"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Buscar canal da Twitch"
          type="search"
          value={search}
        />
      </div>

      {search ? (
        <p className="mb-3 text-xs text-zinc-500">
          {filteredTotal.toLocaleString("pt-BR")} resultado{filteredTotal === 1 ? "" : "s"}
        </p>
      ) : null}

      {twitchNotifications.length ? (
        <div className="space-y-3">
          {twitchNotifications.map((notification) => (
            <TwitchChannelItem
              channelName={formatChannelName(channels, notification.discordChannelId)}
              key={notification.id}
              notification={notification}
              onDelete={onDelete}
              onEdit={onEdit}
              onPreview={onPreview}
              onTest={onTest}
              roleName={formatRoleName(roles, notification.mentionRoleId)}
              previewing={previewingId === notification.id}
              testing={testingId === notification.id}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/70 p-5 text-sm text-zinc-500">
          {search ? "Nenhum canal encontrado." : "Nenhum canal Twitch cadastrado."}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-zinc-900 pt-4">
          <p className="text-xs text-zinc-500">
            Pagina <span className="font-medium text-zinc-200">{page}</span> de {totalPages.toLocaleString("pt-BR")}
          </p>
          <div className="flex gap-2">
            <Button
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              size="icon"
              title="Pagina anterior"
              variant="outline"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              size="icon"
              title="Proxima pagina"
              variant="outline"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}
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

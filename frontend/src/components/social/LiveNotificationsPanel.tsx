import { useEffect, useMemo, useState } from "react";
import { Radio } from "lucide-react";
import {
  createTwitchNotification,
  deleteTwitchNotification,
  getGuildLiveOptions,
  getSocialNotifications,
  updateTwitchNotification
} from "../../lib/api";
import { AddTwitchChannelModal } from "./AddTwitchChannelModal";
import { DeleteTwitchChannelModal } from "./DeleteTwitchChannelModal";
import { EditTwitchChannelModal } from "./EditTwitchChannelModal";
import { TwitchNotificationCard } from "./TwitchNotificationCard";
import type {
  CreateTwitchNotificationPayload,
  DashboardGuild,
  GuildLiveOptions,
  SocialNotification,
  UpdateTwitchNotificationPayload
} from "../../types";

type LiveNotificationsPanelProps = {
  canManage: boolean;
  guild: DashboardGuild | null;
};

export function LiveNotificationsPanel({ canManage, guild }: LiveNotificationsPanelProps) {
  const [notifications, setNotifications] = useState<SocialNotification[]>([]);
  const [liveOptions, setLiveOptions] = useState<GuildLiveOptions>({ channels: [], roles: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<SocialNotification | null>(null);
  const [deletingNotification, setDeletingNotification] = useState<SocialNotification | null>(null);

  const twitchCount = useMemo(
    () => notifications.filter((notification) => notification.platform === "twitch").length,
    [notifications]
  );

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      setNotifications([]);
      setLiveOptions({ channels: [], roles: [] });
      return;
    }

    if (!guild) {
      setLoading(false);
      setNotifications([]);
      setLiveOptions({ channels: [], roles: [] });
      return;
    }

    setLoading(true);
    setError(null);

    Promise.all([
      getSocialNotifications(guild.id),
      getGuildLiveOptions(guild.id).catch(() => ({ channels: [], roles: [] }))
    ])
      .then(([nextNotifications, nextOptions]) => {
        setNotifications(nextNotifications);
        setLiveOptions(nextOptions);
      })
      .catch((requestError: unknown) => setError(readErrorMessage(requestError)))
      .finally(() => setLoading(false));
  }, [canManage, guild]);

  async function handleCreate(payload: CreateTwitchNotificationPayload) {
    if (!guild) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const notification = await createTwitchNotification(guild.id, payload);
      setNotifications((current) => [notification, ...current]);
      setAddOpen(false);
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(payload: UpdateTwitchNotificationPayload) {
    if (!guild || !editing) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const notification = await updateTwitchNotification(guild.id, editing.id, payload);
      setNotifications((current) => current.map((item) => (item.id === notification.id ? notification : item)));
      setEditing(null);
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!guild || !deletingNotification) {
      return;
    }

    setDeleting(true);

    try {
      await deleteTwitchNotification(guild.id, deletingNotification.id);
      setNotifications((current) => current.filter((item) => item.id !== deletingNotification.id));
      setDeletingNotification(null);
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-white">
            <Radio className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xl font-semibold text-white">Notificacoes de lives</h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-500">
              Cadastre canais da Twitch para o bot avisar quando uma transmissao comecar.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-900 bg-zinc-950/75 px-4 py-2 text-sm text-zinc-500">
          Twitch: <span className="font-semibold text-white">{twitchCount}/5</span>
        </div>
      </div>

      {loading ? <div className="rounded-lg border border-zinc-900 bg-zinc-950/75 p-5 text-sm text-zinc-500">Carregando canais da Twitch...</div> : null}
      {!canManage ? (
        <div className="rounded-lg border border-zinc-900 bg-zinc-950/75 p-5 text-sm leading-6 text-zinc-500">
          Sua conta tem visualizacao basica. O gerenciamento de alertas de live fica disponivel apenas para administradores ou usuarios autorizados.
        </div>
      ) : null}
      {error ? <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-white">{error}</div> : null}

      {canManage ? (
        <TwitchNotificationCard
          channels={liveOptions.channels}
          notifications={notifications}
          onAdd={() => {
            setError(null);
            setAddOpen(true);
          }}
          onDelete={setDeletingNotification}
          onEdit={(notification) => {
            setError(null);
            setEditing(notification);
          }}
          roles={liveOptions.roles}
        />
      ) : null}

      <AddTwitchChannelModal
        error={error}
        onClose={() => setAddOpen(false)}
        onSubmit={handleCreate}
        open={addOpen}
        options={liveOptions}
        saving={saving}
      />
      <EditTwitchChannelModal
        error={error}
        notification={editing}
        onClose={() => setEditing(null)}
        onSubmit={handleUpdate}
        options={liveOptions}
        saving={saving}
      />
      <DeleteTwitchChannelModal
        deleting={deleting}
        notification={deletingNotification}
        onClose={() => setDeletingNotification(null)}
        onConfirm={handleDelete}
      />
    </section>
  );
}

function readErrorMessage(error: unknown) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? "Nao foi possivel concluir a acao.";
  }

  return "Nao foi possivel concluir a acao.";
}

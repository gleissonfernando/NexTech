import { useEffect, useMemo, useState } from "react";
import { Radio } from "lucide-react";
import {
  createTwitchNotification,
  deleteTwitchNotification,
  getGuildLiveOptions,
  getSocialNotifications,
  testTwitchNotification,
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
  const [testingId, setTestingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
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
    setStatus(null);

    try {
      const notification = await createTwitchNotification(guild.id, payload);
      setNotifications((current) => [notification, ...current]);
      setAddOpen(false);
      setStatus("Canal Twitch cadastrado com sucesso.");
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
    setStatus(null);

    try {
      const notification = await updateTwitchNotification(guild.id, editing.id, payload);
      setNotifications((current) => current.map((item) => (item.id === notification.id ? notification : item)));
      setEditing(null);
      setStatus("Configuracao salva.");
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
    setStatus(null);

    try {
      await deleteTwitchNotification(guild.id, deletingNotification.id);
      setNotifications((current) => current.filter((item) => item.id !== deletingNotification.id));
      setDeletingNotification(null);
      setStatus("Canal Twitch removido.");
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setDeleting(false);
    }
  }

  async function handleTest(notification: SocialNotification) {
    if (!guild) {
      return;
    }

    setTestingId(notification.id);
    setError(null);
    setStatus(null);

    try {
      await testTwitchNotification(guild.id, notification.id);
      setStatus(`Painel de @${notification.twitchChannelName} enviado para teste.`);
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setTestingId(null);
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
            <h3 className="text-xl font-semibold text-white">Live Notifications</h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-500">
              Cadastre canais da Twitch para o bot avisar quando uma transmissao comecar.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-900 bg-zinc-950/75 px-4 py-2 text-sm text-zinc-500">
          Twitch: <span className="font-semibold text-white">{twitchCount}/5</span>
        </div>
      </div>

      {loading ? <LiveSkeleton /> : null}
      {!canManage ? (
        <div className="rounded-lg border border-zinc-900 bg-zinc-950/75 p-5 text-sm leading-6 text-zinc-500">
          Sua conta tem visualizacao basica. O gerenciamento de alertas de live fica disponivel apenas para administradores ou usuarios autorizados.
        </div>
      ) : null}
      {status ? <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">{status}</div> : null}
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
          onTest={handleTest}
          roles={liveOptions.roles}
          testingId={testingId}
        />
      ) : null}

      <AddTwitchChannelModal
        error={error}
        guildId={guild?.id ?? null}
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

function LiveSkeleton() {
  return (
    <div className="space-y-3 rounded-lg border border-zinc-900 bg-zinc-950/75 p-5">
      {[0, 1, 2].map((item) => (
        <div className="flex animate-pulse items-center gap-4" key={item}>
          <div className="h-12 w-12 rounded-lg bg-zinc-800" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-40 rounded bg-zinc-800" />
            <div className="h-3 w-full max-w-xl rounded bg-zinc-900" />
          </div>
        </div>
      ))}
    </div>
  );
}

function readErrorMessage(error: unknown) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? "Nao foi possivel concluir a acao.";
  }

  return "Nao foi possivel concluir a acao.";
}

import { useEffect, useState } from "react";
import { Radio } from "lucide-react";
import {
  createTwitchNotification,
  deleteTwitchNotification,
  getGuildLiveOptions,
  getSocialNotifications,
  previewTwitchNotificationPanel,
  testTwitchNotification,
  updateTwitchNotification
} from "../../lib/api";
import { AddTwitchChannelModal } from "./AddTwitchChannelModal";
import { DeleteTwitchChannelModal } from "./DeleteTwitchChannelModal";
import { EditTwitchChannelModal } from "./EditTwitchChannelModal";
import { TwitchNotificationCard } from "./TwitchNotificationCard";
import { LivePanelPreviewModal } from "./LivePanelPreviewModal";
import type {
  CreateTwitchNotificationPayload,
  DashboardGuild,
  GuildLiveOptions,
  LivePanelPreview,
  SocialNotification,
  UpdateTwitchNotificationPayload
} from "../../types";

type LiveNotificationsPanelProps = {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
};

export function LiveNotificationsPanel({ botId, canManage, guild }: LiveNotificationsPanelProps) {
  const [notifications, setNotifications] = useState<SocialNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [limit, setLimit] = useState(10_000);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [liveOptions, setLiveOptions] = useState<GuildLiveOptions>({ channels: [], roles: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [panelPreview, setPanelPreview] = useState<LivePanelPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<SocialNotification | null>(null);
  const [deletingNotification, setDeletingNotification] = useState<SocialNotification | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
    setSearchInput("");
    setSearch("");
  }, [botId, guild?.id]);

  useEffect(() => {
    if (!canManage || !guild) {
      setLiveOptions({ channels: [], roles: [] });
      return;
    }

    let cancelled = false;

    getGuildLiveOptions(guild.id, botId)
      .then((options) => {
        if (!cancelled) {
          setLiveOptions(options);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLiveOptions({ channels: [], roles: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [botId, canManage, guild?.id]);

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      setNotifications([]);
      setTotal(0);
      setFilteredTotal(0);
      return;
    }

    if (!guild) {
      setLoading(false);
      setNotifications([]);
      setTotal(0);
      setFilteredTotal(0);
      return;
    }

    setLoading(true);
    setError(null);
    let cancelled = false;

    getSocialNotifications(guild.id, botId, {
        page,
        pageSize: 25,
        search
      })
      .then((result) => {
        if (cancelled) {
          return;
        }

        if (page > result.totalPages) {
          setPage(result.totalPages);
          return;
        }

        setNotifications(result.notifications);
        setTotal(result.total);
        setFilteredTotal(result.filteredTotal);
        setLimit(result.limit);
        setTotalPages(result.totalPages);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setError(readErrorMessage(requestError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [botId, canManage, guild?.id, page, refreshSignal, search]);

  async function handleCreate(payload: CreateTwitchNotificationPayload) {
    if (!guild) {
      return;
    }

    setSaving(true);
    setError(null);
    setStatus(null);

    try {
      await createTwitchNotification(guild.id, payload, botId);
      setSearchInput("");
      setSearch("");
      setPage(1);
      setRefreshSignal((current) => current + 1);
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
      const notification = await updateTwitchNotification(guild.id, editing.id, payload, botId);
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
      await deleteTwitchNotification(guild.id, deletingNotification.id, botId);
      setRefreshSignal((current) => current + 1);
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
      await testTwitchNotification(guild.id, notification.id, botId);
      setStatus(`Painel de @${notification.twitchChannelName} enviado para teste.`);
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setTestingId(null);
    }
  }

  async function handlePreview(notification: SocialNotification) {
    if (!guild) {
      return;
    }

    setPreviewingId(notification.id);
    setPanelPreview(null);
    setError(null);

    try {
      setPanelPreview(await previewTwitchNotificationPanel(guild.id, notification.id, botId));
    } catch (requestError) {
      setError(readErrorMessage(requestError));
      setPreviewingId(null);
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
          Twitch: <span className="font-semibold text-white">{total.toLocaleString("pt-BR")} / {limit.toLocaleString("pt-BR")}</span>
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
          filteredTotal={filteredTotal}
          limit={limit}
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
          onPreview={handlePreview}
          onTest={handleTest}
          onPageChange={setPage}
          onSearchChange={setSearchInput}
          page={page}
          roles={liveOptions.roles}
          search={searchInput}
          previewingId={previewingId}
          testingId={testingId}
          total={total}
          totalPages={totalPages}
        />
      ) : null}

      <AddTwitchChannelModal
        botId={botId}
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
      <LivePanelPreviewModal
        loading={Boolean(previewingId && !panelPreview)}
        onClose={() => {
          setPanelPreview(null);
          setPreviewingId(null);
        }}
        preview={panelPreview}
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

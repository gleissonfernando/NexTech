import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  FlaskConical,
  Loader2,
  Plug,
  Radio,
  Search,
  Settings,
  Trash2,
  X
} from "lucide-react";
import {
  createKickNotification,
  deleteKickNotification,
  getGuildLiveOptions,
  getKickIntegrationStatus,
  getKickNotifications,
  previewKickNotificationPanel,
  previewKickChannel,
  saveKickApiConfig,
  testKickNotification,
  updateKickNotification,
  validateKickApi
} from "../../lib/api";
import { Avatar } from "../ui/avatar";
import { Button } from "../ui/button";
import { SocialCard } from "./SocialCard";
import { LivePanelPreviewModal } from "./LivePanelPreviewModal";
import type {
  CreateKickNotificationPayload,
  DashboardGuild,
  GuildChannelOption,
  GuildLiveOptions,
  GuildRoleOption,
  KickChannelPreview,
  KickIntegrationStatus,
  KickNotification,
  LivePanelPreview,
  UpdateKickNotificationPayload
} from "../../types";

type KickIntegrationPanelProps = {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
};

const DEFAULT_EMBED_COLOR = "#53FC18";

export function KickIntegrationPanel({ botId, canManage, guild }: KickIntegrationPanelProps) {
  const [notifications, setNotifications] = useState<KickNotification[]>([]);
  const [integrationStatus, setIntegrationStatus] = useState<KickIntegrationStatus | null>(null);
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
  const [savingApi, setSavingApi] = useState(false);
  const [validating, setValidating] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [panelPreview, setPanelPreview] = useState<LivePanelPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<KickNotification | null>(null);
  const [deletingNotification, setDeletingNotification] = useState<KickNotification | null>(null);

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
    if (!canManage || !guild) {
      setLoading(false);
      setNotifications([]);
      setIntegrationStatus(null);
      setTotal(0);
      setFilteredTotal(0);
      return;
    }

    setLoading(true);
    setError(null);
    let cancelled = false;

    Promise.all([
      getKickNotifications(guild.id, botId, {
        page,
        pageSize: 25,
        search
      }),
      getKickIntegrationStatus(guild.id, botId)
    ])
      .then(([result, nextStatus]) => {
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
        setIntegrationStatus(nextStatus);
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

  async function handleValidateApi() {
    if (!guild) {
      return;
    }

    setValidating(true);
    setError(null);
    setStatus(null);

    try {
      const message = await validateKickApi(guild.id, botId);
      setStatus(message);
      setRefreshSignal((current) => current + 1);
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setValidating(false);
    }
  }

  async function handleSaveApiConfig(payload: { clientId: string; clientSecret?: string | null; redirectUri?: string | null }) {
    if (!guild) {
      return;
    }

    setSavingApi(true);
    setError(null);
    setStatus(null);

    try {
      const message = await saveKickApiConfig(guild.id, payload, botId);
      setStatus(message);
      setRefreshSignal((current) => current + 1);
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setSavingApi(false);
    }
  }

  async function handleCreate(payload: CreateKickNotificationPayload) {
    if (!guild) {
      return;
    }

    setSaving(true);
    setError(null);
    setStatus(null);

    try {
      await createKickNotification(guild.id, payload, botId);
      setSearchInput("");
      setSearch("");
      setPage(1);
      setRefreshSignal((current) => current + 1);
      setAddOpen(false);
      setStatus("Canal Kick cadastrado com sucesso.");
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(payload: UpdateKickNotificationPayload) {
    if (!guild || !editing) {
      return;
    }

    setSaving(true);
    setError(null);
    setStatus(null);

    try {
      const notification = await updateKickNotification(guild.id, editing.id, payload, botId);
      setNotifications((current) => current.map((item) => (item.id === notification.id ? notification : item)));
      setEditing(null);
      setStatus("Configuracao Kick salva.");
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
      await deleteKickNotification(guild.id, deletingNotification.id, botId);
      setRefreshSignal((current) => current + 1);
      setDeletingNotification(null);
      setStatus("Canal Kick removido.");
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setDeleting(false);
    }
  }

  async function handleTest(notification: KickNotification) {
    if (!guild) {
      return;
    }

    setTestingId(notification.id);
    setError(null);
    setStatus(null);

    try {
      await testKickNotification(guild.id, notification.id, botId);
      setStatus(`Painel de @${notification.kickChannelName} enviado para teste.`);
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setTestingId(null);
    }
  }

  async function handlePreview(notification: KickNotification) {
    if (!guild) {
      return;
    }

    setPreviewingId(notification.id);
    setPanelPreview(null);
    setError(null);

    try {
      setPanelPreview(await previewKickNotificationPanel(guild.id, notification.id, botId));
    } catch (requestError) {
      setError(readErrorMessage(requestError));
      setPreviewingId(null);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-[#53fc18]/30 bg-[#53fc18]/10 text-[#53fc18]">
            <Radio className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xl font-semibold text-white">Kick Integration</h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-500">
              Cadastre canais da Kick para o bot avisar quando uma transmissao comecar ou encerrar.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-900 bg-zinc-950/75 px-4 py-2 text-sm text-zinc-500">
          Kick: <span className="font-semibold text-white">{total.toLocaleString("pt-BR")} / {limit.toLocaleString("pt-BR")}</span>
        </div>
      </div>

      {loading ? <KickSkeleton /> : null}
      {!canManage ? (
        <div className="rounded-lg border border-zinc-900 bg-zinc-950/75 p-5 text-sm leading-6 text-zinc-500">
          Voce nao possui acesso ao modulo Kick Integration.
        </div>
      ) : null}
      {status ? <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">{status}</div> : null}
      {error ? <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-white">{error}</div> : null}

      {canManage ? (
        <>
          <KickStatusGrid status={integrationStatus} />
          <KickApiCard
            loading={validating}
            onSave={handleSaveApiConfig}
            onValidate={handleValidateApi}
            saving={savingApi}
            status={integrationStatus}
          />
          <KickNotificationCard
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
            onPageChange={setPage}
            onSearchChange={setSearchInput}
            onPreview={handlePreview}
            onTest={handleTest}
            page={page}
            roles={liveOptions.roles}
            search={searchInput}
            previewingId={previewingId}
            testingId={testingId}
            total={total}
            totalPages={totalPages}
          />
        </>
      ) : null}

      <AddKickChannelModal
        botId={botId}
        error={error}
        guildId={guild?.id ?? null}
        onClose={() => setAddOpen(false)}
        onSubmit={handleCreate}
        open={addOpen}
        options={liveOptions}
        saving={saving}
      />
      <EditKickChannelModal
        error={error}
        notification={editing}
        onClose={() => setEditing(null)}
        onSubmit={handleUpdate}
        options={liveOptions}
        saving={saving}
      />
      <DeleteKickChannelModal
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

function KickStatusGrid({ status }: { status: KickIntegrationStatus | null }) {
  const items = [
    {
      label: "Status da API",
      value: status?.apiStatus === "ok" ? "Conectada" : status?.apiStatus === "error" ? "Erro" : "Pendente"
    },
    {
      label: "Conta conectada",
      value: status?.connectedAccount?.kickChannelName ? `@${status.connectedAccount.kickChannelName}` : "Nenhuma"
    },
    {
      label: "Canais monitorados",
      value: String(status?.totalChannels ?? 0)
    },
    {
      label: "Ultima live",
      value: status?.lastLiveAt ? formatDateTime(status.lastLiveAt) : "Nenhuma"
    }
  ];

  return (
    <div className="grid gap-3 md:grid-cols-4">
      {items.map((item) => (
        <div className="rounded-lg border border-zinc-900 bg-zinc-950/75 p-4" key={item.label}>
          <p className="text-xs text-zinc-500">{item.label}</p>
          <p className="mt-2 truncate text-sm font-semibold text-white">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function KickApiCard({
  loading,
  onSave,
  onValidate,
  saving,
  status
}: {
  loading: boolean;
  onSave: (payload: { clientId: string; clientSecret?: string | null; redirectUri?: string | null }) => void;
  onValidate: () => void;
  saving: boolean;
  status: KickIntegrationStatus | null;
}) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const ok = status?.apiStatus === "ok";

  useEffect(() => {
    setClientId(status?.apiConfig?.clientId ?? "");
    setClientSecret("");
    setWebhookUrl(status?.apiConfig?.redirectUri ?? defaultKickWebhookUrl());
  }, [status?.apiConfig?.clientId, status?.apiConfig?.redirectUri]);

  return (
    <form
      className="rounded-lg border border-zinc-900 bg-zinc-950/75 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          clientId,
          clientSecret: clientSecret || null,
          redirectUri: webhookUrl || null
        });
      }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#53fc18]/25 bg-[#53fc18]/10 text-[#53fc18]">
            <Plug className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h4 className="text-base font-semibold text-white">API Kick</h4>
            <p className="mt-1 text-sm text-zinc-500">{status?.apiMessage ?? "Validacao pendente."}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button disabled={saving || !clientId || (!clientSecret && !status?.apiConfig?.secretConfigured)} type="submit">
            {saving ? "Salvando..." : "Salvar"}
          </Button>
          <Button disabled={loading} onClick={onValidate} type="button" variant="outline">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Validar
          </Button>
          <Button disabled={loading || !ok} onClick={onValidate} type="button">
            Testar
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Field label="Client ID">
          <input
            className="social-input"
            onChange={(event) => setClientId(event.target.value)}
            placeholder="Client ID da Kick"
            value={clientId}
          />
        </Field>
        <Field label="API Key">
          <input
            className="social-input"
            onChange={(event) => setClientSecret(event.target.value)}
            placeholder={status?.apiConfig?.secretConfigured ? "API Key salva" : "API Key ou Client Secret"}
            type="password"
            value={clientSecret}
          />
        </Field>
        <Field label="Webhook URL">
          <input
            className="social-input"
            onChange={(event) => setWebhookUrl(event.target.value)}
            placeholder="https://seu-site.com/api/kick/webhook"
            type="url"
            value={webhookUrl}
          />
        </Field>
      </div>
    </form>
  );
}

function KickNotificationCard({
  channels,
  filteredTotal,
  limit,
  notifications,
  onAdd,
  onDelete,
  onEdit,
  onPageChange,
  onSearchChange,
  onPreview,
  onTest,
  page,
  roles,
  search,
  previewingId,
  testingId,
  total,
  totalPages
}: {
  notifications: KickNotification[];
  total: number;
  filteredTotal: number;
  limit: number;
  page: number;
  totalPages: number;
  search: string;
  channels: GuildChannelOption[];
  roles: GuildRoleOption[];
  onAdd: () => void;
  onEdit: (notification: KickNotification) => void;
  onDelete: (notification: KickNotification) => void;
  onPreview: (notification: KickNotification) => void;
  onTest: (notification: KickNotification) => void;
  onPageChange: (page: number) => void;
  onSearchChange: (value: string) => void;
  testingId: string | null;
  previewingId: string | null;
}) {
  return (
    <SocialCard
      actionLabel="Adicionar Canal"
      count={`${total.toLocaleString("pt-BR")} / ${limit.toLocaleString("pt-BR")}`}
      description="Cadastre a URL da Kick e selecione o canal Discord que recebera os alertas."
      disabled={total >= limit}
      icon={Radio}
      iconClassName="text-[#53fc18]"
      onAction={onAdd}
      title="Kick"
    >
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        <input
          className="social-input h-11 pl-10"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Buscar canal da Kick"
          type="search"
          value={search}
        />
      </div>

      {search ? (
        <p className="mb-3 text-xs text-zinc-500">
          {filteredTotal.toLocaleString("pt-BR")} resultado{filteredTotal === 1 ? "" : "s"}
        </p>
      ) : null}

      {notifications.length ? (
        <div className="space-y-3">
          {notifications.map((notification) => (
            <KickChannelItem
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
          {search ? "Nenhum canal encontrado." : "Nenhum canal Kick cadastrado."}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-zinc-900 pt-4">
          <p className="text-xs text-zinc-500">
            Pagina <span className="font-medium text-zinc-200">{page}</span> de {totalPages.toLocaleString("pt-BR")}
          </p>
          <div className="flex gap-2">
            <Button disabled={page <= 1} onClick={() => onPageChange(page - 1)} size="icon" title="Pagina anterior" variant="outline">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} size="icon" title="Proxima pagina" variant="outline">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </SocialCard>
  );
}

function KickChannelItem({
  channelName,
  notification,
  onDelete,
  onEdit,
  onPreview,
  onTest,
  previewing,
  roleName,
  testing
}: {
  notification: KickNotification;
  channelName: string;
  roleName: string;
  testing: boolean;
  previewing: boolean;
  onEdit: (notification: KickNotification) => void;
  onDelete: (notification: KickNotification) => void;
  onPreview: (notification: KickNotification) => void;
  onTest: (notification: KickNotification) => void;
}) {
  const embedColor = notification.embedColor ?? DEFAULT_EMBED_COLOR;

  return (
    <article className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/70 shadow-[0_18px_60px_rgba(0,0,0,0.34)] transition duration-300 hover:-translate-y-0.5 hover:border-[#53fc18]/50 hover:bg-[#0d1a0d]">
      <div className="border-l-4 p-4" style={{ borderColor: embedColor }}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar className="h-14 w-14 rounded-lg" fallback={notification.kickDisplayName ?? notification.kickChannelName} src={notification.kickAvatar} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-base font-semibold text-white">@{notification.kickChannelName}</p>
                <StatusPill live={notification.isLive} />
              </div>
              <a className="mt-1 flex max-w-full items-center gap-1 truncate text-xs text-zinc-500 hover:text-white" href={notification.kickChannelUrl} rel="noreferrer" target="_blank">
                {notification.kickChannelUrl}
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
              <p className="mt-1 truncate font-mono text-[11px] text-zinc-600">ID Kick: {notification.kickUserId ?? "sincronizando"}</p>
            </div>
          </div>

          <div className="grid gap-2 text-xs text-zinc-500 sm:grid-cols-4 lg:min-w-[520px]">
            <Fact label="Canal Discord" value={channelName} />
            <Fact label="Mencao" value={roleName} />
            <Fact label="Pico" value={String(notification.peakViewers ?? 0)} />
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
          <Button className="h-9 px-3 text-xs" disabled={previewing} onClick={() => onPreview(notification)} type="button" variant="outline">
            <Eye className="h-3.5 w-3.5" />
            {previewing ? "Carregando..." : "Visualizar painel"}
          </Button>
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

function AddKickChannelModal({
  botId,
  error,
  guildId,
  onClose,
  onSubmit,
  open,
  options,
  saving
}: {
  botId?: string | null;
  open: boolean;
  error: string | null;
  guildId: string | null;
  options: GuildLiveOptions;
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateKickNotificationPayload) => void;
}) {
  const [kickChannelInput, setKickChannelInput] = useState("");
  const [discordChannelId, setDiscordChannelId] = useState("");
  const [mentionRoleId, setMentionRoleId] = useState("everyone");
  const [customMessage, setCustomMessage] = useState("");
  const [embedColor, setEmbedColor] = useState(DEFAULT_EMBED_COLOR);
  const [enabled, setEnabled] = useState(true);
  const [preview, setPreview] = useState<KickChannelPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const canSave = Boolean(preview && discordChannelId && !saving);
  const normalizedInput = useMemo(() => kickChannelInput.trim(), [kickChannelInput]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setPreview(null);
    setPreviewError(null);
  }, [open]);

  useEffect(() => {
    if (!open || discordChannelId || !options.channels.length) {
      return;
    }

    setDiscordChannelId(options.channels[0]?.id ?? "");
  }, [discordChannelId, open, options.channels]);

  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
  }, [normalizedInput]);

  async function handlePreview() {
    if (!guildId || !normalizedInput) {
      setPreviewError("Informe a URL do canal Kick.");
      return;
    }

    setPreviewing(true);
    setPreviewError(null);

    try {
      const nextPreview = await previewKickChannel(guildId, normalizedInput, botId);
      setPreview(nextPreview);
    } catch (requestError) {
      setPreview(null);
      setPreviewError(readErrorMessage(requestError));
    } finally {
      setPreviewing(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <ModalShell onClose={onClose} title="Adicionar Canal Kick">
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSave) {
            return;
          }

          onSubmit({
            kickChannelInput,
            discordChannelId,
            mentionRoleId: mentionRoleId || null,
            customMessage: customMessage || null,
            embedColor,
            enabled
          });
        }}
      >
        <Field label="URL do Canal Kick">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="social-input"
              onChange={(event) => setKickChannelInput(event.target.value)}
              placeholder="https://kick.com/canal"
              type="url"
              value={kickChannelInput}
            />
            <Button className="h-12 sm:h-auto" disabled={previewing || !normalizedInput} onClick={handlePreview} type="button" variant="outline">
              {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Buscar
            </Button>
          </div>
        </Field>

        {preview ? <KickPreviewCard preview={preview} /> : null}
        {previewError ? <p className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-white">{previewError}</p> : null}

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Canal Discord">
            {options.channels.length ? (
              <select className="social-input" onChange={(event) => setDiscordChannelId(event.target.value)} required value={discordChannelId}>
                {options.channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    #{channel.name}
                  </option>
                ))}
              </select>
            ) : (
              <input className="social-input" onChange={(event) => setDiscordChannelId(event.target.value)} placeholder="ID do canal Discord" value={discordChannelId} />
            )}
          </Field>

          <Field label="Cargo para mencionar">
            <select className="social-input" onChange={(event) => setMentionRoleId(event.target.value)} value={mentionRoleId}>
              <option value="everyone">@everyone</option>
              <option value="">Sem mencao</option>
              {options.roles
                .filter((role) => role.name !== "@everyone")
                .map((role) => (
                  <option key={role.id} value={role.id}>
                    @{role.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>

        <Field label="Mensagem personalizada">
          <textarea
            className="social-input min-h-24 resize-none"
            onChange={(event) => setCustomMessage(event.target.value)}
            placeholder="{streamer} iniciou live na Kick: {url}"
            value={customMessage}
          />
        </Field>

        <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
          {["{streamer}", "{title}", "{category}", "{viewers}", "{url}", "{followers}", "{live_started}"].map((variable) => (
            <span className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono" key={variable}>{variable}</span>
          ))}
        </div>

        <div className="flex flex-col gap-4 rounded-lg border border-zinc-900 bg-zinc-950/70 p-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-3 text-sm text-zinc-400">
            <input checked={enabled} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />
            Ativar notificacao
          </label>
          <label className="flex items-center gap-3 text-sm text-zinc-400">
            <span>Cor da embed</span>
            <input className="h-9 w-12 rounded border border-zinc-800 bg-transparent p-1" onChange={(event) => setEmbedColor(event.target.value)} type="color" value={embedColor} />
            <span className="font-mono text-xs text-zinc-500">{embedColor}</span>
          </label>
        </div>

        {error ? <p className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-white">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="outline">Cancelar</Button>
          <Button disabled={!canSave} type="submit">
            {saving ? "Salvando..." : "Salvar canal"}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

function EditKickChannelModal({
  error,
  notification,
  onClose,
  onSubmit,
  options,
  saving
}: {
  notification: KickNotification | null;
  error: string | null;
  options: GuildLiveOptions;
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: UpdateKickNotificationPayload) => void;
}) {
  const [discordChannelId, setDiscordChannelId] = useState("");
  const [mentionRoleId, setMentionRoleId] = useState("everyone");
  const [customMessage, setCustomMessage] = useState("");
  const [embedColor, setEmbedColor] = useState(DEFAULT_EMBED_COLOR);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!notification) {
      return;
    }

    setDiscordChannelId(notification.discordChannelId);
    setMentionRoleId(notification.mentionRoleId ?? "everyone");
    setCustomMessage(notification.customMessage ?? "");
    setEmbedColor(notification.embedColor ?? DEFAULT_EMBED_COLOR);
    setEnabled(notification.enabled);
  }, [notification]);

  if (!notification) {
    return null;
  }

  return (
    <ModalShell onClose={onClose} title={`Configurar @${notification.kickChannelName}`}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            discordChannelId,
            mentionRoleId: mentionRoleId || null,
            customMessage: customMessage || null,
            embedColor,
            enabled
          });
        }}
      >
        <Field label="Canal para enviar lives">
          {options.channels.length ? (
            <select className="social-input" onChange={(event) => setDiscordChannelId(event.target.value)} required value={discordChannelId}>
              {options.channels.some((channel) => channel.id === discordChannelId) ? null : (
                <option value={discordChannelId}>Canal atual: {discordChannelId}</option>
              )}
              {options.channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  #{channel.name}
                </option>
              ))}
            </select>
          ) : (
            <input className="social-input" onChange={(event) => setDiscordChannelId(event.target.value)} value={discordChannelId} />
          )}
        </Field>
        <Field label="Cargo para mencionar">
          <select className="social-input" onChange={(event) => setMentionRoleId(event.target.value)} value={mentionRoleId}>
            <option value="everyone">@everyone</option>
            <option value="">Sem mencao</option>
            {options.roles
              .filter((role) => role.name !== "@everyone")
              .map((role) => (
                <option key={role.id} value={role.id}>
                  @{role.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Mensagem personalizada">
          <textarea className="social-input min-h-24 resize-none" onChange={(event) => setCustomMessage(event.target.value)} placeholder="{streamer} iniciou live na Kick: {url}" value={customMessage} />
        </Field>
        <div className="flex flex-col gap-4 rounded-lg border border-zinc-900 bg-zinc-950/70 p-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-3 text-sm text-zinc-500">
            <input checked={enabled} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />
            Ativar notificacao
          </label>
          <label className="flex items-center gap-3 text-sm text-zinc-500">
            <span>Cor da embed</span>
            <input className="h-9 w-12 rounded border border-zinc-800 bg-transparent p-1" onChange={(event) => setEmbedColor(event.target.value)} type="color" value={embedColor} />
            <span className="font-mono text-xs">{embedColor}</span>
          </label>
        </div>
        {error ? <p className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-white">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="outline">Cancelar</Button>
          <Button disabled={saving} type="submit">
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

function DeleteKickChannelModal({
  deleting,
  notification,
  onClose,
  onConfirm
}: {
  notification: KickNotification | null;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!notification) {
    return null;
  }

  return (
    <ModalShell onClose={onClose} title="Excluir canal Kick">
      <p className="text-sm leading-6 text-zinc-500">
        Remover @{notification.kickChannelName} dos alertas Kick deste servidor?
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose} type="button" variant="outline">Cancelar</Button>
        <Button disabled={deleting} onClick={onConfirm} type="button" variant="secondary">
          {deleting ? "Excluindo..." : "Excluir"}
        </Button>
      </div>
    </ModalShell>
  );
}

function KickPreviewCard({ preview }: { preview: KickChannelPreview }) {
  return (
    <div className="rounded-lg border border-[#53fc18]/40 bg-[#071707]/80 p-4 shadow-[0_18px_60px_rgba(83,252,24,0.12)]">
      <div className="flex items-center gap-3">
        <Avatar className="h-14 w-14 rounded-lg" fallback={preview.kickDisplayName} src={preview.kickAvatar} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Radio className="h-4 w-4 text-[#53fc18]" />
            <span className="truncate">{preview.kickDisplayName}</span>
          </div>
          <p className="mt-1 truncate text-xs text-zinc-400">@{preview.kickUsername}</p>
          <p className="mt-1 truncate font-mono text-[11px] text-zinc-500">{preview.kickUserId}</p>
        </div>
        <CheckCircle2 className="h-5 w-5 text-emerald-400" />
      </div>
    </div>
  );
}

function ModalShell({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm">
      <div className="discord-scrollbar max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-zinc-800 bg-[#0b0b0b]/95 p-5 shadow-[0_32px_100px_rgba(0,0,0,0.72)] backdrop-blur-xl">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-500 transition duration-300 hover:text-white" onClick={onClose} type="button">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-white">{label}</span>
      {children}
    </label>
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

function KickSkeleton() {
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

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function readErrorMessage(error: unknown) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? "Nao foi possivel concluir a acao.";
  }

  return "Nao foi possivel concluir a acao.";
}

function defaultKickWebhookUrl() {
  try {
    return `${window.location.origin}/api/kick/webhook`;
  } catch {
    return "/api/kick/webhook";
  }
}

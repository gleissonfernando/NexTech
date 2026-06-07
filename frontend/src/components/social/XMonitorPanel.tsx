import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AtSign,
  CheckCircle2,
  Clock,
  Loader2,
  Pencil,
  Plus,
  Radio,
  Search,
  Trash2,
  XCircle
} from "lucide-react";
import {
  createXAccount,
  deleteXAccount,
  getGuildLiveOptions,
  getXMonitor,
  updateXAccount,
  verifyXAccount
} from "../../lib/api";
import { createDashboardSocket } from "../../lib/socket";
import type {
  DashboardGuild,
  GuildLiveOptions,
  LogEntry,
  SaveXAccountPayload,
  XAccount,
  XAccountPreview
} from "../../types";
import { Avatar } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Field, ModalShell } from "./AddTwitchChannelModal";

type XMonitorPanelProps = {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
};

type XMonitorUpdateEvent = {
  action: string;
  account?: XAccount;
  botId?: string | null;
  guildId: string;
};

const EMPTY_OPTIONS: GuildLiveOptions = { channels: [], roles: [] };

export function XMonitorPanel({ botId, canManage, guild }: XMonitorPanelProps) {
  const [accounts, setAccounts] = useState<XAccount[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [options, setOptions] = useState<GuildLiveOptions>(EMPTY_OPTIONS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<XAccount | null>(null);

  const stats = useMemo(
    () => ({
      active: accounts.filter((account) => account.active).length,
      errors: accounts.filter((account) => account.lastApiStatus === "error").length,
      sent: accounts.reduce((total, account) => total + account.totalPostsSent, 0),
      total: accounts.length
    }),
    [accounts]
  );

  useEffect(() => {
    setAccounts([]);
    setLogs([]);
    setStatus(null);
    setError(null);
  }, [botId, guild?.id]);

  useEffect(() => {
    if (!canManage || !guild) {
      setOptions(EMPTY_OPTIONS);
      return;
    }

    let cancelled = false;

    getGuildLiveOptions(guild.id, botId)
      .then((nextOptions) => {
        if (!cancelled) {
          setOptions(nextOptions);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOptions(EMPTY_OPTIONS);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [botId, canManage, guild?.id]);

  useEffect(() => {
    if (!canManage || !guild) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getXMonitor(guild.id, botId)
      .then((data) => {
        if (cancelled) {
          return;
        }

        setAccounts(data.accounts);
        setLogs(data.logs);
      })
      .catch((requestError) => {
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
  }, [botId, canManage, guild?.id]);

  useEffect(() => {
    if (!guild) {
      return;
    }

    const socket = createDashboardSocket();

    socket.on("x-monitor:update", (event: XMonitorUpdateEvent) => {
      if (event.guildId !== guild.id || (event.botId ?? null) !== (botId ?? null) || !event.account) {
        return;
      }

      setAccounts((current) => {
        if (event.action === "account_removed") {
          return current.filter((account) => account.id !== event.account?.id);
        }

        return current.some((account) => account.id === event.account?.id)
          ? current.map((account) => (account.id === event.account?.id ? event.account! : account))
          : [event.account!, ...current];
      });
    });
    socket.on("x-monitor:log", (log: LogEntry) => {
      if (log.guildId === guild.id && (log.botId ?? null) === (botId ?? null)) {
        setLogs((current) => [log, ...current.filter((item) => item.id !== log.id)].slice(0, 50));
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [botId, guild?.id]);

  async function handleCreate(payload: SaveXAccountPayload) {
    if (!guild) {
      return;
    }

    setSaving(true);
    setError(null);
    setStatus(null);

    try {
      const account = await createXAccount(guild.id, payload, botId);
      setAccounts((current) => [account, ...current.filter((item) => item.id !== account.id)]);
      setAddOpen(false);
      setStatus(`@${account.username} foi cadastrado no X Monitor.`);
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(payload: SaveXAccountPayload) {
    if (!guild || !editing) {
      return;
    }

    setSaving(true);
    setError(null);
    setStatus(null);

    try {
      const account = await updateXAccount(guild.id, editing.id, payload, botId);
      setAccounts((current) => current.map((item) => (item.id === account.id ? account : item)));
      setEditing(null);
      setStatus(`@${account.username} foi atualizado.`);
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(account: XAccount) {
    if (!guild || !window.confirm(`Remover @${account.username} do X Monitor?`)) {
      return;
    }

    setSaving(true);
    setError(null);
    setStatus(null);

    try {
      await deleteXAccount(guild.id, account.id, botId);
      setAccounts((current) => current.filter((item) => item.id !== account.id));
      setStatus(`@${account.username} foi removido.`);
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) {
    return (
      <Card>
        <CardContent className="p-5 text-sm leading-6 text-zinc-500">
          Sua conta tem visualizacao basica. O X Monitor fica disponivel apenas para administradores ou equipe autorizada.
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-950 text-white">
            <AtSign className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xl font-semibold text-white">X Monitor</h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-500">
              Monitore contas do X e envie novas publicacoes automaticamente para canais do Discord.
            </p>
          </div>
        </div>
        <Button disabled={saving} onClick={() => setAddOpen(true)} type="button">
          <Plus className="h-4 w-4" />
          Adicionar Conta
        </Button>
      </div>

      {loading ? <XMonitorSkeleton /> : null}
      {status ? <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">{status}</div> : null}
      {error ? <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-white">{error}</div> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatusCard icon={AtSign} label="Contas cadastradas" value={String(stats.total)} />
        <StatusCard icon={Radio} label="Ativas" value={String(stats.active)} />
        <StatusCard icon={Activity} label="Postagens enviadas" value={stats.sent.toLocaleString("pt-BR")} />
        <StatusCard icon={XCircle} label="Falhas API" value={String(stats.errors)} />
      </section>

      <Card>
        <CardHeader className="border-b border-zinc-900">
          <CardTitle>Contas cadastradas</CardTitle>
          <CardDescription>Username, canal de destino, status da sincronizacao e total enviado.</CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          {accounts.length ? (
            <div className="space-y-3">
              {accounts.map((account) => (
                <XAccountRow
                  account={account}
                  channelName={formatChannelName(options, account.channelId)}
                  key={account.id}
                  onDelete={() => void handleDelete(account)}
                  onEdit={() => {
                    setError(null);
                    setEditing(account);
                  }}
                  saving={saving}
                />
              ))}
            </div>
          ) : (
            <div className="flex min-h-44 flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 p-6 text-center">
              <AtSign className="mb-3 h-8 w-8 text-zinc-500" />
              <p className="text-sm font-medium text-zinc-300">Nenhuma conta cadastrada</p>
              <p className="mt-1 text-sm text-zinc-500">Adicione um username para iniciar o monitoramento.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-zinc-900">
          <CardTitle>Logs</CardTitle>
          <CardDescription>Eventos recentes do X Monitor, incluindo API, Discord e postagens.</CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          <div className="space-y-3">
            {logs.length ? logs.map((log) => <LogRow key={log.id} log={log} />) : (
              <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 p-5 text-sm text-zinc-500">
                Nenhum log do X Monitor registrado.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <XAccountModal
        account={null}
        botId={botId}
        error={error}
        guild={guild}
        onClose={() => setAddOpen(false)}
        onSubmit={handleCreate}
        open={addOpen}
        options={options}
        saving={saving}
      />
      <XAccountModal
        account={editing}
        botId={botId}
        error={error}
        guild={guild}
        onClose={() => setEditing(null)}
        onSubmit={handleUpdate}
        open={Boolean(editing)}
        options={options}
        saving={saving}
      />
    </section>
  );
}

function XAccountRow({
  account,
  channelName,
  onDelete,
  onEdit,
  saving
}: {
  account: XAccount;
  channelName: string;
  onDelete: () => void;
  onEdit: () => void;
  saving: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-900 bg-zinc-950/70 p-4 transition duration-300 hover:border-zinc-700 hover:bg-zinc-900/70">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar className="h-14 w-14 rounded-lg border border-zinc-800" fallback={account.displayName} src={account.avatar} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-base font-semibold text-white">{account.displayName}</p>
              <Badge variant={account.active ? "success" : "muted"}>{account.active ? "Ativo" : "Inativo"}</Badge>
              <ApiStatusBadge account={account} />
            </div>
            <p className="mt-1 truncate text-sm text-zinc-400">@{account.username}</p>
            <p className="mt-1 truncate text-xs text-zinc-500">{channelName}</p>
          </div>
        </div>

        <div className="grid gap-2 text-xs text-zinc-500 sm:grid-cols-3 lg:min-w-[460px]">
          <Fact label="Ultima sincronizacao" value={formatNullableDate(account.lastSyncAt)} />
          <Fact label="Ultima postagem" value={account.lastPostId ? account.lastPostId : "Nenhuma"} />
          <Fact label="Total enviado" value={account.totalPostsSent.toLocaleString("pt-BR")} />
        </div>

        <div className="flex shrink-0 gap-2">
          <Button disabled={saving} onClick={onEdit} size="sm" type="button" variant="outline">
            <Pencil className="h-4 w-4" />
            Editar
          </Button>
          <Button disabled={saving} onClick={onDelete} size="sm" type="button" variant="destructive">
            <Trash2 className="h-4 w-4" />
            Remover
          </Button>
        </div>
      </div>

      {account.lastApiError ? (
        <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2 text-xs text-red-100">
          {account.lastApiError}
        </p>
      ) : null}
    </div>
  );
}

function XAccountModal({
  account,
  botId,
  error,
  guild,
  onClose,
  onSubmit,
  open,
  options,
  saving
}: {
  account: XAccount | null;
  botId?: string | null;
  error: string | null;
  guild: DashboardGuild | null;
  onClose: () => void;
  onSubmit: (payload: SaveXAccountPayload) => void;
  open: boolean;
  options: GuildLiveOptions;
  saving: boolean;
}) {
  const [username, setUsername] = useState("");
  const [channelId, setChannelId] = useState("");
  const [active, setActive] = useState(true);
  const [preview, setPreview] = useState<XAccountPreview | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setUsername(account?.username ?? "");
    setChannelId(account?.channelId ?? options.channels[0]?.id ?? "");
    setActive(account?.active ?? true);
    setPreview(account ? {
      avatar: account.avatar,
      displayName: account.displayName,
      mostRecentPostId: account.lastPostId,
      username: account.username,
      xUserId: account.xUserId
    } : null);
    setVerifyError(null);
  }, [account, open, options.channels]);

  const usernameChanged = normalizeUsername(username) !== normalizeUsername(account?.username ?? "");
  const canSave = Boolean(guild && channelId && username.trim() && preview && (!usernameChanged || normalizeUsername(preview.username) === normalizeUsername(username)) && !saving);

  async function handleVerify() {
    if (!guild || !username.trim()) {
      setVerifyError("Informe o username do X.");
      return;
    }

    setVerifying(true);
    setVerifyError(null);

    try {
      const profile = await verifyXAccount(guild.id, username, botId);
      setPreview(profile);
      setUsername(profile.username);
    } catch (requestError) {
      setPreview(null);
      setVerifyError(readErrorMessage(requestError));
    } finally {
      setVerifying(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <ModalShell onClose={onClose} title={account ? "Editar Conta do X" : "Adicionar Conta do X"}>
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();

          if (!canSave) {
            return;
          }

          onSubmit({
            active,
            channelId,
            username: preview?.username ?? username
          });
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Servidor Discord">
            <input className="social-input" disabled value={guild?.name ?? "Servidor"} />
          </Field>
          <Field label="Canal Discord de destino">
            {options.channels.length ? (
              <select className="social-input" onChange={(event) => setChannelId(event.target.value)} required value={channelId}>
                {options.channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    #{channel.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="social-input"
                inputMode="numeric"
                onChange={(event) => setChannelId(event.target.value.replace(/\D/g, ""))}
                placeholder="ID do canal Discord"
                required
                value={channelId}
              />
            )}
          </Field>
        </div>

        <Field label="Username do X (sem @)">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="social-input"
              onChange={(event) => {
                setUsername(event.target.value.replace(/^@+/, ""));
                if (account && normalizeUsername(event.target.value) !== normalizeUsername(account.username)) {
                  setPreview(null);
                }
              }}
              placeholder="xdevelopers"
              required
              value={username}
            />
            <Button className="h-12 sm:h-auto" disabled={verifying || !username.trim()} onClick={handleVerify} type="button" variant="outline">
              {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Verificar Conta
            </Button>
          </div>
        </Field>

        {preview ? <PreviewCard preview={preview} /> : null}
        {verifyError ? <p className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-white">{verifyError}</p> : null}

        <label className="flex items-center justify-between gap-4 rounded-lg border border-zinc-900 bg-zinc-950/70 p-4 text-sm text-zinc-400">
          <span>
            <span className="block font-medium text-white">Monitoramento</span>
            <span className="text-xs text-zinc-500">Ativo busca novas publicacoes periodicamente.</span>
          </span>
          <input checked={active} onChange={(event) => setActive(event.target.checked)} type="checkbox" />
        </label>

        {error ? <p className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-white">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="outline">Cancelar</Button>
          <Button disabled={!canSave} type="submit">
            {saving ? "Salvando..." : account ? "Salvar conta" : "Adicionar conta"}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

function PreviewCard({ preview }: { preview: XAccountPreview }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="flex items-center gap-3">
        <Avatar className="h-14 w-14 rounded-lg border border-zinc-700" fallback={preview.displayName} src={preview.avatar} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <span className="truncate">{preview.displayName}</span>
          </div>
          <p className="mt-1 truncate text-xs text-zinc-400">@{preview.username}</p>
          <p className="mt-1 truncate font-mono text-[11px] text-zinc-500">ID {preview.xUserId}</p>
        </div>
        <Badge variant="success">Validada</Badge>
      </div>
    </div>
  );
}

function StatusCard({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-200">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm text-zinc-500">{label}</p>
          <p className="truncate text-2xl font-semibold text-white">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-900 bg-black/35 p-3">
      <p className="truncate text-[11px] uppercase text-zinc-600">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-zinc-200" title={value}>{value}</p>
    </div>
  );
}

function ApiStatusBadge({ account }: { account: XAccount }) {
  if (account.lastApiStatus === "error") {
    return <Badge variant="danger">API com falha</Badge>;
  }

  if (account.lastApiStatus === "ok") {
    return <Badge variant="success">API OK</Badge>;
  }

  return <Badge variant="muted">Aguardando sync</Badge>;
}

function LogRow({ log }: { log: LogEntry }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-zinc-900 bg-zinc-950/70 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-white">{log.message}</p>
        <p className="mt-1 truncate text-xs text-zinc-500">{log.type}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-xs text-zinc-500">
        <Clock className="h-3.5 w-3.5" />
        {formatNullableDate(log.createdAt)}
      </div>
    </div>
  );
}

function XMonitorSkeleton() {
  return (
    <div className="space-y-3 rounded-lg border border-zinc-900 bg-zinc-950/75 p-5">
      {[0, 1, 2].map((item) => (
        <div className="flex animate-pulse items-center gap-4" key={item}>
          <div className="h-14 w-14 rounded-lg bg-zinc-800" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-40 rounded bg-zinc-800" />
            <div className="h-3 w-full max-w-xl rounded bg-zinc-900" />
          </div>
        </div>
      ))}
    </div>
  );
}

function formatChannelName(options: GuildLiveOptions, channelId: string) {
  const channel = options.channels.find((item) => item.id === channelId);
  return channel ? `#${channel.name}` : channelId;
}

function formatNullableDate(value: string | null) {
  if (!value) {
    return "Nunca";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function normalizeUsername(value: string) {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

function readErrorMessage(error: unknown) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? "Nao foi possivel concluir a acao.";
  }

  return "Nao foi possivel concluir a acao.";
}

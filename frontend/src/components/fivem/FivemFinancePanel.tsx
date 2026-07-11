import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleDollarSign,
  Download,
  ExternalLink,
  Loader2,
  Save,
  Send,
  Wallet,
} from "lucide-react";
import { createDashboardSocket } from "../../lib/socket";
import {
  getFivemFinance,
  getGuildLiveOptions,
  publishFivemFinancePanel,
  saveFivemFinanceSettings,
  updateFivemFinanceTransaction,
} from "../../lib/api";
import type {
  DashboardGuild,
  FivemFinanceDashboard,
  FivemFinanceSettings,
  FivemFinanceTransaction,
  GuildChannelOption,
  GuildRoleOption,
} from "../../types";
import { PanelImageSettings } from "../panels/PanelImageSettings";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import {
  FivemResourceMultiSelect,
  FivemResourceSelect,
} from "./FivemResourceSelect";

type Tab = "overview" | "settings" | "history";

export function FivemFinancePanel({
  botId,
  canManage,
  guild,
}: {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
}) {
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [dashboard, setDashboard] = useState<FivemFinanceDashboard | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState({
    period: "all",
    search: "",
    status: "all",
    type: "all",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");

  function load() {
    if (!guild) return Promise.resolve();
    return Promise.all([
      getFivemFinance(guild.id, botId),
      getGuildLiveOptions(guild.id, botId),
    ])
      .then(([data, live]) => {
        setDashboard(data);
        setChannels(live.channels);
        setRoles(live.roles);
      })
      .catch(() => setError("Nao foi possivel carregar o financeiro da FAC."));
  }

  useEffect(() => {
    void load();
  }, [botId, guild?.id]);
  useEffect(() => {
    if (!guild) return;
    const socket = createDashboardSocket();
    const refresh = (payload: { botId?: string | null; guildId: string }) => {
      if (
        payload.guildId === guild.id &&
        (payload.botId ?? null) === (botId ?? null)
      )
        void load();
    };
    socket.on("fivem:finance:updated", refresh);
    return () => {
      socket.off("fivem:finance:updated", refresh);
      socket.disconnect();
    };
  }, [botId, guild?.id]);

  const filtered = useMemo(
    () =>
      (dashboard?.transactions ?? [])
        .filter((item) => filter.type === "all" || item.type === filter.type)
        .filter(
          (item) => filter.status === "all" || item.status === filter.status,
        )
        .filter(
          (item) =>
            filter.period === "all" ||
            Date.now() - new Date(item.createdAt).getTime() <=
              Number(filter.period) * 86_400_000,
        )
        .filter((item) =>
          `${item.transactionId} ${item.username} ${item.userId} ${item.managerName ?? ""} ${item.managerId ?? ""} ${item.reason ?? ""} ${item.amount}`
            .toLowerCase()
            .includes(filter.search.toLowerCase()),
        ),
    [dashboard?.transactions, filter],
  );

  if (!guild)
    return (
      <Card>
        <CardContent className="py-10 text-sm text-zinc-400">
          Selecione um servidor para configurar o financeiro.
        </CardContent>
      </Card>
    );
  if (!dashboard)
    return (
      <div className="h-64 animate-pulse border border-zinc-800 bg-zinc-950" />
    );
  const guildId = guild.id;

  const patch = (value: Partial<FivemFinanceSettings>) =>
    setDashboard((current) =>
      current
        ? { ...current, settings: { ...current.settings, ...value } }
        : current,
    );
  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const settings = await saveFivemFinanceSettings(
        guildId,
        dashboard!.settings,
        botId,
      );
      setDashboard((current) => (current ? { ...current, settings } : current));
      setMessage("Financeiro salvo.");
    } catch {
      setError("Nao foi possivel salvar as configuracoes.");
    } finally {
      setSaving(false);
    }
  }
  async function publish() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const settings = await publishFivemFinancePanel(guildId, botId);
      setDashboard((current) => (current ? { ...current, settings } : current));
      setMessage("Publicacao do painel financeiro enviada ao bot.");
    } catch {
      setError("Nao foi possivel publicar o painel.");
    } finally {
      setSaving(false);
    }
  }
  async function markReviewed(item: FivemFinanceTransaction) {
    const updated = await updateFivemFinanceTransaction(
      guildId,
      item.id,
      { status: "reviewed" },
      botId,
    );
    setDashboard((current) =>
      current
        ? {
            ...current,
            transactions: current.transactions.map((row) =>
              row.id === updated.id ? updated : row,
            ),
          }
        : current,
    );
  }
  async function cancel(item: FivemFinanceTransaction) {
    if (!window.confirm("Cancelar esta movimentacao?")) return;
    const updated = await updateFivemFinanceTransaction(
      guildId,
      item.id,
      { status: "cancelled" },
      botId,
    );
    setDashboard((current) =>
      current
        ? {
            ...current,
            transactions: current.transactions.map((row) =>
              row.id === updated.id ? updated : row,
            ),
          }
        : current,
    );
  }

  return (
    <Card className="border-emerald-500/10 bg-zinc-950/75">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-emerald-300" /> Sistema Financeiro
              da FAC
            </CardTitle>
            <CardDescription>
              Controle isolado de entradas, saidas, comprovantes, logs e saldo
              da FAC.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              disabled={
                !canManage ||
                saving ||
                !dashboard.settings.enabled ||
                !dashboard.settings.panelChannelId
              }
              onClick={() => void publish()}
              size="sm"
              variant="outline"
            >
              <Send className="mr-2 h-4 w-4" />
              Enviar painel
            </Button>
            <Button
              disabled={!canManage || saving}
              onClick={() => void save()}
              size="sm"
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Salvar
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {error ? (
          <div className="border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            {message}
          </div>
        ) : null}
        <div className="flex flex-wrap border-b border-zinc-800">
          {[
            { id: "overview", label: "Resumo" },
            { id: "settings", label: "Configuracoes" },
            { id: "history", label: "Historico" },
          ].map((item) => (
            <button
              className={`border-b-2 px-4 py-2 text-sm ${tab === item.id ? "border-emerald-400 text-white" : "border-transparent text-zinc-500 hover:text-zinc-300"}`}
              key={item.id}
              onClick={() => setTab(item.id as Tab)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
        {tab === "overview" ? <Overview dashboard={dashboard} /> : null}
        {tab === "settings" ? (
          <Settings
            botId={botId}
            canManage={canManage}
            channels={channels}
            guildId={guildId}
            patch={patch}
            roles={roles}
            settings={dashboard.settings}
          />
        ) : null}
        {tab === "history" ? (
          <History
            canManage={canManage}
            filter={filter}
            items={filtered}
            onCancel={cancel}
            onFilter={setFilter}
            onReview={markReviewed}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function Overview({ dashboard }: { dashboard: FivemFinanceDashboard }) {
  const cards = [
    ["Saldo atual", dashboard.report.balance, Wallet],
    ["Total de entradas", dashboard.report.totalIn, CircleDollarSign],
    ["Total de saidas", dashboard.report.totalOut, Download],
    ["Movimentacoes", dashboard.report.transactions, CheckCircle2],
  ] as const;
  const active = dashboard.transactions.filter((item) => item.status !== "cancelled");
  const last = active[0];
  const lastAdd = active.find((item) => item.type === "add");
  const lastRemove = active.find((item) => item.type === "remove");
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-4">
        {cards.map(([label, value, Icon]) => (
          <div className="border border-zinc-800 bg-black/30 p-3" key={label}>
            <Icon className="h-4 w-4 text-emerald-300" />
            <p className="mt-3 text-xs text-zinc-500">{label}</p>
            <p className="mt-1 text-lg font-semibold text-white">
              {typeof value === "number" && label !== "Movimentacoes"
                ? money(value)
                : value}
            </p>
          </div>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Info label="Última adição" value={lastAdd ? `${lastAdd.managerName ?? lastAdd.username} • ${money(lastAdd.amount)}` : "Nenhuma"} />
        <Info label="Última retirada" value={lastRemove ? `${lastRemove.managerName ?? lastRemove.username} • ${money(lastRemove.amount)}` : "Nenhuma"} />
        <Info label="Última atualização" value={last ? new Date(last.createdAt).toLocaleString("pt-BR") : "Nenhuma"} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <TopList
          title="Quem mais adicionou"
          users={dashboard.report.topAdders}
        />
        <TopList
          title="Quem mais retirou"
          users={dashboard.report.topRemovers}
        />
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="border-l-2 border-emerald-500/40 px-3 py-2"><p className="text-xs text-zinc-500">{label}</p><p className="text-sm font-semibold text-white">{value}</p></div>;
}

function TopList({
  title,
  users,
}: {
  title: string;
  users: Array<{ amount: number; count: number; username: string }>;
}) {
  return (
    <section className="border-y border-zinc-800 py-4">
      <p className="text-sm font-semibold text-white">{title}</p>
      <div className="mt-3 space-y-2">
        {users.length ? (
          users.map((user) => (
            <div
              className="flex justify-between text-sm"
              key={`${user.username}-${user.amount}`}
            >
              <span className="text-zinc-300">
                {user.username}{" "}
                <span className="text-zinc-600">({user.count})</span>
              </span>
              <span className="text-white">{money(user.amount)}</span>
            </div>
          ))
        ) : (
          <p className="text-sm text-zinc-500">Sem movimentacoes.</p>
        )}
      </div>
    </section>
  );
}

function Settings({
  botId,
  canManage,
  channels,
  guildId,
  patch,
  roles,
  settings,
}: {
  botId?: string | null;
  canManage: boolean;
  channels: GuildChannelOption[];
  guildId: string;
  patch: (value: Partial<FivemFinanceSettings>) => void;
  roles: GuildRoleOption[];
  settings: FivemFinanceSettings;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        <Select
          disabled={!canManage}
          label="Sistema"
          onChange={(enabled) => patch({ enabled: enabled === "true" })}
          options={[
            { id: "true", name: "Ativado" },
            { id: "false", name: "Desativado" },
          ]}
          value={String(settings.enabled)}
        />
        <FivemResourceSelect
          disabled={!canManage}
          label="Canal do painel financeiro"
          onChange={(panelChannelId) => patch({ panelChannelId })}
          options={channels.map((channel) => ({
            id: channel.id,
            name: channel.name,
          }))}
          prefix="#"
          value={settings.panelChannelId}
        />
        <FivemResourceSelect
          disabled={!canManage}
          label="Canal de logs financeiras"
          onChange={(logChannelId) => patch({ logChannelId })}
          options={channels.map((channel) => ({
            id: channel.id,
            name: channel.name,
          }))}
          prefix="#"
          value={settings.logChannelId}
        />
        <FivemResourceSelect
          disabled={!canManage}
          label="Categoria de canais temporarios"
          onChange={(tempCategoryId) => patch({ tempCategoryId })}
          options={channels.map((channel) => ({
            id: channel.id,
            name: channel.name,
          }))}
          prefix="#"
          value={settings.tempCategoryId}
        />
        <Field
          disabled={!canManage}
          label="Tempo para fechar canal (min)"
          onChange={(value) => patch({ autoCloseMinutes: Number(value) || 10 })}
          type="number"
          value={String(settings.autoCloseMinutes)}
        />
        <Field
          disabled={!canManage}
          label="Cor do painel"
          onChange={(color) => patch({ color })}
          type="color"
          value={settings.color}
        />
        <Field
          disabled={!canManage}
          label="Nome do painel"
          onChange={(panelTitle) => patch({ panelTitle })}
          value={settings.panelTitle}
        />
        <Select
          disabled={!canManage}
          label="Posicao do banner"
          onChange={(bannerMode) =>
            patch({
              bannerMode: bannerMode as FivemFinanceSettings["bannerMode"],
            })
          }
          options={[
            { id: "above", name: "Acima do painel" },
            { id: "inside", name: "Dentro do painel" },
            { id: "below", name: "Abaixo do painel" },
            { id: "none", name: "Sem banner" },
          ]}
          value={settings.bannerMode}
        />
        <Field
          disabled={!canManage}
          label="Imagem de rodape opcional"
          onChange={(footerImageUrl) => patch({ footerImageUrl })}
          value={settings.footerImageUrl ?? ""}
        />
      </div>
      <Area
        disabled={!canManage}
        label="Descricao explicativa do painel"
        onChange={(panelDescription) => patch({ panelDescription })}
        value={settings.panelDescription}
      />
      <div className="grid gap-3 md:grid-cols-2">
        <FivemResourceMultiSelect
          disabled={!canManage}
          label="Cargos que podem usar"
          onChange={(useRoleIds) => patch({ useRoleIds })}
          options={roles
            .filter((role) => !role.managed)
            .map((role) => ({
              color: role.color,
              id: role.id,
              name: role.name,
            }))}
          prefix="@"
          values={settings.useRoleIds}
        />
        <FivemResourceMultiSelect
          disabled={!canManage}
          label="Cargos que podem aprovar/revisar/corrigir"
          onChange={(adminRoleIds) => patch({ adminRoleIds })}
          options={roles
            .filter((role) => !role.managed)
            .map((role) => ({
              color: role.color,
              id: role.id,
              name: role.name,
            }))}
          prefix="@"
          values={settings.adminRoleIds}
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field disabled={!canManage} label="Limite máximo por operação" onChange={(value) => patch({ maxTransactionAmount: Number(value) || 1 })} type="number" value={String(settings.maxTransactionAmount)} />
        <Field disabled={!canManage} label="Registros por página" onChange={(value) => patch({ historyPageSize: Number(value) || 10 })} type="number" value={String(settings.historyPageSize)} />
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="flex items-center gap-2 border border-zinc-800 px-3 py-2 text-sm text-zinc-300">
          <input
            checked={settings.allowBalanceQuery}
            disabled={!canManage}
            onChange={(event) =>
              patch({ allowBalanceQuery: event.target.checked })
            }
            type="checkbox"
          />
          Liberar consulta de saldo
        </label>
        <label className="flex items-center gap-2 border border-zinc-800 px-3 py-2 text-sm text-zinc-300">
          <input
            checked={settings.allowNegativeBalance}
            disabled={!canManage}
            onChange={(event) =>
              patch({ allowNegativeBalance: event.target.checked })
            }
            type="checkbox"
          />
          Permitir saldo negativo
        </label>
        <CheckSetting checked={settings.requireReason} disabled={!canManage} label="Exigir motivo obrigatório" onChange={(requireReason) => patch({ requireReason })} />
        <CheckSetting checked={settings.confirmAdd} disabled={!canManage} label="Confirmar antes de adicionar" onChange={(confirmAdd) => patch({ confirmAdd })} />
        <CheckSetting checked={settings.confirmRemove} disabled={!canManage} label="Confirmar antes de remover" onChange={(confirmRemove) => patch({ confirmRemove })} />
        <CheckSetting checked={settings.historyEnabled} disabled={!canManage} label="Ativar histórico" onChange={(historyEnabled) => patch({ historyEnabled })} />
      </div>
      <Area
        disabled={!canManage}
        label="Texto de rodape opcional"
        onChange={(footerText) => patch({ footerText })}
        value={settings.footerText ?? ""}
      />
      <PanelImageSettings
        botId={botId}
        canManage={canManage}
        guildId={guildId}
        panelId="fivem-finance"
        panelLabel="Sistema Financeiro da FAC"
      />
    </div>
  );
}

function CheckSetting({ checked, disabled, label, onChange }: { checked: boolean; disabled: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <label className="flex items-center gap-2 border border-zinc-800 px-3 py-2 text-sm text-zinc-300"><input checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} type="checkbox" />{label}</label>;
}

function History({
  canManage,
  filter,
  items,
  onCancel,
  onFilter,
  onReview,
}: {
  canManage: boolean;
  filter: { period: string; search: string; status: string; type: string };
  items: FivemFinanceTransaction[];
  onCancel: (item: FivemFinanceTransaction) => void;
  onFilter: (filter: { period: string; search: string; status: string; type: string }) => void;
  onReview: (item: FivemFinanceTransaction) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-2 md:grid-cols-5">
        <Field
          label="Buscar usuario/ID"
          onChange={(search) => onFilter({ ...filter, search })}
          value={filter.search}
        />
        <Select
          label="Período"
          onChange={(period) => onFilter({ ...filter, period })}
          options={[{ id: "all", name: "Todo o período" }, { id: "1", name: "Últimas 24 horas" }, { id: "7", name: "Últimos 7 dias" }, { id: "30", name: "Últimos 30 dias" }]}
          value={filter.period}
        />
        <Select
          label="Tipo"
          onChange={(type) => onFilter({ ...filter, type })}
          options={[
            { id: "all", name: "Todos" },
            { id: "add", name: "Entradas" },
            { id: "remove", name: "Saidas" },
          ]}
          value={filter.type}
        />
        <Select
          label="Status"
          onChange={(status) => onFilter({ ...filter, status })}
          options={[
            { id: "all", name: "Todos" },
            { id: "completed", name: "Completo" },
            { id: "reviewed", name: "Revisado" },
            { id: "cancelled", name: "Cancelado" },
            { id: "corrected", name: "Corrigido" },
          ]}
          value={filter.status}
        />
        <Button onClick={() => exportCsv(items)} size="sm" variant="outline">
          <Download className="mr-2 h-4 w-4" />
          Exportar
        </Button>
      </div>
      <div className="overflow-x-auto border border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-800 text-sm">
          <thead className="bg-black/30 text-left text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Movimentacao</th>
              <th className="px-3 py-2">Usuario</th>
              <th className="px-3 py-2">Valor</th>
              <th className="px-3 py-2">Saldo</th>
              <th className="px-3 py-2">Comprovante</th>
              <th className="px-3 py-2">Acoes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {items.map((item) => (
              <tr key={item.id}>
                <td className="px-3 py-2">
                  <Badge variant={item.type === "add" ? "success" : "danger"}>
                    {item.type === "add" ? "Entrada" : "Saida"}
                  </Badge>
                  <p className="mt-1 text-xs text-zinc-500">
                    {item.transactionId}
                  </p>
                  <p className="text-xs text-zinc-600">
                    {new Date(item.createdAt).toLocaleString("pt-BR")}
                  </p>
                </td>
                <td className="px-3 py-2 text-zinc-300">
                  {item.managerName ?? item.username}
                  <p className="text-xs text-zinc-600">{item.managerId ?? item.userId}</p>
                  <p className="mt-1 text-xs text-zinc-500">{item.reason ?? item.notes ?? "Sem motivo"}</p>
                </td>
                <td className="px-3 py-2 text-white">
                  {money(item.amount)}
                  <p className="text-xs text-zinc-500">
                    {statusName(item.status)}
                  </p>
                </td>
                <td className="px-3 py-2 text-zinc-300">
                  {money(item.oldBalance)} {"->"} {money(item.newBalance)}
                </td>
                <td className="px-3 py-2">
                  {item.proofImageUrl ? <a
                    className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200"
                    href={item.proofImageUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Abrir
                  </a> : <span className="text-xs text-zinc-600">Não exigido</span>}
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-2">
                    {canManage ? (
                      <Button
                        disabled={item.status === "reviewed"}
                        onClick={() => void onReview(item)}
                        size="sm"
                        variant="outline"
                      >
                        Revisar
                      </Button>
                    ) : null}
                    {canManage ? (
                      <Button
                        disabled={item.status === "cancelled"}
                        onClick={() => void onCancel(item)}
                        size="sm"
                        variant="destructive"
                      >
                        Cancelar
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({
  disabled,
  label,
  onChange,
  type = "text",
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  type?: string;
  value: string;
}) {
  return (
    <label className="block text-xs text-zinc-500">
      {label}
      <input
        className="mt-1 h-10 w-full border border-zinc-800 bg-black px-3 text-sm text-white outline-none focus:border-emerald-500"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </label>
  );
}
function Area({
  disabled,
  label,
  onChange,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block text-xs text-zinc-500">
      {label}
      <textarea
        className="mt-1 min-h-24 w-full border border-zinc-800 bg-black px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}
function Select({
  disabled,
  label,
  onChange,
  options,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  options: Array<{ id: string; name: string }>;
  value: string;
}) {
  return (
    <label className="block text-xs text-zinc-500">
      {label}
      <select
        className="mt-1 h-10 w-full border border-zinc-800 bg-black px-3 text-sm text-white outline-none focus:border-emerald-500"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}
function money(value: number) {
  return value.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
}
function statusName(status: FivemFinanceTransaction["status"]) {
  return (
    {
      cancelled: "Cancelado",
      completed: "Completo",
      corrected: "Corrigido",
      reviewed: "Revisado",
    } as const
  )[status];
}
function exportCsv(items: FivemFinanceTransaction[]) {
  const rows = [
    [
      "id",
      "tipo",
      "usuario",
      "valor",
      "saldo_anterior",
      "saldo_novo",
      "status",
      "comprovante",
      "data",
    ],
    ...items.map((item) => [
      item.transactionId,
      item.type,
      item.username,
      String(item.amount),
      String(item.oldBalance),
      String(item.newBalance),
      item.status,
      item.proofImageUrl,
      item.createdAt,
    ]),
  ];
  const blob = new Blob(
    [
      rows
        .map((row) =>
          row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","),
        )
        .join("\n"),
    ],
    { type: "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "financeiro-fac.csv";
  link.click();
  URL.revokeObjectURL(url);
}

import { useEffect, useState, type ReactNode } from "react";
import {
  Bot,
  CheckSquare2,
  Gauge,
  Hash,
  LayoutDashboard,
  Loader2,
  MessageSquareText,
  Save,
  Shield,
  UserRound,
  UsersRound
} from "lucide-react";
import { getAutomatedLogSettings, getGuildLiveOptions, getGuildRoleOptions, patchGuildSettings, saveAutomatedLogSettings, syncAutomatedLogStructure } from "../lib/api";
import type {
  DashboardGuild,
  GuildChannelOption,
  GuildSettings,
  LogCategory,
  AutomatedLogSettings,
  GuildRoleOption
} from "../types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Switch } from "./ui/switch";

type LogsSettingsPanelProps = {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
  loading?: boolean;
  onSettingsChange: (settings: GuildSettings) => void;
  settings: GuildSettings | null;
};

type Draft = Pick<
  GuildSettings,
  | "discordLogsEnabled"
  | "siteLogsEnabled"
  | "logChannelId"
  | "discordLogCategories"
  | "siteLogCategories"
>;

const LOG_CATEGORIES: Array<{
  id: LogCategory;
  label: string;
  icon: typeof Bot;
}> = [
  { id: "members", label: "Entrada e saida de membros", icon: UsersRound },
  { id: "messages", label: "Mensagens editadas e apagadas", icon: MessageSquareText },
  { id: "roles", label: "Alterações de cargos", icon: UserRound },
  { id: "moderation", label: "Moderação e segurança", icon: Shield },
  { id: "dashboard", label: "Acoes feitas na dashboard", icon: LayoutDashboard },
  { id: "automation", label: "Automações e módulos", icon: Gauge }
];

const DEFAULT_DRAFT: Draft = {
  discordLogsEnabled: false,
  siteLogsEnabled: true,
  logChannelId: null,
  discordLogCategories: LOG_CATEGORIES.map((category) => category.id),
  siteLogCategories: LOG_CATEGORIES.map((category) => category.id)
};

export function LogsSettingsPanel({
  botId,
  canManage,
  guild,
  loading = false,
  onSettingsChange,
  settings
}: LogsSettingsPanelProps) {
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [automated, setAutomated] = useState<AutomatedLogSettings | null>(null);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(settings ? {
      discordLogsEnabled: settings.discordLogsEnabled,
      siteLogsEnabled: settings.siteLogsEnabled,
      logChannelId: settings.logChannelId,
      discordLogCategories: settings.discordLogCategories,
      siteLogCategories: settings.siteLogCategories
    } : DEFAULT_DRAFT);
  }, [settings]);

  useEffect(() => {
    if (!guild) {
      setChannels([]);
      return;
    }

    setLoadingChannels(true);
    setError(null);

    Promise.all([getGuildLiveOptions(guild.id, botId), getGuildRoleOptions(guild.id, botId), botId ? getAutomatedLogSettings(guild.id, botId) : Promise.resolve(null)])
      .then(([options, roleOptions, automatedSettings]) => { setChannels(options.channels); setRoles(roleOptions.filter((role) => role.id !== guild.id)); setAutomated(automatedSettings); })
      .catch((requestError) => {
        setChannels([]);
        setError(readErrorMessage(requestError, "Não foi possível carregar os canais deste servidor."));
      })
      .finally(() => setLoadingChannels(false));
  }, [botId, guild]);

  useEffect(() => {
    if (!guild || !botId || !automated?.enabled) return;
    const timer = window.setInterval(() => {
      void getAutomatedLogSettings(guild.id, botId).then((next) => setAutomated((current) => current ? {
        ...current,
        categoryId: next.categoryId,
        channels: next.channels,
        lastError: next.lastError,
        lastSyncedAt: next.lastSyncedAt,
        lastSyncRequestedAt: next.lastSyncRequestedAt
      } : next)).catch(() => undefined);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [automated?.enabled, botId, guild]);

  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({
      ...current,
      [key]: value
    }));
  }

  function toggleCategory(destination: "discord" | "site", category: LogCategory) {
    const key = destination === "discord" ? "discordLogCategories" : "siteLogCategories";
    const current = draft[key];
    const next = current.includes(category)
      ? current.filter((item) => item !== category)
      : [...current, category];

    updateDraft(key, next);
  }

  async function save() {
    if (!guild || !settings || !canManage) {
      return;
    }

    if (draft.discordLogsEnabled && !draft.logChannelId && !automated?.enabled) {
      setStatus(null);
      setError("Selecione o canal que recebera os logs do Discord.");
      return;
    }

    if (draft.discordLogsEnabled && !draft.discordLogCategories.length) {
      setStatus(null);
      setError("Selecione pelo menos uma categoria para os logs do Discord.");
      return;
    }

    if (draft.siteLogsEnabled && !draft.siteLogCategories.length) {
      setStatus(null);
      setError("Selecione pelo menos uma categoria para os logs do site.");
      return;
    }

    setSaving(true);
    setStatus(null);
    setError(null);

    try {
      const saved = await patchGuildSettings(guild.id, draft, botId);
      if (botId && automated) {
        const savedAutomated = await saveAutomatedLogSettings(guild.id, botId, { enabled: automated.enabled, allowedRoleIds: automated.allowedRoleIds });
        setAutomated(savedAutomated);
      }
      onSettingsChange(saved);
      setStatus("Configuração de logs salva.");
    } catch (requestError) {
      setError(readErrorMessage(requestError, "Não foi possível salvar a configuração de logs."));
    } finally {
      setSaving(false);
    }
  }

  async function requestAutomatedSync(label: string) {
    if (!guild || !botId || !automated || !canManage) return;
    setError(null);
    try {
      if (automated.enabled) {
        const savedGuild = await patchGuildSettings(guild.id, { discordLogsEnabled: true, discordLogCategories: draft.discordLogCategories }, botId);
        onSettingsChange(savedGuild);
      }
      await saveAutomatedLogSettings(guild.id, botId, { enabled: automated.enabled, allowedRoleIds: automated.allowedRoleIds });
      const next = await syncAutomatedLogStructure(guild.id, botId);
      setAutomated(next);
      setStatus(label);
    } catch (requestError) {
      setError(readErrorMessage(requestError, "The automatic log structure could not be synchronized."));
    }
  }

  if (!guild) {
    return (
      <Card>
        <CardContent className="flex min-h-40 items-center justify-center p-6 text-sm text-zinc-500">
          Escolha um servidor para configurar os logs.
        </CardContent>
      </Card>
    );
  }

  const disabled = !settings || !canManage || loading || loadingChannels || saving;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-2">
        <DestinationCard
          categories={draft.discordLogCategories}
          disabled={disabled}
          enabled={draft.discordLogsEnabled}
          icon={Bot}
          onCategoryToggle={(category) => toggleCategory("discord", category)}
          onEnabledChange={(checked) => { updateDraft("discordLogsEnabled", checked); setAutomated((current) => current ? { ...current, enabled: checked } : current); }}
          title="Logs no Discord"
        >
          <label className="grid gap-2 text-sm">
            <span className="flex items-center gap-2 font-medium text-zinc-200">
              <Hash className="h-4 w-4 text-zinc-400" />
              Canal de logs
            </span>
            <select
              className="h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-purple-500/60"
              disabled={disabled || !draft.discordLogsEnabled}
              onChange={(event) => updateDraft("logChannelId", event.target.value || null)}
              value={draft.logChannelId ?? ""}
            >
              <option value="">Selecione um canal</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>#{channel.name}</option>
              ))}
            </select>
          </label>
        </DestinationCard>

        <DestinationCard
          categories={draft.siteLogCategories}
          disabled={disabled}
          enabled={draft.siteLogsEnabled}
          icon={LayoutDashboard}
          onCategoryToggle={(category) => toggleCategory("site", category)}
          onEnabledChange={(checked) => updateDraft("siteLogsEnabled", checked)}
          title="Logs no site"
        />
      </div>

      {automated && botId ? (
        <Card>
          <CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>Estrutura automática de logs</CardTitle><CardDescription>Cria e mantém a categoria privada Logs Geral sem duplicar canais.</CardDescription></div><Switch checked={automated.enabled} disabled={disabled} onCheckedChange={(enabled) => { setAutomated((current) => current ? { ...current, enabled } : current); if (enabled) updateDraft("discordLogsEnabled", true); }} /></div></CardHeader>
          <CardContent className="space-y-4">
            <div><p className="mb-2 text-sm font-medium text-zinc-200">Cargos autorizados a ver logs</p><div className="grid max-h-44 gap-2 overflow-y-auto rounded-lg border border-zinc-800 p-3 sm:grid-cols-2">{roles.map((role) => <label className="flex items-center gap-2 text-sm text-zinc-300" key={role.id}><input type="checkbox" disabled={disabled} checked={automated.allowedRoleIds.includes(role.id)} onChange={() => setAutomated((current) => current ? { ...current, allowedRoleIds: current.allowedRoleIds.includes(role.id) ? current.allowedRoleIds.filter((id) => id !== role.id) : [...current.allowedRoleIds, role.id] } : current)} />@{role.name}</label>)}</div></div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{Object.entries(automated.channels).map(([key, value]) => <div className="rounded-lg border border-zinc-900 bg-zinc-950 p-3 text-sm" key={key}><span className="text-zinc-500">{key}</span><p className="mt-1 text-zinc-200">{value ? `Canal ${value}` : "Não criado"}</p></div>)}</div>
            {automated.lastError ? <p className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">{automated.lastError}</p> : null}
            <div className="flex flex-wrap gap-2"><Button disabled={disabled} variant="outline" onClick={() => void requestAutomatedSync("Sincronização da estrutura de logs solicitada.")}>Recriar estrutura</Button><Button disabled={disabled} variant="outline" onClick={() => void requestAutomatedSync("Atualização de permissões solicitada.")}>Atualizar permissões</Button>{automated.lastSyncedAt ? <Badge variant="success">Sincronizado em {new Date(automated.lastSyncedAt).toLocaleString("pt-BR")}</Badge> : <Badge variant="warning">Aguardando sincronização do bot</Badge>}</div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-h-5 text-sm">
          {error ? <p className="text-red-300">{error}</p> : null}
          {status ? <p className="text-emerald-300">{status}</p> : null}
        </div>
        <Button disabled={disabled} onClick={() => void save()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar logs
        </Button>
      </div>
    </div>
  );
}

function DestinationCard({
  categories,
  children,
  disabled,
  enabled,
  icon: Icon,
  onCategoryToggle,
  onEnabledChange,
  title
}: {
  categories: LogCategory[];
  children?: ReactNode;
  disabled: boolean;
  enabled: boolean;
  icon: typeof Bot;
  onCategoryToggle: (category: LogCategory) => void;
  onEnabledChange: (checked: boolean) => void;
  title: string;
}) {
  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-black">
              <Icon className="h-5 w-5 text-zinc-200" />
            </div>
            <div className="min-w-0">
              <CardTitle>{title}</CardTitle>
              <CardDescription>{categories.length} categoria(s) selecionada(s)</CardDescription>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Badge variant={enabled ? "success" : "muted"}>{enabled ? "Ativo" : "Inativo"}</Badge>
            <Switch checked={enabled} disabled={disabled} onCheckedChange={onEnabledChange} />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {children}

        <div className="grid gap-2">
          {LOG_CATEGORIES.map((category) => {
            const selected = categories.includes(category.id);
            const CategoryIcon = category.icon;

            return (
              <label
                className={[
                  "flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 text-sm transition",
                  selected
                    ? "border-zinc-700 bg-zinc-900 text-white"
                    : "border-zinc-900 bg-zinc-950/70 text-zinc-500",
                  disabled || !enabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-zinc-700"
                ].join(" ")}
                key={category.id}
              >
                <input
                  checked={selected}
                  className="h-4 w-4 accent-white"
                  disabled={disabled || !enabled}
                  onChange={() => onCategoryToggle(category.id)}
                  type="checkbox"
                />
                <CategoryIcon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">{category.label}</span>
                {selected ? <CheckSquare2 className="h-4 w-4 shrink-0 text-emerald-300" /> : null}
              </label>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function readErrorMessage(error: unknown, fallback: string) {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return fallback;
  }

  const response = (error as { response?: { data?: { message?: unknown } } }).response;
  return typeof response?.data?.message === "string" ? response.data.message : fallback;
}

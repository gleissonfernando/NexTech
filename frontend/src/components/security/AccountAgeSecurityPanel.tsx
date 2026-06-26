import { useEffect, useState } from "react";
import { CalendarDays, Hash, Loader2, Plus, Save, ShieldAlert, Trash2, UserCheck } from "lucide-react";
import { getGuildLiveOptions, patchGuildSettings } from "../../lib/api";
import type { DashboardGuild, GuildChannelOption, GuildSettings } from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

type AccountAgeSecurityPanelProps = {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
  loading?: boolean;
  onSettingsChange: (settings: GuildSettings) => void;
  settings: GuildSettings | null;
};

type Draft = {
  accountAgeAllowedUserIds: string[];
  accountAgeLogChannelId: string | null;
  accountAgeMinDays: number;
  accountAgeSecurityEnabled: boolean;
};

const DEFAULT_DRAFT: Draft = {
  accountAgeAllowedUserIds: [],
  accountAgeLogChannelId: null,
  accountAgeMinDays: 10,
  accountAgeSecurityEnabled: false
};

export function AccountAgeSecurityPanel({
  botId,
  canManage,
  guild,
  loading = false,
  onSettingsChange,
  settings
}: AccountAgeSecurityPanelProps) {
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [exceptionInput, setExceptionInput] = useState("");
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(settings ? {
      accountAgeAllowedUserIds: settings.accountAgeAllowedUserIds,
      accountAgeLogChannelId: settings.accountAgeLogChannelId,
      accountAgeMinDays: settings.accountAgeMinDays,
      accountAgeSecurityEnabled: settings.accountAgeSecurityEnabled
    } : DEFAULT_DRAFT);
  }, [settings]);

  useEffect(() => {
    if (!guild) {
      setChannels([]);
      return;
    }

    setLoadingChannels(true);
    setError(null);

    getGuildLiveOptions(guild.id, botId)
      .then((options) => setChannels(options.channels))
      .catch((requestError) => {
        setChannels([]);
        setError(readErrorMessage(requestError, "Não foi possível carregar os canais deste servidor."));
      })
      .finally(() => setLoadingChannels(false));
  }, [botId, guild]);

  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({
      ...current,
      [key]: value
    }));
  }

  function addException() {
    const userId = exceptionInput.trim();

    if (!isDiscordId(userId)) {
      setStatus(null);
      setError("Informe um ID Discord valido para adicionar a excecao.");
      return;
    }

    updateDraft("accountAgeAllowedUserIds", [...new Set([...draft.accountAgeAllowedUserIds, userId])]);
    setExceptionInput("");
    setError(null);
  }

  function removeException(userId: string) {
    updateDraft("accountAgeAllowedUserIds", draft.accountAgeAllowedUserIds.filter((id) => id !== userId));
  }

  async function save() {
    if (!guild || !settings || !canManage) {
      return;
    }

    if (draft.accountAgeSecurityEnabled && !draft.accountAgeLogChannelId && !settings.logChannelId) {
      setStatus(null);
      setError("Selecione um canal de logs antes de ativar a segurança.");
      return;
    }

    setSaving(true);
    setStatus(null);
    setError(null);

    try {
      const saved = await patchGuildSettings(guild.id, {
        accountAgeAllowedUserIds: draft.accountAgeAllowedUserIds,
        accountAgeLogChannelId: draft.accountAgeLogChannelId,
        accountAgeMinDays: draft.accountAgeMinDays,
        accountAgeSecurityEnabled: draft.accountAgeSecurityEnabled
      }, botId);

      onSettingsChange(saved);
      setStatus("Seguranca por idade da conta salva.");
    } catch (requestError) {
      setError(readErrorMessage(requestError, "Não foi possível salvar a segurança por idade da conta."));
    } finally {
      setSaving(false);
    }
  }

  if (!guild) {
    return (
      <Card>
        <CardContent className="flex min-h-40 items-center justify-center p-6 text-sm text-zinc-500">
          Escolha um servidor para configurar a segurança por idade da conta.
        </CardContent>
      </Card>
    );
  }

  const disabled = !settings || !canManage || loading || loadingChannels || saving;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-black">
                <ShieldAlert className="h-5 w-5 text-zinc-200" />
              </div>
              <div>
                <CardTitle>Seguranca por idade da conta</CardTitle>
                <CardDescription>Remove automaticamente contas Discord mais novas que o minimo configurado.</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={draft.accountAgeSecurityEnabled ? "success" : "muted"}>
                {draft.accountAgeSecurityEnabled ? "Ativo" : "Inativo"}
              </Badge>
              <Switch
                checked={draft.accountAgeSecurityEnabled}
                disabled={disabled}
                onCheckedChange={(checked) => updateDraft("accountAgeSecurityEnabled", checked)}
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="flex items-center gap-2 font-medium text-zinc-200">
                <CalendarDays className="h-4 w-4 text-zinc-400" />
                Minimo de dias da conta
              </span>
              <input
                className="h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-purple-500/60"
                disabled={disabled}
                max={3650}
                min={0}
                onChange={(event) => updateDraft("accountAgeMinDays", clampNumber(event.target.value, 0, 3650, 10))}
                type="number"
                value={draft.accountAgeMinDays}
              />
            </label>

            <label className="grid gap-2 text-sm">
              <span className="flex items-center gap-2 font-medium text-zinc-200">
                <Hash className="h-4 w-4 text-zinc-400" />
                Canal de logs
              </span>
              <select
                className="h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-purple-500/60"
                disabled={disabled}
                onChange={(event) => updateDraft("accountAgeLogChannelId", event.target.value || null)}
                value={draft.accountAgeLogChannelId ?? ""}
              >
                <option value="">Usar canal geral de logs</option>
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>#{channel.name}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="space-y-3 rounded-lg border border-zinc-900 bg-zinc-950/75 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                <UserCheck className="h-4 w-4 text-zinc-400" />
                Usuarios em excecao
              </span>
              <span className="text-xs text-zinc-500">{draft.accountAgeAllowedUserIds.length} usuário(s)</span>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                className="min-h-10 flex-1 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600"
                disabled={disabled}
                inputMode="numeric"
                onChange={(event) => setExceptionInput(event.target.value.replace(/\D/g, ""))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addException();
                  }
                }}
                placeholder="ID Discord do usuário"
                value={exceptionInput}
              />
              <Button disabled={disabled || !exceptionInput.trim()} onClick={addException} type="button" variant="outline">
                <Plus className="h-4 w-4" />
                Adicionar
              </Button>
            </div>

            <div className="space-y-2">
              {draft.accountAgeAllowedUserIds.length ? draft.accountAgeAllowedUserIds.map((userId) => (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-900 bg-black px-3 py-2" key={userId}>
                  <span className="truncate font-mono text-sm text-zinc-200">{userId}</span>
                  <button
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-400 transition hover:border-red-500/50 hover:text-red-300"
                    disabled={disabled}
                    onClick={() => removeException(userId)}
                    type="button"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )) : (
                <p className="rounded-lg border border-zinc-900 bg-black px-3 py-2 text-sm text-zinc-500">
                  Nenhuma excecao cadastrada.
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-zinc-900 pt-4">
            <Button disabled={disabled} onClick={() => void save()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar segurança
            </Button>
            {loadingChannels ? (
              <span className="flex items-center gap-2 text-xs text-zinc-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Carregando canais...
              </span>
            ) : null}
          </div>

          {status ? <p className="text-xs text-emerald-400">{status}</p> : null}
          {error ? <p className="text-xs text-red-400">{error}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function clampNumber(value: string, min: number, max: number, fallback: number) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(numberValue)));
}

function isDiscordId(value: string) {
  return /^\d{5,32}$/.test(value.trim());
}

function readErrorMessage(error: unknown, fallback: string) {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return fallback;
  }

  const response = (error as { response?: { data?: { message?: unknown } } }).response;
  return typeof response?.data?.message === "string"
    ? response.data.message
    : fallback;
}

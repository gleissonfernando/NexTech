import { useEffect, useState } from "react";
import { Hash, Loader2, MessageSquareText, Save, ScrollText, ShieldCheck } from "lucide-react";
import { getGuildLiveOptions, getGuildRoleOptions, patchGuildSettings } from "../../lib/api";
import type { DashboardGuild, GuildChannelOption, GuildRoleOption, GuildSettings } from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

type SafeBotPanelProps = {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
  loading?: boolean;
  onSettingsChange: (settings: GuildSettings) => void;
  settings: GuildSettings | null;
};

type Draft = {
  safeBotChannelId: string | null;
  safeBotEnabled: boolean;
  safeBotLogChannelId: string | null;
  safeBotRoleId: string | null;
};

const DEFAULT_DRAFT: Draft = {
  safeBotChannelId: null,
  safeBotEnabled: false,
  safeBotLogChannelId: null,
  safeBotRoleId: null
};

export function SafeBotPanel({
  botId,
  canManage,
  guild,
  loading = false,
  onSettingsChange,
  settings
}: SafeBotPanelProps) {
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(settings ? {
      safeBotChannelId: settings.safeBotChannelId,
      safeBotEnabled: settings.safeBotEnabled,
      safeBotLogChannelId: settings.safeBotLogChannelId,
      safeBotRoleId: settings.safeBotRoleId
    } : DEFAULT_DRAFT);
  }, [settings]);

  useEffect(() => {
    if (!guild) {
      setChannels([]);
      setRoles([]);
      return;
    }

    setLoadingOptions(true);
    setError(null);

    Promise.all([
      getGuildLiveOptions(guild.id, botId),
      getGuildRoleOptions(guild.id, botId)
    ])
      .then(([options, nextRoles]) => {
        setChannels(options.channels);
        setRoles(nextRoles.filter((role) => role.id !== guild.id && !role.managed));
      })
      .catch((requestError) => {
        setChannels([]);
        setRoles([]);
        setError(readErrorMessage(requestError, "Não foi possível carregar canais e cargos deste servidor."));
      })
      .finally(() => setLoadingOptions(false));
  }, [botId, guild]);

  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({
      ...current,
      [key]: value
    }));
  }

  async function save() {
    if (!guild || !settings || !canManage) {
      return;
    }

    if (draft.safeBotEnabled && !draft.safeBotChannelId) {
      setStatus(null);
      setError("Selecione o canal Self Bot antes de ativar.");
      return;
    }

    if (draft.safeBotEnabled && !settings.safeBotRoleId) {
      setStatus(null);
      setError("O cargo Self Bot ainda não foi criado automaticamente pelo bot.");
      return;
    }

    if (draft.safeBotEnabled && !draft.safeBotLogChannelId && !settings.logChannelId) {
      setStatus(null);
      setError("Selecione um canal de logs antes de ativar o Self Bot.");
      return;
    }

    setSaving(true);
    setStatus(null);
    setError(null);

    try {
      const saved = await patchGuildSettings(guild.id, {
        safeBotChannelId: draft.safeBotChannelId,
        safeBotEnabled: draft.safeBotEnabled,
        safeBotLogChannelId: draft.safeBotLogChannelId
      }, botId);

      onSettingsChange(saved);
      setStatus("Self Bot salvo.");
    } catch (requestError) {
      setError(readErrorMessage(requestError, "Não foi possível salvar o Self Bot."));
    } finally {
      setSaving(false);
    }
  }

  if (!guild) {
    return (
      <Card>
        <CardContent className="flex min-h-40 items-center justify-center p-6 text-sm text-zinc-500">
          Escolha um servidor para configurar o Self Bot.
        </CardContent>
      </Card>
    );
  }

  const disabled = !settings || !canManage || loading || loadingOptions || saving;
  const syncedRole = roles.find((role) => role.id === settings?.safeBotRoleId) ?? null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-black">
              <ShieldCheck className="h-5 w-5 text-zinc-200" />
            </div>
            <div>
              <CardTitle>Self Bot</CardTitle>
              <CardDescription>Aplica um cargo quando a primeira mensagem for enviada no canal configurado.</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={draft.safeBotEnabled ? "success" : "muted"}>
              {draft.safeBotEnabled ? "Ativo" : "Inativo"}
            </Badge>
            <Switch
              checked={draft.safeBotEnabled}
              disabled={disabled}
              onCheckedChange={(checked) => updateDraft("safeBotEnabled", checked)}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="grid gap-2 text-sm">
            <span className="flex items-center gap-2 font-medium text-zinc-200">
              <MessageSquareText className="h-4 w-4 text-zinc-400" />
              Canal Self Bot
            </span>
            <select
              className="h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-purple-500/60"
              disabled={disabled}
              onChange={(event) => updateDraft("safeBotChannelId", event.target.value || null)}
              value={draft.safeBotChannelId ?? ""}
            >
              <option value="">Selecione um canal</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>#{channel.name}</option>
              ))}
            </select>
          </label>

          <div className="grid gap-2 text-sm">
            <span className="flex items-center gap-2 font-medium text-zinc-200">
              <ShieldCheck className="h-4 w-4 text-zinc-400" />
              Cargo Self Bot
            </span>
            <div className="flex h-11 items-center rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100">
              {settings?.safeBotRoleId ? `@${syncedRole?.name ?? "Self Bot"} (${settings.safeBotRoleId})` : "Aguardando criação automática"}
            </div>
          </div>

          <label className="grid gap-2 text-sm">
            <span className="flex items-center gap-2 font-medium text-zinc-200">
              <ScrollText className="h-4 w-4 text-zinc-400" />
              Canal de logs
            </span>
            <select
              className="h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-purple-500/60"
              disabled={disabled}
              onChange={(event) => updateDraft("safeBotLogChannelId", event.target.value || null)}
              value={draft.safeBotLogChannelId ?? ""}
            >
              <option value="">Usar canal geral de logs</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>#{channel.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="rounded-lg border border-zinc-900 bg-zinc-950/75 p-4">
          <div className="flex items-start gap-3">
            <Hash className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
            <p className="text-sm leading-6 text-zinc-500">
              O log salva o usuário, ID, canal, cargo, link da mensagem e o conteúdo enviado.
              O cargo só é aplicado se a pessoa ainda não tiver o cargo Self Bot.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-zinc-900 pt-4">
          <Button disabled={disabled} onClick={() => void save()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar Self Bot
          </Button>
          {loadingOptions ? (
            <span className="flex items-center gap-2 text-xs text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Carregando canais e cargos...
            </span>
          ) : null}
        </div>

        {status ? <p className="text-xs text-emerald-400">{status}</p> : null}
        {error ? <p className="text-xs text-red-400">{error}</p> : null}
      </CardContent>
    </Card>
  );
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

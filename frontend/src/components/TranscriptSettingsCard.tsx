import { useEffect, useState } from "react";
import { FileText, Loader2, Save } from "lucide-react";
import { getGuildLiveOptions, getGuildRoleOptions, patchGuildSettings } from "../lib/api";
import type { DashboardGuild, GlobalLogConfig, GuildChannelOption, GuildRoleOption, GuildSettings } from "../types";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Switch } from "./ui/switch";

type TranscriptSettingsCardProps = {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
  loading?: boolean;
  onSettingsChange: (settings: GuildSettings) => void;
  settings: GuildSettings | null;
};

export function TranscriptSettingsCard({
  botId,
  canManage,
  guild,
  loading = false,
  onSettingsChange,
  settings
}: TranscriptSettingsCardProps) {
  const [draft, setDraft] = useState<GlobalLogConfig | null>(settings?.globalLogConfig ?? null);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(settings?.globalLogConfig ?? null);
  }, [settings?.globalLogConfig]);

  useEffect(() => {
    if (!guild) {
      setChannels([]);
      setRoles([]);
      return;
    }

    setLoadingOptions(true);
    setError(null);

    Promise.all([getGuildLiveOptions(guild.id, botId), getGuildRoleOptions(guild.id, botId)])
      .then(([channelOptions, roleOptions]) => {
        setChannels(channelOptions.channels);
        setRoles(roleOptions.filter((role) => role.id !== guild.id));
      })
      .catch((requestError) => {
        setChannels([]);
        setRoles([]);
        setError(readErrorMessage(requestError, "Nao foi possivel carregar canais e cargos."));
      })
      .finally(() => setLoadingOptions(false));
  }, [botId, guild]);

  function update<K extends keyof GlobalLogConfig>(key: K, value: GlobalLogConfig[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  }

  async function save() {
    if (!guild || !settings || !draft || !canManage) return;

    setSaving(true);
    setStatus(null);
    setError(null);

    try {
      const saved = await patchGuildSettings(guild.id, { globalLogConfig: draft }, botId);
      onSettingsChange(saved);
      setStatus("Configuracao de transcript salva.");
    } catch (requestError) {
      setError(readErrorMessage(requestError, "Nao foi possivel salvar a configuracao de transcript."));
    } finally {
      setSaving(false);
    }
  }

  if (!guild || !settings || !draft) return null;

  const disabled = !canManage || loading || loadingOptions || saving;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-blue-300" />
            Transcript policial
          </CardTitle>
          <CardDescription>
            Ative e direcione os transcripts usados pelos sistemas da policia.
          </CardDescription>
        </div>
        <Button disabled={disabled} onClick={() => void save()} size="sm" type="button">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Salvar
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
        {status ? <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{status}</p> : null}

        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium text-zinc-200">
            Canal de transcripts
            <select
              className="mt-2 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100"
              disabled={disabled}
              onChange={(event) => update("transcriptChannelId", event.target.value || null)}
              value={draft.transcriptChannelId ?? ""}
            >
              <option value="">Nao definido</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>#{channel.name}</option>
              ))}
            </select>
          </label>

          <label className="text-sm font-medium text-zinc-200">
            Cargo que pode abrir transcripts
            <select
              className="mt-2 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100"
              disabled={disabled}
              onChange={(event) => update("transcriptViewRoleId", event.target.value || null)}
              value={draft.transcriptViewRoleId ?? ""}
            >
              <option value="">Mesmo acesso dos logs</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>@{role.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <ToggleRow
            checked={draft.transcriptRequired}
            disabled={disabled}
            label="Transcript obrigatorio"
            onChange={(checked) => update("transcriptRequired", checked)}
          />
          <ToggleRow
            checked={draft.transcriptWebsiteEnabled}
            disabled={disabled}
            label="Salvar no site"
            onChange={(checked) => update("transcriptWebsiteEnabled", checked)}
          />
          <ToggleRow
            checked={draft.transcriptTextEnabled}
            disabled={disabled}
            label="Gerar arquivo texto"
            onChange={(checked) => update("transcriptTextEnabled", checked)}
          />
        </div>

        <label className="block text-sm font-medium text-zinc-200 md:max-w-xs">
          Expiracao em dias
          <input
            className="mt-2 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100"
            disabled={disabled}
            min={1}
            onChange={(event) => update("transcriptExpirationDays", event.target.value ? Math.max(1, Number(event.target.value) || 1) : null)}
            placeholder="Sem expiracao"
            type="number"
            value={draft.transcriptExpirationDays ?? ""}
          />
        </label>
      </CardContent>
    </Card>
  );
}

function ToggleRow({ checked, disabled, label, onChange }: { checked: boolean; disabled: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm text-zinc-200">
      <span>{label}</span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  );
}

function readErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

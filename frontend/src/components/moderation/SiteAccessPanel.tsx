import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { getGuildLiveOptions, patchGuildSettings } from "../../lib/api";
import type { DashboardGuild, GuildRoleOption, GuildSettings } from "../../types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

type SiteAccessPanelProps = {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
  loading?: boolean;
  onSettingsChange: (settings: GuildSettings) => void;
  settings: GuildSettings | null;
};

export function SiteAccessPanel({
  botId,
  canManage,
  guild,
  loading = false,
  onSettingsChange,
  settings
}: SiteAccessPanelProps) {
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!guild || !canManage) {
      setRoles([]);
      return;
    }

    setLoadingRoles(true);
    getGuildLiveOptions(guild.id, botId)
      .then((options) => setRoles(options.roles.filter((role) => role.id !== guild.id && !role.managed)))
      .catch(() => setRoles([]))
      .finally(() => setLoadingRoles(false));
  }, [botId, canManage, guild]);

  async function saveAccess(payload: Partial<GuildSettings>, successText: string) {
    if (!guild || !settings || !canManage) {
      return;
    }

    setSaving(true);
    setStatus(null);
    setError(null);

    try {
      const nextSettings = await patchGuildSettings(guild.id, payload, botId);
      onSettingsChange(nextSettings);
      setStatus(successText);
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  function handleEnabledChange(checked: boolean) {
    if (checked && !settings?.verificationRoleId) {
      setError("Selecione primeiro o cargo que tera acesso ao site.");
      return;
    }

    void saveAccess(
      {
        verificationEnabled: checked
      },
      checked ? "Acesso por cargo ativado." : "Acesso por cargo desativado."
    );
  }

  function handleRoleChange(roleId: string) {
    void saveAccess(
      {
        verificationRoleId: roleId || null,
        verificationEnabled: Boolean(roleId)
      },
      roleId ? "Cargo de acesso salvo e ativado." : "Cargo de acesso removido."
    );
  }

  const disabled = !canManage || !settings || loading || loadingRoles || saving;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-black">
              <ShieldCheck className="h-5 w-5 text-zinc-300" />
            </div>
            <div>
              <CardTitle>Acesso ao site por cargo</CardTitle>
              <CardDescription>
                Somente membros com o cargo selecionado podem verificar e abrir este painel.
              </CardDescription>
            </div>
          </div>
          <Switch
            checked={Boolean(settings?.verificationEnabled)}
            disabled={disabled}
            onCheckedChange={handleEnabledChange}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="block space-y-2 rounded-lg border border-zinc-900 bg-zinc-950/75 p-4">
          <span className="text-sm font-medium text-zinc-100">Cargo liberado</span>
          <select
            className="h-11 w-full rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none transition focus:border-zinc-600 disabled:opacity-50"
            disabled={disabled}
            onChange={(event) => handleRoleChange(event.target.value)}
            value={settings?.verificationRoleId ?? ""}
          >
            <option value="">{loadingRoles ? "Carregando cargos..." : "Selecione um cargo"}</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                @{role.name}
              </option>
            ))}
          </select>
        </label>

        <p className="text-xs leading-5 text-zinc-500">
          Todos os usuarios, incluindo dono e administradores do servidor, precisam possuir o cargo escolhido.
          Somente o Dev entra sem cargo. A configuracao vale apenas para este bot e este servidor.
        </p>

        {saving ? (
          <p className="flex items-center gap-2 text-xs text-zinc-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Salvando configuracao...
          </p>
        ) : null}
        {status ? <p className="text-xs text-emerald-400">{status}</p> : null}
        {error ? <p className="text-xs text-red-400">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function readErrorMessage(error: unknown) {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return "Nao foi possivel salvar o cargo de acesso.";
  }

  const response = (error as { response?: { data?: { message?: unknown } } }).response;
  return typeof response?.data?.message === "string"
    ? response.data.message
    : "Nao foi possivel salvar o cargo de acesso.";
}

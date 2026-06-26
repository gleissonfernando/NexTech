import { useEffect, useState } from "react";
import { Check, Loader2, Users } from "lucide-react";
import { getGuildRoleOptions, patchGuildSettings } from "../../lib/api";
import type { DashboardGuild, GuildRoleOption, GuildSettings } from "../../types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

const MAX_AUTOMATIC_ROLES = 2;

type AutoRolesPanelProps = {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
  loading?: boolean;
  onSettingsChange: (settings: GuildSettings) => void;
  settings: GuildSettings | null;
};

export function AutoRolesPanel({
  botId,
  canManage,
  guild,
  loading = false,
  onSettingsChange,
  settings
}: AutoRolesPanelProps) {
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedRoleIds = settings?.autoRoleIds.slice(0, MAX_AUTOMATIC_ROLES) ?? [];

  useEffect(() => {
    if (!guild || !canManage) {
      setRoles([]);
      setError(null);
      return;
    }

    setLoadingRoles(true);
    setError(null);
    getGuildRoleOptions(guild.id, botId)
      .then((nextRoles) => {
        setRoles(nextRoles.filter((role) => role.id !== guild.id && !role.managed));
        setError(null);
      })
      .catch((requestError) => {
        setRoles([]);
        setError(readErrorMessage(requestError, "Não foi possível carregar os cargos deste servidor."));
      })
      .finally(() => setLoadingRoles(false));
  }, [botId, canManage, guild]);

  async function saveRoles(payload: Partial<GuildSettings>, successText: string) {
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
      setError(readErrorMessage(requestError, "Não foi possível salvar os cargos automáticos."));
    } finally {
      setSaving(false);
    }
  }

  function handleEnabledChange(checked: boolean) {
    if (checked && !selectedRoleIds.length) {
      setStatus(null);
      setError("Selecione primeiro pelo menos um cargo para os novos membros.");
      return;
    }

    void saveRoles(
      {
        autoRoleEnabled: checked
      },
      checked ? "Entrega automática de cargos ativada." : "Entrega automática de cargos desativada."
    );
  }

  function handleRoleToggle(roleId: string, checked: boolean) {
    const nextRoleIds = checked
      ? [...new Set([...selectedRoleIds, roleId])].slice(0, MAX_AUTOMATIC_ROLES)
      : selectedRoleIds.filter((selectedRoleId) => selectedRoleId !== roleId);

    if (settings?.autoRoleEnabled && !nextRoleIds.length) {
      setStatus(null);
      setError("Desative a entrega automática antes de remover o último cargo.");
      return;
    }

    void saveRoles(
      {
        autoRoleIds: nextRoleIds
      },
      nextRoleIds.length ? "Cargos automáticos salvos para esta dashboard." : "Cargos automáticos removidos. Ative quando desejar."
    );
  }

  const disabled = !canManage || !settings || loading || loadingRoles || saving;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-black">
              <Users className="h-5 w-5 text-zinc-300" />
            </div>
            <div>
              <CardTitle>Cargos automaticos</CardTitle>
              <CardDescription>
                Escolha até 2 cargos que cada novo membro receberá ao entrar neste servidor.
              </CardDescription>
            </div>
          </div>
          <Switch
            checked={Boolean(settings?.autoRoleEnabled)}
            disabled={disabled}
            onCheckedChange={handleEnabledChange}
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-3 rounded-lg border border-zinc-900 bg-zinc-950/75 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-zinc-100">Cargos entregues na entrada</span>
            <span className="text-xs text-zinc-500">{selectedRoleIds.length}/{MAX_AUTOMATIC_ROLES}</span>
          </div>

          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {loadingRoles ? (
              <p className="flex min-h-11 items-center gap-2 rounded-lg border border-zinc-900 bg-black px-3 py-2 text-sm text-zinc-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Carregando cargos...
              </p>
            ) : roles.length ? (
              roles.map((role) => {
                const checked = selectedRoleIds.includes(role.id);
                const roleDisabled = disabled
                  || !role.assignable
                  || (!checked && selectedRoleIds.length >= MAX_AUTOMATIC_ROLES);

                return (
                  <label
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-zinc-900 bg-black px-3 py-2 text-sm text-zinc-100 transition hover:border-zinc-700 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
                    key={role.id}
                  >
                    <input
                      checked={checked}
                      className="peer sr-only"
                      disabled={roleDisabled}
                      onChange={(event) => handleRoleToggle(role.id, event.target.checked)}
                      type="checkbox"
                    />
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-zinc-700 bg-zinc-950 text-black transition peer-checked:border-emerald-400 peer-checked:bg-emerald-400">
                      {checked ? <Check className="h-3.5 w-3.5" /> : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate">@{role.name}</span>
                    {!role.assignable ? <span className="text-xs text-zinc-600">cargo acima do bot</span> : null}
                  </label>
                );
              })
            ) : (
              <p className="rounded-lg border border-zinc-900 bg-black px-3 py-2 text-sm text-zinc-500">
                Nenhum cargo disponivel.
              </p>
            )}
          </div>
        </div>

        <p className="text-xs leading-5 text-zinc-500">
          Esta configuração pertence somente ao bot e ao servidor selecionados nesta dashboard.
          O bot precisa da permissão Gerenciar Cargos e deve ficar acima dos cargos escolhidos.
        </p>

        {saving ? (
          <p className="flex items-center gap-2 text-xs text-zinc-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Salvando configuração...
          </p>
        ) : null}
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

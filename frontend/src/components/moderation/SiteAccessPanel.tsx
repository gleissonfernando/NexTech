import { useEffect, useState } from "react";
import { Check, Crown, Loader2, Plus, Search, ShieldCheck, Sparkles, Trash2, UserCheck, UserCog } from "lucide-react";
import { checkSiteAccess, getGuildMemberOptions, getGuildRoleOptions, patchGuildSettings } from "../../lib/api";
import type { AccessValidationResult, DashboardAccessLevel, DashboardGuild, GuildMemberOption, GuildRoleOption, GuildSettings } from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

type SiteAccessPanelProps = {
  botId?: string | null;
  botSlug?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
  loading?: boolean;
  onSettingsChange: (settings: GuildSettings) => void;
  settings: GuildSettings | null;
};

export function SiteAccessPanel({
  botId,
  botSlug,
  canManage,
  guild,
  loading = false,
  onSettingsChange,
  settings
}: SiteAccessPanelProps) {
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [validation, setValidation] = useState<AccessValidationResult | null>(null);
  const [directUserId, setDirectUserId] = useState("");
  const [memberOptions, setMemberOptions] = useState<GuildMemberOption[]>([]);
  const [selectedMemberProfiles, setSelectedMemberProfiles] = useState<Record<string, GuildMemberOption>>({});
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedRoleIds = settings ? selectedVerificationRoleIds(settings) : [];
  const rolePermissions = settings?.dashboardRolePermissions ?? {};
  const userPermissions = settings?.dashboardUserPermissions ?? {};
  const selectedUserIds = Object.keys(userPermissions);
  const selectedUserKey = selectedUserIds.join(",");

  useEffect(() => {
    if (!guild || !canManage) {
      setRoles([]);
      setMemberOptions([]);
      setDirectUserId("");
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
        setError(readErrorMessage(requestError, "Nao foi possivel carregar os cargos deste servidor."));
      })
      .finally(() => setLoadingRoles(false));
  }, [botId, canManage, guild]);

  useEffect(() => {
    if (!guild || !canManage || !selectedUserIds.length) {
      setSelectedMemberProfiles({});
      return;
    }

    let active = true;

    Promise.all(
      selectedUserIds.map(async (userId) => {
        const members = await getGuildMemberOptions(guild.id, userId, botId).catch(() => []);
        return members.find((member) => member.id === userId) ?? null;
      })
    ).then((members) => {
      if (!active) {
        return;
      }

      setSelectedMemberProfiles(
        Object.fromEntries(
          members
            .filter((member): member is GuildMemberOption => Boolean(member))
            .map((member) => [member.id, member])
        )
      );
    });

    return () => {
      active = false;
    };
  }, [botId, canManage, guild, selectedUserKey]);

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
      setError(readErrorMessage(requestError, "Nao foi possivel salvar a liberacao de acesso."));
    } finally {
      setSaving(false);
    }
  }

  function handleEnabledChange(checked: boolean) {
    if (checked && !selectedRoleIds.length && !selectedUserIds.length) {
      setError("Selecione uma pessoa do Discord ou um cargo para liberar o painel.");
      return;
    }

    void saveAccess(
      {
        verificationEnabled: checked
      },
      checked ? "Acesso ao painel ativado." : "Acesso ao painel desativado."
    );
  }

  function handleRoleToggle(roleId: string, checked: boolean) {
    const nextRoleIds = checked
      ? [...new Set([...selectedRoleIds, roleId])]
      : selectedRoleIds.filter((selectedRoleId) => selectedRoleId !== roleId);
    const nextPermissions = normalizeRolePermissions(settings?.dashboardRolePermissions ?? {}, nextRoleIds);

    if (checked && !nextPermissions[roleId]) {
      nextPermissions[roleId] = "basic";
    }

    if (settings?.verificationEnabled && !nextRoleIds.length && !selectedUserIds.length) {
      setStatus(null);
      setError("Desative o acesso ao painel antes de remover a ultima liberacao.");
      return;
    }

    void saveAccess(
      {
        verificationRoleId: nextRoleIds[0] ?? null,
        verificationRoleIds: nextRoleIds,
        dashboardRolePermissions: nextPermissions
      },
      nextRoleIds.length ? "Cargos de acesso salvos." : "Cargos de acesso removidos."
    );
  }

  function handleRoleLevelChange(roleId: string, level: DashboardAccessLevel) {
    if (!selectedRoleIds.includes(roleId)) {
      return;
    }

    void saveAccess(
      {
        dashboardRolePermissions: {
          ...normalizeRolePermissions(settings?.dashboardRolePermissions ?? {}, selectedRoleIds),
          [roleId]: level
        }
      },
      "Nivel de permissao atualizado."
    );
  }

  function handleDirectUserAdd(userIdInput = directUserId) {
    const userId = userIdInput.trim();

    if (!/^\d{5,32}$/.test(userId)) {
      setStatus(null);
      setError("Informe um ID Discord valido da pessoa.");
      return;
    }

    void saveAccess(
      {
        verificationEnabled: true,
        dashboardUserPermissions: {
          ...userPermissions,
          [userId]: userPermissions[userId] ?? "basic"
        }
      },
      "Pessoa liberada para acessar o painel."
    );
    setDirectUserId("");
    setMemberOptions([]);
  }

  async function handleMemberSearch() {
    if (!guild) {
      return;
    }

    const query = directUserId.trim();

    if (query.length < 2) {
      setStatus(null);
      setError("Digite pelo menos 2 caracteres do nome ou cole o ID Discord.");
      return;
    }

    setLoadingMembers(true);
    setStatus(null);
    setError(null);
    setMemberOptions([]);

    try {
      const members = await getGuildMemberOptions(guild.id, query, botId);
      const availableMembers = members.filter((member) => !selectedUserIds.includes(member.id));
      setMemberOptions(availableMembers);

      if (!members.length) {
        setStatus("Nenhum membro encontrado neste servidor.");
      } else if (!availableMembers.length) {
        setStatus("Os membros encontrados ja estao liberados.");
      }
    } catch (requestError) {
      setError(readErrorMessage(requestError, "Nao foi possivel buscar membros no Discord."));
    } finally {
      setLoadingMembers(false);
    }
  }

  function handleDirectUserRemove(userId: string) {
    const nextPermissions = normalizeUserPermissions(userPermissions, selectedUserIds.filter((id) => id !== userId));

    if (settings?.verificationEnabled && !selectedRoleIds.length && !Object.keys(nextPermissions).length) {
      setStatus(null);
      setError("Desative o acesso ao painel antes de remover a ultima liberacao.");
      return;
    }

    void saveAccess(
      {
        dashboardUserPermissions: nextPermissions
      },
      "Pessoa removida da liberacao do painel."
    );
  }

  function handleDirectUserLevelChange(userId: string, level: DashboardAccessLevel) {
    void saveAccess(
      {
        dashboardUserPermissions: {
          ...userPermissions,
          [userId]: level
        }
      },
      "Nivel da pessoa atualizado."
    );
  }

  async function handleTestAccess() {
    setTesting(true);
    setStatus(null);
    setError(null);
    setValidation(null);

    try {
      const result = await checkSiteAccess(botSlug);
      setValidation(result);
      setStatus(result.allowed ? `Teste aprovado como ${levelLabel(result.accessLevel)}.` : "Teste negado para sua conta atual.");
    } catch (requestError) {
      setError(readErrorMessage(requestError, "Nao foi possivel testar as permissoes agora."));
    } finally {
      setTesting(false);
    }
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
              <CardTitle>Acesso ao painel</CardTitle>
              <CardDescription>
                Selecione um usuario do Discord para liberar o site sem precisar configurar cargo.
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
        <div className="space-y-3 rounded-lg border border-zinc-900 bg-zinc-950/75 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium text-zinc-100">Cargos opcionais</span>
            <div className="flex items-center gap-2">
              <Badge variant={settings?.verificationEnabled ? "success" : "muted"}>
                {settings?.verificationEnabled ? "Ativo" : "Inativo"}
              </Badge>
              <span className="text-xs text-zinc-500">{selectedRoleIds.length} cargo(s)</span>
            </div>
          </div>

          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {loadingRoles ? (
              <p className="flex items-center gap-2 rounded-lg border border-zinc-900 bg-black px-3 py-2 text-sm text-zinc-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Carregando cargos...
              </p>
            ) : roles.length ? (
              roles.map((role) => {
                const checked = selectedRoleIds.includes(role.id);

                return (
                  <div
                    className="rounded-lg border border-zinc-900 bg-black px-3 py-2 text-sm text-zinc-100 transition hover:border-zinc-700"
                    key={role.id}
                  >
                    <label className="flex min-h-7 cursor-pointer items-center gap-3 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                      <input
                        checked={checked}
                        className="peer sr-only"
                        disabled={disabled}
                        onChange={(event) => handleRoleToggle(role.id, event.target.checked)}
                        type="checkbox"
                      />
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-zinc-700 bg-zinc-950 text-black transition peer-checked:border-emerald-400 peer-checked:bg-emerald-400">
                        {checked ? <Check className="h-3.5 w-3.5" /> : null}
                      </span>
                      <span className="min-w-0 flex-1 truncate">@{role.name}</span>
                      {checked ? <Badge variant="muted">{levelLabel(rolePermissions[role.id] ?? "basic")}</Badge> : null}
                    </label>

                    {checked ? (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        {levelOptions.map((option) => {
                          const active = (rolePermissions[role.id] ?? "basic") === option.id;
                          const Icon = option.icon;

                          return (
                            <button
                              className={[
                                "flex min-h-10 items-center gap-2 rounded-lg border px-3 text-left text-xs transition",
                                active
                                  ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-100"
                                  : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-600 hover:text-zinc-100"
                              ].join(" ")}
                              disabled={disabled}
                              key={option.id}
                              onClick={() => handleRoleLevelChange(role.id, option.id)}
                              type="button"
                            >
                              <Icon className="h-3.5 w-3.5 shrink-0" />
                              <span className="min-w-0 truncate">{option.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <p className="rounded-lg border border-zinc-900 bg-black px-3 py-2 text-sm text-zinc-500">
                Nenhum cargo disponivel.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-zinc-900 bg-zinc-950/75 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium text-zinc-100">Selecionar usuario do Discord</span>
            <span className="text-xs text-zinc-500">{selectedUserIds.length} pessoa(s)</span>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="min-h-10 flex-1 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600"
              disabled={disabled || loadingMembers}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleMemberSearch();
                }
              }}
              onChange={(event) => setDirectUserId(event.target.value)}
              placeholder="Nome, @usuario ou ID Discord"
              value={directUserId}
            />
            <Button disabled={disabled || loadingMembers || directUserId.trim().length < 2} onClick={() => void handleMemberSearch()} type="button" variant="outline">
              {loadingMembers ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Buscar
            </Button>
            <Button disabled={disabled || loadingMembers || !/^\d{5,32}$/.test(directUserId.trim())} onClick={() => handleDirectUserAdd()} type="button" variant="outline">
              <Plus className="h-4 w-4" />
              Adicionar ID
            </Button>
          </div>

          {memberOptions.length ? (
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {memberOptions.map((member) => (
                <button
                  className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-zinc-900 bg-black px-3 py-2 text-left transition hover:border-emerald-400/50 hover:bg-emerald-400/5"
                  disabled={disabled}
                  key={member.id}
                  onClick={() => handleDirectUserAdd(member.id)}
                  type="button"
                >
                  <img
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-full border border-zinc-800 bg-zinc-950 object-cover"
                    src={member.avatarUrl ?? "/uploads/welcome/default.gif?v=3"}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-zinc-100">{member.displayName}</span>
                    <span className="block truncate text-xs text-zinc-500">{member.tag} - {member.id}</span>
                  </span>
                  <Plus className="h-4 w-4 shrink-0 text-emerald-300" />
                </button>
              ))}
            </div>
          ) : null}

          <div className="space-y-2">
            {selectedUserIds.length ? (
              selectedUserIds.map((userId) => {
                const member = selectedMemberProfiles[userId];

                return (
                <div className="rounded-lg border border-zinc-900 bg-black px-3 py-3" key={userId}>
                  <div className="flex flex-wrap items-center gap-3">
                    {member?.avatarUrl ? (
                      <img
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-full border border-zinc-800 bg-zinc-950 object-cover"
                        src={member.avatarUrl}
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-100">{member?.displayName ?? userId}</p>
                      <p className="mt-1 truncate text-xs text-zinc-500">
                        {member ? `${member.tag} - ${userId}` : "Acesso por usuario Discord selecionado"}
                      </p>
                    </div>
                    <Badge variant="muted">{levelLabel(userPermissions[userId] ?? "basic")}</Badge>
                    <button
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-400 transition hover:border-red-500/50 hover:text-red-300"
                      disabled={disabled}
                      onClick={() => handleDirectUserRemove(userId)}
                      type="button"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {levelOptions.map((option) => {
                      const active = (userPermissions[userId] ?? "basic") === option.id;
                      const Icon = option.icon;

                      return (
                        <button
                          className={[
                            "flex min-h-10 items-center gap-2 rounded-lg border px-3 text-left text-xs transition",
                            active
                              ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-100"
                              : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-600 hover:text-zinc-100"
                          ].join(" ")}
                          disabled={disabled}
                          key={option.id}
                          onClick={() => handleDirectUserLevelChange(userId, option.id)}
                          type="button"
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 truncate">{option.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                );
              })
            ) : (
              <p className="rounded-lg border border-zinc-900 bg-black px-3 py-2 text-sm text-zinc-500">
                Nenhuma pessoa liberada diretamente.
              </p>
            )}
          </div>
        </div>

        <p className="text-xs leading-5 text-zinc-500">
          Cargo e opcional. A pessoa selecionada precisa continuar no servidor Discord deste bot para manter o acesso.
        </p>

        <div className="flex flex-col gap-3 rounded-lg border border-zinc-900 bg-zinc-950/75 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-100">Teste em tempo real</p>
            <p className="mt-1 text-xs text-zinc-500">Executa a mesma validacao backend usada no login para sua conta atual.</p>
          </div>
          <Button disabled={testing || saving} onClick={handleTestAccess} type="button" variant="outline">
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Testar acesso
          </Button>
        </div>

        {validation ? (
          <div className="space-y-2 rounded-lg border border-zinc-900 bg-black p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={validation.allowed ? "success" : "danger"}>
                {validation.allowed ? "Liberado" : "Negado"}
              </Badge>
              <Badge variant="muted">{levelLabel(validation.accessLevel)}</Badge>
            </div>
            {validation.checks.map((check) => (
              <p className="text-xs text-zinc-500" key={check.guildId}>
                {check.guildName}: {check.matchedRoleIds.length}/{check.requiredRoleIds.length} cargo(s),
                {" "}{check.matchedUserIds.length}/{check.requiredUserIds.length} pessoa(s)
              </p>
            ))}
            {!validation.allowed && validation.rejectionReasons.length ? (
              <p className="text-xs text-red-400">{validation.rejectionReasons[0]}</p>
            ) : null}
          </div>
        ) : null}

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

function selectedVerificationRoleIds(settings: GuildSettings) {
  const roleIds = settings.verificationRoleIds?.length
    ? settings.verificationRoleIds
    : settings.verificationRoleId
      ? [settings.verificationRoleId]
      : [];

  return [...new Set(roleIds.filter(Boolean))];
}

const levelOptions: Array<{
  id: DashboardAccessLevel;
  label: string;
  icon: typeof ShieldCheck;
}> = [
  { id: "admin", label: "Administrador", icon: Crown },
  { id: "moderator", label: "Moderador", icon: UserCog },
  { id: "premium", label: "Premium", icon: Sparkles },
  { id: "basic", label: "Basico", icon: UserCheck }
];

function normalizeRolePermissions(
  value: Record<string, DashboardAccessLevel>,
  roleIds: string[]
) {
  const roleIdSet = new Set(roleIds);
  const next: Record<string, DashboardAccessLevel> = {};

  for (const roleId of roleIds) {
    next[roleId] = value[roleId] ?? "basic";
  }

  for (const [roleId, level] of Object.entries(value)) {
    if (roleIdSet.has(roleId)) {
      next[roleId] = level;
    }
  }

  return next;
}

function normalizeUserPermissions(
  value: Record<string, DashboardAccessLevel>,
  userIds: string[]
) {
  const next: Record<string, DashboardAccessLevel> = {};

  for (const userId of userIds) {
    if (/^\d{5,32}$/.test(userId)) {
      next[userId] = value[userId] ?? "basic";
    }
  }

  return next;
}

function levelLabel(level: DashboardAccessLevel | "viewer") {
  const labels = {
    admin: "Administrador",
    moderator: "Moderador",
    premium: "Premium",
    basic: "Basico",
    viewer: "Sem acesso"
  };

  return labels[level];
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

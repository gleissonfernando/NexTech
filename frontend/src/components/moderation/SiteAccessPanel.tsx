import { useEffect, useState } from "react";
import { Crown, Loader2, Plus, Search, ShieldCheck, Sparkles, Trash2, UserCheck, UserCog } from "lucide-react";
import { checkSiteAccess, getGuildMemberOptions, patchGuildSettings } from "../../lib/api";
import type { AccessValidationResult, DashboardAccessLevel, DashboardGuild, GuildMemberOption, GuildSettings } from "../../types";
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
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [validation, setValidation] = useState<AccessValidationResult | null>(null);
  const [userQuery, setUserQuery] = useState("");
  const [memberOptions, setMemberOptions] = useState<GuildMemberOption[]>([]);
  const [selectedMemberProfiles, setSelectedMemberProfiles] = useState<Record<string, GuildMemberOption>>({});
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const userPermissions = settings?.dashboardUserPermissions ?? {};
  const selectedUserIds = Object.keys(userPermissions);
  const selectedUserKey = selectedUserIds.join(",");

  useEffect(() => {
    if (!guild || !canManage) {
      setMemberOptions([]);
      setUserQuery("");
      setError(null);
    }
  }, [canManage, guild]);

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
      return false;
    }

    setSaving(true);
    setStatus(null);
    setError(null);

    try {
      const nextSettings = await patchGuildSettings(guild.id, {
        verificationRoleId: null,
        verificationRoleIds: [],
        dashboardRolePermissions: {},
        ...payload
      }, botId);
      onSettingsChange(nextSettings);
      setStatus(successText);
      return true;
    } catch (requestError) {
      setError(readErrorMessage(requestError, "Nao foi possivel salvar a liberacao de acesso."));
      return false;
    } finally {
      setSaving(false);
    }
  }

  function handleEnabledChange(checked: boolean) {
    if (checked && !selectedUserIds.length) {
      setStatus(null);
      setError("Adicione pelo menos um usuario do Discord antes de ativar o acesso.");
      return;
    }

    void saveAccess(
      {
        verificationEnabled: checked
      },
      checked ? "Acesso ao painel ativado." : "Acesso ao painel desativado."
    );
  }

  function handleDirectUserAdd(userIdInput = userQuery) {
    const userId = userIdInput.trim();

    if (!isDiscordUserId(userId)) {
      setStatus(null);
      setError("Informe um ID Discord valido da pessoa.");
      return;
    }

    void saveUserAccess(userId, "Pessoa liberada para acessar o painel.");
  }

  async function saveUserAccess(userId: string, successText: string) {
    const saved = await saveAccess(
      {
        verificationEnabled: true,
        dashboardUserPermissions: {
          ...userPermissions,
          [userId]: userPermissions[userId] ?? "basic"
        }
      },
      successText
    );

    if (saved) {
      setUserQuery("");
      setMemberOptions([]);
    }
  }

  async function handleMemberSearch() {
    if (!guild) {
      return;
    }

    const query = userQuery.trim();

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
      const exactMember = isDiscordUserId(query)
        ? availableMembers.find((member) => member.id === query)
        : null;

      if (exactMember) {
        setSelectedMemberProfiles((current) => ({
          ...current,
          [exactMember.id]: exactMember
        }));
        await saveUserAccess(exactMember.id, "Pessoa encontrada e liberada para acessar o painel.");
        return;
      }

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

    if (settings?.verificationEnabled && !Object.keys(nextPermissions).length) {
      setStatus(null);
      setError("Desative o acesso ao painel antes de remover a ultima pessoa liberada.");
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

  const disabled = !canManage || !settings || loading || saving;
  const queryIsDiscordId = isDiscordUserId(userQuery.trim());

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
              <CardDescription>Libere pessoas pelo usuario do Discord, sem configurar cargos.</CardDescription>
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
            <span className="text-sm font-medium text-zinc-100">Usuarios liberados</span>
            <div className="flex items-center gap-2">
              <Badge variant={settings?.verificationEnabled ? "success" : "muted"}>
                {settings?.verificationEnabled ? "Ativo" : "Inativo"}
              </Badge>
              <span className="text-xs text-zinc-500">{selectedUserIds.length} pessoa(s)</span>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="min-h-10 flex-1 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600"
              disabled={disabled || loadingMembers}
              onChange={(event) => setUserQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (queryIsDiscordId) {
                    handleDirectUserAdd();
                  } else {
                    void handleMemberSearch();
                  }
                }
              }}
              placeholder="Nome, @usuario ou ID Discord"
              value={userQuery}
            />
            <Button disabled={disabled || loadingMembers || userQuery.trim().length < 2} onClick={() => void handleMemberSearch()} type="button" variant="outline">
              {loadingMembers ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Buscar
            </Button>
            <Button disabled={disabled || loadingMembers || !queryIsDiscordId} onClick={() => handleDirectUserAdd()} type="button" variant="outline">
              <Plus className="h-4 w-4" />
              Adicionar
            </Button>
          </div>

          {memberOptions.length ? (
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {memberOptions.map((member) => (
                <button
                  className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-zinc-900 bg-black px-3 py-2 text-left transition hover:border-emerald-400/50 hover:bg-emerald-400/5"
                  disabled={disabled}
                  key={member.id}
                  onClick={() => {
                    setSelectedMemberProfiles((current) => ({
                      ...current,
                      [member.id]: member
                    }));
                    void saveUserAccess(member.id, "Pessoa liberada para acessar o painel.");
                  }}
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
                          {member ? `${member.tag} - ${userId}` : "Usuario Discord liberado"}
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
                Nenhuma pessoa liberada.
              </p>
            )}
          </div>
        </div>

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
                {check.guildName}: {check.matchedUserIds.length}/{check.requiredUserIds.length} pessoa(s)
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

function normalizeUserPermissions(
  value: Record<string, DashboardAccessLevel>,
  userIds: string[]
) {
  const next: Record<string, DashboardAccessLevel> = {};

  for (const userId of userIds) {
    if (isDiscordUserId(userId)) {
      next[userId] = value[userId] ?? "basic";
    }
  }

  return next;
}

function isDiscordUserId(value: string) {
  return /^\d{5,32}$/.test(value.trim());
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

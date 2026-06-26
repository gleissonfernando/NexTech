import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Hash,
  LockKeyhole,
  Loader2,
  MessageSquareText,
  MonitorPlay,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Users,
  Volume2
} from "lucide-react";
import {
  getMissionTools,
  getMissionToolsOptions,
  publishMissionToolsPanel,
  saveMissionToolsSettings,
} from "../../lib/api";
import type {
  AuthUser,
  DashboardGuild,
  GuildChannelOption,
  GuildLiveOptions,
  GuildRoleOption,
  MissionToolsFeatureId,
  MissionToolsSettings,
  MissionToolsStats,
  MissionToolsTokenStatus,
  MissionToolsUserPanel
} from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

type MissionToolsPanelProps = {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
  user: AuthUser;
};

const featureDefinitions: Array<{
  id: MissionToolsFeatureId;
  label: string;
  description: string;
}> = [
  {
    id: "mission",
    label: "Mission System",
    description: "Painel privado com status, fila e progresso. Quests por token pessoal ficam bloqueadas."
  },
  {
    id: "clear",
    label: "Clean System",
    description: "Limpeza de DM e contatos pelo painel privado."
  },
  {
    id: "voice",
    label: "Voice Session",
    description: "Sessao persistente em canal de voz."
  },
  {
    id: "rich-presence",
    label: "Rich Presence",
    description: "Atividade personalizada do perfil."
  },
  {
    id: "username-checker",
    label: "Username Checker",
    description: "Consulta de disponibilidade de usernames."
  }
];

const emptySettings: MissionToolsSettings = {
  id: "",
  botId: "",
  guildId: "",
  enabled: false,
  panelChannelId: null,
  panelMessageId: null,
  logChannelId: null,
  managerRoleIds: [],
  allowedRoleIds: [],
  enabledFeatures: featureDefinitions.map((feature) => feature.id),
  lastPanelRequestedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const emptyStats: MissionToolsStats = {
  activeRichPresence: 0,
  activeVoiceSessions: 0,
  configuredUsers: 0,
  runningCleanups: 0,
  runningMissions: 0,
  usernameHits: 0,
  usersWithToken: 0
};

export function MissionToolsPanel({ botId, canManage, guild, user }: MissionToolsPanelProps) {
  const [settings, setSettings] = useState<MissionToolsSettings>(emptySettings);
  const [stats, setStats] = useState<MissionToolsStats>(emptyStats);
  const [users, setUsers] = useState<MissionToolsUserPanel[]>([]);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const canUse = Boolean(botId && guild);
  const regularRoles = useMemo(() => roles.filter((role) => role.id !== guild?.id), [roles, guild?.id]);
  const currentUserPanel = useMemo(
    () => users.find((item) => item.userId === user.discordId) ?? null,
    [user.discordId, users]
  );
  const tokenStatus = currentUserPanel?.tokenStatus ?? "disconnected";
  const tokenStatusInfo = tokenStatusDefinition(tokenStatus);

  useEffect(() => {
    let mounted = true;

    async function load() {
      if (!botId || !guild) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setMessage(null);

      const [missionTools, options] = await Promise.all([
        getMissionTools(guild.id, botId),
        getMissionToolsOptions(guild.id, botId)
      ]);

      if (!mounted) return;

      setSettings(missionTools.settings);
      setStats(missionTools.stats);
      setUsers(missionTools.users);
      setChannels(options.channels);
      setRoles(options.roles);
    }

    load()
      .catch((error) => {
        if (mounted) {
          setMessage(readRequestMessage(error) ?? "Não foi possível carregar o Mission Tools.");
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [botId, guild?.id]);

  function updateSetting<K extends keyof MissionToolsSettings>(key: K, value: MissionToolsSettings[K]) {
    setSettings((current) => ({
      ...current,
      [key]: value
    }));
  }

  function toggleRole(key: "managerRoleIds" | "allowedRoleIds", roleId: string) {
    setSettings((current) => {
      const selected = new Set(current[key]);

      if (selected.has(roleId)) {
        selected.delete(roleId);
      } else {
        selected.add(roleId);
      }

      return {
        ...current,
        [key]: [...selected]
      };
    });
  }

  function toggleFeature(featureId: MissionToolsFeatureId) {
    setSettings((current) => {
      const selected = new Set(current.enabledFeatures);

      if (selected.has(featureId)) {
        selected.delete(featureId);
      } else {
        selected.add(featureId);
      }

      return {
        ...current,
        enabledFeatures: selected.size ? [...selected] : [featureId]
      };
    });
  }

  async function handleSave() {
    if (!botId || !guild) return;

    setSaving(true);
    setMessage(null);

    try {
      const saved = await saveMissionToolsSettings(guild.id, botId, {
        allowedRoleIds: settings.allowedRoleIds,
        enabled: settings.enabled,
        enabledFeatures: settings.enabledFeatures,
        logChannelId: settings.logChannelId,
        managerRoleIds: settings.managerRoleIds,
        panelChannelId: settings.panelChannelId
      });

      setSettings(saved);
      setMessage("Mission Tools salvo.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível salvar o Mission Tools.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublishPanel() {
    if (!botId || !guild) return;

    setPublishing(true);
    setMessage(null);

    try {
      const saved = await publishMissionToolsPanel(guild.id, botId);
      setSettings(saved);
      setMessage("Publicacao do Control Center solicitada ao bot.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível publicar o painel.");
    } finally {
      setPublishing(false);
    }
  }

  async function handleSyncOptions() {
    if (!botId || !guild) return;

    setSyncing(true);
    setMessage(null);

    try {
      const options = await getMissionToolsOptions(guild.id, botId);

      setChannels(options.channels);
      setRoles(options.roles);
      setSettings((current) => pruneSettingsForOptions(current, options));
      setMessage("Canais e cargos sincronizados. Revise e salve para gravar.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível sincronizar com o Discord.");
    } finally {
      setSyncing(false);
    }
  }

  if (!canUse) {
    return (
      <Card>
        <CardContent className="flex min-h-40 items-center justify-center p-6 text-sm text-zinc-500">
          Selecione um bot e um servidor para configurar o Mission Tools.
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex min-h-48 items-center justify-center p-6">
          <Loader2 className="h-7 w-7 animate-spin text-zinc-400" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {message ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100">
          {message}
        </div>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
        <Card className="hover:translate-y-0">
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <MonitorPlay className="h-5 w-5 text-zinc-300" />
                  Mission Tools
                </CardTitle>
                <CardDescription>Libera e publica o Control Center do Mission Tools para este bot.</CardDescription>
              </div>
              <Switch
                checked={settings.enabled}
                disabled={!canManage || saving}
                onCheckedChange={(checked) => updateSetting("enabled", checked)}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <SelectField
                disabled={!canManage}
                icon={Hash}
                label="Canal do Control Center"
                onChange={(value) => updateSetting("panelChannelId", value)}
                options={channels.map((channel) => ({ label: `#${channel.name}`, value: channel.id }))}
                value={settings.panelChannelId}
              />
              <SelectField
                disabled={!canManage}
                icon={MessageSquareText}
                label="Canal de logs"
                onChange={(value) => updateSetting("logChannelId", value)}
                options={channels.map((channel) => ({ label: `#${channel.name}`, value: channel.id }))}
                value={settings.logChannelId}
              />
            </div>

            <FeatureGrid
              disabled={!canManage}
              enabledFeatures={settings.enabledFeatures}
              onToggle={toggleFeature}
            />

            <RoleChecklist
              disabled={!canManage}
              label="Cargos que podem gerenciar"
              onToggle={(roleId) => toggleRole("managerRoleIds", roleId)}
              roles={regularRoles}
              selectedRoleIds={settings.managerRoleIds}
            />

            <RoleChecklist
              disabled={!canManage}
              label="Cargos que podem usar o painel"
              onToggle={(roleId) => toggleRole("allowedRoleIds", roleId)}
              roles={regularRoles}
              selectedRoleIds={settings.allowedRoleIds}
            />

            <div className="flex flex-wrap gap-2 border-t border-zinc-900 pt-4">
              <Button disabled={!canManage || syncing} onClick={() => void handleSyncOptions()} variant="outline">
                {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Sincronizar Discord
              </Button>
              <Button disabled={!canManage || saving} onClick={() => void handleSave()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Salvar
              </Button>
              <Button disabled={!canManage || publishing || !settings.enabled || !settings.panelChannelId} onClick={() => void handlePublishPanel()} variant="outline">
                {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Publicar Control Center
              </Button>
              {settings.panelMessageId ? <Badge variant="success">Painel publicado</Badge> : <Badge variant="muted">Painel não publicado</Badge>}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Metric icon={Users} label="Usuarios com painel" value={String(stats.configuredUsers)} />
            <Metric icon={LockKeyhole} label="Tokens bloqueados" value="Seguro" />
            <Metric icon={Activity} label="Missoes rodando" value={String(stats.runningMissions)} />
            <Metric icon={Volume2} label="Voz ativa" value={String(stats.activeVoiceSessions)} />
            <Metric icon={Sparkles} label="Rich ativo" value={String(stats.activeRichPresence)} />
            <Metric icon={CheckCircle2} label="Hits username" value={String(stats.usernameHits)} />
          </div>

          <Card className="hover:translate-y-0">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LockKeyhole className="h-5 w-5 text-zinc-300" />
                Tokens de usuário bloqueados
              </CardTitle>
              <CardDescription>O Mission Tools não coleta token de conta Discord. Use apenas o bot e fluxos oficiais de OAuth/permissões.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg border border-zinc-900 bg-zinc-950/70 p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Conta vinculada</p>
                    <p className="mt-1 truncate text-sm font-semibold text-zinc-100">{user.globalName ?? user.username}</p>
                    <p className="mt-1 truncate font-mono text-xs text-zinc-500">{user.discordId}</p>
                  </div>
                  <Badge variant={tokenStatusInfo.variant}>{tokenStatusInfo.label}</Badge>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-zinc-500 sm:grid-cols-2">
                  <span>Token: bloqueado por segurança</span>
                  <span>Ultima validacao: {formatOptionalDate(currentUserPanel?.tokenLastValidatedAt)}</span>
                  <span>Atualizado: {formatOptionalDate(currentUserPanel?.tokenUpdatedAt)}</span>
                  <span>Status: {tokenStatusInfo.label}</span>
                </div>
              </div>
              {tokenStatus === "invalid" || tokenStatus === "expired" ? (
                <div className="rounded-lg border border-amber-900/70 bg-amber-950/30 p-3 text-sm text-amber-100">
                  {currentUserPanel?.tokenInvalidReason ?? "A autenticação do token falhou. Reconecte para continuar usando os módulos."}
                </div>
              ) : null}
              <div className="rounded-lg border border-amber-900/70 bg-amber-950/30 p-3 text-sm text-amber-100">
                Por segurança, tokens pessoais do Discord não podem ser salvos, enviados por DM ou usados para automação de conta. Recursos que dependiam desse token ficam indisponíveis até serem migrados para bot/OAuth oficial.
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <Card className="hover:translate-y-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-zinc-300" />
            Usuarios recentes
          </CardTitle>
          <CardDescription>{users.length} usuário(s) que abriram painel privado.</CardDescription>
        </CardHeader>
        <CardContent>
          {users.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {users.map((user) => (
                <UserCard key={user.userId} user={user} />
              ))}
            </div>
          ) : (
            <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 p-6 text-sm text-zinc-500">
              Nenhum usuário abriu o painel ainda.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FeatureGrid({
  disabled,
  enabledFeatures,
  onToggle
}: {
  disabled: boolean;
  enabledFeatures: MissionToolsFeatureId[];
  onToggle: (featureId: MissionToolsFeatureId) => void;
}) {
  const enabled = new Set(enabledFeatures);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-zinc-200">Módulos dentro do Control Center</p>
      <div className="grid gap-2 md:grid-cols-2">
        {featureDefinitions.map((feature) => (
          <label className="flex min-h-20 gap-3 rounded-lg border border-zinc-900 bg-zinc-950/70 p-3 text-sm" key={feature.id}>
            <input
              checked={enabled.has(feature.id)}
              disabled={disabled}
              onChange={() => onToggle(feature.id)}
              type="checkbox"
            />
            <span>
              <span className="block font-semibold text-zinc-100">{feature.label}</span>
              <span className="mt-1 block text-xs text-zinc-500">{feature.description}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function UserCard({ user }: { user: MissionToolsUserPanel }) {
  const tokenStatus = tokenStatusDefinition(user.tokenStatus);

  return (
    <div className="rounded-lg border border-zinc-900 bg-zinc-950/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{user.username ?? user.userId}</p>
          <p className="mt-1 truncate text-xs text-zinc-500">{user.userId}</p>
        </div>
        <Badge variant={tokenStatus.variant}>{tokenStatus.label}</Badge>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-zinc-500 sm:grid-cols-2">
        <span>Mission: {statusLabel(user.missionStatus)}</span>
        <span>Clean: {statusLabel(user.clearStatus)}</span>
        <span>Voice: {user.voiceStatus}</span>
        <span>Rich: {user.richPresenceStatus}</span>
      </div>
      {user.usernameCheckerLastEvent ? <p className="mt-3 truncate text-xs text-zinc-400">{user.usernameCheckerLastEvent}</p> : null}
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="flex min-h-20 items-center gap-3 rounded-lg border border-zinc-900 bg-zinc-950/70 p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-black text-zinc-300">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs text-zinc-500">{label}</p>
        <p className="mt-1 truncate text-lg font-semibold text-white">{value}</p>
      </div>
    </div>
  );
}

function SelectField({
  disabled,
  icon: Icon,
  label,
  onChange,
  options,
  value
}: {
  disabled: boolean;
  icon: typeof Hash;
  label: string;
  onChange: (value: string | null) => void;
  options: Array<{ label: string; value: string }>;
  value: string | null;
}) {
  return (
    <label className="space-y-2">
      <span className="flex items-center gap-2 text-sm font-medium text-zinc-200">
        <Icon className="h-4 w-4 text-zinc-500" />
        {label}
      </span>
      <select
        className="social-input h-12"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value || null)}
        value={value ?? ""}
      >
        <option value="">Não selecionado</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function RoleChecklist({
  disabled,
  label,
  onToggle,
  roles,
  selectedRoleIds
}: {
  disabled: boolean;
  label: string;
  onToggle: (roleId: string) => void;
  roles: GuildRoleOption[];
  selectedRoleIds: string[];
}) {
  const selected = new Set(selectedRoleIds);

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-sm font-medium text-zinc-200">
        <UserCheck className="h-4 w-4 text-zinc-500" />
        {label}
      </p>
      <div className="grid max-h-48 gap-2 overflow-y-auto rounded-lg border border-zinc-900 bg-zinc-950/70 p-3 sm:grid-cols-2">
        {roles.length ? roles.map((role) => (
          <label className="flex min-h-9 items-center gap-2 rounded-md px-2 text-sm text-zinc-300 hover:bg-zinc-900" key={role.id}>
            <input
              checked={selected.has(role.id)}
              disabled={disabled}
              onChange={() => onToggle(role.id)}
              type="checkbox"
            />
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: role.color ? `#${role.color.toString(16).padStart(6, "0")}` : "#71717a" }} />
            <span className="min-w-0 flex-1 truncate">{role.name}</span>
          </label>
        )) : (
          <span className="px-2 py-3 text-sm text-zinc-500">Nenhum cargo disponivel.</span>
        )}
      </div>
    </div>
  );
}

function pruneSettingsForOptions(settings: MissionToolsSettings, options: GuildLiveOptions): MissionToolsSettings {
  const channelIds = new Set(options.channels.map((channel) => channel.id));
  const roleIds = new Set(options.roles.map((role) => role.id));

  return {
    ...settings,
    allowedRoleIds: settings.allowedRoleIds.filter((roleId) => roleIds.has(roleId)),
    logChannelId: settings.logChannelId && channelIds.has(settings.logChannelId) ? settings.logChannelId : null,
    managerRoleIds: settings.managerRoleIds.filter((roleId) => roleIds.has(roleId)),
    panelChannelId: settings.panelChannelId && channelIds.has(settings.panelChannelId) ? settings.panelChannelId : null
  };
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    active: "Ativo",
    completed: "Concluido",
    deactivated: "Desativado",
    error: "Erro",
    inactive: "Inativo",
    running: "Rodando",
    waiting: "Aguardando"
  };

  return labels[status] ?? status;
}

function tokenStatusDefinition(status: MissionToolsTokenStatus): {
  label: string;
  variant: "default" | "success" | "warning" | "danger" | "muted";
} {
  const definitions: Record<MissionToolsTokenStatus, {
    label: string;
    variant: "default" | "success" | "warning" | "danger" | "muted";
  }> = {
    connected: {
      label: "Connected",
      variant: "success"
    },
    disconnected: {
      label: "Disconnected",
      variant: "muted"
    },
    expired: {
      label: "Expired Token",
      variant: "warning"
    },
    invalid: {
      label: "Invalid Token",
      variant: "danger"
    }
  };

  return definitions[status];
}

function formatOptionalDate(value?: string | null) {
  if (!value) return "Nunca";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Indisponivel";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(date);
}

function readRequestMessage(error: unknown) {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return null;
  }

  const response = (error as { response?: { data?: { message?: unknown } } }).response;
  return typeof response?.data?.message === "string" ? response.data.message : null;
}

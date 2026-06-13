import { useEffect, useMemo, useState } from "react";
import {
  Ban,
  CheckCircle2,
  Flag,
  Hash,
  ListChecks,
  Loader2,
  MessageSquareText,
  Play,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Trophy,
  UserCheck,
  Users
} from "lucide-react";
import {
  cancelMissionToolMission,
  completeMissionToolMission,
  createMissionToolMission,
  getMissionTools,
  getMissionToolsOptions,
  publishMissionToolsPanel,
  saveMissionToolsSettings,
  startMissionToolMission
} from "../../lib/api";
import type {
  DashboardGuild,
  GuildChannelOption,
  GuildLiveOptions,
  GuildRoleOption,
  MissionToolMission,
  MissionToolStatus,
  MissionToolsMessages,
  MissionToolsSettings,
  MissionToolsStats
} from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

type MissionToolsPanelProps = {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
};

const defaultMessages: MissionToolsMessages = {
  panelTitle: "Mission Tools",
  panelDescription: "Entre na missao ativa, acompanhe a fila e veja o status pelo painel.",
  joinSuccess: "Voce entrou na missao.",
  leaveSuccess: "Voce saiu da missao.",
  missionStarted: "A missao foi iniciada.",
  missionCompleted: "A missao foi concluida."
};

const emptySettings: MissionToolsSettings = {
  id: "",
  botId: "",
  guildId: "",
  enabled: false,
  panelChannelId: null,
  panelMessageId: null,
  logChannelId: null,
  managerRoleIds: [],
  participantRoleIds: [],
  completionRoleId: null,
  messages: defaultMessages,
  lastPanelRequestedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const emptyStats: MissionToolsStats = {
  activeParticipants: 0,
  completedMissions: 0,
  openMissions: 0,
  totalMissions: 0
};

export function MissionToolsPanel({ botId, canManage, guild }: MissionToolsPanelProps) {
  const [settings, setSettings] = useState<MissionToolsSettings>(emptySettings);
  const [missions, setMissions] = useState<MissionToolMission[]>([]);
  const [activeMission, setActiveMission] = useState<MissionToolMission | null>(null);
  const [stats, setStats] = useState<MissionToolsStats>(emptyStats);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [participantLimit, setParticipantLimit] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actingMissionId, setActingMissionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canUse = Boolean(botId && guild);
  const regularRoles = useMemo(() => roles.filter((role) => role.id !== guild?.id), [roles, guild?.id]);
  const assignableRoles = useMemo(() => regularRoles.filter((role) => role.assignable), [regularRoles]);
  const activeParticipants = activeMission?.participants.filter((participant) => !participant.leftAt) ?? [];

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
      setMissions(missionTools.missions);
      setActiveMission(missionTools.activeMission);
      setStats(missionTools.stats);
      setChannels(options.channels);
      setRoles(options.roles);
    }

    load()
      .catch((error) => {
        if (mounted) {
          setMessage(readRequestMessage(error) ?? "Nao foi possivel carregar o Mission Tools.");
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

  function updateMessage(key: keyof MissionToolsMessages, value: string) {
    setSettings((current) => ({
      ...current,
      messages: {
        ...current.messages,
        [key]: value
      }
    }));
  }

  function toggleRole(key: "managerRoleIds" | "participantRoleIds", roleId: string) {
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

  function updateMission(updatedMission: MissionToolMission) {
    setActiveMission(["open", "running"].includes(updatedMission.status) ? updatedMission : null);
    setMissions((current) => {
      const exists = current.some((mission) => mission.id === updatedMission.id);
      const next = exists
        ? current.map((mission) => mission.id === updatedMission.id ? updatedMission : mission)
        : [updatedMission, ...current];

      return next.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
    });
  }

  async function handleSave() {
    if (!botId || !guild) return;

    setSaving(true);
    setMessage(null);

    try {
      const saved = await saveMissionToolsSettings(guild.id, botId, {
        completionRoleId: settings.completionRoleId,
        enabled: settings.enabled,
        logChannelId: settings.logChannelId,
        managerRoleIds: settings.managerRoleIds,
        messages: settings.messages,
        panelChannelId: settings.panelChannelId,
        participantRoleIds: settings.participantRoleIds
      });

      setSettings(saved);
      setMessage("Mission Tools salvo.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Nao foi possivel salvar o Mission Tools.");
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
      setMessage("Publicacao do painel solicitada ao bot.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Nao foi possivel publicar o painel.");
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
      setMessage(readRequestMessage(error) ?? "Nao foi possivel sincronizar com o Discord.");
    } finally {
      setSyncing(false);
    }
  }

  async function handleCreateMission() {
    if (!botId || !guild || !title.trim()) return;

    setCreating(true);
    setMessage(null);

    try {
      const mission = await createMissionToolMission(guild.id, botId, {
        description: description.trim() || null,
        participantLimit,
        title: title.trim()
      });

      updateMission(mission);
      setTitle("");
      setDescription("");
      setParticipantLimit(0);
      setMessage("Missao criada e aberta no painel.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Nao foi possivel criar a missao.");
    } finally {
      setCreating(false);
    }
  }

  async function handleMissionAction(action: "start" | "complete" | "cancel", missionId: string) {
    if (!botId || !guild) return;

    setActingMissionId(missionId);
    setMessage(null);

    try {
      const mission = action === "start"
        ? await startMissionToolMission(guild.id, botId, missionId)
        : action === "complete"
          ? await completeMissionToolMission(guild.id, botId, missionId)
          : await cancelMissionToolMission(guild.id, botId, missionId);

      updateMission(mission);
      setMessage(action === "start" ? "Missao iniciada." : action === "complete" ? "Missao concluida." : "Missao cancelada.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Nao foi possivel atualizar a missao.");
    } finally {
      setActingMissionId(null);
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

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
        <Card className="hover:translate-y-0">
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <ListChecks className="h-5 w-5 text-zinc-300" />
                  Mission Tools
                </CardTitle>
                <CardDescription>Painel de missao, fila e participantes do servidor.</CardDescription>
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
                label="Canal do painel"
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
              <SelectField
                disabled={!canManage}
                icon={Trophy}
                label="Cargo ao concluir"
                onChange={(value) => updateSetting("completionRoleId", value)}
                options={assignableRoles.map((role) => ({ label: role.name, value: role.id }))}
                value={settings.completionRoleId}
              />
            </div>

            <RoleChecklist
              disabled={!canManage}
              label="Cargos gerentes"
              onToggle={(roleId) => toggleRole("managerRoleIds", roleId)}
              roles={regularRoles}
              selectedRoleIds={settings.managerRoleIds}
            />

            <RoleChecklist
              disabled={!canManage}
              label="Cargos participantes"
              onToggle={(roleId) => toggleRole("participantRoleIds", roleId)}
              roles={regularRoles}
              selectedRoleIds={settings.participantRoleIds}
            />

            <div className="grid gap-3">
              <TextField disabled={!canManage} label="Titulo do painel" onChange={(value) => updateMessage("panelTitle", value)} value={settings.messages.panelTitle} />
              <TextareaField disabled={!canManage} label="Descricao do painel" onChange={(value) => updateMessage("panelDescription", value)} value={settings.messages.panelDescription} />
              <div className="grid gap-3 md:grid-cols-2">
                <TextField disabled={!canManage} label="Mensagem de entrada" onChange={(value) => updateMessage("joinSuccess", value)} value={settings.messages.joinSuccess} />
                <TextField disabled={!canManage} label="Mensagem de saida" onChange={(value) => updateMessage("leaveSuccess", value)} value={settings.messages.leaveSuccess} />
                <TextField disabled={!canManage} label="Mensagem iniciada" onChange={(value) => updateMessage("missionStarted", value)} value={settings.messages.missionStarted} />
                <TextField disabled={!canManage} label="Mensagem concluida" onChange={(value) => updateMessage("missionCompleted", value)} value={settings.messages.missionCompleted} />
              </div>
            </div>

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
                Enviar painel
              </Button>
              {settings.panelMessageId ? <Badge variant="success">Painel publicado</Badge> : <Badge variant="muted">Painel nao publicado</Badge>}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric icon={Flag} label="Missoes" value={String(stats.totalMissions)} />
            <Metric icon={Users} label="Participantes ativos" value={String(stats.activeParticipants)} />
            <Metric icon={CheckCircle2} label="Concluidas" value={String(stats.completedMissions)} />
          </div>

          <Card className="hover:translate-y-0">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="h-5 w-5 text-zinc-300" />
                Nova missao
              </CardTitle>
              <CardDescription>{activeMission ? "Conclua ou cancele a missao atual antes de abrir outra." : "Crie uma missao para o painel do Discord."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <TextField disabled={!canManage || Boolean(activeMission)} label="Titulo" onChange={setTitle} value={title} />
              <TextareaField disabled={!canManage || Boolean(activeMission)} label="Descricao" onChange={setDescription} value={description} />
              <label className="space-y-2">
                <span className="text-sm font-medium text-zinc-200">Limite de participantes</span>
                <input
                  className="social-input h-11"
                  disabled={!canManage || Boolean(activeMission)}
                  min={0}
                  onChange={(event) => setParticipantLimit(Number(event.target.value))}
                  type="number"
                  value={participantLimit}
                />
              </label>
              <Button disabled={!canManage || creating || Boolean(activeMission) || !title.trim()} onClick={() => void handleCreateMission()}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Criar missao
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card className="hover:translate-y-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Flag className="h-5 w-5 text-zinc-300" />
              Missao ativa
            </CardTitle>
            <CardDescription>{activeMission ? `${activeMission.activeParticipantCount} participante(s)` : "Nenhuma missao aberta."}</CardDescription>
          </CardHeader>
          <CardContent>
            {activeMission ? (
              <div className="space-y-4">
                <MissionSummary mission={activeMission} />
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={!canManage || actingMissionId === activeMission.id || activeMission.status === "running"}
                    onClick={() => void handleMissionAction("start", activeMission.id)}
                    variant="outline"
                  >
                    {actingMissionId === activeMission.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    Iniciar
                  </Button>
                  <Button
                    disabled={!canManage || actingMissionId === activeMission.id}
                    onClick={() => void handleMissionAction("complete", activeMission.id)}
                  >
                    {actingMissionId === activeMission.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Concluir
                  </Button>
                  <Button
                    disabled={!canManage || actingMissionId === activeMission.id}
                    onClick={() => void handleMissionAction("cancel", activeMission.id)}
                    variant="destructive"
                  >
                    {actingMissionId === activeMission.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                    Cancelar
                  </Button>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-zinc-200">Participantes</p>
                  <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-zinc-900 bg-zinc-950/70 p-3">
                    {activeParticipants.length ? activeParticipants.map((participant) => (
                      <div className="flex min-h-9 items-center justify-between gap-3 rounded-md bg-black/20 px-2 text-sm" key={participant.userId}>
                        <span className="min-w-0 truncate text-zinc-200">{participant.username ?? participant.userId}</span>
                        <span className="shrink-0 text-xs text-zinc-500">{formatDate(participant.joinedAt)}</span>
                      </div>
                    )) : (
                      <span className="block py-4 text-center text-sm text-zinc-500">Nenhum participante ativo.</span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <EmptyBlock icon={Flag} title="Nenhuma missao ativa" />
            )}
          </CardContent>
        </Card>

        <Card className="hover:translate-y-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-zinc-300" />
              Historico
            </CardTitle>
            <CardDescription>{missions.length} registro(s) recentes.</CardDescription>
          </CardHeader>
          <CardContent>
            {missions.length ? (
              <div className="space-y-3">
                {missions.map((mission) => (
                  <MissionSummary key={mission.id} mission={mission} compact />
                ))}
              </div>
            ) : (
              <EmptyBlock icon={ListChecks} title="Nenhuma missao registrada" />
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function MissionSummary({ compact = false, mission }: { compact?: boolean; mission: MissionToolMission }) {
  return (
    <div className="rounded-lg border border-zinc-900 bg-zinc-950/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{mission.title}</p>
          {mission.description && !compact ? <p className="mt-1 text-sm text-zinc-500">{mission.description}</p> : null}
        </div>
        <Badge variant={statusVariant(mission.status)}>{statusLabel(mission.status)}</Badge>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-zinc-500 sm:grid-cols-3">
        <span>Participantes: {mission.activeParticipantCount}{mission.participantLimit ? `/${mission.participantLimit}` : ""}</span>
        <span>Criada: {formatDate(mission.createdAt)}</span>
        <span>Atualizada: {formatDate(mission.updatedAt)}</span>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Flag; label: string; value: string }) {
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
        <option value="">Nao selecionado</option>
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

function TextField({ disabled, label, onChange, value }: { disabled: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium text-zinc-200">{label}</span>
      <input className="social-input h-11" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value} />
    </label>
  );
}

function TextareaField({ disabled, label, onChange, value }: { disabled: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium text-zinc-200">{label}</span>
      <textarea className="social-input min-h-24 resize-y" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value} />
    </label>
  );
}

function EmptyBlock({ icon: Icon, title }: { icon: typeof Flag; title: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 p-6 text-center">
      <Icon className="mb-3 h-7 w-7 text-zinc-500" />
      <p className="text-sm font-medium text-zinc-500">{title}</p>
    </div>
  );
}

function statusVariant(status: MissionToolStatus) {
  if (status === "completed") return "success";
  if (status === "cancelled") return "danger";
  if (status === "running") return "warning";
  return "muted";
}

function statusLabel(status: MissionToolStatus) {
  const labels: Record<MissionToolStatus, string> = {
    cancelled: "Cancelada",
    completed: "Concluida",
    open: "Aberta",
    running: "Em andamento"
  };

  return labels[status];
}

function pruneSettingsForOptions(settings: MissionToolsSettings, options: GuildLiveOptions): MissionToolsSettings {
  const channelIds = new Set(options.channels.map((channel) => channel.id));
  const roleIds = new Set(options.roles.map((role) => role.id));

  return {
    ...settings,
    completionRoleId: settings.completionRoleId && roleIds.has(settings.completionRoleId) ? settings.completionRoleId : null,
    logChannelId: settings.logChannelId && channelIds.has(settings.logChannelId) ? settings.logChannelId : null,
    managerRoleIds: settings.managerRoleIds.filter((roleId) => roleIds.has(roleId)),
    panelChannelId: settings.panelChannelId && channelIds.has(settings.panelChannelId) ? settings.panelChannelId : null,
    participantRoleIds: settings.participantRoleIds.filter((roleId) => roleIds.has(roleId))
  };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit"
  }).format(new Date(value));
}

function readRequestMessage(error: unknown) {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return null;
  }

  const response = (error as { response?: { data?: { message?: unknown } } }).response;
  return typeof response?.data?.message === "string" ? response.data.message : null;
}

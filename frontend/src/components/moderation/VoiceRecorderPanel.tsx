import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  CalendarClock,
  Clock3,
  Database,
  Download,
  Hash,
  Loader2,
  Mic2,
  Play,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Square,
  Trash2
} from "lucide-react";
import {
  deleteVoiceRecording,
  getGuildLiveOptions,
  getVoiceRecorder,
  saveVoiceRecorderSettings,
  startVoiceRecorder,
  stopVoiceRecorder,
  voiceRecordingAudioUrl,
  voiceRecordingDownloadUrl
} from "../../lib/api";
import { createDashboardSocket } from "../../lib/socket";
import type {
  DashboardGuild,
  GuildChannelOption,
  GuildRoleOption,
  GuildVoiceChannelOption,
  VoiceRecorderResponse,
  VoiceRecorderSettings,
  VoiceRecording
} from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

type VoiceRecorderPanelProps = {
  botId: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
};

type Filters = {
  channelId: string;
  dateFrom: string;
  dateTo: string;
  maxDurationSeconds: string;
  minDurationSeconds: string;
  search: string;
  userId: string;
};

const emptySettings: VoiceRecorderSettings = {
  id: "",
  botId: "",
  guildId: "",
  enabled: false,
  logChannelId: null,
  allowedRoleIds: [],
  maxDurationMinutes: 120,
  retentionDays: 30,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const emptyData: VoiceRecorderResponse = {
  activeRecording: null,
  recordings: [],
  settings: emptySettings,
  stats: {
    activeRecording: false,
    recordingsThisMonth: 0,
    recordingsToday: 0,
    totalDurationMs: 0,
    totalRecordings: 0,
    totalStorageBytes: 0
  }
};

const emptyFilters: Filters = {
  channelId: "",
  dateFrom: "",
  dateTo: "",
  maxDurationSeconds: "",
  minDurationSeconds: "",
  search: "",
  userId: ""
};

export function VoiceRecorderPanel({ botId, canManage, guild }: VoiceRecorderPanelProps) {
  const [data, setData] = useState<VoiceRecorderResponse>(emptyData);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [voiceChannels, setVoiceChannels] = useState<GuildVoiceChannelOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [selectedVoiceChannelId, setSelectedVoiceChannelId] = useState("");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canUse = Boolean(botId && guild);
  const settings = data.settings;
  const activeRecording = data.activeRecording;
  const allowedRoleSet = useMemo(() => new Set(settings.allowedRoleIds), [settings.allowedRoleIds]);
  const selectableRoles = useMemo(
    () => roles.filter((role) => role.id === guild?.id || !role.managed),
    [guild?.id, roles]
  );

  useEffect(() => {
    void load();
  }, [botId, guild?.id]);

  useEffect(() => {
    if (!botId || !guild) {
      return;
    }

    const socket = createDashboardSocket();

    socket.on("voice-recorder:recording_updated", (event: { botId?: string | null; guildId: string; recording: VoiceRecording }) => {
      if ((event.botId ?? null) !== botId || event.guildId !== guild.id) {
        return;
      }

      setData((current) => mergeRecording(current, event.recording));
    });
    socket.on("voice-recorder:settings_updated", (nextSettings: VoiceRecorderSettings) => {
      if (nextSettings.botId !== botId || nextSettings.guildId !== guild.id) {
        return;
      }

      setData((current) => ({
        ...current,
        settings: nextSettings
      }));
    });

    return () => {
      socket.disconnect();
    };
  }, [botId, guild?.id]);

  async function load(customFilters = filters) {
    if (!botId || !guild) {
      setData(emptyData);
      setChannels([]);
      setVoiceChannels([]);
      setRoles([]);
      setSelectedVoiceChannelId("");
      setLoading(false);
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const [recorder, options] = await Promise.all([
        getVoiceRecorder(guild.id, botId, normalizeFilters(customFilters)),
        getGuildLiveOptions(guild.id, botId)
      ]);

      setData(recorder);
      setChannels(options.channels);
      setVoiceChannels(options.voiceChannels ?? []);
      setRoles(options.roles);
      setSelectedVoiceChannelId((current) => current || options.voiceChannels?.[0]?.id || "");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível carregar o Voice Recorder.");
    } finally {
      setLoading(false);
    }
  }

  function updateSetting<K extends keyof VoiceRecorderSettings>(key: K, value: VoiceRecorderSettings[K]) {
    setData((current) => ({
      ...current,
      settings: {
        ...current.settings,
        [key]: value
      }
    }));
  }

  function toggleRole(roleId: string) {
    const next = new Set(settings.allowedRoleIds);

    if (next.has(roleId)) {
      next.delete(roleId);
    } else {
      next.add(roleId);
    }

    updateSetting("allowedRoleIds", [...next]);
  }

  async function handleSave(partial?: Partial<VoiceRecorderSettings>) {
    if (!botId || !guild) return;

    setSaving(true);
    setMessage(null);

    const next = {
      ...settings,
      ...(partial ?? {})
    };

    try {
      const saved = await saveVoiceRecorderSettings(guild.id, botId, {
        allowedRoleIds: next.allowedRoleIds,
        enabled: next.enabled,
        logChannelId: next.logChannelId,
        retentionDays: next.retentionDays
      });

      setData((current) => ({
        ...current,
        settings: saved
      }));
      setMessage("Configuracao do Voice Recorder salva.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível salvar o Voice Recorder.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStart() {
    if (!botId || !guild || !selectedVoiceChannelId) return;

    setActing(true);
    setMessage(null);

    try {
      const recording = await startVoiceRecorder(guild.id, botId, selectedVoiceChannelId);
      setData((current) => mergeRecording(current, recording));
      setMessage("Início de gravação solicitado ao bot.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível iniciar a gravação.");
    } finally {
      setActing(false);
    }
  }

  async function handleStop() {
    if (!botId || !guild) return;

    setActing(true);
    setMessage(null);

    try {
      const recording = await stopVoiceRecorder(guild.id, botId, activeRecording?.id ?? null);
      setData((current) => mergeRecording(current, recording));
      setMessage("Encerramento solicitado ao bot.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível encerrar a gravação.");
    } finally {
      setActing(false);
    }
  }

  async function handleDelete(recordingId: string) {
    if (!botId || !guild) return;

    setActing(true);
    setMessage(null);

    try {
      const recording = await deleteVoiceRecording(guild.id, botId, recordingId);
      setData((current) => mergeRecording(current, recording));
      setMessage("Arquivo da gravação excluído.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível excluir a gravação.");
    } finally {
      setActing(false);
    }
  }

  if (!canUse) {
    return (
      <Card>
        <CardContent className="flex min-h-40 items-center justify-center p-6 text-sm text-zinc-500">
          Selecione um bot e um servidor para configurar o Voice Recorder.
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

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <Card className="hover:translate-y-0">
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Mic2 className="h-5 w-5 text-zinc-300" />
                  Voice Recorder
                </CardTitle>
                <CardDescription>Gravacao persistente de canais de voz com historico, logs e arquivos.</CardDescription>
              </div>
              <Badge variant={settings.enabled ? "success" : "muted"}>
                {settings.enabled ? "Sistema ativo" : "Sistema inativo"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric icon={Activity} label="Total" value={formatNumber(data.stats.totalRecordings)} />
              <Metric icon={Clock3} label="Horas gravadas" value={formatDuration(data.stats.totalDurationMs)} />
              <Metric icon={Database} label="Armazenamento" value={formatBytes(data.stats.totalStorageBytes)} />
              <Metric icon={CalendarClock} label="Hoje / mes" value={`${data.stats.recordingsToday}/${data.stats.recordingsThisMonth}`} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <SelectField
                disabled={!canManage}
                icon={Hash}
                label="Canal de logs"
                onChange={(value) => updateSetting("logChannelId", value)}
                options={channels.map((channel) => ({ label: `#${channel.name}`, value: channel.id }))}
                value={settings.logChannelId}
              />
              <SelectField
                disabled={!canManage}
                icon={Mic2}
                label="Canal de voz para iniciar pela dashboard"
                onChange={(value) => setSelectedVoiceChannelId(value ?? "")}
                options={voiceChannels.map((channel) => ({ label: channel.type === "stage" ? `Stage: ${channel.name}` : channel.name, value: channel.id }))}
                value={selectedVoiceChannelId}
              />
              <NumberField
                disabled={!canManage}
                label="Retencao de arquivos (dias)"
                max={3650}
                min={1}
                onChange={(value) => updateSetting("retentionDays", value)}
                value={settings.retentionDays}
              />
            </div>

            <p className="text-sm text-zinc-400">
              A gravação não possui limite de tempo e termina automaticamente quando a última pessoa sai da call.
            </p>

            <RoleChecklist
              allowedRoleSet={allowedRoleSet}
              disabled={!canManage}
              onToggle={toggleRole}
              roles={selectableRoles}
            />

            <div className="flex flex-wrap gap-2 border-t border-zinc-900 pt-4">
              <Button disabled={!canManage || saving} onClick={() => void handleSave({ enabled: true })} variant="outline">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Ativar
              </Button>
              <Button disabled={!canManage || saving} onClick={() => void handleSave({ enabled: false })} variant="outline">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                Desativar
              </Button>
              <Button disabled={!canManage || saving} onClick={() => void handleSave()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Salvar
              </Button>
              <Button disabled={acting || !settings.enabled || !selectedVoiceChannelId || Boolean(activeRecording)} onClick={() => void handleStart()} variant="outline">
                {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Iniciar
              </Button>
              <Button disabled={acting || !activeRecording} onClick={() => void handleStop()} variant="outline">
                {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                Encerrar
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:translate-y-0">
          <CardHeader>
            <CardTitle>Status do sistema</CardTitle>
            <CardDescription>Sincronizado com bot e banco em tempo real.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <StatusRow label="Sistema" value={settings.enabled ? "Ativo" : "Inativo"} variant={settings.enabled ? "success" : "muted"} />
            <StatusRow label="Gravacao" value={activeRecording ? statusLabel(activeRecording.status) : "Nenhuma"} variant={activeRecording ? "warning" : "muted"} />
            <StatusRow label="Cargos permitidos" value={`${settings.allowedRoleIds.length} cargo(s)`} variant={settings.allowedRoleIds.length ? "success" : "danger"} />
            <StatusRow label="Canal de logs" value={settings.logChannelId ? channelLabel(channels, settings.logChannelId) : "Não configurado"} variant={settings.logChannelId ? "success" : "warning"} />

            {activeRecording ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
                <p className="text-sm font-medium text-white">{activeRecording.channelName ?? activeRecording.channelId}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  Iniciada por {activeRecording.startedByTag ?? activeRecording.startedById} em {formatDate(activeRecording.startedAt)}
                </p>
                <p className="mt-2 text-xs text-zinc-400">
                  {activeRecording.participants.length} participante(s) detectado(s)
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <Card className="hover:translate-y-0">
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle>Histórico das gravações</CardTitle>
              <CardDescription>{data.recordings.length} registro(s) carregado(s).</CardDescription>
            </div>
            <Button disabled={loading} onClick={() => void load()} variant="outline">
              <RefreshCw className="h-4 w-4" />
              Atualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <TextField label="Buscar" onChange={(value) => setFilters((current) => ({ ...current, search: value }))} value={filters.search} />
            <TextField label="Usuario" onChange={(value) => setFilters((current) => ({ ...current, userId: value }))} value={filters.userId} />
            <SelectField
              disabled={false}
              icon={Mic2}
              label="Canal"
              onChange={(value) => setFilters((current) => ({ ...current, channelId: value ?? "" }))}
              options={voiceChannels.map((channel) => ({ label: channel.name, value: channel.id }))}
              value={filters.channelId}
            />
            <div className="flex items-end">
              <Button className="w-full" onClick={() => void load(filters)} variant="outline">
                <Search className="h-4 w-4" />
                Filtrar
              </Button>
            </div>
            <TextField label="Data inicial" onChange={(value) => setFilters((current) => ({ ...current, dateFrom: value }))} type="date" value={filters.dateFrom} />
            <TextField label="Data final" onChange={(value) => setFilters((current) => ({ ...current, dateTo: value }))} type="date" value={filters.dateTo} />
            <TextField label="Duracao minima (s)" onChange={(value) => setFilters((current) => ({ ...current, minDurationSeconds: value }))} type="number" value={filters.minDurationSeconds} />
            <TextField label="Duracao maxima (s)" onChange={(value) => setFilters((current) => ({ ...current, maxDurationSeconds: value }))} type="number" value={filters.maxDurationSeconds} />
          </div>

          <RecordingList
            botId={botId ?? ""}
            canManage={canManage}
            guildId={guild?.id ?? ""}
            onDelete={handleDelete}
            recordings={data.recordings.filter((recording) => recording.status !== "deleted")}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function RecordingList({
  botId,
  canManage,
  guildId,
  onDelete,
  recordings
}: {
  botId: string;
  canManage: boolean;
  guildId: string;
  onDelete: (recordingId: string) => void;
  recordings: VoiceRecording[];
}) {
  if (!recordings.length) {
    return (
      <div className="flex min-h-36 items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 text-sm text-zinc-500">
        Nenhuma gravação encontrada.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {recordings.map((recording) => (
        <div className="rounded-lg border border-zinc-900 bg-zinc-950/70 p-4" key={recording.id}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold text-white">{recording.channelName ?? recording.channelId}</p>
                <Badge variant={statusVariant(recording.status)}>{statusLabel(recording.status)}</Badge>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {formatDate(recording.startedAt)} - {formatDuration(recording.durationMs)} - {recording.participants.length} participante(s)
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Iniciada por {recording.startedByTag ?? recording.startedById}
                {recording.stoppedByTag ? ` - encerrada por ${recording.stoppedByTag}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {recording.status === "completed" ? (
                <Button asChild size="sm" variant="outline">
                  <a href={voiceRecordingDownloadUrl(guildId, botId, recording.id)}>
                    <Download className="h-4 w-4" />
                    Download
                  </a>
                </Button>
              ) : null}
              {canManage && recording.status !== "recording" && recording.status !== "processing" && recording.status !== "starting" ? (
                <Button onClick={() => onDelete(recording.id)} size="sm" type="button" variant="outline">
                  <Trash2 className="h-4 w-4" />
                  Excluir
                </Button>
              ) : null}
            </div>
          </div>

          {recording.status === "completed" ? (
            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <audio className="h-10 w-full" controls preload="none" src={voiceRecordingAudioUrl(guildId, botId, recording.id)} />
              <span className="text-xs text-zinc-500">{formatBytes(recording.fileSize)}</span>
            </div>
          ) : recording.error ? (
            <p className="mt-3 text-xs text-red-300">{recording.error}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function RoleChecklist({
  allowedRoleSet,
  disabled,
  onToggle,
  roles
}: {
  allowedRoleSet: Set<string>;
  disabled: boolean;
  onToggle: (roleId: string) => void;
  roles: GuildRoleOption[];
}) {
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-sm font-medium text-zinc-200">
        <ShieldCheck className="h-4 w-4 text-zinc-500" />
        Cargos permitidos
      </p>
      <div className="grid max-h-52 gap-2 overflow-y-auto rounded-lg border border-zinc-900 bg-zinc-950/70 p-3 sm:grid-cols-2 xl:grid-cols-3">
        {roles.length ? roles.map((role) => (
          <label className="flex min-h-9 items-center gap-2 rounded-md px-2 text-sm text-zinc-300 hover:bg-zinc-900" key={role.id}>
            <input checked={allowedRoleSet.has(role.id)} disabled={disabled} onChange={() => onToggle(role.id)} type="checkbox" />
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

function Metric({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-900 bg-zinc-950/70 p-4">
      <p className="flex items-center gap-2 text-xs text-zinc-500">
        <Icon className="h-4 w-4" />
        {label}
      </p>
      <p className="mt-2 truncate text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function StatusRow({ label, value, variant }: { label: string; value: string; variant: "success" | "warning" | "danger" | "muted" }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-900 bg-zinc-950/70 px-3 py-2">
      <span className="text-sm text-zinc-400">{label}</span>
      <Badge variant={variant}>{value}</Badge>
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

function NumberField({
  disabled,
  label,
  max,
  min,
  onChange,
  value
}: {
  disabled: boolean;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium text-zinc-200">{label}</span>
      <input
        className="social-input h-12"
        disabled={disabled}
        max={max}
        min={min}
        onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value) || min)))}
        type="number"
        value={value}
      />
    </label>
  );
}

function TextField({
  label,
  onChange,
  type = "text",
  value
}: {
  label: string;
  onChange: (value: string) => void;
  type?: string;
  value: string;
}) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium text-zinc-200">{label}</span>
      <input className="social-input h-12" onChange={(event) => onChange(event.target.value)} type={type} value={value} />
    </label>
  );
}

function mergeRecording(current: VoiceRecorderResponse, recording: VoiceRecording): VoiceRecorderResponse {
  const withoutDeleted = current.recordings.filter((item) => item.id !== recording.id);
  const activeRecording = ["starting", "recording", "processing"].includes(recording.status) ? recording : (
    current.activeRecording?.id === recording.id ? null : current.activeRecording
  );

  return {
    ...current,
    activeRecording,
    recordings: [recording, ...withoutDeleted].sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())
  };
}

function normalizeFilters(filters: Filters) {
  return {
    channelId: filters.channelId || null,
    dateFrom: filters.dateFrom || null,
    dateTo: filters.dateTo || null,
    maxDurationSeconds: filters.maxDurationSeconds ? Number(filters.maxDurationSeconds) : null,
    minDurationSeconds: filters.minDurationSeconds ? Number(filters.minDurationSeconds) : null,
    search: filters.search || null,
    userId: filters.userId || null
  };
}

function channelLabel(channels: GuildChannelOption[], channelId: string) {
  const channel = channels.find((item) => item.id === channelId);
  return channel ? `#${channel.name}` : channelId;
}

function statusVariant(status: VoiceRecording["status"]) {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  if (status === "deleted") return "muted";
  return "warning";
}

function statusLabel(status: VoiceRecording["status"]) {
  const labels: Record<VoiceRecording["status"], string> = {
    completed: "Finalizada",
    deleted: "Excluida",
    failed: "Falhou",
    processing: "Processando",
    recording: "Gravando",
    starting: "Iniciando"
  };

  return labels[status];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function readRequestMessage(error: unknown) {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return null;
  }

  const response = (error as { response?: { data?: { message?: unknown } } }).response;
  return typeof response?.data?.message === "string" ? response.data.message : null;
}

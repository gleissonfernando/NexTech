import { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  CalendarClock,
  Camera,
  Hash,
  Image as ImageIcon,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  UserCheck
} from "lucide-react";
import {
  getFivemFac,
  getFivemFacOptions,
  publishFivemFacPanel,
  removeFivemFacAbsencePhoto,
  saveFivemFacSettings,
  uploadFivemFacAbsencePhoto
} from "../../lib/api";
import type {
  DashboardGuild,
  FivemFacAbsence,
  FivemFacAbsenceStatus,
  FivemFacMessages,
  FivemFacSettings,
  GuildChannelOption,
  GuildLiveOptions,
  GuildRoleOption
} from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

type FacAbsencePanelProps = {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
};

const defaultMessages: FivemFacMessages = {
  panelTitle: "📅 Solicitar Ausência",
  panelDescription: "Informe a data de retorno e o motivo da sua ausência.",
  requestCreated: "Sua solicitação de ausência foi enviada para aprovação.",
  approved: "Sua ausência foi aprovada.",
  rejected: "Sua ausência foi reprovada.",
  started: "Sua ausência foi iniciada e o cargo configurado foi aplicado.",
  finished: "Sua ausência foi finalizada e o cargo configurado foi removido."
};

const emptySettings: FivemFacSettings = {
  id: "",
  botId: "",
  guildId: "",
  enabled: false,
  panelChannelId: null,
  panelMessageId: null,
  absenceRoleId: null,
  viewerRoleIds: [],
  approverRoleIds: [],
  memberRoleIds: [],
  logChannelId: null,
  messages: defaultMessages,
  lastPanelRequestedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};
const FAC_PHOTO_MAX_SIZE = 10 * 1024 * 1024;
const FAC_PHOTO_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

export function FacAbsencePanel({ botId, canManage, guild }: FacAbsencePanelProps) {
  const [settings, setSettings] = useState<FivemFacSettings>(emptySettings);
  const [absences, setAbsences] = useState<FivemFacAbsence[]>([]);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const canUse = Boolean(botId && guild);
  const assignableRoles = useMemo(() => roles.filter((role) => role.assignable), [roles]);
  const regularRoles = useMemo(() => roles.filter((role) => role.id !== guild?.id), [roles, guild?.id]);

  useEffect(() => {
    let mounted = true;

    async function load() {
      if (!botId || !guild) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setMessage(null);

      const [fac, options] = await Promise.all([
        getFivemFac(guild.id, botId),
        getFivemFacOptions(guild.id, botId)
      ]);

      if (!mounted) return;

      setSettings(fac.settings);
      setAbsences(fac.absences);
      setChannels(options.channels);
      setRoles(options.roles);
    }

    load()
      .catch((error) => {
        if (mounted) {
          setMessage(readRequestMessage(error) ?? "Não foi possível carregar o FAC.");
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

  function updateSetting<K extends keyof FivemFacSettings>(key: K, value: FivemFacSettings[K]) {
    setSettings((current) => ({
      ...current,
      [key]: value
    }));
  }

  function updateMessage(key: keyof FivemFacMessages, value: string) {
    setSettings((current) => ({
      ...current,
      messages: {
        ...current.messages,
        [key]: value
      }
    }));
  }

  function toggleRole(key: "viewerRoleIds" | "approverRoleIds" | "memberRoleIds", roleId: string) {
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

  function updateAbsence(updatedAbsence: FivemFacAbsence) {
    setAbsences((current) => current.map((absence) => (
      absence.id === updatedAbsence.id ? updatedAbsence : absence
    )));
  }

  async function handleSave() {
    if (!botId || !guild) return;

    setSaving(true);
    setMessage(null);

    try {
      const saved = await saveFivemFacSettings(guild.id, botId, {
        absenceRoleId: settings.absenceRoleId,
        approverRoleIds: settings.approverRoleIds,
        enabled: settings.enabled,
        logChannelId: settings.logChannelId,
        memberRoleIds: settings.memberRoleIds,
        messages: settings.messages,
        panelChannelId: settings.panelChannelId,
        viewerRoleIds: settings.viewerRoleIds
      });
      setSettings(saved);
      setMessage("Configuração do FAC salva.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível salvar o FAC.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublishPanel() {
    if (!botId || !guild) return;

    setPublishing(true);
    setMessage(null);

    try {
      const saved = await publishFivemFacPanel(guild.id, botId);
      setSettings(saved);
      setMessage("Publicação do painel solicitada ao bot.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível publicar o painel FAC.");
    } finally {
      setPublishing(false);
    }
  }

  async function handleSyncOptions() {
    if (!botId || !guild) return;

    setSyncing(true);
    setMessage(null);

    try {
      const options = await getFivemFacOptions(guild.id, botId);

      setChannels(options.channels);
      setRoles(options.roles);
      setSettings((current) => pruneSettingsForOptions(current, options));
      setMessage("Cargos e canais sincronizados com o Discord. Revise e salve para gravar a configuração.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível sincronizar cargos e canais do Discord.");
    } finally {
      setSyncing(false);
    }
  }

  if (!canUse) {
    return (
      <Card>
        <CardContent className="flex min-h-40 items-center justify-center p-6 text-sm text-zinc-500">
          Selecione um bot e um servidor para configurar o FiveM FAC.
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

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <Card className="hover:translate-y-0">
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-zinc-300" />
                  FiveM FAC
                </CardTitle>
                <CardDescription>Ausências para facções e organizações.</CardDescription>
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
                icon={ShieldCheck}
                label="Cargo de ausencia"
                onChange={(value) => updateSetting("absenceRoleId", value)}
                options={assignableRoles.map((role) => ({ label: role.name, value: role.id }))}
                value={settings.absenceRoleId}
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

            <RoleChecklist
              disabled={!canManage}
              label="Cargos de membros"
              onToggle={(roleId) => toggleRole("memberRoleIds", roleId)}
              roles={regularRoles}
              selectedRoleIds={settings.memberRoleIds}
            />

            <RoleChecklist
              disabled={!canManage}
              label="Cargos que visualizam canais"
              onToggle={(roleId) => toggleRole("viewerRoleIds", roleId)}
              roles={regularRoles}
              selectedRoleIds={settings.viewerRoleIds}
            />

            <RoleChecklist
              disabled={!canManage}
              label="Cargos aprovadores"
              onToggle={(roleId) => toggleRole("approverRoleIds", roleId)}
              roles={regularRoles}
              selectedRoleIds={settings.approverRoleIds}
            />

            <div className="grid gap-3">
              <TextField disabled={!canManage} label="Titulo do painel" onChange={(value) => updateMessage("panelTitle", value)} value={settings.messages.panelTitle} />
              <TextareaField disabled={!canManage} label="Descrição do painel" onChange={(value) => updateMessage("panelDescription", value)} value={settings.messages.panelDescription} />
              <div className="grid gap-3 md:grid-cols-2">
                <TextField disabled={!canManage} label="Mensagem aprovada" onChange={(value) => updateMessage("approved", value)} value={settings.messages.approved} />
                <TextField disabled={!canManage} label="Mensagem reprovada" onChange={(value) => updateMessage("rejected", value)} value={settings.messages.rejected} />
                <TextField disabled={!canManage} label="Mensagem iniciada" onChange={(value) => updateMessage("started", value)} value={settings.messages.started} />
                <TextField disabled={!canManage} label="Mensagem finalizada" onChange={(value) => updateMessage("finished", value)} value={settings.messages.finished} />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-zinc-900 pt-4">
              <Button disabled={!canManage || syncing} onClick={() => void handleSyncOptions()} variant="outline">
                {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Sincronizar Discord
              </Button>
              <Button disabled={!canManage || saving} onClick={() => void handleSave()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Salvar FAC
              </Button>
              <Button disabled={!canManage || publishing || !settings.enabled || !settings.panelChannelId} onClick={() => void handlePublishPanel()} variant="outline">
                {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Enviar painel
              </Button>
              {settings.panelMessageId ? <Badge variant="success">Painel publicado</Badge> : <Badge variant="muted">Painel não publicado</Badge>}
            </div>
          </CardContent>
        </Card>

        <Card className="hover:translate-y-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-zinc-300" />
              Ausencias
            </CardTitle>
            <CardDescription>{absences.length} registro(s) recentes.</CardDescription>
          </CardHeader>
          <CardContent>
            {absences.length ? (
              <div className="space-y-3">
                {absences.map((absence) => (
                  <AbsenceRow
                    absence={absence}
                    botId={botId}
                    canManage={canManage}
                    guildId={guild?.id ?? ""}
                    key={absence.id}
                    onUpdated={updateAbsence}
                  />
                ))}
              </div>
            ) : (
              <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 text-sm text-zinc-500">
                Nenhuma ausencia registrada.
              </div>
            )}
          </CardContent>
        </Card>
      </section>
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

function AbsenceRow({
  absence,
  botId,
  canManage,
  guildId,
  onUpdated
}: {
  absence: FivemFacAbsence;
  botId?: string | null;
  canManage: boolean;
  guildId: string;
  onUpdated: (absence: FivemFacAbsence) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  const [photoSaving, setPhotoSaving] = useState(false);
  const currentPhotoUrl = previewUrl ?? absence.photoUrl;

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [selectedFile]);

  function handleSelectPhoto(file: File | null) {
    setPhotoMessage(null);

    if (!file) {
      return;
    }

    if (!FAC_PHOTO_TYPES.has(file.type)) {
      setPhotoMessage("Formato invalido. Envie PNG, JPG, JPEG, WEBP ou GIF.");
      return;
    }

    if (file.size > FAC_PHOTO_MAX_SIZE) {
      setPhotoMessage("A foto deve ter no maximo 10 MB.");
      return;
    }

    setSelectedFile(file);
  }

  async function handleSavePhoto() {
    if (!botId || !selectedFile) return;

    setPhotoSaving(true);
    setPhotoMessage(null);

    try {
      const updated = await uploadFivemFacAbsencePhoto(guildId, botId, absence.id, selectedFile);
      onUpdated(updated);
      setSelectedFile(null);
      setPhotoMessage("Foto salva e enviada para atualizar a embed no Discord.");
    } catch (error) {
      setPhotoMessage(readRequestMessage(error) ?? "Não foi possível salvar a foto.");
    } finally {
      setPhotoSaving(false);
    }
  }

  async function handleRemoveSavedPhoto() {
    if (!botId) return;

    setPhotoSaving(true);
    setPhotoMessage(null);

    try {
      const updated = await removeFivemFacAbsencePhoto(guildId, botId, absence.id);
      onUpdated(updated);
      setSelectedFile(null);
      setPhotoMessage("Foto removida da embed no Discord.");
    } catch (error) {
      setPhotoMessage(readRequestMessage(error) ?? "Não foi possível remover a foto.");
    } finally {
      setPhotoSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-900 bg-zinc-950/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">{absence.username ?? absence.userId}</p>
          <p className="mt-1 truncate text-xs text-zinc-500">{absence.reason}</p>
        </div>
        <Badge variant={statusVariant(absence.status)}>{statusLabel(absence.status)}</Badge>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-zinc-500 sm:grid-cols-2">
        <span>Inicio: {formatDateOnly(absence.startDate)}</span>
        <span>Termino: {formatDateOnly(absence.endDate)}</span>
      </div>
      <div className="mt-3 border-t border-zinc-900 pt-3">
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
          <Camera className="h-3.5 w-3.5 text-zinc-500" />
          Foto da Ausencia
        </div>
        {currentPhotoUrl ? (
          <div className="mt-2 overflow-hidden rounded-md border border-zinc-900 bg-zinc-950">
            <img alt="Foto da ausencia" className="h-32 w-full object-cover" src={currentPhotoUrl} />
          </div>
        ) : (
          <div className="mt-2 flex h-24 items-center justify-center rounded-md border border-dashed border-zinc-800 bg-zinc-950 text-xs text-zinc-600">
            <ImageIcon className="mr-2 h-4 w-4" />
            Nenhuma foto enviada.
          </div>
        )}
        {canManage ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
              className="hidden"
              onChange={(event) => {
                handleSelectPhoto(event.target.files?.[0] ?? null);
                event.currentTarget.value = "";
              }}
              ref={inputRef}
              type="file"
            />
            <Button disabled={photoSaving} onClick={() => inputRef.current?.click()} size="sm" variant="outline">
              <ImageIcon className="h-4 w-4" />
              Selecionar Foto
            </Button>
            {selectedFile ? (
              <>
                <Button disabled={photoSaving} onClick={() => void handleSavePhoto()} size="sm">
                  {photoSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Salvar Foto
                </Button>
                <Button disabled={photoSaving} onClick={() => setSelectedFile(null)} size="sm" variant="outline">
                  <Trash2 className="h-4 w-4" />
                  Remover
                </Button>
              </>
            ) : absence.photoUrl ? (
              <Button disabled={photoSaving} onClick={() => void handleRemoveSavedPhoto()} size="sm" variant="outline">
                {photoSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Remover Foto
              </Button>
            ) : null}
          </div>
        ) : null}
        {photoMessage ? <p className="mt-2 text-xs text-zinc-400">{photoMessage}</p> : null}
      </div>
    </div>
  );
}

function statusVariant(status: FivemFacAbsenceStatus) {
  if (status === "active" || status === "approved") return "success";
  if (status === "rejected") return "danger";
  return "muted";
}

function statusLabel(status: FivemFacAbsenceStatus) {
  const labels: Record<FivemFacAbsenceStatus, string> = {
    active: "Ativa",
    approved: "Aprovada",
    closed: "Encerrada",
    finished: "Finalizada",
    pending: "Pendente",
    rejected: "Reprovada"
  };

  return labels[status];
}

function formatDateOnly(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function pruneSettingsForOptions(settings: FivemFacSettings, options: GuildLiveOptions): FivemFacSettings {
  const channelIds = new Set(options.channels.map((channel) => channel.id));
  const roleIds = new Set(options.roles.map((role) => role.id));

  return {
    ...settings,
    absenceRoleId: settings.absenceRoleId && roleIds.has(settings.absenceRoleId) ? settings.absenceRoleId : null,
    approverRoleIds: settings.approverRoleIds.filter((roleId) => roleIds.has(roleId)),
    logChannelId: settings.logChannelId && channelIds.has(settings.logChannelId) ? settings.logChannelId : null,
    memberRoleIds: settings.memberRoleIds.filter((roleId) => roleIds.has(roleId)),
    panelChannelId: settings.panelChannelId && channelIds.has(settings.panelChannelId) ? settings.panelChannelId : null,
    viewerRoleIds: settings.viewerRoleIds.filter((roleId) => roleIds.has(roleId))
  };
}

function readRequestMessage(error: unknown) {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return null;
  }

  const response = (error as { response?: { data?: { message?: unknown } } }).response;
  return typeof response?.data?.message === "string" ? response.data.message : null;
}

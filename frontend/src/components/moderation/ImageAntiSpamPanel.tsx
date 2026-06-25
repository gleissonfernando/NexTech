import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Clock3,
  Hash,
  ImageOff,
  Loader2,
  Save,
  Server,
  ShieldCheck,
  UserRoundX
} from "lucide-react";
import {
  getGuildLiveOptions,
  getImageAntiSpam,
  saveImageAntiSpamSettings
} from "../../lib/api";
import { createDashboardSocket } from "../../lib/socket";
import type {
  DashboardBot,
  DashboardGuild,
  GuildChannelOption,
  GuildRoleOption,
  ImageAntiSpamIncident,
  ImageAntiSpamSettings,
  ImageAntiSpamUser
} from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

type ImageAntiSpamPanelProps = {
  bot: DashboardBot | null;
  botId: string | null;
  bots: DashboardBot[];
  canManage: boolean;
  guild: DashboardGuild | null;
  guilds: DashboardGuild[];
  onSelectBot: (botId: string) => void;
  onSelectGuild: (guildId: string) => void;
};

const emptySettings: ImageAntiSpamSettings = {
  id: "",
  botId: "",
  guildId: "",
  enabled: false,
  logChannelId: null,
  immuneRoleIds: [],
  ignoredChannelIds: [],
  maxImages: 1,
  windowSeconds: 10,
  warningsEnabled: true,
  progressiveTimeoutEnabled: true,
  autoKickEnabled: true,
  maxWarnings: 5,
  ignoreAdministrators: true,
  warningResetDays: 30,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

export function ImageAntiSpamPanel({
  bot,
  botId,
  bots,
  canManage,
  guild,
  guilds,
  onSelectBot,
  onSelectGuild
}: ImageAntiSpamPanelProps) {
  const [settings, setSettings] = useState<ImageAntiSpamSettings>(emptySettings);
  const [users, setUsers] = useState<ImageAntiSpamUser[]>([]);
  const [incidents, setIncidents] = useState<ImageAntiSpamIncident[]>([]);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const selectableRoles = useMemo(
    () => roles.filter((role) => role.id !== guild?.id && !role.managed),
    [guild?.id, roles]
  );

  useEffect(() => {
    let mounted = true;

    async function load() {
      if (!botId || !guild) {
        setSettings(emptySettings);
        setUsers([]);
        setIncidents([]);
        setChannels([]);
        setRoles([]);
        return;
      }

      setLoading(true);
      setMessage(null);
      const [dashboard, options] = await Promise.all([
        getImageAntiSpam(guild.id, botId),
        getGuildLiveOptions(guild.id, botId)
      ]);

      if (!mounted) return;

      setSettings(dashboard.settings);
      setUsers(dashboard.users);
      setIncidents(dashboard.incidents);
      setChannels(options.channels);
      setRoles(options.roles);
    }

    load()
      .catch((error) => {
        if (mounted) {
          setMessage(readRequestMessage(error) ?? "Nao foi possivel carregar o Anti-Spam de Imagens.");
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

  useEffect(() => {
    if (!botId || !guild) {
      return;
    }

    const socket = createDashboardSocket();

    socket.on("image-anti-spam:settings_updated", (nextSettings: ImageAntiSpamSettings) => {
      if (nextSettings.botId !== botId || nextSettings.guildId !== guild.id) {
        return;
      }

      setSettings(nextSettings);
      setMessage("Configuracao sincronizada em tempo real.");
    });

    socket.on("image-anti-spam:incident", (incident: ImageAntiSpamIncident) => {
      if (incident.botId !== botId || incident.guildId !== guild.id) {
        return;
      }

      setIncidents((current) => {
        const exists = current.some((item) => item.id === incident.id);
        return exists
          ? current.map((item) => item.id === incident.id ? incident : item)
          : [incident, ...current].slice(0, 25);
      });
      setUsers((current) => upsertIncidentUser(current, incident));
    });

    return () => {
      socket.disconnect();
    };
  }, [botId, guild?.id]);

  function updateSetting<K extends keyof ImageAntiSpamSettings>(
    key: K,
    value: ImageAntiSpamSettings[K]
  ) {
    setSettings((current) => ({
      ...current,
      [key]: value
    }));
  }

  function toggleId(key: "immuneRoleIds" | "ignoredChannelIds", id: string) {
    setSettings((current) => {
      const selected = new Set(current[key]);

      if (selected.has(id)) {
        selected.delete(id);
      } else {
        selected.add(id);
      }

      return {
        ...current,
        [key]: [...selected]
      };
    });
  }

  async function handleSave() {
    if (!botId || !guild) return;

    setSaving(true);
    setMessage(null);

    try {
      const saved = await saveImageAntiSpamSettings(guild.id, botId, {
        enabled: settings.enabled,
        logChannelId: settings.logChannelId,
        immuneRoleIds: settings.immuneRoleIds,
        ignoredChannelIds: settings.ignoredChannelIds,
        maxImages: settings.maxImages,
        windowSeconds: settings.windowSeconds,
        warningsEnabled: settings.warningsEnabled,
        progressiveTimeoutEnabled: settings.progressiveTimeoutEnabled,
        autoKickEnabled: settings.autoKickEnabled,
        maxWarnings: settings.maxWarnings,
        ignoreAdministrators: settings.ignoreAdministrators,
        warningResetDays: settings.warningResetDays
      });

      setSettings(saved);
      setMessage("Configuracao do Anti-Spam de Imagens salva.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Nao foi possivel salvar o Anti-Spam de Imagens.");
    } finally {
      setSaving(false);
    }
  }

  if (!botId || !guild) {
    return (
      <Card>
        <CardContent className="flex min-h-40 items-center justify-center p-6 text-sm text-zinc-500">
          Escolha um bot e um servidor para configurar o Anti-Spam de Imagens.
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

      <Card className="hover:translate-y-0">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ImageOff className="h-5 w-5 text-purple-300" />
                Anti-Spam de Imagens
              </CardTitle>
              <CardDescription>
                Mantem as primeiras midias permitidas e remove automaticamente todo flood excedente.
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={settings.enabled ? "success" : "muted"}>
                {settings.enabled ? "Sistema ativo" : "Sistema inativo"}
              </Badge>
              <Switch
                checked={settings.enabled}
                disabled={!canManage || saving}
                onCheckedChange={(checked) => updateSetting("enabled", checked)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 md:grid-cols-2">
            <ContextSelect
              icon={Bot}
              label="Escolher Bot"
              onChange={onSelectBot}
              options={bots.map((item) => ({ label: item.name, value: item.id }))}
              value={bot?.id ?? botId}
            />
            <ContextSelect
              icon={Server}
              label="Escolher Servidor"
              onChange={onSelectGuild}
              options={guilds.map((item) => ({ label: item.name, value: item.id }))}
              value={guild.id}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <NumberField
              disabled={!canManage}
              label="Quantidade maxima de midias"
              max={20}
              min={1}
              onChange={(value) => updateSetting("maxImages", value)}
              value={settings.maxImages}
            />
            <NumberField
              disabled={!canManage}
              label="Tempo de verificacao (segundos)"
              max={3_600}
              min={1}
              onChange={(value) => updateSetting("windowSeconds", value)}
              value={settings.windowSeconds}
            />
            <NumberField
              disabled={!canManage}
              label="Quantidade maxima de advertencias"
              max={20}
              min={1}
              onChange={(value) => updateSetting("maxWarnings", value)}
              value={settings.maxWarnings}
            />
            <NumberField
              disabled={!canManage}
              label="Reiniciar advertencias apos (dias)"
              max={3_650}
              min={1}
              onChange={(value) => updateSetting("warningResetDays", value)}
              value={settings.warningResetDays}
            />
          </div>

          <label className="grid gap-2 text-sm">
            <span className="font-medium text-zinc-200">Canal de logs e punicoes</span>
            <select
              className="h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-purple-500/60"
              disabled={!canManage}
              onChange={(event) => updateSetting("logChannelId", event.target.value || null)}
              value={settings.logChannelId ?? ""}
            >
              <option value="">Sem canal selecionado</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>#{channel.name}</option>
              ))}
            </select>
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <ToggleField
              checked={settings.warningsEnabled}
              disabled={!canManage}
              label="Ativar advertencias"
              onChange={(checked) => updateSetting("warningsEnabled", checked)}
            />
            <ToggleField
              checked={settings.progressiveTimeoutEnabled}
              disabled={!canManage || !settings.warningsEnabled}
              label="Ativar timeout progressivo"
              onChange={(checked) => updateSetting("progressiveTimeoutEnabled", checked)}
            />
            <ToggleField
              checked={settings.autoKickEnabled}
              disabled={!canManage || !settings.warningsEnabled}
              label="Ativar expulsao automatica"
              onChange={(checked) => updateSetting("autoKickEnabled", checked)}
            />
            <ToggleField
              checked={settings.ignoreAdministrators}
              disabled={!canManage}
              label="Ignorar administradores"
              onChange={(checked) => updateSetting("ignoreAdministrators", checked)}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Checklist
              disabled={!canManage}
              emptyText="Nenhum cargo disponivel."
              icon={ShieldCheck}
              items={selectableRoles.map((role) => ({ id: role.id, label: role.name }))}
              label="Cargos imunes"
              onToggle={(id) => toggleId("immuneRoleIds", id)}
              selectedIds={settings.immuneRoleIds}
            />
            <Checklist
              disabled={!canManage}
              emptyText="Nenhum canal disponivel."
              icon={Hash}
              items={channels.map((channel) => ({ id: channel.id, label: `#${channel.name}` }))}
              label="Canais Permitidos para Foto"
              onToggle={(id) => toggleId("ignoredChannelIds", id)}
              selectedIds={settings.ignoredChannelIds}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-zinc-900 pt-4">
            <Button disabled={!canManage || saving} onClick={() => void handleSave()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar configuracao
            </Button>
            <p className="text-xs text-zinc-500">
              A configuracao e aplicada ao bot selecionado em tempo real.
            </p>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-5 xl:grid-cols-2">
        <Card className="hover:translate-y-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserRoundX className="h-5 w-5 text-zinc-300" />
              Advertencias por usuario
            </CardTitle>
            <CardDescription>{users.length} usuario(s) com historico recente.</CardDescription>
          </CardHeader>
          <CardContent>
            <UserHistory users={users} />
          </CardContent>
        </Card>

        <Card className="hover:translate-y-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock3 className="h-5 w-5 text-zinc-300" />
              Historico de punicoes
            </CardTitle>
            <CardDescription>{incidents.length} incidente(s) recente(s).</CardDescription>
          </CardHeader>
          <CardContent>
            <IncidentHistory incidents={incidents} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function ContextSelect({
  icon: Icon,
  label,
  onChange,
  options,
  value
}: {
  icon: typeof Bot;
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string | null;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
      <p className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-zinc-500">
        <Icon className="h-4 w-4" />
        {label}
      </p>
      <select
        className="mt-2 h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm font-medium text-zinc-100 outline-none focus:border-purple-500/60"
        onChange={(event) => onChange(event.target.value)}
        value={value ?? ""}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
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
    <label className="grid gap-2 text-sm">
      <span className="font-medium text-zinc-200">{label}</span>
      <input
        className="h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-purple-500/60"
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

function ToggleField({
  checked,
  disabled,
  label,
  onChange
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/70 px-4 py-3">
      <span className="text-sm font-medium text-zinc-200">{label}</span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

function Checklist({
  disabled,
  emptyText,
  icon: Icon,
  items,
  label,
  onToggle,
  selectedIds
}: {
  disabled: boolean;
  emptyText: string;
  icon: typeof ShieldCheck;
  items: Array<{ id: string; label: string }>;
  label: string;
  onToggle: (id: string) => void;
  selectedIds: string[];
}) {
  const selected = new Set(selectedIds);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
      <p className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-200">
        <Icon className="h-4 w-4 text-zinc-400" />
        {label}
      </p>
      <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
        {items.length ? items.map((item) => (
          <label
            className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-zinc-900 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-700"
            key={item.id}
          >
            <span className="truncate">{item.label}</span>
            <input
              checked={selected.has(item.id)}
              disabled={disabled}
              onChange={() => onToggle(item.id)}
              type="checkbox"
            />
          </label>
        )) : (
          <p className="py-4 text-center text-sm text-zinc-600">{emptyText}</p>
        )}
      </div>
    </div>
  );
}

function UserHistory({ users }: { users: ImageAntiSpamUser[] }) {
  if (!users.length) {
    return <p className="py-8 text-center text-sm text-zinc-600">Nenhuma advertencia registrada.</p>;
  }

  return (
    <div className="space-y-2">
      {users.map((user) => (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-900 bg-zinc-950/60 p-3" key={user.id}>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-zinc-100">{user.username ?? user.userId}</p>
            <p className="text-xs text-zinc-500">
              {user.totalImagesRemoved} midia(s) removida(s)
              {user.lastInfractionAt ? ` - ${formatDate(user.lastInfractionAt)}` : ""}
            </p>
          </div>
          <Badge variant={user.warningCount >= 5 ? "danger" : "muted"}>
            {user.warningCount} advertencia(s)
          </Badge>
        </div>
      ))}
    </div>
  );
}

function IncidentHistory({ incidents }: { incidents: ImageAntiSpamIncident[] }) {
  if (!incidents.length) {
    return <p className="py-8 text-center text-sm text-zinc-600">Nenhuma punicao registrada.</p>;
  }

  return (
    <div className="space-y-2">
      {incidents.map((incident) => (
        <div className="rounded-lg border border-zinc-900 bg-zinc-950/60 p-3" key={incident.id}>
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-medium text-zinc-100">
              {incident.username ?? incident.userId}
            </p>
            <Badge variant={incident.action === "kick" ? "danger" : incident.status === "failed" ? "warning" : "muted"}>
              {actionLabel(incident)}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {incident.removedMessages} mensagem(ns), {incident.removedImages} midia(s) - advertencia {incident.warningCount} - {formatDate(incident.createdAt)}
          </p>
          <p className="mt-1 truncate text-xs text-zinc-600">
            {formatMediaTypes(incident.mediaTypes)}
            {incident.channelIds.length ? ` - ${incident.channelIds.map((channelId) => `#${channelId}`).join(", ")}` : ""}
          </p>
          {incident.actionError ? <p className="mt-1 text-xs text-red-300">{incident.actionError}</p> : null}
        </div>
      ))}
    </div>
  );
}

function actionLabel(incident: ImageAntiSpamIncident) {
  if (incident.action === "kick") return "Expulsao";
  if (incident.action === "timeout") return `${Math.round(incident.timeoutMs / 60_000)} min`;
  if (incident.action === "warning") return "Advertencia";
  return "Remocao";
}

function upsertIncidentUser(users: ImageAntiSpamUser[], incident: ImageAntiSpamIncident) {
  const now = incident.updatedAt;
  const current = users.find((user) => user.userId === incident.userId);

  if (!current) {
    return [
      {
        id: `${incident.guildId}:${incident.userId}`,
        botId: incident.botId,
        guildId: incident.guildId,
        userId: incident.userId,
        username: incident.username,
        warningCount: incident.warningCount,
        totalImagesRemoved: incident.removedImages,
        lastInfractionAt: now,
        lastPunishment: incident.action,
        createdAt: incident.createdAt,
        updatedAt: now
      },
      ...users
    ].slice(0, 25);
  }

  return users.map((user) => user.userId === incident.userId
    ? {
        ...user,
        username: incident.username ?? user.username,
        warningCount: incident.warningCount,
        totalImagesRemoved: Math.max(user.totalImagesRemoved, incident.removedImages),
        lastInfractionAt: now,
        lastPunishment: incident.action,
        updatedAt: now
      }
    : user);
}

function formatMediaTypes(mediaTypes: string[]) {
  if (!mediaTypes.length) {
    return "Midia";
  }

  const labels: Record<string, string> = {
    attachment: "Anexos",
    embed: "Embeds",
    gif: "GIFs",
    image: "Imagens",
    sticker: "Stickers"
  };

  return mediaTypes.map((type) => labels[type] ?? type).join(", ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function readRequestMessage(error: unknown) {
  if (!error || typeof error !== "object" || !("response" in error)) {
    return null;
  }

  const response = (error as { response?: { data?: { message?: unknown } } }).response;
  return typeof response?.data?.message === "string" ? response.data.message : null;
}

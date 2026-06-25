import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Bot,
  Database,
  Hash,
  ImageOff,
  Link2,
  ListChecks,
  Loader2,
  Save,
  ScrollText,
  Server,
  ShieldCheck,
  Trash2,
  UserRoundX,
  Zap
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createDashboardSocket } from "../../lib/socket";
import {
  getGuildLiveOptions,
  getGuildRoleOptions,
  patchGuildSettings,
  getSelfBotProtection,
  saveSelfBotProtectionSettings
} from "../../lib/api";
import type {
  DashboardBot,
  DashboardGuild,
  GuildChannelOption,
  GuildRoleOption,
  GuildSettings,
  SelfBotProtectionIncident,
  SelfBotProtectionModuleId,
  SelfBotProtectionSettings,
  SelfBotProtectionStats,
  SelfBotPunishmentAction,
  SelfBotPunishmentStep
} from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

type SelfBotProtectionPanelProps = {
  bot: DashboardBot | null;
  botId: string | null;
  bots: DashboardBot[];
  canManage: boolean;
  guild: DashboardGuild | null;
  guilds: DashboardGuild[];
  guildSettings: GuildSettings | null;
  onGuildSettingsChange: (settings: GuildSettings) => void;
  onSelectBot: (botId: string) => void;
  onSelectGuild: (guildId: string) => void;
};

type ModuleDefinition = {
  id: SelfBotProtectionModuleId;
  label: string;
};

const modules: ModuleDefinition[] = [
  { id: "anti-spam", label: "Anti Spam" },
  { id: "anti-flood", label: "Anti Flood" },
  { id: "anti-imagens", label: "Anti-Spam de Imagens" },
  { id: "anti-gif", label: "Anti GIF" },
  { id: "anti-mencoes", label: "Anti Mencoes" },
  { id: "anti-emojis", label: "Anti Emojis" },
  { id: "anti-convites", label: "Anti Convites" },
  { id: "anti-links", label: "Anti-Flood de Links" },
  { id: "anti-scam", label: "Anti Scam" },
  { id: "anti-raid", label: "Anti Raid" },
  { id: "anti-caps-lock", label: "Anti Caps Lock" },
  { id: "anti-texto-repetido", label: "Anti Texto Repetido" },
  { id: "anti-copypasta", label: "Anti Copypasta" },
  { id: "anti-flood-multi-canais", label: "Anti Flood Multi-Canais" },
  { id: "anti-anexos", label: "Anti Anexos" },
  { id: "anti-webhook", label: "Anti Webhook" },
  { id: "anti-bots", label: "Anti Bots" },
  { id: "anti-contas-novas", label: "Anti Contas Novas" },
  { id: "anti-token-grabber", label: "Anti Token Grabber" },
  { id: "anti-phishing", label: "Anti Phishing" },
  { id: "anti-nitro-scam", label: "Anti Nitro Scam" },
  { id: "anti-mass-ping", label: "Anti Mass Ping" },
  { id: "anti-divulgacao", label: "Anti Divulgacao" },
  { id: "anti-auto-spam", label: "Anti Auto Spam" },
  { id: "anti-comandos-em-massa", label: "Anti Comandos em Massa" }
];

const punishmentActions: Array<{ id: SelfBotPunishmentAction; label: string }> = [
  { id: "delete_message", label: "Apagar mensagem" },
  { id: "warn", label: "Advertir" },
  { id: "log", label: "Registrar" },
  { id: "add_role", label: "Castigar com cargo" },
  { id: "timeout", label: "Timeout" },
  { id: "remove_role", label: "Remover cargo" },
  { id: "kick", label: "Kick" },
  { id: "ban", label: "Ban" }
];

function defaultPunishmentSteps(): SelfBotPunishmentStep[] {
  return [
    createPunishmentStep("delete_message", 2, "warn", { apagarMensagem: true }),
    createPunishmentStep("warn", 1, "timeout", { enviarAviso: true }),
    createPunishmentStep("timeout", 2, "add_role", { tempoTimeout: { dias: 0, horas: 0, minutos: 5, segundos: 0 } }),
    createPunishmentStep("add_role", 1, "kick"),
    createPunishmentStep("kick", 1, "ban"),
    createPunishmentStep("ban", 1, null)
  ];
}

function createPunishmentStep(
  acao: SelfBotPunishmentAction,
  limite: number,
  proximaAcao: SelfBotPunishmentAction | null,
  overrides: Partial<SelfBotPunishmentStep> = {}
): SelfBotPunishmentStep {
  return {
    id: acao,
    acao,
    ativado: true,
    limite,
    proximaAcao,
    apagarMensagem: acao === "delete_message",
    enviarAviso: acao === "warn",
    registrarLog: true,
    tempoTimeout: { dias: 0, horas: 0, minutos: 5, segundos: 0 },
    cargoAdicionarId: null,
    cargoRemoverId: null,
    banApagarMensagensSegundos: 3600,
    ...overrides
  };
}

const emptySettings: SelfBotProtectionSettings = {
  id: "",
  botId: "",
  guildId: "",
  enabled: false,
  moduleToggles: {
    ...Object.fromEntries(modules.map((module) => [module.id, false])) as Record<SelfBotProtectionModuleId, boolean>,
    "anti-anexos": true,
    "anti-auto-spam": true,
    "anti-convites": true,
    "anti-flood": true,
    "anti-flood-multi-canais": true,
    "anti-gif": true,
    "anti-imagens": true,
    "anti-links": true,
    "anti-mencoes": true,
    "anti-spam": true,
    "anti-texto-repetido": true
  },
  ignoredChannelIds: [],
  protectedChannelIds: [],
  mediaChannelIds: [],
  linkChannelIds: [],
  logChannelId: null,
  punishmentLogChannelId: null,
  logWebhookUrl: null,
  embedColor: "#7c3aed",
  punishmentSequence: ["delete_message", "add_role", "log"],
  punishmentSteps: defaultPunishmentSteps(),
  addRoleId: null,
  removeRoleId: null,
  timeoutSeconds: 300,
  floodLimit: 5,
  floodWindowSeconds: 10,
  imageLimit: 3,
  imageWindowSeconds: 15,
  mentionLimit: 5,
  emojiLimit: 12,
  capsMinLength: 12,
  capsPercentage: 70,
  repeatedTextLimit: 3,
  repeatedTextWindowSeconds: 60,
  multiChannelLimit: 4,
  multiChannelWindowSeconds: 15,
  raidJoinLimit: 8,
  raidWindowSeconds: 30,
  newAccountMaxAgeHours: 72,
  suspiciousDomains: [],
  blockedTerms: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const emptyStats: SelfBotProtectionStats = {
  blockedSpam: 0,
  removedImages: 0,
  blockedLinks: 0,
  punishedUsers: 0,
  infractionsToday: 0,
  infractionsWeek: 0,
  infractionsMonth: 0,
  byModule: [],
  daily: []
};

export function SelfBotProtectionPanel({
  bot,
  botId,
  bots,
  canManage,
  guild,
  guilds,
  guildSettings,
  onGuildSettingsChange,
  onSelectBot,
  onSelectGuild
}: SelfBotProtectionPanelProps) {
  const [settings, setSettings] = useState<SelfBotProtectionSettings>(emptySettings);
  const [stats, setStats] = useState<SelfBotProtectionStats>(emptyStats);
  const [incidents, setIncidents] = useState<SelfBotProtectionIncident[]>([]);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const selectedModules = useMemo(
    () => modules.filter((module) => settings.moduleToggles[module.id]).length,
    [settings.moduleToggles]
  );
  const selectableRoles = useMemo(
    () => roles.filter((role) => role.id !== guild?.id && !role.managed),
    [guild?.id, roles]
  );

  useEffect(() => {
    let mounted = true;

    async function load() {
      if (!botId || !guild) {
        setSettings(emptySettings);
        setStats(emptyStats);
        setIncidents([]);
        setChannels([]);
        setRoles([]);
        return;
      }

      setLoading(true);
      setMessage(null);
      const [dashboard, options, roleOptions] = await Promise.all([
        getSelfBotProtection(guild.id, botId),
        getGuildLiveOptions(guild.id, botId),
        getGuildRoleOptions(guild.id, botId)
      ]);

      if (!mounted) return;

      setSettings(dashboard.settings);
      setStats(dashboard.stats);
      setIncidents(dashboard.incidents);
      setChannels(options.channels);
      setRoles(roleOptions);
    }

    load()
      .catch((error) => {
        if (mounted) {
          setMessage(readRequestMessage(error) ?? "Nao foi possivel carregar o SelfBot Protection.");
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

    socket.on("self-bot-protection:settings_updated", (nextSettings: SelfBotProtectionSettings) => {
      if (nextSettings.botId === botId && nextSettings.guildId === guild.id) {
        setSettings(nextSettings);
      }
    });

    socket.on("settings:updated", (nextSettings: GuildSettings) => {
      if (nextSettings.guildId === guild.id && (nextSettings.botId ?? null) === botId) {
        onGuildSettingsChange(nextSettings);
      }
    });

    socket.on("self-bot-protection:incident", (incident: SelfBotProtectionIncident) => {
      if (incident.botId !== botId || incident.guildId !== guild.id) {
        return;
      }

      setIncidents((current) => {
        if (current.some((item) => item.id === incident.id)) {
          return current;
        }

        const knownUser = current.some((item) => item.userId === incident.userId);
        setStats((currentStats) => incrementStats(currentStats, incident, knownUser));
        return [incident, ...current].slice(0, 50);
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [botId, guild, onGuildSettingsChange]);

  function updateSetting<K extends keyof SelfBotProtectionSettings>(
    key: K,
    value: SelfBotProtectionSettings[K]
  ) {
    setSettings((current) => ({
      ...current,
      [key]: value
    }));
  }

  function toggleModule(moduleId: SelfBotProtectionModuleId, enabled: boolean) {
    setSettings((current) => ({
      ...current,
      moduleToggles: {
        ...current.moduleToggles,
        [moduleId]: enabled
      }
    }));
  }

  function toggleId(key: "ignoredChannelIds" | "protectedChannelIds" | "mediaChannelIds" | "linkChannelIds", id: string) {
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

  function togglePunishment(action: SelfBotPunishmentAction) {
    setSettings((current) => {
      const exists = current.punishmentSequence.includes(action);

      return {
        ...current,
        punishmentSequence: exists
          ? current.punishmentSequence.filter((item) => item !== action)
          : [...current.punishmentSequence, action]
      };
    });
  }

  function movePunishment(action: SelfBotPunishmentAction, direction: -1 | 1) {
    setSettings((current) => {
      const items = [...current.punishmentSequence];
      const index = items.indexOf(action);
      const nextIndex = index + direction;

      if (index < 0 || nextIndex < 0 || nextIndex >= items.length) {
        return current;
      }

      const [item] = items.splice(index, 1);
      if (!item) {
        return current;
      }
      items.splice(nextIndex, 0, item);

      return {
        ...current,
        punishmentSequence: items
      };
    });
  }

  function updatePunishmentStep(index: number, patch: Partial<SelfBotPunishmentStep>) {
    setSettings((current) => ({
      ...current,
      punishmentSteps: current.punishmentSteps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step)
    }));
  }

  function updatePunishmentDuration(index: number, key: keyof SelfBotPunishmentStep["tempoTimeout"], value: number) {
    setSettings((current) => ({
      ...current,
      punishmentSteps: current.punishmentSteps.map((step, stepIndex) => stepIndex === index
        ? {
            ...step,
            tempoTimeout: {
              ...step.tempoTimeout,
              [key]: value
            }
          }
        : step)
    }));
  }

  async function handleSave() {
    if (!botId || !guild) return;

    setSaving(true);
    setMessage(null);

    try {
      const saved = await saveSelfBotProtectionSettings(guild.id, botId, {
        addRoleId: settings.addRoleId,
        blockedTerms: settings.blockedTerms,
        capsMinLength: settings.capsMinLength,
        capsPercentage: settings.capsPercentage,
        embedColor: settings.embedColor,
        emojiLimit: settings.emojiLimit,
        enabled: settings.enabled,
        floodLimit: settings.floodLimit,
        floodWindowSeconds: settings.floodWindowSeconds,
        ignoredChannelIds: settings.ignoredChannelIds,
        imageLimit: settings.imageLimit,
        imageWindowSeconds: settings.imageWindowSeconds,
        linkChannelIds: settings.linkChannelIds,
        logChannelId: settings.logChannelId,
        punishmentLogChannelId: settings.punishmentLogChannelId,
        logWebhookUrl: settings.logWebhookUrl,
        mediaChannelIds: settings.mediaChannelIds,
        mentionLimit: settings.mentionLimit,
        moduleToggles: settings.moduleToggles,
        multiChannelLimit: settings.multiChannelLimit,
        multiChannelWindowSeconds: settings.multiChannelWindowSeconds,
        newAccountMaxAgeHours: settings.newAccountMaxAgeHours,
        protectedChannelIds: settings.protectedChannelIds,
        punishmentSequence: settings.punishmentSequence,
        punishmentSteps: settings.punishmentSteps,
        raidJoinLimit: settings.raidJoinLimit,
        raidWindowSeconds: settings.raidWindowSeconds,
        removeRoleId: settings.removeRoleId,
        repeatedTextLimit: settings.repeatedTextLimit,
        repeatedTextWindowSeconds: settings.repeatedTextWindowSeconds,
        suspiciousDomains: settings.suspiciousDomains,
        timeoutSeconds: settings.timeoutSeconds
      });

      setSettings(saved);
      setMessage("SelfBot Protection salvo.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Nao foi possivel salvar o SelfBot Protection.");
    } finally {
      setSaving(false);
    }
  }

  if (!botId || !guild) {
    return (
      <Card>
        <CardContent className="flex min-h-40 items-center justify-center p-6 text-sm text-zinc-500">
          Escolha um bot e um servidor para configurar o SelfBot Protection.
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

  const disabled = !canManage || saving;
  const selfBotRole = selectableRoles.find((role) => role.id === guildSettings?.safeBotRoleId);

  return (
    <div className="space-y-5">
      {message ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100">
          {message}
        </div>
      ) : null}

      <Card className="hover:translate-y-0">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-black">
                <ShieldCheck className="h-5 w-5 text-zinc-200" />
              </div>
              <div>
                <CardTitle>SelfBot Protection</CardTitle>
                <CardDescription>{selectedModules} modulo(s) ativo(s)</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={settings.enabled ? "success" : "muted"}>
                {settings.enabled ? "Ativo" : "Inativo"}
              </Badge>
              <Switch
                checked={settings.enabled}
                disabled={disabled}
                onCheckedChange={(checked) => updateSetting("enabled", checked)}
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="grid gap-3 md:grid-cols-2">
            <ContextSelect
              icon={Bot}
              label="Bot"
              onChange={onSelectBot}
              options={bots.map((item) => ({ label: item.name, value: item.id }))}
              value={bot?.id ?? botId}
            />
            <ContextSelect
              icon={Server}
              label="Servidor"
              onChange={onSelectGuild}
              options={guilds.map((item) => ({ label: item.name, value: item.id }))}
              value={guild.id}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SelectField
              disabled={disabled}
              icon={ScrollText}
              label="Canal de logs"
              onChange={(value) => updateSetting("logChannelId", value || null)}
              options={channels.map((channel) => ({ label: `#${channel.name}`, value: channel.id }))}
              placeholder="Criar canal padrao"
              value={settings.logChannelId ?? ""}
            />
            <SelectField
              disabled={disabled}
              icon={UserRoundX}
              label="Canal de punicoes"
              onChange={(value) => updateSetting("punishmentLogChannelId", value || null)}
              options={channels.map((channel) => ({ label: `#${channel.name}`, value: channel.id }))}
              placeholder="Usar canal de logs"
              value={settings.punishmentLogChannelId ?? ""}
            />
            <div className="grid gap-2 text-sm">
              <span className="flex items-center gap-2 font-medium text-zinc-200">
                <ShieldCheck className="h-4 w-4 text-zinc-400" />
                Cargo Self Bot
              </span>
              <div className="flex h-11 items-center rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100">
                {guildSettings?.safeBotRoleId ? `@${selfBotRole?.name ?? "Self Bot"} (${guildSettings.safeBotRoleId})` : "Criado quando ativar"}
              </div>
            </div>
            <label className="grid gap-2 text-sm">
              <span className="flex items-center gap-2 font-medium text-zinc-200">
                <Zap className="h-4 w-4 text-zinc-400" />
                Cor da embed
              </span>
              <input
                className="h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-purple-500/60"
                disabled={disabled}
                onChange={(event) => updateSetting("embedColor", event.target.value)}
                type="color"
                value={settings.embedColor}
              />
            </label>
          </div>

          <StatsGrid stats={stats} />

          <Section icon={ListChecks} title="Modulos">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {modules.map((module) => (
                <ToggleRow
                  checked={settings.moduleToggles[module.id]}
                  disabled={disabled}
                  key={module.id}
                  label={module.label}
                  onChange={(checked) => toggleModule(module.id, checked)}
                />
              ))}
            </div>
          </Section>

          <Section icon={Hash} title="Canais">
            <div className="grid gap-4 lg:grid-cols-2">
              <Checklist
                disabled={disabled}
                emptyText="Nenhum canal disponivel."
                icon={Hash}
                items={channels.map((channel) => ({ id: channel.id, label: `#${channel.name}` }))}
                label="Canais ignorados"
                onToggle={(id) => toggleId("ignoredChannelIds", id)}
                selectedIds={settings.ignoredChannelIds}
              />
              <Checklist
                disabled={disabled}
                emptyText="Nenhum canal disponivel."
                icon={ShieldCheck}
                items={channels.map((channel) => ({ id: channel.id, label: `#${channel.name}` }))}
                label="Canais protegidos"
                onToggle={(id) => toggleId("protectedChannelIds", id)}
                selectedIds={settings.protectedChannelIds}
              />
              <Checklist
                disabled={disabled}
                emptyText="Nenhum canal disponivel."
                icon={ImageOff}
                items={channels.map((channel) => ({ id: channel.id, label: `#${channel.name}` }))}
                label="Canais permitidos para fotos"
                onToggle={(id) => toggleId("mediaChannelIds", id)}
                selectedIds={settings.mediaChannelIds}
              />
              <Checklist
                disabled={disabled}
                emptyText="Nenhum canal disponivel."
                icon={Link2}
                items={channels.map((channel) => ({ id: channel.id, label: `#${channel.name}` }))}
                label="Canais permitidos para links"
                onToggle={(id) => toggleId("linkChannelIds", id)}
                selectedIds={settings.linkChannelIds}
              />
            </div>
          </Section>

          <Section icon={Zap} title="Limites">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <NumberField disabled={disabled} label="Flood: quantidade" max={50} min={2} onChange={(value) => updateSetting("floodLimit", value)} value={settings.floodLimit} />
              <NumberField disabled={disabled} label="Flood: intervalo" max={3600} min={1} onChange={(value) => updateSetting("floodWindowSeconds", value)} value={settings.floodWindowSeconds} />
              <NumberField disabled={disabled} label="Imagens: limite" max={50} min={1} onChange={(value) => updateSetting("imageLimit", value)} value={settings.imageLimit} />
              <NumberField disabled={disabled} label="Imagens: janela" max={3600} min={1} onChange={(value) => updateSetting("imageWindowSeconds", value)} value={settings.imageWindowSeconds} />
              <NumberField disabled={disabled} label="Mencoes" max={100} min={1} onChange={(value) => updateSetting("mentionLimit", value)} value={settings.mentionLimit} />
              <NumberField disabled={disabled} label="Emojis" max={200} min={1} onChange={(value) => updateSetting("emojiLimit", value)} value={settings.emojiLimit} />
              <NumberField disabled={disabled} label="Caps: minimo" max={500} min={4} onChange={(value) => updateSetting("capsMinLength", value)} value={settings.capsMinLength} />
              <NumberField disabled={disabled} label="Caps: porcentagem" max={100} min={40} onChange={(value) => updateSetting("capsPercentage", value)} value={settings.capsPercentage} />
              <NumberField disabled={disabled} label="Texto repetido" max={25} min={2} onChange={(value) => updateSetting("repeatedTextLimit", value)} value={settings.repeatedTextLimit} />
              <NumberField disabled={disabled} label="Janela repeticao" max={3600} min={1} onChange={(value) => updateSetting("repeatedTextWindowSeconds", value)} value={settings.repeatedTextWindowSeconds} />
              <NumberField disabled={disabled} label="Multi-canais" max={100} min={2} onChange={(value) => updateSetting("multiChannelLimit", value)} value={settings.multiChannelLimit} />
              <NumberField disabled={disabled} label="Janela multi-canais" max={3600} min={1} onChange={(value) => updateSetting("multiChannelWindowSeconds", value)} value={settings.multiChannelWindowSeconds} />
              <NumberField disabled={disabled} label="Raid: entradas" max={500} min={2} onChange={(value) => updateSetting("raidJoinLimit", value)} value={settings.raidJoinLimit} />
              <NumberField disabled={disabled} label="Raid: janela" max={3600} min={5} onChange={(value) => updateSetting("raidWindowSeconds", value)} value={settings.raidWindowSeconds} />
              <NumberField disabled={disabled} label="Conta nova: horas" max={87600} min={1} onChange={(value) => updateSetting("newAccountMaxAgeHours", value)} value={settings.newAccountMaxAgeHours} />
              <NumberField disabled={disabled} label="Timeout: segundos" max={2419200} min={5} onChange={(value) => updateSetting("timeoutSeconds", value)} value={settings.timeoutSeconds} />
            </div>
          </Section>

          <Section icon={UserRoundX} title="Punicoes e castigo">
            <div className="grid gap-3">
              {settings.punishmentSteps.map((step, index) => (
                <PunishmentStepEditor
                  disabled={disabled}
                  key={step.id}
                  onChange={(patch) => updatePunishmentStep(index, patch)}
                  onDurationChange={(key, value) => updatePunishmentDuration(index, key, value)}
                  roles={selectableRoles}
                  step={step}
                />
              ))}
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <SelectField
                disabled={disabled}
                icon={ShieldCheck}
                label="Cargo de castigo"
                onChange={(value) => updateSetting("addRoleId", value || null)}
                options={selectableRoles.map((role) => ({ label: role.name, value: role.id }))}
                placeholder="Usar cargo Self Bot"
                value={settings.addRoleId ?? ""}
              />
              <SelectField
                disabled={disabled}
                icon={ShieldCheck}
                label="Cargo para remover"
                onChange={(value) => updateSetting("removeRoleId", value || null)}
                options={selectableRoles.map((role) => ({ label: role.name, value: role.id }))}
                placeholder="Sem cargo"
                value={settings.removeRoleId ?? ""}
              />
            </div>
          </Section>

          <Section icon={Database} title="Base suspeita">
            <div className="grid gap-4 lg:grid-cols-2">
              <TextListField
                disabled={disabled}
                label="Dominios suspeitos"
                onChange={(values) => updateSetting("suspiciousDomains", values)}
                value={settings.suspiciousDomains}
              />
              <TextListField
                disabled={disabled}
                label="Termos bloqueados"
                onChange={(values) => updateSetting("blockedTerms", values)}
                value={settings.blockedTerms}
              />
            </div>
          </Section>

          <div className="flex flex-wrap items-center gap-3 border-t border-zinc-900 pt-4">
            <Button disabled={disabled} onClick={() => void handleSave()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar SelfBot Protection
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-5 xl:grid-cols-2">
        <Card className="hover:translate-y-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-zinc-300" />
              Infrações por dia
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DailyBars stats={stats} />
          </CardContent>
        </Card>

        <Card className="hover:translate-y-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScrollText className="h-5 w-5 text-zinc-300" />
              Historico recente
            </CardTitle>
          </CardHeader>
          <CardContent>
            <IncidentList incidents={incidents} />
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
  icon: LucideIcon;
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

function Section({
  children,
  icon: Icon,
  title
}: {
  children: ReactNode;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-zinc-900 bg-zinc-950/40 p-4">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-100">
        <Icon className="h-4 w-4 text-zinc-400" />
        {title}
      </h3>
      {children}
    </section>
  );
}

function StatsGrid({ stats }: { stats: SelfBotProtectionStats }) {
  const items = [
    ["Spam bloqueado", stats.blockedSpam],
    ["Imagens removidas", stats.removedImages],
    ["Links bloqueados", stats.blockedLinks],
    ["Usuarios punidos", stats.punishedUsers],
    ["Hoje", stats.infractionsToday],
    ["Semana", stats.infractionsWeek],
    ["Mes", stats.infractionsMonth]
  ] as const;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {items.map(([label, value]) => (
        <div className="rounded-lg border border-zinc-900 bg-black p-3" key={label}>
          <p className="truncate text-xs text-zinc-500">{label}</p>
          <p className="mt-1 text-lg font-semibold text-white">{formatNumber(value)}</p>
        </div>
      ))}
    </div>
  );
}

function SelectField({
  disabled,
  icon: Icon,
  label,
  onChange,
  options,
  placeholder,
  value
}: {
  disabled: boolean;
  icon: LucideIcon;
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="flex items-center gap-2 font-medium text-zinc-200">
        <Icon className="h-4 w-4 text-zinc-400" />
        {label}
      </span>
      <select
        className="h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-purple-500/60"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function ToggleRow({
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
    <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
      <span className="min-w-0 truncate text-sm font-medium text-zinc-200">{label}</span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

function PunishmentStepEditor({
  disabled,
  onChange,
  onDurationChange,
  roles,
  step
}: {
  disabled: boolean;
  onChange: (patch: Partial<SelfBotPunishmentStep>) => void;
  onDurationChange: (key: keyof SelfBotPunishmentStep["tempoTimeout"], value: number) => void;
  roles: GuildRoleOption[];
  step: SelfBotPunishmentStep;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
      <div className="grid gap-3 lg:grid-cols-[180px_120px_160px_1fr]">
        <label className="flex items-center justify-between gap-3 rounded-md border border-zinc-900 bg-black px-3 py-2">
          <span className="text-sm font-medium text-zinc-100">{actionLabel(step.acao)}</span>
          <Switch checked={step.ativado} disabled={disabled} onCheckedChange={(checked) => onChange({ ativado: checked })} />
        </label>
        <NumberField disabled={disabled} label="Limite" max={100} min={1} onChange={(value) => onChange({ limite: value })} value={step.limite} />
        <label className="grid gap-2 text-sm">
          <span className="font-medium text-zinc-200">Proxima acao</span>
          <select
            className="h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-purple-500/60"
            disabled={disabled}
            onChange={(event) => onChange({ proximaAcao: event.target.value ? event.target.value as SelfBotPunishmentAction : null })}
            value={step.proximaAcao ?? ""}
          >
            <option value="">Encerrar fluxo</option>
            {punishmentActions.map((action) => (
              <option key={action.id} value={action.id}>{action.label}</option>
            ))}
          </select>
        </label>
        <div className="grid gap-2 sm:grid-cols-3">
          <ToggleRow checked={step.apagarMensagem} disabled={disabled} label="Apagar mensagem" onChange={(checked) => onChange({ apagarMensagem: checked })} />
          <ToggleRow checked={step.enviarAviso} disabled={disabled} label="Enviar aviso" onChange={(checked) => onChange({ enviarAviso: checked })} />
          <ToggleRow checked={step.registrarLog} disabled={disabled} label="Registrar logs" onChange={(checked) => onChange({ registrarLog: checked })} />
        </div>
      </div>

      {step.acao === "timeout" ? (
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <NumberField disabled={disabled} label="Dias" max={28} min={0} onChange={(value) => onDurationChange("dias", value)} value={step.tempoTimeout.dias} />
          <NumberField disabled={disabled} label="Horas" max={23} min={0} onChange={(value) => onDurationChange("horas", value)} value={step.tempoTimeout.horas} />
          <NumberField disabled={disabled} label="Minutos" max={59} min={0} onChange={(value) => onDurationChange("minutos", value)} value={step.tempoTimeout.minutos} />
          <NumberField disabled={disabled} label="Segundos" max={59} min={0} onChange={(value) => onDurationChange("segundos", value)} value={step.tempoTimeout.segundos} />
        </div>
      ) : null}

      {step.acao === "add_role" || step.acao === "remove_role" ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {step.acao === "add_role" ? (
            <RoleSelect disabled={disabled} label="Cargo aplicado" onChange={(value) => onChange({ cargoAdicionarId: value || null })} roles={roles} value={step.cargoAdicionarId ?? ""} />
          ) : null}
          {step.acao === "remove_role" ? (
            <RoleSelect disabled={disabled} label="Cargo removido" onChange={(value) => onChange({ cargoRemoverId: value || null })} roles={roles} value={step.cargoRemoverId ?? ""} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RoleSelect({
  disabled,
  label,
  onChange,
  roles,
  value
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  roles: GuildRoleOption[];
  value: string;
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium text-zinc-200">{label}</span>
      <select
        className="h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-purple-500/60"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="">Usar padrao</option>
        {roles.map((role) => (
          <option key={role.id} value={role.id}>@{role.name}</option>
        ))}
      </select>
    </label>
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
  icon: LucideIcon;
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

function TextListField({
  disabled,
  label,
  onChange,
  value
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string[]) => void;
  value: string[];
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium text-zinc-200">{label}</span>
      <textarea
        className="min-h-36 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-purple-500/60"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value.split("\n").map((item) => item.trim()).filter(Boolean))}
        value={value.join("\n")}
      />
    </label>
  );
}

function IconButton({
  disabled,
  icon: Icon,
  onClick,
  tone = "default"
}: {
  disabled: boolean;
  icon: LucideIcon;
  onClick: () => void;
  tone?: "default" | "danger";
}) {
  return (
    <button
      className={[
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-800 text-zinc-400 transition",
        tone === "danger" ? "hover:border-red-500/50 hover:text-red-300" : "hover:border-zinc-600 hover:text-white"
      ].join(" ")}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function DailyBars({ stats }: { stats: SelfBotProtectionStats }) {
  if (!stats.daily.length) {
    return <p className="py-8 text-center text-sm text-zinc-600">Nenhuma infracao registrada.</p>;
  }

  const max = Math.max(...stats.daily.map((item) => item.value), 1);

  return (
    <div className="space-y-3">
      {stats.daily.map((item) => (
        <div className="grid grid-cols-[4rem_minmax(0,1fr)_3rem] items-center gap-3" key={item.label}>
          <span className="text-xs text-zinc-500">{item.label}</span>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-900">
            <div
              className="h-full rounded-full bg-purple-400"
              style={{ width: `${Math.max(6, (item.value / max) * 100)}%` }}
            />
          </div>
          <span className="text-right text-xs font-medium text-zinc-300">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function IncidentList({ incidents }: { incidents: SelfBotProtectionIncident[] }) {
  if (!incidents.length) {
    return <p className="py-8 text-center text-sm text-zinc-600">Nenhum historico registrado.</p>;
  }

  return (
    <div className="space-y-2">
      {incidents.map((incident) => (
        <div className="rounded-lg border border-zinc-900 bg-zinc-950/60 p-3" key={incident.id}>
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-medium text-zinc-100">
              {incident.username ?? incident.userId}
            </p>
            <Badge variant={incident.punishmentSucceeded ? "muted" : "warning"}>
              {incident.moduleId}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {incident.infractionType}
            {incident.channelId ? ` - #${incident.channelId}` : ""}
            {" - "}
            {formatDate(incident.createdAt)}
          </p>
          {incident.punishmentError ? <p className="mt-1 text-xs text-red-300">{incident.punishmentError}</p> : null}
        </div>
      ))}
    </div>
  );
}

function incrementStats(
  stats: SelfBotProtectionStats,
  incident: SelfBotProtectionIncident,
  knownUser: boolean
): SelfBotProtectionStats {
  const moduleEntry = stats.byModule.find((entry) => entry.moduleId === incident.moduleId);
  const byModule = moduleEntry
    ? stats.byModule.map((entry) => entry.moduleId === incident.moduleId ? { ...entry, total: entry.total + 1 } : entry)
    : [{ moduleId: incident.moduleId, total: 1 }, ...stats.byModule];
  const label = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit"
  }).format(new Date(incident.createdAt));
  const dailyEntry = stats.daily.find((entry) => entry.label === label);
  const daily = dailyEntry
    ? stats.daily.map((entry) => entry.label === label ? { ...entry, value: entry.value + 1 } : entry)
    : [...stats.daily, { label, value: 1 }];

  return {
    ...stats,
    blockedLinks: isLinkModule(incident.moduleId) ? stats.blockedLinks + 1 : stats.blockedLinks,
    blockedSpam: isSpamModule(incident.moduleId) ? stats.blockedSpam + 1 : stats.blockedSpam,
    byModule,
    daily,
    infractionsMonth: stats.infractionsMonth + 1,
    infractionsToday: stats.infractionsToday + 1,
    infractionsWeek: stats.infractionsWeek + 1,
    punishedUsers: knownUser ? stats.punishedUsers : stats.punishedUsers + 1,
    removedImages: isMediaModule(incident.moduleId) ? stats.removedImages + 1 : stats.removedImages
  };
}

function isSpamModule(moduleId: SelfBotProtectionModuleId) {
  return ["anti-spam", "anti-flood", "anti-texto-repetido", "anti-copypasta", "anti-auto-spam", "anti-flood-multi-canais"].includes(moduleId);
}

function isMediaModule(moduleId: SelfBotProtectionModuleId) {
  return ["anti-imagens", "anti-gif", "anti-anexos"].includes(moduleId);
}

function isLinkModule(moduleId: SelfBotProtectionModuleId) {
  return ["anti-links", "anti-convites", "anti-divulgacao", "anti-scam", "anti-phishing", "anti-token-grabber", "anti-nitro-scam"].includes(moduleId);
}

function actionLabel(action: SelfBotPunishmentAction) {
  return punishmentActions.find((item) => item.id === action)?.label ?? action;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
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

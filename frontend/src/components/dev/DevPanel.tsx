import { useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, KeyRound, LayoutGrid, Loader2, Plus, Power, Server, Trash2, Users, XCircle } from "lucide-react";
import { Avatar } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";
import {
  createDevBot,
  deleteDevBot,
  detectDevBotGuild,
  getDevBots,
  getDevModules,
  restartDevBot,
  testDevBotConnection,
  updateDevBotModules
} from "../../lib/api";
import type {
  AuthUser,
  BotConnectionTest,
  CreateDevBotPayload,
  DashboardBot,
  DashboardMeGuild,
  DetectedDiscordGuild,
  DevBot,
  DevBotStatus,
  DevModuleDefinition
} from "../../types";

const fallbackModules: DevModuleDefinition[] = [
  { id: "live", label: "Sistema de Live" },
  { id: "verification", label: "Sistema de Verificacao" },
  { id: "welcome", label: "Sistema de Boas-vindas" },
  { id: "leave", label: "Sistema de Saida" },
  { id: "logs", label: "Sistema de Logs" },
  { id: "roles", label: "Sistema de Cargos" },
  { id: "tickets", label: "Sistema de Tickets" },
  { id: "moderation", label: "Sistema de Moderacao" },
  { id: "avisos", label: "Mensagens e Personalizacao" }
];

const emptyForm: CreateDevBotPayload = {
  name: "",
  clientId: "",
  token: "",
  secret: "",
  avatarUrl: "",
  ownerName: "",
  ownerId: "",
  mainGuildId: "",
  enabledModules: ["live"]
};

type DevPanelProps = {
  guilds?: DashboardMeGuild[];
  onBotCreated?: (bot: DashboardBot) => void;
  onBotDeleted?: (botId: string) => void;
  onBotUpdated?: (bot: DashboardBot) => void;
  selectedBotId?: string | null;
  selectedGuildId?: string | null;
  onSelectBot?: (botId: string | null) => void;
  user?: AuthUser;
};

export function DevPanel({
  guilds = [],
  onBotCreated,
  onBotDeleted,
  onBotUpdated,
  onSelectBot,
  selectedBotId: controlledSelectedBotId,
  selectedGuildId,
  user
}: DevPanelProps) {
  const [bots, setBots] = useState<DevBot[]>([]);
  const [modules, setModules] = useState<DevModuleDefinition[]>(fallbackModules);
  const [internalSelectedBotId, setInternalSelectedBotId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateDevBotPayload>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<BotConnectionTest | null>(null);
  const [detectedGuild, setDetectedGuild] = useState<DetectedDiscordGuild | null>(null);
  const [detectingGuild, setDetectingGuild] = useState(false);
  const [guildDetectionError, setGuildDetectionError] = useState<string | null>(null);

  const selectedBotId = controlledSelectedBotId ?? internalSelectedBotId;
  const selectedBot = bots.find((bot) => bot.id === selectedBotId) ?? null;
  const guildNameById = useMemo(() => new Map(guilds.map((guild) => [guild.id, guild.name])), [guilds]);
  const stats = useMemo(
    () => ({
      total: bots.length,
      online: bots.filter((bot) => bot.status === "online").length,
      offline: bots.filter((bot) => bot.status === "offline").length,
      errors: bots.filter((bot) => bot.status === "error" || bot.status === "invalid_token").length
    }),
    [bots]
  );

  useEffect(() => {
    let mounted = true;

    Promise.all([getDevModules(), getDevBots()])
      .then(([moduleData, botData]) => {
        if (!mounted) return;
        setModules(moduleData.length ? moduleData : fallbackModules);
        setBots(botData);
        setInternalSelectedBotId((current) => current ?? controlledSelectedBotId ?? botData[0]?.id ?? null);
      })
      .catch(() => {
        if (mounted) setMessage("Nao foi possivel carregar a aba Dev.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      ownerName: current.ownerName || user?.globalName || user?.username || "",
      ownerId: current.ownerId || user?.discordId || "",
      mainGuildId: current.mainGuildId || selectedGuildId || guilds[0]?.id || ""
    }));
  }, [guilds, selectedGuildId, user]);

  useEffect(() => {
    const token = form.token.trim();
    const guildId = form.mainGuildId.trim();

    setDetectedGuild(null);
    setGuildDetectionError(null);

    if (token.length < 10 || !/^\d{5,32}$/.test(guildId)) {
      setDetectingGuild(false);
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setDetectingGuild(true);
      detectDevBotGuild(token, guildId)
        .then((guild) => {
          if (!cancelled) {
            setDetectedGuild(guild);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setGuildDetectionError(readRequestMessage(error) ?? "Nao foi possivel detectar esse servidor.");
          }
        })
        .finally(() => {
          if (!cancelled) {
            setDetectingGuild(false);
          }
        });
    }, 550);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [form.mainGuildId, form.token]);

  function updateForm<K extends keyof CreateDevBotPayload>(key: K, value: CreateDevBotPayload[K]) {
    setForm((current) => ({
      ...current,
      [key]: value
    }));
  }

  function handleSelectBotId(botId: string | null) {
    setInternalSelectedBotId(botId);
    onSelectBot?.(botId);
  }

  async function handleTestToken() {
    if (!form.token.trim()) {
      setMessage("Informe o token para testar.");
      return;
    }

    setTesting(true);
    setMessage(null);
    setTestResult(null);

    try {
      const result = await testDevBotConnection(form.token, form.clientId);
      setTestResult(result);
      setMessage(result.message);
      if (result.clientId && !form.clientId) {
        updateForm("clientId", result.clientId);
      }
      if (result.avatarUrl && !form.avatarUrl) {
        updateForm("avatarUrl", result.avatarUrl);
      }
    } catch {
      setMessage("Nao foi possivel testar o token.");
    } finally {
      setTesting(false);
    }
  }

  async function handleCreateBot() {
    setSaving(true);
    setMessage(null);

    try {
      const bot = await createDevBot({
        ...form,
        avatarUrl: form.avatarUrl || null,
        secret: form.secret || null
      });
      setBots((current) => [bot, ...current]);
      onBotCreated?.(bot);
      handleSelectBotId(bot.id);
      setForm(emptyForm);
      setTestResult(null);
      setDetectedGuild(null);
      setMessage("Bot cadastrado com sucesso.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Nao foi possivel salvar o bot. Confira os campos obrigatorios.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleModule(bot: DevBot, moduleId: string, checked: boolean) {
    const nextModules = checked
      ? [...new Set([...bot.enabledModules, moduleId])]
      : bot.enabledModules.filter((item) => item !== moduleId);

    setBots((current) => current.map((item) => (item.id === bot.id ? { ...item, enabledModules: nextModules } : item)));

    try {
      const updated = await updateDevBotModules(bot.id, nextModules);
      setBots((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      onBotUpdated?.(updated);
      setMessage("Modulos atualizados.");
    } catch {
      setBots((current) => current.map((item) => (item.id === bot.id ? bot : item)));
      setMessage("Nao foi possivel atualizar os modulos.");
    }
  }

  async function handleRestart(bot: DevBot) {
    setMessage(null);

    try {
      const updated = await restartDevBot(bot.id);
      setBots((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      onBotUpdated?.(updated);
      setMessage(updated.statusMessage ?? "Bot sincronizado.");
    } catch {
      setMessage("Nao foi possivel reiniciar/testar esse bot.");
    }
  }

  async function handleDelete(bot: DevBot) {
    if (!window.confirm(`Excluir ${bot.name}?`)) {
      return;
    }

    try {
      await deleteDevBot(bot.id);
      setBots((current) => current.filter((item) => item.id !== bot.id));
      onBotDeleted?.(bot.id);
      if (selectedBot?.id === bot.id) {
        handleSelectBotId(bots.find((item) => item.id !== bot.id)?.id ?? null);
      }
      setMessage("Bot removido.");
    } catch {
      setMessage("Nao foi possivel excluir o bot.");
    }
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
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DevStatCard label="Bots cadastrados" value={String(stats.total)} />
        <DevStatCard label="Bots online" value={String(stats.online)} />
        <DevStatCard label="Bots offline" value={String(stats.offline)} />
        <DevStatCard label="Com erro" value={String(stats.errors)} />
      </section>

      {message ? (
        <div className="rounded-lg border border-purple-500/25 bg-purple-500/10 px-4 py-3 text-sm text-purple-100">{message}</div>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader>
            <CardTitle>Gerenciar Bots</CardTitle>
            <CardDescription>Cadastre o bot, teste o token e defina o dono do painel.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <DevInput label="Nome do bot" value={form.name} onChange={(value) => updateForm("name", value)} />
              <DevInput label="Client ID" value={form.clientId} onChange={(value) => updateForm("clientId", value)} />
              <DevInput label="Token do bot" type="password" value={form.token} onChange={(value) => updateForm("token", value)} />
              <DevInput label="Secret" type="password" value={form.secret ?? ""} onChange={(value) => updateForm("secret", value)} />
              <DevInput label="Avatar URL" value={form.avatarUrl ?? ""} onChange={(value) => updateForm("avatarUrl", value)} />
              <DevInput
                label="ID do servidor principal"
                value={form.mainGuildId}
                onChange={(value) => updateForm("mainGuildId", value.replace(/\D/g, ""))}
              />
              <DevInput label="Nome do dono" value={form.ownerName} onChange={(value) => updateForm("ownerName", value)} />
              <DevInput label="Discord ID do dono" value={form.ownerId} onChange={(value) => updateForm("ownerId", value)} />
            </div>

            <GuildDetectionCard
              detecting={detectingGuild}
              error={guildDetectionError}
              guild={detectedGuild}
            />

            <div className="rounded-lg border border-zinc-900 bg-zinc-950/70 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">Modulos liberados</p>
                  <p className="text-xs text-zinc-500">Esses modulos aparecem para o bot cadastrado.</p>
                </div>
                <Badge variant="muted">{form.enabledModules.length}</Badge>
              </div>
              <ModuleSwitchGrid enabledModules={form.enabledModules} modules={modules} onToggle={(moduleId, checked) => {
                updateForm(
                  "enabledModules",
                  checked
                    ? [...new Set([...form.enabledModules, moduleId])]
                    : form.enabledModules.filter((item) => item !== moduleId)
                );
              }} />
            </div>

            {testResult ? (
              <div className="rounded-lg border border-zinc-800 bg-black/35 px-4 py-3 text-sm text-zinc-200">
                Teste: <span className={statusTextClass(testResult.status)}>{statusLabel(testResult.status)}</span>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <Button disabled={testing || !form.token.trim()} onClick={handleTestToken} variant="outline">
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Testar conexao
              </Button>
              <Button
                disabled={saving || detectingGuild || detectedGuild?.id !== form.mainGuildId.trim()}
                onClick={handleCreateBot}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Salvar bot
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Selecionar bot para liberar configs</CardTitle>
            <CardDescription>Escolha o bot cadastrado que recebera as abas, botoes e configuracoes liberadas.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {bots.length ? (
                <label className="block space-y-2 rounded-lg border border-purple-500/25 bg-purple-500/10 p-4">
                  <span className="text-xs font-medium uppercase text-purple-200">Bot selecionado no sistema Dev</span>
                  <select
                    className="h-11 w-full rounded-lg border border-purple-500/30 bg-zinc-950 px-3 text-sm font-medium text-zinc-100 outline-none transition duration-300 focus:border-purple-400"
                    onChange={(event) => handleSelectBotId(event.target.value || null)}
                    value={selectedBot?.id ?? ""}
                  >
                    <option value="">Selecione o bot</option>
                    {bots.map((bot) => (
                      <option key={bot.id} value={bot.id}>
                        {bot.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs leading-5 text-purple-100/80">
                    Depois de escolher o bot, marque abaixo quais configs aparecem para ele na dashboard.
                  </p>
                </label>
              ) : null}

              <div className="space-y-3">
                {bots.length ? (
                  bots.map((bot) => (
                    <button
                      className={`w-full rounded-lg border px-4 py-3 text-left transition duration-300 hover:-translate-y-0.5 hover:bg-zinc-900 ${
                        selectedBot?.id === bot.id ? "border-purple-500/50 bg-purple-500/10" : "border-zinc-900 bg-zinc-950/60"
                      }`}
                      key={bot.id}
                      onClick={() => handleSelectBotId(bot.id)}
                      type="button"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar className="h-11 w-11 rounded-full border border-red-500/50" fallback={bot.name} src={bot.avatarUrl} />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-semibold text-white">{bot.name}</p>
                              <StatusBadge status={bot.status} />
                            </div>
                            <p className="truncate text-xs text-zinc-500">
                              Servidor {bot.mainGuildName || guildNameById.get(bot.mainGuildId) || "Servidor configurado"}
                            </p>
                            <p className="truncate text-xs text-zinc-600">Dono {bot.ownerName}</p>
                            <p className="truncate font-mono text-[11px] text-zinc-700">Painel ID {bot.id}</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant="muted">{bot.enabledModules.length} modulos</Badge>
                          <Button onClick={(event) => {
                            event.stopPropagation();
                            void handleRestart(bot);
                          }} size="icon" title="Reiniciar bot" variant="outline">
                            <Power className="h-4 w-4" />
                          </Button>
                          <Button onClick={(event) => {
                            event.stopPropagation();
                            void handleDelete(bot);
                          }} size="icon" title="Excluir bot" variant="destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 p-6 text-center">
                    <Bot className="mb-3 h-7 w-7 text-zinc-500" />
                    <p className="text-sm font-medium text-zinc-500">Nenhum bot cadastrado</p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {selectedBot ? (
        <Card>
          <CardHeader>
            <CardTitle>Configs liberadas para este bot</CardTitle>
            <CardDescription>Ative ou desative os sistemas visiveis somente para o bot selecionado.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-4 rounded-lg border border-zinc-900 bg-zinc-950/70 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar className="h-12 w-12 rounded-full border border-purple-500/40" fallback={selectedBot.name} src={selectedBot.avatarUrl} />
                <div className="min-w-0">
                  <p className="text-xs text-zinc-500">Configurando dashboard do bot</p>
                  <p className="truncate text-sm font-semibold text-white">{selectedBot.name}</p>
                  <p className="truncate text-xs text-zinc-600">{selectedBot.mainGuildName || guildNameById.get(selectedBot.mainGuildId)}</p>
                </div>
              </div>
              <Badge variant="muted">{selectedBot.enabledModules.length}/{modules.length} visiveis</Badge>
            </div>
            <ModuleSwitchGrid
              enabledModules={selectedBot.enabledModules}
              modules={modules}
              onToggle={(moduleId, checked) => void handleToggleModule(selectedBot, moduleId, checked)}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function GuildDetectionCard({
  detecting,
  error,
  guild
}: {
  detecting: boolean;
  error: string | null;
  guild: DetectedDiscordGuild | null;
}) {
  if (detecting) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 text-sm text-zinc-400">
        <Loader2 className="h-5 w-5 animate-spin" />
        Detectando dados do servidor no Discord...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
        {error}
      </div>
    );
  }

  if (!guild) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/50 p-4 text-sm text-zinc-500">
        Informe o token e o ID do servidor. O painel detectara os dados automaticamente.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="h-12 w-12 rounded-lg border border-emerald-500/30" fallback={guild.name} src={guild.iconUrl} />
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-white">
              <Server className="h-4 w-4 text-emerald-300" />
              <span className="truncate">{guild.name}</span>
            </p>
            <p className="truncate font-mono text-xs text-zinc-500">{guild.id}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-zinc-300">
          <span className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-black/30 px-2.5 py-1.5">
            <Users className="h-3.5 w-3.5" />
            {guild.memberCount} membros
          </span>
          <span className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-black/30 px-2.5 py-1.5">
            <LayoutGrid className="h-3.5 w-3.5" />
            {guild.channelCount} canais
          </span>
        </div>
      </div>
      <p className="mt-3 text-xs text-emerald-200">Servidor detectado e bot confirmado nele.</p>
    </div>
  );
}

function DevStatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-800 bg-black text-zinc-200">
          <Bot className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm text-zinc-500">{label}</p>
          <p className="text-2xl font-semibold text-white">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function DevInput({ label, onChange, type = "text", value }: { label: string; onChange: (value: string) => void; type?: string; value: string }) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-zinc-500">{label}</span>
      <input className="social-input" onChange={(event) => onChange(event.target.value)} type={type} value={value} />
    </label>
  );
}

function ModuleSwitchGrid({
  enabledModules,
  modules,
  onToggle
}: {
  enabledModules: string[];
  modules: DevModuleDefinition[];
  onToggle: (moduleId: string, checked: boolean) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {modules.map((module) => {
        const enabled = enabledModules.includes(module.id);

        return (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-900 bg-black/35 px-3 py-2" key={module.id}>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-zinc-100">{module.label}</p>
              <p className="text-xs text-zinc-500">{enabled ? "Ativado" : "Desativado"}</p>
            </div>
            <Switch checked={enabled} onCheckedChange={(checked) => onToggle(module.id, checked)} />
          </div>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: DevBotStatus }) {
  const connected = status === "online";

  return (
    <Badge variant={connected ? "success" : status === "invalid_token" || status === "error" ? "danger" : "muted"}>
      {connected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
      {statusLabel(status)}
    </Badge>
  );
}

function statusLabel(status: DevBotStatus) {
  const labels: Record<DevBotStatus, string> = {
    online: "Online",
    offline: "Offline",
    invalid_token: "Token invalido",
    error: "Erro"
  };

  return labels[status];
}

function statusTextClass(status: DevBotStatus) {
  return status === "online" ? "text-emerald-300" : status === "offline" ? "text-zinc-300" : "text-red-300";
}

function readRequestMessage(error: unknown) {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return null;
  }

  const response = (error as { response?: { data?: { message?: unknown } } }).response;
  return typeof response?.data?.message === "string" ? response.data.message : null;
}

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ExternalLink, Film, Loader2, Play, Save, ShieldCheck, Sparkles, type LucideIcon } from "lucide-react";
import {
  disableClips,
  enableClips,
  getClipsConfig,
  getClipsHistory,
  getGuildLiveOptions,
  saveClipsConfig,
  testClips,
  validateClipTwitchChannel
} from "../../lib/api";
import type {
  ClipMentionType,
  ClipSent,
  ClipsConfig,
  DashboardGuild,
  GuildLiveOptions,
  TwitchClipChannelPreview
} from "../../types";
import { Avatar } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

type ClipsPanelProps = {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
  refreshSignal?: number;
};

type ClipsForm = {
  twitchChannelInput: string;
  discordChannelId: string;
  allowedRoleId: string;
  mentionType: ClipMentionType;
  mentionRoleId: string;
  embedColor: string;
  customMessage: string;
  checkInterval: number;
};

const defaultForm: ClipsForm = {
  twitchChannelInput: "",
  discordChannelId: "",
  allowedRoleId: "",
  mentionType: "none",
  mentionRoleId: "",
  embedColor: "#9146FF",
  customMessage: "Novo corte criado na live do {streamer}!",
  checkInterval: 30_000
};

export function ClipsPanel({ botId, canManage, guild, refreshSignal = 0 }: ClipsPanelProps) {
  const [config, setConfig] = useState<ClipsConfig | null>(null);
  const [history, setHistory] = useState<ClipSent[]>([]);
  const [options, setOptions] = useState<GuildLiveOptions>({ channels: [], roles: [] });
  const [form, setForm] = useState<ClipsForm>(defaultForm);
  const [preview, setPreview] = useState<TwitchClipChannelPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const roleOptions = useMemo(
    () => options.roles.filter((role) => role.id !== guild?.id && !role.managed),
    [guild?.id, options.roles]
  );
  const mentionRoles = options.roles.filter((role) => role.id !== guild?.id && !role.managed);
  const streamerName = preview?.twitchDisplayName || config?.twitchDisplayName || form.twitchChannelInput || "Ricardinn98";
  const previewMessage = form.customMessage.replace(/\{streamer\}/gi, streamerName);

  useEffect(() => {
    if (!guild || !canManage) {
      setConfig(null);
      setHistory([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    Promise.all([
      getClipsConfig(guild.id, botId),
      getClipsHistory(guild.id, botId),
      getGuildLiveOptions(guild.id, botId).catch(() => ({ channels: [], roles: [] }))
    ])
      .then(([nextConfig, nextHistory, nextOptions]) => {
        setConfig(nextConfig);
        setHistory(nextHistory);
        setOptions(nextOptions);
        setForm(formFromConfig(nextConfig));
        setPreview(nextConfig?.twitchChannelName ? {
          twitchId: nextConfig.twitchBroadcasterId,
          twitchUsername: nextConfig.twitchChannelName,
          twitchDisplayName: nextConfig.twitchDisplayName || nextConfig.twitchChannelName,
          twitchAvatar: nextConfig.twitchAvatar,
          twitchUrl: `https://www.twitch.tv/${nextConfig.twitchChannelName}`
        } : null);
      })
      .catch((requestError) => setError(readErrorMessage(requestError)))
      .finally(() => setLoading(false));
  }, [botId, canManage, guild]);

  useEffect(() => {
    if (!refreshSignal || !guild || !canManage) {
      return;
    }

    let mounted = true;

    Promise.all([
      getClipsConfig(guild.id, botId),
      getClipsHistory(guild.id, botId)
    ])
      .then(([nextConfig, nextHistory]) => {
        if (!mounted) {
          return;
        }

        setConfig(nextConfig);
        setHistory(nextHistory);
      })
      .catch((requestError) => {
        if (mounted) {
          setError(readErrorMessage(requestError));
        }
      });

    return () => {
      mounted = false;
    };
  }, [botId, canManage, guild, refreshSignal]);

  function updateForm<K extends keyof ClipsForm>(key: K, value: ClipsForm[K]) {
    setForm((current) => ({
      ...current,
      [key]: value
    }));
  }

  async function handleValidate() {
    if (!form.twitchChannelInput.trim()) {
      setError("Informe o canal da Twitch.");
      return;
    }

    setValidating(true);
    setError(null);
    setStatus(null);

    try {
      const channel = await validateClipTwitchChannel(form.twitchChannelInput);
      setPreview(channel);
      updateForm("twitchChannelInput", channel.twitchUsername);
      setStatus("Canal da Twitch validado.");
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setValidating(false);
    }
  }

  async function handleSave() {
    if (!guild) {
      return;
    }

    setSaving(true);
    setError(null);
    setStatus(null);

    try {
      const nextConfig = await saveClipsConfig({
        guildId: guild.id,
        twitchChannelInput: form.twitchChannelInput,
        discordChannelId: form.discordChannelId || null,
        allowedRoleIds: form.allowedRoleId ? [form.allowedRoleId] : [],
        mentionType: form.mentionType,
        mentionRoleId: form.mentionType === "role" ? form.mentionRoleId || null : null,
        embedColor: form.embedColor,
        customMessage: form.customMessage,
        enabled: config?.enabled ?? false
      }, botId);

      setConfig(nextConfig);
      setForm(formFromConfig(nextConfig));
      setStatus("Configuracao de clips salva. Clips novos vao aparecer no historico quando forem cortados na Twitch.");
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(checked: boolean) {
    if (!guild) {
      return;
    }

    setToggling(true);
    setError(null);
    setStatus(null);

    try {
      const nextConfig = checked ? await enableClips(guild.id, botId) : await disableClips(guild.id, botId);
      setConfig(nextConfig);
      setForm(formFromConfig(nextConfig));
      setStatus(checked ? "Sistema de clips ativado." : "Sistema de clips desativado.");
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setToggling(false);
    }
  }

  async function handleTest() {
    if (!guild) {
      return;
    }

    setTesting(true);
    setError(null);
    setStatus(null);

    try {
      await testClips(guild.id, botId);
      setStatus("Mensagem de teste enviada.");
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setTesting(false);
    }
  }

  if (!guild) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-zinc-500">Selecione um servidor para configurar Clips.</CardContent>
      </Card>
    );
  }

  if (!canManage) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-zinc-500">Sua conta nao tem permissao para configurar Clips neste servidor.</CardContent>
      </Card>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-white">
            <Film className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xl font-semibold text-white">Clips</h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-500">
              Configure cortes da Twitch por bot e servidor.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button disabled={testing || !config?.discordChannelId} onClick={handleTest} variant="outline">
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Testar envio
          </Button>
          <Button disabled={saving || loading} onClick={handleSave}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar configuracao
          </Button>
        </div>
      </div>

      {status ? <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">{status}</div> : null}
      {error ? <div className="rounded-lg border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-100">{error}</div> : null}

      <section className="grid gap-4 md:grid-cols-3">
        <StatusCard
          enabled={Boolean(config?.enabled)}
          lastCheckAt={config?.lastCheckAt ?? null}
          loading={loading || toggling}
          onToggle={handleToggle}
          totalSent={config?.totalSent ?? history.length}
        />
        <MetricCard icon={ShieldCheck} label="Cargo liberado" value={form.allowedRoleId ? roleOptions.find((role) => role.id === form.allowedRoleId)?.name ?? "Configurado" : "Nenhum"} />
        <MetricCard icon={Sparkles} label="Intervalo" value={formatInterval(form.checkInterval)} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Configuracao da Twitch</CardTitle>
              <CardDescription>Canal monitorado para novos clips.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <Field label="Canal Twitch">
                  <input
                    className="social-input"
                    onChange={(event) => updateForm("twitchChannelInput", event.target.value)}
                    placeholder="ricardinn98"
                    value={form.twitchChannelInput}
                  />
                </Field>
                <Button disabled={validating || !form.twitchChannelInput.trim()} onClick={handleValidate} variant="outline">
                  {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                  Validar canal
                </Button>
              </div>
              {preview ? (
                <div className="flex items-center gap-3 rounded-lg border border-zinc-900 bg-zinc-950/75 p-3">
                  <Avatar className="h-11 w-11 rounded-full border border-purple-500/35" fallback={preview.twitchDisplayName} src={preview.twitchAvatar} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{preview.twitchDisplayName}</p>
                    <p className="truncate text-xs text-zinc-500">@{preview.twitchUsername}</p>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Canal de envio</CardTitle>
              <CardDescription>Destino opcional no Discord e permissao para configurar.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="Canal Discord">
                <select className="social-input" onChange={(event) => updateForm("discordChannelId", event.target.value)} value={form.discordChannelId}>
                  <option value="">Nao enviar no Discord</option>
                  {options.channels.map((channel) => (
                    <option key={channel.id} value={channel.id}>#{channel.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Cargo permitido">
                <select className="social-input" onChange={(event) => updateForm("allowedRoleId", event.target.value)} value={form.allowedRoleId}>
                  <option value="">Somente dono/admin</option>
                  {roleOptions.map((role) => (
                    <option key={role.id} value={role.id}>@{role.name}</option>
                  ))}
                </select>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Personalizacao</CardTitle>
              <CardDescription>Mensagem, cor e mencao do alerta.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="Mensagem personalizada">
                <textarea
                  className="social-input min-h-24 resize-y py-3"
                  onChange={(event) => updateForm("customMessage", event.target.value)}
                  value={form.customMessage}
                />
              </Field>
              <div className="space-y-4">
                <Field label="Cor do embed">
                  <div className="flex gap-2">
                    <input
                      className="h-11 w-14 rounded-lg border border-zinc-800 bg-black"
                      onChange={(event) => updateForm("embedColor", event.target.value)}
                      type="color"
                      value={form.embedColor}
                    />
                    <input className="social-input" onChange={(event) => updateForm("embedColor", event.target.value)} value={form.embedColor} />
                  </div>
                </Field>
                <Field label="Mencao">
                  <select className="social-input" onChange={(event) => updateForm("mentionType", event.target.value as ClipMentionType)} value={form.mentionType}>
                    <option value="none">Ninguem</option>
                    <option value="everyone">@everyone</option>
                    <option value="role">Cargo</option>
                  </select>
                </Field>
                {form.mentionType === "role" ? (
                  <Field label="Cargo mencionado">
                    <select className="social-input" onChange={(event) => updateForm("mentionRoleId", event.target.value)} value={form.mentionRoleId}>
                      <option value="">Selecione o cargo</option>
                      {mentionRoles.map((role) => (
                        <option key={role.id} value={role.id}>@{role.name}</option>
                      ))}
                    </select>
                  </Field>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Preview do embed</CardTitle>
              <CardDescription>Exemplo do alerta enviado no Discord.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-zinc-800 bg-[#111214] p-4">
                {previewMessage ? <p className="mb-3 text-sm text-zinc-200">{previewMessage}</p> : null}
                <div className="border-l-4 bg-zinc-950/80 p-4" style={{ borderColor: safeColor(form.embedColor) }}>
                  <h4 className="text-base font-semibold text-white">Novo clipe criado!</h4>
                  <p className="mt-2 text-sm text-zinc-300">Um novo corte foi criado na live de {streamerName}.</p>
                  <div className="mt-4 grid gap-3 text-sm">
                    <PreviewField label="Titulo" value="Melhor momento da live" />
                    <PreviewField label="Criado por" value="NomeDaPessoa" />
                    <PreviewField label="Canal" value={streamerName} />
                    <PreviewField label="Assistir" value="https://clips.twitch.tv/..." />
                  </div>
                  <div className="mt-4 aspect-video rounded-lg border border-zinc-800 bg-zinc-900" />
                  <p className="mt-3 text-xs text-zinc-500">Sistema de Clips - {guild.name}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Historico</CardTitle>
              <CardDescription>Ultimos clips registrados por este bot neste servidor.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {history.length ? history.map((clip) => (
                <a
                  className="block rounded-lg border border-zinc-900 bg-zinc-950/75 p-3 transition hover:border-zinc-700 hover:bg-zinc-900"
                  href={clip.clipUrl}
                  key={clip.id}
                  rel="noreferrer"
                  target="_blank"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{clip.clipTitle}</p>
                      <p className="mt-1 truncate text-xs text-zinc-500">{clip.clipCreatorName || "Criador desconhecido"} - {formatDate(clip.sentAt)}</p>
                    </div>
                    <ExternalLink className="h-4 w-4 shrink-0 text-zinc-500" />
                  </div>
                </a>
              )) : (
                <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 p-6 text-center text-sm text-zinc-500">
                  Nenhum clip registrado ainda.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </section>
  );
}

function StatusCard({
  enabled,
  lastCheckAt,
  loading,
  onToggle,
  totalSent
}: {
  enabled: boolean;
  lastCheckAt: string | null;
  loading: boolean;
  onToggle: (checked: boolean) => void;
  totalSent: number;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 p-5">
        <div>
          <p className="text-sm text-zinc-500">Status do sistema</p>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant={enabled ? "success" : "muted"}>{enabled ? "Ativo" : "Desativado"}</Badge>
            <span className="text-xs text-zinc-600">{totalSent} registrados</span>
          </div>
          <p className="mt-2 text-xs text-zinc-600">Ultima verificacao: {lastCheckAt ? formatDate(lastCheckAt) : "Nunca"}</p>
        </div>
        {loading ? <Loader2 className="h-5 w-5 animate-spin text-zinc-500" /> : <Switch checked={enabled} onCheckedChange={onToggle} />}
      </CardContent>
    </Card>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-black text-zinc-200">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm text-zinc-500">{label}</p>
          <p className="truncate text-lg font-semibold text-white">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function PreviewField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className="mt-1 text-zinc-100">{value}</p>
    </div>
  );
}

function formFromConfig(config: ClipsConfig | null): ClipsForm {
  if (!config) {
    return defaultForm;
  }

  return {
    twitchChannelInput: config.twitchChannelName,
    discordChannelId: config.discordChannelId ?? "",
    allowedRoleId: config.allowedRoleIds[0] ?? "",
    mentionType: config.mentionType,
    mentionRoleId: config.mentionRoleId ?? "",
    embedColor: config.embedColor,
    customMessage: config.customMessage ?? defaultForm.customMessage,
    checkInterval: defaultForm.checkInterval
  };
}

function safeColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#9146FF";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit"
  }).format(new Date(value));
}

function formatInterval(value: number) {
  return value < 60_000 ? `${Math.round(value / 1000)} seg` : `${Math.round(value / 60000)} min`;
}

function readErrorMessage(error: unknown) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? "Nao foi possivel concluir a acao.";
  }

  return "Nao foi possivel concluir a acao.";
}

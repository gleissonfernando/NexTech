import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  BarChart3,
  ExternalLink,
  Film,
  Loader2,
  Play,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Trophy,
  type LucideIcon
} from "lucide-react";
import {
  disableClips,
  deleteClipsConfigById,
  disableClipsConfigById,
  enableClipsConfigById,
  enableClips,
  getClipsConfig,
  getClipsConfigs,
  getClipsHistory,
  getClipsRanking,
  getClipsStats,
  getGuildLiveOptions,
  saveClipsConfig,
  testClips,
  validateClipKickChannel,
  validateClipTwitchChannel
} from "../../lib/api";
import type {
  ClipMentionType,
  ClipPlatform,
  ClipRankingEntry,
  ClipRewardRole,
  ClipSent,
  ClipStats,
  ClipsConfig,
  DashboardGuild,
  GuildLiveOptions,
  KickClipChannelPreview,
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
  platform?: ClipPlatform;
  refreshSignal?: number;
};

type ClipFilter = "today" | "yesterday" | "7d" | "30d" | "all";
type ClipsTab = "clips" | "ranking" | "stats";

type ChannelPreview = {
  avatar: string | null;
  displayName: string;
  followers: number | null;
  isLive: boolean | null;
  url: string;
  username: string;
};

type ClipsForm = {
  allowedRoleId: string;
  channelInput: string;
  checkInterval: number;
  clipRewards: ClipRewardRole[];
  customMessage: string;
  discordChannelId: string;
  embedColor: string;
  kickApiToken: string;
  kickChannelId: string;
  kickChannelUrl: string;
  mentionRoleId: string;
  mentionType: ClipMentionType;
};

const rewardPresets: ClipRewardRole[] = [
  { clipCount: 10, label: "Cargo Bronze", roleId: "" },
  { clipCount: 25, label: "Cargo Prata", roleId: "" },
  { clipCount: 50, label: "Cargo Ouro", roleId: "" },
  { clipCount: 100, label: "Cargo Diamante", roleId: "" }
];

const filters: Array<{ id: ClipFilter; label: string }> = [
  { id: "today", label: "Hoje" },
  { id: "yesterday", label: "Ontem" },
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
  { id: "all", label: "Todos" }
];

export function ClipsPanel({ botId, canManage, guild, platform = "twitch", refreshSignal = 0 }: ClipsPanelProps) {
  const [activeTab, setActiveTab] = useState<ClipsTab>("clips");
  const [config, setConfig] = useState<ClipsConfig | null>(null);
  const [configs, setConfigs] = useState<ClipsConfig[]>([]);
  const [filter, setFilter] = useState<ClipFilter>("all");
  const [history, setHistory] = useState<ClipSent[]>([]);
  const [options, setOptions] = useState<GuildLiveOptions>({ channels: [], roles: [] });
  const [form, setForm] = useState<ClipsForm>(() => defaultForm(platform));
  const [preview, setPreview] = useState<ChannelPreview | null>(null);
  const [ranking, setRanking] = useState<ClipRankingEntry[]>([]);
  const [stats, setStats] = useState<ClipStats | null>(null);
  const [configSearch, setConfigSearch] = useState("");
  const [editingConfigId, setEditingConfigId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isKick = platform === "kick";
  const label = isKick ? "Kick" : "Twitch";
  const roleOptions = useMemo(
    () => options.roles.filter((role) => role.id !== guild?.id && !role.managed),
    [guild?.id, options.roles]
  );
  const mentionRoles = roleOptions;
  const streamerName = preview?.displayName || config?.displayName || form.channelInput || "Canal";
  const previewMessage = form.customMessage.replace(/\{streamer\}/gi, streamerName);

  useEffect(() => {
    setForm(defaultForm(platform));
    setPreview(null);
    setFilter("all");
    setActiveTab("clips");
  }, [platform]);

  useEffect(() => {
    if (!guild || !canManage) {
      setConfig(null);
      setHistory([]);
      setRanking([]);
      setStats(null);
      setLoading(false);
      return;
    }

    let mounted = true;

    setLoading(true);
    setError(null);

    Promise.all([
      getClipsConfig(guild.id, botId, platform),
      getClipsConfigs(guild.id, botId, platform, { pageSize: 50, q: configSearch }),
      getClipsHistory(guild.id, botId, platform, filter),
      getClipsRanking(guild.id, botId, platform, filter),
      getClipsStats(guild.id, botId, platform),
      getGuildLiveOptions(guild.id, botId).catch(() => ({ channels: [], roles: [] }))
    ])
      .then(([nextConfig, nextConfigsPage, nextHistory, nextRanking, nextStats, nextOptions]) => {
        if (!mounted) {
          return;
        }

        setConfig(nextConfig);
        setConfigs(nextConfigsPage.configs);
        setHistory(nextHistory);
        setRanking(nextRanking);
        setStats(nextStats);
        setOptions(nextOptions);
        setForm(formFromConfig(nextConfig, platform));
        setPreview(previewFromConfig(nextConfig));
      })
      .catch((requestError) => {
        if (mounted) {
          setError(readErrorMessage(requestError));
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
  }, [botId, canManage, configSearch, filter, guild, platform, refreshSignal]);

  function updateForm<K extends keyof ClipsForm>(key: K, value: ClipsForm[K]) {
    setForm((current) => ({
      ...current,
      [key]: value
    }));
  }

  function updateReward(index: number, roleId: string) {
    updateForm("clipRewards", form.clipRewards.map((reward, rewardIndex) => rewardIndex === index ? { ...reward, roleId } : reward));
  }

  async function handleValidate() {
    if (!guild) {
      return;
    }

    if (!form.channelInput.trim()) {
      setError(`Informe o canal da ${label}.`);
      return;
    }

    setValidating(true);
    setError(null);
    setStatus(null);

    try {
      if (isKick) {
        const channel = await validateClipKickChannel(guild.id, form.channelInput, botId);
        setPreview(previewFromKick(channel));
        updateForm("channelInput", channel.kickUsername);
        updateForm("kickChannelUrl", channel.kickUrl);
        updateForm("kickChannelId", channel.kickChannelId ?? "");
      } else {
        const channel = await validateClipTwitchChannel(form.channelInput);
        setPreview(previewFromTwitch(channel));
        updateForm("channelInput", channel.twitchUsername);
      }

      setStatus(`Canal da ${label} validado.`);
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
        configId: editingConfigId,
        platform,
        twitchChannelInput: isKick ? null : form.channelInput,
        kickChannelInput: isKick ? form.channelInput : null,
        kickChannelUrl: isKick ? form.kickChannelUrl || null : null,
        kickChannelId: isKick ? form.kickChannelId || null : null,
        kickApiToken: isKick ? form.kickApiToken || null : null,
        discordChannelId: form.discordChannelId || null,
        allowedRoleIds: form.allowedRoleId ? [form.allowedRoleId] : [],
        mentionType: form.mentionType,
        mentionRoleId: form.mentionType === "role" ? form.mentionRoleId || null : null,
        embedColor: form.embedColor,
        customMessage: form.customMessage,
        clipRewards: form.clipRewards.filter((reward) => reward.roleId),
        enabled: config?.enabled ?? false
      }, botId);

      setConfig(nextConfig);
      setConfigs((current) => upsertConfig(current, nextConfig));
      setForm(formFromConfig(nextConfig, platform));
      setPreview(previewFromConfig(nextConfig));
      setEditingConfigId(nextConfig.id);
      setStatus(`Configuração de clipes ${label} salva.`);
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
      const nextConfig = checked ? await enableClips(guild.id, botId, platform) : await disableClips(guild.id, botId, platform);
      setConfig(nextConfig);
      setConfigs((current) => upsertConfig(current, nextConfig));
      setForm(formFromConfig(nextConfig, platform));
      setStatus(checked ? `Sistema de clipes ${label} ativado.` : `Sistema de clipes ${label} desativado.`);
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
      await testClips(guild.id, botId, platform);
      setStatus("Mensagem de teste enviada.");
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setTesting(false);
    }
  }

  function handleEditConfig(item: ClipsConfig) {
    setConfig(item);
    setEditingConfigId(item.id);
    setForm(formFromConfig(item, platform));
    setPreview(previewFromConfig(item));
    setStatus(`Editando ${item.displayName || item.channelName}.`);
    setError(null);
  }

  function handleNewConfig() {
    setConfig(null);
    setEditingConfigId(null);
    setForm(defaultForm(platform));
    setPreview(null);
    setStatus("Pronto para adicionar outro canal.");
    setError(null);
  }

  async function handleToggleConfig(item: ClipsConfig) {
    if (!guild) return;

    setToggling(true);
    setError(null);
    setStatus(null);

    try {
      const nextConfig = item.enabled
        ? await disableClipsConfigById(guild.id, item.id, botId, platform)
        : await enableClipsConfigById(guild.id, item.id, botId, platform);
      setConfigs((current) => upsertConfig(current, nextConfig));
      if (config?.id === nextConfig.id) {
        setConfig(nextConfig);
      }
      setStatus(nextConfig.enabled ? `Monitoramento ativado para ${nextConfig.channelName}.` : `Monitoramento pausado para ${nextConfig.channelName}.`);
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setToggling(false);
    }
  }

  async function handleDeleteConfig(item: ClipsConfig) {
    if (!guild) return;

    setToggling(true);
    setError(null);
    setStatus(null);

    try {
      await deleteClipsConfigById(guild.id, item.id, botId, platform);
      setConfigs((current) => current.filter((entry) => entry.id !== item.id));
      if (config?.id === item.id) {
        handleNewConfig();
      }
      setStatus(`Canal ${item.channelName} removido.`);
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setToggling(false);
    }
  }

  if (!guild) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-zinc-500">Selecione um servidor para configurar clipes.</CardContent>
      </Card>
    );
  }

  if (!canManage) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-zinc-500">Sua conta não tem permissão para configurar clipes neste servidor.</CardContent>
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
            <h3 className="text-xl font-semibold text-white">{isKick ? "Clipes Kick" : "Clips Twitch"}</h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-500">
              {isKick ? "Canal, lives, ranking e recompensas da Kick." : "Cortes da Twitch por bot e servidor."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button disabled={saving || loading} onClick={handleNewConfig} variant="outline">
            Adicionar canal
          </Button>
          {config?.publicUrl ? (
            <Button asChild variant="outline">
              <a href={config.publicUrl} rel="noreferrer" target="_blank">
                <ExternalLink className="h-4 w-4" />
                Painel publico
              </a>
            </Button>
          ) : null}
          <Button disabled={testing || !config?.discordChannelId} onClick={handleTest} variant="outline">
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Testar envio
          </Button>
          <Button disabled={saving || loading} onClick={handleSave}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar configuração
          </Button>
        </div>
      </div>

      {status ? <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">{status}</div> : null}
      {error ? <div className="rounded-lg border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-100">{error}</div> : null}
      {isKick && config?.providerStatus ? <div className="rounded-lg border border-lime-500/20 bg-lime-500/10 p-4 text-sm text-lime-100">{config.providerStatus}</div> : null}

      <section className="grid gap-4 md:grid-cols-3">
        <StatusCard
          enabled={Boolean(config?.enabled)}
          lastCheckAt={config?.lastCheckAt ?? null}
          loading={loading || toggling}
          onToggle={handleToggle}
          totalSent={config?.totalSent ?? history.length}
        />
        <MetricCard icon={ShieldCheck} label="Cargo liberado" value={form.allowedRoleId ? roleOptions.find((role) => role.id === form.allowedRoleId)?.name ?? "Configurado" : "Nenhum"} />
        <MetricCard icon={Sparkles} label={isKick ? "Status live" : "Intervalo"} value={isKick ? (config?.activeLiveStartedAt ? "Ao vivo" : "Offline") : formatInterval(form.checkInterval)} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{editingConfigId ? "Editar canal" : `Adicionar canal ${label}`}</CardTitle>
              <CardDescription>Canal monitorado para novos clipes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <Field label={`Canal ${label}`}>
                  <input
                    className="social-input"
                    onChange={(event) => updateForm("channelInput", event.target.value)}
                    placeholder={isKick ? "nome-do-canal" : "orvitek"}
                    value={form.channelInput}
                  />
                </Field>
                <Button disabled={validating || !form.channelInput.trim()} onClick={handleValidate} variant="outline">
                  {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                  Validar canal
                </Button>
              </div>

              {isKick ? (
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="URL do canal">
                    <input className="social-input" onChange={(event) => updateForm("kickChannelUrl", event.target.value)} placeholder="https://kick.com/canal" value={form.kickChannelUrl} />
                  </Field>
                  <Field label="ID do canal">
                    <input className="social-input" onChange={(event) => updateForm("kickChannelId", event.target.value)} value={form.kickChannelId} />
                  </Field>
                  <Field label="Token/API">
                    <input className="social-input" onChange={(event) => updateForm("kickApiToken", event.target.value)} placeholder={config?.kickApiTokenConfigured ? "Configurado" : ""} type="password" value={form.kickApiToken} />
                  </Field>
                </div>
              ) : null}

              {preview ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-900 bg-zinc-950/75 p-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="h-11 w-11 rounded-full border border-purple-500/35" fallback={preview.displayName} src={preview.avatar} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{preview.displayName}</p>
                      <p className="truncate text-xs text-zinc-500">@{preview.username}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {preview.followers !== null ? <Badge variant="muted">{formatNumber(preview.followers)} followers</Badge> : null}
                    {preview.isLive !== null ? <Badge variant={preview.isLive ? "success" : "muted"}>{preview.isLive ? "Ao vivo" : "Offline"}</Badge> : null}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Canal de logs</CardTitle>
              <CardDescription>Destino no Discord e permissão para configurar.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="Canal Discord">
                <select className="social-input" onChange={(event) => updateForm("discordChannelId", event.target.value)} value={form.discordChannelId}>
                  <option value="">Não enviar no Discord</option>
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
              <CardTitle>Recompensas por clipes</CardTitle>
              <CardDescription>Cargos entregues quando o criador atingir a meta.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {form.clipRewards.map((reward, index) => (
                <Field key={reward.clipCount} label={`${reward.clipCount} clipes - ${reward.label}`}>
                  <select className="social-input" onChange={(event) => updateReward(index, event.target.value)} value={reward.roleId}>
                    <option value="">Sem cargo</option>
                    {roleOptions.map((role) => (
                      <option key={role.id} value={role.id}>@{role.name}</option>
                    ))}
                  </select>
                </Field>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Personalização</CardTitle>
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
              <CardTitle>Canais cadastrados</CardTitle>
              <CardDescription>Monitoramento independente por bot, servidor e canal.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <input
                className="social-input"
                onChange={(event) => setConfigSearch(event.target.value)}
                placeholder={`Buscar canal ${label}`}
                value={configSearch}
              />
              <ClipsConfigList
                configs={configs}
                loading={loading}
                onDelete={handleDeleteConfig}
                onEdit={handleEditConfig}
                onToggle={handleToggleConfig}
                toggling={toggling}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Preview do embed</CardTitle>
              <CardDescription>Exemplo do alerta enviado no Discord.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-zinc-800 bg-[#111214] p-4">
                {previewMessage ? <p className="mb-3 text-sm text-zinc-200">{previewMessage}</p> : null}
                <div className="border-l-4 bg-zinc-950/80 p-4" style={{ borderColor: safeColor(form.embedColor, platform) }}>
                  <h4 className="text-base font-semibold text-white">Novo Clipe Detectado</h4>
                  <p className="mt-2 text-sm text-zinc-300">Um novo corte foi criado na live de {streamerName}.</p>
                  <div className="mt-4 grid gap-3 text-sm">
                    <PreviewField label="Canal" value={streamerName} />
                    <PreviewField label="Nome do Clipe" value="Melhor momento da live" />
                    <PreviewField label="Criador" value="NomeDaPessoa" />
                    <PreviewField label="Link" value={isKick ? "https://kick.com/canal?clip=..." : "https://clips.twitch.tv/..."} />
                  </div>
                  <div className="mt-4 aspect-video rounded-lg border border-zinc-800 bg-zinc-900" />
                  <p className="mt-3 text-xs text-zinc-500">Sistema de Clips {label} - {guild.name}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Painel de clipes</CardTitle>
                  <CardDescription>Lista, ranking e estatisticas.</CardDescription>
                </div>
                <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-1">
                  <TabButton active={activeTab === "clips"} icon={Film} label="Clipes" onClick={() => setActiveTab("clips")} />
                  <TabButton active={activeTab === "ranking"} icon={Trophy} label="Ranking" onClick={() => setActiveTab("ranking")} />
                  <TabButton active={activeTab === "stats"} icon={BarChart3} label="Stats" onClick={() => setActiveTab("stats")} />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {filters.map((item) => (
                  <button
                    className={[
                      "rounded-lg border px-3 py-2 text-xs font-medium transition",
                      filter === item.id
                        ? "border-white/20 bg-white text-black"
                        : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:border-zinc-700 hover:text-white"
                    ].join(" ")}
                    key={item.id}
                    onClick={() => setFilter(item.id)}
                    type="button"
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {activeTab === "clips" ? <ClipsHistory clips={history} loading={loading} /> : null}
              {activeTab === "ranking" ? <RankingList ranking={ranking} /> : null}
              {activeTab === "stats" ? <StatsPanel stats={stats} /> : null}
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
          <p className="mt-2 text-xs text-zinc-600">Última verificação: {lastCheckAt ? formatDate(lastCheckAt) : "Nunca"}</p>
        </div>
        {loading ? <Loader2 className="h-5 w-5 animate-spin text-zinc-500" /> : <Switch checked={enabled} onCheckedChange={onToggle} />}
      </CardContent>
    </Card>
  );
}

function ClipsConfigList({
  configs,
  loading,
  onDelete,
  onEdit,
  onToggle,
  toggling
}: {
  configs: ClipsConfig[];
  loading: boolean;
  onDelete: (config: ClipsConfig) => void;
  onEdit: (config: ClipsConfig) => void;
  onToggle: (config: ClipsConfig) => void;
  toggling: boolean;
}) {
  if (loading) {
    return <div className="rounded-lg border border-zinc-900 bg-zinc-950/60 p-6 text-center text-sm text-zinc-500">Carregando canais...</div>;
  }

  if (!configs.length) {
    return <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 p-6 text-center text-sm text-zinc-500">Nenhum canal cadastrado ainda.</div>;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-900">
      <div className="grid grid-cols-[1.4fr_0.8fr_0.8fr_auto] gap-3 border-b border-zinc-900 bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-500">
        <span>Canal</span>
        <span>Status</span>
        <span>Última verificação</span>
        <span className="text-right">Acoes</span>
      </div>
      <div className="divide-y divide-zinc-900">
        {configs.map((item) => (
          <div className="grid grid-cols-1 gap-3 bg-zinc-950/50 px-3 py-3 text-sm sm:grid-cols-[1.4fr_0.8fr_0.8fr_auto] sm:items-center" key={item.id}>
            <button className="flex min-w-0 items-center gap-3 text-left" onClick={() => onEdit(item)} type="button">
              <Avatar className="h-9 w-9 rounded-full border border-zinc-800" fallback={item.displayName || item.channelName} src={item.avatar} />
              <span className="min-w-0">
                <span className="block truncate font-medium text-white">{item.displayName || item.channelName}</span>
                <span className="block truncate text-xs text-zinc-500">{item.discordChannelId ? `Discord: ${item.discordChannelId}` : "Sem canal Discord"}</span>
              </span>
            </button>
            <div className="flex flex-wrap gap-2">
              <Badge variant={item.enabled ? "success" : "muted"}>{item.enabled ? "Ativo" : "Pausado"}</Badge>
              <Badge variant="muted">{formatNumber(item.totalSent)} clipes</Badge>
            </div>
            <span className="text-xs text-zinc-500">{item.lastCheckAt ? formatDate(item.lastCheckAt) : "Nunca"}</span>
            <div className="flex justify-end gap-2">
              <Button disabled={toggling || !item.discordChannelId} onClick={() => onToggle(item)} size="sm" type="button" variant="outline">
                {item.enabled ? "Pausar" : "Ativar"}
              </Button>
              <Button onClick={() => onEdit(item)} size="sm" type="button" variant="outline">
                Editar
              </Button>
              <Button disabled={toggling} onClick={() => onDelete(item)} size="sm" type="button" variant="outline">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
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

function ClipsHistory({ clips, loading }: { clips: ClipSent[]; loading: boolean }) {
  if (loading) {
    return <div className="rounded-lg border border-zinc-900 bg-zinc-950/60 p-6 text-center text-sm text-zinc-500">Carregando clipes...</div>;
  }

  if (!clips.length) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 p-6 text-center text-sm text-zinc-500">
        Nenhum clipe registrado ainda.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {clips.map((clip) => (
        <a
          className="grid gap-3 rounded-lg border border-zinc-900 bg-zinc-950/75 p-3 transition hover:border-zinc-700 hover:bg-zinc-900 sm:grid-cols-[96px_1fr_auto] sm:items-center"
          href={clip.clipUrl}
          key={clip.id}
          rel="noreferrer"
          target="_blank"
        >
          <div className="aspect-video rounded-lg border border-zinc-800 bg-zinc-900 bg-cover bg-center" style={clip.clipThumbnail ? { backgroundImage: `url(${clip.clipThumbnail})` } : undefined} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{clip.clipTitle}</p>
            <p className="mt-1 truncate text-xs text-zinc-500">{clip.clipCreatorName || "Criador desconhecido"} - {formatDate(clip.sentAt)}</p>
            {clip.clipDuration ? <p className="mt-1 text-xs text-zinc-600">{formatDuration(clip.clipDuration)}</p> : null}
          </div>
          <ExternalLink className="hidden h-4 w-4 shrink-0 text-zinc-500 sm:block" />
        </a>
      ))}
    </div>
  );
}

function RankingList({ ranking }: { ranking: ClipRankingEntry[] }) {
  if (!ranking.length) {
    return <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 p-6 text-center text-sm text-zinc-500">Ranking vazio.</div>;
  }

  return (
    <div className="space-y-2">
      {ranking.map((entry, index) => (
        <div className="grid grid-cols-[52px_1fr_80px] items-center gap-3 rounded-lg border border-zinc-900 bg-zinc-950/75 px-3 py-2" key={entry.username}>
          <span className="text-sm font-semibold text-white">{index + 1}º</span>
          <span className="truncate text-sm text-zinc-300">{entry.username}</span>
          <Badge variant="muted">{entry.count}</Badge>
        </div>
      ))}
    </div>
  );
}

function StatsPanel({ stats }: { stats: ClipStats | null }) {
  if (!stats) {
    return <div className="rounded-lg border border-zinc-900 bg-zinc-950/60 p-6 text-center text-sm text-zinc-500">Carregando estatisticas...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <SmallStat label="Total" value={formatNumber(stats.total)} />
        <SmallStat label="Hoje" value={formatNumber(stats.today)} />
        <SmallStat label="Semana" value={formatNumber(stats.week)} />
        <SmallStat label="Mes" value={formatNumber(stats.month)} />
        <SmallStat label="Top criador" value={stats.topCreator?.username ?? "Nenhum"} />
        <SmallStat label="Media diaria" value={String(stats.dailyAverage)} />
      </div>
      <Series title="Clipes por dia" values={stats.clipsByDay} />
      <Series title="Clipes por semana" values={stats.clipsByWeek} />
      <Series title="Clipes por mes" values={stats.clipsByMonth} />
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-900 bg-zinc-950/75 p-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function Series({ title, values }: { title: string; values: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...values.map((item) => item.value));

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-zinc-500">{title}</p>
      <div className="space-y-2">
        {values.length ? values.slice(-8).map((item) => (
          <div className="grid grid-cols-[90px_1fr_42px] items-center gap-2" key={item.label}>
            <span className="truncate text-xs text-zinc-500">{item.label}</span>
            <div className="h-2 rounded-full bg-zinc-900">
              <div className="h-2 rounded-full bg-white" style={{ width: `${Math.max(8, (item.value / max) * 100)}%` }} />
            </div>
            <span className="text-right text-xs text-zinc-500">{item.value}</span>
          </div>
        )) : <p className="text-xs text-zinc-600">Sem dados.</p>}
      </div>
    </div>
  );
}

function TabButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      className={[
        "flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition",
        active ? "bg-white text-black" : "text-zinc-500 hover:bg-zinc-900 hover:text-white"
      ].join(" ")}
      onClick={onClick}
      type="button"
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
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

function defaultForm(platform: ClipPlatform): ClipsForm {
  return {
    allowedRoleId: "",
    channelInput: "",
    checkInterval: 30_000,
    clipRewards: rewardPresets,
    customMessage: "Novo corte criado na live do {streamer}!",
    discordChannelId: "",
    embedColor: platform === "kick" ? "#53FC18" : "#9146FF",
    kickApiToken: "",
    kickChannelId: "",
    kickChannelUrl: "",
    mentionRoleId: "",
    mentionType: "none"
  };
}

function formFromConfig(config: ClipsConfig | null, platform: ClipPlatform): ClipsForm {
  if (!config) {
    return defaultForm(platform);
  }

  const rewardsByCount = new Map(config.clipRewards.map((reward) => [reward.clipCount, reward]));

  return {
    allowedRoleId: config.allowedRoleIds[0] ?? "",
    channelInput: platform === "kick" ? config.kickChannelName ?? "" : config.twitchChannelName,
    checkInterval: config.checkInterval,
    clipRewards: rewardPresets.map((preset) => rewardsByCount.get(preset.clipCount) ?? preset),
    customMessage: config.customMessage ?? defaultForm(platform).customMessage,
    discordChannelId: config.discordChannelId ?? "",
    embedColor: config.embedColor,
    kickApiToken: "",
    kickChannelId: config.kickChannelId ?? "",
    kickChannelUrl: config.kickChannelUrl ?? "",
    mentionRoleId: config.mentionRoleId ?? "",
    mentionType: config.mentionType
  };
}

function upsertConfig(configs: ClipsConfig[], nextConfig: ClipsConfig) {
  const exists = configs.some((config) => config.id === nextConfig.id);
  const next = exists
    ? configs.map((config) => config.id === nextConfig.id ? nextConfig : config)
    : [nextConfig, ...configs];

  return next.sort((left, right) => Number(right.enabled) - Number(left.enabled) || new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

function previewFromConfig(config: ClipsConfig | null): ChannelPreview | null {
  if (!config?.channelName) {
    return null;
  }

  return {
    avatar: config.avatar,
    displayName: config.displayName || config.channelName,
    followers: config.followers,
    isLive: config.platform === "kick" ? Boolean(config.activeLiveStartedAt) : null,
    url: config.channelUrl || "#",
    username: config.channelName
  };
}

function previewFromTwitch(channel: TwitchClipChannelPreview): ChannelPreview {
  return {
    avatar: channel.twitchAvatar,
    displayName: channel.twitchDisplayName,
    followers: null,
    isLive: null,
    url: channel.twitchUrl,
    username: channel.twitchUsername
  };
}

function previewFromKick(channel: KickClipChannelPreview): ChannelPreview {
  return {
    avatar: channel.kickAvatar,
    displayName: channel.kickDisplayName,
    followers: channel.kickFollowers,
    isLive: channel.isLive,
    url: channel.kickUrl,
    username: channel.kickUsername
  };
}

function safeColor(value: string, platform: ClipPlatform) {
  const fallback = platform === "kick" ? "#53FC18" : "#9146FF";
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit"
  }).format(new Date(value));
}

function formatDuration(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatInterval(value: number) {
  return value < 60_000 ? `${Math.round(value / 1000)} seg` : `${Math.round(value / 60000)} min`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function readErrorMessage(error: unknown) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? "Não foi possível concluir a ação.";
  }

  return "Não foi possível concluir a ação.";
}

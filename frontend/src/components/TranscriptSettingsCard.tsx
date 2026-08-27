import { useEffect, useState, type CSSProperties } from "react";
import { AlertTriangle, FileText, Loader2, Palette, RotateCcw, Save } from "lucide-react";
import { getGuildLiveOptions, getGuildRoleOptions, patchGuildSettings } from "../lib/api";
import type { DashboardGuild, GlobalLogConfig, GuildChannelOption, GuildRoleOption, GuildSettings, TranscriptTheme } from "../types";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Switch } from "./ui/switch";

type TranscriptSettingsCardProps = {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
  loading?: boolean;
  onSettingsChange: (settings: GuildSettings) => void;
  settings: GuildSettings | null;
};

const DEFAULT_TRANSCRIPT_THEME: TranscriptTheme = {
  logoUrl: null,
  brandName: "Nevsec",
  primaryColor: "#f5c542",
  secondaryColor: "#38bdf8",
  accentColor: "#f43f5e",
  backgroundColor: "#07080d",
  secondaryBackgroundColor: "#10131d",
  cardColor: "#151925",
  messageColor: "#111522",
  borderColor: "#2b3143",
  textColor: "#f8fafc",
  mutedTextColor: "#a1a8b8",
  buttonColor: "#f5c542",
  linkColor: "#7dd3fc",
  titleColor: "#ffffff",
  iconColor: "#f5c542",
  statusColor: "#22c55e",
  hoverColor: "#232a3c",
  searchColor: "#0d111c",
  mode: "dark",
  density: "normal",
  cardRadius: "rounded",
  style: "tech",
  showNevsecBranding: true,
  labels: {
    pageTitle: "Transcrição de atendimento",
    summaryTitle: "Resumo da transcrição",
    contactTitle: "Detalhes do contato",
    conversationTitle: "Conversa",
    searchPlaceholder: "Buscar na conversa",
    openedAt: "Aberto em",
    closedAt: "Fechado em",
    duration: "Duração",
    messages: "Mensagens",
    openedBy: "Aberto por",
    assumedBy: "Assumido por",
    category: "Categoria",
    subject: "Assunto",
    status: "Status",
    ticketId: "ID do ticket",
    transcriptId: "ID do transcript",
    endOfConversation: "Fim da conversa",
    footerText: "Atendimento encerrado e preservado pela Nevsec."
  }
};

const PALETTES: Array<{ name: string; theme: Partial<TranscriptTheme> }> = [
  { name: "Nevsec", theme: {} },
  { name: "Dark", theme: { primaryColor: "#e5e7eb", secondaryColor: "#94a3b8", accentColor: "#64748b", backgroundColor: "#030712", cardColor: "#111827", messageColor: "#0f172a", buttonColor: "#e5e7eb", linkColor: "#93c5fd" } },
  { name: "Blue", theme: { primaryColor: "#38bdf8", secondaryColor: "#2563eb", accentColor: "#22d3ee", backgroundColor: "#06111f", cardColor: "#0d1b2e", messageColor: "#0a1627", buttonColor: "#38bdf8", linkColor: "#7dd3fc" } },
  { name: "Purple", theme: { primaryColor: "#a78bfa", secondaryColor: "#7c3aed", accentColor: "#e879f9", backgroundColor: "#120d1f", cardColor: "#1d1630", messageColor: "#171126", buttonColor: "#a78bfa", linkColor: "#c4b5fd" } },
  { name: "Red", theme: { primaryColor: "#fb7185", secondaryColor: "#ef4444", accentColor: "#f97316", backgroundColor: "#19090e", cardColor: "#241017", messageColor: "#1d0d13", buttonColor: "#fb7185", linkColor: "#fda4af" } },
  { name: "Green", theme: { primaryColor: "#4ade80", secondaryColor: "#16a34a", accentColor: "#a3e635", backgroundColor: "#06140d", cardColor: "#0d1f14", messageColor: "#0a1810", buttonColor: "#4ade80", linkColor: "#86efac" } },
  { name: "Gold", theme: { primaryColor: "#facc15", secondaryColor: "#f59e0b", accentColor: "#fde047", backgroundColor: "#141006", cardColor: "#211a0c", messageColor: "#1a1408", buttonColor: "#facc15", linkColor: "#fde68a" } },
  { name: "Discord", theme: { primaryColor: "#5865f2", secondaryColor: "#4752c4", accentColor: "#57f287", backgroundColor: "#1e1f22", cardColor: "#2b2d31", messageColor: "#313338", buttonColor: "#5865f2", linkColor: "#00a8fc" } },
  { name: "Cyber", theme: { primaryColor: "#00f5d4", secondaryColor: "#00bbf9", accentColor: "#fee440", backgroundColor: "#020617", cardColor: "#07111f", messageColor: "#081426", buttonColor: "#00f5d4", linkColor: "#67e8f9" } },
  { name: "Ocean", theme: { primaryColor: "#2dd4bf", secondaryColor: "#0ea5e9", accentColor: "#38bdf8", backgroundColor: "#05202b", cardColor: "#0b2a36", messageColor: "#08242f", buttonColor: "#2dd4bf", linkColor: "#7dd3fc" } },
  { name: "Rose", theme: { primaryColor: "#f472b6", secondaryColor: "#fb7185", accentColor: "#f9a8d4", backgroundColor: "#1f0a17", cardColor: "#2b1020", messageColor: "#240d1b", buttonColor: "#f472b6", linkColor: "#fbcfe8" } }
];

export function TranscriptSettingsCard({
  botId,
  canManage,
  guild,
  loading = false,
  onSettingsChange,
  settings
}: TranscriptSettingsCardProps) {
  const [draft, setDraft] = useState<GlobalLogConfig | null>(settings?.globalLogConfig ? withTranscriptTheme(settings.globalLogConfig) : null);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(settings?.globalLogConfig ? withTranscriptTheme(settings.globalLogConfig) : null);
  }, [settings?.globalLogConfig]);

  useEffect(() => {
    if (!guild) {
      setChannels([]);
      setRoles([]);
      return;
    }

    setLoadingOptions(true);
    setError(null);

    Promise.all([getGuildLiveOptions(guild.id, botId), getGuildRoleOptions(guild.id, botId)])
      .then(([channelOptions, roleOptions]) => {
        setChannels(channelOptions.channels);
        setRoles(roleOptions.filter((role) => role.id !== guild.id));
      })
      .catch((requestError) => {
        setChannels([]);
        setRoles([]);
        setError(readErrorMessage(requestError, "Não foi possível carregar canais e cargos."));
      })
      .finally(() => setLoadingOptions(false));
  }, [botId, guild]);

  function update<K extends keyof GlobalLogConfig>(key: K, value: GlobalLogConfig[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  }

  function updateTheme<K extends keyof TranscriptTheme>(key: K, value: TranscriptTheme[K]) {
    setDraft((current) => current ? {
      ...current,
      transcriptTheme: {
        ...current.transcriptTheme,
        [key]: value
      }
    } : current);
  }

  function updateLabel<K extends keyof TranscriptTheme["labels"]>(key: K, value: string) {
    setDraft((current) => current ? {
      ...current,
      transcriptTheme: {
        ...current.transcriptTheme,
        labels: {
          ...current.transcriptTheme.labels,
          [key]: value
        }
      }
    } : current);
  }

  function applyPalette(theme: Partial<TranscriptTheme>) {
    setDraft((current) => current ? {
      ...current,
      panelColor: theme.primaryColor ?? current.panelColor,
      transcriptTheme: {
        ...current.transcriptTheme,
        ...theme
      }
    } : current);
  }

  async function save() {
    if (!guild || !settings || !draft || !canManage) return;

    setSaving(true);
    setStatus(null);
    setError(null);

    const warnings = getContrastWarnings(draft.transcriptTheme);
    if (warnings.length) {
      setSaving(false);
      setError(`A aparência não foi salva: ${warnings.join(" ")}`);
      return;
    }

    try {
      const saved = await patchGuildSettings(guild.id, { globalLogConfig: draft }, botId);
      onSettingsChange(saved);
      setStatus("Configuração de transcript salva.");
    } catch (requestError) {
      setError(readErrorMessage(requestError, "Não foi possível salvar a configuração de transcript."));
    } finally {
      setSaving(false);
    }
  }

  if (!guild || !settings || !draft) return null;

  const disabled = !canManage || loading || loadingOptions || saving;
  const theme = draft.transcriptTheme;
  const contrastWarnings = getContrastWarnings(theme);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-blue-300" />
            Transcript policial
          </CardTitle>
          <CardDescription>
            Ative e direcione os transcripts usados pelos sistemas da policia.
          </CardDescription>
        </div>
        <Button disabled={disabled} onClick={() => void save()} size="sm" type="button">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Salvar
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
        {status ? <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{status}</p> : null}

        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium text-zinc-200">
            Canal de transcripts
            <select
              className="mt-2 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100"
              disabled={disabled}
              onChange={(event) => update("transcriptChannelId", event.target.value || null)}
              value={draft.transcriptChannelId ?? ""}
            >
              <option value="">Não definido</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>#{channel.name}</option>
              ))}
            </select>
          </label>

          <label className="text-sm font-medium text-zinc-200">
            Cargo que pode abrir transcripts
            <select
              className="mt-2 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100"
              disabled={disabled}
              onChange={(event) => update("transcriptViewRoleId", event.target.value || null)}
              value={draft.transcriptViewRoleId ?? ""}
            >
              <option value="">Mesmo acesso dos logs</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>@{role.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <ToggleRow
            checked={draft.transcriptRequired}
            disabled={disabled}
            label="Transcript obrigatório"
            onChange={(checked) => update("transcriptRequired", checked)}
          />
          <ToggleRow
            checked={draft.transcriptWebsiteEnabled}
            disabled={disabled}
            label="Salvar no site"
            onChange={(checked) => update("transcriptWebsiteEnabled", checked)}
          />
          <ToggleRow
            checked={draft.transcriptTextEnabled}
            disabled={disabled}
            label="Gerar arquivo texto"
            onChange={(checked) => update("transcriptTextEnabled", checked)}
          />
        </div>

        <label className="block text-sm font-medium text-zinc-200 md:max-w-xs">
          Expiracao em dias
          <input
            className="mt-2 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100"
            disabled={disabled}
            min={1}
            onChange={(event) => update("transcriptExpirationDays", event.target.value ? Math.max(1, Number(event.target.value) || 1) : null)}
            placeholder="Sem expiracao"
            type="number"
            value={draft.transcriptExpirationDays ?? ""}
          />
        </label>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
          <div className="space-y-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                    <Palette className="h-4 w-4 text-yellow-300" />
                    Aparência do Transcript
                  </h3>
                  <p className="mt-1 text-xs text-zinc-500">Configuração isolada para este cliente/servidor.</p>
                </div>
                <Button disabled={disabled} onClick={() => applyPalette(DEFAULT_TRANSCRIPT_THEME)} size="sm" type="button" variant="outline">
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Restaurar
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {PALETTES.map((palette) => (
                  <button
                    className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-200 transition hover:border-yellow-300/70"
                    disabled={disabled}
                    key={palette.name}
                    onClick={() => applyPalette({ ...DEFAULT_TRANSCRIPT_THEME, ...palette.theme })}
                    type="button"
                  >
                    {palette.name}
                  </button>
                ))}
              </div>
            </div>

            {contrastWarnings.length ? (
              <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
                <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />Ajuste de contraste recomendado</p>
                <p className="mt-1 text-xs text-amber-100/80">{contrastWarnings.join(" ")}</p>
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
              <TextInput disabled={disabled} label="Nome exibido" onChange={(value) => updateTheme("brandName", value || null)} value={theme.brandName ?? ""} />
              <TextInput disabled={disabled} label="Logo URL" onChange={(value) => updateTheme("logoUrl", value || null)} value={theme.logoUrl ?? ""} />
              <ColorInput disabled={disabled} label="Cor principal" onChange={(value) => updateTheme("primaryColor", value)} value={theme.primaryColor} />
              <ColorInput disabled={disabled} label="Cor secundária" onChange={(value) => updateTheme("secondaryColor", value)} value={theme.secondaryColor} />
              <ColorInput disabled={disabled} label="Destaque" onChange={(value) => updateTheme("accentColor", value)} value={theme.accentColor} />
              <ColorInput disabled={disabled} label="Botões" onChange={(value) => updateTheme("buttonColor", value)} value={theme.buttonColor} />
              <ColorInput disabled={disabled} label="Links" onChange={(value) => updateTheme("linkColor", value)} value={theme.linkColor} />
              <ColorInput disabled={disabled} label="Fundo principal" onChange={(value) => updateTheme("backgroundColor", value)} value={theme.backgroundColor} />
              <ColorInput disabled={disabled} label="Fundo secundário" onChange={(value) => updateTheme("secondaryBackgroundColor", value)} value={theme.secondaryBackgroundColor} />
              <ColorInput disabled={disabled} label="Cards" onChange={(value) => updateTheme("cardColor", value)} value={theme.cardColor} />
              <ColorInput disabled={disabled} label="Mensagens" onChange={(value) => updateTheme("messageColor", value)} value={theme.messageColor} />
              <ColorInput disabled={disabled} label="Bordas" onChange={(value) => updateTheme("borderColor", value)} value={theme.borderColor} />
              <ColorInput disabled={disabled} label="Texto" onChange={(value) => updateTheme("textColor", value)} value={theme.textColor} />
              <ColorInput disabled={disabled} label="Texto secundário" onChange={(value) => updateTheme("mutedTextColor", value)} value={theme.mutedTextColor} />
              <ColorInput disabled={disabled} label="Campo de busca" onChange={(value) => updateTheme("searchColor", value)} value={theme.searchColor} />
              <ColorInput disabled={disabled} label="Hover" onChange={(value) => updateTheme("hoverColor", value)} value={theme.hoverColor} />
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <SelectInput disabled={disabled} label="Densidade" onChange={(value) => updateTheme("density", value as TranscriptTheme["density"])} options={[["compact", "Compacto"], ["normal", "Normal"], ["spacious", "Espaçoso"]]} value={theme.density} />
              <SelectInput disabled={disabled} label="Cards" onChange={(value) => updateTheme("cardRadius", value as TranscriptTheme["cardRadius"])} options={[["square", "Quadrado"], ["rounded", "Arredondado"], ["pill", "Muito arredondado"]]} value={theme.cardRadius} />
              <SelectInput disabled={disabled} label="Aparência" onChange={(value) => updateTheme("mode", value as TranscriptTheme["mode"])} options={[["dark", "Dark"], ["light", "Light"], ["auto", "Automático"]]} value={theme.mode} />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <TextInput disabled={disabled} label="Título" onChange={(value) => updateLabel("pageTitle", value)} value={theme.labels.pageTitle} />
              <TextInput disabled={disabled} label="Resumo" onChange={(value) => updateLabel("summaryTitle", value)} value={theme.labels.summaryTitle} />
              <TextInput disabled={disabled} label="Contato" onChange={(value) => updateLabel("contactTitle", value)} value={theme.labels.contactTitle} />
              <TextInput disabled={disabled} label="Conversa" onChange={(value) => updateLabel("conversationTitle", value)} value={theme.labels.conversationTitle} />
              <TextInput disabled={disabled} label="Busca" onChange={(value) => updateLabel("searchPlaceholder", value)} value={theme.labels.searchPlaceholder} />
              <TextInput disabled={disabled} label="Rodapé" onChange={(value) => updateLabel("footerText", value)} value={theme.labels.footerText} />
            </div>

            <ToggleRow checked={theme.showNevsecBranding} disabled={disabled} label="Exibir Nevsec como tecnologia responsável" onChange={(checked) => updateTheme("showNevsecBranding", checked)} />
          </div>

          <TranscriptPreview theme={theme} />
        </div>
      </CardContent>
    </Card>
  );
}

function ToggleRow({ checked, disabled, label, onChange }: { checked: boolean; disabled: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm text-zinc-200">
      <span>{label}</span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  );
}

function TextInput({ disabled, label, onChange, value }: { disabled: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="grid gap-2 text-sm font-medium text-zinc-200">
      {label}
      <input
        className="h-10 rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100 outline-none transition focus:border-[#FFD500]/60"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function ColorInput({ disabled, label, onChange, value }: { disabled: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="grid gap-2 text-sm font-medium text-zinc-200">
      {label}
      <span className="flex overflow-hidden rounded-md border border-zinc-800 bg-[#09090b]">
        <input className="h-10 w-12 border-0 bg-transparent p-1" disabled={disabled} onChange={(event) => onChange(event.target.value)} type="color" value={value} />
        <input className="h-10 min-w-0 flex-1 bg-transparent px-2 text-sm text-zinc-100 outline-none" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value} />
      </span>
    </label>
  );
}

function SelectInput({ disabled, label, onChange, options, value }: { disabled: boolean; label: string; onChange: (value: string) => void; options: Array<[string, string]>; value: string }) {
  return (
    <label className="grid gap-2 text-sm font-medium text-zinc-200">
      {label}
      <select className="h-10 rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100 outline-none transition focus:border-[#FFD500]/60" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  );
}

function TranscriptPreview({ theme }: { theme: TranscriptTheme }) {
  const style = {
    "--preview-bg": theme.backgroundColor,
    "--preview-bg2": theme.secondaryBackgroundColor,
    "--preview-card": theme.cardColor,
    "--preview-message": theme.messageColor,
    "--preview-border": theme.borderColor,
    "--preview-text": theme.textColor,
    "--preview-muted": theme.mutedTextColor,
    "--preview-primary": theme.primaryColor,
    "--preview-secondary": theme.secondaryColor,
    "--preview-button": theme.buttonColor,
    "--preview-link": theme.linkColor,
    "--preview-title": theme.titleColor,
    "--preview-search": theme.searchColor
  } as CSSProperties;
  const radius = theme.cardRadius === "square" ? "rounded-sm" : theme.cardRadius === "pill" ? "rounded-2xl" : "rounded-lg";
  return (
    <div className="sticky top-4 h-fit">
      <div className="mb-2 text-sm font-semibold text-zinc-100">Preview ao vivo</div>
      <div className={`border p-4 shadow-2xl ${radius}`} style={{ ...style, background: "linear-gradient(180deg,var(--preview-bg),var(--preview-bg2))", borderColor: "var(--preview-border)", color: "var(--preview-text)" }}>
        <div className={`flex items-start justify-between gap-3 border-l-4 p-3 ${radius}`} style={{ borderColor: "var(--preview-primary)", background: "var(--preview-card)" }}>
          <div className="flex min-w-0 items-center gap-3">
            {theme.logoUrl ? <img alt="" className="h-10 w-10 rounded-lg object-cover" src={theme.logoUrl} /> : <div className="grid h-10 w-10 place-items-center rounded-lg text-sm font-black" style={{ background: "var(--preview-primary)", color: "var(--preview-bg)" }}>{(theme.brandName || "N").slice(0, 1)}</div>}
            <div className="min-w-0">
              <div className="truncate text-xs font-bold uppercase" style={{ color: "var(--preview-primary)" }}>{theme.brandName || "Nevsec"}</div>
              <div className="truncate text-lg font-black" style={{ color: "var(--preview-title)" }}>{theme.labels.pageTitle}</div>
            </div>
          </div>
          <button className="rounded-md px-2 py-1 text-xs font-bold" style={{ background: "var(--preview-button)", color: "var(--preview-bg)" }} type="button">Link</button>
        </div>
        <div className="mt-4">
          <div className="mb-2 text-sm font-bold" style={{ color: "var(--preview-title)" }}>{theme.labels.summaryTitle}</div>
          <div className="grid grid-cols-2 gap-2">
            {[[theme.labels.openedAt, "27/08/2026 18:00"], [theme.labels.closedAt, "27/08/2026 18:35"], [theme.labels.duration, "35min"], [theme.labels.messages, "48"]].map(([label, value]) => (
              <div className={`border p-2 ${radius}`} key={label} style={{ borderColor: "var(--preview-border)", background: "var(--preview-card)" }}>
                <div className="text-[11px]" style={{ color: "var(--preview-muted)" }}>{label}</div>
                <div className="truncate text-sm font-bold">{value}</div>
              </div>
            ))}
          </div>
        </div>
        <div className={`mt-4 border p-3 ${radius}`} style={{ borderColor: "var(--preview-border)", background: "var(--preview-card)" }}>
          <div className="mb-2 text-sm font-bold" style={{ color: "var(--preview-title)" }}>{theme.labels.conversationTitle}</div>
          <div className="mb-2 rounded-md border px-3 py-2 text-xs" style={{ borderColor: "var(--preview-border)", background: "var(--preview-search)", color: "var(--preview-muted)" }}>{theme.labels.searchPlaceholder}</div>
          <div className={`border p-3 ${radius}`} style={{ borderColor: "var(--preview-border)", background: "var(--preview-message)" }}>
            <div className="flex items-center gap-2 text-sm"><span className="font-bold">Vilão</span><span className="text-xs" style={{ color: "var(--preview-muted)" }}>18:10</span></div>
            <p className="mt-1 text-sm">queria fazer um orçamento</p>
            <a className="text-xs" style={{ color: "var(--preview-link)" }}>anexo.png</a>
          </div>
        </div>
        <p className="mt-3 text-center text-xs" style={{ color: "var(--preview-muted)" }}>{theme.labels.footerText}{theme.showNevsecBranding ? " Tecnologia Nevsec." : ""}</p>
      </div>
    </div>
  );
}

function withTranscriptTheme(config: GlobalLogConfig): GlobalLogConfig {
  return {
    ...config,
    transcriptTheme: {
      ...DEFAULT_TRANSCRIPT_THEME,
      ...(config.transcriptTheme ?? {}),
      labels: {
        ...DEFAULT_TRANSCRIPT_THEME.labels,
        ...(config.transcriptTheme?.labels ?? {})
      }
    }
  };
}

function getContrastWarnings(theme: TranscriptTheme) {
  const warnings: string[] = [];
  if (contrastRatio(theme.textColor, theme.backgroundColor) < 4.5) warnings.push("Texto e fundo principal estão com baixo contraste.");
  if (contrastRatio(theme.textColor, theme.cardColor) < 4.5) warnings.push("Texto e cards estão com baixo contraste.");
  if (contrastRatio(theme.textColor, theme.messageColor) < 4.5) warnings.push("Texto e mensagens estão com baixo contraste.");
  return warnings;
}

function contrastRatio(foreground: string, background: string) {
  const fg = relativeLuminance(foreground);
  const bg = relativeLuminance(background);
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string) {
  const rgb = hex.replace("#", "").match(/.{2}/g)?.map((value) => parseInt(value, 16) / 255) ?? [0, 0, 0];
  const [r, g, b] = rgb.map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function readErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

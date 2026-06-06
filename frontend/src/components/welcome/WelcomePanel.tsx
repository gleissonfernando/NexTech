import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Hash, ImageIcon, Send, Upload } from "lucide-react";
import {
  API_URL,
  getGuildLiveOptions,
  patchGuildSettings,
  testLeavePanel,
  testWelcomePanel,
  uploadLeaveImage,
  uploadWelcomeImage
} from "../../lib/api";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";
import type { DashboardGuild, GuildChannelOption, GuildSettings } from "../../types";

type MemberPanelMode = "welcome" | "leave";

type WelcomePanelProps = {
  canManage: boolean;
  guild: DashboardGuild | null;
  mode?: MemberPanelMode;
  onSettingsChange: (settings: GuildSettings) => void;
  settings: GuildSettings | null;
  viewerName: string;
};

const DEFAULT_WELCOME_IMAGE_URL = "/uploads/welcome/default.gif?v=3";

const panelConfig = {
  welcome: {
    channelKey: "welcomeChannelId",
    description: "Entrada de membros",
    displayChannelKey: "welcomeDisplayChannelId",
    enabledKey: "welcomeEnabled",
    imageKey: "welcomeImageUrl",
    missingGuildText: "Selecione um servidor para configurar entrada.",
    savedImageText: "GIF de entrada atualizado.",
    testButtonText: "Testar entrada",
    testSentText: "Painel de entrada enviado para teste.",
    title: "Painel de entrada",
    toggleLabel: "Entrada"
  },
  leave: {
    channelKey: "leaveChannelId",
    description: "Saida de membros",
    displayChannelKey: "leaveDisplayChannelId",
    enabledKey: "leaveEnabled",
    imageKey: "leaveImageUrl",
    missingGuildText: "Selecione um servidor para configurar saida.",
    savedImageText: "GIF de saida atualizado.",
    testButtonText: "Testar saida",
    testSentText: "Painel de saida enviado para teste.",
    title: "Painel de saida",
    toggleLabel: "Saida"
  }
} satisfies Record<
  MemberPanelMode,
  {
    channelKey: "welcomeChannelId" | "leaveChannelId";
    description: string;
    displayChannelKey: "welcomeDisplayChannelId" | "leaveDisplayChannelId";
    enabledKey: "welcomeEnabled" | "leaveEnabled";
    imageKey: "welcomeImageUrl" | "leaveImageUrl";
    missingGuildText: string;
    savedImageText: string;
    testButtonText: string;
    testSentText: string;
    title: string;
    toggleLabel: string;
  }
>;

export function WelcomePanel({ canManage, guild, mode = "welcome", onSettingsChange, settings, viewerName }: WelcomePanelProps) {
  const config = panelConfig[mode];
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const imageUrl = useMemo(
    () => resolveAssetUrl(settings?.[config.imageKey] ?? DEFAULT_WELCOME_IMAGE_URL),
    [config.imageKey, settings]
  );
  const enabled = Boolean(settings?.[config.enabledKey]);
  const channelId = settings?.[config.channelKey] ?? null;
  const displayChannelId = settings?.[config.displayChannelKey] ?? channelId;
  const destinationChannel = channels.find((channel) => channel.id === channelId) ?? null;
  const displayChannel = channels.find((channel) => channel.id === displayChannelId) ?? null;

  useEffect(() => {
    if (!guild || !canManage) {
      setChannels([]);
      return;
    }

    setLoadingChannels(true);
    getGuildLiveOptions(guild.id)
      .then((options) => setChannels(options.channels))
      .catch(() => setChannels([]))
      .finally(() => setLoadingChannels(false));
  }, [canManage, guild]);

  async function savePatch(payload: Partial<GuildSettings>, key: string) {
    if (!guild || !settings || !canManage) {
      return;
    }

    setSaving(key);
    setStatus(null);
    setError(null);

    try {
      const nextSettings = await patchGuildSettings(guild.id, payload);
      onSettingsChange(nextSettings);
      setStatus("Alteracao salva.");
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(null);
    }
  }

  async function handleImageFile(file: File | undefined) {
    if (!file || !guild || !canManage) {
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError("A imagem precisa ter ate 10 MB.");
      return;
    }

    setSaving("image");
    setStatus(null);
    setError(null);

    try {
      const uploadImage = mode === "welcome" ? uploadWelcomeImage : uploadLeaveImage;
      const nextSettings = await uploadImage(guild.id, file);
      onSettingsChange(nextSettings);
      setStatus(config.savedImageText);
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleTest() {
    if (!guild || !channelId || !canManage) {
      return;
    }

    setSaving("test");
    setStatus(null);
    setError(null);

    try {
      const testPanel = mode === "welcome" ? testWelcomePanel : testLeavePanel;

      await testPanel(guild.id);
      setStatus(config.testSentText);
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(null);
    }
  }

  if (!guild || !settings) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-zinc-500">{config.missingGuildText}</CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
      <Card>
        <CardHeader>
          <CardTitle>{config.title}</CardTitle>
          <CardDescription>{guild.name} - {config.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-zinc-900 bg-zinc-950/75 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-100">{config.toggleLabel}</p>
              <p className="mt-1 truncate text-xs text-zinc-500">{enabled ? "Ativado" : "Desativado"}</p>
            </div>
            <Switch
              checked={enabled}
              disabled={!canManage || saving === "enabled"}
              onCheckedChange={(checked) => savePatch({ [config.enabledKey]: checked } as Partial<GuildSettings>, "enabled")}
            />
          </div>

          <ControlSelect
            disabled={!canManage || loadingChannels || saving === "channel"}
            icon={Hash}
            label="Enviar em"
            onChange={(value) => savePatch({ [config.channelKey]: value || null } as Partial<GuildSettings>, "channel")}
            options={channels}
            placeholder={loadingChannels ? "Carregando canais..." : "Selecione um canal"}
            value={channelId ?? ""}
          />

          <ControlSelect
            disabled={!canManage || loadingChannels || saving === "displayChannel"}
            icon={Hash}
            label="Canal destacado"
            onChange={(value) => savePatch({ [config.displayChannelKey]: value || null } as Partial<GuildSettings>, "displayChannel")}
            options={channels}
            placeholder={loadingChannels ? "Carregando canais..." : "Usar o mesmo canal"}
            value={displayChannelId && displayChannelId !== channelId ? displayChannelId : ""}
          />

          <div className="space-y-3 rounded-lg border border-zinc-900 bg-zinc-950/75 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
              <ImageIcon className="h-4 w-4 text-zinc-400" />
              GIF do painel
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                className="h-10"
                disabled={!canManage || saving === "image"}
                onClick={() => fileInputRef.current?.click()}
                type="button"
                variant="outline"
              >
                <Upload className="h-4 w-4" />
                {saving === "image" ? "Enviando..." : "Alterar GIF"}
              </Button>
              <Button
                className="h-10"
                disabled={!canManage || !channelId || saving === "test"}
                onClick={handleTest}
                type="button"
              >
                <Send className="h-4 w-4" />
                {saving === "test" ? "Enviando..." : config.testButtonText}
              </Button>
            </div>
            <input
              accept="image/gif,image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => void handleImageFile(event.target.files?.[0])}
              ref={fileInputRef}
              type="file"
            />
          </div>

          {status ? (
            <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-100">
              <CheckCircle2 className="h-4 w-4 text-zinc-400" />
              {status}
            </div>
          ) : null}
          {error ? <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-100">{error}</div> : null}
        </CardContent>
      </Card>

      <WelcomePreview
        displayChannelName={displayChannel?.name ?? destinationChannel?.name ?? "coloque_o_id_do_canal_de_lives_aqui"}
        imageUrl={imageUrl}
        mode={mode}
        viewerName={viewerName}
      />
    </div>
  );
}

function ControlSelect({
  disabled,
  icon: Icon,
  label,
  onChange,
  options,
  placeholder,
  value
}: {
  disabled: boolean;
  icon: typeof Hash;
  label: string;
  onChange: (value: string) => void;
  options: GuildChannelOption[];
  placeholder: string;
  value: string;
}) {
  return (
    <label className="block space-y-2 rounded-lg border border-zinc-900 bg-zinc-950/75 p-4">
      <span className="flex items-center gap-2 text-sm font-medium text-zinc-100">
        <Icon className="h-4 w-4 text-zinc-400" />
        {label}
      </span>
      <select
        className="h-11 w-full rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none transition focus:border-zinc-600 disabled:opacity-50"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="">{placeholder}</option>
        {options.map((channel) => (
          <option key={channel.id} value={channel.id}>
            #{channel.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function WelcomePreview({
  displayChannelName,
  imageUrl,
  mode,
  viewerName
}: {
  displayChannelName: string;
  imageUrl: string;
  mode: MemberPanelMode;
  viewerName: string;
}) {
  const isLeave = mode === "leave";

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Preview</CardTitle>
        <CardDescription>Ricardinn98 - Comunidade de lives</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-zinc-800 bg-[#31333a] p-3 shadow-[0_24px_70px_rgba(0,0,0,0.45)]">
          <div className="border-l-4 border-red-500 pl-3">
            <div className="overflow-hidden rounded-md border border-black/15 bg-black">
              <img alt="" className="aspect-video w-full object-cover" src={imageUrl} />
            </div>

            <div className="mt-4 space-y-3 text-[13px] leading-5 text-zinc-100">
              <h3 className="flex items-center gap-2 text-base font-bold text-white">
                <span className="text-purple-400">{"\u{1F47E}"}</span>
                Ricardinn98
              </h3>
              {isLeave ? (
                <>
                  <p>
                    Ate mais, <span className="rounded bg-white/10 px-1 text-zinc-100">@{viewerName}</span>. Obrigado por ter feito parte da
                    nossa comunidade de lives.
                    <br />
                    As portas continuam abertas para quando quiser voltar e acompanhar as transmissoes com a galera.
                  </p>
                  <div>
                    <p className="font-bold text-white">Registro de saida:</p>
                    <ol className="space-y-0.5 font-semibold">
                      <li>1. A saida foi registrada automaticamente pelo bot.</li>
                      <li>2. Os canais oficiais continuam disponiveis para a comunidade.</li>
                      <li>3. Respeite as regras se decidir retornar ao servidor.</li>
                      <li>4. A equipe segue por aqui para organizar eventos e avisos.</li>
                      <li>5. Valeu pela passagem e ate a proxima.</li>
                    </ol>
                  </div>
                </>
              ) : (
                <>
                  <p>
                    Seja bem-vindo(a), <span className="rounded bg-white/10 px-1 text-zinc-100">@{viewerName}</span>, a nossa comunidade de
                    lives.
                    <br />
                    Aqui a galera acompanha transmissoes, eventos da comunidade, avisos e momentos ao vivo juntos.
                  </p>
                  <div>
                    <p className="font-bold text-white">Algumas dicas:</p>
                    <ol className="space-y-0.5 font-semibold">
                      <li>1. Leia as regras antes de participar.</li>
                      <li>2. Aguarde os avisos oficiais de lives e eventos.</li>
                      <li>3. Respeite streamers, espectadores e moderadores.</li>
                      <li>4. Nao divulgue lives, links ou canais sem autorizacao.</li>
                      <li>5. Converse, faca amizades e aproveite sua estadia.</li>
                    </ol>
                  </div>
                </>
              )}
              <div className="border-t border-white/10 pt-3 font-semibold">
                {"\u{1F517}"} {isLeave ? "Canal da comunidade:" : "Acesse o canal:"}{" "}
                <span className="text-zinc-50">#{displayChannelName}</span>
              </div>
              <p className="pt-2 text-[11px] text-zinc-300">Ricardinn98 - Comunidade de lives</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function resolveAssetUrl(value: string) {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  const apiOrigin = new URL(API_URL, window.location.origin).origin;
  return `${apiOrigin}${value.startsWith("/") ? value : `/${value}`}`;
}

function readErrorMessage(error: unknown) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? "Nao foi possivel concluir a acao.";
  }

  return "Nao foi possivel concluir a acao.";
}

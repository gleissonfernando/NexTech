import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Hash,
  ImageIcon,
  Link2,
  Loader2,
  MessageSquareText,
  RotateCcw,
  Save,
  Send,
  Upload
} from "lucide-react";
import {
  API_URL,
  getGuildLiveOptions,
  patchGuildSettings,
  testLeavePanel,
  testWelcomePanel,
  uploadLeaveImage,
  uploadWelcomeImage
} from "../../lib/api";
import type { DashboardGuild, GuildChannelOption, GuildSettings } from "../../types";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

type MemberPanelMode = "welcome" | "leave";

type WelcomePanelProps = {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
  loading?: boolean;
  mode?: MemberPanelMode;
  onSettingsChange: (settings: GuildSettings) => void;
  settings: GuildSettings | null;
  viewerName: string;
};

const DEFAULT_WELCOME_IMAGE_URL = "/uploads/welcome/default.gif?v=3";
const DEFAULT_WELCOME_TITLE = "Ricardin98";
const DEFAULT_WELCOME_MESSAGE = [
  "Seja bem-vindo(a), {user}, \u00e0 nossa comunidade de lives.",
  "Aqui a galera acompanha transmiss\u00f5es, eventos da comunidade, avisos e momentos ao vivo juntos."
].join("\n");
const DEFAULT_WELCOME_RULES_TITLE = "Algumas dicas:";
const DEFAULT_WELCOME_RULES = [
  "Leia as regras antes de participar.",
  "Aguarde os avisos oficiais de lives e eventos.",
  "Respeite streamers, espectadores e moderadores.",
  "N\u00e3o divulgue links ou canais sem autoriza\u00e7\u00e3o.",
  "Converse, fa\u00e7a amizades e aproveite sua estadia."
].join("\n");
const DEFAULT_WELCOME_CHANNEL_LABEL = "Acesse o canal:";
const DEFAULT_WELCOME_FOOTER_TEXT = "Ricardin98 - Comunidade de Lives";
const DEFAULT_LEAVE_TITLE = "Ricardinn98";
const DEFAULT_LEAVE_MESSAGE = [
  "Ate mais, {user}. Obrigado por ter feito parte da nossa comunidade de lives.",
  "As portas continuam abertas para quando quiser voltar e acompanhar as transmissoes com a galera."
].join("\n");
const DEFAULT_LEAVE_RULES_TITLE = "Registro de saida:";
const DEFAULT_LEAVE_RULES = [
  "A saida foi registrada automaticamente pelo bot.",
  "Os canais oficiais continuam disponiveis para a comunidade.",
  "Respeite as regras se decidir retornar ao servidor.",
  "A equipe segue por aqui para organizar eventos e avisos.",
  "Valeu pela passagem e ate a proxima."
].join("\n");
const DEFAULT_LEAVE_CHANNEL_LABEL = "Canal da comunidade:";
const DEFAULT_LEAVE_FOOTER_TEXT = "Ricardinn98 - Comunidade de lives";

const panelConfig = {
  welcome: {
    channelKey: "welcomeChannelId",
    description: "Mensagem automatica quando alguem entra.",
    displayChannelKey: "welcomeDisplayChannelId",
    enabledKey: "welcomeEnabled",
    footerTextKey: "welcomeFooterText",
    imageKey: "welcomeImageUrl",
    channelLabelKey: "welcomeChannelLabel",
    loadingText: "Carregando entrada...",
    messageKey: "welcomeMessage",
    rulesKey: "welcomeRules",
    rulesTitleKey: "welcomeRulesTitle",
    embedTitleKey: "welcomeTitle",
    defaultChannelLabel: DEFAULT_WELCOME_CHANNEL_LABEL,
    defaultFooterText: DEFAULT_WELCOME_FOOTER_TEXT,
    defaultMessage: DEFAULT_WELCOME_MESSAGE,
    defaultRules: DEFAULT_WELCOME_RULES,
    defaultRulesTitle: DEFAULT_WELCOME_RULES_TITLE,
    defaultTitle: DEFAULT_WELCOME_TITLE,
    missingGuildText: "Selecione um servidor para configurar entrada.",
    missingSettingsText: "Nao foi possivel carregar as configuracoes de entrada.",
    savedImageText: "Banner de entrada atualizado.",
    savedMessageText: "Mensagem de entrada salva.",
    testButtonText: "Testar entrada",
    testSentText: "Entrada enviada para teste.",
    title: "Entrada",
    toggleLabel: "Entrada"
  },
  leave: {
    channelKey: "leaveChannelId",
    description: "Mensagem automatica quando alguem sai.",
    displayChannelKey: "leaveDisplayChannelId",
    enabledKey: "leaveEnabled",
    footerTextKey: "leaveFooterText",
    imageKey: "leaveImageUrl",
    channelLabelKey: "leaveChannelLabel",
    loadingText: "Carregando saida...",
    messageKey: "leaveMessage",
    rulesKey: "leaveRules",
    rulesTitleKey: "leaveRulesTitle",
    embedTitleKey: "leaveTitle",
    defaultChannelLabel: DEFAULT_LEAVE_CHANNEL_LABEL,
    defaultFooterText: DEFAULT_LEAVE_FOOTER_TEXT,
    defaultMessage: DEFAULT_LEAVE_MESSAGE,
    defaultRules: DEFAULT_LEAVE_RULES,
    defaultRulesTitle: DEFAULT_LEAVE_RULES_TITLE,
    defaultTitle: DEFAULT_LEAVE_TITLE,
    missingGuildText: "Selecione um servidor para configurar saida.",
    missingSettingsText: "Nao foi possivel carregar as configuracoes de saida.",
    savedImageText: "Banner de saida atualizado.",
    savedMessageText: "Mensagem de saida salva.",
    testButtonText: "Testar saida",
    testSentText: "Saida enviada para teste.",
    title: "Saida",
    toggleLabel: "Saida"
  }
} satisfies Record<
  MemberPanelMode,
  {
    channelKey: "welcomeChannelId" | "leaveChannelId";
    description: string;
    displayChannelKey: "welcomeDisplayChannelId" | "leaveDisplayChannelId";
    enabledKey: "welcomeEnabled" | "leaveEnabled";
    footerTextKey: "welcomeFooterText" | "leaveFooterText";
    imageKey: "welcomeImageUrl" | "leaveImageUrl";
    channelLabelKey: "welcomeChannelLabel" | "leaveChannelLabel";
    loadingText: string;
    messageKey: "welcomeMessage" | "leaveMessage";
    rulesKey: "welcomeRules" | "leaveRules";
    rulesTitleKey: "welcomeRulesTitle" | "leaveRulesTitle";
    embedTitleKey: "welcomeTitle" | "leaveTitle";
    defaultChannelLabel: string;
    defaultFooterText: string;
    defaultMessage: string;
    defaultRules: string;
    defaultRulesTitle: string;
    defaultTitle: string;
    missingGuildText: string;
    missingSettingsText: string;
    savedImageText: string;
    savedMessageText: string;
    testButtonText: string;
    testSentText: string;
    title: string;
    toggleLabel: string;
  }
>;

export function WelcomePanel({
  botId,
  canManage,
  guild,
  loading = false,
  mode = "welcome",
  onSettingsChange,
  settings,
  viewerName
}: WelcomePanelProps) {
  const config = panelConfig[mode];
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [imageInput, setImageInput] = useState("");
  const [messageInput, setMessageInput] = useState("");
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
  const destinationChannel = channels.find((channel) => channel.id === channelId) ?? null;

  useEffect(() => {
    if (!guild || !canManage) {
      setChannels([]);
      return;
    }

    setLoadingChannels(true);
    getGuildLiveOptions(guild.id, botId)
      .then((options) => setChannels(options.channels))
      .catch(() => setChannels([]))
      .finally(() => setLoadingChannels(false));
  }, [botId, canManage, guild]);

  useEffect(() => {
    const currentImageUrl = settings?.[config.imageKey] ?? "";
    setImageInput(/^https?:\/\//i.test(currentImageUrl) ? currentImageUrl : "");
  }, [config.imageKey, settings]);

  useEffect(() => {
    setMessageInput(settings?.[config.messageKey]?.trim() || config.defaultMessage);
  }, [config.defaultMessage, config.messageKey, settings]);

  async function savePatch(payload: Partial<GuildSettings>, key: string, successText = "Alteracao salva.") {
    if (!guild || !settings || !canManage) {
      return false;
    }

    setSaving(key);
    setStatus(null);
    setError(null);

    try {
      const nextSettings = await patchGuildSettings(guild.id, payload, botId);
      onSettingsChange(nextSettings);
      setStatus(successText);
      return true;
    } catch (requestError) {
      setError(readErrorMessage(requestError));
      return false;
    } finally {
      setSaving(null);
    }
  }

  async function handleChannelChange(nextChannelId: string) {
    await savePatch(
      {
        [config.channelKey]: nextChannelId || null,
        [config.displayChannelKey]: nextChannelId || null
      } as Partial<GuildSettings>,
      "channel",
      "Canal salvo."
    );
  }

  async function handleMessageSave(message = messageInput) {
    const nextMessage = message.trim();

    if (!nextMessage) {
      setStatus(null);
      setError("Escreva a mensagem antes de salvar.");
      return;
    }

    await savePatch(
      {
        [config.embedTitleKey]: config.defaultTitle,
        [config.messageKey]: nextMessage,
        [config.rulesTitleKey]: config.defaultRulesTitle,
        [config.rulesKey]: config.defaultRules,
        [config.channelLabelKey]: config.defaultChannelLabel,
        [config.footerTextKey]: config.defaultFooterText
      } as Partial<GuildSettings>,
      "message",
      config.savedMessageText
    );
  }

  function handleMessageReset() {
    setMessageInput(config.defaultMessage);
    void handleMessageSave(config.defaultMessage);
  }

  async function handleImageFile(file: File | undefined) {
    if (!file || !guild || !canManage) {
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setStatus(null);
      setError("A imagem precisa ter ate 10 MB.");
      return;
    }

    setSaving("image");
    setStatus(null);
    setError(null);

    try {
      const uploadImage = mode === "welcome" ? uploadWelcomeImage : uploadLeaveImage;
      const nextSettings = await uploadImage(guild.id, file, botId);
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

  async function handleImageUrlSubmit() {
    const nextImageUrl = imageInput.trim();

    if (!nextImageUrl) {
      setStatus(null);
      setError("Cole um link de imagem ou envie um arquivo.");
      return;
    }

    if (!/^https?:\/\//i.test(nextImageUrl)) {
      setStatus(null);
      setError("Use um link com http:// ou https://.");
      return;
    }

    await savePatch({ [config.imageKey]: nextImageUrl } as Partial<GuildSettings>, "imageUrl", config.savedImageText);
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

      await testPanel(guild.id, botId);
      setStatus(config.testSentText);
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(null);
    }
  }

  if (!guild) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-zinc-500">{config.missingGuildText}</CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-5 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          {config.loadingText}
        </CardContent>
      </Card>
    );
  }

  if (!settings) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-zinc-500">{config.missingSettingsText}</CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden hover:translate-y-0">
      <CardHeader className="border-b border-zinc-900 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-black text-zinc-200">
              <MessageSquareText className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <CardTitle>{config.title}</CardTitle>
              <CardDescription>{config.description}</CardDescription>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <span className="text-xs font-medium uppercase text-zinc-500">{enabled ? "Ativo" : "Inativo"}</span>
            <Switch
              checked={enabled}
              disabled={!canManage || saving === "enabled"}
              onCheckedChange={(checked) => {
                void savePatch({ [config.enabledKey]: checked } as Partial<GuildSettings>, "enabled");
              }}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <label className="block space-y-2">
            <span className="flex items-center gap-2 text-sm font-medium text-zinc-100">
              <Hash className="h-4 w-4 text-zinc-400" />
              Canal
            </span>
            <select
              className="h-11 w-full rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none transition focus:border-zinc-600 disabled:opacity-50"
              disabled={!canManage || loadingChannels || saving === "channel"}
              onChange={(event) => void handleChannelChange(event.target.value)}
              value={channelId ?? ""}
            >
              <option value="">{loadingChannels ? "Carregando canais..." : "Selecione um canal"}</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  #{channel.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-2">
            <span className="flex items-center gap-2 text-sm font-medium text-zinc-100">
              <MessageSquareText className="h-4 w-4 text-zinc-400" />
              Mensagem
            </span>
            <textarea
              className="min-h-36 w-full resize-y rounded-lg border border-zinc-800 bg-black px-3 py-3 text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600 disabled:opacity-50"
              disabled={!canManage || saving === "message"}
              maxLength={1000}
              onChange={(event) => setMessageInput(event.target.value)}
              placeholder="Mensagem com {user}"
              value={messageInput}
            />
          </label>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button disabled={!canManage || saving === "message"} onClick={() => void handleMessageSave()} type="button">
              {saving === "message" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar
            </Button>
            <Button disabled={!canManage || saving === "message"} onClick={handleMessageReset} type="button" variant="outline">
              <RotateCcw className="h-4 w-4" />
              Padrao
            </Button>
            <Button disabled={!canManage || !channelId || saving === "test"} onClick={handleTest} type="button" variant="outline">
              {saving === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {config.testButtonText}
            </Button>
          </div>

          <div className="space-y-3 border-t border-zinc-900 pt-5">
            <span className="flex items-center gap-2 text-sm font-medium text-zinc-100">
              <ImageIcon className="h-4 w-4 text-zinc-400" />
              Banner
            </span>
            <div className="flex flex-col gap-3 lg:flex-row">
              <input
                className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600 disabled:opacity-50"
                disabled={!canManage || saving === "imageUrl"}
                onChange={(event) => setImageInput(event.target.value)}
                placeholder="https://site.com/banner.gif"
                value={imageInput}
              />
              <Button disabled={!canManage || saving === "imageUrl"} onClick={() => void handleImageUrlSubmit()} type="button" variant="outline">
                <Link2 className="h-4 w-4" />
                Link
              </Button>
              <Button disabled={!canManage || saving === "image"} onClick={() => fileInputRef.current?.click()} type="button" variant="outline">
                {saving === "image" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Enviar
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
            <p className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100">
              <CheckCircle2 className="h-4 w-4 text-zinc-400" />
              {status}
            </p>
          ) : null}
          {error ? <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100">{error}</p> : null}
        </div>

        <SimplePanelPreview
          channelLabel={settings?.[config.channelLabelKey]?.trim() || config.defaultChannelLabel}
          channelName={destinationChannel?.name ?? "canal"}
          footerText={settings?.[config.footerTextKey]?.trim() || config.defaultFooterText}
          imageUrl={imageUrl}
          message={messageInput.trim() || config.defaultMessage}
          rules={settings?.[config.rulesKey]?.trim() || config.defaultRules}
          rulesTitle={settings?.[config.rulesTitleKey]?.trim() || config.defaultRulesTitle}
          viewerName={viewerName}
        />
      </CardContent>
    </Card>
  );
}

function SimplePanelPreview({
  channelLabel,
  channelName,
  footerText,
  imageUrl,
  message,
  rules,
  rulesTitle,
  viewerName
}: {
  channelLabel: string;
  channelName: string;
  footerText: string;
  imageUrl: string;
  message: string;
  rules: string;
  rulesTitle: string;
  viewerName: string;
}) {
  const ruleItems = formatRuleItems(rules);

  return (
    <aside className="overflow-hidden rounded-lg border border-zinc-800 bg-black">
      <img alt="" className="aspect-[16/9] w-full object-cover" src={imageUrl} />
      <div className="space-y-5 p-4 pt-5">
        <PanelMessage className="whitespace-pre-line text-sm leading-6 text-zinc-200" message={message} viewerName={viewerName} />

        <div className="space-y-2">
          <p className="text-sm font-semibold text-white">{rulesTitle}</p>
          <ol className="space-y-1 text-sm leading-6 text-zinc-300">
            {ruleItems.map((rule, index) => (
              <li className="grid grid-cols-[1.6rem_minmax(0,1fr)] gap-2" key={`${rule}-${index}`}>
                <span className="font-semibold text-zinc-100">{index + 1}.</span>
                <span>{rule}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-zinc-900 bg-zinc-950 px-3 py-2 text-sm text-zinc-300">
          <span aria-hidden="true">{"\u{1F517}"}</span>
          <span className="min-w-0 truncate">
            {channelLabel} <span className="font-medium text-zinc-100">#{channelName}</span>
          </span>
        </div>
      </div>
      <footer className="border-t border-zinc-900 px-4 py-3 text-xs text-zinc-500">{footerText}</footer>
    </aside>
  );
}

function PanelMessage({ className, message, viewerName }: { className?: string; message: string; viewerName: string }) {
  return (
    <p className={className ?? "whitespace-pre-line"}>
      {message.split(/(\{user\})/gi).map((part, index) => (
        part.toLowerCase() === "{user}"
          ? (
              <span className="rounded bg-white/10 px-1 text-zinc-100" key={`${part}-${index}`}>
                @{viewerName}
              </span>
            )
          : part
      ))}
    </p>
  );
}

function formatRuleItems(rules: string) {
  return rules
    .split(/\r?\n/)
    .map((rule) => rule.replace(/^\s*(?:\d+[.)-]\s*|\*\*\d+[.)-]?\*\*\s*)/, "").trim())
    .filter(Boolean);
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

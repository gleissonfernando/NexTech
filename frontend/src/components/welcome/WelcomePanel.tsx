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
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";
import { Avatar } from "../ui/avatar";
import type { DashboardGuild, GuildChannelOption, GuildSettings } from "../../types";

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
const DEFAULT_WELCOME_TITLE = "Ricardinn98";
const DEFAULT_WELCOME_MESSAGE = [
  "Seja bem-vindo(a), {user}, a nossa comunidade de lives.",
  "Aqui a galera acompanha transmissoes, eventos da comunidade, avisos e momentos ao vivo juntos."
].join("\n");
const DEFAULT_WELCOME_RULES_TITLE = "Algumas dicas:";
const DEFAULT_WELCOME_RULES = [
  "Leia as regras antes de participar.",
  "Aguarde os avisos oficiais de lives e eventos.",
  "Respeite streamers, espectadores e moderadores.",
  "Nao divulgue lives, links ou canais sem autorizacao.",
  "Converse, faca amizades e aproveite sua estadia."
].join("\n");
const DEFAULT_WELCOME_CHANNEL_LABEL = "Acesse o canal:";
const DEFAULT_WELCOME_FOOTER_TEXT = "Ricardinn98 - Comunidade de lives";
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
    description: "Entrada de membros",
    displayChannelKey: "welcomeDisplayChannelId",
    enabledKey: "welcomeEnabled",
    footerTextKey: "welcomeFooterText",
    imageKey: "welcomeImageUrl",
    channelLabelKey: "welcomeChannelLabel",
    loadingText: "Carregando configuracoes de entrada...",
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
    savedMessageText: "Texto de entrada atualizado.",
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
    footerTextKey: "leaveFooterText",
    imageKey: "leaveImageUrl",
    channelLabelKey: "leaveChannelLabel",
    loadingText: "Carregando configuracoes de saida...",
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
    savedMessageText: "Texto de saida atualizado.",
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

export function WelcomePanel({ botId, canManage, guild, loading = false, mode = "welcome", onSettingsChange, settings, viewerName }: WelcomePanelProps) {
  const config = panelConfig[mode];
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [imageInput, setImageInput] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [rulesTitleInput, setRulesTitleInput] = useState("");
  const [rulesInput, setRulesInput] = useState("");
  const [channelLabelInput, setChannelLabelInput] = useState("");
  const [footerTextInput, setFooterTextInput] = useState("");
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

  useEffect(() => {
    setTitleInput(settings?.[config.embedTitleKey]?.trim() || config.defaultTitle);
    setRulesTitleInput(settings?.[config.rulesTitleKey]?.trim() || config.defaultRulesTitle);
    setRulesInput(settings?.[config.rulesKey]?.trim() || config.defaultRules);
    setChannelLabelInput(settings?.[config.channelLabelKey]?.trim() || config.defaultChannelLabel);
    setFooterTextInput(settings?.[config.footerTextKey]?.trim() || config.defaultFooterText);
  }, [
    config.channelLabelKey,
    config.defaultChannelLabel,
    config.defaultFooterText,
    config.defaultRules,
    config.defaultRulesTitle,
    config.defaultTitle,
    config.embedTitleKey,
    config.footerTextKey,
    config.rulesKey,
    config.rulesTitleKey,
    settings
  ]);

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
      setError("Cole um link de imagem ou envie um arquivo.");
      return;
    }

    if (!/^https?:\/\//i.test(nextImageUrl)) {
      setError("Use um link com http:// ou https://.");
      return;
    }

    await savePatch({ [config.imageKey]: nextImageUrl } as Partial<GuildSettings>, "imageUrl", config.savedImageText);
  }

  async function handleTextSave(overrides: Partial<Record<"title" | "message" | "rulesTitle" | "rules" | "channelLabel" | "footerText", string>> = {}) {
    const nextTitle = (overrides.title ?? titleInput).trim();
    const nextMessage = (overrides.message ?? messageInput).trim();
    const nextRulesTitle = (overrides.rulesTitle ?? rulesTitleInput).trim();
    const nextRules = (overrides.rules ?? rulesInput).trim();
    const nextChannelLabel = (overrides.channelLabel ?? channelLabelInput).trim();
    const nextFooterText = (overrides.footerText ?? footerTextInput).trim();

    if (!nextTitle || !nextMessage || !nextRulesTitle || !nextRules || !nextChannelLabel || !nextFooterText) {
      setError("Preencha todos os textos do painel antes de salvar.");
      return;
    }

    await savePatch(
      {
        [config.embedTitleKey]: nextTitle,
        [config.messageKey]: nextMessage,
        [config.rulesTitleKey]: nextRulesTitle,
        [config.rulesKey]: nextRules,
        [config.channelLabelKey]: nextChannelLabel,
        [config.footerTextKey]: nextFooterText
      } as Partial<GuildSettings>,
      "panelText",
      config.savedMessageText
    );
  }

  function handleTextReset() {
    setTitleInput(config.defaultTitle);
    setMessageInput(config.defaultMessage);
    setRulesTitleInput(config.defaultRulesTitle);
    setRulesInput(config.defaultRules);
    setChannelLabelInput(config.defaultChannelLabel);
    setFooterTextInput(config.defaultFooterText);
    void handleTextSave({
      channelLabel: config.defaultChannelLabel,
      footerText: config.defaultFooterText,
      message: config.defaultMessage,
      rules: config.defaultRules,
      rulesTitle: config.defaultRulesTitle,
      title: config.defaultTitle
    });
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
    <div className="space-y-7">
      <WelcomePreview
        channelLabel={channelLabelInput.trim() || config.defaultChannelLabel}
        displayChannelName={displayChannel?.name ?? destinationChannel?.name ?? "selecione_um_canal"}
        footerText={footerTextInput.trim() || config.defaultFooterText}
        imageUrl={imageUrl}
        message={messageInput.trim() || config.defaultMessage}
        panelTitle={titleInput.trim() || config.defaultTitle}
        rulesText={rulesInput.trim() || config.defaultRules}
        rulesTitle={rulesTitleInput.trim() || config.defaultRulesTitle}
        viewerName={viewerName}
      />

      <Card className="mx-auto w-full max-w-6xl rounded-[24px] border-zinc-800/80 bg-[#09090b]/90 shadow-[0_24px_80px_rgba(0,0,0,0.52)] hover:translate-y-0">
        <CardHeader className="border-b border-zinc-900/80 p-6 sm:p-8">
          <CardTitle>{config.title}</CardTitle>
          <CardDescription>{guild.name} - {config.description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 p-6 sm:p-8 lg:grid-cols-2">
          <div className="flex items-center justify-between gap-5 rounded-[18px] border border-zinc-800/90 bg-zinc-950/80 p-5">
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
            label="Canal que recebe a mensagem"
            onChange={(value) => savePatch({ [config.channelKey]: value || null } as Partial<GuildSettings>, "channel")}
            options={channels}
            placeholder={loadingChannels ? "Carregando canais..." : "Selecione um canal"}
            value={channelId ?? ""}
          />

          <ControlSelect
            disabled={!canManage || loadingChannels || saving === "displayChannel"}
            icon={Hash}
            label="Canal citado no banner"
            onChange={(value) => savePatch({ [config.displayChannelKey]: value || null } as Partial<GuildSettings>, "displayChannel")}
            options={channels}
            placeholder={loadingChannels ? "Carregando canais..." : "Usar o mesmo canal"}
            value={displayChannelId && displayChannelId !== channelId ? displayChannelId : ""}
          />

          <div className="space-y-5 rounded-[18px] border border-zinc-800/90 bg-zinc-950/80 p-5 lg:col-span-2">
            <div>
              <span className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                <MessageSquareText className="h-4 w-4 text-zinc-400" />
                Textos editaveis do painel
              </span>
              <p className="mt-1 text-xs text-zinc-500">Use {"{user}"} para inserir a mencao do membro automaticamente.</p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <TextField
                disabled={!canManage || saving === "panelText"}
                label="Titulo do embed"
                maxLength={120}
                onChange={setTitleInput}
                value={titleInput}
              />
              <TextField
                disabled={!canManage || saving === "panelText"}
                label="Titulo das regras"
                maxLength={120}
                onChange={setRulesTitleInput}
                value={rulesTitleInput}
              />
              <TextField
                disabled={!canManage || saving === "panelText"}
                label="Texto do canal destacado"
                maxLength={120}
                onChange={setChannelLabelInput}
                value={channelLabelInput}
              />
              <TextField
                disabled={!canManage || saving === "panelText"}
                label="Rodape"
                maxLength={180}
                onChange={setFooterTextInput}
                value={footerTextInput}
              />
            </div>

            <label className="block space-y-2">
              <span className="text-xs font-medium text-zinc-500">Texto principal</span>
              <textarea
                className="min-h-32 w-full resize-y rounded-lg border border-zinc-800 bg-black px-3 py-3 text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600 disabled:opacity-50"
                disabled={!canManage || saving === "panelText"}
                maxLength={1000}
                onChange={(event) => setMessageInput(event.target.value)}
                value={messageInput}
              />
            </label>

            <label className="block space-y-2">
              <span className="text-xs font-medium text-zinc-500">Regras da comunidade, uma por linha</span>
              <textarea
                className="min-h-40 w-full resize-y rounded-lg border border-zinc-800 bg-black px-3 py-3 text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600 disabled:opacity-50"
                disabled={!canManage || saving === "panelText"}
                maxLength={1500}
                onChange={(event) => setRulesInput(event.target.value)}
                value={rulesInput}
              />
            </label>

            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              <Button
                className="h-10"
                disabled={!canManage || saving === "panelText"}
                onClick={handleTextReset}
                type="button"
                variant="outline"
              >
                <RotateCcw className="h-4 w-4" />
                Restaurar textos
              </Button>
              <Button
                className="h-10"
                disabled={!canManage || saving === "panelText"}
                onClick={() => void handleTextSave()}
                type="button"
              >
                {saving === "panelText" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving === "panelText" ? "Salvando..." : "Salvar textos"}
              </Button>
            </div>
          </div>

          <div className="space-y-4 rounded-[18px] border border-zinc-800/90 bg-zinc-950/80 p-5 lg:col-span-2">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
              <ImageIcon className="h-4 w-4 text-zinc-400" />
              Banner do painel
            </div>
            <label className="block space-y-2">
              <span className="flex items-center gap-2 text-xs font-medium text-zinc-500">
                <Link2 className="h-3.5 w-3.5" />
                Link de imagem ou GIF
              </span>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600 disabled:opacity-50"
                  disabled={!canManage || saving === "imageUrl"}
                  onChange={(event) => setImageInput(event.target.value)}
                  placeholder="https://site.com/banner.gif"
                  value={imageInput}
                />
                <Button
                  className="h-10 shrink-0"
                  disabled={!canManage || saving === "imageUrl"}
                  onClick={() => void handleImageUrlSubmit()}
                  type="button"
                  variant="outline"
                >
                  <Link2 className="h-4 w-4" />
                  {saving === "imageUrl" ? "Salvando..." : "Usar link"}
                </Button>
              </div>
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                className="h-10"
                disabled={!canManage || saving === "image"}
                onClick={() => fileInputRef.current?.click()}
                type="button"
                variant="outline"
              >
                <Upload className="h-4 w-4" />
                {saving === "image" ? "Enviando..." : "Enviar foto/GIF"}
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
            <div className="flex items-center gap-2 rounded-[18px] border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-100 lg:col-span-2">
              <CheckCircle2 className="h-4 w-4 text-zinc-400" />
              {status}
            </div>
          ) : null}
          {error ? <div className="rounded-[18px] border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-100 lg:col-span-2">{error}</div> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function TextField({
  disabled,
  label,
  maxLength,
  onChange,
  value
}: {
  disabled: boolean;
  label: string;
  maxLength: number;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-medium text-zinc-500">{label}</span>
      <input
        className="h-11 w-full rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600 disabled:opacity-50"
        disabled={disabled}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
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
    <label className="block space-y-2 rounded-[18px] border border-zinc-800/90 bg-zinc-950/80 p-5">
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
  channelLabel,
  displayChannelName,
  footerText,
  imageUrl,
  message,
  panelTitle,
  rulesText,
  rulesTitle,
  viewerName
}: {
  channelLabel: string;
  displayChannelName: string;
  footerText: string;
  imageUrl: string;
  message: string;
  panelTitle: string;
  rulesText: string;
  rulesTitle: string;
  viewerName: string;
}) {
  const rules = splitRuleLines(rulesText);

  return (
    <Card className="group mx-auto flex min-h-[600px] w-full max-w-6xl flex-col overflow-hidden rounded-[24px] border border-purple-500/20 bg-[#08080a] shadow-[0_34px_110px_rgba(0,0,0,0.66)] transition duration-500 hover:-translate-y-1 hover:border-purple-400/35 hover:shadow-[0_40px_130px_rgba(124,58,237,0.18)]">
      <div className="relative overflow-hidden bg-black">
        <img
          alt=""
          className="aspect-[21/9] min-h-[260px] w-full object-cover object-top transition duration-700 group-hover:scale-[1.03]"
          src={imageUrl}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#08080a] via-black/15 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#08080a] to-transparent" />
      </div>

      <div className="flex-1 px-6 pb-9 sm:px-10 lg:px-12">
        <div className="relative z-10 -mt-12 flex flex-col items-center text-center">
          <Avatar
            className="h-24 w-24 rounded-[24px] border-4 border-[#08080a] bg-gradient-to-br from-red-500 to-purple-600 text-2xl shadow-[0_20px_55px_rgba(124,58,237,0.35)]"
            fallback={viewerName}
          />
          <div className="mt-5 space-y-2">
            <p className="text-xs font-semibold uppercase text-red-300">{panelTitle}</p>
            <h3 className="text-3xl font-semibold text-white sm:text-4xl">@{viewerName}</h3>
          </div>
        </div>

        <div className="mx-auto mt-8 max-w-3xl text-center">
          <PanelMessage
            className="whitespace-pre-line text-base leading-8 text-zinc-200 sm:text-lg"
            message={message}
            viewerName={viewerName}
          />
        </div>

        <section className="mx-auto mt-10 max-w-4xl text-center">
          <p className="text-xs font-semibold uppercase text-purple-200">{rulesTitle}</p>
          <ol className="mt-5 grid gap-3 sm:grid-cols-2">
            {rules.map((rule, index) => (
              <li
                className="rounded-[18px] border border-white/10 bg-white/[0.045] px-4 py-4 text-sm leading-6 text-zinc-300 shadow-[0_12px_34px_rgba(0,0,0,0.18)] transition duration-300 hover:-translate-y-0.5 hover:border-purple-400/35 hover:bg-purple-500/10"
                key={rule}
              >
                <span className="mx-auto mb-3 flex h-8 w-8 items-center justify-center rounded-full border border-red-400/25 bg-red-500/10 text-xs font-semibold text-red-200">
                  {index + 1}
                </span>
                {rule}
              </li>
            ))}
          </ol>
        </section>

        <div className="mx-auto mt-10 max-w-2xl rounded-[22px] border border-white/10 bg-white/[0.075] p-5 text-center shadow-[0_22px_70px_rgba(124,58,237,0.16)] backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:border-red-400/35 hover:bg-white/[0.095] sm:p-6">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-[16px] border border-purple-400/25 bg-purple-500/15 text-purple-100">
              <Hash className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase text-zinc-500">{channelLabel}</p>
              <p className="mt-1 truncate text-xl font-semibold text-white">#{displayChannelName}</p>
            </div>
          </div>
        </div>

        <footer className="mt-10 border-t border-white/10 pt-6 text-center">
          <p className="text-xs font-medium uppercase text-zinc-500">{footerText}</p>
        </footer>
      </div>
    </Card>
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

function splitRuleLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((rule) => rule.replace(/^\s*(?:\d+[.)-]\s*)/, "").trim())
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

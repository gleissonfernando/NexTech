import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCircle2, Hash, ImageIcon, Link2, Loader2, Send, Upload, UserCheck } from "lucide-react";
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
import type { DashboardGuild, GuildChannelOption, GuildRoleOption, GuildSettings } from "../../types";

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
const MAX_AUTOMATIC_ROLES = 2;

const panelConfig = {
  welcome: {
    channelKey: "welcomeChannelId",
    description: "Entrada de membros",
    displayChannelKey: "welcomeDisplayChannelId",
    enabledKey: "welcomeEnabled",
    imageKey: "welcomeImageUrl",
    loadingText: "Carregando configuracoes de entrada...",
    missingGuildText: "Selecione um servidor para configurar entrada.",
    missingSettingsText: "Nao foi possivel carregar as configuracoes de entrada.",
    savedImageText: "Banner de entrada atualizado.",
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
    loadingText: "Carregando configuracoes de saida...",
    missingGuildText: "Selecione um servidor para configurar saida.",
    missingSettingsText: "Nao foi possivel carregar as configuracoes de saida.",
    savedImageText: "Banner de saida atualizado.",
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
    loadingText: string;
    missingGuildText: string;
    missingSettingsText: string;
    savedImageText: string;
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
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [imageInput, setImageInput] = useState("");
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
  const autoRoleIds = settings?.autoRoleIds.slice(0, MAX_AUTOMATIC_ROLES) ?? [];

  useEffect(() => {
    if (!guild || !canManage) {
      setChannels([]);
      setRoles([]);
      return;
    }

    setLoadingChannels(true);
    getGuildLiveOptions(guild.id, botId)
      .then((options) => {
        setChannels(options.channels);
        setRoles(options.roles.filter((role) => role.id !== guild.id && !role.managed));
      })
      .catch(() => {
        setChannels([]);
        setRoles([]);
      })
      .finally(() => setLoadingChannels(false));
  }, [botId, canManage, guild]);

  useEffect(() => {
    const currentImageUrl = settings?.[config.imageKey] ?? "";
    setImageInput(/^https?:\/\//i.test(currentImageUrl) ? currentImageUrl : "");
  }, [config.imageKey, settings]);

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

  async function handleAutoRoleToggle(roleId: string, checked: boolean) {
    const nextRoleIds = checked
      ? [...new Set([...autoRoleIds, roleId])].slice(0, MAX_AUTOMATIC_ROLES)
      : autoRoleIds.filter((selectedRoleId) => selectedRoleId !== roleId);

    await savePatch(
      {
        autoRoleEnabled: Boolean(nextRoleIds.length),
        autoRoleIds: nextRoleIds
      },
      "autoRole",
      nextRoleIds.length ? "Cargos automaticos salvos e ativados." : "Cargos automaticos removidos."
    );
  }

  function handleAutoRoleEnabled(checked: boolean) {
    if (checked && !autoRoleIds.length) {
      setStatus(null);
      setError("Selecione primeiro pelo menos um cargo que o usuario vai receber.");
      return;
    }

    void savePatch(
      {
        autoRoleEnabled: checked
      },
      "autoRoleEnabled",
      checked ? "Cargo automatico ativado." : "Cargo automatico desativado."
    );
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

          {mode === "welcome" ? (
            <AutoRoleControl
              disabled={!canManage || loadingChannels || saving === "autoRole" || saving === "autoRoleEnabled"}
              enabled={settings.autoRoleEnabled}
              loading={loadingChannels}
              onEnabledChange={handleAutoRoleEnabled}
              onRoleToggle={(roleId, checked) => void handleAutoRoleToggle(roleId, checked)}
              roles={roles}
              values={autoRoleIds}
            />
          ) : null}

          <div className="space-y-3 rounded-lg border border-zinc-900 bg-zinc-950/75 p-4">
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
            <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-100">
              <CheckCircle2 className="h-4 w-4 text-zinc-400" />
              {status}
            </div>
          ) : null}
          {error ? <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-100">{error}</div> : null}
        </CardContent>
      </Card>

      <WelcomePreview
        displayChannelName={displayChannel?.name ?? destinationChannel?.name ?? "selecione_um_canal"}
        imageUrl={imageUrl}
        mode={mode}
        viewerName={viewerName}
      />
    </div>
  );
}

function AutoRoleControl({
  disabled,
  enabled,
  loading,
  onEnabledChange,
  onRoleToggle,
  roles,
  values
}: {
  disabled: boolean;
  enabled: boolean;
  loading: boolean;
  onEnabledChange: (checked: boolean) => void;
  onRoleToggle: (roleId: string, checked: boolean) => void;
  roles: GuildRoleOption[];
  values: string[];
}) {
  return (
    <div className="space-y-3 rounded-lg border border-zinc-900 bg-zinc-950/75 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-zinc-100">
            <UserCheck className="h-4 w-4 text-zinc-400" />
            Cargos automaticos ao entrar
          </p>
          <p className="mt-1 text-xs text-zinc-500">O novo membro recebe ate 2 cargos assim que entrar no Discord.</p>
        </div>
        <Switch checked={enabled} disabled={disabled} onCheckedChange={onEnabledChange} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-zinc-500">Cargos selecionados</span>
          <span className="text-xs text-zinc-500">{values.length}/{MAX_AUTOMATIC_ROLES}</span>
        </div>
        <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
          {loading ? (
            <p className="flex min-h-11 items-center gap-2 rounded-lg border border-zinc-900 bg-black px-3 py-2 text-sm text-zinc-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Carregando cargos...
            </p>
          ) : roles.length ? (
            roles.map((role) => {
              const checked = values.includes(role.id);
              const roleDisabled = disabled || !role.assignable || (!checked && values.length >= MAX_AUTOMATIC_ROLES);

              return (
                <label
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-zinc-900 bg-black px-3 py-2 text-sm text-zinc-100 transition hover:border-zinc-700 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
                  key={role.id}
                >
                  <input
                    checked={checked}
                    className="peer sr-only"
                    disabled={roleDisabled}
                    onChange={(event) => onRoleToggle(role.id, event.target.checked)}
                    type="checkbox"
                  />
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-zinc-700 bg-zinc-950 text-black transition peer-checked:border-emerald-400 peer-checked:bg-emerald-400">
                    {checked ? <Check className="h-3.5 w-3.5" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">@{role.name}</span>
                  {!role.assignable ? <span className="text-xs text-zinc-600">cargo acima do bot</span> : null}
                </label>
              );
            })
          ) : (
            <p className="rounded-lg border border-zinc-900 bg-black px-3 py-2 text-sm text-zinc-500">
              Nenhum cargo disponivel.
            </p>
          )}
        </div>
      </div>

      <p className="text-xs leading-5 text-zinc-500">
        O bot precisa da permissao Gerenciar Cargos e o cargo do bot deve ficar acima dos cargos selecionados.
      </p>
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
              <img alt="" className="aspect-video w-full object-cover object-top" src={imageUrl} />
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

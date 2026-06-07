import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Search, Twitch, X } from "lucide-react";
import { previewTwitchChannel } from "../../lib/api";
import { Avatar } from "../ui/avatar";
import { Button } from "../ui/button";
import type { CreateTwitchNotificationPayload, GuildLiveOptions, TwitchChannelPreview } from "../../types";

type AddTwitchChannelModalProps = {
  botId?: string | null;
  open: boolean;
  error: string | null;
  guildId: string | null;
  options: GuildLiveOptions;
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateTwitchNotificationPayload) => void;
};

const DEFAULT_EMBED_COLOR = "#9146FF";

export function AddTwitchChannelModal({ botId, error, guildId, onClose, onSubmit, open, options, saving }: AddTwitchChannelModalProps) {
  const [twitchChannelInput, setTwitchChannelInput] = useState("");
  const [discordChannelId, setDiscordChannelId] = useState("");
  const [mentionRoleId, setMentionRoleId] = useState("everyone");
  const [customMessage, setCustomMessage] = useState("");
  const [embedColor, setEmbedColor] = useState(DEFAULT_EMBED_COLOR);
  const [enabled, setEnabled] = useState(true);
  const [preview, setPreview] = useState<TwitchChannelPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const canSave = Boolean(preview && discordChannelId && !saving);
  const normalizedInput = useMemo(() => twitchChannelInput.trim(), [twitchChannelInput]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setPreview(null);
    setPreviewError(null);
  }, [open]);

  useEffect(() => {
    if (!open || discordChannelId || !options.channels.length) {
      return;
    }

    setDiscordChannelId(options.channels[0]?.id ?? "");
  }, [discordChannelId, open, options.channels]);

  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
  }, [normalizedInput]);

  async function handlePreview() {
    if (!guildId || !normalizedInput) {
      setPreviewError("Informe a URL do canal Twitch.");
      return;
    }

    setPreviewing(true);
    setPreviewError(null);

    try {
      const nextPreview = await previewTwitchChannel(guildId, normalizedInput, botId);
      setPreview(nextPreview);
    } catch (requestError) {
      setPreview(null);
      setPreviewError(readErrorMessage(requestError));
    } finally {
      setPreviewing(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <ModalShell onClose={onClose} title="Adicionar Canal Twitch">
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSave) {
            return;
          }

          onSubmit({
            twitchChannelInput,
            discordChannelId,
            mentionRoleId: mentionRoleId || null,
            customMessage: customMessage || null,
            embedColor,
            enabled
          });
        }}
      >
        <Field label="URL do Canal">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="social-input"
              onChange={(event) => setTwitchChannelInput(event.target.value)}
              placeholder="https://www.twitch.tv/vilao_00"
              type="url"
              value={twitchChannelInput}
            />
            <Button className="h-12 sm:h-auto" disabled={previewing || !normalizedInput} onClick={handlePreview} type="button" variant="outline">
              {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Buscar
            </Button>
          </div>
        </Field>

        {preview ? <TwitchPreviewCard preview={preview} /> : null}
        {previewError ? <p className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-white">{previewError}</p> : null}

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Canal Discord">
            {options.channels.length ? (
              <select className="social-input" onChange={(event) => setDiscordChannelId(event.target.value)} required value={discordChannelId}>
                {options.channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    #{channel.name}
                  </option>
                ))}
              </select>
            ) : (
              <input className="social-input" onChange={(event) => setDiscordChannelId(event.target.value)} placeholder="ID do canal Discord" value={discordChannelId} />
            )}
          </Field>

          <Field label="Cargo para mencionar">
            <select className="social-input" onChange={(event) => setMentionRoleId(event.target.value)} value={mentionRoleId}>
              <option value="everyone">@everyone</option>
              <option value="">Sem mencao</option>
              {options.roles
                .filter((role) => role.name !== "@everyone")
                .map((role) => (
                  <option key={role.id} value={role.id}>
                    @{role.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>

        <Field label="Texto dentro da embed">
          <textarea
            className="social-input min-h-24 resize-none"
            onChange={(event) => setCustomMessage(event.target.value)}
            placeholder="@Vilões [+18] FOCO MAXIMO 💯 | DC | VOZ | PIX"
            value={customMessage}
          />
        </Field>

        <div className="flex flex-col gap-4 rounded-lg border border-zinc-900 bg-zinc-950/70 p-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-3 text-sm text-zinc-400">
            <input checked={enabled} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />
            Ativar notificacao
          </label>
          <label className="flex items-center gap-3 text-sm text-zinc-400">
            <span>Cor da embed</span>
            <input className="h-9 w-12 rounded border border-zinc-800 bg-transparent p-1" onChange={(event) => setEmbedColor(event.target.value)} type="color" value={embedColor} />
            <span className="font-mono text-xs text-zinc-500">{embedColor}</span>
          </label>
        </div>

        {error ? <p className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-white">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="outline">Cancelar</Button>
          <Button disabled={!canSave} type="submit">
            {saving ? "Salvando..." : "Salvar canal"}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

function TwitchPreviewCard({ preview }: { preview: TwitchChannelPreview }) {
  return (
    <div className="rounded-lg border border-[#9146ff]/40 bg-[#160f24]/80 p-4 shadow-[0_18px_60px_rgba(145,70,255,0.12)]">
      <div className="flex items-center gap-3">
        <Avatar className="h-14 w-14 rounded-lg" fallback={preview.twitchDisplayName} src={preview.twitchAvatar} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Twitch className="h-4 w-4 text-[#9146ff]" />
            <span className="truncate">{preview.twitchDisplayName}</span>
          </div>
          <p className="mt-1 truncate text-xs text-zinc-400">@{preview.twitchUsername}</p>
          <p className="mt-1 truncate font-mono text-[11px] text-zinc-500">{preview.twitchId}</p>
        </div>
        <CheckCircle2 className="h-5 w-5 text-emerald-400" />
      </div>
    </div>
  );
}

export function ModalShell({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm">
      <div className="discord-scrollbar max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-zinc-800 bg-[#0b0b0b]/95 p-5 shadow-[0_32px_100px_rgba(0,0,0,0.72)] backdrop-blur-xl">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-500 transition duration-300 hover:text-white" onClick={onClose} type="button">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-white">{label}</span>
      {children}
    </label>
  );
}

function readErrorMessage(error: unknown) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? "Nao foi possivel consultar a Twitch.";
  }

  return "Nao foi possivel consultar a Twitch.";
}

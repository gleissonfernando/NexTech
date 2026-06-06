import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Field, ModalShell } from "./AddTwitchChannelModal";
import type { GuildLiveOptions, SocialNotification, UpdateTwitchNotificationPayload } from "../../types";

type EditTwitchChannelModalProps = {
  notification: SocialNotification | null;
  error: string | null;
  options: GuildLiveOptions;
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: UpdateTwitchNotificationPayload) => void;
};

export function EditTwitchChannelModal({ error, notification, onClose, onSubmit, options, saving }: EditTwitchChannelModalProps) {
  const [discordChannelId, setDiscordChannelId] = useState("");
  const [mentionRoleId, setMentionRoleId] = useState("everyone");
  const [customMessage, setCustomMessage] = useState("");
  const [embedColor, setEmbedColor] = useState("#9146FF");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!notification) {
      return;
    }

    setDiscordChannelId(notification.discordChannelId);
    setMentionRoleId(notification.mentionRoleId ?? "everyone");
    setCustomMessage(notification.customMessage ?? "");
    setEmbedColor(notification.embedColor ?? "#9146FF");
    setEnabled(notification.enabled);
  }, [notification]);

  if (!notification) {
    return null;
  }

  return (
    <ModalShell onClose={onClose} title={`Configurar @${notification.twitchChannelName}`}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            discordChannelId,
            mentionRoleId: mentionRoleId || null,
            customMessage: customMessage || null,
            embedColor,
            enabled
          });
        }}
      >
        <Field label="Canal para enviar lives">
          {options.channels.length ? (
            <select className="social-input" onChange={(event) => setDiscordChannelId(event.target.value)} required value={discordChannelId}>
              {options.channels.some((channel) => channel.id === discordChannelId) ? null : (
                <option value={discordChannelId}>Canal atual: {discordChannelId}</option>
              )}
              {options.channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  #{channel.name}
                </option>
              ))}
            </select>
          ) : (
            <input className="social-input" onChange={(event) => setDiscordChannelId(event.target.value)} value={discordChannelId} />
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
        <Field label="Mensagem personalizada">
          <textarea className="social-input min-h-24 resize-none" onChange={(event) => setCustomMessage(event.target.value)} placeholder="Opcional" value={customMessage} />
        </Field>
        <div className="flex flex-col gap-4 rounded-lg border border-zinc-900 bg-zinc-950/70 p-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-3 text-sm text-zinc-500">
            <input checked={enabled} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />
            Ativar notificacao
          </label>
          <label className="flex items-center gap-3 text-sm text-zinc-500">
            <span>Cor da embed</span>
            <input className="h-9 w-12 rounded border border-zinc-800 bg-transparent p-1" onChange={(event) => setEmbedColor(event.target.value)} type="color" value={embedColor} />
            <span className="font-mono text-xs">{embedColor}</span>
          </label>
        </div>
        {error ? <p className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-white">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="outline">Cancelar</Button>
          <Button disabled={saving} type="submit">
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

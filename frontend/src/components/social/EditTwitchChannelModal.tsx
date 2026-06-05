import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Field, ModalShell } from "./AddTwitchChannelModal";
import type { SocialNotification, UpdateTwitchNotificationPayload } from "../../types";

type EditTwitchChannelModalProps = {
  notification: SocialNotification | null;
  error: string | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: UpdateTwitchNotificationPayload) => void;
};

export function EditTwitchChannelModal({ error, notification, onClose, onSubmit, saving }: EditTwitchChannelModalProps) {
  const [discordChannelId, setDiscordChannelId] = useState("");
  const [mentionRoleId, setMentionRoleId] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!notification) {
      return;
    }

    setDiscordChannelId(notification.discordChannelId);
    setMentionRoleId(notification.mentionRoleId ?? "");
    setCustomMessage(notification.customMessage ?? "");
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
            enabled
          });
        }}
      >
        <Field label="Canal do Discord">
          <input className="social-input" onChange={(event) => setDiscordChannelId(event.target.value)} value={discordChannelId} />
        </Field>
        <Field label="Cargo para mencionar">
          <input className="social-input" onChange={(event) => setMentionRoleId(event.target.value)} placeholder="Opcional" value={mentionRoleId} />
        </Field>
        <Field label="Mensagem personalizada">
          <textarea className="social-input min-h-24 resize-none" onChange={(event) => setCustomMessage(event.target.value)} placeholder="Opcional" value={customMessage} />
        </Field>
        <label className="flex items-center gap-3 text-sm text-[#b8bec8]">
          <input checked={enabled} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />
          Ativar notificação
        </label>
        {error ? <p className="rounded-xl border border-[#36414e] bg-[#252d37] p-3 text-sm text-white">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="outline">Cancelar</Button>
          <Button className="bg-[#1684ff] text-white hover:bg-[#1684ff]/90" disabled={saving} type="submit">
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

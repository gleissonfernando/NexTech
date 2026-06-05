import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "../ui/button";
import type { CreateTwitchNotificationPayload } from "../../types";

type AddTwitchChannelModalProps = {
  open: boolean;
  error: string | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateTwitchNotificationPayload) => void;
};

export function AddTwitchChannelModal({ error, onClose, onSubmit, open, saving }: AddTwitchChannelModalProps) {
  const [twitchChannelInput, setTwitchChannelInput] = useState("");
  const [discordChannelId, setDiscordChannelId] = useState("");
  const [mentionRoleId, setMentionRoleId] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [enabled, setEnabled] = useState(true);

  if (!open) {
    return null;
  }

  return (
    <ModalShell onClose={onClose} title="Add Twitch channel">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            twitchChannelInput,
            discordChannelId,
            mentionRoleId: mentionRoleId || null,
            customMessage: customMessage || null,
            enabled
          });
        }}
      >
        <Field label="Link do canal da Twitch">
          <input className="social-input" onChange={(event) => setTwitchChannelInput(event.target.value)} placeholder="https://www.twitch.tv/ricardinn98" value={twitchChannelInput} />
        </Field>
        <Field label="Canal do Discord">
          <input className="social-input" onChange={(event) => setDiscordChannelId(event.target.value)} placeholder="ID do canal Discord" value={discordChannelId} />
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

export function ModalShell({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-[#36414e] bg-[#29313c] p-5 shadow-[0_32px_100px_rgba(0,0,0,0.62)]">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#252d37] text-[#b8bec8] transition duration-300 hover:text-white" onClick={onClose} type="button">
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

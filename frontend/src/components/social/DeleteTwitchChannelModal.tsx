import { Button } from "../ui/button";
import { ModalShell } from "./AddTwitchChannelModal";
import type { SocialNotification } from "../../types";

type DeleteTwitchChannelModalProps = {
  notification: SocialNotification | null;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function DeleteTwitchChannelModal({ deleting, notification, onClose, onConfirm }: DeleteTwitchChannelModalProps) {
  if (!notification) {
    return null;
  }

  return (
    <ModalShell onClose={onClose} title="Excluir canal Twitch">
      <p className="text-sm leading-6 text-[#b8bec8]">
        Remover @{notification.twitchChannelName} das notificações sociais deste servidor?
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose} type="button" variant="outline">Cancelar</Button>
        <Button disabled={deleting} onClick={onConfirm} type="button" variant="secondary">
          {deleting ? "Excluindo..." : "Excluir"}
        </Button>
      </div>
    </ModalShell>
  );
}

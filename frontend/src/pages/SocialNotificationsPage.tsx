import { useEffect, useMemo, useState } from "react";
import { Bell, Music2, Youtube } from "lucide-react";
import {
  createTwitchNotification,
  deleteTwitchNotification,
  getSocialNotifications,
  updateTwitchNotification
} from "../lib/api";
import { AddTwitchChannelModal } from "../components/social/AddTwitchChannelModal";
import { DeleteTwitchChannelModal } from "../components/social/DeleteTwitchChannelModal";
import { EditTwitchChannelModal } from "../components/social/EditTwitchChannelModal";
import { SocialCard } from "../components/social/SocialCard";
import { TwitchNotificationCard } from "../components/social/TwitchNotificationCard";
import type {
  CreateTwitchNotificationPayload,
  DashboardGuild,
  SocialNotification,
  UpdateTwitchNotificationPayload
} from "../types";

type SocialNotificationsPageProps = {
  guild: DashboardGuild | null;
};

export function SocialNotificationsPage({ guild }: SocialNotificationsPageProps) {
  const [notifications, setNotifications] = useState<SocialNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<SocialNotification | null>(null);
  const [deletingNotification, setDeletingNotification] = useState<SocialNotification | null>(null);

  const twitchCount = useMemo(
    () => notifications.filter((notification) => notification.platform === "twitch").length,
    [notifications]
  );

  useEffect(() => {
    if (!guild) {
      return;
    }

    setLoading(true);
    setError(null);

    getSocialNotifications(guild.id)
      .then(setNotifications)
      .catch((requestError: unknown) => setError(readErrorMessage(requestError)))
      .finally(() => setLoading(false));
  }, [guild]);

  async function handleCreate(payload: CreateTwitchNotificationPayload) {
    if (!guild) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const notification = await createTwitchNotification(guild.id, payload);
      setNotifications((current) => [notification, ...current]);
      setAddOpen(false);
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(payload: UpdateTwitchNotificationPayload) {
    if (!guild || !editing) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const notification = await updateTwitchNotification(guild.id, editing.id, payload);
      setNotifications((current) => current.map((item) => (item.id === notification.id ? notification : item)));
      setEditing(null);
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!guild || !deletingNotification) {
      return;
    }

    setDeleting(true);

    try {
      await deleteTwitchNotification(guild.id, deletingNotification.id);
      setNotifications((current) => current.filter((item) => item.id !== deletingNotification.id));
      setDeletingNotification(null);
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-120px)] rounded-3xl bg-[#1f2731] p-4 sm:p-6">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#29313c] text-white">
            <Bell className="h-6 w-6" />
          </div>
          <h2 className="text-3xl font-semibold text-white sm:text-4xl">Social Notifications</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#b8bec8]">
            Configure alertas sociais por servidor. O foco inicial é monitorar lives da Twitch.
          </p>
        </div>

        <div className="rounded-2xl bg-[#29313c] px-4 py-3 text-sm text-[#b8bec8]">
          Twitch: <span className="font-semibold text-white">{twitchCount}/5</span>
        </div>
      </div>

      {loading ? <div className="rounded-2xl bg-[#29313c] p-5 text-[#b8bec8]">Carregando notificações...</div> : null}
      {error ? <div className="mb-4 rounded-2xl border border-[#36414e] bg-[#252d37] p-4 text-sm text-white">{error}</div> : null}

      <div className="space-y-4">
        <SocialCard
          actionLabel="Set up"
          description="Video upload notifications for configured channels."
          icon={Youtube}
          iconClassName="text-[#ff0000]"
          title="YouTube"
        />

        <TwitchNotificationCard
          notifications={notifications}
          onAdd={() => {
            setError(null);
            setAddOpen(true);
          }}
          onDelete={setDeletingNotification}
          onEdit={(notification) => {
            setError(null);
            setEditing(notification);
          }}
        />

        <SocialCard
          actionLabel="Set up"
          description="Short video and live notifications for TikTok creators."
          icon={Music2}
          title="TikTok"
        />
      </div>

      <AddTwitchChannelModal
        error={error}
        onClose={() => setAddOpen(false)}
        onSubmit={handleCreate}
        open={addOpen}
        saving={saving}
      />
      <EditTwitchChannelModal
        error={error}
        notification={editing}
        onClose={() => setEditing(null)}
        onSubmit={handleUpdate}
        saving={saving}
      />
      <DeleteTwitchChannelModal
        deleting={deleting}
        notification={deletingNotification}
        onClose={() => setDeletingNotification(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}

function readErrorMessage(error: unknown) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? "Não foi possível concluir a ação.";
  }

  return "Não foi possível concluir a ação.";
}

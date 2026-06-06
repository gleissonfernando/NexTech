import { LogOut } from "lucide-react";
import { Avatar } from "./ui/avatar";
import { Button } from "./ui/button";
import type { AuthUser, DashboardMeUser } from "../types";

type UserProfileProps = {
  user: AuthUser;
  dashboardUser?: DashboardMeUser | null;
  compact?: boolean;
  onLogout: () => void;
};

export function UserProfile({ compact = false, dashboardUser, onLogout, user }: UserProfileProps) {
  const displayName = dashboardUser?.globalName ?? dashboardUser?.username ?? user.globalName ?? user.username;
  const avatarUrl = dashboardUser?.avatarUrl ?? user.avatarUrl ?? user.avatar;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex min-w-0 items-center gap-2 rounded-lg border border-purple-500/25 bg-zinc-950/95 px-2 py-1.5 shadow-[0_0_24px_rgba(124,58,237,0.12)] transition duration-300 hover:border-purple-400/45 hover:bg-zinc-900">
        <Avatar
          className="h-10 w-10 rounded-full border border-purple-400/70 shadow-[0_0_18px_rgba(168,85,247,0.42)]"
          fallback={displayName}
          src={avatarUrl}
        />
        {!compact ? (
          <div className="min-w-0 pr-1">
            <p className="max-w-40 truncate text-sm font-medium text-zinc-100">{displayName}</p>
            <p className="truncate text-xs text-zinc-500">{user.discriminator && user.discriminator !== "0" ? user.tag : user.discordId}</p>
          </div>
        ) : null}
      </div>

      <Button aria-label="Sair" onClick={onLogout} size="icon" title="Sair" variant="ghost">
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}

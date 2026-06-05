import type { ReactNode } from "react";
import { Sidebar, type ViewId } from "./sidebar";
import { Topbar } from "./topbar";
import type { AuthUser, DashboardGuild } from "../../types";

type DashboardLayoutProps = {
  activeView: ViewId;
  children: ReactNode;
  guilds: DashboardGuild[];
  selectedGuildId: string | null;
  user: AuthUser;
  onChangeView: (view: ViewId) => void;
  onLogout: () => void;
  onSelectGuild: (guildId: string) => void;
};

export function DashboardLayout({
  activeView,
  children,
  guilds,
  selectedGuildId,
  user,
  onChangeView,
  onLogout,
  onSelectGuild
}: DashboardLayoutProps) {
  return (
    <div className="min-h-screen pb-20 lg:pb-0 lg:pl-64">
      <Sidebar activeView={activeView} onChangeView={onChangeView} />
      <Topbar
        guilds={guilds}
        onLogout={onLogout}
        onSelectGuild={onSelectGuild}
        selectedGuildId={selectedGuildId}
        user={user}
      />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-8">{children}</main>
    </div>
  );
}

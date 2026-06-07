import type { ReactNode } from "react";
import { useState } from "react";
import { Sidebar, type ViewId } from "./sidebar";
import { Topbar } from "./topbar";
import type { AuthUser, DashboardGuild, DashboardMeUser } from "../../types";

type DashboardLayoutProps = {
  activeView: ViewId;
  children: ReactNode;
  dashboardUser?: DashboardMeUser | null;
  guilds: DashboardGuild[];
  selectedGuildId: string | null;
  enabledModules: string[];
  user: AuthUser;
  onChangeView: (view: ViewId) => void;
  onLogout: () => void;
  onSelectGuild: (guildId: string) => void;
};

export function DashboardLayout({
  activeView,
  children,
  dashboardUser,
  enabledModules,
  guilds,
  selectedGuildId,
  user,
  onChangeView,
  onLogout,
  onSelectGuild
}: DashboardLayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#050505] lg:pl-72">
      <Sidebar
        activeView={activeView}
        enabledModules={enabledModules}
        isOpen={menuOpen}
        onChangeView={onChangeView}
        onClose={() => setMenuOpen(false)}
      />
      <Topbar
        guilds={guilds}
        onLogout={onLogout}
        onOpenMenu={() => setMenuOpen(true)}
        onSelectGuild={onSelectGuild}
        selectedGuildId={selectedGuildId}
        dashboardUser={dashboardUser}
        user={user}
      />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}

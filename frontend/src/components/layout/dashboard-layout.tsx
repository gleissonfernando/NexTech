import type { ReactNode } from "react";
import { useState } from "react";
import { Sidebar, type ViewId } from "./sidebar";
import { Topbar } from "./topbar";
import type { AuthUser, BotStatus, DashboardBot, DashboardGuild, DashboardMeUser } from "../../types";

type DashboardLayoutProps = {
  activeView: ViewId;
  bots: DashboardBot[];
  children: ReactNode;
  dashboardUser?: DashboardMeUser | null;
  guilds: DashboardGuild[];
  selectedBot: DashboardBot | null;
  selectedGuildId: string | null;
  status: BotStatus;
  enabledModules: string[];
  user: AuthUser;
  onChangeView: (view: ViewId) => void;
  onLogout: () => void;
  onSelectBot: (botId: string) => void;
  onSelectGuild: (guildId: string) => void;
};

export function DashboardLayout({
  activeView,
  bots,
  children,
  dashboardUser,
  enabledModules,
  guilds,
  selectedBot,
  selectedGuildId,
  status,
  user,
  onChangeView,
  onLogout,
  onSelectBot,
  onSelectGuild
}: DashboardLayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [secondaryCollapsed, setSecondaryCollapsed] = useState(false);

  return (
    <div className={secondaryCollapsed ? "min-h-screen overflow-x-hidden bg-[#050505] lg:pl-20" : "min-h-screen overflow-x-hidden bg-[#050505] lg:pl-[25rem]"}>
      <Sidebar
        activeView={activeView}
        bots={bots}
        enabledModules={enabledModules}
        isOpen={menuOpen}
        isSecondaryCollapsed={secondaryCollapsed}
        onChangeView={onChangeView}
        onClose={() => setMenuOpen(false)}
        onSelectBot={onSelectBot}
        onToggleSecondary={() => setSecondaryCollapsed((current) => !current)}
        selectedBot={selectedBot}
        status={status}
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
      <main className="mx-auto min-w-0 w-full max-w-[92rem] px-3 py-4 sm:px-6 sm:py-5 lg:px-8">{children}</main>
    </div>
  );
}

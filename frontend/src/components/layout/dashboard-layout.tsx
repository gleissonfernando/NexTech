import type { ReactNode } from "react";
import { useState } from "react";
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
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#050505] lg:pl-72">
      <Sidebar
        activeView={activeView}
        isOpen={menuOpen}
        onChangeView={onChangeView}
        onClose={() => setMenuOpen(false)}
        serverName={guilds.find((guild) => guild.id === selectedGuildId)?.name ?? guilds[0]?.name ?? "Servidor"}
      />
      <Topbar
        guilds={guilds}
        onLogout={onLogout}
        onOpenMenu={() => setMenuOpen(true)}
        onSelectGuild={onSelectGuild}
        selectedGuildId={selectedGuildId}
        user={user}
      />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}

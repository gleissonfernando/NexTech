import { memo } from "react";

/**
 * Componente memoizado para Header da Dashboard
 * Evita re-render quando apenas dados internos mudam
 */
export const UserDashboardHeader = memo(function UserDashboardHeader({
  bot,
  selectedGuild,
  status
}: {
  bot: { id?: string; name?: string } | null;
  selectedGuild: { id?: string; name?: string } | null;
  status: { online?: boolean };
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold text-white">{selectedGuild?.name || "Dashboard"}</h1>
        {bot && <p className="text-sm text-zinc-400">Bot: {bot.name}</p>}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Comparação customizada para otimizar
  return (
    prevProps.bot?.id === nextProps.bot?.id &&
    prevProps.selectedGuild?.id === nextProps.selectedGuild?.id &&
    prevProps.status.online === nextProps.status.online
  );
});

UserDashboardHeader.displayName = "UserDashboardHeader";

/**
 * Componente memoizado para cada view
 */
export const OverviewViewMemo = memo(
  ({ children }: { children: React.ReactNode }) => <>{children}</>,
  () => false // Sempre renderiza quando children mudam
);

OverviewViewMemo.displayName = "OverviewViewMemo";

/**
 * Wrapper para reduzir re-renders de panels
 */
export const PanelWrapper = memo(
  ({ children, active }: { children: React.ReactNode; active: boolean }) => (
    active ? <>{children}</> : null
  ),
  (prevProps, nextProps) => prevProps.active === nextProps.active
);

PanelWrapper.displayName = "PanelWrapper";

export const DASHBOARD_ACCESS_LEVELS = ["admin", "moderator", "premium", "basic"] as const;

export type DashboardAccessLevel = (typeof DASHBOARD_ACCESS_LEVELS)[number];
export type SessionAccessLevel = DashboardAccessLevel | "viewer";

export type DashboardPermissionFlags = {
  canAccessDashboard: boolean;
  canConfigureGuilds: boolean;
  canManageAccess: boolean;
  canManageBots: boolean;
  canManageDashboard: boolean;
  canManageGlobalSettings: boolean;
  canManageGuilds: boolean;
  canManageModules: boolean;
  canManageOwnServices: boolean;
  canManageUsers: boolean;
  canUsePremium: boolean;
  canViewUsers: boolean;
};

const ACCESS_LEVEL_RANK: Record<DashboardAccessLevel, number> = {
  basic: 1,
  premium: 2,
  moderator: 3,
  admin: 4
};

const PREMIUM_MODULE_IDS = new Set(["live", "kick-integration", "clips", "kick-clips", "giveaway", "network", "x-monitor", "mission-tools", "voice-recorder", "emoji-cloner", "server-cloner", "server-generator", "rules", "account-age-security", "safe-bot", "anti-abuse", "anti-disconnect", "fivem", "fivem-factions", "fivem-corporations", "fivem-absences", "fivem-orders", "fivem-washing", "fivem-drugs", "fivem-ammo", "fivem-finance", "fivem-goals", "fivem-hierarchy", "fivem-fac"]);
const BASIC_READ_MODULE_IDS = new Set(["logs", "tickets"]);
const CRITICAL_MODULE_IDS = new Set(["verification"]);

export function normalizeDashboardAccessLevel(value: unknown, fallback: DashboardAccessLevel = "basic"): DashboardAccessLevel {
  return typeof value === "string" && isDashboardAccessLevel(value) ? value : fallback;
}

export function normalizeSessionAccessLevel(value: unknown): SessionAccessLevel {
  return value === "viewer" ? "viewer" : normalizeDashboardAccessLevel(value, "basic");
}

export function isDashboardAccessLevel(value: string): value is DashboardAccessLevel {
  return (DASHBOARD_ACCESS_LEVELS as readonly string[]).includes(value);
}

export function compareDashboardAccessLevel(left: DashboardAccessLevel, right: DashboardAccessLevel) {
  return ACCESS_LEVEL_RANK[left] - ACCESS_LEVEL_RANK[right];
}

export function highestDashboardAccessLevel(levels: Array<DashboardAccessLevel | null | undefined>) {
  return levels.reduce<DashboardAccessLevel | null>((highest, level) => {
    if (!level) {
      return highest;
    }

    if (!highest || compareDashboardAccessLevel(level, highest) > 0) {
      return level;
    }

    return highest;
  }, null);
}

export function dashboardPermissionsForLevel(level: SessionAccessLevel): DashboardPermissionFlags {
  if (level === "viewer") {
    return {
      canAccessDashboard: false,
      canConfigureGuilds: false,
      canManageAccess: false,
      canManageBots: false,
      canManageDashboard: false,
      canManageGlobalSettings: false,
      canManageGuilds: false,
      canManageModules: false,
      canManageOwnServices: false,
      canManageUsers: false,
      canUsePremium: false,
      canViewUsers: false
    };
  }

  if (level === "admin") {
    return {
      canAccessDashboard: true,
      canConfigureGuilds: true,
      canManageAccess: true,
      canManageBots: true,
      canManageDashboard: true,
      canManageGlobalSettings: true,
      canManageGuilds: true,
      canManageModules: true,
      canManageOwnServices: true,
      canManageUsers: true,
      canUsePremium: true,
      canViewUsers: true
    };
  }

  if (level === "moderator") {
    return {
      canAccessDashboard: true,
      canConfigureGuilds: true,
      canManageAccess: false,
      canManageBots: false,
      canManageDashboard: true,
      canManageGlobalSettings: false,
      canManageGuilds: true,
      canManageModules: true,
      canManageOwnServices: false,
      canManageUsers: false,
      canUsePremium: true,
      canViewUsers: true
    };
  }

  if (level === "premium") {
    return {
      canAccessDashboard: true,
      canConfigureGuilds: false,
      canManageAccess: false,
      canManageBots: false,
      canManageDashboard: false,
      canManageGlobalSettings: false,
      canManageGuilds: false,
      canManageModules: false,
      canManageOwnServices: true,
      canManageUsers: false,
      canUsePremium: true,
      canViewUsers: false
    };
  }

  return {
    canAccessDashboard: true,
    canConfigureGuilds: false,
    canManageAccess: false,
    canManageBots: false,
    canManageDashboard: false,
    canManageGlobalSettings: false,
    canManageGuilds: false,
    canManageModules: false,
    canManageOwnServices: false,
    canManageUsers: false,
    canUsePremium: false,
    canViewUsers: false
  };
}

export function canManageDashboardAccessLevel(level: SessionAccessLevel) {
  const permissions = dashboardPermissionsForLevel(level);
  return permissions.canManageDashboard;
}

export function canManageCriticalSettings(level: SessionAccessLevel) {
  return dashboardPermissionsForLevel(level).canManageGlobalSettings;
}

export function canReadModuleAtLevel(level: SessionAccessLevel, moduleId: string) {
  if (level === "viewer") {
    return false;
  }

  if (level === "basic") {
    return BASIC_READ_MODULE_IDS.has(moduleId);
  }

  return true;
}

export function canManageModuleAtLevel(level: SessionAccessLevel, moduleId: string) {
  if (level === "admin") {
    return true;
  }

  if (level === "moderator") {
    return !CRITICAL_MODULE_IDS.has(moduleId);
  }

  if (level === "premium") {
    return PREMIUM_MODULE_IDS.has(moduleId) || moduleId.startsWith("fivem-custom-");
  }

  return false;
}

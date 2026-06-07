import { env } from "./env";

const dashboardDevUserIds = new Set(
  env.DASHBOARD_DEV_USER_IDS.split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);

export function isDashboardDevUserId(discordId: string | null | undefined) {
  return Boolean(discordId && dashboardDevUserIds.has(discordId));
}

const DASHBOARD_DEV_USER_ID = "1426287249020158018";

export function isDashboardDevUserId(discordId: string | null | undefined) {
  return discordId === DASHBOARD_DEV_USER_ID;
}

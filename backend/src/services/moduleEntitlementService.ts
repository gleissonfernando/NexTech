const PLAN_ENTITLEMENT_MODULES: Record<string, readonly string[]> = {
  "streamer.twitch_alerts": ["live"],
  "streamer.kick_alerts": ["kick-integration"],
  "streamer.clip_automation": ["clips", "kick-clips"],
  "streamer.giveaways": ["giveaway"],
  "fivem.finance": ["fivem-finance"],
  "fivem.orders": ["fivem-orders", "fivem-washing", "fivem-drugs", "fivem-ammo"],
  "fivem.hierarchy": ["fivem-hierarchy"],
  "fivem.police_basic": [
    "fivem",
    "fivem-corporations",
    "police-absences",
    "police-actions",
    "police-qru",
    "police-time-clock"
  ],
  "fivem.police": [
    "fivem",
    "fivem-corporations",
    "police-absences",
    "police-actions",
    "police-iab",
    "police-hr",
    "rh-admin",
    "police-daf-roster",
    "police-courses",
    "police-patrol-reports",
    "police-qru",
    "police-promotions",
    "vehicle-abandonment",
    "police-hidden-channel",
    "visible-message",
    "message-control",
    "police-dm",
    "police-subpoenas",
    "police-open-duty",
    "police-time-clock",
    "auto-activity-clock"
  ],
  "fivem.faction": [
    "fivem",
    "fivem-factions",
    "fivem-absences",
    "fivem-actions",
    "manual-registration",
    "faction-chest",
    "ztk-webhook",
    "fivem-captcha",
    "fivem-commands"
  ],
  "discord.logs": ["logs"],
  "discord.tickets": ["tickets"],
  "discord.courses": ["courses"],
  "security.anti_ban": ["anti-ban"],
  "security.self_bot": ["safe-bot"],
  "security.role_protection": ["moderation", "advanced-permissions", "account-age-security"]
};

export function expandModuleAccessKeys(keys: readonly string[]) {
  const result: string[] = [];

  for (const key of keys) {
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;
    result.push(...(PLAN_ENTITLEMENT_MODULES[normalizedKey] ?? [normalizedKey]));
  }

  return unique(result);
}

export function moduleIdsFromPlanEntitlementKeys(keys: readonly string[]) {
  const result: string[] = [];

  for (const key of keys) {
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;
    const mappedModules = PLAN_ENTITLEMENT_MODULES[normalizedKey];
    if (mappedModules) {
      result.push(...mappedModules);
      continue;
    }
    if (!normalizedKey.includes(".")) {
      result.push(normalizedKey);
    }
  }

  return unique(result);
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

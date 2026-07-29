import { strict as assert } from "node:assert";
import { test } from "node:test";
import { expandModuleAccessKeys, moduleIdsFromPlanEntitlementKeys } from "./moduleEntitlementService";

test("converte entitlements comerciais em modulos reais", () => {
  assert.deepEqual(
    moduleIdsFromPlanEntitlementKeys([
      "streamer.twitch_alerts",
      "streamer.kick_alerts",
      "streamer.clip_automation",
      "discord.logs"
    ]),
    ["live", "kick-integration", "clips", "kick-clips", "logs"]
  );
});

test("ignora entitlements de cobranca e suporte no cadastro de bot", () => {
  assert.deepEqual(
    moduleIdsFromPlanEntitlementKeys([
      "billing.lifetime_license",
      "billing.future_updates",
      "support.priority",
      "discord.dashboard",
      "fivem.finance"
    ]),
    ["fivem-finance"]
  );
});

test("converte plano policia basico em modulos essenciais", () => {
  assert.deepEqual(
    moduleIdsFromPlanEntitlementKeys([
      "fivem.police_basic",
      "fivem.hierarchy",
      "discord.logs",
      "discord.dashboard"
    ]),
    [
      "fivem",
      "fivem-corporations",
      "police-absences",
      "police-actions",
      "police-qru",
      "police-time-clock",
      "fivem-hierarchy",
      "logs"
    ]
  );
});

test("expande chaves antigas sem remover modulos ja validos", () => {
  assert.deepEqual(
    expandModuleAccessKeys(["fivem.police", "safe-bot"]),
    [
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
      "auto-activity-clock",
      "safe-bot"
    ]
  );
});

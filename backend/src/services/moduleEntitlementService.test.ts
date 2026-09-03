import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEV_MODULES } from "./devBotService";
import { expandModuleAccessKeys, mergeModuleIdsWithPlanEntitlementKeys, moduleIdsFromPlanEntitlementKeys } from "./moduleEntitlementService";

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

test("converte plano faccao basico sem encomendas e financeiro", () => {
  assert.deepEqual(
    moduleIdsFromPlanEntitlementKeys([
      "fivem.faction_basic",
      "discord.logs",
      "discord.dashboard"
    ]),
    [
      "fivem",
      "fivem-factions",
      "fivem-absences",
      "fivem-actions",
      "manual-registration",
      "logs"
    ]
  );
});

test("converte plano protecao basico sem permissoes avancadas e selfbot", () => {
  assert.deepEqual(
    moduleIdsFromPlanEntitlementKeys([
      "security.role_protection_basic",
      "security.anti_ban",
      "discord.logs"
    ]),
    [
      "moderation",
      "account-age-security",
      "anti-ban",
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
      "police_reports",
      "police-recruitment",
      "police-qru",
      "police-promotions",
      "police-rank-up",
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

test("inclui o modulo de cursos na lista de modulos liberados", () => {
  assert.ok(DEV_MODULES.some((module) => module.id === "courses"));
});

test("mescla entitlements de plano sem remover modulos ja liberados", () => {
  assert.deepEqual(
    mergeModuleIdsWithPlanEntitlementKeys(["courses", "safe-bot"], ["discord.courses", "discord.logs"]),
    ["courses", "safe-bot", "logs"]
  );
});

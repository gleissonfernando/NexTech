import assert from "node:assert/strict";
import test from "node:test";
import { PermissionFlagsBits, type Guild } from "discord.js";
import type { ManualPaymentSettings } from "./apiClient";
import { buildPrivatePaymentChannelOverwrites } from "./manualPaymentService";

function settingsWithRoles(): ManualPaymentSettings {
  return {
    approveRoleIds: ["approver-admin", "approver-staff"],
    attendanceCategoryId: null,
    bannerUrl: null,
    botId: "bot-runtime",
    color: "#22c55e",
    enabled: true,
    finalizeRoleIds: ["finalizer-staff"],
    guildId: "guild",
    id: "settings",
    logChannelId: null,
    logViewRoleIds: ["viewer-staff"],
    maxPaymentMinutes: 60,
    paymentCategoryId: null,
    paymentInstructions: "",
    pixCopyPasteCode: null,
    pixKey: null,
    pixKeyType: "random",
    pixQrCodeUrl: null,
    receiverBank: null,
    receiverName: null,
    rejectRoleIds: ["reject-admin"],
    salePanelChannelId: null,
    salePanelDescription: "",
    salePanelMessageId: null,
    salePanelTitle: "Servicos",
    services: [],
    supportPanelChannelId: null,
    updatedAt: new Date().toISOString()
  };
}

function guildWithRoles() {
  const role = (admin: boolean) => ({
    permissions: {
      has: (permission: bigint) => admin && permission === PermissionFlagsBits.Administrator
    }
  });

  return {
    client: { user: { id: "bot-user" } },
    members: { me: { id: "bot-user" } },
    ownerId: "owner-user",
    roles: {
      cache: new Map([
        ["approver-admin", role(true)],
        ["approver-staff", role(false)],
        ["finalizer-staff", role(false)],
        ["reject-admin", role(true)],
        ["viewer-staff", role(false)]
      ]),
      everyone: { id: "everyone" }
    }
  } as unknown as Guild;
}

test("canal temporario de pagamento libera somente comprador, bot, dono e cargos admin", () => {
  const overwrites = buildPrivatePaymentChannelOverwrites(guildWithRoles(), settingsWithRoles(), "buyer-user");

  assert.deepEqual(overwrites.map((overwrite) => overwrite.id), [
    "everyone",
    "buyer-user",
    "bot-user",
    "owner-user",
    "approver-admin",
    "reject-admin"
  ]);
});

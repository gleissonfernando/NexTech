import test from "node:test";
import assert from "node:assert/strict";
import type { AutomatedLogSettings } from "./apiClient";
import { automatedLogDestinationForType } from "./automatedLogService";

const settings: AutomatedLogSettings = {
  id: "settings-1",
  botId: "12345",
  guildId: "67890",
  enabled: true,
  categoryId: "100",
  channels: {
    absence: "101",
    calls: "102",
    messages: "103",
    punishment: "104",
    site: "105",
    verification: "106"
  },
  enabledChannels: {
    absence: true,
    calls: true,
    messages: false,
    punishment: true,
    site: true,
    verification: true
  },
  allowedRoleIds: [],
  lastError: null,
  lastSyncedAt: null,
  lastSyncRequestedAt: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString()
};

test("automated log destination keeps disabled modules without channel fallback", () => {
  const destination = automatedLogDestinationForType(settings, "message.delete");

  assert.equal(destination.key, "messages");
  assert.equal(destination.enabled, false);
  assert.equal(destination.channelId, null);
});

test("automated log destination routes active call logs to the configured channel", () => {
  const destination = automatedLogDestinationForType(settings, "voice.join");

  assert.equal(destination.key, "calls");
  assert.equal(destination.enabled, true);
  assert.equal(destination.channelId, "102");
});

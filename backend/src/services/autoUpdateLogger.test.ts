import assert from "node:assert/strict";
import test from "node:test";

test("auto update logger marca pendente antes do envio e sent depois", () => {
  const startedAt = "2026-08-28T12:34:56.000Z";
  // @ts-expect-error script externo sem declaração TS no workspace backend
  return import("../../../scripts/auto-update-logger.mjs").then((module: {
    buildAutoUpdatePublicationState: (channelId: string | null, startedAt?: string) => {
      pending: {
        discordChannelId: string | null;
        discordPublishStartedAt: string;
        discordPublishStatus: "pending";
        publishSkippedReason: null;
      };
      sent: {
        discordChannelId: string | null;
        discordPublishStatus: "sent";
        publishSkippedReason: null;
      };
    };
  }) => {
    const state = module.buildAutoUpdatePublicationState("123456789012345678", startedAt);

    assert.deepEqual(state.pending, {
      discordChannelId: "123456789012345678",
      discordPublishStartedAt: startedAt,
      discordPublishStatus: "pending",
      publishSkippedReason: null
    });

    assert.deepEqual(state.sent, {
      discordChannelId: "123456789012345678",
      discordPublishStatus: "sent",
      publishSkippedReason: null
    });
  });
});

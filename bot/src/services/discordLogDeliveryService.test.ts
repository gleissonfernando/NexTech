import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { voiceLogMetadata } from "./discordLogDeliveryService";

describe("voiceLogMetadata", () => {
  it("reads voice channel ids from nested system log details", () => {
    const metadata = voiceLogMetadata({
      channelId: null,
      details: {
        durationSeconds: 42,
        fromChannelId: "15246287240020158018",
        toChannelId: "1532376009264070797"
      }
    });

    assert.equal(metadata.fromChannelId, "15246287240020158018");
    assert.equal(metadata.toChannelId, "1532376009264070797");
    assert.equal(metadata.durationSeconds, 42);
  });

  it("keeps direct metadata fields compatible", () => {
    const metadata = voiceLogMetadata({
      channelId: "111",
      durationSeconds: 7,
      fromChannelId: "222",
      toChannelId: "333"
    });

    assert.deepEqual(metadata, {
      channelId: "111",
      durationSeconds: 7,
      fromChannelId: "222",
      toChannelId: "333"
    });
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatRequestedRoomName } from "./temporaryVoiceService";

describe("formatRequestedRoomName", () => {
  it("formats requested room names with the configured prefix, user name and id", () => {
    assert.equal(formatRequestedRoomName("João Silva", "123"), "📕┋João Silva 123");
  });

  it("removes unsafe channel-name characters and whitespace", () => {
    assert.equal(formatRequestedRoomName(" @Maria\nLima ", " #456 "), "📕┋Maria Lima 456");
  });

  it("keeps the Discord channel name within 100 characters", () => {
    const formatted = formatRequestedRoomName("A".repeat(120), "1234567890");
    assert.equal(formatted.length, 100);
    assert.ok(formatted.startsWith("📕┋"));
  });

  it("rejects empty name or id", () => {
    assert.throws(() => formatRequestedRoomName("   ", "123"), /Nome do usuário obrigatório/);
    assert.throws(() => formatRequestedRoomName("João", "   "), /ID do usuário obrigatório/);
  });
});

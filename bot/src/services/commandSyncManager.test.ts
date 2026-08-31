import assert from "node:assert/strict";
import test from "node:test";
import { buildCommandSyncSignature, shouldSkipCommandSync } from "./commandSyncManager";

test("command sync hash permanece estável com mesma estrutura e ordem diferente", () => {
  const commandsA = [
    { data: { toJSON: () => ({ description: "b", name: "beta" }) } },
    { data: { toJSON: () => ({ description: "a", name: "alpha" }) } }
  ] as never;
  const commandsB = [
    { data: { toJSON: () => ({ description: "a", name: "alpha" }) } },
    { data: { toJSON: () => ({ description: "b", name: "beta" }) } }
  ] as never;

  const hashA = buildCommandSyncSignature(commandsA, ["2", "1"]);
  const hashB = buildCommandSyncSignature(commandsB, ["1", "2"]);

  assert.equal(hashA, hashB);
});

test("command sync é ignorado quando hash, versão e escopo batem", () => {
  assert.equal(
    shouldSkipCommandSync(
      {
        commandHash: "abc",
        commandVersion: 1,
        dirty: false,
        guildIdsHash: "xyz",
        guildCount: 2,
        globalCleanupHash: "abc",
        lastReason: null,
        lastSyncedAt: null
      },
      {
        commandHash: "abc",
        commandVersion: 1,
        guildIdsHash: "xyz"
      }
    ),
    true
  );
});

test("command sync não é ignorado quando force está ativo", () => {
  assert.equal(
    shouldSkipCommandSync(
      {
        commandHash: "abc",
        commandVersion: 1,
        dirty: false,
        guildIdsHash: "xyz",
        guildCount: 2,
        globalCleanupHash: "abc",
        lastReason: null,
        lastSyncedAt: null
      },
      {
        commandHash: "abc",
        commandVersion: 1,
        force: true,
        guildIdsHash: "xyz"
      }
    ),
    false
  );
});

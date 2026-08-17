import assert from "node:assert/strict";
import test from "node:test";
import { isPoliceRankUpFullAccessUser } from "./policeRankUpService";

test("usuário liberado possui acesso total ao sistema de UP", () => {
  assert.equal(isPoliceRankUpFullAccessUser("1426287249020158018"), true);
  assert.equal(isPoliceRankUpFullAccessUser("1426287249020158019"), false);
  assert.equal(isPoliceRankUpFullAccessUser(null), false);
});

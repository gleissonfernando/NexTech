import assert from "node:assert/strict";
import test from "node:test";
import { metricsSnapshot, recordHttpRequest } from "./monitoringService";

test("metrics snapshot includes event loop lag and route aggregates", () => {
  recordHttpRequest({
    durationMs: 12,
    method: "get",
    path: "/api/users/12345",
    statusCode: 200
  });

  const snapshot = metricsSnapshot();

  assert.equal(typeof snapshot.eventLoop.p50Ms, "number");
  assert.equal(typeof snapshot.eventLoop.p95Ms, "number");
  assert.equal(typeof snapshot.eventLoop.p99Ms, "number");
  assert.equal(snapshot.routes.length > 0, true);
  assert.equal(snapshot.routes[0]?.route, "GET /api/users/:id");
});

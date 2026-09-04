import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { MongoPlanSubscription, MongoPlanWorkspace } from "../database/mongo";
import { evaluatePlanSubscription, evaluatePresenceResponseStatus } from "./dashboardAccessPolicyService";

const now = new Date("2026-09-04T12:00:00.000Z");

function workspace(input: Partial<MongoPlanWorkspace> = {}): Pick<MongoPlanWorkspace, "status" | "subscriptionId"> {
  return {
    status: "active",
    subscriptionId: "sub-1",
    ...input
  } as Pick<MongoPlanWorkspace, "status" | "subscriptionId">;
}

function subscription(
  input: Partial<MongoPlanSubscription> = {}
): Pick<MongoPlanSubscription, "status" | "planId" | "planSlug" | "startedAt" | "endsAt"> {
  return {
    status: "active",
    planId: "plan-1",
    planSlug: "pro",
    startedAt: new Date("2026-08-01T00:00:00.000Z"),
    endsAt: new Date("2026-10-01T00:00:00.000Z"),
    ...input
  } as Pick<MongoPlanSubscription, "status" | "planId" | "planSlug" | "startedAt" | "endsAt">;
}

test("plano ativo dentro da validade libera acesso", () => {
  const plan = evaluatePlanSubscription(workspace(), subscription(), now);
  assert.equal(plan.active, true);
  assert.equal(plan.planSlug, "pro");
  assert.equal(plan.reason, null);
});

test("assinatura sem data de término continua válida", () => {
  const plan = evaluatePlanSubscription(workspace(), subscription({ endsAt: null }), now);
  assert.equal(plan.active, true);
});

test("assinatura vencida bloqueia", () => {
  const plan = evaluatePlanSubscription(
    workspace(),
    subscription({ endsAt: new Date("2026-09-01T00:00:00.000Z") }),
    now
  );
  assert.equal(plan.active, false);
  assert.equal(plan.reason, "Assinatura vencida.");
});

test("assinatura suspensa ou cancelada bloqueia", () => {
  for (const status of ["suspended", "cancelled", "pending"] as MongoPlanSubscription["status"][]) {
    const plan = evaluatePlanSubscription(workspace(), subscription({ status }), now);
    assert.equal(plan.active, false, `status ${status} não deveria liberar`);
  }
});

test("sem workspace, workspace cancelado ou sem assinatura bloqueia", () => {
  assert.equal(evaluatePlanSubscription(null, subscription(), now).active, false);
  assert.equal(evaluatePlanSubscription(workspace({ status: "cancelled" }), subscription(), now).active, false);
  assert.equal(evaluatePlanSubscription(workspace(), null, now).active, false);
});

test("presença: 200 confirma bot no servidor", () => {
  assert.equal(evaluatePresenceResponseStatus(200), "present");
});

test("presença: 401, 403 e 404 confirmam que o bot não está no servidor", () => {
  assert.equal(evaluatePresenceResponseStatus(401), "absent");
  assert.equal(evaluatePresenceResponseStatus(403), "absent");
  assert.equal(evaluatePresenceResponseStatus(404), "absent");
});

test("presença: falha do Discord não vira negação", () => {
  for (const status of [429, 500, 502, 503, null, undefined]) {
    assert.equal(evaluatePresenceResponseStatus(status), "unknown", `status ${status} não deveria ser conclusivo`);
  }
});

test("bot sem nenhum registro de plano é distinguido de plano vencido", () => {
  const semPlano = evaluatePlanSubscription(null, null, now);
  assert.equal(semPlano.hasPlanRecord, false);

  const vencido = evaluatePlanSubscription(
    workspace(),
    subscription({ endsAt: new Date("2026-09-01T00:00:00.000Z") }),
    now
  );
  assert.equal(vencido.hasPlanRecord, true);
  assert.equal(vencido.active, false);
});

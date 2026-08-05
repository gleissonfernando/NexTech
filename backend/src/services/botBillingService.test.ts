import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { MongoBotBillingInvoice, MongoDevBot } from "../database/mongo";
import { evaluateBotBillingShutdown } from "./botBillingService";

const now = new Date("2026-08-04T15:00:00.000Z");

function bot(input: Partial<MongoDevBot> = {}): MongoDevBot {
  return {
    _id: "bot-1",
    avatarUrl: null,
    billingModel: "monthly",
    clientId: "client-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    createdBy: "user-1",
    desiredOnline: true,
    enabledModules: [],
    mainGuildId: "guild-1",
    name: "Bot Teste",
    ownerId: "user-1",
    ownerName: "User",
    secretEncrypted: null,
    status: "ready",
    tokenEncrypted: "encrypted",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...input
  };
}

function invoice(input: Partial<MongoBotBillingInvoice> = {}): MongoBotBillingInvoice {
  return {
    _id: "invoice-1",
    amountInCents: 1200,
    billingModel: "monthly",
    botId: "bot-1",
    botName: "Bot Teste",
    chargeType: "monthly_plan",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    currency: "BRL",
    dueDate: new Date("2026-08-01T23:59:59.999Z"),
    dueMonth: "2026-08",
    idempotencyKey: "bot-invoice:bot-1:2026-08",
    notes: null,
    paidAt: null,
    paymentProvider: "asaas",
    pixCode: null,
    pixQrCode: null,
    providerPaymentId: null,
    status: "overdue",
    updatedAt: new Date("2026-08-04T00:00:00.000Z"),
    userId: "user-1",
    ...input
  };
}

test("não permite desligar bot com plano vitalício", () => {
  const decision = evaluateBotBillingShutdown(bot({ billingModel: "lifetime" }), invoice(), null, now);

  assert.equal(decision.allowed, false);
  assert.equal(decision.reasonCode, "lifetime_plan");
});

test("não permite desligar bot com liberação administrativa ativa", () => {
  const decision = evaluateBotBillingShutdown(
    bot({
      billingOverride: {
        createdAt: now,
        createdBy: "admin",
        createdByName: "Admin",
        expiresAt: new Date("2026-08-10T00:00:00.000Z"),
        forceBotActive: true,
        forceDashboardAccess: false,
        reason: "liberação temporária",
        updatedAt: now
      }
    }),
    invoice(),
    null,
    now
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.reasonCode, "administrative_override");
});

test("não permite desligar quando existe pagamento mais recente cobrindo a fatura", () => {
  const decision = evaluateBotBillingShutdown(
    bot(),
    invoice({ dueDate: new Date("2026-08-01T23:59:59.999Z") }),
    invoice({
      _id: "invoice-paid",
      dueDate: new Date("2026-09-01T23:59:59.999Z"),
      dueMonth: "2026-09",
      paidAt: new Date("2026-08-02T12:00:00.000Z"),
      status: "paid"
    }),
    now
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.reasonCode, "covered_by_paid_invoice");
});

test("permite desligar apenas fatura vencida confirmada fora da tolerância", () => {
  const decision = evaluateBotBillingShutdown(bot(), invoice(), null, now);

  assert.equal(decision.allowed, true);
  assert.equal(decision.reasonCode, "confirmed_overdue");
});

test("mantém online durante período de tolerância após vencimento", () => {
  const decision = evaluateBotBillingShutdown(
    bot(),
    invoice({ dueDate: new Date("2026-08-04T08:00:00.000Z") }),
    null,
    now
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.reasonCode, "within_grace_period");
});

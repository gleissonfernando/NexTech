import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { buildMercadoPagoPixOrderBody, mercadoPagoOrderStatusToInternal, mercadoPagoStatusToInternal, validateMercadoPagoWebhookSignature } from "./mercadoPagoService";

test("valida assinatura oficial do webhook Mercado Pago", () => {
  const secret = "test-secret";
  const dataId = "123456789";
  const requestId = "request-1";
  const ts = "1742505638683";
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", secret).update(manifest).digest("hex");

  assert.equal(validateMercadoPagoWebhookSignature({
    dataId,
    requestId,
    secret,
    signature: `ts=${ts},v1=${v1}`
  }), true);
});

test("rejeita assinatura Mercado Pago divergente", () => {
  assert.equal(validateMercadoPagoWebhookSignature({
    dataId: "123",
    requestId: "request-1",
    secret: "test-secret",
    signature: "ts=1742505638683,v1=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }), false);
});

test("mapeia status Mercado Pago para estados internos de pagamento", () => {
  assert.equal(mercadoPagoStatusToInternal("approved"), "approved");
  assert.equal(mercadoPagoStatusToInternal("in_process"), "in_process");
  assert.equal(mercadoPagoStatusToInternal("pending"), "pending");
  assert.equal(mercadoPagoStatusToInternal("in_mediation"), "in_review");
  assert.equal(mercadoPagoStatusToInternal("charged_back"), "chargeback");
  assert.equal(mercadoPagoStatusToInternal("rejected"), "rejected");
});

test("monta payload de order Pix Mercado Pago", () => {
  const body = buildMercadoPagoPixOrderBody({
    amountInCents: 12990,
    currencyId: "BRL",
    description: "Plano Pro",
    externalReference: "order-123",
    itemId: "plan-pro",
    itemTitle: "Plano Pro",
    payerEmail: "cliente@example.com",
    paymentExpiration: new Date("2026-07-12T06:00:00.000Z"),
    statementDescriptor: "NEXTECH"
  });

  assert.equal(body.type, "online");
  assert.equal(body.processing_mode, "automatic");
  assert.equal(body.external_reference, "order-123");
  assert.equal(body.total_amount, "129.90");
  assert.equal(body.currency, undefined);
  assert.equal(body.items, undefined);
  assert.equal(body.payer?.email, "cliente@example.com");
  assert.equal(body.transactions?.payments?.[0]?.amount, "129.90");
  assert.equal(typeof body.transactions?.payments?.[0]?.expiration_time, "string");
  assert.match(body.transactions?.payments?.[0]?.expiration_time ?? "", /^P(?:\d+D)?T(?:\d+H)?(?:\d+M)?(?:\d+S)?$/);
  assert.equal(body.transactions?.payments?.[0]?.payment_method?.id, "pix");
  assert.equal(body.transactions?.payments?.[0]?.payment_method?.type, "bank_transfer");
  assert.equal(body.transactions?.payments?.[0]?.payment_method?.statement_descriptor, undefined);
});

test("mapeia status de order Pix pelo pagamento interno", () => {
  assert.equal(mercadoPagoOrderStatusToInternal({
    id: "ORD-1",
    status: "processed",
    transactions: { payments: [{ status: "approved" }] }
  }), "approved");
  assert.equal(mercadoPagoOrderStatusToInternal({
    id: "ORD-2",
    status: "created",
    transactions: { payments: [{ status: "pending" }] }
  }), "pending");
  assert.equal(mercadoPagoOrderStatusToInternal({
    id: "ORD-3",
    status: "created",
    transactions: { payments: [{ status: "rejected" }] }
  }), "rejected");
});

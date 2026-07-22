import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { buildMercadoPagoPixOrderBody, buildMercadoPagoPixPaymentBody, buildMercadoPagoPreferenceBody, mercadoPagoOrderStatusToInternal, mercadoPagoStatusToInternal, validateMercadoPagoWebhookSignature } from "./mercadoPagoService";

test("válida assinatura oficial do webhook Mercado Pago", () => {
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

test("monta payload de pagamento Pix Mercado Pago", () => {
  const body = buildMercadoPagoPixPaymentBody({
    amountInCents: 12990,
    currencyId: "BRL",
    description: "Plano Pro",
    externalReference: "order-123",
    itemId: "plan-pro",
    itemTitle: "Plano Pro",
    metadata: { source: "test" },
    notificationUrl: "https://example.com/api/payments/mercadopago/webhook",
    payerEmail: "cliente@example.com",
    paymentExpiration: new Date("2026-07-12T06:00:00.000Z"),
    statementDescriptor: "NEXTECH"
  });

  assert.equal(body.external_reference, "order-123");
  assert.equal(body.transaction_amount, 129.9);
  assert.equal(body.payment_method_id, "pix");
  assert.equal(body.payer?.email, "cliente@example.com");
  assert.equal(body.notification_url, "https://example.com/api/payments/mercadopago/webhook");
  assert.equal(body.metadata?.source, "test");
  assert.equal(body.metadata?.protected_amount_cents, 12990);
  assert.equal(body.additional_info?.items?.[0]?.id, "plan-pro");
});

test("monta preference Mercado Pago com Pix e cartão no mesmo checkout", () => {
  const body = buildMercadoPagoPreferenceBody({
    accessToken: "token",
    backUrls: {
      failure: "https://example.com/falha",
      pending: "https://example.com/pendente",
      success: "https://example.com/sucesso"
    },
    binaryMode: false,
    defaultPaymentMethodId: "pix",
    externalReference: "order-123",
    items: [{
      currencyId: "BRL",
      id: "plan-pro",
      title: "Plano Pro",
      unitPriceInCents: 12990
    }],
    maxInstallments: 12,
    notificationUrl: "https://example.com/api/payments/mercadopago/webhook",
    payerEmail: "cliente@example.com"
  });

  assert.equal(body.binary_mode, false);
  assert.equal(body.payment_methods?.default_payment_method_id, "pix");
  assert.equal(body.payment_methods?.excluded_payment_types, undefined);
  assert.equal(body.payment_methods?.installments, 12);
  assert.equal(body.external_reference, "order-123");
});

test("monta preference Pix Mercado Pago com tipos restritos", () => {
  const body = buildMercadoPagoPreferenceBody({
    accessToken: "token",
    backUrls: {
      failure: "https://example.com/falha",
      pending: "https://example.com/pendente",
      success: "https://example.com/sucesso"
    },
    excludedPaymentTypes: ["credit_card", "debit_card", "ticket", "atm"],
    externalReference: "order-123",
    items: [{
      currencyId: "BRL",
      id: "plan-pro",
      title: "Plano Pro",
      unitPriceInCents: 12990
    }],
    maxInstallments: 1,
    notificationUrl: "https://example.com/api/payments/mercadopago/webhook",
    payerEmail: "cliente@example.com"
  });

  assert.equal(body.payment_methods?.default_payment_method_id, undefined);
  assert.deepEqual(body.payment_methods?.excluded_payment_types, [
    { id: "credit_card" },
    { id: "debit_card" },
    { id: "ticket" },
    { id: "atm" }
  ]);
  assert.equal(body.payment_methods?.installments, 1);
  assert.equal(body.external_reference, "order-123");
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

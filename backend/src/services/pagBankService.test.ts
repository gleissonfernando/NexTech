import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPagBankCheckoutBody,
  buildPagBankOrderBody,
  pagBankStatusToInternal,
  validatePagBankWebhookToken
} from "./pagBankService";

test("monta payload de Pix PagBank com QR Code e notification_url", () => {
  const body = buildPagBankOrderBody({
    amountInCents: 12990,
    currencyId: "BRL",
    description: "Plano Pro",
    externalReference: "order-123",
    itemId: "plan-pro",
    itemTitle: "Plano Pro",
    notificationUrl: "https://nextech.discloud.app/api/payments/pagbank/webhook",
    payerEmail: "cliente@example.com",
    paymentExpiration: new Date("2026-07-22T12:00:00.000Z")
  });

  assert.equal(body.reference_id, "order-123");
  assert.equal(body.customer?.email, "cliente@example.com");
  assert.equal(body.items?.[0]?.unit_amount, 12990);
  assert.equal(body.qr_codes?.[0]?.amount?.value, 12990);
  assert.deepEqual(body.qr_codes?.[0]?.arrangements, ["PAGBANK"]);
  assert.deepEqual(body.notification_urls, ["https://nextech.discloud.app/api/payments/pagbank/webhook"]);
});

test("monta checkout PagBank com Pix e cartão habilitados", () => {
  const body = buildPagBankCheckoutBody({
    amountInCents: 2890,
    currencyId: "BRL",
    description: "Plano Basico",
    externalReference: "sale-456",
    itemId: "plan-basic",
    itemTitle: "Plano Basico",
    notificationUrl: "https://nextech.discloud.app/api/payments/pagbank/webhook",
    payerEmail: null,
    returnUrl: "https://nextech.discloud.app/planos",
    successUrl: "https://nextech.discloud.app/pagamento/sucesso"
  });

  assert.equal(body.reference_id, "sale-456");
  assert.deepEqual(body.payment_methods, [{ type: "PIX" }, { type: "CREDIT_CARD" }]);
  assert.deepEqual(body.payment_notification_urls, ["https://nextech.discloud.app/api/payments/pagbank/webhook"]);
  assert.equal(body.redirect_url, "https://nextech.discloud.app/pagamento/sucesso");
  assert.equal(body.return_url, "https://nextech.discloud.app/planos");
});

test("valida token de webhook PagBank quando configurado", () => {
  assert.equal(validatePagBankWebhookToken({ expectedToken: "secret", receivedToken: "secret" }), true);
  assert.equal(validatePagBankWebhookToken({ expectedToken: "secret", receivedToken: "wrong" }), false);
  // Sem token configurado o webhook precisa falhar FECHADO: o corpo dele aprova
  // pedidos e ativa assinaturas, então aceitá-lo sem verificação permitia ativar
  // assinatura paga com um POST forjado.
  assert.equal(validatePagBankWebhookToken({ expectedToken: "", receivedToken: null }), false);
  assert.equal(validatePagBankWebhookToken({ expectedToken: "", receivedToken: "qualquer" }), false);
  // Tamanhos diferentes não podem estourar o timingSafeEqual.
  assert.equal(validatePagBankWebhookToken({ expectedToken: "secret", receivedToken: "s" }), false);
});

test("mapeia status PagBank para estados internos", () => {
  assert.equal(pagBankStatusToInternal("PAID"), "approved");
  assert.equal(pagBankStatusToInternal("WAITING"), "pending");
  assert.equal(pagBankStatusToInternal("IN_ANALYSIS"), "in_process");
  assert.equal(pagBankStatusToInternal("DECLINED"), "rejected");
  assert.equal(pagBankStatusToInternal("REFUNDED"), "refunded");
});

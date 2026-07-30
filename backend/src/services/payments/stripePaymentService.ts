import { requireStripeOperational } from "../../config/payments";
import { createStripeCheckout } from "../stripeService";
import { PAYMENT_GATEWAYS, PAYMENT_METHODS, type GatewayPaymentResult, type PaymentGatewayService, type PaymentOrderInput } from "./types";

export class StripePaymentService implements PaymentGatewayService {
  readonly gateway = PAYMENT_GATEWAYS.STRIPE;

  async createPayment(order: PaymentOrderInput): Promise<GatewayPaymentResult> {
    if (order.method !== PAYMENT_METHODS.CREDIT_CARD && order.method !== PAYMENT_METHODS.DEBIT_CARD) {
      throw Object.assign(new Error("Stripe deve ser usado apenas para pagamentos com cartão."), { statusCode: 400 });
    }
    if (!Number.isInteger(order.amountInCents) || order.amountInCents <= 0) {
      throw Object.assign(new Error("Valor do pagamento Stripe inválido."), { statusCode: 400 });
    }

    const config = requireStripeOperational();
    const checkout = await createStripeCheckout(config, {
      amountInCents: order.amountInCents,
      cancelUrl: order.cancelUrl ?? config.cancelUrl,
      currencyId: order.currency,
      description: order.description,
      externalReference: order.orderId,
      idempotencyKey: order.idempotencyKey,
      itemId: order.itemId,
      itemTitle: order.itemTitle,
      metadata: order.metadata,
      notificationUrl: order.notificationUrl ?? config.webhookUrl,
      payerEmail: order.payer.email,
      paymentExpiration: order.expiresAt ?? null,
      paymentMethodPreference: "card",
      successUrl: order.successUrl ?? config.successUrl
    });

    return {
      checkoutUrl: checkout.checkoutUrl,
      environment: checkout.environment,
      gateway: this.gateway,
      notes: config.automaticTaxEnabled
        ? "Checkout Stripe criado para cartão com invoice e cálculo automatico de impostos."
        : "Checkout Stripe criado para cartão. Redirecione o comprador para o checkout.",
      paymentMethod: order.method === PAYMENT_METHODS.DEBIT_CARD ? "debit_card" : "credit_card",
      paymentType: order.method,
      pixCode: null,
      pixExpiresAt: null,
      provider: "stripe",
      providerOrderId: checkout.preferenceId,
      qrCode: null,
      raw: checkout.raw,
      rawProviderStatus: checkout.rawStatus,
      sandboxCheckoutUrl: checkout.sandboxCheckoutUrl,
      status: checkout.status,
      statusDetail: null,
      statusSource: "stripe_card_checkout_created"
    };
  }
}

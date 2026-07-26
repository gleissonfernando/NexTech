import Stripe from "stripe";
import type { StripeRuntimeConfig } from "../config/payments";
import type { ProviderPayment, ProviderPaymentStatus } from "./paymentProviderService";

export type CreateStripeCheckoutInput = {
  amountInCents: number;
  cancelUrl: string;
  currencyId: "BRL" | "USD" | "EUR";
  description: string;
  externalReference: string;
  idempotencyKey?: string | null;
  itemId: string;
  itemTitle: string;
  metadata?: Record<string, string | number | boolean | null>;
  notificationUrl: string;
  payerEmail?: string | null;
  paymentExpiration?: Date | null;
  successUrl: string;
};

export type StripeCheckoutResult = {
  checkoutUrl: string;
  environment: "test" | "production";
  preferenceId: string;
  raw: Record<string, unknown>;
  rawStatus: string;
  sandboxCheckoutUrl: string | null;
  status: ProviderPaymentStatus;
};

export type StripeWebhookValidationResult = {
  event: Stripe.Event;
  raw: Record<string, unknown>;
};

export function createStripeClient(config: StripeRuntimeConfig) {
  if (!config.serverKey) {
    throw Object.assign(new Error("Chave Stripe não configurada."), { statusCode: 503 });
  }
  return new Stripe(config.serverKey, {
    apiVersion: "2026-06-24.dahlia",
    appInfo: {
      name: "NexTech",
      url: "https://nextech.discloud.app",
      version: "1.0.0"
    },
    maxNetworkRetries: 2
  });
}

export async function createStripeCheckout(config: StripeRuntimeConfig, input: CreateStripeCheckoutInput): Promise<StripeCheckoutResult> {
  const stripe = createStripeClient(config);
  const metadata = sanitizeStripeMetadata({
    ...input.metadata,
    payment_order_id: input.externalReference,
    source: "nextech_plans_checkout"
  });
  const params: Stripe.Checkout.SessionCreateParams = {
    automatic_tax: { enabled: config.automaticTaxEnabled },
    cancel_url: input.cancelUrl,
    client_reference_id: input.externalReference,
    currency: input.currencyId.toLowerCase(),
    expires_at: input.paymentExpiration ? Math.floor(input.paymentExpiration.getTime() / 1000) : undefined,
    integration_identifier: config.integrationIdentifier,
    invoice_creation: {
      enabled: config.invoiceCreationEnabled,
      invoice_data: {
        description: input.description,
        metadata
      }
    },
    line_items: [{
      price_data: {
        currency: input.currencyId.toLowerCase(),
        product_data: {
          description: input.description,
          metadata: sanitizeStripeMetadata({
            plan_id: input.itemId,
            payment_order_id: input.externalReference
          }),
          name: input.itemTitle
        },
        tax_behavior: config.automaticTaxEnabled ? "exclusive" : undefined,
        unit_amount: input.amountInCents
      },
      quantity: 1
    }],
    metadata,
    mode: "payment",
    payment_intent_data: {
      metadata
    },
    success_url: input.successUrl,
    tax_id_collection: config.taxIdCollectionEnabled ? { enabled: true } : undefined
  };

  if (input.payerEmail) {
    params.customer_email = input.payerEmail;
  }

  const requestOptions: Stripe.RequestOptions = {};
  if (input.idempotencyKey) {
    requestOptions.idempotencyKey = input.idempotencyKey;
  }

  const session = await stripe.checkout.sessions.create(params, requestOptions);
  const checkoutUrl = session.url;
  if (!checkoutUrl) {
    throw Object.assign(new Error("Stripe não retornou URL de checkout."), { statusCode: 502 });
  }

  return {
    checkoutUrl,
    environment: session.livemode ? "production" : "test",
    preferenceId: session.id,
    raw: session as unknown as Record<string, unknown>,
    rawStatus: session.status ?? "open",
    sandboxCheckoutUrl: session.livemode ? null : checkoutUrl,
    status: stripeSessionStatusToInternal(session)
  };
}

export async function getStripeCheckoutSession(config: StripeRuntimeConfig, sessionId: string): Promise<ProviderPayment> {
  const stripe = createStripeClient(config);
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent"]
  });
  return stripeSessionToProviderPayment(session);
}

export function validateStripeWebhookSignature(input: {
  config: StripeRuntimeConfig;
  rawBody: Buffer;
  signature: string | null;
}): StripeWebhookValidationResult {
  if (!input.config.webhookSecret) {
    throw Object.assign(new Error("Webhook secret Stripe não configurado."), { statusCode: 503 });
  }

  if (!input.signature) {
    throw Object.assign(new Error("Assinatura Stripe ausente."), { statusCode: 401 });
  }

  const stripe = createStripeClient(input.config);
  const event = stripe.webhooks.constructEvent(input.rawBody, input.signature, input.config.webhookSecret);
  return {
    event,
    raw: event as unknown as Record<string, unknown>
  };
}

export function stripeSessionToProviderPayment(session: Stripe.Checkout.Session): ProviderPayment {
  const paymentIntent = typeof session.payment_intent === "object" && session.payment_intent
    ? session.payment_intent
    : null;
  const paymentMethod = Array.isArray(session.payment_method_types) ? session.payment_method_types[0] ?? null : null;
  const rawStatus = paymentIntent?.status ?? session.payment_status ?? session.status ?? "unknown";

  return {
    amountInCents: session.amount_total ?? paymentIntent?.amount_received ?? paymentIntent?.amount ?? 0,
    currency: (session.currency ?? paymentIntent?.currency ?? null)?.toUpperCase() ?? null,
    externalReference: session.client_reference_id ?? readMetadataValue(session.metadata, "payment_order_id"),
    id: typeof session.payment_intent === "string" ? session.payment_intent : paymentIntent?.id ?? session.id,
    method: paymentMethod,
    paymentType: paymentMethod,
    raw: session as unknown as Record<string, unknown>,
    rawStatus,
    status: stripeSessionStatusToInternal(session),
    statusDetail: session.payment_status ?? session.status ?? null
  };
}

export function stripeSessionStatusToInternal(session: Stripe.Checkout.Session): ProviderPaymentStatus {
  if (session.payment_status === "paid") return "approved";
  if (session.status === "expired") return "expired";
  if (session.status === "complete" && session.payment_status === "unpaid") return "pending";
  if (session.status === "open") return "pending";
  return "pending";
}

export function stripePaymentIntentStatusToInternal(status: string): ProviderPaymentStatus {
  switch (status) {
    case "succeeded":
      return "approved";
    case "processing":
      return "in_process";
    case "canceled":
      return "cancelled";
    case "requires_payment_method":
      return "rejected";
    case "requires_action":
    case "requires_capture":
    case "requires_confirmation":
      return "pending";
    default:
      return "pending";
  }
}

function sanitizeStripeMetadata(metadata: Record<string, string | number | boolean | null | undefined>) {
  return Object.fromEntries(
    Object.entries(metadata)
      .filter((entry): entry is [string, string | number | boolean] => entry[1] !== null && entry[1] !== undefined)
      .map(([key, value]) => [key.slice(0, 40), String(value).slice(0, 500)])
  );
}

function readMetadataValue(metadata: Stripe.Metadata | null, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

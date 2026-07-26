import type { ProviderPaymentStatus } from "../paymentProviderService";

export const PAYMENT_GATEWAYS = {
  ASAAS: "ASAAS",
  STRIPE: "STRIPE"
} as const;

export const PAYMENT_METHODS = {
  CREDIT_CARD: "CREDIT_CARD",
  DEBIT_CARD: "DEBIT_CARD",
  PIX: "PIX"
} as const;

export type PaymentGateway = typeof PAYMENT_GATEWAYS[keyof typeof PAYMENT_GATEWAYS];
export type PaymentMethod = typeof PAYMENT_METHODS[keyof typeof PAYMENT_METHODS];

export type PaymentBuyer = {
  discordId?: string | null;
  email?: string | null;
  name?: string | null;
  userId?: string | null;
};

export type PaymentOrderInput = {
  amountInCents: number;
  cancelUrl?: string | null;
  currency: "BRL" | "USD" | "EUR";
  description: string;
  expiresAt?: Date | null;
  idempotencyKey?: string | null;
  itemId: string;
  itemTitle: string;
  metadata?: Record<string, string | number | boolean | null>;
  method: PaymentMethod;
  notificationUrl?: string | null;
  orderId: string;
  payer: PaymentBuyer;
  successUrl?: string | null;
};

export type GatewayPaymentResult = {
  checkoutUrl: string | null;
  environment: "test" | "production";
  gateway: PaymentGateway;
  notes: string;
  paymentMethod: string | null;
  paymentType: string | null;
  pixCode: string | null;
  provider: "asaas" | "stripe";
  providerOrderId: string | null;
  qrCode: string | null;
  raw: Record<string, unknown>;
  rawProviderStatus: string | null;
  sandboxCheckoutUrl: string | null;
  status: ProviderPaymentStatus;
  statusDetail: string | null;
  statusSource: string;
};

export interface PaymentGatewayService {
  readonly gateway: PaymentGateway;
  createPayment(order: PaymentOrderInput): Promise<GatewayPaymentResult>;
}

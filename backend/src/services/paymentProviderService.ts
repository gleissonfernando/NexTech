import {
  createMercadoPagoPixOrder,
  createMercadoPagoPreference,
  getMercadoPagoOrder,
  getMercadoPagoPayment,
  mercadoPagoOrderStatusToInternal,
  mercadoPagoStatusToInternal,
  validateMercadoPagoWebhookSignature,
  type CreateMercadoPagoPixOrderInput,
  type CreateMercadoPagoPreferenceInput,
  type MercadoPagoPixOrderResult,
  type MercadoPagoPayment,
  type MercadoPagoPreferenceResult
} from "./mercadoPagoService";

export type ProviderPaymentStatus = "pending" | "in_process" | "approved" | "cancelled" | "expired" | "rejected" | "refunded" | "chargeback" | "in_review" | "error";

export type ProviderPayment = {
  amountInCents: number;
  currency: string | null;
  externalReference: string | null;
  id: string;
  method: string | null;
  paymentType: string | null;
  raw: MercadoPagoPayment;
  rawStatus: string;
  status: ProviderPaymentStatus;
  statusDetail: string | null;
};

export type WebhookValidationInput = {
  dataId: string | null;
  requestId: string | null;
  signature: string | null;
};

export type PaymentProvider = {
  createPixOrder(input: Omit<CreateMercadoPagoPixOrderInput, "accessToken">): Promise<MercadoPagoPixOrderResult>;
  createOneTimeCheckout(input: Omit<CreateMercadoPagoPreferenceInput, "accessToken">): Promise<MercadoPagoPreferenceResult>;
  getOrder(orderId: string): Promise<MercadoPagoPixOrderResult>;
  getPayment(paymentId: string): Promise<ProviderPayment>;
  validateWebhook(input: WebhookValidationInput): Promise<boolean>;
};

export class MercadoPagoPaymentProvider implements PaymentProvider {
  constructor(
    private readonly accessToken: string,
    private readonly webhookSecret?: string | null
  ) {}

  createPixOrder(input: Omit<CreateMercadoPagoPixOrderInput, "accessToken">) {
    return createMercadoPagoPixOrder({
      ...input,
      accessToken: this.accessToken
    });
  }

  createOneTimeCheckout(input: Omit<CreateMercadoPagoPreferenceInput, "accessToken">) {
    return createMercadoPagoPreference({
      ...input,
      accessToken: this.accessToken
    });
  }

  async getOrder(orderId: string) {
    const order = await getMercadoPagoOrder(this.accessToken, orderId);
    return {
      ...order,
      status: mercadoPagoOrderStatusToInternal(order)
    };
  }

  async getPayment(paymentId: string): Promise<ProviderPayment> {
    const raw = await getMercadoPagoPayment(this.accessToken, paymentId);
    const providerStatus = readString(raw.status) ?? "unknown";
    const paymentMethodId = readString(raw.payment_method_id);
    const paymentTypeId = readString(raw.payment_type_id);
    return {
      amountInCents: moneyToCents(raw.transaction_amount),
      currency: readString(raw.currency_id),
      externalReference: readString(raw.external_reference),
      id: readString(raw.id) ?? paymentId,
      method: paymentMethodId ?? paymentTypeId,
      paymentType: paymentTypeId,
      raw,
      rawStatus: providerStatus,
      status: mercadoPagoStatusToInternal(providerStatus) as ProviderPaymentStatus,
      statusDetail: readString(raw.status_detail)
    };
  }

  async validateWebhook(input: WebhookValidationInput) {
    if (!this.webhookSecret) return false;
    return validateMercadoPagoWebhookSignature({
      dataId: input.dataId,
      requestId: input.requestId,
      secret: this.webhookSecret,
      signature: input.signature
    });
  }
}

function moneyToCents(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? Math.round(numberValue * 100) : 0;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

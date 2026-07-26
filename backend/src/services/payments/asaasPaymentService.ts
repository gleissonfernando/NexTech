import { timingSafeEqual } from "node:crypto";
import { requireAsaasOperational, type AsaasRuntimeConfig } from "../../config/payments";
import type { ProviderPayment, ProviderPaymentStatus } from "../paymentProviderService";
import { PAYMENT_GATEWAYS, PAYMENT_METHODS, type GatewayPaymentResult, type PaymentGatewayService, type PaymentOrderInput } from "./types";

type AsaasListResponse<T> = {
  data?: T[];
};

type AsaasCustomer = {
  id?: string;
};

export type AsaasPayment = {
  id?: string;
  status?: string;
  value?: number;
  netValue?: number;
  billingType?: string;
  externalReference?: string;
  invoiceUrl?: string;
  bankSlipUrl?: string;
  transactionReceiptUrl?: string;
  dateCreated?: string;
  dueDate?: string;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  confirmedDate?: string | null;
  description?: string | null;
  deleted?: boolean;
};

type AsaasPixQrCode = {
  encodedImage?: string;
  payload?: string;
  expirationDate?: string;
};

export class AsaasPaymentService implements PaymentGatewayService {
  readonly gateway = PAYMENT_GATEWAYS.ASAAS;

  constructor(private readonly providedConfig?: AsaasRuntimeConfig) {}

  private get config() {
    return this.providedConfig ?? requireAsaasOperational();
  }

  async createPayment(order: PaymentOrderInput): Promise<GatewayPaymentResult> {
    if (order.method !== PAYMENT_METHODS.PIX) {
      throw Object.assign(new Error("Asaas deve ser usado apenas para pagamentos via Pix."), { statusCode: 400 });
    }
    validatePixOrder(order);

    const customerId = await this.findOrCreateCustomer(order);
    const payment = await this.request<AsaasPayment>("/payments", {
      method: "POST",
      body: {
        billingType: "PIX",
        callback: order.successUrl ? {
          autoRedirect: true,
          successUrl: order.successUrl
        } : undefined,
        customer: customerId,
        description: order.description.slice(0, 500),
        dueDate: dateOnly(order.expiresAt ?? new Date()),
        externalReference: order.orderId,
        value: centsToMoney(order.amountInCents)
      }
    }, order.idempotencyKey);

    const paymentId = readString(payment.id);
    if (!paymentId) {
      throw Object.assign(new Error("Asaas não retornou ID da cobrança Pix."), { statusCode: 502 });
    }

    const pix = await this.getPixQrCode(paymentId).catch((error: unknown) => {
      console.warn("[payments][asaas] pix qr code unavailable", {
        error: cleanLogString(error instanceof Error ? error.message : String(error)),
        orderId: order.orderId,
        paymentId
      });
      return null;
    });

    return {
      checkoutUrl: readString(payment.invoiceUrl) ?? readString(payment.bankSlipUrl),
      environment: this.config.environment,
      gateway: this.gateway,
      notes: pix?.payload
        ? "Pagamento Pix criado no Asaas. Exiba QR Code ou código copia e cola."
        : "Pagamento Pix criado no Asaas. Redirecione o comprador para a fatura Pix.",
      paymentMethod: "pix",
      paymentType: PAYMENT_METHODS.PIX,
      pixCode: readString(pix?.payload),
      provider: "asaas",
      providerOrderId: paymentId,
      qrCode: normalizeQrCodeImage(pix?.encodedImage),
      raw: {
        payment,
        pix
      },
      rawProviderStatus: readString(payment.status) ?? "PENDING",
      sandboxCheckoutUrl: this.config.environment === "test" ? readString(payment.invoiceUrl) ?? null : null,
      status: asaasStatusToInternal(readString(payment.status) ?? "PENDING"),
      statusDetail: readString(payment.status) ?? null,
      statusSource: "asaas_pix_created"
    };
  }

  async getPayment(paymentId: string): Promise<ProviderPayment> {
    const payment = await this.request<AsaasPayment>(`/payments/${encodeURIComponent(paymentId)}`, { method: "GET" });
    return asaasPaymentToProviderPayment(payment, paymentId);
  }

  private async findOrCreateCustomer(order: PaymentOrderInput) {
    const externalReference = customerExternalReference(order);
    const existing = await this.request<AsaasListResponse<AsaasCustomer>>(
      `/customers?externalReference=${encodeURIComponent(externalReference)}`,
      { method: "GET" }
    ).catch(() => null);
    const existingId = readString(existing?.data?.[0]?.id);
    if (existingId) return existingId;

    const customer = await this.request<AsaasCustomer>("/customers", {
      method: "POST",
      body: {
        email: validEmail(order.payer.email) ? order.payer.email : undefined,
        externalReference,
        name: customerName(order)
      }
    }, `customer:${externalReference}`);
    const customerId = readString(customer.id);
    if (!customerId) {
      throw Object.assign(new Error("Asaas não retornou ID do cliente."), { statusCode: 502 });
    }
    return customerId;
  }

  private getPixQrCode(paymentId: string) {
    return this.request<AsaasPixQrCode>(`/payments/${encodeURIComponent(paymentId)}/pixQrCode`, { method: "GET" });
  }

  private async request<T>(
    path: string,
    options: { method: "GET" | "POST"; body?: Record<string, unknown> },
    idempotencyKey?: string | null
  ): Promise<T> {
    if (!this.config.apiKey) {
      throw Object.assign(new Error("Chave Asaas não configurada."), { statusCode: 503 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;

    try {
      const response = await fetch(url, {
        method: options.method,
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "User-Agent": "NexTech/1.0",
          "access_token": this.config.apiKey,
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
        },
        body: options.body ? JSON.stringify(removeUndefined(options.body)) : undefined,
        signal: controller.signal
      });
      const text = await response.text();
      const data = text ? safeJson(text) : {};

      if (!response.ok) {
        const message = asaasErrorMessage(data) ?? `Asaas respondeu HTTP ${response.status}.`;
        throw Object.assign(new Error(message), { statusCode: response.status >= 500 ? 502 : response.status });
      }

      return data as T;
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") {
        throw Object.assign(new Error("Tempo limite ao chamar Asaas."), { statusCode: 504 });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function asaasPaymentToProviderPayment(payment: AsaasPayment, fallbackId?: string): ProviderPayment {
  const id = readString(payment.id) ?? fallbackId ?? "unknown";
  const status = readString(payment.status) ?? "UNKNOWN";
  return {
    amountInCents: moneyToCents(payment.value ?? payment.netValue ?? 0),
    currency: "BRL",
    externalReference: readString(payment.externalReference),
    id,
    method: "pix",
    paymentType: PAYMENT_METHODS.PIX,
    raw: payment as unknown as Record<string, unknown>,
    rawStatus: status,
    status: asaasStatusToInternal(status),
    statusDetail: status
  };
}

export function validateAsaasWebhookToken(config: AsaasRuntimeConfig, token: string | null) {
  if (!config.webhookToken) return true;
  if (!token) return false;
  const expected = Buffer.from(config.webhookToken);
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function asaasStatusToInternal(status: string): ProviderPaymentStatus {
  switch (status.toUpperCase()) {
    case "RECEIVED":
    case "CONFIRMED":
    case "RECEIVED_IN_CASH":
      return "approved";
    case "PENDING":
      return "pending";
    case "AWAITING_RISK_ANALYSIS":
      return "in_review";
    case "OVERDUE":
      return "expired";
    case "REFUNDED":
      return "refunded";
    case "DELETED":
    case "CANCELED":
    case "CANCELLED":
      return "cancelled";
    case "CHARGEBACK_REQUESTED":
    case "CHARGEBACK_DISPUTE":
    case "AWAITING_CHARGEBACK_REVERSAL":
      return "chargeback";
    default:
      return "pending";
  }
}

function validatePixOrder(order: PaymentOrderInput) {
  if (order.currency !== "BRL") {
    throw Object.assign(new Error("Asaas Pix aceita apenas BRL."), { statusCode: 400 });
  }
  if (!Number.isInteger(order.amountInCents) || order.amountInCents <= 0) {
    throw Object.assign(new Error("Valor do Pix Asaas inválido."), { statusCode: 400 });
  }
}

function customerExternalReference(order: PaymentOrderInput) {
  const stableId = order.payer.discordId ?? order.payer.userId ?? order.payer.email ?? order.orderId;
  return `nextech:${stableId}`;
}

function customerName(order: PaymentOrderInput) {
  return order.payer.name?.trim() || order.payer.email?.split("@")[0]?.trim() || "Cliente NexTech";
}

function validEmail(value?: string | null) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function centsToMoney(cents: number) {
  return Number((cents / 100).toFixed(2));
}

function moneyToCents(value: number) {
  return Math.round(Number(value || 0) * 100);
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeQrCodeImage(value: unknown) {
  const image = readString(value);
  if (!image) return null;
  return image.startsWith("data:") ? image : `data:image/png;base64,${image}`;
}

function removeUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter((entry) => entry[1] !== undefined));
}

function safeJson(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function asaasErrorMessage(data: unknown) {
  const errors = (data as { errors?: Array<{ description?: unknown; message?: unknown }> })?.errors;
  const first = Array.isArray(errors) ? errors[0] : null;
  return readString(first?.description) ?? readString(first?.message) ?? null;
}

function cleanLogString(value: string) {
  return value.replace(/\s+/g, " ").slice(0, 500);
}

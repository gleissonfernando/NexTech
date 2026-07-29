import { createHash, timingSafeEqual } from "node:crypto";
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
  customer?: string;
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

export type AsaasChargeInput = {
  billingType: "PIX" | "CREDIT_CARD";
  creditCard?: Record<string, unknown>;
  creditCardHolderInfo?: Record<string, unknown>;
  customer?: Record<string, unknown> & { id?: string };
  description?: string;
  dueDate?: string;
  externalReference?: string;
  installmentCount?: number;
  installmentValue?: number;
  postalService?: boolean;
  remoteIp?: string | null;
  value: number;
};

export type AsaasSubscriptionInput = {
  billingType: "PIX" | "CREDIT_CARD" | "BOLETO" | "UNDEFINED";
  creditCard?: Record<string, unknown>;
  creditCardHolderInfo?: Record<string, unknown>;
  customer?: Record<string, unknown> & { id?: string };
  cycle: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "BIMONTHLY" | "QUARTERLY" | "SEMIANNUALLY" | "YEARLY";
  description?: string;
  endDate?: string;
  externalReference?: string;
  nextDueDate: string;
  remoteIp?: string | null;
  value: number;
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

  async createCustomer(input: Record<string, unknown>) {
    return this.request<AsaasCustomer>("/customers", {
      method: "POST",
      body: input
    }, readString(input.externalReference) ? `customer:${readString(input.externalReference)}` : undefined);
  }

  async createPixCharge(input: AsaasChargeInput) {
    if (input.billingType !== "PIX") {
      throw Object.assign(new Error("billingType precisa ser PIX."), { statusCode: 400 });
    }
    return this.createCharge(input);
  }

  async createCardCharge(input: AsaasChargeInput) {
    if (input.billingType !== "CREDIT_CARD") {
      throw Object.assign(new Error("billingType precisa ser CREDIT_CARD."), { statusCode: 400 });
    }
    if (!input.creditCard || !input.creditCardHolderInfo) {
      throw Object.assign(new Error("Dados do cartão e do titular são obrigatórios."), { statusCode: 400 });
    }
    return this.createCharge(input);
  }

  async createSubscription(input: AsaasSubscriptionInput) {
    const customerId = await this.resolveCustomer(input.customer);
    return this.request<Record<string, unknown>>("/subscriptions", {
      method: "POST",
      body: {
        billingType: input.billingType,
        creditCard: input.creditCard,
        creditCardHolderInfo: input.creditCardHolderInfo,
        customer: customerId,
        cycle: input.cycle,
        description: input.description,
        endDate: input.endDate,
        externalReference: input.externalReference,
        nextDueDate: input.nextDueDate,
        remoteIp: input.remoteIp ?? undefined,
        value: input.value
      }
    }, input.externalReference ? `subscription:${input.externalReference}` : undefined);
  }

  async cancelSubscription(subscriptionId: string) {
    return this.request<Record<string, unknown>>(`/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: "DELETE" });
  }

  private async findOrCreateCustomer(order: PaymentOrderInput) {
    const externalReference = customerExternalReference(order);
    const cpfCnpj = normalizeCpfCnpj(order.payer.cpfCnpj);
    if (!cpfCnpj) {
      throw Object.assign(new Error("CPF ou CNPJ é obrigatório para gerar Pix Asaas."), { statusCode: 400 });
    }
    const existing = await this.request<AsaasListResponse<AsaasCustomer>>(
      `/customers?externalReference=${encodeURIComponent(externalReference)}`,
      { method: "GET" }
    ).catch(() => null);
    const existingId = readString(existing?.data?.[0]?.id);
    if (existingId) return existingId;

    const customer = await this.request<AsaasCustomer>("/customers", {
      method: "POST",
      body: {
        cpfCnpj,
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

  private async createCharge(input: AsaasChargeInput) {
    const customerId = await this.resolveCustomer(input.customer);
    const payment = await this.request<AsaasPayment>("/payments", {
      method: "POST",
      body: {
        billingType: input.billingType,
        creditCard: input.creditCard,
        creditCardHolderInfo: input.creditCardHolderInfo,
        customer: customerId,
        description: input.description?.slice(0, 500),
        dueDate: input.dueDate ?? dateOnly(new Date()),
        externalReference: input.externalReference,
        installmentCount: input.installmentCount,
        installmentValue: input.installmentValue,
        postalService: input.postalService,
        remoteIp: input.remoteIp ?? undefined,
        value: input.value
      }
    }, input.externalReference ? `payment:${input.externalReference}:${input.billingType}` : undefined);

    const paymentId = readString(payment.id);
    const pix = input.billingType === "PIX" && paymentId
      ? await this.getPixQrCode(paymentId).catch(() => null)
      : null;

    return {
      payment,
      pix: pix ? {
        ...pix,
        encodedImage: normalizeQrCodeImage(pix.encodedImage)
      } : null
    };
  }

  private async resolveCustomer(customer?: (Record<string, unknown> & { id?: string }) | null) {
    const providedId = readString(customer?.id);
    if (providedId) return providedId;
    if (!customer) {
      throw Object.assign(new Error("Cliente Asaas obrigatório."), { statusCode: 400 });
    }
    const created = await this.createCustomer(customer);
    const customerId = readString(created.id);
    if (!customerId) {
      throw Object.assign(new Error("Asaas não retornou ID do cliente."), { statusCode: 502 });
    }
    return customerId;
  }

  private async request<T>(
    path: string,
    options: { method: "DELETE" | "GET" | "POST"; body?: Record<string, unknown> },
    idempotencyKey?: string | null
  ): Promise<T> {
    if (!this.config.apiKey) {
      throw Object.assign(new Error("Chave Asaas não configurada."), { statusCode: 503 });
    }

    const url = `${this.config.baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;

    const asaasIdempotencyKey = normalizeAsaasIdempotencyKey(idempotencyKey);
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const response = await fetch(url, {
          method: options.method,
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "NexTech/1.0",
            "access_token": this.config.apiKey,
            ...(asaasIdempotencyKey ? { "Idempotency-Key": asaasIdempotencyKey } : {})
          },
          body: options.body ? JSON.stringify(removeUndefined(options.body)) : undefined,
          signal: controller.signal
        });
        const text = await response.text();
        const data = text ? safeJson(text) : {};

        if (!response.ok) {
          const message = asaasErrorMessage(data) ?? `Asaas respondeu HTTP ${response.status}.`;
          const error = Object.assign(new Error(message), { retryable: response.status >= 500, statusCode: response.status >= 500 ? 502 : response.status });
          throw error;
        }

        return data as T;
      } catch (error) {
        lastError = error;
        if ((error as { name?: string }).name === "AbortError") {
          lastError = Object.assign(new Error("Tempo limite ao chamar Asaas."), { retryable: true, statusCode: 504 });
        }
        const retryable = Boolean((lastError as { retryable?: boolean }).retryable);
        if (!retryable || attempt === 3) {
          throw lastError;
        }
        await sleep(250 * attempt);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError;
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
    method: readString(payment.billingType)?.toLowerCase() ?? "pix",
    paymentType: readString(payment.billingType) ?? PAYMENT_METHODS.PIX,
    raw: payment as unknown as Record<string, unknown>,
    rawStatus: status,
    status: asaasStatusToInternal(status),
    statusDetail: status
  };
}

export function validateAsaasWebhookToken(config: AsaasRuntimeConfig, token: string | null) {
  if (!config.webhookToken) return false;
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

function normalizeCpfCnpj(value?: string | null) {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length === 11 || digits.length === 14 ? digits : null;
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

function normalizeAsaasIdempotencyKey(value?: string | null) {
  const cleaned = readString(value)?.replace(/[^a-zA-Z0-9:_-]/g, "-");
  if (!cleaned) return null;
  if (cleaned.length <= 48) return cleaned;
  return `nx_${createHash("sha256").update(cleaned).digest("hex").slice(0, 45)}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

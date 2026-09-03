import { timingSafeEqual } from "node:crypto";

export type PagBankRuntimeConfig = {
  baseUrl: string;
  publicKey: string | null;
  timeoutMs: number;
  token: string | null;
  webhookToken: string | null;
  webhookUrl: string | null;
};

export type CreatePagBankPixOrderInput = {
  amountInCents: number;
  currencyId: "BRL" | "USD" | "EUR";
  description: string;
  externalReference: string;
  idempotencyKey?: string | null;
  itemId: string;
  itemTitle: string;
  notificationUrl?: string | null;
  payerEmail?: string | null;
  paymentExpiration?: Date | null;
};

export type CreatePagBankCheckoutInput = CreatePagBankPixOrderInput & {
  returnUrl: string;
  successUrl: string;
};

export type PagBankOrderResult = {
  amountInCents: number;
  currency: string | null;
  externalReference: string | null;
  orderId: string;
  paymentId: string | null;
  paymentMethod: string | null;
  paymentType: string | null;
  pixCode: string | null;
  qrCode: string | null;
  raw: PagBankRecord;
  rawStatus: string;
  status: string;
  statusDetail: string | null;
};

export type PagBankCheckoutResult = {
  checkoutUrl: string;
  preferenceId: string;
  productionCheckoutUrl: string | null;
  sandboxCheckoutUrl: string | null;
};

export type PagBankPayment = {
  amountInCents: number;
  currency: string | null;
  externalReference: string | null;
  id: string;
  method: string | null;
  paymentType: string | null;
  raw: PagBankRecord;
  rawStatus: string;
  status: string;
  statusDetail: string | null;
};

type PagBankRecord = Record<string, unknown>;

const DEFAULT_BASE_URL = "https://sandbox.api.pagseguro.com";

export async function createPagBankPixOrder(config: PagBankRuntimeConfig, input: CreatePagBankPixOrderInput): Promise<PagBankOrderResult> {
  const payload = await pagBankRequest(config, "/orders", {
    body: buildPagBankOrderBody(input),
    idempotencyKey: input.idempotencyKey,
    method: "POST"
  });
  return normalizePagBankOrder(payload);
}

export async function createPagBankCheckout(config: PagBankRuntimeConfig, input: CreatePagBankCheckoutInput): Promise<PagBankCheckoutResult> {
  const payload = await pagBankRequest(config, "/checkouts", {
    body: buildPagBankCheckoutBody(input),
    idempotencyKey: input.idempotencyKey,
    method: "POST"
  });
  const checkoutUrl = readLink(payload, "PAY") ?? readString(payload, "payment_url") ?? readString(payload, "checkout_url");
  const preferenceId = readString(payload, "id") ?? readString(payload, "checkout_id");

  if (!checkoutUrl || !preferenceId) {
    throw pagBankError("PagBank não retornou o link do checkout.", 502);
  }

  return {
    checkoutUrl,
    preferenceId,
    productionCheckoutUrl: checkoutUrl,
    sandboxCheckoutUrl: checkoutUrl
  };
}

export async function getPagBankOrder(config: PagBankRuntimeConfig, orderId: string): Promise<PagBankOrderResult> {
  const payload = await pagBankRequest(config, `/orders/${encodeURIComponent(orderId)}`, { method: "GET" });
  return normalizePagBankOrder(payload);
}

export async function getPagBankPayment(config: PagBankRuntimeConfig, paymentId: string): Promise<PagBankPayment> {
  const payload = await pagBankRequest(config, `/charges/${encodeURIComponent(paymentId)}`, { method: "GET" });
  return normalizePagBankPayment(payload, paymentId);
}

export function validatePagBankWebhookToken(input: { expectedToken?: string | null; receivedToken?: string | null }) {
  const expected = input.expectedToken?.trim();

  // Falha FECHADO, igual a validateAsaasWebhookToken. O corpo deste webhook
  // aprova pedidos e ativa assinaturas: aceitá-lo sem token configurado deixava
  // qualquer um ativar assinatura paga enviando {"charges":[{"status":"PAID"}]}.
  if (!expected) {
    console.warn("[pagbank] webhook recusado: PAGBANK_WEBHOOK_TOKEN não configurado.");
    return false;
  }

  const received = input.receivedToken?.trim();
  if (!received) return false;

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function pagBankStatusToInternal(status: string) {
  switch (status.toUpperCase()) {
    case "PAID":
      return "approved";
    case "AUTHORIZED":
    case "IN_ANALYSIS":
      return "in_process";
    case "WAITING":
    case "PENDING":
      return "pending";
    case "CANCELED":
    case "CANCELLED":
      return "cancelled";
    case "DECLINED":
      return "rejected";
    case "REFUNDED":
      return "refunded";
    case "CHARGEBACK":
      return "chargeback";
    default:
      return "pending";
  }
}

export function buildPagBankOrderBody(input: CreatePagBankPixOrderInput) {
  return removeUndefined({
    reference_id: trim(input.externalReference, 64),
    customer: buildCustomer(input),
    items: [{
      reference_id: trim(input.itemId, 64),
      name: trim(input.itemTitle, 100),
      quantity: 1,
      unit_amount: normalizeCents(input.amountInCents)
    }],
    qr_codes: [removeUndefined({
      amount: {
        value: normalizeCents(input.amountInCents)
      },
      arrangements: ["PAGBANK"],
      expiration_date: input.paymentExpiration?.toISOString()
    })],
    notification_urls: input.notificationUrl ? [input.notificationUrl] : undefined
  });
}

export function buildPagBankCheckoutBody(input: CreatePagBankCheckoutInput) {
  return removeUndefined({
    reference_id: trim(input.externalReference, 64),
    customer: buildCustomer(input),
    customer_modifiable: true,
    expiration_date: input.paymentExpiration?.toISOString(),
    items: [{
      reference_id: trim(input.itemId, 64),
      name: trim(input.itemTitle, 100),
      quantity: 1,
      unit_amount: normalizeCents(input.amountInCents)
    }],
    payment_methods: [
      { type: "PIX" },
      { type: "CREDIT_CARD" }
    ],
    payment_notification_urls: input.notificationUrl ? [input.notificationUrl] : undefined,
    redirect_url: input.successUrl,
    return_url: input.returnUrl
  });
}

function buildCustomer(input: Pick<CreatePagBankPixOrderInput, "externalReference" | "payerEmail">) {
  return {
    email: safeEmail(input.payerEmail, input.externalReference),
    name: "Cliente NexTech"
  };
}

async function pagBankRequest(config: PagBankRuntimeConfig, path: string, input: { body?: unknown; idempotencyKey?: string | null; method: "GET" | "POST" }) {
  const token = config.token?.trim();
  if (!token) throw pagBankError("Token PagBank não configurado.", 503);

  const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs || 30000);
  const startedAt = Date.now();

  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      };
      if (input.idempotencyKey) {
        headers["x-idempotency-key"] = input.idempotencyKey;
      }

      const response = await fetch(`${baseUrl}${path}`, {
        body: input.body ? JSON.stringify(input.body) : undefined,
        headers,
        method: input.method,
        signal: controller.signal
      }).catch((error) => {
        if (attempt >= 2) throw error;
        return null;
      });

      if (!response) continue;
      const text = await response.text();
      const payload = text ? JSON.parse(text) as PagBankRecord : {};

      console.log("[pagbank] api_response", {
        attempt,
        method: input.method,
        path,
        status: response.status,
        tookMs: Date.now() - startedAt
      });

      if (response.ok) return payload;
      if (attempt < 2 && response.status >= 500) continue;
      throw pagBankError(readPagBankError(payload) ?? `PagBank respondeu ${response.status}.`, response.status || 502);
    }
  } finally {
    clearTimeout(timeout);
  }

  throw pagBankError("PagBank indisponível no momento.", 503);
}

function normalizePagBankOrder(raw: PagBankRecord): PagBankOrderResult {
  const qrCode = firstQrCode(raw);
  const charge = firstCharge(raw);
  const rawStatus = readString(charge, "status") ?? readString(raw, "status") ?? "PENDING";
  const amountInCents = readNestedNumber(qrCode, ["amount", "value"]) ?? readNestedNumber(charge, ["amount", "value"]) ?? readItemsTotal(raw);
  const orderId = readString(raw, "id") ?? "";

  if (!orderId) {
    throw pagBankError("PagBank não retornou o ID do pedido.", 502);
  }

  return {
    amountInCents,
    currency: "BRL",
    externalReference: readString(raw, "reference_id"),
    orderId,
    paymentId: readString(charge, "id") ?? readString(qrCode, "id"),
    paymentMethod: qrCode ? "pix" : readNestedString(charge, ["payment_method", "type"]),
    paymentType: qrCode ? "pix" : readNestedString(charge, ["payment_method", "type"]),
    pixCode: readString(qrCode, "text"),
    qrCode: readQrCodeImage(qrCode),
    raw,
    rawStatus,
    status: pagBankStatusToInternal(rawStatus),
    statusDetail: readString(charge, "status_detail")
  };
}

function normalizePagBankPayment(raw: PagBankRecord, paymentId: string): PagBankPayment {
  const rawStatus = readString(raw, "status") ?? "PENDING";
  return {
    amountInCents: readNestedNumber(raw, ["amount", "value"]) ?? 0,
    currency: "BRL",
    externalReference: readString(raw, "reference_id"),
    id: readString(raw, "id") ?? paymentId,
    method: readNestedString(raw, ["payment_method", "type"]),
    paymentType: readNestedString(raw, ["payment_method", "type"]),
    raw,
    rawStatus,
    status: pagBankStatusToInternal(rawStatus),
    statusDetail: readString(raw, "status_detail")
  };
}

function firstQrCode(raw: PagBankRecord) {
  const qrCodes = Array.isArray(raw.qr_codes) ? raw.qr_codes : Array.isArray(raw.qr_code) ? raw.qr_code : [];
  const first = qrCodes[0];
  return first && typeof first === "object" ? first as PagBankRecord : null;
}

function firstCharge(raw: PagBankRecord) {
  const charges = Array.isArray(raw.charges) ? raw.charges : [];
  const first = charges[0];
  return first && typeof first === "object" ? first as PagBankRecord : null;
}

function readQrCodeImage(qrCode: PagBankRecord | null) {
  if (!qrCode) return null;
  const links = Array.isArray(qrCode.links) ? qrCode.links : [];
  const base64 = links.find((link) => isLinkRel(link, "QRCODE.BASE64"));
  const png = links.find((link) => isLinkRel(link, "QRCODE.PNG"));
  return readString(base64, "href") ?? readString(png, "href");
}

function readLink(raw: PagBankRecord, rel: string) {
  const links = Array.isArray(raw.links) ? raw.links : [];
  const link = links.find((item) => isLinkRel(item, rel));
  return readString(link, "href");
}

function isLinkRel(value: unknown, rel: string) {
  return Boolean(value && typeof value === "object" && readString(value as PagBankRecord, "rel")?.toUpperCase() === rel);
}

function readItemsTotal(raw: PagBankRecord) {
  const items = Array.isArray(raw.items) ? raw.items : [];
  return items.reduce((total, item) => total + (readNumber(item, "unit_amount") ?? 0) * (readNumber(item, "quantity") ?? 1), 0);
}

function readPagBankError(payload: PagBankRecord) {
  const message = readString(payload, "message") ?? readString(payload, "error");
  const errors = Array.isArray(payload.error_messages) ? payload.error_messages : Array.isArray(payload.errors) ? payload.errors : [];
  const first = errors[0];
  const detail = first && typeof first === "object" ? readString(first as PagBankRecord, "description") ?? readString(first as PagBankRecord, "message") : null;
  return detail ?? message;
}

function safeEmail(email: string | null | undefined, fallback: string) {
  const normalized = email?.trim();
  if (normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return normalized.slice(0, 120);
  return `checkout-${fallback.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80)}@nextech.discloud.app`;
}

function readString(payload: unknown, key: string) {
  const value = payload && typeof payload === "object" ? (payload as PagBankRecord)[key] : null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(payload: unknown, key: string) {
  const value = payload && typeof payload === "object" ? (payload as PagBankRecord)[key] : null;
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function readNestedString(payload: unknown, path: string[]) {
  let current = payload;
  for (const key of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as PagBankRecord)[key];
  }
  return typeof current === "string" && current.trim() ? current.trim() : null;
}

function readNestedNumber(payload: unknown, path: string[]) {
  let current = payload;
  for (const key of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as PagBankRecord)[key];
  }
  const numberValue = typeof current === "number" ? current : Number(current);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeCents(value: number) {
  if (!Number.isFinite(value) || value <= 0) throw pagBankError("Valor PagBank inválido.", 400);
  return Math.round(value);
}

function trim(value: string, maxLength: number) {
  const normalized = value.trim();
  if (!normalized) throw pagBankError("Campo obrigatório PagBank vazio.", 400);
  return normalized.slice(0, maxLength);
}

function removeUndefined<T extends Record<string, unknown>>(value: T) {
  return JSON.parse(JSON.stringify(value)) as T;
}

function pagBankError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

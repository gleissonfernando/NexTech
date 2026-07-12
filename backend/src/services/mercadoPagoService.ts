import { createHmac, timingSafeEqual } from "node:crypto";

export type MercadoPagoBackUrls = {
  failure: string;
  pending: string;
  success: string;
};

export type MercadoPagoPreferenceItemInput = {
  currencyId: "BRL" | "USD" | "EUR";
  description?: string | null;
  id: string;
  quantity?: number;
  title: string;
  unitPriceInCents: number;
};

export type CreateMercadoPagoPreferenceInput = {
  accessToken: string;
  autoReturn?: "approved" | "all";
  backUrls: MercadoPagoBackUrls;
  externalReference: string;
  idempotencyKey?: string | null;
  items: MercadoPagoPreferenceItemInput[];
  notificationUrl?: string | null;
  payerEmail?: string | null;
};

export type MercadoPagoPreferenceResult = {
  checkoutUrl: string;
  preferenceId: string;
};

export async function createMercadoPagoPreference(input: CreateMercadoPagoPreferenceInput): Promise<MercadoPagoPreferenceResult> {
  const body = buildProtectedPreferenceBody(input);
  const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
      ...(input.idempotencyKey ? { "X-Idempotency-Key": input.idempotencyKey } : {})
    },
    method: "POST"
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;

  if (!response.ok) {
    throw mercadoPagoError(readMercadoPagoError(payload) ?? "Mercado Pago recusou a criacao da preferencia.", 502);
  }

  const checkoutUrl = readStringField(payload, "init_point") ?? readStringField(payload, "sandbox_init_point");
  const preferenceId = readStringField(payload, "id");

  if (!checkoutUrl || !preferenceId) {
    throw mercadoPagoError("Mercado Pago nao retornou a preferencia de checkout.", 502);
  }

  return {
    checkoutUrl,
    preferenceId
  };
}

export type MercadoPagoPayment = Record<string, unknown>;

export async function getMercadoPagoPayment(accessToken: string, paymentId: string): Promise<MercadoPagoPayment> {
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    method: "GET"
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;

  if (!response.ok || !payload) {
    throw mercadoPagoError(readMercadoPagoError(payload) ?? "Nao foi possivel consultar o pagamento no Mercado Pago.", 502);
  }

  return payload;
}

export function validateMercadoPagoWebhookSignature(input: {
  dataId?: string | null;
  requestId?: string | null;
  secret: string;
  signature?: string | null;
}) {
  const parts = parseSignature(input.signature);
  const ts = parts.get("ts");
  const v1 = parts.get("v1");

  if (!ts || !v1) return false;

  const manifest = [
    input.dataId ? `id:${input.dataId};` : "",
    input.requestId ? `request-id:${input.requestId};` : "",
    `ts:${ts};`
  ].join("");
  const expected = createHmac("sha256", input.secret).update(manifest).digest("hex");

  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(v1, "hex"));
  } catch {
    return false;
  }
}

function parseSignature(signature?: string | null) {
  const parts = new Map<string, string>();
  for (const part of (signature ?? "").split(",")) {
    const [key, ...valueParts] = part.trim().split("=");
    const value = valueParts.join("=").trim();
    if (key && value) parts.set(key.trim(), value);
  }
  return parts;
}

function buildProtectedPreferenceBody(input: CreateMercadoPagoPreferenceInput) {
  const items = input.items.map((item) => {
    const unitPriceInCents = normalizeCents(item.unitPriceInCents);
    const quantity = normalizeQuantity(item.quantity ?? 1);

    return {
      currency_id: item.currencyId,
      description: trimOptional(item.description),
      id: item.id,
      quantity,
      title: trimRequired(item.title, "Titulo do item Mercado Pago"),
      unit_price: centsToMoney(unitPriceInCents)
    };
  });

  if (!items.length) {
    throw mercadoPagoError("Preferencia Mercado Pago precisa ter ao menos um item.", 400);
  }

  return removeUndefined({
    auto_return: input.autoReturn ?? "approved",
    back_urls: input.backUrls,
    external_reference: trimRequired(input.externalReference, "Referencia externa Mercado Pago"),
    items,
    metadata: {
      protected_amount_cents: items.reduce((sum, item) => sum + Math.round(Number(item.unit_price) * 100) * item.quantity, 0),
      protected_by: "nextech_backend"
    },
    notification_url: trimOptional(input.notificationUrl),
    payer: input.payerEmail ? { email: input.payerEmail } : undefined
  });
}

function normalizeCents(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    throw mercadoPagoError("Valor do checkout Mercado Pago invalido.", 400);
  }

  return Math.round(value);
}

function normalizeQuantity(value: number) {
  if (!Number.isFinite(value) || value < 1) {
    throw mercadoPagoError("Quantidade do checkout Mercado Pago invalida.", 400);
  }

  return Math.floor(value);
}

function centsToMoney(cents: number) {
  return Math.max(0, Math.round(cents)) / 100;
}

function trimRequired(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) throw mercadoPagoError(`${label} vazio.`, 400);
  return trimmed.slice(0, 255);
}

function trimOptional(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 255) : undefined;
}

function removeUndefined<T extends Record<string, unknown>>(value: T) {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readMercadoPagoError(payload: Record<string, unknown> | null) {
  return readStringField(payload, "message") ?? readStringField(payload, "error");
}

function readStringField(payload: Record<string, unknown> | null, key: string) {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mercadoPagoError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

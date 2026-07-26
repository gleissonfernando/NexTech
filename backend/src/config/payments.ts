import { createHash } from "node:crypto";
import { env } from "./env";

export type MercadoPagoEnvironment = "test" | "production";

export type MercadoPagoRuntimeConfig = {
  accessToken: string | null;
  binaryMode: boolean;
  checkoutExpirationMinutes: number;
  credentialsConfigured: boolean;
  currency: "BRL" | "USD" | "EUR";
  enabled: boolean;
  environment: MercadoPagoEnvironment;
  errors: string[];
  failureUrl: string;
  maxInstallments: number | null;
  publicKey: string | null;
  publicKeyFingerprint: string | null;
  status: "disabled" | "misconfigured" | "operational";
  statementDescriptor: string | null;
  webhookConfigured: boolean;
  webhookSecret: string | null;
  webhookUrl: string;
};

export type PagBankRuntimeConfig = {
  baseUrl: string;
  credentialsConfigured: boolean;
  enabled: boolean;
  errors: string[];
  environment: "sandbox" | "production";
  publicKey: string | null;
  publicKeyFingerprint: string | null;
  status: "disabled" | "misconfigured" | "operational";
  timeoutMs: number;
  token: string | null;
  webhookConfigured: boolean;
  webhookToken: string | null;
  webhookUrl: string;
};

export type StripeRuntimeConfig = {
  automaticTaxEnabled: boolean;
  checkoutExpirationMinutes: number;
  credentialsConfigured: boolean;
  currency: "BRL" | "USD" | "EUR";
  enabled: boolean;
  environment: "test" | "production";
  errors: string[];
  invoiceCreationEnabled: boolean;
  publishableKey: string | null;
  publishableKeyFingerprint: string | null;
  restrictedKey: string | null;
  secretKey: string | null;
  serverKey: string | null;
  serverKeyFingerprint: string | null;
  status: "disabled" | "misconfigured" | "operational";
  statementDescriptor: string | null;
  successUrl: string;
  cancelUrl: string;
  taxConfigured: boolean;
  taxIdCollectionEnabled: boolean;
  webhookConfigured: boolean;
  webhookSecret: string | null;
  webhookUrl: string;
  integrationIdentifier: string;
};

export type AsaasRuntimeConfig = {
  apiKey: string | null;
  apiKeyFingerprint: string | null;
  baseUrl: string;
  checkoutExpirationMinutes: number;
  credentialsConfigured: boolean;
  enabled: boolean;
  environment: "test" | "production";
  errors: string[];
  status: "disabled" | "misconfigured" | "operational";
  timeoutMs: number;
  webhookConfigured: boolean;
  webhookToken: string | null;
  webhookUrl: string;
};

export function getMercadoPagoRuntimeConfig(): MercadoPagoRuntimeConfig {
  const environment = env.MERCADOPAGO_ENV;
  const accessToken = clean(environment === "test" ? env.MERCADOPAGO_TEST_ACCESS_TOKEN : env.MERCADOPAGO_PROD_ACCESS_TOKEN);
  const publicKey = clean(environment === "test" ? env.MERCADOPAGO_TEST_PUBLIC_KEY : env.MERCADOPAGO_PROD_PUBLIC_KEY);
  const webhookSecret = clean(environment === "test" ? env.MERCADOPAGO_TEST_WEBHOOK_SECRET : env.MERCADOPAGO_PROD_WEBHOOK_SECRET);
  const errors: string[] = [];

  if (!accessToken) errors.push(`MERCADOPAGO_${environment === "test" ? "TEST" : "PROD"}_ACCESS_TOKEN ausente.`);
  if (!publicKey) errors.push(`MERCADOPAGO_${environment === "test" ? "TEST" : "PROD"}_PUBLIC_KEY ausente.`);
  if (!webhookSecret) errors.push(`MERCADOPAGO_${environment === "test" ? "TEST" : "PROD"}_WEBHOOK_SECRET ausente.`);
  if (environment === "production" && !env.PAYMENTS_ALLOW_LIVE_CHARGES) {
    errors.push("PAYMENTS_ALLOW_LIVE_CHARGES precisa estar true para criar cobrancas em produção.");
  }

  const enabled = env.MERCADOPAGO_ENABLED;
  const credentialsConfigured = Boolean(accessToken && publicKey);
  const webhookConfigured = Boolean(webhookSecret);

  return {
    accessToken,
    binaryMode: env.MERCADOPAGO_BINARY_MODE,
    checkoutExpirationMinutes: env.MERCADOPAGO_CHECKOUT_EXPIRATION_MINUTES,
    credentialsConfigured,
    currency: env.MERCADOPAGO_CURRENCY,
    enabled,
    environment,
    errors,
    failureUrl: env.MERCADOPAGO_FAILURE_URL,
    maxInstallments: env.MERCADOPAGO_MAX_INSTALLMENTS ?? null,
    publicKey,
    publicKeyFingerprint: publicKey ? fingerprint(publicKey) : null,
    status: !enabled ? "disabled" : errors.length ? "misconfigured" : "operational",
    statementDescriptor: clean(env.MERCADOPAGO_STATEMENT_DESCRIPTOR),
    webhookConfigured,
    webhookSecret,
    webhookUrl: env.MERCADOPAGO_WEBHOOK_URL
  };
}

export function getMercadoPagoHealth() {
  const config = getMercadoPagoRuntimeConfig();
  return {
    provider: "mercadopago" as const,
    enabled: config.enabled,
    environment: config.environment,
    credentialsConfigured: config.credentialsConfigured,
    webhookConfigured: config.webhookConfigured,
    status: config.status
  };
}

export function getPagBankRuntimeConfig(): PagBankRuntimeConfig {
  const token = clean(env.PAGBANK_TOKEN);
  const publicKey = clean(env.PAGBANK_PUBLIC_KEY);
  const webhookToken = clean(env.PAGBANK_WEBHOOK_TOKEN);
  const baseUrl = env.PAGBANK_BASE_URL || "https://sandbox.api.pagseguro.com";
  const environment = /sandbox/i.test(baseUrl) ? "sandbox" : "production";
  const errors: string[] = [];

  if (!token) errors.push("PAGBANK_TOKEN ausente.");
  if (environment === "production" && !env.PAYMENTS_ALLOW_LIVE_CHARGES) {
    errors.push("PAYMENTS_ALLOW_LIVE_CHARGES precisa estar true para criar cobrancas PagBank em produção.");
  }

  const enabled = env.PAYMENTS_ENABLED;
  const credentialsConfigured = Boolean(token);
  const webhookConfigured = Boolean(webhookToken || env.PAGBANK_WEBHOOK_URL);

  return {
    baseUrl,
    credentialsConfigured,
    enabled,
    environment,
    errors,
    publicKey,
    publicKeyFingerprint: publicKey ? fingerprint(publicKey) : null,
    status: !enabled ? "disabled" : errors.length ? "misconfigured" : "operational",
    timeoutMs: env.PAGBANK_TIMEOUT,
    token,
    webhookConfigured,
    webhookToken,
    webhookUrl: env.PAGBANK_WEBHOOK_URL
  };
}

export function getPagBankHealth() {
  const config = getPagBankRuntimeConfig();
  return {
    provider: "pagbank" as const,
    enabled: config.enabled,
    environment: config.environment,
    credentialsConfigured: config.credentialsConfigured,
    webhookConfigured: config.webhookConfigured,
    status: config.status
  };
}

export function getStripeRuntimeConfig(): StripeRuntimeConfig {
  const restrictedKey = clean(env.STRIPE_RESTRICTED_KEY);
  const secretKey = clean(env.STRIPE_SECRET_KEY);
  const publishableKey = clean(env.STRIPE_PUBLISHABLE_KEY);
  const webhookSecret = clean(env.STRIPE_WEBHOOK_SECRET);
  const serverKey = restrictedKey ?? secretKey;
  const environment = serverKey?.startsWith("rk_live_") || serverKey?.startsWith("sk_live_") ? "production" : "test";
  const errors: string[] = [];

  if (!serverKey) errors.push("STRIPE_RESTRICTED_KEY ou STRIPE_SECRET_KEY ausente.");
  if (!publishableKey) errors.push("STRIPE_PUBLISHABLE_KEY ausente.");
  if (!webhookSecret) errors.push("STRIPE_WEBHOOK_SECRET ausente.");
  if (env.STRIPE_TAX_ENABLED && !env.STRIPE_TAX_REGISTRATION_ACTIVE) {
    errors.push("STRIPE_TAX_ENABLED exige STRIPE_TAX_REGISTRATION_ACTIVE=true após confirmar a inscrição fiscal ativa na Stripe.");
  }
  if (environment === "production" && !env.PAYMENTS_ALLOW_LIVE_CHARGES) {
    errors.push("PAYMENTS_ALLOW_LIVE_CHARGES precisa estar true para criar cobrancas Stripe live.");
  }

  const enabled = env.PAYMENTS_ENABLED;
  const credentialsConfigured = Boolean(serverKey && publishableKey);
  const webhookConfigured = Boolean(webhookSecret);

  return {
    automaticTaxEnabled: env.STRIPE_TAX_ENABLED && env.STRIPE_TAX_REGISTRATION_ACTIVE,
    checkoutExpirationMinutes: env.STRIPE_CHECKOUT_EXPIRATION_MINUTES,
    credentialsConfigured,
    currency: env.STRIPE_CURRENCY,
    enabled,
    environment,
    errors,
    invoiceCreationEnabled: env.STRIPE_INVOICE_CREATION_ENABLED,
    publishableKey,
    publishableKeyFingerprint: publishableKey ? fingerprint(publishableKey) : null,
    restrictedKey,
    secretKey,
    serverKey,
    serverKeyFingerprint: serverKey ? fingerprint(serverKey) : null,
    status: !enabled ? "disabled" : errors.length ? "misconfigured" : "operational",
    statementDescriptor: clean(env.STRIPE_STATEMENT_DESCRIPTOR),
    successUrl: env.STRIPE_SUCCESS_URL,
    cancelUrl: env.STRIPE_CANCEL_URL,
    taxConfigured: !env.STRIPE_TAX_ENABLED || env.STRIPE_TAX_REGISTRATION_ACTIVE,
    taxIdCollectionEnabled: env.STRIPE_TAX_ID_COLLECTION_ENABLED,
    webhookConfigured,
    webhookSecret,
    webhookUrl: env.STRIPE_WEBHOOK_URL,
    integrationIdentifier: env.STRIPE_INTEGRATION_IDENTIFIER
  };
}

export function getStripeHealth() {
  const config = getStripeRuntimeConfig();
  return {
    provider: "stripe" as const,
    enabled: config.enabled,
    environment: config.environment,
    credentialsConfigured: config.credentialsConfigured,
    webhookConfigured: config.webhookConfigured,
    taxConfigured: config.taxConfigured,
    status: config.status
  };
}

export function getAsaasRuntimeConfig(): AsaasRuntimeConfig {
  const apiKey = clean(env.ASAAS_API_KEY);
  const webhookToken = clean(env.ASAAS_WEBHOOK_TOKEN);
  const baseUrl = env.ASAAS_BASE_URL || "https://api-sandbox.asaas.com/v3";
  const environment = /sandbox/i.test(baseUrl) ? "test" : "production";
  const errors: string[] = [];

  if (!apiKey) errors.push("ASAAS_API_KEY ausente.");
  if (environment === "production" && !env.PAYMENTS_ALLOW_LIVE_CHARGES) {
    errors.push("PAYMENTS_ALLOW_LIVE_CHARGES precisa estar true para criar cobrancas Asaas em produção.");
  }

  const enabled = env.PAYMENTS_ENABLED;
  const credentialsConfigured = Boolean(apiKey);
  const webhookConfigured = Boolean(webhookToken || env.ASAAS_WEBHOOK_URL);

  return {
    apiKey,
    apiKeyFingerprint: apiKey ? fingerprint(apiKey) : null,
    baseUrl,
    checkoutExpirationMinutes: env.ASAAS_CHECKOUT_EXPIRATION_MINUTES,
    credentialsConfigured,
    enabled,
    environment,
    errors,
    status: !enabled ? "disabled" : errors.length ? "misconfigured" : "operational",
    timeoutMs: env.ASAAS_TIMEOUT,
    webhookConfigured,
    webhookToken,
    webhookUrl: env.ASAAS_WEBHOOK_URL
  };
}

export function getAsaasHealth() {
  const config = getAsaasRuntimeConfig();
  return {
    provider: "asaas" as const,
    enabled: config.enabled,
    environment: config.environment,
    credentialsConfigured: config.credentialsConfigured,
    webhookConfigured: config.webhookConfigured,
    status: config.status
  };
}

export function getPaymentGatewayHealth() {
  return {
    activeProvider: env.PAYMENT_PROVIDER,
    routing: {
      card: "stripe" as const,
      pix: "asaas" as const
    },
    asaas: getAsaasHealth(),
    mercadoPago: getMercadoPagoHealth(),
    pagBank: getPagBankHealth(),
    stripe: getStripeHealth()
  };
}

export function requirePagBankOperational(options: { allowDisabled?: boolean; requireWebhook?: boolean } = {}) {
  const config = getPagBankRuntimeConfig();

  if (!options.allowDisabled && !config.enabled) {
    throw paymentConfigError("PagBank está desativado no servidor.", 503);
  }

  if (!config.token || !config.credentialsConfigured || (options.requireWebhook && !config.webhookConfigured)) {
    throw paymentConfigError("PagBank indisponível por credenciais ausentes ou inválidas.", 503);
  }

  if (!options.allowDisabled && config.environment === "production" && !env.PAYMENTS_ALLOW_LIVE_CHARGES) {
    throw paymentConfigError("Cobrancas PagBank de produção bloqueadas por PAYMENTS_ALLOW_LIVE_CHARGES.", 503);
  }

  return config;
}

export function requireMercadoPagoOperational(options: { allowDisabled?: boolean; requireWebhook?: boolean } = {}) {
  const config = getMercadoPagoRuntimeConfig();

  if (!options.allowDisabled && !config.enabled) {
    throw paymentConfigError("Mercado Pago está desativado no servidor.", 503);
  }

  if (!config.accessToken || !config.credentialsConfigured || (options.requireWebhook && !config.webhookConfigured)) {
    throw paymentConfigError("Mercado Pago indisponível por credenciais ausentes ou inválidas.", 503);
  }

  if (!options.allowDisabled && config.environment === "production" && !env.PAYMENTS_ALLOW_LIVE_CHARGES) {
    throw paymentConfigError("Cobrancas de produção bloqueadas por PAYMENTS_ALLOW_LIVE_CHARGES.", 503);
  }

  return config;
}

export function requireStripeOperational(options: { allowDisabled?: boolean; requireWebhook?: boolean } = {}) {
  const config = getStripeRuntimeConfig();

  if (!options.allowDisabled && !config.enabled) {
    throw paymentConfigError("Stripe está desativado no servidor.", 503);
  }

  if (!config.serverKey || !config.credentialsConfigured || (options.requireWebhook && !config.webhookConfigured)) {
    throw paymentConfigError("Stripe indisponível por credenciais ausentes ou inválidas.", 503);
  }

  if (env.STRIPE_TAX_ENABLED && !env.STRIPE_TAX_REGISTRATION_ACTIVE) {
    throw paymentConfigError("Stripe Tax bloqueado: confirme STRIPE_TAX_REGISTRATION_ACTIVE=true somente após ativar a inscrição fiscal na Stripe.", 503);
  }

  if (!options.allowDisabled && config.environment === "production" && !env.PAYMENTS_ALLOW_LIVE_CHARGES) {
    throw paymentConfigError("Cobrancas Stripe live bloqueadas por PAYMENTS_ALLOW_LIVE_CHARGES.", 503);
  }

  return config;
}

export function requireAsaasOperational(options: { allowDisabled?: boolean; requireWebhook?: boolean } = {}) {
  const config = getAsaasRuntimeConfig();

  if (!options.allowDisabled && !config.enabled) {
    throw paymentConfigError("Asaas está desativado no servidor.", 503);
  }

  if (!config.apiKey || !config.credentialsConfigured || (options.requireWebhook && !config.webhookConfigured)) {
    throw paymentConfigError("Asaas indisponível por credenciais ausentes ou inválidas.", 503);
  }

  if (!options.allowDisabled && config.environment === "production" && !env.PAYMENTS_ALLOW_LIVE_CHARGES) {
    throw paymentConfigError("Cobrancas Asaas de produção bloqueadas por PAYMENTS_ALLOW_LIVE_CHARGES.", 503);
  }

  return config;
}

function clean(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function fingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function paymentConfigError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

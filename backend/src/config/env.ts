import { randomBytes } from "node:crypto";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const productionPublicUrl = "https://nextech.discloud.app";
const defaultDashboardGuildIds = "";
const defaultDashboardDevUserIds = "";
const requiredDiscordScopes = "identify guilds";
const allowedDiscordOAuthScopes = new Set(requiredDiscordScopes.split(" "));
const isProduction = process.env.NODE_ENV === "production";

if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  console.warn("[env] NODE_TLS_REJECT_UNAUTHORIZED=0 ignorado para manter TLS seguro.");
}

function cleanEnvValue(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function applyPackedEnv() {
  const jsonConfig = cleanEnvValue(process.env.APP_CONFIG_JSON);
  const base64Config =
    cleanEnvValue(process.env.APP_CONFIG_B64)
    ?? cleanEnvValue(process.env.APP_CONFIG_BASE64)
    ?? cleanEnvValue(process.env.NEX_TECH_CONFIG_B64);
  const rawConfig = jsonConfig ?? (base64Config ? Buffer.from(base64Config, "base64").toString("utf8") : undefined);

  if (!rawConfig) {
    return;
  }

  try {
    const parsed = JSON.parse(rawConfig) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("config precisa ser um objeto JSON.");
    }

    for (const [key, value] of Object.entries(parsed)) {
      if (!/^[A-Z0-9_]+$/.test(key) || value === null || value === undefined) {
        continue;
      }

      if (!cleanEnvValue(process.env[key])) {
        process.env[key] = typeof value === "string" ? value : String(value);
      }
    }
  } catch (error) {
    console.warn("[env] APP_CONFIG_JSON/APP_CONFIG_B64 inválido:", error instanceof Error ? error.message : error);
  }
}

function applyEnvAlias(target: string, ...sources: string[]) {
  if (cleanEnvValue(process.env[target])) {
    return;
  }

  for (const source of sources) {
    const value = cleanEnvValue(process.env[source]);
    if (value) {
      process.env[target] = value;
      return;
    }
  }
}

function applyMercadoPagoEnvAliases() {
  const environment = cleanEnvValue(process.env.MERCADOPAGO_ENV) ?? cleanEnvValue(process.env.MERCADO_PAGO_ENV) ?? "production";
  const credentialPrefix = environment === "test" ? "MERCADOPAGO_TEST" : "MERCADOPAGO_PROD";

  applyEnvAlias("MERCADOPAGO_ENV", "MERCADO_PAGO_ENV");
  applyEnvAlias("MERCADOPAGO_ENABLED", "MERCADO_PAGO_ENABLED");
  applyEnvAlias(`${credentialPrefix}_ACCESS_TOKEN`, "MERCADO_PAGO_ACCESS_TOKEN");
  applyEnvAlias(`${credentialPrefix}_PUBLIC_KEY`, "MERCADO_PAGO_PUBLIC_KEY", "NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY");
  applyEnvAlias(`${credentialPrefix}_WEBHOOK_SECRET`, "MERCADO_PAGO_WEBHOOK_SECRET");
  applyEnvAlias("MERCADOPAGO_SUCCESS_URL", "MERCADO_PAGO_SUCCESS_URL");
  applyEnvAlias("MERCADOPAGO_PENDING_URL", "MERCADO_PAGO_PENDING_URL");
  applyEnvAlias("MERCADOPAGO_FAILURE_URL", "MERCADO_PAGO_FAILURE_URL");
  applyEnvAlias("MERCADOPAGO_WEBHOOK_URL", "MERCADO_PAGO_WEBHOOK_URL");
  applyEnvAlias("MERCADOPAGO_CURRENCY", "MERCADO_PAGO_CURRENCY");
  applyEnvAlias("MERCADOPAGO_STATEMENT_DESCRIPTOR", "MERCADO_PAGO_STATEMENT_DESCRIPTOR");
  applyEnvAlias("MERCADOPAGO_CHECKOUT_EXPIRATION_MINUTES", "MERCADO_PAGO_CHECKOUT_EXPIRATION_MINUTES");
  applyEnvAlias("MERCADOPAGO_MAX_INSTALLMENTS", "MERCADO_PAGO_MAX_INSTALLMENTS");
  applyEnvAlias("MERCADOPAGO_BINARY_MODE", "MERCADO_PAGO_BINARY_MODE");
}

function applyPagBankEnvAliases() {
  applyEnvAlias("PAGBANK_TOKEN", "PAGSEGURO_TOKEN");
  applyEnvAlias("PAGBANK_PUBLIC_KEY", "PAGSEGURO_PUBLIC_KEY");
  applyEnvAlias("PAGBANK_CLIENT_ID", "PAGSEGURO_CLIENT_ID");
  applyEnvAlias("PAGBANK_CLIENT_SECRET", "PAGSEGURO_CLIENT_SECRET");
  applyEnvAlias("PAGBANK_WEBHOOK_TOKEN", "PAGSEGURO_WEBHOOK_TOKEN");
  applyEnvAlias("PAGBANK_WEBHOOK_URL", "PAGSEGURO_WEBHOOK_URL");
  applyEnvAlias("PAGBANK_BASE_URL", "PAGSEGURO_BASE_URL");
}

function applyStripeEnvAliases() {
  applyEnvAlias("STRIPE_RESTRICTED_KEY", "STRIPE_API_KEY");
  applyEnvAlias("STRIPE_PUBLISHABLE_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "VITE_STRIPE_PUBLISHABLE_KEY");
  applyEnvAlias("STRIPE_SUCCESS_URL", "STRIPE_CHECKOUT_SUCCESS_URL");
  applyEnvAlias("STRIPE_CANCEL_URL", "STRIPE_CHECKOUT_CANCEL_URL");
}

function applyAsaasEnvAliases() {
  applyEnvAlias("ASAAS_BASE_URL", "ASAAS_API_URL");
  applyEnvAlias("ASAAS_API_KEY", "ASAAS_ACCESS_TOKEN", "ASAAS_TOKEN");
  applyEnvAlias("ASAAS_WEBHOOK_TOKEN", "ASAAS_WEBHOOK_SECRET");
  applyEnvAlias("ASAAS_WEBHOOK_URL", "ASAAS_NOTIFICATION_URL");
}

function normalizeUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function discordRedirectUriFor(origin: string) {
  return `${normalizeUrl(origin)}/auth/discord/callback`;
}

function isValidUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function envSecret() {
  const fallback = randomBytes(32).toString("hex");

  return z.preprocess(
    (value) => cleanEnvValue(value) ?? fallback,
    z.string().min(12)
  );
}

function internalBotToken() {
  const fallback = randomBytes(32).toString("hex");

  return z.preprocess(
    (value) => cleanEnvValue(value) ?? fallback,
    z.string()
  );
}

function envUrl(name: string, fallback: string) {
  return z.preprocess(
    (value) => {
      const cleaned = cleanEnvValue(value);

      if (cleaned && isLocalUrl(cleaned)) {
        return fallback;
      }

      return cleaned ?? fallback;
    },
    z
      .string()
      .refine((value) => value === "" || isValidUrl(value), `${name} precisa ser uma URL válida.`)
      .transform((value) => (value ? normalizeUrl(value) : ""))
  );
}

function envOptionalUrl(name: string) {
  return z.preprocess(
    (value) => cleanEnvValue(value) ?? "",
    z
      .string()
      .refine((value) => value === "" || isValidUrl(value), `${name} precisa ser uma URL válida.`)
      .transform((value) => (value ? normalizeUrl(value) : ""))
  );
}

function envBoolean(defaultValue: boolean) {
  return z
    .string()
    .optional()
    .default(String(defaultValue))
    .transform((value) => ["1", "true", "yes", "on"].includes(value.trim().toLowerCase()));
}

function mergeCsvValues(value: string, fallback: string) {
  return [...new Set(`${value},${fallback}`.split(",").map((item) => item.trim()).filter(Boolean))].join(",");
}

function mergeSpaceValues(value: string, fallback: string) {
  return [...new Set(`${value} ${fallback}`.split(/\s+/).map((item) => item.trim()).filter(Boolean))].join(" ");
}

function normalizeDiscordScopes(value: string) {
  const scopes = value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => allowedDiscordOAuthScopes.has(item));

  return [...new Set(scopes)].join(" ") || requiredDiscordScopes;
}

function isLocalUrl(value: string) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname);
  } catch {
    return /(?:\/\/|@)(localhost|127\.0\.0\.1|0\.0\.0\.0)(?::|\/|$)/i.test(value);
  }
}

applyPackedEnv();
applyMercadoPagoEnvAliases();
applyPagBankEnvAliases();
applyStripeEnvAliases();
applyAsaasEnvAliases();

const configuredSiteOrigin =
  cleanEnvValue(process.env.SITE_ORIGIN)
  ?? cleanEnvValue(process.env.FRONTEND_URL)
  ?? cleanEnvValue(process.env.BACKEND_URL);
const productionSiteOrigin = configuredSiteOrigin && !isLocalUrl(configuredSiteOrigin)
  ? normalizeUrl(configuredSiteOrigin)
  : productionPublicUrl;
const defaultSiteOrigin = productionSiteOrigin;
const canonicalDiscordRedirectUri = defaultSiteOrigin ? discordRedirectUriFor(defaultSiteOrigin) : "";
const canonicalTwitchRedirectUri = defaultSiteOrigin ? `${defaultSiteOrigin}/api/giveaways/oauth/twitch/callback` : "";
const canonicalKickRedirectUri = defaultSiteOrigin ? `${defaultSiteOrigin}/api/giveaways/oauth/kick/callback` : "";

function productionSafeUrl(value?: string) {
  if (!value) {
    return undefined;
  }

  if (isLocalUrl(value)) {
    return undefined;
  }

  return value;
}

function firstMongoUrl(...values: Array<string | undefined>) {
  for (const value of values) {
    const url = productionSafeUrl(cleanEnvValue(value));
    if (url && /^mongodb(?:\+srv)?:\/\//i.test(url)) {
      return url;
    }
  }

  return "";
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().default(80),
    MONGODB_URI: z.string().optional().default(""),
    MONGO_URI: z.string().optional().default(""),
    DATABASE_URL: z.string().optional().default(""),
    REDIS_URL: z.string().optional().default(""),
    REDIS_SESSION_ENABLED: envBoolean(false),
    BACKGROUND_JOB_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(3),
    BACKGROUND_WORKER_ENABLED: envBoolean(true),
    SCHEDULER_ENABLED: envBoolean(true),
    SESSION_SECRET: envSecret(),
    SESSION_TTL_SECONDS: z.coerce.number().default(60 * 60 * 24 * 7),
    JWT_SECRET: envSecret(),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().default(60 * 60 * 24 * 7),
    JWT_REFRESH_TTL_SECONDS: z.coerce.number().default(60 * 60 * 24 * 7),
    EPHEMERAL_TOKEN_ISSUER: z.string().min(1).default("nextech.ephemeral"),
    EPHEMERAL_TOKEN_AUDIENCE: z.string().min(1).default("nextech.api"),
    EPHEMERAL_TOKEN_ALGORITHM: z.enum(["HS256", "HS384", "HS512"]).default("HS256"),
    EPHEMERAL_TOKEN_CLOCK_SKEW_SECONDS: z.coerce.number().int().min(0).max(60).default(0),
    EPHEMERAL_TOKEN_GENERATION_LIMIT: z.coerce.number().int().min(1).max(120).default(10),
    EPHEMERAL_TOKEN_REQUEST_LIMIT: z.coerce.number().int().min(1).max(5000).default(300),
    BOT_API_TOKEN: internalBotToken(),
    PAYMENTS_ENABLED: envBoolean(false),
    PAYMENT_PROVIDER: z.enum(["disabled", "mercadopago", "pagbank", "stripe", "asaas"]).default("disabled"),
    MERCADOPAGO_ENV: z.enum(["test", "production"]).default("production"),
    MERCADOPAGO_ENABLED: envBoolean(false),
    MERCADOPAGO_PROD_ACCESS_TOKEN: z.string().optional().default(""),
    MERCADOPAGO_PROD_PUBLIC_KEY: z.string().optional().default(""),
    MERCADOPAGO_PROD_WEBHOOK_SECRET: z.string().optional().default(""),
    MERCADOPAGO_TEST_ACCESS_TOKEN: z.string().optional().default(""),
    MERCADOPAGO_TEST_PUBLIC_KEY: z.string().optional().default(""),
    MERCADOPAGO_TEST_WEBHOOK_SECRET: z.string().optional().default(""),
    APP_PUBLIC_URL: envOptionalUrl("APP_PUBLIC_URL"),
    FRONTEND_PUBLIC_URL: envOptionalUrl("FRONTEND_PUBLIC_URL"),
    API_PUBLIC_URL: envOptionalUrl("API_PUBLIC_URL"),
    MERCADOPAGO_SUCCESS_URL: envOptionalUrl("MERCADOPAGO_SUCCESS_URL"),
    MERCADOPAGO_PENDING_URL: envOptionalUrl("MERCADOPAGO_PENDING_URL"),
    MERCADOPAGO_FAILURE_URL: envOptionalUrl("MERCADOPAGO_FAILURE_URL"),
    MERCADOPAGO_WEBHOOK_URL: envOptionalUrl("MERCADOPAGO_WEBHOOK_URL"),
    MERCADOPAGO_CURRENCY: z.enum(["BRL", "USD", "EUR"]).default("BRL"),
    MERCADOPAGO_STATEMENT_DESCRIPTOR: z.string().optional().default(""),
    MERCADOPAGO_CHECKOUT_EXPIRATION_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
    MERCADOPAGO_MAX_INSTALLMENTS: z.coerce.number().int().min(1).max(24).optional(),
    MERCADOPAGO_BINARY_MODE: envBoolean(false),
    PAGBANK_TOKEN: z.string().optional().default(""),
    PAGBANK_PUBLIC_KEY: z.string().optional().default(""),
    PAGBANK_CLIENT_ID: z.string().optional().default(""),
    PAGBANK_CLIENT_SECRET: z.string().optional().default(""),
    PAGBANK_WEBHOOK_TOKEN: z.string().optional().default(""),
    PAGBANK_WEBHOOK_URL: envOptionalUrl("PAGBANK_WEBHOOK_URL"),
    PAGBANK_BASE_URL: envUrl("PAGBANK_BASE_URL", "https://sandbox.api.pagseguro.com"),
    PAGBANK_TIMEOUT: z.coerce.number().int().min(1000).max(120000).default(30000),
    STRIPE_RESTRICTED_KEY: z.string().optional().default(""),
    STRIPE_SECRET_KEY: z.string().optional().default(""),
    STRIPE_PUBLISHABLE_KEY: z.string().optional().default(""),
    STRIPE_WEBHOOK_SECRET: z.string().optional().default(""),
    STRIPE_SUCCESS_URL: envOptionalUrl("STRIPE_SUCCESS_URL"),
    STRIPE_CANCEL_URL: envOptionalUrl("STRIPE_CANCEL_URL"),
    STRIPE_WEBHOOK_URL: envOptionalUrl("STRIPE_WEBHOOK_URL"),
    STRIPE_CURRENCY: z.enum(["BRL", "USD", "EUR"]).default("BRL"),
    STRIPE_CHECKOUT_EXPIRATION_MINUTES: z.coerce.number().int().min(30).max(1440).default(30),
    STRIPE_STATEMENT_DESCRIPTOR: z.string().optional().default("NEXTECH"),
    STRIPE_INTEGRATION_IDENTIFIER: z.string().min(3).max(64).default("nextech_discord_bots"),
    STRIPE_INVOICE_CREATION_ENABLED: envBoolean(true),
    STRIPE_TAX_ENABLED: envBoolean(false),
    STRIPE_TAX_REGISTRATION_ACTIVE: envBoolean(false),
    STRIPE_TAX_ID_COLLECTION_ENABLED: envBoolean(false),
    ASAAS_API_KEY: z.string().optional().default(""),
    ASAAS_API_URL: envOptionalUrl("ASAAS_API_URL"),
    ASAAS_BASE_URL: envUrl("ASAAS_BASE_URL", "https://api-sandbox.asaas.com/v3"),
    ASAAS_WEBHOOK_TOKEN: z.string().optional().default(""),
    ASAAS_WEBHOOK_URL: envOptionalUrl("ASAAS_WEBHOOK_URL"),
    ASAAS_TIMEOUT: z.coerce.number().int().min(1000).max(120000).default(30000),
    ASAAS_CHECKOUT_EXPIRATION_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
    PIX_EXPIRATION_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
    PIX_DESCRIPTION: z.string().optional().default("Pagamento do Plano"),
    PAYMENTS_ALLOW_LIVE_CHARGES: envBoolean(false),
    PLAN_TOKEN_ENCRYPTION_KEY: z.string().optional().default(""),
    PLAN_TOKEN_FINGERPRINT_KEY: z.string().optional().default(""),
    PLAN_TOKEN_KEY_VERSION: z.string().optional().default("v1"),
    MASTER_TRANSCRIPT_PASSWORD: z.string().default("NPD Lua Bennett"),
    MASTER_TRANSCRIPT_PASSWORD_HASH: z.string().optional().default(""),
    APP_BASE_URL: envOptionalUrl("APP_BASE_URL"),
    TRANSCRIPT_BASE_URL: envOptionalUrl("TRANSCRIPT_BASE_URL"),
    TRANSCRIPT_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    DISCORD_BOT_TOKEN: z.string().default(""),
    DISCORD_CLIENT_ID: z.string().default(""),
    DISCORD_CLIENT_SECRET: z.string().default(""),
    DISCLOUD_TOKEN: z.string().optional().default(""),
    DISCLOUD_APP_IDS: z.string().optional().default(""),
    DISCLOUD_APP_ID_BY_BOT: z.string().optional().default(""),
    DISCLOUD_LOG_BOT_ID: z.string().optional().default(""),
    DISCLOUD_AUTO_RECOVERY_ENABLED: envBoolean(true),
    DISCLOUD_AUTO_RECOVERY_APP_IDS: z.string().optional().default(""),
    DISCLOUD_AUTO_RECOVERY_INTERVAL_MS: z.coerce.number().int().min(30_000).max(900_000).default(60_000),
    DISCLOUD_AUTO_RECOVERY_COOLDOWN_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(600_000),
    DISCLOUD_AUTO_RECOVERY_MIN_OFFLINE_CHECKS: z.coerce.number().int().min(1).max(10).default(2),
    SITE_ORIGIN: envUrl("SITE_ORIGIN", defaultSiteOrigin),
    BACKEND_URL: envUrl("BACKEND_URL", defaultSiteOrigin),
    DISCORD_REDIRECT_URI: envUrl("DISCORD_REDIRECT_URI", canonicalDiscordRedirectUri),
    DISCORD_OAUTH_REDIRECT_URI: envUrl("DISCORD_OAUTH_REDIRECT_URI", canonicalDiscordRedirectUri),
    DISCORD_CALLBACK_URL: envUrl("DISCORD_CALLBACK_URL", canonicalDiscordRedirectUri),
    DISCORD_SCOPES: z.string().default(requiredDiscordScopes),
    X_CONSUMER_KEY: z.string().default(""),
    X_CONSUMER_SECRET: z.string().default(""),
    X_BEARER_TOKEN: z.string().default(""),
    TWITCH_CLIENT_ID: z.string().default(""),
    TWITCH_CLIENT_SECRET: z.string().default(""),
    TWITCH_BROADCASTER_ACCESS_TOKEN: z.string().default(""),
    TWITCH_OAUTH_REDIRECT_URI: envUrl("TWITCH_OAUTH_REDIRECT_URI", canonicalTwitchRedirectUri),
    KICK_API_KEY: z.string().default(""),
    KICK_CLIENT_ID: z.string().default(""),
    KICK_CLIENT_SECRET: z.string().default(""),
    KICK_OAUTH_REDIRECT_URI: envUrl("KICK_OAUTH_REDIRECT_URI", canonicalKickRedirectUri),
    KICK_WEBHOOK_PUBLIC_KEY: z.string().default(""),
    FRONTEND_URL: envUrl("FRONTEND_URL", defaultSiteOrigin),
    STORAGE_PROVIDER: z.enum(["mongodb", "cloudinary", "firebase", "s3", "r2", "supabase"]).default("mongodb"),
    CLOUDINARY_CLOUD_NAME: z.string().optional().default(""),
    CLOUDINARY_API_KEY: z.string().optional().default(""),
    CLOUDINARY_API_SECRET: z.string().optional().default(""),
    R2_ENDPOINT: z.string().optional().default(""),
    R2_ACCESS_KEY_ID: z.string().optional().default(""),
    R2_SECRET_ACCESS_KEY: z.string().optional().default(""),
    R2_BUCKET: z.string().optional().default(""),
    R2_PUBLIC_URL: z.string().optional().default(""),
    DASHBOARD_DEV_USER_IDS: z.string().optional().default(""),
    DEV_DISCORD_IDS: z.string().optional().default(""),
    DASHBOARD_GUILD_IDS: z.string().optional().default(defaultDashboardGuildIds),
    DASHBOARD_VERIFICATION_MODE: z.enum(["temporary", "roles"]).default("roles"),
    START_REGISTERED_DEV_BOTS: envBoolean(!isProduction),
    DEV_BOT_PROCESS_RUNNER_ENABLED: envBoolean(true),
    DEV_BOT_RUNTIME_RECONCILE_ENABLED: envBoolean(false),
    DEV_BOT_RUNTIME_RECONCILE_INTERVAL_MS: z.coerce.number().int().min(15_000).max(900_000).default(60_000),
    DEV_BOT_START_CONCURRENCY: z.coerce.number().int().min(1).max(64).optional(),
    DEV_BOT_MAX_RUNNING_PROCESSES: z.coerce.number().int().min(1).max(64).optional(),
    DEV_BOT_NODE_MAX_OLD_SPACE_MB: z.coerce.number().int().min(64).max(512).optional(),
    DEV_BOT_START_STAGGER_MS: z.coerce.number().int().positive().optional(),
    DEV_BOT_COMMAND_CLEANUP_DELAY_MS: z.coerce.number().int().positive().optional(),
    RATE_LIMIT_PUBLIC_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(1_200),
    RATE_LIMIT_AUTH_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(120),
    RATE_LIMIT_MUTATION_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(240),
    RATE_LIMIT_BOT_RUNTIME_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(240),
    RATE_LIMIT_BOT_MUTATION_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(120),
    RATE_LIMIT_LOGS_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(120),
    RATE_LIMIT_DEV_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(360)
  })
  .transform((value) => {
    const mongoUrl = firstMongoUrl(value.MONGODB_URI, value.MONGO_URI, value.DATABASE_URL);
    const configuredAppBaseUrl =
      cleanEnvValue(value.TRANSCRIPT_BASE_URL)
      ?? cleanEnvValue(value.APP_BASE_URL)
      ?? cleanEnvValue(value.SITE_ORIGIN)
      ?? cleanEnvValue(value.FRONTEND_URL)
      ?? cleanEnvValue(value.BACKEND_URL);
    const appBaseUrl = configuredAppBaseUrl && (!isProduction || !isLocalUrl(configuredAppBaseUrl))
      ? normalizeUrl(configuredAppBaseUrl)
      : productionPublicUrl;
    const oauthFrontendUrl = appBaseUrl;
    const oauthCallbackUrl = oauthFrontendUrl ? discordRedirectUriFor(oauthFrontendUrl) : "";
    const configuredDiscordRedirect =
      cleanEnvValue(value.DISCORD_REDIRECT_URI)
      ?? cleanEnvValue(value.DISCORD_OAUTH_REDIRECT_URI)
      ?? cleanEnvValue(value.DISCORD_CALLBACK_URL);
    const normalizedDiscordRedirect = configuredDiscordRedirect && !isLocalUrl(configuredDiscordRedirect)
      ? normalizeUrl(configuredDiscordRedirect)
      : "";
    const effectiveDiscordRedirect = oauthCallbackUrl || normalizedDiscordRedirect;
    const configuredTranscriptBaseUrl = cleanEnvValue(value.TRANSCRIPT_BASE_URL) ?? cleanEnvValue(value.APP_BASE_URL);
    const normalizedTranscriptBaseUrl = configuredTranscriptBaseUrl && (!isProduction || !isLocalUrl(configuredTranscriptBaseUrl))
      ? normalizeUrl(configuredTranscriptBaseUrl)
      : "";

    if (normalizedDiscordRedirect && oauthCallbackUrl && normalizedDiscordRedirect !== oauthCallbackUrl) {
      console.warn(`[env] Discord redirect configurado (${normalizedDiscordRedirect}) difere do domínio canonico (${oauthCallbackUrl}); usando o canonico.`);
    }

    if (isProduction && configuredTranscriptBaseUrl && isLocalUrl(configuredTranscriptBaseUrl)) {
      console.warn("[env] TRANSCRIPT_BASE_URL local ignorado em produção. Configure um domínio público para transcripts.");
    }

    return {
      ...value,
      MONGODB_URI: mongoUrl,
      APP_BASE_URL: appBaseUrl,
      SITE_ORIGIN: oauthFrontendUrl,
      FRONTEND_URL: oauthFrontendUrl,
      BACKEND_URL: oauthFrontendUrl,
      APP_PUBLIC_URL: value.APP_PUBLIC_URL || oauthFrontendUrl,
      FRONTEND_PUBLIC_URL: value.FRONTEND_PUBLIC_URL || oauthFrontendUrl,
      API_PUBLIC_URL: value.API_PUBLIC_URL || (oauthFrontendUrl ? `${oauthFrontendUrl}/api` : ""),
      MERCADOPAGO_SUCCESS_URL: value.MERCADOPAGO_SUCCESS_URL || (oauthFrontendUrl ? `${oauthFrontendUrl}/pagamento/sucesso` : ""),
      MERCADOPAGO_PENDING_URL: value.MERCADOPAGO_PENDING_URL || (oauthFrontendUrl ? `${oauthFrontendUrl}/pagamento/pendente` : ""),
      MERCADOPAGO_FAILURE_URL: value.MERCADOPAGO_FAILURE_URL || (oauthFrontendUrl ? `${oauthFrontendUrl}/pagamento/falha` : ""),
      MERCADOPAGO_WEBHOOK_URL: value.MERCADOPAGO_WEBHOOK_URL || (oauthFrontendUrl ? `${oauthFrontendUrl}/api/payments/mercadopago/webhook` : ""),
      PAGBANK_WEBHOOK_URL: value.PAGBANK_WEBHOOK_URL || (oauthFrontendUrl ? `${oauthFrontendUrl}/api/payments/pagbank/webhook` : ""),
      STRIPE_SUCCESS_URL: value.STRIPE_SUCCESS_URL || (oauthFrontendUrl ? `${oauthFrontendUrl}/pagamento/sucesso?provider=stripe&session_id={CHECKOUT_SESSION_ID}` : ""),
      STRIPE_CANCEL_URL: value.STRIPE_CANCEL_URL || (oauthFrontendUrl ? `${oauthFrontendUrl}/pagamento/falha?provider=stripe` : ""),
      STRIPE_WEBHOOK_URL: value.STRIPE_WEBHOOK_URL || (oauthFrontendUrl ? `${oauthFrontendUrl}/api/payments/stripe/webhook` : ""),
      ASAAS_WEBHOOK_URL: value.ASAAS_WEBHOOK_URL || (oauthFrontendUrl ? `${oauthFrontendUrl}/api/webhooks/asaas` : ""),
      TRANSCRIPT_BASE_URL: normalizedTranscriptBaseUrl || oauthFrontendUrl,
      TRANSCRIPT_PORT: value.TRANSCRIPT_PORT ?? value.PORT,
      DISCORD_REDIRECT_URI: effectiveDiscordRedirect,
      DISCORD_OAUTH_REDIRECT_URI: effectiveDiscordRedirect,
      DISCORD_CALLBACK_URL: effectiveDiscordRedirect,
      TWITCH_OAUTH_REDIRECT_URI: value.TWITCH_OAUTH_REDIRECT_URI || (oauthFrontendUrl ? `${oauthFrontendUrl}/api/giveaways/oauth/twitch/callback` : ""),
      KICK_OAUTH_REDIRECT_URI: value.KICK_OAUTH_REDIRECT_URI || (oauthFrontendUrl ? `${oauthFrontendUrl}/api/giveaways/oauth/kick/callback` : ""),
      DISCORD_SCOPES: normalizeDiscordScopes(mergeSpaceValues(value.DISCORD_SCOPES, requiredDiscordScopes)),
      REDIS_URL: productionSafeUrl(cleanEnvValue(value.REDIS_URL)) ?? "",
      DASHBOARD_DEV_USER_IDS: mergeCsvValues(
        mergeCsvValues(value.DASHBOARD_DEV_USER_IDS, value.DEV_DISCORD_IDS),
        defaultDashboardDevUserIds
      ),
      DEV_DISCORD_IDS: value.DEV_DISCORD_IDS,
      DASHBOARD_GUILD_IDS: mergeCsvValues(value.DASHBOARD_GUILD_IDS, defaultDashboardGuildIds)
    };
  });

export const env = envSchema.parse(process.env);

process.env.MONGODB_URI = env.MONGODB_URI;
process.env.SITE_ORIGIN = env.SITE_ORIGIN;
process.env.FRONTEND_URL = env.FRONTEND_URL;
process.env.BACKEND_URL = env.BACKEND_URL;
process.env.APP_PUBLIC_URL = env.APP_PUBLIC_URL;
process.env.FRONTEND_PUBLIC_URL = env.FRONTEND_PUBLIC_URL;
process.env.API_PUBLIC_URL = env.API_PUBLIC_URL;
process.env.APP_BASE_URL = env.APP_BASE_URL;
process.env.TRANSCRIPT_BASE_URL = env.TRANSCRIPT_BASE_URL;
process.env.TRANSCRIPT_PORT = String(env.TRANSCRIPT_PORT);
process.env.DISCORD_REDIRECT_URI = env.DISCORD_REDIRECT_URI;
process.env.DISCORD_OAUTH_REDIRECT_URI = env.DISCORD_OAUTH_REDIRECT_URI;
process.env.DISCORD_CALLBACK_URL = env.DISCORD_CALLBACK_URL;
process.env.DISCORD_SCOPES = env.DISCORD_SCOPES;
process.env.BOT_API_TOKEN = env.BOT_API_TOKEN;
process.env.DASHBOARD_DEV_USER_IDS = env.DASHBOARD_DEV_USER_IDS;
process.env.DEV_DISCORD_IDS = env.DEV_DISCORD_IDS;

if (env.NODE_ENV === "production") {
  const missing = [
    ["SITE_ORIGIN", env.SITE_ORIGIN],
    ["FRONTEND_URL", env.FRONTEND_URL],
    ["APP_BASE_URL", env.APP_BASE_URL],
    ["TRANSCRIPT_BASE_URL", env.TRANSCRIPT_BASE_URL],
    ["MONGODB_URI", env.MONGODB_URI],
    ["BOT_API_TOKEN", cleanEnvValue(env.BOT_API_TOKEN)],
    ["DISCORD_BOT_TOKEN", cleanEnvValue(env.DISCORD_BOT_TOKEN)],
    ["DISCORD_CLIENT_ID", cleanEnvValue(env.DISCORD_CLIENT_ID)],
    ["DISCORD_CLIENT_SECRET", cleanEnvValue(env.DISCORD_CLIENT_SECRET)],
    ["DISCORD_OAUTH_REDIRECT_URI", env.DISCORD_OAUTH_REDIRECT_URI]
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    console.warn(`[env] variaveis pendentes na hospedagem: ${missing.join(", ")}.`);
  }

  if (!cleanEnvValue(process.env.SESSION_SECRET) || !cleanEnvValue(process.env.JWT_SECRET)) {
    console.warn("[env] SESSION_SECRET/JWT_SECRET ausentes; usando segredos temporarios até configurar na hospedagem.");
  }
}

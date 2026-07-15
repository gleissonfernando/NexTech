import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

type ServiceAccount = {
  client_email: string;
  private_key: string;
};

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

export function googleSheetsConfigured() {
  return Boolean(loadServiceAccount());
}

export async function appendSheetRow(input: { spreadsheetId: string; sheetName: string; values: unknown[] }) {
  const token = await getAccessToken();
  const url = `${SHEETS_API}/${encodeURIComponent(input.spreadsheetId)}/values/${encodeURIComponent(input.sheetName)}!A:Z:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS&includeValuesInResponse=false`;
  const response = await fetch(url, {
    body: JSON.stringify({ majorDimension: "ROWS", values: [input.values] }),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    method: "POST"
  });
  if (!response.ok) throw new Error(await googleError(response));
  const data = await response.json() as { updates?: { updatedRange?: string } };
  return parseUpdatedRow(data.updates?.updatedRange ?? null);
}

export async function updateSheetRow(input: { spreadsheetId: string; sheetName: string; row: number; values: unknown[] }) {
  const token = await getAccessToken();
  const range = `${input.sheetName}!A${input.row}:Z${input.row}`;
  const url = `${SHEETS_API}/${encodeURIComponent(input.spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const response = await fetch(url, {
    body: JSON.stringify({ majorDimension: "ROWS", values: [input.values] }),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    method: "PUT"
  });
  if (!response.ok) throw new Error(await googleError(response));
}

export async function ensureSheetHeaders(input: { spreadsheetId: string; sheetName: string; headers: string[] }) {
  const token = await getAccessToken();
  const range = `${input.sheetName}!A1:Z1`;
  const url = `${SHEETS_API}/${encodeURIComponent(input.spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const response = await fetch(url, {
    body: JSON.stringify({ majorDimension: "ROWS", values: [input.headers] }),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    method: "PUT"
  });
  if (!response.ok) throw new Error(await googleError(response));
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.accessToken;
  const account = loadServiceAccount();
  if (!account) throw new Error("Credenciais do Google Sheets não configuradas.");
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt({
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
    iss: account.client_email,
    scope: SHEETS_SCOPE
  }, account.private_key);
  const response = await fetch(TOKEN_URL, {
    body: new URLSearchParams({ assertion, grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer" }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST"
  });
  if (!response.ok) throw new Error(await googleError(response));
  const data = await response.json() as { access_token: string; expires_in: number };
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + Math.max(1, data.expires_in - 60) * 1000 };
  return cachedToken.accessToken;
}

function signJwt(payload: Record<string, unknown>, privateKey: string) {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = base64Url(JSON.stringify(payload));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${body}`);
  signer.end();
  return `${header}.${body}.${signer.sign(normalizePrivateKey(privateKey), "base64url")}`;
}

function loadServiceAccount(): ServiceAccount | null {
  const rawJson = clean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
    ?? clean(process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON)
    ?? decodeBase64(clean(process.env.GOOGLE_SERVICE_ACCOUNT_B64) ?? clean(process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_B64));
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as Partial<ServiceAccount>;
      if (parsed.client_email && parsed.private_key) return { client_email: parsed.client_email, private_key: parsed.private_key };
    } catch {
      return null;
    }
  }
  const clientEmail = clean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) ?? clean(process.env.GOOGLE_SHEETS_CLIENT_EMAIL);
  const privateKey = clean(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) ?? clean(process.env.GOOGLE_SHEETS_PRIVATE_KEY);
  return clientEmail && privateKey ? { client_email: clientEmail, private_key: privateKey } : null;
}

function normalizePrivateKey(value: string) {
  return value.replace(/\\n/g, "\n");
}

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function decodeBase64(value: string | null) {
  if (!value) return null;
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function base64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

function parseUpdatedRow(range: string | null) {
  if (!range) return null;
  const match = /![A-Z]+(\d+):/i.exec(range);
  return match ? Number(match[1]) : null;
}

async function googleError(response: Response) {
  const text = await response.text().catch(() => "");
  try {
    const data = JSON.parse(text) as { error?: { message?: string } };
    return data.error?.message || `Google Sheets retornou HTTP ${response.status}.`;
  } catch {
    return text || `Google Sheets retornou HTTP ${response.status}.`;
  }
}

import { env } from "../config/env";

const DISCORD_API = "https://discord.com/api/v10";
const PAYMENT_INCIDENT_CHANNEL_ID = "1532376009264070797";

type PaymentIncidentInput = {
  amountInCents: number;
  currency: string;
  environment: string;
  error: unknown;
  itemId: string;
  itemTitle: string;
  orderId: string;
  paymentMethod: string;
  provider: string;
};

export async function notifyPaymentIncident(input: PaymentIncidentInput) {
  if (!env.DISCORD_BOT_TOKEN) {
    console.warn("[payments] log Discord ignorado: DISCORD_BOT_TOKEN não configurado.");
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(`${DISCORD_API}/channels/${PAYMENT_INCIDENT_CHANNEL_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        allowed_mentions: { parse: [] },
        embeds: [{
          color: 0xEF4444,
          title: "Falha no PIX Asaas",
          description: "O backend tentou criar uma cobrança Pix e o fluxo caiu antes de entregar QR Code/copia-e-cola ao cliente.",
          fields: [
            { name: "Pedido", value: inlineCode(input.orderId), inline: false },
            { name: "Produto", value: safeField(input.itemTitle || input.itemId), inline: true },
            { name: "Valor", value: formatMoney(input.amountInCents, input.currency), inline: true },
            { name: "Provedor", value: input.provider, inline: true },
            { name: "Método", value: input.paymentMethod, inline: true },
            { name: "Ambiente", value: input.environment, inline: true },
            { name: "Erro", value: safeField(errorMessage(input.error)), inline: false }
          ],
          timestamp: new Date().toISOString()
        }]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      console.warn("[payments] falha ao enviar log Discord", { status: response.status });
    }
  } catch (error) {
    console.warn("[payments] falha ao enviar log Discord", error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timeout);
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function formatMoney(amountInCents: number, currency: string) {
  const value = (amountInCents / 100).toFixed(2).replace(".", ",");
  return `${currency} ${value}`;
}

function inlineCode(value: string) {
  return `\`${value.replace(/`/g, "'").slice(0, 120)}\``;
}

function safeField(value: string) {
  const cleaned = value.replace(/`/g, "'").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 1000) : "n/a";
}

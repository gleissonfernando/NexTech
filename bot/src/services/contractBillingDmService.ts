import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type Client } from "discord.js";
import { currentRuntimeBotId, env } from "../config/env";
import type { BotContext } from "../types";
import type { ContractBillingDmEvent } from "../websocket/socketClient";

const NEXTECH_SUPPORT_INVITE_URL = "https://nextech.discloud.app/invite/nextech";

export function startContractBillingDmService(client: Client<true>, context: BotContext) {
  context.socket.onContractBillingDm((payload) => {
    void sendContractBillingDm(client, context, payload);
  });
}

async function sendContractBillingDm(client: Client<true>, context: BotContext, payload: ContractBillingDmEvent) {
  const runtimeBotId = (currentRuntimeBotId() ?? env.DASHBOARD_BOT_ID) || null;
  if (payload.botId && runtimeBotId && payload.botId !== runtimeBotId) return;

  const invoiceId = payload.invoice?.id ?? null;
  try {
    const user = await client.users.fetch(payload.user.discordUserId);
    await user.send(renderContractDm(payload));
    await context.api.reportContractBillingDmResult({
      invoiceId,
      notificationType: payload.event,
      ok: true,
      userId: payload.user.discordUserId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DM fechada ou indisponível.";
    await context.api.reportContractBillingDmResult({
      error: message,
      invoiceId,
      notificationType: payload.event,
      ok: false,
      userId: payload.user.discordUserId
    }).catch(() => null);
  }
}

function renderContractDm(payload: ContractBillingDmEvent) {
  const invoice = payload.invoice;
  const title = titleFor(payload.event);
  const userName = payload.user.discordDisplayName || payload.user.discordUsername || "cliente";
  const items = payload.items.length
    ? payload.items.map((item) => `- ${escapeMarkdown(item.name)}${item.quantity > 1 ? ` x${item.quantity}` : ""}`).join("\n")
    : "- Recursos do contrato";
  const due = invoice?.dueDate ? formatDate(new Date(invoice.dueDate)) : "Nao informado";
  const pixExpiresAt = invoice?.pixExpiresAt ? formatDateTime(new Date(invoice.pixExpiresAt)) : "validade limitada";
  const pixStatus = invoice?.pixExpiresAt && Date.parse(invoice.pixExpiresAt) <= Date.now()
    ? "QR Code expirado. Acesse a dashboard para consultar ou gerar um novo código."
    : invoice?.pixExpiresAt
      ? "Este QR Code PIX possui validade limitada. Caso ele expire, acesse a dashboard para consultar ou gerar um novo código de pagamento."
      : "Use o QR Code PIX ou, se preferir, copie o código copia e cola abaixo.";
  const content = [
    `# ${title}`,
    "",
    `Olá, **${escapeMarkdown(userName)}**!`,
    descriptionFor(payload.event, payload.serviceName),
    "",
    `**Bot:** ${escapeMarkdown(payload.serviceName)}`,
    `**Servidor:** ${escapeMarkdown(payload.serverName ?? payload.serverId ?? "Nao informado")}`,
    `**Plano/serviço:** ${escapeMarkdown(payload.planName)}`,
    invoice ? `**Valor:** ${formatMoney(invoice.amountInCents, invoice.currency)}` : null,
    invoice ? `**Vencimento:** ${due}` : null,
    invoice ? `**Status:** ${escapeMarkdown(invoice.status)}` : null,
    "",
    "## Recursos liberados ou cobrados",
    items,
    "",
    invoice?.pixCopyPaste ? `## PIX Copia e Cola\nSe preferir, use este código para pagar manualmente:\n\`\`\`\n${invoice.pixCopyPaste.slice(0, 1800)}\n\`\`\`` : null,
    invoice ? `## Aviso sobre QR Code\n${pixStatus}${invoice.pixExpiresAt ? `\nValidade: ${pixExpiresAt}` : ""}` : null,
    invoice && isChargeEvent(payload.event) ? [
      "## Aviso de hospedagem",
      "Se a hospedagem não for paga, o bot será desligado após a fatura ficar vencida.",
      "Caso exista mais de uma fatura vencida, o bot só voltará a ligar quando todas as faturas vencidas forem pagas ou liberadas pela equipe.",
      `Para liberar o bot por comprovante, entre no servidor da NexTech, abra um ticket e envie o comprovante: ${NEXTECH_SUPPORT_INVITE_URL}`
    ].join("\n") : null,
    "",
    payload.contractId ? `-# Contrato: ${payload.contractId}` : null,
    invoice ? `-# Fatura: ${invoice.id}` : null
  ].filter(Boolean).join("\n");

  const components: Array<Record<string, unknown> | ActionRowBuilder<ButtonBuilder>> = [];
  if (invoice?.pixQrCode && !isExpired(invoice.pixExpiresAt)) {
    components.push({ type: 12, items: [{ media: { url: invoice.pixQrCode }, description: "QR Code PIX" }] });
  }
  components.push({ type: 10, content });
  components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setLabel("Abrir dashboard").setStyle(ButtonStyle.Link).setURL(absoluteDashboardUrl(payload.dashboardUrl)),
    new ButtonBuilder().setLabel("Verificar pagamento").setStyle(ButtonStyle.Link).setURL(absoluteDashboardUrl(payload.dashboardUrl))
  ));

  return {
    components: [{
      type: 17,
      accent_color: colorFor(payload.event),
      components
    }],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function titleFor(event: ContractBillingDmEvent["event"]) {
  if (event === "payment_confirmed") return "Pagamento confirmado";
  if (event === "contract_activated") return "Contrato ativado";
  if (event === "upgrade_confirmed") return "Upgrade confirmado";
  if (event === "overdue") return "Fatura vencida";
  if (event === "qr_expired") return "QR Code expirado";
  if (event === "payment_failed") return "Falha no pagamento";
  if (event === "due_reminder") return "Lembrete de vencimento";
  if (event === "due_today") return "Vencimento hoje";
  return "Cobrança gerada";
}

function descriptionFor(event: ContractBillingDmEvent["event"], serviceName: string) {
  if (event === "payment_confirmed" || event === "contract_activated") {
    return `O pagamento da contratação do bot **${escapeMarkdown(serviceName)}** foi confirmado. As configurações contratadas já estão disponíveis na dashboard.`;
  }
  if (event === "upgrade_confirmed") return "O pagamento do upgrade foi confirmado e os novos recursos foram liberados.";
  if (event === "overdue") return "Existe uma fatura vencida relacionada ao seu contrato.";
  if (event === "qr_expired") return "O QR Code PIX anterior expirou. Consulte a dashboard para obter um código atualizado.";
  return "Uma cobrança foi gerada para o seu contrato.";
}

function isChargeEvent(event: ContractBillingDmEvent["event"]) {
  return event === "invoice_created" || event === "due_reminder" || event === "due_today" || event === "overdue" || event === "qr_expired" || event === "payment_failed";
}

function colorFor(event: ContractBillingDmEvent["event"]) {
  if (event === "payment_confirmed" || event === "contract_activated" || event === "upgrade_confirmed") return 0x22c55e;
  if (event === "overdue" || event === "payment_failed") return 0xef4444;
  if (event === "qr_expired") return 0xf59e0b;
  return 0x2563eb;
}

function isExpired(value: string | null | undefined) {
  return Boolean(value && Date.parse(value) <= Date.now());
}

function absoluteDashboardUrl(value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  const base = env.FRONTEND_URL || "https://nextech.local";
  return new URL(value || "/dashboard", base).toString();
}

function formatMoney(cents: number, currency: "BRL") {
  return new Intl.NumberFormat("pt-BR", { currency, style: "currency" }).format(cents / 100);
}

function formatDate(date: Date) {
  if (Number.isNaN(date.getTime())) return "Nao informado";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(date);
}

function formatDateTime(date: Date) {
  if (Number.isNaN(date.getTime())) return "validade limitada";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(date);
}

function escapeMarkdown(value: string) {
  return value.replace(/([\\`*_{}[\]()#+\-.!|>])/g, "\\$1");
}

import { Router } from "express";
import { z } from "zod";
import {
  createProductCheckout,
  getPublicNexTechProduct,
  processNexTechPaymentWebhook
} from "../services/nexTechSalesService";
import { verifyAndReadSalesTicketTranscript } from "../services/salesTicketService";

export const nexTechSalesRouter = Router();

const webhookParamsSchema = z.object({
  gatewayId: z.string().min(8).max(120),
  storeId: z.string().min(8).max(120)
});

const productParamsSchema = z.object({
  slug: z.string().min(1).max(120),
  storeId: z.string().min(8).max(120)
});

const checkoutSchema = z.object({
  buyerEmail: z.string().email().nullable().optional().or(z.literal("")),
  buyerId: z.string().regex(/^\d{5,32}$/),
  buyerName: z.string().max(100).nullable().optional().or(z.literal("")),
  paymentProviderId: z.string().max(120).nullable().optional(),
  planType: z.enum(["monthly", "lifetime"])
});
const transcriptSchema = z.object({
  password: z.string().min(8).max(64)
});

nexTechSalesRouter.get("/tickets/transcripts/:transcriptId", async (req, res, next) => {
  try {
    const transcriptId = z.string().min(8).max(120).parse(req.params.transcriptId);
    return res.type("html").send(renderSalesTranscriptLogin(transcriptId));
  } catch (error) {
    return next(error);
  }
});

nexTechSalesRouter.post("/tickets/transcripts/:transcriptId", async (req, res, next) => {
  try {
    const transcriptId = z.string().min(8).max(120).parse(req.params.transcriptId);
    const input = transcriptSchema.parse(req.body ?? {});
    const result = await verifyAndReadSalesTicketTranscript(transcriptId, input.password);

    if (!result) {
      return res.status(404).type("html").send(renderSalesTranscriptLogin(transcriptId, "Transcript não encontrado ou senha inválida."));
    }

    return res.type("html").send(renderSalesTranscriptHtml(result));
  } catch (error) {
    return next(error);
  }
});

nexTechSalesRouter.get("/stores/:storeId/products/:slug", async (req, res, next) => {
  try {
    const params = productParamsSchema.parse(req.params);
    const product = await getPublicNexTechProduct(params.storeId, params.slug);

    if (!product) {
      return res.status(404).json({
        message: "Produto não encontrado."
      });
    }

    return res.json(product);
  } catch (error) {
    return next(error);
  }
});

nexTechSalesRouter.post("/stores/:storeId/products/:slug/checkout", async (req, res, next) => {
  try {
    const params = productParamsSchema.parse(req.params);
    const input = checkoutSchema.parse(req.body ?? {});
    const checkout = await createProductCheckout(params.storeId, params.slug, {
      ...input,
      buyerEmail: input.buyerEmail === "" ? null : input.buyerEmail,
      buyerId: input.buyerId === "" ? null : input.buyerId,
      buyerName: input.buyerName === "" ? null : input.buyerName
    });

    if (!checkout) {
      return res.status(404).json({
        message: "Produto não encontrado."
      });
    }

    return res.status(201).json(checkout);
  } catch (error) {
    return next(error);
  }
});

nexTechSalesRouter.post("/webhooks/:storeId/:gatewayId", async (req, res, next) => {
  try {
    const params = webhookParamsSchema.parse(req.params);
    const rawBody = ((req as typeof req & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}))).toString("utf8");
    const signature = req.header("x-nex-tech-signature")
      ?? req.header("x-hub-signature-256")
      ?? req.header("x-signature")
      ?? null;
    const queryDataId = readString(req.query["data.id"]) ?? readString(req.query.id);
    const queryType = readString(req.query.type);

    const result = await processNexTechPaymentWebhook(params.storeId, params.gatewayId, {
      dataId: queryDataId ?? readString(req.body?.data?.id),
      eventId: readString(req.body?.id) ?? readString(req.body?.eventId) ?? queryDataId ?? readString(req.body?.data?.id),
      eventType: queryType ?? readString(req.body?.type) ?? readString(req.body?.eventType) ?? readString(req.body?.action),
      payload: req.body,
      rawBody,
      requestId: req.header("x-request-id"),
      signature
    });

    return res.status(result.statusCode).json(result);
  } catch (error) {
    return next(error);
  }
});

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function renderSalesTranscriptLogin(transcriptId: string, message?: string) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Transcript de Vendas</title>
  <style>
    body{margin:0;background:#050505;color:#f4f4f5;font-family:Inter,Segoe UI,Arial,sans-serif;display:grid;min-height:100vh;place-items:center}
    main{width:min(460px,calc(100vw - 32px));border:1px solid rgba(255,213,0,.25);border-radius:14px;background:linear-gradient(135deg,rgba(24,24,27,.96),rgba(8,8,12,.98));padding:28px;box-shadow:0 0 44px rgba(255,213,0,.10)}
    h1{margin:0 0 8px;font-size:24px}
    p{color:#a1a1aa;line-height:1.55}
    label{display:block;margin:18px 0 8px;font-size:12px;font-weight:800;text-transform:uppercase;color:#d4d4d8}
    input{box-sizing:border-box;width:100%;border:1px solid #3f3f46;border-radius:10px;background:#09090b;color:#fff;padding:12px;font-size:15px;outline:none}
    button{margin-top:14px;width:100%;border:0;border-radius:10px;background:#ffd500;color:#111;padding:12px 14px;font-weight:900;cursor:pointer}
    .msg{border:1px solid rgba(248,113,113,.35);background:rgba(127,29,29,.25);color:#fecaca;border-radius:10px;padding:10px 12px}
    .id{margin-top:14px;font-size:12px;color:#71717a;word-break:break-all}
  </style>
</head>
<body>
  <main>
    <h1>Transcript de Vendas</h1>
    <p>Informe a senha recebida na sua DM para visualizar este atendimento.</p>
    ${message ? `<div class="msg">${escapeHtml(message)}</div>` : ""}
    <form method="post" action="/api/nex-tech-sales/tickets/transcripts/${encodeURIComponent(transcriptId)}">
      <label for="password">Senha</label>
      <input id="password" name="password" autocomplete="off" required type="password" />
      <button type="submit">Abrir Transcript</button>
    </form>
    <div class="id">ID: ${escapeHtml(transcriptId)}</div>
  </main>
</body>
</html>`;
}

function renderSalesTranscriptHtml(result: NonNullable<Awaited<ReturnType<typeof verifyAndReadSalesTicketTranscript>>>) {
  const transcript = result.transcript;
  const messages = transcript.messages.map((message) => {
    const object = message && typeof message === "object" ? message as Record<string, unknown> : {};
    const authorName = readString(object.authorName) ?? "Usuário";
    const createdAt = readString(object.createdAt) ?? "";
    const content = readString(object.content) ?? "";
    const attachments = Array.isArray(object.attachments) ? object.attachments : [];
    return `<article class="msg">
      <header><strong>${escapeHtml(authorName)}</strong><span>${escapeHtml(formatTranscriptDate(createdAt))}</span></header>
      <p>${escapeHtml(content || "(sem texto)").replace(/\n/g, "<br>")}</p>
      ${attachments.length ? `<ul>${attachments.map((item) => {
        const attachment = item && typeof item === "object" ? item as Record<string, unknown> : {};
        const url = readString(attachment.url) ?? "";
        const name = readString(attachment.name) ?? "anexo";
        return url ? `<li><a href="${escapeHtml(url)}" rel="noreferrer" target="_blank">${escapeHtml(name)}</a></li>` : "";
      }).join("")}</ul>` : ""}
    </article>`;
  }).join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Transcript de Vendas</title>
  <style>
    body{margin:0;background:#050505;color:#f4f4f5;font-family:Inter,Segoe UI,Arial,sans-serif}
    main{width:min(980px,calc(100vw - 32px));margin:32px auto}
    .hero{border:1px solid rgba(255,213,0,.25);border-radius:14px;background:linear-gradient(135deg,rgba(24,24,27,.96),rgba(8,8,12,.98));padding:24px;box-shadow:0 0 44px rgba(255,213,0,.08)}
    h1{margin:0;font-size:26px}.meta{margin-top:10px;color:#a1a1aa;line-height:1.7}.list{margin-top:18px;display:grid;gap:12px}
    .msg{border:1px solid #27272a;border-radius:12px;background:#09090b;padding:14px}.msg header{display:flex;justify-content:space-between;gap:12px;color:#d4d4d8}.msg header span{color:#71717a;font-size:12px}
    .msg p{color:#e4e4e7;line-height:1.55}.msg a{color:#fde047}ul{margin-bottom:0}
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <h1>Transcript de Vendas</h1>
      <div class="meta">
        Ticket: ${escapeHtml(result.ticket?.id ?? transcript.ticketId)}<br>
        Tipo: ${escapeHtml(result.ticket?.typeName ?? "Vendas")}<br>
        Mensagens: ${transcript.messageCount}<br>
        Criado em: ${escapeHtml(formatTranscriptDate(transcript.createdAt.toISOString()))}
      </div>
    </section>
    <section class="list">${messages || `<article class="msg"><p>Nenhuma mensagem registrada.</p></article>`}</section>
  </main>
</body>
</html>`;
}

function formatTranscriptDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

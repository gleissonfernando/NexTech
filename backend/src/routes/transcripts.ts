import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot } from "../middleware/auth";
import { canManageDashboardGuild } from "../services/dashboardGuildAccessService";
import { canUseDevBotModule } from "../services/devBotService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import {
  createNewTemporaryPassword,
  createTranscript,
  getTranscriptForExport,
  getTranscriptPublicMeta,
  renderTranscriptHtml,
  renderTranscriptText,
  revokeTranscriptTemporaryPasswords,
  softDeleteTranscript,
  validateTranscriptPassword
} from "../services/transcriptService";

const createTranscriptSchema = z.object({
  botId: z.string().optional().nullable(),
  guildId: z.string().min(1),
  guildName: z.string().optional().nullable(),
  ticketId: z.string().optional().nullable(),
  channelId: z.string().optional().nullable(),
  channelName: z.string().optional().nullable(),
  type: z.enum(["Denuncia", "Ticket", "Canal Temporario", "Suporte", "Outro"]).optional(),
  categoryName: z.string().optional().nullable(),
  openedById: z.string().optional().nullable(),
  ownerId: z.string().optional().nullable(),
  responsibleUserId: z.string().optional().nullable(),
  closedById: z.string().optional().nullable(),
  closeReason: z.string().optional().nullable(),
  openReason: z.string().optional().nullable(),
  finalResult: z.string().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
  rolesInvolved: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  status: z.enum(["Finalizado", "Incompleto"]).optional(),
  isPartial: z.boolean().optional(),
  partialReason: z.string().optional().nullable(),
  createdAt: z.string().optional().nullable(),
  closedAt: z.string().optional().nullable(),
  temporaryPasswordTtlHours: z.number().optional().nullable(),
  generateTemporaryPassword: z.boolean().optional(),
  participants: z.array(z.object({ id: z.string().nullable(), name: z.string(), role: z.string().nullable() })).optional(),
  messages: z.array(z.object({
    id: z.string(),
    authorAvatarUrl: z.string().optional().nullable().default(null),
    authorId: z.string().optional().nullable().default(null),
    authorName: z.string(),
    authorRoleIds: z.array(z.string()).optional().default([]),
    content: z.string(),
    attachments: z.array(z.object({
      contentType: z.string().optional().nullable().default(null),
      id: z.string(),
      name: z.string(),
      size: z.number(),
      url: z.string()
    })).optional().default([]),
    embeds: z.array(z.unknown()).optional().default([]),
    createdAt: z.string(),
    editedAt: z.string().optional().nullable(),
    system: z.boolean().optional(),
    anonymous: z.boolean().optional(),
    botRelayed: z.boolean().optional()
  })).optional(),
  events: z.array(z.object({
    authorId: z.string().optional().nullable(),
    content: z.string(),
    eventType: z.string(),
    metadata: z.record(z.unknown()).optional(),
    createdAt: z.string().optional().nullable()
  })).optional()
});

export const publicTranscriptsRouter = Router();
export const transcriptsRouter = Router();

publicTranscriptsRouter.get("/:id", async (req, res, next) => {
  try {
    const meta = await getTranscriptPublicMeta(req.params.id);
    if (!meta) {
      return res.status(404).send(renderLoginPage(null, "Transcript nao encontrado."));
    }
    return res.send(renderLoginPage(meta));
  } catch (error) {
    return next(error);
  }
});

publicTranscriptsRouter.post("/:id", async (req, res, next) => {
  try {
    const password = typeof req.body.password === "string" ? req.body.password : "";
    const result = await validateTranscriptPassword(req.params.id, password, {
      ip: req.ip,
      userAgent: req.get("user-agent")
    });

    if (!result.ok) {
      const meta = await getTranscriptPublicMeta(req.params.id);
      return res.status(result.status).send(renderLoginPage(meta, result.message));
    }

    return res.send(renderTranscriptHtml(
      result.transcript,
      result.accessType === "master" ? "Mestre" : "Temporária",
      result.temporaryPasswordExpiresAt
    ));
  } catch (error) {
    return next(error);
  }
});

publicTranscriptsRouter.get("/:id/export.:format", async (req, res, next) => {
  try {
    if (req.query.token !== "session") {
      return res.status(401).send("Senha obrigatoria.");
    }

    const transcript = await getTranscriptForExport(req.params.id);
    if (!transcript) return res.status(404).send("Transcript nao encontrado.");

    const format = req.params.format;
    const fileBase = `transcript-${transcript._id}`;

    if (format === "txt") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fileBase}.txt"`);
      return res.send(transcript.textContent || renderTranscriptText(transcript));
    }

    if (format === "pdf") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fileBase}.html"`);
      return res.send(renderTranscriptHtml(transcript, "Protegido"));
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileBase}.html"`);
    return res.send(renderTranscriptHtml(transcript, "Protegido"));
  } catch (error) {
    return next(error);
  }
});

transcriptsRouter.use(requireAuthOrBot);

transcriptsRouter.post("/bot", async (req, res, next) => {
  try {
    if (!isBotRequest(req)) {
      return res.status(403).json({ message: "Rota disponivel apenas para o bot." });
    }
    const botId = await resolveRequestBotId(req);
    const input = createTranscriptSchema.parse({ ...req.body, botId });
    const result = await createTranscript(input);
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

transcriptsRouter.post("/bot/:id/passwords", async (req, res, next) => {
  try {
    if (!isBotRequest(req)) {
      return res.status(403).json({ message: "Rota disponivel apenas para o bot." });
    }
    const ttlHours = Number(req.body?.ttlHours ?? 72);
    const result = await createNewTemporaryPassword(req.params.id, ttlHours);
    if (!result) return res.status(404).json({ message: "Transcript nao encontrado." });
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

transcriptsRouter.post("/:id/passwords", async (req, res, next) => {
  try {
    if (!(await canManageTranscript(req))) {
      return res.status(403).json({ message: "Sem permissao para alterar este transcript." });
    }
    const ttlHours = Number(req.body?.ttlHours ?? 72);
    const result = await createNewTemporaryPassword(req.params.id, ttlHours);
    if (!result) return res.status(404).json({ message: "Transcript nao encontrado." });
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

transcriptsRouter.post("/bot/:id/passwords/revoke", async (req, res, next) => {
  try {
    if (!isBotRequest(req)) {
      return res.status(403).json({ message: "Rota disponivel apenas para o bot." });
    }
    await revokeTranscriptTemporaryPasswords(req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

transcriptsRouter.post("/:id/passwords/revoke", async (req, res, next) => {
  try {
    if (!(await canManageTranscript(req))) {
      return res.status(403).json({ message: "Sem permissao para alterar este transcript." });
    }
    await revokeTranscriptTemporaryPasswords(req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

transcriptsRouter.delete("/bot/:id", async (req, res, next) => {
  try {
    if (!isBotRequest(req)) {
      return res.status(403).json({ message: "Rota disponivel apenas para o bot." });
    }
    const transcript = await softDeleteTranscript(req.params.id);
    if (!transcript) return res.status(404).json({ message: "Transcript nao encontrado." });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

transcriptsRouter.delete("/:id", async (req, res, next) => {
  try {
    if (!(await canManageTranscript(req))) {
      return res.status(403).json({ message: "Sem permissao para excluir este transcript." });
    }
    const transcript = await softDeleteTranscript(req.params.id);
    if (!transcript) return res.status(404).json({ message: "Transcript nao encontrado." });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

async function canManageTranscript(req: Request) {
  if (isBotRequest(req)) return true;
  const transcriptId = req.params.id;
  if (!transcriptId) return false;
  const transcript = await getTranscriptForExport(transcriptId);
  const user = req.res?.locals.dashboardAuth.user;
  if (!transcript || !user) return false;
  const botId = await resolveRequestBotId(req);
  return botId
    ? canUseDevBotModule(user, botId, transcript.guildId, "logs")
    : canManageDashboardGuild(user, transcript.guildId);
}

function renderLoginPage(meta: Awaited<ReturnType<typeof getTranscriptPublicMeta>>, message?: string) {
  const statusMessage = message ? `<p class="error">${escapeHtml(message)}</p>` : "";
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="robots" content="noindex, nofollow" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Acesso ao Transcript</title>
  <style>
    :root{color-scheme:dark;--bg:#070707;--panel:#111113;--line:#2f2f35;--text:#f4f4f5;--muted:#a1a1aa;--gold:#f2b84b}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at top,#1b1b20 0,#070707 45%);color:var(--text);font-family:Inter,Segoe UI,Arial,sans-serif;padding:18px}
    main{width:min(480px,100%);background:linear-gradient(135deg,#151518,#0b0b0c);border:1px solid var(--line);border-left:5px solid var(--gold);border-radius:10px;padding:26px;box-shadow:0 20px 60px rgba(0,0,0,.35)}
    .eyebrow{color:var(--gold);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}h1{font-size:27px;margin:6px 0 12px}p{color:var(--muted);margin:8px 0}label{display:block;margin:18px 0 8px;font-weight:700}
    input{width:100%;padding:13px;border-radius:7px;border:1px solid #3f3f46;background:#09090b;color:#fff;outline:none}input:focus{border-color:var(--gold);box-shadow:0 0 0 3px rgba(242,184,75,.16)}
    button{width:100%;margin-top:14px;padding:13px;border:0;border-radius:7px;background:var(--gold);color:#171717;font-weight:800;cursor:pointer}
    .meta{border-top:1px solid var(--line);margin-top:20px;padding-top:14px}.meta p{display:flex;justify-content:space-between;gap:12px}.error{color:#fecaca;background:#7f1d1d;border:1px solid #ef4444;padding:10px;border-radius:7px}
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">North Police Department - Logs</div>
    <h1>🔐 Acesso ao Transcript</h1>
    <p>Este registro e protegido por senha. Todas as tentativas de acesso sao registradas para auditoria.</p>
    <p>Digite a senha autorizada para visualizar o historico completo deste atendimento.</p>
    ${statusMessage}
    <form method="post">
      <label for="password">Senha</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
      <button type="submit">Entrar no Transcript</button>
    </form>
    <div class="meta">
      <p>ID do transcript: ${escapeHtml(meta?.id ?? "-")}</p>
      <p>Status: Protegido</p>
      <p>Data de geração: ${escapeHtml(meta?.generatedAt ?? "-")}</p>
      <p>Tipo: ${escapeHtml(meta?.type ?? "-")}</p>
    </div>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char] ?? char));
}

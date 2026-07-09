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
    const input = createTranscriptSchema.parse(req.body);
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
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#e5e7eb;font-family:Arial,sans-serif}
    main{width:min(440px,calc(100vw - 32px));background:#111827;border:1px solid #334155;border-radius:8px;padding:24px}
    h1{font-size:24px;margin:0 0 14px}label{display:block;margin:18px 0 8px}
    input{box-sizing:border-box;width:100%;padding:12px;border-radius:6px;border:1px solid #475569;background:#020617;color:#fff}
    button{width:100%;margin-top:14px;padding:12px;border:0;border-radius:6px;background:#2563eb;color:#fff;font-weight:700}
    .meta{border-top:1px solid #334155;margin-top:18px;padding-top:14px;color:#cbd5e1}.error{color:#fecaca;background:#7f1d1d;padding:10px;border-radius:6px}
  </style>
</head>
<body>
  <main>
    <h1>Acesso ao Transcript</h1>
    <p>Este transcript é protegido por senha.</p>
    <p>Digite a senha de acesso para visualizar o histórico completo deste atendimento.</p>
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

import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { APP_BASE_URL, buildTranscriptUrl } from "../config/appUrl";
import { env } from "../config/env";
import { getMongoCollections, type MongoTicket, type MongoTranscript, type MongoTranscriptAccessLog, type MongoTranscriptMessage } from "../database/mongo";
import { emitRealtime } from "../realtime/events";

const HASH_ITERATIONS = 120_000;
const HASH_KEY_LENGTH = 32;
const HASH_DIGEST = "sha256";
const DEFAULT_TEMP_PASSWORD_TTL_HOURS = 72;
const TEMP_PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

export type TranscriptInput = {
  botId?: string | null;
  guildId: string;
  guildName?: string | null;
  ticketId?: string | null;
  channelId?: string | null;
  channelName?: string | null;
  type?: MongoTranscript["type"];
  categoryName?: string | null;
  openedById?: string | null;
  ownerId?: string | null;
  responsibleUserId?: string | null;
  closedById?: string | null;
  closeReason?: string | null;
  finalResult?: string | null;
  internalNotes?: string | null;
  openReason?: string | null;
  rolesInvolved?: string[];
  metadata?: Record<string, unknown>;
  status?: MongoTranscript["status"];
  isPartial?: boolean;
  partialReason?: string | null;
  createdAt?: string | Date | null;
  closedAt?: string | Date | null;
  temporaryPasswordTtlHours?: number | null;
  generateTemporaryPassword?: boolean;
  participants?: MongoTranscript["participants"];
  messages?: Array<Omit<MongoTranscriptMessage, "createdAt" | "editedAt"> & { createdAt: string | Date; editedAt?: string | Date | null }>;
  events?: Array<{ authorId?: string | null; content: string; eventType: string; metadata?: Record<string, unknown>; createdAt?: string | Date | null }>;
};

export type TranscriptAccessResult =
  | { ok: true; accessType: "temporary" | "master"; message: string; transcript: MongoTranscript; temporaryPasswordExpiresAt: string | null }
  | { ok: false; status: 401 | 410; message: string; reason: string };

export async function createTranscript(input: TranscriptInput) {
  const collections = await getMongoCollections();
  const now = new Date();
  const transcriptId = `TR-${randomUUID().slice(0, 8).toUpperCase()}`;
  const publicUrl = buildTranscriptPublicUrl(transcriptId);
  const temporaryPassword = input.generateTemporaryPassword === false ? null : generateTemporaryPassword();
  const expiresAt = temporaryPassword
    ? new Date(now.getTime() + Math.max(1, input.temporaryPasswordTtlHours ?? DEFAULT_TEMP_PASSWORD_TTL_HOURS) * 60 * 60 * 1000)
    : null;
  const normalizedMessages = (input.messages ?? []).map((message) => ({
    ...message,
    authorAvatarUrl: message.authorAvatarUrl ?? null,
    authorId: message.authorId ?? null,
    authorRoleIds: message.authorRoleIds ?? [],
    attachments: message.attachments ?? [],
    embeds: message.embeds ?? [],
    createdAt: toDate(message.createdAt) ?? now,
    editedAt: toDate(message.editedAt) ?? null
  }));
  const attachments = normalizedMessages.flatMap((message) => message.attachments);
  const transcript: MongoTranscript = {
    _id: transcriptId,
    ticketId: input.ticketId ?? null,
    guildId: input.guildId,
    botId: normalizeBotId(input.botId),
    ownerId: input.ownerId ?? input.openedById ?? null,
    channelId: input.channelId ?? null,
    channelName: input.channelName ?? null,
    guildName: input.guildName ?? null,
    type: input.type ?? "Ticket",
    categoryName: input.categoryName ?? null,
    htmlPath: `/transcripts/${encodeURIComponent(transcriptId)}`,
    pdfPath: null,
    txtPath: `/transcripts/${encodeURIComponent(transcriptId)}/export.txt`,
    htmlContent: "",
    textContent: "",
    websiteUrl: null,
    status: input.status ?? (input.isPartial ? "Incompleto" : "Finalizado"),
    createdAt: toDate(input.createdAt) ?? now,
    closedAt: toDate(input.closedAt) ?? now,
    expiresAt,
    isPartial: Boolean(input.isPartial),
    partialReason: input.partialReason ?? null,
    accessCount: 0,
    openedById: input.openedById ?? null,
    responsibleUserId: input.responsibleUserId ?? null,
    closedById: input.closedById ?? null,
    closeReason: input.closeReason ?? null,
    openReason: input.openReason ?? null,
    finalResult: input.finalResult ?? null,
    internalNotes: input.internalNotes ?? null,
    rolesInvolved: input.rolesInvolved ?? [],
    metadata: input.metadata ?? {},
    participants: input.participants ?? [],
    messages: normalizedMessages,
    attachments,
    events: (input.events ?? []).map((event) => ({
      authorId: event.authorId ?? null,
      content: event.content,
      eventType: event.eventType,
      metadata: event.metadata ?? {},
      createdAt: toDate(event.createdAt) ?? now
    }))
  };

  transcript.htmlContent = renderTranscriptHtml(transcript, "Protegido");
  transcript.textContent = renderTranscriptText(transcript);
  await collections.transcripts.insertOne(transcript);

  if (temporaryPassword) {
    await collections.transcriptPasswords.insertOne({
      _id: randomUUID(),
      transcriptId,
      passwordHash: hashSecret(temporaryPassword),
      type: "temporary",
      expiresAt,
      revokedAt: null,
      createdAt: now
    });
  }

  if (input.ticketId) {
    await collections.tickets.updateOne(
      { _id: input.ticketId },
      {
        $set: {
          closedAt: transcript.closedAt,
          closedById: transcript.closedById,
          closeReason: transcript.closeReason,
          finalResult: transcript.finalResult,
          internalNotes: transcript.internalNotes,
          isIncomplete: transcript.isPartial,
          status: transcript.isPartial ? "INCOMPLETE" : "CLOSED"
        }
      }
    );
  }

  const summary = publicTranscriptSummary(transcript);
  emitRealtime("transcripts:new", summary);
  return { publicUrl, transcript: summary, temporaryPassword, temporaryPasswordExpiresAt: expiresAt?.toISOString() ?? null };
}

export function buildTranscriptPublicUrl(transcriptId: string) {
  return buildTranscriptUrl(transcriptId);
}

export function resolveTranscriptPublicBaseUrl() {
  const configured = APP_BASE_URL;

  if (configured) {
    if (env.NODE_ENV === "production" && isLocalUrl(configured)) {
      throw new Error("TRANSCRIPT_BASE_URL nao pode ser localhost/127.0.0.1 em producao. Configure um dominio publico.");
    }
    return normalizeTranscriptPublicBaseUrl(configured);
  }

  if (env.NODE_ENV !== "production") {
    return `http://localhost:${env.TRANSCRIPT_PORT || env.PORT}`;
  }

  throw new Error("TRANSCRIPT_BASE_URL ausente. Configure o dominio publico para gerar links de transcript.");
}

function normalizeTranscriptPublicBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function normalizeTranscriptPublicUrl(_value: string | null | undefined, transcriptId: string) {
  return buildTranscriptPublicUrl(transcriptId);
}

export function getTranscriptStartupStatus() {
  try {
    const baseUrl = resolveTranscriptPublicBaseUrl();
    return {
      ok: true,
      baseUrl,
      route: `${baseUrl}/transcripts/:id`,
      port: env.TRANSCRIPT_PORT || env.PORT
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      port: env.TRANSCRIPT_PORT || env.PORT
    };
  }
}

export async function getTranscriptForExport(transcriptId: string) {
  const { transcripts } = await getMongoCollections();
  return transcripts.findOne({ _id: transcriptId, $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] });
}

export async function softDeleteTranscript(transcriptId: string) {
  const { transcripts, transcriptPasswords } = await getMongoCollections();
  await transcriptPasswords.updateMany({ transcriptId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  const result = await transcripts.findOneAndUpdate(
    { _id: transcriptId },
    { $set: { deletedAt: new Date(), status: "Incompleto" } },
    { returnDocument: "after" }
  );
  return result;
}

export async function getTranscriptPublicMeta(transcriptId: string) {
  const { transcripts } = await getMongoCollections();
  const transcript = await transcripts.findOne({ _id: transcriptId });
  if (!transcript) return null;

  return {
    id: transcript._id,
    status: "Protegido",
    generatedAt: transcript.createdAt.toISOString(),
    type: transcript.type,
    isPartial: transcript.isPartial
  };
}

export async function validateTranscriptPassword(transcriptId: string, password: string, request: { ip?: string | null; userAgent?: string | null }): Promise<TranscriptAccessResult> {
  const collections = await getMongoCollections();
  const transcript = await collections.transcripts.findOne({ _id: transcriptId });

  if (!transcript) {
    return { ok: false, status: 401, message: "Senha inválida ou expirada. Verifique a senha e tente novamente.", reason: "not_found" };
  }

  const now = new Date();
  const masterValid = isMasterPasswordValid(password);
  if (masterValid) {
    await registerAccess(transcript, "master", true, "master_valid", request);
    await collections.transcripts.updateOne({ _id: transcriptId }, { $inc: { accessCount: 1 } });
    return {
      ok: true,
      accessType: "master",
      message: "Senha mestre validada. Acesso liberado ao transcript.",
      transcript,
      temporaryPasswordExpiresAt: transcript.expiresAt?.toISOString() ?? null
    };
  }

  const passwords = await collections.transcriptPasswords.find({ transcriptId, type: "temporary" }).sort({ createdAt: -1 }).toArray();
  const matched = passwords.find((row) => verifySecret(password, row.passwordHash));

  if (!matched) {
    await registerAccess(transcript, "unknown", false, "invalid_password", request);
    return { ok: false, status: 401, message: "Senha inválida ou expirada. Verifique a senha e tente novamente.", reason: "invalid" };
  }

  if (matched.revokedAt) {
    await registerAccess(transcript, "temporary", false, "revoked_password", request);
    return { ok: false, status: 401, message: "Senha inválida ou expirada. Verifique a senha e tente novamente.", reason: "revoked" };
  }

  if (matched.expiresAt && matched.expiresAt <= now) {
    await registerAccess(transcript, "temporary", false, "expired_password", request);
    return { ok: false, status: 410, message: "Esta senha temporária expirou. Solicite uma nova senha para a equipe responsável.", reason: "expired" };
  }

  await registerAccess(transcript, "temporary", true, "temporary_valid", request);
  await collections.transcripts.updateOne({ _id: transcriptId }, { $inc: { accessCount: 1 } });
  return { ok: true, accessType: "temporary", message: "Acesso liberado ao transcript.", transcript, temporaryPasswordExpiresAt: matched.expiresAt?.toISOString() ?? null };
}

export async function revokeTranscriptTemporaryPasswords(transcriptId: string) {
  const { transcriptPasswords } = await getMongoCollections();
  await transcriptPasswords.updateMany({ transcriptId, type: "temporary", revokedAt: null }, { $set: { revokedAt: new Date() } });
}

export async function createNewTemporaryPassword(transcriptId: string, ttlHours = DEFAULT_TEMP_PASSWORD_TTL_HOURS) {
  const collections = await getMongoCollections();
  const transcript = await collections.transcripts.findOne({ _id: transcriptId });
  if (!transcript) return null;

  const password = generateTemporaryPassword();
  const expiresAt = new Date(Date.now() + Math.max(1, ttlHours) * 60 * 60 * 1000);
  await collections.transcriptPasswords.insertOne({
    _id: randomUUID(),
    transcriptId,
    passwordHash: hashSecret(password),
    type: "temporary",
    expiresAt,
    revokedAt: null,
    createdAt: new Date()
  });
  await collections.transcripts.updateOne({ _id: transcriptId }, { $set: { expiresAt } });
  return { password, expiresAt: expiresAt.toISOString() };
}

export function renderTranscriptHtml(transcript: MongoTranscript, passwordType: "Temporária" | "Mestre" | "Protegido", temporaryPasswordExpiresAt?: string | null) {
  const duration = formatDuration(transcript.createdAt, transcript.closedAt);
  const status = statusBadge(transcript.status);
  const ticketId = transcript.ticketId ?? transcript._id;
  const messages = transcript.messages.map((message) => {
    const flags = [
      message.system ? "Sistema" : null,
      message.anonymous ? "Anonimo" : null,
      message.botRelayed ? "Reenviado pelo bot" : null
    ].filter(Boolean);
    return `
    <article class="message">
      <div class="message-head">
        <div>
          <strong>${escapeHtml(message.authorName)}</strong>
          ${flags.length ? `<span class="chips">${flags.map((flag) => `<span>${escapeHtml(String(flag))}</span>`).join("")}</span>` : ""}
        </div>
        <time>${formatDate(message.createdAt)}</time>
      </div>
      <p>${escapeHtml(message.content || "(sem texto)")}</p>
      ${message.attachments.map((attachment) => renderAttachment(attachment)).join("")}
    </article>`;
  }).join("");
  const events = transcript.events.map((event) => `<li><span>${formatDate(event.createdAt)}</span>${escapeHtml(event.content)}</li>`).join("");
  const participants = transcript.participants.map((participant) => `<li><strong>${escapeHtml(participant.name)}</strong>${participant.role ? `<span>${escapeHtml(participant.role)}</span>` : ""}</li>`).join("");
  const attachments = transcript.attachments.map((attachment) => `<li><a href="${escapeAttribute(attachment.url)}" target="_blank" rel="noreferrer">${escapeHtml(attachment.name)}</a><span>${formatBytes(attachment.size)}</span></li>`).join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="robots" content="noindex, nofollow" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Transcript ${escapeHtml(ticketId)}</title>
  <style>
    :root{color-scheme:dark;--bg:#070707;--panel:#111113;--panel2:#18181b;--line:#2f2f35;--text:#f4f4f5;--muted:#a1a1aa;--gold:#f2b84b;--gold2:#8a6424;--danger:#ef4444}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#1b1b20 0,#070707 42%);color:var(--text);font-family:Inter,Segoe UI,Arial,sans-serif;line-height:1.5}
    main{max-width:1120px;margin:0 auto;padding:28px 18px 44px}
    header{border:1px solid var(--line);border-left:5px solid var(--gold);border-radius:10px;background:linear-gradient(135deg,#141416,#0b0b0c);padding:24px;margin-bottom:18px}
    .eyebrow{color:var(--gold);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}
    h1{font-size:30px;margin:6px 0 8px}h2{font-size:18px;margin:0 0 14px}.lead{color:var(--muted);margin:0;max-width:760px}
    section{border:1px solid var(--line);border-radius:10px;background:rgba(17,17,19,.88);padding:18px;margin-top:14px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}.box{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:13px}
    .box span,.list span,time{display:block;color:var(--muted);font-size:12px}.box strong{display:block;margin-top:3px;word-break:break-word}.status{color:var(--gold)}
    .warning{background:#251806;border-color:var(--gold2)}.warning h2{color:var(--gold)}
    .message{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:14px;margin-bottom:10px}.message-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.message p{white-space:pre-wrap;margin:10px 0 0}
    .chips{display:inline-flex;gap:6px;flex-wrap:wrap;margin-left:8px}.chips span{display:inline-block;border:1px solid var(--gold2);color:var(--gold);border-radius:999px;padding:1px 7px;font-size:11px}
    .attachment{display:block;margin-top:10px;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#0d0d0f}.attachment img{display:block;max-width:100%;height:auto}.attachment a{display:block;padding:10px}
    .list{list-style:none;padding:0;margin:0;display:grid;gap:8px}.list li{display:flex;justify-content:space-between;gap:12px;border:1px solid var(--line);border-radius:8px;background:var(--panel2);padding:10px}
    a{color:#f7d98a}.actions{display:flex;gap:10px;flex-wrap:wrap}.actions button,.actions a{background:var(--gold);color:#171717;border:0;border-radius:7px;padding:10px 12px;text-decoration:none;font-weight:700;cursor:pointer}
    @media(max-width:640px){main{padding:14px 10px 30px}header,section{border-radius:8px}.message-head,.list li{display:block}h1{font-size:24px}}
  </style>
</head>
<body>
<main>
  <header>
    <div class="eyebrow">North Police Department - Sistema de Logs</div>
    <h1>📁 Transcript Gerado</h1>
    <p class="lead">O registro completo deste atendimento foi salvo com seguranca. O acesso e protegido por senha e todos os acessos sao registrados para auditoria.</p>
  </header>
  ${transcript.isPartial ? `<section class="warning"><h2>Transcript Parcial</h2><p>Este transcript pode estar incompleto porque o ticket foi interrompido antes do encerramento normal.</p><p>Motivo: ${escapeHtml(transcript.partialReason ?? "indisponivel")}</p></section>` : ""}
  <section>
    <h2>Informacoes do Ticket</h2>
    <div class="grid">
      ${infoBox("Ticket", ticketId)}
      ${infoBox("Canal", transcript.channelName ? `#${transcript.channelName}` : "-")}
      ${infoBox("Tipo", transcript.type)}
      ${infoBox("Status", status)}
      ${infoBox("Servidor", transcript.guildName ?? transcript.guildId)}
      ${infoBox("Categoria/Orgao", transcript.categoryName ?? "-")}
    </div>
  </section>
  <section>
    <h2>Dados do Caso</h2>
    <div class="grid">
      ${infoBox("Aberto por", formatUser(transcript.openedById))}
      ${infoBox("Responsavel", formatUser(transcript.responsibleUserId))}
      ${infoBox("Criado em", formatDate(transcript.createdAt))}
      ${infoBox("Finalizado em", transcript.closedAt ? formatDate(transcript.closedAt) : "-")}
      ${infoBox("Tempo total", duration)}
      ${infoBox("Motivo/resultado", transcript.closeReason ?? transcript.finalResult ?? "-")}
    </div>
  </section>
  <section>
    <h2>Seguranca</h2>
    <div class="grid">
      ${infoBox("Protecao", "Senha obrigatoria")}
      ${infoBox("Senha usada", passwordType)}
      ${infoBox("Expira em", temporaryPasswordExpiresAt ? formatDate(new Date(temporaryPasswordExpiresAt)) : transcript.expiresAt ? formatDate(transcript.expiresAt) : "-")}
      ${infoBox("Acessos registrados", String(transcript.accessCount ?? 0))}
    </div>
  </section>
  <section><h2>Participantes</h2><ul class="list">${participants || "<li>Nenhum participante registrado.</li>"}</ul></section>
  <section><h2>Conversa Completa</h2>${messages || "<p>Nenhuma mensagem registrada.</p>"}</section>
  <section><h2>Anexos</h2><ul class="list">${attachments || "<li>Nenhum anexo registrado.</li>"}</ul></section>
  <section><h2>Acoes Administrativas</h2><ul class="list">${events || "<li>Nenhuma acao registrada.</li>"}</ul></section>
  <section class="actions">
    <button onclick="navigator.clipboard.writeText('${escapeAttribute(transcript._id)}')">Copiar ID</button>
    <button onclick="navigator.clipboard.writeText(location.href)">Copiar link</button>
    <a href="/transcripts/${encodeURIComponent(transcript._id)}/export.html?token=session" download>Exportar HTML</a>
    <a href="/transcripts/${encodeURIComponent(transcript._id)}/export.txt?token=session" download>Exportar TXT</a>
    <a href="/transcripts/${encodeURIComponent(transcript._id)}/export.pdf?token=session" download>Exportar PDF</a>
    <a href="/dashboard">Voltar para painel de logs</a>
  </section>
</main>
</body>
</html>`;
}

export function renderTranscriptText(transcript: MongoTranscript) {
  const header = [
    "LOG DO SISTEMA",
    `Modulo: ${transcript.type}`,
    `Caso: ${transcript.ticketId ?? transcript._id}`,
    `Status: ${transcript.status}`,
    `Canal: ${transcript.channelName ?? "-"}`,
    `Categoria/Orgao: ${transcript.categoryName ?? "-"}`,
    `Aberto por: ${formatUser(transcript.openedById)}`,
    `Responsavel: ${formatUser(transcript.responsibleUserId)}`,
    `Aberto em: ${formatDate(transcript.createdAt)}`,
    `Finalizado em: ${transcript.closedAt ? formatDate(transcript.closedAt) : "-"}`,
    `Tempo total: ${formatDuration(transcript.createdAt, transcript.closedAt)}`,
    `Mensagens registradas: ${transcript.messages.length}`,
    `Anexos registrados: ${transcript.attachments.length}`,
    `Participantes registrados: ${transcript.participants.length}`,
    `Motivo/resultado: ${transcript.closeReason ?? transcript.finalResult ?? "-"}`,
    ""
  ];
  const messages = transcript.messages.map((message) => {
    const flags = [message.system ? "sistema" : null, message.anonymous ? "anonimo" : null, message.botRelayed ? "bot" : null].filter(Boolean).join(", ");
    return `[${formatDate(message.createdAt)}] ${message.authorName}${flags ? ` (${flags})` : ""}: ${message.content || "(sem texto)"}`;
  });
  const events = transcript.events.map((event) => `[${formatDate(event.createdAt)}] ${event.eventType}: ${event.content}`);
  return [...header, "MENSAGENS", ...messages, "", "ACOES DO SISTEMA", ...events].join("\n");
}

function infoBox(label: string, value: string) {
  return `<div class="box"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function statusBadge(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes("final")) return `🟢 ${status}`;
  if (normalized.includes("arquiv")) return `⚫ ${status}`;
  if (normalized.includes("pend")) return `🟡 ${status}`;
  if (normalized.includes("recus") || normalized.includes("neg")) return `🔴 ${status}`;
  if (normalized.includes("incompleto")) return `🟠 ${status}`;
  return `🔒 ${status}`;
}

function formatDuration(start: Date, end: Date | null) {
  if (!end) return "-";
  const diffMs = Math.max(0, end.getTime() - start.getTime());
  const totalMinutes = Math.max(1, Math.round(diffMs / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return [
    days ? `${days}d` : null,
    hours ? `${hours}h` : null,
    minutes ? `${minutes}min` : null
  ].filter(Boolean).join(" ") || "menos de 1min";
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function renderAttachment(attachment: MongoTranscript["attachments"][number]) {
  const isImage = attachment.contentType?.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(attachment.url);
  return `<div class="attachment">
    ${isImage ? `<img src="${escapeAttribute(attachment.url)}" alt="${escapeAttribute(attachment.name)}" loading="lazy" />` : ""}
    <a href="${escapeAttribute(attachment.url)}" target="_blank" rel="noreferrer">${escapeHtml(attachment.name)}${attachment.size ? ` - ${formatBytes(attachment.size)}` : ""}</a>
  </div>`;
}

function publicTranscriptSummary(transcript: MongoTranscript) {
  return {
    id: transcript._id,
    botId: transcript.botId,
    guildId: transcript.guildId,
    ticketId: transcript.ticketId,
    type: transcript.type,
    status: transcript.status,
    isPartial: transcript.isPartial,
    htmlPath: transcript.htmlPath,
    publicUrl: normalizeTranscriptPublicUrl(transcript.websiteUrl, transcript._id),
    createdAt: transcript.createdAt.toISOString(),
    closedAt: transcript.closedAt?.toISOString() ?? null,
    expiresAt: transcript.expiresAt?.toISOString() ?? null,
    channelId: transcript.channelId,
    channelName: transcript.channelName,
    categoryName: transcript.categoryName,
    messageCount: transcript.messages.length,
    attachmentCount: transcript.attachments.length,
    participantCount: transcript.participants.length
  };
}

function isLocalUrl(value: string) {
  try {
    const url = new URL(value);
    return LOCAL_HOSTS.has(url.hostname);
  } catch {
    return /(?:\/\/|@)(localhost|127\.0\.0\.1|0\.0\.0\.0)(?::|\/|$)/i.test(value);
  }
}

async function registerAccess(transcript: MongoTranscript, accessType: MongoTranscriptAccessLog["accessType"], success: boolean, reason: string, request: { ip?: string | null; userAgent?: string | null }) {
  const { transcriptAccessLogs } = await getMongoCollections();
  const log: MongoTranscriptAccessLog = {
    _id: randomUUID(),
    transcriptId: transcript._id,
    guildId: transcript.guildId,
    botId: transcript.botId,
    accessType,
    success,
    reason,
    createdAt: new Date(),
    maskedIp: maskIp(request.ip),
    userAgent: request.userAgent?.slice(0, 300) ?? null
  };
  await transcriptAccessLogs.insertOne(log);
  emitRealtime("transcripts:access", { ...log, createdAt: log.createdAt.toISOString() });
}

function generateTemporaryPassword(length = 19) {
  const raw = Array.from({ length }, () => {
    const byte = randomBytes(1).at(0) ?? 0;
    return TEMP_PASSWORD_CHARS[byte % TEMP_PASSWORD_CHARS.length] ?? "x";
  }).join("");
  return `${raw.slice(0, 3)}-${raw.slice(3, 7)}-${raw.slice(7, 11)}-${raw.slice(11, 15)}-${raw.slice(15)}`;
}

function hashSecret(secret: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(secret, salt, HASH_ITERATIONS, HASH_KEY_LENGTH, HASH_DIGEST).toString("hex");
  return `pbkdf2$${HASH_ITERATIONS}$${salt}$${hash}`;
}

function verifySecret(secret: string, storedHash: string) {
  const [, iterationsRaw, salt, expectedHash] = storedHash.split("$");
  const iterations = Number(iterationsRaw);
  if (!iterations || !salt || !expectedHash) return false;
  const actual = pbkdf2Sync(secret, salt, iterations, Buffer.from(expectedHash, "hex").length, HASH_DIGEST);
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function isMasterPasswordValid(password: string) {
  if (env.MASTER_TRANSCRIPT_PASSWORD_HASH) {
    return verifySecret(password, env.MASTER_TRANSCRIPT_PASSWORD_HASH);
  }
  const expected = Buffer.from(env.MASTER_TRANSCRIPT_PASSWORD);
  const actual = Buffer.from(password);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function toDate(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeBotId(botId: string | null | undefined) {
  const normalized = botId?.trim();
  return normalized ? normalized : null;
}

function maskIp(value?: string | null) {
  if (!value) return null;
  if (value.includes(":")) return `${value.split(":").slice(0, 3).join(":")}:***`;
  const parts = value.split(".");
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.***` : "***";
}

function formatUser(userId: string | null) {
  return userId ? `@${userId}` : "-";
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(date);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char] ?? char));
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { env } from "../config/env";
import { getMongoCollections, type MongoTicket, type MongoTranscript, type MongoTranscriptAccessLog, type MongoTranscriptMessage } from "../database/mongo";
import { emitRealtime } from "../realtime/events";

const HASH_ITERATIONS = 120_000;
const HASH_KEY_LENGTH = 32;
const HASH_DIGEST = "sha256";
const DEFAULT_TEMP_PASSWORD_TTL_HOURS = 72;
const TEMP_PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_";

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

  emitRealtime("transcripts:new", publicTranscriptSummary(transcript));
  return { transcript: publicTranscriptSummary(transcript), temporaryPassword, temporaryPasswordExpiresAt: expiresAt?.toISOString() ?? null };
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
  const messages = transcript.messages.map((message) => `
    <article class="message">
      <div class="meta">[${formatDate(message.createdAt)}] ${escapeHtml(message.authorName)}</div>
      <p>${escapeHtml(message.content || "(sem texto)")}</p>
      ${message.attachments.map((attachment) => `<a class="attachment" href="${escapeAttribute(attachment.url)}" target="_blank" rel="noreferrer">${escapeHtml(attachment.name)}</a>`).join("")}
    </article>`).join("");
  const events = transcript.events.map((event) => `<li>${formatDate(event.createdAt)} - ${escapeHtml(event.content)}</li>`).join("");
  const participants = transcript.participants.map((participant) => `<li>${escapeHtml(participant.name)}${participant.role ? ` - ${escapeHtml(participant.role)}` : ""}</li>`).join("");
  const attachments = transcript.attachments.map((attachment) => `<li><a href="${escapeAttribute(attachment.url)}" target="_blank" rel="noreferrer">${escapeHtml(attachment.name)}</a></li>`).join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="robots" content="noindex, nofollow" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Transcript ${escapeHtml(transcript._id)}</title>
  <style>
    body{margin:0;background:#0f172a;color:#e5e7eb;font-family:Arial,sans-serif}
    main{max-width:980px;margin:0 auto;padding:32px 18px}
    section{border-top:1px solid #334155;padding:22px 0}
    h1,h2{margin:0 0 14px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
    .box,.message{background:#111827;border:1px solid #334155;border-radius:8px;padding:14px}
    .meta{color:#93c5fd;font-size:13px;margin-bottom:8px}
    .warning{background:#451a03;border-color:#f59e0b}
    a{color:#7dd3fc}.actions{display:flex;gap:10px;flex-wrap:wrap}.actions button,.actions a{background:#2563eb;color:white;border:0;border-radius:6px;padding:10px 12px;text-decoration:none}
  </style>
</head>
<body>
<main>
  ${transcript.isPartial ? `<section class="box warning"><h2>Transcript Parcial</h2><p>Este transcript pode estar incompleto porque o ticket foi interrompido antes do encerramento normal.</p><p>Motivo: ${escapeHtml(transcript.partialReason ?? "indisponível")}</p></section>` : ""}
  <section>
    <h1>Transcript do Atendimento</h1>
    <div class="grid">
      <div class="box">Tipo: ${escapeHtml(transcript.type)}</div>
      <div class="box">Status: ${escapeHtml(transcript.status)}</div>
      <div class="box">ID: ${escapeHtml(transcript._id)}</div>
      <div class="box">Canal: ${escapeHtml(transcript.channelName ?? "-")}</div>
      <div class="box">Servidor: ${escapeHtml(transcript.guildName ?? transcript.guildId)}</div>
      <div class="box">Aberto por: ${escapeHtml(formatUser(transcript.openedById))}</div>
      <div class="box">Responsável: ${escapeHtml(formatUser(transcript.responsibleUserId))}</div>
      <div class="box">Criado em: ${formatDate(transcript.createdAt)}</div>
      <div class="box">Finalizado em: ${transcript.closedAt ? formatDate(transcript.closedAt) : "-"}</div>
      <div class="box">Motivo de abertura: ${escapeHtml(transcript.openReason ?? "-")}</div>
      <div class="box">Motivo: ${escapeHtml(transcript.closeReason ?? "-")}</div>
      <div class="box">Senha usada: ${passwordType}</div>
      <div class="box">Validade temporária: ${temporaryPasswordExpiresAt ? formatDate(new Date(temporaryPasswordExpiresAt)) : "-"}</div>
    </div>
  </section>
  <section><h2>Participantes</h2><ul>${participants || "<li>Nenhum participante registrado.</li>"}</ul></section>
  <section><h2>Conversa Completa</h2>${messages || "<p>Nenhuma mensagem registrada.</p>"}</section>
  <section><h2>Anexos</h2><ul>${attachments || "<li>Nenhum anexo registrado.</li>"}</ul></section>
  <section><h2>Ações Administrativas</h2><ul>${events || "<li>Nenhuma ação registrada.</li>"}</ul></section>
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
    `Aberto por: ${formatUser(transcript.openedById)}`,
    `Responsavel: ${formatUser(transcript.responsibleUserId)}`,
    `Aberto em: ${formatDate(transcript.createdAt)}`,
    `Finalizado em: ${transcript.closedAt ? formatDate(transcript.closedAt) : "-"}`,
    `Mensagens registradas: ${transcript.messages.length}`,
    `Anexos registrados: ${transcript.attachments.length}`,
    ""
  ];
  const messages = transcript.messages.map((message) => {
    const flags = [message.system ? "sistema" : null, message.anonymous ? "anonimo" : null, message.botRelayed ? "bot" : null].filter(Boolean).join(", ");
    return `[${formatDate(message.createdAt)}] ${message.authorName}${flags ? ` (${flags})` : ""}: ${message.content || "(sem texto)"}`;
  });
  const events = transcript.events.map((event) => `[${formatDate(event.createdAt)}] ${event.eventType}: ${event.content}`);
  return [...header, "MENSAGENS", ...messages, "", "ACOES DO SISTEMA", ...events].join("\n");
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
    createdAt: transcript.createdAt.toISOString(),
    expiresAt: transcript.expiresAt?.toISOString() ?? null
  };
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

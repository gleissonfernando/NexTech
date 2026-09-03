import { createHash, pbkdf2Sync, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { APP_BASE_URL, TRANSCRIPT_BASE_URL, buildTranscriptUrl } from "../config/appUrl";
import { env } from "../config/env";
import { getMongoCollections, type MongoTicket, type MongoTranscript, type MongoTranscriptAccessLog, type MongoTranscriptMessage } from "../database/mongo";
import { emitRealtime } from "../realtime/events";
import { getGuildSettings, type TranscriptThemeDto } from "./settingsService";

const HASH_ITERATIONS = 120_000;
const HASH_KEY_LENGTH = 32;
const HASH_DIGEST = "sha256";
const TRANSCRIPT_TTL_DAYS = 365;
const DEFAULT_TEMP_PASSWORD_TTL_HOURS = TRANSCRIPT_TTL_DAYS * 24;
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
  transcriptLog("Iniciando geração", {
    channelId: input.channelId,
    guildId: input.guildId,
    ticketId: input.ticketId,
    transcriptId
  });
  const temporaryPassword = input.generateTemporaryPassword === false ? null : await generateUniqueTemporaryPassword(collections.transcriptPasswords);
  const transcriptExpiresAt = new Date(now.getTime() + TRANSCRIPT_TTL_DAYS * 24 * 60 * 60 * 1000);
  const temporaryPasswordExpiresAt = temporaryPassword ? transcriptExpiresAt : null;
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
  transcriptLog(`${normalizedMessages.length} mensagens coletadas`, {
    attachmentCount: attachments.length,
    guildId: input.guildId,
    transcriptId
  });
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
    expiresAt: transcriptExpiresAt,
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

  transcript.htmlContent = renderTranscriptHtml(transcript, "Protegido", null, await resolveTranscriptTheme(transcript));
  transcript.textContent = renderTranscriptText(transcript);
  transcriptLog("HTML e TXT gerados", {
    guildId: input.guildId,
    textBytes: Buffer.byteLength(transcript.textContent ?? "", "utf8"),
    transcriptId
  });
  await collections.transcripts.insertOne(transcript);
  transcriptLog("Registro salvo no MongoDB", {
    guildId: input.guildId,
    storageType: "mongodb",
    transcriptId
  });

  if (temporaryPassword) {
    await collections.transcriptPasswords.insertOne({
      _id: randomUUID(),
      transcriptId,
      passwordFingerprint: passwordFingerprint(temporaryPassword),
      passwordHash: hashSecret(temporaryPassword),
      type: "temporary",
      expiresAt: temporaryPasswordExpiresAt,
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
  transcriptLog("URL pública criada", {
    guildId: input.guildId,
    publicUrl,
    transcriptId
  });
  return { publicUrl, transcript: summary, temporaryPassword, temporaryPasswordExpiresAt: temporaryPasswordExpiresAt?.toISOString() ?? null };
}

export function buildTranscriptPublicUrl(transcriptId: string) {
  return buildTranscriptUrl(transcriptId);
}

export function resolveTranscriptPublicBaseUrl() {
  const configured = TRANSCRIPT_BASE_URL || APP_BASE_URL;

  if (configured) {
    if (env.NODE_ENV === "production" && isLocalUrl(configured)) {
      throw new Error("TRANSCRIPT_BASE_URL não pode ser localhost/127.0.0.1 em produção. Configure um domínio público.");
    }
    return normalizeTranscriptPublicBaseUrl(configured);
  }

  if (env.NODE_ENV !== "production") {
    return `http://localhost:${env.TRANSCRIPT_PORT || env.PORT}`;
  }

  throw new Error("TRANSCRIPT_BASE_URL ausente. Configure o domínio público para gerar links de transcript.");
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

export async function getTranscriptHealthStatus() {
  const baseUrl = resolveTranscriptPublicBaseUrl();
  const startedAt = Date.now();

  try {
    const { transcripts } = await getMongoCollections();
    await transcripts.findOne({}, { projection: { _id: 1 } });

    return {
      ok: true,
      status: "online",
      service: "nextech-transcript",
      baseUrl,
      route: `${baseUrl}/transcripts/:id`,
      database: "connected",
      storage: "mongodb",
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      ok: false,
      status: "degraded",
      service: "nextech-transcript",
      baseUrl,
      route: `${baseUrl}/transcripts/:id`,
      database: "error",
      storage: "mongodb",
      latencyMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : "Transcript indisponível",
      timestamp: new Date().toISOString()
    };
  }
}

export async function getTranscriptForExport(transcriptId: string) {
  const { transcripts } = await getMongoCollections();
  return transcripts.findOne({
    _id: transcriptId,
    $and: [
      { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] },
      { $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }
    ]
  });
}

export async function softDeleteTranscript(transcriptId: string) {
  const { transcripts, transcriptPasswords } = await getMongoCollections();
  await transcriptPasswords.updateMany({ transcriptId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  const result = await transcripts.findOneAndUpdate(
    { _id: transcriptId },
    { $set: { deletedAt: new Date(), status: "Excluído" } },
    { returnDocument: "after" }
  );
  return result;
}

export async function getTranscriptPublicMeta(transcriptId: string) {
  const { transcripts } = await getMongoCollections();
  const transcript = await transcripts.findOne({ _id: transcriptId });
  if (!transcript) return null;
  const status = transcript.deletedAt ? "Excluído"
    : transcript.expiresAt && transcript.expiresAt <= new Date() ? "Expirado"
      : "Protegido";

  return {
    id: transcript._id,
    status,
    generatedAt: transcript.createdAt.toISOString(),
    expiresAt: transcript.expiresAt?.toISOString() ?? null,
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
  if (transcript.deletedAt) {
    await registerAccess(transcript, "unknown", false, "deleted_transcript", request);
    return { ok: false, status: 410, message: "Este transcript foi excluído e não está mais disponível.", reason: "deleted" };
  }
  if (transcript.expiresAt && transcript.expiresAt <= now) {
    await collections.transcripts.updateOne({ _id: transcriptId }, { $set: { status: "Expirado" } });
    await registerAccess(transcript, "unknown", false, "expired_transcript", request);
    return { ok: false, status: 410, message: "Este transcript expirou e não está mais disponível.", reason: "transcript_expired" };
  }

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
  if (!transcript || transcript.deletedAt) return null;

  const password = await generateUniqueTemporaryPassword(collections.transcriptPasswords);
  const requestedExpiresAt = new Date(Date.now() + normalizePasswordTtlHours(ttlHours) * 60 * 60 * 1000);
  const expiresAt = transcript.expiresAt && transcript.expiresAt < requestedExpiresAt
    ? transcript.expiresAt
    : requestedExpiresAt;
  await collections.transcriptPasswords.insertOne({
    _id: randomUUID(),
    transcriptId,
    passwordFingerprint: passwordFingerprint(password),
    passwordHash: hashSecret(password),
    type: "temporary",
    expiresAt,
    revokedAt: null,
    createdAt: new Date()
  });
  return { password, expiresAt: expiresAt.toISOString() };
}

export async function renderTranscriptHtmlForPublic(transcript: MongoTranscript, passwordType: "Temporária" | "Mestre" | "Protegido", temporaryPasswordExpiresAt?: string | null) {
  return renderTranscriptHtml(transcript, passwordType, temporaryPasswordExpiresAt, await resolveTranscriptTheme(transcript));
}

export function renderTranscriptHtml(transcript: MongoTranscript, passwordType: "Temporária" | "Mestre" | "Protegido", temporaryPasswordExpiresAt?: string | null, theme = DEFAULT_TRANSCRIPT_THEME) {
  const duration = formatDuration(transcript.createdAt, transcript.closedAt);
  const ticketId = transcript.ticketId ?? transcript._id;
  const participantStats = buildParticipantStats(transcript);
  const brandName = theme.brandName ?? transcript.guildName ?? "NexTech";
  const subject = transcript.openReason ?? transcript.closeReason ?? transcript.finalResult ?? "Sem assunto informado.";
  const summaryItems: Array<[string, string]> = [
    [theme.labels.openedAt, formatDate(transcript.createdAt)],
    [theme.labels.closedAt, transcript.closedAt ? formatDate(transcript.closedAt) : "-"],
    [theme.labels.duration, duration],
    [theme.labels.messages, String(transcript.messages.length)],
    [theme.labels.openedBy, formatUser(transcript.openedById)],
    [theme.labels.assumedBy, formatUser(transcript.responsibleUserId)],
    [theme.labels.category, transcript.categoryName ?? "-"],
    [theme.labels.status, transcript.status]
  ];
  const technicalItems: Array<[string, string]> = [
    ["Canal", transcript.channelName ? `#${transcript.channelName}` : "-"],
    ["Anexos", String(transcript.attachments.length)],
    ["Links", String(transcript.messages.reduce((total, message) => total + countLinks(message.content), 0))],
    [theme.labels.ticketId, ticketId],
    [theme.labels.transcriptId, transcript._id],
    ["Proteção", "Senha obrigatória"],
    ["Acesso", passwordType],
    ["Expira em", temporaryPasswordExpiresAt ? formatDate(new Date(temporaryPasswordExpiresAt)) : transcript.expiresAt ? formatDate(transcript.expiresAt) : "-"]
  ];
  const messages = renderMessages(transcript, theme);
  const closedFooter = theme.labels.footerText || "Atendimento encerrado e preservado pela NexTech.";
  const logo = theme.logoUrl
    ? `<img class="brand-logo" src="${escapeAttribute(theme.logoUrl)}" alt="${escapeAttribute(brandName)}" />`
    : `<div class="brand-logo brand-logo-fallback">${escapeHtml(brandName.slice(0, 1).toUpperCase())}</div>`;
  const densityClass = `density-${theme.density}`;
  const radiusClass = `radius-${theme.cardRadius}`;
  const styleClass = `style-${theme.style}`;
  const colorScheme = theme.mode === "light" ? "light" : "dark";

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="robots" content="noindex, nofollow" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(theme.labels.pageTitle)} - ${escapeHtml(ticketId)}</title>
  <style>
    :root{color-scheme:${colorScheme};--bg:${theme.backgroundColor};--bg2:${theme.secondaryBackgroundColor};--card:${theme.cardColor};--msg:${theme.messageColor};--line:${theme.borderColor};--text:${theme.textColor};--muted:${theme.mutedTextColor};--primary:${theme.primaryColor};--secondary:${theme.secondaryColor};--accent:${theme.accentColor};--button:${theme.buttonColor};--link:${theme.linkColor};--title:${theme.titleColor};--icon:${theme.iconColor};--status:${theme.statusColor};--hover:${theme.hoverColor};--search:${theme.searchColor};--radius:10px;--pad:16px}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,Segoe UI,Arial,sans-serif;line-height:1.5}a{color:var(--link)}button,input{font:inherit}
    main{width:min(1100px,100%);margin:0 auto;padding:28px 16px 42px}.radius-square{--radius:3px}.radius-rounded{--radius:8px}.radius-pill{--radius:18px}.density-compact{--pad:12px}.density-spacious{--pad:22px}
    header{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;border-bottom:1px solid var(--line);padding:0 0 18px}
    .brand{display:flex;gap:13px;align-items:center}.brand-logo{width:54px;height:54px;border-radius:50%;object-fit:cover;border:1px solid var(--line);background:var(--card)}.brand-logo-fallback{display:grid;place-items:center;color:var(--bg);font-weight:900;background:var(--primary)}
    .eyebrow{color:var(--muted);font-size:13px;font-weight:700}.brand h1{color:var(--title);font-size:32px;margin:2px 0 0}.brand p{margin:2px 0 0;color:var(--muted)}.top-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
    .btn{border:1px solid color-mix(in srgb,var(--button) 55%,var(--line));border-radius:8px;background:var(--button);color:#08090d;padding:9px 11px;text-decoration:none;font-weight:800;cursor:pointer}.btn.secondary{background:transparent;color:var(--text)}
    section{margin-top:16px}.section-head{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:10px}h2{color:var(--title);font-size:18px;margin:0}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:10px}.box,.panel{border:1px solid var(--line);border-radius:var(--radius);background:var(--card);padding:var(--pad)}.box span{display:block;color:var(--muted);font-size:12px}.box strong{display:block;margin-top:3px;word-break:break-word}.status{color:var(--status)}
    .contact-text{white-space:pre-wrap;margin:0}.ticket-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:12px}.toolbar{display:flex;gap:8px;flex-wrap:wrap}.search{min-width:min(360px,100%);flex:1;border:1px solid var(--line);border-radius:8px;background:var(--search);color:var(--text);padding:10px 12px;outline:none}.search:focus{border-color:var(--primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--primary) 20%,transparent)}
    .conversation-count{color:var(--muted);font-size:13px;margin:0 0 10px}.chips{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.chip{border:1px solid var(--line);border-radius:999px;background:transparent;color:var(--text);padding:7px 10px;cursor:pointer}.chip.active,.chip:hover{border-color:var(--primary);background:var(--hover)}
    .date-divider{display:flex;align-items:center;gap:12px;color:var(--muted);font-size:12px;font-weight:800;text-transform:uppercase;margin:18px 0 10px}.date-divider:before,.date-divider:after{content:"";height:1px;flex:1;background:var(--line)}
    .message{display:grid;grid-template-columns:42px minmax(0,1fr);gap:12px;border:1px solid var(--line);border-radius:var(--radius);background:var(--msg);padding:var(--pad);margin-bottom:10px}.avatar{width:42px;height:42px;border-radius:50%;object-fit:cover;background:var(--card);border:1px solid var(--line)}.avatar-fallback{display:grid;place-items:center;color:var(--primary);font-weight:900}.message-head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}.author{font-weight:800;color:var(--title)}time{color:var(--muted);font-size:12px}.content{white-space:pre-wrap;margin:7px 0 0}.flag{display:inline-flex;border:1px solid color-mix(in srgb,var(--primary) 55%,var(--line));color:var(--primary);border-radius:999px;padding:1px 7px;font-size:11px}
    .attachment,.embed{margin-top:10px;border:1px solid var(--line);border-radius:8px;background:rgba(0,0,0,.18);overflow:hidden}.attachment img{display:block;max-width:100%;height:auto}.attachment a,.embed{display:block;padding:10px}.embed{border-left:4px solid var(--secondary)}.embed pre{white-space:pre-wrap;margin:0;color:var(--muted);font-size:12px}
    mark{background:color-mix(in srgb,var(--primary) 32%,transparent);color:var(--text);padding:0 2px}.footer{color:var(--muted);text-align:center}.hidden{display:none!important}@media(max-width:760px){main{padding:12px 10px 28px}header{display:block}.top-actions{margin-top:12px;justify-content:flex-start}.brand h1{font-size:24px}.message{grid-template-columns:34px minmax(0,1fr)}.avatar{width:34px;height:34px}}
    @media print{body{background:#fff;color:#000}.top-actions,.toolbar,.chips{display:none}.box,.panel,.message{break-inside:avoid}}
  </style>
</head>
<body>
<main class="${densityClass} ${radiusClass} ${styleClass}">
  <header>
    <div class="brand">${logo}<div><div class="eyebrow">${escapeHtml(theme.labels.pageTitle)}</div><h1>${escapeHtml(brandName)}</h1><p>${escapeHtml(transcript.guildName ?? transcript.guildId)}</p></div></div>
    <div class="top-actions"><button class="btn secondary" type="button" data-copy-link>Copiar link</button><button class="btn secondary" type="button" onclick="window.print()">Imprimir</button><a class="btn" href="#export" data-export>Exportar</a></div>
  </header>
  ${transcript.isPartial ? `<section class="panel"><h2>Transcript parcial</h2><p>Motivo: ${escapeHtml(transcript.partialReason ?? "indisponível")}</p></section>` : ""}
  <section><div class="section-head"><h2>${escapeHtml(theme.labels.summaryTitle)}</h2><strong class="status">${escapeHtml(transcript.status)}</strong></div><div class="summary">${summaryItems.map(([label, value]) => infoBox(label, value)).join("")}</div></section>
  <section class="panel"><div class="section-head"><h2>${escapeHtml(theme.labels.contactTitle)}</h2></div><p class="contact-text">${escapeHtml(subject)}</p><div class="ticket-meta">${technicalItems.map(([label, value]) => infoBox(label, value)).join("")}</div></section>
  <section class="panel"><div class="section-head"><h2>${escapeHtml(theme.labels.conversationTitle)}</h2><div class="toolbar"><input class="search" data-search placeholder="${escapeAttribute(theme.labels.searchPlaceholder)}" /><button class="btn secondary" type="button" data-filter="media">Mídia</button><button class="btn secondary" type="button" data-filter="links">Link</button><button class="btn secondary" type="button" onclick="window.print()">Imprimir</button></div></div><p class="conversation-count">${transcript.messages.length} mensagens</p><div class="chips"><button class="chip active" data-participant="all">Todos ${transcript.messages.length}</button>${participantStats.map((participant) => `<button class="chip" data-participant="${escapeAttribute(participant.id)}">${escapeHtml(participant.name)} ${participant.count}</button>`).join("")}</div><div data-messages>${messages || "<p>Nenhuma mensagem registrada.</p>"}</div></section>
  <section class="footer" id="export"><p>${escapeHtml(theme.labels.endOfConversation)}</p><p>${escapeHtml(closedFooter)}${theme.showNevsecBranding ? " Tecnologia NexTech." : ""}</p></section>
</main>
<script>
(() => {
  const messages = Array.from(document.querySelectorAll("[data-message]"));
  const search = document.querySelector("[data-search]");
  let participant = "all";
  let filter = "all";
  const apply = () => {
    const term = (search?.value || "").toLowerCase();
    messages.forEach((node) => {
      const haystack = (node.getAttribute("data-search") || "").toLowerCase();
      const byParticipant = participant === "all" || node.getAttribute("data-author") === participant;
      const byFilter = filter === "all" || (filter === "media" && node.getAttribute("data-media") === "true") || (filter === "links" && node.getAttribute("data-links") === "true");
      node.classList.toggle("hidden", !(byParticipant && byFilter && (!term || haystack.includes(term))));
    });
  };
  search?.addEventListener("input", apply);
  document.querySelectorAll("[data-participant]").forEach((button) => button.addEventListener("click", () => { participant = button.getAttribute("data-participant") || "all"; document.querySelectorAll("[data-participant]").forEach((item) => item.classList.toggle("active", item === button)); apply(); }));
  document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => { filter = filter === button.getAttribute("data-filter") ? "all" : button.getAttribute("data-filter") || "all"; document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("active", filter !== "all" && item === button)); apply(); }));
  document.querySelector("[data-copy-link]")?.addEventListener("click", () => navigator.clipboard?.writeText(location.href));
  document.querySelector("[data-export]")?.addEventListener("click", (event) => { event.preventDefault(); const blob = new Blob([document.body.innerText], { type: "text/plain;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "${escapeAttribute(transcript._id)}.txt"; a.click(); URL.revokeObjectURL(url); });
})();
</script>
</body>
</html>`;
}

function renderMessages(transcript: MongoTranscript, theme: TranscriptThemeDto) {
  let currentDate = "";
  return transcript.messages.map((message) => {
    const flags = [
      message.system ? "Sistema" : null,
      message.anonymous ? "Anonimo" : null,
      message.botRelayed ? "Reenviado pelo bot" : null
    ].filter(Boolean);
    const dateLabel = formatDateDivider(message.createdAt);
    const divider = dateLabel !== currentDate ? `<div class="date-divider">${escapeHtml(dateLabel)}</div>` : "";
    currentDate = dateLabel;
    const avatar = message.authorAvatarUrl
      ? `<img class="avatar" src="${escapeAttribute(message.authorAvatarUrl)}" alt="${escapeAttribute(message.authorName)}" loading="lazy" />`
      : `<div class="avatar avatar-fallback">${escapeHtml((message.authorName || "?").slice(0, 1).toUpperCase())}</div>`;
    return `
    ${divider}
    <article class="message" data-message data-author="${escapeAttribute(message.authorId ?? "unknown")}" data-media="${message.attachments.some(isMediaAttachment)}" data-links="${countLinks(message.content) > 0}" data-search="${escapeAttribute(`${message.authorName} ${message.content}`)}">
      ${avatar}
      <div><div class="message-head"><span class="author">${escapeHtml(message.authorName)}</span><time>${formatDate(message.createdAt)}</time>${flags.map((flag) => `<span class="flag">${escapeHtml(String(flag))}</span>`).join("")}</div>
      <p class="content">${escapeHtml(message.content || "(sem texto)")}</p>
      ${message.attachments.map((attachment) => renderAttachment(attachment)).join("")}
      ${message.embeds.map((embed) => renderEmbed(embed, theme)).join("")}</div>
    </article>`;
  }).join("");
}

const DEFAULT_TRANSCRIPT_THEME: TranscriptThemeDto = {
  logoUrl: null,
  brandName: "NexTech",
  primaryColor: "#f5c542",
  secondaryColor: "#38bdf8",
  accentColor: "#f43f5e",
  backgroundColor: "#07080d",
  secondaryBackgroundColor: "#10131d",
  cardColor: "#151925",
  messageColor: "#111522",
  borderColor: "#2b3143",
  textColor: "#f8fafc",
  mutedTextColor: "#a1a8b8",
  buttonColor: "#f5c542",
  linkColor: "#7dd3fc",
  titleColor: "#ffffff",
  iconColor: "#f5c542",
  statusColor: "#22c55e",
  hoverColor: "#232a3c",
  searchColor: "#0d111c",
  mode: "dark",
  density: "normal",
  cardRadius: "rounded",
  style: "tech",
  showNevsecBranding: true,
  labels: {
    pageTitle: "Transcrição de atendimento",
    summaryTitle: "Resumo da transcrição",
    contactTitle: "Detalhes do contato",
    conversationTitle: "Conversa",
    searchPlaceholder: "Buscar na conversa",
    openedAt: "Aberto em",
    closedAt: "Fechado em",
    duration: "Duração",
    messages: "Mensagens",
    openedBy: "Aberto por",
    assumedBy: "Assumido por",
    category: "Categoria",
    subject: "Assunto",
    status: "Status",
    ticketId: "ID do ticket",
    transcriptId: "ID do transcript",
    endOfConversation: "Fim da conversa",
    footerText: "Atendimento encerrado e preservado pela NexTech."
  }
};

async function resolveTranscriptTheme(transcript: MongoTranscript): Promise<TranscriptThemeDto> {
  try {
    const settings = await getGuildSettings(transcript.guildId, transcript.botId);
    return settings.globalLogConfig.transcriptTheme ?? DEFAULT_TRANSCRIPT_THEME;
  } catch (error) {
    console.warn("[TRANSCRIPT] usando tema padrão:", error instanceof Error ? error.message : error);
    return DEFAULT_TRANSCRIPT_THEME;
  }
}

function buildParticipantStats(transcript: MongoTranscript) {
  const names = new Map<string, string>();
  for (const participant of transcript.participants) {
    names.set(participant.id ?? "unknown", participant.name);
  }
  const counts = new Map<string, number>();
  for (const message of transcript.messages) {
    const id = message.authorId ?? "unknown";
    names.set(id, message.authorName);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count, name: names.get(id) ?? "Desconhecido" }))
    .sort((a, b) => b.count - a.count);
}

function countLinks(value: string) {
  return value.match(/https?:\/\/[^\s<>"']+/gi)?.length ?? 0;
}

function isMediaAttachment(attachment: MongoTranscript["attachments"][number]) {
  return Boolean(
    attachment.contentType?.startsWith("image/")
    || attachment.contentType?.startsWith("video/")
    || /\.(png|jpe?g|gif|webp|mp4|mov|webm)$/i.test(attachment.url)
  );
}

function renderEmbed(embed: unknown, _theme: TranscriptThemeDto) {
  const record = embed && typeof embed === "object" ? embed as Record<string, unknown> : null;
  if (!record) return "";
  const title = typeof record.title === "string" ? record.title : "";
  const description = typeof record.description === "string" ? record.description : "";
  const url = typeof record.url === "string" ? record.url : "";
  const image = getEmbedImageUrl(record);
  const fields = Array.isArray(record.fields)
    ? record.fields
      .map((field) => field && typeof field === "object" ? field as Record<string, unknown> : null)
      .filter(Boolean)
      .map((field) => {
        const name = typeof field?.name === "string" ? field.name : "";
        const value = typeof field?.value === "string" ? field.value : "";
        return name || value ? `<p><strong>${escapeHtml(name)}</strong><br>${escapeHtml(value)}</p>` : "";
      }).join("")
    : "";
  if (!title && !description && !url && !image && !fields) return "";
  return `<div class="embed">${title ? `<strong>${escapeHtml(title)}</strong>` : ""}${description ? `<p>${escapeHtml(description)}</p>` : ""}${url ? `<p><a href="${escapeAttribute(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a></p>` : ""}${image ? `<img src="${escapeAttribute(image)}" alt="Embed" loading="lazy" style="max-width:100%;height:auto;border-radius:8px" />` : ""}${fields}</div>`;
}

function getEmbedImageUrl(record: Record<string, unknown>) {
  for (const key of ["image", "thumbnail"]) {
    const value = record[key];
    if (value && typeof value === "object") {
      const url = (value as Record<string, unknown>).url;
      if (typeof url === "string") return url;
    }
  }
  return null;
}

export function renderTranscriptText(transcript: MongoTranscript) {
  const header = [
    "LOG DO SISTEMA",
    `Módulo: ${transcript.type}`,
    `Caso: ${transcript.ticketId ?? transcript._id}`,
    `Status: ${transcript.status}`,
    `Canal: ${transcript.channelName ?? "-"}`,
    `Categoria/Órgão: ${transcript.categoryName ?? "-"}`,
    `Aberto por: ${formatUser(transcript.openedById)}`,
    `Responsável: ${formatUser(transcript.responsibleUserId)}`,
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

export function generateTemporaryPassword() {
  // 8 dígitos (10^8) em vez de 4 (10^4). Com 4 dígitos o espaço inteiro de
  // senhas era percorrível em minutos contra o endpoint público de transcripts.
  // Continua numérico para não mudar a experiência de digitar o código, e as
  // senhas já emitidas seguem válidas (a comparação é por hash, não por formato).
  return randomInt(0, 100_000_000).toString().padStart(8, "0");
}

async function generateUniqueTemporaryPassword(collection: { findOne(query: Record<string, unknown>): Promise<unknown> }) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const password = generateTemporaryPassword();
    const fingerprint = passwordFingerprint(password);
    const existing = await collection.findOne({ passwordFingerprint: fingerprint });
    if (!existing) return password;
  }
  return generateTemporaryPassword();
}

function passwordFingerprint(password: string) {
  return createHash("sha256").update(`transcript-password:${password}`).digest("hex");
}

function normalizePasswordTtlHours(value: number) {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TEMP_PASSWORD_TTL_HOURS;
  return Math.max(1, Math.min(Math.floor(value), DEFAULT_TEMP_PASSWORD_TTL_HOURS));
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

  // Falha fechado quando nada foi configurado: a senha mestra abre o transcript
  // de qualquer bot/guild, então não pode existir por padrão.
  if (!env.MASTER_TRANSCRIPT_PASSWORD) {
    return false;
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

function formatDateDivider(date: Date) {
  const formatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });
  const today = formatter.format(new Date());
  const value = formatter.format(date);
  return value === today ? "Hoje" : value;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char] ?? char));
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function transcriptLog(message: string, details: Record<string, unknown>) {
  console.log(`[TRANSCRIPT] ${message}`, JSON.stringify(sanitizeLogDetails(details)));
}

function sanitizeLogDetails(details: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(details).filter(([key]) => !/password|token|secret|cookie/i.test(key))
  );
}

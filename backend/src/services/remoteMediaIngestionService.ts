import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { getMongoCollections } from "../database/mongo";
import { savePersistentImage, PERSISTENT_IMAGE_MAX_BYTES } from "./persistentImageStorageService";

/*
 * Importação de mídia remota para o storage permanente do NexTech.
 *
 * Motivo: URLs de terceiros (principalmente o CDN do Discord, que assina os
 * links com `ex`/`is`/`hm` temporários) deixam de responder. Qualquer painel que
 * aponte direto para elas perde a imagem depois de um tempo. Aqui a URL do
 * usuário serve só para IMPORTAR: o arquivo é baixado, validado, guardado no
 * GridFS pelo `persistentImageStorageService` e o painel passa a apontar para a
 * cópia interna.
 *
 * Todo download de mídia por URL deve passar por este serviço — não espalhar
 * fetch/axios de mídia pelos módulos.
 */

const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 512 * 1024;

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif"
]);

export type IngestedMedia = {
  originalUrl: string;
  resolvedUrl: string | null;
  storedUrl: string | null;
  mediaId: string | null;
  mimeType: string | null;
  fileName: string | null;
  fileSize: number | null;
  sha256: string | null;
  status: "ready" | "failed";
  error: string | null;
};

export type IngestMediaInput = {
  url: string;
  guildId: string;
  botId?: string | null;
  actorId?: string | null;
  moduleId: string;
  imageType?: string;
  maxBytes?: number;
};

export class MediaIngestionError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "MediaIngestionError";
    this.code = code;
  }
}

/**
 * Só http/https entram. `file://`, `data:`, `ftp://` e afins são recusados antes
 * de qualquer requisição.
 */
export function parseIngestableUrl(value: string) {
  let parsed: URL;

  try {
    parsed = new URL(value.trim());
  } catch {
    throw new MediaIngestionError("URL inválida.", "INVALID_URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new MediaIngestionError("Somente links http:// e https:// são aceitos.", "UNSUPPORTED_PROTOCOL");
  }

  return parsed;
}

/**
 * Bloqueio de SSRF: loopback, link-local, multicast e as faixas privadas.
 * Precisa ser reavaliado a cada redirect, senão um 302 para 127.0.0.1 passa.
 */
export function isBlockedIpAddress(address: string) {
  const version = isIP(address);

  if (version === 4) {
    const parts = address.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    const [first, second] = parts as [number, number, number, number];
    if (first === 0 || first === 10 || first === 127) return true;
    if (first === 169 && second === 254) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 192 && second === 168) return true;
    if (first === 100 && second >= 64 && second <= 127) return true;
    if (first >= 224) return true;
    return false;
  }

  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized === "::" || normalized === "::1") return true;
    if (normalized.startsWith("fe80") || normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    if (normalized.startsWith("::ffff:")) return isBlockedIpAddress(normalized.slice("::ffff:".length));
    return false;
  }

  return true;
}

export function isBlockedHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");

  if (!normalized) return true;
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".internal") || normalized.endsWith(".local")) {
    return true;
  }

  return isIP(normalized) ? isBlockedIpAddress(normalized) : false;
}

async function assertPublicTarget(url: URL) {
  if (isBlockedHostname(url.hostname)) {
    throw new MediaIngestionError("Endereço não permitido para importação de mídia.", "BLOCKED_ADDRESS");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) return;

  // Resolve o DNS para impedir que um domínio público aponte para IP interno.
  const resolved = await lookup(hostname, { all: true }).catch(() => []);
  if (resolved.some((entry) => isBlockedIpAddress(entry.address))) {
    throw new MediaIngestionError("Endereço não permitido para importação de mídia.", "BLOCKED_ADDRESS");
  }
}

/** Content-Type oficialmente informado pelo servidor, sem os parâmetros. */
export function normalizeContentType(value: string | null | undefined) {
  return (value ?? "").split(";")[0]?.trim().toLowerCase() || null;
}

/**
 * Detecção por magic bytes. É a fonte de verdade quando o servidor mente no
 * Content-Type ou manda `application/octet-stream`; extensão de URL nunca é
 * usada para decidir isso.
 */
export function detectImageMimeFromBytes(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;

  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 3).toString("ascii") === "GIF") return "image/gif";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";

  return null;
}

export function isSupportedImageMime(value: string | null | undefined) {
  return Boolean(value && SUPPORTED_IMAGE_MIME_TYPES.has(value));
}

/**
 * Quando a URL devolve HTML (post do Imgur, página de notícia), procura a imagem
 * declarada nos metadados em vez de tratar o HTML como arquivo de imagem.
 */
export function extractHtmlImageUrl(html: string, baseUrl: string): string | null {
  const patterns = [
    /<meta[^>]+(?:property|name)\s*=\s*["'](?:og:image(?::secure_url|:url)?|twitter:image(?::src)?)["'][^>]*>/gi
  ];

  for (const pattern of patterns) {
    for (const tag of html.match(pattern) ?? []) {
      const content = /content\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.trim();
      if (!content) continue;

      try {
        return new URL(content, baseUrl).toString();
      } catch {
        continue;
      }
    }
  }

  return null;
}

export function sha256Hex(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

type FetchedBody = {
  buffer: Buffer;
  contentType: string | null;
  finalUrl: string;
};

/**
 * Faz o GET seguindo redirects manualmente, para poder revalidar o destino a
 * cada salto, e aborta a leitura assim que o corpo passa do limite — um link
 * mentindo no Content-Length não pode consumir a RAM do processo.
 */
async function fetchWithLimits(startUrl: URL, maxBytes: number): Promise<FetchedBody> {
  let current = startUrl;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicTarget(current);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "image/*,text/html;q=0.8,*/*;q=0.5",
          "user-agent": "NexTechMediaBot/1.0 (+https://nextech.discloud.app)"
        }
      });
    } catch (error) {
      clearTimeout(timeout);
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new MediaIngestionError(
        aborted ? "O link demorou demais para responder." : "Não foi possível acessar o link informado.",
        aborted ? "TIMEOUT" : "FETCH_FAILED"
      );
    }

    if (response.status >= 300 && response.status < 400) {
      clearTimeout(timeout);
      const location = response.headers.get("location");
      if (!location) {
        throw new MediaIngestionError("O link respondeu com redirecionamento inválido.", "INVALID_REDIRECT");
      }
      if (redirect === MAX_REDIRECTS) {
        throw new MediaIngestionError("O link excedeu o limite de redirecionamentos.", "TOO_MANY_REDIRECTS");
      }
      current = parseIngestableUrl(new URL(location, current).toString());
      continue;
    }

    try {
      if (!response.ok) {
        throw new MediaIngestionError(`O link respondeu com erro ${response.status}.`, "HTTP_ERROR");
      }

      const declaredLength = Number(response.headers.get("content-length") ?? "");
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new MediaIngestionError(`Arquivo maior que o limite de ${Math.round(maxBytes / (1024 * 1024))} MB.`, "TOO_LARGE");
      }

      const buffer = await readBodyWithLimit(response, maxBytes);
      return { buffer, contentType: normalizeContentType(response.headers.get("content-type")), finalUrl: current.toString() };
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new MediaIngestionError("O link excedeu o limite de redirecionamentos.", "TOO_MANY_REDIRECTS");
}

async function readBodyWithLimit(response: Response, maxBytes: number) {
  const reader = response.body?.getReader();

  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new MediaIngestionError(`Arquivo maior que o limite de ${Math.round(maxBytes / (1024 * 1024))} MB.`, "TOO_LARGE");
    }
    return buffer;
  }

  const chunks: Buffer[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new MediaIngestionError(`Arquivo maior que o limite de ${Math.round(maxBytes / (1024 * 1024))} MB.`, "TOO_LARGE");
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, total);
}

function fileNameFromUrl(url: string, extension: string) {
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return "";
    }
  })();
  const base = path.split("/").filter(Boolean).pop() ?? "";
  const clean = base.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 80);
  return clean.includes(".") ? clean : `${clean || "evidencia"}.${extension}`;
}

function extensionForMime(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

/**
 * Reaproveita uma cópia já guardada com o mesmo conteúdo. Duas URLs diferentes
 * da mesma imagem não geram dois arquivos no GridFS.
 */
async function findStoredByHash(hash: string, guildId: string) {
  const { persistentImages } = await getMongoCollections();
  const found = await persistentImages.findOne({ guildId, "metadata.inputHash": hash });
  return found ?? null;
}

export async function ingestRemoteMedia(input: IngestMediaInput): Promise<IngestedMedia> {
  const originalUrl = input.url.trim();
  const base: IngestedMedia = {
    originalUrl,
    resolvedUrl: null,
    storedUrl: null,
    mediaId: null,
    mimeType: null,
    fileName: null,
    fileSize: null,
    sha256: null,
    status: "failed",
    error: null
  };

  try {
    const maxBytes = input.maxBytes ?? PERSISTENT_IMAGE_MAX_BYTES;
    let target = parseIngestableUrl(originalUrl);
    let fetched = await fetchWithLimits(target, maxBytes);

    // HTML: procura og:image/twitter:image e importa a imagem apontada.
    if (fetched.contentType?.startsWith("text/html")) {
      const html = fetched.buffer.subarray(0, MAX_HTML_BYTES).toString("utf8");
      const candidate = extractHtmlImageUrl(html, fetched.finalUrl);

      if (!candidate) {
        throw new MediaIngestionError("O link foi aceito, mas nenhuma imagem pôde ser extraída dele.", "NO_MEDIA_FOUND");
      }

      target = parseIngestableUrl(candidate);
      fetched = await fetchWithLimits(target, maxBytes);
    }

    const detected = detectImageMimeFromBytes(fetched.buffer);
    const mimeType = isSupportedImageMime(detected)
      ? detected
      : isSupportedImageMime(fetched.contentType)
        ? fetched.contentType
        : null;

    if (!mimeType) {
      throw new MediaIngestionError("O link não entregou uma imagem suportada (PNG, JPEG, WEBP ou GIF).", "UNSUPPORTED_MEDIA");
    }

    const hash = sha256Hex(fetched.buffer);
    const existing = await findStoredByHash(hash, input.guildId);

    if (existing) {
      return {
        ...base,
        resolvedUrl: fetched.finalUrl,
        storedUrl: existing.publicUrl,
        mediaId: existing._id,
        mimeType: existing.mimeType,
        fileName: existing.fileName,
        fileSize: existing.size,
        sha256: hash,
        status: "ready"
      };
    }

    const fileName = fileNameFromUrl(fetched.finalUrl, extensionForMime(mimeType));
    const stored = await savePersistentImage({
      actorId: input.actorId ?? null,
      botId: input.botId ?? null,
      buffer: fetched.buffer,
      guildId: input.guildId,
      imageType: input.imageType ?? "evidence",
      metadata: { originalUrl, resolvedUrl: fetched.finalUrl, sha256: hash },
      mimeType,
      moduleId: input.moduleId,
      originalName: fileName
    });

    return {
      ...base,
      resolvedUrl: fetched.finalUrl,
      storedUrl: stored.publicUrl,
      mediaId: stored.id,
      mimeType: stored.mimeType,
      fileName: stored.fileName,
      fileSize: stored.size,
      sha256: hash,
      status: "ready"
    };
  } catch (error) {
    const message = error instanceof MediaIngestionError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Não foi possível importar a mídia informada.";

    return { ...base, error: message, status: "failed" };
  }
}

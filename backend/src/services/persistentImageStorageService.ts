import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import { getMongoCollections, type MongoPersistentImage } from "../database/mongo";
import { createLog } from "./logService";

export type StoredImageDto = {
  animated: boolean;
  extension: string;
  fileName: string;
  id: string;
  mimeType: string;
  publicUrl: string;
  size: number;
  storageProvider: "mongodb";
  uploadedAt: string;
};

export const PERSISTENT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const PERSISTENT_VIDEO_MAX_BYTES = 15 * 1024 * 1024;
export const PERSISTENT_IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};
export const PERSISTENT_VIDEO_MIME_EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm"
};
const PERSISTENT_MEDIA_MIME_EXTENSIONS: Record<string, string> = {
  ...PERSISTENT_IMAGE_MIME_EXTENSIONS,
  ...PERSISTENT_VIDEO_MIME_EXTENSIONS
};

export async function savePersistentImage(input: {
  actorId: string | null;
  botId?: string | null;
  buffer: Buffer;
  guildId: string;
  imageType: string;
  metadata?: Record<string, unknown>;
  mimeType: string;
  moduleId: string;
  originalName?: string | null;
  previousUrl?: string | null;
}) {
  const mimeType = detectSupportedImageMimeType(input.buffer, input.mimeType);

  const id = randomUUID();
  const extension = PERSISTENT_MEDIA_MIME_EXTENSIONS[mimeType];
  const animated = mimeType === "image/gif" && isAnimatedGif(input.buffer);
  const fileName = `${sanitizePathPart(input.guildId)}-${sanitizePathPart(input.moduleId)}-${sanitizePathPart(input.imageType)}-${Date.now()}-${id}.${extension}`;
  const publicUrl = publicImageUrl(id);
  const now = new Date();
  const doc: MongoPersistentImage = {
    _id: id,
    animated,
    botId: input.botId?.trim() || null,
    buffer: input.buffer,
    createdAt: now,
    extension,
    fileName,
    guildId: input.guildId,
    imageType: input.imageType,
    metadata: input.metadata,
    mimeType,
    moduleId: input.moduleId,
    originalName: input.originalName ?? null,
    publicUrl,
    size: input.buffer.length,
    storageProvider: "mongodb",
    uploadedAt: now,
    uploadedBy: input.actorId
  };

  const { persistentImages } = await getMongoCollections();
  const previousId = parsePersistentImageId(input.previousUrl ?? "");
  let previousDeletedBeforeInsert = false;

  try {
    await persistentImages.insertOne(doc);
  } catch (error) {
    if (!isMongoStorageQuotaError(error)) {
      throw error;
    }

    await deletePersistentImageHistory({
      botId: doc.botId,
      guildId: doc.guildId,
      imageType: doc.imageType,
      keepIds: previousId ? [previousId] : [],
      moduleId: doc.moduleId
    });

    try {
      await persistentImages.insertOne(doc);
    } catch (retryError) {
      if (!previousId || !isMongoStorageQuotaError(retryError)) {
        throw retryError;
      }

      await persistentImages.deleteOne({ _id: previousId, guildId: doc.guildId });
      previousDeletedBeforeInsert = true;
      await persistentImages.insertOne(doc);
    }
  }

  await deletePersistentImageHistory({
    botId: doc.botId,
    guildId: doc.guildId,
    imageType: doc.imageType,
    keepIds: [doc._id],
    moduleId: doc.moduleId
  }).catch(() => null);

  if (input.botId) {
    await createLog({
      botId: input.botId,
      guildId: input.guildId,
      message: `Imagem ${input.imageType} do módulo ${input.moduleId} enviada para armazenamento persistente.`,
      metadata: {
        imageType: input.imageType,
        animated,
        extension,
        mimeType,
        moduleId: input.moduleId,
        newUrl: publicUrl,
        oldUrl: input.previousUrl ?? null,
        previousDeletedBeforeInsert,
        size: input.buffer.length,
        storageProvider: "mongodb",
        status: "uploaded"
      },
      type: "panel_image.uploaded",
      userId: input.actorId
    }).catch(() => null);
  }

  return toDto(doc);
}

export async function getPersistentImage(imageId: string) {
  const { persistentImages } = await getMongoCollections();
  return persistentImages.findOne({ _id: imageId });
}

export async function getPersistentImageMetadataByUrl(url: string | null | undefined) {
  const id = parsePersistentImageId(url ?? "");
  if (!id) return null;
  const { persistentImages } = await getMongoCollections();
  const image = await persistentImages.findOne({ _id: id }, { projection: { animated: 1, extension: 1, fileName: 1, mimeType: 1, size: 1, storageProvider: 1, uploadedAt: 1 } });
  return image ? toDto(image as MongoPersistentImage) : null;
}

export async function removePersistentImageByUrl(input: {
  actorId: string | null;
  botId?: string | null;
  guildId: string;
  imageType: string;
  moduleId: string;
  url: string;
}) {
  const id = parsePersistentImageId(input.url);
  if (id) {
    const { persistentImages } = await getMongoCollections();
    await persistentImages.deleteOne({ _id: id, guildId: input.guildId });
  }

  if (input.botId) {
    await createLog({
      botId: input.botId,
      guildId: input.guildId,
      message: `Imagem ${input.imageType} do módulo ${input.moduleId} removida.`,
      metadata: {
        imageType: input.imageType,
        moduleId: input.moduleId,
        oldUrl: input.url,
        status: "removed"
      },
      type: "panel_image.removed",
      userId: input.actorId
    }).catch(() => null);
  }
}

async function deletePersistentImageHistory(input: {
  botId: string | null;
  guildId: string;
  imageType: string;
  keepIds: string[];
  moduleId: string;
}) {
  const { persistentImages } = await getMongoCollections();
  await persistentImages.deleteMany({
    botId: input.botId,
    guildId: input.guildId,
    imageType: input.imageType,
    moduleId: input.moduleId,
    ...(input.keepIds.length ? { _id: { $nin: input.keepIds } } : {})
  });
}

export async function migrateLocalImageToPersistent(input: {
  actorId: string | null;
  botId?: string | null;
  guildId: string;
  imageType: string;
  localUrl: string;
  moduleId: string;
  uploadsRoot: string;
}) {
  const filePath = resolveLocalUploadPath(input.localUrl, input.uploadsRoot);
  if (!filePath) return null;

  const buffer = await fs.readFile(filePath).catch(() => null);
  if (!buffer) return null;

  const mimeType = mimeTypeFromExtension(filePath);
  if (!mimeType) return null;

  return savePersistentImage({
    actorId: input.actorId,
    botId: input.botId,
    buffer,
    guildId: input.guildId,
    imageType: input.imageType,
    metadata: { migratedFrom: input.localUrl },
    mimeType,
    moduleId: input.moduleId,
    originalName: path.basename(filePath),
    previousUrl: input.localUrl
  });
}

export function validatePersistentImage(buffer: Buffer, mimeType: string) {
  detectSupportedImageMimeType(buffer, mimeType);
}

export function detectSupportedImageMimeType(buffer: Buffer, mimeType: string) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw Object.assign(new Error("Arquivo de imagem obrigatório."), { statusCode: 400 });
  }

  const normalizedMimeType = mimeType.trim().toLowerCase();
  const detectedMimeType = detectMediaMimeType(buffer);
  const resolvedMimeType = PERSISTENT_MEDIA_MIME_EXTENSIONS[normalizedMimeType] ? normalizedMimeType : detectedMimeType;

  if (!resolvedMimeType || !PERSISTENT_MEDIA_MIME_EXTENSIONS[resolvedMimeType]) {
    throw Object.assign(new Error("Formato inválido. Envie PNG, JPG, WEBP, GIF, MP4, MOV ou WEBM."), { statusCode: 400 });
  }

  const maxBytes = resolvedMimeType.startsWith("video/") ? PERSISTENT_VIDEO_MAX_BYTES : PERSISTENT_IMAGE_MAX_BYTES;
  if (buffer.length > maxBytes) {
    throw Object.assign(new Error(resolvedMimeType.startsWith("video/")
      ? "Vídeo muito grande. Envie um arquivo de até 15MB."
      : "Imagem muito grande. Envie um arquivo de até 10MB."), { statusCode: 413 });
  }

  if (resolvedMimeType === "image/gif" && !isGif(buffer)) {
    throw Object.assign(new Error("Arquivo GIF inválido."), { statusCode: 400 });
  }

  return resolvedMimeType;
}

export function isPersistentImageUrl(value: string | null | undefined) {
  return Boolean(parsePersistentImageId(value ?? ""));
}

export function normalizePersistentImageUrl(value: string | null | undefined) {
  const id = parsePersistentImageId(value ?? "");
  return id ? publicImageUrl(id) : value ?? "";
}

export function isLocalUploadUrl(value: string | null | undefined) {
  return /^\/uploads\//.test(value?.trim() ?? "");
}

function publicImageUrl(id: string) {
  const baseUrl = env.SITE_ORIGIN || env.FRONTEND_URL;
  return `${baseUrl}/api/persistent-images/${encodeURIComponent(id)}`;
}

function parsePersistentImageId(value: string) {
  const normalized = value.trim();
  if (!normalized) return null;
  const match = normalized.match(/\/api\/persistent-images\/([a-f0-9-]{36})(?:[?#].*)?$/i);
  return match?.[1] ?? null;
}

function isMongoStorageQuotaError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("over your space quota") || message.includes("writes are blocked on your cluster");
}

function resolveLocalUploadPath(localUrl: string, uploadsRoot: string) {
  if (!isLocalUploadUrl(localUrl)) return null;
  const relative = localUrl.replace(/^\/uploads\/+/, "");
  const resolved = path.resolve(uploadsRoot, relative);
  const root = path.resolve(uploadsRoot);
  return resolved.startsWith(root + path.sep) || resolved === root ? resolved : null;
}

function mimeTypeFromExtension(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".gif") return "image/gif";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".png") return "image/png";
  if (ext === ".webm") return "video/webm";
  if (ext === ".webp") return "image/webp";
  return null;
}

function isAnimatedGif(buffer: Buffer) {
  if (buffer.length < 10 || buffer.toString("ascii", 0, 3) !== "GIF") return false;

  let frames = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === 0x2c) {
      frames += 1;
      if (frames > 1) return true;
    }
  }

  return false;
}

function detectMediaMimeType(buffer: Buffer) {
  if (isGif(buffer)) return "image/gif";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (isWebm(buffer)) return "video/webm";
  const mp4Like = detectIsoBmffVideoMimeType(buffer);
  if (mp4Like) return mp4Like;
  return null;
}

function isGif(buffer: Buffer) {
  return buffer.length >= 6 && (buffer.toString("ascii", 0, 6) === "GIF87a" || buffer.toString("ascii", 0, 6) === "GIF89a");
}

function isWebm(buffer: Buffer) {
  return buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
}

function detectIsoBmffVideoMimeType(buffer: Buffer) {
  if (buffer.length < 12 || buffer.toString("ascii", 4, 8) !== "ftyp") return null;
  const header = buffer.toString("ascii", 8, Math.min(buffer.length, 40));
  if (header.includes("qt  ")) return "video/quicktime";
  if (/(isom|iso2|mp41|mp42|avc1|dash|M4V )/.test(header)) return "video/mp4";
  return null;
}

function sanitizePathPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "image";
}

function toDto(image: MongoPersistentImage): StoredImageDto {
  const extension = image.extension || PERSISTENT_MEDIA_MIME_EXTENSIONS[image.mimeType] || fileExtension(image.fileName);
  return {
    animated: Boolean(image.animated ?? image.mimeType === "image/gif"),
    extension,
    fileName: image.fileName,
    id: image._id,
    mimeType: image.mimeType,
    publicUrl: publicImageUrl(image._id),
    size: image.size,
    storageProvider: image.storageProvider ?? "mongodb",
    uploadedAt: image.uploadedAt.toISOString()
  };
}

function fileExtension(fileName: string) {
  const extension = path.extname(fileName).replace(".", "").toLowerCase();
  return extension || "bin";
}

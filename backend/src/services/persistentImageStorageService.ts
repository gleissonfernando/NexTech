import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import { getMongoCollections, type MongoPersistentImage } from "../database/mongo";
import { createLog } from "./logService";

export type StoredImageDto = {
  fileName: string;
  id: string;
  mimeType: string;
  publicUrl: string;
  size: number;
  storageProvider: "mongodb";
};

export const PERSISTENT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const PERSISTENT_IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
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
  validatePersistentImage(input.buffer, input.mimeType);

  const id = randomUUID();
  const extension = PERSISTENT_IMAGE_MIME_EXTENSIONS[input.mimeType];
  const fileName = `${sanitizePathPart(input.guildId)}-${sanitizePathPart(input.moduleId)}-${sanitizePathPart(input.imageType)}-${Date.now()}-${id}.${extension}`;
  const publicUrl = publicImageUrl(id);
  const now = new Date();
  const doc: MongoPersistentImage = {
    _id: id,
    botId: input.botId?.trim() || null,
    buffer: input.buffer,
    createdAt: now,
    fileName,
    guildId: input.guildId,
    imageType: input.imageType,
    metadata: input.metadata,
    mimeType: input.mimeType,
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
      message: `Imagem ${input.imageType} do modulo ${input.moduleId} enviada para armazenamento persistente.`,
      metadata: {
        imageType: input.imageType,
        mimeType: input.mimeType,
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
      message: `Imagem ${input.imageType} do modulo ${input.moduleId} removida.`,
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
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw Object.assign(new Error("Arquivo de imagem obrigatorio."), { statusCode: 400 });
  }

  if (buffer.length > PERSISTENT_IMAGE_MAX_BYTES) {
    throw Object.assign(new Error("Imagem muito grande. Envie um arquivo de ate 10MB."), { statusCode: 413 });
  }

  if (!PERSISTENT_IMAGE_MIME_EXTENSIONS[mimeType]) {
    throw Object.assign(new Error("Formato invalido. Envie GIF, PNG, JPG ou WEBP."), { statusCode: 400 });
  }
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
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return null;
}

function sanitizePathPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "image";
}

function toDto(image: MongoPersistentImage): StoredImageDto {
  return {
    fileName: image.fileName,
    id: image._id,
    mimeType: image.mimeType,
    publicUrl: publicImageUrl(image._id),
    size: image.size,
    storageProvider: image.storageProvider
  };
}

import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import fs from "node:fs/promises";
import path from "node:path";
import { GridFSBucket, ObjectId } from "mongodb";
import { env } from "../config/env";
import { getMongoCollections, getMongoDb, type MongoPersistentImage } from "../database/mongo";
import { createLog } from "./logService";
import { PANEL_MEDIA_MIME_EXTENSIONS, processPanelMedia } from "./panelMediaProcessor";

export type StoredImageDto = {
  animated: boolean;
  extension: string;
  fileName: string;
  id: string;
  mimeType: string;
  posterUrl: string | null;
  processingError: string | null;
  processingStatus: "stored" | "converted" | "failed";
  publicUrl: string;
  size: number;
  storageProvider: "mongodb" | "gridfs";
  uploadedAt: string;
};

const PERSISTENT_MEDIA_MIME_EXTENSIONS = PANEL_MEDIA_MIME_EXTENSIONS;
export const PERSISTENT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const PERSISTENT_VIDEO_MAX_BYTES = 15 * 1024 * 1024;

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
  const processed = await processPanelMedia({ buffer: input.buffer, mimeType: input.mimeType, originalName: input.originalName });

  const id = randomUUID();
  const { animated, extension, mimeType } = processed;
  const fileName = `${sanitizePathPart(input.guildId)}-${sanitizePathPart(input.moduleId)}-${sanitizePathPart(input.imageType)}-${Date.now()}-${id}.${extension}`;
  const publicUrl = publicImageUrl(id);
  const now = new Date();
  const fileId = await saveGridFsFile({
    buffer: processed.buffer,
    contentType: mimeType,
    fileName,
    metadata: { botId: input.botId?.trim() || null, guildId: input.guildId, imageType: input.imageType, moduleId: input.moduleId, persistentImageId: id }
  });
  const posterFileId = processed.posterBuffer?.length ? await saveGridFsFile({
    buffer: processed.posterBuffer,
    contentType: processed.posterMimeType || "image/jpeg",
    fileName: `${path.parse(fileName).name}-poster.jpg`,
    metadata: { botId: input.botId?.trim() || null, guildId: input.guildId, imageType: "poster", moduleId: input.moduleId, persistentImageId: id }
  }) : null;
  const doc: MongoPersistentImage = {
    _id: id,
    animated,
    botId: input.botId?.trim() || null,
    buffer: null,
    createdAt: now,
    extension,
    fileId,
    fileName,
    guildId: input.guildId,
    imageType: input.imageType,
    metadata: {
      ...(input.metadata ?? {}),
      inputHash: processed.inputHash
    },
    mimeType,
    moduleId: input.moduleId,
    originalName: input.originalName ?? null,
    originalMimeType: processed.originalMimeType,
    originalSize: processed.originalSize,
    posterBuffer: null,
    posterFileId,
    posterMimeType: processed.posterMimeType,
    processingError: processed.processingError,
    processingStatus: processed.processingStatus,
    publicUrl,
    size: processed.buffer.length,
    storageProvider: "gridfs",
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

      await deletePersistentImageDocument(previousId, doc.guildId);
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
        processingError: processed.processingError,
        processingStatus: processed.processingStatus,
        size: processed.buffer.length,
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
  const image = await persistentImages.findOne({ _id: id }, { projection: { animated: 1, extension: 1, fileName: 1, mimeType: 1, posterBuffer: 1, posterFileId: 1, processingError: 1, processingStatus: 1, size: 1, storageProvider: 1, uploadedAt: 1 } });
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
    await deletePersistentImageDocument(id, input.guildId);
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
  const rows = await persistentImages.find({
    botId: input.botId,
    guildId: input.guildId,
    imageType: input.imageType,
    moduleId: input.moduleId,
    ...(input.keepIds.length ? { _id: { $nin: input.keepIds } } : {})
  }, { projection: { _id: 1, fileId: 1, posterFileId: 1 } }).toArray();
  if (!rows.length) return;
  await persistentImages.deleteMany({ _id: { $in: rows.map((row) => row._id) }, guildId: input.guildId });
  await Promise.all(rows.flatMap((row) => [deleteGridFsFile(row.fileId), deleteGridFsFile(row.posterFileId)]));
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
    throw Object.assign(new Error("Arquivo de mídia obrigatório."), { statusCode: 400 });
  }
  return mimeType.trim().toLowerCase() || "application/octet-stream";
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

export async function readPersistentImageBuffer(image: MongoPersistentImage) {
  if (image.buffer) return toBuffer(image.buffer);
  if (!image.fileId) return Buffer.alloc(0);
  return readGridFsFile(image.fileId);
}

export async function readPersistentPosterBuffer(image: MongoPersistentImage) {
  if (image.posterBuffer) return toBuffer(image.posterBuffer);
  if (!image.posterFileId) return Buffer.alloc(0);
  return readGridFsFile(image.posterFileId);
}

export async function openPersistentImageStream(image: MongoPersistentImage, range?: { end: number; start: number } | null) {
  if (image.buffer) {
    const buffer = toBuffer(image.buffer);
    const start = range?.start ?? 0;
    const end = range?.end ?? buffer.length - 1;
    return { length: end - start + 1, stream: Readable.from(buffer.subarray(start, end + 1)) };
  }
  if (!image.fileId) return null;
  const bucket = new GridFSBucket(await getMongoDb(), { bucketName: "persistent_media" });
  return {
    length: range ? range.end - range.start + 1 : image.size,
    stream: bucket.openDownloadStream(new ObjectId(image.fileId), range ? { end: range.end + 1, start: range.start } : undefined)
  };
}

function publicImageUrl(id: string) {
  const baseUrl = env.SITE_ORIGIN || env.FRONTEND_URL;
  return `${baseUrl}/api/persistent-images/${encodeURIComponent(id)}`;
}

async function saveGridFsFile(input: { buffer: Buffer; contentType: string; fileName: string; metadata: Record<string, unknown> }) {
  const bucket = new GridFSBucket(await getMongoDb(), { bucketName: "persistent_media" });
  const id = new ObjectId();
  await new Promise<void>((resolve, reject) => {
    const stream = bucket.openUploadStreamWithId(id, input.fileName, {
      contentType: input.contentType,
      metadata: input.metadata
    });
    stream.on("error", reject);
    stream.on("finish", () => resolve());
    stream.end(input.buffer);
  });
  return id.toHexString();
}

async function readGridFsFile(fileId: string) {
  const bucket = new GridFSBucket(await getMongoDb(), { bucketName: "persistent_media" });
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = bucket.openDownloadStream(new ObjectId(fileId));
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

async function deleteGridFsFile(fileId: string | null | undefined) {
  if (!fileId || !ObjectId.isValid(fileId)) return;
  const bucket = new GridFSBucket(await getMongoDb(), { bucketName: "persistent_media" });
  await bucket.delete(new ObjectId(fileId)).catch(() => null);
}

async function deletePersistentImageDocument(id: string, guildId: string) {
  const { persistentImages } = await getMongoCollections();
  const existing = await persistentImages.findOne({ _id: id, guildId }, { projection: { fileId: 1, posterFileId: 1 } });
  await persistentImages.deleteOne({ _id: id, guildId });
  await Promise.all([deleteGridFsFile(existing?.fileId), deleteGridFsFile(existing?.posterFileId)]);
}

function publicPosterUrl(id: string) {
  const baseUrl = env.SITE_ORIGIN || env.FRONTEND_URL;
  return `${baseUrl}/api/persistent-images/${encodeURIComponent(id)}/poster`;
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
  if (ext === ".apng") return "image/apng";
  if (ext === ".3gp") return "video/3gpp";
  if (ext === ".avi") return "video/x-msvideo";
  if (ext === ".mkv") return "video/x-matroska";
  if (ext === ".m4v") return "video/x-m4v";
  if (ext === ".mpeg" || ext === ".mpg") return "video/mpeg";
  if (ext === ".flv") return "video/x-flv";
  if (ext === ".wmv") return "video/x-ms-wmv";
  if (ext === ".ts") return "video/mp2t";
  if (ext === ".mts") return "video/vnd.dlna.mpeg-tts";
  if (ext === ".ogv") return "video/ogg";
  if (ext === ".asf") return "video/x-ms-asf";
  if (ext === ".f4v") return "video/x-f4v";
  if (ext === ".vob") return "video/x-ms-vob";
  if (ext === ".rmvb") return "video/vnd.rn-realvideo";
  if (ext === ".mxf") return "application/mxf";
  if (ext === ".gif") return "image/gif";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".png") return "image/png";
  if (ext === ".webm") return "video/webm";
  if (ext === ".webp") return "image/webp";
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
    posterUrl: image.posterBuffer?.length || image.posterFileId ? publicPosterUrl(image._id) : null,
    processingError: image.processingError ?? null,
    processingStatus: image.processingStatus ?? "stored",
    publicUrl: publicImageUrl(image._id),
    size: image.size,
    storageProvider: image.storageProvider ?? "mongodb",
    uploadedAt: image.uploadedAt.toISOString()
  };
}

function toBuffer(value: unknown) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value && typeof value === "object" && "buffer" in value) {
    const nested = (value as { buffer?: unknown }).buffer;
    if (Buffer.isBuffer(nested)) return nested;
    if (nested instanceof Uint8Array || Array.isArray(nested)) return Buffer.from(nested);
  }
  return Buffer.alloc(0);
}

function fileExtension(fileName: string) {
  const extension = path.extname(fileName).replace(".", "").toLowerCase();
  return extension || "bin";
}

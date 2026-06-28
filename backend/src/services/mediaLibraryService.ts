import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import archiver from "archiver";
import yauzl from "yauzl";
import { getMongoCollections, type MongoMediaImportJobItem, type MongoMediaLibraryItem, type MongoMediaSettings } from "../database/mongo";
import { emitRealtime } from "../realtime/events";
import { createLog } from "./logService";
import { getDevBotToken } from "./devBotService";

export const MEDIA_LIMITS = {
  maxZipBytes: 50 * 1024 * 1024,
  maxExtractedBytes: 200 * 1024 * 1024,
  maxFiles: 300,
  maxEmojiBytes: 256 * 1024,
  maxSoundBytes: 10 * 1024 * 1024
} as const;

const TEMP_ROOT = path.join(os.tmpdir(), "media-imports");
const STORAGE_ROOT = path.resolve(process.cwd(), "uploads", "media");
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const SOUND_EXTENSIONS = new Set(["mp3", "ogg", "wav"]);
const ALLOWED_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...SOUND_EXTENSIONS, "json"]);
const BLOCKED_EXTENSIONS = new Set(["bat", "cmd", "exe", "sh", "ps1", "js", "ts", "env", "com", "msi", "dll", "jar", "php", "py"]);
const mediaImportQueues = new Map<string, Promise<void>>();

export type DuplicateMode = "ignore" | "rename" | "replace";

export async function getMediaSettings(botId: string, guildId: string) {
  const { mediaSettings } = await getMongoCollections();
  const existing = await mediaSettings.findOne({ botId, guildId });
  return existing ?? defaultSettings(botId, guildId);
}

export async function saveMediaSettings(input: {
  botId: string;
  guildId: string;
  userId: string;
  settings: Pick<MongoMediaSettings, "enabled" | "allowAuthorizedUsers" | "devOnly" | "duplicateMode" | "soundsLocalOnly" | "maxZipSizeMb" | "maxFilesPerZip">;
}) {
  const now = new Date();
  const settings: MongoMediaSettings = {
    _id: `${input.botId}:${input.guildId}`,
    botId: input.botId,
    guildId: input.guildId,
    ...input.settings,
    maxZipSizeMb: Math.min(50, Math.max(1, input.settings.maxZipSizeMb)),
    maxFilesPerZip: Math.min(300, Math.max(1, input.settings.maxFilesPerZip)),
    createdAt: now,
    updatedAt: now,
    updatedBy: input.userId
  };
  const { mediaSettings } = await getMongoCollections();
  const { _id, createdAt, ...mutableSettings } = settings;
  await mediaSettings.updateOne({ botId: input.botId, guildId: input.guildId }, {
    $set: mutableSettings,
    $setOnInsert: { _id: settings._id, createdAt: now }
  }, { upsert: true });
  await mediaLog(input, "media.settings_updated", "[MEDIA] Configurações da Biblioteca de Mídia atualizadas.");
  return getMediaSettings(input.botId, input.guildId);
}

export async function createImportJob(input: {
  botId: string;
  guildId: string;
  userId: string;
  originalName: string;
  zip: Buffer;
  duplicateMode?: DuplicateMode;
}) {
  const settings = await requireEnabled(input.botId, input.guildId);
  const maxZipBytes = Math.min(MEDIA_LIMITS.maxZipBytes, settings.maxZipSizeMb * 1024 * 1024);
  if (!isZip(input.zip) || input.zip.length > maxZipBytes) {
    throw httpError(`ZIP inválido ou maior que ${settings.maxZipSizeMb} MB.`, 400);
  }

  const id = randomUUID();
  const tempDirectory = path.join(TEMP_ROOT, id);
  await fs.mkdir(tempDirectory, { recursive: true });
  const now = new Date();
  const { mediaImportJobs } = await getMongoCollections();
  await mediaImportJobs.insertOne({
    _id: id,
    botId: input.botId,
    guildId: input.guildId,
    uploadedBy: input.userId,
    zipFileName: safeBaseName(input.originalName || "upload.zip"),
    tempDirectory,
    status: "extracting",
    duplicateMode: input.duplicateMode ?? settings.duplicateMode,
    totalFiles: 0,
    totalEmojis: 0,
    totalSounds: 0,
    successCount: 0,
    errorCount: 0,
    duplicateCount: 0,
    logs: ["ZIP recebido; validação iniciada."],
    createdAt: now,
    updatedAt: now,
    completedAt: null
  });
  await mediaLog(input, "media.zip_uploaded", `[MEDIA_IMPORT] Usuário ${input.userId} enviou o ZIP ${safeBaseName(input.originalName)} para o bot ${input.botId} no servidor ${input.guildId}.`, { jobId: id, size: input.zip.length });

  try {
    const extracted = await extractZip(input.zip, tempDirectory, settings.maxFilesPerZip);
    const { mediaImportJobItems } = await getMongoCollections();
    if (extracted.items.length) await mediaImportJobItems.insertMany(extracted.items.map((item) => ({ ...item, jobId: id })));
    await mediaImportJobs.updateOne({ _id: id }, { $set: {
      status: "waiting_confirmation",
      totalFiles: extracted.totalFiles,
      totalEmojis: extracted.items.filter((item) => item.type === "emoji").length,
      totalSounds: extracted.items.filter((item) => item.type === "sound").length,
      errorCount: extracted.items.filter((item) => item.status === "error").length,
      updatedAt: new Date()
    }, $push: { logs: `${extracted.totalFiles} arquivo(s) encontrados; ${extracted.warnings.length} aviso(s).` } });
    await mediaLog(input, "media.zip_extracted", `[MEDIA_IMPORT] ${extracted.totalFiles} arquivos encontrados e validados.`, { jobId: id, warnings: extracted.warnings });
    return getImportJob(id, input.botId, input.guildId);
  } catch (error) {
    await mediaImportJobs.updateOne({ _id: id }, { $set: { status: "failed", updatedAt: new Date(), completedAt: new Date() }, $push: { logs: errorMessage(error) } });
    await cleanupDirectory(tempDirectory);
    throw error;
  }
}

export async function getImportJob(jobId: string, botId: string, guildId: string) {
  const { mediaImportJobs, mediaImportJobItems } = await getMongoCollections();
  const job = await mediaImportJobs.findOne({ _id: jobId, botId, guildId });
  if (!job) throw httpError("Importação não encontrada.", 404);
  const items = await mediaImportJobItems.find({ jobId }).sort({ name: 1 }).toArray();
  return { ...job, id: job._id, items: items.map((item) => ({ ...item, id: item._id, filePath: undefined })) };
}

export async function listImportJobs(botId: string, guildId: string) {
  const { mediaImportJobs } = await getMongoCollections();
  const jobs = await mediaImportJobs.find({ botId, guildId }).sort({ createdAt: -1 }).limit(50).toArray();
  return jobs.map((job) => ({ ...job, id: job._id, tempDirectory: undefined }));
}

export async function cancelImportJob(jobId: string, botId: string, guildId: string, userId: string) {
  const { mediaImportJobs } = await getMongoCollections();
  const job = await mediaImportJobs.findOne({ _id: jobId, botId, guildId });
  if (!job) throw httpError("Importação não encontrada.", 404);
  if (job.status === "importing") throw httpError("A importação já está sendo processada.", 409);
  await mediaImportJobs.updateOne({ _id: jobId }, { $set: { status: "cancelled", updatedAt: new Date(), completedAt: new Date() }, $push: { logs: "Importação cancelada." } });
  await cleanupDirectory(job.tempDirectory);
  await mediaLog({ botId, guildId, userId }, "media.import_cancelled", `[MEDIA_IMPORT] Importação ${jobId} cancelada.`);
  return { ok: true };
}

export async function confirmImportJob(jobId: string, botId: string, guildId: string, userId: string, duplicateMode?: DuplicateMode) {
  await requireEnabled(botId, guildId);
  const { mediaImportJobs, mediaImportJobItems } = await getMongoCollections();
  const claimed = await mediaImportJobs.findOneAndUpdate(
    { _id: jobId, botId, guildId, status: "waiting_confirmation" },
    { $set: { status: "importing", duplicateMode: duplicateMode ?? "ignore", updatedAt: new Date() }, $push: { logs: "Importação confirmada." } },
    { returnDocument: "after" }
  );
  if (!claimed) throw httpError("Importação indisponível para confirmação.", 409);
  await mediaLog({ botId, guildId, userId }, "media.import_confirmed", `[MEDIA_IMPORT] Importação ${jobId} confirmada.`);
  const queueKey = `${botId}:${guildId}`;
  const previous = mediaImportQueues.get(queueKey) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(() => processImport(claimed._id)).finally(() => {
    if (mediaImportQueues.get(queueKey) === task) mediaImportQueues.delete(queueKey);
  });
  mediaImportQueues.set(queueKey, task);
  void task.catch((error) => console.error("[media-import]", error));
  return getImportJob(jobId, botId, guildId);
}

async function processImport(jobId: string) {
  const { mediaImportJobs, mediaImportJobItems } = await getMongoCollections();
  const job = await mediaImportJobs.findOne({ _id: jobId });
  if (!job) return;
  const allItems = await mediaImportJobItems.find({ jobId }).toArray();
  const items = allItems.filter((item) => item.status === "pending");
  let success = 0, errors = allItems.filter((item) => item.status === "error").length, duplicates = 0;
  try {
    const token = items.some((item) => item.type === "emoji") ? await getDevBotToken(job.botId) : null;
    if (items.some((item) => item.type === "emoji") && !token) throw httpError("Bot sem credencial oficial cadastrada.", 400);
    const discord = token ? await getDiscordEmojiContext(token, job.guildId) : null;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]!;
      emitMediaProgress(job, item, index + 1, items.length, "processing");
      try {
        if (item.type === "sound") {
          await persistLibraryFile(job, item, null);
          success += 1;
          await markItem(item._id, "success");
          await mediaLog(jobContext(job), "media.sound_saved", `[MEDIA_IMPORT] Efeito sonoro ${item.name} salvo.`);
          continue;
        }
        if (!discord) throw new Error("Contexto do Discord indisponível.");
        let name = sanitizeEmojiName(item.name);
        const existing = discord.emojis.find((emoji) => emoji.name === name);
        if (existing && job.duplicateMode === "ignore") {
          duplicates += 1;
          await markItem(item._id, "duplicate", "Emoji já existe.", existing.id);
          await mediaLog(jobContext(job), "media.emoji_duplicate", `[MEDIA_IMPORT] Emoji ${name} ignorado: já existe no servidor.`);
          continue;
        }
        if (existing && job.duplicateMode === "replace") {
          if (!discord.canManage) throw httpError("O bot pode criar expressões, mas não possui permissão para substituir emojis existentes.", 403);
          await discordRequest(`/guilds/${job.guildId}/emojis/${existing.id}`, token!, { method: "DELETE" });
          discord.emojis.splice(discord.emojis.indexOf(existing), 1);
        } else if (existing) {
          name = nextEmojiName(name, discord.emojis.map((emoji) => emoji.name));
        }
        ensureEmojiCapacity(discord, Boolean(item.animated));
        const data = await fs.readFile(item.filePath);
        const created = await discordRequest<{ id: string; name: string; animated?: boolean }>(`/guilds/${job.guildId}/emojis`, token!, {
          method: "POST",
          body: JSON.stringify({ name, image: `data:${item.mimeType};base64,${data.toString("base64")}` })
        });
        discord.emojis.push(created);
        await persistLibraryFile(job, { ...item, name }, created.id);
        await markItem(item._id, "success", null, created.id);
        success += 1;
        await mediaLog(jobContext(job), "media.emoji_sent", `[MEDIA_IMPORT] Emoji ${name} enviado com sucesso para o servidor ${job.guildId}.`);
      } catch (error) {
        errors += 1;
        await markItem(item._id, "error", friendlyDiscordError(error));
        await mediaLog(jobContext(job), "media.item_error", `[MEDIA_IMPORT] Erro em ${item.name}: ${friendlyDiscordError(error)}.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    await mediaImportJobs.updateOne({ _id: jobId }, { $set: { status: "completed", successCount: success, errorCount: errors, duplicateCount: duplicates, updatedAt: new Date(), completedAt: new Date() }, $push: { logs: `Concluída: ${success} sucesso(s), ${duplicates} duplicado(s), ${errors} erro(s).` } });
  } catch (error) {
    await mediaImportJobs.updateOne({ _id: jobId }, { $set: { status: "failed", errorCount: errors + items.length - success - duplicates, updatedAt: new Date(), completedAt: new Date() }, $push: { logs: errorMessage(error) } });
  } finally {
    await cleanupDirectory(job.tempDirectory);
    emitRealtime("media:job-progress", { botId: job.botId, guildId: job.guildId, jobId, status: "finished" });
  }
}

export async function addManualMedia(input: { botId: string; guildId: string; userId: string; name: string; category?: string | null; file: Buffer; originalName: string; mimeType: string; type: "emoji" | "sound"; animated?: boolean }) {
  await requireEnabled(input.botId, input.guildId);
  const format = extension(input.originalName);
  const detected = detectFileType(input.file);
  if ((input.type === "emoji" ? !IMAGE_EXTENSIONS.has(format) : !SOUND_EXTENSIONS.has(format)) || detected !== normalizedFormat(format)) throw httpError("Formato ou conteúdo do arquivo inválido.", 400);
  const limit = input.type === "emoji" ? MEDIA_LIMITS.maxEmojiBytes : MEDIA_LIMITS.maxSoundBytes;
  if (input.file.length > limit) throw httpError("Arquivo maior que o limite permitido.", 400);
  const tempDirectory = path.join(TEMP_ROOT, randomUUID());
  await fs.mkdir(tempDirectory, { recursive: true });
  const filePath = path.join(tempDirectory, `${randomUUID()}.${format}`);
  await fs.writeFile(filePath, input.file, { flag: "wx" });
  const item: MongoMediaImportJobItem = { _id: randomUUID(), jobId: "manual", type: input.type, name: input.type === "emoji" ? sanitizeEmojiName(input.name) : sanitizeMediaName(input.name), originalName: safeBaseName(input.originalName), filePath, format, mimeType: canonicalMime(format), size: input.file.length, animated: input.type === "emoji" ? format === "gif" : null, status: "pending", errorMessage: null, discordEmojiId: null };
  try {
    if (input.type === "sound") {
      const saved = await persistLibraryFile({ botId: input.botId, guildId: input.guildId, uploadedBy: input.userId }, item, null, input.category);
      await mediaLog(input, "media.sound_saved", `[MEDIA] Efeito sonoro ${item.name} adicionado manualmente.`);
      return saved;
    }
    const token = await getDevBotToken(input.botId);
    if (!token) throw httpError("Bot sem credencial oficial cadastrada.", 400);
    const discord = await getDiscordEmojiContext(token, input.guildId);
    if (discord.emojis.some((emoji) => emoji.name === item.name)) throw httpError("Já existe um emoji com este nome no servidor.", 409);
    ensureEmojiCapacity(discord, Boolean(item.animated));
    const created = await discordRequest<{ id: string }>(`/guilds/${input.guildId}/emojis`, token, { method: "POST", body: JSON.stringify({ name: item.name, image: `data:${item.mimeType};base64,${input.file.toString("base64")}` }) });
    const saved = await persistLibraryFile({ botId: input.botId, guildId: input.guildId, uploadedBy: input.userId }, item, created.id, input.category);
    await mediaLog(input, "media.emoji_sent", `[MEDIA] Emoji ${item.name} adicionado manualmente.`);
    return saved;
  } finally { await cleanupDirectory(tempDirectory); }
}

export async function listMediaLibrary(input: { botId: string; guildId: string; type?: string; query?: string }) {
  const { mediaLibrary, emojiLibrary } = await getMongoCollections();
  const filter: Record<string, unknown> = { botId: input.botId, guildId: input.guildId, status: "active" };
  if (input.type === "emoji" || input.type === "sound") filter.type = input.type;
  if (input.query) filter.name = { $regex: escapeRegex(input.query), $options: "i" };
  const items = await mediaLibrary.find(filter).sort({ createdAt: -1 }).limit(300).toArray();
  const clones = input.type === "sound" ? [] : await emojiLibrary.find({ botId: input.botId, destinationGuildId: input.guildId }).sort({ importedAt: -1 }).limit(300).toArray();
  return [
    ...items.map(toMediaDto),
    ...clones.filter((clone) => !input.query || clone.name.toLowerCase().includes(input.query.toLowerCase())).map((clone) => ({ id: `clone:${clone._id}`, botId: clone.botId, guildId: clone.destinationGuildId, type: "emoji" as const, name: clone.name, originalName: clone.name, fileUrl: clone.url, discordEmojiId: clone.targetEmojiId, animated: clone.animated, category: clone.category ?? null, format: clone.animated ? "gif" : "png", size: null, source: "clone" as const, status: "active" as const, createdBy: clone.userId, createdAt: clone.importedAt.toISOString(), updatedAt: clone.lastUpdatedAt.toISOString() }))
  ];
}

export async function deleteMediaItem(id: string, botId: string, guildId: string, userId: string) {
  if (id.startsWith("clone:")) throw httpError("Itens clonados devem ser removidos pelo módulo de clonagem.", 400);
  const { mediaLibrary } = await getMongoCollections();
  const item = await mediaLibrary.findOneAndUpdate({ _id: id, botId, guildId, status: "active" }, { $set: { status: "deleted", updatedAt: new Date() } }, { returnDocument: "before" });
  if (!item) throw httpError("Item não encontrado.", 404);
  await fs.unlink(item.localPath).catch(() => undefined);
  await mediaLog({ botId, guildId, userId }, "media.deleted", `[MEDIA] ${item.type} ${item.name} removido da biblioteca.`);
  return { ok: true };
}

export async function streamMediaExport(input: { botId: string; guildId: string; userId: string; type?: "all" | "static" | "animated" | "sounds" }, output: NodeJS.WritableStream) {
  const items = await listMediaLibrary({ botId: input.botId, guildId: input.guildId });
  const { mediaLibrary } = await getMongoCollections();
  const selected = items.filter((item) => input.type === "sounds" ? item.type === "sound" : input.type === "static" ? item.type === "emoji" && !item.animated : input.type === "animated" ? item.type === "emoji" && item.animated : true);
  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.pipe(output);
  const manifestItems: Array<Record<string, unknown>> = [];
  for (const item of selected) {
    const folder = item.type === "sound" ? "sounds" : item.animated ? "emojis/animated" : "emojis/static";
    const file = `${folder}/${safeBaseName(`${item.name}.${item.format}`)}`;
    const stored = item.id.startsWith("clone:") ? null : await mediaLibrary.findOne({ _id: item.id, botId: input.botId, guildId: input.guildId });
    const localPath = stored?.localPath;
    if (localPath && await exists(localPath)) archive.file(localPath, { name: file });
    else if (item.fileUrl?.startsWith("http")) {
      const response = await fetch(item.fileUrl).catch(() => null);
      if (response?.ok) archive.append(Buffer.from(await response.arrayBuffer()), { name: file }); else continue;
    } else continue;
    manifestItems.push({ type: item.type, name: item.name, animated: item.animated ?? undefined, file, discordEmojiId: item.discordEmojiId ?? undefined, source: item.source });
  }
  archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), guildId: input.guildId, botId: input.botId, totalEmojis: manifestItems.filter((item) => item.type === "emoji").length, totalAnimated: manifestItems.filter((item) => item.type === "emoji" && item.animated).length, totalStatic: manifestItems.filter((item) => item.type === "emoji" && !item.animated).length, totalSounds: manifestItems.filter((item) => item.type === "sound").length, items: manifestItems }, null, 2), { name: "manifest.json" });
  await archive.finalize();
  await mediaLog(input, "media.export_created", `[MEDIA_EXPORT] ZIP gerado com ${manifestItems.length} item(ns).`);
}

async function extractZip(buffer: Buffer, directory: string, maxFiles: number) {
  const zip = await openZip(buffer);
  const items: Omit<MongoMediaImportJobItem, "jobId">[] = [];
  const warnings: string[] = [];
  let manifestItems: Array<{ file?: string; name?: string }> = [];
  let totalFiles = 0, totalSize = 0;
  return new Promise<{ items: Omit<MongoMediaImportJobItem, "jobId">[]; warnings: string[]; totalFiles: number }>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => { if (!settled) { settled = true; zip.close(); reject(error); } };
    zip.on("error", fail);
    zip.on("end", () => {
      for (const item of items) {
        const metadata = manifestItems.find((entry) => entry.file && safeBaseName(entry.file) === item.originalName);
        if (metadata?.name) item.name = item.type === "emoji" ? sanitizeEmojiName(metadata.name) : sanitizeMediaName(metadata.name);
      }
      if (!settled) { settled = true; resolve({ items, warnings, totalFiles }); }
    });
    zip.on("entry", (entry) => {
      void (async () => {
        const rawName = entry.fileName;
        if (/\/$/.test(rawName)) { zip.readEntry(); return; }
        totalFiles += 1;
        totalSize += entry.uncompressedSize;
        if (totalFiles > Math.min(maxFiles, MEDIA_LIMITS.maxFiles) || totalSize > MEDIA_LIMITS.maxExtractedBytes) throw httpError("ZIP bloqueado: quantidade ou tamanho extraído excede o limite.", 400);
        if (!safeZipPath(rawName)) { warnings.push(`${rawName}: caminho perigoso bloqueado.`); zip.readEntry(); return; }
        const ext = extension(rawName);
        if (BLOCKED_EXTENSIONS.has(ext) || !ALLOWED_EXTENSIONS.has(ext)) { warnings.push(`${rawName}: extensão bloqueada.`); zip.readEntry(); return; }
        const itemLimit = ext === "json" ? 1024 * 1024 : SOUND_EXTENSIONS.has(ext) ? MEDIA_LIMITS.maxSoundBytes : MEDIA_LIMITS.maxEmojiBytes;
        if (entry.uncompressedSize > itemLimit) {
          if (ext === "json") { warnings.push(`${rawName}: metadados grandes demais.`); zip.readEntry(); return; }
          const type = IMAGE_EXTENSIONS.has(ext) ? "emoji" as const : "sound" as const;
          items.push({ _id: randomUUID(), type, name: type === "emoji" ? sanitizeEmojiName(path.parse(rawName).name) : sanitizeMediaName(path.parse(rawName).name), originalName: safeBaseName(rawName), filePath: "", format: ext, mimeType: canonicalMime(ext), size: entry.uncompressedSize, animated: type === "emoji" ? ext === "gif" : null, status: "error", errorMessage: "Arquivo maior que o limite permitido.", discordEmojiId: null });
          warnings.push(`${rawName}: arquivo grande demais.`); zip.readEntry(); return;
        }
        const data = await readEntry(zip, entry, itemLimit);
        if (ext === "json") {
          if (path.posix.basename(rawName).toLowerCase() === "manifest.json") { try { const manifest = JSON.parse(data.toString("utf8")) as { items?: Array<{ file?: string; name?: string }> }; manifestItems = Array.isArray(manifest.items) ? manifest.items.slice(0, MEDIA_LIMITS.maxFiles) : []; } catch { warnings.push("manifest.json inválido; autodetecção utilizada."); } }
          zip.readEntry(); return;
        }
        const type = IMAGE_EXTENSIONS.has(ext) ? "emoji" as const : "sound" as const;
        const expected = normalizedFormat(ext);
        const detected = detectFileType(data);
        const tooLarge = data.length > (type === "emoji" ? MEDIA_LIMITS.maxEmojiBytes : MEDIA_LIMITS.maxSoundBytes);
        const invalid = detected !== expected;
        const storedName = `${randomUUID()}.${ext}`;
        const filePath = path.join(directory, storedName);
        if (!invalid && !tooLarge) await fs.writeFile(filePath, data, { flag: "wx" });
        items.push({ _id: randomUUID(), type, name: type === "emoji" ? sanitizeEmojiName(path.parse(rawName).name) : sanitizeMediaName(path.parse(rawName).name), originalName: safeBaseName(rawName), filePath, format: ext, mimeType: canonicalMime(ext), size: data.length, animated: type === "emoji" ? ext === "gif" : null, status: invalid || tooLarge ? "error" : "pending", errorMessage: invalid ? "Conteúdo não corresponde à extensão." : tooLarge ? "Arquivo maior que o limite permitido." : null, discordEmojiId: null });
        if (invalid || tooLarge) warnings.push(`${rawName}: ${invalid ? "conteúdo inválido" : "arquivo grande demais"}.`);
        zip.readEntry();
      })().catch(fail);
    });
    zip.readEntry();
  });
}

async function persistLibraryFile(job: { botId: string; guildId: string; uploadedBy: string }, item: MongoMediaImportJobItem, discordEmojiId: string | null, category: string | null = null) {
  const id = randomUUID();
  const directory = path.join(STORAGE_ROOT, safeSegment(job.botId), safeSegment(job.guildId));
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, `${id}.${item.format}`);
  await fs.copyFile(item.filePath, target);
  const now = new Date();
  const doc: MongoMediaLibraryItem = { _id: id, botId: job.botId, guildId: job.guildId, type: item.type, name: item.name, originalName: item.originalName, fileUrl: `/uploads/media/${encodeURIComponent(job.botId)}/${encodeURIComponent(job.guildId)}/${id}.${item.format}`, localPath: target, discordEmojiId, animated: item.animated, category, format: item.format, mimeType: item.mimeType, size: item.size, source: item.jobId === "manual" ? "manual_upload" : "zip_import", status: "active", createdBy: job.uploadedBy, createdAt: now, updatedAt: now };
  const { mediaLibrary } = await getMongoCollections();
  await mediaLibrary.insertOne(doc);
  return toMediaDto(doc);
}

async function getDiscordEmojiContext(token: string, guildId: string) {
  const guilds = await discordRequest<Array<{ id: string; permissions: string }>>("/users/@me/guilds", token);
  const guild = guilds.find((item) => item.id === guildId);
  if (!guild) throw httpError("O bot não está presente neste servidor.", 400);
  const permissions = BigInt(guild.permissions || "0");
  const administrator = (permissions & (1n << 3n)) !== 0n;
  const canCreate = administrator || (permissions & (1n << 43n)) !== 0n;
  const canManage = administrator || (permissions & (1n << 30n)) !== 0n;
  if (!canCreate) throw httpError("Não foi possível enviar os emojis. O bot não possui permissão para criar expressões neste servidor.", 403);
  const [emojis, guildDetails] = await Promise.all([
    discordRequest<Array<{ id: string; name: string; animated?: boolean }>>(`/guilds/${guildId}/emojis`, token),
    discordRequest<{ premium_tier?: number }>(`/guilds/${guildId}`, token)
  ]);
  const limits = [50, 100, 150, 250];
  return { emojis, canManage, emojiLimit: limits[Math.min(3, Math.max(0, guildDetails.premium_tier ?? 0))]! };
}

function ensureEmojiCapacity(context: { emojis: Array<{ animated?: boolean }>; emojiLimit: number }, animated: boolean) {
  const used = context.emojis.filter((emoji) => Boolean(emoji.animated) === animated).length;
  if (used >= context.emojiLimit) throw httpError(`O servidor não possui espaço para novos emojis ${animated ? "animados" : "estáticos"}.`, 400);
}

async function discordRequest<T>(endpoint: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`https://discord.com/api/v10${endpoint}`, { ...init, headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json", ...init.headers } });
  const payload = response.status === 204 ? null : await response.json().catch(() => null) as { message?: string; retry_after?: number } | null;
  if (response.status === 429 && payload?.retry_after) { await new Promise((resolve) => setTimeout(resolve, Math.ceil(payload.retry_after! * 1000))); return discordRequest<T>(endpoint, token, init); }
  if (!response.ok) throw httpError(payload?.message || `Discord respondeu ${response.status}.`, response.status);
  return payload as T;
}

async function requireEnabled(botId: string, guildId: string) { const settings = await getMediaSettings(botId, guildId); if (!settings.enabled) throw httpError("A Biblioteca de Mídia está desativada para este bot e servidor.", 403); return settings; }
function defaultSettings(botId: string, guildId: string): MongoMediaSettings { const now = new Date(); return { _id: `${botId}:${guildId}`, botId, guildId, enabled: false, allowAuthorizedUsers: true, devOnly: false, duplicateMode: "ignore", soundsLocalOnly: true, maxZipSizeMb: 50, maxFilesPerZip: 300, createdAt: now, updatedAt: now, updatedBy: null }; }
function openZip(buffer: Buffer) { return new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, decodeStrings: true }, (error, zip) => error || !zip ? reject(error || new Error("ZIP inválido.")) : resolve(zip))); }
function readEntry(zip: yauzl.ZipFile, entry: yauzl.Entry, limit: number) { return new Promise<Buffer>((resolve, reject) => zip.openReadStream(entry, (error, stream) => { if (error || !stream) return reject(error || new Error("Entrada inválida.")); const chunks: Buffer[] = []; let size = 0; stream.on("data", (chunk: Buffer) => { size += chunk.length; if (size > limit) stream.destroy(httpError("Arquivo extraído excede o limite.", 400)); else chunks.push(chunk); }); stream.on("error", reject); stream.on("end", () => resolve(Buffer.concat(chunks))); })); }
function isZip(buffer: Buffer) { return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && ((buffer[2] === 0x03 && buffer[3] === 0x04) || (buffer[2] === 0x05 && buffer[3] === 0x06)); }
function safeZipPath(value: string) { if (!value || value.includes("\0") || value.includes("\\") || /^[a-zA-Z]:/.test(value) || value.startsWith("/")) return false; const normalized = path.posix.normalize(value); return normalized !== ".." && !normalized.startsWith("../") && !path.posix.isAbsolute(normalized); }
function detectFileType(data: Buffer) { if (data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "png"; if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpg"; if (data.subarray(0, 6).toString("ascii") === "GIF87a" || data.subarray(0, 6).toString("ascii") === "GIF89a") return "gif"; if (data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return "webp"; if (data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WAVE") return "wav"; if (data.subarray(0, 4).toString("ascii") === "OggS") return "ogg"; if (data.subarray(0, 3).toString("ascii") === "ID3" || (data[0] === 0xff && ((data[1] ?? 0) & 0xe0) === 0xe0)) return "mp3"; return "unknown"; }
function normalizedFormat(ext: string) { return ext === "jpeg" ? "jpg" : ext; }
function canonicalMime(ext: string) { return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav" } as Record<string, string>)[ext] || "application/octet-stream"; }
function sanitizeEmojiName(value: string) { const name = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32); return (name.length >= 2 ? name : `emoji_${name || "item"}`).slice(0, 32); }
function sanitizeMediaName(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").slice(0, 64) || "media"; }
function nextEmojiName(base: string, names: string[]) { const set = new Set(names); for (let i = 1; i < 10_000; i += 1) { const suffix = `_${i}`; const candidate = `${base.slice(0, 32 - suffix.length)}${suffix}`; if (!set.has(candidate)) return candidate; } return `${base.slice(0, 25)}_${Date.now().toString().slice(-6)}`; }
function extension(value: string) { return path.extname(value).slice(1).toLowerCase(); }
function safeBaseName(value: string) { return path.basename(value.replace(/\\/g, "/")).replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120) || "arquivo"; }
function safeSegment(value: string) { return value.replace(/[^a-zA-Z0-9_-]/g, "_"); }
function toMediaDto(item: MongoMediaLibraryItem) { return { ...item, id: item._id, localPath: undefined, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() }; }
function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function markItem(id: string, status: MongoMediaImportJobItem["status"], errorMessage: string | null = null, discordEmojiId: string | null = null) { return getMongoCollections().then(({ mediaImportJobItems }) => mediaImportJobItems.updateOne({ _id: id }, { $set: { status, errorMessage, discordEmojiId } })); }
function emitMediaProgress(job: { botId: string; guildId: string; _id: string }, item: MongoMediaImportJobItem, current: number, total: number, status: string) { emitRealtime("media:job-progress", { botId: job.botId, guildId: job.guildId, jobId: job._id, itemId: item._id, name: item.name, current, total, status }); }
function jobContext(job: { botId: string; guildId: string; uploadedBy: string }) { return { botId: job.botId, guildId: job.guildId, userId: job.uploadedBy }; }
function mediaLog(input: { botId: string; guildId: string; userId: string }, type: string, message: string, metadata?: unknown) { return createLog({ botId: input.botId, guildId: input.guildId, userId: input.userId, type, message, metadata }); }
function httpError(message: string, statusCode: number) { return Object.assign(new Error(message), { statusCode }); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Erro desconhecido."; }
function friendlyDiscordError(error: unknown) { const message = errorMessage(error); if (/permissions|permiss|Missing Access|Missing Permissions/i.test(message)) return "O bot não possui permissão para gerenciar emojis neste servidor"; if (/maximum|slots|limit/i.test(message)) return "O servidor não possui espaço para novos emojis"; return message; }
function cleanupDirectory(directory: string) { const resolved = path.resolve(directory); if (!resolved.startsWith(path.resolve(TEMP_ROOT) + path.sep)) return Promise.resolve(); return fs.rm(resolved, { recursive: true, force: true }); }
async function exists(file: string) { try { await fs.access(file); return true; } catch { return false; } }

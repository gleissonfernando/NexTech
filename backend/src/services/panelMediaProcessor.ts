import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type ProcessedPanelMedia = {
  animated: boolean;
  buffer: Buffer;
  extension: string;
  inputHash: string;
  mimeType: string;
  originalMimeType: string;
  originalSize: number;
  posterBuffer: Buffer | null;
  posterMimeType: string | null;
  processingError: string | null;
  processingStatus: "stored" | "converted" | "failed";
};

const nodeRequire = createRequire(__filename);
const BROWSER_SAFE_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm", "video/ogg"]);
const BROWSER_SAFE_IMAGE_MIME_TYPES = new Set(["image/apng", "image/gif", "image/jpeg", "image/png", "image/webp"]);

export const PANEL_MEDIA_MIME_EXTENSIONS: Record<string, string> = {
  "image/apng": "apng",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/3gpp": "3gp",
  "video/3gpp2": "3g2",
  "video/avi": "avi",
  "video/mp2t": "ts",
  "video/mp4": "mp4",
  "video/mpeg": "mpeg",
  "video/ogg": "ogv",
  "video/quicktime": "mov",
  "video/vnd.dlna.mpeg-tts": "mts",
  "video/webm": "webm",
  "video/x-flv": "flv",
  "video/x-m4v": "m4v",
  "video/x-matroska": "mkv",
  "video/x-ms-asf": "asf",
  "video/x-ms-wmv": "wmv",
  "video/x-msvideo": "avi",
  "video/x-mxf": "mxf",
  "video/x-ms-vob": "vob",
  "application/mxf": "mxf",
  "application/octet-stream": "bin"
};

export async function processPanelMedia(input: { buffer: Buffer; mimeType: string; originalName?: string | null }): Promise<ProcessedPanelMedia> {
  if (!Buffer.isBuffer(input.buffer) || input.buffer.length === 0) {
    throw Object.assign(new Error("Arquivo de mídia obrigatório."), { statusCode: 400 });
  }

  const originalMimeType = resolveInputMimeType(input.buffer, input.mimeType, input.originalName);
  const inputHash = sha256(input.buffer);
  const extension = PANEL_MEDIA_MIME_EXTENSIONS[originalMimeType] ?? extensionFromName(input.originalName) ?? "bin";
  const isVideo = originalMimeType.startsWith("video/") || VIDEO_EXTENSIONS.has(extension);
  const isAnimation = ["image/apng", "image/gif", "image/webp"].includes(originalMimeType);

  if (!isVideo && !isAnimation && !BROWSER_SAFE_IMAGE_MIME_TYPES.has(originalMimeType)) {
    throw Object.assign(new Error(`Formato de mídia não identificado (${originalMimeType}). O arquivo pode estar corrompido ou vazio.`), { statusCode: 400 });
  }

  if (!isVideo) {
    return {
      animated: isAnimation,
      buffer: input.buffer,
      extension,
      inputHash,
      mimeType: originalMimeType,
      originalMimeType,
      originalSize: input.buffer.length,
      posterBuffer: null,
      posterMimeType: null,
      processingError: null,
      processingStatus: "stored"
    };
  }

  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) {
    return {
      animated: true,
      buffer: input.buffer,
      extension,
      inputHash,
      mimeType: originalMimeType,
      originalMimeType,
      originalSize: input.buffer.length,
      posterBuffer: null,
      posterMimeType: null,
      processingError: "FFmpeg não encontrado no backend; mídia salva no formato original.",
      processingStatus: BROWSER_SAFE_VIDEO_MIME_TYPES.has(originalMimeType) ? "stored" : "failed"
    };
  }

  const probe = await probeMedia(input.buffer, extension, ffmpegPath).catch((error) => ({ raw: readError(error) }));
  const compatible = isBrowserCompatibleVideo(originalMimeType, probe.raw);
  const posterBuffer = await generatePoster(input.buffer, extension, ffmpegPath).catch(() => null);

  if (compatible) {
    return {
      animated: true,
      buffer: input.buffer,
      extension,
      inputHash,
      mimeType: originalMimeType,
      originalMimeType,
      originalSize: input.buffer.length,
      posterBuffer,
      posterMimeType: posterBuffer ? "image/jpeg" : null,
      processingError: null,
      processingStatus: "stored"
    };
  }

  try {
    const converted = await convertToBrowserMp4(input.buffer, extension, ffmpegPath);
    return {
      animated: true,
      buffer: converted,
      extension: "mp4",
      inputHash,
      mimeType: "video/mp4",
      originalMimeType,
      originalSize: input.buffer.length,
      posterBuffer,
      posterMimeType: posterBuffer ? "image/jpeg" : null,
      processingError: null,
      processingStatus: "converted"
    };
  } catch (error) {
    if (BROWSER_SAFE_VIDEO_MIME_TYPES.has(originalMimeType)) {
      return {
        animated: true,
        buffer: input.buffer,
        extension,
        inputHash,
        mimeType: originalMimeType,
        originalMimeType,
        originalSize: input.buffer.length,
        posterBuffer,
        posterMimeType: posterBuffer ? "image/jpeg" : null,
        processingError: `Conversão não concluída; mídia salva no formato original. ${readError(error)}`,
        processingStatus: "failed"
      };
    }

    throw Object.assign(new Error(`Não foi possível recuperar ou converter este vídeo. ${readError(error)}`), { statusCode: 422 });
  }
}

function isBrowserCompatibleVideo(mimeType: string, probeOutput: string) {
  if (mimeType === "video/webm") return /Video:\s*(vp8|vp9|av1)/i.test(probeOutput);
  if (mimeType === "video/ogg") return /Video:\s*(theora|vp8|vp9)/i.test(probeOutput);
  if (mimeType !== "video/mp4") return false;
  const hasSafeVideo = /Video:\s*(h264|avc1)/i.test(probeOutput);
  const hasAudio = /Audio:/i.test(probeOutput);
  const hasSafeAudio = /Audio:\s*(aac|mp3|mp4a)/i.test(probeOutput);
  return hasSafeVideo && (!hasAudio || hasSafeAudio);
}

async function probeMedia(buffer: Buffer, extension: string, ffmpegPath: string) {
  const temp = await writeTempFile(buffer, extension);
  try {
    const result = await run(ffmpegPath, ["-hide_banner", "-i", temp.input], 20_000, true);
    return { raw: `${result.stdout}\n${result.stderr}` };
  } finally {
    await fs.rm(temp.dir, { force: true, recursive: true }).catch(() => null);
  }
}

async function convertToBrowserMp4(buffer: Buffer, extension: string, ffmpegPath: string) {
  const temp = await writeTempFile(buffer, extension);
  const output = path.join(temp.dir, "output.mp4");
  try {
    await run(ffmpegPath, [
      "-hide_banner",
      "-y",
      "-err_detect",
      "ignore_err",
      "-i",
      temp.input,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      output
    ], 0);
    return fs.readFile(output);
  } finally {
    await fs.rm(temp.dir, { force: true, recursive: true }).catch(() => null);
  }
}

async function generatePoster(buffer: Buffer, extension: string, ffmpegPath: string) {
  const temp = await writeTempFile(buffer, extension);
  const output = path.join(temp.dir, "poster.jpg");
  try {
    await run(ffmpegPath, ["-hide_banner", "-y", "-i", temp.input, "-vf", "thumbnail,scale=640:-1", "-frames:v", "1", "-q:v", "3", output], 30_000);
    return fs.readFile(output);
  } finally {
    await fs.rm(temp.dir, { force: true, recursive: true }).catch(() => null);
  }
}

async function writeTempFile(buffer: Buffer, extension: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "panel-media-"));
  const input = path.join(dir, `input.${sanitizeExtension(extension)}`);
  await fs.writeFile(input, buffer);
  return { dir, input };
}

function run(command: string, args: string[], timeoutMs: number, allowNonZero = false) {
  return new Promise<{ stderr: string; stdout: string }>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = timeoutMs > 0 ? setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Processamento excedeu o tempo limite desta etapa."));
    }, timeoutMs) : null;

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      const result = { stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
      if (code === 0 || allowNonZero) resolve(result);
      else reject(new Error(result.stderr || `FFmpeg terminou com código ${code}.`));
    });
  });
}

function resolveInputMimeType(buffer: Buffer, mimeType: string, originalName?: string | null) {
  const normalized = mimeType.trim().toLowerCase();
  const byMime = PANEL_MEDIA_MIME_EXTENSIONS[normalized] ? normalized : null;
  const detected = detectMediaMimeType(buffer);
  const byExtension = mimeFromExtension(extensionFromName(originalName));
  return detected ?? byMime ?? byExtension ?? "application/octet-stream";
}

function detectMediaMimeType(buffer: Buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return isApng(buffer) ? "image/apng" : "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))) return "image/gif";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "video/webm";
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") {
    const header = buffer.toString("ascii", 8, Math.min(buffer.length, 80));
    if (header.includes("qt  ")) return "video/quicktime";
    if (/3gp/i.test(header)) return "video/3gpp";
    if (/M4V|m4v/i.test(header)) return "video/x-m4v";
    return "video/mp4";
  }
  if (buffer.length >= 4 && buffer.toString("ascii", 0, 3) === "FLV") return "video/x-flv";
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x30, 0x26, 0xb2, 0x75]))) return "video/x-ms-asf";
  if (buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "AVI ") return "video/x-msvideo";
  if (buffer.length >= 4 && buffer[0] === 0x47) return "video/mp2t";
  return null;
}

function isApng(buffer: Buffer) {
  return buffer.includes(Buffer.from("acTL", "ascii"));
}

function mimeFromExtension(extension: string | null) {
  if (!extension) return null;
  return ({
    "3gp": "video/3gpp",
    "3g2": "video/3gpp2",
    apng: "image/apng",
    asf: "video/x-ms-asf",
    avi: "video/x-msvideo",
    f4v: "video/x-f4v",
    flv: "video/x-flv",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    m4v: "video/x-m4v",
    mkv: "video/x-matroska",
    mov: "video/quicktime",
    mp4: "video/mp4",
    mpeg: "video/mpeg",
    mpg: "video/mpeg",
    mts: "video/vnd.dlna.mpeg-tts",
    mxf: "application/mxf",
    ogv: "video/ogg",
    png: "image/png",
    rmvb: "video/vnd.rn-realvideo",
    ts: "video/mp2t",
    vob: "video/x-ms-vob",
    webm: "video/webm",
    webp: "image/webp",
    wmv: "video/x-ms-wmv"
  } as Record<string, string>)[extension] ?? null;
}

function resolveFfmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const resolved = nodeRequire("ffmpeg-static");
    return typeof resolved === "string" ? resolved : null;
  } catch {
    return "ffmpeg";
  }
}

function extensionFromName(value: string | null | undefined) {
  const extension = path.extname(value ?? "").replace(".", "").toLowerCase();
  return extension ? sanitizeExtension(extension) : null;
}

function sanitizeExtension(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").slice(0, 12) || "bin";
}

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const VIDEO_EXTENSIONS = new Set(["3gp", "3g2", "avi", "asf", "f4v", "flv", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "mts", "mxf", "ogv", "rmvb", "ts", "vob", "webm", "wmv"]);

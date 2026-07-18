import { Router } from "express";
import { z } from "zod";
import { getPersistentImage } from "../services/persistentImageStorageService";

const imageIdSchema = z.string().uuid();

export const persistentImagesRouter = Router();

persistentImagesRouter.get("/:imageId", async (req, res, next) => {
  try {
    const imageId = imageIdSchema.parse(req.params.imageId);
    const image = await getPersistentImage(imageId);

    if (!image) {
      return res.status(404).json({ message: "Imagem não encontrada." });
    }

    const buffer = toImageBuffer(image.buffer);

    if (!buffer.length) {
      return res.status(404).json({ message: "Arquivo da imagem vazio ou inválido." });
    }

    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Content-Type", image.mimeType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("X-Content-Type-Options", "nosniff");

    const range = parseRangeHeader(req.headers.range, buffer.length);
    if (range === "invalid") {
      res.setHeader("Content-Range", `bytes */${buffer.length}`);
      return res.status(416).end();
    }

    if (range) {
      const chunk = buffer.subarray(range.start, range.end + 1);
      res.setHeader("Content-Length", String(chunk.length));
      res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${buffer.length}`);
      return res.status(206).end(chunk);
    }

    res.setHeader("Content-Length", String(buffer.length));
    return res.end(buffer);
  } catch (error) {
    return next(error);
  }
});

function parseRangeHeader(value: string | undefined, size: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match) return "invalid" as const;

  const [, rawStart, rawEnd] = match;
  let start = rawStart ? Number(rawStart) : NaN;
  let end = rawEnd ? Number(rawEnd) : NaN;

  if (!Number.isFinite(start) && Number.isFinite(end)) {
    start = Math.max(0, size - end);
    end = size - 1;
  } else {
    if (!Number.isFinite(start)) start = 0;
    if (!Number.isFinite(end)) end = size - 1;
  }

  if (start < 0 || end < start || start >= size) return "invalid" as const;
  return { end: Math.min(end, size - 1), start };
}

function toImageBuffer(value: unknown) {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }

  if (value && typeof value === "object" && "buffer" in value) {
    const nested = (value as { buffer?: unknown }).buffer;

    if (Buffer.isBuffer(nested)) {
      return nested;
    }

    if (nested instanceof Uint8Array || Array.isArray(nested)) {
      return Buffer.from(nested);
    }
  }

  return Buffer.alloc(0);
}

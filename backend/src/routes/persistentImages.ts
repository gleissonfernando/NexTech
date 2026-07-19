import { Router } from "express";
import { z } from "zod";
import { getPersistentImage, openPersistentImageStream, readPersistentPosterBuffer } from "../services/persistentImageStorageService";

const imageIdSchema = z.string().uuid();

export const persistentImagesRouter = Router();

persistentImagesRouter.get("/:imageId/poster", async (req, res, next) => {
  try {
    const imageId = imageIdSchema.parse(req.params.imageId);
    const image = await getPersistentImage(imageId);

    if (!image) {
      return res.status(404).json({ message: "Miniatura não encontrada para esta mídia." });
    }

    const buffer = await readPersistentPosterBuffer(image);
    if (!buffer.length) {
      return res.status(404).json({ message: "Miniatura não encontrada para esta mídia." });
    }

    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Content-Type", image.posterMimeType || "image/jpeg");
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.end(buffer);
  } catch (error) {
    return next(error);
  }
});

persistentImagesRouter.get("/:imageId", async (req, res, next) => {
  try {
    const imageId = imageIdSchema.parse(req.params.imageId);
    const image = await getPersistentImage(imageId);

    if (!image) {
      return res.status(404).json({ message: "Mídia não encontrada." });
    }

    const size = image.size;

    if (!size) {
      return res.status(404).json({ message: "Arquivo da mídia vazio ou inválido." });
    }

    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Content-Type", image.mimeType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("X-Content-Type-Options", "nosniff");

    const range = parseRangeHeader(req.headers.range, size);
    if (range === "invalid") {
      res.setHeader("Content-Range", `bytes */${size}`);
      return res.status(416).end();
    }

    const payload = await openPersistentImageStream(image, range);
    if (!payload) {
      return res.status(404).json({ message: "Arquivo da mídia não encontrado no armazenamento." });
    }

    if (range) {
      res.setHeader("Content-Length", String(payload.length));
      res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
      res.status(206);
      payload.stream.pipe(res);
      return;
    }

    res.setHeader("Content-Length", String(payload.length));
    payload.stream.pipe(res);
    return;
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

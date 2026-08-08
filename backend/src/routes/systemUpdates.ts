import { Router } from "express";
import { isBotRequest } from "../middleware/auth";
import { getMongoDb } from "../database/mongo";

const COLLECTION = "system_update_changelogs";

export const systemUpdatesRouter = Router();

systemUpdatesRouter.post("/internal/changelog", async (req, res, next) => {
  try {
    if (!isBotRequest(req)) {
      return res.status(401).json({ error: "Token interno inválido." });
    }

    const changelog = normalizeChangelog(req.body?.changelog);
    const publication = req.body?.publication && typeof req.body.publication === "object" ? req.body.publication : {};
    if (!changelog) {
      return res.status(400).json({ error: "Changelog inválido." });
    }

    const db = await getMongoDb();
    const collection = db.collection(COLLECTION);
    await collection.createIndex({ commitHash: 1 }, { unique: true });
    await collection.createIndex({ publishedAt: -1 });
    await collection.updateOne(
      { commitHash: changelog.commitHash },
      {
        $set: {
          ...changelog,
          publication,
          updatedAt: new Date().toISOString()
        },
        $setOnInsert: {
          createdAt: new Date().toISOString()
        }
      },
      { upsert: true }
    );

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

function normalizeChangelog(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const commitHash = asText(record.commitHash, 128);
  const version = asText(record.version, 48);
  const title = asText(record.title, 180);
  const publishedAt = asText(record.publishedAt, 64);
  if (!commitHash || !version || !title || !publishedAt) return null;

  return {
    ...record,
    affectedModules: Array.isArray(record.affectedModules) ? record.affectedModules.map((item) => asText(item, 120)).filter(Boolean) : [],
    categories: normalizeCategories(record.categories),
    commitHash,
    commitShort: asText(record.commitShort, 24),
    description: asText(record.description, 240),
    files: Array.isArray(record.files) ? record.files.slice(0, 250) : [],
    id: asText(record.id, 128) || commitHash,
    importantInfo: Array.isArray(record.importantInfo) ? record.importantInfo.map((item) => asText(item, 220)).filter(Boolean) : [],
    internalIdentifier: asText(record.internalIdentifier, 160),
    publishedAt,
    responsible: asText(record.responsible, 120),
    restartRequired: Boolean(record.restartRequired),
    status: asText(record.status, 48),
    statusLabel: asText(record.statusLabel, 160),
    title,
    version
  };
}

function normalizeCategories(value: unknown) {
  const categories = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    correcoes: normalizeItems(categories.correcoes),
    melhorias: normalizeItems(categories.melhorias),
    novidades: normalizeItems(categories.novidades)
  };
}

function normalizeItems(value: unknown) {
  return Array.isArray(value) ? value.map((item) => asText(item, 220)).filter(Boolean).slice(0, 20) : [];
}

function asText(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

import { randomUUID } from "node:crypto";
import { APP_BASE_URL } from "../config/appUrl";
import { getMongoDb } from "../database/mongo";

let started = false;

export async function runTranscriptUrlStartupMigration() {
  if (started) return;
  started = true;

  try {
    const db = await getMongoDb();
    const transcripts = db.collection("transcripts");
    const backups = db.collection<{ _id: string; [key: string]: unknown }>("transcript_url_migration_backups");
    const query = {
      $or: [
        { websiteUrl: { $regex: /^https?:\/\//i } },
        { htmlPath: { $regex: /^https?:\/\//i } },
        { txtPath: { $regex: /^https?:\/\//i } },
        { pdfPath: { $regex: /^https?:\/\//i } }
      ]
    };
    const candidates = await transcripts.find(query, {
      projection: { _id: 1, websiteUrl: 1, htmlPath: 1, txtPath: 1, pdfPath: 1 }
    }).toArray();

    if (!candidates.length) {
      console.log("[TRANSCRIPT] Migração de URLs: nenhum registro antigo encontrado.");
      return;
    }

    const runId = `startup-${new Date().toISOString()}-${randomUUID()}`;
    await backups.insertOne({
      _id: runId,
      appBaseUrl: APP_BASE_URL,
      count: candidates.length,
      createdAt: new Date(),
      records: candidates
    });

    let modified = 0;
    for (const item of candidates) {
      const transcriptId = String(item._id);
      const result = await transcripts.updateOne(
        { _id: item._id },
        {
          $set: {
            htmlPath: `/transcripts/${encodeURIComponent(transcriptId)}`,
            txtPath: `/transcripts/${encodeURIComponent(transcriptId)}/export.txt`,
            websiteUrl: `${APP_BASE_URL}/transcripts/${encodeURIComponent(transcriptId)}`
          }
        }
      );
      modified += result.modifiedCount;
    }

    console.log(`[TRANSCRIPT] Migração de URLs concluída. backup=${runId} encontrados=${candidates.length} alterados=${modified}.`);
  } catch (error) {
    console.warn("[TRANSCRIPT_ERROR] Etapa: migração de URLs", error instanceof Error ? error.message : error);
  }
}

import { randomUUID } from "node:crypto";
import { getMongoCollections, type MongoDisplayPanel, type MongoDisplayPanelButton, type MongoDisplayPanelPublication } from "../database/mongo";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoom } from "../realtime/events";
import { createLog } from "./logService";

export const DISPLAY_PANEL_MODULE_ID = "display-panel";

type ServiceError = Error & { statusCode?: number };

export type SaveDisplayPanelInput = {
  name: string;
  title: string;
  description: string;
  content?: string | null;
  color?: string | null;
  imageUrl?: string | null;
  videoUrl?: string | null;
  buttonConfig?: MongoDisplayPanelButton[];
  status?: MongoDisplayPanel["status"];
  userId?: string | null;
};

export type PublishDisplayPanelInput = {
  guildId: string;
  channelId: string;
  userId?: string | null;
};

export async function getDisplayPanelDashboard(botId: string) {
  const { displayPanels, displayPanelPublications } = await getMongoCollections();
  const [panels, publications] = await Promise.all([
    displayPanels.find({ botId, deletedAt: null }).sort({ updatedAt: -1 }).toArray(),
    displayPanelPublications.find({ botId, deletedAt: null }).sort({ updatedAt: -1 }).toArray()
  ]);
  return {
    panels: panels.map(toPanelDto),
    publications: publications.map(toPublicationDto)
  };
}

export async function listBotDisplayPanelPublications(botId: string) {
  const { displayPanelPublications } = await getMongoCollections();
  const publications = await displayPanelPublications.find({
    botId,
    deletedAt: null,
    status: { $in: ["pending", "active"] }
  }).sort({ updatedAt: 1 }).toArray();
  return { publications: publications.map(toPublicationDto) };
}

export async function getBotDisplayPanelPublication(botId: string, publicationId: string) {
  const { displayPanels, displayPanelPublications } = await getMongoCollections();
  const publication = await displayPanelPublications.findOne({ _id: publicationId, botId, deletedAt: null });
  if (!publication) throw createServiceError("Publicação não encontrada.", 404);
  const panel = await displayPanels.findOne({ _id: publication.panelId, botId, deletedAt: null });
  if (!panel) throw createServiceError("Painel não encontrado.", 404);
  return { panel: toPanelDto(panel), publication: toPublicationDto(publication) };
}

export async function createDisplayPanel(botId: string, input: SaveDisplayPanelInput) {
  const now = new Date();
  const panel: MongoDisplayPanel = {
    _id: randomUUID(),
    botId,
    ...normalizePanel(input),
    createdBy: input.userId ?? null,
    updatedBy: input.userId ?? null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now
  };
  const { displayPanels } = await getMongoCollections();
  await displayPanels.insertOne(panel);
  await audit("PAINEL_CRIADO", botId, input.userId, { panelId: panel._id });
  return toPanelDto(panel);
}

export async function updateDisplayPanel(botId: string, panelId: string, input: Partial<SaveDisplayPanelInput>, options: { updatePublications?: boolean } = {}) {
  const patch = {
    ...normalizePanelPatch(input),
    updatedAt: new Date(),
    updatedBy: input.userId ?? null
  };
  const { displayPanels, displayPanelPublications } = await getMongoCollections();
  const panel = await displayPanels.findOneAndUpdate(
    { _id: panelId, botId, deletedAt: null },
    { $set: patch },
    { returnDocument: "after" }
  );
  if (!panel) throw createServiceError("Painel não encontrado.", 404);
  await audit("PAINEL_EDITADO", botId, input.userId, { panelId });

  if (options.updatePublications) {
    const publications = await displayPanelPublications.find({ botId, panelId, deletedAt: null, status: "active" }).toArray();
    for (const publication of publications) {
      emitPublicationEvent(botId, publication._id, "publish");
    }
  }

  return toPanelDto(panel);
}

export async function deleteDisplayPanel(botId: string, panelId: string, userId?: string | null) {
  const { displayPanels } = await getMongoCollections();
  const panel = await displayPanels.findOneAndUpdate(
    { _id: panelId, botId, deletedAt: null },
    { $set: { deletedAt: new Date(), status: "archived", updatedAt: new Date(), updatedBy: userId ?? null } },
    { returnDocument: "after" }
  );
  if (!panel) throw createServiceError("Painel não encontrado.", 404);
  await audit("PAINEL_EXCLUIDO", botId, userId, { panelId });
  return toPanelDto(panel);
}

export async function createDisplayPanelPublication(botId: string, panelId: string, input: PublishDisplayPanelInput) {
  const { displayPanels, displayPanelPublications } = await getMongoCollections();
  const panel = await displayPanels.findOne({ _id: panelId, botId, deletedAt: null });
  if (!panel) throw createServiceError("Painel não encontrado.", 404);
  const now = new Date();
  const publication: MongoDisplayPanelPublication = {
    _id: randomUUID(),
    panelId,
    botId,
    guildId: normalizeSnowflake(input.guildId) ?? input.guildId,
    channelId: normalizeSnowflake(input.channelId) ?? input.channelId,
    messageId: null,
    status: "pending",
    lastError: null,
    publishRequestedAt: now,
    publishedAt: null,
    updatedAt: now,
    updatedBy: input.userId ?? null,
    deletedAt: null
  };
  await displayPanelPublications.insertOne(publication);
  await audit("PAINEL_PUBLICADO", botId, input.userId, { panelId, publicationId: publication._id, guildId: publication.guildId, channelId: publication.channelId });
  emitPublicationEvent(botId, publication._id, "publish");
  return toPublicationDto(publication);
}

export async function requestDisplayPanelPublicationUpdate(botId: string, publicationId: string, userId?: string | null) {
  const { displayPanelPublications } = await getMongoCollections();
  const publication = await displayPanelPublications.findOneAndUpdate(
    { _id: publicationId, botId, deletedAt: null },
    { $set: { status: "pending", lastError: null, publishRequestedAt: new Date(), updatedAt: new Date(), updatedBy: userId ?? null } },
    { returnDocument: "after" }
  );
  if (!publication) throw createServiceError("Publicação não encontrada.", 404);
  await audit("PAINEL_ATUALIZADO", botId, userId, { panelId: publication.panelId, publicationId });
  emitPublicationEvent(botId, publicationId, "publish");
  return toPublicationDto(publication);
}

export async function requestDisplayPanelPublicationDelete(botId: string, publicationId: string, userId?: string | null) {
  const { displayPanelPublications } = await getMongoCollections();
  const publication = await displayPanelPublications.findOneAndUpdate(
    { _id: publicationId, botId, deletedAt: null },
    { $set: { status: "deleted", deletedAt: new Date(), updatedAt: new Date(), updatedBy: userId ?? null } },
    { returnDocument: "after" }
  );
  if (!publication) throw createServiceError("Publicação não encontrada.", 404);
  await audit("PAINEL_DESPUBLICADO", botId, userId, { panelId: publication.panelId, publicationId });
  emitPublicationEvent(botId, publicationId, "delete");
  return toPublicationDto(publication);
}

export async function updateDisplayPanelPublicationState(botId: string, publicationId: string, input: { messageId?: string | null; status?: MongoDisplayPanelPublication["status"]; lastError?: string | null }) {
  const patch: Partial<MongoDisplayPanelPublication> = {
    updatedAt: new Date()
  };
  if (input.messageId !== undefined) patch.messageId = normalizeSnowflake(input.messageId);
  if (input.status !== undefined) patch.status = input.status;
  if (input.lastError !== undefined) patch.lastError = normalizeNullableText(input.lastError, 500);
  if (input.status === "active" || input.messageId) patch.publishedAt = new Date();
  const { displayPanelPublications } = await getMongoCollections();
  const publication = await displayPanelPublications.findOneAndUpdate(
    { _id: publicationId, botId },
    { $set: patch },
    { returnDocument: "after" }
  );
  if (!publication) throw createServiceError("Publicação não encontrada.", 404);
  return toPublicationDto(publication);
}

function normalizePanel(input: SaveDisplayPanelInput): Omit<MongoDisplayPanel, "_id" | "botId" | "createdBy" | "updatedBy" | "deletedAt" | "createdAt" | "updatedAt"> {
  return {
    name: normalizeText(input.name, 100, "Painel de Exibição"),
    title: normalizeText(input.title, 256, "Painel de Exibição"),
    description: normalizeText(input.description, 4000, "Descrição do painel."),
    content: normalizeNullableText(input.content, 1900),
    color: normalizeColor(input.color),
    imageUrl: normalizeUrl(input.imageUrl),
    videoUrl: normalizeVideoUrl(input.videoUrl),
    buttonConfig: normalizeButtons(input.buttonConfig),
    status: input.status && ["draft", "active", "archived"].includes(input.status) ? input.status : "active"
  };
}

function normalizePanelPatch(input: Partial<SaveDisplayPanelInput>): Partial<MongoDisplayPanel> {
  const patch: Partial<MongoDisplayPanel> = {};
  if (input.name !== undefined) patch.name = normalizeText(input.name, 100, "Painel de Exibição");
  if (input.title !== undefined) patch.title = normalizeText(input.title, 256, "Painel de Exibição");
  if (input.description !== undefined) patch.description = normalizeText(input.description, 4000, "Descrição do painel.");
  if (input.content !== undefined) patch.content = normalizeNullableText(input.content, 1900);
  if (input.color !== undefined) patch.color = normalizeColor(input.color);
  if (input.imageUrl !== undefined) patch.imageUrl = normalizeUrl(input.imageUrl);
  if (input.videoUrl !== undefined) patch.videoUrl = normalizeVideoUrl(input.videoUrl);
  if (input.buttonConfig !== undefined) patch.buttonConfig = normalizeButtons(input.buttonConfig);
  if (input.status !== undefined && ["draft", "active", "archived"].includes(input.status)) patch.status = input.status;
  return patch;
}

function normalizeButtons(value: unknown): MongoDisplayPanelButton[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const label = normalizeNullableText(record.label, 80);
    if (!label) return [];
    return [{
      emoji: normalizeNullableText(record.emoji, 80),
      label,
      style: normalizeButtonStyle(record.style),
      url: normalizeUrl(record.url),
      customId: normalizeNullableText(record.customId, 100)
    }];
  });
}

function normalizeButtonStyle(value: unknown): MongoDisplayPanelButton["style"] {
  const style = String(value ?? "").trim().toLowerCase();
  return ["primary", "secondary", "success", "danger", "link"].includes(style) ? style as MongoDisplayPanelButton["style"] : "secondary";
}

function emitPublicationEvent(botId: string, publicationId: string, action: "publish" | "delete") {
  const payload = { action, botId, publicationId };
  emitRealtime("display-panel:updated", payload);
  emitRealtimeToRoom(devBotRealtimeRoom(botId), "display-panel:updated", payload);
}

async function audit(action: string, botId: string, userId: string | null | undefined, metadata: Record<string, unknown>) {
  await createLog({
    botId,
    guildId: typeof metadata.guildId === "string" ? metadata.guildId : "global",
    userId: userId ?? null,
    module: DISPLAY_PANEL_MODULE_ID,
    action,
    type: `display_panel.${action.toLowerCase()}`,
    message: action,
    metadata
  }).catch(() => undefined);
}

function toPanelDto(panel: MongoDisplayPanel) {
  return {
    id: panel._id,
    botId: panel.botId,
    name: panel.name,
    title: panel.title,
    description: panel.description,
    content: panel.content,
    color: panel.color,
    imageUrl: panel.imageUrl,
    videoUrl: panel.videoUrl,
    buttonConfig: panel.buttonConfig,
    status: panel.status,
    createdAt: panel.createdAt.toISOString(),
    updatedAt: panel.updatedAt.toISOString()
  };
}

function toPublicationDto(publication: MongoDisplayPanelPublication) {
  return {
    id: publication._id,
    panelId: publication.panelId,
    botId: publication.botId,
    guildId: publication.guildId,
    channelId: publication.channelId,
    messageId: publication.messageId,
    status: publication.status,
    lastError: publication.lastError,
    publishRequestedAt: publication.publishRequestedAt.toISOString(),
    publishedAt: publication.publishedAt?.toISOString() ?? null,
    updatedAt: publication.updatedAt.toISOString()
  };
}

function normalizeColor(value: unknown) {
  const color = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#FFD500";
}

function normalizeUrl(value: unknown) {
  const text = normalizeNullableText(value, 2048);
  if (!text) return null;
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeVideoUrl(value: unknown) {
  const url = normalizeUrl(value);
  if (!url) return null;
  return /\.(mp4|mov|webm)(?:[?#].*)?$/i.test(url) ? url : null;
}

function normalizeSnowflake(value: unknown) {
  const text = normalizeNullableText(value, 32);
  return text && /^\d{5,32}$/.test(text) ? text : null;
}

function normalizeText(value: unknown, max: number, fallback: string) {
  const text = String(value ?? "").trim().slice(0, max);
  return text || fallback;
}

function normalizeNullableText(value: unknown, max: number) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().slice(0, max);
  return text || null;
}

export function createServiceError(message: string, statusCode: number) {
  const error = new Error(message) as ServiceError;
  error.statusCode = statusCode;
  return error;
}

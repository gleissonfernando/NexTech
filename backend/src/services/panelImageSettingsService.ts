import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { devBotRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";
import {
  ensureGuild,
  getMongoCollections,
  type MongoGlobalPanelImageLayoutMode,
  type MongoGlobalPanelImagePosition,
  type MongoGlobalPanelImageSize,
  type MongoPanelImageSettings,
} from "../database/mongo";

export type PanelImagePosition = MongoGlobalPanelImagePosition;
export type PanelImageSize = MongoGlobalPanelImageSize;
export type PanelImageLayoutMode = MongoGlobalPanelImageLayoutMode;

export type PanelImageSettingsDto = {
  botId: string;
  customHeight: number | null;
  customWidth: number | null;
  guildId: string;
  imageEnabled: boolean;
  imagePosition: PanelImagePosition;
  imageSize: PanelImageSize;
  imageUrl: string;
  layoutMode: PanelImageLayoutMode;
  panelId: string;
  updatedAt: string | null;
  useGlobalDefault: boolean;
};

export type SavePanelImageSettingsInput = Partial<Pick<
  PanelImageSettingsDto,
  "customHeight" | "customWidth" | "imageEnabled" | "imagePosition" | "imageSize" | "imageUrl" | "layoutMode" | "useGlobalDefault"
>>;

const IMAGE_POSITIONS = new Set<PanelImagePosition>([
  "banner",
  "thumbnail",
  "top",
  "below_title",
  "middle",
  "bottom",
  "side",
  "before_buttons",
  "below_text",
  "above_buttons",
  "footer",
  "none"
]);
const IMAGE_SIZES = new Set<PanelImageSize>(["small", "medium", "large", "full_banner", "custom"]);
const LAYOUT_MODES = new Set<PanelImageLayoutMode>(["embed", "components_v2"]);
const PANEL_IMAGE_UPLOAD_DIR = path.resolve(__dirname, "../../uploads/panel-images");
const MIME_EXTENSIONS: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};
const DEFAULT_SETTINGS = {
  customHeight: null,
  customWidth: null,
  imageEnabled: false,
  imagePosition: "none" as PanelImagePosition,
  imageSize: "medium" as PanelImageSize,
  imageUrl: "",
  layoutMode: "embed" as PanelImageLayoutMode,
  useGlobalDefault: true
};

export function defaultPanelImageSettings(guildId: string, botId: string, panelId: string): PanelImageSettingsDto {
  return {
    botId,
    guildId,
    panelId,
    updatedAt: null,
    ...DEFAULT_SETTINGS,
    useGlobalDefault: panelId !== "global-default"
  };
}

export async function getPanelImageSettings(guildId: string, botId: string, panelId: string) {
  const { panelImageSettings } = await getMongoCollections();
  const settings = await panelImageSettings.findOne({ botId, guildId, panelId });
  const own = settings ? toDto(settings) : defaultPanelImageSettings(guildId, botId, panelId);
  if (panelId === "global-default" || !own.useGlobalDefault) return own;
  const global = await panelImageSettings.findOne({ botId, guildId, panelId: "global-default" });
  if (!global) return own;
  const inherited = toDto(global);
  return { ...inherited, botId, guildId, panelId, updatedAt: own.updatedAt ?? inherited.updatedAt, useGlobalDefault: true };
}

export async function listPanelImageSettings(guildId: string, botId: string) {
  const { panelImageSettings } = await getMongoCollections();
  const settings = await panelImageSettings
    .find({ botId, guildId })
    .sort({ panelId: 1 })
    .toArray();

  return settings.map(toDto);
}

export async function savePanelImageSettings(
  guildId: string,
  botId: string,
  panelId: string,
  input: SavePanelImageSettingsInput,
  actorId: string | null
) {
  if (input.imageEnabled === true && input.imageUrl !== undefined && !normalizeImageUrl(input.imageUrl)) {
    throw Object.assign(new Error("URL de imagem invalida. Use HTTPS ou envie um arquivo suportado."), { statusCode: 400 });
  }
  const current = await getPanelImageSettings(guildId, botId, panelId);
  const next = normalizeSettings({
    ...current,
    ...input,
    botId,
    guildId,
    panelId
  });
  const now = new Date();
  const changed = (["customHeight", "customWidth", "imageEnabled", "imagePosition", "imageSize", "imageUrl", "layoutMode", "useGlobalDefault"] as const).some((key) => current[key] !== next[key]);
  const { panelImageSettings } = await getMongoCollections();

  await ensureGuild(guildId);
  await panelImageSettings.updateOne(
    { botId, guildId, panelId },
    {
      $set: {
        botId,
        customHeight: next.customHeight,
        customWidth: next.customWidth,
        guildId,
        imageEnabled: next.imageEnabled,
        imagePosition: next.imagePosition,
        imageSize: next.imageSize,
        imageUrl: next.imageUrl,
        layoutMode: next.layoutMode,
        panelId,
        updatedAt: now,
        updatedBy: actorId,
        useGlobalDefault: next.useGlobalDefault
      },
      $setOnInsert: {
        _id: randomUUID(),
        createdAt: now,
        createdBy: actorId
      }
    },
    { upsert: true }
  );

  if (changed) emitPanelRefresh(guildId, botId, panelId);

  return getPanelImageSettings(guildId, botId, panelId);
}

function emitPanelRefresh(guildId: string, botId: string, panelId: string) {
  const events: Record<string, string> = {
    "fivem-orders": "fivem:orders:panel_publish",
    "fivem-general": "fivem:fac:panel_publish",
    "manual-registration": "manual-registration:panel_publish",
    "mission-tools": "mission-tools:panel_publish"
  };
  const event = events[panelId];
  if (event) emitRealtimeToRoom(devBotRealtimeRoom(botId), event, { botId, guildId });
}

export async function savePanelImageUpload(input: {
  actorId: string | null;
  botId: string;
  buffer: Buffer;
  guildId: string;
  mimeType: string;
  panelId: string;
}) {
  const extension = MIME_EXTENSIONS[input.mimeType];

  if (!extension) {
    throw new Error("Formato invalido. Envie GIF, PNG, JPG ou WEBP.");
  }

  await fs.mkdir(PANEL_IMAGE_UPLOAD_DIR, { recursive: true });

  const safeGuildId = input.guildId.replace(/[^a-zA-Z0-9_-]/g, "");
  const safeBotId = input.botId.replace(/[^a-zA-Z0-9_-]/g, "");
  const safePanelId = input.panelId.replace(/[^a-zA-Z0-9_-]/g, "");
  const fileName = `${safeGuildId}-${safeBotId}-${safePanelId}-${Date.now()}-${randomUUID()}.${extension}`;
  const filePath = path.join(PANEL_IMAGE_UPLOAD_DIR, fileName);

  await fs.writeFile(filePath, input.buffer);

  const imageUrl = `/uploads/panel-images/${fileName}`;
  const current = await getPanelImageSettings(input.guildId, input.botId, input.panelId);

  return savePanelImageSettings(input.guildId, input.botId, input.panelId, {
    imageEnabled: true,
    imagePosition: current.imagePosition === "none" ? "banner" : current.imagePosition,
    imageSize: current.imageSize,
    imageUrl,
    layoutMode: current.layoutMode,
    useGlobalDefault: false
  }, input.actorId);
}

function normalizeSettings(settings: PanelImageSettingsDto): PanelImageSettingsDto {
  const imagePosition = IMAGE_POSITIONS.has(settings.imagePosition) ? settings.imagePosition : DEFAULT_SETTINGS.imagePosition;
  const imageSize = IMAGE_SIZES.has(settings.imageSize) ? settings.imageSize : DEFAULT_SETTINGS.imageSize;
  const layoutMode = resolveLayoutMode(
    LAYOUT_MODES.has(settings.layoutMode) ? settings.layoutMode : DEFAULT_SETTINGS.layoutMode,
    imagePosition
  );
  const imageUrl = normalizeImageUrl(settings.imageUrl);
  const imageEnabled = settings.imageEnabled === true && Boolean(imageUrl) && imagePosition !== "none";

  return {
    ...settings,
    customHeight: imageSize === "custom" ? clampDimension(settings.customHeight) : null,
    customWidth: imageSize === "custom" ? clampDimension(settings.customWidth) : null,
    imageEnabled,
    imagePosition: imageEnabled ? imagePosition : "none",
    imageSize,
    imageUrl: imageEnabled ? imageUrl : "",
    layoutMode
  };
}

function resolveLayoutMode(layoutMode: PanelImageLayoutMode, imagePosition: PanelImagePosition) {
  if (["top", "below_title", "middle", "bottom", "before_buttons", "below_text", "above_buttons"].includes(imagePosition)) {
    return "components_v2";
  }

  return layoutMode;
}

function normalizeImageUrl(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";

  if (!normalized) {
    return "";
  }

  if (normalized.startsWith("/uploads/")) {
    return normalized.slice(0, 2048);
  }

  try {
    const url = new URL(normalized);

    if (!["http:", "https:"].includes(url.protocol)) {
      return "";
    }

    return url.toString().slice(0, 2048);
  } catch {
    return "";
  }
}

function clampDimension(value: number | null | undefined) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.min(2000, Math.max(16, Math.trunc(Number(value))));
}

function toDto(settings: MongoPanelImageSettings): PanelImageSettingsDto {
  return {
    botId: settings.botId,
    customHeight: settings.customHeight ?? null,
    customWidth: settings.customWidth ?? null,
    guildId: settings.guildId,
    imageEnabled: settings.imageEnabled === true,
    imagePosition: settings.imagePosition ?? DEFAULT_SETTINGS.imagePosition,
    imageSize: settings.imageSize ?? DEFAULT_SETTINGS.imageSize,
    imageUrl: settings.imageUrl ?? "",
    layoutMode: settings.layoutMode ?? DEFAULT_SETTINGS.layoutMode,
    panelId: settings.panelId,
    updatedAt: settings.updatedAt?.toISOString() ?? null,
    useGlobalDefault: settings.useGlobalDefault ?? false
  };
}

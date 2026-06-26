import { randomUUID } from "node:crypto";
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
};

export type SavePanelImageSettingsInput = Partial<Pick<
  PanelImageSettingsDto,
  "customHeight" | "customWidth" | "imageEnabled" | "imagePosition" | "imageSize" | "imageUrl" | "layoutMode"
>>;

const IMAGE_POSITIONS = new Set<PanelImagePosition>([
  "banner",
  "thumbnail",
  "top",
  "below_text",
  "above_buttons",
  "footer",
  "none"
]);
const IMAGE_SIZES = new Set<PanelImageSize>(["small", "medium", "large", "full_banner", "custom"]);
const LAYOUT_MODES = new Set<PanelImageLayoutMode>(["embed", "components_v2"]);
const DEFAULT_SETTINGS = {
  customHeight: null,
  customWidth: null,
  imageEnabled: false,
  imagePosition: "none" as PanelImagePosition,
  imageSize: "medium" as PanelImageSize,
  imageUrl: "",
  layoutMode: "embed" as PanelImageLayoutMode
};

export function defaultPanelImageSettings(guildId: string, botId: string, panelId: string): PanelImageSettingsDto {
  return {
    botId,
    guildId,
    panelId,
    updatedAt: null,
    ...DEFAULT_SETTINGS
  };
}

export async function getPanelImageSettings(guildId: string, botId: string, panelId: string) {
  const { panelImageSettings } = await getMongoCollections();
  const settings = await panelImageSettings.findOne({ botId, guildId, panelId });

  return settings ? toDto(settings) : defaultPanelImageSettings(guildId, botId, panelId);
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
  const current = await getPanelImageSettings(guildId, botId, panelId);
  const next = normalizeSettings({
    ...current,
    ...input,
    botId,
    guildId,
    panelId
  });
  const now = new Date();
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
        updatedBy: actorId
      },
      $setOnInsert: {
        _id: randomUUID(),
        createdAt: now,
        createdBy: actorId
      }
    },
    { upsert: true }
  );

  return getPanelImageSettings(guildId, botId, panelId);
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
  if (["top", "below_text", "above_buttons"].includes(imagePosition)) {
    return "components_v2";
  }

  return layoutMode;
}

function normalizeImageUrl(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";

  if (!normalized) {
    return "";
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
    updatedAt: settings.updatedAt?.toISOString() ?? null
  };
}

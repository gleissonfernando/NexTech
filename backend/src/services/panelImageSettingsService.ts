import { randomUUID } from "node:crypto";
import path from "node:path";
import { devBotRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";
import {
  ensureGuild,
  getMongoCollections,
  type MongoGlobalPanelImageLayoutMode,
  type MongoGlobalPanelBannerMode,
  type MongoGlobalPanelImagePosition,
  type MongoGlobalPanelImageSize,
  type MongoPanelBlock,
  type MongoPanelImageSettings,
} from "../database/mongo";
import {
  isLocalUploadUrl,
  isPersistentImageUrl,
  migrateLocalImageToPersistent,
  getPersistentImageMetadataByUrl,
  normalizePersistentImageUrl,
  removePersistentImageByUrl,
  savePersistentImage
} from "./persistentImageStorageService";
import type { PanelMediaDiagnostics } from "./panelMediaProcessor";
import { createLog } from "./logService";

export type PanelImagePosition = MongoGlobalPanelImagePosition;
export type PanelImageSize = MongoGlobalPanelImageSize;
export type PanelBannerMode = MongoGlobalPanelBannerMode;
export type PanelImageLayoutMode = MongoGlobalPanelImageLayoutMode;

export type PanelImageSettingsDto = {
  blocks: MongoPanelBlock[];
  botId: string;
  customHeight: number | null;
  customWidth: number | null;
  guildId: string;
  imageEnabled: boolean;
  imageExtension: string | null;
  footerText: string | null;
  imagePosition: PanelImagePosition;
  imageSize: PanelImageSize;
  bannerMode: PanelBannerMode;
  imageUrl: string;
  imageMimeType: string | null;
  imageProcessingError: string | null;
  imageProcessingStatus: "stored" | "converted" | "failed" | null;
  imageSizeBytes: number | null;
  imageInvalidReason?: string | null;
  imageIsAnimated: boolean;
  imageUploadedAt: string | null;
  layoutMode: PanelImageLayoutMode;
  mediaAutoplay: boolean;
  mediaControls: boolean;
  mediaFit: "cover" | "contain";
  mediaLoop: boolean;
  mediaMuted: boolean;
  mediaDiagnostics: PanelMediaDiagnostics | null;
  mediaPosterUrl: string | null;
  mediaPreload: "none" | "metadata" | "auto";
  mediaThumbnailUrl: string | null;
  mediaVolume: number;
  panelId: string;
  updatedAt: string | null;
  useGlobalDefault: boolean;
};

export type SavePanelImageSettingsInput = Partial<Pick<
  PanelImageSettingsDto,
  "bannerMode" | "customHeight" | "customWidth" | "footerText" | "imageEnabled" | "imagePosition" | "imageSize" | "imageUrl" | "layoutMode" | "mediaAutoplay" | "mediaControls" | "mediaFit" | "mediaLoop" | "mediaMuted" | "mediaPosterUrl" | "mediaPreload" | "mediaThumbnailUrl" | "mediaVolume" | "useGlobalDefault"
>> & { blocks?: MongoPanelBlock[] };

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
const BANNER_MODES = new Set<PanelBannerMode>(["auto", "large", "compact", "horizontal", "vertical", "square", "ultrawide", "custom"]);
const LAYOUT_MODES = new Set<PanelImageLayoutMode>(["embed", "components_v2"]);
const UPLOADS_ROOT = path.resolve(__dirname, "../../uploads");
const FOOTER_IMAGE_PANEL_IDS = new Set(["global-footer", "ticket-footer"]);
const FOOTER_IMAGE_SIZE_PX = 32;
const DEFAULT_FOOTER_TEXT = "NexTech";
const LOCKED_PANEL_POSITIONS: Partial<Record<string, PanelImagePosition>> = {
  "global-footer": "footer",
  "ticket-banner": "below_title",
  "ticket-banner-secondary": "bottom",
  "ticket-footer": "footer",
  "ticket-logo": "thumbnail"
};
const DEFAULT_SETTINGS = {
  customHeight: null,
  customWidth: null,
  blocks: [] as MongoPanelBlock[],
  imageEnabled: false,
  imageExtension: null,
  footerText: null,
  imagePosition: "none" as PanelImagePosition,
  imageSize: "medium" as PanelImageSize,
  bannerMode: "auto" as PanelBannerMode,
  imageUrl: "",
  imageMimeType: null,
  imageProcessingError: null,
  imageProcessingStatus: null as "stored" | "converted" | "failed" | null,
  imageSizeBytes: null,
  imageIsAnimated: false,
  imageUploadedAt: null,
  layoutMode: "embed" as PanelImageLayoutMode,
  mediaAutoplay: true,
  mediaControls: false,
  mediaFit: "cover" as const,
  mediaLoop: true,
  mediaMuted: true,
  mediaDiagnostics: null as PanelMediaDiagnostics | null,
  mediaPosterUrl: null,
  mediaPreload: "metadata" as const,
  mediaThumbnailUrl: null,
  mediaVolume: 0,
  useGlobalDefault: true
};

const PANEL_VISUAL_REFRESH_EVENTS: Record<string, string[]> = {
  "auto-activity-clock": ["auto-activity-clock:panel_refresh"],
  courses: ["courses:panel_publish"],
  "fivem-captcha": ["fivem-captcha:panel_publish"],
  "fivem-commands": ["fivem-commands:panel_publish"],
  "fivem-finance": ["fivem:finance:panel_publish"],
  "fivem-general": ["fivem:fac:panel_publish"],
  "fivem-absence": ["fivem:fac:panel_publish"],
  "fivem-orders": ["fivem:orders:panel_publish"],
  "fivem-washing": ["fivem:orders:panel_publish"],
  "fivem-drugs": ["fivem:orders:panel_publish"],
  "fivem-goals": ["fivem:goals:panel_publish"],
  "manual-payments": ["manual-payments:panel_publish"],
  "manual-registration": ["manual-registration:panel_publish"],
  "mission-tools": ["mission-tools:panel_publish"],
  "nextech-invites": ["nextech-invites:panel_publish"],
  "police-promotions": ["police-promotions:panel_publish"],
  "price-tables": ["price-tables:panel_publish"],
  "rh-admin": ["rh-admin:panel_publish"],
  "sales-tickets": ["sales-tickets:panel_publish"],
  ticket: ["tickets:panel_publish"],
  "ticket-logo": ["tickets:panel_publish"],
  "ticket-banner": ["tickets:panel_publish"],
  "ticket-banner-secondary": ["tickets:panel_publish"],
  "ticket-footer": ["tickets:panel_publish"],
  "global-footer": []
};

export function defaultPanelImageSettings(guildId: string, botId: string, panelId: string): PanelImageSettingsDto {
  return {
    botId,
    guildId,
    panelId,
    updatedAt: null,
    ...DEFAULT_SETTINGS,
    footerText: panelId === "global-footer" ? DEFAULT_FOOTER_TEXT : DEFAULT_SETTINGS.footerText,
    useGlobalDefault: panelId !== "global-default" && !isFooterImagePanel(panelId)
  };
}

export async function getPanelImageSettings(guildId: string, botId: string, panelId: string) {
  const { panelImageSettings } = await getMongoCollections();
  const settings = await panelImageSettings.findOne({ botId, guildId, panelId });
  const own = settings ? await toDtoWithMigration(settings) : defaultPanelImageSettings(guildId, botId, panelId);
  if (panelId === "global-default" || !own.useGlobalDefault) return own;
  const global = await panelImageSettings.findOne({ botId, guildId, panelId: "global-default" });
  if (!global) return own;
  const inherited = await toDtoWithMigration(global);
  return { ...inherited, botId, guildId, panelId, updatedAt: own.updatedAt ?? inherited.updatedAt, useGlobalDefault: true };
}

export async function listPanelImageSettings(guildId: string, botId: string) {
  const { panelImageSettings } = await getMongoCollections();
  const settings = await panelImageSettings
    .find({ botId, guildId })
    .sort({ panelId: 1 })
    .toArray();

  return Promise.all(settings.map(toDtoWithMigration));
}

export async function savePanelImageSettings(
  guildId: string,
  botId: string,
  panelId: string,
  input: SavePanelImageSettingsInput,
  actorId: string | null
) {
  if (input.imageEnabled === true && input.imageUrl !== undefined && !normalizeImageUrl(input.imageUrl)) {
    throw Object.assign(new Error("URL de mídia inválida. Use HTTPS ou envie um arquivo suportado."), { statusCode: 400 });
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
  const changed = (["bannerMode", "customHeight", "customWidth", "footerText", "imageEnabled", "imagePosition", "imageSize", "imageUrl", "layoutMode", "mediaAutoplay", "mediaControls", "mediaFit", "mediaLoop", "mediaMuted", "mediaPosterUrl", "mediaPreload", "mediaThumbnailUrl", "mediaVolume", "useGlobalDefault"] as const).some((key) => current[key] !== next[key]);
  const blocksChanged = JSON.stringify(current.blocks) !== JSON.stringify(next.blocks);
  const { panelImageSettings } = await getMongoCollections();

  await ensureGuild(guildId);
  await panelImageSettings.updateOne(
    { botId, guildId, panelId },
    {
      $set: {
        botId,
        blocks: next.blocks,
        customHeight: next.customHeight,
        customWidth: next.customWidth,
        footerText: next.footerText,
        guildId,
        imageEnabled: next.imageEnabled,
        imagePosition: next.imagePosition,
        imageSize: next.imageSize,
        bannerMode: next.bannerMode,
        imageUrl: next.imageUrl,
        layoutMode: next.layoutMode,
        mediaAutoplay: next.mediaAutoplay,
        mediaControls: next.mediaControls,
        mediaFit: next.mediaFit,
        mediaLoop: next.mediaLoop,
        mediaMuted: next.mediaMuted,
        mediaPosterUrl: next.mediaPosterUrl,
        mediaPreload: next.mediaPreload,
        mediaThumbnailUrl: next.mediaThumbnailUrl,
        mediaVolume: next.mediaVolume,
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

  if (changed || blocksChanged) emitPanelRefresh(guildId, botId, panelId);
  if (changed && current.imageUrl !== next.imageUrl) {
    await createLog({
      botId,
      guildId,
      message: `Imagem do painel ${panelId} atualizada.`,
      metadata: {
        imageType: "panel",
        moduleId: panelId,
        newUrl: next.imageUrl || null,
        oldUrl: current.imageUrl || null,
        status: next.imageUrl ? "updated" : "removed"
      },
      type: next.imageUrl ? "panel_image.updated" : "panel_image.removed",
      userId: actorId
    }).catch(() => null);
  }

  return getPanelImageSettings(guildId, botId, panelId);
}

function emitPanelRefresh(guildId: string, botId: string, panelId: string) {
  const visualPayload = { botId, guildId, panelId };
  emitRealtimeToRoom(devBotRealtimeRoom(botId), "panel-visual:updated", visualPayload);

  const hierarchyPanelId = hierarchyPanelIdFromImagePanelId(panelId);
  if (hierarchyPanelId !== undefined) {
    emitRealtimeToRoom(devBotRealtimeRoom(botId), "fivem:hierarchy:panel_update", { botId, guildId, ...(hierarchyPanelId ? { panelId: hierarchyPanelId } : {}) });
    return;
  }

  if (panelId === "global-default" || panelId === "global-footer") {
    for (const event of new Set(Object.values(PANEL_VISUAL_REFRESH_EVENTS).flat())) {
      emitRealtimeToRoom(devBotRealtimeRoom(botId), event, { botId, guildId });
    }
    return;
  }

  const events = PANEL_VISUAL_REFRESH_EVENTS[refreshPanelId(panelId)] ?? [];
  for (const event of events) {
    emitRealtimeToRoom(devBotRealtimeRoom(botId), event, { botId, guildId });
  }
}

function refreshPanelId(panelId: string) {
  return panelId.replace(/-banner-\d+$/i, "");
}

function defaultImagePositionForPanel(panelId: string): PanelImagePosition {
  if (panelId === "ticket-logo") return "thumbnail";
  if (panelId === "ticket-banner") return "below_title";
  if (panelId === "ticket-banner-secondary") return "bottom";
  if (panelId === "global-footer" || panelId === "ticket-footer") return "footer";
  return "banner";
}

function hierarchyPanelIdFromImagePanelId(panelId: string) {
  const basePanelId = refreshPanelId(panelId);
  if (basePanelId === "fivem-hierarchy") return null;
  const match = /^fivem-hierarchy-(.+)$/i.exec(basePanelId);
  return match?.[1] ?? undefined;
}

export async function savePanelImageUpload(input: {
  actorId: string | null;
  botId: string;
  buffer: Buffer;
  guildId: string;
  mimeType: string;
  originalName?: string | null;
  panelId: string;
}) {
  if (isFooterImagePanel(input.panelId) && !isAllowedFooterUpload(input.mimeType, input.originalName)) {
    throw Object.assign(new Error("O rodapé aceita apenas PNG, JPG, JPEG, WEBP ou GIF."), { statusCode: 400 });
  }

  const current = await getPanelImageSettings(input.guildId, input.botId, input.panelId);
  const stored = await savePersistentImage({
    actorId: input.actorId,
    botId: input.botId,
    buffer: input.buffer,
    guildId: input.guildId,
    imageType: "panel",
    metadata: { panelId: input.panelId },
    mimeType: input.mimeType,
    moduleId: input.panelId,
    originalName: input.originalName,
    previousUrl: current.imageUrl || null
  });

  return savePanelImageSettings(input.guildId, input.botId, input.panelId, {
    imageEnabled: true,
    imagePosition: current.imagePosition === "none" ? defaultImagePositionForPanel(input.panelId) : current.imagePosition,
    imageSize: current.imageSize,
    bannerMode: current.bannerMode,
    imageUrl: stored.publicUrl,
    layoutMode: current.layoutMode,
    mediaPosterUrl: stored.posterUrl ?? current.mediaPosterUrl,
    mediaThumbnailUrl: stored.posterUrl ?? current.mediaThumbnailUrl,
    useGlobalDefault: false
  }, input.actorId);
}

export async function removePanelImageSettings(input: {
  actorId: string | null;
  botId: string;
  guildId: string;
  panelId: string;
}) {
  const current = await getPanelImageSettings(input.guildId, input.botId, input.panelId);
  if (current.imageUrl) {
    await removePersistentImageByUrl({
      actorId: input.actorId,
      botId: input.botId,
      guildId: input.guildId,
      imageType: "panel",
      moduleId: input.panelId,
      url: current.imageUrl
    });
  }
  return savePanelImageSettings(input.guildId, input.botId, input.panelId, {
    imageEnabled: false,
    imagePosition: "none",
    imageUrl: "",
    useGlobalDefault: false
  }, input.actorId);
}

function normalizeSettings(settings: PanelImageSettingsDto): PanelImageSettingsDto {
  const footerImagePanel = isFooterImagePanel(settings.panelId);
  const lockedPosition = lockedPanelPosition(settings.panelId);
  const imagePosition = lockedPosition ?? (IMAGE_POSITIONS.has(settings.imagePosition) ? settings.imagePosition : DEFAULT_SETTINGS.imagePosition);
  const imageSize = footerImagePanel ? "custom" : IMAGE_SIZES.has(settings.imageSize) ? settings.imageSize : DEFAULT_SETTINGS.imageSize;
  const bannerMode = BANNER_MODES.has(settings.bannerMode) ? settings.bannerMode : DEFAULT_SETTINGS.bannerMode;
  const layoutMode = resolveLayoutMode(
    LAYOUT_MODES.has(settings.layoutMode) ? settings.layoutMode : DEFAULT_SETTINGS.layoutMode,
    footerImagePanel ? "footer" : imagePosition
  );
  const imageUrl = normalizeImageUrl(settings.imageUrl);
  const imageEnabled = settings.imageEnabled === true && Boolean(imageUrl) && (footerImagePanel || imagePosition !== "none");
  const mediaPosterUrl = normalizeImageUrl(settings.mediaPosterUrl);
  const mediaThumbnailUrl = normalizeImageUrl(settings.mediaThumbnailUrl);

  return {
    ...settings,
    blocks: footerImagePanel ? [] : normalizeBlocks(settings.blocks),
    customHeight: footerImagePanel ? FOOTER_IMAGE_SIZE_PX : imageSize === "custom" ? clampDimension(settings.customHeight) : null,
    customWidth: footerImagePanel ? FOOTER_IMAGE_SIZE_PX : imageSize === "custom" ? clampDimension(settings.customWidth) : null,
    footerText: normalizeFooterText(settings.footerText, settings.panelId),
    imageEnabled,
    imagePosition: imageEnabled ? footerImagePanel ? "footer" : imagePosition : "none",
    imageSize,
    bannerMode,
    imageUrl: imageEnabled ? imageUrl : "",
    layoutMode: footerImagePanel ? "components_v2" : layoutMode,
    mediaAutoplay: settings.mediaAutoplay !== false,
    mediaControls: settings.mediaControls === true,
    mediaFit: footerImagePanel ? "contain" : settings.mediaFit === "contain" ? "contain" : "cover",
    mediaLoop: settings.mediaLoop !== false,
    mediaMuted: settings.mediaMuted !== false,
    mediaDiagnostics: settings.mediaDiagnostics ?? null,
    mediaPosterUrl: mediaPosterUrl || null,
    mediaPreload: settings.mediaPreload === "none" || settings.mediaPreload === "auto" ? settings.mediaPreload : "metadata",
    mediaThumbnailUrl: mediaThumbnailUrl || null,
    mediaVolume: Math.min(1, Math.max(0, Number(settings.mediaVolume) || 0)),
    useGlobalDefault: footerImagePanel ? false : settings.useGlobalDefault
  };
}

function normalizeFooterText(value: string | null | undefined, panelId: string) {
  const text = value?.trim() ?? "";
  if (text) return text.slice(0, 180);
  return panelId === "global-footer" ? DEFAULT_FOOTER_TEXT : null;
}

function isFooterImagePanel(panelId: string) {
  return FOOTER_IMAGE_PANEL_IDS.has(panelId);
}

function lockedPanelPosition(panelId: string) {
  return LOCKED_PANEL_POSITIONS[panelId] ?? null;
}

function isAllowedFooterUpload(mimeType: string, originalName?: string | null) {
  if (/^image\/(gif|jpe?g|png|webp)$/i.test(mimeType)) return true;
  return /\.(gif|jpe?g|png|webp)$/i.test(originalName ?? "");
}

function resolveLayoutMode(layoutMode: PanelImageLayoutMode, imagePosition: PanelImagePosition) {
  if (["top", "below_title", "middle", "bottom", "before_buttons", "below_text", "above_buttons"].includes(imagePosition)) {
    return "components_v2";
  }

  return layoutMode;
}

function normalizeImageUrl(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  const persistentImageUrl = normalizePersistentImageUrl(normalized);

  if (!persistentImageUrl) {
    return "";
  }

  try {
    const url = new URL(persistentImageUrl);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
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

async function toDtoWithMigration(settings: MongoPanelImageSettings): Promise<PanelImageSettingsDto> {
  if (settings.imageUrl && isLocalUploadUrl(settings.imageUrl)) {
    const migrated = await migrateLocalImageToPersistent({
      actorId: settings.updatedBy ?? settings.createdBy ?? null,
      botId: settings.botId,
      guildId: settings.guildId,
      imageType: "panel",
      localUrl: settings.imageUrl,
      moduleId: settings.panelId,
      uploadsRoot: UPLOADS_ROOT
    }).catch(() => null);

    if (migrated) {
      const now = new Date();
      const { panelImageSettings } = await getMongoCollections();
      await panelImageSettings.updateOne(
        { _id: settings._id },
        { $set: { imageUrl: migrated.publicUrl, updatedAt: now } }
      );
      emitPanelRefresh(settings.guildId, settings.botId, settings.panelId);
      return toDtoWithImageMetadata({ ...settings, imageUrl: migrated.publicUrl, updatedAt: now });
    }

    const dto = await toDtoWithImageMetadata(settings);
    return {
      ...dto,
      imageEnabled: false,
      imageInvalidReason: "Essa imagem foi enviada antes da correcao de armazenamento persistente e não foi encontrada no servidor. Envie novamente para que ela fique salva permanentemente.",
      imagePosition: "none"
    };
  }

  return toDtoWithImageMetadata(settings);
}

async function toDtoWithImageMetadata(settings: MongoPanelImageSettings): Promise<PanelImageSettingsDto> {
  const dto = toDto(settings);
  const metadata = dto.imageUrl ? await getPersistentImageMetadataByUrl(dto.imageUrl).catch(() => null) : null;
  if (!metadata) return dto;

  return {
    ...dto,
    imageExtension: metadata.extension,
    imageMimeType: metadata.mimeType,
    imageProcessingError: metadata.processingError,
    imageProcessingStatus: metadata.processingStatus,
    imageSizeBytes: metadata.size,
    imageIsAnimated: metadata.animated,
    imageUploadedAt: metadata.uploadedAt,
    mediaDiagnostics: metadata.mediaDiagnostics,
    mediaThumbnailUrl: metadata.posterUrl ?? dto.mediaThumbnailUrl,
    mediaPosterUrl: dto.mediaPosterUrl ?? metadata.posterUrl
  };
}

function toDto(settings: MongoPanelImageSettings): PanelImageSettingsDto {
  const persistentOrRemote = isPersistentImageUrl(settings.imageUrl) || /^https?:\/\//i.test(settings.imageUrl ?? "");
  const imageEnabled = settings.imageEnabled === true && persistentOrRemote;
  const legacyImageUrl = persistentOrRemote ? normalizeImageUrl(settings.imageUrl) : "";
  const imagePosition = lockedPanelPosition(settings.panelId) ?? settings.imagePosition ?? DEFAULT_SETTINGS.imagePosition;
  return {
    blocks: normalizeBlocks(settings.blocks?.length ? settings.blocks : legacyBlocks(settings.panelId, imageEnabled, legacyImageUrl, settings.imagePosition)),
    botId: settings.botId,
    customHeight: settings.customHeight ?? null,
    customWidth: settings.customWidth ?? null,
    guildId: settings.guildId,
    footerText: normalizeFooterText(settings.footerText, settings.panelId),
    imageEnabled,
    imageExtension: extensionFromUrl(legacyImageUrl),
    imagePosition: imageEnabled ? imagePosition : "none",
    imageSize: settings.imageSize ?? DEFAULT_SETTINGS.imageSize,
    bannerMode: settings.bannerMode ?? DEFAULT_SETTINGS.bannerMode,
    imageUrl: legacyImageUrl,
    imageMimeType: mimeTypeFromUrl(legacyImageUrl),
    imageProcessingError: null,
    imageProcessingStatus: null,
    imageSizeBytes: null,
    imageIsAnimated: /\.gif(?:$|[?#])/i.test(legacyImageUrl),
    imageUploadedAt: null,
    layoutMode: settings.layoutMode ?? DEFAULT_SETTINGS.layoutMode,
    mediaAutoplay: settings.mediaAutoplay ?? DEFAULT_SETTINGS.mediaAutoplay,
    mediaControls: settings.mediaControls ?? DEFAULT_SETTINGS.mediaControls,
    mediaFit: settings.mediaFit ?? DEFAULT_SETTINGS.mediaFit,
    mediaLoop: settings.mediaLoop ?? DEFAULT_SETTINGS.mediaLoop,
    mediaMuted: settings.mediaMuted ?? DEFAULT_SETTINGS.mediaMuted,
    mediaDiagnostics: DEFAULT_SETTINGS.mediaDiagnostics,
    mediaPosterUrl: settings.mediaPosterUrl ?? DEFAULT_SETTINGS.mediaPosterUrl,
    mediaPreload: settings.mediaPreload ?? DEFAULT_SETTINGS.mediaPreload,
    mediaThumbnailUrl: settings.mediaThumbnailUrl ?? DEFAULT_SETTINGS.mediaThumbnailUrl,
    mediaVolume: settings.mediaVolume ?? DEFAULT_SETTINGS.mediaVolume,
    panelId: settings.panelId,
    updatedAt: settings.updatedAt?.toISOString() ?? null,
    useGlobalDefault: settings.useGlobalDefault ?? false
  };
}

function extensionFromUrl(value: string) {
  const match = value.match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function mimeTypeFromUrl(value: string) {
  const extension = extensionFromUrl(value);
  if (extension === "gif") return "image/gif";
  if (extension === "avif") return "image/avif";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "mov") return "video/quicktime";
  if (extension === "mp4") return "video/mp4";
  if (extension === "png") return "image/png";
  if (extension === "webm") return "video/webm";
  if (extension === "webp") return "image/webp";
  return null;
}

function normalizeBlocks(blocks: MongoPanelBlock[] | undefined | null): MongoPanelBlock[] {
  return (blocks ?? [])
    .map((block, index) => normalizeBlock(block, index))
    .filter((block): block is MongoPanelBlock => Boolean(block))
    .map((block, order) => ({ ...block, order }))
    .slice(0, 30);
}

function normalizeBlock(block: MongoPanelBlock, index: number): MongoPanelBlock | null {
  const id = block.id?.trim() || `blk_${Date.now()}_${index}`;
  if (block.type === "text") return { editable: block.editable !== false, id, order: index, type: "text", content: String(block.content ?? "").slice(0, 4000) || "-# Rodapé do painel" };
  if (block.type === "separator") return { divider: block.divider !== false, id, order: index, spacing: block.spacing === "large" ? "large" : "small", type: "separator" };
  if (block.type === "media_gallery") {
    const items = (block.items ?? []).map((item) => ({ description: item.description?.slice(0, 1024) ?? null, spoiler: Boolean(item.spoiler), url: normalizeImageUrl(item.url) })).filter((item) => item.url).slice(0, 10);
    return items.length ? { id, items, order: index, type: "media_gallery" } : null;
  }
  if (block.type === "section") {
    const texts = (block.texts ?? []).map((text) => String(text).slice(0, 4000)).filter(Boolean).slice(0, 3);
    if (!texts.length) return null;
    const accessory = block.accessory?.kind === "thumbnail" && normalizeImageUrl(block.accessory.url)
      ? { kind: "thumbnail" as const, description: block.accessory.description?.slice(0, 1024) ?? null, url: normalizeImageUrl(block.accessory.url) }
      : null;
    return { accessory, id, order: index, texts, type: "section" };
  }
  if (block.type === "footer") {
    const text = String(block.text ?? "").slice(0, 4000) || "-# Rodapé do painel";
    const imageUrl = normalizeImageUrl(block.imageUrl);
    const attachmentName = normalizeAttachmentName(block.attachmentName);
    return {
      altText: block.altText?.slice(0, 1024) ?? null,
      attachmentName,
      imageUrl: imageUrl || null,
      id,
      order: index,
      text,
      type: "footer"
    };
  }
  if (block.type === "action_row") {
    const buttons = (block.buttons ?? []).filter((button) => button.label).slice(0, 5).map((button) => ({ customId: button.customId?.slice(0, 100), disabled: Boolean(button.disabled), label: button.label.slice(0, 80), style: button.style ?? "secondary", url: button.url }));
    return buttons.length ? { buttons, id, order: index, type: "action_row" } : null;
  }
  return null;
}

function legacyBlocks(panelId: string, imageEnabled: boolean, imageUrl: string, position: PanelImagePosition): MongoPanelBlock[] {
  void panelId;
  void imageEnabled;
  void imageUrl;
  void position;
  return [];
}

function normalizeAttachmentName(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && /^[^\\/:\0]{1,255}$/.test(trimmed) ? trimmed : null;
}

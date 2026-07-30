import { MessageFlags, type Guild } from "discord.js";
import { env } from "../config/env";
import { getRuntimeFooter } from "./footerRuntimeService";
import { replaceSystemEmojis } from "./systemEmojiService";

export type PanelVisualPosition = "banner" | "thumbnail" | "top" | "below_title" | "middle" | "bottom" | "side" | "footer" | "before_buttons" | "below_text" | "above_buttons" | "none";
const MAX_V2_COMPONENTS = 40;

export type PanelVisualConfig = {
  blocks?: PanelBlock[] | null;
  imageEnabled?: boolean;
  imageExtension?: string | null;
  imageMimeType?: string | null;
  imagePosition?: PanelVisualPosition;
  bannerMode?: "auto" | "large" | "compact" | "horizontal" | "vertical" | "square" | "ultrawide" | "custom";
  imageUrl?: string | null;
  mediaPosterUrl?: string | null;
  mediaThumbnailUrl?: string | null;
};

export type PanelBlock =
  | { editable?: boolean; id: string; order: number; type: "text"; content: string }
  | { divider?: boolean; id: string; order: number; spacing?: "small" | "large" | number; type: "separator" }
  | { id: string; items: Array<{ description?: string | null; spoiler?: boolean; url: string }>; order: number; type: "media_gallery" }
  | { accessory?: { kind: "thumbnail"; description?: string | null; url: string } | { kind: "button"; customId?: string; disabled?: boolean; label: string; style?: "primary" | "secondary" | "success" | "danger" | "link"; url?: string } | null; id: string; order: number; texts: string[]; type: "section" }
  | { altText?: string | null; attachmentName?: string | null; imageUrl?: string | null; id: string; order: number; text: string; type: "footer" }
  | { buttons: Array<{ customId?: string; disabled?: boolean; label: string; style?: "primary" | "secondary" | "success" | "danger" | "link"; url?: string }>; id: string; order: number; type: "action_row" };

export type ComponentsV2FooterConfig = {
  description?: string | null;
  enabled?: boolean;
  iconURL?: string | null;
  iconUrl?: string | null;
  image?: string | null;
  imageExtension?: string | null;
  imageMimeType?: string | null;
  text?: string | null;
} | string | null | undefined;

export const DEFAULT_PANEL_FOOTER = {
  enabled: true,
  image: process.env.DEFAULT_FOOTER_IMAGE || null,
  text: "NexTech"
} as const;

export function renderComponentsV2Panel(input: {
  accentColor: number;
  actions?: unknown[];
  description: string;
  extraImages?: Array<PanelVisualConfig | null | undefined>;
  fields?: string[];
  footer?: ComponentsV2FooterConfig;
  footerContainer?: boolean;
  footerImage?: string | null;
  guild?: unknown;
  image?: PanelVisualConfig | null;
  moduleId?: string;
  title: string;
}) {
  const guild = isGuild(input.guild) ? input.guild : null;
  const requestedMediaUrl = input.image?.imageEnabled ? resolvePanelImageUrl(input.image.imageUrl ?? null, input.image) : null;
  const requestedPosition = requestedMediaUrl ? normalizePosition(input.image?.imagePosition) : "none";
  const isVideo = Boolean(requestedMediaUrl && isVideoMedia(input.image, requestedMediaUrl));
  const posterUrl = isVideo ? resolvePanelImageUrl(input.image?.mediaPosterUrl ?? input.image?.mediaThumbnailUrl ?? null) : null;
  const videoFooterPosition = isVideo && requestedPosition === "footer";
  const imageUrl = requestedPosition === "footer" && !videoFooterPosition ? null : requestedMediaUrl;
  const footerImage = input.footerImage ?? (requestedPosition === "footer" ? (isVideo ? posterUrl : requestedMediaUrl) : null);
  const blockComponents = renderPanelBlocks([
    ...renderableBlocks(input.image),
    ...(input.extraImages ?? []).flatMap((image) => renderableBlocks(image))
  ]);
  const extraMedia = blockComponents.length ? [] : (input.extraImages ?? [])
    .map((image) => {
      const url = image?.imageEnabled ? resolvePanelImageUrl(image.imageUrl ?? null, image) : null;
      if (!url) return null;
      if (isVideoMedia(image, url)) return resolvePanelImageUrl(image?.mediaPosterUrl ?? image?.mediaThumbnailUrl ?? null) ?? null;
      return url;
    })
    .filter((url): url is string => Boolean(url))
    .slice(0, 2)
    .map((url) => mediaBlock(url, input.title));
  const position = imageUrl ? requestedPosition : extraMedia.length ? "banner" : "none";
  const actions = input.actions ?? [];
  const fields = (input.fields ?? []).map((field) => normalizePanelText(field, guild));
  const components: unknown[] = [];
  const mediaUrl = imageUrl && isVideo && posterUrl ? posterUrl : imageUrl;
  const media = mediaUrl ? mediaBlock(mediaUrl, input.title) : null;
  const thumbnailUrl = isVideo ? posterUrl : imageUrl;
  const useThumbnailLayout = Boolean(media && thumbnailUrl && ["thumbnail", "side"].includes(position));
  const effectivePosition = videoFooterPosition ? "bottom" : position;
  const titleText = `# ${normalizePanelText(input.title, guild)}\n${normalizePanelText(input.description, guild)}`;
  const pushMedia = () => {
    if (media) components.push(media);
    components.push(...extraMedia);
  };

  if (useThumbnailLayout) {
    components.push({ type: 9, components: [{ type: 10, content: titleText }], accessory: { type: 11, media: { url: thumbnailUrl }, description: input.title } });
    components.push(...extraMedia);
  } else {
    components.push({ type: 10, content: titleText });
  }
  if (hasPanelBody({ actions, blockComponents, extraMedia, fields, media })) components.push(separatorComponent());
  if (!blockComponents.length && (media || extraMedia.length) && ["top", "banner"].includes(effectivePosition)) pushMedia();
  if (!blockComponents.length && (media || extraMedia.length) && ["thumbnail", "side"].includes(effectivePosition) && !useThumbnailLayout) pushMedia();
  if (!blockComponents.length && (media || extraMedia.length) && ["below_title", "below_text"].includes(effectivePosition)) pushMedia();
  if (blockComponents.length) components.push(...blockComponents);

  const split = Math.ceil(fields.length / 2);
  fields.slice(0, split).forEach((content) => components.push({ type: 10, content }));
  if (!blockComponents.length && (media || extraMedia.length) && effectivePosition === "middle") pushMedia();
  fields.slice(split).forEach((content) => components.push({ type: 10, content }));
  if (!blockComponents.length && (media || extraMedia.length) && ["before_buttons", "above_buttons"].includes(effectivePosition)) pushMedia();
  if (!blockComponents.length && (media || extraMedia.length) && effectivePosition === "bottom") pushMedia();

  const footer = mergeFooter(input.footer === undefined ? getRuntimeFooter(input.guild) : input.footer, footerImage);
  components.push(...actions);
  const footerContainer = input.footerContainer ? createV2FooterContainer(footer, input.accentColor) : null;
  if (!input.footerContainer) appendFooterComponents(components, footer);
  return {
    allowedMentions: { parse: [] as never[] },
    components: [buildV2Container({ accentColor: input.accentColor, components, footer: null }), ...(footerContainer ? [footerContainer] : [])],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

export function componentsV2Payload(input: {
  accentColor: number;
  allowedMentions?: unknown;
  components: unknown[];
  ephemeral?: boolean;
  footer?: ComponentsV2FooterConfig;
  guild?: unknown;
}) {
  return {
    ...(input.allowedMentions === undefined ? { allowedMentions: { parse: [] as never[] } } : { allowedMentions: input.allowedMentions }),
    components: [buildV2Container(input)],
    flags: (input.ephemeral ? MessageFlags.Ephemeral : 0) | MessageFlags.IsComponentsV2
  };
}

export function buildV2Container(input: { accentColor?: number; components: unknown[]; footer?: ComponentsV2FooterConfig; guild?: unknown }) {
  const components = [...input.components];
  if (input.footer !== null) appendFooterComponents(components, input.footer ?? getRuntimeFooter(input.guild) ?? DEFAULT_PANEL_FOOTER);
  return {
    type: 17,
    ...(typeof input.accentColor === "number" ? { accent_color: input.accentColor } : {}),
    components
  };
}

export function renderPanelFromBlocks(input: { accentColor: number; blocks: PanelBlock[]; footer?: ComponentsV2FooterConfig; guild?: unknown }) {
  const rendered = renderPanelBlocks(input.blocks);
  const actions = rendered.filter(isActionRowComponent);
  const components = rendered.filter((component) => !isActionRowComponent(component));
  appendFooterComponents(components, input.footer ?? getRuntimeFooter(input.guild) ?? DEFAULT_PANEL_FOOTER);
  components.push(...actions);
  return {
    allowedMentions: { parse: [] as never[] },
    components: [buildV2Container({ accentColor: input.accentColor, components, footer: null })],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

export function renderPanelBlocks(blocks: PanelBlock[] | null | undefined) {
  const components: unknown[] = [];
  for (const block of normalizePanelBlocks(blocks)) {
    const component = renderPanelBlock(block);
    if (component) components.push(component);
  }
  return components;
}

export function createV2Footer(footer: ComponentsV2FooterConfig) {
  if (!footer) return null;
  const normalized = typeof footer === "string" ? { text: footer } : footer;
  if (normalized.enabled === false) return null;
  const text = normalized.text ?? "";
  const rawImage = normalized.image ?? normalized.iconURL ?? normalized.iconUrl ?? null;
  const image = resolvePanelImageUrl(rawImage, normalized);
  const content = `-# ${text}`.slice(0, 4000) || "-# ";
  if (!image) return { type: 10, content };
  return {
    type: 9,
    components: [{ type: 10, content }],
    accessory: {
      type: 11,
      media: { url: image },
      description: normalized.description || "Imagem de rodapé"
    }
  };
}

export function createV2FooterContainer(footer: ComponentsV2FooterConfig, accentColor?: number) {
  const footerComponent = createV2Footer(footer);
  if (!footerComponent) return null;
  return {
    type: 17,
    ...(typeof accentColor === "number" ? { accent_color: accentColor } : {}),
    components: [footerComponent]
  };
}

export function resolvePanelImageUrl(value: string | null, media?: Pick<PanelVisualConfig, "imageExtension" | "imageMimeType"> | null) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return withPersistentMediaExtension(value, media);
  const origin = env.BACKEND_API_URL ? new URL(env.BACKEND_API_URL).origin : "";
  return origin ? withPersistentMediaExtension(`${origin}${value.startsWith("/") ? value : `/${value}`}`, media) : null;
}

function mediaBlock(url: string, description: string) { return { type: 12, items: [{ media: { url }, description }] }; }
function separatorComponent() { return { type: 14, divider: true, spacing: 1 }; }
function normalizePosition(position: PanelVisualPosition | undefined): PanelVisualPosition { return position && position !== "none" ? position : "none"; }
function normalizePanelText(value: string, guild: Guild | null) { return guild ? replaceSystemEmojis(value, guild, guild.client) : value; }
function isGuild(value: unknown): value is Guild { return Boolean(value && typeof value === "object" && "emojis" in value && "client" in value); }

function hasPanelBody(input: { actions: unknown[]; blockComponents: unknown[]; extraMedia: unknown[]; fields: string[]; media: unknown | null }) {
  return Boolean(input.media || input.extraMedia.length || input.blockComponents.length || input.fields.some((field) => field.trim()) || input.actions.length);
}

function isActionRowComponent(component: unknown) {
  return Boolean(component && typeof component === "object" && (component as { type?: unknown }).type === 1);
}

function normalizePanelBlocks(blocks: PanelBlock[] | null | undefined) {
  return (blocks ?? [])
    .filter((block): block is PanelBlock => Boolean(block?.id && block.type))
    .sort((a, b) => a.order - b.order)
    .slice(0, 30);
}

function renderableBlocks(image: PanelVisualConfig | null | undefined) {
  if (!image?.blocks?.length) return [];
  const hasDirectImage = Boolean(image.imageEnabled && image.imageUrl);
  return image.blocks.filter((block) => !(hasDirectImage && isLegacyImageBlock(block)));
}

function isLegacyImageBlock(block: PanelBlock) {
  return /_legacy_(media|section|footer)$/i.test(block.id);
}

function renderPanelBlock(block: PanelBlock) {
  try {
    if (block.type === "text") return { type: 10, content: block.content.slice(0, 4000) || "\u200b" };
    if (block.type === "separator") return { type: 14, divider: block.divider !== false, spacing: block.spacing === "large" ? 2 : 1 };
    if (block.type === "media_gallery") {
      const items = block.items
        .map((item) => ({ ...item, url: resolvePanelImageUrl(item.url) }))
        .filter((item): item is { description?: string | null; spoiler?: boolean; url: string } => Boolean(item.url))
        .slice(0, 10)
        .map((item) => ({ media: { url: item.url }, ...(item.description ? { description: item.description.slice(0, 1024) } : {}), ...(item.spoiler ? { spoiler: true } : {}) }));
      return items.length ? { type: 12, items } : null;
    }
    if (block.type === "section") {
      const texts = block.texts.filter(Boolean).slice(0, 3).map((content) => ({ type: 10, content: content.slice(0, 4000) || "\u200b" }));
      if (!texts.length) return null;
      const accessory = renderSectionAccessory(block.accessory);
      return accessory ? { type: 9, components: texts, accessory } : { type: 10, content: texts.map((item) => item.content).join("\n").slice(0, 4000) };
    }
    if (block.type === "footer") {
      return createV2Footer({
        description: block.altText,
        image: block.imageUrl || (block.attachmentName ? `attachment://${block.attachmentName}` : null),
        text: block.text
      });
    }
    if (block.type === "action_row") {
      const buttons = block.buttons.map(renderButtonComponent).filter(Boolean).slice(0, 5);
      return buttons.length ? { type: 1, components: buttons } : null;
    }
  } catch {
    return null;
  }
  return null;
}

function renderSectionAccessory(accessory: Extract<PanelBlock, { type: "section" }>["accessory"]) {
  if (!accessory) return null;
  if (accessory.kind === "thumbnail") {
    const url = resolvePanelImageUrl(accessory.url);
    if (!url || isVideoUrl(url)) return null;
    return { type: 11, media: { url }, description: accessory.description || "Thumbnail" };
  }
  return renderButtonComponent(accessory);
}

function renderButtonComponent(button: { customId?: string; disabled?: boolean; label: string; style?: "primary" | "secondary" | "success" | "danger" | "link"; url?: string } | null | undefined) {
  if (!button?.label) return null;
  const style = button.style === "primary" ? 1 : button.style === "success" ? 3 : button.style === "danger" ? 4 : button.style === "link" ? 5 : 2;
  return {
    type: 2,
    disabled: Boolean(button.disabled),
    label: button.label.slice(0, 80),
    style,
    ...(style === 5 ? { url: button.url ?? "https://discord.com" } : { custom_id: button.customId ?? `panel_block:${slug(button.label)}` })
  };
}

function slug(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || `button-${Date.now()}`;
}

function mergeFooter(footer: ComponentsV2FooterConfig, image: string | null): ComponentsV2FooterConfig {
  if (footer && typeof footer === "object") return { ...footer, image: footer.image ?? footer.iconURL ?? footer.iconUrl ?? image };
  if (footer) return { text: footer, image };
  return image ? { ...DEFAULT_PANEL_FOOTER, image } : DEFAULT_PANEL_FOOTER;
}

function withPersistentMediaExtension(value: string, media?: Pick<PanelVisualConfig, "imageExtension" | "imageMimeType"> | null) {
  const extension = mediaExtension(media);
  if (!extension) return value;

  try {
    const url = new URL(value);
    const match = url.pathname.match(/^(\/api\/persistent-images\/[a-f0-9-]{36})(?:\/[^/]+)?$/i);
    if (!match) return value;
    url.pathname = `${match[1]}/media.${extension}`;
    return url.toString();
  } catch {
    return value;
  }
}

function mediaExtension(media?: Pick<PanelVisualConfig, "imageExtension" | "imageMimeType"> | null) {
  const extension = media?.imageExtension?.trim().toLowerCase();
  if (extension && /^[a-z0-9]{1,12}$/.test(extension)) return extension;
  const mimeType = media?.imageMimeType?.trim().toLowerCase();
  if (mimeType === "video/mp4") return "mp4";
  if (mimeType === "video/webm") return "webm";
  if (mimeType === "video/ogg") return "ogv";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return null;
}

function isVideoMedia(media: PanelVisualConfig | null | undefined, url: string) {
  if (media?.imageMimeType?.startsWith("video/")) return true;
  const extension = media?.imageExtension?.trim().toLowerCase();
  return Boolean(extension && VIDEO_EXTENSIONS.has(extension)) || isVideoUrl(url);
}

function isVideoUrl(url: string) {
  return /\.(3gp|3g2|asf|avi|f4v|flv|m4v|mkv|mov|mp4|mpeg|mpg|mts|mxf|ogv|rmvb|ts|vob|webm|wmv)(?:$|[?#])/i.test(url);
}

const VIDEO_EXTENSIONS = new Set(["3gp", "3g2", "asf", "avi", "f4v", "flv", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "mts", "mxf", "ogv", "rmvb", "ts", "vob", "webm", "wmv"]);

function appendFooterComponents(components: unknown[], footer: ComponentsV2FooterConfig) {
  const footerComponent = createV2Footer(footer);
  if (!footerComponent) return;
  const separator = { type: 14, divider: true, spacing: 1 };
  const footerCost = countComponents(separator) + countComponents(footerComponent);
  while (countComponentsList(components) + footerCost > MAX_V2_COMPONENTS) {
    let removableIndex = -1;
    for (let index = components.length - 1; index >= 0; index -= 1) {
      const component = components[index];
      if (!component || typeof component !== "object") continue;
      const type = (component as { type?: unknown }).type;
      if (type !== 1 && type !== 3 && type !== 5 && type !== 6 && type !== 7 && type !== 8) {
        removableIndex = index;
        break;
      }
    }
    if (removableIndex < 0) return;
    components.splice(removableIndex, 1);
  }
  components.push(separator, footerComponent);
}

function countComponentsList(components: unknown[]): number {
  return components.reduce<number>((total, component) => total + countComponents(component), 0);
}

function countComponents(component: unknown): number {
  if (!component || typeof component !== "object") return 0;
  const record = component as { accessory?: unknown; components?: unknown[]; items?: unknown[] };
  const childCount = Array.isArray(record.components) ? countComponentsList(record.components) : 0;
  const accessoryCount = record.accessory ? countComponents(record.accessory) : 0;
  const itemCount = Array.isArray(record.items) ? record.items.length : 0;
  return 1 + childCount + accessoryCount + itemCount;
}

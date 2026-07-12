import { MessageFlags } from "discord.js";
import { env } from "../config/env";

export type PanelVisualPosition = "banner" | "thumbnail" | "top" | "below_title" | "middle" | "bottom" | "side" | "footer" | "before_buttons" | "below_text" | "above_buttons" | "none";
const MAX_V2_COMPONENTS = 40;

export type PanelVisualConfig = {
  blocks?: PanelBlock[] | null;
  imageEnabled?: boolean;
  imagePosition?: PanelVisualPosition;
  imageUrl?: string | null;
};

export type PanelBlock =
  | { editable?: boolean; id: string; order: number; type: "text"; content: string }
  | { divider?: boolean; id: string; order: number; spacing?: "small" | "large" | number; type: "separator" }
  | { id: string; items: Array<{ description?: string | null; spoiler?: boolean; url: string }>; order: number; type: "media_gallery" }
  | { accessory?: { kind: "thumbnail"; description?: string | null; url: string } | { kind: "button"; customId?: string; disabled?: boolean; label: string; style?: "primary" | "secondary" | "success" | "danger" | "link"; url?: string } | null; id: string; order: number; texts: string[]; type: "section" }
  | { buttons: Array<{ customId?: string; disabled?: boolean; label: string; style?: "primary" | "secondary" | "success" | "danger" | "link"; url?: string }>; id: string; order: number; type: "action_row" };

export type ComponentsV2FooterConfig = {
  description?: string | null;
  enabled?: boolean;
  iconURL?: string | null;
  iconUrl?: string | null;
  image?: string | null;
  text?: string | null;
} | string | null | undefined;

export const DEFAULT_PANEL_FOOTER = {
  enabled: true,
  image: process.env.DEFAULT_FOOTER_IMAGE || null,
  text: "OrviteK"
} as const;

export function renderComponentsV2Panel(input: {
  accentColor: number;
  actions?: unknown[];
  description: string;
  extraImages?: Array<PanelVisualConfig | null | undefined>;
  fields?: string[];
  footer?: ComponentsV2FooterConfig;
  footerImage?: string | null;
  image?: PanelVisualConfig | null;
  moduleId?: string;
  title: string;
}) {
  const requestedImageUrl = input.image?.imageEnabled ? resolvePanelImageUrl(input.image.imageUrl ?? null) : null;
  const requestedPosition = requestedImageUrl ? normalizePosition(input.image?.imagePosition) : "none";
  const imageUrl = requestedPosition === "footer" ? null : requestedImageUrl;
  const footerImage = input.footerImage ?? (requestedPosition === "footer" ? requestedImageUrl : null);
  const blockComponents = renderPanelBlocks([
    ...customPanelBlocks(input.image?.blocks),
    ...(input.extraImages ?? []).flatMap((image) => customPanelBlocks(image?.blocks))
  ]);
  const extraMedia = blockComponents.length ? [] : (input.extraImages ?? [])
    .map((image) => image?.imageEnabled ? resolvePanelImageUrl(image.imageUrl ?? null) : null)
    .filter((url): url is string => Boolean(url))
    .slice(0, 2)
    .map((url) => mediaBlock(url, input.title));
  const position = imageUrl ? requestedPosition : extraMedia.length ? "banner" : "none";
  const actions = input.actions ?? [];
  const fields = input.fields ?? [];
  const components: unknown[] = [];
  const media = imageUrl ? mediaBlock(imageUrl, input.title) : null;
  const titleText = `# ${input.title}\n${input.description}`;
  const pushMedia = () => {
    if (media) components.push(media);
    components.push(...extraMedia);
  };

  if (blockComponents.length) components.push(...blockComponents);
  if (!blockComponents.length && (media || extraMedia.length) && ["top", "banner"].includes(position)) pushMedia();
  if (media && ["thumbnail", "side"].includes(position)) {
    components.push({ type: 9, components: [{ type: 10, content: titleText }], accessory: { type: 11, media: { url: imageUrl }, description: input.title } });
    components.push(...extraMedia);
  } else {
    components.push({ type: 10, content: titleText });
  }
  if (!blockComponents.length && (media || extraMedia.length) && ["below_title", "below_text"].includes(position)) pushMedia();

  const split = Math.ceil(fields.length / 2);
  fields.slice(0, split).forEach((content) => components.push({ type: 10, content }));
  if (!blockComponents.length && (media || extraMedia.length) && position === "middle") pushMedia();
  fields.slice(split).forEach((content) => components.push({ type: 10, content }));
  if (!blockComponents.length && (media || extraMedia.length) && ["before_buttons", "above_buttons"].includes(position)) pushMedia();
  components.push(...actions);
  if (!blockComponents.length && (media || extraMedia.length) && position === "bottom") pushMedia();

  const footer = mergeFooter(input.footer, footerImage);
  return {
    allowedMentions: { parse: [] as never[] },
    components: [buildV2Container({ accentColor: input.accentColor, components, footer })],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

export function componentsV2Payload(input: {
  accentColor: number;
  allowedMentions?: unknown;
  components: unknown[];
  ephemeral?: boolean;
  footer?: ComponentsV2FooterConfig;
}) {
  return {
    ...(input.allowedMentions === undefined ? { allowedMentions: { parse: [] as never[] } } : { allowedMentions: input.allowedMentions }),
    components: [buildV2Container(input)],
    flags: (input.ephemeral ? MessageFlags.Ephemeral : 0) | MessageFlags.IsComponentsV2
  };
}

export function buildV2Container(input: { accentColor?: number; components: unknown[]; footer?: ComponentsV2FooterConfig }) {
  const components = [...input.components];
  appendFooterComponents(components, input.footer ?? DEFAULT_PANEL_FOOTER);
  return {
    type: 17,
    ...(typeof input.accentColor === "number" ? { accent_color: input.accentColor } : {}),
    components
  };
}

export function renderPanelFromBlocks(input: { accentColor: number; blocks: PanelBlock[]; footer?: ComponentsV2FooterConfig }) {
  return {
    allowedMentions: { parse: [] as never[] },
    components: [buildV2Container({ accentColor: input.accentColor, components: renderPanelBlocks(input.blocks), footer: input.footer })],
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
  const image = resolvePanelImageUrl(rawImage);
  const content = `-# ${text}`.slice(0, 4000) || "-# ";
  if (!image) return { type: 10, content };
  return {
    type: 9,
    components: [{ type: 10, content }],
    accessory: {
      type: 11,
      media: { url: image },
      description: normalized.description || "Imagem de rodape"
    }
  };
}

export function resolvePanelImageUrl(value: string | null) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const origin = env.BACKEND_API_URL ? new URL(env.BACKEND_API_URL).origin : "";
  return origin ? `${origin}${value.startsWith("/") ? value : `/${value}`}` : null;
}

function mediaBlock(url: string, description: string) { return { type: 12, items: [{ media: { url }, description }] }; }
function normalizePosition(position: PanelVisualPosition | undefined): PanelVisualPosition { return position && position !== "none" ? position : "none"; }

function normalizePanelBlocks(blocks: PanelBlock[] | null | undefined) {
  return (blocks ?? [])
    .filter((block): block is PanelBlock => Boolean(block?.id && block.type))
    .sort((a, b) => a.order - b.order)
    .slice(0, 30);
}

function customPanelBlocks(blocks: PanelBlock[] | null | undefined) {
  return (blocks ?? []).filter((block) => !/_legacy_(media|section)$/i.test(block.id));
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
    return url ? { type: 11, media: { url }, description: accessory.description || "Thumbnail" } : null;
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

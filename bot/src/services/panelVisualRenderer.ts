import { MessageFlags } from "discord.js";
import { env } from "../config/env";

export type PanelVisualPosition = "banner" | "thumbnail" | "top" | "below_title" | "middle" | "bottom" | "side" | "footer" | "before_buttons" | "below_text" | "above_buttons" | "none";
const MAX_V2_COMPONENTS = 40;

export type PanelVisualConfig = {
  imageEnabled?: boolean;
  imagePosition?: PanelVisualPosition;
  imageUrl?: string | null;
};

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
  moduleId: string;
  title: string;
}) {
  const requestedImageUrl = input.image?.imageEnabled ? resolvePanelImageUrl(input.image.imageUrl ?? null) : null;
  const requestedPosition = requestedImageUrl ? normalizePosition(input.image?.imagePosition) : "none";
  const imageUrl = requestedPosition === "footer" ? null : requestedImageUrl;
  const footerImage = input.footerImage ?? (requestedPosition === "footer" ? requestedImageUrl : null);
  const extraMedia = (input.extraImages ?? [])
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

  if ((media || extraMedia.length) && ["top", "banner"].includes(position)) pushMedia();
  if (media && ["thumbnail", "side"].includes(position)) {
    components.push({ type: 9, components: [{ type: 10, content: titleText }], accessory: { type: 11, media: { url: imageUrl }, description: input.title } });
    components.push(...extraMedia);
  } else {
    components.push({ type: 10, content: titleText });
  }
  if ((media || extraMedia.length) && ["below_title", "below_text"].includes(position)) pushMedia();

  const split = Math.ceil(fields.length / 2);
  fields.slice(0, split).forEach((content) => components.push({ type: 10, content }));
  if ((media || extraMedia.length) && position === "middle") pushMedia();
  fields.slice(split).forEach((content) => components.push({ type: 10, content }));
  if ((media || extraMedia.length) && ["before_buttons", "above_buttons"].includes(position)) pushMedia();
  components.push(...actions);
  if ((media || extraMedia.length) && position === "bottom") pushMedia();

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

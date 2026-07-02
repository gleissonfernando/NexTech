import { MessageFlags } from "discord.js";
import { env } from "../config/env";

export type PanelVisualPosition = "banner" | "thumbnail" | "top" | "below_title" | "middle" | "bottom" | "side" | "footer" | "before_buttons" | "below_text" | "above_buttons" | "none";

export type PanelVisualConfig = {
  imageEnabled?: boolean;
  imagePosition?: PanelVisualPosition;
  imageUrl?: string | null;
};

export function renderComponentsV2Panel(input: {
  accentColor: number;
  actions?: unknown[];
  description: string;
  fields?: string[];
  image?: PanelVisualConfig | null;
  moduleId: string;
  title: string;
}) {
  const imageUrl = input.image?.imageEnabled ? resolvePanelImageUrl(input.image.imageUrl ?? null) : null;
  const position = imageUrl ? normalizePosition(input.image?.imagePosition) : "none";
  const actions = input.actions ?? [];
  const fields = input.fields ?? [];
  const components: unknown[] = [];
  const media = imageUrl ? mediaBlock(imageUrl, input.title) : null;
  const titleText = `# ${input.title}\n${input.description}`;

  if (media && ["top", "banner"].includes(position)) components.push(media);
  if (media && ["thumbnail", "side"].includes(position)) {
    components.push({ type: 9, components: [{ type: 10, content: titleText }], accessory: { type: 11, media: { url: imageUrl }, description: input.title } });
  } else {
    components.push({ type: 10, content: titleText });
  }
  if (media && ["below_title", "below_text"].includes(position)) components.push(media);

  const split = Math.ceil(fields.length / 2);
  fields.slice(0, split).forEach((content) => components.push({ type: 10, content }));
  if (media && position === "middle") components.push(media);
  fields.slice(split).forEach((content) => components.push({ type: 10, content }));
  if (media && ["before_buttons", "above_buttons"].includes(position)) components.push(media);
  components.push(...actions);
  if (media && ["bottom", "footer"].includes(position)) components.push(media);

  return {
    allowedMentions: { parse: [] as never[] },
    components: [{ type: 17, accent_color: input.accentColor, components }],
    flags: MessageFlags.IsComponentsV2 as const
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

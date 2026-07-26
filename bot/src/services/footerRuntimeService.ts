import type { Client } from "discord.js";
import { currentRuntimeBotId, env } from "../config/env";
import type { BotContext } from "../types";
import type { ComponentsV2FooterConfig } from "./panelVisualRenderer";

const FOOTER_PANEL_ID = "global-footer";
const DEFAULT_FOOTER_TEXT = "NexTech";
const REFRESH_INTERVAL_MS = 30_000;

const footerByGuild = new Map<string, Exclude<ComponentsV2FooterConfig, string | null | undefined>>();
let started = false;

export function getRuntimeFooter(guild: unknown): ComponentsV2FooterConfig | undefined {
  const guildId = guildIdFromValue(guild);
  return guildId ? footerByGuild.get(guildId) : undefined;
}

export function startFooterRuntimeService(client: Client<true>, context: BotContext) {
  if (started) return;
  started = true;

  context.socket.onPanelVisualUpdated((payload) => {
    if (payload.panelId !== FOOTER_PANEL_ID || !isRuntimeBot(payload.botId)) return;
    void refreshFooter(context, payload.guildId);
  });

  client.on("guildCreate", (guild) => {
    void refreshFooter(context, guild.id);
  });

  void refreshAllFooters(client, context);
  const interval = setInterval(() => {
    void refreshAllFooters(client, context);
  }, REFRESH_INTERVAL_MS);
  interval.unref();
}

async function refreshAllFooters(client: Client<true>, context: BotContext) {
  await Promise.all(client.guilds.cache.map((guild) => refreshFooter(context, guild.id)));
}

async function refreshFooter(context: BotContext, guildId: string) {
  try {
    const settings = await context.api.getPanelVisualSettings(guildId, FOOTER_PANEL_ID);
    footerByGuild.set(guildId, {
      enabled: true,
      image: settings.imageEnabled && settings.imageUrl ? settings.imageUrl : null,
      imageExtension: settings.imageExtension ?? null,
      imageMimeType: settings.imageMimeType ?? null,
      text: settings.footerText?.trim() || DEFAULT_FOOTER_TEXT
    });
  } catch (error) {
    console.warn("[footer-runtime] falha ao sincronizar rodapé:", error instanceof Error ? error.message : error);
  }
}

function isRuntimeBot(botId: string | null | undefined) {
  const runtimeBotId = (currentRuntimeBotId() ?? env.DASHBOARD_BOT_ID) || null;
  return !botId || !runtimeBotId || botId === runtimeBotId;
}

function guildIdFromValue(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && /^\d{5,32}$/.test(id) ? id : null;
}

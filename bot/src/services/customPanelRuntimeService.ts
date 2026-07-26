import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type Client,
  type GuildTextBasedChannel,
  type MessageCreateOptions,
  type MessageEditOptions
} from "discord.js";
import { currentRuntimeBotId, env } from "../config/env";
import type { CustomPanel, CustomPanelComponent, ApiClient } from "./apiClient";
import { assertPanelChannelPermissions, pinPanelMessage } from "./panelDeliveryService";
import { renderComponentsV2Panel } from "./panelVisualRenderer";
import type { BotSocketClient, CustomPanelUpdateEvent } from "../websocket/socketClient";

type WritableGuildTextChannel = GuildTextBasedChannel;

const syncingPanels = new Set<string>();
let serviceStarted = false;

export function startCustomPanelSync(client: Client, api: ApiClient, socket: BotSocketClient) {
  if (serviceStarted) {
    console.warn("[panels] start ignorado: sincronizador já está em execução.");
    return;
  }

  serviceStarted = true;
  socket.onCustomPanelUpdate((event) => {
    if (!isEventForThisBot(event)) return;

    void syncPanelById(client, api, event.panelId).catch((error) => {
      console.warn("[panels] falha ao sincronizar painel:", error instanceof Error ? error.message : error);
    });
  });

  void syncAllPanels(client, api).catch((error) => {
    console.warn("[panels] sincronização inicial falhou:", error instanceof Error ? error.message : error);
  });
}

async function syncAllPanels(client: Client, api: ApiClient) {
  const panels = await api.getCustomPanels();

  for (const panel of panels) {
    if (!client.guilds.cache.has(panel.guildId)) continue;
    await syncCustomPanel(client, api, panel);
  }
}

async function syncPanelById(client: Client, api: ApiClient, panelId: string) {
  if (syncingPanels.has(panelId)) return;
  syncingPanels.add(panelId);

  try {
    const { panel } = await api.getCustomPanel(panelId);
    if (!client.guilds.cache.has(panel.guildId)) return;
    await syncCustomPanel(client, api, panel);
  } finally {
    syncingPanels.delete(panelId);
  }
}

async function syncCustomPanel(client: Client, api: ApiClient, panel: CustomPanel) {
  if (!panel.channelId) return;
  const channel = await fetchWritableChannel(client, panel.channelId, panel.guildId);
  if (!channel) throw new Error(`Canal ${panel.channelId} não encontrado para o painel ${panel.name}.`);

  if (!panel.published) {
    if (panel.messageId) {
      const message = await fetchMessage(channel, panel.messageId);
      await message?.delete().catch(() => undefined);
      await api.updateCustomPanelState(panel.id, { messageId: null, published: false });
    }
    return;
  }

  assertPanelChannelPermissions(channel, client, panel.name);
  const payload = buildPanelMessage(panel);
  const existing = panel.messageId ? await fetchMessage(channel, panel.messageId) : null;

  if (existing) {
    const edited = await existing.edit(payload as MessageEditOptions);
    await pinPanelMessage(edited, panel.name);
    await api.updateCustomPanelState(panel.id, { messageId: existing.id, published: true });
    return;
  }

  const message = await channel.send(payload);
  await pinPanelMessage(message, panel.name);
  await api.updateCustomPanelState(panel.id, { messageId: message.id, published: true });
}

function buildPanelMessage(panel: CustomPanel): MessageCreateOptions {
  const actions = buildComponents(panel);
  const fields = [
    panel.mentionRoleId ? `<@&${panel.mentionRoleId}>` : null,
    panel.beforeMessage,
    panel.afterMessage
  ].filter((item): item is string => Boolean(item?.trim()));
  const payload = renderComponentsV2Panel({
    accentColor: parseColor(panel.color),
    actions,
    description: panel.description.slice(0, 3900),
    extraImages: [panel.bannerUrl ? { imageEnabled: true, imagePosition: "banner", imageUrl: panel.bannerUrl } : null],
    fields,
    footer: panel.footerText ? { text: panel.footerText.slice(0, 2048) } : null,
    image: panel.thumbnailUrl ? { imageEnabled: true, imagePosition: "thumbnail", imageUrl: panel.thumbnailUrl } : null,
    moduleId: "panels",
    title: `${panel.emoji ? `${panel.emoji} ` : ""}${panel.name}`.slice(0, 256)
  });
  return {
    ...payload,
    allowedMentions: {
      parse: [],
      roles: panel.mentionRoleId ? [panel.mentionRoleId] : []
    }
  };
}

function buildComponents(panel: CustomPanel) {
  const rows: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>> = [];
  const buttons: ButtonBuilder[] = [];

  panel.components.slice(0, 25).forEach((component, index) => {
    if (isButton(component)) {
      buttons.push(buildButton(component, panel.id, index));
      return;
    }

    if (isSelect(component)) {
      flushButtons(rows, buttons);
      const options = (component.options ?? []).slice(0, 25);
      if (!options.length) return;
      rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(component.customId || `custom_panel:${panel.id}:${index}`)
          .setDisabled(Boolean(component.disabled))
          .setMaxValues(component.maxValues ?? 1)
          .setMinValues(component.minValues ?? 1)
          .setPlaceholder(component.placeholder || component.label || "Selecione uma opção")
          .addOptions(options.map((option) => ({
            description: option.description ?? undefined,
            emoji: option.emoji ?? undefined,
            label: option.label,
            value: option.value
          })))
      ));
    }
  });

  flushButtons(rows, buttons);
  return rows.slice(0, 5);
}

function buildButton(component: CustomPanelComponent, panelId: string, index: number) {
  const button = new ButtonBuilder()
    .setDisabled(Boolean(component.disabled))
    .setLabel((component.label || "Abrir").slice(0, 80))
    .setStyle(buttonStyle(component));

  if (component.emoji) button.setEmoji(component.emoji);

  if (buttonStyle(component) === ButtonStyle.Link) {
    button.setURL(isHttpUrl(component.url) ? component.url! : "https://discord.com");
  } else {
    button.setCustomId((component.customId || `custom_panel:${panelId}:${index}`).slice(0, 100));
  }

  return button;
}

function flushButtons(rows: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>>, buttons: ButtonBuilder[]) {
  while (buttons.length && rows.length < 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.splice(0, 5)));
  }
}

async function fetchWritableChannel(client: Client, channelId: string, guildId: string) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !("send" in channel) || !("messages" in channel) || !("guildId" in channel) || channel.guildId !== guildId) {
    return null;
  }
  return channel as WritableGuildTextChannel;
}

async function fetchMessage(channel: WritableGuildTextChannel, messageId: string) {
  return channel.messages.fetch(messageId).catch(() => null);
}

function isButton(component: CustomPanelComponent) {
  return ["button", "url_button", "link_button"].includes(component.type);
}

function isSelect(component: CustomPanelComponent) {
  return ["select", "dropdown"].includes(component.type);
}

function buttonStyle(component: CustomPanelComponent) {
  if (component.type === "url_button" || component.type === "link_button" || component.style === "link") return ButtonStyle.Link;
  if (component.style === "primary") return ButtonStyle.Primary;
  if (component.style === "success") return ButtonStyle.Success;
  if (component.style === "danger") return ButtonStyle.Danger;
  return ButtonStyle.Secondary;
}

function parseColor(value: string) {
  return Number.parseInt((/^#[0-9a-f]{6}$/i.test(value) ? value : "#FFD500").replace("#", ""), 16);
}

function isHttpUrl(value?: string | null) {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isEventForThisBot(event: CustomPanelUpdateEvent) {
  return (event.botId ?? null) === ((currentRuntimeBotId() ?? env.DASHBOARD_BOT_ID) || null);
}

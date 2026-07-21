import type { Client, Guild, Message } from "discord.js";
import { currentRuntimeBotId, env, isBotModuleEnabled } from "../config/env";
import type { BotContext } from "../types";
import type { ZtkWebhookEventReceivedEvent, ZtkWebhookManageEvent, ZtkWebhookPlayerStatEvent, ZtkWebhookRewardUpdatedEvent } from "../websocket/socketClient";
import { renderComponentsV2Panel } from "./panelVisualRenderer";

export function startZtkWebhookService(client: Client<true>, context: BotContext) {
  context.socket.onZtkWebhookEventReceived((payload) => {
    if (!isCurrentRuntime(payload.botId)) return;
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void deliverZtkEvent(guild, payload);
  });

  context.socket.onZtkWebhookRewardUpdated((payload) => {
    if (!isCurrentRuntime(payload.botId)) return;
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void deliverZtkReward(guild, payload);
  });

  context.socket.onZtkWebhookManage((payload, acknowledge) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (!guild) {
      acknowledge?.({ error: "Bot não está conectado ao servidor selecionado.", ok: false });
      return;
    }
    void manageDiscordWebhook(guild, payload)
      .then((response) => acknowledge?.(response))
      .catch((error) => acknowledge?.({ error: error instanceof Error ? error.message : String(error), ok: false }));
  });
}

export async function handleZtkWebhookMessage(message: Message, context: BotContext) {
  if (!isBotModuleEnabled("ztk-webhook") || !message.guild || !message.webhookId) return false;
  const content = collectMessageText(message);
  const result = await context.api.recordZtkDiscordWebhookMessage(message.guild.id, {
    channelId: message.channelId,
    content,
    embeds: message.embeds.map((embed) => embed.toJSON()),
    messageId: message.id,
    webhookId: message.webhookId
  }).catch((error) => {
    console.warn("[ztk-webhook] falha ao registrar mensagem de webhook Discord:", error instanceof Error ? error.message : error);
    return null;
  });
  return Boolean(result && !result.ignored);
}

async function manageDiscordWebhook(guild: Guild, payload: ZtkWebhookManageEvent) {
  if (payload.action === "delete") {
    await deleteExistingWebhook(guild, payload.currentWebhookId ?? null);
    return { channelId: null, id: null, ok: true, url: null };
  }

  if (!payload.channelId) {
    return { error: "Canal de entrada da webhook não configurado.", ok: false };
  }

  const channel = await guild.channels.fetch(payload.channelId).catch(() => null);
  if (!channel || !("createWebhook" in channel) || typeof channel.createWebhook !== "function") {
    return { error: "O canal configurado não aceita criação de webhook.", ok: false };
  }

  if (payload.action === "regenerate") {
    await deleteExistingWebhook(guild, payload.currentWebhookId ?? null);
  }

  const webhook = await channel.createWebhook({
    name: `ZTK ${payload.clanName}`.slice(0, 80),
    reason: `ZTK Webhook FiveM - ${payload.clanName}`
  });

  if (!webhook.url) {
    return { error: "Discord não retornou a URL da webhook criada.", ok: false };
  }

  return {
    channelId: payload.channelId,
    id: webhook.id,
    ok: true,
    url: webhook.url
  };
}

async function deleteExistingWebhook(guild: Guild, webhookId: string | null) {
  if (!webhookId) return;
  const webhook = await guild.client.fetchWebhook(webhookId).catch(() => null);
  await webhook?.delete("ZTK Webhook regenerada ou excluída.").catch(() => undefined);
}

async function deliverZtkEvent(guild: Guild, payload: ZtkWebhookEventReceivedEvent) {
  const eventChannelId = channelIdForEvent(payload);
  if (eventChannelId) {
    await sendToChannel(guild, eventChannelId, createEventPanel(payload)).catch((error) => {
      console.warn("[ztk-webhook] falha ao enviar log FiveM:", error instanceof Error ? error.message : error);
    });
  }

  if (payload.clan.rankingChannelId && ["domination", "player_disconnected", "recruitment"].includes(payload.event.eventType)) {
    await sendToChannel(guild, payload.clan.rankingChannelId, createRankingPanel(payload)).catch((error) => {
      console.warn("[ztk-webhook] falha ao enviar ranking:", error instanceof Error ? error.message : error);
    });
  }
}

async function deliverZtkReward(guild: Guild, payload: ZtkWebhookRewardUpdatedEvent) {
  if (!payload.clan.rewardChannelId) return;
  await sendToChannel(guild, payload.clan.rewardChannelId, renderComponentsV2Panel({
    accentColor: 0xffd500,
    description: `Resultado de premiação configurado para o clã **${payload.clan.clanName}**.`,
    fields: [
      `## 🎁 ${payload.reward.name}\n**Ranking:** ${rankingLabel(payload.reward.rankingType)}\n**Data:** ${payload.reward.rewardDate ? formatDate(payload.reward.rewardDate) : "Não definida"}`,
      payload.reward.winners.length
        ? payload.reward.winners.map((winner) => `${medal(winner.place)} **${winner.place}º Lugar**\n${winner.value}`).join("\n\n")
        : "Nenhum vencedor configurado."
    ],
    footer: { text: "NexTech • ZTK Webhook" },
    moduleId: "ztk-webhook",
    title: "ZTK Webhook • Premiação"
  })).catch((error) => {
    console.warn("[ztk-webhook] falha ao enviar premiação:", error instanceof Error ? error.message : error);
  });
}

function createEventPanel(payload: ZtkWebhookEventReceivedEvent) {
  const event = payload.event;
  const fields = event.eventType === "recruitment"
    ? [
        `## 👥 Novo membro\n**Jogador:** ${event.playerName ?? "Não identificado"}\n**ID:** ${event.playerId ?? "Não informado"}\n**Recrutou:** ${event.recruiterName ?? "Não informado"}`,
        `**Clã:** ${payload.clan.clanName}\n**Horário:** ${formatDateTime(event.eventTimestamp)}`
      ]
    : event.eventType === "domination"
      ? [
          `## 🔥 Dominação concluída\n**Jogador:** ${event.playerName ?? "Não identificado"}\n**Local:** ${event.location ?? "Não informado"}`,
          `**Clã:** ${payload.clan.clanName}\n**Horário:** ${formatDateTime(event.eventTimestamp)}`
        ]
      : [
          `## ⏱ Tempo online\n**Jogador:** ${event.playerName ?? "Não identificado"}\n**Evento:** ${eventTitle(event.eventType)}`,
          `**Tempo registrado:** ${formatDuration(event.onlineSeconds ?? 0)}\n**Horário:** ${formatDateTime(event.eventTimestamp)}`
        ];

  return renderComponentsV2Panel({
    accentColor: event.eventType === "domination" ? 0xff6b35 : event.eventType === "recruitment" ? 0x3b82f6 : 0xffd500,
    description: `Log FiveM recebida e registrada com proteção anti duplicação.`,
    fields,
    footer: { text: "NexTech • ZTK Webhook" },
    moduleId: "ztk-webhook",
    title: `ZTK Webhook • ${eventTitle(event.eventType)}`
  });
}

function createRankingPanel(payload: ZtkWebhookEventReceivedEvent) {
  return renderComponentsV2Panel({
    accentColor: 0xffd500,
    description: `Ranking atualizado automaticamente para o clã **${payload.clan.clanName}**.`,
    fields: [
      ...rankingBlocks("🔥 DOMINAÇÕES — TODOS", payload.rankings.domination, "dominations", "dominações"),
      ...rankingBlocks("👥 RECRUTAMENTO — TODOS", payload.rankings.recruitment, "recruitments", "recrutamentos"),
      ...rankingBlocks("⏱️ ONLINE — TODOS", payload.rankings.online, "onlineSeconds", "horas")
    ],
    footer: { text: "NexTech • ZTK Webhook" },
    moduleId: "ztk-webhook",
    title: `🏆 RANKING ${payload.clan.clanName.toUpperCase()}`
  });
}

async function sendToChannel(guild: Guild, channelId: string, payload: ReturnType<typeof renderComponentsV2Panel>) {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) return;
  await channel.send(payload);
}

function channelIdForEvent(payload: ZtkWebhookEventReceivedEvent) {
  if (payload.event.eventType === "recruitment") return payload.clan.recruitmentChannelId ?? payload.clan.rankingChannelId ?? null;
  if (payload.event.eventType === "domination") return payload.clan.dominationChannelId ?? payload.clan.rankingChannelId ?? null;
  if (payload.event.eventType === "player_disconnected") return payload.clan.rankingChannelId ?? null;
  return null;
}

function rankingBlocks(title: string, values: ZtkWebhookPlayerStatEvent[], field: "dominations" | "onlineSeconds" | "recruitments", label: string) {
  if (!values.length) return [`## ${title}\nSem registros.`];
  const blocks: string[] = [];
  let current = `## ${title}\n`;
  values.forEach((item, index) => {
    const value = field === "onlineSeconds" ? Math.floor(item.onlineSeconds / 3600) : item[field];
    const line = `${medal(index + 1)} **${item.playerName}**\n${value} ${label}`;
    const separator = current.endsWith("\n") ? "" : "\n\n";
    if (`${current}${separator}${line}`.length > 3500) {
      blocks.push(current);
      current = `## ${title} (continuação)\n${line}`;
      return;
    }
    current = `${current}${separator}${line}`;
  });
  if (current.trim()) blocks.push(current);
  return blocks;
}

function isCurrentRuntime(botId: string | null | undefined) {
  const runtimeBotId = (currentRuntimeBotId() ?? env.DASHBOARD_BOT_ID) || null;
  return !botId || !runtimeBotId || botId === runtimeBotId;
}

function eventTitle(value: string) {
  if (value === "recruitment") return "NOVO MEMBRO";
  if (value === "domination") return "DOMINAÇÃO CONCLUÍDA";
  if (value === "player_connected") return "PLAYER CONNECTED";
  if (value === "player_disconnected") return "PLAYER DISCONNECTED";
  return "EVENTO RECEBIDO";
}

function rankingLabel(value: string) {
  if (value === "domination") return "TOP DOMINAÇÃO";
  if (value === "recruitment") return "TOP RECRUTAMENTO";
  return "TOP ONLINE";
}

function medal(place: number) {
  if (place === 1) return "🥇";
  if (place === 2) return "🥈";
  if (place === 3) return "🥉";
  return `${place}º`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("pt-BR");
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function formatDuration(seconds: number) {
  if (!seconds) return "0 horas";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}min` : `${minutes}min`;
}

function collectMessageText(message: Message) {
  const embedText = message.embeds.flatMap((embed) => [
    embed.title,
    embed.description,
    embed.footer?.text,
    embed.author?.name,
    ...embed.fields.flatMap((field) => [field.name, field.value])
  ]).filter(Boolean).join("\n");
  return [message.content, embedText].filter(Boolean).join("\n").slice(0, 8000);
}

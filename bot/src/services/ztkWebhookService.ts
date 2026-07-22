import { SlashCommandBuilder, type Client, type Guild, type Message } from "discord.js";
import { currentRuntimeBotId, env, isBotModuleEnabled } from "../config/env";
import type { BotCommand, BotContext } from "../types";
import type { ZtkWebhookClanRuntime, ZtkWebhookRecruitmentDashboard } from "./apiClient";
import type { ZtkWebhookEventReceivedEvent, ZtkWebhookManageEvent, ZtkWebhookPlayerStatEvent, ZtkWebhookRewardUpdatedEvent } from "../websocket/socketClient";
import { renderComponentsV2Panel } from "./panelVisualRenderer";

const ZTK_RANKING_LIMIT = 10;
let ztkRecruitmentStartupSyncStarted = false;

export const recrutamentoCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("recrutamento")
    .setDescription("Consulta o ranking de recrutamento ZTK.")
    .addSubcommand((subcommand) => subcommand
      .setName("painel")
      .setDescription("Mostra o painel de recrutamentos do clã.")
      .addUserOption((option) => option.setName("usuario").setDescription("Recrutador para consulta individual.").setRequired(false))),
  moduleId: "ztk-webhook",
  async execute(interaction, context) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Comando disponível apenas em servidores.", ephemeral: true });
      return;
    }
    if (!isBotModuleEnabled("ztk-webhook")) {
      await interaction.reply({ content: "ZTK Webhook não está habilitado neste bot.", ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const target = interaction.options.getUser("usuario");
    const dashboard = await context.api.getZtkWebhookDashboard(interaction.guildId);
    const clan = dashboard.selectedClan ?? dashboard.clans[0] ?? null;
    if (!clan) {
      await interaction.editReply("Nenhum clã ZTK configurado.");
      return;
    }
    const recruiters = dashboard.recruitmentRankings.recruiters;
    const selected = target
      ? recruiters.find((item) => item.recruiterId === target.id || normalizeSearch(item.recruiterName).includes(normalizeSearch(target.username)))
      : null;
    const panel = selected
      ? renderComponentsV2Panel({
          accentColor: 0x3b82f6,
          description: `Consulta individual de recrutamento para o clã **${clan.clanName}**.`,
          fields: [
            `## 👤 ${selected.recruiterName}\n**Total recrutado:** ${selected.totalRecruitments}\n**Hoje:** ${selected.todayRecruitments}\n**Semana:** ${selected.weeklyRecruitments}\n**Mês:** ${selected.monthlyRecruitments}`,
            `**Primeiro recrutamento:** ${selected.firstRecruitmentAt ? formatDate(selected.firstRecruitmentAt) : "Sem registro"}\n**Último recrutamento:** ${selected.lastRecruitmentAt ? formatDateTime(selected.lastRecruitmentAt) : "Sem registro"}`,
            selected.recentRecruits.length
              ? selected.recentRecruits.slice(0, 10).map((recruit) => `👤 ${recruit.recruitedName}\n${formatDate(recruit.recruitedAt)} • ${formatTime(recruit.recruitedAt)}`).join("\n\n")
              : "Nenhum histórico registrado."
          ],
          footer: { text: "NexTech • ZTK Recrutamento" },
          moduleId: "ztk-webhook",
          title: "👥 Painel de Recrutamentos"
        })
      : renderComponentsV2Panel({
          accentColor: 0x3b82f6,
          description: `Ranking geral de recrutamento do clã **${clan.clanName}**.`,
          fields: [
            `## 📊 Resumo\n**Hoje:** ${dashboard.recruitmentRankings.stats.todayTotal}\n**Semana:** ${dashboard.recruitmentRankings.stats.weekTotal}\n**Mês:** ${dashboard.recruitmentRankings.stats.monthTotal}\n**Total:** ${dashboard.recruitmentRankings.stats.total}\n**Maior recrutador:** ${dashboard.recruitmentRankings.stats.topRecruiterName ?? "Sem dados"}`,
            ...recruitmentRankingBlocks("🥇 Top Recrutadores", recruiters)
          ],
          footer: { text: "NexTech • ZTK Recrutamento" },
          moduleId: "ztk-webhook",
          title: "👥 Painel de Recrutamentos"
        });
    await interaction.editReply(panel as any);
  }
};

export function startZtkWebhookService(client: Client<true>, context: BotContext) {
  context.socket.onZtkWebhookEventReceived((payload) => {
    if (!isCurrentRuntime(payload.botId)) return;
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void deliverZtkEvent(guild, payload, context);
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

  scheduleZtkRecruitmentPanelStartupSync(client, context);
}

function scheduleZtkRecruitmentPanelStartupSync(client: Client<true>, context: BotContext) {
  if (ztkRecruitmentStartupSyncStarted || !isBotModuleEnabled("ztk-webhook")) return;
  ztkRecruitmentStartupSyncStarted = true;
  const run = () => {
    void syncZtkRecruitmentPanelsOnStartup(client, context).catch((error) => {
      console.warn("[ztk-webhook] falha ao sincronizar painel de recrutamento na inicialização:", error instanceof Error ? error.message : error);
    });
  };
  run();
}

async function syncZtkRecruitmentPanelsOnStartup(client: Client<true>, context: BotContext) {
  for (const guild of client.guilds.cache.values()) {
    const clans = await context.api.getZtkWebhookClans(guild.id).catch((error) => {
      console.warn("[ztk-webhook] falha ao buscar clãs para sincronização:", error instanceof Error ? error.message : error);
      return [] as ZtkWebhookClanRuntime[];
    });
    for (const clan of clans) {
      const channelId = clan.recruitmentChannelId ?? clan.rankingChannelId ?? null;
      if (!channelId) continue;
      const dashboard = await context.api.getZtkWebhookDashboard(guild.id, clan.id).catch((error) => {
        console.warn("[ztk-webhook] falha ao buscar ranking de recrutamento:", error instanceof Error ? error.message : error);
        return null;
      });
      if (!dashboard?.recruitmentRankings) continue;
      const selectedClan = dashboard.selectedClan ?? dashboard.clans.find((item) => item.id === clan.id) ?? clan;
      const panelPayload = createRecruitmentPanelPayload(guild.id, selectedClan, dashboard);
      const messageId = await upsertChannelMessage(guild, channelId, selectedClan.recruitmentRankingMessageId ?? null, createRecruitmentRankingPanel(panelPayload), [
        "Sistema de Recrutamento",
        `RECRUTAMENTO — ${selectedClan.clanName.toUpperCase()}`
      ]);
      if (messageId && messageId !== selectedClan.recruitmentRankingMessageId) {
        await context.api.updateZtkRankingMessageState(guild.id, selectedClan.id, {
          channelId,
          kind: "recruitment",
          messageId
        }).catch((error) => {
          console.warn("[ztk-webhook] falha ao salvar mensagem de recrutamento sincronizada:", error instanceof Error ? error.message : error);
        });
      }
    }
  }
}

function createRecruitmentPanelPayload(guildId: string, clan: ZtkWebhookClanRuntime, dashboard: ZtkWebhookRecruitmentDashboard): ZtkWebhookEventReceivedEvent {
  return {
    botId: currentRuntimeBotId(),
    clan,
    event: {
      clanName: clan.clanName,
      eventTimestamp: new Date().toISOString(),
      eventType: "recruitment",
      id: `startup-sync-${clan.id}`,
      playerName: null,
      recruiterName: null
    },
    guildId,
    recruitmentRankings: dashboard.recruitmentRankings,
    rankings: { domination: [], online: [], recruitment: [] }
  };
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

async function deliverZtkEvent(guild: Guild, payload: ZtkWebhookEventReceivedEvent, context: BotContext) {
  const eventChannelId = channelIdForEvent(payload);
  if (eventChannelId && eventChannelId !== rankingPanelChannelForEvent(payload)) {
    await sendToChannel(guild, eventChannelId, createEventPanel(payload)).catch((error) => {
      console.warn("[ztk-webhook] falha ao enviar log FiveM:", error instanceof Error ? error.message : error);
    });
  }

  if (["domination", "player_disconnected", "recruitment"].includes(payload.event.eventType)) {
    await upsertZtkRankingMessages(guild, payload, context).catch((error) => {
      console.warn("[ztk-webhook] falha ao atualizar ranking:", error instanceof Error ? error.message : error);
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
        `## 👥 Novo membro\n**Jogador:** ${event.playerName ?? "Não identificado"}\n**ID:** ${event.playerId ?? "Não informado"}\n**Convidado por:** ${event.recruiterName ?? "Não informado"}\n**ID do convidador:** ${event.recruiterId ?? "Não informado"}`,
        `**Gang:** ${event.clanName ?? payload.clan.clanName}\n**Cargo inicial:** ${event.initialRole ?? "Não informado"}\n**Horário:** ${formatDateTime(event.eventTimestamp)}`
      ]
    : event.eventType === "domination"
      ? [
          `## 🏴 DOMINAÇÃO CONCLUÍDA\n**Gang vencedora:** ${event.clanName ?? payload.clan.clanName}\n**Zona dominada:** ${event.location ?? "Não informado"}\n**Participantes:** ${event.participantCount ?? event.participants?.length ?? 0} jogadores\n**Total na zona:** ${event.totalPlayersInZone ?? "Não informado"}`,
          `## ⚔️ Outras gangs presentes\n${event.rivalGangs?.length ? event.rivalGangs.map((gang) => `${gang.name} — ${gang.players} jogadores`).join("\n") : "Nenhuma informada."}`,
          `## 👤 Membros participantes\n${event.participants?.length ? event.participants.map((participant) => participant.name).join("\n") : "Não informado."}`,
          `## 🕒 Data e horário\n${formatDateTime(event.eventTimestamp)}`
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
  const participantRanking = payload.dominationRankings?.participants ?? [];
  return renderComponentsV2Panel({
    accentColor: 0xffd500,
    description: `Top 10 membros com mais dominações atualizado automaticamente para o clã **${payload.clan.clanName}**.`,
    fields: participantRankingBlocks("🔥 TOP 10 DOMINAÇÕES", participantRanking),
    footer: { text: "NexTech • ZTK Webhook" },
    moduleId: "ztk-webhook",
    title: `🏆 RANKING ${payload.clan.clanName.toUpperCase()}`
  });
}

function createParticipationRankingPanel(payload: ZtkWebhookEventReceivedEvent) {
  const participantRanking = payload.dominationRankings?.participants ?? [];
  return renderComponentsV2Panel({
    accentColor: 0xffd500,
    description: `Top 10 membros com mais dominações registradas para o clã **${payload.clan.clanName}**.`,
    fields: participantRankingBlocks("🎯 TOP 10 DOMINAÇÕES POR MEMBRO", participantRanking),
    footer: { text: "NexTech • ZTK Webhook" },
    moduleId: "ztk-webhook",
    title: `🎯 Top Dominações • ${payload.clan.clanName}`
  });
}

function createOnlineRankingPanel(payload: ZtkWebhookEventReceivedEvent) {
  return renderComponentsV2Panel({
    accentColor: 0xffd500,
    description: `Tempo online atualizado automaticamente para o clã **${payload.clan.clanName}**.`,
    fields: rankingBlocks("⏱️ ONLINE — TODOS", payload.rankings.online, "onlineSeconds", "horas"),
    footer: { text: "NexTech • ZTK Webhook" },
    moduleId: "ztk-webhook",
    title: `⏱️ Online ${payload.clan.clanName}`
  });
}

function createRecruitmentRankingPanel(payload: ZtkWebhookEventReceivedEvent) {
  const recruiters = payload.recruitmentRankings?.recruiters ?? [];
  return renderComponentsV2Panel({
    accentColor: 0x3b82f6,
    description: `Histórico de recrutamento atualizado automaticamente para o clã **${payload.clan.clanName}**.`,
    fields: recruitmentRankingBlocks(`👥 RECRUTAMENTO — ${payload.clan.clanName.toUpperCase()}`, recruiters),
    footer: { text: "NexTech • ZTK Webhook" },
    moduleId: "ztk-webhook",
    title: "👥 Sistema de Recrutamento"
  });
}

async function upsertZtkRankingMessages(guild: Guild, payload: ZtkWebhookEventReceivedEvent, context: BotContext) {
  const updates: Array<{
    channelId: string | null | undefined;
    kind: "online" | "participation" | "ranking" | "recruitment";
    markers: string[];
    messageId: string | null | undefined;
    panel: ReturnType<typeof renderComponentsV2Panel>;
  }> = [
    {
      channelId: payload.clan.rankingChannelId,
      kind: "ranking",
      markers: [`RANKING ${payload.clan.clanName.toUpperCase()}`, "TOP 10 DOMINAÇÕES"],
      messageId: payload.clan.rankingMessageId,
      panel: createRankingPanel(payload)
    },
    {
      channelId: payload.clan.recruitmentChannelId ?? payload.clan.rankingChannelId,
      kind: "recruitment",
      markers: ["Sistema de Recrutamento", `RECRUTAMENTO — ${payload.clan.clanName.toUpperCase()}`],
      messageId: payload.clan.recruitmentRankingMessageId,
      panel: createRecruitmentRankingPanel(payload)
    },
    {
      channelId: payload.clan.onlineChannelId ?? payload.clan.rankingChannelId,
      kind: "online",
      markers: [`Online ${payload.clan.clanName}`, "ONLINE — TODOS"],
      messageId: payload.clan.onlineRankingMessageId,
      panel: createOnlineRankingPanel(payload)
    }
  ];

  for (const update of updates) {
    if (!update.channelId) continue;
    const messageId = await upsertChannelMessage(guild, update.channelId, update.messageId ?? null, update.panel, update.markers);
    if (messageId && messageId !== update.messageId) {
      await context.api.updateZtkRankingMessageState(guild.id, payload.clan.id, {
        channelId: update.channelId,
        kind: update.kind,
        messageId
      }).catch((error) => {
        console.warn("[ztk-webhook] falha ao salvar mensagem fixa do ranking:", error instanceof Error ? error.message : error);
      });
    }
  }
}

async function sendToChannel(guild: Guild, channelId: string, payload: ReturnType<typeof renderComponentsV2Panel>) {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) return;
  await channel.send(payload);
}

async function upsertChannelMessage(guild: Guild, channelId: string, messageId: string | null, payload: ReturnType<typeof renderComponentsV2Panel>, markers: string[]) {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) return null;

  if (messageId && "messages" in channel) {
    const existing = await channel.messages.fetch(messageId).catch(() => null);
    if (existing) {
      await existing.edit(payload);
      return existing.id;
    }
  }

  if ("messages" in channel) {
    const existing = await findExistingRankingMessage(channel, markers);
    if (existing) {
      await existing.edit(payload);
      return existing.id;
    }
  }

  const sent = await channel.send(payload);
  return sent.id;
}

function channelIdForEvent(payload: ZtkWebhookEventReceivedEvent) {
  if (payload.event.eventType === "recruitment") return payload.clan.recruitmentChannelId ?? null;
  if (payload.event.eventType === "domination") return payload.clan.dominationChannelId ?? null;
  if (payload.event.eventType === "player_disconnected") return payload.clan.onlineChannelId ?? null;
  return null;
}

function rankingPanelChannelForEvent(payload: ZtkWebhookEventReceivedEvent) {
  if (payload.event.eventType === "recruitment") return payload.clan.recruitmentChannelId ?? payload.clan.rankingChannelId ?? null;
  if (payload.event.eventType === "domination") return payload.clan.rankingChannelId ?? null;
  if (payload.event.eventType === "player_disconnected") return payload.clan.onlineChannelId ?? payload.clan.rankingChannelId ?? null;
  return null;
}

async function findExistingRankingMessage(channel: { messages: { fetch: (options: { limit: number }) => Promise<{ find: (predicate: (message: Message) => boolean) => Message | undefined }> } }, markers: string[]) {
  if (!markers.length) return null;
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  return messages?.find((message) => message.author.id === message.client.user?.id && messageContainsMarkers(message, markers)) ?? null;
}

function messageContainsMarkers(message: Message, markers: string[]) {
  const text = normalizeSearch([
    message.content,
    collectComponentText(message.components.map((component) => component.toJSON()))
  ].filter(Boolean).join("\n"));
  return markers.every((marker) => text.includes(normalizeSearch(marker)));
}

function collectComponentText(value: unknown): string {
  const chunks: string[] = [];
  const visit = (item: unknown) => {
    if (typeof item === "string" || typeof item === "number") {
      chunks.push(String(item));
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!item || typeof item !== "object") return;
    for (const [key, nested] of Object.entries(item)) {
      if (["content", "label", "title", "description", "text"].includes(key)) visit(nested);
      else if (typeof nested === "object") visit(nested);
    }
  };
  visit(value);
  return chunks.join("\n");
}

function gangRankingBlocks(title: string, values: NonNullable<ZtkWebhookEventReceivedEvent["dominationRankings"]>["gangs"]) {
  if (!values.length) return [`## ${title}\nSem registros.`];
  return [`## ${title}\n${values.slice(0, ZTK_RANKING_LIMIT).map((item, index) => {
    const last = item.lastZone ? `\nÚltima dominação: ${item.lastZone}${item.lastDominatedAt ? `\nHorário: ${formatDateTime(item.lastDominatedAt)}` : ""}` : "";
    return `${medal(index + 1)} **${item.gangName}**\n${item.dominations} dominações${last}`;
  }).join("\n\n")}`];
}

function participantRankingBlocks(title: string, values: NonNullable<ZtkWebhookEventReceivedEvent["dominationRankings"]>["participants"]) {
  if (!values.length) return [`## ${title}\nSem registros.`];
  return [`## ${title}\n${values.slice(0, ZTK_RANKING_LIMIT).map((item, index) => {
    const last = item.lastDominatedAt
      ? `\nÚltima dominação: ${item.lastZone ?? "Local não informado"}\nHorário: ${formatDateTime(item.lastDominatedAt)}`
      : "";
    return `${medal(index + 1)} **#${index + 1} ${item.playerName}**\n${item.participations} dominações${item.gangName ? `\nClã: ${item.gangName}` : ""}${last}`;
  }).join("\n\n")}`];
}

function recruitmentRankingBlocks(title: string, values: NonNullable<ZtkWebhookEventReceivedEvent["recruitmentRankings"]>["recruiters"]) {
  if (!values.length) return [`## ${title}\nSem registros.`];
  const blocks: string[] = [];
  let current = `## ${title}\n`;
  values.slice(0, ZTK_RANKING_LIMIT).forEach((item, index) => {
    const recruits = item.recentRecruits.length
      ? item.recentRecruits.map((recruit) => `👤 ${recruit.recruitedName}\n📅 ${formatDate(recruit.recruitedAt)}`).join("\n")
      : "Nenhum histórico recente.";
    const line = `${medal(index + 1)} **${item.recruiterName}**\n${item.totalRecruitments} recrutamentos\n\nÚltimos recrutamentos:\n${recruits}`;
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

function rankingBlocks(title: string, values: ZtkWebhookPlayerStatEvent[], field: "dominations" | "onlineSeconds" | "recruitments", label: string) {
  if (!values.length) return [`## ${title}\nSem registros.`];
  const blocks: string[] = [];
  let current = `## ${title}\n`;
  values.slice(0, ZTK_RANKING_LIMIT).forEach((item, index) => {
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

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
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

function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
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

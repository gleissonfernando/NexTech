import { Bot, Gauge, Headphones, Layers3, MonitorCog, ShieldCheck } from "lucide-react";
import type { LandingMetrics, PublicConnectedServersResponse, PublicMarketingFeature, PublicStatusSnapshot } from "./types";
import { fallbackFeatures } from "./data";

export function buildLandingStats(metrics: LandingMetrics, data: PublicConnectedServersResponse) {
  const responseTime = metrics.responseTimeMs;
  const uptime = metrics.uptimePercent;

  return [
    { displayOverride: uptime === null ? "99.9%" : undefined, label: "Disponibilidade", suffix: "%", value: uptime ?? 99.9 },
    { displayOverride: "24/7", label: "Monitoramento", value: 24 },
    { displayOverride: data.totalBots ? undefined : "ao vivo", label: "Bots criados", prefix: "+", value: data.totalBots },
    { displayOverride: responseTime === null ? "Tempo real" : undefined, label: "Sincronização", suffix: "ms", value: responseTime ?? 0 }
  ];
}

export function getLandingResponseTime(snapshot: PublicStatusSnapshot) {
  const services = getLandingServices(snapshot);
  const botService = services.find((service) => service.id === "discord-bot");
  if (typeof botService?.responseTimeMs === "number") return Math.max(0, Math.round(botService.responseTimeMs));
  const samples = services
    .map((service) => service.responseTimeMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!samples.length) return null;
  return Math.max(0, Math.round(samples.reduce((total, value) => total + value, 0) / samples.length));
}

export function getLandingUptime(snapshot: PublicStatusSnapshot) {
  const samples = getLandingServices(snapshot)
    .filter((service) => service.currentStatus !== "unknown")
    .map((service) => service.uptimePercentage)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!samples.length) return null;
  const average = samples.reduce((total, value) => total + value, 0) / samples.length;
  return Math.round(average * 10) / 10;
}

export function normalizeServersResponse(data: PublicConnectedServersResponse): PublicConnectedServersResponse {
  return {
    generatedAt: data.generatedAt,
    servers: (data.servers ?? []).slice(0, 24).map((server) => ({
      botNames: (server.botNames ?? []).slice(0, 6).map((name) => sanitizeText(name, 80)),
      connectedBots: clampNumber(server.connectedBots, 0, 100),
      guildId: sanitizeText(server.guildId, 40),
      iconUrl: safePublicImageUrl(server.iconUrl),
      memberCount: clampNumber(server.memberCount, 0, 1_000_000),
      name: sanitizeText(server.name, 80) || "Servidor NexTech",
      online: Boolean(server.online)
    })),
    totalBots: clampNumber(data.totalBots, 0, 1000),
    totalUniqueServers: clampNumber(data.totalUniqueServers, 0, 1000)
  };
}

export function ensureThreeFeatures(features: PublicMarketingFeature[]) {
  const normalized = features.slice(0, 3).map((feature) => ({
    category: sanitizeText(feature.category, 40),
    fullDescription: sanitizeText(feature.fullDescription, 280),
    icon: sanitizeText(feature.icon, 32),
    id: sanitizeText(feature.id, 64),
    shortDescription: sanitizeText(feature.shortDescription, 140),
    title: sanitizeText(feature.title, 70)
  }));
  const byId = new Map(normalized.map((feature) => [feature.id, feature]));
  for (const fallback of fallbackFeatures) {
    if (byId.size >= 3) break;
    byId.set(fallback.id, fallback);
  }
  return [...byId.values()].slice(0, 3);
}

export function iconForFeature(icon: string) {
  const icons = {
    bot: Bot,
    gauge: Gauge,
    headphones: Headphones,
    monitor: MonitorCog,
    shield: ShieldCheck
  };
  return icons[icon as keyof typeof icons] ?? Layers3;
}

export function formatStatNumber(value: number, decimals = 0) {
  return value.toLocaleString("pt-BR", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals
  });
}

export function formatPrice(value: number, currency: "BRL" | "USD" | "EUR") {
  return new Intl.NumberFormat("pt-BR", { currency, style: "currency" }).format(value / 100);
}

export function cycleSuffix(cycle: string) {
  return ({ annual: "/ano", custom: "", lifetime: "pagamento unico", monthly: "/mes", quarterly: "/trimestre", semiannual: "/semestre" } as Record<string, string>)[cycle] ?? "";
}

export function readablePlanFeature(key: string) {
  const features: Record<string, string> = {
    "billing.free_hosting_30d": "30 dias de hospedagem gratis",
    "billing.future_updates": "Atualizacoes futuras incluidas",
    "billing.lifetime_license": "Licenca vitalicia do modulo",
    "discord.courses": "Cursos, provas e publicacoes",
    "discord.dashboard": "Dashboard para configurar e acompanhar",
    "discord.logs": "Logs do Discord em tempo real",
    "discord.tickets": "Tickets de atendimento e suporte",
    "fivem.faction_basic": "Facção RP Basico: membros e acoes essenciais",
    "fivem.faction": "Facção RP Completo: membros, metas e estoque",
    "fivem.finance": "Financeiro FiveM com auditoria",
    "fivem.hierarchy": "Hierarquia FiveM e cargos",
    "fivem.police_basic": "Policia RP Basico: acoes, QRU e ponto",
    "fivem.police": "Policia RP Completo: patentes, metas e plantao",
    "security.anti_ban": "Anti Ban administrativo",
    "security.role_protection_basic": "Protecao basica contra alteracao de cargos",
    "security.role_protection": "Protecao completa de cargos e permissoes",
    "security.self_bot": "SelfBot Protection",
    "streamer.ai": "Recursos de IA para comunidade",
    "streamer.clip_automation": "Automacao de clips",
    "streamer.giveaways": "Sorteios e campanhas",
    "streamer.kick_alerts": "Alertas Kick",
    "streamer.ranking": "Ranking de engajamento",
    "streamer.twitch_alerts": "Alertas Twitch",
    "streamer.vip": "Sistema VIP",
    "support.24h": "Atendimento prioritario 24 horas",
    "support.priority": "Suporte prioritario"
  };

  return features[key] ?? key.replace(/[._-]+/g, " ");
}

function getLandingServices(snapshot: PublicStatusSnapshot) {
  return snapshot.categories?.flatMap((category) => category.services ?? []) ?? [];
}

function sanitizeText(value: string | null | undefined, maxLength: number) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function safePublicImageUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.hostname === "cdn.discordapp.com" || url.hostname === "media.discordapp.net" ? url.toString() : null;
  } catch {
    return null;
  }
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? Math.round(value) : min));
}

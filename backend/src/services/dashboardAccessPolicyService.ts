import axios from "axios";
import { getMongoCollections, type MongoPlanSubscription, type MongoPlanWorkspace } from "../database/mongo";
import { getDevBotToken } from "./devBotService";

/*
 * Política de acesso da dashboard.
 *
 * Duas verificações que não existiam no fluxo antigo e que precisam valer para
 * TODA requisição autenticada, não só para a tela de login:
 *
 * 1. Presença real do bot no servidor. O cadastro em `botGuildConfigs` prova
 *    apenas que alguém vinculou o servidor um dia; aqui perguntamos ao Discord,
 *    com o token do próprio bot, se ele continua lá.
 * 2. Plano ativo. Antes só fatura vencida bloqueava; agora a ausência de
 *    assinatura ativa também bloqueia.
 */

const DISCORD_API = "https://discord.com/api/v10";
const PRESENT_CACHE_MS = 5 * 60 * 1000;
const ABSENT_CACHE_MS = 60 * 1000;
const PLAN_CACHE_MS = 60 * 1000;
const PRESENCE_TIMEOUT_MS = 4000;

export const PLAN_REQUIRED_MESSAGE = [
  "Acesso bloqueado",
  "",
  "Você não possui um plano ativo para acessar esta dashboard. Ative ou renove seu plano para continuar."
].join("\n");

export const BOT_NOT_IN_GUILD_MESSAGE = [
  "Acesso bloqueado",
  "",
  "O bot cadastrado não está mais presente no servidor vinculado a esta dashboard.",
  "Adicione o bot novamente ao servidor para restaurar o acesso."
].join("\n");

export type BotPresenceState = "present" | "absent" | "unknown";

export type PlanAccessState = {
  active: boolean;
  /**
   * Distingue "plano vencido/suspenso" de "bot nunca teve plano". Bots criados
   * direto no painel dev não passam por checkout e não possuem workspace, então
   * tratá-los como inadimplentes bloquearia a operação inteira.
   */
  hasPlanRecord: boolean;
  status: string | null;
  planId: string | null;
  planSlug: string | null;
  startedAt: string | null;
  endsAt: string | null;
  reason: string | null;
};

type PresenceCacheEntry = { state: BotPresenceState; expiresAt: number };
type PlanCacheEntry = { plan: PlanAccessState; expiresAt: number };

const presenceCache = new Map<string, PresenceCacheEntry>();
const planCache = new Map<string, PlanCacheEntry>();

/**
 * Traduz a resposta do Discord em presença.
 *
 * `unknown` existe para não derrubar clientes legítimos quando o problema é do
 * Discord (429/5xx/timeout): nesse caso mantemos o último estado conhecido em
 * vez de negar acesso por indisponibilidade de terceiro. Já 401/403/404 são
 * respostas conclusivas de que o bot não enxerga aquele servidor.
 */
export function evaluatePresenceResponseStatus(status: number | null | undefined): BotPresenceState {
  if (status === 200) return "present";
  if (status === 401 || status === 403 || status === 404) return "absent";
  return "unknown";
}

/** Assinatura só libera acesso se estiver `active` e dentro da validade. */
export function evaluatePlanSubscription(
  workspace: Pick<MongoPlanWorkspace, "status" | "subscriptionId"> | null,
  subscription: Pick<MongoPlanSubscription, "status" | "planId" | "planSlug" | "startedAt" | "endsAt"> | null,
  now: Date = new Date()
): PlanAccessState {
  const empty: PlanAccessState = {
    active: false,
    hasPlanRecord: false,
    status: null,
    planId: null,
    planSlug: null,
    startedAt: null,
    endsAt: null,
    reason: "Nenhum plano encontrado para este bot."
  };

  if (!workspace || workspace.status === "cancelled" || !workspace.subscriptionId) {
    return empty;
  }

  if (!subscription) {
    return empty;
  }

  const base: PlanAccessState = {
    active: false,
    hasPlanRecord: true,
    status: subscription.status,
    planId: subscription.planId ?? null,
    planSlug: subscription.planSlug ?? null,
    startedAt: subscription.startedAt?.toISOString?.() ?? null,
    endsAt: subscription.endsAt?.toISOString?.() ?? null,
    reason: null
  };

  if (subscription.status !== "active") {
    return { ...base, reason: `Assinatura com status "${subscription.status}".` };
  }

  if (subscription.endsAt instanceof Date && subscription.endsAt.getTime() <= now.getTime()) {
    return { ...base, reason: "Assinatura vencida." };
  }

  return { ...base, active: true };
}

export async function getBotPlanAccess(botId: string, now: Date = new Date()): Promise<PlanAccessState> {
  const cached = planCache.get(botId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.plan;
  }

  const { devBots, planSubscriptions, planWorkspaces } = await getMongoCollections();
  const bot = await devBots.findOne({ _id: botId }, { projection: { ownerId: 1 } });

  if (!bot) {
    const missing: PlanAccessState = {
      active: false,
      hasPlanRecord: false,
      status: null,
      planId: null,
      planSlug: null,
      startedAt: null,
      endsAt: null,
      reason: "Bot não encontrado."
    };
    planCache.set(botId, { plan: missing, expiresAt: Date.now() + PLAN_CACHE_MS });
    return missing;
  }

  const workspace = await planWorkspaces.findOne({
    status: { $ne: "cancelled" },
    $or: [
      { botIds: botId },
      { ownerDiscordId: bot.ownerId },
      { ownerUserId: bot.ownerId }
    ]
  });
  const subscription = workspace?.subscriptionId
    ? await planSubscriptions.findOne({ _id: workspace.subscriptionId })
    : null;
  const plan = evaluatePlanSubscription(workspace, subscription, now);

  planCache.set(botId, { plan, expiresAt: Date.now() + PLAN_CACHE_MS });
  return plan;
}

/**
 * Pergunta ao Discord se o bot ainda está no servidor.
 *
 * Guarda o resultado em cache curto porque esta função entra no caminho de
 * autorização de toda requisição: sem cache, cada clique na dashboard viraria
 * uma chamada ao Discord e o IP compartilhado dos bots seria bloqueado.
 */
export async function getBotGuildPresence(botId: string, guildId: string): Promise<BotPresenceState> {
  const cacheKey = `${botId}:${guildId}`;
  const cached = presenceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.state;
  }

  const token = await getDevBotToken(botId).catch(() => null);

  if (!token) {
    // Sem token não há como confirmar nada; mantém o último estado conhecido.
    return cached?.state ?? "unknown";
  }

  let state: BotPresenceState;

  try {
    const response = await axios.get(`${DISCORD_API}/guilds/${guildId}`, {
      headers: { Authorization: `Bot ${token}` },
      timeout: PRESENCE_TIMEOUT_MS,
      validateStatus: () => true
    });
    state = evaluatePresenceResponseStatus(response.status);
  } catch (error) {
    console.warn(
      `[access] não foi possível confirmar a presença do bot ${botId} no servidor ${guildId}:`,
      error instanceof Error ? error.message : error
    );
    state = "unknown";
  }

  if (state === "unknown") {
    return cached?.state ?? "unknown";
  }

  presenceCache.set(cacheKey, {
    state,
    expiresAt: Date.now() + (state === "present" ? PRESENT_CACHE_MS : ABSENT_CACHE_MS)
  });

  return state;
}

/**
 * `unknown` não bloqueia: indisponibilidade do Discord não pode derrubar o
 * acesso de quem está em dia. Só um "absent" confirmado nega.
 */
export async function isBotPresentInGuild(botId: string, guildId: string) {
  return (await getBotGuildPresence(botId, guildId)) !== "absent";
}

export function clearDashboardAccessPolicyCache(botId?: string | null) {
  if (!botId) {
    presenceCache.clear();
    planCache.clear();
    return;
  }

  planCache.delete(botId);
  for (const key of presenceCache.keys()) {
    if (key.startsWith(`${botId}:`)) {
      presenceCache.delete(key);
    }
  }
}

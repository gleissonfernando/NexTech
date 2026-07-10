import { createHash, randomUUID } from "node:crypto";
import {
  DiscordAPIError,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type Message
} from "discord.js";
import { currentRuntimeBotId, env, isBotModuleEnabled } from "../config/env";
import type { BotCommand, BotContext } from "../types";
import type { FivemHierarchyPanel } from "./apiClient";
import { renderComponentsV2Panel, type PanelVisualConfig } from "./panelVisualRenderer";
import type { FivemHierarchyPanelUpdateAck, FivemHierarchyPanelUpdateEvent } from "../websocket/socketClient";

type ScheduledRefresh = {
  deletedRoleIds: Set<string>;
  fullRefresh: boolean;
  members: Map<string, GuildMember>;
  removedUserIds: Set<string>;
  roleIds: Set<string>;
  timeout: NodeJS.Timeout;
};

type HierarchyMemberSnapshot = {
  displayName: string;
  roleIds: string[];
  userId: string;
  username: string;
};

type HierarchyRenderEntry = FivemHierarchyPanel["hierarchies"][number] & {
  cacheKey: string;
};

type HierarchyPanelCache = {
  assignedEntryIdsByUserId: Map<string, Set<string>>;
  assignmentsByEntryId: Map<string, HierarchyMemberSnapshot[]>;
  guildId: string;
  membersByUserId: Map<string, HierarchyMemberSnapshot>;
  panelId: string;
  signature: string;
};

type HierarchyPublishResult = {
  error?: string;
  messageId?: string | null;
  ok: boolean;
  panelId: string;
};

type HierarchyPublishInput = {
  cache: HierarchyPanelCache;
  context: BotContext;
  guildGeneration: number;
  guild: Guild;
  panel: FivemHierarchyPanel;
  panelGeneration: number;
};

type HierarchyPanelLock = {
  configRevision: number;
  lockToken: string;
};

type HierarchyPublishWaiter = {
  resolve: (result: HierarchyPublishResult) => void;
};

type QueuedHierarchyPublish = {
  input: HierarchyPublishInput;
  waiters: HierarchyPublishWaiter[];
};

type HierarchyPublishQueue = {
  cancelled: boolean;
  drainPromise: Promise<void> | null;
  pending: QueuedHierarchyPublish | null;
};

const HIERARCHY_PANEL_VERSION = 2;
const HIERARCHY_INSTANCE_ID = `hierarchy:${process.pid}:${randomUUID()}`;
const scheduledGuilds = new Map<string, ScheduledRefresh>();
const hierarchyPanelCaches = new Map<string, HierarchyPanelCache>();
const hierarchyPublishQueues = new Map<string, HierarchyPublishQueue>();
const deletedHierarchyPanels = new Set<string>();
const hierarchyGuildGenerations = new Map<string, number>();
const hierarchyPanelGenerations = new Map<string, number>();
let hierarchyServiceStarted = false;

export const hierarchyCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("hierarquia")
    .setDescription("Gerencia ou atualiza os painéis de Hierarquia V2.")
    .addSubcommand((subcommand) => subcommand
      .setName("config")
      .setDescription("Abre a configuração da Hierarquia V2 na dashboard."))
    .addSubcommand((subcommand) => subcommand
      .setName("atualizar")
      .setDescription("Atualiza agora os painéis de Hierarquia V2.")),
  moduleId: "fivem-hierarchy",
  async execute(interaction: ChatInputCommandInteraction, context: BotContext) {
    if (!interaction.guild) return;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "Voce precisa de permissao para gerenciar o servidor.", ephemeral: true });
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "config") {
      const origin = (env.FRONTEND_URL || "https://orvitek-bots.discloud.app").replace(/\/+$/, "");
      await interaction.reply({
        content: `Configure os painéis de Hierarquia V2 pela dashboard:\n${origin}/dashboard/hierarquia`,
        ephemeral: true
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const results = await refreshHierarchyPanelsForGuild(interaction.guild, context);
    const updated = results.filter((result) => result.ok).length;
    const failed = results.length - updated;
    await interaction.editReply(failed
      ? `Hierarquia V2 processada: ${updated} painel(is) atualizado(s) e ${failed} com falha.`
      : `Hierarquia V2 atualizada: ${updated} painel(is) processado(s).`);
  }
};

export function startFivemHierarchyService(client: Client<true>, context: BotContext) {
  if (hierarchyServiceStarted) {
    console.info("[HIERARCHY] Serviço V2 já estava iniciado; chamada duplicada ignorada.");
    return;
  }
  hierarchyServiceStarted = true;
  const runtimeBotId = currentRuntimeBotId() ?? (env.DASHBOARD_BOT_ID.trim() || "principal");
  const ownedGuildIds = client.guilds.cache.map((guild) => guild.id).sort();
  console.info(`[HIERARCHY] Serviço V2 iniciado. InstanceId: ${HIERARCHY_INSTANCE_ID}. RuntimeBot: ${runtimeBotId}. Guilds: ${ownedGuildIds.join(",") || "nenhuma"}.`);
  console.info("[HIERARCHY] Serviço legado desativado.");

  context.socket.onFivemHierarchyPanelUpdate((payload, ack?: FivemHierarchyPanelUpdateAck) => {
    void handleHierarchyPanelUpdateEvent(client, context, payload)
      .then((result) => ack?.(result))
      .catch((error) => {
        ack?.({
          error: `Falha inesperada ao publicar hierarquia: ${errorMessage(error)}`,
          ok: false,
          panelId: payload.panelId ?? undefined
        });
      });
  });

  for (const guild of client.guilds.cache.values()) {
    scheduleHierarchyRefresh(guild, context);
  }
}

async function handleHierarchyPanelUpdateEvent(
  client: Client<true>,
  context: BotContext,
  payload: FivemHierarchyPanelUpdateEvent
): Promise<HierarchyPublishResult> {
  const panelId = payload.panelId ?? null;
  const guild = client.guilds.cache.get(payload.guildId);
  if (!guild) {
    return { error: "O bot nao esta conectado ao servidor selecionado.", ok: false, panelId: panelId ?? "unknown" };
  }
  invalidateHierarchyRefreshGeneration(payload.guildId, panelId);

  if (payload.action === "delete") {
    if (!panelId) {
      return { error: "Painel de hierarquia nao informado para exclusao.", ok: false, panelId: "unknown" };
    }
    await cancelHierarchyPanelUpdates(payload.guildId, panelId, true);
    hierarchyPanelCaches.delete(panelCacheKey(payload.guildId, panelId));
    await deleteOfficialHierarchyPanelMessage(
      guild,
      payload.oldPanelChannelId ?? null,
      payload.oldPanelMessageId ?? null,
      panelId
    );
    return { messageId: null, ok: true, panelId };
  }

  if (panelId) {
    if (payload.oldPanelChannelId || payload.oldPanelMessageId) {
      await cancelHierarchyPanelUpdates(payload.guildId, panelId, false);
    }
  }

  const results = await refreshHierarchyPanelsForGuild(guild, context, panelId);
  const success = results.find((result) => result.ok);
  if (!success) {
    return results[0] ?? {
      error: "Nenhum painel de hierarquia ativo foi encontrado para publicar.",
      ok: false,
      panelId: panelId ?? "unknown"
    };
  }

  if (payload.oldPanelChannelId && payload.oldPanelMessageId) {
    await deleteOfficialHierarchyPanelMessage(
      guild,
      payload.oldPanelChannelId,
      payload.oldPanelMessageId,
      panelId ?? "unknown",
      new Set([success.messageId].filter((value): value is string => Boolean(value)))
    );
  }
  return success;
}

export function scheduleHierarchyRefresh(guild: Guild, context: BotContext) {
  scheduleHierarchyRefreshInternal(guild, context, { fullRefresh: true });
}

export function scheduleHierarchyRefreshForMember(member: GuildMember, context: BotContext, roleIds?: string[]) {
  scheduleHierarchyRefreshInternal(member.guild, context, {
    members: [member],
    roleIds: roleIds?.length ? roleIds : member.roles.cache.map((role) => role.id)
  });
}

export function scheduleHierarchyMemberRemoval(guild: Guild, context: BotContext, userId: string) {
  scheduleHierarchyRefreshInternal(guild, context, {
    removedUserIds: [userId]
  });
}

export function scheduleHierarchyRefreshForRoles(guild: Guild, context: BotContext, roleIds: string[], options: { deleted?: boolean } = {}) {
  const uniqueRoleIds = [...new Set(roleIds.filter(Boolean))];
  if (!uniqueRoleIds.length) return;
  scheduleHierarchyRefreshInternal(guild, context, {
    deletedRoleIds: options.deleted ? uniqueRoleIds : [],
    roleIds: uniqueRoleIds
  });
}

function scheduleHierarchyRefreshInternal(guild: Guild, context: BotContext, input: {
  deletedRoleIds?: string[];
  fullRefresh?: boolean;
  members?: GuildMember[];
  removedUserIds?: string[];
  roleIds?: string[];
}) {
  if (!isBotModuleEnabled("fivem-hierarchy")) return;
  const current = scheduledGuilds.get(guild.id);
  if (current) clearTimeout(current.timeout);
  const fullRefresh = current?.fullRefresh === true || input.fullRefresh === true;
  const members = fullRefresh ? new Map<string, GuildMember>() : new Map(current?.members ?? []);
  const removedUserIds = fullRefresh ? new Set<string>() : new Set(current?.removedUserIds ?? []);
  const roleIds = fullRefresh ? new Set<string>() : new Set(current?.roleIds ?? []);
  const deletedRoleIds = fullRefresh ? new Set<string>() : new Set(current?.deletedRoleIds ?? []);

  if (!fullRefresh) {
    for (const member of input.members ?? []) {
      members.set(member.id, member);
      removedUserIds.delete(member.id);
    }
    for (const userId of input.removedUserIds ?? []) {
      removedUserIds.add(userId);
      members.delete(userId);
    }
    for (const roleId of input.roleIds ?? []) roleIds.add(roleId);
    for (const roleId of input.deletedRoleIds ?? []) {
      roleIds.add(roleId);
      deletedRoleIds.add(roleId);
    }
  }

  const timeout = setTimeout(() => {
    scheduledGuilds.delete(guild.id);
    const job = { deletedRoleIds, fullRefresh, members, removedUserIds, roleIds };
    if (job.fullRefresh) {
      void refreshHierarchyPanelsForGuild(guild, context);
      return;
    }
    void refreshHierarchyPanelsIncrementally(guild, context, job);
  }, 2500);
  timeout.unref();
  scheduledGuilds.set(guild.id, { deletedRoleIds, fullRefresh, members, removedUserIds, roleIds, timeout });
}

export async function refreshHierarchyPanelsForGuild(guild: Guild, context: BotContext, panelId?: string | null, changedRoleIds?: string[] | null) {
  const generationSnapshot = hierarchyRefreshGenerationSnapshot(guild.id);
  const panels = await context.api.getActiveFivemHierarchyPanels().catch((error) => {
    console.warn(`[fivem-hierarchy] falha ao buscar paineis ativos: ${errorMessage(error)}`);
    return [];
  });
  const changedRoleSet = changedRoleIds?.length ? new Set(changedRoleIds) : null;
  const scoped = panels.filter((panel) => {
    if (panel.guildId !== guild.id) return false;
    if (panelId && panel.id !== panelId) return false;
    if (!changedRoleSet) return true;
    return panel.hierarchies.some((item) => item.active && changedRoleSet.has(item.roleId));
  });
  if (!scoped.length) {
    return panelId
      ? [{ error: "Painel ativo nao encontrado para este bot. Salve o painel como ativo e confira se o bot DEV correto esta selecionado.", ok: false, panelId }]
      : [];
  }
  const fetchedMembers = await guild.members.fetch().catch((error) => {
    console.warn(`[fivem-hierarchy] falha ao buscar membros do servidor ${guild.id}: ${errorMessage(error)}`);
    return null;
  });
  const results = [];
  for (const panel of scoped) {
    const cache = rebuildHierarchyPanelCache(guild, panel, (fetchedMembers ?? guild.members.cache).values());
    hierarchyPanelCaches.set(panelCacheKey(guild.id, panel.id), cache);
    results.push(await publishHierarchyPanel(guild, context, panel, cache, generationSnapshot));
  }
  return results;
}

async function refreshHierarchyPanelsIncrementally(guild: Guild, context: BotContext, job: Omit<ScheduledRefresh, "timeout">) {
  const generationSnapshot = hierarchyRefreshGenerationSnapshot(guild.id);
  const panels = await context.api.getActiveFivemHierarchyPanels().catch((error) => {
    console.warn(`[fivem-hierarchy] falha ao buscar paineis ativos: ${errorMessage(error)}`);
    return [];
  });
  const activePanels = panels.filter((panel) => panel.guildId === guild.id);
  if (!activePanels.length) return [];

  if (job.removedUserIds.size && !activePanels.some((panel) => hierarchyPanelCaches.has(panelCacheKey(guild.id, panel.id)))) {
    return refreshHierarchyPanelsForGuild(guild, context);
  }

  const roleIds = new Set(job.roleIds);
  for (const member of job.members.values()) {
    for (const roleId of member.roles.cache.keys()) roleIds.add(roleId);
  }

  const scoped = activePanels.filter((panel) => {
    const cache = hierarchyPanelCaches.get(panelCacheKey(guild.id, panel.id));
    if (intersects(panelRoleIds(panel), roleIds)) return true;
    if (cache && [...job.removedUserIds].some((userId) => cache.membersByUserId.has(userId))) return true;
    if (cache && [...job.members.keys()].some((userId) => cache.membersByUserId.has(userId))) return true;
    return false;
  });
  if (!scoped.length) return [];

  const fallbackPanelIds = new Set<string>();
  const results = [];

  for (const panel of scoped) {
    const cache = hierarchyPanelCaches.get(panelCacheKey(guild.id, panel.id));
    if (!cache || cache.signature !== panelCacheSignature(panel)) {
      fallbackPanelIds.add(panel.id);
      continue;
    }

    let changed = false;
    for (const roleId of job.deletedRoleIds) {
      changed = removeRoleFromPanelCache(cache, panel, roleId) || changed;
    }
    for (const userId of job.removedUserIds) {
      changed = removeMemberFromPanelCache(cache, userId) || changed;
    }
    for (const member of job.members.values()) {
      changed = upsertMemberInPanelCache(cache, panel, member) || changed;
    }

    if (changed) {
      results.push(await publishHierarchyPanel(guild, context, panel, cache, generationSnapshot));
    }
  }

  if (fallbackPanelIds.size) {
    const fetchedMembers = await guild.members.fetch().catch((error) => {
      console.warn(`[fivem-hierarchy] falha ao reconstruir cache de membros do servidor ${guild.id}: ${errorMessage(error)}`);
      return null;
    });
    const members = [...(fetchedMembers ?? guild.members.cache).values()];
    for (const panel of scoped.filter((item) => fallbackPanelIds.has(item.id))) {
      const cache = rebuildHierarchyPanelCache(guild, panel, members);
      hierarchyPanelCaches.set(panelCacheKey(guild.id, panel.id), cache);
      results.push(await publishHierarchyPanel(guild, context, panel, cache, generationSnapshot));
    }
  }

  return results;
}

async function publishHierarchyPanel(
  guild: Guild,
  context: BotContext,
  panel: FivemHierarchyPanel,
  cache: HierarchyPanelCache,
  generationSnapshot: ReturnType<typeof hierarchyRefreshGenerationSnapshot>
) {
  const lockKey = panelCacheKey(guild.id, panel.id);
  const input = {
    cache,
    context,
    guild,
    guildGeneration: generationSnapshot.guildGeneration,
    panel,
    panelGeneration: generationSnapshot.panelGenerations.get(lockKey) ?? 0
  };
  if (deletedHierarchyPanels.has(lockKey) || !isHierarchyPublishInputCurrent(input)) {
    return hierarchyCancelledResult(panel.id);
  }

  let queue = hierarchyPublishQueues.get(lockKey);
  if (!queue) {
    queue = { cancelled: false, drainPromise: null, pending: null };
    hierarchyPublishQueues.set(lockKey, queue);
  }

  const activeQueue = queue;
  return new Promise<HierarchyPublishResult>((resolve) => {
    if (activeQueue.cancelled || deletedHierarchyPanels.has(lockKey)) {
      resolve(hierarchyCancelledResult(panel.id));
      return;
    }

    const waiter = { resolve };
    if (activeQueue.pending) {
      activeQueue.pending.input = input;
      activeQueue.pending.waiters.push(waiter);
      console.info(`[HIERARCHY] Atualização concorrente agrupada. Guild: ${guild.id}. Hierarquia: ${panel.id}.`);
    } else {
      activeQueue.pending = { input, waiters: [waiter] };
    }

    if (!activeQueue.drainPromise) {
      activeQueue.drainPromise = drainHierarchyPublishQueue(lockKey, activeQueue)
        .finally(() => {
          if (hierarchyPublishQueues.get(lockKey) === activeQueue) {
            hierarchyPublishQueues.delete(lockKey);
          }
        });
    }
  });
}

async function drainHierarchyPublishQueue(lockKey: string, queue: HierarchyPublishQueue) {
  try {
    while (!queue.cancelled && queue.pending) {
      const queued = queue.pending;
      queue.pending = null;
      let result: HierarchyPublishResult;
      try {
        result = await publishHierarchyPanelWithLocks(
          queued.input,
          () => queue.cancelled || deletedHierarchyPanels.has(lockKey) || !isHierarchyPublishInputCurrent(queued.input)
        );
      } catch (error) {
        result = {
          error: `Falha inesperada na fila de hierarquia: ${errorMessage(error)}`,
          ok: false,
          panelId: queued.input.panel.id
        };
      }
      for (const waiter of queued.waiters) waiter.resolve(result);
    }
  } finally {
    const pending = queue.pending;
    queue.pending = null;
    if (pending) {
      const result = hierarchyCancelledResult(pending.input.panel.id);
      for (const waiter of pending.waiters) waiter.resolve(result);
    }
  }
}

async function cancelHierarchyPanelUpdates(guildId: string, panelId: string, markDeleted: boolean) {
  const lockKey = panelCacheKey(guildId, panelId);
  if (markDeleted) deletedHierarchyPanels.add(lockKey);
  const queue = hierarchyPublishQueues.get(lockKey);
  if (!queue) return;
  queue.cancelled = true;

  const pending = queue.pending;
  queue.pending = null;
  if (pending) {
    const result = hierarchyCancelledResult(panelId);
    for (const waiter of pending.waiters) waiter.resolve(result);
  }

  await queue.drainPromise?.catch(() => undefined);
  if (hierarchyPublishQueues.get(lockKey) === queue) hierarchyPublishQueues.delete(lockKey);
}

function hierarchyCancelledResult(panelId: string): HierarchyPublishResult {
  return { error: "Atualização de hierarquia cancelada porque a configuração mudou ou foi excluída.", ok: false, panelId };
}

async function publishHierarchyPanelWithLocks(input: HierarchyPublishInput, isCancelled: () => boolean): Promise<HierarchyPublishResult> {
  const { context, guild, panel } = input;
  if (isCancelled()) return hierarchyCancelledResult(panel.id);

  let lock: Awaited<ReturnType<BotContext["api"]["acquireFivemHierarchyPanelLock"]>>;
  try {
    lock = await context.api.acquireFivemHierarchyPanelLock({
      guildId: guild.id,
      instanceId: HIERARCHY_INSTANCE_ID,
      panelId: panel.id,
      ttlMs: 30_000
    });
  } catch (error) {
    const reason = errorMessage(error);
    console.warn(`[HIERARCHY] Falha ao adquirir lock distribuido para ${guild.id}:${panel.id}: ${reason}`);
    return {
      error: `Não foi possível confirmar o lock distribuído; publicação bloqueada para evitar duplicidade: ${reason}`,
      ok: false,
      panelId: panel.id
    };
  }

  if (!lock.acquired || !lock.lockToken) {
    console.info(`[HIERARCHY] Atualização duplicada bloqueada pelo lock distribuido. Guild: ${guild.id}. Hierarquia: ${panel.id}.`);
    return { error: "Outra instância já está atualizando esta hierarquia.", ok: false, panelId: panel.id };
  }

  try {
    if (isCancelled()) return hierarchyCancelledResult(panel.id);
    return await publishHierarchyPanelUnlocked(input, isCancelled, {
      configRevision: lock.configRevision,
      lockToken: lock.lockToken
    });
  } finally {
    await context.api.releaseFivemHierarchyPanelLock({
      guildId: guild.id,
      instanceId: HIERARCHY_INSTANCE_ID,
      lockToken: lock.lockToken,
      panelId: panel.id
    }).catch((error) => {
      console.warn(`[HIERARCHY] Falha ao liberar lock distribuído para ${guild.id}:${panel.id}: ${errorMessage(error)}`);
    });
  }
}

async function publishHierarchyPanelUnlocked(input: HierarchyPublishInput, isCancelled: () => boolean, lock: HierarchyPanelLock): Promise<HierarchyPublishResult> {
  const { cache, context, guild, panel } = input;
  if (isCancelled()) return hierarchyCancelledResult(panel.id);
  if (!panel.enabled) return { error: "O painel de hierarquia esta desativado.", ok: false, panelId: panel.id };
  if (!panel.panelChannelId) return { error: "Canal do painel de hierarquia nao configurado.", ok: false, panelId: panel.id };
  const channel = await guild.channels.fetch(panel.panelChannelId).catch(() => null);
  if (!channel || !("send" in channel) || !("messages" in channel)) {
    const error = "Canal do painel nao encontrado ou nao e um canal de texto.";
    await logPublishFailure(context, guild.id, panel, error);
    return { error, ok: false, panelId: panel.id };
  }
  if (isCancelled()) return hierarchyCancelledResult(panel.id);
  const permissionReport = inspectPublishPermissions(guild, channel as PublishPermissionChannel, Boolean(panel.panelMessageId));
  await logPublishPermissionSnapshot(context, guild.id, panel, permissionReport);
  if (permissionReport.blockingMissing.length) {
    const error = `Permissoes ausentes no canal <#${channel.id}>: ${permissionReport.blockingMissing.join(", ")}. Permissoes reais: ${permissionReport.granted.join(", ") || "nenhuma"}.`;
    await logPublishFailure(context, guild.id, panel, error, permissionReport);
    return { error, ok: false, panelId: panel.id };
  }
  await logMissingHierarchyRoles(context, guild, panel);
  const visuals = await getHierarchyPanelVisualSlots(context, guild.id, panel);
  const payload = buildHierarchyPanel(guild, panel, cache, visuals[0] ?? null);
  const contentHash = generatePanelHash(normalizeHierarchyPanelPayloadForHash(payload));
  console.info(`[HIERARCHY] Atualização solicitada. Guild: ${guild.id}. Hierarquia: ${panel.id}. MessageId encontrado: ${panel.panelMessageId ?? "nenhum"}.`);
  if (isCancelled()) return hierarchyCancelledResult(panel.id);
  if (panel.panelMessageId) {
    let fetchError: unknown = null;
    const message = await channel.messages.fetch(panel.panelMessageId).catch((error) => {
      fetchError = error;
      return null;
    });
    if (!message) {
      if (!isDiscordUnknownMessageError(fetchError)) {
        await logPublishFailure(context, guild.id, panel, `Mensagem salva do painel nao foi encontrada para edicao: ${discordErrorMessage(fetchError)}.`, permissionReport);
        return { error: "Nao foi possivel validar a mensagem salva do painel. O bot nao enviou outra mensagem para evitar duplicidade.", ok: false, panelId: panel.id };
      }
      await logStaleHierarchyPanelMessage(context, guild.id, panel, panel.panelMessageId, permissionReport);
    } else {
      if (message.author.id !== guild.client.user?.id) {
        const error = "O messageId salvo aponta para uma mensagem que não pertence a este bot.";
        await logPublishFailure(context, guild.id, panel, error, permissionReport);
        return { error, ok: false, panelId: panel.id };
      }
      const publishedContentHash = generatePanelHash(normalizeHierarchyMessageForHash(message));
      if (publishedContentHash === contentHash) {
        if (panel.panelVersion !== HIERARCHY_PANEL_VERSION || panel.contentHash !== contentHash) {
          const persisted = await persistHierarchyPanelState(context, guild.id, panel.id, message.id, contentHash, lock).catch(async (error) => {
            await logPublishFailure(context, guild.id, panel, `Conteúdo correto, mas falha ao persistir estado: ${errorMessage(error)}.`, permissionReport);
            return false;
          });
          if (!persisted) {
            return { error: "O painel está correto no Discord, mas o estado oficial não pôde ser persistido.", ok: false, panelId: panel.id };
          }
        }
        if (isCancelled()) return hierarchyCancelledResult(panel.id);
        console.info(`[HIERARCHY] Conteúdo sem alterações. Atualização ignorada. Guild: ${guild.id}. Hierarquia: ${panel.id}.`);
        await cleanupHierarchyMigrationIfPending(channel as MigrationCleanupChannel, message, panel);
        return { messageId: message.id, ok: true, panelId: panel.id };
      }
      if (isCancelled()) return hierarchyCancelledResult(panel.id);
      const edited = await message.edit(payload).catch(async (error) => {
        await logPublishFailure(context, guild.id, panel, `Falha ao editar painel existente: ${discordErrorMessage(error)}. ${permissionHint(permissionReport)}`, permissionReport);
        return null;
      });
      if (!edited) {
        return { error: `Falha ao editar a mensagem salva do painel. ${permissionHint(permissionReport)}`, ok: false, panelId: panel.id };
      }
      if (isCancelled()) return hierarchyCancelledResult(panel.id);
      const persisted = await persistHierarchyPanelState(context, guild.id, panel.id, edited.id, contentHash, lock).catch(async (error) => {
        await logPublishFailure(context, guild.id, panel, `Mensagem editada, mas falha ao persistir estado: ${errorMessage(error)}.`, permissionReport);
        return false;
      });
      if (!persisted) {
        return { error: "A mensagem foi editada, mas o estado oficial não pôde ser persistido.", ok: false, panelId: panel.id };
      }
      console.info(`[HIERARCHY] Mensagem oficial editada. Guild: ${guild.id}. Hierarquia: ${panel.id}. MessageId: ${edited.id}.`);
      await cleanupHierarchyMigrationIfPending(channel as MigrationCleanupChannel, edited, panel);
      return { messageId: edited.id, ok: true, panelId: panel.id };
    }
  }

  if (isCancelled()) return hierarchyCancelledResult(panel.id);
  const message = await channel.send(payload).catch(async (error) => {
    await logPublishFailure(context, guild.id, panel, `Falha ao enviar painel inicial: ${discordErrorMessage(error)}. ${permissionHint(permissionReport)}`, permissionReport);
    return null;
  });
  if (message) {
    if (isCancelled()) {
      await deleteUnpersistedHierarchyMessage(message, panel);
      return hierarchyCancelledResult(panel.id);
    }
    const persisted = await persistHierarchyPanelState(context, guild.id, panel.id, message.id, contentHash, lock).catch(async (error) => {
      await logPublishFailure(context, guild.id, panel, `Nova mensagem criada, mas falha ao persistir messageId: ${errorMessage(error)}.`, permissionReport);
      return false;
    });
    if (!persisted) {
      const removed = await deleteUnpersistedHierarchyMessage(message, panel);
      return {
        error: removed
          ? "A nova mensagem não foi persistida e foi removida para evitar duplicidade."
          : "A nova mensagem não foi persistida e não pôde ser removida; intervenção manual necessária.",
        ok: false,
        panelId: panel.id
      };
    }
    if (isCancelled()) {
      await deleteUnpersistedHierarchyMessage(message, panel);
      return hierarchyCancelledResult(panel.id);
    }
    console.info(`[HIERARCHY] Nova mensagem criada porque a anterior não existe. Guild: ${guild.id}. Hierarquia: ${panel.id}. MessageId: ${message.id}.`);
    await cleanupHierarchyMigrationIfPending(channel as MigrationCleanupChannel, message, panel);
    return { messageId: message.id, ok: true, panelId: panel.id };
  }
  return { error: `O Discord recusou o envio do painel no canal configurado. ${permissionHint(permissionReport)}`, ok: false, panelId: panel.id };
}

type MigrationCleanupChannel = {
  messages: {
    fetch(messageId: string): Promise<Message>;
  };
};

type PublishPermissionChannel = {
  id: string;
  permissionsFor(member: GuildMember): { has(permission: bigint): boolean; toArray(): string[] } | null;
};

function inspectPublishPermissions(guild: Guild, channel: PublishPermissionChannel, editingExistingMessage: boolean) {
  const me = guild.members.me;
  if (!me || !channel || !("permissionsFor" in channel)) {
    return {
      botId: me?.id ?? null,
      channelId: channel?.id ?? null,
      granted: [],
      blockingMissing: ["Validar membro do bot"],
      diagnosticMissing: ["Validar membro do bot"],
      required: ["Validar membro do bot"]
    };
  }
  const permissions = channel.permissionsFor(me);
  const required: Array<[bigint, string]> = [
    [PermissionFlagsBits.ViewChannel, "Ver Canal"],
    [PermissionFlagsBits.SendMessages, "Enviar Mensagens"],
    [PermissionFlagsBits.EmbedLinks, "Inserir Links"],
    [PermissionFlagsBits.ReadMessageHistory, "Ler Historico"]
  ];
  const diagnostic: Array<[bigint, string]> = editingExistingMessage
    ? [[PermissionFlagsBits.ManageMessages, "Gerenciar Mensagens"]]
    : [];
  const granted = permissions?.toArray() ?? [];
  const blockingMissing = required.filter(([permission]) => !permissions?.has(permission)).map(([, label]) => label);
  const diagnosticMissing = diagnostic.filter(([permission]) => !permissions?.has(permission)).map(([, label]) => label);
  const report = {
    botId: me.id,
    channelId: channel.id,
    granted,
    blockingMissing,
    diagnosticMissing,
    required: required.map(([, label]) => label),
    diagnostic: diagnostic.map(([, label]) => label)
  };
  console.info(`[fivem-hierarchy] permissoes do bot no canal ${channel.id}: granted=${granted.join(",") || "nenhuma"} missing=${blockingMissing.join(",") || "nenhuma"} diagnosticMissing=${diagnosticMissing.join(",") || "nenhuma"}`);
  return report;
}

async function logPublishPermissionSnapshot(context: BotContext, guildId: string, panel: FivemHierarchyPanel, permissionReport: ReturnType<typeof inspectPublishPermissions>) {
  await context.api.postLog({
    guildId,
    channelId: panel.panelChannelId,
    module: "fivem-hierarchy",
    action: "panel.permission_snapshot",
    type: "fivem_hierarchy.permission_snapshot",
    message: `Permissoes do bot no canal antes de publicar hierarquia: ${permissionReport.granted.join(", ") || "nenhuma"}. Faltando: ${permissionReport.blockingMissing.join(", ") || "nenhuma"}. Diagnostico: ${permissionReport.diagnosticMissing.join(", ") || "nenhuma"}.`,
    metadata: { panelId: panel.id, ...permissionReport }
  }).catch(() => null);
}

async function logPublishFailure(context: BotContext, guildId: string, panel: FivemHierarchyPanel, reason: string, permissionReport?: ReturnType<typeof inspectPublishPermissions>) {
  await context.api.postLog({
    guildId,
    channelId: panel.panelChannelId,
    module: "fivem-hierarchy",
    action: "panel.publish_failed",
    type: "fivem_hierarchy.publish_failed",
    message: `Falha ao publicar painel de hierarquia: ${reason}`,
    metadata: { panelId: panel.id, channelId: panel.panelChannelId, permissionReport: permissionReport ?? null, reason }
  }).catch(() => null);
}

async function logStaleHierarchyPanelMessage(context: BotContext, guildId: string, panel: FivemHierarchyPanel, staleMessageId: string, permissionReport: ReturnType<typeof inspectPublishPermissions>) {
  await context.api.postLog({
    guildId,
    channelId: panel.panelChannelId,
    module: "fivem-hierarchy",
    action: "panel.stale_message",
    type: "fivem_hierarchy.stale_message",
    message: `Mensagem salva do painel de hierarquia nao existe mais. Publicando um novo painel e atualizando o ID salvo.`,
    metadata: { channelId: panel.panelChannelId, panelId: panel.id, permissionReport, staleMessageId }
  }).catch(() => null);
}

function permissionHint(permissionReport: ReturnType<typeof inspectPublishPermissions>) {
  return permissionReport.blockingMissing.length
    ? `Permissoes faltando: ${permissionReport.blockingMissing.join(", ")}.`
    : `Permissoes calculadas no canal: ${permissionReport.granted.join(", ") || "nenhuma"}.`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function discordErrorMessage(error: unknown) {
  if (error instanceof DiscordAPIError) {
    return `${error.message} (${error.code})`;
  }
  return errorMessage(error);
}

function isDiscordUnknownMessageError(error: unknown) {
  if (!(error instanceof DiscordAPIError)) return false;
  return Number(error.code) === 10008 || Number((error as { status?: unknown }).status) === 404;
}

function isDiscordUnknownChannelError(error: unknown) {
  if (!(error instanceof DiscordAPIError)) return false;
  return Number(error.code) === 10003 || Number((error as { status?: unknown }).status) === 404;
}

type PanelVisualSetting = {
  blocks?: PanelVisualConfig["blocks"];
  imageEnabled: boolean;
  imagePosition: PanelVisualConfig["imagePosition"];
  imageUrl: string;
  useGlobalDefault: boolean;
};

type PanelVisualSlot = PanelVisualConfig & {
  useGlobalDefault?: boolean;
};

async function getHierarchyPanelVisualSlots(context: BotContext, guildId: string, panel: FivemHierarchyPanel) {
  return panelVisualSettingsToSlots(await getPanelVisualSettings(context, guildId, fivemHierarchyVisualPanelId(panel.id)));
}

async function getPanelVisualSettings(context: BotContext, guildId: string, basePanelId: string) {
  const panelIds = [basePanelId, `${basePanelId}-banner-2`, `${basePanelId}-banner-3`];
  return Promise.all(panelIds.map((panelId) => context.api.getPanelVisualSettings(guildId, panelId).catch(() => null)));
}

function panelVisualSettingsToSlots(visuals: Array<PanelVisualSetting | null>): PanelVisualSlot[] {
  return visuals.flatMap((visual, index): PanelVisualSlot[] => {
    if (!visual?.imageEnabled) return [];
    if (index > 0 && visual.useGlobalDefault) return [];
    return [{ blocks: visual.blocks ?? [], imageEnabled: visual.imageEnabled, imagePosition: visual.imagePosition, imageUrl: visual.imageUrl, useGlobalDefault: visual.useGlobalDefault }];
  });
}

function fivemHierarchyVisualPanelId(panelId: string) {
  const normalized = panelId
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 55);
  return `fivem-hierarchy-${normalized || "panel"}`;
}

function buildHierarchyPanel(guild: Guild, panel: FivemHierarchyPanel, cache: HierarchyPanelCache, visual: PanelVisualConfig | null) {
  const singleVisual = sanitizeSingleHierarchyVisual(visual?.imageEnabled ? visual : null);
  return renderComponentsV2Panel({ accentColor: colorToInt(panel.color), actions: [], description: panel.description ?? "Hierarquia atualizada automaticamente pelos cargos do servidor.", fields: renderHierarchyFields(guild, panel, cache), footer: panel.footerEnabled ? { text: panel.footerText ?? "OrviteK" } : { enabled: false }, image: singleVisual, moduleId: "fivem-hierarchy", title: panel.title });
}

export function generatePanelHash(payload: unknown) {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export function normalizeHierarchyPanelPayloadForHash(payload: unknown) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  return {
    components: normalizeHierarchyPanelComponentsForHash(record.components),
    isComponentsV2: hasComponentsV2Flag(record.flags)
  };
}

export function normalizeHierarchyMessageForHash(message: Pick<Message, "components" | "flags">) {
  return {
    components: normalizeHierarchyPanelComponentsForHash(message.components.map((component) => component.toJSON())),
    isComponentsV2: message.flags.has(MessageFlags.IsComponentsV2)
  };
}

export function normalizeHierarchyPanelComponentsForHash(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeHierarchyPanelComponentValue);
}

function normalizeHierarchyPanelComponentValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeHierarchyPanelComponentValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key, item]) => key !== "id" && item !== undefined && item !== null)
      .map(([key, item]) => [key, normalizeHierarchyPanelComponentValue(item)])
  );
}

function hasComponentsV2Flag(value: unknown) {
  const bitfield = typeof value === "bigint" ? value : BigInt(typeof value === "number" ? value : 0);
  return (bitfield & BigInt(MessageFlags.IsComponentsV2)) !== 0n;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function renderHierarchyFields(guild: Guild, panel: FivemHierarchyPanel, cache: HierarchyPanelCache) {
  const sections = orderedHierarchyEntries(panel).map((item) => {
    const roleExists = Boolean(guild.roles.cache.get(item.roleId));
    const members = roleExists
      ? [...(cache.assignmentsByEntryId.get(item.cacheKey) ?? [])].sort(compareHierarchyMembers)
      : [];
    const limitedMembers = typeof item.limit === "number" && item.limit > 0 ? members.slice(0, item.limit) : members;
    const hiddenCount = members.length - limitedMembers.length;
    const lines = limitedMembers.map(formatHierarchyMemberLine);
    if (hiddenCount > 0) lines.push(`_+${hiddenCount} membro(s) oculto(s) pelo limite configurado._`);
    return `${item.emoji ?? ""} **${item.name}**\n${lines.length ? lines.join("\n") : "*Nenhum membro encontrado.*"}`;
  });

  return splitHierarchySections(sections.length ? sections : ["*Nenhuma hierarquia configurada.*"]);
}

function rebuildHierarchyPanelCache(guild: Guild, panel: FivemHierarchyPanel, members: Iterable<GuildMember>): HierarchyPanelCache {
  void guild;
  const cache = createEmptyPanelCache(panel);

  for (const member of members) {
    upsertMemberInPanelCache(cache, panel, member);
  }

  return cache;
}

function createEmptyPanelCache(panel: FivemHierarchyPanel): HierarchyPanelCache {
  return {
    assignedEntryIdsByUserId: new Map(),
    assignmentsByEntryId: new Map(orderedHierarchyEntries(panel).map((entry) => [entry.cacheKey, []])),
    guildId: panel.guildId,
    membersByUserId: new Map(),
    panelId: panel.id,
    signature: panelCacheSignature(panel)
  };
}

function upsertMemberInPanelCache(cache: HierarchyPanelCache, panel: FivemHierarchyPanel, member: GuildMember) {
  return applyMemberSnapshotToPanelCache(cache, panel, {
    displayName: member.displayName || member.user.username,
    roleIds: member.roles.cache.map((role) => role.id),
    userId: member.id,
    username: member.user.username
  });
}

function applyMemberSnapshotToPanelCache(cache: HierarchyPanelCache, panel: FivemHierarchyPanel, snapshot: HierarchyMemberSnapshot) {
  const previousEntryIds = cache.assignedEntryIdsByUserId.get(snapshot.userId) ?? new Set<string>();
  const previousSnapshot = cache.membersByUserId.get(snapshot.userId) ?? null;
  const nextEntries = resolveHierarchyEntriesForRoleIds(panel, snapshot.roleIds);

  if (!nextEntries.length) {
    return removeMemberFromPanelCache(cache, snapshot.userId);
  }

  const nextEntryIds = new Set(nextEntries.map((entry) => entry.cacheKey));
  let changed = !sameStringSet(previousEntryIds, nextEntryIds)
    || !previousSnapshot
    || previousSnapshot.displayName !== snapshot.displayName
    || previousSnapshot.username !== snapshot.username;

  for (const previousEntryId of previousEntryIds) {
    if (!nextEntryIds.has(previousEntryId)) {
      changed = removeMemberFromEntry(cache, previousEntryId, snapshot.userId) || changed;
    }
  }

  for (const nextEntry of nextEntries) {
    const list = cache.assignmentsByEntryId.get(nextEntry.cacheKey) ?? [];
    const wasListed = list.some((member) => member.userId === snapshot.userId);
    cache.assignmentsByEntryId.set(nextEntry.cacheKey, [
      ...list.filter((member) => member.userId !== snapshot.userId),
      snapshot
    ]);
    if (!wasListed) changed = true;
  }

  cache.assignedEntryIdsByUserId.set(snapshot.userId, nextEntryIds);
  cache.membersByUserId.set(snapshot.userId, snapshot);
  return changed;
}

function removeMemberFromPanelCache(cache: HierarchyPanelCache, userId: string) {
  let changed = false;

  for (const entryId of cache.assignmentsByEntryId.keys()) {
    changed = removeMemberFromEntry(cache, entryId, userId) || changed;
  }

  if (cache.assignedEntryIdsByUserId.delete(userId)) changed = true;
  if (cache.membersByUserId.delete(userId)) changed = true;
  return changed;
}

function removeRoleFromPanelCache(cache: HierarchyPanelCache, panel: FivemHierarchyPanel, roleId: string) {
  let changed = false;
  const affected = [...cache.membersByUserId.values()].filter((member) => member.roleIds.includes(roleId));

  for (const member of affected) {
    changed = applyMemberSnapshotToPanelCache(cache, panel, {
      ...member,
      roleIds: member.roleIds.filter((item) => item !== roleId)
    }) || changed;
  }

  return changed;
}

function removeMemberFromEntry(cache: HierarchyPanelCache, entryId: string, userId: string) {
  const list = cache.assignmentsByEntryId.get(entryId);
  if (!list?.length) return false;
  const next = list.filter((member) => member.userId !== userId);
  if (next.length === list.length) return false;
  cache.assignmentsByEntryId.set(entryId, next);
  return true;
}

function resolveHierarchyEntriesForRoleIds(panel: FivemHierarchyPanel, roleIds: Iterable<string>): HierarchyRenderEntry[] {
  const roleSet = new Set(roleIds);
  return orderedHierarchyEntries(panel).filter((entry) => roleSet.has(entry.roleId));
}

export function resolveHierarchyEntryIdsForRoleIds(panel: FivemHierarchyPanel, roleIds: Iterable<string>) {
  return resolveHierarchyEntriesForRoleIds(panel, roleIds).map((entry) => entry.id);
}

function sameStringSet(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function orderedHierarchyEntries(panel: FivemHierarchyPanel): HierarchyRenderEntry[] {
  const seenRoleIds = new Set<string>();
  return panel.hierarchies
    .map((entry, index) => ({ ...entry, __index: index, cacheKey: `${entry.id}:${index}:${entry.roleId}` }))
    .filter((entry) => entry.active && entry.roleId)
    .sort((a, b) => a.order - b.order || a.__index - b.__index)
    .filter((entry) => {
      if (seenRoleIds.has(entry.roleId)) return false;
      seenRoleIds.add(entry.roleId);
      return true;
    })
    .map(({ __index, ...entry }) => entry);
}

function panelRoleIds(panel: FivemHierarchyPanel) {
  return new Set(orderedHierarchyEntries(panel).map((entry) => entry.roleId));
}

function panelCacheSignature(panel: FivemHierarchyPanel) {
  return JSON.stringify(orderedHierarchyEntries(panel).map((entry) => ({
    active: entry.active,
    cacheKey: entry.cacheKey,
    emoji: entry.emoji ?? null,
    id: entry.id,
    limit: entry.limit ?? null,
    name: entry.name,
    order: entry.order,
    roleId: entry.roleId
  })));
}

function panelCacheKey(guildId: string, panelId: string) {
  return `${guildId}:${panelId}`;
}

function hierarchyRefreshGenerationSnapshot(guildId: string) {
  return {
    guildGeneration: hierarchyGuildGenerations.get(guildId) ?? 0,
    panelGenerations: new Map(hierarchyPanelGenerations)
  };
}

function invalidateHierarchyRefreshGeneration(guildId: string, panelId: string | null) {
  if (panelId) {
    const lockKey = panelCacheKey(guildId, panelId);
    hierarchyPanelGenerations.set(lockKey, (hierarchyPanelGenerations.get(lockKey) ?? 0) + 1);
    return;
  }
  hierarchyGuildGenerations.set(guildId, (hierarchyGuildGenerations.get(guildId) ?? 0) + 1);
}

function isHierarchyPublishInputCurrent(input: HierarchyPublishInput) {
  const lockKey = panelCacheKey(input.guild.id, input.panel.id);
  return (hierarchyGuildGenerations.get(input.guild.id) ?? 0) === input.guildGeneration
    && (hierarchyPanelGenerations.get(lockKey) ?? 0) === input.panelGeneration;
}

function splitHierarchySections(sections: string[]) {
  const chunks: string[] = [];
  let current = "";

  for (const section of sections) {
    const next = current ? `${current}\n\n${section}` : section;
    if (next.length <= 3800) {
      current = next;
      continue;
    }

    if (current) chunks.push(current);
    if (section.length <= 3800) {
      current = section;
      continue;
    }

    const lines = section.split("\n");
    current = "";
    for (const line of lines) {
      const lineNext = current ? `${current}\n${line}` : line;
      if (lineNext.length <= 3800) {
        current = lineNext;
        continue;
      }
      if (current) chunks.push(current);
      current = line.slice(0, 3800);
    }
  }

  if (current) chunks.push(current);
  return chunks.slice(0, 35);
}

function intersects(left: Set<string>, right: Set<string>) {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}

function compareHierarchyMembers(left: HierarchyMemberSnapshot, right: HierarchyMemberSnapshot) {
  return (left.displayName || left.username).localeCompare(right.displayName || right.username, "pt-BR", { sensitivity: "base" });
}

function formatHierarchyMemberLine(member: HierarchyMemberSnapshot) {
  return `<@${member.userId}>`;
}

async function persistHierarchyPanelState(context: BotContext, guildId: string, panelId: string, messageId: string, contentHash: string, lock: HierarchyPanelLock) {
  const state = await context.api.updateFivemHierarchyPanelState({
    configRevision: lock.configRevision,
    contentHash,
    guildId,
    instanceId: HIERARCHY_INSTANCE_ID,
    lockToken: lock.lockToken,
    messageId,
    panelId,
    panelVersion: HIERARCHY_PANEL_VERSION
  });
  if (!state) throw new Error("O backend não encontrou mais a configuração da hierarquia.");
  if (state.panelMessageId !== messageId || state.contentHash !== contentHash || state.panelVersion !== HIERARCHY_PANEL_VERSION) {
    throw new Error("O backend não confirmou messageId, hash e versão persistidos.");
  }
  return true;
}

async function deleteUnpersistedHierarchyMessage(message: Message, panel: FivemHierarchyPanel) {
  try {
    await message.delete();
    console.info(`[HIERARCHY] Mensagem não persistida removida. Guild: ${panel.guildId}. Hierarquia: ${panel.id}. MessageId: ${message.id}.`);
    return true;
  } catch (error) {
    console.error(`[HIERARCHY] Falha ao remover mensagem não persistida ${message.id}: ${errorMessage(error)}`);
    return false;
  }
}

async function cleanupHierarchyMigrationIfPending(
  channel: MigrationCleanupChannel,
  currentMessage: Message,
  panel: FivemHierarchyPanel
) {
  const migration = readHierarchyMigrationCleanup(panel);
  if (!migration.pending || !migration.legacyMessageIds.length) return;
  if (!migration.hasCompleteOfficialMessageIds) {
    console.info(`[HIERARCHY] Limpeza de migração adiada. Hierarquia: ${panel.id}. A API ainda não forneceu a lista completa de messageIds oficiais.`);
    return;
  }

  const protectedMessageIds = new Set([
    currentMessage.id,
    panel.panelMessageId,
    ...migration.officialMessageIds
  ].filter((value): value is string => Boolean(value)));
  const botId = currentMessage.client.user?.id;
  if (!botId) return;

  for (const messageId of migration.legacyMessageIds) {
    if (protectedMessageIds.has(messageId)) continue;
    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message || message.author.id !== botId) continue;
    await message.delete().then(() => {
      console.info(`[HIERARCHY] Mensagem legada indicada pela migração removida. Hierarquia: ${panel.id}. MessageId: ${messageId}.`);
    }).catch((error) => {
      console.warn(`[HIERARCHY] Falha ao remover ID legado ${messageId}: ${errorMessage(error)}`);
    });
  }
}

function readHierarchyMigrationCleanup(panel: FivemHierarchyPanel) {
  const candidate = panel as FivemHierarchyPanel & {
    legacyMessageIds?: unknown;
    migrationPending?: unknown;
    officialMessageIds?: unknown;
  };
  return {
    hasCompleteOfficialMessageIds: Array.isArray(candidate.officialMessageIds),
    legacyMessageIds: Array.isArray(candidate.legacyMessageIds)
      ? [...new Set(candidate.legacyMessageIds.filter((value): value is string => typeof value === "string" && /^\d{5,32}$/.test(value)))]
      : [],
    officialMessageIds: Array.isArray(candidate.officialMessageIds)
      ? [...new Set(candidate.officialMessageIds.filter((value): value is string => typeof value === "string" && /^\d{5,32}$/.test(value)))]
      : [],
    pending: candidate.migrationPending === true
  };
}

async function deleteOfficialHierarchyPanelMessage(
  guild: Guild,
  channelId: string | null,
  messageId: string | null,
  panelId: string,
  protectedMessageIds: Set<string> = new Set()
) {
  if (!channelId || !messageId) return;
  if (protectedMessageIds.has(messageId)) return;
  const channel = await guild.channels.fetch(channelId).catch((error) => {
    if (isDiscordUnknownChannelError(error)) return null;
    throw error;
  });
  if (!channel || !("messages" in channel)) return;
  const message = await channel.messages.fetch(messageId).catch((error) => {
    if (isDiscordUnknownMessageError(error)) return null;
    throw error;
  });
  if (!message) return;
  if (message.author.id !== guild.client.user?.id) {
    throw new Error(`O messageId oficial ${messageId} não pertence a este bot; exclusão recusada.`);
  }
  await message.delete();
  console.info(`[HIERARCHY] Mensagem oficial anterior removida. Guild: ${guild.id}. Hierarquia: ${panelId}. MessageId: ${messageId}.`);
}

function sanitizeSingleHierarchyVisual(visual: PanelVisualConfig | null): PanelVisualConfig | null {
  if (!visual?.imageEnabled || !visual.imageUrl) return null;
  return {
    blocks: [],
    imageEnabled: true,
    imagePosition: visual.imagePosition === "thumbnail" ? "top" : visual.imagePosition,
    imageUrl: visual.imageUrl
  };
}

async function logMissingHierarchyRoles(context: BotContext, guild: Guild, panel: FivemHierarchyPanel) {
  const missing = panel.hierarchies
    .filter((item) => item.active && item.roleId && !guild.roles.cache.has(item.roleId))
    .map((item) => ({ name: item.name, roleId: item.roleId }));
  if (!missing.length) return;
  await context.api.postLog({
    guildId: guild.id,
    channelId: panel.panelChannelId,
    module: "fivem-hierarchy",
    action: "panel.missing_roles",
    type: "fivem_hierarchy.missing_roles",
    message: `Cargos configurados na hierarquia nao existem mais no servidor: ${missing.map((item) => `${item.name} (${item.roleId})`).join(", ")}`,
    metadata: { missing, panelId: panel.id }
  }).catch(() => null);
}

function colorToInt(value: string) {
  return Number.parseInt(value.replace("#", ""), 16) || 0x22c55e;
}

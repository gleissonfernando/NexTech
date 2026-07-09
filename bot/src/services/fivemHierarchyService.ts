import {
  DiscordAPIError,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type Message
} from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import type { BotCommand, BotContext } from "../types";
import type { FivemHierarchyPanel } from "./apiClient";
import { renderComponentsV2Panel, type PanelVisualConfig } from "./panelVisualRenderer";
import type { FivemHierarchyPanelUpdateAck } from "../websocket/socketClient";

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
  assignedEntryByUserId: Map<string, string>;
  assignmentsByEntryId: Map<string, HierarchyMemberSnapshot[]>;
  guildId: string;
  membersByUserId: Map<string, HierarchyMemberSnapshot>;
  panelId: string;
  signature: string;
};

const scheduledGuilds = new Map<string, ScheduledRefresh>();
const hierarchyPanelCaches = new Map<string, HierarchyPanelCache>();

export const hierarchyCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("hierarquia")
    .setDescription("Gerencia ou atualiza o painel de Hierarquia FAQ FiveM."),
  moduleId: "fivem-hierarchy",
  async execute(interaction: ChatInputCommandInteraction, context: BotContext) {
    if (!interaction.guild) return;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "Voce precisa de permissao para gerenciar o servidor.", ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    await refreshHierarchyPanelsForGuild(interaction.guild, context);
    await interaction.editReply("Painel de Hierarquia FAQ atualizado.");
  }
};

export function startFivemHierarchyService(client: Client<true>, context: BotContext) {
  context.socket.onFivemHierarchyPanelUpdate((payload, ack?: FivemHierarchyPanelUpdateAck) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (!guild) {
      ack?.({ error: "O bot nao esta conectado ao servidor selecionado.", ok: false, panelId: payload.panelId });
      return;
    }
    void refreshHierarchyPanelsForGuild(guild, context, payload.panelId)
      .then((results) => {
        const success = results.find((result) => result.ok);
        if (success) {
          ack?.(success);
          return;
        }
        ack?.(results[0] ?? { error: "Nenhum painel de hierarquia ativo foi encontrado para publicar.", ok: false, panelId: payload.panelId });
      })
      .catch((error) => {
        ack?.({ error: `Falha inesperada ao publicar hierarquia: ${errorMessage(error)}`, ok: false, panelId: payload.panelId });
      });
  });

  for (const guild of client.guilds.cache.values()) {
    scheduleHierarchyRefresh(guild, context);
  }
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
    results.push(await publishHierarchyPanel(guild, context, panel, cache));
  }
  return results;
}

async function refreshHierarchyPanelsIncrementally(guild: Guild, context: BotContext, job: Omit<ScheduledRefresh, "timeout">) {
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
      results.push(await publishHierarchyPanel(guild, context, panel, cache));
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
      results.push(await publishHierarchyPanel(guild, context, panel, cache));
    }
  }

  return results;
}

async function publishHierarchyPanel(guild: Guild, context: BotContext, panel: FivemHierarchyPanel, cache: HierarchyPanelCache) {
  if (!panel.enabled) return { error: "O painel de hierarquia esta desativado.", ok: false, panelId: panel.id };
  if (!panel.panelChannelId) return { error: "Canal do painel de hierarquia nao configurado.", ok: false, panelId: panel.id };
  const channel = await guild.channels.fetch(panel.panelChannelId).catch(() => null);
  if (!channel || !("send" in channel) || !("messages" in channel)) {
    const error = "Canal do painel nao encontrado ou nao e um canal de texto.";
    await logPublishFailure(context, guild.id, panel, error);
    return { error, ok: false, panelId: panel.id };
  }
  const permissionReport = inspectPublishPermissions(guild, channel as PublishPermissionChannel, Boolean(panel.panelMessageId));
  await logPublishPermissionSnapshot(context, guild.id, panel, permissionReport);
  if (permissionReport.blockingMissing.length) {
    const error = `Permissoes ausentes no canal <#${channel.id}>: ${permissionReport.blockingMissing.join(", ")}. Permissoes reais: ${permissionReport.granted.join(", ") || "nenhuma"}.`;
    await logPublishFailure(context, guild.id, panel, error, permissionReport);
    return { error, ok: false, panelId: panel.id };
  }
  await logMissingHierarchyRoles(context, guild, panel);
  const visuals = await getPanelVisualSlots(context, guild.id, "fivem-hierarchy");
  const payload = createHierarchyPayload(guild, panel, cache, visuals[0] ?? null);
  if (panel.panelMessageId) {
    const message = await channel.messages.fetch(panel.panelMessageId).catch(async (error) => {
      await logPublishFailure(context, guild.id, panel, `Mensagem salva do painel nao foi encontrada para edicao: ${discordErrorMessage(error)}.`, permissionReport);
      return null;
    });
    if (!message) {
      return { error: "Mensagem salva do painel nao encontrada. O bot nao enviou outra mensagem para evitar duplicidade.", ok: false, panelId: panel.id };
    }

    const edited = await message.edit(payload).catch(async (error) => {
      await logPublishFailure(context, guild.id, panel, `Falha ao editar painel existente: ${discordErrorMessage(error)}. ${permissionHint(permissionReport)}`, permissionReport);
      return null;
    });
    if (!edited) {
      return { error: `Falha ao editar a mensagem salva do painel. ${permissionHint(permissionReport)}`, ok: false, panelId: panel.id };
    }

    void pruneDuplicateHierarchyPanelMessages(channel as DuplicateCleanupChannel, edited, panel);
    return { messageId: edited.id, ok: true, panelId: panel.id };
  }

  const message = await channel.send(payload).catch(async (error) => {
    await logPublishFailure(context, guild.id, panel, `Falha ao enviar painel inicial: ${discordErrorMessage(error)}. ${permissionHint(permissionReport)}`, permissionReport);
    return null;
  });
  if (message) {
    if (panel.panelMessageId !== message.id) {
      await context.api.updateFivemHierarchyPanelState({ guildId: guild.id, messageId: message.id, panelId: panel.id }).catch(() => null);
    }
    void pruneDuplicateHierarchyPanelMessages(channel as DuplicateCleanupChannel, message, panel);
    return { messageId: message.id, ok: true, panelId: panel.id };
  }
  return { error: `O Discord recusou o envio do painel no canal configurado. ${permissionHint(permissionReport)}`, ok: false, panelId: panel.id };
}

type DuplicateCleanupChannel = {
  messages: {
    fetch(input: { limit: number }): Promise<Map<string, Message>>;
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

async function getPanelVisualSlots(context: BotContext, guildId: string, basePanelId: string) {
  const panelIds = [basePanelId, `${basePanelId}-banner-2`, `${basePanelId}-banner-3`];
  const visuals = await Promise.all(panelIds.map((panelId) => context.api.getPanelVisualSettings(guildId, panelId).catch(() => null)));

  return visuals.flatMap((visual, index): PanelVisualConfig[] => {
    if (!visual?.imageEnabled) return [];
    if (index > 0 && visual.useGlobalDefault) return [];
    return [{ blocks: visual.blocks ?? [], imageEnabled: visual.imageEnabled, imagePosition: visual.imagePosition, imageUrl: visual.imageUrl }];
  });
}

function createHierarchyPayload(guild: Guild, panel: FivemHierarchyPanel, cache: HierarchyPanelCache, visual: PanelVisualConfig | null) {
  const fallbackVisual: PanelVisualConfig | null = panel.imageUrl ? { imageEnabled: true, imagePosition: panel.imagePosition === "bottom" ? "bottom" : panel.imagePosition, imageUrl: panel.imageUrl } : null;
  const singleVisual = sanitizeSingleHierarchyVisual(visual?.imageEnabled ? visual : fallbackVisual);
  return renderComponentsV2Panel({ accentColor: colorToInt(panel.color), actions: [], description: panel.description ?? "Hierarquia atualizada automaticamente pelos cargos do servidor.", fields: [renderHierarchyText(guild, panel, cache)], footer: panel.footerEnabled ? { text: panel.footerText ?? "OrviteK" } : { enabled: false }, image: singleVisual, moduleId: "fivem-hierarchy", title: panel.title });
}

function renderHierarchyText(guild: Guild, panel: FivemHierarchyPanel, cache: HierarchyPanelCache) {
  return orderedHierarchyEntries(panel)
    .map((item) => {
      const roleExists = Boolean(guild.roles.cache.get(item.roleId));
      const roleMembers = roleExists ? [...(cache.assignmentsByEntryId.get(item.cacheKey) ?? [])]
        .sort(compareHierarchyMembers)
        .map(formatHierarchyMemberLine)
        .slice(0, item.limit ?? 50) : [];
      return `${item.emoji ?? ""} **${item.name}**\n${roleMembers.length ? roleMembers.join("\n") : "*Nenhum membro encontrado.*"}`;
    })
    .join("\n\n")
    .slice(0, 3800) || "*Nenhuma hierarquia configurada.*";
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
    assignedEntryByUserId: new Map(),
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
  const previousEntryId = cache.assignedEntryByUserId.get(snapshot.userId) ?? null;
  const previousSnapshot = cache.membersByUserId.get(snapshot.userId) ?? null;
  const nextEntry = resolveHierarchyEntryForRoleIds(panel, snapshot.roleIds);

  if (!nextEntry) {
    return removeMemberFromPanelCache(cache, snapshot.userId);
  }

  if (previousEntryId && previousEntryId !== nextEntry.cacheKey) {
    removeMemberFromEntry(cache, previousEntryId, snapshot.userId);
  }

  const list = cache.assignmentsByEntryId.get(nextEntry.cacheKey) ?? [];
  const wasListed = list.some((member) => member.userId === snapshot.userId);
  cache.assignmentsByEntryId.set(nextEntry.cacheKey, [
    ...list.filter((member) => member.userId !== snapshot.userId),
    snapshot
  ]);
  cache.assignedEntryByUserId.set(snapshot.userId, nextEntry.cacheKey);
  cache.membersByUserId.set(snapshot.userId, snapshot);

  return previousEntryId !== nextEntry.cacheKey
    || !previousSnapshot
    || !wasListed
    || previousSnapshot.displayName !== snapshot.displayName
    || previousSnapshot.username !== snapshot.username;
}

function removeMemberFromPanelCache(cache: HierarchyPanelCache, userId: string) {
  let changed = false;

  for (const entryId of cache.assignmentsByEntryId.keys()) {
    changed = removeMemberFromEntry(cache, entryId, userId) || changed;
  }

  if (cache.assignedEntryByUserId.delete(userId)) changed = true;
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

function resolveHierarchyEntryForRoleIds(panel: FivemHierarchyPanel, roleIds: Iterable<string>): HierarchyRenderEntry | null {
  const roleSet = new Set(roleIds);
  return orderedHierarchyEntries(panel).find((entry) => roleSet.has(entry.roleId)) ?? null;
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
  const name = escapeDiscordMarkdown(member.displayName || member.username || member.userId);
  return `- ${name} - <@${member.userId}>`;
}

function escapeDiscordMarkdown(value: string) {
  return value.replace(/([\\`*_~|>])/g, "\\$1").replace(/@/g, "@\u200b");
}

async function pruneDuplicateHierarchyPanelMessages(channel: DuplicateCleanupChannel, currentMessage: Message, panel: FivemHierarchyPanel) {
  const botId = currentMessage.client.user?.id;
  if (!botId) return;
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return;

  const duplicateKeys = [panel.title, panel.description]
    .map((value) => normalizeDuplicateLookupText(value))
    .filter(Boolean);
  if (!duplicateKeys.length) return;

  for (const message of messages.values()) {
    if (message.id === currentMessage.id || message.author.id !== botId) continue;
    if (!messageLooksLikeHierarchyPanel(message, duplicateKeys)) continue;
    await message.delete().catch((error) => {
      console.warn(`[fivem-hierarchy] falha ao apagar painel duplicado ${message.id}: ${errorMessage(error)}`);
    });
  }
}

function messageLooksLikeHierarchyPanel(message: Message, duplicateKeys: string[]) {
  const text = normalizeDuplicateLookupText([
    message.content,
    ...message.embeds.flatMap((embed) => [embed.title, embed.description, embed.footer?.text]),
    JSON.stringify(message.components.map((component) => component.toJSON()))
  ].filter(Boolean).join("\n"));

  if (!text.includes("hierarquia")) return false;
  return duplicateKeys.some((key) => key && text.includes(key));
}

function normalizeDuplicateLookupText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function sanitizeSingleHierarchyVisual(visual: PanelVisualConfig | null): PanelVisualConfig | null {
  if (!visual?.imageEnabled || !visual.imageUrl) return null;
  return {
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

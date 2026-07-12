import { randomUUID } from "node:crypto";
import type { Collection, Db, Document, Filter } from "mongodb";
import { getMongoDb } from "../database/mongo";
import { dashboardLogRealtimeRoom, devBotRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";
import { createLog } from "./logService";

export type DatabaseMaintenanceModule =
  | "manual-registration"
  | "fivem-goals"
  | "fivem-orders"
  | "fivem-finance"
  | "fivem-fac"
  | "fivem-hierarchy"
  | "tickets"
  | "temporary-voice"
  | "mission-tools"
  | "socials"
  | "security"
  | "logs";

export type DatabaseMaintenanceLink = {
  channels: string[];
  collection: string;
  count: number;
  module: DatabaseMaintenanceModule;
  sample: Array<Record<string, unknown>>;
};

export type DatabaseMaintenanceDeleteResult = {
  botId: string | null;
  channelIds: string[];
  deletedTotal: number;
  errors: Array<{ collection: string; message: string; module: string }>;
  guildId: string;
  modules: Array<{ collection: string; deleted: number; module: string }>;
  userId: string;
};

type UserLinkDefinition = {
  channelFields?: string[];
  collection: string;
  module: DatabaseMaintenanceModule;
  userFields: string[];
};

type ResetDefinition = {
  collection: string;
  module: DatabaseMaintenanceModule;
};

const USER_LINK_DEFINITIONS: UserLinkDefinition[] = [
  { collection: "manual_registration_submissions", module: "manual-registration", userFields: ["userId", "discordId", "memberId"], channelFields: ["channelId"] },
  { collection: "manual_registration_logs", module: "manual-registration", userFields: ["targetUserId", "executorId", "userId"] },
  { collection: "fivem_goal_user_channels", module: "fivem-goals", userFields: ["userId", "discordId", "memberId"], channelFields: ["channelId"] },
  { collection: "fivem_goal_entries", module: "fivem-goals", userFields: ["userId", "discordId", "memberId"], channelFields: ["channelId"] },
  { collection: "fivem_goal_submissions", module: "fivem-goals", userFields: ["userId", "discordId", "memberId"] },
  { collection: "fivem_goal_logs", module: "fivem-goals", userFields: ["userId", "targetUserId"] },
  { collection: "fivem_orders", module: "fivem-orders", userFields: ["userId", "responsibleId", "sourceId", "discordId", "memberId"], channelFields: ["channelId", "tempChannelId"] },
  { collection: "fivem_order_families", module: "fivem-orders", userFields: ["responsibleId", "userId"] },
  { collection: "fivem_order_logs", module: "fivem-orders", userFields: ["actorId", "userId", "targetUserId"] },
  { collection: "fivem_finance_transactions", module: "fivem-finance", userFields: ["userId", "discordId", "memberId"], channelFields: ["tempChannelId", "channelId"] },
  { collection: "fivem_finance_logs", module: "fivem-finance", userFields: ["actorId", "userId", "targetUserId"] },
  { collection: "fivem_fac_absences", module: "fivem-fac", userFields: ["userId", "discordId", "memberId"] },
  { collection: "fivem_hierarchy_logs", module: "fivem-hierarchy", userFields: ["userId", "targetUserId"] },
  { collection: "Ticket", module: "tickets", userFields: ["openerId", "userId", "discordId", "memberId"], channelFields: ["channelId"] },
  { collection: "temporary_calls", module: "temporary-voice", userFields: ["ownerId", "userId", "memberId"], channelFields: ["channelId"] },
  { collection: "mission_tools_users", module: "mission-tools", userFields: ["userId", "discordId", "memberId"] },
  { collection: "mission_tools_tokens", module: "mission-tools", userFields: ["userId", "discordId", "memberId"] },
  { collection: "social_members", module: "socials", userFields: ["userId", "discordId", "memberId"] },
  { collection: "global_blacklist_entries", module: "security", userFields: ["userId", "discordId", "memberId"] },
  { collection: "global_blacklist_history", module: "security", userFields: ["userId", "targetUserId", "discordId", "memberId"] },
  { collection: "image_anti_spam_users", module: "security", userFields: ["userId", "discordId", "memberId"] },
  { collection: "image_anti_spam_incidents", module: "security", userFields: ["userId", "targetUserId", "discordId", "memberId"] },
  { collection: "safe_bot_warning_users", module: "security", userFields: ["userId", "discordId", "memberId"] },
  { collection: "safe_bot_warning_records", module: "security", userFields: ["userId", "targetUserId", "discordId", "memberId"] },
  { collection: "self_bot_protection_incidents", module: "security", userFields: ["userId", "targetUserId", "executorId", "discordId", "memberId"] },
  { collection: "self_bot_punishment_states", module: "security", userFields: ["userId", "discordId", "memberId"] },
  { collection: "self_bot_role_assignments", module: "security", userFields: ["userId", "discordId", "memberId"] },
  { collection: "LogEntry", module: "logs", userFields: ["userId"] }
];

const RESET_DEFINITIONS: ResetDefinition[] = [
  ...USER_LINK_DEFINITIONS.map(({ collection, module }) => ({ collection, module })),
  { collection: "manual_registration_settings", module: "manual-registration" },
  { collection: "fivem_goal_settings", module: "fivem-goals" },
  { collection: "fivem_goal_configs", module: "fivem-goals" },
  { collection: "fivem_order_settings", module: "fivem-orders" },
  { collection: "fivem_order_products", module: "fivem-orders" },
  { collection: "fivem_finance_settings", module: "fivem-finance" },
  { collection: "fivem_fac_settings", module: "fivem-fac" },
  { collection: "fivem_hierarchy_panels", module: "fivem-hierarchy" }
];

const MODULE_LABELS: Record<DatabaseMaintenanceModule, string> = {
  "manual-registration": "Cadastro principal / Pedido de Set",
  "fivem-goals": "Sistema de Metas / Canal de Meta",
  "fivem-orders": "Encomendas / Lavagem / Drogas / Munição / Armas / Famílias",
  "fivem-finance": "Sistema Financeiro",
  "fivem-fac": "Ausência / FAC",
  "fivem-hierarchy": "Hierarquia",
  tickets: "Tickets",
  "temporary-voice": "Canais temporários",
  "mission-tools": "Mission Tools",
  socials: "Redes sociais",
  security: "Segurança",
  logs: "Logs internos"
};

export function listMaintenanceModules() {
  return Object.entries(MODULE_LABELS).map(([id, label]) => ({ id, label }));
}

export async function searchMaintenanceUsers(input: {
  botId: string | null;
  guildId: string;
  query: string;
}) {
  const db = await getMongoDb();
  const query = input.query.trim();
  const exactSnowflake = /^\d{5,32}$/.test(query);
  const textRegex = query ? new RegExp(escapeRegExp(query), "i") : null;
  const scope = scopeQuery(input.guildId, input.botId);
  const candidates = new Map<string, { userId: string; username: string | null; sources: string[] }>();

  if (exactSnowflake) {
    candidates.set(query, { userId: query, username: null, sources: ["busca direta"] });
  }

  await collectCandidateUsers(db.collection("manual_registration_submissions"), {
    candidates,
    filter: {
      ...scope,
      ...(exactSnowflake
        ? { $or: [{ userId: query }, { discordId: query }, { memberId: query }] }
        : textRegex
          ? { username: textRegex }
          : {})
    },
    source: "Cadastro principal"
  });

  await collectCandidateUsers(db.collection("fivem_finance_transactions"), {
    candidates,
    filter: {
      ...scope,
      ...(exactSnowflake ? { userId: query } : textRegex ? { username: textRegex } : {})
    },
    source: "Financeiro"
  });

  await collectCandidateUsers(db.collection("User"), {
    candidates,
    filter: exactSnowflake
      ? { discordId: query }
      : textRegex
        ? { $or: [{ username: textRegex }, { globalName: textRegex }] }
        : {},
    source: "Usuários OAuth"
  });

  if (!query) {
    await collectCandidateUsers(db.collection("manual_registration_submissions"), {
      candidates,
      filter: scope,
      limit: 25,
      source: "Cadastro principal"
    });
  }

  return Array.from(candidates.values()).slice(0, 50);
}

export async function listUserLinks(input: {
  botId: string | null;
  guildId: string;
  userId: string;
}) {
  const db = await getMongoDb();
  const links: DatabaseMaintenanceLink[] = [];

  for (const definition of USER_LINK_DEFINITIONS) {
    const filter = userLinkFilter(input.guildId, input.botId, input.userId, definition);
    const collection = db.collection(definition.collection);
    const count = await collection.countDocuments(filter).catch(() => 0);
    if (!count) continue;

    const sample = await collection
      .find(filter, { projection: sampleProjection(definition) })
      .limit(5)
      .toArray()
      .catch(() => []);
    links.push({
      channels: extractChannelIds(sample, definition.channelFields ?? []),
      collection: definition.collection,
      count,
      module: definition.module,
      sample: sample.map(sanitizeSample)
    });
  }

  return {
    botId: input.botId,
    guildId: input.guildId,
    links,
    total: links.reduce((sum, item) => sum + item.count, 0),
    userId: input.userId
  };
}

export async function deleteUserLinks(input: {
  actorId?: string | null;
  actorName?: string | null;
  botId: string | null;
  guildId: string;
  reason: "dashboard_manual" | "guild_member_remove" | "registration_cleanup" | "test_reset" | "admin_command";
  userId: string;
}) {
  const db = await getMongoDb();
  const before = await listUserLinks(input);
  const channelIds = unique(before.links.flatMap((item) => item.channels));
  const result: DatabaseMaintenanceDeleteResult = {
    botId: input.botId,
    channelIds,
    deletedTotal: 0,
    errors: [],
    guildId: input.guildId,
    modules: [],
    userId: input.userId
  };

  for (const definition of USER_LINK_DEFINITIONS) {
    const filter = userLinkFilter(input.guildId, input.botId, input.userId, definition);
    try {
      const deleted = await db.collection(definition.collection).deleteMany(filter);
      if (deleted.deletedCount) {
        result.deletedTotal += deleted.deletedCount;
        result.modules.push({ collection: definition.collection, deleted: deleted.deletedCount, module: definition.module });
      }
    } catch (error) {
      result.errors.push({
        collection: definition.collection,
        message: error instanceof Error ? error.message : "Erro desconhecido",
        module: definition.module
      });
    }
  }

  await writeMaintenanceLog({
    actorId: input.actorId ?? null,
    actorName: input.actorName ?? null,
    botId: input.botId,
    guildId: input.guildId,
    message: input.reason === "guild_member_remove"
      ? `Usuário ${input.userId} saiu do servidor e teve vínculos removidos.`
      : `Vínculos do usuário ${input.userId} removidos pela manutenção.`,
    metadata: {
      channelIds,
      errors: result.errors,
      modules: result.modules,
      reason: input.reason,
      removed: result.deletedTotal,
      targetUserId: input.userId
    },
    targetUserId: input.userId,
    type: "database_maintenance.user_links_deleted"
  });

  emitMaintenanceUpdated(input.guildId, input.botId, {
    action: "user_links_deleted",
    channelIds,
    result
  });

  if (input.botId && channelIds.length) {
    emitRealtimeToRoom(devBotRealtimeRoom(input.botId), "database-maintenance:delete_channels", {
      botId: input.botId,
      channelIds,
      guildId: input.guildId,
      reason: input.reason,
      userId: input.userId
    });
  }

  return result;
}

export async function resetMaintenanceModule(input: {
  actorId: string | null;
  actorName?: string | null;
  botId: string | null;
  confirmation: string;
  guildId: string;
  module: DatabaseMaintenanceModule;
}) {
  if (input.confirmation !== "CONFIRMAR") {
    throw Object.assign(new Error("Digite CONFIRMAR para zerar este módulo."), { statusCode: 400 });
  }

  const db = await getMongoDb();
  const definitions = RESET_DEFINITIONS.filter((definition) => definition.module === input.module);
  const result = await deleteScopedCollections(db, definitions, input.guildId, input.botId);

  await writeMaintenanceLog({
    actorId: input.actorId,
    actorName: input.actorName ?? null,
    botId: input.botId,
    guildId: input.guildId,
    message: `Módulo ${MODULE_LABELS[input.module]} zerado.`,
    metadata: { module: input.module, result },
    targetUserId: null,
    type: "database_maintenance.module_reset"
  });
  emitMaintenanceUpdated(input.guildId, input.botId, { action: "module_reset", module: input.module, result });
  return result;
}

export async function resetMaintenanceServer(input: {
  actorId: string | null;
  actorName?: string | null;
  botId: string | null;
  confirmation: string;
  guildId: string;
}) {
  if (input.confirmation !== input.guildId) {
    throw Object.assign(new Error("Digite o ID do servidor para limpar todos os dados deste servidor."), { statusCode: 400 });
  }

  const db = await getMongoDb();
  const result = await deleteScopedCollections(db, RESET_DEFINITIONS, input.guildId, input.botId);

  await writeMaintenanceLog({
    actorId: input.actorId,
    actorName: input.actorName ?? null,
    botId: input.botId,
    guildId: input.guildId,
    message: "Todos os dados do servidor foram zerados para o escopo do bot selecionado.",
    metadata: { result },
    targetUserId: null,
    type: "database_maintenance.server_reset"
  });
  emitMaintenanceUpdated(input.guildId, input.botId, { action: "server_reset", result });
  return result;
}

export async function cleanupLegacyMaintenance(input: {
  actorId: string | null;
  actorName?: string | null;
  botId: string | null;
  existingChannelIds?: string[];
  guildId: string;
}) {
  const db = await getMongoDb();
  const scope = scopeQuery(input.guildId, input.botId);
  const existingChannels = new Set((input.existingChannelIds ?? []).filter(Boolean));
  const modules: Array<{ collection: string; deleted: number; module: string; reason: string }> = [];

  await deleteAndPush(db.collection("manual_registration_submissions"), {
    filter: {
      ...scope,
      $or: [
        { username: /teste|test|fake|apag(ar|ado)|delete/i },
        { "fields.value": /teste|test|fake|apag(ar|ado)|delete/i }
      ]
    },
    module: "manual-registration",
    modules,
    reason: "cadastros de teste"
  });

  await deleteAndPush(db.collection("fivem_orders"), {
    filter: {
      ...scope,
      $or: [
        { status: { $exists: false } },
        { status: null },
        { clientName: /teste|test|fake/i },
        { productId: { $in: [null, ""] } }
      ]
    },
    module: "fivem-orders",
    modules,
    reason: "encomendas antigas sem status ou de teste"
  });

  await deleteAndPush(db.collection("fivem_goal_entries"), {
    filter: {
      ...scope,
      $or: [{ userId: { $in: [null, ""] } }, { channelId: { $in: [null, ""] } }]
    },
    module: "fivem-goals",
    modules,
    reason: "metas sem usuário ou canal"
  });

  await deleteAndPush(db.collection("fivem_finance_transactions"), {
    filter: {
      ...scope,
      $or: [{ status: { $exists: false } }, { status: null }, { username: /teste|test|fake/i }]
    },
    module: "fivem-finance",
    modules,
    reason: "financeiro antigo sem status ou de teste"
  });

  if (input.existingChannelIds) {
    for (const definition of USER_LINK_DEFINITIONS.filter((item) => item.channelFields?.length)) {
      const channelOr = (definition.channelFields ?? []).map((field) => ({
        [field]: { $nin: [...existingChannels], $type: "string" }
      }));
      await deleteAndPush(db.collection(definition.collection), {
        filter: { ...scope, $or: channelOr },
        module: definition.module,
        modules,
        reason: "canal temporário inexistente"
      });
    }
  }

  modules.push(...await removeDuplicateManualRegistrations(db, input.guildId, input.botId));

  const deletedTotal = modules.reduce((sum, item) => sum + item.deleted, 0);
  await writeMaintenanceLog({
    actorId: input.actorId,
    actorName: input.actorName ?? null,
    botId: input.botId,
    guildId: input.guildId,
    message: "Limpeza do sistema antigo executada.",
    metadata: { deletedTotal, modules },
    targetUserId: null,
    type: "database_maintenance.legacy_cleanup"
  });
  emitMaintenanceUpdated(input.guildId, input.botId, { action: "legacy_cleanup", deletedTotal, modules });

  return { deletedTotal, modules };
}

async function collectCandidateUsers(
  collection: Collection,
  input: {
    candidates: Map<string, { userId: string; username: string | null; sources: string[] }>;
    filter: Filter<Document>;
    limit?: number;
    source: string;
  }
) {
  const rows = await collection
    .find(input.filter, { projection: { discordId: 1, globalName: 1, userId: 1, username: 1 } })
    .sort({ createdAt: -1 })
    .limit(input.limit ?? 50)
    .toArray()
    .catch(() => []);

  for (const row of rows) {
    const userId = readString(row.userId) ?? readString(row.discordId);
    if (!userId) continue;
    const current = input.candidates.get(userId);
    const username = readString(row.username) ?? readString(row.globalName) ?? current?.username ?? null;
    input.candidates.set(userId, {
      userId,
      username,
      sources: unique([...(current?.sources ?? []), input.source])
    });
  }
}

async function deleteScopedCollections(db: Db, definitions: ResetDefinition[], guildId: string, botId: string | null) {
  const modules: Array<{ collection: string; deleted: number; module: string }> = [];
  const errors: Array<{ collection: string; message: string; module: string }> = [];

  for (const definition of definitions) {
    try {
      const deleted = await db.collection(definition.collection).deleteMany(scopeQuery(guildId, botId));
      if (deleted.deletedCount) modules.push({ collection: definition.collection, deleted: deleted.deletedCount, module: definition.module });
    } catch (error) {
      errors.push({ collection: definition.collection, message: error instanceof Error ? error.message : "Erro desconhecido", module: definition.module });
    }
  }

  return { deletedTotal: modules.reduce((sum, item) => sum + item.deleted, 0), errors, modules };
}

async function deleteAndPush(collection: Collection, input: {
  filter: Filter<Document>;
  module: string;
  modules: Array<{ collection: string; deleted: number; module: string; reason: string }>;
  reason: string;
}) {
  const deleted = await collection.deleteMany(input.filter).catch(() => ({ deletedCount: 0 }));
  if (deleted.deletedCount) {
    input.modules.push({ collection: collection.collectionName, deleted: deleted.deletedCount, module: input.module, reason: input.reason });
  }
}

async function removeDuplicateManualRegistrations(db: Db, guildId: string, botId: string | null) {
  const collection = db.collection<Document>("manual_registration_submissions");
  const rows = await collection
    .find(scopeQuery(guildId, botId), { projection: { _id: 1, createdAt: 1, status: 1, userId: 1 } })
    .sort({ createdAt: -1 })
    .toArray()
    .catch(() => []);
  const seen = new Set<string>();
  const duplicateIds: string[] = [];

  for (const row of rows) {
    const userId = readString(row.userId);
    if (!userId) continue;
    if (seen.has(userId)) duplicateIds.push(String(row._id));
    seen.add(userId);
  }

  if (!duplicateIds.length) return [];
  const duplicateFilter = { _id: { $in: duplicateIds } } as unknown as Filter<Document>;
  const deleted = await collection.deleteMany(duplicateFilter);
  return deleted.deletedCount
    ? [{ collection: "manual_registration_submissions", deleted: deleted.deletedCount, module: "manual-registration", reason: "vínculos duplicados" }]
    : [];
}

function userLinkFilter(guildId: string, botId: string | null, userId: string, definition: UserLinkDefinition): Filter<Document> {
  const base = scopeQuery(guildId, botId);
  const userOr = definition.userFields.map((field) => ({ [field]: userId }));

  if (definition.collection === "manual_registration_logs" || definition.collection === "LogEntry") {
    return {
      $and: [
        base,
        { $or: userOr },
        {
          $or: [
            { type: /test|teste|temp|cleanup|maintenance/i },
            { action: /test|teste|temp|cleanup|maintenance/i },
            { "metadata.temporary": true },
            { "metadata.test": true },
            { "data.temporary": true },
            { "data.test": true }
          ]
        }
      ]
    };
  }

  return {
    ...base,
    $or: userOr
  };
}

function scopeQuery(guildId: string, botId: string | null): Filter<Document> {
  return botId
    ? { botId, guildId }
    : { guildId, $and: [{ $or: [{ botId: null }, { botId: { $exists: false } }] }] };
}

function sampleProjection(definition: UserLinkDefinition) {
  return Object.fromEntries([
    ["_id", 1],
    ["createdAt", 1],
    ["updatedAt", 1],
    ["status", 1],
    ["username", 1],
    ...definition.userFields.map((field) => [field, 1]),
    ...(definition.channelFields ?? []).map((field) => [field, 1])
  ]);
}

function sanitizeSample(row: Document) {
  const sample: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) sample[key] = value.toISOString();
    else if (["_id", "userId", "discordId", "memberId", "username", "status", "channelId", "tempChannelId", "ownerId", "openerId", "createdAt", "updatedAt"].includes(key)) sample[key] = value;
  }
  return sample;
}

function extractChannelIds(rows: Document[], fields: string[]) {
  return unique(rows.flatMap((row) => fields.map((field) => readString(row[field])).filter((value): value is string => Boolean(value))));
}

async function writeMaintenanceLog(input: {
  actorId: string | null;
  actorName?: string | null;
  botId: string | null;
  guildId: string;
  message: string;
  metadata: Record<string, unknown>;
  targetUserId: string | null;
  type: string;
}) {
  if (!input.botId) {
    return;
  }

  await createLog({
    botId: input.botId,
    guildId: input.guildId,
    message: input.message,
    metadata: {
      auditId: randomUUID(),
      actorId: input.actorId,
      actorName: input.actorName ?? null,
      targetUserId: input.targetUserId,
      ...input.metadata
    },
    type: input.type,
    userId: input.actorId ?? input.targetUserId ?? null
  });
}

function emitMaintenanceUpdated(guildId: string, botId: string | null, payload: Record<string, unknown>) {
  if (!botId) return;
  emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, botId), "database-maintenance:updated", { botId, guildId, ...payload });
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function unique<T>(values: T[]) {
  return [...new Set(values.filter(Boolean))];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

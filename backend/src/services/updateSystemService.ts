import axios from "axios";
import { randomUUID } from "node:crypto";
import type { Filter } from "mongodb";
import { getMongoDb } from "../database/mongo";
import { env } from "../config/env";
import { getDevBotToken } from "./devBotService";
import { isGuildTextChannel } from "./discordOptionsService";
import { createLog } from "./logService";

const DISCORD_API = "https://discord.com/api/v10";
export const UPDATES_MODULE_ID = "updates";
const DEFAULT_CHANNEL_ID = "1529352273958801499";

export type UpdateStatus = "DRAFT" | "SCHEDULED" | "PUBLISHED" | "CANCELLED" | "ERROR";
export type UpdatePublishMode = "single" | "per_category";

export type UpdateCategory = {
  id: string;
  botId: string;
  guildId: string;
  name: string;
  slug: string;
  emoji: string;
  color: string;
  keywords: string[];
  channelId: string | null;
  enabled: boolean;
  autoClassificationEnabled: boolean;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
};

export type UpdateRule = {
  id: string;
  botId: string;
  guildId: string;
  categoryId: string;
  terms: string[];
  priority: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type SystemUpdate = {
  id: string;
  botId: string;
  guildId: string;
  title: string;
  version: string | null;
  date: string;
  description: string;
  changes: UpdateChange[];
  bannerUrl: string | null;
  autoClassify: boolean;
  detectedCategories: ClassificationResult[];
  finalCategoryIds: string[];
  confidence: number;
  status: UpdateStatus;
  authorId: string | null;
  sourceModule: string | null;
  sourceEvent: string | null;
  scheduledFor: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  errorReason: string | null;
};

export type UpdateChange = {
  id: string;
  text: string;
  type?: "added" | "fixed" | "improved" | "removed" | "security" | "performance" | "interface" | "config" | "other";
  categoryId?: string | null;
};

export type UpdateSettings = {
  id: string;
  botId: string;
  guildId: string;
  mode: UpdatePublishMode;
  singleChannelId: string | null;
  lowConfidenceThreshold: number;
  requireConfirmationBelowThreshold: boolean;
  autoPublishInternalEvents: boolean;
  updatedAt: Date;
  updatedBy: string | null;
};

export type UpdatePublication = {
  id: string;
  botId: string;
  guildId: string;
  updateId: string;
  categoryId: string | null;
  channelId: string;
  messageId: string | null;
  status: "published" | "failed";
  errorReason: string | null;
  content: string;
  publishedAt: Date;
};

export type ClassificationResult = {
  categoryId: string;
  categoryName: string;
  confidence: number;
  matchedTerms: string[];
};

export type UpdateDashboard = {
  categories: UpdateCategoryDto[];
  updates: SystemUpdateDto[];
  rules: UpdateRuleDto[];
  settings: UpdateSettingsDto;
  stats: {
    total: number;
    novidades: number;
    correcoes: number;
    melhorias: number;
    published: number;
    scheduled: number;
  };
};

export type UpdatePreview = {
  categoryResults: ClassificationResult[];
  confidence: number;
  lowConfidence: boolean;
  messages: Array<{ categoryId: string | null; categoryName: string; channelId: string | null; content: string; error: string | null }>;
};

export type UpdateCategoryDto = Omit<UpdateCategory, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };
export type UpdateRuleDto = Omit<UpdateRule, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };
export type UpdateSettingsDto = Omit<UpdateSettings, "updatedAt"> & { updatedAt: string };
export type SystemUpdateDto = Omit<SystemUpdate, "createdAt" | "updatedAt" | "publishedAt" | "scheduledFor"> & {
  createdAt: string;
  publishedAt: string | null;
  scheduledFor: string | null;
  updatedAt: string;
};

type CreateUpdateInput = {
  autoClassify?: boolean;
  bannerUrl?: string | null;
  changes?: Array<Partial<UpdateChange> | string>;
  date?: string | null;
  description?: string | null;
  finalCategoryIds?: string[];
  publishNow?: boolean;
  scheduledFor?: string | null;
  sourceEvent?: string | null;
  sourceModule?: string | null;
  status?: UpdateStatus;
  title: string;
  version?: string | null;
};

const defaultCategories = [
  { name: "Novidades", slug: "novidades", emoji: "🆕", color: "#22c55e", priority: 100, keywords: ["adicionado", "adicionada", "adicionamos", "novo", "nova", "criado", "criada", "implementado", "implementada", "lançado", "lancado"] },
  { name: "Correções", slug: "correcoes", emoji: "🛠️", color: "#f59e0b", priority: 90, keywords: ["corrigido", "corrigida", "resolvido", "resolvida", "bug", "problema", "erro", "falha"] },
  { name: "Melhorias", slug: "melhorias", emoji: "⚡", color: "#38bdf8", priority: 80, keywords: ["melhorado", "melhorada", "otimizado", "otimizada", "atualizado", "atualizada", "refatorado", "refatorada"] },
  { name: "Segurança", slug: "seguranca", emoji: "🛡️", color: "#ef4444", priority: 70, keywords: ["proteção", "protecao", "segurança", "seguranca", "anti", "vulnerabilidade", "permissão", "permissao"] },
  { name: "Performance", slug: "performance", emoji: "🚀", color: "#a3e635", priority: 60, keywords: ["performance", "desempenho", "fps", "velocidade", "cache", "latência", "latencia"] },
  { name: "Interface", slug: "interface", emoji: "🎨", color: "#e879f9", priority: 50, keywords: ["ui", "design", "layout", "visual", "painel", "botão", "botao", "interface"] },
  { name: "Configurações", slug: "configuracoes", emoji: "⚙️", color: "#94a3b8", priority: 40, keywords: ["configuração", "configuracao", "configurações", "configuracoes", "ajuste", "opção", "opcao"] }
] as const;

export async function getUpdatesDashboard(botId: string, guildId: string): Promise<UpdateDashboard> {
  await ensureUpdateIndexes();
  await ensureDefaultUpdateData(botId, guildId);
  const db = await getMongoDb();
  const [settings, categories, rules, updates] = await Promise.all([
    getUpdateSettings(botId, guildId),
    db.collection<UpdateCategory>("update_categories").find({ botId, guildId }).sort({ priority: -1, name: 1 }).toArray(),
    db.collection<UpdateRule>("update_rules").find({ botId, guildId }).sort({ priority: -1, createdAt: -1 }).toArray(),
    db.collection<SystemUpdate>("updates").find({ botId, guildId }).sort({ createdAt: -1 }).limit(120).toArray()
  ]);
  return {
    categories: categories.map(categoryDto),
    rules: rules.map(ruleDto),
    settings: settingsDto(settings),
    stats: buildStats(updates, categories),
    updates: updates.map(updateDto)
  };
}

export async function saveUpdateSettings(botId: string, guildId: string, input: Partial<UpdateSettings>, actorId: string | null) {
  await ensureUpdateIndexes();
  const db = await getMongoDb();
  const current = await getUpdateSettings(botId, guildId);
  const next: UpdateSettings = {
    ...current,
    autoPublishInternalEvents: typeof input.autoPublishInternalEvents === "boolean" ? input.autoPublishInternalEvents : current.autoPublishInternalEvents,
    lowConfidenceThreshold: clampNumber(input.lowConfidenceThreshold, 1, 100, current.lowConfidenceThreshold),
    mode: input.mode === "per_category" ? "per_category" : input.mode === "single" ? "single" : current.mode,
    requireConfirmationBelowThreshold: typeof input.requireConfirmationBelowThreshold === "boolean" ? input.requireConfirmationBelowThreshold : current.requireConfirmationBelowThreshold,
    singleChannelId: normalizeSnowflake(input.singleChannelId) ?? current.singleChannelId,
    updatedAt: new Date(),
    updatedBy: actorId
  };
  await db.collection<UpdateSettings>("update_channels").updateOne({ botId, guildId }, { $set: next }, { upsert: true });
  return settingsDto(next);
}

export async function saveUpdateCategory(botId: string, guildId: string, input: Partial<UpdateCategory>, actorId: string | null) {
  void actorId;
  await ensureUpdateIndexes();
  const db = await getMongoDb();
  const now = new Date();
  const id = typeof input.id === "string" && input.id.trim() ? input.id.trim() : randomUUID();
  const name = cleanText(input.name, 80) || "Categoria";
  const category: UpdateCategory = {
    id,
    botId,
    guildId,
    name,
    slug: slug(input.slug || name),
    emoji: cleanText(input.emoji, 24) || "📢",
    color: /^#[0-9a-f]{6}$/i.test(input.color || "") ? input.color! : "#38bdf8",
    keywords: normalizeStringArray(input.keywords, 40, 40),
    channelId: normalizeSnowflake(input.channelId),
    enabled: input.enabled !== false,
    autoClassificationEnabled: input.autoClassificationEnabled !== false,
    priority: clampNumber(input.priority, 0, 1000, 50),
    createdAt: now,
    updatedAt: now
  };
  const { createdAt: _createdAt, ...categorySet } = category;
  await db.collection<UpdateCategory>("update_categories").updateOne(
    { botId, guildId, id },
    { $set: categorySet, $setOnInsert: { createdAt: now } },
    { upsert: true }
  );
  return categoryDto((await db.collection<UpdateCategory>("update_categories").findOne({ botId, guildId, id })) ?? category);
}

export async function deleteUpdateCategory(botId: string, guildId: string, categoryId: string) {
  await ensureUpdateIndexes();
  const db = await getMongoDb();
  const category = await db.collection<UpdateCategory>("update_categories").findOne({ botId, guildId, id: categoryId });
  if (!category) return null;
  await db.collection<UpdateCategory>("update_categories").deleteOne({ botId, guildId, id: categoryId });
  await db.collection<UpdateRule>("update_rules").deleteMany({ botId, guildId, categoryId });
  return categoryDto(category);
}

export async function saveUpdateRule(botId: string, guildId: string, input: Partial<UpdateRule>) {
  await ensureUpdateIndexes();
  const db = await getMongoDb();
  const now = new Date();
  const id = typeof input.id === "string" && input.id.trim() ? input.id.trim() : randomUUID();
  const rule: UpdateRule = {
    id,
    botId,
    guildId,
    categoryId: cleanText(input.categoryId, 120),
    terms: normalizeStringArray(input.terms, 40, 80),
    priority: clampNumber(input.priority, 0, 1000, 50),
    enabled: input.enabled !== false,
    createdAt: now,
    updatedAt: now
  };
  const { createdAt: _createdAt, ...ruleSet } = rule;
  await db.collection<UpdateRule>("update_rules").updateOne(
    { botId, guildId, id },
    { $set: ruleSet, $setOnInsert: { createdAt: now } },
    { upsert: true }
  );
  return ruleDto((await db.collection<UpdateRule>("update_rules").findOne({ botId, guildId, id })) ?? rule);
}

export async function deleteUpdateRule(botId: string, guildId: string, ruleId: string) {
  await ensureUpdateIndexes();
  const db = await getMongoDb();
  const rule = await db.collection<UpdateRule>("update_rules").findOne({ botId, guildId, id: ruleId });
  if (!rule) return null;
  await db.collection<UpdateRule>("update_rules").deleteOne({ botId, guildId, id: ruleId });
  return ruleDto(rule);
}

export async function previewSystemUpdate(botId: string, guildId: string, input: CreateUpdateInput): Promise<UpdatePreview> {
  await ensureDefaultUpdateData(botId, guildId);
  const [settings, categories, rules] = await getClassificationData(botId, guildId);
  const changes = normalizeChanges(input.changes);
  const categoryResults = input.autoClassify === false && input.finalCategoryIds?.length
    ? manualResults(input.finalCategoryIds, categories)
    : classifyUpdateContent({ title: input.title, description: input.description ?? "", changes }, categories, rules);
  const finalIds = input.finalCategoryIds?.length ? input.finalCategoryIds : categoryResults.map((item) => item.categoryId);
  const confidence = categoryResults.length ? Math.max(...categoryResults.map((item) => item.confidence)) : 0;
  const messages = buildPublicationMessages({
    bannerUrl: input.bannerUrl ?? null,
    categories,
    changes,
    date: input.date ?? new Date().toISOString(),
    description: input.description ?? "",
    finalCategoryIds: finalIds,
    settings,
    title: input.title,
    version: input.version ?? null
  });
  return {
    categoryResults,
    confidence,
    lowConfidence: confidence < settings.lowConfidenceThreshold,
    messages
  };
}

export async function createSystemUpdate(botId: string, guildId: string, input: CreateUpdateInput, actorId: string | null) {
  await ensureUpdateIndexes();
  await ensureDefaultUpdateData(botId, guildId);
  const db = await getMongoDb();
  const [settings, categories, rules] = await getClassificationData(botId, guildId);
  const now = new Date();
  const changes = normalizeChanges(input.changes);
  const detectedCategories = input.autoClassify === false && input.finalCategoryIds?.length
    ? manualResults(input.finalCategoryIds, categories)
    : classifyUpdateContent({ title: input.title, description: input.description ?? "", changes }, categories, rules);
  const finalCategoryIds = (input.finalCategoryIds?.length ? input.finalCategoryIds : detectedCategories.map((item) => item.categoryId))
    .filter((id, index, all) => categories.some((category) => category.id === id) && all.indexOf(id) === index);
  const confidence = detectedCategories.length ? Math.max(...detectedCategories.map((item) => item.confidence)) : 0;
  const scheduledFor = parseDate(input.scheduledFor);
  const publishNow = input.publishNow === true;
  const update: SystemUpdate = {
    id: randomUUID(),
    botId,
    guildId,
    title: cleanText(input.title, 180),
    version: cleanText(input.version, 48) || null,
    date: cleanText(input.date, 48) || now.toISOString(),
    description: cleanText(input.description, 1800),
    changes,
    bannerUrl: normalizeUrl(input.bannerUrl),
    autoClassify: input.autoClassify !== false,
    detectedCategories,
    finalCategoryIds,
    confidence,
    status: scheduledFor ? "SCHEDULED" : input.status ?? "DRAFT",
    authorId: actorId,
    sourceEvent: cleanText(input.sourceEvent, 80) || null,
    sourceModule: cleanText(input.sourceModule, 80) || null,
    scheduledFor,
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
    errorReason: null
  };

  if (!update.title) throw Object.assign(new Error("Título da atualização é obrigatório."), { statusCode: 400 });
  if (!update.description && update.changes.length === 0) throw Object.assign(new Error("Informe uma descrição ou lista de alterações."), { statusCode: 400 });
  if (settings.requireConfirmationBelowThreshold && update.confidence < settings.lowConfidenceThreshold && publishNow) {
    throw Object.assign(new Error("Classificação com baixa confiança. Confirme manualmente antes de publicar."), { statusCode: 409 });
  }

  await db.collection<SystemUpdate>("updates").insertOne(update);
  if (scheduledFor) await db.collection<Record<string, unknown>>("update_schedules").insertOne({ id: randomUUID(), botId, guildId, updateId: update.id, status: "pending", scheduledFor, createdAt: now });

  if (publishNow) {
    return publishSystemUpdate(botId, guildId, update.id, actorId);
  }

  return updateDto(update);
}

export async function publishSystemUpdate(botId: string, guildId: string, updateId: string, actorId: string | null) {
  await ensureUpdateIndexes();
  const db = await getMongoDb();
  const update = await db.collection<SystemUpdate>("updates").findOne({ botId, guildId, id: updateId });
  if (!update) throw Object.assign(new Error("Atualização não encontrada."), { statusCode: 404 });
  if (update.status === "CANCELLED") throw Object.assign(new Error("Atualização cancelada não pode ser publicada."), { statusCode: 400 });

  const [settings, categories] = await Promise.all([
    getUpdateSettings(botId, guildId),
    db.collection<UpdateCategory>("update_categories").find({ botId, guildId, enabled: true }).sort({ priority: -1 }).toArray()
  ]);
  const messages = buildPublicationMessages({ ...update, categories, settings });
  const invalid = messages.find((message) => message.error);
  if (invalid) {
    await markUpdateError(botId, guildId, updateId, invalid.error!);
    throw Object.assign(new Error(invalid.error!), { statusCode: 400 });
  }

  const token = await getDevBotToken(botId) || env.DISCORD_BOT_TOKEN || null;
  if (!token) throw Object.assign(new Error("Token do bot não configurado para publicar atualização."), { statusCode: 400 });

  const publications: UpdatePublication[] = [];
  for (const message of messages) {
    if (!message.channelId || !(await isGuildTextChannel(guildId, message.channelId, token))) {
      const reason = "Canal não configurado para esta categoria.";
      await markUpdateError(botId, guildId, updateId, reason);
      throw Object.assign(new Error(reason), { statusCode: 400 });
    }
    const sent = await sendDiscordMessage(message.channelId, message.content, update.bannerUrl, token);
    const publication: UpdatePublication = {
      id: randomUUID(),
      botId,
      guildId,
      updateId,
      categoryId: message.categoryId,
      channelId: message.channelId,
      messageId: sent.id,
      status: "published",
      errorReason: null,
      content: message.content,
      publishedAt: new Date()
    };
    publications.push(publication);
    await db.collection<UpdatePublication>("update_publications").insertOne(publication);
  }

  const publishedAt = new Date();
  await db.collection<SystemUpdate>("updates").updateOne(
    { botId, guildId, id: updateId },
    { $set: { status: "PUBLISHED", publishedAt, updatedAt: publishedAt, errorReason: null } }
  );
  await db.collection<Record<string, unknown>>("update_schedules").updateMany({ botId, guildId, updateId }, { $set: { status: "completed", processedAt: publishedAt } });
  await createLog({ botId, guildId, userId: actorId, module: UPDATES_MODULE_ID, type: "updates.published", message: `Atualização publicada: ${update.title}.`, metadata: { updateId, publications } }).catch(() => null);

  return updateDto((await db.collection<SystemUpdate>("updates").findOne({ botId, guildId, id: updateId }))!);
}

export async function processDueSystemUpdates() {
  await ensureUpdateIndexes();
  const db = await getMongoDb();
  const due = await db.collection<SystemUpdate>("updates")
    .find({ status: "SCHEDULED", scheduledFor: { $lte: new Date() } } as Filter<SystemUpdate>)
    .sort({ scheduledFor: 1 })
    .limit(20)
    .toArray();

  for (const update of due) {
    try {
      await publishSystemUpdate(update.botId, update.guildId, update.id, update.authorId);
    } catch (error) {
      await markUpdateError(update.botId, update.guildId, update.id, error instanceof Error ? error.message : "Falha ao publicar atualização agendada.");
    }
  }
}

export function classifyUpdateContent(
  input: { changes: UpdateChange[]; description: string; title: string },
  categories: Array<Pick<UpdateCategory, "id" | "name" | "keywords" | "priority" | "enabled" | "autoClassificationEnabled">>,
  rules: Array<Pick<UpdateRule, "categoryId" | "terms" | "priority" | "enabled">> = []
): ClassificationResult[] {
  const text = normalizeSearchText([input.title, input.description, ...input.changes.map((change) => change.text)].join(" "));
  const scores = new Map<string, { score: number; terms: Set<string> }>();

  for (const rule of rules.filter((item) => item.enabled)) {
    const matched = rule.terms.filter((term) => term && text.includes(normalizeSearchText(term)));
    if (!matched.length) continue;
    const current = scores.get(rule.categoryId) ?? { score: 0, terms: new Set<string>() };
    current.score += matched.length * 8 + rule.priority / 20;
    matched.forEach((term) => current.terms.add(term));
    scores.set(rule.categoryId, current);
  }

  for (const category of categories.filter((item) => item.enabled && item.autoClassificationEnabled)) {
    const matched = category.keywords.filter((term) => term && text.includes(normalizeSearchText(term)));
    if (!matched.length) continue;
    const current = scores.get(category.id) ?? { score: 0, terms: new Set<string>() };
    current.score += matched.length * 5 + category.priority / 50;
    matched.forEach((term) => current.terms.add(term));
    scores.set(category.id, current);
  }

  const maxScore = Math.max(1, ...[...scores.values()].map((item) => item.score));
  return [...scores.entries()]
    .map(([categoryId, score]) => {
      const category = categories.find((item) => item.id === categoryId);
      return category ? {
        categoryId,
        categoryName: category.name,
        confidence: Math.max(35, Math.min(99, Math.round((score.score / maxScore) * 92))),
        matchedTerms: [...score.terms].slice(0, 12)
      } : null;
    })
    .filter((item): item is ClassificationResult => Boolean(item))
    .sort((left, right) => right.confidence - left.confidence);
}

async function getClassificationData(botId: string, guildId: string) {
  const db = await getMongoDb();
  const [settings, categories, rules] = await Promise.all([
    getUpdateSettings(botId, guildId),
    db.collection<UpdateCategory>("update_categories").find({ botId, guildId, enabled: true }).sort({ priority: -1 }).toArray(),
    db.collection<UpdateRule>("update_rules").find({ botId, guildId, enabled: true }).sort({ priority: -1 }).toArray()
  ]);
  return [settings, categories, rules] as const;
}

async function getUpdateSettings(botId: string, guildId: string): Promise<UpdateSettings> {
  await ensureUpdateIndexes();
  const db = await getMongoDb();
  const existing = await db.collection<UpdateSettings>("update_channels").findOne({ botId, guildId });
  if (existing) return existing;
  const settings: UpdateSettings = {
    id: `${botId}:${guildId}`,
    botId,
    guildId,
    mode: "single",
    singleChannelId: DEFAULT_CHANNEL_ID,
    lowConfidenceThreshold: 65,
    requireConfirmationBelowThreshold: true,
    autoPublishInternalEvents: true,
    updatedAt: new Date(),
    updatedBy: null
  };
  await db.collection<UpdateSettings>("update_channels").insertOne(settings);
  return settings;
}

async function ensureDefaultUpdateData(botId: string, guildId: string) {
  await ensureUpdateIndexes();
  const db = await getMongoDb();
  const count = await db.collection<UpdateCategory>("update_categories").countDocuments({ botId, guildId });
  if (count > 0) return;
  const now = new Date();
  await db.collection<UpdateCategory>("update_categories").insertMany(defaultCategories.map((category) => ({
    ...category,
    id: randomUUID(),
    botId,
    guildId,
    keywords: [...category.keywords],
    channelId: DEFAULT_CHANNEL_ID,
    enabled: true,
    autoClassificationEnabled: true,
    createdAt: now,
    updatedAt: now
  })));
  await getUpdateSettings(botId, guildId);
}

let indexesReady: Promise<void> | null = null;
function ensureUpdateIndexes() {
  indexesReady ??= getMongoDb().then(async (db) => {
    await Promise.all([
      db.collection("updates").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
      db.collection("updates").createIndex({ status: 1, scheduledFor: 1 }),
      db.collection("update_categories").createIndex({ botId: 1, guildId: 1, slug: 1 }, { unique: true }),
      db.collection("update_rules").createIndex({ botId: 1, guildId: 1, priority: -1 }),
      db.collection("update_channels").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
      db.collection("update_publications").createIndex({ botId: 1, guildId: 1, updateId: 1 }),
      db.collection("update_schedules").createIndex({ status: 1, scheduledFor: 1 })
    ]);
  });
  return indexesReady;
}

function buildPublicationMessages(input: {
  bannerUrl: string | null;
  categories: UpdateCategory[];
  changes: UpdateChange[];
  date: string;
  description: string;
  finalCategoryIds: string[];
  settings: UpdateSettings;
  title: string;
  version: string | null;
}) {
  const date = formatUpdateDate(input.date);
  const categories = input.categories.filter((category) => input.finalCategoryIds.includes(category.id));
  const sections = categories.map((category) => ({
    category,
    lines: input.changes
      .filter((change) => !change.categoryId || change.categoryId === category.id || input.finalCategoryIds.length === 1)
      .map((change) => change.text)
  })).filter((section) => section.lines.length || input.description);

  if (input.settings.mode === "single") {
    return [{
      categoryId: null,
      categoryName: "Atualizações",
      channelId: input.settings.singleChannelId,
      content: formatUpdateMessage(input.title, input.version, date, input.description, sections),
      error: input.settings.singleChannelId ? null : "Canal não configurado para esta categoria."
    }];
  }

  return sections.map((section) => ({
    categoryId: section.category.id,
    categoryName: section.category.name,
    channelId: section.category.channelId,
    content: formatUpdateMessage(input.title, input.version, date, input.description, [section]),
    error: section.category.channelId ? null : "Canal não configurado para esta categoria."
  }));
}

function formatUpdateMessage(title: string, version: string | null, date: string, description: string, sections: Array<{ category: UpdateCategory; lines: string[] }>) {
  const body = [
    `# ATUALIZAÇÃO - [${date}]`,
    version ? `**Versão:** ${version}` : null,
    `**${title}**`,
    description ? `\n${description}` : null,
    "",
    ...sections.flatMap((section) => [
      `${section.category.emoji} **${section.category.name}:**`,
      "",
      ...(section.lines.length ? section.lines.map((line) => `+ ${line}`) : ["+ Atualização registrada."]),
      ""
    ])
  ].filter((line): line is string => line !== null);
  return body.join("\n").slice(0, 1900);
}

async function sendDiscordMessage(channelId: string, content: string, bannerUrl: string | null, token: string) {
  const payload = {
    allowed_mentions: { parse: [] },
    content,
    embeds: bannerUrl ? [{ image: { url: bannerUrl } }] : []
  };
  const { data } = await axios.post<{ id: string }>(`${DISCORD_API}/channels/${channelId}/messages`, payload, {
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    timeout: 12_000
  });
  return data;
}

async function markUpdateError(botId: string, guildId: string, updateId: string, reason: string) {
  const db = await getMongoDb();
  await db.collection<SystemUpdate>("updates").updateOne({ botId, guildId, id: updateId }, { $set: { status: "ERROR", errorReason: reason, updatedAt: new Date() } });
}

function manualResults(ids: string[], categories: UpdateCategory[]): ClassificationResult[] {
  return ids.map((id) => categories.find((category) => category.id === id)).filter((item): item is UpdateCategory => Boolean(item)).map((category) => ({
    categoryId: category.id,
    categoryName: category.name,
    confidence: 100,
    matchedTerms: ["manual"]
  }));
}

function normalizeChanges(value: CreateUpdateInput["changes"]): UpdateChange[] {
  const source = Array.isArray(value) ? value : [];
  return source.map((item) => {
    const record = typeof item === "string" ? { text: item } : item;
    return {
      id: cleanText(record.id, 80) || randomUUID(),
      text: cleanText(record.text, 220),
      type: record.type ?? "other",
      categoryId: cleanText(record.categoryId, 120) || null
    };
  }).filter((item) => item.text).slice(0, 60);
}

function categoryDto(category: UpdateCategory): UpdateCategoryDto {
  return { ...category, createdAt: category.createdAt.toISOString(), updatedAt: category.updatedAt.toISOString() };
}

function ruleDto(rule: UpdateRule): UpdateRuleDto {
  return { ...rule, createdAt: rule.createdAt.toISOString(), updatedAt: rule.updatedAt.toISOString() };
}

function settingsDto(settings: UpdateSettings): UpdateSettingsDto {
  return { ...settings, updatedAt: settings.updatedAt.toISOString() };
}

function updateDto(update: SystemUpdate): SystemUpdateDto {
  return {
    ...update,
    createdAt: update.createdAt.toISOString(),
    publishedAt: update.publishedAt?.toISOString() ?? null,
    scheduledFor: update.scheduledFor?.toISOString() ?? null,
    updatedAt: update.updatedAt.toISOString()
  };
}

function buildStats(updates: SystemUpdate[], categories: UpdateCategory[]) {
  const bySlug = (slugValue: string) => {
    const category = categories.find((item) => item.slug === slugValue);
    return category ? updates.filter((update) => update.finalCategoryIds.includes(category.id)).length : 0;
  };
  return {
    total: updates.length,
    novidades: bySlug("novidades"),
    correcoes: bySlug("correcoes"),
    melhorias: bySlug("melhorias"),
    published: updates.filter((update) => update.status === "PUBLISHED").length,
    scheduled: updates.filter((update) => update.status === "SCHEDULED").length
  };
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function normalizeStringArray(value: unknown, maxItems: number, maxLength: number) {
  return Array.isArray(value) ? value.map((item) => cleanText(item, maxLength).toLowerCase()).filter(Boolean).slice(0, maxItems) : [];
}

function normalizeSnowflake(value: unknown) {
  const text = cleanText(value, 32);
  return /^\d{5,32}$/.test(text) ? text : null;
}

function normalizeUrl(value: unknown) {
  const text = cleanText(value, 2048);
  return /^https?:\/\//i.test(text) ? text : null;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

function parseDate(value: unknown) {
  const text = cleanText(value, 80);
  if (!text) return null;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatUpdateDate(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(Number.isFinite(date.getTime()) ? date : new Date());
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function slug(value: string) {
  return cleanText(value, 80).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || randomUUID();
}

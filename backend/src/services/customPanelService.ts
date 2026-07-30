import { randomUUID } from "node:crypto";
import {
  getMongoCollections,
  type MongoCustomPanel,
  type MongoCustomPanelCategory,
  type MongoCustomPanelComponent
} from "../database/mongo";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoom } from "../realtime/events";
import { createLog } from "./logService";

export const CUSTOM_PANELS_MODULE_ID = "panels";

const DEFAULT_CATEGORIES = [
  "Administração",
  "Polícia",
  "FiveM",
  "Tickets",
  "Vendas",
  "Segurança",
  "RH",
  "Streamer",
  "Comunidade",
  "Personalizados"
];

const DEFAULT_PANEL_TEMPLATES: Record<string, Array<{
  beforeMessage: string;
  components: MongoCustomPanelComponent[];
  description: string;
  emoji: string;
  footerText: string;
  name: string;
  panelType: string;
}>> = {
  administracao: [
    defaultPanelTemplate("Painel Staff", "📋", "Central administrativa para ações de equipe, avisos internos e solicitações operacionais.", "staff"),
    defaultPanelTemplate("Painel Moderador", "🛡️", "Área de suporte para moderação, análise de denúncias e acompanhamento de ocorrências.", "moderation"),
    defaultPanelTemplate("Painel Verificação", "✅", "Painel para iniciar processos de verificação e liberação de acesso.", "verification"),
    defaultPanelTemplate("Painel Boas-vindas", "👋", "Mensagem inicial para orientar novos membros e apresentar os canais principais.", "welcome")
  ],
  policia: [
    defaultPanelTemplate("Painel Polícia", "🚓", "Central de acesso para serviços, solicitações e processos internos da corporação.", "police"),
    defaultPanelTemplate("Painel Promoções", "📈", "Solicitação e acompanhamento de avaliações de promoção da corporação.", "police-promotions"),
    defaultPanelTemplate("Painel Ausências", "📅", "Registro de ausências, afastamentos e justificativas operacionais.", "police-absences")
  ],
  fivem: [
    defaultPanelTemplate("Painel FiveM", "🎮", "Acesso rápido aos sistemas operacionais do servidor FiveM.", "fivem"),
    defaultPanelTemplate("Painel Facção", "🏷️", "Solicitações e ações voltadas para organizações e facções.", "faction")
  ],
  tickets: [
    defaultPanelTemplate("Painel Tickets", "🎫", "Abra um atendimento com a equipe responsável pelo assunto selecionado.", "tickets"),
    defaultPanelTemplate("Painel Suporte", "🧰", "Canal central para dúvidas, problemas técnicos e solicitações gerais.", "support")
  ],
  vendas: [
    defaultPanelTemplate("Painel Vendas", "💳", "Consulte planos, benefícios e abra uma solicitação de compra.", "sales"),
    defaultPanelTemplate("Painel Planos", "📦", "Veja os planos disponíveis e escolha a melhor opção para o seu servidor.", "plans")
  ],
  seguranca: [
    defaultPanelTemplate("Painel Segurança", "🔒", "Ações de proteção, denúncias e validações de segurança do servidor.", "security"),
    defaultPanelTemplate("Painel Denúncias", "🚨", "Envie uma denúncia para análise da equipe responsável.", "reports")
  ],
  rh: [
    defaultPanelTemplate("Painel RH", "📁", "Solicitações de recursos humanos, registros internos e acompanhamento de equipe.", "rh"),
    defaultPanelTemplate("Painel Recrutamento", "📝", "Inicie processos de inscrição, recrutamento ou registro manual.", "recruitment")
  ],
  streamer: [
    defaultPanelTemplate("Painel Streamer", "📺", "Divulgação, notificações e ferramentas para criadores de conteúdo.", "streamer"),
    defaultPanelTemplate("Painel Lives", "🔴", "Acompanhe lives, avisos e integrações de transmissão.", "live")
  ],
  comunidade: [
    defaultPanelTemplate("Painel Comunidade", "🌐", "Informações, links úteis e ações públicas para a comunidade.", "community"),
    defaultPanelTemplate("Painel Eventos", "🎉", "Divulgue eventos, inscrições e ações especiais do servidor.", "events")
  ],
  personalizados: [
    defaultPanelTemplate("Painel Personalizado", "✨", "Modelo livre para criar um painel sob medida para o seu servidor.", "custom")
  ]
};

type ServiceError = Error & { statusCode?: number };

export type SaveCustomPanelCategoryInput = {
  description?: string | null;
  name: string;
  order?: number | null;
  userId?: string | null;
};

export type SaveCustomPanelInput = {
  afterMessage?: string | null;
  authorName?: string | null;
  bannerUrl?: string | null;
  beforeMessage?: string | null;
  categoryId: string;
  channelId?: string | null;
  color?: string | null;
  components?: MongoCustomPanelComponent[];
  description?: string | null;
  emoji?: string | null;
  footerText?: string | null;
  mentionRoleId?: string | null;
  name: string;
  panelType?: string | null;
  thumbnailUrl?: string | null;
  userId?: string | null;
};

export type UpdateCustomPanelStateInput = {
  messageId?: string | null;
  published?: boolean;
};

export type CustomPanelCategoryDto = {
  id: string;
  botId: string | null;
  guildId: string;
  name: string;
  slug: string;
  description: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
};

export type CustomPanelDto = {
  id: string;
  botId: string | null;
  guildId: string;
  categoryId: string;
  name: string;
  description: string;
  color: string;
  thumbnailUrl: string | null;
  bannerUrl: string | null;
  footerText: string | null;
  authorName: string | null;
  emoji: string | null;
  panelType: string;
  channelId: string | null;
  mentionRoleId: string | null;
  beforeMessage: string | null;
  afterMessage: string | null;
  components: MongoCustomPanelComponent[];
  messageId: string | null;
  published: boolean;
  publishRequestedAt: string | null;
  lastPublishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CustomPanelsDashboard = {
  categories: CustomPanelCategoryDto[];
  panels: CustomPanelDto[];
};

export async function getCustomPanelsDashboard(guildId: string, botId?: string | null): Promise<CustomPanelsDashboard> {
  const normalizedBotId = normalizeBotId(botId);
  await ensureDefaultCategories(guildId, normalizedBotId);

  const { customPanelCategories, customPanels } = await getMongoCollections();
  const scope = scopeQuery(guildId, normalizedBotId);
  const [categories, panels] = await Promise.all([
    customPanelCategories.find({ ...scope, deletedAt: null }).sort({ order: 1, name: 1 }).toArray(),
    customPanels.find({ ...scope, deletedAt: null }).sort({ updatedAt: -1 }).toArray()
  ]);

  return {
    categories: categories.map(toCategoryDto),
    panels: panels.map(toPanelDto)
  };
}

export async function listBotCustomPanels(botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { customPanels } = await getMongoCollections();
  const panels = await customPanels
    .find({
      botId: normalizedBotId,
      deletedAt: null,
      $or: [{ published: true, channelId: { $type: "string" } }, { messageId: { $type: "string" } }]
    })
    .sort({ updatedAt: 1 })
    .toArray();

  return {
    panels: panels.map(toPanelDto)
  };
}

export async function getBotCustomPanel(panelId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { customPanels } = await getMongoCollections();
  const panel = await customPanels.findOne({ _id: panelId, botId: normalizedBotId });
  if (!panel) throw createServiceError("Painel não encontrado.", 404);
  return { panel: toPanelDto(panel) };
}

export async function createCustomPanelCategory(guildId: string, botId: string | null, input: SaveCustomPanelCategoryInput) {
  const now = new Date();
  const name = normalizeText(input.name, 80, "Categoria");
  const doc: MongoCustomPanelCategory = {
    _id: randomUUID(),
    botId,
    guildId,
    name,
    slug: slugify(name),
    description: normalizeNullableText(input.description, 240),
    deletedAt: null,
    order: normalizeOrder(input.order),
    createdBy: input.userId ?? null,
    updatedBy: input.userId ?? null,
    createdAt: now,
    updatedAt: now
  };

  const { customPanelCategories } = await getMongoCollections();
  await customPanelCategories.insertOne(doc);
  await writeAudit("panels.category_created", "Categoria de painel criada", guildId, botId, input.userId, { categoryId: doc._id, name });

  return toCategoryDto(doc);
}

export async function updateCustomPanelCategory(guildId: string, botId: string | null, categoryId: string, input: Partial<SaveCustomPanelCategoryInput>) {
  const patch: Partial<MongoCustomPanelCategory> = {
    updatedAt: new Date(),
    updatedBy: input.userId ?? null
  };

  if (input.name !== undefined) {
    patch.name = normalizeText(input.name, 80, "Categoria");
    patch.slug = slugify(patch.name);
  }
  if (input.description !== undefined) patch.description = normalizeNullableText(input.description, 240);
  if (input.order !== undefined) patch.order = normalizeOrder(input.order);

  const { customPanelCategories } = await getMongoCollections();
  const category = await customPanelCategories.findOneAndUpdate(
    { _id: categoryId, ...scopeQuery(guildId, botId), deletedAt: null },
    { $set: patch },
    { returnDocument: "after" }
  );

  if (!category) throw createServiceError("Categoria não encontrada.", 404);
  await writeAudit("panels.category_updated", "Categoria de painel atualizada", guildId, botId, input.userId, { categoryId });

  return toCategoryDto(category);
}

export async function deleteCustomPanelCategory(guildId: string, botId: string | null, categoryId: string, userId?: string | null) {
  const { customPanelCategories, customPanels } = await getMongoCollections();
  const panels = await customPanels.countDocuments({ ...scopeQuery(guildId, botId), categoryId, deletedAt: null });
  if (panels > 0) {
    throw createServiceError("Exclua ou mova os painéis desta categoria antes de removê-la.", 400);
  }

  const category = await customPanelCategories.findOneAndUpdate(
    { _id: categoryId, ...scopeQuery(guildId, botId), deletedAt: null },
    { $set: { deletedAt: new Date(), updatedAt: new Date(), updatedBy: userId ?? null } },
    { returnDocument: "after" }
  );

  if (!category) throw createServiceError("Categoria não encontrada.", 404);
  await writeAudit("panels.category_deleted", "Categoria de painel excluída", guildId, botId, userId, { categoryId });

  return toCategoryDto(category);
}

export async function createCustomPanel(guildId: string, botId: string | null, input: SaveCustomPanelInput) {
  await assertCategoryExists(guildId, botId, input.categoryId);
  const now = new Date();
  const doc: MongoCustomPanel = {
    ...normalizePanelInput(guildId, botId, input),
    _id: randomUUID(),
    messageId: null,
    published: false,
    publishRequestedAt: null,
    lastPublishedAt: null,
    deletedAt: null,
    createdBy: input.userId ?? null,
    updatedBy: input.userId ?? null,
    createdAt: now,
    updatedAt: now
  };

  const { customPanels } = await getMongoCollections();
  await customPanels.insertOne(doc);
  await writeAudit("panels.panel_created", "Painel criado", guildId, botId, input.userId, { panelId: doc._id, name: doc.name });

  return toPanelDto(doc);
}

export async function updateCustomPanel(guildId: string, botId: string | null, panelId: string, input: Partial<SaveCustomPanelInput>) {
  if (input.categoryId) await assertCategoryExists(guildId, botId, input.categoryId);

  const patch = {
    ...normalizePanelPatch(input),
    updatedAt: new Date(),
    updatedBy: input.userId ?? null
  };

  const { customPanels } = await getMongoCollections();
  const panel = await customPanels.findOneAndUpdate(
    { _id: panelId, ...scopeQuery(guildId, botId), deletedAt: null },
    { $set: patch },
    { returnDocument: "after" }
  );

  if (!panel) throw createServiceError("Painel não encontrado.", 404);
  await writeAudit("panels.panel_updated", "Painel atualizado", guildId, botId, input.userId, { panelId });
  emitCustomPanelEvent(panel, panel.published ? "update" : "draft");

  return toPanelDto(panel);
}

export async function duplicateCustomPanel(guildId: string, botId: string | null, panelId: string, userId?: string | null) {
  const { customPanels } = await getMongoCollections();
  const current = await customPanels.findOne({ _id: panelId, ...scopeQuery(guildId, botId), deletedAt: null });
  if (!current) throw createServiceError("Painel não encontrado.", 404);

  const now = new Date();
  const copy: MongoCustomPanel = {
    ...current,
    _id: randomUUID(),
    name: `${current.name} - Cópia`.slice(0, 100),
    messageId: null,
    published: false,
    publishRequestedAt: null,
    lastPublishedAt: null,
    deletedAt: null,
    createdBy: userId ?? null,
    updatedBy: userId ?? null,
    createdAt: now,
    updatedAt: now
  };

  await customPanels.insertOne(copy);
  await writeAudit("panels.panel_duplicated", "Painel duplicado", guildId, botId, userId, { panelId, copyId: copy._id });

  return toPanelDto(copy);
}

export async function deleteCustomPanel(guildId: string, botId: string | null, panelId: string, userId?: string | null) {
  const { customPanels } = await getMongoCollections();
  const panel = await customPanels.findOneAndUpdate(
    { _id: panelId, ...scopeQuery(guildId, botId), deletedAt: null },
    { $set: { deletedAt: new Date(), published: false, updatedAt: new Date(), updatedBy: userId ?? null } },
    { returnDocument: "after" }
  );

  if (!panel) throw createServiceError("Painel não encontrado.", 404);
  await writeAudit("panels.panel_deleted", "Painel excluído", guildId, botId, userId, { panelId });
  emitCustomPanelEvent(panel, "remove");

  return toPanelDto(panel);
}

export async function publishCustomPanel(guildId: string, botId: string | null, panelId: string, userId?: string | null) {
  const { customPanels } = await getMongoCollections();
  const panel = await customPanels.findOneAndUpdate(
    { _id: panelId, ...scopeQuery(guildId, botId), deletedAt: null },
    { $set: { published: true, publishRequestedAt: new Date(), updatedAt: new Date(), updatedBy: userId ?? null } },
    { returnDocument: "after" }
  );

  if (!panel) throw createServiceError("Painel não encontrado.", 404);
  if (!panel.channelId) throw createServiceError("Selecione um canal antes de publicar o painel.", 400);

  await writeAudit("panels.panel_publish_requested", "Publicação de painel solicitada", guildId, botId, userId, { panelId, channelId: panel.channelId, messageId: panel.messageId });
  emitCustomPanelEvent(panel, "publish");

  return toPanelDto(panel);
}

export async function updateCustomPanelMessageState(panelId: string, botId: string | null, input: UpdateCustomPanelStateInput) {
  const patch: Partial<MongoCustomPanel> = {
    updatedAt: new Date()
  };
  if (input.messageId !== undefined) patch.messageId = normalizeSnowflake(input.messageId);
  if (input.published !== undefined) patch.published = input.published;
  if (input.published || input.messageId) patch.lastPublishedAt = new Date();

  const { customPanels } = await getMongoCollections();
  const panel = await customPanels.findOneAndUpdate(
    { _id: panelId, botId },
    { $set: patch },
    { returnDocument: "after" }
  );

  if (!panel) throw createServiceError("Painel não encontrado.", 404);
  await writeAudit("panels.panel_state_updated", "Estado de mensagem do painel atualizado pelo bot", panel.guildId, botId, null, { panelId, messageId: panel.messageId });

  return toPanelDto(panel);
}

function normalizePanelInput(guildId: string, botId: string | null, input: SaveCustomPanelInput): Omit<MongoCustomPanel, "_id" | "messageId" | "published" | "publishRequestedAt" | "lastPublishedAt" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt"> {
  return {
    guildId,
    botId,
    categoryId: input.categoryId,
    name: normalizeText(input.name, 100, "Painel"),
    description: normalizeText(input.description, 4000, "Descrição do painel"),
    color: normalizeColor(input.color),
    thumbnailUrl: normalizeUrl(input.thumbnailUrl),
    bannerUrl: normalizeUrl(input.bannerUrl),
    footerText: normalizeNullableText(input.footerText, 300),
    authorName: normalizeNullableText(input.authorName, 120),
    emoji: normalizeNullableText(input.emoji, 80),
    panelType: normalizeNullableText(input.panelType, 80) ?? "custom",
    channelId: normalizeSnowflake(input.channelId),
    mentionRoleId: normalizeSnowflake(input.mentionRoleId),
    beforeMessage: normalizeNullableText(input.beforeMessage, 1900),
    afterMessage: normalizeNullableText(input.afterMessage, 1900),
    components: normalizeComponents(input.components)
  };
}

function normalizePanelPatch(input: Partial<SaveCustomPanelInput>): Partial<MongoCustomPanel> {
  const patch: Partial<MongoCustomPanel> = {};
  if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
  if (input.name !== undefined) patch.name = normalizeText(input.name, 100, "Painel");
  if (input.description !== undefined) patch.description = normalizeText(input.description, 4000, "Descrição do painel");
  if (input.color !== undefined) patch.color = normalizeColor(input.color);
  if (input.thumbnailUrl !== undefined) patch.thumbnailUrl = normalizeUrl(input.thumbnailUrl);
  if (input.bannerUrl !== undefined) patch.bannerUrl = normalizeUrl(input.bannerUrl);
  if (input.footerText !== undefined) patch.footerText = normalizeNullableText(input.footerText, 300);
  if (input.authorName !== undefined) patch.authorName = normalizeNullableText(input.authorName, 120);
  if (input.emoji !== undefined) patch.emoji = normalizeNullableText(input.emoji, 80);
  if (input.panelType !== undefined) patch.panelType = normalizeNullableText(input.panelType, 80) ?? "custom";
  if (input.channelId !== undefined) patch.channelId = normalizeSnowflake(input.channelId);
  if (input.mentionRoleId !== undefined) patch.mentionRoleId = normalizeSnowflake(input.mentionRoleId);
  if (input.beforeMessage !== undefined) patch.beforeMessage = normalizeNullableText(input.beforeMessage, 1900);
  if (input.afterMessage !== undefined) patch.afterMessage = normalizeNullableText(input.afterMessage, 1900);
  if (input.components !== undefined) patch.components = normalizeComponents(input.components);
  return patch;
}

async function ensureDefaultCategories(guildId: string, botId: string | null) {
  const { customPanelCategories, customPanels } = await getMongoCollections();
  const scope = scopeQuery(guildId, botId);
  const existingCategories = await customPanelCategories.find({ ...scope, deletedAt: null }).toArray();
  const existingSlugs = new Set(existingCategories.map((category) => category.slug));

  const now = new Date();
  const missingCategories = DEFAULT_CATEGORIES
    .map((name, index) => ({ name, order: index + 1, slug: slugify(name) }))
    .filter((category) => !existingSlugs.has(category.slug))
    .map(({ name, order, slug }) => ({
      _id: randomUUID(),
      botId,
      guildId,
      name,
      slug,
      description: null,
      deletedAt: null,
      order,
      createdBy: null,
      updatedBy: null,
      createdAt: now,
      updatedAt: now
    }));

  if (missingCategories.length) await customPanelCategories.insertMany(missingCategories);

  const panelCount = await customPanels.countDocuments({ ...scope, deletedAt: null });
  if (panelCount > 0) return;

  const categories = missingCategories.length
    ? await customPanelCategories.find({ ...scope, deletedAt: null }).toArray()
    : existingCategories;
  const categoriesBySlug = new Map(categories.map((category) => [category.slug, category]));
  const defaultPanels = Object.entries(DEFAULT_PANEL_TEMPLATES).flatMap(([categorySlug, templates]) => {
    const category = categoriesBySlug.get(categorySlug);
    if (!category) return [];
    return templates.map((template): MongoCustomPanel => ({
      _id: randomUUID(),
      afterMessage: null,
      authorName: "NexTech",
      bannerUrl: null,
      beforeMessage: template.beforeMessage,
      botId,
      categoryId: category._id,
      channelId: null,
      color: "#FFD500",
      components: template.components,
      createdAt: now,
      createdBy: null,
      description: template.description,
      emoji: template.emoji,
      footerText: template.footerText,
      guildId,
      lastPublishedAt: null,
      deletedAt: null,
      mentionRoleId: null,
      messageId: null,
      name: template.name,
      panelType: template.panelType,
      published: false,
      publishRequestedAt: null,
      thumbnailUrl: null,
      updatedAt: now,
      updatedBy: null
    }));
  });

  if (defaultPanels.length) await customPanels.insertMany(defaultPanels);
}

function defaultPanelTemplate(name: string, emoji: string, description: string, panelType: string) {
  return {
    beforeMessage: "Escolha uma opção abaixo.",
    components: [{
      customId: `custom_panel:${panelType}:open`,
      disabled: false,
      emoji,
      label: "Abrir",
      style: "secondary",
      type: "button"
    } satisfies MongoCustomPanelComponent],
    description,
    emoji,
    footerText: "NexTech • Painel configurável",
    name,
    panelType
  };
}

async function assertCategoryExists(guildId: string, botId: string | null, categoryId: string) {
  const { customPanelCategories } = await getMongoCollections();
  const exists = await customPanelCategories.findOne({ _id: categoryId, ...scopeQuery(guildId, botId), deletedAt: null });
  if (!exists) throw createServiceError("Categoria não encontrada.", 404);
}

function emitCustomPanelEvent(panel: MongoCustomPanel, action: "draft" | "publish" | "remove" | "update") {
  const payload = {
    action,
    botId: panel.botId,
    guildId: panel.guildId,
    panelId: panel._id
  };
  emitRealtime("panels:updated", payload);
  if (panel.botId) emitRealtimeToRoom(devBotRealtimeRoom(panel.botId), "panels:updated", payload);
}

async function writeAudit(type: string, message: string, guildId: string, botId: string | null, userId: string | null | undefined, metadata: Record<string, unknown>) {
  if (!botId) return;
  await createLog({
    botId,
    guildId,
    userId: userId ?? null,
    module: CUSTOM_PANELS_MODULE_ID,
    action: type.split(".").at(-1) ?? type,
    type,
    message,
    metadata
  }).catch(() => undefined);
}

function toCategoryDto(category: MongoCustomPanelCategory): CustomPanelCategoryDto {
  return {
    id: category._id,
    botId: category.botId,
    guildId: category.guildId,
    name: category.name,
    slug: category.slug,
    description: category.description,
    order: category.order,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString()
  };
}

function toPanelDto(panel: MongoCustomPanel): CustomPanelDto {
  return {
    id: panel._id,
    botId: panel.botId,
    guildId: panel.guildId,
    categoryId: panel.categoryId,
    name: panel.name,
    description: panel.description,
    color: panel.color,
    thumbnailUrl: panel.thumbnailUrl,
    bannerUrl: panel.bannerUrl,
    footerText: panel.footerText,
    authorName: panel.authorName,
    emoji: panel.emoji,
    panelType: panel.panelType,
    channelId: panel.channelId,
    mentionRoleId: panel.mentionRoleId,
    beforeMessage: panel.beforeMessage,
    afterMessage: panel.afterMessage,
    components: panel.components,
    messageId: panel.messageId,
    published: panel.published,
    publishRequestedAt: panel.publishRequestedAt?.toISOString() ?? null,
    lastPublishedAt: panel.lastPublishedAt?.toISOString() ?? null,
    createdAt: panel.createdAt.toISOString(),
    updatedAt: panel.updatedAt.toISOString()
  };
}

function normalizeComponents(value: unknown): MongoCustomPanelComponent[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 25).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const type = String(raw.type ?? "").trim().toLowerCase();
    if (!["button", "select", "modal", "dropdown", "url_button", "link_button"].includes(type)) return [];

    return [{
      customId: normalizeNullableText(raw.customId, 100),
      disabled: Boolean(raw.disabled),
      emoji: normalizeNullableText(raw.emoji, 80),
      label: normalizeNullableText(raw.label, 80),
      maxValues: normalizeInteger(raw.maxValues, 25),
      minValues: normalizeInteger(raw.minValues, 25),
      options: normalizeOptions(raw.options),
      placeholder: normalizeNullableText(raw.placeholder, 120),
      style: normalizeStyle(raw.style),
      type: type as MongoCustomPanelComponent["type"],
      url: normalizeUrl(raw.url)
    }];
  });
}

function normalizeOptions(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, 25).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const label = normalizeNullableText(raw.label, 80);
    const optionValue = normalizeNullableText(raw.value, 100);
    if (!label || !optionValue) return [];
    return [{
      description: normalizeNullableText(raw.description, 100),
      emoji: normalizeNullableText(raw.emoji, 80),
      label,
      value: optionValue
    }];
  });
}

function normalizeStyle(value: unknown): MongoCustomPanelComponent["style"] {
  const style = String(value ?? "").trim().toLowerCase();
  if (["primary", "secondary", "success", "danger", "link"].includes(style)) return style as MongoCustomPanelComponent["style"];
  return "secondary";
}

function normalizeColor(value: unknown) {
  const color = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#FFD500";
}

function normalizeUrl(value: unknown) {
  const text = normalizeNullableText(value, 2048);
  if (!text) return null;
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeSnowflake(value: unknown) {
  const text = normalizeNullableText(value, 32);
  return text && /^\d{5,32}$/.test(text) ? text : null;
}

function normalizeInteger(value: unknown, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(max, Math.trunc(number)));
}

function normalizeOrder(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 999;
  return Math.max(1, Math.min(9999, Math.trunc(number)));
}

function normalizeText(value: unknown, max: number, fallback: string) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
  return text || fallback;
}

function normalizeNullableText(value: unknown, max: number) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().slice(0, max);
  return text || null;
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "categoria";
}

function normalizeBotId(botId?: string | null) {
  return botId?.trim() || null;
}

function scopeQuery(guildId: string, botId: string | null) {
  return { botId, guildId };
}

export function createServiceError(message: string, statusCode: number) {
  const error = new Error(message) as ServiceError;
  error.statusCode = statusCode;
  return error;
}

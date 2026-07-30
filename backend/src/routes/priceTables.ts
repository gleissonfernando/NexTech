import { Router, type Request } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot, requireBot } from "../middleware/auth";
import { canReadDevBotModule, canUseDevBotModule, authorizeBotRuntimeModule } from "../services/devBotService";
import { canReadDashboardGuild, canManageDashboardGuild } from "../services/dashboardGuildAccessService";
import type { MongoPriceTableItem } from "../database/mongo";
import {
  createPriceTableRequest,
  deletePriceTable,
  getPriceTableRuntime,
  listPriceTables,
  PRICE_TABLES_MODULE_ID,
  requestPriceTablePublish,
  savePriceTable,
  updatePriceTablePanelState
} from "../services/priceTableService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

export const priceTablesRouter = Router();

const snowflake = z.string().regex(/^\d{5,32}$/);
const optionalSnowflake = snowflake.nullable().optional().or(z.literal(""));
const itemSchema = z.object({
  active: z.boolean().default(true),
  billingText: z.string().max(80).nullable().optional().or(z.literal("")),
  billingType: z.enum(["one_time", "monthly", "weekly", "custom"]).default("one_time"),
  description: z.string().max(300).nullable().optional().or(z.literal("")),
  highlight: z.boolean().default(false),
  id: z.string().max(120).optional().or(z.literal("")),
  name: z.string().min(1).max(100),
  order: z.number().int().min(0).max(500).default(0),
  price: z.number().min(0).max(100000000),
  priceText: z.string().max(80).nullable().optional().or(z.literal(""))
});
const tableSchema = z.object({
  buttonText: z.object({
    plans: z.string().min(1).max(40),
    quote: z.string().min(1).max(40),
    support: z.string().min(1).max(40)
  }).optional(),
  color: z.string().min(4).max(24).optional(),
  currency: z.enum(["BRL", "USD", "EUR", "CUSTOM"]).optional(),
  currencyFormat: z.string().max(12).optional(),
  description: z.string().max(1200).nullable().optional().or(z.literal("")),
  discordChannelId: optionalSnowflake,
  footerText: z.string().max(500).nullable().optional().or(z.literal("")),
  imagePosition: z.enum(["top", "bottom", "thumbnail", "none"]).optional(),
  imageUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  isActive: z.boolean().optional(),
  items: z.array(itemSchema).max(50).optional(),
  logChannelId: optionalSnowflake,
  modalText: z.object({
    contactLabel: z.string().min(1).max(45),
    contactPlaceholder: z.string().max(100),
    detailsLabel: z.string().min(1).max(45),
    detailsPlaceholder: z.string().max(100),
    productLabel: z.string().min(1).max(45),
    productPlaceholder: z.string().max(100),
    title: z.string().min(1).max(45),
    userNameLabel: z.string().min(1).max(45),
    userNamePlaceholder: z.string().max(100)
  }).optional(),
  name: z.string().min(1).max(100).optional(),
  supportCategoryId: optionalSnowflake,
  supportRoleIds: z.array(snowflake).max(25).optional(),
  ticketInitialMessage: z.string().max(1800).optional(),
  panelEmojis: z.object({
    products: z.string().max(100), systems: z.string().max(100), advantages: z.string().max(100), support: z.string().max(100)
  }).optional(),
  panelSections: z.object({
    includedTitle: z.string().max(80), includedItems: z.array(z.string().max(180)).max(20),
    systemsTitle: z.string().max(80), systemsText: z.string().max(1800),
    advantagesTitle: z.string().max(80), advantages: z.array(z.string().max(180)).max(20),
    supportTitle: z.string().max(80), supportText: z.string().max(1000)
  }).optional(),
  title: z.string().min(1).max(120).optional()
});
const requestSchema = z.object({
  contact: z.string().min(1).max(120),
  details: z.string().min(1).max(900),
  itemId: z.string().max(120).nullable().optional(),
  itemName: z.string().min(1).max(100),
  tableId: z.string().min(1).max(120),
  ticketChannelId: optionalSnowflake,
  userId: snowflake,
  userName: z.string().min(1).max(100)
});
const panelStateSchema = z.object({
  messageId: optionalSnowflake
});

priceTablesRouter.use(requireAuthOrBot);

priceTablesRouter.get("/:guildId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canRead(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para ver tabelas de preços." });
    return res.json(await listPriceTables(botId, guildId));
  } catch (error) {
    return next(error);
  }
});

priceTablesRouter.post("/:guildId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para criar tabelas de preços." });
    const table = await savePriceTable(botId, guildId, null, sanitizeTable(tableSchema.parse(req.body ?? {})), res.locals.dashboardAuth.user.discordId);
    return res.status(201).json({ table });
  } catch (error) {
    return next(error);
  }
});

priceTablesRouter.patch("/:guildId/:tableId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para editar tabelas de preços." });
    const table = await savePriceTable(botId, guildId, req.params.tableId, sanitizeTable(tableSchema.parse(req.body ?? {})), res.locals.dashboardAuth.user.discordId);
    if (!table) return res.status(404).json({ message: "Tabela de preços não encontrada." });
    return res.json({ table });
  } catch (error) {
    return next(error);
  }
});

priceTablesRouter.delete("/:guildId/:tableId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para excluir tabelas de preços." });
    const table = await deletePriceTable(botId, guildId, req.params.tableId, res.locals.dashboardAuth.user.discordId);
    if (!table) return res.status(404).json({ message: "Tabela de preços não encontrada." });
    return res.json({ table });
  } catch (error) {
    return next(error);
  }
});

priceTablesRouter.post("/:guildId/:tableId/publish", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para publicar tabelas de preços." });
    const table = await requestPriceTablePublish(botId, guildId, req.params.tableId, res.locals.dashboardAuth.user.discordId);
    if (!table) return res.status(404).json({ message: "Tabela de preços não encontrada." });
    return res.json({ table });
  } catch (error) {
    return next(error);
  }
});

priceTablesRouter.get("/bot/:guildId/:tableId/runtime", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const tableId = z.string().min(1).max(120).parse(req.params.tableId);
    const botId = await resolveRequestBotId(req);
    const runtimeBotId = await assertRuntime(botId, guildId);
    const table = await getPriceTableRuntime(runtimeBotId, guildId, tableId);
    if (!table) return res.status(404).json({ message: "Tabela de preços indisponível." });
    return res.json({ table });
  } catch (error) {
    return next(error);
  }
});

priceTablesRouter.put("/bot/:guildId/:tableId/panel-state", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const tableId = z.string().min(1).max(120).parse(req.params.tableId);
    const input = panelStateSchema.parse(req.body ?? {});
    const botId = await resolveRequestBotId(req);
    const runtimeBotId = await assertRuntime(botId, guildId);
    return res.json({ table: await updatePriceTablePanelState(runtimeBotId, guildId, tableId, input.messageId || null) });
  } catch (error) {
    return next(error);
  }
});

priceTablesRouter.post("/bot/:guildId/publish-active", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    const runtimeBotId = await assertRuntime(botId, guildId);
    const dashboard = await listPriceTables(runtimeBotId, guildId);
    const published: string[] = [];
    for (const table of dashboard.tables.filter((item) => item.isActive && item.discordChannelId)) {
      const requested = await requestPriceTablePublish(runtimeBotId, guildId, table.id, "bot-runtime");
      if (requested) published.push(requested.id);
    }
    return res.json({ published });
  } catch (error) {
    return next(error);
  }
});

priceTablesRouter.post("/bot/:guildId/requests", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    const runtimeBotId = await assertRuntime(botId, guildId);
    const request = await createPriceTableRequest(runtimeBotId, guildId, {
      ...requestSchema.parse(req.body ?? {}),
      ticketChannelId: req.body?.ticketChannelId || null
    });
    if (!request) return res.status(404).json({ message: "Tabela de preços indisponível." });
    return res.status(201).json({ request });
  } catch (error) {
    return next(error);
  }
});

async function canRead(req: Request, guildId: string, botId: string) {
  return (await canReadDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, PRICE_TABLES_MODULE_ID))
    || canReadDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
}

async function canManage(req: Request, guildId: string, botId: string) {
  return (await canUseDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, PRICE_TABLES_MODULE_ID))
    || canManageDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
}

async function assertRuntime(botId: string | null, guildId: string) {
  if (!botId) throw Object.assign(new Error("Bot não identificado."), { statusCode: 403 });
  const authorization = await authorizeBotRuntimeModule({ botId, guildId, moduleId: PRICE_TABLES_MODULE_ID });
  if (!authorization.allowed) throw Object.assign(new Error(authorization.reason), { statusCode: 403 });
  return botId;
}

function sanitizeTable(input: z.infer<typeof tableSchema>) {
  return {
    ...input,
    discordChannelId: input.discordChannelId === "" ? null : input.discordChannelId,
    footerText: input.footerText === "" ? null : input.footerText,
    imageUrl: input.imageUrl === "" ? null : input.imageUrl,
    logChannelId: input.logChannelId === "" ? null : input.logChannelId,
    supportCategoryId: input.supportCategoryId === "" ? null : input.supportCategoryId,
    items: input.items?.map((item, index): MongoPriceTableItem => ({
      active: item.active,
      billingText: item.billingText === "" || item.billingText === undefined ? null : item.billingText,
      billingType: item.billingType,
      description: item.description === "" || item.description === undefined ? null : item.description,
      highlight: item.highlight,
      id: item.id || "",
      name: item.name,
      order: item.order ?? index,
      price: item.price,
      priceText: item.priceText === "" || item.priceText === undefined ? null : item.priceText
    }))
  };
}

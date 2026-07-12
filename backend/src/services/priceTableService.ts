import { randomUUID } from "node:crypto";
import { fixedSystemEmojiText } from "../config/systemEmojis";
import type { MongoPriceTable, MongoPriceTableItem, MongoPriceTableRequest } from "../database/mongo";
import { getMongoCollections } from "../database/mongo";
import { emitRealtime } from "../realtime/events";
import { createLog } from "./logService";

export const PRICE_TABLES_MODULE_ID = "price-tables";

export type PriceTableDto = Omit<MongoPriceTable, "_id" | "createdAt" | "updatedAt"> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type PriceTableRequestDto = Omit<MongoPriceTableRequest, "_id" | "createdAt"> & {
  id: string;
  createdAt: string;
};

export type SavePriceTableInput = Partial<Omit<
  MongoPriceTable,
  "_id" | "botId" | "createdAt" | "createdBy" | "guildId" | "messageId" | "updatedAt" | "updatedBy"
>>;

export type CreatePriceTableRequestInput = {
  contact: string;
  details: string;
  itemId?: string | null;
  itemName: string;
  tableId: string;
  ticketChannelId?: string | null;
  userId: string;
  userName: string;
};

export async function listPriceTables(botId: string, guildId: string) {
  const { priceTableRequests, priceTables } = await getMongoCollections();
  const [tables, requests] = await Promise.all([
    priceTables.find({ botId, guildId }).sort({ updatedAt: -1 }).toArray(),
    priceTableRequests.find({ botId, guildId }).sort({ createdAt: -1 }).limit(100).toArray()
  ]);

  return {
    requests: requests.map(toRequestDto),
    tables: tables.map(toPriceTableDto)
  };
}

export async function getPriceTable(botId: string, guildId: string, tableId: string) {
  const { priceTables } = await getMongoCollections();
  const table = await priceTables.findOne({ _id: tableId, botId, guildId });
  return table ? toPriceTableDto(table) : null;
}

export async function getPriceTableRuntime(botId: string, guildId: string, tableId: string) {
  const { priceTables } = await getMongoCollections();
  const table = await priceTables.findOne({ _id: tableId, botId, guildId, isActive: true });
  return table ? toPriceTableDto(table) : null;
}

export async function savePriceTable(botId: string, guildId: string, tableId: string | null, input: SavePriceTableInput, actorId: string | null) {
  const { priceTables } = await getMongoCollections();
  const now = new Date();
  const normalized = normalizePriceTableInput(input);

  if (tableId) {
    await priceTables.updateOne(
      { _id: tableId, botId, guildId },
      {
        $set: {
          ...normalized,
          updatedAt: now,
          updatedBy: actorId
        }
      }
    );
    const table = await priceTables.findOne({ _id: tableId, botId, guildId });
    if (table) {
      await writePriceTableLog("updated", table, actorId, { changed: Object.keys(normalized) });
      if (table.messageId) emitRealtime("price-tables:panel_publish", { botId, guildId, tableId });
    }
    return table ? toPriceTableDto(table) : null;
  }

  const table: MongoPriceTable = {
    _id: randomUUID(),
    botId,
    guildId,
    messageId: null,
    createdAt: now,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId,
    ...defaultPriceTable(),
    ...normalized
  };

  await priceTables.insertOne(table);
  await writePriceTableLog("created", table, actorId);
  return toPriceTableDto(table);
}

export async function deletePriceTable(botId: string, guildId: string, tableId: string, actorId: string | null) {
  const { priceTables } = await getMongoCollections();
  const table = await priceTables.findOneAndDelete({ _id: tableId, botId, guildId });
  if (table) await writePriceTableLog("deleted", table, actorId);
  return table ? toPriceTableDto(table) : null;
}

export async function requestPriceTablePublish(botId: string, guildId: string, tableId: string, actorId: string | null) {
  const { priceTables } = await getMongoCollections();
  const table = await priceTables.findOne({ _id: tableId, botId, guildId });

  if (!table) return null;

  emitRealtime("price-tables:panel_publish", { botId, guildId, tableId });
  await writePriceTableLog("publish_requested", table, actorId);
  return toPriceTableDto(table);
}

export async function updatePriceTablePanelState(botId: string, guildId: string, tableId: string, messageId: string | null) {
  const { priceTables } = await getMongoCollections();
  await priceTables.updateOne(
    { _id: tableId, botId, guildId },
    { $set: { messageId, updatedAt: new Date() } }
  );
  const table = await priceTables.findOne({ _id: tableId, botId, guildId });
  return table ? toPriceTableDto(table) : null;
}

export async function createPriceTableRequest(botId: string, guildId: string, input: CreatePriceTableRequestInput) {
  const { priceTableRequests, priceTables } = await getMongoCollections();
  const table = await priceTables.findOne({ _id: input.tableId, botId, guildId, isActive: true });

  if (!table) return null;

  const request: MongoPriceTableRequest = {
    _id: randomUUID(),
    botId,
    contact: input.contact.trim(),
    createdAt: new Date(),
    details: input.details.trim(),
    guildId,
    itemId: input.itemId ?? null,
    itemName: input.itemName.trim(),
    tableId: input.tableId,
    ticketChannelId: input.ticketChannelId ?? null,
    userId: input.userId,
    userName: input.userName.trim()
  };

  await priceTableRequests.insertOne(request);
  await writePriceTableLog("request_created", table, input.userId, {
    itemName: request.itemName,
    requestId: request._id,
    ticketChannelId: request.ticketChannelId
  });
  return toRequestDto(request);
}

export function toPriceTableDto(table: MongoPriceTable): PriceTableDto {
  const defaults = defaultPriceTable();
  return {
    ...defaults,
    ...table,
    panelEmojis: { ...defaults.panelEmojis, ...table.panelEmojis },
    panelSections: { ...defaults.panelSections, ...table.panelSections },
    supportRoleIds: table.supportRoleIds ?? [],
    ticketInitialMessage: table.ticketInitialMessage ?? defaults.ticketInitialMessage,
    id: table._id,
    createdAt: table.createdAt.toISOString(),
    updatedAt: table.updatedAt.toISOString()
  };
}

function toRequestDto(request: MongoPriceTableRequest): PriceTableRequestDto {
  return {
    ...request,
    id: request._id,
    createdAt: request.createdAt.toISOString()
  };
}

function defaultPriceTable(): Omit<MongoPriceTable, "_id" | "botId" | "createdAt" | "createdBy" | "guildId" | "messageId" | "updatedAt" | "updatedBy"> {
  return {
    buttonText: {
      plans: "Ver Planos",
      quote: "Solicitar Orcamento",
      support: "Falar com Atendimento"
    },
    color: "#7c3aed",
    currency: "BRL",
    currencyFormat: "R$",
    description: "Aqui voce encontra os valores dos sistemas disponiveis para contratacao.",
    discordChannelId: null,
    footerText: "Valores sujeitos a alteracao conforme personalizacao.",
    imagePosition: "top",
    imageUrl: null,
    isActive: true,
    items: [
      {
        active: true,
        billingText: null,
        billingType: "one_time",
        description: "Bot basico com comandos e painel inicial.",
        highlight: false,
        id: randomUUID(),
        name: "Bot Simples",
        order: 0,
        price: 50,
        priceText: null
      }
    ],
    logChannelId: null,
    modalText: {
      contactLabel: "Forma de contato",
      contactPlaceholder: "Discord, WhatsApp ou email",
      detailsLabel: "Detalhes do pedido",
      detailsPlaceholder: "Descreva o que voce precisa",
      productLabel: "Sistema desejado",
      productPlaceholder: "Nome do produto ou plano",
      title: "Solicitar Orcamento",
      userNameLabel: "Nome do cliente",
      userNamePlaceholder: "Seu nome"
    },
    name: "Tabela de Precos",
    supportCategoryId: null,
    supportRoleIds: [],
    ticketInitialMessage: "Ola {user}! Seu atendimento para **{product}** foi aberto. Nossa equipe respondera em breve.",
    panelEmojis: {
      products: fixedSystemEmojiText("caixa"),
      systems: fixedSystemEmojiText("engrenagem"),
      advantages: fixedSystemEmojiText("trofeu"),
      support: fixedSystemEmojiText("interrogacao")
    },
    panelSections: {
      includedTitle: "SISTEMAS INCLUSOS",
      includedItems: ["Painel completo pela Dashboard", "Atualizacoes e configuracao sem alterar codigo"],
      systemsTitle: "SISTEMAS",
      systemsText: "**FAC**\n• Ausencias\n• Hierarquia\n• Acoes\n• Financeiro\n• Encomendas e metas",
      advantagesTitle: "VANTAGENS",
      advantages: ["Configuracao completa pela Dashboard", "Atualizacao em tempo real", "Suporte especializado"],
      supportTitle: "SUPORTE",
      supportText: "Abra um ticket para tirar duvidas ou contratar este produto."
    },
    title: "Tabela de Precos - Sistemas para Discord"
  };
}

function normalizePriceTableInput(input: SavePriceTableInput) {
  return {
    ...input,
    buttonText: {
      ...defaultPriceTable().buttonText,
      ...input.buttonText
    },
    color: input.color?.trim() || defaultPriceTable().color,
    currencyFormat: input.currencyFormat?.trim() || currencySymbol(input.currency ?? "BRL"),
    description: normalizeNullable(input.description),
    footerText: normalizeNullable(input.footerText),
    imageUrl: normalizeNullable(input.imageUrl),
    items: Array.isArray(input.items) ? input.items.map(normalizeItem).sort((a, b) => a.order - b.order) : defaultPriceTable().items,
    modalText: {
      ...defaultPriceTable().modalText,
      ...input.modalText
    },
    panelEmojis: { ...defaultPriceTable().panelEmojis, ...input.panelEmojis },
    panelSections: { ...defaultPriceTable().panelSections, ...input.panelSections },
    supportRoleIds: Array.isArray(input.supportRoleIds) ? [...new Set(input.supportRoleIds)] : defaultPriceTable().supportRoleIds,
    ticketInitialMessage: input.ticketInitialMessage?.trim() || defaultPriceTable().ticketInitialMessage,
    name: input.name?.trim() || defaultPriceTable().name,
    title: input.title?.trim() || defaultPriceTable().title
  };
}

function normalizeItem(item: MongoPriceTableItem, index: number): MongoPriceTableItem {
  return {
    active: item.active !== false,
    billingText: normalizeNullable(item.billingText),
    billingType: item.billingType ?? "one_time",
    description: normalizeNullable(item.description),
    highlight: Boolean(item.highlight),
    id: item.id?.trim() || randomUUID(),
    name: item.name?.trim() || `Item ${index + 1}`,
    order: Number.isFinite(item.order) ? item.order : index,
    price: Number.isFinite(item.price) ? item.price : 0,
    priceText: normalizeNullable(item.priceText)
  };
}

function normalizeNullable(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function currencySymbol(currency: MongoPriceTable["currency"]) {
  return ({ BRL: "R$", CUSTOM: "", EUR: "EUR", USD: "USD" } as const)[currency];
}

async function writePriceTableLog(action: string, table: Pick<MongoPriceTable, "_id" | "botId" | "guildId" | "logChannelId" | "name">, actorId: string | null, data: Record<string, unknown> = {}) {
  const { priceTableLogs } = await getMongoCollections();
  const createdAt = new Date();
  await priceTableLogs.insertOne({
    _id: randomUUID(),
    action,
    actorId,
    botId: table.botId,
    createdAt,
    data,
    guildId: table.guildId,
    tableId: table._id
  });
  await createLog({
    botId: table.botId,
    guildId: table.guildId,
    metadata: { action, ...data, logChannelId: table.logChannelId, tableId: table._id },
    message: `Tabela de precos ${table.name}: ${action}.`,
    type: `price_tables.${action}`,
    userId: actorId
  }).catch(() => undefined);
}

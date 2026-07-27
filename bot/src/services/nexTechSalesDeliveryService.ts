import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits, type Client, type Guild, type GuildMember, type GuildTextBasedChannel } from "discord.js";
import { currentRuntimeBotId, env } from "../config/env";
import type { BotContext } from "../types";
import type { NexTechSalePaidEvent, PaymentApprovedEvent } from "../websocket/socketClient";
import type { SubscriptionPresenceButton, SubscriptionPresenceProduct, SubscriptionPresencePublication, SubscriptionPresenceSettings } from "./apiClient";
import { systemEmojiText } from "./systemEmojiService";

const deliveryLocks = new Set<string>();
const presenceQueues = new Map<string, Promise<void>>();

type PresencePaymentPayload = {
  amountCents: number;
  approvedAt: string | null;
  botId?: string | null;
  buyerId: string;
  buyerName?: string | null;
  currency: "BRL" | "USD" | "EUR";
  gateway?: string | null;
  guildId: string;
  moduleId: string;
  paymentMethod?: string | null;
  planName: string;
  productId?: string | null;
  productName?: string | null;
  productPlanType?: string | null;
  purchasedRoleId?: string | null;
  saleId: string;
};

export function startNexTechSalesDeliveryService(client: Client<true>, context: BotContext) {
  context.socket.onNexTechSalePaid((payload) => {
    void deliverNexTechSale(client, context, payload);
  });
  context.socket.onPaymentApproved((payload) => {
    void deliverPaymentPresence(client, context, fromPaymentApproved(payload));
  });
}

async function deliverNexTechSale(client: Client<true>, context: BotContext, payload: NexTechSalePaidEvent) {
  const runtimeBotId = (currentRuntimeBotId() ?? env.DASHBOARD_BOT_ID) || null;

  if (payload.botId && runtimeBotId && payload.botId !== runtimeBotId) {
    return;
  }

  const lockKey = `${payload.guildId}:${payload.saleId}`;
  if (deliveryLocks.has(lockKey)) {
    return;
  }
  deliveryLocks.add(lockKey);

  const deliveredRoleIds: string[] = [];
  const errors: string[] = [];
  let messageId: string | null = null;

  try {
    const guild = await client.guilds.fetch(payload.guildId).catch(() => null);
    if (!guild) {
      throw new Error("O bot não está conectado ao servidor da venda.");
    }

    const member = await guild.members.fetch(payload.buyerId).catch(() => null);
    if (!member) {
      throw new Error("Comprador não encontrado no servidor.");
    }

    if (payload.saleId.startsWith("manual-payment:")) {
      await enqueueSubscriptionPresence(guild, member, context, fromLegacySalePaid(payload), []).catch((error) => {
        console.warn("[subscription-presence] falha ao publicar presença manual:", error instanceof Error ? error.message : error);
      });
      return;
    }

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      errors.push("Bot sem permissão Gerenciar Cargos.");
    } else {
      const roleIds = unique([payload.customerRoleId ?? null, payload.purchasedRoleId ?? null]);

      for (const roleId of roleIds) {
        const role = await guild.roles.fetch(roleId).catch(() => null);
        if (!role) {
          errors.push(`Cargo ${roleId} não encontrado.`);
          continue;
        }
        if (!role.editable || role.managed) {
          errors.push(`Cargo ${role.name} não pode ser entregue pelo bot.`);
          continue;
        }
        if (!member.roles.cache.has(role.id)) {
          await member.roles.add(role, `Venda Nex Tech paga: ${payload.saleId}`);
        }
        deliveredRoleIds.push(role.id);
      }
    }

    const channel = await resolveDeliveryChannel(guild, payload.saleChannelId ?? payload.logChannelId ?? null);
    if (channel) {
      const message = await channel.send(renderSalePaidMessage(guild, payload, deliveredRoleIds, errors)).catch((error: unknown) => {
        errors.push(error instanceof Error ? error.message : "Falha ao enviar aviso da venda.");
        return null;
      });
      messageId = message?.id ?? null;
    } else {
      errors.push("Canal de aviso de venda não configurado ou inacessível.");
    }

    const status = deliveredRoleIds.length && errors.length ? "partial" : deliveredRoleIds.length ? "delivered" : "failed";
    await context.api.reportNexTechSaleDeliveryResult(payload.guildId, {
      deliveredRoleIds,
      error: errors.join(" | ") || null,
      messageId,
      saleId: payload.saleId,
      status
    });

    await enqueueSubscriptionPresence(guild, member, context, fromLegacySalePaid(payload), deliveredRoleIds).catch((error) => {
      console.warn("[subscription-presence] falha ao publicar presença:", error instanceof Error ? error.message : error);
    });
  } catch (error) {
    await context.api.reportNexTechSaleDeliveryResult(payload.guildId, {
      deliveredRoleIds,
      error: error instanceof Error ? error.message : "Falha ao entregar venda Nex Tech.",
      messageId,
      saleId: payload.saleId,
      status: "failed"
    }).catch(() => null);
  } finally {
    deliveryLocks.delete(lockKey);
  }
}

async function deliverPaymentPresence(client: Client<true>, context: BotContext, payload: PresencePaymentPayload) {
  const runtimeBotId = (currentRuntimeBotId() ?? env.DASHBOARD_BOT_ID) || null;
  if (payload.botId && runtimeBotId && payload.botId !== runtimeBotId) return;

  const guild = await client.guilds.fetch(payload.guildId).catch(() => null);
  if (!guild) return;
  const member = await guild.members.fetch(payload.buyerId).catch(() => null);
  if (!member) return;
  await enqueueSubscriptionPresence(guild, member, context, payload, []).catch((error) => {
    console.warn("[payment-presence] falha ao publicar presença de pagamento:", error instanceof Error ? error.message : error);
  });
}

function enqueueSubscriptionPresence(
  guild: Guild,
  member: GuildMember,
  context: BotContext,
  payload: PresencePaymentPayload,
  deliveredRoleIds: string[]
) {
  const queueKey = `${guild.id}:${payload.moduleId}`;
  const previous = presenceQueues.get(queueKey) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => publishSubscriptionPresence(guild, member, context, payload, deliveredRoleIds));
  presenceQueues.set(queueKey, next.finally(() => {
    if (presenceQueues.get(queueKey) === next) presenceQueues.delete(queueKey);
  }));
  return next;
}

async function publishSubscriptionPresence(
  guild: Guild,
  member: GuildMember,
  context: BotContext,
  payload: PresencePaymentPayload,
  deliveredRoleIds: string[]
) {
  const publication = await context.api.createSubscriptionPresencePublication(guild.id, {
    approvedAt: payload.approvedAt,
    amountCents: payload.amountCents,
    buyerId: payload.buyerId,
    buyerName: payload.buyerName ?? member.displayName,
    currency: payload.currency,
    gateway: payload.gateway ?? null,
    moduleId: payload.moduleId,
    paymentMethod: payload.paymentMethod ?? null,
    planName: payload.planName,
    productId: payload.productId ?? null,
    productName: payload.productName ?? null,
    productPlanType: payload.productPlanType ?? null,
    saleId: payload.saleId
  });

  if (!publication.shouldSend || !publication.logId) {
    return;
  }

  const channel = await resolveDeliveryChannel(guild, publication.settings.channelId);
  if (!channel) {
    await context.api.completeSubscriptionPresencePublication(guild.id, publication.logId, {
      error: "Canal configurado indisponível para o bot.",
      saleId: payload.saleId,
      status: "failed"
    });
    return;
  }

  const roleIds = unique([
    publication.selectedPlan?.roleId ?? null,
    payload.purchasedRoleId ?? null,
    ...deliveredRoleIds
  ]);
  const message = await channel.send(renderSubscriptionPresencePanel(guild, member, payload, publication, roleIds)).catch(async (error: unknown) => {
    await context.api.completeSubscriptionPresencePublication(guild.id, publication.logId!, {
      channelId: channel.id,
      error: error instanceof Error ? error.message : "Falha ao enviar Pagamento de Presença.",
      saleId: payload.saleId,
      status: "failed"
    });
    return null;
  });

  if (!message) {
    return;
  }

  await context.api.completeSubscriptionPresencePublication(guild.id, publication.logId, {
    channelId: channel.id,
    messageId: message.id,
    saleId: payload.saleId,
    status: "sent"
  });
}

async function resolveDeliveryChannel(guild: Guild, channelId: string | null): Promise<GuildTextBasedChannel | null> {
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased() || !channel.isSendable()) return null;
  return channel;
}

function renderSalePaidMessage(guild: Guild, payload: NexTechSalePaidEvent, deliveredRoleIds: string[], errors: string[]) {
  const productName = payload.productName ?? payload.planName;
  const roleLines = deliveredRoleIds.length
    ? deliveredRoleIds.map((roleId) => `- <@&${roleId}>`).join("\n")
    : "- Nenhum cargo entregue automaticamente.";
  const errorText = errors.length ? `\n\n## Avisos\n${errors.map((error) => `- ${escapeMarkdown(error)}`).join("\n")}` : "";
  const statusEmoji = deliveredRoleIds.length ? systemEmojiText("visto", guild, guild.client) : systemEmojiText("perigo", guild, guild.client);

  return {
    components: [{
      type: 17,
      accent_color: deliveredRoleIds.length ? 0x22c55e : 0xef4444,
      components: [{
        type: 10,
        content: [
          `# ${statusEmoji} Compra aprovada`,
          `Obrigado pela confianca, <@${payload.buyerId}>.`,
          "",
          `**Produto:** ${escapeMarkdown(productName)}`,
          `**Plano:** ${escapeMarkdown(payload.planName)}`,
          `**Valor:** ${formatMoney(payload.amountCents, payload.currency)}`,
          `**Venda:** \`${payload.saleId}\``,
          "",
          "## Cargos liberados",
          roleLines,
          errorText
        ].join("\n")
      }]
    }],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function renderSubscriptionPresencePanel(
  guild: Guild,
  member: GuildMember,
  payload: PresencePaymentPayload,
  publication: SubscriptionPresencePublication,
  roleIds: string[]
) {
  const settings = publication.settings;
  const product = publication.product;
  const productName = product?.name ?? payload.productName ?? payload.planName;
  const planName = publication.selectedPlan?.name ?? payload.planName;
  const acquisitionEmoji = systemEmojiText("aniversario", guild, guild.client);
  const productEmoji = resolveDisplayEmoji(guild, product?.emoji, systemEmojiText("caixa", guild, guild.client));
  const planEmoji = resolveDisplayEmoji(guild, publication.selectedPlan?.emoji, systemEmojiText("prancheta", guild, guild.client));
  const valueEmoji = systemEmojiText("dinheiro", guild, guild.client);
  const dateEmoji = systemEmojiText("calendario", guild, guild.client);
  const timeEmoji = systemEmojiText("relogio", guild, guild.client);
  const paymentDate = payload.approvedAt ? new Date(payload.approvedAt) : new Date();
  const now = Number.isNaN(paymentDate.getTime()) ? new Date() : paymentDate;
  const content = renderTemplate(settings.messageTemplate, {
    avatar: member.displayAvatarURL({ size: 256 }),
    data: formatDate(now),
    empresa: settings.companyName,
    hora: formatTime(now),
    nome: member.displayName,
    plano: planName,
    produto: productName,
    usuario: `<@${member.id}>`,
    valor: formatMoney(payload.amountCents, payload.currency)
  });
  const components: Array<Record<string, unknown> | ActionRowBuilder<ButtonBuilder>> = [];
  const avatarUrl = resolvePresenceImage(member, settings, product);

  if (settings.showAvatar !== false && avatarUrl) {
    components.push({
      type: 12,
      items: [{ media: { url: avatarUrl }, description: member.displayName }]
    });
  }

  components.push({
    type: 10,
    content: [
      `# ${acquisitionEmoji} ${escapeMarkdown(settings.title)}`,
      `**${escapeMarkdown(member.displayName)}**`,
      `-# @${escapeMarkdown(member.user.username)}`
    ].join("\n")
  });
  components.push(separator());
  components.push({ type: 10, content: `## ${productEmoji} Produto\n${escapeMarkdown(productName)}` });
  components.push({ type: 10, content: `## ${planEmoji} Plano\n${escapeMarkdown(planName)}` });
  components.push({ type: 10, content: `## ${valueEmoji} Valor\n${formatMoney(payload.amountCents, payload.currency)}` });
  components.push({ type: 10, content: `## ${systemEmojiText("dinheiro", guild, guild.client)} Pagamento\n${escapeMarkdown(paymentMethodLabel(payload.paymentMethod, payload.gateway))}` });
  if (settings.showTimestamp !== false) {
    components.push({ type: 10, content: `## ${dateEmoji} Data\n${formatDate(now)}\n\n## ${timeEmoji} Horário\n${formatTime(now)}` });
  }
  components.push(separator());
  if (content) components.push({ type: 10, content });
  if (settings.footerText) {
    components.push({ type: 10, content: `-# ${escapeMarkdown(settings.footerText)}` });
  }

  const buttons = buildPresenceButtons(guild, settings);
  if (buttons) components.push(buttons);

  const mentions = [
    settings.pingBuyer ? `<@${member.id}>` : null,
    settings.pingRoles ? roleIds.map((roleId) => `<@&${roleId}>`).join(" ") : null
  ].filter(Boolean).join(" ");

  return {
    allowedMentions: {
      parse: [] as never[],
      roles: settings.pingRoles ? roleIds : [],
      users: settings.pingBuyer ? [member.id] : []
    },
    content: mentions || undefined,
    components: [{
      type: 17,
      accent_color: parseColor(product?.color ?? publication.selectedPlan?.color ?? settings.panelColor),
      components
    }],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function fromPaymentApproved(payload: PaymentApprovedEvent): PresencePaymentPayload {
  return {
    amountCents: payload.productPrice,
    approvedAt: payload.approvedAt,
    botId: payload.botId ?? null,
    buyerId: payload.buyerId,
    buyerName: payload.buyerName ?? null,
    currency: payload.currency,
    gateway: payload.gateway ?? null,
    guildId: payload.guildId,
    moduleId: payload.moduleId,
    paymentMethod: payload.paymentMethod ?? null,
    planName: payload.productPlanType ?? payload.productName,
    productId: payload.productId ?? null,
    productName: payload.productName,
    productPlanType: payload.productPlanType ?? null,
    saleId: payload.paymentId
  };
}

function fromLegacySalePaid(payload: NexTechSalePaidEvent): PresencePaymentPayload {
  return {
    amountCents: payload.amountCents,
    approvedAt: null,
    botId: payload.botId ?? null,
    buyerId: payload.buyerId,
    buyerName: payload.buyerName ?? null,
    currency: payload.currency,
    gateway: null,
    guildId: payload.guildId,
    moduleId: payload.saleId.startsWith("manual-payment:") ? "manual-payments" : "nex-tech-sales",
    paymentMethod: payload.saleId.startsWith("manual-payment:") ? "PIX" : null,
    planName: payload.planName,
    productId: null,
    productName: payload.productName ?? null,
    productPlanType: payload.productPlanType ?? null,
    purchasedRoleId: payload.purchasedRoleId ?? null,
    saleId: payload.saleId
  };
}

function resolvePresenceImage(member: GuildMember, settings: SubscriptionPresenceSettings, product: SubscriptionPresenceProduct | null | undefined) {
  if (settings.photoMode === "company") return settings.companyAvatarUrl || member.displayAvatarURL({ size: 256 });
  if (settings.photoMode === "product") return product?.iconUrl || settings.companyAvatarUrl || member.displayAvatarURL({ size: 256 });
  return member.displayAvatarURL({ size: 256 });
}

function buildPresenceButtons(guild: Guild, settings: SubscriptionPresenceSettings) {
  const buttons = settings.buttons
    .filter((button) => button.enabled !== false)
    .sort((left, right) => left.order - right.order)
    .map((button) => buildPresenceButton(guild, settings, button))
    .filter((button): button is ButtonBuilder => Boolean(button))
    .slice(0, 4);

  return buttons.length ? new ActionRowBuilder<ButtonBuilder>().addComponents(buttons) : null;
}

function buildPresenceButton(guild: Guild, settings: SubscriptionPresenceSettings, button: SubscriptionPresenceButton) {
  const url = button.url || defaultButtonUrl(settings, button.type);
  if (!url) return null;
  const builder = new ButtonBuilder()
    .setLabel(button.label.slice(0, 80))
    .setStyle(ButtonStyle.Link)
    .setURL(url);
  const emoji = resolveDisplayEmoji(guild, button.emoji, "");
  if (emoji) builder.setEmoji(emoji);
  return builder;
}

function defaultButtonUrl(settings: SubscriptionPresenceSettings, type: SubscriptionPresenceButton["type"]) {
  if (type === "store") return settings.storeUrl;
  if (type === "docs") return settings.companyDocsUrl;
  if (type === "support") return settings.companySupportUrl;
  if (type === "website") return settings.companyWebsiteUrl;
  return null;
}

function resolveDisplayEmoji(guild: Guild, value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  const mention = value.match(/^<a?:[a-zA-Z0-9_]{2,32}:\d{5,32}>$/);
  if (mention) return value;
  const alias = value.match(/^:([a-zA-Z0-9_]{2,64}):$/);
  const name = alias?.[1] ?? (/^[a-zA-Z0-9_]{2,64}$/.test(value) ? value : "");
  if (!name) return fallback;
  const guildEmoji = guild.emojis.cache.find((emoji) => emoji.name === name);
  if (guildEmoji) return `<${guildEmoji.animated ? "a" : ""}:${guildEmoji.name}:${guildEmoji.id}>`;
  return fallback;
}

function separator() {
  return { type: 14, divider: true, spacing: 2 };
}

function renderTemplate(value: string, variables: Record<string, string>) {
  return value.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => variables[key] ?? match).trim();
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value && /^\d{5,32}$/.test(value))))];
}

function formatMoney(cents: number, currency: "BRL" | "USD" | "EUR") {
  return new Intl.NumberFormat("pt-BR", {
    currency,
    style: "currency"
  }).format(cents / 100);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(date);
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(date);
}

function paymentMethodLabel(method: string | null | undefined, gateway: string | null | undefined) {
  const normalized = String(method ?? "").trim().toLowerCase();
  const methodLabel = ({
    pix: "PIX",
    credit_card: "Cartão de crédito",
    debit_card: "Cartão de débito",
    card: "Cartão",
    manual: "Manual"
  } as Record<string, string>)[normalized] ?? (method ? method : "Pagamento aprovado");
  return gateway ? `${methodLabel} • ${gateway}` : methodLabel;
}

function escapeMarkdown(value: string) {
  return value.replace(/([\\`*_{}[\]()#+\-.!|>])/g, "\\$1");
}

function parseColor(value: string) {
  return Number.parseInt(value.replace("#", ""), 16) || 0xFFD500;
}

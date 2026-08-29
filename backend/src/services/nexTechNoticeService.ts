import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../config/env";
import { getMongoCollections, type MongoNexTechNotice, type MongoNexTechNoticeDelivery } from "../database/mongo";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const BANNER_FILENAME = "nextech-avisos-banner.png";
const BANNER_PATH = join(process.cwd(), "assets", "avisos-nextech-banner.png");
const startupNoticePending = new Set<string>();

export type NexTechNoticeRecipient = {
  botCount: number;
  botNames: string[];
  userId: string;
  userName: string | null;
};

export type SendNexTechNoticeInput = {
  additionalInfo?: string | null;
  buttonLabel?: string | null;
  buttonUrl?: string | null;
  createdBy: string;
  createdByName?: string | null;
  highlight?: string | null;
  message: string;
  title: string;
};

export async function getNexTechNoticeDashboard() {
  const { nexTechNotices } = await getMongoCollections();
  const [audience, history] = await Promise.all([
    getNexTechNoticeAudience(),
    nexTechNotices.find({}).sort({ createdAt: -1 }).limit(25).toArray()
  ]);

  return {
    audience,
    history: history.map(toNoticeDto)
  };
}

export async function getNexTechNoticeAudience(): Promise<NexTechNoticeRecipient[]> {
  const { devBots } = await getMongoCollections();
  const bots = await devBots.find(
    {},
    {
      projection: {
        name: 1,
        ownerId: 1,
        billingRecipientUserIds: 1,
        ownerName: 1
      }
    }
  ).toArray();
  const recipients = new Map<string, NexTechNoticeRecipient>();

  for (const bot of bots) {
    const userIds = sanitizeDiscordIds([bot.ownerId, ...(bot.billingRecipientUserIds ?? [])]);

    for (const userId of userIds) {
      const recipient = recipients.get(userId) ?? {
        botCount: 0,
        botNames: [],
        userId,
        userName: null
      };
      recipient.botCount += 1;
      if (bot.name && !recipient.botNames.includes(bot.name)) {
        recipient.botNames.push(bot.name);
      }
      if (userId === bot.ownerId && bot.ownerName && !recipient.userName) {
        recipient.userName = bot.ownerName;
      }
      recipients.set(userId, recipient);
    }
  }

  return Array.from(recipients.values()).sort((a, b) => b.botCount - a.botCount || a.userId.localeCompare(b.userId));
}

export async function sendNexTechNotice(input: SendNexTechNoticeInput) {
  const token = env.DISCORD_BOT_TOKEN.trim();

  if (!token) {
    throw serviceError("DISCORD_BOT_TOKEN não configurado.", 503);
  }

  const recipients = await getNexTechNoticeAudience();

  if (!recipients.length) {
    throw serviceError("Nenhum responsável de bot encontrado para receber o aviso.", 404);
  }

  const banner = await readFile(BANNER_PATH).catch(() => null);

  if (!banner) {
    throw serviceError("Banner de Avisos NexTech não encontrado no pacote.", 500);
  }

  const deliveries: MongoNexTechNoticeDelivery[] = [];

  for (const recipient of recipients) {
    deliveries.push(await sendNoticeToUser(token, recipient, input, banner));
  }

  const { nexTechNotices } = await getMongoCollections();
  const notice: MongoNexTechNotice = {
    _id: randomUUID(),
    additionalInfo: normalizeOptionalText(input.additionalInfo),
    buttonLabel: normalizeOptionalText(input.buttonLabel),
    buttonUrl: normalizeOptionalText(input.buttonUrl),
    createdAt: new Date(),
    createdBy: input.createdBy,
    createdByName: input.createdByName ?? null,
    deliveries,
    highlight: normalizeOptionalText(input.highlight),
    message: input.message.trim(),
    title: input.title.trim()
  };

  await nexTechNotices.insertOne(notice);

  return toNoticeDto(notice);
}

export function markNexTechStartupNoticePending(botId: string) {
  const normalized = normalizeOptionalText(botId);
  if (normalized) {
    startupNoticePending.add(normalized);
  }
}

export function clearNexTechStartupNoticePending(botId: string) {
  const normalized = normalizeOptionalText(botId);
  if (normalized) {
    startupNoticePending.delete(normalized);
  }
}

export function consumeNexTechStartupNoticePending(botId: string) {
  const normalized = normalizeOptionalText(botId);
  if (!normalized || !startupNoticePending.has(normalized)) {
    return false;
  }

  startupNoticePending.delete(normalized);
  return true;
}

export async function sendNexTechStartupNotice(botId: string) {
  if (!consumeNexTechStartupNoticePending(botId)) {
    return null;
  }

  const { devBots } = await getMongoCollections();
  const bot = await devBots.findOne(
    { _id: botId },
    {
      projection: {
        billingRecipientUserIds: 1,
        name: 1,
        ownerId: 1,
        ownerName: 1
      }
    }
  );

  if (!bot) {
    return null;
  }

  const recipients = buildStartupRecipients(bot);
  if (!recipients.length) {
    return null;
  }

  const token = env.DISCORD_BOT_TOKEN.trim();
  if (!token) {
    return null;
  }

  const banner = await readFile(BANNER_PATH).catch(() => null);
  if (!banner) {
    return null;
  }

  const input: SendNexTechNoticeInput = {
    createdBy: botId,
    createdByName: bot.ownerName ?? bot.name,
    highlight: "Aviso automático de inicialização",
    message: `O bot **${bot.name}** voltou a ficar online.\nSe ele estava em manutenção, o aviso continua sendo enviado normalmente.`,
    title: `${bot.name} voltou online`
  };

  const deliveries: MongoNexTechNoticeDelivery[] = [];
  for (const recipient of recipients) {
    deliveries.push(await sendNoticeToUser(token, recipient, input, banner));
  }

  return {
    botId,
    botName: bot.name,
    deliveredCount: deliveries.filter((delivery) => delivery.status === "sent").length,
    deliveries,
    recipientCount: deliveries.length
  };
}

async function sendNoticeToUser(token: string, recipient: NexTechNoticeRecipient, input: SendNexTechNoticeInput, banner: Buffer): Promise<MongoNexTechNoticeDelivery> {
  try {
    const resolvedUserName = recipient.userName ?? await resolveDiscordUserNameById(token, recipient.userId);
    const dmChannel = await discordRequest<{ id: string; recipients?: Array<{ global_name?: string | null; username?: string | null }> }>(token, "/users/@me/channels", {
      body: JSON.stringify({ recipient_id: recipient.userId }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    const userName = resolveDiscordUserName(dmChannel.recipients?.[0]) ?? resolvedUserName;
    const form = new FormData();
    form.append("payload_json", JSON.stringify(buildNoticePayload(input)));
    form.append("files[0]", new Blob([new Uint8Array(banner)], { type: "image/png" }), BANNER_FILENAME);
    const message = await discordRequest<{ id: string }>(token, `/channels/${dmChannel.id}/messages`, {
      body: form,
      method: "POST"
    });

    return {
      channelId: dmChannel.id,
      error: null,
      messageId: message.id,
      status: "sent",
      userId: recipient.userId,
      userName
    };
  } catch (error) {
    return {
      channelId: null,
      error: error instanceof Error ? error.message : "Falha desconhecida ao enviar DM.",
      messageId: null,
      status: "failed",
      userId: recipient.userId,
      userName: recipient.userName ?? await resolveDiscordUserNameById(token, recipient.userId).catch(() => null)
    };
  }
}

function buildStartupRecipients(bot: Pick<{ billingRecipientUserIds?: string[]; name: string; ownerId: string; ownerName: string }, "billingRecipientUserIds" | "name" | "ownerId" | "ownerName">) {
  const recipientMap = new Map<string, NexTechNoticeRecipient>();
  const userIds = sanitizeDiscordIds([bot.ownerId, ...(bot.billingRecipientUserIds ?? [])]);

  for (const userId of userIds) {
    recipientMap.set(userId, {
      botCount: 1,
      botNames: [bot.name],
      userId,
      userName: userId === bot.ownerId ? bot.ownerName : null
    });
  }

  return [...recipientMap.values()];
}

export function buildNexTechNoticePayloadForTest(input: SendNexTechNoticeInput) {
  return buildNoticePayload(input);
}

function buildNoticePayload(input: SendNexTechNoticeInput) {
  const components: Array<Record<string, unknown>> = [
    {
      type: 10,
      content: `# ${input.title.trim()}`
    },
    {
      type: 14,
      divider: true,
      spacing: 1
    },
    {
      type: 12,
      items: [
        {
          media: {
            url: `attachment://${BANNER_FILENAME}`
          }
        }
      ]
    }
  ];
  const highlight = normalizeOptionalText(input.highlight);
  const additionalInfo = normalizeOptionalText(input.additionalInfo);
  const buttonLabel = normalizeOptionalText(input.buttonLabel);
  const buttonUrl = normalizeOptionalText(input.buttonUrl);

  if (highlight) {
    components.push({
      type: 10,
      content: `**${highlight}**`
    });
  }

  components.push({
    type: 10,
    content: quoteBlock(input.message.trim())
  });

  components.push({
    type: 14,
    divider: true,
    spacing: 1
  });

  if (buttonLabel && buttonUrl) {
    components.push({
      type: 1,
      components: [
        {
          type: 2,
          style: 5,
          label: buttonLabel,
          url: buttonUrl
        }
      ]
    });
  }

  if (additionalInfo) {
    components.push({
      type: 10,
      content: additionalInfo
    });
  }

  components.push({
    type: 10,
    content: "-# NexTech • Sistema de Avisos"
  }, {
    type: 14,
    divider: true,
    spacing: 1
  });

  return {
    allowed_mentions: {
      parse: []
    },
    attachments: [
      {
        description: "Banner Avisos NexTech",
        filename: BANNER_FILENAME,
        id: "0"
      }
    ],
    components: [
      {
        type: 17,
        accent_color: 0xffd500,
        components
      }
    ],
    flags: 32768
  };
}

function quoteBlock(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function resolveDiscordUserName(user: { global_name?: string | null; username?: string | null } | null | undefined) {
  return normalizeOptionalText(user?.global_name) ?? normalizeOptionalText(user?.username);
}

async function resolveDiscordUserNameById(token: string, userId: string) {
  return resolveDiscordUserName(await discordRequest<{ global_name?: string | null; username?: string | null }>(token, `/users/${userId}`, { method: "GET" }).catch(() => null));
}

async function discordRequest<T>(token: string, path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${DISCORD_API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bot ${token}`
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Discord HTTP ${response.status}${body ? `: ${body.slice(0, 240)}` : ""}`);
  }

  return await response.json() as T;
}

function toNoticeDto(notice: MongoNexTechNotice) {
  const deliveredCount = notice.deliveries.filter((delivery) => delivery.status === "sent").length;

  return {
    id: notice._id,
    additionalInfo: notice.additionalInfo,
    buttonLabel: notice.buttonLabel,
    buttonUrl: notice.buttonUrl,
    createdAt: notice.createdAt.toISOString(),
    createdBy: notice.createdBy,
    createdByName: notice.createdByName,
    deliveredCount,
    deliveries: notice.deliveries,
    failedCount: notice.deliveries.length - deliveredCount,
    highlight: notice.highlight,
    message: notice.message,
    recipientCount: notice.deliveries.length,
    title: notice.title
  };
}

function sanitizeDiscordIds(ids: string[]) {
  return [...new Set(ids.map((id) => id.trim()).filter((id) => /^\d{5,32}$/.test(id)))];
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized.length ? normalized : null;
}

function serviceError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

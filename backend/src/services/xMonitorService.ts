import { randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import { env } from "../config/env";
import { ensureGuild, getMongoCollections, type MongoXAccount, type MongoXPostSent } from "../database/mongo";
import { emitRealtime } from "../realtime/events";
import { createLog, type LogEntryDto } from "./logService";

export type XApiStatus = "idle" | "ok" | "error";

export type XAccountDto = {
  id: string;
  botId: string | null;
  guildId: string;
  channelId: string;
  xUserId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  active: boolean;
  lastSyncAt: string | null;
  lastPostId: string | null;
  lastPostAt: string | null;
  lastApiStatus: XApiStatus;
  lastApiError: string | null;
  totalPostsSent: number;
  createdAt: string;
  updatedAt: string;
};

export type XAccountPreviewDto = {
  xUserId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  mostRecentPostId: string | null;
};

export type XPostDto = {
  id: string;
  text: string;
  createdAt: string;
  url: string;
  mediaUrls: string[];
};

export type CreateXAccountInput = {
  active: boolean;
  botId?: string | null;
  channelId: string;
  userId?: string | null;
  username: string;
};

export type UpdateXAccountInput = Partial<Pick<CreateXAccountInput, "active" | "channelId" | "username">>;

export type RecordXPostSentInput = {
  channelId: string;
  discordMessageId?: string | null;
  xPostId: string;
  xPostUrl: string;
  xPostCreatedAt?: string | null;
};

type ServiceError = Error & {
  statusCode?: number;
};

type XApiUser = {
  id: string;
  name: string;
  username: string;
  profile_image_url?: string;
  protected?: boolean;
  most_recent_tweet_id?: string;
};

type XApiTweet = {
  attachments?: {
    media_keys?: string[];
  };
  author_id?: string;
  created_at?: string;
  id: string;
  text: string;
};

type XApiMedia = {
  media_key: string;
  preview_image_url?: string;
  type: string;
  url?: string;
};

type XApiResponse<TData> = {
  data?: TData;
  detail?: string;
  errors?: Array<{
    detail?: string;
    status?: number;
    title?: string;
  }>;
  includes?: {
    media?: XApiMedia[];
  };
  meta?: {
    newest_id?: string;
    result_count?: number;
  };
  status?: number | string;
  title?: string;
  type?: string;
};

const X_API_BASE_URL = "https://api.x.com/2";
const DEFAULT_PAGE_SIZE = 25;
const memoryAccounts = new Map<string, XAccountDto>();
const memoryPostsSent = new Map<string, MongoXPostSent>();

export async function verifyXAccount(usernameInput: string) {
  const username = normalizeUsername(usernameInput);
  const user = await fetchXUser(username);

  return toPreviewDto(user);
}

export async function getXMonitorDashboard(guildId: string, botId?: string | null) {
  const accounts = await listXAccounts(guildId, botId);
  const logs = await listXMonitorLogs(guildId, botId);

  return {
    accounts,
    logs
  };
}

export async function listXAccounts(guildId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);

  try {
    const { xAccounts } = await getMongoCollections();
    const accounts = await xAccounts
      .find(accountScopeQuery(guildId, normalizedBotId))
      .sort({
        createdAt: -1
      })
      .toArray();

    return Promise.all(accounts.map((account) => toAccountDto(account)));
  } catch {
    return [...memoryAccounts.values()]
      .filter((account) => account.guildId === guildId && account.botId === normalizedBotId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
}

export async function listActiveXAccounts(botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);

  try {
    const { xAccounts } = await getMongoCollections();
    const accounts = await xAccounts
      .find({
        ...accountBotScopeQuery(normalizedBotId),
        active: true
      })
      .sort({
        lastSyncAt: 1
      })
      .toArray();

    return Promise.all(accounts.map((account) => toAccountDto(account)));
  } catch {
    return [...memoryAccounts.values()].filter((account) => account.active && account.botId === normalizedBotId);
  }
}

export async function createXAccount(guildId: string, input: CreateXAccountInput) {
  const botId = normalizeBotId(input.botId);
  const channelId = normalizeSnowflake(input.channelId, "Canal");
  const preview = await verifyXAccount(input.username);
  const now = new Date();
  const doc: MongoXAccount = {
    _id: randomUUID(),
    active: input.active,
    avatar: preview.avatar,
    botId,
    channelId,
    createdAt: now,
    createdBy: input.userId ?? null,
    displayName: preview.displayName,
    guildId,
    lastApiError: null,
    lastApiStatus: "idle",
    lastPostAt: null,
    lastPostId: preview.mostRecentPostId,
    lastSyncAt: null,
    updatedAt: now,
    updatedBy: input.userId ?? null,
    username: preview.username.toLowerCase(),
    xUserId: preview.xUserId
  };

  try {
    await ensureGuild(guildId);
    const { xAccounts } = await getMongoCollections();
    await xAccounts.insertOne(doc);
  } catch (error) {
    if (isUniqueConstraint(error)) {
      throw createServiceError("Esta conta do X ja esta cadastrada neste servidor.", 409);
    }

    const dto = await toMemoryAccountDto(doc);
    memoryAccounts.set(dto.id, dto);
  }

  const dto = await toAccountDto(doc);
  await writeXLog("x_monitor.account_added", `Conta @${dto.username} adicionada ao X Monitor.`, dto, input.userId);
  emitXAccountUpdate(dto, "account_saved");

  return dto;
}

export async function updateXAccount(
  guildId: string,
  accountId: string,
  input: UpdateXAccountInput,
  userId?: string | null,
  botId?: string | null
) {
  const normalizedBotId = normalizeBotId(botId);
  const current = await findXAccountOrThrow(guildId, accountId, normalizedBotId);
  const patch = await buildAccountPatch(input, userId);

  try {
    const { xAccounts } = await getMongoCollections();
    const updated = await xAccounts.findOneAndUpdate(
      {
        _id: accountId,
        ...accountScopeQuery(guildId, normalizedBotId)
      },
      {
        $set: patch
      },
      {
        returnDocument: "after"
      }
    );

    if (!updated) {
      throw createServiceError("Conta do X nao encontrada.", 404);
    }

    const dto = await toAccountDto(updated);
    await writeXLog("x_monitor.account_updated", `Conta @${dto.username} atualizada no X Monitor.`, dto, userId);
    emitXAccountUpdate(dto, "account_saved");
    return dto;
  } catch (error) {
    if ((error as ServiceError).statusCode) {
      throw error;
    }

    if (isUniqueConstraint(error)) {
      throw createServiceError("Esta conta do X ja esta cadastrada neste servidor.", 409);
    }

    const updated: XAccountDto = {
      ...current,
      active: patch.active ?? current.active,
      avatar: patch.avatar ?? current.avatar,
      channelId: patch.channelId ?? current.channelId,
      displayName: patch.displayName ?? current.displayName,
      lastPostId: patch.lastPostId === undefined ? current.lastPostId : patch.lastPostId,
      updatedAt: new Date().toISOString(),
      username: patch.username ?? current.username,
      xUserId: patch.xUserId ?? current.xUserId
    };

    memoryAccounts.set(accountId, updated);
    await writeXLog("x_monitor.account_updated", `Conta @${updated.username} atualizada no X Monitor.`, updated, userId);
    emitXAccountUpdate(updated, "account_saved");
    return updated;
  }
}

export async function deleteXAccount(guildId: string, accountId: string, userId?: string | null, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const current = await findXAccountOrThrow(guildId, accountId, normalizedBotId);

  try {
    const { xAccounts, xPostsSent } = await getMongoCollections();
    await Promise.all([
      xAccounts.deleteOne({
        _id: accountId,
        ...accountScopeQuery(guildId, normalizedBotId)
      }),
      xPostsSent.deleteMany({
        accountId,
        ...postBotScopeQuery(normalizedBotId)
      })
    ]);
  } catch {
    memoryAccounts.delete(accountId);

    for (const [key, post] of memoryPostsSent) {
      if (post.accountId === accountId && normalizeBotId(post.botId) === normalizedBotId) {
        memoryPostsSent.delete(key);
      }
    }
  }

  await writeXLog("x_monitor.account_removed", `Conta @${current.username} removida do X Monitor.`, current, userId);
  emitXAccountUpdate(current, "account_removed");

  return current;
}

export async function syncXAccount(accountId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const account = await findXAccountByIdOrThrow(accountId, normalizedBotId);

  if (!account.active) {
    return {
      account,
      posts: []
    };
  }

  try {
    const posts = await fetchRecentPosts(account);
    await updateAccountApiState(account.id, normalizedBotId, {
      lastApiError: null,
      lastApiStatus: "ok",
      lastSyncAt: new Date()
    });

    if (!account.lastPostId && posts.length) {
      const latest = posts[posts.length - 1];

      if (latest) {
        await updateAccountApiState(account.id, normalizedBotId, {
          lastPostAt: new Date(latest.createdAt),
          lastPostId: latest.id
        });
      }

      const updated = await findXAccountByIdOrThrow(accountId, normalizedBotId);
      emitXAccountUpdate(updated, "sync");
      return {
        account: updated,
        posts: []
      };
    }

    const unsentPosts: XPostDto[] = [];

    for (const post of posts) {
      if (!(await isXPostSent(account.id, post.id, normalizedBotId))) {
        unsentPosts.push(post);
      }
    }

    const updated = await findXAccountByIdOrThrow(accountId, normalizedBotId);
    emitXAccountUpdate(updated, "sync");

    if (unsentPosts.length) {
      await writeXLog("x_monitor.post_detected", `Nova postagem detectada para @${account.username}.`, updated, null, {
        count: unsentPosts.length,
        postIds: unsentPosts.map((post) => post.id)
      });
    }

    return {
      account: updated,
      posts: unsentPosts
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao consultar API do X.";
    await updateAccountApiState(account.id, normalizedBotId, {
      lastApiError: message,
      lastApiStatus: "error",
      lastSyncAt: new Date()
    });
    const updated = await findXAccountByIdOrThrow(accountId, normalizedBotId).catch(() => account);
    await writeXLog("x_monitor.api_error", `Falha de API no X Monitor para @${account.username}: ${message}`, updated);
    emitXAccountUpdate(updated, "api_error");
    throw createServiceError(message, (error as ServiceError).statusCode ?? 502);
  }
}

export async function recordXPostSent(accountId: string, input: RecordXPostSentInput, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const account = await findXAccountByIdOrThrow(accountId, normalizedBotId);
  const now = new Date();
  const doc: MongoXPostSent = {
    _id: randomUUID(),
    accountId,
    botId: normalizedBotId,
    channelId: input.channelId,
    discordMessageId: input.discordMessageId ?? null,
    guildId: account.guildId,
    sentAt: now,
    xPostId: input.xPostId,
    xPostUrl: input.xPostUrl
  };

  try {
    const { xPostsSent } = await getMongoCollections();
    await xPostsSent.insertOne(doc);
  } catch (error) {
    if (!isUniqueConstraint(error)) {
      memoryPostsSent.set(postMemoryKey(normalizedBotId, accountId, input.xPostId), doc);
    }
  }

  await updateAccountApiState(accountId, normalizedBotId, {
    lastApiError: null,
    lastApiStatus: "ok",
    lastPostAt: input.xPostCreatedAt ? new Date(input.xPostCreatedAt) : now,
    lastPostId: input.xPostId
  });

  const updated = await findXAccountByIdOrThrow(accountId, normalizedBotId);
  await writeXLog("x_monitor.post_sent", `Postagem de @${updated.username} enviada ao Discord.`, updated, null, {
    channelId: input.channelId,
    discordMessageId: input.discordMessageId,
    xPostId: input.xPostId,
    xPostUrl: input.xPostUrl
  });
  emitXAccountUpdate(updated, "post_sent");

  return {
    account: updated,
    sent: toPostSentDto(doc)
  };
}

export async function markXAccountDiscordFailure(accountId: string, message: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const account = await findXAccountByIdOrThrow(accountId, normalizedBotId);

  await writeXLog("x_monitor.discord_error", `Falha ao enviar postagem de @${account.username}: ${message}`, account, null, {
    accountId,
    channelId: account.channelId
  });
  emitXAccountUpdate(account, "discord_error");

  return account;
}

export async function listXMonitorLogs(guildId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);

  try {
    const { logEntries } = await getMongoCollections();
    const logs = await logEntries
      .find({
        ...logScopeQuery(guildId, normalizedBotId),
        type: {
          $regex: "^x_monitor\\."
        }
      })
      .sort({
        createdAt: -1
      })
      .limit(50)
      .toArray();

    return logs.map((log) => ({
      id: log._id,
      botId: normalizeBotId(log.botId),
      guildId: log.guildId,
      userId: log.userId,
      type: log.type,
      message: log.message,
      metadata: log.metadata,
      createdAt: log.createdAt.toISOString()
    })) satisfies LogEntryDto[];
  } catch {
    return [];
  }
}

export function createServiceError(message: string, statusCode: number) {
  const error = new Error(message) as ServiceError;
  error.statusCode = statusCode;
  return error;
}

async function fetchXUser(username: string) {
  const params = new URLSearchParams({
    "user.fields": "id,name,username,profile_image_url,protected,most_recent_tweet_id"
  });
  const response = await xFetch<XApiResponse<XApiUser>>(`/users/by/username/${encodeURIComponent(username)}?${params.toString()}`);
  const user = response.data;

  if (!user) {
    throw createServiceError("Perfil do X nao encontrado.", 404);
  }

  if (user.protected) {
    throw createServiceError("Este perfil do X e protegido e nao pode ser monitorado pela API publica.", 400);
  }

  return user;
}

async function fetchRecentPosts(account: XAccountDto) {
  const params = new URLSearchParams({
    exclude: "retweets,replies",
    expansions: "attachments.media_keys",
    "media.fields": "url,preview_image_url,type",
    max_results: "5",
    "tweet.fields": "attachments,author_id,created_at,text"
  });

  if (account.lastPostId) {
    params.set("since_id", account.lastPostId);
  }

  const response = await xFetch<XApiResponse<XApiTweet[]>>(`/users/${encodeURIComponent(account.xUserId)}/tweets?${params.toString()}`);
  const mediaByKey = new Map((response.includes?.media ?? []).map((media) => [media.media_key, media]));
  const posts = (response.data ?? [])
    .map((tweet) => toPostDto(tweet, account.username, mediaByKey))
    .filter((post): post is XPostDto => Boolean(post))
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

  return posts;
}

async function xFetch<TResponse>(path: string) {
  const token = env.X_BEARER_TOKEN.trim();

  if (!token) {
    throw createServiceError("X_BEARER_TOKEN nao configurado no backend.", 503);
  }

  const response = await fetch(`${X_API_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  const data = (await response.json().catch(() => null)) as XApiResponse<unknown> | null;

  if (!response.ok) {
    throw createServiceError(formatXApiError(data, response.status), xApiHttpStatus(response.status));
  }

  if (data?.errors?.length && !data.data) {
    throw createServiceError(formatXApiError(data, 400), 400);
  }

  return data as TResponse;
}

function formatXApiError(data: XApiResponse<unknown> | null, fallbackStatus: number) {
  const title = data?.title?.trim();
  const detail = data?.detail?.trim();
  const type = data?.type?.trim();

  if (fallbackStatus === 402 || title === "CreditsDepleted" || type?.includes("/credits")) {
    return "Creditos da API do X esgotados. Recarregue/adquira creditos no portal do X ou configure outro X_BEARER_TOKEN com cota.";
  }

  if (fallbackStatus === 401) {
    return "X_BEARER_TOKEN invalido ou expirado. Gere um novo Bearer Token no portal do X.";
  }

  if (fallbackStatus === 403) {
    return "Seu plano/permissao da API do X nao permite essa consulta.";
  }

  const errors = data?.errors?.map((error) => error.detail || error.title).filter(Boolean).join(" ");
  const message = [detail, errors, title].filter(Boolean).join(" ");
  return message || `API do X respondeu ${fallbackStatus}.`;
}

function xApiHttpStatus(status: number) {
  if (status === 429 || status === 402) {
    return status;
  }

  return 502;
}

async function buildAccountPatch(input: UpdateXAccountInput, userId?: string | null): Promise<Partial<MongoXAccount>> {
  const patch: Partial<MongoXAccount> = {
    updatedAt: new Date(),
    updatedBy: userId ?? null
  };

  if (input.active !== undefined) {
    patch.active = input.active;
  }

  if (input.channelId !== undefined) {
    patch.channelId = normalizeSnowflake(input.channelId, "Canal");
  }

  if (input.username !== undefined) {
    const preview = await verifyXAccount(input.username);
    patch.avatar = preview.avatar;
    patch.displayName = preview.displayName;
    patch.lastPostId = preview.mostRecentPostId;
    patch.username = preview.username.toLowerCase();
    patch.xUserId = preview.xUserId;
  }

  return patch;
}

async function findXAccountOrThrow(guildId: string, accountId: string, botId: string | null) {
  const account = await findXAccountByIdOrThrow(accountId, botId);

  if (account.guildId !== guildId) {
    throw createServiceError("Conta do X nao encontrada.", 404);
  }

  return account;
}

async function findXAccountByIdOrThrow(accountId: string, botId: string | null) {
  try {
    const { xAccounts } = await getMongoCollections();
    const account = await xAccounts.findOne({
      _id: accountId,
      ...accountBotScopeQuery(botId)
    });

    if (!account) {
      throw createServiceError("Conta do X nao encontrada.", 404);
    }

    return toAccountDto(account);
  } catch (error) {
    if ((error as ServiceError).statusCode) {
      throw error;
    }

    const account = memoryAccounts.get(accountId);

    if (!account || account.botId !== botId) {
      throw createServiceError("Conta do X nao encontrada.", 404);
    }

    return account;
  }
}

async function updateAccountApiState(
  accountId: string,
  botId: string | null,
  patch: Partial<Pick<MongoXAccount, "lastApiError" | "lastApiStatus" | "lastPostAt" | "lastPostId" | "lastSyncAt">>
) {
  try {
    const { xAccounts } = await getMongoCollections();
    await xAccounts.updateOne(
      {
        _id: accountId,
        ...accountBotScopeQuery(botId)
      },
      {
        $set: {
          ...patch,
          updatedAt: new Date()
        }
      }
    );
  } catch {
    const current = memoryAccounts.get(accountId);

    if (!current || current.botId !== botId) {
      return;
    }

    memoryAccounts.set(accountId, {
      ...current,
      lastApiError: patch.lastApiError === undefined ? current.lastApiError : patch.lastApiError,
      lastApiStatus: patch.lastApiStatus === undefined ? current.lastApiStatus : patch.lastApiStatus,
      lastPostAt: patch.lastPostAt === undefined ? current.lastPostAt : patch.lastPostAt?.toISOString() ?? null,
      lastPostId: patch.lastPostId === undefined ? current.lastPostId : patch.lastPostId,
      lastSyncAt: patch.lastSyncAt === undefined ? current.lastSyncAt : patch.lastSyncAt?.toISOString() ?? null,
      updatedAt: new Date().toISOString()
    });
  }
}

async function isXPostSent(accountId: string, postId: string, botId: string | null) {
  try {
    const { xPostsSent } = await getMongoCollections();
    return Boolean(await xPostsSent.findOne({
      accountId,
      xPostId: postId,
      ...postBotScopeQuery(botId)
    }, {
      projection: {
        _id: 1
      }
    }));
  } catch {
    return memoryPostsSent.has(postMemoryKey(botId, accountId, postId));
  }
}

async function toAccountDto(account: MongoXAccount): Promise<XAccountDto> {
  return {
    id: account._id,
    active: account.active,
    avatar: account.avatar,
    botId: normalizeBotId(account.botId),
    channelId: account.channelId,
    createdAt: account.createdAt.toISOString(),
    displayName: account.displayName,
    guildId: account.guildId,
    lastApiError: account.lastApiError,
    lastApiStatus: account.lastApiStatus,
    lastPostAt: account.lastPostAt?.toISOString?.() ?? null,
    lastPostId: account.lastPostId,
    lastSyncAt: account.lastSyncAt?.toISOString?.() ?? null,
    totalPostsSent: await countPostsSent(account._id, normalizeBotId(account.botId)),
    updatedAt: account.updatedAt.toISOString(),
    username: account.username,
    xUserId: account.xUserId
  };
}

async function toMemoryAccountDto(account: MongoXAccount): Promise<XAccountDto> {
  return {
    id: account._id,
    active: account.active,
    avatar: account.avatar,
    botId: normalizeBotId(account.botId),
    channelId: account.channelId,
    createdAt: account.createdAt.toISOString(),
    displayName: account.displayName,
    guildId: account.guildId,
    lastApiError: account.lastApiError,
    lastApiStatus: account.lastApiStatus,
    lastPostAt: account.lastPostAt?.toISOString?.() ?? null,
    lastPostId: account.lastPostId,
    lastSyncAt: account.lastSyncAt?.toISOString?.() ?? null,
    totalPostsSent: memoryPostsSentCount(account._id, normalizeBotId(account.botId)),
    updatedAt: account.updatedAt.toISOString(),
    username: account.username,
    xUserId: account.xUserId
  };
}

function toPreviewDto(user: XApiUser): XAccountPreviewDto {
  return {
    avatar: user.profile_image_url ?? null,
    displayName: user.name,
    mostRecentPostId: user.most_recent_tweet_id ?? null,
    username: user.username,
    xUserId: user.id
  };
}

function toPostDto(tweet: XApiTweet, username: string, mediaByKey: Map<string, XApiMedia>) {
  if (!tweet.created_at) {
    return null;
  }

  const mediaUrls = (tweet.attachments?.media_keys ?? [])
    .map((key) => mediaByKey.get(key))
    .filter((media): media is XApiMedia => Boolean(media))
    .filter((media) => media.type === "photo" || media.url || media.preview_image_url)
    .map((media) => media.url || media.preview_image_url)
    .filter((url): url is string => Boolean(url));

  return {
    createdAt: tweet.created_at,
    id: tweet.id,
    mediaUrls,
    text: tweet.text,
    url: `https://x.com/${username}/status/${tweet.id}`
  };
}

function toPostSentDto(post: MongoXPostSent) {
  return {
    id: post._id,
    accountId: post.accountId,
    channelId: post.channelId,
    discordMessageId: post.discordMessageId,
    guildId: post.guildId,
    sentAt: post.sentAt.toISOString(),
    xPostId: post.xPostId,
    xPostUrl: post.xPostUrl
  };
}

async function countPostsSent(accountId: string, botId: string | null) {
  try {
    const { xPostsSent } = await getMongoCollections();
    return xPostsSent.countDocuments({
      accountId,
      ...postBotScopeQuery(botId)
    });
  } catch {
    return memoryPostsSentCount(accountId, botId);
  }
}

function memoryPostsSentCount(accountId: string, botId: string | null) {
  return [...memoryPostsSent.values()].filter((post) => post.accountId === accountId && normalizeBotId(post.botId) === botId).length;
}

async function writeXLog(
  type: string,
  message: string,
  account: Pick<XAccountDto, "botId" | "guildId" | "id" | "username">,
  userId?: string | null,
  metadata: Record<string, unknown> = {}
) {
  const log = await createLog({
    botId: account.botId,
    guildId: account.guildId,
    userId,
    type,
    message,
    metadata: {
      accountId: account.id,
      module: "x-monitor",
      username: account.username,
      ...metadata
    }
  }).catch(() => null);

  if (log) {
    emitRealtime("logs:new", log);
    emitRealtime("x-monitor:log", log);
  }
}

function emitXAccountUpdate(account: XAccountDto, action: string) {
  emitRealtime("x-monitor:update", {
    action,
    account,
    botId: account.botId,
    guildId: account.guildId
  });
}

function normalizeUsername(value: string) {
  const username = value.trim().replace(/^@+/, "");

  if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) {
    throw createServiceError("Informe um username do X valido, sem @.", 400);
  }

  return username;
}

function normalizeSnowflake(value: string, label: string) {
  const normalized = value.trim();

  if (!/^\d{5,32}$/.test(normalized)) {
    throw createServiceError(`${label} invalido.`, 400);
  }

  return normalized;
}

function normalizeBotId(botId: string | null | undefined) {
  const normalized = botId?.trim();
  return normalized ? normalized : null;
}

function isUniqueConstraint(error: unknown) {
  return error instanceof MongoServerError && error.code === 11000;
}

function accountScopeQuery(guildId: string, botId: string | null) {
  if (botId) {
    return {
      botId,
      guildId
    };
  }

  return {
    guildId,
    $or: [
      {
        botId: null
      },
      {
        botId: {
          $exists: false
        }
      }
    ]
  };
}

function accountBotScopeQuery(botId: string | null) {
  if (botId) {
    return {
      botId
    };
  }

  return {
    $or: [
      {
        botId: null
      },
      {
        botId: {
          $exists: false
        }
      }
    ]
  };
}

function postBotScopeQuery(botId: string | null) {
  if (botId) {
    return {
      botId
    };
  }

  return {
    $or: [
      {
        botId: null
      },
      {
        botId: {
          $exists: false
        }
      }
    ]
  };
}

function logScopeQuery(guildId: string, botId: string | null) {
  return {
    guildId,
    ...accountBotScopeQuery(botId)
  };
}

function postMemoryKey(botId: string | null, accountId: string, postId: string) {
  return `${botId ?? "default"}:${accountId}:${postId}`;
}

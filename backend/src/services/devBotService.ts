import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import axios from "axios";
import { isDashboardDevUserId } from "../config/devOwner";
import { env } from "../config/env";
import { getMongoCollections, type MongoBotGuildConfig, type MongoDevBot, type MongoDevBotStatus } from "../database/mongo";
import { emitRealtime } from "../realtime/events";
import type { AuthSessionUser } from "../types/session";
import { getDiscordAvatarUrl, getGuildIconUrl } from "./discordAssetService";
import { fetchDiscordCurrentUserGuildMember, refreshDiscordTokens } from "./discordOAuthService";
import { getPersistedDashboardAccess } from "./settingsService";
import { getStoredDiscordTokens, updateStoredDiscordTokens } from "./userService";

const DISCORD_API = "https://discord.com/api/v10";

export const DEV_MODULES = [
  { id: "live", label: "Sistema de Live" },
  { id: "clips", label: "Sistema de Clips" },
  { id: "network", label: "Rede Social dos Membros" },
  { id: "x-monitor", label: "X Monitor" },
  { id: "verification", label: "Sistema de Verificacao" },
  { id: "welcome", label: "Sistema de Boas-vindas" },
  { id: "leave", label: "Sistema de Saida" },
  { id: "logs", label: "Sistema de Logs" },
  { id: "roles", label: "Sistema de Cargos" },
  { id: "tickets", label: "Sistema de Tickets" },
  { id: "moderation", label: "Sistema de Moderacao" },
  { id: "avisos", label: "Mensagens e Personalizacao" }
] as const;

const DEV_MODULE_IDS = new Set(DEV_MODULES.map((module) => module.id));

type DiscordBotUser = {
  id: string;
  username: string;
  avatar: string | null;
};

type DiscordGuildDetails = {
  id: string;
  name: string;
  icon: string | null;
  owner_id: string;
  approximate_member_count?: number;
  approximate_presence_count?: number;
};

type DiscordGuildChannel = {
  id: string;
};

type DiscordRole = {
  id: string;
  permissions: string;
};

type DiscordGuildMember = {
  roles: string[];
};

type DetectedDiscordGuildRecord = DetectedDiscordGuild & {
  iconHash: string | null;
};

export type DetectedDiscordGuild = {
  id: string;
  name: string;
  iconUrl: string | null;
  ownerId: string;
  memberCount: number;
  onlineCount: number;
  channelCount: number;
  botId: string;
  botName: string;
  botAvatarUrl: string | null;
  botCreatedAt: string | null;
  hasAdministrator: boolean;
};

export type DevBotDto = {
  id: string;
  name: string;
  slug: string;
  dashboardUrl: string;
  clientId: string;
  tokenMasked: string;
  secretConfigured: boolean;
  avatarUrl: string | null;
  ownerId: string;
  ownerName: string;
  mainGuildId: string;
  mainGuildName: string;
  mainGuildIconUrl: string | null;
  mainGuildMemberCount: number;
  mainGuildChannelCount: number;
  botCreatedAt: string | null;
  guildIds: string[];
  status: MongoDevBotStatus;
  statusMessage: string | null;
  enabledModules: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type DashboardBotDto = Pick<
  DevBotDto,
  | "id"
  | "name"
  | "slug"
  | "dashboardUrl"
  | "clientId"
  | "avatarUrl"
  | "mainGuildId"
  | "mainGuildName"
  | "mainGuildIconUrl"
  | "mainGuildMemberCount"
  | "mainGuildChannelCount"
  | "botCreatedAt"
  | "guildIds"
  | "status"
  | "statusMessage"
  | "enabledModules"
>;

export type DevBotRuntimeConfig = {
  id: string;
  clientId: string;
  token: string;
  mainGuildId: string;
  enabledModules: string[];
};

type CreateDevBotInput = {
  token: string;
  ownerName: string;
  ownerId: string;
  mainGuildId: string;
  enabledModules?: string[];
  createdBy: string;
};

type UpdateDevBotInput = {
  name?: string | null;
  clientId?: string;
  token?: string;
  secret?: string | null;
  avatarUrl?: string | null;
  ownerName?: string;
  ownerId?: string;
  mainGuildId?: string;
  enabledModules?: string[];
};

type RegisterPrimaryDevBotInput = {
  name?: string | null;
  ownerName: string;
  ownerId: string;
  mainGuildId: string;
  enabledModules: string[];
  createdBy: string;
};

export type RegisterPrimaryDevBotResult = {
  bot: DevBotDto;
  created: boolean;
};

type EnsurePrimaryDevBotListedInput = {
  ownerName: string;
  ownerId: string;
  createdBy: string;
};

export async function listDevBots() {
  const { botGuildConfigs, devBots } = await getMongoCollections();
  const [bots, configs] = await Promise.all([
    devBots.find().sort({ createdAt: -1 }).toArray(),
    botGuildConfigs.find().toArray()
  ]);
  const guildIdsByBot = groupGuildIdsByBot(configs);

  return bots.map((bot) => toDevBotDto(bot, allBotGuildIds(bot, guildIdsByBot.get(bot._id))));
}

export async function listAccessibleDevBots(user: AuthSessionUser) {
  if (isDashboardDevUserId(user.discordId)) {
    return listDevBots();
  }

  const { botGuildConfigs, devBots } = await getMongoCollections();
  const [bots, configs] = await Promise.all([
    devBots.find().sort({ createdAt: -1 }).toArray(),
    botGuildConfigs.find().toArray()
  ]);
  const guildIdsByBot = groupGuildIdsByBot(configs);

  const accessibleBots = await Promise.all(bots.map(async (bot) => {
    const allGuildIds = allBotGuildIds(bot, guildIdsByBot.get(bot._id));
    const authorizedGuildIds = (
      await Promise.all(
        allGuildIds.map(async (guildId) => (await canAccessDevBotGuild(user, bot, guildId)) ? guildId : null)
      )
    ).filter((guildId): guildId is string => Boolean(guildId));

    return authorizedGuildIds.length ? toDevBotDto(bot, authorizedGuildIds) : null;
  }));

  return accessibleBots.filter((bot): bot is DevBotDto => Boolean(bot));
}

export async function listAccessibleDashboardBots(user: AuthSessionUser) {
  return (await listAccessibleDevBots(user)).map(toDashboardBotDto);
}

export async function userHasAccessibleDevBot(user: AuthSessionUser) {
  if (isDashboardDevUserId(user.discordId)) {
    return true;
  }

  return (await listAccessibleDevBots(user)).length > 0;
}

export async function getDevBot(botId: string) {
  const { botGuildConfigs, devBots } = await getMongoCollections();
  const [bot, configs] = await Promise.all([
    devBots.findOne({ _id: botId }),
    botGuildConfigs.find({ botId }).toArray()
  ]);

  return bot ? toDevBotDto(bot, allBotGuildIds(bot, configs.map((config) => config.guildId))) : null;
}

export async function getDevBotBySlug(slug: string) {
  const { botGuildConfigs, devBots } = await getMongoCollections();
  const normalizedSlug = slugifyBotName(slug);
  const bot = await devBots.findOne({ slug: normalizedSlug });

  if (!bot) {
    return null;
  }

  const configs = await botGuildConfigs.find({ botId: bot._id }).toArray();
  return toDevBotDto(bot, allBotGuildIds(bot, configs.map((config) => config.guildId)));
}

export async function getAccessibleDashboardBotBySlug(user: AuthSessionUser, slug: string) {
  const bot = await getDevBotBySlug(slug);

  if (!bot) {
    return null;
  }

  const accessibleBots = await listAccessibleDevBots(user);
  return accessibleBots.find((accessibleBot) => accessibleBot.id === bot.id) ?? null;
}

export async function findDevBotIdByClientId(clientId: string) {
  const { devBots } = await getMongoCollections();
  const bot = await devBots.findOne(
    {
      clientId
    },
    {
      projection: {
        _id: 1
      }
    }
  );

  return bot?._id ?? null;
}

export async function canManageDevBot(user: AuthSessionUser, botId: string) {
  if (isDashboardDevUserId(user.discordId)) {
    return true;
  }

  const { devBots } = await getMongoCollections();
  const bot = await devBots.findOne(
    {
      _id: botId,
      $or: [
        {
          ownerId: user.discordId
        },
        {
          createdBy: user.discordId
        }
      ]
    },
    {
      projection: {
        _id: 1
      }
    }
  );

  return Boolean(bot);
}

export async function canManageDevBotGuild(user: AuthSessionUser, botId: string | null, guildId: string) {
  if (!botId) {
    return false;
  }

  const { botGuildConfigs, devBots } = await getMongoCollections();
  const bot = await devBots.findOne({ _id: botId });

  if (!bot) {
    return false;
  }

  const botUsesGuild = bot.mainGuildId === guildId || Boolean(await botGuildConfigs.findOne(
    {
      botId,
      guildId
    },
    {
      projection: {
        _id: 1
      }
    }
  ));

  if (!botUsesGuild) {
    return false;
  }

  return canAccessDevBotGuild(user, bot, guildId);
}

export async function canUseDevBotModule(
  user: AuthSessionUser,
  botId: string | null,
  guildId: string,
  moduleId: string
) {
  if (!botId || !(await canManageDevBotGuild(user, botId, guildId))) {
    return false;
  }

  if (isDashboardDevUserId(user.discordId)) {
    return true;
  }

  const { devBots } = await getMongoCollections();
  const bot = await devBots.findOne(
    {
      _id: botId,
      enabledModules: moduleId
    },
    {
      projection: {
        _id: 1
      }
    }
  );

  return Boolean(bot);
}

export async function createDevBot(input: CreateDevBotInput) {
  const { botGuildConfigs, devBots, guilds } = await getMongoCollections();
  const now = new Date();
  const detectedGuild = await fetchDiscordBotGuild(input.token, input.mainGuildId);
  const clientId = detectedGuild.botId;
  const existingBot = await devBots.findOne(
    {
      clientId
    },
    {
      projection: {
        _id: 1
      }
    }
  );

  if (existingBot) {
    throw createDevBotError("Este Client ID ja esta cadastrado no sistema.", 409);
  }

  const botName = detectedGuild.botName || `Bot ${clientId}`;
  const bot: MongoDevBot = {
    _id: randomUUID(),
    name: botName,
    slug: await generateUniqueDevBotSlug(botName),
    clientId,
    tokenEncrypted: encryptSecret(input.token),
    tokenLast4: tokenLast4(input.token),
    secretEncrypted: null,
    avatarUrl: detectedGuild.botAvatarUrl,
    botCreatedAt: detectedGuild.botCreatedAt ? new Date(detectedGuild.botCreatedAt) : null,
    ownerId: input.ownerId,
    ownerName: input.ownerName,
    mainGuildId: input.mainGuildId,
    mainGuildName: detectedGuild.name,
    mainGuildIconUrl: detectedGuild.iconUrl,
    mainGuildMemberCount: detectedGuild.memberCount,
    mainGuildChannelCount: detectedGuild.channelCount,
    status: "offline",
    statusMessage: "Token validado. Aguardando inicializacao.",
    enabledModules: sanitizeModules(input.enabledModules ?? ["live"]),
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now
  };

  await devBots.insertOne(bot);
  await Promise.all([
    guilds.updateOne(
      {
        _id: detectedGuild.id
      },
      {
        $set: {
          name: detectedGuild.name,
          icon: detectedGuild.iconHash,
          ownerId: detectedGuild.ownerId,
          botEnabled: true,
          updatedAt: now
        },
        $setOnInsert: {
          _id: detectedGuild.id,
          createdAt: now
        }
      },
      {
        upsert: true
      }
    ),
    botGuildConfigs.updateOne(
      {
        botId: bot._id,
        guildId: detectedGuild.id
      },
      {
        $set: {
          guildName: detectedGuild.name,
          updatedAt: now
        },
        $setOnInsert: {
          _id: randomUUID(),
          botId: bot._id,
          guildId: detectedGuild.id,
          modules: {},
          createdAt: now
        }
      },
      {
        upsert: true
      }
    )
  ]);
  emitRealtime("dev:bot_created", toDashboardBotDto(toDevBotDto(bot)));

  return toDevBotDto(bot);
}

export async function registerPrimaryDevBot(input: RegisterPrimaryDevBotInput): Promise<RegisterPrimaryDevBotResult> {
  const token = env.DISCORD_BOT_TOKEN.trim();

  if (!token) {
    throw createDevBotError("DISCORD_BOT_TOKEN nao configurado no servidor.", 400);
  }

  const expectedClientId = env.DISCORD_CLIENT_ID.trim() || undefined;
  const connection = await testDiscordBotToken(token, expectedClientId);

  if (connection.status !== "online" || !connection.clientId) {
    throw createDevBotError(connection.message, 400);
  }

  const detectedGuild = await fetchDiscordBotGuild(token, input.mainGuildId);
  const existingBotId = await findDevBotIdByClientId(connection.clientId);

  if (!existingBotId) {
    const bot = await createDevBot({
      token,
      ownerName: input.ownerName,
      ownerId: input.ownerId,
      mainGuildId: input.mainGuildId,
      enabledModules: input.enabledModules,
      createdBy: input.createdBy
    });

    return {
      bot,
      created: true
    };
  }

  const { devBots } = await getMongoCollections();
  const current = await devBots.findOne({ _id: existingBotId });

  if (!current) {
    throw createDevBotError("Bot nao encontrado para atualizar.", 404);
  }

  const now = new Date();
  const nextName = input.name?.trim() || connection.username || current.name;
  const nextSlug = current.slug?.trim() || await generateUniqueDevBotSlug(nextName, existingBotId);

  await devBots.updateOne(
    {
      _id: existingBotId
    },
    {
      $set: {
        name: nextName,
        slug: nextSlug,
        clientId: connection.clientId,
        tokenEncrypted: encryptSecret(token),
        tokenLast4: tokenLast4(token),
        avatarUrl: connection.avatarUrl ?? current.avatarUrl,
        botCreatedAt: connection.createdAt ? new Date(connection.createdAt) : current.botCreatedAt ?? null,
        ownerId: input.ownerId,
        ownerName: input.ownerName,
        mainGuildId: input.mainGuildId,
        mainGuildName: detectedGuild.name,
        mainGuildIconUrl: detectedGuild.iconUrl,
        mainGuildMemberCount: detectedGuild.memberCount,
        mainGuildChannelCount: detectedGuild.channelCount,
        status: "offline",
        statusMessage: "Token validado. Aguardando reinicializacao.",
        enabledModules: sanitizeModules(input.enabledModules),
        updatedAt: now
      }
    }
  );
  await upsertDetectedGuildConfig(existingBotId, detectedGuild, now);

  const bot = await getDevBot(existingBotId);

  if (!bot) {
    throw createDevBotError("Bot nao encontrado depois da atualizacao.", 404);
  }

  emitRealtime("dev:bot_updated", toDashboardBotDto(bot));
  return {
    bot,
    created: false
  };
}

export async function ensurePrimaryDevBotListed(input: EnsurePrimaryDevBotListedInput): Promise<RegisterPrimaryDevBotResult | null> {
  const configuredClientId = env.DISCORD_CLIENT_ID.trim();

  if (configuredClientId) {
    const existingBotId = await findDevBotIdByClientId(configuredClientId);
    const existingBot = existingBotId ? await getDevBot(existingBotId) : null;

    if (existingBot) {
      return {
        bot: existingBot,
        created: false
      };
    }
  }

  const mainGuildId = firstConfiguredDashboardGuildId();

  if (!mainGuildId || !env.DISCORD_BOT_TOKEN.trim()) {
    return null;
  }

  const connection = await testDiscordBotToken(env.DISCORD_BOT_TOKEN, configuredClientId || undefined);

  if (connection.status !== "online" || !connection.clientId) {
    throw createDevBotError(connection.message, 400);
  }

  const existingBotId = await findDevBotIdByClientId(connection.clientId);
  const existingBot = existingBotId ? await getDevBot(existingBotId) : null;

  if (existingBot) {
    return {
      bot: existingBot,
      created: false
    };
  }

  return registerPrimaryDevBot({
    name: connection.username || "Bot do Ricardinho",
    ownerName: input.ownerName,
    ownerId: input.ownerId,
    mainGuildId,
    enabledModules: DEV_MODULES.map((module) => module.id),
    createdBy: input.createdBy
  });
}

export async function updateDevBot(botId: string, input: UpdateDevBotInput) {
  const { devBots } = await getMongoCollections();
  const current = await devBots.findOne({ _id: botId });

  if (!current) {
    return null;
  }

  const $set: Partial<MongoDevBot> = {
    updatedAt: new Date()
  };

  if (input.name !== undefined) $set.name = input.name?.trim() || current.name;
  if (!current.slug?.trim()) $set.slug = await generateUniqueDevBotSlug($set.name ?? current.name, botId);
  if (input.clientId !== undefined) $set.clientId = input.clientId;
  if (input.secret !== undefined) $set.secretEncrypted = input.secret ? encryptSecret(input.secret) : null;
  if (input.avatarUrl !== undefined) $set.avatarUrl = input.avatarUrl;
  if (input.ownerName !== undefined) $set.ownerName = input.ownerName;
  if (input.ownerId !== undefined) $set.ownerId = input.ownerId;
  if (input.mainGuildId !== undefined) $set.mainGuildId = input.mainGuildId;
  if (input.enabledModules !== undefined) $set.enabledModules = sanitizeModules(input.enabledModules);

  if (input.token) {
    const connection = await testDiscordBotToken(input.token, input.clientId ?? current.clientId);

    if (connection.status !== "online") {
      throw createDevBotError(connection.message, 400);
    }

    $set.tokenEncrypted = encryptSecret(input.token);
    $set.tokenLast4 = tokenLast4(input.token);
    $set.status = connection.status === "online" ? "offline" : connection.status;
    $set.statusMessage = connection.status === "online" ? "Token atualizado. Aguardando reinicializacao." : connection.message;
    $set.avatarUrl = input.avatarUrl || connection.avatarUrl || current.avatarUrl;
    $set.botCreatedAt = connection.createdAt ? new Date(connection.createdAt) : current.botCreatedAt ?? null;
  }

  await devBots.updateOne({ _id: botId }, { $set });
  const updated = await devBots.findOne({ _id: botId });

  if (!updated) {
    return null;
  }

  emitRealtime("dev:bot_updated", toDashboardBotDto(toDevBotDto(updated)));
  return toDevBotDto(updated);
}

export async function deleteDevBot(botId: string) {
  const { botGuildConfigs, devBots } = await getMongoCollections();
  const bot = await devBots.findOne({ _id: botId });

  if (!bot) {
    return null;
  }

  await Promise.all([
    devBots.deleteOne({ _id: botId }),
    botGuildConfigs.deleteMany({ botId })
  ]);

  const dto = toDevBotDto(bot);
  emitRealtime("dev:bot_deleted", toDashboardBotDto(dto));
  return dto;
}

export async function updateDevBotModules(botId: string, enabledModules: string[]) {
  const bot = await updateDevBot(botId, {
    enabledModules
  });

  if (bot) {
    emitRealtime("dev:module_updated", {
      type: "MODULE_UPDATED",
      botId,
      enabledModules: bot.enabledModules
    });
  }

  return bot;
}

export async function validateDevBotConnection(botId: string) {
  const { devBots } = await getMongoCollections();
  const bot = await devBots.findOne({ _id: botId });

  if (!bot) {
    return null;
  }

  const connection = await testDiscordBotToken(decryptSecret(bot.tokenEncrypted), bot.clientId);

  await devBots.updateOne(
    { _id: botId },
    {
      $set: {
        status: connection.status === "online" ? "offline" : connection.status,
        statusMessage: connection.status === "online" ? "Token validado. Reiniciando processo." : connection.message,
        avatarUrl: connection.avatarUrl ?? bot.avatarUrl,
        updatedAt: new Date()
      }
    }
  );

  const updated = await devBots.findOne({ _id: botId });
  const dto = updated ? toDevBotDto(updated) : toDevBotDto(bot);
  emitRealtime("dev:bot_restarted", toDashboardBotDto(dto));

  return dto;
}

async function testDiscordBotTokenForClient(token: string, expectedClientId?: string) {
  if (!token.trim()) {
    return {
      status: "invalid_token" as const,
      message: "Token invalido.",
      avatarUrl: null,
      clientId: null,
      botId: null,
      username: null,
      createdAt: null
    };
  }

  try {
    const { data } = await axios.get<DiscordBotUser>(`${DISCORD_API}/users/@me`, {
      headers: {
        Authorization: `Bot ${token.trim()}`
      },
      timeout: 3500
    });

    if (expectedClientId && data.id !== expectedClientId) {
      return {
        status: "invalid_token" as const,
        message: `O token pertence ao Client ID ${data.id}, nao ao Client ID informado.`,
        avatarUrl: getDiscordAvatarUrl(data.id, data.avatar, "bot"),
        clientId: data.id,
        botId: data.id,
        username: data.username,
        createdAt: snowflakeDate(data.id)?.toISOString() ?? null
      };
    }

    return {
      status: "online" as const,
      message: `Bot conectado como ${data.username}.`,
      avatarUrl: getDiscordAvatarUrl(data.id, data.avatar, "bot"),
      clientId: data.id,
      botId: data.id,
      username: data.username,
      createdAt: snowflakeDate(data.id)?.toISOString() ?? null
    };
  } catch (error) {
    const status = axios.isAxiosError(error) && error.response?.status === 401 ? "invalid_token" : "error";

    return {
      status: status as MongoDevBotStatus,
      message: status === "invalid_token" ? "Token invalido. Verifique os dados do bot." : "Erro ao conectar com a API do Discord.",
      avatarUrl: null,
      clientId: null,
      botId: null,
      username: null,
      createdAt: null
    };
  }
}

async function generateUniqueDevBotSlug(name: string, excludedBotId?: string) {
  const { devBots } = await getMongoCollections();
  const baseSlug = slugifyBotName(name);
  let slug = baseSlug;
  let suffix = 2;

  while (await devBots.findOne(
    excludedBotId
      ? {
          slug,
          _id: {
            $ne: excludedBotId
          }
        }
      : {
          slug
        },
    {
      projection: {
        _id: 1
      }
    }
  )) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return slug;
}

function slugifyBotName(value: string) {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return slug || "bot";
}

function buildDashboardUrl(slug: string) {
  const origin = env.SITE_ORIGIN || env.FRONTEND_URL;
  const path = `/dashboard/${slug}`;

  return origin ? `${origin}${path}` : path;
}

export async function testDiscordBotToken(token: string, expectedClientId?: string) {
  return testDiscordBotTokenForClient(token, expectedClientId);
}

export async function detectDiscordBotGuild(token: string, guildId: string): Promise<DetectedDiscordGuild> {
  const guild = await fetchDiscordBotGuild(token, guildId);

  return {
    id: guild.id,
    name: guild.name,
    iconUrl: guild.iconUrl,
    ownerId: guild.ownerId,
    memberCount: guild.memberCount,
    onlineCount: guild.onlineCount,
    channelCount: guild.channelCount,
    botId: guild.botId,
    botName: guild.botName,
    botAvatarUrl: guild.botAvatarUrl,
    botCreatedAt: guild.botCreatedAt,
    hasAdministrator: guild.hasAdministrator
  };
}

export async function listDevBotRuntimeConfigs() {
  const { devBots } = await getMongoCollections();
  const bots = await devBots.find().toArray();

  return bots.map(toDevBotRuntimeConfig);
}

export async function listGuildBotRuntimeConfigs(guildId: string) {
  const { botGuildConfigs, devBots } = await getMongoCollections();
  const configs = await botGuildConfigs.find({ guildId }).toArray();
  const configuredBotIds = configs.map((config) => config.botId);
  const bots = await devBots.find({
    $or: [
      {
        mainGuildId: guildId
      },
      {
        _id: {
          $in: configuredBotIds
        }
      }
    ]
  }).toArray();

  return bots.map(toDevBotRuntimeConfig);
}

export async function getDevBotRuntimeConfig(botId: string) {
  const { devBots } = await getMongoCollections();
  const bot = await devBots.findOne({ _id: botId });

  return bot ? toDevBotRuntimeConfig(bot) : null;
}

export async function getDevBotToken(botId: string | null | undefined) {
  if (!botId) {
    return null;
  }

  return (await getDevBotRuntimeConfig(botId))?.token ?? null;
}

export async function updateDevBotRuntimeStatus(botId: string, status: MongoDevBotStatus, statusMessage: string) {
  const { devBots } = await getMongoCollections();

  await devBots.updateOne(
    {
      _id: botId
    },
    {
      $set: {
        status,
        statusMessage,
        updatedAt: new Date()
      }
    }
  );

  const bot = await getDevBot(botId);

  if (bot) {
    emitRealtime("dev:bot_updated", toDashboardBotDto(bot));
  }

  return bot;
}

export async function syncDevBotGuilds(botId: string, guilds: Array<{ id: string; name: string }>) {
  const { botGuildConfigs, devBots } = await getMongoCollections();
  const bot = await devBots.findOne(
    {
      _id: botId
    },
    {
      projection: {
        mainGuildId: 1
      }
    }
  );

  if (!bot) {
    return;
  }

  const now = new Date();
  const uniqueGuilds = [...new Map(guilds.map((guild) => [guild.id, guild])).values()];

  if (uniqueGuilds.length) {
    await botGuildConfigs.bulkWrite(
      uniqueGuilds.map((guild) => ({
        updateOne: {
          filter: {
            botId,
            guildId: guild.id
          },
          update: {
            $set: {
              guildName: guild.name,
              updatedAt: now
            },
            $setOnInsert: {
              _id: randomUUID(),
              botId,
              guildId: guild.id,
              modules: {},
              createdAt: now
            }
          },
          upsert: true
        }
      }))
    );
  }

  const retainedGuildIds = [...new Set([bot.mainGuildId, ...uniqueGuilds.map((guild) => guild.id)])];
  await botGuildConfigs.deleteMany({
    botId,
    guildId: {
      $nin: retainedGuildIds
    }
  });
}

export async function listBotGuildConfigs(botId: string) {
  const { botGuildConfigs } = await getMongoCollections();
  const configs = await botGuildConfigs.find({ botId }).sort({ updatedAt: -1 }).toArray();

  return configs.map(toBotGuildConfigDto);
}

export async function getBotGuildConfig(botId: string, guildId: string) {
  const { botGuildConfigs } = await getMongoCollections();
  const config = await botGuildConfigs.findOne({ botId, guildId });

  return config ? toBotGuildConfigDto(config) : defaultBotGuildConfig(botId, guildId);
}

export async function updateBotGuildConfig(input: {
  botId: string;
  guildId: string;
  guildName: string;
  modules: Record<string, Record<string, unknown>>;
}) {
  const { botGuildConfigs } = await getMongoCollections();
  const now = new Date();

  await botGuildConfigs.updateOne(
    {
      botId: input.botId,
      guildId: input.guildId
    },
    {
      $set: {
        guildName: input.guildName,
        modules: input.modules,
        updatedAt: now
      },
      $setOnInsert: {
        _id: randomUUID(),
        botId: input.botId,
        guildId: input.guildId,
        createdAt: now
      }
    },
    {
      upsert: true
    }
  );

  const config = await botGuildConfigs.findOne({
    botId: input.botId,
    guildId: input.guildId
  });
  const dto = config ? toBotGuildConfigDto(config) : defaultBotGuildConfig(input.botId, input.guildId);

  emitRealtime("dev:config_updated", {
    type: "CONFIG_UPDATED",
    botId: input.botId,
    guildId: input.guildId
  });

  return dto;
}

export async function getBotApiPermissions(botId: string) {
  const bot = await getDevBot(botId);

  if (!bot) {
    return null;
  }

  return {
    botId: bot.id,
    enabledModules: sanitizeModules(bot.enabledModules),
    status: bot.status
  };
}

function sanitizeModules(modules: string[]) {
  return [...new Set(modules.filter((module) => DEV_MODULE_IDS.has(module as (typeof DEV_MODULES)[number]["id"])))];
}

function toDevBotDto(bot: MongoDevBot, guildIds: string[] = [bot.mainGuildId]): DevBotDto {
  const slug = bot.slug || slugifyBotName(bot.name);

  return {
    id: bot._id,
    name: bot.name,
    slug,
    dashboardUrl: buildDashboardUrl(slug),
    clientId: bot.clientId,
    tokenMasked: bot.tokenEncrypted ? maskedToken(bot) : "",
    secretConfigured: Boolean(bot.secretEncrypted),
    avatarUrl: bot.avatarUrl ?? null,
    ownerId: bot.ownerId,
    ownerName: bot.ownerName,
    mainGuildId: bot.mainGuildId,
    mainGuildName: bot.mainGuildName ?? `Servidor ${bot.mainGuildId}`,
    mainGuildIconUrl: bot.mainGuildIconUrl ?? null,
    mainGuildMemberCount: bot.mainGuildMemberCount ?? 0,
    mainGuildChannelCount: bot.mainGuildChannelCount ?? 0,
    botCreatedAt: bot.botCreatedAt?.toISOString?.() ?? null,
    guildIds: [...new Set(guildIds)],
    status: bot.status,
    statusMessage: bot.statusMessage ?? null,
    enabledModules: sanitizeModules(bot.enabledModules),
    createdBy: bot.createdBy,
    createdAt: bot.createdAt.toISOString(),
    updatedAt: bot.updatedAt.toISOString()
  };
}

async function fetchDiscordBotGuild(token: string, guildId: string): Promise<DetectedDiscordGuildRecord> {
  if (!token.trim()) {
    throw createDevBotError("Informe o token do bot para detectar o servidor.", 400);
  }

  try {
    const { data: botUser } = await axios.get<DiscordBotUser>(`${DISCORD_API}/users/@me`, {
      headers: {
        Authorization: `Bot ${token.trim()}`
      },
      timeout: 3500
    });
    const [{ data: guild }, { data: channels }, { data: roles }, { data: botMember }] = await Promise.all([
      axios.get<DiscordGuildDetails>(`${DISCORD_API}/guilds/${guildId}`, {
        headers: {
          Authorization: `Bot ${token.trim()}`
        },
        params: {
          with_counts: true
        },
        timeout: 5000
      }),
      axios.get<DiscordGuildChannel[]>(`${DISCORD_API}/guilds/${guildId}/channels`, {
        headers: {
          Authorization: `Bot ${token.trim()}`
        },
        timeout: 5000
      }),
      axios.get<DiscordRole[]>(`${DISCORD_API}/guilds/${guildId}/roles`, {
        headers: {
          Authorization: `Bot ${token.trim()}`
        },
        timeout: 5000
      }),
      axios.get<DiscordGuildMember>(`${DISCORD_API}/guilds/${guildId}/members/${botUser.id}`, {
        headers: {
          Authorization: `Bot ${token.trim()}`
        },
        timeout: 5000
      })
    ]);
    const botRoleIds = new Set([guildId, ...botMember.roles]);
    const botPermissions = roles
      .filter((role) => botRoleIds.has(role.id))
      .reduce((permissions, role) => permissions | parsePermissions(role.permissions), 0n);
    const hasAdministrator = (botPermissions & 0x8n) === 0x8n;

    if (!hasAdministrator) {
      throw createDevBotError("O bot precisa estar no servidor com permissao de Administrador para liberar o painel completo.", 400);
    }

    return {
      id: guild.id,
      name: guild.name,
      iconHash: guild.icon,
      iconUrl: getGuildIconUrl(guild.id, guild.icon),
      ownerId: guild.owner_id,
      memberCount: guild.approximate_member_count ?? 0,
      onlineCount: guild.approximate_presence_count ?? 0,
      channelCount: channels.length,
      botId: botUser.id,
      botName: botUser.username,
      botAvatarUrl: getDiscordAvatarUrl(botUser.id, botUser.avatar, "bot"),
      botCreatedAt: snowflakeDate(botUser.id)?.toISOString() ?? null,
      hasAdministrator
    };
  } catch (error) {
    if (isDevBotError(error)) {
      throw error;
    }

    if (axios.isAxiosError(error)) {
      if (error.response?.status === 401) {
        throw createDevBotError("Token do bot invalido.", 400);
      }

      if (error.response?.status === 403 || error.response?.status === 404) {
        throw createDevBotError("O bot nao esta no servidor informado ou nao consegue acessar os dados dele.", 400);
      }
    }

    throw createDevBotError("Nao foi possivel detectar o servidor no Discord.", 502);
  }
}

function toDevBotRuntimeConfig(bot: MongoDevBot): DevBotRuntimeConfig {
  return {
    id: bot._id,
    clientId: bot.clientId,
    token: decryptSecret(bot.tokenEncrypted),
    mainGuildId: bot.mainGuildId,
    enabledModules: sanitizeModules(bot.enabledModules)
  };
}

function toDashboardBotDto(bot: DevBotDto): DashboardBotDto {
  return {
    id: bot.id,
    name: bot.name,
    slug: bot.slug,
    dashboardUrl: bot.dashboardUrl,
    clientId: bot.clientId,
    avatarUrl: bot.avatarUrl,
    mainGuildId: bot.mainGuildId,
    mainGuildName: bot.mainGuildName,
    mainGuildIconUrl: bot.mainGuildIconUrl,
    mainGuildMemberCount: bot.mainGuildMemberCount,
    mainGuildChannelCount: bot.mainGuildChannelCount,
    botCreatedAt: bot.botCreatedAt,
    guildIds: bot.guildIds,
    status: bot.status,
    statusMessage: bot.statusMessage,
    enabledModules: bot.enabledModules
  };
}

function toBotGuildConfigDto(config: MongoBotGuildConfig) {
  return {
    id: config._id,
    botId: config.botId,
    guildId: config.guildId,
    guildName: config.guildName,
    modules: config.modules,
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString()
  };
}

function defaultBotGuildConfig(botId: string, guildId: string) {
  const now = new Date().toISOString();

  return {
    id: "",
    botId,
    guildId,
    guildName: `Servidor ${guildId}`,
    modules: {},
    createdAt: now,
    updatedAt: now
  };
}

async function upsertDetectedGuildConfig(botId: string, detectedGuild: DetectedDiscordGuildRecord, now = new Date()) {
  const { botGuildConfigs, guilds } = await getMongoCollections();

  await Promise.all([
    guilds.updateOne(
      {
        _id: detectedGuild.id
      },
      {
        $set: {
          name: detectedGuild.name,
          icon: detectedGuild.iconHash,
          ownerId: detectedGuild.ownerId,
          botEnabled: true,
          updatedAt: now
        },
        $setOnInsert: {
          _id: detectedGuild.id,
          createdAt: now
        }
      },
      {
        upsert: true
      }
    ),
    botGuildConfigs.updateOne(
      {
        botId,
        guildId: detectedGuild.id
      },
      {
        $set: {
          guildName: detectedGuild.name,
          updatedAt: now
        },
        $setOnInsert: {
          _id: randomUUID(),
          botId,
          guildId: detectedGuild.id,
          modules: {},
          createdAt: now
        }
      },
      {
        upsert: true
      }
    )
  ]);
}

function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptSecret(value: string) {
  const [ivValue, tagValue, encryptedValue] = value.split(".");

  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("Token protegido invalido.");
  }

  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function encryptionKey() {
  return createHash("sha256").update(env.JWT_SECRET || env.SESSION_SECRET).digest();
}

function createDevBotError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}

function isDevBotError(error: unknown): error is Error & { statusCode: number } {
  return error instanceof Error && typeof (error as { statusCode?: unknown }).statusCode === "number";
}

function tokenLast4(token: string) {
  return token.trim().slice(-4) || null;
}

function maskedToken(bot: Pick<MongoDevBot, "tokenEncrypted" | "tokenLast4">) {
  const last4 = bot.tokenLast4 ?? decryptTokenLast4(bot.tokenEncrypted);

  return last4 ? `${"*".repeat(28)}${last4}` : "******** protegido";
}

function decryptTokenLast4(tokenEncrypted: string) {
  try {
    return decryptSecret(tokenEncrypted).slice(-4);
  } catch {
    return null;
  }
}

function snowflakeDate(id: string) {
  try {
    return new Date(Number((BigInt(id) >> 22n) + 1420070400000n));
  } catch {
    return null;
  }
}

function parsePermissions(value: string) {
  try {
    return BigInt(value || "0");
  } catch {
    return 0n;
  }
}

function firstConfiguredDashboardGuildId() {
  return env.DASHBOARD_GUILD_IDS.split(",")
    .map((guildId) => guildId.trim())
    .find(Boolean) ?? null;
}

async function canAccessDevBotGuild(user: AuthSessionUser, bot: MongoDevBot, guildId: string) {
  const { botGuildConfigs } = await getMongoCollections();
  const botUsesGuild = bot.mainGuildId === guildId || Boolean(await botGuildConfigs.findOne(
    {
      botId: bot._id,
      guildId
    },
    {
      projection: {
        _id: 1
      }
    }
  ));

  if (!botUsesGuild) {
    return false;
  }

  if (isDashboardDevUserId(user.discordId)) {
    return true;
  }

  return hasConfiguredPanelRole(user.discordId, bot, guildId);
}

async function hasConfiguredPanelRole(userId: string, bot: MongoDevBot, guildId: string) {
  const access = await getPersistedDashboardAccess(guildId, bot._id).catch((error) => {
    console.warn(
      `[access] nao foi possivel ler cargos persistidos do bot ${bot._id} no servidor ${guildId}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  });

  if (!access?.enabled || !access.roleIds.length) {
    return false;
  }

  const memberRoleIds = await getDashboardMemberRoleIds(userId, bot, guildId);

  if (!memberRoleIds) {
    return false;
  }

  return access.roleIds.some((roleId) => memberRoleIds.has(roleId));
}

async function getDashboardMemberRoleIds(userId: string, bot: MongoDevBot, guildId: string) {
  const botRoleIds = await fetchBotGuildMemberRoleIds(userId, bot, guildId);

  if (botRoleIds) {
    return botRoleIds;
  }

  return fetchOAuthGuildMemberRoleIds(userId, guildId);
}

async function fetchBotGuildMemberRoleIds(userId: string, bot: MongoDevBot, guildId: string) {
  const token = decryptSecret(bot.tokenEncrypted);

  try {
    const { data: member } = await axios.get<DiscordGuildMember>(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
      headers: {
        Authorization: `Bot ${token}`
      },
      timeout: 5000
    });
    const memberRoleIds = new Set(member.roles);
    memberRoleIds.add(guildId);

    return memberRoleIds;
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status ?? null : null;

    if (status === 403 || status === 404) {
      console.warn(
        `[discord] bot ${bot._id} nao conseguiu ler o membro ${userId} no servidor ${guildId} (HTTP ${status}). Tentando OAuth do usuario.`
      );
    } else {
      console.warn(
        `[discord] nao foi possivel validar cargo do painel em ${guildId}:`,
        error instanceof Error ? error.message : error
      );
    }

    return null;
  }
}

async function fetchOAuthGuildMemberRoleIds(userId: string, guildId: string) {
  const tokens = await getStoredDiscordTokens(userId);

  if (!tokens?.accessToken) {
    console.warn(`[access] usuario ${userId} precisa entrar novamente pelo Discord para validar cargos do servidor ${guildId}.`);
    return null;
  }

  const firstLookup = await fetchOAuthGuildMemberRoleIdsWithToken(tokens.accessToken, guildId);

  if (firstLookup.roleIds || firstLookup.status !== 401 || !tokens.refreshToken) {
    return firstLookup.roleIds;
  }

  try {
    const refreshedTokens = await refreshDiscordTokens(tokens.refreshToken);
    await updateStoredDiscordTokens(userId, refreshedTokens);
    return (await fetchOAuthGuildMemberRoleIdsWithToken(refreshedTokens.access_token, guildId)).roleIds;
  } catch (error) {
    console.warn(
      `[discord] nao foi possivel renovar OAuth do usuario ${userId} para validar cargos:`,
      readDiscordErrorMessage(error)
    );
    return null;
  }
}

async function fetchOAuthGuildMemberRoleIdsWithToken(accessToken: string, guildId: string) {
  try {
    const member = await fetchDiscordCurrentUserGuildMember(accessToken, guildId);
    const memberRoleIds = new Set(member.roles ?? []);
    memberRoleIds.add(guildId);

    return {
      roleIds: memberRoleIds,
      status: null
    };
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status ?? null : null;

    if (status === 403) {
      console.warn(`[discord] OAuth sem permissao guilds.members.read para validar cargos do servidor ${guildId}.`);
    } else if (status === 404) {
      console.warn(`[discord] usuario OAuth nao encontrado como membro do servidor ${guildId}.`);
    } else if (status !== 401) {
      console.warn(
        `[discord] nao foi possivel validar cargo via OAuth no servidor ${guildId}:`,
        readDiscordErrorMessage(error)
      );
    }

    return {
      roleIds: null,
      status
    };
  }
}

function readDiscordErrorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    const responseMessage = error.response?.data;

    if (
      responseMessage &&
      typeof responseMessage === "object" &&
      "message" in responseMessage &&
      typeof responseMessage.message === "string"
    ) {
      return `HTTP ${error.response?.status ?? "?"}: ${responseMessage.message}`;
    }

    return error.response?.status ? `HTTP ${error.response.status}: ${error.message}` : error.message;
  }

  return error instanceof Error ? error.message : error;
}

function groupGuildIdsByBot(configs: MongoBotGuildConfig[]) {
  const guildIdsByBot = new Map<string, string[]>();

  for (const config of configs) {
    const guildIds = guildIdsByBot.get(config.botId) ?? [];
    guildIds.push(config.guildId);
    guildIdsByBot.set(config.botId, guildIds);
  }

  return guildIdsByBot;
}

function allBotGuildIds(bot: MongoDevBot, configuredGuildIds: string[] = []) {
  return [...new Set([bot.mainGuildId, ...configuredGuildIds])];
}

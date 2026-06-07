import { randomUUID } from "node:crypto";
import { ensureGuild, getMongoCollections, type MongoSocialMember, type MongoSocialPanel } from "../database/mongo";
import { emitRealtime } from "../realtime/events";
import { createLog } from "./logService";

export const SOCIAL_PLATFORMS = [
  "twitter",
  "instagram",
  "twitch",
  "youtube",
  "tiktok",
  "kick",
  "facebook",
  "website"
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export type SocialLinks = Record<SocialPlatform, string>;

export type SocialMemberDto = {
  id: string;
  botId: string | null;
  guildId: string;
  userId: string | null;
  discordId: string | null;
  name: string;
  avatar: string | null;
  role: string | null;
  links: SocialLinks;
  createdAt: string;
  updatedAt: string;
};

export type SocialPanelDto = {
  id: string;
  botId: string | null;
  guildId: string;
  channelId: string | null;
  messageId: string | null;
  embedColor: string;
  published: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
  lastPublishedAt: string | null;
};

export type SocialPanelPayload = {
  members: SocialMemberDto[];
  panel: SocialPanelDto;
};

export type CreateSocialMemberInput = {
  actorId?: string | null;
  avatar?: string | null;
  botId?: string | null;
  discordId?: string | null;
  links?: Partial<Record<SocialPlatform, string | null | undefined>>;
  name: string;
  role?: string | null;
  userId?: string | null;
};

export type UpdateSocialMemberInput = Partial<Omit<CreateSocialMemberInput, "actorId" | "botId" | "userId">>;

export type SaveSocialPanelInput = {
  channelId: string;
  embedColor?: string | null;
  userId?: string | null;
};

export type UpdateSocialPanelStateInput = {
  messageId?: string | null;
  published?: boolean;
};

type ServiceError = Error & {
  statusCode?: number;
};

const DEFAULT_EMBED_COLOR = "#00D4FF";
const SOCIAL_MEMBER_LIMIT = 200;
const memoryMembers = new Map<string, SocialMemberDto>();
const memoryPanels = new Map<string, SocialPanelDto>();

export async function getSocialNetwork(guildId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const [members, panel] = await Promise.all([
    listSocialMembers(guildId, normalizedBotId),
    getSocialPanel(guildId, normalizedBotId)
  ]);

  return {
    members,
    panel
  };
}

export async function listSocialMembers(guildId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);

  try {
    const { socialMembers } = await getMongoCollections();
    const members = await socialMembers
      .find(memberScopeQuery(guildId, normalizedBotId))
      .sort({
        createdAt: -1
      })
      .toArray();

    return members.map(toMemberDto);
  } catch {
    return [...memoryMembers.values()]
      .filter((member) => member.guildId === guildId && member.botId === normalizedBotId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
}

export async function getSocialPanel(guildId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);

  try {
    const { socialPanels } = await getMongoCollections();
    const panel = await socialPanels.findOne(panelScopeQuery(guildId, normalizedBotId));
    const memberCount = await countSocialMembers(guildId, normalizedBotId);

    return panel ? toPanelDto(panel, memberCount) : null;
  } catch {
    const panel = memoryPanels.get(panelKey(guildId, normalizedBotId)) ?? null;

    return panel ? { ...panel, memberCount: memoryMemberCount(guildId, normalizedBotId) } : null;
  }
}

export async function createSocialMember(guildId: string, input: CreateSocialMemberInput) {
  const botId = normalizeBotId(input.botId);
  await assertMemberLimit(guildId, botId);

  const now = new Date();
  const links = normalizeLinks(input.links ?? {}, true);
  const discordId = normalizeDiscordId(input.discordId);
  const doc: MongoSocialMember = {
    _id: randomUUID(),
    botId,
    guildId,
    userId: normalizeSnowflake(input.userId) ?? discordId,
    discordId,
    name: normalizeName(input.name),
    avatar: normalizeUrl(input.avatar, "Avatar"),
    role: normalizeShortText(input.role, "Cargo"),
    twitter: links.twitter,
    instagram: links.instagram,
    twitch: links.twitch,
    youtube: links.youtube,
    tiktok: links.tiktok,
    kick: links.kick,
    facebook: links.facebook,
    website: links.website,
    createdAt: now,
    updatedAt: now
  };

  try {
    await ensureGuild(guildId);
    const { socialMembers } = await getMongoCollections();
    await socialMembers.insertOne(doc);
  } catch {
    const dto = toMemberDto(doc);
    memoryMembers.set(dto.id, dto);
  }

  const dto = toMemberDto(doc);
  await writeSocialAudit("social.network.member_created", "Adicionou membro na Network", dto, input.actorId);
  await emitSocialPanelUpdateIfPublished(guildId, botId, "update");

  return dto;
}

export async function updateSocialMember(
  guildId: string,
  id: string,
  input: UpdateSocialMemberInput,
  userId?: string | null,
  botId?: string | null
) {
  const normalizedBotId = normalizeBotId(botId);

  try {
    const { socialMembers } = await getMongoCollections();
    const current = await socialMembers.findOne({
      _id: id
    });

    if (!current || current.guildId !== guildId || normalizeBotId(current.botId) !== normalizedBotId) {
      throw createServiceError("Membro nao encontrado.", 404);
    }

    const updated = await socialMembers.findOneAndUpdate(
      {
        _id: id,
        ...memberScopeQuery(guildId, normalizedBotId)
      },
      {
        $set: buildMemberPatch(input)
      },
      {
        returnDocument: "after"
      }
    );

    if (!updated) {
      throw createServiceError("Membro nao encontrado.", 404);
    }

    const dto = toMemberDto(updated);
    await writeSocialAudit("social.network.member_updated", "Editou membro da Network", dto, userId);
    await emitSocialPanelUpdateIfPublished(guildId, normalizedBotId, "update");
    return dto;
  } catch (error) {
    if ((error as ServiceError).statusCode) {
      throw error;
    }

    const current = memoryMembers.get(id);

    if (!current || current.guildId !== guildId || current.botId !== normalizedBotId) {
      throw createServiceError("Membro nao encontrado.", 404);
    }

    const links: Partial<Record<SocialPlatform, string | null>> = input.links ? normalizeLinks(input.links, false) : {};
    const nextLinks = { ...current.links };

    for (const platform of SOCIAL_PLATFORMS) {
      if (links[platform] !== undefined) {
        nextLinks[platform] = links[platform] ?? "";
      }
    }

    const updated: SocialMemberDto = {
      ...current,
      avatar: input.avatar === undefined ? current.avatar : normalizeUrl(input.avatar, "Avatar"),
      discordId: input.discordId === undefined ? current.discordId : normalizeDiscordId(input.discordId),
      links: nextLinks,
      name: input.name === undefined ? current.name : normalizeName(input.name),
      role: input.role === undefined ? current.role : normalizeShortText(input.role, "Cargo"),
      updatedAt: new Date().toISOString()
    };

    updated.userId = updated.discordId;
    memoryMembers.set(id, updated);
    await writeSocialAudit("social.network.member_updated", "Editou membro da Network", updated, userId);
    await emitSocialPanelUpdateIfPublished(guildId, normalizedBotId, "update");
    return updated;
  }
}

export async function deleteSocialMember(guildId: string, id: string, userId?: string | null, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);

  try {
    const { socialMembers } = await getMongoCollections();
    const current = await socialMembers.findOne({
      _id: id
    });

    if (!current || current.guildId !== guildId || normalizeBotId(current.botId) !== normalizedBotId) {
      throw createServiceError("Membro nao encontrado.", 404);
    }

    await socialMembers.deleteOne({
      _id: id,
      ...memberScopeQuery(guildId, normalizedBotId)
    });

    const dto = toMemberDto(current);
    await writeSocialAudit("social.network.member_deleted", "Removeu membro da Network", dto, userId);
    await emitSocialPanelUpdateIfPublished(guildId, normalizedBotId, "update");
    return dto;
  } catch (error) {
    if ((error as ServiceError).statusCode) {
      throw error;
    }

    const current = memoryMembers.get(id);

    if (!current || current.guildId !== guildId || current.botId !== normalizedBotId) {
      throw createServiceError("Membro nao encontrado.", 404);
    }

    memoryMembers.delete(id);
    await writeSocialAudit("social.network.member_deleted", "Removeu membro da Network", current, userId);
    await emitSocialPanelUpdateIfPublished(guildId, normalizedBotId, "update");
    return current;
  }
}

export async function saveSocialPanelConfig(guildId: string, input: SaveSocialPanelInput, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const channelId = normalizeRequiredSnowflake(input.channelId, "Canal");
  const embedColor = normalizeEmbedColor(input.embedColor);

  try {
    await ensureGuild(guildId);
    const { socialPanels } = await getMongoCollections();
    const current = await socialPanels.findOne(panelScopeQuery(guildId, normalizedBotId));
    const now = new Date();

    await socialPanels.updateOne(
      current ? { _id: current._id } : { guildId, botId: normalizedBotId },
      {
        $set: {
          botId: normalizedBotId,
          channelId,
          embedColor,
          guildId,
          updatedAt: now,
          updatedBy: input.userId ?? null
        },
        $setOnInsert: {
          _id: randomUUID(),
          createdAt: now,
          createdBy: input.userId ?? null,
          messageId: null,
          published: false
        }
      },
      {
        upsert: true
      }
    );

    return getRequiredSocialPanel(guildId, normalizedBotId);
  } catch {
    const key = panelKey(guildId, normalizedBotId);
    const current = memoryPanels.get(key);
    const now = new Date().toISOString();
    const next: SocialPanelDto = {
      id: current?.id ?? randomUUID(),
      botId: normalizedBotId,
      channelId,
      createdAt: current?.createdAt ?? now,
      embedColor,
      guildId,
      lastPublishedAt: current?.lastPublishedAt ?? null,
      memberCount: memoryMemberCount(guildId, normalizedBotId),
      messageId: current?.messageId ?? null,
      published: current?.published ?? false,
      updatedAt: now
    };

    memoryPanels.set(key, next);
    return next;
  }
}

export async function publishSocialPanel(guildId: string, input: Partial<SaveSocialPanelInput> = {}, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);

  if (input.channelId) {
    await saveSocialPanelConfig(guildId, {
      channelId: input.channelId,
      embedColor: input.embedColor,
      userId: input.userId
    }, normalizedBotId);
  }

  const current = await getRequiredSocialPanel(guildId, normalizedBotId);

  if (!current.channelId) {
    throw createServiceError("Selecione o canal da Network antes de publicar.", 400);
  }

  const published = await setSocialPanelPublished(guildId, normalizedBotId, true, input.userId);
  await writePanelAudit("social.network.panel_published", "Publicou/atualizou o painel Network", published, input.userId);
  emitSocialPanelEvent(published, "publish");

  return {
    members: await listSocialMembers(guildId, normalizedBotId),
    panel: published
  };
}

export async function removeSocialPanel(guildId: string, userId?: string | null, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const current = await getSocialPanel(guildId, normalizedBotId);

  if (!current) {
    return null;
  }

  const panel = await setSocialPanelPublished(guildId, normalizedBotId, false, userId);
  await writePanelAudit("social.network.panel_removed", "Removeu o painel Network", panel, userId);
  emitSocialPanelEvent(panel, "remove");

  return panel;
}

export async function listBotSocialPanels(botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);

  try {
    const { socialPanels } = await getMongoCollections();
    const panels = await socialPanels
      .find(panelBotSyncQuery(normalizedBotId))
      .sort({
        updatedAt: 1
      })
      .toArray();

    return Promise.all(panels.map((panel) => toPanelPayload(panel)));
  } catch {
    return Promise.all(
      [...memoryPanels.values()]
        .filter((panel) => panel.botId === normalizedBotId && ((panel.published && panel.channelId) || panel.messageId))
        .map((panel) => toMemoryPanelPayload(panel))
    );
  }
}

export async function getBotSocialPanel(panelId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);

  try {
    const { socialPanels } = await getMongoCollections();
    const panel = await socialPanels.findOne({
      _id: panelId,
      ...panelBotScopeQuery(normalizedBotId)
    });

    if (!panel) {
      throw createServiceError("Painel nao encontrado.", 404);
    }

    return toPanelPayload(panel);
  } catch (error) {
    if ((error as ServiceError).statusCode) {
      throw error;
    }

    const panel = [...memoryPanels.values()].find((item) => item.id === panelId && item.botId === normalizedBotId);

    if (!panel) {
      throw createServiceError("Painel nao encontrado.", 404);
    }

    return toMemoryPanelPayload(panel);
  }
}

export async function updateSocialPanelMessageState(panelId: string, input: UpdateSocialPanelStateInput, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);

  try {
    const { socialPanels } = await getMongoCollections();
    const updated = await socialPanels.findOneAndUpdate(
      {
        _id: panelId,
        ...panelBotScopeQuery(normalizedBotId)
      },
      {
        $set: buildPanelStatePatch(input)
      },
      {
        returnDocument: "after"
      }
    );

    if (!updated) {
      throw createServiceError("Painel nao encontrado.", 404);
    }

    return toPanelDto(updated, await countSocialMembers(updated.guildId, normalizedBotId));
  } catch (error) {
    if ((error as ServiceError).statusCode) {
      throw error;
    }

    const panel = [...memoryPanels.values()].find((item) => item.id === panelId && item.botId === normalizedBotId);

    if (!panel) {
      throw createServiceError("Painel nao encontrado.", 404);
    }

    const updated: SocialPanelDto = {
      ...panel,
      messageId: input.messageId === undefined ? panel.messageId : input.messageId,
      published: input.published === undefined ? panel.published : input.published,
      updatedAt: new Date().toISOString()
    };

    memoryPanels.set(panelKey(updated.guildId, updated.botId), updated);
    return updated;
  }
}

export function createServiceError(message: string, statusCode: number) {
  const error = new Error(message) as ServiceError;
  error.statusCode = statusCode;
  return error;
}

async function getRequiredSocialPanel(guildId: string, botId: string | null) {
  const panel = await getSocialPanel(guildId, botId);

  if (!panel) {
    throw createServiceError("Configure o canal da Network antes de publicar.", 400);
  }

  return panel;
}

async function setSocialPanelPublished(guildId: string, botId: string | null, published: boolean, userId?: string | null) {
  const now = new Date();

  try {
    const { socialPanels } = await getMongoCollections();
    const updated = await socialPanels.findOneAndUpdate(
      panelScopeQuery(guildId, botId),
      {
        $set: {
          published,
          updatedAt: now,
          updatedBy: userId ?? null,
          ...(published ? { lastPublishedAt: now } : {})
        }
      },
      {
        returnDocument: "after"
      }
    );

    if (!updated) {
      throw createServiceError("Painel nao encontrado.", 404);
    }

    return toPanelDto(updated, await countSocialMembers(guildId, botId));
  } catch (error) {
    if ((error as ServiceError).statusCode) {
      throw error;
    }

    const key = panelKey(guildId, botId);
    const current = memoryPanels.get(key);

    if (!current) {
      throw createServiceError("Painel nao encontrado.", 404);
    }

    const updated: SocialPanelDto = {
      ...current,
      lastPublishedAt: published ? new Date().toISOString() : current.lastPublishedAt,
      memberCount: memoryMemberCount(guildId, botId),
      published,
      updatedAt: new Date().toISOString()
    };

    memoryPanels.set(key, updated);
    return updated;
  }
}

async function emitSocialPanelUpdateIfPublished(guildId: string, botId: string | null, action: "update") {
  const panel = await getSocialPanel(guildId, botId).catch(() => null);

  if (panel?.published && panel.channelId) {
    emitSocialPanelEvent(panel, action);
  }
}

function emitSocialPanelEvent(panel: SocialPanelDto, action: "publish" | "remove" | "update") {
  emitRealtime("socials:update", {
    action,
    botId: panel.botId,
    guildId: panel.guildId,
    panelId: panel.id
  });
}

async function toPanelPayload(panel: MongoSocialPanel): Promise<SocialPanelPayload> {
  const botId = normalizeBotId(panel.botId);
  const [members, memberCount] = await Promise.all([
    listSocialMembers(panel.guildId, botId),
    countSocialMembers(panel.guildId, botId)
  ]);

  return {
    members,
    panel: toPanelDto(panel, memberCount)
  };
}

async function toMemoryPanelPayload(panel: SocialPanelDto): Promise<SocialPanelPayload> {
  return {
    members: panel.published ? await listSocialMembers(panel.guildId, panel.botId) : [],
    panel: {
      ...panel,
      memberCount: memoryMemberCount(panel.guildId, panel.botId)
    }
  };
}

async function countSocialMembers(guildId: string, botId: string | null) {
  try {
    const { socialMembers } = await getMongoCollections();
    return socialMembers.countDocuments(memberScopeQuery(guildId, botId));
  } catch {
    return memoryMemberCount(guildId, botId);
  }
}

function memoryMemberCount(guildId: string, botId: string | null) {
  return [...memoryMembers.values()].filter((member) => member.guildId === guildId && member.botId === botId).length;
}

async function assertMemberLimit(guildId: string, botId: string | null) {
  const count = await countSocialMembers(guildId, botId);

  if (count >= SOCIAL_MEMBER_LIMIT) {
    throw createServiceError(`Voce atingiu o limite de ${SOCIAL_MEMBER_LIMIT} membros na Network deste servidor.`, 400);
  }
}

function buildMemberPatch(input: UpdateSocialMemberInput): Partial<MongoSocialMember> {
  const patch: Partial<MongoSocialMember> = {
    updatedAt: new Date()
  };

  if (input.name !== undefined) {
    patch.name = normalizeName(input.name);
  }

  if (input.avatar !== undefined) {
    patch.avatar = normalizeUrl(input.avatar, "Avatar");
  }

  if (input.discordId !== undefined) {
    const discordId = normalizeDiscordId(input.discordId);
    patch.discordId = discordId;
    patch.userId = discordId;
  }

  if (input.role !== undefined) {
    patch.role = normalizeShortText(input.role, "Cargo");
  }

  if (input.links) {
    Object.assign(patch, normalizeLinks(input.links, false));
  }

  return patch;
}

function buildPanelStatePatch(input: UpdateSocialPanelStateInput): Partial<MongoSocialPanel> {
  const patch: Partial<MongoSocialPanel> = {
    updatedAt: new Date()
  };

  if (input.messageId !== undefined) {
    patch.messageId = input.messageId;
  }

  if (input.published !== undefined) {
    patch.published = input.published;
  }

  return patch;
}

function normalizeLinks(input: Partial<Record<SocialPlatform, string | null | undefined>>, fillMissing: boolean) {
  const links: Partial<Record<SocialPlatform, string | null>> = {};

  for (const platform of SOCIAL_PLATFORMS) {
    if (input[platform] !== undefined || fillMissing) {
      links[platform] = normalizeUrl(input[platform], platformLabel(platform));
    }
  }

  return links as Record<SocialPlatform, string | null>;
}

function normalizeName(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");

  if (normalized.length < 1 || normalized.length > 80) {
    throw createServiceError("Nome do membro deve ter entre 1 e 80 caracteres.", 400);
  }

  return normalized;
}

function normalizeShortText(value: string | null | undefined, label: string) {
  const normalized = value?.trim() ?? "";

  if (!normalized) {
    return null;
  }

  if (normalized.length > 80) {
    throw createServiceError(`${label} deve ter no maximo 80 caracteres.`, 400);
  }

  return normalized;
}

function normalizeUrl(value: string | null | undefined, label: string) {
  const normalized = value?.trim() ?? "";

  if (!normalized) {
    return null;
  }

  if (normalized.length > 2048) {
    throw createServiceError(`${label} deve ter no maximo 2048 caracteres.`, 400);
  }

  try {
    const url = new URL(normalized);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("invalid protocol");
    }

    return url.toString();
  } catch {
    throw createServiceError(`${label} precisa ser uma URL valida.`, 400);
  }
}

function normalizeDiscordId(value: string | null | undefined) {
  const normalized = normalizeSnowflake(value);

  if (!normalized && value?.trim()) {
    throw createServiceError("Discord ID precisa conter apenas numeros.", 400);
  }

  return normalized;
}

function normalizeRequiredSnowflake(value: string, label: string) {
  const normalized = normalizeSnowflake(value);

  if (!normalized) {
    throw createServiceError(`${label} invalido.`, 400);
  }

  return normalized;
}

function normalizeSnowflake(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return /^\d{5,32}$/.test(normalized) ? normalized : null;
}

function normalizeEmbedColor(value?: string | null) {
  if (!value) {
    return DEFAULT_EMBED_COLOR;
  }

  const color = value.trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : DEFAULT_EMBED_COLOR;
}

function toMemberDto(member: MongoSocialMember): SocialMemberDto {
  const discordId = member.discordId ?? member.userId ?? null;

  return {
    id: member._id,
    botId: normalizeBotId(member.botId),
    guildId: member.guildId,
    userId: member.userId ?? discordId,
    discordId,
    name: member.name,
    avatar: member.avatar,
    role: member.role ?? null,
    links: {
      twitter: member.twitter ?? "",
      instagram: member.instagram ?? "",
      twitch: member.twitch ?? "",
      youtube: member.youtube ?? "",
      tiktok: member.tiktok ?? "",
      kick: member.kick ?? "",
      facebook: member.facebook ?? "",
      website: member.website ?? ""
    },
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString()
  };
}

function toPanelDto(panel: MongoSocialPanel, memberCount: number): SocialPanelDto {
  return {
    id: panel._id,
    botId: normalizeBotId(panel.botId),
    guildId: panel.guildId,
    channelId: panel.channelId,
    messageId: panel.messageId,
    embedColor: normalizeEmbedColor(panel.embedColor),
    published: panel.published,
    memberCount,
    createdAt: panel.createdAt.toISOString(),
    updatedAt: panel.updatedAt.toISOString(),
    lastPublishedAt: panel.lastPublishedAt?.toISOString?.() ?? null
  };
}

async function writeSocialAudit(type: string, action: string, member: SocialMemberDto, userId?: string | null) {
  await createLog({
    botId: member.botId,
    guildId: member.guildId,
    userId,
    type,
    message: `${action}: ${member.name}`,
    metadata: {
      action,
      memberId: member.id,
      module: "network",
      socialLinks: Object.keys(member.links).filter((platform) => member.links[platform as SocialPlatform]),
      userId
    }
  }).catch(() => undefined);
}

async function writePanelAudit(type: string, action: string, panel: SocialPanelDto, userId?: string | null) {
  await createLog({
    botId: panel.botId,
    guildId: panel.guildId,
    userId,
    type,
    message: action,
    metadata: {
      action,
      channelId: panel.channelId,
      messageId: panel.messageId,
      module: "network",
      userId
    }
  }).catch(() => undefined);
}

function platformLabel(platform: SocialPlatform) {
  const labels: Record<SocialPlatform, string> = {
    facebook: "Facebook",
    instagram: "Instagram",
    kick: "Kick",
    tiktok: "TikTok",
    twitch: "Twitch",
    twitter: "X (Twitter)",
    website: "Site pessoal",
    youtube: "YouTube"
  };

  return labels[platform];
}

function normalizeBotId(botId: string | null | undefined) {
  const normalized = botId?.trim();
  return normalized ? normalized : null;
}

function memberScopeQuery(guildId: string, botId: string | null) {
  if (botId) {
    return {
      guildId,
      botId
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

function panelScopeQuery(guildId: string, botId: string | null) {
  if (botId) {
    return {
      guildId,
      botId
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

function panelBotScopeQuery(botId: string | null) {
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

function panelBotSyncQuery(botId: string | null) {
  return {
    $and: [
      panelBotScopeQuery(botId),
      {
        $or: [
          {
            published: true,
            channelId: {
              $ne: null
            }
          },
          {
            messageId: {
              $ne: null
            }
          }
        ]
      }
    ]
  };
}

function panelKey(guildId: string, botId: string | null) {
  return `${botId ?? "default"}:${guildId}`;
}

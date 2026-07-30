import { randomBytes, randomUUID } from "node:crypto";
import type { Filter } from "mongodb";
import {
  getMongoCollections,
  type MongoNexTechInvite,
  type MongoNexTechInviteLog,
  type MongoNexTechInvitePermissionRole,
  type MongoNexTechInviteStatus
} from "../database/mongo";
import { emitRealtime } from "../realtime/events";

export type NexTechInviteDto = Omit<MongoNexTechInvite, "_id" | "createdAt" | "expiresAt" | "lastAccessAt" | "updatedAt" | "usages"> & {
  createdAt: string;
  expiresAt: string | null;
  id: string;
  lastAccessAt?: string | null;
  remainingUses: number | null;
  usages: Array<Omit<MongoNexTechInvite["usages"][number], "usedAt"> & { usedAt: string }>;
  updatedAt: string;
};

export type NexTechInviteLogDto = Omit<MongoNexTechInviteLog, "_id" | "createdAt"> & {
  createdAt: string;
  id: string;
};

export type NexTechInviteDashboardDto = {
  invites: NexTechInviteDto[];
  logs: NexTechInviteLogDto[];
  officialInvite: NexTechInviteDto | null;
  stats: {
    active: number;
    blockedInvites: number;
    cancelled: number;
    clicks: number;
    conversions: number;
    expired: number;
    memberCount: number;
    paused: number;
    remainingUses: number;
    totalUses: number;
  };
};

export type PublicNexTechInvitePageDto = {
  config: {
    backgroundEffect: NonNullable<MongoNexTechInvite["backgroundEffect"]>;
    backgroundImageUrl: string | null;
    backgroundVideoUrl: string | null;
    logoUrl: string | null;
    overlayStyle: NonNullable<MongoNexTechInvite["overlayStyle"]>;
    particleStyle: NonNullable<MongoNexTechInvite["particleStyle"]>;
    primaryColor: string;
    showInviteCode: boolean;
    showMemberCount: boolean;
    showOnlineCount: boolean;
    showServerDescription: boolean;
    showServerName: boolean;
    showVerificationBadges: boolean;
    theme: NonNullable<MongoNexTechInvite["landingPageTheme"]>;
  };
  discord: {
    approximateMemberCount: number | null;
    approximatePresenceCount: number | null;
    bannerUrl: string | null;
    code: string;
    description: string | null;
    features: string[];
    guildId: string | null;
    iconUrl: string | null;
    name: string;
    splashUrl: string | null;
    vanityUrlCode: string | null;
    verified: boolean;
    partnered: boolean;
  } | null;
  invite: Pick<NexTechInviteDto, "clientName" | "code" | "customSlug" | "description" | "id" | "name" | "panelColor">;
  redirectUrl: string;
  slug: string;
  valid: boolean;
};

export type SaveNexTechInviteInput = {
  adminChannelId?: string | null;
  alertChannelId?: string | null;
  bannerUrl?: string | null;
  blockUnknownInvites?: boolean;
  botId?: string | null;
  backgroundEffect?: MongoNexTechInvite["backgroundEffect"] | null;
  buttonEmoji?: string | null;
  buttonLabel?: string | null;
  channelId?: string | null;
  clientName: string;
  code?: string | null;
  customSlug?: string | null;
  description?: string | null;
  discordInviteId?: string | null;
  expiresAt?: string | null;
  footerText?: string | null;
  guildId?: string | null;
  guildName?: string | null;
  imageUrl?: string | null;
  inviteUrl?: string | null;
  landingPageEnabled?: boolean;
  landingPageTheme?: MongoNexTechInvite["landingPageTheme"] | null;
  logChannelId?: string | null;
  logoUrl?: string | null;
  maxUses?: number | null;
  name: string;
  notes?: string | null;
  overlayStyle?: MongoNexTechInvite["overlayStyle"] | null;
  particleStyle?: MongoNexTechInvite["particleStyle"] | null;
  panelChannelId?: string | null;
  panelColor?: string | null;
  panelTitle?: string | null;
  permissions?: Partial<Record<MongoNexTechInvitePermissionRole, string[]>>;
  showInviteCode?: boolean;
  showMemberCount?: boolean;
  showOnlineCount?: boolean;
  showServerDescription?: boolean;
  showServerName?: boolean;
  showVerificationBadges?: boolean;
  statsChannelId?: string | null;
  status?: MongoNexTechInviteStatus;
  videoUrl?: string | null;
};

type PublicViewInput = {
  ip: string | null;
  referrer: string | null;
  source: string | null;
  userAgent: string | null;
};

type DiscordInviteResponse = {
  approximate_member_count?: number;
  approximate_presence_count?: number;
  code?: string;
  expires_at?: string | null;
  guild?: {
    banner?: string | null;
    description?: string | null;
    features?: string[];
    icon?: string | null;
    id?: string;
    name?: string;
    splash?: string | null;
    vanity_url_code?: string | null;
  };
};

const BACKGROUND_EFFECTS = ["fixed", "parallax", "zoom", "blur"] as const;
const LANDING_THEMES = ["discord", "nextech", "dark", "neon", "cyber", "gamer", "premium", "minimal", "modern"] as const;
const OVERLAY_STYLES = ["black", "blue", "red", "gradient", "none"] as const;
const PARTICLE_STYLES = ["none", "dots", "sparks", "neon", "smoke", "lines", "stars", "hex"] as const;

type Actor = {
  id: string | null;
  name: string | null;
};

type Scope = {
  botId?: string | null;
  guildId?: string | null;
};

export async function getNexTechInviteDashboard(scope: Scope = {}): Promise<NexTechInviteDashboardDto> {
  await expireDueInvites();
  const collections = await getMongoCollections();
  const filter = inviteScopeFilter(scope);
  const [invites, logs] = await Promise.all([
    collections.nexTechInvites.find(filter).sort({ createdAt: -1 }).limit(250).toArray(),
    collections.nexTechInviteLogs.find(logScopeFilter(scope)).sort({ createdAt: -1 }).limit(80).toArray()
  ]);
  const inviteDtos = invites.map(inviteDto);
  const officialInvite = inviteDtos.find((invite) => invite.status === "active") ?? inviteDtos[0] ?? null;
  return {
    invites: inviteDtos,
    logs: logs.map(logDto),
    officialInvite,
    stats: {
      active: inviteDtos.filter((invite) => invite.status === "active").length,
      blockedInvites: logs.filter((log) => log.action === "invite.blocked").length,
      cancelled: inviteDtos.filter((invite) => invite.status === "cancelled").length,
      clicks: inviteDtos.reduce((total, invite) => total + (invite.clicks ?? 0), 0),
      conversions: inviteDtos.reduce((total, invite) => total + (invite.conversionCount ?? 0), 0),
      expired: inviteDtos.filter((invite) => invite.status === "expired").length,
      memberCount: inviteDtos.reduce((total, invite) => total + invite.usages.length, 0),
      paused: inviteDtos.filter((invite) => invite.status === "paused").length,
      remainingUses: inviteDtos.reduce((total, invite) => total + (invite.remainingUses ?? 0), 0),
      totalUses: inviteDtos.reduce((total, invite) => total + invite.usedCount, 0)
    }
  };
}

export async function generateNexTechInviteCode(scope: Scope = {}) {
  const collections = await getMongoCollections();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = `NEXTECH-${randomBytes(2).toString("hex").toUpperCase()}-${randomBytes(1).toString("hex").toUpperCase()}`;
    const exists = await collections.nexTechInvites.findOne({ ...inviteScopeFilter(scope), code }, { projection: { _id: 1 } });
    if (!exists) return code;
  }
  return `NEXTECH-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function createNexTechInvite(input: SaveNexTechInviteInput, actor: Actor) {
  const collections = await getMongoCollections();
  const now = new Date();
  const botId = normalizeBotId(input.botId);
  const guildId = normalizeSnowflake(input.guildId);
  const code = normalizeInviteCode(input.code || inviteCodeFromUrl(input.inviteUrl)) || await generateNexTechInviteCode({ botId, guildId });
  const invite: MongoNexTechInvite = {
    _id: randomUUID(),
    adminChannelId: normalizeSnowflake(input.adminChannelId),
    alertChannelId: normalizeSnowflake(input.alertChannelId),
    bannerUrl: normalizeNullableUrl(input.bannerUrl),
    blockUnknownInvites: input.blockUnknownInvites ?? true,
    botId,
    backgroundEffect: normalizeEnum(input.backgroundEffect, BACKGROUND_EFFECTS, "fixed"),
    buttonEmoji: normalizeNullableText(input.buttonEmoji, 32),
    buttonLabel: normalizeNullableText(input.buttonLabel, 40) ?? "Entrar",
    channelId: normalizeSnowflake(input.channelId),
    clicks: 0,
    clientName: normalizeText(input.clientName, 120),
    code,
    conversionCount: 0,
    createdAt: now,
    createdBy: actor.id,
    customSlug: normalizeSlug(input.customSlug),
    description: normalizeNullableText(input.description, 1200),
    discordInviteId: normalizeNullableText(input.discordInviteId, 120),
    expiresAt: normalizeOptionalDate(input.expiresAt),
    footerText: normalizeNullableText(input.footerText, 120) ?? "NexTech",
    guildId,
    guildName: normalizeNullableText(input.guildName, 120),
    imageUrl: normalizeNullableUrl(input.imageUrl),
    inviteUrl: normalizeInviteUrl(input.inviteUrl, code),
    landingPageEnabled: input.landingPageEnabled ?? true,
    landingPageTheme: normalizeEnum(input.landingPageTheme, LANDING_THEMES, "nextech"),
    lastAccessAt: null,
    lastAccess: null,
    logChannelId: normalizeSnowflake(input.logChannelId),
    logoUrl: normalizeNullableUrl(input.logoUrl),
    maxUses: normalizeMaxUses(input.maxUses),
    name: normalizeText(input.name, 120),
    notes: normalizeNullableText(input.notes, 800),
    overlayStyle: normalizeEnum(input.overlayStyle, OVERLAY_STYLES, "black"),
    pageViews: 0,
    appOpenClicks: 0,
    browserOpenClicks: 0,
    particleStyle: normalizeEnum(input.particleStyle, PARTICLE_STYLES, "hex"),
    panelChannelId: normalizeSnowflake(input.panelChannelId),
    panelColor: normalizeColor(input.panelColor),
    panelTitle: normalizeNullableText(input.panelTitle, 120) ?? "NEXTTECH",
    permissions: normalizePermissions(input.permissions),
    showInviteCode: input.showInviteCode ?? true,
    showMemberCount: input.showMemberCount ?? true,
    showOnlineCount: input.showOnlineCount ?? true,
    showServerDescription: input.showServerDescription ?? true,
    showServerName: input.showServerName ?? true,
    showVerificationBadges: input.showVerificationBadges ?? true,
    status: input.status ?? "active",
    statsChannelId: normalizeSnowflake(input.statsChannelId),
    updatedAt: now,
    updatedBy: actor.id,
    usages: [],
    usedCount: 0,
    videoUrl: normalizeNullableUrl(input.videoUrl)
  };

  if (!invite.name) throw Object.assign(new Error("Informe o nome do convite."), { statusCode: 400 });
  if (!invite.clientName) throw Object.assign(new Error("Informe o cliente responsável."), { statusCode: 400 });
  if (!invite.code) throw Object.assign(new Error("Informe um código válido."), { statusCode: 400 });
  if (!invite.botId) throw Object.assign(new Error("Informe o bot do convite."), { statusCode: 400 });
  if (!invite.guildId) throw Object.assign(new Error("Informe o servidor do convite."), { statusCode: 400 });

  try {
    await collections.nexTechInvites.insertOne(invite);
  } catch (error) {
    if (isDuplicateKey(error)) throw Object.assign(new Error("Já existe um convite oficial com esse código neste bot/servidor."), { statusCode: 409 });
    throw error;
  }

  await createInviteLog("invite.created", actor, invite, { status: invite.status });
  await emitDashboardUpdated(invite);
  return inviteDto(invite);
}

export async function updateNexTechInvite(inviteId: string, input: Partial<SaveNexTechInviteInput>, actor: Actor) {
  const collections = await getMongoCollections();
  const current = await collections.nexTechInvites.findOne({ _id: inviteId });
  if (!current) throw Object.assign(new Error("Convite não encontrado."), { statusCode: 404 });

  const patch: Partial<MongoNexTechInvite> = {
    updatedAt: new Date(),
    updatedBy: actor.id
  };
  if (input.adminChannelId !== undefined) patch.adminChannelId = normalizeSnowflake(input.adminChannelId);
  if (input.alertChannelId !== undefined) patch.alertChannelId = normalizeSnowflake(input.alertChannelId);
  if (input.bannerUrl !== undefined) patch.bannerUrl = normalizeNullableUrl(input.bannerUrl);
  if (input.blockUnknownInvites !== undefined) patch.blockUnknownInvites = input.blockUnknownInvites;
  if (input.botId !== undefined) patch.botId = normalizeBotId(input.botId);
  if (input.backgroundEffect !== undefined) patch.backgroundEffect = normalizeEnum(input.backgroundEffect, BACKGROUND_EFFECTS, "fixed");
  if (input.buttonEmoji !== undefined) patch.buttonEmoji = normalizeNullableText(input.buttonEmoji, 32);
  if (input.buttonLabel !== undefined) patch.buttonLabel = normalizeNullableText(input.buttonLabel, 40) ?? "Entrar";
  if (input.channelId !== undefined) patch.channelId = normalizeSnowflake(input.channelId);
  if (input.clientName !== undefined) patch.clientName = normalizeText(input.clientName, 120);
  if (input.code !== undefined) patch.code = normalizeInviteCode(input.code);
  if (input.customSlug !== undefined) patch.customSlug = normalizeSlug(input.customSlug);
  if (input.description !== undefined) patch.description = normalizeNullableText(input.description, 1200);
  if (input.discordInviteId !== undefined) patch.discordInviteId = normalizeNullableText(input.discordInviteId, 120);
  if (input.expiresAt !== undefined) patch.expiresAt = normalizeOptionalDate(input.expiresAt);
  if (input.footerText !== undefined) patch.footerText = normalizeNullableText(input.footerText, 120);
  if (input.guildId !== undefined) patch.guildId = normalizeSnowflake(input.guildId);
  if (input.guildName !== undefined) patch.guildName = normalizeNullableText(input.guildName, 120);
  if (input.imageUrl !== undefined) patch.imageUrl = normalizeNullableUrl(input.imageUrl);
  if (input.inviteUrl !== undefined) {
    patch.inviteUrl = normalizeInviteUrl(input.inviteUrl, patch.code ?? current.code);
    if (input.code === undefined) patch.code = normalizeInviteCode(inviteCodeFromUrl(input.inviteUrl)) || current.code;
  }
  if (input.landingPageEnabled !== undefined) patch.landingPageEnabled = input.landingPageEnabled;
  if (input.landingPageTheme !== undefined) patch.landingPageTheme = normalizeEnum(input.landingPageTheme, LANDING_THEMES, "nextech");
  if (input.logChannelId !== undefined) patch.logChannelId = normalizeSnowflake(input.logChannelId);
  if (input.logoUrl !== undefined) patch.logoUrl = normalizeNullableUrl(input.logoUrl);
  if (input.maxUses !== undefined) patch.maxUses = normalizeMaxUses(input.maxUses);
  if (input.name !== undefined) patch.name = normalizeText(input.name, 120);
  if (input.notes !== undefined) patch.notes = normalizeNullableText(input.notes, 800);
  if (input.overlayStyle !== undefined) patch.overlayStyle = normalizeEnum(input.overlayStyle, OVERLAY_STYLES, "black");
  if (input.particleStyle !== undefined) patch.particleStyle = normalizeEnum(input.particleStyle, PARTICLE_STYLES, "hex");
  if (input.panelChannelId !== undefined) patch.panelChannelId = normalizeSnowflake(input.panelChannelId);
  if (input.panelColor !== undefined) patch.panelColor = normalizeColor(input.panelColor);
  if (input.panelTitle !== undefined) patch.panelTitle = normalizeNullableText(input.panelTitle, 120);
  if (input.permissions !== undefined) patch.permissions = normalizePermissions(input.permissions);
  if (input.showInviteCode !== undefined) patch.showInviteCode = input.showInviteCode;
  if (input.showMemberCount !== undefined) patch.showMemberCount = input.showMemberCount;
  if (input.showOnlineCount !== undefined) patch.showOnlineCount = input.showOnlineCount;
  if (input.showServerDescription !== undefined) patch.showServerDescription = input.showServerDescription;
  if (input.showServerName !== undefined) patch.showServerName = input.showServerName;
  if (input.showVerificationBadges !== undefined) patch.showVerificationBadges = input.showVerificationBadges;
  if (input.statsChannelId !== undefined) patch.statsChannelId = normalizeSnowflake(input.statsChannelId);
  if (input.status !== undefined) patch.status = input.status;
  if (input.videoUrl !== undefined) patch.videoUrl = normalizeNullableUrl(input.videoUrl);

  if (patch.name !== undefined && !patch.name) throw Object.assign(new Error("Informe o nome do convite."), { statusCode: 400 });
  if (patch.clientName !== undefined && !patch.clientName) throw Object.assign(new Error("Informe o cliente responsável."), { statusCode: 400 });
  if (patch.code !== undefined && !patch.code) throw Object.assign(new Error("Informe um código válido."), { statusCode: 400 });

  try {
    const value = await collections.nexTechInvites.findOneAndUpdate(
      { _id: inviteId },
      { $set: patch },
      { returnDocument: "after" }
    );
    if (!value) throw Object.assign(new Error("Convite não encontrado."), { statusCode: 404 });
    await createInviteLog("invite.updated", actor, value, { changed: Object.keys(input) });
    await emitDashboardUpdated(value);
    return inviteDto(value);
  } catch (error) {
    if (isDuplicateKey(error)) throw Object.assign(new Error("Já existe um convite oficial com esse código neste bot/servidor."), { statusCode: 409 });
    throw error;
  }
}

export async function deleteNexTechInvite(inviteId: string, actor: Actor) {
  const collections = await getMongoCollections();
  const current = await collections.nexTechInvites.findOne({ _id: inviteId });
  if (!current) throw Object.assign(new Error("Convite não encontrado."), { statusCode: 404 });
  await collections.nexTechInvites.deleteOne({ _id: inviteId });
  await createInviteLog("invite.deleted", actor, current, {});
  await emitDashboardUpdated(current);
  return inviteDto(current);
}

export async function getNexTechInviteRuntime(botId: string | null, guildId: string) {
  await expireDueInvites();
  const collections = await getMongoCollections();
  const invite = await collections.nexTechInvites.findOne(
    {
      ...inviteScopeFilter({ botId, guildId }),
      status: "active"
    },
    { sort: { updatedAt: -1 } }
  );

  return {
    invite: invite ? inviteDto(invite) : null
  };
}

export async function getPublicNexTechInvitePage(rawCode: string): Promise<PublicNexTechInvitePageDto | null> {
  await expireDueInvites();
  const code = normalizeInviteCode(rawCode);
  const slug = normalizeSlug(rawCode);
  if (!code && !slug) return null;

  const collections = await getMongoCollections();
  const invite = await collections.nexTechInvites.findOne({
    status: "active",
    landingPageEnabled: { $ne: false },
    $or: [
      ...(slug ? [{ customSlug: slug }] : []),
      ...(code ? [{ code }] : [])
    ]
  }, { sort: { updatedAt: -1 } });
  if (!invite) return null;

  const discordCode = inviteCodeFromUrl(invite.inviteUrl) || invite.code;
  const discord = await fetchDiscordInvite(discordCode);
  const redirectUrl = normalizeInviteUrl(invite.inviteUrl, discordCode) ?? `https://discord.gg/${discordCode}`;
  const dto = inviteDto(invite);

  return {
    config: {
      backgroundEffect: invite.backgroundEffect ?? "fixed",
      backgroundImageUrl: invite.imageUrl ?? invite.bannerUrl ?? discord?.bannerUrl ?? discord?.splashUrl ?? null,
      backgroundVideoUrl: invite.videoUrl ?? null,
      logoUrl: invite.logoUrl ?? discord?.iconUrl ?? null,
      overlayStyle: invite.overlayStyle ?? "black",
      particleStyle: invite.particleStyle ?? "hex",
      primaryColor: invite.panelColor ?? "#FFD500",
      showInviteCode: invite.showInviteCode !== false,
      showMemberCount: invite.showMemberCount !== false,
      showOnlineCount: invite.showOnlineCount !== false,
      showServerDescription: invite.showServerDescription !== false,
      showServerName: invite.showServerName !== false,
      showVerificationBadges: invite.showVerificationBadges !== false,
      theme: invite.landingPageTheme ?? "nextech"
    },
    discord,
    invite: {
      clientName: dto.clientName,
      code: dto.code,
      customSlug: dto.customSlug,
      description: dto.description,
      id: dto.id,
      name: dto.name,
      panelColor: dto.panelColor
    },
    redirectUrl,
    slug: invite.customSlug || invite.code,
    valid: Boolean(discord)
  };
}

export async function recordPublicNexTechInviteView(inviteId: string, input: PublicViewInput) {
  const collections = await getMongoCollections();
  const userAgent = parseUserAgent(input.userAgent);
  await collections.nexTechInvites.updateOne(
    { _id: inviteId },
    {
      $inc: { pageViews: 1, clicks: 1 },
      $set: {
        lastAccessAt: new Date(),
        lastAccess: {
          browser: userAgent.browser,
          city: null,
          country: null,
          device: userAgent.device,
          ipMasked: maskIp(input.ip),
          os: userAgent.os,
          referrer: normalizeNullableText(input.referrer, 300),
          source: normalizeNullableText(input.source, 120)
        }
      }
    }
  );
}

export async function recordPublicNexTechInviteClick(inviteId: string, target: "app" | "browser" | "official") {
  const increments = target === "app"
    ? { appOpenClicks: 1, conversionCount: 1 }
    : target === "browser"
      ? { browserOpenClicks: 1, conversionCount: 1 }
      : { conversionCount: 1 };
  const collections = await getMongoCollections();
  await collections.nexTechInvites.updateOne({ _id: inviteId }, { $inc: increments });
}

export async function recordNexTechInviteBlocked(botId: string | null, guildId: string, input: {
  channelId: string | null;
  inviteCode: string | null;
  messageId: string | null;
  userId: string | null;
  userName: string | null;
}) {
  const collections = await getMongoCollections();
  const invite = await collections.nexTechInvites.findOne(inviteScopeFilter({ botId, guildId }), { sort: { updatedAt: -1 } });
  const log: MongoNexTechInviteLog = {
    _id: randomUUID(),
    action: "invite.blocked",
    actorId: input.userId,
    actorName: input.userName,
    createdAt: new Date(),
    data: {
      channelId: input.channelId,
      messageId: input.messageId
    },
    guildId,
    guildName: invite?.guildName ?? null,
    inviteCode: input.inviteCode,
    inviteId: invite?._id ?? null
  };
  await collections.nexTechInviteLogs.insertOne(log);
  if (invite) await emitDashboardUpdated(invite);
  return logDto(log);
}

export async function updateNexTechInvitePanelState(botId: string | null, guildId: string, inviteId: string, panelMessageId: string | null) {
  const collections = await getMongoCollections();
  const filter = {
    ...inviteScopeFilter({ botId, guildId }),
    _id: inviteId
  };
  const updated = await collections.nexTechInvites.findOneAndUpdate(
    filter,
    {
      $set: {
        panelMessageId,
        updatedAt: new Date()
      }
    },
    { returnDocument: "after" }
  );

  if (updated) await emitDashboardUpdated(updated);
  return updated ? inviteDto(updated) : null;
}

async function expireDueInvites() {
  const collections = await getMongoCollections();
  await collections.nexTechInvites.updateMany(
    {
      expiresAt: { $lte: new Date() },
      status: { $in: ["active", "paused"] }
    } satisfies Filter<MongoNexTechInvite>,
    {
      $set: {
        status: "expired",
        updatedAt: new Date()
      }
    }
  );
}

async function createInviteLog(action: string, actor: Actor, invite: MongoNexTechInvite, data: Record<string, unknown>) {
  const collections = await getMongoCollections();
  const log: MongoNexTechInviteLog = {
    _id: randomUUID(),
    action,
    actorId: actor.id,
    actorName: actor.name,
    createdAt: new Date(),
    data,
    guildId: null,
    guildName: null,
    inviteCode: invite.code,
    inviteId: invite._id
  };
  await collections.nexTechInviteLogs.insertOne(log);
}

async function emitDashboardUpdated(invite: MongoNexTechInvite) {
  emitRealtime("nextech-invites:updated", await getNexTechInviteDashboard({ botId: invite.botId, guildId: invite.guildId }));
}

function inviteDto(invite: MongoNexTechInvite): NexTechInviteDto {
  return {
    adminChannelId: invite.adminChannelId ?? null,
    alertChannelId: invite.alertChannelId ?? null,
    bannerUrl: invite.bannerUrl ?? null,
    blockUnknownInvites: invite.blockUnknownInvites ?? true,
    botId: invite.botId ?? null,
    backgroundEffect: invite.backgroundEffect ?? "fixed",
    buttonEmoji: invite.buttonEmoji ?? null,
    buttonLabel: invite.buttonLabel ?? "Entrar",
    channelId: invite.channelId ?? null,
    clicks: invite.clicks ?? 0,
    clientName: invite.clientName,
    code: invite.code,
    conversionCount: invite.conversionCount ?? 0,
    createdAt: invite.createdAt.toISOString(),
    createdBy: invite.createdBy,
    customSlug: invite.customSlug ?? null,
    description: invite.description ?? invite.notes ?? null,
    discordInviteId: invite.discordInviteId ?? null,
    expiresAt: invite.expiresAt?.toISOString() ?? null,
    footerText: invite.footerText ?? "NexTech",
    guildId: invite.guildId ?? null,
    guildName: invite.guildName ?? null,
    id: invite._id,
    imageUrl: invite.imageUrl ?? null,
    inviteUrl: invite.inviteUrl ?? normalizeInviteUrl(null, invite.code),
    landingPageEnabled: invite.landingPageEnabled ?? true,
    landingPageTheme: invite.landingPageTheme ?? "nextech",
    lastAccessAt: invite.lastAccessAt?.toISOString() ?? null,
    lastAccess: invite.lastAccess ?? null,
    logChannelId: invite.logChannelId ?? null,
    logoUrl: invite.logoUrl ?? null,
    maxUses: invite.maxUses,
    name: invite.name,
    notes: invite.notes,
    overlayStyle: invite.overlayStyle ?? "black",
    pageViews: invite.pageViews ?? 0,
    appOpenClicks: invite.appOpenClicks ?? 0,
    browserOpenClicks: invite.browserOpenClicks ?? 0,
    particleStyle: invite.particleStyle ?? "hex",
    panelChannelId: invite.panelChannelId ?? null,
    panelColor: invite.panelColor ?? "#FFD500",
    panelMessageId: invite.panelMessageId ?? null,
    panelTitle: invite.panelTitle ?? "NEXTTECH",
    permissions: invite.permissions ?? {},
    remainingUses: invite.maxUses === null ? null : Math.max(invite.maxUses - invite.usedCount, 0),
    showInviteCode: invite.showInviteCode !== false,
    showMemberCount: invite.showMemberCount !== false,
    showOnlineCount: invite.showOnlineCount !== false,
    showServerDescription: invite.showServerDescription !== false,
    showServerName: invite.showServerName !== false,
    showVerificationBadges: invite.showVerificationBadges !== false,
    status: invite.status,
    statsChannelId: invite.statsChannelId ?? null,
    updatedAt: invite.updatedAt.toISOString(),
    updatedBy: invite.updatedBy,
    usages: invite.usages.map((usage) => ({ ...usage, usedAt: usage.usedAt.toISOString() })),
    usedCount: invite.usedCount,
    videoUrl: invite.videoUrl ?? null
  };
}

function logDto(log: MongoNexTechInviteLog): NexTechInviteLogDto {
  return {
    action: log.action,
    actorId: log.actorId,
    actorName: log.actorName,
    createdAt: log.createdAt.toISOString(),
    data: log.data,
    guildId: log.guildId,
    guildName: log.guildName,
    id: log._id,
    inviteCode: log.inviteCode,
    inviteId: log.inviteId
  };
}

function normalizeInviteCode(value: string | null | undefined) {
  return normalizeText(value ?? "", 80).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
}

function normalizeSlug(value: string | null | undefined) {
  const normalized = normalizeText(value ?? "", 80)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || null;
}

function inviteCodeFromUrl(value: string | null | undefined) {
  const normalized = normalizeText(value ?? "", 2048);
  const match = normalized.match(/(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)([a-z0-9-]+)/i);
  return match?.[1] ?? normalized;
}

function normalizeMaxUses(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  return Math.min(Math.max(Math.trunc(value), 1), 100000);
}

function normalizeNullableText(value: string | null | undefined, max: number) {
  const normalized = normalizeText(value ?? "", max);
  return normalized || null;
}

function normalizeOptionalDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeText(value: string, max: number) {
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function normalizeSnowflake(value: string | null | undefined) {
  const normalized = normalizeText(value ?? "", 32);
  return /^\d{5,32}$/.test(normalized) ? normalized : null;
}

function normalizeBotId(value: string | null | undefined) {
  const normalized = normalizeText(value ?? "", 120);
  return /^[a-z0-9_-]{3,120}$/i.test(normalized) ? normalized : null;
}

function normalizeNullableUrl(value: string | null | undefined) {
  const normalized = normalizeText(value ?? "", 2048);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeInviteUrl(value: string | null | undefined, fallbackCode: string) {
  const normalized = normalizeNullableUrl(value);
  if (normalized) return normalized;
  return fallbackCode ? `https://discord.gg/${fallbackCode}` : null;
}

function normalizeColor(value: string | null | undefined) {
  const normalized = normalizeText(value ?? "", 24);
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : "#FFD500";
}

function normalizeEnum<const T extends readonly string[]>(value: T[number] | string | null | undefined, allowed: T, fallback: T[number]): T[number] {
  return allowed.includes(value as T[number]) ? value as T[number] : fallback;
}

async function fetchDiscordInvite(code: string) {
  const safeCode = normalizeInviteCode(code);
  if (!safeCode) return null;
  try {
    const response = await fetch(`https://discord.com/api/v10/invites/${encodeURIComponent(safeCode)}?with_counts=true&with_expiration=true`, {
      headers: { accept: "application/json" }
    });
    if (!response.ok) return null;
    const payload = await response.json() as DiscordInviteResponse;
    const guild = payload.guild;
    if (!guild) return null;
    const features = Array.isArray(guild.features) ? guild.features : [];
    return {
      approximateMemberCount: Number.isFinite(payload.approximate_member_count) ? payload.approximate_member_count ?? null : null,
      approximatePresenceCount: Number.isFinite(payload.approximate_presence_count) ? payload.approximate_presence_count ?? null : null,
      bannerUrl: discordAssetUrl(guild.id, "banners", guild.banner),
      code: payload.code ?? safeCode,
      description: guild.description ?? null,
      features,
      guildId: guild.id ?? null,
      iconUrl: discordAssetUrl(guild.id, "icons", guild.icon),
      name: guild.name ?? "Servidor Discord",
      partnered: features.includes("PARTNERED"),
      splashUrl: discordAssetUrl(guild.id, "splashes", guild.splash),
      vanityUrlCode: guild.vanity_url_code ?? null,
      verified: features.includes("VERIFIED")
    };
  } catch {
    return null;
  }
}

function discordAssetUrl(guildId: string | undefined, type: "icons" | "banners" | "splashes", hash: string | null | undefined) {
  if (!guildId || !hash) return null;
  const extension = hash.startsWith("a_") ? "gif" : "webp";
  return `https://cdn.discordapp.com/${type}/${guildId}/${hash}.${extension}?size=512`;
}

function maskIp(value: string | null) {
  if (!value) return null;
  if (value.includes(":")) return value.split(":").slice(0, 3).join(":") + "::";
  const parts = value.split(".");
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0` : null;
}

function parseUserAgent(value: string | null) {
  const ua = value ?? "";
  const browser = /edg\//i.test(ua) ? "Edge" : /chrome\//i.test(ua) ? "Chrome" : /firefox\//i.test(ua) ? "Firefox" : /safari\//i.test(ua) ? "Safari" : null;
  const os = /windows/i.test(ua) ? "Windows" : /android/i.test(ua) ? "Android" : /iphone|ipad|ios/i.test(ua) ? "iOS" : /mac os/i.test(ua) ? "macOS" : /linux/i.test(ua) ? "Linux" : null;
  const device = /mobile|android|iphone/i.test(ua) ? "mobile" : /ipad|tablet/i.test(ua) ? "tablet" : "desktop";
  return { browser, device, os };
}

function normalizePermissions(value: SaveNexTechInviteInput["permissions"]) {
  const roles: MongoNexTechInvitePermissionRole[] = ["administrator", "manager", "moderator", "viewer"];
  const permissions: Partial<Record<MongoNexTechInvitePermissionRole, string[]>> = {};

  for (const role of roles) {
    const ids = value?.[role] ?? [];
    permissions[role] = [...new Set(ids.map((id) => normalizeSnowflake(id)).filter((id): id is string => Boolean(id)))].slice(0, 50);
  }

  return permissions;
}

function inviteScopeFilter(scope: Scope) {
  const botId = normalizeBotId(scope.botId);
  const guildId = normalizeSnowflake(scope.guildId);
  const filter: Filter<MongoNexTechInvite> = {};
  if (botId) filter.botId = botId;
  if (guildId) filter.guildId = guildId;
  return filter;
}

function logScopeFilter(scope: Scope) {
  const guildId = normalizeSnowflake(scope.guildId);
  const filter: Filter<MongoNexTechInviteLog> = {};
  if (guildId) filter.guildId = guildId;
  return filter;
}

function isDuplicateKey(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === 11000;
}

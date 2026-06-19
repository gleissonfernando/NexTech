import { randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import { env } from "../config/env";
import {
  getMongoCollections,
  type MongoGiveaway,
  type MongoGiveawayKickEvent,
  type MongoGiveawayParticipant,
  type MongoGiveawayParticipantMode,
  type MongoGiveawayPlatformAccount,
  type MongoGiveawayParticipantSource
} from "../database/mongo";
import { decryptSecret, encryptSecret } from "./secretCryptoService";
import {
  getTwitchFollowers,
  getTwitchSubscribers,
  refreshTwitchOAuthToken,
  verifyTwitchGiveawayUser,
  type TwitchConnectedUser,
  type TwitchUserVerification
} from "./twitchService";
import { getKickChannel, normalizeKickChannel, refreshKickOAuthToken, type KickConnectedUser } from "./kickService";

export type GiveawayConnectedAccountDto = {
  id: string;
  platform: MongoGiveawayParticipantSource;
  platformUserId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  scopes: string[];
  lastVerifiedAt: string | null;
};

export type GiveawayEntryVerification = {
  account: GiveawayConnectedAccountDto;
  eligible: boolean;
  participant: MongoGiveawayParticipant;
  reason: string | null;
};

export type GiveawayParticipantSyncResult = {
  participants: MongoGiveawayParticipant[];
  removed: MongoGiveawayParticipant[];
  summary: {
    kickEvents: number;
    previousEntries: number;
    twitchFollowers: number;
    twitchSubscribers: number;
  };
};

export type RecordedKickGiveawayWebhookEvent = {
  broadcasterUserId: string | null;
  channelSlug: string | null;
  displayName: string;
  isFollower: boolean;
  isSubscriber: boolean;
  isViewer: boolean;
  userId: string;
  username: string;
};

const MAX_PLATFORM_PARTICIPANTS_PER_SYNC = 5000;

export async function saveTwitchGiveawayAccount(user: TwitchConnectedUser) {
  return saveGiveawayPlatformAccount({
    accessToken: user.accessToken,
    avatar: user.profileImageUrl,
    displayName: user.displayName || user.login,
    expiresAt: user.expiresAt,
    platform: "twitch",
    platformUserId: user.id,
    refreshToken: user.refreshToken,
    scopes: user.scopes,
    username: user.login
  });
}

export async function saveKickGiveawayAccount(user: KickConnectedUser) {
  return saveGiveawayPlatformAccount({
    accessToken: user.accessToken,
    avatar: user.avatar,
    displayName: user.displayName || user.username,
    expiresAt: user.expiresAt,
    platform: "kick",
    platformUserId: user.userId,
    refreshToken: user.refreshToken,
    scopes: user.scopes,
    username: user.username
  });
}

export async function getConnectedGiveawayAccounts(accountIds?: {
  kick?: string;
  twitch?: string;
}) {
  const ids = [accountIds?.twitch, accountIds?.kick].filter((id): id is string => Boolean(id));

  if (!ids.length) {
    return [];
  }

  const { giveawayPlatformAccounts } = await getMongoCollections();
  const accounts = await giveawayPlatformAccounts
    .find({
      _id: {
        $in: ids
      }
    })
    .toArray();

  return accounts.map(toAccountDto);
}

export async function verifyConnectedAccountForGiveaway(giveaway: MongoGiveaway, accountId: string): Promise<GiveawayEntryVerification> {
  const { giveawayPlatformAccounts } = await getMongoCollections();
  const account = await giveawayPlatformAccounts.findOne({
    _id: accountId
  });

  if (!account) {
    throw createIdentityError("Conta conectada nao encontrada.", 404);
  }

  const participant = account.platform === "twitch"
    ? giveaway.twitchBroadcasterId
      ? await verifyTwitchAccountParticipant(giveaway, account)
      : unavailableAccountParticipant(account, "Este sorteio nao usa verificacao Twitch.")
    : giveaway.kickChannelName || giveaway.kickUserId
      ? await verifyKickAccountParticipant(giveaway, account)
      : unavailableAccountParticipant(account, "Este sorteio nao usa verificacao Kick.");
  const eligible = participant.eligible === false ? false : participantIsEligible(participant, giveaway.participantMode ?? "twitch_subs");

  participant.eligible = eligible;
  participant.invalidReason = eligible ? null : participant.invalidReason ?? ineligibleReason(participant, giveaway.participantMode ?? "twitch_subs");

  await giveawayPlatformAccounts.updateOne(
    {
      _id: account._id
    },
    {
      $set: {
        lastVerifiedAt: new Date(),
        updatedAt: new Date()
      }
    }
  );

  return {
    account: toAccountDto(account),
    eligible,
    participant,
    reason: participant.invalidReason ?? null
  };
}

export async function buildSyncedGiveawayParticipants(giveaway: MongoGiveaway): Promise<GiveawayParticipantSyncResult> {
  const participantMode = giveaway.participantMode ?? "twitch_subs";
  const byId = new Map<string, MongoGiveawayParticipant>();
  const previousEntries = giveaway.participants ?? [];
  let twitchSubscribers = 0;
  let twitchFollowers = 0;
  let kickEvents = 0;

  if (modeUsesTwitchSubscribers(participantMode) && giveaway.twitchBroadcasterId) {
    const subscribers = await getTwitchSubscribers({
      broadcasterId: giveaway.twitchBroadcasterId,
      max: MAX_PLATFORM_PARTICIPANTS_PER_SYNC
    }).catch((error) => {
      console.warn("[giveaway:twitch] falha ao buscar subscribers:", error instanceof Error ? error.message : error);
      return [];
    });
    twitchSubscribers = subscribers.length;

    for (const subscriber of subscribers) {
      upsertParticipant(byId, normalizeParticipant({
        displayName: subscriber.displayName,
        follower: false,
        id: platformParticipantId("twitch", subscriber.id),
        isPrime: subscriber.isPrime,
        platform: "twitch",
        platformUserId: subscriber.id,
        source: "twitch",
        subTier: subscriber.subTier,
        subTierLabel: subscriber.subTierLabel,
        subscriber: true,
        username: subscriber.login
      }, participantMode));
    }
  }

  if (modeUsesTwitchFollowers(participantMode) && giveaway.twitchBroadcasterId) {
    const followers = await getTwitchFollowers({
      broadcasterId: giveaway.twitchBroadcasterId,
      max: MAX_PLATFORM_PARTICIPANTS_PER_SYNC
    }).catch((error) => {
      console.warn("[giveaway:twitch] falha ao buscar followers:", error instanceof Error ? error.message : error);
      return [];
    });
    twitchFollowers = followers.length;

    for (const follower of followers) {
      upsertParticipant(byId, fromTwitchVerification(follower, participantMode));
    }
  }

  if (modeUsesKick(participantMode)) {
    const events = await listKickGiveawayEvents(giveaway).catch((error) => {
      console.warn("[giveaway:kick] falha ao listar eventos:", error instanceof Error ? error.message : error);
      return [];
    });
    kickEvents = events.length;

    for (const event of events) {
      upsertParticipant(byId, normalizeParticipant({
        displayName: event.displayName,
        follower: event.isFollower,
        id: platformParticipantId("kick", event.userId),
        isPrime: false,
        platform: "kick",
        platformUserId: event.userId,
        source: "kick",
        subTier: event.isSubscriber ? "kick" : null,
        subTierLabel: event.isSubscriber ? "Kick Sub" : null,
        subscriber: event.isSubscriber,
        username: event.username
      }, participantMode));
    }
  }

  for (const participant of previousEntries) {
    if (!participant.accountId) {
      if (participant.eligible !== false && participantIsEligible(participant, participantMode)) {
        upsertParticipant(byId, participant);
      }
      continue;
    }

    const accountParticipant = await verifyConnectedAccountForGiveaway(giveaway, participant.accountId).catch(() => null);

    if (accountParticipant?.participant) {
      upsertParticipant(byId, accountParticipant.participant);
    }
  }

  const participants = [...byId.values()]
    .filter((participant) => participant.eligible !== false)
    .sort((left, right) => {
      const ticketsDelta = (right.tickets ?? 1) - (left.tickets ?? 1);
      return ticketsDelta || left.displayName.localeCompare(right.displayName);
    });
  const nextIds = new Set(participants.map((participant) => participant.id));
  const removed = previousEntries.filter((participant) => !nextIds.has(participant.id));

  return {
    participants,
    removed,
    summary: {
      kickEvents,
      previousEntries: previousEntries.length,
      twitchFollowers,
      twitchSubscribers
    }
  };
}

export async function recordKickGiveawayWebhookEvent(eventType: string, payload: unknown) {
  const events = parseKickWebhookParticipants(eventType, payload);

  if (!events.length) {
    return {
      events: [] as RecordedKickGiveawayWebhookEvent[],
      recorded: 0
    };
  }

  const { giveawayKickEvents } = await getMongoCollections();
  const recorded: RecordedKickGiveawayWebhookEvent[] = [];

  for (const event of events) {
    const now = new Date();
    const existing = await giveawayKickEvents.findOne({
      broadcasterUserId: event.broadcasterUserId,
      channelSlug: event.channelSlug,
      userId: event.userId
    });
    const set: Partial<MongoGiveawayKickEvent> = {
      avatar: event.avatar,
      displayName: event.displayName,
      isFollower: event.isFollower || existing?.isFollower === true,
      isSubscriber: event.isSubscriber || existing?.isSubscriber === true,
      updatedAt: now,
      username: event.username
    };

    if (event.lastChatAt) set.lastChatAt = event.lastChatAt;
    if (event.lastFollowedAt) set.lastFollowedAt = event.lastFollowedAt;
    if (event.lastSubscribedAt) set.lastSubscribedAt = event.lastSubscribedAt;
    if (event.subExpiresAt !== undefined) set.subExpiresAt = event.subExpiresAt;
    const setOnInsert: Partial<MongoGiveawayKickEvent> = {
      _id: randomUUID(),
      broadcasterUserId: event.broadcasterUserId,
      channelSlug: event.channelSlug,
      createdAt: now,
      userId: event.userId
    };

    if (!("lastChatAt" in set)) setOnInsert.lastChatAt = null;
    if (!("lastFollowedAt" in set)) setOnInsert.lastFollowedAt = null;
    if (!("lastSubscribedAt" in set)) setOnInsert.lastSubscribedAt = null;
    if (!("subExpiresAt" in set)) setOnInsert.subExpiresAt = null;

    await giveawayKickEvents.updateOne(
      {
        broadcasterUserId: event.broadcasterUserId,
        channelSlug: event.channelSlug,
        userId: event.userId
      },
      {
        $set: set,
        $setOnInsert: setOnInsert
      },
      {
        upsert: true
      }
    );

    recorded.push({
      broadcasterUserId: event.broadcasterUserId,
      channelSlug: event.channelSlug,
      displayName: event.displayName,
      isFollower: event.isFollower,
      isSubscriber: event.isSubscriber,
      isViewer: Boolean(event.lastChatAt),
      userId: event.userId,
      username: event.username
    });
  }

  return {
    events: recorded,
    recorded: events.length
  };
}

export function participantTickets(participant: Pick<MongoGiveawayParticipant, "follower" | "isVip" | "subTier" | "subscriber">) {
  if (participant.isVip) {
    return 15;
  }

  if (participant.subscriber) {
    if (participant.subTier === "3000") {
      return 10;
    }

    if (participant.subTier === "2000") {
      return 5;
    }

    return 3;
  }

  if (participant.follower) {
    return 2;
  }

  return 1;
}

export function normalizeGiveawayParticipant(input: Partial<MongoGiveawayParticipant> & {
  displayName: string;
  id: string;
  platform: MongoGiveawayParticipantSource;
  platformUserId: string;
  source: MongoGiveawayParticipantSource;
  username: string;
}, mode: MongoGiveawayParticipantMode): MongoGiveawayParticipant {
  return normalizeParticipant(input, mode);
}

export function participantIsEligible(participant: MongoGiveawayParticipant, mode: MongoGiveawayParticipantMode) {
  if (mode === "all") {
    return true;
  }

  if (mode === "twitch_kick") {
    return Boolean(participant.subscriber || participant.follower);
  }

  if (mode === "twitch_subs") {
    return participant.source === "twitch" && participant.subscriber === true;
  }

  if (mode === "twitch_followers") {
    return participant.source === "twitch" && participant.follower === true;
  }

  if (mode === "twitch_subs_followers") {
    return participant.source === "twitch" && Boolean(participant.subscriber || participant.follower);
  }

  if (mode === "kick_subs") {
    return participant.source === "kick" && participant.subscriber === true;
  }

  if (mode === "kick_followers") {
    return participant.source === "kick" && participant.follower === true;
  }

  return false;
}

export function platformParticipantId(platform: MongoGiveawayParticipantSource, platformUserId: string) {
  return `${platform}:${platformUserId}`;
}

export function toAccountDto(account: MongoGiveawayPlatformAccount): GiveawayConnectedAccountDto {
  return {
    id: account._id,
    avatar: account.avatar,
    displayName: account.displayName,
    lastVerifiedAt: account.lastVerifiedAt?.toISOString() ?? null,
    platform: account.platform,
    platformUserId: account.platformUserId,
    scopes: account.scopes,
    username: account.username
  };
}

async function saveGiveawayPlatformAccount(input: {
  accessToken: string;
  avatar: string | null;
  displayName: string;
  expiresAt: Date | null;
  platform: MongoGiveawayParticipantSource;
  platformUserId: string;
  refreshToken: string | null;
  scopes: string[];
  username: string;
}) {
  const now = new Date();
  const { giveawayPlatformAccounts } = await getMongoCollections();
  const doc: MongoGiveawayPlatformAccount = {
    _id: randomUUID(),
    accessTokenEncrypted: encryptSecret(input.accessToken),
    avatar: input.avatar,
    createdAt: now,
    displayName: input.displayName,
    expiresAt: input.expiresAt,
    lastVerifiedAt: null,
    platform: input.platform,
    platformUserId: input.platformUserId,
    refreshTokenEncrypted: input.refreshToken ? encryptSecret(input.refreshToken) : null,
    scopes: input.scopes,
    updatedAt: now,
    username: input.username
  };

  try {
    const result = await giveawayPlatformAccounts.findOneAndUpdate(
      {
        platform: input.platform,
        platformUserId: input.platformUserId
      },
      {
        $set: {
          accessTokenEncrypted: doc.accessTokenEncrypted,
          avatar: doc.avatar,
          displayName: doc.displayName,
          expiresAt: doc.expiresAt,
          refreshTokenEncrypted: doc.refreshTokenEncrypted,
          scopes: doc.scopes,
          updatedAt: doc.updatedAt,
          username: doc.username
        },
        $setOnInsert: {
          _id: doc._id,
          createdAt: doc.createdAt,
          lastVerifiedAt: doc.lastVerifiedAt,
          platform: doc.platform,
          platformUserId: doc.platformUserId
        }
      },
      {
        returnDocument: "after",
        upsert: true
      }
    );

    return toAccountDto(result ?? doc);
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      const existing = await giveawayPlatformAccounts.findOne({
        platform: input.platform,
        platformUserId: input.platformUserId
      });

      if (existing) {
        return toAccountDto(existing);
      }
    }

    throw error;
  }
}

async function verifyTwitchAccountParticipant(giveaway: MongoGiveaway, account: MongoGiveawayPlatformAccount) {
  const accessToken = await resolvePlatformAccessToken(account);
  const verification = await verifyTwitchGiveawayUser({
    broadcasterId: giveaway.twitchBroadcasterId,
    userAccessToken: accessToken,
    userId: account.platformUserId
  });

  return fromTwitchVerification(verification, giveaway.participantMode ?? "twitch_subs", account._id);
}

async function verifyKickAccountParticipant(giveaway: MongoGiveaway, account: MongoGiveawayPlatformAccount) {
  const event = await findKickEventForUser(giveaway, account.platformUserId);
  const channel = giveaway.kickChannelName ? await getKickChannel(giveaway.kickChannelName).catch(() => null) : null;
  const isOwnChannel = channel?.broadcasterUserId === account.platformUserId;

  return normalizeParticipant({
    accountId: account._id,
    displayName: account.displayName,
    follower: event?.isFollower === true || isOwnChannel,
    id: platformParticipantId("kick", account.platformUserId),
    isPrime: false,
    platform: "kick",
    platformUserId: account.platformUserId,
    source: "kick",
    subTier: event?.isSubscriber ? "kick" : null,
    subTierLabel: event?.isSubscriber ? "Kick Sub" : null,
    subscriber: event?.isSubscriber === true,
    username: account.username
  }, giveaway.participantMode ?? "twitch_subs");
}

function fromTwitchVerification(verification: TwitchUserVerification, mode: MongoGiveawayParticipantMode, accountId?: string): MongoGiveawayParticipant {
  return normalizeParticipant({
    accountId,
    displayName: verification.displayName,
    follower: verification.isFollower,
    id: platformParticipantId("twitch", verification.twitchId),
    isEditor: verification.isEditor,
    isModerator: verification.isModerator,
    isPrime: verification.isPrime,
    isVip: verification.isVip,
    platform: "twitch",
    platformUserId: verification.twitchId,
    source: "twitch",
    subMonths: verification.subMonths,
    subTier: verification.subTier,
    subTierLabel: verification.subTierLabel,
    subscriber: verification.isSubscriber,
    username: verification.username
  }, mode);
}

function unavailableAccountParticipant(account: MongoGiveawayPlatformAccount, reason: string): MongoGiveawayParticipant {
  return {
    accountId: account._id,
    displayName: account.displayName,
    eligible: false,
    follower: false,
    id: platformParticipantId(account.platform, account.platformUserId),
    invalidReason: reason,
    isEditor: false,
    isModerator: false,
    isPrime: false,
    isVip: false,
    platform: account.platform,
    platformUserId: account.platformUserId,
    source: account.platform,
    subMonths: null,
    subTier: null,
    subTierLabel: null,
    subscriber: false,
    tickets: 1,
    username: account.username,
    validatedAt: new Date()
  };
}

function normalizeParticipant(input: Partial<MongoGiveawayParticipant> & {
  displayName: string;
  id: string;
  platform: MongoGiveawayParticipantSource;
  platformUserId: string;
  source: MongoGiveawayParticipantSource;
  username: string;
}, mode: MongoGiveawayParticipantMode): MongoGiveawayParticipant {
  const participant: MongoGiveawayParticipant = {
    id: input.id,
    accountId: input.accountId ?? null,
    displayName: input.displayName,
    eligible: true,
    follower: input.follower === true,
    invalidReason: null,
    isEditor: input.isEditor === true,
    isModerator: input.isModerator === true,
    isPrime: input.isPrime === true,
    isVip: input.isVip === true,
    platform: input.platform,
    platformUserId: input.platformUserId,
    source: input.source,
    subMonths: input.subMonths ?? null,
    subTier: input.subTier ?? null,
    subTierLabel: input.subTierLabel ?? null,
    subscriber: input.subscriber === true,
    tickets: 1,
    username: input.username,
    validatedAt: new Date()
  };

  participant.tickets = participantTickets(participant);
  participant.eligible = participantIsEligible(participant, mode);
  participant.invalidReason = participant.eligible ? null : ineligibleReason(participant, mode);

  return participant;
}

function upsertParticipant(map: Map<string, MongoGiveawayParticipant>, next: MongoGiveawayParticipant) {
  const current = map.get(next.id);

  if (!current) {
    map.set(next.id, next);
    return;
  }

  map.set(next.id, normalizeParticipant({
    ...current,
    ...next,
    follower: current.follower === true || next.follower === true,
    id: next.id,
    isEditor: current.isEditor === true || next.isEditor === true,
    isModerator: current.isModerator === true || next.isModerator === true,
    isVip: current.isVip === true || next.isVip === true,
    platform: next.platform ?? current.platform ?? next.source,
    platformUserId: next.platformUserId ?? current.platformUserId ?? next.id,
    source: next.source,
    subscriber: current.subscriber === true || next.subscriber === true,
    subTier: current.subTier ?? next.subTier,
    subTierLabel: current.subTierLabel ?? next.subTierLabel,
    username: next.username
  }, "all"));
}

async function resolvePlatformAccessToken(account: MongoGiveawayPlatformAccount) {
  const accessToken = decryptSecret(account.accessTokenEncrypted);

  if (!account.expiresAt || account.expiresAt.getTime() > Date.now() + 60_000) {
    return accessToken;
  }

  if (!account.refreshTokenEncrypted) {
    return accessToken;
  }

  const refreshToken = decryptSecret(account.refreshTokenEncrypted);
  const refreshed = account.platform === "twitch"
    ? await refreshTwitchOAuthToken(refreshToken)
    : await refreshKickOAuthToken(refreshToken);
  const now = new Date();
  const { giveawayPlatformAccounts } = await getMongoCollections();

  await giveawayPlatformAccounts.updateOne(
    {
      _id: account._id
    },
    {
      $set: {
        accessTokenEncrypted: encryptSecret(refreshed.accessToken),
        expiresAt: refreshed.expiresIn > 0 ? new Date(Date.now() + refreshed.expiresIn * 1000) : null,
        refreshTokenEncrypted: refreshed.refreshToken ? encryptSecret(refreshed.refreshToken) : account.refreshTokenEncrypted,
        scopes: refreshed.scopes.length ? refreshed.scopes : account.scopes,
        updatedAt: now
      }
    }
  );

  console.info(`[giveaway:${account.platform}] token renovado para conta ${account._id}.`);
  return refreshed.accessToken;
}

async function listKickGiveawayEvents(giveaway: MongoGiveaway) {
  const { giveawayKickEvents } = await getMongoCollections();
  const query = {
    $or: [
      ...(giveaway.kickUserId ? [{ broadcasterUserId: giveaway.kickUserId }] : []),
      ...(giveaway.kickChannelName ? [{ channelSlug: giveaway.kickChannelName }] : [])
    ]
  };

  if (!query.$or.length) {
    return [];
  }

  return giveawayKickEvents
    .find(query)
    .sort({
      updatedAt: -1
    })
    .limit(MAX_PLATFORM_PARTICIPANTS_PER_SYNC)
    .toArray();
}

async function findKickEventForUser(giveaway: MongoGiveaway, userId: string) {
  const { giveawayKickEvents } = await getMongoCollections();
  const query = {
    userId,
    $or: [
      ...(giveaway.kickUserId ? [{ broadcasterUserId: giveaway.kickUserId }] : []),
      ...(giveaway.kickChannelName ? [{ channelSlug: giveaway.kickChannelName }] : [])
    ]
  };

  if (!query.$or.length) {
    return null;
  }

  return giveawayKickEvents.findOne(query);
}

function parseKickWebhookParticipants(eventType: string, payload: unknown) {
  const body = unwrapKickWebhookPayload(payload);
  const broadcaster = readKickUser(body.broadcaster);
  const timestamp = readDate(body.created_at) ?? new Date();
  const expiresAt = readDate(body.expires_at);
  const participants: Array<Omit<MongoGiveawayKickEvent, "_id" | "createdAt" | "updatedAt">> = [];

  if (!broadcaster.userId && !broadcaster.channelSlug) {
    return participants;
  }

  if (eventType === "channel.followed") {
    const follower = readKickUser(body.follower);
    if (follower.userId) {
      participants.push(kickEventFromUser(broadcaster, follower, {
        isFollower: true,
        isSubscriber: false,
        lastFollowedAt: timestamp
      }));
    }
  } else if (eventType === "channel.subscription.new" || eventType === "channel.subscription.renewal") {
    const subscriber = readKickUser(body.subscriber);
    if (subscriber.userId) {
      participants.push(kickEventFromUser(broadcaster, subscriber, {
        isFollower: false,
        isSubscriber: true,
        lastSubscribedAt: timestamp,
        subExpiresAt: expiresAt
      }));
    }
  } else if (eventType === "channel.subscription.gifts") {
    const giftees = Array.isArray(body.giftees) ? body.giftees : [];
    for (const item of giftees) {
      const giftee = readKickUser(item);
      if (giftee.userId) {
        participants.push(kickEventFromUser(broadcaster, giftee, {
          isFollower: false,
          isSubscriber: true,
          lastSubscribedAt: timestamp,
          subExpiresAt: expiresAt
        }));
      }
    }
  } else if (eventType === "chat.message.sent") {
    const sender = readKickUser(body.sender ?? body.chatter ?? body.user);
    if (sender.userId) {
      participants.push(kickEventFromUser(broadcaster, sender, {
        isFollower: false,
        isSubscriber: false,
        lastChatAt: timestamp
      }));
    }
  }

  return participants;
}

function unwrapKickWebhookPayload(payload: unknown) {
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};

  for (const key of ["event", "data", "payload"]) {
    const nested = body[key];

    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const nestedBody = nested as Record<string, unknown>;

      if (
        "broadcaster" in nestedBody
        || "follower" in nestedBody
        || "subscriber" in nestedBody
        || "sender" in nestedBody
      ) {
        return nestedBody;
      }
    }
  }

  return body;
}

function kickEventFromUser(
  broadcaster: ReturnType<typeof readKickUser>,
  user: ReturnType<typeof readKickUser>,
  flags: {
    isFollower: boolean;
    isSubscriber: boolean;
    lastChatAt?: Date | null;
    lastFollowedAt?: Date | null;
    lastSubscribedAt?: Date | null;
    subExpiresAt?: Date | null;
  }
): Omit<MongoGiveawayKickEvent, "_id" | "createdAt" | "updatedAt"> {
  return {
    avatar: user.avatar,
    broadcasterUserId: broadcaster.userId,
    channelSlug: broadcaster.channelSlug,
    displayName: user.displayName,
    isFollower: flags.isFollower,
    isSubscriber: flags.isSubscriber,
    lastChatAt: flags.lastChatAt ?? null,
    lastFollowedAt: flags.lastFollowedAt ?? null,
    lastSubscribedAt: flags.lastSubscribedAt ?? null,
    subExpiresAt: flags.subExpiresAt ?? null,
    userId: user.userId ?? user.username,
    username: user.username
  };
}

function readKickUser(value: unknown) {
  const user = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawUserId = user.user_id ?? user.id;
  const username = String(user.username ?? user.name ?? rawUserId ?? "").trim();
  const channelSlug = normalizeKickChannel(String(user.channel_slug ?? username)) || null;

  return {
    avatar: typeof user.profile_picture === "string" ? user.profile_picture : null,
    channelSlug,
    displayName: username,
    userId: rawUserId === undefined || rawUserId === null ? null : String(rawUserId),
    username
  };
}

function readDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function modeUsesTwitchSubscribers(mode: MongoGiveawayParticipantMode) {
  return ["all", "twitch_kick", "twitch_subs", "twitch_subs_followers"].includes(mode);
}

function modeUsesTwitchFollowers(mode: MongoGiveawayParticipantMode) {
  return ["all", "twitch_kick", "twitch_followers", "twitch_subs_followers"].includes(mode);
}

function modeUsesKick(mode: MongoGiveawayParticipantMode) {
  return ["all", "kick_followers", "kick_subs", "twitch_kick"].includes(mode);
}

function ineligibleReason(participant: MongoGiveawayParticipant, mode: MongoGiveawayParticipantMode) {
  const platform = participant.source === "twitch" ? "Twitch" : "Kick";

  if (mode.endsWith("_subs")) {
    return `Conta ${platform} nao e sub elegivel.`;
  }

  if (mode.endsWith("_followers")) {
    return `Conta ${platform} nao segue o canal.`;
  }

  return `Conta ${platform} nao atende aos filtros do sorteio.`;
}

function createIdentityError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}

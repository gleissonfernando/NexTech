import { ChannelType, PermissionFlagsBits, type Client, type Guild } from "discord.js";
import type { BotContext } from "../types";
import type { AutomatedLogSettings } from "./apiClient";

const CATEGORY_NAME = "Logs Geral";
const LEGACY_CATEGORY_NAMES = ["[Skyfall] - Logs"];
const CHANNELS = {
  absence: "📋・logs-ausência",
  calls: "🔊・logs-call",
  messages: "💬・logs-msg",
  punishment: "🛡️・logs-punição",
  site: "🌐・logs-site",
  verification: "✅・verificação-dc"
} as const;
const LEGACY_CHANNELS: Record<keyof typeof CHANNELS, string[]> = {
  absence: ["logs-ausência", "logs-ausencia"],
  calls: ["logs-call"],
  messages: ["logs-msg"],
  punishment: ["logs-punição", "logs-punicao"],
  site: ["logs-site"],
  verification: ["verificação-dc", "verificacao-dc"]
};

let started = false;
const lastValidationAt = new Map<string, number>();
const lastAttemptAt = new Map<string, number>();

export function startAutomatedLogService(client: Client<true>, context: BotContext) {
  if (started) return;

  started = true;
  void reconcileAll(client, context);

  const timer = setInterval(() => void reconcileAll(client, context), 60_000);
  timer.unref();
}

async function reconcileAll(client: Client<true>, context: BotContext) {
  for (const guild of client.guilds.cache.values()) {
    const settings = await context.api.getAutomatedLogSettings(guild.id).catch(() => null);

    if (!settings?.enabled) continue;

    const requested = !settings.lastSyncedAt || Boolean(settings.lastSyncRequestedAt && settings.lastSyncRequestedAt > settings.lastSyncedAt);
    const missingIds = !settings.categoryId || activeChannelKeys(settings).some((key) => !settings.channels[key]);
    const retryDue = (lastAttemptAt.get(guild.id) ?? 0) < Date.now() - 300_000;
    let shouldSync = requested || (!settings.lastError && missingIds) || (Boolean(settings.lastError) && retryDue);

    if (!shouldSync && (lastValidationAt.get(guild.id) ?? 0) < Date.now() - 300_000) {
      lastValidationAt.set(guild.id, Date.now());
      const ids = [settings.categoryId, ...activeChannelKeys(settings).map((key) => settings.channels[key])].filter(Boolean) as string[];
      const existing = await Promise.all(ids.map((id) => guild.channels.fetch(id).catch(() => null)));
      shouldSync = existing.some((channel) => !channel) || await needsNameSync(guild, settings);
    }

    if (!shouldSync) continue;

    lastAttemptAt.set(guild.id, Date.now());
    await reconcileGuild(guild, context, settings, requested || missingIds).catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[automated-logs] ${guild.id}: ${message}`);
      await context.api.updateAutomatedLogRuntime(guild.id, { lastError: message }).catch(() => null);
    });
  }
}

async function needsNameSync(guild: Guild, settings: AutomatedLogSettings) {
  const all = await guild.channels.fetch();
  const category = settings.categoryId ? all.get(settings.categoryId) : null;

  if (category?.type === ChannelType.GuildCategory && category.name !== CATEGORY_NAME) {
    return true;
  }

  for (const [key, name] of Object.entries(CHANNELS) as Array<[keyof typeof CHANNELS, string]>) {
    const channelId = settings.channels[key];
    const channel = channelId ? all.get(channelId) : null;

    if (channel?.type === ChannelType.GuildText && channel.name !== name) {
      return true;
    }
  }

  return false;
}

async function reconcileGuild(guild: Guild, context: BotContext, settings: AutomatedLogSettings, refreshPermissions: boolean) {
  const me = guild.members.me;

  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    throw new Error("O bot não possui a permissão Gerenciar Canais.");
  }

  const all = await guild.channels.fetch();
  let category = settings.categoryId ? all.get(settings.categoryId) : null;

  if (category?.type !== ChannelType.GuildCategory) {
    category = all.find((channel) => channel?.type === ChannelType.GuildCategory && channel.name === CATEGORY_NAME)
      ?? all.find((channel) => channel?.type === ChannelType.GuildCategory && LEGACY_CATEGORY_NAMES.includes(channel.name))
      ?? null;
  }

  if (!category) {
    category = await guild.channels.create({
      name: CATEGORY_NAME,
      permissionOverwrites: overwrites(guild, settings),
      type: ChannelType.GuildCategory
    });
  } else {
    if (category.name !== CATEGORY_NAME) {
      await category.setName(CATEGORY_NAME, "Renomear categoria automática de logs para Logs Geral").catch(() => null);
    }

    if (refreshPermissions) {
      await category.permissionOverwrites.set(overwrites(guild, settings), "Sincronizar permissões dos logs automáticos");
    }
  }

  const resolved = { ...settings.channels };

  for (const [key, name] of Object.entries(CHANNELS) as Array<[keyof typeof CHANNELS, string]>) {
    if (!settings.enabledChannels[key]) {
      resolved[key] = null;
      continue;
    }

    let channel = resolved[key] ? all.get(resolved[key]!) : null;

    if (channel?.type !== ChannelType.GuildText || channel.parentId !== category.id) {
      channel = all.find((item) => item?.type === ChannelType.GuildText && item.parentId === category.id && item.name === name)
        ?? all.find((item) => item?.type === ChannelType.GuildText && item.parentId === category.id && LEGACY_CHANNELS[key].includes(item.name))
        ?? null;
    }

    if (!channel) {
      channel = await guild.channels.create({
        name,
        parent: category.id,
        permissionOverwrites: overwrites(guild, settings),
        type: ChannelType.GuildText
      });
    } else {
      if (channel.name !== name) {
        await channel.setName(name, "Adicionar emojis aos canais automáticos de logs").catch(() => null);
      }

      if (refreshPermissions) {
        await channel.permissionOverwrites.set(overwrites(guild, settings), "Sincronizar permissões dos logs automáticos");
      }
    }

    resolved[key] = channel.id;
  }

  await context.api.updateAutomatedLogRuntime(guild.id, {
    categoryId: category.id,
    channels: resolved,
    lastError: null,
    synced: true
  });
}

function overwrites(guild: Guild, settings: AutomatedLogSettings) {
  const list: Array<{ id: string; allow?: bigint[]; deny?: bigint[] }> = [
    {
      deny: [PermissionFlagsBits.ViewChannel],
      id: guild.roles.everyone.id
    }
  ];

  if (guild.client.user) {
    list.push({
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ReadMessageHistory
      ],
      id: guild.client.user.id
    });
  }

  for (const roleId of settings.allowedRoleIds) {
    list.push({
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      id: roleId
    });
  }

  return list;
}

export function automatedLogChannelForType(settings: AutomatedLogSettings, type: string) {
  const value = type.toLowerCase();

  if (value.startsWith("message.") || value.includes("spam") || value.includes("link")) return selectedChannel(settings, "messages");
  if (value.startsWith("voice.") || value.includes("call")) return selectedChannel(settings, "calls");
  if (value.includes("verification")) return selectedChannel(settings, "verification");
  if (value.includes("absence") || value.includes("ausencia") || value.includes("fivem.fac")) return selectedChannel(settings, "absence");
  if (value.includes("warning") || value.includes("punish") || value.includes("moderation") || value.includes("security") || value.includes("self_bot") || value.includes("anti-ban")) return selectedChannel(settings, "punishment");

  return selectedChannel(settings, "site");
}

function activeChannelKeys(settings: AutomatedLogSettings) {
  return (Object.keys(CHANNELS) as Array<keyof typeof CHANNELS>).filter((key) => settings.enabledChannels[key]);
}

function selectedChannel(settings: AutomatedLogSettings, key: keyof typeof CHANNELS) {
  return settings.enabledChannels[key] ? settings.channels[key] : null;
}

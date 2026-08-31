import { createHash } from "node:crypto";
import type { Client } from "discord.js";
import { env } from "../config/env";
import { clearGlobalCommands, registerGuildCommands } from "../handlers/commandHandler";
import type { BotContext, BotCommand } from "../types";

type CommandSyncState = {
  commandHash: string;
  commandVersion: number;
  dirty: boolean;
  guildIdsHash: string;
  guildCount: number;
  lastReason: string | null;
  lastSyncedAt: string | null;
  globalCleanupHash: string | null;
};

type SyncOptions = {
  force?: boolean;
};

const COMMAND_SYNC_VERSION = 1;
const COMMAND_SYNC_LEASE_TTL_MS = 120_000;
const COMMAND_SYNC_LEASE_ATTEMPTS = 10;
const stateCache = new Map<string, { state: CommandSyncState | null; expiresAt: number }>();
const inFlight = new Map<string, Promise<void>>();

export async function syncVisibleGuildCommands(client: Client<true>, context: BotContext, reason: string, options: SyncOptions = {}) {
  const botId = client.user.id;
  const key = botId;
  const pending = inFlight.get(key);
  if (pending) {
    await pending;
    return;
  }

  const task = syncVisibleGuildCommandsNow(client, context, reason, options).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, task);
  await task;
}

export function buildCommandSyncSignature(commands: BotCommand[], guildIds: string[]) {
  const payload = {
    commands: commands
      .map((command) => command.data.toJSON())
      .map(normalizeValue)
      .sort((left, right) => ((left as { name?: string }).name ?? "").localeCompare((right as { name?: string }).name ?? "")),
    guildIds: [...new Set(guildIds.map((guildId) => guildId.trim()).filter(Boolean))].sort()
  };

  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export function shouldSkipCommandSync(
  state: CommandSyncState | null,
  input: { commandHash: string; commandVersion: number; guildIdsHash: string; force?: boolean }
) {
  return !input.force
    && Boolean(state)
    && state?.commandHash === input.commandHash
    && state?.commandVersion === input.commandVersion
    && state?.guildIdsHash === input.guildIdsHash
    && !state?.dirty;
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, normalizeValue(item)])
  );
}

async function syncVisibleGuildCommandsNow(client: Client<true>, context: BotContext, reason: string, options: SyncOptions) {
  const commandGuildIds = commandRegistrationGuildIds(client);
  const commands = visibleCommands([...context.commands.values()]);
  const commandHash = buildCommandSyncSignature(commands, commandGuildIds);
  const guildIdsHash = createHash("sha256").update(commandGuildIds.join(",")).digest("hex");
  const currentState = await loadCommandSyncState(context, client.user.id);
  let lastError: unknown = null;

  if (shouldSkipCommandSync(currentState, {
    commandHash,
    commandVersion: COMMAND_SYNC_VERSION,
    force: options.force,
    guildIdsHash
  })) {
    console.log(`[COMMAND_SYNC] SKIPPED — hash unchanged (${reason})`);
    return;
  }

  await withCommandSyncLease(context, client.user.id, reason, async () => {
    if (!currentState || currentState.globalCleanupHash !== commandHash) {
      try {
        await clearGlobalCommands(client.user.id);
        console.log(`[COMMAND_SYNC] global cleanup applied (${reason})`);
      } catch (error) {
        console.warn(`[COMMAND_SYNC] falha ao limpar comandos globais (${reason}):`, error instanceof Error ? error.message : error);
      }
    }

    for (const commandGuildId of commandGuildIds) {
      try {
        await registerGuildCommands(commands, client.user.id, commandGuildId);
        console.log(`[COMMAND_SYNC] guild=${commandGuildId} ok (${reason})`);
      } catch (error) {
        console.warn(`[COMMAND_SYNC] guild=${commandGuildId} falhou (${reason}):`, error instanceof Error ? error.message : error);
        lastError = error;
      }
    }

    if (lastError) {
      throw lastError;
    }

    const nextState: CommandSyncState = {
      commandHash,
      commandVersion: COMMAND_SYNC_VERSION,
      dirty: false,
      guildIdsHash,
      guildCount: commandGuildIds.length,
      globalCleanupHash: commandHash,
      lastReason: reason,
      lastSyncedAt: new Date().toISOString()
    };

    await saveCommandSyncState(context, client.user.id, nextState);
    console.log(`[COMMAND_SYNC] SYNC required (${reason}); commands=${commands.length} guilds=${commandGuildIds.length}`);
  });
}

async function loadCommandSyncState(context: BotContext, botId: string) {
  const cached = stateCache.get(botId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.state;
  }

  try {
    const state = await context.api.getCommandSyncState();
    const nextState = state?.botId === botId ? state.state : null;
    stateCache.set(botId, { state: nextState, expiresAt: Date.now() + 30_000 });
    return nextState;
  } catch (error) {
    console.warn("[COMMAND_SYNC] leitura do estado persistido falhou; seguindo sem skip:", error instanceof Error ? error.message : error);
    return cached?.state ?? null;
  }
}

async function saveCommandSyncState(context: BotContext, botId: string, state: CommandSyncState) {
  stateCache.set(botId, { state, expiresAt: Date.now() + 30_000 });

  try {
    await context.api.saveCommandSyncState(state);
  } catch (error) {
    console.warn("[COMMAND_SYNC] não foi possível persistir o estado do sync:", error instanceof Error ? error.message : error);
  }
}

async function withCommandSyncLease(context: BotContext, botId: string, reason: string, run: () => Promise<void>) {
  let acquired = false;

  try {
    for (let attempt = 1; attempt <= COMMAND_SYNC_LEASE_ATTEMPTS; attempt += 1) {
      const lease = await context.api.acquireCommandSyncLease({ ttlMs: COMMAND_SYNC_LEASE_TTL_MS });

      if (lease.acquired) {
        acquired = true;
        if (attempt > 1) console.log(`[COMMAND_SYNC] lease acquired after ${attempt} attempt(s) (${reason})`);
        await run();
        return;
      }

      const waitMs = commandSyncRetryDelayMs(lease.retryAfterMs, attempt, botId);
      console.log(`[COMMAND_SYNC] aguardando fila global holder=${lease.holderBotId ?? "unknown"} attempt=${attempt}/${COMMAND_SYNC_LEASE_ATTEMPTS} retry=${waitMs}ms (${reason})`);
      await delay(waitMs);
    }

    throw new Error("fila global de command sync ocupada; sync será retomado na próxima reconciliação.");
  } finally {
    if (acquired) {
      await context.api.releaseCommandSyncLease().catch((error) => {
        console.warn("[COMMAND_SYNC] falha ao liberar lease:", error instanceof Error ? error.message : error);
      });
    }
  }
}

export function commandSyncRetryDelayMs(retryAfterMs: number | null | undefined, attempt: number, botId: string) {
  const numericSuffix = Number.parseInt(botId.replace(/\D/g, "").slice(-4), 10);
  const deterministicJitter = Number.isFinite(numericSuffix) ? numericSuffix % 1_000 : 0;
  const exponentialBackoff = Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt - 1));
  const serverDelay = Math.max(1_000, Math.min(30_000, retryAfterMs ?? 1_000));

  return Math.max(serverDelay, exponentialBackoff) + deterministicJitter + Math.floor(Math.random() * 500);
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function commandRegistrationGuildIds(client: Client<true>) {
  const connectedGuildIds = new Set(client.guilds.cache.map((guild) => guild.id));

  return unique([
    ...csv(env.BOT_COMMAND_GUILD_IDS),
    env.BOT_MAIN_GUILD_ID.trim(),
    ...csv(env.DASHBOARD_GUILD_IDS),
    ...client.guilds.cache.map((guild) => guild.id)
  ]).filter((guildId) => connectedGuildIds.has(guildId)).sort();
}

function csv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function visibleCommands(commands: BotCommand[]) {
  return commands;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

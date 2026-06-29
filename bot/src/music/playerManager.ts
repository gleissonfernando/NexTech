import type { Guild, GuildTextBasedChannel, VoiceBasedChannel } from "discord.js";
import type { TrackExceptionEvent, TrackStuckEvent } from "shoukaku";
import type { BotContext } from "../types";
import { updateMusicPanel } from "./panelManager";
import type { MusicConfig, MusicLoopMode, MusicSession, MusicTrack } from "./types";
import { getLavalink } from "./lavalinkManager";
import { resolvePlaybackFallback } from "./searchManager";

const sessions = new Map<string, MusicSession>();

export function getMusicSession(guildId: string) {
  return sessions.get(guildId) ?? null;
}

export async function ensureMusicSession(
  context: BotContext,
  guild: Guild,
  voiceChannel: VoiceBasedChannel,
  textChannel: GuildTextBasedChannel,
  config: MusicConfig
) {
  const existing = sessions.get(guild.id);
  if (existing) {
    if (existing.voiceChannelId !== voiceChannel.id) throw new Error("O player já está ativo em outro canal de voz.");
    existing.textChannel = textChannel;
    existing.config = config;
    existing.logChannelId = config.logChannelId;
    existing.idleDisconnectMs = config.idleDisconnectSeconds * 1000;
    return existing;
  }

  let player;
  try {
    player = await getLavalink().joinVoiceChannel({
      guildId: guild.id,
      channelId: voiceChannel.id,
      shardId: guild.shardId,
      deaf: true,
      mute: false
    });
  } catch (error) {
    console.error(`[music:${guild.id}] falha de conexão Lavalink/call:`, errorDetails(error));
    await context.api.postLog({
      guildId: guild.id,
      type: "music.connection_error",
      message: errorDetails(error),
      metadata: { voiceChannelId: voiceChannel.id, source: "lavalink" }
    }).catch(() => undefined);
    throw new Error(`Não foi possível conectar ao canal de voz pelo Lavalink: ${errorMessage(error)}`);
  }

  const session: MusicSession = {
    guild,
    config,
    voiceChannelId: voiceChannel.id,
    textChannel,
    player,
    current: null,
    queue: [],
    history: [],
    loopMode: "off",
    shuffled: false,
    volume: config.defaultVolume,
    logChannelId: config.logChannelId,
    panelMessage: null,
    idleTimer: null,
    aloneTimer: null,
    playbackTimer: null,
    trackEndTimer: null,
    idleDisconnectMs: config.idleDisconnectSeconds * 1000,
    stopping: false,
    recovering: false,
    suppressedEndTrack: null
  };
  sessions.set(guild.id, session);

  player.on("start", () => {
    clearPlaybackTimer(session);
    scheduleTrackLimit(context, session);
    if (session.current) void writeMusicLog(context, session, "music.track_started", `${session.current.title} | ${session.current.url}`);
  });
  player.on("end", (event) => {
    clearPlaybackTimer(session);
    clearTrackEndTimer(session);
    if (session.suppressedEndTrack === event.track.encoded) {
      session.suppressedEndTrack = null;
      return;
    }
    if (session.stopping || session.recovering || event.reason === "replaced") return;
    void advanceQueue(context, session).catch((error) => console.error(`[music:${guild.id}] falha ao avançar fila:`, errorDetails(error)));
  });
  player.on("exception", (event) => recoverFromPlayerEvent(context, session, event));
  player.on("stuck", (event) => recoverFromPlayerEvent(context, session, event));
  player.on("closed", (event) => {
    console.error(`[music:${guild.id}] websocket de voz fechado: code=${event.code} remote=${event.byRemote} reason=${event.reason}`);
  });
  return session;
}

export async function addTracks(context: BotContext, session: MusicSession, tracks: MusicTrack[], config: MusicConfig) {
  clearIdleTimer(session);
  const recent = session.history.slice(-20);
  const existingKeys = new Set(
    [session.current, ...session.queue, ...recent]
      .filter((track): track is MusicTrack => Boolean(track))
      .flatMap((track) => [track.url.toLowerCase(), `${track.title}|${track.author}`.toLowerCase()])
  );
  const capacity = Math.max(0, config.queueLimit - session.queue.length - (session.current ? 1 : 0));
  if (capacity <= 0) throw new Error("A fila atingiu o limite configurado.");
  const accepted: MusicTrack[] = [];
  for (const track of tracks) {
    const keys = [track.url.toLowerCase(), `${track.title}|${track.author}`.toLowerCase()];
    if (keys.some((key) => existingKeys.has(key))) continue;
    accepted.push(track);
    keys.forEach((key) => existingKeys.add(key));
    if (accepted.length >= capacity) break;
  }
  if (!accepted.length) throw new Error("As músicas encontradas já estão na fila.");
  session.queue.push(...accepted);
  if (!session.current) await playNext(context, session);
  await updateMusicPanel(session);
  return accepted;
}

export async function pauseMusic(session: MusicSession) {
  if (!session.current || session.player.paused) return false;
  await session.player.setPaused(true);
  return true;
}

export async function resumeMusic(session: MusicSession) {
  if (!session.current || !session.player.paused) return false;
  await session.player.setPaused(false);
  return true;
}

export async function skipMusic(session: MusicSession) {
  if (!session.current) return false;
  await session.player.stopTrack();
  return true;
}

export async function stopMusicSession(context: BotContext, session: MusicSession, reason: string) {
  if (session.stopping) return;
  session.stopping = true;
  clearIdleTimer(session);
  clearAloneTimer(session);
  clearPlaybackTimer(session);
  clearTrackEndTimer(session);
  session.queue = [];
  session.current = null;
  await getLavalink().leaveVoiceChannel(session.guild.id).catch((error) => {
    console.warn(`[music:${session.guild.id}] falha ao sair da call:`, errorDetails(error));
  });
  sessions.delete(session.guild.id);
  await updateMusicPanel(session);
  await writeMusicLog(context, session, "music.stopped", reason);
}

export async function changeVolume(context: BotContext, session: MusicSession, deltaOrValue: number, absolute = false) {
  session.volume = Math.max(10, Math.min(100, absolute ? deltaOrValue : session.volume + deltaOrValue));
  await session.player.setGlobalVolume(session.volume);
  await updateMusicPanel(session);
  await writeMusicLog(context, session, "music.volume_changed", `Volume alterado para ${session.volume}%.`);
  return session.volume;
}

export async function cycleLoop(context: BotContext, session: MusicSession) {
  const modes: MusicLoopMode[] = ["off", "track", "queue"];
  session.loopMode = modes[(modes.indexOf(session.loopMode) + 1) % modes.length] ?? "off";
  await updateMusicPanel(session);
  await writeMusicLog(context, session, "music.loop_changed", `Loop alterado para ${session.loopMode}.`);
  return session.loopMode;
}

export async function shuffleQueue(session: MusicSession) {
  for (let index = session.queue.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [session.queue[index], session.queue[target]] = [session.queue[target]!, session.queue[index]!];
  }
  session.shuffled = true;
  await updateMusicPanel(session);
}

export async function clearMusicQueue(session: MusicSession) {
  const removed = session.queue.length;
  session.queue = [];
  await updateMusicPanel(session);
  return removed;
}

export function updateAloneState(context: BotContext, session: MusicSession, hasHumanListeners: boolean) {
  if (hasHumanListeners) {
    clearAloneTimer(session);
    return;
  }
  if (session.aloneTimer) return;
  session.aloneTimer = setTimeout(() => {
    session.aloneTimer = null;
    void stopMusicSession(context, session, "Saí do canal porque não havia mais ninguém ouvindo.").catch((error) => {
      console.warn(`[music:${session.guild.id}] falha ao encerrar sessão vazia:`, errorDetails(error));
    });
  }, 60_000);
  session.aloneTimer.unref();
}

async function advanceQueue(context: BotContext, session: MusicSession) {
  const finished = session.current;
  session.current = null;
  if (finished) {
    await writeMusicLog(context, session, "music.track_finished", `${finished.title} foi finalizada.`, finished);
    if (session.loopMode === "track") session.queue.unshift(finished);
    else if (session.loopMode === "queue") session.queue.push(finished);
    else session.history.push(finished);
  }
  await playNext(context, session);
}

async function playNext(context: BotContext, session: MusicSession) {
  const track = session.queue.shift() ?? null;
  if (!track) {
    session.current = null;
    await updateMusicPanel(session);
    session.idleTimer = setTimeout(() => {
      session.idleTimer = null;
      void session.textChannel.send("📭 A fila acabou. Saindo do canal de voz.").catch(() => undefined);
      void stopMusicSession(context, session, `Fila encerrada após ${Math.round(session.idleDisconnectMs / 1000)} segundos.`).catch((error) => {
        console.warn(`[music:${session.guild.id}] falha ao encerrar fila vazia:`, errorDetails(error));
      });
    }, session.idleDisconnectMs);
    session.idleTimer.unref();
    return;
  }

  session.current = track;
  console.log(`[music:${session.guild.id}] reprodução solicitada: url=${track.url} fonte=${track.provider} título=${track.title}`);
  try {
    await session.player.playTrack({ track: { encoded: track.encoded }, volume: session.volume });
    session.playbackTimer = setTimeout(() => {
      session.playbackTimer = null;
      if (!session.recovering && !session.stopping) void recoverTrackFailure(context, session, track, new Error("O Lavalink não iniciou a faixa em 20 segundos."));
    }, 20_000);
    session.playbackTimer.unref();
    await updateMusicPanel(session);
    await session.textChannel.send(`🎶 Tocando agora: **${track.title}**`).catch(() => undefined);
  } catch (error) {
    await recoverTrackFailure(context, session, track, error);
  }
}

function recoverFromPlayerEvent(context: BotContext, session: MusicSession, event: TrackExceptionEvent | TrackStuckEvent) {
  const detail = "exception" in event
    ? `Lavalink exception: severity=${event.exception.severity} message=${event.exception.message} cause=${event.exception.cause}`
    : `Lavalink track stuck: thresholdMs=${event.thresholdMs}`;
  void recoverTrackFailure(context, session, session.current, new Error(detail));
}

async function recoverTrackFailure(context: BotContext, session: MusicSession, track: MusicTrack | null, error: unknown) {
  if (session.recovering || session.stopping) return;
  session.recovering = true;
  clearPlaybackTimer(session);
  clearTrackEndTimer(session);
  console.error(`[music:${session.guild.id}] falha real do player: url=${track?.url ?? "n/a"} fonte=${track?.provider ?? "n/a"}`, errorDetails(error));
  await writeMusicLog(context, session, "music.play_error", errorDetails(error), track);
  session.current = null;

  try {
    if (track) {
      const fallback = await resolvePlaybackFallback(track, session.config);
      session.queue.unshift(fallback);
      await writeMusicLog(context, session, "music.fallback_loaded", `${track.title} será tentada via ${fallback.provider} (${fallback.url}).`, track);
      await session.textChannel.send("⚠️ A fonte original falhou. Tentando uma busca alternativa pela música.").catch(() => undefined);
    } else {
      await session.textChannel.send("❌ O player falhou sem identificar a faixa; avançando a fila.").catch(() => undefined);
    }
  } catch (fallbackError) {
    console.error(`[music:${session.guild.id}] todas as fontes falharam:`, errorDetails(fallbackError));
    await writeMusicLog(context, session, "music.fallback_error", errorDetails(fallbackError), track);
    await session.textChannel.send("❌ Não consegui tocar essa música em nenhuma fonte. Pulando para a próxima.").catch(() => undefined);
  } finally {
    session.suppressedEndTrack = track?.encoded ?? null;
    await session.player.stopTrack().catch(() => undefined);
    session.recovering = false;
  }
  await playNext(context, session);
}

function scheduleTrackLimit(context: BotContext, session: MusicSession) {
  clearTrackEndTimer(session);
  const maximumMs = session.current?.durationMs
    ? Math.min(session.current.durationMs + 30_000, session.config.maxTrackMinutes * 60_000)
    : session.config.maxTrackMinutes * 60_000;
  session.trackEndTimer = setTimeout(() => {
    session.trackEndTimer = null;
    void writeMusicLog(context, session, "music.duration_limit", "A faixa atingiu o limite máximo configurado.");
    void session.player.stopTrack();
  }, maximumMs);
  session.trackEndTimer.unref();
}

async function writeMusicLog(context: BotContext, session: MusicSession, type: string, message: string, track = session.current) {
  console.log(`[music:${session.guild.id}] ${type}: ${message}`);
  await context.api.postLog({
    guildId: session.guild.id,
    type,
    message: message.slice(0, 4000),
    metadata: { channelId: session.voiceChannelId, track: track?.title ?? null, url: track?.url ?? null, provider: track?.provider ?? null }
  }).catch(() => undefined);
  if (session.logChannelId) {
    const channel = await session.guild.channels.fetch(session.logChannelId).catch(() => null);
    if (channel && "send" in channel && typeof channel.send === "function") {
      await channel.send(`🎵 **${type}**\n${message.slice(0, 1800)}`).catch(() => undefined);
    }
  }
}

function errorDetails(error: unknown) {
  if (error instanceof Error) return error.stack ?? error.message;
  if (error && typeof error === "object") {
    try { return JSON.stringify(error); } catch { return String(error); }
  }
  return String(error);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function clearIdleTimer(session: MusicSession) { if (session.idleTimer) clearTimeout(session.idleTimer); session.idleTimer = null; }
function clearAloneTimer(session: MusicSession) { if (session.aloneTimer) clearTimeout(session.aloneTimer); session.aloneTimer = null; }
function clearPlaybackTimer(session: MusicSession) { if (session.playbackTimer) clearTimeout(session.playbackTimer); session.playbackTimer = null; }
function clearTrackEndTimer(session: MusicSession) { if (session.trackEndTimer) clearTimeout(session.trackEndTimer); session.trackEndTimer = null; }

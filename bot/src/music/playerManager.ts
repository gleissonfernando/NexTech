import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel
} from "@discordjs/voice";
import type { Guild, GuildTextBasedChannel, VoiceBasedChannel } from "discord.js";
import type { BotContext } from "../types";
import { updateMusicPanel } from "./panelManager";
import type { MusicConfig, MusicLoopMode, MusicSession, MusicTrack } from "./types";
import { createTrackStream } from "./streamManager";
import { resolveSoundCloudFallback } from "./searchManager";

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

  const connection = joinVoiceChannel({
    adapterCreator: guild.voiceAdapterCreator,
    channelId: voiceChannel.id,
    guildId: guild.id,
    group: "music",
    selfDeaf: true,
    selfMute: false
  });
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
  } catch (error) {
    connection.destroy();
    console.warn(`[music] não foi possível conectar em ${guild.id}:`, error instanceof Error ? error.message : error);
    await context.api.postLog({
      guildId: guild.id,
      type: "music.connection_error",
      message: error instanceof Error ? error.message : String(error),
      metadata: { voiceChannelId: voiceChannel.id }
    }).catch(() => undefined);
    throw new Error("Não foi possível conectar ao canal de voz.");
  }

  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  connection.subscribe(player);
  const session: MusicSession = {
    guild,
    config,
    voiceChannelId: voiceChannel.id,
    textChannel,
    player,
    connection,
    current: null,
    queue: [],
    history: [],
    loopMode: "off",
    shuffled: false,
    volume: config.defaultVolume,
    logChannelId: config.logChannelId,
    resource: null,
    panelMessage: null,
    idleTimer: null,
    aloneTimer: null,
    playbackTimer: null,
    trackEndTimer: null,
    idleDisconnectMs: config.idleDisconnectSeconds * 1000,
    stopping: false,
    recovering: false
  };
  sessions.set(guild.id, session);

  player.on(AudioPlayerStatus.Idle, () => {
    clearPlaybackTimer(session);
    clearTrackEndTimer(session);
    if (!session.stopping && !session.recovering) void advanceQueue(context, session).catch((error) => {
      console.warn(`[music] falha ao avançar fila ${guild.id}:`, error instanceof Error ? error.message : error);
    });
  });
  player.on(AudioPlayerStatus.Playing, () => {
    clearPlaybackTimer(session);
    clearTrackEndTimer(session);
    const maximumMs = session.current?.durationMs
      ? Math.min(session.current.durationMs + 30_000, session.config.maxTrackMinutes * 60_000)
      : session.config.maxTrackMinutes * 60_000;
    session.trackEndTimer = setTimeout(() => {
      session.trackEndTimer = null;
      void writeMusicLog(context, session, "music.duration_limit", "A faixa atingiu o limite máximo configurado.");
      session.player.stop(true);
    }, maximumMs);
    session.trackEndTimer.unref();
  });
  player.on("error", (error) => {
    console.warn(`[music] erro no player ${guild.id}:`, error.message);
    if (session.stopping || session.recovering) return;
    session.recovering = true;
    const failed = session.current;
    void recoverTrackFailure(context, session, failed, error)
      .catch((fallbackError) => console.warn(`[music] fallback falhou em ${guild.id}:`, fallbackError instanceof Error ? fallbackError.message : fallbackError))
      .finally(() => { session.recovering = false; });
  });
  connection.on(VoiceConnectionStatus.Disconnected, () => {
    void Promise.race([
      entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
      entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
    ]).catch(() => {
      void stopMusicSession(context, session, "Conexão de voz encerrada.").catch((error) => {
        console.warn(`[music] falha ao limpar conexão ${guild.id}:`, error instanceof Error ? error.message : error);
      });
    });
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
  if (!accepted.length) throw new Error(capacity <= 0 ? "A fila atingiu o limite configurado." : "As músicas encontradas já estão na fila.");
  session.queue.push(...accepted);
  if (!session.current) await playNext(context, session);
  await updateMusicPanel(session);
  return accepted;
}

export function pauseMusic(session: MusicSession) {
  return session.player.pause();
}

export function resumeMusic(session: MusicSession) {
  return session.player.unpause();
}

export function skipMusic(session: MusicSession) {
  if (!session.current) return false;
  session.player.stop(true);
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
  session.resource = null;
  session.player.stop(true);
  if (session.connection.state.status !== VoiceConnectionStatus.Destroyed) {
    session.connection.destroy();
  }
  sessions.delete(session.guild.id);
  await updateMusicPanel(session);
  await writeMusicLog(context, session, "music.stopped", reason);
}

export async function changeVolume(context: BotContext, session: MusicSession, deltaOrValue: number, absolute = false) {
  session.volume = Math.max(10, Math.min(100, absolute ? deltaOrValue : session.volume + deltaOrValue));
  session.resource?.volume?.setVolume(session.volume / 100);
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
      console.warn(`[music] falha ao encerrar sessão sozinha ${session.guild.id}:`, error instanceof Error ? error.message : error);
    });
  }, 60_000);
  session.aloneTimer.unref();
}

async function advanceQueue(context: BotContext, session: MusicSession) {
  const finished = session.current;
  session.current = null;
  session.resource = null;
  if (finished) {
    await writeMusicLog(context, session, "music.track_finished", `${finished.title} foi finalizada.`);
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
        console.warn(`[music] falha ao encerrar fila vazia ${session.guild.id}:`, error instanceof Error ? error.message : error);
      });
    }, session.idleDisconnectMs);
    session.idleTimer.unref();
    return;
  }

  try {
    const input = await createTrackStream(track);
    const resource = createAudioResource(input.stream, {
      inlineVolume: true,
      inputType: input.inputType,
      metadata: track
    });
    resource.volume?.setVolume(session.volume / 100);
    session.current = track;
    session.resource = resource;
    session.player.play(resource);
    session.playbackTimer = setTimeout(() => {
      session.playbackTimer = null;
      if (session.recovering || session.stopping) return;
      session.recovering = true;
      session.player.stop(true);
      void recoverTrackFailure(context, session, track, new Error(`A fonte de áudio não respondeu para ${track.title}.`))
        .catch((error) => console.warn(`[music] fallback após timeout falhou em ${session.guild.id}:`, error instanceof Error ? error.message : error))
        .finally(() => { session.recovering = false; });
    }, 20_000);
    session.playbackTimer.unref();
    await updateMusicPanel(session);
    await session.textChannel.send(`🎶 Tocando agora: **${track.title}**`).catch(() => undefined);
    await writeMusicLog(context, session, "music.track_started", `${track.title} | ${track.url}`);
  } catch (error) {
    await recoverTrackFailure(context, session, track, error);
  }
}

async function recoverTrackFailure(context: BotContext, session: MusicSession, track: MusicTrack | null, error: unknown) {
  await writeMusicLog(context, session, "music.play_error", error instanceof Error ? error.message : String(error));
  await session.textChannel.send("❌ Não consegui tocar essa música. Vou tentar outra fonte ou pular para a próxima.").catch(() => undefined);
  clearPlaybackTimer(session);
  clearTrackEndTimer(session);
  session.current = null;
  session.resource = null;

  if (track?.provider === "youtube") {
    try {
      const fallback = await resolveSoundCloudFallback(track, session.config);
      await writeMusicLog(context, session, "music.fallback_loaded", `${track.title} será reproduzida pelo SoundCloud.`);
      session.queue.unshift(fallback);
    } catch (fallbackError) {
      await writeMusicLog(context, session, "music.fallback_error", fallbackError instanceof Error ? fallbackError.message : String(fallbackError));
    }
  }
  await playNext(context, session);
}

async function writeMusicLog(context: BotContext, session: MusicSession, type: string, message: string) {
  console.log(`[music:${session.guild.id}] ${type}: ${message}`);
  await context.api.postLog({
    guildId: session.guild.id,
    type,
    message,
    metadata: {
      channelId: session.voiceChannelId,
      track: session.current?.title ?? null,
      url: session.current?.url ?? null
    }
  }).catch(() => undefined);

  if (session.logChannelId) {
    const channel = await session.guild.channels.fetch(session.logChannelId).catch(() => null);
    if (channel && "send" in channel && typeof channel.send === "function") {
      await channel.send(`🎵 **${type}**\n${message.slice(0, 1800)}`).catch(() => undefined);
    }
  }
}

function clearIdleTimer(session: MusicSession) {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = null;
}

function clearAloneTimer(session: MusicSession) {
  if (session.aloneTimer) clearTimeout(session.aloneTimer);
  session.aloneTimer = null;
}

function clearPlaybackTimer(session: MusicSession) {
  if (session.playbackTimer) clearTimeout(session.playbackTimer);
  session.playbackTimer = null;
}

function clearTrackEndTimer(session: MusicSession) {
  if (session.trackEndTimer) clearTimeout(session.trackEndTimer);
  session.trackEndTimer = null;
}

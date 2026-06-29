import ytdl from "@distube/ytdl-core";
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
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
    existing.logChannelId = config.logChannelId;
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
  await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  connection.subscribe(player);
  const session: MusicSession = {
    guild,
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
    stopping: false
  };
  sessions.set(guild.id, session);

  player.on(AudioPlayerStatus.Idle, () => {
    clearPlaybackTimer(session);
    if (!session.stopping) void advanceQueue(context, session);
  });
  player.on(AudioPlayerStatus.Playing, () => clearPlaybackTimer(session));
  player.on("error", (error) => {
    console.warn(`[music] erro no player ${guild.id}:`, error.message);
    void writeMusicLog(context, session, "music.play_error", error.message);
    if (!session.stopping) session.player.stop(true);
  });
  connection.on(VoiceConnectionStatus.Disconnected, () => {
    void Promise.race([
      entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
      entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
    ]).catch(() => stopMusicSession(context, session, "Conexão de voz encerrada."));
  });
  return session;
}

export async function addTracks(context: BotContext, session: MusicSession, tracks: MusicTrack[], config: MusicConfig) {
  clearIdleTimer(session);
  const existingUrls = new Set([session.current?.url, ...session.queue.map((track) => track.url)].filter(Boolean));
  const capacity = Math.max(0, config.queueLimit - session.queue.length - (session.current ? 1 : 0));
  const accepted = tracks.filter((track) => !existingUrls.has(track.url)).slice(0, capacity);
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
  session.queue = [];
  session.current = null;
  session.resource = null;
  session.player.stop(true);
  session.connection.destroy();
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

export function updateAloneState(context: BotContext, session: MusicSession, hasHumanListeners: boolean) {
  if (hasHumanListeners) {
    clearAloneTimer(session);
    return;
  }
  if (session.aloneTimer) return;
  session.aloneTimer = setTimeout(() => {
    session.aloneTimer = null;
    void stopMusicSession(context, session, "Saí do canal porque não havia mais ninguém ouvindo.");
  }, 60_000);
  session.aloneTimer.unref();
}

async function advanceQueue(context: BotContext, session: MusicSession) {
  const finished = session.current;
  session.current = null;
  session.resource = null;
  if (finished) {
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
      void stopMusicSession(context, session, "Fila encerrada após 30 segundos.");
    }, 30_000);
    session.idleTimer.unref();
    return;
  }

  try {
    const stream = ytdl(track.url, {
      filter: (format) => format.hasAudio && !format.hasVideo && format.container === "webm",
      highWaterMark: 1 << 25,
      quality: "highestaudio"
    });
    const resource = createAudioResource(stream, {
      inlineVolume: true,
      inputType: StreamType.WebmOpus,
      metadata: track
    });
    resource.volume?.setVolume(session.volume / 100);
    session.current = track;
    session.resource = resource;
    session.player.play(resource);
    session.playbackTimer = setTimeout(() => {
      session.playbackTimer = null;
      void writeMusicLog(context, session, "music.play_timeout", `A fonte de áudio não respondeu para ${track.title}.`);
      session.player.stop(true);
    }, 20_000);
    session.playbackTimer.unref();
    await updateMusicPanel(session);
    await writeMusicLog(context, session, "music.track_started", `${track.title} | ${track.url}`);
  } catch (error) {
    await writeMusicLog(context, session, "music.play_error", error instanceof Error ? error.message : String(error));
    session.current = null;
    await playNext(context, session);
  }
}

async function writeMusicLog(context: BotContext, session: MusicSession, type: string, message: string) {
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

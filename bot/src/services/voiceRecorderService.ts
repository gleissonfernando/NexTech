import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import {
  AttachmentBuilder,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type TextBasedChannel,
  type VoiceBasedChannel,
  type VoiceState
} from "discord.js";
import {
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  type VoiceConnection
} from "@discordjs/voice";
import prism from "prism-media";
import ffmpegStatic from "ffmpeg-static";
import { env } from "../config/env";
import type {
  VoiceRecorderSettings,
  VoiceRecording
} from "./apiClient";
import type { BotContext } from "../types";
import type { VoiceRecorderStartEvent, VoiceRecorderStopEvent } from "../websocket/socketClient";

type ParticipantState = {
  userId: string;
  username: string | null;
  joinedAt: Date;
  leftAt: Date | null;
  speakingMs: number;
  speakingStartedAt: number | null;
};

type VoiceRecorderSession = {
  channel: VoiceBasedChannel;
  connection: VoiceConnection;
  filePath: string;
  guild: Guild;
  mixer: PcmMp3Mixer;
  participants: Map<string, ParticipantState>;
  recordingId: string;
  settings: VoiceRecorderSettings;
  startedAt: Date;
  stopping: boolean;
  subscriptions: Set<string>;
};

type StopInput = {
  actorId: string;
  actorRoleIds?: string[];
  actorTag?: string | null;
  trustedDashboard?: boolean;
};

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const FRAME_MS = 20;
const BYTES_PER_SAMPLE = 2;
const FRAME_BYTES = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE * FRAME_MS / 1000;
const STORAGE_ROOT = path.resolve(__dirname, "../../../storage/voice-records");
const activeSessions = new Map<string, VoiceRecorderSession>();
let serviceStarted = false;

export async function startVoiceRecorderService(context: BotContext) {
  if (serviceStarted) {
    return;
  }

  serviceStarted = true;
  context.socket.onVoiceRecorderStart((event) => {
    void handleDashboardStart(event, context);
  });
  context.socket.onVoiceRecorderStop((event) => {
    void handleDashboardStop(event, context);
  });

  try {
    const reconciled = await context.api.reconcileVoiceRecordings();

    if (reconciled.length) {
      console.warn(`[voice-recorder] ${reconciled.length} gravacao(oes) orfa(s) encerrada(s) na inicializacao.`);
    }
  } catch (error) {
    console.warn("[voice-recorder] falha ao reconciliar gravacoes na inicializacao:", readPlainError(error));
  }
}

export async function handleVoiceRecordStartCommand(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) {
    await interaction.reply({
      content: "Comando disponivel apenas em servidores.",
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({
    ephemeral: true
  });

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const voiceChannel = member?.voice.channel ?? null;

  if (!member || !voiceChannel) {
    await interaction.editReply("Entre em um canal de voz antes de iniciar a gravacao.");
    return;
  }

  const permissionError = await validateBotVoicePermissions(voiceChannel);

  if (permissionError) {
    await interaction.editReply(permissionError);
    return;
  }

  if (activeSessions.has(interaction.guild.id)) {
    await interaction.editReply("Ja existe uma gravacao em andamento neste servidor.");
    return;
  }

  const startInput = {
    actorId: interaction.user.id,
    actorRoleIds: memberRoleIds(member),
    actorTag: interaction.user.tag,
    channelId: voiceChannel.id,
    channelName: voiceChannel.name,
    guildId: interaction.guild.id,
    guildName: interaction.guild.name,
    source: "discord" as const
  };
  let startResult: Awaited<ReturnType<typeof context.api.startVoiceRecording>>;

  try {
    startResult = await context.api.startVoiceRecording(startInput);
  } catch (error) {
    if (!isActiveRecordingConflict(error)) {
      await interaction.editReply(readErrorMessage(error, "Nao foi possivel iniciar a gravacao."));
      return;
    }

    try {
      await failOrphanedRecording(context, startInput);
      startResult = await context.api.startVoiceRecording(startInput);
    } catch (recoveryError) {
      await interaction.editReply(readErrorMessage(recoveryError, "Nao foi possivel recuperar a gravacao anterior."));
      return;
    }
  }

  try {
    await startCapture({
      channel: voiceChannel,
      context,
      recordingId: startResult.recording.id,
      settings: startResult.settings
    });
  } catch (error) {
    await context.api.failVoiceRecording(startResult.recording.id, {
      error: readPlainError(error),
      guildId: interaction.guild.id
    }).catch(() => undefined);
    await interaction.editReply(`Nao consegui conectar ao canal de voz: ${readPlainError(error)}`);
    return;
  }

  await interaction.editReply(startMessage(startResult.recording, voiceChannel, interaction.user.tag));
}

export async function handleVoiceRecordStopCommand(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) {
    await interaction.reply({
      content: "Comando disponivel apenas em servidores.",
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({
    ephemeral: true
  });

  const session = activeSessions.get(interaction.guild.id);

  if (!session) {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

    try {
      const failed = await failOrphanedRecording(context, {
        actorId: interaction.user.id,
        actorRoleIds: member ? memberRoleIds(member) : [],
        actorTag: interaction.user.tag,
        guildId: interaction.guild.id
      });
      await interaction.editReply(
        failed
          ? "A gravacao sem conexao com o bot foi encerrada."
          : "Nao existe gravacao em andamento neste servidor."
      );
    } catch (error) {
      await interaction.editReply(readErrorMessage(error, "Nao existe gravacao em andamento neste servidor."));
    }
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

  try {
    await stopSession(context, session, {
      actorId: interaction.user.id,
      actorRoleIds: member ? memberRoleIds(member) : [],
      actorTag: interaction.user.tag
    });
    await interaction.editReply("Gravacao encerrada. O arquivo foi processado e salvo no historico.");
  } catch (error) {
    await interaction.editReply(readErrorMessage(error, "Nao foi possivel encerrar a gravacao."));
  }
}

export async function handleVoiceRecorderVoiceStateUpdate(oldState: VoiceState, newState: VoiceState, context: BotContext) {
  const guildId = newState.guild.id || oldState.guild.id;
  const session = activeSessions.get(guildId);

  if (!session) {
    return;
  }

  const userId = newState.id;
  const oldInChannel = oldState.channelId === session.channel.id;
  const newInChannel = newState.channelId === session.channel.id;
  const botUser = context.client.user;

  if (botUser && userId === botUser.id) {
    if (oldInChannel && !newInChannel && !session.stopping) {
      await context.api.recordVoiceRecordingEvent(session.recordingId, {
        guildId,
        message: "O bot foi desconectado ou movido do canal. A gravacao sera encerrada automaticamente.",
        type: "bot_disconnected",
        userId: botUser.id,
        username: botUser.tag
      }).catch(() => undefined);

      try {
        await stopSession(context, session, {
          actorId: botUser.id,
          actorTag: `${botUser.tag} - desconectado do canal`,
          trustedDashboard: true
        });
      } catch (error) {
        console.warn("[voice-recorder] falha ao finalizar apos desconexao do bot:", readPlainError(error));

        if (activeSessions.get(guildId)?.recordingId === session.recordingId) {
          await abortLocalSession(guildId);
          await context.api.failVoiceRecording(session.recordingId, {
            error: `Bot desconectado do canal: ${readPlainError(error)}`,
            guildId
          }).catch(() => undefined);
        }
      }
    }

    return;
  }

  if (!oldInChannel && newInChannel) {
    const participant = await ensureParticipant(session, userId, newState.member ?? null);
    participant.leftAt = null;
    await context.api.recordVoiceRecordingEvent(session.recordingId, {
      guildId,
      message: `${participant.username ?? userId} entrou no canal de voz.`,
      type: "participant_join",
      userId,
      username: participant.username
    }).catch(() => undefined);
    return;
  }

  if (oldInChannel && !newInChannel) {
    const participant = session.participants.get(userId) ?? await ensureParticipant(session, userId, oldState.member ?? null);
    participant.leftAt = new Date();
    closeSpeakingWindow(participant);
    await context.api.recordVoiceRecordingEvent(session.recordingId, {
      guildId,
      message: `${participant.username ?? userId} saiu do canal de voz.`,
      type: "participant_leave",
      userId,
      username: participant.username
    }).catch(() => undefined);

    if (!session.stopping && !hasHumanParticipants(session.channel)) {
      const systemUser = context.client.user;

      try {
        await stopSession(context, session, {
          actorId: systemUser?.id ?? "0",
          actorTag: `${systemUser?.tag ?? "Bot"} - ultima pessoa saiu da call`,
          trustedDashboard: true
        });
      } catch (error) {
        console.warn("[voice-recorder] falha ao encerrar depois que a call ficou vazia:", readPlainError(error));
      }
    }
  }
}

async function handleDashboardStart(event: VoiceRecorderStartEvent, context: BotContext) {
  if (event.botId && env.DASHBOARD_BOT_ID && event.botId !== env.DASHBOARD_BOT_ID) {
    return;
  }

  const guild = await context.client.guilds.fetch(event.guildId).catch(() => null);

  if (!guild) {
    await context.api.failVoiceRecording(event.recordingId, {
      error: "Bot nao encontrou o servidor da gravacao.",
      guildId: event.guildId
    }).catch(() => undefined);
    return;
  }

  const channel = await guild.channels.fetch(event.channelId).catch(() => null);

  if (!isVoiceBasedChannel(channel)) {
    await context.api.failVoiceRecording(event.recordingId, {
      error: "Canal de voz da gravacao nao encontrado.",
      guildId: event.guildId
    }).catch(() => undefined);
    return;
  }

  try {
    const settings = await context.api.getVoiceRecorderSettings(event.guildId);
    await startCapture({
      channel,
      context,
      recordingId: event.recordingId,
      settings
    });
    await context.api.markVoiceRecordingStarted(event.recordingId, {
      channelName: channel.name,
      guildName: guild.name
    });
  } catch (error) {
    await abortLocalSession(event.guildId);
    await context.api.failVoiceRecording(event.recordingId, {
      error: readPlainError(error),
      guildId: event.guildId
    }).catch(() => undefined);
  }
}

async function handleDashboardStop(event: VoiceRecorderStopEvent, context: BotContext) {
  if (event.botId && env.DASHBOARD_BOT_ID && event.botId !== env.DASHBOARD_BOT_ID) {
    return;
  }

  const session = activeSessions.get(event.guildId);

  if (!session || session.recordingId !== event.recordingId) {
    await context.api.failVoiceRecording(event.recordingId, {
      error: "Bot nao possui uma sessao ativa para encerrar.",
      guildId: event.guildId
    }).catch(() => undefined);
    return;
  }

  try {
    await stopSession(context, session, {
      actorId: event.actorId,
      actorTag: event.actorTag ?? "Dashboard",
      trustedDashboard: true
    });
  } catch (error) {
    await context.api.failVoiceRecording(event.recordingId, {
      error: readPlainError(error),
      guildId: event.guildId
    }).catch(() => undefined);
  }
}

async function startCapture(input: {
  channel: VoiceBasedChannel;
  context: BotContext;
  recordingId: string;
  settings: VoiceRecorderSettings;
}) {
  if (activeSessions.has(input.channel.guild.id)) {
    throw new Error("Ja existe uma gravacao em andamento neste servidor.");
  }

  const connection = joinVoiceChannel({
    adapterCreator: input.channel.guild.voiceAdapterCreator,
    channelId: input.channel.id,
    guildId: input.channel.guild.id,
    selfDeaf: false,
    selfMute: true
  });

  let mixer: PcmMp3Mixer;
  const filePath = recordingFilePath(input.channel.guild.id, input.recordingId, new Date());

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    mixer = await PcmMp3Mixer.create(filePath);
  } catch (error) {
    destroyVoiceConnection(connection);
    throw error;
  }
  const session: VoiceRecorderSession = {
    channel: input.channel,
    connection,
    filePath,
    guild: input.channel.guild,
    mixer,
    participants: new Map(),
    recordingId: input.recordingId,
    settings: input.settings,
    startedAt: new Date(),
    stopping: false,
    subscriptions: new Set()
  };

  activeSessions.set(input.channel.guild.id, session);

  for (const member of input.channel.members.values()) {
    if (!member.user.bot) {
      await ensureParticipant(session, member.id, member);
    }
  }

  connection.receiver.speaking.on("start", (userId) => {
    void subscribeUserAudio(session, userId, input.context);
  });
}

async function stopSession(context: BotContext, session: VoiceRecorderSession, input: StopInput) {
  if (session.stopping) {
    throw new Error("A gravacao ja esta em processo de encerramento.");
  }

  session.stopping = true;

  try {
    if (input.trustedDashboard) {
      await context.api.markDashboardVoiceRecordingProcessing(session.recordingId, {
        actorId: input.actorId,
        actorTag: input.actorTag ?? null,
        guildId: session.guild.id
      });
    } else {
      await context.api.stopVoiceRecording({
        actorId: input.actorId,
        actorRoleIds: input.actorRoleIds ?? [],
        actorTag: input.actorTag ?? null,
        guildId: session.guild.id,
        recordingId: session.recordingId
      });
    }
  } catch (error) {
    session.stopping = false;
    throw error;
  }

  for (const participant of session.participants.values()) {
    if (!participant.leftAt) {
      participant.leftAt = new Date();
    }
    closeSpeakingWindow(participant);
  }

  try {
    await session.mixer.finish();
    destroyVoiceConnection(session.connection);
    const registeredConnection = getVoiceConnection(session.guild.id);

    if (registeredConnection && registeredConnection !== session.connection) {
      destroyVoiceConnection(registeredConnection);
    }

    activeSessions.delete(session.guild.id);

    const stat = await fs.stat(session.filePath);
    const completed = await context.api.completeVoiceRecording(session.recordingId, {
      durationMs: Date.now() - session.startedAt.getTime(),
      endedAt: new Date().toISOString(),
      filePath: session.filePath,
      fileSize: stat.size,
      participants: [...session.participants.values()].map((participant) => ({
        userId: participant.userId,
        username: participant.username,
        joinedAt: participant.joinedAt.toISOString(),
        leftAt: participant.leftAt?.toISOString() ?? null,
        speakingMs: participant.speakingMs
      }))
    });

    await sendRecordingLogEmbed(session, completed).catch((error) => {
      console.warn("[voice-recorder] nao foi possivel enviar embed de log:", readPlainError(error));
    });
  } catch (error) {
    activeSessions.delete(session.guild.id);
    destroyVoiceConnection(session.connection);
    await context.api.failVoiceRecording(session.recordingId, {
      error: readPlainError(error),
      guildId: session.guild.id
    }).catch(() => undefined);
    throw error;
  }
}

async function abortLocalSession(guildId: string) {
  const session = activeSessions.get(guildId);

  if (!session) {
    return;
  }

  activeSessions.delete(guildId);
  destroyVoiceConnection(session.connection);
  await session.mixer.finish().catch(() => undefined);
}

async function failOrphanedRecording(context: BotContext, input: {
  actorId: string;
  actorRoleIds: string[];
  actorTag?: string | null;
  guildId: string;
}) {
  const recording = await context.api.stopVoiceRecording({
    actorId: input.actorId,
    actorRoleIds: input.actorRoleIds,
    actorTag: input.actorTag,
    guildId: input.guildId
  });

  return context.api.failVoiceRecording(recording.id, {
    error: "Bot nao possui uma sessao local de audio ativa.",
    guildId: input.guildId
  });
}

function isActiveRecordingConflict(error: unknown) {
  return readPlainError(error).includes("Ja existe uma gravacao em andamento neste servidor.");
}

function destroyVoiceConnection(connection: VoiceConnection) {
  if (connection.state.status === VoiceConnectionStatus.Destroyed) {
    return;
  }

  try {
    connection.destroy();
  } catch (error) {
    console.warn("[voice-recorder] nao foi possivel destruir a conexao de voz:", readPlainError(error));
  }
}

function hasHumanParticipants(channel: VoiceBasedChannel) {
  return channel.members.some((member) => !member.user.bot);
}

async function subscribeUserAudio(session: VoiceRecorderSession, userId: string, context: BotContext) {
  if (session.stopping || session.subscriptions.has(userId) || userId === context.client.user?.id) {
    return;
  }

  const participant = await ensureParticipant(session, userId, session.channel.members.get(userId) ?? null);
  participant.speakingStartedAt = Date.now();
  session.subscriptions.add(userId);

  const opusStream = session.connection.receiver.subscribe(userId, {
    end: {
      behavior: EndBehaviorType.AfterSilence,
      duration: 1000
    }
  });
  const decoder = new prism.opus.Decoder({
    channels: CHANNELS,
    frameSize: 960,
    rate: SAMPLE_RATE
  });

  opusStream.on("error", (error) => {
    console.warn(`[voice-recorder] stream opus falhou para ${userId}:`, readPlainError(error));
  });
  decoder.on("error", (error) => {
    console.warn(`[voice-recorder] decoder opus falhou para ${userId}:`, readPlainError(error));
  });
  decoder.on("data", (chunk: Buffer) => {
    session.mixer.addPcm(userId, chunk);
  });
  decoder.on("end", () => {
    closeSpeakingWindow(participant);
    session.subscriptions.delete(userId);
  });

  await pipeline(opusStream, decoder).catch((error) => {
    if (!session.stopping) {
      console.warn(`[voice-recorder] pipeline de audio encerrou com falha para ${userId}:`, readPlainError(error));
    }
  });
}

async function ensureParticipant(session: VoiceRecorderSession, userId: string, member: GuildMember | null) {
  const current = session.participants.get(userId);

  if (current) {
    return current;
  }

  const fetchedMember = member ?? await session.guild.members.fetch(userId).catch(() => null);
  const participant: ParticipantState = {
    userId,
    username: fetchedMember?.user.tag ?? fetchedMember?.displayName ?? null,
    joinedAt: new Date(),
    leftAt: null,
    speakingMs: 0,
    speakingStartedAt: null
  };

  session.participants.set(userId, participant);
  return participant;
}

function closeSpeakingWindow(participant: ParticipantState) {
  if (!participant.speakingStartedAt) {
    return;
  }

  participant.speakingMs += Math.max(0, Date.now() - participant.speakingStartedAt);
  participant.speakingStartedAt = null;
}

async function validateBotVoicePermissions(channel: VoiceBasedChannel) {
  const botMember = channel.guild.members.me ?? await channel.guild.members.fetchMe().catch(() => null);

  if (!botMember) {
    return "Nao consegui validar minhas permissoes no servidor.";
  }

  const permissions = botMember.permissionsIn(channel.id);

  if (!permissions.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.Connect)) {
    return "Eu preciso de Ver Canal e Conectar neste canal de voz.";
  }

  return null;
}

async function sendRecordingLogEmbed(session: VoiceRecorderSession, recording: VoiceRecording) {
  if (!session.settings.logChannelId) {
    return;
  }

  const channel = await session.guild.channels.fetch(session.settings.logChannelId).catch(() => null);

  if (!isTextBasedChannel(channel)) {
    return;
  }

  const participants = recording.participants
    .map((participant) => participant.username ?? participant.userId)
    .slice(0, 20);
  const participantText = participants.length
    ? `${participants.join(", ")}${recording.participants.length > participants.length ? ` e mais ${recording.participants.length - participants.length}` : ""}`
    : "Nenhum participante detectado";
  const fileName = recording.fileName ?? `${recording.id}.mp3`;
  const attachment = new AttachmentBuilder(session.filePath, {
    description: `Gravacao do canal ${recording.channelName ?? recording.channelId}`,
    name: fileName
  });

  try {
    await channel.send({
      embeds: [buildRecordingLogEmbed(session, recording, participantText, "Reproduza o audio diretamente no anexo abaixo.")],
      files: [attachment]
    });
  } catch (error) {
    console.warn("[voice-recorder] Discord recusou o anexo direto; enviando link da gravacao:", readPlainError(error));
    await channel.send({
      embeds: [
        buildRecordingLogEmbed(
          session,
          recording,
          participantText,
          recording.fileUrl ?? "Disponivel no historico da dashboard."
        )
      ]
    });
  }
}

function buildRecordingLogEmbed(
  session: VoiceRecorderSession,
  recording: VoiceRecording,
  participantText: string,
  fileDelivery: string
) {
  return new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle("Voice Recorder - Gravacao finalizada")
    .addFields(
      { name: "ID da gravacao", value: recording.id, inline: false },
      { name: "Servidor", value: recording.guildName ?? session.guild.name, inline: true },
      { name: "Canal", value: recording.channelName ?? recording.channelId, inline: true },
      { name: "Iniciada por", value: recording.startedByTag ?? `<@${recording.startedById}>`, inline: true },
      { name: "Encerrada por", value: recording.stoppedByTag ?? (recording.stoppedById ? `<@${recording.stoppedById}>` : "Sistema"), inline: true },
      { name: "Inicio", value: formatDateTime(recording.startedAt), inline: true },
      { name: "Encerramento", value: recording.endedAt ? formatDateTime(recording.endedAt) : "Em aberto", inline: true },
      { name: "Duracao", value: formatDuration(recording.durationMs), inline: true },
      { name: "Tamanho", value: formatBytes(recording.fileSize), inline: true },
      { name: "Participantes", value: truncateEmbedValue(participantText), inline: false },
      { name: "Audio", value: fileDelivery, inline: false }
    )
    .setTimestamp(new Date());
}

function recordingFilePath(guildId: string, recordingId: string, date: Date) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return path.join(STORAGE_ROOT, guildId, year, month, `${recordingId}.mp3`);
}

function memberRoleIds(member: GuildMember) {
  return [member.guild.id, ...member.roles.cache.keys()];
}

function startMessage(recording: VoiceRecording, channel: VoiceBasedChannel, actor: string) {
  return [
    "🎙️ Gravacao iniciada com sucesso.",
    "",
    `Canal: ${channel.name}`,
    `Iniciado por: ${actor}`,
    `Horario: ${formatDateTime(recording.startedAt)}`
  ].join("\n");
}

function isVoiceBasedChannel(channel: unknown): channel is VoiceBasedChannel {
  if (!channel || typeof channel !== "object") {
    return false;
  }

  const type = (channel as { type?: ChannelType }).type;
  return type === ChannelType.GuildVoice || type === ChannelType.GuildStageVoice;
}

function isTextBasedChannel(channel: unknown): channel is TextBasedChannel {
  return Boolean(channel && typeof channel === "object" && "send" in channel && typeof (channel as { send?: unknown }).send === "function");
}

function truncateEmbedValue(value: string) {
  return value.length > 1024 ? `${value.slice(0, 1018)}...` : value;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function readErrorMessage(error: unknown, fallback: string) {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return fallback;
  }

  const response = (error as { response?: { data?: { message?: unknown } } }).response;
  return typeof response?.data?.message === "string" ? response.data.message : fallback;
}

function readPlainError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

type PcmQueue = {
  chunks: Buffer[];
  totalBytes: number;
};

class PcmMp3Mixer {
  private readonly ffmpeg: ChildProcessWithoutNullStreams;
  private readonly queues = new Map<string, PcmQueue>();
  private readonly silence = Buffer.alloc(FRAME_BYTES);
  private interval: NodeJS.Timeout | null = null;
  private closed = false;
  private stderr = "";

  private constructor(ffmpeg: ChildProcessWithoutNullStreams) {
    this.ffmpeg = ffmpeg;
    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString("utf8");
      this.stderr = this.stderr.slice(-4000);
    });
  }

  static async create(filePath: string) {
    await fs.mkdir(path.dirname(filePath), {
      recursive: true
    });

    const ffmpegPath = ffmpegStatic || "ffmpeg";
    const ffmpeg = spawn(ffmpegPath, [
      "-y",
      "-f",
      "s16le",
      "-ar",
      String(SAMPLE_RATE),
      "-ac",
      String(CHANNELS),
      "-i",
      "pipe:0",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "128k",
      filePath
    ]);
    const mixer = new PcmMp3Mixer(ffmpeg);

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      ffmpeg.once("spawn", () => {
        ffmpeg.off("error", onError);
        resolve();
      });
      ffmpeg.once("error", onError);
    });

    mixer.interval = setInterval(() => {
      mixer.writeMixedFrame();
    }, FRAME_MS);
    mixer.interval.unref();

    return mixer;
  }

  addPcm(userId: string, chunk: Buffer) {
    if (this.closed || !chunk.length) {
      return;
    }

    const queue = this.queues.get(userId) ?? {
      chunks: [],
      totalBytes: 0
    };

    queue.chunks.push(Buffer.from(chunk));
    queue.totalBytes += chunk.length;
    this.queues.set(userId, queue);
  }

  async finish() {
    if (this.closed) {
      return;
    }

    this.closed = true;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    this.ffmpeg.stdin.end();

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      this.ffmpeg.once("error", reject);
      this.ffmpeg.once("close", resolve);
    });

    if (exitCode !== 0) {
      throw new Error(this.stderr || `ffmpeg encerrou com codigo ${exitCode}.`);
    }
  }

  private writeMixedFrame() {
    if (this.closed || this.ffmpeg.stdin.destroyed) {
      return;
    }

    const frames: Buffer[] = [];

    for (const userId of this.queues.keys()) {
      const frame = this.readFrame(userId);

      if (frame) {
        frames.push(frame);
      }
    }

    const mixed = frames.length ? mixPcmFrames(frames) : this.silence;
    this.ffmpeg.stdin.write(mixed);
  }

  private readFrame(userId: string) {
    const queue = this.queues.get(userId);

    if (!queue || queue.totalBytes < FRAME_BYTES) {
      return null;
    }

    const output = Buffer.allocUnsafe(FRAME_BYTES);
    let written = 0;

    while (written < FRAME_BYTES && queue.chunks.length) {
      const chunk = queue.chunks[0];
      const needed = FRAME_BYTES - written;

      if (!chunk) {
        break;
      }

      if (chunk.length <= needed) {
        chunk.copy(output, written);
        written += chunk.length;
        queue.chunks.shift();
        queue.totalBytes -= chunk.length;
      } else {
        chunk.copy(output, written, 0, needed);
        queue.chunks[0] = chunk.subarray(needed);
        queue.totalBytes -= needed;
        written += needed;
      }
    }

    if (queue.totalBytes <= 0) {
      this.queues.delete(userId);
    }

    return output;
  }
}

function mixPcmFrames(frames: Buffer[]) {
  if (frames.length === 1) {
    return frames[0];
  }

  const output = Buffer.allocUnsafe(FRAME_BYTES);

  for (let offset = 0; offset < FRAME_BYTES; offset += 2) {
    let sample = 0;

    for (const frame of frames) {
      sample += frame.readInt16LE(offset);
    }

    output.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), offset);
  }

  return output;
}

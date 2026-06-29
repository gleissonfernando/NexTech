import {
  ActionRowBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
  type Interaction,
  type Message,
  type ModalSubmitInteraction,
  type GuildTextBasedChannel,
  type VoiceBasedChannel,
  type VoiceState
} from "discord.js";
import type { BotContext } from "../types";
import { canUseMusic, defaultMusicConfig, getMusicConfig } from "./configManager";
import { musicPanelPayload, queueReplyPayload, formatDuration } from "./panelManager";
import {
  addTracks,
  changeVolume,
  clearMusicQueue,
  cycleLoop,
  ensureMusicSession,
  getMusicSession,
  pauseMusic,
  resumeMusic,
  shuffleQueue,
  skipMusic,
  stopMusicSession,
  updateAloneState
} from "./playerManager";
import { resolveArtist, resolveMusicQuery } from "./searchManager";
import type { MusicConfig, MusicSession } from "./types";
import { getRuntimeModuleAuthorization, runtimeModuleDenialMessage } from "../services/runtimeModuleGuard";

const PREFIX = ".";
const COMMANDS = new Set(["music", "play", "artist", "pause", "resume", "skip", "stop", "queue", "clearqueue", "nowplaying", "volume", "loop", "shuffle"]);
const cooldowns = new Map<string, number>();

export async function handleMusicMessage(message: Message, context: BotContext) {
  if (!message.inGuild() || message.author.bot) return false;

  const directLink = directMusicLink(message.content);
  let command: string;
  let parts: string[];

  if (message.content.startsWith(PREFIX)) {
    const [rawCommand, ...commandParts] = message.content.slice(PREFIX.length).trim().split(/\s+/);
    command = rawCommand?.toLowerCase() ?? "";
    parts = commandParts;
    if (!COMMANDS.has(command)) return false;
  } else if (directLink && await shouldHandleDirectMusicLink(message, context)) {
    command = "play";
    parts = [directLink];
  } else {
    return false;
  }

  const access = await prepareMessageAccess(message, context, !["music", "queue", "nowplaying"].includes(command));
  if (!access) return true;

  try {
    if (command === "music") {
      const session = await ensureMusicSession(
        context,
        access.member.guild,
        access.voiceChannel,
        access.textChannel,
        access.config
      );
      updateAloneState(context, session, access.voiceChannel.members.some((member) => !member.user.bot));
      const panel = await message.channel.send(musicPanelPayload(session));
      session.panelMessage = panel;
      return true;
    }
    if (command === "play") {
      await addQuery(context, access, parts.join(" "));
      return true;
    }
    if (command === "artist") {
      await addArtist(context, access, parts.join(" "));
      return true;
    }
    if (command === "queue") {
      await message.reply(queueText(getMusicSession(message.guildId)));
      return true;
    }
    if (command === "nowplaying") {
      const session = getMusicSession(message.guildId);
      await message.reply(session?.current ? `🎶 Tocando agora: **${session.current.title}** — ${session.current.author}` : "📭 Nada está tocando no momento.");
      return true;
    }
    await runControlCommand(context, access, command, parts[0]);
  } catch (error) {
    console.warn(`[music] comando ${command} falhou em ${message.guildId}:`, plainError(error));
    await context.api.postLog({
      guildId: message.guildId,
      userId: message.author.id,
      type: "music.command_error",
      message: plainError(error),
      metadata: { command }
    }).catch(() => undefined);
    await message.reply(`❌ ${errorMessage(error)}`);
  }
  return true;
}

async function shouldHandleDirectMusicLink(message: Message<true>, context: BotContext) {
  const [authorization, config] = await Promise.all([
    getRuntimeModuleAuthorization(context, message.guildId, "music"),
    getMusicConfig(context, message.guildId).catch(() => null)
  ]);

  return authorization.allowed
    && config?.enabled === true
    && (!config.commandChannelId || config.commandChannelId === message.channelId);
}

export async function handleMusicInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.isButton() && !interaction.isModalSubmit()) return false;
  if (!interaction.customId.startsWith("music_")) return false;
  if (!interaction.inGuild()) return true;

  if (interaction.isButton() && (interaction.customId === "music_play" || interaction.customId === "music_artist")) {
    const access = await prepareInteractionAccess(interaction, context, false);
    if (!access) return true;
    await interaction.showModal(interaction.customId === "music_play" ? playModal() : artistModal());
    return true;
  }

  const access = await prepareInteractionAccess(interaction, context, !interaction.customId.startsWith("music_queue:"));
  if (!access) return true;

  if (interaction.isModalSubmit()) {
    await interaction.deferReply({ ephemeral: true });
    try {
      if (interaction.customId === "music_play_modal") {
        const accepted = await addQuery(context, access, interaction.fields.getTextInputValue("music_query_input"), interaction);
        await interaction.editReply(addedTracksMessage(accepted));
      } else {
        const artist = interaction.fields.getTextInputValue("music_artist_input");
        const accepted = await addArtist(context, access, artist, interaction);
        await interaction.editReply(`🎤 Repertório de **${artist.slice(0, 100)}** carregado com sucesso!\n🎶 Foram adicionadas **${accepted.length} músicas** na fila.`);
      }
    } catch (error) {
      await interaction.editReply(`❌ ${errorMessage(error)}`);
    }
    return true;
  }

  try {
    await handleMusicButton(interaction, context, access);
  } catch (error) {
    console.warn(`[music] botão ${interaction.customId} falhou em ${interaction.guildId}:`, plainError(error));
    const content = `❌ ${errorMessage(error)}`;
    if (interaction.deferred || interaction.replied) await interaction.followUp({ content, ephemeral: true }).catch(() => undefined);
    else await interaction.reply({ content, ephemeral: true }).catch(() => undefined);
  }
  return true;
}

export async function handleMusicSlashCommand(
  interaction: ChatInputCommandInteraction,
  context: BotContext,
  action: "play" | "pause" | "resume" | "skip" | "stop" | "queue" | "clearqueue" | "nowplaying" | "volume" | "shuffle" | "loop"
) {
  await interaction.deferReply({ ephemeral: true });
  const access = await prepareInteractionAccess(interaction, context, !["queue", "nowplaying"].includes(action));
  if (!access) return;

  try {
    if (action === "play") {
      const query = interaction.options.getString("query", true);
      const tracks = await resolveMusicQuery(query, { id: access.userId, tag: access.userTag }, access.config);
      const session = await ensureMusicSession(context, access.member.guild, access.voiceChannel, access.textChannel, access.config);
      const accepted = await addTracks(context, session, tracks, access.config);
      await logRequest(context, access, accepted);
      await interaction.editReply(addedTracksMessage(accepted));
      return;
    }

    const session = getMusicSession(access.member.guild.id);
    if (!session) {
      await interaction.editReply("📭 Não existe reprodução ativa neste servidor.");
      return;
    }
    if (session.voiceChannelId !== access.voiceChannel.id) {
      await interaction.editReply("❌ Entre no mesmo canal de voz do bot para controlar a reprodução.");
      return;
    }

    if (action === "queue") await interaction.editReply(queueText(session));
    else if (action === "nowplaying") await interaction.editReply(session.current
      ? `🎶 Tocando agora: **${session.current.title}** — ${session.current.author}\n⏱️ ${formatDuration(session.current.durationMs)} | 🔊 ${session.volume}%`
      : "📭 Nada está tocando no momento.");
    else if (action === "pause") await interaction.editReply(await pauseMusic(session) ? "⏸️ Música pausada." : "⚠️ A música já está pausada ou não há música tocando.");
    else if (action === "resume") await interaction.editReply(await resumeMusic(session) ? "▶️ Música retomada." : "⚠️ Não existe música pausada no momento.");
    else if (action === "skip") {
      const title = session.current?.title ?? "Música";
      const success = await skipMusic(session);
      if (success) await logAction(context, access, "music.track_skipped", `${title} pulada por ${access.userTag}.`);
      await interaction.editReply(success ? "⏭️ Música pulada." : "📭 Não há música para pular.");
    } else if (action === "stop") {
      await stopMusicSession(context, session, `Fila encerrada por ${access.userTag}.`);
      await interaction.editReply("⏹️ Reprodução finalizada e fila limpa.");
    } else if (action === "clearqueue") {
      const removed = await clearMusicQueue(session);
      await logAction(context, access, "music.queue_cleared", `${removed} música(s) removida(s) por ${access.userTag}.`);
      await interaction.editReply(`🧹 Fila limpa: ${removed} música(s) removida(s).`);
    } else if (action === "volume") {
      const volume = interaction.options.getInteger("value", true);
      await interaction.editReply(`🔊 Volume alterado para ${await changeVolume(context, session, volume, true)}%.`);
    } else if (action === "shuffle") {
      await shuffleQueue(session);
      await interaction.editReply("🔀 Fila embaralhada com sucesso.");
    } else if (action === "loop") {
      await interaction.editReply(`🔁 Modo loop alterado para: ${loopLabel(await cycleLoop(context, session))}.`);
    }
  } catch (error) {
    await context.api.postLog({
      guildId: interaction.guildId ?? "unknown",
      userId: interaction.user.id,
      type: "music.command_error",
      message: plainError(error),
      metadata: { action }
    }).catch(() => undefined);
    await interaction.editReply(`❌ ${errorMessage(error)}`);
  }
}

export function handleMusicVoiceStateUpdate(oldState: VoiceState, newState: VoiceState, context: BotContext) {
  const session = getMusicSession(newState.guild.id);
  if (!session) return;

  const botId = context.client.user?.id;
  if (newState.id === botId && oldState.channelId === session.voiceChannelId && newState.channelId !== session.voiceChannelId) {
    void stopMusicSession(context, session, "Bot removido ou movido do canal de voz.").catch((error) => {
      console.warn(`[music] falha ao limpar sessão desconectada ${newState.guild.id}:`, plainError(error));
    });
    return;
  }

  if (oldState.channelId !== session.voiceChannelId && newState.channelId !== session.voiceChannelId) return;
  const channel = newState.guild.channels.cache.get(session.voiceChannelId);
  if (!channel?.isVoiceBased()) return;
  updateAloneState(context, session, channel.members.some((member) => !member.user.bot));
}

type Access = {
  member: GuildMember;
  voiceChannel: VoiceBasedChannel;
  textChannel: GuildTextBasedChannel;
  config: MusicConfig;
  userId: string;
  userTag: string;
};

async function prepareMessageAccess(message: Message<true>, context: BotContext, applyCooldown: boolean): Promise<Access | null> {
  const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return null;
  const denial = await accessDenial(context, message.guildId, message.channelId, member, applyCooldown);
  if (denial.message) {
    await message.reply(denial.message);
    return null;
  }
  const voiceChannel = member.voice.channel;
  if (!voiceChannel) {
    await message.reply("❌ Você precisa estar em um canal de voz para usar o sistema de música.");
    return null;
  }
  const permissionError = botVoicePermissionError(voiceChannel);
  if (permissionError) {
    await message.reply(permissionError);
    return null;
  }
  const textPermissionError = botTextPermissionError(message.channel);
  if (textPermissionError) {
    await message.reply(textPermissionError).catch(() => undefined);
    return null;
  }
  return { member, voiceChannel, textChannel: message.channel, config: denial.config, userId: message.author.id, userTag: message.author.tag };
}

async function prepareInteractionAccess(interaction: ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction, context: BotContext, applyCooldown: boolean): Promise<Access | null> {
  if (!interaction.guild || !interaction.channel) return null;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return null;
  const denial = await accessDenial(context, interaction.guild.id, interaction.channel.id, member, applyCooldown);
  if (denial.message) {
    await replyInteractionDenial(interaction, denial.message);
    return null;
  }
  const voiceChannel = member.voice.channel;
  if (!voiceChannel) {
    await replyInteractionDenial(interaction, "❌ Você precisa estar em um canal de voz para usar esse comando.");
    return null;
  }
  const permissionError = botVoicePermissionError(voiceChannel);
  if (permissionError) {
    await replyInteractionDenial(interaction, permissionError);
    return null;
  }
  if (!interaction.channel.isSendable() || interaction.channel.isDMBased()) return null;
  const textPermissionError = botTextPermissionError(interaction.channel);
  if (textPermissionError) {
    await replyInteractionDenial(interaction, textPermissionError);
    return null;
  }
  return { member, voiceChannel, textChannel: interaction.channel, config: denial.config, userId: interaction.user.id, userTag: interaction.user.tag };
}

async function replyInteractionDenial(interaction: ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction, content: string) {
  if (interaction.deferred || interaction.replied) await interaction.editReply(content);
  else await interaction.reply({ content, ephemeral: true });
}

async function accessDenial(context: BotContext, guildId: string, channelId: string, member: GuildMember, applyCooldown: boolean) {
  const authorization = await getRuntimeModuleAuthorization(context, guildId, "music");
  const config = await getMusicConfig(context, guildId).catch(() => ({ ...defaultMusicConfig, enabled: false }));
  if (!authorization.allowed) return { config, message: `❌ ${runtimeModuleDenialMessage(authorization, "O sistema de música")}` };
  if (!config.enabled) return { config, message: "❌ O sistema de música está desativado nas configurações deste servidor." };
  if (config.commandChannelId && config.commandChannelId !== channelId) return { config, message: `❌ Use o sistema de música em <#${config.commandChannelId}>.` };
  if (config.blockedChannelIds.includes(channelId)) return { config, message: "❌ O sistema de música está bloqueado neste canal." };
  if (config.allowedChannelIds.length && !config.allowedChannelIds.includes(channelId)) return { config, message: "❌ Este canal não está na lista de canais permitidos para música." };
  if (!canUseMusic(member, config)) return { config, message: "❌ Você não tem permissão para usar o sistema de música." };

  if (applyCooldown && config.cooldownSeconds > 0) {
    const key = `${guildId}:${member.id}`;
    const availableAt = cooldowns.get(key) ?? 0;
    if (availableAt > Date.now()) return { config, message: `⚠️ Aguarde ${Math.ceil((availableAt - Date.now()) / 1000)}s para usar outro comando.` };
    cooldowns.set(key, Date.now() + config.cooldownSeconds * 1000);
  }
  return { config, message: null };
}

async function addQuery(context: BotContext, access: Access, query: string, interaction?: ModalSubmitInteraction) {
  const tracks = await resolveMusicQuery(query, { id: access.userId, tag: access.userTag }, access.config);
  const session = await getOrCreateSession(context, access, interaction);
  const accepted = await addTracks(context, session, tracks, access.config);
  if (!interaction) await access.textChannel.send(addedTracksMessage(accepted));
  await logRequest(context, access, accepted);
  return accepted;
}

async function addArtist(context: BotContext, access: Access, artist: string, interaction?: ModalSubmitInteraction) {
  const tracks = await resolveArtist(artist, { id: access.userId, tag: access.userTag }, access.config);
  const session = await getOrCreateSession(context, access, interaction);
  const accepted = await addTracks(context, session, tracks, access.config);
  if (!interaction) await access.textChannel.send(`🎤 Repertório de **${artist.slice(0, 100)}** carregado: **${accepted.length} músicas** adicionadas.`);
  await logRequest(context, access, accepted);
  return accepted;
}

async function getOrCreateSession(context: BotContext, access: Access, interaction?: ModalSubmitInteraction) {
  const session = await ensureMusicSession(context, access.member.guild, access.voiceChannel, access.textChannel, access.config);
  if (interaction?.message) session.panelMessage = interaction.message;
  return session;
}

async function handleMusicButton(interaction: ButtonInteraction, context: BotContext, access: Access) {
  const session = getMusicSession(access.member.guild.id);
  const id = interaction.customId;
  if (id.startsWith("music_queue:")) {
    const page = Number(id.split(":")[1] ?? 0);
    const payload = queueReplyPayload(session, Number.isFinite(page) ? page : 0);
    await interaction.reply(payload);
    return;
  }
  if (!session) {
    await interaction.reply({ content: "📭 Não existe reprodução ativa neste servidor.", ephemeral: true });
    return;
  }
  if (session.voiceChannelId !== access.voiceChannel.id) {
    await interaction.reply({ content: "❌ Entre no mesmo canal de voz do bot para controlar a reprodução.", ephemeral: true });
    return;
  }

  let message: string;
  if (id === "music_pause") message = await pauseMusic(session) ? `⏸️ Música pausada por ${interaction.user}.` : "⚠️ A música já está pausada ou não há música tocando.";
  else if (id === "music_resume") message = await resumeMusic(session) ? `▶️ Música retomada por ${interaction.user}.` : "⚠️ Não existe música pausada no momento.";
  else if (id === "music_skip") {
    const skipped = session.current;
    const success = await skipMusic(session);
    if (success) await logAction(context, access, "music.track_skipped", `${skipped?.title ?? "Música"} pulada por ${access.userTag}.`);
    message = success ? `⏭️ Música pulada por ${interaction.user}.` : "📭 A fila está vazia.";
  }
  else if (id === "music_stop") {
    await stopMusicSession(context, session, `Fila limpa por ${interaction.user.tag}.`);
    message = `⏹️ Reprodução finalizada e fila limpa por ${interaction.user}.`;
  } else if (id === "music_loop") message = `🔁 Modo loop alterado para: ${loopLabel(await cycleLoop(context, session))}.`;
  else if (id === "music_shuffle") {
    await shuffleQueue(session);
    await logAction(context, access, "music.queue_shuffled", `Fila embaralhada por ${access.userTag}.`);
    message = "🔀 Fila embaralhada com sucesso.";
  } else if (id === "music_volume_down") message = `🔉 Volume alterado para ${await changeVolume(context, session, -10)}%.`;
  else if (id === "music_volume_up") message = `🔊 Volume alterado para ${await changeVolume(context, session, 10)}%.`;
  else message = "Ação desconhecida.";
  await interaction.reply({ content: message, ephemeral: true });
}

async function runControlCommand(context: BotContext, access: Access, command: string, value?: string) {
  const session = getMusicSession(access.member.guild.id);
  if (!session) throw new Error("Não existe reprodução ativa neste servidor.");
  if (session.voiceChannelId !== access.voiceChannel.id) throw new Error("Entre no mesmo canal de voz do bot para controlar a reprodução.");

  if (command === "pause") await access.textChannel.send(await pauseMusic(session) ? `⏸️ Música pausada por <@${access.userId}>.` : "⚠️ A música já está pausada.");
  else if (command === "resume") await access.textChannel.send(await resumeMusic(session) ? `▶️ Música retomada por <@${access.userId}>.` : "⚠️ Não existe música pausada no momento.");
  else if (command === "skip") {
    const skipped = session.current;
    const success = await skipMusic(session);
    if (success) await logAction(context, access, "music.track_skipped", `${skipped?.title ?? "Música"} pulada por ${access.userTag}.`);
    await access.textChannel.send(success ? `⏭️ Música pulada por <@${access.userId}>.` : "📭 A fila está vazia.");
  }
  else if (command === "stop") {
    await stopMusicSession(context, session, `Fila limpa por ${access.userTag}.`);
    await access.textChannel.send(`⏹️ Reprodução finalizada e fila limpa por <@${access.userId}>.`);
  } else if (command === "clearqueue") {
    const removed = await clearMusicQueue(session);
    await logAction(context, access, "music.queue_cleared", `${removed} música(s) removida(s) por ${access.userTag}.`);
    await access.textChannel.send(`🧹 Fila limpa: ${removed} música(s) removida(s).`);
  } else if (command === "volume") {
    const volume = Number(value);
    if (!Number.isInteger(volume) || volume < 10 || volume > 100) throw new Error("Use `.volume <10-100>`. ");
    await access.textChannel.send(`🔊 Volume alterado para ${await changeVolume(context, session, volume, true)}%.`);
  } else if (command === "loop") await access.textChannel.send(`🔁 Modo loop alterado para: ${loopLabel(await cycleLoop(context, session))}.`);
  else if (command === "shuffle") {
    await shuffleQueue(session);
    await logAction(context, access, "music.queue_shuffled", `Fila embaralhada por ${access.userTag}.`);
    await access.textChannel.send("🔀 Fila embaralhada com sucesso.");
  }
}

function playModal() {
  return new ModalBuilder().setCustomId("music_play_modal").setTitle("Tocar música").addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
      .setCustomId("music_query_input").setLabel("Digite o link ou nome da música")
      .setPlaceholder("https://youtube.com/... ou MC Hariel Maçã Verde").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(300))
  );
}

function artistModal() {
  return new ModalBuilder().setCustomId("music_artist_modal").setTitle("Buscar cantor/artista").addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
      .setCustomId("music_artist_input").setLabel("Digite o nome do cantor/artista")
      .setPlaceholder("MC Ryan SP, Orochi, Veigh...").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100))
  );
}

function botVoicePermissionError(channel: VoiceBasedChannel) {
  const bot = channel.guild.members.me;
  if (!bot) return "❌ Não consegui validar minhas permissões no canal de voz.";
  const permissions = bot.permissionsIn(channel);
  return permissions.has(PermissionFlagsBits.ViewChannel, true)
    && permissions.has(PermissionFlagsBits.Connect, true)
    && permissions.has(PermissionFlagsBits.Speak, true)
    && permissions.has(PermissionFlagsBits.UseVAD, true)
    ? null
    : "❌ Não tenho permissão para entrar ou falar nesse canal de voz.";
}

function botTextPermissionError(channel: GuildTextBasedChannel) {
  const bot = channel.guild.members.me;
  if (!bot) return "❌ Não consegui validar minhas permissões no canal de texto.";
  const permissions = channel.permissionsFor(bot);
  return permissions?.has(PermissionFlagsBits.ViewChannel, true)
    && permissions.has(PermissionFlagsBits.SendMessages, true)
    && permissions.has(PermissionFlagsBits.EmbedLinks, true)
    && permissions.has(PermissionFlagsBits.ReadMessageHistory, true)
    ? null
    : "❌ Preciso das permissões Ver canal, Enviar mensagens, Incorporar links e Ler histórico neste canal.";
}

function addedTracksMessage(tracks: Awaited<ReturnType<typeof resolveMusicQuery>>) {
  const first = tracks[0]!;
  return tracks.length === 1
    ? `✅ Música adicionada à fila com sucesso.\n🎵 Nome: **${first.title}**\n👤 Pedido por: <@${first.requestedById}>\n⏱️ Duração: ${formatDuration(first.durationMs)}`
    : `✅ Músicas adicionadas à fila com sucesso: **${tracks.length} faixas**.`;
}

function queueText(session: MusicSession | null) {
  const tracks = [...(session?.current ? [session.current] : []), ...(session?.queue ?? [])];
  if (!tracks.length) return "📭 A fila está vazia.";
  return ["📜 **Fila de músicas**", ...tracks.slice(0, 10).map((track, index) => `${index + 1}. 🎵 ${track.title} — <@${track.requestedById}>`), tracks.length > 10 ? `\n... e mais ${tracks.length - 10}.` : ""].filter(Boolean).join("\n");
}

async function logRequest(context: BotContext, access: Access, tracks: Array<{ title: string; url: string; source: string }>) {
  console.log(`[music] ${tracks.length} faixa(s) adicionada(s) em ${access.member.guild.id} por ${access.userTag}.`);
  await context.api.postLog({
    guildId: access.member.guild.id,
    userId: access.userId,
    type: "music.tracks_added",
    message: `${tracks.length} música(s) adicionada(s) por ${access.userTag}.`,
    metadata: { tracks: tracks.slice(0, 50).map(({ title, url, source }) => ({ title, url, source })) }
  }).catch(() => undefined);
}

async function logAction(context: BotContext, access: Access, type: string, message: string) {
  await context.api.postLog({
    guildId: access.member.guild.id,
    userId: access.userId,
    type,
    message
  }).catch(() => undefined);
}

function loopLabel(mode: string) {
  return mode === "track" ? "Música atual" : mode === "queue" ? "Fila inteira" : "Desligado";
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/sign in to confirm|not a bot|confirm you.?re not a bot/i.test(message)) {
    return "O YouTube bloqueou os clientes atuais do Lavalink. Consulte o erro do youtube-source no terminal e revise clients/OAuth do nó.";
  }
  if (/fetch failed|abort|timed?\s*out|timeout/i.test(message)) {
    return "A fonte de música não respondeu a tempo. Tente novamente em instantes.";
  }
  return message || "Não foi possível concluir essa ação.";
}

function plainError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function directMusicLink(content: string) {
  const value = content.trim().replace(/^<(.+)>$/, "$1");
  if (!value || /\s/.test(value)) return null;

  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

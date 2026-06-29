import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  TextDisplayBuilder,
  type InteractionReplyOptions,
  type MessageCreateOptions
} from "discord.js";
import type { MusicSession } from "./types";

export function musicPanelPayload(session: MusicSession | null): MessageCreateOptions {
  const current = session?.current;
  const status = current ? `**${escapeMarkdown(current.title)}**` : "Nada tocando";
  const queueSize = session?.queue.length ?? 0;
  const volume = session?.volume ?? 50;
  const loop = loopLabel(session?.loopMode ?? "off");
  const container = new ContainerBuilder()
    .setAccentColor(0x7c3aed)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          "# 🎵 Central de Música",
          "Gerencie músicas, artistas, fila e reprodução diretamente pelo Discord.",
          "",
          "🟢 **Online**",
          `🎶 **Tocando agora:** ${status}`,
          `📜 **Fila:** ${queueSize} música(s)`,
          `🔊 **Volume:** ${volume}%`,
          `🔁 **Loop:** ${loop}`,
          `🔀 **Aleatório:** ${session?.shuffled ? "Ativado" : "Desativado"}`,
          current ? `\n🎤 **Artista/Canal:** ${escapeMarkdown(current.author)}\n⏱️ **Duração:** ${formatDuration(current.durationMs)}\n👤 **Pedido por:** <@${current.requestedById}>` : ""
        ].filter(Boolean).join("\n")
      )
    );

  if (current?.thumbnail) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(current.thumbnail).setDescription(`Capa de ${current.title}`)
      )
    );
  }

  container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("music_play", "🎶 Tocar", ButtonStyle.Primary),
        button("music_artist", "🎤 Cantor", ButtonStyle.Primary),
        button("music_queue:0", "📜 Fila", ButtonStyle.Secondary),
        button("music_pause", "⏸️ Pausar", ButtonStyle.Secondary),
        button("music_resume", "▶️ Continuar", ButtonStyle.Success)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("music_skip", "⏭️ Pular", ButtonStyle.Secondary),
        button("music_loop", "🔁 Loop", ButtonStyle.Secondary),
        button("music_shuffle", "🔀 Aleatório", ButtonStyle.Secondary),
        button("music_stop", "⏹️ Parar", ButtonStyle.Danger)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("music_volume_down", "🔉 Volume -", ButtonStyle.Secondary),
        button("music_volume_up", "🔊 Volume +", ButtonStyle.Secondary)
      )
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

export function queueReplyPayload(session: MusicSession | null, requestedPage: number): InteractionReplyOptions {
  const tracks = [...(session?.current ? [session.current] : []), ...(session?.queue ?? [])];
  if (!tracks.length) return { content: "📭 A fila está vazia.", ephemeral: true };

  const pageCount = Math.max(1, Math.ceil(tracks.length / 10));
  const page = Math.max(0, Math.min(pageCount - 1, requestedPage));
  const pageTracks = tracks.slice(page * 10, page * 10 + 10);
  const container = new ContainerBuilder()
    .setAccentColor(0x2563eb)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `# 📜 Fila de músicas — ${page + 1}/${pageCount}`,
      ...pageTracks.map((track, index) => `${page * 10 + index + 1}. 🎵 **${escapeMarkdown(track.title)}** — <@${track.requestedById}>`)
    ].join("\n")))
    .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      button(`music_queue:${page - 1}`, "⬅️ Voltar", ButtonStyle.Secondary, page === 0),
      button(`music_queue:${page + 1}`, "➡️ Próxima", ButtonStyle.Secondary, page >= pageCount - 1)
    ));

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
  };
}

export async function updateMusicPanel(session: MusicSession) {
  if (!session.panelMessage) return;
  const payload = musicPanelPayload(session);
  await session.panelMessage.edit({
    components: payload.components,
    flags: MessageFlags.IsComponentsV2
  }).catch(() => undefined);
}

export function formatDuration(durationMs: number) {
  const seconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function button(customId: string, label: string, style: ButtonStyle, disabled = false) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled);
}

function loopLabel(mode: MusicSession["loopMode"]) {
  if (mode === "track") return "Música atual";
  if (mode === "queue") return "Fila inteira";
  return "Desligado";
}

function escapeMarkdown(value: string) {
  return value.replace(/([\\`*_{}[\]()#+\-.!|>])/g, "\\$1").slice(0, 180);
}

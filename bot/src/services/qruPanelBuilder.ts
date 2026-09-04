import { MessageFlags, type Guild, type MessageCreateOptions } from "discord.js";
import type { PoliceQruMedia, PoliceQruOfficer, PoliceQruRecord, PoliceQruSettings } from "./apiClient";

/*
 * Visual do painel de registro de QRU (Components V2).
 *
 * Este arquivo cuida SÓ da apresentação: não acessa banco, não baixa mídia, não
 * fala HTTP. Recebe o registro já resolvido (inclusive com a mídia importada) e
 * devolve o payload da mensagem.
 */

const MAX_GALLERY_ITEMS = 10;
const CONTAINER = 17;
const TEXT = 10;
const SEPARATOR = 14;
const MEDIA_GALLERY = 12;

export function escapeQruText(value: string) {
  return value.replace(/([\\*_`~|<>@#:])/g, "\\$1");
}

/** Extrai o ID do personagem de nomes no formato "SO. Fulano | 1409". */
export function extractOfficerBadge(name: string | null | undefined) {
  const match = /\|\s*(\d{1,10})\s*$/.exec((name ?? "").trim());
  return match?.[1] ?? null;
}

/** `<@id> | 1409`, ou só a menção quando o nome não traz o ID. */
export function formatOfficerLine(officer: { id: string; name?: string | null; mention?: string | null }) {
  const mention = officer.mention?.trim() || `<@${officer.id}>`;
  const badge = extractOfficerBadge(officer.name);
  return badge ? `${mention} | ${badge}` : mention;
}

export function formatQruDateTime(value: string | Date, timeZone = "America/Sao_Paulo") {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone
  }).format(date).replace(/,/g, "");
}

/** Timestamp relativo do Discord ("Ontem às 14:29" é resolvido pelo cliente). */
export function discordRelativeTimestamp(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

/**
 * Fonte da imagem, em ordem: cópia permanente do NexTech e, só como último
 * recurso (registro antigo ou importação falha), a URL original.
 */
export function resolveQruGalleryItems(record: Pick<PoliceQruRecord, "evidenceUrl" | "media">, fallbackUrls: string[] = []) {
  const stored = (record.media ?? [])
    .filter((item): item is PoliceQruMedia & { storedUrl: string } => item.status === "ready" && Boolean(item.storedUrl))
    .slice(0, MAX_GALLERY_ITEMS)
    .map((item) => ({ media: { url: item.storedUrl }, description: item.fileName ?? "Evidência da ocorrência" }));

  if (stored.length) return stored;

  return fallbackUrls
    .slice(0, MAX_GALLERY_ITEMS)
    .map((url) => ({ media: { url }, description: "Evidência da ocorrência" }));
}

type QruPanelInput = {
  record: PoliceQruRecord;
  settings: Pick<PoliceQruSettings, "color">;
  guild?: Guild | null;
  /** URLs originais, usadas só quando não existe cópia permanente. */
  fallbackImageUrls?: string[];
  footerLabel?: string | null;
};

/**
 * Monta as seções do painel. Campo vazio não vira linha, e seção vazia não vira
 * separador — o layout não pode exibir "undefined" nem deixar buracos.
 */
export function buildQruPanelSections(input: QruPanelInput) {
  const { record } = input;
  const sections: string[] = [];

  const registeredAt = formatQruDateTime(record.createdAt);
  const approved = record.status === "approved";
  const intro = [
    approved ? "Apreensão aprovada e registrada no painel." : "Apreensão registrada e aguardando aprovação.",
    registeredAt ? `Registrado em ${registeredAt}.` : null
  ].filter(Boolean).join("\n");

  sections.push(intro);

  const identification = [
    field("QRU", record.qruType),
    field("Boletim", record.boNumber),
    field("Responsável pelo registro", formatOfficerLine({ id: record.authorId, name: record.authorName }), true)
  ].filter(Boolean).join("\n\n");

  if (identification) sections.push(identification);

  const occurrence = [
    field("Data da ocorrência", record.occurrenceDate),
    field("Veículo", record.vehicle),
    field("Apreensões", record.seizures),
    field("Observações", record.notes)
  ].filter(Boolean).join("\n\n");

  if (occurrence) sections.push(occurrence);

  if (record.approvedById) {
    sections.push(field(
      "Aprovado por",
      formatOfficerLine({ id: record.approvedById, name: record.approvedByName }),
      true
    )!);
  }

  const participants = participantLines(record.officers, record.authorId);
  if (participants) sections.push(`### Participantes\n${participants}`);

  return sections;
}

function participantLines(officers: PoliceQruOfficer[] | undefined, authorId: string) {
  const lines = (officers ?? [])
    .filter((officer) => officer.id && officer.id !== authorId)
    .map((officer) => formatOfficerLine(officer));

  return lines.length ? lines.join("\n") : null;
}

/** Devolve null quando não há valor, para a seção inteira poder ser omitida. */
function field(label: string, value: string | null | undefined, raw = false) {
  const normalized = (value ?? "").trim();
  if (!normalized || /^(none|null|undefined|nenhum[ao]?|-)$/i.test(normalized)) return null;

  return `### ${label}\n${raw ? normalized : escapeQruText(normalized)}`;
}

export function buildQruRegistrationPanel(input: QruPanelInput): MessageCreateOptions {
  const { record, settings, guild } = input;
  const sections = buildQruPanelSections(input);
  const gallery = resolveQruGalleryItems(record, input.fallbackImageUrls ?? []);
  const components: unknown[] = [];

  const title = record.qruType?.trim()
    ? `# 🚓 APREENSÃO • ${escapeQruText(record.qruType.trim())}`
    : "# 🚓 APREENSÃO";
  components.push({ type: TEXT, content: title });

  sections.forEach((section, index) => {
    if (index > 0) components.push({ type: SEPARATOR, divider: true, spacing: 1 });
    components.push({ type: TEXT, content: section });
  });

  if (gallery.length) {
    components.push({ type: SEPARATOR, divider: true, spacing: 1 });
    components.push({ type: MEDIA_GALLERY, items: gallery });
  }

  const footer = buildFooter(input.footerLabel ?? guild?.name ?? null, record.createdAt);
  if (footer) {
    components.push({ type: SEPARATOR, divider: false, spacing: 1 });
    components.push({ type: TEXT, content: footer });
  }

  const mentionUserIds = [...new Set([
    record.authorId,
    record.approvedById,
    ...(record.officers ?? []).map((officer) => officer.id)
  ].filter((value): value is string => Boolean(value)))];

  return {
    allowedMentions: { users: mentionUserIds },
    components: [{
      type: CONTAINER,
      accent_color: parseAccentColor(settings.color),
      components
    }] as never,
    flags: MessageFlags.IsComponentsV2
  };
}

function buildFooter(label: string | null, createdAt: string | Date) {
  const relative = discordRelativeTimestamp(createdAt);
  const parts = [label ? escapeQruText(label) : null, relative].filter(Boolean);
  return parts.length ? `-# ${parts.join(" • ")}` : null;
}

export function parseAccentColor(value: string | null | undefined) {
  const hex = (value ?? "").replace("#", "");
  return /^[0-9a-f]{6}$/i.test(hex) ? Number.parseInt(hex, 16) : 0x2563eb;
}

import {
  ChannelFlags, ChannelType, PermissionFlagsBits,
  type ForumChannel, type Guild, type MessageCreateOptions, type ThreadChannel
} from "discord.js";

/**
 * Aba (post de fórum) individual de cada policial. Recrutamento e QRU gravam no
 * mesmo lugar: o histórico do policial fica todo em um único tópico, em vez de
 * um post novo a cada registro.
 */
export type OfficerForumTarget = {
  discordId: string;
  displayName: string;
  policeId?: string | null;
  /** Tópico já conhecido (guardado no banco) para reaproveitar. */
  existingThreadId?: string | null;
  /** Primeira mensagem do tópico, usada apenas quando ele precisa ser criado. */
  header: MessageCreateOptions;
};

export function officerThreadName(target: Pick<OfficerForumTarget, "discordId" | "displayName" | "policeId">) {
  return `recrutamento-${target.displayName} | ${target.policeId ?? target.discordId}`.slice(0, 100);
}

export async function resolveForumChannel(guild: Guild, forumChannelId: string | null | undefined) {
  if (!forumChannelId) throw new Error("Nenhum fórum de relatórios está configurado para este servidor.");
  const channel = await guild.channels.fetch(forumChannelId).catch(() => null);
  if (!channel) throw new Error("O fórum configurado não existe mais neste servidor. Configure outro nas definições do módulo.");
  if (channel.type !== ChannelType.GuildForum) throw new Error(`O canal <#${forumChannelId}> não é um fórum. Crie um canal do tipo Fórum e selecione-o na configuração.`);
  const me = await guild.members.fetchMe().catch(() => null);
  const permissions = me ? channel.permissionsFor(me) : null;
  if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.SendMessages)) {
    throw new Error(`O bot não tem permissão para publicar em <#${forumChannelId}>. Libere Ver Canal e Enviar Mensagens.`);
  }
  return channel;
}

/**
 * Devolve o tópico do policial, criando apenas quando ele ainda não existe.
 * Reaproveita o tópico guardado no banco; se o id se perdeu (ou o registro foi
 * apagado), procura pelo nome entre os posts ativos e arquivados antes de criar
 * um novo — é o que impede o fórum de encher de abas duplicadas do mesmo membro.
 */
export async function ensureOfficerForumThread(forum: ForumChannel, target: OfficerForumTarget) {
  const name = officerThreadName(target);
  const known = target.existingThreadId ? await forum.guild.channels.fetch(target.existingThreadId).catch(() => null) : null;
  if (known?.isThread() && known.parentId === forum.id) return reopen(known);

  const found = await findThreadByName(forum, name);
  if (found) return reopen(found);

  return forum.threads.create({
    appliedTags: defaultTags(forum),
    message: target.header,
    name,
    reason: `Histórico policial de ${target.discordId}`
  });
}

/**
 * Post de fórum arquiva sozinho (1 a 7 dias parado). Enviar mensagem em tópico
 * arquivado devolve erro da API, e era o que derrubava a finalização do
 * relatório: reabrimos antes de escrever.
 */
async function reopen(thread: ThreadChannel) {
  if (thread.locked) await thread.setLocked(false, "Novo registro no histórico do policial").catch(() => null);
  if (thread.archived) await thread.setArchived(false, "Novo registro no histórico do policial").catch(() => null);
  return thread;
}

async function findThreadByName(forum: ForumChannel, name: string) {
  const active = await forum.threads.fetchActive().catch(() => null);
  const fromActive = active?.threads.find((thread) => thread.name === name);
  if (fromActive) return fromActive;
  const archived = await forum.threads.fetchArchived({ limit: 100 }).catch(() => null);
  return archived?.threads.find((thread) => thread.name === name) ?? null;
}

/** Fórum configurado com "tag obrigatória" recusa a criação do post sem tag. */
function defaultTags(forum: ForumChannel) {
  if (!forum.flags.has(ChannelFlags.RequireTag)) return undefined;
  const first = forum.availableTags[0];
  return first ? [first.id] : undefined;
}

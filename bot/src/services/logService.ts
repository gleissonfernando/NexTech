import type { GuildMember, Message, PartialMessage, User } from "discord.js";
import type { BotContext } from "../types";

export async function logMemberJoin(context: BotContext, member: GuildMember) {
  await sendLog(context, {
    guildId: member.guild.id,
    userId: member.id,
    type: "member.join",
    message: `${member.user.tag} entrou no servidor.`
  });
}

export async function logMemberLeave(context: BotContext, member: GuildMember) {
  await sendLog(context, {
    guildId: member.guild.id,
    userId: member.id,
    type: "member.leave",
    message: `${member.user.tag} saiu do servidor.`
  });
}

export async function logMessageDelete(context: BotContext, message: Message | PartialMessage) {
  if (!message.guild || message.author?.bot) {
    return;
  }

  await sendLog(context, {
    guildId: message.guild.id,
    userId: message.author?.id,
    type: "message.delete",
    message: `Mensagem apagada em #${"name" in message.channel ? message.channel.name : message.channel.id}.`,
    metadata: {
      content: message.content
    }
  });
}

export async function logMessageUpdate(context: BotContext, oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) {
  if (!newMessage.guild || newMessage.author?.bot || oldMessage.content === newMessage.content) {
    return;
  }

  await sendLog(context, {
    guildId: newMessage.guild.id,
    userId: newMessage.author?.id,
    type: "message.update",
    message: "Mensagem editada.",
    metadata: {
      before: oldMessage.content,
      after: newMessage.content
    }
  });
}

export async function logRoleChange(context: BotContext, member: GuildMember, added: string[], removed: string[]) {
  if (!added.length && !removed.length) {
    return;
  }

  await sendLog(context, {
    guildId: member.guild.id,
    userId: member.id,
    type: "roles.update",
    message: `Cargos atualizados para ${member.user.tag}.`,
    metadata: {
      added,
      removed
    }
  });
}

export async function logModeration(context: BotContext, guildId: string, user: User, type: string, reason?: string) {
  await sendLog(context, {
    guildId,
    userId: user.id,
    type,
    message: `${user.tag}: ${reason ?? "acao registrada"}`,
    metadata: {
      reason
    }
  });
}

async function sendLog(context: BotContext, payload: { guildId: string; type: string; message: string; userId?: string | null; metadata?: unknown }) {
  await context.api.postLog(payload).catch((error) => {
    console.warn("[api] falha ao registrar log:", error instanceof Error ? error.message : error);
  });

  context.socket.emitLog(payload);
}

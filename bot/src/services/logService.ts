import type { GuildMember, Message, PartialGuildMember, PartialMessage, ReadonlyCollection, Snowflake, User } from "discord.js";
import { currentRuntimeBotId, isBotModuleEnabled } from "../config/env";
import type { BotContext } from "../types";
import { registerBulkDeletedMessageLogs, registerDeletedMessageLog } from "./deletedMessageLogService";
import { isRuntimeModuleAuthorized } from "./runtimeModuleGuard";

export type CreateSystemLogInput = {
  guildId: string;
  module: string;
  action: string;
  caseId?: string | null;
  userId?: string | null;
  executorId?: string | null;
  channelId?: string | null;
  logChannelId?: string | null;
  status?: string | null;
  message?: string;
  metadata?: unknown;
  transcript?: {
    id?: string | null;
    enabled?: boolean;
    generateWebsite?: boolean;
    generateText?: boolean;
    passwordProtected?: boolean;
  };
};

export async function logMemberJoin(context: BotContext, member: GuildMember) {
  await sendLog(context, {
    guildId: member.guild.id,
    userId: member.id,
    type: "member.join",
    message: `${member.user.tag} entrou no servidor.`
  });
}

export async function logMemberLeave(context: BotContext, member: GuildMember | PartialGuildMember) {
  await sendLog(context, {
    guildId: member.guild.id,
    userId: member.id,
    type: "member.leave",
    message: `${member.user.tag} saiu do servidor.`
  });
}

export async function logMessageDelete(context: BotContext, message: Message | PartialMessage) {
  if (!message.guild) {
    return;
  }

  await registerDeletedMessageLog(context, {
    deletionType: "UNKNOWN",
    message,
    module: "Logs de mensagens apagadas",
    reason: "Exclusão detectada pelo evento global messageDelete"
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
      after: newMessage.content,
      channelId: newMessage.channelId,
      messageId: newMessage.id
    }
  });
}

export async function logMessageBulkDelete(context: BotContext, messages: ReadonlyCollection<Snowflake, Message | PartialMessage>) {
  const first = messages.first(); if (!first?.guild) return;
  await registerBulkDeletedMessageLogs(context, messages.values(), {
    action: "BULK_DELETE",
    deletionType: "MODERATOR",
    module: "Logs de mensagens apagadas",
    reason: "Exclusão em massa"
  });
  await sendLog(context, { guildId: first.guild.id, type: "message.bulk_delete", message: `${messages.size} messages were deleted in bulk.`, metadata: { channelId: first.channelId, messageIds: [...messages.keys()].slice(0, 100) } });
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
    message: `${user.tag}: ${reason ?? "ação registrada"}`,
    metadata: {
      reason
    }
  });
}

export async function isLogsRuntimeAuthorized(context: BotContext, guildId: string) {
  if (currentRuntimeBotId()) {
    return isRuntimeModuleAuthorized(context, guildId, "logs");
  }

  return isBotModuleEnabled("logs");
}

export async function createSystemLog(context: BotContext, input: CreateSystemLogInput) {
  const type = `${slug(input.module)}.${slug(input.action)}`;
  await sendLog(context, {
    action: input.action,
    caseId: input.caseId ?? null,
    channelId: input.channelId ?? null,
    executorId: input.executorId ?? null,
    guildId: input.guildId,
    logChannelId: input.logChannelId ?? null,
    module: input.module,
    status: input.status ?? "info",
    transcriptId: input.transcript?.id ?? null,
    userId: input.userId ?? null,
    type,
    message: input.message ?? `Log ${input.module}/${input.action}${input.caseId ? ` caso ${input.caseId}` : ""} registrado.`,
    metadata: {
      module: input.module,
      action: input.action,
      caseId: input.caseId ?? null,
      executorId: input.executorId ?? null,
      channelId: input.channelId ?? null,
      logChannelId: input.logChannelId ?? null,
      status: input.status ?? "info",
      transcript: input.transcript ?? null,
      details: input.metadata ?? null
    }
  });
}

async function sendLog(context: BotContext, payload: { action?: string | null; caseId?: string | null; channelId?: string | null; executorId?: string | null; guildId: string; logChannelId?: string | null; module?: string | null; status?: string | null; transcriptId?: string | null; type: string; message: string; userId?: string | null; metadata?: unknown }) {
  const scopedPayload = {
    ...payload,
    botId: currentRuntimeBotId()
  };

  try {
    await context.api.postLog(scopedPayload);
  } catch (error) {
    console.warn("[api] falha ao registrar log:", error instanceof Error ? error.message : error);

    if (isAuthorizationFailure(error)) {
      return;
    }

    context.socket.emitLog(scopedPayload);
  }
}

function slug(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "system";
}

function isAuthorizationFailure(error: unknown) {
  if (!error || typeof error !== "object" || !("response" in error)) {
    return false;
  }

  const response = (error as { response?: { status?: unknown } }).response;
  return response?.status === 401 || response?.status === 403 || response?.status === 404;
}

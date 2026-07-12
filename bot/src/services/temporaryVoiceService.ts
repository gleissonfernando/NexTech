import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type Channel,
  type Client,
  type Guild,
  type Interaction,
  type Message,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
  type VoiceChannel,
  type VoiceState
} from "discord.js";
import { isBotModuleEnabled, setRuntimeEnabledModules } from "../config/env";
import type { BotContext } from "../types";
import type { TemporaryCall, TemporaryVoiceSettings } from "./apiClient";
import { systemComponentEmoji, systemEmojiText } from "./systemEmojiService";

const IDs = {
  allow: "tempcall_allow",
  ban: "tempcall_ban",
  create: "tempcall_create",
  delete: "tempcall_delete",
  disconnect: "tempcall_disconnect",
  limit: "tempcall_limit",
  private: "tempcall_private",
  public: "tempcall_public"
} as const;

const emptyTimers = new Map<string, NodeJS.Timeout>();
const configuredAutoDeleteTimers = new Map<string, NodeJS.Timeout>();
let started = false;

export function startTemporaryVoiceService(client: Client<true>, context: BotContext) {
  if (started || !isBotModuleEnabled("temporary-voice")) return;

  started = true;
  void reconcileAll(client, context);

  const timer = setInterval(() => void reconcileAll(client, context), 60_000);
  timer.unref();
}

export async function handleTemporaryVoiceMessage(message: Message, context: BotContext) {
  if (message.author.bot || !message.guild || message.content.trim().toLowerCase() !== ".call") {
    return false;
  }

  if (!isBotModuleEnabled("temporary-voice")) {
    const runtime = await context.api.getRuntimeModules().catch(() => null);

    if (runtime) {
      setRuntimeEnabledModules(runtime.active ? runtime.enabledModules : [], runtime.botId);
    }
  }

  if (!isBotModuleEnabled("temporary-voice")) {
    await message.reply("As calls temporárias não estão liberadas para este bot no painel DEV.").catch(() => null);
    return true;
  }

  const settings = await context.api.getTemporaryVoiceSettings(message.guild.id).catch(() => null);

  if (!settings?.enabled) {
    await message.reply("As calls temporárias estão desativadas no painel.").catch(() => null);
    return true;
  }

  if (!message.channel.isSendable()) {
    await message.reply("Não consigo publicar o painel de calls temporárias neste canal.").catch(() => null);
    return true;
  }

  if (settings.panelChannelId === message.channelId && settings.panelMessageId) {
    const previousPanel = await message.channel.messages.fetch(settings.panelMessageId).catch(() => null);
    await previousPanel?.delete().catch(() => null);
  }

  await message.delete().catch(() => null);
  const panel = await message.channel.send(panelPayload(message.guild));

  if (settings.panelChannelId === message.channelId) {
    await context.api.updateTemporaryVoicePanelState(message.guild.id, panel.id).catch(() => null);
  }

  return true;
}

export async function handleTemporaryVoiceInteraction(interaction: Interaction, context: BotContext) {
  if (!(interaction.isButton() || interaction.isModalSubmit() || interaction.isUserSelectMenu() || interaction.isStringSelectMenu())) {
    return false;
  }

  if (!interaction.customId.startsWith("tempcall_")) {
    return false;
  }

  if (!interaction.guild) {
    await ephemeral(interaction, "❌ Esta ação só está disponível dentro de um servidor.");
    return true;
  }

  try {
    if (interaction.isModalSubmit()) {
      await handleModal(interaction, context);
    } else if (interaction.isUserSelectMenu() || interaction.isStringSelectMenu()) {
      await handleUserSelect(interaction, context);
    } else {
      await handleButton(interaction, context);
    }
  } catch (error) {
    await ephemeral(interaction, `❌ ${error instanceof Error ? error.message : "A ação da call temporária falhou."}`);
  }

  return true;
}

async function handleButton(interaction: ButtonInteraction, context: BotContext) {
  const settings = await context.api.getTemporaryVoiceSettings(interaction.guildId!);

  if (!settings.enabled) {
    throw new Error("As calls temporárias estão desativadas no painel.");
  }

  if (interaction.customId === IDs.create) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await createCall(interaction, context, settings);
    return;
  }

  const call = await ownedCall(interaction, context);

  if (interaction.customId === IDs.private) {
    await setPrivacy(interaction, context, call, true);
    return;
  }

  if (interaction.customId === IDs.public) {
    await setPrivacy(interaction, context, call, false);
    return;
  }

  if (interaction.customId === IDs.limit) {
    const input = new TextInputBuilder()
      .setCustomId("limit")
      .setLabel("Novo limite da call")
      .setMinLength(1)
      .setMaxLength(2)
      .setRequired(true)
      .setStyle(TextInputStyle.Short)
      .setValue(String(call.userLimit));

    await interaction.showModal(
      new ModalBuilder()
        .setCustomId("tempcall_limit_modal")
        .setTitle("Alterar limite da call")
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
    );
    return;
  }

  if (interaction.customId === IDs.allow || interaction.customId === IDs.ban) {
    const mode = interaction.customId === IDs.allow ? "allow" : "ban";
    const menu = new UserSelectMenuBuilder()
      .setCustomId(`tempcall_${mode}_select`)
      .setPlaceholder(mode === "allow" ? "Selecione um usuário para permitir" : "Selecione um usuário para banir")
      .setMinValues(1)
      .setMaxValues(1);

    await interaction.reply({
      components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(menu)],
      content: mode === "allow" ? "Selecione quem poderá entrar na sua call." : "Selecione quem será banido da sua call.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.customId === IDs.disconnect) {
    const channel = await interaction.guild!.channels.fetch(call.channelId).catch(() => null);

    if (!channel || channel.type !== ChannelType.GuildVoice) {
      throw new Error("Sua call temporária não existe mais.");
    }

    const options = channel.members
      .filter((member) => member.id !== call.ownerId)
      .map((member) => ({
        label: member.displayName.slice(0, 100),
        value: member.id
      }));

    if (!options.length) {
      await ephemeral(interaction, "❌ Não há ninguém para desconectar da sua call.");
      return;
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId("tempcall_disconnect_select")
      .setPlaceholder("Selecione um usuário para desconectar")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(options);

    await interaction.reply({
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
      content: "Selecione um membro que está dentro da sua call.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.customId === IDs.delete) {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("tempcall_delete_confirm").setLabel("Confirmar").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("tempcall_delete_cancel").setLabel("Cancelar").setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
      components: [row],
      content: "Deseja deletar sua call temporária?",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.customId === "tempcall_delete_cancel") {
    await interaction.update({ components: [], content: "Exclusão cancelada." });
    return;
  }

  if (interaction.customId === "tempcall_delete_confirm") {
    await deleteCall(interaction, context, call, "Deletada pelo dono");
  }
}

async function handleModal(interaction: ModalSubmitInteraction, context: BotContext) {
  if (interaction.customId !== "tempcall_limit_modal") return;

  const call = await ownedCall(interaction, context);
  const raw = interaction.fields.getTextInputValue("limit").trim();

  if (!/^\d+$/.test(raw)) {
    throw new Error("O limite da call deve conter apenas números.");
  }

  const limit = Number(raw);

  if (limit < 1 || limit > 99) {
    throw new Error("O limite da call deve ficar entre 1 e 99.");
  }

  const channel = await interaction.guild!.channels.fetch(call.channelId).catch(() => null);

  if (!channel || channel.type !== ChannelType.GuildVoice) {
    throw new Error("Sua call temporária não existe mais.");
  }

  await channel.setUserLimit(limit, `Limite da call temporária alterado por ${interaction.user.tag}`);
  await context.api.updateTemporaryCall(interaction.guildId!, call.id, { userLimit: limit });
  await ephemeral(interaction, `✅ O limite da sua call foi alterado para ${limit}.`);
}

async function handleUserSelect(interaction: UserSelectMenuInteraction | StringSelectMenuInteraction, context: BotContext) {
  const call = await ownedCall(interaction, context);
  const userId = interaction.values[0];

  if (!userId) {
    throw new Error("Nenhum usuário foi selecionado.");
  }

  if (userId === call.ownerId) {
    throw new Error("O dono da call não pode ser selecionado para esta ação.");
  }

  const channel = await interaction.guild!.channels.fetch(call.channelId).catch(() => null);

  if (!channel || channel.type !== ChannelType.GuildVoice) {
    throw new Error("Sua call temporária não existe mais.");
  }

  if (interaction.customId === "tempcall_allow_select") {
    const allowedUsers = [...new Set([...call.allowedUsers, userId])];
    const bannedUsers = call.bannedUsers.filter((id) => id !== userId);

    await channel.permissionOverwrites.edit(userId, { Connect: true, ViewChannel: true }, { reason: "Lista de permitidos da call temporária" });
    await context.api.updateTemporaryCall(interaction.guildId!, call.id, { allowedUsers, bannedUsers });
    await interaction.update({ components: [], content: "✅ Usuário permitido na sua call." });
    return;
  }

  if (interaction.customId === "tempcall_ban_select") {
    const bannedUsers = [...new Set([...call.bannedUsers, userId])];
    const allowedUsers = call.allowedUsers.filter((id) => id !== userId);

    await channel.permissionOverwrites.edit(userId, { Connect: false }, { reason: "Lista de banidos da call temporária" });

    const member = await interaction.guild!.members.fetch(userId).catch(() => null);

    if (member?.voice.channelId === channel.id) {
      await member.voice.disconnect("Banido da call temporária");
    }

    await context.api.updateTemporaryCall(interaction.guildId!, call.id, { allowedUsers, bannedUsers });
    await interaction.update({ components: [], content: "✅ Usuário banido da sua call." });
    return;
  }

  if (interaction.customId === "tempcall_disconnect_select") {
    const member = await interaction.guild!.members.fetch(userId).catch(() => null);

    if (!member || member.voice.channelId !== channel.id) {
      throw new Error("Esse usuário não está dentro da sua call.");
    }

    await member.voice.disconnect("Desconectado pelo dono da call temporária");
    await interaction.update({ components: [], content: "✅ Usuário desconectado da sua call." });
  }
}

async function createCall(interaction: ButtonInteraction, context: BotContext, settings: TemporaryVoiceSettings) {
  const existing = await context.api.getTemporaryCallByOwner(interaction.guildId!, interaction.user.id);

  if (existing) {
    throw new Error("Você já possui uma call temporária ativa.");
  }

  const member = await interaction.guild!.members.fetch(interaction.user.id);

  const me = interaction.guild!.members.me;

  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels) || !me.permissions.has(PermissionFlagsBits.MoveMembers)) {
    throw new Error("O bot precisa das permissões Gerenciar Canais e Mover Membros.");
  }

  const parent = settings.categoryId ? await interaction.guild!.channels.fetch(settings.categoryId).catch(() => null) : null;
  const name = `Call de ${member.displayName}`.slice(0, 100);
  const channel = await interaction.guild!.channels.create({
    name,
    parent: parent?.type === ChannelType.GuildCategory ? parent.id : undefined,
    permissionOverwrites: [
      {
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
        id: interaction.guild!.roles.everyone.id
      },
      {
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.MoveMembers
        ],
        id: member.id
      }
    ],
    reason: `Call temporária criada por ${member.user.tag}`,
    type: ChannelType.GuildVoice,
    userLimit: settings.defaultUserLimit
  });

  try {
    const call = await context.api.createTemporaryCall(interaction.guildId!, {
      allowedUsers: [],
      bannedUsers: [],
      channelId: channel.id,
      channelName: channel.name,
      isPrivate: false,
      ownerId: member.id,
      userLimit: settings.defaultUserLimit
    });

    if (member.voice.channelId) {
      await member.voice.setChannel(channel, "Movido para a própria call temporária");
    }

    if (!member.voice.channelId) {
      await inspectEmpty(channel, context, call);
    }

    await logCall(context, settings, call, "Call temporária criada", member.id);
    await ephemeral(interaction, member.voice.channelId ? "✅ Sua call temporária foi criada." : "✅ Sua call temporária foi criada. Entre nela quando quiser usar.");
  } catch (error) {
    await channel.delete("Falha ao salvar a call temporária").catch(() => null);
    throw error;
  }
}

async function setPrivacy(interaction: ButtonInteraction, context: BotContext, call: TemporaryCall, isPrivate: boolean) {
  const channel = await interaction.guild!.channels.fetch(call.channelId).catch(() => null);

  if (!channel || channel.type !== ChannelType.GuildVoice) {
    throw new Error("Sua call temporária não existe mais.");
  }

  await channel.permissionOverwrites.edit(
    interaction.guild!.roles.everyone.id,
    { Connect: isPrivate ? false : true, ViewChannel: true },
    { reason: `Call temporária definida como ${isPrivate ? "privada" : "pública"}` }
  );

  for (const userId of call.allowedUsers) {
    await channel.permissionOverwrites.edit(userId, { Connect: true, ViewChannel: true }).catch(() => null);
  }

  for (const userId of call.bannedUsers) {
    await channel.permissionOverwrites.edit(userId, { Connect: false }).catch(() => null);
  }

  await context.api.updateTemporaryCall(interaction.guildId!, call.id, { isPrivate });
  await ephemeral(interaction, `✅ Sua call agora está ${isPrivate ? "privada" : "pública"}.`);
}

async function ownedCall(interaction: Interaction & { guildId: string | null }, context: BotContext) {
  const call = await context.api.getTemporaryCallByOwner(interaction.guildId!, interaction.user.id);

  if (!call) {
    throw new Error("Você não possui uma call temporária ativa.");
  }

  if (call.ownerId !== interaction.user.id) {
    throw new Error("Você não é o dono desta call temporária.");
  }

  return call;
}

export async function handleTemporaryVoiceStateUpdate(oldState: VoiceState, newState: VoiceState, context: BotContext) {
  if (!isBotModuleEnabled("temporary-voice")) return;

  const settings = await context.api.getTemporaryVoiceSettings(newState.guild.id).catch(() => null);

  if (newState.channelId) {
    cancelEmpty(newState.channelId);
    cancelConfiguredAutoDelete(newState.channelId);
    const call = await context.api.getTemporaryCallByChannel(newState.guild.id, newState.channelId).catch(() => null);

    if (call) {
      cancelEmpty(call.channelId);

      if (call.emptySince) {
        await context.api.updateTemporaryCall(call.guildId, call.id, { emptySince: null }).catch(() => null);
      }

      if (call.bannedUsers.includes(newState.id)) {
        await newState.disconnect("Banido da call temporária").catch(() => null);
      }
    }
  }

  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    const call = await context.api.getTemporaryCallByChannel(oldState.guild.id, oldState.channelId).catch(() => null);

    if (settings?.enabled) {
      const configuredChannel = oldState.guild.channels.cache.get(oldState.channelId);
      await inspectConfiguredAutoDelete(configuredChannel, context, settings);
    }

    if (call) {
      const channel = oldState.guild.channels.cache.get(call.channelId);

      if (channel?.type === ChannelType.GuildVoice && channel.members.size === 1) {
        await context.api.postLog({
          guildId: call.guildId,
          message: `Um usuário ficou sozinho na call temporária ${call.channelName}.`,
          metadata: {
            channelId: call.channelId,
            ownerId: call.ownerId
          },
          type: "voice.temporary_alone",
          userId: channel.members.first()?.id ?? call.ownerId
        }).catch(() => null);
      }

      await inspectEmpty(channel, context, call);
    }
  }
}

export async function handleTemporaryCallChannelDelete(channel: Channel, context: BotContext) {
  if (!("guild" in channel) || !isBotModuleEnabled("temporary-voice")) return;

  cancelConfiguredAutoDelete(channel.id);
  const call = await context.api.getTemporaryCallByChannel(channel.guild.id, channel.id).catch(() => null);

  if (call) {
    cancelEmpty(channel.id);
    await createTemporaryCallTranscript(context, call, channel.name ?? call.channelName, "Canal deletado antes do fluxo normal", true).catch(() => null);
    await context.api.deleteTemporaryCall(channel.guild.id, call.id).catch(() => null);
  }
}

async function inspectEmpty(raw: Channel | undefined, context: BotContext, call: TemporaryCall) {
  if (!raw || raw.type !== ChannelType.GuildVoice || voiceMemberCount(raw.guild, call.channelId) > 0) {
    cancelEmpty(call.channelId);

    if (call.emptySince) {
      await context.api.updateTemporaryCall(call.guildId, call.id, { emptySince: null });
    }

    return;
  }

  if (emptyTimers.has(call.channelId)) return;

  const settings = await context.api.getTemporaryVoiceSettings(call.guildId);
  const emptySince = call.emptySince ? new Date(call.emptySince).getTime() : Date.now();

  if (!call.emptySince) {
    await context.api.updateTemporaryCall(call.guildId, call.id, { emptySince: new Date(emptySince).toISOString() });
  }

  const delay = Math.max(0, settings.emptyDeleteMinutes * 60_000 - (Date.now() - emptySince));
  const timer = setTimeout(() => void deleteEmpty(raw, context, call, settings), delay);
  timer.unref();
  emptyTimers.set(call.channelId, timer);
}

async function deleteEmpty(channel: VoiceChannel, context: BotContext, call: TemporaryCall, settings: TemporaryVoiceSettings) {
  emptyTimers.delete(call.channelId);

  const fresh = await channel.guild.channels.fetch(call.channelId).catch(() => null);

  if (!fresh || fresh.type !== ChannelType.GuildVoice) {
    await context.api.deleteTemporaryCall(call.guildId, call.id).catch(() => null);
    return;
  }

  if (voiceMemberCount(fresh.guild, call.channelId) > 0) {
    await context.api.updateTemporaryCall(call.guildId, call.id, { emptySince: null });
    return;
  }

  await createTemporaryCallTranscript(context, call, fresh.name, "Inatividade", false).catch(() => null);
  await fresh.delete("Call temporária vazia por tempo limite");
  await context.api.deleteTemporaryCall(call.guildId, call.id).catch(() => null);
  await logCall(context, settings, call, "Call temporária deletada após ficar vazia", call.ownerId);
}

async function deleteCall(interaction: ButtonInteraction, context: BotContext, call: TemporaryCall, reason: string) {
  cancelEmpty(call.channelId);

  const settings = await context.api.getTemporaryVoiceSettings(call.guildId);
  const channel = await interaction.guild!.channels.fetch(call.channelId).catch(() => null);

  if (channel?.type === ChannelType.GuildVoice && voiceMemberCount(channel.guild, call.channelId) > 0) {
    throw new Error("A call temporária só pode ser deletada quando não tiver ninguém dentro.");
  }

  if (channel) {
    await createTemporaryCallTranscript(context, call, channel.name, reason, false).catch(() => null);
    await channel.delete(reason);
  }

  await context.api.deleteTemporaryCall(call.guildId, call.id).catch(() => null);
  await logCall(context, settings, call, "Call temporária deletada", interaction.user.id);

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ components: [], content: "✅ Sua call temporária foi deletada." });
  } else {
    await ephemeral(interaction, "✅ Sua call temporária foi deletada.");
  }
}

async function createTemporaryCallTranscript(context: BotContext, call: TemporaryCall, channelName: string, reason: string, isPartial: boolean) {
  await context.api.createTranscript({
    categoryName: "Canal Temporário",
    channelId: call.channelId,
    channelName,
    closeReason: reason,
    closedAt: new Date().toISOString(),
    events: [
      {
        authorId: call.ownerId,
        content: `Canal temporário criado por ${call.ownerId}.`,
        eventType: "temporary_channel.created",
        createdAt: call.createdAt
      },
      {
        authorId: call.ownerId,
        content: `Canal temporário finalizado. Motivo: ${reason}.`,
        eventType: "temporary_channel.closed",
        createdAt: new Date().toISOString()
      }
    ],
    finalResult: reason,
    generateTemporaryPassword: true,
    guildId: call.guildId,
    isPartial,
    messages: [],
    openedById: call.ownerId,
    ownerId: call.ownerId,
    participants: [{ id: call.ownerId, name: `@${call.ownerId}`, role: "Dono" }],
    partialReason: isPartial ? reason : null,
    temporaryPasswordTtlHours: 72,
    ticketId: call.id,
    type: "Canal Temporario"
  });
}

function cancelEmpty(channelId: string) {
  const timer = emptyTimers.get(channelId);

  if (timer) {
    clearTimeout(timer);
  }

  emptyTimers.delete(channelId);
}

function cancelConfiguredAutoDelete(channelId: string) {
  const timer = configuredAutoDeleteTimers.get(channelId);

  if (timer) {
    clearTimeout(timer);
  }

  configuredAutoDeleteTimers.delete(channelId);
}

function voiceMemberCount(guild: Guild, channelId: string) {
  return guild.voiceStates.cache.filter((state) => state.channelId === channelId).size;
}

async function reconcileAll(client: Client<true>, context: BotContext) {
  for (const guild of client.guilds.cache.values()) {
    const settings = await context.api.getTemporaryVoiceSettings(guild.id).catch(() => null);

    if (!settings?.enabled) continue;

    await publishPanel(guild, context, settings).catch((error) => {
      console.warn("[temporary-voice] painel:", error instanceof Error ? error.message : String(error));
    });

    const calls = await context.api.listTemporaryCalls(guild.id).catch(() => []);

    for (const call of calls) {
      const channel = await guild.channels.fetch(call.channelId).catch(() => null);

      if (!channel) {
        await context.api.deleteTemporaryCall(guild.id, call.id).catch(() => null);
        continue;
      }

      await inspectEmpty(channel, context, call);
    }

    for (const channelId of settings.autoDeleteChannelIds) {
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      await inspectConfiguredAutoDelete(channel, context, settings);
    }
  }
}

async function inspectConfiguredAutoDelete(raw: Channel | null | undefined, context: BotContext, settings: TemporaryVoiceSettings) {
  if (!raw || raw.type !== ChannelType.GuildVoice || !settings.autoDeleteChannelIds.includes(raw.id)) {
    return;
  }

  if (voiceMemberCount(raw.guild, raw.id) > 0) {
    cancelConfiguredAutoDelete(raw.id);
    return;
  }

  if (configuredAutoDeleteTimers.has(raw.id)) {
    return;
  }

  const delay = Math.max(1, settings.emptyDeleteMinutes) * 60_000;
  const timer = setTimeout(() => void deleteConfiguredAutoDeleteChannel(raw, context, settings), delay);
  timer.unref();
  configuredAutoDeleteTimers.set(raw.id, timer);
}

async function deleteConfiguredAutoDeleteChannel(channel: VoiceChannel, context: BotContext, settings: TemporaryVoiceSettings) {
  configuredAutoDeleteTimers.delete(channel.id);

  const fresh = await channel.guild.channels.fetch(channel.id).catch(() => null);

  if (!fresh || fresh.type !== ChannelType.GuildVoice || !settings.autoDeleteChannelIds.includes(fresh.id)) {
    return;
  }

  if (voiceMemberCount(fresh.guild, fresh.id) > 0) {
    return;
  }

  const channelName = fresh.name;
  await fresh.delete("Canal de voz configurado para exclusao automatica quando vazio");
  await context.api.postLog({
    guildId: settings.guildId,
    message: `Call selecionada deletada automaticamente: ${channelName}.`,
    metadata: {
      channelId: channel.id,
      channelName
    },
    type: "voice.auto_delete_channel",
    userId: context.client.user?.id ?? "system"
  }).catch(() => null);

  if (!settings.logChannelId) return;

  const logChannel = await channel.guild.channels.fetch(settings.logChannelId).catch(() => null);

  if (logChannel?.isTextBased() && logChannel.isSendable()) {
    await logChannel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("Call deletada automaticamente")
          .setDescription(`A call **${channelName}** foi apagada porque ficou vazia.`)
          .setTimestamp()
      ]
    }).catch(() => null);
  }
}

async function publishPanel(guild: Guild, context: BotContext, settings: TemporaryVoiceSettings) {
  if (!settings.panelChannelId) return;

  const channel = await guild.channels.fetch(settings.panelChannelId).catch(() => null);

  if (!channel?.isTextBased() || !channel.isSendable()) {
    throw new Error("O canal configurado para o painel de calls temporárias está indisponível.");
  }

  if (settings.panelMessageId) {
    const message = await channel.messages.fetch(settings.panelMessageId).catch(() => null);

    if (message) return;
  }

  const message = await channel.send(panelPayload(guild));
  await context.api.updateTemporaryVoicePanelState(guild.id, message.id);
}

function panelPayload(guild: Guild | null = null) {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(IDs.private, "perigo", ButtonStyle.Danger, guild),
    button(IDs.public, "liga", ButtonStyle.Success, guild),
    button(IDs.limit, "prancheta_caneta", ButtonStyle.Primary, guild),
    button(IDs.create, "acessar", ButtonStyle.Secondary, guild)
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(IDs.allow, "visto", ButtonStyle.Success, guild),
    button(IDs.disconnect, "porta", ButtonStyle.Secondary, guild),
    button(IDs.ban, "perigo", ButtonStyle.Danger, guild),
    button(IDs.delete, "exclamacao", ButtonStyle.Danger, guild)
  );

  const container = new ContainerBuilder()
    .setAccentColor(0x111827)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${systemEmojiText("engrenagem", guild)} Gerenciamento das calls temporárias\nAqui você verá todas as formas de gerenciar sua call temporária.`))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${systemEmojiText("prancheta_caneta", guild)} Edição\n${systemEmojiText("perigo", guild)} | Deixar privada\n${systemEmojiText("liga", guild)} | Deixar pública\n${systemEmojiText("prancheta_caneta", guild)} | Alterar limite`))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${systemEmojiText("engrenagem", guild)} Gerenciamento\n${systemEmojiText("visto", guild)} | Permitir alguém\n${systemEmojiText("porta", guild)} | Desconectar alguém\n${systemEmojiText("perigo", guild)} | Banir alguém`))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${systemEmojiText("discord", guild)} Gerenciamento da call\n${systemEmojiText("acessar", guild)} | Criar call\n${systemEmojiText("exclamacao", guild)} | Deletar call`))
    .addActionRowComponents(row1, row2);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function button(id: string, emoji: Parameters<typeof systemComponentEmoji>[0], style: ButtonStyle, guild: Guild | null = null) {
  return new ButtonBuilder().setCustomId(id).setEmoji(systemComponentEmoji(emoji, guild)).setStyle(style);
}

async function logCall(context: BotContext, settings: TemporaryVoiceSettings, call: TemporaryCall, action: string, userId: string) {
  await context.api.postLog({
    guildId: call.guildId,
    message: `${action}: ${call.channelName}.`,
    metadata: {
      action,
      channelId: call.channelId,
      ownerId: call.ownerId
    },
    type: "voice.temporary_call",
    userId
  }).catch(() => null);

  if (!settings.logChannelId) return;

  const guild = context.client.guilds.cache.get(call.guildId);
  const channel = await guild?.channels.fetch(settings.logChannelId).catch(() => null);

  if (channel?.isTextBased() && channel.isSendable()) {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x3b82f6)
          .setTitle("🔊 Call Temporária")
          .setDescription(`**Ação:** ${action}\n**Dono:** <@${call.ownerId}>\n**Canal:** ${call.channelName}`)
          .setTimestamp()
      ]
    });
  }
}

async function ephemeral(interaction: Interaction, content: string) {
  if (!interaction.isRepliable()) return;

  if (interaction.deferred) {
    await interaction.editReply({ components: [], content });
    return;
  }

  if (interaction.replied) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  EmbedBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SectionBuilder,
  TextInputBuilder,
  TextInputStyle,
  TextDisplayBuilder,
  ThumbnailBuilder,
  type ButtonInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type Interaction,
  type ModalSubmitInteraction,
  type TextBasedChannel
} from "discord.js";
import { env, isBotModuleEnabled } from "../config/env";
import type { BotContext } from "../types";
import type { FivemFacAbsence, FivemFacSettings } from "./apiClient";
import { assertPanelChannelPermissions, pinPanelMessage } from "./panelDeliveryService";

const FAC_PREFIX = "fivem_fac";
const REQUEST_BUTTON_ID = `${FAC_PREFIX}:request`;
const MINE_BUTTON_ID = `${FAC_PREFIX}:mine`;
const REQUEST_MODAL_PREFIX = `${FAC_PREFIX}:request_modal`;
const CONFIRM_PREFIX = `${FAC_PREFIX}:confirm`;
const CANCEL_PREFIX = `${FAC_PREFIX}:cancel`;
const REJECT_MODAL_PREFIX = `${FAC_PREFIX}:reject_modal`;
const APPROVE_PREFIX = `${FAC_PREFIX}:approve`;
const REJECT_PREFIX = `${FAC_PREFIX}:reject`;
const CLOSE_PREFIX = `${FAC_PREFIX}:close`;
const FAC_CHECK_INTERVAL_MS = 60_000;
const FAC_PANEL_REQUEST_CHECK_INTERVAL_MS = 15_000;
const PENDING_REQUEST_TTL_MS = 10 * 60_000;

type PendingAbsenceRequest = {
  createdAt: number;
  endDate: string;
  guildId: string;
  reason: string;
  startDate: string;
  userId: string;
  username: string | null;
};

let dueCheckRunning = false;
let panelRequestCheckRunning = false;
let serviceStarted = false;
const handledPanelRequests = new Map<string, string>();
const panelPublishPromises = new Map<string, Promise<FivemFacSettings>>();
const panelRequestErrorLogAt = new Map<string, number>();
const pendingAbsenceRequests = new Map<string, PendingAbsenceRequest>();

export function startFivemFacService(client: Client, context: BotContext) {
  if (!isBotModuleEnabled("fivem-fac")) {
    return;
  }

  if (serviceStarted) {
    return;
  }

  serviceStarted = true;

  context.socket.onFivemFacSettingsUpdated((payload) => {
    if (!isPayloadForThisBot(payload.botId)) {
      return;
    }

    console.log(`[fivem-fac] configuracao atualizada em tempo real para ${payload.guildId}.`);
  });

  context.socket.onFivemFacPanelPublish((payload) => {
    if (!isPayloadForThisBot(payload.botId)) {
      return;
    }

    void publishRequestedFivemFacPanel(client, context, payload.guildId).catch((error) => {
      console.error(`[fivem-fac] falha ao publicar painel em ${payload.guildId}:`, errorMessage(error));
    });
  });

  context.socket.onFivemFacAbsenceUpdated((payload) => {
    const absence = payload.absence;

    if (!isPayloadForThisBot(payload.botId) || !isFivemFacAbsencePayload(absence)) {
      return;
    }

    void updateFivemFacAbsenceMessage(client, absence).catch((error) => {
      console.warn(`[fivem-fac] falha ao atualizar mensagem da ausencia ${absence.id}:`, errorMessage(error));
    });
  });

  void context.api.getActiveFivemFacConfigs()
    .then((configs) => console.log(`[fivem-fac] ${configs.length} configuracao(oes) ativa(s) carregada(s).`))
    .catch((error) => console.warn("[fivem-fac] nao foi possivel carregar configuracoes:", errorMessage(error)));

  void processDueFivemFacAbsences(client, context);
  void processPendingFivemFacPanelRequests(client, context);

  const interval = setInterval(() => {
    void processDueFivemFacAbsences(client, context);
  }, FAC_CHECK_INTERVAL_MS);
  const panelInterval = setInterval(() => {
    void processPendingFivemFacPanelRequests(client, context);
  }, FAC_PANEL_REQUEST_CHECK_INTERVAL_MS);

  interval.unref();
  panelInterval.unref();
}

export async function handleFivemFacInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.isButton() && !interaction.isModalSubmit()) {
    return false;
  }

  const customId = interaction.customId;

  if (!customId.startsWith(`${FAC_PREFIX}:`)) {
    return false;
  }

  if (!isBotModuleEnabled("fivem-fac")) {
    await replySafely(interaction, "O sistema FAC nao foi liberado para este bot na dashboard.");
    return true;
  }

  if (!interaction.guild) {
    await replySafely(interaction, "Este recurso esta disponivel apenas em servidores.");
    return true;
  }

  if (interaction.isButton()) {
    await handleFivemFacButton(interaction, context);
    return true;
  }

  await handleFivemFacModal(interaction, context);
  return true;
}

async function handleFivemFacButton(interaction: ButtonInteraction, context: BotContext) {
  if (interaction.customId === REQUEST_BUTTON_ID) {
    await showRequestModal(interaction);
    return;
  }

  if (interaction.customId === MINE_BUTTON_ID) {
    await showMyAbsences(interaction, context);
    return;
  }

  const [prefix, action, value] = interaction.customId.split(":");

  if (prefix !== FAC_PREFIX || !value) {
    await interaction.reply({
      content: "Acao do FAC invalida.",
      ephemeral: true
    });
    return;
  }

  if (action === "confirm") {
    await confirmAbsenceRequest(interaction, context, value);
    return;
  }

  if (action === "cancel") {
    await cancelAbsenceRequest(interaction, value);
    return;
  }

  if (action === "approve") {
    await approveAbsence(interaction, context, value);
    return;
  }

  if (action === "reject") {
    await showRejectModal(interaction, value);
    return;
  }

  if (action === "close") {
    await closeAbsence(interaction, context, value);
    return;
  }

  await interaction.reply({
    content: "Acao do FAC nao reconhecida.",
    ephemeral: true
  });
}

async function handleFivemFacModal(interaction: ModalSubmitInteraction, context: BotContext) {
  if (interaction.customId.startsWith(`${REQUEST_MODAL_PREFIX}:`)) {
    await submitAbsenceRequest(interaction, context);
    return;
  }

  if (interaction.customId.startsWith(`${REJECT_MODAL_PREFIX}:`)) {
    const absenceId = interaction.customId.slice(`${REJECT_MODAL_PREFIX}:`.length);
    await rejectAbsence(interaction, context, absenceId);
    return;
  }

  await interaction.reply({
    content: "Formulario do FAC nao reconhecido.",
    ephemeral: true
  });
}

async function showRequestModal(interaction: ButtonInteraction) {
  const modal = new ModalBuilder()
    .setCustomId(`${REQUEST_MODAL_PREFIX}:${interaction.guildId}`)
    .setTitle("📅 Solicitar Ausência");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("returnDate")
        .setLabel("📅 Data de Retorno")
        .setMaxLength(5)
        .setPlaceholder("Exemplo: 12/06")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("📝 Motivo da Ausência")
        .setMaxLength(300)
        .setPlaceholder("Exemplo: Viagem, trabalho, estudos, problemas pessoais, etc.")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
    )
  );

  await interaction.showModal(modal);
}

async function showRejectModal(interaction: ButtonInteraction, absenceId: string) {
  const modal = new ModalBuilder()
    .setCustomId(`${REJECT_MODAL_PREFIX}:${absenceId}`)
    .setTitle("Reprovar Ausencia");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Motivo da reprovacao")
        .setMaxLength(800)
        .setRequired(true)
        .setStyle(TextInputStyle.Paragraph)
    )
  );

  await interaction.showModal(modal);
}

async function submitAbsenceRequest(interaction: ModalSubmitInteraction, context: BotContext) {
  await interaction.deferReply({
    ephemeral: true
  });

  const guild = interaction.guild;

  if (!guild) {
    await interaction.editReply("Servidor nao encontrado.");
    return;
  }

  const startDate = currentDateKey();
  const endDate = normalizeReturnDateInput(interaction.fields.getTextInputValue("returnDate"), startDate);
  const reason = interaction.fields.getTextInputValue("reason").trim();

  if (!endDate) {
    await interaction.editReply("Use a data de retorno no formato DD/MM. Exemplo: 12/06.");
    return;
  }

  if (!reason) {
    await interaction.editReply("Informe o motivo da ausencia.");
    return;
  }

  try {
    const settings = await context.api.getFivemFacSettings(guild.id);

    if (!hasMemberRole(interaction, settings)) {
      await interaction.editReply("Voce nao possui um cargo de membro autorizado para solicitar ausencia.");
      return;
    }

    const token = createPendingAbsenceRequest({
      createdAt: Date.now(),
      endDate,
      guildId: guild.id,
      reason,
      startDate,
      userId: interaction.user.id,
      username: interaction.member instanceof Object && "displayName" in interaction.member
        ? interaction.member.displayName
        : interaction.user.username
    });

    await interaction.editReply(buildRequestSummaryPayload(token, {
      endDate,
      reason,
      startDate
    }));
  } catch (error) {
    await interaction.editReply(readRequestErrorMessage(error) ?? "Nao foi possivel preparar sua solicitacao de ausencia.");
  }
}

async function confirmAbsenceRequest(interaction: ButtonInteraction, context: BotContext, token: string) {
  await interaction.deferUpdate();
  cleanupPendingAbsenceRequests();

  const pending = pendingAbsenceRequests.get(token);

  if (!pending || pending.userId !== interaction.user.id || pending.guildId !== interaction.guildId) {
    await interaction.editReply({
      components: [],
      content: "Esta solicitacao expirou. Abra o formulario novamente.",
      embeds: []
    });
    return;
  }

  pendingAbsenceRequests.delete(token);

  const guild = interaction.guild;

  if (!guild) {
    await interaction.editReply({
      components: [],
      content: "Servidor nao encontrado.",
      embeds: []
    });
    return;
  }

  try {
    const settings = await context.api.getFivemFacSettings(guild.id);

    if (!hasMemberRole(interaction, settings)) {
      await interaction.editReply({
        components: [],
        content: "Voce nao possui um cargo de membro autorizado para solicitar ausencia.",
        embeds: []
      });
      return;
    }

    const absence = await context.api.createFivemFacAbsence({
      guildId: guild.id,
      notes: null,
      reason: pending.reason,
      startDate: pending.startDate,
      endDate: pending.endDate,
      userId: pending.userId,
      username: pending.username
    });
    const channelResult = await createAbsenceChannel(guild, settings, absence);

    if (channelResult.channel && channelResult.messageId) {
      await context.api.updateFivemFacAbsenceChannel(absence.id, {
        privateChannelId: channelResult.channel.id,
        requestMessageId: channelResult.messageId
      });
    }

    await sendFacLog(guild, settings, "Solicitacao criada", absence, interaction.user.id);
    await interaction.editReply({
      components: [],
      content: channelResult.channel
        ? `${settings.messages.requestCreated}\nCanal de aprovacao: <#${channelResult.channel.id}>`
        : `${settings.messages.requestCreated}\nA solicitacao foi salva, mas nao consegui criar o canal de aprovacao. Avise a equipe.`,
      embeds: []
    });
  } catch (error) {
    await interaction.editReply({
      components: [],
      content: readRequestErrorMessage(error) ?? "Nao foi possivel criar sua solicitacao de ausencia.",
      embeds: []
    });
  }
}

async function cancelAbsenceRequest(interaction: ButtonInteraction, token: string) {
  await interaction.deferUpdate();
  pendingAbsenceRequests.delete(token);
  await interaction.editReply({
    components: [],
    content: "Solicitacao cancelada.",
    embeds: []
  });
}

async function showMyAbsences(interaction: ButtonInteraction, context: BotContext) {
  await interaction.deferReply({
    ephemeral: true
  });

  const guild = interaction.guild;

  if (!guild) {
    await interaction.editReply("Servidor nao encontrado.");
    return;
  }

  try {
    const absences = await context.api.getFivemFacUserAbsences(guild.id, interaction.user.id);

    if (!absences.length) {
      await interaction.editReply("Voce ainda nao possui ausencias registradas.");
      return;
    }

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("Minhas ausencias")
          .setDescription(absences.map(formatAbsenceLine).join("\n"))
      ]
    });
  } catch (error) {
    await interaction.editReply(readRequestErrorMessage(error) ?? "Nao foi possivel buscar suas ausencias.");
  }
}

async function approveAbsence(interaction: ButtonInteraction, context: BotContext, absenceId: string) {
  await interaction.deferReply({
    ephemeral: true
  });

  const guild = interaction.guild;

  if (!guild) {
    await interaction.editReply("Servidor nao encontrado.");
    return;
  }

  try {
    const settings = await context.api.getFivemFacSettings(guild.id);

    if (!hasApproverRole(interaction, settings)) {
      await interaction.editReply("Voce nao possui cargo autorizado para aprovar ausencias.");
      return;
    }

    let absence = await context.api.approveFivemFacAbsence(absenceId, {
      moderatorId: interaction.user.id,
      moderatorRoleIds: interactionRoleIds(interaction)
    });

    const roleAdded = await addAbsenceRole(guild, settings, absence).catch(async (error) => {
      await sendFacLog(guild, settings, "Falha ao adicionar cargo", absence, interaction.user.id, errorMessage(error));
      return false;
    });
    absence = await context.api.markFivemFacAbsenceStarted(absence.id, roleAdded);
    await sendFacLog(guild, settings, roleAdded ? "Cargo adicionado" : "Ausencia aprovada sem cargo", absence, interaction.user.id);

    await updateAbsenceMessage(interaction, settings, absence);
    await sendFacLog(guild, settings, "Solicitacao aprovada", absence, interaction.user.id);
    await notifyAbsenceUser(guild, absence, settings.messages.approved);
    await interaction.editReply("Ausencia aprovada.");
  } catch (error) {
    await interaction.editReply(readRequestErrorMessage(error) ?? "Nao foi possivel aprovar essa ausencia.");
  }
}

async function rejectAbsence(interaction: ModalSubmitInteraction, context: BotContext, absenceId: string) {
  await interaction.deferReply({
    ephemeral: true
  });

  const guild = interaction.guild;

  if (!guild) {
    await interaction.editReply("Servidor nao encontrado.");
    return;
  }

  try {
    const settings = await context.api.getFivemFacSettings(guild.id);

    if (!hasApproverRole(interaction, settings)) {
      await interaction.editReply("Voce nao possui cargo autorizado para reprovar ausencias.");
      return;
    }

    const reason = interaction.fields.getTextInputValue("reason");
    const absence = await context.api.rejectFivemFacAbsence(absenceId, {
      moderatorId: interaction.user.id,
      moderatorRoleIds: interactionRoleIds(interaction),
      reason
    });

    await updateAbsenceMessage(interaction, settings, absence);
    await sendFacLog(guild, settings, "Solicitacao reprovada", absence, interaction.user.id, reason);
    await notifyAbsenceUser(guild, absence, `${settings.messages.rejected}\nMotivo: ${reason}`);
    await interaction.editReply("Ausencia reprovada.");
  } catch (error) {
    await interaction.editReply(readRequestErrorMessage(error) ?? "Nao foi possivel reprovar essa ausencia.");
  }
}

async function closeAbsence(interaction: ButtonInteraction, context: BotContext, absenceId: string) {
  await interaction.deferReply({
    ephemeral: true
  });

  const guild = interaction.guild;

  if (!guild) {
    await interaction.editReply("Servidor nao encontrado.");
    return;
  }

  try {
    const settings = await context.api.getFivemFacSettings(guild.id);

    if (!hasApproverRole(interaction, settings)) {
      await interaction.editReply("Voce nao possui cargo autorizado para encerrar ausencias.");
      return;
    }

    const current = await context.api.getFivemFacAbsence(absenceId);
    const roleRemoved = await removeAbsenceRole(guild, settings, current);
    const absence = await context.api.closeFivemFacAbsence(absenceId, {
      moderatorId: interaction.user.id,
      moderatorRoleIds: interactionRoleIds(interaction),
      roleRemoved
    });

    await updateAbsenceMessage(interaction, settings, absence);
    await sendFacLog(guild, settings, roleRemoved ? "Cargo removido" : "Ausencia encerrada", absence, interaction.user.id);
    await notifyAbsenceUser(guild, absence, "Sua ausencia foi encerrada pela equipe.");
    await interaction.editReply("Ausencia encerrada.");
  } catch (error) {
    await interaction.editReply(readRequestErrorMessage(error) ?? "Nao foi possivel encerrar essa ausencia.");
  }
}

async function publishRequestedFivemFacPanel(client: Client, context: BotContext, guildId: string) {
  const key = panelRequestKey(guildId);
  const current = panelPublishPromises.get(key);

  if (current) {
    return current;
  }

  const next = publishFivemFacPanel(client, context, guildId)
    .then((settings) => {
      rememberHandledPanelRequest(settings);
      return settings;
    })
    .finally(() => {
      panelPublishPromises.delete(key);
    });

  panelPublishPromises.set(key, next);
  return next;
}

async function publishFivemFacPanel(client: Client, context: BotContext, guildId: string) {
  const guild = await client.guilds.fetch(guildId);
  const settings = await context.api.getFivemFacSettings(guildId);

  if (!settings.enabled || !settings.panelChannelId) {
    throw new Error("FAC nao esta ativo ou sem canal de painel.");
  }

  const channel = await guild.channels.fetch(settings.panelChannelId);

  if (!channel || !channel.isTextBased()) {
    throw new Error("Canal de painel FAC invalido.");
  }

  assertPanelChannelPermissions(channel, client, "FAC");

  const payload = buildPanelPayload(settings);
  let messageId: string | null = null;

  if (settings.panelMessageId) {
    const oldMessage = await channel.messages.fetch(settings.panelMessageId).catch(() => null);

    if (oldMessage) {
      if (oldMessage.flags.has(MessageFlags.IsComponentsV2)) {
        await oldMessage.delete().catch(() => null);
      } else {
        const edited = await oldMessage.edit(payload);
        await pinPanelMessage(edited, "FAC");
        messageId = edited.id;
      }
    }
  }

  if (!messageId) {
    const message = await channel.send(payload);
    await pinPanelMessage(message, "FAC");
    messageId = message.id;
  }

  const saved = await context.api.updateFivemFacPanelState({
    guildId,
    messageId
  });
  await sendFacLog(guild, settings, "Painel publicado", null, client.user?.id ?? null);
  console.log(`[fivem-fac] painel publicado em ${guild.name}.`);
  return saved;
}

async function createAbsenceChannel(guild: Guild, settings: FivemFacSettings, absence: FivemFacAbsence) {
  const panelChannel = settings.panelChannelId
    ? await guild.channels.fetch(settings.panelChannelId).catch(() => null)
    : null;
  const parent = panelChannel && "parentId" in panelChannel ? panelChannel.parentId : null;
  const allowedRoleIds = unique([...settings.viewerRoleIds, ...settings.approverRoleIds]).filter((roleId) => roleId !== guild.id);
  const channel = await guild.channels.create({
    name: `ausencia-${sanitizeChannelName(absence.username ?? absence.userId)}`,
    parent: parent ?? undefined,
    permissionOverwrites: [
      {
        id: guild.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: absence.userId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      },
      ...allowedRoleIds.map((roleId) => ({
        id: roleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      }))
    ],
    reason: "Canal privado para solicitacao de ausencia FAC",
    type: ChannelType.GuildText
  });
  const message = await channel.send({
    embeds: [buildAbsenceEmbed(absence)],
    components: buildAbsenceComponents(absence)
  });

  return {
    channel,
    messageId: message.id
  };
}

async function processDueFivemFacAbsences(client: Client, context: BotContext) {
  if (dueCheckRunning || !isBotModuleEnabled("fivem-fac")) {
    return;
  }

  dueCheckRunning = true;

  try {
    const today = currentDateKey();
    const absences = await context.api.getFivemFacDueAbsences(today);

    for (const absence of absences) {
      await processDueAbsence(client, context, absence, today).catch((error) => {
        console.warn(`[fivem-fac] falha ao processar ausencia ${absence.id}:`, errorMessage(error));
      });
    }
  } catch (error) {
    console.warn("[fivem-fac] falha no monitor de datas:", errorMessage(error));
  } finally {
    dueCheckRunning = false;
  }
}

async function processPendingFivemFacPanelRequests(client: Client, context: BotContext) {
  if (panelRequestCheckRunning || !isBotModuleEnabled("fivem-fac")) {
    return;
  }

  panelRequestCheckRunning = true;

  try {
    const configs = await context.api.getActiveFivemFacConfigs();

    for (const settings of configs) {
      if (!settings.lastPanelRequestedAt) {
        continue;
      }

      const key = panelRequestKey(settings.guildId);

      if (handledPanelRequests.get(key) === settings.lastPanelRequestedAt) {
        continue;
      }

      await publishRequestedFivemFacPanel(client, context, settings.guildId).catch((error) => {
        logPanelRequestError(key, `[fivem-fac] falha ao publicar painel pendente em ${settings.guildId}:`, error);
      });
    }
  } catch (error) {
    console.warn("[fivem-fac] falha ao verificar pedidos pendentes de painel:", errorMessage(error));
  } finally {
    panelRequestCheckRunning = false;
  }
}

async function processDueAbsence(client: Client, context: BotContext, absence: FivemFacAbsence, today: string) {
  const guild = await client.guilds.fetch(absence.guildId);
  const settings = await context.api.getFivemFacSettings(absence.guildId);
  let current = absence;

  if (current.status === "approved" && current.startDate <= today) {
    const roleAdded = await addAbsenceRole(guild, settings, current);
    current = await context.api.markFivemFacAbsenceStarted(current.id, roleAdded);
    await sendFacLog(guild, settings, roleAdded ? "Cargo adicionado" : "Ausencia iniciada sem cargo", current, null);
    await sendFacLog(guild, settings, "Ausencia iniciada", current, null);
    await notifyAbsenceUser(guild, current, settings.messages.started);
    await updateStoredAbsenceMessage(guild, current);
  }

  if ((current.status === "active" || current.status === "approved") && current.endDate <= today) {
    const roleRemoved = await removeAbsenceRole(guild, settings, current);
    current = await context.api.markFivemFacAbsenceFinished(current.id, roleRemoved);
    await sendFacLog(guild, settings, roleRemoved ? "Cargo removido" : "Ausencia finalizada sem cargo", current, null);
    await sendFacLog(guild, settings, "Ausencia finalizada", current, null);
    await notifyAbsenceUser(guild, current, settings.messages.finished);
    await updateStoredAbsenceMessage(guild, current);
  }
}

async function addAbsenceRole(guild: Guild, settings: FivemFacSettings, absence: FivemFacAbsence) {
  if (!settings.absenceRoleId) {
    return false;
  }

  const member = await guild.members.fetch(absence.userId).catch(() => null);

  if (!member) {
    return false;
  }

  if (member.roles.cache.has(settings.absenceRoleId)) {
    return true;
  }

  await member.roles.add(settings.absenceRoleId, "Inicio de ausencia FAC");
  return true;
}

async function removeAbsenceRole(guild: Guild, settings: FivemFacSettings, absence: FivemFacAbsence) {
  if (!settings.absenceRoleId) {
    return false;
  }

  const member = await guild.members.fetch(absence.userId).catch(() => null);

  if (!member) {
    return false;
  }

  if (!member.roles.cache.has(settings.absenceRoleId)) {
    return true;
  }

  await member.roles.remove(settings.absenceRoleId, "Fim de ausencia FAC");
  return true;
}

async function updateAbsenceMessage(interaction: ButtonInteraction | ModalSubmitInteraction, settings: FivemFacSettings, absence: FivemFacAbsence) {
  if (interaction.isMessageComponent() && interaction.message.editable) {
    await interaction.message.edit({
      embeds: [buildAbsenceEmbed(absence)],
      components: buildAbsenceComponents(absence)
    }).catch(() => null);
    return;
  }

  if (interaction.guild) {
    await updateStoredAbsenceMessage(interaction.guild, absence);
  }
}

async function updateStoredAbsenceMessage(guild: Guild, absence: FivemFacAbsence) {
  if (!absence.privateChannelId || !absence.requestMessageId) {
    return;
  }

  const channel = await guild.channels.fetch(absence.privateChannelId).catch(() => null);

  if (!channel?.isTextBased()) {
    return;
  }

  const message = await channel.messages.fetch(absence.requestMessageId).catch(() => null);
  await message?.edit({
    embeds: [buildAbsenceEmbed(absence)],
    components: buildAbsenceComponents(absence)
  }).catch(() => null);
}

async function updateFivemFacAbsenceMessage(client: Client, absence: FivemFacAbsence) {
  const guild = await client.guilds.fetch(absence.guildId).catch(() => null);

  if (!guild) {
    return;
  }

  await updateStoredAbsenceMessage(guild, absence);
}

async function sendFacLog(
  guild: Guild,
  settings: FivemFacSettings,
  title: string,
  absence: FivemFacAbsence | null,
  actorId: string | null,
  reason?: string | null
) {
  if (!settings.logChannelId) {
    return;
  }

  const channel = await guild.channels.fetch(settings.logChannelId).catch(() => null);

  if (!channel?.isTextBased()) {
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(`FAC - ${title}`)
    .setTimestamp(new Date());

  if (absence) {
    embed.addFields(
      { name: "Usuario", value: `<@${absence.userId}>`, inline: true },
      { name: "ID Discord", value: absence.userId, inline: true },
      { name: "Status", value: statusLabel(absence.status), inline: true },
      { name: "Inicio", value: formatDateOnly(absence.startDate), inline: true },
      { name: "Termino", value: formatDateOnly(absence.endDate), inline: true },
      { name: "Moderador", value: actorId ? `<@${actorId}>` : absence.moderatorId ? `<@${absence.moderatorId}>` : "Automatico", inline: true },
      { name: "Motivo", value: truncate(absence.reason, 1024), inline: false }
    );

    if (reason || absence.rejectionReason) {
      embed.addFields({ name: "Detalhe", value: truncate(reason ?? absence.rejectionReason ?? "", 1024), inline: false });
    }
  } else if (actorId) {
    embed.addFields({ name: "Responsavel", value: `<@${actorId}>`, inline: true });
  }

  await channel.send({
    embeds: [embed]
  }).catch(() => null);
}

async function notifyAbsenceUser(guild: Guild, absence: FivemFacAbsence, message: string) {
  const user = await guild.client.users.fetch(absence.userId).catch(() => null);

  await user?.send(message).catch(() => null);

  if (!absence.privateChannelId) {
    return;
  }

  const channel = await guild.channels.fetch(absence.privateChannelId).catch(() => null);

  if (channel?.isTextBased()) {
    await channel.send(`<@${absence.userId}> ${message}`).catch(() => null);
  }
}

function buildPanelPayload(settings: FivemFacSettings) {
  return {
    allowedMentions: {
      parse: []
    },
    embeds: [
      new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle("📅 Solicitar Ausência")
        .setDescription("Informe a data de retorno e o motivo da sua ausência.")
        .setTimestamp(new Date())
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(REQUEST_BUTTON_ID)
          .setLabel("Solicitar Ausência")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(MINE_BUTTON_ID)
          .setLabel("Minhas Ausências")
          .setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

function buildAbsenceEmbed(absence: FivemFacAbsence) {
  const embed = new EmbedBuilder()
    .setColor(statusColor(absence.status))
    .setTitle("Solicitacao de Ausencia")
    .setDescription(absence.notes ? truncate(absence.notes, 1000) : "Sem observacoes adicionais.")
    .addFields(
      { name: "Usuario", value: `<@${absence.userId}>`, inline: true },
      { name: "Status", value: statusLabel(absence.status), inline: true },
      { name: "Periodo", value: `${formatDateOnly(absence.startDate)} ate ${formatDateOnly(absence.endDate)}`, inline: true },
      { name: "Duracao", value: `${absenceDurationDays(absence.startDate, absence.endDate)} dia(s)`, inline: true },
      { name: "Motivo", value: truncate(absence.reason, 1024), inline: false }
    )
    .setFooter({ text: `ID: ${absence.id}` })
    .setTimestamp(new Date(absence.updatedAt));

  if (absence.rejectionReason) {
    embed.addFields({ name: "Motivo da reprovacao", value: truncate(absence.rejectionReason, 1024), inline: false });
  }

  const photoUrl = toPublicImageUrl(absence.photoUrl);

  if (photoUrl) {
    embed.setImage(photoUrl);
  }

  return embed;
}

function buildAbsenceComponents(absence: FivemFacAbsence) {
  const closed = ["rejected", "finished", "closed"].includes(absence.status);
  const pending = absence.status === "pending";

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${APPROVE_PREFIX}:${absence.id}`)
        .setDisabled(!pending)
        .setLabel("Aprovar")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${REJECT_PREFIX}:${absence.id}`)
        .setDisabled(!pending)
        .setLabel("Reprovar")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`${CLOSE_PREFIX}:${absence.id}`)
        .setDisabled(closed)
        .setLabel("Encerrar")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function hasApproverRole(interaction: ButtonInteraction | ModalSubmitInteraction, settings: FivemFacSettings) {
  const allowed = new Set(settings.approverRoleIds);
  return interactionRoleIds(interaction).some((roleId) => allowed.has(roleId));
}

function hasMemberRole(interaction: ButtonInteraction | ModalSubmitInteraction, settings: FivemFacSettings) {
  const allowed = new Set(settings.memberRoleIds ?? []);

  if (!allowed.size) {
    return true;
  }

  return interactionRoleIds(interaction).some((roleId) => allowed.has(roleId));
}

function buildRequestSummaryPayload(
  token: string,
  request: Pick<PendingAbsenceRequest, "endDate" | "reason" | "startDate">
) {
  return {
    content: "",
    embeds: [
      new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle("Resumo da Ausência")
        .setDescription([
          `📅 **Início:** ${formatShortDateOnly(request.startDate)} (automático)`,
          `📅 **Retorno:** ${formatShortDateOnly(request.endDate)}`,
          `⏳ **Duração:** ${absenceDurationDays(request.startDate, request.endDate)} dia(s)`,
          `📝 **Motivo:** ${truncate(request.reason, 500)}`
        ].join("\n"))
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${CONFIRM_PREFIX}:${token}`)
          .setLabel("Enviar Solicitação")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`${CANCEL_PREFIX}:${token}`)
          .setLabel("Cancelar")
          .setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

function createPendingAbsenceRequest(request: PendingAbsenceRequest) {
  cleanupPendingAbsenceRequests();
  const token = randomUUID();
  pendingAbsenceRequests.set(token, request);
  return token;
}

function cleanupPendingAbsenceRequests() {
  const now = Date.now();

  for (const [token, request] of pendingAbsenceRequests) {
    if (now - request.createdAt > PENDING_REQUEST_TTL_MS) {
      pendingAbsenceRequests.delete(token);
    }
  }
}

function interactionRoleIds(interaction: ButtonInteraction | ModalSubmitInteraction) {
  const member = interaction.member;
  const roleIds = new Set<string>();

  if (interaction.guildId) {
    roleIds.add(interaction.guildId);
  }

  if (!member) {
    return [...roleIds];
  }

  if (member instanceof Object && "roles" in member) {
    const roles = member.roles;

    if (Array.isArray(roles)) {
      roles.forEach((roleId) => roleIds.add(roleId));
    } else if (roles instanceof Object && "cache" in roles) {
      [...(roles as GuildMember["roles"]).cache.keys()].forEach((roleId) => roleIds.add(roleId));
    }
  }

  return [...roleIds];
}

function normalizeReturnDateInput(value: string, today: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})$/);

  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const currentYear = Number(today.slice(0, 4));
  let dateKey = dateKeyFromParts(currentYear, month, day);

  if (!dateKey) {
    return null;
  }

  if (dateKey < today) {
    dateKey = dateKeyFromParts(currentYear + 1, month, day);
  }

  return dateKey;
}

function dateKeyFromParts(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }

  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0")
  ].join("-");
}

function currentDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
    year: "numeric"
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

function formatAbsenceLine(absence: FivemFacAbsence) {
  return `**${statusLabel(absence.status)}** - ${formatDateOnly(absence.startDate)} ate ${formatDateOnly(absence.endDate)} - ${truncate(absence.reason, 90)}`;
}

function formatDateOnly(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatShortDateOnly(value: string) {
  const [, month, day] = value.split("-");
  return `${day}/${month}`;
}

function absenceDurationDays(startDate: string, endDate: string) {
  const start = dateKeyToUtcMs(startDate);
  const end = dateKeyToUtcMs(endDate);

  if (start === null || end === null || end < start) {
    return 0;
  }

  return Math.round((end - start) / 86_400_000);
}

function dateKeyToUtcMs(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return null;
  }

  return Date.UTC(year, month - 1, day);
}

function toPublicImageUrl(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  const backendOrigin = env.BACKEND_API_URL ? new URL(env.BACKEND_API_URL).origin : "";
  return backendOrigin ? `${backendOrigin}${value.startsWith("/") ? value : `/${value}`}` : null;
}

function isFivemFacAbsencePayload(value: unknown): value is FivemFacAbsence {
  return Boolean(
    value
      && typeof value === "object"
      && "id" in value
      && "guildId" in value
      && "botId" in value
      && "userId" in value
  );
}

function statusLabel(status: FivemFacAbsence["status"]) {
  const labels: Record<FivemFacAbsence["status"], string> = {
    active: "Ativa",
    approved: "Aprovada",
    closed: "Encerrada",
    finished: "Finalizada",
    pending: "Pendente",
    rejected: "Reprovada"
  };

  return labels[status];
}

function statusColor(status: FivemFacAbsence["status"]) {
  const colors: Record<FivemFacAbsence["status"], number> = {
    active: 0x22c55e,
    approved: 0x3b82f6,
    closed: 0x71717a,
    finished: 0xa1a1aa,
    pending: 0xf59e0b,
    rejected: 0xef4444
  };

  return colors[status];
}

function sanitizeChannelName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "membro";
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 3))}...` : value;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function isPayloadForThisBot(botId: string | null | undefined) {
  return !botId || !env.DASHBOARD_BOT_ID || botId === env.DASHBOARD_BOT_ID;
}

function panelRequestKey(guildId: string) {
  return `${env.DASHBOARD_BOT_ID || "bot"}:${guildId}`;
}

function rememberHandledPanelRequest(settings: FivemFacSettings) {
  if (settings.lastPanelRequestedAt) {
    handledPanelRequests.set(panelRequestKey(settings.guildId), settings.lastPanelRequestedAt);
  }
}

function logPanelRequestError(key: string, message: string, error: unknown) {
  const now = Date.now();
  const lastLogAt = panelRequestErrorLogAt.get(key) ?? 0;

  if (now - lastLogAt < 60_000) {
    return;
  }

  panelRequestErrorLogAt.set(key, now);
  console.warn(message, errorMessage(error));
}

async function replySafely(interaction: Interaction, content: string) {
  if (!interaction.isRepliable()) {
    return;
  }

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({
      content,
      ephemeral: true
    });
    return;
  }

  await interaction.reply({
    content,
    ephemeral: true
  });
}

function readRequestErrorMessage(error: unknown) {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return null;
  }

  const response = (error as { response?: { data?: { message?: unknown } } }).response;
  return typeof response?.data?.message === "string" ? response.data.message : null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

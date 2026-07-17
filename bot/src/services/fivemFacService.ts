import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
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
import type { FivemFacAbsence, FivemFacLifecycleResult, FivemFacSettings } from "./apiClient";
import { assertPanelChannelPermissions } from "./panelDeliveryService";
import { replaceSystemEmojis, systemComponentEmoji, systemEmojiText, systemStatusEmoji } from "./systemEmojiService";

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
  notes: string | null;
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

    console.log(`[fivem-fac] configuração atualizada em tempo real para ${payload.guildId}.`);
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
      console.warn(`[fivem-fac] falha ao atualizar mensagem da ausência ${absence.id}:`, errorMessage(error));
    });
  });

  void context.api.getActiveFivemFacConfigs()
    .then((configs) => console.log(`[fivem-fac] ${configs.length} configuração(oes) ativa(s) carregada(s).`))
    .catch((error) => console.warn("[fivem-fac] não foi possível carregar configurações:", errorMessage(error)));

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
    await replySafely(interaction, "O sistema FAC não foi liberado para este bot na dashboard.");
    return true;
  }

  if (!interaction.guild) {
    await replySafely(interaction, "Este recurso está disponível apenas em servidores.");
    return true;
  }

  if (interaction.isButton()) {
    await handleFivemFacButton(interaction, context);
    return true;
  }

  await handleFivemFacModal(interaction, context);
  return true;
}

export async function handleFivemFacMemberAdd(member: GuildMember, context: BotContext) {
  if (!isBotModuleEnabled("fivem-fac")) {
    return;
  }

  const today = currentDateKey();
  const absences = await context.api.getFivemFacUserAbsences(member.guild.id, member.id).catch(() => []);
  const activeAbsence = absences.find((absence) => (
    (absence.status === "active" || absence.status === "approved")
    && absence.startDate <= today
    && absence.endDate > today
  ));

  if (!activeAbsence) {
    const expired = absences.find((absence) => (
      (absence.status === "active" || absence.status === "approved")
      && absence.endDate <= today
    ));

    if (expired) {
      const settings = await context.api.getFivemFacSettings(member.guild.id).catch(() => null);
      if (settings) await processDueAbsence(member.client, context, expired, today).catch(() => null);
    }
    return;
  }

  const settings = await context.api.getFivemFacSettings(member.guild.id).catch(() => null);

  if (!settings) {
    return;
  }

  if (activeAbsence.status === "approved") {
    await startApprovedAbsenceIfDue(member.guild, context, settings, activeAbsence, "automatic").catch(() => null);
    return;
  }

  const roleAdded = await addAbsenceRole(member.guild, settings, activeAbsence).catch(() => false);
  if (roleAdded) {
    await sendFacLog(member.guild, settings, "Cargo de ausência reaplicado ao retornar ao servidor", activeAbsence, "automatic");
  }
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
      ...facNoticePayload({
        accentColor: 0xef4444,
        description: "Este botão não possui os dados necessários para continuar.",
        title: "❌ Ação inválida"
      }),
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
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
    ...facNoticePayload({
      accentColor: 0xef4444,
      description: "Este botão não pertence a uma ação ativa do sistema FAC.",
      title: "❌ Ação não reconhecida"
    }),
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
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
    ...facNoticePayload({
      accentColor: 0xef4444,
      description: "Este formulário não pertence a uma ação ativa do sistema FAC.",
      title: "❌ Formulário inválido"
    }),
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  });
}

async function showRequestModal(interaction: ButtonInteraction) {
  const modal = new ModalBuilder()
    .setCustomId(`${REQUEST_MODAL_PREFIX}:${interaction.guildId}`)
    .setTitle("📅 Solicitar Ausência");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("rpName")
        .setLabel("Nome RP")
        .setMaxLength(80)
        .setPlaceholder("Opcional")
        .setRequired(false)
        .setStyle(TextInputStyle.Short)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("startDate")
        .setLabel("Data de início")
        .setMaxLength(10)
        .setPlaceholder("Exemplo: 17/07 ou 17/07/2026")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("returnDate")
        .setLabel("Data de retorno")
        .setMaxLength(10)
        .setPlaceholder("Exemplo: 20/07 ou 20/07/2026")
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
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("notes")
        .setLabel("Observações")
        .setMaxLength(800)
        .setPlaceholder("Opcional")
        .setRequired(false)
        .setStyle(TextInputStyle.Paragraph)
    )
  );

  await interaction.showModal(modal);
}

async function showRejectModal(interaction: ButtonInteraction, absenceId: string) {
  const modal = new ModalBuilder()
    .setCustomId(`${REJECT_MODAL_PREFIX}:${absenceId}`)
    .setTitle("Reprovar Ausência");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Motivo da reprovação")
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
    await interaction.editReply(facNoticePayload({
      accentColor: 0xef4444,
      description: "Use este recurso dentro de um servidor.",
      title: "❌ Servidor não encontrado"
    }));
    return;
  }

  const today = currentDateKey();
  const startDate = normalizeDateInput(interaction.fields.getTextInputValue("startDate"), today);
  const endDate = normalizeDateInput(interaction.fields.getTextInputValue("returnDate"), startDate ?? today);
  const rpName = interaction.fields.getTextInputValue("rpName").trim();
  const reason = interaction.fields.getTextInputValue("reason").trim();
  const notes = interaction.fields.getTextInputValue("notes").trim();

  if (!startDate || !endDate || endDate < startDate) {
    await interaction.editReply(facNoticePayload({
      accentColor: 0xf59e0b,
      description: "Use as datas no formato **DD/MM** ou **DD/MM/AAAA**, e deixe o retorno igual ou depois do início.",
      title: "📅 Data inválida"
    }));
    return;
  }

  if (!reason) {
    await interaction.editReply(facNoticePayload({
      accentColor: 0xf59e0b,
      description: "Informe um motivo para que a equipe consiga avaliar sua solicitação.",
      title: "📝 Motivo obrigatório"
    }));
    return;
  }

  try {
    const settings = await context.api.getFivemFacSettings(guild.id);

    if (!hasMemberRole(interaction, settings)) {
      await interaction.editReply(facNoticePayload({
        accentColor: 0xef4444,
        description: "Você não possui um cargo autorizado para solicitar ausência pelo FAC.",
        title: "🚫 Acesso negado"
      }));
      return;
    }

    const token = createPendingAbsenceRequest({
      createdAt: Date.now(),
      endDate,
      guildId: guild.id,
      notes: notes || null,
      reason,
      startDate,
      userId: interaction.user.id,
      username: rpName || (interaction.member instanceof Object && "displayName" in interaction.member
        ? interaction.member.displayName
        : interaction.user.username)
    });

    await interaction.editReply(buildRequestSummaryPayload(token, {
      endDate,
      notes: notes || null,
      reason,
      startDate
    }));
  } catch (error) {
    await interaction.editReply(readRequestErrorMessage(error) ?? "Não foi possível preparar sua solicitação de ausência.");
  }
}

async function confirmAbsenceRequest(interaction: ButtonInteraction, context: BotContext, token: string) {
  await interaction.deferUpdate();
  cleanupPendingAbsenceRequests();

  const pending = pendingAbsenceRequests.get(token);

  if (!pending || pending.userId !== interaction.user.id || pending.guildId !== interaction.guildId) {
    await interaction.editReply({
      ...facNoticePayload({
        accentColor: 0xf59e0b,
        description: "Esta solicitação expirou. Abra o formulario novamente para enviar um novo pedido.",
        title: "⏳ Solicitação expirada"
      })
    });
    return;
  }

  pendingAbsenceRequests.delete(token);

  const guild = interaction.guild;

  if (!guild) {
    await interaction.editReply({
      ...facNoticePayload({
        accentColor: 0xef4444,
        description: "Não foi possível identificar o servidor desta solicitação.",
        title: "❌ Servidor não encontrado"
      })
    });
    return;
  }

  try {
    const settings = await context.api.getFivemFacSettings(guild.id);

    if (!hasMemberRole(interaction, settings)) {
      await interaction.editReply({
        ...facNoticePayload({
          accentColor: 0xef4444,
          description: "Você não possui um cargo autorizado para solicitar ausência pelo FAC.",
          title: "🚫 Acesso negado"
        })
      });
      return;
    }

    let absence = await context.api.createFivemFacAbsence({
      guildId: guild.id,
      notes: pending.notes,
      reason: pending.reason,
      startDate: pending.startDate,
      endDate: pending.endDate,
      userId: pending.userId,
      username: pending.username,
      requesterRoleIds: interactionRoleIds(interaction)
    });
    const channelResult = await createAbsenceChannel(guild, settings, absence);

    if (channelResult.channel && channelResult.messageId) {
      await context.api.updateFivemFacAbsenceChannel(absence.id, {
        privateChannelId: channelResult.channel.id,
        requestMessageId: channelResult.messageId
      });
    }

    if (absence.status === "approved") {
      await sendFacLog(guild, settings, "Solicitação autoaprovada", absence, "automatic");
      const startedResult = await startApprovedAbsenceIfDue(guild, context, settings, absence, "automatic");
      absence = startedResult.absence;
    }

    await sendFacLog(guild, settings, "Solicitação criada", absence, interaction.user.id);
    await interaction.editReply({
      ...facNoticePayload({
        accentColor: channelResult.channel ? 0x22c55e : 0xf59e0b,
        description: channelResult.channel
          ? `${settings.messages.requestCreated}\n\n**Canal de aprovação:** <#${channelResult.channel.id}>\n**Status atual:** ${statusLabel(absence.status)}`
          : `${settings.messages.requestCreated}\n\nA solicitação foi salva, mas não consegui criar o canal de aprovacao. Avise a equipe para acompanhar manualmente.`,
        title: channelResult.channel ? "✅ Solicitação enviada" : "⚠️ Solicitação registrada"
      })
    });
  } catch (error) {
    await interaction.editReply({
      ...facNoticePayload({
        accentColor: 0xef4444,
        description: readRequestErrorMessage(error) ?? "Não foi possível criar sua solicitação de ausência.",
        title: "❌ Solicitação não enviada"
      })
    });
  }
}

async function cancelAbsenceRequest(interaction: ButtonInteraction, token: string) {
  await interaction.deferUpdate();
  pendingAbsenceRequests.delete(token);
  await interaction.editReply({
    ...facNoticePayload({
      accentColor: 0x64748b,
      description: "Nenhum pedido foi enviado para análise.",
      title: "↩️ Solicitação cancelada"
    })
  });
}

async function showMyAbsences(interaction: ButtonInteraction, context: BotContext) {
  await interaction.deferReply({
    ephemeral: true
  });

  const guild = interaction.guild;

  if (!guild) {
    await interaction.editReply(facNoticePayload({
      accentColor: 0xef4444,
      description: "Use este recurso dentro de um servidor.",
      title: "❌ Servidor não encontrado"
    }));
    return;
  }

  try {
    const absences = await context.api.getFivemFacUserAbsences(guild.id, interaction.user.id);

    if (!absences.length) {
      await interaction.editReply(facNoticePayload({
        accentColor: 0x64748b,
        description: "Você ainda não possui ausências registradas neste servidor.",
        title: "📭 Nenhuma ausência encontrada"
      }));
      return;
    }

    await interaction.editReply(facNoticePayload({
      accentColor: 0x5865f2,
      description: absences.map(formatAbsenceLine).join("\n"),
      title: "📋 Minhas ausências"
    }));
  } catch (error) {
    await interaction.editReply(facNoticePayload({
      accentColor: 0xef4444,
      description: readRequestErrorMessage(error) ?? "Não foi possível buscar suas ausências.",
      title: "❌ Consulta indisponível"
    }));
  }
}

async function approveAbsence(interaction: ButtonInteraction, context: BotContext, absenceId: string) {
  await interaction.deferReply({
    ephemeral: true
  });

  const guild = interaction.guild;

  if (!guild) {
    await interaction.editReply(facNoticePayload({
      accentColor: 0xef4444,
      description: "Use este recurso dentro de um servidor.",
      title: "❌ Servidor não encontrado"
    }));
    return;
  }

  try {
    const settings = await context.api.getFivemFacSettings(guild.id);

    if (!hasApproverRole(interaction, settings)) {
      await interaction.editReply(facNoticePayload({
        accentColor: 0xef4444,
        description: "Você precisa de um cargo aprovador configurado no FAC para aprovar ausências.",
        title: "🚫 Acesso negado"
      }));
      return;
    }

    let absence = await context.api.approveFivemFacAbsence(absenceId, {
      moderatorId: interaction.user.id,
      moderatorRoleIds: interactionRoleIds(interaction)
    });

    const startedResult = await startApprovedAbsenceIfDue(guild, context, settings, absence, interaction.user.id);
    absence = startedResult.absence;
    await updateAbsenceMessage(interaction, settings, absence);
    if (!startedResult.changed) {
      await sendFacLog(guild, settings, "Solicitação aprovada", absence, interaction.user.id);
      await notifyAbsenceUser(guild, absence, settings.messages.approved);
    } else {
      await notifyAbsenceUser(guild, absence, settings.messages.started);
    }
    await interaction.editReply(facNoticePayload({
      accentColor: 0x22c55e,
      description: absence.status === "active"
        ? "A ausência foi aprovada e iniciada. O cargo configurado já foi aplicado quando possível."
        : "A ausência foi aprovada. O cargo será aplicado automaticamente na data de início.",
      title: "✅ Ausência aprovada"
    }));
  } catch (error) {
    await interaction.editReply(facNoticePayload({
      accentColor: 0xef4444,
      description: readRequestErrorMessage(error) ?? "Não foi possível aprovar essa ausência.",
      title: "❌ Aprovação não concluída"
    }));
  }
}

async function rejectAbsence(interaction: ModalSubmitInteraction, context: BotContext, absenceId: string) {
  await interaction.deferReply({
    ephemeral: true
  });

  const guild = interaction.guild;

  if (!guild) {
    await interaction.editReply(facNoticePayload({
      accentColor: 0xef4444,
      description: "Use este recurso dentro de um servidor.",
      title: "❌ Servidor não encontrado"
    }));
    return;
  }

  try {
    const settings = await context.api.getFivemFacSettings(guild.id);

    if (!hasApproverRole(interaction, settings)) {
      await interaction.editReply(facNoticePayload({
        accentColor: 0xef4444,
        description: "Você precisa de um cargo aprovador configurado no FAC para reprovar ausências.",
        title: "🚫 Acesso negado"
      }));
      return;
    }

    const reason = interaction.fields.getTextInputValue("reason");
    const absence = await context.api.rejectFivemFacAbsence(absenceId, {
      moderatorId: interaction.user.id,
      moderatorRoleIds: interactionRoleIds(interaction),
      reason
    });

    await updateAbsenceMessage(interaction, settings, absence);
    await sendFacLog(guild, settings, "Solicitação reprovada", absence, interaction.user.id, reason);
    await notifyAbsenceUser(guild, absence, `${settings.messages.rejected}\nMotivo: ${reason}`);
    await interaction.editReply(facNoticePayload({
      accentColor: 0xef4444,
      description: `A solicitação foi reprovada e o usuário foi notificado.\n\n**Motivo:** ${truncate(reason, 500)}`,
      title: "❌ Ausência reprovada"
    }));
  } catch (error) {
    await interaction.editReply(facNoticePayload({
      accentColor: 0xef4444,
      description: readRequestErrorMessage(error) ?? "Não foi possível reprovar essa ausência.",
      title: "❌ Reprovação não concluída"
    }));
  }
}

async function closeAbsence(interaction: ButtonInteraction, context: BotContext, absenceId: string) {
  await interaction.deferReply({
    ephemeral: true
  });

  const guild = interaction.guild;

  if (!guild) {
    await interaction.editReply(facNoticePayload({
      accentColor: 0xef4444,
      description: "Use este recurso dentro de um servidor.",
      title: "❌ Servidor não encontrado"
    }));
    return;
  }

  try {
    const settings = await context.api.getFivemFacSettings(guild.id);

    if (!hasApproverRole(interaction, settings)) {
      await interaction.editReply(facNoticePayload({
        accentColor: 0xef4444,
        description: "Você precisa de um cargo aprovador configurado no FAC para encerrar ausências.",
        title: "🚫 Acesso negado"
      }));
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
    await sendFacLog(guild, settings, roleRemoved ? "Cargo removido" : "Ausência encerrada", absence, interaction.user.id);
    await notifyAbsenceUser(guild, absence, "Sua ausência foi encerrada pela equipe.");
    await interaction.editReply(facNoticePayload({
      accentColor: 0x22c55e,
      description: roleRemoved
        ? "A ausência foi encerrada e o cargo configurado foi removido quando possível."
        : "A ausência foi encerrada. Nenhum cargo precisou ser removido.",
      title: "✅ Ausência encerrada"
    }));
    await settleAbsenceChannel(guild, settings, absence, `Ausência encerrada por ${interaction.user.tag}`);
  } catch (error) {
    await interaction.editReply(facNoticePayload({
      accentColor: 0xef4444,
      description: readRequestErrorMessage(error) ?? "Não foi possível encerrar essa ausência.",
      title: "❌ Encerramento não concluído"
    }));
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
    throw new Error("FAC não está ativo ou sem canal de painel.");
  }

  const channel = await guild.channels.fetch(settings.panelChannelId);

  if (!channel || !channel.isTextBased()) {
    throw new Error("Canal de painel FAC inválido.");
  }

  assertPanelChannelPermissions(channel, client, "FAC", { requirePinMessages: false });

  const payload = buildPanelPayload(settings, guild);
  let messageId: string | null = settings.panelMessageId ?? null;

  if (settings.panelMessageId) {
    const oldMessage = await channel.messages.fetch(settings.panelMessageId).catch(() => null);

    if (!oldMessage) {
      return settings;
    }

    await oldMessage.edit(payload);
    if (oldMessage.pinned) {
      await oldMessage.unpin("Painel FAC não é mais fixado automaticamente.").catch(() => null);
    }
    console.log(`[fivem-fac] painel atualizado em ${guild.name}.`);
    return settings;
  }

  const message = await channel.send(payload);
  messageId = message.id;

  if (messageId !== settings.panelMessageId) {
    const saved = await context.api.updateFivemFacPanelState({
      guildId,
      messageId
    });
    console.log(`[fivem-fac] painel publicado em ${guild.name}.`);
    return saved;
  }

  console.log(`[fivem-fac] painel atualizado em ${guild.name}.`);
  return settings;
}

async function createAbsenceChannel(guild: Guild, settings: FivemFacSettings, absence: FivemFacAbsence) {
  const panelChannel = settings.panelChannelId
    ? await guild.channels.fetch(settings.panelChannelId).catch(() => null)
    : null;
  const parent = settings.categoryId ?? (panelChannel && "parentId" in panelChannel ? panelChannel.parentId : null);
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
    reason: "Canal privado para solicitação de ausência FiveM",
    type: ChannelType.GuildText
  });
  const message = await channel.send(buildAbsenceReviewPayload(absence, channel.guild));

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
        console.warn(`[fivem-fac] falha ao processar ausência ${absence.id}:`, errorMessage(error));
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
    const result = await context.api.markFivemFacAbsenceStarted(current.id, roleAdded);
    current = result.absence;
    if (result.changed) {
      await sendFacLog(guild, settings, roleAdded ? "Ausência iniciada com cargo" : "Ausência iniciada sem cargo", current, null);
      await notifyAbsenceUser(guild, current, settings.messages.started);
      await updateStoredAbsenceMessage(guild, current);
    }
  }

  if ((current.status === "active" || current.status === "approved") && current.endDate <= today) {
    const roleRemoved = await removeAbsenceRole(guild, settings, current);
    const result = await context.api.markFivemFacAbsenceFinished(current.id, roleRemoved);
    current = result.absence;
    if (result.changed) {
      await sendFacLog(guild, settings, roleRemoved ? "Ausência finalizada com cargo removido" : "Ausência finalizada sem cargo", current, null);
      await notifyAbsenceUser(guild, current, settings.messages.finished);
      await updateStoredAbsenceMessage(guild, current);
      await settleAbsenceChannel(guild, settings, current, "Ausência finalizada automaticamente");
    }
  }
}

async function startApprovedAbsenceIfDue(guild: Guild, context: BotContext, settings: FivemFacSettings, absence: FivemFacAbsence, actorId: string | null): Promise<FivemFacLifecycleResult> {
  if (absence.status !== "approved" || absence.startDate > currentDateKey()) {
    return {
      absence,
      changed: false
    };
  }

  const roleAdded = await addAbsenceRole(guild, settings, absence).catch(async (error) => {
    await sendFacLog(guild, settings, "Falha ao adicionar cargo", absence, actorId, errorMessage(error));
    return false;
  });
  const result = await context.api.markFivemFacAbsenceStarted(absence.id, roleAdded);
  if (result.changed) {
    await sendFacLog(guild, settings, roleAdded ? "Ausência iniciada com cargo" : "Ausência iniciada sem cargo", result.absence, actorId);
    await updateStoredAbsenceMessage(guild, result.absence);
  }
  return result;
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

  await member.roles.add(settings.absenceRoleId, "Inicio de ausência FAC");
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

  await member.roles.remove(settings.absenceRoleId, "Fim de ausência FAC");
  return true;
}

async function updateAbsenceMessage(interaction: ButtonInteraction | ModalSubmitInteraction, settings: FivemFacSettings, absence: FivemFacAbsence) {
  if (interaction.isMessageComponent() && interaction.message.editable) {
    await interaction.message.edit(buildAbsenceReviewPayload(absence, interaction.guild)).catch(() => null);
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
  await message?.edit(buildAbsenceReviewPayload(absence, guild)).catch(() => null);
}

async function settleAbsenceChannel(guild: Guild, settings: FivemFacSettings, absence: FivemFacAbsence, reason: string) {
  if (!absence.privateChannelId || settings.channelCloseMode === "keep") {
    return;
  }

  const channel = await guild.channels.fetch(absence.privateChannelId).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    return;
  }

  if (settings.channelCloseMode === "delete") {
    if ("delete" in channel) {
      await channel.delete(reason).catch(() => null);
    }
    return;
  }

  if (!("permissionOverwrites" in channel)) {
    return;
  }

  await channel.permissionOverwrites.edit(absence.userId, {
    SendMessages: false,
    ViewChannel: true
  }, { reason }).catch(() => null);

  if ("setName" in channel && typeof channel.name === "string" && !channel.name.startsWith("finalizada-")) {
    await channel.setName(`finalizada-${channel.name}`.slice(0, 100), reason).catch(() => null);
  }
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

  await channel.send(facLogPayload({
    absence,
    actorId,
    reason,
    title
  })).catch(() => null);
}

async function notifyAbsenceUser(guild: Guild, absence: FivemFacAbsence, message: string) {
  const user = await guild.client.users.fetch(absence.userId).catch(() => null);

  await user?.send(facNoticePayload({
    accentColor: statusColor(absence.status),
    description: `${message}\n\n**Período:** ${formatDateOnly(absence.startDate)} até ${formatDateOnly(absence.endDate)}\n**Status:** ${statusLabel(absence.status)}`,
    title: "📅 Atualização da sua ausência"
  })).catch(() => null);

  if (!absence.privateChannelId) {
    return;
  }

  const channel = await guild.channels.fetch(absence.privateChannelId).catch(() => null);

  if (channel?.isTextBased()) {
    await channel.send({
      ...facNoticePayload({
        accentColor: statusColor(absence.status),
        description: `<@${absence.userId}>\n${message}`,
        title: "📣 Notificação ao solicitante"
      }),
      allowedMentions: { users: [absence.userId] }
    }).catch(() => null);
  }
}

function buildPanelPayload(settings: FivemFacSettings, guild: Guild | null = null) {
  const panelComponents: Array<Record<string, unknown>> = [
    {
      type: 10,
      content: [
        `# ${settings.messages.panelTitle || `${systemEmojiText("calendario", guild)} Sistema de Ausências FAC`}`,
        settings.messages.panelDescription || "Solicite sua ausência de forma organizada. A equipe recebe o pedido em um canal privado, avalia o motivo e o sistema aplica ou remove o cargo automaticamente quando chegar a data correta.",
        "",
        "### Como funciona",
        `${systemEmojiText("prancheta_caneta", guild)} **Solicitação:** informe nome RP, data de início, data de retorno e motivo.`,
        `${systemEmojiText("prancheta_acertos", guild)} **Análise:** a staff aprova ou reprova pelo painel interno.`,
        `${systemEmojiText("homem", guild)} **Cargo:** aplicado somente após aprovação.`,
        `${systemEmojiText("relogio", guild)} **Retorno:** removido automaticamente ao fim da ausência.`
      ].join("\n")
    }
  ];
  if (settings.panelVisual.enabledSections.image && settings.panelVisual.imageUrl && settings.panelVisual.imagePosition !== "none") {
    panelComponents.push({ type: 12, items: [{ media: { url: settings.panelVisual.imageUrl } }] });
  }
  return {
    allowedMentions: { parse: [] as never[] },
    content: "",
    components: [
      { type: 17, accent_color: panelColor(settings.panelVisual.panelColor), components: panelComponents },
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(REQUEST_BUTTON_ID)
          .setEmoji(systemComponentEmoji("calendario", guild))
          .setLabel("Solicitar ausência")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(MINE_BUTTON_ID)
          .setEmoji(systemComponentEmoji("prancheta", guild))
          .setLabel("Minhas ausências")
          .setStyle(ButtonStyle.Secondary)
      )
    ],
    embeds: [],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function panelColor(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^#/, "");
  return normalized && /^[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized, 16) : 0x8b5cf6;
}

function facNoticePayload(input: { accentColor?: number; description: string; title: string }) {
  return {
    allowedMentions: { parse: [] as never[] },
    content: "",
    embeds: [],
    components: [
      {
        type: 17,
        accent_color: input.accentColor ?? 0x2b2d31,
        components: [
          {
            type: 10,
            content: replaceSystemEmojis(`# ${input.title}\n${input.description}`)
          }
        ]
      }
    ],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function facLogPayload(input: { absence: FivemFacAbsence | null; actorId: string | null; reason?: string | null; title: string }) {
  const lines = input.absence
    ? [
        `**Usuário:** <@${input.absence.userId}>`,
        `**ID Discord:** \`${input.absence.userId}\``,
        `**Status:** ${statusLabel(input.absence.status)}`,
        `**Período:** ${formatDateOnly(input.absence.startDate)} até ${formatDateOnly(input.absence.endDate)}`,
        `**Responsável:** ${formatActor(input.actorId ?? input.absence.approvedBy ?? input.absence.moderatorId)}`,
        "",
        `**Motivo:** ${truncate(input.absence.reason, 900)}`,
        input.reason || input.absence.rejectionReason
          ? `\n**Detalhe:** ${truncate(input.reason ?? input.absence.rejectionReason ?? "", 600)}`
          : "",
        `\n-# ID da ausência: ${input.absence.id}`
      ]
    : [
        input.actorId ? `**Responsável:** ${formatActor(input.actorId)}` : "**Responsável:** Automático",
        `**Data:** <t:${Math.floor(Date.now() / 1000)}:F>`
      ];

  return {
    allowedMentions: { parse: [] as never[] },
    content: "",
    embeds: [],
    components: [
      {
        type: 17,
        accent_color: input.absence ? statusColor(input.absence.status) : 0x2b2d31,
        components: [
          {
            type: 10,
            content: [`# ${systemEmojiText("folha")} FAC - ${input.title}`, ...lines].filter(Boolean).join("\n")
          }
        ]
      }
    ],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function buildAbsenceReviewPayload(absence: FivemFacAbsence, guild: Guild | null = null) {
  const photoUrl = toPublicImageUrl(absence.photoUrl);
  const components: Array<Record<string, unknown>> = [
    {
      type: 10,
      content: [
        `# ${statusEmoji(absence.status, guild)} Solicitação de Ausência`,
        `**Usuário:** <@${absence.userId}>`,
        `**ID Discord:** \`${absence.userId}\``,
        absence.username ? `**Nome RP:** ${truncate(absence.username, 100)}` : "",
        `**Status:** ${statusLabel(absence.status)}`,
        `**Período:** ${formatDateOnly(absence.startDate)} até ${formatDateOnly(absence.endDate)}`,
        `**Duração:** ${absenceDurationDays(absence.startDate, absence.endDate)} dia(s)`,
        `**Solicitado em:** <t:${Math.floor(Date.parse(absence.createdAt) / 1000)}:F>`,
        absence.approvedAt ? `**Aprovado em:** <t:${Math.floor(Date.parse(absence.approvedAt) / 1000)}:F>` : "",
        absence.approvedBy ? `**Aprovado por:** ${formatActor(absence.approvedBy)}` : "",
        "",
        `**Motivo:** ${truncate(absence.reason, 900)}`,
        absence.notes ? `\n**Observações:** ${truncate(absence.notes, 500)}` : "",
        absence.rejectionReason ? `\n**Motivo da reprovação:** ${truncate(absence.rejectionReason, 500)}` : "",
        `\n-# ID da ausência: ${absence.id}`
      ].filter(Boolean).join("\n")
    }
  ];

  if (photoUrl) {
    components.push({ type: 12, items: [{ media: { url: photoUrl } }] });
  }

  const closed = ["rejected", "finished", "closed"].includes(absence.status);
  const pending = absence.status === "pending";

  return {
    allowedMentions: { users: [absence.userId] },
    content: "",
    embeds: [],
    components: [
      { type: 17, accent_color: statusColor(absence.status), components },
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${APPROVE_PREFIX}:${absence.id}`)
          .setDisabled(!pending)
          .setEmoji(systemComponentEmoji("visto", guild))
          .setLabel("Aprovar")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`${REJECT_PREFIX}:${absence.id}`)
          .setDisabled(!pending)
          .setEmoji(systemComponentEmoji("exclamacao", guild))
          .setLabel("Reprovar")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`${CLOSE_PREFIX}:${absence.id}`)
          .setDisabled(closed)
          .setEmoji(systemComponentEmoji("porta", guild))
          .setLabel("Encerrar")
          .setStyle(ButtonStyle.Secondary)
      )
    ],
    flags: MessageFlags.IsComponentsV2 as const
  };
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
  request: Pick<PendingAbsenceRequest, "endDate" | "notes" | "reason" | "startDate">
) {
  return {
    allowedMentions: { parse: [] as never[] },
    content: "",
    embeds: [],
    components: [
      {
        type: 17,
        accent_color: 0x2b2d31,
        components: [
          {
            type: 10,
            content: [
              `# ${systemEmojiText("prancheta")} Revisar solicitação`,
              "Confira os dados antes de enviar para análise da equipe.",
              "",
              `${systemEmojiText("calendario")} **Início:** ${formatShortDateOnly(request.startDate)}`,
              `${systemEmojiText("relogio")} **Retorno:** ${formatShortDateOnly(request.endDate)}`,
              `${systemEmojiText("relogio")} **Duração:** ${absenceDurationDays(request.startDate, request.endDate)} dia(s)`,
              `${systemEmojiText("prancheta_caneta")} **Motivo:** ${truncate(request.reason, 500)}`,
              request.notes ? `${systemEmojiText("folha")} **Observações:** ${truncate(request.notes, 500)}` : ""
            ].join("\n")
          }
        ]
      },
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${CONFIRM_PREFIX}:${token}`)
          .setEmoji(systemComponentEmoji("acessar"))
          .setLabel("Enviar solicitação")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`${CANCEL_PREFIX}:${token}`)
          .setEmoji(systemComponentEmoji("porta"))
          .setLabel("Cancelar")
          .setStyle(ButtonStyle.Secondary)
      )
    ],
    flags: MessageFlags.IsComponentsV2 as const
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

function normalizeDateInput(value: string, pivotDate: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);

  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const currentYear = Number(pivotDate.slice(0, 4));
  const year = match[3] ? Number(match[3]) : currentYear;
  let dateKey = dateKeyFromParts(year, month, day);

  if (!dateKey) {
    return null;
  }

  if (!match[3] && dateKey < pivotDate) {
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
  return `${statusEmoji(absence.status)} **${statusLabel(absence.status)}** • ${formatDateOnly(absence.startDate)} até ${formatDateOnly(absence.endDate)} • ${truncate(absence.reason, 90)}`;
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

function statusEmoji(status: FivemFacAbsence["status"], guild: Guild | null = null) {
  const emojis: Record<FivemFacAbsence["status"], string> = {
    active: systemStatusEmoji("active", guild),
    approved: systemStatusEmoji("success", guild),
    closed: systemComponentEmoji("porta", guild),
    finished: systemStatusEmoji("success", guild),
    pending: systemStatusEmoji("pending", guild),
    rejected: systemStatusEmoji("danger", guild)
  };

  return emojis[status];
}

function formatActor(actorId: string | null | undefined) {
  if (!actorId || actorId === "automatic") {
    return "Automático";
  }

  return `<@${actorId}>`;
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

  const payload = {
    ...facNoticePayload({
      accentColor: 0xef4444,
      description: content,
      title: "⚠️ FAC indisponível"
    }),
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  };

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload);
    return;
  }

  await interaction.reply(payload);
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

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type GuildMember,
  type Interaction,
  type InteractionReplyOptions,
  type Message,
  type MessageCreateOptions,
  type ModalSubmitInteraction,
  type RoleSelectMenuInteraction,
  type TextBasedChannel,
  type UserSelectMenuInteraction
} from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import type { BotCommand, BotContext } from "../types";
import type { RhAdminAbsence, RhAdminAdornment, RhAdminSettings } from "./apiClient";
import { renderComponentsV2Panel } from "./panelVisualRenderer";

const MODULE_ID = "rh-admin";
const MODULE_DENIED = "O módulo RH Administrativo não está liberado para este servidor. Entre em contato com a administração do bot.";
const IDS = {
  absence: "rh_absence",
  adornment: "rh_adornment",
  back: "rh_config_back",
  channels: "rh_config_channels",
  close: "rh_config_close",
  general: "rh_config_general",
  publish: "rh_config_publish",
  roles: "rh_config_roles",
  view: "rh_config_view",
  selectPanel: "rh_channel_panel",
  selectAbsenceReview: "rh_channel_absence_review",
  selectAbsenceLog: "rh_channel_absence_log",
  selectAdornmentReview: "rh_channel_adornment_review",
  selectAdornmentLog: "rh_channel_adornment_log",
  selectGeneralLog: "rh_channel_general_log",
  selectAbsenceRole: "rh_role_absence",
  selectConfigRoles: "rh_role_config",
  selectApproverRoles: "rh_role_approver",
  selectConfigUsers: "rh_user_config",
  selectApproverUsers: "rh_user_approver"
} as const;
type SendableTextChannel = TextBasedChannel & { send(options: MessageCreateOptions): Promise<Message> };

let serviceStarted = false;
let dueCheckRunning = false;

export const rhAdminCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("rh")
    .setDescription("Gerencia o RH Administrativo.")
    .addSubcommand((subcommand) => subcommand.setName("config").setDescription("Abre a configuração do RH Administrativo.")),
  moduleId: MODULE_ID,
  async execute(interaction, context) {
    if (interaction.options.getSubcommand() !== "config") return;
    await openConfig(interaction, context);
  }
};

export function startRhAdminService(client: Client, context: BotContext) {
  if (serviceStarted) return;
  serviceStarted = true;
  context.socket.onRhAdminPanelPublish((payload) => {
    void publishDashboardMainPanel(client, context, payload.guildId).catch((error) => {
      console.error(`[rh-admin] failed to publish panel in ${payload.guildId}:`, error instanceof Error ? error.message : error);
    });
  });
  void processDueAbsences(client, context);
  const interval = setInterval(() => void processDueAbsences(client, context), 30 * 60 * 1000);
  interval.unref();
}

export async function handleRhAdminInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.guild) return false;
  const customId = "customId" in interaction ? interaction.customId : "";
  if (!customId.startsWith("rh_")) return false;

  if (!isBotModuleEnabled(MODULE_ID)) {
    if (interaction.isRepliable()) await interaction.reply({ content: MODULE_DENIED, flags: MessageFlags.Ephemeral }).catch(() => null);
    return true;
  }

  if (interaction.isButton()) await handleButton(interaction, context);
  else if (interaction.isModalSubmit()) await handleModal(interaction, context);
  else if (interaction.isChannelSelectMenu()) await handleChannelSelect(interaction, context);
  else if (interaction.isRoleSelectMenu()) await handleRoleSelect(interaction, context);
  else if (interaction.isUserSelectMenu()) await handleUserSelect(interaction, context);
  return true;
}

async function openConfig(interaction: ChatInputCommandInteraction | ButtonInteraction, context: BotContext, notice?: string) {
  if (!interaction.guild) return;
  const settings = await context.api.getRhAdminSettings(interaction.guild.id).catch(async (error) => {
    await replyOrUpdate(interaction, { content: deniedMessage(error), flags: MessageFlags.Ephemeral });
    return null;
  });
  if (!settings) return;
  if (!(await canConfigure(interaction, settings))) {
    await replyOrUpdate(interaction, { content: "Você não tem permissão para configurar o RH Administrativo.", flags: MessageFlags.Ephemeral });
    return;
  }
  const payload = configPanel(settings, notice);
  if (interaction.isButton()) await interaction.update(payload).catch(() => interaction.reply(ephemeral(payload)));
  else await interaction.reply(ephemeral(payload));
}

async function handleButton(interaction: ButtonInteraction, context: BotContext) {
  if (interaction.customId === IDS.close) {
    await interaction.update({ components: [], content: "Painel fechado." });
    return;
  }
  if (interaction.customId === IDS.back) return openConfig(interaction, context);
  if (interaction.customId === IDS.general) {
    const settings = await context.api.getRhAdminSettings(interaction.guildId!);
    await interaction.showModal(new ModalBuilder()
      .setCustomId("rh_modal_general")
      .setTitle("Configurações Gerais")
      .addComponents(
        inputRow("systemName", "Nome visual do sistema", TextInputStyle.Short, true, 120, settings.systemName),
        inputRow("color", "Cor padrão em HEX", TextInputStyle.Short, true, 20, settings.color),
        inputRow("panelBannerUrl", "Banner do painel principal", TextInputStyle.Short, false, 2048, settings.panelBannerUrl ?? ""),
        inputRow("panelDescription", "Texto do painel principal", TextInputStyle.Paragraph, true, 1800, settings.panelDescription)
      ));
    return;
  }
  if (interaction.customId === IDS.channels) {
    await interaction.update(channelsPanel(await context.api.getRhAdminSettings(interaction.guildId!)));
    return;
  }
  if (interaction.customId === IDS.roles) {
    await interaction.update(rolesPanel(await context.api.getRhAdminSettings(interaction.guildId!)));
    return;
  }
  if (interaction.customId === IDS.view) {
    await interaction.update(summaryPanel(await context.api.getRhAdminSettings(interaction.guildId!)));
    return;
  }
  if (interaction.customId === IDS.publish) {
    await publishMainPanel(interaction, context);
    return;
  }
  if (interaction.customId === IDS.absence) {
    await interaction.showModal(new ModalBuilder()
      .setCustomId("rh_modal_absence")
      .setTitle("Solicitar Ausência")
      .addComponents(
        inputRow("startDate", "Data de início da ausência", TextInputStyle.Short, true, 20, undefined, "Exemplo: 12/06 ou 12/06/2026"),
        inputRow("returnDate", "Data de retorno", TextInputStyle.Short, true, 20, undefined, "Exemplo: 20/06 ou 20/06/2026"),
        inputRow("reason", "Motivo da ausência", TextInputStyle.Paragraph, true, 900, undefined, "Explique brevemente o motivo da sua ausência")
      ));
    return;
  }
  if (interaction.customId === IDS.adornment) {
    await interaction.showModal(new ModalBuilder()
      .setCustomId("rh_modal_adornment")
      .setTitle("Solicitar Adorno")
      .addComponents(
        inputRow("number", "Numeração do adorno", TextInputStyle.Short, true, 80, undefined, "Informe a numeração in-game do adorno"),
        inputRow("imageUrl", "Link da imagem", TextInputStyle.Short, true, 2048, undefined, "Cole aqui o link da imagem do adorno"),
        inputRow("observation", "Observação", TextInputStyle.Paragraph, false, 900, undefined, "Campo opcional para observações")
      ));
    return;
  }
  if (interaction.customId.startsWith("rh_absence_approve:")) return approveAbsence(interaction, context, idFromCustomId(interaction.customId));
  if (interaction.customId.startsWith("rh_absence_reject:")) {
    await interaction.showModal(new ModalBuilder()
      .setCustomId(`rh_modal_reject:${idFromCustomId(interaction.customId)}`)
      .setTitle("Recusar Ausência")
      .addComponents(inputRow("reason", "Motivo da recusa", TextInputStyle.Paragraph, true, 900)));
  }
}

async function handleModal(interaction: ModalSubmitInteraction, context: BotContext) {
  if (interaction.customId === "rh_modal_general") {
    const settings = await context.api.saveRhAdminSettings(interaction.guildId!, {
      color: interaction.fields.getTextInputValue("color") || "#1d4ed8",
      panelBannerUrl: interaction.fields.getTextInputValue("panelBannerUrl") || null,
      panelDescription: interaction.fields.getTextInputValue("panelDescription"),
      systemName: interaction.fields.getTextInputValue("systemName")
    }, interaction.user.id);
    await interaction.reply(ephemeral(configPanel(settings, "Configuração salva com sucesso.")));
    return;
  }
  if (interaction.customId === "rh_modal_absence") return submitAbsence(interaction, context);
  if (interaction.customId === "rh_modal_adornment") return submitAdornment(interaction, context);
  if (interaction.customId.startsWith("rh_modal_reject:")) return rejectAbsence(interaction, context, idFromCustomId(interaction.customId));
}

async function handleChannelSelect(interaction: ChannelSelectMenuInteraction, context: BotContext) {
  const value = interaction.values[0] ?? null;
  const patch: Partial<RhAdminSettings> = {};
  if (interaction.customId === IDS.selectPanel) patch.panelChannelId = value;
  if (interaction.customId === IDS.selectAbsenceReview) patch.absenceReviewChannelId = value;
  if (interaction.customId === IDS.selectAbsenceLog) patch.absenceLogChannelId = value;
  if (interaction.customId === IDS.selectAdornmentReview) patch.adornmentReviewChannelId = value;
  if (interaction.customId === IDS.selectAdornmentLog) patch.adornmentLogChannelId = value;
  if (interaction.customId === IDS.selectGeneralLog) patch.generalLogChannelId = value;
  const settings = await context.api.saveRhAdminSettings(interaction.guildId!, patch, interaction.user.id);
  await interaction.update(channelsPanel(settings, "Configuração salva com sucesso."));
}

async function handleRoleSelect(interaction: RoleSelectMenuInteraction, context: BotContext) {
  const patch: Partial<RhAdminSettings> = {};
  if (interaction.customId === IDS.selectAbsenceRole) patch.absenceRoleId = interaction.values[0] ?? null;
  if (interaction.customId === IDS.selectConfigRoles) patch.configRoleIds = interaction.values;
  if (interaction.customId === IDS.selectApproverRoles) patch.approverRoleIds = interaction.values;
  const settings = await context.api.saveRhAdminSettings(interaction.guildId!, patch, interaction.user.id);
  await interaction.update(rolesPanel(settings, "Configuração salva com sucesso."));
}

async function handleUserSelect(interaction: UserSelectMenuInteraction, context: BotContext) {
  const patch: Partial<RhAdminSettings> = {};
  if (interaction.customId === IDS.selectConfigUsers) patch.configUserIds = interaction.values;
  if (interaction.customId === IDS.selectApproverUsers) patch.approverUserIds = interaction.values;
  const settings = await context.api.saveRhAdminSettings(interaction.guildId!, patch, interaction.user.id);
  await interaction.update(rolesPanel(settings, "Configuração salva com sucesso."));
}

async function publishMainPanel(interaction: ButtonInteraction, context: BotContext) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const settings = await context.api.getRhAdminSettings(interaction.guildId!);
  if (!settings.panelChannelId) return interaction.editReply("Canal do painel principal não configurado.");
  const channel = await fetchTextChannel(interaction, settings.panelChannelId);
  if (!channel) return interaction.editReply("Canal do painel principal inválido ou sem permissão.");
  const message = await channel.send(mainPanel(settings));
  await context.api.saveRhAdminSettings(interaction.guildId!, { mainPanelMessageId: message.id }, interaction.user.id);
  await interaction.editReply("Painel RH Administrativo publicado com sucesso.");
}

async function publishDashboardMainPanel(client: Client, context: BotContext, guildId: string) {
  const settings = await context.api.getRhAdminSettings(guildId);
  if (!settings.enabled) throw new Error("RH Administrativo is disabled.");
  if (!settings.panelChannelId) throw new Error("RH panel channel is not configured.");
  const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
  const channel = await guild?.channels.fetch(settings.panelChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) throw new Error("RH panel channel is invalid or missing send permission.");
  const payload = mainPanel(settings);
  const message = settings.mainPanelMessageId && "messages" in channel
    ? await channel.messages.fetch(settings.mainPanelMessageId).catch(() => null)
    : null;
  const nextMessage = message
    ? await message.edit(payload)
    : await (channel as SendableTextChannel).send(payload);
  await context.api.saveRhAdminSettings(guildId, { mainPanelMessageId: nextMessage.id }, null);
}

async function submitAbsence(interaction: ModalSubmitInteraction, context: BotContext) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const settings = await context.api.getRhAdminSettings(interaction.guildId!).catch(() => null);
  if (!settings?.enabled) return interaction.editReply(MODULE_DENIED);
  if (!settings.absenceReviewChannelId) return interaction.editReply("Canal de análise de ausências não configurado.");
  const start = parseRhDate(interaction.fields.getTextInputValue("startDate"));
  const end = parseRhDate(interaction.fields.getTextInputValue("returnDate"));
  if (!start || !end) return interaction.editReply("A data informada é inválida. Use o formato `DD/MM` ou `DD/MM/AAAA`.");
  if (end.date.getTime() < start.date.getTime()) return interaction.editReply("A data de retorno não pode ser anterior à data de início.");
  const reason = interaction.fields.getTextInputValue("reason").trim();
  if (!reason) return interaction.editReply("Informe o motivo da ausência.");
  const member = interaction.member as GuildMember | null;
  const absence = await context.api.createRhAbsence(interaction.guildId!, {
    reason,
    returnAt: end.date.toISOString(),
    returnDate: end.label,
    serverName: serverName(member, interaction.user.username),
    startAt: start.date.toISOString(),
    startDate: start.label,
    userId: interaction.user.id
  });
  const channel = await fetchTextChannel(interaction, settings.absenceReviewChannelId);
  if (!channel) return interaction.editReply("Canal de análise de ausências inválido ou sem permissão.");
  const message = await channel.send(absenceReviewPanel(absence, settings));
  await context.api.updateRhAbsenceMessage(interaction.guildId!, absence.id, { reviewChannelId: channel.id, reviewMessageId: message.id });
  await sendRhLog(interaction.guild!, context, settings, "Solicitação de ausência enviada.", interaction.user.id, interaction.user.id, "rh.absence_requested");
  await interaction.editReply("Sua solicitação de ausência foi enviada para análise do RH.");
}

async function submitAdornment(interaction: ModalSubmitInteraction, context: BotContext) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const settings = await context.api.getRhAdminSettings(interaction.guildId!).catch(() => null);
  if (!settings?.enabled) return interaction.editReply(MODULE_DENIED);
  if (!settings.adornmentReviewChannelId) return interaction.editReply("Canal de envio dos adornos não configurado.");
  const imageUrl = interaction.fields.getTextInputValue("imageUrl").trim();
  if (!isValidImageUrl(imageUrl, settings.allowNonDirectImageLinks)) return interaction.editReply("O link da imagem informado não é válido. Envie um link direto ou uma URL que possa ser carregada como imagem.");
  const member = interaction.member as GuildMember | null;
  const adornment = await context.api.createRhAdornment(interaction.guildId!, {
    imageUrl,
    number: interaction.fields.getTextInputValue("number").trim(),
    observation: interaction.fields.getTextInputValue("observation") || null,
    serverName: serverName(member, interaction.user.username),
    userId: interaction.user.id
  });
  const channel = await fetchTextChannel(interaction, settings.adornmentReviewChannelId);
  if (!channel) return interaction.editReply("Canal de adornos inválido ou sem permissão.");
  const message = await channel.send(adornmentPanel(adornment, settings));
  await context.api.updateRhAdornmentMessage(interaction.guildId!, adornment.id, { channelId: channel.id, messageId: message.id });
  await sendRhLog(interaction.guild!, context, settings, "Solicitação de adorno enviada.", interaction.user.id, interaction.user.id, "rh.adornment_requested");
  await interaction.editReply("Sua solicitação de adorno foi enviada ao RH.");
}

async function approveAbsence(interaction: ButtonInteraction, context: BotContext, absenceId: string) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const settings = await context.api.getRhAdminSettings(interaction.guildId!);
  const member = interaction.member as GuildMember | null;
  const roleIds = member?.roles.cache.map((role) => role.id) ?? [];
  const allowed = await context.api.canApproveRhAbsence(interaction.guildId!, { isAdministrator: Boolean(member?.permissions.has(PermissionFlagsBits.Administrator)), roleIds, userId: interaction.user.id });
  if (!allowed) {
    await sendRhLog(interaction.guild!, context, settings, "Tentativa de aprovação sem permissão.", interaction.user.id, interaction.user.id, "rh.absence_denied", "denied");
    return interaction.editReply("Você não tem permissão para analisar solicitações de ausência.");
  }
  const absence = await context.api.decideRhAbsence(interaction.guildId!, absenceId, { actorId: interaction.user.id, roleIds, status: "approved" });
  await applyAbsenceRole(interaction, context, absence, settings);
  await interaction.message.edit(absenceReviewPanel(absence, settings)).catch(() => null);
  await dmAbsenceApproved(interaction, absence, settings);
  await sendRhLog(interaction.guild!, context, settings, "Ausência aprovada.", absence.userId, interaction.user.id, "rh.absence_approved");
  await interaction.editReply("Ausência aprovada.");
}

async function rejectAbsence(interaction: ModalSubmitInteraction, context: BotContext, absenceId: string) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const settings = await context.api.getRhAdminSettings(interaction.guildId!);
  const member = interaction.member as GuildMember | null;
  const roleIds = member?.roles.cache.map((role) => role.id) ?? [];
  const allowed = await context.api.canApproveRhAbsence(interaction.guildId!, { isAdministrator: Boolean(member?.permissions.has(PermissionFlagsBits.Administrator)), roleIds, userId: interaction.user.id });
  if (!allowed) return interaction.editReply("Você não tem permissão para analisar solicitações de ausência.");
  const absence = await context.api.decideRhAbsence(interaction.guildId!, absenceId, { actorId: interaction.user.id, rejectionReason: interaction.fields.getTextInputValue("reason"), roleIds, status: "rejected" });
  await interaction.message?.edit(absenceReviewPanel(absence, settings)).catch(() => null);
  await dmAbsenceRejected(interaction, absence, settings);
  await sendRhLog(interaction.guild!, context, settings, "Ausência recusada.", absence.userId, interaction.user.id, "rh.absence_rejected");
  await interaction.editReply("Ausência recusada.");
}

async function applyAbsenceRole(interaction: ButtonInteraction, context: BotContext, absence: RhAdminAbsence, settings: RhAdminSettings) {
  if (!settings.absenceRoleId) return;
  const member = await interaction.guild!.members.fetch(absence.userId).catch(() => null);
  if (!member) return;
  await member.roles.add(settings.absenceRoleId, "Ausência aprovada pelo RH Administrativo")
    .then(() => context.api.markRhAbsenceRoleAdded(interaction.guildId!, absence.id, true))
    .catch(() => context.api.createRhAdminLog(interaction.guildId!, { action: "rh.absence_role_add_error", description: "Erro ao adicionar cargo de ausência.", status: "error", userId: absence.userId }));
}

async function processDueAbsences(client: Client, context: BotContext) {
  if (dueCheckRunning || !isBotModuleEnabled(MODULE_ID)) return;
  dueCheckRunning = true;
  try {
    const absences = await context.api.getDueRhAbsences();
    for (const absence of absences) {
      const guild = client.guilds.cache.get(absence.guildId) ?? await client.guilds.fetch(absence.guildId).catch(() => null);
      if (!guild) continue;
      const settings = await context.api.getRhAdminSettings(absence.guildId).catch(() => null);
      if (!settings) continue;
      const member = await guild.members.fetch(absence.userId).catch(() => null);
      let roleRemoved = false;
      if (member && absence.absenceRoleId) {
        roleRemoved = await member.roles.remove(absence.absenceRoleId, "Ausência finalizada automaticamente").then(() => true).catch(() => false);
      }
      const dmDelivered = member ? await member.send(dmFinishedPanel(absence, settings)).then(() => true).catch(() => false) : false;
      await context.api.finishRhAbsence(absence.guildId, absence.id, { dmDelivered, roleRemoved });
      await sendRhLog(guild, context, settings, roleRemoved ? "Cargo de ausência removido automaticamente." : "Ausência finalizada sem remover cargo.", absence.userId, null, "rh.absence_finished", roleRemoved ? "success" : "warning");
    }
  } finally {
    dueCheckRunning = false;
  }
}

function mainPanel(settings: RhAdminSettings) {
  return renderComponentsV2Panel({
    accentColor: parseColor(settings.color),
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(IDS.absence).setLabel(`${settings.buttonEmojis.absence} Solicitar Ausência`).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(IDS.adornment).setLabel(`${settings.buttonEmojis.adornment} Solicitar Adorno`).setStyle(ButtonStyle.Secondary)
    )],
    description: settings.panelDescription,
    fields: [
      "**Solicitação de Ausência**\nUse esta opção caso precise se ausentar temporariamente das atividades da corporação.\nInforme a data de início e retorno nos formatos `DD/MM` ou `DD/MM/AAAA`.",
      `**Solicitação de Adorno**\n${settings.adornmentDescription}\nA imagem deve ser enviada por link direto ou URL válida de imagem.`
    ],
    image: settings.panelBannerUrl ? { imageEnabled: true, imagePosition: "top", imageUrl: settings.panelBannerUrl } : null,
    moduleId: MODULE_ID,
    title: "RH Administrativo"
  });
}

function configPanel(settings: RhAdminSettings, notice?: string) {
  return renderComponentsV2Panel({
    accentColor: parseColor(settings.color),
    actions: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(IDS.general).setLabel("Configurações Gerais").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(IDS.channels).setLabel("Canais").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(IDS.roles).setLabel("Permissões").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(IDS.publish).setLabel(`${settings.buttonEmojis.publish} Publicar Painel`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(IDS.close).setLabel("Fechar").setStyle(ButtonStyle.Danger)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(IDS.view).setLabel("Ver Configurações Atuais").setStyle(ButtonStyle.Secondary))
    ],
    description: "Configure ausências, adornos, permissões, canais de análise e logs do RH Administrativo.",
    fields: [notice ? `**${notice}**` : "", `Sistema: ${settings.systemName}`, `Painel: ${settings.panelChannelId ? `<#${settings.panelChannelId}>` : "não configurado"}`, `Análise de ausências: ${settings.absenceReviewChannelId ? `<#${settings.absenceReviewChannelId}>` : "não configurado"}`].filter(Boolean),
    moduleId: MODULE_ID,
    title: "Configuração | RH Administrativo"
  });
}

function channelsPanel(settings: RhAdminSettings, notice?: string) {
  const channelSelect = (id: string, placeholder: string) => new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1));
  return renderComponentsV2Panel({
    accentColor: parseColor(settings.color),
    actions: [
      channelSelect(IDS.selectPanel, "Canal do painel principal"),
      channelSelect(IDS.selectAbsenceReview, "Canal de análise de ausências"),
      channelSelect(IDS.selectAbsenceLog, "Canal de logs de ausência"),
      channelSelect(IDS.selectAdornmentReview, "Canal de envio dos adornos"),
      channelSelect(IDS.selectAdornmentLog, "Canal de logs de adorno"),
      channelSelect(IDS.selectGeneralLog, "Canal de logs gerais"),
      new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(IDS.back).setLabel("Voltar").setStyle(ButtonStyle.Secondary))
    ],
    description: "Defina onde o RH publica painéis, recebe solicitações e registra auditoria.",
    fields: [notice ? `**${notice}**` : "", `Painel: ${channel(settings.panelChannelId)}`, `Ausências: ${channel(settings.absenceReviewChannelId)} | Logs: ${channel(settings.absenceLogChannelId)}`, `Adornos: ${channel(settings.adornmentReviewChannelId)} | Logs: ${channel(settings.adornmentLogChannelId)}`].filter(Boolean),
    moduleId: MODULE_ID,
    title: "RH Administrativo > Canais"
  });
}

function rolesPanel(settings: RhAdminSettings, notice?: string) {
  return renderComponentsV2Panel({
    accentColor: parseColor(settings.color),
    actions: [
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(new RoleSelectMenuBuilder().setCustomId(IDS.selectAbsenceRole).setPlaceholder("Cargo de ausência").setMinValues(0).setMaxValues(1)),
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(new RoleSelectMenuBuilder().setCustomId(IDS.selectConfigRoles).setPlaceholder("Cargos que configuram RH").setMinValues(0).setMaxValues(10)),
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(new RoleSelectMenuBuilder().setCustomId(IDS.selectApproverRoles).setPlaceholder("Cargos que aprovam ausências").setMinValues(0).setMaxValues(10)),
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder().setCustomId(IDS.selectConfigUsers).setPlaceholder("Usuários que configuram RH").setMinValues(0).setMaxValues(10)),
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder().setCustomId(IDS.selectApproverUsers).setPlaceholder("Usuários que aprovam ausências").setMinValues(0).setMaxValues(10)),
      new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(IDS.back).setLabel("Voltar").setStyle(ButtonStyle.Secondary))
    ],
    description: "Defina quem configura o RH, quem aprova ausências e qual cargo temporário será aplicado.",
    fields: [notice ? `**${notice}**` : "", `Cargo de ausência: ${settings.absenceRoleId ? `<@&${settings.absenceRoleId}>` : "não configurado"}`, `Configuração: ${mentions(settings.configUserIds, "user")} ${mentions(settings.configRoleIds, "role")}`, `Aprovação: ${mentions(settings.approverUserIds, "user")} ${mentions(settings.approverRoleIds, "role")}`].filter(Boolean),
    moduleId: MODULE_ID,
    title: "RH Administrativo > Permissões"
  });
}

function summaryPanel(settings: RhAdminSettings) {
  return renderComponentsV2Panel({
    accentColor: parseColor(settings.color),
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(IDS.back).setLabel("Voltar").setStyle(ButtonStyle.Secondary))],
    description: "Resumo da configuração atual do RH Administrativo.",
    fields: [
      `Status: ${settings.enabled ? "Ativo" : "Desativado"}\nNome: ${settings.systemName}\nCor: ${settings.color}`,
      `Painel principal: ${channel(settings.panelChannelId)}\nBanner: ${settings.panelBannerUrl || "não configurado"}`,
      `Ausências: análise ${channel(settings.absenceReviewChannelId)}, logs ${channel(settings.absenceLogChannelId)}, cargo ${settings.absenceRoleId ? `<@&${settings.absenceRoleId}>` : "não configurado"}`,
      `Adornos: envio ${channel(settings.adornmentReviewChannelId)}, logs ${channel(settings.adornmentLogChannelId)}`
    ],
    moduleId: MODULE_ID,
    title: "Configurações Atuais"
  });
}

function absenceReviewPanel(absence: RhAdminAbsence, settings: RhAdminSettings) {
  const status = absence.status === "pending" ? "Aguardando análise" : absence.status === "approved" ? "Aprovada" : absence.status === "rejected" ? "Recusada" : "Finalizada";
  return renderComponentsV2Panel({
    accentColor: parseColor(settings.color),
    actions: absence.status === "pending" ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`rh_absence_approve:${absence.id}`).setLabel(`${settings.buttonEmojis.approve} Aprovar`).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`rh_absence_reject:${absence.id}`).setLabel(`${settings.buttonEmojis.reject} Recusar`).setStyle(ButtonStyle.Danger)
    )] : [],
    description: "Nova solicitação de ausência encaminhada para análise do RH.",
    fields: [
      `Solicitante: <@${absence.userId}>\nNome no servidor: ${absence.serverName}\nID do Discord: \`${absence.userId}\``,
      `Data de início: \`${absence.startDate}\`\nData de retorno: \`${absence.returnDate}\`\nMotivo: ${absence.reason}`,
      `Status: ${status}\nResponsável pela análise: ${absence.reviewerId ? `<@${absence.reviewerId}>` : "Nenhum"}\nData e horário: ${new Date(absence.createdAt).toLocaleString("pt-BR")}`,
      absence.rejectionReason ? `Motivo da recusa: \`${absence.rejectionReason}\`` : ""
    ].filter(Boolean),
    moduleId: MODULE_ID,
    title: "Nova Solicitação de Ausência"
  });
}

function adornmentPanel(adornment: RhAdminAdornment, settings: RhAdminSettings) {
  return renderComponentsV2Panel({
    accentColor: parseColor(settings.color),
    description: `**Link da imagem:**\n${adornment.imageUrl}`,
    fields: [
      `${settings.mentionAdornmentUser ? `Solicitante: <@${adornment.userId}>` : `Solicitante: ${adornment.serverName}`}\nNome no servidor: ${adornment.serverName}\nID do Discord: \`${adornment.userId}\``,
      `Numeração in-game do adorno: \`${adornment.number}\`\nObservação: ${adornment.observation || "Sem observação"}\nData da solicitação: ${new Date(adornment.createdAt).toLocaleString("pt-BR")}`,
      "North Police Department • RH Administrativo"
    ],
    image: { imageEnabled: true, imagePosition: "top", imageUrl: adornment.imageUrl },
    moduleId: MODULE_ID,
    title: "Nova Solicitação de Adorno"
  });
}

function dmAbsenceApproved(interaction: ButtonInteraction, absence: RhAdminAbsence, settings: RhAdminSettings) {
  if (!settings.sendAbsenceDm) return Promise.resolve(null);
  return interaction.guild!.members.fetch(absence.userId).then((member) => member.send(renderComponentsV2Panel({
    accentColor: parseColor(settings.color),
    description: `Olá, **${absence.serverName}**.\n${settings.approvalDmText}\n\n**Período da ausência:**\nInício: \`${absence.startDate}\`\nRetorno: \`${absence.returnDate}\`\n\nDurante esse período, você recebeu o cargo de ausência configurado pela administração.\n\nAo final do período, o sistema removerá automaticamente o cargo de ausência.`,
    fields: ["North Police Department • RH Administrativo"],
    image: (settings.approvalDmBannerUrl || settings.dmBannerUrl) ? { imageEnabled: true, imagePosition: "top", imageUrl: settings.approvalDmBannerUrl || settings.dmBannerUrl! } : null,
    moduleId: MODULE_ID,
    title: "RH Administrativo | Ausência Aprovada"
  }))).catch(() => null);
}

function dmAbsenceRejected(interaction: ModalSubmitInteraction, absence: RhAdminAbsence, settings: RhAdminSettings) {
  if (!settings.sendAbsenceDm) return Promise.resolve(null);
  return interaction.guild!.members.fetch(absence.userId).then((member) => member.send(renderComponentsV2Panel({
    accentColor: parseColor(settings.color),
    description: `Olá, **${absence.serverName}**.\n${settings.rejectionDmText}\n\n**Motivo informado:**\n\`${absence.rejectionReason || "Sem motivo informado."}\`\n\nCaso necessário, entre em contato com a equipe responsável pelo RH.`,
    fields: ["North Police Department • RH Administrativo"],
    image: (settings.rejectionDmBannerUrl || settings.dmBannerUrl) ? { imageEnabled: true, imagePosition: "top", imageUrl: settings.rejectionDmBannerUrl || settings.dmBannerUrl! } : null,
    moduleId: MODULE_ID,
    title: "RH Administrativo | Ausência Recusada"
  }))).catch(() => null);
}

function dmFinishedPanel(absence: RhAdminAbsence, settings: RhAdminSettings) {
  return renderComponentsV2Panel({
    accentColor: parseColor(settings.color),
    description: `Olá, **${absence.serverName}**.\n${settings.finishedDmText}\n\nO cargo de ausência foi removido automaticamente pelo sistema.\n\n**Data de retorno registrada:** \`${absence.returnDate}\``,
    fields: ["North Police Department • RH Administrativo"],
    image: (settings.finishedDmBannerUrl || settings.dmBannerUrl) ? { imageEnabled: true, imagePosition: "top", imageUrl: settings.finishedDmBannerUrl || settings.dmBannerUrl! } : null,
    moduleId: MODULE_ID,
    title: "RH Administrativo | Ausência Finalizada"
  });
}

async function sendRhLog(guild: { channels: { fetch(id: string): Promise<unknown> }; id: string; name: string }, context: BotContext, settings: RhAdminSettings, description: string, userId: string | null, actorId: string | null, action: string, status: "success" | "warning" | "error" | "denied" | "info" = "success") {
  await context.api.createRhAdminLog(guild.id, { action, actorId, description, status, userId });
  const channelId = settings.generalLogChannelId || settings.absenceLogChannelId || settings.adornmentLogChannelId;
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null) as TextBasedChannel | null;
  if (!channel?.isTextBased() || !("send" in channel)) return;
  await channel.send(renderComponentsV2Panel({
    accentColor: status === "error" || status === "denied" ? 0xdc2626 : 0x1d4ed8,
    description,
    fields: [`Usuário envolvido: ${userId ? `<@${userId}>` : "não informado"}\nResponsável: ${actorId ? `<@${actorId}>` : "Sistema"}\nServidor: ${guild.name}\nData: ${new Date().toLocaleString("pt-BR")}\nStatus: ${status}`],
    moduleId: MODULE_ID,
    title: "Log | RH Administrativo"
  })).catch(() => null);
}

async function canConfigure(interaction: ChatInputCommandInteraction | ButtonInteraction, settings: RhAdminSettings) {
  const member = interaction.member as GuildMember | null;
  if (member?.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const roles = member?.roles.cache.map((role) => role.id) ?? [];
  return settings.configUserIds.includes(interaction.user.id) || settings.configRoleIds.some((roleId) => roles.includes(roleId));
}

async function fetchTextChannel(interaction: { guild: NonNullable<Interaction["guild"]> | null }, channelId: string) {
  const channel = await interaction.guild?.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased() && "send" in channel ? channel as SendableTextChannel : null;
}

function parseRhDate(value: string) {
  const match = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(value.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3] ?? new Date().getFullYear());
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { date, label: `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}` };
}

function inputRow(customId: string, label: string, style: TextInputStyle, required: boolean, maxLength: number, value?: string, placeholder?: string) {
  const input = new TextInputBuilder().setCustomId(customId).setLabel(label).setStyle(style).setRequired(required).setMaxLength(maxLength);
  if (value) input.setValue(value);
  if (placeholder) input.setPlaceholder(placeholder);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

function ephemeral<T extends Record<string, unknown>>(payload: T) {
  return { ...payload, flags: Number(payload.flags ?? 0) | MessageFlags.Ephemeral };
}

async function replyOrUpdate(interaction: ChatInputCommandInteraction | ButtonInteraction, payload: InteractionReplyOptions) {
  if (interaction.isButton()) await interaction.reply(payload).catch(() => null);
  else await interaction.reply(payload).catch(() => null);
}

function deniedMessage(error: unknown) {
  const response = typeof error === "object" && error && "response" in error ? (error as { response?: { data?: { message?: string } } }).response : null;
  return response?.data?.message || MODULE_DENIED;
}

function serverName(member: GuildMember | null, fallback: string) {
  return member?.nickname || member?.displayName || fallback;
}

function isValidImageUrl(value: string, allowAnyUrl: boolean) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return false;
    return allowAnyUrl || /\.(png|jpe?g|webp|gif)(?:$|\?)/i.test(url.pathname);
  } catch {
    return false;
  }
}

function parseColor(value: string | null | undefined) {
  const parsed = Number.parseInt((value ?? "").replace("#", ""), 16);
  return Number.isFinite(parsed) ? parsed : 0x1d4ed8;
}

function channel(id: string | null) {
  return id ? `<#${id}>` : "não configurado";
}

function mentions(ids: string[], type: "role" | "user") {
  if (!ids.length) return "nenhum";
  return ids.map((id) => type === "role" ? `<@&${id}>` : `<@${id}>`).join(", ");
}

function idFromCustomId(customId: string) {
  return customId.split(":")[1] ?? "";
}

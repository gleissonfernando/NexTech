import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type Interaction,
  type TextChannel
} from "discord.js";
import type { BotContext } from "../types";
import type { FivemGoalSettings, Pd7Config, Pd7Request } from "./apiClient";
import { ensureFivemGoalChannelForApprovedSet, type FivemGoalSetIntegrationResult } from "./fivemGoalService";
import { createPedirSetChannelName, PEDIR_SET_NAME, PEDIR_SET_REQUEST_LABEL } from "./fivemPd7Branding";
import { renderComponentsV2Panel } from "./panelVisualRenderer";
import { systemComponentEmoji, systemEmojiText, systemStatusEmoji } from "./systemEmojiService";

const PREFIX = "pd7";
const REQUIRED_APPROVAL_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.UseApplicationCommands
];

let started = false;
const handled = new Map<string, string>();
const approvalLocks = new Set<string>();

export function startFivemPd7Service(client: Client, context: BotContext) {
  if (started) return;
  started = true;
  const run = () => void syncPanels(client, context);
  void run();
  const timer = setInterval(run, 15_000);
  timer.unref();
}

export async function handleFivemPd7Interaction(interaction: Interaction, context: BotContext) {
  if (!(interaction.isButton() || interaction.isModalSubmit()) || !interaction.customId.startsWith(`${PREFIX}:`)) return false;

  const [, action, id] = interaction.customId.split(":");

  if (action === "request" && interaction.isButton()) {
    const config = (await context.api.getPd7Configs()).find((item) => item.factionId === id && item.guildId === interaction.guildId);
    if (!config) return fail(interaction, "Configuração do Pedir Set indisponível.");

    const modal = new ModalBuilder().setCustomId(`${PREFIX}:submit:${config.factionId}`).setTitle(`${PEDIR_SET_NAME} • ${config.factionName}`);
    for (const field of config.fields.sort((a, b) => a.order - b.order).slice(0, 5)) {
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(field.id)
          .setLabel(field.label)
          .setPlaceholder(field.placeholder ?? "Digite aqui")
          .setRequired(field.required)
          .setStyle(field.style === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setMaxLength(field.style === "paragraph" ? 1000 : 200)
      ));
    }
    await interaction.showModal(modal);
    return true;
  }

  if (action === "submit" && interaction.isModalSubmit()) {
    const config = (await context.api.getPd7Configs()).find((item) => item.factionId === id && item.guildId === interaction.guildId);
    if (!config || !interaction.guild) return fail(interaction, "Configuração do Pedir Set indisponível.");

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const fields = config.fields.sort((a, b) => a.order - b.order).map((field) => ({
      id: field.id,
      label: field.label,
      value: interaction.fields.getTextInputValue(field.id)
    }));
    const request = await context.api.createPd7Request({ guildId: interaction.guild.id, factionId: config.factionId, userId: interaction.user.id, username: interaction.user.username, fields });
    const channel = await createChannel(config, request, interaction.guild, context);
    await interaction.editReply(`Solicitação criada em ${channel}.`);
    return true;
  }

  if (!id) return false;
  const request = await context.api.getPd7Request(id).catch(() => null);
  if (!request || !interaction.guild) return fail(interaction, "Solicitação não encontrada.");
  const config = (await context.api.getPd7Configs()).find((item) => item.guildId === request.guildId && item.factionId === request.factionId);
  if (!config) return fail(interaction, "Configuração removida.");
  if (!canManage(interaction, config)) return fail(interaction, "Você não tem permissão para gerenciar o Pedir Set.");

  if (action === "reject" && interaction.isButton()) {
    await interaction.showModal(new ModalBuilder().setCustomId(`${PREFIX}:reject_submit:${id}`).setTitle("Reprovar solicitação de Set").addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("reason").setLabel("Motivo da reprovação").setRequired(true).setStyle(TextInputStyle.Paragraph).setMaxLength(1000)
      )
    ));
    return true;
  }

  if (action === "approve" && interaction.isButton()) {
    await approvePd7Request(interaction, context, request, config);
    return true;
  }

  if (action === "reject_submit" && interaction.isModalSubmit()) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const reason = interaction.fields.getTextInputValue("reason");
    const member = await interaction.guild.members.fetch(request.userId).catch(() => null);
    await finish(request, config, "rejected", interaction.user.id, reason, context, interaction.channel as TextChannel, true);
    await member?.send(`Seu pedido de Set em **${config.factionName}** foi reprovado. Motivo: ${reason}`).catch(() => null);
    await interaction.editReply("Solicitação de Set reprovada e canal apagado.");
    return true;
  }

  if (action === "close" && interaction.isButton()) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await finish(request, config, "closed", interaction.user.id, null, context, interaction.channel as TextChannel);
    await interaction.editReply("Canal arquivado.");
    return true;
  }

  return false;
}

async function approvePd7Request(interaction: ButtonInteraction, context: BotContext, request: Pd7Request, config: Pd7Config) {
  if (!interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (request.status !== "pending") {
    await interaction.editReply("Esta solicitação já foi processada.");
    return;
  }
  if (approvalLocks.has(request._id)) {
    await interaction.editReply("Esta aprovação já está em processamento. Aguarde a conclusão antes de tentar novamente.");
    return;
  }

  approvalLocks.add(request._id);
  let step = "inicio";
  let createdGoalChannelId: string | null = null;
  let goalSettings: FivemGoalSettings | null = null;

  try {
    await log(interaction.guild, config, "[PD7] Aprovação iniciada.");
    step = "validar_configuracao_pd7";
    await validatePd7ApprovalConfig(interaction.guild, config, interaction.channelId);

    step = "validar_configuracao_metas";
    goalSettings = await validateGoalApprovalConfig(interaction.guild, context);
    await log(interaction.guild, config, "[PD7] Configurações validadas.");

    step = "validar_usuario";
    const member = await interaction.guild.members.fetch(request.userId);

    step = "atualizar_usuario";
    await log(interaction.guild, config, "[PD7] Atualizando usuário.");
    await updateApprovedPd7Member(member, config, request);

    step = "criar_canal_metas";
    await log(interaction.guild, config, "[PD7] Solicitando criação de canal ao módulo de metas.");
    await log(interaction.guild, config, "[METAS] Categoria localizada.");
    const result = await ensureFivemGoalChannelForApprovedSet(
      context,
      interaction.guild,
      request.userId,
      resolvedApprovedName(request, member),
      goalSettings.categoryId,
      true,
      pd7GameId(request)
    );
    createdGoalChannelId = result.channelId;
    if (!result.channelId || result.error) {
      throw new Error(result.error ?? "O canal de metas não foi criado.");
    }

    await log(interaction.guild, config, result.moved ? "[METAS] Canal recuperado/movido para a categoria configurada." : "[METAS] Canal criado ou recuperado.");
    await log(interaction.guild, config, "[METAS] Permissões aplicadas.");
    await log(interaction.guild, config, "[METAS] Painel publicado.");

    step = "salvar_vinculo";
    await context.api.updatePd7Request(request._id, {
      approvedAt: new Date().toISOString() as any,
      approvedBy: interaction.user.id,
      goalCategoryId: goalSettings.categoryId,
      goalChannelId: result.channelId,
      handledBy: interaction.user.id,
      pd7RegistrationId: request._id,
      pd7TemporaryChannelId: request.channelId ?? interaction.channelId,
      source: "PD7"
    });

    step = "finalizar_pd7";
    await finish(request, config, "approved", interaction.user.id, null, context, interaction.channel as TextChannel, true);
    await logGoalSetIntegration(interaction.guild, config, request, interaction.user.id, result);
    await context.api.postLog({
      guildId: interaction.guild.id,
      message: "Pedir Set aprovado e canal de metas integrado automaticamente.",
      metadata: {
        approvedBy: interaction.user.id,
        goalCategoryId: goalSettings.categoryId,
        goalChannelId: result.channelId,
        pd7RegistrationId: request._id,
        pd7TemporaryChannelId: request.channelId ?? interaction.channelId,
        source: "PD7"
      },
      type: "pd7.goal_activated",
      userId: request.userId
    }).catch(() => null);
    await member.send(`Seu Set em **${config.factionName}** foi aprovado. Canal de metas: <#${result.channelId}>`).catch(() => null);
    await log(interaction.guild, config, "[PD7] Canal temporário apagado.");
    await log(interaction.guild, config, "[PD7] Aprovação concluída.");
    await interaction.editReply(`Set aprovado, metas ativadas em <#${result.channelId}> e canal temporário apagado.`);
  } catch (error) {
    await recordPd7ApprovalError(interaction.guild, context, config, request, {
      configuredGoalCategoryId: goalSettings?.categoryId ?? null,
      createdGoalChannelId,
      error,
      step,
      temporaryChannelId: request.channelId ?? interaction.channelId
    });
    await interaction.editReply(approvalErrorMessage(error));
  } finally {
    approvalLocks.delete(request._id);
  }
}

async function syncPanels(client: Client, context: BotContext) {
  for (const config of await context.api.getPd7Configs().catch(() => [])) {
    if (!config.publishRequestedAt || handled.get(config._id) === config.publishRequestedAt) continue;
    handled.set(config._id, config.publishRequestedAt);
    const guild = client.guilds.cache.get(config.guildId);
    const channel = guild && config.panelChannelPD7 ? await guild.channels.fetch(config.panelChannelPD7).catch(() => null) : null;
    if (!channel?.isTextBased()) continue;
    const payload = renderComponentsV2Panel({
      accentColor: 0x22c55e,
      guild,
      title: `${systemEmojiText("prancheta_acertos", guild)} ${PEDIR_SET_NAME} • ${config.factionName}`,
      description: "Solicite seu Set pelo botão abaixo. Os dados serão enviados à equipe responsável.",
      actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:request:${config.factionId}`).setEmoji(systemComponentEmoji("acessar", guild)).setLabel(PEDIR_SET_REQUEST_LABEL).setStyle(ButtonStyle.Primary)
      )]
    });
    let message = null;
    if (config.panelMessageId) message = await channel.messages.fetch(config.panelMessageId).catch(() => null);
    message ? await message.edit(payload) : message = await channel.send(payload);
    await context.api.updatePd7PanelState({ guildId: config.guildId, factionId: config.factionId, panelMessageId: message.id });
  }
}

async function createChannel(config: Pd7Config, request: Pd7Request, guild: Guild, context: BotContext) {
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: request.userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: guild.members.me!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    ...config.allowedRolesPD7.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] })),
    ...config.responsibleUsersPD7.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))
  ];
  const name = createPedirSetChannelName(request.username);
  const channel = await guild.channels.create({ name, type: ChannelType.GuildText, parent: config.categoryPD7 ?? undefined, permissionOverwrites: overwrites });
  const message = await channel.send(requestPanel(request, config, guild));
  await context.api.updatePd7Request(request._id, { channelId: channel.id, panelMessageId: message.id, pd7TemporaryChannelId: channel.id });
  await log(guild, config, `${systemEmojiText("acessar", guild)} Solicitação de Set criada por <@${request.userId}> • ${config.factionName}`);
  return channel;
}

function requestPanel(request: Pd7Request, config: Pd7Config, guild: Guild) {
  return renderComponentsV2Panel({
    accentColor: 0xf59e0b,
    guild,
    title: `${systemEmojiText("prancheta", guild)} Solicitação de Set • ${config.factionName}`,
    description: `**Solicitante:** <@${request.userId}>\n\n${request.fields.map((field) => `**${field.label}:**\n${field.value || "—"}`).join("\n\n")}`,
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:approve:${request._id}`).setEmoji(systemComponentEmoji("visto", guild)).setLabel("Aprovar").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${PREFIX}:reject:${request._id}`).setEmoji(systemComponentEmoji("exclamacao", guild)).setLabel("Reprovar").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`${PREFIX}:close:${request._id}`).setEmoji(systemComponentEmoji("porta", guild)).setLabel("Fechar").setStyle(ButtonStyle.Secondary)
    )]
  });
}

async function finish(request: Pd7Request, config: Pd7Config, status: "approved" | "rejected" | "closed", actor: string, reason: string | null, context: BotContext, channel: TextChannel, deleteChannel = false) {
  await context.api.updatePd7Request(request._id, {
    ...(status === "approved" ? { approvedAt: new Date().toISOString() as any, approvedBy: actor, source: "PD7" } : {}),
    handledBy: actor,
    rejectionReason: reason,
    resolvedAt: new Date().toISOString() as any,
    status
  });
  const outcome = status === "approved" ? "aprovada" : status === "rejected" ? "reprovada" : "fechada";
  await log(channel.guild, config, `${status === "approved" ? systemStatusEmoji("success", channel.guild) : status === "rejected" ? systemStatusEmoji("danger", channel.guild) : systemEmojiText("porta", channel.guild)} Solicitação de Set ${outcome} • usuário <@${request.userId}> • responsável <@${actor}>${reason ? `\nMotivo: ${reason}` : ""}`);
  if (deleteChannel) {
    await channel.delete(`Solicitação de Set ${outcome} por ${actor}`).catch(() => null);
    return;
  }
  await channel.permissionOverwrites.edit(request.userId, { SendMessages: false });
  await channel.setName(`${status}-${channel.name}`.slice(0, 100)).catch(() => null);
  if (config.autoDeleteMinutes && config.autoDeleteMinutes > 0) {
    setTimeout(() => void channel.delete("Prazo de retenção da solicitação de Set concluído").catch(() => null), config.autoDeleteMinutes * 60_000).unref();
  }
}

async function validatePd7ApprovalConfig(guild: Guild, config: Pd7Config, temporaryChannelId: string | null) {
  const missing: string[] = [];
  if (!config.panelChannelPD7) missing.push("Canal onde o painel do PD7 foi publicado.");
  if (!config.categoryPD7) missing.push("Categoria dos canais temporários do PD7.");
  if (!config.approvedRolePD7) missing.push("Cargo de usuários aprovados no PD7.");
  if (!config.allowedRolesPD7.length && !config.responsibleUsersPD7.length) missing.push("Cargos ou usuários responsáveis pelo PD7.");
  if (!temporaryChannelId) missing.push("Canal temporário da solicitação PD7.");
  if (missing.length) throw new Error(`Não foi possível concluir a aprovação.\n\n${missing.join("\n")}`);

  const panelChannelId = config.panelChannelPD7;
  const tempCategoryId = config.categoryPD7;
  if (!panelChannelId || !tempCategoryId) throw new Error("Não foi possível concluir a aprovação.\n\nConfiguração PD7 incompleta.");

  const panelChannel = await guild.channels.fetch(panelChannelId).catch(() => null);
  if (!panelChannel?.isTextBased()) throw new Error("O canal do painel PD7 configurado não existe ou não é um canal de texto.");
  const tempCategory = await guild.channels.fetch(tempCategoryId).catch(() => null);
  if (!tempCategory || tempCategory.type !== ChannelType.GuildCategory) throw new Error("A categoria dos canais temporários do PD7 não existe mais ou não é uma categoria.");
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error("Bot sem permissão Gerenciar Cargos para aplicar o cargo aprovado.");
}

async function validateGoalApprovalConfig(guild: Guild, context: BotContext) {
  const settings = await context.api.getFivemGoalSettings(guild.id).catch(() => null);
  if (!settings?.enabled) {
    throw new Error("Não foi possível concluir a aprovação.\n\nO Sistema de Metas está desativado ou indisponível.");
  }
  if (!settings.categoryId) {
    throw new Error("Não foi possível concluir a aprovação.\n\nA categoria do Sistema de Metas ainda não foi configurada.\nAcesse as configurações do módulo de metas e selecione a categoria onde os canais serão criados.");
  }
  const goalCategory = await guild.channels.fetch(settings.categoryId).catch(() => null);
  if (!goalCategory || goalCategory.type !== ChannelType.GuildCategory) {
    throw new Error("Não foi possível concluir a aprovação.\n\nA categoria do Sistema de Metas configurada não existe mais ou não é uma categoria.");
  }
  if (!settings.managerRoleId && !(settings.managerRoleIds ?? []).length && !settings.viewRoleId) {
    throw new Error("Não foi possível concluir a aprovação.\n\nConfigure ao menos um cargo administrativo ou de visualização no Sistema de Metas.");
  }
  const botMember = guild.members.me;
  const missing = botMember ? REQUIRED_APPROVAL_PERMISSIONS.filter((permission) => !botMember.permissions.has(permission)) : REQUIRED_APPROVAL_PERMISSIONS;
  const categoryMissing = botMember ? REQUIRED_APPROVAL_PERMISSIONS.filter((permission) => !goalCategory.permissionsFor(botMember)?.has(permission)) : REQUIRED_APPROVAL_PERMISSIONS;
  const missingNames = [...new Set([...missing, ...categoryMissing].map(permissionLabel))];
  if (missingNames.length) {
    throw new Error(`Não foi possível concluir a aprovação.\n\nO bot não possui permissões obrigatórias no Sistema de Metas: ${missingNames.join(", ")}.`);
  }
  return settings;
}

async function updateApprovedPd7Member(member: GuildMember, config: Pd7Config, request: Pd7Request) {
  const nick = pd7Nickname(request);
  if (nick) {
    await member.setNickname(nick.slice(0, 32), "Solicitação de Set aprovada pelo PD7").catch(() => null);
  }
  if (config.approvedRolePD7) {
    await member.roles.add(config.approvedRolePD7, "Solicitação de Set aprovada pelo PD7");
  }
}

async function recordPd7ApprovalError(guild: Guild, context: BotContext, config: Pd7Config, request: Pd7Request, input: { configuredGoalCategoryId: string | null; createdGoalChannelId: string | null; error: unknown; step: string; temporaryChannelId: string | null }) {
  const errorMessage = input.error instanceof Error ? input.error.message : String(input.error);
  const errorStack = input.error instanceof Error ? input.error.stack ?? null : null;
  await log(guild, config, `${systemStatusEmoji("danger", guild)} [PD7] Falha na aprovação\nEtapa: ${input.step}\nUsuário: <@${request.userId}>\nErro: ${errorMessage}`);
  await context.api.postLog({
    guildId: guild.id,
    message: "Falha na aprovação PD7 com integração de metas.",
    metadata: {
      configuredGoalCategoryId: input.configuredGoalCategoryId,
      createdGoalChannelId: input.createdGoalChannelId,
      dataEHora: new Date().toISOString(),
      errorMessage,
      errorStack,
      etapaDoFluxo: input.step,
      guildId: guild.id,
      registrationId: request._id,
      temporaryChannelId: input.temporaryChannelId,
      userId: request.userId
    },
    type: "pd7.approval_failed",
    userId: request.userId
  }).catch(() => null);
}

async function log(guild: Guild, config: Pd7Config, text: string) {
  if (!config.logChannelPD7) return;
  const channel = await guild.channels.fetch(config.logChannelPD7).catch(() => null);
  if (channel?.isTextBased()) {
    await channel.send(renderComponentsV2Panel({
      accentColor: 0x5865f2,
      guild,
      title: `${systemEmojiText("folha", guild)} Log do Pedir Set`,
      description: `${text}\n<t:${Math.floor(Date.now() / 1000)}:F>`
    })).catch(() => null);
  }
}

async function logGoalSetIntegration(guild: Guild, config: Pd7Config, request: Pd7Request, actor: string, result: FivemGoalSetIntegrationResult) {
  const sourceName = await categoryLabel(guild, result.previousCategoryId);
  const targetName = await categoryLabel(guild, result.targetCategoryId);
  const lines = [
    `${systemStatusEmoji("success", guild)} Integração Pedir Set → Metas`,
    `Usuário aprovado: <@${request.userId}>`,
    `Responsável pela aprovação: <@${actor}>`,
    `Canal de metas: ${result.channelId ? `<#${result.channelId}>` : "não identificado"}`,
    `Categoria de origem: ${sourceName}`,
    `Categoria de destino: ${targetName}`,
    `Data e horário da aprovação: <t:${Math.floor(Date.now() / 1000)}:F>`,
    `Movimentação: ${result.moved ? "canal movido automaticamente" : "canal já estava na categoria configurada ou foi criado nela"}`
  ];
  await log(guild, config, lines.join("\n"));
}

async function categoryLabel(guild: Guild, categoryId: string | null) {
  if (!categoryId) return "não configurada";
  const category = await guild.channels.fetch(categoryId).catch(() => null);
  return category ? `${category.name} (${categoryId})` : `${categoryId} (não encontrada)`;
}

function canManage(interaction: any, config: Pd7Config) {
  return config.responsibleUsersPD7.includes(interaction.user.id)
    || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    || interaction.member?.roles?.cache?.some((role: any) => config.allowedRolesPD7.includes(role.id));
}

async function fail(interaction: any, message: string) {
  if (interaction.replied || interaction.deferred) await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
  else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
  return true;
}

function approvalErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith("Não foi possível concluir a aprovação.")
    ? message
    : `Não foi possível concluir a aprovação.\n\n${message}`;
}

function pd7FieldValue(request: Pd7Request, patterns: RegExp[]) {
  return request.fields.find((field) => patterns.some((pattern) => pattern.test(`${field.id} ${field.label}`)))?.value.trim() || null;
}

function pd7GameId(request: Pd7Request) {
  return pd7FieldValue(request, [/\bid\b/i, /passaporte/i, /rg/i]);
}

function pd7ApprovedName(request: Pd7Request) {
  return pd7FieldValue(request, [/ingame/i, /nome.*jogo/i, /nome/i]);
}

function pd7Nickname(request: Pd7Request) {
  const name = pd7ApprovedName(request);
  const id = pd7GameId(request);
  if (name && id) return `${name} | ${id}`;
  return name ?? null;
}

function resolvedApprovedName(request: Pd7Request, member: GuildMember) {
  return pd7ApprovedName(request) ?? member.displayName ?? request.username;
}

function permissionLabel(permission: bigint) {
  const labels = new Map<bigint, string>([
    [PermissionFlagsBits.ViewChannel, "Ver Canal"],
    [PermissionFlagsBits.ManageChannels, "Gerenciar Canais"],
    [PermissionFlagsBits.ManageRoles, "Gerenciar Cargos"],
    [PermissionFlagsBits.SendMessages, "Enviar Mensagens"],
    [PermissionFlagsBits.EmbedLinks, "Inserir Links"],
    [PermissionFlagsBits.AttachFiles, "Anexar Arquivos"],
    [PermissionFlagsBits.ReadMessageHistory, "Ver Histórico de Mensagens"],
    [PermissionFlagsBits.UseApplicationCommands, "Usar Comandos de Aplicativo"]
  ]);
  return labels.get(permission) ?? permission.toString();
}

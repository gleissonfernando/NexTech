import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, MessageFlags, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder,
  StringSelectMenuBuilder, type ChannelSelectMenuInteraction, type ChatInputCommandInteraction, type Client, type GuildMember, type Interaction,
  TextInputBuilder, TextInputStyle, type ModalSubmitInteraction, type StringSelectMenuInteraction
} from "discord.js";
import { isBotModuleEnabled, setRuntimeEnabledModules } from "../config/env";
import type { BotCommand, BotContext } from "../types";
import { resetSelectMenuMessage } from "../utils/selectMenuReset";
import type { FivemActionArchitecture, FivemActionMode, FivemActionSession, FivemActionSettings } from "./apiClient";
import { resolvePanelImageUrl, type PanelVisualConfig } from "./panelVisualRenderer";
import { replaceSystemEmojis, systemComponentEmoji, systemEmojiText, systemStatusEmoji } from "./systemEmojiService";

const PREFIX = "fivem_action";
const MODULE_BY_ARCHITECTURE: Record<FivemActionArchitecture, string> = { fac: "fivem-actions", police: "police-actions" };
const handledRequests = new Map<string, string>();
let polling = false;

export const acaoCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("acao")
    .setDescription("Sistema de Ações Policiais.")
    .addSubcommand((subcommand) => subcommand
      .setName("config")
      .setDescription("Abre o painel de configuração das ações policiais."))
    .addSubcommand((subcommand) => subcommand
      .setName("publicar")
      .setDescription("Publica ou atualiza o painel operacional das ações policiais.")),
  moduleId: "police-actions",
  async execute(interaction: ChatInputCommandInteraction, context: BotContext) {
    try {
      if (!interaction.guildId || !interaction.guild) return void await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
      await refreshFivemActionRuntimeModules(context).catch(() => null);
      if (!isFivemActionRuntimeEnabled("police")) return void await interaction.reply({ content: "Ações policiais não liberadas para este bot.", flags: MessageFlags.Ephemeral });
      const dashboard = await context.api.getFivemActionDashboard(interaction.guildId, "police");
      if (!canManageActionsFromDiscord(interaction, dashboard.settings)) {
        return void await interaction.reply({ content: "Você precisa de Gerenciar Servidor ou de um cargo autorizado para gerenciar ações.", flags: MessageFlags.Ephemeral });
      }
      const subcommand = interaction.options.getSubcommand(false);
      const legacyMode = interaction.options.getString("modo", false);
      const action = subcommand ?? legacyMode;
      if (action === "config") {
        await interaction.reply(actionConfigPanel(dashboard, "police", true));
        return;
      }
      if (action !== "publicar" && action !== "publish") {
        await interaction.reply({ content: "Subcomando inválido.", flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const settings = await context.api.requestFivemActionPanelPublish(interaction.guildId, "police", interaction.user.id);
      await publishRequestedPanel(interaction.client, context, settings);
      await interaction.editReply(`Painel de ações policiais publicado/atualizado em <#${settings.panelChannelId}>.`);
    } catch (error) {
      console.warn("[fivem-actions] falha no comando /acao:", errorMessage(error));
      await replyCommandError(interaction, `Erro no Sistema de Ações: ${publicErrorMessage(error)}`);
    }
  }
};

export function startFivemActionService(client: Client, context: BotContext) {
  if (!isFivemActionRuntimeEnabled()) return;
  void processPanelRequests(client, context);
  const interval = setInterval(() => void processPanelRequests(client, context), 15_000);
  interval.unref();
}

export async function handleFivemActionInteraction(interaction: Interaction, context: BotContext) {
  if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isChannelSelectMenu() || interaction.isModalSubmit()) || !interaction.customId.startsWith(`${PREFIX}:`)) return false;
  if (!isFivemActionRuntimeEnabled()) { await interaction.reply({ content: "Sistema de Ações não liberado para este bot.", ephemeral: true }); return true; }
  if (!interaction.guildId || !interaction.guild) { await interaction.reply({ content: "Use este sistema dentro de um servidor.", ephemeral: true }); return true; }
  const [, action, id] = interaction.customId.split(":");
  if (!action) {
    await interaction.reply({ content: "Interação inválida.", ephemeral: true });
    return true;
  }
  if (interaction.isButton() && action === "config") await showActionConfig(interaction, context, id as FivemActionArchitecture);
  else if (interaction.isButton() && action === "config_refresh") await showActionConfig(interaction, context, id as FivemActionArchitecture);
  else if (interaction.isButton() && action === "config_channels") await showActionChannelConfig(interaction, context, id as FivemActionArchitecture);
  else if (interaction.isButton() && action === "config_actions") await showActionCreateModal(interaction, context, id as FivemActionArchitecture);
  else if (interaction.isButton() && action === "config_sheet") await showActionSheetModal(interaction, context, id as FivemActionArchitecture);
  else if (interaction.isButton() && action === "config_publish") await requestActionPanelPublish(interaction, context, id as FivemActionArchitecture);
  else if (interaction.isChannelSelectMenu() && action.startsWith("channel_")) await saveActionChannel(interaction, context, action, id as FivemActionArchitecture);
  else if (interaction.isModalSubmit() && action === "action_modal") await saveActionDefinition(interaction, context, id as FivemActionArchitecture);
  else if (interaction.isModalSubmit() && action === "sheet_modal") await saveActionSheet(interaction, context, id as FivemActionArchitecture);
  else if (interaction.isStringSelectMenu() && action === "open") await openAction(interaction, context);
  else if (interaction.isButton() && action === "mode") await createActionWithMode(interaction, context, id!);
  else if (interaction.isButton() && action === "join") await changeParticipant(interaction, context, id!, true);
  else if (interaction.isButton() && action === "leave") await changeParticipant(interaction, context, id!, false);
  else if (interaction.isButton() && action === "start") await startAction(interaction, context, id!);
  else if (interaction.isButton() && action === "cancel") await cancelAction(interaction, context, id!);
  else if (interaction.isButton() && action === "result") await chooseResult(interaction, context, id!);
  else if (interaction.isButton() && action === "finish_result") await finishActionFromButton(interaction, context, id!);
  else if (interaction.isButton() && action === "page") await showActionPage(interaction, context, id!);
  else if (interaction.isStringSelectMenu() && action === "finish") await showFinishModal(interaction, context, id!);
  else if (interaction.isModalSubmit() && action === "finish_modal") await finishAction(interaction, context, id!);
  return true;
}

async function processPanelRequests(client: Client, context: BotContext) {
  if (polling) return; polling = true;
  try {
    const configs = await context.api.getActiveFivemActionConfigs();
    for (const config of configs) {
      if (!config.lastPanelRequestedAt) continue;
      const key = panelRequestKey(config);
      if (handledRequests.get(key) === config.lastPanelRequestedAt) continue;
      await publishRequestedPanel(client, context, config).catch((error) => {
        console.warn(`[fivem-actions] falha ao publicar painel pendente ${key}:`, errorMessage(error));
      });
    }
  } catch (error) { console.warn("[fivem-actions] falha ao processar painéis:", errorMessage(error)); }
  finally { polling = false; }
}

async function publishRequestedPanel(client: Client, context: BotContext, config: FivemActionSettings) {
  await publishMainPanel(client, context, config);
  if (config.lastPanelRequestedAt) handledRequests.set(panelRequestKey(config), config.lastPanelRequestedAt);
}

function panelRequestKey(config: Pick<FivemActionSettings, "botId" | "guildId" | "architecture">) {
  return `${config.botId}:${config.guildId}:${config.architecture}`;
}

function actionConfigPanel(dashboard: Awaited<ReturnType<BotContext["api"]["getFivemActionDashboard"]>>, architecture: FivemActionArchitecture, ephemeral = false) {
  const { settings, actions } = dashboard;
  const label = architecture === "police" ? "Polícia" : "FAC";
  const configuredChannels = [settings.panelChannelId, settings.actionChannelId, settings.reportChannelId].filter(Boolean).length;
  const enabledActions = actions.filter((action) => action.enabled).length;
  const content = [
    `# Sistema de Ações - ${label}`,
    "Configurações feitas aqui usam o mesmo banco da dashboard.",
    "",
    `**Canais configurados:** ${configuredChannels}/3`,
    `**Ações cadastradas:** ${enabledActions}`,
    `**Painel publicado:** ${settings.panelMessageId ? "Sim" : "Não"}`,
    `**Status:** ${settings.enabled ? "Ativo" : "Inativo"}`
  ].join("\n");
  const architectureRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:config:fac`).setLabel("FAC").setStyle(architecture === "fac" ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(!isFivemActionRuntimeEnabled("fac")),
    new ButtonBuilder().setCustomId(`${PREFIX}:config:police`).setLabel("Polícia").setStyle(architecture === "police" ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(!isFivemActionRuntimeEnabled("police"))
  );
  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:config_channels:${architecture}`).setLabel("Configurar painel").setEmoji("📺").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}:config_actions:${architecture}`).setLabel("Cadastrar ações").setEmoji("➕").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}:config_sheet:${architecture}`).setLabel("Cadastro da planilha").setEmoji("📄").setStyle(ButtonStyle.Secondary).setDisabled(architecture !== "police"),
    new ButtonBuilder().setCustomId(`${PREFIX}:config_publish:${architecture}`).setLabel(settings.panelMessageId ? "Atualizar painel" : "Publicar painel").setEmoji("📌").setStyle(ButtonStyle.Success).setDisabled(!settings.panelChannelId || !settings.actionChannelId || !enabledActions),
    new ButtonBuilder().setCustomId(`${PREFIX}:config_refresh:${architecture}`).setLabel("Atualizar visão").setEmoji("🔄").setStyle(ButtonStyle.Secondary)
  );

  return {
    components: [{ type: 17, accent_color: parseColor(settings.color), components: [{ type: 10, content }, architectureRow, actionRow] }],
    flags: (ephemeral ? MessageFlags.Ephemeral : 0) | MessageFlags.IsComponentsV2
  };
}

async function showActionConfig(interaction: any, context: BotContext, architecture: FivemActionArchitecture) {
  const dashboard = await context.api.getFivemActionDashboard(interaction.guildId, architecture);
  if (!canManageActionsFromDiscord(interaction, dashboard.settings)) return void await interaction.reply({ content: "Você precisa de Gerenciar Servidor ou de um cargo autorizado para configurar o Sistema de Ações.", ephemeral: true });
  const payload = actionConfigPanel(dashboard, architecture, false);
  if (interaction.replied || interaction.deferred) await interaction.editReply(payload);
  else await interaction.update(payload);
}

async function showActionChannelConfig(interaction: any, context: BotContext, architecture: FivemActionArchitecture) {
  const dashboard = await context.api.getFivemActionDashboard(interaction.guildId, architecture);
  if (!canManageActionsFromDiscord(interaction, dashboard.settings)) return void await interaction.reply({ content: "Você precisa de Gerenciar Servidor ou de um cargo autorizado para configurar canais.", ephemeral: true });
  const { settings } = dashboard;
  const content = [
    `# 📺 Canais - ${architecture === "police" ? "Polícia" : "FAC"}`,
    "Selecione cada canal abaixo. Cada alteração é salva imediatamente no mesmo banco da dashboard.",
    "",
    `**Painel inicial:** ${settings.panelChannelId ? `<#${settings.panelChannelId}>` : "não configurado"}`,
    `**Participação:** ${settings.actionChannelId ? `<#${settings.actionChannelId}>` : "não configurado"}`,
    `**Relatórios:** ${settings.reportChannelId ? `<#${settings.reportChannelId}>` : "não configurado"}`
  ].join("\n");
  const payload = {
    components: [{
      type: 17,
      accent_color: parseColor(settings.color),
      components: [
        { type: 10, content },
        new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId(`${PREFIX}:channel_panel:${architecture}`).setPlaceholder("Canal do painel inicial").setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1)),
        new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId(`${PREFIX}:channel_action:${architecture}`).setPlaceholder("Canal de participação").setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1)),
        new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId(`${PREFIX}:channel_report:${architecture}`).setPlaceholder("Canal de resultados e relatórios").setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1)),
        new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:config:${architecture}`).setLabel("Voltar").setEmoji("↩️").setStyle(ButtonStyle.Secondary))
      ]
    }],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  };
  await interaction.update(payload);
}

async function saveActionChannel(interaction: ChannelSelectMenuInteraction, context: BotContext, action: string, architecture: FivemActionArchitecture) {
  const current = await context.api.getFivemActionDashboard(interaction.guildId!, architecture);
  if (!canManageActionsFromDiscord(interaction, current.settings)) return void await interaction.reply({ content: "Você precisa de Gerenciar Servidor ou de um cargo autorizado para configurar canais.", ephemeral: true });
  await interaction.deferUpdate();
  const channelId = interaction.values[0] ?? null;
  const patch = action === "channel_panel"
    ? { panelChannelId: channelId }
    : action === "channel_action"
      ? { actionChannelId: channelId }
      : { reportChannelId: channelId };
  await context.api.saveFivemActionSettings(interaction.guildId!, architecture, patch, interaction.user.id);
  const dashboard = await context.api.getFivemActionDashboard(interaction.guildId!, architecture);
  await interaction.editReply(actionConfigPanel(dashboard, architecture, false));
}

async function requestActionPanelPublish(interaction: any, context: BotContext, architecture: FivemActionArchitecture) {
  const current = await context.api.getFivemActionDashboard(interaction.guildId, architecture);
  if (!canManageActionsFromDiscord(interaction, current.settings)) return void await interaction.reply({ content: "Você precisa de Gerenciar Servidor ou de um cargo autorizado para publicar painéis.", ephemeral: true });
  await interaction.deferUpdate();
  try {
    const settings = await context.api.requestFivemActionPanelPublish(interaction.guildId, architecture, interaction.user.id);
    await publishRequestedPanel(interaction.client, context, settings);
    const dashboard = await context.api.getFivemActionDashboard(interaction.guildId, architecture);
    await interaction.editReply(actionConfigPanel(dashboard, architecture, false));
  } catch (error) {
    console.warn("[fivem-actions] falha ao publicar painel pelo botão:", errorMessage(error));
    await interaction.followUp({ content: `Não consegui publicar o painel: ${publicErrorMessage(error)}`, ephemeral: true }).catch(() => null);
  }
}

async function showActionCreateModal(interaction: any, context: BotContext, architecture: FivemActionArchitecture) {
  const dashboard = await context.api.getFivemActionDashboard(interaction.guildId, architecture);
  if (!canManageActionsFromDiscord(interaction, dashboard.settings)) return void await interaction.reply({ content: "Você precisa de Gerenciar Servidor ou de um cargo autorizado para cadastrar ações.", ephemeral: true });
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:action_modal:${architecture}`)
    .setTitle("Cadastrar Ação")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("name").setLabel("Nome da ação").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("maxParticipants").setLabel("Quantidade máxima de participantes").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3).setValue("6")),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("description").setLabel("Descrição").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000))
    );
  await interaction.showModal(modal);
}

async function saveActionDefinition(interaction: ModalSubmitInteraction, context: BotContext, architecture: FivemActionArchitecture) {
  const dashboard = await context.api.getFivemActionDashboard(interaction.guildId!, architecture);
  if (!canManageActionsFromDiscord(interaction, dashboard.settings)) return void await interaction.reply({ content: "Você precisa de Gerenciar Servidor ou de um cargo autorizado para cadastrar ações.", ephemeral: true });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const maxParticipants = Number.parseInt(interaction.fields.getTextInputValue("maxParticipants").trim(), 10);
  if (!Number.isInteger(maxParticipants) || maxParticipants < 1 || maxParticipants > 100) {
    await interaction.editReply("Informe uma quantidade máxima entre 1 e 100.");
    return;
  }
  try {
    const action = await context.api.createFivemActionDefinition(interaction.guildId!, architecture, {
      color: dashboard.settings.color,
      description: interaction.fields.getTextInputValue("description").trim(),
      enabled: true,
      maxParticipants,
      name: interaction.fields.getTextInputValue("name").trim(),
      order: dashboard.actions.length
    }, interaction.user.id);
    await interaction.editReply(`Ação **${action.name}** cadastrada e sincronizada com a dashboard.`);
  } catch (error) {
    console.warn("[fivem-actions] falha ao cadastrar ação:", errorMessage(error));
    await interaction.editReply(`Não consegui cadastrar a ação: ${publicErrorMessage(error)}`);
  }
}

async function showActionSheetModal(interaction: any, context: BotContext, architecture: FivemActionArchitecture) {
  const dashboard = await context.api.getFivemActionDashboard(interaction.guildId, architecture);
  if (!canManageActionsFromDiscord(interaction, dashboard.settings)) return void await interaction.reply({ content: "Você precisa de Gerenciar Servidor ou de um cargo autorizado para configurar a planilha.", ephemeral: true });
  if (architecture !== "police") return void await interaction.reply({ content: "Cadastro de planilha disponível apenas em Ações Policiais.", ephemeral: true });
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:sheet_modal:${architecture}`)
    .setTitle("Cadastro da Planilha")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("spreadsheet").setLabel("Link ou ID da Google Sheets").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(512).setValue(dashboard.settings.spreadsheetId ?? "")),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("sheetName").setLabel("Nome da aba").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100).setValue(dashboard.settings.spreadsheetSheetName ?? "Ações Polícia"))
    );
  await interaction.showModal(modal);
}

async function saveActionSheet(interaction: ModalSubmitInteraction, context: BotContext, architecture: FivemActionArchitecture) {
  const dashboard = await context.api.getFivemActionDashboard(interaction.guildId!, architecture);
  if (!canManageActionsFromDiscord(interaction, dashboard.settings)) return void await interaction.reply({ content: "Você precisa de Gerenciar Servidor ou de um cargo autorizado para configurar a planilha.", ephemeral: true });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const spreadsheetId = interaction.fields.getTextInputValue("spreadsheet").trim();
  const spreadsheetSheetName = interaction.fields.getTextInputValue("sheetName").trim() || "Ações Polícia";
  const settings = await context.api.saveFivemActionSettings(interaction.guildId!, architecture, { spreadsheetEnabled: true, spreadsheetId, spreadsheetSheetName }, interaction.user.id);
  await interaction.editReply(settings.spreadsheetSyncError ? `Planilha salva com erro: ${settings.spreadsheetSyncError}` : "Planilha salva e conectada.");
}

async function publishMainPanel(client: Client, context: BotContext, config: FivemActionSettings) {
  if (!config.panelChannelId) throw new Error(`Canal principal não configurado para ${config.guildId}/${config.architecture}.`);
  const guild = await client.guilds.fetch(config.guildId);
  const channel = await guild.channels.fetch(config.panelChannelId);
  if (!channel?.isTextBased() || channel.isDMBased()) throw new Error("Canal do painel inválido.");
  const dashboard = await context.api.getFivemActionDashboard(config.guildId, config.architecture);
  const enabled = dashboard.actions.filter((item) => item.enabled).sort((a, b) => a.order - b.order);
  if (!enabled.length) throw new Error("Cadastre ao menos uma ação antes de publicar.");
  const select = new StringSelectMenuBuilder().setCustomId(`${PREFIX}:open:${config.architecture}`).setPlaceholder("Escolha uma ação").addOptions(enabled.slice(0, 25).map((item) => ({ label: item.name.slice(0, 100), value: `${config.architecture}|${item.id}`, description: item.description.slice(0, 100) || undefined, emoji: item.emoji ? replaceSystemEmojis(item.emoji, guild) : undefined })));
  const intro = { type: 10, content: replaceSystemEmojis([`# ${config.panelTitle}`, config.panelDescription].join("\n"), guild) };
  const tutorial = { type: 10, content: [`## ${systemEmojiText("folha", guild)} Como funciona`, "1. Escolha uma ação no menu.", "2. Vá ao painel criado.", "3. Entre na ação e aguarde a equipe.", "4. O responsável encerra em Resultado da ação.", "5. O relatório será enviado automaticamente."].join("\n") };
  const visuals = config.architecture === "police" ? await getPanelVisualSlots(context, config.guildId, "police-actions") : [];
  const fallbackImageUrl = config.imageUrl && config.imagePosition !== "none" ? resolvePanelImageUrl(config.imageUrl) : null;
  const media = visuals.length ? visuals.map((visual) => mediaBlock(visual.imageUrl!, config.panelTitle)) : fallbackImageUrl ? [mediaBlock(fallbackImageUrl, config.panelTitle)] : [];
  const imagePosition = visuals[0] ? actionImagePosition(visuals[0].imagePosition) : config.imagePosition;
  const contentComponents: any[] = imagePosition === "top" && media.length ? [...media, intro, tutorial] : imagePosition === "center" && media.length ? [intro, ...media, tutorial] : [intro, tutorial, ...media];
  const navigation = enabled.length > 25 ? [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:page:${config.architecture}|1`).setLabel("Mais ações").setEmoji(systemComponentEmoji("acessar", guild)).setStyle(ButtonStyle.Secondary))] : [];
  const payload = { components: [{ type: 17, accent_color: parseColor(config.color), components: [...contentComponents, new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select), ...navigation] }], flags: MessageFlags.IsComponentsV2 as const };
  if (config.panelMessageId) {
    const message = await channel.messages.fetch(config.panelMessageId).catch(() => null);
    if (message) {
      try {
        await message.edit(payload);
        return;
      } catch (error) {
        console.warn(`[fivem-actions] falha ao editar painel salvo; publicando nova mensagem guild=${config.guildId} architecture=${config.architecture} message=${config.panelMessageId}:`, errorMessage(error));
      }
    }
    console.warn(`[fivem-actions] painel salvo nao encontrado; publicando nova mensagem guild=${config.guildId} architecture=${config.architecture} message=${config.panelMessageId}`);
  }
  const message = await channel.send(payload);
  await context.api.updateFivemActionPanelState({ guildId: config.guildId, architecture: config.architecture, panelMessageId: message.id });
}

async function openAction(interaction: StringSelectMenuInteraction, context: BotContext) {
  await interaction.deferReply({ ephemeral: true });
  void resetSelectMenuMessage(interaction);
  const [architectureRaw, actionId] = (interaction.values[0] ?? "").split("|");
  const architecture = architectureRaw as FivemActionArchitecture;
  if (!actionId || !["fac", "police"].includes(architecture)) return void await interaction.editReply("Ação inválida.");
  if (!isFivemActionRuntimeEnabled(architecture)) return void await interaction.editReply(architecture === "police" ? "Acoes policiais nao liberadas para este bot." : "Acoes FAC nao liberadas para este bot.");
  const dashboard = await context.api.getFivemActionDashboard(interaction.guildId!, architecture);
  const action = dashboard.actions.find((item) => item.id === actionId);
  if (!action) return void await interaction.editReply("Ação não encontrada.");
  const modeButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:mode:${architecture}|${actionId}|shootout`).setEmoji("🔫").setLabel("No tiro").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`${PREFIX}:mode:${architecture}|${actionId}|escape`).setEmoji("🚗").setLabel("Na fuga").setStyle(ButtonStyle.Primary)
  );
  await interaction.editReply({
    components: [{
      type: 17,
      accent_color: parseColor(action.color),
      components: [
        { type: 10, content: [
          `# ${systemEmojiText("arma", interaction.guild)} Central de Operações`,
          `## ${replaceSystemEmojis(`${action.emoji ?? ""} ${action.name}`.trim(), interaction.guild)}`,
          "Escolha o modo da ação antes de iniciar a operação.",
          "",
          `**Responsável:** <@${interaction.user.id}>`
        ].join("\n") },
        modeButtons
      ]
    }],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  });
}

async function createActionWithMode(interaction: any, context: BotContext, token: string) {
  await interaction.deferUpdate();
  const [architectureRaw, actionId, modeRaw] = token.split("|");
  const architecture = architectureRaw as FivemActionArchitecture;
  const mode = modeRaw as FivemActionMode;
  if (!actionId || !["fac", "police"].includes(architecture) || !["shootout", "escape"].includes(mode)) return void await interaction.editReply("Ação inválida.");
  if (!isFivemActionRuntimeEnabled(architecture)) return void await interaction.editReply(architecture === "police" ? "Acoes policiais nao liberadas para este bot." : "Acoes FAC nao liberadas para este bot.");
  const dashboard = await context.api.getFivemActionDashboard(interaction.guildId!, architecture);
  const channelId = dashboard.settings.actionChannelId;
  if (!channelId) return void await interaction.editReply("Canal de ações não configurado.");
  const channel = await interaction.guild!.channels.fetch(channelId);
  if (!channel?.isTextBased() || channel.isDMBased()) return void await interaction.editReply("Canal de ações inválido.");
  const session = await context.api.createFivemActionSession({ guildId: interaction.guildId!, architecture, actionId, mode, openerId: interaction.user.id, openerName: displayName(interaction.member) });
  const message = await channel.send(sessionPayload(session, interaction.guild));
  await context.api.updateFivemActionSessionMessage(session.id, { channelId: channel.id, messageId: message.id });
  await interaction.editReply({ content: `Painel de **${session.actionName}** criado em <#${channel.id}> com modo **${actionModeLabel(session.mode)}**.`, components: [] });
}

async function showActionPage(interaction: any, context: BotContext, token: string) {
  const [architectureRaw, pageRaw] = token.split("|");
  const architecture = architectureRaw as FivemActionArchitecture;
  if (!isFivemActionRuntimeEnabled(architecture)) return void await interaction.reply({ content: architecture === "police" ? "Acoes policiais nao liberadas para este bot." : "Acoes FAC nao liberadas para este bot.", ephemeral: true });
  const page = Math.max(0, Number.parseInt(pageRaw ?? "0", 10) || 0);
  const dashboard = await context.api.getFivemActionDashboard(interaction.guildId, architecture);
  const actions = dashboard.actions.filter((item) => item.enabled).sort((a, b) => a.order - b.order);
  const pages = Math.max(1, Math.ceil(actions.length / 25));
  const safePage = Math.min(page, pages - 1);
  const items = actions.slice(safePage * 25, safePage * 25 + 25);
  const select = new StringSelectMenuBuilder().setCustomId(`${PREFIX}:open:${architecture}`).setPlaceholder(`Ações ${safePage + 1}/${pages}`).addOptions(items.map((item) => ({ label: item.name.slice(0, 100), value: `${architecture}|${item.id}`, description: item.description.slice(0, 100) || undefined, emoji: item.emoji ? replaceSystemEmojis(item.emoji, interaction.guild) : undefined })));
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:page:${architecture}|${safePage - 1}`).setEmoji(systemComponentEmoji("porta", interaction.guild)).setLabel("Anterior").setStyle(ButtonStyle.Secondary).setDisabled(safePage === 0),
    new ButtonBuilder().setCustomId(`${PREFIX}:page:${architecture}|${safePage + 1}`).setEmoji(systemComponentEmoji("acessar", interaction.guild)).setLabel("Próxima").setStyle(ButtonStyle.Secondary).setDisabled(safePage >= pages - 1)
  );
  const payload = { components: [{ type: 17, accent_color: parseColor(dashboard.settings.color), components: [{ type: 10, content: `## ${systemEmojiText("prancheta", interaction.guild)} Escolha uma ação\n${systemEmojiText("folha", interaction.guild)} Página ${safePage + 1} de ${pages}` }, new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select), buttons] }], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 };
  if (interaction.replied || interaction.deferred) await interaction.editReply(payload); else await interaction.reply(payload);
}

async function changeParticipant(interaction: any, context: BotContext, sessionId: string, joining: boolean) {
  await interaction.deferReply({ ephemeral: true });
  const member = interaction.member as GuildMember;
  const session = joining
    ? await context.api.joinFivemActionSession(sessionId, { userId: interaction.user.id, username: displayName(member), roleIds: [...member.roles.cache.keys()] })
    : await context.api.leaveFivemActionSession(sessionId, interaction.user.id);
  await refreshSessionMessage(interaction, session);
  const participant = session.participants.find((item) => item.userId === interaction.user.id && !item.leftAt);
  const reserve = participant?.position === "reserve";
  await interaction.editReply(joining ? reserve ? "A ação está cheia. Você entrou na reserva." : "Você entrou como titular na ação." : "Você saiu da ação.");
}

async function startAction(interaction: any, context: BotContext, sessionId: string) {
  await interaction.deferReply({ ephemeral: true });
  const session = await context.api.startFivemActionSession(sessionId, interaction.user.id);
  await refreshSessionMessage(interaction, session);
  await interaction.editReply("Ação iniciada. Novas entradas foram bloqueadas.");
}

async function cancelAction(interaction: any, context: BotContext, sessionId: string) {
  await interaction.deferReply({ ephemeral: true });
  const session = await context.api.cancelFivemActionSession(sessionId, interaction.user.id);
  await refreshSessionMessage(interaction, session);
  await interaction.editReply("Ação cancelada.");
}

async function chooseResult(interaction: any, _context: BotContext, sessionId: string) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:finish_result:${sessionId}|victory`).setLabel("Vitória").setEmoji(systemComponentEmoji("visto", interaction.guild)).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}:finish_result:${sessionId}|defeat`).setLabel("Derrota").setEmoji(systemComponentEmoji("exclamacao", interaction.guild)).setStyle(ButtonStyle.Danger)
  );
  await interaction.reply({
    components: [{
      type: 17,
      accent_color: 0x7c3aed,
      components: [
        { type: 10, content: [
          `## ${systemEmojiText("trofeu", interaction.guild)} Resultado da ação`,
          `${systemEmojiText("homem", interaction.guild)} Selecione o resultado final. O sistema vai validar se você é o responsável e se a ação está iniciada.`,
          `${systemEmojiText("folha", interaction.guild)} O relatório será enviado automaticamente no canal configurado.`
        ].join("\n") },
        row
      ]
    }],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  });
}

async function finishActionFromButton(interaction: any, context: BotContext, token: string) {
  await interaction.deferReply({ ephemeral: true });
  const [sessionId, resultRaw] = token.split("|");
  const result = resultRaw as "victory" | "defeat";
  if (!sessionId || !["victory", "defeat"].includes(result)) return void await interaction.editReply("Resultado inválido.");
  await completeAction(interaction, context, sessionId, result, {});
}

async function showFinishModal(interaction: StringSelectMenuInteraction, context: BotContext, sessionId: string) {
  void resetSelectMenuMessage(interaction);
  const result = interaction.values[0] as "victory" | "defeat" | "draw";
  const resultLabel = result === "victory" ? "Vitória" : result === "defeat" ? "Derrota" : "Empate";
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:finish_modal:${sessionId}|${result}`)
    .setTitle(`Resultado: ${resultLabel}`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("summary").setLabel("Resumo").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("note").setLabel("Observação").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("occurrence").setLabel("Ocorrência").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000))
    );
  await interaction.showModal(modal);
}

async function finishAction(interaction: ModalSubmitInteraction, context: BotContext, token: string) {
  await interaction.deferReply({ ephemeral: true });
  const [sessionId, resultRaw] = token.split("|");
  const result = resultRaw as "victory" | "defeat" | "draw";
  if (!sessionId || !["victory", "defeat", "draw"].includes(result)) return void await interaction.editReply("Resultado inválido.");
  await completeAction(interaction, context, sessionId, result, {
    note: interaction.fields.getTextInputValue("note") || null,
    occurrence: interaction.fields.getTextInputValue("occurrence") || null,
    summary: interaction.fields.getTextInputValue("summary") || null
  });
}

async function completeAction(
  interaction: { editReply: (options: any) => Promise<unknown>; guild: any; user: { id: string } },
  context: BotContext,
  sessionId: string,
  result: "victory" | "defeat" | "draw",
  details: { note?: string | null; occurrence?: string | null; summary?: string | null }
) {
  let session: FivemActionSession;
  try {
    session = await context.api.finishFivemActionSession(sessionId, interaction.user.id, result, {
      note: details.note ?? null,
      occurrence: details.occurrence ?? null,
      summary: details.summary ?? null
    });
  } catch (error) {
    await interaction.editReply(`Não foi possível salvar o resultado: ${publicErrorMessage(error)}`);
    return;
  }

  const postSaveErrors: string[] = [];
  await refreshSessionMessage(interaction, session).catch((error) => {
    console.warn("[fivem-actions] resultado salvo, mas falhou ao atualizar painel:", errorMessage(error));
    postSaveErrors.push("não consegui atualizar o painel da ação");
  });
  await sendReport(interaction, context, session).catch((error) => {
    console.warn("[fivem-actions] resultado salvo, mas falhou ao enviar relatório:", errorMessage(error));
    postSaveErrors.push("não consegui enviar o relatório");
  });

  const warning = postSaveErrors.length ? ` Aviso: ${postSaveErrors.join(" e ")}.` : "";
  await interaction.editReply(`Ação encerrada com ${resultLabel(result).toLowerCase()}.${warning}`);
}

async function refreshSessionMessage(interaction: any, session: FivemActionSession) {
  if (!session.channelId || !session.messageId) return;
  const channel = await interaction.guild.channels.fetch(session.channelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return;
  const message = await channel.messages.fetch(session.messageId).catch(() => null);
  if (message) await message.edit(sessionPayload(session, interaction.guild));
}

async function sendReport(interaction: { guild: any }, context: BotContext, session: FivemActionSession) {
  const dashboard = await context.api.getFivemActionDashboard(session.guildId, session.architecture);
  let channel = dashboard.settings.reportChannelId ? await interaction.guild!.channels.fetch(dashboard.settings.reportChannelId).catch(() => null) : null;
  if (!channel) channel = await interaction.guild!.channels.create({ name: "relatorio-de-acoes", type: ChannelType.GuildText, parent: dashboard.settings.categoryId ?? undefined, reason: "Relatórios do Sistema de Ações" });
  if (!channel.isTextBased() || channel.isDMBased()) return;
  const active = session.participants.filter((item) => !item.leftAt);
  const duration = Math.max(0, Math.round(((session.finishedAt ? Date.parse(session.finishedAt) : Date.now()) - Date.parse(session.startedAt ?? session.createdAt)) / 60000));
  const members = active.length ? active.filter((item) => item.position === "confirmed").map((item) => `• ${item.username} (<@${item.userId}>)`).join("\n") : "Nenhum participante.";
  const finishedAt = session.finishedAt ? new Date(session.finishedAt) : new Date();
  await channel.send({ components: [{ type: 17, accent_color: session.status === "victory" ? 0x22c55e : session.status === "draw" ? 0xf59e0b : 0xef4444, components: [{ type: 10, content: [
    `# ${systemEmojiText("bandeira", interaction.guild)} Resultado da Ação`,
    "━━━━━━━━━━━━━━━━━━━━━━",
    `## ${systemEmojiText("arma", interaction.guild)} Ação`,
    session.actionName,
    "",
    `## ${systemEmojiText("acessar", interaction.guild)} Modo`,
    actionModeLabel(session.mode),
    "",
    `## ${systemEmojiText("homem", interaction.guild)} Participantes`,
    String(active.filter((item) => item.position === "confirmed").length),
    "",
    `## ${systemEmojiText("prancheta", interaction.guild)} Lista`,
    members,
    "",
    `## ${systemEmojiText("trofeu", interaction.guild)} Resultado`,
    resultText(session, interaction.guild),
    "",
    `## ${systemEmojiText("prancheta", interaction.guild)} Resumo`,
    session.resultSummary || "-",
    "",
    `## ${systemEmojiText("folha", interaction.guild)} Observações`,
    session.resultNote || "-",
    "",
    `## ${systemEmojiText("alerta", interaction.guild)} Ocorrência`,
    session.resultOccurrence || "-",
    "",
    `## ${systemEmojiText("calendario", interaction.guild)} Data`,
    finishedAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    "",
    `## ${systemEmojiText("relogio", interaction.guild)} Hora`,
    finishedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }),
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
    `Tempo total: ${duration} minutos`
  ].join("\n") }] }], flags: MessageFlags.IsComponentsV2 });
}

function sessionPayload(session: FivemActionSession, guild: Parameters<typeof systemEmojiText>[1] = null) {
  const active = session.participants.filter((item) => !item.leftAt);
  const confirmed = active.filter((item) => item.position === "confirmed");
  const reserves = active.filter((item) => item.position === "reserve");
  const terminal = ["victory", "defeat", "draw", "cancelled"].includes(session.status);
  const status = actionStatusLabel(session.status, guild);
  const rows = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:join:${session.id}`).setLabel("Entrar").setEmoji(systemComponentEmoji("visto", guild)).setStyle(ButtonStyle.Success).setDisabled(session.status !== "forming"),
      new ButtonBuilder().setCustomId(`${PREFIX}:leave:${session.id}`).setLabel("Sair").setEmoji(systemComponentEmoji("porta", guild)).setStyle(ButtonStyle.Secondary).setDisabled(session.status !== "forming"),
      new ButtonBuilder().setCustomId(`${PREFIX}:start:${session.id}`).setLabel("Iniciar ação").setEmoji("🚔").setStyle(ButtonStyle.Primary).setDisabled(session.status !== "forming")
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:cancel:${session.id}`).setLabel("Cancelar ação").setEmoji(systemComponentEmoji("exclamacao", guild)).setStyle(ButtonStyle.Danger).setDisabled(terminal),
      new ButtonBuilder().setCustomId(`${PREFIX}:result:${session.id}`).setLabel("Resultado").setEmoji(systemComponentEmoji("trofeu", guild)).setStyle(ButtonStyle.Success).setDisabled(session.status !== "active")
    )
  ];
  const confirmedList = numberedList(confirmed, session.maxParticipants);
  const reserveList = reserves.length ? reserves.map((item, index) => `${index + 1}. ${item.username}`).join("\n") : "Nenhum";
  const createdAt = new Date(session.createdAt ?? session.startedAt ?? Date.now());
  const startedAt = session.startedAt ? new Date(session.startedAt) : null;
  const title = session.architecture === "police" ? "Sistema de Ação — Polícia" : "Sistema de Ação — FAC";
  const details = { type: 10, content: [
    replaceSystemEmojis(`# ${session.actionEmoji ?? systemEmojiText("arma", guild)} ${title}`, guild),
    `${systemEmojiText("folha", guild)} Acompanhe a ação e gerencie sua participação.`,
    "━━━━━━━━━━━━━━━━━━━━━━",
    `## ${systemEmojiText("prancheta", guild)} Detalhes`,
    replaceSystemEmojis(`${session.actionEmoji ?? systemEmojiText("arma", guild)} Ação: ${session.actionName}`, guild),
    `${systemEmojiText("acessar", guild)} Modo: ${actionModeLabel(session.mode)}`,
    `${systemEmojiText("homem", guild)} Comando: <@${session.openerId}>`,
    `${systemEmojiText("calendario", guild)} Criada em: ${createdAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
    startedAt ? `${systemEmojiText("relogio", guild)} Iniciada em: ${startedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : null,
    session.cancelledAt ? `${systemStatusEmoji("danger", guild)} Cancelada em: ${new Date(session.cancelledAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : null,
    `${systemEmojiText("homem", guild)} Limite: ${confirmed.length}/${session.maxParticipants}`,
    `Status: ${status}`,
    session.sheetSyncStatus ? `${systemEmojiText("folha", guild)} Planilha: ${sheetStatus(session)}` : null,
    "",
    `${systemEmojiText("discord", guild)} ID da Ação`,
    `#${session.id.slice(0, 8).toUpperCase()}`,
    "━━━━━━━━━━━━━━━━━━━━━━",
    `## ${systemEmojiText("visto", guild)} Confirmados`,
    confirmedList,
    "━━━━━━━━━━━━━━━━━━━━━━",
    `## ${systemEmojiText("relogio", guild)} Reservas`,
    reserveList,
    "━━━━━━━━━━━━━━━━━━━━━━",
    `## ${systemEmojiText("acessar", guild)} Participar da ação`,
    "Entre como Titular",
    "(Reserva se lotar)",
    "",
    `## ${systemEmojiText("porta", guild)} Sair da ação`,
    "Sai da ação e atualiza automaticamente.",
    "━━━━━━━━━━━━━━━━━━━━━━",
    session.actionDescription || "Nome do Sistema"
  ].filter(Boolean).join("\n") };
  const image = session.actionImageUrl ? [{ type: 12, items: [{ media: { url: session.actionImageUrl } }] }] : [];
  return { components: [{ type: 17, accent_color: session.status === "victory" ? 0x22c55e : session.status === "draw" ? 0xf59e0b : session.status === "defeat" || session.status === "cancelled" ? 0xef4444 : parseColor(session.actionColor), components: [details, ...image, ...rows] }], flags: MessageFlags.IsComponentsV2 as const };
}

function numberedList(items: FivemActionSession["participants"], limit: number) {
  const rows = Array.from({ length: Math.max(limit, items.length) }, (_, index) => {
    const participant = items[index];
    return `${index + 1}. ${participant ? participant.username : ""}`;
  });
  return rows.join("\n") || "Nenhum";
}

function actionModeLabel(mode: FivemActionMode | null | undefined) {
  if (mode === "shootout") return "No tiro";
  if (mode === "escape") return "Na fuga";
  return "Não informado";
}

function actionStatusLabel(status: FivemActionSession["status"], guild: Parameters<typeof systemStatusEmoji>[1] = null) {
  if (status === "forming") return `${systemStatusEmoji("pending", guild)} Aguardando participantes`;
  if (status === "active") return `${systemStatusEmoji("pending", guild)} Em andamento`;
  if (status === "victory") return `${systemStatusEmoji("success", guild)} Finalizada - Vitória`;
  if (status === "defeat") return `${systemStatusEmoji("danger", guild)} Finalizada - Derrota`;
  if (status === "draw") return `⚪ Finalizada - Empate`;
  return `${systemStatusEmoji("danger", guild)} Cancelada`;
}

function resultLabel(result: "victory" | "defeat" | "draw") {
  return result === "victory" ? "Vitória" : result === "defeat" ? "Derrota" : "Empate";
}

function resultText(session: FivemActionSession, guild: Parameters<typeof systemStatusEmoji>[1] = null) {
  if (session.status === "victory") return `${systemStatusEmoji("success", guild)} Vitória`;
  if (session.status === "defeat") return `${systemStatusEmoji("danger", guild)} Derrota`;
  if (session.status === "draw") return "⚪ Empate";
  return "-";
}

function sheetStatus(session: FivemActionSession) {
  if (session.sheetSyncStatus === "synced") return session.sheetRow ? `#${session.sheetRow}` : "sincronizada";
  if (session.sheetSyncStatus === "failed") return `erro${session.sheetSyncError ? ` - ${session.sheetSyncError.slice(0, 80)}` : ""}`;
  return "criando/atualizando";
}

function canManageActionsFromDiscord(interaction: { member?: unknown; memberPermissions?: { has(permission: bigint): boolean } | null }, settings?: Pick<FivemActionSettings, "managerRoleIds"> | null) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const allowed = settings?.managerRoleIds?.filter(Boolean) ?? [];
  if (!allowed.length) return false;
  const roles = (interaction.member as { roles?: { cache?: { has(id: string): boolean }; includes?(id: string): boolean } | string[] } | null)?.roles;
  if (Array.isArray(roles)) return allowed.some((roleId) => roles.includes(roleId));
  return allowed.some((roleId) => roles?.cache?.has(roleId) || roles?.includes?.(roleId));
}

async function refreshFivemActionRuntimeModules(context: BotContext) {
  const runtime = await context.api.getRuntimeModules();
  setRuntimeEnabledModules(runtime.active ? runtime.enabledModules : [], runtime.botId);
}

async function getPanelVisualSlots(context: BotContext, guildId: string, basePanelId: string) {
  const panelIds = [basePanelId, `${basePanelId}-banner-2`, `${basePanelId}-banner-3`];
  const visuals = await Promise.all(panelIds.map((panelId) => context.api.getPanelVisualSettings(guildId, panelId).catch(() => null)));

  return visuals.flatMap((visual, index): PanelVisualConfig[] => {
    if (!visual?.imageEnabled || !visual.imageUrl) return [];
    if (index > 0 && visual.useGlobalDefault) return [];
    return [{ blocks: visual.blocks ?? [], imageEnabled: visual.imageEnabled, imagePosition: visual.imagePosition, imageUrl: resolvePanelImageUrl(visual.imageUrl) ?? visual.imageUrl }];
  });
}

function actionImagePosition(position: PanelVisualConfig["imagePosition"]): FivemActionSettings["imagePosition"] {
  if (position === "top" || position === "banner") return "top";
  if (position === "middle" || position === "below_title" || position === "below_text" || position === "before_buttons" || position === "above_buttons") return "center";
  if (position === "none") return "none";
  return "bottom";
}

function mediaBlock(url: string, description: string) {
  return { type: 12, items: [{ media: { url }, description }] };
}

function isFivemActionRuntimeEnabled(architecture?: FivemActionArchitecture) {
  if (architecture) return isBotModuleEnabled(MODULE_BY_ARCHITECTURE[architecture]);
  return isBotModuleEnabled(MODULE_BY_ARCHITECTURE.fac) || isBotModuleEnabled(MODULE_BY_ARCHITECTURE.police);
}

function parseColor(value: string) { return Number.parseInt(value.replace("#", ""), 16) || 0x7c3aed; }
function displayName(member: any) { return member?.displayName ?? member?.user?.globalName ?? member?.user?.username ?? "Usuário"; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function publicErrorMessage(error: unknown) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: unknown }; status?: unknown } }).response;
    const message = typeof response?.data?.message === "string" ? response.data.message : null;
    if (message) return message;
    if (response?.status) return `API retornou HTTP ${response.status}.`;
  }
  return errorMessage(error).slice(0, 180) || "erro desconhecido.";
}

async function replyCommandError(interaction: ChatInputCommandInteraction, content: string) {
  const payload = { content, ephemeral: true };
  if (interaction.deferred || interaction.replied) {
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ content }).catch(() => null);
      return;
    }
    await interaction.followUp(payload).catch(() => null);
    return;
  }
  await interaction.reply(payload).catch(() => null);
}

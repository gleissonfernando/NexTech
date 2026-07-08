import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuInteraction,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type GuildMember,
  type Interaction,
  type MessageCreateOptions,
  type TextBasedChannel
} from "discord.js";
import type { BotContext, GuildSettings, ReportSystemButtonKey, ReportSystemLogKey, ReportSystemSettings } from "../types";
import { getFreshGuildSettings } from "./guildSettingsCache";
import { renderComponentsV2Panel } from "./panelVisualRenderer";

const PREFIX = "iab_admin";
const PANEL_SELECT_ID = "iab_report_select";
const BUTTON_LABELS: Record<ReportSystemButtonKey, string> = {
  addMember: "Adicionar membro",
  claim: "Assumir denuncia",
  close: "Fechar denuncia",
  delete: "Excluir denuncia",
  removeMember: "Remover membro",
  reopen: "Reabrir denuncia",
  reply: "Responder",
  requestEvidence: "Solicitar provas",
  status: "Alterar status",
  transcript: "Exportar transcript"
};
const LOG_LABELS: Record<ReportSystemLogKey, string> = {
  admin: "Logs administrativos",
  anonymous: "Denuncias anonimas",
  closed: "Fechamento",
  messagesDeleted: "Mensagens apagadas",
  opened: "Abertura",
  replies: "Respostas",
  statusChanged: "Alteracao de status"
};
const ROLE_GROUPS = [
  ["viewRoleIds", "Visualizar denuncias"],
  ["replyRoleIds", "Responder denuncias"],
  ["closeRoleIds", "Fechar denuncias"],
  ["reopenRoleIds", "Reabrir denuncias"],
  ["adminRoleIds", "Administradores"],
  ["createRoleIds", "Criar denuncias"],
  ["permissionRoleIds", "Usar sistema"],
  ["mentionRoleIds", "Mencionar cargos"],
  ["statusRoleIds", "Alterar status"]
] as const;

export async function openReportSystemAdmin(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
    return;
  }

  const settings = await getFreshGuildSettings(context, interaction.guild.id, interaction.client.user?.id);
  if (!canManageReportSystem(interaction.member as GuildMember, settings.reportSystem)) {
    await interaction.reply({ content: "Apenas administradores ou cargos configurados podem acessar este painel.", ephemeral: true });
    return;
  }

  await interaction.reply({ ...createAdminPayload(settings, "overview"), ephemeral: true });
}

export async function handleReportSystemInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.guild || !interaction.isRepliable()) return false;

  if (interaction.isStringSelectMenu() && interaction.customId === PANEL_SELECT_ID) {
    await interaction.reply({ content: "O fluxo de abertura da denuncia sera iniciado por este painel. Configure o sistema em /sistema.", ephemeral: true });
    return true;
  }

  if (!("customId" in interaction) || !String(interaction.customId).startsWith(PREFIX)) return false;

  const settings = await getFreshGuildSettings(context, interaction.guild.id, interaction.client.user?.id);
  if (!interaction.member || !canManageReportSystem(interaction.member as GuildMember, settings.reportSystem)) {
    await interaction.reply({ content: "Voce nao tem permissao para configurar este sistema.", ephemeral: true });
    return true;
  }

  const [, action, target] = String(interaction.customId).split(":");

  if (interaction.isButton()) {
    if (action === "modal") {
      await interaction.showModal(createModal(target ?? "panel", settings.reportSystem));
      return true;
    }
    if (action === "toggle") {
      const next = patchToggle(settings.reportSystem, target ?? "");
      await saveAndRefresh(interaction, context, settings, next, "overview");
      return true;
    }
    if (action === "publish") {
      await interaction.update(createPublishPayload(settings));
      return true;
    }
  }

  if (interaction.isStringSelectMenu()) {
    if (action === "section") {
      await interaction.update(createAdminPayload(settings, interaction.values[0] ?? "overview"));
      return true;
    }
    if (action === "buttons") {
      const enabled = new Set(interaction.values);
      await saveAndRefresh(interaction, context, settings, { buttons: mapFromKeys(Object.keys(settings.reportSystem.buttons), enabled) as ReportSystemSettings["buttons"] }, "buttons");
      return true;
    }
    if (action === "logs") {
      const enabled = new Set(interaction.values);
      await saveAndRefresh(interaction, context, settings, { logs: mapFromKeys(Object.keys(settings.reportSystem.logs), enabled) as ReportSystemSettings["logs"] }, "logs");
      return true;
    }
    if (action === "category") {
      await handleCategoryAction(interaction, context, settings, interaction.values[0] ?? "");
      return true;
    }
    if (action === "status") {
      await handleStatusAction(interaction, context, settings, interaction.values[0] ?? "");
      return true;
    }
  }

  if (interaction.isChannelSelectMenu()) {
    const channelId = interaction.values[0] ?? null;
    if (target === "publish-to") {
      await publishReportPanel(interaction.channel as TextBasedChannel | null, interaction, settings, channelId);
      return true;
    }
    await saveAndRefresh(interaction, context, settings, { [target ?? "panelChannelId"]: channelId }, "channels");
    return true;
  }

  if (interaction.isRoleSelectMenu()) {
    await saveAndRefresh(interaction, context, settings, { [target ?? "viewRoleIds"]: interaction.values }, "roles");
    return true;
  }

  if (interaction.isModalSubmit()) {
    await handleModal(interaction, context, settings, action ?? "");
    return true;
  }

  return false;
}

function createAdminPayload(settings: GuildSettings, section: string) {
  const report = settings.reportSystem;
  const fields = [
    `Sistema: **${report.enabled ? "ativo" : "inativo"}**`,
    `Painel: ${report.panelChannelId ? `<#${report.panelChannelId}>` : "nao definido"}`,
    `Categoria: ${report.categoryId ? `<#${report.categoryId}>` : "nao definida"}`,
    `Categorias: **${report.categories.length}** | Status: **${report.statuses.length}**`,
    sectionText(section, report)
  ];

  return renderComponentsV2Panel({
    accentColor: parseColor(report.panelColor),
    actions: sectionActions(section, report),
    description: "Configure o Sistema de Denuncias IAB/Corregedoria diretamente pelo Discord. As alteracoes sao salvas na mesma configuracao usada pela dashboard.",
    fields,
    image: null,
    moduleId: "iab-admin",
    title: `${report.panelEmoji ?? "IAB"} ${report.name || "Sistema de Denuncias"}`
  });
}

function sectionActions(section: string, report: ReportSystemSettings) {
  const rows: unknown[] = [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}:section`)
        .setPlaceholder("Escolha a area de configuracao")
        .addOptions([
          option("overview", "Resumo"),
          option("panel", "Painel de denuncias"),
          option("channels", "Canais"),
          option("roles", "Cargos"),
          option("categories", "Tipos de denuncia"),
          option("anonymity", "Anonimato"),
          option("permissions", "Permissoes"),
          option("status", "Status"),
          option("buttons", "Botoes"),
          option("logs", "Logs"),
          option("publish", "Publicar painel")
        ])
    )
  ];

  if (section === "panel") rows.push(buttonRow([["modal:panel", "Editar painel", ButtonStyle.Primary], ["toggle:enabled", report.enabled ? "Desativar" : "Ativar", ButtonStyle.Secondary]]));
  if (section === "channels") rows.push(...channelRows());
  if (section === "roles") rows.push(...roleRows(report, 0));
  if (section === "permissions") rows.push(...roleRows(report, 5));
  if (section === "categories") rows.push(categoryRow(report), buttonRow([["modal:category-new", "Adicionar tipo", ButtonStyle.Primary]]));
  if (section === "anonymity") rows.push(buttonRow([["modal:anonymity", "Editar anonimato", ButtonStyle.Primary], ["toggle:anonymousReports", report.allowAnonymousReports ? "Bloquear anonimas" : "Permitir anonimas", ButtonStyle.Secondary], ["toggle:anonymousStaff", report.allowAnonymousStaffReplies ? "Bloquear equipe anonima" : "Permitir equipe anonima", ButtonStyle.Secondary]]));
  if (section === "status") rows.push(statusRow(report), buttonRow([["modal:status-new", "Adicionar status", ButtonStyle.Primary]]));
  if (section === "buttons") rows.push(multiToggleRow(`${PREFIX}:buttons`, "Botoes exibidos", BUTTON_LABELS, report.buttons));
  if (section === "logs") rows.push(multiToggleRow(`${PREFIX}:logs`, "Logs ativos", LOG_LABELS, report.logs));
  if (section === "publish") rows.push(buttonRow([["publish", "Publicar Painel", ButtonStyle.Success]]));

  return rows;
}

function sectionText(section: string, report: ReportSystemSettings) {
  if (section === "channels") return "Selecione canais e categoria usando os menus abaixo.";
  if (section === "roles") return "Defina cargos administrativos e operacionais. Administradores do Discord sempre podem acessar.";
  if (section === "categories") return report.categories.map((item) => `${item.enabled ? "ON" : "OFF"} ${item.emoji ?? ""} **${item.name}**`).join("\n");
  if (section === "anonymity") return `Denuncias anonimas: **${report.allowAnonymousReports ? "sim" : "nao"}**\nRespostas anonimas da equipe: **${report.allowAnonymousStaffReplies ? "sim" : "nao"}**`;
  if (section === "status") return report.statuses.map((item) => `**${item.order}.** ${item.name}`).join("\n");
  if (section === "buttons") return "Marque os botoes que devem aparecer nas denuncias.";
  if (section === "logs") return "Marque quais eventos serao enviados aos canais de log/auditoria.";
  if (section === "publish") return "Clique em Publicar Painel e escolha o canal onde o painel de denuncias sera enviado.";
  return `Titulo: **${report.panelTitle}**\nDescricao: ${report.panelDescription.slice(0, 220)}`;
}

function channelRows() {
  return [
    channelRow("panelChannelId", "Canal do painel", [ChannelType.GuildText, ChannelType.GuildAnnouncement]),
    channelRow("categoryId", "Categoria das denuncias", [ChannelType.GuildCategory]),
    channelRow("logChannelId", "Canal de logs", [ChannelType.GuildText, ChannelType.GuildAnnouncement]),
    channelRow("transcriptChannelId", "Canal de transcripts", [ChannelType.GuildText, ChannelType.GuildAnnouncement]),
    channelRow("auditChannelId", "Canal de auditoria", [ChannelType.GuildText, ChannelType.GuildAnnouncement])
  ];
}

function roleRows(report: ReportSystemSettings, offset: number) {
  return ROLE_GROUPS.slice(offset, offset + 5).map(([key, label]) => new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder().setCustomId(`${PREFIX}:roles:${key}`).setPlaceholder(`${label} (${report[key].length})`).setMinValues(0).setMaxValues(10)
  ));
}

function categoryRow(report: ReportSystemSettings) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PREFIX}:category`)
      .setPlaceholder("Editar, remover ou reordenar tipo")
      .addOptions(report.categories.flatMap((item) => [
        option(`edit:${item.id}`, `Editar ${item.name}`),
        option(`toggle:${item.id}`, `${item.enabled ? "Desativar" : "Ativar"} ${item.name}`),
        option(`up:${item.id}`, `Subir ${item.name}`),
        option(`down:${item.id}`, `Descer ${item.name}`),
        option(`delete:${item.id}`, `Remover ${item.name}`)
      ]).slice(0, 25))
  );
}

function statusRow(report: ReportSystemSettings) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PREFIX}:status`)
      .setPlaceholder("Editar, remover ou reordenar status")
      .addOptions(report.statuses.flatMap((item) => [
        option(`edit:${item.id}`, `Editar ${item.name}`),
        option(`up:${item.id}`, `Subir ${item.name}`),
        option(`down:${item.id}`, `Descer ${item.name}`),
        option(`delete:${item.id}`, `Remover ${item.name}`)
      ]).slice(0, 25))
  );
}

function createModal(kind: string, report: ReportSystemSettings) {
  const modal = new ModalBuilder().setCustomId(`${PREFIX}:${kind}`).setTitle("Sistema de Denuncias");
  if (kind === "panel") {
    return modal.addComponents(
      inputRow("panelTitle", "Titulo", report.panelTitle, TextInputStyle.Short, 120),
      inputRow("panelDescription", "Descricao", report.panelDescription, TextInputStyle.Paragraph, 1000),
      inputRow("panelColor", "Cor da embed (#RRGGBB)", report.panelColor, TextInputStyle.Short, 7),
      inputRow("panelPlaceholder", "Placeholder do menu", report.panelPlaceholder, TextInputStyle.Short, 120),
      inputRow("footerText", "Footer", report.footerText ?? "", TextInputStyle.Short, 180)
    );
  }
  if (kind === "anonymity") {
    return modal.addComponents(
      inputRow("anonymousReporterName", "Nome do denunciante anonimo", report.anonymousReporterName, TextInputStyle.Short, 80),
      inputRow("anonymousInvestigatorName", "Nome dos investigadores", report.anonymousInvestigatorName, TextInputStyle.Short, 80),
      inputRow("anonymousAvatarUrl", "Avatar anonimo (URL)", report.anonymousAvatarUrl ?? "", TextInputStyle.Short, 2048, false),
      inputRow("anonymousEmbedColor", "Cor das embeds anonimas", report.anonymousEmbedColor, TextInputStyle.Short, 7),
      inputRow("openMessage", "Mensagem padrao de abertura", report.openMessage, TextInputStyle.Paragraph, 1000)
    );
  }
  if (kind === "category-new") {
    return modal.addComponents(inputRow("name", "Nome", "", TextInputStyle.Short, 80), inputRow("emoji", "Emoji", "", TextInputStyle.Short, 80, false), inputRow("description", "Descricao", "", TextInputStyle.Short, 100, false), inputRow("color", "Cor", "#dc2626", TextInputStyle.Short, 7), inputRow("channelOrCategoryId", "Canal/categoria especifica (ID)", "", TextInputStyle.Short, 32, false));
  }
  if (kind === "status-new") {
    return modal.addComponents(inputRow("name", "Nome", "", TextInputStyle.Short, 80), inputRow("color", "Cor", "#64748b", TextInputStyle.Short, 7));
  }
  const [, id] = kind.split("-");
  const category = report.categories.find((item) => item.id === id);
  if (kind.startsWith("category-edit") && category) {
    return modal.addComponents(inputRow("name", "Nome", category.name, TextInputStyle.Short, 80), inputRow("emoji", "Emoji", category.emoji ?? "", TextInputStyle.Short, 80, false), inputRow("description", "Descricao", category.description ?? "", TextInputStyle.Short, 100, false), inputRow("color", "Cor", category.color, TextInputStyle.Short, 7), inputRow("channelOrCategoryId", "Canal/categoria especifica (ID)", category.channelOrCategoryId ?? "", TextInputStyle.Short, 32, false));
  }
  const status = report.statuses.find((item) => item.id === id);
  if (kind.startsWith("status-edit") && status) {
    return modal.addComponents(inputRow("name", "Nome", status.name, TextInputStyle.Short, 80), inputRow("color", "Cor", status.color, TextInputStyle.Short, 7));
  }
  return modal.addComponents(inputRow("infoMessage", "Mensagem informativa", report.infoMessage, TextInputStyle.Paragraph, 1800));
}

async function handleModal(interaction: ModalSubmitInteraction, context: BotContext, settings: GuildSettings, action: string) {
  const report = settings.reportSystem;
  const value = (id: string) => interaction.fields.getTextInputValue(id).trim();
  if (action === "panel") {
    await saveAndRefresh(interaction, context, settings, { footerText: value("footerText") || null, panelColor: value("panelColor"), panelDescription: value("panelDescription"), panelPlaceholder: value("panelPlaceholder"), panelTitle: value("panelTitle") }, "panel");
    return;
  }
  if (action === "anonymity") {
    await saveAndRefresh(interaction, context, settings, { anonymousAvatarUrl: value("anonymousAvatarUrl") || null, anonymousEmbedColor: value("anonymousEmbedColor"), anonymousInvestigatorName: value("anonymousInvestigatorName"), anonymousReporterName: value("anonymousReporterName"), openMessage: value("openMessage") }, "anonymity");
    return;
  }
  if (action === "category-new") {
    const name = value("name");
    await saveAndRefresh(interaction, context, settings, { categories: [...report.categories, { channelOrCategoryId: value("channelOrCategoryId") || null, color: value("color") || "#dc2626", description: value("description") || null, emoji: value("emoji") || null, enabled: true, id: slug(name), name, order: report.categories.length + 1 }] }, "categories");
    return;
  }
  if (action.startsWith("category-edit-")) {
    const id = action.replace("category-edit-", "");
    await saveAndRefresh(interaction, context, settings, {
      categories: report.categories.map((item) => item.id === id
        ? { ...item, channelOrCategoryId: value("channelOrCategoryId") || null, color: value("color") || item.color, description: value("description") || null, emoji: value("emoji") || null, name: value("name") || item.name }
        : item)
    }, "categories");
    return;
  }
  if (action === "status-new") {
    const name = value("name");
    await saveAndRefresh(interaction, context, settings, { statuses: [...report.statuses, { color: value("color") || "#64748b", id: slug(name), name, order: report.statuses.length + 1 }] }, "status");
    return;
  }
  if (action.startsWith("status-edit-")) {
    const id = action.replace("status-edit-", "");
    await saveAndRefresh(interaction, context, settings, {
      statuses: report.statuses.map((item) => item.id === id ? { ...item, color: value("color") || item.color, name: value("name") || item.name } : item)
    }, "status");
    return;
  }
  await interaction.reply({ content: "Modal nao reconhecido.", ephemeral: true });
}

async function handleCategoryAction(interaction: StringSelectMenuInteraction, context: BotContext, settings: GuildSettings, selected: string) {
  const [op, id] = selected.split(":");
  const categories = [...settings.reportSystem.categories];
  const index = categories.findIndex((item) => item.id === id);
  if (index < 0) return interaction.update(createAdminPayload(settings, "categories"));
  if (op === "edit") return interaction.showModal(createModal(`category-edit-${id}`, settings.reportSystem));
  if (op === "delete") categories.splice(index, 1);
  if (op === "toggle") {
    const current = categories[index];
    if (current) categories[index] = { ...current, enabled: !current.enabled };
  }
  if (op === "up" && index > 0) {
    const current = categories[index];
    const previous = categories[index - 1];
    if (current && previous) [categories[index - 1], categories[index]] = [current, previous];
  }
  if (op === "down" && index < categories.length - 1) {
    const current = categories[index];
    const next = categories[index + 1];
    if (current && next) [categories[index + 1], categories[index]] = [current, next];
  }
  await saveAndRefresh(interaction, context, settings, { categories: categories.map((item, order) => ({ ...item, order: order + 1 })) }, "categories");
}

async function handleStatusAction(interaction: StringSelectMenuInteraction, context: BotContext, settings: GuildSettings, selected: string) {
  const [op, id] = selected.split(":");
  const statuses = [...settings.reportSystem.statuses];
  const index = statuses.findIndex((item) => item.id === id);
  if (index < 0) return interaction.update(createAdminPayload(settings, "status"));
  if (op === "edit") return interaction.showModal(createModal(`status-edit-${id}`, settings.reportSystem));
  if (op === "delete") statuses.splice(index, 1);
  if (op === "up" && index > 0) {
    const current = statuses[index];
    const previous = statuses[index - 1];
    if (current && previous) [statuses[index - 1], statuses[index]] = [current, previous];
  }
  if (op === "down" && index < statuses.length - 1) {
    const current = statuses[index];
    const next = statuses[index + 1];
    if (current && next) [statuses[index + 1], statuses[index]] = [current, next];
  }
  await saveAndRefresh(interaction, context, settings, { statuses: statuses.map((item, order) => ({ ...item, order: order + 1 })) }, "status");
}

async function saveAndRefresh(interaction: Interaction, context: BotContext, settings: GuildSettings, patch: Partial<ReportSystemSettings>, section: string) {
  const next = await context.api.updateSettingsFromBot(settings.guildId, { reportSystem: { ...settings.reportSystem, ...patch } as ReportSystemSettings });
  const payload = createAdminPayload(next, section);
  if (interaction.isMessageComponent()) await interaction.update(payload);
  else if (interaction.isModalSubmit()) await interaction.reply({ ...payload, ephemeral: true });
}

function createPublishPayload(settings: GuildSettings) {
  return renderComponentsV2Panel({
    accentColor: parseColor(settings.reportSystem.panelColor),
    actions: [channelRow("publish-to", "Canal para publicar", [ChannelType.GuildText, ChannelType.GuildAnnouncement])],
    description: "Selecione o canal onde o painel de denuncias sera publicado.",
    fields: [],
    image: null,
    moduleId: "iab-publish",
    title: "Publicar Painel"
  });
}

async function publishReportPanel(_: TextBasedChannel | null, interaction: ChannelSelectMenuInteraction, settings: GuildSettings, channelId: string | null) {
  const channel = channelId ? await interaction.guild?.channels.fetch(channelId).catch(() => null) : null;
  if (!channel?.isTextBased() || !("send" in channel)) {
    await interaction.reply({ content: "Selecione um canal de texto valido.", ephemeral: true });
    return;
  }
  await channel.send(createReportPanelPayload(settings));
  await interaction.update(createAdminPayload(settings, "publish"));
}

function createReportPanelPayload(settings: GuildSettings): MessageCreateOptions {
  const report = settings.reportSystem;
  const options = report.categories.filter((item) => item.enabled).slice(0, 25).map((item) => {
    const optionBuilder = new StringSelectMenuOptionBuilder().setLabel(item.name).setValue(item.id);
    if (item.description) optionBuilder.setDescription(item.description);
    if (item.emoji) optionBuilder.setEmoji(item.emoji);
    return optionBuilder;
  });
  const action = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(PANEL_SELECT_ID).setPlaceholder(report.panelPlaceholder).addOptions(options));
  return renderComponentsV2Panel({
    accentColor: parseColor(report.panelColor),
    actions: [action],
    description: report.panelDescription,
    fields: [report.infoMessage, report.footerText ? `-# ${report.footerText}` : ""].filter(Boolean),
    image: report.imageUrl ? { imageEnabled: true, imagePosition: "banner", imageUrl: report.imageUrl } : null,
    moduleId: "iab-panel",
    title: `${report.panelEmoji ?? ""} ${report.panelTitle}`.trim()
  });
}

function canManageReportSystem(member: GuildMember, report: ReportSystemSettings) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return report.adminRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

function patchToggle(report: ReportSystemSettings, target: string): Partial<ReportSystemSettings> {
  if (target === "enabled") return { enabled: !report.enabled };
  if (target === "anonymousReports") return { allowAnonymousReports: !report.allowAnonymousReports };
  if (target === "anonymousStaff") return { allowAnonymousStaffReplies: !report.allowAnonymousStaffReplies };
  return {};
}

function mapFromKeys(keys: string[], enabled: Set<string>) {
  return Object.fromEntries(keys.map((key) => [key, enabled.has(key)]));
}

function option(value: string, label: string) {
  return new StringSelectMenuOptionBuilder().setLabel(label.slice(0, 100)).setValue(value.slice(0, 100));
}

function buttonRow(items: Array<[string, string, ButtonStyle]>) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(items.map(([id, label, style]) => new ButtonBuilder().setCustomId(`${PREFIX}:${id}`).setLabel(label).setStyle(style)));
}

function channelRow(key: string, placeholder: string, channelTypes: ChannelType[]) {
  return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId(`${PREFIX}:channels:${key}`).setPlaceholder(placeholder).setChannelTypes(...channelTypes).setMinValues(1).setMaxValues(1));
}

function multiToggleRow<T extends string>(customId: string, placeholder: string, labels: Record<T, string>, current: Record<T, boolean>) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .setMinValues(0)
      .setMaxValues(Object.keys(labels).length)
      .addOptions(Object.entries(labels).map(([key, label]) => new StringSelectMenuOptionBuilder().setLabel(String(label)).setValue(key).setDefault(Boolean(current[key as T]))))
  );
}

function inputRow(id: string, label: string, value: string, style: TextInputStyle, maxLength: number, required = true) {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setMaxLength(maxLength).setRequired(required).setValue(value.slice(0, maxLength)));
}

function slug(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || `item-${Date.now()}`;
}

function parseColor(value: string | null | undefined) {
  const parsed = Number.parseInt(value?.replace("#", "") ?? "", 16);
  return Number.isFinite(parsed) ? parsed : 0xdc2626;
}

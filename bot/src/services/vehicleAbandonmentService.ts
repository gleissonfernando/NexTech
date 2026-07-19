import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, TextInputBuilder, TextInputStyle, type ChatInputCommandInteraction, type GuildMember, type Interaction, type Message, type MessageCreateOptions } from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import type { BotCommand, BotContext } from "../types";
import type { VehicleAbandonmentRecord, VehicleAbandonmentSettings } from "./apiClient";

const MODULE_ID = "vehicle-abandonment";
const PREFIX = "vehicle_abandonment";
const SETTINGS_TTL_MS = 30_000;
const PENDING_TTL_MS = 10 * 60_000;
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

type ParsedReport = {
  model: string | null;
  plate: string | null;
  report: string | null;
};

type CompleteParsedReport = {
  model: string;
  plate: string;
  report: string;
};

type RenderAuthor = {
  id: string;
  name: string;
};

type PendingRecord = {
  createdAt: number;
  imageUrls: string[];
  message: Message;
  parsed: CompleteParsedReport;
  settings: VehicleAbandonmentSettings;
};

const settingsCache = new Map<string, { expiresAt: number; settings: VehicleAbandonmentSettings }>();
const pendingRecords = new Map<string, PendingRecord>();

export const vehicleAbandonmentPanelCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("painel-explicativo")
    .setDescription("Publica o painel explicativo do sistema Abandono de Veículo."),
  moduleId: MODULE_ID,
  execute: publishExplanatoryPanelCommand
};

async function publishExplanatoryPanelCommand(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({ content: "Este comando só pode ser usado em um servidor.", ephemeral: true });
    return;
  }

  const settings = await getSettings(context, interaction.guildId);
  if (!settings.explanatoryPanelCommandEnabled) {
    await interaction.reply({ content: "O comando /painel-explicativo está desativado.", ephemeral: true });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!canUseExplanatoryPanel(member, settings)) {
    await interaction.reply({ content: "❌ Você não possui permissão para utilizar este comando.", ephemeral: true });
    return;
  }

  const targetChannelId = settings.explanatoryPanelChannelId ?? interaction.channelId;
  if (!targetChannelId) {
    await interaction.reply({ content: "Canal de envio não identificado.", ephemeral: true });
    return;
  }

  const channel = await interaction.guild.channels.fetch(targetChannelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) {
    await interaction.reply({ content: "Canal do painel explicativo inválido ou inacessível.", ephemeral: true });
    return;
  }

  const payload = explanatoryPanelPayload(settings);
  if (targetChannelId === interaction.channelId) {
    await interaction.reply(payload as any);
    return;
  }

  await channel.send(payload);
  await interaction.reply({ content: `Painel explicativo enviado em <#${targetChannelId}>.`, ephemeral: true });
}

export async function handleVehicleAbandonmentMessage(message: Message, context: BotContext) {
  if (!isBotModuleEnabled(MODULE_ID) || !message.guild || message.author.bot || message.webhookId) return false;

  const settings = await getSettings(context, message.guild.id).catch(() => null);
  if (!settings?.enabled || !settings.systemChannelId || message.channelId !== settings.systemChannelId) return false;

  const images = imageUrls(message, settings);
  if (!images.length) {
    await replyV2(message, "❌ Envie uma foto do veículo.");
    return true;
  }

  const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!hasPermission(member, settings.allowedRoleIds)) {
    await replyV2(message, "❌ Você não possui permissão para utilizar este sistema.");
    return true;
  }

  if (!settings.recordChannelId) {
    await replyV2(message, "❌ Canal de Registro não configurado.");
    return true;
  }

  const parsed = parseVehicleAbandonmentReport(message.content);
  const missing = missingFields(parsed);
  if (missing.length) {
    await replyV2(message, `❌ Campos obrigatórios ausentes:\n\n${missing.map((field) => `• ${field}`).join("\n")}`);
    return true;
  }

  const ready = parsed as CompleteParsedReport;
  if (settings.confirmationBeforeSend) {
    cleanupPending();
    pendingRecords.set(message.id, { createdAt: Date.now(), imageUrls: images, message, parsed: ready, settings });
    await message.reply({
      components: [{
        type: 17,
        accent_color: parseColor(settings.color),
        components: [
          { type: 10, content: `# ${settings.emoji} Confirmar registro\n**Veículo:** ${escapeMarkdown(ready.model)}\n**Placa:** ${escapeMarkdown(ready.plate)}\n\n${clip(ready.report, 900)}` },
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`${PREFIX}:confirm:${message.id}`).setLabel("Enviar").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`${PREFIX}:cancel:${message.id}`).setLabel("Cancelar").setStyle(ButtonStyle.Secondary)
          )
        ]
      }],
      flags: MessageFlags.IsComponentsV2
    });
    return true;
  }

  await deliverRecord(message, context, settings, ready, images);
  return true;
}

export async function handleVehicleAbandonmentInteraction(interaction: Interaction, context: BotContext) {
  if (!(interaction.isButton() || interaction.isModalSubmit()) || !interaction.customId.startsWith(`${PREFIX}:`)) return false;
  const [, action, targetId] = interaction.customId.split(":");

  if (action === "example") {
    if (!interaction.isButton()) return true;
    const settings = interaction.guildId ? await getSettings(context, interaction.guildId) : null;
    await interaction.showModal(exampleModal(settings));
    return true;
  }

  if (interaction.isModalSubmit() && action === "example_view") {
    await interaction.reply({ content: "Exemplo visualizado.", ephemeral: true });
    return true;
  }

  if (action === "cancel") {
    if (!interaction.isButton()) return true;
    const pending = targetId ? pendingRecords.get(targetId) : null;
    if (!pending) {
      await interaction.reply({ content: "Registro expirado ou já processado.", ephemeral: true });
      return true;
    }
    if (interaction.user.id !== pending.message.author.id) {
      await interaction.reply({ content: "Somente quem enviou o registro pode confirmar.", ephemeral: true });
      return true;
    }
    pendingRecords.delete(targetId!);
    await interaction.update({
      components: [{ type: 17, accent_color: 0x71717a, components: [{ type: 10, content: "Registro cancelado." }] }],
      flags: MessageFlags.IsComponentsV2
    });
    return true;
  }

  if (action === "confirm") {
    if (!interaction.isButton()) return true;
    const pending = targetId ? pendingRecords.get(targetId) : null;
    if (!pending) {
      await interaction.reply({ content: "Registro expirado ou já processado.", ephemeral: true });
      return true;
    }
    if (interaction.user.id !== pending.message.author.id) {
      await interaction.reply({ content: "Somente quem enviou o registro pode confirmar.", ephemeral: true });
      return true;
    }
    await interaction.deferUpdate();
    pendingRecords.delete(targetId!);
    await deliverRecord(pending.message, context, pending.settings, pending.parsed, pending.imageUrls);
    await interaction.message?.delete().catch(() => null);
    return true;
  }

  if (action === "edit" && targetId) {
    if (!interaction.isButton()) return true;
    const record = await context.api.getVehicleAbandonmentRecord(targetId);
    const settings = await getSettings(context, record.guildId);
    if (!settings.allowRecordEditing) {
      await interaction.reply({ content: "Edição de registros está desativada.", ephemeral: true });
      return true;
    }
    if (!canEditRecord(interaction.member as GuildMember | null, settings, record.authorId, interaction.user.id)) {
      await interaction.reply({ content: "Você não possui permissão para editar este registro.", ephemeral: true });
      return true;
    }
    await interaction.showModal(editModal(record.id, record.model, record.plate, record.report));
    return true;
  }

  if (interaction.isModalSubmit() && action === "edit_submit" && targetId) {
    await interaction.deferReply({ ephemeral: true });
    const record = await context.api.updateVehicleAbandonmentRecord(targetId, {
      model: interaction.fields.getTextInputValue("model").trim(),
      plate: interaction.fields.getTextInputValue("plate").trim(),
      report: interaction.fields.getTextInputValue("report").trim()
    });
    const settings = await getSettings(context, record.guildId);
    await updateRecordMessage(context, settings, record);
    await interaction.editReply("Registro atualizado.");
    return true;
  }

  return false;
}

export function clearVehicleAbandonmentSettingsCache(guildId?: string | null) {
  if (!guildId) {
    settingsCache.clear();
    return;
  }

  for (const key of settingsCache.keys()) {
    if (key.endsWith(`:${guildId}`)) settingsCache.delete(key);
  }
}

export function parseVehicleAbandonmentReport(content: string): ParsedReport {
  const result: ParsedReport = { model: null, plate: null, report: null };
  let currentField: keyof ParsedReport | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const detected = detectFieldLine(line);
    if (detected) {
      currentField = detected.field;
      if (detected.value) {
        appendField(result, currentField, detected.value);
      }
      continue;
    }

    if (currentField) {
      appendField(result, currentField, line);
    }
  }

  return {
    model: cleanValue(result.model, 300),
    plate: cleanValue(result.plate, 80),
    report: cleanValue(result.report, 1800)
  };
}

async function deliverRecord(
  message: Message,
  context: BotContext,
  settings: VehicleAbandonmentSettings,
  parsed: CompleteParsedReport,
  imageUrlsInput: string[]
) {
  if (!message.guild || !settings.recordChannelId) return;
  const channel = await message.guild.channels.fetch(settings.recordChannelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) {
    await replyV2(message, "❌ Canal de Registro inválido ou inacessível.");
    return;
  }

  const imageUrls = imageUrlsInput.length ? imageUrlsInput : settings.defaultImageUrl ? [settings.defaultImageUrl] : [];
  if (!imageUrls.length) {
    await replyV2(message, "❌ Envie uma foto do veículo.");
    return;
  }

  const author = { id: message.author.id, name: displayName(message) };
  const payload = recordPayload(settings, author, parsed, imageUrls, null);
  const sent = await channel.send(payload);
  const record = await context.api.createVehicleAbandonmentRecord({
    authorId: message.author.id,
    authorName: author.name,
    guildId: message.guild.id,
    imageUrls,
    model: parsed.model,
    plate: parsed.plate,
    recordChannelId: settings.recordChannelId,
    recordMessageId: sent.id,
    report: parsed.report,
    sourceMessageId: message.id,
    systemChannelId: settings.systemChannelId!
  });
  if (settings.allowRecordEditing) {
    await sent.edit(recordPayload(settings, author, parsed, imageUrls, record.id) as any).catch(() => null);
  }

  if (settings.logsEnabled) {
    context.socket.emitLog({
      guildId: message.guild.id,
      message: `Abandono de veículo registrado: ${parsed.plate}.`,
      metadata: { channelId: settings.recordChannelId, messageId: sent.id, model: parsed.model, plate: parsed.plate },
      type: "vehicle_abandonment.registered",
      userId: message.author.id
    });
    await sendInternalLog(message, settings, sent.id, parsed);
  }

  if (settings.deleteOriginalMessage) {
    await message.delete().catch(() => null);
  } else {
    await replyV2(message, settings.successMessage || "✅ Registro de abandono de veículo enviado.");
  }
}

function recordPayload(settings: VehicleAbandonmentSettings, author: RenderAuthor, parsed: CompleteParsedReport, imageUrls: string[], recordId: string | null): MessageCreateOptions {
  const components: any[] = [];
  if (settings.thumbnailUrl) {
    components.push({
      type: 9,
      accessory: { type: 11, media: { url: settings.thumbnailUrl }, description: settings.systemName },
      components: [{ type: 10, content: `# ${renderTemplate(settings.embedTitle, author, settings)}` }]
    });
  } else {
    components.push({ type: 10, content: `# ${renderTemplate(settings.embedTitle, author, settings)}` });
  }
  components.push(
    { type: 14, divider: true, spacing: 1 },
    { type: 10, content: `## VEÍCULO\n${clip(parsed.model, 300)}\n\n## PLACA\n${clip(parsed.plate, 80)}\n\n## RELATÓRIO\n${clip(parsed.report, 1800)}` },
    ...imageUrls.map((url, index) => ({ type: 12, items: [{ media: { url }, description: `Imagem ${index + 1} do veículo` }] })),
    { type: 14, divider: true, spacing: 1 },
    { type: 10, content: `-# ${renderTemplate(settings.footerText, author, settings)}` }
  );
  if (settings.allowRecordEditing && recordId) {
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:edit:${recordId}`).setLabel("Editar").setStyle(ButtonStyle.Secondary)
    ));
  }

  return {
    allowedMentions: settings.mentionRoleId ? { roles: [settings.mentionRoleId] } : { parse: [] },
    components: [{ type: 17, accent_color: parseColor(settings.color), components }],
    content: settings.mentionRoleId ? `<@&${settings.mentionRoleId}>` : undefined,
    flags: MessageFlags.IsComponentsV2
  };
}

function explanatoryPanelPayload(settings: VehicleAbandonmentSettings): MessageCreateOptions {
  const components: any[] = [];
  const title = `# ${clip(settings.explanatoryPanelTitle, 200)}`;
  if (settings.explanatoryPanelThumbnailUrl) {
    components.push({
      type: 9,
      accessory: { type: 11, media: { url: settings.explanatoryPanelThumbnailUrl }, description: settings.explanatoryPanelTitle },
      components: [{ type: 10, content: title }]
    });
  } else {
    components.push({ type: 10, content: title });
  }

  components.push(
    { type: 10, content: clip(settings.explanatoryPanelDescription, 1200) },
    { type: 14, divider: true, spacing: 1 },
    { type: 10, content: `## ${settings.explanatoryPanelEmoji} Como funciona\n${clip(settings.explanatoryPanelHowItWorksText, 1800)}` },
    { type: 14, divider: true, spacing: 1 },
    { type: 10, content: `## Campos Obrigatórios\n${clip(settings.explanatoryPanelRequiredFieldsText, 1000)}` },
    { type: 14, divider: true, spacing: 1 },
    { type: 10, content: `## Exemplo Correto\n\`\`\`\n${clip(settings.explanatoryPanelExampleText, 1700)}\n\`\`\`` },
    { type: 14, divider: true, spacing: 1 },
    { type: 10, content: `## Observações\n${clip(settings.explanatoryPanelNotesText, 1800)}` },
    { type: 14, divider: true, spacing: 1 },
    { type: 10, content: `## Erros Comuns\n${clip(settings.explanatoryPanelCommonErrorsText, 1600)}` }
  );

  if (settings.explanatoryPanelImageUrl) {
    components.push({ type: 12, items: [{ media: { url: settings.explanatoryPanelImageUrl }, description: "Imagem de destaque do painel explicativo" }] });
  }

  components.push(
    { type: 14, divider: true, spacing: 1 },
    { type: 10, content: clip(settings.explanatoryPanelFinalText, 1000) }
  );

  if (settings.explanatoryPanelButtonEnabled) {
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:example`).setLabel("📖 Ver Exemplo Completo").setStyle(ButtonStyle.Primary)
    ));
  }

  return {
    allowedMentions: { parse: [] },
    components: [{ type: 17, accent_color: parseColor(settings.explanatoryPanelColor), components }],
    flags: MessageFlags.IsComponentsV2
  };
}

async function sendInternalLog(message: Message, settings: VehicleAbandonmentSettings, recordMessageId: string, parsed: CompleteParsedReport) {
  if (!settings.logChannelId || !message.guild) return;
  const channel = await message.guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return;
  await channel.send({
    components: [{
      type: 17,
      accent_color: parseColor(settings.color),
      components: [{ type: 10, content: `# ${settings.emoji} Registro enviado\n**Autor:** <@${message.author.id}>\n**Veículo:** ${escapeMarkdown(parsed.model)}\n**Placa:** ${escapeMarkdown(parsed.plate)}\n**Mensagem:** https://discord.com/channels/${message.guild.id}/${settings.recordChannelId}/${recordMessageId}` }]
    }],
    flags: MessageFlags.IsComponentsV2
  }).catch(() => null);
}

async function replyV2(message: Message, content: string) {
  await message.reply({
    components: [{ type: 17, accent_color: 0xef4444, components: [{ type: 10, content: content.slice(0, 3900) }] }],
    flags: MessageFlags.IsComponentsV2
  }).catch(() => null);
}

async function getSettings(context: BotContext, guildId: string) {
  const key = `${MODULE_ID}:${guildId}`;
  const cached = settingsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.settings;
  const settings = await context.api.getVehicleAbandonmentSettings(guildId);
  settingsCache.set(key, { expiresAt: Date.now() + SETTINGS_TTL_MS, settings });
  return settings;
}

function imageUrls(message: Message, settings: VehicleAbandonmentSettings) {
  const limit = settings.allowMultipleAttachments ? settings.maxImages : 1;
  return message.attachments
    .filter((attachment) => {
      const type = attachment.contentType?.toLowerCase() ?? "";
      const extension = extensionOf(attachment.name ?? attachment.url);
      return type.startsWith("image/") && IMAGE_EXTENSIONS.has(type.slice("image/".length)) || IMAGE_EXTENSIONS.has(extension);
    })
    .map((attachment) => attachment.url)
    .slice(0, limit);
}

function detectFieldLine(line: string): { field: keyof ParsedReport; value: string } | null {
  const separator = line.match(/\s*(->|:|=|-)\s*/);
  if (separator?.index !== undefined && separator.index > 0) {
    const key = normalizeKey(line.slice(0, separator.index));
    const field = fieldForKey(key);
    if (field) return { field, value: line.slice(separator.index + separator[0].length).trim() };
  }

  const field = fieldForKey(normalizeKey(line));
  return field ? { field, value: "" } : null;
}

function fieldForKey(key: string): keyof ParsedReport | null {
  if (["modelo", "modelo do veiculo", "veiculo", "carro"].includes(key)) return "model";
  if (["placa", "placa do veiculo"].includes(key)) return "plate";
  if (["relatorio", "descricao", "informacoes"].includes(key)) return "report";
  return null;
}

function appendField(result: ParsedReport, field: keyof ParsedReport, value: string) {
  result[field] = [result[field], value].filter(Boolean).join("\n");
}

function missingFields(parsed: ParsedReport) {
  const missing: string[] = [];
  if (!parsed.model) missing.push("Modelo");
  if (!parsed.plate) missing.push("Placa");
  if (!parsed.report) missing.push("Relatório");
  return missing;
}

function cleanValue(value: string | null, maxLength: number) {
  const cleaned = value?.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned ? clip(cleaned, maxLength) : null;
}

function renderTemplate(template: string, author: RenderAuthor, settings: VehicleAbandonmentSettings) {
  const now = new Date();
  const date = now.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const time = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  return template
    .replace(/\{emoji\}/g, settings.emoji)
    .replace(/\{systemName\}/g, settings.systemName)
    .replace(/\{user\}/g, author.name)
    .replace(/\{userId\}/g, author.id)
    .replace(/\{date\}/g, date)
    .replace(/\{time\}/g, time);
}

function editModal(recordId: string, model: string, plate: string, report: string) {
  return new ModalBuilder()
    .setCustomId(`${PREFIX}:edit_submit:${recordId}`)
    .setTitle("Editar Abandono de Veículo")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("model").setLabel("Modelo").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(300).setValue(model.slice(0, 300))),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("plate").setLabel("Placa").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setValue(plate.slice(0, 80))),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("report").setLabel("Relatório").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1800).setValue(report.slice(0, 1800)))
    );
}

function exampleModal(settings: VehicleAbandonmentSettings | null) {
  const title = settings?.explanatoryPanelModalTitle || "Exemplo Completo";
  const content = settings?.explanatoryPanelModalContent || "Modelo:\nLittle Bird\n\nPlaca:\nKQ34354\n\nRelatório:\nVeículo encontrado abandonado próximo à praça central. Sem ocupantes e sem movimentação há várias horas.\n\nFoto:\n(Anexar junto da mensagem enviada no canal.)";
  return new ModalBuilder()
    .setCustomId(`${PREFIX}:example_view`)
    .setTitle(clip(title, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("example")
          .setLabel("Exemplo de preenchimento")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(4000)
          .setValue(clip(content, 3800))
      )
    );
}

async function updateRecordMessage(context: BotContext, settings: VehicleAbandonmentSettings, record: VehicleAbandonmentRecord) {
  if (!record.recordMessageId) return;
  const guild = await context.client.guilds.fetch(record.guildId).catch(() => null);
  const channel = await guild?.channels.fetch(record.recordChannelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return;
  const message = await channel.messages.fetch(record.recordMessageId).catch(() => null);
  await message?.edit(recordPayload(settings, { id: record.authorId, name: record.authorName }, { model: record.model, plate: record.plate, report: record.report }, record.imageUrls, record.id) as any).catch(() => null);
}

function canEditRecord(member: GuildMember | null, settings: VehicleAbandonmentSettings, authorId: string, actorId: string) {
  if (actorId === authorId) return true;
  return hasPermission(member, settings.allowedRoleIds);
}

function canUseExplanatoryPanel(member: GuildMember | null, settings: VehicleAbandonmentSettings) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return settings.explanatoryPanelAllowedRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

function hasPermission(member: GuildMember | null, allowedRoleIds: string[]) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  if (!allowedRoleIds.length) return true;
  return member.roles.cache.some((role) => allowedRoleIds.includes(role.id));
}

function cleanupPending() {
  const now = Date.now();
  for (const [key, value] of pendingRecords.entries()) {
    if (now - value.createdAt > PENDING_TTL_MS) pendingRecords.delete(key);
  }
}

function normalizeKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function parseColor(value: string) {
  const hex = value.replace("#", "");
  return /^[0-9a-f]{6}$/i.test(hex) ? Number.parseInt(hex, 16) : 0x2563eb;
}

function extensionOf(value: string) {
  return value.split("?")[0]?.split(".").pop()?.toLowerCase() ?? "";
}

function displayName(message: Message) {
  return message.member?.displayName ?? message.author.globalName ?? message.author.username;
}

function clip(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 1))}…` : value;
}

function escapeMarkdown(value: string) {
  return value.replace(/([\\*_`~|])/g, "\\$1");
}

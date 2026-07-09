import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  DiscordAPIError,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type Interaction
} from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import type { BotCommand, BotContext } from "../types";
import type { FivemHierarchyPanel } from "./apiClient";
import { renderComponentsV2Panel, type PanelVisualConfig } from "./panelVisualRenderer";
import type { FivemHierarchyPanelUpdateAck } from "../websocket/socketClient";

const PREFIX = "fivem_hierarchy";
const scheduledGuilds = new Map<string, NodeJS.Timeout>();

export const hierarchyCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("hierarquia")
    .setDescription("Gerencia ou atualiza o painel de Hierarquia FAQ FiveM."),
  moduleId: "fivem-hierarchy",
  async execute(interaction: ChatInputCommandInteraction, context: BotContext) {
    if (!interaction.guild) return;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "Voce precisa de permissao para gerenciar o servidor.", ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    await refreshHierarchyPanelsForGuild(interaction.guild, context);
    await interaction.editReply("Painel de Hierarquia FAQ atualizado.");
  }
};

export function startFivemHierarchyService(client: Client<true>, context: BotContext) {
  context.socket.onFivemHierarchyPanelUpdate((payload, ack?: FivemHierarchyPanelUpdateAck) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (!guild) {
      ack?.({ error: "O bot nao esta conectado ao servidor selecionado.", ok: false, panelId: payload.panelId });
      return;
    }
    void refreshHierarchyPanelsForGuild(guild, context, payload.panelId)
      .then((results) => {
        const success = results.find((result) => result.ok);
        if (success) {
          ack?.(success);
          return;
        }
        ack?.(results[0] ?? { error: "Nenhum painel de hierarquia ativo foi encontrado para publicar.", ok: false, panelId: payload.panelId });
      })
      .catch((error) => {
        ack?.({ error: `Falha inesperada ao publicar hierarquia: ${errorMessage(error)}`, ok: false, panelId: payload.panelId });
      });
  });

  for (const guild of client.guilds.cache.values()) {
    scheduleHierarchyRefresh(guild, context);
  }
}

export async function handleFivemHierarchyInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.isButton() || !interaction.customId.startsWith(`${PREFIX}:`)) return false;
  if (!interaction.guild) return true;
  if (interaction.customId.startsWith(`${PREFIX}:refresh:`)) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "Somente a administracao pode atualizar este painel manualmente.", ephemeral: true });
      return true;
    }
    const panelId = interaction.customId.split(":")[2] ?? null;
    await interaction.deferReply({ ephemeral: true });
    await refreshHierarchyPanelsForGuild(interaction.guild, context, panelId);
    await interaction.editReply("Painel de hierarquia atualizado.");
    return true;
  }
  return false;
}

export function scheduleHierarchyRefresh(guild: Guild, context: BotContext) {
  if (!isBotModuleEnabled("fivem-hierarchy")) return;
  const current = scheduledGuilds.get(guild.id);
  if (current) clearTimeout(current);
  const timeout = setTimeout(() => {
    scheduledGuilds.delete(guild.id);
    void refreshHierarchyPanelsForGuild(guild, context);
  }, 2500);
  timeout.unref();
  scheduledGuilds.set(guild.id, timeout);
}

export async function refreshHierarchyPanelsForGuild(guild: Guild, context: BotContext, panelId?: string | null) {
  const panels = await context.api.getActiveFivemHierarchyPanels().catch((error) => {
    console.warn(`[fivem-hierarchy] falha ao buscar paineis ativos: ${errorMessage(error)}`);
    return [];
  });
  const scoped = panels.filter((panel) => panel.guildId === guild.id && (!panelId || panel.id === panelId));
  if (!scoped.length) {
    return panelId
      ? [{ error: "Painel ativo nao encontrado para este bot. Salve o painel como ativo e confira se o bot DEV correto esta selecionado.", ok: false, panelId }]
      : [];
  }
  await guild.members.fetch().catch(() => null);
  const results = [];
  for (const panel of scoped) {
    results.push(await publishHierarchyPanel(guild, context, panel));
  }
  return results;
}

async function publishHierarchyPanel(guild: Guild, context: BotContext, panel: FivemHierarchyPanel) {
  if (!panel.enabled) return { error: "O painel de hierarquia esta desativado.", ok: false, panelId: panel.id };
  if (!panel.panelChannelId) return { error: "Canal do painel de hierarquia nao configurado.", ok: false, panelId: panel.id };
  const channel = await guild.channels.fetch(panel.panelChannelId).catch(() => null);
  if (!channel || !("send" in channel) || !("messages" in channel)) {
    const error = "Canal do painel nao encontrado ou nao e um canal de texto.";
    await logPublishFailure(context, guild.id, panel, error);
    return { error, ok: false, panelId: panel.id };
  }
  const permissionReport = inspectPublishPermissions(guild, channel as PublishPermissionChannel, Boolean(panel.panelMessageId));
  await logPublishPermissionSnapshot(context, guild.id, panel, permissionReport);
  if (permissionReport.blockingMissing.length) {
    const error = `Permissoes ausentes no canal <#${channel.id}>: ${permissionReport.blockingMissing.join(", ")}. Permissoes reais: ${permissionReport.granted.join(", ") || "nenhuma"}.`;
    await logPublishFailure(context, guild.id, panel, error, permissionReport);
    return { error, ok: false, panelId: panel.id };
  }
  const visuals = await getPanelVisualSlots(context, guild.id, "fivem-hierarchy");
  const payload = createHierarchyPayload(guild, panel, visuals[0] ?? null, visuals.slice(1));
  let message = panel.panelMessageId ? await channel.messages.fetch(panel.panelMessageId).catch(() => null) : null;
  if (message) {
    message = await message.edit(payload).catch(async (error) => {
      await logPublishFailure(context, guild.id, panel, `Falha ao editar painel existente: ${discordErrorMessage(error)}. ${permissionHint(permissionReport)}`, permissionReport);
      return channel.send(payload).catch(async (sendError) => {
        await logPublishFailure(context, guild.id, panel, `Falha ao reenviar painel: ${discordErrorMessage(sendError)}. ${permissionHint(permissionReport)}`, permissionReport);
        return null;
      });
    });
  } else {
    message = await channel.send(payload).catch(async (error) => {
      await logPublishFailure(context, guild.id, panel, `Falha ao enviar painel: ${discordErrorMessage(error)}. ${permissionHint(permissionReport)}`, permissionReport);
      return null;
    });
  }
  if (message) {
    await context.api.updateFivemHierarchyPanelState({ guildId: guild.id, messageId: message.id, panelId: panel.id }).catch(() => null);
    return { messageId: message.id, ok: true, panelId: panel.id };
  }
  return { error: `O Discord recusou o envio do painel no canal configurado. ${permissionHint(permissionReport)}`, ok: false, panelId: panel.id };
}

type PublishPermissionChannel = {
  id: string;
  permissionsFor(member: GuildMember): { has(permission: bigint): boolean; toArray(): string[] } | null;
};

function inspectPublishPermissions(guild: Guild, channel: PublishPermissionChannel, editingExistingMessage: boolean) {
  const me = guild.members.me;
  if (!me || !channel || !("permissionsFor" in channel)) {
    return {
      botId: me?.id ?? null,
      channelId: channel?.id ?? null,
      granted: [],
      blockingMissing: ["Validar membro do bot"],
      diagnosticMissing: ["Validar membro do bot"],
      required: ["Validar membro do bot"]
    };
  }
  const permissions = channel.permissionsFor(me);
  const required: Array<[bigint, string]> = [
    [PermissionFlagsBits.ViewChannel, "Ver Canal"],
    [PermissionFlagsBits.SendMessages, "Enviar Mensagens"],
    [PermissionFlagsBits.EmbedLinks, "Inserir Links"],
    [PermissionFlagsBits.ReadMessageHistory, "Ler Historico"]
  ];
  const diagnostic: Array<[bigint, string]> = editingExistingMessage
    ? [[PermissionFlagsBits.ManageMessages, "Gerenciar Mensagens"]]
    : [];
  const granted = permissions?.toArray() ?? [];
  const blockingMissing = required.filter(([permission]) => !permissions?.has(permission)).map(([, label]) => label);
  const diagnosticMissing = diagnostic.filter(([permission]) => !permissions?.has(permission)).map(([, label]) => label);
  const report = {
    botId: me.id,
    channelId: channel.id,
    granted,
    blockingMissing,
    diagnosticMissing,
    required: required.map(([, label]) => label),
    diagnostic: diagnostic.map(([, label]) => label)
  };
  console.info(`[fivem-hierarchy] permissoes do bot no canal ${channel.id}: granted=${granted.join(",") || "nenhuma"} missing=${blockingMissing.join(",") || "nenhuma"} diagnosticMissing=${diagnosticMissing.join(",") || "nenhuma"}`);
  return report;
}

async function logPublishPermissionSnapshot(context: BotContext, guildId: string, panel: FivemHierarchyPanel, permissionReport: ReturnType<typeof inspectPublishPermissions>) {
  await context.api.postLog({
    guildId,
    channelId: panel.panelChannelId,
    module: "fivem-hierarchy",
    action: "panel.permission_snapshot",
    type: "fivem_hierarchy.permission_snapshot",
    message: `Permissoes do bot no canal antes de publicar hierarquia: ${permissionReport.granted.join(", ") || "nenhuma"}. Faltando: ${permissionReport.blockingMissing.join(", ") || "nenhuma"}. Diagnostico: ${permissionReport.diagnosticMissing.join(", ") || "nenhuma"}.`,
    metadata: { panelId: panel.id, ...permissionReport }
  }).catch(() => null);
}

async function logPublishFailure(context: BotContext, guildId: string, panel: FivemHierarchyPanel, reason: string, permissionReport?: ReturnType<typeof inspectPublishPermissions>) {
  await context.api.postLog({
    guildId,
    channelId: panel.panelChannelId,
    module: "fivem-hierarchy",
    action: "panel.publish_failed",
    type: "fivem_hierarchy.publish_failed",
    message: `Falha ao publicar painel de hierarquia: ${reason}`,
    metadata: { panelId: panel.id, channelId: panel.panelChannelId, permissionReport: permissionReport ?? null, reason }
  }).catch(() => null);
}

function permissionHint(permissionReport: ReturnType<typeof inspectPublishPermissions>) {
  return permissionReport.blockingMissing.length
    ? `Permissoes faltando: ${permissionReport.blockingMissing.join(", ")}.`
    : `Permissoes calculadas no canal: ${permissionReport.granted.join(", ") || "nenhuma"}.`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function discordErrorMessage(error: unknown) {
  if (error instanceof DiscordAPIError) {
    return `${error.message} (${error.code})`;
  }
  return errorMessage(error);
}

function createHierarchyPayload(guild: Guild, panel: FivemHierarchyPanel, visual: PanelVisualConfig | null, extraImages: PanelVisualConfig[] = []) {
  const fallbackVisual: PanelVisualConfig | null = panel.imageUrl ? { imageEnabled: true, imagePosition: panel.imagePosition === "bottom" ? "bottom" : panel.imagePosition, imageUrl: panel.imageUrl } : null;
  const action = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:refresh:${panel.id}`).setLabel("Atualizar painel").setStyle(ButtonStyle.Secondary)
      );
  return renderComponentsV2Panel({ accentColor: colorToInt(panel.color), actions: [action], description: panel.description ?? "Hierarquia atualizada automaticamente pelos cargos do servidor.", extraImages, fields: [renderHierarchyText(guild, panel)], footer: panel.footerEnabled ? { text: panel.footerText ?? "OrviteK" } : { enabled: false }, image: visual?.imageEnabled ? visual : fallbackVisual, moduleId: "fivem-hierarchy", title: panel.title });
}

async function getPanelVisualSlots(context: BotContext, guildId: string, basePanelId: string) {
  const panelIds = [basePanelId, `${basePanelId}-banner-2`, `${basePanelId}-banner-3`];
  const visuals = await Promise.all(panelIds.map((panelId) => context.api.getPanelVisualSettings(guildId, panelId).catch(() => null)));

  return visuals.flatMap((visual, index): PanelVisualConfig[] => {
    if (!visual?.imageEnabled) return [];
    if (index > 0 && visual.useGlobalDefault) return [];
    return [{ imageEnabled: visual.imageEnabled, imagePosition: visual.imagePosition, imageUrl: visual.imageUrl }];
  });
}

function renderHierarchyText(guild: Guild, panel: FivemHierarchyPanel) {
  return panel.hierarchies
    .filter((item) => item.active)
    .sort((a, b) => a.order - b.order)
    .map((item) => {
      const members = guild.members.cache
        .filter((member: GuildMember) => member.roles.cache.has(item.roleId))
        .map((member) => `<@${member.id}>`)
        .slice(0, item.limit ?? 50);
      return `${item.emoji ?? ""} **${item.name}**\n${members.length ? members.join("\n") : "*Nenhum membro encontrado.*"}`;
    })
    .join("\n\n")
    .slice(0, 3800) || "*Nenhuma hierarquia configurada.*";
}

function colorToInt(value: string) {
  return Number.parseInt(value.replace("#", ""), 16) || 0x22c55e;
}

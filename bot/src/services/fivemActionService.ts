import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags,
  StringSelectMenuBuilder, type Client, type GuildMember, type Interaction,
  type StringSelectMenuInteraction
} from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import type { BotContext } from "../types";
import type { FivemActionArchitecture, FivemActionSession, FivemActionSettings } from "./apiClient";
import { resolvePanelImageUrl, type PanelVisualConfig } from "./panelVisualRenderer";

const PREFIX = "fivem_action";
const MODULE_BY_ARCHITECTURE: Record<FivemActionArchitecture, string> = { fac: "fivem-actions", police: "police-actions" };
const handledRequests = new Map<string, string>();
let polling = false;

export function startFivemActionService(client: Client, context: BotContext) {
  if (!isFivemActionRuntimeEnabled()) return;
  void processPanelRequests(client, context);
  const interval = setInterval(() => void processPanelRequests(client, context), 15_000);
  interval.unref();
}

export async function handleFivemActionInteraction(interaction: Interaction, context: BotContext) {
  if (!(interaction.isButton() || interaction.isStringSelectMenu()) || !interaction.customId.startsWith(`${PREFIX}:`)) return false;
  if (!isFivemActionRuntimeEnabled()) { await interaction.reply({ content: "Sistema de Ações não liberado para este bot.", ephemeral: true }); return true; }
  if (!interaction.guildId || !interaction.guild) { await interaction.reply({ content: "Use este sistema dentro de um servidor.", ephemeral: true }); return true; }
  const [, action, id] = interaction.customId.split(":");
  if (interaction.isStringSelectMenu() && action === "open") await openAction(interaction, context);
  else if (interaction.isButton() && action === "join") await changeParticipant(interaction, context, id!, true);
  else if (interaction.isButton() && action === "leave") await changeParticipant(interaction, context, id!, false);
  else if (interaction.isButton() && action === "result") await chooseResult(interaction, context, id!);
  else if (interaction.isButton() && action === "page") await showActionPage(interaction, context, id!);
  else if (interaction.isStringSelectMenu() && action === "finish") await finishAction(interaction, context, id!);
  return true;
}

async function processPanelRequests(client: Client, context: BotContext) {
  if (polling) return; polling = true;
  try {
    const configs = await context.api.getActiveFivemActionConfigs();
    for (const config of configs) {
      if (!config.lastPanelRequestedAt) continue;
      const key = `${config.guildId}:${config.architecture}`;
      if (handledRequests.get(key) === config.lastPanelRequestedAt) continue;
      await publishMainPanel(client, context, config);
      handledRequests.set(key, config.lastPanelRequestedAt);
    }
  } catch (error) { console.warn("[fivem-actions] falha ao processar painéis:", errorMessage(error)); }
  finally { polling = false; }
}

async function publishMainPanel(client: Client, context: BotContext, config: FivemActionSettings) {
  if (!config.panelChannelId) throw new Error(`Canal principal não configurado para ${config.guildId}/${config.architecture}.`);
  const guild = await client.guilds.fetch(config.guildId);
  const channel = await guild.channels.fetch(config.panelChannelId);
  if (!channel?.isTextBased() || channel.isDMBased()) throw new Error("Canal do painel inválido.");
  const dashboard = await context.api.getFivemActionDashboard(config.guildId, config.architecture);
  const enabled = dashboard.actions.filter((item) => item.enabled).sort((a, b) => a.order - b.order);
  if (!enabled.length) throw new Error("Cadastre ao menos uma ação antes de publicar.");
  const select = new StringSelectMenuBuilder().setCustomId(`${PREFIX}:open:${config.architecture}`).setPlaceholder("🎯 Escolha uma ação").addOptions(enabled.slice(0, 25).map((item) => ({ label: item.name.slice(0, 100), value: `${config.architecture}|${item.id}`, description: item.description.slice(0, 100) || undefined, emoji: item.emoji || undefined })));
  const intro = { type: 10, content: [`# ${config.panelTitle}`, config.panelDescription].join("\n") };
  const tutorial = { type: 10, content: ["## 📖 Como funciona", "1️⃣ Escolha uma ação no menu.", "2️⃣ Vá ao painel criado.", "3️⃣ Entre na ação e aguarde a equipe.", "4️⃣ O responsável encerra em Resultado da ação.", "5️⃣ O relatório será enviado automaticamente."].join("\n") };
  const visuals = config.architecture === "police" ? await getPanelVisualSlots(context, config.guildId, "police-actions") : [];
  const fallbackImageUrl = config.imageUrl && config.imagePosition !== "none" ? resolvePanelImageUrl(config.imageUrl) : null;
  const media = visuals.length ? visuals.map((visual) => mediaBlock(visual.imageUrl!, config.panelTitle)) : fallbackImageUrl ? [mediaBlock(fallbackImageUrl, config.panelTitle)] : [];
  const imagePosition = visuals[0] ? actionImagePosition(visuals[0].imagePosition) : config.imagePosition;
  const contentComponents: any[] = imagePosition === "top" && media.length ? [...media, intro, tutorial] : imagePosition === "center" && media.length ? [intro, ...media, tutorial] : [intro, tutorial, ...media];
  const navigation = enabled.length > 25 ? [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:page:${config.architecture}|1`).setLabel("Mais ações").setEmoji("➡️").setStyle(ButtonStyle.Secondary))] : [];
  const payload = { components: [{ type: 17, accent_color: parseColor(config.color), components: [...contentComponents, new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select), ...navigation] }], flags: MessageFlags.IsComponentsV2 as const };
  let message = config.panelMessageId ? await channel.messages.fetch(config.panelMessageId).catch(() => null) : null;
  if (message) await message.edit(payload); else message = await channel.send(payload);
  await context.api.updateFivemActionPanelState({ guildId: config.guildId, architecture: config.architecture, panelMessageId: message.id });
}

async function openAction(interaction: StringSelectMenuInteraction, context: BotContext) {
  await interaction.deferReply({ ephemeral: true });
  const [architectureRaw, actionId] = (interaction.values[0] ?? "").split("|");
  const architecture = architectureRaw as FivemActionArchitecture;
  if (!actionId || !["fac", "police"].includes(architecture)) return void await interaction.editReply("Ação inválida.");
  if (!isFivemActionRuntimeEnabled(architecture)) return void await interaction.editReply(architecture === "police" ? "Acoes policiais nao liberadas para este bot." : "Acoes FAC nao liberadas para este bot.");
  const dashboard = await context.api.getFivemActionDashboard(interaction.guildId!, architecture);
  const channelId = dashboard.settings.actionChannelId;
  if (!channelId) return void await interaction.editReply("Canal de ações não configurado.");
  const channel = await interaction.guild!.channels.fetch(channelId);
  if (!channel?.isTextBased() || channel.isDMBased()) return void await interaction.editReply("Canal de ações inválido.");
  const session = await context.api.createFivemActionSession({ guildId: interaction.guildId!, architecture, actionId, openerId: interaction.user.id, openerName: displayName(interaction.member) });
  const message = await channel.send(sessionPayload(session));
  await context.api.updateFivemActionSessionMessage(session.id, { channelId: channel.id, messageId: message.id });
  await interaction.editReply(`Painel de **${session.actionName}** criado em <#${channel.id}>.`);
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
  const select = new StringSelectMenuBuilder().setCustomId(`${PREFIX}:open:${architecture}`).setPlaceholder(`Ações ${safePage + 1}/${pages}`).addOptions(items.map((item) => ({ label: item.name.slice(0, 100), value: `${architecture}|${item.id}`, description: item.description.slice(0, 100) || undefined, emoji: item.emoji || undefined })));
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:page:${architecture}|${safePage - 1}`).setLabel("Anterior").setStyle(ButtonStyle.Secondary).setDisabled(safePage === 0),
    new ButtonBuilder().setCustomId(`${PREFIX}:page:${architecture}|${safePage + 1}`).setLabel("Próxima").setStyle(ButtonStyle.Secondary).setDisabled(safePage >= pages - 1)
  );
  const payload = { components: [{ type: 17, accent_color: parseColor(dashboard.settings.color), components: [{ type: 10, content: `## Escolha uma ação\nPágina ${safePage + 1} de ${pages}` }, new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select), buttons] }], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 };
  if (interaction.replied || interaction.deferred) await interaction.editReply(payload); else await interaction.reply(payload);
}

async function changeParticipant(interaction: any, context: BotContext, sessionId: string, joining: boolean) {
  await interaction.deferReply({ ephemeral: true });
  const member = interaction.member as GuildMember;
  const session = joining
    ? await context.api.joinFivemActionSession(sessionId, { userId: interaction.user.id, username: displayName(member), roleIds: [...member.roles.cache.keys()] })
    : await context.api.leaveFivemActionSession(sessionId, interaction.user.id);
  await refreshSessionMessage(interaction, session);
  await interaction.editReply(joining ? "Você entrou na ação." : "Você saiu da ação.");
}

async function chooseResult(interaction: any, context: BotContext, sessionId: string) {
  const session = await context.api.getFivemActionSession(sessionId);
  if (session.openerId !== interaction.user.id) { await interaction.reply({ content: "Você não é o responsável por esta ação.", ephemeral: true }); return; }
  const select = new StringSelectMenuBuilder().setCustomId(`${PREFIX}:finish:${sessionId}`).setPlaceholder("Escolha o resultado").addOptions({ label: "Vitória", value: "victory", emoji: "🟢" }, { label: "Derrota", value: "defeat", emoji: "🔴" });
  await interaction.reply({ components: [{ type: 17, accent_color: 0x7c3aed, components: [{ type: 10, content: `## Resultado de ${session.actionName}\nSomente você pode concluir esta ação.` }, new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)] }], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
}

async function finishAction(interaction: StringSelectMenuInteraction, context: BotContext, sessionId: string) {
  await interaction.deferReply({ ephemeral: true });
  const result = interaction.values[0] as "victory" | "defeat";
  const session = await context.api.finishFivemActionSession(sessionId, interaction.user.id, result);
  await refreshSessionMessage(interaction, session);
  await sendReport(interaction, context, session);
  await interaction.editReply(`Ação encerrada com ${result === "victory" ? "vitória" : "derrota"}.`);
}

async function refreshSessionMessage(interaction: any, session: FivemActionSession) {
  if (!session.channelId || !session.messageId) return;
  const channel = await interaction.guild.channels.fetch(session.channelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return;
  const message = await channel.messages.fetch(session.messageId).catch(() => null);
  if (message) await message.edit(sessionPayload(session));
}

async function sendReport(interaction: StringSelectMenuInteraction, context: BotContext, session: FivemActionSession) {
  const dashboard = await context.api.getFivemActionDashboard(session.guildId, session.architecture);
  let channel = dashboard.settings.reportChannelId ? await interaction.guild!.channels.fetch(dashboard.settings.reportChannelId).catch(() => null) : null;
  if (!channel) channel = await interaction.guild!.channels.create({ name: "relatorio-de-acoes", type: ChannelType.GuildText, parent: dashboard.settings.categoryId ?? undefined, reason: "Relatórios do Sistema de Ações" });
  if (!channel.isTextBased() || channel.isDMBased()) return;
  const active = session.participants.filter((item) => !item.leftAt);
  const duration = Math.max(0, Math.round(((session.finishedAt ? Date.parse(session.finishedAt) : Date.now()) - Date.parse(session.startedAt)) / 60000));
  const members = session.participants.length ? session.participants.map((item) => { const end = item.leftAt ? Date.parse(item.leftAt) : session.finishedAt ? Date.parse(session.finishedAt) : Date.now(); const minutes = Math.max(0, Math.round((end - Date.parse(item.joinedAt)) / 60000)); return `• <@${item.userId}> — ${minutes} min${item.leftAt ? " (saiu)" : ""}`; }).join("\n") : "Nenhum participante.";
  await channel.send({ components: [{ type: 17, accent_color: session.status === "victory" ? 0x22c55e : 0xef4444, components: [{ type: 10, content: `# 📊 RELATÓRIO DE AÇÃO\n**Ação:** ${session.actionName}\n**Arquitetura:** ${session.architecture === "fac" ? "FAC" : "Polícia"}\n**Resultado:** ${session.status === "victory" ? "🟢 Vitória" : "🔴 Derrota"}\n**Responsável:** <@${session.openerId}>\n**Participantes:** ${active.length}\n**Tempo:** ${duration} minutos\n\n## Membros\n${members}` }] }], flags: MessageFlags.IsComponentsV2 });
}

function sessionPayload(session: FivemActionSession) {
  const active = session.participants.filter((item) => !item.leftAt);
  const full = active.length >= session.maxParticipants;
  const status = session.status === "active" ? "🟡 Em andamento" : session.status === "victory" ? "🟢 Vitória" : "🔴 Derrota";
  const rows = session.status === "active" ? [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:join:${session.id}`).setLabel("Entrar na ação").setEmoji("🟢").setStyle(ButtonStyle.Success).setDisabled(full), new ButtonBuilder().setCustomId(`${PREFIX}:leave:${session.id}`).setLabel("Sair da ação").setEmoji("🔴").setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`${PREFIX}:result:${session.id}`).setLabel("Resultado da ação").setEmoji("📊").setStyle(ButtonStyle.Primary))] : [];
  const details = { type: 10, content: `# ${session.actionEmoji ?? "🎯"} ${session.actionName.toUpperCase()}\n${session.actionDescription}\n\n**Status:** ${status}\n**Participantes:** ${active.length}/${session.maxParticipants}\n**Responsável:** <@${session.openerId}>\n\n${active.map((item) => `• <@${item.userId}>`).join("\n") || "Aguardando participantes."}` };
  const image = session.actionImageUrl ? [{ type: 12, items: [{ media: { url: session.actionImageUrl } }] }] : [];
  return { components: [{ type: 17, accent_color: session.status === "active" ? parseColor(session.actionColor) : session.status === "victory" ? 0x22c55e : 0xef4444, components: [details, ...image, ...rows] }], flags: MessageFlags.IsComponentsV2 as const };
}

async function getPanelVisualSlots(context: BotContext, guildId: string, basePanelId: string) {
  const panelIds = [basePanelId, `${basePanelId}-banner-2`, `${basePanelId}-banner-3`];
  const visuals = await Promise.all(panelIds.map((panelId) => context.api.getPanelVisualSettings(guildId, panelId).catch(() => null)));

  return visuals.flatMap((visual, index): PanelVisualConfig[] => {
    if (!visual?.imageEnabled || !visual.imageUrl) return [];
    if (index > 0 && visual.useGlobalDefault) return [];
    return [{ imageEnabled: visual.imageEnabled, imagePosition: visual.imagePosition, imageUrl: resolvePanelImageUrl(visual.imageUrl) ?? visual.imageUrl }];
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

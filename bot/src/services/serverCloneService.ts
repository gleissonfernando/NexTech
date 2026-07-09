import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  CategoryChannel,
  ChannelType,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  TextChannel,
  VoiceChannel,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type Interaction,
  type OverwriteResolvable,
  type Role
} from "discord.js";
import { currentRuntimeBotId, isBotModuleEnabled } from "../config/env";
import type { BotContext } from "../types";
import { resetSelectMenuMessage } from "../utils/selectMenuReset";
import { getCachedGuildSettings } from "./guildSettingsCache";
import { getRuntimeModuleAuthorization, runtimeModuleDenialMessage } from "./runtimeModuleGuard";

const MODULE_ID = "server-cloner";
const V2_FLAG = 32768;
const EPHEMERAL_FLAG = 64;

type ClonePart = "roles" | "categories" | "text" | "voice";
type ServerCloneJob = {
  createdAt: number;
  destinationGuildId: string;
  id: string;
  parts: ClonePart[];
  plan?: ServerCloneStoredPlan | null;
  report: string[];
  sourceGuildId: string;
  status: "pending" | "running" | "completed" | "cancelled";
  userId: string;
};

type ServerCloneStoredPlan = {
  cloneParts: ClonePart[];
  destinationGuildId: string;
  extraCategories: string[];
  extraRoles: string[];
  extraTextChannels: string[];
  extraVoiceChannels: string[];
  notes: string;
  categoryRenames: RenamePair[];
  channelRenames: RenamePair[];
  renameServer: string;
  roleRenames: RenamePair[];
  sourceGuildId: string;
};

type RenamePair = {
  from: string;
  to: string;
};

const sessions = new Map<string, ClonePart[]>();
const jobs = new Map<string, ServerCloneJob>();

export async function handleServerCloneInteraction(interaction: Interaction, context: BotContext) {
  if (!isBotModuleEnabled(MODULE_ID)) return false;
  if (!interaction.inGuild() || !interaction.guild) return false;

  const customId = "customId" in interaction ? interaction.customId : "";

  if (!customId?.startsWith("server_clone_")) {
    return false;
  }

  const authorization = await getRuntimeModuleAuthorization(context, interaction.guild.id, MODULE_ID);

  if (!authorization.allowed) {
    await replyNotice(interaction, runtimeModuleDenialMessage(authorization, "A clonagem de servidor"));
    return true;
  }

  if (interaction.isStringSelectMenu() && customId === "server_clone_parts") {
    const parts = normalizeParts(interaction.values);
    sessions.set(sessionKey(interaction.user.id, interaction.guild.id), parts);
    await interaction.reply({
      content: `Itens selecionados: ${partsLabel(parts)}.`,
      ephemeral: true
    });
    void resetSelectMenuMessage(interaction);
    return true;
  }

  if (interaction.isButton() && customId === "server_clone_cancel") {
    sessions.delete(sessionKey(interaction.user.id, interaction.guild.id));
    await interaction.update(serverCloneMessage("Clonagem cancelada", "Nenhuma alteracao foi feita.", true));
    return true;
  }

  if (interaction.isButton() && customId === "server_clone_start") {
    const guard = await validateAdmin(interaction.guild, interaction.member as GuildMember, interaction.user.id);
    if (guard) {
      await interaction.reply({ content: guard, ephemeral: true });
      return true;
    }

    const storedPlan = await getStoredServerClonePlan(context, interaction.guild.id);
    if (storedPlan?.cloneParts.length) {
      sessions.set(sessionKey(interaction.user.id, interaction.guild.id), storedPlan.cloneParts);
    }

    const sourceInput = new TextInputBuilder()
      .setCustomId("sourceGuildId")
      .setLabel("ID do servidor de origem")
      .setPlaceholder("Servidor que sera copiado")
      .setRequired(true)
      .setStyle(TextInputStyle.Short);
    const destinationInput = new TextInputBuilder()
      .setCustomId("destinationGuildId")
      .setLabel("ID do servidor de destino")
      .setPlaceholder("Servidor que recebera a estrutura")
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    if (storedPlan?.sourceGuildId) {
      sourceInput.setValue(storedPlan.sourceGuildId);
    }

    if (storedPlan?.destinationGuildId) {
      destinationInput.setValue(storedPlan.destinationGuildId);
    }

    const modal = new ModalBuilder()
      .setCustomId("server_clone_modal")
      .setTitle("Clonar Servidor")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          sourceInput
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          destinationInput
        )
      );

    await interaction.showModal(modal);
    return true;
  }

  if (interaction.isModalSubmit() && customId === "server_clone_modal") {
    const sourceGuildId = interaction.fields.getTextInputValue("sourceGuildId").trim();
    const destinationGuildId = interaction.fields.getTextInputValue("destinationGuildId").trim();
    const parts = sessions.get(sessionKey(interaction.user.id, interaction.guild.id)) ?? ["roles", "categories", "text", "voice"];
    const sourceGuild = context.client.guilds.cache.get(sourceGuildId);
    const destinationGuild = context.client.guilds.cache.get(destinationGuildId);

    if (!/^\d{5,32}$/.test(sourceGuildId) || !/^\d{5,32}$/.test(destinationGuildId)) {
      await interaction.reply({ content: "Informe IDs validos de servidor.", ephemeral: true });
      return true;
    }

    if (!sourceGuild || !destinationGuild) {
      await interaction.reply({ content: "O bot precisa estar no servidor de origem e no servidor de destino.", ephemeral: true });
      return true;
    }

    const guard = await validateCloneAccess(sourceGuild, destinationGuild, interaction.user.id, context);
    if (guard) {
      await interaction.reply({ content: guard, ephemeral: true });
      return true;
    }

    const summary = await summarizeSource(sourceGuild);
    const storedPlan = await getStoredServerClonePlan(context, destinationGuildId);
    const job: ServerCloneJob = {
      createdAt: Date.now(),
      destinationGuildId,
      id: randomUUID(),
      parts,
      plan: planMatches(storedPlan, sourceGuildId, destinationGuildId) ? storedPlan : null,
      report: [],
      sourceGuildId,
      status: "pending",
      userId: interaction.user.id
    };
    jobs.set(job.id, job);

    await interaction.reply(serverCloneConfirmation(job, sourceGuild, destinationGuild, summary));
    return true;
  }

  if (interaction.isButton() && customId.startsWith("server_clone_confirm:")) {
    const job = jobs.get(customId.split(":")[1] ?? "");

    if (!job || job.userId !== interaction.user.id) {
      await interaction.reply({ content: "Essa clonagem expirou ou pertence a outro usuario.", ephemeral: true });
      return true;
    }

    const sourceGuild = context.client.guilds.cache.get(job.sourceGuildId);
    const destinationGuild = context.client.guilds.cache.get(job.destinationGuildId);

    if (!sourceGuild || !destinationGuild) {
      await interaction.reply({ content: "Servidor de origem ou destino nao encontrado.", ephemeral: true });
      return true;
    }

    await interaction.update(serverCloneProgress(job, "Preparando clonagem..."));
    void runServerClone(job, sourceGuild, destinationGuild, interaction, context);
    return true;
  }

  return false;
}

export function serverClonePanelPayload(ephemeral = true) {
  return v2Payload([
    {
      type: 17,
      accent_color: 0x111827,
      components: [
        { type: 10, content: "# Sistema de Clonagem\nApenas a estrutura autorizada sera clonada: cargos, categorias, canais e permissoes basicas. Mensagens, membros, webhooks privados e dados sensiveis nao sao copiados." },
        { type: 14, divider: true, spacing: 1 },
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: "server_clone_parts",
              placeholder: "Escolha o que clonar",
              min_values: 1,
              max_values: 5,
              options: [
                { label: "Cargos", value: "roles" },
                { label: "Categorias", value: "categories" },
                { label: "Canais de texto", value: "text" },
                { label: "Canais de voz", value: "voice" },
                { label: "Tudo", value: "all" }
              ]
            }
          ]
        },
        {
          type: 1,
          components: [
            { type: 2, custom_id: "server_clone_start", label: "Iniciar Clonagem", style: 1 },
            { type: 2, custom_id: "server_clone_cancel", label: "Cancelar", style: 4 }
          ]
        }
      ]
    }
  ], ephemeral);
}

async function runServerClone(
  job: ServerCloneJob,
  sourceGuild: Guild,
  destinationGuild: Guild,
  interaction: Interaction,
  context: BotContext
) {
  if (!interaction.isButton()) return;

  job.status = "running";
  const roleMap = new Map<string, string>();
  const categoryMap = new Map<string, string>();
  const stats = {
    roles: 0,
    categories: 0,
    text: 0,
    voice: 0,
    failed: 0
  };

  roleMap.set(sourceGuild.id, destinationGuild.id);

  if (job.parts.includes("roles")) {
    await interaction.editReply(serverCloneProgress(job, "Criando cargos...")).catch(() => undefined);
    await cloneRoles(sourceGuild, destinationGuild, roleMap, stats, job.report, job.plan);
  }

  if (job.parts.includes("categories")) {
    await interaction.editReply(serverCloneProgress(job, "Criando categorias...")).catch(() => undefined);
    await cloneCategories(sourceGuild, destinationGuild, roleMap, categoryMap, stats, job.report, job.plan);
  }

  if (job.parts.includes("text")) {
    await interaction.editReply(serverCloneProgress(job, "Criando canais de texto...")).catch(() => undefined);
    await cloneChannels(sourceGuild, destinationGuild, roleMap, categoryMap, stats, job.report, ChannelType.GuildText, job.plan);
  }

  if (job.parts.includes("voice")) {
    await interaction.editReply(serverCloneProgress(job, "Criando canais de voz...")).catch(() => undefined);
    await cloneChannels(sourceGuild, destinationGuild, roleMap, categoryMap, stats, job.report, ChannelType.GuildVoice, job.plan);
  }

  await interaction.editReply(serverCloneProgress(job, "Aplicando permissoes...")).catch(() => undefined);
  await wait(500);

  if (job.plan) {
    await interaction.editReply(serverCloneProgress(job, "Aplicando ajustes do painel DEV...")).catch(() => undefined);
    await applyStoredPlanAdditions(destinationGuild, job.plan, stats, job.report);
  }

  job.status = "completed";
  await interaction.editReply(serverCloneDone(job, stats)).catch(() => undefined);
  await sendServerCloneLog(sourceGuild, destinationGuild, job, stats, context);
}

async function applyStoredPlanAdditions(destinationGuild: Guild, plan: ServerCloneStoredPlan, stats: CloneStats, report: string[]) {
  if (plan.renameServer) {
    try {
      await destinationGuild.setName(plan.renameServer, "Ajuste pos-clonagem configurado no painel DEV");
      report.push(`Servidor renomeado para ${plan.renameServer}.`);
    } catch (error) {
      stats.failed += 1;
      report.push(`Falha ao renomear servidor: ${friendlyError(error)}`);
    }
  }

  for (const roleName of plan.extraRoles) {
    try {
      if (!destinationGuild.roles.cache.some((role) => role.name.toLowerCase() === roleName.toLowerCase())) {
        await destinationGuild.roles.create({
          name: roleName,
          reason: "Cargo adicional pos-clonagem configurado no painel DEV"
        });
        stats.roles += 1;
        await wait(300);
      }
    } catch (error) {
      stats.failed += 1;
      report.push(`Falha ao criar cargo adicional ${roleName}: ${friendlyError(error)}`);
    }
  }

  for (const categoryName of plan.extraCategories) {
    try {
      if (!destinationGuild.channels.cache.some((channel) => channel.type === ChannelType.GuildCategory && channel.name.toLowerCase() === categoryName.toLowerCase())) {
        await destinationGuild.channels.create({
          name: categoryName,
          type: ChannelType.GuildCategory,
          reason: "Categoria adicional pos-clonagem configurada no painel DEV"
        });
        stats.categories += 1;
        await wait(300);
      }
    } catch (error) {
      stats.failed += 1;
      report.push(`Falha ao criar categoria adicional ${categoryName}: ${friendlyError(error)}`);
    }
  }

  for (const channelName of plan.extraTextChannels) {
    try {
      if (!destinationGuild.channels.cache.some((channel) => channel.type === ChannelType.GuildText && channel.name.toLowerCase() === channelName.toLowerCase())) {
        await destinationGuild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          reason: "Canal adicional pos-clonagem configurado no painel DEV"
        });
        stats.text += 1;
        await wait(300);
      }
    } catch (error) {
      stats.failed += 1;
      report.push(`Falha ao criar canal de texto adicional ${channelName}: ${friendlyError(error)}`);
    }
  }

  for (const channelName of plan.extraVoiceChannels) {
    try {
      if (!destinationGuild.channels.cache.some((channel) => channel.type === ChannelType.GuildVoice && channel.name.toLowerCase() === channelName.toLowerCase())) {
        await destinationGuild.channels.create({
          name: channelName,
          type: ChannelType.GuildVoice,
          reason: "Canal de voz adicional pos-clonagem configurado no painel DEV"
        });
        stats.voice += 1;
        await wait(300);
      }
    } catch (error) {
      stats.failed += 1;
      report.push(`Falha ao criar canal de voz adicional ${channelName}: ${friendlyError(error)}`);
    }
  }
}

async function cloneRoles(
  sourceGuild: Guild,
  destinationGuild: Guild,
  roleMap: Map<string, string>,
  stats: CloneStats,
  report: string[],
  plan?: ServerCloneStoredPlan | null
) {
  await sourceGuild.roles.fetch();
  const botHighest = destinationGuild.members.me?.roles.highest.position ?? 0;
  const sourceBotHighest = sourceGuild.members.me?.roles.highest.position ?? 0;
  const roles = sourceGuild.roles.cache
    .filter((role) => role.id !== sourceGuild.id && !role.managed)
    .sort((a, b) => a.position - b.position);

  for (const role of roles.values()) {
    if (role.position >= sourceBotHighest) {
      report.push(`Cargo ignorado por hierarquia no servidor origem: ${role.name}`);
      continue;
    }

    try {
      const created = await destinationGuild.roles.create({
        name: resolvePlannedName(role.name, plan?.roleRenames),
        color: role.color,
        hoist: role.hoist,
        mentionable: role.mentionable,
        permissions: role.permissions,
        icon: role.iconURL() ? await fetchBuffer(role.iconURL({ extension: "png", size: 64 })!) : undefined,
        reason: "Clonagem segura de estrutura de servidor"
      });

      if (created.position < botHighest) {
        await created.setPosition(Math.min(role.position, botHighest - 1)).catch(() => undefined);
      }
      roleMap.set(role.id, created.id);
      stats.roles += 1;
    } catch (error) {
      stats.failed += 1;
      report.push(`Falha ao criar cargo ${role.name}: ${friendlyError(error)}`);
    }

    await wait(350);
  }
}

async function cloneCategories(
  sourceGuild: Guild,
  destinationGuild: Guild,
  roleMap: Map<string, string>,
  categoryMap: Map<string, string>,
  stats: CloneStats,
  report: string[],
  plan?: ServerCloneStoredPlan | null
) {
  const categories = sourceGuild.channels.cache
    .filter((channel): channel is CategoryChannel => channel.type === ChannelType.GuildCategory)
    .sort((a, b) => a.position - b.position);

  for (const category of categories.values()) {
    try {
      const created = await destinationGuild.channels.create({
        name: resolvePlannedName(category.name, [...(plan?.categoryRenames ?? []), ...(plan?.channelRenames ?? [])]),
        type: ChannelType.GuildCategory,
        permissionOverwrites: mappedOverwrites(category, roleMap),
        position: category.position,
        reason: "Clonagem segura de estrutura de servidor"
      });
      categoryMap.set(category.id, created.id);
      stats.categories += 1;
    } catch (error) {
      stats.failed += 1;
      report.push(`Falha ao criar categoria ${category.name}: ${friendlyError(error)}`);
    }

    await wait(350);
  }
}

async function cloneChannels(
  sourceGuild: Guild,
  destinationGuild: Guild,
  roleMap: Map<string, string>,
  categoryMap: Map<string, string>,
  stats: CloneStats,
  report: string[],
  type: ChannelType.GuildText | ChannelType.GuildVoice,
  plan?: ServerCloneStoredPlan | null
) {
  const channels = sourceGuild.channels.cache
    .filter((channel): channel is TextChannel | VoiceChannel => channel.type === type)
    .sort((a, b) => a.position - b.position);

  for (const channel of channels.values()) {
    try {
      const parent = channel.parentId ? categoryMap.get(channel.parentId) ?? null : null;

      if (type === ChannelType.GuildText && channel.type === ChannelType.GuildText) {
        await destinationGuild.channels.create({
          name: resolvePlannedName(channel.name, plan?.channelRenames),
          type: ChannelType.GuildText,
          parent,
          topic: channel.topic ?? undefined,
          nsfw: channel.nsfw,
          rateLimitPerUser: channel.rateLimitPerUser,
          permissionOverwrites: mappedOverwrites(channel, roleMap),
          position: channel.position,
          reason: "Clonagem segura de estrutura de servidor"
        });
        stats.text += 1;
      }

      if (type === ChannelType.GuildVoice && channel.type === ChannelType.GuildVoice) {
        await destinationGuild.channels.create({
          name: resolvePlannedName(channel.name, plan?.channelRenames),
          type: ChannelType.GuildVoice,
          parent,
          userLimit: channel.userLimit,
          bitrate: Math.min(channel.bitrate, destinationGuild.maximumBitrate),
          permissionOverwrites: mappedOverwrites(channel, roleMap),
          position: channel.position,
          reason: "Clonagem segura de estrutura de servidor"
        });
        stats.voice += 1;
      }
    } catch (error) {
      stats.failed += 1;
      report.push(`Falha ao criar canal ${channel.name}: ${friendlyError(error)}`);
    }

    await wait(350);
  }
}

function mappedOverwrites(channel: GuildBasedChannel, roleMap: Map<string, string>): OverwriteResolvable[] {
  if (!("permissionOverwrites" in channel)) return [];

  const overwrites: OverwriteResolvable[] = [];

  for (const overwrite of channel.permissionOverwrites.cache.values()) {
    if (overwrite.type !== 0) continue;
      const mappedId = roleMap.get(overwrite.id);
    if (!mappedId) continue;

    overwrites.push({
      id: mappedId,
      allow: overwrite.allow.bitfield,
      deny: overwrite.deny.bitfield,
      type: overwrite.type
    } as OverwriteResolvable);
  }

  return overwrites;
}

async function validateCloneAccess(sourceGuild: Guild, destinationGuild: Guild, userId: string, context: BotContext) {
  const [sourceMember, destinationMember] = await Promise.all([
    sourceGuild.members.fetch(userId).catch(() => null),
    destinationGuild.members.fetch(userId).catch(() => null)
  ]);

  if (!sourceMember || !destinationMember) {
    return "Voce precisa estar nos dois servidores para autorizar a clonagem.";
  }

  const sourceGuard = await validateAdmin(sourceGuild, sourceMember, userId);
  if (sourceGuard) return `Origem bloqueada: ${sourceGuard}`;

  const destinationGuard = await validateAdmin(destinationGuild, destinationMember, userId);
  if (destinationGuard) return `Destino bloqueado: ${destinationGuard}`;

  const [sourceAuthorization, destinationAuthorization] = await Promise.all([
    getRuntimeModuleAuthorization(context, sourceGuild.id, MODULE_ID),
    getRuntimeModuleAuthorization(context, destinationGuild.id, MODULE_ID)
  ]);

  if (!sourceAuthorization.allowed) {
    return `Origem bloqueada pela dashboard: ${sourceAuthorization.reason}`;
  }

  if (!destinationAuthorization.allowed) {
    return `Destino bloqueado pela dashboard: ${destinationAuthorization.reason}`;
  }

  const permissionGuard = await validateBotPermissions(sourceGuild, "origem") ?? await validateBotPermissions(destinationGuild, "destino");
  return permissionGuard;
}

async function validateAdmin(guild: Guild, member: GuildMember, userId: string) {
  const ownerId = (await guild.fetchOwner().catch(() => null))?.id;

  if (ownerId === userId || member.permissions.has(PermissionFlagsBits.Administrator)) {
    return null;
  }

  return "apenas administradores ou o dono do servidor podem usar este sistema.";
}

async function validateBotPermissions(guild: Guild, label: string) {
  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  const permissions = me?.permissions;

  if (!permissions) {
    return `Nao consegui validar minhas permissoes no servidor de ${label}.`;
  }

  const required = [
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ViewChannel
  ];

  if (!required.every((permission) => permissions.has(permission))) {
    return `O bot precisa de Manage Channels, Manage Roles e View Channels no servidor de ${label}.`;
  }

  return null;
}

async function summarizeSource(guild: Guild) {
  await Promise.all([
    guild.channels.fetch().catch(() => null),
    guild.roles.fetch().catch(() => null)
  ]);

  return {
    roles: guild.roles.cache.filter((role) => role.id !== guild.id && !role.managed).size,
    categories: guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildCategory).size,
    text: guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildText).size,
    voice: guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildVoice).size,
    failed: 0
  };
}

function serverCloneConfirmation(job: ServerCloneJob, source: Guild, destination: Guild, summary: CloneStats) {
  return v2Payload([
    {
      type: 17,
      accent_color: 0x2563eb,
      components: [
        { type: 10, content: "# Confirmar Clonagem de Servidor" },
        { type: 10, content: `Origem: ${source.name}\nDestino: ${destination.name}\nCargos: ${summary.roles}\nCategorias: ${summary.categories}\nCanais de texto: ${summary.text}\nCanais de voz: ${summary.voice}\nSelecionado: ${partsLabel(job.parts)}` },
        {
          type: 1,
          components: [
            { type: 2, custom_id: `server_clone_confirm:${job.id}`, label: "Confirmar Clonagem", style: 3 },
            { type: 2, custom_id: "server_clone_cancel", label: "Cancelar", style: 4 }
          ]
        }
      ]
    }
  ], true);
}

function serverCloneProgress(job: ServerCloneJob, stage: string) {
  return serverCloneMessage("Clonagem em andamento", `${stage}\nOrigem: ${job.sourceGuildId}\nDestino: ${job.destinationGuildId}`, true);
}

function serverCloneDone(job: ServerCloneJob, stats: CloneStats) {
  return serverCloneMessage(
    "Clonagem finalizada",
    `Cargos: ${stats.roles}\nCategorias: ${stats.categories}\nCanais de texto: ${stats.text}\nCanais de voz: ${stats.voice}\nFalhas registradas: ${stats.failed}\nStatus final: ${job.status}`,
    true
  );
}

function serverCloneMessage(title: string, body: string, ephemeral = true) {
  return v2Payload([{ type: 17, accent_color: 0x111827, components: [{ type: 10, content: `# ${title}` }, { type: 10, content: body }] }], ephemeral);
}

async function sendServerCloneLog(source: Guild, destination: Guild, job: ServerCloneJob, stats: CloneStats, context: BotContext) {
  const settings = await getCachedGuildSettings(context, destination.id, context.client.user?.id).catch(() => null);
  const metadata = {
    destinationGuildId: destination.id,
    failed: stats.failed,
    jobId: job.id,
    parts: job.parts,
    sourceGuildId: source.id,
    stats,
    status: job.status
  };

  await context.api.postLog({
    botId: settings?.botId ?? null,
    guildId: destination.id,
    userId: job.userId,
    type: "server_clone.completed",
    message: `Clonagem concluida de ${source.name} para ${destination.name}.`,
    metadata
  }).catch(() => null);

  const logChannelId = settings?.logChannelId;
  if (!logChannelId) return;

  const channel = await destination.channels.fetch(logChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  await channel.send({
    content: [
      "Relatorio de Clonagem de Servidor",
      `Quem iniciou: <@${job.userId}>`,
      `Origem: ${source.name} (${source.id})`,
      `Destino: ${destination.name} (${destination.id})`,
      `Data: ${new Date().toLocaleString("pt-BR")}`,
      `Itens clonados: cargos ${stats.roles}, categorias ${stats.categories}, texto ${stats.text}, voz ${stats.voice}`,
      `Status final: ${job.status}`,
      job.report.length ? `Observacoes:\n${job.report.slice(0, 12).join("\n")}` : "Observacoes: nenhuma falha registrada."
    ].join("\n")
  }).catch(() => undefined);
}

function normalizeParts(values: string[]): ClonePart[] {
  if (values.includes("all")) {
    return ["roles", "categories", "text", "voice"];
  }

  const allowed = new Set<ClonePart>(["roles", "categories", "text", "voice"]);
  const parts = values.filter((value): value is ClonePart => allowed.has(value as ClonePart));
  return parts.length ? [...new Set(parts)] : ["roles", "categories", "text", "voice"];
}

async function getStoredServerClonePlan(context: BotContext, guildId: string) {
  const botId = currentRuntimeBotId();

  if (!botId) {
    return null;
  }

  try {
    const config = await context.api.getBotGuildConfig(botId, guildId);
    return normalizeStoredServerClonePlan(config.modules?.[MODULE_ID]);
  } catch {
    return null;
  }
}

function normalizeStoredServerClonePlan(value: unknown): ServerCloneStoredPlan | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const plan = value as Record<string, unknown>;
  const sourceGuildId = readPlanString(plan.sourceGuildId);
  const destinationGuildId = readPlanString(plan.destinationGuildId);

  if (!sourceGuildId || !destinationGuildId) {
    return null;
  }

  return {
    cloneParts: normalizeParts(readPlanStringArray(plan.cloneParts)),
    categoryRenames: readRenamePairs(plan.categoryRenames),
    channelRenames: readRenamePairs(plan.channelRenames),
    destinationGuildId,
    extraCategories: readPlanStringArray(plan.extraCategories, 30).map(normalizeChannelName).filter(Boolean),
    extraRoles: readPlanStringArray(plan.extraRoles, 30).map((name) => name.slice(0, 100)).filter(Boolean),
    extraTextChannels: readPlanStringArray(plan.extraTextChannels, 30).map(normalizeChannelName).filter(Boolean),
    extraVoiceChannels: readPlanStringArray(plan.extraVoiceChannels, 30).map((name) => name.slice(0, 100)).filter(Boolean),
    notes: readPlanString(plan.notes).slice(0, 500),
    renameServer: readPlanString(plan.renameServer).slice(0, 100),
    roleRenames: readRenamePairs(plan.roleRenames),
    sourceGuildId
  };
}

function planMatches(plan: ServerCloneStoredPlan | null, sourceGuildId: string, destinationGuildId: string) {
  return Boolean(plan && plan.sourceGuildId === sourceGuildId && plan.destinationGuildId === destinationGuildId);
}

function readPlanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readPlanStringArray(value: unknown, limit = 20) {
  return Array.isArray(value)
    ? value.map(readPlanString).filter(Boolean).slice(0, limit)
    : [];
}

function normalizeChannelName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_ ]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 100);
}

function readRenamePairs(value: unknown) {
  return readPlanStringArray(value, 50)
    .map((line) => {
      const [from, ...rest] = line.includes("=>") ? line.split("=>") : line.split("=");
      const to = rest.join("=>");

      return {
        from: readPlanString(from).slice(0, 100),
        to: readPlanString(to).slice(0, 100)
      };
    })
    .filter((pair) => pair.from && pair.to);
}

function resolvePlannedName(currentName: string, renames?: RenamePair[]) {
  const rename = renames?.find((pair) => pair.from.toLowerCase() === currentName.toLowerCase());
  return rename?.to || currentName;
}

function partsLabel(parts: ClonePart[]) {
  const labels: Record<ClonePart, string> = {
    roles: "cargos",
    categories: "categorias",
    text: "canais de texto",
    voice: "canais de voz"
  };
  return parts.map((part) => labels[part]).join(", ");
}

function v2Payload(components: unknown[], ephemeral = false) {
  return {
    components,
    flags: V2_FLAG | (ephemeral ? EPHEMERAL_FLAG : 0)
  } as any;
}

async function replyNotice(interaction: Interaction, message: string) {
  if (!("reply" in interaction)) return;
  await interaction.reply({ content: message, ephemeral: true }).catch(() => undefined);
}

async function fetchBuffer(url: string) {
  const response = await fetch(url);
  if (!response.ok) return undefined;
  return Buffer.from(await response.arrayBuffer());
}

function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : "falha desconhecida";
}

function sessionKey(userId: string, guildId: string) {
  return `${guildId}:${userId}`;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type CloneStats = {
  categories: number;
  failed: number;
  roles: number;
  text: number;
  voice: number;
};

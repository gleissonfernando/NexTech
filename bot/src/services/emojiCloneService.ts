import {
    ActionRowBuilder,
    ModalBuilder,
    PermissionFlagsBits,
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
    type Guild,
    type GuildMember,
    type Interaction
} from "discord.js";
import { randomUUID } from "node:crypto";
import { currentRuntimeBotId, env, isBotModuleEnabled } from "../config/env";
import type { BotContext, GuildSettings } from "../types";
import { getCachedGuildSettings, getFreshGuildSettings } from "./guildSettingsCache";
import { isRuntimeModuleAuthorized } from "./runtimeModuleGuard";

const MODULE_ID = "emoji-cloner";
const V2_FLAG = 32768;
const EPHEMERAL_FLAG = 64;
const MAX_EMOJI_BYTES = 256 * 1024;
const jobs = new Map<string, CloneJob>();

type CloneMode = "all" | "static" | "animated" | "single";
type CloneCandidate = {
  animated: boolean;
  id: string;
  name: string;
  url: string;
};
type CloneItem = CloneCandidate & {
  errorReason: string | null;
  newEmojiId: string | null;
  newName: string | null;
  status: "pending" | "success" | "failed";
};
type CloneJob = {
  createdAt: number;
  guildId: string;
  id: string;
  mode: CloneMode;
  prefix: string | null;
  source: string;
  status: "pending" | "running" | "completed" | "cancelled";
  userId: string;
  items: CloneItem[];
};

export async function handleEmojiCloneInteraction(interaction: Interaction, context: BotContext) {
  if (!isBotModuleEnabled(MODULE_ID)) return false;
  if (!interaction.inGuild() || !interaction.guild) return false;

  const customId = "customId" in interaction ? interaction.customId : "";

  if (!customId?.startsWith("emoji_clone_")) {
    return false;
  }

  if (!(await isRuntimeModuleAuthorized(context, interaction.guild.id, MODULE_ID))) {
    await replyNotice(interaction, "O modulo de clonagem de emojis nao foi liberado para este bot neste servidor.");
    return true;
  }

  if (interaction.isButton() && customId === "emoji_clone_start") {
    await interaction.reply({
      content: "O formulario vai pedir o servidor de origem, seu ID do Discord e o servidor destino. Nunca envie noToken de usuario Discord.",
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("emoji_clone_mode")
            .setPlaceholder("Escolha o modo de clonagem")
            .addOptions(
              { label: "Clonar todos", value: "all" },
              { label: "Apenas estaticos", value: "static" },
              { label: "Apenas animados", value: "animated" },
              { label: "Emoji unico", value: "single" }
            )
        )
      ],
      ephemeral: true
    });
    return true;
  }

  if (interaction.isStringSelectMenu() && customId === "emoji_clone_mode") {
    const mode = normalizeMode(interaction.values[0]);
    const modal = new ModalBuilder()
      .setCustomId(`emoji_clone_modal:${mode}`)
      .setTitle("Clonar Emojis")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("source")
            .setLabel("Servidor origem ID ou emojis/links")
            .setPlaceholder("Cole o ID do servidor, ou cole varios emojis/links em linhas separadas")
            .setRequired(true)
            .setStyle(TextInputStyle.Paragraph)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("actorDiscordId")
            .setLabel("Seu ID do Discord (token))")
            .setPlaceholder("Cole seu token ou ID da sua conta Discord")
            .setRequired(true)
            .setStyle(TextInputStyle.Short)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("destinationGuildId")
            .setLabel("Servidor destino (ID)")
            .setPlaceholder("Coloque o ID do servidor que recebera os emojis")
            .setRequired(true)
            .setStyle(TextInputStyle.Short)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("prefix")
            .setLabel("Prefixo opcional")
            .setPlaceholder("Exemplo: orvitek")
            .setRequired(false)
            .setStyle(TextInputStyle.Short)
        )
      );

    await interaction.showModal(modal);
    return true;
  }

  if (interaction.isModalSubmit() && customId.startsWith("emoji_clone_modal:")) {
    const settings = await getFreshGuildSettings(context, interaction.guild.id, context.client.user?.id);
    const guard = await validateActor(interaction.guild, interaction.member as GuildMember, settings, context);

    if (guard) {
      await interaction.reply({ content: guard, ephemeral: true });
      return true;
    }

    const mode = normalizeMode(customId.split(":")[1]);
    const source = interaction.fields.getTextInputValue("source").trim();
    const actorDiscordId = interaction.fields.getTextInputValue("actorDiscordId").trim();
    if (!/^\d{5,32}$/.test(actorDiscordId)) {
      await interaction.reply({
        content: "Informe um ID de Discord valido. Nao envie noToken de usuario.",
        ephemeral: true
      });
      return true;
    }

    if (actorDiscordId !== interaction.user.id) {
      await interaction.reply({
        content: "O ID do Discord informado precisa ser o mesmo usuario que iniciou a clonagem.",
        ephemeral: true
      });
      return true;
    }

    const destinationGuildId = interaction.fields.getTextInputValue("destinationGuildId").trim();
    if (!/^\d{5,32}$/.test(destinationGuildId)) {
      await interaction.reply({
        content: "Informe um ID de servidor destino valido.",
        ephemeral: true
      });
      return true;
    }

    if (destinationGuildId !== interaction.guild.id) {
      await interaction.reply({
        content: "Por seguranca, o servidor destino precisa ser o mesmo servidor onde este painel foi usado.",
        ephemeral: true
      });
      return true;
    }

    if (looksLikeDiscordUserToken(source)) {
      await interaction.reply({
        content: "Nao envie noToken de usuario Discord. Por seguranca, use apenas o ID do servidor de origem ou o emoji/link.",
        ephemeral: true
      });
      return true;
    }

    const prefix = sanitizeName(interaction.fields.getTextInputValue("prefix") || settings.emojiCloneDefaultPrefix || "");
    const sourceGuildId = /^\d{5,32}$/.test(source) ? source : null;

    if (sourceGuildId && !context.client.guilds.cache.has(sourceGuildId)) {
      await interaction.reply({
        content: "Para clonar todos por ID do servidor, o bot precisa estar no servidor de origem. Se ele estiver apenas no destino, cole os codigos ou links dos emojis.",
        ephemeral: true
      });
      return true;
    }

    const candidates = await resolveCandidates(context, source, mode, settings);

    if (!candidates.length) {
      await interaction.reply({ content: "Nenhum emoji acessivel foi encontrado. Use o ID de um servidor onde o bot esta presente, ou cole codigos/links de emojis validos.", ephemeral: true });
      return true;
    }

    const limited = candidates.slice(0, settings.emojiCloneMaxPerRun).map((candidate) => ({
      ...candidate,
      errorReason: null,
      newEmojiId: null,
      newName: null,
      status: "pending" as const
    }));
    const job: CloneJob = {
      createdAt: Date.now(),
      guildId: interaction.guild.id,
      id: randomUUID(),
      items: limited,
      mode,
      prefix: prefix || null,
      source,
      status: "pending",
      userId: interaction.user.id
    };
    jobs.set(job.id, job);

    await interaction.reply(v2Payload(confirmationComponents(job), true));
    return true;
  }

  if (interaction.isButton() && customId.startsWith("emoji_clone_cancel:")) {
    const job = jobs.get(customId.split(":")[1] ?? "");
    if (job) job.status = "cancelled";
    await interaction.update(v2Payload(messageComponents("Clonagem cancelada", "Nenhum emoji foi criado."), true));
    return true;
  }

  if (interaction.isButton() && customId.startsWith("emoji_clone_confirm:")) {
    const job = jobs.get(customId.split(":")[1] ?? "");

    if (!job || job.guildId !== interaction.guild.id || job.userId !== interaction.user.id) {
      await interaction.reply({ content: "Essa clonagem expirou ou pertence a outro usuario.", ephemeral: true });
      return true;
    }

    await interaction.update(v2Payload(progressComponents(job, 0), true));
    void runCloneJob(job, interaction, context);
    return true;
  }

  if (interaction.isButton() && customId.startsWith("emoji_clone_report:")) {
    const job = jobs.get(customId.split(":")[1] ?? "");
    await interaction.reply({
      content: job ? reportText(job).slice(0, 1900) : "Relatorio nao encontrado.",
      ephemeral: true
    });
    return true;
  }

  return false;
}

export function emojiClonePanelPayload(ephemeral = false) {
  const panelLinks = emojiClonePanelLinks();

  return v2Payload([
    {
      type: 17,
      accent_color: 0x7c3aed,
      components: [
        { type: 10, content: "# 🚀 | Painel Clonagem De Emojis" },
        { type: 10, content: "> Olá, membro! Acesse o painel de clonagem de emojis abaixo e divirta-se clonando." },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: "## ❕ | Funcionalidades Importantes:" },
        { type: 10, content: "• 🔗 | Para clonar por ID do servidor, informe origem e destino; nesse modo o bot precisa estar nos dois servidores.\n• 🤖 | Se o bot estiver apenas no destino, cole codigos ou links dos emojis que deseja clonar.\n• 🛡️ | O sistema respeita permissoes, bots autorizados e configuracoes do board.\n•." },
        { type: 14, divider: true, spacing: 1 },
        {
          type: 1,
          components: [
            { type: 2, custom_id: "emoji_clone_start", label: "⭐ Clonar Emojis", style: 2 },
            { type: 2, label: "🔗 Adicionar Bot", style: 5, url: panelLinks.addBotUrl },
            { type: 2, label: "🔴 Como Utilizar", style: 5, url: panelLinks.howToUrl }
          ]
        },
        {
          type: 10,
          content: "🏵️ | Todos os copyrights para OrviteK bots."
        }
      ]
    }
  ], ephemeral);
}

function emojiClonePanelLinks() {
  const origin = env.FRONTEND_URL || "https://discord.com/oauth2/authorize?client_id=1492325134550302952&permissions=8&integration_type=0&scope=bot";

  return {
    addBotUrl: `${origin}/dev/bots`,
    howToUrl: `${origin}/dashboard`
  };
}

async function runCloneJob(job: CloneJob, interaction: Interaction, context: BotContext) {
  if (!interaction.isButton() || !interaction.guild) return;
  job.status = "running";
  let success = 0;
  let failed = 0;
  await interaction.guild.emojis.fetch().catch(() => null);

  for (let index = 0; index < job.items.length; index += 1) {
    const item = job.items[index]!;

    try {
      const name = sanitizeName(`${job.prefix ?? ""}${item.name}`) || "emoji";
      const existing = interaction.guild.emojis.cache.find((emoji) => emoji.name?.toLowerCase() === name.toLowerCase());

      if (existing) {
        item.status = "success";
        item.newEmojiId = existing.id;
        item.newName = existing.name;
        success += 1;
        context.socket.emitLog({
          guildId: job.guildId,
          type: "emoji_clone.duplicate",
          message: `Emoji ja existente ignorado: ${name}.`,
          userId: job.userId,
          metadata: {
            emojiId: existing.id,
            name
          }
        });
      } else {
        const image = await downloadEmoji(item.url);
        const emoji = await interaction.guild.emojis.create({
          attachment: image,
          name,
          reason: `Clonagem solicitada por ${interaction.user.tag}`
        });
        item.status = "success";
        item.newEmojiId = emoji.id;
        item.newName = emoji.name;
        success += 1;
        context.socket.emitLog({
          guildId: job.guildId,
          type: "emoji_clone.sent",
          message: `Emoji enviado ao servidor: ${emoji.name}.`,
          userId: job.userId,
          metadata: {
            emojiId: emoji.id,
            name: emoji.name,
            originalEmojiId: item.id
          }
        });
      }
    } catch (error) {
      item.status = "failed";
      item.errorReason = friendlyError(error);
      failed += 1;
      context.socket.emitLog({
        guildId: job.guildId,
        type: "emoji_clone.failed",
        message: `Falha ao importar emoji ${item.name}: ${item.errorReason}.`,
        userId: job.userId,
        metadata: {
          originalEmojiId: item.id
        }
      });
    }

    if ((index + 1) % 3 === 0 || index + 1 === job.items.length) {
      await interaction.editReply(v2Payload(progressComponents(job, index + 1, success, failed), true)).catch(() => undefined);
    }

    await wait(850);
  }

  job.status = "completed";
  await interaction.editReply(v2Payload(doneComponents(job, success, failed), true)).catch(() => undefined);
  await context.api.recordEmojiCloneJob({
    guildId: job.guildId,
    userId: job.userId,
    sourceGuildId: /^\d{5,32}$/.test(job.source) ? job.source : null,
    status: job.status,
    total: job.items.length,
    success,
    failed,
    prefix: job.prefix,
    createdAt: new Date(job.createdAt).toISOString(),
    finishedAt: new Date().toISOString(),
      items: job.items.map((item) => ({
        originalEmojiId: item.id,
        originalName: item.name,
        originalUrl: item.url,
        newEmojiId: item.newEmojiId,
        newName: item.newName,
        animated: item.animated,
      status: item.status,
      errorReason: item.errorReason
    }))
  }).catch((error) => {
    console.warn("[emoji-cloner] nao foi possivel gravar historico:", error instanceof Error ? error.message : error);
  });
  await sendCloneLog(interaction.guild, job, context, success, failed);
}

async function resolveCandidates(context: BotContext, source: string, mode: CloneMode, settings: GuildSettings) {
  const parsed = parseEmojiSources(source);
  const sourceGuildId = /^\d{5,32}$/.test(source) ? source : null;
  const candidates = parsed.length ? parsed : sourceGuildId ? await guildEmojiCandidates(context, sourceGuildId) : [];

  return candidates.filter((emoji) => {
    if (!settings.emojiCloneAllowAnimated && emoji.animated) return false;
    if (mode === "static") return !emoji.animated;
    if (mode === "animated") return emoji.animated;
    return true;
  });
}

async function guildEmojiCandidates(context: BotContext, guildId: string): Promise<CloneCandidate[]> {
  const guild = context.client.guilds.cache.get(guildId);
  if (!guild) return [];
  const emojis = await guild.emojis.fetch().catch(() => guild.emojis.cache);

  return emojis.map((emoji) => ({
    animated: emoji.animated ?? false,
    id: emoji.id,
    name: emoji.name ?? `emoji_${emoji.id}`,
    url: emoji.imageURL({ extension: emoji.animated ? "gif" : "png", size: 128 })
  }));
}

function parseEmojiSources(value: string): CloneCandidate[] {
  const candidates = new Map<string, CloneCandidate>();
  const customPattern = /<(?<animated>a?):(?<name>[a-zA-Z0-9_]{2,32}):(?<id>\d{5,32})>/g;
  const urlPattern = /https:\/\/cdn\.discordapp\.com\/emojis\/(?<id>\d{5,32})\.(?<ext>png|gif|webp|jpg|jpeg|avif)(?:\?[^\s<>\]]*)?/gi;

  for (const match of value.matchAll(customPattern)) {
    if (!match.groups) continue;
    const animated = match.groups.animated === "a";
    const id = match.groups.id!;

    candidates.set(id, {
      animated,
      id,
      name: match.groups.name!,
      url: `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "png"}?size=128&quality=lossless`
    });
  }

  for (const match of value.matchAll(urlPattern)) {
    if (!match.groups) continue;
    const id = match.groups.id!;
    const ext = match.groups.ext!.toLowerCase();

    candidates.set(id, {
      animated: ext === "gif",
      id,
      name: `emoji_${id}`,
      url: match[0]
    });
  }

  return [...candidates.values()];
}

async function validateActor(guild: Guild, member: GuildMember, settings: GuildSettings, context: BotContext) {
  if (!settings.emojiCloneEnabled) return "A clonagem de emojis esta desativada no board.";

  const runtimeBotId = currentRuntimeBotId();
  const allowedBotIds = new Set(settings.emojiCloneAllowedBotIds);
  if (allowedBotIds.size && !allowedBotIds.has(context.client.user?.id ?? "") && (!runtimeBotId || !allowedBotIds.has(runtimeBotId))) {
    return "Este bot nao esta liberado no board para clonar emojis.";
  }

  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!me?.permissions.has(PermissionFlagsBits.CreateGuildExpressions) && !me?.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) {
    return "O bot precisa da permissao Criar Expressoes ou Gerenciar Expressoes.";
  }

  if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
    const allowed = new Set(settings.emojiCloneAllowedRoleIds);
    if (!member.roles.cache.some((role) => allowed.has(role.id))) {
      return "Voce nao tem permissao para usar a clonagem de emojis neste servidor.";
    }
  }

  if (guild.emojis.cache.size >= emojiLimit(guild)) {
    return "Este servidor nao possui espaco para novos emojis.";
  }

  return null;
}

async function downloadEmoji(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Nao foi possivel baixar a imagem do emoji.");
  const contentType = response.headers.get("content-type") ?? "";
  if (!/image\/(png|gif|webp|jpe?g|avif)/i.test(contentType)) throw new Error("Formato de imagem invalido.");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_EMOJI_BYTES) throw new Error("Emoji muito grande. Limite maximo: 256 KiB.");
  return buffer;
}

function confirmationComponents(job: CloneJob) {
  const staticCount = job.items.filter((item) => !item.animated).length;
  const animatedCount = job.items.filter((item) => item.animated).length;
  return [
    {
      type: 17,
      accent_color: 0x2ecc71,
      components: [
        { type: 10, content: "# Confirmacao de Clonagem" },
        { type: 10, content: `Foram encontrados:\nEmojis estaticos: ${staticCount}\nEmojis animados: ${animatedCount}\nTotal: ${job.items.length}\nPrefixo aplicado: ${job.prefix ?? "nenhum"}` },
        {
          type: 1,
          components: [
            { type: 2, custom_id: `emoji_clone_confirm:${job.id}`, label: "Confirmar Clonagem", style: 3 },
            { type: 2, custom_id: `emoji_clone_cancel:${job.id}`, label: "Cancelar", style: 4 }
          ]
        }
      ]
    }
  ];
}

function progressComponents(job: CloneJob, current: number, success = 0, failed = 0) {
  return messageComponents("Clonando Emojis...", `Progresso: ${current}/${job.items.length}\nSucesso: ${success}\nFalhas: ${failed}\nRestantes: ${Math.max(0, job.items.length - current)}`);
}

function doneComponents(job: CloneJob, success: number, failed: number) {
  return [
    {
      type: 17,
      accent_color: 0x5865f2,
      components: [
        { type: 10, content: "# Clonagem Finalizada" },
        { type: 10, content: `Emojis clonados com sucesso: ${success}\nEmojis com erro: ${failed}\nTotal processado: ${job.items.length}` },
        {
          type: 1,
          components: [
            { type: 2, custom_id: `emoji_clone_report:${job.id}`, label: "Ver Relatorio", style: 2 },
            { type: 2, custom_id: "emoji_clone_start", label: "Clonar Novamente", style: 1 }
          ]
        }
      ]
    }
  ];
}

function messageComponents(title: string, body: string) {
  return [{ type: 17, accent_color: 0x0f1015, components: [{ type: 10, content: `# ${title}` }, { type: 10, content: body }] }];
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

function normalizeMode(value: string | undefined): CloneMode {
  return value === "static" || value === "animated" || value === "single" ? value : "all";
}

function looksLikeDiscordUserToken(value: string) {
  const normalized = value.trim();
  return /^mfa\.[\w-]{20,}$/i.test(normalized) || /^[\w-]{20,}\.[\w-]{6,}\.[\w-]{20,}$/i.test(normalized);
}

function sanitizeName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);
}

function emojiLimit(guild: Guild) {
  return (guild as Guild & { maximumEmojis?: number }).maximumEmojis ?? 50;
}

function reportText(job: CloneJob) {
  return job.items.map((item) => item.status === "success"
    ? `OK ${item.name} -> ${item.newName}`
    : `ERRO ${item.name}: ${item.errorReason ?? "falha desconhecida"}`
  ).join("\n");
}

function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : "Falha desconhecida.";
}

async function sendCloneLog(guild: Guild, job: CloneJob, context: BotContext, success: number, failed: number) {
  const settings = await getCachedGuildSettings(context, guild.id, context.client.user?.id);
  if (!settings.emojiCloneLogChannelId) return;

  const channel = await guild.channels.fetch(settings.emojiCloneLogChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  await channel.send({
    content: [
      "Relatorio de Clonagem de Emojis",
      `Usuario: <@${job.userId}>`,
      `Servidor: ${guild.name}`,
      `Total: ${job.items.length}`,
      `Clonados: ${success}`,
      `Erros: ${failed}`,
      `Data: ${new Date().toLocaleString("pt-BR")}`,
      "",
      reportText(job).slice(0, 1400)
    ].join("\n")
  }).catch(() => undefined);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

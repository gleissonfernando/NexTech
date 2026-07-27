import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  MessageFlags,
  PermissionsBitField
} from "discord.js";
import { renderComponentsV2Panel } from "./panelVisualRenderer";
import type { BoosterSettings } from "./apiClient";
import type { BotContext } from "../types";

const PREFIX = "booster";
const ACCENT_FALLBACK = 0xffd500;
const inFlightBoosts = new Set<string>();

export async function handleBoosterGuildMemberUpdate(oldMember: GuildMember, newMember: GuildMember, context: BotContext) {
  const oldBoosting = Boolean(oldMember.premiumSince);
  const newBoosting = Boolean(newMember.premiumSince);
  if (oldBoosting || !newBoosting) return;

  const guild = newMember.guild;
  const boostCount = Math.max(0, guild.premiumSubscriptionCount ?? 0);
  const boostLevel = Math.max(0, guild.premiumTier ?? 0);
  const dedupeKey = `${newMember.id}:${newMember.premiumSince?.getTime() ?? Date.now()}:${boostCount}`;
  const lockKey = `${guild.id}:${dedupeKey}`;
  if (inFlightBoosts.has(lockKey)) return;
  inFlightBoosts.add(lockKey);

  try {
    const runtime = await context.api.getBoosterRuntime(guild.id).catch((error) => {
      console.warn("[booster] falha ao carregar runtime:", error instanceof Error ? error.message : error);
      return null;
    });
    const settings = runtime?.settings;
    if (!settings?.enabled) return;

    const claim = await context.api.claimBoosterEvent(guild.id, {
      avatarUrl: newMember.displayAvatarURL({ extension: "png", size: 256 }),
      boostCount,
      boostLevel,
      dedupeKey,
      userId: newMember.id,
      username: newMember.user.globalName ?? newMember.user.username
    }).catch((error) => {
      console.warn("[booster] falha ao reservar evento:", error instanceof Error ? error.message : error);
      return null;
    });
    if (!claim?.claimed || !claim.history) return;

    const result = await processBoost(context, newMember, settings, claim.history.id, boostCount, boostLevel);
    await context.api.completeBoosterHistory(guild.id, claim.history.id, result).catch((error) => {
      console.warn("[booster] falha ao concluir histórico:", error instanceof Error ? error.message : error);
    });
  } finally {
    inFlightBoosts.delete(lockKey);
  }
}

export async function handleBoosterInteraction(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.customId.startsWith(`${PREFIX}:`)) return false;
  if (!interaction.guildId) {
    await interaction.reply({ content: "Esta interação só funciona em servidor.", ephemeral: true });
    return true;
  }

  const [, action] = interaction.customId.split(":");
  if (action === "thanks") {
    await interaction.reply({
      components: [{ type: 17, accent_color: ACCENT_FALLBACK, components: [{ type: 10, content: "Obrigado por apoiar nosso servidor!" }] }],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
    });
    return true;
  }

  if (action === "benefits") {
    const runtime = await context.api.getBoosterRuntime(interaction.guildId).catch(() => null);
    const settings = runtime?.settings;
    const member = interaction.member && "user" in interaction.member ? interaction.member as GuildMember : null;
    const content = applyVariables(settings?.benefitsMessage || "Obrigado por impulsionar nosso servidor!", {
      boostCount: interaction.guild?.premiumSubscriptionCount ?? 0,
      boostLevel: interaction.guild?.premiumTier ?? 0,
      guild: interaction.guild,
      member: member ?? undefined,
      roleId: settings?.boosterRoleId ?? null
    });

    await interaction.user.send({
      components: [{ type: 17, accent_color: parseColor(settings?.embedColor), components: [{ type: 10, content: `# Benefícios Booster\n${content}` }] }],
      flags: MessageFlags.IsComponentsV2
    }).then(
      () => interaction.reply({ content: "Enviei os benefícios no seu privado.", ephemeral: true }),
      () => interaction.reply({ content: "Não consegui enviar DM. Verifique se suas mensagens privadas estão abertas.", ephemeral: true })
    );
    return true;
  }

  return false;
}

async function processBoost(
  context: BotContext,
  member: GuildMember,
  settings: BoosterSettings,
  historyId: string,
  boostCount: number,
  boostLevel: number
) {
  let roleGiven = false;
  let messageSent = false;
  let bannerSent = false;
  let messageId: string | null = null;
  const errors: string[] = [];

  if (settings.boosterRoleId) {
    roleGiven = await giveBoosterRole(member, settings.boosterRoleId).catch((error) => {
      errors.push(`Cargo: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    });
  }

  if (settings.messageEnabled && settings.announcementChannelId) {
    const channel = await member.guild.channels.fetch(settings.announcementChannelId).catch(() => null);
    if (channel?.isTextBased() && !channel.isDMBased()) {
      const payload = buildBoostPayload(member, settings, boostCount, boostLevel);
      const sent = await channel.send(payload as never).catch((error) => {
        errors.push(`Mensagem: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      });
      messageSent = Boolean(sent);
      messageId = sent?.id ?? null;
      bannerSent = Boolean(settings.bannerEnabled && settings.bannerUrl && sent);
    } else {
      errors.push("Canal de agradecimento inválido ou inacessível.");
    }
  }

  await sendBoosterLog(member, settings, {
    bannerSent,
    boostCount,
    boostLevel,
    errors,
    historyId,
    messageId,
    messageSent,
    roleGiven
  });

  return {
    announcementChannelId: settings.announcementChannelId,
    bannerSent,
    error: errors.length ? errors.join("\n").slice(0, 1000) : null,
    logChannelId: settings.logChannelId,
    messageId,
    messageSent,
    roleGiven,
    roleId: settings.boosterRoleId,
    status: errors.length ? "failed" as const : "processed" as const
  };
}

async function giveBoosterRole(member: GuildMember, roleId: string) {
  if (member.roles.cache.has(roleId)) return true;
  const me = member.guild.members.me ?? await member.guild.members.fetchMe().catch(() => null);
  if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) throw new Error("Bot sem permissão Gerenciar Cargos.");
  const role = await member.guild.roles.fetch(roleId).catch(() => null);
  if (!role) throw new Error("Cargo Booster não encontrado.");
  if (!role.editable) throw new Error("Cargo Booster está acima do cargo do bot.");
  await member.roles.add(role, "Sistema Booster: novo boost detectado.");
  return true;
}

function buildBoostPayload(member: GuildMember, settings: BoosterSettings, boostCount: number, boostLevel: number) {
  const description = applyVariables(settings.message, {
    boostCount,
    boostLevel,
    guild: member.guild,
    member,
    roleId: settings.boosterRoleId
  });
  const fields = [
    `**Cliente**\n${member}`,
    `**Servidor**\n${escapeMarkdown(member.guild.name)}`,
    `**Boosts**\n${boostCount}`,
    `**Nível**\n${boostLevel}`,
    settings.showTimestamp ? `**Data**\n<t:${Math.floor(Date.now() / 1000)}:F>` : ""
  ].filter(Boolean);
  const avatarBlock = settings.showAvatar ? [`**Booster**\n${member.user.globalName ?? member.user.username}`] : [];
  const actions = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:thanks`).setLabel("Agradecer").setEmoji("❤️").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${PREFIX}:benefits:${member.id}`).setLabel("Ver Benefícios").setEmoji("🚀").setStyle(ButtonStyle.Primary)
    )
  ];

  return renderComponentsV2Panel({
    accentColor: parseColor(settings.embedColor),
    actions,
    description,
    fields: [...avatarBlock, ...fields],
    footer: { text: "Obrigado por impulsionar nossa comunidade." },
    image: settings.bannerEnabled && settings.bannerUrl ? {
      imageEnabled: true,
      imagePosition: "banner",
      imageUrl: settings.bannerUrl
    } : null,
    title: "Nova melhoria no servidor"
  });
}

async function sendBoosterLog(member: GuildMember, settings: BoosterSettings, result: {
  bannerSent: boolean;
  boostCount: number;
  boostLevel: number;
  errors: string[];
  historyId: string;
  messageId: string | null;
  messageSent: boolean;
  roleGiven: boolean;
}) {
  if (!settings.logChannelId) return;
  const channel = await member.guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return;
  await channel.send({
    components: [{
      type: 17,
      accent_color: result.errors.length ? 0xef4444 : parseColor(settings.embedColor),
      components: [{
        type: 10,
        content: [
          "# Log do Sistema Booster",
          `Usuário: ${member} (${member.id})`,
          `Boosts: ${result.boostCount}`,
          `Nível: ${result.boostLevel}`,
          `Cargo dado: ${result.roleGiven ? "Sim" : "Não"}`,
          `Mensagem enviada: ${result.messageSent ? "Sim" : "Não"}`,
          `Banner enviado: ${result.bannerSent ? "Sim" : "Não"}`,
          `Histórico: ${result.historyId}`,
          result.messageId ? `Mensagem: ${result.messageId}` : "",
          result.errors.length ? `Erros:\n${result.errors.join("\n")}` : ""
        ].filter(Boolean).join("\n")
      }]
    }],
    flags: MessageFlags.IsComponentsV2
  }).catch(() => undefined);
}

function applyVariables(template: string, input: { boostCount: number; boostLevel: number; guild: Guild | null; member?: GuildMember; roleId: string | null }) {
  const member = input.member;
  const date = `<t:${Math.floor(Date.now() / 1000)}:D>`;
  return template
    .replaceAll("{usuario}", member ? escapeMarkdown(member.user.globalName ?? member.user.username) : "Usuário")
    .replaceAll("{servidor}", escapeMarkdown(input.guild?.name ?? "Servidor"))
    .replaceAll("{boosts}", String(input.boostCount))
    .replaceAll("{nivel}", String(input.boostLevel))
    .replaceAll("{cargo}", input.roleId ? `<@&${input.roleId}>` : "Booster")
    .replaceAll("{data}", date)
    .replaceAll("{mencao}", member ? `<@${member.id}>` : "@Usuário")
    .slice(0, 3800);
}

function parseColor(value?: string | null) {
  const normalized = typeof value === "string" ? value.trim().replace(/^#/, "") : "";
  const parsed = /^[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized, 16) : ACCENT_FALLBACK;
  return Number.isFinite(parsed) ? parsed : ACCENT_FALLBACK;
}

function escapeMarkdown(value: string) {
  return value.replace(/([\\`*_~|>])/g, "\\$1");
}

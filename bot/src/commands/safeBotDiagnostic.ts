import { ChannelType, PermissionFlagsBits, SlashCommandBuilder, type GuildMember, type Message } from "discord.js";
import type { BotCommand } from "../types";
import { extractMessageDomains, extractUrlCandidates, isChannelIgnoredOrAllowed } from "../services/messageProtectionPolicy";
import type { SelfBotProtectionModuleId } from "../services/apiClient";
import { clearModerationSettingsCache } from "../services/moderationChannelPolicy";
import { clearSafeBotSetupCache } from "../services/safeBotService";

export const safeBotDiagnosticCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("safebot-diagnostico")
    .setDescription("Diagnostica as regras de links do SafeBot em um canal.")
    .addChannelOption((option) => option.setName("canal").setDescription("Canal ou thread que será analisado.").setRequired(false))
    .addStringOption((option) => option.setName("mensagem").setDescription("Texto ou URL de exemplo.").setMaxLength(1000).setRequired(false))
    .addBooleanOption((option) => option.setName("recarregar").setDescription("Força a invalidação do cache antes do diagnóstico.").setRequired(false)),
  moduleId: "safe-bot",
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({ content: "Comando disponível apenas em servidores.", ephemeral: true });
      return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const authorized = member && (
      member.id === interaction.guild.ownerId
      || member.permissions.has(PermissionFlagsBits.Administrator)
      || member.permissions.has(PermissionFlagsBits.ManageGuild)
    );
    if (!authorized) {
      await interaction.reply({ content: "Apenas administradores ou gerentes do servidor podem usar este diagnóstico.", ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    if (interaction.options.getBoolean("recarregar")) {
      clearModerationSettingsCache(interaction.guild.id);
      clearSafeBotSetupCache(interaction.guild.id);
    }
    const channel = interaction.options.getChannel("canal") ?? interaction.channel;
    if (!channel || channel.type === ChannelType.DM || !("isThread" in channel)) {
      await interaction.editReply("Selecione um canal ou thread válido deste servidor.");
      return;
    }

    const content = interaction.options.getString("mensagem") ?? "https://exemplo.com";
    const settings = await context.api.getSelfBotProtectionSettings(interaction.guild.id);
    const urls = extractUrlCandidates(content);
    const moduleId: SelfBotProtectionModuleId = urls.some((url) => /(?:discord\.gg|discord(?:app)?\.com\/invite)\//i.test(url))
      ? "anti-convites"
      : "anti-links";
    const message = {
      author: interaction.user,
      channel,
      channelId: channel.id,
      guild: interaction.guild,
      guildId: interaction.guild.id,
      member: member as GuildMember
    } as unknown as Message;
    const domains = extractMessageDomains(content);
    const decision = isChannelIgnoredOrAllowed(message, settings, moduleId, { domains, member });

    await interaction.editReply([
      "## Diagnóstico do sistema de links",
      `Proteção ativa: **${settings.enabled ? "sim" : "não"}**`,
      `Módulo: **${moduleId}** (${settings.moduleToggles[moduleId] ? "ativo" : "inativo"})`,
      `Canal analisado: <#${decision.channelId}>`,
      `Canal pai: ${decision.parentChannelId ? `<#${decision.parentChannelId}>` : "nenhum"}`,
      `Categoria: ${decision.categoryId ? `<#${decision.categoryId}>` : "nenhuma"}`,
      `Usuário: <@${interaction.user.id}>`,
      `Cargos encontrados: ${member.roles.cache.filter((role) => role.id !== interaction.guild!.id).map((role) => `<@&${role.id}>`).join(", ") || "nenhum"}`,
      `Canais permitidos para links: ${settings.linkChannelIds.map((id) => `<#${id}>`).join(", ") || "nenhum"}`,
      `Categorias ignoradas: ${settings.ignoredCategoryIds.map((id) => `<#${id}>`).join(", ") || "nenhuma"}`,
      `Cargos ignorados: ${settings.ignoredRoleIds.map((id) => `<@&${id}>`).join(", ") || "nenhum"}`,
      `Domínios detectados: ${domains.join(", ") || "nenhum"}`,
      `Resultado: **${decision.allowed ? "mensagem liberada" : "proteção aplicada"}**`,
      `Motivo: **${decision.reason ?? "nenhuma exceção correspondeu"}**`,
      decision.matchedId ? `Correspondência: \`${decision.matchedId}\`` : ""
    ].filter(Boolean).join("\n"));
  }
};

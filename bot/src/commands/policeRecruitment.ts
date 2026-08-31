import { ChannelType, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../types";
import { publishPoliceRecruitmentPanel } from "../services/policeRecruitmentService";

export const policeRecruitmentPanelCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("painel-recrutamento")
    .setDescription("Publica o painel do Sistema de Recrutamento Policial.")
    .addChannelOption((option) => option.setName("forum").setDescription("Fórum onde os relatórios serão organizados por recrutador.").addChannelTypes(ChannelType.GuildForum))
    .addChannelOption((option) => option.setName("categoria").setDescription("Categoria dos canais temporários.").addChannelTypes(ChannelType.GuildCategory))
    .addRoleOption((option) => option.setName("cargo-autorizado").setDescription("Cargo que pode iniciar recrutamentos."))
    .addRoleOption((option) => option.setName("cargo-supervisor").setDescription("Cargo que pode acompanhar canais temporários."))
    .addChannelOption((option) => option.setName("logs").setDescription("Canal de logs do recrutamento.").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addStringOption((option) => option.setName("corporacao").setDescription("Nome da corporação exibido no painel.").setMaxLength(100)),
  execute: publishPoliceRecruitmentPanel,
  moduleId: "police-recruitment"
};

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type ModalSubmitInteraction
} from "discord.js";
import { env } from "../config/env";
import type { BotContext } from "../types";
import type { ManualRegistrationSettings, ManualRegistrationSubmission } from "./apiClient";
import { ensureFivemGoalChannelForUser } from "./fivemGoalService";

const PREFIX = "manual_registration";

export async function publishManualRegistrationPanel(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild || !interaction.channel?.isSendable()) {
    await interaction.reply({ content: "Use este comando em um canal de servidor.", ephemeral: true });
    return;
  }

  const settings = await context.api.getManualRegistrationSettings(interaction.guild.id);

  if (!settings.enabled) {
    await interaction.reply({ content: "Cadastro Manual esta desativado na Dashboard.", ephemeral: true });
    return;
  }

  await interaction.channel.send(createPanelPayload(settings));
  await interaction.reply({ content: "Painel de Cadastro Manual publicado em Components V2.", ephemeral: true });
}

export async function handleManualRegistrationInteraction(interaction: Interaction, context: BotContext) {
  if (!("customId" in interaction) || !interaction.customId.startsWith(`${PREFIX}:`)) return false;

  if (interaction.isButton() && interaction.customId === `${PREFIX}:start`) {
    await showRegistrationModal(interaction, context);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith(`${PREFIX}:modal:`)) {
    await handleRegistrationSubmit(interaction, context);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:approve:`)) {
    await reviewSubmission(interaction, context, "approved");
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:reject:`)) {
    await reviewSubmission(interaction, context, "rejected");
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:view:`)) {
    const id = interaction.customId.split(":")[2] ?? "";
    await interaction.reply({ content: `ID da solicitacao: ${id}`, ephemeral: true });
    return true;
  }

  return false;
}

async function showRegistrationModal(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guildId) return;
  const settings = await context.api.getManualRegistrationSettings(interaction.guildId);
  const fields = settings.fields.slice(0, 5);
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:${interaction.guildId}`)
    .setTitle(settings.name.slice(0, 45) || "Cadastro Manual");

  fields.forEach((field) => {
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(field.label.slice(0, 45))
      .setPlaceholder(field.placeholder?.slice(0, 100) || "Digite aqui")
      .setRequired(field.required)
      .setStyle(field.style === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short);

    if (field.minLength !== null) input.setMinLength(field.minLength);
    if (field.maxLength !== null) input.setMaxLength(field.maxLength);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        input
      )
    );
  });

  await interaction.showModal(modal);
}

async function handleRegistrationSubmit(interaction: ModalSubmitInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });

  const settings = await context.api.getManualRegistrationSettings(interaction.guild.id);
  const fields = settings.fields.slice(0, 5).map((field) => ({
    id: field.id,
    label: field.label,
    value: interaction.fields.getTextInputValue(field.id) || "-"
  }));
  const submission = await context.api.createManualRegistrationSubmission({
    fields,
    guildId: interaction.guild.id,
    userAvatar: interaction.user.displayAvatarURL(),
    userId: interaction.user.id,
    username: interaction.user.tag
  });

  const approvalChannel = settings.approvalChannelId
    ? await interaction.guild.channels.fetch(settings.approvalChannelId).catch(() => null)
    : null;

  if (approvalChannel?.isSendable()) {
    const message = await approvalChannel.send(createReviewPayload(settings, submission));
    await context.api.updateManualRegistrationSubmissionMessage(submission.id, message.id).catch(() => null);
  }

  await interaction.editReply("Seu cadastro foi enviado para analise da equipe.");
}

async function reviewSubmission(
  interaction: ButtonInteraction,
  context: BotContext,
  status: "approved" | "rejected"
) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });

  const id = interaction.customId.split(":")[2] ?? "";
  const settings = await context.api.getManualRegistrationSettings(interaction.guild.id);
  const submission = await context.api.updateManualRegistrationSubmissionStatus(id, status, interaction.user.id);
  const member = await interaction.guild.members.fetch(submission.userId).catch(() => null);

  if (status === "approved" && member) {
    for (const roleId of settings.removeRoleIds) {
      await member.roles.remove(roleId).catch(() => null);
    }
    for (const roleId of settings.autoRoleIds) {
      await member.roles.add(roleId).catch(() => null);
    }
    await member.send("Seu cadastro foi aprovado com sucesso.\n\nAgora voce possui acesso ao servidor.\n\nSeja bem-vindo.").catch(() => null);
    await ensureFivemGoalChannelForUser(context, interaction.guild, submission.userId, member.user.username).catch((error) => {
      console.warn("[manual-registration] nao foi possivel criar canal de metas FiveM:", error instanceof Error ? error.message : error);
    });
  }

  if (status === "rejected" && member) {
    await member.send("Sua solicitacao de cadastro foi negada.\n\nVoce podera realizar uma nova tentativa posteriormente.\n\nCaso tenha duvidas, entre em contato com a equipe responsavel.").catch(() => null);
  }

  await interaction.message.edit(createReviewPayload(settings, submission)).catch(() => null);
  await interaction.editReply(status === "approved" ? "Cadastro aprovado." : "Cadastro reprovado.");
}

function createPanelPayload(settings: ManualRegistrationSettings) {
  const imageUrl = resolveImageUrl(settings.panelImage?.imageUrl ?? null);
  const components: Array<Record<string, unknown>> = [];

  if (imageUrl && settings.bannerPosition === "top") components.push(mediaGallery(imageUrl));
  components.push({
    type: 10,
    content: [
      `# ${settings.emoji ? `${settings.emoji} ` : ""}${settings.title}`,
      settings.description ?? "",
      settings.footerText ? `-# ${settings.footerText}` : ""
    ].filter(Boolean).join("\n\n")
  });
  if (imageUrl && settings.bannerPosition === "bottom") components.push(mediaGallery(imageUrl));

  return {
    allowedMentions: { parse: [] as never[] },
    components: [
      { type: 17, accent_color: parseColor(settings.color), components },
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:start`).setLabel(settings.name || "Iniciar cadastro").setStyle(ButtonStyle.Primary)
      )
    ],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function createReviewPayload(settings: ManualRegistrationSettings, submission: ManualRegistrationSubmission) {
  const statusText = submission.status === "approved" ? "Aprovado" : submission.status === "rejected" ? "Reprovado" : "Pendente";
  return {
    allowedMentions: { parse: [] as never[] },
    components: [
      {
        type: 17,
        accent_color: parseColor(settings.color),
        components: [
          { type: 10, content: `# ${settings.emoji ?? "📝"} Nova solicitacao de cadastro` },
          { type: 10, content: `Usuario: <@${submission.userId}>\nID: ${submission.userId}\nStatus: **${statusText}**` },
          { type: 14 },
          { type: 10, content: submission.fields.map((field) => `**${field.label}:** ${field.value}`).join("\n").slice(0, 3500) }
        ]
      },
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:approve:${submission.id}`).setLabel("Aprovar").setStyle(ButtonStyle.Success).setDisabled(submission.status !== "pending"),
        new ButtonBuilder().setCustomId(`${PREFIX}:reject:${submission.id}`).setLabel("Reprovar").setStyle(ButtonStyle.Danger).setDisabled(submission.status !== "pending"),
        new ButtonBuilder().setCustomId(`${PREFIX}:view:${submission.id}`).setLabel("Ver informacoes").setStyle(ButtonStyle.Secondary)
      )
    ],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function mediaGallery(imageUrl: string) {
  return { type: 12, items: [{ media: { url: imageUrl }, description: "manual registration banner" }] };
}

function resolveImageUrl(value: string | null) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const backendOrigin = env.BACKEND_API_URL ? new URL(env.BACKEND_API_URL).origin : "";
  return backendOrigin ? `${backendOrigin}${value.startsWith("/") ? value : `/${value}`}` : null;
}

function parseColor(value: string) {
  return Number.parseInt(value.replace("#", ""), 16) || 0x7c3aed;
}

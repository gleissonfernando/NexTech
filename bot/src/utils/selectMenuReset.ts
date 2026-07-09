import type {
  ChannelSelectMenuInteraction,
  ModalBuilder,
  RoleSelectMenuInteraction,
  StringSelectMenuInteraction,
  UserSelectMenuInteraction
} from "discord.js";

export type ResettableSelectInteraction =
  | ChannelSelectMenuInteraction
  | RoleSelectMenuInteraction
  | StringSelectMenuInteraction
  | UserSelectMenuInteraction;

export async function resetSelectMenuMessage(interaction: ResettableSelectInteraction) {
  const components = interaction.message.components.map((row) => row.toJSON());
  if (!components.length) return;
  await interaction.message.edit({ components }).catch(() => null);
}

export async function showModalAndResetSelect(interaction: ResettableSelectInteraction, modal: ModalBuilder) {
  await interaction.showModal(modal);
  void resetSelectMenuMessage(interaction);
}

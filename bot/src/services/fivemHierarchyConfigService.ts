import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type ModalSubmitInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction
} from "discord.js";
import type { BotContext } from "../types";
import type { FivemHierarchyEntry, FivemHierarchyPanel } from "./apiClient";
import { componentsV2Payload } from "./panelVisualRenderer";
import { replaceSystemEmojis, systemComponentEmoji, systemEmojiText } from "./systemEmojiService";

const PREFIX = "hierarchy_config";
const sessions = new Map<string, { panelId?: string; pendingPositionName?: string; selectedChannelId?: string; selectedPositionId?: string; selectedRoleId?: string; updatedAt: number }>();

export async function openHierarchyConfig(interaction: ChatInputCommandInteraction, context: BotContext) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const panels = await manageable(interaction, context);
  if (!panels.length && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.editReply(privateMessage("Acesso negado", "Você não possui autorização para gerenciar esta hierarquia."));
    return;
  }
  sessions.delete(sessionKey(interaction));
  await interaction.editReply(mainPanel(interaction, panels));
}

export async function handleFivemHierarchyConfigInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.guild || !("customId" in interaction) || !interaction.customId.startsWith(`${PREFIX}:`)) return false;
  try {
    if (interaction.isButton()) await handleButton(interaction, context);
    else if (interaction.isStringSelectMenu()) await handleStringSelect(interaction, context);
    else if (interaction.isChannelSelectMenu()) await handleChannelSelect(interaction, context);
    else if (interaction.isRoleSelectMenu()) await handleRoleSelect(interaction, context);
    else if (interaction.isModalSubmit()) await handleModal(interaction, context);
  } catch (error) {
    const message = apiError(error);
    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) await interaction.followUp(privateMessage("Não foi possível concluir", message)).catch(() => null);
      else await interaction.reply(privateMessage("Não foi possível concluir", message)).catch(() => null);
    }
  }
  return true;
}

async function handleButton(interaction: ButtonInteraction, context: BotContext) {
  const [, action, id, extra] = interaction.customId.split(":");
  if (action === "close") {
    sessions.delete(sessionKey(interaction));
    await interaction.update(v2("Configuração encerrada", "As alterações confirmadas permanecem salvas e sincronizadas.", []));
    return;
  }
  if (action === "back") return void await showMain(interaction, context);
  if (action === "create") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return void await deny(interaction);
    await interaction.showModal(new ModalBuilder().setCustomId(`${PREFIX}:create_submit`).setTitle("Criar hierarquia").addComponents(input("name", "Nome da hierarquia", TextInputStyle.Short, 100)));
    return;
  }
  if (action === "edit" || action === "channels") return void await showPanelSelect(interaction, context, action);
  if (action === "refresh_all") {
    await interaction.deferUpdate();
    const panels = await manageable(interaction, context);
    const published = panels.filter((panel) => panel.panelChannelId && panel.enabled);
    const results = await Promise.allSettled(published.map((panel) => context.api.publishFivemHierarchyPanelFromBot(panel.id, actor(interaction))));
    await interaction.editReply(mainPanel(interaction, await manageable(interaction, context), `Atualização concluída: ${results.filter((item) => item.status === "fulfilled").length}/${published.length} publicação(ões).`));
    return;
  }
  if (action === "editor") return void await showEditor(interaction, context, id);
  if (action === "add_position") {
    await requirePanel(interaction, context, id);
    session(interaction).panelId = id;
    await interaction.showModal(new ModalBuilder().setCustomId(`${PREFIX}:position_name:${id}`).setTitle("Adicionar posição").addComponents(input("name", "Nome da posição", TextInputStyle.Short, 80)));
    return;
  }
  if (action === "rename") {
    const panel = await requirePanel(interaction, context, id);
    await interaction.showModal(new ModalBuilder().setCustomId(`${PREFIX}:rename_submit:${id}`).setTitle("Alterar nome").addComponents(input("name", "Novo nome da hierarquia", TextInputStyle.Short, 100, panel.name)));
    return;
  }
  if (action === "save" || action === "finish") {
    const panel = await requirePanel(interaction, context, id);
    if (action === "finish" && !panel.hierarchies.length) return void await notice(interaction, "Validação", "Adicione pelo menos uma posição antes de finalizar.");
    const missing = panel.hierarchies.filter((position) => !interaction.guild!.roles.cache.has(position.roleId));
    if (action === "finish" && missing.length) return void await notice(interaction, "Validação", `Existem ${missing.length} cargo(s) não encontrado(s). Substitua-os antes de finalizar.`);
    await interaction.deferUpdate();
    const saved = await context.api.updateFivemHierarchyPanelFromBot(id!, { ...actor(interaction), panel: { configRevision: panel.configRevision, status: action === "finish" ? "completed" : "draft" } });
    await interaction.editReply(editorPanel(interaction, saved, action === "finish" ? "Hierarquia finalizada. Agora configure um canal para publicá-la." : "Progresso da hierarquia salvo com sucesso."));
    return;
  }
  if (action === "remove_position") return void await showPositionSelect(interaction, context, id, "remove");
  if (action === "edit_position") return void await showPositionSelect(interaction, context, id, "edit");
  if (action === "reorder") return void await showPositionSelect(interaction, context, id, "reorder");
  if (action === "edit_confirm") {
    const panel = await requirePanel(interaction, context, id);
    const state = session(interaction);
    const previous = panel.hierarchies.find((item) => item.id === state.selectedPositionId);
    if (!previous || !state.pendingPositionName || !state.selectedRoleId) return void await notice(interaction, "Sessão expirada", "Recarregue os dados e tente novamente.");
    if (panel.hierarchies.some((item) => item.id !== previous.id && (item.roleId === state.selectedRoleId || normalize(item.name) === normalize(state.pendingPositionName!)))) return void await notice(interaction, "Posição duplicada", "O nome ou cargo já está em uso nesta hierarquia.");
    await interaction.deferUpdate();
    const selectedRole = interaction.guild!.roles.cache.get(state.selectedRoleId);
    const positions = panel.hierarchies.map((item) => item.id === previous.id ? { ...item, name: state.pendingPositionName!, roleId: state.selectedRoleId!, roleName: selectedRole?.name ?? item.roleName ?? null } : item);
    const updated = await updatePositions(context, interaction, panel, positions);
    await interaction.editReply(editorPanel(interaction, updated, `A posição “${previous.name}” foi alterada para “${state.pendingPositionName}”.`));
    return;
  }
  if (action === "remove_confirm") {
    const panel = await requirePanel(interaction, context, id);
    const position = panel.hierarchies.find((item) => item.id === (extra ?? session(interaction).selectedPositionId));
    if (!position) return void await notice(interaction, "Posição não encontrada", "Recarregue os dados e tente novamente.");
    await interaction.deferUpdate();
    const updated = await updatePositions(context, interaction, panel, panel.hierarchies.filter((item) => item.id !== position.id));
    await interaction.editReply(editorPanel(interaction, updated, `A posição “${position.name}” foi removida. O cargo do Discord não foi excluído.`));
    return;
  }
  if (["up", "down", "first", "last"].includes(action ?? "")) {
    const panel = await requirePanel(interaction, context, id);
    const selected = extra ?? session(interaction).selectedPositionId;
    const ordered = [...panel.hierarchies].sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((item) => item.id === selected);
    if (index < 0) return void await notice(interaction, "Selecione uma posição", "Escolha a posição antes de alterar a ordem.");
    const target = action === "up" ? Math.max(0, index - 1) : action === "down" ? Math.min(ordered.length - 1, index + 1) : action === "first" ? 0 : ordered.length - 1;
    const [moved] = ordered.splice(index, 1);
    ordered.splice(target, 0, moved!);
    await interaction.deferUpdate();
    const updated = await updatePositions(context, interaction, panel, ordered);
    await interaction.editReply(reorderPanel(updated, selected!, "Ordem salva e sincronizada."));
    return;
  }
  if (action === "channel_screen") return void await showChannelEditor(interaction, context, id);
  if (action === "save_channel") {
    const panel = await requirePanel(interaction, context, id);
    const channelId = session(interaction).selectedChannelId;
    if (!channelId) return void await notice(interaction, "Canal não selecionado", "Escolha um canal de texto antes de salvar.");
    const channel = await interaction.guild!.channels.fetch(channelId).catch(() => null);
    const me = interaction.guild!.members.me;
    if (!channel?.isTextBased() || channel.isDMBased() || !me || !channel.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
      return void await notice(interaction, "Canal inválido", "O bot precisa visualizar e enviar mensagens no canal escolhido.");
    }
    await interaction.deferUpdate();
    const updated = await context.api.updateFivemHierarchyPanelFromBot(id!, { ...actor(interaction), panel: { configRevision: panel.configRevision, panelChannelId: channelId } });
    await interaction.editReply(channelPanel(updated, "Canal da hierarquia salvo e sincronizado com a dashboard."));
    return;
  }
  if (action === "publish" || action === "unpublish") {
    const panel = await requirePanel(interaction, context, id);
    if (action === "publish" && !panel.panelChannelId) return void await notice(interaction, "Canal não configurado", "Salve o canal antes de publicar.");
    await interaction.deferUpdate();
    if (action === "publish" && !panel.enabled) {
      await context.api.updateFivemHierarchyPanelFromBot(panel.id, { ...actor(interaction), panel: { configRevision: panel.configRevision, enabled: true, status: "completed" } });
    }
    const latest = (await manageable(interaction, context)).find((item) => item.id === panel.id) ?? panel;
    const updated = await context.api.publishFivemHierarchyPanelFromBot(id!, { ...actor(interaction), remove: action === "unpublish" });
    void latest;
    await interaction.editReply(channelPanel(updated, action === "publish" ? "O painel hierárquico publicado foi atualizado com sucesso." : "Publicação removida com sucesso."));
    return;
  }
  if (action === "delete") {
    const panel = await requirePanel(interaction, context, id);
    await interaction.update(confirmDeletePanel(panel));
    return;
  }
  if (action === "delete_confirm") {
    await requirePanel(interaction, context, id);
    await interaction.deferUpdate();
    await context.api.deleteFivemHierarchyPanelFromBot(id!, actor(interaction));
    await interaction.editReply(mainPanel(interaction, await manageable(interaction, context), "Hierarquia excluída após confirmação."));
  }
}

async function handleStringSelect(interaction: StringSelectMenuInteraction, context: BotContext) {
  const [, action] = interaction.customId.split(":");
  const value = interaction.values[0]!;
  if (action === "edit_select") return void await showEditor(interaction, context, value);
  if (action === "channel_select_panel") return void await showChannelEditor(interaction, context, value);
  if (action === "remove_select") {
    const panelId = session(interaction).panelId!;
    const panel = await requirePanel(interaction, context, panelId);
    const position = panel.hierarchies.find((item) => item.id === value);
    if (!position) return void await deny(interaction);
    session(interaction).selectedPositionId = position.id;
    await interaction.update(confirmRemovePanel(panel, position));
    return;
  }
  if (action === "reorder_select") {
    const panelId = session(interaction).panelId!;
    const panel = await requirePanel(interaction, context, panelId);
    session(interaction).selectedPositionId = value;
    await interaction.update(reorderPanel(panel, value));
    return;
  }
  if (action === "edit_select_position") {
    const panelId = session(interaction).panelId!;
    const panel = await requirePanel(interaction, context, panelId);
    const position = panel.hierarchies.find((item) => item.id === value);
    if (!position) return void await deny(interaction);
    session(interaction).selectedPositionId = position.id;
    await interaction.showModal(new ModalBuilder().setCustomId(`${PREFIX}:position_edit_name:${panel.id}`).setTitle("Editar posição").addComponents(input("name", "Novo nome da posição", TextInputStyle.Short, 80, position.name)));
  }
}

async function handleChannelSelect(interaction: ChannelSelectMenuInteraction, context: BotContext) {
  const [, action, panelId] = interaction.customId.split(":");
  if (action !== "channel_value") return;
  const panel = await requirePanel(interaction, context, panelId);
  session(interaction).selectedChannelId = interaction.values[0];
  await interaction.update(channelPanel(panel, `Canal selecionado: <#${interaction.values[0]}>. Clique em **Salvar canal** para confirmar.`));
}

async function handleRoleSelect(interaction: RoleSelectMenuInteraction, context: BotContext) {
  const [, action, panelId] = interaction.customId.split(":");
  if (action === "position_edit_role") {
    const panel = await requirePanel(interaction, context, panelId);
    const state = session(interaction);
    const previous = panel.hierarchies.find((item) => item.id === state.selectedPositionId);
    const role = interaction.roles.first();
    if (!previous || !state.pendingPositionName || !role) return void await notice(interaction, "Sessão expirada", "Recarregue os dados e tente novamente.");
    state.selectedRoleId = role.id;
    await interaction.update(v2("Prévia da alteração", `**Nome antigo:** ${previous.name}\n**Nome novo:** ${state.pendingPositionName}\n**Cargo antigo:** <@&${previous.roleId}>\n**Cargo novo:** <@&${role.id}>\n**Ordem:** ${previous.order}`, [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:edit_confirm:${panel.id}`).setLabel("Confirmar alteração").setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`${PREFIX}:editor:${panel.id}`).setLabel("Cancelar").setStyle(ButtonStyle.Secondary))]));
    return;
  }
  if (action !== "position_role") return;
  const panel = await requirePanel(interaction, context, panelId);
  const name = session(interaction).pendingPositionName;
  const role = interaction.roles.first();
  if (!name || !role) return void await notice(interaction, "Sessão expirada", "Execute `/hierarquia config` novamente.");
  if (panel.hierarchies.some((item) => item.roleId === role.id || normalize(item.name) === normalize(name))) {
    return void await notice(interaction, "Posição duplicada", "O nome ou o cargo já está sendo usado nesta hierarquia.");
  }
  await interaction.deferUpdate();
  const position: FivemHierarchyEntry = { active: true, color: null, description: null, emoji: systemEmojiText("homem", interaction.guild), id: randomUUID(), limit: null, name, order: panel.hierarchies.length + 1, roleId: role.id, roleName: role.name };
  const updated = await updatePositions(context, interaction, panel, [...panel.hierarchies, position]);
  session(interaction).pendingPositionName = undefined;
  await interaction.editReply(editorPanel(interaction, updated, `A posição “${name}” foi vinculada ao cargo <@&${role.id}>.`));
}

async function handleModal(interaction: ModalSubmitInteraction, context: BotContext) {
  const [, action, panelId] = interaction.customId.split(":");
  const name = interaction.fields.getTextInputValue("name").trim();
  if (action === "create_submit") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return void await deny(interaction);
    await interaction.deferUpdate();
    const panel = await context.api.createFivemHierarchyPanelFromBot({ ...actor(interaction), clientRequestId: randomUUID(), panel: { color: "#22c55e", description: "Hierarquia atualizada automaticamente pelos cargos do servidor.", enabled: false, footerEnabled: true, footerText: "Atualizado automaticamente", hierarchies: [], name, status: "draft", title: name } });
    session(interaction).panelId = panel.id;
    await interaction.editReply(editorPanel(interaction, panel, `A hierarquia “${name}” foi criada como rascunho.`));
    return;
  }
  if (action === "position_name") {
    await requirePanel(interaction, context, panelId);
    session(interaction).panelId = panelId;
    session(interaction).pendingPositionName = name;
    await interaction.deferUpdate();
    await interaction.editReply(rolePicker(panelId!, name));
    return;
  }
  if (action === "rename_submit") {
    const panel = await requirePanel(interaction, context, panelId);
    await interaction.deferUpdate();
    const updated = await context.api.updateFivemHierarchyPanelFromBot(panel.id, { ...actor(interaction), panel: { configRevision: panel.configRevision, name, title: name } });
    await interaction.editReply(editorPanel(interaction, updated, `Hierarquia renomeada para “${name}”.`));
    return;
  }
  if (action === "position_edit_name") {
    const panel = await requirePanel(interaction, context, panelId);
    const state = session(interaction);
    const position = panel.hierarchies.find((item) => item.id === state.selectedPositionId);
    if (!position) return void await deny(interaction);
    state.pendingPositionName = name;
    await interaction.deferUpdate();
    const select = new RoleSelectMenuBuilder().setCustomId(`${PREFIX}:position_edit_role:${panel.id}`).setPlaceholder("Escolha o novo cargo").setDefaultRoles(position.roleId).setMinValues(1).setMaxValues(1);
    await interaction.editReply(v2("Editar posição", `**Nome anterior:** ${position.name}\n**Novo nome:** ${name}\nAgora escolha o cargo para visualizar a prévia.`, [new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(select), new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:editor:${panel.id}`).setLabel("Voltar").setStyle(ButtonStyle.Secondary))]));
  }
}

async function showMain(interaction: ButtonInteraction | StringSelectMenuInteraction, context: BotContext) {
  await interaction.deferUpdate();
  await interaction.editReply(mainPanel(interaction, await manageable(interaction, context)));
}

async function showPanelSelect(interaction: ButtonInteraction, context: BotContext, mode: "edit" | "channels") {
  const panels = await manageable(interaction, context);
  if (!panels.length) return void await notice(interaction, "Nenhuma hierarquia", "Você ainda não possui hierarquias autorizadas.");
  const select = new StringSelectMenuBuilder().setCustomId(`${PREFIX}:${mode === "edit" ? "edit_select" : "channel_select_panel"}`).setPlaceholder("Escolha a hierarquia").addOptions(panels.slice(0, 25).map((panel) => ({ label: panel.name.slice(0, 100), value: panel.id, description: `${statusName(panel.status)} · ${panel.hierarchies.length} posição(ões)`.slice(0, 100) })));
  await interaction.update(v2(mode === "edit" ? "Editar hierarquia" : "Configurações de canais", "Somente as hierarquias que você pode gerenciar são exibidas.", [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select), backRow()]));
}

async function showEditor(interaction: ButtonInteraction | StringSelectMenuInteraction, context: BotContext, panelId?: string) {
  const panel = await requirePanel(interaction, context, panelId);
  session(interaction).panelId = panel.id;
  if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
  await interaction.editReply(editorPanel(interaction, panel));
}

async function showPositionSelect(interaction: ButtonInteraction, context: BotContext, panelId: string | undefined, mode: "edit" | "remove" | "reorder") {
  const panel = await requirePanel(interaction, context, panelId);
  if (!panel.hierarchies.length) return void await notice(interaction, "Nenhuma posição", "Adicione uma posição primeiro.");
  session(interaction).panelId = panel.id;
  const select = new StringSelectMenuBuilder().setCustomId(`${PREFIX}:${mode === "edit" ? "edit_select_position" : `${mode}_select`}`).setPlaceholder("Selecione a posição").addOptions(panel.hierarchies.slice(0, 25).sort((a, b) => a.order - b.order).map((item) => ({ label: `${item.order}. ${item.name}`.slice(0, 100), value: item.id, description: `Cargo ${item.roleId}` })));
  await interaction.update(v2(mode === "remove" ? "Remover posição" : mode === "edit" ? "Editar posição" : "Reordenar posições", `Hierarquia: **${panel.name}**`, [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select), new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:editor:${panel.id}`).setLabel("Voltar").setStyle(ButtonStyle.Secondary))]));
}

async function showChannelEditor(interaction: ButtonInteraction | StringSelectMenuInteraction, context: BotContext, panelId?: string) {
  const panel = await requirePanel(interaction, context, panelId);
  session(interaction).panelId = panel.id;
  session(interaction).selectedChannelId = panel.panelChannelId ?? undefined;
  if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
  await interaction.editReply(channelPanel(panel));
}

async function manageable(interaction: Interaction, context: BotContext) {
  return context.api.getManageableFivemHierarchyPanels(actor(interaction));
}

async function requirePanel(interaction: Interaction, context: BotContext, panelId?: string) {
  if (!panelId) throw new Error("Hierarquia não informada.");
  const panel = (await manageable(interaction, context)).find((item) => item.id === panelId);
  if (!panel) throw new Error("Você não possui autorização para gerenciar esta hierarquia.");
  return panel;
}

async function updatePositions(context: BotContext, interaction: Interaction, panel: FivemHierarchyPanel, positions: FivemHierarchyEntry[]) {
  const ordered = positions.map((item, index) => ({ ...item, order: index + 1 }));
  return context.api.updateFivemHierarchyPanelFromBot(panel.id, { ...actor(interaction), panel: { configRevision: panel.configRevision, hierarchies: ordered } });
}

function mainPanel(interaction: Interaction, panels: FivemHierarchyPanel[], message?: string) {
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:channels`).setEmoji(systemComponentEmoji("discord", interaction.guild)).setLabel("Configurações de canais").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}:create`).setEmoji(systemComponentEmoji("mais", interaction.guild)).setLabel("Criar hierarquia").setStyle(ButtonStyle.Success).setDisabled(!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)),
    new ButtonBuilder().setCustomId(`${PREFIX}:edit`).setEmoji(systemComponentEmoji("prancheta_caneta", interaction.guild)).setLabel("Editar hierarquia").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}:refresh_all`).setEmoji(systemComponentEmoji("relogio", interaction.guild)).setLabel("Atualizar painel").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}:close`).setEmoji(systemComponentEmoji("porta", interaction.guild)).setLabel("Fechar configuração").setStyle(ButtonStyle.Danger)
  );
  return v2(`${systemEmojiText("engrenagem", interaction.guild)} Configuração do Sistema Hierárquico`, `**Servidor:** ${interaction.guild?.name}\n**Responsável:** <@${interaction.user.id}>\n**Hierarquias autorizadas:** ${panels.length}\n\nDashboard e Discord usam a mesma fonte de dados. Todas as alterações confirmadas são salvas, sincronizadas e registradas.${message ? `\n\n${systemEmojiText("visto", interaction.guild)} ${message}` : ""}`, [buttons], interaction.guild);
}

function editorPanel(interaction: Interaction, panel: FivemHierarchyPanel, message?: string) {
  const positions = [...panel.hierarchies].sort((a, b) => a.order - b.order).map((item) => `${item.order}. **${item.name}** — ${interaction.guild?.roles.cache.has(item.roleId) ? `<@&${item.roleId}>` : `Cargo não encontrado (${item.roleId})`}`).join("\n") || "*Nenhuma posição cadastrada.*";
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:add_position:${panel.id}`).setEmoji(systemComponentEmoji("mais", interaction.guild)).setLabel("Adicionar posição").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}:rename:${panel.id}`).setEmoji(systemComponentEmoji("prancheta_caneta", interaction.guild)).setLabel("Alterar nome").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}:edit_position:${panel.id}`).setEmoji(systemComponentEmoji("engrenagem", interaction.guild)).setLabel("Editar posição").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}:remove_position:${panel.id}`).setEmoji(systemComponentEmoji("exclamacao", interaction.guild)).setLabel("Remover posição").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`${PREFIX}:reorder:${panel.id}`).setEmoji(systemComponentEmoji("prancheta", interaction.guild)).setLabel("Reordenar").setStyle(ButtonStyle.Secondary)
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:save:${panel.id}`).setEmoji(systemComponentEmoji("salvar", interaction.guild)).setLabel("Salvar progresso").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}:finish:${panel.id}`).setEmoji(systemComponentEmoji("visto", interaction.guild)).setLabel("Terminei a hierarquia").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}:channel_screen:${panel.id}`).setEmoji(systemComponentEmoji("discord", interaction.guild)).setLabel("Canais/Publicação").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}:delete:${panel.id}`).setEmoji(systemComponentEmoji("perigo", interaction.guild)).setLabel(panel.status === "draft" ? "Cancelar criação" : "Excluir hierarquia").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`${PREFIX}:back`).setEmoji(systemComponentEmoji("porta", interaction.guild)).setLabel("Voltar").setStyle(ButtonStyle.Secondary)
  );
  return v2(`${systemEmojiText("prancheta", interaction.guild)} Montagem da Hierarquia — ${panel.name}`, `**Status:** ${statusName(panel.status)}\n**Posições:** ${panel.hierarchies.length}\n**Revisão:** ${panel.configRevision}\n**Último salvamento:** <t:${Math.floor(Date.parse(panel.updatedAt) / 1000)}:R>\n\n${positions}${message ? `\n\n${systemEmojiText("visto", interaction.guild)} ${message}` : ""}`, [row1, row2], interaction.guild);
}

function channelPanel(panel: FivemHierarchyPanel, message?: string) {
  const channel = new ChannelSelectMenuBuilder().setCustomId(`${PREFIX}:channel_value:${panel.id}`).setPlaceholder("Escolha o canal de publicação").setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1);
  if (panel.panelChannelId) channel.setDefaultChannels(panel.panelChannelId);
  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:save_channel:${panel.id}`).setEmoji(systemComponentEmoji("salvar")).setLabel("Salvar canal").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}:publish:${panel.id}`).setEmoji(systemComponentEmoji("prancheta")).setLabel(panel.panelMessageId ? "Atualizar publicação" : "Publicar hierarquia").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}:unpublish:${panel.id}`).setEmoji(systemComponentEmoji("exclamacao")).setLabel("Remover publicação").setStyle(ButtonStyle.Danger).setDisabled(!panel.panelMessageId),
    new ButtonBuilder().setCustomId(`${PREFIX}:editor:${panel.id}`).setEmoji(systemComponentEmoji("porta")).setLabel("Voltar").setStyle(ButtonStyle.Secondary)
  );
  const managers = [...panel.managerUserIds.map((id) => `<@${id}>`), ...panel.managerRoleIds.map((id) => `<@&${id}>`)].join(" ") || "Somente administradores do servidor";
  const command = [...panel.commandUserIds.map((id) => `<@${id}>`), ...panel.commandRoleIds.map((id) => `<@&${id}>`)].join(" ") || "Não configurado";
  return v2(`${systemEmojiText("discord")} Configurações de canais`, `**Hierarquia:** ${panel.name}\n**Canal:** ${panel.panelChannelId ? `<#${panel.panelChannelId}>` : "Não configurado"}\n**Publicação:** ${panel.panelMessageId ? "Ativa" : "Não publicada"}\n**Última publicação:** ${panel.publishedAt ? `<t:${Math.floor(Date.parse(panel.publishedAt) / 1000)}:F>` : "-"}\n**Posições:** ${panel.hierarchies.length}\n**Gestores:** ${managers}\n**Comando:** ${command}\n**Mensagem:** ${panel.panelMessageId ?? "-"}${message ? `\n\n${systemEmojiText("visto")} ${message}` : ""}`, [new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(channel), actions]);
}

function rolePicker(panelId: string, name: string) {
  const select = new RoleSelectMenuBuilder().setCustomId(`${PREFIX}:position_role:${panelId}`).setPlaceholder("Escolha o cargo do Discord").setMinValues(1).setMaxValues(1);
  return v2(`${systemEmojiText("homem")} Vincular cargo`, `Posição: **${name}**\nEscolha o cargo que representa esta posição.`, [new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(select), new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:editor:${panelId}`).setEmoji(systemComponentEmoji("porta")).setLabel("Voltar").setStyle(ButtonStyle.Secondary))]);
}

function confirmRemovePanel(panel: FivemHierarchyPanel, position: FivemHierarchyEntry) {
  return v2(`${systemEmojiText("perigo")} Confirmar remoção`, `Deseja remover a posição **${position.name}** e o vínculo <@&${position.roleId}> desta hierarquia? O cargo real não será apagado.`, [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:remove_confirm:${panel.id}`).setEmoji(systemComponentEmoji("exclamacao")).setLabel("Confirmar remoção").setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`${PREFIX}:editor:${panel.id}`).setEmoji(systemComponentEmoji("porta")).setLabel("Cancelar").setStyle(ButtonStyle.Secondary))]);
}

function confirmDeletePanel(panel: FivemHierarchyPanel) {
  return v2(`${systemEmojiText("perigo")} Confirmar exclusão`, `Deseja realmente excluir a hierarquia **${panel.name}**? A publicação também será removida.`, [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:delete_confirm:${panel.id}`).setEmoji(systemComponentEmoji("exclamacao")).setLabel("Confirmar exclusão").setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`${PREFIX}:editor:${panel.id}`).setEmoji(systemComponentEmoji("engrenagem")).setLabel("Continuar configurando").setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(`${PREFIX}:back`).setEmoji(systemComponentEmoji("porta")).setLabel("Voltar").setStyle(ButtonStyle.Secondary))]);
}

function reorderPanel(panel: FivemHierarchyPanel, selectedId: string, message?: string) {
  const selected = panel.hierarchies.find((item) => item.id === selectedId);
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:up:${panel.id}:${selectedId}`).setEmoji(systemComponentEmoji("acessar")).setLabel("Subir").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}:down:${panel.id}:${selectedId}`).setEmoji(systemComponentEmoji("porta")).setLabel("Descer").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}:first:${panel.id}:${selectedId}`).setEmoji(systemComponentEmoji("visto")).setLabel("Mover para o início").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}:last:${panel.id}:${selectedId}`).setEmoji(systemComponentEmoji("prancheta_acertos")).setLabel("Mover para o final").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}:editor:${panel.id}`).setEmoji(systemComponentEmoji("porta")).setLabel("Voltar").setStyle(ButtonStyle.Secondary)
  );
  return v2(`${systemEmojiText("prancheta")} Reordenar posições`, `**Selecionada:** ${selected?.name ?? "-"}\n\n${panel.hierarchies.slice().sort((a, b) => a.order - b.order).map((item) => `${item.order}. ${item.name}`).join("\n")}${message ? `\n\n${systemEmojiText("visto")} ${message}` : ""}`, [buttons]);
}

function v2(title: string, text: string, components: unknown[], guild: Parameters<typeof replaceSystemEmojis>[1] = null): any {
  return componentsV2Payload({ accentColor: 0x22c55e, components: [{ type: 10, content: replaceSystemEmojis(`# ${title}\n${text}`, guild) }, ...components], ephemeral: true });
}

function privateMessage(title: string, text: string) { return v2(title, text, []); }
function backRow() { return new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:back`).setLabel("Voltar").setStyle(ButtonStyle.Secondary)); }
function input(id: string, label: string, style: TextInputStyle, max: number, value?: string) { const field = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setMaxLength(max).setRequired(true); if (value) field.setValue(value); return new ActionRowBuilder<TextInputBuilder>().addComponents(field); }
function sessionKey(interaction: Interaction) { return `${interaction.guildId}:${interaction.user.id}`; }
function session(interaction: Interaction) { const key = sessionKey(interaction); const existing = sessions.get(key); const current = existing && Date.now() - existing.updatedAt < 15 * 60_000 ? existing : { updatedAt: Date.now() }; current.updatedAt = Date.now(); sessions.set(key, current); return current; }
function actor(interaction: Interaction) { const member = interaction.guild?.members.cache.get(interaction.user.id); return { actorId: interaction.user.id, actorRoleIds: member ? [...member.roles.cache.keys()] : [], guildId: interaction.guildId!, isGuildManager: Boolean(member?.permissions.has(PermissionFlagsBits.ManageGuild)) }; }
function normalize(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase(); }
function statusName(status: FivemHierarchyPanel["status"]) { return status === "published" ? "Publicada" : status === "completed" ? "Concluída" : status === "disabled" ? "Desativada" : "Em configuração"; }
function apiError(error: unknown) { const response = (error as { response?: { data?: { message?: string } } })?.response?.data?.message; return response || (error instanceof Error ? error.message : "Erro inesperado."); }
async function deny(interaction: Interaction & { reply: Function }) { await interaction.reply(privateMessage("Acesso negado", "Você não possui autorização para gerenciar esta hierarquia.")); }
async function notice(interaction: ButtonInteraction | RoleSelectMenuInteraction, title: string, text: string) { await interaction.reply(privateMessage(title, text)); }

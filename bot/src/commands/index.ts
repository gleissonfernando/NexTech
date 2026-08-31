import { Collection } from "discord.js";
import { banCommand } from "./ban";
import { advertirCommand } from "./advertir";
import { clearCommand } from "./clear";
import { deleteServeCommand } from "./deleteServe";
import { emojiClonerCommand } from "./emojiCloner";
import { gravarCommand } from "./gravar";
import { fivemFinanceCommand } from "./fivemFinance";
import { gastosCommand, resetarGastosCommand } from "../services/fivemExpenseService";
import { municaoCommand, municaoConfiguracaoCommand } from "../services/ammunitionService";
import { armasConfigCommand } from "../services/weaponSaleService";
import { acaoCommand } from "../services/fivemActionService";
import { bauCommand } from "../services/factionChestService";
import { lavagemCommand } from "./lavagem";
import { hierarchyCommand } from "../services/fivemHierarchyService";
import { setCommand } from "./manualRegistration";
import { musicCommands } from "./music";
import { notificarCommand } from "./notificar";
import { pingCommand } from "./ping";
import { serverClonerCommand } from "./serverCloner";
import { serverGeneratorCommand } from "./serverGenerator";
import { ticketCommand } from "./ticket";
import { iabCommand, sistemaCommand } from "./reportSystem";
import { policePatrolReportCommand, viewPolicePatrolReportCommand } from "./policePatrolReports";
import { policeRecruitmentPanelCommand } from "./policeRecruitment";
import { policeHiddenChannelCommand } from "../services/policeHiddenChannelService";
import { dmBarCommand } from "../services/dmBarService";
import { dafCommand, escalaDafCommand } from "../services/dafScaleService";
import { policeSubpoenaCommand } from "../services/policeSubpoenaService";
import { courseCommand, cursosHistoricoCommand, historicoEsquecimentoCommand, instrutoresCommand, publicarCursoCommand, removerCursoHistoricoCommand } from "../services/courseSystemService";
import { rhAdminCommand } from "../services/rhAdminService";
import { removerCommand } from "./remover";
import { messageControlCommand } from "../services/messageControlService";
import { visibleMessageActivateCommand, visibleMessageDeactivateCommand } from "../services/visibleMessageService";
import { livesCommand } from "../services/liveService";
import { consultaPontosCommand, fecharPontoCommand, pontosAutomaticosCommand, pontosCommand } from "../services/autoActivityClockBotService";
import { barraCommand, relogioDePontoCommand } from "../services/policeTimeClockBotService";
import { vehicleAbandonmentPanelCommand } from "../services/vehicleAbandonmentService";
import { qruCommand, rankCommand, rankingCommandQru } from "../services/policeQruService";
import { policePromotionHistoryAliasCommand, policePromotionHistoryCommand, policePromotionsCommand } from "../services/policePromotionService";
import { policeRankUpConfigCommand } from "../services/policeRankUpService";
import { recrutamentoCommand, ztkResetCommand } from "../services/ztkWebhookService";
import { nexTechInviteCommand } from "../services/nexTechInviteService";
import { safeBotDiagnosticCommand } from "./safeBotDiagnostic";
import { cancelarEdicaoMetaCommand, editarMetaCommand, fechaMetaCommand, fechamentoMetaCommand, gerenciamentoFarmingCommand, resumoMetaCommand } from "../services/fivemGoalService";
import type { BotCommand } from "../types";

export function createCommandCollection() {
  const commands = new Collection<string, BotCommand>();

  [
    pingCommand,
    advertirCommand,
    banCommand,
    clearCommand,
    deleteServeCommand,
    emojiClonerCommand,
    gravarCommand,
    fivemFinanceCommand,
    gastosCommand,
    resetarGastosCommand,
  municaoCommand,
  municaoConfiguracaoCommand,
  armasConfigCommand,
    acaoCommand,
    bauCommand,
    lavagemCommand,
    hierarchyCommand,
    setCommand,
    ...musicCommands,
    notificarCommand,
    ticketCommand,
    policePatrolReportCommand,
    viewPolicePatrolReportCommand,
    policeRecruitmentPanelCommand,
    policeHiddenChannelCommand,
    dmBarCommand,
    dafCommand,
    escalaDafCommand,
    policeSubpoenaCommand,
    courseCommand,
    instrutoresCommand,
    cursosHistoricoCommand,
    historicoEsquecimentoCommand,
    removerCursoHistoricoCommand,
    publicarCursoCommand,
    rhAdminCommand,
    removerCommand,
    messageControlCommand,
    visibleMessageActivateCommand,
    visibleMessageDeactivateCommand,
    livesCommand,
    sistemaCommand,
    iabCommand,
    serverClonerCommand,
    serverGeneratorCommand,
    barraCommand,
    relogioDePontoCommand,
    pontosCommand,
    fecharPontoCommand,
    consultaPontosCommand,
    pontosAutomaticosCommand,
    vehicleAbandonmentPanelCommand,
    qruCommand,
    policePromotionHistoryCommand,
    policePromotionHistoryAliasCommand,
    policePromotionsCommand,
    policeRankUpConfigCommand,
    recrutamentoCommand,
    ztkResetCommand,
    nexTechInviteCommand,
    safeBotDiagnosticCommand,
    editarMetaCommand,
    cancelarEdicaoMetaCommand,
    fechaMetaCommand,
    gerenciamentoFarmingCommand,
    fechamentoMetaCommand,
    resumoMetaCommand,
    rankCommand,
    rankingCommandQru
  ].forEach((command) => {
    if (commands.has(command.data.name)) {
      throw new Error(`Comando duplicado registrado: /${command.data.name}`);
    }

    commands.set(command.data.name, command);
  });

  return commands;
}

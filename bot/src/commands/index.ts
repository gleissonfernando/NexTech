import { Collection } from "discord.js";
import { banCommand } from "./ban";
import { apagaHistoricoCommand } from "./apagaHistorico";
import { advertirCommand } from "./advertir";
import { clearCommand } from "./clear";
import { deleteServeCommand } from "./deleteServe";
import { emojiClonerCommand } from "./emojiCloner";
import { gravarCommand } from "./gravar";
import { fivemOrdersCommand } from "./fivemOrders";
import { fivemFinanceCommand } from "./fivemFinance";
import { acaoCommand } from "../services/fivemActionService";
import { lavagemCommand } from "./lavagem";
import { hierarchyCommand } from "../services/fivemHierarchyService";
import { setCommand } from "./manualRegistration";
import { missionPanelCommand } from "./missionPanel";
import { musicCommands } from "./music";
import { notificarCommand } from "./notificar";
import { pingCommand } from "./ping";
import { serverClonerCommand } from "./serverCloner";
import { serverGeneratorCommand } from "./serverGenerator";
import { ticketCommand } from "./ticket";
import { iabCommand, sistemaCommand } from "./reportSystem";
import { policePatrolReportCommand, viewPolicePatrolReportCommand } from "./policePatrolReports";
import { policeHiddenChannelCommand } from "../services/policeHiddenChannelService";
import { dmBarCommand } from "../services/dmBarService";
import { dafCommand, escalaDafCommand } from "../services/dafScaleService";
import { policeSubpoenaCommand } from "../services/policeSubpoenaService";
import { courseCommand, cursosHistoricoCommand, instrutoresCommand, publicarCursoCommand, removerCursoHistoricoCommand } from "../services/courseSystemService";
import { rhAdminCommand } from "../services/rhAdminService";
import { removerCommand } from "./remover";
import { visibleMessageCommand } from "../services/visibleMessageService";
import { livesCommand } from "../services/liveService";
import type { BotCommand } from "../types";

export function createCommandCollection() {
  const commands = new Collection<string, BotCommand>();

  [
    pingCommand,
    apagaHistoricoCommand,
    advertirCommand,
    banCommand,
    clearCommand,
    deleteServeCommand,
    emojiClonerCommand,
    gravarCommand,
    fivemFinanceCommand,
    fivemOrdersCommand,
    acaoCommand,
    lavagemCommand,
    hierarchyCommand,
    setCommand,
    missionPanelCommand,
    ...musicCommands,
    notificarCommand,
    ticketCommand,
    policePatrolReportCommand,
    viewPolicePatrolReportCommand,
    policeHiddenChannelCommand,
    dmBarCommand,
    dafCommand,
    escalaDafCommand,
    policeSubpoenaCommand,
    courseCommand,
    instrutoresCommand,
    cursosHistoricoCommand,
    removerCursoHistoricoCommand,
    publicarCursoCommand,
    rhAdminCommand,
    removerCommand,
    visibleMessageCommand,
    livesCommand,
    sistemaCommand,
    iabCommand,
    serverClonerCommand,
    serverGeneratorCommand
  ].forEach((command) => {
    if (commands.has(command.data.name)) {
      throw new Error(`Comando duplicado registrado: /${command.data.name}`);
    }

    commands.set(command.data.name, command);
  });

  return commands;
}

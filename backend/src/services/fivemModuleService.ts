import { randomUUID } from "node:crypto";
import { getMongoCollections, type MongoFivemModule } from "../database/mongo";

export type FivemModuleDefinition = {
  builtIn: boolean;
  description: string;
  id: string;
  permissions: string;
  title: string;
};

export type SaveFivemModuleInput = {
  description: string;
  permissions: string;
  title: string;
};

export const BUILTIN_FIVEM_MODULES: FivemModuleDefinition[] = [
  {
    builtIn: true,
    description: "Gestao de membros, hierarquia, cargos e operação das facções.",
    id: "fivem-factions",
    permissions: "Admin FiveM, Gerente de facção",
    title: "Sistema de Facções"
  },
  {
    builtIn: true,
    description: "Controle de departamentos, corporacoes e equipes operacionais.",
    id: "fivem-corporations",
    permissions: "Admin FiveM, Diretor de corporacao",
    title: "Sistema de Corporacoes"
  },
  {
    builtIn: true,
    description: "Fluxo de ausências, aprovacoes e histórico de justificativas.",
    id: "fivem-absences",
    permissions: "Admin FiveM, Liderança",
    title: "Sistema de Ausências"
  },
  {
    builtIn: true,
    description: "Solicitacoes, filas, entregas e status de encomendas RP.",
    id: "fivem-orders",
    permissions: "Admin FiveM, Operador",
    title: "Sistema de Encomendas"
  },
  {
    builtIn: true,
    description: "Lavagem RP isolada com regras de porcentagem, cálculo automático, logs e histórico.",
    id: "fivem-washing",
    permissions: "Admin FiveM, Financeiro",
    title: "Sistema de Lavagem"
  },
  {
    builtIn: true,
    description: "Controle isolado de drogas, famílias autorizadas, pedidos, produção, entrega, logs e histórico.",
    id: "fivem-drugs",
    permissions: "Admin FiveM, Liderança",
    title: "Sistema de Drogas"
  },
  {
    builtIn: true,
    description: "Pedidos, produção, entrega, logs e financeiro de munições.",
    id: "fivem-ammo",
    permissions: "Admin FiveM, Arsenal",
    title: "Sistema de Municoes"
  },
  {
    builtIn: true,
    description: "Caixa, entradas, saidas e acompanhamento financeiro.",
    id: "fivem-finance",
    permissions: "Admin FiveM, Financeiro",
    title: "Sistema Financeiro"
  },
  {
    builtIn: true,
    description: "Metas por membro com canais individuais, fotos e registros via Components V2.",
    id: "fivem-goals",
    permissions: "Admin FiveM, Liderança",
    title: "Sistema de Metas"
  },
  {
    builtIn: true,
    description: "Painel de hierarquia policial atualizado automaticamente pelos cargos do Discord.",
    id: "fivem-hierarchy",
    permissions: "Admin Polícia, Liderança",
    title: "Hierarquia Policial"
  },
  {
    builtIn: true,
    description: "Fluxo de ausências, aprovacoes e histórico para oficiais da policia.",
    id: "police-absences",
    permissions: "Admin Polícia, Liderança",
    title: "Ausência Policial"
  },
  {
    builtIn: true,
    description: "Operações policiais com painel, participantes e relatórios separados da FAC.",
    id: "police-actions",
    permissions: "Admin Polícia, Operador",
    title: "Ações Políciais"
  },
  {
    builtIn: true,
    description: "Canal de denuncias IAB com triagem, auditoria e acompanhamento pela equipe policial.",
    id: "police-iab",
    permissions: "Admin Polícia, Corregedoria",
    title: "Denúncia IAB"
  },
  {
    builtIn: true,
    description: "Gestao de efetivo, recrutamento, desligamentos e movimentações internas da policia.",
    id: "police-hr",
    permissions: "Admin Polícia, RH",
    title: "RH Policial"
  },
  {
    builtIn: true,
    description: "Escalas DAF, plantões, equipes e disponibilidade operacional.",
    id: "police-daf-roster",
    permissions: "Admin Polícia, DAF",
    title: "Escalacao DAF"
  },
  {
    builtIn: true,
    description: "Cursos, matriculas, aprovacoes e histórico de capacitacao policial.",
    id: "police-courses",
    permissions: "Admin Polícia, Instrutor",
    title: "Cursos Políciais"
  },
  {
    builtIn: true,
    description: "Relatórios de patrulhamento exclusivos para oficiais, com anexos, auditoria e histórico.",
    id: "police-patrol-reports",
    permissions: "Admin Polícia, Supervisor",
    title: "Relatórios Políciais"
  },
  {
    builtIn: true,
    description: "Canal anonimo para comunicacoes policiais com auditoria administrativa completa.",
    id: "police-hidden-channel",
    permissions: "Admin Polícia, Investigação",
    title: "Canal Oculto"
  },
  {
    builtIn: true,
    description: "Mensagens de usuários cadastrados reenviadas com nome e avatar do próprio membro via webhook.",
    id: "visible-message",
    permissions: "Admin Polícia, Liderança",
    title: "Mensagem Visível"
  },
  {
    builtIn: true,
    description: "Atendimento por DM policial com registro, encaminhamento e histórico.",
    id: "police-dm",
    permissions: "Admin Polícia, Atendimento",
    title: "DM Policial"
  },
  {
    builtIn: true,
    description: "Solicitacoes de ausência, adornos, aprovação, cargo temporário e logs administrativos de RH.",
    id: "rh-admin",
    permissions: "Admin Polícia, RH",
    title: "RH Administrativo"
  },
  {
    builtIn: true,
    description: "Intimações, notificações, prazos e comprovantes de comparecimento.",
    id: "police-subpoenas",
    permissions: "Admin Polícia, Investigação",
    title: "Intimação"
  },
  {
    builtIn: true,
    description: "Sistema policial de notificação de ponto aberto por DM, canal mencionado e auditoria.",
    id: "police-open-duty",
    permissions: "Admin Polícia, Supervisor",
    title: "Notificar / Ponto Aberto"
  }
];

export function isCustomFivemModuleId(moduleId: string) {
  return /^fivem-custom-[a-z0-9-]{8,80}$/.test(moduleId);
}

export function isFivemModuleId(moduleId: string) {
  return moduleId === "fivem" || moduleId.startsWith("fivem-");
}

export async function listFivemModules(): Promise<FivemModuleDefinition[]> {
  const { fivemModules } = await getMongoCollections();
  const customModules = await fivemModules.find().sort({ createdAt: -1 }).toArray();

  return [
    ...BUILTIN_FIVEM_MODULES,
    ...customModules.map(toFivemModuleDefinition)
  ];
}

export async function createFivemModule(input: SaveFivemModuleInput, userId: string | null) {
  const { fivemModules } = await getMongoCollections();
  const now = new Date();
  const module: MongoFivemModule = {
    _id: `fivem-custom-${randomUUID()}`,
    builtIn: false,
    createdAt: now,
    createdBy: userId,
    description: normalizeModuleText(input.description, "Módulo personalizado criado pelo desenvolvedor.", 240),
    permissions: normalizeModuleText(input.permissions, "Admin FiveM", 120),
    title: normalizeModuleText(input.title, "Módulo FiveM", 80),
    updatedAt: now,
    updatedBy: userId
  };

  await fivemModules.insertOne(module);

  return toFivemModuleDefinition(module);
}

export async function updateFivemModule(moduleId: string, input: Partial<SaveFivemModuleInput>, userId: string | null) {
  if (!isCustomFivemModuleId(moduleId)) {
    return null;
  }

  const $set: Partial<MongoFivemModule> = {
    updatedAt: new Date(),
    updatedBy: userId
  };

  if (input.title !== undefined) {
    $set.title = normalizeModuleText(input.title, "Módulo FiveM", 80);
  }

  if (input.description !== undefined) {
    $set.description = normalizeModuleText(input.description, "Módulo personalizado criado pelo desenvolvedor.", 240);
  }

  if (input.permissions !== undefined) {
    $set.permissions = normalizeModuleText(input.permissions, "Admin FiveM", 120);
  }

  const { fivemModules } = await getMongoCollections();
  const updated = await fivemModules.findOneAndUpdate(
    {
      _id: moduleId,
      builtIn: false
    },
    {
      $set
    },
    {
      returnDocument: "after"
    }
  );

  return updated ? toFivemModuleDefinition(updated) : null;
}

export async function deleteFivemModule(moduleId: string) {
  if (!isCustomFivemModuleId(moduleId)) {
    return false;
  }

  const { devBots, fivemModules } = await getMongoCollections();
  const result = await fivemModules.deleteOne({
    _id: moduleId,
    builtIn: false
  });

  if (!result.deletedCount) {
    return false;
  }

  await devBots.updateMany(
    {
      enabledModules: moduleId
    },
    {
      $pull: {
        enabledModules: moduleId
      },
      $set: {
        updatedAt: new Date()
      }
    }
  );

  return true;
}

function toFivemModuleDefinition(module: MongoFivemModule): FivemModuleDefinition {
  return {
    builtIn: module.builtIn,
    description: module.description,
    id: module._id,
    permissions: module.permissions,
    title: module.title
  };
}

function normalizeModuleText(value: string, fallback: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, " ");
  return (normalized || fallback).slice(0, maxLength);
}

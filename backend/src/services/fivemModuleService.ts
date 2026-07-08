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
    description: "Gestao de membros, hierarquia, cargos e operacao das faccoes.",
    id: "fivem-factions",
    permissions: "Admin FiveM, Gerente de faccao",
    title: "Sistema de Faccoes"
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
    description: "Fluxo de ausencias, aprovacoes e historico de justificativas.",
    id: "fivem-absences",
    permissions: "Admin FiveM, Lideranca",
    title: "Sistema de Ausencias"
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
    description: "Lavagem RP isolada com regras de porcentagem, calculo automatico, logs e historico.",
    id: "fivem-washing",
    permissions: "Admin FiveM, Financeiro",
    title: "Sistema de Lavagem"
  },
  {
    builtIn: true,
    description: "Controle isolado de drogas, familias autorizadas, pedidos, producao, entrega, logs e historico.",
    id: "fivem-drugs",
    permissions: "Admin FiveM, Lideranca",
    title: "Sistema de Drogas"
  },
  {
    builtIn: true,
    description: "Pedidos, producao, entrega, logs e financeiro de municoes.",
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
    permissions: "Admin FiveM, Lideranca",
    title: "Sistema de Metas"
  },
  {
    builtIn: true,
    description: "Painel de hierarquia policial atualizado automaticamente pelos cargos do Discord.",
    id: "fivem-hierarchy",
    permissions: "Admin Policia, Lideranca",
    title: "Hierarquia Policial"
  },
  {
    builtIn: true,
    description: "Fluxo de ausencias, aprovacoes e historico para oficiais da policia.",
    id: "police-absences",
    permissions: "Admin Policia, Lideranca",
    title: "Ausencia Policial"
  },
  {
    builtIn: true,
    description: "Operacoes policiais com painel, participantes e relatorios separados da FAC.",
    id: "police-actions",
    permissions: "Admin Policia, Operador",
    title: "Acoes Policiais"
  },
  {
    builtIn: true,
    description: "Relatorios de patrulhamento exclusivos para oficiais, com anexos, auditoria e historico.",
    id: "police-patrol-reports",
    permissions: "Admin Policia, Supervisor",
    title: "Relatorios Policiais"
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
    description: normalizeModuleText(input.description, "Modulo personalizado criado pelo desenvolvedor.", 240),
    permissions: normalizeModuleText(input.permissions, "Admin FiveM", 120),
    title: normalizeModuleText(input.title, "Modulo FiveM", 80),
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
    $set.title = normalizeModuleText(input.title, "Modulo FiveM", 80);
  }

  if (input.description !== undefined) {
    $set.description = normalizeModuleText(input.description, "Modulo personalizado criado pelo desenvolvedor.", 240);
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

import { randomUUID } from "node:crypto";
import { getMongoCollections, type MongoHierarchyForwardingRule } from "../database/mongo";
import { createLog } from "./logService";

export type HierarchyForwardingRuleDto = {
  id: string;
  botId: string | null;
  guildId: string;
  denouncedRoleId: string;
  destinationCategoryId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  createdById: string | null;
  updatedById: string | null;
};

export type HierarchyForwardingRuleInput = {
  denouncedRoleId: string;
  destinationCategoryId: string;
  enabled?: boolean;
};

const snowflakePattern = /^\d{5,32}$/;

export async function listHierarchyForwardingRules(guildId: string, botId: string | null) {
  const { hierarchyForwarding } = await getMongoCollections();
  const rules = await hierarchyForwarding
    .find(scope(guildId, botId))
    .sort({ enabled: -1, updatedAt: -1 })
    .toArray();

  return rules.map(toDto);
}

export async function createHierarchyForwardingRule(
  guildId: string,
  botId: string | null,
  input: HierarchyForwardingRuleInput,
  actorId: string | null
) {
  validateInput(input);

  if (input.enabled !== false) {
    await assertNoActiveDuplicate(guildId, botId, input.denouncedRoleId);
  }

  const now = new Date();
  const doc: MongoHierarchyForwardingRule = {
    _id: randomUUID(),
    botId,
    guildId,
    denouncedRoleId: input.denouncedRoleId,
    destinationCategoryId: input.destinationCategoryId,
    enabled: input.enabled !== false,
    createdAt: now,
    updatedAt: now,
    createdById: actorId,
    updatedById: actorId,
    deletedAt: null
  };

  const { hierarchyForwarding } = await getMongoCollections();
  await hierarchyForwarding.insertOne(doc);
  await audit("created", guildId, botId, actorId, doc);

  return toDto(doc);
}

export async function updateHierarchyForwardingRule(
  guildId: string,
  botId: string | null,
  ruleId: string,
  input: Partial<HierarchyForwardingRuleInput>,
  actorId: string | null
) {
  const { hierarchyForwarding } = await getMongoCollections();
  const current = await hierarchyForwarding.findOne({ ...scope(guildId, botId), _id: ruleId });

  if (!current) {
    throw serviceError("Encaminhamento nao encontrado.", 404);
  }

  const next = {
    denouncedRoleId: input.denouncedRoleId ?? current.denouncedRoleId,
    destinationCategoryId: input.destinationCategoryId ?? current.destinationCategoryId,
    enabled: input.enabled ?? current.enabled
  };

  validateInput(next);

  if (next.enabled) {
    await assertNoActiveDuplicate(guildId, botId, next.denouncedRoleId, ruleId);
  }

  const updatedAt = new Date();
  await hierarchyForwarding.updateOne(
    { ...scope(guildId, botId), _id: ruleId },
    {
      $set: {
        denouncedRoleId: next.denouncedRoleId,
        destinationCategoryId: next.destinationCategoryId,
        enabled: next.enabled,
        updatedAt,
        updatedById: actorId
      }
    }
  );

  const updated = await hierarchyForwarding.findOne({ ...scope(guildId, botId), _id: ruleId });
  if (!updated) throw serviceError("Encaminhamento nao encontrado.", 404);
  await audit("updated", guildId, botId, actorId, updated, current);

  return toDto(updated);
}

export async function duplicateHierarchyForwardingRule(
  guildId: string,
  botId: string | null,
  ruleId: string,
  actorId: string | null
) {
  const { hierarchyForwarding } = await getMongoCollections();
  const current = await hierarchyForwarding.findOne({ ...scope(guildId, botId), _id: ruleId });

  if (!current) {
    throw serviceError("Encaminhamento nao encontrado.", 404);
  }

  return createHierarchyForwardingRule(
    guildId,
    botId,
    {
      denouncedRoleId: current.denouncedRoleId,
      destinationCategoryId: current.destinationCategoryId,
      enabled: false
    },
    actorId
  );
}

export async function deleteHierarchyForwardingRule(
  guildId: string,
  botId: string | null,
  ruleId: string,
  actorId: string | null
) {
  const { hierarchyForwarding } = await getMongoCollections();
  const current = await hierarchyForwarding.findOne({ ...scope(guildId, botId), _id: ruleId });

  if (!current) {
    throw serviceError("Encaminhamento nao encontrado.", 404);
  }

  await hierarchyForwarding.updateOne(
    { ...scope(guildId, botId), _id: ruleId },
    { $set: { deletedAt: new Date(), enabled: false, updatedAt: new Date(), updatedById: actorId } }
  );
  await audit("deleted", guildId, botId, actorId, current);
}

export async function resolveHierarchyForwarding(
  guildId: string,
  botId: string | null,
  denouncedRoleIds: string[]
) {
  const roleIds = [...new Set(denouncedRoleIds.filter((roleId) => snowflakePattern.test(roleId)))];
  if (!roleIds.length) {
    throw serviceError("Nao foi possivel identificar o cargo do denunciado.", 400);
  }

  const { hierarchyForwarding } = await getMongoCollections();
  const rule = await hierarchyForwarding.findOne(
    {
      ...scope(guildId, botId),
      denouncedRoleId: { $in: roleIds },
      enabled: true
    },
    { sort: { updatedAt: -1 } }
  );

  if (!rule) {
    throw serviceError("Nao existe um destino configurado para este cargo. Acesse Dashboard -> Corregedoria -> Orgaos e configure os cargos responsaveis e o campo Escalar para.", 400);
  }

  return toDto(rule);
}

function validateInput(input: HierarchyForwardingRuleInput) {
  if (!snowflakePattern.test(input.denouncedRoleId)) {
    throw serviceError("Cargo denunciado invalido.", 400);
  }
  if (!input.destinationCategoryId.trim()) {
    throw serviceError("Destino responsavel obrigatorio.", 400);
  }
}

async function assertNoActiveDuplicate(guildId: string, botId: string | null, denouncedRoleId: string, exceptId?: string) {
  const { hierarchyForwarding } = await getMongoCollections();
  const duplicate = await hierarchyForwarding.findOne({
    ...scope(guildId, botId),
    denouncedRoleId,
    enabled: true,
    ...(exceptId ? { _id: { $ne: exceptId } } : {})
  });

  if (duplicate) {
    throw serviceError("Este cargo ja possui um encaminhamento ativo.", 409);
  }
}

function scope(guildId: string, botId: string | null) {
  return {
    botId,
    guildId,
    deletedAt: null
  };
}

function toDto(rule: MongoHierarchyForwardingRule): HierarchyForwardingRuleDto {
  return {
    id: rule._id,
    botId: rule.botId ?? null,
    guildId: rule.guildId,
    denouncedRoleId: rule.denouncedRoleId,
    destinationCategoryId: rule.destinationCategoryId,
    enabled: rule.enabled,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
    createdById: rule.createdById ?? null,
    updatedById: rule.updatedById ?? null
  };
}

async function audit(
  action: "created" | "updated" | "deleted",
  guildId: string,
  botId: string | null,
  actorId: string | null,
  rule: MongoHierarchyForwardingRule,
  previous?: MongoHierarchyForwardingRule
) {
  if (!botId) return;

  await createLog({
    action,
    botId,
    guildId,
    module: "corregedoria.forwarding",
    status: "success",
    type: `corregedoria.forwarding.${action}`,
    userId: actorId,
    message: "Encaminhamento hierarquico atualizado.",
    metadata: {
      ruleId: rule._id,
      denouncedRoleId: rule.denouncedRoleId,
      destinationCategoryId: rule.destinationCategoryId,
      enabled: rule.enabled,
      previous: previous
        ? {
            denouncedRoleId: previous.denouncedRoleId,
            destinationCategoryId: previous.destinationCategoryId,
            enabled: previous.enabled
          }
        : null
    }
  }).catch(() => null);
}

function serviceError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

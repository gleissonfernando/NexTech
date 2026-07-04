import { randomUUID } from "node:crypto";
import { isDashboardDevUserId } from "../config/devOwner";
import { getMongoCollections, type MongoDevPermission } from "../database/mongo";

export type DevPermissionRole = MongoDevPermission["role"];

export type DevPermissionDto = {
  id: string;
  userId: string;
  role: DevPermissionRole;
  canCreateBot: boolean;
  canEditBot: boolean;
  canDeleteBot: boolean;
  canManageModules: boolean;
  createdAt: string;
};

export async function canAccessDevDashboard(userId: string | null | undefined) {
  if (!userId) return false;
  if (isDashboardDevUserId(userId)) return true;

  const { devPermissions } = await getMongoCollections();
  return Boolean(await devPermissions.findOne({ userId }));
}

export async function canManageDevPermissions(userId: string | null | undefined) {
  if (!userId) return false;
  if (isDashboardDevUserId(userId)) return true;

  const permission = await getDevPermission(userId);
  return permission?.role === "owner" || permission?.role === "admin";
}

export async function getDevPermission(userId: string) {
  const { devPermissions } = await getMongoCollections();
  return devPermissions.findOne({ userId });
}

export async function listDevPermissions() {
  const { devPermissions } = await getMongoCollections();
  const permissions = await devPermissions.find({}).sort({ createdAt: -1 }).toArray();
  return permissions.map(toDevPermissionDto);
}

export async function upsertDevPermission(input: {
  actorId: string;
  role: DevPermissionRole;
  userId: string;
}) {
  if (!(await canManageDevPermissions(input.actorId))) {
    throw createDevPermissionError("Voce nao tem permissao para gerenciar acessos DEV.", 403);
  }

  const userId = input.userId.trim();

  if (!/^\d{5,32}$/.test(userId)) {
    throw createDevPermissionError("Discord ID invalido.", 400);
  }

  if (isDashboardDevUserId(userId)) {
    throw createDevPermissionError("O owner principal ja possui acesso permanente.", 400);
  }

  const { devPermissions } = await getMongoCollections();
  const now = new Date();
  const defaults = defaultsForRole(input.role);
  await devPermissions.updateOne(
    { userId },
    {
      $set: {
        role: input.role,
        ...defaults
      },
      $setOnInsert: {
        _id: randomUUID(),
        userId,
        createdAt: now
      }
    },
    { upsert: true }
  );

  const saved = await devPermissions.findOne({ userId });
  if (!saved) throw createDevPermissionError("Acesso DEV nao encontrado depois de salvar.", 500);
  return toDevPermissionDto(saved);
}

export async function deleteDevPermission(actorId: string, userId: string) {
  if (!(await canManageDevPermissions(actorId))) {
    throw createDevPermissionError("Voce nao tem permissao para gerenciar acessos DEV.", 403);
  }

  if (isDashboardDevUserId(userId)) {
    throw createDevPermissionError("O owner principal nao pode ser removido.", 400);
  }

  const { devPermissions } = await getMongoCollections();
  const deleted = await devPermissions.findOneAndDelete({ userId });
  return deleted ? toDevPermissionDto(deleted) : null;
}

function defaultsForRole(role: DevPermissionRole) {
  if (role === "owner" || role === "admin") {
    return {
      canCreateBot: true,
      canEditBot: true,
      canDeleteBot: true,
      canManageModules: true
    };
  }

  return {
    canCreateBot: true,
    canEditBot: true,
    canDeleteBot: false,
    canManageModules: true
  };
}

function toDevPermissionDto(permission: MongoDevPermission): DevPermissionDto {
  return {
    id: permission._id,
    userId: permission.userId,
    role: permission.role,
    canCreateBot: permission.canCreateBot,
    canEditBot: permission.canEditBot,
    canDeleteBot: permission.canDeleteBot,
    canManageModules: permission.canManageModules,
    createdAt: permission.createdAt.toISOString()
  };
}

function createDevPermissionError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

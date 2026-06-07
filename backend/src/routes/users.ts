import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { dashboardPermissionsForLevel } from "../services/dashboardPermissionService";

export const usersRouter = Router();

usersRouter.use(requireAuth);

usersRouter.get("/me", (req, res) => {
  return res.json({
    user: req.session.user
  });
});

usersRouter.get("/permissions", (req, res) => {
  const user = req.session.user;
  const guilds = user?.guilds ?? [];
  const permissions = dashboardPermissionsForLevel(user?.accessLevel ?? "viewer");
  const canManageDashboard = permissions.canManageDashboard || permissions.canManageOwnServices;

  return res.json({
    ...permissions,
    canManageGuilds: permissions.canManageGuilds,
    canManageDashboard,
    manageableGuildIds: canManageDashboard
      ? guilds.filter((guild) => user?.authorized || guild.isAdmin || guild.owner).map((guild) => guild.id)
      : []
  });
});

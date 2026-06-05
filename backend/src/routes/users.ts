import { Router } from "express";
import { requireAuth } from "../middleware/auth";

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
  const canManageDashboard = user?.accessLevel === "admin";

  return res.json({
    canManageGuilds: canManageDashboard,
    canManageDashboard,
    manageableGuildIds: canManageDashboard
      ? guilds.filter((guild) => user?.authorized || guild.isAdmin || guild.owner).map((guild) => guild.id)
      : []
  });
});

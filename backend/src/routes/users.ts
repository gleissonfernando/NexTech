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
  const guilds = req.session.user?.guilds ?? [];

  return res.json({
    canManageGuilds: guilds.some((guild) => guild.isAdmin),
    manageableGuildIds: guilds.filter((guild) => guild.isAdmin).map((guild) => guild.id)
  });
});

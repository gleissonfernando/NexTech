import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { Router } from "express";
import { env } from "../config/env";
import {
  buildDiscordAuthUrl,
  discordAvatarUrl,
  exchangeDiscordCode,
  fetchDiscordGuilds,
  fetchDiscordUser
} from "../services/discordOAuthService";
import { demoGuilds, toDashboardGuilds } from "../services/guildService";
import { createAuthResponse, createPublicDashboardUser } from "../services/publicAuthService";
import { saveDiscordUser } from "../services/userService";

export const authRouter = Router();

function saveSession(req: Request) {
  return new Promise<void>((resolve, reject) => {
    req.session.save((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function destroySession(req: Request) {
  return new Promise<void>((resolve, reject) => {
    req.session.destroy((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

authRouter.get("/discord", async (req, res) => {
  if (!env.DASHBOARD_AUTH_REQUIRED) {
    req.session.user = createPublicDashboardUser();
    await saveSession(req);

    return res.redirect(env.FRONTEND_URL);
  }

  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
    return res.status(503).json({
      message: "OAuth2 Discord ainda nao esta configurado."
    });
  }

  const state = randomUUID();
  req.session.oauthState = state;
  await saveSession(req);

  return res.redirect(buildDiscordAuthUrl(state));
});

authRouter.get("/discord/callback", async (req, res, next) => {
  try {
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;

    if (!code || !state || state !== req.session.oauthState) {
      return res.status(400).json({
        message: "Callback OAuth2 invalido."
      });
    }

    const tokens = await exchangeDiscordCode(code);
    const discordUser = await fetchDiscordUser(tokens.access_token);
    const discordGuilds = await fetchDiscordGuilds(tokens.access_token);
    const user = await saveDiscordUser(discordUser, tokens);
    const guilds = toDashboardGuilds(discordGuilds);

    req.session.user = {
      id: user.id,
      discordId: discordUser.id,
      username: discordUser.global_name ?? discordUser.username,
      avatar: discordAvatarUrl(discordUser),
      email: discordUser.email,
      guilds
    };
    req.session.oauthState = undefined;

    await saveSession(req);
    return res.redirect(env.FRONTEND_URL);
  } catch (error) {
    return next(error);
  }
});

authRouter.post("/dev", async (req, res) => {
  if (!env.DEV_AUTH_ENABLED) {
    return res.status(404).json({
      message: "Login de desenvolvimento desativado."
    });
  }

  req.session.user = {
    id: "dev-user",
    discordId: "100000000000000000",
    username: "Admin Dev",
    avatar: null,
    email: "admin@example.local",
    guilds: demoGuilds
  };

  await saveSession(req);

  return res.json({
    ...createAuthResponse(req.session.user)
  });
});

authRouter.get("/me", async (req, res) => {
  if (!env.DASHBOARD_AUTH_REQUIRED && !req.session.user) {
    req.session.user = createPublicDashboardUser();
    await saveSession(req);
  }

  if (!req.session.user) {
    return res.status(401).json({
      message: "Sessao nao autenticada."
    });
  }

  return res.json(createAuthResponse(req.session.user));
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    await destroySession(req);
    res.clearCookie("discord_dashboard.sid");

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

import { Router } from "express";
import { authRouter } from "./auth";
import { dashboardRouter } from "./dashboard";
import { guildsRouter } from "./guilds";
import { healthRouter } from "./health";
import { livesRouter } from "./lives";
import { logsRouter } from "./logs";
import { settingsRouter } from "./settings";
import { socialNotificationsRouter } from "./socialNotifications";
import { ticketsRouter } from "./tickets";
import { usersRouter } from "./users";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/dashboard", dashboardRouter);
apiRouter.use("/users", usersRouter);
apiRouter.use("/guilds", guildsRouter);
apiRouter.use("/lives", livesRouter);
apiRouter.use("/tickets", ticketsRouter);
apiRouter.use("/logs", logsRouter);
apiRouter.use("/settings", settingsRouter);
apiRouter.use("/social-notifications", socialNotificationsRouter);

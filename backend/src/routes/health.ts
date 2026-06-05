import { Router } from "express";
import { getBotStatus } from "../services/statsService";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  return res.json({
    status: "ok",
    bot: getBotStatus(),
    timestamp: new Date().toISOString()
  });
});

import { createHmac } from "node:crypto";
import { Router } from "express";
import { env } from "../config/env";

export const xWebhookRouter = Router();

xWebhookRouter.get("/", (req, res) => {
  const crcToken = typeof req.query.crc_token === "string" ? req.query.crc_token : "";
  const consumerSecret = env.X_CONSUMER_SECRET.trim();

  if (!crcToken) {
    return res.status(400).json({
      message: "crc_token obrigatorio."
    });
  }

  if (!consumerSecret) {
    return res.status(503).json({
      message: "X_CONSUMER_SECRET nao configurado no backend."
    });
  }

  const responseToken = createHmac("sha256", consumerSecret)
    .update(crcToken)
    .digest("base64");

  return res.json({
    response_token: `sha256=${responseToken}`
  });
});

xWebhookRouter.post("/", (req, res) => {
  const eventType = typeof req.body?.type === "string" ? req.body.type : "unknown";
  console.log(`[x-webhook] evento recebido: ${eventType}`);

  return res.status(200).json({
    ok: true
  });
});

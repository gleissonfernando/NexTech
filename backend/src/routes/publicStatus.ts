import { Router } from "express";
import { getPublicStatusSnapshot } from "../services/publicStatusService";

export const publicStatusRouter = Router();

publicStatusRouter.get("/status", async (_req, res, next) => {
  try {
    return res.json(await getPublicStatusSnapshot());
  } catch (error) {
    return next(publicStatusError(error));
  }
});

publicStatusRouter.get("/status/services", async (_req, res, next) => {
  try {
    const snapshot = await getPublicStatusSnapshot();
    return res.json({
      categories: snapshot.categories,
      generatedAt: snapshot.generatedAt,
      servicesTotal: snapshot.servicesTotal
    });
  } catch (error) {
    return next(publicStatusError(error));
  }
});

publicStatusRouter.get("/status/services/:serviceId", async (req, res, next) => {
  try {
    const snapshot = await getPublicStatusSnapshot();
    const service = snapshot.categories.flatMap((category) => category.services).find((item) => item.id === req.params.serviceId);

    if (!service) {
      return res.status(404).json({ error: "Serviço público não encontrado." });
    }

    return res.json({
      generatedAt: snapshot.generatedAt,
      service
    });
  } catch (error) {
    return next(publicStatusError(error));
  }
});

publicStatusRouter.get("/status/incidents", async (_req, res, next) => {
  try {
    const snapshot = await getPublicStatusSnapshot();
    return res.json({
      generatedAt: snapshot.generatedAt,
      incidents: snapshot.incidents
    });
  } catch (error) {
    return next(publicStatusError(error));
  }
});

publicStatusRouter.get("/status/maintenances", async (_req, res, next) => {
  try {
    const snapshot = await getPublicStatusSnapshot();
    return res.json({
      generatedAt: snapshot.generatedAt,
      maintenances: snapshot.maintenances
    });
  } catch (error) {
    return next(publicStatusError(error));
  }
});

publicStatusRouter.get("/status/history", async (_req, res, next) => {
  try {
    const snapshot = await getPublicStatusSnapshot();
    return res.json({
      generatedAt: snapshot.generatedAt,
      historyWindow: snapshot.historyWindow,
      services: snapshot.categories.flatMap((category) => category.services.map((service) => ({
        history: service.history,
        id: service.id,
        name: service.name
      })))
    });
  } catch (error) {
    return next(publicStatusError(error));
  }
});

publicStatusRouter.get("/status/events", async (req, res, next) => {
  try {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = async () => {
      const snapshot = await getPublicStatusSnapshot();
      res.write(`event: status-update\ndata: ${JSON.stringify(snapshot)}\n\n`);
    };

    await send();
    const interval = setInterval(() => {
      send().catch(() => {
        res.write("event: status-error\ndata: {}\n\n");
      });
    }, 5_000);

    req.on("close", () => {
      clearInterval(interval);
      res.end();
    });
  } catch (error) {
    return next(publicStatusError(error));
  }
});

function publicStatusError(error: unknown) {
  return Object.assign(new Error("Não foi possível carregar o status no momento."), {
    cause: error,
    statusCode: 503
  });
}

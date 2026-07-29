import { Router } from "express";
import { getPublicStatusSnapshot } from "../services/publicStatusService";

export const statusRouter = Router();

statusRouter.get("/", async (_req, res, next) => {
  try {
    res.setHeader("Cache-Control", "public, max-age=10, stale-while-revalidate=20");
    return res.json(await getPublicStatusSnapshot());
  } catch (error) {
    return next(statusError(error));
  }
});

statusRouter.get("/summary", async (_req, res, next) => {
  try {
    const snapshot = await getPublicStatusSnapshot();
    const services = snapshot.categories.flatMap((category) => category.services);

    res.setHeader("Cache-Control", "public, max-age=10, stale-while-revalidate=20");
    return res.json({
      generatedAt: snapshot.generatedAt,
      globalMessage: snapshot.globalMessage,
      globalStatus: snapshot.globalStatus,
      incidentsTotal: snapshot.incidents.length,
      maintenancesTotal: snapshot.maintenances.length,
      services: services.map((service) => ({
        currentStatus: service.currentStatus,
        id: service.id,
        name: service.name,
        responseTimeMs: service.responseTimeMs,
        uptimePercentage: service.uptimePercentage
      })),
      servicesTotal: snapshot.servicesTotal
    });
  } catch (error) {
    return next(statusError(error));
  }
});

function statusError(error: unknown) {
  return Object.assign(new Error("Não foi possível carregar o status no momento."), {
    cause: error,
    statusCode: 503
  });
}

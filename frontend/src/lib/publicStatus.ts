export type PublicServiceState =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage"
  | "maintenance"
  | "unknown";

export type PublicHistoryState = "operational" | "degraded" | "down" | "maintenance" | "no_data";

export type PublicStatusService = {
  critical: boolean;
  currentStatus: PublicServiceState;
  description: string | null;
  history: Array<{
    averageResponseTimeMs: number | null;
    startedAt: string;
    status: PublicHistoryState;
  }>;
  id: string;
  lastCheckedAt: string | null;
  name: string;
  responseTimeMs: number | null;
  uptimePercentage: number;
};

export type PublicStatusCategory = {
  id: string;
  name: string;
  services: PublicStatusService[];
};

export type PublicStatusSnapshot = {
  categories: PublicStatusCategory[];
  generatedAt: string;
  globalMessage: string;
  globalStatus: "operational" | "degraded" | "major_outage";
  historyWindow: {
    bars: number;
    intervalSeconds: number;
    label: string;
  };
  incidents: Array<{
    affectedServiceIds: string[];
    id: string;
    severity: "minor" | "major" | "critical";
    startedAt: string;
    status: "investigating" | "identified" | "monitoring" | "resolved";
    title: string;
  }>;
  maintenances: Array<{
    id: string;
    scheduledFor: string;
    status: "scheduled" | "in_progress" | "completed";
    title: string;
  }>;
  servicesTotal: number;
};

export async function fetchPublicStatus(signal?: AbortSignal): Promise<PublicStatusSnapshot> {
  const response = await fetch("/api/public/status", { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error(`Status HTTP ${response.status}`);
  }
  return response.json() as Promise<PublicStatusSnapshot>;
}

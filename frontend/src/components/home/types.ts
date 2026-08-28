import type { AuthResponse, Plan } from "../../types";

export type HomePageProps = {
  auth: AuthResponse | null;
  error?: string | null;
  onLoginDiscord: () => void;
  onVerify: () => void;
  verifying: boolean;
};

export type PublicConnectedServer = {
  botNames: string[];
  connectedBots: number;
  guildId: string;
  iconUrl: string | null;
  memberCount: number;
  name: string;
  online: boolean;
};

export type PublicConnectedServersResponse = {
  generatedAt: string;
  servers: PublicConnectedServer[];
  totalBots: number;
  totalUniqueServers: number;
};

export type PublicMarketingFeature = {
  category: string;
  fullDescription: string;
  icon: string;
  id: string;
  shortDescription: string;
  title: string;
};

export type PublicStatusService = {
  currentStatus?: string;
  id: string;
  responseTimeMs: number | null;
  uptimePercentage?: number;
};

export type PublicStatusSnapshot = {
  categories?: Array<{ services?: PublicStatusService[] }>;
  generatedAt?: string;
};

export type LandingMetrics = {
  responseTimeMs: number | null;
  updatedAt: string | null;
  uptimePercent: number | null;
};

export type ServerState = {
  error: boolean;
  loading: boolean;
  value: PublicConnectedServersResponse | null;
};

export type MarketingFeatureState = {
  loading: boolean;
  value: PublicMarketingFeature[];
};

export type PricingState = {
  error: boolean;
  loading: boolean;
  value: Plan[];
};

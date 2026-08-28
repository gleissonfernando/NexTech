import { useEffect, useMemo, useState } from "react";
import { getPublicPlans } from "../../lib/api";
import { appUrl, dashboardUrl } from "../../lib/urls";
import { fallbackFeatures, fallbackServers, LANDING_SERVERS_REFRESH_MS } from "./data";
import {
  Benefits,
  ConnectedServers,
  Faq,
  FeatureBento,
  FinalCta,
  Footer,
  Hero,
  HowItWorks,
  Integrations,
  MONITORING_STATUS_URL,
  Navbar,
  PlatformShowcase,
  Pricing,
  ProductDemo,
  Security
} from "./HomeSections";
import { HomeShell } from "./HomeUi";
import type { HomePageProps, LandingMetrics, MarketingFeatureState, PricingState, PublicConnectedServersResponse, PublicMarketingFeature, PublicStatusSnapshot, ServerState } from "./types";
import { buildLandingStats, getLandingResponseTime, getLandingUptime, normalizeServersResponse } from "./utils";

export function HomePage({
  auth,
  error,
  onLoginDiscord,
  onVerify,
  verifying
}: HomePageProps) {
  const [servers, setServers] = useState<ServerState>({ error: false, loading: true, value: null });
  const [features, setFeatures] = useState<MarketingFeatureState>({ loading: true, value: fallbackFeatures });
  const [plans, setPlans] = useState<PricingState>({ error: false, loading: true, value: [] });
  const [landingMetrics, setLandingMetrics] = useState<LandingMetrics>({
    responseTimeMs: null,
    updatedAt: null,
    uptimePercent: null
  });
  const currentYear = new Date().getFullYear();
  const verificationPending = Boolean(auth && !auth.access.verified);
  const startLabel = verifying ? "Verificando..." : verificationPending ? "Verificar acesso" : "Começar agora";
  const stats = useMemo(() => buildLandingStats(landingMetrics, servers.value ?? fallbackServers), [landingMetrics, servers.value]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function loadServers() {
      try {
        const response = await fetch("/api/public/connected-servers", {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) throw new Error("Falha ao carregar servidores");
        const data = await response.json() as PublicConnectedServersResponse;
        if (active) setServers({ error: false, loading: false, value: normalizeServersResponse(data) });
      } catch {
        if (active) setServers((current) => ({ ...current, error: !current.value, loading: false }));
      }
    }

    void loadServers();
    const interval = window.setInterval(() => { void loadServers(); }, LANDING_SERVERS_REFRESH_MS);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function loadFeatures() {
      try {
        const response = await fetch("/api/public/marketing-features", {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) throw new Error("Falha ao carregar recursos");
        const data = await response.json() as { features?: PublicMarketingFeature[] };
        if (active) setFeatures({ loading: false, value: data.features ?? fallbackFeatures });
      } catch {
        if (active) setFeatures({ loading: false, value: fallbackFeatures });
      }
    }

    void loadFeatures();
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadStatus() {
      try {
        const response = await fetch("/api/public/status", { cache: "no-store" });
        if (!response.ok) throw new Error("Falha ao carregar status");
        const snapshot = await response.json() as PublicStatusSnapshot;
        if (!active) return;
        setLandingMetrics({
          responseTimeMs: getLandingResponseTime(snapshot),
          updatedAt: snapshot.generatedAt ?? new Date().toISOString(),
          uptimePercent: getLandingUptime(snapshot)
        });
      } catch {
        // Mantem a ultima leitura valida na landing publica.
      }
    }

    void loadStatus();
    const interval = window.setInterval(() => { void loadStatus(); }, 10_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void getPublicPlans()
      .then((value) => {
        if (active) setPlans({ error: false, loading: false, value });
      })
      .catch(() => {
        if (active) setPlans({ error: true, loading: false, value: [] });
      });
    return () => {
      active = false;
    };
  }, []);

  function handleStart() {
    if (auth) {
      if (auth.access.verified) {
        window.location.assign(auth.redirectTo ? appUrl(auth.redirectTo) : dashboardUrl(auth.user.dashboardBotSlug));
        return;
      }
      onVerify();
      return;
    }
    onLoginDiscord();
  }

  function navigate(id: string) {
    if (id === "docs") {
      window.location.assign("/docs");
      return;
    }
    if (id === "status") {
      window.location.assign(MONITORING_STATUS_URL);
      return;
    }
    if (id === "termos") {
      window.location.assign("/termos");
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <HomeShell>
      <Navbar onNavigate={navigate} onStart={handleStart} startLabel={startLabel} verifying={verifying} />
      <Hero error={error} onNavigate={navigate} onStart={handleStart} startLabel={startLabel} stats={stats} verifying={verifying} />
      <ConnectedServers state={servers} />
      <PlatformShowcase />
      <FeatureBento features={features.value} loading={features.loading} />
      <HowItWorks />
      <Benefits />
      <Integrations />
      <ProductDemo />
      <Security />
      <Pricing onNavigate={navigate} plans={plans.error || plans.loading ? [] : plans.value} />
      <Faq />
      <FinalCta onStart={handleStart} startLabel={startLabel} verifying={verifying} />
      <Footer currentYear={currentYear} onNavigate={navigate} />
    </HomeShell>
  );
}

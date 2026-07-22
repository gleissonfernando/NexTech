import { Loader2 } from "lucide-react";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Login } from "./pages/Login";
import { useAuth } from "./hooks/useAuth";
import { appUrl, dashboardSlugFromPath, dashboardUrl, isDashboardRoutePath } from "./lib/urls";

const BotRegistrationPage = lazy(() => import("./pages/BotRegistration").then((module) => ({ default: module.BotRegistrationPage })));
const Dashboard = lazy(() => import("./pages/Dashboard").then((module) => ({ default: module.Dashboard })));
const DevDashboard = lazy(() => import("./pages/DevDashboard").then((module) => ({ default: module.DevDashboard })));
const DocsPage = lazy(() => import("./pages/Docs").then((module) => ({ default: module.DocsPage })));
const GiveawayRoulettePage = lazy(() => import("./pages/GiveawayRoulette").then((module) => ({ default: module.GiveawayRoulettePage })));
const NexTechProductPage = lazy(() => import("./pages/NexTechProductPage").then((module) => ({ default: module.NexTechProductPage })));
const PaymentReturnPage = lazy(() => import("./pages/PaymentReturn").then((module) => ({ default: module.PaymentReturnPage })));
const PixPaymentPage = lazy(() => import("./pages/PixPayment").then((module) => ({ default: module.PixPaymentPage })));
const PublicPlansPage = lazy(() => import("./pages/Plans").then((module) => ({ default: module.PublicPlansPage })));
const PublicStatusPage = lazy(() => import("./pages/PublicStatusPage").then((module) => ({ default: module.PublicStatusPage })));

export function App() {
  const {
    auth,
    error,
    loading,
    loginDiscord,
    logout,
    verify,
    verifying
  } = useAuth();
  const path = window.location.pathname;
  const [accessDeniedError, setAccessDeniedError] = useState<string | null>(null);
  const publicLandingPath = path === "/";
  const docsPath = path === "/docs" || path.startsWith("/docs/");
  const plansPath = path === "/planos" || path.startsWith("/planos/");
  const statusPath = path === "/status";
  const botRegistrationPath = path === "/cadastrar-bot" || path.startsWith("/cadastrar-bot/");
  const paymentReturnStatus = paymentReturnStatusFromPath(path);
  const pixPaymentOrderId = pixPaymentOrderIdFromPath(path);
  const rouletteToken = rouletteTokenFromPath(path);
  const productRoute = nexTechProductRouteFromPath(path);
  const routeError = readAuthError();
  const dashboardPath = isDashboardRoutePath(path);
  const devPanelPath = path === "/dev" || path.startsWith("/dev/");
  const protectedPanelPath = dashboardPath || devPanelPath;

  useEffect(() => {
    function onAccessDenied(event: Event) {
      const detail = (event as CustomEvent<{ message?: unknown }>).detail;
      setAccessDeniedError(
        typeof detail?.message === "string" && detail.message.trim()
          ? detail.message
          : "Você não possui acesso a esta dashboard. Verifique se o plano está em dia ou entre em contato com o suporte."
      );
    }

    window.addEventListener("dashboard:access-denied", onAccessDenied);
    return () => window.removeEventListener("dashboard:access-denied", onAccessDenied);
  }, []);

  useEffect(() => {
    if (rouletteToken || productRoute || docsPath || plansPath || statusPath || paymentReturnStatus || pixPaymentOrderId || botRegistrationPath) {
      return;
    }

    if (auth?.access.verified && !protectedPanelPath && !publicLandingPath) {
      window.location.replace(dashboardUrl(auth.user.dashboardBotSlug));
    }
  }, [auth, botRegistrationPath, docsPath, paymentReturnStatus, pixPaymentOrderId, plansPath, productRoute, protectedPanelPath, publicLandingPath, rouletteToken, statusPath]);

  useEffect(() => {
    if (rouletteToken || productRoute || docsPath || plansPath || statusPath || paymentReturnStatus || pixPaymentOrderId || botRegistrationPath) {
      return;
    }

    if (loading || !protectedPanelPath || error || routeError || accessDeniedError || auth) {
      return;
    }

    loginDiscord();
  }, [accessDeniedError, auth, protectedPanelPath, botRegistrationPath, docsPath, error, loading, loginDiscord, paymentReturnStatus, pixPaymentOrderId, plansPath, productRoute, routeError, rouletteToken, statusPath]);

  if (docsPath) {
    return <LazyPage><DocsPage /></LazyPage>;
  }

  if (plansPath) {
    return <LazyPage><PublicPlansPage /></LazyPage>;
  }

  if (statusPath) {
    return <LazyPage><PublicStatusPage /></LazyPage>;
  }

  if (paymentReturnStatus) {
    return <LazyPage><PaymentReturnPage status={paymentReturnStatus} /></LazyPage>;
  }

  if (pixPaymentOrderId) {
    return <LazyPage><PixPaymentPage orderId={pixPaymentOrderId} /></LazyPage>;
  }

  if (botRegistrationPath) {
    return <LazyPage><BotRegistrationPage /></LazyPage>;
  }

  if (rouletteToken) {
    return <LazyPage><GiveawayRoulettePage token={rouletteToken} /></LazyPage>;
  }

  if (productRoute) {
    return <LazyPage><NexTechProductPage slug={productRoute.slug} status={productRoute.status} storeId={productRoute.storeId} /></LazyPage>;
  }

  if ((routeError || accessDeniedError) && (!auth?.access.verified || protectedPanelPath)) {
    return (
      <Login
        auth={auth}
        error={accessDeniedError ?? error ?? routeError}
        onLoginDiscord={loginDiscord}
        onVerify={verify}
        verifying={verifying}
      />
    );
  }

  if (loading) {
    return <LoadingScreen />;
  }

  if (publicLandingPath) {
    return (
      <Login
        auth={auth}
        error={error ?? routeError}
        onLoginDiscord={loginDiscord}
        onVerify={() => auth?.access.verified ? window.location.assign(auth.redirectTo ? appUrl(auth.redirectTo) : dashboardUrl(auth.user.dashboardBotSlug)) : verify()}
        verifying={verifying}
      />
    );
  }

  if (!auth || !auth.access.verified) {
    return (
      <Login
        auth={auth}
        error={error ?? routeError}
        onLoginDiscord={loginDiscord}
        onVerify={verify}
        verifying={verifying}
      />
    );
  }

  if (devPanelPath) {
    return <LazyPage><DevDashboard auth={auth} initialView={devViewFromPath(path)} onLogout={logout} /></LazyPage>;
  }

  return <LazyPage><Dashboard auth={auth} initialBotSlug={dashboardSlugFromPath(path)} onLogout={logout} /></LazyPage>;
}

function LazyPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<LoadingScreen />}>{children}</Suspense>;
}

function readAuthError() {
  const reason = new URLSearchParams(window.location.search).get("reason");
  const authError = new URLSearchParams(window.location.search).get("authError");

  if (!reason && !authError) {
    return null;
  }

  if (authError === "denied") {
    return "Você não possui acesso a esta dashboard. Verifique se o plano está em dia ou entre em contato com o suporte.";
  }

  if (reason === "permission") {
    return "Você não possui acesso a esta dashboard. Verifique se o plano está em dia ou entre em contato com o suporte.";
  }

  if (reason === "nobot") {
    return "Você não possui nenhum bot cadastrado na plataforma. Cadastre um bot para utilizar o Dashboard.";
  }

  if (reason === "callback") {
    return "A resposta do Discord expirou ou não corresponde a sua sessão. Tente autenticar novamente.";
  }

  if (reason === "denied") {
    return "Você não possui acesso a esta dashboard. Verifique se o plano está em dia ou entre em contato com o suporte.";
  }

  return "Não foi possível conectar com o Discord. Verifique se o aplicativo está configurado corretamente.";
}

function rouletteTokenFromPath(path: string) {
  if (!path.startsWith("/roulette/")) {
    return null;
  }

  const token = path.slice("/roulette/".length).split("/")[0]?.trim();

  if (!token) {
    return null;
  }

  try {
    return decodeURIComponent(token);
  } catch {
    return null;
  }
}

function nexTechProductRouteFromPath(path: string) {
  if (!path.startsWith("/nex-tech/")) {
    return null;
  }

  const [, , storeId, slug, status] = path.split("/");

  if (!storeId || !slug) {
    return null;
  }

  return {
    slug,
    status: status === "sucesso" ? "success" as const : null,
    storeId
  };
}

function paymentReturnStatusFromPath(path: string) {
  if (path === "/pagamento/sucesso") return "success" as const;
  if (path === "/pagamento/pendente") return "pending" as const;
  if (path === "/pagamento/falha") return "failure" as const;

  return null;
}

function pixPaymentOrderIdFromPath(path: string) {
  if (!path.startsWith("/pagamento/pix/")) {
    return null;
  }

  const orderId = path.slice("/pagamento/pix/".length).split("/")[0]?.trim();
  if (!orderId) return null;

  try {
    return decodeURIComponent(orderId);
  } catch {
    return null;
  }
}

function devViewFromPath(path: string): "bots" | "connected" | "bot-menu" | "cloning" | "nextech" | "nextech-invites" | "sales" | "plans" | "monitoring" | "discloud" | "fivem" | "police" | "logs" | "access" | "maintenance" {
  if (path.startsWith("/dev/bots-conectados")) {
    return "connected";
  }

  if (path.startsWith("/dev/menu-do-bot")) {
    return "bot-menu";
  }

  if (path.startsWith("/dev/clonagem")) {
    return "cloning";
  }

  if (path.startsWith("/dev/nextech/convites")) {
    return "nextech-invites";
  }

  if (path.startsWith("/dev/nextech")) {
    return "nextech";
  }

  if (path.startsWith("/dev/sistema-de-vendas") || path.startsWith("/dev/vendas-nex-tech")) {
    return "sales";
  }

  if (path.startsWith("/dev/planos")) {
    return "plans";
  }

  if (path.startsWith("/dev/monitoramento")) {
    return "monitoring";
  }

  if (path.startsWith("/dev/discloud")) {
    return "discloud";
  }

  if (path.startsWith("/dev/fivem")) {
    return "fivem";
  }

  if (path.startsWith("/dev/policia")) {
    return "police";
  }

  if (path.startsWith("/dev/logs")) {
    return "logs";
  }

  if (path.startsWith("/dev/acessos")) {
    return "access";
  }

  if (path.startsWith("/dev/maintenance")) {
    return "maintenance";
  }

  return "bots";
}

function LoadingScreen() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#050505] px-4">
      <div className="absolute inset-0 bg-[#050505]" />
      <div className="relative flex flex-col items-center rounded-lg border border-[#FFD500]/20 bg-[#141414] px-8 py-7 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#FFD500]" />
        <p className="mt-4 text-sm font-medium text-white">Carregando painel</p>
        <p className="mt-1 text-xs text-zinc-500">Sincronizando sessão Discord</p>
      </div>
    </main>
  );
}

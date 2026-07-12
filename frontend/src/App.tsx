import { Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect } from "react";
import { Dashboard } from "./pages/Dashboard";
import { BotRegistrationPage } from "./pages/BotRegistration";
import { DevDashboard } from "./pages/DevDashboard";
import { DocsPage } from "./pages/Docs";
import { GiveawayRoulettePage } from "./pages/GiveawayRoulette";
import { Login } from "./pages/Login";
import { NexTechProductPage } from "./pages/NexTechProductPage";
import { PaymentReturnPage } from "./pages/PaymentReturn";
import { PixPaymentPage } from "./pages/PixPayment";
import { PublicPlansPage } from "./pages/Plans";
import { useAuth } from "./hooks/useAuth";
import { dashboardSlugFromPath, dashboardUrl, isDashboardRoutePath } from "./lib/urls";

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
  const publicLandingPath = path === "/";
  const docsPath = path === "/docs" || path.startsWith("/docs/");
  const plansPath = path === "/planos" || path.startsWith("/planos/");
  const botRegistrationPath = path === "/cadastrar-bot" || path.startsWith("/cadastrar-bot/");
  const paymentReturnStatus = paymentReturnStatusFromPath(path);
  const pixPaymentOrderId = pixPaymentOrderIdFromPath(path);
  const rouletteToken = rouletteTokenFromPath(path);
  const productRoute = nexTechProductRouteFromPath(path);
  const routeError = readAuthError();
  const authCallbackLanding = isAuthCallbackLanding();
  const dashboardPath = isDashboardRoutePath(path);
  const devPanelPath = path === "/dev" || path.startsWith("/dev/");
  const protectedPanelPath = dashboardPath || devPanelPath;

  useEffect(() => {
    if (rouletteToken || productRoute || docsPath || plansPath || paymentReturnStatus || pixPaymentOrderId || botRegistrationPath) {
      return;
    }

    if (auth?.access.verified && !protectedPanelPath && !publicLandingPath) {
      window.location.replace(dashboardUrl(auth.user.dashboardBotSlug));
    }
  }, [auth, botRegistrationPath, docsPath, paymentReturnStatus, pixPaymentOrderId, plansPath, productRoute, protectedPanelPath, publicLandingPath, rouletteToken]);

  useEffect(() => {
    if (rouletteToken || productRoute || docsPath || plansPath || paymentReturnStatus || pixPaymentOrderId || botRegistrationPath) {
      return;
    }

    if (loading || !protectedPanelPath || error || routeError || auth) {
      return;
    }

    loginDiscord();
  }, [auth, protectedPanelPath, botRegistrationPath, docsPath, error, loading, loginDiscord, paymentReturnStatus, pixPaymentOrderId, plansPath, productRoute, routeError, rouletteToken]);

  useEffect(() => {
    if (rouletteToken || productRoute || docsPath || plansPath || paymentReturnStatus || pixPaymentOrderId || botRegistrationPath) {
      return;
    }

    if (!authCallbackLanding || !auth || auth.access.verified || verifying) {
      return;
    }

    verify();
  }, [auth, authCallbackLanding, botRegistrationPath, docsPath, paymentReturnStatus, pixPaymentOrderId, plansPath, productRoute, rouletteToken, verify, verifying]);

  if (docsPath) {
    return <DocsPage />;
  }

  if (plansPath) {
    return <PublicPlansPage />;
  }

  if (paymentReturnStatus) {
    return <PaymentReturnPage status={paymentReturnStatus} />;
  }

  if (pixPaymentOrderId) {
    return <PixPaymentPage orderId={pixPaymentOrderId} />;
  }

  if (botRegistrationPath) {
    return <BotRegistrationPage />;
  }

  if (rouletteToken) {
    return <GiveawayRoulettePage token={rouletteToken} />;
  }

  if (productRoute) {
    return <NexTechProductPage slug={productRoute.slug} status={productRoute.status} storeId={productRoute.storeId} />;
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
        onVerify={() => auth?.access.verified ? window.location.assign(dashboardUrl(auth.user.dashboardBotSlug)) : verify()}
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
    return <DevDashboard auth={auth} initialView={devViewFromPath(path)} onLogout={logout} />;
  }

  return <Dashboard auth={auth} initialBotSlug={dashboardSlugFromPath(path)} onLogout={logout} />;
}

function readAuthError() {
  const reason = new URLSearchParams(window.location.search).get("reason");
  const authError = new URLSearchParams(window.location.search).get("authError");

  if (!reason && !authError) {
    return null;
  }

  if (authError === "denied") {
    return "Voce nao esta liberado para acessar esta dashboard.";
  }

  if (reason === "permission") {
    return "Sua conta foi autenticada, mas nao possui permissao suficiente para acesso administrativo.";
  }

  if (reason === "callback") {
    return "A resposta do Discord expirou ou nao corresponde a sua sessao. Tente autenticar novamente.";
  }

  if (reason === "denied") {
    return "Você não está liberado para acessar esta dashboard.";
  }

  return "Não foi possível conectar com o Discord. Verifique se o aplicativo está configurado corretamente.";
}

function isAuthCallbackLanding() {
  return new URLSearchParams(window.location.search).get("auth") === "callback";
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

function devViewFromPath(path: string): "bots" | "connected" | "bot-menu" | "cloning" | "sales" | "plans" | "discloud" | "fivem" | "police" | "logs" | "access" | "maintenance" {
  if (path.startsWith("/dev/bots-conectados")) {
    return "connected";
  }

  if (path.startsWith("/dev/menu-do-bot")) {
    return "bot-menu";
  }

  if (path.startsWith("/dev/clonagem")) {
    return "cloning";
  }

  if (path.startsWith("/dev/vendas-nex-tech")) {
    return "sales";
  }

  if (path.startsWith("/dev/planos")) {
    return "plans";
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
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="relative flex flex-col items-center rounded-lg border border-[#FFD500]/20 bg-[#141414]/90 px-8 py-7 text-center shadow-glow backdrop-blur-2xl"
        initial={{ opacity: 0, y: 14 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      >
        <Loader2 className="h-8 w-8 animate-spin text-[#FFD500]" />
        <p className="mt-4 text-sm font-medium text-white">Carregando painel</p>
        <p className="mt-1 text-xs text-zinc-500">Sincronizando sessao Discord</p>
      </motion.div>
    </main>
  );
}

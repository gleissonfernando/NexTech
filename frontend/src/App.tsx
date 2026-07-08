import { Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect } from "react";
import { Dashboard } from "./pages/Dashboard";
import { DevDashboard } from "./pages/DevDashboard";
import { GiveawayRoulettePage } from "./pages/GiveawayRoulette";
import { Login } from "./pages/Login";
import { OrvitechProductPage } from "./pages/OrvitechProductPage";
import { useAuth } from "./hooks/useAuth";
import { dashboardSlugFromPath, dashboardUrl, isDashboardRoutePath } from "./lib/urls";

export function App() {
  const {
    accessValidation,
    auth,
    checkingAccess,
    error,
    loading,
    loginDiscord,
    logout,
    refresh,
    status,
    verify,
    verifying
  } = useAuth();
  const path = window.location.pathname;
  const rouletteToken = rouletteTokenFromPath(path);
  const productRoute = orvitechProductRouteFromPath(path);
  const routeError = readAuthError();
  const dashboardPath = isDashboardRoutePath(path);
  const devPanelPath = path === "/dev" || path.startsWith("/dev/");
  const protectedPanelPath = dashboardPath || devPanelPath;

  useEffect(() => {
    if (rouletteToken || productRoute) {
      return;
    }

    if (auth?.access.verified && !protectedPanelPath) {
      window.location.replace(dashboardUrl());
    }
  }, [auth, productRoute, protectedPanelPath, rouletteToken]);

  useEffect(() => {
    if (rouletteToken || productRoute) {
      return;
    }

    if (loading || !protectedPanelPath || error || routeError || auth) {
      return;
    }

    loginDiscord();
  }, [auth, protectedPanelPath, error, loading, loginDiscord, productRoute, routeError, rouletteToken]);

  if (rouletteToken) {
    return <GiveawayRoulettePage token={rouletteToken} />;
  }

  if (productRoute) {
    return <OrvitechProductPage slug={productRoute.slug} storeId={productRoute.storeId} />;
  }

  if (loading) {
    return <LoadingScreen />;
  }

  if (!auth || !auth.access.verified) {
    return (
      <Login
        accessValidation={accessValidation}
        auth={auth}
        checkingAccess={checkingAccess}
        error={routeError ?? error}
        onLoginDiscord={loginDiscord}
        onLogout={logout}
        onRetry={refresh}
        onVerify={verify}
        status={routeError ? "Acesso negado." : status}
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

function orvitechProductRouteFromPath(path: string) {
  if (!path.startsWith("/orvitech/")) {
    return null;
  }

  const [, , storeId, slug] = path.split("/");

  if (!storeId || !slug) {
    return null;
  }

  return {
    slug,
    storeId
  };
}

function devViewFromPath(path: string): "bots" | "connected" | "bot-menu" | "cloning" | "sales" | "discloud" | "fivem" | "police" | "logs" | "access" | "maintenance" {
  if (path.startsWith("/dev/bots-conectados")) {
    return "connected";
  }

  if (path.startsWith("/dev/menu-do-bot")) {
    return "bot-menu";
  }

  if (path.startsWith("/dev/clonagem")) {
    return "cloning";
  }

  if (path.startsWith("/dev/vendas-orvitech")) {
    return "sales";
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

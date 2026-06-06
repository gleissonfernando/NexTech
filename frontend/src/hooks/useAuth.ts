import { useCallback, useEffect, useRef, useState } from "react";
import { getSession, loginDev, logout as logoutRequest, verifyAccess } from "../lib/api";
import { appUrl, dashboardUrl } from "../lib/urls";
import type { AuthResponse } from "../types";

export function useAuth() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshId = useRef(0);
  const verifyInFlight = useRef(false);

  const refresh = useCallback(async () => {
    const requestId = refreshId.current + 1;
    refreshId.current = requestId;
    setLoading(true);
    setError(null);

    try {
      const session = await getSession();
      if (refreshId.current !== requestId) {
        return;
      }
      setAuth(session);
    } catch (requestError) {
      if (refreshId.current !== requestId) {
        return;
      }
      setAuth(null);
      if (isTimeoutError(requestError)) {
        setError("A sessao demorou para responder. Tente entrar novamente.");
      }
    } finally {
      if (refreshId.current === requestId) {
        setLoading(false);
      }
    }
  }, []);

  const loginDiscord = useCallback(() => {
    window.location.href = appUrl("/auth/discord");
  }, []);

  const loginDevelopment = useCallback(async () => {
    setError(null);

    try {
      const session = await loginDev();
      setAuth(session);
    } catch {
      setError("Login de desenvolvimento indisponivel.");
    }
  }, []);

  const logout = useCallback(async () => {
    await logoutRequest();
    setAuth(null);
  }, []);

  const verify = useCallback(async () => {
    if (verifyInFlight.current) {
      return;
    }

    verifyInFlight.current = true;
    setVerifying(true);
    setError(null);

    try {
      const session = await verifyAccess();
      setAuth(session);
      if (window.location.pathname !== "/dashboard") {
        window.location.replace(dashboardUrl());
      }
    } catch (requestError) {
      setError(isTimeoutError(requestError) ? "A verificacao demorou para responder. Tente novamente." : "Nao foi possivel validar seu acesso temporario.");
    } finally {
      verifyInFlight.current = false;
      setVerifying(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    auth,
    loading,
    error,
    loginDiscord,
    loginDevelopment,
    logout,
    refresh,
    verify,
    verifying
  };
}

function isTimeoutError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ECONNABORTED";
}

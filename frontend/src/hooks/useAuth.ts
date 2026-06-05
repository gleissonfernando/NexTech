import { useCallback, useEffect, useState } from "react";
import { getSession, loginDev, logout as logoutRequest, verifyAccess } from "../lib/api";
import type { AuthResponse } from "../types";

const DISCORD_AUTH_URL = "https://ricardinho98.shardweb.app/auth/discord";

export function useAuth() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const session = await getSession();
      setAuth(session);
    } catch {
      setAuth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loginDiscord = useCallback(() => {
    window.location.href = DISCORD_AUTH_URL;
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
    setVerifying(true);
    setError(null);

    try {
      const session = await verifyAccess();
      setAuth(session);
      window.history.replaceState(null, "", "/dashboard");
    } catch {
      setError("Nao foi possivel validar seu acesso temporario.");
    } finally {
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

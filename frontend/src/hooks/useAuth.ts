import { useCallback, useEffect, useState } from "react";
import { API_URL, getSession, loginDev, logout as logoutRequest } from "../lib/api";
import type { AuthResponse } from "../types";

export function useAuth() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [loading, setLoading] = useState(true);
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
    window.location.href = `${API_URL}/auth/discord`;
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
    refresh
  };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { checkSiteAccess, getSession, logout as logoutRequest, verifyAccess } from "../lib/api";
import { appUrl, dashboardUrl } from "../lib/urls";
import type { AccessValidationResult, AuthResponse } from "../types";

export function useAuth() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(false);
  const [accessValidation, setAccessValidation] = useState<AccessValidationResult | null>(null);
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
      setAccessValidation(session.validation ?? null);

      if (!session.access.verified) {
        setCheckingAccess(true);
        void checkSiteAccess()
          .then((validation) => {
            if (refreshId.current === requestId) {
              setAccessValidation(validation);
            }
          })
          .catch(() => {
            if (refreshId.current === requestId) {
              setAccessValidation(null);
            }
          })
          .finally(() => {
            if (refreshId.current === requestId) {
              setCheckingAccess(false);
            }
          });
      } else {
        setCheckingAccess(false);
      }
    } catch (requestError) {
      if (refreshId.current !== requestId) {
        return;
      }
      setAuth(null);
      setAccessValidation(null);
      setCheckingAccess(false);
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

  const logout = useCallback(async () => {
    await logoutRequest();
    setAuth(null);
    setAccessValidation(null);
    setCheckingAccess(false);
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
      setAccessValidation(session.validation ?? null);
      if (window.location.pathname !== "/dashboard") {
        window.location.replace(dashboardUrl());
      }
    } catch (requestError) {
      const validation = readRequestValidation(requestError);
      setAccessValidation(validation);
      setError(
        isTimeoutError(requestError)
          ? "A verificacao demorou para responder. Tente novamente."
          : readRequestMessage(requestError) ?? "Seu usuario nao possui o cargo liberado para acessar este painel."
      );
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
    accessValidation,
    checkingAccess,
    loading,
    error,
    loginDiscord,
    logout,
    refresh,
    verify,
    verifying
  };
}

function isTimeoutError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ECONNABORTED";
}

function readRequestMessage(error: unknown) {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return null;
  }

  const response = (error as { response?: { data?: { message?: unknown } } }).response;
  return typeof response?.data?.message === "string" ? response.data.message : null;
}

function readRequestValidation(error: unknown) {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return null;
  }

  const response = (error as { response?: { data?: { validation?: unknown } } }).response;
  return isAccessValidationResult(response?.data?.validation) ? response.data.validation : null;
}

function isAccessValidationResult(value: unknown): value is AccessValidationResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "allowed" in value &&
    "canManageDashboard" in value &&
    "checks" in value &&
    Array.isArray((value as { checks?: unknown }).checks)
  );
}

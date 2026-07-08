import { useCallback, useEffect, useRef, useState } from "react";
import { checkSiteAccess, clearTabVerification, getSession, logout as logoutRequest, verifyAccess } from "../lib/api";
import { appUrl, dashboardSlugFromPath, dashboardUrl, isDashboardRoutePath } from "../lib/urls";
import type { AccessValidationResult, AuthResponse } from "../types";

const ACCESS_DENIED_MESSAGE = "Você não está liberado para acessar esta dashboard.";
const AUTH_TIMEOUT_MS = 18_000;
export type AuthStatus =
  | "Conectando ao Discord..."
  | "Validando usuário..."
  | "Verificando liberação na dashboard..."
  | "Acesso liberado."
  | "Acesso negado.";

export function useAuth() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(false);
  const [accessValidation, setAccessValidation] = useState<AccessValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>("Validando usuário...");
  const refreshId = useRef(0);
  const verifyInFlight = useRef(false);

  const refresh = useCallback(async () => {
    const requestId = refreshId.current + 1;
    refreshId.current = requestId;
    setLoading(true);
    setError(null);
    setStatus("Validando usuário...");

    try {
      const session = await withTimeout(getSession(), AUTH_TIMEOUT_MS);
      if (refreshId.current !== requestId) {
        return;
      }
      setAuth(session);
      setAccessValidation(session.validation ?? null);
      setStatus(session.access.verified ? "Acesso liberado." : "Verificando liberação na dashboard...");

      if (!session.access.verified) {
        setCheckingAccess(true);
        void withTimeout(checkSiteAccess(dashboardSlugFromPath(window.location.pathname)), AUTH_TIMEOUT_MS)
          .then((validation) => {
            if (refreshId.current === requestId) {
              setAccessValidation(validation);
              setStatus(validation.allowed ? "Verificando liberação na dashboard..." : "Acesso negado.");
            }
          })
          .catch(() => {
            if (refreshId.current === requestId) {
              setAccessValidation(null);
              setStatus("Acesso negado.");
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
      setStatus("Acesso negado.");
      const responseStatus = readResponseStatus(requestError);
      if (isTimeoutError(requestError)) {
        setError("A sessão demorou para responder. Tente entrar novamente.");
      } else if (responseStatus && responseStatus !== 401) {
        setError(readRequestMessage(requestError) ?? "Não foi possível validar sua sessão.");
      }
    } finally {
      if (refreshId.current === requestId) {
        setLoading(false);
      }
    }
  }, []);

  const loginDiscord = useCallback(() => {
    clearTabVerification();
    setStatus("Conectando ao Discord...");
    const botSlug = dashboardSlugFromPath(window.location.pathname);
    const path = window.location.pathname.startsWith("/dev")
      ? "/auth/discord/dev"
      : botSlug
        ? `/auth/discord/bot/${encodeURIComponent(botSlug)}`
        : "/auth/discord/dev";
    window.location.href = appUrl(path);
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
    setStatus("Verificando liberação na dashboard...");

    try {
      const session = await withTimeout(verifyAccess(dashboardSlugFromPath(window.location.pathname)), AUTH_TIMEOUT_MS);
      setAuth(session);
      setAccessValidation(session.validation ?? null);
      setStatus("Acesso liberado.");
      if (!isProtectedPanelPath(window.location.pathname)) {
        window.location.replace(dashboardUrl());
      }
    } catch (requestError) {
      const validation = readRequestValidation(requestError);
      setAccessValidation(validation);
      const rejectionMessage = validation?.rejectionReasons?.[0] ?? null;
      setStatus("Acesso negado.");
      setError(
        isTimeoutError(requestError)
          ? "A verificação demorou para responder. Tente novamente."
          : rejectionMessage ?? readRequestMessage(requestError) ?? ACCESS_DENIED_MESSAGE
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
    status,
    verify,
    verifying
  };
}

function isProtectedPanelPath(path: string) {
  return isDashboardRoutePath(path) || path === "/dev" || path.startsWith("/dev/");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(Object.assign(new Error("Timeout da autenticação."), { code: "ECONNABORTED" }));
    }, timeoutMs);

    void promise
      .then(resolve)
      .catch(reject)
      .finally(() => window.clearTimeout(timeout));
  });
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

function readResponseStatus(error: unknown) {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return null;
  }

  const response = (error as { response?: { status?: unknown } }).response;
  return typeof response?.status === "number" ? response.status : null;
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

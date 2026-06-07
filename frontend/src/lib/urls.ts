const PRODUCTION_ORIGIN = "";

function normalizeUrl(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") || "/" : undefined;
}

function isPublicUrl(value?: string): value is string {
  if (!value || !/^https?:\/\//i.test(value)) {
    return false;
  }

  const url = new URL(value);
  return !["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname);
}

export function publicOrigin() {
  const configuredPublicUrl = normalizeUrl(import.meta.env.VITE_FRONTEND_URL);

  if (isPublicUrl(configuredPublicUrl)) {
    return configuredPublicUrl;
  }

  const browserOrigin = normalizeUrl(window.location.origin);
  return isPublicUrl(browserOrigin) ? browserOrigin : PRODUCTION_ORIGIN;
}

export function appUrl(path = "") {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const origin = publicOrigin();

  return origin ? `${origin}${normalizedPath}` : normalizedPath;
}

export function dashboardPath(slug?: string | null) {
  return slug ? `/dashboard/${encodeURIComponent(slug)}` : "/dashboard";
}

export function dashboardUrl(slug?: string | null) {
  return appUrl(dashboardPath(slug));
}

export function isDashboardRoutePath(path: string) {
  return path === "/dashboard" || path.startsWith("/dashboard/");
}

export function dashboardSlugFromPath(path: string) {
  if (!path.startsWith("/dashboard/")) {
    return null;
  }

  const slug = path.slice("/dashboard/".length).split("/")[0]?.trim();
  if (!slug) {
    return null;
  }

  try {
    return decodeURIComponent(slug);
  } catch {
    return null;
  }
}

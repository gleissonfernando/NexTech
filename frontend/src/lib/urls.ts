const PRODUCTION_ORIGIN = "https://nextech.discloud.app";
const RESERVED_DASHBOARD_PATHS = new Set(["hierarquia", "planos"]);

function normalizeUrl(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") || "/" : undefined;
}

function isPublicUrl(value?: string): value is string {
  if (!value || !/^https?:\/\//i.test(value)) {
    return false;
  }

  const url = new URL(value);
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname)) {
    return false;
  }

  return true;
}

export function publicOrigin() {
  const configuredPublicUrl = normalizeUrl(import.meta.env.VITE_FRONTEND_URL || import.meta.env.VITE_APP_BASE_URL);

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
  return slug ? `/${encodeURIComponent(slug)}/dashboard` : "/dashboard";
}

export function dashboardUrl(slug?: string | null) {
  return appUrl(dashboardPath(slug));
}

export function isDashboardRoutePath(path: string) {
  return path === "/dashboard" || path.startsWith("/dashboard/") || dashboardSlugFromPath(path) !== null;
}

export function dashboardSlugFromPath(path: string) {
  if (path.startsWith("/dashboard/")) {
    const slug = path.slice("/dashboard/".length).split("/")[0]?.trim();
    if (slug && RESERVED_DASHBOARD_PATHS.has(slug.toLowerCase())) {
      return null;
    }
    return decodeSlug(slug);
  }

  const match = path.match(/^\/([a-z0-9]+(?:-[a-z0-9]+)*)\/dashboard(?:\/|$)/i);
  if (match?.[1]) {
    return decodeSlug(match[1]);
  }

  return null;
}

function decodeSlug(slug?: string | null) {
  if (!slug) {
    return null;
  }

  try {
    return decodeURIComponent(slug);
  } catch {
    return null;
  }
}

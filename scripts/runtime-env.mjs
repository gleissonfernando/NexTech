export function packedConfigValueFromEnv(env, key) {
  const jsonConfig = cleanEnvValue(env.APP_CONFIG_JSON);
  const base64Config =
    cleanEnvValue(env.APP_CONFIG_B64)
    || cleanEnvValue(env.APP_CONFIG_BASE64)
    || cleanEnvValue(env.NEX_TECH_CONFIG_B64);
  const rawConfig = jsonConfig || (base64Config ? Buffer.from(base64Config, "base64").toString("utf8") : "");

  if (!rawConfig) {
    return "";
  }

  try {
    const parsed = JSON.parse(rawConfig);
    const value = parsed?.[key];
    return value === null || value === undefined ? "" : String(value).trim();
  } catch {
    return "";
  }
}

export function applyEnvIfConfigured(env, key, value) {
  if (cleanEnvValue(env[key])) {
    return env[key];
  }

  const normalized = cleanEnvValue(value);
  if (!normalized) {
    return env[key] ?? "";
  }

  env[key] = normalized;
  return normalized;
}

function cleanEnvValue(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

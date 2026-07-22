import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const historyDir = path.join(root, ".release-history");
const historyPath = path.join(historyDir, "auto-update-log.json");
const discordApi = "https://discord.com/api/v10";
const isDryRun = process.argv.includes("--dry-run");

export async function runAutoUpdateLogger(options = {}) {
  const channelId = readConfigValue("UPDATE_CHANNEL_ID") || readConfigValue("AUTO_UPDATE_CHANNEL_ID");
  const token = readConfigValue("DISCORD_BOT_TOKEN");
  const currentCommit = git(["rev-parse", "HEAD"]).trim();
  const history = readHistory();
  const existingRelease = history.releases.find((release) => release.commit === currentCommit);

  if (existingRelease?.discordSentAt || existingRelease?.discordMessageId) {
    console.log(`[auto-update] versão ${currentCommit.slice(0, 8)} já registrada; envio ignorado.`);
    return { skipped: true };
  }

  const previousCommit = existingRelease?.previousCommit || history.releases.find((release) => release.commit !== currentCommit)?.commit || safeGit(["rev-parse", "HEAD~1"]).trim();
  const analysis = analyzeRelease(previousCommit, currentCommit);
  const version = existingRelease?.version || nextVersion(history.releases.find((release) => release.commit !== currentCommit)?.version, readPackageVersion());
  const publishedAt = new Date().toISOString();
  const release = {
    ...(existingRelease ?? {}),
    id: currentCommit,
    version,
    commit: currentCommit,
    previousCommit: previousCommit || null,
    author: git(["log", "-1", "--format=%an <%ae>", currentCommit]).trim() || null,
    publishedAt,
    changeCount: analysis.changeCount,
    summary: analysis.summary,
    files: analysis.files.slice(0, 250)
  };

  if (isDryRun || options.dryRun) {
    const payload = buildDiscordPayload({ analysis, bot: null, channelId, release });
    console.log(JSON.stringify(payload, null, 2));
    return { release, skipped: true };
  }

  if (!channelId || !token) {
    upsertHistoryRelease(history, {
      ...release,
      discordChannelId: channelId || null,
      discordSkippedReason: "UPDATE_CHANNEL_ID ou DISCORD_BOT_TOKEN não configurado."
    });
    writeHistory(history);
    console.log("[auto-update] UPDATE_CHANNEL_ID ou DISCORD_BOT_TOKEN não configurado; histórico salvo sem envio Discord.");
    return { release, skipped: true };
  }

  const bot = await fetchDiscordBot(token).catch(() => null);
  const payload = buildDiscordPayload({ analysis, bot, channelId, release });

  const message = await sendDiscordMessage(token, channelId, payload);
  upsertHistoryRelease(history, {
    ...release,
    discordChannelId: channelId,
    discordMessageId: message?.id ?? null,
    discordSentAt: new Date().toISOString(),
    discordSkippedReason: null
  });
  writeHistory(history);
  console.log(`[auto-update] changelog ${version} enviado para o canal ${channelId}.`);
  return { release, skipped: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAutoUpdateLogger().catch((error) => {
    console.error("[auto-update] falhou:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

function analyzeRelease(previousCommit, currentCommit) {
  const range = previousCommit ? `${previousCommit}..${currentCommit}` : currentCommit;
  const nameStatus = git(["diff", "--name-status", range]);
  const numStat = git(["diff", "--numstat", range]);
  const patch = git(["diff", "--unified=0", range]);
  const files = parseChangedFiles(nameStatus, numStat);
  const addedLines = patch.split(/\r?\n/).filter((line) => line.startsWith("+") && !line.startsWith("+++"));
  const removedLines = patch.split(/\r?\n/).filter((line) => line.startsWith("-") && !line.startsWith("---"));
  const functions = detectFunctions(addedLines);
  const apis = detectApis(addedLines, files);
  const database = detectDatabaseChanges(addedLines, files);
  const modules = detectModules(addedLines, files);
  const summary = categorizeChanges({ addedLines, apis, database, files, functions, modules, removedLines });
  const changeCount = files.length + functions.length + apis.length + database.length + modules.length;

  return {
    apis,
    changeCount,
    database,
    files,
    functions,
    modules,
    summary
  };
}

function categorizeChanges(input) {
  const created = input.files.filter((file) => file.status === "created");
  const removed = input.files.filter((file) => file.status === "removed");
  const modified = input.files.filter((file) => file.status === "modified");
  const addedText = input.addedLines.join("\n").toLowerCase();
  const buckets = {
    novidades: [],
    melhorias: [],
    correcoes: [],
    tecnicas: [],
    recursos: [],
    removidos: []
  };

  for (const moduleName of input.modules.slice(0, 8)) buckets.novidades.push(`Novo módulo detectado: ${moduleName}`);
  for (const api of input.apis.slice(0, 8)) buckets.recursos.push(`API ${api.method.toUpperCase()} ${api.path} atualizada`);
  for (const item of input.database.slice(0, 6)) buckets.tecnicas.push(item);
  for (const fn of input.functions.slice(0, 8)) buckets.tecnicas.push(`Nova rotina detectada: ${fn}`);
  for (const file of created.slice(0, 8)) buckets.novidades.push(`Novo arquivo: ${friendlyPath(file.path)}`);
  for (const file of removed.slice(0, 6)) buckets.removidos.push(`Removido: ${friendlyPath(file.path)}`);

  if (/(cache|preload|lazy|buffer|stream|range|performance|otimiz|mem[oó]ria|cpu|fast|health)/i.test(addedText)) {
    buckets.melhorias.push("Carregamento, cache ou streaming otimizado automaticamente pelo diff.");
  }
  if (/(fix|corrig|erro|error|falha|failed|fallback|retry|timeout|invalid|black|render)/i.test(addedText)) {
    buckets.correcoes.push("Correções de falhas e tratamento de erro detectadas no código alterado.");
  }
  if (/(video|media|poster|thumbnail|codec|ffmpeg|h264|aac|renderiza)/i.test(addedText)) {
    buckets.melhorias.push("Renderização/processamento de mídia atualizado.");
  }
  if (/(component|components_v2|iscomponentsv2|flags)/i.test(addedText)) {
    buckets.recursos.push("Interface/painel em Componentes V2 atualizado.");
  }

  for (const file of modified.slice(0, 10)) {
    const label = classifyFile(file.path);
    if (label) buckets.tecnicas.push(`${label}: ${friendlyPath(file.path)}`);
  }

  return Object.fromEntries(
    Object.entries(buckets).map(([key, value]) => [key, unique(value).slice(0, 10)])
  );
}

function parseChangedFiles(nameStatus, numStat) {
  const stats = new Map();
  for (const line of numStat.split(/\r?\n/).filter(Boolean)) {
    const [added, removed, filePath] = line.split("\t");
    stats.set(filePath, {
      added: Number.isFinite(Number(added)) ? Number(added) : 0,
      removed: Number.isFinite(Number(removed)) ? Number(removed) : 0
    });
  }

  return nameStatus.split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [statusCode, filePath, renamedPath] = line.split("\t");
      const finalPath = renamedPath || filePath;
      const status = statusCode?.startsWith("A") ? "created" : statusCode?.startsWith("D") ? "removed" : statusCode?.startsWith("R") ? "renamed" : "modified";
      return { path: finalPath, status, ...(stats.get(finalPath) ?? { added: 0, removed: 0 }) };
    });
}

function detectFunctions(lines) {
  return unique(lines
    .map((line) => line.replace(/^\+\s*/, ""))
    .map((line) =>
      /(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_]+)/.exec(line)?.[1]
      ?? /(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:async\s*)?\(/.exec(line)?.[1]
      ?? /([a-zA-Z0-9_]+)\s*:\s*(?:async\s*)?\(/.exec(line)?.[1]
      ?? null
    )
    .filter(Boolean));
}

function detectApis(lines, files) {
  if (!files.some((file) => /backend\/src\/routes\//.test(file.path.replace(/\\/g, "/")))) return [];
  return uniqueBy(lines
    .map((line) => {
      const match = /\b(?:app|router|apiRouter|[a-zA-Z0-9_]*Router)\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/i.exec(line);
      return match ? { method: match[1].toLowerCase(), path: match[2] } : null;
    })
    .filter(Boolean), (item) => `${item.method}:${item.path}`);
}

function detectDatabaseChanges(lines, files) {
  const touchedDb = files.some((file) => /backend\/src\/database|migration|schema|prisma/i.test(file.path));
  if (!touchedDb) return [];
  const results = [];
  for (const line of lines) {
    const collection = /collection<[^>]+>\(["'`]([^"'`]+)["'`]\)/.exec(line)?.[1];
    const mongoType = /export\s+type\s+(Mongo[A-Za-z0-9_]+)/.exec(line)?.[1];
    const index = /createIndex\((.+)\)/.exec(line)?.[1];
    if (collection) results.push(`Coleção/tabela detectada: ${collection}`);
    if (mongoType) results.push(`Modelo de banco atualizado: ${mongoType}`);
    if (index) results.push("Índice de banco atualizado");
  }
  return unique(results);
}

function detectModules(lines, files) {
  const candidates = [];
  for (const line of lines) {
    const objectId = /id:\s*["'`]([a-z0-9_-]+)["'`]/i.exec(line)?.[1];
    const label = /label:\s*["'`]([^"'`]{3,80})["'`]/i.exec(line)?.[1];
    const title = /title:\s*["'`]([^"'`]{3,80})["'`]/i.exec(line)?.[1];
    if (label && looksLikeModuleLabel(label)) candidates.push(label);
    if (title && looksLikeModuleLabel(title)) candidates.push(title);
    if (objectId && files.some((file) => file.status === "created" && file.path.toLowerCase().includes(objectId))) candidates.push(objectId);
  }
  return unique(candidates);
}

function looksLikeModuleLabel(value) {
  if (/(codec|bitrate|dura[cç][aã]o|formato|fps|cache|renderiza[cç][aã]o|poster|url|mime|tamanho)/i.test(value)) return false;
  return /(sistema|m[oó]dulo|dashboard|painel|five|pol[ií]cia|captcha|media|vídeo|video)/i.test(value);
}

function buildDiscordPayload({ analysis, bot, release }) {
  const color = parseColor(readConfigValue("UPDATE_PANEL_COLOR") || "#FFD500");
  const bannerUrl = readConfigValue("UPDATE_PANEL_BANNER_URL");
  const footer = readConfigValue("UPDATE_PANEL_FOOTER") || "Atualização publicada automaticamente pela NextTech.";
  const date = new Date(release.publishedAt);
  const sections = [
    ["✨ Novidades", analysis.summary.novidades],
    ["🔧 Melhorias", analysis.summary.melhorias],
    ["🐞 Correções", analysis.summary.correcoes],
    ["⚙️ Alterações Técnicas", analysis.summary.tecnicas],
    ["📦 Recursos", analysis.summary.recursos],
    ["🗑 Recursos Removidos", analysis.summary.removidos]
  ].filter(([, items]) => items.length);
  const content = [
    `# 🚀 ${escapeMarkdown(readConfigValue("UPDATE_APP_NAME") || "NEXTTECH")}`,
    `**Versão:** \`${release.version}\``,
    `**Data:** ${date.toLocaleDateString("pt-BR")}`,
    `**Hora:** ${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
    `**Alterações detectadas:** ${release.changeCount}`,
    bot?.username ? `**Bot:** ${escapeMarkdown(bot.username)}` : null,
    "",
    ...sections.flatMap(([title, items]) => [
      "━━━━━━━━━━━━━━━━━━",
      `## ${title}`,
      ...items.map((item) => `• ${escapeMarkdown(item).slice(0, 180)}`)
    ]),
    "━━━━━━━━━━━━━━━━━━",
    `-# ${escapeMarkdown(footer)}`
  ].filter(Boolean).join("\n").slice(0, 3900);

  const components = [];
  if (bannerUrl) {
    components.push({ type: 12, items: [{ media: { url: bannerUrl }, description: "Banner da atualização" }] });
  }
  components.push({ type: 10, content });

  return {
    allowed_mentions: { parse: [] },
    components: [{ type: 17, accent_color: color, components }],
    flags: 32768
  };
}

async function fetchDiscordBot(token) {
  const response = await fetch(`${discordApi}/users/@me`, {
    headers: { Authorization: `Bot ${token}` }
  });
  if (!response.ok) throw new Error(`Discord bot profile HTTP ${response.status}`);
  return response.json();
}

async function sendDiscordMessage(token, channelId, payload) {
  const response = await fetch(`${discordApi}/channels/${encodeURIComponent(channelId)}/messages`, {
    body: JSON.stringify(payload),
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Discord changelog HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
  return response.json().catch(() => null);
}

function nextVersion(previousVersion, packageVersion) {
  const source = previousVersion || `v${packageVersion || "1.0.0"}`;
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(source);
  if (!match) return "v1.0.1";
  return `v${Number(match[1])}.${Number(match[2])}.${Number(match[3]) + 1}`;
}

function readHistory() {
  if (!existsSync(historyPath)) return { releases: [] };
  try {
    const parsed = JSON.parse(readFileSync(historyPath, "utf8"));
    return { releases: Array.isArray(parsed.releases) ? parsed.releases : [] };
  } catch {
    return { releases: [] };
  }
}

function writeHistory(history) {
  mkdirSync(historyDir, { recursive: true });
  writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`);
}

function upsertHistoryRelease(history, release) {
  const index = history.releases.findIndex((item) => item.commit === release.commit);
  if (index >= 0) {
    history.releases.splice(index, 1);
  }
  history.releases.unshift(release);
  history.releases = history.releases.slice(0, 100);
}

function readPackageVersion() {
  try {
    return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version || "1.0.0";
  } catch {
    return "1.0.0";
  }
}

function readConfigValue(key) {
  return process.env[key]?.trim() || readRuntimeConfigValue(key) || readDotEnvValue(key);
}

function readRuntimeConfigValue(key) {
  const files = [".nex-tech-runtime-env.json", ".NexTech-runtime-env.json", ".orvitek-runtime-env.json"];
  for (const file of files) {
    const fullPath = path.join(root, file);
    if (!existsSync(fullPath)) continue;
    try {
      const value = JSON.parse(readFileSync(fullPath, "utf8"))?.[key];
      if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    } catch {
      // Try next config source.
    }
  }
  return "";
}

function readDotEnvValue(key) {
  const envPath = path.join(root, ".env");
  if (!existsSync(envPath)) return "";
  const pattern = new RegExp(`^${escapeRegExp(key)}=(.*)$`);
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = pattern.exec(line.trim());
    if (!match) continue;
    return match[1].replace(/^["']|["']$/g, "").trim();
  }
  return "";
}

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} falhou: ${result.stderr}`);
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function safeGit(args) {
  try {
    return git(args);
  } catch {
    return "";
  }
}

function classifyFile(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.includes("/routes/")) return "API";
  if (normalized.includes("/services/")) return "Serviço";
  if (normalized.includes("/components/") || normalized.includes("/pages/")) return "Interface";
  if (normalized.includes("/database/")) return "Banco de dados";
  if (normalized.includes("/bot/")) return "Bot Discord";
  if (normalized.includes("/scripts/")) return "Automação";
  return null;
}

function friendlyPath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/^frontend\/src\//, "frontend/").replace(/^backend\/src\//, "backend/");
}

function parseColor(value) {
  const hex = value.trim().replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(hex) ? Number.parseInt(hex, 16) : 0xffd500;
}

function escapeMarkdown(value) {
  return String(value).replace(/([\\*_`~|>])/g, "\\$1");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function uniqueBy(values, keyFn) {
  const seen = new Set();
  return values.filter((value) => {
    const key = keyFn(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

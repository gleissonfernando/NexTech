import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const historyDir = path.join(root, ".release-history");
const historyPath = path.join(historyDir, "auto-update-log.json");
const releaseMetadataPath = path.join(root, ".nex-tech-release.json");
const discordApi = "https://discord.com/api/v10";
const isDryRun = process.argv.includes("--dry-run");
const isForceSend = process.argv.includes("--force") || process.env.AUTO_UPDATE_ALWAYS_SEND === "true";

export function buildCurrentReleaseMetadata() {
  const currentCommit = currentReleaseCommit(null);
  const previousCommit = safeGit(["rev-parse", "HEAD~1"]).trim();
  const analysis = currentCommit ? analyzeReleaseSafely(previousCommit, currentCommit, null) : normalizeAnalysis({});
  const history = readHistory();
  const existingRelease = currentCommit ? history.releases.find((release) => release.commit === currentCommit) : null;
  const previousVersion = history.releases.find((release) => release.commit !== currentCommit)?.version;

  return {
    generatedAt: new Date().toISOString(),
    version: existingRelease?.version || nextVersion(previousVersion, readPackageVersion()),
    commit: currentCommit || null,
    previousCommit: previousCommit || null,
    author: currentCommit ? safeGit(["log", "-1", "--format=%an <%ae>", currentCommit]).trim() || null : null,
    commitSubject: currentCommit ? safeGit(["log", "-1", "--format=%s", currentCommit]).trim() || null : null,
    commitBody: currentCommit ? safeGit(["log", "-1", "--format=%b", currentCommit]).trim() || null : null,
    analysis
  };
}

export async function runAutoUpdateLogger(options = {}) {
  const channelId = readConfigValue("UPDATE_CHANNEL_ID") || readConfigValue("AUTO_UPDATE_CHANNEL_ID");
  const token = readConfigValue("DISCORD_BOT_TOKEN");
  const metadata = readReleaseMetadata();
  const currentCommit = currentReleaseCommit(metadata);
  const history = readHistory();
  const existingRelease = history.releases.find((release) => release.commit === currentCommit);
  const forceSend = options.force === true || isForceSend;

  if (!currentCommit) {
    console.log("[auto-update] commit atual indisponível; envio ignorado.");
    return { skipped: true };
  }

  if (!forceSend && (existingRelease?.discordSentAt || existingRelease?.discordMessageId)) {
    console.log(`[auto-update] versão ${currentCommit.slice(0, 8)} já registrada; envio ignorado.`);
    return { skipped: true };
  }

  const previousCommit = existingRelease?.previousCommit
    || history.releases.find((release) => release.commit !== currentCommit)?.commit
    || metadata?.previousCommit
    || safeGit(["rev-parse", "HEAD~1"]).trim();
  const analysis = analyzeReleaseSafely(previousCommit, currentCommit, metadata);
  const version = existingRelease?.version
    || metadata?.version
    || nextVersion(history.releases.find((release) => release.commit !== currentCommit)?.version, readPackageVersion());
  const publishedAt = new Date().toISOString();
  const release = {
    ...(existingRelease ?? {}),
    id: currentCommit,
    version,
    commit: currentCommit,
    previousCommit: previousCommit || null,
    author: metadata?.author ?? (safeGit(["log", "-1", "--format=%an <%ae>", currentCommit]).trim() || null),
    commitSubject: metadata?.commitSubject ?? (safeGit(["log", "-1", "--format=%s", currentCommit]).trim() || null),
    commitBody: metadata?.commitBody ?? (safeGit(["log", "-1", "--format=%b", currentCommit]).trim() || null),
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

  if (!forceSend && await hasRecentDiscordRelease(token, channelId, currentCommit).catch(() => false)) {
    upsertHistoryRelease(history, {
      ...release,
      discordChannelId: channelId,
      discordSkippedReason: "Atualização já encontrada nas mensagens recentes do canal."
    });
    writeHistory(history);
    console.log(`[auto-update] versão ${currentCommit.slice(0, 8)} já encontrada no canal; envio ignorado.`);
    return { release, skipped: true };
  }

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

function analyzeReleaseSafely(previousCommit, currentCommit, metadata) {
  if (metadata?.analysis) {
    return normalizeAnalysis(metadata.analysis);
  }

  try {
    return analyzeRelease(previousCommit, currentCommit);
  } catch (error) {
    console.warn("[auto-update] diff git indisponível; usando resumo básico:", error instanceof Error ? error.message : String(error));
    return normalizeAnalysis({
      changeCount: metadata?.files?.length ?? 0,
      files: metadata?.files ?? [],
      summary: {
        novidades: [],
        melhorias: [],
        correcoes: metadata?.commitSubject ? [metadata.commitSubject] : [],
        tecnicas: [],
        recursos: [],
        removidos: []
      }
    });
  }
}

function normalizeAnalysis(analysis) {
  const summary = analysis?.summary && typeof analysis.summary === "object" ? analysis.summary : {};
  const files = Array.isArray(analysis?.files) ? analysis.files : [];
  return {
    apis: Array.isArray(analysis?.apis) ? analysis.apis : [],
    changeCount: Number.isFinite(Number(analysis?.changeCount)) ? Number(analysis.changeCount) : files.length,
    database: Array.isArray(analysis?.database) ? analysis.database : [],
    files,
    functions: Array.isArray(analysis?.functions) ? analysis.functions : [],
    modules: Array.isArray(analysis?.modules) ? analysis.modules : [],
    summary: {
      novidades: Array.isArray(summary.novidades) ? summary.novidades : [],
      melhorias: Array.isArray(summary.melhorias) ? summary.melhorias : [],
      correcoes: Array.isArray(summary.correcoes) ? summary.correcoes : [],
      tecnicas: Array.isArray(summary.tecnicas) ? summary.tecnicas : [],
      recursos: Array.isArray(summary.recursos) ? summary.recursos : [],
      removidos: Array.isArray(summary.removidos) ? summary.removidos : []
    }
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

  addKnownChangeSummaries(buckets, input.files, addedText, input.removedLines.join("\n").toLowerCase());

  for (const file of modified.slice(0, 10)) {
    const label = classifyFile(file.path);
    if (label) buckets.tecnicas.push(`${label}: ${friendlyPath(file.path)}`);
  }

  return Object.fromEntries(
    Object.entries(buckets).map(([key, value]) => [key, unique(value).slice(0, 10)])
  );
}

function addKnownChangeSummaries(buckets, files, addedText, removedText) {
  const paths = new Set(files.map((file) => file.path.replace(/\\/g, "/")));
  const hasPath = (...targets) => targets.some((target) => paths.has(target));

  if (hasPath("backend/src/middleware/auth.ts")) {
    buckets.correcoes.push("Corrigido o retorno de autenticação para sessões ausentes, expiradas, token inválido e acesso negado.");
  }

  if (hasPath("backend/src/routes/auth.ts")) {
    buckets.correcoes.push("Rotas de login, verificação e renovação agora retornam códigos de erro consistentes para o painel.");
  }

  if (hasPath("backend/src/services/userService.ts") && /session_/.test(addedText)) {
    buckets.melhorias.push("Eventos de sessão invalidada agora informam o motivo correto para o painel do usuário.");
  }

  if (
    hasPath("backend/src/services/devBotService.ts", "backend/src/services/settingsService.ts")
    && /invalidate.*dashboard.*session/i.test(removedText)
  ) {
    buckets.melhorias.push("Atualizações de bots e permissões deixam de derrubar sessões ativas sem necessidade.");
  }

  if (hasPath("frontend/src/hooks/useAuth.ts")) {
    buckets.correcoes.push("Painel agora diferencia sessão expirada, sessão revogada e logout, exibindo a mensagem correta.");
  }

  if (hasPath("frontend/src/lib/api.ts")) {
    buckets.correcoes.push("Cliente da API agora trata códigos de autenticação e acesso negado sem esconder o erro real.");
  }

  if (hasPath("scripts/auto-update-logger.mjs")) {
    buckets.melhorias.push("Painel automático de atualizações reformulado para publicar categorias e bullets mais claros.");
  }

  if (hasPath("scripts/release-discloud.mjs")) {
    buckets.melhorias.push("Release manual agora usa fallback automático para o CLI da Discloud e mantém o painel de atualizações ativo.");
  }
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
  const appName = readConfigValue("UPDATE_APP_NAME") || "NexTech";
  const footer = readConfigValue("UPDATE_PANEL_FOOTER") || `Atenciosamente, ${appName} 💜`;
  const observation = readConfigValue("UPDATE_PANEL_OBSERVATION")
    || "Atualização publicada automaticamente com correções, melhorias e ajustes gerais do sistema.";
  const showTechnical = readConfigValue("UPDATE_PANEL_SHOW_TECHNICAL") === "true";
  const date = new Date(release.publishedAt);
  const sections = [
    ["📌 O que mudou", buildReleaseChangeSummary(release, analysis)],
    ["🔧 Correções", analysis.summary.correcoes],
    ["🤖 Melhorias", analysis.summary.melhorias],
    ["🆕 Novidades", [...analysis.summary.novidades, ...analysis.summary.recursos]],
    ["🗑 Recursos Removidos", analysis.summary.removidos],
    ...(showTechnical ? [["⚙️ Alterações Técnicas", analysis.summary.tecnicas]] : [])
  ].map(([title, items]) => [title, unique(items).slice(0, 12)]).filter(([, items]) => items.length);

  if (!sections.length) {
    sections.push(["📌 O que mudou", ["Atualização publicada com alterações registradas no repositório."]]);
  }

  const content = [
    `## ATUALIZAÇÕES - ${formatUpdateDate(date)}`,
    "",
    ...sections.flatMap(([title, items]) => formatUpdateSection(title, items)),
    "📣 **Observação**",
    `• ${escapeMarkdown(observation).slice(0, 260)}`,
    "",
    `-# Versão ${escapeMarkdown(release.version)} • commit ${release.commit.slice(0, 8)}`,
    `-# **${escapeMarkdown(footer)}**`
  ].filter((item) => item !== null && item !== undefined && item !== false).join("\n").slice(0, 3900);

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

function buildReleaseChangeSummary(release, analysis) {
  const items = [];
  if (release.commitSubject) {
    items.push(release.commitSubject);
  }

  const changedFiles = analysis.files
    .filter((file) => file.status !== "removed")
    .slice(0, 6)
    .map((file) => {
      const label = classifyFile(file.path);
      const operation = file.status === "created" ? "criado" : file.status === "renamed" ? "renomeado" : "atualizado";
      return `${label ? `${label} ` : ""}${operation}: ${friendlyPath(file.path)}`;
    });

  items.push(...changedFiles);

  if (!items.length && release.commitBody) {
    items.push(...release.commitBody.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 4));
  }

  return items;
}

function formatUpdateSection(title, items) {
  return [
    `**${title}**`,
    ...items.map((item) => `• ${escapeMarkdown(item).slice(0, 220)}`),
    ""
  ];
}

function formatUpdateDate(date) {
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
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

async function hasRecentDiscordRelease(token, channelId, commit) {
  if (!commit) return false;
  const response = await fetch(`${discordApi}/channels/${encodeURIComponent(channelId)}/messages?limit=50`, {
    headers: { Authorization: `Bot ${token}` }
  });
  if (!response.ok) return false;
  const messages = await response.json().catch(() => []);
  if (!Array.isArray(messages)) return false;
  const shortCommit = commit.slice(0, 8);
  return messages.some((message) => {
    const text = JSON.stringify({
      content: message?.content,
      components: message?.components,
      embeds: message?.embeds
    });
    return text.includes(commit) || text.includes(shortCommit);
  });
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

function readReleaseMetadata() {
  if (!existsSync(releaseMetadataPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(releaseMetadataPath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function currentReleaseCommit(metadata) {
  return safeGit(["rev-parse", "HEAD"]).trim()
    || process.env.RELEASE_COMMIT?.trim()
    || process.env.DISCORD_RELEASE_COMMIT?.trim()
    || (typeof metadata?.commit === "string" ? metadata.commit.trim() : "")
    || "";
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

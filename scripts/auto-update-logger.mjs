import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const historyDir = path.join(root, ".release-history");
const historyPath = path.join(historyDir, "auto-update-log.json");
const draftMarkdownPath = path.join(historyDir, "auto-update-draft.md");
const draftJsonPath = path.join(historyDir, "auto-update-draft.json");
const releaseMetadataPath = path.join(root, ".nex-tech-release.json");
const discordApi = "https://discord.com/api/v10";
const changelogCollectionName = "system_update_changelogs";
const isDryRun = process.argv.includes("--dry-run");
const isSendRequested = process.argv.includes("--send") || process.env.AUTO_UPDATE_SEND === "true";
const isForceSend = process.argv.includes("--force") || process.env.AUTO_UPDATE_ALWAYS_SEND === "true";
const cliMode = process.argv.find((arg) => arg.startsWith("--mode="))?.slice("--mode=".length);

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
  const sendEnabled = options.send === true || isSendRequested;
  const forceSend = options.force === true || isForceSend;

  if (!currentCommit) {
    console.log("[auto-update] commit atual indisponível; envio ignorado.");
    return { skipped: true };
  }

  if (sendEnabled && !forceSend && (existingRelease?.discordSentAt || existingRelease?.discordMessageId)) {
    console.log(`[auto-update] versão ${currentCommit.slice(0, 8)} já registrada; envio ignorado.`);
    return { skipped: true };
  }

  const previousCommit = existingRelease?.previousCommit
    || history.releases.find((release) => release.commit !== currentCommit)?.commit
    || metadata?.previousCommit
    || safeGit(["rev-parse", "HEAD~1"]).trim();
  const analysis = analyzeReleaseSafely(previousCommit, currentCommit, metadata);
  const panelMode = normalizeUpdatePanelMode(options.mode || cliMode || readConfigValue("UPDATE_PANEL_MODE"));
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
  const changelog = buildChangelogRecord({ analysis, release });
  validateChangelogForPublish(changelog);

  if (isDryRun || options.dryRun) {
    const payload = buildDiscordPayload({ analysis, bot: null, channelId, changelog, mode: panelMode, release });
    console.log(JSON.stringify(payload, null, 2));
    return { release, skipped: true };
  }

  const payload = buildDiscordPayload({ analysis, bot: null, channelId, changelog, mode: panelMode, release });

  if (!sendEnabled) {
    writeReleaseDraft(release, payload);
    upsertHistoryRelease(history, {
      ...release,
      discordChannelId: channelId || null,
      discordSkippedReason: "Atualização salva como rascunho; envio automático desativado."
    });
    writeHistory(history);
    await persistChangelog(changelog, { discordChannelId: channelId || null, publishSkippedReason: "Atualização salva como rascunho; envio automático desativado." });
    console.log(`[auto-update] changelog ${version} salvo como rascunho; envio Discord desativado.`);
    return { release, skipped: true };
  }

  if (!channelId || !token) {
    writeReleaseDraft(release, payload);
    upsertHistoryRelease(history, {
      ...release,
      discordChannelId: channelId || null,
      discordSkippedReason: "UPDATE_CHANNEL_ID ou DISCORD_BOT_TOKEN não configurado."
    });
    writeHistory(history);
    await persistChangelog(changelog, { discordChannelId: channelId || null, publishSkippedReason: "UPDATE_CHANNEL_ID ou DISCORD_BOT_TOKEN não configurado." });
    console.log("[auto-update] UPDATE_CHANNEL_ID ou DISCORD_BOT_TOKEN não configurado; histórico salvo sem envio Discord.");
    return { release, skipped: true };
  }

  const bot = await fetchDiscordBot(token).catch(() => null);
  const sendPayload = buildDiscordPayload({ analysis, bot, channelId, changelog, mode: panelMode, release });

  if (!forceSend && await hasRecentDiscordRelease(token, channelId, currentCommit, version).catch(() => false)) {
    writeReleaseDraft(release, sendPayload);
    upsertHistoryRelease(history, {
      ...release,
      discordChannelId: channelId,
      discordSkippedReason: "Atualização já encontrada nas mensagens recentes do canal."
    });
    writeHistory(history);
    await persistChangelog(changelog, { discordChannelId: channelId, publishSkippedReason: "Atualização já encontrada nas mensagens recentes do canal." });
    console.log(`[auto-update] versão ${currentCommit.slice(0, 8)} já encontrada no canal; envio ignorado.`);
    return { release, skipped: true };
  }

  const message = await sendDiscordMessage(token, channelId, sendPayload);
  upsertHistoryRelease(history, {
    ...release,
    discordChannelId: channelId,
    discordMessageId: message?.id ?? null,
    discordSentAt: new Date().toISOString(),
    discordSkippedReason: null
  });
  writeHistory(history);
  await persistChangelog(changelog, {
    discordChannelId: channelId,
    discordMessageId: message?.id ?? null,
    discordSentAt: new Date().toISOString(),
    publishSkippedReason: null
  });
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

function buildDiscordPayload({ analysis, bot, changelog, mode, release }) {
  const color = parseColor(readConfigValue("UPDATE_PANEL_COLOR") || "#5865F2");
  const appName = readConfigValue("UPDATE_APP_NAME") || "NexTech";
  const footerText = readConfigValue("UPDATE_PANEL_FOOTER_TEXT")
    || readConfigValue("UPDATE_PANEL_SIGNATURE")
    || `Atenciosamente, ${appName}`;
  const footerIconUrl = readConfigValue("UPDATE_PANEL_FOOTER_ICON_URL") || discordBotAvatarUrl(bot);
  const observation = readConfigValue("UPDATE_PANEL_OBS")
    || "Estamos trabalhando em uma grande atualização que será lançada na próxima semana. Por esse motivo, alguns sistemas ainda não foram incluídos nesta atualização.";
  const showTechnical = readConfigValue("UPDATE_PANEL_SHOW_TECHNICAL") === "true";
  const date = new Date(release.publishedAt);
  const compact = mode === "realtime-summary";
  const sections = compact ? buildCompactChangelogSections(changelog) : buildFullChangelogSections(changelog, analysis, showTechnical);
  const technicalLine = showTechnical ? `\n-# Hash interno: ${release.commit.slice(0, 12)}` : "";
  const description = [
    ...sections.flatMap(([title, items]) => formatSimpleUpdateSection(title, items)),
    `**OBS:** ${escapeMarkdown(observation).slice(0, 650)}`,
    "",
    technicalLine,
  ].filter((item) => item !== null && item !== undefined && item !== false).join("\n").slice(0, 3900);
  const banner = updatePanelBanner();
  const footer = updatePanelFooter(footerText, footerIconUrl);
  const components = [
    ...(banner.url ? [{ type: 12, items: [{ media: { url: banner.url }, description: "Banner da atualização NexTech" }] }] : []),
    {
      type: 10,
      content: [
        `# ATUALIZAÇÕES - ${formatUpdateDate(date)}`,
        `-# ${escapeMarkdown(appName)} • ${escapeMarkdown(changelog.version)}`
      ].join("\n")
    },
    { type: 10, content: description },
    ...(footer?.text ? [{ type: 10, content: `-# ${escapeMarkdown(footer.text)}` }] : []),
    buildUpdateActionRow(changelog)
  ];

  return {
    allowed_mentions: { parse: [] },
    attachments: banner.file ? [{ description: "Banner da atualização NexTech", filename: banner.file.name, id: 0 }] : undefined,
    components: [{ type: 17, accent_color: color, components }],
    flags: 32768,
    __files: banner.file ? [banner.file] : undefined
  };
}

function buildChangelogRecord({ analysis, release }) {
  const registered = readRegisteredChangelog();
  const title = sanitizeSingleLine(registered.title || readConfigValue("UPDATE_TITLE") || "Atualização do Sistema");
  const version = sanitizeSingleLine(registered.version || release.version);
  const responsible = sanitizeSingleLine(registered.responsible || readConfigValue("UPDATE_RESPONSIBLE") || "Equipe NexTech");
  const status = normalizePublicationStatus(registered.status || readConfigValue("UPDATE_PUBLICATION_STATUS") || "concluida");
  const importantInfo = sanitizeItems([
    ...toList(registered.importantInfo),
    ...toList(readConfigValue("UPDATE_IMPORTANT_INFO"))
  ]);
  const affectedModules = sanitizeItems([
    ...toList(registered.affectedModules),
    ...toList(readConfigValue("UPDATE_AFFECTED_MODULES")),
    ...analysis.modules
  ]).slice(0, 12);
  const categories = {
    novidades: sanitizeItems([
      ...toList(registered.novidades),
      ...analysis.summary.novidades,
      ...analysis.summary.recursos
    ]),
    melhorias: sanitizeItems([
      ...toList(registered.melhorias),
      ...analysis.summary.melhorias
    ]),
    correcoes: sanitizeItems([
      ...toList(registered.correcoes),
      ...analysis.summary.correcoes
    ])
  };
  hydrateCategoriesFromCommit(categories, release);

  return {
    id: release.id,
    internalIdentifier: `nextech-update-${version}-${release.commit.slice(0, 12)}`,
    title,
    version,
    description: sanitizeSingleLine(registered.description || release.commitSubject || ""),
    publishedAt: release.publishedAt,
    responsible,
    status,
    statusLabel: statusLabel(status),
    restartRequired: parseBoolean(registered.restartRequired ?? readConfigValue("UPDATE_RESTART_REQUIRED")),
    affectedModules,
    importantInfo: importantInfo.length ? importantInfo : [
      "Nenhuma configuração existente foi removida.",
      "Não é necessário configurar o sistema novamente.",
      "As alterações já estão disponíveis automaticamente."
    ],
    categories,
    commitHash: release.commit,
    commitShort: release.commit.slice(0, 8),
    commitSubject: release.commitSubject || null,
    commitBody: release.commitBody || null,
    changeCount: release.changeCount,
    files: release.files
  };
}

function buildFullChangelogSections(changelog, analysis, showTechnical) {
  return [
    ["🆕 NOVIDADES", changelog.categories.novidades],
    ["✨ MELHORIAS", changelog.categories.melhorias],
    ["🛠️ CORREÇÕES", changelog.categories.correcoes],
    ...(showTechnical ? [["⚙️ ALTERAÇÕES TÉCNICAS", analysis.summary.tecnicas]] : [])
  ].map(([title, items]) => [title, unique(items).slice(0, 12)]).filter(([, items]) => items.length);
}

function buildCompactChangelogSections(changelog) {
  return [
    ["🆕 NOVIDADES", changelog.categories.novidades.slice(0, 5)],
    ["✨ MELHORIAS", changelog.categories.melhorias.slice(0, 5)],
    ["🛠️ CORREÇÕES", changelog.categories.correcoes.slice(0, 5)]
  ].filter(([, items]) => items.length);
}

function buildUpdateActionRow(changelog) {
  const detailsUrl = updateUrl("UPDATE_DETAILS_URL", `/dev/maintenance?update=${encodeURIComponent(changelog.version)}`);
  const historyUrl = updateUrl("UPDATE_HISTORY_URL", "/dev/maintenance?tab=versions");
  const reportUrl = updateUrl("UPDATE_REPORT_PROBLEM_URL", `/dev/maintenance?report=${encodeURIComponent(changelog.version)}`);
  const buttons = [
    actionButton("Ver detalhes", detailsUrl, `nextech_update_details:${changelog.version}`, 1),
    actionButton("Histórico de versões", historyUrl, "nextech_update_history", 2),
    actionButton("Reportar problema", reportUrl, `nextech_update_report:${changelog.version}`, 4)
  ];
  return { type: 1, components: buttons };
}

function actionButton(label, url, customId, style) {
  if (url) return { type: 2, label, style: 5, url };
  return { type: 2, custom_id: customId.slice(0, 100), disabled: true, label, style };
}

function updateUrl(envKey, fallbackPath) {
  const configured = readConfigValue(envKey);
  if (isHttpUrl(configured)) return configured;
  const base = readConfigValue("FRONTEND_URL") || readConfigValue("SITE_ORIGIN") || readConfigValue("BACKEND_URL");
  if (!isHttpUrl(base)) return "";
  return `${base.replace(/\/+$/, "")}${fallbackPath}`;
}

function validateChangelogForPublish(changelog) {
  const detailedItems = [
    ...changelog.categories.novidades,
    ...changelog.categories.melhorias,
    ...changelog.categories.correcoes
  ].filter((item) => isDetailedChangelogItem(item));
  if (!detailedItems.length) {
    throw new Error("Changelog inválido: informe ao menos uma novidade, melhoria ou correção com descrição específica.");
  }
}

function hydrateCategoriesFromCommit(categories, release) {
  const commitItems = buildReleaseMessageItems(release).filter(isDetailedChangelogItem);
  for (const item of commitItems) {
    const target = looksLikeCorrection(item)
      ? categories.correcoes
      : looksLikeNews(item)
        ? categories.novidades
        : categories.melhorias;
    target.push(item);
  }
  categories.novidades = unique(categories.novidades).filter(isDetailedChangelogItem).slice(0, 12);
  categories.melhorias = unique(categories.melhorias).filter(isDetailedChangelogItem).slice(0, 12);
  categories.correcoes = unique(categories.correcoes).filter(isDetailedChangelogItem).slice(0, 12);
}

function isDetailedChangelogItem(item) {
  const normalized = String(item || "").trim();
  if (normalized.length < 16) return false;
  return !/^(painel atualizado|sistema atualizado|sistema melhorado|atualiza[cç][aã]o publicada|ajustes gerais|corre[cç][oõ]es gerais)$/i.test(normalized)
    && !/Correções de falhas e tratamento de erro detectadas no código alterado/i.test(normalized)
    && !/Carregamento, cache ou streaming otimizado automaticamente pelo diff/i.test(normalized)
    && !/Atualização publicada com alterações registradas no repositório/i.test(normalized);
}

async function persistChangelog(changelog, publication) {
  const uris = mongoUriCandidates();
  let MongoClient;
  if (uris.length) {
    try {
      ({ MongoClient } = await import("mongodb"));
    } catch {
      console.warn("[auto-update] mongodb indisponível; tentando salvar histórico pela API interna.");
    }
  }

  let lastError = "";
  for (const uri of MongoClient ? uris : []) {
    const client = new MongoClient(uri);
    try {
      await client.connect();
      const db = client.db(databaseNameFromUri(uri));
      const collection = db.collection(changelogCollectionName);
      await collection.createIndex({ commitHash: 1 }, { unique: true });
      await collection.createIndex({ publishedAt: -1 });
      await collection.updateOne(
        { commitHash: changelog.commitHash },
        {
          $set: {
            ...changelog,
            publication,
            updatedAt: new Date().toISOString()
          },
          $setOnInsert: {
            createdAt: new Date().toISOString()
          }
        },
        { upsert: true }
      );
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  if (await persistChangelogViaBackend(changelog, publication)) return;
  console.warn("[auto-update] falha ao salvar changelog no histórico permanente:", lastError || "backend interno indisponível");
}

function mongoUriCandidates() {
  const keys = ["MONGODB_URI", "MONGO_URI", "DATABASE_URL"];
  const candidates = [];
  for (const key of keys) {
    candidates.push(
      process.env[key]?.trim() || "",
      readRuntimeConfigValue(key),
      readDotEnvValue(key),
      readPackedConfigValue(key)
    );
  }
  return unique(candidates.filter((uri) => /^mongodb(?:\+srv)?:\/\//i.test(uri)));
}

function readPackedConfigValue(key) {
  const rawConfig = process.env.APP_CONFIG_JSON?.trim()
    || (process.env.APP_CONFIG_B64?.trim() ? Buffer.from(process.env.APP_CONFIG_B64.trim(), "base64").toString("utf8") : "")
    || (process.env.APP_CONFIG_BASE64?.trim() ? Buffer.from(process.env.APP_CONFIG_BASE64.trim(), "base64").toString("utf8") : "")
    || (process.env.NEX_TECH_CONFIG_B64?.trim() ? Buffer.from(process.env.NEX_TECH_CONFIG_B64.trim(), "base64").toString("utf8") : "")
    || readDotEnvValue("APP_CONFIG_JSON")
    || decodeBase64Config(readDotEnvValue("APP_CONFIG_B64"))
    || decodeBase64Config(readDotEnvValue("APP_CONFIG_BASE64"))
    || decodeBase64Config(readDotEnvValue("NEX_TECH_CONFIG_B64"));

  if (!rawConfig) return "";
  try {
    const parsed = JSON.parse(rawConfig);
    const value = parsed?.[key];
    return value === null || value === undefined ? "" : String(value).trim();
  } catch {
    return "";
  }
}

async function persistChangelogViaBackend(changelog, publication) {
  const token = readConfigValue("BOT_API_TOKEN");
  const base = readConfigValue("BACKEND_URL") || readConfigValue("SITE_ORIGIN") || readConfigValue("FRONTEND_URL") || "https://nextech.discloud.app";
  if (!token || !isHttpUrl(base)) return false;
  try {
    const response = await fetch(`${base.replace(/\/+$/, "")}/api/system-updates/internal/changelog`, {
      body: JSON.stringify({ changelog, publication }),
      headers: {
        "Content-Type": "application/json",
        "x-bot-token": token
      },
      method: "POST"
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 240)}`);
    }
    return true;
  } catch (error) {
    console.warn("[auto-update] backend interno não salvou changelog:", error instanceof Error ? error.message : String(error));
    return false;
  }
}

function decodeBase64Config(value) {
  if (!value) return "";
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function normalizeUpdatePanelMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["realtime", "tempo-real", "realtime-summary", "summary", "resumo", "compact", "compacto"].includes(normalized)
    ? "realtime-summary"
    : "full";
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

function buildRealtimeSummarySections(release, analysis) {
  const releaseItems = buildReleaseMessageItems(release);
  const specificCorrections = specificRealtimeItems(analysis.summary.correcoes);
  const specificNews = specificRealtimeItems([
    ...analysis.summary.novidades,
    ...analysis.summary.recursos,
    ...analysis.summary.melhorias
  ]);
  const correctionItems = [];
  const newsItems = [];

  for (const item of releaseItems) {
    if (looksLikeCorrection(item)) {
      correctionItems.push(humanizeRealtimeItem(item, "correction"));
    } else if (looksLikeNews(item)) {
      newsItems.push(humanizeRealtimeItem(item, "news"));
    }
  }

  newsItems.push(...specificNews.map((item) => humanizeRealtimeItem(item, "news")));
  correctionItems.push(...specificCorrections.map((item) => humanizeRealtimeItem(item, "correction")));

  if (!newsItems.length && !correctionItems.length) {
    newsItems.push("Atualização publicada com mudanças registradas no sistema.");
  }

  return [
    ["🆕 Novidades", unique(newsItems).slice(0, 5)],
    ["🔧 Erros corrigidos", unique(correctionItems).slice(0, 5)]
  ].filter(([, items]) => items.length);
}

function buildReleaseMessageItems(release) {
  const items = [];
  if (release.commitSubject) items.push(release.commitSubject);
  if (release.commitBody) {
    items.push(...release.commitBody
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^[-*]\s+/, ""))
      .filter(Boolean)
      .slice(0, 6));
  }
  return unique(items);
}

function specificRealtimeItems(items) {
  return unique(items)
    .filter((item) => !isGenericRealtimeItem(item))
    .slice(0, 6);
}

function isGenericRealtimeItem(item) {
  return /Correções de falhas e tratamento de erro detectadas no código alterado/i.test(item)
    || /Atualização publicada com alterações registradas no repositório/i.test(item)
    || /Carregamento, cache ou streaming otimizado automaticamente pelo diff/i.test(item);
}

function looksLikeCorrection(item) {
  return /(corrig|corre[cç][aã]o|erro|falha|bug|fix|ajust|resolve|repara|impede|remove|remov|refor[cç]a|valida|tratamento)/i.test(item);
}

function looksLikeNews(item) {
  return /(adicion|novo|nova|cria|criado|implement|inclu|libera|publica|sistema|m[oó]dulo|painel|modal|recurso|suporte)/i.test(item);
}

function humanizeRealtimeItem(item, kind) {
  const normalized = item.trim().replace(/[.。]+$/, "");
  if (/^(foi|foram)\s/i.test(normalized)) return normalized;
  if (kind === "news" && /^(adicion|cria|implement|inclu|libera|publica)/i.test(normalized)) {
    return `Foi adicionado: ${normalized}`;
  }
  if (kind === "correction" && /^(corrig|ajust|resolve|remove|remov|refor[cç]a|valida|impede)/i.test(normalized)) {
    return `Foi corrigido: ${normalized}`;
  }
  return normalized;
}

function formatUpdateSection(title, items) {
  return [
    `**${title}**`,
    ...items.map((item) => `- ${escapeMarkdown(item).slice(0, 220)}`),
    ""
  ];
}

function formatSimpleUpdateSection(title, items) {
  return [
    `**${normalizeSimpleUpdateTitle(title)}**`,
    ...items.map((item) => `• ${escapeMarkdown(item).slice(0, 220)}`),
    ""
  ];
}

function updatePanelFooter(text, iconUrl) {
  const footerText = sanitizeSingleLine(text);
  if (!footerText) return undefined;
  const cleanIconUrl = isHttpUrl(iconUrl) ? String(iconUrl).trim() : "";
  return cleanIconUrl
    ? { icon_url: cleanIconUrl, text: footerText.slice(0, 2048) }
    : { text: footerText.slice(0, 2048) };
}

function updatePanelBanner() {
  const configuredUrl = readConfigValue("UPDATE_PANEL_BANNER_URL");
  if (isHttpUrl(configuredUrl)) return { url: configuredUrl.trim() };

  const configuredPath = readConfigValue("UPDATE_PANEL_BANNER_PATH");
  const candidate = configuredPath
    ? path.resolve(root, configuredPath)
    : path.join(root, "assets", "update-panel-banner.png");
  if (!existsSync(candidate)) return { url: "" };

  const name = "nextech-update-panel.png";
  return {
    file: {
      contentType: "image/png",
      name,
      path: candidate
    },
    url: `attachment://${name}`
  };
}

function discordBotAvatarUrl(bot) {
  if (!bot?.id || !bot?.avatar) return "";
  const extension = String(bot.avatar).startsWith("a_") ? "gif" : "png";
  return `${discordApi}/avatars/${bot.id}/${bot.avatar}.${extension}?size=128`;
}

function normalizeSimpleUpdateTitle(title) {
  const normalized = String(title || "").replace(/[A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ ]+$/u, (value) => value.toLowerCase());
  if (/corre/i.test(normalized) || /erro/i.test(normalized)) return "🔧 Correções";
  if (/nov/i.test(normalized)) return "🆕 Novidades";
  if (/melhor/i.test(normalized)) return "✨ Melhorias";
  return normalized.replace(/\s+/g, " ").trim() || "Atualizações";
}

function formatUpdateDate(date) {
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function formatUpdateDateTime(date) {
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
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
  const files = Array.isArray(payload.__files) ? payload.__files : [];
  const discordPayload = stripInternalPayloadFields(payload);
  const body = files.length ? multipartDiscordBody(discordPayload, files) : JSON.stringify(discordPayload);
  const response = await fetch(`${discordApi}/channels/${encodeURIComponent(channelId)}/messages`, {
    body,
    headers: {
      Authorization: `Bot ${token}`,
      ...(files.length ? {} : { "Content-Type": "application/json" })
    },
    method: "POST"
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Discord changelog HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
  return response.json().catch(() => null);
}

function stripInternalPayloadFields(payload) {
  const { __files, ...discordPayload } = payload;
  return JSON.parse(JSON.stringify(discordPayload));
}

function multipartDiscordBody(payload, files) {
  const form = new FormData();
  form.append("payload_json", JSON.stringify(payload));
  files.forEach((file, index) => {
    form.append(`files[${index}]`, new Blob([readFileSync(file.path)], { type: file.contentType }), file.name);
  });
  return form;
}

async function hasRecentDiscordRelease(token, channelId, commit, version) {
  if (!commit && !version) return false;
  const response = await fetch(`${discordApi}/channels/${encodeURIComponent(channelId)}/messages?limit=50`, {
    headers: { Authorization: `Bot ${token}` }
  });
  if (!response.ok) return false;
  const messages = await response.json().catch(() => []);
  if (!Array.isArray(messages)) return false;
  const shortCommit = commit ? commit.slice(0, 8) : "";
  return messages.some((message) => {
    const text = JSON.stringify({
      content: message?.content,
      components: message?.components,
      embeds: message?.embeds
    });
    return (commit && text.includes(commit))
      || (shortCommit && text.includes(shortCommit))
      || (version && text.includes(version));
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

function writeReleaseDraft(release, payload) {
  mkdirSync(historyDir, { recursive: true });
  const content = extractPayloadContent(payload);
  writeFileSync(draftMarkdownPath, `${content}\n`);
  writeFileSync(draftJsonPath, `${JSON.stringify({ release, payload }, null, 2)}\n`);
}

function extractPayloadContent(payload) {
  const components = payload?.components?.[0]?.components;
  if (!Array.isArray(components)) {
    return "";
  }

  return components
    .filter((component) => component?.type === 10 && typeof component.content === "string")
    .map((component) => component.content)
    .join("\n\n")
    .trim();
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

function readRegisteredChangelog() {
  const fromEnv = parseJsonObject(readConfigValue("UPDATE_CHANGELOG_JSON"));
  if (fromEnv) return normalizeRegisteredChangelog(fromEnv);

  const configuredPath = readConfigValue("UPDATE_CHANGELOG_FILE");
  const candidates = [
    configuredPath ? path.resolve(root, configuredPath) : "",
    path.join(historyDir, "update-changelog.json")
  ].filter(Boolean);

  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    const parsed = parseJsonObject(readFileSync(filePath, "utf8"));
    if (parsed) return normalizeRegisteredChangelog(parsed);
  }

  return {};
}

function normalizeRegisteredChangelog(value) {
  return {
    title: value.title ?? value.titulo,
    version: value.version ?? value.versao,
    description: value.description ?? value.descricao,
    responsible: value.responsible ?? value.responsavel,
    status: value.status ?? value.publicationStatus ?? value.statusPublicacao,
    restartRequired: value.restartRequired ?? value.reinicializacaoNecessaria,
    affectedModules: value.affectedModules ?? value.modules ?? value.sistemasAfetados ?? value.modulosAfetados,
    importantInfo: value.importantInfo ?? value.informacoesImportantes ?? value.avisos,
    novidades: value.novidades ?? value.news,
    melhorias: value.melhorias ?? value.improvements,
    correcoes: value.correcoes ?? value["correções"] ?? value.fixes
  };
}

function parseJsonObject(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
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

function databaseNameFromUri(uri) {
  const configured = readConfigValue("MONGODB_DATABASE_NAME")
    || readConfigValue("MONGODB_DB_NAME")
    || readConfigValue("MONGODB_DB")
    || readConfigValue("MONGO_DATABASE");
  if (configured) return configured;
  const rawName = uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/i)?.[1] || "";
  const decoded = rawName ? decodeURIComponent(rawName) : "";
  return decoded || "nextech";
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

function normalizePublicationStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (/(gradual|libera[cç][aã]o)/i.test(normalized)) return "gradual";
  if (/(rein[ií]cio|restart|reboot)/i.test(normalized)) return "restart_required";
  if (/(instab|erro|falha|degrad)/i.test(normalized)) return "degraded";
  return "completed";
}

function statusLabel(status) {
  if (status === "gradual") return "Atualização sendo liberada gradualmente";
  if (status === "restart_required") return "Atualização concluída; reinicialização necessária";
  if (status === "degraded") return "Atualização publicada com instabilidade monitorada";
  return "Atualização concluída com sucesso";
}

function sanitizeSingleLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 180);
}

function sanitizeItems(values) {
  return unique(toList(values)
    .map((item) => sanitizeSingleLine(item).replace(/^[-•*]\s+/, ""))
    .filter(Boolean));
}

function toList(value) {
  if (Array.isArray(value)) return value.flatMap(toList);
  if (value === null || value === undefined) return [];
  return String(value)
    .split(/\r?\n|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  return /^(true|1|yes|sim|s)$/i.test(String(value || "").trim());
}

function isHttpUrl(value) {
  return /^https?:\/\/[^\s]+$/i.test(String(value || "").trim());
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

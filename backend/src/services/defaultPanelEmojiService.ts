import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import axios from "axios";
import yauzl from "yauzl";
import { getMongoCollections, type MongoDevBot } from "../database/mongo";
import { createLog } from "./logService";
import { getDevBotToken } from "./devBotService";
import { seedApplicationEmojisFromAssets, type ApplicationEmojiSeedAsset } from "./applicationEmojiService";

const DISCORD_API = "https://discord.com/api/v10";
const SYSTEM_USER_ID = "system:default-panel-emojis";

type DefaultEmojiAssetDefinition = {
  fileName: string;
  name: string;
};

const DEFAULT_PANEL_EMOJIS: DefaultEmojiAssetDefinition[] = [
  { fileName: "1467588900514955387.webp", name: "nuvem" },
  { fileName: "acessar.webp", name: "acessar" },
  { fileName: "alerta.webp", name: "alerta" },
  { fileName: "aniversario.webp", name: "aniversario" },
  { fileName: "caixa.webp", name: "caixa" },
  { fileName: "calendario.webp", name: "calendario" },
  { fileName: "chrancheta de acertos.webp", name: "prancheta_acertos" },
  { fileName: "dinheiro.webp", name: "dinheiro" },
  { fileName: "discord.webp", name: "discord" },
  { fileName: "esplamação.png", name: "exclamacao" },
  { fileName: "fantasma.webp", name: "fantasma" },
  { fileName: "folha.webp", name: "folha" },
  { fileName: "homem.webp", name: "homem" },
  { fileName: "ingrenagem.webp", name: "engrenagem" },
  { fileName: "interrogação.webp", name: "interrogacao" },
  { fileName: "liga.webp", name: "liga" },
  { fileName: "link.webp", name: "link" },
  { fileName: "perigo.webp", name: "perigo" },
  { fileName: "porta.webp", name: "porta" },
  { fileName: "prancheta caneta.webp", name: "prancheta_caneta" },
  { fileName: "prancheta.webp", name: "prancheta" },
  { fileName: "relogio.webp", name: "relogio" },
  { fileName: "robo.webp", name: "robo" },
  { fileName: "trofel.png", name: "trofeu" },
  { fileName: "trofel.webp", name: "trofeu_alt" },
  { fileName: "visto.webp", name: "visto" }
];

export async function seedDefaultPanelEmojisForAllBots() {
  const { devBots } = await getMongoCollections();
  const bots = await devBots.find({ status: { $ne: "invalid_token" } }).toArray();
  const results = [];

  for (const bot of bots) {
    results.push(await seedDefaultPanelEmojisForBot(bot._id));
  }

  return results;
}

export async function seedDefaultPanelEmojisForBot(botId: string) {
  const { devBots } = await getMongoCollections();
  const bot = await devBots.findOne({ _id: botId });
  if (!bot) return { application: null, botId, guilds: [], ok: false };
  return seedDefaultPanelEmojis(bot);
}

export function queueDefaultPanelEmojiSeed(botId: string) {
  setTimeout(() => {
    void seedDefaultPanelEmojisForBot(botId).catch((error) => {
      console.warn(`[default-panel-emojis] seed falhou para ${botId}: ${errorMessage(error)}`);
    });
  }, 5_000).unref();
}

async function seedDefaultPanelEmojis(bot: MongoDevBot) {
  const token = await getDevBotToken(bot._id);
  if (!token) return { application: null, botId: bot._id, guilds: [], ok: false };

  const assets = await loadDefaultPanelEmojiAssets();
  const application = await seedApplicationEmojisFromAssets({
    assets,
    botId: bot._id,
    userId: SYSTEM_USER_ID
  }).catch(async (error) => {
    await logSeedError(bot, "application", error);
    return null;
  });

  const guildIds = await defaultEmojiGuildIds(bot);
  const guilds = [];
  for (const guildId of guildIds) {
    guilds.push(await seedGuildEmojis(bot, token, guildId, assets));
  }

  return { application, botId: bot._id, guilds, ok: true };
}

async function loadDefaultPanelEmojiAssets(): Promise<ApplicationEmojiSeedAsset[]> {
  const root = defaultEmojiAssetsRoot();
  const folderAssets = DEFAULT_PANEL_EMOJIS.flatMap((definition) => {
    const filePath = path.join(root, definition.fileName);
    if (!existsSync(filePath)) return [];
    const buffer = readFileSync(filePath);
    return [{
      buffer,
      contentType: definition.fileName.toLowerCase().endsWith(".png") ? "image/png" : "image/webp",
      name: definition.name,
      originalEmojiId: `default-panel:${definition.name}:${sha256(buffer).slice(0, 12)}`
    }];
  });
  if (folderAssets.length) return folderAssets;

  const zipPath = defaultEmojiZipPath();
  if (!existsSync(zipPath)) return [];

  const files = await readZipFiles(zipPath);
  return DEFAULT_PANEL_EMOJIS.flatMap((definition) => {
    const buffer = files.get(definition.fileName);
    if (!buffer) return [];
    return [{
      buffer,
      contentType: definition.fileName.toLowerCase().endsWith(".png") ? "image/png" : "image/webp",
      name: definition.name,
      originalEmojiId: `default-panel:${definition.name}:${sha256(buffer).slice(0, 12)}`
    }];
  });
}

function defaultEmojiAssetsRoot() {
  return path.resolve(process.cwd(), "backend/assets/default-panel-emojis");
}

function defaultEmojiZipPath() {
  const packaged = path.resolve(process.cwd(), "backend/assets/default-panel-emojis.zip");
  if (existsSync(packaged)) return packaged;
  return path.resolve(process.cwd(), "emojis-paineis.zip");
}

function readZipFiles(zipPath: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const files = new Map<string, Buffer>();
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        reject(openError ?? new Error("ZIP de emojis invalido."));
        return;
      }
      zipFile.readEntry();
      zipFile.on("entry", (entry) => {
        if (/\/$/.test(entry.fileName)) {
          zipFile.readEntry();
          return;
        }
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            zipFile.close();
            reject(streamError ?? new Error(`Nao foi possivel ler ${entry.fileName}.`));
            return;
          }
          const chunks: Buffer[] = [];
          stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          stream.on("error", (error) => {
            zipFile.close();
            reject(error);
          });
          stream.on("end", () => {
            files.set(path.basename(entry.fileName), Buffer.concat(chunks));
            zipFile.readEntry();
          });
        });
      });
      zipFile.on("error", reject);
      zipFile.on("end", () => resolve(files));
    });
  });
}

async function defaultEmojiGuildIds(bot: MongoDevBot) {
  const { botGuildConfigs } = await getMongoCollections();
  const configured = await botGuildConfigs.distinct("guildId", { botId: bot._id });
  return [...new Set([bot.mainGuildId, ...configured].filter((value): value is string => Boolean(value)))];
}

async function seedGuildEmojis(bot: MongoDevBot, token: string, guildId: string, assets: ApplicationEmojiSeedAsset[]) {
  const result = { created: 0, failed: 0, guildId, skipped: 0 };
  try {
    const existing = await discordJson<Array<{ id: string; name: string }>>(`/guilds/${guildId}/emojis`, token);
    const existingNames = new Set(existing.map((emoji) => emoji.name.toLowerCase()));

    for (const asset of assets) {
      if (existingNames.has(asset.name.toLowerCase())) {
        result.skipped += 1;
        continue;
      }
      try {
        await discordJson(`/guilds/${guildId}/emojis`, token, {
          body: {
            image: `data:${asset.contentType};base64,${asset.buffer.toString("base64")}`,
            name: asset.name
          },
          method: "POST"
        });
        existingNames.add(asset.name.toLowerCase());
        result.created += 1;
        await wait(1_000);
      } catch (error) {
        result.failed += 1;
        await logSeedError(bot, guildId, error);
      }
    }
  } catch (error) {
    result.failed = assets.length;
    await logSeedError(bot, guildId, error);
  }
  return result;
}

async function discordJson<T>(apiPath: string, token: string, options: { body?: unknown; method?: "GET" | "POST" } = {}) {
  const response = await axios.request<T>({
    data: options.body,
    headers: { Authorization: `Bot ${token}` },
    method: options.method ?? "GET",
    url: `${DISCORD_API}${apiPath}`,
    validateStatus: () => true
  });
  if (response.status < 200 || response.status >= 300) {
    const message = typeof response.data === "object" && response.data && "message" in response.data
      ? String((response.data as { message?: unknown }).message)
      : `Discord API ${response.status}`;
    throw new Error(message);
  }
  return response.data;
}

async function logSeedError(bot: MongoDevBot, guildId: string, error: unknown) {
  await createLog({
    botId: bot._id,
    guildId,
    message: `Falha ao instalar emojis padrao: ${errorMessage(error)}`,
    metadata: { source: "default-panel-emojis" },
    type: "default_panel_emojis.seed_failed",
    userId: SYSTEM_USER_ID
  }).catch(() => null);
}

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

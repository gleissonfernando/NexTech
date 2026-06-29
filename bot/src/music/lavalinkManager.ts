import type { Client } from "discord.js";
import { Connectors, Shoukaku, type Node } from "shoukaku";
import { env } from "../config/env";

let lavalink: Shoukaku | null = null;

export function initializeLavalink(client: Client) {
  if (lavalink) return lavalink;
  if (!env.LAVALINK_URL || !env.LAVALINK_PASSWORD) {
    console.warn("[music:lavalink] desativado: configure LAVALINK_URL e LAVALINK_PASSWORD.");
    return null;
  }

  const url = new URL(env.LAVALINK_URL);
  const secure = url.protocol === "https:" || url.protocol === "wss:";
  const port = url.port || (secure ? "443" : "2333");
  lavalink = new Shoukaku(
    new Connectors.DiscordJS(client),
    [{ name: "main", url: `${url.hostname}:${port}${url.pathname === "/" ? "" : url.pathname}`, auth: env.LAVALINK_PASSWORD, secure }],
    {
      reconnectTries: 5,
      reconnectInterval: 5_000,
      restTimeout: 15_000,
      resume: true,
      resumeTimeout: 60,
      moveOnDisconnect: true
    }
  );

  lavalink.on("ready", (name) => console.log(`[music:lavalink] nó ${name} conectado.`));
  lavalink.on("error", (name, error) => console.error(`[music:lavalink] erro no nó ${name}:`, error.stack ?? error.message));
  lavalink.on("close", (name, code, reason) => console.warn(`[music:lavalink] nó ${name} fechou (${code}): ${reason || "sem motivo"}.`));
  lavalink.on("disconnect", (name, count) => console.warn(`[music:lavalink] nó ${name} desconectado; tentativa ${count}.`));
  return lavalink;
}

export function getLavalink() {
  if (!lavalink) {
    throw new Error("O servidor Lavalink não está configurado. Defina LAVALINK_URL e LAVALINK_PASSWORD.");
  }
  return lavalink;
}

export function getLavalinkNode(): Node {
  const node = getLavalink().getIdealNode();
  if (!node) throw new Error("Nenhum nó Lavalink está conectado no momento.");
  return node;
}

export function destroyLavalink() {
  if (!lavalink) return;
  for (const name of lavalink.nodes.keys()) lavalink.removeNode(name, "Bot encerrado");
  lavalink = null;
}

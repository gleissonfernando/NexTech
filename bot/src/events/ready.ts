import type { Client } from "discord.js";
import type { BotContext } from "../types";

export function handleReady(client: Client<true>, context: BotContext) {
  console.log(`[bot] conectado como ${client.user.tag}`);

  context.socket.connect(client);
  context.socket.emitStatus(client, true);

  const interval = setInterval(() => {
    context.socket.emitStatus(client, true);
  }, 30_000);

  interval.unref();
}

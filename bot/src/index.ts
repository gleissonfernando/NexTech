import {
  Client,
  GatewayIntentBits,
  Partials
} from "discord.js";
import { env } from "./config/env";
import { createCommandCollection } from "./commands";
import { registerEvents } from "./handlers/eventHandler";
import { ApiClient } from "./services/apiClient";
import type { BotContext } from "./types";
import { BotSocketClient } from "./websocket/socketClient";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.User]
});

const commands = createCommandCollection();
const context: BotContext = {
  api: new ApiClient(),
  client,
  commands,
  liveCache: new Set<string>(),
  socket: new BotSocketClient()
};

registerEvents(client, context);

if (!env.DISCORD_BOT_TOKEN) {
  console.error("[bot] DISCORD_BOT_TOKEN nao configurado.");
  process.exit(1);
}

process.on("SIGINT", () => {
  context.socket.disconnect(client);
  client.destroy();
  process.exit(0);
});

process.on("SIGTERM", () => {
  context.socket.disconnect(client);
  client.destroy();
  process.exit(0);
});

void client.login(env.DISCORD_BOT_TOKEN);

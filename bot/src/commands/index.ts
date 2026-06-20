import { Collection } from "discord.js";
import { banCommand } from "./ban";
import { clearCommand } from "./clear";
import { emojiClonerCommand } from "./emojiCloner";
import { gravarCommand } from "./gravar";
import { pingCommand } from "./ping";
import { serverClonerCommand } from "./serverCloner";
import { ticketCommand } from "./ticket";
import type { BotCommand } from "../types";

export function createCommandCollection() {
  const commands = new Collection<string, BotCommand>();

  [
    pingCommand,
    banCommand,
    clearCommand,
    emojiClonerCommand,
    gravarCommand,
    ticketCommand,
    serverClonerCommand
  ].forEach((command) => {
    if (commands.has(command.data.name)) {
      throw new Error(`Comando duplicado registrado: /${command.data.name}`);
    }

    commands.set(command.data.name, command);
  });

  return commands;
}

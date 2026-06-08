import { Collection } from "discord.js";
import { banCommand } from "./ban";
import { clearCommand } from "./clear";
import { pingCommand } from "./ping";
import { ticketCommand } from "./ticket";
import type { BotCommand } from "../types";

export function createCommandCollection() {
  const commands = new Collection<string, BotCommand>();

  [
    pingCommand,
    banCommand,
    clearCommand,
    ticketCommand
  ].forEach((command) => {
    commands.set(command.data.name, command);
  });

  return commands;
}

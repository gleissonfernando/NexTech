import type { Presence } from "discord.js";
import { handlePresenceUpdate } from "../services/liveService";
import type { BotContext } from "../types";

export async function handlePresenceEvent(oldPresence: Presence | null, newPresence: Presence, context: BotContext) {
  await handlePresenceUpdate(context, oldPresence, newPresence);
}

import { randomUUID } from "node:crypto";

export type LiveEventDto = {
  id: string;
  guildId: string;
  type: "started" | "ended";
  streamer: string;
  title?: string;
  url?: string;
  createdAt: string;
};

const liveEvents: LiveEventDto[] = [];

export function createLiveEvent(input: Omit<LiveEventDto, "id" | "createdAt">) {
  const event: LiveEventDto = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...input
  };

  liveEvents.unshift(event);
  return event;
}

export function listLiveEvents(guildId?: string) {
  return guildId ? liveEvents.filter((event) => event.guildId === guildId) : liveEvents.slice(0, 50);
}

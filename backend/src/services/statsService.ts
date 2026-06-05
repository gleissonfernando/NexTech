export type BotStatusDto = {
  online: boolean;
  latency: number;
  guilds: number;
  users: number;
  updatedAt: string;
};

let botStatus: BotStatusDto = {
  online: false,
  latency: 0,
  guilds: 0,
  users: 0,
  updatedAt: new Date().toISOString()
};

export function getBotStatus() {
  return botStatus;
}

export function updateBotStatus(input: Partial<Omit<BotStatusDto, "updatedAt">>) {
  botStatus = {
    ...botStatus,
    ...input,
    updatedAt: new Date().toISOString()
  };

  return botStatus;
}

export function createDashboardStats() {
  return {
    botStatus,
    activeLives: 0,
    ticketsOpen: 0,
    logsToday: 0,
    updatedAt: new Date().toISOString()
  };
}

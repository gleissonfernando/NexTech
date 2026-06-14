import { EventEmitter } from "node:events";
import axios from "axios";
import WebSocket, { type RawData } from "ws";

export type MissionState = "Waiting" | "Running" | "Completed" | "Error";

export type MissionStatusUpdate = {
  state: MissionState;
  currentMission?: string;
  currentIndex?: number;
  totalMissions?: number;
  progress?: number;
  detail?: string;
};

export type MissionStatusReporter = (update: MissionStatusUpdate, force?: boolean) => void | Promise<void>;

export type MissionJob = {
  userId: string;
  run: (signal: AbortSignal) => Promise<void>;
  onQueued: (position: number) => void | Promise<void>;
  onRejected: (reason: string) => void | Promise<void>;
  onCancelled?: (reason: string) => void | Promise<void>;
  onFailed?: (reason: string) => void | Promise<void>;
  controller?: AbortController;
};

export type DiscordGuildOption = {
  id: string;
  name: string;
};

export type DiscordVoiceChannelOption = {
  id: string;
  guildId: string;
  name: string;
};

export type VoiceRuntimeStatus = "connected" | "disconnected" | "reconnecting";

export type VoiceSessionUpdate = {
  status: VoiceRuntimeStatus;
  connectedAt?: string;
};

export type RichPresenceRuntimeConfig = {
  applicationId?: string;
  activityType?: 0 | 1 | 2 | 3 | 5;
  name?: string;
  description?: string;
  state?: string;
  details?: string;
  buttonLabel?: string;
  buttonUrl?: string;
  largeImage?: string;
  largeText?: string;
  smallImage?: string;
  smallText?: string;
  startTimestamp?: string;
};

export type CheckerStats = {
  hits: number;
  taken: number;
  errors: number;
  deadProxies: number;
  activeProxies: number;
  bannedProxies: number;
  workersRunning: number;
};

export type CheckerOptions = {
  usernameLength?: number;
  concurrency?: number;
  requestDelay?: number;
};

type DiscordTokenValidation = {
  valid: boolean;
  userId?: string;
};

type DiscordUser = {
  id: string;
  username?: string;
};

type DiscordGuild = {
  id: string;
  name: string;
};

type DiscordChannel = {
  id: string;
  guild_id?: string;
  name?: string;
  type: number;
};

type GatewayPayload<T = unknown> = {
  op: number;
  t?: string;
  d: T;
};

type GatewayHello = {
  heartbeat_interval: number;
};

type DmChannel = {
  id: string;
  owner_id?: string;
  recipient_ids?: string[];
  type: number;
  user_id?: string;
};

type DmMessage = {
  id: string;
  channel_id: string;
  author: {
    id: string;
  };
};

type Relationship = {
  user_id: string;
};

type ReadyData = {
  private_channels: DmChannel[];
  relationships: Relationship[];
};

const API_BASE_URL = "https://discord.com/api/v10";
const GATEWAY_URL = "wss://gateway.discord.gg/?encoding=json&v=10";
const DEFAULT_HTTP_TIMEOUT_MS = 30_000;
const MESSAGE_FETCH_LIMIT = 100;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const SUPER_PROPERTIES = Buffer.from(JSON.stringify({
  browser: "Chrome",
  browser_user_agent: USER_AGENT,
  browser_version: "138.0.0.0",
  client_build_number: 9999,
  client_event_source: null,
  design_id: 0,
  device: "",
  os: "Windows",
  os_version: "10"
})).toString("base64");

function discordHeaders(token: string) {
  return {
    "Accept-Language": "en-US",
    Authorization: token,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    origin: "https://discord.com",
    referer: "https://discord.com/channels/@me",
    "x-debug-options": "bugReporterEnabled",
    "x-discord-locale": "en-US",
    "x-discord-timezone": "America/Sao_Paulo",
    "x-super-properties": SUPER_PROPERTIES
  };
}

async function discordRequest<T>(token: string, method: "GET" | "POST" | "DELETE", path: string, body?: unknown) {
  const response = await axios.request<T>({
    baseURL: API_BASE_URL,
    data: body,
    headers: discordHeaders(token),
    method,
    timeout: DEFAULT_HTTP_TIMEOUT_MS,
    url: path,
    validateStatus: () => true
  });

  return {
    body: response.data,
    status: response.status
  };
}

function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;

  if (reason instanceof Error) {
    return reason;
  }

  return new Error(typeof reason === "string" && reason ? reason : "Operacao cancelada.");
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw abortError(signal);
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  throwIfAborted(signal);

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(abortError(signal));
      },
      { once: true }
    );
  });
}

function defaultPresence(activities: unknown[] = []) {
  return {
    activities,
    afk: false,
    since: 0,
    status: "online"
  };
}

function gatewayIdentifyPayload(token: string, activities: unknown[] = []): GatewayPayload {
  return {
    d: {
      capabilities: 1021,
      client_state: {
        guild_versions: {},
        highest_last_message_id: "0",
        private_channels_version: "0",
        read_state_version: 0,
        user_guild_settings_version: -1,
        user_settings_version: -1
      },
      compress: false,
      presence: defaultPresence(activities),
      properties: {
        browser: "Chrome",
        browser_user_agent: USER_AGENT,
        browser_version: "138.0.0.0",
        device: "",
        is_fast_connect: false,
        os: "Windows"
      },
      token
    },
    op: 2
  };
}

export async function validateDiscordToken(token: string): Promise<DiscordTokenValidation> {
  const { body, status } = await discordRequest<DiscordUser>(token, "GET", "/users/@me");

  return status === 200 && body?.id
    ? {
        userId: body.id,
        valid: true
      }
    : {
        valid: false
      };
}

export async function fetchDiscordGuildOptions(token: string): Promise<DiscordGuildOption[]> {
  const { body, status } = await discordRequest<DiscordGuild[]>(token, "GET", "/users/@me/guilds");

  if (status !== 200 || !Array.isArray(body)) {
    return [];
  }

  return body.map((guild) => ({
    id: guild.id,
    name: guild.name
  }));
}

export async function fetchDiscordVoiceChannelOptions(token: string, guildId: string): Promise<DiscordVoiceChannelOption[]> {
  const { body, status } = await discordRequest<DiscordChannel[]>(token, "GET", `/guilds/${guildId}/channels`);

  if (status !== 200 || !Array.isArray(body)) {
    return [];
  }

  return body
    .filter((channel) => channel.type === 2 || channel.type === 13)
    .map((channel) => ({
      guildId,
      id: channel.id,
      name: channel.name ?? channel.id
    }));
}

export class MissionQueue {
  private queue: MissionJob[] = [];
  private running: MissionJob | null = null;

  enqueue(job: MissionJob) {
    if (this.hasJobForUser(job.userId)) {
      void job.onRejected("Voce ja tem uma operacao na fila ou em andamento.");
      return false;
    }

    this.queue.push(job);
    this.runCallback(job.onQueued, this.running ? this.queue.length : 1);
    this.scheduleDrain();
    return true;
  }

  cancelUser(userId: string, reason: string) {
    if (this.running?.userId === userId) {
      this.running.controller?.abort(reason);
      if (this.running.onCancelled) {
        this.runCallback(this.running.onCancelled, reason);
      }
      return true;
    }

    const queuedIndex = this.queue.findIndex((job) => job.userId === userId);
    if (queuedIndex === -1) {
      return false;
    }

    const [job] = this.queue.splice(queuedIndex, 1);
    if (job?.onCancelled) {
      this.runCallback(job.onCancelled, reason);
    }
    return true;
  }

  private hasJobForUser(userId: string) {
    return this.running?.userId === userId || this.queue.some((job) => job.userId === userId);
  }

  private async drain() {
    if (this.running) {
      return;
    }

    const job = this.queue.shift();
    if (!job) {
      return;
    }

    this.running = job;
    job.controller = new AbortController();
    try {
      await job.run(job.controller.signal);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await (job.onFailed ?? job.onRejected)(reason);
    } finally {
      this.running = null;
      this.scheduleDrain();
    }
  }

  private scheduleDrain() {
    void this.drain().catch((error) => {
      console.error("[mission-tools] mission queue drain failed:", error);
    });
  }

  private runCallback<T>(callback: (value: T) => void | Promise<void>, value: T) {
    void Promise.resolve(callback(value)).catch((error) => {
      console.error("[mission-tools] mission queue callback failed:", error);
    });
  }
}

function questName(quest: any) {
  return quest?.config?.messages?.quest_name?.trim()
    || quest?.config?.messages?.game_title?.trim()
    || quest?.id
    || "Missao";
}

function questReward(quest: any) {
  const reward = quest?.config?.rewards_config?.rewards?.[0];
  return reward?.messages?.name ?? (reward?.orb_quantity ? `${reward.orb_quantity} Orbs` : "Recompensa desconhecida");
}

function questTasks(quest: any) {
  return quest?.config?.task_config?.tasks ?? quest?.config?.task_config_v2?.tasks ?? {};
}

function supportedQuestTask(quest: any) {
  const tasks = questTasks(quest);
  const names = ["WATCH_VIDEO", "WATCH_VIDEO_ON_MOBILE", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY"];

  for (const name of names) {
    if (tasks[name]) {
      return {
        name,
        task: tasks[name]
      };
    }
  }

  return null;
}

function questCompleted(quest: any) {
  return Boolean(quest?.user_status?.completed_at);
}

function questExpired(quest: any) {
  const expiresAt = new Date(quest?.config?.expires_at ?? 0).getTime();
  return Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() > expiresAt;
}

function questProgress(quest: any, taskName: string) {
  return Number(quest?.user_status?.progress?.[taskName]?.value ?? 0);
}

function toProgress(secondsDone: number, secondsNeeded: number) {
  if (!secondsNeeded || secondsNeeded <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round((secondsDone / secondsNeeded) * 100)));
}

export async function runMissionFlow(token: string, reportStatus: MissionStatusReporter, signal?: AbortSignal) {
  throwIfAborted(signal);
  await reportStatus({
    detail: "Buscando missoes disponiveis.",
    state: "Waiting"
  });

  const { body, status } = await discordRequest<{ quests?: any[] }>(token, "GET", "/quests/@me");
  if (status !== 200 || !Array.isArray(body?.quests)) {
    throw new Error("Discord nao retornou a lista de missoes. Verifique o token.");
  }

  const quests = body.quests.filter((quest) => quest.id !== "1412491570820812933" && !questCompleted(quest) && !questExpired(quest));

  if (!quests.length) {
    await reportStatus(
      {
        detail: "Nenhuma missao valida foi encontrada.",
        progress: 100,
        state: "Completed",
        totalMissions: 0
      },
      true
    );
    return;
  }

  let completed = 0;
  let failed = 0;

  for (const [index, quest] of quests.entries()) {
    throwIfAborted(signal);
    const currentIndex = index + 1;
    const name = questName(quest);
    const supported = supportedQuestTask(quest);

    await reportStatus({
      currentIndex,
      currentMission: name,
      detail: `Recompensa: ${questReward(quest)}`,
      progress: 0,
      state: "Running",
      totalMissions: quests.length
    });

    try {
      if (!supported) {
        throw new Error(`Missao "${name}" nao tem tarefa suportada.`);
      }

      if (!quest?.user_status?.enrolled_at) {
        const enroll = await discordRequest<any>(token, "POST", `/quests/${quest.id}/enroll`, {
          is_targeted: false,
          location: 11,
          metadata_raw: null
        });

        if (enroll.status < 200 || enroll.status >= 300) {
          throw new Error(`Nao foi possivel entrar na missao "${name}" (HTTP ${enroll.status}).`);
        }

        quest.user_status = enroll.body?.user_status ?? enroll.body ?? quest.user_status;
      }

      await runQuestTask(token, quest, supported.name, supported.task, reportStatus, currentIndex, quests.length, signal);
      completed += 1;
      await reportStatus(
        {
          currentIndex,
          currentMission: name,
          detail: `Concluidas ${completed} de ${quests.length} missoes.`,
          progress: 100,
          state: "Completed",
          totalMissions: quests.length
        },
        true
      );
    } catch (error) {
      if (signal?.aborted) {
        throw abortError(signal);
      }

      failed += 1;
      await reportStatus(
        {
          currentIndex,
          currentMission: name,
          detail: error instanceof Error ? error.message : String(error),
          progress: 0,
          state: "Error",
          totalMissions: quests.length
        },
        true
      );
    }
  }

  await reportStatus(
    {
      detail: failed > 0
        ? `Finalizado com ${completed} concluidas e ${failed} com erro.`
        : `Todas as ${completed} missoes foram concluidas.`,
      progress: 100,
      state: failed > 0 ? "Error" : "Completed",
      totalMissions: quests.length
    },
    true
  );
}

async function runQuestTask(
  token: string,
  quest: any,
  taskName: string,
  task: any,
  reportStatus: MissionStatusReporter,
  currentIndex: number,
  totalMissions: number,
  signal?: AbortSignal
) {
  const name = questName(quest);
  const secondsNeeded = Number(task?.target ?? 0);

  if (!Number.isFinite(secondsNeeded) || secondsNeeded <= 0) {
    throw new Error(`Missao "${name}" tem tempo alvo invalido.`);
  }

  if (taskName === "WATCH_VIDEO" || taskName === "WATCH_VIDEO_ON_MOBILE") {
    let secondsDone = questProgress(quest, taskName);
    const enrolledAt = new Date(quest?.user_status?.enrolled_at ?? Date.now()).getTime();
    const safeEnrolledAt = Number.isFinite(enrolledAt) ? enrolledAt : Date.now();

    while (secondsDone < secondsNeeded) {
      throwIfAborted(signal);
      const maxAllowed = Math.floor((Date.now() - safeEnrolledAt) / 1000) + 10;
      const nextTimestamp = Math.min(secondsNeeded, secondsDone + 7);

      if (maxAllowed >= nextTimestamp) {
        const progress = await discordRequest<any>(token, "POST", `/quests/${quest.id}/video-progress`, {
          timestamp: nextTimestamp + Math.random()
        });

        if (progress.status < 200 || progress.status >= 300) {
          throw new Error(`Progresso de video falhou (HTTP ${progress.status}).`);
        }

        secondsDone = nextTimestamp;
        await reportStatus({
          currentIndex,
          currentMission: name,
          detail: `Progresso de video para ${name}.`,
          progress: toProgress(secondsDone, secondsNeeded),
          state: "Running",
          totalMissions
        });
      }

      if (secondsDone < secondsNeeded) {
        await sleep(1000, signal);
      }
    }

    return;
  }

  if (taskName === "PLAY_ON_DESKTOP") {
    const applicationId = quest?.config?.application?.id;
    if (!applicationId) {
      throw new Error(`Missao "${name}" sem application id.`);
    }

    let secondsDone = questProgress(quest, taskName);
    while (secondsDone < secondsNeeded) {
      throwIfAborted(signal);
      const heartbeat = await discordRequest<any>(token, "POST", `/quests/${quest.id}/heartbeat`, {
        application_id: applicationId,
        terminal: false
      });

      if (heartbeat.status < 200 || heartbeat.status >= 300) {
        throw new Error(`Heartbeat da missao falhou (HTTP ${heartbeat.status}).`);
      }

      quest.user_status = heartbeat.body?.user_status ?? heartbeat.body ?? quest.user_status;
      secondsDone = Math.max(secondsDone, questProgress(quest, taskName));
      await reportStatus({
        currentIndex,
        currentMission: name,
        detail: `Atualizando progresso de ${quest?.config?.application?.name ?? "app"}.`,
        progress: toProgress(secondsDone, secondsNeeded),
        state: "Running",
        totalMissions
      });
      await sleep(60_000, signal);
    }

    await discordRequest(token, "POST", `/quests/${quest.id}/heartbeat`, {
      application_id: applicationId,
      terminal: true
    });
    return;
  }

  throw new Error(`Tipo de missao "${taskName}" nao suportado em Node.`);
}

export async function runDiscordDmCleanup(options: {
  token: string;
  targetUserId?: string | null;
  signal?: AbortSignal;
}) {
  const cleaner = new DiscordDmCleaner(options.token, options.targetUserId ?? null, options.signal);
  await cleaner.run();
}

class DiscordDmCleaner {
  private currentUserId: string | null = null;

  constructor(
    private readonly token: string,
    private readonly targetUserId: string | null,
    private readonly signal?: AbortSignal
  ) {}

  async run() {
    throwIfAborted(this.signal);
    const validation = await validateDiscordToken(this.token);
    if (!validation.valid || !validation.userId) {
      throw new Error("Token invalido.");
    }

    this.currentUserId = validation.userId;
    const ready = await this.fetchReadyData();

    if (this.targetUserId) {
      await this.cleanupTargetUserDm(ready, this.targetUserId);
      return;
    }

    for (const dm of ready.private_channels) {
      throwIfAborted(this.signal);
      if (dm.type !== 1 && dm.type !== 3) {
        continue;
      }

      const userId = dm.user_id ?? dm.recipient_ids?.[0] ?? dm.owner_id;
      if (!userId) {
        continue;
      }

      const messages = await this.fetchAllMessages(dm.id);
      await this.deleteOwnMessages(messages);
      await this.deleteRelationship(userId);
      await this.closeChannel(dm.id, dm.type === 3);
    }

    for (const relationship of ready.relationships) {
      throwIfAborted(this.signal);
      await this.deleteRelationship(relationship.user_id);
      await sleep(100, this.signal);
    }
  }

  private fetchReadyData() {
    return new Promise<ReadyData>((resolve, reject) => {
      let settled = false;
      let heartbeatTimer: NodeJS.Timeout | null = null;
      let readyTimeout: NodeJS.Timeout | null = null;
      const socket = new WebSocket(GATEWAY_URL);

      const finish = (callback: () => void) => {
        if (settled) {
          return;
        }

        settled = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (readyTimeout) clearTimeout(readyTimeout);
        callback();
      };

      readyTimeout = setTimeout(() => {
        finish(() => reject(new Error("Gateway timed out before READY.")));
        socket.close();
      }, DEFAULT_HTTP_TIMEOUT_MS);

      socket.on("message", (rawData: RawData) => {
        let payload: GatewayPayload<ReadyData | GatewayHello>;
        try {
          payload = JSON.parse(rawData.toString()) as GatewayPayload<ReadyData | GatewayHello>;
        } catch (error) {
          finish(() => reject(error));
          socket.close();
          return;
        }

        if (payload.op === 10) {
          const interval = (payload.d as GatewayHello).heartbeat_interval;
          heartbeatTimer = setInterval(() => socket.send(JSON.stringify({ d: null, op: 1 })), interval);
          socket.send(JSON.stringify(gatewayIdentifyPayload(this.token)));
          return;
        }

        if (payload.op === 0 && payload.t === "READY") {
          finish(() => {
            socket.close();
            resolve(payload.d as ReadyData);
          });
        }
      });

      socket.on("error", (error) => finish(() => reject(error)));
      socket.on("close", () => finish(() => reject(new Error("Gateway closed before READY."))));
    });
  }

  private async cleanupTargetUserDm(ready: ReadyData, targetUserId: string) {
    const dm = ready.private_channels.find((channel) => channel.type === 1 && (channel.user_id === targetUserId || channel.recipient_ids?.includes(targetUserId)));

    if (!dm) {
      await this.deleteRelationship(targetUserId);
      return;
    }

    const messages = await this.fetchAllMessages(dm.id);
    await this.deleteOwnMessages(messages);
    await this.deleteRelationship(targetUserId);
    await this.closeChannel(dm.id, false);
  }

  private async fetchAllMessages(channelId: string) {
    const messages: DmMessage[] = [];
    let before: string | undefined;
    let lastPageSize = MESSAGE_FETCH_LIMIT;

    while (lastPageSize === MESSAGE_FETCH_LIMIT) {
      const params = new URLSearchParams({
        limit: String(MESSAGE_FETCH_LIMIT)
      });
      if (before) {
        params.set("before", before);
      }

      const { body, status } = await discordRequest<DmMessage[]>(this.token, "GET", `/channels/${channelId}/messages?${params.toString()}`);
      const page = status === 200 && Array.isArray(body) ? body : [];
      lastPageSize = page.length;
      messages.push(...page);
      before = page.at(-1)?.id;
      if (!before) {
        break;
      }
      await sleep(75, this.signal);
    }

    return messages;
  }

  private async deleteOwnMessages(messages: DmMessage[]) {
    if (!this.currentUserId) {
      throw new Error("Usuario atual nao carregado.");
    }

    for (const message of messages) {
      throwIfAborted(this.signal);
      if (message.author.id !== this.currentUserId) {
        continue;
      }

      await discordRequest(this.token, "DELETE", `/channels/${message.channel_id}/messages/${message.id}`);
      await sleep(750, this.signal);
    }
  }

  private async deleteRelationship(userId: string) {
    await discordRequest(this.token, "DELETE", `/users/@me/relationships/${userId}`);
  }

  private async closeChannel(channelId: string, group: boolean) {
    await discordRequest(this.token, "DELETE", group ? `/channels/${channelId}?silent=true` : `/channels/${channelId}`);
  }
}

export class DiscordVoiceSession {
  private socket: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private desiredActive = false;
  private guildId: string | null = null;
  private channelId: string | null = null;
  private connectedAt: string | undefined;

  constructor(
    private readonly token: string,
    private readonly onStatusChange: (update: VoiceSessionUpdate) => void
  ) {}

  start(guildId: string, channelId: string) {
    this.guildId = guildId;
    this.channelId = channelId;
    this.desiredActive = true;
    this.clearReconnectTimer();
    this.connect();
  }

  changeChannel(guildId: string, channelId: string) {
    this.guildId = guildId;
    this.channelId = channelId;
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.sendVoiceState(channelId);
      return;
    }

    this.start(guildId, channelId);
  }

  stop() {
    this.desiredActive = false;
    this.clearReconnectTimer();
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.sendVoiceState(null);
    }
    this.closeSocket();
    this.connectedAt = undefined;
    this.onStatusChange({
      connectedAt: undefined,
      status: "disconnected"
    });
  }

  private connect() {
    if (!this.guildId || !this.channelId) {
      return;
    }

    this.closeSocket();
    this.onStatusChange({
      connectedAt: this.connectedAt,
      status: "reconnecting"
    });

    const socket = new WebSocket(GATEWAY_URL);
    this.socket = socket;

    socket.on("message", (rawData: RawData) => {
      let payload: GatewayPayload;
      try {
        payload = JSON.parse(rawData.toString()) as GatewayPayload;
      } catch {
        return;
      }

      if (payload.op === 10) {
        this.startHeartbeat((payload.d as GatewayHello).heartbeat_interval);
        this.send(gatewayIdentifyPayload(this.token));
        return;
      }

      if (payload.op === 0 && payload.t === "READY") {
        this.reconnectAttempt = 0;
        this.sendVoiceState(this.channelId);
        this.connectedAt ??= new Date().toISOString();
        this.onStatusChange({
          connectedAt: this.connectedAt,
          status: "connected"
        });
        return;
      }

      if (payload.op === 7) {
        socket.close();
      }
    });

    socket.on("close", () => {
      this.clearHeartbeat();
      if (this.socket === socket) {
        this.socket = null;
      }
      if (this.desiredActive) {
        this.scheduleReconnect();
      }
    });

    socket.on("error", () => socket.close());
  }

  private sendVoiceState(channelId: string | null) {
    if (!this.guildId) {
      return;
    }

    this.send({
      d: {
        channel_id: channelId,
        guild_id: this.guildId,
        self_deaf: false,
        self_mute: false,
        self_video: false
      },
      op: 4
    });
  }

  private scheduleReconnect() {
    this.onStatusChange({
      connectedAt: this.connectedAt,
      status: "reconnecting"
    });
    this.clearReconnectTimer();
    const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private send(payload: GatewayPayload) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  private startHeartbeat(interval: number) {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => this.send({ d: null, op: 1 }), interval);
    this.send({ d: null, op: 1 });
  }

  private closeSocket() {
    this.clearHeartbeat();
    if (this.socket) {
      this.socket.removeAllListeners();
      if (this.socket.readyState === WebSocket.OPEN) {
        this.socket.close();
      }
      this.socket = null;
    }
  }

  private clearHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}

function isSupportedStreamingUrl(value?: string) {
  if (!value) {
    return false;
  }

  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "twitch.tv" || hostname.endsWith(".twitch.tv") || hostname === "youtube.com" || hostname.endsWith(".youtube.com") || hostname === "youtu.be";
  } catch {
    return false;
  }
}

function richPresenceActivity(config: RichPresenceRuntimeConfig) {
  const activityType = config.activityType === 1 && !isSupportedStreamingUrl(config.buttonUrl) ? 0 : config.activityType ?? 0;
  const startTimestamp = config.startTimestamp ? new Date(config.startTimestamp).getTime() : undefined;
  const activity: Record<string, unknown> = {
    created_at: Date.now(),
    name: config.name || "Custom Activity",
    type: activityType
  };

  if (config.applicationId) activity.application_id = config.applicationId;
  if (activityType === 1 && config.buttonUrl) activity.url = config.buttonUrl;
  if (config.description) activity.description = config.description;
  if (config.details) activity.details = config.details;
  if (config.state) activity.state = config.state;
  if (startTimestamp && Number.isFinite(startTimestamp)) activity.timestamps = { start: startTimestamp };
  if (config.largeImage || config.smallImage) {
    activity.assets = {
      ...(config.largeImage ? { large_image: config.largeImage } : {}),
      ...(config.largeText ? { large_text: config.largeText } : {}),
      ...(config.smallImage ? { small_image: config.smallImage } : {}),
      ...(config.smallText ? { small_text: config.smallText } : {})
    };
  }
  if (config.buttonLabel && config.buttonUrl) {
    activity.buttons = [{ label: config.buttonLabel, url: config.buttonUrl }];
  }

  return activity;
}

export class DiscordRichPresenceSession {
  private socket: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private config: RichPresenceRuntimeConfig = {};
  private active = false;
  private reconnectAttempt = 0;

  constructor(
    private readonly token: string,
    private readonly onStatusChange: (status: "active" | "inactive") => void
  ) {}

  start(config: RichPresenceRuntimeConfig) {
    this.active = true;
    this.config = config;
    this.connect();
  }

  update(config: RichPresenceRuntimeConfig) {
    this.config = config;
    if (!this.active || !this.socket) {
      this.start(config);
      return;
    }
    this.sendPresence();
  }

  stop() {
    this.active = false;
    this.clearReconnectTimer();
    this.send({
      d: defaultPresence([]),
      op: 3
    });
    this.closeSocket();
    this.onStatusChange("inactive");
  }

  private connect() {
    this.clearReconnectTimer();
    this.closeSocket();
    const socket = new WebSocket(GATEWAY_URL);
    this.socket = socket;

    socket.on("message", (rawData: RawData) => {
      let payload: GatewayPayload;
      try {
        payload = JSON.parse(rawData.toString()) as GatewayPayload;
      } catch {
        return;
      }

      if (payload.op === 10) {
        this.startHeartbeat((payload.d as GatewayHello).heartbeat_interval);
        this.send(gatewayIdentifyPayload(this.token, [richPresenceActivity(this.config)]));
        return;
      }

      if (payload.op === 0 && payload.t === "READY") {
        this.reconnectAttempt = 0;
        this.sendPresence();
        this.onStatusChange("active");
        return;
      }

      if (payload.op === 7 && this.active) {
        socket.close();
      }
    });

    socket.on("close", () => {
      this.clearHeartbeat();
      if (this.socket === socket) {
        this.socket = null;
      }
      if (this.active) {
        this.scheduleReconnect();
      }
    });

    socket.on("error", () => socket.close());
  }

  private sendPresence() {
    this.send({
      d: defaultPresence([richPresenceActivity(this.config)]),
      op: 3
    });
    this.onStatusChange("active");
  }

  private send(payload: GatewayPayload) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  private startHeartbeat(interval: number) {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => this.send({ d: null, op: 1 }), interval);
    this.send({ d: null, op: 1 });
  }

  private closeSocket() {
    this.clearHeartbeat();
    if (this.socket) {
      this.socket.removeAllListeners();
      if (this.socket.readyState === WebSocket.OPEN) {
        this.socket.close();
      }
      this.socket = null;
    }
  }

  private clearHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private scheduleReconnect() {
    this.clearReconnectTimer();
    const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      if (this.active) this.connect();
    }, delay);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}

export class DiscordUsernameChecker extends EventEmitter {
  private isRunning = false;
  private isStopping = false;
  private stats: CheckerStats = {
    activeProxies: 0,
    bannedProxies: 0,
    deadProxies: 0,
    errors: 0,
    hits: 0,
    taken: 0,
    workersRunning: 0
  };

  async start(options: CheckerOptions = {}) {
    if (this.isRunning) {
      throw new Error("Checker ja esta rodando.");
    }

    this.isRunning = true;
    this.isStopping = false;
    this.stats = {
      activeProxies: 0,
      bannedProxies: 0,
      deadProxies: 0,
      errors: 0,
      hits: 0,
      taken: 0,
      workersRunning: 1
    };
    this.emit("stats", this.getStats());

    const usernameLength = Math.max(2, Math.min(options.usernameLength ?? 4, 20));
    const requestDelay = Math.max(1500, options.requestDelay ?? 2000);

    try {
      while (!this.isStopping) {
        const username = randomUsername(usernameLength);
        await this.checkUsername(username);
        await sleep(requestDelay);
      }
      this.emit("stopped");
    } finally {
      this.stats.workersRunning = 0;
      this.isRunning = false;
      this.emit("stats", this.getStats());
    }
  }

  async stop() {
    this.isStopping = true;
  }

  getStats() {
    return { ...this.stats };
  }

  private async checkUsername(username: string) {
    try {
      const response = await axios.post(
        "https://discord.com/api/v9/unique-username/username-attempt-unauthed",
        { username },
        {
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "Auto-Quest-Discord/1.0"
          },
          timeout: 10_000,
          validateStatus: () => true
        }
      );

      if (response.status === 429) {
        this.stats.errors += 1;
        this.emit("error", {
          message: "Rate limit do Discord. Checker pausado.",
          username,
          workerId: 1
        });
        this.isStopping = true;
        return;
      }

      if (response.status < 200 || response.status >= 300) {
        this.stats.errors += 1;
        this.emit("error", {
          message: `HTTP ${response.status}`,
          username,
          workerId: 1
        });
        return;
      }

      if (response.data?.taken) {
        this.stats.taken += 1;
        this.emit("taken", username);
      } else {
        this.stats.hits += 1;
        this.emit("hit", username);
      }
      this.emit("stats", this.getStats());
    } catch (error) {
      this.stats.errors += 1;
      this.emit("error", {
        message: error instanceof Error ? error.message : String(error),
        username,
        workerId: 1
      });
    }
  }
}

function randomUsername(length: number) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789._";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)] ?? "a").join("");
}

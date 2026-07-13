import type { Client } from "discord.js";
import { io, type Socket } from "socket.io-client";
import { currentRuntimeBotId, env } from "../config/env";
import type { GuildSettings } from "../types";
import type { FivemOrder } from "../services/apiClient";

export type SocialPanelUpdateEvent = {
  action: "publish" | "remove" | "update";
  botId?: string | null;
  guildId: string;
  panelId: string;
};

export type XMonitorUpdateEvent = {
  action: string;
  botId?: string | null;
  guildId: string;
  account?: {
    id: string;
  };
};

export type XMonitorPostEvent = {
  account: {
    id: string;
    botId: string | null;
    guildId: string;
    channelId: string;
    xUserId: string;
    username: string;
    displayName: string;
    avatar: string | null;
    active: boolean;
    lastSyncAt: string | null;
    lastPostId: string | null;
    lastPostAt: string | null;
    lastApiStatus: "idle" | "ok" | "error";
    lastApiError: string | null;
    totalPostsSent: number;
    createdAt: string;
    updatedAt: string;
  };
  botId?: string | null;
  guildId: string;
  post: {
    id: string;
    text: string;
    createdAt: string;
    url: string;
    mediaUrls: string[];
  };
};

export type FivemFacSettingsEvent = {
  botId?: string | null;
  guildId: string;
  settings?: unknown;
};

export type FivemFacPanelPublishEvent = {
  botId?: string | null;
  guildId: string;
  settings?: unknown;
};

export type FivemGoalPanelPublishEvent = {
  botId?: string | null;
  guildId: string;
  settings?: unknown;
};
export type FivemFinancePanelPublishEvent = { botId?: string | null; guildId: string };
export type FivemOrderPanelPublishEvent = { botId?: string | null; guildId: string };
export type FivemOrderStatusUpdatedEvent = { actorId?: string | null; botId?: string | null; guildId: string; order: FivemOrder };
export type PriceTablePanelPublishEvent = { botId?: string | null; guildId: string; tableId: string };
export type ManualPaymentPanelPublishEvent = { botId?: string | null; guildId: string };
export type CoursePanelPublishEvent = { botId?: string | null; guildId: string; settings?: unknown };
export type RhAdminPanelPublishEvent = { botId?: string | null; guildId: string; settings?: unknown };
export type TicketPanelPublishEvent = { botId?: string | null; guildId: string; settings?: unknown };

export type NexTechSalePaidEvent = {
  amountCents: number;
  botId?: string | null;
  buyerId: string;
  buyerName?: string | null;
  currency: "BRL" | "USD" | "EUR";
  customerRoleId?: string | null;
  guildId: string;
  logChannelId?: string | null;
  planName: string;
  productName?: string | null;
  productPlanType?: string | null;
  purchasedRoleId?: string | null;
  saleChannelId?: string | null;
  saleId: string;
};

export type ManualRegistrationPanelPublishEvent = {
  botId?: string | null;
  guildId: string;
};
export type ManualRegistrationExecuteEvent = {
  botId: string;
  goalCategoryId: string;
  guildId: string;
  requestedRoleId: string;
  submissionId: string;
  userId: string;
  username: string;
};
export type ManualRegistrationRemoveEvent = { botId: string; guildId: string; roleId: string | null; submissionId: string; userId: string };

export type DatabaseMaintenanceDeleteChannelsEvent = {
  botId?: string | null;
  channelIds: string[];
  guildId: string;
  reason: string;
  userId?: string | null;
};

export type FivemHierarchyPanelUpdateEvent = {
  action?: "delete" | "publish" | "unpublish" | "update";
  botId?: string | null;
  guildId: string;
  oldPanelChannelId?: string | null;
  oldPanelMessageId?: string | null;
  panelId?: string | null;
};
export type FivemHierarchyPanelUpdateAck = (response: { error?: string; messageId?: string | null; ok: boolean; panelId?: string }) => void;

export type FivemFacAbsenceUpdateEvent = {
  absence?: unknown;
  action: string;
  botId?: string | null;
  guildId: string;
};

export type PoliceHiddenChannelSettingsEvent = {
  botId?: string | null;
  guildId: string;
};
export type DmBarSettingsEvent = {
  botId?: string | null;
  guildId: string;
};

export type MissionToolsSettingsEvent = {
  botId?: string | null;
  guildId: string;
  settings?: unknown;
};

export type MissionToolsPanelPublishEvent = {
  botId?: string | null;
  guildId: string;
  settings?: unknown;
};

export type MissionToolsUserUpdateEvent = {
  botId?: string | null;
  guildId: string;
  user?: unknown;
};

export type GiveawayPanelUpdateEvent = {
  action: "publish" | "update";
  botId?: string | null;
  giveawayId: string;
  guildId: string;
};

export type ImageAntiSpamSettingsEvent = {
  botId?: string | null;
  guildId: string;
};

export type SelfBotProtectionSettingsEvent = {
  botId?: string | null;
  guildId: string;
};

export type SelfBotEnsureSetupEvent = {
  botId?: string | null;
  guildId?: string | null;
};

export type SelfBotEnsureSetupAck = (response: { error?: string; ok: boolean }) => void;

export type SettingsUpdatedEvent = GuildSettings;

export type DiscordLogDispatchEvent = {
  id: string;
  botId: string | null;
  guildId: string;
  userId?: string | null;
  type: string;
  message: string;
  metadata?: unknown;
  createdAt: string;
};

export type DevModuleUpdatedEvent = {
  botId: string;
  enabledModules: string[];
};

export type TagVerificationScopeEvent = {
  botId: string;
  guildId: string;
};

export type TagVerificationRunResult = {
  botId: string;
  guildId: string;
  checked: number;
  assigned: number;
  removed: number;
  ignored: number;
  unavailable: number;
  errors: number;
  lastCheckAt: string;
  nextCheckAt: string | null;
  lastError: string | null;
};

export type MaintenanceUpdatedEvent = {
  action: string;
  alertMessage?: string;
  state: {
    active: boolean;
    activatedAt: string | null;
    affectedBots: number;
    deactivatedAt: string | null;
    updatedAt: string;
    updatedById: string | null;
    updatedByName: string | null;
  };
};

export type VoiceRecorderStartEvent = {
  actorId: string;
  actorTag?: string | null;
  botId?: string | null;
  channelId: string;
  guildId: string;
  recordingId: string;
  source: "dashboard";
};

export type VoiceRecorderStopEvent = {
  actorId: string;
  actorTag?: string | null;
  botId?: string | null;
  guildId: string;
  recordingId: string;
  source: "dashboard";
};

export class BotSocketClient {
  private socket: Socket | null = null;
  private socialPanelUpdateHandler: ((payload: SocialPanelUpdateEvent) => void) | null = null;
  private xMonitorUpdateHandler: ((payload: XMonitorUpdateEvent) => void) | null = null;
  private xMonitorPostHandler: ((payload: XMonitorPostEvent) => void) | null = null;
  private fivemFacSettingsHandler: ((payload: FivemFacSettingsEvent) => void) | null = null;
  private fivemFacPanelPublishHandler: ((payload: FivemFacPanelPublishEvent) => void) | null = null;
  private fivemGoalPanelPublishHandler: ((payload: FivemGoalPanelPublishEvent) => void) | null = null;
  private fivemFinancePanelPublishHandler: ((payload: FivemFinancePanelPublishEvent) => void) | null = null;
  private fivemOrderPanelPublishHandler: ((payload: FivemOrderPanelPublishEvent) => void) | null = null;
  private fivemOrderStatusUpdatedHandler: ((payload: FivemOrderStatusUpdatedEvent) => void) | null = null;
  private priceTablePanelPublishHandler: ((payload: PriceTablePanelPublishEvent) => void) | null = null;
  private manualPaymentPanelPublishHandler: ((payload: ManualPaymentPanelPublishEvent) => void) | null = null;
  private coursePanelPublishHandler: ((payload: CoursePanelPublishEvent) => void) | null = null;
  private rhAdminPanelPublishHandler: ((payload: RhAdminPanelPublishEvent) => void) | null = null;
  private ticketPanelPublishHandler: ((payload: TicketPanelPublishEvent) => void) | null = null;
  private nexTechSalePaidHandler: ((payload: NexTechSalePaidEvent) => void) | null = null;
  private manualRegistrationPanelPublishHandler: ((payload: ManualRegistrationPanelPublishEvent) => void) | null = null;
  private manualRegistrationExecuteHandler: ((payload: ManualRegistrationExecuteEvent) => void) | null = null;
  private manualRegistrationRemoveHandler: ((payload: ManualRegistrationRemoveEvent) => void) | null = null;
  private databaseMaintenanceDeleteChannelsHandler: ((payload: DatabaseMaintenanceDeleteChannelsEvent) => void) | null = null;
  private fivemHierarchyPanelUpdateHandler: ((payload: FivemHierarchyPanelUpdateEvent, ack?: FivemHierarchyPanelUpdateAck) => void) | null = null;
  private fivemFacAbsenceUpdateHandler: ((payload: FivemFacAbsenceUpdateEvent) => void) | null = null;
  private policeHiddenChannelSettingsHandler: ((payload: PoliceHiddenChannelSettingsEvent) => void) | null = null;
  private dmBarSettingsHandler: ((payload: DmBarSettingsEvent) => void) | null = null;
  private missionToolsSettingsHandler: ((payload: MissionToolsSettingsEvent) => void) | null = null;
  private missionToolsPanelPublishHandler: ((payload: MissionToolsPanelPublishEvent) => void) | null = null;
  private missionToolsUserUpdateHandler: ((payload: MissionToolsUserUpdateEvent) => void) | null = null;
  private giveawayPanelUpdateHandler: ((payload: GiveawayPanelUpdateEvent) => void) | null = null;
  private imageAntiSpamSettingsHandler: ((payload: ImageAntiSpamSettingsEvent) => void) | null = null;
  private selfBotProtectionSettingsHandler: ((payload: SelfBotProtectionSettingsEvent) => void) | null = null;
  private selfBotEnsureSetupHandler: ((payload: SelfBotEnsureSetupEvent, ack?: SelfBotEnsureSetupAck) => void) | null = null;
  private settingsUpdatedHandlers = new Set<(payload: SettingsUpdatedEvent) => void>();
  private discordLogDispatchHandler: ((payload: DiscordLogDispatchEvent) => void) | null = null;
  private devModuleUpdatedHandler: ((payload: DevModuleUpdatedEvent) => void) | null = null;
  private tagVerificationConfigUpdatedHandler: ((payload: TagVerificationScopeEvent) => void) | null = null;
  private tagVerificationRunHandler: ((payload: TagVerificationScopeEvent) => Promise<TagVerificationRunResult>) | null = null;
  private maintenanceUpdatedHandler: ((payload: MaintenanceUpdatedEvent) => void) | null = null;
  private voiceRecorderStartHandler: ((payload: VoiceRecorderStartEvent) => void) | null = null;
  private voiceRecorderStopHandler: ((payload: VoiceRecorderStopEvent) => void) | null = null;

  connect(client: Client) {
    if (!env.BACKEND_SOCKET_URL) {
      console.warn("[socket] BACKEND_SOCKET_URL nao configurado; conexao em tempo real desativada.");
      return;
    }

    if (!env.BOT_API_TOKEN) {
      console.warn("[socket] BOT_API_TOKEN nao configurado; eventos em tempo real do bot serao ignorados pelo backend.");
    }

    this.socket?.disconnect();
    this.socket = io(env.BACKEND_SOCKET_URL, {
      auth: {
        token: env.BOT_API_TOKEN,
        botId: (currentRuntimeBotId() ?? env.DASHBOARD_BOT_ID) || null,
        clientId: client.user?.id ?? null
      },
      reconnection: true,
      reconnectionDelay: 1000,
      timeout: 10000,
      transports: ["websocket", "polling"]
    });

    this.socket.on("connect", () => {
      console.log(`[socket] conectado ao backend em ${env.BACKEND_SOCKET_URL}`);
      this.emitStatus(client, true);
    });

    this.socket.on("connect_error", (error) => {
      console.warn("[socket] falha ao conectar no backend:", error.message);
    });

    this.socket.on("disconnect", (reason) => {
      console.warn(`[socket] desconectado do backend: ${reason}`);
    });

    this.socket.on("bot:shutdown", (payload: { botId?: string | null } = {}) => {
      const botId = (currentRuntimeBotId() ?? env.DASHBOARD_BOT_ID) || null;
      const requestedBotId = typeof payload.botId === "string" && payload.botId.trim()
        ? payload.botId.trim()
        : null;

      if (!requestedBotId || !botId || requestedBotId !== botId) {
        console.warn("[socket] desligamento DEV ignorado: botId ausente ou diferente do runtime atual.");
        return;
      }

      console.log("[socket] desligamento solicitado pelo painel DEV.");
      this.disconnect(client);
      client.destroy();
      setTimeout(() => process.exit(0), 100).unref();
    });

    if (this.socialPanelUpdateHandler) {
      this.socket.on("socials:update", this.socialPanelUpdateHandler);
    }

    if (this.xMonitorUpdateHandler) {
      this.socket.on("x-monitor:update", this.xMonitorUpdateHandler);
    }

    if (this.xMonitorPostHandler) {
      this.socket.on("x-monitor:post", this.xMonitorPostHandler);
    }

    if (this.fivemFacSettingsHandler) {
      this.socket.on("fivem:fac:settings_updated", this.fivemFacSettingsHandler);
    }

    if (this.fivemFacPanelPublishHandler) {
      this.socket.on("fivem:fac:panel_publish", this.fivemFacPanelPublishHandler);
    }

    if (this.fivemGoalPanelPublishHandler) {
      this.socket.on("fivem:goals:panel_publish", this.fivemGoalPanelPublishHandler);
    }
    if (this.fivemFinancePanelPublishHandler) this.socket.on("fivem:finance:panel_publish", this.fivemFinancePanelPublishHandler);
    if (this.fivemOrderPanelPublishHandler) this.socket.on("fivem:orders:panel_publish", this.fivemOrderPanelPublishHandler);
    if (this.fivemOrderStatusUpdatedHandler) this.socket.on("fivem:orders:status_updated", this.fivemOrderStatusUpdatedHandler);
    if (this.priceTablePanelPublishHandler) this.socket.on("price-tables:panel_publish", this.priceTablePanelPublishHandler);
    if (this.manualPaymentPanelPublishHandler) this.socket.on("manual-payments:panel_publish", this.manualPaymentPanelPublishHandler);
    if (this.coursePanelPublishHandler) this.socket.on("courses:panel_publish", this.coursePanelPublishHandler);
    if (this.rhAdminPanelPublishHandler) this.socket.on("rh-admin:panel_publish", this.rhAdminPanelPublishHandler);
    if (this.ticketPanelPublishHandler) this.socket.on("tickets:panel_publish", this.ticketPanelPublishHandler);
    if (this.nexTechSalePaidHandler) this.socket.on("nex-tech-sales:sale_paid", this.nexTechSalePaidHandler);

    if (this.manualRegistrationPanelPublishHandler) {
      this.socket.on("manual-registration:panel_publish", this.manualRegistrationPanelPublishHandler);
    }
    if (this.manualRegistrationExecuteHandler) this.socket.on("manual-registration:execute", this.manualRegistrationExecuteHandler);
    if (this.manualRegistrationRemoveHandler) this.socket.on("manual-registration:remove", this.manualRegistrationRemoveHandler);
    if (this.databaseMaintenanceDeleteChannelsHandler) this.socket.on("database-maintenance:delete_channels", this.databaseMaintenanceDeleteChannelsHandler);

    if (this.fivemHierarchyPanelUpdateHandler) {
      this.socket.on("fivem:hierarchy:panel_update", this.fivemHierarchyPanelUpdateHandler);
    }

    if (this.fivemFacAbsenceUpdateHandler) {
      this.socket.on("fivem:fac:absence_updated", this.fivemFacAbsenceUpdateHandler);
    }

    if (this.policeHiddenChannelSettingsHandler) {
      this.socket.on("police-hidden-channel:settings_updated", this.policeHiddenChannelSettingsHandler);
    }
    if (this.dmBarSettingsHandler) {
      this.socket.on("dm-bar:settings_updated", this.dmBarSettingsHandler);
    }

    if (this.missionToolsSettingsHandler) {
      this.socket.on("mission-tools:settings_updated", this.missionToolsSettingsHandler);
    }

    if (this.missionToolsPanelPublishHandler) {
      this.socket.on("mission-tools:panel_publish", this.missionToolsPanelPublishHandler);
    }

    if (this.missionToolsUserUpdateHandler) {
      this.socket.on("mission-tools:user_updated", this.missionToolsUserUpdateHandler);
    }

    if (this.giveawayPanelUpdateHandler) {
      this.socket.on("giveaway:panel_update", this.giveawayPanelUpdateHandler);
    }

    if (this.imageAntiSpamSettingsHandler) {
      this.socket.on("image-anti-spam:settings_updated", this.imageAntiSpamSettingsHandler);
    }

    if (this.selfBotProtectionSettingsHandler) {
      this.socket.on("self-bot-protection:settings_updated", this.selfBotProtectionSettingsHandler);
    }

    if (this.selfBotEnsureSetupHandler) {
      this.socket.on("self-bot:ensure_setup", this.selfBotEnsureSetupHandler);
    }

    for (const handler of this.settingsUpdatedHandlers) {
      this.socket.on("settings:updated", handler);
    }

    if (this.discordLogDispatchHandler) {
      this.socket.on("logs:discord_dispatch", this.discordLogDispatchHandler);
    }

    if (this.devModuleUpdatedHandler) {
      this.socket.on("dev:module_updated", this.devModuleUpdatedHandler);
    }

    if (this.tagVerificationConfigUpdatedHandler) {
      this.socket.on("tag-verification:config_updated", this.tagVerificationConfigUpdatedHandler);
    }

    if (this.tagVerificationRunHandler) {
      this.attachTagVerificationRunHandler();
    }

    if (this.maintenanceUpdatedHandler) {
      this.socket.on("maintenance:updated", this.maintenanceUpdatedHandler);
    }

    if (this.voiceRecorderStartHandler) {
      this.socket.on("voice-recorder:start", this.voiceRecorderStartHandler);
    }

    if (this.voiceRecorderStopHandler) {
      this.socket.on("voice-recorder:stop", this.voiceRecorderStopHandler);
    }
  }

  emitStatus(client: Client, online = true) {
    const memory = process.memoryUsage();
    const shardIds = client.shard?.ids ?? [0];
    const users = client.guilds.cache.reduce((total, guild) => total + (guild.memberCount ?? 0), 0);
    const botGuilds = client.guilds.cache.map((guild) => ({
      id: guild.id,
      name: guild.name,
      iconUrl: guild.iconURL({ size: 128 }),
      memberCount: guild.memberCount ?? 0,
      channelCount: guild.channels.cache.size,
      shardId: guild.shardId
    }));

    this.socket?.emit("bot:status", {
      botId: (currentRuntimeBotId() ?? env.DASHBOARD_BOT_ID) || null,
      botProfile: client.user
        ? {
            id: client.user.id,
            username: client.user.username,
            avatarUrl: client.user.displayAvatarURL({ size: 256 })
          }
        : undefined,
      online,
      latency: Math.max(0, Math.round(client.ws.ping)),
      guilds: client.guilds.cache.size,
      users,
      botGuilds,
      shardIds,
      shardCount: client.shard?.count ?? 1,
      instanceId: `shard:${shardIds.join(",")}`,
      memory: {
        rssMb: Math.round(memory.rss / 1024 / 1024),
        heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024)
      }
    });
  }

  emitLog(payload: { botId?: string | null; guildId: string; type: string; message: string; userId?: string | null; metadata?: unknown }) {
    this.socket?.emit("bot:log", { ...payload, botId: (payload.botId ?? currentRuntimeBotId() ?? env.DASHBOARD_BOT_ID) || null });
  }

  emitLiveStarted(payload: { guildId: string; streamer: string; title?: string; url?: string }) {
    this.socket?.emit("live:started", { ...payload, botId: (currentRuntimeBotId() ?? env.DASHBOARD_BOT_ID) || null });
  }

  emitLiveEnded(payload: { guildId: string; streamer: string; title?: string; url?: string }) {
    this.socket?.emit("live:ended", { ...payload, botId: (currentRuntimeBotId() ?? env.DASHBOARD_BOT_ID) || null });
  }

  onSocialPanelUpdate(handler: (payload: SocialPanelUpdateEvent) => void) {
    this.socialPanelUpdateHandler = handler;
    this.socket?.off("socials:update");
    this.socket?.on("socials:update", handler);
  }

  onXMonitorUpdate(handler: (payload: XMonitorUpdateEvent) => void) {
    this.xMonitorUpdateHandler = handler;
    this.socket?.off("x-monitor:update");
    this.socket?.on("x-monitor:update", handler);
  }

  onXMonitorPost(handler: (payload: XMonitorPostEvent) => void) {
    this.xMonitorPostHandler = handler;
    this.socket?.off("x-monitor:post");
    this.socket?.on("x-monitor:post", handler);
  }

  onFivemFacSettingsUpdated(handler: (payload: FivemFacSettingsEvent) => void) {
    this.fivemFacSettingsHandler = handler;
    this.socket?.off("fivem:fac:settings_updated");
    this.socket?.on("fivem:fac:settings_updated", handler);
  }

  onFivemFacPanelPublish(handler: (payload: FivemFacPanelPublishEvent) => void) {
    this.fivemFacPanelPublishHandler = handler;
    this.socket?.off("fivem:fac:panel_publish");
    this.socket?.on("fivem:fac:panel_publish", handler);
  }

  onFivemGoalPanelPublish(handler: (payload: FivemGoalPanelPublishEvent) => void) {
    this.fivemGoalPanelPublishHandler = handler;
    this.socket?.off("fivem:goals:panel_publish");
    this.socket?.on("fivem:goals:panel_publish", handler);
  }

  onFivemFinancePanelPublish(handler: (payload: FivemFinancePanelPublishEvent) => void) {
    this.fivemFinancePanelPublishHandler = handler;
    this.socket?.off("fivem:finance:panel_publish");
    this.socket?.on("fivem:finance:panel_publish", handler);
  }

  onFivemOrderPanelPublish(handler: (payload: FivemOrderPanelPublishEvent) => void) {
    this.fivemOrderPanelPublishHandler = handler;
    this.socket?.off("fivem:orders:panel_publish");
    this.socket?.on("fivem:orders:panel_publish", handler);
  }

  onFivemOrderStatusUpdated(handler: (payload: FivemOrderStatusUpdatedEvent) => void) {
    this.fivemOrderStatusUpdatedHandler = handler;
    this.socket?.off("fivem:orders:status_updated");
    this.socket?.on("fivem:orders:status_updated", handler);
  }

  onPriceTablePanelPublish(handler: (payload: PriceTablePanelPublishEvent) => void) {
    this.priceTablePanelPublishHandler = handler;
    this.socket?.off("price-tables:panel_publish");
    this.socket?.on("price-tables:panel_publish", handler);
  }

  onManualPaymentPanelPublish(handler: (payload: ManualPaymentPanelPublishEvent) => void) {
    this.manualPaymentPanelPublishHandler = handler;
    this.socket?.off("manual-payments:panel_publish");
    this.socket?.on("manual-payments:panel_publish", handler);
  }

  onCoursePanelPublish(handler: (payload: CoursePanelPublishEvent) => void) {
    this.coursePanelPublishHandler = handler;
    this.socket?.off("courses:panel_publish");
    this.socket?.on("courses:panel_publish", handler);
  }

  onRhAdminPanelPublish(handler: (payload: RhAdminPanelPublishEvent) => void) {
    this.rhAdminPanelPublishHandler = handler;
    this.socket?.off("rh-admin:panel_publish");
    this.socket?.on("rh-admin:panel_publish", handler);
  }

  onTicketPanelPublish(handler: (payload: TicketPanelPublishEvent) => void) {
    this.ticketPanelPublishHandler = handler;
    this.socket?.off("tickets:panel_publish");
    this.socket?.on("tickets:panel_publish", handler);
  }

  onNexTechSalePaid(handler: (payload: NexTechSalePaidEvent) => void) {
    this.nexTechSalePaidHandler = handler;
    this.socket?.off("nex-tech-sales:sale_paid");
    this.socket?.on("nex-tech-sales:sale_paid", handler);
  }

  onManualRegistrationPanelPublish(handler: (payload: ManualRegistrationPanelPublishEvent) => void) {
    this.manualRegistrationPanelPublishHandler = handler;
    this.socket?.off("manual-registration:panel_publish");
    this.socket?.on("manual-registration:panel_publish", handler);
  }

  onManualRegistrationExecute(handler: (payload: ManualRegistrationExecuteEvent) => void) {
    this.manualRegistrationExecuteHandler = handler;
    this.socket?.off("manual-registration:execute");
    this.socket?.on("manual-registration:execute", handler);
  }
  onManualRegistrationRemove(handler: (payload: ManualRegistrationRemoveEvent) => void) { this.manualRegistrationRemoveHandler = handler; this.socket?.off("manual-registration:remove"); this.socket?.on("manual-registration:remove", handler); }

  onDatabaseMaintenanceDeleteChannels(handler: (payload: DatabaseMaintenanceDeleteChannelsEvent) => void) {
    this.databaseMaintenanceDeleteChannelsHandler = handler;
    this.socket?.off("database-maintenance:delete_channels");
    this.socket?.on("database-maintenance:delete_channels", handler);
  }

  onFivemHierarchyPanelUpdate(handler: (payload: FivemHierarchyPanelUpdateEvent, ack?: FivemHierarchyPanelUpdateAck) => void) {
    this.fivemHierarchyPanelUpdateHandler = handler;
    this.socket?.off("fivem:hierarchy:panel_update");
    this.socket?.on("fivem:hierarchy:panel_update", handler);
  }

  onFivemFacAbsenceUpdated(handler: (payload: FivemFacAbsenceUpdateEvent) => void) {
    this.fivemFacAbsenceUpdateHandler = handler;
    this.socket?.off("fivem:fac:absence_updated");
    this.socket?.on("fivem:fac:absence_updated", handler);
  }

  onPoliceHiddenChannelSettingsUpdated(handler: (payload: PoliceHiddenChannelSettingsEvent) => void) {
    this.policeHiddenChannelSettingsHandler = handler;
    this.socket?.off("police-hidden-channel:settings_updated");
    this.socket?.on("police-hidden-channel:settings_updated", handler);
  }

  onDmBarSettingsUpdated(handler: (payload: DmBarSettingsEvent) => void) {
    this.dmBarSettingsHandler = handler;
    this.socket?.off("dm-bar:settings_updated");
    this.socket?.on("dm-bar:settings_updated", handler);
  }

  onMissionToolsSettingsUpdated(handler: (payload: MissionToolsSettingsEvent) => void) {
    this.missionToolsSettingsHandler = handler;
    this.socket?.off("mission-tools:settings_updated");
    this.socket?.on("mission-tools:settings_updated", handler);
  }

  onMissionToolsPanelPublish(handler: (payload: MissionToolsPanelPublishEvent) => void) {
    this.missionToolsPanelPublishHandler = handler;
    this.socket?.off("mission-tools:panel_publish");
    this.socket?.on("mission-tools:panel_publish", handler);
  }

  onMissionToolsUserUpdated(handler: (payload: MissionToolsUserUpdateEvent) => void) {
    this.missionToolsUserUpdateHandler = handler;
    this.socket?.off("mission-tools:user_updated");
    this.socket?.on("mission-tools:user_updated", handler);
  }

  onGiveawayPanelUpdate(handler: (payload: GiveawayPanelUpdateEvent) => void) {
    this.giveawayPanelUpdateHandler = handler;
    this.socket?.off("giveaway:panel_update");
    this.socket?.on("giveaway:panel_update", handler);
  }

  onImageAntiSpamSettingsUpdated(handler: (payload: ImageAntiSpamSettingsEvent) => void) {
    this.imageAntiSpamSettingsHandler = handler;
    this.socket?.off("image-anti-spam:settings_updated");
    this.socket?.on("image-anti-spam:settings_updated", handler);
  }

  onSelfBotProtectionSettingsUpdated(handler: (payload: SelfBotProtectionSettingsEvent) => void) {
    this.selfBotProtectionSettingsHandler = handler;
    this.socket?.off("self-bot-protection:settings_updated");
    this.socket?.on("self-bot-protection:settings_updated", handler);
  }

  onSelfBotEnsureSetup(handler: (payload: SelfBotEnsureSetupEvent, ack?: SelfBotEnsureSetupAck) => void) {
    this.selfBotEnsureSetupHandler = handler;
    this.socket?.off("self-bot:ensure_setup");
    this.socket?.on("self-bot:ensure_setup", handler);
  }

  onSettingsUpdated(handler: (payload: SettingsUpdatedEvent) => void) {
    this.settingsUpdatedHandlers.add(handler);
    this.socket?.on("settings:updated", handler);
  }

  onDiscordLogDispatch(handler: (payload: DiscordLogDispatchEvent) => void) {
    this.discordLogDispatchHandler = handler;
    this.socket?.off("logs:discord_dispatch");
    this.socket?.on("logs:discord_dispatch", handler);
  }

  onDevModuleUpdated(handler: (payload: DevModuleUpdatedEvent) => void) {
    this.devModuleUpdatedHandler = handler;
    this.socket?.off("dev:module_updated");
    this.socket?.on("dev:module_updated", handler);
  }

  onTagVerificationConfigUpdated(handler: (payload: TagVerificationScopeEvent) => void) {
    this.tagVerificationConfigUpdatedHandler = handler;
    this.socket?.off("tag-verification:config_updated");
    this.socket?.on("tag-verification:config_updated", handler);
  }

  onTagVerificationRun(handler: (payload: TagVerificationScopeEvent) => Promise<TagVerificationRunResult>) {
    this.tagVerificationRunHandler = handler;
    this.attachTagVerificationRunHandler();
  }

  private attachTagVerificationRunHandler() {
    this.socket?.off("tag-verification:run");
    this.socket?.on("tag-verification:run", async (
      payload: TagVerificationScopeEvent,
      callback: (response: TagVerificationRunResult | { error: string }) => void
    ) => {
      if (!this.tagVerificationRunHandler) {
        callback({ error: "Verificacao de Tag indisponivel neste bot." });
        return;
      }

      try {
        callback(await this.tagVerificationRunHandler(payload));
      } catch (error) {
        callback({ error: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  onMaintenanceUpdated(handler: (payload: MaintenanceUpdatedEvent) => void) {
    this.maintenanceUpdatedHandler = handler;
    this.socket?.off("maintenance:updated");
    this.socket?.on("maintenance:updated", handler);
  }

  onVoiceRecorderStart(handler: (payload: VoiceRecorderStartEvent) => void) {
    this.voiceRecorderStartHandler = handler;
    this.socket?.off("voice-recorder:start");
    this.socket?.on("voice-recorder:start", handler);
  }

  onVoiceRecorderStop(handler: (payload: VoiceRecorderStopEvent) => void) {
    this.voiceRecorderStopHandler = handler;
    this.socket?.off("voice-recorder:stop");
    this.socket?.on("voice-recorder:stop", handler);
  }

  disconnect(client: Client) {
    this.emitStatus(client, false);
    this.socket?.disconnect();
  }
}

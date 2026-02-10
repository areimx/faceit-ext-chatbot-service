/**
 * @file config.js
 * This file exports a factory function that generates a configuration object
 * for a specific bot instance.
 */

// Environment detection utilities
const isStaging =
  process.env.APP_ENV === 'staging' || process.argv.includes('--staging');

const envFile = isStaging ? '../.env.staging' : '../.env';
require('dotenv').config({ path: require('path').resolve(__dirname, envFile) });

const isVerboseLoggingEnabled =
  process.env.LOG_VERBOSE === 'true' || process.argv.includes('--verbose');

/**
 * XMPP service connection details.
 */
const xmppConfig = {
  /** The WebSocket URL for the XMPP service. */
  service: isStaging
    ? 'wss://chat.faceit-stage.com/ws-xmpp'
    : 'wss://chat.faceit.com/ws-xmpp',
  /** The domain of the XMPP service. */
  domain: isStaging ? 'chat.faceit-stage.com' : 'chat.faceit.com',
  /** The domain for Multi-User Chat (MUC) services. */
  mucDomain: isStaging
    ? 'muclight.chat.faceit-stage.com'
    : 'muclight.chat.faceit.com',
  /** The domain for Supergroups in the XMPP service. */
  supergroupDomain: isStaging
    ? 'supergroups.chat.faceit-stage.com'
    : 'supergroups.chat.faceit.com',
};

/**
 * API endpoint configurations.
 */
const apiConfig = {
  /** The base URL for the internal database API service. */
  baseUrl: `http://localhost:${process.env.DB_API_PORT || process.env.API_PORT || 3008}`,
  /** The URL for obtaining a FACEIT chat authentication token. */
  faceitAuthUrl: isStaging
    ? 'https://api.faceit-stage.com/chat-auth/v1/token'
    : 'https://api.faceit.com/chat-auth/v1/token',
  /** The URL for the FACEIT chat admin API. */
  chatAdminUrl: isStaging
    ? 'https://api.faceit-stage.com/chat-admin/v1'
    : 'https://api.faceit.com/chat-admin/v1',
  /** Cloudflare bypass key for api.faceit.com requests */
  faceitCfBypassKey: process.env.FACEIT_CF_BYPASS_KEY || null,
};

const defaultBotconfig = {
  /**
   * Timing and interval settings for various operations (in milliseconds).
   */
  timing: {
    /** Delay before retrying a failed startup initialization. */
    startupRetry: 60 * 1000,
    /** Interval for periodically fetching the bot's full entity list. */
    entityUpdateInterval: 10 * 60 * 1000,
    /** Grace period to allow for cleanup before the process exits on shutdown. Keep small to fit PM2 kill_timeout. */
    shutdownGracePeriod: isStaging ? 1 * 1000 : 2 * 1000,
    /** Delay before attempting to reconnect a disconnected XMPP client. */
    reconnectDelay: 15 * 1000,
    /** Interval for processing the outgoing stanza queue to prevent rate-limiting. */
    outgoingMessageInterval: 300,
    /** Interval for processing the outgoing stanza queue (in milliseconds). */
    stanzaQueueInterval: 300,
    /** Interval for connection health checks; align with constants. */
    connectionHealthCheckInterval: 30 * 1000,
  },

  /**
   * The maximum number of times to retry the initial startup sequence before exiting.
   */
  maxStartupRetries: 5,
};

/**
 * Application constants for timing, limits, and configuration values.
 */
const constants = {
  /** Time intervals in milliseconds */
  timing: {
    /** Connection health check interval */
    connectionHealthCheck: 30 * 1000,
    /** Message reception check interval */
    messageReceptionCheck: 60 * 1000,
    /** Supergroup subscription refresh interval */
    subscriptionRefresh: 5 * 60 * 1000,
    /** Recently unassigned entities cleanup timeout */
    recentlyUnassignedCleanup: 5 * 60 * 1000,
    /** Non-existent entities cleanup timeout (supergroup) */
    nonExistentCleanupSupergroup: 6 * 60 * 60 * 1000,
    /** Non-existent entities cleanup timeout (MUC Light) */
    nonExistentCleanupMucLight: 60 * 60 * 1000,
    /** Connection health warning threshold */
    connectionHealthWarning: 5 * 60 * 1000,
    /** Message reception refresh threshold */
    messageReceptionRefresh: 5 * 60 * 1000,
    /** Health monitor warning cooldown (prevents spam logging) */
    healthWarningCooldown: 60 * 1000,
    /** XMPP connection timeout */
    xmppConnectionTimeout: 30 * 1000,
    /** XMPP stop operation timeout */
    xmppStopTimeout: 5 * 1000,
  },

  /** XMPP protocol constants */
  xmpp: {
    /** Maximum messages to fetch in subscription */
    maxSubscriptionMessages: 30,
    /** Maximum messages to fetch in MAM query */
    maxMamMessages: 20,
    /** Maximum room roster entries */
    maxRoomRoster: 100,
    /** Maximum pinned messages to fetch */
    maxPinnedMessages: 10,
  },

  /** Moderation constants */
  moderation: {
    /** Default mute duration for banned words (24 hours) */
    bannedWordMuteDuration: 24 * 60 * 60,
    /** Default mute duration for read-only violations (10 seconds) */
    readOnlyMuteDuration: 10,
  },

  /** Bot process constants */
  bot: {
    /** Base port for bot API services */
    baseApiPort: 4000,
    /** Maximum bot failures before stopping retries */
    maxFailures: 5,
    /** Initial restart delay for failed bots */
    initialRestartDelay: 5 * 60 * 1000,
  },

  /** Authentication and token lifetimes/refresh policy */
  auth: {
    /** Approximate validity of FACEIT access token obtained via refresh token */
    accessTokenTtlMs:
      parseInt(process.env.ACCESS_TOKEN_TTL_MS || '', 10) ||
      12 * 60 * 60 * 1000, // ~12h
    /** Chat token validity (short-lived) */
    chatTokenTtlMs:
      parseInt(process.env.CHAT_TOKEN_TTL_MS || '', 10) || 4 * 60 * 1000, // 4m
    /** How often we attempt a background refresh on normal config reads */
    tokenRefreshIntervalMs:
      parseInt(process.env.TOKEN_REFRESH_INTERVAL_MS || '', 10) ||
      30 * 60 * 1000, // 30m default
    /** Minimum spacing between forced refreshes (e.g., after not-authorized) */
    forceRefreshMinIntervalMs:
      parseInt(process.env.FORCE_REFRESH_MIN_INTERVAL_MS || '', 10) ||
      60 * 1000, // 60s default
  },
};

const defaultStagingBot = {
  botCredentials: {
    bot_guid: process.env.STAGE_BOT_GUID || null,
    bot_token: process.env.STAGE_BOT_TOKEN || null,
    nickname: process.env.STAGE_BOT_NICKNAME || null,
  },
  entities: {
    [process.env.STAGE_BOT_ENTITY_GUID || null]: {
      guid: process.env.STAGE_BOT_ENTITY_GUID || null,
      commands: {
        test: {
          response: 'test\n',
        },
      },
      timers: [
        {
          message: 'Hello world\n',
        },
      ],
      timer_counter_max: 5,
      read_only: false,
      welcome_message: null,
    },
  },
};

/**
 * Creates a configuration object for a chatbot process.
 * @param {string} botId - The unique identifier for the bot.
 * @returns {object} A configuration object with all necessary parameters.
 */
function createConfig(botId) {
  // Default config
  const config = {
    /**
     * The unique identifier for this bot instance.
     */
    botId,

    /**
     * Timing and interval settings for various operations (in milliseconds).
     */
    timing: defaultBotconfig.timing,

    /**
     * The maximum number of times to retry the initial startup sequence before exiting.
     */
    maxStartupRetries: defaultBotconfig.maxStartupRetries,

    /**
     * Staging-specific configurations.
     */
    staging: defaultStagingBot,
  };
  return config;
}

module.exports = {
  createConfig,
  apiConfig,
  xmppConfig,
  defaultBotconfig,
  defaultStagingBot,
  constants,
  isStaging,
  isVerboseLoggingEnabled,
};

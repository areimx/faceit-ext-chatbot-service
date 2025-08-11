/**
 * @file worker/index.js
 * Individual bot worker process handling XMPP connections and message processing.
 */

const { client, xml } = require('@xmpp/client');
const debug = require('@xmpp/debug');
const express = require('express');

const {
  createConfig,
  xmppConfig,
  apiConfig,
  constants,
} = require('../../config');
const { isStaging, isVerboseLoggingEnabled } = require('../../config');
const StateManager = require('../../core/state-manager.js');
const { postRequest, getRequest } = require('../../lib/http/client.js');
const { botLog, idManager } = require('../../lib/utils');
const xmppActions = require('../../lib/xmpp/actions.js');
const {
  joinRoomForEntity,
  leaveRoomForEntity,
} = require('../../lib/xmpp/utils.js');
const Commands = require('../../modules/messaging/commands.js');
const TimedMessages = require('../../modules/messaging/timed-messages.js');
const BannedWordsManager = require('../../modules/moderation/banned-words/banned-words-manager.js');
const DiscordWebhookManager = require('../../modules/moderation/discord/discord-webhook-manager.js');
const Moderation = require('../../modules/moderation/moderation.js');
const DebugHandler = require('../../modules/monitoring/debug-handler.js');
const HealthMonitor = require('../../modules/monitoring/health-monitor.js');
const MessageProcessor = require('../../modules/processing/message-processor.js');

// --- CONFIGURATION & STATE ---

const botId =
  process.env.bot_id ||
  process.argv.find((arg) => arg.startsWith('--bot_id='))?.split('=')[1];

if (!botId) {
  console.error(
    'FATAL: bot_id is missing. Please provide it as an environment variable or as --bot_id=<id>',
  );
  process.exit(1);
}

const config = createConfig(botId);

// Initialize StateManager for centralized state management
const stateManager = new StateManager(config);

// Set up real-time update listeners for command configuration changes
stateManager.onStateChange('entity:updated', (data) => {
  const { entityId, entityData, wasNew } = data;

  if (!wasNew) {
    botLog(
      config.botId,
      'verbose',
      `Real-time update: Entity ${entityId} configuration updated. Commands: ${entityData.commands ? Object.keys(entityData.commands).length : 0}`,
    );
  }
});

stateManager.onStateChange('entity:removed', (data) => {
  botLog(
    config.botId,
    'verbose',
    `Real-time update: Entity ${data.entityId} removed from bot`,
  );
});

/**
 * Queues a stanza for sending via the XMPP connection.
 * @param {object} stanza - The XMPP stanza to queue.
 */
function queueStanza(stanza) {
  if (stateManager.isShuttingDown()) return;

  if (!stanza) {
    botLog(config.botId, 'error', 'Attempted to queue null/undefined stanza');
    return;
  }

  // Log stanza safely without circular reference issues
  botLog(config.botId, 'verbose', `Queuing stanza: ${stanza.toString()}`);
  stateManager.addToOutgoingStanzaQueue(stanza);
}

/**
 * Handles reconnection circuit breaker logic and backoff strategy.
 * @returns {boolean} True if reconnection should proceed, false if circuit breaker is open
 */
function shouldAttemptReconnection() {
  const now = Date.now();

  // Check if we've exceeded maximum reconnection attempts
  const attempts = stateManager.getReconnectionAttempts();
  if (attempts >= 10) {
    // Simplified to 10 attempts
    botLog(
      config.botId,
      'error',
      `Maximum reconnection attempts (${attempts}) reached. Circuit breaker is open.`,
    );
    return false;
  }

  // Check if we need to wait for backoff
  const timeSinceLastReconnection =
    now - stateManager.getLastReconnectionTime();
  const backoffMs = stateManager.getReconnectionBackoffMs();
  if (timeSinceLastReconnection < backoffMs) {
    const remainingTime = Math.ceil(
      (backoffMs - timeSinceLastReconnection) / 1000,
    );
    botLog(
      config.botId,
      'verbose',
      `Backoff in progress. Waiting ${remainingTime} more seconds before next reconnection attempt.`,
    );
    return false;
  }

  return true;
}

/**
 * Records a reconnection attempt and updates backoff timing.
 */
function recordReconnectionAttempt() {
  const now = Date.now();
  const attempts = stateManager.incrementReconnectionAttempts();
  stateManager.setLastReconnectionTime(now);

  // Exponential backoff with maximum limit
  const currentBackoff = stateManager.getReconnectionBackoffMs();
  const newBackoff = Math.min(
    currentBackoff * 2,
    300000, // Max backoff 5 minutes
  );
  stateManager.setReconnectionBackoffMs(newBackoff);

  botLog(
    config.botId,
    'log',
    `Reconnection attempt ${attempts}/10. Next attempt in ${Math.ceil(newBackoff / 1000)} seconds.`,
  );

  // If we've exhausted all reconnection attempts, exit the process
  // This allows the parent process to restart us with fresh state
  if (attempts >= 10) {
    botLog(
      config.botId,
      'error',
      `Maximum reconnection attempts (${attempts}) reached. Exiting process to allow restart.`,
    );

    // Clean shutdown
    setTimeout(() => {
      process.exit(1); // Exit with error code to signal restart needed
    }, 1000);
  }
}

/**
 * Resets reconnection state when connection is successful.
 */
function resetReconnectionState() {
  stateManager.resetReconnectionAttempts();
  stateManager.setReconnectionBackoffMs(5000); // Reset backoff to base
  botLog(
    config.botId,
    'log',
    'Reconnection state reset - connection successful.',
  );
}

/**
 * Gets the current reconnection state for debugging.
 */
function getReconnectionState() {
  const attempts = stateManager.getReconnectionAttempts();
  const lastReconnectionTime = stateManager.getLastReconnectionTime();
  return {
    reconnectionAttempts: attempts,
    maxReconnectionAttempts: 10,
    circuitBreakerOpen: attempts >= 10,
    reconnectionBackoffMs: stateManager.getReconnectionBackoffMs(),
    lastReconnectionTime,
    timeSinceLastReconnection: Date.now() - lastReconnectionTime,
  };
}

/**
 * Clean up entity tracking sets when entity is reassigned
 * @param {string} entityId - The entity ID
 *
 * @param {string} botId - The bot ID for logging
 */
function cleanupEntityTracking(entityId, botId) {
  // Remove from recently unassigned entities set if it was there
  if (stateManager.hasRecentlyUnassignedEntity(entityId)) {
    stateManager.removeRecentlyUnassignedEntity(entityId);
    botLog(
      botId,
      'verbose',
      `Removed ${entityId} from recently unassigned entities set due to periodic update reassignment.`,
    );
  }

  // Remove from non-existent entities set if it was there (entity might have been recreated)
  if (stateManager.hasNonExistentEntity(entityId)) {
    stateManager.removeNonExistentEntity(entityId);
    botLog(
      botId,
      'verbose',
      `Removed ${entityId} from non-existent entities set due to periodic update reassignment.`,
    );
  }
}

/**
 * Leave room if XMPP is connected
 * @param {string} entityId - The entity ID
 *
 * @param {object} context - The context object
 */
function leaveRoomIfConnected(entityId, stateManager, context) {
  const xmpp = stateManager.getXmppClient();
  if (xmpp && xmpp.status === 'online') {
    leaveRoomForEntity(entityId, context);
  }
}

/**
 * Configure profanity filter for an entity
 * @param {string} entityId - The entity ID
 */
async function configureEntityProfanityFilter(entityId) {
  try {
    const profanityConfig = await getRequest(
      `${apiConfig.baseUrl}/profanity-filter-config/${entityId}`,
    );

    if (profanityConfig) {
      // Check if entity is active
      if (!profanityConfig.is_active) {
        // Entity is inactive - clean up all profanity filter configurations
        botLog(
          config.botId,
          'verbose',
          `Entity ${entityId} is inactive, cleaning up profanity filter configurations`,
        );

        // Clean up banned words configuration
        bannedWordsManager.cleanupEntity(entityId);

        // Clean up Discord webhook configuration
        discordWebhookManager.cleanupWebhook(entityId);

        // Remove from profanity filter configs map
        profanityFilterConfigs.delete(entityId);

        return;
      }

      // Store profanity filter config for moderation module
      profanityFilterConfigs.set(entityId, profanityConfig);

      // Configure banned words
      await bannedWordsManager.configureEntity(entityId, profanityConfig);

      // Get entity data to get the entity name
      const entityData = await getRequest(
        `${apiConfig.baseUrl}/entities/${entityId}/data`,
      );

      // Configure Discord webhook with entity name
      discordWebhookManager.configureWebhook(
        entityId,
        profanityConfig,
        entityData?.name,
      );

      botLog(
        config.botId,
        'verbose',
        `Configured profanity filter for entity ${entityId}`,
      );
    } else {
      // No config means profanity checking is disabled for this entity - clean up
      botLog(
        config.botId,
        'verbose',
        `No profanity filter config found for entity ${entityId}, cleaning up configurations`,
      );

      // Clean up banned words configuration
      bannedWordsManager.cleanupEntity(entityId);

      // Clean up Discord webhook configuration
      discordWebhookManager.cleanupWebhook(entityId);

      // Remove from profanity filter configs map
      profanityFilterConfigs.delete(entityId);
    }
  } catch (error) {
    // 404 errors are expected for entities without profanity filter config (disabled)
    if (error.message && error.message.includes('404')) {
      botLog(
        config.botId,
        'verbose',
        `No profanity filter config found for entity ${entityId} (404), cleaning up configurations`,
      );

      // Clean up banned words configuration
      bannedWordsManager.cleanupEntity(entityId);

      // Clean up Discord webhook configuration
      discordWebhookManager.cleanupWebhook(entityId);

      // Remove from profanity filter configs map
      profanityFilterConfigs.delete(entityId);
    } else {
      botLog(
        config.botId,
        'warn',
        `Failed to configure profanity filter for entity ${entityId}: ${error.message}`,
      );
    }
  }
}

// Initialize modules
const messageProcessor = new MessageProcessor(config, stateManager, idManager);
const bannedWordsManager = new BannedWordsManager(config, stateManager);
const discordWebhookManager = new DiscordWebhookManager(config, stateManager);
const profanityFilterConfigs = new Map();
const moderation = new Moderation({
  config,
  stateManager,
  xmppActions,
  bannedWordsManager,
  discordWebhookManager,
  profanityFilterConfigs,
  xmppConfig,
});
const timedMessages = new TimedMessages(config, stateManager, xmppActions);
const commands = new Commands(config, stateManager, xmppActions);
const healthMonitor = new HealthMonitor(config, stateManager);
const debugHandler = new DebugHandler(config, stateManager, xmppConfig);

// Create a context object to pass to utility functions
const context = {
  stateManager,
  config,
  xmppConfig,
  queueStanza,
};

// --- XMPP CONNECTION & LIFECYCLE ---

/**
 * Performs pre-connection checks and cleanup of existing connections.
 * @returns {boolean} True if connection should proceed, false otherwise
 */
function performPreConnectionChecks() {
  if (stateManager.isConnecting() || stateManager.isShuttingDown()) {
    botLog(
      config.botId,
      'verbose',
      `Connection attempt skipped - isConnecting: ${stateManager.isConnecting()}, isShuttingDown: ${stateManager.isShuttingDown()}`,
    );
    return false;
  }

  // Check circuit breaker before attempting reconnection
  if (!shouldAttemptReconnection()) {
    return false;
  }

  return true;
}

/**
 * Cleans up existing XMPP connections and intervals.
 */
async function cleanupExistingConnections() {
  // Clean up any existing connections or intervals before reconnecting.
  if (stateManager.getXmppClient()) {
    try {
      await stateManager
        .getXmppClient()
        .stop()
        .catch(() => {});
    } catch (error) {
      botLog(
        config.botId,
        'warn',
        `Error stopping existing XMPP connection: ${error.message}`,
      );
    }
  }

  if (stateManager.getStanzaQueueIntervalId())
    clearInterval(stateManager.getStanzaQueueIntervalId());
  if (stateManager.getConnectionHealthCheckId())
    clearInterval(stateManager.getConnectionHealthCheckId());
  if (stateManager.getProcessWatchdogId())
    clearInterval(stateManager.getProcessWatchdogId());
}

/**
 * Fetches bot credentials and chat tokens required for XMPP authentication.
 */
async function fetchBotCredentials() {
  if (isStaging) {
    stateManager.setBotCredentials(config.staging.botCredentials);
    return;
  }

  // Fetch bot credentials with a new FACEIT oauth token
  try {
    const forceQuery = stateManager.shouldForceCredentialRefresh()
      ? '?force=1'
      : '';
    const credentials = await getRequest(
      `${apiConfig.baseUrl}/bots/${config.botId}/config${forceQuery}`,
    );
    stateManager.setBotCredentials(credentials);
    if (
      !stateManager.getBotCredentials() ||
      !stateManager.getBotCredentials().bot_token
    ) {
      botLog(
        config.botId,
        'warn',
        'Failed to fetch bot credentials or bot_token is missing',
      );
      throw new Error(
        'Failed to fetch fresh bot credentials or bot_token is missing.',
      );
    }
    // Credentials fetched successfully; reset force flag
    stateManager.setForceCredentialRefresh(false);
  } catch (error) {
    botLog(
      config.botId,
      'warn',
      `Failed to fetch bot credentials: ${error.message}`,
    );
    throw error;
  }

  // Fetch the chat token for the bot
  try {
    const chatTokenResponse = await postRequest(
      apiConfig.faceitAuthUrl,
      {},
      {
        headers: {
          Authorization: `Bearer ${stateManager.getBotCredentials().bot_token}`,
        },
      },
    );

    if (!chatTokenResponse?.token) {
      botLog(
        config.botId,
        'warn',
        'Failed to get chat token from FACEIT API - no token in response',
      );
      throw new Error('Failed to get fresh chatToken from FACEIT API.');
    }

    stateManager.getBotCredentials().chat_token = chatTokenResponse.token;
  } catch (error) {
    botLog(
      config.botId,
      'warn',
      `Failed to fetch chat token from FACEIT API: ${error.message}`,
    );
    throw error;
  }
}

/**
 * Creates and configures the XMPP client instance.
 */
function createXmppClient() {
  const xmppClient = client({
    service: xmppConfig.service,
    domain: xmppConfig.domain,
    username: stateManager.getBotCredentials().bot_guid,
    password: stateManager.getBotCredentials().chat_token,
  });

  xmppClient.streamManagement.enabled = false;

  if (isVerboseLoggingEnabled) {
    debug(xmppClient, true);
  }

  // Store in state manager
  stateManager.setXmppClient(xmppClient);

  // Respond to server keep-alive pings (XEP-0199) - MUST handle manually
  xmppClient.iqCallee.get('urn:xmpp:ping', 'ping', (ctx) => {
    botLog(
      config.botId,
      'log',
      `Received server ping ${ctx.stanza.attrs.id} - responding immediately`,
    );

    // Update last server ping time for connection health monitoring
    stateManager.updateLastServerPingTime();

    return {
      xmlns: 'jabber:client',
      id: ctx.stanza.attrs.id,
      to: ctx.stanza.attrs.from,
      type: 'result',
    };
  });
}

/**
 * Handles XMPP error events and implements appropriate recovery strategies.
 * @param {Error} err - The XMPP error object
 */
function handleXmppError(err) {
  botLog(config.botId, 'error', `XMPP Error: ${err.toString()}`);

  // Handle different error types with appropriate responses
  if (err.condition === 'not-authorized') {
    botLog(
      config.botId,
      'log',
      "'not-authorized' error detected. Token likely expired. Forcing reconnection to refresh token.",
    );

    // Force immediate reconnection for token revocation
    if (!stateManager.isReconnecting() && !stateManager.isShuttingDown()) {
      // Ensure the next credentials fetch forces a token refresh
      stateManager.setForceCredentialRefresh(true);
      // Clear any existing intervals
      clearInterval(stateManager.getStanzaQueueIntervalId());
      clearInterval(stateManager.getConnectionHealthCheckId());

      // Force stop and reconnect
      void (async () => {
        try {
          await stateManager.getXmppClient().stop();
        } catch {
          // Ignore stop errors
        } finally {
          stateManager.setConnecting(false);
          stateManager.setReconnecting(false); // Reset state
          stateManager.setBotJid(null);

          setTimeout(() => {
            if (!stateManager.isShuttingDown()) {
              // For auth errors, fetch fresh credentials with token refresh
              connectXmpp();
            }
          }, 1000);
        }
      })();
    }
  } else if (
    err.condition === 'remote-server-timeout' ||
    err.condition === 'connection-timeout' ||
    err.condition === 'system-shutdown'
  ) {
    botLog(
      config.botId,
      'log',
      `Connection timeout/system shutdown detected (${err.condition}). Will reconnect.`,
    );
    // Let the offline handler manage reconnection for these errors
  } else {
    botLog(
      config.botId,
      'warn',
      `Unhandled XMPP error condition: ${err.condition}. Will attempt reconnection.`,
    );
  }
}

/**
 * Handles XMPP offline events and manages reconnection logic.
 */
function handleXmppOffline() {
  stateManager.setConnecting(false);
  stateManager.setReconnecting(false); // Reset reconnection flag when offline event fires
  stateManager.setBotJid(null);

  // Clear any existing intervals to prevent conflicts
  clearInterval(stateManager.getStanzaQueueIntervalId());
  clearInterval(stateManager.getConnectionHealthCheckId());
  // Clear process watchdog if it was running
  clearInterval(stateManager.getProcessWatchdogId());

  if (!stateManager.isShuttingDown()) {
    botLog(
      config.botId,
      'log',
      'XMPP client is offline. Scheduling reconnect...',
    );

    // Schedule reconnect with delay, but respect circuit breaker and backoff
    setTimeout(() => {
      if (!stateManager.isShuttingDown()) {
        connectXmpp();
      }
    }, config.timing.reconnectDelay);
  } else {
    botLog(
      config.botId,
      'log',
      'XMPP client is offline and shutdown is in progress.',
    );
  }
}

/**
 * Handles XMPP online events and initializes connection services.
 * @param {Object} address - The XMPP address object
 */
async function handleXmppOnline(address) {
  stateManager.setConnecting(false);
  stateManager.setReconnecting(false);
  stateManager.setBotJid(address.toString());
  stateManager.updateLastActivityTime();

  // Reset reconnection state since connection was successful
  resetReconnectionState();

  botLog(
    config.botId,
    'log',
    `XMPP client online as ${stateManager.getBotJid()}`,
  );

  // Start stanza queue processing
  stateManager.setStanzaQueueIntervalId(
    setInterval(processStanzaQueue, config.timing.stanzaQueueInterval),
  );

  // Start connection health monitoring
  stateManager.setConnectionHealthCheckId(
    setInterval(
      () => healthMonitor.checkConnectionHealth(),
      config.timing.connectionHealthCheckInterval,
    ),
  );

  // Start process-level watchdog - only exit if fundamentally broken
  const processStartTime = Date.now();
  stateManager.setProcessWatchdogId(
    setInterval(() => {
      const now = Date.now();
      const timeSinceLastPing = now - stateManager.getLastServerPingTime();
      const timeSinceProcessStart = now - processStartTime;
      const processWatchdogThreshold = 10 * 60 * 1000; // 10 minutes

      // Perform periodic memory cleanup every hour
      if (timeSinceProcessStart % (60 * 60 * 1000) < 60000) {
        // Every hour (with 1-minute tolerance)
        const cleanedEntries = stateManager.performMemoryCleanup();
        if (cleanedEntries > 0) {
          botLog(
            config.botId,
            'log',
            `Periodic maintenance: Cleaned ${cleanedEntries} orphaned entries`,
          );
        }
      }

      // Only exit if fundamentally broken (no server pings for 10+ minutes)
      // Let cron handle scheduled restarts for maintenance
      if (
        timeSinceLastPing > processWatchdogThreshold &&
        !stateManager.isShuttingDown()
      ) {
        botLog(
          config.botId,
          'error',
          `Process watchdog: No server ping for ${Math.round(timeSinceLastPing / 1000)}s. Process runtime: ${Math.round(timeSinceProcessStart / 1000)}s. Process appears fundamentally broken. Exiting to allow restart.`,
        );

        // Clean shutdown
        setTimeout(() => {
          process.exit(1);
        }, 1000);
      }
    }, 60000),
  ); // Check every minute

  // Ensure the bot announces availability globally so it appears online
  try {
    queueStanza(xmppActions.setPresence());
    if (isVerboseLoggingEnabled) {
      botLog(config.botId, 'verbose', 'Queued initial presence (available)');
    }
  } catch (err) {
    botLog(
      config.botId,
      'warn',
      `Failed to queue initial presence: ${err.message}`,
    );
  }

  // Join rooms for assigned entities
  await scheduleEntityUpdates();
}

/**
 * Sets up all XMPP event handlers for the client.
 */
function setupXmppEventHandlers() {
  // --- XMPP Event Handlers ---

  stateManager.getXmppClient().on('error', handleXmppError);
  stateManager.getXmppClient().on('offline', handleXmppOffline);
  stateManager.getXmppClient().on('online', handleXmppOnline);

  stateManager.getXmppClient().on('stanza', (stanza) => {
    stateManager.updateLastActivityTime();
    handleStanza(stanza);
  });
}

/**
 * Establishes and manages the connection to the XMPP service.
 * Handles authentication, event listeners, and automatic reconnection.
 */
async function connectXmpp() {
  // Perform pre-connection checks
  if (!performPreConnectionChecks()) {
    return;
  }

  stateManager.setConnecting(true);
  stateManager.setReconnecting(false); // Reset reconnection flag
  botLog(config.botId, 'log', 'Initiating XMPP connection...');

  // Record this reconnection attempt
  recordReconnectionAttempt();

  // Clean up existing connections
  await cleanupExistingConnections();

  try {
    // Fetch authentication credentials
    await fetchBotCredentials();

    // Create and configure XMPP client
    createXmppClient();

    // Set up event handlers
    setupXmppEventHandlers();

    // Start the connection
    await stateManager.getXmppClient().start();
  } catch (error) {
    stateManager.setConnecting(false);
    stateManager.setBotJid(null);
    botLog(config.botId, 'error', `Connection error: ${error.message}`);
    botLog(
      config.botId,
      'error',
      `Failed to initiate connection: ${error.message}. Waiting for offline event to trigger reconnect.`,
    );

    // Don't re-throw the error - let the circuit breaker handle reconnection attempts
    // The offline event will trigger a reconnection attempt with proper backoff
  }
}

// Make connectXmpp available globally for health monitor
global.connectXmpp = connectXmpp;

// Add event listener for forceReconnect events from health monitor
process.on('forceReconnect', () => {
  if (!stateManager.isShuttingDown() && !stateManager.isReconnecting()) {
    botLog(
      config.botId,
      'log',
      'Received forceReconnect event from health monitor',
    );
    connectXmpp();
  }
});

// --- STANZA HANDLING & MESSAGE PROCESSING ---

/**
 * The main entry point for all incoming XMPP stanzas.
 * @param {object} stanza - The raw XMPP stanza from the server.
 */
function handleStanza(stanza) {
  if (stateManager.isShuttingDown()) return;

  // Update activity time for any stanza received
  stateManager.updateLastActivityTime();

  // Handle IQ stanzas
  if (stanza.is('iq')) {
    if (
      stanza.attrs.type === 'get' &&
      stanza.getChild('ping', 'urn:xmpp:ping')
    ) {
      // ignore, handled in iqCallee up top.
      return; // Prevent duplicate error response for ping handling
    }

    // Handle FACEIT supergroup IQ responses
    if (stanza.attrs.type === 'result' || stanza.attrs.type === 'error') {
      handleSupergroupIQ(stanza);
      return;
    }

    // Handle any other IQ 'get' stanzas that might need responses
    if (stanza.attrs.type === 'get') {
      handleIQGet(stanza);
      return;
    }
  }

  if (stanza.is('message') && stanza.attrs.type === 'groupchat') {
    handleGroupChatMessage(stanza);
  } else if (stanza.is('presence')) {
    // Handle presence stanzas (user joins/leaves, status changes)
    if (isVerboseLoggingEnabled) {
      botLog(
        config.botId,
        'verbose',
        `Received presence stanza from ${stanza.attrs.from}: ${stanza.attrs.type || 'available'}`,
      );
    }
  } else {
    // Log any other unhandled stanza types for debugging
    if (isVerboseLoggingEnabled) {
      botLog(
        config.botId,
        'verbose',
        `Received unhandled stanza type '${stanza.name}' from ${stanza.attrs.from || 'server'}`,
      );
    }
  }
}

/**
 * Handles FACEIT supergroup IQ responses and errors.
 * @param {object} stanza - The IQ result or error stanza.
 */
function handleSupergroupIQ(stanza) {
  // Filter out online presence queries from Club chat - we don't need to process user lists
  const query = stanza.getChild('query');
  if (query && query.attrs.xmlns === 'faceit:supergroup:group:0') {
    return;
  }

  // Handle 404 errors by marking entities as inactive
  if (stanza.attrs.type === 'error') {
    // Use DebugHandler's 404 handler regardless of verbose mode
    debugHandler.handleVerboseError(stanza);
  }

  // Extended processing when verbose logging is enabled
  if (isVerboseLoggingEnabled) {
    debugHandler.handleVerboseSupergroupIQ(stanza, queueStanza);
    return;
  }

  // Non-verbose minimal success handling for MUC Light config
  if (stanza.attrs.type !== 'error') {
    if (query && query.attrs.xmlns === 'urn:xmpp:muclight:0#configuration') {
      const presenceGroup = query.getChildText('presence-group');
      if (presenceGroup) {
        // Store the subscription mapping
        stateManager.setSupergroupSubscription(
          stanza.attrs.from,
          presenceGroup,
        );

        // Subscribe to the supergroup for live message notifications
        const supergroupSubscription =
          xmppActions.createResubscribeStanza(presenceGroup);
        queueStanza(supergroupSubscription);
      }
    }
  }
}

/**
 * Handles IQ 'get' stanzas that might require responses.
 * @param {object} stanza - The IQ get stanza.
 */
function handleIQGet(stanza) {
  // Skip ping stanzas - they should be handled above
  if (stanza.getChild('ping', 'urn:xmpp:ping')) {
    botLog(
      config.botId,
      'warn',
      'Ping stanza reached handleIQGet - this should not happen!',
    );
    return;
  }

  // Log unhandled IQ stanzas for debugging
  const childElement = stanza.children[0];
  const namespace = childElement ? childElement.attrs.xmlns : 'unknown';

  if (isVerboseLoggingEnabled) {
    botLog(
      config.botId,
      'verbose',
      `Received unhandled IQ get with namespace: ${namespace} from ${stanza.attrs.from}`,
    );
  }

  // Send a generic error response for unhandled IQ gets to prevent stanza errors
  // id: stanza.attrs.id
  const errorResponse = xml(
    'iq',
    { to: stanza.attrs.from, type: 'error' },
    xml(
      'error',
      { type: 'cancel' },
      xml('feature-not-implemented', {
        xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas',
      }),
    ),
  );
  queueStanza(errorResponse);
}

async function handleGroupChatMessage(stanza) {
  stateManager.updateLastActivityTime(); // Update activity time on message reception

  // Process message validation and extraction
  const messageData = messageProcessor.validateMessage(stanza);
  if (!messageData) return;

  const { messageContent, roomJid, roomId, _messageAuthorGuid, _messageId } =
    messageData;

  // Check if message is from a valid entity
  if (!messageProcessor.isValidEntity(roomId, roomJid)) {
    return;
  }

  // Get room configuration
  const roomConfig = messageProcessor.getRoomConfig(roomId, roomJid);
  if (!roomConfig) {
    return;
  }

  // Process moderation (banned words, read-only mode)
  if (
    await moderation.processModeration(messageData, roomConfig, queueStanza)
  ) {
    return;
  }

  // Process timed messages
  timedMessages.processTimedMessages(roomId, roomConfig, queueStanza);

  // Process commands
  commands.processCommands(messageContent, roomId, roomConfig, queueStanza);
}

/**
 * Processes the outgoing stanza queue, sending one stanza at a time.
 */
function processStanzaQueue() {
  if (
    stateManager.getOutgoingStanzaQueueLength() > 0 &&
    stateManager.getXmppClient() &&
    stateManager.getXmppClient().status === 'online'
  ) {
    const stanza = stateManager.shiftFromOutgoingStanzaQueue();

    // Check if this stanza is for a non-existent entity and skip it
    const { to } = stanza.attrs;
    if (to) {
      const entityId = idManager.fromJid(to);

      // Skip stanzas for non-existent entities
      if (entityId && stateManager.hasNonExistentEntity(entityId)) {
        botLog(
          config.botId,
          'verbose',
          `Skipping stanza for non-existent entity: ${entityId}`,
        );
        return; // Skip this stanza and process the next one
      }
    }

    botLog(config.botId, 'verbose', `[OUT] ${stanza.toString()}`);
    stateManager
      .getXmppClient()
      .send(stanza)
      .catch((err) =>
        botLog(config.botId, 'error', `Failed to send stanza: ${err}`),
      );
  }
}

// --- API SERVICE & BACKGROUND TASKS ---

/**
 * Handles POST /update/:entityId - Updates entity data and profanity filter configuration.
 */
async function handleEntityUpdate(req, res) {
  res.sendStatus(200);
  try {
    const { entityId } = req.params;
    botLog(config.botId, 'verbose', `Received update for entity ${entityId}.`);
    const entityData = await getRequest(
      `${apiConfig.baseUrl}/entities/${entityId}/data`,
    );
    if (entityData) {
      // Store entity data using UUID as key
      stateManager.setEntity(entityId, entityData);

      // Update profanity filter configuration
      await configureEntityProfanityFilter(entityId);
    }
  } catch (error) {
    botLog(config.botId, 'error', `Error handling API update: ${error}`);
  }
}

/**
 * Handles POST /assign/:entityId - Assigns entity to bot and joins room.
 */
async function handleEntityAssignment(req, res) {
  res.sendStatus(200);
  try {
    const { entityId } = req.params;
    const { entityData } = req.body;

    botLog(config.botId, 'log', `Received assignment for entity ${entityId}.`);

    // Remove from recently unassigned entities set if it was there
    if (stateManager.hasRecentlyUnassignedEntity(entityId)) {
      stateManager.removeRecentlyUnassignedEntity(entityId);
      botLog(
        config.botId,
        'verbose',
        `Removed ${entityId} from recently unassigned entities set due to reassignment.`,
      );
    }

    // Remove from non-existent entities set if it was there (entity might have been recreated)
    if (stateManager.hasNonExistentEntity(entityId)) {
      stateManager.removeNonExistentEntity(entityId);
      botLog(
        config.botId,
        'verbose',
        `Removed ${entityId} from non-existent entities set due to reassignment.`,
      );
    }

    if (entityData) {
      // Store the new entity data
      stateManager.setEntity(entityId, entityData);

      // Configure profanity filter for new entity
      await configureEntityProfanityFilter(entityId);

      // Join the new room if XMPP is connected
      if (
        stateManager.getXmppClient() &&
        stateManager.getXmppClient().status === 'online'
      ) {
        joinRoomForEntity(entityId, null, context);
      } else {
        botLog(
          config.botId,
          'verbose',
          `XMPP not connected, will join room for entity ${entityId} when connection is established.`,
        );
      }
    } else {
      // Fallback: fetch entity data from API if not provided
      const fetchedEntityData = await getRequest(
        `${apiConfig.baseUrl}/entities/${entityId}/data`,
      );
      if (fetchedEntityData) {
        stateManager.setEntity(entityId, fetchedEntityData);

        // Configure profanity filter for fetched entity
        await configureEntityProfanityFilter(entityId);

        botLog(
          config.botId,
          'verbose',
          `Fetched and stored entity data for ${entityId}`,
        );
      }
    }
  } catch (error) {
    botLog(config.botId, 'error', `Error handling entity assignment: ${error}`);
  }
}

/**
 * Handles POST /unassign/:entityId - Unassigns entity from bot and leaves room.
 */
function handleEntityUnassignment(req, res) {
  res.sendStatus(200);
  try {
    const { entityId } = req.params;

    botLog(
      config.botId,
      'log',
      `Received unassignment for entity ${entityId}.`,
    );

    // Add to recently unassigned entities set
    stateManager.addRecentlyUnassignedEntity(entityId);

    // Clean up banned words for unassigned entity
    bannedWordsManager.cleanupEntity(entityId);

    // Clean up Discord webhook for unassigned entity
    discordWebhookManager.cleanupWebhook(entityId);

    // Clean up profanity filter config for unassigned entity
    profanityFilterConfigs.delete(entityId);

    stateManager.cleanupEntityData(entityId, {
      addToRecentlyUnassigned: true,
      addToNonExistent: false,
    });

    // Leave the room if XMPP is connected
    if (
      stateManager.getXmppClient() &&
      stateManager.getXmppClient().status === 'online'
    ) {
      botLog(
        config.botId,
        'verbose',
        `XMPP connected, leaving room for entity ${entityId}.`,
      );
      leaveRoomForEntity(entityId, context);
    } else {
      botLog(
        config.botId,
        'verbose',
        `XMPP not connected, will leave room for entity ${entityId} when connection is established.`,
      );
    }

    // Remove from recently unassigned entities after 5 minutes
    setTimeout(() => {
      stateManager.removeRecentlyUnassignedEntity(entityId);
      botLog(
        config.botId,
        'verbose',
        `Removed ${entityId} from recently unassigned entities set.`,
      );
    }, constants.timing.recentlyUnassignedCleanup);
  } catch (error) {
    botLog(
      config.botId,
      'error',
      `Error handling entity unassignment: ${error}`,
    );
  }
}

/**
 * Handles POST /refresh-preset/:presetId - Refreshes banned words preset.
 */
async function handlePresetRefresh(req, res) {
  res.sendStatus(200);
  try {
    const { presetId } = req.params;

    botLog(
      config.botId,
      'verbose',
      `Received request to refresh preset ${presetId}.`,
    );

    // Refresh the specific preset
    const refreshed = await bannedWordsManager.refreshPreset(presetId);

    if (refreshed) {
      botLog(config.botId, 'log', `Successfully refreshed preset ${presetId}.`);
    } else {
      botLog(
        config.botId,
        'verbose',
        `Preset ${presetId} not loaded, skipping refresh.`,
      );
    }
  } catch (error) {
    botLog(config.botId, 'error', `Error refreshing preset: ${error}`);
  }
}

/**
 * Handles GET /reconnection-state - Returns current reconnection and connection status.
 */
function handleReconnectionState(req, res) {
  try {
    const reconnectionState = getReconnectionState();
    res.json({
      success: true,
      reconnectionState,
      connectionStatus: {
        isOnline:
          stateManager.getXmppClient() &&
          stateManager.getXmppClient().status === 'online',
        isConnecting: stateManager.isConnecting(),
        isReconnecting: stateManager.isReconnecting(),
        isShuttingDown: stateManager.isShuttingDown(),
        botJid: stateManager.getBotJid(),
        lastServerPingTime: stateManager.getLastServerPingTime(),
        timeSinceLastPing: Date.now() - stateManager.getLastServerPingTime(),
      },
    });
  } catch (error) {
    botLog(config.botId, 'error', `Error getting reconnection state: ${error}`);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Handles POST /exit-process - Initiates graceful process exit.
 */
function handleProcessExit(req, res) {
  try {
    botLog(config.botId, 'log', 'Manual process exit requested via API');
    res.json({ success: true, message: 'Process exit initiated' });

    // Exit after response is sent
    setTimeout(() => {
      process.exit(1);
    }, 100);
  } catch (error) {
    botLog(config.botId, 'error', `Error exiting process: ${error}`);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Starts a small Express server to listen for real-time updates from the main database API.
 */
function startApiService() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Register route handlers
  app.post('/update/:entityId', handleEntityUpdate);
  app.post('/assign/:entityId', handleEntityAssignment);
  app.post('/unassign/:entityId', handleEntityUnassignment);
  app.post('/refresh-preset/:presetId', handlePresetRefresh);
  app.get('/reconnection-state', handleReconnectionState);
  app.post('/exit-process', handleProcessExit);

  const port = parseInt(config.botId, 10) + constants.bot.baseApiPort;
  stateManager.setApiServer(
    app.listen(port, () => {
      botLog(config.botId, 'log', `API service listening on port ${port}`);
    }),
  );
}

/**
 * Periodically fetches the full list of entities for the bot to check for new rooms to join.
 */
function scheduleEntityUpdates() {
  if (stateManager.getEntityUpdateTimeoutId())
    clearTimeout(stateManager.getEntityUpdateTimeoutId());

  stateManager.setEntityUpdateTimeoutId(
    setTimeout(async () => {
      if (stateManager.isShuttingDown()) return;

      try {
        const updatedEntities = await getRequest(
          `${apiConfig.baseUrl}/bots/${config.botId}/entities`,
        );
        if (updatedEntities) {
          // Check for new entities to join
          for (const [entityId, entity] of Object.entries(updatedEntities)) {
            if (
              !stateManager.hasEntity(entityId) &&
              !stateManager.hasNonExistentEntity(entityId)
            ) {
              botLog(
                config.botId,
                'verbose',
                `Found new entity, joining room for: ${entityId}`,
              );

              // Clean up entity tracking sets
              cleanupEntityTracking(entityId, config.botId);

              // Configure profanity filter for new entity
              await configureEntityProfanityFilter(entityId);

              // Use the complete room joining sequence
              joinRoomForEntity(entityId, entity, context);
            }
          }

          // Check for entities that should be removed (no longer in updatedEntities)
          for (const entityId of stateManager.getEntityKeys()) {
            if (
              !Object.prototype.hasOwnProperty.call(updatedEntities, entityId)
            ) {
              botLog(
                config.botId,
                'verbose',
                `Entity ${entityId} no longer assigned, removing from cache.`,
              );

              // Clean up banned words for removed entity
              bannedWordsManager.cleanupEntity(entityId);

              // Clean up Discord webhook for removed entity
              discordWebhookManager.cleanupWebhook(entityId);

              // Clean up profanity filter config for removed entity
              profanityFilterConfigs.delete(entityId);

              stateManager.cleanupEntityData(entityId, {
                addToRecentlyUnassigned: false,
                addToNonExistent: false,
              });

              // Leave the room if XMPP is connected
              leaveRoomIfConnected(entityId, stateManager, context);
            }
          }

          // Update existing entities with new data (but don't override removals)
          for (const [entityId, entityData] of Object.entries(
            updatedEntities,
          )) {
            stateManager.setEntity(entityId, entityData);
          }
        }
      } catch (error) {
        botLog(
          config.botId,
          'warn',
          `Failed to update entities: ${error.message}`,
        );
      }
      scheduleEntityUpdates(); // Schedule the next update.
    }, config.timing.entityUpdateInterval),
  );
}

// --- INITIALIZATION & SHUTDOWN ---

/**
 * The main entry point for the bot process.
 */
async function main() {
  try {
    botLog(config.botId, 'log', 'Starting bot...');

    // Fetch initial entities list - credentials will be fetched fresh in connectXmpp()
    if (isStaging) {
      // Convert staging entities object to Map
      stateManager.setEntitiesFromMap(config.staging.entities || {});
    } else {
      try {
        const entitiesResponse = await getRequest(
          `${apiConfig.baseUrl}/bots/${config.botId}/entities`,
        );
        if (!entitiesResponse) {
          botLog(
            config.botId,
            'warn',
            'Failed to fetch initial entities - empty response',
          );
          throw new Error('Failed to fetch initial entities.');
        }
        // Convert entities object to Map
        stateManager.setEntitiesFromMap(entitiesResponse);
      } catch (error) {
        botLog(
          config.botId,
          'warn',
          `Failed to fetch initial entities: ${error.message}`,
        );
        throw error;
      }
    }

    // Configure profanity filter for initial entities
    for (const [entityId, _entity] of stateManager.getAllEntities().entries()) {
      await configureEntityProfanityFilter(entityId);
    }

    startApiService();

    if (isStaging) {
      scheduleEntityUpdates();
    }

    await connectXmpp();
  } catch (error) {
    botLog(
      config.botId,
      'error',
      `FATAL: Initialization failed: ${error.message}`,
    );
    stateManager.incrementStartupRetryCount();

    // If we've exceeded startup retries, exit and let parent restart us
    if (stateManager.getStartupRetryCount() >= config.maxStartupRetries) {
      botLog(
        config.botId,
        'error',
        `Maximum startup retries (${config.maxStartupRetries}) reached. Exiting to allow parent restart.`,
      );
      // Exit with error code to signal restart needed
      process.exit(1);
    } else {
      const retryDelay = Math.min(
        config.timing.startupRetry *
          Math.pow(2, stateManager.getStartupRetryCount() - 1),
        5 * 60 * 1000, // Cap at 5 minutes
      );
      botLog(
        config.botId,
        'log',
        `Retrying in ${Math.round(retryDelay / 1000)} seconds... (Attempt ${stateManager.getStartupRetryCount()}/${config.maxStartupRetries})`,
      );
      setTimeout(main, retryDelay);
    }
  }
}

/**
 * Handles graceful shutdown of the bot process.
 * @param {string} signal - The shutdown signal received.
 */
async function shutdown(signal) {
  if (stateManager.isShuttingDown()) return;

  botLog(
    config.botId,
    'log',
    `Received ${signal}. Shutting down gracefully...`,
  );
  stateManager.setShuttingDown(true);

  // Stop all timers and intervals.
  clearTimeout(stateManager.getEntityUpdateTimeoutId());
  clearInterval(stateManager.getStanzaQueueIntervalId());
  clearInterval(stateManager.getConnectionHealthCheckId());
  clearInterval(stateManager.getProcessWatchdogId()); // Clear process watchdog interval

  // Clean up banned words manager
  for (const entityId of stateManager.getEntityKeys()) {
    bannedWordsManager.cleanupEntity(entityId);
  }

  // Clean up Discord webhook manager
  for (const entityId of stateManager.getEntityKeys()) {
    discordWebhookManager.cleanupWebhook(entityId);
  }

  // Clean up profanity filter configs
  profanityFilterConfigs.clear();

  // Close servers and connections.
  if (stateManager.getApiServer()) {
    stateManager
      .getApiServer()
      .close(() => botLog(config.botId, 'log', 'API server closed.'));
  }
  if (stateManager.getXmppClient()) {
    try {
      // XMPP stop can sometimes hang, so we race it against a timeout.
      const stopPromise = stateManager.getXmppClient().stop();
      const timeoutPromise = new Promise((_resolve, reject) =>
        setTimeout(
          () => reject(new Error('XMPP stop operation timed out')),
          constants.timing.xmppStopTimeout,
        ),
      );
      await Promise.race([stopPromise, timeoutPromise]);
      botLog(config.botId, 'log', 'XMPP client stopped.');
    } catch (err) {
      botLog(
        config.botId,
        'error',
        `Error stopping XMPP client: ${err.message}`,
      );
    }
  }

  botLog(
    config.botId,
    'log',
    `Waiting ${config.timing.shutdownGracePeriod / 1000} seconds before exiting.`,
  );
  setTimeout(() => {
    botLog(config.botId, 'log', 'Exiting process.');
    process.exit(0);
  }, config.timing.shutdownGracePeriod);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main();

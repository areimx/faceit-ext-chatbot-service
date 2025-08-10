/**
 * @file state-manager.js
 * Centralized state management for bot worker processes.
 */

const { botLog } = require('../lib/utils');

class StateManager {
  constructor(config) {
    this.config = config;

    this._state = {
      // XMPP connection state
      xmpp: null,
      botCredentials: null,
      botJid: null,
      isConnecting: false,
      isShuttingDown: false,
      isReconnecting: false,
      lastActivityTime: Date.now(),

      // Reconnection management
      reconnectionAttempts: 0,
      lastReconnectionTime: 0,
      reconnectionBackoffMs: 5000,
      startupRetryCount: 0,

      // API server instance
      apiServer: null,

      // Entity management
      entities: new Map(),
      messageCounts: new Map(),
      autoMessageTurn: new Map(),
      supergroupSubscriptions: new Map(),
      recentlyUnassignedEntities: new Set(),
      nonExistentEntities: new Set(),

      // Message processing
      outgoingStanzaQueue: [],

      // Timing and health tracking
      lastServerPingTime: Date.now(),
      entityUpdateTimeoutId: null,
      stanzaQueueIntervalId: null,
      connectionHealthCheckId: null,

      // Authentication
      forceCredentialRefresh: false,

      // Process watchdog
      processWatchdogId: null,
    };

    // State change listeners for real-time updates
    this._listeners = new Map();

    // Statistics tracking
    this._stats = {
      entitiesCount: 0,
      messageCountsSize: 0,
      autoMessageTurnSize: 0,
      supergroupSubscriptionsSize: 0,
      memoryCleanupCount: 0,
    };
  }

  // --- CONNECTION STATE MANAGEMENT ---

  getXmppClient() {
    return this._state.xmpp;
  }

  setXmppClient(client) {
    this._state.xmpp = client;
    this._notifyListeners('xmpp:connection', {
      client,
      status: client?.status,
    });
  }

  getBotCredentials() {
    return this._state.botCredentials;
  }

  setBotCredentials(credentials) {
    this._state.botCredentials = credentials;
    this._notifyListeners('auth:credentials', { credentials });
  }

  getBotJid() {
    return this._state.botJid;
  }

  setBotJid(jid) {
    this._state.botJid = jid;
    this._notifyListeners('xmpp:jid', { jid });
  }

  isConnecting() {
    return this._state.isConnecting;
  }

  setConnecting(connecting) {
    if (this._state.isConnecting !== connecting) {
      this._state.isConnecting = connecting;
      this._notifyListeners('connection:state', { isConnecting: connecting });
    }
  }

  isShuttingDown() {
    return this._state.isShuttingDown;
  }

  setShuttingDown(shuttingDown) {
    if (this._state.isShuttingDown !== shuttingDown) {
      this._state.isShuttingDown = shuttingDown;
      this._notifyListeners('process:shutdown', {
        isShuttingDown: shuttingDown,
      });
    }
  }

  isReconnecting() {
    return this._state.isReconnecting;
  }

  setReconnecting(reconnecting) {
    if (this._state.isReconnecting !== reconnecting) {
      this._state.isReconnecting = reconnecting;
      this._notifyListeners('connection:reconnecting', {
        isReconnecting: reconnecting,
      });
    }
  }

  updateLastActivityTime() {
    this._state.lastActivityTime = Date.now();
  }

  getLastActivityTime() {
    return this._state.lastActivityTime;
  }

  // --- RECONNECTION MANAGEMENT ---

  getReconnectionAttempts() {
    return this._state.reconnectionAttempts;
  }

  incrementReconnectionAttempts() {
    this._state.reconnectionAttempts++;
    return this._state.reconnectionAttempts;
  }

  resetReconnectionAttempts() {
    this._state.reconnectionAttempts = 0;
  }

  getLastReconnectionTime() {
    return this._state.lastReconnectionTime;
  }

  setLastReconnectionTime(time = Date.now()) {
    this._state.lastReconnectionTime = time;
  }

  getReconnectionBackoffMs() {
    return this._state.reconnectionBackoffMs;
  }

  setReconnectionBackoffMs(ms) {
    this._state.reconnectionBackoffMs = ms;
  }

  getStartupRetryCount() {
    return this._state.startupRetryCount;
  }

  incrementStartupRetryCount() {
    this._state.startupRetryCount++;
    return this._state.startupRetryCount;
  }

  resetStartupRetryCount() {
    this._state.startupRetryCount = 0;
  }

  // --- API SERVER MANAGEMENT ---

  getApiServer() {
    return this._state.apiServer;
  }

  setApiServer(server) {
    this._state.apiServer = server;
  }

  // --- ENTITY MANAGEMENT ---

  hasEntity(entityId) {
    return this._state.entities.has(entityId);
  }

  getEntity(entityId) {
    return this._state.entities.get(entityId);
  }

  setEntity(entityId, entityData) {
    const wasNew = !this._state.entities.has(entityId);
    this._state.entities.set(entityId, entityData);

    if (wasNew) {
      this._stats.entitiesCount++;
    }

    this._notifyListeners('entity:updated', { entityId, entityData, wasNew });

    botLog(
      this.config.botId,
      'verbose',
      `StateManager: ${wasNew ? 'Added' : 'Updated'} entity ${entityId}`,
    );
  }

  removeEntity(entityId) {
    const existed = this._state.entities.has(entityId);
    if (existed) {
      const entityData = this._state.entities.get(entityId);
      this._state.entities.delete(entityId);
      this._stats.entitiesCount--;

      // Clean up related data
      this.removeMessageCount(entityId);
      this.removeAutoMessageTurn(entityId);

      this._notifyListeners('entity:removed', { entityId, entityData });

      botLog(
        this.config.botId,
        'verbose',
        `StateManager: Removed entity ${entityId}`,
      );
    }
    return existed;
  }

  getAllEntities() {
    return new Map(this._state.entities);
  }

  getEntityKeys() {
    return Array.from(this._state.entities.keys());
  }

  clearAllEntities() {
    const count = this._state.entities.size;
    this._state.entities.clear();
    this._state.messageCounts.clear();
    this._state.autoMessageTurn.clear();
    this._stats.entitiesCount = 0;
    this._stats.messageCountsSize = 0;
    this._stats.autoMessageTurnSize = 0;

    this._notifyListeners('entities:cleared', { count });

    botLog(
      this.config.botId,
      'log',
      `StateManager: Cleared ${count} entities and related data`,
    );
  }

  // --- MESSAGE COUNT MANAGEMENT ---

  getMessageCount(roomId) {
    return this._state.messageCounts.get(roomId) || 0;
  }

  setMessageCount(roomId, count) {
    const wasNew = !this._state.messageCounts.has(roomId);
    this._state.messageCounts.set(roomId, count);

    if (wasNew) {
      this._stats.messageCountsSize++;
    }

    this._notifyListeners('message:count', { roomId, count, wasNew });
  }

  incrementMessageCount(roomId) {
    const current = this.getMessageCount(roomId);
    const newCount = current + 1;
    this.setMessageCount(roomId, newCount);
    return newCount;
  }

  resetMessageCount(roomId) {
    this.setMessageCount(roomId, 0);
  }

  removeMessageCount(roomId) {
    const existed = this._state.messageCounts.has(roomId);
    if (existed) {
      this._state.messageCounts.delete(roomId);
      this._stats.messageCountsSize--;
    }
    return existed;
  }

  // --- AUTO MESSAGE TURN MANAGEMENT ---

  getAutoMessageTurn(roomId) {
    return this._state.autoMessageTurn.get(roomId) || 0;
  }

  setAutoMessageTurn(roomId, turn) {
    const wasNew = !this._state.autoMessageTurn.has(roomId);
    this._state.autoMessageTurn.set(roomId, turn);

    if (wasNew) {
      this._stats.autoMessageTurnSize++;
    }

    this._notifyListeners('message:turn', { roomId, turn, wasNew });
  }

  incrementAutoMessageTurn(roomId, maxTurn) {
    const current = this.getAutoMessageTurn(roomId);
    const newTurn = (current + 1) % maxTurn;
    this.setAutoMessageTurn(roomId, newTurn);
    return newTurn;
  }

  resetAutoMessageTurn(roomId) {
    this.setAutoMessageTurn(roomId, 0);
  }

  removeAutoMessageTurn(roomId) {
    const existed = this._state.autoMessageTurn.has(roomId);
    if (existed) {
      this._state.autoMessageTurn.delete(roomId);
      this._stats.autoMessageTurnSize--;
    }
    return existed;
  }

  // --- SUPERGROUP SUBSCRIPTION MANAGEMENT ---

  getSupergroupSubscription(roomJid) {
    return this._state.supergroupSubscriptions.get(roomJid);
  }

  setSupergroupSubscription(roomJid, presenceGroup) {
    const wasNew = !this._state.supergroupSubscriptions.has(roomJid);
    this._state.supergroupSubscriptions.set(roomJid, presenceGroup);

    if (wasNew) {
      this._stats.supergroupSubscriptionsSize++;
    }

    this._notifyListeners('supergroup:subscription', {
      roomJid,
      presenceGroup,
      wasNew,
    });
  }

  removeSupergroupSubscription(roomJid) {
    const existed = this._state.supergroupSubscriptions.has(roomJid);
    if (existed) {
      this._state.supergroupSubscriptions.delete(roomJid);
      this._stats.supergroupSubscriptionsSize--;
    }
    return existed;
  }

  getAllSupergroupSubscriptions() {
    return new Map(this._state.supergroupSubscriptions);
  }

  // --- ENTITY SET MANAGEMENT ---

  addRecentlyUnassignedEntity(entityId) {
    this._state.recentlyUnassignedEntities.add(entityId);
    this._notifyListeners('entity:unassigned', { entityId });
  }

  hasRecentlyUnassignedEntity(entityId) {
    return this._state.recentlyUnassignedEntities.has(entityId);
  }

  removeRecentlyUnassignedEntity(entityId) {
    return this._state.recentlyUnassignedEntities.delete(entityId);
  }

  clearRecentlyUnassignedEntities() {
    const count = this._state.recentlyUnassignedEntities.size;
    this._state.recentlyUnassignedEntities.clear();
    return count;
  }

  addNonExistentEntity(entityId) {
    this._state.nonExistentEntities.add(entityId);
    this._notifyListeners('entity:nonexistent', { entityId });
  }

  hasNonExistentEntity(entityId) {
    return this._state.nonExistentEntities.has(entityId);
  }

  removeNonExistentEntity(entityId) {
    return this._state.nonExistentEntities.delete(entityId);
  }

  clearNonExistentEntities() {
    const count = this._state.nonExistentEntities.size;
    this._state.nonExistentEntities.clear();
    return count;
  }

  // --- MESSAGE QUEUE MANAGEMENT ---

  getOutgoingStanzaQueue() {
    return [...this._state.outgoingStanzaQueue];
  }

  addToOutgoingStanzaQueue(stanza) {
    this._state.outgoingStanzaQueue.push(stanza);
    this._notifyListeners('queue:stanza', {
      stanza,
      queueLength: this._state.outgoingStanzaQueue.length,
    });
  }

  clearOutgoingStanzaQueue() {
    const count = this._state.outgoingStanzaQueue.length;
    this._state.outgoingStanzaQueue = [];
    return count;
  }

  shiftFromOutgoingStanzaQueue() {
    return this._state.outgoingStanzaQueue.shift();
  }

  getOutgoingStanzaQueueLength() {
    return this._state.outgoingStanzaQueue.length;
  }

  // --- TIMING AND HEALTH TRACKING ---

  getLastServerPingTime() {
    return this._state.lastServerPingTime;
  }

  updateLastServerPingTime() {
    this._state.lastServerPingTime = Date.now();
    this._notifyListeners('health:ping', {
      time: this._state.lastServerPingTime,
    });
  }

  getEntityUpdateTimeoutId() {
    return this._state.entityUpdateTimeoutId;
  }

  setEntityUpdateTimeoutId(id) {
    this._state.entityUpdateTimeoutId = id;
  }

  getStanzaQueueIntervalId() {
    return this._state.stanzaQueueIntervalId;
  }

  setStanzaQueueIntervalId(id) {
    this._state.stanzaQueueIntervalId = id;
  }

  getConnectionHealthCheckId() {
    return this._state.connectionHealthCheckId;
  }

  setConnectionHealthCheckId(id) {
    this._state.connectionHealthCheckId = id;
  }

  // --- AUTHENTICATION ---

  shouldForceCredentialRefresh() {
    return this._state.forceCredentialRefresh;
  }

  setForceCredentialRefresh(force) {
    this._state.forceCredentialRefresh = force;
    this._notifyListeners('auth:refresh', { force });
  }

  // --- PROCESS WATCHDOG ---

  getProcessWatchdogId() {
    return this._state.processWatchdogId;
  }

  setProcessWatchdogId(id) {
    this._state.processWatchdogId = id;
  }

  // --- REAL-TIME UPDATES ---

  /**
   * Subscribe to state changes for real-time updates
   * @param {string} event - Event type to listen to
   * @param {function} callback - Callback function
   */
  onStateChange(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push(callback);
  }

  /**
   * Unsubscribe from state changes
   * @param {string} event - Event type
   * @param {function} callback - Callback function to remove
   */
  offStateChange(event, callback) {
    if (this._listeners.has(event)) {
      const callbacks = this._listeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * Notify listeners of state changes
   * @private
   */
  _notifyListeners(event, data) {
    if (this._listeners.has(event)) {
      const callbacks = this._listeners.get(event);
      callbacks.forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          botLog(
            this.config.botId,
            'error',
            `StateManager: Error in state change listener for ${event}: ${error.message}`,
          );
        }
      });
    }
  }

  // --- MEMORY MANAGEMENT ---

  performMemoryCleanup() {
    let cleaned = 0;

    // Clean up message counts for non-existent entities
    for (const roomId of this._state.messageCounts.keys()) {
      if (!this._state.entities.has(roomId)) {
        this._state.messageCounts.delete(roomId);
        this._stats.messageCountsSize--;
        cleaned++;
      }
    }

    // Clean up auto message turns for non-existent entities
    for (const roomId of this._state.autoMessageTurn.keys()) {
      if (!this._state.entities.has(roomId)) {
        this._state.autoMessageTurn.delete(roomId);
        this._stats.autoMessageTurnSize--;
        cleaned++;
      }
    }

    this._stats.memoryCleanupCount++;

    if (cleaned > 0) {
      botLog(
        this.config.botId,
        'verbose',
        `StateManager: Memory cleanup completed, removed ${cleaned} orphaned entries`,
      );
    }

    return cleaned;
  }

  // --- STATISTICS AND DEBUGGING ---

  getStatistics() {
    return {
      ...this._stats,
      entitiesCount: this._state.entities.size,
      messageCountsSize: this._state.messageCounts.size,
      autoMessageTurnSize: this._state.autoMessageTurn.size,
      supergroupSubscriptionsSize: this._state.supergroupSubscriptions.size,
      recentlyUnassignedSize: this._state.recentlyUnassignedEntities.size,
      nonExistentEntitiesSize: this._state.nonExistentEntities.size,
      outgoingStanzaQueueLength: this._state.outgoingStanzaQueue.length,
      listenersCount: this._listeners.size,
    };
  }

  getDebugSnapshot() {
    return {
      connectionState: {
        isConnecting: this._state.isConnecting,
        isShuttingDown: this._state.isShuttingDown,
        isReconnecting: this._state.isReconnecting,
        botJid: this._state.botJid,
        lastActivityTime: this._state.lastActivityTime,
        lastServerPingTime: this._state.lastServerPingTime,
      },
      entities: Array.from(this._state.entities.keys()),
      messageCounts: Object.fromEntries(this._state.messageCounts),
      autoMessageTurn: Object.fromEntries(this._state.autoMessageTurn),
      supergroupSubscriptions: Object.fromEntries(
        this._state.supergroupSubscriptions,
      ),
      recentlyUnassignedEntities: Array.from(
        this._state.recentlyUnassignedEntities,
      ),
      nonExistentEntities: Array.from(this._state.nonExistentEntities),
      statistics: this.getStatistics(),
    };
  }

  // --- BULK OPERATIONS ---

  /**
   * Bulk set entities from object/Map
   */
  setEntitiesFromMap(entitiesMap) {
    if (entitiesMap instanceof Map) {
      this._state.entities = new Map(entitiesMap);
    } else if (typeof entitiesMap === 'object') {
      this._state.entities = new Map(Object.entries(entitiesMap));
    }
    this._stats.entitiesCount = this._state.entities.size;
    this._notifyListeners('entities:bulk_update', {
      count: this._state.entities.size,
    });
  }
}

module.exports = StateManager;

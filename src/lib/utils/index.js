/**
 * @file utils.js
 * Shared utility functions
 */

// Log levels for production filtering
const LOG_LEVELS = new Map([
  ['error', 0],
  ['warn', 1],
  ['log', 2],
  ['verbose', 3],
]);

/**
 * Logger utility
 * @param {string} botId - The bot ID for prefixing messages
 * @param {string} level - Log level (log, warn, error, verbose)
 * @param {string} message - Log message
 * @param {object} data - Optional data to include
 */
function botLog(botId, level, message, data = null) {
  const logMessage = `Bot ${botId}: ${message}`;

  const { isStaging, isVerboseLoggingEnabled } = require('../../config');

  const currentLevel = isVerboseLoggingEnabled
    ? 'verbose'
    : isStaging
      ? 'log'
      : 'warn';
  const threshold = LOG_LEVELS.get(currentLevel) || LOG_LEVELS.get('verbose');

  if (LOG_LEVELS.get(level) > threshold) {
    return;
  }

  switch (level) {
    case 'error':
      console.error(logMessage, data || '');
      break;
    case 'warn':
      console.warn(logMessage, data || '');
      break;
    default:
      console.log(logMessage, data || '');
      break;
  }
}

/**
 * Sleep utility for async operations
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} Promise that resolves after the specified time
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Truncate a string to a maximum length, appending ... when needed
 * @param {string} text - The input string
 * @param {number} maxLength - Maximum allowed length
 * @returns {string} Truncated string
 */
function truncateString(text, maxLength) {
  if (typeof text !== 'string' || typeof maxLength !== 'number') {
    return text;
  }
  if (text.length <= maxLength) {
    return text;
  }
  if (maxLength <= 3) {
    return text.substring(0, Math.max(0, maxLength));
  }
  return `${text.substring(0, maxLength - 3)}...`;
}

/**
 * Cleans up entity data from all tracking objects
 * @param {string} entityId - The entity ID to clean up
 * @param {object} caches - Object containing all cache references
 * @param {Map} caches.entities - The entities cache Map
 * @param {Map} caches.messageCounts - The message counts Map
 * @param {Map} caches.autoMessageTurn - The auto message turn Map
 * @param {Map} caches.supergroupSubscriptions - The supergroup subscriptions map
 * @param {Set} caches.recentlyUnassignedEntities - Set of recently unassigned entities
 * @param {Set} caches.nonExistentEntities - Set of non-existent entities
 * @param {object} options - Optional cleanup configuration
 * @param {string} options.botId - The bot ID for logging
 * @param {string} options.mucDomain - The MUC domain for room JID construction
 * @param {boolean} options.addToRecentlyUnassigned - Whether to add to recently unassigned set
 * @param {boolean} options.addToNonExistent - Whether to add to non-existent set
 */
function cleanupEntityData(entityId, caches, options = {}) {
  const {
    entities,
    messageCounts,
    autoMessageTurn,
    supergroupSubscriptions,
    recentlyUnassignedEntities,
    nonExistentEntities,
  } = caches;

  const { addToRecentlyUnassigned = false, addToNonExistent = false } = options;

  // Remove from entities cache
  entities.delete(entityId);

  // Clean up message counts
  messageCounts.delete(entityId);

  // Clean up auto message turn
  autoMessageTurn.delete(entityId);

  // Clean up supergroup subscriptions
  supergroupSubscriptions.delete(entityId);

  // Add to recently unassigned entities set if requested
  if (addToRecentlyUnassigned) {
    recentlyUnassignedEntities.add(entityId);
  }

  // Add to non-existent entities set if requested
  if (addToNonExistent) {
    nonExistentEntities.add(entityId);
  }
}

/**
 * Unified ID management system for entity IDs across the application.
 * Standardizes entity ID handling and format conversion.
 */
const idManager = {
  /**
   * Converts any entity ID format to a standardized UUID format.
   * @param {string} id - Entity ID in any format (JID, UUID, etc.)
   * @returns {string} - Standardized UUID
   */
  normalizeId(id) {
    if (!id) return null;

    // If it's already a clean UUID, return as is
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ) {
      return id;
    }

    // Extract the last UUID from the string (covers JID formats including channel-<uuid>)
    const uuidMatches = id.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    );
    if (uuidMatches && uuidMatches.length > 0) {
      return uuidMatches[uuidMatches.length - 1];
    }

    return id;
  },

  /**
   * Compute MUC Light room JID for an entity.
   * - community: club-<communityGuid>-general@muclight...
   * - chat: club-<parentGuid>-channel-<chatGuid>@muclight...
   * - ihl: club-<parentGuid>-channel-<ihlGuid>@muclight...
   */
  toMucLightJidForEntity(entity, xmppConfig) {
    const type = (entity?.type || 'community').toLowerCase();
    const parentGuid = entity?.parent_guid || entity?.permissions?.parent_guid;
    const guid = entity?.guid || this.normalizeId(entity);

    if (type === 'community') {
      return `club-${guid}-general@${xmppConfig.mucDomain}`;
    }
    if ((type === 'chat' || type === 'ihl') && parentGuid) {
      return `club-${parentGuid}-channel-${guid}@${xmppConfig.mucDomain}`;
    }
    // Fallback: use original format if no UUID detected
    return `club-${guid}-general@${xmppConfig.mucDomain}`;
  },

  /**
   * Compute Supergroup base JID for an entity (without presence group suffix).
   * - community: club-<communityGuid>@supergroups...
   * - chat/ihl: club-<parentGuid>@supergroups...
   */
  toSupergroupBaseJidForEntity(entity, xmppConfig) {
    const type = (entity?.type || 'community').toLowerCase();
    const parentGuid = entity?.parent_guid || entity?.permissions?.parent_guid;
    const guid = entity?.guid || this.normalizeId(entity);

    const baseGuid = type === 'community' || !parentGuid ? guid : parentGuid;
    return `club-${baseGuid}@${xmppConfig.supergroupDomain}`;
  },

  /**
   * Return the supergroup presence-group target for subscription operations.
   * - community: base + /general
   * - chat/ihl: base + /channel-<guid>
   */
  toSupergroupPresenceGroupForEntity(entity, xmppConfig) {
    const type = (entity?.type || 'community').toLowerCase();
    const guid = entity?.guid || this.normalizeId(entity);
    const base = this.toSupergroupBaseJidForEntity(entity, xmppConfig);
    if (type === 'community') return `${base}/general`;
    return `${base}/channel-${guid}`;
  },

  /**
   * Extracts standardized UUID from any JID format.
   * @param {string} jid - Any JID format
   * @returns {string} - Standardized UUID
   */
  fromJid(jid) {
    return this.normalizeId(jid);
  },
};

module.exports = {
  botLog,
  sleep,
  truncateString,
  cleanupEntityData,
  idManager,
};

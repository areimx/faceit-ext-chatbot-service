/**
 * @file xmpp-utils.js
 * XMPP-specific utility functions used
 */

const { botLog, idManager } = require('../utils');

const xmppActions = require('./actions.js');

/**
 * Sends a stanza directly via XMPP with proper logging
 * @param {object} xmpp - The XMPP client instance
 * @param {object} stanza - The stanza to send
 * @param {string} botId - The bot ID for logging
 * @param {string} description - Optional description for logging
 */
function sendStanzaDirectly(xmpp, stanza, botId, description = '') {
  if (!xmpp || xmpp.status !== 'online') {
    botLog(
      botId,
      'error',
      `Cannot send stanza - XMPP client offline${description ? ` (${description})` : ''}`,
    );
    return Promise.reject(new Error('XMPP client offline'));
  }

  return xmpp.send(stanza).catch((err) => {
    botLog(
      botId,
      'error',
      `Failed to send stanza${description ? ` (${description})` : ''}: ${err}`,
    );
    throw err;
  });
}

/**
 * Refreshes all active supergroup subscriptions using unsubscribe/resubscribe cycle
 * This mimics the frontend behavior and helps maintain live message reception
 * @param {Map} supergroupSubscriptions - The supergroup subscriptions map
 * @param {function} queueStanza - Function to queue stanzas
 * @param {string} botId - The bot ID for logging
 * @param {function} updateLastMessageTime - Function to update last message time
 */
function refreshSupergroupSubscriptions(
  supergroupSubscriptions,
  queueStanza,
  botId,
  updateLastMessageTime,
) {
  if (supergroupSubscriptions.size === 0) {
    botLog(botId, 'log', 'No supergroup subscriptions to refresh');
    return;
  }

  botLog(
    botId,
    'verbose',
    `Refreshing ${supergroupSubscriptions.size} supergroup subscriptions...`,
  );

  for (const [roomJid, presenceGroup] of supergroupSubscriptions.entries()) {
    // Step 1: Unsubscribe (like frontend does) - WITH xmlns="jabber:client"
    const unsubscribeStanza =
      xmppActions.createUnsubscribeStanza(presenceGroup);
    queueStanza(unsubscribeStanza);

    // Step 2: Resubscribe (like frontend does) - queue immediately after unsubscribe - WITH xmlns="jabber:client"
    const resubscribeStanza =
      xmppActions.createResubscribeStanza(presenceGroup);
    queueStanza(resubscribeStanza);

    botLog(
      botId,
      'verbose',
      `Queued subscription refresh for ${presenceGroup} (room: ${roomJid})`,
    );
  }

  // Reset the last message time to give the refresh a chance to work
  if (updateLastMessageTime) {
    updateLastMessageTime();
  }
  botLog(
    botId,
    'verbose',
    'Supergroup subscription refresh completed - monitoring for live message recovery',
  );
}

/**
 * Joins a room for a specific entity.
 * @param {string} entityId - The entity ID to join.
 * @param {object} entity - Optional entity data.
 * @param {object} context - The bot context object containing stateManager, config, etc.
 */
function joinRoomForEntity(entityId, entity, context) {
  const { stateManager, config, queueStanza } = context;

  // Skip if entity is known to not exist
  if (stateManager.hasNonExistentEntity(entityId)) {
    botLog(
      config.botId,
      'verbose',
      `Skipping join for non-existent entity: ${entityId}`,
    );
    return;
  }

  const xmpp = stateManager.getXmppClient();
  if (!xmpp || xmpp.status !== 'online') {
    botLog(
      config.botId,
      'warn',
      `Cannot join entity ${entityId} - XMPP not connected`,
    );
    return;
  }

  const entityData = entity ||
    stateManager.getEntity(entityId) || { guid: entityId, type: 'community' };

  botLog(
    config.botId,
    'verbose',
    `Joining entity ${entityId} with entity_type=${(entityData.type || 'community').toLowerCase()}`,
  );

  // Use the entity-aware join room function from xmpp-actions
  const joinStanza = xmppActions.joinRoomEntity(entityData);
  queueStanza(joinStanza);

  botLog(
    config.botId,
    'verbose',
    `Sent join command for ${entityId}: MUC Light config`,
  );
}

/**
 * Leaves a room for a specific entity and cleans up subscriptions.
 * @param {string} entityId - The entity ID to leave.
 * @param {object} context - The bot context object containing stateManager, config, etc.
 */
function leaveRoomForEntity(entityId, context) {
  const { stateManager, config, xmppConfig, queueStanza } = context;

  const xmpp = stateManager.getXmppClient();
  if (!xmpp || xmpp.status !== 'online') {
    botLog(
      config.botId,
      'verbose',
      `XMPP not connected, will leave room for entity ${entityId} when connection is established.`,
    );
    return;
  }

  const entityData = stateManager.getEntity(entityId) || {
    guid: entityId,
    type: 'community',
  };

  botLog(config.botId, 'verbose', `Leaving entity: ${entityId}`);

  const roomJid = idManager.toMucLightJidForEntity(entityData, xmppConfig);

  // Remove from supergroup subscriptions tracking
  stateManager.removeSupergroupSubscription(roomJid);

  // Use the simplified leave room function from xmpp-actions
  const leaveStanza = xmppActions.leaveRoomSimpleEntity(entityData);
  queueStanza(leaveStanza);

  botLog(
    config.botId,
    'verbose',
    `Sent leave sequence for entity ${entityId} (supergroup unsubscribe)`,
  );
}

module.exports = {
  sendStanzaDirectly,
  refreshSupergroupSubscriptions,
  joinRoomForEntity,
  leaveRoomForEntity,
};

/**
 * @file xmpp-actions.js
 * XMPP actions module
 * Contains functions for building XMPP stanzas
 */

const xml = require('@xmpp/xml');
const { xmppConfig, constants } = require('../../config');
const { idManager } = require('../utils');

/**
 * Creates an unsubscribe stanza for supergroup subscriptions
 * @param {string} presenceGroup - The presence group JID to unsubscribe from
 * @returns {object} The unsubscribe stanza
 */
function createUnsubscribeStanza(presenceGroup) {
  return xml(
    'iq',
    {
      xmlns: 'jabber:client',
      type: 'set',
      to: presenceGroup,
    },
    xml(
      'query',
      { xmlns: 'faceit:supergroup:group:0' },
      xml('subscribe', { set: 'false' }),
    ),
  );
}

/**
 * Creates a resubscribe stanza for supergroup subscriptions
 * @param {string} presenceGroup - The presence group JID to resubscribe to
 * @returns {object} The resubscribe stanza
 */
function createResubscribeStanza(presenceGroup) {
  return xml(
    'iq',
    {
      xmlns: 'jabber:client',
      type: 'set',
      to: presenceGroup,
    },
    xml(
      'query',
      { xmlns: 'faceit:supergroup:group:0' },
      xml('subscribe', { set: 'true' }),
      xml(
        'set',
        { xmlns: 'http://jabber.org/protocol/rsm' },
        xml('max', {}, '1'), // Minimal subscription to reduce presence spam while maintaining message reception
        xml('index', {}, '0'),
      ),
    ),
  );
}

// Refresh supergroup subscription to maintain live message reception
function refreshSupergroupSubscriptionEntity(entity, _fullJid) {
  const supergroupBase = idManager.toSupergroupBaseJidForEntity(
    entity,
    xmppConfig,
  );

  return {
    // Re-subscribe to ensure continued message reception
    subscribe: xml(
      'iq',
      {
        to: supergroupBase,
        type: 'set',
      },
      xml(
        'query',
        { xmlns: 'faceit:supergroup:group:0' },
        xml('subscribe', { set: 'true' }),
        xml(
          'set',
          { xmlns: 'http://jabber.org/protocol/rsm' },
          xml('max', {}, constants.xmpp.maxSubscriptionMessages.toString()),
          xml('index', {}, '0'),
        ),
      ),
    ),

    // Send presence to maintain active status
    presence: xml('presence', { to: supergroupBase }),
  };
}

// Send a text message to a chat room
function sendMessage(entityOrRoomId, message, uploadId = null) {
  const roomJid =
    typeof entityOrRoomId === 'string'
      ? idManager.toMucLightJidForEntity(
          { guid: entityOrRoomId, type: 'community' },
          xmppConfig,
        )
      : idManager.toMucLightJidForEntity(entityOrRoomId, xmppConfig);

  const messageElements = [xml('body', {}, message)];

  // Add image attachment if uploadId is provided
  if (uploadId) {
    messageElements.push(
      xml('x', { xmlns: 'msg:upload:1' }, xml('img', { id: uploadId })),
    );
  }

  return xml(
    'message',
    {
      xmlns: 'jabber:client',
      to: roomJid,
      type: 'groupchat',
    },
    ...messageElements,
  );
}

// Respond to server ping
function respondToPing(from, pingId) {
  return xml('iq', {
    to: from,
    id: pingId,
    type: 'result',
  });
}

// Mute user in room
function muteUser(
  entityOrRoomId,
  userGuid,
  duration = constants.moderation.bannedWordMuteDuration,
) {
  const userJid = userGuid.includes('@')
    ? userGuid
    : `${userGuid}@${xmppConfig.domain}`;

  return xml(
    'iq',
    {
      to:
        typeof entityOrRoomId === 'string'
          ? idManager.toSupergroupBaseJidForEntity(
              { guid: entityOrRoomId, type: 'community' },
              xmppConfig,
            )
          : idManager.toSupergroupBaseJidForEntity(entityOrRoomId, xmppConfig),
      type: 'set',
    },
    xml(
      'mute',
      { xmlns: 'faceit:supergroup:moderation:0' },
      xml('user', { jid: userJid }),
      xml('duration', {}, duration.toString()),
      xml('reason', {}, 'Automated moderation'),
    ),
  );
}

// Unmute user in room
function unmuteUser(entityOrRoomId, userJid) {
  return xml(
    'iq',
    {
      to:
        typeof entityOrRoomId === 'string'
          ? idManager.toSupergroupBaseJidForEntity(
              { guid: entityOrRoomId, type: 'community' },
              xmppConfig,
            )
          : idManager.toSupergroupBaseJidForEntity(entityOrRoomId, xmppConfig),
      type: 'set',
    },
    xml(
      'unmute',
      { xmlns: 'faceit:supergroup:moderation:0' },
      xml('user', { jid: userJid }),
    ),
  );
}

// Delete message
function deleteMessage(entityOrRoomId, messageId) {
  const roomJid =
    typeof entityOrRoomId === 'string'
      ? idManager.toMucLightJidForEntity(
          { guid: entityOrRoomId, type: 'community' },
          xmppConfig,
        )
      : idManager.toMucLightJidForEntity(entityOrRoomId, xmppConfig);

  return xml(
    'iq',
    {
      to: roomJid,
      type: 'set',
    },
    xml(
      'delete',
      { xmlns: 'faceit:message:retract:0' },
      xml('message', { id: messageId }),
    ),
  );
}

// Pin message
function pinMessage(entityOrRoomId, messageId, messageText) {
  const entity =
    typeof entityOrRoomId === 'string'
      ? { guid: entityOrRoomId, type: 'community' }
      : entityOrRoomId;
  const groupName =
    (entity?.type || 'community').toLowerCase() === 'community'
      ? 'general'
      : `channel-${entity?.guid || idManager.normalizeId(entity)}`;

  return xml(
    'iq',
    {
      to: idManager.toSupergroupBaseJidForEntity(entity, xmppConfig),
      type: 'set',
    },
    xml(
      'pin',
      { xmlns: 'faceit:supergroup:pin:0' },
      xml('message', { id: messageId }),
      xml('text', {}, messageText),
      xml('group', {}, groupName),
    ),
  );
}

// Unpin message
function unpinMessage(entityOrRoomId, messageId) {
  const entity =
    typeof entityOrRoomId === 'string'
      ? { guid: entityOrRoomId, type: 'community' }
      : entityOrRoomId;
  const groupName =
    (entity?.type || 'community').toLowerCase() === 'community'
      ? 'general'
      : `channel-${entity?.guid || idManager.normalizeId(entity)}`;

  return xml(
    'iq',
    {
      to: idManager.toSupergroupBaseJidForEntity(entity, xmppConfig),
      type: 'set',
    },
    xml(
      'unpin',
      { xmlns: 'faceit:supergroup:pin:0' },
      xml('message', { id: messageId }),
      xml('group', {}, groupName),
    ),
  );
}

// Set presence
function setPresence(status = 'available', statusMessage = '') {
  const presenceStanza = xml('presence');

  if (status !== 'available') {
    presenceStanza.c('show', {}, status);
  }

  if (statusMessage) {
    presenceStanza.c('status', {}, statusMessage);
  }

  return presenceStanza;
}

// Leave room
function leaveRoomEntity(entity, botNickname) {
  const roomJid = idManager.toMucLightJidForEntity(entity, xmppConfig);
  const supergroupBase = idManager.toSupergroupBaseJidForEntity(
    entity,
    xmppConfig,
  );

  return {
    // Leave MUC Light room
    mucLeave: xml('presence', {
      to: `${roomJid}/${botNickname}`,
      type: 'unavailable',
    }),

    // Unsubscribe from supergroup
    unsubscribe: xml(
      'iq',
      {
        to: supergroupBase,
        type: 'set',
      },
      xml(
        'query',
        { xmlns: 'faceit:supergroup:group:0' },
        xml('subscribe', { set: 'false' }),
      ),
    ),
  };
}

// Room join using MUC Light configuration
function joinRoomEntity(entity) {
  const roomJid = idManager.toMucLightJidForEntity(entity, xmppConfig);

  return xml(
    'iq',
    {
      xmlns: 'jabber:client',
      type: 'get',
      to: roomJid,
    },
    xml('query', { xmlns: 'urn:xmpp:muclight:0#configuration' }),
  );
}

// Room leave via supergroup unsubscribe
function leaveRoomSimpleEntity(entity) {
  const presenceGroup = idManager.toSupergroupPresenceGroupForEntity(
    entity,
    xmppConfig,
  );

  return xml(
    'iq',
    {
      xmlns: 'jabber:client',
      type: 'set',
      to: presenceGroup,
    },
    xml(
      'query',
      {
        xmlns: 'faceit:supergroup:group:0',
      },
      xml('subscribe', { set: 'false' }),
    ),
  );
}

module.exports = {
  // Entity-aware variants
  refreshSupergroupSubscriptionEntity,
  sendMessage,
  respondToPing,
  muteUser,
  unmuteUser,
  deleteMessage,
  pinMessage,
  unpinMessage,
  setPresence,
  leaveRoomEntity,
  joinRoomEntity,
  leaveRoomSimpleEntity,
  // Helpers
  createUnsubscribeStanza,
  createResubscribeStanza,
};

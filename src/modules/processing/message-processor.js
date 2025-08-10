const { botLog } = require('../../lib/utils');

/**
 * Message processing module for handling message validation and entity assignment checks.
 */
class MessageProcessor {
  constructor(config, stateManager, idManager) {
    this.config = config;
    this.stateManager = stateManager;
    this.idManager = idManager;
  }

  /**
   * Validates if a message should be processed.
   * @param {object} stanza - The message stanza
   * @returns {object|null} - Processed message data or null if invalid
   */
  validateMessage(stanza) {
    const body = stanza.getChild('body');
    if (!body) return null;

    // Ignore historical messages which are delivered upon joining a room
    if (stanza.getChild('delay', 'urn:xmpp:delay')) {
      return null;
    }

    const messageContent = body.getText();
    const [roomJid, authorFullJid] = stanza.attrs.from.split('/');
    const messageAuthorGuid = authorFullJid
      ? authorFullJid.split('@')[0]
      : null;

    // Ignore messages sent by the bot itself
    if (
      !messageAuthorGuid ||
      messageAuthorGuid === this.stateManager.getBotCredentials().bot_guid
    ) {
      return null;
    }

    const stanzaIdElement = stanza.getChild('stanza-id', 'urn:xmpp:sid:0');
    const messageId = stanzaIdElement
      ? stanzaIdElement.attrs.id
      : stanza.attrs.id;

    // Extract standardized UUID from room JID
    const roomId = this.idManager.fromJid(roomJid);

    return {
      messageContent,
      roomJid,
      roomId,
      messageAuthorGuid,
      messageId,
    };
  }

  /**
   * Checks if the message is from a valid entity.
   * @param {string} roomId - The room ID
   * @param {string} roomJid - The room JID
   * @returns {boolean} - True if valid, false otherwise
   */
  isValidEntity(roomId, roomJid) {
    // Immediately ignore messages from recently unassigned entities
    if (this.stateManager.hasRecentlyUnassignedEntity(roomId)) {
      botLog(
        this.config.botId,
        'verbose',
        `Ignoring message from recently unassigned entity: ${roomId} (${roomJid})`,
      );
      return false;
    }

    // If the entity is in the non-existent set, ignore it
    if (this.stateManager.hasNonExistentEntity(roomId)) {
      botLog(
        this.config.botId,
        'verbose',
        `Ignoring message from non-existent entity: ${roomId} (${roomJid})`,
      );
      return false;
    }

    return true;
  }

  /**
   * Finds room configuration for a given room ID.
   * @param {string} roomId - The room ID
   * @returns {object|null} - Room configuration or null if not found
   */
  findRoomConfig(roomId) {
    return this.stateManager.getEntity(roomId) || null;
  }

  /**
   * Checks if a room is configured for the bot.
   * @param {string} roomId - The room ID
   * @param {string} roomJid - The room JID
   * @returns {object|null} - Room configuration or null if not configured
   */
  getRoomConfig(roomId, roomJid) {
    const roomConfig = this.findRoomConfig(roomId);

    // Log if we receive a message from a room we're not configured for
    if (!roomConfig) {
      botLog(
        this.config.botId,
        'verbose',
        `Ignoring message from unassigned room: ${roomId} (${roomJid})`,
      );
      return null;
    }

    return roomConfig;
  }
}

module.exports = MessageProcessor;

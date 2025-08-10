const { botLog, idManager } = require('../../lib/utils');
const { constants, apiConfig } = require('../../config');
const { createApiClient } = require('../../lib/http/client.js');
const { postRequest } = require('../../lib/http/client.js');

/**
 * Moderation module for handling content moderation and user management.
 */
class Moderation {
  constructor(options) {
    const {
      config,
      stateManager,
      xmppActions,
      bannedWordsManager,
      discordWebhookManager,
      profanityFilterConfigs = new Map(),
      xmppConfig,
    } = options;

    this.config = config;
    this.stateManager = stateManager;
    this.xmppActions = xmppActions;
    this.bannedWordsManager = bannedWordsManager;
    this.discordWebhookManager = discordWebhookManager;
    this.profanityFilterConfigs = profanityFilterConfigs;
    this.xmppConfig = xmppConfig;
  }

  /**
   * Get message reply for an entity
   * @param {string} entityId - The entity ID
   * @returns {string|null} The message reply or null if not configured
   */
  getMessageReply(entityId) {
    const config = this.profanityFilterConfigs.get(entityId);
    return config?.message_reply || null;
  }

  /**
   * Delete a message via FACEIT Chat Admin API
   * @param {string} messageId - The message ID to delete
   * @param {string} messageAuthorGuid - The message author GUID
   * @param {string} roomId - The room ID
   * @returns {Promise<boolean>} - True if successful, false otherwise
   */
  async deleteMessage(messageId, messageAuthorGuid, roomId) {
    try {
      // Add a small delay to ensure message is fully processed by server
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Get the bot's access token (not chat token)
      const accessToken = this.stateManager.getBotCredentials()?.bot_token;
      if (!accessToken) {
        botLog(
          this.config.botId,
          'error',
          `[${roomId}] No access token available for message deletion`,
        );
        return false;
      }

      // Construct the API URL
      const url = `${apiConfig.chatAdminUrl}/messages/retract/${messageId}`;

      // Use idManager to construct JIDs
      const fromJid = `${messageAuthorGuid}@${this.xmppConfig?.domain || 'chat.faceit.com'}`;
      const entityOrRoom = this.stateManager.hasEntity(roomId)
        ? this.stateManager.getEntity(roomId)
        : { guid: roomId, type: 'community' };
      const mucJid = idManager.toMucLightJidForEntity(
        entityOrRoom,
        this.xmppConfig || {
          domain: 'chat.faceit.com',
          mucDomain: 'muclight.chat.faceit.com',
          supergroupDomain: 'supergroups.chat.faceit.com',
        },
      );

      // Encode @ characters while preserving & literals
      const encodedFromJid = fromJid.replace(/@/g, '%40');
      const encodedMucJid = mucJid.replace(/@/g, '%40');

      const fullUrl = `${url}?from=${encodedFromJid}&muc=${encodedMucJid}`;

      botLog(
        this.config.botId,
        'verbose',
        `[${roomId}] Attempting to delete message ${messageId} via API: ${fullUrl}`,
      );

      // Make the API request using specialized message deletion client
      const messageClient = createApiClient.messageRetraction();
      const result = await messageClient.deleteMessage(fullUrl, null, {
        Authorization: `Bearer ${accessToken}`,
      });

      // Check if it's a 500 response (expected for message deletion)
      if (result && result.status === 500) {
        botLog(
          this.config.botId,
          'verbose',
          `[${roomId}] Message deletion API returned 500 (expected) for message ${messageId}`,
        );
        return true;
      }

      botLog(
        this.config.botId,
        'verbose',
        `[${roomId}] Successfully deleted message ${messageId} via API`,
      );
      return true;
    } catch (error) {
      if (error.message.includes('HTTP 403')) {
        botLog(
          this.config.botId,
          'warn',
          `[${roomId}] Permission denied (403) for message deletion - bot may not have moderation permissions`,
        );
      } else {
        botLog(
          this.config.botId,
          'warn',
          `[${roomId}] Failed to delete message ${messageId}: ${error.message}`,
        );
      }
      return false;
    }
  }

  /**
   * Checks if a message contains banned words and handles moderation.
   * @param {string} messageContent - The message content
   * @param {string} roomId - The room ID
   * @param {string} messageAuthorGuid - The message author GUID
   * @param {string} messageId - The message ID
   * @param {function} queueStanza - Function to queue stanzas
   * @returns {Promise<boolean>} - True if message was moderated, false otherwise
   */
  async checkBannedWords(
    messageContent,
    roomId,
    messageAuthorGuid,
    messageId,
    queueStanza,
  ) {
    if (
      this.bannedWordsManager.checkBannedWords(
        messageContent,
        roomId,
        messageAuthorGuid,
      )
    ) {
      botLog(
        this.config.botId,
        'verbose',
        `[${roomId}] Banned word detected from user ${messageAuthorGuid}.`,
      );

      // Send Discord notification
      this.discordWebhookManager.sendBannedWordsNotification(
        roomId,
        messageContent,
        messageAuthorGuid,
        roomId,
      );

      // Send message reply if configured
      const messageReply = this.getMessageReply(roomId);
      if (messageReply) {
        const entityOrRoom = this.stateManager.hasEntity(roomId)
          ? this.stateManager.getEntity(roomId)
          : roomId;
        const replyStanza = this.xmppActions.sendMessage(
          entityOrRoom,
          messageReply,
        );
        queueStanza(replyStanza);
        botLog(
          this.config.botId,
          'verbose',
          `[${roomId}] Sent message reply: ${messageReply}`,
        );
      }

      // Delete message via Chat Admin API
      const messageDeleted = await this.deleteMessage(
        messageId,
        messageAuthorGuid,
        roomId,
      );
      if (!messageDeleted) {
        botLog(
          this.config.botId,
          'warn',
          `[${roomId}] Failed to delete message ${messageId} via API`,
        );
      }

      // Mute user via Chat Admin API
      const profanityConfig = this.profanityFilterConfigs.get(roomId);
      const muteDuration =
        profanityConfig?.mute_duration_seconds ??
        constants.moderation.bannedWordMuteDuration;

      const userMuted = await this.muteUser(
        messageAuthorGuid,
        roomId,
        muteDuration,
      );
      if (!userMuted) {
        botLog(
          this.config.botId,
          'warn',
          `[${roomId}] Failed to mute user ${messageAuthorGuid} via API`,
        );
      }

      return true;
    }

    return false;
  }

  /**
   * Enforces read-only mode for a room.
   * @param {object} roomConfig - The room configuration
   * @param {string} roomId - The room ID
   * @param {string} messageAuthorGuid - The message author GUID
   * @param {string} messageId - The message ID
   * @param {string} messageContent - The message content
   * @param {function} queueStanza - Function to queue stanzas
   * @returns {Promise<boolean>} - True if message was moderated, false otherwise
   */
  async enforceReadOnlyMode(
    roomConfig,
    roomId,
    messageAuthorGuid,
    messageId,
    _messageContent,
    _queueStanza,
  ) {
    if (roomConfig.read_only) {
      botLog(
        this.config.botId,
        'verbose',
        `[${roomId}] Read-only violation from user ${messageAuthorGuid}.`,
      );

      // Delete message via Chat Admin API
      const messageDeleted = await this.deleteMessage(
        messageId,
        messageAuthorGuid,
        roomId,
      );
      if (!messageDeleted) {
        botLog(
          this.config.botId,
          'warn',
          `[${roomId}] Failed to delete message ${messageId} via API`,
        );
      }

      // Mute user via Chat Admin API
      const userMuted = await this.muteUser(
        messageAuthorGuid,
        roomId,
        constants.moderation.readOnlyMuteDuration,
      );
      if (!userMuted) {
        botLog(
          this.config.botId,
          'warn',
          `[${roomId}] Failed to mute user ${messageAuthorGuid} via API`,
        );
      }

      return true;
    }

    return false;
  }

  /**
   * Mute a user via FACEIT Chat Admin API
   * @param {string} userGuid - The user GUID to mute
   * @param {string} roomId - The room ID
   * @param {number} durationSeconds - Mute duration in seconds (0 or null to skip muting)
   * @returns {Promise<boolean>} - True if successful, false otherwise
   */
  async muteUser(userGuid, roomId, durationSeconds) {
    // Skip muting if duration is 0, null, or undefined
    if (!durationSeconds || durationSeconds <= 0) {
      botLog(
        this.config.botId,
        'verbose',
        `[${roomId}] Skipping mute for user ${userGuid} (duration: ${durationSeconds})`,
      );
      return true; // Return true since skipping is successful
    }

    try {
      // Get the bot's access token (not chat token)
      const accessToken = this.stateManager.getBotCredentials()?.bot_token;
      if (!accessToken) {
        botLog(
          this.config.botId,
          'error',
          `[${roomId}] No access token available for user muting`,
        );
        return false;
      }

      // Calculate mute end time
      const muteUntil = new Date(
        Date.now() + durationSeconds * 1000,
      ).toISOString();

      // Determine which club (community) ID to use for muting
      const entity = this.stateManager.getEntity(roomId);
      const apiClubId =
        entity && (entity.type === 'chat' || entity.type === 'ihl')
          ? entity.parent_guid || entity.permissions?.parent_guid || roomId
          : roomId;

      // Construct the API URL
      const url = `${apiConfig.chatAdminUrl}/club/${apiClubId}/member/${userGuid}:mute`;

      botLog(
        this.config.botId,
        'verbose',
        `[${roomId}] Attempting to mute user ${userGuid} until ${muteUntil} via API: ${url}`,
      );

      // Make the API request using shared HTTP client
      await postRequest(
        url,
        { until: muteUntil },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      botLog(
        this.config.botId,
        'verbose',
        `[${roomId}] Successfully muted user ${userGuid} until ${muteUntil} via API`,
      );
      return true;
    } catch (error) {
      if (error.message.includes('HTTP 403')) {
        botLog(
          this.config.botId,
          'warn',
          `[${roomId}] Permission denied (403) for user muting - bot may not have moderation permissions`,
        );
      } else {
        botLog(
          this.config.botId,
          'warn',
          `[${roomId}] Failed to mute user ${userGuid}: ${error.message}`,
        );
      }
      return false;
    }
  }

  /**
   * Processes moderation for a message.
   * @param {object} messageData - The processed message data
   * @param {object} roomConfig - The room configuration
   * @param {function} queueStanza - Function to queue stanzas
   * @returns {Promise<boolean>} - True if message was moderated, false otherwise
   */
  async processModeration(messageData, roomConfig, queueStanza) {
    const { messageContent, roomId, messageAuthorGuid, messageId } =
      messageData;

    // Check for banned words first
    if (
      await this.checkBannedWords(
        messageContent,
        roomId,
        messageAuthorGuid,
        messageId,
        queueStanza,
      )
    ) {
      return true;
    }

    // Enforce read-only mode
    if (
      await this.enforceReadOnlyMode(
        roomConfig,
        roomId,
        messageAuthorGuid,
        messageId,
        messageContent,
        queueStanza,
      )
    ) {
      return true;
    }

    return false;
  }
}

module.exports = Moderation;

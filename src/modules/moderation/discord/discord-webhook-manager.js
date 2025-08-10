const { botLog } = require('../../../lib/utils');
const {
  isValidDiscordWebhookUrl,
} = require('../../../lib/utils/validation.js');
const { createApiClient } = require('../../../lib/http/client.js');

/**
 * Discord webhook manager for sending moderation notifications
 */
class DiscordWebhookManager {
  constructor(config, stateManager) {
    this.config = config;
    this.stateManager = stateManager;
    this.webhookConfigs = new Map(); // entityId -> webhook config
  }

  /**
   * Configure webhook for an entity
   * @param {string} entityId - The entity ID
   * @param {object} webhookConfig - The webhook configuration
   * @param {string} entityName - The entity name (optional)
   */
  configureWebhook(entityId, webhookConfig, entityName = null) {
    // Input validation
    if (!entityId || typeof entityId !== 'string') {
      botLog(
        this.config.botId,
        'error',
        `Invalid entityId for webhook config: ${entityId}`,
      );
      return;
    }

    if (!webhookConfig || !webhookConfig.discord_webhook_url) {
      this.webhookConfigs.delete(entityId);
      return;
    }

    // Validate webhook URL format
    if (!isValidDiscordWebhookUrl(webhookConfig.discord_webhook_url)) {
      botLog(
        this.config.botId,
        'error',
        `Invalid Discord webhook URL for entity ${entityId}: ${webhookConfig.discord_webhook_url}`,
      );
      return;
    }

    this.webhookConfigs.set(entityId, {
      url: webhookConfig.discord_webhook_url,
      customMessage:
        webhookConfig.discord_custom_message ||
        'A message was caught by the profanity filter.',
      muteDurationSeconds: webhookConfig.mute_duration_seconds || 300,
      entityName,
    });

    botLog(
      this.config.botId,
      'verbose',
      `Configured Discord webhook for entity ${entityId}`,
    );
  }

  /**
   * Send banned words notification to Discord
   * @param {string} entityId - The entity ID
   * @param {string} messageContent - The message content
   * @param {string} messageAuthorGuid - The message author GUID
   * @param {string} roomId - The room ID
   */
  async sendBannedWordsNotification(
    entityId,
    messageContent,
    messageAuthorGuid,
    roomId,
  ) {
    const webhookConfig = this.webhookConfigs.get(entityId);

    if (!webhookConfig) {
      return;
    }

    try {
      const embed = {
        title: '🚫 Banned Word Detected',
        description: `${messageContent.length > 1000 ? `${messageContent.substring(0, 1000)}...` : messageContent}`,
        color: 0xff0000, // Red
        fields: [
          {
            name: 'Author',
            value: `[${messageAuthorGuid}](https://faceitdb.com/profile/faceit/${messageAuthorGuid})`,
            inline: true,
          },
          {
            name: 'Room',
            value: webhookConfig.entityName || roomId,
            inline: true,
          },
          {
            name: 'Mute Duration',
            value: `${webhookConfig.muteDurationSeconds} seconds`,
            inline: true,
          },
        ],
        timestamp: new Date().toISOString(),
        footer: {
          text: 'FACEIT Chatbot Moderation',
        },
      };

      await this.sendWebhook(webhookConfig.url, {
        content: webhookConfig.customMessage,
        embeds: [embed],
      });

      botLog(
        this.config.botId,
        'verbose',
        `Sent banned words notification to Discord for entity ${entityId}`,
      );
    } catch (error) {
      botLog(
        this.config.botId,
        'error',
        `Failed to send Discord webhook for entity ${entityId}: ${error.message}`,
      );
    }
  }

  /**
   * Send webhook to Discord
   * @param {string} webhookUrl - The Discord webhook URL
   * @param {object} payload - The webhook payload
   */
  async sendWebhook(webhookUrl, payload) {
    try {
      const discordClient = createApiClient.discordWebhook();
      await discordClient.sendNotification(webhookUrl, payload);

      botLog(this.config.botId, 'verbose', 'Discord webhook sent successfully');
    } catch (error) {
      throw new Error(`Discord webhook failed: ${error.message}`);
    }
  }

  /**
   * Clean up webhook configuration for an entity
   * @param {string} entityId - The entity ID
   */
  cleanupWebhook(entityId) {
    this.webhookConfigs.delete(entityId);

    botLog(
      this.config.botId,
      'verbose',
      `Cleaned up Discord webhook for entity ${entityId}`,
    );
  }
}

module.exports = DiscordWebhookManager;

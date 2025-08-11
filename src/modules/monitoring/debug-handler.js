const { botLog, idManager } = require('../../lib/utils');
const { postRequest } = require('../../lib/http/client.js');
const { apiConfig } = require('../../config');
const { createResubscribeStanza } = require('../../lib/xmpp/actions.js');

/**
 * Debug handler module for verbose supergroup IQ processing.
 * Only active when verbose logging is enabled.
 */
class DebugHandler {
  constructor(config, stateManager, xmppConfig) {
    this.config = config;
    this.stateManager = stateManager;
    this.xmppConfig = xmppConfig;
  }

  /**
   * Handles verbose supergroup IQ responses and errors.
   * Only called when verbose logging is enabled.
   * @param {object} stanza - The IQ result or error stanza.
   * @param {function} queueStanza - Function to queue stanzas.
   */
  handleVerboseSupergroupIQ(stanza, queueStanza) {
    if (stanza.attrs.type === 'error') {
      this.handleVerboseError(stanza);
    } else {
      this.handleVerboseSuccess(stanza, queueStanza);
    }
  }

  /**
   * Handles verbose error processing for supergroup IQs.
   * @param {object} stanza - The error stanza.
   */
  handleVerboseError(stanza) {
    const error = stanza.getChild('error');
    const errorText = error
      ? error.getChildText('text') || 'Unknown error'
      : 'No error details';
    const errorType = error ? error.attrs.type || 'unknown' : 'unknown';

    botLog(
      this.config.botId,
      'warn',
      `IQ error from ${stanza.attrs.from}: [${errorType}] ${errorText}`,
    );
    botLog(
      this.config.botId,
      'verbose',
      `Full error stanza: ${stanza.toString()}`,
    );

    // Handle 404 errors for non-existent entities
    if (error && error.attrs.code === '404') {
      this.handle404Error(stanza);
    }

    // Handle subscription and permission errors
    if (error && error.attrs.code === '403') {
      botLog(
        this.config.botId,
        'warn',
        `Access denied to ${stanza.attrs.from} - insufficient permissions`,
      );
    }

    if (error && error.attrs.code === '401') {
      botLog(
        this.config.botId,
        'warn',
        `Unauthorized access to ${stanza.attrs.from} - authentication required`,
      );
    }

    // Log supergroup subscription errors
    if (stanza.attrs.from && stanza.attrs.from.includes('@supergroups.')) {
      botLog(
        this.config.botId,
        'error',
        'Supergroup subscription error - message reception may be affected',
      );
    }

    if (stanza.attrs.from && stanza.attrs.from.includes('@muclight.')) {
      botLog(
        this.config.botId,
        'error',
        'MUC Light error - live message delivery may be affected',
      );
    }
  }

  /**
   * Handles 404 errors for non-existent entities.
   * @param {object} stanza - The error stanza.
   */
  async handle404Error(stanza) {
    const error = stanza.getChild('error');
    const fromJid = stanza.attrs.from;
    const errorText = error
      ? error.getChildText('text') || 'Unknown error'
      : 'No error details';

    if (
      !fromJid ||
      (!fromJid.includes('@supergroups') && !fromJid.includes('@muclight'))
    ) {
      return;
    }

    const entityId = idManager.fromJid(fromJid);
    if (entityId && this.stateManager.hasEntity(entityId)) {
      botLog(
        this.config.botId,
        'error',
        `Entity ${entityId} does not exist in FACEIT (404 error): ${errorText}. Removing from cache.`,
      );

      // Clean up entity data
      this.stateManager.cleanupEntityData(entityId, {
        addToRecentlyUnassigned: true,
        addToNonExistent: true,
      });

      // Update entity status to inactive
      try {
        await postRequest(`${apiConfig.baseUrl}/entities/${entityId}/status`, {
          status: 'inactive',
        });
        botLog(
          this.config.botId,
          'log',
          `Updated entity ${entityId} status to inactive in database.`,
        );
      } catch (error) {
        botLog(
          this.config.botId,
          'warn',
          `Failed to update entity ${entityId} status to inactive: ${error.message}`,
        );
      }
    }
  }

  /**
   * Handles verbose success processing for supergroup IQs.
   * @param {object} stanza - The success stanza.
   * @param {function} queueStanza - Function to queue stanzas.
   */
  handleVerboseSuccess(stanza, queueStanza) {
    const query = stanza.getChild('query');

    // Filter out online presence queries from Club chat - we don't need to process user lists
    if (query && query.attrs.xmlns === 'faceit:supergroup:group:0') {
      return;
    }

    if (query && query.attrs.xmlns === 'urn:xmpp:muclight:0#configuration') {
      botLog(
        this.config.botId,
        'verbose',
        `MUC Light config received, setting up subscription for: ${stanza.attrs.from}`,
      );

      const presenceGroup = query.getChildText('presence-group');
      if (presenceGroup) {
        botLog(
          this.config.botId,
          'verbose',
          `Found presence-group: ${presenceGroup}, subscribing for live messages`,
        );

        // Store the subscription mapping for debugging
        this.stateManager.setSupergroupSubscription(
          stanza.attrs.from,
          presenceGroup,
        );

        // Subscribe to the supergroup for live message notifications
        const supergroupSubscription = createResubscribeStanza(presenceGroup);
        queueStanza(supergroupSubscription);
        botLog(
          this.config.botId,
          'verbose',
          `Sent supergroup subscription to ${presenceGroup} - this enables live message reception!`,
        );
      }
    }
  }
}

module.exports = DebugHandler;

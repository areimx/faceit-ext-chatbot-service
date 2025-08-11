const { constants } = require('../../config');
const { botLog } = require('../../lib/utils');

/**
 * Health monitoring module for handling connection health checks and reconnection logic.
 */
class HealthMonitor {
  constructor(config, stateManager) {
    this.config = config;
    this.stateManager = stateManager;
    this.lastWarningTime = 0; // Track when we last logged a warning
    this.warningCooldown = constants.timing.healthWarningCooldown; // Use config value
  }

  /**
   * Monitors connection health by checking when we last received a server ping.
   * If no ping has been received in the warning threshold, assumes connection is dead.
   */
  checkConnectionHealth() {
    if (
      this.stateManager.isShuttingDown() ||
      this.stateManager.isReconnecting() || // Don't interfere with active reconnection
      this.stateManager.isConnecting() // Don't interfere with active connection attempts
    ) {
      return;
    }

    // Always check ping timing, regardless of XMPP status
    const timeSinceLastPing =
      Date.now() - this.stateManager.getLastServerPingTime();
    const warningThreshold = constants.timing.connectionHealthWarning;
    const now = Date.now();

    if (timeSinceLastPing > warningThreshold) {
      // Rate limit warnings to prevent log spam
      if (now - this.lastWarningTime > this.warningCooldown) {
        botLog(
          this.config.botId,
          'warn',
          `No server ping received in ${Math.round(timeSinceLastPing / 1000)} seconds. Connection likely dropped.`,
        );
        this.lastWarningTime = now;
      }

      // Force reconnection when conditions are met
      if (
        !this.stateManager.isReconnecting() &&
        this.stateManager.getXmppClient() &&
        this.stateManager.getXmppClient().status === 'online'
      ) {
        botLog(
          this.config.botId,
          'log',
          'Health monitor: Forcing reconnection due to lack of server pings...',
        );

        // DON'T set isReconnecting here - let connectXmpp manage its own state

        // Force a complete stop to trigger reconnection cycle
        this.stateManager
          .getXmppClient()
          .stop()
          .catch((error) => {
            botLog(
              this.config.botId,
              'warn',
              `Error stopping XMPP connection: ${error.message}`,
            );
          })
          .finally(() => {
            // Reset connection state
            this.stateManager.setConnecting(false);
            this.stateManager.setReconnecting(false); // Ensure this is reset
            this.stateManager.setBotJid(null);

            // Force reconnection after a short delay
            setTimeout(() => {
              if (!this.stateManager.isShuttingDown()) {
                botLog(
                  this.config.botId,
                  'log',
                  'Health monitor: Forcing reconnection after connection timeout.',
                );

                // Trigger reconnection by calling the main connectXmpp function
                if (typeof global.connectXmpp === 'function') {
                  global.connectXmpp();
                } else {
                  // Fallback: emit an event that the main process can listen to
                  process.emit('forceReconnect');
                }
              }
            }, 1000);
          })
          .catch((finalError) => {
            botLog(
              this.config.botId,
              'error',
              `Unexpected error during connection cleanup: ${finalError.message}`,
            );
          });
      }
    } else {
      // Reset warning time when connection is healthy
      this.lastWarningTime = 0;

      botLog(
        this.config.botId,
        'verbose',
        `Connection healthy, last server ping ${Math.round(timeSinceLastPing / 1000)} seconds ago`,
      );
    }
  }

  /**
   * Updates the last server ping time.
   */
  updateLastServerPing() {
    this.stateManager.updateLastServerPingTime();
  }

  /**
   * Gets the time since the last server ping.
   * @returns {number} - Time in milliseconds since last ping
   */
  getTimeSinceLastPing() {
    return Date.now() - this.stateManager.getLastServerPingTime();
  }

  /**
   * Checks if the connection is healthy based on ping timing.
   * @returns {boolean} - True if healthy, false otherwise
   */
  isConnectionHealthy() {
    const timeSinceLastPing = this.getTimeSinceLastPing();
    const warningThreshold = constants.timing.connectionHealthWarning;

    return timeSinceLastPing <= warningThreshold;
  }

  /**
   * Gets connection status information.
   * @returns {object} - Connection status information
   */
  getConnectionStatus() {
    return {
      isOnline:
        this.stateManager.getXmppClient() &&
        this.stateManager.getXmppClient().status === 'online',
      isShuttingDown: this.stateManager.isShuttingDown(),
      lastServerPingTime: this.stateManager.getLastServerPingTime(),
      timeSinceLastPing: this.getTimeSinceLastPing(),
      isHealthy: this.isConnectionHealthy(),
    };
  }
}

module.exports = HealthMonitor;

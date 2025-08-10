/**
 * Timed messages module for handling automated message sending based on message counts.
 */
class TimedMessages {
  constructor(config, stateManager, xmppActions) {
    this.config = config;
    this.stateManager = stateManager;
    this.xmppActions = xmppActions;
  }

  /**
   * Processes timed messages for a room.
   * @param {string} roomId - The room ID
   * @param {object} roomConfig - The room configuration
   * @param {function} queueStanza - Function to queue stanzas
   */
  processTimedMessages(roomId, roomConfig, queueStanza) {
    // Increment message count
    const newCount = this.stateManager.incrementMessageCount(roomId);

    // Check if we should send a timed message
    if (
      roomConfig.timers &&
      roomConfig.timers.length > 0 &&
      newCount > roomConfig.timer_counter_max
    ) {
      // Rotate through timer messages
      const nextTurn = this.stateManager.incrementAutoMessageTurn(
        roomId,
        roomConfig.timers.length,
      );

      const timerConfig = roomConfig.timers.at(nextTurn);
      const timedMessage = timerConfig.message;
      const uploadId = timerConfig.upload_id || null;

      const entityOrRoom = this.stateManager.hasEntity(roomId)
        ? this.stateManager.getEntity(roomId)
        : roomId;

      queueStanza(
        this.xmppActions.sendMessage(entityOrRoom, timedMessage, uploadId),
      );

      // Reset message count
      this.stateManager.resetMessageCount(roomId);
    }
  }

  /**
   * Gets the current message count for a room.
   * @param {string} roomId - The room ID
   * @returns {number} - Current message count
   */
  getMessageCount(roomId) {
    return this.stateManager.getMessageCount(roomId);
  }

  /**
   * Gets the current auto message turn for a room.
   * @param {string} roomId - The room ID
   * @returns {number} - Current auto message turn
   */
  getAutoMessageTurn(roomId) {
    return this.stateManager.getAutoMessageTurn(roomId);
  }

  /**
   * Resets the message count for a room.
   * @param {string} roomId - The room ID
   */
  resetMessageCount(roomId) {
    this.stateManager.resetMessageCount(roomId);
  }

  /**
   * Resets the auto message turn for a room.
   * @param {string} roomId - The room ID
   */
  resetAutoMessageTurn(roomId) {
    this.stateManager.resetAutoMessageTurn(roomId);
  }
}

module.exports = TimedMessages;

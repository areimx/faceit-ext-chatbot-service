const { botLog } = require('../../lib/utils');

/**
 * Commands module for handling bot command processing and responses.
 */
class Commands {
  constructor(config, stateManager, xmppActions) {
    this.config = config;
    this.stateManager = stateManager;
    this.xmppActions = xmppActions;
  }

  /**
   * Retrieves command configuration with object injection protection
   * @param {object} commands - Commands object
   * @param {string} command - Command name
   * @returns {object|null} - Command configuration or null
   */
  _getCommand(commands, command) {
    return Object.prototype.hasOwnProperty.call(commands, command)
      ? // commands object is from database, command is validated by hasOwnProperty check above
        // eslint-disable-next-line security/detect-object-injection
        commands[command]
      : null;
  }

  /**
   * Processes commands in a message.
   * @param {string} messageContent - The message content
   * @param {string} roomId - The room ID
   * @param {object} roomConfig - The room configuration
   * @param {function} queueStanza - Function to queue stanzas
   * @returns {boolean} - True if a command was processed, false otherwise
   */
  processCommands(messageContent, roomId, roomConfig, queueStanza) {
    // Check if message starts with command prefix
    if (!messageContent.startsWith('!')) {
      return false;
    }

    const command = messageContent.substring(1).toLowerCase();
    botLog(
      this.config.botId,
      'verbose',
      `[${roomId}] Received command: ${command}`,
    );

    // Check if command exists in room configuration
    if (roomConfig.commands) {
      const commandConfig = this._getCommand(roomConfig.commands, command);
      if (commandConfig) {
        const commandResponse = commandConfig.response;
        const uploadId = commandConfig.upload_id || null;

        const entityOrRoom = this.stateManager.hasEntity(roomId)
          ? this.stateManager.getEntity(roomId)
          : roomId;

        // Send command response
        queueStanza(
          this.xmppActions.sendMessage(entityOrRoom, commandResponse, uploadId),
        );
        return true;
      }
    }

    return false;
  }

  /**
   * Gets all available commands for a room.
   * @param {object} roomConfig - The room configuration
   * @returns {Array} - Array of command names
   */
  getAvailableCommands(roomConfig) {
    if (!roomConfig.commands) {
      return [];
    }

    return Object.keys(roomConfig.commands);
  }

  /**
   * Checks if a command exists for a room.
   * @param {string} command - The command name
   * @param {object} roomConfig - The room configuration
   * @returns {boolean} - True if command exists, false otherwise
   */
  hasCommand(command, roomConfig) {
    return (
      roomConfig.commands &&
      this._getCommand(roomConfig.commands, command) !== null
    );
  }

  /**
   * Gets the response for a command.
   * @param {string} command - The command name
   * @param {object} roomConfig - The room configuration
   * @returns {string|null} - Command response or null if not found
   */
  getCommandResponse(command, roomConfig) {
    if (!this.hasCommand(command, roomConfig)) {
      return null;
    }

    const commandConfig = this._getCommand(roomConfig.commands, command);
    return commandConfig ? commandConfig.response : null;
  }

  /**
   * Gets the upload ID for a command.
   * @param {string} command - The command name
   * @param {object} roomConfig - The room configuration
   * @returns {string|null} - Upload ID or null if not found
   */
  getCommandUploadId(command, roomConfig) {
    if (!this.hasCommand(command, roomConfig)) {
      return null;
    }

    const commandConfig = this._getCommand(roomConfig.commands, command);
    return commandConfig ? commandConfig.upload_id || null : null;
  }
}

module.exports = Commands;

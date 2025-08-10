/**
 * @file validation.js
 * Common validation patterns used across the chatbot service
 */

/**
 * Validates if a value is a non-empty string
 * @param {any} value - Value to validate
 * @param {number} minLength - Minimum length (default: 1)
 * @param {number} maxLength - Maximum length (default: 1000)
 * @returns {boolean} - True if valid string
 */
function isValidString(value, minLength = 1, maxLength = 1000) {
  return (
    typeof value === 'string' &&
    value.length >= minLength &&
    value.length <= maxLength
  );
}

/**
 * Validates if a value is a non-empty array
 * @param {any} value - Value to validate
 * @param {number} minLength - Minimum length (default: 0)
 * @param {number} maxLength - Maximum length (default: 1000)
 * @returns {boolean} - True if valid array
 */
function isValidArray(value, minLength = 0, maxLength = 1000) {
  return (
    Array.isArray(value) &&
    value.length >= minLength &&
    value.length <= maxLength
  );
}

/**
 * Validates if a string contains only safe characters for profanity words
 * Supports international characters
 * @param {string} word - Word to validate
 * @returns {boolean} - True if contains only safe characters
 */
function isSafeWordString(word) {
  if (!isValidString(word, 1, 100)) return false;

  // Allow Unicode letters, numbers, spaces, basic punctuation
  // \p{L} = All Unicode letters (Latin, Cyrillic, Arabic, Chinese, etc.)
  // \p{N} = All Unicode numbers
  return /^[\p{L}\p{N}\s\-_'.!?]+$/u.test(word);
}

/**
 * Validates if a URL is a valid Discord webhook URL
 * @param {string} url - URL to validate
 * @returns {boolean} - True if valid Discord webhook URL
 */
function isValidDiscordWebhookUrl(url) {
  if (!isValidString(url)) return false;

  const webhookPattern =
    /^https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;
  return webhookPattern.test(url);
}

/**
 * Validates if a string could be a valid GUID/UUID
 * @param {string} id - ID to validate
 * @returns {boolean} - True if valid format
 */
function isValidGuid(id) {
  if (!isValidString(id)) return false;

  // Allow both UUID format and simple alphanumeric IDs
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const simpleIdPattern = /^[a-zA-Z0-9_-]{1,50}$/;

  return uuidPattern.test(id) || simpleIdPattern.test(id);
}

/**
 * Validates basic message data structure
 * @param {object} messageData - Message data object
 * @returns {boolean} - True if valid structure
 */
function isValidMessageData(messageData) {
  if (!messageData || typeof messageData !== 'object') return false;

  const required = [
    'messageContent',
    'roomId',
    'messageAuthorGuid',
    'messageId',
  ];
  return required.every(
    (field) =>
      Object.prototype.hasOwnProperty.call(messageData, field) &&
      // messageData is validated object, field is from controlled array
      // eslint-disable-next-line security/detect-object-injection
      isValidString(messageData[field]),
  );
}

/**
 * Validates entity configuration object
 * @param {object} config - Configuration object
 * @returns {boolean} - True if valid configuration
 */
function isValidEntityConfig(config) {
  if (!config || typeof config !== 'object') return false;

  const entityId = Object.prototype.hasOwnProperty.call(config, 'entityId')
    ? config.entityId
    : Object.prototype.hasOwnProperty.call(config, 'guid')
      ? config.guid
      : null;

  return (
    isValidGuid(entityId) &&
    Object.prototype.hasOwnProperty.call(config, 'enabled') &&
    typeof config.enabled === 'boolean'
  );
}

/**
 * Sanitizes an array of strings by filtering out invalid entries
 * @param {Array} words - Array of strings to sanitize
 * @param {Function} validator - Validation function (default: isValidString)
 * @returns {Array} - Sanitized array
 */
function sanitizeStringArray(words, validator = isValidString) {
  if (!isValidArray(words)) return [];

  return words.filter((word) => validator(word));
}

module.exports = {
  isValidString,
  isValidArray,
  isSafeWordString,
  isValidDiscordWebhookUrl,
  isValidGuid,
  isValidMessageData,
  isValidEntityConfig,
  sanitizeStringArray,
};

/**
 * @file parsers.js
 * Common parsing helpers
 */

/**
 * Safely parse a JSON-like field that may already be an object/array or a JSON string.
 * Returns a default value on parse failure or when value is null/undefined.
 * @param {unknown} rawValue
 * @param {any} defaultValue
 * @returns {any}
 */
function parseJsonField(rawValue, defaultValue) {
  if (rawValue === null || rawValue === undefined) {
    return defaultValue;
  }
  if (typeof rawValue === 'string') {
    try {
      return JSON.parse(rawValue);
    } catch {
      return defaultValue;
    }
  }
  if (typeof rawValue === 'object') {
    return rawValue;
  }
  return defaultValue;
}

module.exports = {
  parseJsonField,
};

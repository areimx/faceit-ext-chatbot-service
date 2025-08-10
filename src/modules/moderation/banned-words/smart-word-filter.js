const {
  isValidString,
  isValidArray,
} = require('../../../lib/utils/validation.js');

/**
 * Smart word filter that prioritizes avoiding false positives
 */
class SmartWordFilter {
  constructor() {
    this.wordBoundaryRegex = /\b\w+\b/g;
    this.compiledPatterns = new Map(); // bannedWord -> compiled patterns
  }

  /**
   * Check if message contains banned words with smart detection
   * @param {string} message - The message to check
   * @param {Array} bannedWords - Array of banned words
   * @returns {boolean} - True if banned word detected
   */
  checkBannedWords(message, bannedWords) {
    // Input validation
    if (!isValidString(message)) return false;
    if (!isValidArray(bannedWords, 1)) return false;

    const lowerMessage = message.toLowerCase();

    // Check each banned word against the message
    for (const bannedWord of bannedWords) {
      if (!isValidString(bannedWord)) continue;

      if (this.isWordPresent(lowerMessage, bannedWord.toLowerCase())) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a banned word is present in the message
   * @param {string} lowerMessage - Lowercase message
   * @param {string} bannedWord - Banned word to check
   * @returns {boolean} - True if word is detected
   */
  isWordPresent(lowerMessage, bannedWord) {
    // Direct word boundary match (most reliable and fastest)
    if (this.hasWordBoundaryMatch(lowerMessage, bannedWord)) {
      return true;
    }

    // Check for common evasion patterns (only if word boundary fails)
    if (this.hasEvasionPattern(lowerMessage, bannedWord)) {
      return true;
    }

    return false;
  }

  /**
   * Check for word boundary matches using pre-compiled patterns
   * @param {string} message - Lowercase message
   * @param {string} bannedWord - Banned word to check
   * @returns {boolean} - True if word boundary match found
   */
  hasWordBoundaryMatch(message, bannedWord) {
    // Get or create compiled pattern
    let pattern = this.compiledPatterns.get(bannedWord);
    if (!pattern) {
      // bannedWord comes from controlled database source and is escaped
      pattern = this._createSafeRegExp(`\\b${this.escapeRegex(bannedWord)}\\b`);
      if (!pattern) {
        // Skip invalid regex patterns
        return false;
      }
      this.compiledPatterns.set(bannedWord, pattern);
    }

    return pattern.test(message);
  }

  /**
   * Check for common evasion patterns using pre-compiled patterns
   * @param {string} message - Lowercase message
   * @param {string} bannedWord - Banned word to check
   * @returns {boolean} - True if evasion pattern detected
   */
  hasEvasionPattern(message, bannedWord) {
    // Get or create compiled evasion patterns
    const patternKey = `evasion_${bannedWord}`;
    let patterns = this.compiledPatterns.get(patternKey);

    if (!patterns) {
      patterns = this.createEvasionPatterns(bannedWord);
      this.compiledPatterns.set(patternKey, patterns);
    }

    // Test each pattern
    for (const pattern of patterns) {
      if (pattern.test(message)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Create evasion patterns for a banned word
   * @param {string} bannedWord - The banned word
   * @returns {Array} - Array of compiled RegExp patterns
   */
  createEvasionPatterns(bannedWord) {
    const patterns = [];

    // Spaced letters: "f u c k" (very common)
    const spacedPattern = this._createSafeRegExp(
      bannedWord.split('').join('\\s*'),
    );
    if (spacedPattern) patterns.push(spacedPattern);

    // Dotted letters: "f.u.c.k" (common)
    const dottedPattern = this._createSafeRegExp(
      bannedWord.split('').join('\\.'),
    );
    if (dottedPattern) patterns.push(dottedPattern);

    // Asterisk substitution: "f*ck" (very common)
    const asteriskPattern = this._createSafeRegExp(
      bannedWord.replace(/[aeiou]/g, '\\*'),
    );
    if (asteriskPattern) patterns.push(asteriskPattern);

    // Common number substitutions: "f4ck" (common)
    const leetspeak = bannedWord
      .replace(/a/g, '4')
      .replace(/e/g, '3')
      .replace(/i/g, '1')
      .replace(/o/g, '0')
      .replace(/s/g, '5');
    const leetspeakPattern = this._createSafeRegExp(leetspeak);
    if (leetspeakPattern) patterns.push(leetspeakPattern);

    return patterns;
  }

  /**
   * Escape special regex characters
   * @param {string} string - String to escape
   * @returns {string} - Escaped string
   */
  escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Create a RegExp pattern from validated input
   * @param {string} pattern - The pattern string (pre-validated by BannedWordsManager)
   * @param {string} flags - RegExp flags
   * @returns {RegExp|null} - Compiled RegExp or null if invalid
   */
  _createSafeRegExp(pattern, flags = 'i') {
    try {
      // Pattern is pre-validated by BannedWordsManager.validateAndSanitizeWords() which filters dangerous patterns
      // eslint-disable-next-line security/detect-non-literal-regexp
      return new RegExp(pattern, flags);
    } catch {
      // Invalid patterns are safely ignored (should not happen with validated input)
      return null;
    }
  }

  /**
   * Combine preset words and custom words
   * @param {Array} presetWords - Words from preset
   * @param {Array} customWords - Custom words from entity
   * @returns {Array} - Combined unique word list
   */
  combineWordLists(presetWords = [], customWords = []) {
    const combined = new Set();

    // Add preset words
    if (presetWords && Array.isArray(presetWords)) {
      presetWords.forEach((word) => {
        if (typeof word === 'string' && word.length > 0) {
          combined.add(word.toLowerCase());
        }
      });
    }

    // Add custom words
    if (customWords && Array.isArray(customWords)) {
      customWords.forEach((word) => {
        if (typeof word === 'string' && word.length > 0) {
          combined.add(word.toLowerCase());
        }
      });
    }

    return Array.from(combined);
  }

  /**
   * Clear compiled patterns (useful for memory management)
   */
  clearCompiledPatterns() {
    this.compiledPatterns.clear();
  }
}

module.exports = SmartWordFilter;

const { getRequest } = require('../../../lib/http/client.js');
const { botLog } = require('../../../lib/utils');
const { parseJsonField } = require('../../../lib/utils/parsers');
const {
  isValidArray,
  isSafeWordString,
  sanitizeStringArray,
} = require('../../../lib/utils/validation.js');

const SmartWordFilter = require('./smart-word-filter.js');

/**
 * Banned words manager using custom smart word filter
 */
class BannedWordsManager {
  constructor(config, stateManager) {
    this.config = config;
    this.stateManager = stateManager;

    // Smart word filter instance
    this.wordFilter = new SmartWordFilter();

    // Preset word lists (shared across entities)
    this.presetWords = new Map(); // presetId -> word array
    this.entityConfigs = new Map(); // entityId -> { presetId, customWords, enabled }
    this.usedPresetIds = new Set();
  }

  /**
   * Initialize preset from database JSON word list
   */
  async initializePreset(presetId) {
    if (this.presetWords.has(presetId)) return; // Already loaded

    try {
      const preset = await this.fetchPreset(presetId);

      if (!preset) {
        return; // Preset not found - skip silently
      }

      // Normalize JSON words (may be an array already or a JSON string)
      const rawWords = Array.isArray(preset.words)
        ? preset.words
        : typeof preset.words === 'string'
          ? parseJsonField(preset.words, [])
          : [];

      // Validate and sanitize words for safe RegExp usage
      const words = this.validateAndSanitizeWords(rawWords);

      this.presetWords.set(presetId, words);

      botLog(
        this.config.botId,
        'verbose',
        `Loaded preset ${presetId} (${preset.preset_name}) with ${words.length} words`,
      );
    } catch (error) {
      // Don't log 404 errors (preset doesn't exist) - skip silently
      if (!error.message || !error.message.includes('404')) {
        botLog(
          this.config.botId,
          'error',
          `Failed to load preset ${presetId}: ${error.message}`,
        );
      }
    }
  }

  /**
   * Configure entity with profanity filter config
   */
  async configureEntity(entityId, profanityConfig) {
    if (!profanityConfig || !profanityConfig.is_active) {
      this.entityConfigs.delete(entityId);
      return;
    }

    const presetId = profanityConfig.banned_words_preset_id;
    let customWords = [];
    let managerGuids = [];

    // Normalize custom words (may be an array already or a JSON string)
    if (profanityConfig.custom_words) {
      let rawCustomWords = [];
      if (Array.isArray(profanityConfig.custom_words)) {
        rawCustomWords = profanityConfig.custom_words;
      } else if (typeof profanityConfig.custom_words === 'string') {
        rawCustomWords = parseJsonField(profanityConfig.custom_words, []);
      }
      // Validate and sanitize custom words for safe RegExp usage
      customWords = this.validateAndSanitizeWords(rawCustomWords);
    }

    // Get manager GUIDs
    if (profanityConfig.manager_guids) {
      managerGuids = profanityConfig.manager_guids;
    }

    // Load preset if specified
    if (presetId) {
      await this.initializePreset(presetId);
      this.usedPresetIds.add(presetId);
    }

    const config = {
      presetId,
      customWords,
      managerGuids,
      enabled: profanityConfig.is_active !== false,
    };

    this.entityConfigs.set(entityId, config);

    const totalWords =
      (presetId ? this.presetWords.get(presetId)?.length || 0 : 0) +
      customWords.length;

    botLog(
      this.config.botId,
      'verbose',
      `Configured entity ${entityId} with ${totalWords} total words (preset: ${presetId || 'none'}, custom: ${customWords.length}, managers: ${managerGuids.length})`,
    );
  }

  /**
   * Check message for banned words with manager exemption
   */
  checkBannedWords(message, entityId, messageAuthorGuid) {
    // Input validation
    if (!message || typeof message !== 'string') return false;
    if (!entityId || typeof entityId !== 'string') return false;
    if (!messageAuthorGuid || typeof messageAuthorGuid !== 'string')
      return false;

    const config = this.entityConfigs.get(entityId);
    if (!config || !config.enabled) return false;

    // Check if author is exempt (manager or bot)
    if (this.isAuthorExempt(entityId, messageAuthorGuid)) {
      return false;
    }

    // Get preset words
    const presetWords = config.presetId
      ? this.presetWords.get(config.presetId) || []
      : [];

    // Combine preset and custom words
    const allBannedWords = this.wordFilter.combineWordLists(
      presetWords,
      config.customWords,
    );

    // Check message
    return this.wordFilter.checkBannedWords(message, allBannedWords);
  }

  /**
   * Check if message author is exempt from profanity filtering
   * @param {string} entityId - The entity ID
   * @param {string} messageAuthorGuid - The message author GUID
   * @returns {boolean} - True if author is exempt
   */
  isAuthorExempt(entityId, messageAuthorGuid) {
    // Input validation
    if (!entityId || !messageAuthorGuid) return false;

    const config = this.entityConfigs.get(entityId);
    if (!config) return false;

    // Bot is always exempt
    if (messageAuthorGuid === this.stateManager.getBotCredentials()?.bot_guid) {
      return true;
    }

    // Entity managers are exempt
    if (
      config.managerGuids &&
      Array.isArray(config.managerGuids) &&
      config.managerGuids.includes(messageAuthorGuid)
    ) {
      return true;
    }

    return false;
  }

  /**
   * Clean up entity and potentially unload unused presets
   */
  cleanupEntity(entityId) {
    const config = this.entityConfigs.get(entityId);
    if (config) {
      this.entityConfigs.delete(entityId);

      // Check if preset is still used
      if (config.presetId) {
        const stillUsed = Array.from(this.entityConfigs.values()).some(
          (entityConfig) => entityConfig.presetId === config.presetId,
        );

        if (!stillUsed) {
          this.presetWords.delete(config.presetId);
          this.usedPresetIds.delete(config.presetId);

          botLog(
            this.config.botId,
            'verbose',
            `Unloaded unused preset ${config.presetId} (loaded presets: ${this.presetWords.size})`,
          );
        }
      }
    }
  }

  /**
   * Clear all compiled patterns
   */
  clearCompiledPatterns() {
    this.wordFilter.clearCompiledPatterns();
    botLog(
      this.config.botId,
      'verbose',
      'Cleared all compiled regex patterns for memory management',
    );
  }

  /**
   * Refresh a specific preset from database
   * @param {number|string} presetId - The preset ID to refresh
   * @returns {boolean} - True if preset was refreshed, false if not loaded
   */
  async refreshPreset(presetId) {
    // Convert to number for consistent comparison with stored keys
    const numericPresetId = parseInt(presetId, 10);

    // Check if preset is currently loaded
    if (!this.presetWords.has(numericPresetId)) {
      botLog(
        this.config.botId,
        'verbose',
        `Preset ${presetId} not currently loaded, skipping refresh.`,
      );
      return false;
    }

    try {
      const preset = await this.fetchPreset(numericPresetId);

      if (preset) {
        // Normalize JSON words
        const words = Array.isArray(preset.words)
          ? preset.words
          : typeof preset.words === 'string'
            ? (() => {
                try {
                  return JSON.parse(preset.words);
                } catch {
                  return [];
                }
              })()
            : [];

        // Update the cached preset
        this.presetWords.set(numericPresetId, words);

        botLog(
          this.config.botId,
          'verbose',
          `Refreshed preset ${presetId} (${preset.preset_name}) with ${words.length} words`,
        );

        // Clear compiled patterns to force recompilation with new words
        this.wordFilter.clearCompiledPatterns();

        return true;
      } else {
        // Preset no longer exists, remove from cache
        this.presetWords.delete(numericPresetId);
        this.usedPresetIds.delete(numericPresetId);

        botLog(
          this.config.botId,
          'verbose',
          `Removed non-existent preset ${presetId} from cache`,
        );

        // Clear compiled patterns to force recompilation
        this.wordFilter.clearCompiledPatterns();

        return true;
      }
    } catch (error) {
      botLog(
        this.config.botId,
        'error',
        `Failed to refresh preset ${presetId}: ${error.message}`,
      );
      return false;
    }
  }

  /**
   * Refresh all currently loaded presets from database
   */
  async refreshLoadedPresets() {
    const loadedPresetIds = Array.from(this.presetWords.keys());

    if (loadedPresetIds.length === 0) {
      botLog(
        this.config.botId,
        'verbose',
        'No presets currently loaded, nothing to refresh.',
      );
      return;
    }

    botLog(
      this.config.botId,
      'verbose',
      `Refreshing ${loadedPresetIds.length} loaded presets: ${loadedPresetIds.join(', ')}`,
    );

    // Refresh each loaded preset
    for (const presetId of loadedPresetIds) {
      try {
        const preset = await this.fetchPreset(presetId);

        if (preset) {
          // Normalize JSON words
          const words = Array.isArray(preset.words)
            ? preset.words
            : typeof preset.words === 'string'
              ? (() => {
                  try {
                    return JSON.parse(preset.words);
                  } catch {
                    return [];
                  }
                })()
              : [];

          // Update the cached preset
          this.presetWords.set(presetId, words);

          botLog(
            this.config.botId,
            'verbose',
            `Refreshed preset ${presetId} (${preset.preset_name}) with ${words.length} words`,
          );
        } else {
          // Preset no longer exists, remove from cache
          this.presetWords.delete(presetId);
          this.usedPresetIds.delete(presetId);

          botLog(
            this.config.botId,
            'verbose',
            `Removed non-existent preset ${presetId} from cache`,
          );
        }
      } catch (error) {
        botLog(
          this.config.botId,
          'error',
          `Failed to refresh preset ${presetId}: ${error.message}`,
        );
      }
    }

    // Clear compiled patterns to force recompilation with new words
    this.wordFilter.clearCompiledPatterns();

    botLog(
      this.config.botId,
      'log',
      `Completed refreshing ${loadedPresetIds.length} presets`,
    );
  }

  /**
   * Fetch preset from database
   */
  async fetchPreset(presetId) {
    try {
      // Use the same base URL as other database API calls
      const preset = await getRequest(
        `http://localhost:3008/profanity-filter-presets/${presetId}`,
      );

      return {
        preset_id: preset.preset_id,
        preset_name: preset.preset_name,
        preset_description: preset.preset_description,
        language: preset.language,
        words: preset.words,
      };
    } catch (error) {
      // Handle axios errors
      if (error.response && error.response.status === 404) {
        // Preset not found - return null silently (handled by caller)
        return null;
      }

      botLog(
        this.config.botId,
        'error',
        `Failed to fetch preset ${presetId}: ${error.message}`,
      );
      return null;
    }
  }

  /**
   * Validate and sanitize words for safe RegExp usage
   * Supports international characters for multilingual profanity filtering
   * @param {Array} words - Array of words to validate
   * @returns {Array} - Array of safe words
   */
  validateAndSanitizeWords(words) {
    if (!isValidArray(words)) return [];

    const filteredWords = sanitizeStringArray(words, (word) => {
      // Check basic string validity and safe character set
      if (!isSafeWordString(word)) return false;

      // Check for dangerous RegExp patterns
      if (this.containsDangerousRegexPatterns(word)) return false;

      return true;
    });

    if (filteredWords.length !== words.length) {
      botLog(
        this.config.botId,
        'verbose',
        `Filtered ${words.length - filteredWords.length} invalid words from ${words.length} total words`,
      );
    }

    return filteredWords;
  }

  /**
   * Check if a word contains potentially dangerous RegExp patterns
   * @param {string} word - Word to check
   * @returns {boolean} - True if contains dangerous patterns
   */
  containsDangerousRegexPatterns(word) {
    // Check for catastrophic backtracking patterns
    const dangerousPatterns = [
      /\(\?=/g, // Lookahead
      /\(\?!/g, // Negative lookahead
      /\(\?<=/g, // Lookbehind
      /\(\?<!/g, // Negative lookbehind
      /\{\d+,\}/g, // Unbounded quantifiers
      /\+\+/g, // Nested quantifiers
      /\*\*/g, // Nested quantifiers
      /\(\.\*\)/g, // Greedy dot-star in groups
      /\(\.\+\)/g, // Greedy dot-plus in groups
    ];

    return dangerousPatterns.some((pattern) => pattern.test(word));
  }
}

module.exports = BannedWordsManager;

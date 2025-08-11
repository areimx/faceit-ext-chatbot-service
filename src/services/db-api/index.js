/**
 * @file db-api/index.js
 * Database API service providing entity configurations and bot management.
 */

require('dotenv').config();
const util = require('util');

const express = require('express');
const mysql = require('mysql');
const qs = require('qs');

const { constants } = require('../../config');
const { postRequest, handleApiError } = require('../../lib/http/client');
const { parseJsonField } = require('../../lib/utils/parsers');

// --- GLOBAL ERROR HANDLING ---

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  process.exit(1);
});

// --- DATABASE SETUP ---

const pool = mysql.createPool({
  connectionLimit: 10,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  charset: 'utf8mb4',
});

// Promisify for async/await support
pool.query = util.promisify(pool.query);

// --- EXPRESS APP SETUP ---

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.DB_API_PORT || 3008;

// --- TOKEN REFRESH RATE LIMITING ---
// In-memory tracking to avoid refreshing tokens on every config read
const lastTokenRefreshAt = new Map(); // botId -> timestamp (ms)
const TOKEN_REFRESH_INTERVAL_MS = constants.auth.tokenRefreshIntervalMs;
const FORCE_REFRESH_MIN_INTERVAL_MS = constants.auth.forceRefreshMinIntervalMs;

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize database and start server
async function initializeDatabase() {
  try {
    // Test database connection
    const connection = await new Promise((resolve, reject) => {
      pool.getConnection((err, conn) => {
        if (err) {
          reject(err);
        } else {
          resolve(conn);
        }
      });
    });

    console.log('Successfully connected to the database.');
    connection.release();

    // Start the server
    const server = app.listen(PORT, () => {
      console.log(`Database API service running on port ${PORT}`);

      // Send ready signal to PM2
      if (process.send) {
        process.send('ready');
      }
    });

    // Handle server errors
    server.on('error', (error) => {
      console.error('Server error:', error);
      process.exit(1);
    });
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
}

// Start initialization
initializeDatabase();

// --- API ENDPOINTS ---

/**
 * @route   GET /bots/active
 * @desc    Get all active bots.
 */
app.get('/bots/active', async (req, res) => {
  try {
    const bots = await pool.query(
      "SELECT bot_id FROM bots WHERE bot_status = 'active'",
    );
    res.json(bots);
  } catch (error) {
    handleApiError(res, error);
  }
});

/**
 * @route   GET /bots/:botId/config
 * @desc    Get configuration for a specific bot.
 */
app.get('/bots/:botId/config', async (req, res) => {
  try {
    const { botId } = req.params;
    const forceParam = req.query.force === '1' || req.query.force === 'true';

    // Refresh token only if needed (or explicitly forced)
    await refreshBotAccessTokenIfNeeded(botId, { force: forceParam });
    const botConfig = await getBotCredentials(botId);
    if (botConfig) {
      res.json(botConfig);
    } else {
      res.status(404).json({ error: `Bot with ID ${botId} not found.` });
    }
  } catch (error) {
    handleApiError(res, error);
  }
});

/**
 * @route   GET /bots/:botId/entities
 * @desc    Get all entities (rooms) associated with a bot.
 */
app.get('/bots/:botId/entities', async (req, res) => {
  try {
    const { botId } = req.params;
    const entities = await getBotEntities(botId);
    res.json(entities);
  } catch (error) {
    handleApiError(res, error);
  }
});

/**
 * @route   GET /entities/:entityId/data
 * @desc    Get detailed data for a specific entity.
 */
app.get('/entities/:entityId/data', async (req, res) => {
  try {
    const { entityId } = req.params;
    const entityData = await getEntityData(entityId);
    if (entityData) {
      res.json(entityData);
    } else {
      res.status(404).json({ error: `Entity with ID ${entityId} not found.` });
    }
  } catch (error) {
    handleApiError(res, error);
  }
});

/**
 * @route   POST /entities/:entityId/update
 * @desc    Trigger an update notification for a bot process.
 */
app.post('/entities/:entityId/update', async (req, res) => {
  try {
    const { entityId } = req.params;
    const botId = await getBotIdForEntity(entityId);
    if (botId) {
      // Notify the relevant bot process that its entity has been updated.
      const botApiPort = parseInt(botId, 10) + 4000;
      await postRequest(
        `http://localhost:${botApiPort}/update/${entityId}`,
        {},
      );
    }
    res.sendStatus(200);
  } catch (error) {
    // Log error without returning 500 status to caller
    console.error(
      `Error processing entity update for ${req.params.entityId}:`,
      error.message,
    );
    res.sendStatus(202); // Accepted, but may not have been processed.
  }
});

/**
 * @route   POST /entities/:entityId/assign
 * @desc    Notify a bot process to take on a new entity assignment.
 */
app.post('/entities/:entityId/assign', async (req, res) => {
  try {
    const { entityId } = req.params;

    // Get the bot ID from the database for this entity
    const botId = await getBotIdForEntity(entityId);

    if (!botId) {
      return res
        .status(404)
        .json({ error: `No bot currently assigned to entity ${entityId}.` });
    }

    // Verify the entity exists
    const entityData = await getEntityData(entityId);
    if (!entityData) {
      return res
        .status(404)
        .json({ error: `Entity with ID ${entityId} not found.` });
    }

    // Verify the bot exists and is active
    const botConfig = await getBotCredentials(botId);
    if (!botConfig) {
      return res
        .status(404)
        .json({ error: `Bot with ID ${botId} not found or inactive.` });
    }

    // Notify the bot process to take on the new entity
    const botApiPort = parseInt(botId, 10) + 4000;
    await postRequest(`http://localhost:${botApiPort}/assign/${entityId}`, {
      entityData,
    });

    console.log(
      `Successfully notified bot ${botId} to assign entity ${entityId}`,
    );
    res.sendStatus(200);
  } catch (error) {
    handleApiError(res, error);
  }
});

/**
 * @route   POST /entities/:entityId/status
 * @desc    Update the status of an entity (active/inactive).
 */
app.post('/entities/:entityId/status', async (req, res) => {
  try {
    const { entityId } = req.params;
    const { status } = req.body;

    if (!status || !['active', 'inactive'].includes(status)) {
      return res
        .status(400)
        .json({ error: 'Status must be either "active" or "inactive"' });
    }

    const success = await updateEntityStatus(entityId, status);
    if (success) {
      console.log(
        `Successfully updated entity ${entityId} status to ${status}`,
      );
      res.sendStatus(200);
    } else {
      res.status(404).json({ error: `Entity with ID ${entityId} not found.` });
    }
  } catch (error) {
    handleApiError(res, error);
  }
});

/**
 * @route   POST /entities/:entityId/unassign
 * @desc    Notify a bot process to drop an entity assignment.
 */
app.post('/entities/:entityId/unassign', async (req, res) => {
  try {
    const { entityId } = req.params;
    const botId = await getBotIdForEntity(entityId);

    if (!botId) {
      return res
        .status(404)
        .json({ error: `No bot currently assigned to entity ${entityId}.` });
    }

    // Notify the bot process to drop the entity
    const botApiPort = parseInt(botId, 10) + 4000;
    await postRequest(
      `http://localhost:${botApiPort}/unassign/${entityId}`,
      {},
    );

    console.log(
      `Successfully notified bot ${botId} to unassign entity ${entityId}`,
    );
    res.sendStatus(200);
  } catch (error) {
    console.error(
      `Error processing entity unassignment for ${req.params.entityId}:`,
      error.message,
    );
    res.sendStatus(202); // Accepted, but may not have been processed.
  }
});

/**
 * @route   GET /profanity-filter-presets/:presetId
 * @desc    Get banned words preset by ID.
 */
app.get('/profanity-filter-presets/:presetId', async (req, res) => {
  try {
    const { presetId } = req.params;
    const preset = await getPreset(presetId);

    if (preset) {
      res.json(preset);
    } else {
      res.status(404).json({ error: `Preset with ID ${presetId} not found.` });
    }
  } catch (error) {
    handleApiError(res, error);
  }
});

/**
 * @route   POST /profanity-filter-presets/:presetId/refresh
 * @desc    Notify bot processes to refresh a specific preset.
 */
app.post('/profanity-filter-presets/:presetId/refresh', async (req, res) => {
  try {
    const { presetId } = req.params;

    // Get all active bots
    const botsQuery = 'SELECT bot_id FROM bots WHERE bot_status = "active"';
    const bots = await pool.query(botsQuery);

    // Notify each bot process to refresh the specific preset
    const notifications = bots.map(async (bot) => {
      const botId = bot.bot_id;
      const botApiPort = parseInt(botId, 10) + 4000;

      try {
        await postRequest(
          `http://localhost:${botApiPort}/refresh-preset/${presetId}`,
          {},
        );
        console.log(`Notified bot ${botId} to refresh preset ${presetId}`);
      } catch (error) {
        console.error(`Failed to notify bot ${botId}: ${error.message}`);
      }
    });

    // Wait for all notifications to complete
    await Promise.allSettled(notifications);

    res.sendStatus(200);
  } catch (error) {
    console.error('Error notifying bots to refresh preset:', error.message);
    res.sendStatus(202); // Accepted, but may not have been processed
  }
});

/**
 * @route   GET /profanity-filter-config/:entityId
 * @desc    Get profanity filter configuration for an entity.
 */
app.get('/profanity-filter-config/:entityId', async (req, res) => {
  try {
    const { entityId } = req.params;
    const config = await getProfanityFilterConfig(entityId);

    // Return null if no config exists (profanity filtering disabled for this entity)
    // Entity not found - expected for inactive entities
    res.json(config);
  } catch (error) {
    handleApiError(res, error);
  }
});

// --- DATABASE HELPER FUNCTIONS ---

/**
 * Fetches the credentials for a specific bot.
 * @param {string} botId - The ID of the bot.
 * @returns {Promise<object|null>} An object containing the bot's GUID, token, and name, or null if not found.
 */
async function getBotCredentials(botId) {
  const query = 'SELECT bot_guid, bot_token, bot_name FROM bots WHERE bot_id=?';
  const result = await pool.query(query, [botId]);
  if (!result[0]) return null;

  return {
    bot_guid: result[0].bot_guid,
    bot_token: result[0].bot_token,
    nickname: result[0].bot_name,
  };
}

/**
 * Fetches all entities associated with a bot and formats them for use.
 * @param {string} botId - The ID of the bot.
 * @returns {Promise<object>} An object where keys are room JIDs and values are entity data.
 */
async function getBotEntities(botId) {
  const query = `
    SELECT ber.entity_guid 
    FROM bot_entity_relations ber
    JOIN entities e ON ber.entity_guid = e.entity_guid
    WHERE ber.bot_id = ? AND e.entity_status = 'active'
  `;
  const entityLinks = await pool.query(query, [botId]);
  const entities = {};

  for (const link of entityLinks) {
    const entityData = await getEntityData(link.entity_guid);
    if (entityData) {
      entityData.channel = 'general';
      entities[link.entity_guid] = entityData;
    }
  }
  return entities;
}

/**
 * Fetches detailed data for a single entity, including its commands and timers.
 * Provides default values for all fields to ensure the bot process does not crash on missing data.
 * @param {string} entityId - The ID of the entity.
 * @returns {Promise<object|null>} A comprehensive object of entity data, or null if not found.
 */
async function getEntityData(entityId) {
  const entityQuery = `
    SELECT 
      e.entity_guid, 
      e.entity_name, 
      e.entity_type,
      e.entity_parent_id,
      e.entity_commands, 
      e.entity_timers, 
      e.timer_counter_max, 
      e.read_only, 
      wm.message as welcome_message 
    FROM entities e 
    LEFT JOIN welcome_messages wm ON e.entity_guid = wm.entity_guid 
    WHERE e.entity_guid=? LIMIT 1
  `;
  const entityResult = await pool.query(entityQuery, [entityId]);
  if (!entityResult[0]) return null;

  const entity = entityResult[0];

  // Provide defaults for all expected fields to prevent errors in the bot process.
  return {
    guid: entity.entity_guid,
    name: entity.entity_name,
    type: entity.entity_type,
    commands: parseJsonField(entity.entity_commands, {}),
    timers: parseJsonField(entity.entity_timers, []),
    timer_counter_max: entity.timer_counter_max || 30,
    read_only: !!entity.read_only,
    welcome_message: entity.welcome_message || null,
    parent_guid: entity.entity_parent_id || null,
  };
}

/**
 * Finds which bot is assigned to a given entity.
 * @param {string} entityId - The ID of the entity.
 * @returns {Promise<string|null>} The bot ID or null if not found.
 */
async function getBotIdForEntity(entityId) {
  const query =
    'SELECT bot_id FROM bot_entity_relations WHERE entity_guid=? LIMIT 1';
  const result = await pool.query(query, [entityId]);
  return result[0] ? result[0].bot_id : null;
}

/**
 * Updates the status of an entity in the database.
 * @param {string} entityId - The ID of the entity.
 * @param {string} status - The new status ('active' or 'inactive').
 * @returns {Promise<boolean>} True if update was successful, false otherwise.
 */
async function updateEntityStatus(entityId, status) {
  try {
    const query = 'UPDATE entities SET entity_status = ? WHERE entity_guid = ?';
    const result = await pool.query(query, [status, entityId]);
    return result.affectedRows > 0;
  } catch (error) {
    console.error(
      `Failed to update entity status for ${entityId}:`,
      error.message,
    );
    return false;
  }
}

/**
 * Fetches a banned words preset by ID.
 * @param {string} presetId - The ID of the preset.
 * @returns {Promise<object|null>} The preset data or null if not found.
 */
async function getPreset(presetId) {
  try {
    const query = `
      SELECT preset_id, preset_name, preset_description, language, words, is_active
      FROM banned_words_presets
      WHERE preset_id = ? AND is_active = 1
    `;
    const result = await pool.query(query, [presetId]);

    if (!result[0]) return null;

    return result[0];
  } catch (error) {
    console.error(`Failed to fetch preset ${presetId}:`, error.message);
    return null;
  }
}

/**
 * Fetches the profanity filter configuration for a specific entity.
 * @param {string} entityId - The ID of the entity.
 * @returns {Promise<object|null>} The profanity filter configuration or null if not found.
 */
async function getProfanityFilterConfig(entityId) {
  try {
    // First get the profanity filter config
    const configQuery = `
      SELECT entity_guid, banned_words_preset_id, custom_words, discord_webhook_url, 
             discord_custom_message, message_reply, mute_duration_seconds, is_active
      FROM profanity_filter_config
      WHERE entity_guid = ? AND is_active = 1
    `;
    const configResult = await pool.query(configQuery, [entityId]);

    if (!configResult[0]) return null;

    // Then get managers separately (only if config exists)
    const managerQuery = `
      SELECT user_guid
      FROM user_entity_relations
      WHERE entity_guid = ?
    `;
    const managerResult = await pool.query(managerQuery, [entityId]);

    const managerGuids = managerResult.map((row) => row.user_guid);

    return {
      ...configResult[0],
      manager_guids: managerGuids,
    };
  } catch (error) {
    console.error(
      `Failed to fetch profanity filter config for ${entityId}:`,
      error.message,
    );
    return null;
  }
}

/**
 * Refreshes the FACEIT access token for a bot.
 * @param {string} botId - The ID of the bot.
 */
async function updateBotAccessToken(botId) {
  const tokenQuery = 'SELECT bot_refresh_token FROM bots WHERE bot_id=?';
  const tokenResult = await pool.query(tokenQuery, [botId]);
  if (!tokenResult[0]?.bot_refresh_token) {
    console.warn(
      `Bot ${botId} has no refresh token - cannot refresh access token`,
    );
    return;
  }

  const refreshToken = tokenResult[0].bot_refresh_token;
  const authorizationBasic = Buffer.from(
    `${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`,
  ).toString('base64');

  try {
    const tokenData = await postRequest(
      'https://api.faceit.com/auth/v1/oauth/token',
      qs.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      {
        headers: {
          Authorization: `Basic ${authorizationBasic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );

    if (tokenData?.access_token) {
      const updateQuery = 'UPDATE bots SET bot_token=? WHERE bot_id=?';
      await pool.query(updateQuery, [tokenData.access_token, botId]);
      console.log(`Successfully refreshed token for bot ${botId}`);
    } else {
      console.warn(`Token refresh for bot ${botId} returned no access_token`);
    }
  } catch (error) {
    console.error(`Failed to refresh token for bot ${botId}:`, error.message);
    // Non-fatal error - log and continue service operation
  }
}

/**
 * Refreshes the bot access token if enough time has elapsed since the last refresh.
 * Supports a force mode (with a smaller minimum interval) to handle auth failures.
 * @param {string} botId
 * @param {{force?: boolean}} options
 */
async function refreshBotAccessTokenIfNeeded(botId, options = {}) {
  const now = Date.now();
  const force = Boolean(options.force);
  const minInterval = force
    ? FORCE_REFRESH_MIN_INTERVAL_MS
    : TOKEN_REFRESH_INTERVAL_MS;

  const last = lastTokenRefreshAt.get(botId) || 0;
  const elapsed = now - last;

  if (elapsed < minInterval) {
    // Skip refresh to avoid spamming external API
    return false;
  }

  await updateBotAccessToken(botId);
  lastTokenRefreshAt.set(botId, Date.now());
  return true;
}

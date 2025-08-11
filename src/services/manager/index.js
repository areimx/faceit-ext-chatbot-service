/**
 * @file manager/index.js
 * Main application process that manages multiple bot instances.
 * Fetches active bot configurations from the database API and spawns
 * dedicated worker processes for each bot.
 */

require('dotenv').config();

const { spawn } = require('child_process');
const http = require('http');

const { constants } = require('../../config');
const { getRequest } = require('../../lib/http/client.js');
const { botLog } = require('../../lib/utils');
const { parseJsonField } = require('../../lib/utils/parsers');

// --- STATE ---

const childProcesses = new Map(); // Bot ID -> child process
const botFailures = new Map(); // Bot ID -> failure info
let isShuttingDown = false;

// --- RECOVERY MECHANISM ---

/**
 * Recovery mechanism: Periodically restart bots that have been stuck for more than 1 hour.
 * Implements exponential backoff for process restart strategy.
 */
function startRecoveryMechanism() {
  setInterval(
    () => {
      const now = Date.now();
      const recoveryThreshold = 60 * 60 * 1000; // 1 hour recovery threshold

      botFailures.forEach((failure, botId) => {
        if (failure && failure.count >= constants.bot.maxFailures) {
          const timeSinceLastFailure = now - (failure.lastFailureTime || 0);

          if (timeSinceLastFailure > recoveryThreshold) {
            console.log(
              `Recovery: Resetting bot ${botId} after ${Math.round(timeSinceLastFailure / 1000 / 60)} minutes`,
            );

            // Reset and restart
            failure.count = 0;
            failure.nextRestartDelay = constants.bot.initialRestartDelay;

            if (!childProcesses.has(botId)) {
              restartBot(botId);
            }
          }
        }
      });
    },
    30 * 60 * 1000,
  ); // Check every 30 minutes
}

/**
 * Restart a bot ensuring we re-fetch its configuration (and refresh tokens) from the DB API
 * before spawning a new child process. We still only pass the `bot_id` to the child, as the
 * child process fetches credentials on its own, but this call ensures the DB API is reachable
 * and the bot token refresh side-effect runs.
 */
async function restartBot(botId) {
  try {
    // Intentionally call the config endpoint to trigger token refresh and verify DB API health
    await getRequest(`http://localhost:3008/bots/${botId}/config`, {
      timeout: 5000,
    });

    console.log(`Restarting bot ${botId}`);
    // Spawn with the latest id; child will fetch its own fresh credentials
    createChatBotProcess({ bot_id: botId });
  } catch (error) {
    console.error(`Failed to restart bot ${botId}:`, error.message);
  }
}

// --- HEALTH MONITORING ---

/**
 * Health check function to ensure the parent process is working correctly.
 * This can be called by external monitoring systems.
 */
function healthCheck() {
  const activeBots = childProcesses.size;
  let failedBots = 0;
  botFailures.forEach((failure) => {
    if (failure && failure.count >= constants.bot.maxFailures) {
      failedBots++;
    }
  });

  return {
    status: isShuttingDown ? 'shutting_down' : 'healthy',
    activeBots,
    failedBots,
    totalBots: activeBots + failedBots,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    // Database API availability tracked by individual worker processes
  };
}

/**
 * Starts a  HTTP server for health checks and monitoring.
 */
function startHealthServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      const health = healthCheck();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health));
    } else if (req.url === '/status') {
      const status = {
        childProcesses: Array.from(childProcesses.keys()),
        botFailures: Array.from(botFailures.entries()).map(
          ([botId, failure]) => ({
            botId,
            failureCount: failure?.count || 0,
            nextRestartDelay: failure?.nextRestartDelay || 0,
          }),
        ),
        health: healthCheck(),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status, null, 2));
    } else if (req.url === '/restart-bot' && req.method === 'POST') {
      // Single endpoint for restarting bots (combines reset and force restart)
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          const { botId } = parseJsonField(body, {});
          if (botId) {
            // Kill existing process if running
            if (childProcesses.has(botId)) {
              childProcesses.get(botId).kill('SIGTERM');
              childProcesses.delete(botId);
            }

            // Reset failure count
            if (botFailures.has(botId)) {
              const failure = botFailures.get(botId);
              failure.count = 0;
              failure.nextRestartDelay = constants.bot.initialRestartDelay;
            }

            // Restart the bot
            restartBot(botId)
              .then(() => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(
                  JSON.stringify({
                    success: true,
                    message: `Bot ${botId} restarted`,
                  }),
                );
                return true;
              })
              .catch((error) => {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(
                  JSON.stringify({ success: false, error: error.message }),
                );
                throw error;
              });
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({ success: false, error: 'Invalid bot ID' }),
            );
          }
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
        }
      });
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  const port = process.env.HEALTH_PORT || 3009;
  server.listen(port, () => {
    console.log(`Health check server listening on port ${port}`);
  });

  return server;
}

// --- BOT LIFECYCLE MANAGEMENT ---

/**
 * Attempts to connect to the database API and start all active bots.
 * If the API is unavailable, it will retry with a delay.
 */
async function startBots() {
  const maxRetries = 30; // Increased from 10 to 60 (30 minutes total)
  let attempts = 0;

  while (attempts < maxRetries) {
    try {
      console.log(
        `Attempting to connect to database API (Attempt ${
          attempts + 1
        }/${maxRetries})...`,
      );

      const isHealthy = await checkApiHealth();
      if (!isHealthy) {
        throw new Error('API health check failed');
      }

      const bots = await fetchActiveBots();
      if (bots !== null) {
        return startBotsFromList(bots);
      }
    } catch (error) {
      console.error('Failed to connect to database API:', error.message);
    }

    attempts++;
    if (attempts < maxRetries) {
      const retryDelay = 30; // seconds (no spam, reasonable delay)
      console.log(`Will retry in ${retryDelay} seconds...`);
      await sleep(retryDelay * 1000);
    } else {
      console.error(
        'Could not connect to the database API after 30 minutes. Exiting to allow PM2 restart.',
      );
      process.exit(1); // Exit to allow PM2 to restart the parent process
    }
  }
}

/**
 * Checks if the database API is healthy
 * @returns {Promise<boolean>} - True if healthy, false otherwise
 */
async function checkApiHealth() {
  const healthResponse = await getRequest(`http://localhost:3008/health`, {
    timeout: 5000,
  });

  if (healthResponse) {
    console.log('Database API health check passed.');
    return true;
  }
  return false;
}

/**
 * Fetches the list of active bots from the API
 * @returns {Promise<Array|null>} - Array of bots or null if failed
 */
async function fetchActiveBots() {
  const response = await getRequest(`http://localhost:3008/bots/active`, {
    timeout: 10000,
  });

  if (response) {
    console.log('Successfully connected to database API. Starting bots...');
    return response;
  }
  return null;
}

/**
 * Starts bot processes from the provided list
 * @param {Array} bots - List of bot configurations
 */
function startBotsFromList(bots) {
  if (bots.length === 0) {
    console.log('There are no active bots.');

    if (process.send) {
      process.send('ready');
    }
    return;
  }

  bots.forEach((bot, index) => {
    setTimeout(() => createChatBotProcess(bot), index * 3000);
  });

  if (process.send) {
    process.send('ready');
  }
}

/**
 * Creates and monitors a single bot child process.
 * @param {object} bot - The bot object from the database.
 */
function createChatBotProcess(bot) {
  const botId = bot.bot_id;

  // Reset the failure count for this bot upon a successful start attempt.
  botFailures.set(botId, {
    count: 0,
    nextRestartDelay: constants.bot.initialRestartDelay,
  });

  botLog(botId, 'log', 'Spawning process...');
  const childEnv = { ...process.env, bot_id: botId };
  const nodeExecutable = process.env.NODE_EXECUTABLE_PATH || 'node';
  const child = spawn(nodeExecutable, ['src/services/worker/index.js'], {
    env: childEnv,
    shell: true,
  });
  childProcesses.set(botId, child);

  // Set a timeout for child process startup
  const startupTimeout = setTimeout(() => {
    if (child && !child.killed) {
      botLog(botId, 'error', 'Child process startup timeout - killing process');
      child.kill('SIGKILL');
    }
  }, 60000); // 1 minute timeout

  child.stdout.on('data', (data) => {
    botLog(botId, 'log', data.toString().trim());
  });

  child.stderr.on('data', (data) => {
    console.error(`Bot ${botId} stderr: ${data.toString().trim()}`);
  });

  child.on('close', (code) => {
    clearTimeout(startupTimeout);
    console.log(`Bot ${botId} process exited with code ${code}.`);

    // Clean up the child process reference
    childProcesses.delete(botId);

    handleBotExit(bot);
  });

  child.on('error', (err) => {
    clearTimeout(startupTimeout);
    console.error(`Failed to start process for Bot ${botId}:`, err);

    // Clean up the child process reference
    childProcesses.delete(botId);

    // Handle spawn failure
    handleBotExit(bot);
  });

  // Clear startup timeout if child starts successfully
  child.on('spawn', () => {
    clearTimeout(startupTimeout);
    botLog(botId, 'log', 'Child process spawned successfully');
  });
}

/**
 * Handles the logic for when a bot process exits unexpectedly.
 * Implements a simple exponential backoff strategy.
 * @param {object} bot - The bot object that exited.
 */
function handleBotExit(bot) {
  const botId = bot.bot_id;

  const failure = botFailures.get(botId) || {
    count: 0,
    nextRestartDelay: constants.bot.initialRestartDelay,
  };
  failure.count++;
  failure.lastFailureTime = Date.now();
  botFailures.set(botId, failure);

  botLog(botId, 'log', `Has failed ${failure.count} time(s).`);

  // Exponential backoff: 5min, 10min, 20min, 40min, 80min, then cap at 1 hour
  const baseDelay = constants.bot.initialRestartDelay; // 5 minutes
  const restartDelay = Math.min(
    baseDelay * Math.pow(2, failure.count - 1),
    60 * 60 * 1000, // Cap at 1 hour
  );

  failure.nextRestartDelay = restartDelay;

  botLog(
    botId,
    'log',
    `Will restart in ${Math.round(restartDelay / 1000 / 60)} minutes.`,
  );

  setTimeout(() => {
    botLog(botId, 'log', 'Restarting...');
    createChatBotProcess(bot);
  }, restartDelay);
}

// --- UTILITIES & SHUTDOWN ---

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Gracefully terminates all child processes.
 */
async function exitChildProcesses() {
  console.log('Terminating all child bot processes...');

  const activeChildren = Array.from(childProcesses.values()).filter(
    (child) => child && !child.killed,
  );

  if (activeChildren.length === 0) {
    console.log('No child processes to terminate.');
    return;
  }

  console.log(`Terminating ${activeChildren.length} child processes...`);

  // Create close promises for each child
  const closePromises = activeChildren.map(
    (child) =>
      new Promise((resolve) => {
        const onClose = () => resolve();
        child.once('close', onClose);
        child.once('exit', onClose);
      }),
  );

  // Send SIGTERM to all children
  activeChildren.forEach((child) => {
    try {
      child.kill('SIGTERM');
    } catch (error) {
      console.error('Error sending SIGTERM to child process:', error);
    }
  });

  // Wait up to 8 seconds for children to close, then SIGKILL any stragglers
  const timeoutMs = 8000;
  await Promise.race([
    Promise.allSettled(closePromises),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);

  activeChildren.forEach((child) => {
    if (child && !child.killed) {
      try {
        console.log('Force killing child process after timeout...');
        child.kill('SIGKILL');
      } catch (error) {
        console.error('Error force killing child process:', error);
      }
    }
  });

  // Clear references
  childProcesses.clear();
}

// Ensure graceful shutdown on various termination signals.
async function gracefulShutdown(eventType, error) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  if (error) {
    console.error('Uncaught error:', error);
  }
  console.log(`Received ${eventType}. Starting graceful shutdown...`);

  // Close health server if running
  if (healthServer && typeof healthServer.close === 'function') {
    try {
      await new Promise((resolve) => healthServer.close(() => resolve()));
      console.log('Health server closed.');
    } catch (e) {
      console.error('Error closing health server:', e);
    }
  }

  await exitChildProcesses();

  // Small delay to flush logs
  await sleep(250);
  process.exit(error ? 1 : 0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGUSR1', () => gracefulShutdown('SIGUSR1'));
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2'));
process.on('uncaughtException', (err) =>
  gracefulShutdown('uncaughtException', err),
);

// --- INITIALIZATION ---

console.log(
  'Starting chatbot-app in 5 seconds to ensure database API is ready...',
);

// Start health check server
const healthServer = startHealthServer();

// Start recovery mechanism
startRecoveryMechanism();

setTimeout(() => {
  startBots();
}, 5000);

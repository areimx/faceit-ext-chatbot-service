/**
 * @file ecosystem.config.js
 * PM2 configuration file.
 * This file defines the processes that PM2 will manage. It includes two main applications:
 * 1. `chatbot-db-api`: The Express server that provides a REST API for the database.
 * 2. `chatbot-app`: The main application that spawns and manages individual bot processes.
 *
 * It's configured to restart the services on a cron schedule and adds timestamps to logs.
 * The restart_delay ensures that if a service crashes, it waits before attempting to restart,
 * preventing rapid-fire restart loops.
 */
module.exports = {
  apps: [
    {
      name: 'chatbot-db-api',
      script: 'src/services/db-api/index.js',
      restart_delay: 30000, // 30 seconds
      cron_restart: '0 */12 * * *',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      wait_ready: true,
      listen_timeout: 60000, // 60 seconds
      kill_timeout: 10000, // 10 seconds
      env_production: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'chatbot-app',
      script: 'src/services/manager/index.js',
      restart_delay: 30000, // 30 seconds
      cron_restart: '0 */12 * * *',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      wait_ready: true,
      listen_timeout: 60000, // 60 seconds
      kill_timeout: 10000, // 10 seconds
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};

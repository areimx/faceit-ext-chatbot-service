/**
 * @file startup.js
 * Startup script to ensure proper initialization sequence
 * Starts the database API service first, then the manager service
 * which spawns individual worker processes for each bot
 */

const { spawn } = require('child_process');

console.log('Starting Chatbot services...');

// Start database API service first (src/services/db-api)
console.log('1. Starting database API service...');
const dbApi = spawn(
  'pm2',
  ['start', 'ecosystem.config.js', '--only', 'chatbot-db-api'],
  {
    stdio: 'inherit',
    shell: true,
  },
);

dbApi.on('close', (code) => {
  if (code === 0) {
    console.log('Database API service started successfully.');

    setTimeout(() => {
      console.log('2. Starting manager service (spawns worker processes)...');
      const chatbotApp = spawn(
        'pm2',
        ['start', 'ecosystem.config.js', '--only', 'chatbot-app'],
        {
          stdio: 'inherit',
          shell: true,
        },
      );

      chatbotApp.on('close', (code) => {
        if (code === 0) {
          console.log('Manager service started successfully.');
          console.log('All services are now running!');
          console.log('- Database API: src/services/db-api');
          console.log('- Manager: src/services/manager (spawns workers)');
          console.log('- Workers: src/services/worker (one per bot)');
          console.log('');
          console.log('Use "pm2 status" to check service status');
          console.log('Use "pm2 logs" to view logs');
        } else {
          console.error('Failed to start manager service.');
          process.exit(1);
        }
      });
    }, 10000); // 10 seconds
  } else {
    console.error('Failed to start database API.');
    process.exit(1);
  }
});

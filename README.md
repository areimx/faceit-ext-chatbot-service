# FACEIT Chatbot Service

**⚠️ Disclaimer:** This is an independent, community-driven project and is not affiliated with, endorsed by, validated by, or sponsored by FACEIT (ESL FACEIT GROUP LIMITED). Any use of FACEIT's name or services is for descriptive purposes only.

A multi-process XMPP chatbot service for FACEIT chat rooms that handles content moderation, automated messages, and bot commands.

- The version from 2021 that connected to FACEIT's legacy chat service is available in the `chat-legacy` branch.

## Related Projects

This repository consists of only the service that interact within chat rooms per the database configuration.
There is a second repository of a dedicated web application for managing the configurations.

**Note:** Both the management dashboard and this service must connect to the same MySQL database and are designed to make unauthenticated requests to each other within a private network.

- **Management Dashboard**:
  - Use this web application to set up all related configurations such as adding bots, entities, managing their configuration.
  - **Note:** The `faceit-chatbot-dashboard` repository is currently under development and will be made public shortly.

## Architecture Overview

```
src/
├── services/              # Deployable services
│   ├── manager/           # Process management service
│   ├── worker/            # Individual bot worker processes
│   └── db-api/            # Database API service
├── modules/               # Business logic modules
│   ├── messaging/         # Commands and timed messages
│   ├── moderation/        # Content moderation and filtering
│   ├── monitoring/        # Health monitoring and debugging
│   └── processing/        # Message processing pipeline
├── lib/                   # Shared utilities
│   ├── http/              # HTTP client utilities
│   ├── utils/             # General utilities & ID management
│   └── xmpp/              # XMPP protocol utilities
├── core/                  # Internal utilities
│   └── state-manager.js   # Worker state coordination
└── config/                # Configuration management
```

See docs/ARCHITECTURE.md for detailed information.

## Services

### Manager Service

- Spawns and manages bot worker processes
- Handles process restarts and health monitoring
- Provides internal API for bot management

### Worker Service

- Individual bot instance handling assigned chat rooms
- XMPP connection management with automatic reconnection
- Message processing pipeline with modular architecture
- Handles entity assignment and configuration updates

### Database API Service

- HTTP API providing entity configurations to worker processes
- MySQL database integration with connection pooling
- Handles bot credential management and token refresh

## Features

- Content moderation with configurable profanity filters and read-only mode
- Automated timed messages sent to chat rooms based on message count
- Bot commands that respond with configured messages
- Multi-room support with individual entity configurations
- Automatic reconnection and health monitoring

## Environment Configuration

### Required Environment Variables

```bash
# Application Environment
APP_ENV=production|staging

# Database Configuration
DB_HOST=<database_host>
DB_PORT=<database_port>
DB_USER=<database_user>
DB_PASS=<database_password>
DB_NAME=<database_name>

# Service Ports
DB_API_PORT=3008
HEALTH_PORT=3009

# Bot Configuration (for worker processes)
bot_id=<unique_bot_identifier>

# FACEIT API Authentication
CLIENT_ID=<faceit_client_id>
CLIENT_SECRET=<faceit_client_secret>

# Process Configuration
NODE_EXECUTABLE_PATH=<path_to_node_executable>

# Logging Configuration
LOG_VERBOSE=true|false

# Optional Staging Bot Credentials (APP_ENV=staging only)
STAGE_BOT_GUID=<staging_bot_guid>
STAGE_BOT_TOKEN=<staging_bot_token>
STAGE_BOT_NICKNAME=<staging_bot_nickname>
STAGE_BOT_ENTITY_GUID=<staging_entity_guid>
```

### Staging vs Production

- **Staging**: Uses hardcoded bot credentials
- **Production**: Fetches fresh credentials from FACEIT API

## Deployment

### Startup Process

#### Option 1: Automatic Startup (Recommended)

```bash
# Start all services
pm2 start ecosystem.config.js

# Monitor processes
pm2 monit

# View logs
pm2 logs chatbot-app
pm2 logs chatbot-db-api
```

#### Option 2: Manual Startup Sequence

```bash
# Use the startup script for proper initialization order
node scripts/startup.js

# Or start manually in sequence:
pm2 start ecosystem.config.js --only chatbot-db-api
# Wait for database to initialize, then:
pm2 start ecosystem.config.js --only chatbot-app
```

#### Option 3: Individual Service Management

```bash
# Start database API first
pm2 start ecosystem.config.js --only chatbot-db-api

# Wait for database to be ready (check logs), then start chatbot app
pm2 start ecosystem.config.js --only chatbot-app

# Monitor specific service
pm2 logs chatbot-db-api
pm2 logs chatbot-app
```

### Process Management

- **manager**: Process manager service (auto-restart on failure)
- **db-api**: Database API service (cron restart every 12 hours)
- **worker**: Individual bot instances (managed by manager service)

## API Endpoints

Documented in docs/API.md

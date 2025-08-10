# Architecture Documentation

## System Overview

Multi-process XMPP chatbot service with a manager supervising worker processes. Each worker handles assigned chat rooms with modular message processing.

## Service Architecture

### Manager Service (`services/manager`)

Supervisor process that spawns and manages bot worker instances.

**Responsibilities**:

- Spawn bot processes with unique `bot_id`
- Handle process restarts with exponential backoff
- Provide internal API for entity assignment/unassignment
- Monitor process health and manage lifecycle

### Worker Service (`services/worker`)

Individual bot worker instance handling assigned chat rooms.

**Responsibilities**:

- XMPP connection management
- Message processing pipeline
- Entity assignment/unassignment via internal API
- Module coordination

**Module structure**:

```javascript
const messageProcessor = new MessageProcessor(config, stateManager, idManager);
const moderation = new Moderation({ config, stateManager, xmppActions, ... });
const healthMonitor = new HealthMonitor(config, stateManager);
```

### Database API Service (`services/db-api`)

HTTP API service providing entity data to worker processes.

**Responsibilities**:

- Serve entity configurations to bot processes
- Handle UUID-based entity storage and retrieval
- Support staging and production environments

**API Endpoints**:

- `GET /entities/:entityId` - Retrieve entity configuration
- `GET /entities` - List all available entities

## Data Flow Architecture

### Entity Assignment Flow

```
1. External System → POST /assign/:entityId → chatbot-app
2. chatbot-app → POST /assign/:entityId → target bot process
3. Bot process → GET /entities/:entityId → database API
4. Bot process → XMPP join room → FACEIT servers
5. Bot process → Subscribe to supergroup → Live message reception
```

### Message Processing Flow

```
1. FACEIT Server → XMPP Message → Bot Process
2. Bot Process → Message Validation → processing/message-processor.js
3. Bot Process → Content Moderation → moderation/moderation.js
4. Bot Process → Timed Messages → messaging/timed-messages.js
5. Bot Process → Command Processing → messaging/commands.js
6. Bot Process → XMPP Response → FACEIT Server
```

### XMPP Protocol Flow

```
1. Connection: XMPP Client → FACEIT XMPP Server
2. Authentication: Bot Credentials → OAuth Token
3. Room Joining: MUC Light Config Query → Room Join
4. Subscription: Supergroup Subscribe → Live Messages
5. Message Processing: Incoming Messages → Processing Pipeline
6. Response: Outgoing Messages → XMPP Server
```

## Module Architecture

### Message Processing Pipeline

- **`processing/message-processor.js`** - Message validation and entity verification
- **`moderation/moderation.js`** - Content filtering and user muting
- **`messaging/timed-messages.js`** - Automated message sending based on counts
- **`messaging/commands.js`** - Bot command processing and responses

### Supporting Modules

- **`monitoring/health-monitor.js`** - Connection health and ping tracking
- **`monitoring/debug-handler.js`** - Verbose logging when enabled
- **`lib/xmpp/`** - XMPP protocol utilities and stanza creation
- **`config/`** - Environment and timing configuration

## Worker Implementation

### State Management

Worker processes use a `StateManager` class to coordinate state between modules:

- XMPP connection state and credentials
- Entity configurations and assigned rooms
- Message processing queues and counters
- Connection health and timing data

State is maintained in memory per worker process and rebuilt from entity assignments on restart.

### Module Integration

Each worker initializes modules with shared state access:

```javascript
const stateManager = new StateManager(config);
const messageProcessor = new MessageProcessor(config, stateManager, idManager);
const moderation = new Moderation({ config, stateManager, xmppActions, ... });
const healthMonitor = new HealthMonitor(config, stateManager);
```

Common state operations:

```javascript
// Entity management
stateManager.hasEntity(entityId);
stateManager.getEntity(entityId);
stateManager.setEntity(entityId, entityData);

// Message processing
stateManager.incrementMessageCount(roomId);
stateManager.getAutoMessageTurn(roomId);

// Configuration updates
stateManager.onStateChange('entity:updated', (data) => {
  // Handle configuration changes
});
```

## Error Handling

### Connection Recovery

- Authentication failures trigger automatic token refresh and reconnection
- Network issues use exponential backoff retry mechanism
- Process crashes trigger automatic restart with backoff delays

### Entity Management

- 404 errors automatically set entity status to `inactive` in database
- Only `active` entities are returned in bot entity queries
- Assignment errors trigger cleanup and retry mechanisms

### Health Monitoring

- Continuous connection health checks and server ping tracking
- Process watchdog monitors for stuck connections and forces restarts
- Manual memory cleanup for orphaned state data

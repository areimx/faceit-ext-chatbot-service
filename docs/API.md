# API Documentation

## Overview

Three internal API services handle different aspects of the system:

1. **Worker API** - Bot process management and entity assignment
2. **Database API** - Entity configuration and bot credentials
3. **Manager API** - Process supervision and health monitoring

## Worker API

**Base URL**: `http://localhost:3000` (per worker process)

### Health Check

#### `GET /health`

Check worker process health status.

**Response**:

```json
{
  "status": "healthy",
  "botId": "bot-7",
  "entities": 3,
  "uptime": 3600,
  "lastMessageTime": "2025-01-09T12:30:00.000Z"
}
```

### Entity Management

#### `POST /assign/:entityId`

Assign an entity to the worker process.

**Parameters**:

- `entityId` (string, required) - UUID of the entity to assign

**Response**:

```json
{
  "success": true,
  "entityId": "2cbf50c0-f8bb-4364-aa2e-dad61bf8e965",
  "message": "Entity assigned successfully"
}
```

#### `POST /unassign/:entityId`

Unassign an entity from the worker process.

**Parameters**:

- `entityId` (string, required) - UUID of the entity to unassign

**Response**:

```json
{
  "success": true,
  "entityId": "2cbf50c0-f8bb-4364-aa2e-dad61bf8e965",
  "message": "Entity unassigned successfully"
}
```

#### `POST /update/:entityId`

Update entity configuration in real-time.

**Parameters**:

- `entityId` (string, required) - UUID of the entity to update

**Response**:

```json
{
  "success": true,
  "entityId": "2cbf50c0-f8bb-4364-aa2e-dad61bf8e965",
  "message": "Entity configuration updated"
}
```

#### `POST /refresh-preset/:presetId`

Refresh banned words preset.

**Parameters**:

- `presetId` (string, required) - UUID of the preset to refresh

**Response**:

```json
{
  "success": true,
  "presetId": "preset-123",
  "message": "Preset refreshed successfully"
}
```

## Database API

**Base URL**: `http://localhost:3008` (database service)

### Health Check

#### `GET /health`

Database service health check.

**Response**:

```json
{
  "status": "ok",
  "timestamp": "2025-01-09T12:30:00.000Z"
}
```

### Bot Management

#### `GET /bots/active`

Get all active bot configurations.

**Response**:

```json
[
  {
    "bot_id": "7"
  },
  {
    "bot_id": "8"
  }
]
```

#### `GET /bots/:botId/config`

Get bot-specific configuration and credentials.

**Parameters**:

- `botId` (string, required) - Bot identifier

**Query Parameters**:

- `force` (boolean, optional) - Force token refresh

**Response**:

```json
{
  "bot_guid": "5bfc3528-ca05-4ea0-9c33-8171ac05dbd4",
  "chat_token": "encrypted_chat_token",
  "bot_token": "access_token",
  "bot_name": "Bot 7"
}
```

#### `GET /bots/:botId/entities`

Get entities assigned to a specific bot.

**Parameters**:

- `botId` (string, required) - Bot identifier

**Response**:

```json
[
  {
    "entity_guid": "2cbf50c0-f8bb-4364-aa2e-dad61bf8e965",
    "entity_name": "Test Club",
    "entity_type": "community"
  }
]
```

### Entity Configuration

#### `GET /entities/:entityId/data`

Get detailed entity configuration.

**Parameters**:

- `entityId` (string, required) - Entity UUID

**Response**:

```json
{
  "guid": "2cbf50c0-f8bb-4364-aa2e-dad61bf8e965",
  "name": "Test Club",
  "type": "community",
  "commands": {
    "help": {
      "response": "Available commands: !help, !info"
    }
  },
  "timers": [
    {
      "message": "Welcome to our club!",
      "upload_id": "image-uuid"
    }
  ],
  "timer_counter_max": 30,
  "read_only": false,
  "welcome_message": null,
  "parent_guid": null
}
```

#### `POST /entities/:entityId/update`

Trigger real-time entity update notification.

**Parameters**:

- `entityId` (string, required) - Entity UUID

**Response**:

```
Status: 200 OK
```

#### `POST /entities/:entityId/assign`

Assign entity to a bot.

**Parameters**:

- `entityId` (string, required) - Entity UUID

**Request Body**:

```json
{
  "botId": "7"
}
```

**Response**:

```
Status: 200 OK
```

#### `POST /entities/:entityId/unassign`

Unassign entity from bot.

**Parameters**:

- `entityId` (string, required) - Entity UUID

**Response**:

```
Status: 200 OK
```

#### `POST /entities/:entityId/status`

Update entity status.

**Parameters**:

- `entityId` (string, required) - Entity UUID

**Request Body**:

```json
{
  "status": "active"
}
```

**Response**:

```
Status: 200 OK
```

### Profanity Filter

#### `GET /profanity-filter-presets/:presetId`

Get banned words preset.

**Parameters**:

- `presetId` (string, required) - Preset UUID

**Response**:

```json
{
  "preset_id": "preset-123",
  "name": "Standard Filter",
  "words": ["word1", "word2"]
}
```

#### `POST /profanity-filter-presets/:presetId/refresh`

Refresh banned words preset across all bots.

**Parameters**:

- `presetId` (string, required) - Preset UUID

**Response**:

```
Status: 200 OK
```

#### `GET /profanity-filter-config/:entityId`

Get profanity filter configuration for entity.

**Parameters**:

- `entityId` (string, required) - Entity UUID

**Response**:

```json
{
  "entity_guid": "2cbf50c0-f8bb-4364-aa2e-dad61bf8e965",
  "banned_words_preset_id": "preset-123",
  "custom_words": "customword1,customword2",
  "discord_webhook_url": "https://discord.com/api/webhooks/...",
  "discord_custom_message": "Custom notification message",
  "message_reply": "Please watch your language",
  "mute_duration_seconds": 10,
  "is_active": 1,
  "manager_guids": ["user-uuid-1", "user-uuid-2"]
}
```

## Manager API

**Base URL**: `http://localhost:3009` (manager service)

### Health Monitoring

#### `GET /health`

Get manager service health status.

**Response**:

```json
{
  "activeBots": 2,
  "failedBots": 0,
  "totalBots": 2,
  "uptime": 3600,
  "memoryUsage": {
    "rss": 45678912,
    "heapTotal": 23456789,
    "heapUsed": 12345678
  }
}
```

#### `GET /status`

Get detailed manager and worker process status.

**Response**:

```json
{
  "childProcesses": ["7", "8"],
  "botFailures": [
    {
      "botId": "7",
      "failureCount": 0,
      "nextRestartDelay": 1000
    }
  ],
  "health": {
    "activeBots": 2,
    "failedBots": 0,
    "totalBots": 2,
    "uptime": 3600
  }
}
```

### Process Management

#### `POST /restart-bot`

Restart a specific worker process.

**Request Body**:

```json
{
  "botId": "7"
}
```

**Response**:

```json
{
  "success": true,
  "message": "Bot 7 restarted"
}
```

**Error Response**:

```json
{
  "success": false,
  "error": "Invalid bot ID"
}
```

## Error Handling

### HTTP Status Codes

- `200` - Success
- `400` - Bad Request
- `404` - Not Found
- `500` - Internal Server Error

### Error Response Format

```json
{
  "error": "Error description",
  "entityId": "2cbf50c0-f8bb-4364-aa2e-dad61bf8e965",
  "timestamp": "2025-01-09T12:30:00.000Z"
}
```

## Authentication

All APIs are internal and accessible only from localhost. No authentication is required for internal communication between services.

## Usage Examples

### Check Database API Health

```bash
curl http://localhost:3008/health
```

### Get Active Bots

```bash
curl http://localhost:3008/bots/active
```

### Assign Entity to Worker

```bash
curl -X POST http://localhost:3000/assign/2cbf50c0-f8bb-4364-aa2e-dad61bf8e965
```

### Restart Bot Process

```bash
curl -X POST http://localhost:3009/restart-bot \
  -H "Content-Type: application/json" \
  -d '{"botId": "7"}'
```

process.on('unhandledRejection', async (err) => { 
	console.error(err);
  await sleep(30*1000);
	process.exit(1);
});

/* DEPENDENCIES */
require('dotenv').config();
const axios = require('axios');
const util = require('util');
const mysql = require('mysql');
const express = require('express');
const qs = require('qs');

/* EXPRESS CONFIGURATION */
const app = express();
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));

/* SQL POOL */
const pool = mysql.createPool({
  connectionLimit: 10,
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  charset: 'utf8mb4'
});

pool.getConnection((err, connection) => {
  if (err) {
    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
      console.error('Database connection was closed.')
    }
    if (err.code === 'ER_CON_COUNT_ERROR') {
      console.error('Database has too many connections.')
    }
    if (err.code === 'ECONNREFUSED') {
      console.error('Database connection was refused.')
    }
  }

  if (connection) connection.release()

  return
});

pool.query = util.promisify(pool.query);

/* setInterval(updateAccessTokens, 12*60*60*1000);
async function updateAccessTokens() {
  let botDataQuery = await pool.query(
      "SELECT bot_id, bot_refresh_token FROM bots WHERE bot_status = 'active'"
  );
  if (botDataQuery) {
    botDataQuery.forEach(async (bot) => {
      if (bot["bot_refresh_token"].length === 36) {
        await updateBotAccessToken(bot["bot_id"], bot["bot_refresh_token"]);
        await sleep(1000);
      }
    });
  }
} */

async function updateBotAccessToken(botId) {
  const botDataQuery = await pool.query(
      "SELECT bot_refresh_token FROM bots WHERE bot_id=?",
      [botId]
  );
  if (!botDataQuery[0]) return true;

  const refreshToken = botDataQuery[0].bot_refresh_token;
  if (refreshToken.length !== 36) return true;

  const authorizationBasic = Buffer.from(`${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`).toString('base64');
  const tokenRefreshRequest = await postRequest(
    `https://api.faceit.com/auth/v1/oauth/token`,
      qs.stringify({
        "grant_type": "refresh_token",
        "refresh_token": refreshToken
      }),
      {
        "headers": {
          "Authorization": `Basic ${authorizationBasic}`,
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
  );
  if (tokenRefreshRequest && tokenRefreshRequest.access_token) {
    await pool.query(
      "UPDATE bots SET bot_token=? WHERE bot_id=?",
      [tokenRefreshRequest.access_token, botId]
    );
  }
  return true;
}

async function getBotCredentials(botId) {
  let botDataQuery = await pool.query(
    "SELECT bot_guid, bot_token FROM bots WHERE bot_id=?",
    [botId]
  );
  if (botDataQuery[0]) {
    return {
      "guid": botDataQuery[0].bot_guid,
      "token": botDataQuery[0].bot_token
    };
  }
  return false;
}

/* REST ENDPOINT */
app.get('/bots/active', async function (req, res) {
  let botDataQuery = await pool.query(
      "SELECT bot_id FROM bots WHERE bot_status = 'active'"
  );
  if (botDataQuery) {
    const botIds = [];
    for (let i = 0; i<botDataQuery.length; i++) {
      botIds.push(botDataQuery[i]);
    }
    res.json(botIds);
  }
  else {
    res.sendStatus(500);
  }
});

app.get('/bots/:botId/config', async function (req, res) {
  const botId = req.params.botId;
  
  await updateBotAccessToken(botId); 
  const botData = await getBotCredentials(botId);

  if (botData)
    res.json(botData);
  else
    res.sendStatus(500);
});

async function getEntityData(entityId) {
  let entityDataQuery = await pool.query(
    `SELECT entities.entity_commands, entities.entity_timers, entities.timer_counter_max, entities.read_only, welcome_messages.message FROM entities 
    LEFT JOIN welcome_messages on welcome_messages.entity_guid = entities.entity_guid
    WHERE entities.entity_guid=? LIMIT 1`,
    [entityId]
  );
  if (entityDataQuery[0]) {
    let commandsList = {};
    let timersList = [];
    let timer_counter_max = 30;
    let read_only = false;
    let welcome_message = null;
    
    if (entityDataQuery[0].entity_commands)
      commandsList = JSON.parse(entityDataQuery[0].entity_commands);
    if (entityDataQuery[0].entity_timers)
      timersList = JSON.parse(entityDataQuery[0].entity_timers);
    if (entityDataQuery[0].timer_counter_max)
      timer_counter_max = entityDataQuery[0].timer_counter_max;
    if (entityDataQuery[0].read_only)
      read_only = entityDataQuery[0].read_only ? true : false;
    if (entityDataQuery[0].message)
      welcome_message = entityDataQuery[0].message;

    return {
        "guid": entityId,
        "commands": commandsList,
        "timers": timersList,
        "timer_counter_max": timer_counter_max,
        "read_only": read_only,
        "welcome_message": welcome_message
    };
  }
}

app.get('/bots/:botId/entities', async function (req, res) {
    const botId = req.params.botId;
    const entities = {};
    let entitiesQuery = await pool.query(
        "SELECT entity_guid FROM bot_entity_relations WHERE bot_id=?",
        [botId]
    );
    for (let i = 0; i < entitiesQuery.length; i++) {
        let entityId = entitiesQuery[i].entity_guid;
        let entityData = await getEntityData(entityId);
        if (entityData)
          entities[`hub-${entityId}-general`] = entityData;
    }
    res.json(entities);
});

app.get('/entities/:entityId/data', async function(req, res) {
  const entityId = req.params.entityId;
  const entityData = await getEntityData(entityId);
  if (entityData)
    res.json(entityData);
  else
    res.sendStatus(200);
});

app.post('/entities/:entityId/update', async function (req, res) {
  res.sendStatus(200);
  const entityId = req.params.entityId;
  let getBotIdQuery = await pool.query(
      "SELECT bot_id FROM bot_entity_relations WHERE entity_guid=? LIMIT 1",
      [entityId]
  );
  if (getBotIdQuery[0]) {
    const botId = getBotIdQuery[0].bot_id;
    const botPort = parseInt(botId)+4000;
    postRequest(`http://localhost:${botPort}/update/${entityId}`);
  }
});

async function postRequest(requestURL, requestBody = null, requestHeaders = null) {
	try {
		const response = await axios.post(requestURL, requestBody, requestHeaders);
		if (response.status == 200 && response.data) {
			return response.data;
		}
	} catch (error) {
		console.error(error);
		return false;
	}
}

function sleep(ms) {
	return new Promise(resolve => {
		setTimeout(resolve, ms);
	})
}

const databaseRestPort = 3008;
// Start Local REST Server
app.listen(databaseRestPort, () => {
    console.log(`Chatbot process database API is running on port ${databaseRestPort}`);
});
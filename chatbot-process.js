const WebSocket = require('ws');
const axios = require('axios');
const express = require('express');

const bannedWords = require('./banned_words.js');

/* EXPRESS CONFIGURATION */
const app = express();
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));

const botId = process.env.bot_id;

let ws, heartbeatIntveralId;
let botCredentials, entities = {};
let messageCounts = Array();
let autoMessageTurn = Array();

let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const initialReconnectDelay = 60*1000;

function reconnect() {
	clearInterval(heartbeatIntveralId);
	
    if (reconnectAttempts < maxReconnectAttempts) {
        const delay = initialReconnectDelay * Math.pow(2, reconnectAttempts);
        setTimeout(startWebsocket, delay);
        reconnectAttempts++;
    } else {
        console.error('Maximum reconnection attempts reached. Exiting.');
        killProcess();
    }
}

async function start() {
	botCredentials = await getRequest(`http://localhost:3008/bots/${botId}/config`);
	entities = await getRequest(`http://localhost:3008/bots/${botId}/entities`);
	if (botCredentials && entities) {
		await startWebsocket(true);
	}
	else {
		await sleep(60*1000);
		killProcess();
	}
} start();

async function startWebsocket(initialStart = false) {
	console.log('New websocket starting...');
	ws = new WebSocket('wss://chat-server.faceit.com/websocket');

    ws.on('open', async function() {
		console.log('WebSocket connection established.');
		reconnectAttempts = 0;
		
		// Send WS messages to authenticate and subscribe to the room
		await wsAuth();

		// Join rooms
		if (initialStart) {
			for(const entity in entities) {
				await joinRoom(entity);
			}
		}

		// Run the heartbeat function every 30 seconds to ping
		heartbeatIntveralId = setInterval(() => {
			heartbeat();
		}, 30 * 1000);
	});
	
	ws.on('close', async function() {
		console.log('WebSocket connection closed.');

		reconnect();
	});

	ws.on('error', async function(error) {
		console.error('WebSocket error:', error);

		reconnect();
	});
	
	ws.on('message', async function(data) {
		// Check if we received a ping from FACEIT
		// First checking the data with startsWith function to avoid an unnecessary regex which is slower
		if (data.startsWith(`<iq from='faceit.com`) && data.match(/^<iq from='faceit\.com' to='(?:.*):ping' type='result' xmlns='jabber:client'\/>$/)) {
			clearTimeout(heartbeatTimeoutId);
		}
		
		// Else, check if we received an actual user message
		else if (data.startsWith('<message')) {
            // Put the message content and the message author ID into an array
			const message = new RegExp(/<message from='(.*?)@conference.faceit.com\/(.*?)'(?:.*)<body>((?:.|\n)*)<\/body>(?:.*)id='(.*?)'/).exec(data);
			if (message && message[0] && message[1] && message[2] && message[3] && message[4]) {
                const messageRoom = message[1];
                const messageAuthor = message[2];
				const messageId = message[4];
				let messageContent = message[3];

				if (bannedWords.some(bannedWord => messageContent.includes(bannedWord))) {
					deleteMessage(messageRoom, messageId);
					muteUser(messageRoom, messageAuthor, 24*60*60);
				}

				if (messageCounts[messageRoom])
					messageCounts[messageRoom]++;
				else
					messageCounts[messageRoom] = 1;

				if (messageCounts[messageRoom] > entities[messageRoom]["timer_counter_max"]) {
					let timers = entities[messageRoom]["timers"];
					if (timers[0]) {
						if (typeof autoMessageTurn[messageRoom] === 'undefined' || typeof timers[++autoMessageTurn[messageRoom]] === 'undefined') autoMessageTurn[messageRoom] = 0;
						sendMessage(messageRoom, timers[autoMessageTurn[messageRoom]]["message"]);
					}
					messageCounts[messageRoom] = 0;
				}

				if (messageContent.startsWith('!')) {
					messageContent = messageContent.substring(1);
					if (entities[messageRoom].commands[messageContent]) {
						sendMessage(messageRoom, entities[messageRoom].commands[messageContent].response);
					}
				}
			}
		}
		// Else check if it is rather a presence about a new member
		else if (data.startsWith("<presence") && data.endsWith("<changed what='added'/><x xmlns='http://jabber.org/protocol/muc#user'><item affiliation='member' role='none'><reason>added</reason></item></x></presence>")) {
			const message = new RegExp(/<presence from='(.{48})\@conference\.faceit\.com\/(.{36})/).exec(data);
			if (message && message[0] && message[1] && message[2]) {
				const messageRoom = message[1];
				const newMemberId = message[2];
				if (entities[messageRoom].welcome_message) {
					sendDirectMessage(newMemberId, entities[messageRoom].welcome_message);
				}
			}
		}
	});
};

async function heartbeat() {
	/*
	/ This function is called every 30 seconds by an interval in the ws.on(open) function
	/ This function sends a ping to FACEIT WS and sets a timeout that terminates WS connection after 30+1 seconds
	/ The timeout ID is assigned to the heartbeatTimeoutId variable and
	/ it gets cancelled through the ws.on(message) function if a ping from FACEIT received afterwards
	*/

	// Set the timeout that will terminate connection after 30 seconds
	heartbeatTimeoutId = setTimeout(() => {
		console.log('No heartbeat, websocket terminated.');
	  	ws.terminate();
	}, 30 * 1000);

	// Send ping
	ws.send(`<iq type='get' to='faceit.com' id='1:ping' xmlns='jabber:client'><ping xmlns='urn:xmpp:ping'/></iq>`);
}

async function getRequest(requestURL) {
	try {
		const response = await axios.get(requestURL);
		if (response.status == 200 && response.data) {
			return response.data;
		}
	} catch (error) {
		console.error(error);
		return false;
	}
}

async function wsAuth() {
	if (!ws || !ws.readyState || ws.readyState !== WebSocket.OPEN) {
        console.error('WebSocket is not open. Unable to send messages. Restarting...');
		reconnect();
        return;
    }

	/*
	/ SASL PLAIN that is needed for the socket authorization is:
	/ {Account GUID}@faceit.com{HEX 0}{Account GUID}{HEX 0}{Access Token}
	/ in base64 format (UTF-8)
	*/
	const saslPlain = Buffer.from(`${botCredentials.guid}@faceit.com\x00${botCredentials.guid}\x00${botCredentials.token}`).toString('base64');
	
	// Sending messages to the socket for autherization and presence in the room
	ws.send(`<open xmlns='urn:ietf:params:xml:ns:xmpp-framing' to='faceit.com' version='1.0'/>`);
	await sleep(300);
	ws.send(`<auth xmlns='urn:ietf:params:xml:ns:xmpp-sasl' mechanism='PLAIN'>${saslPlain}</auth>`);
	await sleep(300);
	ws.send(`<open xmlns='urn:ietf:params:xml:ns:xmpp-framing' to='faceit.com' version='1.0'/>`);
	await sleep(300);
	ws.send(`<iq type='set' id='_bind_auth_2' xmlns='jabber:client'><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'><resource>cb-${botId}</resource></bind></iq>`);
	await sleep(300);
	ws.send(`<iq type='set' id='_session_auth_2' xmlns='jabber:client'><session xmlns='urn:ietf:params:xml:ns:xmpp-session'/></iq>`);
	await sleep(300);
	ws.send(`<presence  xmlns='jabber:client'><x xmlns='http://jabber.org/protocol/muc'><history maxstanzas='0'/></x><priority>10</priority></presence>`);
	await sleep(300);
	ws.send(`<iq id='${botCredentials.guid}@faceit.com-vcard-query' type='get' to='${botCredentials.guid}@faceit.com' xmlns='jabber:client'><vCard xmlns='vcard-temp'/></iq>`);
	await sleep(300);
}

async function joinRoom(room) {
	ws.send(`<presence  from='${botCredentials.guid}@faceit.com/cb-${botId}' to='${room}@conference.faceit.com/${botCredentials.guid}' xmlns='jabber:client'><x xmlns='http://jabber.org/protocol/muc'><history maxstanzas='0'/></x><unsubscribe><initial_presences /><presence_updates /></unsubscribe><priority>10</priority></presence>`);
	await sleep(300);
}

async function deleteMessage(messageRoom, messageId) {
	ws.send(`<iq type='set' to='${messageRoom}@conference.faceit.com' id='1'><query xmlns='urn:xmpp:mam:muc:delete'><item id='${messageId}'/></query></iq>`);
}

async function muteUser(messageRoom, messageAuthor, duration) {
	ws.send(`<iq type='set' to='${messageRoom}@conference.faceit.com' id='1'><query xmlns='urn:xmpp:muc:mute'><muted jid='${messageAuthor}@faceit.com' ttl='${duration}'/></query></iq>`);
}

async function sendMessage(messageRoom, messageContent) {
	ws.send(`<message id='1' to='${messageRoom}@conference.faceit.com' type='groupchat' xmlns='jabber:client'><body>${messageContent.replace(/\\/g, '')}</body></message>`);
}

async function sendDirectMessage(userId, messageContent) {
	ws.send(`<message id='1' from='${botCredentials.guid}@faceit.com' to='${userId}@faceit.com' type='chat' xmlns='jabber:client'><body>${messageContent}</body></message>`);
}

async function updateEntities() {
	entities = await getRequest(`http://localhost:3008/bots/${botId}/entities`);
	for(const entity in entities) {
		joinRoom(entity);
	}
	setTimeout(updateEntities, 10*60*1000);
}
setTimeout(updateEntities, 10*60*1000);

function sleep(ms) {
	return new Promise(resolve => {
		setTimeout(resolve, ms);
	})
}

function killProcess() {
	sleep(30*1000);
	process.exit(1);
}

app.post('/update/:entityId', async function (req, res) {
	res.sendStatus(200);
	const entityId = req.params.entityId;
	entities[`hub-${entityId}-general`] = await getRequest(`http://localhost:3008/entities/${entityId}/data`);
});

const botPort = parseInt(botId)+4000;
app.listen(botPort, () => {
    console.log(`${botId} is listening API requests to port ${botPort}`);
});
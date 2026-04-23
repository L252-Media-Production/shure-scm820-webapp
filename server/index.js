import 'dotenv/config';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { platform } from 'os';
import { WebSocketServer } from 'ws';
import debugLib from 'debug';
import { createBridge } from './bridge.js';
import { startMock } from './mock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.resolve(__dirname, '../client/dist');

const MIME_TYPES = {
  '.html':  'text/html',
  '.js':    'application/javascript',
  '.css':   'text/css',
  '.svg':   'image/svg+xml',
  '.png':   'image/png',
  '.ico':   'image/x-icon',
  '.json':  'application/json',
  '.woff2': 'font/woff2',
  '.woff':  'font/woff',
};

const debug = debugLib('scm820:server');

const WS_PORT    = parseInt(process.env.WS_PORT, 10)    || 8080;
const WS_HOST    = process.env.WS_HOST                  || '0.0.0.0';
const SCM820_PORT = parseInt(process.env.SCM820_PORT, 10) || 2202;
const USE_MOCK   = process.env.USE_MOCK === 'true';
const METER_RATE_MS = 100;

const INPUT_CHANNELS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

const GLOBAL_PARAMS = [
  'DEVICE_ID', 'SERIAL_NUM', 'FW_VER',
  'IP_SUBNET_SHURE_CONTROL', 'IP_GATEWAY_SHURE_CONTROL',
  'NETWORK_AUDIO_PROTOCOL', 'NETWORK_AUDIO_VER',
  'IP_ADDR_NET_AUDIO_PRIMARY', 'IP_SUBNET_NET_AUDIO_PRIMARY', 'IP_GATEWAY_NET_AUDIO_PRIMARY',
  'IP_ADDR_NET_AUDIO_SECONDARY', 'IP_SUBNET_NET_AUDIO_SECONDARY', 'IP_GATEWAY_NET_AUDIO_SECONDARY',
  'INPUT_METER_MODE', 'METER_TYPE', 'HEADPHONE_SOURCE', 'DISABLE_LEDS', 'REAR_PANEL_LOCK',
];

const deviceConfig = {
  host: process.env.SCM820_HOST || '127.0.0.1',
  port: SCM820_PORT,
};

// Returns array of "channel:param" keys matching every GET sent — used by the client to
// track exactly which REPs it still needs before hiding the loading screen.
function requestInitialState(bridge) {
  const keys = [];
  const get = (ch, param) => {
    bridge.sendGet(ch, param);
    keys.push(`${ch ?? 0}:${param}`);
  };

  for (const ch of INPUT_CHANNELS) {
    get(ch, 'CHAN_NAME');
    get(ch, 'AUDIO_MUTE');
    get(ch, 'AUDIO_GAIN_HI_RES');
    get(ch, 'ALWAYS_ON_ENABLE_A');
    get(ch, 'INTELLIMIX_MODE');
    get(ch, 'INPUT_AUDIO_GATE_A');
    get(ch, 'INPUT_AUDIO_SOURCE');
    get(ch, 'PHANTOM_PWR_ENABLE');
    get(ch, 'AUDIO_IN_LVL_SWITCH');
  }
  for (let ch = 10; ch <= 17; ch++) get(ch, 'DIRECT_OUT_SOURCE');
  for (const ch of [18, 19]) {
    get(ch, 'CHAN_NAME');
    get(ch, 'AUDIO_MUTE');
    get(ch, 'AUDIO_GAIN_HI_RES');
    get(ch, 'AUDIO_OUT_LVL_SWITCH');
  }
  for (const p of GLOBAL_PARAMS) get(null, p);

  return keys;
}

function lookupMac(ip) {
  return new Promise((resolve) => {
    const args = platform() === 'win32' ? ['-a', ip] : ['-n', ip];
    execFile('arp', args, (err, stdout) => {
      if (err) { resolve(null); return; }
      const m = stdout.match(/([0-9a-f]{2}[-:]){5}[0-9a-f]{2}/i);
      resolve(m ? m[0].toUpperCase() : null);
    });
  });
}

if (USE_MOCK) {
  await startMock(deviceConfig.port);
}

const httpServer = http.createServer(handleHttpRequest);
const wss = new WebSocketServer({ server: httpServer });

function sendToClient(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

wss.on('connection', (ws) => {
  debug('WS client connected — creating dedicated bridge');

  const bridge = createBridge(deviceConfig.host, deviceConfig.port);

  bridge.emitter.on('connected', async () => {
    debug('Bridge connected for client');
    const expected = requestInitialState(bridge);
    bridge.sendSet(0, 'METER_RATE', String(METER_RATE_MS));
    sendToClient(ws, { type: 'INIT_START', expected });
    sendToClient(ws, { type: 'CONNECTED', host: deviceConfig.host, mac: null });

    const mac = await lookupMac(deviceConfig.host);
    debug('MAC: %s', mac);
    sendToClient(ws, { type: 'CONFIG', host: deviceConfig.host, mac });
  });

  bridge.emitter.on('disconnected', () => {
    sendToClient(ws, { type: 'DISCONNECTED' });
  });

  bridge.emitter.on('rep', (msg) => {
    sendToClient(ws, { type: 'REP', channel: msg.channel, param: msg.param, value: msg.value });
  });

  bridge.emitter.on('sample', (msg) => {
    sendToClient(ws, { type: 'SAMPLE', levels: msg.levels });
  });

  bridge.emitter.on('error', (err) => {
    debug('Bridge error: %s', err.message);
  });

  sendToClient(ws, { type: 'CONFIG', host: deviceConfig.host, mac: null });

  ws.on('message', (data) => {
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      debug('Invalid JSON from WS client');
      return;
    }
    if (payload.type === 'SET') {
      bridge.sendSet(payload.channel, payload.param, payload.value);
    } else if (payload.type === 'GET') {
      bridge.sendGet(payload.channel, payload.param);
    } else {
      debug('Unknown WS command type: %s', payload.type);
    }
  });

  ws.on('close', () => {
    bridge.destroy();
    debug('WS client disconnected — bridge destroyed');
  });

  ws.on('error', (err) => debug('WS client error: %s', err.message));
});

async function handleHttpRequest(req, res) {
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...corsHeaders,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, corsHeaders);
    res.end(JSON.stringify({ status: 'ok', mock: USE_MOCK }));
    return;
  }

  if (req.url === '/api/config' && req.method === 'GET') {
    res.writeHead(200, corsHeaders);
    res.end(JSON.stringify({ host: deviceConfig.host, port: deviceConfig.port }));
    return;
  }

  if (req.url === '/api/config' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { host } = JSON.parse(body);
        if (!host || typeof host !== 'string' || !host.trim()) throw new Error('invalid host');

        deviceConfig.host = host.trim();

        // Kick all clients — they'll reconnect via WS auto-reconnect with the new host
        for (const client of wss.clients) {
          client.close(1001, 'Host changed');
        }

        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, corsHeaders);
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
    });
    return;
  }

  // Serve static files from client/dist
  const urlPath = req.url.split('?')[0];
  let filePath = path.join(STATIC_DIR, urlPath === '/' ? 'index.html' : urlPath);
  const ext = path.extname(filePath);

  if (!ext || !fs.existsSync(filePath)) {
    filePath = path.join(STATIC_DIR, 'index.html');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const mime = MIME_TYPES[path.extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

httpServer.listen(WS_PORT, WS_HOST, () => {
  console.log(`[server] WebSocket server listening on ws://${WS_HOST}:${WS_PORT}`);
  if (USE_MOCK) console.log('[server] Using mock SCM820 device');
});

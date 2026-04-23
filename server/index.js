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
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff':  'font/woff',
};

const debug = debugLib('scm820:server');

const WS_PORT = parseInt(process.env.WS_PORT, 10) || 8080;
const WS_HOST = process.env.WS_HOST || '0.0.0.0';
const SCM820_PORT = parseInt(process.env.SCM820_PORT, 10) || 2202;
const USE_MOCK = process.env.USE_MOCK === 'true';

const INPUT_CHANNELS = [1, 2, 3, 4, 5, 6, 7, 8];
const METER_RATE_MS = 100;

const deviceConfig = {
  host: process.env.SCM820_HOST || '127.0.0.1',
  port: SCM820_PORT,
  mac: null,
};

let bridgeConnected = false;

function requestInitialState() {
  for (const ch of INPUT_CHANNELS) {
    bridge.sendGet(ch, 'CHAN_NAME');
    bridge.sendGet(ch, 'AUDIO_MUTE');
    bridge.sendGet(ch, 'AUDIO_GAIN_HI_RES');
    bridge.sendGet(ch, 'ALWAYS_ON_ENABLE_A');
    bridge.sendGet(ch, 'INTELLIMIX_MODE');
    bridge.sendGet(ch, 'INPUT_AUDIO_GATE_A');
    bridge.sendGet(ch, 'INPUT_AUDIO_SOURCE');
    bridge.sendGet(ch, 'PHANTOM_PWR_ENABLE');
    bridge.sendGet(ch, 'AUDIO_IN_LVL_SWITCH');
  }
  for (let ch = 10; ch <= 17; ch++) {
    bridge.sendGet(ch, 'DIRECT_OUT_SOURCE');
  }
  for (const ch of [18, 19]) {
    bridge.sendGet(ch, 'CHAN_NAME');
    bridge.sendGet(ch, 'AUDIO_MUTE');
    bridge.sendGet(ch, 'AUDIO_GAIN_HI_RES');
    bridge.sendGet(ch, 'AUDIO_OUT_LVL_SWITCH');
  }
  for (const p of [
    'DEVICE_ID', 'SERIAL_NUM', 'FW_VER',
    'IP_SUBNET_SHURE_CONTROL', 'IP_GATEWAY_SHURE_CONTROL',
    'NETWORK_AUDIO_PROTOCOL', 'NETWORK_AUDIO_VER',
    'IP_ADDR_NET_AUDIO_PRIMARY', 'IP_SUBNET_NET_AUDIO_PRIMARY', 'IP_GATEWAY_NET_AUDIO_PRIMARY',
    'IP_ADDR_NET_AUDIO_SECONDARY', 'IP_SUBNET_NET_AUDIO_SECONDARY', 'IP_GATEWAY_NET_AUDIO_SECONDARY',
    'INPUT_METER_MODE', 'METER_TYPE', 'HEADPHONE_SOURCE', 'DISABLE_LEDS', 'REAR_PANEL_LOCK',
  ]) {
    bridge.sendGet(null, p);
  }
}

if (USE_MOCK) {
  await startMock(deviceConfig.port);
}

const httpServer = http.createServer(handleHttpRequest);
const wss = new WebSocketServer({ server: httpServer });

let bridge = createBridge(deviceConfig.host, deviceConfig.port);
setupBridgeEvents(bridge);

function sendToClient(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

function broadcastToClients(payload) {
  const msg = JSON.stringify(payload);
  for (const ws of wss.clients) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
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

function setupBridgeEvents(b) {
  b.emitter.on('connected', async () => {
    bridgeConnected = true;
    debug('Bridge connected — requesting initial state');
    requestInitialState();
    b.sendSet(0, 'METER_RATE', String(METER_RATE_MS));

    deviceConfig.mac = await lookupMac(deviceConfig.host);
    debug('MAC address: %s', deviceConfig.mac);

    broadcastToClients({
      type: 'CONNECTED',
      host: deviceConfig.host,
      mac: deviceConfig.mac,
    });
  });

  b.emitter.on('disconnected', () => {
    bridgeConnected = false;
    deviceConfig.mac = null;
    broadcastToClients({ type: 'DISCONNECTED' });
  });

  b.emitter.on('rep', (msg) => {
    broadcastToClients({ type: 'REP', channel: msg.channel, param: msg.param, value: msg.value });
  });

  b.emitter.on('sample', (msg) => {
    broadcastToClients({ type: 'SAMPLE', levels: msg.levels });
  });

  b.emitter.on('error', (err) => {
    debug('Bridge error: %s', err.message);
  });
}

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
    res.end(JSON.stringify({ host: deviceConfig.host, port: deviceConfig.port, mac: deviceConfig.mac }));
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
        deviceConfig.mac = null;

        bridge.destroy();
        bridge = createBridge(deviceConfig.host, deviceConfig.port);
        setupBridgeEvents(bridge);

        broadcastToClients({ type: 'CONFIG', host: deviceConfig.host, mac: null });

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

  // SPA fallback: unknown paths without an extension → index.html
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

wss.on('connection', (ws) => {
  debug('WS client connected');
  sendToClient(ws, { type: 'CONFIG', host: deviceConfig.host, mac: deviceConfig.mac });
  if (bridgeConnected) requestInitialState();

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

  ws.on('close', () => debug('WS client disconnected'));
  ws.on('error', (err) => debug('WS client error: %s', err.message));
});

httpServer.listen(WS_PORT, WS_HOST, () => {
  console.log(`[server] WebSocket server listening on ws://${WS_HOST}:${WS_PORT}`);
  if (USE_MOCK) console.log('[server] Using mock SCM820 device');
});

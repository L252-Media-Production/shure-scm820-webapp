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
import { createXtouchBridge } from './xtouchBridge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.resolve(__dirname, '../client/dist');

const MIME_TYPES = {
  '.html':        'text/html',
  '.js':          'application/javascript',
  '.css':         'text/css',
  '.svg':         'image/svg+xml',
  '.png':         'image/png',
  '.ico':         'image/x-icon',
  '.json':        'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2':       'font/woff2',
  '.woff':        'font/woff',
};

const debug = debugLib('scm820:server');

const WS_PORT    = parseInt(process.env.WS_PORT, 10)    || 8080;
const WS_HOST    = process.env.WS_HOST                  || '0.0.0.0';
const SCM820_PORT = parseInt(process.env.SCM820_PORT, 10) || 2202;
const USE_MOCK   = process.env.USE_MOCK === 'true';
const METER_RATE_MS = 100;

const INPUT_CHANNELS = [1, 2, 3, 4, 5, 6, 7, 8];
const AUX_CHANNEL = 9;

// Core device params — all firmware versions respond to these; tracked for loading completion
const GLOBAL_PARAMS = [
  'DEVICE_ID', 'SERIAL_NUM', 'FW_VER',
  'INPUT_METER_MODE', 'METER_TYPE', 'HEADPHONE_SOURCE', 'DISABLE_LEDS', 'REAR_PANEL_LOCK',
];

const deviceConfig = {
  host: process.env.SCM820_HOST || '127.0.0.1',
  port: SCM820_PORT,
};

const XTOUCH_LOCAL_PORT = parseInt(process.env.XTOUCH_PORT, 10) || 5004;

// Last known value per "channel:param" key — used to sync X-Touch on (re)connect
const deviceStateCache = new Map();

// Single X-Touch bridge instance (shared across all WS clients)
let xtouchBridge = null;

function startXtouchBridge() {
  if (xtouchBridge) {
    xtouchBridge.destroy();
    xtouchBridge = null;
  }

  console.log(`[server] X-Touch bridge listening on UDP :${XTOUCH_LOCAL_PORT} (control) / :${XTOUCH_LOCAL_PORT + 1} (data)`);
  console.log(`[server] Point your X-Touch network destination to this server's IP on port ${XTOUCH_LOCAL_PORT}`);

  xtouchBridge = createXtouchBridge(XTOUCH_LOCAL_PORT);

  xtouchBridge.emitter.on('connected', ({ host }) => {
    debug('X-Touch connected from %s', host);
    broadcastToClients({ type: 'XTOUCH_CONNECTED', host });
    // Replay cached device state so the bridge can push it to the X-Touch
    for (const [key, value] of deviceStateCache) {
      const [ch, ...paramParts] = key.split(':');
      xtouchBridge.applyRep(parseInt(ch, 10), paramParts.join(':'), value);
    }
  });

  xtouchBridge.emitter.on('disconnected', () => {
    debug('X-Touch disconnected');
    broadcastToClients({ type: 'XTOUCH_DISCONNECTED' });
  });

  xtouchBridge.emitter.on('command', ({ type, channel, param, value }) => {
    if (type === 'SET') sharedBridge.sendSet(channel, param, value);
  });
}

function broadcastToClients(payload) {
  for (const client of wss.clients) {
    sendToClient(client, payload);
  }
}

// Extended params — fetched but not tracked; device may not support all depending on firmware
const GLOBAL_PARAMS_OPT = [
  'IP_SUBNET_SHURE_CONTROL', 'IP_GATEWAY_SHURE_CONTROL',
  'NETWORK_AUDIO_PROTOCOL', 'NETWORK_AUDIO_VER',
  'IP_ADDR_NET_AUDIO_PRIMARY', 'IP_SUBNET_NET_AUDIO_PRIMARY', 'IP_GATEWAY_NET_AUDIO_PRIMARY',
  'IP_ADDR_NET_AUDIO_SECONDARY', 'IP_SUBNET_NET_AUDIO_SECONDARY', 'IP_GATEWAY_NET_AUDIO_SECONDARY',
  'AUTO_MIX_MODE',
  'DFR1_BYPASS', 'DFR1_ASSIGNED_CHAN', 'DFR1_FREEZE',
  'DFR2_BYPASS', 'DFR2_ASSIGNED_CHAN', 'DFR2_FREEZE',
];

// Returns array of "channel:param" keys matching every GET sent — used by the client to
// track exactly which REPs it still needs before hiding the loading screen.
// getOpt() sends the GET without adding to the tracked keys — device may not support the param.
function requestInitialState(bridge) {
  const keys = [];
  const get    = (ch, param) => { bridge.sendGet(ch, param); keys.push(`${ch ?? 0}:${param}`); };
  const getOpt = (ch, param) => { bridge.sendGet(ch, param); };

  for (const ch of INPUT_CHANNELS) {
    get(ch, 'CHAN_NAME');
    get(ch, 'AUDIO_MUTE');
    get(ch, 'AUDIO_GAIN_HI_RES');
    get(ch, 'ALWAYS_ON_ENABLE_A');
    get(ch, 'INPUT_AUDIO_GATE_A');
    get(ch, 'INPUT_AUDIO_SOURCE');
    get(ch, 'PHANTOM_PWR_ENABLE');
    getOpt(ch, 'AUDIO_IN_LVL_SWITCH');
    getOpt(ch, 'LOW_CUT_ENABLE');
    getOpt(ch, 'LOW_CUT_FREQ');
    getOpt(ch, 'HIGH_SHELF_ENABLE');
    getOpt(ch, 'HIGH_SHELF_GAIN');
    getOpt(ch, 'ALWAYS_ON_ENABLE_B');
    getOpt(ch, 'CHAIR_OVERRIDE_ENABLE_B');
    getOpt(ch, 'CHAIR_MUTE_CTRL_ENABLE_B');
    getOpt(ch, 'INPUT_AUDIO_MIX_BUS');
    getOpt(ch, 'HW_GATING_LOGIC');
  }
  // Aux channel — no always-on, phantom power, level switch
  get(AUX_CHANNEL, 'CHAN_NAME');
  get(AUX_CHANNEL, 'AUDIO_MUTE');
  get(AUX_CHANNEL, 'AUDIO_GAIN_HI_RES');
  get(AUX_CHANNEL, 'INPUT_AUDIO_GATE_A');
  getOpt(AUX_CHANNEL, 'INPUT_AUDIO_SOURCE');
  getOpt(AUX_CHANNEL, 'LOW_CUT_ENABLE');
  getOpt(AUX_CHANNEL, 'LOW_CUT_FREQ');
  getOpt(AUX_CHANNEL, 'HIGH_SHELF_ENABLE');
  getOpt(AUX_CHANNEL, 'HIGH_SHELF_GAIN');
  for (let ch = 10; ch <= 17; ch++) getOpt(ch, 'DIRECT_OUT_SOURCE');
  for (const ch of [18, 19]) {
    get(ch, 'CHAN_NAME');
    get(ch, 'AUDIO_MUTE');
    get(ch, 'AUDIO_GAIN_HI_RES');
    getOpt(ch, 'AUDIO_OUT_LVL_SWITCH');
    getOpt(ch, 'INTELLIMIX_MODE');
  }
  for (const p of GLOBAL_PARAMS) get(null, p);
  for (const p of GLOBAL_PARAMS_OPT) getOpt(null, p);

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

// ── Shared SCM820 bridge — one TCP connection for the server's lifetime ────────
// Each browser tab or page reload subscribes to this bridge via WebSocket;
// it never creates its own TCP connection, eliminating TPCI rejection on reload.

let bridgeConnected = false;
const sharedBridge = createBridge(deviceConfig.host, deviceConfig.port);

sharedBridge.emitter.on('connected', async () => {
  bridgeConnected = true;
  debug('Shared bridge connected to SCM820');
  sharedBridge.sendSet(0, 'METER_RATE', String(METER_RATE_MS));
  // Notify any WS clients that were waiting for the device to come up
  const expected = requestInitialState(sharedBridge);
  broadcastToClients({ type: 'INIT_START', expected });
  broadcastToClients({ type: 'CONNECTED', host: deviceConfig.host, mac: null });
  const mac = await lookupMac(deviceConfig.host);
  debug('MAC: %s', mac);
  broadcastToClients({ type: 'CONFIG', host: deviceConfig.host, mac });
});

sharedBridge.emitter.on('disconnected', () => {
  bridgeConnected = false;
  broadcastToClients({ type: 'DISCONNECTED' });
});

sharedBridge.emitter.on('rep', (msg) => {
  broadcastToClients({ type: 'REP', channel: msg.channel, param: msg.param, value: msg.value });
  deviceStateCache.set(`${msg.channel}:${msg.param}`, msg.value);
  xtouchBridge?.applyRep(msg.channel, msg.param, msg.value);
});

sharedBridge.emitter.on('err', () => {
  broadcastToClients({ type: 'REP_ERR' });
});

sharedBridge.emitter.on('sample', (msg) => {
  broadcastToClients({ type: 'SAMPLE', levels: msg.levels });
  xtouchBridge?.applyMeter(msg.levels);
});

sharedBridge.emitter.on('error', (err) => {
  debug('Bridge error: %s', err.message);
});

// ── WebSocket client connections ───────────────────────────────────────────────

wss.on('connection', (ws) => {
  debug('WS client connected');

  sendToClient(ws, { type: 'CONFIG', host: deviceConfig.host, mac: null });
  sendToClient(ws, {
    type: 'XTOUCH_CONFIG',
    localPort: XTOUCH_LOCAL_PORT,
    connected: xtouchBridge?.connected ?? false,
    host: xtouchBridge?.connectedHost ?? null,
  });

  // If the shared bridge is already up, kick off initial state fetch for this client.
  // The resulting REPs are broadcast to all clients; this client's loading tracker
  // will mark them off as they arrive.
  if (bridgeConnected) {
    const expected = requestInitialState(sharedBridge);
    sendToClient(ws, { type: 'INIT_START', expected });
    sendToClient(ws, { type: 'CONNECTED', host: deviceConfig.host, mac: null });
    lookupMac(deviceConfig.host).then((mac) => {
      debug('MAC: %s', mac);
      sendToClient(ws, { type: 'CONFIG', host: deviceConfig.host, mac });
    });
  }

  ws.on('message', (data) => {
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      debug('Invalid JSON from WS client');
      return;
    }
    if (payload.type === 'SET') {
      sharedBridge.sendSet(payload.channel, payload.param, payload.value);
    } else if (payload.type === 'GET') {
      sharedBridge.sendGet(payload.channel, payload.param);
    } else {
      debug('Unknown WS command type: %s', payload.type);
    }
  });

  ws.on('close', () => debug('WS client disconnected'));
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

        // Reconnect the shared bridge to the new host, then kick all WS clients so
        // they re-subscribe and get a fresh INIT_START once the bridge reconnects.
        sharedBridge.reconnectTo(deviceConfig.host);
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

  if (req.url === '/api/xtouch' && req.method === 'GET') {
    res.writeHead(200, corsHeaders);
    res.end(JSON.stringify({
      localPort: XTOUCH_LOCAL_PORT,
      connected: xtouchBridge?.connected ?? false,
    }));
    return;
  }

  if (req.url === '/api/xtouch' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { auxSwapStrip } = JSON.parse(body);
        if (typeof auxSwapStrip === 'number' && auxSwapStrip >= 1 && auxSwapStrip <= 8) {
          xtouchBridge?.setAuxSwapStrip(auxSwapStrip - 1);  // convert to 0-indexed
          res.writeHead(200, corsHeaders);
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(400, corsHeaders);
          res.end(JSON.stringify({ error: 'auxSwapStrip must be 1-8' }));
        }
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

// Start X-Touch bridge on boot if host is configured
startXtouchBridge();

httpServer.listen(WS_PORT, WS_HOST, () => {
  console.log(`[server] WebSocket server listening on ws://${WS_HOST}:${WS_PORT}`);
  if (USE_MOCK) console.log('[server] Using mock SCM820 device');
});

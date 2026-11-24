import { createScm820Link } from './scm820Link.js';
import { requestInitialState } from './initialState.js';
import { createWebMidiPort, midiPermissionGranted } from './webMidiPort.js';
import { createXtouchBridge } from '@server/xtouchBridge.js';

// In-browser replacement for server/index.js, used when the app runs as an Isolated Web App.
// It speaks the same JSON message protocol the React hook used to get over a WebSocket,
// so useSCM820 only has to swap the connection factory.

const SCM820_PORT = 2202;
const METER_RATE_MS = 100;
const HOST_STORAGE_KEY = 'scm820.host';
const READY_STATE_OPEN = 1;     // WebSocket.OPEN
const READY_STATE_CLOSED = 3;   // WebSocket.CLOSED

const clients = new Set();
const deviceStateCache = new Map();   // "channel:param" -> last value, replayed to the X-Touch on connect
let backend = null;

function loadHost() {
  try { return localStorage.getItem(HOST_STORAGE_KEY) || ''; } catch { return ''; }
}

function saveHost(host) {
  try { localStorage.setItem(HOST_STORAGE_KEY, host); } catch { /* storage unavailable */ }
}

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const c of clients) c.deliver(data);
}

function createBackend() {
  let host = loadHost();
  let linkUp = false;
  let xtouch = null;
  let xtouchInfo = { transport: 'webmidi', connected: false, host: null, needsPermission: false };
  let pendingAuxStrip = null;

  const link = createScm820Link(host, SCM820_PORT);

  function startInit() {
    link.sendSet(0, 'METER_RATE', String(METER_RATE_MS));
    return requestInitialState(link);
  }

  link.emitter.on('connected', () => {
    linkUp = true;
    broadcast({ type: 'INIT_START', expected: startInit() });
    broadcast({ type: 'CONNECTED', host, mac: null });
  });
  link.emitter.on('disconnected', () => { linkUp = false; broadcast({ type: 'DISCONNECTED' }); });
  link.emitter.on('rep', (msg) => {
    broadcast({ type: 'REP', channel: msg.channel, param: msg.param, value: msg.value });
    deviceStateCache.set(`${msg.channel}:${msg.param}`, msg.value);
    xtouch?.applyRep(msg.channel, msg.param, msg.value);
  });
  link.emitter.on('err', () => broadcast({ type: 'REP_ERR' }));
  link.emitter.on('sample', (msg) => {
    broadcast({ type: 'SAMPLE', levels: msg.levels });
    xtouch?.applyMeter(msg.levels);
  });
  link.emitter.on('error', () => { /* reconnect is handled by the link */ });

  function xtouchConfigMessage() {
    return {
      type: 'XTOUCH_CONFIG',
      transport: xtouchInfo.transport,
      needsPermission: xtouchInfo.needsPermission,
      connected: xtouchInfo.connected,
      host: xtouchInfo.host,
    };
  }

  async function startXtouch() {
    if (xtouch || !navigator.requestMIDIAccess) return;
    const port = createWebMidiPort();
    xtouch = createXtouchBridge(port);
    if (pendingAuxStrip !== null) xtouch.setAuxSwapStrip(pendingAuxStrip - 1);
    xtouch.emitter.on('connected', ({ host: portName }) => {
      xtouchInfo = { ...xtouchInfo, connected: true, host: portName, needsPermission: false };
      broadcast({ type: 'XTOUCH_CONNECTED', host: portName });
      for (const [key, value] of deviceStateCache) {
        const [ch, ...paramParts] = key.split(':');
        xtouch.applyRep(parseInt(ch, 10), paramParts.join(':'), value);
      }
    });
    xtouch.emitter.on('disconnected', () => {
      xtouchInfo = { ...xtouchInfo, connected: false, host: null };
      broadcast({ type: 'XTOUCH_DISCONNECTED' });
    });
    xtouch.emitter.on('command', ({ type, channel, param, value }) => {
      if (type === 'SET') link.sendSet(channel, param, value);
    });
  }

  // Web MIDI needs a user-granted permission; start automatically only once it was granted before.
  async function initXtouch() {
    if (!navigator.requestMIDIAccess) {
      xtouchInfo = { ...xtouchInfo, transport: 'unsupported' };
    } else if (await midiPermissionGranted()) {
      await startXtouch();
    } else {
      xtouchInfo = { ...xtouchInfo, needsPermission: true };
    }
    broadcast(xtouchConfigMessage());
  }

  async function enableXtouch() {
    await startXtouch();
    broadcast(xtouchConfigMessage());
  }

  function setHost(newHost) {
    host = newHost.trim();
    saveHost(host);
    link.reconnectTo(host);
  }

  function setAuxSwapStrip(strip) {
    pendingAuxStrip = strip;
    xtouch?.setAuxSwapStrip(strip - 1);   // bridge is 0-indexed
  }

  function onClientAttached(client) {
    client.deliver(JSON.stringify({ type: 'CONFIG', host, mac: null }));
    client.deliver(JSON.stringify(xtouchConfigMessage()));
    if (linkUp) {
      client.deliver(JSON.stringify({ type: 'INIT_START', expected: startInit() }));
      client.deliver(JSON.stringify({ type: 'CONNECTED', host, mac: null }));
    }
  }

  function onClientMessage(payload) {
    if (payload.type === 'SET') link.sendSet(payload.channel, payload.param, payload.value);
    else if (payload.type === 'GET') link.sendGet(payload.channel, payload.param);
  }

  initXtouch();

  return { onClientAttached, onClientMessage, setHost, setAuxSwapStrip, enableXtouch };
}

export function getBackend() {
  if (!backend) backend = createBackend();
  return backend;
}

// WebSocket-shaped handle so useSCM820 can treat both transports alike.
export function createDirectSocket() {
  const b = getBackend();
  const handle = {
    readyState: READY_STATE_OPEN,
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    deliver(data) { handle.onmessage?.({ data }); },
    send(data) {
      try { b.onClientMessage(JSON.parse(data)); } catch { /* ignore malformed */ }
    },
    close() {
      handle.readyState = READY_STATE_CLOSED;
      clients.delete(handle);
      handle.onclose?.();
    },
  };
  clients.add(handle);
  // Defer so the hook can assign its handlers first.
  queueMicrotask(() => {
    handle.onopen?.();
    b.onClientAttached(handle);
  });
  return handle;
}

import net from 'net';
import { EventEmitter } from 'events';
import debugLib from 'debug';
import { parse, serializeGet, serializeSet } from './parser.js';

const debug = debugLib('scm820:bridge');

const RECONNECT_DELAY_MS = 3000;

export function createBridge(initialHost, initialPort) {
  let host = initialHost;
  let port = initialPort;
  const emitter = new EventEmitter();
  let socket = null;
  let buffer = '';
  let destroyed = false;
  let reconnectTimer = null;

  function connect() {
    if (destroyed) return;
    debug('Connecting to %s:%d', host, port);

    socket = new net.Socket();
    socket.setEncoding('utf8');

    socket.connect(port, host, () => {
      debug('Connected to SCM820 at %s:%d', host, port);
      emitter.emit('connected');
    });

    socket.on('data', (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('>')) !== -1) {
        const raw = buffer.slice(0, idx + 1).trim();
        buffer = buffer.slice(idx + 1);
        if (!raw) continue;
        debug('[← SCM820] %s', raw);
        // Skip high-frequency frames that would spam the terminal
        if (
          !raw.startsWith('< SAMPLE') &&
          !raw.includes('AUDIO_OUT_PEAK_LVL') &&
          !raw.includes('AUDIO_IN_PEAK_LVL') &&
          !raw.includes('METER_RATE')
        ) console.log(`[← SCM820] ${raw}`);
        const msg = parse(raw);
        if (msg.type === 'UNKNOWN') {
          debug('Discarding unknown frame: %s', raw);
          continue;
        }
        emitter.emit(msg.type.toLowerCase(), msg);
      }
    });

    socket.on('error', (err) => {
      debug('TCP error: %s', err.message);
      emitter.emit('error', err);
    });

    socket.on('close', () => {
      debug('TCP closed — reconnecting in %dms', RECONNECT_DELAY_MS);
      emitter.emit('disconnected');
      if (!destroyed) {
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    });
  }

  function send(raw) {
    if (!socket || socket.destroyed) {
      debug('Cannot send — not connected: %s', raw);
      return;
    }
    debug('[→ SCM820] %s', raw);
    // Skip METER_RATE spam — log everything else
    if (!raw.includes('METER_RATE')) console.log(`[→ SCM820] ${raw}`);
    socket.write(raw + '\r\n');
  }

  function sendGet(channel, param) {
    send(serializeGet(channel, param));
  }

  function sendSet(channel, param, value) {
    send(serializeSet(channel, param, value));
  }

  function destroy() {
    destroyed = true;
    clearTimeout(reconnectTimer);
    socket?.destroy();
  }

  // Change target host/port and immediately reconnect. The socket 'close' event
  // fires after destroy(), which schedules a new connect() with the updated host.
  function reconnectTo(newHost, newPort) {
    host = newHost;
    if (newPort !== undefined) port = newPort;
    clearTimeout(reconnectTimer);
    socket?.destroy();
  }

  connect();

  return { emitter, send, sendGet, sendSet, destroy, reconnectTo };
}

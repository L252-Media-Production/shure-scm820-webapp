import { EventEmitter } from 'events';
import { parse, serializeGet, serializeSet } from '@server/parser.js';

// Browser TCP link to the SCM820 using the Direct Sockets API (Isolated Web Apps only).
// Same contract as server/bridge.js: emits 'connected' | 'disconnected' | 'rep' | 'err' | 'sample'.

const RECONNECT_DELAY_MS = 3000;
const FRAME_END = '>';
const LINE_TERMINATOR = '\r\n';
const KEEPALIVE_DELAY_MS = 30000;

export function createScm820Link(initialHost, port) {
  const emitter = new EventEmitter();
  const encoder = new TextEncoder();
  let host = initialHost;
  let socket = null;
  let writer = null;
  let generation = 0;     // bumps on every (re)connect so stale loops can bail out
  let destroyed = false;
  let reconnectTimer = null;

  function handleFrame(raw) {
    const msg = parse(raw);
    if (msg.type === 'UNKNOWN') return;
    emitter.emit(msg.type.toLowerCase(), msg);
  }

  async function readLoop(readable, gen) {
    const reader = readable.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (gen === generation) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf(FRAME_END)) !== -1) {
          const raw = buffer.slice(0, idx + 1).trim();
          buffer = buffer.slice(idx + 1);
          if (raw) handleFrame(raw);
        }
      }
    } catch (err) {
      if (gen === generation) emitter.emit('error', err);
    } finally {
      reader.releaseLock?.();
    }
  }

  function scheduleReconnect() {
    if (destroyed) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
  }

  async function connect() {
    if (destroyed || !host) return;
    const gen = ++generation;
    const current = new TCPSocket(host, port, {
      noDelay: true,
      keepAlive: true,
      keepAliveDelay: KEEPALIVE_DELAY_MS,
    });
    socket = current;
    let wasUp = false;
    try {
      const { readable, writable } = await current.opened;
      if (gen !== generation) { current.close().catch(() => {}); return; }
      writer = writable.getWriter();
      wasUp = true;
      emitter.emit('connected');
      await readLoop(readable, gen);
    } catch (err) {
      if (gen === generation) emitter.emit('error', err);
    }
    if (gen !== generation) return;   // superseded by reconnectTo()/destroy()
    writer = null;
    if (wasUp) emitter.emit('disconnected');
    scheduleReconnect();
  }

  function send(raw) {
    if (!writer) return;
    writer.write(encoder.encode(raw + LINE_TERMINATOR)).catch((err) => emitter.emit('error', err));
  }

  const sendGet = (channel, param) => send(serializeGet(channel, param));
  const sendSet = (channel, param, value) => send(serializeSet(channel, param, value));

  function dropSocket() {
    generation++;
    writer = null;
    socket?.close().catch(() => {});
    socket = null;
  }

  function destroy() {
    destroyed = true;
    clearTimeout(reconnectTimer);
    dropSocket();
  }

  function reconnectTo(newHost) {
    host = newHost;
    clearTimeout(reconnectTimer);
    const wasUp = writer !== null;
    dropSocket();
    if (wasUp) emitter.emit('disconnected');
    connect();
  }

  connect();

  return { emitter, send, sendGet, sendSet, destroy, reconnectTo };
}

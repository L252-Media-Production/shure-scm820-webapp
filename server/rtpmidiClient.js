/**
 * Pure-JS Apple MIDI (rtpMIDI) client over UDP.
 * Connects to a remote device (e.g. Behringer X-Touch) and exchanges MIDI via RTP.
 *
 * Apple MIDI uses two adjacent UDP ports:
 *   remotePort     — control port (session management: IN/OK/BY/CK)
 *   remotePort + 1 — data port    (RTP-MIDI packets)
 *
 * Our local sockets must also be on adjacent ports so the remote side can infer
 * our data port from our control port + 1.
 */

import dgram from 'dgram';
import { EventEmitter } from 'events';
import debugLib from 'debug';

const debug = debugLib('scm820:rtpmidi');

const APPLEMIDI_SIG   = 0xffff;
const VERSION         = 2;
const CMD_IN          = 0x494e; // 'I''N'
const CMD_OK          = 0x4f4b; // 'O''K'
const CMD_BY          = 0x4259; // 'B''Y'
const CMD_CK          = 0x434b; // 'C''K'

const RTP_PAYLOAD_TYPE  = 97;
const INVITATION_TIMEOUT_MS = 6000;
const RECONNECT_DELAY_MS    = 10000;
const CK_INTERVAL_MS        = 15000;

function rand32() {
  return (Math.random() * 0x100000000) >>> 0;
}

/**
 * @param {string} remoteHost   IP of the X-Touch
 * @param {number} remotePort   Control port of X-Touch (default 5004)
 * @param {number} localPort    Our local control port; data port = localPort + 1 (default 5006)
 */
export function createRtpMidiClient(remoteHost, remotePort = 5004, localPort = 5006) {
  const emitter = new EventEmitter();

  let controlSocket = null;
  let dataSocket    = null;
  let ssrc          = rand32();
  let token         = rand32();
  let seqNum        = 0;

  let controlReady  = false;
  let dataReady     = false;
  let sessionActive = false;
  let destroyed     = false;

  let inviteTimer    = null;
  let reconnectTimer = null;
  let ckTimer        = null;

  // ── packet builders ────────────────────────────────────────────────────────

  function buildInvite() {
    const name = Buffer.from('SCM820\0');
    const buf = Buffer.alloc(16 + name.length);
    buf.writeUInt16BE(APPLEMIDI_SIG, 0);
    buf.writeUInt16BE(CMD_IN, 2);
    buf.writeUInt32BE(VERSION, 4);
    buf.writeUInt32BE(token, 8);
    buf.writeUInt32BE(ssrc, 12);
    name.copy(buf, 16);
    return buf;
  }

  function buildBye() {
    const buf = Buffer.alloc(12);
    buf.writeUInt16BE(APPLEMIDI_SIG, 0);
    buf.writeUInt16BE(CMD_BY, 2);
    buf.writeUInt32BE(VERSION, 4);
    buf.writeUInt32BE(ssrc, 8);
    return buf;
  }

  function buildCkReply(remoteSsrc, count, ts1, ts2) {
    const buf = Buffer.alloc(36);
    buf.writeUInt16BE(APPLEMIDI_SIG, 0);
    buf.writeUInt16BE(CMD_CK, 2);
    buf.writeUInt32BE(ssrc, 4);
    buf.writeUInt8(count + 1, 8);
    buf.fill(0, 9, 12);
    const now = BigInt(Date.now()) * 10n; // convert ms → 100µs units
    buf.writeBigUInt64BE(ts1, 12);
    buf.writeBigUInt64BE(count === 0 ? now : ts2, 20);
    buf.writeBigUInt64BE(count === 1 ? now : 0n, 28);
    return buf;
  }

  function buildRtpMidi(midiBytes) {
    const header = Buffer.alloc(12);
    header[0] = 0x80; // V=2, P=0, X=0, CC=0
    header[1] = RTP_PAYLOAD_TYPE & 0x7f;
    header.writeUInt16BE(seqNum++ & 0xffff, 2);
    header.writeUInt32BE(Date.now() & 0xffffffff, 4);
    header.writeUInt32BE(ssrc, 8);

    // Short MIDI section header: B=0, length in lower nibble (max 15)
    // For longer payloads use long header (2 bytes)
    const len = midiBytes.length;
    let midiHdr;
    if (len <= 0x0f) {
      midiHdr = Buffer.from([len & 0x0f]);
    } else {
      midiHdr = Buffer.from([0x80 | ((len >> 8) & 0x0f), len & 0xff]);
    }

    return Buffer.concat([header, midiHdr, Buffer.from(midiBytes)]);
  }

  // ── packet parsers ─────────────────────────────────────────────────────────

  function isAppleMidi(buf) {
    return buf.length >= 4 && buf.readUInt16BE(0) === APPLEMIDI_SIG;
  }

  function onControlMsg(buf) {
    if (!isAppleMidi(buf)) return;
    const cmd = buf.readUInt16BE(2);
    debug('control ← cmd 0x%s', cmd.toString(16).toUpperCase());
    if (cmd === CMD_OK && !controlReady) {
      clearTimeout(inviteTimer);
      controlReady = true;
      console.log(`[xtouch] Control handshake OK from ${remoteHost}:${remotePort} — inviting data port ${remotePort + 1}`);
      debug('control handshake OK, inviting data port');
      dataSocket.send(buildInvite(), remotePort + 1, remoteHost);
      inviteTimer = setTimeout(() => {
        if (!sessionActive) onBye();
      }, INVITATION_TIMEOUT_MS);
    } else if (cmd === CMD_CK) {
      handleCk(buf, controlSocket, remotePort);
    } else if (cmd === CMD_BY) {
      onBye();
    }
  }

  function onDataMsg(buf) {
    if (isAppleMidi(buf)) {
      const cmd = buf.readUInt16BE(2);
      debug('data ← Apple MIDI cmd 0x%s', cmd.toString(16).toUpperCase());
      if (cmd === CMD_OK && !dataReady) {
        clearTimeout(inviteTimer);
        dataReady = true;
        sessionActive = true;
        startCkKeepalive();
        console.log(`[xtouch] RTP-MIDI session established with ${remoteHost}:${remotePort}`);
        debug('session active with %s:%d', remoteHost, remotePort);
        emitter.emit('ready');
      } else if (cmd === CMD_CK) {
        handleCk(buf, dataSocket, remotePort + 1);
      } else if (cmd === CMD_BY) {
        onBye();
      }
      return;
    }
    // RTP-MIDI
    if (buf.length < 13) return;
    parseMidiSection(buf.slice(12));
  }

  function handleCk(buf, socket, destPort) {
    if (buf.length < 36) return;
    const remoteSsrc = buf.readUInt32BE(4);
    const count      = buf.readUInt8(8);
    if (count >= 2) return;
    let ts1, ts2;
    try {
      ts1 = buf.readBigUInt64BE(12);
      ts2 = buf.readBigUInt64BE(20);
    } catch {
      ts1 = 0n; ts2 = 0n;
    }
    socket.send(buildCkReply(remoteSsrc, count, ts1, ts2), destPort, remoteHost);
  }

  function parseMidiSection(buf) {
    if (buf.length < 1) return;
    let len, offset;
    if (buf[0] & 0x80) {
      if (buf.length < 2) return;
      len    = ((buf[0] & 0x0f) << 8) | buf[1];
      offset = 2;
    } else {
      len    = buf[0] & 0x0f;
      offset = 1;
    }
    parseMidiEvents(buf.slice(offset, offset + len));
  }

  function parseMidiEvents(buf) {
    let i = 0;
    while (i < buf.length) {
      const status = buf[i];
      if (status === 0xf0) {
        const end = buf.indexOf(0xf7, i + 1);
        i = end === -1 ? buf.length : end + 1;
        continue;
      }
      const type = status & 0xf0;
      const ch   = status & 0x0f;
      if ((type === 0x90 || type === 0x80) && i + 2 < buf.length) {
        const note = buf[i + 1];
        const vel  = buf[i + 2];
        if (type === 0x90 && vel > 0) {
          emitter.emit('noteOn',  { channel: ch, note, velocity: vel });
        } else {
          emitter.emit('noteOff', { channel: ch, note, velocity: vel });
        }
        i += 3;
      } else if (type === 0xe0 && i + 2 < buf.length) {
        const value = (buf[i + 2] << 7) | buf[i + 1];
        emitter.emit('pitchBend', { channel: ch, value });
        i += 3;
      } else if (type === 0xb0 && i + 2 < buf.length) {
        emitter.emit('controlChange', { channel: ch, controller: buf[i + 1], value: buf[i + 2] });
        i += 3;
      } else {
        i++;
      }
    }
  }

  // ── session lifecycle ──────────────────────────────────────────────────────

  function startCkKeepalive() {
    clearInterval(ckTimer);
    ckTimer = setInterval(() => {
      if (!sessionActive || !dataSocket) return;
      const buf = Buffer.alloc(36);
      buf.writeUInt16BE(APPLEMIDI_SIG, 0);
      buf.writeUInt16BE(CMD_CK, 2);
      buf.writeUInt32BE(ssrc, 4);
      buf.writeUInt8(0, 8);
      buf.fill(0, 9, 12);
      buf.writeBigUInt64BE(BigInt(Date.now()) * 10n, 12);
      buf.writeBigUInt64BE(0n, 20);
      buf.writeBigUInt64BE(0n, 28);
      dataSocket.send(buf, remotePort + 1, remoteHost);
    }, CK_INTERVAL_MS);
  }

  function onBye() {
    if (destroyed) return;
    const wasActive = sessionActive;
    console.log(`[xtouch] ${wasActive ? 'Session ended' : 'Invitation timed out'} — reconnecting in ${RECONNECT_DELAY_MS / 1000}s`);
    debug('session ended, reconnecting in %dms', RECONNECT_DELAY_MS);
    sessionActive = false;
    controlReady  = false;
    dataReady     = false;
    clearInterval(ckTimer);
    emitter.emit('disconnected');
    reconnectTimer = setTimeout(start, RECONNECT_DELAY_MS);
  }

  function closeSockets() {
    clearTimeout(inviteTimer);
    clearTimeout(reconnectTimer);
    clearInterval(ckTimer);
    try { controlSocket?.close(); } catch {}
    try { dataSocket?.close();    } catch {}
    controlSocket = null;
    dataSocket    = null;
  }

  // ── public API ─────────────────────────────────────────────────────────────

  function start() {
    if (destroyed) return;
    closeSockets();

    ssrc  = rand32();
    token = rand32();
    sessionActive = false;
    controlReady  = false;
    dataReady     = false;

    controlSocket = dgram.createSocket('udp4');
    dataSocket    = dgram.createSocket('udp4');

    controlSocket.on('message', onControlMsg);
    dataSocket.on('message',    onDataMsg);
    controlSocket.on('error', (err) => {
      console.error(`[xtouch] Control socket error: ${err.message}`);
      if (!destroyed) emitter.emit('error', err);
    });
    dataSocket.on('error', (err) => {
      console.error(`[xtouch] Data socket error: ${err.message}`);
      if (!destroyed) emitter.emit('error', err);
    });

    controlSocket.bind(localPort, () => {
      dataSocket.bind(localPort + 1, () => {
        console.log(`[xtouch] Sending Apple MIDI invitation → ${remoteHost}:${remotePort} (local control=${localPort} data=${localPort + 1})`);
        debug('bound control=%d data=%d → %s:%d', localPort, localPort + 1, remoteHost, remotePort);
        controlSocket.send(buildInvite(), remotePort, remoteHost);
        inviteTimer = setTimeout(() => {
          if (!sessionActive) onBye();
        }, INVITATION_TIMEOUT_MS);
      });
    });
  }

  function sendMidi(bytes) {
    if (!sessionActive || !dataSocket) return;
    dataSocket.send(buildRtpMidi(bytes), remotePort + 1, remoteHost);
  }

  function sendNoteOn(channel, note, velocity) {
    sendMidi([0x90 | (channel & 0x0f), note & 0x7f, velocity & 0x7f]);
  }

  function sendNoteOff(channel, note, velocity = 0) {
    sendMidi([0x80 | (channel & 0x0f), note & 0x7f, velocity & 0x7f]);
  }

  function sendPitchBend(channel, value) {
    // value: 0–16383 (14-bit)
    sendMidi([0xe0 | (channel & 0x0f), value & 0x7f, (value >> 7) & 0x7f]);
  }

  function sendSysex(bytes) {
    // Accept Buffer or Array, with or without F0/F7 wrapper
    const arr = Array.from(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
    if (arr[0] !== 0xf0) {
      sendMidi([0xf0, ...arr, 0xf7]);
    } else {
      sendMidi(arr);
    }
  }

  function destroy() {
    destroyed = true;
    if (sessionActive) {
      try { controlSocket?.send(buildBye(), remotePort, remoteHost); } catch {}
    }
    closeSockets();
  }

  return { start, sendNoteOn, sendNoteOff, sendPitchBend, sendSysex, destroy, emitter };
}

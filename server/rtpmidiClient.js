/**
 * Pure-JS Apple MIDI (RTP-MIDI) server — accepts incoming sessions.
 *
 * The Behringer X-Touch in MC master+network mode acts as the Apple MIDI
 * initiator: it sends invitation (IN) packets to our server IP. We respond
 * with OK and exchange MIDI bidirectionally over RTP.
 *
 * Apple MIDI uses two adjacent UDP ports:
 *   localPort     — control port (session management: IN/OK/BY/CK)
 *   localPort + 1 — data port    (RTP-MIDI packets)
 *
 * Docker: publish with  -p 5004:5004/udp -p 5005:5005/udp
 */

import dgram from 'dgram';
import { EventEmitter } from 'events';
import debugLib from 'debug';

const debug = debugLib('scm820:rtpmidi');

const APPLEMIDI_SIG  = 0xffff;
const VERSION        = 2;
const CMD_IN         = 0x494e; // 'I''N'
const CMD_OK         = 0x4f4b; // 'O''K'
const CMD_BY         = 0x4259; // 'B''Y'
const CMD_CK         = 0x434b; // 'C''K'

const RTP_PAYLOAD_TYPE = 97;
const CK_INTERVAL_MS   = 15000;

function rand32() {
  return (Math.random() * 0x100000000) >>> 0;
}

/**
 * @param {number} localPort  Control port to listen on; data port = localPort + 1 (default 5004/5005)
 * @returns {{ start, sendNoteOn, sendNoteOff, sendPitchBend, sendSysex, destroy, emitter }}
 *
 * emitter events:
 *   'ready'        { host }   — session established, X-Touch is connected
 *   'disconnected'            — session ended (BY received or other side went away)
 *   'noteOn'       { channel, note, velocity }
 *   'noteOff'      { channel, note, velocity }
 *   'pitchBend'    { channel, value }          value: 0–16383
 *   'controlChange'{ channel, controller, value }
 *   'error'        Error
 */
export function createRtpMidiServer(localPort = 5004) {
  const emitter = new EventEmitter();

  let controlSocket = null;
  let dataSocket    = null;
  const ssrc        = rand32();
  let seqNum        = 0;

  // Filled in when X-Touch sends its first IN packet
  let remoteAddr     = null;
  let remoteCtrlPort = null;
  let remoteDataPort = null;

  let controlAccepted = false;
  let sessionActive   = false;
  let destroyed       = false;
  let ckTimer         = null;

  // ── packet builders ────────────────────────────────────────────────────────

  function buildOk(token) {
    const buf = Buffer.alloc(16);
    buf.writeUInt16BE(APPLEMIDI_SIG, 0);
    buf.writeUInt16BE(CMD_OK, 2);
    buf.writeUInt32BE(VERSION, 4);
    buf.writeUInt32BE(token, 8);
    buf.writeUInt32BE(ssrc, 12);
    return buf;
  }

  function buildCkReply(remoteSsrc, count, ts1, ts2) {
    const buf = Buffer.alloc(36);
    buf.writeUInt16BE(APPLEMIDI_SIG, 0);
    buf.writeUInt16BE(CMD_CK, 2);
    buf.writeUInt32BE(ssrc, 4);
    buf.writeUInt8(count + 1, 8);
    buf.fill(0, 9, 12);
    const now = BigInt(Date.now()) * 10n;
    buf.writeBigUInt64BE(ts1, 12);
    buf.writeBigUInt64BE(count === 0 ? now : ts2, 20);
    buf.writeBigUInt64BE(count === 1 ? now : 0n, 28);
    return buf;
  }

  function buildRtpMidi(midiBytes) {
    const header = Buffer.alloc(12);
    header[0] = 0x80;
    header[1] = RTP_PAYLOAD_TYPE & 0x7f;
    header.writeUInt16BE(seqNum++ & 0xffff, 2);
    header.writeUInt32BE((Date.now() & 0xffffffff) >>> 0, 4);
    header.writeUInt32BE(ssrc, 8);

    const len    = midiBytes.length;
    const midiHdr = len <= 0x0f
      ? Buffer.from([len & 0x0f])
      : Buffer.from([0x80 | ((len >> 8) & 0x0f), len & 0xff]);

    return Buffer.concat([header, midiHdr, Buffer.from(midiBytes)]);
  }

  // ── packet parsers ─────────────────────────────────────────────────────────

  function isAppleMidi(buf) {
    return buf.length >= 4 && buf.readUInt16BE(0) === APPLEMIDI_SIG;
  }

  function handleCk(buf, socket, destAddr, destPort) {
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
    debug('CK count=%d → replying count=%d', count, count + 1);
    socket.send(buildCkReply(remoteSsrc, count, ts1, ts2), destPort, destAddr);
  }

  function onControlMsg(buf, rinfo) {
    if (!isAppleMidi(buf)) return;
    const cmd = buf.readUInt16BE(2);
    debug('control ← 0x%s from %s:%d', cmd.toString(16).toUpperCase(), rinfo.address, rinfo.port);

    if (cmd === CMD_IN) {
      if (buf.length < 16) return;
      const token    = buf.readUInt32BE(8);
      remoteAddr     = rinfo.address;
      remoteCtrlPort = rinfo.port;
      controlAccepted = true;
      console.log(`[xtouch] Apple MIDI invitation from ${rinfo.address}:${rinfo.port} — sending OK`);
      controlSocket.send(buildOk(token), rinfo.port, rinfo.address);
    } else if (cmd === CMD_CK) {
      handleCk(buf, controlSocket, rinfo.address, rinfo.port);
    } else if (cmd === CMD_BY) {
      onSessionEnd();
    }
  }

  function onDataMsg(buf, rinfo) {
    if (isAppleMidi(buf)) {
      const cmd = buf.readUInt16BE(2);
      debug('data ← Apple MIDI 0x%s from %s:%d', cmd.toString(16).toUpperCase(), rinfo.address, rinfo.port);

      if (cmd === CMD_IN && controlAccepted) {
        if (buf.length < 16) return;
        const token    = buf.readUInt32BE(8);
        remoteDataPort = rinfo.port;
        dataSocket.send(buildOk(token), rinfo.port, rinfo.address);
        if (!sessionActive) {
          sessionActive = true;
          startCkKeepalive();
          console.log(`[xtouch] RTP-MIDI session established with ${rinfo.address}`);
          emitter.emit('ready', { host: rinfo.address });
        }
      } else if (cmd === CMD_CK) {
        handleCk(buf, dataSocket, rinfo.address, rinfo.port);
      } else if (cmd === CMD_BY) {
        onSessionEnd();
      }
      return;
    }

    // RTP-MIDI data packet
    if (buf.length < 13) return;
    parseMidiSection(buf.slice(12));
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
      if (!sessionActive || !dataSocket || !remoteAddr || !remoteDataPort) return;
      const buf = Buffer.alloc(36);
      buf.writeUInt16BE(APPLEMIDI_SIG, 0);
      buf.writeUInt16BE(CMD_CK, 2);
      buf.writeUInt32BE(ssrc, 4);
      buf.writeUInt8(0, 8);
      buf.fill(0, 9, 12);
      buf.writeBigUInt64BE(BigInt(Date.now()) * 10n, 12);
      buf.writeBigUInt64BE(0n, 20);
      buf.writeBigUInt64BE(0n, 28);
      dataSocket.send(buf, remoteDataPort, remoteAddr);
    }, CK_INTERVAL_MS);
  }

  function onSessionEnd() {
    if (!sessionActive && !controlAccepted) return;
    console.log(`[xtouch] Session ended from ${remoteAddr} — waiting for new connection`);
    sessionActive   = false;
    controlAccepted = false;
    remoteAddr      = null;
    remoteCtrlPort  = null;
    remoteDataPort  = null;
    clearInterval(ckTimer);
    emitter.emit('disconnected');
    // Server mode: no reconnect logic — we simply wait for the next IN packet
  }

  // ── public API ─────────────────────────────────────────────────────────────

  function sendMidi(bytes) {
    if (!sessionActive || !dataSocket || !remoteAddr || !remoteDataPort) return;
    dataSocket.send(buildRtpMidi(bytes), remoteDataPort, remoteAddr);
  }

  function sendNoteOn(channel, note, velocity) {
    sendMidi([0x90 | (channel & 0x0f), note & 0x7f, velocity & 0x7f]);
  }

  function sendNoteOff(channel, note, velocity = 0) {
    sendMidi([0x80 | (channel & 0x0f), note & 0x7f, velocity & 0x7f]);
  }

  function sendPitchBend(channel, value) {
    // value: 0–16383 (14-bit), encoded as LSB/MSB
    sendMidi([0xe0 | (channel & 0x0f), value & 0x7f, (value >> 7) & 0x7f]);
  }

  function sendSysex(bytes) {
    const arr = Array.from(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
    if (arr[0] !== 0xf0) {
      sendMidi([0xf0, ...arr, 0xf7]);
    } else {
      sendMidi(arr);
    }
  }

  function start() {
    if (destroyed) return;

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
        console.log(`[xtouch] Apple MIDI server listening on UDP :${localPort} (control) / :${localPort + 1} (data)`);
        console.log(`[xtouch] Point your X-Touch network destination to this server's IP on port ${localPort}`);
      });
    });
  }

  function destroy() {
    destroyed = true;
    clearInterval(ckTimer);
    try { controlSocket?.close(); } catch {}
    try { dataSocket?.close();    } catch {}
    controlSocket = null;
    dataSocket    = null;
  }

  return { start, sendNoteOn, sendNoteOff, sendPitchBend, sendSysex, destroy, emitter };
}

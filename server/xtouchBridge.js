/**
 * Behringer X-Touch ↔ SCM820 bridge (MCU protocol layer).
 *
 * Translates incoming MCU MIDI from the X-Touch into SCM820 SET commands,
 * and pushes SCM820 REP events back to the X-Touch as fader/LED/scribble updates.
 *
 * MCU note assignments (MIDI channel 0, 0-indexed):
 *   notes  0-7   → REC ARM buttons  (strips 1-8) → phantom power toggle
 *   notes  8-15  → SOLO buttons     (strips 1-8) → input source toggle
 *   notes 16-23  → MUTE buttons     (strips 1-8) → mute both mixes
 *
 * MCU pitch bend:
 *   MIDI ch 0-7  → strip faders 1-8 → AUDIO_GAIN_HI_RES ch 1-8
 *   MIDI ch 8    → master fader     → AUDIO_GAIN_HI_RES ch 18 + 19
 *
 * Gain ↔ fader:  linear map over 0–1280 raw ↔ 0–16383 (14-bit)
 */

import { createRtpMidiClient } from './rtpmidiClient.js';
import { EventEmitter } from 'events';
import debugLib from 'debug';

const debug = debugLib('scm820:xtouch');

// SCM820 gain range
const GAIN_MAX    = 1280;
const FADER_MAX   = 16383;

// How long after a fader touch to ignore SCM820 feedback (prevents echo loops)
const ECHO_SUPPRESS_MS = 600;

// MCU note offsets
const NOTE_REC    = 0;
const NOTE_SOLO   = 8;
const NOTE_MUTE   = 16;

const LED_ON  = 127;
const LED_OFF = 0;

function gainToFader(gain) {
  return Math.round((Math.max(0, Math.min(GAIN_MAX, gain)) / GAIN_MAX) * FADER_MAX);
}

function faderToGain(fader) {
  return Math.round((Math.max(0, Math.min(FADER_MAX, fader)) / FADER_MAX) * GAIN_MAX);
}

function scribbleSysex(stripIndex, name) {
  // X-Touch scribble strip (MCU-compatible): F0 00 00 66 14 12 [offset] [7 chars] F7
  const offset = stripIndex * 7;
  const chars  = name.padEnd(7, ' ').slice(0, 7);
  const bytes  = [0xf0, 0x00, 0x00, 0x66, 0x14, 0x12, offset];
  for (let i = 0; i < 7; i++) bytes.push(chars.charCodeAt(i) & 0x7f);
  bytes.push(0xf7);
  return bytes;
}

function defaultChannelState() {
  return { name: '', gain: 1100, mute: false, phantomPower: false, inputSource: 'Analog' };
}

/**
 * @param {string} host          X-Touch IP address
 * @param {number} remotePort    X-Touch control port (default 5004)
 * @param {number} localPort     Our local control port (default 5006)
 * @returns {{ applyRep, destroy, connected, emitter }}
 */
export function createXtouchBridge(host, remotePort = 5004, localPort = 5006) {
  const emitter = new EventEmitter();

  // Shadow state for channels 1-8 (index = channel - 1)
  const channels = Array.from({ length: 8 }, defaultChannelState);
  // Shadow for master outputs (index 0 = ch18, index 1 = ch19)
  const master   = [{ gain: 1100 }, { gain: 1100 }];

  // Timestamps of last X-Touch fader touch per strip (0-7) or 'master'
  const faderTouchedAt = new Map();

  let connected = false;

  const midi = createRtpMidiClient(host, remotePort, localPort);

  // ── X-Touch → SCM820 ───────────────────────────────────────────────────────

  midi.emitter.on('pitchBend', ({ channel, value }) => {
    if (channel >= 0 && channel <= 7) {
      const scm820Ch = channel + 1;
      const gain     = faderToGain(value);
      faderTouchedAt.set(channel, Date.now());
      channels[channel].gain = gain;
      debug('fader ch%d → gain %d', scm820Ch, gain);
      emitter.emit('command', { type: 'SET', channel: scm820Ch, param: 'AUDIO_GAIN_HI_RES', value: String(gain) });
    } else if (channel === 8) {
      const gain = faderToGain(value);
      faderTouchedAt.set('master', Date.now());
      master[0].gain = gain;
      master[1].gain = gain;
      debug('master fader → gain %d (ch18+19)', gain);
      emitter.emit('command', { type: 'SET', channel: 18, param: 'AUDIO_GAIN_HI_RES', value: String(gain) });
      emitter.emit('command', { type: 'SET', channel: 19, param: 'AUDIO_GAIN_HI_RES', value: String(gain) });
    }
  });

  midi.emitter.on('noteOn', ({ channel, note, velocity }) => {
    if (channel !== 0 || velocity === 0) return;

    if (note >= NOTE_REC && note < NOTE_REC + 8) {
      // REC ARM: toggle phantom power only when input is Analog
      const idx    = note - NOTE_REC;
      const scm820 = idx + 1;
      const state  = channels[idx];
      if (state.inputSource !== 'Network') {
        const next = state.phantomPower ? 'OFF' : 'ON';
        debug('rec ch%d phantom %s', scm820, next);
        emitter.emit('command', { type: 'SET', channel: scm820, param: 'PHANTOM_PWR_ENABLE', value: next });
      }
    } else if (note >= NOTE_SOLO && note < NOTE_SOLO + 8) {
      // SOLO: toggle input source Analog ↔ DANTE
      const idx    = note - NOTE_SOLO;
      const scm820 = idx + 1;
      const state  = channels[idx];
      const next   = state.inputSource === 'Network' ? 'Analog' : 'DANTE';
      debug('solo ch%d source %s', scm820, next);
      emitter.emit('command', { type: 'SET', channel: scm820, param: 'INPUT_AUDIO_SOURCE', value: next });
    } else if (note >= NOTE_MUTE && note < NOTE_MUTE + 8) {
      // MUTE: toggle mute on both mixes
      const idx    = note - NOTE_MUTE;
      const scm820 = idx + 1;
      debug('mute ch%d TOGGLE', scm820);
      emitter.emit('command', { type: 'SET', channel: scm820, param: 'AUDIO_MUTE', value: 'TOGGLE' });
    }
  });

  // ── SCM820 → X-Touch ───────────────────────────────────────────────────────

  function applyRep(channel, param, value) {
    if (!connected) return;

    if (channel >= 1 && channel <= 8) {
      const idx = channel - 1;
      switch (param) {
        case 'AUDIO_GAIN_HI_RES': {
          const gain      = parseInt(value, 10);
          channels[idx].gain = gain;
          const touchedAt = faderTouchedAt.get(idx);
          if (!touchedAt || Date.now() - touchedAt > ECHO_SUPPRESS_MS) {
            midi.sendPitchBend(idx, gainToFader(gain));
          }
          break;
        }
        case 'AUDIO_MUTE': {
          const muted = value === 'ON';
          channels[idx].mute = muted;
          midi.sendNoteOn(0, NOTE_MUTE + idx, muted ? LED_ON : LED_OFF);
          break;
        }
        case 'PHANTOM_PWR_ENABLE': {
          const on = value === 'ON';
          channels[idx].phantomPower = on;
          midi.sendNoteOn(0, NOTE_REC + idx, on ? LED_ON : LED_OFF);
          break;
        }
        case 'INPUT_AUDIO_SOURCE': {
          const isNetwork = /^network|^dante/i.test(value);
          channels[idx].inputSource = isNetwork ? 'Network' : 'Analog';
          midi.sendNoteOn(0, NOTE_SOLO + idx, isNetwork ? LED_ON : LED_OFF);
          break;
        }
        case 'CHAN_NAME': {
          const name = value.replace(/^\{|\}$/g, '').trim();
          channels[idx].name = name;
          midi.sendSysex(scribbleSysex(idx, name));
          break;
        }
      }
    } else if (channel === 18 || channel === 19) {
      if (param === 'AUDIO_GAIN_HI_RES') {
        const gain  = parseInt(value, 10);
        const mIdx  = channel - 18;
        master[mIdx].gain = gain;
        const touchedAt   = faderTouchedAt.get('master');
        // Only push if not in echo window and both outputs agree (use ch18 as canonical)
        if ((!touchedAt || Date.now() - touchedAt > ECHO_SUPPRESS_MS) && mIdx === 0) {
          midi.sendPitchBend(8, gainToFader(gain));
        }
      }
    }
  }

  // ── Push current shadow state to X-Touch after (re)connect ────────────────

  function pushFullState() {
    for (let idx = 0; idx < 8; idx++) {
      const s = channels[idx];
      midi.sendPitchBend(idx, gainToFader(s.gain));
      midi.sendNoteOn(0, NOTE_MUTE + idx, s.mute        ? LED_ON : LED_OFF);
      midi.sendNoteOn(0, NOTE_REC  + idx, s.phantomPower ? LED_ON : LED_OFF);
      midi.sendNoteOn(0, NOTE_SOLO + idx, s.inputSource === 'Network' ? LED_ON : LED_OFF);
      if (s.name) midi.sendSysex(scribbleSysex(idx, s.name));
    }
    // Master fader: use ch18 gain
    midi.sendPitchBend(8, gainToFader(master[0].gain));
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  midi.emitter.on('ready', () => {
    connected = true;
    debug('X-Touch ready at %s:%d', host, remotePort);
    pushFullState();
    emitter.emit('connected');
  });

  midi.emitter.on('disconnected', () => {
    connected = false;
    debug('X-Touch disconnected');
    emitter.emit('disconnected');
  });

  midi.emitter.on('error', (err) => {
    debug('rtpMidi error: %s', err.message);
  });

  midi.start();

  function destroy() {
    midi.destroy();
  }

  return { applyRep, destroy, get connected() { return connected; }, emitter };
}

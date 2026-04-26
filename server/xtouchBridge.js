/**
 * Behringer X-Touch ↔ SCM820 bridge (MCU protocol layer).
 *
 * Translates incoming MCU MIDI from the X-Touch into SCM820 SET commands,
 * and pushes SCM820 REP events back to the X-Touch as fader/LED/scribble updates.
 *
 * MCU note assignments (MIDI channel 0, 0-indexed):
 *   notes  0-7   → REC ARM buttons  (strips 1-8) → phantom power toggle
 *   notes  8-15  → SOLO buttons     (strips 1-8) → input source toggle (Analog ↔ Network)
 *   notes 16-23  → MUTE buttons     (strips 1-8) → mute toggle
 *   notes 24-31  → SELECT buttons   (strips 1-8) → mic sensitivity cycle (Line / +26dB / +46dB)
 *   notes 32-39  → V-Pot push       (strips 1-8) → mode-dependent action
 *   note  40     → Encoder Assign: TRACK         → Lo-cut mode
 *   note  42     → Encoder Assign: PAN/SURROUND  → Hi-shelf mode
 *   note  44     → Encoder Assign: EQ            → Fine gain mode
 *
 * MCU pitch bend:
 *   MIDI ch 0-7  → strip faders 1-8 → AUDIO_GAIN_HI_RES ch 1-8
 *   MIDI ch 8    → master fader     → AUDIO_GAIN_HI_RES ch 18 + 19
 *
 * MCU control change (encoder rotation, relative):
 *   CC 16-23     → V-Pot encoders 1-8 → mode-dependent parameter
 *   Relative encoding: values 1-63 = CW (+), 65-127 = CCW (-)
 *
 * Scribble strip (per channel):
 *   Line 1 (top):    channel name from SCM820
 *   Line 2 (bottom): last-touched status — dB, MUTED/UNMUTED, mic level, lo-cut freq, hi-shelf gain
 *
 * Encoder assign modes (one active at a time; press same button again to deactivate):
 *   locut    → V-Pot rotate: LOW_CUT_FREQ (25-320 Hz, 1 Hz/click)
 *              V-Pot push:   LOW_CUT_ENABLE toggle
 *   hishelf  → V-Pot rotate: HIGH_SHELF_GAIN (0-24 = -12 to +12 dB, 1/click)
 *              V-Pot push:   HIGH_SHELF_ENABLE toggle
 *   finegain → V-Pot rotate: AUDIO_GAIN_HI_RES (±1 raw = 0.1 dB/click)
 *              V-Pot push:   (no action)
 */

import { createRtpMidiServer } from './rtpmidiClient.js';
import { EventEmitter } from 'events';
import debugLib from 'debug';

const debug = debugLib('scm820:xtouch');

// SCM820 gain range
const GAIN_MAX    = 1280;
const GAIN_UNITY  = 1100;   // SCM820 raw = 0 dB
const GAIN_10DB   = 1200;   // SCM820 raw = +10 dB (10 raw/dB above unity)
const FADER_MAX   = 16383;
const FADER_UNITY = 12544;  // X-Touch MCU pitch-bend value at 0 dB (empirically calibrated)

// SCM820 lo-cut and hi-shelf ranges
const LO_CUT_FREQ_MIN    = 25;
const LO_CUT_FREQ_MAX    = 320;
const LO_CUT_FREQ_DEFAULT = 80;
const HI_SHELF_GAIN_MIN  = 0;
const HI_SHELF_GAIN_MAX  = 24;
const HI_SHELF_GAIN_UNITY = 12;  // raw 12 = 0 dB

// How long after a fader touch to ignore SCM820 feedback (prevents echo loops)
const ECHO_SUPPRESS_MS = 600;

// MCU note offsets
const NOTE_REC    = 0;
const NOTE_SOLO   = 8;
const NOTE_MUTE   = 16;
const NOTE_SELECT = 24;
const NOTE_VPOT_PUSH_BASE = 32;  // notes 32-39 = encoder pushes for strips 1-8

// Encoder Assign button notes
const NOTE_ASSIGN_TRACK = 40;   // 0x28 → lo-cut mode
const NOTE_ASSIGN_PAN   = 42;   // 0x2A → hi-shelf mode
const NOTE_ASSIGN_EQ    = 44;   // 0x2C → fine gain mode

// V-Pot encoder CC range
const CC_ENCODER_BASE = 16;     // CC 16-23 = encoders 1-8

const LED_ON  = 127;
const LED_OFF = 0;

// Mic sensitivity cycling order and display labels (7 chars each for scribble strip)
const MIC_LEVELS = ['LINE_LVL', 'MIC_LVL_26DB', 'MIC_LVL_46DB'];
const MIC_LEVEL_LABELS = {
  LINE_LVL:     'LINE   ',
  MIC_LVL_26DB: '+26 dB ',
  MIC_LVL_46DB: '+46 dB ',
};

// Two-segment linear map anchored at 0 dB so both devices agree on unity.
// Below 0 dB: [0, FADER_UNITY] ↔ [0, GAIN_UNITY]
// Above 0 dB: [FADER_UNITY, FADER_MAX] ↔ [GAIN_UNITY, GAIN_10DB]
function gainToFader(gain) {
  const g = Math.max(0, Math.min(GAIN_MAX, gain));
  if (g <= GAIN_UNITY) {
    return Math.round((g / GAIN_UNITY) * FADER_UNITY);
  }
  return Math.min(FADER_MAX, Math.round(
    FADER_UNITY + ((g - GAIN_UNITY) / (GAIN_10DB - GAIN_UNITY)) * (FADER_MAX - FADER_UNITY)
  ));
}

function faderToGain(fader) {
  const f = Math.max(0, Math.min(FADER_MAX, fader));
  if (f <= FADER_UNITY) {
    return Math.round((f / FADER_UNITY) * GAIN_UNITY);
  }
  return Math.round(
    GAIN_UNITY + ((f - FADER_UNITY) / (FADER_MAX - FADER_UNITY)) * (GAIN_10DB - GAIN_UNITY)
  );
}

// Format a raw SCM820 gain value as a 7-char dB string for the scribble strip.
function gainToDb(gain) {
  if (gain <= 0) return '-inf dB';
  const db = (gain - GAIN_UNITY) / 10;
  const s  = (db >= 0 ? '+' : '') + db.toFixed(1) + 'dB';
  return s.slice(0, 7).padEnd(7, ' ');
}

// Format a lo-cut frequency as a 7-char label.
function loCutFreqLabel(freq) {
  return (freq + 'Hz').padEnd(7, ' ').slice(0, 7);
}

// Format a raw hi-shelf gain (0-24, unity=12) as a 7-char dB label.
function hiShelfGainLabel(raw) {
  const db = raw - HI_SHELF_GAIN_UNITY;
  return ((db >= 0 ? '+' : '') + db + 'dB').padEnd(7, ' ').slice(0, 7);
}

// X-Touch scribble strip (MCU-compatible): F0 00 00 66 14 12 [offset] [7 chars] F7
// line 0 = top row (name), line 1 = bottom row (status). Each strip gets 7 chars.
function scribbleSysex(stripIndex, text, line = 0) {
  const offset = (line === 0 ? 0 : 56) + stripIndex * 7;
  const chars  = text.padEnd(7, ' ').slice(0, 7);
  const bytes  = [0xf0, 0x00, 0x00, 0x66, 0x14, 0x12, offset];
  for (let i = 0; i < 7; i++) bytes.push(chars.charCodeAt(i) & 0x7f);
  bytes.push(0xf7);
  return bytes;
}

function defaultChannelState() {
  return {
    name: '', gain: 1100, mute: false, phantomPower: false,
    inputSource: 'Analog', micLevel: 'LINE_LVL',
    lowCutEnabled: false, lowCutFreq: LO_CUT_FREQ_DEFAULT,
    hiShelfEnabled: false, hiShelfGain: HI_SHELF_GAIN_UNITY,
  };
}

/**
 * @param {number} localPort     Local UDP control port to listen on (default 5004); data = localPort + 1
 * @returns {{ applyRep, applyMeter, destroy, connected, emitter }}
 *
 * The X-Touch in MC master mode acts as the Apple MIDI initiator — it sends
 * IN packets to our server. We listen on localPort and accept the session.
 */
export function createXtouchBridge(localPort = 5004) {
  const emitter = new EventEmitter();

  // Shadow state for channels 1-8 (index = channel - 1)
  const channels = Array.from({ length: 8 }, defaultChannelState);
  // Shadow for master outputs (index 0 = ch18, index 1 = ch19)
  const master   = [{ gain: 1100 }, { gain: 1100 }];

  // Timestamps of last X-Touch fader touch per strip (0-7) or 'master'
  const faderTouchedAt = new Map();

  // Last control interacted with per channel strip — drives scribble line 2 content.
  // Values: 'fader' | 'mute' | 'phantom' | 'select' | 'locut' | 'hishelf' | null
  const lastTouched = new Array(8).fill(null);

  // Active encoder assign mode. One of: null | 'locut' | 'hishelf' | 'finegain'
  let encoderMode = null;

  let connected = false;

  const midi = createRtpMidiServer(localPort);

  // ── Helper: update encoder assign LEDs ────────────────────────────────────

  function syncEncoderModeLeds() {
    midi.sendNoteOn(0, NOTE_ASSIGN_TRACK, encoderMode === 'locut'    ? LED_ON : LED_OFF);
    midi.sendNoteOn(0, NOTE_ASSIGN_PAN,   encoderMode === 'hishelf'  ? LED_ON : LED_OFF);
    midi.sendNoteOn(0, NOTE_ASSIGN_EQ,    encoderMode === 'finegain' ? LED_ON : LED_OFF);
  }

  // ── X-Touch → SCM820 ───────────────────────────────────────────────────────

  midi.emitter.on('pitchBend', ({ channel, value }) => {
    if (channel >= 0 && channel <= 7) {
      const scm820Ch = channel + 1;
      const gain     = faderToGain(value);
      faderTouchedAt.set(channel, Date.now());
      channels[channel].gain = gain;
      lastTouched[channel]   = 'fader';
      debug('fader ch%d → gain %d', scm820Ch, gain);
      console.log(`[xtouch] Fader ch${scm820Ch} moved → AUDIO_GAIN_HI_RES ${gain}`);
      midi.sendSysex(scribbleSysex(channel, gainToDb(gain), 1));
      emitter.emit('command', { type: 'SET', channel: scm820Ch, param: 'AUDIO_GAIN_HI_RES', value: String(gain) });
    } else if (channel === 8) {
      const gain = faderToGain(value);
      faderTouchedAt.set('master', Date.now());
      master[0].gain = gain;
      master[1].gain = gain;
      debug('master fader → gain %d (ch18+19)', gain);
      console.log(`[xtouch] Master fader moved → AUDIO_GAIN_HI_RES ${gain} (ch18+19)`);
      emitter.emit('command', { type: 'SET', channel: 18, param: 'AUDIO_GAIN_HI_RES', value: String(gain) });
      emitter.emit('command', { type: 'SET', channel: 19, param: 'AUDIO_GAIN_HI_RES', value: String(gain) });
    }
  });

  // V-Pot encoder rotation (CC 16-23, relative)
  midi.emitter.on('controlChange', ({ channel, controller, value }) => {
    if (channel !== 0 || encoderMode === null) return;
    if (controller < CC_ENCODER_BASE || controller > CC_ENCODER_BASE + 7) return;

    const idx    = controller - CC_ENCODER_BASE;
    const scm820 = idx + 1;
    // MCU relative encoding: 1-63 = CW (+), 65-127 = CCW (-)
    const delta  = value <= 63 ? value : value - 128;

    if (encoderMode === 'locut') {
      const freq = Math.max(LO_CUT_FREQ_MIN, Math.min(LO_CUT_FREQ_MAX, channels[idx].lowCutFreq + delta));
      if (freq === channels[idx].lowCutFreq) return;
      channels[idx].lowCutFreq = freq;
      lastTouched[idx] = 'locut';
      debug('encoder ch%d lo-cut freq %d Hz', scm820, freq);
      console.log(`[xtouch] Encoder ch${scm820} → LOW_CUT_FREQ ${freq}`);
      midi.sendSysex(scribbleSysex(idx, loCutFreqLabel(freq), 1));
      emitter.emit('command', { type: 'SET', channel: scm820, param: 'LOW_CUT_FREQ', value: String(freq).padStart(3, '0') });

    } else if (encoderMode === 'hishelf') {
      const gain = Math.max(HI_SHELF_GAIN_MIN, Math.min(HI_SHELF_GAIN_MAX, channels[idx].hiShelfGain + delta));
      if (gain === channels[idx].hiShelfGain) return;
      channels[idx].hiShelfGain = gain;
      lastTouched[idx] = 'hishelf';
      debug('encoder ch%d hi-shelf gain %d (raw)', scm820, gain);
      console.log(`[xtouch] Encoder ch${scm820} → HIGH_SHELF_GAIN ${gain}`);
      midi.sendSysex(scribbleSysex(idx, hiShelfGainLabel(gain), 1));
      emitter.emit('command', { type: 'SET', channel: scm820, param: 'HIGH_SHELF_GAIN', value: String(gain).padStart(3, '0') });

    } else if (encoderMode === 'finegain') {
      const gain = Math.max(0, Math.min(GAIN_MAX, channels[idx].gain + delta));
      if (gain === channels[idx].gain) return;
      channels[idx].gain = gain;
      faderTouchedAt.set(idx, Date.now());
      lastTouched[idx] = 'fader';
      debug('encoder ch%d fine gain %d', scm820, gain);
      console.log(`[xtouch] Encoder ch${scm820} fine gain → AUDIO_GAIN_HI_RES ${gain}`);
      midi.sendSysex(scribbleSysex(idx, gainToDb(gain), 1));
      emitter.emit('command', { type: 'SET', channel: scm820, param: 'AUDIO_GAIN_HI_RES', value: String(gain) });
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
        const willEnable = !state.phantomPower;
        lastTouched[idx] = 'phantom';
        debug('rec ch%d phantom %s', scm820, willEnable ? 'ON' : 'OFF');
        console.log(`[xtouch] REC ch${scm820} pressed → PHANTOM_PWR_ENABLE ${willEnable ? 'ON' : 'OFF'}`);
        midi.sendSysex(scribbleSysex(idx, willEnable ? '48V ON ' : '48V OFF', 1));
        emitter.emit('command', { type: 'SET', channel: scm820, param: 'PHANTOM_PWR_ENABLE', value: willEnable ? 'ON' : 'OFF' });
      } else {
        console.log(`[xtouch] REC ch${scm820} pressed — ignored (input source is Network)`);
      }

    } else if (note >= NOTE_SOLO && note < NOTE_SOLO + 8) {
      // SOLO: toggle input source Analog ↔ Network
      const idx       = note - NOTE_SOLO;
      const scm820    = idx + 1;
      const state     = channels[idx];
      const toNetwork = state.inputSource !== 'Network';
      const next      = toNetwork ? 'Network' : 'Analog';
      debug('solo ch%d source %s', scm820, next);
      console.log(`[xtouch] SOLO ch${scm820} pressed → INPUT_AUDIO_SOURCE ${next}`);
      // Optimistic LED — applyRep will confirm/correct when SCM820 replies
      state.inputSource = toNetwork ? 'Network' : 'Analog';
      midi.sendNoteOn(0, NOTE_SOLO + idx, toNetwork ? LED_ON : LED_OFF);
      emitter.emit('command', { type: 'SET', channel: scm820, param: 'INPUT_AUDIO_SOURCE', value: next });

    } else if (note >= NOTE_MUTE && note < NOTE_MUTE + 8) {
      // MUTE: toggle mute; update scribble line 2 immediately with predicted state
      const idx      = note - NOTE_MUTE;
      const scm820   = idx + 1;
      const willMute = !channels[idx].mute;
      lastTouched[idx] = 'mute';
      debug('mute ch%d TOGGLE', scm820);
      console.log(`[xtouch] MUTE ch${scm820} pressed → AUDIO_MUTE TOGGLE`);
      midi.sendSysex(scribbleSysex(idx, willMute ? 'MUTED  ' : 'UNMUTED', 1));
      emitter.emit('command', { type: 'SET', channel: scm820, param: 'AUDIO_MUTE', value: 'TOGGLE' });

    } else if (note >= NOTE_SELECT && note < NOTE_SELECT + 8) {
      // SELECT: cycle mic sensitivity — only when input is Analog; ignore in Network mode
      const idx   = note - NOTE_SELECT;
      const state = channels[idx];
      if (state.inputSource === 'Network') {
        console.log(`[xtouch] SELECT ch${idx + 1} pressed — ignored (input source is Network)`);
        return;
      }
      const scm820 = idx + 1;
      const curIdx = MIC_LEVELS.indexOf(state.micLevel);
      const next   = MIC_LEVELS[(curIdx + 1) % MIC_LEVELS.length];
      lastTouched[idx] = 'select';
      debug('select ch%d micLevel %s', scm820, next);
      console.log(`[xtouch] SELECT ch${scm820} pressed → AUDIO_IN_LVL_SWITCH ${next}`);
      // Optimistic update — applyRep will confirm/correct
      state.micLevel = next;
      midi.sendNoteOn(0, NOTE_SELECT + idx, next !== 'LINE_LVL' ? LED_ON : LED_OFF);
      midi.sendSysex(scribbleSysex(idx, MIC_LEVEL_LABELS[next], 1));
      emitter.emit('command', { type: 'SET', channel: scm820, param: 'AUDIO_IN_LVL_SWITCH', value: next });

    } else if (note >= NOTE_VPOT_PUSH_BASE && note < NOTE_VPOT_PUSH_BASE + 8) {
      // V-Pot push: mode-dependent toggle
      const idx    = note - NOTE_VPOT_PUSH_BASE;
      const scm820 = idx + 1;

      if (encoderMode === 'locut') {
        const willEnable = !channels[idx].lowCutEnabled;
        lastTouched[idx] = 'locut';
        debug('vpot push ch%d lo-cut %s', scm820, willEnable ? 'ON' : 'OFF');
        console.log(`[xtouch] V-Pot push ch${scm820} → LOW_CUT_ENABLE ${willEnable ? 'ON' : 'OFF'}`);
        midi.sendSysex(scribbleSysex(idx, willEnable ? 'CUT ON ' : 'CUT OFF', 1));
        emitter.emit('command', { type: 'SET', channel: scm820, param: 'LOW_CUT_ENABLE', value: willEnable ? 'ON' : 'OFF' });

      } else if (encoderMode === 'hishelf') {
        const willEnable = !channels[idx].hiShelfEnabled;
        lastTouched[idx] = 'hishelf';
        debug('vpot push ch%d hi-shelf %s', scm820, willEnable ? 'ON' : 'OFF');
        console.log(`[xtouch] V-Pot push ch${scm820} → HIGH_SHELF_ENABLE ${willEnable ? 'ON' : 'OFF'}`);
        midi.sendSysex(scribbleSysex(idx, willEnable ? 'SHF ON ' : 'SHF OFF', 1));
        emitter.emit('command', { type: 'SET', channel: scm820, param: 'HIGH_SHELF_ENABLE', value: willEnable ? 'ON' : 'OFF' });
      }
      // finegain mode: V-Pot push has no action

    } else if (note === NOTE_ASSIGN_TRACK || note === NOTE_ASSIGN_PAN || note === NOTE_ASSIGN_EQ) {
      // Encoder Assign: switch mode; press the active button again to deactivate
      const pressed = note === NOTE_ASSIGN_TRACK ? 'locut'
                    : note === NOTE_ASSIGN_PAN   ? 'hishelf'
                    : 'finegain';
      encoderMode = encoderMode === pressed ? null : pressed;
      syncEncoderModeLeds();
      console.log(`[xtouch] Encoder mode: ${encoderMode ?? 'off'}`);
      debug('encoder mode → %s', encoderMode ?? 'off');
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
          if (lastTouched[idx] === 'fader') {
            midi.sendSysex(scribbleSysex(idx, gainToDb(gain), 1));
          }
          break;
        }
        case 'AUDIO_MUTE': {
          const muted = value === 'ON';
          channels[idx].mute = muted;
          midi.sendNoteOn(0, NOTE_MUTE + idx, muted ? LED_ON : LED_OFF);
          if (lastTouched[idx] === 'mute') {
            midi.sendSysex(scribbleSysex(idx, muted ? 'MUTED  ' : 'UNMUTED', 1));
          }
          break;
        }
        case 'PHANTOM_PWR_ENABLE': {
          const on = value === 'ON';
          channels[idx].phantomPower = on;
          midi.sendNoteOn(0, NOTE_REC + idx, on ? LED_ON : LED_OFF);
          if (lastTouched[idx] === 'phantom') {
            midi.sendSysex(scribbleSysex(idx, on ? '48V ON ' : '48V OFF', 1));
          }
          break;
        }
        case 'INPUT_AUDIO_SOURCE': {
          const cleaned   = value.replace(/^\{|\}$/g, '').trim();
          const isNetwork = /^(network|dante)/i.test(cleaned);
          channels[idx].inputSource = isNetwork ? 'Network' : 'Analog';
          midi.sendNoteOn(0, NOTE_SOLO + idx, isNetwork ? LED_ON : LED_OFF);
          break;
        }
        case 'AUDIO_IN_LVL_SWITCH': {
          const raw   = value.replace(/^\{|\}$/g, '').trim().toUpperCase();
          const level = raw === 'MIC_LVL_26DB' ? 'MIC_LVL_26DB'
                      : raw === 'MIC_LVL_46DB' ? 'MIC_LVL_46DB'
                      : 'LINE_LVL';
          channels[idx].micLevel = level;
          midi.sendNoteOn(0, NOTE_SELECT + idx, level !== 'LINE_LVL' ? LED_ON : LED_OFF);
          if (lastTouched[idx] === 'select') {
            midi.sendSysex(scribbleSysex(idx, MIC_LEVEL_LABELS[level], 1));
          }
          break;
        }
        case 'LOW_CUT_ENABLE': {
          const on = value === 'ON';
          channels[idx].lowCutEnabled = on;
          if (lastTouched[idx] === 'locut') {
            midi.sendSysex(scribbleSysex(idx, on ? 'CUT ON ' : 'CUT OFF', 1));
          }
          break;
        }
        case 'LOW_CUT_FREQ': {
          const freq = parseInt(value, 10);
          if (!isNaN(freq)) {
            channels[idx].lowCutFreq = Math.max(LO_CUT_FREQ_MIN, Math.min(LO_CUT_FREQ_MAX, freq));
            if (lastTouched[idx] === 'locut') {
              midi.sendSysex(scribbleSysex(idx, loCutFreqLabel(channels[idx].lowCutFreq), 1));
            }
          }
          break;
        }
        case 'HIGH_SHELF_ENABLE': {
          const on = value === 'ON';
          channels[idx].hiShelfEnabled = on;
          if (lastTouched[idx] === 'hishelf') {
            midi.sendSysex(scribbleSysex(idx, on ? 'SHF ON ' : 'SHF OFF', 1));
          }
          break;
        }
        case 'HIGH_SHELF_GAIN': {
          const gain = parseInt(value, 10);
          if (!isNaN(gain)) {
            channels[idx].hiShelfGain = Math.max(HI_SHELF_GAIN_MIN, Math.min(HI_SHELF_GAIN_MAX, gain));
            if (lastTouched[idx] === 'hishelf') {
              midi.sendSysex(scribbleSysex(idx, hiShelfGainLabel(channels[idx].hiShelfGain), 1));
            }
          }
          break;
        }
        case 'CHAN_NAME': {
          const name = value.replace(/^\{|\}$/g, '').trim();
          channels[idx].name = name;
          midi.sendSysex(scribbleSysex(idx, name, 0));
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

  // ── SCM820 SAMPLE → X-Touch meters ────────────────────────────────────────
  // MCU meters: single 0xD0 status byte, data byte = (stripIndex << 4) | level
  // level: 0=off, 1-12=green segments, 13=orange, 14=clip/red
  // SCM820 SAMPLE indices 0-7 map to input channels 1-8.

  function applyMeter(levels) {
    if (!connected) return;
    for (let i = 0; i < 8; i++) {
      const sample   = levels[i] ?? 0;
      const mcuLevel = sample >= 118 ? 14 : Math.round(sample / 120 * 12);
      // MCU meter format: always 0xD0, data byte = (stripIndex << 4) | level
      midi.sendChannelPressure(0, (i << 4) | mcuLevel);
    }
  }

  // ── Push current shadow state to X-Touch after (re)connect ────────────────

  function pushFullState() {
    for (let idx = 0; idx < 8; idx++) {
      const s  = channels[idx];
      const lt = lastTouched[idx];
      midi.sendPitchBend(idx, gainToFader(s.gain));
      midi.sendNoteOn(0, NOTE_MUTE   + idx, s.mute                      ? LED_ON : LED_OFF);
      midi.sendNoteOn(0, NOTE_REC    + idx, s.phantomPower               ? LED_ON : LED_OFF);
      midi.sendNoteOn(0, NOTE_SOLO   + idx, s.inputSource === 'Network'  ? LED_ON : LED_OFF);
      midi.sendNoteOn(0, NOTE_SELECT + idx, s.micLevel    !== 'LINE_LVL' ? LED_ON : LED_OFF);
      if (s.name) midi.sendSysex(scribbleSysex(idx, s.name, 0));
      // Restore line 2 based on last interaction, or clear it
      if (lt === 'fader') {
        midi.sendSysex(scribbleSysex(idx, gainToDb(s.gain), 1));
      } else if (lt === 'mute') {
        midi.sendSysex(scribbleSysex(idx, s.mute ? 'MUTED  ' : 'UNMUTED', 1));
      } else if (lt === 'select') {
        midi.sendSysex(scribbleSysex(idx, MIC_LEVEL_LABELS[s.micLevel], 1));
      } else if (lt === 'phantom') {
        midi.sendSysex(scribbleSysex(idx, s.phantomPower ? '48V ON ' : '48V OFF', 1));
      } else if (lt === 'locut') {
        midi.sendSysex(scribbleSysex(idx, loCutFreqLabel(s.lowCutFreq), 1));
      } else if (lt === 'hishelf') {
        midi.sendSysex(scribbleSysex(idx, hiShelfGainLabel(s.hiShelfGain), 1));
      } else {
        midi.sendSysex(scribbleSysex(idx, '       ', 1));
      }
    }
    // Master fader: use ch18 gain
    midi.sendPitchBend(8, gainToFader(master[0].gain));
    // Restore encoder assign mode LEDs
    syncEncoderModeLeds();
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  midi.emitter.on('ready', ({ host: remoteHost }) => {
    connected = true;
    console.log(`[xtouch] X-Touch connected from ${remoteHost} — pushing full state`);
    debug('X-Touch ready from %s', remoteHost);
    pushFullState();
    emitter.emit('connected', { host: remoteHost });
  });

  midi.emitter.on('disconnected', () => {
    connected = false;
    console.log('[xtouch] X-Touch disconnected — waiting for new connection');
    debug('X-Touch disconnected');
    emitter.emit('disconnected');
  });

  midi.emitter.on('error', (err) => {
    console.error(`[xtouch] RTP-MIDI error: ${err.message}`);
    debug('rtpMidi error: %s', err.message);
  });

  midi.start();

  function destroy() {
    midi.destroy();
  }

  return { applyRep, applyMeter, destroy, get connected() { return connected; }, emitter };
}

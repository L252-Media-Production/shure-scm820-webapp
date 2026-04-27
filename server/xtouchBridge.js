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
 *   note  46     → FADER BANK LEFT               → toggle AUX swap mode
 *   note  47     → FADER BANK RIGHT              → toggle AUX swap mode
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
 *              Scribble bg:  green if enabled, red if disabled
 *   hishelf  → V-Pot rotate: HIGH_SHELF_GAIN (0-24 = -12 to +12 dB, 1/click)
 *              V-Pot push:   HIGH_SHELF_ENABLE toggle
 *              Scribble bg:  green if enabled, red if disabled
 *   finegain → V-Pot rotate: AUDIO_GAIN_HI_RES (±1 raw = 0.1 dB/click)
 *              V-Pot push:   (no action)
 *
 * AUX bank swap:
 *   FADER BANK LEFT/RIGHT toggles whether a configurable strip (default 8) shows AUX (ch9).
 *   Fader and mute for the swapped strip are routed to ch9 when active.
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
const LO_CUT_FREQ_MIN     = 25;
const LO_CUT_FREQ_MAX     = 320;
const LO_CUT_FREQ_DEFAULT = 80;
const HI_SHELF_GAIN_MIN   = 0;
const HI_SHELF_GAIN_MAX   = 24;
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
const NOTE_FLIP         = 50;   // 0x32 → mute toggle for Mix A (ch18) + Mix B (ch19)

// FADER BANK navigation notes
const NOTE_BANK_LEFT  = 46;   // 0x2E → toggle AUX swap mode
const NOTE_BANK_RIGHT = 47;   // 0x2F → toggle AUX swap mode

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

// X-Touch scribble color byte values (used in color sysex)
// Bit 6 (0x40) inverts: colored background instead of colored text
// 0x00 = display off (backlight off) — do NOT use as a default; use 0x07 (white) instead
const COLOR_DEFAULT = 0x07;  // white text, dark background — strips stay visible
const COLOR_RED     = 0x41;  // red bg, black text (inverted)
const COLOR_GREEN   = 0x42;  // green bg, black text (inverted)
const COLOR_YELLOW  = 0x43;  // yellow bg, black text (inverted)

// Peak-hold meter settings (SAMPLE arrives every ~100ms)
const PEAK_HOLD_MS         = 1500;
const PEAK_DECAY_INTERVAL_MS = 80;

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

// X-Touch scribble strip colors: F0 00 00 66 14 72 [8 color bytes] F7
// Sets background/text color for all 8 strips simultaneously.
function scribbleColorSysex(colors) {
  return [0xf0, 0x00, 0x00, 0x66, 0x14, 0x72, ...colors, 0xf7];
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
 * @returns {{ applyRep, applyMeter, destroy, connected, connectedHost, emitter, setAuxSwapStrip }}
 *
 * The X-Touch in MC master mode acts as the Apple MIDI initiator — it sends
 * IN packets to our server. We listen on localPort and accept the session.
 */
export function createXtouchBridge(localPort = 5004) {
  const emitter = new EventEmitter();

  // Shadow state for channels 1-8 (index = channel - 1)
  const channels = Array.from({ length: 8 }, defaultChannelState);
  // Shadow for master outputs (index 0 = ch18, index 1 = ch19)
  const master   = [{ gain: 1100, mute: false }, { gain: 1100, mute: false }];
  // Shadow state for AUX channel (ch9)
  const aux = { gain: 1100, mute: false, name: '' };

  // Timestamps of last X-Touch fader touch per strip (0-7) or 'master'
  const faderTouchedAt = new Map();

  // Last control interacted with per channel strip — drives scribble line 2 content.
  // Values: 'fader' | 'mute' | 'phantom' | 'select' | 'locut' | 'hishelf' | null
  const lastTouched = new Array(8).fill(null);

  // Active encoder assign mode. One of: null | 'locut' | 'hishelf' | 'finegain'
  let encoderMode = null;

  // AUX bank swap: which strip (0-indexed) is routed to ch9 when bank is active
  let auxSwapStrip  = 7;   // default = strip 8 (index 7)
  let auxBankActive = false;

  // Peak-hold state for X-Touch meters
  const peakLevels     = new Array(8).fill(0);
  const peakHoldExpiry = new Array(8).fill(0);
  const peakLastDecay  = new Array(8).fill(0);

  let connected     = false;
  let connectedHost = null;

  const midi = createRtpMidiServer(localPort);

  // ── Helper: compute and send all 8 strip colors in one sysex ──────────────
  // Combines encoder mode state + AUX bank state so the two never conflict.

  function syncAllColors() {
    const colors = new Array(8).fill(COLOR_DEFAULT);
    for (let idx = 0; idx < 8; idx++) {
      if (encoderMode === 'locut') {
        colors[idx] = channels[idx].lowCutEnabled ? COLOR_GREEN : COLOR_RED;
      } else if (encoderMode === 'hishelf') {
        colors[idx] = channels[idx].hiShelfEnabled ? COLOR_GREEN : COLOR_RED;
      }
    }
    // AUX override — yellow strip so the user knows which one is routed to ch9
    if (auxBankActive && auxSwapStrip >= 0 && auxSwapStrip < 8) {
      colors[auxSwapStrip] = COLOR_YELLOW;
    }
    midi.sendSysex(scribbleColorSysex(colors));
  }

  // ── Helper: update encoder assign LEDs ────────────────────────────────────

  function syncEncoderModeLeds() {
    midi.sendNoteOn(0, NOTE_ASSIGN_TRACK, encoderMode === 'locut'    ? LED_ON : LED_OFF);
    midi.sendNoteOn(0, NOTE_ASSIGN_PAN,   encoderMode === 'hishelf'  ? LED_ON : LED_OFF);
    midi.sendNoteOn(0, NOTE_ASSIGN_EQ,    encoderMode === 'finegain' ? LED_ON : LED_OFF);
  }

  // Push scribble strips for all 8 channels to reflect the current encoder mode.
  // In a mode: line 0 = action label, line 1 = current value.
  // When mode is null: line 0 = channel name, line 1 = last-touched status (or blank).
  // AUX swap strip is always rendered from aux state regardless of encoder mode.
  function syncEncoderScribbles() {
    for (let idx = 0; idx < 8; idx++) {
      // AUX swap strip always shows aux data when bank is active
      if (auxBankActive && idx === auxSwapStrip) {
        midi.sendSysex(scribbleSysex(idx, aux.name || 'AUX    ', 0));
        midi.sendSysex(scribbleSysex(idx, gainToDb(aux.gain), 1));
        continue;
      }

      const s  = channels[idx];
      const lt = lastTouched[idx];
      if (encoderMode === 'locut') {
        midi.sendSysex(scribbleSysex(idx, 'CUT    ', 0));
        midi.sendSysex(scribbleSysex(idx, loCutFreqLabel(s.lowCutFreq), 1));
      } else if (encoderMode === 'hishelf') {
        midi.sendSysex(scribbleSysex(idx, 'SHLF   ', 0));
        midi.sendSysex(scribbleSysex(idx, hiShelfGainLabel(s.hiShelfGain), 1));
      } else if (encoderMode === 'finegain') {
        midi.sendSysex(scribbleSysex(idx, 'GAIN   ', 0));
        midi.sendSysex(scribbleSysex(idx, gainToDb(s.gain), 1));
      } else {
        // Restore default: name on top, last-touched status on bottom
        midi.sendSysex(scribbleSysex(idx, s.name || '       ', 0));
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
    }
    syncAllColors();
  }

  // ── Helper: activate / deactivate AUX bank swap ───────────────────────────

  function setAuxBankActive(active) {
    auxBankActive = active;
    const idx = auxSwapStrip;
    if (auxBankActive) {
      // Route strip to AUX (ch9)
      midi.sendPitchBend(idx, gainToFader(aux.gain));
      midi.sendNoteOn(0, NOTE_MUTE + idx, aux.mute ? LED_ON : LED_OFF);
      midi.sendSysex(scribbleSysex(idx, aux.name || 'AUX    ', 0));
      midi.sendSysex(scribbleSysex(idx, gainToDb(aux.gain), 1));
    } else {
      // Restore normal channel state
      const s  = channels[idx];
      const lt = lastTouched[idx];
      midi.sendPitchBend(idx, gainToFader(s.gain));
      midi.sendNoteOn(0, NOTE_MUTE + idx, s.mute ? LED_ON : LED_OFF);
      midi.sendSysex(scribbleSysex(idx, s.name || '       ', 0));
      if (lt === 'fader') {
        midi.sendSysex(scribbleSysex(idx, gainToDb(s.gain), 1));
      } else if (lt === 'mute') {
        midi.sendSysex(scribbleSysex(idx, s.mute ? 'MUTED  ' : 'UNMUTED', 1));
      } else {
        midi.sendSysex(scribbleSysex(idx, '       ', 1));
      }
    }
    syncAllColors();
    console.log(`[xtouch] AUX bank ${auxBankActive ? 'ACTIVE' : 'off'} — strip ${idx + 1} → ch${auxBankActive ? 9 : idx + 1}`);
  }

  // ── X-Touch → SCM820 ───────────────────────────────────────────────────────

  midi.emitter.on('pitchBend', ({ channel, value }) => {
    if (channel >= 0 && channel <= 7) {
      // Route the auxSwapStrip to ch9 when AUX bank is active
      if (auxBankActive && channel === auxSwapStrip) {
        const gain = faderToGain(value);
        aux.gain = gain;
        faderTouchedAt.set(channel, Date.now());
        debug('fader ch%d (AUX) → gain %d', 9, gain);
        console.log(`[xtouch] Fader strip ${channel + 1} (AUX) moved → AUDIO_GAIN_HI_RES ${gain} ch9`);
        midi.sendSysex(scribbleSysex(channel, gainToDb(gain), 1));
        emitter.emit('command', { type: 'SET', channel: 9, param: 'AUDIO_GAIN_HI_RES', value: String(gain) });
        return;
      }

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
    const delta  = value <= 63 ? value : -(value - 64);

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
      const idx    = note - NOTE_MUTE;
      const scm820 = idx + 1;

      if (auxBankActive && idx === auxSwapStrip) {
        // Route to AUX (ch9)
        const willMute = !aux.mute;
        debug('mute strip%d (AUX ch9) TOGGLE', idx + 1);
        console.log(`[xtouch] MUTE strip ${idx + 1} (AUX) pressed → AUDIO_MUTE TOGGLE ch9`);
        midi.sendSysex(scribbleSysex(idx, willMute ? 'MUTED  ' : 'UNMUTED', 1));
        emitter.emit('command', { type: 'SET', channel: 9, param: 'AUDIO_MUTE', value: 'TOGGLE' });
      } else {
        const willMute = !channels[idx].mute;
        debug('mute ch%d TOGGLE', scm820);
        console.log(`[xtouch] MUTE ch${scm820} pressed → AUDIO_MUTE TOGGLE`);
        midi.sendSysex(scribbleSysex(idx, willMute ? 'MUTED  ' : 'UNMUTED', 1));
        emitter.emit('command', { type: 'SET', channel: scm820, param: 'AUDIO_MUTE', value: 'TOGGLE' });
      }
      lastTouched[idx] = 'mute';

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
      syncEncoderScribbles();
      console.log(`[xtouch] Encoder mode: ${encoderMode ?? 'off'}`);
      debug('encoder mode → %s', encoderMode ?? 'off');

    } else if (note === NOTE_BANK_LEFT || note === NOTE_BANK_RIGHT) {
      // FADER BANK LEFT/RIGHT: toggle AUX swap mode for the configured strip
      setAuxBankActive(!auxBankActive);

    } else if (note === NOTE_FLIP) {
      // FLIP: toggle mute on Mix A (ch18) and Mix B (ch19) together
      const willMute = !master[0].mute;
      debug('FLIP pressed → AUDIO_MUTE %s on ch18+19', willMute ? 'ON' : 'OFF');
      console.log(`[xtouch] FLIP pressed → AUDIO_MUTE TOGGLE (ch18+19)`);
      emitter.emit('command', { type: 'SET', channel: 18, param: 'AUDIO_MUTE', value: 'TOGGLE' });
      emitter.emit('command', { type: 'SET', channel: 19, param: 'AUDIO_MUTE', value: 'TOGGLE' });
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
          // Don't update fader if strip is currently showing AUX
          if (!(auxBankActive && idx === auxSwapStrip) &&
              (!touchedAt || Date.now() - touchedAt > ECHO_SUPPRESS_MS)) {
            midi.sendPitchBend(idx, gainToFader(gain));
          }
          if (lastTouched[idx] === 'fader' && !(auxBankActive && idx === auxSwapStrip)) {
            midi.sendSysex(scribbleSysex(idx, gainToDb(gain), 1));
          }
          break;
        }
        case 'AUDIO_MUTE': {
          const muted = value === 'ON';
          channels[idx].mute = muted;
          if (!(auxBankActive && idx === auxSwapStrip)) {
            midi.sendNoteOn(0, NOTE_MUTE + idx, muted ? LED_ON : LED_OFF);
            if (lastTouched[idx] === 'mute') {
              midi.sendSysex(scribbleSysex(idx, muted ? 'MUTED  ' : 'UNMUTED', 1));
            }
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
          // Refresh strip color if lo-cut mode is active
          if (encoderMode === 'locut') syncAllColors();
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
          // Refresh strip color if hi-shelf mode is active
          if (encoderMode === 'hishelf') syncAllColors();
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
          // Don't overwrite name if this strip is currently showing AUX
          if (!(auxBankActive && idx === auxSwapStrip)) {
            midi.sendSysex(scribbleSysex(idx, name, 0));
          }
          break;
        }
      }
    } else if (channel === 9) {
      // AUX channel — update shadow and push to strip if bank is active
      switch (param) {
        case 'AUDIO_GAIN_HI_RES': {
          aux.gain = parseInt(value, 10);
          if (auxBankActive) {
            const touchedAt = faderTouchedAt.get(auxSwapStrip);
            if (!touchedAt || Date.now() - touchedAt > ECHO_SUPPRESS_MS) {
              midi.sendPitchBend(auxSwapStrip, gainToFader(aux.gain));
            }
            midi.sendSysex(scribbleSysex(auxSwapStrip, gainToDb(aux.gain), 1));
          }
          break;
        }
        case 'AUDIO_MUTE': {
          aux.mute = value === 'ON';
          if (auxBankActive) {
            midi.sendNoteOn(0, NOTE_MUTE + auxSwapStrip, aux.mute ? LED_ON : LED_OFF);
          }
          break;
        }
        case 'CHAN_NAME': {
          aux.name = value.replace(/^\{|\}$/g, '').trim();
          if (auxBankActive) {
            midi.sendSysex(scribbleSysex(auxSwapStrip, aux.name || 'AUX    ', 0));
          }
          break;
        }
      }
    } else if (channel === 18 || channel === 19) {
      const mIdx = channel - 18;
      if (param === 'AUDIO_GAIN_HI_RES') {
        const gain  = parseInt(value, 10);
        master[mIdx].gain = gain;
        const touchedAt   = faderTouchedAt.get('master');
        // Only push if not in echo window and both outputs agree (use ch18 as canonical)
        if ((!touchedAt || Date.now() - touchedAt > ECHO_SUPPRESS_MS) && mIdx === 0) {
          midi.sendPitchBend(8, gainToFader(gain));
        }
      } else if (param === 'AUDIO_MUTE') {
        const muted = value === 'ON';
        master[mIdx].mute = muted;
        // Use ch18 as canonical state for FLIP LED
        if (mIdx === 0) {
          midi.sendNoteOn(0, NOTE_FLIP, muted ? LED_ON : LED_OFF);
        }
      }
    }
  }

  // ── SCM820 SAMPLE → X-Touch meters (with peak hold + decay) ──────────────
  // MCU meters: single 0xD0 status byte, data byte = (stripIndex << 4) | level
  // level: 0=off, 1-12=green segments, 13=orange, 14=clip/red
  // SCM820 SAMPLE indices 0-7 map to input channels 1-8.

  function applyMeter(levels) {
    if (!connected) return;
    const now = Date.now();
    for (let i = 0; i < 8; i++) {
      const sample   = levels[i] ?? 0;
      const mcuLevel = sample >= 118 ? 14 : Math.round(sample / 120 * 12);

      if (mcuLevel >= peakLevels[i]) {
        // New peak: hold it
        peakLevels[i]     = mcuLevel;
        peakHoldExpiry[i] = now + PEAK_HOLD_MS;
        peakLastDecay[i]  = now;
      } else if (now >= peakHoldExpiry[i]) {
        // Hold expired: decay one step at PEAK_DECAY_INTERVAL_MS cadence
        if (now - peakLastDecay[i] >= PEAK_DECAY_INTERVAL_MS) {
          peakLevels[i]    = Math.max(0, peakLevels[i] - 1);
          peakLastDecay[i] = now;
        }
      }

      midi.sendChannelPressure(0, (i << 4) | peakLevels[i]);
    }
  }

  // ── Push current shadow state to X-Touch after (re)connect ────────────────

  function pushFullState() {
    for (let idx = 0; idx < 8; idx++) {
      if (auxBankActive && idx === auxSwapStrip) {
        // Show AUX state for the swapped strip
        midi.sendPitchBend(idx, gainToFader(aux.gain));
        midi.sendNoteOn(0, NOTE_MUTE + idx, aux.mute ? LED_ON : LED_OFF);
        midi.sendSysex(scribbleSysex(idx, aux.name || 'AUX    ', 0));
        midi.sendSysex(scribbleSysex(idx, gainToDb(aux.gain), 1));
      } else {
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
    }
    // Master fader: use ch18 gain; FLIP LED: use ch18 mute
    midi.sendPitchBend(8, gainToFader(master[0].gain));
    midi.sendNoteOn(0, NOTE_FLIP, master[0].mute ? LED_ON : LED_OFF);
    // Restore encoder assign mode LEDs, scribble strips, and colors
    syncEncoderModeLeds();
    if (encoderMode !== null) syncEncoderScribbles();
    else syncAllColors();  // still need to paint AUX yellow if bank is active
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  midi.emitter.on('ready', ({ host: remoteHost }) => {
    connected = true;
    connectedHost = remoteHost;
    console.log(`[xtouch] X-Touch connected from ${remoteHost} — pushing full state`);
    debug('X-Touch ready from %s', remoteHost);
    pushFullState();
    emitter.emit('connected', { host: remoteHost });
  });

  midi.emitter.on('disconnected', () => {
    connected = false;
    connectedHost = null;
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

  // Called from server when user changes the setting via UI
  function setAuxSwapStrip(stripIndex) {
    // stripIndex is 0-based (0-7)
    const was = auxSwapStrip;
    // Deactivate bank on the old strip before switching
    if (auxBankActive && was !== stripIndex) {
      setAuxBankActive(false);
    }
    auxSwapStrip = Math.max(0, Math.min(7, stripIndex));
    console.log(`[xtouch] AUX swap strip set to strip ${auxSwapStrip + 1}`);
  }

  return {
    applyRep, applyMeter, destroy, emitter,
    get connected()     { return connected; },
    get connectedHost() { return connectedHost; },
    setAuxSwapStrip,
  };
}

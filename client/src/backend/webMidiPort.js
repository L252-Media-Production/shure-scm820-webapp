import { EventEmitter } from 'events';

// Web MIDI transport for the Behringer X-Touch (USB, Mackie Control mode).
// Implements the same interface as server/rtpmidiClient.js so xtouchBridge.js
// can use either one.

const PORT_NAME_KEY = 'scm820.midiPortName';
const DEFAULT_PORT_MATCH = 'x-touch';
const STATUS = { NOTE_OFF: 0x80, NOTE_ON: 0x90, CONTROL_CHANGE: 0xb0, PITCH_BEND: 0xe0, SYSEX_START: 0xf0, SYSEX_END: 0xf7 };
const DATA_MASK = 0x7f;
const CHANNEL_MASK = 0x0f;
const TYPE_MASK = 0xf0;
const PITCH_BEND_MSB_SHIFT = 7;

export function getPortMatch() {
  try { return (localStorage.getItem(PORT_NAME_KEY) || DEFAULT_PORT_MATCH).toLowerCase(); } catch { return DEFAULT_PORT_MATCH; }
}

export function setPortMatch(name) {
  try { localStorage.setItem(PORT_NAME_KEY, name); } catch { /* storage unavailable */ }
}

export async function midiPermissionGranted() {
  try {
    const status = await navigator.permissions.query({ name: 'midi', sysex: true });
    return status.state === 'granted';
  } catch {
    return false;
  }
}

export function createWebMidiPort() {
  const emitter = new EventEmitter();
  let access = null;
  let input = null;
  let output = null;
  let destroyed = false;

  function decode(bytes) {
    const status = bytes[0];
    if (status === STATUS.SYSEX_START) return;
    const type = status & TYPE_MASK;
    const channel = status & CHANNEL_MASK;
    if ((type === STATUS.NOTE_ON || type === STATUS.NOTE_OFF) && bytes.length >= 3) {
      const [, note, velocity] = bytes;
      emitter.emit(type === STATUS.NOTE_ON && velocity > 0 ? 'noteOn' : 'noteOff', { channel, note, velocity });
    } else if (type === STATUS.PITCH_BEND && bytes.length >= 3) {
      emitter.emit('pitchBend', { channel, value: (bytes[2] << PITCH_BEND_MSB_SHIFT) | bytes[1] });
    } else if (type === STATUS.CONTROL_CHANGE && bytes.length >= 3) {
      emitter.emit('controlChange', { channel, controller: bytes[1], value: bytes[2] });
    }
  }

  function findPort(ports, match) {
    return [...ports.values()].find((p) => p.name?.toLowerCase().includes(match) && p.state === 'connected');
  }

  function attach() {
    if (!access || destroyed) return;
    const match = getPortMatch();
    const foundIn = findPort(access.inputs, match);
    const foundOut = findPort(access.outputs, match);
    if (foundIn && foundOut && (foundIn !== input || foundOut !== output)) {
      if (input) input.onmidimessage = null;
      input = foundIn;
      output = foundOut;
      input.onmidimessage = (e) => decode(e.data);
      emitter.emit('ready', { host: foundIn.name });
    } else if ((!foundIn || !foundOut) && input) {
      input.onmidimessage = null;
      input = null;
      output = null;
      emitter.emit('disconnected');
    }
  }

  async function start() {
    if (destroyed) return;
    try {
      access = await navigator.requestMIDIAccess({ sysex: true });
      access.onstatechange = attach;
      attach();
    } catch (err) {
      emitter.emit('error', err);
    }
  }

  function sendMidi(bytes) {
    if (!output) return;
    try { output.send(bytes); } catch (err) { emitter.emit('error', err); }
  }

  const sendNoteOn = (channel, note, velocity) =>
    sendMidi([STATUS.NOTE_ON | (channel & CHANNEL_MASK), note & DATA_MASK, velocity & DATA_MASK]);
  const sendNoteOff = (channel, note, velocity = 0) =>
    sendMidi([STATUS.NOTE_OFF | (channel & CHANNEL_MASK), note & DATA_MASK, velocity & DATA_MASK]);
  const sendPitchBend = (channel, value) =>
    sendMidi([STATUS.PITCH_BEND | (channel & CHANNEL_MASK), value & DATA_MASK, (value >> PITCH_BEND_MSB_SHIFT) & DATA_MASK]);
  const sendChannelPressure = (channel, value) =>
    sendMidi([0xd0 | (channel & CHANNEL_MASK), value & DATA_MASK]);

  function sendSysex(bytes) {
    const arr = Array.from(bytes);
    sendMidi(arr[0] === STATUS.SYSEX_START ? arr : [STATUS.SYSEX_START, ...arr, STATUS.SYSEX_END]);
  }

  function destroy() {
    destroyed = true;
    if (input) input.onmidimessage = null;
    if (access) access.onstatechange = null;
    input = output = access = null;
  }

  return { start, sendNoteOn, sendNoteOff, sendPitchBend, sendChannelPressure, sendSysex, destroy, emitter };
}

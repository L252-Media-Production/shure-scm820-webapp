import { create } from 'zustand';

const INPUT_CHANNELS = [1, 2, 3, 4, 5, 6, 7, 8];
const AUX_CHANNEL = 9;
const OUTPUT_CHANNELS = [18, 19];

// AUDIO_GAIN_HI_RES: raw 1100 = 0 dB (unity), raw 1280 = +18 dB, raw 0 = -∞
const GAIN_0DB = 1100;

function defaultChannel() {
  return {
    name: '',
    mute: false,
    gain: GAIN_0DB,
    alwaysOn: false,
    intellimixMode: 'CLASSIC',
    gateOpen: false,
    inputSource: 'Analog',
    phantomPower: false,
    micSens: 'LINE_LVL',
  };
}

export const useMixerStore = create((set) => ({
  connected: false,
  channels: Object.fromEntries(
    [...INPUT_CHANNELS, AUX_CHANNEL, ...OUTPUT_CHANNELS].map((ch) => [ch, defaultChannel()])
  ),

  deviceInfo: { host: '', deviceId: null },

  setConnected: (connected) => set({ connected }),

  setDeviceInfo: (info) => set((state) => ({ deviceInfo: { ...state.deviceInfo, ...info } })),

  applyRep: ({ channel, param, value }) =>
    set((state) => {
      const ch = state.channels[channel];
      if (!ch) return {};

      const updated = { ...ch };
      switch (param) {
        case 'CHAN_NAME':
          // Device sends {Name                           } — strip braces and trim
          updated.name = value.replace(/^\{|\}$/g, '').trim();
          break;
        case 'AUDIO_MUTE':
          updated.mute = value === 'ON';
          break;
        case 'AUDIO_GAIN_HI_RES':
          updated.gain = parseInt(value, 10);
          break;
        case 'ALWAYS_ON_ENABLE_A':
          updated.alwaysOn = value === 'ON';
          break;
        case 'INTELLIMIX_MODE':
          updated.intellimixMode = value;
          break;
        case 'INPUT_AUDIO_GATE_A':
          updated.gateOpen = value === 'ON';
          break;
        case 'INPUT_AUDIO_SOURCE':
          // Normalize regardless of case the device sends (Analog/ANALOG/analog all → 'Analog')
          updated.inputSource = /^network|^dante/i.test(value) ? 'Network' : 'Analog';
          break;
        case 'PHANTOM_PWR_ENABLE':
          updated.phantomPower = value === 'ON';
          break;
        case 'AUDIO_IN_LVL_SWITCH':
          updated.micSens = value;
          break;
        default:
          return {};
      }

      return { channels: { ...state.channels, [channel]: updated } };
    }),
}));

import { create } from 'zustand';

const INPUT_CHANNELS = [1, 2, 3, 4, 5, 6, 7, 8];
const AUX_CHANNEL = 9;
const OUTPUT_CHANNELS = [18, 19];

function defaultChannel() {
  return {
    name: '',
    muteA: false,
    muteB: false,
    gainA: 0,
    alwaysOn: false,
    intellimixMode: 'CLASSIC',
    gateOpen: false,
    inputType: 'ANALOG',
  };
}

export const useMixerStore = create((set) => ({
  connected: false,
  channels: Object.fromEntries(
    [...INPUT_CHANNELS, AUX_CHANNEL, ...OUTPUT_CHANNELS].map((ch) => [ch, defaultChannel()])
  ),

  deviceInfo: { host: '', mac: null },

  setConnected: (connected) => set({ connected }),

  setDeviceInfo: (info) => set((state) => ({ deviceInfo: { ...state.deviceInfo, ...info } })),

  applyRep: ({ channel, param, value }) =>
    set((state) => {
      const ch = state.channels[channel];
      if (!ch) return {};

      const updated = { ...ch };
      switch (param) {
        case 'CHAN_NAME': updated.name = value; break;
        case 'CHAN_MUTE_A': updated.muteA = value === 'ON'; break;
        case 'CHAN_MUTE_B': updated.muteB = value === 'ON'; break;
        case 'INPUT_GAIN_HI_A': updated.gainA = parseInt(value, 10); break;
        case 'ALWAYS_ON_ENABLE_A': updated.alwaysOn = value === 'ON'; break;
        case 'INTELLIMIX_MODE': updated.intellimixMode = value; break;
        case 'INPUT_AUDIO_GATE_A': updated.gateOpen = value === 'ON'; break;
        case 'INPUT_TYPE': updated.inputType = value; break;
        default: return {};
      }

      return { channels: { ...state.channels, [channel]: updated } };
    }),
}));

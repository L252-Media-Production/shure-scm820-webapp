import { create } from 'zustand';

const INPUT_CHANNELS = [1, 2, 3, 4, 5, 6, 7, 8];
const AUX_CHANNEL = 9;
const DIRECT_OUT_CHANNELS = [10, 11, 12, 13, 14, 15, 16, 17];
const MIX_OUT_CHANNELS = [18, 19];

// AUDIO_GAIN_HI_RES: raw 1100 = 0 dB (unity), raw 1280 = +18 dB, raw 0 = -∞
const GAIN_0DB = 1100;

function defaultChannel() {
  return {
    name: '',
    mute: false,
    gain: GAIN_0DB,
    alwaysOn: false,
    alwaysOnB: false,
    chairOverride: false,
    chairMuteCtrl: false,
    mixBus: 'BOTH',
    hwGatingLogic: 'MIXBUS_A',
    intellimixMode: 'CLASSIC',
    gateOpen: false,
    inputSource: 'Analog',
    phantomPower: false,
    micSens: 'LINE_LVL',
    lowCutEnabled: false,
    lowCutFreq: 80,
    hiShelfEnabled: false,
    hiShelfGain: 12,  // raw 12 = 0 dB; range 0-24 = -12 to +12 dB
  };
}

function defaultDirectOutChannel() {
  return { directOutSource: 'POST_FADER' };
}

function defaultMixOutChannel() {
  return { ...defaultChannel(), audioOutLvlSwitch: 'LINE_LVL' };
}

const DEVICE_PARAM_MAP = {
  DEVICE_ID:                      'deviceId',
  SERIAL_NUM:                     'serialNum',
  FW_VER:                         'fwVer',
  IP_SUBNET_SHURE_CONTROL:        'ipSubnetControl',
  IP_GATEWAY_SHURE_CONTROL:       'ipGatewayControl',
  NETWORK_AUDIO_PROTOCOL:         'networkAudioProtocol',
  NETWORK_AUDIO_VER:              'networkAudioVer',
  IP_ADDR_NET_AUDIO_PRIMARY:      'ipAddrPrimary',
  IP_SUBNET_NET_AUDIO_PRIMARY:    'ipSubnetPrimary',
  IP_GATEWAY_NET_AUDIO_PRIMARY:   'ipGatewayPrimary',
  IP_ADDR_NET_AUDIO_SECONDARY:    'ipAddrSecondary',
  IP_SUBNET_NET_AUDIO_SECONDARY:  'ipSubnetSecondary',
  IP_GATEWAY_NET_AUDIO_SECONDARY: 'ipGatewaySecondary',
  INPUT_METER_MODE:               'inputMeterMode',
  METER_TYPE:                     'meterType',
  HEADPHONE_SOURCE:               'headphoneSource',
  METER_RATE:                     'meterRate',
  DISABLE_LEDS:                   'disableLeds',
  FLASH:                          'flash',
  REAR_PANEL_LOCK:                'rearPanelLock',
  AUTO_MIX_MODE:                  'autoMixMode',
  DFR1_BYPASS:                    'dfr1Bypass',
  DFR1_ASSIGNED_CHAN:             'dfr1AssignedChan',
  DFR1_FREEZE:                    'dfr1Freeze',
  DFR2_BYPASS:                    'dfr2Bypass',
  DFR2_ASSIGNED_CHAN:             'dfr2AssignedChan',
  DFR2_FREEZE:                    'dfr2Freeze',
};

function buildChannels() {
  const ch = {};
  for (const n of INPUT_CHANNELS) ch[n] = defaultChannel();
  ch[AUX_CHANNEL] = defaultChannel();
  for (const n of DIRECT_OUT_CHANNELS) ch[n] = defaultDirectOutChannel();
  for (const n of MIX_OUT_CHANNELS) ch[n] = defaultMixOutChannel();
  return ch;
}

export const useMixerStore = create((set) => ({
  connected: false,
  channels: buildChannels(),

  deviceInfo: {
    host: '',
    mac: null,
    deviceId: null,
    serialNum: null,
    fwVer: null,
    ipSubnetControl: null,
    ipGatewayControl: null,
    networkAudioProtocol: null,
    networkAudioVer: null,
    ipAddrPrimary: null,
    ipSubnetPrimary: null,
    ipGatewayPrimary: null,
    ipAddrSecondary: null,
    ipSubnetSecondary: null,
    ipGatewaySecondary: null,
    inputMeterMode: null,
    meterType: null,
    headphoneSource: null,
    meterRate: null,
    disableLeds: null,
    flash: null,
    rearPanelLock: null,
    autoMixMode: 'SINGLE',
    dfr1Bypass: 'OFF',
    dfr1AssignedChan: '020',
    dfr1Freeze: 'OFF',
    dfr2Bypass: 'OFF',
    dfr2AssignedChan: '020',
    dfr2Freeze: 'OFF',
  },

  xtouchConnected: false,
  xtouchInfo: { localPort: 5004, connectedHost: null },

  setConnected: (connected) => set({ connected }),

  setDeviceInfo: (info) => set((state) => ({ deviceInfo: { ...state.deviceInfo, ...info } })),

  setXtouchConnected: (xtouchConnected) => set({ xtouchConnected }),

  setXtouchInfo: (info) => set((state) => ({ xtouchInfo: { ...state.xtouchInfo, ...info } })),

  applyDeviceParam: (param, value) =>
    set((state) => {
      const key = DEVICE_PARAM_MAP[param];
      if (!key) return {};
      const stripped = typeof value === 'string' ? value.replace(/^\{|\}$/g, '').trim() : value;
      return { deviceInfo: { ...state.deviceInfo, [key]: stripped } };
    }),

  applyRep: ({ channel, param, value }) =>
    set((state) => {
      const ch = state.channels[channel];
      if (!ch) return {};

      const updated = { ...ch };
      switch (param) {
        case 'CHAN_NAME':
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
        case 'ALWAYS_ON_ENABLE_B':
          updated.alwaysOnB = value === 'ON';
          break;
        case 'CHAIR_OVERRIDE_ENABLE_B':
          updated.chairOverride = value === 'ON';
          break;
        case 'CHAIR_MUTE_CTRL_ENABLE_B':
          updated.chairMuteCtrl = value === 'ON';
          break;
        case 'INPUT_AUDIO_MIX_BUS':
          updated.mixBus = value;
          break;
        case 'HW_GATING_LOGIC':
          updated.hwGatingLogic = value;
          break;
        case 'SET_INTELLIMIX_MODE':
        case 'INTELLIMIX_MODE':
          updated.intellimixMode = value;
          break;
        case 'INPUT_AUDIO_GATE_A':
          updated.gateOpen = value === 'ON';
          break;
        case 'INPUT_AUDIO_SOURCE':
          updated.inputSource = /^network|^dante/i.test(value) ? 'Network' : 'Analog';
          break;
        case 'PHANTOM_PWR_ENABLE':
          updated.phantomPower = value === 'ON';
          break;
        case 'AUDIO_IN_LVL_SWITCH':
          updated.micSens = value;
          break;
        case 'DIRECT_OUT_SOURCE':
          updated.directOutSource = value;
          break;
        case 'AUDIO_OUT_LVL_SWITCH':
          updated.audioOutLvlSwitch = value;
          break;
        case 'LOW_CUT_ENABLE':
          updated.lowCutEnabled = value === 'ON';
          break;
        case 'LOW_CUT_FREQ': {
          const freq = parseInt(value, 10);
          if (!isNaN(freq)) updated.lowCutFreq = Math.max(25, Math.min(320, freq));
          break;
        }
        case 'HIGH_SHELF_ENABLE':
          updated.hiShelfEnabled = value === 'ON';
          break;
        case 'HIGH_SHELF_GAIN': {
          const gain = parseInt(value, 10);
          if (!isNaN(gain)) updated.hiShelfGain = Math.max(0, Math.min(24, gain));
          break;
        }
        default:
          return {};
      }

      return { channels: { ...state.channels, [channel]: updated } };
    }),
}));

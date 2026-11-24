// The GET burst sent on every (re)connect. Mirrors requestInitialState() in
// server/index.js. Returns the "channel:param" keys the UI should wait for.

const INPUT_CHANNELS = [1, 2, 3, 4, 5, 6, 7, 8];
const AUX_CHANNEL = 9;
const DIRECT_OUT_CHANNELS = [10, 11, 12, 13, 14, 15, 16, 17];
const OUTPUT_CHANNELS = [18, 19];

// Core params every firmware answers — tracked for the loading bar.
const GLOBAL_PARAMS = [
  'DEVICE_ID', 'SERIAL_NUM', 'FW_VER',
  'INPUT_METER_MODE', 'METER_TYPE', 'HEADPHONE_SOURCE', 'DISABLE_LEDS', 'REAR_PANEL_LOCK',
];

// Extended params — fetched but not tracked; support varies by firmware.
const GLOBAL_PARAMS_OPT = [
  'IP_SUBNET_SHURE_CONTROL', 'IP_GATEWAY_SHURE_CONTROL',
  'NETWORK_AUDIO_PROTOCOL', 'NETWORK_AUDIO_VER',
  'IP_ADDR_NET_AUDIO_PRIMARY', 'IP_SUBNET_NET_AUDIO_PRIMARY', 'IP_GATEWAY_NET_AUDIO_PRIMARY',
  'IP_ADDR_NET_AUDIO_SECONDARY', 'IP_SUBNET_NET_AUDIO_SECONDARY', 'IP_GATEWAY_NET_AUDIO_SECONDARY',
  'AUTO_MIX_MODE',
  'DFR1_BYPASS', 'DFR1_ASSIGNED_CHAN', 'DFR1_FREEZE',
  'DFR2_BYPASS', 'DFR2_ASSIGNED_CHAN', 'DFR2_FREEZE',
];

const INPUT_REQUIRED = ['CHAN_NAME', 'AUDIO_MUTE', 'AUDIO_GAIN_HI_RES', 'ALWAYS_ON_ENABLE_A',
  'INPUT_AUDIO_GATE_A', 'INPUT_AUDIO_SOURCE', 'PHANTOM_PWR_ENABLE'];
const INPUT_OPTIONAL = ['AUDIO_IN_LVL_SWITCH', 'LOW_CUT_ENABLE', 'LOW_CUT_FREQ',
  'HIGH_SHELF_ENABLE', 'HIGH_SHELF_GAIN', 'ALWAYS_ON_ENABLE_B', 'CHAIR_OVERRIDE_ENABLE_B',
  'CHAIR_MUTE_CTRL_ENABLE_B', 'INPUT_AUDIO_MIX_BUS', 'HW_GATING_LOGIC'];
const AUX_REQUIRED = ['CHAN_NAME', 'AUDIO_MUTE', 'AUDIO_GAIN_HI_RES', 'INPUT_AUDIO_GATE_A'];
const AUX_OPTIONAL = ['INPUT_AUDIO_SOURCE', 'LOW_CUT_ENABLE', 'LOW_CUT_FREQ',
  'HIGH_SHELF_ENABLE', 'HIGH_SHELF_GAIN'];
const OUTPUT_REQUIRED = ['CHAN_NAME', 'AUDIO_MUTE', 'AUDIO_GAIN_HI_RES'];
const OUTPUT_OPTIONAL = ['AUDIO_OUT_LVL_SWITCH', 'INTELLIMIX_MODE'];

export function requestInitialState(link) {
  const keys = [];
  const get = (ch, param) => { link.sendGet(ch, param); keys.push(`${ch ?? 0}:${param}`); };
  const getOpt = (ch, param) => link.sendGet(ch, param);

  for (const ch of INPUT_CHANNELS) {
    INPUT_REQUIRED.forEach((p) => get(ch, p));
    INPUT_OPTIONAL.forEach((p) => getOpt(ch, p));
  }
  AUX_REQUIRED.forEach((p) => get(AUX_CHANNEL, p));
  AUX_OPTIONAL.forEach((p) => getOpt(AUX_CHANNEL, p));
  DIRECT_OUT_CHANNELS.forEach((ch) => getOpt(ch, 'DIRECT_OUT_SOURCE'));
  for (const ch of OUTPUT_CHANNELS) {
    OUTPUT_REQUIRED.forEach((p) => get(ch, p));
    OUTPUT_OPTIONAL.forEach((p) => getOpt(ch, p));
  }
  GLOBAL_PARAMS.forEach((p) => get(null, p));
  GLOBAL_PARAMS_OPT.forEach((p) => getOpt(null, p));
  return keys;
}

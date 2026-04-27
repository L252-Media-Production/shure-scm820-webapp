import net from 'net';
import debugLib from 'debug';
import { parse, serializeRep, serializeSample } from './parser.js';

const debug = debugLib('scm820:mock');

const INPUT_CHANNEL_COUNT = 9;
const AUX_CHANNEL = 9;
const SAMPLE_LEVEL_COUNT = 19;

const DEFAULT_NAMES = ['Podium', 'Panel L', 'Panel R', 'Table 1', 'Table 2', 'Table 3', 'Floor', 'Chan 8', 'Aux'];
const INTELLIMIX_MODES = ['CLASSIC', 'SMOOTH', 'EXTREME', 'CUSTOM', 'MANUAL', 'CUSTOM_PRESET'];

// AUDIO_GAIN_HI_RES: 0000-1280 in 0.1 dB steps; 1100 = 0 dB (unity), 1280 = +18 dB
const GAIN_0DB = 1100;

function makeChannelState() {
  return {
    name: '',
    mute: 'OFF',
    gain: GAIN_0DB,
    alwaysOn: 'OFF',
    alwaysOnB: 'OFF',
    chairOverride: 'OFF',
    chairMuteCtrl: 'OFF',
    mixBus: 'BOTH',
    hwGatingLogic: 'MIXBUS_A',
    intellimix: 'CLASSIC',
    gate: 'OFF',
    inputSource: 'Analog',
    phantomPower: 'OFF',
    micSens: 'LINE_LVL',
    lowCutEnabled: 'OFF',
    lowCutFreq: 80,
    hiShelfEnabled: 'OFF',
    hiShelfGain: 12,
  };
}

// Static global device info (read-only)
const GLOBAL_STATIC = {
  DEVICE_ID:                      '{SCM820-MOCK-001              }',
  SERIAL_NUM:                     '{A1B2C34567890         }',
  FW_VER:                         '{1.4.3.0                }',
  IP_SUBNET_SHURE_CONTROL:        '{255.255.255.0  }',
  IP_GATEWAY_SHURE_CONTROL:       '{127.0.0.1      }',
  NETWORK_AUDIO_PROTOCOL:         'DANTE',
  NETWORK_AUDIO_VER:              '{3.9.6.1                }',
  IP_ADDR_NET_AUDIO_PRIMARY:      '{127.0.0.1      }',
  IP_SUBNET_NET_AUDIO_PRIMARY:    '{255.255.255.0  }',
  IP_GATEWAY_NET_AUDIO_PRIMARY:   '{127.0.0.1      }',
  IP_ADDR_NET_AUDIO_SECONDARY:    'UNKNOWN',
  IP_SUBNET_NET_AUDIO_SECONDARY:  'UNKNOWN',
  IP_GATEWAY_NET_AUDIO_SECONDARY: 'UNKNOWN',
};

export function startMock(port) {
  return new Promise((resolve, reject) => {
    const channels = {};
    for (let ch = 1; ch <= INPUT_CHANNEL_COUNT; ch++) {
      channels[ch] = { ...makeChannelState(), name: DEFAULT_NAMES[ch - 1] };
    }
    for (let ch = 10; ch <= 17; ch++) {
      channels[ch] = { directOutSource: 'POST_FADER' };
    }
    channels[18] = { ...makeChannelState(), name: 'Output A', audioOutLvlSwitch: 'LINE_LVL' };
    channels[19] = { ...makeChannelState(), name: 'Output B', audioOutLvlSwitch: 'LINE_LVL' };

    // Mutable global device settings
    const deviceSettings = {
      inputMeterMode: 'PRE_FADER',
      meterType: 'VU',
      headphoneSource: 'PRE_FADER',
      disableLeds: 'OFF',
      flash: 'OFF',
      rearPanelLock: 'UNLOCK',
      autoMixMode: 'SINGLE',
      dfr1Bypass: 'OFF',
      dfr1AssignedChan: '020',
      dfr1Freeze: 'OFF',
      dfr2Bypass: 'OFF',
      dfr2AssignedChan: '020',
      dfr2Freeze: 'OFF',
    };

    let meterRate = 0;
    let meterTimer = null;
    const clients = new Set();

    function broadcast(msg) {
      for (const sock of clients) {
        if (!sock.destroyed) sock.write(msg + '\r\n');
      }
    }

    function setMeterRate(ms) {
      clearInterval(meterTimer);
      meterRate = ms;
      if (ms > 0) {
        meterTimer = setInterval(() => {
          const levels = Array.from({ length: SAMPLE_LEVEL_COUNT }, () =>
            Math.floor(Math.random() * 90)
          );
          broadcast(serializeSample(levels));
        }, ms);
      }
    }

    function padGain(raw) {
      return String(raw).padStart(4, '0');
    }

    function padFreq(f) { return String(f).padStart(3, '0'); }
    function padHiShelf(g) { return String(g).padStart(3, '0'); }

    function sendInitialState(sock) {
      for (let ch = 1; ch <= INPUT_CHANNEL_COUNT; ch++) {
        const s = channels[ch];
        sock.write(serializeRep(ch, 'CHAN_NAME', `{${s.name.padEnd(31)}}`) + '\r\n');
        sock.write(serializeRep(ch, 'AUDIO_MUTE', s.mute) + '\r\n');
        sock.write(serializeRep(ch, 'AUDIO_GAIN_HI_RES', padGain(s.gain)) + '\r\n');
        sock.write(serializeRep(ch, 'ALWAYS_ON_ENABLE_A', s.alwaysOn) + '\r\n');
        sock.write(serializeRep(ch, 'INTELLIMIX_MODE', s.intellimix) + '\r\n');
        sock.write(serializeRep(ch, 'INPUT_AUDIO_GATE_A', s.gate) + '\r\n');
        sock.write(serializeRep(ch, 'INPUT_AUDIO_SOURCE', s.inputSource) + '\r\n');
        sock.write(serializeRep(ch, 'PHANTOM_PWR_ENABLE', s.phantomPower) + '\r\n');
        sock.write(serializeRep(ch, 'AUDIO_IN_LVL_SWITCH', s.micSens) + '\r\n');
        sock.write(serializeRep(ch, 'LOW_CUT_ENABLE', s.lowCutEnabled) + '\r\n');
        sock.write(serializeRep(ch, 'LOW_CUT_FREQ', padFreq(s.lowCutFreq)) + '\r\n');
        sock.write(serializeRep(ch, 'HIGH_SHELF_ENABLE', s.hiShelfEnabled) + '\r\n');
        sock.write(serializeRep(ch, 'HIGH_SHELF_GAIN', padHiShelf(s.hiShelfGain)) + '\r\n');
        // Aux channel (9) doesn't have these IntelliMix params
        if (ch <= 8) {
          sock.write(serializeRep(ch, 'ALWAYS_ON_ENABLE_B', s.alwaysOnB) + '\r\n');
          sock.write(serializeRep(ch, 'CHAIR_OVERRIDE_ENABLE_B', s.chairOverride) + '\r\n');
          sock.write(serializeRep(ch, 'CHAIR_MUTE_CTRL_ENABLE_B', s.chairMuteCtrl) + '\r\n');
          sock.write(serializeRep(ch, 'INPUT_AUDIO_MIX_BUS', s.mixBus) + '\r\n');
          sock.write(serializeRep(ch, 'HW_GATING_LOGIC', s.hwGatingLogic) + '\r\n');
        }
      }
      for (let ch = 10; ch <= 17; ch++) {
        sock.write(serializeRep(ch, 'DIRECT_OUT_SOURCE', channels[ch].directOutSource) + '\r\n');
      }
      for (const ch of [18, 19]) {
        const s = channels[ch];
        if (!s) continue;
        sock.write(serializeRep(ch, 'CHAN_NAME', `{${s.name.padEnd(31)}}`) + '\r\n');
        sock.write(serializeRep(ch, 'AUDIO_MUTE', s.mute) + '\r\n');
        sock.write(serializeRep(ch, 'AUDIO_GAIN_HI_RES', padGain(s.gain)) + '\r\n');
        sock.write(serializeRep(ch, 'AUDIO_OUT_LVL_SWITCH', s.audioOutLvlSwitch) + '\r\n');
        sock.write(serializeRep(ch, 'INTELLIMIX_MODE', s.intellimix) + '\r\n');
      }
      // Global static device info
      for (const [param, value] of Object.entries(GLOBAL_STATIC)) {
        sock.write(serializeRep(null, param, value) + '\r\n');
      }
      // Global dynamic device settings
      sock.write(serializeRep(null, 'INPUT_METER_MODE', deviceSettings.inputMeterMode) + '\r\n');
      sock.write(serializeRep(null, 'METER_TYPE', deviceSettings.meterType) + '\r\n');
      sock.write(serializeRep(null, 'HEADPHONE_SOURCE', deviceSettings.headphoneSource) + '\r\n');
      sock.write(serializeRep(null, 'DISABLE_LEDS', deviceSettings.disableLeds) + '\r\n');
      sock.write(serializeRep(null, 'REAR_PANEL_LOCK', deviceSettings.rearPanelLock) + '\r\n');
      sock.write(serializeRep(null, 'AUTO_MIX_MODE', deviceSettings.autoMixMode) + '\r\n');
      sock.write(serializeRep(null, 'DFR1_BYPASS', deviceSettings.dfr1Bypass) + '\r\n');
      sock.write(serializeRep(null, 'DFR1_ASSIGNED_CHAN', deviceSettings.dfr1AssignedChan) + '\r\n');
      sock.write(serializeRep(null, 'DFR1_FREEZE', deviceSettings.dfr1Freeze) + '\r\n');
      sock.write(serializeRep(null, 'DFR2_BYPASS', deviceSettings.dfr2Bypass) + '\r\n');
      sock.write(serializeRep(null, 'DFR2_ASSIGNED_CHAN', deviceSettings.dfr2AssignedChan) + '\r\n');
      sock.write(serializeRep(null, 'DFR2_FREEZE', deviceSettings.dfr2Freeze) + '\r\n');
    }

    function handleGlobalGet(param, writeSingle) {
      if (param in GLOBAL_STATIC) {
        writeSingle(serializeRep(null, param, GLOBAL_STATIC[param]));
        return;
      }
      const dynamic = {
        INPUT_METER_MODE:  deviceSettings.inputMeterMode,
        METER_TYPE:        deviceSettings.meterType,
        HEADPHONE_SOURCE:  deviceSettings.headphoneSource,
        METER_RATE:        String(meterRate).padStart(5, '0'),
        DISABLE_LEDS:      deviceSettings.disableLeds,
        FLASH:             deviceSettings.flash,
        REAR_PANEL_LOCK:   deviceSettings.rearPanelLock,
        AUTO_MIX_MODE:     deviceSettings.autoMixMode,
        DFR1_BYPASS:       deviceSettings.dfr1Bypass,
        DFR1_ASSIGNED_CHAN: deviceSettings.dfr1AssignedChan,
        DFR1_FREEZE:       deviceSettings.dfr1Freeze,
        DFR2_BYPASS:       deviceSettings.dfr2Bypass,
        DFR2_ASSIGNED_CHAN: deviceSettings.dfr2AssignedChan,
        DFR2_FREEZE:       deviceSettings.dfr2Freeze,
      };
      if (param in dynamic) {
        writeSingle(serializeRep(null, param, dynamic[param]));
        return;
      }
      debug('Unhandled global GET param: %s', param);
    }

    function handleGlobalSet(param, value) {
      switch (param) {
        case 'DEVICE_ID': return; // read-only
        case 'INPUT_METER_MODE':
          deviceSettings.inputMeterMode = value;
          broadcast(serializeRep(null, 'INPUT_METER_MODE', value));
          break;
        case 'METER_TYPE':
          deviceSettings.meterType = value;
          broadcast(serializeRep(null, 'METER_TYPE', value));
          break;
        case 'HEADPHONE_SOURCE':
          deviceSettings.headphoneSource = value;
          broadcast(serializeRep(null, 'HEADPHONE_SOURCE', value));
          break;
        case 'DISABLE_LEDS':
          deviceSettings.disableLeds = value;
          broadcast(serializeRep(null, 'DISABLE_LEDS', value));
          break;
        case 'FLASH':
          deviceSettings.flash = value;
          broadcast(serializeRep(null, 'FLASH', value));
          if (value === 'ON') {
            setTimeout(() => {
              deviceSettings.flash = 'OFF';
              broadcast(serializeRep(null, 'FLASH', 'OFF'));
            }, 500);
          }
          break;
        case 'REAR_PANEL_LOCK':
          deviceSettings.rearPanelLock = value;
          broadcast(serializeRep(null, 'REAR_PANEL_LOCK', value));
          break;
        case 'AUTO_MIX_MODE':
          deviceSettings.autoMixMode = value;
          broadcast(serializeRep(null, 'AUTO_MIX_MODE', value));
          break;
        case 'DFR1_BYPASS':
          deviceSettings.dfr1Bypass = value;
          broadcast(serializeRep(null, 'DFR1_BYPASS', value));
          break;
        case 'DFR1_ASSIGNED_CHAN':
          deviceSettings.dfr1AssignedChan = value;
          broadcast(serializeRep(null, 'DFR1_ASSIGNED_CHAN', value));
          break;
        case 'DFR1_FREEZE':
          deviceSettings.dfr1Freeze = value;
          broadcast(serializeRep(null, 'DFR1_FREEZE', value));
          break;
        case 'DFR1_CLEAR_ALL_FILTERS':
          debug('DFR1_CLEAR_ALL_FILTERS triggered');
          break;
        case 'DFR2_BYPASS':
          deviceSettings.dfr2Bypass = value;
          broadcast(serializeRep(null, 'DFR2_BYPASS', value));
          break;
        case 'DFR2_ASSIGNED_CHAN':
          deviceSettings.dfr2AssignedChan = value;
          broadcast(serializeRep(null, 'DFR2_ASSIGNED_CHAN', value));
          break;
        case 'DFR2_FREEZE':
          deviceSettings.dfr2Freeze = value;
          broadcast(serializeRep(null, 'DFR2_FREEZE', value));
          break;
        case 'DFR2_CLEAR_ALL_FILTERS':
          debug('DFR2_CLEAR_ALL_FILTERS triggered');
          break;
        default:
          debug('Unhandled global SET param: %s', param);
      }
    }

    function handleMessage(msg, writeSingle) {
      if (msg.type === 'UNKNOWN') return;

      const { channel: ch, param, value } = msg;

      if (msg.type === 'SET') {
        // METER_RATE is sent with ch === 0 (broadcast address)
        if ((ch === 0 || ch === null) && param === 'METER_RATE') {
          setMeterRate(parseInt(value, 10));
          writeSingle(serializeRep(null, 'METER_RATE', String(parseInt(value, 10)).padStart(5, '0')));
          return;
        }

        if (ch === null) {
          handleGlobalSet(param, value);
          return;
        }

        const s = channels[ch];
        if (!s) return;

        switch (param) {
          case 'CHAN_NAME': {
            const stripped = String(value).replace(/^\{|\}$/g, '').trim().slice(0, 31);
            s.name = stripped;
            broadcast(serializeRep(ch, 'CHAN_NAME', `{${stripped.padEnd(31)}}`));
            break;
          }
          case 'AUDIO_MUTE': {
            const v = value === 'TOGGLE' ? (s.mute === 'ON' ? 'OFF' : 'ON') : value;
            s.mute = v;
            broadcast(serializeRep(ch, 'AUDIO_MUTE', v));
            break;
          }
          case 'AUDIO_GAIN_HI_RES': {
            const raw = Math.max(0, Math.min(1280, parseInt(value, 10)));
            s.gain = isNaN(raw) ? GAIN_0DB : raw;
            broadcast(serializeRep(ch, 'AUDIO_GAIN_HI_RES', padGain(s.gain)));
            break;
          }
          case 'ALWAYS_ON_ENABLE_A':
            s.alwaysOn = value;
            broadcast(serializeRep(ch, 'ALWAYS_ON_ENABLE_A', value));
            break;
          case 'ALWAYS_ON_ENABLE_B':
            s.alwaysOnB = value;
            broadcast(serializeRep(ch, 'ALWAYS_ON_ENABLE_B', value));
            break;
          case 'CHAIR_OVERRIDE_ENABLE_B':
            s.chairOverride = value;
            broadcast(serializeRep(ch, 'CHAIR_OVERRIDE_ENABLE_B', value));
            break;
          case 'CHAIR_MUTE_CTRL_ENABLE_B':
            s.chairMuteCtrl = value;
            broadcast(serializeRep(ch, 'CHAIR_MUTE_CTRL_ENABLE_B', value));
            break;
          case 'INPUT_AUDIO_MIX_BUS':
            s.mixBus = value;
            broadcast(serializeRep(ch, 'INPUT_AUDIO_MIX_BUS', value));
            break;
          case 'HW_GATING_LOGIC':
            s.hwGatingLogic = value;
            broadcast(serializeRep(ch, 'HW_GATING_LOGIC', value));
            break;
          case 'SET_INTELLIMIX_MODE':
          case 'INTELLIMIX_MODE':
            s.intellimix = INTELLIMIX_MODES.includes(value) ? value : 'CLASSIC';
            broadcast(serializeRep(ch, 'INTELLIMIX_MODE', s.intellimix));
            break;
          case 'LOW_CUT_ENABLE':
            s.lowCutEnabled = value === 'ON' ? 'ON' : 'OFF';
            broadcast(serializeRep(ch, 'LOW_CUT_ENABLE', s.lowCutEnabled));
            break;
          case 'LOW_CUT_FREQ': {
            const freq = Math.max(25, Math.min(320, parseInt(value, 10) || 80));
            s.lowCutFreq = freq;
            broadcast(serializeRep(ch, 'LOW_CUT_FREQ', padFreq(freq)));
            break;
          }
          case 'HIGH_SHELF_ENABLE':
            s.hiShelfEnabled = value === 'ON' ? 'ON' : 'OFF';
            broadcast(serializeRep(ch, 'HIGH_SHELF_ENABLE', s.hiShelfEnabled));
            break;
          case 'HIGH_SHELF_GAIN': {
            const gain = Math.max(0, Math.min(24, parseInt(value, 10)));
            s.hiShelfGain = isNaN(gain) ? 12 : gain;
            broadcast(serializeRep(ch, 'HIGH_SHELF_GAIN', padHiShelf(s.hiShelfGain)));
            break;
          }
          case 'INPUT_AUDIO_SOURCE':
            s.inputSource = /^network|^dante/i.test(value) ? 'Network' : 'Analog';
            broadcast(serializeRep(ch, 'INPUT_AUDIO_SOURCE', s.inputSource));
            break;
          case 'PHANTOM_PWR_ENABLE':
            s.phantomPower = value === 'ON' ? 'ON' : 'OFF';
            broadcast(serializeRep(ch, 'PHANTOM_PWR_ENABLE', s.phantomPower));
            break;
          case 'AUDIO_IN_LVL_SWITCH':
            s.micSens = value;
            broadcast(serializeRep(ch, 'AUDIO_IN_LVL_SWITCH', s.micSens));
            break;
          case 'DIRECT_OUT_SOURCE':
            s.directOutSource = value;
            broadcast(serializeRep(ch, 'DIRECT_OUT_SOURCE', value));
            break;
          case 'AUDIO_OUT_LVL_SWITCH':
            s.audioOutLvlSwitch = value;
            broadcast(serializeRep(ch, 'AUDIO_OUT_LVL_SWITCH', value));
            break;
          default:
            debug('Unhandled SET param: %s', param);
        }
        return;
      }

      if (msg.type === 'GET') {
        if (ch === null) {
          handleGlobalGet(param, writeSingle);
          return;
        }
        // ch === 0 fallback for DEVICE_ID (some clients send with channel 0)
        if (ch === 0 && param === 'DEVICE_ID') {
          writeSingle(serializeRep(null, 'DEVICE_ID', GLOBAL_STATIC.DEVICE_ID));
          return;
        }
        const s = channels[ch];
        if (!s) return;
        switch (param) {
          case 'CHAN_NAME':             writeSingle(serializeRep(ch, 'CHAN_NAME', `{${s.name.padEnd(31)}}`)); break;
          case 'AUDIO_MUTE':           writeSingle(serializeRep(ch, 'AUDIO_MUTE', s.mute)); break;
          case 'AUDIO_GAIN_HI_RES':    writeSingle(serializeRep(ch, 'AUDIO_GAIN_HI_RES', padGain(s.gain))); break;
          case 'ALWAYS_ON_ENABLE_A':   writeSingle(serializeRep(ch, 'ALWAYS_ON_ENABLE_A', s.alwaysOn)); break;
          case 'ALWAYS_ON_ENABLE_B':   writeSingle(serializeRep(ch, 'ALWAYS_ON_ENABLE_B', s.alwaysOnB ?? 'OFF')); break;
          case 'CHAIR_OVERRIDE_ENABLE_B': writeSingle(serializeRep(ch, 'CHAIR_OVERRIDE_ENABLE_B', s.chairOverride ?? 'OFF')); break;
          case 'CHAIR_MUTE_CTRL_ENABLE_B': writeSingle(serializeRep(ch, 'CHAIR_MUTE_CTRL_ENABLE_B', s.chairMuteCtrl ?? 'OFF')); break;
          case 'INPUT_AUDIO_MIX_BUS':  writeSingle(serializeRep(ch, 'INPUT_AUDIO_MIX_BUS', s.mixBus ?? 'BOTH')); break;
          case 'HW_GATING_LOGIC':      writeSingle(serializeRep(ch, 'HW_GATING_LOGIC', s.hwGatingLogic ?? 'MIXBUS_A')); break;
          case 'INTELLIMIX_MODE':      writeSingle(serializeRep(ch, 'INTELLIMIX_MODE', s.intellimix)); break;
          case 'INPUT_AUDIO_GATE_A':   writeSingle(serializeRep(ch, 'INPUT_AUDIO_GATE_A', s.gate)); break;
          case 'INPUT_AUDIO_SOURCE':   writeSingle(serializeRep(ch, 'INPUT_AUDIO_SOURCE', s.inputSource)); break;
          case 'PHANTOM_PWR_ENABLE':   writeSingle(serializeRep(ch, 'PHANTOM_PWR_ENABLE', s.phantomPower)); break;
          case 'AUDIO_IN_LVL_SWITCH':  writeSingle(serializeRep(ch, 'AUDIO_IN_LVL_SWITCH', s.micSens)); break;
          case 'LOW_CUT_ENABLE':       writeSingle(serializeRep(ch, 'LOW_CUT_ENABLE', s.lowCutEnabled ?? 'OFF')); break;
          case 'LOW_CUT_FREQ':         writeSingle(serializeRep(ch, 'LOW_CUT_FREQ', padFreq(s.lowCutFreq ?? 80))); break;
          case 'HIGH_SHELF_ENABLE':    writeSingle(serializeRep(ch, 'HIGH_SHELF_ENABLE', s.hiShelfEnabled ?? 'OFF')); break;
          case 'HIGH_SHELF_GAIN':      writeSingle(serializeRep(ch, 'HIGH_SHELF_GAIN', padHiShelf(s.hiShelfGain ?? 12))); break;
          case 'DIRECT_OUT_SOURCE':    writeSingle(serializeRep(ch, 'DIRECT_OUT_SOURCE', s.directOutSource ?? 'POST_FADER')); break;
          case 'AUDIO_OUT_LVL_SWITCH': writeSingle(serializeRep(ch, 'AUDIO_OUT_LVL_SWITCH', s.audioOutLvlSwitch ?? 'LINE_LVL')); break;
          default:
            debug('Unhandled GET param: %s', param);
        }
      }
    }

    const server = net.createServer((socket) => {
      debug('Client connected: %s', socket.remoteAddress);
      clients.add(socket);
      socket.setEncoding('utf8');

      let buf = '';
      socket.on('data', (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('>')) !== -1) {
          const raw = buf.slice(0, idx + 1).trim();
          buf = buf.slice(idx + 1);
          if (!raw) continue;
          debug('[← client] %s', raw);
          const msg = parse(raw);
          if (msg.type === 'UNKNOWN') {
            debug('Discarding unknown frame: %s', raw);
            continue;
          }
          handleMessage(msg, (reply) => {
            debug('[→ client] %s', reply);
            socket.write(reply + '\r\n');
          });
        }
      });

      socket.on('error', (err) => debug('Socket error: %s', err.message));
      socket.on('close', () => {
        clients.delete(socket);
        debug('Client disconnected');
      });
    });

    let retries = 0;
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && retries < 6) {
        retries++;
        debug('Port %d busy — retry %d in 800ms...', port, retries);
        setTimeout(() => server.listen(port), 800);
        return;
      }
      console.error('[mock] Server error:', err.message);
      reject(err);
    });

    server.listen(port, () => {
      debug('Mock SCM820 listening on port %d', port);
      console.log(`[mock] SCM820 mock listening on port ${port}`);
      resolve(server);
    });
  });
}

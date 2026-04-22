import net from 'net';
import debugLib from 'debug';
import { parse, serializeRep, serializeSample } from './parser.js';

const debug = debugLib('scm820:mock');

const INPUT_CHANNEL_COUNT = 8;
const AUX_CHANNEL = 9;
const SAMPLE_LEVEL_COUNT = 19;

const DEFAULT_NAMES = ['Podium', 'Panel L', 'Panel R', 'Table 1', 'Table 2', 'Table 3', 'Floor', 'Aux'];
const INTELLIMIX_MODES = ['CLASSIC', 'NOISE_ADAPTIVE', 'GATING', 'MANUAL'];

function makeChannelState() {
  return {
    name: '',
    muteA: 'OFF',
    muteB: 'OFF',
    gainA: '0',
    alwaysOn: 'OFF',
    intellimix: 'CLASSIC',
    gate: 'OFF',
    inputType: 'ANALOG',
  };
}

export function startMock(port) {
  return new Promise((resolve, reject) => {
    const channels = {};
    for (let ch = 1; ch <= INPUT_CHANNEL_COUNT; ch++) {
      channels[ch] = { ...makeChannelState(), name: DEFAULT_NAMES[ch - 1] };
    }
    channels[AUX_CHANNEL] = { ...makeChannelState(), name: 'Aux' };
    // Mix bus outputs (18 = Output A, 19 = Output B)
    channels[18] = { ...makeChannelState(), name: 'Output A' };
    channels[19] = { ...makeChannelState(), name: 'Output B' };

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

    function sendInitialState(sock) {
      for (let ch = 1; ch <= INPUT_CHANNEL_COUNT; ch++) {
        const s = channels[ch];
        sock.write(serializeRep(ch, 'CHAN_NAME', s.name) + '\r\n');
        sock.write(serializeRep(ch, 'CHAN_MUTE_A', s.muteA) + '\r\n');
        sock.write(serializeRep(ch, 'CHAN_MUTE_B', s.muteB) + '\r\n');
        sock.write(serializeRep(ch, 'INPUT_GAIN_HI_A', s.gainA) + '\r\n');
        sock.write(serializeRep(ch, 'ALWAYS_ON_ENABLE_A', s.alwaysOn) + '\r\n');
        sock.write(serializeRep(ch, 'INTELLIMIX_MODE', s.intellimix) + '\r\n');
        sock.write(serializeRep(ch, 'INPUT_AUDIO_GATE_A', s.gate) + '\r\n');
        sock.write(serializeRep(ch, 'INPUT_TYPE', s.inputType) + '\r\n');
      }
      // Output channels initial state
      for (const ch of [18, 19]) {
        const s = channels[ch];
        if (!s) continue;
        sock.write(serializeRep(ch, 'CHAN_NAME', s.name) + '\r\n');
        sock.write(serializeRep(ch, 'CHAN_MUTE_A', s.muteA) + '\r\n');
        sock.write(serializeRep(ch, 'CHAN_MUTE_B', s.muteB) + '\r\n');
      }
    }

    function handleMessage(msg, writeSingle) {
      if (msg.type === 'UNKNOWN') return;

      const { channel: ch, param, value } = msg;

      if (msg.type === 'SET') {
        if (ch === 0 && param === 'METER_RATE') {
          setMeterRate(parseInt(value, 10));
          return;
        }

        const s = channels[ch];
        if (!s) return;

        switch (param) {
          case 'CHAN_NAME':
            s.name = String(value).slice(0, 12);
            broadcast(serializeRep(ch, 'CHAN_NAME', s.name));
            break;
          case 'CHAN_MUTE_A': {
            const v = value === 'TOGGLE' ? (s.muteA === 'ON' ? 'OFF' : 'ON') : value;
            s.muteA = v;
            broadcast(serializeRep(ch, 'CHAN_MUTE_A', v));
            break;
          }
          case 'CHAN_MUTE_B': {
            const v = value === 'TOGGLE' ? (s.muteB === 'ON' ? 'OFF' : 'ON') : value;
            s.muteB = v;
            broadcast(serializeRep(ch, 'CHAN_MUTE_B', v));
            break;
          }
          case 'INPUT_GAIN_HI_A':
            s.gainA = value;
            broadcast(serializeRep(ch, 'INPUT_GAIN_HI_A', value));
            break;
          case 'ALWAYS_ON_ENABLE_A':
            s.alwaysOn = value;
            broadcast(serializeRep(ch, 'ALWAYS_ON_ENABLE_A', value));
            break;
          case 'INTELLIMIX_MODE':
            s.intellimix = INTELLIMIX_MODES.includes(value) ? value : 'CLASSIC';
            broadcast(serializeRep(ch, 'INTELLIMIX_MODE', s.intellimix));
            break;
          case 'INPUT_TYPE':
            s.inputType = value === 'DANTE' ? 'DANTE' : 'ANALOG';
            broadcast(serializeRep(ch, 'INPUT_TYPE', s.inputType));
            break;
          default:
            debug('Unhandled SET param: %s', param);
        }
        return;
      }

      if (msg.type === 'GET') {
        const s = channels[ch];
        if (!s) return;
        switch (param) {
          case 'CHAN_NAME': writeSingle(serializeRep(ch, 'CHAN_NAME', s.name)); break;
          case 'CHAN_MUTE_A': writeSingle(serializeRep(ch, 'CHAN_MUTE_A', s.muteA)); break;
          case 'CHAN_MUTE_B': writeSingle(serializeRep(ch, 'CHAN_MUTE_B', s.muteB)); break;
          case 'INPUT_GAIN_HI_A': writeSingle(serializeRep(ch, 'INPUT_GAIN_HI_A', s.gainA)); break;
          case 'ALWAYS_ON_ENABLE_A': writeSingle(serializeRep(ch, 'ALWAYS_ON_ENABLE_A', s.alwaysOn)); break;
          case 'INTELLIMIX_MODE': writeSingle(serializeRep(ch, 'INTELLIMIX_MODE', s.intellimix)); break;
          case 'INPUT_AUDIO_GATE_A': writeSingle(serializeRep(ch, 'INPUT_AUDIO_GATE_A', s.gate)); break;
          case 'INPUT_TYPE': writeSingle(serializeRep(ch, 'INPUT_TYPE', s.inputType || 'ANALOG')); break;
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

      sendInitialState(socket);
    });

    server.on('error', (err) => {
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

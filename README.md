# SCM820 Virtual Mixer

A web-based virtual mixer for the **Shure SCM820** automatic mixing console. Connects to the device over TCP/IP and provides a real-time browser UI for controlling all input channels, outputs, and device settings.

```
Browser (React) ←→ WebSocket ←→ Node.js bridge server ←→ TCP port 2202 ←→ SCM820
```

## Features

- Real-time channel control: fader gain, mute, Always On, IntelliMix mode
- Per-channel input source (Analog / Network), mic sensitivity, and 48V phantom power
- VU meter display driven by SCM820 SAMPLE frames
- Output A/B controls
- Device settings panel: meter mode, meter type, headphone source, LED disable, flash, rear panel lock
- Live device info: Device ID, serial number, firmware version, network configuration
- Mock SCM820 server for local development without hardware

## Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, `ws`, built-in `net` |
| Frontend | React 18, Vite, Tailwind CSS |
| State | Zustand |
| Metering | Canvas API via `requestAnimationFrame` |

## Getting Started

### Install dependencies

```bash
npm run install:all
```

### Development with mock device (no hardware required)

```bash
npm run dev:mock
```

This starts the Node.js bridge server with a software mock of the SCM820 on TCP port 2202, and the Vite dev server for the React client. Open [http://localhost:5173](http://localhost:5173).

### Development with a real SCM820

Create a `.env` file in the `server/` directory:

```env
SCM820_HOST=192.168.1.x   # IP address of your SCM820
SCM820_PORT=2202           # Always 2202 unless using the mock
WS_PORT=8080               # WebSocket server port
USE_MOCK=false
```

Then run:

```bash
npm run dev
```

The UI will connect automatically. If the device IP hasn't been set yet, a configuration dialog appears after 3 seconds. You can also change the IP at any time via the status indicator in the top-right corner.

### Production

```bash
# Build the React client
npm run build --prefix client

# Start the server
npm start --prefix server
```

## Environment Variables

All variables go in `server/.env`.

| Variable | Default | Description |
|---|---|---|
| `SCM820_HOST` | `127.0.0.1` | IP address of the SCM820 |
| `SCM820_PORT` | `2202` | TCP port (always 2202 for real hardware) |
| `WS_PORT` | `8080` | WebSocket server port |
| `USE_MOCK` | `false` | Set to `true` to use the built-in mock device |

## Project Structure

```
/
├── server/
│   ├── index.js      # HTTP + WebSocket server entry point
│   ├── bridge.js     # TCP ↔ WebSocket bridge with auto-reconnect
│   ├── parser.js     # SCM820 message parser and serializer
│   └── mock.js       # Mock SCM820 device (responds to all GET/SET commands)
│
└── client/
    └── src/
        ├── hooks/
        │   ├── useSCM820.js     # WebSocket connection and message dispatch
        │   └── useMetering.js   # SAMPLE frame → Canvas meter rendering
        ├── components/
        │   ├── ChannelStrip.jsx # Per-channel controls
        │   ├── MasterSection.jsx
        │   ├── OutputTab.jsx
        │   ├── VUMeter.jsx
        │   ├── MixerLayout.jsx
        │   └── ConnectionModal.jsx
        └── state/
            └── mixerStore.js    # Zustand store for all mixer and device state
```

## Debugging

Enable verbose TCP frame logging with the `DEBUG` environment variable:

```bash
DEBUG=scm820:* npm run dev --prefix server
```

Without `DEBUG`, the server logs all non-SAMPLE TCP frames to stdout prefixed with `[→ SCM820]` and `[← SCM820]`.

## SCM820 Protocol Notes

The SCM820 communicates over TCP on port 2202 using ASCII envelopes:

```
< COMMAND [CHANNEL] PARAMETER [VALUE] >
```

Key parameters used by this app:

| Parameter | Values | Notes |
|---|---|---|
| `AUDIO_MUTE` | `ON` / `OFF` / `TOGGLE` | Per channel |
| `AUDIO_GAIN_HI_RES` | `0000`–`1280` | 0.1 dB steps; `1100` = 0 dB, `1280` = +18 dB |
| `CHAN_NAME` | `{Name padded to 31 chars}` | Brace-wrapped, space-padded |
| `ALWAYS_ON_ENABLE_A` | `ON` / `OFF` | |
| `INTELLIMIX_MODE` | `CLASSIC` / `SMOOTH` / `EXTREME` / `CUSTOM` / `MANUAL` / `CUSTOM_PRESET` | |
| `INPUT_AUDIO_SOURCE` | `Analog` / `Network` | |
| `PHANTOM_PWR_ENABLE` | `ON` / `OFF` | Analog inputs only |
| `AUDIO_IN_LVL_SWITCH` | `LINE_LVL` / `MIC_LVL_26DB` / `MIC_LVL_46DB` | Analog inputs only |
| `INPUT_AUDIO_GATE_A` | `ON` / `OFF` | Read-only; gate open status |
| `METER_RATE` | `00000`–`99999` | Milliseconds; `0` stops metering |

Channel numbers: `1–8` inputs, `9` aux, `18` Output A, `19` Output B. Channel `0` in SET commands targets all channels. Global commands (no channel number) are used for device-level parameters like `DEVICE_ID`, `FW_VER`, and network settings.

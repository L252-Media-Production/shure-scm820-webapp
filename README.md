# SCM820 Virtual Mixer

A web-based virtual mixer for the **Shure SCM820** automatic mixing console. Connects to the device over TCP/IP and provides a real-time browser UI for controlling all input channels, outputs, and device settings.

```
Browser (React) ←→ WebSocket ←→ Node.js bridge server ←→ TCP port 2202 ←→ SCM820
```

## Features

- Real-time channel control: fader gain, mute, Always On
- Per-channel input source (Analog / Network), mic sensitivity, and 48V phantom power
- VU meter display driven by SCM820 SAMPLE frames
- Output A/B controls with mute and gain
- Direct output source assignment (channels 10–17)
- Device settings panel: meter mode, meter type, headphone source, LED disable, flash, rear panel lock
- Live device info: Device ID, serial number, firmware version, network configuration
- Fader resolution toggle (Coarse / Fine) per channel strip
- In-browser debug console showing live audio command traffic
- PWA — installable from the browser on desktop and mobile
- Docker support for network-accessible deployment
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

### Production (manual)

```bash
# Build the React client
npm run build --prefix client

# Start the server (serves both the UI and WebSocket on port 8080)
npm start --prefix server
```

## Docker

The included `Dockerfile` builds a single production image: the React client is compiled in a build stage and the output is served as static files by the Node.js server alongside the WebSocket endpoint — all on one port.

### Quick start

```bash
# Real hardware
SCM820_HOST=192.168.1.x docker compose up --build

# Mock device (no hardware needed)
USE_MOCK=true docker compose up --build
```

The app is available at `http://<host>:8080` and is installable as a PWA from any browser on the network.

### Custom WebSocket URL

By default the client derives the WebSocket URL from `window.location.host`, so it always connects back to the same server that served the page. If you need to override this (e.g. reverse proxy with a different port), pass a build argument:

```bash
docker build --build-arg VITE_WS_URL=ws://mixer.local:80 -t scm820-webapp .
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `SCM820_HOST` | `127.0.0.1` | IP address of the SCM820 |
| `SCM820_PORT` | `2202` | TCP port (always 2202 for real hardware) |
| `WS_PORT` | `8080` | WebSocket / HTTP server port |
| `WS_HOST` | `0.0.0.0` | Bind address |
| `USE_MOCK` | `false` | Set to `true` to use the built-in mock device |

## Fader Resolution

Each channel strip has a **CRSE / FINE** toggle button beneath the dB readout.

| Mode | Behaviour |
|---|---|
| **CRSE** (default) | The SET command is sent once when the fader is released. Use this for normal operation to avoid flooding the device with rapid gain changes. |
| **FINE** (red) | A SET command is sent on every pointer movement, matching the device's maximum update rate. Use this when precise real-time adjustment is needed. The button turns red as a caution indicator. |

## Debug Console

A pull-up drawer is available at the bottom of the screen. Click **Debug Console** to expand it.

The console shows a live, timestamped log of all inbound (`←`) and outbound (`→`) audio commands exchanged with the device. Non-audio parameters (firmware version, IP addresses, network configuration) are filtered out — only gain, mute, gate, source, and other audio-relevant parameters are shown.

- Cyan `→` — SET command sent from the UI to the device
- Green `←` — REP message received from the device
- The **Clear** button flushes the log
- A badge on the handle shows how many new entries arrived while the drawer was closed

## Project Structure

```
/
├── Dockerfile
├── docker-compose.yml
├── server/
│   ├── index.js      # HTTP + WebSocket server entry point; serves client/dist
│   ├── bridge.js     # TCP ↔ WebSocket bridge with auto-reconnect
│   ├── parser.js     # SCM820 message parser and serializer
│   └── mock.js       # Mock SCM820 device (responds to all GET/SET commands)
│
└── client/
    └── src/
        ├── hooks/
        │   ├── useSCM820.js     # WebSocket connection, message dispatch, debug log
        │   └── useMetering.js   # SAMPLE frame → Canvas meter rendering
        ├── components/
        │   ├── ChannelStrip.jsx # Per-channel controls
        │   ├── Fader.jsx        # Fader with Coarse/Fine resolution toggle
        │   ├── MasterSection.jsx
        │   ├── OutputTab.jsx
        │   ├── VUMeter.jsx
        │   ├── MixerLayout.jsx
        │   ├── DebugDrawer.jsx  # Pull-up debug console
        │   └── ConnectionModal.jsx
        └── state/
            └── mixerStore.js    # Zustand store for all mixer and device state
```

## Debugging

### In-browser debug console

Click the **Debug Console** handle at the bottom of the UI to view live audio command traffic. See the [Debug Console](#debug-console) section above for details.

### Server-side TCP logging

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
| `ALWAYS_ON_ENABLE_A` | `ON` / `OFF` | Input channels only |
| `INPUT_AUDIO_SOURCE` | `Analog` / `Network` | |
| `PHANTOM_PWR_ENABLE` | `ON` / `OFF` | Analog inputs only |
| `AUDIO_IN_LVL_SWITCH` | `LINE_LVL` / `MIC_LVL_26DB` / `MIC_LVL_46DB` | Analog inputs only |
| `INPUT_AUDIO_GATE_A` | `ON` / `OFF` | Read-only; gate open status |
| `DIRECT_OUT_SOURCE` | device-specific | Channels 10–17 |
| `AUDIO_OUT_LVL_SWITCH` | device-specific | Output A/B level switch |
| `METER_RATE` | `00000`–`99999` | Milliseconds; `0` stops metering |

Channel numbers: `1–8` inputs, `9` aux, `10–17` direct outputs, `18` Output A, `19` Output B. Channel `0` in SET commands targets all channels. Global commands (no channel number) are used for device-level parameters like `DEVICE_ID`, `FW_VER`, and network settings.

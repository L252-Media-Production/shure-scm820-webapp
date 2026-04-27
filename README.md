# SCM820 Virtual Mixer

A web-based virtual mixer for the **Shure SCM820** automatic mixing console. Connects to the device over TCP/IP and provides a real-time browser UI for controlling all input channels, outputs, and device settings.

```
Browser (React) ←→ WebSocket ←→ Node.js bridge server ←→ TCP port 2202 ←→ SCM820
                                        ↕
                              Apple MIDI / RTP-MIDI (UDP)
                                        ↕
                              Behringer X-Touch (MCU mode)
```

## Features

- Real-time channel control: fader gain, mute, Always On
- Per-channel input source (Analog / Network), mic sensitivity, and 48V phantom power
- Per-channel EQ: lo-cut filter (25–320 Hz) and hi-shelf gain (±12 dB) with collapsible panel in each channel strip; values are click-to-edit
- VU meter display driven by SCM820 SAMPLE frames
- Output A/B controls with mute and gain
- Direct output source assignment (channels 10–17)
- Device settings panel: meter mode, meter type, headphone source, LED disable, flash, rear panel lock
- Live device info: Device ID, serial number, firmware version, network configuration
- Fader resolution toggle (Coarse / Fine) per channel strip
- In-browser debug console with live audio command traffic and a **Hide Peaks** filter (on by default)
- Tab bar with reorderable tabs (session-based); IntelliMix and DFR tabs show "Coming Soon!"
- Automatic update check — checks GitHub releases every 24 hours; amber **ⓘ** icon in the header when a new release is available
- **Automatically Check For Updates** preference in the status popover (enabled by default, persisted in `localStorage`)
- PWA — installable from the browser on desktop and mobile
- Docker support for network-accessible deployment
- Mock SCM820 server for local development without hardware
- **Behringer X-Touch hardware control surface** via Apple MIDI / RTP-MIDI over the network
- **X-Touch AUX bank swap** — FADER BANK LEFT/RIGHT toggles any configurable strip (default strip 8) between its normal input channel and the SCM820 AUX input (ch 9); configurable from the status panel
- **X-Touch encoder mode scribble colors** — scribble strip backgrounds turn green (effect ON) or red (effect OFF) when lo-cut or hi-shelf encoder mode is active; strips return to white when the mode is deactivated
- **X-Touch peak-hold metering** — channel meters hold the peak value for 1.5 s then decay smoothly rather than snapping to zero on silence

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
| `XTOUCH_PORT` | `5004` | UDP control port for the X-Touch Apple MIDI session (data port = this + 1) |

## Behringer X-Touch Integration

The server acts as an **Apple MIDI (RTP-MIDI) acceptor**. The X-Touch initiates the connection — no IP address needs to be configured in the app. The server listens on two adjacent UDP ports (default 5004 control / 5005 data) and waits for the X-Touch to connect.

### X-Touch setup

1. On the X-Touch, go to **Setup → MIDI/Control → Network**
2. Set the **Host** IP to the IP address of the machine running this server
3. Set the **Port** to `5004` (or whatever `XTOUCH_PORT` is set to)
4. Set the mode to **MC Master** (Mackie Control)
5. The X-Touch will initiate the Apple MIDI session automatically on boot

Once connected, the status indicator in the browser UI shows **Connected** along with the X-Touch's IP address.

> **Network requirement:** The X-Touch and the server must be on the **same subnet**. Apple MIDI uses UDP and will not traverse subnets without explicit routing. If running in Docker, publish the UDP ports (`-p 5004:5004/udp -p 5005:5005/udp`) and ensure the container's host is reachable from the X-Touch's subnet.

### Button and fader mapping

| X-Touch control | SCM820 action |
|---|---|
| **Faders 1–8** | Input channel gain (AUDIO_GAIN_HI_RES ch 1–8) |
| **Master fader** | Output A + B gain simultaneously (ch 18 + 19) |
| **REC ARM 1–8** | Toggle 48V phantom power (analog inputs only; ignored in Network mode); scribble line 2 shows `48V ON` / `48V OFF` |
| **SOLO 1–8** | Toggle input source between **Analog** and **Network** (ignored in Network mode — no LED/scribble change) |
| **MUTE 1–8** | Toggle mute on both mixes |
| **SELECT 1–8** | Cycle mic sensitivity: `LINE_LVL` → `MIC_LVL_26DB` → `MIC_LVL_46DB` (analog inputs only; ignored in Network mode) |
| **SOLO LED** | Lit when input source is DANTE/Network |
| **MUTE LED** | Lit when channel is muted |
| **REC ARM LED** | Lit when phantom power is on |
| **Scribble line 1** | Channel name from the SCM820 |
| **Scribble line 2** | Last-touched parameter (gain dB, mute state, mic sensitivity, 48V state, lo-cut freq, hi-shelf gain) |
| **Channel meters** | Live SCM820 input levels (SAMPLE frames at 100 ms) |
| **Encoder Assign — TRACK** | Switch encoders to **lo-cut mode**: rotate = `LOW_CUT_FREQ` (25–320 Hz, 1 Hz/click); push = toggle `LOW_CUT_ENABLE`; scribble bg = green (enabled) / red (disabled) |
| **Encoder Assign — PAN** | Switch encoders to **hi-shelf mode**: rotate = `HIGH_SHELF_GAIN` (±12 dB, 1 dB/click); push = toggle `HIGH_SHELF_ENABLE`; scribble bg = green (enabled) / red (disabled) |
| **Encoder Assign — EQ** | Switch encoders to **fine gain mode**: rotate = `AUDIO_GAIN_HI_RES` in small increments |
| **Pressing the active Encoder Assign button again** | Deactivates encoder mode; scribble strips return to white with channel name / last-touched status |
| **FADER BANK LEFT / RIGHT** | Toggle **AUX bank swap**: the configured strip (default strip 8) switches between its normal input channel and the SCM820 AUX input (ch 9); the swapped strip turns yellow while active |
| **AUX swap strip** | Configurable (strips 1–8) via the **X-Touch** section of the status panel; default strip 8; setting is persisted across sessions |

### Fader calibration

The X-Touch MCU fader range is mapped to the SCM820 gain range using a **two-segment piecewise linear map** anchored at 0 dB, so both devices agree on unity gain regardless of their different full-scale ranges:

| X-Touch fader | SCM820 gain | dB |
|---|---|---|
| Bottom (0) | 0 | −∞ |
| Unity mark (~77%) | 1100 | 0 dB |
| Full open (16383) | 1200 | +10 dB |

The X-Touch physically tops out at +10 dB in MCU mode; the SCM820's upper range of +10 dB to +18 dB is not reachable from the fader (use the web UI for that range). The same map applies when a strip is in AUX bank swap mode.

### Multiple X-Touch units

**Not currently supported.** Apple MIDI is point-to-point — each session requires its own UDP port pair. The server accepts one X-Touch at a time. A second unit would need a second port pair (e.g. 5006/5007) and a second bridge instance. This is architecturally straightforward but not yet implemented.

## Known Issues

| Issue | Details |
|---|---|
| **X-Touch fader calibration drift** | The two-segment piecewise linear map anchors at 0 dB and +10 dB, but the X-Touch MCU fader physical response is not perfectly linear. Small discrepancies (±1–2 dB) can appear between the X-Touch fader position and the actual SCM820 gain, particularly in the lower half of the travel. |
| **AUX gain range +10 dB to +18 dB not reachable via fader** | When the AUX bank swap is active, the swapped strip fader tops out at +10 dB (X-Touch MCU maximum), matching the same limit as input channel faders. Gains above +10 dB for the AUX channel require the web UI. |
| **EQ parameters (lo-cut / hi-shelf) not available for AUX in bank swap mode** | When AUX bank swap is active, encoder modes (lo-cut, hi-shelf, fine gain) still operate on the underlying input channel, not on ch 9. AUX EQ is controllable from the web UI only. |
| **Changing AUX swap strip while bank is active deactivates the bank** | Selecting a different strip from the settings panel while the AUX bank is active will deactivate the swap before switching to the new strip. Re-trigger FADER BANK to reactivate. |

## Fader Resolution

Each channel strip has a **CRSE / FINE** toggle button beneath the dB readout.

| Mode | Behaviour |
|---|---|
| **CRSE** (default) | The SET command is sent once when the fader is released. Use this for normal operation to avoid flooding the device with rapid gain changes. |
| **FINE** (orange) | A SET command is sent on every pointer movement, matching the device's maximum update rate. Use this when precise real-time adjustment is needed. The button turns orange as a caution indicator. |

## Debug Console

A pull-up drawer is available at the bottom of the screen. Click **Debug Console** to expand it.

The console shows a live, timestamped log of all inbound (`←`) and outbound (`→`) audio commands exchanged with the device. Non-audio parameters (firmware version, IP addresses, network configuration) are filtered out — only gain, mute, gate, source, and other audio-relevant parameters are shown.

- Cyan `→` — SET command sent from the UI to the device
- Green `←` — REP message received from the device
- **Hide Peaks** checkbox (enabled by default) — filters out high-frequency `AUDIO_IN_PEAK_LVL` and `AUDIO_OUT_PEAK_LVL` messages that would otherwise flood the log
- The **Clear** button flushes the log
- A badge on the handle shows how many new entries arrived while the drawer was closed

## Project Structure

```
/
├── Dockerfile
├── compose.yml
├── server/
│   ├── index.js          # HTTP + WebSocket server entry point; serves client/dist
│   ├── bridge.js         # TCP ↔ WebSocket bridge with auto-reconnect
│   ├── parser.js         # SCM820 message parser and serializer
│   ├── mock.js           # Mock SCM820 device (responds to all GET/SET commands)
│   ├── xtouchBridge.js   # MCU ↔ SCM820 mapping, shadow state, LED/fader/meter logic
│   └── rtpmidiClient.js  # Pure-JS Apple MIDI (RTP-MIDI) server — accepts X-Touch sessions
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
| `LOW_CUT_ENABLE` | `ON` / `OFF` | Lo-cut filter on/off |
| `LOW_CUT_FREQ` | `025`–`320` | Lo-cut frequency in Hz, 3-digit zero-padded |
| `HIGH_SHELF_ENABLE` | `ON` / `OFF` | Hi-shelf filter on/off |
| `HIGH_SHELF_GAIN` | `000`–`024` | Hi-shelf gain; raw `12` = 0 dB, range = −12 to +12 dB, 3-digit zero-padded |
| `DIRECT_OUT_SOURCE` | device-specific | Channels 10–17 |
| `AUDIO_OUT_LVL_SWITCH` | device-specific | Output A/B level switch |
| `METER_RATE` | `00000`–`99999` | Milliseconds; `0` stops metering |

Channel numbers: `1–8` inputs, `9` aux, `10–17` direct outputs, `18` Output A, `19` Output B. Channel `0` in SET commands targets all channels. Global commands (no channel number) are used for device-level parameters like `DEVICE_ID`, `FW_VER`, and network settings.

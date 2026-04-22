# SCM820 Virtual Mixer — Project Guide

## Project overview

This project is a web-based virtual mixer that connects to a **Shure SCM820** automatic mixing console via its TCP/IP command string API and exposes a real-time browser UI for controlling audio channels.

**Architecture:**
```
Browser (React) ←→ WebSocket (ws://) ←→ Node.js bridge server ←→ TCP socket (port 2202) ←→ SCM820
```

---

## SCM820 protocol

The SCM820 communicates over **TCP on port 2202** using ASCII command strings. All messages follow this envelope format:

```
< COMMAND CHANNEL PARAMETER [VALUE] >
```

### Command types

| Type | Direction | Description |
|---|---|---|
| `GET` | Client → Device | Request current value of a parameter |
| `SET` | Client → Device | Change a parameter value |
| `REP` | Device → Client | Device reply to GET or SET; also sent proactively on front-panel changes |
| `SAMPLE` | Device → Client | Metering data (when polling is active) |

### Channel numbers

| Value | Meaning |
|---|---|
| `0` | All channels (broadcast) |
| `1–8` | Input channels |
| `9` | Aux input |
| `10–17` | Direct outputs |
| `18` | Output A |
| `19` | Output B |

### Key commands

```
< GET x CHAN_NAME >                  → channel name
< SET x CHAN_MUTE_A ON|OFF|TOGGLE >  → mute on mix A
< SET x CHAN_MUTE_B ON|OFF|TOGGLE >  → mute on mix B
< SET x INPUT_GAIN_HI_A nn >         → input gain (mix A)
< GET x AUDIO_GAIN_HI_RES >          → audio gain
< SET x ALWAYS_ON_ENABLE_A ON|OFF >  → force channel always open
< SET x INTELLIMIX_MODE ... >        → set Intellimix mode
< SET 0 METER_RATE sssss >           → start metering (ms interval); 0 = off
< REP x INPUT_AUDIO_GATE_A ON|OFF >  → gate open/closed status
< SAMPLE aaa bbb ccc ... >           → 19 level values, 000–120 each
```

**Important:** The device sends `REP` proactively when any parameter changes. You do not need to poll — subscribe once and react to incoming messages.

---

## Codebase structure

```
/
├── server/                  # Node.js backend
│   ├── index.js             # Entry point — starts HTTP + WebSocket server
│   ├── bridge.js            # TCP ↔ WebSocket bridge logic
│   ├── parser.js            # SCM820 message parser/serializer
│   └── mock.js              # Mock SCM820 device for local dev/testing
│
├── client/                  # React frontend
│   ├── src/
│   │   ├── hooks/
│   │   │   ├── useSCM820.js       # WebSocket connection + message dispatch
│   │   │   └── useMetering.js     # SAMPLE frame processing
│   │   ├── components/
│   │   │   ├── ChannelStrip.jsx   # Individual channel: fader, mute, gate LED
│   │   │   ├── MasterSection.jsx  # Output A/B controls
│   │   │   ├── VUMeter.jsx        # Canvas-based level meter
│   │   │   └── MixerLayout.jsx    # Top-level layout
│   │   ├── state/
│   │   │   └── mixerStore.js      # Central state (Zustand or useReducer)
│   │   └── App.jsx
│   └── index.html
│
└── CLAUDE.md
```

---

## Tech stack

| Layer | Tech |
|---|---|
| Backend | Node.js, `ws` (WebSocket server), built-in `net` (TCP) |
| Frontend | React, functional components + hooks |
| Styling | Tailwind CSS |
| State | Zustand (preferred) or `useReducer` for complex mixer state |
| Metering | Canvas API |
| Dev tooling | Vite (client), nodemon (server) |

---

## Coding conventions

### General

- **Functional style throughout** — use hooks, closures, and pure functions. No class components, no class-based services.
- Prefer `async/await` over `.then()` chains.
- Use named exports everywhere; avoid default exports except for top-level React components.
- Keep files focused and under ~200 lines. Split by responsibility, not by file size quota.
- No magic numbers — define constants for channel ranges, port numbers, message patterns, etc.

### Node.js (server)

- The TCP connection lives in `bridge.js`. Keep networking concerns out of `index.js`.
- `parser.js` handles all string encoding/decoding. No raw string manipulation outside this module.
- All TCP writes must go through a single `send(command)` function that validates the envelope format before writing.
- Emit typed events (e.g. `mixer.emit('rep', { channel, param, value })`) rather than passing raw strings between modules.
- Handle TCP reconnection gracefully — the device may reboot or drop the connection.

### React (client)

- `useSCM820` is the single source of truth for WebSocket state. Components never open their own connections.
- State updates from incoming `REP` messages should be batched at the store level, not scattered across component `useEffect` calls.
- `SAMPLE` frames arrive at up to 10Hz — use `requestAnimationFrame` in `useMetering` to throttle Canvas repaints. Never update React state on every meter frame.
- Channel strip components receive channel index + data as props and dispatch commands via a `useSend` hook. They do not know about WebSocket or TCP directly.
- Memoize channel strips (`React.memo`) — only the active channel's strip should re-render on meter updates.

### SCM820 message parsing

Parse incoming messages with a single regex against the known envelope format:

```js
// Expected format: < REP 1 CHAN_MUTE_A ON >
const REP_PATTERN = /^< REP (\d+) (\w+) (.+) >$/;
const SAMPLE_PATTERN = /^< SAMPLE ((?:\d{3} ?)+)>$/;
```

- Always validate before acting — malformed frames should be logged and discarded, not thrown.
- The parser should return structured objects, not raw strings:

```js
// { type: 'REP', channel: 1, param: 'CHAN_MUTE_A', value: 'ON' }
// { type: 'SAMPLE', levels: [45, 72, 0, ...] }
// { type: 'UNKNOWN', raw: '...' }
```

### Testing & debugging

- `mock.js` should implement the same TCP interface as a real SCM820 — it listens on a configurable port and responds to GET/SET with valid REP strings.
- Use the mock for all local development so you don't need physical hardware.
- Log all TCP frames in dev mode with direction prefix: `[→ SCM820]` and `[← SCM820]`.
- Add a `DEBUG=scm820:*` namespace using the `debug` package for togglable verbose logging.

---

## Environment variables

```
SCM820_HOST=192.168.1.x     # IP address of the SCM820 on the network
SCM820_PORT=2202            # Always 2202; configurable for mock testing
WS_PORT=8080                # WebSocket server port
USE_MOCK=false              # Set to true to use mock device
```

---

## Common tasks for Claude

- **Adding a new command:** define it in `parser.js` constants → expose a `send*` function in `useSCM820` → wire to a UI control in the relevant component.
- **Debugging a dropped connection:** check `bridge.js` reconnect logic and TCP error/close handlers.
- **Adding a new channel parameter:** update the state shape in `mixerStore.js`, the `REP` handler in `useSCM820`, and the relevant component prop.
- **Metering performance:** look at `useMetering` + `VUMeter` Canvas render loop before touching React state.
- **Testing without hardware:** set `USE_MOCK=true` and start `mock.js` — it simulates all GET/SET/SAMPLE responses.

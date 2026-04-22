import { useRef, useState, useEffect } from 'react';

const TRACK_HEIGHT = 140;
const CAP_HEIGHT = 16;
const TRACK_TRAVEL = TRACK_HEIGHT - CAP_HEIGHT;

// AUDIO_GAIN_HI_RES: 0000-1280 in 0.1 dB steps
// 1280 = 0 dB (unity/full level), lower = more attenuation
const GAIN_UNITY = 1280;

function rawToDb(raw) {
  if (raw <= 0) return -Infinity;
  return (raw - GAIN_UNITY) / 10;
}

function dbToRaw(db) {
  if (!isFinite(db)) return 0;
  return Math.max(0, Math.min(GAIN_UNITY, Math.round(db * 10 + GAIN_UNITY)));
}

// Piece-wise log scale: bottom = -∞, top = 0 dB (unity)
const STOPS = [
  { pos: 0.00, db: -Infinity, label: '-∞' },
  { pos: 0.07, db: -80,       label: '-80' },
  { pos: 0.20, db: -50,       label: '-50' },
  { pos: 0.38, db: -30,       label: '-30' },
  { pos: 0.55, db: -20,       label: '-20' },
  { pos: 0.70, db: -10,       label: '-10' },
  { pos: 0.83, db: -6,        label: '-6'  },
  { pos: 1.00, db: 0,         label: '0'   },
];

function posToDb(pos) {
  if (pos < STOPS[1].pos) return -Infinity;
  for (let i = 1; i < STOPS.length - 1; i++) {
    if (pos <= STOPS[i + 1].pos) {
      const a = STOPS[i], b = STOPS[i + 1];
      const t = (pos - a.pos) / (b.pos - a.pos);
      return a.db + t * (b.db - a.db);
    }
  }
  return STOPS[STOPS.length - 1].db;
}

function dbToPos(db) {
  if (!isFinite(db)) return STOPS[0].pos;
  if (db <= STOPS[1].db) return STOPS[1].pos;
  for (let i = 1; i < STOPS.length - 1; i++) {
    if (db <= STOPS[i + 1].db) {
      const a = STOPS[i], b = STOPS[i + 1];
      const t = (db - a.db) / (b.db - a.db);
      return a.pos + t * (b.pos - a.pos);
    }
  }
  return STOPS[STOPS.length - 1].pos;
}

// value prop is raw 0-1280 device integer; onChange(rawInt) sends back to device
export function Fader({ value, onChange }) {
  const [localDb, setLocalDb] = useState(rawToDb(value ?? GAIN_UNITY));
  const containerRef = useRef(null);
  const isDragging = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!isDragging.current) setLocalDb(rawToDb(value ?? GAIN_UNITY));
  }, [value]);

  function computeDb(clientY) {
    const rect = containerRef.current.getBoundingClientRect();
    const fromBottom = rect.bottom - clientY - CAP_HEIGHT / 2;
    const pos = Math.max(0, Math.min(1, fromBottom / TRACK_TRAVEL));
    return posToDb(pos);
  }

  function handlePointerDown(e) {
    e.preventDefault();
    isDragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const db = computeDb(e.clientY);
    setLocalDb(db);
    onChangeRef.current(dbToRaw(db));
  }

  function handlePointerMove(e) {
    if (!isDragging.current) return;
    const db = computeDb(e.clientY);
    setLocalDb(db);
    onChangeRef.current(dbToRaw(db));
  }

  function handlePointerUp() {
    isDragging.current = false;
  }

  const capPos = dbToPos(localDb);
  const capBottomPx = Math.round(capPos * TRACK_TRAVEL);

  const displayLabel = !isFinite(localDb)
    ? '-∞'
    : `${Math.round(localDb)} dB`;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex" style={{ height: `${TRACK_HEIGHT}px` }}>
        {/* Interactive fader column */}
        <div
          ref={containerRef}
          className="relative cursor-ns-resize select-none touch-none"
          style={{ width: '36px', height: '100%' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {/* Track groove */}
          <div
            className="absolute rounded-full bg-zinc-950 border border-zinc-700"
            style={{ width: '6px', top: 0, bottom: 0, left: '50%', transform: 'translateX(-50%)' }}
          />

          {/* 0 dB reference tick at top */}
          <div
            className="absolute bg-blue-500"
            style={{
              width: '12px',
              height: '1px',
              bottom: `${Math.round(STOPS[STOPS.length - 1].pos * TRACK_TRAVEL + CAP_HEIGHT / 2)}px`,
              left: '50%',
              transform: 'translateX(-50%)',
            }}
          />

          {/* Fader cap */}
          <div
            className="absolute rounded bg-zinc-200 border border-zinc-400 shadow-md"
            style={{
              width: '28px',
              height: `${CAP_HEIGHT}px`,
              bottom: `${capBottomPx}px`,
              left: '50%',
              transform: 'translateX(-50%)',
            }}
          >
            <div
              className="absolute inset-x-2 bg-zinc-500"
              style={{ height: '1px', top: '50%', transform: 'translateY(-50%)' }}
            />
          </div>
        </div>

        {/* dB scale marks */}
        <div className="relative" style={{ width: '26px', height: '100%' }}>
          {STOPS.map((stop) => {
            const bottomPx = stop.pos * TRACK_TRAVEL + CAP_HEIGHT / 2;
            return (
              <div
                key={stop.label}
                className="absolute flex items-center"
                style={{ bottom: `${bottomPx}px`, left: 0, transform: 'translateY(50%)' }}
              >
                <div className="w-1.5 h-px bg-zinc-600 shrink-0" />
                <span className="text-[9px] text-zinc-500 font-mono ml-0.5 leading-none whitespace-nowrap">
                  {stop.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Current dB readout */}
      <div className="text-[10px] text-zinc-400 font-mono">{displayLabel}</div>
    </div>
  );
}

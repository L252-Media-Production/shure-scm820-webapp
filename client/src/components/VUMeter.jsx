import { useMetering } from '../hooks/useMetering.js';

const MAX_LEVEL = 120;
const SEGMENTS = 20;

function drawMeter(canvas, level) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const filled = Math.round(Math.min(level / MAX_LEVEL, 1) * SEGMENTS);
  const segH = Math.floor(h / SEGMENTS) - 1;

  for (let i = 0; i < SEGMENTS; i++) {
    const normalized = i / SEGMENTS;
    const active = i < filled;
    if (normalized >= 0.8) {
      ctx.fillStyle = active ? '#ef4444' : '#3f1212';
    } else if (normalized >= 0.65) {
      ctx.fillStyle = active ? '#eab308' : '#3f3000';
    } else {
      ctx.fillStyle = active ? '#22c55e' : '#052e16';
    }
    const y = h - (i + 1) * (segH + 1);
    ctx.fillRect(0, y, w, segH);
  }
}

export function VUMeter({ levelIndex, meterLevelsRef }) {
  const canvasRef = useMetering(levelIndex, meterLevelsRef, drawMeter);
  return (
    <canvas
      ref={canvasRef}
      width={16}
      height={120}
      className="rounded-sm"
      aria-label="level meter"
    />
  );
}

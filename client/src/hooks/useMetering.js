import { useEffect, useRef } from 'react';

export function useMetering(levelIndex, meterLevelsRef, drawFn) {
  const canvasRef = useRef(null);
  const drawFnRef = useRef(drawFn);
  drawFnRef.current = drawFn;

  useEffect(() => {
    let rafId;

    function tick() {
      const canvas = canvasRef.current;
      if (canvas) {
        const level = (meterLevelsRef.current ?? [])[levelIndex] ?? 0;
        drawFnRef.current(canvas, level);
      }
      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [levelIndex, meterLevelsRef]);

  return canvasRef;
}

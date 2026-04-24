import { useState, useEffect, useRef } from 'react';

const POLL_MS = 250;

function fmtTime(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function fmtChannel(ch) {
  if (ch == null || ch === 0) return 'ALL';
  if (ch >= 1 && ch <= 8)    return `IN${ch}`;
  if (ch === 9)               return 'AUX';
  if (ch >= 10 && ch <= 17)  return `D${ch - 9}`;
  if (ch === 18)              return 'OA';
  if (ch === 19)              return 'OB';
  return `CH${ch}`;
}

export function DebugDrawer({ debugLogRef }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState([]);
  const logLenAtClose = useRef(0);

  useEffect(() => {
    if (!open) {
      logLenAtClose.current = debugLogRef.current.length;
      return;
    }
    const snapshot = () => setEntries([...debugLogRef.current]);
    snapshot();
    const id = setInterval(snapshot, POLL_MS);
    return () => clearInterval(id);
  }, [open, debugLogRef]);

  const unread = open ? 0 : Math.max(0, debugLogRef.current.length - logLenAtClose.current);

  function clearLog() {
    debugLogRef.current = [];
    setEntries([]);
    logLenAtClose.current = 0;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 select-none">
      {open && (
        <div className="bg-zinc-950 border-t border-zinc-700 flex flex-col" style={{ height: '260px' }}>
          <div className="flex-1 overflow-y-auto p-2 space-y-px">
            {entries.length === 0 ? (
              <div className="text-zinc-600 font-mono text-[11px] p-1">No audio commands yet.</div>
            ) : (
              entries.map((e, i) => (
                <div key={i} className="flex gap-2 font-mono text-[11px] leading-relaxed hover:bg-zinc-900 px-1 rounded">
                  <span className="text-zinc-600 shrink-0 tabular-nums">{fmtTime(e.ts)}</span>
                  <span className={`shrink-0 font-bold w-4 ${e.dir === '→' ? 'text-cyan-400' : 'text-green-400'}`}>
                    {e.dir}
                  </span>
                  <span className="text-zinc-500 shrink-0 w-8 text-right">{fmtChannel(e.channel)}</span>
                  <span className="text-zinc-200 shrink-0 w-44">{e.param}</span>
                  <span className="text-amber-300 truncate">{e.value}</span>
                </div>
              ))
            )}
          </div>
          <div className="flex justify-end px-3 py-1 border-t border-zinc-800">
            <button
              onClick={clearLog}
              className="text-[10px] text-zinc-500 hover:text-red-400 transition-colors font-mono"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-1.5 bg-zinc-900 border-t border-zinc-700 hover:bg-zinc-800 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
          <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">Debug Console</span>
          {!open && unread > 0 && (
            <span className="text-[9px] bg-blue-700 text-blue-200 px-1.5 py-px rounded-full font-bold tabular-nums">
              +{unread}
            </span>
          )}
        </div>
        <span className="text-zinc-600 text-[10px]">{open ? '▼' : '▲'}</span>
      </button>
    </div>
  );
}

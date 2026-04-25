import { useState, useEffect, useRef } from 'react';

const POLL_MS = 250;
const USE_12H = import.meta.env.VITE_TIME_FORMAT === '12h';

function fmtTime(ts) {
  const d = new Date(ts);
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  if (USE_12H) {
    let hh = d.getHours();
    const period = hh >= 12 ? 'PM' : 'AM';
    hh = hh % 12 || 12;
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}.${ms} ${period}`;
  }
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
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

const CHANNEL_OPTIONS = [
  { label: 'ALL (0)', value: 0 },
  ...Array.from({ length: 8 }, (_, i) => ({ label: `IN${i + 1} (${i + 1})`, value: i + 1 })),
  { label: 'AUX (9)', value: 9 },
  ...Array.from({ length: 8 }, (_, i) => ({ label: `D${i + 1} (${i + 10})`, value: i + 10 })),
  { label: 'Out A (18)', value: 18 },
  { label: 'Out B (19)', value: 19 },
];

function LogTab({ entries, onClear }) {
  return (
    <>
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
          onClick={onClear}
          className="text-[10px] text-zinc-500 hover:text-red-400 transition-colors font-mono"
        >
          Clear
        </button>
      </div>
    </>
  );
}

function CommandsTab({ debugLogRef, sendTestCommand }) {
  const [cmdType, setCmdType] = useState('GET');
  const [channel, setChannel] = useState(1);
  const [param, setParam] = useState('');
  const [value, setValue] = useState('');
  const [response, setResponse] = useState(null);
  const [waiting, setWaiting] = useState(false);
  const waitRef = useRef(null);

  function sendCommand() {
    const ch = Number(channel);
    const p = param.trim().toUpperCase();
    if (!p) return;
    if (cmdType === 'SET' && !value.trim()) return;

    setResponse(null);
    setWaiting(true);

    const logLenBefore = debugLogRef.current.length;
    sendTestCommand(cmdType, ch, p, value.trim());

    // Poll for the matching REP response
    let attempts = 0;
    clearInterval(waitRef.current);
    waitRef.current = setInterval(() => {
      attempts++;
      // Search from the front (newest first) up to where we were before sending
      const log = debugLogRef.current;
      const found = log.slice(0, log.length - logLenBefore).find(
        (e) => e.dir === '←' && e.channel === ch && e.param === p
      );
      if (found) {
        clearInterval(waitRef.current);
        setWaiting(false);
        setResponse(found);
      } else if (attempts > 40) {
        // 10s timeout
        clearInterval(waitRef.current);
        setWaiting(false);
        setResponse({ timeout: true });
      }
    }, 250);
  }

  useEffect(() => () => clearInterval(waitRef.current), []);

  return (
    <div className="flex flex-col gap-3 p-3 flex-1 overflow-y-auto">
      <div className="flex gap-2 items-end flex-wrap">
        {/* GET / SET toggle */}
        <div className="flex flex-col gap-1">
          <label className="text-[9px] text-zinc-500 font-mono uppercase tracking-wider">Type</label>
          <div className="flex rounded overflow-hidden border border-zinc-700">
            {['GET', 'SET'].map((t) => (
              <button
                key={t}
                onClick={() => setCmdType(t)}
                className={`px-3 py-1 font-mono text-[11px] transition-colors ${
                  cmdType === t
                    ? 'bg-cyan-700 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Channel select */}
        <div className="flex flex-col gap-1">
          <label className="text-[9px] text-zinc-500 font-mono uppercase tracking-wider">Channel</label>
          <select
            value={channel}
            onChange={(e) => setChannel(Number(e.target.value))}
            className="bg-zinc-800 border border-zinc-700 text-zinc-200 font-mono text-[11px] rounded px-2 py-1 focus:outline-none focus:border-cyan-600"
          >
            {CHANNEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Param input */}
        <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
          <label className="text-[9px] text-zinc-500 font-mono uppercase tracking-wider">Parameter</label>
          <input
            type="text"
            value={param}
            onChange={(e) => setParam(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendCommand()}
            placeholder="e.g. CHAN_NAME"
            className="bg-zinc-800 border border-zinc-700 text-zinc-200 font-mono text-[11px] rounded px-2 py-1 focus:outline-none focus:border-cyan-600 placeholder-zinc-600"
          />
        </div>

        {/* Value input (SET only) */}
        {cmdType === 'SET' && (
          <div className="flex flex-col gap-1 flex-1 min-w-[100px]">
            <label className="text-[9px] text-zinc-500 font-mono uppercase tracking-wider">Value</label>
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendCommand()}
              placeholder="e.g. ON"
              className="bg-zinc-800 border border-zinc-700 text-zinc-200 font-mono text-[11px] rounded px-2 py-1 focus:outline-none focus:border-cyan-600 placeholder-zinc-600"
            />
          </div>
        )}

        <button
          onClick={sendCommand}
          disabled={waiting || !param.trim()}
          className="px-4 py-1 bg-cyan-700 hover:bg-cyan-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-mono text-[11px] rounded transition-colors self-end"
        >
          {waiting ? 'Waiting…' : 'Send'}
        </button>
      </div>

      {/* Preview of the command that will be sent */}
      {param.trim() && (
        <div className="font-mono text-[11px] text-zinc-500 bg-zinc-900 rounded px-2 py-1 border border-zinc-800">
          {'< '}
          <span className="text-cyan-400">{cmdType}</span>
          {' '}
          <span className="text-zinc-300">{channel}</span>
          {' '}
          <span className="text-zinc-200">{param.trim().toUpperCase()}</span>
          {cmdType === 'SET' && value.trim() && (
            <> <span className="text-amber-300">{value.trim()}</span></>
          )}
          {' >'}
        </div>
      )}

      {/* Response */}
      {response && (
        <div className={`font-mono text-[11px] rounded px-2 py-2 border ${
          response.timeout
            ? 'bg-zinc-900 border-zinc-700 text-zinc-500'
            : 'bg-zinc-900 border-green-800'
        }`}>
          {response.timeout ? (
            <span className="text-zinc-500">No response received (timeout)</span>
          ) : (
            <div className="flex gap-2">
              <span className="text-zinc-600 tabular-nums shrink-0">{fmtTime(response.ts)}</span>
              <span className="text-green-400 font-bold shrink-0">←</span>
              <span className="text-zinc-500 shrink-0 w-8 text-right">{fmtChannel(response.channel)}</span>
              <span className="text-zinc-200 shrink-0 w-44">{response.param}</span>
              <span className="text-amber-300">{response.value}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DebugDrawer({ debugLogRef, sendTestCommand }) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('log');
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
          {/* Tab bar */}
          <div className="flex border-b border-zinc-800 shrink-0">
            {[
              { id: 'log', label: 'Log' },
              { id: 'commands', label: 'Commands' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors border-b-2 ${
                  activeTab === tab.id
                    ? 'border-cyan-500 text-cyan-400'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {tab.label}
                {tab.id === 'log' && unread === 0 && entries.length > 0 && (
                  <span className="ml-1.5 text-zinc-600 tabular-nums">({entries.length})</span>
                )}
              </button>
            ))}
          </div>

          {activeTab === 'log' ? (
            <LogTab entries={entries} onClear={clearLog} />
          ) : (
            <CommandsTab debugLogRef={debugLogRef} sendTestCommand={sendTestCommand} />
          )}
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

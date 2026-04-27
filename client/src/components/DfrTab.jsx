import { useMixerStore } from '../state/mixerStore.js';

const DFR_CHANNELS = [
  { value: '001', ch: 1 }, { value: '002', ch: 2 }, { value: '003', ch: 3 },
  { value: '004', ch: 4 }, { value: '005', ch: 5 }, { value: '006', ch: 6 },
  { value: '007', ch: 7 }, { value: '008', ch: 8 },
  { value: '018', ch: 18 }, { value: '019', ch: 19 },
];

function chanLabel(chEntry, channels) {
  const { value, ch } = chEntry;
  if (ch >= 1 && ch <= 8) return `${value} — ${channels[ch]?.name || `Ch ${ch}`}`;
  if (ch === 18)           return `${value} — ${channels[18]?.name || 'Mix A'}`;
  if (ch === 19)           return `${value} — ${channels[19]?.name || 'Mix B'}`;
  return value;
}

function DfrSection({ num, bypass, assignedChan, freeze, channels, sendSet }) {
  const prefix = `DFR${num}`;
  const isBypassed = bypass === 'ON';
  const isFrozen   = freeze === 'ON';

  function toggle(param, current) {
    sendSet(null, param, current === 'ON' ? 'OFF' : 'ON');
  }

  return (
    <div className="flex flex-col gap-3 p-4 bg-zinc-800 rounded-xl border border-zinc-700 shadow w-72">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-zinc-200">DFR {num}</span>
        <button
          onClick={() => toggle(`${prefix}_BYPASS`, bypass)}
          className={`px-3 py-1 text-xs rounded font-bold tracking-wider transition-colors ${
            isBypassed
              ? 'bg-amber-500 text-black shadow-[0_0_6px_#f59e0b]'
              : 'bg-green-700 text-white shadow-[0_0_6px_#16a34a]'
          }`}
        >
          {isBypassed ? 'BYPASSED' : 'ENABLED'}
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">Assigned Channel</label>
        <select
          value={assignedChan ?? '020'}
          onChange={(e) => sendSet(null, `${prefix}_ASSIGNED_CHAN`, e.target.value)}
          className="bg-zinc-700 text-zinc-200 text-xs rounded px-2 py-1.5 border border-zinc-600 cursor-pointer"
        >
          <option value="020">—— None ——</option>
          {DFR_CHANNELS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {chanLabel(entry, channels)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => toggle(`${prefix}_FREEZE`, freeze)}
          className={`px-3 py-1 text-xs rounded font-bold tracking-wider transition-colors ${
            isFrozen
              ? 'bg-blue-600 text-white shadow-[0_0_6px_#2563eb]'
              : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
          }`}
        >
          {isFrozen ? 'FROZEN' : 'FREEZE'}
        </button>

        <button
          onClick={() => sendSet(null, `${prefix}_CLEAR_ALL_FILTERS`, 'ON')}
          className="px-3 py-1 text-xs rounded font-bold tracking-wider bg-zinc-700 text-zinc-400 hover:bg-red-800 hover:text-white transition-colors"
        >
          Clear All Filters
        </button>
      </div>
    </div>
  );
}

export function DfrTab({ sendSet }) {
  const deviceInfo = useMixerStore((s) => s.deviceInfo);
  const channels   = useMixerStore((s) => s.channels);

  return (
    <div className="flex flex-col gap-6 p-4 overflow-auto">
      <div className="flex flex-wrap gap-4">
        <DfrSection
          num={1}
          bypass={deviceInfo.dfr1Bypass}
          assignedChan={deviceInfo.dfr1AssignedChan}
          freeze={deviceInfo.dfr1Freeze}
          channels={channels}
          sendSet={sendSet}
        />
        <DfrSection
          num={2}
          bypass={deviceInfo.dfr2Bypass}
          assignedChan={deviceInfo.dfr2AssignedChan}
          freeze={deviceInfo.dfr2Freeze}
          channels={channels}
          sendSet={sendSet}
        />
      </div>

      <p className="text-[10px] text-zinc-600 font-mono max-w-md">
        DFR (Digital Feedback Reduction) adaptively filters feedback frequencies.
        Assign each DFR to the channel output it should monitor. Freeze locks current
        filters in place; Bypass disables filtering entirely without clearing filters.
      </p>
    </div>
  );
}

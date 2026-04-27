import { useState } from 'react';
import { ChannelStrip } from './ChannelStrip.jsx';
import { MasterSection } from './MasterSection.jsx';
import { OutputTab } from './OutputTab.jsx';
import { IntelliMixTab } from './IntelliMixTab.jsx';
import { DfrTab } from './DfrTab.jsx';
import { useMixerStore } from '../state/mixerStore.js';

const INPUT_CHANNELS = [1, 2, 3, 4, 5, 6, 7, 8];
const AUX_CHANNEL = 9;

const DEFAULT_TABS = [
  { id: 'inputs',     label: 'Inputs'    },
  { id: 'outputs',    label: 'Outputs'   },
  { id: 'intellimix', label: 'IntelliMix'},
  { id: 'dfr',        label: 'DFR'       },
];

function loadTabOrder() {
  try {
    const stored = sessionStorage.getItem('tabOrder');
    if (stored) {
      const ids = JSON.parse(stored);
      const byId = Object.fromEntries(DEFAULT_TABS.map((t) => [t.id, t]));
      const ordered = ids.filter((id) => byId[id]).map((id) => byId[id]);
      const missing = DEFAULT_TABS.filter((t) => !ids.includes(t.id));
      return [...ordered, ...missing];
    }
  } catch {}
  return DEFAULT_TABS;
}

function saveTabOrder(tabs) {
  try {
    sessionStorage.setItem('tabOrder', JSON.stringify(tabs.map((t) => t.id)));
  } catch {}
}

function ComingSoon({ label }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-3 py-20 text-zinc-600">
      <div className="text-4xl">🚧</div>
      <div className="text-lg font-bold text-zinc-500">{label}</div>
      <div className="text-sm font-mono">Coming Soon!</div>
    </div>
  );
}

export function MixerLayout({ sendSet, meterLevelsRef }) {
  const channels = useMixerStore((s) => s.channels);
  const [tabs, setTabs] = useState(loadTabOrder);
  const [activeTab, setActiveTab] = useState(() => loadTabOrder()[0].id);
  const [editing, setEditing] = useState(false);

  function move(index, dir) {
    const next = [...tabs];
    const to = index + dir;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    setTabs(next);
    saveTabOrder(next);
  }

  return (
    <div className="flex flex-col flex-1">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 pt-3 border-b border-zinc-700">
        {tabs.map((tab, i) =>
          editing ? (
            <div key={tab.id} className="flex items-center gap-0.5 px-2 py-1 bg-zinc-700 rounded-t text-xs text-zinc-300 font-bold">
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="text-zinc-500 hover:text-zinc-200 disabled:opacity-20 text-[10px] px-0.5"
              >‹</button>
              <span className="px-1">{tab.label}</span>
              <button
                onClick={() => move(i, 1)}
                disabled={i === tabs.length - 1}
                className="text-zinc-500 hover:text-zinc-200 disabled:opacity-20 text-[10px] px-0.5"
              >›</button>
            </div>
          ) : (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-1.5 text-xs font-bold rounded-t-lg transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? 'text-zinc-100 border-blue-500 bg-zinc-800'
                  : 'text-zinc-500 border-transparent hover:text-zinc-300'
              }`}
            >
              {tab.label}
            </button>
          )
        )}

        <button
          onClick={() => setEditing((v) => !v)}
          className={`ml-auto px-2 py-0.5 text-[9px] font-bold rounded transition-colors ${
            editing
              ? 'bg-blue-600 text-white'
              : 'text-zinc-600 hover:text-zinc-300'
          }`}
        >
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>

      {/* Tab content */}
      {!editing && activeTab === 'inputs' && (
        <div className="flex items-start gap-3 p-4 overflow-x-auto">
          {INPUT_CHANNELS.map((ch) => (
            <ChannelStrip
              key={ch}
              channelIndex={ch}
              data={channels[ch]}
              sendSet={sendSet}
              meterLevelsRef={meterLevelsRef}
            />
          ))}
          <ChannelStrip
            key={AUX_CHANNEL}
            channelIndex={AUX_CHANNEL}
            data={channels[AUX_CHANNEL]}
            sendSet={sendSet}
            meterLevelsRef={meterLevelsRef}
            isAux
          />
          <div className="self-center h-48 w-px bg-zinc-600 mx-1" />
          <MasterSection sendSet={sendSet} meterLevelsRef={meterLevelsRef} />
        </div>
      )}

      {!editing && activeTab === 'outputs' && (
        <OutputTab sendSet={sendSet} meterLevelsRef={meterLevelsRef} />
      )}

      {!editing && activeTab === 'intellimix' && (
        <IntelliMixTab sendSet={sendSet} />
      )}

      {!editing && activeTab === 'dfr' && (
        <DfrTab sendSet={sendSet} />
      )}

      {editing && (
        <div className="flex items-center justify-center flex-1 text-zinc-600 text-sm font-mono py-16">
          Use ‹ › to reorder tabs. Order resets when you close the browser.
        </div>
      )}
    </div>
  );
}

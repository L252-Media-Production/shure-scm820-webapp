import { useState } from 'react';
import { ChannelStrip } from './ChannelStrip.jsx';
import { MasterSection } from './MasterSection.jsx';
import { OutputTab } from './OutputTab.jsx';
import { useMixerStore } from '../state/mixerStore.js';

const INPUT_CHANNELS = [1, 2, 3, 4, 5, 6, 7, 8];

const TABS = [
  { id: 'inputs', label: 'Inputs' },
  { id: 'outputs', label: 'Outputs' },
];

export function MixerLayout({ sendSet, meterLevelsRef }) {
  const channels = useMixerStore((s) => s.channels);
  const [activeTab, setActiveTab] = useState('inputs');

  return (
    <div className="flex flex-col flex-1">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 pt-3 border-b border-zinc-700">
        {TABS.map((tab) => (
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
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'inputs' && (
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
          <div className="self-center h-48 w-px bg-zinc-600 mx-1" />
          <MasterSection sendSet={sendSet} meterLevelsRef={meterLevelsRef} />
        </div>
      )}

      {activeTab === 'outputs' && (
        <OutputTab sendSet={sendSet} meterLevelsRef={meterLevelsRef} />
      )}
    </div>
  );
}

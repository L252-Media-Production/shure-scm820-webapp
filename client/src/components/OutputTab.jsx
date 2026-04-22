import { useMixerStore } from '../state/mixerStore.js';
import { VUMeter } from './VUMeter.jsx';

const MIX_OUTPUTS = [
  { channel: 18, label: 'Mix A', levelIndex: 17 },
  { channel: 19, label: 'Mix B', levelIndex: 18 },
];

const DIRECT_OUTPUTS = Array.from({ length: 8 }, (_, i) => ({
  channel: 10 + i,
  label: `DO ${i + 1}`,
  levelIndex: 9 + i,
}));

export function OutputTab({ sendSet, meterLevelsRef }) {
  const channels = useMixerStore((s) => s.channels);

  return (
    <div className="flex flex-col gap-6 p-4">

      {/* Mix bus outputs */}
      <div>
        <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-3 font-bold">Mix Outputs</div>
        <div className="flex gap-4">
          {MIX_OUTPUTS.map(({ channel, label, levelIndex }) => {
            const data = channels[channel] ?? {};
            const isMuted = data.muteA || data.muteB;
            return (
              <div
                key={channel}
                className="flex flex-col items-center gap-2 p-3 bg-zinc-800 rounded-xl border border-zinc-700 shadow w-[80px]"
              >
                <div className="text-[11px] text-zinc-300 font-bold">{label}</div>
                <VUMeter levelIndex={levelIndex} meterLevelsRef={meterLevelsRef} />
                <button
                  onClick={() => {
                    sendSet(channel, 'CHAN_MUTE_A', 'TOGGLE');
                    sendSet(channel, 'CHAN_MUTE_B', 'TOGGLE');
                  }}
                  className={`w-full py-1.5 text-[10px] rounded font-bold tracking-wider transition-colors ${
                    isMuted
                      ? 'bg-red-600 text-white shadow-[0_0_8px_#dc2626]'
                      : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                  }`}
                >
                  {isMuted ? 'MUTED' : 'MUTE'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Direct outputs */}
      <div>
        <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-3 font-bold">
          Direct Outputs
        </div>
        <div className="flex flex-wrap gap-3">
          {DIRECT_OUTPUTS.map(({ channel, label, levelIndex }) => {
            const data = channels[channel] ?? {};
            const isMuted = data.muteA || data.muteB;
            return (
              <div
                key={channel}
                className="flex flex-col items-center gap-2 p-2 bg-zinc-800 rounded-lg border border-zinc-700 shadow w-[64px]"
              >
                <div className="text-[10px] text-zinc-400 font-mono">{label}</div>
                <VUMeter levelIndex={levelIndex} meterLevelsRef={meterLevelsRef} />
                <button
                  onClick={() => {
                    sendSet(channel, 'CHAN_MUTE_A', 'TOGGLE');
                    sendSet(channel, 'CHAN_MUTE_B', 'TOGGLE');
                  }}
                  className={`w-full py-1 text-[9px] rounded font-bold transition-colors ${
                    isMuted
                      ? 'bg-red-600 text-white'
                      : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'
                  }`}
                >
                  {isMuted ? 'MUTED' : 'MUTE'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-[10px] text-zinc-600 italic">
        Direct outputs route individual input channels. Mute state applies to both mix buses.
      </p>
    </div>
  );
}

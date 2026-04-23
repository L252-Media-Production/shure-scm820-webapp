import { useMixerStore } from '../state/mixerStore.js';
import { VUMeter } from './VUMeter.jsx';
import { Fader } from './Fader.jsx';

// SAMPLE frame: indices 0-7 = ch1-8, 8 = aux, 9-16 = direct outs, 17 = out A, 18 = out B
const OUTPUT_A_INDEX = 17;
const OUTPUT_B_INDEX = 18;
const MIX_A_CH = 18;
const MIX_B_CH = 19;

export function MasterSection({ sendSet, meterLevelsRef }) {
  const channels = useMixerStore((s) => s.channels);
  const mixA = channels[MIX_A_CH] ?? {};
  const mixB = channels[MIX_B_CH] ?? {};

  // Muted if either output is muted
  const isMuted = !!(mixA.mute || mixB.mute);

  function handleMute() {
    const next = isMuted ? 'OFF' : 'ON';
    sendSet(MIX_A_CH, 'AUDIO_MUTE', next);
    sendSet(MIX_B_CH, 'AUDIO_MUTE', next);
  }

  function handleGain(raw) {
    const val = String(raw).padStart(4, '0');
    sendSet(MIX_A_CH, 'AUDIO_GAIN_HI_RES', val);
    sendSet(MIX_B_CH, 'AUDIO_GAIN_HI_RES', val);
  }

  return (
    <div className="flex flex-col items-center gap-3 p-4 bg-zinc-800 rounded-xl border border-zinc-600 shadow-lg ml-2">
      <div className="text-[11px] text-zinc-400 text-center font-bold tracking-widest uppercase">
        Master
      </div>

      {/* Master fader + meters */}
      <div className="flex items-start gap-2">
        <Fader value={mixA.gain} onChange={handleGain} />
        <div className="flex gap-2">
          <div className="flex flex-col items-center gap-1">
            <VUMeter levelIndex={OUTPUT_A_INDEX} meterLevelsRef={meterLevelsRef} />
            <span className="text-[10px] text-zinc-400 font-semibold">OUT A</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <VUMeter levelIndex={OUTPUT_B_INDEX} meterLevelsRef={meterLevelsRef} />
            <span className="text-[10px] text-zinc-400 font-semibold">OUT B</span>
          </div>
        </div>
      </div>

      {/* Master mute */}
      <button
        onClick={handleMute}
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
}

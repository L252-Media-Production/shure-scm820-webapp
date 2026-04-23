import { useMixerStore } from '../state/mixerStore.js';
import { VUMeter } from './VUMeter.jsx';
import { Fader } from './Fader.jsx';

// SAMPLE frame: indices 0-7 = ch1-8, 8 = aux, 9-16 = direct outs, 17 = out A, 18 = out B
const DIRECT_OUTPUTS = Array.from({ length: 8 }, (_, i) => ({
  channel: 10 + i,
  label: `DO ${i + 1}`,
  levelIndex: 9 + i,
}));

// Aux channel direct-out meter (level index 8 in SAMPLE frame, no configurable source)
const AUX_DIRECT_OUT = { label: 'AUX', levelIndex: 8 };

const MIX_OUTPUTS = [
  { channel: 18, label: 'Mix A', levelIndex: 17 },
  { channel: 19, label: 'Mix B', levelIndex: 18 },
];

const DIRECT_OUT_SOURCE_OPTIONS = [
  { value: 'PRE_EQ',          label: 'Pre EQ'    },
  { value: 'POST_EQ',         label: 'Post EQ'   },
  { value: 'POST_FADER',      label: 'Post Fdr'  },
  { value: 'INTELLIMIX',      label: 'IntelliMix' },
  { value: 'INTELLIMIX_NOMA', label: 'IMIX NOMA' },
];

const AUDIO_OUT_LVL_OPTIONS = [
  { value: 'LINE_LVL', label: 'LN'  },
  { value: 'AUX_LVL',  label: 'AUX' },
  { value: 'MIC_LVL',  label: 'MIC' },
];

export function OutputTab({ sendSet, meterLevelsRef }) {
  const channels = useMixerStore((s) => s.channels);

  return (
    <div className="flex flex-wrap items-start gap-3 p-4 overflow-x-auto">

      {/* Direct Outputs — with source selector */}
      {DIRECT_OUTPUTS.map(({ channel, label, levelIndex }) => {
        const data = channels[channel] ?? {};
        return (
          <div
            key={channel}
            className="flex flex-col items-center gap-1.5 p-2 bg-zinc-800 rounded-lg border border-zinc-700 shadow w-[72px]"
          >
            <div className="text-[10px] text-zinc-400 font-mono font-bold">{label}</div>
            <select
              value={data.directOutSource ?? 'POST_FADER'}
              onChange={(e) => sendSet(channel, 'DIRECT_OUT_SOURCE', e.target.value)}
              className="w-full text-[8px] bg-zinc-700 text-zinc-300 rounded p-0.5 border border-zinc-600 cursor-pointer"
            >
              {DIRECT_OUT_SOURCE_OPTIONS.map(({ value, label: optLabel }) => (
                <option key={value} value={value}>{optLabel}</option>
              ))}
            </select>
            <VUMeter levelIndex={levelIndex} meterLevelsRef={meterLevelsRef} />
          </div>
        );
      })}

      {/* Aux direct-out level meter (no configurable source) */}
      <div className="flex flex-col items-center gap-1.5 p-2 bg-zinc-800 rounded-lg border border-zinc-700 shadow w-[72px]">
        <div className="text-[10px] text-zinc-400 font-mono font-bold">{AUX_DIRECT_OUT.label}</div>
        <VUMeter levelIndex={AUX_DIRECT_OUT.levelIndex} meterLevelsRef={meterLevelsRef} />
      </div>

      {/* Divider between direct and mix outputs */}
      <div className="self-stretch w-px bg-zinc-700 mx-1" />

      {/* Mix Outputs — with fader, level switch, and mute */}
      {MIX_OUTPUTS.map(({ channel, label, levelIndex }) => {
        const data = channels[channel] ?? {};
        const isMuted = !!data.mute;
        return (
          <div
            key={channel}
            className="flex flex-col items-center gap-2 px-2 py-3 bg-zinc-800 rounded-xl border border-zinc-700 shadow w-[104px]"
          >
            {/* Label + Mute */}
            <div className="flex items-center justify-between w-full">
              <span className="text-[11px] text-zinc-300 font-bold">{label}</span>
              <button
                onClick={() => sendSet(channel, 'AUDIO_MUTE', isMuted ? 'OFF' : 'ON')}
                className={`px-1.5 py-0.5 text-[9px] rounded font-bold tracking-wider transition-colors ${
                  isMuted
                    ? 'bg-red-600 text-white shadow-[0_0_6px_#dc2626]'
                    : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                }`}
              >
                {isMuted ? 'MUTED' : 'MUTE'}
              </button>
            </div>

            {/* Fader + VU Meter side by side */}
            <div className="flex items-start gap-1">
              <Fader
                value={data.gain}
                onChange={(raw) => sendSet(channel, 'AUDIO_GAIN_HI_RES', String(raw).padStart(4, '0'))}
              />
              <VUMeter levelIndex={levelIndex} meterLevelsRef={meterLevelsRef} height={140} />
            </div>

            {/* Output level switch */}
            <div className="flex w-full gap-0.5">
              {AUDIO_OUT_LVL_OPTIONS.map(({ value, label: optLabel }) => (
                <button
                  key={value}
                  onClick={() => sendSet(channel, 'AUDIO_OUT_LVL_SWITCH', value)}
                  className={`flex-1 py-0.5 text-[8px] rounded font-bold transition-colors ${
                    data.audioOutLvlSwitch === value
                      ? 'bg-teal-700 text-white'
                      : 'bg-zinc-700 text-zinc-500 hover:bg-zinc-600'
                  }`}
                >
                  {optLabel}
                </button>
              ))}
            </div>

            {/* Channel number badge */}
            <div className="text-[10px] text-zinc-600 font-mono">{String(channel).padStart(2, '0')}</div>
          </div>
        );
      })}

    </div>
  );
}

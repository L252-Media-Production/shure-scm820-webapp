import { VUMeter } from './VUMeter.jsx';

// SAMPLE frame: indices 0-7 = ch1-8, 8 = aux, 9-16 = direct outs, 17 = out A, 18 = out B
const OUTPUT_A_INDEX = 17;
const OUTPUT_B_INDEX = 18;

export function MasterSection({ meterLevelsRef }) {
  return (
    <div className="flex flex-col gap-3 p-4 bg-zinc-800 rounded-xl border border-zinc-600 shadow-lg ml-2">
      <div className="text-[11px] text-zinc-400 text-center font-bold tracking-widest uppercase">
        Master
      </div>

      <div className="flex gap-4 justify-center">
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
  );
}

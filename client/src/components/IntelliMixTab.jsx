import { useMixerStore } from '../state/mixerStore.js';

const INPUT_CHANNELS = [1, 2, 3, 4, 5, 6, 7, 8];

const INTELLIMIX_MODES = ['CLASSIC', 'SMOOTH', 'EXTREME', 'CUSTOM_PRESET', 'MANUAL'];

const MIX_BUS_OPTIONS = [
  { value: 'BOTH',    label: 'Both'   },
  { value: 'NEITHER', label: 'Neither'},
  { value: 'MIXBUS_A', label: 'Bus A' },
  { value: 'MIXBUS_B', label: 'Bus B' },
];

const HW_GATING_OPTIONS = [
  { value: 'MIXBUS_A', label: 'Bus A' },
  { value: 'MIXBUS_B', label: 'Bus B' },
];

function ModeButton({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 text-[10px] rounded font-bold tracking-wide transition-colors ${
        active
          ? 'bg-teal-700 text-white'
          : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'
      }`}
    >
      {label}
    </button>
  );
}

function OnOffToggle({ value, onParam, offParam, onValue = 'ON', offValue = 'OFF', onChange }) {
  const isOn = value === true || value === 'ON';
  return (
    <button
      onClick={() => onChange(isOn ? offValue : onValue)}
      className={`w-12 py-0.5 text-[9px] rounded font-bold tracking-wider transition-colors ${
        isOn
          ? 'bg-teal-700 text-white'
          : 'bg-zinc-700 text-zinc-500 hover:bg-zinc-600'
      }`}
    >
      {isOn ? 'ON' : 'OFF'}
    </button>
  );
}

function SegButton({ options, value, onChange }) {
  return (
    <div className="flex rounded overflow-hidden border border-zinc-600">
      {options.map(({ value: v, label }) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`flex-1 px-3 py-1 text-[10px] font-bold tracking-wide transition-colors ${
            value === v
              ? 'bg-blue-700 text-white'
              : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function IntelliMixTab({ sendSet }) {
  const deviceInfo = useMixerStore((s) => s.deviceInfo);
  const channels   = useMixerStore((s) => s.channels);

  const autoMixMode = deviceInfo.autoMixMode ?? 'SINGLE';
  const modeA = channels[18]?.intellimixMode ?? 'CLASSIC';
  const modeB = channels[19]?.intellimixMode ?? 'CLASSIC';

  const isManualA = modeA === 'MANUAL';
  const isManualB = modeB === 'MANUAL';
  const isDual    = autoMixMode === 'DUAL';

  // Show manual columns if any relevant output is in MANUAL mode
  const showManualCols = isDual ? (isManualA || isManualB) : isManualA;
  // Show auto columns if any relevant output is NOT in MANUAL mode
  const showAutoCols   = isDual ? (!isManualA || !isManualB) : !isManualA;

  return (
    <div className="flex flex-col gap-5 p-4 overflow-auto">

      {/* Auto Mix Mode global toggle */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-bold text-zinc-400 font-mono uppercase tracking-wider w-28">Auto Mix Mode</span>
        <SegButton
          options={[{ value: 'SINGLE', label: 'Single' }, { value: 'DUAL', label: 'Dual' }]}
          value={autoMixMode}
          onChange={(v) => sendSet(null, 'AUTO_MIX_MODE', v)}
        />
      </div>

      {/* Per-output IntelliMix mode selectors */}
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">
            Mix A — {channels[18]?.name || 'Output A'}
          </span>
          <div className="flex gap-1">
            {INTELLIMIX_MODES.map((mode) => (
              <ModeButton
                key={mode}
                label={mode === 'CUSTOM_PRESET' ? 'Custom' : mode.charAt(0) + mode.slice(1).toLowerCase()}
                active={modeA === mode}
                onClick={() => sendSet(18, 'SET_INTELLIMIX_MODE', mode)}
              />
            ))}
          </div>
        </div>

        {isDual && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">
              Mix B — {channels[19]?.name || 'Output B'}
            </span>
            <div className="flex gap-1">
              {INTELLIMIX_MODES.map((mode) => (
                <ModeButton
                  key={mode}
                  label={mode === 'CUSTOM_PRESET' ? 'Custom' : mode.charAt(0) + mode.slice(1).toLowerCase()}
                  active={modeB === mode}
                  onClick={() => sendSet(19, 'SET_INTELLIMIX_MODE', mode)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Per-channel parameter table */}
      <div className="overflow-x-auto">
        <table className="text-xs border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="text-left pr-3 pb-2 text-zinc-500 font-mono text-[10px] uppercase tracking-wider whitespace-nowrap">Ch</th>
              <th className="text-left pr-4 pb-2 text-zinc-500 font-mono text-[10px] uppercase tracking-wider">Name</th>

              {showManualCols && (
                <>
                  <th className="text-center px-2 pb-2 text-zinc-500 font-mono text-[10px] uppercase tracking-wider whitespace-nowrap">Mix Bus</th>
                  <th className="text-center px-2 pb-2 text-zinc-500 font-mono text-[10px] uppercase tracking-wider whitespace-nowrap">HW Gate</th>
                </>
              )}

              {showAutoCols && (
                <>
                  <th className="text-center px-2 pb-2 text-zinc-500 font-mono text-[10px] uppercase tracking-wider whitespace-nowrap">Always On A</th>
                  <th className="text-center px-2 pb-2 text-zinc-500 font-mono text-[10px] uppercase tracking-wider whitespace-nowrap">Always On B</th>
                  <th className="text-center px-2 pb-2 text-zinc-500 font-mono text-[10px] uppercase tracking-wider whitespace-nowrap">Chair OVR</th>
                  <th className="text-center px-2 pb-2 text-zinc-500 font-mono text-[10px] uppercase tracking-wider whitespace-nowrap">Chair Mute</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {INPUT_CHANNELS.map((ch) => {
              const data = channels[ch] ?? {};
              return (
                <tr key={ch} className="hover:bg-zinc-800/50">
                  <td className="pr-3 py-1 text-zinc-600 font-mono text-[10px]">{String(ch).padStart(2, '0')}</td>
                  <td className="pr-4 py-1 text-zinc-300 text-[11px] font-medium whitespace-nowrap max-w-[100px] truncate">
                    {data.name || `Ch ${ch}`}
                  </td>

                  {showManualCols && (
                    <>
                      <td className="px-2 py-1 text-center">
                        <select
                          value={data.mixBus ?? 'BOTH'}
                          onChange={(e) => sendSet(ch, 'INPUT_AUDIO_MIX_BUS', e.target.value)}
                          className="bg-zinc-700 text-zinc-300 text-[9px] rounded px-1 py-0.5 border border-zinc-600 cursor-pointer"
                        >
                          {MIX_BUS_OPTIONS.map(({ value, label }) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1 text-center">
                        <select
                          value={data.hwGatingLogic ?? 'MIXBUS_A'}
                          onChange={(e) => sendSet(ch, 'HW_GATING_LOGIC', e.target.value)}
                          className="bg-zinc-700 text-zinc-300 text-[9px] rounded px-1 py-0.5 border border-zinc-600 cursor-pointer"
                        >
                          {HW_GATING_OPTIONS.map(({ value, label }) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </td>
                    </>
                  )}

                  {showAutoCols && (
                    <>
                      <td className="px-2 py-1 text-center">
                        <OnOffToggle
                          value={data.alwaysOn}
                          onChange={(v) => sendSet(ch, 'ALWAYS_ON_ENABLE_A', v)}
                        />
                      </td>
                      <td className="px-2 py-1 text-center">
                        <OnOffToggle
                          value={data.alwaysOnB}
                          onChange={(v) => sendSet(ch, 'ALWAYS_ON_ENABLE_B', v)}
                        />
                      </td>
                      <td className="px-2 py-1 text-center">
                        <OnOffToggle
                          value={data.chairOverride}
                          onChange={(v) => sendSet(ch, 'CHAIR_OVERRIDE_ENABLE_B', v)}
                        />
                      </td>
                      <td className="px-2 py-1 text-center">
                        <OnOffToggle
                          value={data.chairMuteCtrl}
                          onChange={(v) => sendSet(ch, 'CHAIR_MUTE_CTRL_ENABLE_B', v)}
                        />
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!showManualCols && !showAutoCols && (
        <p className="text-[10px] text-zinc-600 font-mono">
          Select an IntelliMix mode above to configure per-channel parameters.
        </p>
      )}
    </div>
  );
}

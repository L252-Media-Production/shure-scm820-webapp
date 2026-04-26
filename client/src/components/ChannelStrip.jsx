import { memo, useState } from 'react';
import { VUMeter } from './VUMeter.jsx';
import { Fader } from './Fader.jsx';

const NAME_MAX_LEN = 31;

const AUDIO_IN_LVL_SWITCH_OPTIONS = [
  { value: 'LINE_LVL',     label: 'LN',  title: 'Line level'  },
  { value: 'MIC_LVL_26DB', label: '+26', title: 'Mic (+26 dB)' },
  { value: 'MIC_LVL_46DB', label: '+46', title: 'Mic (+46 dB)' },
];

const LO_CUT_FREQ_MIN = 25;
const LO_CUT_FREQ_MAX = 320;
const HI_SHELF_GAIN_MIN = 0;
const HI_SHELF_GAIN_MAX = 24;
const HI_SHELF_GAIN_UNITY = 12;

export const ChannelStrip = memo(function ChannelStrip({ channelIndex, data, sendSet, meterLevelsRef, isAux = false }) {
  const { name, mute, gain, alwaysOn, gateOpen, inputSource, phantomPower, micSens,
          lowCutEnabled, lowCutFreq, hiShelfEnabled, hiShelfGain } = data;
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [eqOpen, setEqOpen] = useState(false);
  const [editingLoCut, setEditingLoCut] = useState(false);
  const [draftLoCut, setDraftLoCut] = useState('');
  const [editingHiShelf, setEditingHiShelf] = useState(false);
  const [draftHiShelf, setDraftHiShelf] = useState('');

  const levelIndex = channelIndex - 1;
  const isAnalog = inputSource === 'Analog';

  function startEdit() {
    setDraftName(name || `CH ${channelIndex}`);
    setEditingName(true);
  }

  function commitEdit() {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== name) {
      sendSet(channelIndex, 'CHAN_NAME', `{${trimmed.padEnd(31)}}`);
    }
    setEditingName(false);
  }

  function handleNameKeyDown(e) {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') setEditingName(false);
  }

  function handleMute() {
    sendSet(channelIndex, 'AUDIO_MUTE', mute ? 'OFF' : 'ON');
  }

  function handleGainChange(rawValue) {
    sendSet(channelIndex, 'AUDIO_GAIN_HI_RES', String(rawValue).padStart(4, '0'));
  }

  return (
    <div className="flex flex-col items-center gap-2 px-2 py-3 bg-zinc-800 rounded-xl w-[104px] border border-zinc-700 shadow-lg">

      {/* Gate LED */}
      <div className="flex items-center gap-1.5">
        <div
          className={`w-2.5 h-2.5 rounded-full transition-colors ${
            gateOpen ? 'bg-green-400 shadow-[0_0_6px_#4ade80]' : 'bg-zinc-600'
          }`}
        />
        <span className="text-[10px] text-zinc-500 uppercase tracking-wide">gate</span>
      </div>

      {/* Channel name — click to edit */}
      {editingName ? (
        <input
          autoFocus
          value={draftName}
          maxLength={NAME_MAX_LEN}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleNameKeyDown}
          className="w-full text-[11px] bg-zinc-900 border border-blue-500 rounded px-1 py-0.5 text-center text-zinc-100 focus:outline-none font-semibold"
        />
      ) : (
        <div
          className="text-[11px] text-zinc-200 text-center font-semibold w-full truncate cursor-pointer hover:text-white hover:underline underline-offset-2"
          title="Click to rename"
          onClick={startEdit}
        >
          {name || `CH ${channelIndex}`}
        </div>
      )}

      {/* EQ collapsible panel */}
      <div className="w-full">
        <button
          onClick={() => setEqOpen(o => !o)}
          className="w-full flex items-center justify-between py-0.5 px-1.5 text-[9px] font-bold tracking-wider text-zinc-400 hover:text-zinc-200 bg-zinc-700/50 hover:bg-zinc-700 rounded transition-colors"
        >
          <span>EQ</span>
          <span className="text-[8px]">{eqOpen ? '▴' : '▾'}</span>
        </button>

        {eqOpen && (
          <div className="mt-1.5 flex flex-col gap-2">

            {/* Lo-Cut */}
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[8px] text-zinc-500 font-bold tracking-wider">LO-CUT</span>
                <button
                  onClick={() => sendSet(channelIndex, 'LOW_CUT_ENABLE', lowCutEnabled ? 'OFF' : 'ON')}
                  className={`px-1.5 py-0.5 text-[8px] rounded font-bold transition-colors ${
                    lowCutEnabled
                      ? 'bg-green-700 text-white shadow-[0_0_4px_#15803d]'
                      : 'bg-zinc-600 text-zinc-400 hover:bg-zinc-500'
                  }`}
                >
                  {lowCutEnabled ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => sendSet(channelIndex, 'LOW_CUT_FREQ', String(Math.max(LO_CUT_FREQ_MIN, lowCutFreq - 1)).padStart(3, '0'))}
                  className="w-5 h-5 text-[11px] bg-zinc-700 hover:bg-zinc-600 rounded text-zinc-300 flex items-center justify-center shrink-0"
                >−</button>
                {editingLoCut ? (
                  <input
                    autoFocus
                    type="number"
                    value={draftLoCut}
                    min={LO_CUT_FREQ_MIN}
                    max={LO_CUT_FREQ_MAX}
                    onChange={(e) => setDraftLoCut(e.target.value)}
                    onBlur={() => {
                      const v = Math.max(LO_CUT_FREQ_MIN, Math.min(LO_CUT_FREQ_MAX, parseInt(draftLoCut, 10)));
                      if (!isNaN(v)) sendSet(channelIndex, 'LOW_CUT_FREQ', String(v).padStart(3, '0'));
                      setEditingLoCut(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') setEditingLoCut(false);
                    }}
                    className="flex-1 w-0 text-center text-[9px] bg-zinc-900 border border-blue-500 rounded text-zinc-100 focus:outline-none font-mono py-px"
                  />
                ) : (
                  <span
                    className="flex-1 text-center text-[9px] text-zinc-200 font-mono cursor-pointer hover:text-white hover:underline underline-offset-2"
                    title="Click to enter value"
                    onClick={() => { setDraftLoCut(String(lowCutFreq)); setEditingLoCut(true); }}
                  >{lowCutFreq}Hz</span>
                )}
                <button
                  onClick={() => sendSet(channelIndex, 'LOW_CUT_FREQ', String(Math.min(LO_CUT_FREQ_MAX, lowCutFreq + 1)).padStart(3, '0'))}
                  className="w-5 h-5 text-[11px] bg-zinc-700 hover:bg-zinc-600 rounded text-zinc-300 flex items-center justify-center shrink-0"
                >+</button>
              </div>
            </div>

            {/* Hi-Shelf */}
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[8px] text-zinc-500 font-bold tracking-wider">HI-SHELF</span>
                <button
                  onClick={() => sendSet(channelIndex, 'HIGH_SHELF_ENABLE', hiShelfEnabled ? 'OFF' : 'ON')}
                  className={`px-1.5 py-0.5 text-[8px] rounded font-bold transition-colors ${
                    hiShelfEnabled
                      ? 'bg-green-700 text-white shadow-[0_0_4px_#15803d]'
                      : 'bg-zinc-600 text-zinc-400 hover:bg-zinc-500'
                  }`}
                >
                  {hiShelfEnabled ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => sendSet(channelIndex, 'HIGH_SHELF_GAIN', String(Math.max(HI_SHELF_GAIN_MIN, hiShelfGain - 1)).padStart(3, '0'))}
                  className="w-5 h-5 text-[11px] bg-zinc-700 hover:bg-zinc-600 rounded text-zinc-300 flex items-center justify-center shrink-0"
                >−</button>
                {editingHiShelf ? (
                  <input
                    autoFocus
                    type="number"
                    value={draftHiShelf}
                    min={-HI_SHELF_GAIN_UNITY}
                    max={HI_SHELF_GAIN_UNITY}
                    onChange={(e) => setDraftHiShelf(e.target.value)}
                    onBlur={() => {
                      const dB = Math.max(-HI_SHELF_GAIN_UNITY, Math.min(HI_SHELF_GAIN_UNITY, parseInt(draftHiShelf, 10)));
                      if (!isNaN(dB)) {
                        const raw = dB + HI_SHELF_GAIN_UNITY;
                        sendSet(channelIndex, 'HIGH_SHELF_GAIN', String(raw).padStart(3, '0'));
                      }
                      setEditingHiShelf(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') setEditingHiShelf(false);
                    }}
                    className="flex-1 w-0 text-center text-[9px] bg-zinc-900 border border-blue-500 rounded text-zinc-100 focus:outline-none font-mono py-px"
                  />
                ) : (
                  <span
                    className="flex-1 text-center text-[9px] text-zinc-200 font-mono cursor-pointer hover:text-white hover:underline underline-offset-2"
                    title="Click to enter value (dB)"
                    onClick={() => { setDraftHiShelf(String(hiShelfGain - HI_SHELF_GAIN_UNITY)); setEditingHiShelf(true); }}
                  >
                    {hiShelfGain - HI_SHELF_GAIN_UNITY >= 0 ? '+' : ''}{hiShelfGain - HI_SHELF_GAIN_UNITY}dB
                  </span>
                )}
                <button
                  onClick={() => sendSet(channelIndex, 'HIGH_SHELF_GAIN', String(Math.min(HI_SHELF_GAIN_MAX, hiShelfGain + 1)).padStart(3, '0'))}
                  className="w-5 h-5 text-[11px] bg-zinc-700 hover:bg-zinc-600 rounded text-zinc-300 flex items-center justify-center shrink-0"
                >+</button>
              </div>
            </div>

          </div>
        )}
      </div>

      {/* Fader + VU Meter side by side */}
      <div className="flex items-start gap-1">
        <Fader value={gain} onChange={handleGainChange} />
        <VUMeter levelIndex={levelIndex} meterLevelsRef={meterLevelsRef} height={140} />
      </div>

      {/* Mute button */}
      <button
        onClick={handleMute}
        className={`w-full py-1.5 text-[10px] rounded font-bold tracking-wider transition-colors ${
          mute
            ? 'bg-red-600 text-white shadow-[0_0_8px_#dc2626]'
            : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
        }`}
      >
        {mute ? 'MUTED' : 'MUTE'}
      </button>

      {/* Always On — aux channel does not support this */}
      {!isAux && (
        <button
          onClick={() => sendSet(channelIndex, 'ALWAYS_ON_ENABLE_A', alwaysOn ? 'OFF' : 'ON')}
          className={`w-full py-1 text-[10px] rounded tracking-wide transition-colors ${
            alwaysOn
              ? 'bg-amber-500 text-zinc-900 font-bold'
              : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'
          }`}
        >
          ALWAYS ON
        </button>
      )}

      {/* Input source: Analog / Network */}
      <div className="flex w-full gap-1">
        <button
          onClick={() => sendSet(channelIndex, 'INPUT_AUDIO_SOURCE', 'Analog')}
          className={`flex-1 py-0.5 text-[9px] rounded font-bold transition-colors ${
            isAnalog
              ? 'bg-blue-700 text-white'
              : 'bg-zinc-700 text-zinc-500 hover:bg-zinc-600'
          }`}
        >
          ANA
        </button>
        <button
          onClick={() => sendSet(channelIndex, 'INPUT_AUDIO_SOURCE', 'Network')}
          className={`flex-1 py-0.5 text-[9px] rounded font-bold transition-colors ${
            !isAnalog
              ? 'bg-purple-700 text-white'
              : 'bg-zinc-700 text-zinc-500 hover:bg-zinc-600'
          }`}
        >
          NET
        </button>
      </div>

      {/* Analog-only, non-aux: Mic sensitivity selector */}
      {isAnalog && !isAux && (
        <div className="flex w-full gap-0.5">
          {AUDIO_IN_LVL_SWITCH_OPTIONS.map(({ value, label, title }) => (
            <button
              key={value}
              title={title}
              onClick={() => sendSet(channelIndex, 'AUDIO_IN_LVL_SWITCH', value)}
              className={`flex-1 py-0.5 text-[8px] rounded font-bold transition-colors ${
                micSens === value
                  ? 'bg-teal-700 text-white'
                  : 'bg-zinc-700 text-zinc-500 hover:bg-zinc-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Analog-only, non-aux: 48V Phantom Power */}
      {isAnalog && !isAux && (
        <button
          onClick={() => sendSet(channelIndex, 'PHANTOM_PWR_ENABLE', phantomPower ? 'OFF' : 'ON')}
          className={`w-full py-0.5 text-[9px] rounded font-bold tracking-wider transition-colors ${
            phantomPower
              ? 'bg-red-800 text-red-200 shadow-[0_0_6px_#991b1b]'
              : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'
          }`}
        >
          +48V
        </button>
      )}

      {/* Channel number badge */}
      <div className="text-[10px] text-zinc-600 font-mono">{String(channelIndex).padStart(2, '0')}</div>
    </div>
  );
});

import { memo, useState } from 'react';
import { VUMeter } from './VUMeter.jsx';
import { Fader } from './Fader.jsx';

// Per PDF: valid IntelliMix modes for the SCM820
const INTELLIMIX_MODES = ['CLASSIC', 'SMOOTH', 'EXTREME', 'CUSTOM', 'MANUAL', 'CUSTOM_PRESET'];
const NAME_MAX_LEN = 31;

const AUDIO_IN_LVL_SWITCH_OPTIONS = [
  { value: 'LINE_LVL',     label: 'LN',  title: 'Line level'  },
  { value: 'MIC_LVL_26DB', label: '+26', title: 'Mic (+26 dB)' },
  { value: 'MIC_LVL_46DB', label: '+46', title: 'Mic (+46 dB)' },
];

export const ChannelStrip = memo(function ChannelStrip({ channelIndex, data, sendSet, meterLevelsRef }) {
  const { name, mute, gain, alwaysOn, intellimixMode, gateOpen, inputSource, phantomPower, micSens } = data;
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');

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

      {/* Always On */}
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

      {/* Analog-only: Mic sensitivity selector */}
      {isAnalog && (
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

      {/* Analog-only: 48V Phantom Power */}
      {isAnalog && (
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

      {/* Intellimix mode */}
      <select
        value={intellimixMode}
        onChange={(e) => sendSet(channelIndex, 'INTELLIMIX_MODE', e.target.value)}
        className="w-full text-[10px] bg-zinc-700 text-zinc-300 rounded p-1 border border-zinc-600 cursor-pointer"
      >
        {INTELLIMIX_MODES.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>

      {/* Channel number badge */}
      <div className="text-[10px] text-zinc-600 font-mono">{String(channelIndex).padStart(2, '0')}</div>
    </div>
  );
});

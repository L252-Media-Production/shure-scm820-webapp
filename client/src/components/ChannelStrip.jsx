import { memo, useState } from 'react';
import { VUMeter } from './VUMeter.jsx';
import { Fader } from './Fader.jsx';

const INTELLIMIX_MODES = ['CLASSIC', 'NOISE_ADAPTIVE', 'GATING', 'MANUAL'];
const NAME_MAX_LEN = 12;

export const ChannelStrip = memo(function ChannelStrip({ channelIndex, data, sendSet, meterLevelsRef }) {
  const { name, muteA, muteB, gainA, alwaysOn, intellimixMode, gateOpen, inputType } = data;
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');

  const levelIndex = channelIndex - 1;
  const isMuted = muteA || muteB;

  function startEdit() {
    setDraftName(name || `CH ${channelIndex}`);
    setEditingName(true);
  }

  function commitEdit() {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== name) {
      sendSet(channelIndex, 'CHAN_NAME', trimmed);
    }
    setEditingName(false);
  }

  function handleNameKeyDown(e) {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') setEditingName(false);
  }

  return (
    <div className="flex flex-col items-center gap-2 p-3 bg-zinc-800 rounded-xl w-[96px] border border-zinc-700 shadow-lg">

      {/* Gate LED */}
      <div className="flex items-center gap-1.5">
        <div
          className={`w-2.5 h-2.5 rounded-full transition-colors ${
            gateOpen ? 'bg-green-400 shadow-[0_0_6px_#4ade80]' : 'bg-zinc-600'
          }`}
        />
        <span className="text-[10px] text-zinc-500 uppercase tracking-wide">gate</span>
      </div>

      {/* VU Meter */}
      <VUMeter levelIndex={levelIndex} meterLevelsRef={meterLevelsRef} />

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

      {/* Gain fader with dB scale */}
      <Fader
        value={gainA}
        onChange={(v) => sendSet(channelIndex, 'INPUT_GAIN_HI_A', v)}
      />

      {/* Single mute button (mutes both mix A and mix B) */}
      <button
        onClick={() => {
          sendSet(channelIndex, 'CHAN_MUTE_A', 'TOGGLE');
          sendSet(channelIndex, 'CHAN_MUTE_B', 'TOGGLE');
        }}
        className={`w-full py-1.5 text-[10px] rounded font-bold tracking-wider transition-colors ${
          isMuted
            ? 'bg-red-600 text-white shadow-[0_0_8px_#dc2626]'
            : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
        }`}
      >
        {isMuted ? 'MUTED' : 'MUTE'}
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

      {/* Input source: Analog / Dante */}
      <div className="flex w-full gap-1">
        <button
          onClick={() => sendSet(channelIndex, 'INPUT_TYPE', 'ANALOG')}
          className={`flex-1 py-0.5 text-[9px] rounded font-bold transition-colors ${
            inputType === 'ANALOG'
              ? 'bg-blue-700 text-white'
              : 'bg-zinc-700 text-zinc-500 hover:bg-zinc-600'
          }`}
        >
          ANA
        </button>
        <button
          onClick={() => sendSet(channelIndex, 'INPUT_TYPE', 'DANTE')}
          className={`flex-1 py-0.5 text-[9px] rounded font-bold transition-colors ${
            inputType === 'DANTE'
              ? 'bg-purple-700 text-white'
              : 'bg-zinc-700 text-zinc-500 hover:bg-zinc-600'
          }`}
        >
          DAN
        </button>
      </div>

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

import { useState, useEffect, useRef } from 'react';
import { useSCM820 } from './hooks/useSCM820.js';
import { useMixerStore } from './state/mixerStore.js';
import { MixerLayout } from './components/MixerLayout.jsx';
import { ConnectionModal } from './components/ConnectionModal.jsx';

function StatusPopover({ deviceInfo, connected, onHostChange, onClose }) {
  const [host, setHost] = useState(deviceInfo.host || '');

  function handleSubmit(e) {
    e.preventDefault();
    if (host.trim()) onHostChange(host.trim());
  }

  return (
    <div className="absolute right-0 top-full mt-2 w-72 bg-zinc-800 border border-zinc-600 rounded-xl shadow-2xl p-4 z-50">
      <div className="space-y-2 mb-4 text-xs font-mono">
        <div className="flex justify-between">
          <span className="text-zinc-500">Status</span>
          <span className={connected ? 'text-green-400' : 'text-red-400'}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Device IP</span>
          <span className="text-zinc-200">{deviceInfo.host || '—'}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-zinc-500 shrink-0">Device ID</span>
          <span className="text-zinc-200 text-right truncate">{deviceInfo.deviceId || '—'}</span>
        </div>
      </div>

      <div className="border-t border-zinc-700 pt-3">
        <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Change IP Address</div>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="192.168.1.x"
            spellCheck={false}
            className="flex-1 bg-zinc-900 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-200 font-mono focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={!host.trim()}
            className="px-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-bold rounded transition-colors"
          >
            Connect
          </button>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const { sendSet, meterLevelsRef, updateDeviceHost } = useSCM820();
  const connected = useMixerStore((s) => s.connected);
  const deviceInfo = useMixerStore((s) => s.deviceInfo);

  const [showModal, setShowModal] = useState(false);
  const [showPopover, setShowPopover] = useState(false);
  const hasConnectedRef = useRef(false);

  useEffect(() => {
    if (connected) {
      hasConnectedRef.current = true;
      setShowModal(false);
      setShowPopover(false);
    }
  }, [connected]);

  // Show config modal after 3s if we've never connected (no device configured)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!hasConnectedRef.current) setShowModal(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  async function handleHostChange(host) {
    await updateDeviceHost(host);
    setShowPopover(false);
    setShowModal(false);
  }

  return (
    <div className="min-h-screen bg-zinc-900 text-white flex flex-col">
      <header className="flex items-center justify-between px-5 py-3 bg-zinc-800 border-b border-zinc-700 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-zinc-500 text-xs font-mono uppercase tracking-widest">Shure</span>
          <span className="text-zinc-200 font-bold tracking-wide">SCM820 Virtual Mixer</span>
        </div>

        {/* Clickable status indicator */}
        <div className="relative">
          <button
            onClick={() => setShowPopover((v) => !v)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-zinc-700 transition-colors"
          >
            <div
              className={`w-2 h-2 rounded-full transition-colors ${
                connected ? 'bg-green-400 shadow-[0_0_6px_#4ade80]' : 'bg-red-500'
              }`}
            />
            <span className="text-xs text-zinc-400 font-mono">
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </button>

          {showPopover && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowPopover(false)} />
              <StatusPopover
                deviceInfo={deviceInfo}
                connected={connected}
                onHostChange={handleHostChange}
                onClose={() => setShowPopover(false)}
              />
            </>
          )}
        </div>
      </header>

      {!connected && (
        <div className="flex items-center justify-center flex-1 gap-3 text-zinc-500 text-sm font-mono">
          <span>Waiting for SCM820 connection…</span>
          <button
            onClick={() => setShowModal(true)}
            className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
          >
            Configure
          </button>
        </div>
      )}

      {connected && <MixerLayout sendSet={sendSet} meterLevelsRef={meterLevelsRef} />}

      {showModal && (
        <ConnectionModal
          currentHost={deviceInfo.host}
          onConnect={handleHostChange}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

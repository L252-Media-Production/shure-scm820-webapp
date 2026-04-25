import { useState, useEffect, useRef } from 'react';
import { useSCM820 } from './hooks/useSCM820.js';
import { useMixerStore } from './state/mixerStore.js';
import { MixerLayout } from './components/MixerLayout.jsx';
import { ConnectionModal } from './components/ConnectionModal.jsx';
import { DebugDrawer } from './components/DebugDrawer.jsx';

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-zinc-500 shrink-0">{label}</span>
      <span className="text-zinc-200 font-mono text-right truncate max-w-[170px]">{value || '—'}</span>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div className="text-[10px] text-zinc-600 uppercase tracking-wider mt-2 mb-1">{children}</div>
  );
}

function SegBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-0.5 text-[9px] font-bold rounded transition-colors ${
        active ? 'bg-blue-700 text-white' : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'
      }`}
    >
      {children}
    </button>
  );
}

function StatusPopover({ deviceInfo, connected, sendSet, onHostChange, xtouchInfo, xtouchConnected, onXtouchSave }) {
  const [host, setHost] = useState(deviceInfo.host || '');
  const [expanded, setExpanded] = useState(false);
  const [lastActiveRate, setLastActiveRate] = useState(1000);
  const [xtouchHost, setXtouchHost] = useState(xtouchInfo.host || '');
  const [xtouchPort, setXtouchPort] = useState(String(xtouchInfo.port || 5004));

  useEffect(() => { setHost(deviceInfo.host || ''); }, [deviceInfo.host]);
  useEffect(() => { setXtouchHost(xtouchInfo.host || ''); }, [xtouchInfo.host]);
  useEffect(() => { setXtouchPort(String(xtouchInfo.port || 5004)); }, [xtouchInfo.port]);

  const meterRateMs = parseInt(deviceInfo.meterRate, 10);
  const meterEnabled = !isNaN(meterRateMs) && meterRateMs > 0;

  useEffect(() => {
    if (!isNaN(meterRateMs) && meterRateMs > 0) setLastActiveRate(meterRateMs);
  }, [meterRateMs]);

  function handleSubmit(e) {
    e.preventDefault();
    if (host.trim()) onHostChange(host.trim());
  }

  function toggleMeter() {
    sendSet(null, 'METER_RATE', meterEnabled ? '00000' : String(lastActiveRate));
  }

  return (
    <div className="absolute right-0 top-full mt-2 w-80 bg-zinc-800 border border-zinc-600 rounded-xl shadow-2xl p-4 z-50 max-h-[85vh] overflow-y-auto">

      {/* Always-visible summary */}
      <div className="space-y-1.5 mb-3 text-xs">
        <div className="flex justify-between">
          <span className="text-zinc-500">Status</span>
          <span className={connected ? 'text-green-400 font-mono' : 'text-red-400 font-mono'}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <InfoRow label="Device IP"  value={deviceInfo.host} />
        <InfoRow label="Device ID"  value={deviceInfo.deviceId} />
        <InfoRow label="Serial"     value={deviceInfo.serialNum} />
        <InfoRow label="Firmware"   value={deviceInfo.fwVer} />
      </div>

      {/* Expand toggle */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between text-[10px] text-zinc-500 uppercase tracking-wider hover:text-zinc-300 pb-2 transition-colors border-b border-zinc-700 mb-3"
      >
        <span>Device Details</span>
        <span className="text-zinc-600">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="space-y-1 mb-4 text-xs">

          <SectionLabel>Control Network</SectionLabel>
          <InfoRow label="Subnet"  value={deviceInfo.ipSubnetControl} />
          <InfoRow label="Gateway" value={deviceInfo.ipGatewayControl} />

          <SectionLabel>Audio Network</SectionLabel>
          <InfoRow label="Protocol" value={deviceInfo.networkAudioProtocol} />
          <InfoRow label="Version"  value={deviceInfo.networkAudioVer} />

          <div className="text-[10px] text-zinc-700 mt-1 mb-0.5 pl-1">Dante Primary Interface</div>
          <InfoRow label="IP"      value={deviceInfo.ipAddrPrimary} />
          <InfoRow label="Subnet"  value={deviceInfo.ipSubnetPrimary} />
          <InfoRow label="Gateway" value={deviceInfo.ipGatewayPrimary} />

          <div className="text-[10px] text-zinc-700 mt-1 mb-0.5 pl-1">Dante Secondary Interface</div>
          <InfoRow label="IP"      value={deviceInfo.ipAddrSecondary} />
          <InfoRow label="Subnet"  value={deviceInfo.ipSubnetSecondary} />
          <InfoRow label="Gateway" value={deviceInfo.ipGatewaySecondary} />

          <SectionLabel>Device Settings</SectionLabel>

          {/* Input Meter Mode */}
          <div className="py-0.5">
            <div className="text-zinc-500 mb-1">Meter Input</div>
            <div className="flex gap-1">
              <SegBtn active={deviceInfo.inputMeterMode === 'PRE_FADER'}  onClick={() => sendSet(null, 'INPUT_METER_MODE', 'PRE_FADER')}>PRE</SegBtn>
              <SegBtn active={deviceInfo.inputMeterMode === 'POST_FADER'} onClick={() => sendSet(null, 'INPUT_METER_MODE', 'POST_FADER')}>POST</SegBtn>
            </div>
          </div>

          {/* Meter Type */}
          <div className="py-0.5">
            <div className="text-zinc-500 mb-1">Meter Type</div>
            <div className="flex gap-1">
              <SegBtn active={deviceInfo.meterType === 'VU'}      onClick={() => sendSet(null, 'METER_TYPE', 'VU')}>VU</SegBtn>
              <SegBtn active={deviceInfo.meterType === 'PEAK'}    onClick={() => sendSet(null, 'METER_TYPE', 'PEAK')}>PEAK</SegBtn>
              <SegBtn active={deviceInfo.meterType === 'VU_PEAK'} onClick={() => sendSet(null, 'METER_TYPE', 'VU_PEAK')}>VU+PK</SegBtn>
            </div>
          </div>

          {/* Headphone Source */}
          <div className="py-0.5">
            <div className="text-zinc-500 mb-1">Headphone Source</div>
            <div className="flex gap-1">
              <SegBtn active={deviceInfo.headphoneSource === 'PRE_FADER'}  onClick={() => sendSet(null, 'HEADPHONE_SOURCE', 'PRE_FADER')}>PRE</SegBtn>
              <SegBtn active={deviceInfo.headphoneSource === 'POST_FADER'} onClick={() => sendSet(null, 'HEADPHONE_SOURCE', 'POST_FADER')}>POST</SegBtn>
            </div>
          </div>

          {/* Meter Rate */}
          <div className="py-0.5">
            <div className="flex justify-between items-center mb-1">
              <div className="text-zinc-500">Meter Rate</div>
              <div className="flex items-center gap-2">
                <span className="text-zinc-300 font-mono text-[10px]">
                  {meterEnabled ? `${meterRateMs} ms` : 'OFF'}
                </span>
                <button
                  onClick={toggleMeter}
                  className={`px-2 py-0.5 text-[9px] font-bold rounded transition-colors ${
                    meterEnabled
                      ? 'bg-blue-700 text-white hover:bg-blue-600'
                      : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'
                  }`}
                >
                  {meterEnabled ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>
            <input
              type="range"
              min={100}
              max={2000}
              step={50}
              disabled={!meterEnabled}
              value={meterEnabled ? Math.min(2000, Math.max(100, meterRateMs)) : lastActiveRate}
              onChange={(e) => sendSet(null, 'METER_RATE', e.target.value)}
              className="w-full accent-blue-500 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            />
            <div className="flex justify-between text-[9px] text-zinc-600 font-mono mt-0.5">
              <span>100ms</span>
              <span>2000ms</span>
            </div>
          </div>

          <div className="py-0.5">
            <div className="text-zinc-500 mb-1">LEDs</div>
            <div className="flex gap-1">
              <SegBtn active={deviceInfo.disableLeds === 'OFF'} onClick={() => sendSet(null, 'DISABLE_LEDS', 'OFF')}>ON</SegBtn>
              <SegBtn active={deviceInfo.disableLeds === 'ON'}  onClick={() => sendSet(null, 'DISABLE_LEDS', 'ON')}>OFF</SegBtn>
            </div>
          </div>

          {/* Flash LEDs */}
          <div className="py-0.5">
            <button
              onClick={() => sendSet(null, 'FLASH', 'ON')}
              className="w-full py-1 text-[10px] font-bold rounded bg-zinc-700 text-zinc-300 hover:bg-amber-600 hover:text-white transition-colors"
            >
              FLASH LEDs
            </button>
          </div>

          {/* Rear Panel Lock */}
          <div className="py-0.5">
            <div className="text-zinc-500 mb-1">Rear Panel</div>
            <div className="flex gap-1">
              <SegBtn active={deviceInfo.rearPanelLock === 'UNLOCK'} onClick={() => sendSet(null, 'REAR_PANEL_LOCK', 'UNLOCK')}>UNLOCK</SegBtn>
              <SegBtn active={deviceInfo.rearPanelLock === 'LOCK'}   onClick={() => sendSet(null, 'REAR_PANEL_LOCK', 'LOCK')}>LOCK</SegBtn>
            </div>
          </div>

        </div>
      )}

      {/* Change SCM820 IP */}
      <div className="border-t border-zinc-700 pt-3">
        <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Shure SCM820 IP Address</div>
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

      {/* X-Touch IP */}
      <div className="border-t border-zinc-700 pt-3 mt-1">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Behringer X-Touch</div>
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${xtouchConnected ? 'bg-green-400 shadow-[0_0_4px_#4ade80]' : 'bg-zinc-600'}`} />
            <span className={`text-[10px] font-mono ${xtouchConnected ? 'text-green-400' : 'text-zinc-600'}`}>
              {xtouchConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); if (xtouchHost.trim()) onXtouchSave(xtouchHost.trim(), parseInt(xtouchPort, 10) || 5004); }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={xtouchHost}
            onChange={(e) => setXtouchHost(e.target.value)}
            placeholder="192.168.1.x"
            spellCheck={false}
            className="flex-1 bg-zinc-900 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-200 font-mono focus:outline-none focus:border-blue-500"
          />
          <input
            type="text"
            value={xtouchPort}
            onChange={(e) => setXtouchPort(e.target.value)}
            placeholder="5004"
            className="w-16 bg-zinc-900 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-200 font-mono focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={!xtouchHost.trim()}
            className="px-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-bold rounded transition-colors"
          >
            Save
          </button>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const { sendSet, sendGet, sendTestCommand, meterLevelsRef, debugLogRef, updateDeviceHost, updateXtouchHost, loadingProgress } = useSCM820();
  const connected = useMixerStore((s) => s.connected);
  const deviceInfo = useMixerStore((s) => s.deviceInfo);
  const xtouchConnected = useMixerStore((s) => s.xtouchConnected);
  const xtouchInfo = useMixerStore((s) => s.xtouchInfo);

  const [showModal, setShowModal] = useState(false);
  const [showPopover, setShowPopover] = useState(false);
  const [zoom, setZoom] = useState(100);
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

  async function handleXtouchSave(host, port) {
    await updateXtouchHost(host, port);
  }

  return (
    <div className="min-h-screen bg-zinc-900 text-white flex flex-col">
      <header className="flex items-center justify-between px-5 py-3 bg-zinc-800 border-b border-zinc-700 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-zinc-500 text-xs font-mono uppercase tracking-widest">Shure</span>
          <span className="text-zinc-200 font-bold tracking-wide">SCM820 Virtual Mixer</span>
        </div>

        {/* Zoom control */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-600 font-mono uppercase tracking-wider">Zoom</span>
          <input
            type="range"
            min={50}
            max={100}
            step={5}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-24 accent-blue-500 cursor-pointer"
          />
          <span className="text-[10px] text-zinc-500 font-mono w-8 text-right">{zoom}%</span>
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
                sendSet={sendSet}
                onHostChange={handleHostChange}
                xtouchInfo={xtouchInfo}
                xtouchConnected={xtouchConnected}
                onXtouchSave={handleXtouchSave}
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

      {connected && (
        <div style={{ zoom: `${zoom}%` }}>
          <MixerLayout sendSet={sendSet} meterLevelsRef={meterLevelsRef} />
        </div>
      )}

      {/* Loading overlay — shown while initial state is being synced from device */}
      {connected && loadingProgress !== null && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-zinc-900/80 backdrop-blur-sm">
          <div className="text-zinc-300 text-sm font-mono tracking-wide">Syncing device state…</div>
          <div className="w-64 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-teal-500 rounded-full transition-all duration-100 ease-out"
              style={{ width: `${loadingProgress}%` }}
            />
          </div>
          <div className="text-zinc-500 text-xs font-mono">{loadingProgress}%</div>
        </div>
      )}

      {showModal && (
        <ConnectionModal
          currentHost={deviceInfo.host}
          onConnect={handleHostChange}
          onClose={() => setShowModal(false)}
        />
      )}

      <DebugDrawer debugLogRef={debugLogRef} sendTestCommand={sendTestCommand} />
    </div>
  );
}

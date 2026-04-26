import { useEffect, useRef, useCallback, useState } from 'react';
import { useMixerStore } from '../state/mixerStore.js';

const WS_URL =
  import.meta.env.VITE_WS_URL ||
  `ws://${typeof window !== 'undefined' ? window.location.host : 'localhost:8080'}`;

const API_URL = WS_URL.replace(/^ws/, 'http');
const RECONNECT_DELAY_MS = 3000;
const LOADING_TIMEOUT_MS = 8000;
const MAX_DEBUG_ENTRIES = 200;

const NON_AUDIO_PARAMS = new Set([
  'DEVICE_ID', 'SERIAL_NUM', 'FW_VER',
  'IP_SUBNET_SHURE_CONTROL', 'IP_GATEWAY_SHURE_CONTROL',
  'NETWORK_AUDIO_PROTOCOL', 'NETWORK_AUDIO_VER',
  'IP_ADDR_NET_AUDIO_PRIMARY', 'IP_SUBNET_NET_AUDIO_PRIMARY', 'IP_GATEWAY_NET_AUDIO_PRIMARY',
  'IP_ADDR_NET_AUDIO_SECONDARY', 'IP_SUBNET_NET_AUDIO_SECONDARY', 'IP_GATEWAY_NET_AUDIO_SECONDARY',
]);

function makeLoadingState() {
  return { queue: [], pending: new Set(), total: 0, active: false, timer: null };
}

function finishLoading(lr, setLoadingProgress) {
  if (!lr.active) return;
  lr.active = false;
  clearTimeout(lr.timer);
  setTimeout(() => setLoadingProgress(null), 600);
}

export function useSCM820() {
  const wsRef = useRef(null);
  const meterLevelsRef = useRef([]);
  const debugLogRef = useRef([]);
  // Keys of commands sent from the debug tester — their REPs should always be logged
  const testPendingRef = useRef(new Set());
  // queue: ordered list of expected keys (mirrors GET order — used to correlate REP ERR)
  // pending: Set for O(1) lookup of normal REPs
  const loadingRef = useRef(makeLoadingState());

  const setConnected = useMixerStore((s) => s.setConnected);
  const applyRep = useMixerStore((s) => s.applyRep);
  const applyDeviceParam = useMixerStore((s) => s.applyDeviceParam);
  const setDeviceInfo = useMixerStore((s) => s.setDeviceInfo);
  const setXtouchConnected = useMixerStore((s) => s.setXtouchConnected);
  const setXtouchInfo = useMixerStore((s) => s.setXtouchInfo);

  const [loadingProgress, setLoadingProgress] = useState(null);

  const sendSet = useCallback((channel, param, value) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const strValue = String(value);
      wsRef.current.send(JSON.stringify({ type: 'SET', channel, param, value: strValue }));
      if (!NON_AUDIO_PARAMS.has(param)) {
        debugLogRef.current = [
          { dir: '→', channel, param, value: strValue, ts: Date.now() },
          ...debugLogRef.current,
        ].slice(0, MAX_DEBUG_ENTRIES);
      }
    }
  }, []);

  const sendGet = useCallback((channel, param) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'GET', channel, param }));
      debugLogRef.current = [
        { dir: '→', channel, param, value: '(GET)', ts: Date.now() },
        ...debugLogRef.current,
      ].slice(0, MAX_DEBUG_ENTRIES);
    }
  }, []);

  // Used by the debug tester — bypasses NON_AUDIO_PARAMS filter so responses always appear
  const sendTestCommand = useCallback((type, channel, param, value) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    const key = `${channel}:${param}`;
    testPendingRef.current.add(key);
    if (type === 'GET') {
      wsRef.current.send(JSON.stringify({ type: 'GET', channel, param }));
      debugLogRef.current = [
        { dir: '→', channel, param, value: '(GET)', ts: Date.now() },
        ...debugLogRef.current,
      ].slice(0, MAX_DEBUG_ENTRIES);
    } else {
      const strValue = String(value);
      wsRef.current.send(JSON.stringify({ type: 'SET', channel, param, value: strValue }));
      debugLogRef.current = [
        { dir: '→', channel, param, value: strValue, ts: Date.now() },
        ...debugLogRef.current,
      ].slice(0, MAX_DEBUG_ENTRIES);
    }
  }, []);

  const updateDeviceHost = useCallback(async (host) => {
    try {
      const resp = await fetch(`${API_URL}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host }),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }, []);


  useEffect(() => {
    let ws;
    let reconnectTimer;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        loadingRef.current = makeLoadingState();
        loadingRef.current.active = true;
        setLoadingProgress(0);
      };

      ws.onclose = () => {
        setConnected(false);
        clearTimeout(loadingRef.current.timer);
        loadingRef.current = makeLoadingState();
        setLoadingProgress(null);
        if (!cancelled) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      ws.onerror = () => ws.close();

      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (msg.type) {
          case 'INIT_START': {
            const lr = loadingRef.current;
            clearTimeout(lr.timer);
            lr.queue = [...msg.expected];
            lr.pending = new Set(msg.expected);
            lr.total = msg.expected.length;
            lr.active = true;
            setLoadingProgress(0);
            // Fallback: if device doesn't respond to every param, give up after timeout
            lr.timer = setTimeout(() => {
              if (loadingRef.current.active) {
                loadingRef.current.active = false;
                setLoadingProgress(null);
              }
            }, LOADING_TIMEOUT_MS);
            break;
          }

          case 'CONNECTED':
            setConnected(true);
            if (msg.host !== undefined) setDeviceInfo({ host: msg.host, mac: msg.mac });
            break;

          case 'DISCONNECTED':
            setConnected(false);
            break;

          case 'CONFIG':
            setDeviceInfo({ host: msg.host, mac: msg.mac });
            break;

          case 'REP': {
            const lr = loadingRef.current;
            if (lr.active && lr.total > 0) {
              const key = `${msg.channel}:${msg.param}`;
              if (lr.pending.delete(key)) {
                // Keep queue in sync so ERR correlation stays correct
                const qi = lr.queue.indexOf(key);
                if (qi !== -1) lr.queue.splice(qi, 1);
                const received = lr.total - lr.pending.size;
                setLoadingProgress(Math.round((received / lr.total) * 100));
                if (lr.pending.size === 0) finishLoading(lr, setLoadingProgress);
              }
            }
            const repKey = `${msg.channel}:${msg.param}`;
            const isTestRep = testPendingRef.current.delete(repKey);
            if (isTestRep || !NON_AUDIO_PARAMS.has(msg.param)) {
              debugLogRef.current = [
                { dir: '←', channel: msg.channel, param: msg.param, value: msg.value, ts: Date.now() },
                ...debugLogRef.current,
              ].slice(0, MAX_DEBUG_ENTRIES);
            }
            if (msg.channel === 0) {
              applyDeviceParam(msg.param, msg.value);
            } else {
              applyRep(msg);
            }
            break;
          }

          case 'REP_ERR': {
            // Device rejected the next GET in queue — remove it so loading can complete
            const lr = loadingRef.current;
            if (lr.active && lr.queue.length > 0) {
              const failedKey = lr.queue.shift();
              lr.pending.delete(failedKey);
              const received = lr.total - lr.pending.size;
              setLoadingProgress(Math.round((received / lr.total) * 100));
              if (lr.pending.size === 0) finishLoading(lr, setLoadingProgress);
            }
            break;
          }

          case 'SAMPLE':
            meterLevelsRef.current = msg.levels;
            break;

          case 'XTOUCH_CONNECTED':
            setXtouchConnected(true);
            if (msg.host !== undefined) setXtouchInfo({ connectedHost: msg.host });
            break;

          case 'XTOUCH_DISCONNECTED':
            setXtouchConnected(false);
            setXtouchInfo({ connectedHost: null });
            break;

          case 'XTOUCH_CONFIG':
            setXtouchInfo({ localPort: msg.localPort ?? 5004 });
            setXtouchConnected(msg.connected ?? false);
            break;
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      clearTimeout(loadingRef.current.timer);
      ws?.close();
    };
  }, [setConnected, applyRep, applyDeviceParam, setDeviceInfo, setXtouchConnected, setXtouchInfo]);

  return { sendSet, sendGet, sendTestCommand, meterLevelsRef, debugLogRef, updateDeviceHost, loadingProgress };
}

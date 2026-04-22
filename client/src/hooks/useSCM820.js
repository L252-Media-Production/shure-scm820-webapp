import { useEffect, useRef, useCallback } from 'react';
import { useMixerStore } from '../state/mixerStore.js';

const WS_URL =
  import.meta.env.VITE_WS_URL ||
  `ws://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:8080`;

const API_URL = WS_URL.replace(/^ws/, 'http');
const RECONNECT_DELAY_MS = 3000;

export function useSCM820() {
  const wsRef = useRef(null);
  const meterLevelsRef = useRef([]);
  const setConnected = useMixerStore((s) => s.setConnected);
  const applyRep = useMixerStore((s) => s.applyRep);
  const setDeviceInfo = useMixerStore((s) => s.setDeviceInfo);

  const sendSet = useCallback((channel, param, value) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'SET', channel, param, value: String(value) }));
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

      ws.onopen = () => setConnected(true);

      ws.onclose = () => {
        setConnected(false);
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
          case 'REP':
            applyRep(msg);
            break;
          case 'SAMPLE':
            meterLevelsRef.current = msg.levels;
            break;
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [setConnected, applyRep, setDeviceInfo]);

  return { sendSet, meterLevelsRef, updateDeviceHost };
}

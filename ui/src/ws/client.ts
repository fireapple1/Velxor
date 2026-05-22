// WS 클라이언트 — contracts/interface-schema.md §4 reconnect 프로토콜 구현.
// 핵심: ?last_seq=N 핸드셰이크, 전역 seq monotonic dedupe, gap 수신 시 UI 전체 reset.
// 참고: docs/electron-ws-footgun.md (HMR double-mount, alive flag 격리).

import { useEffect, useRef } from "react";
import type { WsMessage } from "../types/wire";

const DEFAULT_URL = "ws://127.0.0.1:7000";
const INITIAL_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 5000;

export interface UseVelxorWsOptions {
  url?: string;
  onMessage: (msg: WsMessage) => void;
  onGap?: (payload: { from: number; to: number }) => void;
  onStatusChange?: (status: "connecting" | "open" | "closed") => void;
}

export function useVelxorWs(opts: UseVelxorWsOptions): void {
  const { url = DEFAULT_URL, onMessage, onGap, onStatusChange } = opts;
  // ref로 latest 콜백 보존 — effect 재실행 피하기.
  const handlersRef = useRef({ onMessage, onGap, onStatusChange });
  handlersRef.current = { onMessage, onGap, onStatusChange };

  useEffect(() => {
    let alive = true;
    let ws: WebSocket | null = null;
    let backoff = INITIAL_BACKOFF_MS;
    let reconnectTimer: number | undefined;
    let lastSeq = 0;

    const connect = () => {
      if (!alive) return;
      handlersRef.current.onStatusChange?.("connecting");
      const fullUrl = `${url}?last_seq=${lastSeq}`;
      const sock = new WebSocket(fullUrl);
      ws = sock;

      sock.onopen = () => {
        if (!alive) {
          sock.close();
          return;
        }
        backoff = INITIAL_BACKOFF_MS;
        handlersRef.current.onStatusChange?.("open");
      };

      sock.onmessage = (e) => {
        if (!alive) return;
        let msg: WsMessage;
        try {
          msg = JSON.parse(typeof e.data === "string" ? e.data : "") as WsMessage;
        } catch {
          return;
        }

        // gap은 seq=0 out-of-band, dedupe에서 제외.
        if (msg.type === "gap") {
          lastSeq = 0;
          handlersRef.current.onGap?.(msg.payload);
          handlersRef.current.onMessage(msg);
          return;
        }

        if (msg.seq <= lastSeq) return; // 전역 monotonic dedupe.
        lastSeq = msg.seq;
        handlersRef.current.onMessage(msg);
      };

      sock.onerror = () => {
        try { sock.close(); } catch { /* noop */ }
      };

      sock.onclose = () => {
        if (!alive) return;
        handlersRef.current.onStatusChange?.("closed");
        ws = null;
        reconnectTimer = window.setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      };
    };

    connect();

    return () => {
      alive = false;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      try { ws?.close(); } catch { /* noop */ }
    };
  }, [url]);
}

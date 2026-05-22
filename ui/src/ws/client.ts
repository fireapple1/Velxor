import { useEffect, useRef } from "react";
import type { WsMessage } from "../types";

export type ConnectionState = "connecting" | "connected" | "disconnected";

export function useVelxorWs(
  onMessage: (m: WsMessage) => void,
  onStatusChange?: (s: ConnectionState) => void,
): void {
  // ref 캡처: deps 에서 콜백을 제외해 매 렌더 재연결 방지
  const onMessageRef = useRef(onMessage);
  const onStatusChangeRef = useRef(onStatusChange);
  onMessageRef.current = onMessage;
  onStatusChangeRef.current = onStatusChange;

  useEffect(() => {
    let lastSeq = 0;
    let backoff = 250;
    let alive = true;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const setStatus = (s: ConnectionState) => {
      onStatusChangeRef.current?.(s);
    };

    const connect = () => {
      if (!alive) return;
      setStatus("connecting");
      ws = new WebSocket(`ws://127.0.0.1:7000?last_seq=${lastSeq}`);

      ws.onopen = () => {
        backoff = 250;
        setStatus("connected");
      };

      ws.onmessage = (e) => {
        let m: WsMessage;
        try {
          m = JSON.parse(e.data) as WsMessage;
        } catch {
          return;
        }
        if (typeof m.seq !== "number" || m.seq <= lastSeq) return;
        lastSeq = m.seq;
        // gap 발생 시 server 가 다음 emit 부터 새 seq 를 보낸다는 가정 대신
        // payload.to 로 명시적 점프 — 5초 replay 윈도우 외 데이터 손실 후 sync 보장
        if (m.type === "gap" && typeof m.payload?.to === "number") {
          lastSeq = m.payload.to;
        }
        onMessageRef.current(m);
      };

      ws.onclose = () => {
        if (!alive) return;
        setStatus("disconnected");
        reconnectTimer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 5000);
      };

      ws.onerror = (e) => {
        console.warn("[velxor-ws] error", e);
        ws?.close();
      };
    };

    connect();

    return () => {
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);
}

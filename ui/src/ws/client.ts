import { useEffect } from "react";

export function useVelxorWs(onMessage: (m: any) => void) {
  useEffect(() => {
    let lastSeq = 0;
    let backoff = 250;
    let alive = true;

    const connect = () => {
      if (!alive) return;
      const ws = new WebSocket(`ws://127.0.0.1:7000?last_seq=${lastSeq}`);
      ws.onopen = () => { backoff = 250; };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.seq <= lastSeq) return;
        lastSeq = m.seq;
        onMessage(m);
      };
      ws.onclose = () => { setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 5000); };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => { alive = false; };
  }, [onMessage]);
}
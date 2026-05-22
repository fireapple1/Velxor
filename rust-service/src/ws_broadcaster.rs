use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, Mutex};
use futures_util::SinkExt;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct WsMessage {
    pub schema_version: String,
    pub seq: u64,
    pub r#type: String,
    pub payload: serde_json::Value,
}

#[derive(Clone)]
pub struct ReplayBuffer {
    inner: Arc<Mutex<VecDeque<(Instant, WsMessage)>>>,
    ttl: Duration,
}

impl ReplayBuffer {
    pub fn new(ttl: Duration) -> Self {
        Self { inner: Arc::new(Mutex::new(VecDeque::with_capacity(2048))), ttl }
    }
    pub async fn push(&self, m: WsMessage) {
        let now = Instant::now();
        let mut q = self.inner.lock().await;
        q.push_back((now, m));
        while let Some((t, _)) = q.front() {
            if now.duration_since(*t) > self.ttl { q.pop_front(); } else { break; }
        }
    }

    /// Atomically snapshot backlog, front_seq, and head_seq under a single lock acquisition.
    /// Eliminates the three-lock race where a producer push between calls could produce
    /// an inconsistent head_seq vs actual backlog tail.
    pub async fn snapshot(&self, last_seq: u64) -> (Vec<WsMessage>, u64, u64) {
        let q = self.inner.lock().await;
        let backlog: Vec<WsMessage> = q
            .iter()
            .filter(|(_, m)| m.seq > last_seq)
            .map(|(_, m)| m.clone())
            .collect();
        let front = q.front().map(|(_, m)| m.seq).unwrap_or(0);
        let head = q.back().map(|(_, m)| m.seq).unwrap_or(0);
        (backlog, front, head)
    }

    #[allow(dead_code)]
    pub async fn since(&self, last_seq: u64) -> Vec<WsMessage> {
        self.inner.lock().await.iter()
            .filter(|(_, m)| m.seq > last_seq).map(|(_, m)| m.clone()).collect()
    }
    #[allow(dead_code)]
    pub async fn head_seq(&self) -> u64 {
        self.inner.lock().await.back().map(|(_, m)| m.seq).unwrap_or(0)
    }
    #[allow(dead_code)]
    pub async fn front_seq(&self) -> u64 {
        self.inner.lock().await.front().map(|(_, m)| m.seq).unwrap_or(0)
    }
}

#[allow(clippy::result_large_err)]
pub async fn run(tx: broadcast::Sender<WsMessage>, replay: ReplayBuffer, port: u16) -> anyhow::Result<()> {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    tracing::info!(port, "ws server listening");
    loop {
        let (stream, _) = listener.accept().await?;
        let tx2 = tx.clone();
        let rep2 = replay.clone();
        tokio::spawn(async move {
            use tokio_tungstenite::tungstenite::Message;
            use std::sync::Arc;
            use std::sync::atomic::{AtomicU64, Ordering};
            let last_seq_atom = Arc::new(AtomicU64::new(0));
            let last_seq_atom2 = last_seq_atom.clone();
            let ws = tokio_tungstenite::accept_hdr_async(stream, move |req: &tokio_tungstenite::tungstenite::handshake::server::Request, resp: tokio_tungstenite::tungstenite::handshake::server::Response| {
                // parse ?last_seq=N from URI query
                let uri = req.uri().to_string();
                let last_seq: u64 = url::Url::parse(&format!("ws://x{}", uri)).ok()
                    .and_then(|u| u.query_pairs().find(|(k, _)| k == "last_seq").map(|(_, v)| v.to_string()))
                    .and_then(|v| v.parse().ok()).unwrap_or(0);
                tracing::info!(last_seq, "ws client connecting");
                last_seq_atom2.store(last_seq, Ordering::Relaxed);
                Ok(resp)
            }).await;
            let last_seq = last_seq_atom.load(Ordering::Relaxed);
            let mut ws = match ws {
                Ok(w) => w,
                Err(e) => { tracing::warn!("ws handshake error: {e}"); return; }
            };
            // Subscribe FIRST so no live message is missed between snapshot and subscribe (race-free).
            // Any message produced between subscribe (T1) and snapshot (T2) enters both rx and the
            // replay buffer; the live loop dedupes by seq against backlog_max_seq.
            let mut rx = tx2.subscribe();

            // Single lock acquisition for backlog + front + head (fix H).
            let (backlog, front_seq, head_seq) = rep2.snapshot(last_seq).await;

            // Gap detection (schema §4.3): if the buffer's oldest surviving message is beyond
            // last_seq+1, then messages were evicted (5s TTL) before this client could replay them.
            // Emit a synthetic gap meta-message (seq=0, out-of-band) so the UI can full-refresh.
            if last_seq > 0 && front_seq > last_seq + 1 {
                let gap = WsMessage {
                    schema_version: "1.0".into(),
                    // seq=0 signals an out-of-band meta-message; not part of the monotonic sequence.
                    seq: 0,
                    r#type: "gap".into(),
                    payload: serde_json::json!({
                        "from": last_seq + 1,
                        "to": head_seq,
                    }),
                };
                match serde_json::to_string(&gap) {
                    Ok(json) => {
                        if ws.send(Message::Text(json.into())).await.is_err() {
                            return;
                        }
                    }
                    Err(e) => { tracing::warn!("gap serialize error: {e}"); }
                }
            }

            // Send replay backlog (messages with seq > last_seq).
            let backlog_max_seq = backlog.last().map(|m| m.seq).unwrap_or(last_seq);
            // Track the most recent seq successfully written to the WS so we can emit a
            // synthetic gap on broadcast lag. Initialize to the backlog tail.
            let mut last_sent_seq: u64 = backlog_max_seq;
            for msg in backlog {
                let msg_seq = msg.seq;
                let msg_type = msg.r#type.clone();
                // AC4 §5.2: ws_sent_ts emit (backlog 재전송 경로). live recv 경로에도 동일 emit.
                tracing::info!(ws_sent_ts = crate::time_ms(), seq = msg_seq, msg_type = %msg_type, src = "backlog", "ws_out");
                if let Ok(json) = serde_json::to_string(&msg)
                    && ws.send(Message::Text(json.into())).await.is_err()
                {
                    return;
                }
                last_sent_seq = msg_seq;
            }

            // Forward live broadcast messages. Skip any seq already covered by the backlog
            // to dedupe messages that entered both rx and replay between T1 and T2.
            let mut lagged_pending: bool = false;
            loop {
                match rx.recv().await {
                    Ok(msg) => {
                        if msg.seq <= backlog_max_seq {
                            // Already sent via replay; skip to avoid duplicate.
                            continue;
                        }
                        // On the first successful recv after a Lagged event, emit a synthetic
                        // gap meta-message so the client can detect missing seq range and
                        // refresh instead of silently corrupting its view.
                        if lagged_pending {
                            if msg.seq > last_sent_seq + 1 {
                                let gap = WsMessage {
                                    schema_version: "1.0".into(),
                                    // seq=0 signals an out-of-band meta-message.
                                    seq: 0,
                                    r#type: "gap".into(),
                                    payload: serde_json::json!({
                                        "from": last_sent_seq + 1,
                                        "to": msg.seq - 1,
                                    }),
                                };
                                match serde_json::to_string(&gap) {
                                    Ok(json) => {
                                        if ws.send(Message::Text(json.into())).await.is_err() {
                                            return;
                                        }
                                    }
                                    Err(e) => {
                                        tracing::warn!("gap serialize error: {e}");
                                    }
                                }
                            }
                            lagged_pending = false;
                        }
                        let msg_seq = msg.seq;
                        // AC4 §5.2: ws_sent_ts emit (live path). src="live" 로 backlog 경로와 jq 필터 대칭.
                        tracing::info!(ws_sent_ts = crate::time_ms(), seq = msg_seq, msg_type = %msg.r#type, src = "live", "ws_out");
                        if let Ok(json) = serde_json::to_string(&msg)
                            && ws.send(Message::Text(json.into())).await.is_err()
                        {
                            return;
                        }
                        last_sent_seq = msg_seq;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!(n, "ws client lagged");
                        lagged_pending = true;
                        continue;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
    }
}

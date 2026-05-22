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
    pub async fn since(&self, last_seq: u64) -> Vec<WsMessage> {
        self.inner.lock().await.iter()
            .filter(|(_, m)| m.seq > last_seq).map(|(_, m)| m.clone()).collect()
    }
    pub async fn head_seq(&self) -> u64 {
        self.inner.lock().await.back().map(|(_, m)| m.seq).unwrap_or(0)
    }
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

            // Snapshot replay after subscribing so we can detect eviction gaps.
            // TODO(§4.7 stress): three separate lock acquisitions; producer may push between
            //   them so head_seq in gap payload could exceed actual backlog tail. Combine into
            //   one ReplayBuffer::snapshot(last_seq) -> (Vec<WsMessage>, front, head).
            let backlog = rep2.since(last_seq).await;
            let front_seq = rep2.front_seq().await;
            let head_seq = rep2.head_seq().await;

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
            for msg in backlog {
                if let Ok(json) = serde_json::to_string(&msg)
                    && ws.send(Message::Text(json.into())).await.is_err()
                {
                    return;
                }
            }

            // Forward live broadcast messages. Skip any seq already covered by the backlog
            // to dedupe messages that entered both rx and replay between T1 and T2.
            loop {
                match rx.recv().await {
                    Ok(msg) => {
                        if msg.seq <= backlog_max_seq {
                            // Already sent via replay; skip to avoid duplicate.
                            continue;
                        }
                        if let Ok(json) = serde_json::to_string(&msg)
                            && ws.send(Message::Text(json.into())).await.is_err()
                        {
                            return;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        // TODO(§4.7 stress): Lagged silently drops n messages from this client's
                        //   view — no gap meta-message is emitted, so client believes stream is
                        //   contiguous. Emit a gap WsMessage or disconnect to force reconnect.
                        tracing::warn!(n, "ws client lagged");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
    }
}

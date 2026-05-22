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
    #[allow(dead_code)]
    pub async fn head_seq(&self) -> u64 {
        self.inner.lock().await.back().map(|(_, m)| m.seq).unwrap_or(0)
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
            // TODO(week4-5 §4.4): subscribe BEFORE snapshot to close T1<T2<T3 race
            //   between replay.since() and tx.subscribe(); dedupe overlap by seq.
            // TODO(week4-5 §4.4): if front_seq > last_seq + 1 && last_seq > 0, emit
            //   {type:"gap", from:last_seq+1, to:head_seq} per schema §4.3.
            // Send replay backlog first
            let backlog = rep2.since(last_seq).await;
            for msg in backlog {
                if let Ok(json) = serde_json::to_string(&msg)
                    && ws.send(Message::Text(json.into())).await.is_err()
                {
                    return;
                }
            }
            // Forward live broadcast messages
            let mut rx = tx2.subscribe();
            loop {
                match rx.recv().await {
                    Ok(msg) => {
                        if let Ok(json) = serde_json::to_string(&msg)
                            && ws.send(Message::Text(json.into())).await.is_err()
                        {
                            return;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!(n, "ws client lagged");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
    }
}

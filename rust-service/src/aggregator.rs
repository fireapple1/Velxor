use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use tokio::sync::broadcast;

use crate::classifier_client;
use crate::ws_broadcaster::WsMessage;

const WINDOW_SECS: u64 = 5;
const BURST_WINDOW_SECS: u64 = 1;
const FILE_WRITE_BURST: usize = 50;
const FILE_RENAME_BURST: usize = 30;
const CLASSIFY_DEBOUNCE_SECS: u64 = 1;

pub struct PidWindow {
    pub file_writes: Vec<Instant>,
    pub file_renames: Vec<Instant>,
    pub recent_events: VecDeque<(Instant, serde_json::Value)>,
}

impl PidWindow {
    pub fn new() -> Self {
        Self {
            file_writes: Vec::new(),
            file_renames: Vec::new(),
            recent_events: VecDeque::new(),
        }
    }

    pub fn add(&mut self, event_type: &str, event_payload: serde_json::Value, now: Instant) {
        match event_type {
            "FileWrite" => self.file_writes.push(now),
            "FileRename" => self.file_renames.push(now),
            _ => {}
        }
        self.recent_events.push_back((now, event_payload));
        self.prune(now);
    }

    fn prune(&mut self, now: Instant) {
        let cutoff = std::time::Duration::from_secs(WINDOW_SECS);
        self.file_writes.retain(|t| now.duration_since(*t) < cutoff);
        self.file_renames.retain(|t| now.duration_since(*t) < cutoff);
        while let Some((t, _)) = self.recent_events.front() {
            if now.duration_since(*t) >= cutoff {
                self.recent_events.pop_front();
            } else {
                break;
            }
        }
    }

    pub fn burst_1s(&self, now: Instant) -> bool {
        let one_sec = std::time::Duration::from_secs(BURST_WINDOW_SECS);
        let writes = self.file_writes.iter().filter(|t| now.duration_since(**t) < one_sec).count();
        let renames = self.file_renames.iter().filter(|t| now.duration_since(**t) < one_sec).count();
        writes >= FILE_WRITE_BURST || renames >= FILE_RENAME_BURST
    }

    pub fn events_last_1s(&self, now: Instant) -> Vec<serde_json::Value> {
        let one_sec = std::time::Duration::from_secs(BURST_WINDOW_SECS);
        self.recent_events
            .iter()
            .filter(|(t, _)| now.duration_since(*t) < one_sec)
            .map(|(_, v)| v.clone())
            .collect()
    }
}

pub async fn run(
    mut rx: broadcast::Receiver<WsMessage>,
    tx: broadcast::Sender<WsMessage>,
    seq: Arc<AtomicU64>,
) -> anyhow::Result<()> {
    // TODO(§4.7 stress): prune Aggregator entries whose recent_events is empty after prune — currently unbounded under PID churn.
    let mut windows: HashMap<u32, PidWindow> = HashMap::new();
    let cache = Arc::new(classifier_client::VerdictCache::new());
    // TODO(§4.7 stress): debounce starts at trigger time, not response time — under classifier slowdown, consecutive fires gap ~820ms instead of full 1s. Pair with an in-flight HashSet<pid> guard.
    let mut last_classify_at: HashMap<u32, Instant> = HashMap::new();

    loop {
        match rx.recv().await {
            Ok(msg) if msg.r#type == "node_add" => {
                // burst window measured at aggregator receipt time, not collector emission
                // (ts_unix_ms could be used but receipt time is robust to clock skew).
                let now = Instant::now();

                let pid: u32 = match msg.payload.get("pid").and_then(|v| v.as_u64()) {
                    Some(p) => p as u32,
                    None => continue,
                };
                let event_type = match msg.payload.get("event_type").and_then(|v| v.as_str()) {
                    Some(t) => t.to_string(),
                    None => continue,
                };

                let window = windows.entry(pid).or_insert_with(PidWindow::new);
                window.add(&event_type, msg.payload.clone(), now);

                if window.burst_1s(now) {
                    // Dedup: skip if last classify was < 1s ago for this PID
                    let should_classify = match last_classify_at.get(&pid) {
                        Some(last) => now.duration_since(*last) >= std::time::Duration::from_secs(CLASSIFY_DEBOUNCE_SECS),
                        None => true,
                    };

                    if should_classify {
                        last_classify_at.insert(pid, now);
                        // TODO(§4.7 stress): payload clones (~15KB/burst) — switch to Arc<serde_json::Value> if profiling shows hotspot.
                        let events = window.events_last_1s(now);
                        let tx2 = tx.clone();
                        let seq2 = seq.clone();
                        let cache2 = cache.clone();

                        // TODO(§4.7 stress): detached classify task — on shutdown the spawned future may leak until reqwest timeout. Consider JoinSet + abort or CancellationToken.
                        tokio::spawn(async move {
                            match classifier_client::classify_with_cache(&cache2, pid, &events, 1000).await {
                                Ok(result) => {
                                    let s = seq2.fetch_add(1, Ordering::Relaxed);
                                    let verdict_msg = WsMessage {
                                        schema_version: "1.0".to_string(),
                                        seq: s,
                                        r#type: "verdict".to_string(),
                                        payload: result,
                                    };
                                    // Ignore send error — no subscribers is not fatal
                                    let _ = tx2.send(verdict_msg);
                                }
                                Err(e) => {
                                    tracing::warn!(error=%e, pid, "classify failed");
                                }
                            }
                        });
                    }
                }
            }
            Ok(msg) => {
                // r#type filter at line ~92 covers "node_add"; any other type
                // (e.g., our own "verdict" emission) returns here.
                // SAFETY: do not re-emit on this path — that would create a feedback loop.
                debug_assert!(msg.r#type != "node_add");
            }
            Err(broadcast::error::RecvError::Lagged(n)) => {
                tracing::warn!(n, "aggregator lagged");
            }
            Err(broadcast::error::RecvError::Closed) => break,
        }
    }

    Ok(())
}

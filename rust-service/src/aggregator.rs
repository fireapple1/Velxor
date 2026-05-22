use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use tokio::sync::broadcast;
use tokio::task::JoinSet;

use crate::classifier_client;
use crate::ws_broadcaster::{ReplayBuffer, WsMessage};

const WINDOW_SECS: u64 = 5;
const BURST_WINDOW_SECS: u64 = 1;
const FILE_WRITE_BURST: usize = 50;
const FILE_RENAME_BURST: usize = 30;
const CLASSIFY_DEBOUNCE_SECS: u64 = 1;
const PRUNE_INTERVAL_SECS: u64 = 30;

pub struct PidWindow {
    pub file_writes: Vec<Instant>,
    pub file_renames: Vec<Instant>,
    pub recent_events: VecDeque<(Instant, Arc<serde_json::Value>)>,
}

impl PidWindow {
    pub fn new() -> Self {
        Self {
            file_writes: Vec::new(),
            file_renames: Vec::new(),
            recent_events: VecDeque::new(),
        }
    }

    pub fn add(&mut self, event_type: &str, event_payload: Arc<serde_json::Value>, now: Instant) {
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

    pub fn events_last_1s(&self, now: Instant) -> Vec<Arc<serde_json::Value>> {
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
    replay: ReplayBuffer,
) -> anyhow::Result<()> {
    let mut windows: HashMap<u32, PidWindow> = HashMap::new();
    let cache = Arc::new(classifier_client::VerdictCache::new());
    let mut last_classify_at: HashMap<u32, Instant> = HashMap::new();
    // in_flight: PIDs with a classify task currently running — guards against
    // response-time gaps shorter than 1s when the classifier is slow (fix I).
    let in_flight: Arc<tokio::sync::Mutex<HashSet<u32>>> =
        Arc::new(tokio::sync::Mutex::new(HashSet::new()));
    let mut last_prune_at: Instant = Instant::now();
    let prune_interval = std::time::Duration::from_secs(PRUNE_INTERVAL_SECS);
    // JoinSet holds all classify tasks; drop → abort all on shutdown (fix K).
    let mut join_set: JoinSet<()> = JoinSet::new();

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
                // Wrap payload in Arc to avoid deep-cloning 15KB per burst (fix J).
                window.add(&event_type, Arc::new(msg.payload.clone()), now);

                if window.burst_1s(now) {
                    // Debounce: skip if last classify was < 1s ago for this PID.
                    let debounce_ok = match last_classify_at.get(&pid) {
                        Some(last) => now.duration_since(*last) >= std::time::Duration::from_secs(CLASSIFY_DEBOUNCE_SECS),
                        None => true,
                    };
                    // in-flight guard: skip if a classify is already running for this PID (fix I).
                    let already_running = in_flight.lock().await.contains(&pid);

                    if debounce_ok && !already_running {
                        last_classify_at.insert(pid, now);
                        in_flight.lock().await.insert(pid);

                        let events = window.events_last_1s(now);
                        let tx2 = tx.clone();
                        let seq2 = seq.clone();
                        let cache2 = cache.clone();
                        let in_flight2 = in_flight.clone();
                        let replay2 = replay.clone();

                        // JoinSet: tasks are aborted on shutdown when join_set is dropped (fix K).
                        join_set.spawn(async move {
                            match classifier_client::classify_with_cache(&cache2, pid, &events, 1000).await {
                                Ok(result) => {
                                    // Fix B: auto-block when VELXOR_AUTOBLOCK is set and verdict=ransomware.
                                    if result.get("verdict") == Some(&serde_json::Value::String("ransomware".into()))
                                        && std::env::var("VELXOR_AUTOBLOCK").is_ok()
                                    {
                                        let block_result = crate::blocker::block_pid(pid as i32).await;
                                        let alert_s = seq2.fetch_add(1, Ordering::Relaxed);
                                        let alert_msg = WsMessage {
                                            schema_version: "1.0".to_string(),
                                            seq: alert_s,
                                            r#type: "alert".to_string(),
                                            payload: serde_json::json!({
                                                "block_result": block_result,
                                                "reason": "auto_block_ransomware",
                                            }),
                                        };
                                        replay2.push(alert_msg.clone()).await;
                                        let _ = tx2.send(alert_msg);
                                    }

                                    let s = seq2.fetch_add(1, Ordering::Relaxed);
                                    let verdict_msg = WsMessage {
                                        schema_version: "1.0".to_string(),
                                        seq: s,
                                        r#type: "verdict".to_string(),
                                        payload: result,
                                    };
                                    replay2.push(verdict_msg.clone()).await;
                                    // Ignore send error — no subscribers is not fatal
                                    let _ = tx2.send(verdict_msg);
                                }
                                Err(e) => {
                                    tracing::warn!(error=%e, pid, "classify failed");
                                }
                            }
                            in_flight2.lock().await.remove(&pid);
                        });
                    }
                }

                // Non-blocking reap of completed JoinSet tasks to prevent internal Vec growth.
                while join_set.try_join_next().is_some() {}
            }
            Ok(msg) => {
                // r#type filter covers "node_add"; any other type (e.g. "verdict", "alert")
                // returns here. SAFETY: do not re-emit — that would create a feedback loop.
                debug_assert!(msg.r#type != "node_add");
            }
            Err(broadcast::error::RecvError::Lagged(n)) => {
                // TODO(§4.7 stress): under broadcast lag we lose n events from the windows
                //   count, undercounting burst rate. Emit a synthetic "lag" alert and inflate
                //   the dropped_since_last counter accordingly.
                tracing::warn!(n, "aggregator lagged");
            }
            Err(broadcast::error::RecvError::Closed) => break,
        }

        // Periodic prune to bound HashMap growth under PID churn. Coupled to windows
        // cleanup so an actively-bursting PID (window kept warm) keeps its debounce state.
        let now = Instant::now();
        if now.duration_since(last_prune_at) >= prune_interval {
            last_prune_at = now;
            let mut dead: Vec<u32> = Vec::new();
            for (pid, win) in windows.iter_mut() {
                win.prune(now);
                if win.recent_events.is_empty()
                    && win.file_writes.is_empty()
                    && win.file_renames.is_empty()
                {
                    dead.push(*pid);
                }
            }
            let pruned_count = dead.len();
            for pid in &dead {
                windows.remove(pid);
                last_classify_at.remove(pid);
            }
            tracing::debug!(pruned_count, "aggregator prune");
        }
    }

    Ok(())
}

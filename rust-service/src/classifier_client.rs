use std::collections::HashMap;
use std::sync::{Arc, Mutex}; // std (not tokio) — no await held across lock, sub-µs ops
use std::time::{Duration, Instant};

const MAX_ENTRIES: usize = 4096;

pub struct VerdictCache {
    inner: Mutex<HashMap<u32, (Instant, serde_json::Value)>>,
    last_sweep: Mutex<Instant>,
}

impl VerdictCache {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            last_sweep: Mutex::new(Instant::now()),
        }
    }

    pub fn get(&self, pid: u32) -> Option<serde_json::Value> {
        let mut g = self.inner.lock().ok()?;
        let (t, v) = g.get(&pid)?.clone();
        if t.elapsed() < Duration::from_secs(1) {
            Some(v)
        } else {
            // Evict expired entry on read — prevents stale map growth
            g.remove(&pid);
            None
        }
    }

    pub fn put(&self, pid: u32, v: serde_json::Value) {
        let Ok(mut g) = self.inner.lock() else { return };
        g.insert(pid, (Instant::now(), v));

        let over_limit = g.len() > MAX_ENTRIES;
        let time_due = self
            .last_sweep
            .lock()
            .map(|ls| ls.elapsed() > Duration::from_secs(30))
            .unwrap_or(false);

        if over_limit || time_due {
            // Evict all entries with elapsed >= 1s (TTL).
            g.retain(|_, (t, _)| t.elapsed() < Duration::from_secs(1));

            // If still over limit, evict oldest entries to reach ~90% of MAX_ENTRIES.
            if g.len() > MAX_ENTRIES {
                let target = (MAX_ENTRIES as f64 * 0.9) as usize;
                let mut order: Vec<(u32, Instant)> =
                    g.iter().map(|(&k, (t, _))| (k, *t)).collect();
                order.sort_unstable_by_key(|(_, t)| *t);
                let to_remove = g.len().saturating_sub(target);
                for (k, _) in order.iter().take(to_remove) {
                    g.remove(k);
                }
            }

            if let Ok(mut ls) = self.last_sweep.lock() {
                *ls = Instant::now();
            }
        }
    }
}

pub async fn classify_with_cache(
    cache: &VerdictCache,
    pid: u32,
    events: &[Arc<serde_json::Value>],
    window_ms: u32,
) -> anyhow::Result<serde_json::Value> {
    if let Some(v) = cache.get(pid) {
        return Ok(v);
    }
    let v = classify(events, window_ms).await?;
    cache.put(pid, v.clone());
    Ok(v)
}

pub async fn classify(
    events: &[Arc<serde_json::Value>],
    window_ms: u32,
) -> anyhow::Result<serde_json::Value> {
    let url = std::env::var("VELXOR_CLASSIFIER_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:8765/classify".to_string());
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(200))
        .build()?;
    let events_ref: Vec<&serde_json::Value> = events.iter().map(|a| a.as_ref()).collect();
    let body = serde_json::json!({ "events": events_ref, "window_ms": window_ms });
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await?
        .json::<serde_json::Value>()
        .await?;
    Ok(resp)
}

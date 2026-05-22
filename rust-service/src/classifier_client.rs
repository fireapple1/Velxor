use std::collections::HashMap;
use std::sync::Mutex; // std (not tokio) — no await held across lock, sub-µs ops
use std::time::{Duration, Instant};

pub struct VerdictCache {
    // TODO(§4.7): periodic eviction sweep for cold PIDs
    // TODO(§4.7): bound HashMap size (unbounded under high PID churn)
    inner: Mutex<HashMap<u32, (Instant, serde_json::Value)>>,
}

impl VerdictCache {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
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
        if let Ok(mut g) = self.inner.lock() {
            g.insert(pid, (Instant::now(), v));
        }
    }
}

pub async fn classify_with_cache(
    cache: &VerdictCache,
    pid: u32,
    events: &[serde_json::Value],
    window_ms: u32,
) -> anyhow::Result<serde_json::Value> {
    if let Some(v) = cache.get(pid) {
        return Ok(v);
    }
    let v = classify(events, window_ms).await?;
    cache.put(pid, v.clone());
    Ok(v)
}

pub async fn classify(events: &[serde_json::Value], window_ms: u32) -> anyhow::Result<serde_json::Value> {
    let url = std::env::var("VELXOR_CLASSIFIER_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:8765/classify".to_string());
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(200))
        .build()?;
    let body = serde_json::json!({ "events": events, "window_ms": window_ms });
    let resp = client
        .post(&url)
        .json(&body).send().await?
        .json::<serde_json::Value>().await?;
    Ok(resp)
}

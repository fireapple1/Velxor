use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock}; // std (not tokio) — no await held across lock, sub-µs ops
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

/// Module-static reqwest client — `Client::builder()` triggers TLS init + DNS
/// resolver setup which is non-trivial; in the hot path (every burst) we want
/// to amortize that to once-per-process. 200ms timeout matches schema §2.3.
fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_millis(200))
            .build()
            .expect("reqwest::Client::build must succeed at startup")
    })
}

/// Module-static classifier URL — env::var() is a syscall + heap alloc; cache
/// at first access. VELXOR_CLASSIFIER_URL is read once per process lifetime.
fn classify_url() -> &'static str {
    static URL: OnceLock<String> = OnceLock::new();
    URL.get_or_init(|| {
        std::env::var("VELXOR_CLASSIFIER_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8765/classify".to_string())
    })
}

/// Eagerly initialize module statics at startup so any TLS / DNS resolver init
/// failure surfaces at boot (panic in main) instead of first-burst spawn task
/// (silent loss — JoinSet aborts the task). Called once from main.rs.
pub fn init() {
    let _ = http_client();
    let _ = classify_url();
}

pub async fn classify(
    events: &[Arc<serde_json::Value>],
    window_ms: u32,
) -> anyhow::Result<serde_json::Value> {
    let events_ref: Vec<&serde_json::Value> = events.iter().map(|a| a.as_ref()).collect();
    let body = serde_json::json!({ "events": events_ref, "window_ms": window_ms });
    let resp = http_client()
        .post(classify_url())
        .json(&body)
        .send()
        .await?
        .json::<serde_json::Value>()
        .await?;
    Ok(resp)
}

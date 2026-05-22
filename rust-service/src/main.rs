mod blocker;
mod collector_source;
mod aggregator;
mod classifier_client;
mod fanotify_adapter;
mod ws_broadcaster;

use std::sync::Arc;
use std::sync::atomic::AtomicU64;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::broadcast;

/// AC4 tracing helper — unix-millis timestamp. Used by §5.2 instrumentation
/// (`event_received_ts` / `ws_sent_ts` / `classify_start_ts` / `classify_end_ts`).
/// Worker-C parses these from `logs/trace.json` to compute p99 latencies
/// (`scripts/eval-ac4.sh`).
pub fn time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().json().with_env_filter("info").init();

    // Eager init of classifier_client OnceLocks — TLS/DNS init 실패가 첫 burst
    // 가 아닌 boot 에서 surface 되도록 (review followup).
    classifier_client::init();

    let (tx, _rx) = broadcast::channel::<ws_broadcaster::WsMessage>(1024);
    let replay = ws_broadcaster::ReplayBuffer::new(std::time::Duration::from_secs(5));

    let seq = Arc::new(AtomicU64::new(1));
    let collector_seq = seq.clone();
    let agg_seq = seq.clone();

    let ws   = tokio::spawn(ws_broadcaster::run(tx.clone(), replay.clone(), 7000));
    let src  = tokio::spawn(collector_source::run(tx.clone(), replay.clone(), collector_seq));
    let agg  = tokio::spawn(aggregator::run(tx.subscribe(), tx.clone(), agg_seq, replay.clone()));
    let http = tokio::spawn(blocker::run_http_server(7001));

    tokio::select! {
        r = ws   => r??,
        r = src  => r??,
        r = agg  => r??,
        r = http => r??,
    }
    Ok(())
}

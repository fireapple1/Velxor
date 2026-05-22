mod blocker;
mod collector_source;
mod aggregator;
mod classifier_client;
mod fanotify_adapter;
mod ws_broadcaster;

use std::sync::Arc;
use std::sync::atomic::AtomicU64;
use tokio::sync::broadcast;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().json().with_env_filter("info").init();

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

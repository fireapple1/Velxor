mod collector_source;
mod aggregator;
mod classifier_client;
mod fanotify_adapter;
mod ws_broadcaster;

use tokio::sync::broadcast;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().json().with_env_filter("info").init();

    let (tx, _rx) = broadcast::channel::<ws_broadcaster::WsMessage>(1024);
    let replay = ws_broadcaster::ReplayBuffer::new(std::time::Duration::from_secs(5));

    let ws  = tokio::spawn(ws_broadcaster::run(tx.clone(), replay.clone(), 7000));
    let src = tokio::spawn(collector_source::run(tx.clone(), replay.clone()));

    tokio::select! {
        r = ws  => r??,
        r = src => r??,
    }
    Ok(())
}

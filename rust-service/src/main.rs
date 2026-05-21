mod collector_source;

use tokio::sync::mpsc;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let (tx, mut rx) = mpsc::channel(1024);

    tokio::spawn(collector_source::start(tx));

    while let Some(event) = rx.recv().await {
        tracing::info!(?event);
    }
}

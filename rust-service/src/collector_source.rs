use std::path::Path;
use std::time::Duration;
use tokio::sync::broadcast;
use crate::ws_broadcaster::{ReplayBuffer, WsMessage};

pub async fn run(tx: broadcast::Sender<WsMessage>, replay: ReplayBuffer) -> anyhow::Result<()> {
    let mode = std::env::var("VELXOR_STUB").unwrap_or_default();
    if mode == "collector" || mode == "both" {
        return poll_events_jsonl(tx, replay).await;
    }
    // Week 4-5 §4.1: real libfanotify adapter. Seq starts at 1 and is monotonic
    // for the process lifetime (the adapter owns its own counter from here).
    crate::fanotify_adapter::run_fanotify(tx, replay, 1).await
}

async fn poll_events_jsonl(tx: broadcast::Sender<WsMessage>, replay: ReplayBuffer) -> anyhow::Result<()> {
    let path_str = std::env::var("VELXOR_EVENTS_PATH").unwrap_or_else(|_| "events.jsonl".to_string());
    let path = Path::new(&path_str);
    let mut offset: u64 = 0;
    let mut seq: u64 = 1;
    let mut dropped_since_last: u32 = 0;
    loop {
        if path.exists() {
            let content = tokio::fs::read_to_string(path).await.unwrap_or_default();
            let bytes = content.as_bytes();
            if (bytes.len() as u64) > offset {
                let slice = &bytes[offset as usize..];
                // Only process up to the last newline to avoid partial-line corruption
                let consume_len = match slice.iter().rposition(|&b| b == b'\n') {
                    Some(p) => p + 1,
                    None => {
                        // No complete line yet — don't advance offset
                        tokio::time::sleep(Duration::from_millis(200)).await;
                        continue;
                    }
                };
                let complete = std::str::from_utf8(&slice[..consume_len]).unwrap_or_default();
                for line in complete.lines() {
                    if line.trim().is_empty() { continue; }
                    if let Ok(ev) = serde_json::from_str::<serde_json::Value>(line) {
                        let msg = WsMessage {
                            schema_version: "1.0".into(),
                            seq,
                            r#type: "node_add".into(),
                            payload: ev,
                        };
                        replay.push(msg.clone()).await;
                        if tx.send(msg).is_err() {
                            dropped_since_last += 1;
                        } else if dropped_since_last > 0 {
                            tracing::warn!(dropped_since_last, "broadcast lag");
                            dropped_since_last = 0;
                        }
                        seq += 1;
                    }
                }
                offset += consume_len as u64;
            }
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

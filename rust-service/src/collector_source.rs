use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufRead, BufReader};
use tokio::sync::mpsc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BehaviorEventV1 {
    pub schema_version: String,
    pub seq: u64,
    pub dropped_since_last: u32,
    pub pid: u32,
    pub parent_pid: u32,
    pub image_path: String,
    pub event_type: String,
    pub file_path: Option<String>,
    pub ts_unix_ms: u64,
}

pub async fn start(tx: mpsc::Sender<BehaviorEventV1>) {
    let stub = std::env::var("VELXOR_STUB").unwrap_or_default();

    if stub == "collector" || stub == "both" {
        // stub 모드: events.jsonl 폴링
        let path = std::env::var("VELXOR_EVENTS_PATH")
            .unwrap_or_else(|_| "../events.jsonl".to_string());
        let mut lines_sent: usize = 0;
        loop {
            if let Ok(file) = File::open(&path) {
                let reader = BufReader::new(file);
                for line in reader.lines().flatten().skip(lines_sent) {
                    match serde_json::from_str::<BehaviorEventV1>(&line) {
                        Ok(event) => {
                            if tx.send(event).await.is_err() {
                                return;
                            }
                            lines_sent += 1;
                        }
                        Err(e) => {
                            tracing::warn!("JSON 파싱 실패: {e}");
                            lines_sent += 1;
                        }
                    }
                }
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }
    } else {
        // 실제 fanotify — Week 4-5에 구현
        todo!("fanotify 본구현")
    }
}

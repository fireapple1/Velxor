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

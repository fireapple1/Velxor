// SIGTERM → 200ms wait → SIGKILL fallback per CLAUDE.md kill sequence.
// TODO(week8-9 §5.1): aggregator can call block_pid directly when VELXOR_AUTOBLOCK is set + verdict=ransomware.

use std::time::Duration;

use axum::{Json, Router, extract::Path, routing::post};
use nix::sys::signal::{Signal, kill};
use nix::unistd::Pid;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Killed,
    Terminated,
    AlreadyGone,
    Eperm,
    Invalid,
    Error,
}

#[derive(Debug, serde::Serialize)]
pub struct BlockResult {
    pub pid: i32,
    /// Outcome of the block attempt: "killed" | "terminated" | "already_gone" | "eperm" | "invalid" | "error"
    pub outcome: Outcome,
}

/// Send SIGTERM to `pid`, wait 200 ms, then SIGKILL if the process still exists.
///
/// EPERM note: a service running as non-root targeting pid=1 (init) will receive EPERM.
/// In production, CAP_KILL is required to block arbitrary user processes.
pub async fn block_pid(pid: i32) -> BlockResult {
    if pid <= 1 {
        tracing::warn!(pid, "block: rejected invalid pid (<=1 hits init or process group)");
        return BlockResult { pid, outcome: Outcome::Invalid };
    }

    let p = Pid::from_raw(pid);

    // TODO(post-demo): use pidfd_open + pidfd_send_signal (Linux 5.3+, libc::syscall)
    //   for race-free signaling. Current SIGTERM → 200ms → SIGKILL can hit a recycled pid.
    match kill(p, Signal::SIGTERM) {
        Ok(_) => {
            // Wait 200 ms for graceful exit.
            tokio::time::sleep(Duration::from_millis(200)).await;

            // Signal 0 probes existence without sending a real signal.
            match kill(p, None) {
                Ok(_) => {
                    // Process still alive — escalate to SIGKILL.
                    let _ = kill(p, Signal::SIGKILL);
                    BlockResult { pid, outcome: Outcome::Killed }
                }
                Err(_) => {
                    // Process already gone after SIGTERM.
                    BlockResult { pid, outcome: Outcome::Terminated }
                }
            }
        }
        Err(nix::errno::Errno::EPERM) => {
            tracing::warn!(pid, "block: EPERM (insufficient capability — CAP_KILL required)");
            BlockResult { pid, outcome: Outcome::Eperm }
        }
        Err(nix::errno::Errno::ESRCH) => {
            // No such process.
            BlockResult { pid, outcome: Outcome::AlreadyGone }
        }
        Err(e) => {
            tracing::warn!(pid, error = %e, "block: kill failed");
            BlockResult { pid, outcome: Outcome::Error }
        }
    }
}

/// Axum handler: POST /block/{pid}
async fn block_handler(Path(pid): Path<i32>) -> Json<BlockResult> {
    let result = block_pid(pid).await;
    tracing::info!(pid = result.pid, "block request handled");
    Json(result)
}

// TODO(§4.7 stress / hardening): gate POST /block/{pid} behind a VELXOR_BLOCK_TOKEN
//   shared-secret header. Loopback-only is the floor; token auth is the next layer.

/// Bind HTTP server on 127.0.0.1:{port} and serve the /block/{pid} endpoint.
/// Loopback-only — never bind 0.0.0.0 (security: block endpoint must not be reachable externally).
pub async fn run_http_server(port: u16) -> anyhow::Result<()> {
    let app = Router::new()
        // TODO(§4.7 stress): apply tower::limit::ConcurrencyLimitLayer (cap ~16) to bound
        //   simultaneous block_pid invocations.
        .route("/block/{pid}", post(block_handler));
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    tracing::info!(port, "http server listening (block endpoint)");
    axum::serve(listener, app).await?;
    Ok(())
}

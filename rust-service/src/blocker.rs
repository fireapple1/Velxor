// SIGTERM → 200ms wait → SIGKILL fallback per CLAUDE.md kill sequence.
// Auto-block hook in aggregator.rs::run when VELXOR_AUTOBLOCK is set.

use std::ptr;
use std::time::Duration;

use axum::{Json, Router, extract::Path, http::HeaderMap, routing::post};
use tower::ServiceBuilder;
use tower::limit::ConcurrencyLimitLayer;

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

/// Human-readable form used in alert WsMessage `payload.message` (schema §3.2).
/// JSON serialization → snake_case wire (Outcome enum #[serde(rename_all = "snake_case")]).
impl std::fmt::Display for BlockResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match serde_json::to_string(self) {
            Ok(s) => f.write_str(&s),
            Err(_) => write!(f, "{:?}", self),
        }
    }
}

/// RAII wrapper that closes a pidfd when dropped.
struct Pidfd(i32);

impl Drop for Pidfd {
    fn drop(&mut self) {
        unsafe { libc::close(self.0); }
    }
}

/// Send SIGTERM to `pid`, wait 200 ms, then SIGKILL if the process still exists.
/// Uses pidfd_open + pidfd_send_signal (Linux 5.3+) to avoid pid-recycling races.
/// Falls back to nix::kill if pidfd_open returns EINVAL (kernel < 5.3).
///
/// EPERM note: a service running as non-root targeting pid=1 (init) will receive EPERM.
/// In production, CAP_KILL is required to block arbitrary user processes.
pub async fn block_pid(pid: i32) -> BlockResult {
    if pid <= 1 {
        tracing::warn!(pid, "block: rejected invalid pid (<=1 hits init or process group)");
        return BlockResult { pid, outcome: Outcome::Invalid };
    }

    // Attempt pidfd_open for race-free signaling (Linux 5.3+).
    let raw_pidfd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid as libc::pid_t, 0u32) };

    if raw_pidfd < 0 {
        let err = unsafe { *libc::__errno_location() };
        if err == libc::EINVAL || err == libc::ENOSYS {
            tracing::warn!(errno = err, "pidfd_open unsupported (kernel < 5.3 or bad flags) — fallback to nix::kill");
        } else {
            tracing::warn!(errno = err, "pidfd_open failed — fallback to nix::kill");
        }
        return block_pid_fallback(pid).await;
    }

    let pidfd = Pidfd(raw_pidfd as i32);

    // Send SIGTERM via pidfd.
    let term_ret = unsafe {
        libc::syscall(
            libc::SYS_pidfd_send_signal,
            pidfd.0,
            libc::SIGTERM,
            ptr::null::<libc::siginfo_t>(),
            0u32,
        )
    };

    if term_ret < 0 {
        let err = unsafe { *libc::__errno_location() };
        if err == libc::EPERM {
            tracing::warn!(pid, "block: EPERM (insufficient capability — CAP_KILL required)");
            return BlockResult { pid, outcome: Outcome::Eperm };
        } else if err == libc::ESRCH {
            return BlockResult { pid, outcome: Outcome::AlreadyGone };
        } else {
            tracing::warn!(pid, errno = err, "block: pidfd_send_signal(SIGTERM) failed");
            return BlockResult { pid, outcome: Outcome::Error };
        }
    }

    // Wait 200ms for graceful exit.
    tokio::time::sleep(Duration::from_millis(200)).await;

    // Probe existence: kill(pid, 0) via nix — returns Err if process is gone.
    // NOTE: pidfd_send_signal(fd, 0, ...) is NOT used here because it succeeds
    // for zombie processes (pidfd keeps the struct alive), giving a false "still
    // running" result. nix::kill(p, None) correctly returns ESRCH for zombies.
    let p = nix::unistd::Pid::from_raw(pid);
    if nix::sys::signal::kill(p, None).is_ok() {
        // Still alive — escalate to SIGKILL via pidfd (race-free).
        unsafe {
            libc::syscall(
                libc::SYS_pidfd_send_signal,
                pidfd.0,
                libc::SIGKILL,
                ptr::null::<libc::siginfo_t>(),
                0u32,
            );
        }
        BlockResult { pid, outcome: Outcome::Killed }
    } else {
        // Process already gone after SIGTERM.
        BlockResult { pid, outcome: Outcome::Terminated }
    }
}

async fn block_pid_fallback(pid: i32) -> BlockResult {
    use nix::sys::signal::{Signal, kill};
    use nix::unistd::Pid;

    let p = Pid::from_raw(pid);
    match kill(p, Signal::SIGTERM) {
        Ok(_) => {
            tokio::time::sleep(Duration::from_millis(200)).await;
            match kill(p, None) {
                Ok(_) => {
                    let _ = kill(p, Signal::SIGKILL);
                    BlockResult { pid, outcome: Outcome::Killed }
                }
                Err(_) => BlockResult { pid, outcome: Outcome::Terminated },
            }
        }
        Err(nix::errno::Errno::EPERM) => {
            tracing::warn!(pid, "block: EPERM (insufficient capability — CAP_KILL required)");
            BlockResult { pid, outcome: Outcome::Eperm }
        }
        Err(nix::errno::Errno::ESRCH) => BlockResult { pid, outcome: Outcome::AlreadyGone },
        Err(e) => {
            tracing::warn!(pid, error = %e, "block: kill failed");
            BlockResult { pid, outcome: Outcome::Error }
        }
    }
}

/// Axum handler: POST /block/{pid}
/// Gated behind VELXOR_BLOCK_TOKEN if that env var is set.
async fn block_handler(
    Path(pid): Path<i32>,
    headers: HeaderMap,
) -> Result<Json<BlockResult>, (axum::http::StatusCode, &'static str)> {
    if let Ok(expected) = std::env::var("VELXOR_BLOCK_TOKEN") {
        if expected.is_empty() {
            return Err((axum::http::StatusCode::UNAUTHORIZED, "VELXOR_BLOCK_TOKEN is configured empty — refusing all"));
        }
        // TODO(prod-hardening): use subtle::ConstantTimeEq for token comparison; demo
        //   compares with == which is timing-attackable.
        match headers.get("X-Velxor-Token").and_then(|v| v.to_str().ok()) {
            Some(t) if t == expected => {}
            _ => return Err((axum::http::StatusCode::UNAUTHORIZED, "missing or wrong token")),
        }
    }
    let result = block_pid(pid).await;
    tracing::info!(pid = result.pid, "block request handled");
    Ok(Json(result))
}

/// Bind HTTP server on 127.0.0.1:{port} and serve the /block/{pid} endpoint.
/// Loopback-only — never bind 0.0.0.0 (security: block endpoint must not be reachable externally).
/// Concurrency capped at 16 simultaneous block_pid calls via ConcurrencyLimitLayer.
pub async fn run_http_server(port: u16) -> anyhow::Result<()> {
    let app = Router::new()
        .route("/block/{pid}", post(block_handler))
        .layer(ServiceBuilder::new().layer(ConcurrencyLimitLayer::new(16)));
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    tracing::info!(port, "http server listening (block endpoint)");
    axum::serve(listener, app).await?;
    Ok(())
}

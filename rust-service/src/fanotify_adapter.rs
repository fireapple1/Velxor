// Week 4-5 §4.1: libfanotify adapter for Velxor collector.
// Uses `nix::sys::fanotify` (nix 0.31.3 exposes Fanotify/InitFlags/MarkFlags/MaskFlags
// under the "fanotify" feature). Falls back to FAN_MODIFY|FAN_CLOSE_WRITE|FAN_OPEN_EXEC|
// FAN_RENAME (kernel >= 5.17 / Ubuntu 24.04 kernel 6.8). Blocking fanotify read() runs
// inside `tokio::task::spawn_blocking` so the tokio runtime is never stalled.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use nix::sys::fanotify::{
    EventFFlags, Fanotify, FanotifyEvent, InitFlags, MarkFlags, MaskFlags,
};
use serde_json::json;
use tokio::sync::broadcast;

use crate::ws_broadcaster::{ReplayBuffer, WsMessage};

/// Real fanotify-backed event source. Replaces the `events.jsonl` poll in the
/// non-stub branch of `collector_source::run`.
pub async fn run_fanotify(
    tx: broadcast::Sender<WsMessage>,
    replay: ReplayBuffer,
    seq: Arc<AtomicU64>,
) -> anyhow::Result<()> {
    // Build watch dir under $HOME/velxor-work (never /tmp — CLAUDE.md absolute rule).
    let work = std::env::var("VELXOR_WORK").unwrap_or_else(|_| {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        format!("{home}/velxor-work")
    });
    std::fs::create_dir_all(&work)?;

    let fan = Fanotify::init(InitFlags::FAN_CLASS_NOTIF, EventFFlags::O_RDONLY)?;

    // FAN_RENAME requires kernel >= 5.17. Ubuntu 24.04 ships 6.8 so we always
    // request it; if a future port lands on an older kernel, `mark()` will EINVAL
    // and we'll need to retry without FAN_RENAME (TODO documented below).
    let mask = MaskFlags::FAN_MODIFY
        | MaskFlags::FAN_CLOSE_WRITE
        | MaskFlags::FAN_OPEN_EXEC
        | MaskFlags::FAN_RENAME;

    fan.mark(
        MarkFlags::FAN_MARK_ADD | MarkFlags::FAN_MARK_MOUNT,
        mask,
        // dirfd: AT_FDCWD via BorrowedFd. nix's `mark()` wants something `AsFd`,
        // so we wrap the magic AT_FDCWD value (re-exported by nix::libc).
        // SAFETY: AT_FDCWD is a sentinel accepted by fanotify_mark(2); the
        // kernel never treats it as an open fd, and we never close it.
        unsafe { std::os::fd::BorrowedFd::borrow_raw(nix::libc::AT_FDCWD) },
        Some(work.as_str()),
    )?;

    tracing::info!(work, "fanotify watching mount");

    // TODO(§4.7): Arc<Fanotify> smell — Fanotify fd should be owned by the
    // spawn_blocking task exclusively; switch to a channel-based hand-off to
    // avoid the Arc when nix gains Send on Fanotify directly.
    let fan = Arc::new(fan);
    let mut dropped_since_last: u32 = 0;

    loop {
        // TODO(§4.7): spawn_blocking cancellation — JoinHandle is currently
        // dropped on tokio shutdown; add a CancellationToken so the blocking
        // thread exits cleanly instead of being abandoned.
        let fan_clone = Arc::clone(&fan);
        let read_result = tokio::task::spawn_blocking(move || fan_clone.read_events()).await?;

        let events = match read_result {
            Ok(ev) => ev,
            Err(nix::Error::EINTR) => continue,
            Err(e) => {
                tracing::warn!(error = %e, "fanotify read_events failed");
                continue;
            }
        };

        for ev in events {
            // TODO(§4.7): fd exhaustion — fanotify event fds accumulate if we
            // process faster than we drop; add a bounded channel or explicit
            // drop checkpoint to bound open-fd count under high event rates.

            // Skip queue-overflow / version-mismatch noise; surface as warning.
            // TODO(§4.7): check_version alert — consider emitting a structured
            // metric/alert instead of a plain warn when this fires repeatedly.
            if !ev.check_version() {
                tracing::warn!(
                    expected = nix::sys::fanotify::FANOTIFY_METADATA_VERSION,
                    got = ev.version(),
                    "fanotify metadata version mismatch — skipping event"
                );
                continue;
            }

            // Fix 3: skip pid <= 0 (FAN_Q_OVERFLOW synthesizes pid=0; schema §1.2
            // requires a real source PID).
            if ev.pid() <= 0 {
                tracing::warn!(pid = ev.pid(), "skip non-positive pid (FAN_Q_OVERFLOW or sentinel)");
                continue;
            }

            // Fix 4: unknown mask → skip instead of mislabelling as FileWrite.
            let event_type = match classify_event_type(ev.mask()) {
                Some(t) => t,
                None => {
                    tracing::warn!(mask = ?ev.mask(), "skip event with unmatched mask");
                    continue;
                }
            };

            // Fix 2: build payload with current dropped_since_last snapshot, then
            // attempt send first; reset/increment counter based on send result.
            let s = seq.fetch_add(1, Ordering::Relaxed);
            let payload = build_payload(&ev, dropped_since_last, s, event_type);
            let msg = WsMessage {
                schema_version: "1.0".into(),
                seq: s,
                r#type: "node_add".into(),
                payload,
            };

            // schema §1.4: dropped_since_last carries the count at send-attempt time; ReplayBuffer guarantees presence regardless of broadcast subscriber state.
            if tx.send(msg.clone()).is_ok() {
                replay.push(msg).await;
                if dropped_since_last > 0 {
                    tracing::warn!(dropped_since_last, "broadcast lag");
                    dropped_since_last = 0;
                }
            } else {
                replay.push(msg).await;
                dropped_since_last = dropped_since_last.saturating_add(1);
            }
        }
    }
}

/// Build a `BehaviorEventV1`-shaped JSON object from a fanotify event.
/// Enriches with `/proc/<pid>/exe` (image_path) and `/proc/<pid>/status` PPid.
/// `seq` mirrors the outer WsMessage.seq per schema §1.2.
/// `event_type` is pre-classified by the caller to avoid double-computation.
fn build_payload(ev: &FanotifyEvent, dropped_since_last: u32, seq: u64, event_type: &str) -> serde_json::Value {
    let pid = ev.pid();

    let image_path = read_proc_exe(pid);
    let parent_pid = read_proc_ppid(pid).unwrap_or(0);

    // file_path: resolve through /proc/self/fd/<event_fd> readlink. The event
    // owns the fd; closing happens when FanotifyEvent is dropped.
    let file_path = ev
        .fd()
        .map(|fd| {
            let link = format!("/proc/self/fd/{}", std::os::fd::AsRawFd::as_raw_fd(&fd));
            std::fs::read_link(&link)
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_else(|_| format!("<unknown:fd={}>", std::os::fd::AsRawFd::as_raw_fd(&fd)))
        });

    let ts_unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    json!({
        "schema_version": "1.0",
        "seq": seq,
        "dropped_since_last": dropped_since_last,
        "pid": pid as u32,
        "parent_pid": parent_pid,
        "image_path": image_path,
        "event_type": event_type,
        "file_path": file_path,
        "ts_unix_ms": ts_unix_ms,
    })
}

/// Returns `Some(event_type)` for known mask flags, `None` for unmatched masks.
/// Schema enum is closed: {FileWrite, FileRename, ProcessCreate}.
fn classify_event_type(mask: MaskFlags) -> Option<&'static str> {
    if mask.contains(MaskFlags::FAN_RENAME) {
        Some("FileRename")
    } else if mask.contains(MaskFlags::FAN_OPEN_EXEC) {
        Some("ProcessCreate")
    } else if mask.contains(MaskFlags::FAN_MODIFY) || mask.contains(MaskFlags::FAN_CLOSE_WRITE) {
        Some("FileWrite")
    } else {
        None
    }
}

/// Read `/proc/<pid>/exe` to recover the process image path. Returns the
/// sentinel `"<unknown:pid=N>"` per Worker-A v1.1 note #4 when readlink fails
/// (PID already exited, EACCES, etc.).
fn read_proc_exe(pid: i32) -> String {
    std::fs::read_link(format!("/proc/{pid}/exe"))
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| format!("<unknown:pid={pid}>"))
}

/// Parse `PPid:` from `/proc/<pid>/status`. Returns None when the file or the
/// PPid line is unavailable.
fn read_proc_ppid(pid: i32) -> Option<u32> {
    let status = std::fs::read_to_string(format!("/proc/{pid}/status")).ok()?;
    for line in status.lines() {
        if let Some(rest) = line.strip_prefix("PPid:") {
            return rest.trim().parse::<u32>().ok();
        }
    }
    None
}

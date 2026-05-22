// Week 4-5 §4.1: libfanotify adapter for Velxor collector.
// Uses `nix::sys::fanotify` (nix 0.31.3 exposes Fanotify/InitFlags/MarkFlags/MaskFlags
// under the "fanotify" feature). Falls back to FAN_MODIFY|FAN_CLOSE_WRITE|FAN_OPEN_EXEC|
// FAN_RENAME (kernel >= 5.17 / Ubuntu 24.04 kernel 6.8). Blocking fanotify read() runs
// inside `tokio::task::spawn_blocking` so the tokio runtime is never stalled.

use std::sync::Arc;
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
    seq_start: u64,
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

    let fan = Arc::new(fan);
    let mut seq: u64 = seq_start.max(1);
    let mut dropped_since_last: u32 = 0;

    loop {
        // Blocking read of the fanotify fd happens inside spawn_blocking so the
        // tokio reactor stays free for WS broadcast / classify_client work.
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
            // Skip queue-overflow / version-mismatch noise; surface as warning.
            if !ev.check_version() {
                tracing::warn!(
                    expected = nix::sys::fanotify::FANOTIFY_METADATA_VERSION,
                    got = ev.version(),
                    "fanotify metadata version mismatch — skipping event"
                );
                continue;
            }

            let payload = build_payload(&ev, dropped_since_last);
            let msg = WsMessage {
                schema_version: "1.0".into(),
                seq,
                r#type: "node_add".into(),
                payload,
            };
            replay.push(msg.clone()).await;
            if tx.send(msg).is_err() {
                dropped_since_last = dropped_since_last.saturating_add(1);
            } else if dropped_since_last > 0 {
                tracing::warn!(dropped_since_last, "broadcast lag");
                dropped_since_last = 0;
            }
            seq = seq.saturating_add(1);
        }
    }
}

/// Build a `BehaviorEventV1`-shaped JSON object from a fanotify event.
/// Enriches with `/proc/<pid>/exe` (image_path) and `/proc/<pid>/status` PPid.
fn build_payload(ev: &FanotifyEvent, dropped_since_last: u32) -> serde_json::Value {
    let pid = ev.pid();
    let mask = ev.mask();
    let event_type = classify_event_type(mask);

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
        "seq": null,  // outer WsMessage holds the canonical seq
        "dropped_since_last": dropped_since_last,
        "pid": pid as u32,
        "parent_pid": parent_pid,
        "image_path": image_path,
        "event_type": event_type,
        "file_path": file_path,
        "ts_unix_ms": ts_unix_ms,
    })
}

fn classify_event_type(mask: MaskFlags) -> &'static str {
    if mask.contains(MaskFlags::FAN_RENAME) {
        "FileRename"
    } else if mask.contains(MaskFlags::FAN_OPEN_EXEC) {
        "ProcessCreate"
    } else if mask.contains(MaskFlags::FAN_MODIFY) || mask.contains(MaskFlags::FAN_CLOSE_WRITE) {
        "FileWrite"
    } else {
        // Default to FileWrite — keep the schema's enum total. Aggregator can
        // ignore unknowns once it grows richer routing in §4.2.
        "FileWrite"
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

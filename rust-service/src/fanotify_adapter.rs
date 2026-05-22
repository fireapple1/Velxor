// Week 4-5 §4.1: libfanotify adapter for Velxor collector.
// Uses `nix::sys::fanotify` (nix 0.31.3 exposes Fanotify/InitFlags/MarkFlags/MaskFlags
// under the "fanotify" feature). Mask: FAN_MODIFY|FAN_CLOSE_WRITE|FAN_OPEN_EXEC.
// FAN_RENAME is deferred to v1.1 schema collation — it requires init class
// FAN_REPORT_FID/DIR_FID/DFID_NAME, which changes event metadata layout (no
// per-event fd, name carried in FAN_EVENT_INFO_TYPE_*). The fanotify fd is opened
// non-blocking and driven via `tokio::io::unix::AsyncFd` so the await is cancellation-safe
// and the runtime is never stalled.

use std::os::fd::AsRawFd;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use nix::sys::fanotify::{
    EventFFlags, Fanotify, FanotifyEvent, InitFlags, MarkFlags, MaskFlags,
    FANOTIFY_METADATA_VERSION,
};
use serde_json::json;
use tokio::io::unix::AsyncFd;
use tokio::sync::broadcast;

use crate::ws_broadcaster::{ReplayBuffer, WsMessage};

/// Emitted at most once per session for version-mismatch events (fix G).
static VERSION_ALERT_SENT: AtomicBool = AtomicBool::new(false);

/// Per-batch event cap: process at most this many events per read_events() call.
/// Events beyond cap are counted as drops and logged (fix F).
const MAX_EVENTS_PER_BATCH: usize = 256;

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

    // O_NONBLOCK is required so AsyncFd can drive readiness via epoll without parking
    // a blocking thread; EAGAIN on read_events is treated as "no data, wait again".
    let fan = Fanotify::init(
        InitFlags::FAN_CLASS_NOTIF,
        EventFFlags::O_RDONLY | EventFFlags::O_NONBLOCK,
    )?;

    // FAN_RENAME (kernel 5.17+) requires the fanotify fd be opened with one of
    // FAN_REPORT_FID / FAN_REPORT_DIR_FID / FAN_REPORT_DFID_NAME — otherwise
    // fanotify_mark() returns EINVAL. We deliberately stay on the fd-reporting
    // path (no FID class) for Week 4-5 because FID events have a different
    // metadata layout (no per-event fd, name carried in FAN_EVENT_INFO_TYPE_*).
    // FileRename detection is deferred to v1.1 schema collation when B/C agree
    // on the DFID_NAME event shape.
    let mask = MaskFlags::FAN_MODIFY
        | MaskFlags::FAN_CLOSE_WRITE
        | MaskFlags::FAN_OPEN_EXEC;

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

    // Single-owner Fanotify driven via AsyncFd. AsyncFd::new takes the RawFd by value
    // but does NOT take ownership of the fd — `fan` stays alive (and owns the OwnedFd
    // it wraps); when `fan` is dropped at end-of-scope the underlying fd is closed.
    let async_fd = AsyncFd::new(fan.as_raw_fd())?;
    let mut dropped_since_last: u32 = 0;

    loop {
        // readable().await is cancellation-safe: if the outer task is cancelled the
        // future is dropped cleanly with no orphaned thread.
        let mut guard = async_fd.readable().await?;

        let events = match fan.read_events() {
            Ok(ev) => {
                guard.clear_ready();
                ev
            }
            Err(nix::errno::Errno::EAGAIN) => {
                // Spurious wakeup or another reader drained the queue: clear readiness
                // so the next loop iteration re-arms epoll.
                guard.clear_ready();
                continue;
            }
            Err(nix::Error::EINTR) => {
                guard.clear_ready();
                continue;
            }
            Err(e) => {
                tracing::warn!(error = %e, "fanotify read_events failed");
                guard.clear_ready();
                continue;
            }
        };

        // Fix F: cap per-batch processing to MAX_EVENTS_PER_BATCH to bound open-fd count
        // under burst. Events beyond the cap are counted as drops (schema §1.4 silent-drop
        // rule: count them in dropped_since_last and log).
        let batch_len = events.len();
        if batch_len > MAX_EVENTS_PER_BATCH {
            let overflow = (batch_len - MAX_EVENTS_PER_BATCH) as u32;
            tracing::warn!(
                dropped = overflow,
                "fanotify batch overflow — capping at {} events per iter",
                MAX_EVENTS_PER_BATCH
            );
            dropped_since_last = dropped_since_last.saturating_add(overflow);
        }

        for ev in events.into_iter().take(MAX_EVENTS_PER_BATCH) {
            // Fix G: emit one structured WsMessage alert per session on version mismatch.
            if !ev.check_version() {
                tracing::warn!(
                    expected = FANOTIFY_METADATA_VERSION,
                    got = ev.version(),
                    "fanotify metadata version mismatch — skipping event"
                );
                // Suppress repeated alerts after the first one this session.
                if !VERSION_ALERT_SENT.swap(true, Ordering::Relaxed) {
                    let alert_s = seq.fetch_add(1, Ordering::Relaxed);
                    let alert_msg = WsMessage {
                        schema_version: "1.0".into(),
                        seq: alert_s,
                        r#type: "alert".into(),
                        payload: json!({
                            "severity": "warning",
                            "code": "fanotify_metadata_version_mismatch",
                            "expected": FANOTIFY_METADATA_VERSION,
                            "got": ev.version(),
                        }),
                    };
                    if tx.send(alert_msg.clone()).is_ok() {
                        replay.push(alert_msg).await;
                    }
                }
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
            // AC4 §5.2: event_received_ts emit (real-fanotify path).
            tracing::info!(event_received_ts = crate::time_ms(), seq = s, src = "fanotify", "evt_in");
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
/// Schema enum {FileWrite, FileRename, ProcessCreate}; FileRename deferred to
/// v1.1 (requires FAN_REPORT_DFID_NAME init class — see init-flags comment).
fn classify_event_type(mask: MaskFlags) -> Option<&'static str> {
    if mask.contains(MaskFlags::FAN_OPEN_EXEC) {
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

# 작업자 A — 타임라인 (간략 버전, Ubuntu+fanotify)

> **목적**: 작업자 A(Rust+libfanotify userspace collector + Rust 저수준 입력 파이프라인)의 ~41h 분량 일정을 한눈에 본다.
> **참고**: 상세 명세는 [`role-assignment.md`](./role-assignment.md), [`velxor-consensus-plan.md`](./velxor-consensus-plan.md), [`ENVIRONMENT.md`](./ENVIRONMENT.md). 본 문서는 **체크리스트형 요약**.
> **브랜치**: `devA`
> **OS 가정**: **Ubuntu 24.04 LTS** (bare-metal 또는 KVM/VirtualBox VM). 원안의 Windows WDK 미니필터는 **2026-05-21 마이그레이션**으로 폐기 — kernel module 없음, BSOD/test-signing 의존성 제거.

---

## 시간 예산 한눈에

| Week | h | 핵심 산출물 |
|---|---|---|
| 0 | 7 | Ubuntu + Rust 1.78 + fanotify smoke + inotify 백업 spike |
| 1 | 5 | collector stub + `collector_source.rs` |
| 3 | 1 | v1.1 schema review 노트 |
| 4-5 | 18 | libfanotify 본구현 + `/proc/<pid>` 메타 보강 + UNIX socket/stdout pipe 송신 + Rust aggregator |
| 8-9 | 8 | 자동 차단(kill SIGTERM→SIGKILL) + AC6 + 리허설 |
| 10 | 2 | 슬라이드 collector 섹션 |
| **합계** | **~41** | |

---

## Week 0 — 환경 + fanotify smoke (7h)

- [ ] Ubuntu 24.04 LTS bare-metal 또는 KVM/VirtualBox VM. (선택) timeshift/LVM snapshot 1개
- [ ] apt baseline 한 줄: `sudo apt install -y build-essential clang pkg-config libssl-dev git curl jq rsync unzip p7zip-full python3 python3-venv python3-dev`
- [ ] Rust 1.78.0: `rustup default 1.78.0` → `cargo --version` 확인
- [ ] `grep CONFIG_FANOTIFY /boot/config-$(uname -r)` → `=y` 확인 (24.04 stock 커널이면 OK)
- [ ] **Week 0 AC (fanotify smoke)**: 최소 Rust(or C) 샘플로 `~/velxor-work/src`에 `touch foo` → `FAN_MODIFY` 1개 캡처 (root 실행). 사전 `sudo strace -e fanotify_init,fanotify_mark <sample>`로 호출 경로 검증 가능
- [ ] inotify 백업 spike: `inotifywait -m -r ~/velxor-work` → file I/O 이벤트 1개 캡처 → **fanotify 권한·커널 옵션 실패 시 백업 경로 사전 확보**

> ⚠️ Week 0 AC 미달성(root 권한·AppArmor·`CONFIG_FANOTIFY=n`) 시 **즉시** "fanotify는 future work, inotify 백업" 시나리오로 전환 결정.

---

## Week 1 — Stub (5h)

- [ ] collector stub: `events.jsonl` writer (mock 이벤트 emit, JSONL = 한 줄 1 객체, schema v1-draft 호환)
- [ ] Rust `collector_source.rs`: `events.jsonl` poll ↔ 실 libfanotify 어댑터 **분기**
  - `VELXOR_STUB=collector` → poll 사용
  - `unset` → 실 libfanotify 어댑터 사용 (Week 4-5에 채움)
- [ ] Schema v1-draft에 **mechanical ack** 한 줄 (컴파일 가능 여부만)
- [ ] AC1 walking skeleton: 자기 머신에서 `run-all.sh` exit 0 + `ws-record.sh` 캡처 확인

---

## Week 3 — Schema v1.1 review (1h, 48h 데드라인)

- [ ] collector 관점 missing/wrong field 노트 **1개 제출**
  - 예: `op_detail` sub-record 필드 누락, `volume_id`(ext4 dev-major-minor) 인코딩, `dropped_since_last` overflow 정책, `image_path` UTF-8 truncate 정책
- [ ] 무응답 시 B 단독 발행 (발언권 포기)

---

## Week 4-5 — 본구현 (18h, 최대 부하)

### libfanotify userspace collector (Rust, root)
- [ ] `fanotify_init` + `fanotify_mark` (`FAN_CLASS_NOTIF` 또는 `FAN_CLASS_CONTENT`)
- [ ] subscribe events: **FAN_MODIFY**, **FAN_CLOSE_WRITE**, **FAN_OPEN_EXEC**, (kernel 5.17+의) **FAN_RENAME** — 24.04는 6.8이라 OK
- [ ] (선택) **FAN_OPEN_PERM**: permission event로 자동 차단 기초 (응답 ALLOW/DENY)
- [ ] 프로세스 메타 보강: `/proc/<pid>/exe` readlink, `/proc/<pid>/comm`, `/proc/<pid>/status` → `parent_pid = PPid:`
  - **PID race**: 짧은 수명 프로세스는 fanotify FD 닫기 전에 stat 시도 (event 처리 루프 안에서)

### `BehaviorEventV1` 송신 정책 (architectural critical)
- [ ] 전송 채널: **UNIX domain socket** `/run/velxor/events.sock` 또는 **stdout pipe** (collector를 child process로 spawn)
- [ ] socket write `SO_SNDTIMEO = 10ms` 비차단, retry 없음
- [ ] **mutex 보유 중 송신 금지** → ring buffer enqueue 후 worker task dispatch
- [ ] **signal handler context에서 송신 금지** (async-signal-safe 함수만 사용)
- [ ] 큐 깊이 1024, drop 시 `dropped_since_last++` (silent drop 금지 — 다음 successful send에 동봉)
- [ ] 페이로드: JSON UTF-8, ≤ 4 KiB, JSONL(1줄=1메시지), `image_path`/`file_path`는 **UTF-8 ≤ 4096 bytes** (Linux PATH_MAX). truncate 시 `op_detail.path_truncated: true`

### Rust 측 (`aggregator.rs`)
- [ ] PID별 sliding window 1s + 5s 두 트랙
- [ ] burst detection: FileWrite ≥ 50/1s **OR** FileRename ≥ 30/1s
- [ ] aggregator → B의 `classifier_client` 핸드오프 (채널 또는 함수 호출)

### 통합 포인트 (4.5)
- [ ] B의 Rust 서비스 입력 어댑터를 실 libfanotify collector로 교체
- [ ] 실패 시 `VELXOR_STUB=collector` 영속 (events.jsonl poll), 진행 차단 없음
- [ ] systemd unit (선택): `AmbientCapabilities=CAP_SYS_ADMIN` + `Restart=on-failure`. 데모 단순화 위해 `sudo ./velxor-collector` 직접 실행도 OK

---

## Week 8-9 — 자동 차단 + AC6 + 리허설 (8h)

### 자동 차단 (Rust 측, Deferral 후보 #3)
- [ ] `nix::sys::signal::kill(Pid::from_raw(pid), Signal::SIGTERM)` → 200ms 대기 → `kill(.., Signal::SIGKILL)` fallback
- [ ] `EPERM`(권한 부족) / `ESRCH`(이미 종료) 시 **fallback 로그** + UI Block 버튼 수동 차단만 유지
- [ ] root 또는 동일 uid 필요 — collector가 root로 떠 있으면 충족

### `scripts/ac6-verify-block.sh`
- [ ] `! kill -0 "$PID" 2>/dev/null` 또는 `! test -e /proc/$PID` 자동화
- [ ] exit 0 = 차단 성공

### 리허설 3회 (B 주관)
- [ ] collector 안정성 + queue 모니터링 (`dropped_since_last` 증가율)
- [ ] **collector crash 1회 발생 시 즉시** `VELXOR_STUB=collector` 데모 모드 전환 (userspace라 시스템 전체 다운은 없음 — 원안 BSOD 대비 리스크 대폭 완화)
- [ ] snapshot rollback 시간 < 60s 측정 (timeshift/LVM) → `REHEARSAL-LOG.md` 기록

---

## Week 10 — 발표 (2h)

- [ ] 슬라이드 collector 섹션 (libfanotify, root 권한 모델, FAN_OPEN_PERM 차단 메커니즘)
- [ ] collector 미완 시 "future work: LSM/eBPF로 kernel-level 강화" 표기

---

## AC8 stub 모드 검증 (A 담당 = collector)

- [ ] `VELXOR_STUB=collector` 단독 모드에서 `run-all.sh` smoke pass
- [ ] events.jsonl 한 줄 emit → Rust → REST → WS → UI 까지 흐름 유지

---

## 결정적 책임 5개

| # | 책임 | 위반 시 |
|---|------|---------|
| 1 | Week 0 AC(fanotify smoke) 실패 시 **즉시** inotify 백업 가동 결정 | Week 4-5 통째 손실 |
| 2 | `BehaviorEventV1` 송신: mutex 보유 중 / signal handler context **금지** → enqueue 후 worker dispatch | collector hang, 이벤트 손실 |
| 3 | `dropped_since_last` silent drop 금지 — 항상 다음 successful send에 동봉 | 데이터 손실 원인 추적 불가 |
| 4 | collector crash 1회 시 **즉시** `VELXOR_STUB=collector` 전환 (판단 망설이지 말 것) | 발표 중 collector 죽음 = 데모 사망 |
| 5 | AC6 차단 시퀀스: `kill(SIGTERM)` → 200ms → `kill(SIGKILL)` + `EPERM/ESRCH` fallback 로그 | 권한·종료 race 미처리로 차단 실패 |

---

## 리스크 & 즉시 대응

| Risk | Trigger | 대응 |
|------|---------|------|
| fanotify 권한·커널 옵션 실패 | Week 0 AC 미달성 (root 부재·`CONFIG_FANOTIFY=n`·AppArmor) | inotify 백업 가동, 슬라이드 "permission caveats" |
| Collector 지연 | Week 4 종료 시 `events.jsonl`조차 emit 안함 | `VELXOR_STUB=collector` 영속, B/C 진행 차단 X |
| Collector crash / queue overflow | 리허설 중 sigsegv 또는 `dropped_since_last` 폭증 | systemd `Restart=on-failure` + `VELXOR_STUB=collector` 데모 모드 |
| kill 실패 (EPERM/ESRCH) | 차단 시도 시 | fallback 로그 + Block 버튼 수동 |

---

## 생성/소유 파일

```
Velxor/
├── rust-service/src/
│   ├── collector_source.rs                     # A (libfanotify ↔ events.jsonl 어댑터)
│   └── aggregator.rs                           # A
└── scripts/
    └── ac6-verify-block.sh                     # A
```

---

> **간략 모드 한 줄 요약**: Week 0 fanotify smoke + inotify 백업 확보 → Week 1 collector stub → Week 4-5 libfanotify 본구현 (mutex/signal context 금지 + drop counting) → Week 8-9 `kill(SIGTERM)→SIGKILL` 자동 차단 + AC6 → collector crash 시 `VELXOR_STUB=collector` 영속.

# Velxor — 개발 환경 (3인 공통)

> Walking Skeleton AC1은 "3인 모두 자기 머신에서 `run-all.sh` 재현 시 동일 결과"를 요구한다.
> 환경 drift를 막기 위해 **모든 작업자가 아래 버전을 정확히 일치시킨다**. Week 0 종료 전 검증 필수.

> **OS 마이그레이션 노트 (2026-05-21)**: 원안의 Windows kernel minifilter(WDK) layer ①은
> **Ubuntu 24.04 + fanotify userspace collector**(Rust 프로세스, root 필요)로 대체되었다.
> kernel module은 사용하지 않으며 BSOD/test-signing/WDK 의존성이 모두 제거된다.
> identity 약화는 [`README.md`](./README.md)에 명시.

## 1. 호스트 / VM

| 항목 | 고정 값 | 비고 |
|---|---|---|
| 호스트 OS | (작업자별 자유, Windows/Mac/Linux 무관) | bare-metal Ubuntu가 가장 단순 |
| 가상화 | KVM/QEMU + libvirt 또는 VirtualBox 7.x / VMware Workstation 17 | bare-metal이면 불필요 |
| Guest OS | **Ubuntu 24.04 LTS (Noble Numbat)** | 22.04로 다운그레이드 시 PPA·apt 버전 표 별도 검증 필요 |
| VM 메모리 | ≥ 8 GB | Electron + Rust dev 동시 가동 |
| VM 디스크 | ≥ 60 GB | apt cache + cargo target + npm cache |
| Snapshot | Week 0 종료 직후 1개 (선택) | fanotify·권한 실험 rollback 용. bare-metal이면 `timeshift` 또는 LVM snapshot |

## 2. 툴체인 (버전 고정)

| Tool | Pinned version | 설치 확인 |
|---|---|---|
| 빌드 베이스 | `build-essential` + `clang` + `pkg-config` + `libssl-dev` | `sudo apt install -y build-essential clang pkg-config libssl-dev` |
| Rust | 1.78.0 (stable) | `rustup default 1.78.0`; `cargo --version`. rustup은 `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Python | 3.12.x (Ubuntu 24.04 기본) | `sudo apt install -y python3 python3-venv python3-dev` 한 줄. 별도 PPA·pyenv 불필요 |
| pip | 24.x | venv 내부 |
| Node | 20 LTS (20.12 이상) | `nvm install 20` 권장 (apt는 22가 들어옴) |
| npm | 10.x | Node 동봉 |
| Git | 2.43 이상 | `git --version` (24.04 기본 2.43+) |
| Shell (`run-all.sh` 호환) | **bash 5.2** (Ubuntu 24.04 native) | `/usr/bin/bash`, `bash --version` |
| OBS Studio | 30.x (또는 PeekVK) | AC3 시연 영상 녹화. flatpak 또는 `sudo add-apt-repository ppa:obsproject/obs-studio && sudo apt install obs-studio` |
| jq, curl, rsync, unzip, p7zip-full | apt | `sudo apt install -y jq curl rsync unzip p7zip-full` |

### 2.1 Python 3.12 설치 (Ubuntu 24.04 기본)

```bash
sudo apt install -y python3 python3-venv python3-dev
python3 --version          # Python 3.12.x
```

> *(왜 3.12)* 24.04 기본 인터프리터를 그대로 사용해 pyenv/deadsnakes 의존성을 제거. `flask 3.0`, `waitress 3.0`, `requests 2.x`, `numpy 1.26.x`, `scikit-learn 1.4.x` 모두 Python 3.12를 공식 지원한다. (22.04를 함께 지원해야 하면 3.11로 다운그레이드하고 deadsnakes PPA 사용 — 본 문서는 24.04만 가정.)
>
> ⚠️ **`python-is-python3` 패키지는 설치하지 않는다.** 시스템 전역에 `python` alias를 거는 패키지로, venv 활성화 시 PATH 우선순위가 꼬일 수 있다. venv 활성화 후 사용하는 `python`은 venv의 symlink라 안전하다.

## 3. Python 패키지 (engine 측, requirements.txt 예정)

| Package | Pin | 사유 |
|---|---|---|
| flask | 3.0.x | REST 핸들러 |
| waitress | 3.0.x | cross-platform WSGI server (`threads=4`) — Linux에서도 그대로 가동, gunicorn은 비채택 (AC4 sub-budget 측정 재현성 유지) |
| numpy | 1.26.x | feature vector |
| scikit-learn | 1.4.x | LogisticRegression (Week 6.6) |
| requests | 2.x | p99 자가측정 (Week 6.7) |

## 4. Rust crates (rust-service 측, Cargo.toml 예정)

| Crate | 사유 |
|---|---|
| tokio | async runtime |
| tokio-tungstenite | WS server |
| reqwest | REST client → Waitress |
| serde, serde_json | wire encoding (JSON UTF-8) |
| tracing, tracing-subscriber | AC4 측정용 instrumentation |
| **fanotify-rs** (또는 raw nix) | Linux fanotify mark/listen (작업자 A) |

> `fanotify`는 mount-point 모니터링·permission event를 지원하는 Linux 표준 API다. `CAP_SYS_ADMIN` 권한 필요 → systemd unit에 `AmbientCapabilities=CAP_SYS_ADMIN`을 부여하거나 단순화를 위해 root로 실행 (`sudo ./velxor-rust-service`). userspace이므로 kernel taint·BSOD 위험 없음.

## 5. Week 0 환경 검증 체크리스트

각 작업자가 Week 0 종료 전 본인 머신에서 모두 통과해야 한다.

- [ ] `lsb_release -a` → `Ubuntu 24.04 ...` (또는 22.04 명시 합의)
- [ ] `locale -a | grep -E 'en_US.utf8|C.UTF-8'` → UTF-8 locale 사용 가능
- [ ] `cargo --version` → `cargo 1.78.0`
- [ ] `python3 --version` → `Python 3.12.x`
- [ ] `python3 -c "import waitress; print(waitress.__version__)"` → `3.x` (venv 활성 상태)
- [ ] `node --version` → `v20.x`
- [ ] `npm --version` → `10.x`
- [ ] `git --version` → `2.43+`
- [ ] `/usr/bin/bash --version` → `5.2.x` (24.04) 또는 `5.1.x` (22.04)
- [ ] `OBS` 실행 가능
- [ ] `sudo` 사용 가능 + `cat /proc/sys/fs/inotify/max_user_watches` ≥ 8192
- [ ] **fanotify smoke** (A 필수, B/C 선택): `sudo strace -e fanotify_init,fanotify_mark <minimal sample>`로 FAN_MODIFY 이벤트 1개 캡처 → kernel collector 경로 실증
- [ ] VM/timeshift snapshot 1개 (선택, 권한 실험 rollback)

### 5.1 한 줄 apt baseline

```bash
sudo apt update && sudo apt install -y \
  build-essential clang pkg-config libssl-dev \
  git curl jq rsync unzip p7zip-full \
  python3 python3-venv python3-dev
```

## 6. 환경 drift 발견 시

- AC1 재현 실패 → 본 문서 버전 표 vs 본인 머신 출력 비교
- 차이 발견 → 해당 도구만 본 문서 버전으로 재설치
- 재설치 어려우면 PR로 본 문서 버전 표 갱신 제안 (3인 합의 필요)

## 7. 파일·인코딩·권한 표준 (Linux 신규)

- 모든 텍스트 파일은 **LF 종결**, UTF-8 (no BOM).
- 저장소 루트에 `.gitattributes`:
  ```
  * text=auto eol=lf
  *.sh text eol=lf
  *.py text eol=lf
  *.md text eol=lf
  *.png binary
  *.jpg binary
  ```
- `chmod +x scripts/*.sh` 후 `git update-index --chmod=+x scripts/*.sh`로 실행 비트를 커밋에 박는다 (ext4에서는 실제 적용됨).
- 작업 디렉토리는 대소문자 구분(ext4) — `Velxor/`와 `velxor/`는 다른 폴더로 취급된다.
- 데이터셋·임시 파일은 **`/tmp` 사용 금지** (tmpfs라 디스크 IO 측정 왜곡). `~/velxor-work/{src,dst}` 또는 `./tmp_extract`처럼 같은 ext4 마운트 사용.

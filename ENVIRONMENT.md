# Velxor — 개발 환경 (3인 공통)

> Walking Skeleton AC1은 "3인 모두 자기 머신에서 `run-all.sh` 재현 시 동일 결과"를 요구한다.
> 환경 drift를 막기 위해 **모든 작업자가 아래 버전을 정확히 일치시킨다**. Week 0 종료 전 검증 필수.

## 1. 호스트 / VM

| 항목 | 고정 값 | 비고 |
|---|---|---|
| 호스트 OS | (작업자별 자유, Windows/Mac/Linux 무관) | 단 VM 실행 가능해야 함 |
| 가상화 | Hyper-V (Windows 호스트) 또는 VMware Workstation/Fusion | A는 driver 테스트로 VM 필수 |
| Guest OS | **Windows 10 build 19045** 또는 **Windows 11 build 22631** | 두 빌드 중 하나로 통일 권장 |
| VM 메모리 | ≥ 8 GB | Electron + Rust dev 동시 가동 시 |
| VM 디스크 | ≥ 60 GB | WDK + VS + npm/cargo cache |
| Snapshot | Week 0 종료 직후 1개 | driver crash rollback 용 |

## 2. 툴체인 (버전 고정)

| Tool | Pinned version | 설치 확인 |
|---|---|---|
| Visual Studio | 2022, 17.8 이상 | "Desktop development with C++" + "Windows Driver Kit" workload |
| WDK | 10.0.22621.x | VS 통합 + WDK-WPP 옵션 |
| Rust | 1.78.0 (stable) | `rustup default 1.78.0`; `cargo --version` |
| Python | 3.11.x (3.11.9 권장) | `python --version` (Microsoft Store/Anaconda 모두 가능) |
| pip | 24.x | venv 내부 |
| Node | 20 LTS (20.12 이상) | `node --version` |
| npm | 10.x | Node 동봉 |
| Git | 2.43 이상 | `git --version` |
| Shell (`run-all.sh` 호환) | **Git Bash 2.43** 또는 WSL2 Ubuntu 22.04 | A는 Git Bash 권장 (driver VM 환경) |
| OBS Studio | 30.x | AC3 시연 영상 녹화용 |

## 3. Python 패키지 (engine 측, requirements.txt 예정)

| Package | Pin | 사유 |
|---|---|---|
| flask | 3.0.x | REST 핸들러 |
| waitress | 3.0.x | Windows native WSGI server (gunicorn 대체) |
| numpy | 1.26.x | feature vector |
| (모델 라이브러리 선택은 작업자 C 결정) | — | consensus-plan은 알고리즘 미지정 |

## 4. Rust crates (rust-service 측, Cargo.toml 예정)

| Crate | 사유 |
|---|---|
| tokio | async runtime |
| tokio-tungstenite | WS server |
| reqwest | REST client → Waitress |
| serde, serde_json | wire encoding (JSON UTF-8) |
| tracing, tracing-subscriber | AC4 측정용 instrumentation |

## 5. Week 0 환경 검증 체크리스트

각 작업자가 Week 0 종료 전 본인 머신에서 모두 통과해야 한다.

- [ ] `bcdedit /set testsigning on` 적용 후 reboot → WDK hello-world signed driver 로드 성공 (A 필수, B/C는 선택)
- [ ] `cargo --version` → `1.78.0`
- [ ] `python --version` → `3.11.x`
- [ ] `python -c "import waitress; print(waitress.__version__)"` → `3.x`
- [ ] `node --version` → `v20.x`
- [ ] `npm --version` → `10.x`
- [ ] `git --version` → `2.43+`
- [ ] Git Bash에서 `bash --version` → `5.x` (Windows)
- [ ] `OBS` 실행 가능
- [ ] VM snapshot 1개 생성 완료 (A)
- [ ] ETW provider 스파이크 1개 캡처 (`Get-WinEvent` 또는 `xperf`) 성공 (A)

## 6. 환경 drift 발견 시

- AC1 재현 실패 → 본 문서 버전 표 vs 본인 머신 출력 비교
- 차이 발견 → 해당 도구만 본 문서 버전으로 재설치
- 재설치 어려우면 PR로 본 문서 버전 표 갱신 제안 (3인 합의 필요)

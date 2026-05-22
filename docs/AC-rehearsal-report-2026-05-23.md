# §5.3 리허설 보고서 — 2026-05-23

**iter**: 3/3 PASS
**시나리오**: events.jsonl 60건 burst + WS client #1 (3s) + client #2 reconnect (?last_seq=N, 3s)
**모드**: VELXOR_STUB=collector (옵션 C, A timeline §5.1)

## 회별 메트릭

| iter | ws1 lines | ws2 lines | ws1 last_seq | event_received_ts | ws_sent_ts | classify_start_ts | classify_end_ts | broadcast_lag | dropped>0 | dedupe violations |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 61 | 0 | 61 | 60 | 61 | 2 | 1 | 0 | 0 | 0 |
| 2 | 61 | 0 | 61 | 60 | 61 | 2 | 1 | 0 | 0 | 0 |
| 3 | 61 | 0 | 61 | 60 | 61 | 2 | 1 | 0 | 0 | 0 |

## 판정 기준
- **collector 안정성**: dropped>0 + broadcast_lag = 0 이면 PASS
- **WS reconnect**: dedupe violations = 0 (서버 측 backlog_max_seq dedupe 검증)
- **tracing JSON 누락 없음**: event_received_ts ≥ 60 (per event), classify_start_ts/end_ts ≥ 1 (burst 50+ → trigger)

## 아티팩트
- 회별 디렉토리: `/home/lsy/velxor-work/rehearsal-2026-05-23/iter-{1..3}/`
- 회별 파일: `engine.log / rust.log / ws1.jsonl / ws2.jsonl / metrics.kv`

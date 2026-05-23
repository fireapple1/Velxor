# Velxor 발표 슬라이드 — 발표자 가이드

reveal.js 5.1.0 (jsDelivr CDN), 한국어, 13장, 예상 발표 시간 **10분**.

---

## 빠른 시작

```bash
cd /home/lsy/htA/Velxor/docs/presentation
python3 -m http.server 8000
```

브라우저에서 → http://localhost:8000

> **주의**: `file://` 프로토콜은 video/img `data-src` lazy-loading이 동작하지 않으므로
> 반드시 HTTP 서버를 통해 열 것.

---

## 단축키

| 키 | 동작 |
|---|---|
| `Space` / `→` | 다음 슬라이드 |
| `Shift+Space` / `←` | 이전 슬라이드 |
| `Esc` | 슬라이드 전체 overview |
| `S` | 발표자 노트 창 열기 |
| `F` | 전체화면 |
| `B` | 화면 블랙아웃 (청중 집중용) |
| `?` | 단축키 도움말 |
| `Alt+Click` | 해당 슬라이드 확대 |

---

## PDF 내보내기

1. 브라우저 주소창에 `http://localhost:8000/?print-pdf` 입력
2. Chrome / Chromium 인쇄 다이얼로그 열기 (`Ctrl+P`)
3. 설정:
   - 대상: **PDF로 저장**
   - 용지 크기: **A4 가로(Landscape)**
   - 여백: **없음(None)**
   - 배경 그래픽: **체크**
4. 저장

---

## 발표자 노트 사용법

1. `S` 키 → 발표자 노트 팝업 창 열림
2. 메인 화면은 프로젝터, 팝업 창은 내 노트북 화면에 두기
3. 팝업 창에 현재 슬라이드 + 다음 슬라이드 + 타이머 표시됨

---

## 자산(Asset) 교체 절차

슬라이드 8 (라이브 시연)의 영상/이미지를 최신 녹화본으로 교체할 때:

```bash
# 1. 새 데모 녹화
cd /home/lsy/htA/Velxor
bash scripts/record-demo.sh

# 2. 결과물 확인
ls docs/demo/ac3-demo.mp4
ls docs/demo/frames/f_4.png

# 3. 슬라이드 변경 불필요 — 심볼릭 링크를 통해 자동 반영됨
#    docs/presentation/assets/demo -> ../../demo
```

심볼릭 링크 확인:
```bash
ls -la docs/presentation/assets/demo
```

---

## TODO 추적

슬라이드에 남긴 asset-swap 주석 찾기:

```bash
grep -rn "asset-swap" /home/lsy/htA/Velxor/docs/presentation/
```

---

## 타임라인 가이드 (10분 목표)

| 슬라이드 | 제목 | 예상 시간 | 누적 |
|---|---|---|---|
| 1 | 타이틀 | 30s | 0:30 |
| 2 | 문제 정의 | 40s | 1:10 |
| 3 | 아키텍처 | 60s | 2:10 |
| 4 | 데이터 모델 | 45s | 2:55 |
| 5 | 분류 엔진 | 45s | 3:40 |
| 6 | 성능 (AC4) | 45s | 4:25 |
| 7 | 정확도 (AC5) | 45s | 5:10 |
| 8 | 라이브 시연 | 90s | 6:40 |
| 9 | 차단 동작 | 40s | 7:20 |
| 10 | 안정성 (AC7) | 35s | 7:55 |
| 11 | Disclaimer | 40s | 8:35 |
| 12 | 한계/Future | 35s | 9:10 |
| 13 | Q&A | 25s | 9:35 |

---

## 파일 구조

```
docs/presentation/
├── index.html          # 메인 슬라이드 (13장)
├── custom.css          # 커스텀 스타일
├── README.md           # 이 파일
└── assets/
    └── demo -> ../../demo   # 심볼릭 링크
        ├── ac3-demo.mp4
        └── frames/f_4.png
```

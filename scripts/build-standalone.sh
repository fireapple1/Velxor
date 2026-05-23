#!/usr/bin/env bash
# build-standalone.sh — Velxor 발표 자료 단일 HTML 번들러
# 사용법: bash scripts/build-standalone.sh
# 결과:  docs/presentation/standalone.html (외부 의존성 0)
# 캐시:  ~/velxor-work/bundle-cache/ (/tmp 사용 금지)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_DIR="$HOME/velxor-work/bundle-cache"
PRES_DIR="$REPO_ROOT/docs/presentation"
DEMO_DIR="$REPO_ROOT/docs/demo"
OUT_FILE="$PRES_DIR/standalone.html"

mkdir -p "$CACHE_DIR"

# ── CDN 자산 다운로드 (캐시 우선, fallback: unpkg) ──────────────────────────
download() {
  local file="$CACHE_DIR/$1"
  local primary="$2"
  local fallback="${3:-}"
  if [ -f "$file" ]; then
    echo "  cached: $1"
    return 0
  fi
  echo -n "  downloading $1 ... "
  if curl -fsSL "$primary" -o "$file" 2>/dev/null; then
    echo "OK ($(wc -c < "$file") bytes)"
  elif [ -n "$fallback" ] && curl -fsSL "$fallback" -o "$file" 2>/dev/null; then
    echo "OK via fallback ($(wc -c < "$file") bytes)"
  else
    echo "FAIL"
    exit 1
  fi
}

echo "[1/3] CDN 자산 다운로드..."
download reveal.css \
  "https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.css" \
  "https://unpkg.com/reveal.js@5.1.0/dist/reveal.css"

download black.css \
  "https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/theme/black.css" \
  "https://unpkg.com/reveal.js@5.1.0/dist/theme/black.css"

download monokai.css \
  "https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/plugin/highlight/monokai.css" \
  "https://unpkg.com/reveal.js@5.1.0/plugin/highlight/monokai.css"

download reveal.js \
  "https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js" \
  "https://unpkg.com/reveal.js@5.1.0/dist/reveal.js"

download notes.js \
  "https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/plugin/notes/notes.js" \
  "https://unpkg.com/reveal.js@5.1.0/plugin/notes/notes.js"

download highlight.js \
  "https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/plugin/highlight/highlight.js" \
  "https://unpkg.com/reveal.js@5.1.0/plugin/highlight/highlight.js"

echo "[2/3] 미디어 인코딩 + HTML 번들 생성..."
python3 << PYEOF
import base64, re
from pathlib import Path

CACHE = Path("$CACHE_DIR")
PRES  = Path("$PRES_DIR")
DEMO  = Path("$DEMO_DIR")
OUT   = Path("$OUT_FILE")
TODAY = "$(date +%Y-%m-%d)"

def b64(p, mime):
    return f"data:{mime};base64,{base64.b64encode(p.read_bytes()).decode()}"

reveal_css   = (CACHE / "reveal.css").read_text()
black_css    = (CACHE / "black.css").read_text()
monokai_css  = (CACHE / "monokai.css").read_text()
reveal_js    = (CACHE / "reveal.js").read_text()
notes_js     = (CACHE / "notes.js").read_text()
highlight_js = (CACHE / "highlight.js").read_text()

# custom.css: strip Pretendard CDN import, fallback to system font
custom_css = re.sub(
    r"@import\s+url\(['\"]?https://[^)]+['\"]?\)\s*;?\s*\n?", "",
    (PRES / "custom.css").read_text()
)
custom_css = custom_css.replace(
    "'Pretendard Variable', Pretendard, -apple-system,\n               'Apple SD Gothic Neo', sans-serif",
    "system-ui, -apple-system, 'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif"
)

mp4_data = b64(DEMO / "ac3-demo.mp4", "video/mp4")
png_data = b64(DEMO / "frames/f_4.png", "image/png")

index_html = (PRES / "index.html").read_text()
slides_match = re.search(
    r'(<div class="slides">)(.*?)(</div><!-- /\.slides -->)',
    index_html, re.DOTALL
)
slides_content = slides_match.group(1) + slides_match.group(2) + slides_match.group(3)

slides_content = slides_content.replace('data-src="assets/demo/ac3-demo.mp4"', f'data-src="{mp4_data}"')
slides_content = slides_content.replace('<source src="assets/demo/ac3-demo.mp4" type="video/mp4">', f'<source src="{mp4_data}" type="video/mp4">')
slides_content = slides_content.replace('data-src="assets/demo/frames/f_4.png"', f'data-src="{png_data}"')
slides_content = slides_content.replace('src="assets/demo/frames/f_4.png"', f'src="{png_data}"')

html = f"""<!--
  Velxor 발표 자료 — Standalone Build
  생성: {TODAY}
  외부 의존성: 없음 (offline 재생 가능)
  소스: docs/presentation/index.html (자산 교체 시 재빌드 필요)
  재빌드 방법: scripts/build-standalone.sh (이번 작업으로 생성된 스크립트)
-->
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Velxor — 랜섬웨어 행위 탐지·차단 시스템 발표</title>
  <style>
/* === reveal.css === */
{reveal_css}
  </style>
  <style>
/* === theme/black.css === */
{black_css}
  </style>
  <style>
/* === plugin/highlight/monokai.css === */
{monokai_css}
  </style>
  <style>
/* === custom.css (Pretendard CDN 제거 → system-font fallback) === */
{custom_css}
  </style>
</head>
<body>

<div class="reveal">
  {slides_content}
</div><!-- /.reveal -->

<!-- reveal.js 5.1.0 UMD (inline) -->
<script>
{reveal_js}
</script>
<!-- notes plugin UMD (inline) -->
<script>
{notes_js}
</script>
<!-- highlight plugin UMD (inline) -->
<script>
{highlight_js}
</script>
<script>
  Reveal.initialize({{
    hash: true,
    slideNumber: 'c/t',
    controls: true,
    progress: true,
    transition: 'slide',
    plugins: [RevealNotes, RevealHighlight],
    preloadIframes: false,
  }});
</script>

</body>
</html>
"""

OUT.write_text(html, encoding="utf-8")
size = OUT.stat().st_size
print(f"  -> {OUT}")
print(f"  -> {size/1024:.1f} KB ({size/1024/1024:.2f} MB)")
PYEOF

echo "[3/3] 검증..."
python3 << PYEOF
import re, sys
content = open("$OUT_FILE", encoding="utf-8").read()

ok = True

sections = len(re.findall(r'<section>', content))
print(f"  <section> 태그: {sections}개", "(OK)" if sections == 13 else "(FAIL — expect 13)")
if sections != 13: ok = False

mp4 = content.count("data:video/mp4;base64,")
print(f"  video/mp4 base64: {mp4}건", "(OK)" if mp4 >= 1 else "(FAIL)")
if mp4 < 1: ok = False

png = content.count("data:image/png;base64,")
print(f"  image/png base64: {png}건", "(OK)" if png >= 1 else "(FAIL)")
if png < 1: ok = False

fetch_patterns = [
    r'<link[^>]+href=["\']https?://',
    r'<script[^>]+src=["\']https?://',
    r'@import\s+url\(["\']?https?://',
]
ext_bad = sum(len(re.findall(p, content)) for p in fetch_patterns)
print(f"  외부 fetch URL: {ext_bad}건", "(OK)" if ext_bad == 0 else "(FAIL)")
if ext_bad > 0: ok = False

import html.parser
try:
    html.parser.HTMLParser().feed(content)
    print("  HTML 파싱: OK")
except Exception as e:
    print(f"  HTML 파싱: FAIL — {e}")
    ok = False

import os
size = os.path.getsize("$OUT_FILE")
print(f"  파일 크기: {size/1024:.1f} KB")

sys.exit(0 if ok else 1)
PYEOF

echo ""
echo "완료: $OUT_FILE"

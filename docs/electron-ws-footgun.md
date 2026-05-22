# Electron + Vite + WS preload context isolation footgun

## 증상
- `npm run dev`에서 WS reconnect 정상, Electron 빌드(`electron-builder`) 후 prod 패키지에서 WS 메시지가 *간헐적으로* 누락.
- 또는 dev hot-reload가 활성인 상태에서 Vite HMR이 ws-client를 두 번 마운트 → 동일 WS connection을 두 번 열어 broadcast 중복 수신 / race로 last_seq 갱신 깨짐.

## 원인
1. **Vite HMR**이 useEffect cleanup을 호출하지 않은 채 ws.onmessage handler를 재등록.
2. **Electron preload + contextIsolation:true**에서 `new WebSocket(...)`이 renderer 컨텍스트에서 동작하지만, dev 모드에서 sandbox 정책 차이로 일부 close 이벤트가 누락.

## 처방
- `electron/main.ts`에서 `webPreferences.contextIsolation: true` 유지 + `nodeIntegration: false`.
- **dev hot-reload 비활성**: `npm run dev`로 Vite는 계속 띄우되 Electron은 prod 빌드(`npm run build && npm run electron:start`)에서만 테스트.
- ws-client는 `useEffect`에서 `alive` flag로 closure 격리.

## 자기 점검
- 한 번에 1개 WS connection만 열려있는지: 브라우저 DevTools Network → WS 탭에서 connection 수 확인.
- last_seq가 단조 증가하는지: console.log 임시 추가.
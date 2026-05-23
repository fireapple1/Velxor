import { app, BrowserWindow, shell } from "electron";
import * as path from "node:path";

// Codex 2차 audit UI #6 MEDIUM 보강:
//   - sandbox: true (renderer 격리)
//   - navigation / window-open deny (외부 URL 차단)
//   - prod 시 dist/index.html loadFile, dev 시 vite dev URL
// CSP 는 dev server (vite) 가 헤더 추가 — index.html 에 meta CSP 도 가능하지만
// dev HMR 과 충돌 → prod build 시 별도 적용 권장 (defer).
const DEV_URL = "http://127.0.0.1:5173";
const PROD_INDEX = path.join(__dirname, "..", "dist", "index.html");

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // navigation 차단 — internal route 외 어떤 URL 도 새 페이지 로드 거부.
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(DEV_URL) && !url.startsWith("file://")) {
      event.preventDefault();
      console.warn("[velxor-electron] navigation blocked:", url);
    }
  });
  // window.open 도 external browser 로 위임 + 새 BrowserWindow 생성 거부.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => undefined);
    return { action: "deny" };
  });

  const isDev = !app.isPackaged && process.env.NODE_ENV !== "production";
  if (isDev) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(PROD_INDEX);
  }
});

app.on("window-all-closed", () => app.quit());
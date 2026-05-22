// Velxor Electron shell — contextIsolation:true, nodeIntegration:false.
// dev hot-reload는 명시적 OFF. UI 검증은 항상 `npm run build && npm run electron:start`.
// 자세한 사유: docs/electron-ws-footgun.md
"use strict";

const { app, BrowserWindow } = require("electron");
const path = require("path");

const DEV_SERVER_URL = process.env.VELXOR_UI_URL ?? "http://127.0.0.1:5173";
const DIST_INDEX = path.join(__dirname, "..", "dist", "index.html");
const USE_DEV_SERVER = process.env.VELXOR_UI_USE_DEV_SERVER === "1";

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: "#0c0f14",
    title: "Velxor — 행위 기반 랜섬웨어 탐지",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (USE_DEV_SERVER) {
    win.loadURL(DEV_SERVER_URL);
  } else {
    win.loadFile(DIST_INDEX);
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

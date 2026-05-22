import { app, BrowserWindow } from "electron";

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1280, height: 800,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL("http://127.0.0.1:5173");
});

app.on("window-all-closed", () => app.quit());
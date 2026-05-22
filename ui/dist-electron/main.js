"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.app.whenReady().then(() => {
    const win = new electron_1.BrowserWindow({
        width: 1280, height: 800,
        webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    win.loadURL("http://127.0.0.1:5173");
});
electron_1.app.on("window-all-closed", () => electron_1.app.quit());

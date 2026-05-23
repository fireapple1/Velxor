/* ------------------------------ */
/* Base & Reset */
/* ------------------------------ */
body, html, #root {
  margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden;
  background: #0b0f14; color: #e6edf3;
  font-family: "JetBrains Mono", "Fira Code", "Source Code Pro", monospace;
  font-size: 13px; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
}
* { box-sizing: border-box; }
button, input, textarea, select { font: inherit; }

/* ------------------------------ */
/* ★ PERFECT NEON GLOW HEXAGON (1:1 FIXED) */
/* ------------------------------ */
.cyber-node {
  position: relative;
  width: 150px;
  height: 130px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #E6EDF3;
  font-family: inherit;
  cursor: pointer;
  transition: transform 0.2s cubic-bezier(0.2, 1, 0.3, 1), filter 0.2s ease;
  box-sizing: border-box;
}

.cyber-node:hover {
  transform: translateY(-5px) scale(1.04);
}

.cyber-node-bg {
  position: absolute; inset: 0;
  clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
  z-index: 0; transition: background 0.2s ease;
}

.cyber-node-inner {
  position: absolute; inset: 2px;
  clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
  z-index: 0; transition: background 0.2s ease;
}

.cyber-normal .cyber-node-bg { background: #00C2FF; }
.cyber-normal .cyber-node-inner { background: #0b1118; }
.cyber-normal {
  filter: drop-shadow(0 0 4px #00C2FF) drop-shadow(0 0 12px rgba(0, 194, 255, 0.6));
}
.cyber-normal:hover, .cyber-normal.cyber-selected {
  filter: drop-shadow(0 0 6px #00C2FF) drop-shadow(0 0 24px #00C2FF) drop-shadow(0 0 36px rgba(0, 194, 255, 0.8));
}

.cyber-threat .cyber-node-bg { background: #ff3333; }
.cyber-threat .cyber-node-inner { background: #160404; color: #FF7B72; }
.cyber-threat { animation: cyberThreatPulse 0.8s cubic-bezier(0.25, 0.8, 0.25, 1) infinite; }

.cyber-killed { filter: grayscale(0.9); opacity: 0.45; }
.cyber-killed .cyber-node-bg { background: #444c56; }
.cyber-killed .cyber-node-inner { background: #12161a; color: #768390; }

.cyber-handle {
  width: 8px !important; height: 8px !important; border: none !important; z-index: 2;
}
.cyber-normal .cyber-handle { background: #00C2FF !important; box-shadow: 0 0 6px #00C2FF; }
.cyber-threat .cyber-handle { background: #ff3333 !important; box-shadow: 0 0 6px #ff3333; }
.cyber-killed .cyber-handle { background: #444c56; }

@keyframes cyberThreatPulse {
  0% { filter: drop-shadow(0 0 4px #ff3333) drop-shadow(0 0 12px rgba(255,51,51,0.5)); transform: scale(1); }
  50% { filter: drop-shadow(0 0 8px #ff3333) drop-shadow(0 0 28px #ff3333) drop-shadow(0 0 48px rgba(255,51,51,0.9)); transform: scale(1.03); }
  100% { filter: drop-shadow(0 0 4px #ff3333) drop-shadow(0 0 12px rgba(255,51,51,0.5)); transform: scale(1); }
}

/* ------------------------------ */
/* ★ Live Event Console */
/* ------------------------------ */
.live-console-panel {
  height: 138px;
  flex-shrink: 0;
  display: flex;
  width: 100%;
  background:
    radial-gradient(circle at 12% 0%, rgba(0, 255, 204, 0.08), transparent 28%),
    linear-gradient(180deg, rgba(10, 15, 20, 0.92), rgba(5, 8, 12, 0.98));
  border-top: 1px solid rgba(0, 255, 204, 0.18);
  border-bottom: 1px solid #1E2936;
  box-shadow:
    inset 0 1px 0 rgba(0, 255, 204, 0.12),
    0 -12px 28px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

.live-console-left-rail {
  width: 92px;
  flex-shrink: 0;
  background:
    linear-gradient(180deg, rgba(18, 24, 33, 0.95), rgba(10, 15, 20, 0.98));
  border-right: 1px solid rgba(0, 255, 204, 0.16);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: #00ffcc;
  letter-spacing: 1.5px;
  position: relative;
}

.live-console-left-rail::after {
  content: "";
  position: absolute;
  right: -1px;
  top: 12px;
  bottom: 12px;
  width: 1px;
  background: linear-gradient(180deg, transparent, #00ffcc, transparent);
  opacity: 0.5;
}

.live-console-rail-title {
  font-size: 10px;
  font-weight: 700;
  opacity: 0.7;
}

.live-console-rail-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #3fb950;
  box-shadow: 0 0 12px rgba(63, 185, 80, 0.8);
  animation: liveConsolePulse 1.1s infinite;
}

.live-console-rail-text {
  font-size: 10px;
  color: #8b949e;
}

.live-console-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.live-console-header {
  height: 28px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background: rgba(8, 12, 18, 0.85);
  border-bottom: 1px solid rgba(0, 255, 204, 0.12);
}

.live-console-title {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.live-console-title-glow {
  color: #00ffcc;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.4px;
  text-shadow: 0 0 10px rgba(0, 255, 204, 0.6);
}

.live-console-subtitle {
  color: #6e7681;
  font-size: 10px;
  letter-spacing: 0.6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.live-console-status {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #8b949e;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.8px;
}

.live-console-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  display: inline-block;
}

.live-console-status-connected {
  background: #3fb950;
  box-shadow: 0 0 10px rgba(63, 185, 80, 0.8);
}

.live-console-status-connecting {
  background: #d29922;
  box-shadow: 0 0 10px rgba(210, 153, 34, 0.8);
}

.live-console-status-disconnected {
  background: #ff4d4f;
  box-shadow: 0 0 10px rgba(255, 77, 79, 0.8);
}

.live-console-body {
  flex: 1;
  min-height: 0;
  padding: 8px 16px 10px;
  overflow-y: auto;
  overflow-x: hidden;
  font-size: 10.5px;
  line-height: 1.55;
  background:
    linear-gradient(rgba(0, 255, 204, 0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 255, 204, 0.018) 1px, transparent 1px);
  background-size: 22px 22px;
}

.live-console-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  white-space: nowrap;
  animation: consoleLineIn 0.18s ease-out;
}

.live-console-time {
  color: #6e7681;
  flex-shrink: 0;
}

.live-console-level {
  width: 72px;
  flex-shrink: 0;
  font-weight: 700;
}

.live-console-message {
  color: #9da7b3;
  overflow: hidden;
  text-overflow: ellipsis;
}

.live-console-system .live-console-level { color: #79c0ff; }
.live-console-info .live-console-level { color: #00c2ff; }
.live-console-success .live-console-level { color: #3fb950; }
.live-console-warn .live-console-level { color: #d29922; }
.live-console-crit .live-console-level { color: #ff4d4f; text-shadow: 0 0 10px rgba(255, 77, 79, 0.8); }
.live-console-trace .live-console-level { color: #00ffcc; }
.live-console-ws .live-console-level { color: #a371f7; }
.live-console-ai .live-console-level { color: #ff7bff; text-shadow: 0 0 10px rgba(255, 123, 255, 0.45); }

.live-console-crit .live-console-message {
  color: #ffb3b3;
}

.live-console-success .live-console-message {
  color: #b7f7c5;
}

@keyframes consoleLineIn {
  from {
    transform: translateY(5px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

@keyframes liveConsolePulse {
  0% { opacity: 0.45; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1.18); }
  100% { opacity: 0.45; transform: scale(0.9); }
}

/* ------------------------------ */
/* Ticker & Animations */
/* ------------------------------ */
.ticker-wrapper {
  width: 100%; overflow: hidden; background: rgba(8, 11, 15, 0.9); border-bottom: 1px solid #1E2936;
  color: #00ffcc; padding: 6px 0; display: flex;
}
.ticker-move {
  display: inline-block; white-space: nowrap; padding-left: 100%; animation: ticker 30s linear infinite;
}
.ticker-item { display: inline-block; padding: 0 40px; opacity: 0.8; }
@keyframes ticker { 0% { transform: translate3d(0, 0, 0); } 100% { transform: translate3d(-100%, 0, 0); } }
@keyframes slide-in { from { transform: translateX(24px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
@keyframes slide-down { from { transform: translateY(-100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

/* ------------------------------ */
/* Scrollbar & Selection */
/* ------------------------------ */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: #0f141b; }
::-webkit-scrollbar-thumb { background: #1e2936; border-radius: 999px; }
::-webkit-scrollbar-thumb:hover { background: #30363d; }
::selection { background: rgba(0, 194, 255, 0.2); color: #ffffff; }

/* ------------------------------ */
/* React Flow Override Component Styles */
/* ------------------------------ */
.react-flow { background: transparent !important; }
.react-flow__background { opacity: 0.35; }
.react-flow__edge-path { stroke: #2d3748 !important; stroke-width: 1.4 !important; }
.react-flow__controls {
  background: #121821 !important; border: 1px solid #1e2936 !important; border-radius: 14px !important;
  overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.02);
}
.react-flow__controls-button {
  width: 36px !important; height: 36px !important; background: #121821 !important; border-bottom: 1px solid #1e2936 !important;
  color: #8b949e !important; fill: #8b949e !important; transition: background 0.15s ease, color 0.15s ease;
}
.react-flow__controls-button:hover { background: #1a2330 !important; color: #e6edf3 !important; }
.react-flow__controls-button svg { fill: currentColor !important; }
.react-flow__minimap { display: none !important; }
.react-flow__attribution { background: transparent !important; color: #6e7681 !important; font-size: 10px !important; }
.react-flow__attribution a { color: #8b949e !important; text-decoration: none; }
.react-flow__attribution a:hover { color: #e6edf3 !important; }
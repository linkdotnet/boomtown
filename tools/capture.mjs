// Records site footage from the game's ?store showcase: node tools/capture.mjs [gameUrl] [shot names...]
// Needs the game's `npm run dev` running. Chrome runs headed because headless WebGL is software-rendered and stutters.
// Writes raw/<name>/{frames/*.jpg,frames.txt,start.jpg,end.jpg}; tools/encode.sh turns them into media/.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:5173/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 1280, H = 720, SCALE = 1.5, CLIP_MS = 9000, PORT = 9335;
// store = ?store scene; drag = orbit px (sign = direction); zoom = wheel per step (negative = in);
// setup = JS run before recording; ui = keep the game UI and take a still only; run = in-page promise that drives the camera instead of a drag, ms = its length.
const SHOTS = [
  { name: 'scene-1', store: 1, drag: 70, zoom: -0.6 },
  { name: 'scene-2', store: 2, drag: -60, zoom: -0.4 },
  { name: 'scene-3', store: 3, drag: 55, zoom: -0.3 },
  { name: 'scene-4', store: 4, drag: -45, zoom: 0 },
  { name: 'scene-5', store: 5, drag: 60, zoom: -0.5 },
  { name: 'grow', store: 'grow', run: 'storeGrow(24000)', ms: 24000 },
  { name: 'people', store: 1, ui: true, setup: `document.querySelector('[data-open="stats"]').click(); document.querySelector('[data-tab="people"]').click()` },
].filter((s) => process.argv.length < 4 || process.argv.slice(3).includes(s.name));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--window-size=${W + 40},${H + 140}`, '--no-first-run', '--no-default-browser-check',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'boomtown-site-'))}`, 'about:blank'], { stdio: 'ignore' });
let tabs = [];
for (let i = 0; i < 50 && !tabs.length; i++) { try { tabs = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === 'page'); } catch {} await sleep(200); }
const ws = new WebSocket(tabs[0].webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0, onFrame = null; const pending = {};
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.method === 'Page.screencastFrame') { send('Page.screencastFrameAck', { sessionId: d.params.sessionId }); onFrame?.(d.params); return; }
  pending[d.id]?.(d.result); delete pending[d.id];
};
const send = (method, params = {}) => new Promise((r) => { pending[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
const ready = async () => { for (let t = 0; t < 600; t++) { if (await evaluate('!!window.storeReady')) return; await sleep(250); } throw new Error('scene never became ready'); };
const still = async (file) => writeFileSync(file, Buffer.from((await send('Page.captureScreenshot', { format: 'jpeg', quality: 92 })).data, 'base64'));
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, ...extra });

// Slow right-drag orbit (MapControls damping smooths it) plus a gentle wheel dolly.
async function move(drag, zoom, ms) {
  const cx = W / 2, cy = H / 2, steps = Math.round(ms / 33);
  await mouse('mousePressed', cx, cy, { button: 'right', buttons: 2, clickCount: 1 });
  for (let s = 1; s <= steps; s++) {
    await mouse('mouseMoved', cx + (drag * s) / steps, cy, { button: 'right', buttons: 2 });
    if (zoom && s % 3 === 0) await mouse('mouseWheel', cx, cy, { deltaX: 0, deltaY: zoom });
    await sleep(33);
  }
  await mouse('mouseReleased', cx + drag, cy, { button: 'right', buttons: 0, clickCount: 1 });
}

try {
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: SCALE, mobile: false });
  for (const { name, store, drag, zoom, setup, ui, run, ms = CLIP_MS } of SHOTS) {
    const dir = `raw/${name}`; rmSync(dir, { recursive: true, force: true }); mkdirSync(`${dir}/frames`, { recursive: true });
    await send('Page.navigate', { url: `${BASE}?store=${store}` });
    await ready();
    // ?store forces the High preset; switch to Ultra through the Settings panel like a player would (closing it applies the change).
    await evaluate(`document.querySelector('[data-modal="settings"]').click(); document.querySelector('[data-preset="ultra"]').click(); dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    // Applying is async (shader rebuild); fx.apply() persists the settings once it runs.
    for (let t = 0; JSON.parse(await evaluate(`localStorage.getItem('metro:gfx')`)).preset !== 'ultra'; t++) { if (t > 80) throw new Error('Ultra preset not applied'); await sleep(250); }
    if (setup) await evaluate(setup);
    if (ui) { await evaluate(`void document.head.appendChild(Object.assign(document.createElement('style'),{textContent:'#storecap{display:none!important}'}))`); await sleep(2500); await still(`${dir}/start.jpg`); console.log(`${dir}: still`); continue; }
    // Hide every overlay (HUD, caption, toasts) so only the 3D view remains. Time stays paused: running the sim re-rolls the staged weather.
    await evaluate(`void document.head.appendChild(Object.assign(document.createElement('style'),{textContent:'body>:not(#view){display:none!important}'}))`);
    await sleep(4000);
    await still(`${dir}/start.jpg`);
    const frames = [];
    onFrame = (p) => { const f = `${dir}/frames/${String(frames.length).padStart(5, '0')}.jpg`; writeFileSync(f, Buffer.from(p.data, 'base64')); frames.push([f, p.metadata.timestamp]); };
    await send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: W * SCALE, maxHeight: H * SCALE, everyNthFrame: 1 });
    if (run) await send('Runtime.evaluate', { expression: run, awaitPromise: true, timeout: ms + 30000 }); else await move(drag, zoom, ms);
    await send('Page.stopScreencast'); onFrame = null;
    await sleep(600);
    await still(`${dir}/end.jpg`);
    // ffmpeg concat list with real frame durations (screencast frames arrive irregularly).
    writeFileSync(`${dir}/frames.txt`, frames.map(([f, t], i) => `file 'frames/${f.split('/').pop()}'\nduration ${((frames[i + 1]?.[1] ?? t + 1 / 30) - t).toFixed(4)}`).join('\n') + '\n');
    console.log(`${dir}: ${frames.length} frames`);
  }
} finally { ws.close(); chrome.kill(); }

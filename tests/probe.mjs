// Open the reader in headless Chrome at one size and print the value of an expression.
//   node tests/probe.mjs WIDTH HEIGHT FONTSIZE|0 "expression"
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = process.env.READER_URL || pathToFileURL(path.join(here, '..', 'index.html')).href;
const CHROME = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find(p => p && fs.existsSync(p));
const [w, h, fs_, expr] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const port = 9900 + Math.floor(Math.random() * 90);
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-probe-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 100 && !target; i++) {
  await sleep(150);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) { /* starting */ }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let id = 0;
const pending = new Map();
ws.onmessage = m => { const msg = JSON.parse(m.data); const p = pending.get(msg.id); if (p) { pending.delete(msg.id); p(msg); } };
const send = (method, params = {}) => new Promise(r => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); return r.result.exceptionDetails ? r.result.exceptionDetails : r.result.result.value; };

await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 2, mobile: +w < 1000 });
await send('Page.navigate', { url: PAGE });
await sleep(800);
await ev(`localStorage.clear(); localStorage.setItem('mi.hinted','1'); ${+fs_ ? `localStorage.setItem('mi.fs','${fs_}');` : ''} 1`);
await send('Page.reload', {});
for (let i = 0; i < 100; i++) {
  await sleep(150);
  if (await ev('!!(window.reader && !document.getElementById("app").classList.contains("booting") && document.fonts.status === "loaded")')) break;
}
console.log(JSON.stringify(await ev(expr), null, 1));
chrome.kill();
await sleep(200);
try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) { /* locked */ }
process.exit(0);

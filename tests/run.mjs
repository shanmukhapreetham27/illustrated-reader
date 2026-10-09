// Drive headless Chrome over the DevTools protocol: open index.html at
// phone, tablet and desktop sizes, run the reader's own self-tests and save screenshots.
//
//   node tests/run.mjs            all profiles, screenshots for phone + tablet
//   node tests/run.mjs phone      one profile
//
// Checks per profile (see readerSelfTest / readerButtonTest in src/reader.js):
//   - every picture is on the same page as its anchor phrase, whole, never overlapping text
//   - laying out twice gives identical DOM (deterministic layout)
//   - every SVG matches the fingerprint Node computed at build time (deterministic drawing)
//   - one Illustrate tap places every picture and keeps the reading position; a second hides them
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(path.join(here, '..', 'index.html')).href;
const OUT = path.join(here, 'out');
const CHROME = [process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(p => p && fs.existsSync(p));

const PROFILES = [
  { name: 'phone', w: 384, h: 700, dpr: 2, shots: true },        // Galaxy M34 in Chrome: measured viewport 384x700
  { name: 'tablet', w: 800, h: 1200, dpr: 1.5, shots: true },    // Galaxy Tab A 10.1 (SM-T515), portrait
  { name: 'tablet-landscape', w: 1280, h: 720, dpr: 1.5 },
  { name: 'small-phone', w: 360, h: 640, dpr: 2 },
  { name: 'phone-big-text', w: 384, h: 700, dpr: 2, fs: 24 },
  { name: 'desktop', w: 1366, h: 768, dpr: 1 },
];
const only = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ws.onmessage = m => {
      const msg = JSON.parse(m.data);
      const p = msg.id && this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
    };
  }
  open() { return new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; }); }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
}

async function waitFor(cdp, expr, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if (await cdp.eval(expr)) return; } catch (e) { /* page still loading */ }
    await sleep(100);
  }
  throw new Error('timed out waiting for ' + expr);
}

async function main() {
  if (!CHROME) throw new Error('Chrome or Edge not found; set CHROME=path');
  fs.mkdirSync(OUT, { recursive: true });
  const port = 9333 + Math.floor(Math.random() * 500);
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-test-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(150);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) { /* not up yet */ }
  }
  if (!target) throw new Error('Chrome did not start');
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const report = [];
  let failed = 0;
  for (const p of PROFILES) {
    if (only && p.name !== only) continue;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: p.w, height: p.h, deviceScaleFactor: p.dpr, mobile: p.w < 1000 });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await cdp.send('Page.navigate', { url: PAGE });
    await waitFor(cdp, 'document.readyState === "complete"');
    await cdp.eval(`localStorage.clear(); localStorage.setItem('mi.hinted', '1'); ${p.fs ? `localStorage.setItem('mi.fs', '${p.fs}');` : ''} true`);
    await cdp.send('Page.reload', { ignoreCache: true });
    await sleep(300);
    await waitFor(cdp, 'window.reader && !document.getElementById("app").classList.contains("booting") && document.fonts.status === "loaded"');

    const self = await cdp.eval('readerSelfTest()');
    const walk = await cdp.eval('readerButtonTest()');
    const ok = self.ok && walk.ok;
    if (!ok) failed++;
    report.push({ profile: p.name, ok, self, walk });

    console.log(`\n${ok ? 'PASS' : 'FAIL'}  ${p.name}  ${p.w}x${p.h}  font ${self.fontSize}px  column ${self.column.join('x')}  ${self.pages} pages`);
    for (const f of self.figures) {
      console.log(`      ${f.id} ${f.p.padEnd(3)} gap ${String(f.gap).padStart(3)}  page ${String(f.page).padStart(2)}  anchor ${f.anchorPages.join(',').padEnd(5)} ${String(f.place).padEnd(14)} ${f.svg.join('x').padEnd(8)} on page ${f.detailsOnPage} read ${f.detailsRead}  ${!f.follows ? 'BEFORE ITS TEXT' : !f.whole ? 'CUT' : f.aligned ? 'after text, same page' : f.nextPage ? 'after text, next page' : 'MISPLACED'}`);
    }
    console.log(`      layout with all pictures: ${self.layoutMs} ms   deterministic layout: ${self.deterministicLayout}   fingerprints: ${self.fingerprints.join(' ')}`);
    console.log(`      Illustrate button: ${walk.steps.join(' | ')}  -> ${walk.ok ? 'ok' : 'PROBLEM'}`);
    for (const pr of [...new Set([...self.problems, ...walk.problems])]) console.log('      problem: ' + pr);

    if (p.shots) {
      const dir = path.join(OUT, p.name);
      fs.mkdirSync(dir, { recursive: true });
      const shot = async name => {
        await cdp.eval('document.getElementById("toast").hidden = true; true');
        await sleep(120);
        const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from(r.data, 'base64'));
      };
      const shotWithToast = async name => {
        await sleep(120);
        const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from(r.data, 'base64'));
      };
      await cdp.eval('reader.setAll(false); reader.goTo(0); true');
      await shot('01-title');
      await cdp.eval('reader.illustrate({ instant: true }).then(() => true)');
      await shotWithToast('02-title-after-illustrate');
      await cdp.eval('reader.goTo(1); true');
      await shot('03-page2-illustrated');
      await cdp.eval('reader.toggleGround("f1"); true');
      await shot('03-grounded');
      await cdp.eval('reader.toggleGround("f1"); reader.selectPara("p2"); true');
      await shot('04-explain-button');
      await cdp.eval('reader.openExplain("p2"); true');
      await shot('05-explain');
      await cdp.eval('reader.closeSheet(); reader.setAll(true); true');
      const figs = await cdp.eval('Object.entries(reader.state().map).map(([id, m]) => [id, m.fig])');
      for (const [id, pg] of figs) {
        await cdp.eval(`reader.goTo(${pg}); true`);
        await shot(`fig-${id}`);
      }
      await cdp.eval(`document.documentElement.dataset.theme = 'dark'; reader.goTo(${figs.find(f => f[0] === 'f5')[1]}); true`);
      await shot('dark-f5');
      await cdp.eval(`document.documentElement.dataset.theme = 'dark'; reader.goTo(${figs.find(f => f[0] === 'f6')[1]}); true`);
      await shot('dark-f6');
      await cdp.eval('delete document.documentElement.dataset.theme; true');
    }
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  chrome.kill();
  await sleep(300);
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) { /* Chrome may still hold a lock */ }
  console.log(`\n${failed ? failed + ' profile(s) FAILED' : 'All profiles passed'}. Screenshots and report.json in tests/out/`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });

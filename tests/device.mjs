// Run an expression inside the reader open in Chrome on a USB-connected Android device.
//   node tests/device.mjs SERIAL "readerSelfTest()"
// Needs USB debugging. Uses Chrome's DevTools socket (adb forward ... localabstract:chrome_devtools_remote).
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const ADB = process.env.ADB || path.join(os.homedir(), 'AppData/Local/Android/Sdk/platform-tools/adb.exe');
const [serial, expr] = process.argv.slice(2);
const port = 9444;
execFileSync(ADB, ['-s', serial, 'forward', `tcp:${port}`, 'localabstract:chrome_devtools_remote']);
try {
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const tab = tabs.find(t => t.type === 'page' && /Metamorphosis, Illustrated/.test(t.title));
  if (!tab) throw new Error('reader tab not found; open it in Chrome first. Tabs: ' + tabs.map(t => t.title).join(' | '));
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const r = await new Promise(res => {
    ws.onmessage = m => { const msg = JSON.parse(m.data); if (msg.id === 1) res(msg.result); };
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
  });
  ws.close();
  console.log(JSON.stringify(r.exceptionDetails || r.result.value, null, 1));
} finally {
  execFileSync(ADB, ['-s', serial, 'forward', '--remove', `tcp:${port}`]);
}

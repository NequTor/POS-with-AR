import { spawn } from 'child_process';

const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--remote-debugging-port=9250',
  '--headless=new',
  '--user-data-dir=C:\\Users\\orcuu\\AppData\\Local\\Temp\\chrome-test-fs',
  '--no-first-run',
  '--no-default-browser-check'
]);

await new Promise(r => setTimeout(r, 1200));
const res = await fetch('http://127.0.0.1:9250/json');
const targets = await res.json();
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);

let id = 1;
const send = (method, params = {}) => new Promise(resolve => {
  const curId = id++;
  const handler = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id === curId) {
      ws.removeEventListener('message', handler);
      resolve(msg.result);
    }
  };
  ws.addEventListener('message', handler);
  ws.send(JSON.stringify({ id: curId, method, params }));
});

await send('Page.navigate', { url: 'http://localhost/masterfile/sales.html' });
await new Promise(r => setTimeout(r, 1500));

const testFs = await send('Runtime.evaluate', {
  expression: `(async () => {
    try {
      await document.documentElement.requestFullscreen();
      const isFs = Boolean(document.fullscreenElement);
      let lockSuccess = false;
      if (navigator.keyboard && navigator.keyboard.lock) {
        try {
          await navigator.keyboard.lock(['Escape']);
          lockSuccess = true;
        } catch (e) {
          return { isFs, lockError: e.toString() };
        }
      }
      await document.exitFullscreen();
      if (navigator.keyboard && navigator.keyboard.unlock) {
        navigator.keyboard.unlock();
      }
      return { isFs, lockSuccess };
    } catch (e) {
      return { error: e.toString() };
    }
  })()`,
  awaitPromise: true,
  userGesture: true,
  returnByValue: true
});

console.log('Result:', testFs.result.value);

ws.close();
chrome.kill();
process.exit(0);


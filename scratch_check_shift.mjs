import { spawn } from 'child_process';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const USER_DATA_DIR = 'C:\\Users\\orcuu\\AppData\\Local\\Temp\\chrome-check-shift-clean';
const PORT = 9226;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  const chrome = spawn(CHROME_PATH, [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    `--user-data-dir=${USER_DATA_DIR}`,
    '--no-first-run',
    '--no-default-browser-check'
  ]);

  for (let i = 0; i < 20; i++) {
    try {
      await sleep(300);
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) break;
    } catch (_) {}
  }

  const targetsRes = await fetch(`http://127.0.0.1:${PORT}/json`);
  const targets = await targetsRes.json();
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  let id = 1;
  const callbacks = new Map();
  let pageLoadResolver = null;

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && callbacks.has(msg.id)) {
      callbacks.get(msg.id)(msg.result);
      callbacks.delete(msg.id);
    } else if (msg.method === 'Page.loadEventFired') {
      if (pageLoadResolver) {
        pageLoadResolver();
        pageLoadResolver = null;
      }
    }
  };

  function send(method, params = {}) {
    return new Promise(resolve => {
      const curId = id++;
      callbacks.set(curId, resolve);
      ws.send(JSON.stringify({ id: curId, method, params }));
    });
  }

  function navigateTo(url) {
    return new Promise(async (resolve) => {
      pageLoadResolver = resolve;
      await send('Page.navigate', { url });
    });
  }

  async function evaluate(expr) {
    const res = await send('Runtime.evaluate', {
      expression: `(async () => {\n${expr}\n})()`,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      console.log('Exception in evaluate:', res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    }
    return res.result?.value;
  }

  await send('Runtime.enable');
  await send('Page.enable');

  console.log('1. Navigating to login.html...');
  await navigateTo('http://localhost/masterfile/login.html');
  await sleep(500);

  console.log('2. Submitting login credentials...');
  await evaluate(`
    document.getElementById('username').value = 'cashier';
    document.getElementById('password').value = 'cashier123';
    document.getElementById('login-form').dispatchEvent(new Event('submit'));
  `);
  await sleep(1500);

  console.log('3. Navigating to sales.html...');
  await navigateTo('http://localhost/masterfile/sales.html');
  await sleep(1500);

  console.log('4. Checking elements and hooks on sales.html...');
  const check = await evaluate(`
    return {
      url: window.location.href,
      hasBarcode: Boolean(document.getElementById('barcode-input')),
      hasHooks: Boolean(window.posTestHooks),
      shiftBadge: document.getElementById('pos-shift-badge')?.textContent,
      modalShowing: document.getElementById('beginning-cash-modal')?.classList.contains('show')
    };
  `);
  console.log('Check result:', check);

  // If beginning cash modal is showing, confirm it
  if (check && check.modalShowing) {
    console.log('Confirming beginning cash...');
    await evaluate(`
      const input = document.getElementById('beginning-cash-input');
      if (input) input.value = '500';
      document.getElementById('btn-confirm-beginning-cash')?.click();
    `);
    await sleep(1500);
  }

  console.log('5. Testing Alt+D keydown...');
  const altDResult = await evaluate(`
    const scan = document.getElementById('barcode-input');
    scan.focus();
    const ev = new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', altKey: true, bubbles: true, cancelable: true });
    scan.dispatchEvent(ev);
    await new Promise(r => setTimeout(r, 400));

    const modal = document.getElementById('discount-selection-modal');
    return {
      isShowing: modal && modal.classList.contains('show'),
      activeId: document.activeElement ? document.activeElement.id : null,
      phase: window.posTestHooks?.getDiscountState().phase
    };
  `);
  console.log('Alt+D result:', altDResult);

  ws.close();
  chrome.kill();
}

run().catch(console.error);

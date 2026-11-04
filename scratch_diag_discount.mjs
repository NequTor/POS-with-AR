import { spawn } from 'child_process';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const USER_DATA_DIR = 'C:\\Users\\orcuu\\AppData\\Local\\Temp\\chrome-diag-discount-profile';
const PORT = 9222;

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
  const consoleLogs = [];
  const pageErrors = [];

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && callbacks.has(msg.id)) {
      callbacks.get(msg.id)(msg.result);
      callbacks.delete(msg.id);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map(a => a.value || JSON.stringify(a)).join(' ');
      consoleLogs.push({ type: msg.params.type, text });
      console.log('[BROWSER CONSOLE]', text);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const text = msg.params.exceptionDetails?.text || 'Unknown Exception';
      pageErrors.push(msg.params.exceptionDetails);
      console.log('[BROWSER EXCEPTION]', text, msg.params.exceptionDetails?.exception?.description);
    }
  };

  function send(method, params = {}) {
    return new Promise(resolve => {
      const curId = id++;
      callbacks.set(curId, resolve);
      ws.send(JSON.stringify({ id: curId, method, params }));
    });
  }

  async function evaluate(expr) {
    const res = await send('Runtime.evaluate', {
      expression: `(() => {\n${expr}\n})()`,
      returnByValue: true
    });
    return res.result?.value;
  }

  await send('Runtime.enable');
  await send('Page.enable');

  console.log('Logging in...');
  await send('Page.navigate', { url: 'http://localhost/masterfile/login.html' });
  await sleep(1200);
  await evaluate(`
    document.getElementById('username').value = 'cashier';
    document.getElementById('password').value = 'cashier123';
    document.getElementById('login-form').dispatchEvent(new Event('submit'));
  `);
  await sleep(1500);

  console.log('Navigating to sales.html...');
  await send('Page.navigate', { url: 'http://localhost/masterfile/sales.html' });
  await sleep(1500);

  const currentUrl = await evaluate(`return window.location.href;`);
  console.log('CURRENT URL:', currentUrl);

  // Close float modal if open
  await evaluate(`
    const float = document.getElementById('beginning-cash-input');
    if (float) float.value = '500';
    document.getElementById('btn-confirm-beginning-cash')?.click();
    if (typeof Swal !== 'undefined') Swal.close();
  `);
  await sleep(500);

  // Check Discount elements in DOM
  const domCheck = await evaluate(`
    return {
      discountSection: Boolean(document.getElementById('discount-section')),
      btnOpenDiscountModal: Boolean(document.getElementById('btn-open-discount-modal')),
      btnHkDiscount: Boolean(document.getElementById('btn-hk-discount')),
      discountTypeEl: {
        exists: Boolean(document.getElementById('discount_type')),
        tagName: document.getElementById('discount_type')?.tagName,
        type: document.getElementById('discount_type')?.type
      },
      discountModalEl: {
        exists: Boolean(document.getElementById('discount-selection-modal')),
        isOpen: document.getElementById('discount-selection-modal')?.classList.contains('show'),
        display: window.getComputedStyle(document.getElementById('discount-selection-modal') || document.body).display
      }
    };
  `);
  console.log('DIAGNOSTIC DOM CHECK:', JSON.stringify(domCheck, null, 2));

  // Trace 1: Press Alt+D
  console.log('Dispatching Alt+D key event...');
  await evaluate(`
    const evt = new KeyboardEvent('keydown', {
      key: 'd',
      code: 'KeyD',
      keyCode: 68,
      which: 68,
      altKey: true,
      bubbles: true,
      cancelable: true
    });
    window.dispatchEvent(evt);
  `);
  await sleep(400);

  const stateAfterAltD = await evaluate(`
    return {
      modalOpen: document.getElementById('discount-selection-modal')?.classList.contains('show'),
      activeElementId: document.activeElement?.id,
      activeElementTag: document.activeElement?.tagName,
      activeElementType: document.activeElement?.type,
      scanFeedback: document.getElementById('scan-feedback')?.textContent.trim()
    };
  `);
  console.log('STATE AFTER ALT+D:', JSON.stringify(stateAfterAltD, null, 2));

  // Trace 2: Click #btn-open-discount-modal
  console.log('Clicking #btn-open-discount-modal...');
  await evaluate(`
    const btn = document.getElementById('btn-open-discount-modal');
    btn?.click();
  `);
  await sleep(400);

  const stateAfterClickControl = await evaluate(`
    return {
      modalOpen: document.getElementById('discount-selection-modal')?.classList.contains('show'),
      activeElementId: document.activeElement?.id,
      scanFeedback: document.getElementById('scan-feedback')?.textContent.trim()
    };
  `);
  console.log('STATE AFTER CLICK #btn-open-discount-modal:', JSON.stringify(stateAfterClickControl, null, 2));

  // Trace 3: Click #btn-hk-discount
  console.log('Clicking footer #btn-hk-discount...');
  await evaluate(`
    const btn = document.getElementById('btn-hk-discount');
    btn?.click();
  `);
  await sleep(400);

  const stateAfterClickFooter = await evaluate(`
    return {
      modalOpen: document.getElementById('discount-selection-modal')?.classList.contains('show'),
      activeElementId: document.activeElement?.id,
      scanFeedback: document.getElementById('scan-feedback')?.textContent.trim()
    };
  `);
  console.log('STATE AFTER CLICK FOOTER #btn-hk-discount:', JSON.stringify(stateAfterClickFooter, null, 2));

  console.log('Page Errors:', pageErrors.length);
  console.log('Console Logs:', consoleLogs.length);

  ws.close();
  chrome.kill();
}

run();

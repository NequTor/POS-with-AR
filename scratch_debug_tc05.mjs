import { spawn } from 'child_process';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const USER_DATA_DIR = 'C:\\Users\\orcuu\\AppData\\Local\\Temp\\chrome-debug-tc05';
const PORT = 9237;

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

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && callbacks.has(msg.id)) {
      callbacks.get(msg.id)(msg.result);
      callbacks.delete(msg.id);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map(a => a.value || JSON.stringify(a)).join(' ');
      console.log('[BROWSER CONSOLE]', text);
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

  await send('Page.navigate', { url: 'http://localhost/masterfile/login.html' });
  await sleep(1500);
  const onLogin = await evaluate(`return Boolean(document.getElementById('username'));`);
  if (onLogin) {
    await evaluate(`
      document.getElementById('username').value = 'cashier';
      document.getElementById('password').value = 'cashier123';
      document.getElementById('login-form').dispatchEvent(new Event('submit'));
    `);
    await sleep(2000);
  }

  await send('Page.navigate', { url: 'http://localhost/masterfile/sales.html' });
  for (let i = 0; i < 20; i++) {
    const hasHooks = await evaluate(`return Boolean(window.posTestHooks && document.getElementById('barcode-input'));`);
    if (hasHooks) break;
    await sleep(300);
  }

  // Setup cart
  await evaluate(`
    window.posTestHooks.clearCart();
    window.posTestHooks.pushCart({
      barcode: 'TEST100',
      description: 'Standard Test Item',
      unitPrice: 100.00,
      quantity: 1,
      unitCost: 70.00,
      taxRate: 12,
      promoRate: 0,
      isPromoApplied: false
    });
    window.posTestHooks.renderCart();
  `);

  const debugResult = await evaluate(`
    const modal = document.getElementById('discount-selection-modal');
    console.log('Initial modal show?', modal?.classList.contains('show'));

    const btn = document.getElementById('btn-open-discount-modal');
    console.log('Clicking btn-open-discount-modal...');
    btn.click();
    await new Promise(r => setTimeout(r, 450));

    console.log('Modal show after click?', modal?.classList.contains('show'));
    console.log('Active element after click?', document.activeElement?.id);

    console.log('Dispatching Escape on window...');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 600));

    console.log('Modal show after Esc (600ms)?', modal?.classList.contains('show'));
    console.log('Modal style display after Esc?', modal?.style.display);
    console.log('Active element after Esc?', document.activeElement?.id);

    return {
      modalShowAfterClick: modal?.classList.contains('show'),
      activeAfterClick: document.activeElement?.id,
      modalShowAfterEsc: modal?.classList.contains('show'),
      activeAfterEsc: document.activeElement?.id,
      cartLength: window.posTestHooks.getCart().length
    };
  `);

  console.log('Debug result:', debugResult);

  ws.close();
  chrome.kill();
}

run().catch(console.error);

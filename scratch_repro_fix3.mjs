import { spawn } from 'child_process';
import http from 'http';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const USER_DATA_DIR = 'C:\\Users\\orcuu\\AppData\\Local\\Temp\\chrome-repro-profile';
const PORT = 9223;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function run() {
  const chrome = spawn(CHROME_PATH, [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    `--user-data-dir=${USER_DATA_DIR}`,
    '--no-first-run'
  ]);
  await sleep(1500);

  const targets = await getJson('/json');
  const wsUrl = targets[0].webSocketDebuggerUrl;
  const ws = new WebSocket(wsUrl);

  let id = 1;
  const callbacks = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && callbacks.has(msg.id)) {
      callbacks.get(msg.id)(msg.result);
      callbacks.delete(msg.id);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      console.log('[BROWSER CONSOLE]', msg.params.args.map(a => a.value || JSON.stringify(a)).join(' '));
    }
  };
  await new Promise(r => ws.onopen = r);

  function send(method, params = {}) {
    return new Promise(resolve => {
      const curId = id++;
      callbacks.set(curId, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expr) {
    const res = await send('Runtime.evaluate', {
      expression: `(() => { ${expr} })()`,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      console.error('Eval error:', res.exceptionDetails);
    }
    return res.result?.value;
  }

  await send('Runtime.enable');
  await send('Page.enable');

  await send('Page.navigate', { url: 'http://localhost/masterfile/login.html' });
  await sleep(1000);
  await evaluate(`
    document.getElementById('username').value = 'cashier';
    document.getElementById('password').value = 'cashier123';
    document.getElementById('login-form').dispatchEvent(new Event('submit'));
  `);
  await sleep(1500);

  await send('Page.navigate', { url: 'http://localhost/masterfile/sales.html' });
  await sleep(1500);

  // Close float modal if open
  await evaluate(`
    const float = document.getElementById('beginning-cash-amount');
    if (float) float.value = '500';
    document.getElementById('btn-confirm-beginning-cash')?.click();
    if (typeof Swal !== 'undefined') Swal.close();
  `);
  await sleep(500);

  // Add 1 item to cart
  const cartBefore = await evaluate(`
    window.posTestHooks.setCart([{ productId: 1, barcode: '4800016644802', productName: 'Lucky Me Pancit Canton', unitPrice: 15.50, quantity: 2, promoId: null, promoRate: 0 }]);
    window.posTestHooks.renderCart();
    return {
      cartLength: window.posTestHooks.getCart().length,
      cartRows: document.querySelectorAll('#cart-table tbody tr').length,
      grandTotal: document.getElementById('pos-grand-total')?.textContent
    };
  `);
  console.log('Cart Before F2 Lookup:', cartBefore);

  // Open Lookup Modal (F2)
  console.log('Opening F2 Lookup modal...');
  await evaluate(`
    window.posTestHooks.openProductSearchModal();
  `);
  await sleep(500);

  const modalOpen = await evaluate(`
    const m = document.getElementById('product-search-modal');
    return {
      isOpen: m?.classList.contains('show'),
      activeId: document.activeElement?.id
    };
  `);
  console.log('Lookup Modal Open Status:', modalOpen);

  // Now press Escape via CDP
  console.log('Pressing Escape key...');
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27
  });
  await sleep(50);
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27
  });
  await sleep(500);

  const stateAfterEsc = await evaluate(`
    const m = document.getElementById('product-search-modal');
    const clearModal = document.getElementById('clear-cart-confirm-modal');
    return {
      lookupOpen: m?.classList.contains('show'),
      clearModalOpen: clearModal?.classList.contains('show'),
      cartLength: window.posTestHooks.getCart().length,
      cartRows: document.querySelectorAll('#cart-table tbody tr').length,
      grandTotal: document.getElementById('pos-grand-total')?.textContent,
      activeElementId: document.activeElement?.id
    };
  `);
  console.log('State After Escape:', stateAfterEsc);

  ws.close();
  chrome.kill();
}

run();


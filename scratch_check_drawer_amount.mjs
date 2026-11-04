import { spawn } from 'child_process';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const USER_DATA_DIR = 'C:\\Users\\orcuu\\AppData\\Local\\Temp\\chrome-qa-discount-profile';
const PORT = 9251;

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
      console.error('Eval error:', res.exceptionDetails);
    }
    return res.result?.value;
  }

  await send('Runtime.enable');
  await send('Page.enable');

  console.log('Navigating to login.html...');
  await send('Page.navigate', { url: 'http://localhost/masterfile/login.html' });
  await sleep(1500);
  const onLogin = await evaluate(`return Boolean(document.getElementById('username'));`);
  if (onLogin) {
    console.log('Submitting login credentials...');
    await evaluate(`
      document.getElementById('username').value = 'cashier';
      document.getElementById('password').value = 'cashier123';
      document.getElementById('login-submit-btn')?.click();
    `);
    await sleep(2500);
  }

  console.log('Navigating to sales.html...');
  await send('Page.navigate', { url: 'http://localhost/masterfile/sales.html' });
  await sleep(2000);
  for (let i = 0; i < 30; i++) {
    const status = await evaluate(`
      return {
        url: window.location.href,
        hasHooks: Boolean(window.posTestHooks),
        hasBarcode: Boolean(document.getElementById('barcode-input'))
      };
    `);
    if (status && status.hasHooks && status.hasBarcode) {
      console.log('posTestHooks ready on sales.html!');
      break;
    }
    await sleep(500);
  }

  // Handle Beginning Cash modal if present
  await evaluate(`
    const begModal = document.getElementById('beginning-cash-modal');
    if (begModal && begModal.classList.contains('show')) {
      const float = document.getElementById('beginning-cash-input');
      if (float) float.value = '500';
      document.getElementById('btn-confirm-beginning-cash')?.click();
    }
    if (typeof Swal !== 'undefined' && Swal.isVisible()) Swal.close();
  `);
  await sleep(1000);

  // Check 1: Initial HTML state of #drawer-event-amount
  console.log('\n--- Check 1: Initial HTML attribute / DOM value on load ---');
  const check1 = await evaluate(`
    const input = document.getElementById('drawer-event-amount');
    return {
      exists: Boolean(input),
      htmlValueAttr: input?.getAttribute('value'),
      currentValue: input?.value,
      minAttr: input?.getAttribute('min')
    };
  `);
  console.log('Check 1 Result:', check1);

  // Check 2: Value when opening Cash Drawer Movement via F7 / openDrawerEventModal()
  console.log('\n--- Check 2: Modal Open (Default Float Mode) ---');
  const check2 = await evaluate(`
    window.posTestHooks.openDrawerEventModal('float');
    await new Promise(r => setTimeout(r, 400));
    const input = document.getElementById('drawer-event-amount');
    const badge = document.getElementById('drawer-event-badge');
    const modal = document.getElementById('drawer-event-modal');
    return {
      modalShown: modal?.classList.contains('show'),
      badgeText: badge?.innerText.trim(),
      amountValue: input?.value
    };
  `);
  console.log('Check 2 Result:', check2);

  // Check 3: Value when switching to Lift (Drop/Skim)
  console.log('\n--- Check 3: Switch Movement Type to Lift ---');
  const check3 = await evaluate(`
    window.posTestHooks.setDrawerEventType('lift');
    await new Promise(r => setTimeout(r, 200));
    const input = document.getElementById('drawer-event-amount');
    const badge = document.getElementById('drawer-event-badge');
    return {
      badgeText: badge?.innerText.trim(),
      amountValue: input?.value
    };
  `);
  console.log('Check 3 Result:', check3);

  // Check 4: Value when switching back to Float
  console.log('\n--- Check 4: Switch Movement Type back to Float ---');
  const check4 = await evaluate(`
    window.posTestHooks.setDrawerEventType('float');
    await new Promise(r => setTimeout(r, 200));
    const input = document.getElementById('drawer-event-amount');
    const badge = document.getElementById('drawer-event-badge');
    return {
      badgeText: badge?.innerText.trim(),
      amountValue: input?.value
    };
  `);
  console.log('Check 4 Result:', check4);

  // Check 5: User editing & typing custom values
  console.log('\n--- Check 5: User Editing of Numeric Amount ---');
  const check5 = await evaluate(`
    const input = document.getElementById('drawer-event-amount');
    input.value = '750.50';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      editedValue: input.value,
      parsedNum: parseFloat(input.value)
    };
  `);
  console.log('Check 5 Result:', check5);

  // Check 6: Modal Close and Reopen resets cleanly to 0
  console.log('\n--- Check 6: Close Modal and Reopen Fresh ---');
  const check6 = await evaluate(`
    const modalEl = document.getElementById('drawer-event-modal');
    bootstrap.Modal.getInstance(modalEl)?.hide();
    await new Promise(r => setTimeout(r, 500));

    // Reopen modal via hotkey / openDrawerEventModal
    window.posTestHooks.openDrawerEventModal('float');
    await new Promise(r => setTimeout(r, 400));

    const input = document.getElementById('drawer-event-amount');
    return {
      reopenedValue: input?.value
    };
  `);
  console.log('Check 6 Result:', check6);

  await evaluate(`
    const modalEl = document.getElementById('drawer-event-modal');
    bootstrap.Modal.getInstance(modalEl)?.hide();
  `);

  const allPassed = check1.currentValue === '0' &&
                    check2.amountValue === '0' &&
                    check3.amountValue === '0' &&
                    check4.amountValue === '0' &&
                    check5.editedValue === '750.50' &&
                    check6.reopenedValue === '0';

  console.log('\n==============================');
  console.log('VERIFICATION SUMMARY:');
  console.log('All Checks Passed:', allPassed);
  console.log('==============================');

  ws.close();
  chrome.kill();
  process.exit(allPassed ? 0 : 1);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});

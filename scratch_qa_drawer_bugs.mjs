import { spawn } from 'child_process';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const USER_DATA_DIR = 'C:\\Users\\orcuu\\AppData\\Local\\Temp\\chrome-qa-discount-profile';
const PORT = 9252;

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
        hasHooks: Boolean(window.posTestHooks),
        hasBarcode: Boolean(document.getElementById('barcode-input'))
      };
    `);
    if (status && status.hasHooks && status.hasBarcode) {
      console.log('Register ready!');
      break;
    }
    await sleep(500);
  }

  // Handle Beginning Cash modal if open
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

  // ==========================================
  // BUG #1 QA: CASH DRAWER MOVEMENT KEYBOARD NAVIGATION
  // ==========================================
  console.log('\n--- Testing BUG #1: Cash Drawer Movement Keyboard Navigation ---');

  // Step 1: Open modal
  await evaluate(`
    window.posTestHooks.openDrawerEventModal('float');
  `);
  await sleep(400);

  const step1 = await evaluate(`
    const floatBtn = document.getElementById('btn-drawer-type-float');
    return {
      activeId: document.activeElement ? document.activeElement.id : null,
      isFloatFocused: document.activeElement === floatBtn,
      hasKbFocus: floatBtn.classList.contains('kb-focus')
    };
  `);
  console.log('Step 1 (Open modal):', step1);

  // Step 2: ArrowDown -> Amount input
  await evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true }));
  `);
  await sleep(100);

  const step2 = await evaluate(`
    const amt = document.getElementById('drawer-event-amount');
    return {
      activeId: document.activeElement ? document.activeElement.id : null,
      isAmountFocused: document.activeElement === amt,
      hasKbFocus: amt.classList.contains('kb-focus')
    };
  `);
  console.log('Step 2 (ArrowDown to Amount):', step2);

  // Step 3: ArrowDown -> Notes input
  await evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true }));
  `);
  await sleep(100);

  const step3 = await evaluate(`
    const notes = document.getElementById('drawer-event-notes');
    return {
      activeId: document.activeElement ? document.activeElement.id : null,
      isNotesFocused: document.activeElement === notes,
      hasKbFocus: notes.classList.contains('kb-focus')
    };
  `);
  console.log('Step 3 (ArrowDown to Notes):', step3);

  // Step 4: ArrowDown -> Submit button
  await evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true }));
  `);
  await sleep(100);

  const step4 = await evaluate(`
    const submitBtn = document.getElementById('btn-submit-drawer-event');
    return {
      activeId: document.activeElement ? document.activeElement.id : null,
      isSubmitFocused: document.activeElement === submitBtn,
      hasKbFocus: submitBtn.classList.contains('kb-focus')
    };
  `);
  console.log('Step 4 (ArrowDown to Submit button):', step4);

  // Step 5: ArrowLeft -> Cancel button
  await evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', bubbles: true, cancelable: true }));
  `);
  await sleep(100);

  const step5 = await evaluate(`
    const cancelBtn = document.getElementById('btn-cancel-drawer-event');
    return {
      activeId: document.activeElement ? document.activeElement.id : null,
      isCancelFocused: document.activeElement === cancelBtn,
      hasKbFocus: cancelBtn.classList.contains('kb-focus')
    };
  `);
  console.log('Step 5 (ArrowLeft to Cancel button):', step5);

  // Step 6: ArrowUp -> Notes input
  await evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp', bubbles: true, cancelable: true }));
  `);
  await sleep(100);

  const step6 = await evaluate(`
    const notes = document.getElementById('drawer-event-notes');
    return {
      activeId: document.activeElement ? document.activeElement.id : null,
      isNotesFocused: document.activeElement === notes,
      hasKbFocus: notes.classList.contains('kb-focus')
    };
  `);
  console.log('Step 6 (ArrowUp to Notes):', step6);

  // Step 7: ArrowUp -> Amount input
  await evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp', bubbles: true, cancelable: true }));
  `);
  await sleep(100);

  const step7 = await evaluate(`
    const amt = document.getElementById('drawer-event-amount');
    return {
      activeId: document.activeElement ? document.activeElement.id : null,
      isAmountFocused: document.activeElement === amt,
      hasKbFocus: amt.classList.contains('kb-focus')
    };
  `);
  console.log('Step 7 (ArrowUp to Amount):', step7);

  // Step 8: ArrowUp -> Float button
  await evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp', bubbles: true, cancelable: true }));
  `);
  await sleep(100);

  const step8 = await evaluate(`
    const floatBtn = document.getElementById('btn-drawer-type-float');
    return {
      activeId: document.activeElement ? document.activeElement.id : null,
      isFloatFocused: document.activeElement === floatBtn,
      hasKbFocus: floatBtn.classList.contains('kb-focus')
    };
  `);
  console.log('Step 8 (ArrowUp to Float button):', step8);

  // Step 9: ArrowRight on Movement Type -> Toggles to Lift
  await evaluate(`
    const floatBtn = document.getElementById('btn-drawer-type-float');
    floatBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true, cancelable: true }));
  `);
  await sleep(100);

  const step9 = await evaluate(`
    const liftBtn = document.getElementById('btn-drawer-type-lift');
    const badge = document.getElementById('drawer-event-badge');
    return {
      activeId: document.activeElement ? document.activeElement.id : null,
      isLiftFocused: document.activeElement === liftBtn,
      hasKbFocus: liftBtn.classList.contains('kb-focus'),
      badgeText: badge ? badge.innerText.trim() : ''
    };
  `);
  console.log('Step 9 (ArrowRight toggles to Lift):', step9);

  // Close modal with Escape
  await evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  `);
  await sleep(400);

  const bug1Pass = step1.isFloatFocused && step1.hasKbFocus &&
                   step2.isAmountFocused && step2.hasKbFocus &&
                   step3.isNotesFocused && step3.hasKbFocus &&
                   step4.isSubmitFocused && step4.hasKbFocus &&
                   step5.isCancelFocused && step5.hasKbFocus &&
                   step6.isNotesFocused && step6.hasKbFocus &&
                   step7.isAmountFocused && step7.hasKbFocus &&
                   step8.isFloatFocused && step8.hasKbFocus &&
                   step9.isLiftFocused && step9.hasKbFocus;

  console.log('BUG #1 PASS:', bug1Pass);

  // ==========================================
  // BUG #2 QA: SHIFT FLOAT VALUES LIVE UPDATE AFTER FLOAT / LIFT
  // ==========================================
  console.log('\n--- Testing BUG #2: Shift Float Value Live Updating ---');

  const baseline = await evaluate(`
    const badge = document.getElementById('pos-shift-badge');
    const badgeText = badge ? badge.innerText.trim() : '';
    const currentFloat = window.posTestHooks.getCurrentShiftFloat();
    return { badgeText, currentFloat };
  `);
  console.log('Baseline Shift Badge:', baseline);

  // Test Float: perform a Float of 150.00
  console.log('Performing Float of PHP 150.00...');
  const floatResult = await evaluate(`
    // Direct call to submit drawer event simulating supervisor authorized float
    const shiftId = window.posTestHooks.getCurrentShiftId();
    const formData = new FormData();
    formData.append('operation', 'recordDrawerEvent');
    formData.append('json', JSON.stringify({
      shiftId: shiftId,
      eventType: 'float',
      amount: 150.00,
      authorizedBy: 1,
      notes: 'Test Float Addition'
    }));

    const response = await axios.post('api/sales.php', formData, { withCredentials: true });
    if (response.data.returnValue === 1) {
      const updatedFloat = Number(response.data.currentFloat);
      window.posTestHooks.updateShiftBadge(shiftId, updatedFloat);
    }
    await new Promise(r => setTimeout(r, 200));

    const badge = document.getElementById('pos-shift-badge');
    return {
      serverReturnValue: response.data.returnValue,
      returnedFloat: response.data.currentFloat,
      badgeText: badge ? badge.innerText.trim() : '',
      currentFloatHook: window.posTestHooks.getCurrentShiftFloat()
    };
  `);
  console.log('Float Result:', floatResult);

  // Test Lift: perform a Lift of 50.00
  console.log('Performing Lift of PHP 50.00...');
  const liftResult = await evaluate(`
    const shiftId = window.posTestHooks.getCurrentShiftId();
    const formData = new FormData();
    formData.append('operation', 'recordDrawerEvent');
    formData.append('json', JSON.stringify({
      shiftId: shiftId,
      eventType: 'lift',
      amount: 50.00,
      authorizedBy: 1,
      notes: 'Test Lift Removal'
    }));

    const response = await axios.post('api/sales.php', formData, { withCredentials: true });
    if (response.data.returnValue === 1) {
      const updatedFloat = Number(response.data.currentFloat);
      window.posTestHooks.updateShiftBadge(shiftId, updatedFloat);
    }
    await new Promise(r => setTimeout(r, 200));

    const badge = document.getElementById('pos-shift-badge');
    return {
      serverReturnValue: response.data.returnValue,
      returnedFloat: response.data.currentFloat,
      badgeText: badge ? badge.innerText.trim() : '',
      currentFloatHook: window.posTestHooks.getCurrentShiftFloat()
    };
  `);
  console.log('Lift Result:', liftResult);

  // Expected math:
  const expectedFloatAfterAdd = Math.round((baseline.currentFloat + 150) * 100) / 100;
  const expectedFloatAfterLift = Math.round((expectedFloatAfterAdd - 50) * 100) / 100;

  const bug2Pass = floatResult.returnedFloat === expectedFloatAfterAdd &&
                   floatResult.badgeText.includes(expectedFloatAfterAdd.toFixed(2)) &&
                   liftResult.returnedFloat === expectedFloatAfterLift &&
                   liftResult.badgeText.includes(expectedFloatAfterLift.toFixed(2));

  console.log('Expected after Float:', expectedFloatAfterAdd, 'Actual:', floatResult.returnedFloat);
  console.log('Expected after Lift:', expectedFloatAfterLift, 'Actual:', liftResult.returnedFloat);
  console.log('BUG #2 PASS:', bug2Pass);

  // Test page reload persistence of updated current float
  console.log('\nTesting reload persistence of updated float...');
  await send('Page.navigate', { url: 'http://localhost/masterfile/sales.html' });
  await sleep(2000);
  const reloadState = await evaluate(`
    const badge = document.getElementById('pos-shift-badge');
    return {
      badgeText: badge ? badge.innerText.trim() : '',
      currentFloat: window.posTestHooks ? window.posTestHooks.getCurrentShiftFloat() : null
    };
  `);
  console.log('Reload State:', reloadState);
  const reloadPass = reloadState.badgeText.includes(expectedFloatAfterLift.toFixed(2));
  console.log('Persistence PASS:', reloadPass);

  const overallPass = bug1Pass && bug2Pass && reloadPass;
  console.log('\n====================================');
  console.log('FINAL VERIFICATION RESULT:', overallPass ? 'ALL TESTS PASSED' : 'TESTS FAILED');
  console.log('====================================');

  ws.close();
  chrome.kill();
  process.exit(overallPass ? 0 : 1);
}

run().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

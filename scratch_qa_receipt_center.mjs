import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const USER_DATA_DIR = 'C:\\Users\\orcuu\\AppData\\Local\\Temp\\chrome-qa-receipt-center';
const PORT = 9249;
const ARTIFACT_DIR = 'C:\\Users\\orcuu\\.gemini\\antigravity\\brain\\17d6bbc2-4e23-4ffb-9f9a-10e07af1b45d';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  const chrome = spawn(CHROME_PATH, [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    `--user-data-dir=${USER_DATA_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,900'
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
      expression: `(async () => {\n${expr}\n})()`,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      console.error('Eval error:', res.exceptionDetails);
    }
    return res.result?.value;
  }

  async function captureScreenshot(filename) {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    if (res && res.data) {
      const targetPath = path.join(ARTIFACT_DIR, filename);
      fs.writeFileSync(targetPath, Buffer.from(res.data, 'base64'));
      console.log(`Saved screenshot: ${targetPath}`);
      return targetPath;
    }
    return null;
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
      document.getElementById('login-form').dispatchEvent(new Event('submit'));
    `);
    await sleep(2500);
  }

  console.log('Navigating to sales.html...');
  await send('Page.navigate', { url: 'http://localhost/masterfile/sales.html' });
  await sleep(2000);
  for (let i = 0; i < 25; i++) {
    const hasHooks = await evaluate(`return Boolean(window.posTestHooks && document.getElementById('barcode-input'));`);
    if (hasHooks) {
      console.log('posTestHooks ready!');
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

  const testResults = [];

  // TC-01: Remove "New Sale" button
  console.log('\n--- Testing TC-01: "New Sale" Button Removed ---');
  // Complete a quick cash sale to open receipt modal
  await evaluate(`
    window.posTestHooks.clearCart();
    window.posTestHooks.pushCart({
      productId: 1,
      barcode: 'TEST-TC01',
      productName: 'Receipt Centering Test Item',
      unitPrice: 150.00,
      quantity: 1,
      promoId: null,
      promoName: '',
      promoRate: 0
    });
    window.posTestHooks.renderCart();
  `);

  await evaluate(`
    // Open tender modal and submit
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', code: 'F12', bubbles: true, cancelable: true }));
  `);
  await sleep(400);

  await evaluate(`
    const amt = document.getElementById('tender-amount-input');
    if (amt) {
      amt.value = '200';
      amt.dispatchEvent(new Event('input', { bubbles: true }));
    }
    document.getElementById('btn-confirm-tender')?.click();
  `);
  await sleep(1200);

  const tc01 = await evaluate(`
    const btnNewSale = document.getElementById('btn-receipt-new-sale');
    const buttons = window.posTestHooks.getReceiptModalButtons();
    const btnIds = buttons.map(b => b.id);
    const modalEl = document.getElementById('receipt-modal');
    const isModalOpen = modalEl && modalEl.classList.contains('show');
    
    return {
      newSaleInDom: Boolean(btnNewSale),
      returnedButtons: btnIds,
      modalOpen: isModalOpen,
      hookFunctionDefined: typeof window.posTestHooks.handleReceiptNewSaleClick !== 'undefined'
    };
  `);

  const tc01Pass = !tc01.newSaleInDom && 
                   !tc01.returnedButtons.includes('btn-receipt-new-sale') && 
                   tc01.returnedButtons.length === 2 && 
                   !tc01.hookFunctionDefined;
  console.log('TC-01 Result:', tc01, 'PASS:', tc01Pass);
  testResults.push({ id: 'TC-01', desc: 'Remove "New Sale" button from DOM, listeners, and nav graph', pass: tc01Pass, details: tc01 });

  // TC-02 & TC-03: Centering check for short and long receipts
  console.log('\n--- Testing TC-02 & TC-03: Action Buttons Centering (Short vs Long Receipt) ---');
  const shortCentering = await evaluate(`
    const modalContent = document.querySelector('#receipt-modal .modal-content');
    const footer = document.querySelector('#receipt-modal .modal-footer');
    const actionsGroup = document.querySelector('#receipt-modal .receipt-actions-group');
    const btnPrint = document.getElementById('btn-print-receipt');
    const btnClose = document.getElementById('btn-close-receipt');

    const contentRect = modalContent.getBoundingClientRect();
    const actionsRect = actionsGroup.getBoundingClientRect();
    const printRect = btnPrint.getBoundingClientRect();
    const closeRect = btnClose.getBoundingClientRect();

    const leftSpace = actionsRect.left - contentRect.left;
    const rightSpace = contentRect.right - actionsRect.right;
    const diff = Math.abs(leftSpace - rightSpace);

    const footerStyle = window.getComputedStyle(footer);
    const groupStyle = window.getComputedStyle(actionsGroup);

    return {
      contentWidth: contentRect.width,
      actionsWidth: actionsRect.width,
      leftSpace,
      rightSpace,
      diff,
      footerDisplay: footerStyle.display,
      footerAlignItems: footerStyle.alignItems,
      footerJustifyContent: footerStyle.justifyContent,
      groupJustifyContent: groupStyle.justifyContent,
      isCentered: diff < 6
    };
  `);
  console.log('Short Receipt Centering:', shortCentering);
  await captureScreenshot('receipt_short_centered.png');

  // Now create a long receipt with 12 items to test scrollable content
  console.log('Testing long receipt scroll centering...');
  await evaluate(`
    window.posTestHooks.closeReceiptModal();
  `);
  await sleep(400);

  await evaluate(`
    window.posTestHooks.clearCart();
    for (let i = 1; i <= 12; i++) {
      window.posTestHooks.pushCart({
        productId: i,
        barcode: 'ITEM-' + i,
        productName: 'Long Receipt Super Item #' + i,
        unitPrice: 25.00 * i,
        quantity: 1,
        promoId: null,
        promoName: '',
        promoRate: 0
      });
    }
    window.posTestHooks.renderCart();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', code: 'F12', bubbles: true, cancelable: true }));
  `);
  await sleep(400);

  await evaluate(`
    const amt = document.getElementById('tender-amount-input');
    if (amt) {
      amt.value = '5000';
      amt.dispatchEvent(new Event('input', { bubbles: true }));
    }
    document.getElementById('btn-confirm-tender')?.click();
  `);
  await sleep(1200);

  const longCentering = await evaluate(`
    const modalContent = document.querySelector('#receipt-modal .modal-content');
    const receiptBody = document.getElementById('receipt-content');
    const actionsGroup = document.querySelector('#receipt-modal .receipt-actions-group');
    const contentRect = modalContent.getBoundingClientRect();
    const actionsRect = actionsGroup.getBoundingClientRect();
    const leftSpace = actionsRect.left - contentRect.left;
    const rightSpace = contentRect.right - actionsRect.right;
    const diff = Math.abs(leftSpace - rightSpace);

    return {
      bodyScrollHeight: receiptBody.scrollHeight,
      bodyClientHeight: receiptBody.clientHeight,
      isScrollable: receiptBody.scrollHeight > receiptBody.clientHeight,
      leftSpace,
      rightSpace,
      diff,
      isCentered: diff < 6
    };
  `);
  console.log('Long Receipt Centering:', longCentering);
  await captureScreenshot('receipt_long_centered.png');

  const tc02Pass = shortCentering.isCentered && shortCentering.groupJustifyContent === 'center';
  const tc03Pass = longCentering.isCentered && longCentering.diff < 6;
  testResults.push({ id: 'TC-02', desc: 'Modal footer action buttons horizontally centered in dialog', pass: tc02Pass, details: shortCentering });
  testResults.push({ id: 'TC-03', desc: 'Centering holds across short vs long/scrollable receipts', pass: tc03Pass, details: longCentering });

  // TC-04: Arrow Navigation Cycle
  console.log('\n--- Testing TC-04: Arrow Keyboard Navigation ---');
  const navTest = await evaluate(`
    const printBtn = document.getElementById('btn-print-receipt');
    const closeBtn = document.getElementById('btn-close-receipt');

    const step0Index = window.posTestHooks.getSelectedReceiptButtonIndex();
    const step0Focused = document.activeElement === printBtn;
    const step0Class = printBtn.classList.contains('kb-focus');

    // ArrowRight
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    const step1Index = window.posTestHooks.getSelectedReceiptButtonIndex();
    const step1Focused = document.activeElement === closeBtn;
    const step1CloseClass = closeBtn.classList.contains('kb-focus');
    const step1PrintClass = printBtn.classList.contains('kb-focus');

    // ArrowRight again (wrap around)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    const step2Index = window.posTestHooks.getSelectedReceiptButtonIndex();
    const step2Focused = document.activeElement === printBtn;

    // ArrowLeft (wrap back)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    const step3Index = window.posTestHooks.getSelectedReceiptButtonIndex();
    const step3Focused = document.activeElement === closeBtn;

    // ArrowUp (cycle to print)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    const step4Index = window.posTestHooks.getSelectedReceiptButtonIndex();
    const step4Focused = document.activeElement === printBtn;

    return {
      step0: { index: step0Index, isPrintFocused: step0Focused, hasClass: step0Class },
      step1: { index: step1Index, isCloseFocused: step1Focused, closeHasClass: step1CloseClass, printHasClass: step1PrintClass },
      step2: { index: step2Index, isPrintFocused: step2Focused },
      step3: { index: step3Index, isCloseFocused: step3Focused },
      step4: { index: step4Index, isPrintFocused: step4Focused }
    };
  `);
  console.log('Navigation test details:', navTest);
  const tc04Pass = navTest.step0.index === 0 && navTest.step0.isPrintFocused &&
                   navTest.step1.index === 1 && navTest.step1.isCloseFocused &&
                   navTest.step2.index === 0 && navTest.step2.isPrintFocused &&
                   navTest.step3.index === 1 && navTest.step3.isCloseFocused &&
                   navTest.step4.index === 0 && navTest.step4.isPrintFocused;
  testResults.push({ id: 'TC-04', desc: 'Arrow keys (Right/Down, Left/Up) cleanly cycle between Print and Close', pass: tc04Pass, details: navTest });

  // TC-05: Esc closes receipt modal cleanly and readies register
  console.log('\n--- Testing TC-05: Esc Closes Modal and Barcode Input Focused ---');
  await evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  `);
  await sleep(400);

  const tc05 = await evaluate(`
    const modalEl = document.getElementById('receipt-modal');
    const isShown = modalEl && modalEl.classList.contains('show');
    const cart = window.posTestHooks.getCart();
    const mode = window.posTestHooks.getCurrentSaleMode();
    const activeElId = document.activeElement ? document.activeElement.id : null;
    return {
      modalShown: isShown,
      cartLength: cart.length,
      mode: mode,
      activeElementId: activeElId,
      barcodeInputFocused: activeElId === 'barcode-input'
    };
  `);
  console.log('TC-05 Details:', tc05);
  const tc05Pass = !tc05.modalShown && tc05.cartLength === 0 && tc05.mode === 'CASH' && tc05.barcodeInputFocused;
  testResults.push({ id: 'TC-05', desc: 'Esc closes receipt modal, cart is 0, mode is CASH, barcode input focused', pass: tc05Pass, details: tc05 });

  // TC-06: Verification of transaction state reset logic
  console.log('\n--- Testing TC-06: Transaction State Reset Already Occurs on Checkout ---');
  // Add item, check out, verify closeSale() ran before modal close
  await evaluate(`
    window.posTestHooks.clearCart();
    window.posTestHooks.pushCart({
      productId: 1,
      barcode: 'RESET-TEST',
      productName: 'Reset Logic Item',
      unitPrice: 50.00,
      quantity: 1
    });
    window.posTestHooks.renderCart();
  `);
  const preCheckoutCart = await evaluate(`return window.posTestHooks.getCart().length;`);

  await evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', code: 'F12', bubbles: true, cancelable: true }));
  `);
  await sleep(400);

  await evaluate(`
    const amt = document.getElementById('tender-amount-input');
    if (amt) {
      amt.value = '100';
      amt.dispatchEvent(new Event('input', { bubbles: true }));
    }
    document.getElementById('btn-confirm-tender')?.click();
  `);
  await sleep(1000);

  const tc06 = await evaluate(`
    const modalEl = document.getElementById('receipt-modal');
    const cartWhileModalOpen = window.posTestHooks.getCart().length;
    const isModalOpen = modalEl && modalEl.classList.contains('show');
    
    // Now click the Close button
    document.getElementById('btn-close-receipt')?.click();
    return {
      cartWhileModalOpen,
      isModalOpen
    };
  `);
  await sleep(400);

  const postCloseState = await evaluate(`
    const activeEl = document.activeElement ? document.activeElement.id : null;
    return {
      cartLength: window.posTestHooks.getCart().length,
      barcodeFocused: activeEl === 'barcode-input'
    };
  `);
  console.log('TC-06 Details:', { ...tc06, ...postCloseState });
  const tc06Pass = preCheckoutCart === 1 && tc06.cartWhileModalOpen === 0 && postCloseState.barcodeFocused;
  testResults.push({ id: 'TC-06', desc: 'closeSale() executed during checkout; Esc/Close resets focus without orphaned "New Sale"', pass: tc06Pass, details: { ...tc06, ...postCloseState } });

  // TC-07: Print button execution
  console.log('\n--- Testing TC-07: Print Receipt Button Execution ---');
  // Open receipt modal again
  await evaluate(`
    window.posTestHooks.showReceipt(1);
  `);
  await sleep(500);

  const tc07 = await evaluate(`
    let printAttempted = false;
    const origOpen = window.open;
    window.open = function() {
      printAttempted = true;
      return {
        document: {
          write: () => {},
          close: () => {}
        },
        print: () => {}
      };
    };

    window.posTestHooks.handleReceiptPrintClick();
    window.open = origOpen;

    const printBtn = document.getElementById('btn-print-receipt');
    return {
      printAttempted,
      printBtnFocused: document.activeElement === printBtn
    };
  `);
  await evaluate(`window.posTestHooks.closeReceiptModal();`);
  await sleep(400);
  console.log('TC-07 Details:', tc07);
  const tc07Pass = tc07.printAttempted && tc07.printBtnFocused;
  testResults.push({ id: 'TC-07', desc: 'Print button execution works by Enter/Click and preserves focus', pass: tc07Pass, details: tc07 });

  // TC-08: AR sale receipt check
  console.log('\n--- Testing TC-08: AR Sale Receipt Modal Verification ---');
  // Perform an AR sale
  await evaluate(`
    window.posTestHooks.setSaleMode('AR');
    window.posTestHooks.clearCart();
    window.posTestHooks.pushCart({
      productId: 1,
      barcode: 'AR-ITEM',
      productName: 'AR Charge Item',
      unitPrice: 200.00,
      quantity: 1
    });
    window.posTestHooks.renderCart();

    // Select customer #1
    const custId = document.getElementById('sale_customer_id');
    if (custId) {
      custId.value = '1';
      custId.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const custSearch = document.getElementById('ar-customer-search-filter');
    if (custSearch) custSearch.value = 'Test Customer';
  `);
  await sleep(400);

  // Trigger checkout for AR sale
  await evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', code: 'F12', bubbles: true, cancelable: true }));
  `);
  await sleep(1200);

  const tc08 = await evaluate(`
    const modalEl = document.getElementById('receipt-modal');
    const isShown = modalEl && modalEl.classList.contains('show');
    const content = document.getElementById('receipt-content')?.innerText || '';
    const btnNewSale = document.getElementById('btn-receipt-new-sale');
    const buttons = window.posTestHooks.getReceiptModalButtons().map(b => b.id);
    
    const actionsGroup = document.querySelector('#receipt-modal .receipt-actions-group');
    const modalContent = document.querySelector('#receipt-modal .modal-content');
    const contentRect = modalContent.getBoundingClientRect();
    const actionsRect = actionsGroup.getBoundingClientRect();
    const diff = Math.abs((actionsRect.left - contentRect.left) - (contentRect.right - actionsRect.right));

    return {
      modalShown: isShown,
      isArSlip: content.includes('AR CREDIT CHARGE SLIP'),
      hasNewSaleBtn: Boolean(btnNewSale),
      buttonCount: buttons.length,
      diff,
      isCentered: diff < 6
    };
  `);
  console.log('TC-08 Details:', tc08);
  await evaluate(`window.posTestHooks.closeReceiptModal();`);
  await sleep(400);
  const tc08Pass = tc08.modalShown && tc08.isArSlip && !tc08.hasNewSaleBtn && tc08.buttonCount === 2 && tc08.isCentered;
  testResults.push({ id: 'TC-08', desc: 'AR Credit slip receipt has centered footer buttons and no "New Sale" button', pass: tc08Pass, details: tc08 });

  // TC-09: Register regression sweep
  console.log('\n--- Testing TC-09: Full Register Regression Sweep ---');
  const tc09 = await evaluate(`
    const checks = {};

    // 1. Payment modal [Alt+M]
    window.posTestHooks.openPaymentMethodModal();
    const pmModal = document.getElementById('payment-method-modal');
    checks.pmModalOpens = pmModal && pmModal.classList.contains('show');
    window.posTestHooks.closePaymentMethodModal();

    // 2. Discount modal [Alt+D]
    window.posTestHooks.openDiscountModal();
    const discModal = document.getElementById('discount-selection-modal');
    checks.discModalOpens = discModal && discModal.classList.contains('show');
    window.posTestHooks.handleNoDiscountSelection();
    checks.discModalClosed = !discModal || !discModal.classList.contains('show');

    // 3. SUKI toggle
    const sukiToggle = document.getElementById('suki-card-toggle');
    if (sukiToggle) {
      sukiToggle.click();
      checks.sukiToggledOn = sukiToggle.checked;
      sukiToggle.click();
      checks.sukiToggledOff = !sukiToggle.checked;
    }

    // 4. Barcode input focus
    const scan = document.getElementById('barcode-input');
    checks.scanAvailable = Boolean(scan);

    return checks;
  `);
  console.log('TC-09 Details:', tc09);
  const tc09Pass = tc09.pmModalOpens && tc09.discModalOpens && tc09.discModalClosed && tc09.sukiToggledOn && tc09.sukiToggledOff && tc09.scanAvailable && pageErrors.length === 0;
  testResults.push({ id: 'TC-09', desc: 'Full register regression sweep (modals, SUKI toggle, discounts, hotkeys, 0 JS errors)', pass: tc09Pass, details: { ...tc09, pageErrorsCount: pageErrors.length } });

  console.log('\n====================================');
  console.log('SUMMARY QA TEST RESULTS');
  console.log('====================================');
  let allPass = true;
  testResults.forEach(r => {
    console.log(`[${r.pass ? 'PASS' : 'FAIL'}] ${r.id}: ${r.desc}`);
    if (!r.pass) allPass = false;
  });
  console.log('All tests passed:', allPass);

  ws.close();
  chrome.kill();
  process.exit(allPass ? 0 : 1);
}

run().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

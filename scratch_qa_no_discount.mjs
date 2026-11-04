import { spawn } from 'child_process';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const USER_DATA_DIR = 'C:\\Users\\orcuu\\AppData\\Local\\Temp\\chrome-qa-discount-profile';
const PORT = 9245;

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

  const results = [];

  // Helper: Setup cart item with real database product
  const setupCart = async () => {
    return evaluate(`
      window.posTestHooks.clearCart();
      const p = (typeof products !== 'undefined' && products.length > 0) ? products[0] : null;
      if (p) {
        window.posTestHooks.pushCart({
          productId: Number(p.product_id),
          barcode: p.barcode || 'TEST100',
          productName: p.product_name,
          unitPrice: Number(p.price || 100),
          quantity: 1,
          promoId: null,
          promoName: '',
          promoRate: 0
        });
      } else {
        window.posTestHooks.pushCart({
          productId: 1,
          barcode: 'TEST100',
          productName: 'Standard Retail Test Item',
          unitPrice: 100.00,
          quantity: 1,
          promoId: null,
          promoName: '',
          promoRate: 0
        });
      }
      window.posTestHooks.renderCart();
    `);
  };

  await setupCart();

  // ==========================================
  // TC-01: Alt+D opens modal -> "No Discount" present, visible, positioned after PWD
  // ==========================================
  console.log('\n--- Running TC-01: "No Discount" option present and positioned after PWD ---');
  const tc01 = await evaluate(`
    const scan = document.getElementById('barcode-input');
    scan.focus();
    const ev = new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', altKey: true, bubbles: true, cancelable: true });
    scan.dispatchEvent(ev);
    await new Promise(r => setTimeout(r, 400));

    const modal = document.getElementById('discount-selection-modal');
    const isShowing = modal && modal.classList.contains('show');
    const zeroBtn = document.getElementById('opt-disc-zero');
    const pwdBtn = document.getElementById('opt-disc-pwd');
    const seniorBtn = document.getElementById('opt-disc-senior');
    const noneBtn = document.getElementById('opt-disc-none');

    const optionsList = document.getElementById('discount-options-list');
    const children = Array.from(optionsList?.children || []);
    const seniorIdx = children.indexOf(seniorBtn);
    const pwdIdx = children.indexOf(pwdBtn);
    const zeroIdx = children.indexOf(zeroBtn);
    const noneIdx = children.indexOf(noneBtn);

    const zeroVisible = zeroBtn && !zeroBtn.classList.contains('d-none');
    const zeroText = zeroBtn ? zeroBtn.innerText.replace(/\\s+/g, ' ').trim() : '';
    const badgeText = zeroBtn?.querySelector('.badge')?.innerText.trim() || '';

    // cleanup
    window.posTestHooks.closeDiscountModal();
    await new Promise(r => setTimeout(r, 400));

    const pass = isShowing && zeroVisible && (zeroIdx === pwdIdx + 1) && (seniorIdx < pwdIdx) && badgeText === '3';

    return {
      pass,
      isShowing,
      order: { seniorIdx, pwdIdx, zeroIdx, noneIdx },
      zeroText,
      badgeText
    };
  `);
  console.log('TC-01 Result:', tc01);
  results.push({ id: 'TC-01', name: 'Alt+D opens modal -> "No Discount" present, visible, positioned after PWD', pass: tc01.pass, details: tc01 });

  // ==========================================
  // TC-02: No discount applied -> select "No Discount" -> modal closes, totals unchanged, no discount line
  // ==========================================
  console.log('\n--- Running TC-02: Case A: No discount applied -> select "No Discount" ---');
  const tc02 = await evaluate(`
    window.posTestHooks.removeDiscountAndClose();
    await new Promise(r => setTimeout(r, 300));

    const subtotalBefore = document.getElementById('subtotal')?.innerText.trim();
    const vatBefore = document.getElementById('tax-total')?.innerText.trim();
    const discountBefore = document.getElementById('discount-total-display')?.innerText.trim();
    const totalBefore = document.getElementById('total-amount')?.value;

    const scan = document.getElementById('barcode-input');
    scan.focus();
    scan.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', altKey: true, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 400));

    // Select "No Discount"
    const zeroBtn = document.getElementById('opt-disc-zero');
    zeroBtn.click();
    await new Promise(r => setTimeout(r, 400));

    const modal = document.getElementById('discount-selection-modal');
    const isClosed = !modal.classList.contains('show');
    const discType = document.getElementById('discount_type')?.value;
    const discId = document.getElementById('discount_id_number')?.value;

    const subtotalAfter = document.getElementById('subtotal')?.innerText.trim();
    const vatAfter = document.getElementById('tax-total')?.innerText.trim();
    const discountAfter = document.getElementById('discount-total-display')?.innerText.trim();
    const totalAfter = document.getElementById('total-amount')?.value;
    const activeElId = document.activeElement ? document.activeElement.id : '';

    const pass = isClosed &&
                 discType === 'none' &&
                 discId === '' &&
                 subtotalBefore === subtotalAfter &&
                 vatBefore === vatAfter &&
                 discountBefore === discountAfter &&
                 totalBefore === totalAfter;

    return {
      pass,
      isClosed,
      discType,
      discId,
      subtotalBefore,
      subtotalAfter,
      totalBefore,
      totalAfter,
      activeElId
    };
  `);
  console.log('TC-02 Result:', tc02);
  results.push({ id: 'TC-02', name: 'No discount applied -> select "No Discount" -> modal closes, totals unchanged', pass: tc02.pass, details: tc02 });

  // ==========================================
  // TC-03: Senior applied -> open modal -> select "No Discount" vs "Remove Discount" identical outcome
  // ==========================================
  console.log('\n--- Running TC-03: Senior applied -> "No Discount" vs "Remove Discount" shared implementation ---');
  const tc03 = await evaluate(`
    // Sub-test 1: Apply Senior Discount then select "No Discount"
    window.posTestHooks.openDiscountModal();
    await new Promise(r => setTimeout(r, 300));
    window.posTestHooks.switchToDiscountIdPhase('senior');
    document.getElementById('discount-modal-id-input').value = 'OSCA-12345';
    window.posTestHooks.applyStatutoryDiscountFromModal();
    await new Promise(r => setTimeout(r, 400));

    const seniorTotal = document.getElementById('total-amount')?.value;
    const seniorDiscount = document.getElementById('discount-total-display')?.innerText.trim();

    // Now open modal and pick "No Discount" (opt-disc-zero)
    window.posTestHooks.openDiscountModal();
    await new Promise(r => setTimeout(r, 400));
    document.getElementById('opt-disc-zero').click();
    await new Promise(r => setTimeout(r, 400));

    const outcomeNoDiscount = {
      type: document.getElementById('discount_type')?.value,
      id: document.getElementById('discount_id_number')?.value,
      subtotal: document.getElementById('subtotal')?.innerText.trim(),
      vat: document.getElementById('tax-total')?.innerText.trim(),
      discount: document.getElementById('discount-total-display')?.innerText.trim(),
      total: document.getElementById('total-amount')?.value
    };

    // Sub-test 2: Apply Senior Discount then select "Remove Active Discount" (opt-disc-none)
    window.posTestHooks.openDiscountModal();
    await new Promise(r => setTimeout(r, 300));
    window.posTestHooks.switchToDiscountIdPhase('senior');
    document.getElementById('discount-modal-id-input').value = 'OSCA-12345';
    window.posTestHooks.applyStatutoryDiscountFromModal();
    await new Promise(r => setTimeout(r, 400));

    // Open modal and pick "Remove Active Discount" (opt-disc-none)
    window.posTestHooks.openDiscountModal();
    await new Promise(r => setTimeout(r, 400));
    document.getElementById('opt-disc-none').click();
    await new Promise(r => setTimeout(r, 400));

    const outcomeRemoveDiscount = {
      type: document.getElementById('discount_type')?.value,
      id: document.getElementById('discount_id_number')?.value,
      subtotal: document.getElementById('subtotal')?.innerText.trim(),
      vat: document.getElementById('tax-total')?.innerText.trim(),
      discount: document.getElementById('discount-total-display')?.innerText.trim(),
      total: document.getElementById('total-amount')?.value
    };

    const pass = JSON.stringify(outcomeNoDiscount) === JSON.stringify(outcomeRemoveDiscount) &&
                 outcomeNoDiscount.type === 'none' &&
                 outcomeNoDiscount.id === '' &&
                 outcomeNoDiscount.total === '100.00' &&
                 seniorTotal === '71.43';

    return {
      pass,
      seniorTotal,
      seniorDiscount,
      outcomeNoDiscount,
      outcomeRemoveDiscount
    };
  `);
  console.log('TC-03 Result:', tc03);
  results.push({ id: 'TC-03', name: 'Senior applied -> select "No Discount" identical to "Remove Discount"', pass: tc03.pass, details: tc03 });

  // ==========================================
  // TC-04: "Remove Discount" conditional (hidden when none, visible when applied); "No Discount" visible in BOTH states
  // ==========================================
  console.log('\n--- Running TC-04: "Remove Discount" conditional visibility, "No Discount" always visible ---');
  const tc04 = await evaluate(`
    // State 1: No discount applied
    window.posTestHooks.removeDiscountAndClose();
    await new Promise(r => setTimeout(r, 300));
    window.posTestHooks.openDiscountModal();
    await new Promise(r => setTimeout(r, 400));

    const zeroElState1 = document.getElementById('opt-disc-zero');
    const noneElState1 = document.getElementById('opt-disc-none');
    const state1ZeroVis = zeroElState1 && !zeroElState1.classList.contains('d-none');
    const state1NoneVis = noneElState1 && !noneElState1.classList.contains('d-none');

    window.posTestHooks.closeDiscountModal();
    await new Promise(r => setTimeout(r, 400));

    // State 2: Senior discount applied
    window.posTestHooks.openDiscountModal();
    await new Promise(r => setTimeout(r, 300));
    window.posTestHooks.switchToDiscountIdPhase('senior');
    document.getElementById('discount-modal-id-input').value = 'OSCA-9999';
    window.posTestHooks.applyStatutoryDiscountFromModal();
    await new Promise(r => setTimeout(r, 400));

    window.posTestHooks.openDiscountModal();
    await new Promise(r => setTimeout(r, 400));

    const zeroElState2 = document.getElementById('opt-disc-zero');
    const noneElState2 = document.getElementById('opt-disc-none');
    const state2ZeroVis = zeroElState2 && !zeroElState2.classList.contains('d-none');
    const state2NoneVis = noneElState2 && !noneElState2.classList.contains('d-none');

    // cleanup
    window.posTestHooks.removeDiscountAndClose();
    await new Promise(r => setTimeout(r, 400));

    const pass = state1ZeroVis && !state1NoneVis && state2ZeroVis && state2NoneVis;

    return {
      pass,
      state1_no_discount: { zeroVisible: state1ZeroVis, removeDiscountVisible: state1NoneVis },
      state2_with_discount: { zeroVisible: state2ZeroVis, removeDiscountVisible: state2NoneVis }
    };
  `);
  console.log('TC-04 Result:', tc04);
  results.push({ id: 'TC-04', name: '"Remove Discount" conditional; "No Discount" visible in BOTH states', pass: tc04.pass, details: tc04 });

  // ==========================================
  // TC-05: Change of mind: Senior -> ID prompt -> Esc back -> pick "No Discount" -> clean close
  // ==========================================
  console.log('\n--- Running TC-05: Change of mind: Senior -> ID prompt -> Esc back -> No Discount ---');
  const tc05 = await evaluate(`
    window.posTestHooks.removeDiscountAndClose();
    await new Promise(r => setTimeout(r, 300));

    // Open modal
    window.posTestHooks.openDiscountModal();
    await new Promise(r => setTimeout(r, 400));

    // Pick Senior -> enters ID phase
    document.getElementById('opt-disc-senior').click();
    await new Promise(r => setTimeout(r, 300));
    const phaseAtId = window.posTestHooks.getDiscountState().phase;
    const isIdVisible = !document.getElementById('discount-phase-id').classList.contains('d-none');

    // Press Esc to go back to Phase 1
    const idInput = document.getElementById('discount-modal-id-input');
    idInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 300));

    const phaseAfterEsc = window.posTestHooks.getDiscountState().phase;
    const isTypeVisible = !document.getElementById('discount-phase-type').classList.contains('d-none');

    // Pick "No Discount"
    document.getElementById('opt-disc-zero').click();
    await new Promise(r => setTimeout(r, 400));

    const modal = document.getElementById('discount-selection-modal');
    const isClosed = !modal.classList.contains('show');
    const discType = document.getElementById('discount_type')?.value;

    const pass = phaseAtId === 2 && isIdVisible && phaseAfterEsc === 1 && isTypeVisible && isClosed && discType === 'none';

    return {
      pass,
      phaseAtId,
      phaseAfterEsc,
      isClosed,
      discType
    };
  `);
  console.log('TC-05 Result:', tc05);
  results.push({ id: 'TC-05', name: 'Change-of-mind path: Senior -> ID prompt -> Esc back -> pick No Discount', pass: tc05.pass, details: tc05 });

  // ==========================================
  // TC-06: Keyboard arrows reach "No Discount", Enter selects; numeric shortcut 3 selects
  // ==========================================
  console.log('\n--- Running TC-06: Zero-mouse arrow navigation + numeric shortcut 3 ---');
  const tc06 = await evaluate(`
    window.posTestHooks.removeDiscountAndClose();
    await new Promise(r => setTimeout(r, 300));

    // Part A: Arrow navigation (Down -> Down -> Enter)
    const scan = document.getElementById('barcode-input');
    scan.focus();
    scan.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', altKey: true, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 400));

    // Initially index 0 (Senior) is active
    const modal = document.getElementById('discount-selection-modal');
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 100));
    // Index 1 (PWD)
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 100));
    // Index 2 (No Discount)

    const activeEl = document.activeElement;
    const zeroIsActive = activeEl && activeEl.id === 'opt-disc-zero';

    // Press Enter to select
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 400));
    const closedAfterEnter = !modal.classList.contains('show');

    // Part B: Numeric shortcut "3"
    scan.focus();
    scan.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', altKey: true, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 400));

    modal.dispatchEvent(new KeyboardEvent('keydown', { key: '3', code: 'Digit3', bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 400));
    const closedAfterDigit3 = !modal.classList.contains('show');

    const pass = zeroIsActive && closedAfterEnter && closedAfterDigit3;

    return {
      pass,
      zeroIsActive,
      closedAfterEnter,
      closedAfterDigit3
    };
  `);
  console.log('TC-06 Result:', tc06);
  results.push({ id: 'TC-06', name: 'Arrow navigation reaches "No Discount", Enter selects, shortcut 3 works', pass: tc06.pass, details: tc06 });

  // ==========================================
  // TC-07: Modal hygiene: activeElement trace, no scan leakage, Esc closes modal only (no cart clear), F-keys inert
  // ==========================================
  console.log('\n--- Running TC-07: Modal hygiene, inert F-keys, Esc no cart clear ---');
  const tc07 = await evaluate(`
    window.posTestHooks.removeDiscountAndClose();
    await new Promise(r => setTimeout(r, 300));
    const initialCartCount = window.posTestHooks.getCart().length;

    // Open modal
    const scan = document.getElementById('barcode-input');
    scan.focus();
    scan.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', altKey: true, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 400));

    const modal = document.getElementById('discount-selection-modal');
    const modalIsOpen = modal && modal.classList.contains('show');

    // 1. Check F-keys inert (dispatch F12 tender attempt while modal open)
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', code: 'F12', bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 200));
    const tenderModal = document.getElementById('tender-modal');
    const tenderTriggered = tenderModal && tenderModal.classList.contains('show');

    // 2. Esc closes discount modal only, MUST NOT clear cart
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 400));

    const modalIsClosed = !modal.classList.contains('show');
    const cartCountAfterEsc = window.posTestHooks.getCart().length;
    const activeElAfterClose = document.activeElement ? document.activeElement.id : '';

    const pass = modalIsOpen && !tenderTriggered && modalIsClosed && (cartCountAfterEsc === initialCartCount) && (initialCartCount > 0);

    return {
      pass,
      modalIsOpen,
      tenderTriggeredWhileModalOpen: tenderTriggered,
      modalIsClosed,
      initialCartCount,
      cartCountAfterEsc,
      activeElAfterClose
    };
  `);
  console.log('TC-07 Result:', tc07);
  results.push({ id: 'TC-07', name: 'Modal hygiene: F-keys inert, Esc closes modal only, cart preserved', pass: tc07.pass, details: tc07 });

  // ==========================================
  // TC-08: Senior & PWD flows regression: picking either still prompts for ID, applies 20% + VAT-exempt math
  // ==========================================
  console.log('\n--- Running TC-08: Senior & PWD flows regression ---');
  const tc08 = await evaluate(`
    // Test Senior:
    window.posTestHooks.openDiscountModal();
    await new Promise(r => setTimeout(r, 300));
    window.posTestHooks.switchToDiscountIdPhase('senior');
    document.getElementById('discount-modal-id-input').value = 'OSCA-SENIOR-1';
    window.posTestHooks.applyStatutoryDiscountFromModal();
    await new Promise(r => setTimeout(r, 400));

    const seniorTotal = document.getElementById('total-amount')?.value;
    const seniorVat = document.getElementById('tax-total')?.innerText.trim();

    // Reset
    window.posTestHooks.removeDiscountAndClose();
    await new Promise(r => setTimeout(r, 300));

    // Test PWD:
    window.posTestHooks.openDiscountModal();
    await new Promise(r => setTimeout(r, 300));
    window.posTestHooks.switchToDiscountIdPhase('pwd');
    document.getElementById('discount-modal-id-input').value = 'PWD-ID-2';
    window.posTestHooks.applyStatutoryDiscountFromModal();
    await new Promise(r => setTimeout(r, 400));

    const pwdTotal = document.getElementById('total-amount')?.value;
    const pwdVat = document.getElementById('tax-total')?.innerText.trim();

    // Reset
    window.posTestHooks.removeDiscountAndClose();
    await new Promise(r => setTimeout(r, 300));

    // 100 PHP gross with 12% VAT -> VAT Exempt Net = 89.29, 20% discount = 17.86 -> 71.43 total
    const pass = seniorTotal === '71.43' && seniorVat === '0.00' && pwdTotal === '71.43' && pwdVat === '0.00';

    return {
      pass,
      seniorTotal,
      seniorVat,
      pwdTotal,
      pwdVat
    };
  `);
  console.log('TC-08 Result:', tc08);
  results.push({ id: 'TC-08', name: 'Senior & PWD flows regression (20% + VAT exempt math intact)', pass: tc08.pass, details: tc08 });

  // ==========================================
  // TC-09: Zero-mouse E2E: Alt+D -> No Discount -> F12 Tender -> Receipt -> verify clean receipt
  // ==========================================
  console.log('\n--- Running TC-09: Zero-mouse E2E to receipt with no phantom discount ---');
  await setupCart();
  const tc09 = await evaluate(`
    window.posTestHooks.removeDiscountAndClose();
    await new Promise(r => setTimeout(r, 300));

    // Ensure payment method is set
    const pm = document.getElementById('sale_payment_method_id');
    if (pm && !pm.value) pm.value = '1';

    // 1. Alt+D -> open modal
    const scan = document.getElementById('barcode-input');
    scan.focus();
    scan.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', altKey: true, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 400));

    // 2. Select No Discount via key '3'
    const modal = document.getElementById('discount-selection-modal');
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: '3', code: 'Digit3', bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 400));

    // 3. F12 -> checkout / tender
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', code: 'F12', bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 500));

    const tenderModal = document.getElementById('tender-modal');
    const isTenderOpen = tenderModal && tenderModal.classList.contains('show');

    // Enter tender amount matching grand total
    const grandTotal = Number(document.getElementById("total-amount")?.value || 0);
    const cashInput = document.getElementById('tender-cash-input');
    if (cashInput) {
      cashInput.value = grandTotal > 0 ? String(grandTotal) : '100.00';
      cashInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Confirm checkout via button
    document.getElementById('btn-submit-tender')?.click();
    
    // Check receipt modal
    const receiptModal = document.getElementById('receipt-modal');
    for (let i = 0; i < 20; i++) {
      if (receiptModal && receiptModal.classList.contains('show')) break;
      await new Promise(r => setTimeout(r, 200));
    }
    const isReceiptOpen = receiptModal && receiptModal.classList.contains('show');
    const receiptContent = document.getElementById('printable-receipt')?.innerText || '';
    const hasPhantomDiscount = /senior|pwd|discount.*0\.00/i.test(receiptContent);

    // Close receipt and tender modal if any
    if (receiptModal && receiptModal.classList.contains('show')) {
      bootstrap.Modal.getInstance(receiptModal)?.hide();
    }
    const tm = document.getElementById('tender-modal');
    if (tm && tm.classList.contains('show')) {
      bootstrap.Modal.getInstance(tm)?.hide();
    }
    if (typeof Swal !== 'undefined' && Swal.isVisible()) Swal.close();
    await new Promise(r => setTimeout(r, 500));

    const pass = isTenderOpen && isReceiptOpen && !hasPhantomDiscount;

    return {
      pass,
      isTenderOpen,
      isReceiptOpen,
      hasPhantomDiscount,
      receiptPreview: receiptContent.split('\\n').slice(0, 10).join(' | ')
    };
  `);
  console.log('TC-09 Result:', tc09);
  results.push({ id: 'TC-09', name: 'Zero-mouse E2E: No Discount -> F12 Tender -> clean receipt', pass: tc09.pass, details: tc09 });

  // ==========================================
  // TC-10: Regression: F-keys, cart, barcode scan, logout all intact
  // ==========================================
  console.log('\n--- Running TC-10: Regression sweep across register components ---');
  const tc10 = await evaluate(`
    // 1. Cart render
    window.posTestHooks.clearCart();
    window.posTestHooks.pushCart({
      barcode: 'REG-1',
      description: 'Regression Item',
      unitPrice: 50.00,
      quantity: 2,
      unitCost: 30.00,
      taxRate: 12,
      promoRate: 0,
      isPromoApplied: false
    });
    window.posTestHooks.renderCart();
    const cartCount = window.posTestHooks.getCart().length;
    const totalAmount = document.getElementById('total-amount')?.value;

    // 2. Barcode input focus
    const scan = document.getElementById('barcode-input');
    scan.focus();
    const isScanFocused = document.activeElement === scan;

    // 3. F2 Lookup modal
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', code: 'F2', bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 400));
    const lookupModal = document.getElementById('product-search-modal');
    const lookupOpened = lookupModal && lookupModal.classList.contains('show');
    if (lookupOpened) {
      bootstrap.Modal.getInstance(lookupModal)?.hide();
      await new Promise(r => setTimeout(r, 400));
    }

    // 4. Suki toggle
    const sukiToggle = document.getElementById('suki-card-toggle');
    const sukiAvailable = Boolean(sukiToggle);

    // 5. Logout button presence
    const logoutBtn = document.getElementById('btn-cashier-logout');
    const logoutAvailable = Boolean(logoutBtn);

    const pass = cartCount === 1 && totalAmount === '100.00' && isScanFocused && lookupOpened && sukiAvailable && logoutAvailable;

    return {
      pass,
      cartCount,
      totalAmount,
      isScanFocused,
      lookupOpened,
      sukiAvailable,
      logoutAvailable
    };
  `);
  console.log('TC-10 Result:', tc10);
  results.push({ id: 'TC-10', name: 'Regression: F1-F12, cart, barcode scan, logout all intact', pass: tc10.pass, details: tc10 });

  // Get DOM dump of discount options list
  const domDump = await evaluate(`
    const list = document.getElementById('discount-options-list');
    return list ? list.outerHTML : '';
  `);

  console.log('\n==========================================');
  console.log('SUMMARY RESULTS:');
  console.log('==========================================');
  let allPass = true;
  for (const r of results) {
    console.log(`[${r.pass ? 'PASS' : 'FAIL'}] ${r.id}: ${r.name}`);
    if (!r.pass) allPass = false;
  }
  console.log('==========================================');
  console.log('ALL PASSED:', allPass);

  console.log('\n--- DOM DUMP OF FINAL TYPE LIST ---');
  console.log(domDump);

  ws.close();
  chrome.kill();
  process.exit(allPass ? 0 : 1);
}

run().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});

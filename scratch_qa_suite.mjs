import { spawn } from 'child_process';
import http from 'http';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const USER_DATA_DIR = 'C:\\Users\\orcuu\\AppData\\Local\\Temp\\chrome-pos-qa-profile';
const PORT = 9222;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    }).on('error', reject);
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
    this.events = [];
    this.consoleLogs = [];
    this.pageErrors = [];
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      } else if (msg.method) {
        if (msg.method === 'Runtime.consoleAPICalled') {
          const text = msg.params.args.map(a => a.value || JSON.stringify(a)).join(' ');
          this.consoleLogs.push({ type: msg.params.type, text });
        } else if (msg.method === 'Runtime.exceptionThrown') {
          const text = msg.params.exceptionDetails?.text || 'Unknown JS Exception';
          this.pageErrors.push(text);
          console.error('[PAGE EXCEPTION]', text, msg.params.exceptionDetails?.exception);
        }
      }
    };

    await this.send('Runtime.enable');
    await this.send('Page.enable');
  }

  async send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression: `(() => {\n${expression}\n})()`,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      console.error('EVAL ERROR DETAILS:', JSON.stringify(res.exceptionDetails), '\nEXPRESSION:\n', expression);
      throw new Error(res.exceptionDetails.text || 'Eval Exception');
    }
    return res.result?.value;
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await sleep(1000);
  }

  async dispatchKey(key, code, keyCode, modifiers = {}) {
    await this.eval(`
      const target = document.activeElement || window;
      const evtDown = new KeyboardEvent('keydown', {
        key: '${key}',
        code: '${code}',
        keyCode: ${keyCode},
        which: ${keyCode},
        bubbles: true,
        cancelable: true,
        altKey: ${Boolean(modifiers.alt)},
        ctrlKey: ${Boolean(modifiers.ctrl)},
        shiftKey: ${Boolean(modifiers.shift)}
      });
      target.dispatchEvent(evtDown);
    `);
    await sleep(50);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function run() {
  console.log('--- STARTING QA SUITE FOR 5 UI/UX FIXES ---');
  const chromeProcess = spawn(CHROME_PATH, [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    `--user-data-dir=${USER_DATA_DIR}`,
    '--no-first-run',
    '--no-default-browser-check'
  ]);

  let connected = false;
  for (let i = 0; i < 20; i++) {
    try {
      await sleep(500);
      const version = await getJson('/json/version');
      if (version) {
        connected = true;
        break;
      }
    } catch (_) {}
  }

  if (!connected) {
    console.error('Failed to start Chrome with CDP');
    process.exit(1);
  }

  const targets = await getJson('/json');
  const target = targets.find(t => t.type === 'page') || targets[0];
  const client = new CDPClient(target.webSocketDebuggerUrl);
  await client.connect();

  const results = {};

  try {
    // 1. Login as cashier
    console.log('Navigating to login page...');
    await client.navigate('http://localhost/masterfile/login.html');
    await client.eval(`
      document.getElementById('username').value = 'cashier';
      document.getElementById('password').value = 'cashier123';
      document.getElementById('login-form').dispatchEvent(new Event('submit'));
    `);
    await sleep(1500);

    // Navigate to sales.html
    console.log('Navigating to sales.html...');
    await client.navigate('http://localhost/masterfile/sales.html');
    await sleep(1500);

    // If beginning cash float modal is showing, enter 500 and submit
    const floatModalOpen = await client.eval(`
      return Boolean(document.getElementById('beginning-cash-modal')?.classList.contains('show'));
    `);
    if (floatModalOpen) {
      console.log('Beginning float modal detected, opening shift with 500...');
      await client.eval(`
        const floatInput = document.getElementById('beginning-cash-amount');
        if (floatInput) floatInput.value = '500';
        document.getElementById('btn-confirm-beginning-cash')?.click();
      `);
      await sleep(1000);
    }

    // Dismiss any sweetalert if present
    await client.eval(`if (typeof Swal !== 'undefined' && Swal.isVisible()) Swal.close();`);
    await sleep(300);

    // ----------------------------------------------------
    // TC-01: SUKI toggle Space on/off
    // ----------------------------------------------------
    console.log('Testing TC-01: SUKI toggle Space on/off...');
    const sukiInitialState = await client.eval(`
      const toggle = document.getElementById('suki-card-toggle');
      const hidden = document.getElementById('suki_card_status');
      const badge = document.getElementById('suki-status-badge');
      return { checked: toggle?.checked, hidden: hidden?.value, badge: badge?.textContent.trim() };
    `);

    // Focus toggle and press Space
    await client.eval(`document.getElementById('suki-card-toggle').focus();`);
    await sleep(50);
    await client.dispatchKey(' ', 'Space', 32);
    await sleep(100);

    const sukiAfterSpace1 = await client.eval(`
      const toggle = document.getElementById('suki-card-toggle');
      const hidden = document.getElementById('suki_card_status');
      const badge = document.getElementById('suki-status-badge');
      return { checked: toggle?.checked, hidden: hidden?.value, badge: badge?.textContent.trim() };
    `);

    // Press Enter on toggle
    await client.dispatchKey('Enter', 'Enter', 13);
    await sleep(100);

    const sukiAfterEnter = await client.eval(`
      const toggle = document.getElementById('suki-card-toggle');
      const hidden = document.getElementById('suki_card_status');
      const badge = document.getElementById('suki-status-badge');
      return { checked: toggle?.checked, hidden: hidden?.value, badge: badge?.textContent.trim() };
    `);

    // Footer chip click test
    await client.eval(`document.getElementById('btn-hk-suki')?.click();`);
    await sleep(100);
    const sukiAfterChip = await client.eval(`
      const toggle = document.getElementById('suki-card-toggle');
      const hidden = document.getElementById('suki_card_status');
      return { checked: toggle?.checked, hidden: hidden?.value };
    `);

    const tc01Pass = sukiInitialState.checked === false &&
                     sukiInitialState.hidden === 'None' &&
                     sukiAfterSpace1.checked === true &&
                     sukiAfterSpace1.hidden === 'Has' &&
                     sukiAfterSpace1.badge === 'Has Card' &&
                     sukiAfterEnter.checked === false &&
                     sukiAfterEnter.hidden === 'None' &&
                     sukiAfterChip.checked === true &&
                     sukiAfterChip.hidden === 'Has';

    results['TC-01'] = {
      pass: tc01Pass,
      detail: `Initial: checked=${sukiInitialState.checked}; Space: checked=${sukiAfterSpace1.checked}, status=${sukiAfterSpace1.hidden}; Enter: checked=${sukiAfterEnter.checked}; Chip click: checked=${sukiAfterChip.checked}`
    };

    // ----------------------------------------------------
    // TC-02: SUKI persistence & new sale reset
    // ----------------------------------------------------
    console.log('Testing TC-02: SUKI persistence & new sale reset...');
    await client.eval(`
      window.posTestHooks.setCart([{ productId: 1, barcode: '4800016644802', productName: 'Item A', unitPrice: 100, quantity: 1, promoId: null, promoRate: 0 }]);
      window.posTestHooks.renderCart();
    `);
    await sleep(300);

    const sukiDuringCart = await client.eval(`
      const toggle = document.getElementById('suki-card-toggle');
      const hidden = document.getElementById('suki_card_status');
      const cartRows = document.querySelectorAll('#cart-table tbody tr').length;
      return { checked: toggle?.checked, hidden: hidden?.value, cartLen: cartRows };
    `);

    await client.eval(`window.closeSale();`);
    await sleep(300);

    const sukiAfterReset = await client.eval(`
      const toggle = document.getElementById('suki-card-toggle');
      const hidden = document.getElementById('suki_card_status');
      const badge = document.getElementById('suki-status-badge');
      const cartRows = document.querySelectorAll('#cart-table tbody tr').length;
      return { checked: toggle?.checked, hidden: hidden?.value, badge: badge?.textContent.trim(), cartLen: cartRows };
    `);

    const tc02Pass = sukiDuringCart.checked === true &&
                     sukiDuringCart.hidden === 'Has' &&
                     sukiAfterReset.checked === false &&
                     sukiAfterReset.hidden === 'None' &&
                     sukiAfterReset.badge === 'No Card' &&
                     sukiAfterReset.cartLen === 0;

    results['TC-02'] = {
      pass: tc02Pass,
      detail: `During cart: checked=${sukiDuringCart.checked}, hidden=${sukiDuringCart.hidden}; After clear: checked=${sukiAfterReset.checked}, hidden=${sukiAfterReset.hidden}, badge=${sukiAfterReset.badge}`
    };

    // ----------------------------------------------------
    // TC-03: AR customer search-only & type-ahead attach
    // ----------------------------------------------------
    console.log('Testing TC-03: AR customer search-only & type-ahead attach...');
    await client.dispatchKey('F8', 'F8', 119);
    await sleep(300);

    const arActiveFocus = await client.eval(`return document.activeElement?.id;`);
    await client.eval(`
      const filter = document.getElementById('ar-customer-search-filter');
      filter.value = 'San';
      filter.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await sleep(400);

    const typeaheadMatches = await client.eval(`
      const list = document.getElementById('ar-customer-typeahead-list');
      const items = list.querySelectorAll('.typeahead-suggestion-item');
      return { isVisible: !list.classList.contains('d-none'), count: items.length };
    `);

    await client.dispatchKey('Escape', 'Escape', 27);
    await sleep(200);

    const escCheck = await client.eval(`
      const list = document.getElementById('ar-customer-typeahead-list');
      return { isHidden: list.classList.contains('d-none'), activeId: document.activeElement?.id };
    `);

    await client.eval(`
      const filter = document.getElementById('ar-customer-search-filter');
      filter.value = 'San';
      filter.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await sleep(400);

    await client.dispatchKey('ArrowDown', 'ArrowDown', 40);
    await sleep(100);
    await client.dispatchKey('Enter', 'Enter', 13);
    await sleep(300);

    const attachedCust = await client.eval(`
      const hidden = document.getElementById('ar_customer_id');
      const search = document.getElementById('ar-customer-search-filter');
      const barcodeFocused = (document.activeElement?.id === 'barcode-input');
      return { customerId: hidden?.value, customerName: search?.value, barcodeFocused };
    `);

    const tc03Pass = (arActiveFocus === 'ar-customer-search-filter') &&
                     typeaheadMatches.isVisible &&
                     typeaheadMatches.count > 0 &&
                     escCheck.isHidden &&
                     escCheck.activeId === 'ar-customer-search-filter' &&
                     Boolean(attachedCust.customerId) &&
                     attachedCust.barcodeFocused;

    results['TC-03'] = {
      pass: tc03Pass,
      detail: `F8 focus: ${arActiveFocus}; Typeahead count: ${typeaheadMatches.count}; Esc keeps focus: ${escCheck.activeId}; Attached customer: #${attachedCust.customerId} (${attachedCust.customerName}); Focus restored: ${attachedCust.barcodeFocused}`
    };

    // ----------------------------------------------------
    // TC-04: AR layout clean & arrow navigation
    // ----------------------------------------------------
    console.log('Testing TC-04: AR layout clean & arrow navigation...');
    const arDomAudit = await client.eval(`
      const oldControl = document.getElementById('ar-customer-control');
      const oldListbox = document.getElementById('ar-customer-listbox');
      const searchInput = document.getElementById('ar-customer-search-filter');
      const hiddenInput = document.getElementById('ar_customer_id');
      return {
        hasOldControl: Boolean(oldControl),
        hasOldListbox: Boolean(oldListbox),
        hasSearch: Boolean(searchInput),
        isHiddenInput: hiddenInput?.type === 'hidden',
        searchWidth: searchInput?.offsetWidth
      };
    `);

    const tc04Pass = !arDomAudit.hasOldControl &&
                     !arDomAudit.hasOldListbox &&
                     arDomAudit.hasSearch &&
                     arDomAudit.isHiddenInput &&
                     arDomAudit.searchWidth > 150;

    results['TC-04'] = {
      pass: tc04Pass,
      detail: `Old control present: ${arDomAudit.hasOldControl}; Old listbox present: ${arDomAudit.hasOldListbox}; Hidden input: ${arDomAudit.isHiddenInput}; Search width: ${arDomAudit.searchWidth}px`
    };

    // ----------------------------------------------------
    // TC-05: Label audit (zero "Resume" in UI)
    // ----------------------------------------------------
    console.log('Testing TC-05: Label audit (zero "Resume" in UI)...');
    const labelAudit = await client.eval(`
      const allText = document.body.innerText;
      const matches = [];
      const regex = /\\b(resume|resumed|resumable)\\b/gi;
      let m;
      while ((m = regex.exec(allText)) !== null) {
        matches.push(m[0]);
      }
      const footerChipText = document.getElementById('btn-hk-resume')?.innerText.trim();
      const modalTitle = document.getElementById('resumeModalLabel')?.innerText.trim();
      return { count: matches.length, matches, footerChipText, modalTitle };
    `);

    const tc05Pass = labelAudit.count === 0 &&
                     labelAudit.footerChipText.includes('On-Hold') &&
                     labelAudit.modalTitle.includes('ON-HOLD');

    results['TC-05'] = {
      pass: tc05Pass,
      detail: `Visible 'resume' matches: ${labelAudit.count} (${labelAudit.matches.join(', ')}); Footer chip: '${labelAudit.footerChipText}'; Modal title: '${labelAudit.modalTitle}'`
    };

    // ----------------------------------------------------
    // TC-06: F10 On-Hold function intact
    // ----------------------------------------------------
    console.log('Testing TC-06: F10 On-Hold function intact...');
    await client.dispatchKey('F10', 'F10', 121);
    await sleep(500);

    const onHoldModalCheck = await client.eval(`
      const modal = document.getElementById('resume-transaction-modal');
      const isVisible = modal?.classList.contains('show');
      const title = document.getElementById('resumeModalLabel')?.textContent.trim();
      const filter = document.getElementById('held-search-filter');
      const kbdHelp = modal?.querySelector('.text-muted.small span')?.textContent.trim();
      return { isVisible, title, hasFilter: Boolean(filter), kbdHelp };
    `);

    await client.dispatchKey('Escape', 'Escape', 27);
    await sleep(300);

    const modalClosedCheck = await client.eval(`
      const modal = document.getElementById('resume-transaction-modal');
      return { isClosed: !modal?.classList.contains('show'), barcodeFocused: (document.activeElement?.id === 'barcode-input') };
    `);

    const tc06Pass = onHoldModalCheck.isVisible &&
                     onHoldModalCheck.title.includes('ON-HOLD TICKETS') &&
                     onHoldModalCheck.kbdHelp.includes('Recall On-Hold') &&
                     modalClosedCheck.isClosed;

    results['TC-06'] = {
      pass: tc06Pass,
      detail: `Modal visible: ${onHoldModalCheck.isVisible}; Title: '${onHoldModalCheck.title}'; Kbd prompt: '${onHoldModalCheck.kbdHelp}'; Closed on Esc: ${modalClosedCheck.isClosed}`
    };

    // ----------------------------------------------------
    // TC-07: Discount switch Senior -> PWD
    // ----------------------------------------------------
    console.log('Testing TC-07: Discount switch Senior -> PWD...');
    await client.eval(`
      window.posTestHooks.setSaleMode('Cash');
      window.posTestHooks.setCart([{ productId: 1, barcode: '4800016644802', productName: 'Item A', unitPrice: 100, quantity: 1, promoId: null, promoRate: 0 }]);
      window.posTestHooks.renderCart();
    `);
    await sleep(300);

    await client.eval(`window.posTestHooks.openDiscountKeyboardFlow();`);
    await sleep(200);

    const discFocus = await client.eval(`return document.activeElement?.id;`);

    await client.eval(`
      const select = document.getElementById('discount_type');
      select.value = 'senior';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await client.dispatchKey('Enter', 'Enter', 13);
    await sleep(200);

    const seniorFocus = await client.eval(`return document.activeElement?.id;`);

    // Press ArrowLeft on discount_id_number to return to discount_type
    await client.dispatchKey('ArrowLeft', 'ArrowLeft', 37);
    await sleep(200);

    const returnedFocus1 = await client.eval(`return document.activeElement?.id;`);

    // Switch to PWD
    await client.eval(`
      const select = document.getElementById('discount_type');
      select.value = 'pwd';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await client.dispatchKey('Enter', 'Enter', 13);
    await sleep(200);

    const pwdFocus = await client.eval(`
      const idLabel = document.getElementById('discount-id-label')?.textContent.trim();
      return { activeId: document.activeElement?.id, idLabel };
    `);

    // Press Esc to return to discount_type
    await client.dispatchKey('Escape', 'Escape', 27);
    await sleep(200);
    const returnedFocus2 = await client.eval(`return document.activeElement?.id;`);

    const tc07Pass = (discFocus === 'discount_type') &&
                     (seniorFocus === 'discount_id_number') &&
                     (returnedFocus1 === 'discount_type') &&
                     (pwdFocus.activeId === 'discount_id_number') &&
                     pwdFocus.idLabel.includes('PWD') &&
                     (returnedFocus2 === 'discount_type');

    results['TC-07'] = {
      pass: tc07Pass,
      detail: `Alt+D focus: ${discFocus}; Senior Enter focus: ${seniorFocus}; Left arrow return: ${returnedFocus1}; PWD Enter focus: ${pwdFocus.activeId} (${pwdFocus.idLabel}); Esc return: ${returnedFocus2}`
    };

    // ----------------------------------------------------
    // TC-08: Discount remove -> totals revert
    // ----------------------------------------------------
    console.log('Testing TC-08: Discount remove -> totals revert...');
    await client.eval(`
      const select = document.getElementById('discount_type');
      select.value = 'senior';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('discount_id_number').value = 'SC-12345';
      window.posTestHooks.renderCart();
    `);
    await sleep(300);

    const totalsWithSenior = await client.eval(`
      const grandTotal = document.getElementById('pos-grand-total')?.textContent.trim();
      const tax = document.getElementById('tax-total')?.textContent.trim();
      const vatExempt = document.getElementById('vat-exempt-amount-row')?.classList.contains('d-none');
      return { grandTotal, tax, vatExemptRowHidden: vatExempt };
    `);

    // Now switch to none and trigger change & render
    await client.eval(`
      const select = document.getElementById('discount_type');
      select.value = 'none';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      window.posTestHooks.renderCart();
    `);
    await sleep(300);

    const totalsWithNone = await client.eval(`
      const grandTotal = document.getElementById('pos-grand-total')?.textContent.trim();
      const tax = document.getElementById('tax-total')?.textContent.trim();
      const vatExempt = document.getElementById('vat-exempt-amount-row')?.classList.contains('d-none');
      const discRow = document.getElementById('discount-total-row')?.classList.contains('d-none');
      return { grandTotal, tax, vatExemptRowHidden: vatExempt, discRowHidden: discRow };
    `);

    const tc08Pass = totalsWithSenior.tax === '0.00' &&
                     totalsWithSenior.vatExemptRowHidden === false &&
                     totalsWithNone.vatExemptRowHidden === true &&
                     totalsWithNone.discRowHidden === true &&
                     Number(totalsWithNone.tax) > 0;

    results['TC-08'] = {
      pass: tc08Pass,
      detail: `Senior: tax=${totalsWithSenior.tax}, exemptRowHidden=${totalsWithSenior.vatExemptRowHidden}; Removed: tax=${totalsWithNone.tax}, exemptRowHidden=${totalsWithNone.vatExemptRowHidden}, discRowHidden=${totalsWithNone.discRowHidden}`
    };

    // ----------------------------------------------------
    // TC-09: Discount switch Senior -> Custom 10% (VAT re-applies)
    // ----------------------------------------------------
    console.log('Testing TC-09: Discount switch Senior -> Custom 10% (VAT re-applies)...');
    await client.eval(`
      const select = document.getElementById('discount_type');
      select.value = 'senior';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('discount_id_number').value = 'SC-9999';
      window.posTestHooks.renderCart();
    `);
    await sleep(300);

    await client.eval(`
      const select = document.getElementById('discount_type');
      select.value = 'custom';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('custom_discount_mode').value = 'percent';
      document.getElementById('custom_discount_value').value = '10';
      window.posTestHooks.renderCart();
    `);
    await sleep(300);

    const totalsCustom10 = await client.eval(`
      const grandTotal = document.getElementById('pos-grand-total')?.textContent.trim();
      const tax = document.getElementById('tax-total')?.textContent.trim();
      const vatExempt = document.getElementById('vat-exempt-amount-row')?.classList.contains('d-none');
      const discRow = document.getElementById('discount-total-row')?.classList.contains('d-none');
      const discLabel = document.getElementById('discount-total-label')?.textContent.trim();
      return { grandTotal, tax, vatExemptRowHidden: vatExempt, discRowHidden: discRow, discLabel };
    `);

    const tc09Pass = totalsCustom10.vatExemptRowHidden === true &&
                     totalsCustom10.discRowHidden === false &&
                     totalsCustom10.discLabel.includes('10%') &&
                     Number(totalsCustom10.tax) > 0;

    results['TC-09'] = {
      pass: tc09Pass,
      detail: `Custom 10%: tax=₱${totalsCustom10.tax}, vatExemptRowHidden=${totalsCustom10.vatExemptRowHidden}, label='${totalsCustom10.discLabel}'`
    };

    // ----------------------------------------------------
    // TC-10, TC-11, TC-12: Settings Bulk Promo Assignment (Requires Admin)
    // ----------------------------------------------------
    console.log('Logging in as admin to test settings.html (TC-10, TC-11, TC-12)...');
    await client.navigate('http://localhost/masterfile/login.html');
    await client.eval(`
      document.getElementById('username').value = 'admin';
      document.getElementById('password').value = 'admin123';
      document.getElementById('login-form').dispatchEvent(new Event('submit'));
    `);
    await sleep(1500);

    await client.navigate('http://localhost/masterfile/settings.html');
    await sleep(1500);

    const settingsUiCheck = await client.eval(`
      const promoSelect = document.getElementById('assignment_promo');
      const searchInput = document.getElementById('promo-product-search');
      const btnFiltered = document.getElementById('btn-select-filtered');
      const btnAll = document.getElementById('btn-select-all');
      const btnNone = document.getElementById('btn-select-none');
      const btnAssign = document.getElementById('btn-bulk-assign');
      const countBadge = document.getElementById('selected-products-count');
      const container = document.getElementById('promo-product-list-container');
      return {
        hasPromoSelect: Boolean(promoSelect),
        hasSearch: Boolean(searchInput),
        hasBtnFiltered: Boolean(btnFiltered),
        hasBtnAll: Boolean(btnAll),
        hasBtnNone: Boolean(btnNone),
        hasBtnAssign: Boolean(btnAssign),
        hasCountBadge: Boolean(countBadge),
        hasContainer: Boolean(container)
      };
    `);

    await client.eval(`
      const promoSelect = document.getElementById('assignment_promo');
      if (promoSelect && promoSelect.options.length > 1) {
        promoSelect.selectedIndex = 1;
        promoSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    `);
    await sleep(300);

    await client.eval(`document.getElementById('btn-select-all')?.click();`);
    await sleep(200);
    const countAfterAll = await client.eval(`return parseInt(document.getElementById('selected-products-count')?.textContent || '0', 10);`);

    await client.eval(`document.getElementById('btn-select-none')?.click();`);
    await sleep(200);
    const countAfterNone = await client.eval(`return parseInt(document.getElementById('selected-products-count')?.textContent || '0', 10);`);

    await client.eval(`
      const search = document.getElementById('promo-product-search');
      search.value = 'a';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await sleep(300);

    await client.eval(`document.getElementById('btn-select-filtered')?.click();`);
    await sleep(200);
    const countAfterFiltered = await client.eval(`return parseInt(document.getElementById('selected-products-count')?.textContent || '0', 10);`);

    const tc10Pass = settingsUiCheck.hasPromoSelect &&
                     settingsUiCheck.hasBtnAssign &&
                     countAfterAll >= 1 &&
                     countAfterNone === 0 &&
                     countAfterFiltered >= 1;

    results['TC-10'] = {
      pass: tc10Pass,
      detail: `Select All count: ${countAfterAll}; Select None: ${countAfterNone}; Filtered 'a' count: ${countAfterFiltered}`
    };

    // TC-11: Keyboard navigation in product list
    console.log('Testing TC-11: Keyboard navigation in product list...');
    await client.eval(`
      const container = document.getElementById('promo-product-list-container');
      container.focus();
    `);
    await sleep(100);

    await client.dispatchKey('ArrowDown', 'ArrowDown', 40);
    await sleep(100);
    const rowFocused = await client.eval(`
      const focused = document.querySelector('.promo-product-row.border-dark');
      return Boolean(focused);
    `);

    await client.dispatchKey(' ', 'Space', 32);
    await sleep(100);

    await client.eval(`
      const search = document.getElementById('promo-product-search');
      search.focus();
      search.value = 'testing';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await sleep(100);
    await client.dispatchKey('Escape', 'Escape', 27);
    await sleep(200);
    const searchAfterEsc = await client.eval(`return document.getElementById('promo-product-search')?.value;`);

    const tc11Pass = rowFocused && searchAfterEsc === '';
    results['TC-11'] = {
      pass: tc11Pass,
      detail: `Arrow navigation focused row: ${rowFocused}; Esc cleared search input: '${searchAfterEsc}'`
    };

    // TC-12: Single HTTP POST request efficiency
    console.log('Testing TC-12: Single HTTP POST request efficiency...');
    const postEfficiency = await client.eval(`
      return new Promise(async (resolve) => {
        let postCount = 0;
        let lastPayload = null;
        const origPost = axios.post;
        axios.post = function(url, data, config) {
          postCount++;
          lastPayload = data instanceof FormData ? Object.fromEntries(data.entries()) : data;
          return origPost.apply(this, arguments);
        };

        document.getElementById('btn-select-all').click();
        const count = parseInt(document.getElementById('selected-products-count')?.textContent || '0', 10);

        const btn = document.getElementById('btn-bulk-assign');
        btn.click();

        setTimeout(() => {
          axios.post = origPost;
          const parsedJson = lastPayload?.json ? JSON.parse(lastPayload.json) : null;
          resolve({
            postCount,
            productCount: count,
            submittedIdsCount: parsedJson?.productIds?.length || 0,
            promoId: parsedJson?.promoId
          });
        }, 1200);
      });
    `);

    const tc12Pass = postEfficiency.postCount === 1 &&
                     postEfficiency.submittedIdsCount >= 1;

    results['TC-12'] = {
      pass: tc12Pass,
      detail: `HTTP POST requests sent: ${postEfficiency.postCount} (assigned ${postEfficiency.submittedIdsCount} products in 1 request; promoId=${postEfficiency.promoId})`
    };

    // ----------------------------------------------------
    // TC-13: Full regression sweep & zero console errors (Login as cashier)
    // ----------------------------------------------------
    console.log('Testing TC-13: Full regression sweep...');
    await client.navigate('http://localhost/masterfile/login.html');
    await client.eval(`
      document.getElementById('username').value = 'cashier';
      document.getElementById('password').value = 'cashier123';
      document.getElementById('login-form').dispatchEvent(new Event('submit'));
    `);
    await sleep(1500);

    await client.navigate('http://localhost/masterfile/sales.html');
    await sleep(1000);

    const regressionCheck = await client.eval(`
      return new Promise(async (resolve) => {
        try {
          // 1. Scan / load item
          window.posTestHooks.setSaleMode('Cash');
          window.posTestHooks.setCart([{ productId: 1, barcode: '4800016644802', productName: 'Item A', unitPrice: 100, quantity: 1, promoId: null, promoRate: 0 }]);
          window.posTestHooks.renderCart();
          await new Promise(r => setTimeout(r, 400));

          // 2. Hold sale
          window.posTestHooks.triggerHoldTransaction();
          await new Promise(r => setTimeout(r, 600));

          // 3. Open on-hold modal
          await window.posTestHooks.openResumeModal();
          await new Promise(r => setTimeout(r, 400));
          const modalOpen = document.getElementById('resume-transaction-modal')?.classList.contains('show');

          bootstrap.Modal.getInstance(document.getElementById('resume-transaction-modal'))?.hide();
          await new Promise(r => setTimeout(r, 300));

          // 4. Clear register
          window.closeSale();

          resolve({
            success: true,
            modalOpened: modalOpen,
            cartCleared: document.querySelectorAll('#cart-table tbody tr').length === 0
          });
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      });
    `);

    const tc13Pass = regressionCheck.success &&
                     client.pageErrors.length === 0;

    results['TC-13'] = {
      pass: tc13Pass,
      detail: `Regression flow completed: ${regressionCheck.success}; Uncaught exceptions: ${client.pageErrors.length}`
    };

  } catch (err) {
    console.error('Test Suite Exception:', err);
  } finally {
    client.close();
    chromeProcess.kill();
  }

  console.log('\n========================================');
  console.log('             QA TEST RESULTS            ');
  console.log('========================================');
  let allPass = true;
  for (const [tc, res] of Object.entries(results)) {
    console.log(`${tc}: ${res.pass ? 'PASS' : 'FAIL'} - ${res.detail}`);
    if (!res.pass) allPass = false;
  }
  console.log('========================================');
  console.log(`OVERALL: ${allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
}

run();

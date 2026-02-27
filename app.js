/* =========================================================
TPV TIENDA LOCAL — UI (PARTE 1/3)
Archivo: app.js
- Demo en memoria (sin SQLite todavía)
- Campo barcode/manual + búsqueda + favoritos + carrito + totales
- Ticket preview demo
========================================================= */

(() => {
  'use strict';

  /* ---------------------------
     HELPERS
  --------------------------- */
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  const fmtEUR = (n) => {
    const v = Number(n || 0);
    return v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  };

  const parseMoney = (s) => {
    if (s == null) return 0;
    const t = String(s).trim()
      .replace(/\s/g,'')
      .replace(/\./g,'')
      .replace(',', '.');
    const v = Number(t);
    return Number.isFinite(v) ? v : 0;
  };

  const nowES = () => {
    const d = new Date();
    return d.toLocaleString('es-ES', { hour12:false });
  };

  const uuid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);

  /* ---------------------------
     DEMO DATA (en memoria)
     En Parte 3 -> SQLite
  --------------------------- */
  const state = {
    products: [
      { id: uuid(), barcode: '8412345000011', name: 'Agua 1,5L', sell: 1.20, buy: 0.55, fav: true },
      { id: uuid(), barcode: '8412345000028', name: 'Coca-Cola lata', sell: 1.10, buy: 0.45, fav: true },
      { id: uuid(), barcode: '8412345000035', name: 'Pan', sell: 0.80, buy: 0.30, fav: true },
      { id: uuid(), barcode: '8422222000001', name: 'Chocolate', sell: 1.50, buy: 0.70, fav: false },
    ],
    cart: [],
    lastTicket: null,
    ticketCounter: 1,
  };

  /* ---------------------------
     DOM
  --------------------------- */
  const els = {
    favGrid: $('#favGrid'),
    cartBody: $('#cartBody'),
    tSubtotal: $('#tSubtotal'),
    tTotal: $('#tTotal'),
    scanInput: $('#scanInput'),
    btnAddByScan: $('#btnAddByScan'),
    searchResults: $('#searchResults'),
    btnClearCart: $('#btnClearCart'),
    cashReceived: $('#cashReceived'),
    changeDue: $('#changeDue'),
    payCash: $('#payCash'),
    payCard: $('#payCard'),
    btnFinish: $('#btnFinish'),
    chkEmail: $('#chkEmail'),
    custName: $('#custName'),
    custEmail: $('#custEmail'),

    quickName: $('#quickName'),
    quickAmount: $('#quickAmount'),
    btnAddQuick: $('#btnAddQuick'),

    lastTicketNo: $('#lastTicketNo'),
    lastTicketDate: $('#lastTicketDate'),
    lastTicketPreview: $('#lastTicketPreview'),
    btnReprint: $('#btnReprint'),
    btnResend: $('#btnResend'),

    btnProducts: $('#btnProducts'),
    modalProducts: $('#modalProducts'),
    btnCloseProducts: $('#btnCloseProducts'),

    pBarcode: $('#pBarcode'),
    pName: $('#pName'),
    pSell: $('#pSell'),
    pBuy: $('#pBuy'),
    btnSaveProduct: $('#btnSaveProduct'),
    btnClearProductForm: $('#btnClearProductForm'),
    pSearch: $('#pSearch'),
    pList: $('#pList'),

    btnLock: $('#btnLock'),
  };

  /* ---------------------------
     FAVORITES
  --------------------------- */
  function renderFavs(){
    const favs = state.products.filter(p => p.fav);
    els.favGrid.innerHTML = favs.map(p => `
      <button class="favBtn" data-id="${p.id}">
        <div class="name">${escapeHtml(p.name)}</div>
        <div class="price">${fmtEUR(p.sell)} · <span class="muted">barcode</span> ${escapeHtml(p.barcode || '—')}</div>
      </button>
    `).join('');
    $$('.favBtn', els.favGrid).forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const prod = state.products.find(x => x.id === id);
        if (prod) addToCart(prod, 1);
      });
    });
  }

  /* ---------------------------
     CART
  --------------------------- */
  function addToCart(prod, qty){
    const q = Number(qty || 1);
    const found = state.cart.find(it => it.type === 'product' && it.productId === prod.id && it.unitPrice === prod.sell);
    if (found){
      found.qty += q;
    } else {
      state.cart.push({
        id: uuid(),
        type: 'product',
        productId: prod.id,
        name: prod.name,
        barcode: prod.barcode,
        qty: q,
        unitPrice: prod.sell,
      });
    }
    renderCart();
    focusScan();
  }

  function addQuickLine(name, amount){
    const a = Number(amount || 0);
    if (a <= 0) return;
    state.cart.push({
      id: uuid(),
      type: 'quick',
      name: (name || 'Varios').trim() || 'Varios',
      qty: 1,
      unitPrice: a,
    });
    renderCart();
    els.quickName.value = '';
    els.quickAmount.value = '';
    focusScan();
  }

  function removeLine(id){
    state.cart = state.cart.filter(x => x.id !== id);
    renderCart();
  }

  function updateQty(id, qty){
    const q = Math.max(0, Number(qty || 0));
    const line = state.cart.find(x => x.id === id);
    if (!line) return;
    if (q <= 0) removeLine(id);
    else { line.qty = q; renderCart(); }
  }

  function calcSubtotal(){
    return state.cart.reduce((sum, it) => sum + (Number(it.qty) * Number(it.unitPrice)), 0);
  }

  function renderCart(){
    els.cartBody.innerHTML = state.cart.map(it => {
      const lineTotal = Number(it.qty) * Number(it.unitPrice);
      const title = it.type === 'product'
        ? `${escapeHtml(it.name)} <span class="tdSmall">(${escapeHtml(it.barcode || '')})</span>`
        : `${escapeHtml(it.name)} <span class="tdSmall">(manual)</span>`;

      return `
        <tr data-id="${it.id}">
          <td>${title}</td>
          <td>
            <div class="qtyBox">
              <button class="iconBtn" data-act="dec">−</button>
              <input class="qtyInput" value="${String(it.qty)}" inputmode="decimal" />
              <button class="iconBtn" data-act="inc">+</button>
            </div>
          </td>
          <td class="tdRight">${fmtEUR(it.unitPrice)}</td>
          <td class="tdRight"><strong>${fmtEUR(lineTotal)}</strong></td>
          <td class="tdRight">
            <button class="iconBtn" data-act="del">✕</button>
          </td>
        </tr>
      `;
    }).join('');

    // Bind actions
    $$('#cartBody tr').forEach(tr => {
      const id = tr.getAttribute('data-id');
      const line = state.cart.find(x => x.id === id);
      if (!line) return;

      const inp = $('.qtyInput', tr);
      inp.addEventListener('change', () => updateQty(id, parseMoney(inp.value) || 0));

      tr.querySelectorAll('.iconBtn').forEach(btn => {
        btn.addEventListener('click', () => {
          const act = btn.getAttribute('data-act');
          if (act === 'del') return removeLine(id);
          if (act === 'inc') return updateQty(id, Number(line.qty) + 1);
          if (act === 'dec') return updateQty(id, Number(line.qty) - 1);
        });
      });
    });

    const sub = calcSubtotal();
    els.tSubtotal.textContent = fmtEUR(sub);
    els.tTotal.textContent = fmtEUR(sub);

    refreshChange();
  }

  function clearCart(){
    state.cart = [];
    renderCart();
  }

  /* ---------------------------
     SCAN / SEARCH
  --------------------------- */
  function focusScan(){
    els.scanInput?.focus();
    els.scanInput?.select();
  }

  function findByBarcode(code){
    const c = String(code || '').trim();
    if (!c) return null;
    return state.products.find(p => String(p.barcode || '').trim() === c) || null;
  }

  function searchProducts(q){
    const s = String(q || '').trim().toLowerCase();
    if (!s) return [];
    return state.products
      .filter(p =>
        (p.name || '').toLowerCase().includes(s) ||
        String(p.barcode || '').includes(s)
      )
      .slice(0, 10);
  }

  function openSearch(list){
    if (!list.length){
      els.searchResults.classList.add('hidden');
      els.searchResults.innerHTML = '';
      return;
    }
    els.searchResults.classList.remove('hidden');
    els.searchResults.innerHTML = list.map(p => `
      <div class="searchItem" data-id="${p.id}">
        <div><strong>${escapeHtml(p.name)}</strong> <span class="muted">(${escapeHtml(p.barcode || '—')})</span></div>
        <div>${fmtEUR(p.sell)}</div>
      </div>
    `).join('');
    $$('.searchItem', els.searchResults).forEach(row => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-id');
        const prod = state.products.find(x => x.id === id);
        if (prod) addToCart(prod, 1);
        els.searchResults.classList.add('hidden');
      });
    });
  }

  function handleScanAdd(){
    const raw = (els.scanInput.value || '').trim();
    if (!raw) return;

    // 1) barcode exacto -> añade
    const byCode = findByBarcode(raw);
    if (byCode){
      addToCart(byCode, 1);
      els.scanInput.value = '';
      openSearch([]);
      return;
    }

    // 2) si no hay match -> búsqueda por nombre/barcode parcial
    const list = searchProducts(raw);
    openSearch(list);

    // Si solo hay 1 resultado y coincide fuerte -> opcional auto-add (lo dejo manual por ahora)
  }

  /* ---------------------------
     CASH / CHANGE
  --------------------------- */
  function refreshChange(){
    const total = calcSubtotal();
    const rec = parseMoney(els.cashReceived.value);
    const change = Math.max(0, rec - total);
    els.changeDue.textContent = fmtEUR(change);
  }

  /* ---------------------------
     TICKET DEMO
     (Parte 3 -> builder ESC/POS + SQLite)
  --------------------------- */
  function buildTicketText(payMethod){
    const total = calcSubtotal();
    const no = String(state.ticketCounter).padStart(6,'0');
    const date = nowES();

    const lines = [];
    lines.push('TPV TIENDA — LOCAL');
    lines.push('------------------------------');
    lines.push(`Ticket: ${no}`);
    lines.push(`Fecha:  ${date}`);
    lines.push('------------------------------');

    state.cart.forEach(it => {
      const lt = Number(it.qty) * Number(it.unitPrice);
      const name = it.name || 'Varios';
      const q = String(it.qty).replace('.', ',');
      lines.push(`${name}`);
      lines.push(`  ${q} x ${fmtEUR(it.unitPrice)} = ${fmtEUR(lt)}`);
    });

    lines.push('------------------------------');
    lines.push(`TOTAL: ${fmtEUR(total)}`);
    lines.push(`Pago:  ${payMethod}`);
    lines.push('IVA incluido en los precios');
    if ((els.custName.value || '').trim()) lines.push(`Cliente: ${(els.custName.value || '').trim()}`);
    lines.push('------------------------------');
    lines.push('Gracias por su compra');

    return { no, date, text: lines.join('\n') };
  }

  function finishSale(payMethod){
    if (!state.cart.length) return;

    const ticket = buildTicketText(payMethod);
    state.lastTicket = ticket;
    state.ticketCounter += 1;

    // Demo preview
    els.lastTicketNo.textContent = ticket.no;
    els.lastTicketDate.textContent = ticket.date;
    els.lastTicketPreview.textContent = ticket.text;

    // Demo: email checkbox (real en Parte 3)
    if (els.chkEmail.checked){
      // en Parte 3 -> SMTP send + adjunto/HTML
      // aquí solo marcamos
      els.lastTicketPreview.textContent += '\n\n[DEMO] Ticket marcado para envío por email: ' + (els.custEmail.value || '(sin email)');
    }

    clearCart();
    els.cashReceived.value = '';
    els.custName.value = '';
    els.custEmail.value = '';
    els.chkEmail.checked = false;
    refreshChange();
    focusScan();
  }

  /* ---------------------------
     PRODUCTS MODAL (demo)
  --------------------------- */
  function showProductsModal(show){
    if (show) els.modalProducts.classList.remove('hidden');
    else els.modalProducts.classList.add('hidden');
  }

  function clearProductForm(){
    els.pBarcode.value = '';
    els.pName.value = '';
    els.pSell.value = '';
    els.pBuy.value = '';
    els.pBarcode.focus();
  }

  function saveProductDemo(){
    const barcode = (els.pBarcode.value || '').trim();
    const name = (els.pName.value || '').trim();
    const sell = parseMoney(els.pSell.value);
    const buy = parseMoney(els.pBuy.value);

    if (!barcode || !name || sell <= 0) return;

    const exists = state.products.find(p => String(p.barcode||'').trim() === barcode);
    if (exists){
      // simple update
      exists.name = name;
      exists.sell = sell;
      exists.buy = buy > 0 ? buy : null;
    } else {
      state.products.unshift({
        id: uuid(),
        barcode,
        name,
        sell,
        buy: buy > 0 ? buy : null,
        fav: false
      });
    }
    renderFavs();
    renderProductList();
    clearProductForm();
  }

  function renderProductList(){
    const q = (els.pSearch.value || '').trim().toLowerCase();
    const list = state.products
      .filter(p => !q ? true : ((p.name||'').toLowerCase().includes(q) || String(p.barcode||'').includes(q)))
      .slice(0, 80);

    els.pList.innerHTML = list.map(p => `
      <div class="pRow">
        <div>
          <div><strong>${escapeHtml(p.name)}</strong></div>
          <div class="small">${escapeHtml(p.barcode || '—')}</div>
        </div>
        <div style="text-align:right">
          <div><strong>${fmtEUR(p.sell)}</strong></div>
          <div class="small">${p.buy ? ('Compra ' + fmtEUR(p.buy)) : 'Compra —'}</div>
        </div>
      </div>
    `).join('');
  }

  /* ---------------------------
     Security demo (lock button)
     (Parte 2 -> PIN + password + session)
  --------------------------- */
  function lockDemo(){
    alert('Bloqueo demo. En Parte 2 implemento PIN caja + contraseña admin + auto-lock.');
  }

  /* ---------------------------
     Escape HTML
  --------------------------- */
  function escapeHtml(s){
    return (s ?? '').toString()
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'","&#039;");
  }

  /* ---------------------------
     EVENTS
  --------------------------- */
  function bind(){
    // Scan add
    els.btnAddByScan.addEventListener('click', handleScanAdd);
    els.scanInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter'){ e.preventDefault(); handleScanAdd(); }
      if (e.key === 'Escape'){ openSearch([]); els.scanInput.value=''; }
    });
    els.scanInput.addEventListener('input', () => {
      const raw = (els.scanInput.value || '').trim();
      if (!raw) openSearch([]);
      else openSearch(searchProducts(raw));
    });

    // Shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && (e.key.toLowerCase() === 'l')){
        e.preventDefault();
        focusScan();
      }
    });

    // Clear cart
    els.btnClearCart.addEventListener('click', clearCart);

    // Cash change
    els.cashReceived.addEventListener('input', refreshChange);

    // Quick amount keypad
    $$('.padBtn').forEach(b => {
      b.addEventListener('click', () => {
        const add = b.getAttribute('data-add');
        const set0 = b.getAttribute('data-set');
        const back = b.getAttribute('data-back');
        const exact = b.getAttribute('data-exact');

        if (set0){
          els.quickAmount.value = '';
          return;
        }
        if (back){
          els.quickAmount.value = (els.quickAmount.value || '').slice(0, -1);
          return;
        }
        if (exact){
          // exacto = total actual del carrito en el campo "Entregado" (efectivo)
          els.cashReceived.value = String(calcSubtotal()).replace('.', ',');
          refreshChange();
          return;
        }
        if (add){
          const cur = parseMoney(els.quickAmount.value);
          const next = cur + Number(add);
          els.quickAmount.value = String(next).replace('.', ',');
        }
      });
    });

    els.btnAddQuick.addEventListener('click', () => {
      addQuickLine(els.quickName.value, parseMoney(els.quickAmount.value));
    });

    // Pay buttons
    els.payCash.addEventListener('click', () => finishSale('Efectivo'));
    els.payCard.addEventListener('click', () => finishSale('Tarjeta'));
    els.btnFinish.addEventListener('click', () => finishSale('Finalizado'));

    // Ticket actions demo
    els.btnReprint.addEventListener('click', () => {
      if (!state.lastTicket) return;
      alert('Reimprimir demo.\n\nEn Parte 3: ESC/POS USB directo.');
    });
    els.btnResend.addEventListener('click', () => {
      if (!state.lastTicket) return;
      alert('Reenviar email demo.\n\nEn Parte 3: SMTP local.');
    });

    // Products modal
    els.btnProducts.addEventListener('click', () => { showProductsModal(true); renderProductList(); els.pBarcode.focus(); });
    els.btnCloseProducts.addEventListener('click', () => showProductsModal(false));

    els.btnClearProductForm.addEventListener('click', clearProductForm);
    els.btnSaveProduct.addEventListener('click', saveProductDemo);

    els.pSearch.addEventListener('input', renderProductList);

    // Enter flow in product form (barcode -> name -> sell -> buy -> save)
    els.pBarcode.addEventListener('keydown', (e) => { if (e.key==='Enter'){ e.preventDefault(); els.pName.focus(); } });
    els.pName.addEventListener('keydown', (e) => { if (e.key==='Enter'){ e.preventDefault(); els.pSell.focus(); } });
    els.pSell.addEventListener('keydown', (e) => { if (e.key==='Enter'){ e.preventDefault(); els.pBuy.focus(); } });
    els.pBuy.addEventListener('keydown', (e) => { if (e.key==='Enter'){ e.preventDefault(); saveProductDemo(); } });

    // Lock
    els.btnLock.addEventListener('click', lockDemo);
  }

  /* ---------------------------
     INIT
  --------------------------- */
  function init(){
    renderFavs();
    renderCart();
    renderProductList();
    bind();
    focusScan();
  }

  init();

})();

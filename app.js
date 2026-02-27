/* =========================
TPV TIENDA — B/W PRO (OPCIÓN 1 / GITHUB)
Archivo: app.js  (REGENERADO MEJORADO)
- POS real (barcode, favoritos, carrito, importe rápido)
- Cobro modal + cobro directo opcional
- Ticket 80mm con printArea dedicado
- Email ticket por mailto
- Login local (cajero/admin) + PIN admin (hash)
- Ajustes conectados (tienda/caja/pie, toggles)
========================= */

(() => {
  'use strict';

  /* =========================
     HELPERS
  ========================== */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const LS_KEY = 'TPV_BWPRO_V1_1';

  const pad = (n) => (n < 10 ? '0' : '') + n;
  const now = () => new Date();
  const nowEs = () => {
    const d = now();
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const parseMoney = (s) => {
    if (s == null) return 0;
    const t = String(s).trim().replace(/\s/g, '').replace(',', '.');
    const v = Number(t);
    return Number.isFinite(v) ? v : 0;
  };
  const fmtMoney = (v) => Number(v || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtEUR = (v) => `${fmtMoney(v)} €`;

  const uid = () => 'T' + Math.random().toString(36).slice(2, 8).toUpperCase() + Date.now().toString(36).slice(-4).toUpperCase();

  const escapeHtml = (s) => (s ?? '').toString()
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  const debounce = (fn, ms = 200) => {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  async function sha256Hex(str) {
    const enc = new TextEncoder();
    const data = enc.encode(String(str));
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /* =========================
     STATE
  ========================== */
  const defaultState = () => ({
    version: '1.1',
    settings: {
      shopName: 'Tu Tienda',
      shopSub: 'CIF / Dirección / Tel',
      footerText: 'Gracias por su compra',
      boxName: 'CAJA-1',
      theme: 'day',
      directPay: false,
      autoPrint: false,
      adminPinHash: '', // se inicializa a hash('1234') si vacío
    },
    session: {
      user: { name: 'CAJERO', role: 'cashier' },
      adminUnlockedUntil: 0,
    },
    counters: { ticketSeq: 1 },
    users: [
      // demo local (hash se rellena en initUsers)
      { username: 'cajero', passHash: '', role: 'cashier' },
      { username: 'admin',  passHash: '', role: 'admin' },
    ],
    products: [
      { id: 'P1', barcode: '1234567890123', name: 'Plátano',  price: 1.89, cost: 1.20, category: 'Fruta',   fav: true, unit: 'ud' },
      { id: 'P2', barcode: '7894561230123', name: 'Manzana',  price: 2.40, cost: 1.50, category: 'Fruta',   fav: true, unit: 'ud' },
      { id: 'P3', barcode: '2345678901234', name: 'Naranja',  price: 1.60, cost: 0.95, category: 'Fruta',   fav: true, unit: 'ud' },
      { id: 'P4', barcode: '3456789012345', name: 'Tomate',   price: 2.10, cost: 1.25, category: 'Verdura', fav: true, unit: 'ud' },
      { id: 'P5', barcode: '4567890123456', name: 'Lechuga',  price: 1.20, cost: 0.70, category: 'Verdura', fav: true, unit: 'ud' },
      { id: 'P6', barcode: '5678901234567', name: 'Aguacate', price: 3.90, cost: 2.30, category: 'Tropical',fav: true, unit: 'ud' },
      { id: 'P7', barcode: '',             name: 'Bolsa',    price: 0.10, cost: null, category: 'Otros',   fav: true, unit: 'ud' },
    ],
    carts: {
      active: { lines: [], noteName: '', payMethod: 'efectivo', given: 0 },
      parked: null,
    },
    sales: [],
    lastSaleId: null,
    audit: []
  });

  const deepMerge = (base, patch) => {
    if (Array.isArray(base)) return Array.isArray(patch) ? patch : base;
    if (typeof base !== 'object' || base === null) return patch ?? base;
    const out = { ...base };
    if (typeof patch !== 'object' || patch === null) return out;
    for (const k of Object.keys(patch)) {
      out[k] = k in base ? deepMerge(base[k], patch[k]) : patch[k];
    }
    return out;
  };

  let state = (() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return defaultState();
      return deepMerge(defaultState(), JSON.parse(raw));
    } catch {
      return defaultState();
    }
  })();

  const save = debounce(() => localStorage.setItem(LS_KEY, JSON.stringify(state)), 120);

  /* =========================
     DOM
  ========================== */
  const el = {
    tabs: $$('.tab'),
    pages: $$('.page'),

    btnTheme: $('#btnTheme'),
    themeLabel: $('#themeLabel'),
    btnLogin: $('#btnLogin'),
    userLabel: $('#userLabel'),
    btnAdmin: $('#btnAdmin'),
    adminState: $('#adminState'),

    barcodeInput: $('#barcodeInput'),
    searchInput: $('#searchInput'),
    chips: $$('.chip'),
    favGrid: $('#favGrid'),

    ticketNo: $('#ticketNo'),
    ticketDate: $('#ticketDate'),
    shopName: $('#shopName'),
    shopSub: $('#shopSub'),
    posBox: $('#posBox'),
    posUser: $('#posUser'),

    ticketLines: $('#ticketLines'),
    linesCount: $('#linesCount'),
    subTotal: $('#subTotal'),
    grandTotal: $('#grandTotal'),

    givenInput: $('#givenInput'),
    changeInput: $('#changeInput'),
    noteName: $('#noteName'),

    payTabs: $$('.pay-tab'),
    btnVoid: $('#btnVoid'),
    btnRefund: $('#btnRefund'),
    btnPay: $('#btnPay'),
    btnPrint: $('#btnPrint'),
    btnEmailTicket: $('#btnEmailTicket'),
    btnLastTicket: $('#btnLastTicket'),

    btnQuickAmount: $('#btnQuickAmount'),
    btnPark: $('#btnPark'),
    parkBadge: $('#parkBadge'),

    // settings
    setShopName: $('#setShopName'),
    setShopSub: $('#setShopSub'),
    setBoxName: $('#setBoxName'),
    setFooterText: $('#setFooterText'),
    setAdminPin: $('#setAdminPin'),
    setDirectPay: $('#setDirectPay'),
    setAutoPrint: $('#setAutoPrint'),
    btnAdminUnlock: $('#btnAdminUnlock'),

    // modals
    backdrop: $('#backdrop'),
    modalLogin: $('#modalLogin'),
    modalAdmin: $('#modalAdmin'),
    modalPay: $('#modalPay'),
    modalQuick: $('#modalQuick'),
    modalProduct: $('#modalProduct'),
    modalEmail: $('#modalEmail'),
    closeBtns: $$('[data-close]'),

    // login
    loginUser: $('#loginUser'),
    loginPass: $('#loginPass'),
    btnLoginOk: $('#btnLoginOk'),

    // admin
    adminPin: $('#adminPin'),
    btnAdminOk: $('#btnAdminOk'),

    // pay modal
    payTotal: $('#payTotal'),
    payMethod: $('#payMethod'),
    payGivenWrap: $('#payGivenWrap'),
    payChangeWrap: $('#payChangeWrap'),
    payGiven: $('#payGiven'),
    payChange: $('#payChange'),
    paySplitWrap: $('#paySplitWrap'),
    payCash: $('#payCash'),
    payCard: $('#payCard'),
    payNote: $('#payNote'),
    btnPayOk: $('#btnPayOk'),

    // quick modal
    quickAmount: $('#quickAmount'),
    quickName: $('#quickName'),
    btnQuickOk: $('#btnQuickOk'),

    // product modal
    prodBarcode: $('#prodBarcode'),
    prodName: $('#prodName'),
    prodPrice: $('#prodPrice'),
    prodCost: $('#prodCost'),
    prodCat: $('#prodCat'),
    prodFav: $('#prodFav'),
    prodUnit: $('#prodUnit'),
    btnProductSave: $('#btnProductSave'),

    // email
    emailTo: $('#emailTo'),
    emailMsg: $('#emailMsg'),
    btnEmailSend: $('#btnEmailSend'),

    // products page
    productsTable: $('#productsTable'),
    prodSearchName: $('#prodSearchName'),
    prodSearchBarcode: $('#prodSearchBarcode'),
    prodSearchCat: $('#prodSearchCat'),
    btnAddProduct: $('#btnAddProduct'),
    btnAddProductInline: $('#btnAddProductInline'),

    // sales page
    salesTable: $('#salesTable'),
    statTickets: $('#statTickets'),
    statTotal: $('#statTotal'),
    statCash: $('#statCash'),
    statCard: $('#statCard'),

    // profit
    profitSales: $('#profitSales'),
    profitCost: $('#profitCost'),
    profitValue: $('#profitValue'),
    profitMargin: $('#profitMargin'),

    // print area & toast
    printArea: $('#printArea'),
    toastHost: $('#toastHost'),
  };

  /* =========================
     TOAST
  ========================== */
  function toast(msg) {
    if (!el.toastHost) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    el.toastHost.appendChild(t);
    setTimeout(() => t.remove(), 1500);
  }

  /* =========================
     THEME / TABS / MODALS
  ========================== */
  function setTheme(mode) {
    const night = mode === 'night';
    document.body.classList.toggle('theme-day', !night);
    document.body.classList.toggle('theme-night', night);
    if (el.themeLabel) el.themeLabel.textContent = night ? 'Noche' : 'Día';
    state.settings.theme = night ? 'night' : 'day';
    save();
  }

  function setTab(name) {
    el.tabs.forEach(t => {
      const on = t.dataset.tab === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    el.pages.forEach(p => p.classList.toggle('is-active', p.dataset.page === name));
    if (name === 'venta') focusBarcodeSoon();
  }

  function openModal(dlg) {
    if (!dlg) return;
    if (el.backdrop) el.backdrop.hidden = false;
    dlg.showModal();
    const f = dlg.querySelector('input,select,textarea,button');
    if (f) setTimeout(() => f.focus(), 25);
  }

  function closeModal(dlg) {
    if (!dlg) return;
    dlg.close();
    if (el.backdrop) el.backdrop.hidden = true;
    focusBarcodeSoon();
  }

  function focusBarcodeSoon() {
    if (!el.barcodeInput) return;
    setTimeout(() => el.barcodeInput.focus(), 25);
  }

  /* =========================
     SECURITY (Local)
  ========================== */
  function adminUnlocked() {
    return (state.session.adminUnlockedUntil || 0) > Date.now();
  }

  function setAdminUnlocked(minutes = 5) {
    state.session.adminUnlockedUntil = Date.now() + minutes * 60 * 1000;
    save();
    renderAdminState();
  }

  function audit(type, data = {}) {
    state.audit.push({ ts: Date.now(), at: nowEs(), user: state.session.user?.name || 'CAJERO', type, data });
    if (state.audit.length > 2000) state.audit.splice(0, state.audit.length - 2000);
    save();
  }

  async function ensureDefaultHashes() {
    // admin pin default 1234
    if (!state.settings.adminPinHash) {
      state.settings.adminPinHash = await sha256Hex('1234');
      save();
    }
    // users default password 1234
    for (const u of state.users) {
      if (!u.passHash) u.passHash = await sha256Hex('1234');
    }
    save();
  }

  async function login(username, password) {
    const u = String(username || '').trim().toLowerCase();
    const p = String(password || '');
    if (!u || !p) return { ok: false, msg: 'Credenciales vacías' };
    const user = state.users.find(x => x.username === u);
    if (!user) return { ok: false, msg: 'Usuario no existe' };
    const h = await sha256Hex(p);
    if (h !== user.passHash) return { ok: false, msg: 'Contraseña incorrecta' };
    state.session.user = { name: u.toUpperCase(), role: user.role };
    save();
    audit('LOGIN', { user: u, role: user.role });
    renderHeader();
    return { ok: true };
  }

  async function verifyAdminPin(pin) {
    const h = await sha256Hex(String(pin || '').trim());
    return h === state.settings.adminPinHash;
  }

  /* =========================
     PRODUCTS
  ========================== */
  function findByBarcode(code) {
    const c = String(code || '').trim();
    if (!c) return null;
    return state.products.find(p => String(p.barcode || '').trim() === c) || null;
  }

  function listProductsForGrid(cat, q) {
    let items = state.products.slice();
    const s = String(q || '').trim().toLowerCase();

    if (s) {
      items = items.filter(p =>
        (p.name || '').toLowerCase().includes(s) ||
        String(p.barcode || '').includes(s)
      );
    }

    if (cat === 'favoritos') items = items.filter(p => !!p.fav);
    else items = items.filter(p => (p.category || '').toLowerCase() === String(cat || '').toLowerCase());

    items.sort((a, b) => (Number(!!b.fav) - Number(!!a.fav)) || (a.name || '').localeCompare(b.name || ''));
    return items.slice(0, 24);
  }

  function addOrUpdateProduct(prod) {
    const barcode = String(prod.barcode || '').trim();
    if (barcode) {
      const exists = state.products.find(p => String(p.barcode || '').trim() === barcode);
      if (exists) {
        // update
        Object.assign(exists, prod);
        return exists;
      }
    }
    const newP = { ...prod, id: prod.id || ('P-' + uid()) };
    state.products.push(newP);
    return newP;
  }

  /* =========================
     CART
  ========================== */
  const cart = {
    get active() { return state.carts.active; },
    totals() {
      const subtotal = cart.active.lines.reduce((s, l) => s + (Number(l.price) * Number(l.qty || 0)), 0);
      return { subtotal, total: subtotal };
    },
    addProduct(p, qty = 1) {
      if (!p) return;
      const key = p.id || p.barcode || p.name;
      const lines = cart.active.lines;
      const idx = lines.findIndex(l => l.key === key && !l.isManual);
      if (idx >= 0) lines[idx].qty += qty;
      else {
        lines.push({
          key,
          productId: p.id || null,
          barcode: p.barcode || '',
          name: p.name,
          price: Number(p.price || 0),
          cost: p.cost == null ? null : Number(p.cost),
          qty: qty,
          isManual: false
        });
      }
      save();
      renderAll();
    },
    addManual(amount, name) {
      const price = Number(amount || 0);
      if (!(price > 0)) return;
      cart.active.lines.push({
        key: 'M-' + uid(),
        productId: null,
        barcode: '',
        name: String(name || 'Importe').trim() || 'Importe',
        price: price,
        cost: null,
        qty: 1,
        isManual: true
      });
      save();
      renderAll();
    },
    remove(index) {
      cart.active.lines.splice(index, 1);
      save();
      renderAll();
    },
    setQty(index, qty) {
      const q = Math.max(0, Math.floor(Number(qty || 0)));
      if (q <= 0) return cart.remove(index);
      cart.active.lines[index].qty = q;
      save();
      renderAll();
    },
    inc(index, delta) {
      const l = cart.active.lines[index];
      if (!l) return;
      cart.setQty(index, (l.qty || 0) + delta);
    },
    clear() {
      state.carts.active = { lines: [], noteName: '', payMethod: 'efectivo', given: 0 };
      save();
      renderAll();
    },
    parkToggle() {
      if (state.carts.parked) {
        state.carts.active = state.carts.parked;
        state.carts.parked = null;
        save();
        renderAll();
        toast('Carrito recuperado');
      } else {
        if (!cart.active.lines.length) return toast('No hay líneas');
        state.carts.parked = JSON.parse(JSON.stringify(state.carts.active));
        state.carts.active = { lines: [], noteName: '', payMethod: 'efectivo', given: 0 };
        save();
        renderAll();
        toast('Carrito aparcado');
      }
    }
  };

  /* =========================
     TICKET (PrintArea)
  ========================== */
  function nextTicketNo() {
    const n = state.counters.ticketSeq || 1;
    state.counters.ticketSeq = n + 1;
    save();
    return `T-${String(n).padStart(6, '0')}`;
  }

  function buildTicketHTML(saleLike) {
    const s = saleLike;
    const lines = s.lines || [];
    const head = `
      <div style="text-align:center; font-weight:900; margin-bottom:4px;">${escapeHtml(state.settings.shopName)}</div>
      <div style="text-align:center; margin-bottom:8px;">${escapeHtml(state.settings.shopSub)}</div>
      <div style="border-top:1px dashed #000; margin:6px 0;"></div>
      <div>${escapeHtml(s.ticketNo || '')}  ${escapeHtml(s.date || nowEs())}</div>
      <div>Caja: ${escapeHtml(s.box || state.settings.boxName)}  Cajero: ${escapeHtml(s.user || state.session.user.name)}</div>
      <div style="border-top:1px dashed #000; margin:6px 0;"></div>
    `;

    const body = lines.map(l => {
      const totalLine = Number(l.price) * Number(l.qty);
      return `
        <div style="display:flex; justify-content:space-between; gap:8px;">
          <div style="max-width:58mm; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;">
            ${escapeHtml(l.name)}
          </div>
          <div style="text-align:right;">${fmtMoney(totalLine)}</div>
        </div>
        <div style="display:flex; justify-content:space-between; color:#111; margin-bottom:4px;">
          <div>${l.qty} x ${fmtMoney(l.price)}</div>
          <div></div>
        </div>
      `;
    }).join('');

    const foot = `
      <div style="border-top:1px dashed #000; margin:6px 0;"></div>
      <div style="display:flex; justify-content:space-between; font-weight:900;">
        <div>TOTAL</div><div>${fmtMoney(s.total)} €</div>
      </div>
      <div>Pago: ${escapeHtml(s.payMethod || '')}</div>
      ${(s.payMethod === 'efectivo' || s.payMethod === 'mixto') ? `<div>Entregado: ${fmtMoney(s.given || 0)} €</div>` : ``}
      ${(s.payMethod === 'efectivo' || s.payMethod === 'mixto') ? `<div>Cambio: ${fmtMoney(s.change || 0)} €</div>` : ``}
      ${s.noteName ? `<div>Nota: ${escapeHtml(s.noteName)}</div>` : ``}
      <div style="border-top:1px dashed #000; margin:6px 0;"></div>
      <div style="text-align:center; margin-top:6px;">${escapeHtml(state.settings.footerText || 'Gracias por su compra')}</div>
      <div style="text-align:center; margin-top:4px;">IVA incluido en los precios</div>
    `;

    return `<div>${head}${body}${foot}</div>`;
  }

  function buildReceiptText(s) {
    const out = [];
    out.push(state.settings.shopName);
    out.push(state.settings.shopSub);
    out.push('------------------------------');
    out.push(`${s.ticketNo}   ${s.date}`);
    out.push(`Caja: ${s.box}   Cajero: ${s.user}`);
    out.push('------------------------------');
    for (const l of s.lines) {
      out.push(l.name);
      out.push(`  ${l.qty} x ${fmtMoney(l.price)}  = ${fmtMoney(l.price * l.qty)}`);
    }
    out.push('------------------------------');
    out.push(`TOTAL: ${fmtMoney(s.total)} €`);
    out.push(`Pago: ${s.payMethod}`);
    if (s.payMethod === 'efectivo' || s.payMethod === 'mixto') {
      out.push(`Entregado: ${fmtMoney(s.given || 0)} €`);
      out.push(`Cambio: ${fmtMoney(s.change || 0)} €`);
    }
    if (s.noteName) out.push(`Nota: ${s.noteName}`);
    out.push('------------------------------');
    out.push(state.settings.footerText || 'Gracias por su compra');
    out.push('IVA incluido en los precios');
    return out.join('\n');
  }

  function printSaleLike(s) {
    if (!el.printArea) return;
    el.printArea.innerHTML = buildTicketHTML(s);
    window.print();
  }

  /* =========================
     SALE
  ========================== */
  function saveSale({ payMethod, given, cashAmount, cardAmount, noteName }) {
    const { total } = cart.totals();
    if (!(total > 0)) return null;

    const ticketNo = nextTicketNo();
    const sale = {
      id: uid(),
      ticketNo,
      date: nowEs(),
      box: state.settings.boxName,
      user: state.session.user.name,
      payMethod,
      given: Number(given || 0),
      change: 0,
      noteName: String(noteName || '').trim(),
      lines: cart.active.lines.map(l => ({
        name: l.name,
        barcode: l.barcode || '',
        qty: Number(l.qty || 0),
        price: Number(l.price || 0),
        cost: l.cost == null ? null : Number(l.cost),
        isManual: !!l.isManual
      })),
      total: total,
      split: payMethod === 'mixto' ? { cash: Number(cashAmount || 0), card: Number(cardAmount || 0) } : null,
    };

    if (payMethod === 'efectivo') {
      sale.change = Math.max(0, sale.given - sale.total);
    } else if (payMethod === 'mixto') {
      const cash = Number(cashAmount || 0);
      const card = Number(cardAmount || 0);
      // cambio solo si efectivo supera lo que queda tras tarjeta
      const remaining = Math.max(0, sale.total - card);
      sale.change = Math.max(0, cash - remaining);
    }

    state.sales.push(sale);
    state.lastSaleId = sale.id;
    save();
    audit('SALE_CREATE', { ticketNo: sale.ticketNo, total: sale.total, payMethod });
    return sale;
  }

  function getLastSale() {
    if (!state.lastSaleId) return state.sales[state.sales.length - 1] || null;
    return state.sales.find(s => s.id === state.lastSaleId) || state.sales[state.sales.length - 1] || null;
  }

  /* =========================
     RENDER
  ========================== */
  function renderHeader() {
    setTheme(state.settings.theme || 'day');

    if (el.userLabel) el.userLabel.textContent = state.session.user?.name || 'CAJERO';
    if (el.posUser) el.posUser.textContent = state.session.user?.name || 'CAJERO';

    if (el.shopName) el.shopName.textContent = state.settings.shopName || 'Tu Tienda';
    if (el.shopSub) el.shopSub.textContent = state.settings.shopSub || 'CIF / Dirección / Tel';
    if (el.posBox) el.posBox.textContent = state.settings.boxName || 'CAJA-1';

    if (el.ticketDate) el.ticketDate.textContent = nowEs();

    const seq = state.counters.ticketSeq || 1;
    if (el.ticketNo) el.ticketNo.textContent = `T-${String(seq).padStart(6, '0')}`;

    renderAdminState();
    renderParkState();
  }

  function renderAdminState() {
    if (!el.adminState) return;
    el.adminState.textContent = adminUnlocked() ? 'Admin ✓' : 'Admin';
  }

  function renderParkState() {
    if (!el.parkBadge) return;
    if (state.carts.parked && state.carts.parked.lines?.length) {
      el.parkBadge.hidden = false;
      el.parkBadge.textContent = String(state.carts.parked.lines.length);
    } else {
      el.parkBadge.hidden = true;
    }
  }

  function renderFavorites() {
    if (!el.favGrid) return;
    const activeChip = el.chips.find(c => c.classList.contains('is-active'));
    const cat = activeChip ? activeChip.dataset.cat : 'favoritos';
    const q = el.searchInput ? el.searchInput.value : '';
    const items = listProductsForGrid(cat, q);

    el.favGrid.innerHTML = '';

    // Tile: Importe rápido siempre
    el.favGrid.appendChild(makeFavTile('Importe rápido', 'Manual', () => openModal(el.modalQuick)));

    // Tiles: productos
    for (const p of items) {
      const priceText = p.price != null ? fmtEUR(p.price) : '—';
      el.favGrid.appendChild(makeFavTile(p.name, priceText, () => cart.addProduct(p, 1)));
    }

    // Tile: Aparcar/Recuperar rápido
    if (state.carts.parked) {
      el.favGrid.appendChild(makeFavTile('Recuperar', 'Carrito', () => cart.parkToggle()));
    }
  }

  function makeFavTile(name, sub, onClick) {
    const btn = document.createElement('button');
    btn.className = 'fav';
    btn.type = 'button';
    btn.innerHTML = `<div class="fav-name">${escapeHtml(name)}</div><div class="fav-price">${escapeHtml(sub)}</div>`;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function renderLines() {
    if (!el.ticketLines) return;

    // Keep header row
    const thead = el.ticketLines.querySelector('.trow.thead');
    el.ticketLines.innerHTML = '';
    if (thead) el.ticketLines.appendChild(thead);

    cart.active.lines.forEach((l, idx) => {
      const row = document.createElement('div');
      row.className = 'trow';
      row.setAttribute('role', 'row');

      row.innerHTML = `
        <div class="tcell">
          <div>
            <div class="line-name">${escapeHtml(l.name)}</div>
            <div class="line-sub mono">${escapeHtml(l.barcode ? ('BC: ' + l.barcode) : 'Manual')}</div>
          </div>
        </div>
        <div class="tcell tcell-center">
          <div class="qty">
            <button class="qty-btn" type="button" aria-label="menos">−</button>
            <input class="qty-in" value="${escapeHtml(l.qty)}" inputmode="numeric" />
            <button class="qty-btn" type="button" aria-label="más">+</button>
          </div>
        </div>
        <div class="tcell tcell-right mono">${fmtMoney(l.price)}</div>
        <div class="tcell tcell-right mono">${fmtMoney(l.price * l.qty)}</div>
      `;

      const btnMinus = row.querySelectorAll('.qty-btn')[0];
      const btnPlus  = row.querySelectorAll('.qty-btn')[1];
      const qtyIn    = row.querySelector('.qty-in');

      btnMinus.addEventListener('click', () => cart.inc(idx, -1));
      btnPlus.addEventListener('click', () => cart.inc(idx, +1));

      qtyIn.addEventListener('change', () => cart.setQty(idx, qtyIn.value));
      qtyIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          qtyIn.blur();
          focusBarcodeSoon();
        }
      });

      // Click derecho: borrar línea
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        cart.remove(idx);
      });

      el.ticketLines.appendChild(row);
    });
  }

  function renderTotals() {
    const { total } = cart.totals();
    if (el.linesCount) el.linesCount.textContent = String(cart.active.lines.length);
    if (el.subTotal) el.subTotal.textContent = fmtEUR(total);
    if (el.grandTotal) el.grandTotal.textContent = fmtEUR(total);

    const method = cart.active.payMethod || 'efectivo';
    const given = parseMoney(el.givenInput?.value ?? cart.active.given);

    const change = (method === 'efectivo')
      ? Math.max(0, given - total)
      : 0;

    if (el.changeInput) el.changeInput.value = fmtMoney(change);
  }

  function renderProductsTable() {
    if (!el.productsTable) return;

    // conservar thead
    const thead = el.productsTable.querySelector('.trow.thead');
    el.productsTable.innerHTML = '';
    if (thead) el.productsTable.appendChild(thead);

    const qName = String(el.prodSearchName?.value || '').trim().toLowerCase();
    const qBar  = String(el.prodSearchBarcode?.value || '').trim();
    const qCat  = String(el.prodSearchCat?.value || '').trim().toLowerCase();

    let items = state.products.slice();
    if (qName) items = items.filter(p => (p.name || '').toLowerCase().includes(qName));
    if (qBar)  items = items.filter(p => String(p.barcode || '').includes(qBar));
    if (qCat)  items = items.filter(p => (p.category || '').toLowerCase() === qCat);

    items.sort((a,b) => (a.name||'').localeCompare(b.name||''));

    for (const p of items) {
      const row = document.createElement('div');
      row.className = 'trow';
      row.innerHTML = `
        <div class="tcell">
          <div>
            <div class="line-name">${escapeHtml(p.name)}</div>
            <div class="line-sub muted">${escapeHtml(p.category || '')}</div>
          </div>
        </div>
        <div class="tcell mono">${escapeHtml(p.barcode || '—')}</div>
        <div class="tcell tcell-right mono">${fmtMoney(p.price || 0)}</div>
        <div class="tcell tcell-right mono">${p.cost == null ? '—' : fmtMoney(p.cost)}</div>
        <div class="tcell tcell-center">${p.fav ? '<span class="badge badge-ok">Sí</span>' : '<span class="badge">No</span>'}</div>
        <div class="tcell tcell-right">
          <button class="btn btn-ghost btn-small" type="button">Editar</button>
          <button class="btn btn-ghost btn-small" type="button">Borrar</button>
        </div>
      `;
      const [btnEdit, btnDel] = row.querySelectorAll('button');

      btnEdit.addEventListener('click', () => {
        // prefill modal
        el.prodBarcode.value = p.barcode || '';
        el.prodName.value = p.name || '';
        el.prodPrice.value = fmtMoney(p.price || 0).replace('.', ',');
        el.prodCost.value = p.cost == null ? '' : fmtMoney(p.cost).replace('.', ',');
        el.prodCat.value = p.category || 'Otros';
        el.prodFav.value = p.fav ? '1' : '0';
        el.prodUnit.value = p.unit || 'ud';
        // guardamos id en dataset
        el.modalProduct.dataset.editId = p.id;
        openModal(el.modalProduct);
      });

      btnDel.addEventListener('click', () => {
        if (!adminUnlocked()) return (openModal(el.modalAdmin), toast('PIN admin requerido'));
        if (!confirm(`¿Borrar producto "${p.name}"?`)) return;
        state.products = state.products.filter(x => x.id !== p.id);
        save();
        renderAll();
        toast('Producto borrado');
      });

      el.productsTable.appendChild(row);
    }
  }

  function renderSalesSummary() {
    const sales = state.sales.slice();
    const tickets = sales.length;
    const total = sales.reduce((s, x) => s + (Number(x.total) || 0), 0);

    const cash = sales.reduce((s, x) => {
      if (x.payMethod === 'efectivo') return s + (Number(x.total) || 0);
      if (x.payMethod === 'mixto') return s + (Number(x.split?.cash) || 0);
      return s;
    }, 0);

    const card = sales.reduce((s, x) => {
      if (x.payMethod === 'tarjeta') return s + (Number(x.total) || 0);
      if (x.payMethod === 'mixto') return s + (Number(x.split?.card) || 0);
      return s;
    }, 0);

    if (el.statTickets) el.statTickets.textContent = String(tickets);
    if (el.statTotal) el.statTotal.textContent = fmtEUR(total);
    if (el.statCash) el.statCash.textContent = fmtEUR(cash);
    if (el.statCard) el.statCard.textContent = fmtEUR(card);

    // sales table
    if (el.salesTable) {
      const thead = el.salesTable.querySelector('.trow.thead');
      el.salesTable.innerHTML = '';
      if (thead) el.salesTable.appendChild(thead);

      const last = sales.slice(-50).reverse();
      for (const s of last) {
        const row = document.createElement('div');
        row.className = 'trow';
        row.innerHTML = `
          <div class="tcell mono">${escapeHtml(s.date)}</div>
          <div class="tcell mono">${escapeHtml(s.ticketNo)}</div>
          <div class="tcell">${escapeHtml(s.payMethod)}</div>
          <div class="tcell tcell-right mono">${fmtMoney(s.total)} €</div>
          <div class="tcell tcell-right">
            <button class="btn btn-ghost btn-small" type="button">Imprimir</button>
          </div>
        `;
        row.querySelector('button').addEventListener('click', () => printSaleLike(s));
        el.salesTable.appendChild(row);
      }
    }

    // profits
    const cost = sales.reduce((s, x) => {
      const c = (x.lines || []).reduce((sum, l) => {
        if (l.cost == null) return sum;
        return sum + (Number(l.cost) * Number(l.qty || 0));
      }, 0);
      return s + c;
    }, 0);
    const profit = total - cost;
    const margin = total > 0 ? (profit / total) * 100 : 0;

    if (el.profitSales) el.profitSales.textContent = fmtEUR(total);
    if (el.profitCost) el.profitCost.textContent = fmtEUR(cost);
    if (el.profitValue) el.profitValue.textContent = fmtEUR(profit);
    if (el.profitMargin) el.profitMargin.textContent = `${margin.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
  }

  function renderAll() {
    renderHeader();
    renderFavorites();
    renderLines();
    renderTotals();
    renderProductsTable();
    renderSalesSummary();
  }

  /* =========================
     PAY FLOW
  ========================== */
  function openQuickModal(prefilledAmount = '', prefilledName = '') {
    if (el.quickAmount) el.quickAmount.value = prefilledAmount;
    if (el.quickName) el.quickName.value = prefilledName;
    openModal(el.modalQuick);
  }

  function openPayModal() {
    const { total } = cart.totals();
    if (!(total > 0)) return toast('No hay líneas');

    if (el.payTotal) el.payTotal.textContent = fmtEUR(total);
    if (el.payNote) el.payNote.value = el.noteName?.value || cart.active.noteName || '';

    // sincroniza método principal con modal
    const m = cart.active.payMethod || 'efectivo';
    if (el.payMethod) el.payMethod.value = m;
    syncPayUI();

    // entregado/cambio
    if (el.payGiven) el.payGiven.value = (el.givenInput?.value || '').trim();
    calcPayChange();

    openModal(el.modalPay);
  }

  function syncPayUI() {
    const m = el.payMethod?.value || 'efectivo';
    const isCash = m === 'efectivo';
    const isCard = m === 'tarjeta';
    const isMix  = m === 'mixto';

    if (el.paySplitWrap) el.paySplitWrap.hidden = !isMix;
    if (el.payGivenWrap) el.payGivenWrap.style.display = (isCash || isMix) ? '' : 'none';
    if (el.payChangeWrap) el.payChangeWrap.style.display = (isCash || isMix) ? '' : 'none';

    if (isCard) {
      if (el.payGiven) el.payGiven.value = '';
      if (el.payChange) el.payChange.value = '0,00';
    }
  }

  function calcPayChange() {
    const { total } = cart.totals();
    const m = el.payMethod?.value || 'efectivo';

    if (m === 'efectivo') {
      const given = parseMoney(el.payGiven?.value || '0');
      if (el.payChange) el.payChange.value = fmtMoney(Math.max(0, given - total));
      return;
    }
    if (m === 'mixto') {
      const card = parseMoney(el.payCard?.value || '0');
      const cash = parseMoney(el.payCash?.value || '0');
      const remaining = Math.max(0, total - card);
      const change = Math.max(0, cash - remaining);
      if (el.payChange) el.payChange.value = fmtMoney(change);
      return;
    }
    if (el.payChange) el.payChange.value = '0,00';
  }

  function confirmSaleFromUI({ fromModal = true } = {}) {
    const { total } = cart.totals();
    if (!(total > 0)) return toast('No hay total');

    let method, given, note, cashAmount = 0, cardAmount = 0;

    if (fromModal) {
      method = el.payMethod?.value || cart.active.payMethod || 'efectivo';
      note = (el.payNote?.value || '').trim();
      if (method === 'efectivo') {
        given = parseMoney(el.payGiven?.value || '0');
      } else if (method === 'tarjeta') {
        given = 0;
      } else {
        cashAmount = parseMoney(el.payCash?.value || '0');
        cardAmount = parseMoney(el.payCard?.value || '0');
        given = cashAmount;
      }
    } else {
      method = cart.active.payMethod || 'efectivo';
      note = (el.noteName?.value || '').trim();
      given = parseMoney(el.givenInput?.value || '0');
    }

    // validación mínima
    if (method === 'efectivo' && given < total) {
      if (!confirm('Entregado menor que total. ¿Confirmar igualmente?')) return;
    }
    if (method === 'mixto') {
      if ((cashAmount + cardAmount) < total) {
        if (!confirm('Mixto: suma efectivo+tarjeta menor que total. ¿Confirmar igualmente?')) return;
      }
    }

    const sale = saveSale({ payMethod: method, given, cashAmount, cardAmount, noteName: note });
    if (!sale) return toast('Error al guardar');

    // Actualiza UI ticket
    if (el.ticketNo) el.ticketNo.textContent = sale.ticketNo;

    // Cierra modal si aplica
    if (fromModal) closeModal(el.modalPay);

    // Limpia carrito
    cart.clear();
    toast(`Venta OK · ${sale.ticketNo}`);

    // imprimir
    if (state.settings.autoPrint) {
      printSaleLike(sale);
    } else {
      // si no autoPrint, deja manual o pregunta rápida
      // (puedes quitar el confirm si quieres aún más rápido)
      if (confirm('¿Imprimir ticket?')) printSaleLike(sale);
    }
  }

  /* =========================
     EMAIL
  ========================== */
  function openEmailModal() {
    openModal(el.modalEmail);
  }

  function sendEmailMailto() {
    const to = (el.emailTo?.value || '').trim();
    const extra = (el.emailMsg?.value || '').trim();

    const last = getLastSale();
    let saleLike = last;

    // si no hay venta, usamos el carrito como preview
    if (!saleLike) {
      const { total } = cart.totals();
      saleLike = {
        ticketNo: '(PREVIEW)',
        date: nowEs(),
        box: state.settings.boxName,
        user: state.session.user.name,
        payMethod: cart.active.payMethod,
        given: parseMoney(el.givenInput?.value || '0'),
        change: 0,
        noteName: (el.noteName?.value || '').trim(),
        lines: cart.active.lines.map(l => ({ ...l })),
        total
      };
    }

    const subject = `Ticket ${saleLike.ticketNo} - ${state.settings.shopName}`;
    const body = buildReceiptText(saleLike) + (extra ? `\n\n${extra}` : '');
    const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = url;
    closeModal(el.modalEmail);
  }

  /* =========================
     EVENTS
  ========================== */
  function bindTabs() {
    el.tabs.forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));
  }

  function bindTheme() {
    el.btnTheme?.addEventListener('click', () => setTheme(document.body.classList.contains('theme-day') ? 'night' : 'day'));
  }

  function bindModals() {
    el.backdrop?.addEventListener('click', () => {
      const open = document.querySelector('dialog[open]');
      if (open) closeModal(open);
    });

    el.closeBtns.forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.close;
      closeModal(document.getElementById(id));
    }));

    el.btnLogin?.addEventListener('click', () => openModal(el.modalLogin));
    el.btnAdmin?.addEventListener('click', () => openModal(el.modalAdmin));
    el.btnAdminUnlock?.addEventListener('click', () => openModal(el.modalAdmin));

    el.btnQuickAmount?.addEventListener('click', () => openQuickModal('', ''));
    el.btnPark?.addEventListener('click', () => cart.parkToggle());
    el.btnAddProductInline?.addEventListener('click', () => { el.modalProduct.dataset.editId = ''; openModal(el.modalProduct); });
    el.btnAddProduct?.addEventListener('click', () => { el.modalProduct.dataset.editId = ''; openModal(el.modalProduct); });

    el.btnPrint?.addEventListener('click', () => {
      const last = getLastSale();
      if (last) return printSaleLike(last);
      // si no hay venta, imprimir preview del carrito
      const { total } = cart.totals();
      if (!(total > 0)) return toast('No hay ticket');
      printSaleLike({
        ticketNo: '(PREVIEW)',
        date: nowEs(),
        box: state.settings.boxName,
        user: state.session.user.name,
        payMethod: cart.active.payMethod,
        given: parseMoney(el.givenInput?.value || '0'),
        change: 0,
        noteName: (el.noteName?.value || '').trim(),
        lines: cart.active.lines.map(l => ({ name: l.name, qty: l.qty, price: l.price })),
        total
      });
    });

    el.btnEmailTicket?.addEventListener('click', openEmailModal);
    el.btnLastTicket?.addEventListener('click', () => {
      const last = getLastSale();
      if (!last) return toast('No hay último ticket');
      printSaleLike(last);
    });

    el.btnVoid?.addEventListener('click', () => {
      if (!cart.active.lines.length) return;
      if (!confirm('¿Anular ticket actual?')) return;
      cart.clear();
      audit('CART_VOID', {});
      toast('Ticket anulado');
    });

    el.btnRefund?.addEventListener('click', () => {
      if (!adminUnlocked()) {
        openModal(el.modalAdmin);
        return toast('PIN admin requerido');
      }
      const last = getLastSale();
      if (!last) return toast('No hay venta');
      // devolución demo: registra ticket negativo
      const refund = {
        ...last,
        id: uid(),
        ticketNo: nextTicketNo(),
        date: nowEs(),
        payMethod: 'devolucion',
        lines: (last.lines || []).map(l => ({ ...l, qty: -Math.abs(l.qty) })),
        total: -Math.abs(last.total),
        noteName: `DEVOLUCIÓN de ${last.ticketNo}`
      };
      state.sales.push(refund);
      state.lastSaleId = refund.id;
      save();
      audit('SALE_REFUND', { from: last.ticketNo, refund: refund.ticketNo, total: refund.total });
      toast('Devolución registrada');
      renderSalesSummary();
    });

    el.btnPay?.addEventListener('click', () => {
      if (state.settings.directPay) {
        confirmSaleFromUI({ fromModal: false });
      } else {
        openPayModal();
      }
    });

    // login
    el.btnLoginOk?.addEventListener('click', async () => {
      const u = el.loginUser?.value || '';
      const p = el.loginPass?.value || '';
      const res = await login(u, p);
      if (!res.ok) return toast(res.msg || 'Login error');
      closeModal(el.modalLogin);
      toast('Sesión iniciada');
      renderAll();
    });

    // admin unlock
    el.btnAdminOk?.addEventListener('click', async () => {
      const pin = (el.adminPin?.value || '').trim();
      if (pin.length < 4) return toast('PIN inválido');
      if (!(await verifyAdminPin(pin))) return toast('PIN incorrecto');
      setAdminUnlocked(5);
      closeModal(el.modalAdmin);
      toast('Admin desbloqueado (5 min)');
    });

    // pay modal changes
    el.payMethod?.addEventListener('change', () => { syncPayUI(); calcPayChange(); });
    el.payGiven?.addEventListener('input', calcPayChange);
    el.payCash?.addEventListener('input', calcPayChange);
    el.payCard?.addEventListener('input', calcPayChange);

    el.btnPayOk?.addEventListener('click', () => confirmSaleFromUI({ fromModal: true }));

    // quick modal
    el.btnQuickOk?.addEventListener('click', () => {
      const amt = parseMoney(el.quickAmount?.value || '0');
      const name = (el.quickName?.value || 'Importe').trim();
      if (!(amt > 0)) return toast('Importe inválido');
      cart.addManual(amt, name);
      closeModal(el.modalQuick);
      toast('Importe añadido');
    });

    // product save
    el.btnProductSave?.addEventListener('click', () => {
      const editId = el.modalProduct.dataset.editId || '';
      const barcode = (el.prodBarcode?.value || '').trim();
      const name = (el.prodName?.value || '').trim();
      const price = parseMoney(el.prodPrice?.value || '0');
      const costRaw = (el.prodCost?.value || '').trim();
      const cost = costRaw ? parseMoney(costRaw) : null;
      const category = el.prodCat?.value || 'Otros';
      const fav = (el.prodFav?.value || '0') === '1';
      const unit = el.prodUnit?.value || 'ud';

      if (!name) return toast('Falta nombre');
      if (!(price >= 0)) return toast('Precio inválido');

      const p = addOrUpdateProduct({
        id: editId || undefined,
        barcode,
        name,
        price,
        cost,
        category,
        fav,
        unit
      });

      // limpia dataset edit
      el.modalProduct.dataset.editId = '';
      closeModal(el.modalProduct);
      save();
      renderAll();
      toast('Producto guardado');

      // si venía de escaneo no encontrado y es favorito, se añade rápido
      if (barcode && el.barcodeInput) el.barcodeInput.value = '';
    });

    // email send
    el.btnEmailSend?.addEventListener('click', sendEmailMailto);
  }

  function bindPOSInputs() {
    // keep focus on barcode when clicking outside inputs
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t) return;
      const tag = t.tagName?.toLowerCase();
      const inDialog = !!t.closest('dialog');
      if (inDialog) return;
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') return;
      focusBarcodeSoon();
    });

    // barcode input Enter
    el.barcodeInput?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const code = (el.barcodeInput.value || '').trim();
      el.barcodeInput.value = '';
      if (!code) return;

      const p = findByBarcode(code);
      if (p) {
        cart.addProduct(p, 1);
        toast('Añadido');
      } else {
        // abrir alta con barcode precargado
        el.modalProduct.dataset.editId = '';
        el.prodBarcode.value = code;
        el.prodName.value = '';
        el.prodPrice.value = '';
        el.prodCost.value = '';
        el.prodCat.value = 'Otros';
        el.prodFav.value = '1';
        el.prodUnit.value = 'ud';
        openModal(el.modalProduct);
        toast('Barcode no encontrado: alta producto');
      }
    });

    // search
    el.searchInput?.addEventListener('input', renderFavorites);

    // chips
    el.chips.forEach(c => c.addEventListener('click', () => {
      el.chips.forEach(x => x.classList.remove('is-active'));
      c.classList.add('is-active');
      renderFavorites();
    }));

    // pay tabs main
    el.payTabs.forEach(p => p.addEventListener('click', () => {
      el.payTabs.forEach(x => x.classList.remove('is-active'));
      p.classList.add('is-active');
      cart.active.payMethod = p.dataset.pay || 'efectivo';
      save();
      renderTotals();
      focusBarcodeSoon();
    }));

    // given + note
    el.givenInput?.addEventListener('input', () => { cart.active.given = parseMoney(el.givenInput.value); save(); renderTotals(); });
    el.noteName?.addEventListener('input', () => { cart.active.noteName = el.noteName.value || ''; save(); });

    // products search in products page
    const reRenderProducts = debounce(renderProductsTable, 80);
    el.prodSearchName?.addEventListener('input', reRenderProducts);
    el.prodSearchBarcode?.addEventListener('input', reRenderProducts);
    el.prodSearchCat?.addEventListener('change', reRenderProducts);
  }

  function bindSettings() {
    // init inputs
    if (el.setShopName) el.setShopName.value = state.settings.shopName;
    if (el.setShopSub) el.setShopSub.value = state.settings.shopSub;
    if (el.setBoxName) el.setBoxName.value = state.settings.boxName;
    if (el.setFooterText) el.setFooterText.value = state.settings.footerText;
    if (el.setDirectPay) el.setDirectPay.value = state.settings.directPay ? '1' : '0';
    if (el.setAutoPrint) el.setAutoPrint.value = state.settings.autoPrint ? '1' : '0';

    const apply = debounce(() => {
      state.settings.shopName = el.setShopName?.value || state.settings.shopName;
      state.settings.shopSub = el.setShopSub?.value || state.settings.shopSub;
      state.settings.boxName = el.setBoxName?.value || state.settings.boxName;
      state.settings.footerText = el.setFooterText?.value || state.settings.footerText;
      state.settings.directPay = (el.setDirectPay?.value || '0') === '1';
      state.settings.autoPrint = (el.setAutoPrint?.value || '0') === '1';
      save();
      renderHeader();
    }, 120);

    el.setShopName?.addEventListener('input', apply);
    el.setShopSub?.addEventListener('input', apply);
    el.setBoxName?.addEventListener('input', apply);
    el.setFooterText?.addEventListener('input', apply);
    el.setDirectPay?.addEventListener('change', apply);
    el.setAutoPrint?.addEventListener('change', apply);

    // set admin pin (hash)
    el.setAdminPin?.addEventListener('change', async () => {
      const pin = (el.setAdminPin.value || '').trim();
      if (!pin) return;
      if (pin.length < 4) return toast('PIN mínimo 4 dígitos');
      state.settings.adminPinHash = await sha256Hex(pin);
      el.setAdminPin.value = '';
      save();
      toast('PIN admin actualizado');
    });
  }

  /* =========================
     SHORTCUTS
  ========================== */
  function bindShortcuts() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      const typing = (tag === 'input' || tag === 'textarea' || tag === 'select');

      if (e.key === 'F4') { e.preventDefault(); state.settings.directPay ? confirmSaleFromUI({ fromModal:false }) : openPayModal(); return; }
      if (e.key === 'F2') { e.preventDefault(); openQuickModal('', ''); return; }

      if (e.key === 'Escape') {
        const open = document.querySelector('dialog[open]');
        if (open) { e.preventDefault(); closeModal(open); return; }
        if (!typing && cart.active.lines.length) {
          if (confirm('¿Limpiar ticket actual?')) cart.clear();
        }
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Supr') && !typing) {
        if (!cart.active.lines.length) return;
        e.preventDefault();
        cart.remove(cart.active.lines.length - 1);
        return;
      }

      if (!typing && (e.key === '+' || e.key === '=')) {
        if (!cart.active.lines.length) return;
        e.preventDefault();
        cart.inc(cart.active.lines.length - 1, +1);
        return;
      }
      if (!typing && (e.key === '-' || e.key === '_')) {
        if (!cart.active.lines.length) return;
        e.preventDefault();
        cart.inc(cart.active.lines.length - 1, -1);
        return;
      }

      if (e.key === 'Enter' && !typing) focusBarcodeSoon();
    });
  }

  /* =========================
     INIT
  ========================== */
  async function init() {
    await ensureDefaultHashes();

    // theme
    setTheme(state.settings.theme || 'day');

    // default tab
    setTab('venta');

    // bind
    bindTabs();
    bindTheme();
    bindModals();
    bindPOSInputs();
    bindSettings();
    bindShortcuts();

    // render
    renderAll();
    focusBarcodeSoon();

    // update clock
    setInterval(() => { if (el.ticketDate) el.ticketDate.textContent = nowEs(); }, 15000);
  }

  init();
})();

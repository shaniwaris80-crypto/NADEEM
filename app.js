/* =========================
TPV TIENDA — B/W PRO — PAQUETE PRO (OPCIÓN 1 / GITHUB)
Archivo: app.js
Incluye:
- Escaneo GLOBAL (siempre atento, aunque no esté el input enfocado)
- Categorías: crear/renombrar/borrar + chips dinámicos + selects dinámicos
- Importe rápido: teclado numérico en pantalla
- Aparcar múltiples tickets (lista, renombrar, recuperar, borrar)
- Ticket 80mm (printArea) + email mailto
- Backup JSON + import JSON
- Import/Export CSV productos
- Cierre Z (arqueo) + listado cierres
- Login local (cajero/admin) + PIN Admin (hash)
========================= */

(() => {
  'use strict';

  /* =========================
     HELPERS
  ========================== */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const LS_KEY = 'TPV_BWPRO_PRO_V1_2';

  const pad = (n) => (n < 10 ? '0' : '') + n;
  const now = () => new Date();
  const nowEs = () => {
    const d = now();
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const dateKey = (d = now()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

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

  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880;
      g.gain.value = 0.03;
      o.start();
      setTimeout(() => { o.stop(); ctx.close(); }, 70);
    } catch (_) {}
  }

  /* =========================
     STATE
  ========================== */
  const defaultState = () => ({
    version: '1.2-pro',
    settings: {
      shopName: 'Tu Tienda',
      shopSub: 'CIF / Dirección / Tel',
      footerText: 'Gracias por su compra',
      boxName: 'CAJA-1',
      theme: 'day',
      directPay: false,
      autoPrint: false,
      autoGoSaleOnScan: true,
      beepOnScan: true,
      adminPinHash: '',
    },
    session: {
      user: { name: 'CAJERO', role: 'cashier' },
      adminUnlockedUntil: 0,
    },
    counters: { ticketSeq: 1 },
    users: [
      { username: 'cajero', passHash: '', role: 'cashier' },
      { username: 'admin',  passHash: '', role: 'admin' },
    ],
    categories: ['Fruta', 'Verdura', 'Tropical', 'Otros'],
    products: [
      { id: 'P1', barcode: '1234567890123', name: 'Plátano',  price: 1.89, cost: 1.20, category: 'Fruta',   fav: true, unit: 'ud' },
      { id: 'P2', barcode: '7894561230123', name: 'Manzana',  price: 2.40, cost: 1.50, category: 'Fruta',   fav: true, unit: 'ud' },
      { id: 'P3', barcode: '2345678901234', name: 'Naranja',  price: 1.60, cost: 0.95, category: 'Fruta',   fav: true, unit: 'ud' },
      { id: 'P4', barcode: '3456789012345', name: 'Tomate',   price: 2.10, cost: 1.25, category: 'Verdura', fav: true, unit: 'ud' },
      { id: 'P5', barcode: '4567890123456', name: 'Lechuga',  price: 1.20, cost: 0.70, category: 'Verdura', fav: true, unit: 'ud' },
      { id: 'P6', barcode: '5678901234567', name: 'Aguacate', price: 3.90, cost: 2.30, category: 'Tropical',fav: true, unit: 'ud' },
      { id: 'P7', barcode: '',              name: 'Bolsa',    price: 0.10, cost: null, category: 'Otros',   fav: true, unit: 'ud' },
    ],
    carts: {
      active: { lines: [], noteName: '', payMethod: 'efectivo', given: 0 },
      parkedList: [], // [{id,name,ts,cart}]
    },
    sales: [],
    lastSaleId: null,
    closingsZ: [], // [{id,dateKey,at,total,cash,card,counted,diff,note,user}]
    audit: []
  });

  const deepMerge = (base, patch) => {
    if (Array.isArray(base)) return Array.isArray(patch) ? patch : base;
    if (typeof base !== 'object' || base === null) return patch ?? base;
    const out = { ...base };
    if (typeof patch !== 'object' || patch === null) return out;
    for (const k of Object.keys(patch)) out[k] = k in base ? deepMerge(base[k], patch[k]) : patch[k];
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

    // venta
    barcodeInput: $('#barcodeInput'),
    searchInput: $('#searchInput'),
    catChips: $('#catChips'),
    chips: () => $$('.chip', el.catChips || document),
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
    btnCats: $('#btnCats'),
    btnCats2: $('#btnCats2'),

    // settings
    setShopName: $('#setShopName'),
    setShopSub: $('#setShopSub'),
    setBoxName: $('#setBoxName'),
    setFooterText: $('#setFooterText'),
    setAdminPin: $('#setAdminPin'),
    setDirectPay: $('#setDirectPay'),
    setAutoPrint: $('#setAutoPrint'),
    setAutoGoSale: $('#setAutoGoSale'),
    setBeep: $('#setBeep'),
    btnAdminUnlock: $('#btnAdminUnlock'),

    // modals
    backdrop: $('#backdrop'),
    modalLogin: $('#modalLogin'),
    modalAdmin: $('#modalAdmin'),
    modalPay: $('#modalPay'),
    modalQuick: $('#modalQuick'),
    modalProduct: $('#modalProduct'),
    modalEmail: $('#modalEmail'),
    modalCats: $('#modalCats'),
    modalParked: $('#modalParked'),
    modalCloseZ: $('#modalCloseZ'),
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
    keypad: $('#keypad'),
    quickAmount: $('#quickAmount'),
    quickName: $('#quickName'),
    btnQuickOk: $('#btnQuickOk'),

    // parked
    parkedList: $('#parkedList'),
    btnParkNow: $('#btnParkNow'),

    // cats
    newCatName: $('#newCatName'),
    btnAddCat: $('#btnAddCat'),
    catsList: $('#catsList'),

    // product
    prodTitle: $('#prodTitle'),
    prodBarcode: $('#prodBarcode'),
    prodName: $('#prodName'),
    prodPrice: $('#prodPrice'),
    prodCost: $('#prodCost'),
    prodCat: $('#prodCat'),
    prodFav: $('#prodFav'),
    prodUnit: $('#prodUnit'),
    btnProductSave: $('#btnProductSave'),

    // products page
    productsTable: $('#productsTable'),
    prodSearchName: $('#prodSearchName'),
    prodSearchBarcode: $('#prodSearchBarcode'),
    prodSearchCat: $('#prodSearchCat'),
    btnAddProduct: $('#btnAddProduct'),
    btnAddProductInline: $('#btnAddProductInline'),
    btnImportCsv: $('#btnImportCsv'),
    btnExportCsv: $('#btnExportCsv'),

    // sales
    salesTable: $('#salesTable'),
    statTickets: $('#statTickets'),
    statTotal: $('#statTotal'),
    statCash: $('#statCash'),
    statCard: $('#statCard'),
    closingsBox: $('#closingsBox'),
    btnCloseZ: $('#btnCloseZ'),
    btnExportSalesJson: $('#btnExportSalesJson'),
    btnImportSalesJson: $('#btnImportSalesJson'),

    // profit
    profitSales: $('#profitSales'),
    profitCost: $('#profitCost'),
    profitValue: $('#profitValue'),
    profitMargin: $('#profitMargin'),

    // close z modal
    zTotal: $('#zTotal'),
    zCash: $('#zCash'),
    zCard: $('#zCard'),
    zCounted: $('#zCounted'),
    zDiff: $('#zDiff'),
    zNote: $('#zNote'),
    btnCloseZOk: $('#btnCloseZOk'),

    // backup buttons in ajustes
    btnExportJson: $('#btnExportJson'),
    btnImportJson: $('#btnImportJson'),

    // email
    emailTo: $('#emailTo'),
    emailMsg: $('#emailMsg'),
    btnEmailSend: $('#btnEmailSend'),

    // files
    fileJson: $('#fileJson'),
    fileCsv: $('#fileCsv'),

    // print & toast
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
  }

  function openModal(dlg) {
    if (!dlg) return;
    el.backdrop && (el.backdrop.hidden = false);
    dlg.showModal();
    const f = dlg.querySelector('input,select,textarea,button');
    if (f) setTimeout(() => f.focus(), 25);
  }

  function closeModal(dlg) {
    if (!dlg) return;
    dlg.close();
    el.backdrop && (el.backdrop.hidden = true);
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
    if (state.audit.length > 4000) state.audit.splice(0, state.audit.length - 4000);
    save();
  }
  async function ensureDefaultHashes() {
    if (!state.settings.adminPinHash) state.settings.adminPinHash = await sha256Hex('1234');
    for (const u of state.users) if (!u.passHash) u.passHash = await sha256Hex('1234');
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
     CATEGORIES (PRO)
  ========================== */
  function normalizeCatName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ');
  }
  function ensureOthersCategory() {
    if (!state.categories.some(c => c.toLowerCase() === 'otros')) state.categories.push('Otros');
  }
  function addCategory(name) {
    const n = normalizeCatName(name);
    if (!n) return { ok: false, msg: 'Nombre vacío' };
    if (state.categories.some(c => c.toLowerCase() === n.toLowerCase())) return { ok: false, msg: 'Ya existe' };
    state.categories.push(n);
    ensureOthersCategory();
    save();
    renderAll();
    return { ok: true };
  }
  function renameCategory(oldName, newName) {
    const n = normalizeCatName(newName);
    if (!n) return { ok: false, msg: 'Nombre vacío' };
    if (oldName.toLowerCase() === 'otros') return { ok: false, msg: '“Otros” no se renombra' };
    if (state.categories.some(c => c.toLowerCase() === n.toLowerCase())) return { ok: false, msg: 'Ya existe' };

    state.categories = state.categories.map(c => (c === oldName ? n : c));
    // actualizar productos
    for (const p of state.products) if ((p.category || '') === oldName) p.category = n;
    save();
    renderAll();
    return { ok: true };
  }
  function deleteCategory(name) {
    if (name.toLowerCase() === 'otros') return { ok: false, msg: '“Otros” no se borra' };
    state.categories = state.categories.filter(c => c !== name);
    ensureOthersCategory();
    // mover productos a Otros
    for (const p of state.products) if ((p.category || '') === name) p.category = 'Otros';
    save();
    renderAll();
    return { ok: true };
  }

  function renderCategoriesUI() {
    // chips
    if (el.catChips) {
      const currentActive = el.catChips.querySelector('.chip.is-active')?.dataset?.cat || 'favoritos';
      el.catChips.innerHTML = '';
      const addChip = (label, catKey, active) => {
        const b = document.createElement('button');
        b.className = 'chip' + (active ? ' is-active' : '');
        b.type = 'button';
        b.dataset.cat = catKey;
        b.textContent = label;
        b.addEventListener('click', () => {
          $$('.chip', el.catChips).forEach(x => x.classList.remove('is-active'));
          b.classList.add('is-active');
          renderFavorites();
        });
        el.catChips.appendChild(b);
      };

      addChip('Favoritos', 'favoritos', currentActive === 'favoritos');
      for (const c of state.categories) {
        addChip(c, c, currentActive === c);
      }
    }

    // selects
    const fillSelect = (sel, includeAll = false) => {
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = '';
      if (includeAll) {
        const o = document.createElement('option');
        o.value = '';
        o.textContent = 'Todas';
        sel.appendChild(o);
      }
      for (const c of state.categories) {
        const o = document.createElement('option');
        o.value = c;
        o.textContent = c;
        sel.appendChild(o);
      }
      // restore
      if (cur && Array.from(sel.options).some(o => o.value === cur)) sel.value = cur;
      else if (!includeAll && state.categories.length) sel.value = state.categories[0];
    };

    fillSelect(el.prodCat, false);
    fillSelect(el.prodSearchCat, true);

    // cats modal list
    if (el.catsList) {
      el.catsList.innerHTML = '';
      for (const c of state.categories) {
        const row = document.createElement('div');
        row.className = 'cat-row';
        row.innerHTML = `
          <div>
            <div class="line-name">${escapeHtml(c)}</div>
            <div class="muted small">Productos: <span class="mono">${countProductsInCat(c)}</span></div>
          </div>
          <div class="cat-actions">
            <button class="btn btn-soft btn-small" data-act="rename">Renombrar</button>
            <button class="btn btn-ghost btn-small" data-act="del">Borrar</button>
          </div>
        `;
        const [btnRen, btnDel] = row.querySelectorAll('button');
        btnRen.addEventListener('click', () => {
          const n = prompt(`Renombrar "${c}" a:`, c);
          if (n == null) return;
          const r = renameCategory(c, n);
          if (!r.ok) toast(r.msg);
        });
        btnDel.addEventListener('click', () => {
          if (!adminUnlocked()) return (openModal(el.modalAdmin), toast('PIN admin requerido'));
          if (!confirm(`¿Borrar categoría "${c}"? (Productos pasarán a "Otros")`)) return;
          const r = deleteCategory(c);
          if (!r.ok) toast(r.msg);
        });
        el.catsList.appendChild(row);
      }
    }
  }

  function countProductsInCat(cat) {
    return state.products.filter(p => (p.category || 'Otros') === cat).length;
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
    else items = items.filter(p => (p.category || 'Otros') === cat);

    items.sort((a, b) => (Number(!!b.fav) - Number(!!a.fav)) || (a.name || '').localeCompare(b.name || ''));
    return items.slice(0, 24);
  }

  function addOrUpdateProduct(prod) {
    const barcode = String(prod.barcode || '').trim();
    if (barcode) {
      const existsByBarcode = state.products.find(p => String(p.barcode || '').trim() === barcode && p.id !== prod.id);
      if (existsByBarcode) {
        // barcode duplicado: se actualiza el existente
        Object.assign(existsByBarcode, prod, { id: existsByBarcode.id });
        return existsByBarcode;
      }
    }
    if (prod.id) {
      const existing = state.products.find(p => p.id === prod.id);
      if (existing) { Object.assign(existing, prod); return existing; }
    }
    const newP = { ...prod, id: 'P-' + uid() };
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
    }
  };

  /* =========================
     PARKED (MULTI)
  ========================== */
  function parkCurrentTicket() {
    if (!cart.active.lines.length) return toast('No hay líneas para aparcar');
    const { total } = cart.totals();
    const name = prompt('Nombre del aparcado (opcional):', `Aparcado ${state.carts.parkedList.length + 1}`) || `Aparcado ${state.carts.parkedList.length + 1}`;
    state.carts.parkedList.push({
      id: 'K-' + uid(),
      name: String(name).trim(),
      ts: Date.now(),
      cart: JSON.parse(JSON.stringify(state.carts.active)),
      total
    });
    audit('PARK', { name, total });
    cart.clear();
    save();
    renderAll();
    toast('Ticket aparcado');
  }

  function renderParkedBadge() {
    if (!el.parkBadge) return;
    const n = state.carts.parkedList.length;
    if (n > 0) {
      el.parkBadge.hidden = false;
      el.parkBadge.textContent = String(n);
    } else el.parkBadge.hidden = true;
  }

  function renderParkedModal() {
    if (!el.parkedList) return;
    el.parkedList.innerHTML = '';
    const list = state.carts.parkedList.slice().sort((a,b)=>b.ts-a.ts);

    if (!list.length) {
      el.parkedList.innerHTML = `<div class="muted small">No hay tickets aparcados.</div>`;
      return;
    }

    for (const item of list) {
      const div = document.createElement('div');
      div.className = 'parked-item';
      const linesCount = item.cart?.lines?.length || 0;
      div.innerHTML = `
        <div>
          <div class="line-name">${escapeHtml(item.name || 'Aparcado')}</div>
          <div class="parked-meta">
            <span class="mono">${new Date(item.ts).toLocaleString('es-ES')}</span>
            · Líneas: <span class="mono">${linesCount}</span>
            · Total: <span class="mono">${fmtEUR(item.total || 0)}</span>
          </div>
        </div>
        <div class="parked-actions">
          <button class="btn btn-soft btn-small" data-act="load">Recuperar</button>
          <button class="btn btn-ghost btn-small" data-act="rename">Renombrar</button>
          <button class="btn btn-ghost btn-small" data-act="del">Borrar</button>
        </div>
      `;
      const btnLoad = div.querySelector('[data-act="load"]');
      const btnRen = div.querySelector('[data-act="rename"]');
      const btnDel = div.querySelector('[data-act="del"]');

      btnLoad.addEventListener('click', () => {
        state.carts.active = JSON.parse(JSON.stringify(item.cart));
        state.carts.parkedList = state.carts.parkedList.filter(x => x.id !== item.id);
        save();
        renderAll();
        closeModal(el.modalParked);
        toast('Ticket recuperado');
        setTab('venta');
      });

      btnRen.addEventListener('click', () => {
        const n = prompt('Nuevo nombre:', item.name || '');
        if (n == null) return;
        const it = state.carts.parkedList.find(x => x.id === item.id);
        if (it) it.name = String(n).trim() || it.name;
        save();
        renderParkedModal();
        renderParkedBadge();
      });

      btnDel.addEventListener('click', () => {
        if (!adminUnlocked()) return (openModal(el.modalAdmin), toast('PIN admin requerido'));
        if (!confirm('¿Borrar este aparcado?')) return;
        state.carts.parkedList = state.carts.parkedList.filter(x => x.id !== item.id);
        save();
        renderParkedModal();
        renderParkedBadge();
      });

      el.parkedList.appendChild(div);
    }
  }

  /* =========================
     TICKET (PrintArea)
  ========================== */
  function nextTicketNo() {
    const n = state.counters.ticketSeq || 1;
    state.counters.ticketSeq = n + 1;
    save();
    return `T-${String(n).padStart(6, '0')}`;
  }

  function buildTicketHTML(s) {
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
          <div>${l.qty} x ${fmtMoney(l.price)}</div><div></div>
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
      dateKey: dateKey(),
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
     CLOSE Z
  ========================== */
  function computeSalesTotalsForDay(dayKey) {
    const sales = state.sales.filter(s => s.dateKey === dayKey);
    const total = sales.reduce((a,s)=>a+(Number(s.total)||0),0);
    const cash = sales.reduce((a,s)=>{
      if (s.payMethod === 'efectivo') return a + (Number(s.total)||0);
      if (s.payMethod === 'mixto') return a + (Number(s.split?.cash)||0);
      return a;
    },0);
    const card = sales.reduce((a,s)=>{
      if (s.payMethod === 'tarjeta') return a + (Number(s.total)||0);
      if (s.payMethod === 'mixto') return a + (Number(s.split?.card)||0);
      return a;
    },0);
    return { total, cash, card, count: sales.length };
  }

  function openCloseZModal() {
    const dk = dateKey();
    const sums = computeSalesTotalsForDay(dk);
    el.zTotal && (el.zTotal.textContent = fmtEUR(sums.total));
    el.zCash && (el.zCash.textContent = fmtEUR(sums.cash));
    el.zCard && (el.zCard.textContent = fmtEUR(sums.card));
    if (el.zCounted) el.zCounted.value = '';
    if (el.zDiff) el.zDiff.value = '0,00';
    if (el.zNote) el.zNote.value = '';
    openModal(el.modalCloseZ);
  }

  function updateZDiff() {
    const dk = dateKey();
    const sums = computeSalesTotalsForDay(dk);
    const counted = parseMoney(el.zCounted?.value || '0');
    const diff = counted - sums.cash;
    if (el.zDiff) el.zDiff.value = fmtMoney(diff);
  }

  function saveCloseZ() {
    const dk = dateKey();
    const sums = computeSalesTotalsForDay(dk);
    const counted = parseMoney(el.zCounted?.value || '0');
    const diff = counted - sums.cash;
    const note = (el.zNote?.value || '').trim();

    const rec = {
      id: 'Z-' + uid(),
      dateKey: dk,
      at: nowEs(),
      total: sums.total,
      cash: sums.cash,
      card: sums.card,
      counted,
      diff,
      note,
      user: state.session.user.name
    };
    state.closingsZ.push(rec);
    save();
    audit('CLOSE_Z', { dateKey: dk, total: sums.total, cash: sums.cash, counted, diff });
    closeModal(el.modalCloseZ);
    toast('Cierre Z guardado');
    renderSalesSummary();
  }

  /* =========================
     RENDER
  ========================== */
  function renderAdminState() {
    if (!el.adminState) return;
    el.adminState.textContent = adminUnlocked() ? 'Admin ✓' : 'Admin';
  }

  function renderHeader() {
    setTheme(state.settings.theme || 'day');
    el.userLabel && (el.userLabel.textContent = state.session.user?.name || 'CAJERO');
    el.posUser && (el.posUser.textContent = state.session.user?.name || 'CAJERO');

    el.shopName && (el.shopName.textContent = state.settings.shopName || 'Tu Tienda');
    el.shopSub && (el.shopSub.textContent = state.settings.shopSub || 'CIF / Dirección / Tel');
    el.posBox && (el.posBox.textContent = state.settings.boxName || 'CAJA-1');

    el.ticketDate && (el.ticketDate.textContent = nowEs());

    const seq = state.counters.ticketSeq || 1;
    el.ticketNo && (el.ticketNo.textContent = `T-${String(seq).padStart(6, '0')}`);

    renderAdminState();
    renderParkedBadge();
  }

  function renderFavorites() {
    if (!el.favGrid) return;

    const activeChip = el.catChips?.querySelector('.chip.is-active')?.dataset?.cat || 'favoritos';
    const q = el.searchInput ? el.searchInput.value : '';
    const items = listProductsForGrid(activeChip, q);

    el.favGrid.innerHTML = '';

    // tile: importe
    el.favGrid.appendChild(makeFavTile('Importe rápido', 'Teclado', () => openModal(el.modalQuick)));

    // tiles: productos
    for (const p of items) {
      const priceText = p.price != null ? fmtEUR(p.price) : '—';
      el.favGrid.appendChild(makeFavTile(p.name, priceText, () => cart.addProduct(p, 1)));
    }

    // tile: aparcados
    if (state.carts.parkedList.length) {
      el.favGrid.appendChild(makeFavTile('Aparcados', `${state.carts.parkedList.length}`, () => {
        renderParkedModal();
        openModal(el.modalParked);
      }));
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

    const thead = el.ticketLines.querySelector('.trow.thead');
    el.ticketLines.innerHTML = '';
    thead && el.ticketLines.appendChild(thead);

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
        if (e.key === 'Enter') { e.preventDefault(); qtyIn.blur(); }
      });

      row.addEventListener('contextmenu', (e) => { e.preventDefault(); cart.remove(idx); });

      el.ticketLines.appendChild(row);
    });
  }

  function renderTotals() {
    const { total } = cart.totals();
    el.linesCount && (el.linesCount.textContent = String(cart.active.lines.length));
    el.subTotal && (el.subTotal.textContent = fmtEUR(total));
    el.grandTotal && (el.grandTotal.textContent = fmtEUR(total));

    const method = cart.active.payMethod || 'efectivo';
    const given = parseMoney(el.givenInput?.value ?? cart.active.given);
    const change = (method === 'efectivo') ? Math.max(0, given - total) : 0;
    el.changeInput && (el.changeInput.value = fmtMoney(change));
  }

  function renderProductsTable() {
    if (!el.productsTable) return;

    const thead = el.productsTable.querySelector('.trow.thead');
    el.productsTable.innerHTML = '';
    thead && el.productsTable.appendChild(thead);

    const qName = String(el.prodSearchName?.value || '').trim().toLowerCase();
    const qBar  = String(el.prodSearchBarcode?.value || '').trim();
    const qCat  = String(el.prodSearchCat?.value || '').trim();

    let items = state.products.slice();
    if (qName) items = items.filter(p => (p.name || '').toLowerCase().includes(qName));
    if (qBar)  items = items.filter(p => String(p.barcode || '').includes(qBar));
    if (qCat)  items = items.filter(p => (p.category || 'Otros') === qCat);

    items.sort((a,b) => (a.name||'').localeCompare(b.name||''));

    for (const p of items) {
      const row = document.createElement('div');
      row.className = 'trow';
      row.innerHTML = `
        <div class="tcell">
          <div>
            <div class="line-name">${escapeHtml(p.name)}</div>
            <div class="line-sub muted">${escapeHtml(p.category || 'Otros')}</div>
          </div>
        </div>
        <div class="tcell mono">${escapeHtml(p.barcode || '—')}</div>
        <div class="tcell tcell-right mono">${fmtMoney(p.price || 0)}</div>
        <div class="tcell tcell-right mono">${p.cost == null ? '—' : fmtMoney(p.cost)}</div>
        <div class="tcell tcell-center">${p.fav ? '<span class="badge badge-ok">Sí</span>' : '<span class="badge">No</span>'}</div>
        <div class="tcell tcell-right">
          <button class="btn btn-soft btn-small" type="button">Editar</button>
          <button class="btn btn-ghost btn-small" type="button">Borrar</button>
        </div>
      `;
      const [btnEdit, btnDel] = row.querySelectorAll('button');

      btnEdit.addEventListener('click', () => openProductModalEdit(p));
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

    el.statTickets && (el.statTickets.textContent = String(tickets));
    el.statTotal && (el.statTotal.textContent = fmtEUR(total));
    el.statCash && (el.statCash.textContent = fmtEUR(cash));
    el.statCard && (el.statCard.textContent = fmtEUR(card));

    // sales table
    if (el.salesTable) {
      const thead = el.salesTable.querySelector('.trow.thead');
      el.salesTable.innerHTML = '';
      thead && el.salesTable.appendChild(thead);

      const last = sales.slice(-80).reverse();
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

    // closings list
    if (el.closingsBox) {
      if (!state.closingsZ.length) {
        el.closingsBox.innerHTML = `<div class="muted">Sin cierres todavía.</div>`;
      } else {
        const last = state.closingsZ.slice(-10).reverse();
        el.closingsBox.innerHTML = last.map(z => `
          <div style="width:100%; border:1px solid var(--line); border-radius:14px; padding:10px; background: rgba(0,0,0,.02);">
            <div class="mono"><b>${escapeHtml(z.dateKey)}</b> · ${escapeHtml(z.at)}</div>
            <div class="muted small">Total: <span class="mono">${fmtMoney(z.total)}€</span> · Efe esp: <span class="mono">${fmtMoney(z.cash)}€</span> · Contado: <span class="mono">${fmtMoney(z.counted)}€</span> · Dif: <span class="mono">${fmtMoney(z.diff)}€</span></div>
          </div>
        `).join('');
      }
    }

    // profit
    const cost = sales.reduce((s, x) => {
      const c = (x.lines || []).reduce((sum, l) => {
        if (l.cost == null) return sum;
        return sum + (Number(l.cost) * Number(l.qty || 0));
      }, 0);
      return s + c;
    }, 0);
    const profit = total - cost;
    const margin = total > 0 ? (profit / total) * 100 : 0;

    el.profitSales && (el.profitSales.textContent = fmtEUR(total));
    el.profitCost && (el.profitCost.textContent = fmtEUR(cost));
    el.profitValue && (el.profitValue.textContent = fmtEUR(profit));
    el.profitMargin && (el.profitMargin.textContent = `${margin.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);
  }

  function renderAll() {
    ensureOthersCategory();
    renderCategoriesUI();
    renderHeader();
    renderFavorites();
    renderLines();
    renderTotals();
    renderProductsTable();
    renderSalesSummary();
  }

  /* =========================
     MODALS HELPERS
  ========================== */
  function openProductModalNew(prefillBarcode = '') {
    el.modalProduct.dataset.editId = '';
    el.prodTitle && (el.prodTitle.textContent = 'Nuevo producto');
    el.prodBarcode && (el.prodBarcode.value = prefillBarcode);
    el.prodName && (el.prodName.value = '');
    el.prodPrice && (el.prodPrice.value = '');
    el.prodCost && (el.prodCost.value = '');
    el.prodFav && (el.prodFav.value = '1');
    el.prodUnit && (el.prodUnit.value = 'ud');
    el.prodCat && (el.prodCat.value = state.categories.includes('Otros') ? 'Otros' : (state.categories[0] || 'Otros'));
    openModal(el.modalProduct);
  }

  function openProductModalEdit(p) {
    el.modalProduct.dataset.editId = p.id;
    el.prodTitle && (el.prodTitle.textContent = 'Editar producto');
    el.prodBarcode && (el.prodBarcode.value = p.barcode || '');
    el.prodName && (el.prodName.value = p.name || '');
    el.prodPrice && (el.prodPrice.value = fmtMoney(p.price || 0).replace('.', ','));
    el.prodCost && (el.prodCost.value = p.cost == null ? '' : fmtMoney(p.cost).replace('.', ','));
    el.prodFav && (el.prodFav.value = p.fav ? '1' : '0');
    el.prodUnit && (el.prodUnit.value = p.unit || 'ud');
    el.prodCat && (el.prodCat.value = p.category || 'Otros');
    openModal(el.modalProduct);
  }

  /* =========================
     PAY FLOW
  ========================== */
  function syncPayUI() {
    const m = el.payMethod?.value || 'efectivo';
    const isCash = m === 'efectivo';
    const isCard = m === 'tarjeta';
    const isMix  = m === 'mixto';

    el.paySplitWrap && (el.paySplitWrap.hidden = !isMix);
    if (el.payGivenWrap) el.payGivenWrap.style.display = (isCash || isMix) ? '' : 'none';
    if (el.payChangeWrap) el.payChangeWrap.style.display = (isCash || isMix) ? '' : 'none';

    if (isCard) {
      el.payGiven && (el.payGiven.value = '');
      el.payChange && (el.payChange.value = '0,00');
    }
  }

  function calcPayChange() {
    const { total } = cart.totals();
    const m = el.payMethod?.value || 'efectivo';

    if (m === 'efectivo') {
      const given = parseMoney(el.payGiven?.value || '0');
      el.payChange && (el.payChange.value = fmtMoney(Math.max(0, given - total)));
      return;
    }
    if (m === 'mixto') {
      const card = parseMoney(el.payCard?.value || '0');
      const cash = parseMoney(el.payCash?.value || '0');
      const remaining = Math.max(0, total - card);
      const change = Math.max(0, cash - remaining);
      el.payChange && (el.payChange.value = fmtMoney(change));
      return;
    }
    el.payChange && (el.payChange.value = '0,00');
  }

  function openPayModal() {
    const { total } = cart.totals();
    if (!(total > 0)) return toast('No hay líneas');

    el.payTotal && (el.payTotal.textContent = fmtEUR(total));
    el.payNote && (el.payNote.value = el.noteName?.value || cart.active.noteName || '');

    const m = cart.active.payMethod || 'efectivo';
    el.payMethod && (el.payMethod.value = m);
    syncPayUI();

    el.payGiven && (el.payGiven.value = (el.givenInput?.value || '').trim());
    calcPayChange();
    openModal(el.modalPay);
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

    if (method === 'efectivo' && given < total) {
      if (!confirm('Entregado menor que total. ¿Confirmar igualmente?')) return;
    }

    const sale = saveSale({ payMethod: method, given, cashAmount, cardAmount, noteName: note });
    if (!sale) return toast('Error al guardar');

    el.ticketNo && (el.ticketNo.textContent = sale.ticketNo);

    if (fromModal) closeModal(el.modalPay);

    cart.clear();
    toast(`Venta OK · ${sale.ticketNo}`);

    if (state.settings.autoPrint) {
      printSaleLike(sale);
    } else {
      if (confirm('¿Imprimir ticket?')) printSaleLike(sale);
    }
  }

  /* =========================
     EMAIL
  ========================== */
  function sendEmailMailto() {
    const to = (el.emailTo?.value || '').trim();
    const extra = (el.emailMsg?.value || '').trim();

    let saleLike = getLastSale();
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
     BACKUP JSON
  ========================== */
  function download(filename, text, mime = 'text/plain') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 800);
  }

  function exportJson() {
    const payload = JSON.stringify(state, null, 2);
    download(`TPV_BACKUP_${dateKey()}_${state.settings.boxName}.json`, payload, 'application/json');
    toast('Backup JSON exportado');
  }

  function importJsonFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result || ''));
        // merge con defaults para evitar roturas
        state = deepMerge(defaultState(), obj);
        save();
        toast('JSON importado');
        renderAll();
      } catch {
        toast('JSON inválido');
      }
    };
    reader.readAsText(file);
  }

  /* =========================
     CSV Products
  ========================== */
  function exportProductsCsv() {
    const header = ['barcode','name','price','cost','category','fav','unit'];
    const rows = state.products.map(p => [
      p.barcode || '',
      p.name || '',
      String(p.price ?? ''),
      p.cost == null ? '' : String(p.cost),
      p.category || 'Otros',
      p.fav ? '1' : '0',
      p.unit || 'ud'
    ]);

    const esc = (v) => {
      const s = String(v ?? '');
      if (/[",\n]/.test(s)) return `"${s.replaceAll('"','""')}"`;
      return s;
    };

    const csv = [header.join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
    download(`TPV_PRODUCTS_${dateKey()}.csv`, csv, 'text/csv');
    toast('CSV exportado');
  }

  function parseCsv(text) {
    // parser simple (maneja comillas)
    const lines = [];
    let cur = [];
    let val = '';
    let inQ = false;

    for (let i=0;i<text.length;i++){
      const ch = text[i];
      const next = text[i+1];
      if (inQ) {
        if (ch === '"' && next === '"') { val += '"'; i++; continue; }
        if (ch === '"') { inQ = false; continue; }
        val += ch;
      } else {
        if (ch === '"') { inQ = true; continue; }
        if (ch === ',') { cur.push(val); val = ''; continue; }
        if (ch === '\n') { cur.push(val); lines.push(cur); cur = []; val=''; continue; }
        if (ch === '\r') continue;
        val += ch;
      }
    }
    cur.push(val);
    lines.push(cur);
    return lines.filter(r => r.some(x => String(x).trim() !== ''));
  }

  function importProductsCsv(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const rows = parseCsv(text);
        if (!rows.length) return toast('CSV vacío');

        const header = rows[0].map(h => String(h).trim().toLowerCase());
        const idx = (name) => header.indexOf(name);

        const iBarcode = idx('barcode');
        const iName = idx('name');
        const iPrice = idx('price');
        const iCost = idx('cost');
        const iCat = idx('category');
        const iFav = idx('fav');
        const iUnit = idx('unit');

        if (iName < 0 || iPrice < 0) return toast('CSV sin columnas mínimas (name,price)');

        let added = 0;
        for (let r=1;r<rows.length;r++){
          const row = rows[r];
          const name = String(row[iName] ?? '').trim();
          if (!name) continue;
          const barcode = iBarcode >= 0 ? String(row[iBarcode] ?? '').trim() : '';
          const price = parseMoney(row[iPrice] ?? '0');
          const cost = iCost >= 0 && String(row[iCost] ?? '').trim() !== '' ? parseMoney(row[iCost]) : null;
          const category = iCat >= 0 ? (String(row[iCat] ?? '').trim() || 'Otros') : 'Otros';
          const fav = iFav >= 0 ? (String(row[iFav] ?? '0').trim() === '1') : false;
          const unit = iUnit >= 0 ? (String(row[iUnit] ?? 'ud').trim() || 'ud') : 'ud';

          // asegurar categoría existe
          if (category && !state.categories.some(c => c.toLowerCase() === category.toLowerCase())) state.categories.push(category);
          ensureOthersCategory();

          addOrUpdateProduct({ barcode, name, price, cost, category, fav, unit });
          added++;
        }

        save();
        renderAll();
        toast(`CSV importado · ${added} filas`);
      } catch {
        toast('Error importando CSV');
      }
    };
    reader.readAsText(file);
  }

  /* =========================
     GLOBAL BARCODE SCAN (SIEMPRE ACTIVO)
     - Detecta ráfagas de teclas rápidas + Enter
     - Añade producto al instante (aunque estés en otro tab)
  ========================== */
  function setupGlobalScan() {
    let buffer = '';
    let lastTs = 0;
    let timer = null;

    const reset = () => { buffer = ''; lastTs = 0; if (timer) clearTimeout(timer); timer = null; };

    const isAllowedChar = (k) => /^[0-9A-Za-z]$/.test(k);

    window.addEventListener('keydown', (e) => {
      // si hay un dialog abierto y el usuario está escribiendo en un input, no molestamos
      const openDialog = document.querySelector('dialog[open]');
      const targetTag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      const typing = (targetTag === 'input' || targetTag === 'textarea' || targetTag === 'select');

      // PERO: si el dialog abierto NO es para escribir (o el input no está enfocado), seguimos detectando.
      // Para evitar interferencias: si está escribiendo normal, ignorar.
      if (openDialog && typing) return;

      const t = performance.now();
      const dt = lastTs ? (t - lastTs) : 0;
      lastTs = t;

      // Enter -> finalizar
      if (e.key === 'Enter' && buffer.length >= 3) {
        const code = buffer;
        reset();
        handleScannedBarcode(code);
        return;
      }

      // Escape -> reset buffer
      if (e.key === 'Escape') { reset(); return; }

      // Captura caracteres típicos de barcode
      if (isAllowedChar(e.key)) {
        // Si dt es grande, probablemente tecleo humano -> reset buffer y empezar desde cero
        if (dt > 70) buffer = '';
        buffer += e.key;

        if (timer) clearTimeout(timer);
        timer = setTimeout(() => reset(), 160); // si no llega Enter pronto, se limpia
      } else {
        // otras teclas rompen buffer si está creciendo
        if (buffer.length) {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => reset(), 90);
        }
      }
    });
  }

  function handleScannedBarcode(code) {
    const bc = String(code || '').trim();
    if (!bc) return;

    const p = findByBarcode(bc);
    if (p) {
      if (state.settings.autoGoSaleOnScan) setTab('venta');
      cart.addProduct(p, 1);
      state.settings.beepOnScan && beep();
      toast(`Escaneo OK: ${p.name}`);
      return;
    }

    // No existe -> abrir alta producto con barcode precargado
    if (state.settings.autoGoSaleOnScan) setTab('venta');
    openProductModalNew(bc);
    toast('Barcode no encontrado: alta producto');
  }

  /* =========================
     KEYBOARD / KEYPAD (importe rápido)
  ========================== */
  function keypadAppend(str) {
    const cur = String(el.quickAmount?.value || '').trim();
    const next = (cur + str).replaceAll(',', '.');
    // permitir solo 1 punto decimal
    const parts = next.split('.');
    const clean = parts.length > 2 ? (parts[0] + '.' + parts.slice(1).join('')) : next;
    el.quickAmount && (el.quickAmount.value = clean.replace('.', ','));
  }

  function keypadBackspace() {
    const cur = String(el.quickAmount?.value || '');
    el.quickAmount && (el.quickAmount.value = cur.slice(0, -1));
  }

  function keypadClear() {
    el.quickAmount && (el.quickAmount.value = '');
  }

  /* =========================
     BINDINGS
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

    el.btnQuickAmount?.addEventListener('click', () => openModal(el.modalQuick));

    el.btnCats?.addEventListener('click', () => { renderCategoriesUI(); openModal(el.modalCats); });
    el.btnCats2?.addEventListener('click', () => { renderCategoriesUI(); openModal(el.modalCats); });

    el.btnPark?.addEventListener('click', () => {
      renderParkedModal();
      openModal(el.modalParked);
    });

    el.btnParkNow?.addEventListener('click', () => {
      parkCurrentTicket();
      renderParkedModal();
      renderParkedBadge();
    });

    el.btnAddProductInline?.addEventListener('click', () => openProductModalNew(''));
    el.btnAddProduct?.addEventListener('click', () => openProductModalNew(''));

    el.btnPrint?.addEventListener('click', () => {
      const last = getLastSale();
      if (last) return printSaleLike(last);
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

    el.btnLastTicket?.addEventListener('click', () => {
      const last = getLastSale();
      if (!last) return toast('No hay último ticket');
      printSaleLike(last);
    });

    el.btnEmailTicket?.addEventListener('click', () => openModal(el.modalEmail));
    el.btnEmailSend?.addEventListener('click', sendEmailMailto);

    el.btnVoid?.addEventListener('click', () => {
      if (!cart.active.lines.length) return;
      if (!confirm('¿Anular ticket actual?')) return;
      cart.clear();
      audit('CART_VOID', {});
      toast('Ticket anulado');
    });

    el.btnRefund?.addEventListener('click', () => {
      if (!adminUnlocked()) return (openModal(el.modalAdmin), toast('PIN admin requerido'));
      const last = getLastSale();
      if (!last) return toast('No hay venta');
      const refund = {
        ...last,
        id: uid(),
        ticketNo: nextTicketNo(),
        date: nowEs(),
        dateKey: dateKey(),
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

    // pay modal
    el.payMethod?.addEventListener('change', () => { syncPayUI(); calcPayChange(); });
    el.payGiven?.addEventListener('input', calcPayChange);
    el.payCash?.addEventListener('input', calcPayChange);
    el.payCard?.addEventListener('input', calcPayChange);
    el.btnPayOk?.addEventListener('click', () => confirmSaleFromUI({ fromModal: true }));

    // quick ok
    el.btnQuickOk?.addEventListener('click', () => {
      const amt = parseMoney(el.quickAmount?.value || '0');
      const name = (el.quickName?.value || 'Importe').trim();
      if (!(amt > 0)) return toast('Importe inválido');
      cart.addManual(amt, name);
      closeModal(el.modalQuick);
      toast('Importe añadido');
    });

    // keypad
    el.keypad?.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const k = btn.dataset.k;
      if (!k) return;

      if (k === 'bk') keypadBackspace();
      else if (k === 'c') keypadClear();
      else if (k === 'ok') {
        el.btnQuickOk?.click();
      } else if (k === '.') {
        const cur = String(el.quickAmount?.value || '');
        if (!cur.includes(',') && !cur.includes('.')) keypadAppend('.');
      } else if (k === '00') keypadAppend('00');
      else keypadAppend(k);
    });

    // categories
    el.btnAddCat?.addEventListener('click', () => {
      const r = addCategory(el.newCatName?.value || '');
      if (!r.ok) return toast(r.msg);
      el.newCatName && (el.newCatName.value = '');
      toast('Categoría añadida');
      renderCategoriesUI();
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

      // asegurar categoría existe
      if (category && !state.categories.some(c => c.toLowerCase() === category.toLowerCase())) state.categories.push(category);
      ensureOthersCategory();

      addOrUpdateProduct({ id: editId || undefined, barcode, name, price, cost, category, fav, unit });

      el.modalProduct.dataset.editId = '';
      closeModal(el.modalProduct);
      save();
      renderAll();
      toast('Producto guardado');
    });

    // close Z
    el.btnCloseZ?.addEventListener('click', () => openCloseZModal());
    el.zCounted?.addEventListener('input', updateZDiff);
    el.btnCloseZOk?.addEventListener('click', () => {
      if (!adminUnlocked()) return (openModal(el.modalAdmin), toast('PIN admin requerido'));
      saveCloseZ();
    });

    // export/import json
    const exportAnyJson = () => exportJson();
    el.btnExportJson?.addEventListener('click', exportAnyJson);
    el.btnExportSalesJson?.addEventListener('click', exportAnyJson);

    const triggerImportJson = () => el.fileJson?.click();
    el.btnImportJson?.addEventListener('click', triggerImportJson);
    el.btnImportSalesJson?.addEventListener('click', triggerImportJson);
    el.fileJson?.addEventListener('change', () => {
      const f = el.fileJson.files?.[0];
      if (f) importJsonFromFile(f);
      el.fileJson.value = '';
    });

    // csv
    el.btnExportCsv?.addEventListener('click', exportProductsCsv);
    el.btnImportCsv?.addEventListener('click', () => el.fileCsv?.click());
    el.fileCsv?.addEventListener('change', () => {
      const f = el.fileCsv.files?.[0];
      if (f) importProductsCsv(f);
      el.fileCsv.value = '';
    });
  }

  function bindPOSInputs() {
    // barcode input manual (solo por si quieres)
    el.barcodeInput?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const code = (el.barcodeInput.value || '').trim();
      el.barcodeInput.value = '';
      if (!code) return;
      handleScannedBarcode(code);
    });

    el.searchInput?.addEventListener('input', renderFavorites);

    // pay tabs main
    el.payTabs.forEach(p => p.addEventListener('click', () => {
      el.payTabs.forEach(x => x.classList.remove('is-active'));
      p.classList.add('is-active');
      cart.active.payMethod = p.dataset.pay || 'efectivo';
      save();
      renderTotals();
    }));

    el.givenInput?.addEventListener('input', () => { cart.active.given = parseMoney(el.givenInput.value); save(); renderTotals(); });
    el.noteName?.addEventListener('input', () => { cart.active.noteName = el.noteName.value || ''; save(); });

    const reRenderProducts = debounce(renderProductsTable, 80);
    el.prodSearchName?.addEventListener('input', reRenderProducts);
    el.prodSearchBarcode?.addEventListener('input', reRenderProducts);
    el.prodSearchCat?.addEventListener('change', reRenderProducts);
  }

  function bindSettings() {
    // init inputs
    el.setShopName && (el.setShopName.value = state.settings.shopName);
    el.setShopSub && (el.setShopSub.value = state.settings.shopSub);
    el.setBoxName && (el.setBoxName.value = state.settings.boxName);
    el.setFooterText && (el.setFooterText.value = state.settings.footerText);
    el.setDirectPay && (el.setDirectPay.value = state.settings.directPay ? '1' : '0');
    el.setAutoPrint && (el.setAutoPrint.value = state.settings.autoPrint ? '1' : '0');
    el.setAutoGoSale && (el.setAutoGoSale.value = state.settings.autoGoSaleOnScan ? '1' : '0');
    el.setBeep && (el.setBeep.value = state.settings.beepOnScan ? '1' : '0');

    const apply = debounce(() => {
      state.settings.shopName = el.setShopName?.value || state.settings.shopName;
      state.settings.shopSub = el.setShopSub?.value || state.settings.shopSub;
      state.settings.boxName = el.setBoxName?.value || state.settings.boxName;
      state.settings.footerText = el.setFooterText?.value || state.settings.footerText;
      state.settings.directPay = (el.setDirectPay?.value || '0') === '1';
      state.settings.autoPrint = (el.setAutoPrint?.value || '0') === '1';
      state.settings.autoGoSaleOnScan = (el.setAutoGoSale?.value || '1') === '1';
      state.settings.beepOnScan = (el.setBeep?.value || '1') === '1';
      save();
      renderHeader();
    }, 120);

    el.setShopName?.addEventListener('input', apply);
    el.setShopSub?.addEventListener('input', apply);
    el.setBoxName?.addEventListener('input', apply);
    el.setFooterText?.addEventListener('input', apply);
    el.setDirectPay?.addEventListener('change', apply);
    el.setAutoPrint?.addEventListener('change', apply);
    el.setAutoGoSale?.addEventListener('change', apply);
    el.setBeep?.addEventListener('change', apply);

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

  function bindShortcuts() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      const typing = (tag === 'input' || tag === 'textarea' || tag === 'select');

      if (e.key === 'F4') { e.preventDefault(); state.settings.directPay ? confirmSaleFromUI({ fromModal:false }) : openPayModal(); return; }
      if (e.key === 'F2') { e.preventDefault(); openModal(el.modalQuick); return; }

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
    });
  }

  /* =========================
     INIT
  ========================== */
  async function init() {
    await ensureDefaultHashes();
    ensureOthersCategory();

    setTheme(state.settings.theme || 'day');
    setTab('venta');

    bindTabs();
    bindTheme();
    bindModals();
    bindPOSInputs();
    bindSettings();
    bindShortcuts();

    setupGlobalScan(); // <<<<<< SIEMPRE escuchando barcode

    renderAll();

    // clock
    setInterval(() => { el.ticketDate && (el.ticketDate.textContent = nowEs()); }, 15000);
  }

  init();
})();

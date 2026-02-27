✅ **PARTE 3/3 — `app.js` (COMPLETO)**
Incluye TODO lo pedido: **escaneo permanente instantáneo**, **categorías (crear/renombrar/asignar)**, **cobro PRO (billetes + teclado + cambio)**, **impresión ON/OFF (si OFF no abre impresión)**, **Cierre Z (imprime Z + descuadre ± + archiva día + limpia ventas abiertas)**, **reportes por rango**, **export/import/backup**, **aparcados**, **About plegable + copiar info**, **footer crédito**, **PIN admin**.

> Pega este archivo como `app.js` junto a `index.html` y `styles.css` en la misma carpeta (o `/docs`).

```js
/* =========================
TPV NADEEM LOCUTORIO — B/W PRO (PAQUETE PRO+)
Archivo: app.js

Incluye:
- Escucha permanente de barcode (global buffer rápido)
- Categorías: crear/renombrar/borrar + asignar a productos
- Venta: categorías bajo barcode/buscar + grid por categoría
- Cobro PRO:
  - Botones billetes/monedas (suman entregado)
  - Teclado numérico para entregado
  - Cambio en grande, rojo/verde
  - Cobrar / Cobrar sin imprimir
- Impresión ON/OFF:
  - Si OFF, nunca abre window.print
- Cierre Z:
  - Muestra esperado (efectivo/tarjeta/total/tickets)
  - Introduces contado y calcula descuadre +/-
  - Imprimir Z o Cerrar día (archiva día + limpia ventas abiertas)
- Reportes:
  - Hoy (abierto), Ayer, Semana, Mes, Personalizado
  - Tabla tickets filtrada + KPIs + beneficio (si hay coste)
- Backup/Restore JSON + import/export CSV
- Aparcados múltiples
- About plegable + copiar info
- PIN Admin + autolock por inactividad

========================= */

(() => {
  'use strict';

  /* =========================
     HELPERS
  ========================== */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const LS_KEY = 'TPV_NADEEM_LOCUTORIO_V1_3';

  const pad = (n) => (n < 10 ? '0' : '') + n;

  const now = () => new Date();

  const dateKeyLocal = (d = new Date()) => {
    const y = d.getFullYear();
    const m = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    return `${y}-${m}-${day}`; // YYYY-MM-DD
  };

  const nowEs = (d = new Date()) => {
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

  const escapeHtml = (s) => (s ?? '').toString()
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  const uid = () => 'ID' + Math.random().toString(36).slice(2, 8).toUpperCase() + Date.now().toString(36).slice(-4).toUpperCase();

  const debounce = (fn, ms = 120) => {
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

  function downloadText(filename, text, mime = 'text/plain') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function toCSV(rows) {
    const esc = (v) => {
      const s = String(v ?? '');
      if (/[",\n;]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
      return s;
    };
    return rows.map(r => r.map(esc).join(',')).join('\n');
  }

  function parseCSV(text) {
    const raw = String(text || '').replace(/\r/g, '').trim();
    if (!raw) return [];
    const commaCount = (raw.match(/,/g) || []).length;
    const semiCount = (raw.match(/;/g) || []).length;
    const delim = semiCount > commaCount ? ';' : ',';
    const lines = raw.split('\n');
    return lines.filter(l => l.trim()).map(l => splitCSVLine(l, delim));
  }

  function splitCSVLine(line, delim) {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (!inQ && ch === delim) {
        out.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  /* =========================
     DEFAULT STATE
  ========================== */
  const DEFAULTS = () => {
    const cat = (id, name) => ({ id, name });
    return {
      version: '1.3',
      settings: {
        shopName: 'MALIK AHMAD NADEEM',
        shopSub: 'C/ Vitoria 139 · 09007 Burgos · Tlf 632 480 316 · CIF 72374062P',
        footerText: 'Gracias por su compra',
        boxName: 'CAJA-1',

        theme: 'day',

        // Impresión
        printOn: true,
        autoPrint: false,
        printZOnClose: true,

        // Cobro rápido
        directPay: false,

        // Scanner
        alwaysScan: true,
        scanSpeedMs: 35, // umbral entre teclas para identificar lector

        // Seguridad
        adminPinHash: '', // default 1234
        autoLockMin: 10,
      },

      session: {
        user: { name: 'CAJERO', role: 'cashier' },
        adminUnlockedUntil: 0,
        lastActivity: Date.now(),
      },

      users: [
        { username: 'cajero', passHash: '', role: 'cashier' },
        { username: 'admin', passHash: '', role: 'admin' },
      ],

      categories: [
        cat('c_all', 'Todos'),
        cat('c_fav', 'Favoritos'),
        cat('c_loc', 'Locutorio'),
        cat('c_sn', 'Snacks'),
        cat('c_beb', 'Bebidas'),
        cat('c_ot', 'Otros'),
      ],

      counters: { ticketSeq: 1 },

      products: [
        { id: 'P1', barcode: '1234567890123', name: 'Recarga 10€', price: 10.00, cost: null, categoryId: 'c_loc', fav: true, unit: 'ud' },
        { id: 'P2', barcode: '2345678901234', name: 'Recarga 20€', price: 20.00, cost: null, categoryId: 'c_loc', fav: true, unit: 'ud' },
        { id: 'P3', barcode: '3456789012345', name: 'Agua',        price: 1.00,  cost: 0.45, categoryId: 'c_beb', fav: true, unit: 'ud' },
        { id: 'P4', barcode: '4567890123456', name: 'Coca-Cola',   price: 1.50,  cost: 0.70, categoryId: 'c_beb', fav: true, unit: 'ud' },
        { id: 'P5', barcode: '5678901234567', name: 'Patatas',     price: 1.20,  cost: 0.55, categoryId: 'c_sn',  fav: true, unit: 'ud' },
        { id: 'P6', barcode: '',              name: 'Bolsa',       price: 0.10,  cost: null, categoryId: 'c_ot',  fav: true, unit: 'ud' },
      ],

      carts: {
        active: { lines: [], noteName: '', payMethod: 'efectivo', given: 0 },
        parked: [], // [{id,name,cart,ts}]
      },

      // Ventas abiertas del día (se limpian al Cierre Z)
      openSales: [], // [{...sale, dayKey}]

      // Días cerrados (histórico)
      closedDays: [
        // { dayKey, closedAt, z: {...}, sales: [...] }
      ],

      // Último ticket
      lastSaleId: null,

      audit: [],

      ui: {
        selectedCategoryId: 'c_all'
      }
    };
  };

  function deepMerge(base, patch) {
    if (Array.isArray(base)) return Array.isArray(patch) ? patch : base;
    if (typeof base !== 'object' || base === null) return patch ?? base;
    const out = { ...base };
    if (typeof patch !== 'object' || patch === null) return out;
    for (const k of Object.keys(patch)) {
      out[k] = (k in base) ? deepMerge(base[k], patch[k]) : patch[k];
    }
    return out;
  }

  let state = (() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return DEFAULTS();
      return deepMerge(DEFAULTS(), JSON.parse(raw));
    } catch {
      return DEFAULTS();
    }
  })();

  const save = debounce(() => localStorage.setItem(LS_KEY, JSON.stringify(state)), 80);

  /* =========================
     DOM REFS
  ========================== */
  const el = {
    tabs: $$('.tab'),
    pages: $$('.page'),

    btnTheme: $('#btnTheme'),
    themeLabel: $('#themeLabel'),

    btnPrintToggle: $('#btnPrintToggle'),
    printDot: $('#printDot'),
    printLabel: $('#printLabel'),

    btnLogin: $('#btnLogin'),
    userLabel: $('#userLabel'),

    btnAdmin: $('#btnAdmin'),
    adminState: $('#adminState'),

    scanDot: $('#scanDot'),

    barcodeInput: $('#barcodeInput'),
    searchInput: $('#searchInput'),

    catChips: $('#catChips'),
    btnNewCategory: $('#btnNewCategory'),
    btnManageCategories: $('#btnManageCategories'),

    prodGrid: $('#prodGrid'),
    btnAddProductInline: $('#btnAddProductInline'),

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

    // reportes
    repPreset: $('#repPreset'),
    repFrom: $('#repFrom'),
    repTo: $('#repTo'),
    statTickets: $('#statTickets'),
    statTotal: $('#statTotal'),
    statCash: $('#statCash'),
    statCard: $('#statCard'),
    statProfit: $('#statProfit'),
    salesTable: $('#salesTable'),
    zInfo: $('#zInfo'),
    btnExportSalesCsv: $('#btnExportSalesCsv'),
    btnCloseZ: $('#btnCloseZ'),

    // ajustes
    btnAdminUnlock: $('#btnAdminUnlock'),
    setShopName: $('#setShopName'),
    setShopSub: $('#setShopSub'),
    setBoxName: $('#setBoxName'),
    setFooterText: $('#setFooterText'),
    setDirectPay: $('#setDirectPay'),
    setPrintOn: $('#setPrintOn'),
    setAutoPrint: $('#setAutoPrint'),
    setPrintZ: $('#setPrintZ'),
    setAlwaysScan: $('#setAlwaysScan'),
    setScanSpeed: $('#setScanSpeed'),
    setAdminPin: $('#setAdminPin'),
    setAutoLockMin: $('#setAutoLockMin'),
    btnCopyAbout: $('#btnCopyAbout'),
    aboutVer: $('#aboutVer'),

    // products page controls
    btnAddProduct: $('#btnAddProduct'),
    btnImportCsv: $('#btnImportCsv'),
    btnExportCsv: $('#btnExportCsv'),
    btnBackupJson: $('#btnBackupJson'),
    btnRestoreJson: $('#btnRestoreJson'),
    prodSearchName: $('#prodSearchName'),
    prodSearchBarcode: $('#prodSearchBarcode'),
    prodSearchCat: $('#prodSearchCat'),
    productsTable: $('#productsTable'),

    // hidden files
    fileCsv: $('#fileCsv'),
    fileJson: $('#fileJson'),

    // modals
    backdrop: $('#backdrop'),
    closeBtns: $$('[data-close]'),

    modalLogin: $('#modalLogin'),
    modalAdmin: $('#modalAdmin'),
    modalPay: $('#modalPay'),
    modalQuick: $('#modalQuick'),
    modalProduct: $('#modalProduct'),
    modalCats: $('#modalCats'),
    modalPark: $('#modalPark'),
    modalZ: $('#modalZ'),
    modalEmail: $('#modalEmail'),

    // login
    loginUser: $('#loginUser'),
    loginPass: $('#loginPass'),
    btnLoginOk: $('#btnLoginOk'),

    // admin
    adminPin: $('#adminPin'),
    btnAdminOk: $('#btnAdminOk'),

    // pay modal
    payTotal: $('#payTotal'),
    payChangeBig: $('#payChangeBig'),
    payMethod: $('#payMethod'),
    payGivenWrap: $('#payGivenWrap'),
    payGiven: $('#payGiven'),
    payCardOnlyWrap: $('#payCardOnlyWrap'),
    payCardOnly: $('#payCardOnly'),
    paySplitWrap: $('#paySplitWrap'),
    payCash: $('#payCash'),
    payCard: $('#payCard'),
    payNote: $('#payNote'),
    moneyBar: $('#moneyBar'),
    payKeypad: $('#payKeypad'),
    btnPayOk: $('#btnPayOk'),
    btnPayNoPrint: $('#btnPayNoPrint'),

    // quick modal
    quickAmount: $('#quickAmount'),
    quickName: $('#quickName'),
    keypad: $('#keypad'),
    btnQuickOk: $('#btnQuickOk'),

    // product modal
    prodModalTitle: $('#prodModalTitle'),
    prodBarcode: $('#prodBarcode'),
    prodName: $('#prodName'),
    prodPrice: $('#prodPrice'),
    prodCost: $('#prodCost'),
    prodCat: $('#prodCat'),
    prodFav: $('#prodFav'),
    prodUnit: $('#prodUnit'),
    btnProductSave: $('#btnProductSave'),

    // categories modal
    newCatName: $('#newCatName'),
    btnCreateCat: $('#btnCreateCat'),
    catList: $('#catList'),

    // park modal
    parkName: $('#parkName'),
    btnParkNow: $('#btnParkNow'),
    parkList: $('#parkList'),

    // Z modal
    zExpected: $('#zExpected'),
    zCashCounted: $('#zCashCounted'),
    zDiff: $('#zDiff'),
    zNote: $('#zNote'),
    zAction: $('#zAction'),
    btnZOk: $('#btnZOk'),

    // email modal
    emailTo: $('#emailTo'),
    emailMsg: $('#emailMsg'),
    btnEmailSend: $('#btnEmailSend'),

    // print & toast
    printArea: $('#printArea'),
    toastHost: $('#toastHost'),
  };

  /* =========================
     TOAST + AUDIT + ACTIVITY
  ========================== */
  function toast(msg) {
    if (!el.toastHost) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    el.toastHost.appendChild(t);
    setTimeout(() => t.remove(), 1500);
  }

  function audit(type, data = {}) {
    state.audit.push({ ts: Date.now(), at: nowEs(), user: state.session.user?.name || 'CAJERO', type, data });
    if (state.audit.length > 2000) state.audit.splice(0, state.audit.length - 2000);
    save();
  }

  function touchActivity() {
    state.session.lastActivity = Date.now();
    save();
  }

  /* =========================
     SECURITY
  ========================== */
  function adminUnlocked() {
    return (state.session.adminUnlockedUntil || 0) > Date.now();
  }

  function lockAdminIfExpired() {
    const mins = Math.max(1, Number(state.settings.autoLockMin || 10));
    const maxMs = mins * 60 * 1000;
    const idle = Date.now() - (state.session.lastActivity || Date.now());
    if (idle > maxMs) state.session.adminUnlockedUntil = 0;
  }

  function renderAdminState() {
    lockAdminIfExpired();
    if (!el.adminState) return;
    el.adminState.textContent = adminUnlocked() ? 'Admin ✓' : 'Admin';
  }

  async function ensureDefaultHashes() {
    if (!state.settings.adminPinHash) {
      state.settings.adminPinHash = await sha256Hex('1234');
    }
    for (const u of state.users) {
      if (!u.passHash) u.passHash = await sha256Hex('1234');
    }
    save();
  }

  async function verifyAdminPin(pin) {
    const h = await sha256Hex(String(pin || '').trim());
    return h === state.settings.adminPinHash;
  }

  function unlockAdmin(minutes = 5) {
    state.session.adminUnlockedUntil = Date.now() + minutes * 60 * 1000;
    save();
    renderAdminState();
    audit('ADMIN_UNLOCK', { minutes });
  }

  function requireAdminOrPrompt(next) {
    if (adminUnlocked()) return next();
    openModal(el.modalAdmin);
    toast('PIN admin requerido');
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

  /* =========================
     THEME / PRINT TOGGLE / TABS / MODALS
  ========================== */
  function setTheme(mode) {
    const night = mode === 'night';
    document.body.classList.toggle('theme-day', !night);
    document.body.classList.toggle('theme-night', night);
    if (el.themeLabel) el.themeLabel.textContent = night ? 'Noche' : 'Día';
    state.settings.theme = night ? 'night' : 'day';
    save();
  }

  function renderPrintToggle() {
    const on = !!state.settings.printOn;
    if (el.printDot) el.printDot.classList.toggle('off', !on);
    if (el.printLabel) el.printLabel.textContent = on ? 'Impresión ON' : 'Impresión OFF';
    if (el.setPrintOn) el.setPrintOn.value = on ? '1' : '0';
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
    if (f) setTimeout(() => f.focus(), 20);
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
     CATEGORIES
  ========================== */
  function normalizeCategories() {
    const ensure = (id, name) => {
      if (!state.categories.some(c => c.id === id)) state.categories.unshift({ id, name });
    };
    ensure('c_all', 'Todos');
    ensure('c_fav', 'Favoritos');
    save();
  }

  function getCatName(id) {
    return state.categories.find(c => c.id === id)?.name || '—';
  }

  function createCategory(name) {
    const n = String(name || '').trim();
    if (!n) return null;
    if (state.categories.some(c => c.name.toLowerCase() === n.toLowerCase())) return null;
    const id = 'c_' + uid().toLowerCase();
    const cat = { id, name: n };
    state.categories.push(cat);
    save();
    return cat;
  }

  function renameCategory(catId, newName) {
    const c = state.categories.find(x => x.id === catId);
    if (!c) return false;
    if (catId === 'c_all' || catId === 'c_fav') return false;
    const n = String(newName || '').trim();
    if (!n) return false;
    if (state.categories.some(x => x.id !== catId && x.name.toLowerCase() === n.toLowerCase())) return false;
    c.name = n;
    save();
    return true;
  }

  function deleteCategory(catId) {
    if (catId === 'c_all' || catId === 'c_fav') return false;
    const idx = state.categories.findIndex(c => c.id === catId);
    if (idx < 0) return false;

    const fallback = state.categories.find(c => c.id === 'c_ot')?.id || 'c_all';
    for (const p of state.products) {
      if (p.categoryId === catId) p.categoryId = fallback;
    }
    state.categories.splice(idx, 1);
    if (state.ui.selectedCategoryId === catId) state.ui.selectedCategoryId = 'c_all';
    save();
    return true;
  }

  /* =========================
     PRODUCTS
  ========================== */
  function findProductByBarcode(code) {
    const c = String(code || '').trim();
    if (!c) return null;
    return state.products.find(p => String(p.barcode || '').trim() === c) || null;
  }

  function addOrUpdateProduct(prod) {
    const barcode = String(prod.barcode || '').trim();
    if (barcode) {
      const dup = state.products.find(p => p.id !== prod.id && String(p.barcode || '').trim() === barcode);
      if (dup) return { ok: false, msg: 'Barcode ya existe' };
    }

    if (prod.id) {
      const p = state.products.find(x => x.id === prod.id);
      if (!p) return { ok: false, msg: 'Producto no encontrado' };
      Object.assign(p, prod);
      save();
      return { ok: true, product: p };
    }

    const pnew = { ...prod, id: 'P-' + uid() };
    state.products.push(pnew);
    save();
    return { ok: true, product: pnew };
  }

  function deleteProduct(id) {
    const idx = state.products.findIndex(p => p.id === id);
    if (idx < 0) return false;
    state.products.splice(idx, 1);
    save();
    return true;
  }

  /* =========================
     CART
  ========================== */
  const cart = {
    get active() { return state.carts.active; },
    totals() {
      const total = cart.active.lines.reduce((s, l) => s + (Number(l.price) * Number(l.qty || 0)), 0);
      return { total, subtotal: total };
    },
    addProduct(p, qty = 1) {
      if (!p) return;
      const key = p.id || p.barcode || p.name;
      const lines = cart.active.lines;
      const idx = lines.findIndex(l => l.key === key && !l.isManual);
      if (idx >= 0) lines[idx].qty += qty;
      else lines.push({
        key,
        productId: p.id,
        barcode: p.barcode || '',
        name: p.name,
        price: Number(p.price || 0),
        cost: p.cost == null ? null : Number(p.cost),
        qty,
        isManual: false
      });
      save();
      renderAll();
    },
    addManual(amount, name) {
      const a = Number(amount || 0);
      if (!(a > 0)) return;
      cart.active.lines.push({
        key: 'M-' + uid(),
        productId: null,
        barcode: '',
        name: String(name || 'Importe').trim() || 'Importe',
        price: a,
        cost: null,
        qty: 1,
        isManual: true
      });
      save();
      renderAll();
    },
    removeLine(index) {
      cart.active.lines.splice(index, 1);
      save();
      renderAll();
    },
    setQty(index, qty) {
      const q = Math.max(0, Math.floor(Number(qty || 0)));
      if (q <= 0) return cart.removeLine(index);
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

    parkOpen() {
      openModal(el.modalPark);
      renderParkedList();
    },
    parkNow(nameOpt) {
      if (!cart.active.lines.length) return toast('No hay líneas');
      const item = {
        id: 'K-' + uid(),
        name: String(nameOpt || '').trim(),
        cart: JSON.parse(JSON.stringify(cart.active)),
        ts: Date.now()
      };
      state.carts.parked.unshift(item);
      cart.clear();
      save();
      renderParkBadge();
      renderParkedList();
      toast('Aparcado');
    },
    restoreParked(id) {
      const idx = state.carts.parked.findIndex(x => x.id === id);
      if (idx < 0) return;
      if (cart.active.lines.length) {
        if (!confirm('Hay un ticket en curso. ¿Reemplazarlo por el aparcado?')) return;
      }
      state.carts.active = state.carts.parked[idx].cart;
      state.carts.parked.splice(idx, 1);
      save();
      renderAll();
      renderParkBadge();
      renderParkedList();
      closeModal(el.modalPark);
      toast('Recuperado');
    },
    deleteParked(id) {
      const idx = state.carts.parked.findIndex(x => x.id === id);
      if (idx < 0) return;
      state.carts.parked.splice(idx, 1);
      save();
      renderParkBadge();
      renderParkedList();
    }
  };

  function renderParkBadge() {
    if (!el.parkBadge) return;
    const n = state.carts.parked.length;
    el.parkBadge.hidden = n <= 0;
    el.parkBadge.textContent = String(n);
  }

  function renderParkedList() {
    if (!el.parkList) return;
    el.parkList.innerHTML = '';
    const items = state.carts.parked.slice();
    if (!items.length) {
      const div = document.createElement('div');
      div.className = 'muted';
      div.textContent = 'No hay aparcados.';
      el.parkList.appendChild(div);
      return;
    }
    for (const it of items) {
      const div = document.createElement('div');
      div.className = 'park-item';
      const lineCount = it.cart?.lines?.length || 0;
      div.innerHTML = `
        <div class="park-item-left">
          <div>
            <div class="line-name">${escapeHtml(it.name || '(Sin nombre)')}</div>
            <div class="line-sub muted">Líneas: ${lineCount} · ${new Date(it.ts).toLocaleString('es-ES')}</div>
          </div>
        </div>
        <div class="park-item-actions">
          <button class="btn btn-ghost btn-small" data-act="restore">Recuperar</button>
          <button class="btn btn-ghost btn-small" data-act="del">Borrar</button>
        </div>
      `;
      div.querySelector('[data-act="restore"]').addEventListener('click', () => cart.restoreParked(it.id));
      div.querySelector('[data-act="del"]').addEventListener('click', () => cart.deleteParked(it.id));
      el.parkList.appendChild(div);
    }
  }

  /* =========================
     TICKET / PRINT (80mm)
  ========================== */
  function nextTicketNo() {
    const n = state.counters.ticketSeq || 1;
    state.counters.ticketSeq = n + 1;
    save();
    return `T-${String(n).padStart(6, '0')}`;
  }

  function buildTicketHTML(s) {
    const head = `
      <div style="text-align:center; font-weight:900; margin-bottom:4px;">${escapeHtml(state.settings.shopName)}</div>
      <div style="text-align:center; margin-bottom:8px;">${escapeHtml(state.settings.shopSub)}</div>
      <div style="border-top:1px dashed #000; margin:6px 0;"></div>
      <div>${escapeHtml(s.ticketNo)}  ${escapeHtml(s.date)}</div>
      <div>Caja: ${escapeHtml(s.box)}  Cajero: ${escapeHtml(s.user)}</div>
      <div style="border-top:1px dashed #000; margin:6px 0;"></div>
    `;

    const body = s.lines.map(l => {
      const totalLine = Number(l.price) * Number(l.qty);
      return `
        <div style="display:flex; justify-content:space-between; gap:8px;">
          <div style="max-width:58mm; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;">${escapeHtml(l.name)}</div>
          <div style="text-align:right;">${fmtMoney(totalLine)}</div>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <div>${l.qty} x ${fmtMoney(l.price)}</div><div></div>
        </div>
      `;
    }).join('');

    const foot = `
      <div style="border-top:1px dashed #000; margin:6px 0;"></div>
      <div style="display:flex; justify-content:space-between; font-weight:900;">
        <div>TOTAL</div><div>${fmtMoney(s.total)} €</div>
      </div>
      <div>Pago: ${escapeHtml(s.payMethod)}</div>
      ${(s.payMethod === 'efectivo' || s.payMethod === 'mixto') ? `<div>Entregado: ${fmtMoney(s.given || 0)} €</div>` : ``}
      ${(s.payMethod === 'efectivo' || s.payMethod === 'mixto') ? `<div>Cambio: ${fmtMoney(s.change || 0)} €</div>` : ``}
      ${s.noteName ? `<div>Nota: ${escapeHtml(s.noteName)}</div>` : ``}
      <div style="border-top:1px dashed #000; margin:6px 0;"></div>
      <div style="text-align:center; margin-top:6px;">${escapeHtml(state.settings.footerText || 'Gracias por su compra')}</div>
      <div style="text-align:center; margin-top:4px;">IVA incluido en los precios</div>
    `;
    return `<div>${head}${body}${foot}</div>`;
  }

  function buildZHTML(z) {
    const sign = (n) => (n >= 0 ? '+' : '-');
    const abs = (n) => Math.abs(Number(n || 0));

    const head = `
      <div style="text-align:center; font-weight:900; margin-bottom:4px;">${escapeHtml(state.settings.shopName)}</div>
      <div style="text-align:center; margin-bottom:8px;">CIERRE Z · ${escapeHtml(z.dayKey)}</div>
      <div style="text-align:center; margin-bottom:8px;">${escapeHtml(state.settings.shopSub)}</div>
      <div style="border-top:1px dashed #000; margin:6px 0;"></div>
      <div>${escapeHtml(nowEs())}</div>
      <div>Caja: ${escapeHtml(state.settings.boxName)}  Cajero: ${escapeHtml(state.session.user.name)}</div>
      <div style="border-top:1px dashed #000; margin:6px 0;"></div>
    `;

    const body = `
      <div style="display:flex; justify-content:space-between;"><div>Tickets</div><div>${z.count}</div></div>
      <div style="display:flex; justify-content:space-between;"><div>Total</div><div>${fmtMoney(z.total)} €</div></div>
      <div style="display:flex; justify-content:space-between;"><div>Efectivo esperado</div><div>${fmtMoney(z.cashExpected)} €</div></div>
      <div style="display:flex; justify-content:space-between;"><div>Tarjeta</div><div>${fmtMoney(z.card)} €</div></div>
      <div style="border-top:1px dashed #000; margin:6px 0;"></div>
      <div style="display:flex; justify-content:space-between;"><div>Efectivo contado</div><div>${fmtMoney(z.cashCounted)} €</div></div>
      <div style="display:flex; justify-content:space-between; font-weight:900;">
        <div>Descuadre</div><div>${sign(z.diff)}${fmtMoney(abs(z.diff))} €</div>
      </div>
      ${z.note ? `<div style="margin-top:6px;">Nota: ${escapeHtml(z.note)}</div>` : ``}
    `;

    const foot = `
      <div style="border-top:1px dashed #000; margin:6px 0;"></div>
      <div style="text-align:center; margin-top:6px;">Made by Arslan Waris · All rights reserved</div>
    `;

    return `<div>${head}${body}${foot}</div>`;
  }

  function printHTML(html) {
    if (!state.settings.printOn) return; // IMPRESIÓN OFF => NO PRINT
    if (!el.printArea) return;
    el.printArea.innerHTML = html;
    window.print();
  }

  function printSale(s) {
    printHTML(buildTicketHTML(s));
  }

  /* =========================
     SALE STORAGE (Open day)
  ========================== */
  function saveSale({ payMethod, cashGiven, cardAmount, cashAmount, noteName }) {
    const { total } = cart.totals();
    if (!(total > 0)) return null;

    const ticketNo = nextTicketNo();
    const sale = {
      id: uid(),
      ticketNo,
      date: nowEs(),
      ts: Date.now(),
      dayKey: dateKeyLocal(),
      box: state.settings.boxName,
      user: state.session.user.name,

      payMethod,
      given: Number(cashGiven || 0),
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

      total,
      split: payMethod === 'mixto' ? { cash: Number(cashAmount || 0), card: Number(cardAmount || 0) } : null,
      cardOnly: payMethod === 'tarjeta' ? Number(cardAmount || 0) : null
    };

    if (payMethod === 'efectivo') {
      sale.change = Math.max(0, sale.given - sale.total);
    } else if (payMethod === 'mixto') {
      const cash = Number(cashAmount || 0);
      const card = Number(cardAmount || 0);
      const remaining = Math.max(0, sale.total - card);
      sale.change = Math.max(0, cash - remaining);
    } else {
      sale.change = 0;
    }

    state.openSales.push(sale);
    state.lastSaleId = sale.id;

    save();
    audit('SALE_CREATE', { ticketNo: sale.ticketNo, total: sale.total, payMethod });

    return sale;
  }

  function getLastSale() {
    if (state.lastSaleId) {
      const open = state.openSales.find(s => s.id === state.lastSaleId);
      if (open) return open;
      for (const d of state.closedDays) {
        const found = d.sales?.find(s => s.id === state.lastSaleId);
        if (found) return found;
      }
    }
    return state.openSales[state.openSales.length - 1] || state.closedDays.at(-1)?.sales?.at(-1) || null;
  }

  /* =========================
     REPORTS / FILTER
  ========================== */
  function salesForRange(fromKey, toKey, includeOpenIfToday = false) {
    // Inclusive by dayKey
    const sales = [];
    for (const day of state.closedDays) {
      if (day.dayKey >= fromKey && day.dayKey <= toKey) {
        sales.push(...(day.sales || []));
      }
    }
    if (includeOpenIfToday) {
      const today = dateKeyLocal();
      if (today >= fromKey && today <= toKey) {
        sales.push(...state.openSales);
      }
    }
    return sales;
  }

  function presetRange(preset) {
    const d = new Date();
    const today = dateKeyLocal(d);

    const ymd = (dt) => dateKeyLocal(dt);

    if (preset === 'today') return { from: today, to: today, includeOpen: true };
    if (preset === 'yesterday') {
      const yd = new Date(d); yd.setDate(d.getDate() - 1);
      const yk = ymd(yd);
      return { from: yk, to: yk, includeOpen: false };
    }
    if (preset === 'week') {
      // Monday-start (ES)
      const wd = (d.getDay() + 6) % 7; // Mon=0..Sun=6
      const start = new Date(d); start.setDate(d.getDate() - wd);
      const end = new Date(start); end.setDate(start.getDate() + 6);
      return { from: ymd(start), to: ymd(end), includeOpen: true };
    }
    if (preset === 'month') {
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      return { from: ymd(start), to: ymd(end), includeOpen: true };
    }
    // custom
    const from = el.repFrom?.value || today;
    const to = el.repTo?.value || today;
    return { from, to, includeOpen: true };
  }

  function calcSummary(sales) {
    const count = sales.length;
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

    const cost = sales.reduce((S, x) => {
      const c = (x.lines || []).reduce((sum, l) => {
        if (l.cost == null) return sum;
        return sum + (Number(l.cost) * Number(l.qty || 0));
      }, 0);
      return S + c;
    }, 0);

    const profit = total - cost;

    return { count, total, cash, card, profit };
  }

  function renderReports() {
    if (!el.repPreset) return;

    const preset = el.repPreset.value || 'today';
    const r = presetRange(preset);

    if (preset !== 'custom') {
      if (el.repFrom) el.repFrom.value = r.from;
      if (el.repTo) el.repTo.value = r.to;
    }

    const sales = salesForRange(r.from, r.to, r.includeOpen);
    const sum = calcSummary(sales);

    if (el.statTickets) el.statTickets.textContent = String(sum.count);
    if (el.statTotal) el.statTotal.textContent = fmtEUR(sum.total);
    if (el.statCash) el.statCash.textContent = fmtEUR(sum.cash);
    if (el.statCard) el.statCard.textContent = fmtEUR(sum.card);
    if (el.statProfit) el.statProfit.textContent = fmtEUR(sum.profit);

    // last Z info
    const lastClosed = state.closedDays.at(-1);
    if (el.zInfo) {
      if (lastClosed?.z) {
        const z = lastClosed.z;
        const sign = z.diff >= 0 ? '+' : '-';
        el.zInfo.textContent = `${lastClosed.dayKey} · esperado ${fmtEUR(z.cashExpected)} · contado ${fmtEUR(z.cashCounted)} · descuadre ${sign}${fmtEUR(Math.abs(z.diff))}`;
      } else {
        el.zInfo.textContent = 'Sin cierres Z.';
      }
    }

    // Table
    if (!el.salesTable) return;
    const thead = el.salesTable.querySelector('.trow.thead');
    el.salesTable.innerHTML = '';
    if (thead) el.salesTable.appendChild(thead);

    const list = sales.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 120);
    for (const s of list) {
      const row = document.createElement('div');
      row.className = 'trow';
      row.innerHTML = `
        <div class="tcell mono">${escapeHtml(s.date)}</div>
        <div class="tcell mono">${escapeHtml(s.ticketNo)}</div>
        <div class="tcell">${escapeHtml(s.payMethod)}</div>
        <div class="tcell tcell-right mono">${fmtMoney(s.total)} €</div>
        <div class="tcell tcell-right">
          <button class="btn btn-ghost btn-small" data-act="print">Imprimir</button>
        </div>
      `;
      row.querySelector('[data-act="print"]').addEventListener('click', () => {
        if (!state.settings.printOn) return toast('Impresión OFF');
        printSale(s);
      });
      el.salesTable.appendChild(row);
    }
  }

  /* =========================
     Z CLOSE (archive day + clear open)
  ========================== */
  function summaryOpenDay() {
    const sales = state.openSales.slice();
    return calcSummary(sales);
  }

  function openZModal() {
    requireAdminOrPrompt(() => {
      const sum = summaryOpenDay();
      const dayKey = dateKeyLocal();

      if (el.zExpected) {
        el.zExpected.textContent = `Día ${dayKey} · Tickets: ${sum.count} · Total: ${fmtEUR(sum.total)} · Efectivo esperado: ${fmtEUR(sum.cash)} · Tarjeta: ${fmtEUR(sum.card)}`;
      }

      if (el.zCashCounted) el.zCashCounted.value = '';
      if (el.zDiff) el.zDiff.value = '0,00';
      if (el.zNote) el.zNote.value = '';
      if (el.zAction) el.zAction.value = 'close';

      openModal(el.modalZ);
    });
  }

  function updateZDiffUI() {
    const sum = summaryOpenDay();
    const counted = parseMoney(el.zCashCounted?.value || '0');
    const diff = counted - sum.cash;
    if (el.zDiff) {
      const sign = diff >= 0 ? '+' : '-';
      el.zDiff.value = `${sign}${fmtMoney(Math.abs(diff))}`;
    }
  }

  function doZAction() {
    const sum = summaryOpenDay();
    const dayKey = dateKeyLocal();

    const counted = parseMoney(el.zCashCounted?.value || '0');
    const diff = counted - sum.cash;
    const note = (el.zNote?.value || '').trim();
    const action = el.zAction?.value || 'close';

    const z = {
      dayKey,
      count: sum.count,
      total: sum.total,
      cashExpected: sum.cash,
      card: sum.card,
      cashCounted: counted,
      diff,
      note,
      createdAt: Date.now()
    };

    // Print only
    if (action === 'print') {
      if (!state.settings.printOn) {
        toast('Impresión OFF');
      } else {
        printHTML(buildZHTML(z));
      }
      closeModal(el.modalZ);
      return;
    }

    // Close day: optionally print Z
    if (state.settings.printOn && state.settings.printZOnClose) {
      printHTML(buildZHTML(z));
    }

    // Archive
    const archivedSales = state.openSales.slice();
    const closedObj = {
      dayKey,
      closedAt: Date.now(),
      z,
      sales: archivedSales
    };
    state.closedDays.push(closedObj);

    // Clear open sales (limpiar apartado ventas del día)
    state.openSales = [];
    state.lastSaleId = null;

    save();
    audit('Z_CLOSE', z);

    closeModal(el.modalZ);
    toast('Día cerrado (Z)');

    // Re-render
    renderAll();
  }

  /* =========================
     PAY MODAL PRO
  ========================== */
  function syncPayUI() {
    const m = el.payMethod?.value || 'efectivo';
    const isCash = m === 'efectivo';
    const isCard = m === 'tarjeta';
    const isMix = m === 'mixto';

    if (el.paySplitWrap) el.paySplitWrap.hidden = !isMix;
    if (el.payGivenWrap) el.payGivenWrap.style.display = (isCash) ? '' : 'none';
    if (el.payCardOnlyWrap) el.payCardOnlyWrap.style.display = (isCard) ? '' : 'none';

    if (isCard) {
      // default card input to total for convenience (optional)
      const { total } = cart.totals();
      if (el.payCardOnly && !String(el.payCardOnly.value || '').trim()) {
        el.payCardOnly.value = fmtMoney(total).replace('.', ',');
      }
    }
    calcPayChange();
  }

  function setChangeBig(value, isOk) {
    if (!el.payChangeBig) return;
    el.payChangeBig.textContent = fmtEUR(value);
    el.payChangeBig.classList.toggle('ok', !!isOk);
    el.payChangeBig.classList.toggle('bad', !isOk);
  }

  function calcPayChange() {
    const { total } = cart.totals();
    const m = el.payMethod?.value || 'efectivo';

    if (el.payTotal) el.payTotal.textContent = fmtEUR(total);

    if (m === 'efectivo') {
      const given = parseMoney(el.payGiven?.value || '0');
      const change = given - total;
      setChangeBig(Math.max(0, change), change >= 0);
      return;
    }

    if (m === 'tarjeta') {
      // always ok
      setChangeBig(0, true);
      return;
    }

    // mixto
    const cash = parseMoney(el.payCash?.value || '0');
    const card = parseMoney(el.payCard?.value || '0');
    const remaining = Math.max(0, total - card);
    const change = cash - remaining;
    setChangeBig(Math.max(0, change), (cash + card) >= total);
  }

  function openPayModal() {
    const { total } = cart.totals();
    if (!(total > 0)) return toast('No hay líneas');

    if (el.payMethod) el.payMethod.value = cart.active.payMethod || 'efectivo';
    if (el.payGiven) el.payGiven.value = '';
    if (el.payCash) el.payCash.value = '';
    if (el.payCard) el.payCard.value = '';
    if (el.payCardOnly) el.payCardOnly.value = '';
    if (el.payNote) el.payNote.value = el.noteName?.value || cart.active.noteName || '';

    syncPayUI();
    calcPayChange();

    openModal(el.modalPay);
  }

  function moneyAdd(amount) {
    const m = el.payMethod?.value || 'efectivo';
    const { total } = cart.totals();

    if (amount === 'clear') {
      if (m === 'efectivo' && el.payGiven) el.payGiven.value = '';
      if (m === 'mixto') {
        if (el.payCash) el.payCash.value = '';
        if (el.payCard) el.payCard.value = '';
      }
      calcPayChange();
      return;
    }

    if (amount === 'exact') {
      if (m === 'efectivo' && el.payGiven) el.payGiven.value = fmtMoney(total).replace('.', ',');
      if (m === 'mixto' && el.payCash) el.payCash.value = fmtMoney(total).replace('.', ','); // assume all cash
      calcPayChange();
      return;
    }

    const add = Number(amount || 0);
    if (!Number.isFinite(add)) return;

    if (m === 'efectivo') {
      const cur = parseMoney(el.payGiven?.value || '0');
      if (el.payGiven) el.payGiven.value = fmtMoney(cur + add).replace('.', ',');
    } else if (m === 'mixto') {
      const cur = parseMoney(el.payCash?.value || '0');
      if (el.payCash) el.payCash.value = fmtMoney(cur + add).replace('.', ',');
    } else {
      // tarjeta: ignorar billetes
      toast('Método tarjeta: usa el campo tarjeta');
    }
    calcPayChange();
  }

  function keypadInsert(targetInput, k) {
    if (!targetInput) return;
    let v = String(targetInput.value || '');

    if (k === 'c') { targetInput.value = ''; return; }
    if (k === 'bk') { targetInput.value = v.slice(0, -1); return; }
    if (k === '.') {
      if (v.includes(',') || v.includes('.')) return;
      targetInput.value = v + ',';
      return;
    }
    if (k === 'ok') return; // handled outside
    targetInput.value = v + String(k);
  }

  function activePayInput() {
    const m = el.payMethod?.value || 'efectivo';
    if (m === 'efectivo') return el.payGiven;
    if (m === 'mixto') return el.payCash;
    return el.payCardOnly;
  }

  function confirmPay({ doPrint }) {
    const { total } = cart.totals();
    if (!(total > 0)) return toast('No hay total');

    const method = el.payMethod?.value || 'efectivo';
    const note = (el.payNote?.value || '').trim();

    let cashGiven = 0;
    let cardAmount = 0;
    let cashAmount = 0;

    if (method === 'efectivo') {
      cashGiven = parseMoney(el.payGiven?.value || '0');
      if (cashGiven < total) {
        if (!confirm('Entregado menor que total. ¿Confirmar igualmente?')) return;
      }
    } else if (method === 'tarjeta') {
      cardAmount = parseMoney(el.payCardOnly?.value || '0');
      cashGiven = 0;
    } else {
      cashAmount = parseMoney(el.payCash?.value || '0');
      cardAmount = parseMoney(el.payCard?.value || '0');
      cashGiven = cashAmount;

      if ((cashAmount + cardAmount) < total) {
        if (!confirm('Mixto: efectivo+tarjeta menor que total. ¿Confirmar igualmente?')) return;
      }
    }

    const sale = saveSale({
      payMethod: method,
      cashGiven,
      cardAmount,
      cashAmount,
      noteName: note
    });

    if (!sale) return toast('Error al guardar');

    // update UI
    if (el.ticketNo) el.ticketNo.textContent = sale.ticketNo;

    closeModal(el.modalPay);

    // limpiar ticket
    cart.clear();

    toast(`Venta OK · ${sale.ticketNo}`);

    // print logic
    if (!state.settings.printOn) return; // OFF: no print
    if (!doPrint) return;
    if (state.settings.autoPrint) {
      printSale(sale);
      return;
    }
    // if not autoPrint and doPrint true => print
    printSale(sale);
  }

  /* =========================
     QUICK AMOUNT MODAL (keypad)
  ========================== */
  function quickKeypadInsert(k) {
    if (!el.quickAmount) return;
    keypadInsert(el.quickAmount, k);
  }

  function quickOk() {
    const amt = parseMoney(el.quickAmount?.value || '0');
    const name = (el.quickName?.value || 'Importe').trim();
    if (!(amt > 0)) return toast('Importe inválido');
    cart.addManual(amt, name);
    closeModal(el.modalQuick);
    toast('Importe añadido');
    if (el.quickAmount) el.quickAmount.value = '';
  }

  /* =========================
     EMAIL
  ========================== */
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
    out.push('Made by Arslan Waris · All rights reserved');
    return out.join('\n');
  }

  function sendEmailMailto() {
    const to = (el.emailTo?.value || '').trim();
    const extra = (el.emailMsg?.value || '').trim();
    const last = getLastSale();
    if (!last) return toast('No hay ticket');
    const subject = `Ticket ${last.ticketNo} - ${state.settings.shopName}`;
    const body = buildReceiptText(last) + (extra ? `\n\n${extra}` : '');
    const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = url;
    closeModal(el.modalEmail);
  }

  /* =========================
     RENDER: HEADER / CATS / GRID / TICKET
  ========================== */
  function renderHeader() {
    setTheme(state.settings.theme || 'day');

    if (el.userLabel) el.userLabel.textContent = state.session.user?.name || 'CAJERO';
    if (el.posUser) el.posUser.textContent = state.session.user?.name || 'CAJERO';

    if (el.shopName) el.shopName.textContent = state.settings.shopName || '';
    if (el.shopSub) el.shopSub.textContent = state.settings.shopSub || '';
    if (el.posBox) el.posBox.textContent = state.settings.boxName || 'CAJA-1';

    if (el.ticketDate) el.ticketDate.textContent = nowEs();

    const seq = state.counters.ticketSeq || 1;
    if (el.ticketNo) el.ticketNo.textContent = `T-${String(seq).padStart(6, '0')}`;

    // Scanner indicator
    if (el.scanDot) el.scanDot.style.opacity = state.settings.alwaysScan ? '1' : '.35';

    renderAdminState();
    renderPrintToggle();
    renderParkBadge();

    if (el.aboutVer) el.aboutVer.textContent = `v${state.version || '1.3'}`;
  }

  function renderCategoryChips() {
    if (!el.catChips) return;
    el.catChips.innerHTML = '';
    normalizeCategories();

    for (const c of state.categories) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cat-chip' + (state.ui.selectedCategoryId === c.id ? ' is-active' : '');
      b.textContent = c.name;
      b.addEventListener('click', () => {
        state.ui.selectedCategoryId = c.id;
        save();
        renderCategoryChips();
        renderProductGrid();
      });
      el.catChips.appendChild(b);
    }
  }

  function listProductsForSelectedCategory() {
    const catId = state.ui.selectedCategoryId || 'c_all';
    const q = String(el.searchInput?.value || '').trim().toLowerCase();

    let items = state.products.slice();
    if (catId === 'c_fav') items = items.filter(p => !!p.fav);
    else if (catId !== 'c_all') items = items.filter(p => p.categoryId === catId);

    if (q) {
      items = items.filter(p =>
        (p.name || '').toLowerCase().includes(q) ||
        String(p.barcode || '').includes(q)
      );
    }

    items.sort((a, b) => (Number(!!b.fav) - Number(!!a.fav)) || (a.name || '').localeCompare(b.name || ''));
    return items.slice(0, 48);
  }

  function makeProdTile(name, price, sub, onClick) {
    const b = document.createElement('button');
    b.className = 'prod';
    b.type = 'button';
    b.innerHTML = `
      <div class="prod-name">${escapeHtml(name)}</div>
      <div class="prod-price">${escapeHtml(price)}</div>
      <div class="prod-sub">${escapeHtml(sub)}</div>
    `;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderProductGrid() {
    if (!el.prodGrid) return;
    el.prodGrid.innerHTML = '';

    // tile: importe rápido
    el.prodGrid.appendChild(makeProdTile('Importe rápido', 'Manual', 'Teclado', () => openModal(el.modalQuick)));

    const items = listProductsForSelectedCategory();
    for (const p of items) {
      const sub = p.barcode ? `BC: ${p.barcode}` : 'Manual';
      const btn = makeProdTile(p.name, fmtEUR(p.price || 0), sub, () => cart.addProduct(p, 1));

      // right click => editar producto (admin)
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        requireAdminOrPrompt(() => openEditProduct(p.id));
      });

      el.prodGrid.appendChild(btn);
    }
  }

  function renderTicketLines() {
    if (!el.ticketLines) return;
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
      const btnPlus = row.querySelectorAll('.qty-btn')[1];
      const qtyIn = row.querySelector('.qty-in');

      btnMinus.addEventListener('click', () => cart.inc(idx, -1));
      btnPlus.addEventListener('click', () => cart.inc(idx, +1));
      qtyIn.addEventListener('change', () => cart.setQty(idx, qtyIn.value));
      qtyIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); qtyIn.blur(); focusBarcodeSoon(); }
      });

      // right click delete line
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); cart.removeLine(idx); });

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
    const change = (method === 'efectivo') ? Math.max(0, given - total) : 0;
    if (el.changeInput) el.changeInput.value = fmtMoney(change);
  }

  /* =========================
     PRODUCTS TABLE (tab Productos)
  ========================== */
  function fillCategorySelect(sel, includeAll = true) {
    if (!sel) return;
    sel.innerHTML = '';
    if (includeAll) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = 'Todas';
      sel.appendChild(o);
    }
    for (const c of state.categories) {
      if (c.id === 'c_all' || c.id === 'c_fav') continue;
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name;
      sel.appendChild(o);
    }
  }

  function renderProductsTable() {
    if (!el.productsTable) return;

    fillCategorySelect(el.prodSearchCat, true);
    fillCategorySelect(el.prodCat, false);

    const thead = el.productsTable.querySelector('.trow.thead');
    el.productsTable.innerHTML = '';
    if (thead) el.productsTable.appendChild(thead);

    const qName = String(el.prodSearchName?.value || '').trim().toLowerCase();
    const qBar = String(el.prodSearchBarcode?.value || '').trim();
    const qCat = String(el.prodSearchCat?.value || '').trim();

    let items = state.products.slice();
    if (qName) items = items.filter(p => (p.name || '').toLowerCase().includes(qName));
    if (qBar) items = items.filter(p => String(p.barcode || '').includes(qBar));
    if (qCat) items = items.filter(p => p.categoryId === qCat);

    items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    for (const p of items) {
      const row = document.createElement('div');
      row.className = 'trow';
      row.innerHTML = `
        <div class="tcell">
          <div>
            <div class="line-name">${escapeHtml(p.name)}</div>
            <div class="line-sub muted">${escapeHtml(p.unit || 'ud')}</div>
          </div>
        </div>
        <div class="tcell mono">${escapeHtml(p.barcode || '—')}</div>
        <div class="tcell tcell-right mono">${fmtMoney(p.price || 0)}</div>
        <div class="tcell tcell-right mono">${p.cost == null ? '—' : fmtMoney(p.cost)}</div>
        <div class="tcell">${escapeHtml(getCatName(p.categoryId))}</div>
        <div class="tcell tcell-center">${p.fav ? '<span class="badge badge-ok">Sí</span>' : '<span class="badge">No</span>'}</div>
        <div class="tcell tcell-right">
          <button class="btn btn-ghost btn-small" data-act="edit">Editar</button>
          <button class="btn btn-ghost btn-small" data-act="del">Borrar</button>
        </div>
      `;

      row.querySelector('[data-act="edit"]').addEventListener('click', () => openEditProduct(p.id));
      row.querySelector('[data-act="del"]').addEventListener('click', () => {
        requireAdminOrPrompt(() => {
          if (!confirm(`¿Borrar producto "${p.name}"?`)) return;
          deleteProduct(p.id);
          toast('Producto borrado');
          renderAll();
        });
      });

      el.productsTable.appendChild(row);
    }
  }

  /* =========================
     PRODUCT MODAL
  ========================== */
  function openNewProduct(prefillBarcode = '') {
    el.modalProduct.dataset.editId = '';
    if (el.prodModalTitle) el.prodModalTitle.textContent = 'Nuevo producto';

    fillCategorySelect(el.prodCat, false);

    if (el.prodBarcode) el.prodBarcode.value = prefillBarcode || '';
    if (el.prodName) el.prodName.value = '';
    if (el.prodPrice) el.prodPrice.value = '';
    if (el.prodCost) el.prodCost.value = '';
    if (el.prodCat) el.prodCat.value = state.categories.find(c => c.id === 'c_ot')?.id || state.categories.find(c => !['c_all', 'c_fav'].includes(c.id))?.id || '';
    if (el.prodFav) el.prodFav.value = '1';
    if (el.prodUnit) el.prodUnit.value = 'ud';

    openModal(el.modalProduct);
  }

  function openEditProduct(id) {
    const p = state.products.find(x => x.id === id);
    if (!p) return toast('Producto no encontrado');

    el.modalProduct.dataset.editId = p.id;
    if (el.prodModalTitle) el.prodModalTitle.textContent = 'Editar producto';

    fillCategorySelect(el.prodCat, false);

    el.prodBarcode.value = p.barcode || '';
    el.prodName.value = p.name || '';
    el.prodPrice.value = fmtMoney(p.price || 0).replace('.', ',');
    el.prodCost.value = p.cost == null ? '' : fmtMoney(p.cost).replace('.', ',');
    el.prodCat.value = p.categoryId || '';
    el.prodFav.value = p.fav ? '1' : '0';
    el.prodUnit.value = p.unit || 'ud';

    openModal(el.modalProduct);
  }

  function saveProductFromModal() {
    const editId = el.modalProduct.dataset.editId || '';
    const barcode = (el.prodBarcode?.value || '').trim();
    const name = (el.prodName?.value || '').trim();
    const price = parseMoney(el.prodPrice?.value || '0');
    const costRaw = (el.prodCost?.value || '').trim();
    const cost = costRaw ? parseMoney(costRaw) : null;
    const categoryId = el.prodCat?.value || (state.categories.find(c => c.id === 'c_ot')?.id || 'c_all');
    const fav = (el.prodFav?.value || '0') === '1';
    const unit = el.prodUnit?.value || 'ud';

    if (!name) return toast('Falta nombre');
    if (!(price >= 0)) return toast('Precio inválido');

    const res = addOrUpdateProduct({ id: editId || undefined, barcode, name, price, cost, categoryId, fav, unit });
    if (!res.ok) return toast(res.msg || 'Error producto');

    closeModal(el.modalProduct);
    toast('Producto guardado');

    // refrescar
    renderAll();
  }

  /* =========================
     CATEGORIES MODAL
  ========================== */
  function openCatsModal() {
    requireAdminOrPrompt(() => {
      openModal(el.modalCats);
      renderCatsModal();
    });
  }

  function renderCatsModal() {
    if (!el.catList) return;
    el.catList.innerHTML = '';

    for (const c of state.categories) {
      const special = (c.id === 'c_all' || c.id === 'c_fav');
      const div = document.createElement('div');
      div.className = 'cat-item';
      div.innerHTML = `
        <div class="cat-item-left">
          <div class="badge">${escapeHtml(c.id)}</div>
          <input value="${escapeHtml(c.name)}" ${special ? 'disabled' : ''} />
        </div>
        <div class="cat-item-actions">
          <button class="btn btn-ghost btn-small" data-act="save" ${special ? 'disabled' : ''}>Guardar</button>
          <button class="btn btn-ghost btn-small" data-act="del" ${special ? 'disabled' : ''}>Borrar</button>
        </div>
      `;
      const input = div.querySelector('input');
      const btnSave = div.querySelector('[data-act="save"]');
      const btnDel = div.querySelector('[data-act="del"]');

      btnSave?.addEventListener('click', () => {
        const ok = renameCategory(c.id, input.value);
        if (!ok) return toast('Nombre inválido o duplicado');
        toast('Categoría renombrada');
        renderAll();
        renderCatsModal();
      });

      btnDel?.addEventListener('click', () => {
        if (!confirm(`¿Borrar categoría "${c.name}"?`)) return;
        const ok = deleteCategory(c.id);
        if (!ok) return toast('No se puede borrar');
        toast('Categoría borrada');
        renderAll();
        renderCatsModal();
      });

      el.catList.appendChild(div);
    }
  }

  function createCatFromModal() {
    requireAdminOrPrompt(() => {
      const name = (el.newCatName?.value || '').trim();
      const c = createCategory(name);
      if (!c) return toast('Nombre inválido o duplicado');
      if (el.newCatName) el.newCatName.value = '';
      toast('Categoría creada');
      renderAll();
      renderCatsModal();
    });
  }

  /* =========================
     CSV / JSON IMPORT EXPORT
  ========================== */
  function exportProductsCSV() {
    const rows = [['barcode', 'nombre', 'pvp', 'coste', 'categoria', 'fav', 'unidad']];
    for (const p of state.products) {
      rows.push([
        p.barcode || '',
        p.name || '',
        fmtMoney(p.price || 0),
        (p.cost == null ? '' : fmtMoney(p.cost)),
        getCatName(p.categoryId),
        p.fav ? '1' : '0',
        p.unit || 'ud'
      ]);
    }
    downloadText('tpv_productos.csv', toCSV(rows), 'text/csv');
  }

  function allSalesFlat() {
    const sales = [];
    // closed days
    for (const d of state.closedDays) sales.push(...(d.sales || []));
    // open day
    sales.push(...state.openSales);
    return sales;
  }

  function exportSalesCSV() {
    const rows = [['fecha', 'ticket', 'pago', 'total', 'cajero', 'caja', 'dia', 'lineas']];
    const sales = allSalesFlat().slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
    for (const s of sales) {
      rows.push([
        s.date,
        s.ticketNo,
        s.payMethod,
        fmtMoney(s.total || 0),
        s.user,
        s.box,
        s.dayKey || '',
        (s.lines || []).map(l => `${l.name}(${l.qty}x${fmtMoney(l.price)})`).join(' | ')
      ]);
    }
    downloadText('tpv_ventas.csv', toCSV(rows), 'text/csv');
  }

  function backupJSON() {
    downloadText('tpv_backup.json', JSON.stringify(state, null, 2), 'application/json');
  }

  function restoreJSONFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || ''));
        state = deepMerge(DEFAULTS(), data);
        save();
        toast('Restaurado');
        renderAll();
      } catch {
        toast('JSON inválido');
      }
    };
    reader.readAsText(file);
  }

  function importProductsFromCSVFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCSV(String(reader.result || ''));
      if (!rows.length) return toast('CSV vacío');

      const headers = rows[0].map(h => h.toLowerCase());
      const idx = (name) => headers.indexOf(name);

      const iBarcode = idx('barcode');
      const iNombre = idx('nombre');
      const iPvp = idx('pvp');
      const iCoste = idx('coste');
      const iCat = idx('categoria');
      const iFav = idx('fav');
      const iUnit = idx('unidad');

      const hasHeaders = (iNombre >= 0 && iPvp >= 0);

      let imported = 0;

      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const get = (i, fallback = '') => (i >= 0 ? (row[i] ?? fallback) : fallback);

        const barcode = hasHeaders ? get(iBarcode, '') : (row[0] ?? '');
        const name = hasHeaders ? get(iNombre, '') : (row[1] ?? '');
        const pvpStr = hasHeaders ? get(iPvp, '0') : (row[2] ?? '0');
        const costStr = hasHeaders ? get(iCoste, '') : (row[3] ?? '');
        const catName = hasHeaders ? get(iCat, '') : (row[4] ?? '');
        const favStr = hasHeaders ? get(iFav, '0') : (row[5] ?? '0');
        const unit = hasHeaders ? get(iUnit, 'ud') : (row[6] ?? 'ud');

        if (!String(name || '').trim()) continue;

        const price = parseMoney(pvpStr);
        const cost = String(costStr || '').trim() ? parseMoney(costStr) : null;
        const fav = String(favStr || '0').trim() === '1';

        let catId = state.categories.find(c => c.name.toLowerCase() === String(catName || '').trim().toLowerCase())?.id;
        if (!catId) {
          const created = createCategory(String(catName || '').trim());
          catId = created?.id || state.categories.find(c => c.id === 'c_ot')?.id || 'c_all';
        }

        const res = addOrUpdateProduct({
          id: undefined,
          barcode: String(barcode || '').trim(),
          name: String(name).trim(),
          price,
          cost,
          categoryId: catId,
          fav,
          unit: String(unit || 'ud').trim()
        });

        if (res.ok) imported++;
      }

      toast(`Importados: ${imported}`);
      renderAll();
    };
    reader.readAsText(file);
  }

  /* =========================
     SCANNER: ALWAYS LISTENING
  ========================== */
  const scanner = {
    buf: '',
    lastTs: 0,
    timer: null,
    enabled() { return !!state.settings.alwaysScan; },
    speedMs() {
      const ms = Number(state.settings.scanSpeedMs || 35);
      return Math.max(15, Math.min(140, ms));
    },
    reset() {
      scanner.buf = '';
      scanner.lastTs = 0;
      if (scanner.timer) { clearTimeout(scanner.timer); scanner.timer = null; }
    },
    pushChar(ch) {
      const t = Date.now();
      const gap = scanner.lastTs ? (t - scanner.lastTs) : 0;
      const maxGap = scanner.speedMs();

      // if too slow, treat as new buffer
      if (scanner.lastTs && gap > maxGap) scanner.buf = '';

      scanner.lastTs = t;
      scanner.buf += ch;

      if (scanner.timer) clearTimeout(scanner.timer);
      scanner.timer = setTimeout(() => {
        // fallback finalize if scanner didn't send Enter
        if (scanner.buf.length >= 8) finalizeScan(scanner.buf);
        scanner.reset();
      }, maxGap + 140);
    }
  };

  function finalizeScan(code) {
    const c = String(code || '').trim();
    if (!c) return;

    // do not scan while a dialog is open (avoid typing into modals)
    if (document.querySelector('dialog[open]')) return;

    const p = findProductByBarcode(c);
    if (p) {
      cart.addProduct(p, 1);
      flashScan();
      toast('Escaneado ✓');
      if (el.barcodeInput) el.barcodeInput.value = '';
    } else {
      openNewProduct(c);
      toast('Barcode no encontrado: alta producto');
    }
    focusBarcodeSoon();
  }

  function flashScan() {
    if (!el.scanDot) return;
    el.scanDot.style.boxShadow = '0 0 0 8px rgba(11,61,46,.22)';
    setTimeout(() => { el.scanDot.style.boxShadow = '0 0 0 5px rgba(11,61,46,.14)'; }, 180);
  }

  /* =========================
     ABOUT COPY
  ========================== */
  async function copyAbout() {
    const txt =
`TPV NADEEM LOCUTORIO
Version: v${state.version || '1.3'}
Made by Arslan Waris · All rights reserved
Local (GitHub Pages) · IVA incluido`;
    try {
      await navigator.clipboard.writeText(txt);
      toast('Copiado');
    } catch {
      toast('No se pudo copiar');
    }
  }

  /* =========================
     RENDER ALL
  ========================== */
  function renderAll() {
    renderHeader();
    renderCategoryChips();
    renderProductGrid();
    renderTicketLines();
    renderTotals();
    renderProductsTable();
    renderReports();
  }

  /* =========================
     EVENTS / BINDINGS
  ========================== */
  function bindTabs() {
    el.tabs.forEach(t => t.addEventListener('click', () => {
      touchActivity();
      setTab(t.dataset.tab);
      renderAll();
    }));
  }

  function bindTop() {
    el.btnTheme?.addEventListener('click', () => {
      touchActivity();
      setTheme(document.body.classList.contains('theme-day') ? 'night' : 'day');
    });

    el.btnPrintToggle?.addEventListener('click', () => {
      touchActivity();
      state.settings.printOn = !state.settings.printOn;
      save();
      renderPrintToggle();
      toast(state.settings.printOn ? 'Impresión ON' : 'Impresión OFF');
    });

    el.btnLogin?.addEventListener('click', () => openModal(el.modalLogin));
    el.btnAdmin?.addEventListener('click', () => openModal(el.modalAdmin));
    el.btnAdminUnlock?.addEventListener('click', () => openModal(el.modalAdmin));
  }

  function bindModals() {
    el.backdrop?.addEventListener('click', () => {
      const open = document.querySelector('dialog[open]');
      if (open) closeModal(open);
    });

    el.closeBtns.forEach(b => b.addEventListener('click', () => {
      closeModal(document.getElementById(b.dataset.close));
    }));

    // login
    el.btnLoginOk?.addEventListener('click', async () => {
      touchActivity();
      const res = await login(el.loginUser?.value || '', el.loginPass?.value || '');
      if (!res.ok) return toast(res.msg || 'Login error');
      closeModal(el.modalLogin);
      toast('Sesión iniciada');
      renderAll();
    });

    // admin
    el.btnAdminOk?.addEventListener('click', async () => {
      touchActivity();
      const pin = (el.adminPin?.value || '').trim();
      if (pin.length < 4) return toast('PIN inválido');
      if (!(await verifyAdminPin(pin))) return toast('PIN incorrecto');
      unlockAdmin(5);
      closeModal(el.modalAdmin);
      toast('Admin desbloqueado');
      renderAll();
    });

    // pay modal changes
    el.payMethod?.addEventListener('change', () => { touchActivity(); syncPayUI(); });
    el.payGiven?.addEventListener('input', () => { touchActivity(); calcPayChange(); });
    el.payCash?.addEventListener('input', () => { touchActivity(); calcPayChange(); });
    el.payCard?.addEventListener('input', () => { touchActivity(); calcPayChange(); });
    el.payCardOnly?.addEventListener('input', () => { touchActivity(); calcPayChange(); });

    el.moneyBar?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-add]');
      if (!btn) return;
      touchActivity();
      const v = btn.dataset.add;
      moneyAdd(v === 'exact' || v === 'clear' ? v : Number(v));
    });

    el.payKeypad?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-k]');
      if (!btn) return;
      touchActivity();
      const k = btn.dataset.k;
      if (k === 'ok') {
        // Default: Cobrar con impresión (si ON)
        confirmPay({ doPrint: true });
        return;
      }
      const inp = activePayInput();
      keypadInsert(inp, k);
      calcPayChange();
    });

    el.btnPayOk?.addEventListener('click', () => { touchActivity(); confirmPay({ doPrint: true }); });
    el.btnPayNoPrint?.addEventListener('click', () => { touchActivity(); confirmPay({ doPrint: false }); });

    // quick modal
    el.keypad?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-k]');
      if (!btn) return;
      touchActivity();
      const k = btn.dataset.k;
      if (k === 'ok') return quickOk();
      quickKeypadInsert(k);
    });
    el.btnQuickOk?.addEventListener('click', () => { touchActivity(); quickOk(); });

    // product modal
    el.btnProductSave?.addEventListener('click', () => { touchActivity(); saveProductFromModal(); });

    // categories modal
    el.btnCreateCat?.addEventListener('click', () => { touchActivity(); createCatFromModal(); });

    // parked modal
    el.btnParkNow?.addEventListener('click', () => { touchActivity(); cart.parkNow(el.parkName?.value || ''); });

    // Z modal
    el.zCashCounted?.addEventListener('input', () => { touchActivity(); updateZDiffUI(); });
    el.btnZOk?.addEventListener('click', () => { touchActivity(); doZAction(); });

    // email
    el.btnEmailSend?.addEventListener('click', () => { touchActivity(); sendEmailMailto(); });
  }

  function bindVenta() {
    el.btnQuickAmount?.addEventListener('click', () => { touchActivity(); openModal(el.modalQuick); });
    el.btnPark?.addEventListener('click', () => { touchActivity(); cart.parkOpen(); });

    el.btnNewCategory?.addEventListener('click', () => {
      touchActivity();
      requireAdminOrPrompt(() => {
        const name = prompt('Nombre de nueva categoría:', '');
        if (!name) return;
        const c = createCategory(name);
        if (!c) return toast('Nombre inválido o duplicado');
        toast('Categoría creada');
        renderAll();
      });
    });

    el.btnManageCategories?.addEventListener('click', () => { touchActivity(); openCatsModal(); });

    el.btnAddProductInline?.addEventListener('click', () => { touchActivity(); openNewProduct(''); });

    el.barcodeInput?.addEventListener('keydown', (e) => {
      touchActivity();
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const code = (el.barcodeInput.value || '').trim();
      el.barcodeInput.value = '';
      if (!code) return;
      finalizeScan(code);
    });

    el.searchInput?.addEventListener('input', debounce(() => renderProductGrid(), 80));

    el.payTabs.forEach(p => p.addEventListener('click', () => {
      touchActivity();
      el.payTabs.forEach(x => x.classList.remove('is-active'));
      p.classList.add('is-active');
      cart.active.payMethod = p.dataset.pay || 'efectivo';
      save();
      renderTotals();
      focusBarcodeSoon();
    }));

    el.givenInput?.addEventListener('input', () => { touchActivity(); cart.active.given = parseMoney(el.givenInput.value); save(); renderTotals(); });
    el.noteName?.addEventListener('input', () => { touchActivity(); cart.active.noteName = el.noteName.value || ''; save(); });

    el.btnVoid?.addEventListener('click', () => {
      touchActivity();
      if (!cart.active.lines.length) return;
      if (!confirm('¿Anular ticket actual?')) return;
      cart.clear();
      audit('CART_VOID', {});
      toast('Ticket anulado');
    });

    el.btnRefund?.addEventListener('click', () => {
      touchActivity();
      requireAdminOrPrompt(() => {
        const last = getLastSale();
        if (!last) return toast('No hay venta');
        const refund = {
          ...last,
          id: uid(),
          ticketNo: nextTicketNo(),
          date: nowEs(),
          ts: Date.now(),
          dayKey: dateKeyLocal(),
          payMethod: 'devolucion',
          lines: (last.lines || []).map(l => ({ ...l, qty: -Math.abs(l.qty) })),
          total: -Math.abs(last.total),
          noteName: `DEVOLUCIÓN de ${last.ticketNo}`,
          change: 0
        };
        state.openSales.push(refund);
        state.lastSaleId = refund.id;
        save();
        audit('SALE_REFUND', { from: last.ticketNo, refund: refund.ticketNo, total: refund.total });
        toast('Devolución registrada');
        renderReports();
      });
    });

    el.btnPay?.addEventListener('click', () => {
      touchActivity();
      if (state.settings.directPay) {
        // direct pay = open pay modal still recommended for bills/keypad. We keep modal for PRO.
        openPayModal();
      } else {
        openPayModal();
      }
    });

    el.btnPrint?.addEventListener('click', () => {
      touchActivity();
      if (!state.settings.printOn) return toast('Impresión OFF');
      const last = getLastSale();
      if (!last) return toast('No hay ticket');
      printSale(last);
    });

    el.btnLastTicket?.addEventListener('click', () => {
      touchActivity();
      if (!state.settings.printOn) return toast('Impresión OFF');
      const last = getLastSale();
      if (!last) return toast('No hay último ticket');
      printSale(last);
    });

    el.btnEmailTicket?.addEventListener('click', () => { touchActivity(); openModal(el.modalEmail); });

    // click outside inputs -> focus barcode
    document.addEventListener('click', (e) => {
      touchActivity();
      const t = e.target;
      if (!t) return;
      if (t.closest('dialog')) return;
      const tag = t.tagName?.toLowerCase();
      if (['input', 'textarea', 'select', 'button'].includes(tag)) return;
      focusBarcodeSoon();
    });
  }

  function bindProductos() {
    el.btnAddProduct?.addEventListener('click', () => { touchActivity(); openNewProduct(''); });

    el.btnImportCsv?.addEventListener('click', () => { touchActivity(); el.fileCsv?.click(); });
    el.fileCsv?.addEventListener('change', () => {
      touchActivity();
      const f = el.fileCsv.files?.[0];
      if (!f) return;
      importProductsFromCSVFile(f);
      el.fileCsv.value = '';
    });

    el.btnExportCsv?.addEventListener('click', () => { touchActivity(); exportProductsCSV(); });
    el.btnBackupJson?.addEventListener('click', () => { touchActivity(); backupJSON(); });

    el.btnRestoreJson?.addEventListener('click', () => { touchActivity(); el.fileJson?.click(); });
    el.fileJson?.addEventListener('change', () => {
      touchActivity();
      const f = el.fileJson.files?.[0];
      if (!f) return;
      restoreJSONFromFile(f);
      el.fileJson.value = '';
    });

    const rer = debounce(renderProductsTable, 80);
    el.prodSearchName?.addEventListener('input', () => { touchActivity(); rer(); });
    el.prodSearchBarcode?.addEventListener('input', () => { touchActivity(); rer(); });
    el.prodSearchCat?.addEventListener('change', () => { touchActivity(); rer(); });
  }

  function bindReportes() {
    el.btnExportSalesCsv?.addEventListener('click', () => { touchActivity(); exportSalesCSV(); });

    el.btnCloseZ?.addEventListener('click', () => { touchActivity(); openZModal(); });

    el.repPreset?.addEventListener('change', () => { touchActivity(); renderReports(); });
    el.repFrom?.addEventListener('change', () => { touchActivity(); el.repPreset.value = 'custom'; renderReports(); });
    el.repTo?.addEventListener('change', () => { touchActivity(); el.repPreset.value = 'custom'; renderReports(); });
  }

  function bindAjustes() {
    // init inputs
    if (el.setShopName) el.setShopName.value = state.settings.shopName;
    if (el.setShopSub) el.setShopSub.value = state.settings.shopSub;
    if (el.setBoxName) el.setBoxName.value = state.settings.boxName;
    if (el.setFooterText) el.setFooterText.value = state.settings.footerText;

    if (el.setDirectPay) el.setDirectPay.value = state.settings.directPay ? '1' : '0';
    if (el.setPrintOn) el.setPrintOn.value = state.settings.printOn ? '1' : '0';
    if (el.setAutoPrint) el.setAutoPrint.value = state.settings.autoPrint ? '1' : '0';
    if (el.setPrintZ) el.setPrintZ.value = state.settings.printZOnClose ? '1' : '0';

    if (el.setAlwaysScan) el.setAlwaysScan.value = state.settings.alwaysScan ? '1' : '0';
    if (el.setScanSpeed) el.setScanSpeed.value = String(state.settings.scanSpeedMs || 35);

    if (el.setAutoLockMin) el.setAutoLockMin.value = String(state.settings.autoLockMin || 10);

    const apply = debounce(() => {
      state.settings.shopName = el.setShopName?.value || state.settings.shopName;
      state.settings.shopSub = el.setShopSub?.value || state.settings.shopSub;
      state.settings.boxName = el.setBoxName?.value || state.settings.boxName;
      state.settings.footerText = el.setFooterText?.value || state.settings.footerText;

      state.settings.directPay = (el.setDirectPay?.value || '0') === '1';

      state.settings.printOn = (el.setPrintOn?.value || '1') === '1';
      state.settings.autoPrint = (el.setAutoPrint?.value || '0') === '1';
      state.settings.printZOnClose = (el.setPrintZ?.value || '1') === '1';

      state.settings.alwaysScan = (el.setAlwaysScan?.value || '1') === '1';
      state.settings.scanSpeedMs = Math.max(15, Math.min(140, Number(el.setScanSpeed?.value || 35)));

      state.settings.autoLockMin = Math.max(1, Math.min(240, Number(el.setAutoLockMin?.value || 10)));

      save();
      renderHeader();
      toast('Ajustes guardados');
    }, 140);

    el.setShopName?.addEventListener('input', () => { touchActivity(); apply(); });
    el.setShopSub?.addEventListener('input', () => { touchActivity(); apply(); });
    el.setBoxName?.addEventListener('input', () => { touchActivity(); apply(); });
    el.setFooterText?.addEventListener('input', () => { touchActivity(); apply(); });

    el.setDirectPay?.addEventListener('change', () => { touchActivity(); apply(); });

    el.setPrintOn?.addEventListener('change', () => { touchActivity(); apply(); renderPrintToggle(); });
    el.setAutoPrint?.addEventListener('change', () => { touchActivity(); apply(); });
    el.setPrintZ?.addEventListener('change', () => { touchActivity(); apply(); });

    el.setAlwaysScan?.addEventListener('change', () => { touchActivity(); apply(); renderHeader(); });
    el.setScanSpeed?.addEventListener('input', () => { touchActivity(); apply(); });

    el.setAutoLockMin?.addEventListener('input', () => { touchActivity(); apply(); });

    el.setAdminPin?.addEventListener('change', async () => {
      touchActivity();
      requireAdminOrPrompt(async () => {
        const pin = (el.setAdminPin.value || '').trim();
        if (!pin) return;
        if (pin.length < 4) return toast('PIN mínimo 4 dígitos');
        state.settings.adminPinHash = await sha256Hex(pin);
        el.setAdminPin.value = '';
        save();
        toast('PIN admin actualizado');
      });
    });

    el.btnCopyAbout?.addEventListener('click', () => { touchActivity(); copyAbout(); });
  }

  function bindShortcuts() {
    window.addEventListener('keydown', (e) => {
      touchActivity();

      const tag = document.activeElement?.tagName?.toLowerCase();
      const typing = (tag === 'input' || tag === 'textarea' || tag === 'select');

      if (e.key === 'F4') { e.preventDefault(); openPayModal(); return; }
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
        cart.removeLine(cart.active.lines.length - 1);
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

  function bindScannerGlobal() {
    window.addEventListener('keydown', (e) => {
      if (!scanner.enabled()) return;

      // ignore modifiers
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      // ignore when modal open
      if (document.querySelector('dialog[open]')) return;

      const k = e.key;

      // finalize on Enter
      if (k === 'Enter') {
        if (scanner.buf.length >= 4) {
          const code = scanner.buf;
          scanner.reset();
          finalizeScan(code);
        }
        return;
      }

      // Accept typical barcode chars (some include letters)
      if (k.length === 1 && /[0-9A-Za-z]/.test(k)) {
        scanner.pushChar(k);
      }
    });
  }

  /* =========================
     INIT
  ========================== */
  async function init() {
    await ensureDefaultHashes();
    normalizeCategories();

    // Apply theme and defaults
    setTheme(state.settings.theme || 'day');
    renderPrintToggle();

    // Default report dates
    if (el.repFrom && !el.repFrom.value) el.repFrom.value = dateKeyLocal();
    if (el.repTo && !el.repTo.value) el.repTo.value = dateKeyLocal();

    // Bind everything
    bindTabs();
    bindTop();
    bindModals();
    bindVenta();
    bindProductos();
    bindReportes();
    bindAjustes();
    bindShortcuts();
    bindScannerGlobal();

    // Default tab
    setTab('venta');
    focusBarcodeSoon();

    // Render all
    renderAll();

    // Clock + admin lock refresh
    setInterval(() => {
      if (el.ticketDate) el.ticketDate.textContent = nowEs();
      renderAdminState();
    }, 15000);
  }

  init();

})();
```

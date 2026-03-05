/* =========================
TPV NADEEM — B/W PRO (vPRO4 STABLE)
Archivo: app.js  (COMPLETO)

INCLUYE:
✅ Escaneo permanente (global) + input manual
✅ Anti-duplicado real: mismo barcode 2 veces seguidas => NO añade + DOBLE pitido
✅ Si no existe => registrar automático (pide Admin)
✅ Categorías: crear/renombrar/asignar
✅ Venta rápida + aparcar/recuperar
✅ Descuento por ticket (€ / %) con permisos
✅ Editar precio por línea tocando el PVP (con permisos)
✅ Permisos por acción (borrar línea, anular, descuento, editar precio)
✅ Usuarios con PIN individual + cambiar PIN desde Ajustes (Admin)
✅ Reportes: total, efectivo, tarjeta, coste, beneficio, margen
✅ Cierre Z con arqueo: efectivo contado + descuadre (impreso y guardado) + pone a 0
✅ Informe X (no limpia)
✅ Backup JSON + Import/Export CSV (barcode,name,category,price,cost,fav)
✅ Ticket 80mm PRO (recuadros + negritas + totales)
✅ Email ticket (mailto)
✅ Modo Kiosko + salir con Admin

CORRECCIONES IMPORTANTES:
✅ BUG “numpad mete doble número”: solucionado (bind único + guard) + handler robusto con closest()
✅ Evita dobles listeners aunque renderAll se llame varias veces
========================= */

(() => {
  'use strict';

  /* =========================
     HELPERS
  ========================== */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // Mantener key estable para NO perder datos al actualizar
  const LS_KEY = 'TPV_NADEEM_BWPRO_VPRO2';

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

  const escapeHtml = (s) => (s ?? '').toString()
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  const uid = () => 'ID' + Math.random().toString(36).slice(2, 8).toUpperCase() + Date.now().toString(36).slice(-4).toUpperCase();

  async function sha256Hex(str) {
    const enc = new TextEncoder();
    const data = enc.encode(String(str));
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const debounce = (fn, ms = 150) => {
    let t = null;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  };

  /* =========================
     BEEP (WebAudio)
  ========================== */
  const beep = (() => {
    let ctx = null;
    let unlocked = false;

    function ensureCtx() {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      return ctx;
    }

    async function unlock() {
      try {
        const c = ensureCtx();
        if (c.state !== 'running') await c.resume();
        unlocked = true;
      } catch {
        // ignore
      }
    }

    function tone(durationMs = 70, freq = 880, gainVal = 0.06) {
      if (!unlocked) return;
      const c = ensureCtx();
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.value = gainVal;
      o.connect(g);
      g.connect(c.destination);
      o.start();
      setTimeout(() => { try { o.stop(); } catch {} }, durationMs);
    }

    function single() { tone(65, 880, 0.06); }
    function dbl() {
      tone(55, 880, 0.06);
      setTimeout(() => tone(55, 880, 0.06), 95);
    }

    document.addEventListener('click', unlock, { once: true, capture: true });
    document.addEventListener('keydown', unlock, { once: true, capture: true });

    return { single, dbl, unlock };
  })();

  /* =========================
     STATE
  ========================== */
  const seedProducts = () => ([
    { id: 'P1', barcode: '1234567890123', name: 'Plátano', category: 'Fruta', fav: true,  price: 1.89, cost: 1.20 },
    { id: 'P2', barcode: '7894561230123', name: 'Manzana', category: 'Fruta', fav: true,  price: 2.40, cost: 1.50 },
    { id: 'P3', barcode: '2345678901234', name: 'Naranja', category: 'Fruta', fav: true,  price: 1.60, cost: 0.95 },
    { id: 'P4', barcode: '3456789012345', name: 'Tomate',  category: 'Verdura', fav: true, price: 2.10, cost: 1.25 },
    { id: 'P5', barcode: '4567890123456', name: 'Lechuga', category: 'Verdura', fav: true, price: 1.20, cost: 0.70 },
    { id: 'P6', barcode: '5678901234567', name: 'Aguacate', category: 'Tropical', fav: true, price: 3.90, cost: 2.30 },
    { id: 'P7', barcode: '',              name: 'Bolsa',   category: 'Otros', fav: true, price: 0.10, cost: null },
  ]);

  const defaultState = () => ({
    version: 'vPRO4',

    settings: {
      shopName: 'MALIK AHMAD NADEEM',
      shopSub: 'CALLE VITORIA 139 · 09007 BURGOS · TLF 632 480 316 · CIF/DNI 72374062P',
      footerText: 'Gracias por su compra',
      boxName: 'CAJA-1',
      theme: 'day',

      autoPrint: false,
      aggressiveScan: true,
      kiosk: false,

      adminMinutes: 5,
      autoBackupZ: true,

      // Permisos por acción
      permDeleteLine: false,
      permVoid: false,
      permDiscount: true,
      permPriceEdit: true,

      // Admin PIN (se sincroniza con usuario "admin")
      adminPinHash: ''
    },

    session: {
      user: { name: 'CAJERO', role: 'cashier' },
      adminUntil: 0
    },

    // Usuarios (PIN individual en passHash)
    users: [
      { username: 'cajero', passHash: '', role: 'cashier' },
      { username: 'admin',  passHash: '', role: 'admin' }
    ],

    categories: ['Favoritos', 'Fruta', 'Verdura', 'Tropical', 'Otros'],
    selectedCategory: 'Favoritos',

    counters: { ticketSeq: 1, zSeq: 1 },

    products: seedProducts(),

    cart: {
      lines: [],
      note: '',
      payMethod: 'efectivo',
      given: 0,
      discount: { type: 'amount', value: 0 } // descuento por ticket
    },

    parked: [],

    salesOpen: [],
    lastSale: null,

    zHistory: [],

    ui: { prodPage: 1, prodPageSize: 50, prodSort: 'az' },

    pendingRegisterBarcode: null,
    pendingAction: null
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
      const merged = deepMerge(defaultState(), JSON.parse(raw));
      if (!merged.products || !merged.products.length) merged.products = seedProducts();
      if (!merged.categories || !merged.categories.length) merged.categories = ['Favoritos', 'Otros'];
      if (!merged.categories.includes('Favoritos')) merged.categories.unshift('Favoritos');
      if (!merged.selectedCategory || !merged.categories.includes(merged.selectedCategory)) merged.selectedCategory = 'Favoritos';
      if (!merged.cart) merged.cart = defaultState().cart;
      if (!merged.cart.discount) merged.cart.discount = { type: 'amount', value: 0 };
      if (!merged.settings) merged.settings = defaultState().settings;
      if (!merged.users || !merged.users.length) merged.users = defaultState().users;
      return merged;
    } catch {
      return defaultState();
    }
  })();

  const save = debounce(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (e) {
      toast('⚠️ Almacenamiento lleno. Haz Backup JSON.');
      console.warn(e);
    }
  }, 120);

  /* =========================
     DOM REFS
  ========================== */
  const el = {
    // top
    clockTop: $('#clockTop'),
    btnTheme: $('#btnTheme'),
    themeLabel: $('#themeLabel'),
    btnLogin: $('#btnLogin'),
    userLabel: $('#userLabel'),
    btnAdmin: $('#btnAdmin'),
    adminState: $('#adminState'),
    tabsNav: $('#tabsNav'),
    tabs: $$('.tab'),
    pages: $$('.page'),

    // kiosk
    kioskBar: $('#kioskBar'),
    btnExitKiosk: $('#btnExitKiosk'),
    btnExitKiosk2: $('#btnExitKiosk2'),
    btnEnterKiosk: $('#btnEnterKiosk'),

    // venta
    pageVenta: $('#pageVenta'),
    barcodeInput: $('#barcodeInput'),
    searchInput: $('#searchInput'),
    catsBar: $('#catsBar'),
    catSelectedLabel: $('#catSelectedLabel'),
    prodGrid: $('#prodGrid'),
    btnAddCategory: $('#btnAddCategory'),
    btnRenameCategory: $('#btnRenameCategory'),
    btnAddProductInline: $('#btnAddProductInline'),
    btnQuickAmount: $('#btnQuickAmount'),
    btnPark: $('#btnPark'),
    parkBadge: $('#parkBadge'),

    // ticket
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
    btnNumpadGiven: $('#btnNumpadGiven'),
    btnVoid: $('#btnVoid'),
    btnRefund: $('#btnRefund'),
    btnPay: $('#btnPay'),
    btnPrint: $('#btnPrint'),
    btnEmailTicket: $('#btnEmailTicket'),
    btnLastTicket: $('#btnLastTicket'),
    btnDiscount: $('#btnDiscount'),
    discountRow: $('#discountRow'),
    discountValue: $('#discountValue'),

    // reportes
    statTickets: $('#statTickets'),
    statTotal: $('#statTotal'),
    statCash: $('#statCash'),
    statCard: $('#statCard'),
    statCost: $('#statCost'),
    statProfit: $('#statProfit'),
    statMargin: $('#statMargin'),
    salesTable: $('#salesTable'),
    btnPrintX: $('#btnPrintX'),
    btnCloseZ: $('#btnCloseZ'),
    zList: $('#zList'),

    // productos
    productsTable: $('#productsTable'),
    prodSearchName: $('#prodSearchName'),
    prodSearchBarcode: $('#prodSearchBarcode'),
    prodSearchCatSelect: $('#prodSearchCat'),
    prodCount: $('#prodCount'),
    btnProdPrev: $('#btnProdPrev'),
    btnProdNext: $('#btnProdNext'),
    prodPageLabel: $('#prodPageLabel'),
    prodPageSize: $('#prodPageSize'),
    prodSort: $('#prodSort'),
    btnAddProduct: $('#btnAddProduct'),
    btnExportBackup: $('#btnExportBackup'),
    btnImportBackup: $('#btnImportBackup'),
    btnExportCSV: $('#btnExportCSV'),
    btnImportCSV: $('#btnImportCSV'),
    fileImport: $('#fileImport'),
    fileImportCSV: $('#fileImportCSV'),

    // ajustes
    btnAdminUnlock: $('#btnAdminUnlock'),
    setShopName: $('#setShopName'),
    setShopSub: $('#setShopSub'),
    setBoxName: $('#setBoxName'),
    setFooterText: $('#setFooterText'),
    setAutoPrint: $('#setAutoPrint'),
    setAggressiveScan: $('#setAggressiveScan'),
    setAutoBackupZ: $('#setAutoBackupZ'),
    setKiosk: $('#setKiosk'),
    setAdminPin: $('#setAdminPin'),
    setAdminMinutes: $('#setAdminMinutes'),
    btnBackupNow: $('#btnBackupNow'),
    btnRestoreNow: $('#btnRestoreNow'),
    btnFactoryReset: $('#btnFactoryReset'),

    // permisos
    setPermDeleteLine: $('#setPermDeleteLine'),
    setPermVoid: $('#setPermVoid'),
    setPermDiscount: $('#setPermDiscount'),
    setPermPriceEdit: $('#setPermPriceEdit'),

    // users pins
    setUserSelect: $('#setUserSelect'),
    setUserPin: $('#setUserPin'),
    btnUserPinSave: $('#btnUserPinSave'),

    // print + toast + backdrop
    printArea: $('#printArea'),
    toastHost: $('#toastHost'),
    backdrop: $('#backdrop'),

    // modals
    modalLogin: $('#modalLogin'),
    modalAdmin: $('#modalAdmin'),
    modalDiscount: $('#modalDiscount'),
    modalQuick: $('#modalQuick'),
    modalPay: $('#modalPay'),
    modalProduct: $('#modalProduct'),
    modalEmail: $('#modalEmail'),
    modalCategory: $('#modalCategory'),
    modalZ: $('#modalZ'),

    // close buttons
    closeBtns: $$('[data-close]'),

    // login modal
    loginUser: $('#loginUser'),
    loginPass: $('#loginPass'),
    btnLoginOk: $('#btnLoginOk'),

    // admin modal
    adminPin: $('#adminPin'),
    btnAdminOk: $('#btnAdminOk'),

    // discount modal
    discountType: $('#discountType'),
    discountInput: $('#discountInput'),
    btnDiscountOk: $('#btnDiscountOk'),

    // quick modal
    quickAmount: $('#quickAmount'),
    quickName: $('#quickName'),
    btnQuickOk: $('#btnQuickOk'),
    numpadQuick: $('#numpadQuick'),

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
    numpadPay: $('#numpadPay'),

    // product modal
    prodModalTitle: $('#prodModalTitle'),
    prodBarcode: $('#prodBarcode'),
    prodName: $('#prodName'),
    prodCat: $('#prodCat'),
    prodFav: $('#prodFav'),
    prodPrice: $('#prodPrice'),
    prodCost: $('#prodCost'),
    btnProductSave: $('#btnProductSave'),

    // email modal
    emailTo: $('#emailTo'),
    emailMsg: $('#emailMsg'),
    btnEmailSend: $('#btnEmailSend'),

    // category modal
    catModalTitle: $('#catModalTitle'),
    catName: $('#catName'),
    btnCategoryOk: $('#btnCategoryOk'),

    // Z modal (arqueo)
    zPreview: $('#zPreview'),
    zCountedCash: $('#zCountedCash'),
    zDiffCash: $('#zDiffCash'),
    btnZOk: $('#btnZOk'),
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
    setTimeout(() => t.remove(), 1600);
  }

  /* =========================
     MODALS / FOCUS
  ========================== */
  function anyModalOpen() {
    return !!document.querySelector('dialog[open]');
  }

  function openModal(dlg) {
    if (!dlg) return;
    if (el.backdrop) el.backdrop.hidden = false;
    dlg.showModal();
    const f = dlg.querySelector('input,select,textarea,button');
    if (f) setTimeout(() => f.focus(), 30);
  }

  function closeModal(dlg) {
    if (!dlg) return;
    dlg.close();
    if (el.backdrop) el.backdrop.hidden = true;
    focusBarcodeSoon();
  }

  function focusBarcodeSoon() {
    if (!el.barcodeInput) return;
    if (anyModalOpen()) return;
    if (!(el.pageVenta && el.pageVenta.classList.contains('is-active'))) return;
    const a = document.activeElement;
    if (a === el.searchInput) return;
    setTimeout(() => el.barcodeInput.focus(), 25);
  }

  /* =========================
     THEME / TABS
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

  /* =========================
     SECURITY (USERS + ADMIN)
  ========================== */
  function getUser(username) {
    const u = String(username || '').trim().toLowerCase();
    return state.users.find(x => x.username === u) || null;
  }

  async function ensureDefaultHashes() {
    const hDefault = await sha256Hex('1234');

    for (const u of state.users) {
      if (!u.passHash) u.passHash = hDefault;
    }

    const adminUser = getUser('admin');
    if (!state.settings.adminPinHash && adminUser?.passHash) {
      state.settings.adminPinHash = adminUser.passHash;
    }
    if (state.settings.adminPinHash && adminUser && adminUser.passHash !== state.settings.adminPinHash) {
      adminUser.passHash = state.settings.adminPinHash;
    }
    if (!state.settings.adminPinHash) state.settings.adminPinHash = hDefault;

    save();
  }

  function adminUnlocked() {
    return (state.session.adminUntil || 0) > Date.now();
  }

  function renderAdminState() {
    if (el.adminState) el.adminState.textContent = adminUnlocked() ? 'Admin ✓' : 'Admin';
    const on = adminUnlocked();
    if (el.btnAddCategory) el.btnAddCategory.disabled = !on;
    if (el.btnRenameCategory) el.btnRenameCategory.disabled = !on;
    if (el.btnAddProductInline) el.btnAddProductInline.disabled = !on;
  }

  function setAdminUnlocked(minutes = null) {
    const mins = minutes == null ? Number(state.settings.adminMinutes || 5) : Number(minutes);
    state.session.adminUntil = Date.now() + mins * 60 * 1000;
    save();
    renderAdminState();

    if (state.pendingAction) {
      const p = state.pendingAction;
      state.pendingAction = null;
      save();
      try { runPendingAction(p); } catch (e) { console.warn(e); }
    }

    if (state.pendingRegisterBarcode) {
      const code = state.pendingRegisterBarcode;
      state.pendingRegisterBarcode = null;
      save();
      openProductModal(null, code);
    }
  }

  async function verifyAdminPin(pin) {
    const h = await sha256Hex(String(pin || '').trim());
    return h === state.settings.adminPinHash;
  }

  async function login(username, pin) {
    const u = String(username || '').trim().toLowerCase();
    const p = String(pin || '');
    if (!u || !p) return { ok: false, msg: 'Credenciales vacías' };

    const user = getUser(u);
    if (!user) return { ok: false, msg: 'Usuario no existe' };

    const h = await sha256Hex(p);
    if (h !== user.passHash) return { ok: false, msg: 'PIN incorrecto' };

    state.session.user = { name: u.toUpperCase(), role: user.role };
    save();
    renderHeader();

    if (user.role === 'admin') setAdminUnlocked(state.settings.adminMinutes || 5);

    return { ok: true };
  }

  function requireAdminIf(flag, actionType, payload, message) {
    if (!flag) return true;
    if (adminUnlocked()) return true;
    state.pendingAction = { type: actionType, payload };
    save();
    openModal(el.modalAdmin);
    toast(message || 'PIN admin requerido');
    return false;
  }

  function runPendingAction(p) {
    if (!p || !p.type) return;
    const type = p.type;
    const payload = p.payload || {};

    if (type === 'DELETE_LINE') cartRemove(payload.idx);
    if (type === 'VOID_TICKET') cartClear();
    if (type === 'APPLY_DISCOUNT') applyDiscount(payload.type, payload.value);
    if (type === 'EDIT_LINE_PRICE') doEditLinePrice(payload.idx);
    if (type === 'SAVE_USER_PIN') doSaveUserPin(payload.username, payload.newPin);
  }

  /* =========================
     KIOSK MODE
  ========================== */
  function applyKioskUI() {
    const on = !!state.settings.kiosk;
    if (el.kioskBar) el.kioskBar.hidden = !on;
    if (el.tabsNav) el.tabsNav.style.display = on ? 'none' : '';
    if (on) setTab('venta');
  }

  async function enterKiosk() {
    state.settings.kiosk = true;
    save();
    applyKioskUI();
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      toast('Kiosko ON');
    } catch {
      toast('Kiosko ON (fullscreen bloqueado)');
    }
    focusBarcodeSoon();
  }

  async function exitKiosk() {
    if (!adminUnlocked()) {
      openModal(el.modalAdmin);
      toast('PIN admin requerido');
      return;
    }
    state.settings.kiosk = false;
    save();
    applyKioskUI();
    try { if (document.fullscreenElement) await document.exitFullscreen(); } catch {}
    toast('Kiosko OFF');
    focusBarcodeSoon();
  }

  /* =========================
     CATEGORIES
  ========================== */
  const normalizeCat = (name) => String(name || '').trim().replace(/\s+/g, ' ');
  const catExists = (name) => state.categories.some(c => c.toLowerCase() === normalizeCat(name).toLowerCase());

  function addCategory(name) {
    const n = normalizeCat(name);
    if (!n) return { ok: false, msg: 'Nombre vacío' };
    if (n.toLowerCase() === 'favoritos') return { ok: false, msg: '“Favoritos” reservado' };
    if (catExists(n)) return { ok: false, msg: 'Ya existe' };
    state.categories.push(n);
    save();
    return { ok: true };
  }

  function renameCategory(oldName, newName) {
    const oldN = normalizeCat(oldName);
    const newN = normalizeCat(newName);
    if (!newN) return { ok: false, msg: 'Nuevo nombre vacío' };
    if (oldN.toLowerCase() === 'favoritos') return { ok: false, msg: 'No se renombra “Favoritos”' };
    if (catExists(newN)) return { ok: false, msg: 'Ya existe ese nombre' };

    state.categories = state.categories.map(c => (c === oldN ? newN : c));
    state.products.forEach(p => { if ((p.category || '') === oldN) p.category = newN; });
    if (state.selectedCategory === oldN) state.selectedCategory = newN;
    save();
    return { ok: true };
  }

  function renderCategories() {
    if (!el.catsBar) return;
    el.catsBar.innerHTML = '';

    if (!state.categories.includes('Favoritos')) state.categories.unshift('Favoritos');

    const cats = state.categories.slice();
    cats.sort((a, b) => (a === 'Favoritos' ? -1 : b === 'Favoritos' ? 1 : a.localeCompare(b, 'es')));

    for (const c of cats) {
      const b = document.createElement('button');
      b.className = 'cat' + (state.selectedCategory === c ? ' is-active' : '');
      b.type = 'button';
      b.textContent = c;
      b.addEventListener('click', () => {
        state.selectedCategory = c;
        save();
        renderCategories();
        renderProductsGrid();
      });
      el.catsBar.appendChild(b);
    }

    if (el.catSelectedLabel) el.catSelectedLabel.textContent = `Productos · ${state.selectedCategory}`;
  }

  function syncCategorySelectOptions(selectEl, includeAll = false) {
    if (!selectEl) return;
    const cats = state.categories.filter(c => c !== 'Favoritos').slice().sort((a, b) => a.localeCompare(b, 'es'));
    selectEl.innerHTML = '';

    if (includeAll) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Todas';
      selectEl.appendChild(opt);
    }
    for (const c of cats) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      selectEl.appendChild(opt);
    }
  }

  /* =========================
     PRODUCTS
  ========================== */
  function findByBarcode(code) {
    const c = String(code || '').trim();
    if (!c) return null;
    return state.products.find(p => String(p.barcode || '').trim() === c) || null;
  }

  function productMatchesCategory(p) {
    const cat = state.selectedCategory;
    if (cat === 'Favoritos') return !!p.fav;
    return (p.category || 'Otros') === cat;
  }

  function filteredProductsForGrid() {
    const q = String(el.searchInput?.value || '').trim().toLowerCase();
    let items = state.products.filter(productMatchesCategory);
    if (q) items = items.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      String(p.barcode || '').includes(q)
    );
    items.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));
    return items.slice(0, 120);
  }

  function makeProdBtn(name, priceText, meta, tag, onClick) {
    const b = document.createElement('button');
    b.className = 'pbtn';
    b.type = 'button';
    b.innerHTML = `
      <div class="pname">${escapeHtml(name)}</div>
      <div class="pprice">${escapeHtml(priceText)}</div>
      ${tag ? `<div class="tag">${escapeHtml(tag)}</div>` : ``}
      <div class="pmeta">${escapeHtml(meta || '')}</div>
    `;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderProductsGrid() {
    if (!el.prodGrid) return;
    el.prodGrid.innerHTML = '';

    el.prodGrid.appendChild(makeProdBtn('Importe rápido', 'Manual', 'Teclado', 'F2', () => openQuickModal()));

    const items = filteredProductsForGrid();
    for (const p of items) {
      el.prodGrid.appendChild(makeProdBtn(
        p.name,
        fmtEUR(p.price || 0),
        p.barcode ? `BC: ${p.barcode}` : 'Manual',
        p.fav ? '★' : '',
        () => cartAddProduct(p, 1, 'tap')
      ));
    }
  }

  function openProductModal(product = null, preBarcode = '') {
    if (!adminUnlocked()) {
      state.pendingRegisterBarcode = preBarcode || null;
      save();
      openModal(el.modalAdmin);
      toast('PIN admin requerido para registrar');
      return;
    }

    el.modalProduct.dataset.editId = product?.id || '';
    if (el.prodModalTitle) el.prodModalTitle.textContent = product ? 'Editar producto' : 'Nuevo producto';

    syncCategorySelectOptions(el.prodCat, false);

    el.prodBarcode.value = product ? (product.barcode || '') : (preBarcode || '');
    el.prodName.value = product ? (product.name || '') : '';
    el.prodCat.value = product ? (product.category || 'Otros') : (state.categories.includes('Otros') ? 'Otros' : (state.categories.find(c => c !== 'Favoritos') || 'Otros'));
    el.prodFav.value = product && product.fav ? '1' : '0';
    el.prodPrice.value = product ? fmtMoney(product.price || 0).replace('.', ',') : '';
    el.prodCost.value  = product && product.cost != null ? fmtMoney(product.cost).replace('.', ',') : '';

    openModal(el.modalProduct);
    setTimeout(() => el.prodName?.focus(), 60);
  }

  function saveProductFromModal() {
    const editId = el.modalProduct.dataset.editId || '';
    const barcode = String(el.prodBarcode.value || '').trim();
    const name = String(el.prodName.value || '').trim();
    const category = String(el.prodCat.value || 'Otros').trim();
    const fav = (el.prodFav.value || '0') === '1';
    const price = parseMoney(el.prodPrice.value || '0');
    const costRaw = String(el.prodCost.value || '').trim();
    const cost = costRaw ? parseMoney(costRaw) : null;

    if (!name) return toast('Falta nombre');
    if (!(price >= 0)) return toast('Precio inválido');
    if (!state.categories.includes(category)) return toast('Categoría inválida');

    if (barcode) {
      const exists = state.products.find(p => p.barcode === barcode && p.id !== editId);
      if (exists) return toast('Ese barcode ya existe');
    }

    if (editId) {
      const p = state.products.find(x => x.id === editId);
      if (!p) return toast('Producto no encontrado');
      p.barcode = barcode;
      p.name = name;
      p.category = category;
      p.fav = fav;
      p.price = price;
      p.cost = cost;
    } else {
      state.products.push({ id: 'P-' + uid(), barcode, name, category, fav, price, cost });
    }

    save();
    closeModal(el.modalProduct);
    renderProductsGrid();
    renderProductsTable();
    toast('Producto guardado');
    focusBarcodeSoon();
  }

  /* =========================
     CART + DISCOUNT
  ========================== */
  function calcDiscountAmount(subtotal) {
    const d = state.cart.discount || { type: 'amount', value: 0 };
    const val = Number(d.value || 0);
    let amt = 0;
    if (d.type === 'percent') amt = subtotal * (val / 100);
    else amt = val;
    if (!Number.isFinite(amt)) amt = 0;
    amt = Math.max(0, Math.min(subtotal, amt));
    return amt;
  }

  function cartTotals() {
    const subtotal = state.cart.lines.reduce((s, l) => s + (Number(l.price) * Number(l.qty || 0)), 0);
    const discAmt = calcDiscountAmount(subtotal);
    const total = Math.max(0, subtotal - discAmt);
    return { subtotal, discount: discAmt, total };
  }

  function cartAddProduct(p, qty = 1, src = '') {
    const key = p.id || p.barcode || p.name;
    const idx = state.cart.lines.findIndex(l => l.key === key && !l.isManual);
    if (idx >= 0) state.cart.lines[idx].qty += qty;
    else {
      state.cart.lines.push({
        key,
        productId: p.id || null,
        barcode: p.barcode || '',
        name: p.name,
        price: Number(p.price || 0),
        cost: p.cost == null ? null : Number(p.cost),
        qty,
        isManual: false
      });
    }
    save();
    renderTicket();

    // Feedback
    if (src === 'scan') beep.single();
  }

  function cartAddManual(amount, name) {
    const v = Number(amount || 0);
    if (!(v > 0)) return;
    state.cart.lines.push({
      key: 'M-' + uid(),
      productId: null,
      barcode: '',
      name: String(name || 'Importe').trim() || 'Importe',
      price: v,
      cost: null,
      qty: 1,
      isManual: true
    });
    save();
    renderTicket();
  }

  function cartRemove(i) {
    state.cart.lines.splice(i, 1);
    save();
    renderTicket();
  }

  function cartSetQty(i, qty) {
    const q = Math.max(0, Math.floor(Number(qty || 0)));
    if (q <= 0) return cartRemove(i);
    state.cart.lines[i].qty = q;
    save();
    renderTicket();
  }

  function cartIncQty(i, d) {
    const l = state.cart.lines[i];
    if (!l) return;
    cartSetQty(i, (l.qty || 0) + d);
  }

  function cartClear() {
    state.cart = { lines: [], note: '', payMethod: 'efectivo', given: 0, discount: { type: 'amount', value: 0 } };
    save();
    renderTicket();
    focusBarcodeSoon();
  }

  function applyDiscount(type, value) {
    const v = parseMoney(value);
    state.cart.discount = { type, value: v };
    save();
    renderTicket();
    toast('Descuento aplicado');
  }

  /* =========================
     TICKET RENDER + PRICE EDIT
  ========================== */
  function renderHeader() {
    setTheme(state.settings.theme || 'day');

    if (el.userLabel) el.userLabel.textContent = state.session.user?.name || 'CAJERO';
    if (el.posUser) el.posUser.textContent = state.session.user?.name || 'CAJERO';
    if (el.posBox) el.posBox.textContent = state.settings.boxName || 'CAJA-1';

    if (el.shopName) el.shopName.textContent = state.settings.shopName;
    if (el.shopSub) el.shopSub.textContent = state.settings.shopSub;

    if (el.ticketDate) el.ticketDate.textContent = nowEs();
    const seq = state.counters.ticketSeq || 1;
    if (el.ticketNo) el.ticketNo.textContent = `T-${String(seq).padStart(6, '0')}`;

    renderAdminState();
    applyKioskUI();
    renderParkBadge();
  }

  function renderParkBadge() {
    if (!el.parkBadge) return;
    if (state.parked.length) {
      el.parkBadge.hidden = false;
      el.parkBadge.textContent = String(state.parked.length);
    } else el.parkBadge.hidden = true;
  }

  function doEditLinePrice(idx) {
    const l = state.cart.lines[idx];
    if (!l) return;
    const cur = fmtMoney(l.price).replace('.', ',');
    const nv = prompt(`Nuevo PVP para "${l.name}"`, cur);
    if (nv == null) return;
    const p = parseMoney(nv);
    if (!(p >= 0)) return toast('Precio inválido');
    l.price = p;
    save();
    renderTicket();
    toast('Precio actualizado');
  }

  function requestEditLinePrice(idx) {
    const need = !!state.settings.permPriceEdit;
    if (!requireAdminIf(need, 'EDIT_LINE_PRICE', { idx }, 'PIN admin requerido para editar precio')) return;
    doEditLinePrice(idx);
  }

  function requestDeleteLine(idx) {
    const need = !!state.settings.permDeleteLine;
    if (!requireAdminIf(need, 'DELETE_LINE', { idx }, 'PIN admin requerido para borrar línea')) return;
    cartRemove(idx);
  }

  function renderTicket() {
    renderHeader();

    const thead = el.ticketLines?.querySelector('.trow.thead');
    if (!thead || !el.ticketLines) return;

    el.ticketLines.innerHTML = '';
    el.ticketLines.appendChild(thead);

    state.cart.lines.forEach((l, idx) => {
      const row = document.createElement('div');
      row.className = 'trow';
      row.innerHTML = `
        <div class="tcell">
          <div>
            <div class="line-name">${escapeHtml(l.name)}</div>
            <div class="line-sub mono">${escapeHtml(l.barcode ? ('BC: ' + l.barcode) : 'Manual')}</div>
          </div>
        </div>
        <div class="tcell tcell-center">
          <div class="qty">
            <button class="qty-btn" type="button">−</button>
            <input class="qty-in" value="${escapeHtml(l.qty)}" inputmode="numeric" />
            <button class="qty-btn" type="button">+</button>
          </div>
        </div>
        <div class="tcell tcell-right mono price-cell" title="Click para editar precio">${fmtMoney(l.price)}</div>
        <div class="tcell tcell-right mono">${fmtMoney(l.price * l.qty)}</div>
      `;

      const btnMinus = row.querySelectorAll('.qty-btn')[0];
      const btnPlus  = row.querySelectorAll('.qty-btn')[1];
      const qtyIn    = row.querySelector('.qty-in');
      const priceCell = row.querySelector('.price-cell');

      btnMinus.addEventListener('click', () => cartIncQty(idx, -1));
      btnPlus.addEventListener('click',  () => cartIncQty(idx, +1));

      qtyIn.addEventListener('change', () => cartSetQty(idx, qtyIn.value));
      qtyIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); qtyIn.blur(); focusBarcodeSoon(); }
      });

      priceCell.addEventListener('click', () => requestEditLinePrice(idx));

      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        requestDeleteLine(idx);
      });

      el.ticketLines.appendChild(row);
    });

    const { subtotal, discount, total } = cartTotals();

    if (el.linesCount) el.linesCount.textContent = String(state.cart.lines.length);
    if (el.subTotal) el.subTotal.textContent = fmtEUR(subtotal);

    if (el.discountRow && el.discountValue) {
      if (discount > 0.0001) {
        el.discountRow.hidden = false;
        el.discountValue.textContent = `- ${fmtEUR(discount)}`;
      } else {
        el.discountRow.hidden = true;
        el.discountValue.textContent = `0,00 €`;
      }
    }

    if (el.grandTotal) el.grandTotal.textContent = fmtEUR(total);

    const method = state.cart.payMethod || 'efectivo';
    const given = parseMoney(el.givenInput?.value || state.cart.given);
    const change = (method === 'efectivo') ? Math.max(0, given - total) : 0;
    if (el.changeInput) el.changeInput.value = fmtMoney(change);

    if (el.noteName && el.noteName.value !== state.cart.note) el.noteName.value = state.cart.note || '';

    renderReports();
  }

  /* =========================
     DISCOUNT MODAL
  ========================== */
  function openDiscountModal() {
    const need = !!state.settings.permDiscount;
    if (!adminUnlocked() && need) {
      state.pendingAction = { type: 'APPLY_DISCOUNT', payload: { type: el.discountType?.value || 'amount', value: el.discountInput?.value || '' } };
      save();
      openModal(el.modalAdmin);
      toast('PIN admin requerido para descuento');
      return;
    }

    const d = state.cart.discount || { type: 'amount', value: 0 };
    if (el.discountType) el.discountType.value = d.type || 'amount';
    if (el.discountInput) el.discountInput.value = d.value ? fmtMoney(d.value).replace('.', ',') : '';
    openModal(el.modalDiscount);
  }

  function confirmDiscount() {
    const type = el.discountType?.value || 'amount';
    const valRaw = el.discountInput?.value || '0';
    const need = !!state.settings.permDiscount;
    if (!requireAdminIf(need, 'APPLY_DISCOUNT', { type, value: valRaw }, 'PIN admin requerido para descuento')) return;
    applyDiscount(type, valRaw);
    closeModal(el.modalDiscount);
  }

  /* =========================
     PAY FLOW
  ========================== */
  function openQuickModal() {
    el.quickAmount.value = '';
    el.quickName.value = '';
    openModal(el.modalQuick);
  }

  function openPayModal() {
    const { total } = cartTotals();
    if (!(total > 0)) return toast('No hay líneas');

    el.payTotal.textContent = fmtEUR(total);
    el.payNote.value = state.cart.note || '';
    el.payMethod.value = state.cart.payMethod || 'efectivo';

    el.payGiven.value = (el.givenInput?.value || '').trim();
    el.payCash.value = '';
    el.payCard.value = '';

    syncPayUI();
    calcPayChange();
    setNumpadTarget(el.numpadPay, 'payGiven');

    openModal(el.modalPay);
  }

  function syncPayUI() {
    const m = el.payMethod.value;
    const isCash = m === 'efectivo';
    const isCard = m === 'tarjeta';
    const isMix  = m === 'mixto';

    el.paySplitWrap.hidden = !isMix;
    el.payGivenWrap.style.display  = (isCash || isMix) ? '' : 'none';
    el.payChangeWrap.style.display = (isCash || isMix) ? '' : 'none';

    if (isCard) {
      el.payGiven.value = '';
      el.payChange.value = '0,00';
    }

    if (isMix) setNumpadTarget(el.numpadPay, 'payCash');
    if (isCash) setNumpadTarget(el.numpadPay, 'payGiven');
  }

  function calcPayChange() {
    const { total } = cartTotals();
    const m = el.payMethod.value;

    if (m === 'efectivo') {
      const given = parseMoney(el.payGiven.value || '0');
      el.payChange.value = fmtMoney(Math.max(0, given - total));
      return;
    }
    if (m === 'mixto') {
      const card = parseMoney(el.payCard.value || '0');
      const cash = parseMoney(el.payCash.value || '0');
      const remaining = Math.max(0, total - card);
      const change = Math.max(0, cash - remaining);
      el.payChange.value = fmtMoney(change);
      return;
    }
    el.payChange.value = '0,00';
  }

  function confirmPay() {
    const { subtotal, discount, total } = cartTotals();
    const method = el.payMethod.value;
    const note = (el.payNote.value || '').trim();

    let given = 0, cashAmount = 0, cardAmount = 0;

    if (method === 'efectivo') {
      given = parseMoney(el.payGiven.value || '0');
      if (given < total && !confirm('Entregado menor que total. ¿Confirmar igualmente?')) return;
    } else if (method === 'tarjeta') {
      given = 0;
    } else {
      cashAmount = parseMoney(el.payCash.value || '0');
      cardAmount = parseMoney(el.payCard.value || '0');
      given = cashAmount;
      if ((cashAmount + cardAmount) < total && !confirm('Mixto: suma menor que total. ¿Confirmar igualmente?')) return;
    }

    const sale = saveSale({ payMethod: method, given, cashAmount, cardAmount, note, subtotal, discount, total });
    if (!sale) return toast('Error al guardar venta');

    closeModal(el.modalPay);
    toast(`Venta OK · ${sale.ticketNo}`);

    if (state.settings.autoPrint) printSale(sale);
    else if (confirm('¿Imprimir ticket?')) printSale(sale);

    cartClear();
  }

  /* =========================
     SALES / REPORTS / PROFIT
  ========================== */
  function nextTicketNo() {
    const n = state.counters.ticketSeq || 1;
    state.counters.ticketSeq = n + 1;
    save();
    return `T-${String(n).padStart(6, '0')}`;
  }

  function saveSale({ payMethod, given, cashAmount, cardAmount, note, subtotal, discount, total }) {
    if (!(total > 0)) return null;

    const sale = {
      id: uid(),
      ticketNo: nextTicketNo(),
      date: nowEs(),
      box: state.settings.boxName,
      user: state.session.user.name,

      payMethod,
      given: Number(given || 0),
      change: 0,
      note: String(note || '').trim(),

      subtotal: Number(subtotal || 0),
      discount: Number(discount || 0),
      total: Number(total || 0),

      split: payMethod === 'mixto' ? { cash: Number(cashAmount || 0), card: Number(cardAmount || 0) } : null,

      lines: state.cart.lines.map(l => ({
        name: l.name,
        barcode: l.barcode || '',
        qty: Number(l.qty || 0),
        price: Number(l.price || 0),
        cost: l.cost == null ? null : Number(l.cost)
      }))
    };

    if (payMethod === 'efectivo') {
      sale.change = Math.max(0, sale.given - sale.total);
    } else if (payMethod === 'mixto') {
      const cash = Number(cashAmount || 0);
      const card = Number(cardAmount || 0);
      const remaining = Math.max(0, sale.total - card);
      sale.change = Math.max(0, cash - remaining);
    }

    state.salesOpen.push(sale);
    state.lastSale = sale;
    save();
    return sale;
  }

  function calcOpenTotals() {
    const tickets = state.salesOpen.length;
    const total = state.salesOpen.reduce((s, x) => s + (Number(x.total) || 0), 0);

    const cash = state.salesOpen.reduce((s, x) => {
      if (x.payMethod === 'efectivo') return s + (Number(x.total) || 0);
      if (x.payMethod === 'mixto') return s + (Number(x.split?.cash) || 0);
      return s;
    }, 0);

    const card = state.salesOpen.reduce((s, x) => {
      if (x.payMethod === 'tarjeta') return s + (Number(x.total) || 0);
      if (x.payMethod === 'mixto') return s + (Number(x.split?.card) || 0);
      return s;
    }, 0);

    const cost = state.salesOpen.reduce((s, x) => {
      const c = (x.lines || []).reduce((sum, l) => {
        if (l.cost == null) return sum;
        return sum + (Number(l.cost) * Number(l.qty || 0));
      }, 0);
      return s + c;
    }, 0);

    const profit = total - cost;
    const margin = total > 0 ? (profit / total) * 100 : 0;

    return { tickets, total, cash, card, cost, profit, margin };
  }

  function renderReports() {
    const r = calcOpenTotals();

    if (el.statTickets) el.statTickets.textContent = String(r.tickets);
    if (el.statTotal) el.statTotal.textContent = fmtEUR(r.total);
    if (el.statCash) el.statCash.textContent = fmtEUR(r.cash);
    if (el.statCard) el.statCard.textContent = fmtEUR(r.card);
    if (el.statCost) el.statCost.textContent = fmtEUR(r.cost);
    if (el.statProfit) el.statProfit.textContent = fmtEUR(r.profit);
    if (el.statMargin) el.statMargin.textContent = r.margin.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';

    const thead = el.salesTable?.querySelector('.trow.thead');
    if (thead && el.salesTable) {
      el.salesTable.innerHTML = '';
      el.salesTable.appendChild(thead);

      const last = state.salesOpen.slice(-60).reverse();
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
        row.querySelector('button').addEventListener('click', () => printSale(s));
        el.salesTable.appendChild(row);
      }
    }

    renderZHistory();
  }

  /* =========================
     PRODUCTS TABLE (PRO)
  ========================== */
  function renderProductsTable() {
    if (!el.productsTable) return;

    syncCategorySelectOptions(el.prodSearchCatSelect, true);

    const qName = String(el.prodSearchName?.value || '').trim().toLowerCase();
    const qBar  = String(el.prodSearchBarcode?.value || '').trim();
    const qCat  = String(el.prodSearchCatSelect?.value || '').trim();

    let items = state.products.slice();
    if (qName) items = items.filter(p => (p.name || '').toLowerCase().includes(qName));
    if (qBar)  items = items.filter(p => String(p.barcode || '').includes(qBar));
    if (qCat)  items = items.filter(p => (p.category || 'Otros') === qCat);

    items.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));
    if ((state.ui.prodSort || 'az') === 'za') items.reverse();

    if (el.prodCount) el.prodCount.textContent = String(items.length);

    const pageSize = Number(state.ui.prodPageSize || 50);
    const pages = Math.max(1, Math.ceil(items.length / pageSize));
    state.ui.prodPage = Math.min(Math.max(1, Number(state.ui.prodPage || 1)), pages);

    const start = (state.ui.prodPage - 1) * pageSize;
    const pageItems = items.slice(start, start + pageSize);

    if (el.prodPageLabel) el.prodPageLabel.textContent = `${state.ui.prodPage}/${pages}`;
    if (el.btnProdPrev) el.btnProdPrev.disabled = state.ui.prodPage <= 1;
    if (el.btnProdNext) el.btnProdNext.disabled = state.ui.prodPage >= pages;

    const thead = el.productsTable.querySelector('.trow.thead');
    el.productsTable.innerHTML = '';
    el.productsTable.appendChild(thead);

    for (const p of pageItems) {
      const price = Number(p.price || 0);
      const cost = (p.cost == null ? null : Number(p.cost));
      const benef = (cost == null ? null : (price - cost));
      const margin = (benef == null || price <= 0 ? null : (benef / price) * 100);

      const row = document.createElement('div');
      row.className = 'trow';
      row.innerHTML = `
        <div class="tcell">
          <div>
            <div class="line-name">${escapeHtml(p.name)}</div>
            <div class="line-sub muted">${p.fav ? '★ Favorito' : ''}</div>
          </div>
        </div>
        <div class="tcell mono">${escapeHtml(p.barcode || '—')}</div>
        <div class="tcell">${escapeHtml(p.category || 'Otros')}</div>
        <div class="tcell tcell-right mono">${fmtMoney(price)}</div>
        <div class="tcell tcell-right mono">${cost == null ? '—' : fmtMoney(cost)}</div>
        <div class="tcell tcell-right mono">${benef == null ? '—' : fmtMoney(benef)}</div>
        <div class="tcell tcell-right mono">${margin == null ? '—' : margin.toLocaleString('es-ES',{minimumFractionDigits:1,maximumFractionDigits:1}) + ' %'}</div>
        <div class="tcell tcell-center">${p.fav ? '<span class="badge badge-ok">Sí</span>' : '<span class="badge">No</span>'}</div>
        <div class="tcell tcell-right" style="gap:8px;justify-content:flex-end;">
          <button class="btn btn-ghost btn-small" type="button">Editar</button>
          <button class="btn btn-ghost btn-small" type="button">Borrar</button>
        </div>
      `;

      const [btnEdit, btnDel] = row.querySelectorAll('button');
      btnEdit.addEventListener('click', () => openProductModal(p, ''));

      btnDel.addEventListener('click', () => {
        if (!adminUnlocked()) { openModal(el.modalAdmin); return toast('PIN admin requerido'); }
        if (!confirm(`¿Borrar producto "${p.name}"?`)) return;
        state.products = state.products.filter(x => x.id !== p.id);
        save();
        renderProductsTable();
        renderProductsGrid();
        toast('Producto borrado');
      });

      el.productsTable.appendChild(row);
    }

    save();
  }

  /* =========================
     BACKUP JSON
  ========================== */
  function downloadFile(filename, mime, content) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportBackupJSON() {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadFile(`TPV_NADEEM_BACKUP_${stamp}.json`, 'application/json', JSON.stringify(state, null, 2));
  }

  function importBackupJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || '{}'));
        state = deepMerge(defaultState(), data);
        if (!state.products || !state.products.length) state.products = seedProducts();
        if (!state.categories.includes('Favoritos')) state.categories.unshift('Favoritos');
        if (!state.selectedCategory || !state.categories.includes(state.selectedCategory)) state.selectedCategory = 'Favoritos';
        if (!state.cart.discount) state.cart.discount = { type: 'amount', value: 0 };
        save();
        renderAll();
        toast('Backup importado');
      } catch (e) {
        console.warn(e);
        toast('JSON inválido');
      }
    };
    reader.readAsText(file);
  }

  function factoryReset() {
    if (!confirm('¿Borrar TODO el TPV?')) return;
    localStorage.removeItem(LS_KEY);
    state = defaultState();
    save();
    renderAll();
    toast('Reset completo');
  }

  /* =========================
     CSV IMPORT/EXPORT (CATALOGO)
  ========================== */
  function csvEscape(v) {
    const s = String(v ?? '');
    if (/[,"\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  }

  function exportCSV() {
    const header = ['barcode','name','category','price','cost','fav'];
    const lines = [header.join(',')];

    const items = state.products.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'','es'));
    for (const p of items) {
      lines.push([
        csvEscape(p.barcode || ''),
        csvEscape(p.name || ''),
        csvEscape(p.category || 'Otros'),
        csvEscape(fmtMoney(Number(p.price || 0)).replace('.', ',')),
        csvEscape(p.cost == null ? '' : fmtMoney(Number(p.cost)).replace('.', ',')),
        csvEscape(p.fav ? '1' : '0')
      ].join(','));
    }

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadFile(`TPV_NADEEM_CATALOGO_${stamp}.csv`, 'text/csv', lines.join('\n'));
  }

  function parseCSV(text) {
    const rows = [];
    let i = 0, field = '', row = [], inQuotes = false;

    while (i < text.length) {
      const c = text[i];

      if (inQuotes) {
        if (c === '"') {
          if (text[i+1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }

      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field=''; i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row=[]; field=''; i++; continue; }
      if (c === '\r') { i++; continue; }

      field += c; i++;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function truthy(v) {
    const s = String(v || '').trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'si' || s === 'sí';
  }

  function importCSV(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const rows = parseCSV(text).filter(r => r.some(x => String(x||'').trim() !== ''));
        if (!rows.length) return toast('CSV vacío');

        const header = rows[0].map(h => String(h||'').trim().toLowerCase());
        const idx = (name) => header.indexOf(name);

        const iBarcode = idx('barcode');
        const iName = idx('name');
        const iCat = idx('category');
        const iPrice = idx('price');
        const iCost = idx('cost');
        const iFav = idx('fav');

        if (iName < 0 || iPrice < 0) return toast('CSV: faltan columnas (name, price)');

        let added = 0, updated = 0;

        for (let r = 1; r < rows.length; r++) {
          const row = rows[r];
          const barcode = iBarcode >= 0 ? String(row[iBarcode]||'').trim() : '';
          const name = String(row[iName]||'').trim();
          if (!name) continue;

          const category = iCat >= 0 ? (String(row[iCat]||'').trim() || 'Otros') : 'Otros';
          const price = parseMoney(iPrice >= 0 ? row[iPrice] : '0');
          const costRaw = iCost >= 0 ? String(row[iCost]||'').trim() : '';
          const cost = costRaw ? parseMoney(costRaw) : null;
          const fav = iFav >= 0 ? truthy(row[iFav]) : false;

          if (category && category.toLowerCase() !== 'favoritos' && !state.categories.includes(category)) {
            state.categories.push(category);
          }

          let p = null;
          if (barcode) p = state.products.find(x => String(x.barcode||'').trim() === barcode) || null;

          if (p) {
            p.name = name;
            p.category = category;
            p.price = price;
            p.cost = cost;
            p.fav = fav;
            updated++;
          } else {
            state.products.push({
              id: 'P-' + uid(),
              barcode,
              name,
              category,
              price,
              cost,
              fav
            });
            added++;
          }
        }

        save();
        renderCategories();
        renderProductsGrid();
        renderProductsTable();
        toast(`CSV importado: +${added} / actualizado ${updated}`);
      } catch (e) {
        console.warn(e);
        toast('CSV inválido');
      }
    };
    reader.readAsText(file);
  }

  /* =========================
     PRINT / EMAIL (Ticket 80mm PRO)
  ========================== */
  function buildTicketHTML(s) {
    const linesHtml = (s.lines || []).map(l => {
      const totalLine = Number(l.price) * Number(l.qty);
      return `
        <div class="box">
          <div class="row">
            <div class="left bold">${escapeHtml(l.name)}</div>
            <div class="bold">${fmtMoney(totalLine)} €</div>
          </div>
          <div class="row small">
            <div class="left">${escapeHtml(String(l.qty))} x ${fmtMoney(l.price)} €</div>
            <div>${escapeHtml(l.barcode ? ('BC ' + l.barcode) : '')}</div>
          </div>
        </div>
      `;
    }).join('');

    const discountBlock = (s.discount && s.discount > 0.0001)
      ? `<div class="row"><div class="bold">DESCUENTO</div><div class="bold">- ${fmtMoney(s.discount)} €</div></div>`
      : '';

    const payInfo = `
      <div class="box">
        <div class="row"><div class="bold">PAGO</div><div class="bold">${escapeHtml(s.payMethod)}</div></div>
        ${(s.payMethod === 'efectivo' || s.payMethod === 'mixto') ? `<div class="row"><div>Entregado</div><div>${fmtMoney(s.given || 0)} €</div></div>` : ``}
        ${(s.payMethod === 'efectivo' || s.payMethod === 'mixto') ? `<div class="row"><div>Cambio</div><div>${fmtMoney(s.change || 0)} €</div></div>` : ``}
      </div>
    `;

    return `
      <div class="p80">
        <div class="box center">
          <div class="bold">${escapeHtml(state.settings.shopName)}</div>
          <div class="small">${escapeHtml(state.settings.shopSub)}</div>
        </div>

        <div class="box">
          <div class="row"><div class="bold">${escapeHtml(s.ticketNo)}</div><div class="bold">${escapeHtml(s.date)}</div></div>
          <div class="row small"><div>Caja: ${escapeHtml(s.box)}</div><div>Cajero: ${escapeHtml(s.user)}</div></div>
        </div>

        ${linesHtml}

        <div class="totals">
          <div class="row"><div class="bold">SUBTOTAL</div><div class="bold">${fmtMoney(s.subtotal ?? s.total)} €</div></div>
          ${discountBlock}
          <div class="line"></div>
          <div class="row grand"><div class="bold">TOTAL</div><div class="bold">${fmtMoney(s.total)} €</div></div>
          <div class="small center">IVA incluido en los precios</div>
        </div>

        ${payInfo}

        ${s.note ? `<div class="box"><div class="bold">NOTA</div><div>${escapeHtml(s.note)}</div></div>` : ``}

        <div class="box center">
          <div class="bold">${escapeHtml(state.settings.footerText)}</div>
        </div>
      </div>
    `;
  }

  function printSale(sale) {
    if (!el.printArea) return;
    el.printArea.innerHTML = buildTicketHTML(sale);
    window.print();
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
    out.push(`SUBTOTAL: ${fmtMoney(s.subtotal ?? s.total)} €`);
    if (s.discount && s.discount > 0) out.push(`DESCUENTO: -${fmtMoney(s.discount)} €`);
    out.push(`TOTAL: ${fmtMoney(s.total)} €`);
    out.push(`Pago: ${s.payMethod}`);
    if (s.payMethod === 'efectivo' || s.payMethod === 'mixto') {
      out.push(`Entregado: ${fmtMoney(s.given || 0)} €`);
      out.push(`Cambio: ${fmtMoney(s.change || 0)} €`);
    }
    if (s.note) out.push(`Nota: ${s.note}`);
    out.push('------------------------------');
    out.push(state.settings.footerText);
    out.push('IVA incluido en los precios');
    return out.join('\n');
  }

  function sendEmailMailto() {
    const to = (el.emailTo?.value || '').trim();
    const extra = (el.emailMsg?.value || '').trim();
    const s = state.lastSale;
    if (!s) return toast('No hay último ticket');

    const subject = `Ticket ${s.ticketNo} - ${state.settings.shopName}`;
    const body = buildReceiptText(s) + (extra ? `\n\n${extra}` : '');
    const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = url;
    closeModal(el.modalEmail);
  }

  /* =========================
     X / Z (con arqueo)
  ========================== */
  function nextZNo() {
    const n = state.counters.zSeq || 1;
    state.counters.zSeq = n + 1;
    save();
    return `Z-${String(n).padStart(6, '0')}`;
  }

  function buildZText(z) {
    return [
      state.settings.shopName,
      state.settings.shopSub,
      '------------------------------',
      `${z.zNo}  ${z.date}`,
      `Caja: ${z.box}  Cajero: ${z.user}`,
      '------------------------------',
      `Tickets : ${z.tickets}`,
      `EFECTIVO ESPERADO: ${fmtMoney(z.cash)} €`,
      `TARJETA          : ${fmtMoney(z.card)} €`,
      `TOTAL            : ${fmtMoney(z.total)} €`,
      '------------------------------',
      `COSTE   : ${fmtMoney(z.cost)} €`,
      `BENEF   : ${fmtMoney(z.profit)} €`,
      `MARGEN  : ${z.margin.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`,
      '------------------------------',
      `ARQUEO EFECTIVO CONTADO: ${z.countedCash == null ? '-' : fmtMoney(z.countedCash) + ' €'}`,
      `DESCUADRE (contado - esperado): ${z.diffCash == null ? '-' : (fmtMoney(z.diffCash) + ' €')}`,
      '------------------------------',
      'CIERRE Z (pone a 0)',
      'IVA incluido en precios'
    ].join('\n');
  }

  function printZ(z) {
    if (!el.printArea) return;
    const html = buildZText(z).split('\n').map(l => `<div>${escapeHtml(l)}</div>`).join('');
    el.printArea.innerHTML = `<div class="p80"><div class="box">${html}</div></div>`;
    window.print();
  }

  function renderZHistory() {
    if (!el.zList) return;
    el.zList.innerHTML = '';
    const items = state.zHistory.slice(-30).reverse();

    if (!items.length) {
      el.zList.innerHTML = `<div class="muted small">Sin cierres Z todavía.</div>`;
      return;
    }

    for (const z of items) {
      const div = document.createElement('div');
      div.className = 'z-item';
      const diffTxt = (z.diffCash == null) ? '' : ` · Dif ${fmtMoney(z.diffCash)}€`;
      div.innerHTML = `
        <div>
          <div class="mono" style="font-weight:1000;">${escapeHtml(z.zNo)} · ${escapeHtml(z.date)}</div>
          <div class="muted small">Efe ${fmtMoney(z.cash)} · Tar ${fmtMoney(z.card)} · Total ${fmtMoney(z.total)} €${escapeHtml(diffTxt)}</div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
          <button class="btn btn-ghost btn-small" type="button">Imprimir</button>
        </div>
      `;
      div.querySelector('button').addEventListener('click', () => printZ(z));
      el.zList.appendChild(div);
    }
  }

  function printX() {
    const r = calcOpenTotals();
    const x = {
      ticketNo: 'X (INFORME)',
      date: nowEs(),
      box: state.settings.boxName,
      user: state.session.user.name,
      payMethod: 'resumen',
      given: 0,
      change: 0,
      note: `Tickets: ${r.tickets} · Benef: ${fmtMoney(r.profit)} € · Margen: ${r.margin.toFixed(1)}%`,
      subtotal: r.total,
      discount: 0,
      total: r.total,
      lines: [
        { name: 'EFECTIVO', qty: 1, price: r.cash, barcode:'', cost:null },
        { name: 'TARJETA',  qty: 1, price: r.card, barcode:'', cost:null },
        { name: 'COSTE',    qty: 1, price: r.cost, barcode:'', cost:null },
        { name: 'BENEFICIO',qty: 1, price: r.profit, barcode:'', cost:null },
      ]
    };
    el.printArea.innerHTML = buildTicketHTML(x);
    window.print();
  }

  let pendingZClear = false;
  let zExpectedCashTmp = 0;

  function updateZArqueoUI() {
    const counted = parseMoney(el.zCountedCash?.value || '');
    const diff = counted - Number(zExpectedCashTmp || 0);
    if (el.zDiffCash) el.zDiffCash.value = fmtMoney(diff).replace('.', ',');
  }

  function openZModal() {
    if (!adminUnlocked()) {
      openModal(el.modalAdmin);
      toast('PIN admin requerido');
      return;
    }
    const r = calcOpenTotals();
    if (r.tickets === 0) return toast('No hay ventas para cerrar');

    const zNo = nextZNo();
    const preview = { zNo, date: nowEs(), box: state.settings.boxName, user: state.session.user.name, ...r, countedCash: null, diffCash: null };

    zExpectedCashTmp = Number(r.cash || 0);
    if (el.zCountedCash) el.zCountedCash.value = '';
    if (el.zDiffCash) el.zDiffCash.value = '0,00';

    el.modalZ.dataset.zNo = zNo;
    el.zPreview.textContent = buildZText(preview);
    openModal(el.modalZ);
  }

  function doZClear() {
    state.salesOpen = [];
    state.lastSale = null;
    save();
    pendingZClear = false;
    renderReports();
    toast('Cierre Z completado · Periodo a 0');
    focusBarcodeSoon();
  }

  function confirmZ() {
    const r = calcOpenTotals();
    if (r.tickets === 0) return toast('No hay ventas');

    if (state.settings.autoBackupZ) exportBackupJSON();

    const counted = (String(el.zCountedCash?.value || '').trim() === '') ? null : parseMoney(el.zCountedCash.value);
    const diff = (counted == null) ? null : (counted - Number(r.cash || 0));

    const zNo = el.modalZ.dataset.zNo || nextZNo();
    const z = {
      id: uid(),
      zNo,
      date: nowEs(),
      box: state.settings.boxName,
      user: state.session.user.name,
      ...r,
      countedCash: counted,
      diffCash: diff
    };

    state.zHistory.push(z);
    save();

    pendingZClear = true;
    closeModal(el.modalZ);
    printZ(z);

    setTimeout(() => { if (pendingZClear) doZClear(); }, 5000);
  }

  window.addEventListener('afterprint', () => { if (pendingZClear) doZClear(); });

  /* =========================
     PARKED (MULTI)
  ========================== */
  function parkToggle() {
    if (state.cart.lines.length) {
      const name = prompt('Nombre para aparcar (opcional):', state.cart.note || '') ?? '';
      state.parked.push({
        id: uid(),
        name: String(name || '').trim() || `Aparcado ${state.parked.length + 1}`,
        ts: Date.now(),
        cart: JSON.parse(JSON.stringify(state.cart))
      });
      cartClear();
      toast('Carrito aparcado');
    } else {
      if (!state.parked.length) return toast('No hay aparcados');
      const list = state.parked.map((p, i) => `${i + 1}) ${p.name}`).join('\n');
      const pick = prompt(`Recuperar cuál?\n${list}\n\nEscribe número:`, '1');
      const idx = Math.max(1, Math.floor(Number(pick || 1))) - 1;
      const item = state.parked[idx];
      if (!item) return toast('No válido');
      state.cart = item.cart;
      if (!state.cart.discount) state.cart.discount = { type:'amount', value:0 };
      state.parked.splice(idx, 1);
      save();
      renderParkBadge();
      renderTicket();
      toast('Carrito recuperado');
    }
    save();
    renderParkBadge();
  }

  /* =========================
     NUMPAD (FIX: no double binding)
  ========================== */
  let __NUMPADS_BOUND__ = false;

  function setNumpadTarget(numpadEl, inputId) {
    if (!numpadEl) return;
    numpadEl.dataset.target = inputId;
  }

  function applyNumpadKey(numpadEl, key) {
    if (!numpadEl) return;
    const targetId = numpadEl.dataset.target;
    const input = document.getElementById(targetId);
    if (!input) return;

    const { total } = cartTotals();

    if (key === 'ok') { input.dispatchEvent(new Event('change', { bubbles: true })); return; }
    if (key === 'back') { input.value = input.value.slice(0, -1); input.dispatchEvent(new Event('input', { bubbles: true })); return; }
    if (key === 'clear') { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); return; }
    if (key === 'full') { input.value = fmtMoney(total).replace('.', ','); input.dispatchEvent(new Event('input', { bubbles: true })); return; }
    if (key === 'plus10') { const v = parseMoney(input.value || '0') + 10; input.value = fmtMoney(v).replace('.', ','); input.dispatchEvent(new Event('input', { bubbles: true })); return; }
    if (key === ',') { if (!input.value.includes(',')) input.value += ','; input.dispatchEvent(new Event('input', { bubbles: true })); return; }
    if (/^\d$/.test(key)) { input.value += key; input.dispatchEvent(new Event('input', { bubbles: true })); }
  }

  function bindNumpads() {
    // ✅ FIX: evita doble binding (causa del doble número)
    if (__NUMPADS_BOUND__) return;
    __NUMPADS_BOUND__ = true;

    const getKeyBtn = (e) => e.target?.closest?.('[data-k]');

    el.numpadQuick?.addEventListener('click', (e) => {
      const btn = getKeyBtn(e);
      const k = btn?.dataset?.k;
      if (!k) return;
      if (k === 'ok') { el.btnQuickOk.click(); return; }
      applyNumpadKey(el.numpadQuick, k);
    });

    el.numpadPay?.addEventListener('click', (e) => {
      const btn = getKeyBtn(e);
      const k = btn?.dataset?.k;
      if (!k) return;
      if (k === 'ok') { el.btnPayOk.click(); return; }
      applyNumpadKey(el.numpadPay, k);
      calcPayChange();
    });

    el.payGiven?.addEventListener('focus', () => setNumpadTarget(el.numpadPay, 'payGiven'));
    el.payCash?.addEventListener('focus', () => setNumpadTarget(el.numpadPay, 'payCash'));
    el.payCard?.addEventListener('focus', () => setNumpadTarget(el.numpadPay, 'payCard'));
  }

  /* =========================
     SCAN ENGINE (GLOBAL + DOUBLE BEEP ON DUP)
  ========================== */
  const scan = {
    buf: '',
    lastTs: 0,
    timer: null,
    active: false,
    maxGap: 55,
    minLen: 6,
    flushMs: 120,
  };

  const scanDedupe = { lastCode: '', lastTime: 0, windowMs: 260 };

  function isVentaActive() {
    return !!(el.pageVenta && el.pageVenta.classList.contains('is-active'));
  }

  function handleScannedCode(code) {
    const c = String(code || '').trim();
    if (!c) return;

    const t = Date.now();
    if (scanDedupe.lastCode === c && (t - scanDedupe.lastTime) < scanDedupe.windowMs) {
      beep.dbl();
      toast('⚠️ Duplicado de escaneo');
      return;
    }
    scanDedupe.lastCode = c;
    scanDedupe.lastTime = t;

    const p = findByBarcode(c);
    if (p) {
      cartAddProduct(p, 1, 'scan');
      toast('Añadido');
      return;
    }

    // No existe -> registrar automático
    beep.single();
    if (adminUnlocked()) {
      openProductModal(null, c);
      toast('Barcode no existe: registrar');
    } else {
      state.pendingRegisterBarcode = c;
      save();
      openModal(el.modalAdmin);
      toast('Barcode no existe: PIN para registrar');
    }
  }

  function flushScan(reason = 'timeout') {
    if (scan.timer) clearTimeout(scan.timer);
    scan.timer = null;

    const code = scan.buf;
    scan.buf = '';
    const wasActive = scan.active;
    scan.active = false;

    if (!code) return;
    if (code.length < scan.minLen) return;

    if (wasActive || reason === 'enter') handleScannedCode(code);
  }

  function bindGlobalScan() {
    document.addEventListener('keydown', (e) => {
      if (!isVentaActive()) return;
      if (anyModalOpen()) return;

      // si foco en barcodeInput => su handler se encarga
      if (document.activeElement === el.barcodeInput) return;

      const key = e.key;

      if (key === 'Enter') {
        if (scan.buf.length >= scan.minLen) {
          e.preventDefault(); e.stopPropagation();
          flushScan('enter');
        }
        return;
      }

      const isChar = (key.length === 1) && /[0-9A-Za-z]/.test(key);
      if (!isChar) return;

      const tt = performance.now();
      const gap = tt - (scan.lastTs || 0);
      scan.lastTs = tt;

      if (gap > scan.maxGap) { scan.buf = ''; scan.active = false; }
      scan.buf += key;

      if (gap <= scan.maxGap && scan.buf.length >= 2) scan.active = true;

      if (scan.active && state.settings.aggressiveScan) {
        e.preventDefault(); e.stopPropagation();
      }

      if (scan.timer) clearTimeout(scan.timer);
      scan.timer = setTimeout(() => flushScan('timeout'), scan.flushMs);
    }, { capture: true });
  }

  /* =========================
     USERS PIN UI (Ajustes)
  ========================== */
  function renderUserSelect() {
    if (!el.setUserSelect) return;
    el.setUserSelect.innerHTML = '';
    for (const u of state.users) {
      const opt = document.createElement('option');
      opt.value = u.username;
      opt.textContent = `${u.username.toUpperCase()} (${u.role})`;
      el.setUserSelect.appendChild(opt);
    }
    if (!el.setUserSelect.value) el.setUserSelect.value = 'cajero';
  }

  async function doSaveUserPin(username, newPin) {
    const u = getUser(username);
    if (!u) return toast('Usuario no existe');
    const pin = String(newPin || '').trim();
    if (pin.length < 4) return toast('PIN mínimo 4 dígitos');
    u.passHash = await sha256Hex(pin);

    if (u.username === 'admin') state.settings.adminPinHash = u.passHash;

    save();
    toast('PIN guardado');
  }

  async function saveUserPinFlow() {
    const uname = el.setUserSelect?.value || '';
    const pin = el.setUserPin?.value || '';
    if (!uname) return;
    if (!pin) return toast('PIN vacío');

    if (!requireAdminIf(true, 'SAVE_USER_PIN', { username: uname, newPin: pin }, 'PIN admin requerido para cambiar PIN')) return;

    await doSaveUserPin(uname, pin);
    el.setUserPin.value = '';
  }

  /* =========================
     UI BINDINGS
  ========================== */
  function bindUI() {
    if (el.clockTop) el.clockTop.textContent = nowEs();
    setInterval(() => {
      if (el.clockTop) el.clockTop.textContent = nowEs();
      if (el.ticketDate) el.ticketDate.textContent = nowEs();
    }, 15000);

    el.tabs.forEach(t => t.addEventListener('click', () => {
      if (state.settings.kiosk) return toast('Kiosko: navegación bloqueada');
      setTab(t.dataset.tab);
      renderProductsTable();
      renderReports();
    }));

    el.btnTheme?.addEventListener('click', () => setTheme(document.body.classList.contains('theme-day') ? 'night' : 'day'));

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

    el.btnLoginOk?.addEventListener('click', async () => {
      const res = await login(el.loginUser.value, el.loginPass.value);
      if (!res.ok) return toast(res.msg);
      closeModal(el.modalLogin);
      toast('Sesión iniciada');
      renderHeader();
    });

    el.btnAdminOk?.addEventListener('click', async () => {
      const pin = String(el.adminPin.value || '').trim();
      if (pin.length < 4) return toast('PIN inválido');
      if (!(await verifyAdminPin(pin))) return toast('PIN incorrecto');
      setAdminUnlocked(state.settings.adminMinutes || 5);
      closeModal(el.modalAdmin);
      toast(`Admin ✓ (${state.settings.adminMinutes} min)`);
    });

    // Barcode input manual
    el.barcodeInput?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const code = String(el.barcodeInput.value || '').trim();
      el.barcodeInput.value = '';
      if (!code) return;
      handleScannedCode(code);
      focusBarcodeSoon();
    });

    el.searchInput?.addEventListener('input', () => renderProductsGrid());

    // Pay tabs main
    el.payTabs.forEach(p => p.addEventListener('click', () => {
      el.payTabs.forEach(x => x.classList.remove('is-active'));
      p.classList.add('is-active');
      state.cart.payMethod = p.dataset.pay || 'efectivo';
      save();
      renderTicket();
    }));

    // Given & Note
    el.givenInput?.addEventListener('input', () => { state.cart.given = parseMoney(el.givenInput.value); save(); renderTicket(); });
    el.noteName?.addEventListener('input', () => { state.cart.note = el.noteName.value || ''; save(); });

    // Quick modal open + confirm
    el.btnQuickAmount?.addEventListener('click', openQuickModal);
    el.btnQuickOk?.addEventListener('click', () => {
      const amt = parseMoney(el.quickAmount.value || '0');
      const name = (el.quickName.value || 'Importe').trim();
      if (!(amt > 0)) return toast('Importe inválido');
      cartAddManual(amt, name);
      closeModal(el.modalQuick);
      toast('Importe añadido');
    });

    // Pay modal
    el.btnPay?.addEventListener('click', openPayModal);
    el.btnNumpadGiven?.addEventListener('click', openPayModal);
    el.payMethod?.addEventListener('change', () => { syncPayUI(); calcPayChange(); });
    el.payGiven?.addEventListener('input', calcPayChange);
    el.payCash?.addEventListener('input', calcPayChange);
    el.payCard?.addEventListener('input', calcPayChange);
    el.btnPayOk?.addEventListener('click', confirmPay);

    // Discount
    el.btnDiscount?.addEventListener('click', openDiscountModal);
    el.btnDiscountOk?.addEventListener('click', confirmDiscount);

    // Void (perm)
    el.btnVoid?.addEventListener('click', () => {
      if (!state.cart.lines.length) return;
      const need = !!state.settings.permVoid;
      if (!requireAdminIf(need, 'VOID_TICKET', {}, 'PIN admin requerido para anular')) return;
      if (!confirm('¿Anular ticket actual?')) return;
      cartClear();
      toast('Ticket anulado');
    });

    // Refund (siempre admin)
    el.btnRefund?.addEventListener('click', () => {
      if (!adminUnlocked()) { openModal(el.modalAdmin); return toast('PIN admin requerido'); }
      const s = state.lastSale;
      if (!s) return toast('No hay última venta');
      const ref = {
        ...s,
        id: uid(),
        ticketNo: nextTicketNo(),
        date: nowEs(),
        payMethod: 'devolucion',
        total: -Math.abs(s.total),
        subtotal: -Math.abs(s.subtotal || s.total),
        discount: 0,
        lines: (s.lines || []).map(l => ({ ...l, qty: -Math.abs(l.qty) }))
      };
      state.salesOpen.push(ref);
      state.lastSale = ref;
      save();
      renderReports();
      toast('Devolución registrada');
    });

    // Print / email
    el.btnPrint?.addEventListener('click', () => { if (!state.lastSale) return toast('No hay último ticket'); printSale(state.lastSale); });
    el.btnLastTicket?.addEventListener('click', () => { if (!state.lastSale) return toast('No hay último ticket'); printSale(state.lastSale); });
    el.btnEmailTicket?.addEventListener('click', () => { if (!state.lastSale) return toast('No hay último ticket'); openModal(el.modalEmail); });
    el.btnEmailSend?.addEventListener('click', sendEmailMailto);

    // Park
    el.btnPark?.addEventListener('click', parkToggle);

    // Categories admin actions
    el.btnAddCategory?.addEventListener('click', () => {
      if (!adminUnlocked()) return;
      el.modalCategory.dataset.mode = 'add';
      el.catModalTitle.textContent = 'Crear categoría';
      el.catName.value = '';
      openModal(el.modalCategory);
    });

    el.btnRenameCategory?.addEventListener('click', () => {
      if (!adminUnlocked()) return;
      const current = state.selectedCategory;
      if (current === 'Favoritos') return toast('No se renombra “Favoritos”');
      el.modalCategory.dataset.mode = 'rename';
      el.modalCategory.dataset.old = current;
      el.catModalTitle.textContent = `Renombrar: ${current}`;
      el.catName.value = current;
      openModal(el.modalCategory);
    });

    el.btnCategoryOk?.addEventListener('click', () => {
      if (!adminUnlocked()) return;
      const mode = el.modalCategory.dataset.mode;
      const name = el.catName.value || '';

      if (mode === 'add') {
        const res = addCategory(name);
        if (!res.ok) return toast(res.msg);
        state.selectedCategory = normalizeCat(name);
      } else {
        const old = el.modalCategory.dataset.old || state.selectedCategory;
        const res = renameCategory(old, name);
        if (!res.ok) return toast(res.msg);
      }

      save();
      closeModal(el.modalCategory);
      renderCategories();
      renderProductsGrid();
      renderProductsTable();
      toast('Categorías actualizadas');
    });

    // Product add/edit
    el.btnAddProductInline?.addEventListener('click', () => openProductModal(null, ''));
    el.btnAddProduct?.addEventListener('click', () => openProductModal(null, ''));
    el.btnProductSave?.addEventListener('click', saveProductFromModal);

    // Products filters & pager
    const reRenderProducts = debounce(() => { state.ui.prodPage = 1; save(); renderProductsTable(); }, 120);
    el.prodSearchName?.addEventListener('input', reRenderProducts);
    el.prodSearchBarcode?.addEventListener('input', reRenderProducts);
    el.prodSearchCatSelect?.addEventListener('change', reRenderProducts);

    el.btnProdPrev?.addEventListener('click', () => { state.ui.prodPage = Math.max(1, Number(state.ui.prodPage || 1) - 1); save(); renderProductsTable(); });
    el.btnProdNext?.addEventListener('click', () => { state.ui.prodPage = Number(state.ui.prodPage || 1) + 1; save(); renderProductsTable(); });

    el.prodPageSize?.addEventListener('change', () => { state.ui.prodPageSize = Number(el.prodPageSize.value || 50); state.ui.prodPage = 1; save(); renderProductsTable(); });
    el.prodSort?.addEventListener('change', () => { state.ui.prodSort = el.prodSort.value || 'az'; state.ui.prodPage = 1; save(); renderProductsTable(); });

    // Backups JSON
    el.btnExportBackup?.addEventListener('click', exportBackupJSON);
    el.btnBackupNow?.addEventListener('click', exportBackupJSON);

    el.btnImportBackup?.addEventListener('click', () => el.fileImport.click());
    el.btnRestoreNow?.addEventListener('click', () => el.fileImport.click());
    el.fileImport?.addEventListener('change', () => { const f = el.fileImport.files?.[0]; if (f) importBackupJSON(f); el.fileImport.value=''; });

    // CSV
    el.btnExportCSV?.addEventListener('click', exportCSV);
    el.btnImportCSV?.addEventListener('click', () => el.fileImportCSV.click());
    el.fileImportCSV?.addEventListener('change', () => { const f = el.fileImportCSV.files?.[0]; if (f) importCSV(f); el.fileImportCSV.value=''; });

    // Reset
    el.btnFactoryReset?.addEventListener('click', factoryReset);

    // X / Z
    el.btnPrintX?.addEventListener('click', printX);
    el.btnCloseZ?.addEventListener('click', openZModal);
    el.btnZOk?.addEventListener('click', confirmZ);

    // Z arqueo live calc
    el.zCountedCash?.addEventListener('input', updateZArqueoUI);

    // Settings
    el.setShopName?.addEventListener('input', debounce(() => { state.settings.shopName = el.setShopName.value || state.settings.shopName; save(); renderHeader(); }, 120));
    el.setShopSub?.addEventListener('input', debounce(() => { state.settings.shopSub = el.setShopSub.value || state.settings.shopSub; save(); renderHeader(); }, 120));
    el.setBoxName?.addEventListener('input', debounce(() => { state.settings.boxName = el.setBoxName.value || state.settings.boxName; save(); renderHeader(); }, 120));
    el.setFooterText?.addEventListener('input', debounce(() => { state.settings.footerText = el.setFooterText.value || state.settings.footerText; save(); }, 120));

    el.setAutoPrint?.addEventListener('change', () => { state.settings.autoPrint = (el.setAutoPrint.value === '1'); save(); toast('Guardado'); });
    el.setAggressiveScan?.addEventListener('change', () => { state.settings.aggressiveScan = (el.setAggressiveScan.value === '1'); save(); toast('Guardado'); });
    el.setAutoBackupZ?.addEventListener('change', () => { state.settings.autoBackupZ = (el.setAutoBackupZ.value === '1'); save(); toast('Guardado'); });
    el.setKiosk?.addEventListener('change', () => { state.settings.kiosk = (el.setKiosk.value === '1'); save(); applyKioskUI(); toast('Guardado'); });
    el.setAdminMinutes?.addEventListener('change', () => { state.settings.adminMinutes = Number(el.setAdminMinutes.value || 5); save(); toast('Guardado'); });

    // Perm settings
    el.setPermDeleteLine?.addEventListener('change', () => { state.settings.permDeleteLine = (el.setPermDeleteLine.value === '1'); save(); toast('Guardado'); });
    el.setPermVoid?.addEventListener('change', () => { state.settings.permVoid = (el.setPermVoid.value === '1'); save(); toast('Guardado'); });
    el.setPermDiscount?.addEventListener('change', () => { state.settings.permDiscount = (el.setPermDiscount.value === '1'); save(); toast('Guardado'); });
    el.setPermPriceEdit?.addEventListener('change', () => { state.settings.permPriceEdit = (el.setPermPriceEdit.value === '1'); save(); toast('Guardado'); });

    // Admin pin (sync with user admin)
    el.setAdminPin?.addEventListener('change', async () => {
      const pin = String(el.setAdminPin.value || '').trim();
      if (!pin) return;
      if (pin.length < 4) return toast('PIN mínimo 4 dígitos');

      const h = await sha256Hex(pin);
      state.settings.adminPinHash = h;
      const adminUser = getUser('admin');
      if (adminUser) adminUser.passHash = h;

      el.setAdminPin.value = '';
      save();
      toast('PIN Admin actualizado');
    });

    // Kiosk buttons
    el.btnEnterKiosk?.addEventListener('click', enterKiosk);
    el.btnExitKiosk?.addEventListener('click', exitKiosk);
    el.btnExitKiosk2?.addEventListener('click', exitKiosk);

    // Users pin save
    el.btnUserPinSave?.addEventListener('click', saveUserPinFlow);

    // Shortcuts
    window.addEventListener('keydown', (e) => {
      const tag = e.target?.tagName?.toLowerCase();
      const typing = (tag === 'input' || tag === 'textarea' || tag === 'select');

      if (e.key === 'F2') { e.preventDefault(); openQuickModal(); return; }
      if (e.key === 'F3') { e.preventDefault(); openDiscountModal(); return; }
      if (e.key === 'F4') { e.preventDefault(); openPayModal(); return; }

      if (e.key === 'Escape') {
        const open = document.querySelector('dialog[open]');
        if (open) { e.preventDefault(); closeModal(open); return; }
        if (!typing && state.cart.lines.length) { if (confirm('¿Limpiar ticket actual?')) cartClear(); }
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Supr') && !typing) {
        if (!state.cart.lines.length) return;
        e.preventDefault();
        const idx = state.cart.lines.length - 1;
        requestDeleteLine(idx);
        return;
      }

      if (!typing && (e.key === '+' || e.key === '=')) {
        if (!state.cart.lines.length) return;
        e.preventDefault();
        cartIncQty(state.cart.lines.length - 1, +1);
        return;
      }

      if (!typing && (e.key === '-' || e.key === '_')) {
        if (!state.cart.lines.length) return;
        e.preventDefault();
        cartIncQty(state.cart.lines.length - 1, -1);
        return;
      }
    });
  }

  /* =========================
     RENDER ALL
  ========================== */
  function renderAll() {
    // Settings UI
    if (el.setShopName) el.setShopName.value = state.settings.shopName;
    if (el.setShopSub) el.setShopSub.value = state.settings.shopSub;
    if (el.setBoxName) el.setBoxName.value = state.settings.boxName;
    if (el.setFooterText) el.setFooterText.value = state.settings.footerText;

    if (el.setAutoPrint) el.setAutoPrint.value = state.settings.autoPrint ? '1' : '0';
    if (el.setAggressiveScan) el.setAggressiveScan.value = state.settings.aggressiveScan ? '1' : '0';
    if (el.setAutoBackupZ) el.setAutoBackupZ.value = state.settings.autoBackupZ ? '1' : '0';
    if (el.setKiosk) el.setKiosk.value = state.settings.kiosk ? '1' : '0';
    if (el.setAdminMinutes) el.setAdminMinutes.value = String(state.settings.adminMinutes || 5);

    if (el.setPermDeleteLine) el.setPermDeleteLine.value = state.settings.permDeleteLine ? '1' : '0';
    if (el.setPermVoid) el.setPermVoid.value = state.settings.permVoid ? '1' : '0';
    if (el.setPermDiscount) el.setPermDiscount.value = state.settings.permDiscount ? '1' : '0';
    if (el.setPermPriceEdit) el.setPermPriceEdit.value = state.settings.permPriceEdit ? '1' : '0';

    if (el.prodPageSize) el.prodPageSize.value = String(state.ui.prodPageSize || 50);
    if (el.prodSort) el.prodSort.value = state.ui.prodSort || 'az';

    if (!state.categories.includes('Favoritos')) state.categories.unshift('Favoritos');
    if (!state.selectedCategory || !state.categories.includes(state.selectedCategory)) state.selectedCategory = 'Favoritos';

    if (!state.cart.discount) state.cart.discount = { type: 'amount', value: 0 };

    renderUserSelect();
    renderHeader();
    renderCategories();
    renderProductsGrid();
    renderTicket();
    renderProductsTable();
    renderReports();

    // ✅ Safe: si se llama muchas veces, el guard evita duplicados
    bindNumpads();

    focusBarcodeSoon();
  }

  /* =========================
     INIT
  ========================== */
  async function init() {
    await ensureDefaultHashes();
    setTheme(state.settings.theme || 'day');

    setTab('venta');
    applyKioskUI();
    renderAdminState();

    bindUI();
    bindGlobalScan();

    // ✅ bind numpads una vez (y guardado)
    bindNumpads();

    renderAll();
  }

  init();
})();

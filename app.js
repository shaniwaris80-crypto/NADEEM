/* =========================================
TPV NADEEM — B/W PRO (Paquete PRO)
PARTE 2/2 — app.js
Incluye:
- Escáner global always-on (buffer rápido) + Enter en input barcode
- Categorías PRO: crear/renombrar/borrar (Admin) + chips debajo + grid por categoría
- Productos: alta/edición + asignar categoría + favoritos + import/export CSV + backup/restore JSON
- Venta:
  - SOLO TARJETA (1 toque) => cierra ticket sin abrir nada
  - Efectivo híbrido (panel fijo): billetes + exacto + teclado + cambio + cobrar
  - Detalles (modal): mixto / nota / métodos
- Cambio "flash" 3s al cerrar efectivo/mixto (si hay cambio)
- Impresión ON/OFF (si OFF: NO imprime y NO abre impresión)
- Ticket 80mm perfecto vía #printArea
- BIP: solo al cerrar ticket y al añadir manualmente (importe rápido / manual). Nunca al escanear.
- Bandeja del día (operativa) separada del histórico:
  - Cierre Z imprime resumen Z (si impresión ON), muestra descuadre +/-,
    guarda el día en reportes y LIMPIA la bandeja del día.
- Reportes: diario / semanal / mensual / rango (tabla por día)
========================================= */

(() => {
  'use strict';

  /* =========================
     HELPERS
  ========================== */
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  const LS_KEY = 'TPV_NADEEM_BWPRO_V1_3';

  const pad = (n) => (n < 10 ? '0' : '') + n;
  const now = () => new Date();

  const dateKey = (d = now()) => {
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    return `${yyyy}-${mm}-${dd}`;
  };

  const timeHM = (d = now()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const nowEs = (d = now()) => `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const parseMoney = (s) => {
    if (s == null) return 0;
    const t = String(s).trim().replace(/\s/g,'').replace(',', '.');
    const v = Number(t);
    return Number.isFinite(v) ? v : 0;
  };

  const fmtMoney = (v) => Number(v || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtEUR = (v) => `${fmtMoney(v)} €`;

  const escapeHtml = (s) => (s ?? '').toString()
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'","&#039;");

  const uid = () => 'ID' + Math.random().toString(36).slice(2, 8).toUpperCase() + Date.now().toString(36).slice(-4).toUpperCase();

  const debounce = (fn, ms=120) => {
    let t=null;
    return (...args) => {
      clearTimeout(t);
      t=setTimeout(()=>fn(...args), ms);
    };
  };

  async function sha256Hex(str){
    const enc = new TextEncoder();
    const data = enc.encode(String(str));
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  function downloadText(filename, text, mime='text/plain'){
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function toCSV(rows){
    const esc = (v) => {
      const s = String(v ?? '');
      if (/[",\n;]/.test(s)) return `"${s.replaceAll('"','""')}"`;
      return s;
    };
    return rows.map(r => r.map(esc).join(',')).join('\n');
  }

  function parseCSV(text){
    const raw = String(text || '').replace(/\r/g,'').trim();
    if (!raw) return [];
    const commaCount = (raw.match(/,/g)||[]).length;
    const semiCount  = (raw.match(/;/g)||[]).length;
    const delim = semiCount > commaCount ? ';' : ',';
    const lines = raw.split('\n');
    return lines.filter(l => l.trim()).map(l => splitCSVLine(l, delim));
  }

  function splitCSVLine(line, delim){
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i=0;i<line.length;i++){
      const ch = line[i];
      if (ch === '"'){
        if (inQ && line[i+1] === '"'){ cur += '"'; i++; }
        else inQ = !inQ;
      } else if (!inQ && ch === delim){
        out.push(cur); cur='';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  /* =========================
     SOUND (BIP)
  ========================== */
  let audioCtx = null;
  function ensureAudio(){
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(()=>{});
    } catch (_) {}
  }

  function beep(){
    if (!state.settings.beepOn) return;
    try{
      ensureAudio();
      if (!audioCtx) return;
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.value = 0.03;
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start();
      setTimeout(() => { o.stop(); }, 80);
    } catch (_) {}
  }

  /* =========================
     DEFAULT STATE
  ========================== */
  const DEFAULTS = () => ({
    version: '1.3',
    settings: {
      shopName: 'MALIK AHMAD NADEEM',
      shopSub: 'C/ Vitoria 139 · 09007 Burgos · Tlf 632 480 316 · CIF 72374062P',
      footerText: 'Gracias por su compra',
      boxName: 'CAJA-1',

      theme: 'day',

      printOn: true,       // Impresión ON/OFF (si OFF: NO imprime, NO abre)
      autoPrint: true,     // si printOn==true: imprimir automáticamente al cerrar ticket
      alwaysScan: true,    // escucha global escáner
      scanSpeedMs: 35,     // threshold gap entre teclas
      beepOn: true,        // BIP solo cierre + manual
      autoLockMin: 10,     // auto-lock admin por inactividad
      adminPinHash: '',    // default 1234
    },
    session: {
      user: { name: 'CAJERO', role: 'cashier' },
      adminUnlockedUntil: 0,
      lastActivity: Date.now(),
    },
    users: [
      { username:'cajero', passHash:'', role:'cashier' },
      { username:'admin',  passHash:'', role:'admin' },
    ],
    categories: [
      { id:'c_all', name:'Todos' },
      { id:'c_fav', name:'Favoritos' },
      { id:'c_fr',  name:'Fruta' },
      { id:'c_ve',  name:'Verdura' },
      { id:'c_tr',  name:'Tropical' },
      { id:'c_ot',  name:'Otros' },
    ],
    counters: { ticketSeq: 1 },

    products: [
      { id:'P1', barcode:'1234567890123', name:'Plátano',  price:1.89, cost:1.20, categoryId:'c_fr', fav:true, unit:'ud' },
      { id:'P2', barcode:'7894561230123', name:'Manzana',  price:2.40, cost:1.50, categoryId:'c_fr', fav:true, unit:'ud' },
      { id:'P3', barcode:'2345678901234', name:'Naranja',  price:1.60, cost:0.95, categoryId:'c_fr', fav:true, unit:'ud' },
      { id:'P4', barcode:'3456789012345', name:'Tomate',   price:2.10, cost:1.25, categoryId:'c_ve', fav:true, unit:'ud' },
      { id:'P5', barcode:'4567890123456', name:'Lechuga',  price:1.20, cost:0.70, categoryId:'c_ve', fav:true, unit:'ud' },
      { id:'P6', barcode:'5678901234567', name:'Aguacate', price:3.90, cost:2.30, categoryId:'c_tr', fav:true, unit:'ud' },
      { id:'P7', barcode:'',              name:'Bolsa',    price:0.10, cost:null, categoryId:'c_ot', fav:true, unit:'ud' },
    ],

    // Carrito actual
    cart: { lines: [], note: '' },

    // Aparcados
    parked: [], // [{id,name,cart,ts}]

    // Histórico de tickets (NO se borra)
    sales: [], // [{id,ticketNo,dateKey,dateStr,timeStr,box,user,payMethod,lines,total,given,change,split,note,ts}]

    // Bandeja operativa del día (se limpia al cerrar Z)
    ops: {
      openDateKey: dateKey(), // día de la bandeja
      traySaleIds: [],        // ids de sales mostradas en bandeja del día
      selectedCategoryId: 'c_all',
      rangeMode: 'day',
      rangeFrom: dateKey(),
      rangeTo: dateKey(),
    },

    // Cierres Z por día
    zClosures: [], // [{dateKey,total,tickets,cash,card,expectedCash,countedCash,diff,note,ts,printed}]
  });

  function deepMerge(base, patch){
    if (Array.isArray(base)) return Array.isArray(patch) ? patch : base;
    if (typeof base !== 'object' || base === null) return patch ?? base;
    const out = { ...base };
    if (typeof patch !== 'object' || patch === null) return out;
    for (const k of Object.keys(patch)){
      out[k] = (k in base) ? deepMerge(base[k], patch[k]) : patch[k];
    }
    return out;
  }

  let state = (() => {
    try{
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
    // tabs
    tabs: $$('.tab'),
    pages: $$('.page'),

    // top
    btnTheme: $('#btnTheme'),
    themeLabel: $('#themeLabel'),
    btnPrintToggle: $('#btnPrintToggle'),
    printLabel: $('#printLabel'),
    printDot: $('#printDot'),
    btnLogin: $('#btnLogin'),
    userLabel: $('#userLabel'),
    btnAdmin: $('#btnAdmin'),
    adminState: $('#adminState'),

    scanDot: $('#scanDot'),

    // venta left
    barcodeInput: $('#barcodeInput'),
    searchInput: $('#searchInput'),
    catChips: $('#catChips'),
    btnNewCategory: $('#btnNewCategory'),
    btnManageCategories: $('#btnManageCategories'),
    prodGrid: $('#prodGrid'),
    btnAddProductInline: $('#btnAddProductInline'),

    // ticket header
    ticketNo: $('#ticketNo'),
    ticketDate: $('#ticketDate'),
    shopName: $('#shopName'),
    shopSub: $('#shopSub'),
    posBox: $('#posBox'),
    posUser: $('#posUser'),

    // ticket lines/totals
    ticketLines: $('#ticketLines'),
    linesCount: $('#linesCount'),
    subTotal: $('#subTotal'),
    grandTotal: $('#grandTotal'),

    // ticket top buttons
    btnLastTicket: $('#btnLastTicket'),
    btnEmailTicket: $('#btnEmailTicket'),
    btnPrint: $('#btnPrint'),

    // hybrid pay
    btnCardOneTap: $('#btnCardOneTap'),
    payModeCash: $('#payModeCash'),
    payModeMix: $('#payModeMix'),
    payModeMore: $('#payModeMore'),
    cashPanel: $('#cashPanel'),
    cashGiven: $('#cashGiven'),
    cashChange: $('#cashChange'),
    bills: $$('.bill[data-bill]'),
    btnExact: $('#btnExact'),
    btnCashKeypad: $('#btnCashKeypad'),
    btnCashClear: $('#btnCashClear'),
    btnCashPay: $('#btnCashPay'),

    // quick/park
    btnQuickAmount: $('#btnQuickAmount'),
    btnPark: $('#btnPark'),
    parkBadge: $('#parkBadge'),

    // reportes
    btnExportSalesCsv: $('#btnExportSalesCsv'),
    btnCloseZ: $('#btnCloseZ'),
    trayTable: $('#trayTable'),
    statTickets: $('#statTickets'),
    statTotal: $('#statTotal'),
    statCash: $('#statCash'),
    statCard: $('#statCard'),
    zLastInfo: $('#zLastInfo'),
    reportTable: $('#reportTable'),
    rangeBtns: $$('.range-btn'),
    repFrom: $('#repFrom'),
    repTo: $('#repTo'),
    btnApplyRange: $('#btnApplyRange'),

    // ajustes
    btnAdminUnlock: $('#btnAdminUnlock'),
    setShopName: $('#setShopName'),
    setShopSub: $('#setShopSub'),
    setBoxName: $('#setBoxName'),
    setFooterText: $('#setFooterText'),
    setAlwaysScan: $('#setAlwaysScan'),
    setScanSpeed: $('#setScanSpeed'),
    setBeep: $('#setBeep'),
    setAutoPrint: $('#setAutoPrint'),
    setAdminPin: $('#setAdminPin'),
    setAutoLockMin: $('#setAutoLockMin'),

    // file inputs
    fileCsv: $('#fileCsv'),
    fileJson: $('#fileJson'),

    // modals
    backdrop: $('#backdrop'),
    closeBtns: $$('[data-close]'),
    modalLogin: $('#modalLogin'),
    modalAdmin: $('#modalAdmin'),
    modalDetails: $('#modalDetails'),
    modalQuick: $('#modalQuick'),
    modalCashKeypad: $('#modalCashKeypad'),
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

    // details
    detMethod: $('#detMethod'),
    detNote: $('#detNote'),
    detMixWrap: $('#detMixWrap'),
    detCash: $('#detCash'),
    detCard: $('#detCard'),
    btnDetailsPay: $('#btnDetailsPay'),

    // quick
    quickAmount: $('#quickAmount'),
    quickName: $('#quickName'),
    keypadQuick: $('#keypadQuick'),
    btnQuickOk: $('#btnQuickOk'),

    // cash keypad
    cashKeypadValue: $('#cashKeypadValue'),
    keypadCash: $('#keypadCash'),
    btnCashKeypadOk: $('#btnCashKeypadOk'),

    // product
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
    zNote: $('#zNote'),
    zDiff: $('#zDiff'),
    btnZOk: $('#btnZOk'),

    // email
    emailTo: $('#emailTo'),
    emailMsg: $('#emailMsg'),
    btnEmailSend: $('#btnEmailSend'),

    // print area
    printArea: $('#printArea'),

    // change flash
    changeFlash: $('#changeFlash'),
    changeFlashValue: $('#changeFlashValue'),
  };

  /* =========================
     TOAST
  ========================== */
  function toast(msg){
    const host = $('#toastHost');
    if (!host) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(() => t.remove(), 1500);
  }

  /* =========================
     ACTIVITY + ADMIN LOCK
  ========================== */
  function touchActivity(){
    state.session.lastActivity = Date.now();
    save();
  }

  function lockAdminIfExpired(){
    const mins = Math.max(1, Number(state.settings.autoLockMin || 10));
    const maxMs = mins * 60 * 1000;
    const idle = Date.now() - (state.session.lastActivity || Date.now());
    if (idle > maxMs) state.session.adminUnlockedUntil = 0;
  }

  function adminUnlocked(){
    lockAdminIfExpired();
    return (state.session.adminUnlockedUntil || 0) > Date.now();
  }

  function renderAdminState(){
    if (!el.adminState) return;
    el.adminState.textContent = adminUnlocked() ? 'Admin ✓' : 'Admin';
  }

  function requireAdminOrPrompt(next){
    if (adminUnlocked()) return next();
    openModal(el.modalAdmin);
    toast('PIN admin requerido');
  }

  /* =========================
     SECURITY (hash)
  ========================== */
  async function ensureDefaultHashes(){
    if (!state.settings.adminPinHash) state.settings.adminPinHash = await sha256Hex('1234');
    for (const u of state.users){
      if (!u.passHash) u.passHash = await sha256Hex('1234');
    }
    save();
  }

  async function verifyAdminPin(pin){
    const h = await sha256Hex(String(pin || '').trim());
    return h === state.settings.adminPinHash;
  }

  function unlockAdmin(minutes=5){
    state.session.adminUnlockedUntil = Date.now() + minutes * 60 * 1000;
    save();
    renderAdminState();
  }

  async function login(username, password){
    const u = String(username||'').trim().toLowerCase();
    const p = String(password||'');
    if (!u || !p) return { ok:false, msg:'Credenciales vacías' };
    const user = state.users.find(x => x.username === u);
    if (!user) return { ok:false, msg:'Usuario no existe' };
    const h = await sha256Hex(p);
    if (h !== user.passHash) return { ok:false, msg:'Contraseña incorrecta' };
    state.session.user = { name: u.toUpperCase(), role: user.role };
    save();
    renderHeader();
    return { ok:true };
  }

  /* =========================
     THEME / PRINT TOGGLE / TABS / MODALS
  ========================== */
  function setTheme(mode){
    const night = mode === 'night';
    document.body.classList.toggle('theme-day', !night);
    document.body.classList.toggle('theme-night', night);
    if (el.themeLabel) el.themeLabel.textContent = night ? 'Noche' : 'Día';
    state.settings.theme = night ? 'night' : 'day';
    save();
  }

  function setPrintOn(on){
    state.settings.printOn = !!on;
    save();
    renderPrintState();
  }

  function renderPrintState(){
    if (el.printLabel) el.printLabel.textContent = state.settings.printOn ? 'Impresión ON' : 'Impresión OFF';
    if (el.printDot){
      el.printDot.style.opacity = state.settings.printOn ? '1' : '.35';
      el.printDot.style.background = state.settings.printOn ? 'var(--green)' : 'var(--muted)';
    }
  }

  function setTab(name){
    el.tabs.forEach(t => {
      const on = t.dataset.tab === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    el.pages.forEach(p => p.classList.toggle('is-active', p.dataset.page === name));
    if (name === 'venta') focusBarcodeSoon();
  }

  function openModal(dlg){
    if (!dlg) return;
    if (el.backdrop) el.backdrop.hidden = false;
    dlg.showModal();
    const f = dlg.querySelector('input,select,textarea,button');
    if (f) setTimeout(() => f.focus(), 20);
  }

  function closeModal(dlg){
    if (!dlg) return;
    dlg.close();
    if (el.backdrop) el.backdrop.hidden = true;
    focusBarcodeSoon();
  }

  function focusBarcodeSoon(){
    if (!el.barcodeInput) return;
    setTimeout(() => el.barcodeInput.focus(), 25);
  }

  /* =========================
     NORMALIZE DAY (bandeja)
  ========================== */
  function normalizeOpenDay(){
    const today = dateKey();
    if (state.ops.openDateKey !== today){
      // Nuevo día: empezamos bandeja vacía (no hacemos auto-Z)
      state.ops.openDateKey = today;
      state.ops.traySaleIds = [];
      save();
    }
  }

  /* =========================
     CATEGORIES
  ========================== */
  function getCatName(id){
    return state.categories.find(c => c.id === id)?.name || '—';
  }

  function fillCategorySelect(sel, includeAll=false){
    if (!sel) return;
    sel.innerHTML = '';
    if (includeAll){
      const o = document.createElement('option');
      o.value = ''; o.textContent = 'Todas';
      sel.appendChild(o);
    }
    for (const c of state.categories){
      if (c.id === 'c_all' || c.id === 'c_fav') continue;
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name;
      sel.appendChild(o);
    }
  }

  function createCategory(name){
    const n = String(name||'').trim();
    if (!n) return null;
    if (state.categories.some(c => c.name.toLowerCase() === n.toLowerCase())) return null;
    const id = 'c_' + uid().toLowerCase();
    const cat = { id, name: n };
    state.categories.push(cat);
    save();
    return cat;
  }

  function renameCategory(catId, newName){
    const c = state.categories.find(x => x.id === catId);
    if (!c) return false;
    if (catId === 'c_all' || catId === 'c_fav') return false;
    const n = String(newName||'').trim();
    if (!n) return false;
    if (state.categories.some(x => x.id !== catId && x.name.toLowerCase() === n.toLowerCase())) return false;
    c.name = n;
    save();
    return true;
  }

  function deleteCategory(catId){
    if (catId === 'c_all' || catId === 'c_fav') return false;
    const idx = state.categories.findIndex(c => c.id === catId);
    if (idx < 0) return false;

    const fallback = state.categories.find(c => c.id === 'c_ot')?.id || 'c_all';
    for (const p of state.products){
      if (p.categoryId === catId) p.categoryId = fallback;
    }
    state.categories.splice(idx, 1);
    if (state.ops.selectedCategoryId === catId) state.ops.selectedCategoryId = 'c_all';
    save();
    return true;
  }

  /* =========================
     PRODUCTS
  ========================== */
  function findProductByBarcode(code){
    const c = String(code||'').trim();
    if (!c) return null;
    return state.products.find(p => String(p.barcode||'').trim() === c) || null;
  }

  function addOrUpdateProduct(prod){
    const barcode = String(prod.barcode||'').trim();
    if (barcode){
      const dup = state.products.find(p => p.id !== prod.id && String(p.barcode||'').trim() === barcode);
      if (dup) return { ok:false, msg:'Barcode ya existe' };
    }
    if (prod.id){
      const p = state.products.find(x => x.id === prod.id);
      if (!p) return { ok:false, msg:'Producto no encontrado' };
      Object.assign(p, prod);
      save();
      return { ok:true, product:p };
    }
    const pnew = { ...prod, id: 'P-' + uid() };
    state.products.push(pnew);
    save();
    return { ok:true, product:pnew };
  }

  function deleteProduct(id){
    const idx = state.products.findIndex(p => p.id === id);
    if (idx < 0) return false;
    state.products.splice(idx, 1);
    save();
    return true;
  }

  /* =========================
     CART
  ========================== */
  function cartTotals(){
    const total = state.cart.lines.reduce((s,l) => s + (Number(l.price) * Number(l.qty||0)), 0);
    return { total, subtotal: total };
  }

  function cartAddProduct(p, qty=1){
    if (!p) return;
    const key = p.id || p.barcode || p.name;
    const lines = state.cart.lines;
    const idx = lines.findIndex(l => l.key === key && !l.isManual);
    if (idx >= 0) lines[idx].qty += qty;
    else lines.push({
      key,
      productId: p.id,
      barcode: p.barcode || '',
      name: p.name,
      price: Number(p.price||0),
      cost: p.cost == null ? null : Number(p.cost),
      qty,
      isManual:false
    });
    save();
    renderAll();
  }

  function cartAddManual(amount, name){
    const a = Number(amount||0);
    if (!(a > 0)) return false;
    state.cart.lines.push({
      key: 'M-' + uid(),
      productId: null,
      barcode: '',
      name: String(name||'Importe').trim() || 'Importe',
      price: a,
      cost: null,
      qty: 1,
      isManual:true
    });
    save();
    renderAll();
    return true;
  }

  function cartRemoveLine(index){
    state.cart.lines.splice(index, 1);
    save();
    renderAll();
  }

  function cartSetQty(index, qty){
    const q = Math.max(0, Math.floor(Number(qty||0)));
    if (q <= 0) return cartRemoveLine(index);
    state.cart.lines[index].qty = q;
    save();
    renderAll();
  }

  function cartInc(index, delta){
    const l = state.cart.lines[index];
    if (!l) return;
    cartSetQty(index, (l.qty||0) + delta);
  }

  function cartClear(){
    state.cart = { lines: [], note: '' };
    save();
    renderAll();
  }

  /* =========================
     PARKED
  ========================== */
  function renderParkBadge(){
    if (!el.parkBadge) return;
    const n = state.parked.length;
    el.parkBadge.hidden = n <= 0;
    el.parkBadge.textContent = String(n);
  }

  function openParkModal(){
    openModal(el.modalPark);
    renderParkList();
  }

  function parkNow(nameOpt){
    if (!state.cart.lines.length) return toast('No hay líneas');
    const item = { id:'K-' + uid(), name: String(nameOpt||'').trim(), cart: JSON.parse(JSON.stringify(state.cart)), ts: Date.now() };
    state.parked.unshift(item);
    cartClear();
    save();
    renderParkBadge();
    renderParkList();
    toast('Aparcado');
  }

  function restoreParked(id){
    const idx = state.parked.findIndex(x => x.id === id);
    if (idx < 0) return;
    if (state.cart.lines.length){
      if (!confirm('Hay un ticket en curso. ¿Reemplazarlo por el aparcado?')) return;
    }
    state.cart = state.parked[idx].cart;
    state.parked.splice(idx, 1);
    save();
    renderAll();
    renderParkBadge();
    renderParkList();
    closeModal(el.modalPark);
    toast('Recuperado');
  }

  function deleteParked(id){
    const idx = state.parked.findIndex(x => x.id === id);
    if (idx < 0) return;
    state.parked.splice(idx, 1);
    save();
    renderParkBadge();
    renderParkList();
  }

  function renderParkList(){
    if (!el.parkList) return;
    el.parkList.innerHTML = '';
    if (!state.parked.length){
      const div = document.createElement('div');
      div.className = 'muted';
      div.textContent = 'No hay aparcados.';
      el.parkList.appendChild(div);
      return;
    }
    for (const it of state.parked){
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
      div.querySelector('[data-act="restore"]').addEventListener('click', () => restoreParked(it.id));
      div.querySelector('[data-act="del"]').addEventListener('click', () => deleteParked(it.id));
      el.parkList.appendChild(div);
    }
  }

  /* =========================
     TICKET / PRINT / EMAIL
  ========================== */
  function nextTicketNo(){
    const n = state.counters.ticketSeq || 1;
    state.counters.ticketSeq = n + 1;
    save();
    return `T-${String(n).padStart(6,'0')}`;
  }

  function buildTicketHTML(s){
    const head = `
      <div style="text-align:center; font-weight:900; margin-bottom:4px;">${escapeHtml(state.settings.shopName)}</div>
      <div style="text-align:center; margin-bottom:8px;">${escapeHtml(state.settings.shopSub)}</div>
      <div style="border-top:1px dashed #000; margin:6px 0;"></div>
      <div>${escapeHtml(s.ticketNo)}  ${escapeHtml(s.dateStr)}</div>
      <div>Caja: ${escapeHtml(s.box)}  Cajero: ${escapeHtml(s.user)}</div>
      <div>Método: ${escapeHtml(s.payMethod.toUpperCase())}</div>
      <div style="border-top:1px dashed #000; margin:6px 0;"></div>
    `;

    const body = (s.lines || []).map(l => {
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
      ${(s.payMethod === 'efectivo' || s.payMethod === 'mixto') ? `<div>Entregado: ${fmtMoney(s.given||0)} €</div>` : ``}
      ${(s.payMethod === 'efectivo' || s.payMethod === 'mixto') ? `<div>Cambio: ${fmtMoney(s.change||0)} €</div>` : ``}
      ${s.note ? `<div>Nota: ${escapeHtml(s.note)}</div>` : ``}
      <div style="border-top:1px dashed #000; margin:6px 0;"></div>
      <div style="text-align:center; margin-top:6px;">${escapeHtml(state.settings.footerText || 'Gracias por su compra')}</div>
      <div style="text-align:center; margin-top:4px;">IVA incluido en los precios</div>
      <div style="height:14mm"></div>
    `;

    return `<div>${head}${body}${foot}</div>`;
  }

  function printHTML(html){
    if (!state.settings.printOn) return toast('Impresión OFF');
    if (!el.printArea) return;
    el.printArea.innerHTML = html;
    window.print();
  }

  function printSale(s){
    if (!state.settings.printOn) return toast('Impresión OFF');
    printHTML(buildTicketHTML(s));
  }

  function buildReceiptText(s){
    const out = [];
    out.push(state.settings.shopName);
    out.push(state.settings.shopSub);
    out.push('------------------------------');
    out.push(`${s.ticketNo}   ${s.dateStr}`);
    out.push(`Caja: ${s.box}   Cajero: ${s.user}`);
    out.push(`Método: ${s.payMethod.toUpperCase()}`);
    out.push('------------------------------');
    for (const l of (s.lines||[])){
      out.push(l.name);
      out.push(`  ${l.qty} x ${fmtMoney(l.price)}  = ${fmtMoney(l.price*l.qty)}`);
    }
    out.push('------------------------------');
    out.push(`TOTAL: ${fmtMoney(s.total)} €`);
    if (s.payMethod === 'efectivo' || s.payMethod === 'mixto'){
      out.push(`Entregado: ${fmtMoney(s.given||0)} €`);
      out.push(`Cambio: ${fmtMoney(s.change||0)} €`);
    }
    if (s.note) out.push(`Nota: ${s.note}`);
    out.push('------------------------------');
    out.push(state.settings.footerText || 'Gracias por su compra');
    out.push('IVA incluido en los precios');
    return out.join('\n');
  }

  function sendEmailMailto(){
    const to = (el.emailTo?.value || '').trim();
    const extra = (el.emailMsg?.value || '').trim();
    const last = getLastSale() || buildPreviewSale();
    const subject = `Ticket ${last.ticketNo} - ${state.settings.shopName}`;
    const body = buildReceiptText(last) + (extra ? `\n\n${extra}` : '');
    const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = url;
    closeModal(el.modalEmail);
  }

  function getLastSale(){
    const lastId = state.ops.traySaleIds[state.ops.traySaleIds.length - 1];
    if (lastId){
      const s = state.sales.find(x => x.id === lastId);
      if (s) return s;
    }
    return state.sales[state.sales.length - 1] || null;
  }

  function buildPreviewSale(){
    const { total } = cartTotals();
    return {
      id: 'PREVIEW',
      ticketNo: '(PREVIEW)',
      dateKey: dateKey(),
      dateStr: nowEs(),
      timeStr: timeHM(),
      box: state.settings.boxName,
      user: state.session.user.name,
      payMethod: 'preview',
      lines: state.cart.lines.map(l => ({ name:l.name, qty:l.qty, price:l.price })),
      total,
      given: 0,
      change: 0,
      note: state.cart.note || ''
    };
  }

  /* =========================
     CHANGE FLASH (3s)
  ========================== */
  function showChangeFlash(amount){
    if (!el.changeFlash || !el.changeFlashValue) return;
    el.changeFlashValue.textContent = fmtEUR(amount);
    el.changeFlash.hidden = false;
    setTimeout(() => { el.changeFlash.hidden = true; }, 3000);
  }

  /* =========================
     SALES + TRAY + SUMMARY
  ========================== */
  function pushToTray(saleId){
    normalizeOpenDay();
    state.ops.traySaleIds.push(saleId);
    save();
  }

  function calcSummaryForTray(){
    normalizeOpenDay();
    const ids = new Set(state.ops.traySaleIds);
    const sales = state.sales.filter(s => ids.has(s.id));
    const tickets = sales.length;
    const total = sales.reduce((sum,s)=>sum+(Number(s.total)||0),0);

    const cash = sales.reduce((sum,s)=>{
      if (s.payMethod === 'efectivo') return sum + (Number(s.total)||0);
      if (s.payMethod === 'mixto') return sum + (Number(s.split?.cash)||0);
      return sum;
    },0);

    const card = sales.reduce((sum,s)=>{
      if (s.payMethod === 'tarjeta') return sum + (Number(s.total)||0);
      if (s.payMethod === 'mixto') return sum + (Number(s.split?.card)||0);
      return sum;
    },0);

    return { tickets, total, cash, card, sales };
  }

  function renderTrayTable(){
    if (!el.trayTable) return;
    const thead = el.trayTable.querySelector('.trow.thead');
    el.trayTable.innerHTML = '';
    if (thead) el.trayTable.appendChild(thead);

    const { sales } = calcSummaryForTray();
    const last = sales.slice(-120).reverse();

    for (const s of last){
      const row = document.createElement('div');
      row.className = 'trow';
      row.innerHTML = `
        <div class="tcell mono">${escapeHtml(s.timeStr || '')}</div>
        <div class="tcell mono">${escapeHtml(s.ticketNo)}</div>
        <div class="tcell">${escapeHtml(s.payMethod)}</div>
        <div class="tcell tcell-right mono">${fmtMoney(s.total)} €</div>
        <div class="tcell tcell-right">
          <button class="btn btn-ghost btn-small" type="button">Imprimir</button>
        </div>
      `;
      row.querySelector('button').addEventListener('click', () => {
        if (!state.settings.printOn) return toast('Impresión OFF');
        printSale(s);
      });
      el.trayTable.appendChild(row);
    }

    if (!last.length){
      const empty = document.createElement('div');
      empty.style.padding = '10px 12px';
      empty.className = 'muted';
      empty.textContent = 'Bandeja vacía.';
      el.trayTable.appendChild(empty);
    }
  }

  function renderQuickStats(){
    const { tickets, total, cash, card } = calcSummaryForTray();
    if (el.statTickets) el.statTickets.textContent = String(tickets);
    if (el.statTotal) el.statTotal.textContent = fmtEUR(total);
    if (el.statCash) el.statCash.textContent = fmtEUR(cash);
    if (el.statCard) el.statCard.textContent = fmtEUR(card);

    const lastZ = state.zClosures.slice(-1)[0];
    if (el.zLastInfo){
      el.zLastInfo.textContent = lastZ
        ? `Último Z: ${lastZ.dateKey} · esperado ${fmtEUR(lastZ.expectedCash)} · contado ${fmtEUR(lastZ.countedCash)} · dif ${fmtEUR(lastZ.diff)}`
        : 'Último Z: —';
    }
  }

  /* =========================
     REPORTS (per day rows)
  ========================== */
  function ymdToDate(ymd){
    const [y,m,d] = String(ymd).split('-').map(n => Number(n));
    return new Date(y, (m||1)-1, d||1);
  }

  function addDays(ymd, delta){
    const d = ymdToDate(ymd);
    d.setDate(d.getDate() + delta);
    return dateKey(d);
  }

  function startOfWeek(ymd){
    const d = ymdToDate(ymd);
    const day = d.getDay(); // 0 Sun ... 6 Sat
    const diff = (day === 0 ? -6 : 1 - day); // Monday start
    d.setDate(d.getDate() + diff);
    return dateKey(d);
  }

  function endOfWeek(ymd){
    return addDays(startOfWeek(ymd), 6);
  }

  function startOfMonth(ymd){
    const d = ymdToDate(ymd);
    d.setDate(1);
    return dateKey(d);
  }

  function endOfMonth(ymd){
    const d = ymdToDate(ymd);
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    return dateKey(d);
  }

  function between(ymd, from, to){
    return ymd >= from && ymd <= to;
  }

  function getDayRow(dayKey){
    // If day is closed by Z => use zClosures entry for that day
    const z = state.zClosures.find(x => x.dateKey === dayKey);
    if (z){
      return {
        dateKey: dayKey,
        tickets: z.tickets,
        cash: z.cash,
        card: z.card,
        total: z.total,
        closed: true,
        diff: z.diff
      };
    }

    // If day is current open day and has tray sales => compute from tray when openDateKey matches
    if (dayKey === state.ops.openDateKey){
      const { tickets, total, cash, card } = calcSummaryForTray();
      return { dateKey: dayKey, tickets, cash, card, total, closed: false, diff: null };
    }

    // Otherwise compute from sales history for that day (fallback)
    const sales = state.sales.filter(s => s.dateKey === dayKey);
    const tickets = sales.length;
    const total = sales.reduce((sum,s)=>sum+(Number(s.total)||0),0);
    const cash = sales.reduce((sum,s)=>{
      if (s.payMethod === 'efectivo') return sum + (Number(s.total)||0);
      if (s.payMethod === 'mixto') return sum + (Number(s.split?.cash)||0);
      return sum;
    },0);
    const card = sales.reduce((sum,s)=>{
      if (s.payMethod === 'tarjeta') return sum + (Number(s.total)||0);
      if (s.payMethod === 'mixto') return sum + (Number(s.split?.card)||0);
      return sum;
    },0);
    return { dateKey: dayKey, tickets, cash, card, total, closed: false, diff: null };
  }

  function listDaysInRange(from, to){
    const out = [];
    let cur = from;
    while (cur <= to){
      out.push(cur);
      cur = addDays(cur, 1);
      // safety
      if (out.length > 4000) break;
    }
    return out;
  }

  function applyRangeMode(mode){
    state.ops.rangeMode = mode;
    const today = dateKey();
    if (mode === 'day'){
      state.ops.rangeFrom = today;
      state.ops.rangeTo = today;
    } else if (mode === 'week'){
      state.ops.rangeFrom = startOfWeek(today);
      state.ops.rangeTo = endOfWeek(today);
    } else if (mode === 'month'){
      state.ops.rangeFrom = startOfMonth(today);
      state.ops.rangeTo = endOfMonth(today);
    } // custom keeps inputs
    save();
    renderRangeUI();
    renderReportTable();
  }

  function renderRangeUI(){
    el.rangeBtns.forEach(b => {
      const on = b.dataset.range === state.ops.rangeMode;
      b.classList.toggle('is-active', on);
    });
    if (el.repFrom) el.repFrom.value = state.ops.rangeFrom;
    if (el.repTo) el.repTo.value = state.ops.rangeTo;
  }

  function renderReportTable(){
    if (!el.reportTable) return;
    const thead = el.reportTable.querySelector('.trow.thead');
    el.reportTable.innerHTML = '';
    if (thead) el.reportTable.appendChild(thead);

    const from = state.ops.rangeFrom || dateKey();
    const to = state.ops.rangeTo || dateKey();
    const days = listDaysInRange(from, to);

    for (const dk of days){
      const rowData = getDayRow(dk);
      const row = document.createElement('div');
      row.className = 'trow';
      row.innerHTML = `
        <div class="tcell mono">${escapeHtml(dk)}</div>
        <div class="tcell mono">${escapeHtml(String(rowData.tickets))}</div>
        <div class="tcell mono">${fmtMoney(rowData.cash)} €</div>
        <div class="tcell mono">${fmtMoney(rowData.card)} €</div>
        <div class="tcell tcell-right mono">${fmtMoney(rowData.total)} €</div>
      `;
      el.reportTable.appendChild(row);
    }

    if (!days.length){
      const empty = document.createElement('div');
      empty.style.padding = '10px 12px';
      empty.className = 'muted';
      empty.textContent = 'Sin datos.';
      el.reportTable.appendChild(empty);
    }
  }

  /* =========================
     Z CLOSURE
  ========================== */
  function openZModal(){
    requireAdminOrPrompt(() => {
      const sum = calcSummaryForTray();
      const expected = sum.cash;
      if (el.zExpected){
        el.zExpected.textContent = `Día: ${state.ops.openDateKey} · Tickets: ${sum.tickets} · Total: ${fmtEUR(sum.total)} · Efectivo esperado: ${fmtEUR(expected)} · Tarjeta: ${fmtEUR(sum.card)}`;
      }
      if (el.zCashCounted) el.zCashCounted.value = '';
      if (el.zNote) el.zNote.value = '';
      if (el.zDiff) el.zDiff.textContent = '—';
      openModal(el.modalZ);
    });
  }

  function updateZDiffLive(){
    const sum = calcSummaryForTray();
    const expected = sum.cash;
    const counted = parseMoney(el.zCashCounted?.value || '0');
    const diff = counted - expected;
    if (el.zDiff){
      const sign = diff > 0 ? '+' : '';
      el.zDiff.textContent = `${sign}${fmtMoney(diff)} €`;
    }
  }

  function buildZTicketHTML(z){
    const sign = z.diff > 0 ? '+' : '';
    return `
      <div style="text-align:center; font-weight:900; margin-bottom:4px;">${escapeHtml(state.settings.shopName)}</div>
      <div style="text-align:center; margin-bottom:8px;">${escapeHtml(state.settings.shopSub)}</div>
      <div style="border-top:1px dashed #000; margin:6px 0;"></div>
      <div style="font-weight:900;">CIERRE Z</div>
      <div>Día: ${escapeHtml(z.dateKey)}</div>
      <div>Hora: ${escapeHtml(nowEs())}</div>
      <div>Caja: ${escapeHtml(state.settings.boxName)}  Cajero: ${escapeHtml(state.session.user.name)}</div>
      <div style="border-top:1px dashed #000; margin:6px 0;"></div>

      <div style="display:flex; justify-content:space-between;"><div>Tickets</div><div>${z.tickets}</div></div>
      <div style="display:flex; justify-content:space-between;"><div>Total</div><div>${fmtMoney(z.total)} €</div></div>
      <div style="display:flex; justify-content:space-between;"><div>Efectivo</div><div>${fmtMoney(z.cash)} €</div></div>
      <div style="display:flex; justify-content:space-between;"><div>Tarjeta</div><div>${fmtMoney(z.card)} €</div></div>

      <div style="border-top:1px dashed #000; margin:6px 0;"></div>
      <div style="display:flex; justify-content:space-between;"><div>Esperado</div><div>${fmtMoney(z.expectedCash)} €</div></div>
      <div style="display:flex; justify-content:space-between;"><div>Contado</div><div>${fmtMoney(z.countedCash)} €</div></div>
      <div style="display:flex; justify-content:space-between; font-weight:900;">
        <div>DESCUADRE</div><div>${sign}${fmtMoney(z.diff)} €</div>
      </div>
      ${z.note ? `<div style="margin-top:6px;">Nota: ${escapeHtml(z.note)}</div>` : ``}

      <div style="border-top:1px dashed #000; margin:6px 0;"></div>
      <div style="text-align:center; margin-top:6px;">Fin de día</div>
      <div style="height:14mm"></div>
    `;
  }

  function closeDayZ(){
    const sum = calcSummaryForTray();
    if (sum.tickets <= 0) return toast('Bandeja vacía');

    const expectedCash = sum.cash;
    const countedCash = parseMoney(el.zCashCounted?.value || '0');
    const diff = countedCash - expectedCash;

    const z = {
      id: 'Z-' + uid(),
      dateKey: state.ops.openDateKey,
      tickets: sum.tickets,
      total: sum.total,
      cash: sum.cash,
      card: sum.card,
      expectedCash,
      countedCash,
      diff,
      note: (el.zNote?.value || '').trim(),
      ts: Date.now(),
      printed: false
    };

    state.zClosures.push(z);
    save();

    closeModal(el.modalZ);

    // Imprimir Z (si impresión ON)
    if (state.settings.printOn){
      printHTML(buildZTicketHTML(z));
      z.printed = true;
      save();
    }

    // LIMPIAR SOLO BANDEJA DE ESE DÍA
    state.ops.traySaleIds = [];
    save();

    // UI refresh
    renderAll();

    // confirm toast
    const sign = diff > 0 ? '+' : '';
    toast(`Z cerrado · Descuadre ${sign}${fmtMoney(diff)} €`);
  }

  /* =========================
     PAY FLOWS
  ========================== */
  function buildSaleFromCart(payMethod, opts = {}){
    const { total } = cartTotals();
    const dk = dateKey();
    const tsNow = Date.now();

    return {
      id: uid(),
      ticketNo: nextTicketNo(),
      dateKey: dk,
      dateStr: nowEs(),
      timeStr: timeHM(),
      box: state.settings.boxName,
      user: state.session.user.name,
      payMethod,
      lines: state.cart.lines.map(l => ({
        name: l.name,
        barcode: l.barcode || '',
        qty: Number(l.qty||0),
        price: Number(l.price||0),
        cost: l.cost == null ? null : Number(l.cost),
        isManual: !!l.isManual
      })),
      total,
      given: Number(opts.given || 0),
      change: Number(opts.change || 0),
      split: opts.split || null,
      note: String(opts.note || '').trim(),
      ts: tsNow
    };
  }

  function closeTicketCommon(sale, { showChange } = { showChange:false }){
    // Guardar venta (histórico)
    state.sales.push(sale);
    save();

    // Meter en bandeja del día (operativa)
    // SOLO si coincide con openDateKey
    normalizeOpenDay();
    if (sale.dateKey === state.ops.openDateKey) pushToTray(sale.id);

    // BIP al cierre (siempre)
    beep();

    // Imprimir (si impresión ON y autoPrint ON)
    if (state.settings.printOn && state.settings.autoPrint){
      printSale(sale);
    }

    // Cambio flash 3s si procede
    if (showChange && sale.change > 0) showChangeFlash(sale.change);

    // Limpiar inputs rápidos
    if (el.cashGiven) el.cashGiven.value = '';
    if (el.cashChange) el.cashChange.value = '0,00';
    if (el.searchInput) el.searchInput.value = '';
    if (el.barcodeInput) el.barcodeInput.value = '';

    // Vaciar carrito
    cartClear();

    // Actualiza UI ticket number preview
    renderHeader();
    renderAll();

    // Foco a escaneo
    focusBarcodeSoon();
  }

  function payCardOneTap(){
    const { total } = cartTotals();
    if (!(total > 0)) return toast('No hay líneas');
    const sale = buildSaleFromCart('tarjeta', { given: 0, change: 0, note: state.cart.note || '' });
    closeTicketCommon(sale, { showChange:false });
  }

  function cashRecalcChange(){
    const { total } = cartTotals();
    const given = parseMoney(el.cashGiven?.value || '0');
    const change = Math.max(0, given - total);
    if (el.cashChange) el.cashChange.value = fmtMoney(change);
  }

  function cashAddBill(amount){
    const current = parseMoney(el.cashGiven?.value || '0');
    const next = current + Number(amount || 0);
    if (el.cashGiven) el.cashGiven.value = fmtMoney(next).replace('.', ',');
    cashRecalcChange();
  }

  function cashExact(){
    const { total } = cartTotals();
    if (el.cashGiven) el.cashGiven.value = fmtMoney(total).replace('.', ',');
    cashRecalcChange();
  }

  function cashClear(){
    if (el.cashGiven) el.cashGiven.value = '';
    if (el.cashChange) el.cashChange.value = '0,00';
  }

  function payCash(){
    const { total } = cartTotals();
    if (!(total > 0)) return toast('No hay líneas');

    const given = parseMoney(el.cashGiven?.value || '0');
    const change = Math.max(0, given - total);

    if (given < total){
      if (!confirm('Entregado menor que total. ¿Confirmar igualmente?')) return;
    }

    const sale = buildSaleFromCart('efectivo', { given, change, note: state.cart.note || '' });
    closeTicketCommon(sale, { showChange:true });
  }

  function openDetailsModal(mode = 'mixto'){
    const { total } = cartTotals();
    if (!(total > 0)) return toast('No hay líneas');
    if (el.detMethod) el.detMethod.value = mode;
    if (el.detNote) el.detNote.value = state.cart.note || '';
    if (el.detCash) el.detCash.value = '';
    if (el.detCard) el.detCard.value = '';
    updateDetailsUI();
    openModal(el.modalDetails);
  }

  function updateDetailsUI(){
    const m = el.detMethod?.value || 'mixto';
    if (el.detMixWrap) el.detMixWrap.style.display = (m === 'mixto') ? '' : 'none';
  }

  function confirmDetailsPay(){
    const { total } = cartTotals();
    if (!(total > 0)) return toast('No hay líneas');

    const method = (el.detMethod?.value || 'mixto').toLowerCase();
    const note = (el.detNote?.value || '').trim();

    if (method === 'tarjeta'){
      closeModal(el.modalDetails);
      // tarjeta normal (no 1-toque), pero igual cierra sin más
      const sale = buildSaleFromCart('tarjeta', { given: 0, change: 0, note });
      closeTicketCommon(sale, { showChange:false });
      return;
    }

    if (method === 'efectivo'){
      // lo tratamos como efectivo, con input de panel si existe
      closeModal(el.modalDetails);
      const given = parseMoney(el.cashGiven?.value || '0');
      const change = Math.max(0, given - total);
      const sale = buildSaleFromCart('efectivo', { given, change, note });
      closeTicketCommon(sale, { showChange:true });
      return;
    }

    // mixto
    const cash = parseMoney(el.detCash?.value || '0');
    const card = parseMoney(el.detCard?.value || '0');

    if ((cash + card) < total){
      if (!confirm('Mixto: efectivo+tarjeta menor que total. ¿Confirmar igualmente?')) return;
    }

    const remaining = Math.max(0, total - card);
    const change = Math.max(0, cash - remaining);

    const sale = buildSaleFromCart('mixto', {
      given: cash,
      change,
      split: { cash, card },
      note
    });

    closeModal(el.modalDetails);
    closeTicketCommon(sale, { showChange:true });
  }

  /* =========================
     QUICK AMOUNT + KEYPADS (manual add => BIP)
  ========================== */
  function keypadInsert(targetInput, k){
    const inp = targetInput;
    if (!inp) return;
    let v = String(inp.value || '');
    if (k === 'c'){ inp.value = ''; return; }
    if (k === 'bk'){ inp.value = v.slice(0,-1); return; }
    if (k === '.'){
      if (v.includes(',') || v.includes('.')) return;
      inp.value = v + ',';
      return;
    }
    if (k === 'ok') return;
    inp.value = v + String(k);
  }

  function quickOk(){
    const amt = parseMoney(el.quickAmount?.value || '0');
    const name = (el.quickName?.value || 'Importe').trim();
    if (!(amt > 0)) return toast('Importe inválido');
    const ok = cartAddManual(amt, name);
    if (!ok) return;

    // BIP por manual add
    beep();

    closeModal(el.modalQuick);
    if (el.quickAmount) el.quickAmount.value = '';
    if (el.quickName) el.quickName.value = '';
    toast('Añadido');
    focusBarcodeSoon();
  }

  function openCashKeypad(){
    const v = (el.cashGiven?.value || '').trim();
    if (el.cashKeypadValue) el.cashKeypadValue.value = v;
    openModal(el.modalCashKeypad);
  }

  function cashKeypadApply(){
    const v = (el.cashKeypadValue?.value || '').trim();
    if (el.cashGiven) el.cashGiven.value = v;
    cashRecalcChange();
    closeModal(el.modalCashKeypad);
    focusBarcodeSoon();
  }

  /* =========================
     CATEGORIES UI
  ========================== */
  function renderCategoryChips(){
    if (!el.catChips) return;
    el.catChips.innerHTML = '';
    for (const c of state.categories){
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cat-chip' + (state.ops.selectedCategoryId === c.id ? ' is-active' : '');
      b.textContent = c.name;
      b.addEventListener('click', () => {
        state.ops.selectedCategoryId = c.id;
        save();
        renderCategoryChips();
        renderProductGrid();
      });
      el.catChips.appendChild(b);
    }
  }

  function listProductsForSelectedCategory(){
    const catId = state.ops.selectedCategoryId || 'c_all';
    const q = String(el.searchInput?.value || '').trim().toLowerCase();
    let items = state.products.slice();

    if (catId === 'c_fav') items = items.filter(p => !!p.fav);
    else if (catId !== 'c_all') items = items.filter(p => p.categoryId === catId);

    if (q){
      items = items.filter(p =>
        (p.name||'').toLowerCase().includes(q) ||
        String(p.barcode||'').includes(q)
      );
    }

    items.sort((a,b) => (Number(!!b.fav) - Number(!!a.fav)) || (a.name||'').localeCompare(b.name||''));
    return items.slice(0, 48);
  }

  function renderProductGrid(){
    if (!el.prodGrid) return;
    el.prodGrid.innerHTML = '';

    // tile: importe rápido
    el.prodGrid.appendChild(makeProdTile('Importe rápido', 'Manual', 'Teclado', () => openModal(el.modalQuick)));

    const items = listProductsForSelectedCategory();
    for (const p of items){
      const sub = p.barcode ? `BC: ${p.barcode}` : 'Manual';
      const btn = makeProdTile(p.name, fmtEUR(p.price||0), sub, () => cartAddProduct(p, 1));
      // click derecho => editar (admin)
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        requireAdminOrPrompt(() => openEditProduct(p.id));
      });
      el.prodGrid.appendChild(btn);
    }
  }

  function makeProdTile(name, price, sub, onClick){
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

  /* =========================
     TICKET RENDER
  ========================== */
  function renderTicketLines(){
    if (!el.ticketLines) return;
    const thead = el.ticketLines.querySelector('.trow.thead');
    el.ticketLines.innerHTML = '';
    if (thead) el.ticketLines.appendChild(thead);

    state.cart.lines.forEach((l, idx) => {
      const row = document.createElement('div');
      row.className = 'trow';
      row.setAttribute('role','row');
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

      btnMinus.addEventListener('click', () => cartInc(idx, -1));
      btnPlus.addEventListener('click', () => cartInc(idx, +1));
      qtyIn.addEventListener('change', () => cartSetQty(idx, qtyIn.value));
      qtyIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); qtyIn.blur(); focusBarcodeSoon(); }
      });

      // right click delete line
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); cartRemoveLine(idx); });

      el.ticketLines.appendChild(row);
    });
  }

  function renderTotals(){
    const { total } = cartTotals();
    if (el.linesCount) el.linesCount.textContent = String(state.cart.lines.length);
    if (el.subTotal) el.subTotal.textContent = fmtEUR(total);
    if (el.grandTotal) el.grandTotal.textContent = fmtEUR(total);
    cashRecalcChange();
  }

  /* =========================
     HEADER RENDER
  ========================== */
  function renderHeader(){
    setTheme(state.settings.theme || 'day');
    renderPrintState();

    if (el.userLabel) el.userLabel.textContent = state.session.user?.name || 'CAJERO';
    if (el.posUser) el.posUser.textContent = state.session.user?.name || 'CAJERO';

    if (el.shopName) el.shopName.textContent = state.settings.shopName || '';
    if (el.shopSub) el.shopSub.textContent = state.settings.shopSub || '';
    if (el.posBox) el.posBox.textContent = state.settings.boxName || 'CAJA-1';

    if (el.ticketDate) el.ticketDate.textContent = nowEs();

    const seq = state.counters.ticketSeq || 1;
    if (el.ticketNo) el.ticketNo.textContent = `T-${String(seq).padStart(6,'0')}`;

    if (el.scanDot) el.scanDot.style.opacity = state.settings.alwaysScan ? '1' : '.35';

    renderAdminState();
    renderParkBadge();
  }

  /* =========================
     PRODUCTS TABLE + IMPORT/EXPORT
  ========================== */
  function renderProductsTable(){
    const table = $('#productsTable');
    if (!table) return;

    // filter selects
    const sel = $('#prodSearchCat');
    if (sel) fillCategorySelect(sel, true);

    const thead = table.querySelector('.trow.thead');
    table.innerHTML = '';
    if (thead) table.appendChild(thead);

    const qName = String($('#prodSearchName')?.value || '').trim().toLowerCase();
    const qBar  = String($('#prodSearchBarcode')?.value || '').trim();
    const qCat  = String($('#prodSearchCat')?.value || '').trim();

    let items = state.products.slice();
    if (qName) items = items.filter(p => (p.name||'').toLowerCase().includes(qName));
    if (qBar)  items = items.filter(p => String(p.barcode||'').includes(qBar));
    if (qCat)  items = items.filter(p => p.categoryId === qCat);
    items.sort((a,b) => (a.name||'').localeCompare(b.name||''));

    for (const p of items){
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
        <div class="tcell tcell-right mono">${fmtMoney(p.price||0)}</div>
        <div class="tcell tcell-right mono">${p.cost==null?'—':fmtMoney(p.cost)}</div>
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
      table.appendChild(row);
    }
  }

  function exportProductsCSV(){
    const rows = [['barcode','nombre','pvp','coste','categoria','fav','unidad']];
    for (const p of state.products){
      rows.push([
        p.barcode || '',
        p.name || '',
        fmtMoney(p.price||0),
        (p.cost==null?'':fmtMoney(p.cost)),
        getCatName(p.categoryId),
        p.fav ? '1':'0',
        p.unit || 'ud'
      ]);
    }
    downloadText('tpv_productos.csv', toCSV(rows), 'text/csv');
  }

  function exportTraySalesCSV(){
    const { sales } = calcSummaryForTray();
    const rows = [['fecha','hora','ticket','pago','total','cajero','caja','lineas']];
    for (const s of sales){
      rows.push([
        s.dateKey, s.timeStr, s.ticketNo, s.payMethod, fmtMoney(s.total||0), s.user, s.box,
        (s.lines||[]).map(l => `${l.name}(${l.qty}x${fmtMoney(l.price)})`).join(' | ')
      ]);
    }
    downloadText(`tpv_ventas_bandeja_${state.ops.openDateKey}.csv`, toCSV(rows), 'text/csv');
  }

  function backupJSON(){
    downloadText('tpv_backup.json', JSON.stringify(state, null, 2), 'application/json');
  }

  function restoreJSONFromFile(file){
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const data = JSON.parse(String(reader.result||''));
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

  function importProductsFromCSVFile(file){
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCSV(String(reader.result||''));
      if (!rows.length) return toast('CSV vacío');

      const headers = rows[0].map(h => h.toLowerCase());
      const idx = (name) => headers.indexOf(name);

      const iBarcode = idx('barcode');
      const iNombre  = idx('nombre');
      const iPvp     = idx('pvp');
      const iCoste   = idx('coste');
      const iCat     = idx('categoria');
      const iFav     = idx('fav');
      const iUnit    = idx('unidad');

      const hasHeaders = iNombre >= 0 && iPvp >= 0;

      let imported = 0;

      for (let r=1; r<rows.length; r++){
        const row = rows[r];
        const get = (i, fallback='') => (i>=0 ? (row[i] ?? fallback) : fallback);

        const barcode = hasHeaders ? get(iBarcode,'') : (row[0] ?? '');
        const name    = hasHeaders ? get(iNombre,'')  : (row[1] ?? '');
        const pvpStr  = hasHeaders ? get(iPvp,'0')    : (row[2] ?? '0');
        const costStr = hasHeaders ? get(iCoste,'')   : (row[3] ?? '');
        const catName = hasHeaders ? get(iCat,'')     : (row[4] ?? '');
        const favStr  = hasHeaders ? get(iFav,'0')    : (row[5] ?? '0');
        const unit    = hasHeaders ? get(iUnit,'ud')  : (row[6] ?? 'ud');

        if (!String(name||'').trim()) continue;

        const price = parseMoney(pvpStr);
        const cost  = String(costStr||'').trim() ? parseMoney(costStr) : null;
        const fav   = String(favStr||'0').trim() === '1';

        let catId = state.categories.find(c => c.name.toLowerCase() === String(catName||'').trim().toLowerCase())?.id;
        if (!catId){
          const created = createCategory(String(catName||'').trim() || 'Otros');
          catId = created?.id || 'c_ot';
        }

        const res = addOrUpdateProduct({
          id: undefined,
          barcode: String(barcode||'').trim(),
          name: String(name).trim(),
          price,
          cost,
          categoryId: catId,
          fav,
          unit: String(unit||'ud').trim()
        });

        if (res.ok) imported++;
      }

      toast(`Importados: ${imported}`);
      renderAll();
    };
    reader.readAsText(file);
  }

  /* =========================
     PRODUCT MODAL
  ========================== */
  function openNewProduct(prefillBarcode=''){
    el.modalProduct.dataset.editId = '';
    if (el.prodModalTitle) el.prodModalTitle.textContent = 'Nuevo producto';
    fillCategorySelect(el.prodCat, false);

    if (el.prodBarcode) el.prodBarcode.value = prefillBarcode || '';
    if (el.prodName) el.prodName.value = '';
    if (el.prodPrice) el.prodPrice.value = '';
    if (el.prodCost) el.prodCost.value = '';
    if (el.prodCat) el.prodCat.value = state.categories.find(c=>c.id==='c_ot')?.id || state.categories.find(c=>c.id!=='c_all'&&c.id!=='c_fav')?.id || '';
    if (el.prodFav) el.prodFav.value = '1';
    if (el.prodUnit) el.prodUnit.value = 'ud';

    openModal(el.modalProduct);
  }

  function openEditProduct(id){
    const p = state.products.find(x => x.id === id);
    if (!p) return toast('Producto no encontrado');
    el.modalProduct.dataset.editId = p.id;
    if (el.prodModalTitle) el.prodModalTitle.textContent = 'Editar producto';
    fillCategorySelect(el.prodCat, false);

    el.prodBarcode.value = p.barcode || '';
    el.prodName.value = p.name || '';
    el.prodPrice.value = fmtMoney(p.price || 0).replace('.', ',');
    el.prodCost.value = p.cost==null ? '' : fmtMoney(p.cost).replace('.', ',');
    el.prodCat.value = p.categoryId || '';
    el.prodFav.value = p.fav ? '1' : '0';
    el.prodUnit.value = p.unit || 'ud';

    openModal(el.modalProduct);
  }

  function saveProductFromModal(){
    const editId = el.modalProduct.dataset.editId || '';
    const barcode = (el.prodBarcode?.value || '').trim();
    const name = (el.prodName?.value || '').trim();
    const price = parseMoney(el.prodPrice?.value || '0');
    const costRaw = (el.prodCost?.value || '').trim();
    const cost = costRaw ? parseMoney(costRaw) : null;
    const categoryId = el.prodCat?.value || 'c_ot';
    const fav = (el.prodFav?.value || '0') === '1';
    const unit = el.prodUnit?.value || 'ud';

    if (!name) return toast('Falta nombre');
    if (!(price >= 0)) return toast('Precio inválido');

    const res = addOrUpdateProduct({ id: editId || undefined, barcode, name, price, cost, categoryId, fav, unit });
    if (!res.ok) return toast(res.msg || 'Error producto');

    closeModal(el.modalProduct);
    toast('Producto guardado');
    renderAll();
  }

  /* =========================
     CATEGORIES MODAL
  ========================== */
  function openCatsModal(){
    requireAdminOrPrompt(() => {
      openModal(el.modalCats);
      renderCatsModal();
    });
  }

  function renderCatsModal(){
    if (!el.catList) return;
    el.catList.innerHTML = '';
    for (const c of state.categories){
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
      div.querySelector('[data-act="save"]')?.addEventListener('click', () => {
        const ok = renameCategory(c.id, input.value);
        if (!ok) return toast('Nombre inválido o duplicado');
        toast('Categoría renombrada');
        renderAll();
        renderCatsModal();
      });
      div.querySelector('[data-act="del"]')?.addEventListener('click', () => {
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

  function createCatFromModal(){
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
     SCANNER (GLOBAL BUFFER)
  ========================== */
  const scanner = {
    buf: '',
    lastTs: 0,
    timer: null,
    minLen: 8,
    enabled(){ return !!state.settings.alwaysScan; },
    speed(){ return Math.max(15, Math.min(120, Number(state.settings.scanSpeedMs || 35))); },
    reset(){
      scanner.buf = '';
      scanner.lastTs = 0;
      if (scanner.timer) clearTimeout(scanner.timer);
      scanner.timer = null;
    },
    pushChar(ch){
      const t = Date.now();
      const gap = scanner.lastTs ? (t - scanner.lastTs) : 0;
      const maxGap = scanner.speed();

      // gap grande => probable humano => reinicia
      if (scanner.lastTs && gap > maxGap) scanner.buf = '';

      scanner.lastTs = t;
      scanner.buf += ch;

      if (scanner.timer) clearTimeout(scanner.timer);
      scanner.timer = setTimeout(() => {
        // finalize por timeout si es suficientemente largo
        if (scanner.buf.length >= scanner.minLen) finalizeScan(scanner.buf);
        scanner.reset();
      }, maxGap + 140);
    }
  };

  function finalizeScan(code){
    const c = String(code||'').trim();
    if (!c) return;

    // no capturar si hay modal abierto
    if (document.querySelector('dialog[open]')) return;

    // Solo actuamos si parece barcode (largo mínimo)
    if (c.length < scanner.minLen) return;

    // Buscar producto
    const p = findProductByBarcode(c);
    if (p){
      cartAddProduct(p, 1);
      flashScanDot();
      // SIN BIP (scanner ya pita)
      toast('Escaneado ✓');
      if (el.barcodeInput) el.barcodeInput.value = '';
    } else {
      // alta producto con barcode
      openNewProduct(c);
      toast('Barcode no encontrado: alta producto');
    }
    focusBarcodeSoon();
  }

  function flashScanDot(){
    if (!el.scanDot) return;
    el.scanDot.style.boxShadow = '0 0 0 8px rgba(11,61,46,.22)';
    setTimeout(() => { el.scanDot.style.boxShadow = '0 0 0 5px rgba(11,61,46,.14)'; }, 180);
  }

  /* =========================
     EVENTS
  ========================== */
  function bindTabs(){
    el.tabs.forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));
  }

  function bindTop(){
    el.btnTheme?.addEventListener('click', () => setTheme(document.body.classList.contains('theme-day') ? 'night' : 'day'));

    el.btnPrintToggle?.addEventListener('click', () => setPrintOn(!state.settings.printOn));

    el.btnLogin?.addEventListener('click', () => openModal(el.modalLogin));
    el.btnAdmin?.addEventListener('click', () => openModal(el.modalAdmin));
    el.btnAdminUnlock?.addEventListener('click', () => openModal(el.modalAdmin));

    // allow audio on first gesture
    document.addEventListener('pointerdown', ensureAudio, { once:true });
  }

  function bindModals(){
    el.backdrop?.addEventListener('click', () => {
      const open = document.querySelector('dialog[open]');
      if (open) closeModal(open);
    });

    el.closeBtns.forEach(b => b.addEventListener('click', () => closeModal(document.getElementById(b.dataset.close))));

    // login
    el.btnLoginOk?.addEventListener('click', async () => {
      const res = await login(el.loginUser?.value || '', el.loginPass?.value || '');
      if (!res.ok) return toast(res.msg || 'Login error');
      closeModal(el.modalLogin);
      toast('Sesión iniciada');
      renderHeader();
    });

    // admin
    el.btnAdminOk?.addEventListener('click', async () => {
      const pin = (el.adminPin?.value || '').trim();
      if (pin.length < 4) return toast('PIN inválido');
      if (!(await verifyAdminPin(pin))) return toast('PIN incorrecto');
      unlockAdmin(5);
      closeModal(el.modalAdmin);
      toast('Admin desbloqueado');
    });

    // details
    el.detMethod?.addEventListener('change', updateDetailsUI);
    el.btnDetailsPay?.addEventListener('click', confirmDetailsPay);

    // quick modal
    el.btnQuickOk?.addEventListener('click', quickOk);
    el.keypadQuick?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-k]');
      if (!btn) return;
      const k = btn.dataset.k;
      if (k === 'ok') return quickOk();
      keypadInsert(el.quickAmount, k);
    });

    // cash keypad modal
    el.keypadCash?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-k]');
      if (!btn) return;
      const k = btn.dataset.k;
      if (k === 'ok') return;
      keypadInsert(el.cashKeypadValue, k);
    });
    el.btnCashKeypadOk?.addEventListener('click', cashKeypadApply);

    // product modal
    el.btnProductSave?.addEventListener('click', saveProductFromModal);

    // cats modal
    el.btnCreateCat?.addEventListener('click', createCatFromModal);

    // park modal
    el.btnParkNow?.addEventListener('click', () => parkNow(el.parkName?.value || ''));

    // Z modal live diff
    el.zCashCounted?.addEventListener('input', updateZDiffLive);
    el.btnZOk?.addEventListener('click', () => {
      requireAdminOrPrompt(closeDayZ);
    });

    // email
    el.btnEmailSend?.addEventListener('click', sendEmailMailto);
  }

  function bindVenta(){
    // barcode input enter (manual barcode)
    el.barcodeInput?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const code = (el.barcodeInput.value || '').trim();
      el.barcodeInput.value = '';
      if (!code) return;
      finalizeScan(code);
    });

    // search filter
    el.searchInput?.addEventListener('input', debounce(renderProductGrid, 80));

    // categories buttons
    el.btnNewCategory?.addEventListener('click', () => {
      requireAdminOrPrompt(() => {
        const name = prompt('Nombre de nueva categoría:', '');
        if (!name) return;
        const c = createCategory(name);
        if (!c) return toast('Nombre inválido o duplicado');
        toast('Categoría creada');
        renderAll();
      });
    });
    el.btnManageCategories?.addEventListener('click', openCatsModal);

    // add product
    el.btnAddProductInline?.addEventListener('click', () => openNewProduct(''));

    // park / quick
    el.btnPark?.addEventListener('click', openParkModal);
    el.btnQuickAmount?.addEventListener('click', () => openModal(el.modalQuick));

    // print/email/last
    el.btnPrint?.addEventListener('click', () => {
      if (!state.settings.printOn) return toast('Impresión OFF');
      const last = getLastSale();
      if (!last){
        const prev = buildPreviewSale();
        if (!(prev.total > 0)) return toast('No hay ticket');
        return printSale(prev);
      }
      printSale(last);
    });

    el.btnLastTicket?.addEventListener('click', () => {
      if (!state.settings.printOn) return toast('Impresión OFF');
      const last = getLastSale();
      if (!last) return toast('No hay último ticket');
      printSale(last);
    });

    el.btnEmailTicket?.addEventListener('click', () => openModal(el.modalEmail));

    // hybrid pay
    el.btnCardOneTap?.addEventListener('click', payCardOneTap);

    el.payModeCash?.addEventListener('click', () => {
      el.payModeCash.classList.add('is-active');
      el.payModeMix.classList.remove('is-active');
      el.payModeMore.classList.remove('is-active');
      // no modal; cash panel stays
      focusBarcodeSoon();
    });

    el.payModeMix?.addEventListener('click', () => openDetailsModal('mixto'));
    el.payModeMore?.addEventListener('click', () => openDetailsModal('mixto'));

    el.cashGiven?.addEventListener('input', cashRecalcChange);

    el.bills.forEach(b => b.addEventListener('click', () => cashAddBill(Number(b.dataset.bill || 0))));
    el.btnExact?.addEventListener('click', cashExact);
    el.btnCashKeypad?.addEventListener('click', openCashKeypad);
    el.btnCashClear?.addEventListener('click', cashClear);
    el.btnCashPay?.addEventListener('click', payCash);
  }

  function bindReportes(){
    el.btnExportSalesCsv?.addEventListener('click', exportTraySalesCSV);
    el.btnCloseZ?.addEventListener('click', openZModal);

    el.rangeBtns.forEach(b => b.addEventListener('click', () => {
      const mode = b.dataset.range;
      if (mode === 'custom'){
        state.ops.rangeMode = 'custom';
        // defaults
        if (!state.ops.rangeFrom) state.ops.rangeFrom = dateKey();
        if (!state.ops.rangeTo) state.ops.rangeTo = dateKey();
        save();
        renderRangeUI();
        renderReportTable();
        return;
      }
      applyRangeMode(mode);
    }));

    el.btnApplyRange?.addEventListener('click', () => {
      const from = el.repFrom?.value || dateKey();
      const to = el.repTo?.value || from;
      state.ops.rangeMode = 'custom';
      state.ops.rangeFrom = from <= to ? from : to;
      state.ops.rangeTo = from <= to ? to : from;
      save();
      renderRangeUI();
      renderReportTable();
    });
  }

  function bindAjustes(){
    // init inputs
    if (el.setShopName) el.setShopName.value = state.settings.shopName;
    if (el.setShopSub) el.setShopSub.value = state.settings.shopSub;
    if (el.setBoxName) el.setBoxName.value = state.settings.boxName;
    if (el.setFooterText) el.setFooterText.value = state.settings.footerText;

    if (el.setAlwaysScan) el.setAlwaysScan.value = state.settings.alwaysScan ? '1' : '0';
    if (el.setScanSpeed) el.setScanSpeed.value = String(state.settings.scanSpeedMs || 35);
    if (el.setBeep) el.setBeep.value = state.settings.beepOn ? '1' : '0';
    if (el.setAutoPrint) el.setAutoPrint.value = state.settings.autoPrint ? '1' : '0';
    if (el.setAutoLockMin) el.setAutoLockMin.value = String(state.settings.autoLockMin || 10);

    const apply = debounce(() => {
      state.settings.shopName = el.setShopName?.value || state.settings.shopName;
      state.settings.shopSub = el.setShopSub?.value || state.settings.shopSub;
      state.settings.boxName = el.setBoxName?.value || state.settings.boxName;
      state.settings.footerText = el.setFooterText?.value || state.settings.footerText;

      state.settings.alwaysScan = (el.setAlwaysScan?.value || '1') === '1';
      state.settings.scanSpeedMs = Math.max(15, Math.min(120, Number(el.setScanSpeed?.value || 35)));
      state.settings.beepOn = (el.setBeep?.value || '1') === '1';
      state.settings.autoPrint = (el.setAutoPrint?.value || '1') === '1';
      state.settings.autoLockMin = Math.max(1, Math.min(120, Number(el.setAutoLockMin?.value || 10)));

      save();
      renderHeader();
      toast('Ajustes guardados');
    }, 140);

    el.setShopName?.addEventListener('input', apply);
    el.setShopSub?.addEventListener('input', apply);
    el.setBoxName?.addEventListener('input', apply);
    el.setFooterText?.addEventListener('input', apply);
    el.setAlwaysScan?.addEventListener('change', apply);
    el.setScanSpeed?.addEventListener('input', apply);
    el.setBeep?.addEventListener('change', apply);
    el.setAutoPrint?.addEventListener('change', apply);
    el.setAutoLockMin?.addEventListener('input', apply);

    el.setAdminPin?.addEventListener('change', async () => {
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
  }

  function bindProductosIO(){
    // Buttons exist in index.html; grab them here to avoid missing refs
    const btnImport = $('#btnImportCsv');
    const btnExport = $('#btnExportCsv');
    const btnBackup = $('#btnBackupJson');
    const btnRestore = $('#btnRestoreJson');
    const btnAdd = $('#btnAddProduct');

    btnAdd?.addEventListener('click', () => openNewProduct(''));

    btnImport?.addEventListener('click', () => el.fileCsv?.click());
    el.fileCsv?.addEventListener('change', () => {
      const f = el.fileCsv.files?.[0];
      if (!f) return;
      importProductsFromCSVFile(f);
      el.fileCsv.value = '';
    });

    btnExport?.addEventListener('click', exportProductsCSV);

    btnBackup?.addEventListener('click', backupJSON);

    btnRestore?.addEventListener('click', () => el.fileJson?.click());
    el.fileJson?.addEventListener('change', () => {
      const f = el.fileJson.files?.[0];
      if (!f) return;
      restoreJSONFromFile(f);
      el.fileJson.value = '';
    });

    const rer = debounce(renderProductsTable, 80);
    $('#prodSearchName')?.addEventListener('input', rer);
    $('#prodSearchBarcode')?.addEventListener('input', rer);
    $('#prodSearchCat')?.addEventListener('change', rer);
  }

  function bindShortcuts(){
    window.addEventListener('keydown', (e) => {
      touchActivity();

      const tag = document.activeElement?.tagName?.toLowerCase();
      const typing = (tag === 'input' || tag === 'textarea' || tag === 'select');

      // F2: quick
      if (e.key === 'F2'){
        e.preventDefault();
        openModal(el.modalQuick);
        return;
      }

      // F4: cash pay
      if (e.key === 'F4'){
        e.preventDefault();
        payCash();
        return;
      }

      // ESC: close modal or clear ticket
      if (e.key === 'Escape'){
        const open = document.querySelector('dialog[open]');
        if (open){ e.preventDefault(); closeModal(open); return; }
        if (!typing && state.cart.lines.length){
          if (confirm('¿Limpiar ticket actual?')) cartClear();
        }
        return;
      }

      // DELETE: delete last line
      if ((e.key === 'Delete' || e.key === 'Supr') && !typing){
        if (!state.cart.lines.length) return;
        e.preventDefault();
        cartRemoveLine(state.cart.lines.length - 1);
        return;
      }

      // +/- last qty
      if (!typing && (e.key === '+' || e.key === '=')){
        if (!state.cart.lines.length) return;
        e.preventDefault();
        cartInc(state.cart.lines.length - 1, +1);
        return;
      }
      if (!typing && (e.key === '-' || e.key === '_')){
        if (!state.cart.lines.length) return;
        e.preventDefault();
        cartInc(state.cart.lines.length - 1, -1);
        return;
      }
    });
  }

  function bindScannerGlobal(){
    window.addEventListener('keydown', (e) => {
      if (!scanner.enabled()) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      // no capturar si hay modal abierto
      if (document.querySelector('dialog[open]')) return;

      const k = e.key;

      // finalize on Enter if buffer looks like barcode
      if (k === 'Enter'){
        if (scanner.buf.length >= scanner.minLen){
          const code = scanner.buf;
          scanner.reset();
          finalizeScan(code);
        } else {
          scanner.reset();
        }
        return;
      }

      // accept alnum for barcodes
      if (k.length === 1 && /[0-9A-Za-z]/.test(k)){
        scanner.pushChar(k);
      }
    });
  }

  /* =========================
     RENDER ALL
  ========================== */
  function renderAll(){
    normalizeOpenDay();
    renderHeader();
    renderCategoryChips();
    renderProductGrid();
    renderTicketLines();
    renderTotals();
    renderProductsTable();
    renderTrayTable();
    renderQuickStats();
    renderRangeUI();
    renderReportTable();
  }

  /* =========================
     INIT
  ========================== */
  async function init(){
    await ensureDefaultHashes();

    normalizeOpenDay();

    // defaults for range
    if (!state.ops.rangeMode) state.ops.rangeMode = 'day';
    if (!state.ops.rangeFrom) state.ops.rangeFrom = dateKey();
    if (!state.ops.rangeTo) state.ops.rangeTo = dateKey();

    // Bind basics
    bindTabs();
    bindTop();
    bindModals();
    bindVenta();
    bindReportes();
    bindAjustes();
    bindProductosIO();
    bindShortcuts();
    bindScannerGlobal();

    // close day key changes automatically (bandeja)
    setTab('venta');
    focusBarcodeSoon();

    // keep focus on barcode when clicking outside inputs (not in modals)
    document.addEventListener('click', (e) => {
      touchActivity();
      const t = e.target;
      if (!t) return;
      if (t.closest('dialog')) return;
      const tag = t.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') return;
      focusBarcodeSoon();
    });

    // update date/time + admin lock
    setInterval(() => {
      normalizeOpenDay();
      if (el.ticketDate) el.ticketDate.textContent = nowEs();
      renderAdminState();
    }, 15000);

    // initial render
    renderAll();
  }

  init();
})();

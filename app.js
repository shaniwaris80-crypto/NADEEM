/* =========================
TPV TIENDA — B/W PRO (PAQUETE PRO)
Archivo: app.js
- Siempre escuchando escaneo (buffer rápido global)
- Categorías (crear/renombrar/borrar) + asignación en producto
- Venta: categorías debajo de barcode/buscar + grid por categoría
- Teclado numérico para importe rápido
- Ticket 80mm printArea + email mailto
- Backup/Restore JSON + CSV import/export (productos + ventas)
- Admin PIN para cambios sensibles (categorías/borrados/devoluciones)
========================= */

(() => {
  'use strict';

  /* =========================
     HELPERS
  ========================== */
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  const LS_KEY = 'TPV_BWPRO_PRO_V1_2';

  const pad = (n) => (n < 10 ? '0' : '') + n;
  const now = () => new Date();
  const nowEs = () => {
    const d = now();
    return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const parseMoney = (s) => {
    if (s == null) return 0;
    const t = String(s).trim().replace(/\s/g,'').replace(',', '.');
    const v = Number(t);
    return Number.isFinite(v) ? v : 0;
  };

  const fmtMoney = (v) => Number(v||0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtEUR = (v) => `${fmtMoney(v)} €`;

  const escapeHtml = (s) => (s ?? '').toString()
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'","&#039;");

  const uid = () => 'ID' + Math.random().toString(36).slice(2,8).toUpperCase() + Date.now().toString(36).slice(-4).toUpperCase();

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
    // rows: array of arrays (strings)
    const esc = (v) => {
      const s = String(v ?? '');
      if (/[",\n;]/.test(s)) return `"${s.replaceAll('"','""')}"`;
      return s;
    };
    return rows.map(r => r.map(esc).join(',')).join('\n');
  }

  function parseCSV(text){
    // Simple CSV parser (comma/semicolon tolerant)
    // If uses semicolon more than comma, we switch delimiter.
    const raw = String(text || '').replace(/\r/g,'').trim();
    if (!raw) return [];
    const lines = raw.split('\n');
    const commaCount = (raw.match(/,/g)||[]).length;
    const semiCount  = (raw.match(/;/g)||[]).length;
    const delim = semiCount > commaCount ? ';' : ',';

    const out = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      out.push(splitCSVLine(line, delim));
    }
    return out;
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
     DEFAULT STATE
  ========================== */
  const DEFAULTS = () => {
    const cat = (id, name) => ({ id, name });
    return {
      version: '1.2',
      settings: {
        shopName: 'MALIK AHMAD NADEEM',
        shopSub: 'C/ Vitoria 139 · 09007 Burgos · Tlf 632 480 316 · CIF 72374062P',
        footerText: 'Gracias por su compra',
        boxName: 'CAJA-1',
        theme: 'day',
        directPay: false,
        autoPrint: false,
        alwaysScan: true,
        scanSpeedMs: 35,     // umbral entre teclas para “lector”
        autoLockMin: 10,     // admin lock mins
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
        cat('c_all', 'Todos'),
        cat('c_fav', 'Favoritos'),
        cat('c_fr', 'Fruta'),
        cat('c_ve', 'Verdura'),
        cat('c_tr', 'Tropical'),
        cat('c_ot', 'Otros'),
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
      carts: {
        active: { lines: [], noteName:'', payMethod:'efectivo', given:0 },
        parked: [], // [{id,name,cart,ts}]
      },
      sales: [],
      zClosures: [], // [{dateKey, expectedCash, countedCash, diff, total, cash, card, note, ts}]
      audit: [],
      ui: { selectedCategoryId: 'c_all' },
      lastSaleId: null,
    };
  };

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
    tabs: $$('.tab'),
    pages: $$('.page'),

    btnTheme: $('#btnTheme'),
    themeLabel: $('#themeLabel'),
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

    // products page
    btnAddProduct: $('#btnAddProduct'),
    btnImportCsv: $('#btnImportCsv'),
    btnExportCsv: $('#btnExportCsv'),
    btnBackupJson: $('#btnBackupJson'),
    btnRestoreJson: $('#btnRestoreJson'),
    prodSearchName: $('#prodSearchName'),
    prodSearchBarcode: $('#prodSearchBarcode'),
    prodSearchCat: $('#prodSearchCat'),
    productsTable: $('#productsTable'),

    // sales page
    btnExportSalesCsv: $('#btnExportSalesCsv'),
    btnCloseZ: $('#btnCloseZ'),
    statTickets: $('#statTickets'),
    statTotal: $('#statTotal'),
    statCash: $('#statCash'),
    statCard: $('#statCard'),
    salesTable: $('#salesTable'),
    zInfo: $('#zInfo'),

    // profit
    profitSales: $('#profitSales'),
    profitCost: $('#profitCost'),
    profitValue: $('#profitValue'),
    profitMargin: $('#profitMargin'),
    topProducts: $('#topProducts'),

    // settings
    setShopName: $('#setShopName'),
    setShopSub: $('#setShopSub'),
    setBoxName: $('#setBoxName'),
    setFooterText: $('#setFooterText'),
    setDirectPay: $('#setDirectPay'),
    setAutoPrint: $('#setAutoPrint'),
    setAlwaysScan: $('#setAlwaysScan'),
    setScanSpeed: $('#setScanSpeed'),
    setAdminPin: $('#setAdminPin'),
    setAutoLockMin: $('#setAutoLockMin'),
    btnAdminUnlock: $('#btnAdminUnlock'),

    // files
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

    // pay
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

    // quick
    quickAmount: $('#quickAmount'),
    quickName: $('#quickName'),
    btnQuickOk: $('#btnQuickOk'),
    keypad: $('#keypad'),

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

    // parked
    parkName: $('#parkName'),
    btnParkNow: $('#btnParkNow'),
    parkList: $('#parkList'),

    // Z closure
    zCashCounted: $('#zCashCounted'),
    zNote: $('#zNote'),
    zExpected: $('#zExpected'),
    btnZOk: $('#btnZOk'),

    // email
    emailTo: $('#emailTo'),
    emailMsg: $('#emailMsg'),
    btnEmailSend: $('#btnEmailSend'),

    // print/toast
    printArea: $('#printArea'),
    toastHost: $('#toastHost'),
  };

  /* =========================
     TOAST + AUDIT
  ========================== */
  function toast(msg){
    if (!el.toastHost) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    el.toastHost.appendChild(t);
    setTimeout(() => t.remove(), 1500);
  }

  function audit(type, data={}){
    state.audit.push({ ts: Date.now(), at: nowEs(), user: state.session.user?.name || 'CAJERO', type, data });
    if (state.audit.length > 2000) state.audit.splice(0, state.audit.length - 2000);
    save();
  }

  function touchActivity(){
    state.session.lastActivity = Date.now();
    save();
  }

  /* =========================
     SECURITY
  ========================== */
  function adminUnlocked(){
    return (state.session.adminUnlockedUntil || 0) > Date.now();
  }

  function lockAdminIfExpired(){
    const mins = Math.max(1, Number(state.settings.autoLockMin || 10));
    const maxMs = mins * 60 * 1000;
    const idle = Date.now() - (state.session.lastActivity || Date.now());
    if (idle > maxMs) state.session.adminUnlockedUntil = 0;
  }

  function renderAdminState(){
    if (!el.adminState) return;
    lockAdminIfExpired();
    el.adminState.textContent = adminUnlocked() ? 'Admin ✓' : 'Admin';
  }

  async function ensureDefaultHashes(){
    if (!state.settings.adminPinHash){
      state.settings.adminPinHash = await sha256Hex('1234');
    }
    for (const u of state.users){
      if (!u.passHash) u.passHash = await sha256Hex('1234');
    }
    save();
  }

  async function verifyAdminPin(pin){
    const h = await sha256Hex(String(pin||'').trim());
    return h === state.settings.adminPinHash;
  }

  function unlockAdmin(minutes=5){
    state.session.adminUnlockedUntil = Date.now() + minutes*60*1000;
    save();
    renderAdminState();
    audit('ADMIN_UNLOCK', { minutes });
  }

  function requireAdminOrPrompt(next){
    if (adminUnlocked()) return next();
    openModal(el.modalAdmin);
    toast('PIN admin requerido');
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
    audit('LOGIN', { user:u, role:user.role });
    renderHeader();
    return { ok:true };
  }

  /* =========================
     THEME / TABS / MODALS
  ========================== */
  function setTheme(mode){
    const night = mode === 'night';
    document.body.classList.toggle('theme-day', !night);
    document.body.classList.toggle('theme-night', night);
    if (el.themeLabel) el.themeLabel.textContent = night ? 'Noche' : 'Día';
    state.settings.theme = night ? 'night' : 'day';
    save();
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
     CATEGORIES
  ========================== */
  function getCatName(id){
    return state.categories.find(c => c.id === id)?.name || '—';
  }

  function normalizeCategories(){
    // Ensure required special cats exist
    const ensure = (id, name) => {
      if (!state.categories.some(c => c.id === id)) state.categories.unshift({ id, name });
    };
    ensure('c_all', 'Todos');
    ensure('c_fav', 'Favoritos');
    save();
  }

  function createCategory(name){
    const n = String(name||'').trim();
    if (!n) return null;
    // prevent duplicates by name (case-insensitive)
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
    const n = String(newName||'').trim();
    if (!n) return false;
    // prevent duplicates (except itself)
    if (state.categories.some(x => x.id !== catId && x.name.toLowerCase() === n.toLowerCase())) return false;
    c.name = n;
    save();
    return true;
  }

  function deleteCategory(catId){
    // do not delete special cats
    if (catId === 'c_all' || catId === 'c_fav') return false;
    const idx = state.categories.findIndex(c => c.id === catId);
    if (idx < 0) return false;

    // move products to 'Otros' if exists; else to 'c_all' fallback
    const fallback = state.categories.find(c => c.id === 'c_ot')?.id || 'c_all';
    for (const p of state.products){
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
  function findProductByBarcode(code){
    const c = String(code||'').trim();
    if (!c) return null;
    return state.products.find(p => String(p.barcode||'').trim() === c) || null;
  }

  function addOrUpdateProduct(prod){
    const barcode = String(prod.barcode||'').trim();
    // if barcode exists, ensure unique
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
  const cart = {
    get active(){ return state.carts.active; },
    totals(){
      const total = cart.active.lines.reduce((s,l) => s + (Number(l.price) * Number(l.qty||0)), 0);
      return { total, subtotal: total };
    },
    addProduct(p, qty=1){
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
        price: Number(p.price||0),
        cost: p.cost == null ? null : Number(p.cost),
        qty,
        isManual:false
      });
      save();
      renderAll();
    },
    addManual(amount, name){
      const a = Number(amount||0);
      if (!(a > 0)) return;
      cart.active.lines.push({
        key: 'M-' + uid(),
        productId: null,
        barcode: '',
        name: String(name||'Importe').trim() || 'Importe',
        price: a,
        cost: null,
        qty: 1,
        isManual: true
      });
      save();
      renderAll();
    },
    removeLine(index){
      cart.active.lines.splice(index, 1);
      save();
      renderAll();
    },
    setQty(index, qty){
      const q = Math.max(0, Math.floor(Number(qty||0)));
      if (q <= 0) return cart.removeLine(index);
      cart.active.lines[index].qty = q;
      save();
      renderAll();
    },
    inc(index, delta){
      const l = cart.active.lines[index];
      if (!l) return;
      cart.setQty(index, (l.qty||0) + delta);
    },
    clear(){
      state.carts.active = { lines: [], noteName:'', payMethod:'efectivo', given:0 };
      save();
      renderAll();
    },
    parkOpen(){
      openModal(el.modalPark);
      renderParkedList();
    },
    parkNow(nameOpt){
      if (!cart.active.lines.length) return toast('No hay líneas');
      const item = {
        id: 'K-' + uid(),
        name: String(nameOpt||'').trim(),
        cart: JSON.parse(JSON.stringify(cart.active)),
        ts: Date.now()
      };
      state.carts.parked.unshift(item);
      // limpia activo
      cart.clear();
      save();
      renderParkBadge();
      renderParkedList();
      toast('Aparcado');
    },
    restoreParked(id){
      const idx = state.carts.parked.findIndex(x => x.id === id);
      if (idx < 0) return;
      // si hay ticket actual, preguntamos
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
    deleteParked(id){
      const idx = state.carts.parked.findIndex(x => x.id === id);
      if (idx < 0) return;
      state.carts.parked.splice(idx, 1);
      save();
      renderParkBadge();
      renderParkedList();
    }
  };

  function renderParkBadge(){
    if (!el.parkBadge) return;
    const n = state.carts.parked.length;
    el.parkBadge.hidden = n <= 0;
    el.parkBadge.textContent = String(n);
  }

  function renderParkedList(){
    if (!el.parkList) return;
    el.parkList.innerHTML = '';
    const items = state.carts.parked.slice();

    if (!items.length){
      const div = document.createElement('div');
      div.className = 'muted';
      div.textContent = 'No hay aparcados.';
      el.parkList.appendChild(div);
      return;
    }

    for (const it of items){
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
      ${(s.payMethod === 'efectivo' || s.payMethod === 'mixto') ? `<div>Entregado: ${fmtMoney(s.given||0)} €</div>` : ``}
      ${(s.payMethod === 'efectivo' || s.payMethod === 'mixto') ? `<div>Cambio: ${fmtMoney(s.change||0)} €</div>` : ``}
      ${s.noteName ? `<div>Nota: ${escapeHtml(s.noteName)}</div>` : ``}
      <div style="border-top:1px dashed #000; margin:6px 0;"></div>
      <div style="text-align:center; margin-top:6px;">${escapeHtml(state.settings.footerText || 'Gracias por su compra')}</div>
      <div style="text-align:center; margin-top:4px;">IVA incluido en los precios</div>
    `;
    return `<div>${head}${body}${foot}</div>`;
  }

  function printSale(s){
    if (!el.printArea) return;
    el.printArea.innerHTML = buildTicketHTML(s);
    window.print();
  }

  function buildReceiptText(s){
    const out = [];
    out.push(state.settings.shopName);
    out.push(state.settings.shopSub);
    out.push('------------------------------');
    out.push(`${s.ticketNo}   ${s.date}`);
    out.push(`Caja: ${s.box}   Cajero: ${s.user}`);
    out.push('------------------------------');
    for (const l of s.lines){
      out.push(l.name);
      out.push(`  ${l.qty} x ${fmtMoney(l.price)}  = ${fmtMoney(l.price*l.qty)}`);
    }
    out.push('------------------------------');
    out.push(`TOTAL: ${fmtMoney(s.total)} €`);
    out.push(`Pago: ${s.payMethod}`);
    if (s.payMethod === 'efectivo' || s.payMethod === 'mixto'){
      out.push(`Entregado: ${fmtMoney(s.given||0)} €`);
      out.push(`Cambio: ${fmtMoney(s.change||0)} €`);
    }
    if (s.noteName) out.push(`Nota: ${s.noteName}`);
    out.push('------------------------------');
    out.push(state.settings.footerText || 'Gracias por su compra');
    out.push('IVA incluido en los precios');
    return out.join('\n');
  }

  function openEmailModal(){ openModal(el.modalEmail); }

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

  function buildPreviewSale(){
    const { total } = cart.totals();
    return {
      ticketNo: '(PREVIEW)',
      date: nowEs(),
      box: state.settings.boxName,
      user: state.session.user.name,
      payMethod: cart.active.payMethod,
      given: parseMoney(el.givenInput?.value || '0'),
      change: 0,
      noteName: (el.noteName?.value || '').trim(),
      lines: cart.active.lines.map(l => ({ name:l.name, qty:l.qty, price:l.price })),
      total
    };
  }

  function getLastSale(){
    if (!state.lastSaleId) return state.sales[state.sales.length-1] || null;
    return state.sales.find(s => s.id === state.lastSaleId) || state.sales[state.sales.length-1] || null;
  }

  /* =========================
     SALE + REFUND + Z
  ========================== */
  function saveSale({ payMethod, given, cashAmount, cardAmount, noteName }){
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
      given: Number(given||0),
      change: 0,
      noteName: String(noteName||'').trim(),
      lines: cart.active.lines.map(l => ({
        name: l.name,
        barcode: l.barcode || '',
        qty: Number(l.qty||0),
        price: Number(l.price||0),
        cost: l.cost == null ? null : Number(l.cost),
        isManual: !!l.isManual
      })),
      total,
      split: payMethod === 'mixto' ? { cash: Number(cashAmount||0), card: Number(cardAmount||0) } : null,
      ts: Date.now()
    };

    if (payMethod === 'efectivo'){
      sale.change = Math.max(0, sale.given - sale.total);
    } else if (payMethod === 'mixto'){
      const cash = Number(cashAmount||0);
      const card = Number(cardAmount||0);
      const remaining = Math.max(0, sale.total - card);
      sale.change = Math.max(0, cash - remaining);
    }

    state.sales.push(sale);
    state.lastSaleId = sale.id;
    save();
    audit('SALE_CREATE', { ticketNo: sale.ticketNo, total: sale.total, payMethod });
    return sale;
  }

  function calcSalesSummary(){
    const sales = state.sales.slice();
    const total = sales.reduce((s,x)=>s+(Number(x.total)||0),0);

    const cash = sales.reduce((s,x)=>{
      if (x.payMethod==='efectivo') return s + (Number(x.total)||0);
      if (x.payMethod==='mixto') return s + (Number(x.split?.cash)||0);
      return s;
    },0);

    const card = sales.reduce((s,x)=>{
      if (x.payMethod==='tarjeta') return s + (Number(x.total)||0);
      if (x.payMethod==='mixto') return s + (Number(x.split?.card)||0);
      return s;
    },0);

    return { count: sales.length, total, cash, card };
  }

  function openZModal(){
    requireAdminOrPrompt(() => {
      const { cash } = calcSalesSummary();
      if (el.zExpected) el.zExpected.textContent = `Efectivo esperado: ${fmtEUR(cash)}`;
      if (el.zCashCounted) el.zCashCounted.value = '';
      if (el.zNote) el.zNote.value = '';
      openModal(el.modalZ);
    });
  }

  function saveZClosure(){
    const { total, cash, card } = calcSalesSummary();
    const counted = parseMoney(el.zCashCounted?.value || '0');
    const diff = counted - cash;
    const dateKey = new Date().toISOString().slice(0,10);

    const z = {
      dateKey,
      expectedCash: cash,
      countedCash: counted,
      diff,
      total,
      cash,
      card,
      note: (el.zNote?.value || '').trim(),
      ts: Date.now()
    };
    state.zClosures.push(z);
    save();
    audit('Z_CLOSE', z);
    closeModal(el.modalZ);
    toast('Cierre Z guardado');
    renderSales();
  }

  /* =========================
     PAY FLOW
  ========================== */
  function syncPayUI(){
    const m = el.payMethod?.value || 'efectivo';
    const isCash = m === 'efectivo';
    const isCard = m === 'tarjeta';
    const isMix  = m === 'mixto';

    if (el.paySplitWrap) el.paySplitWrap.hidden = !isMix;
    if (el.payGivenWrap) el.payGivenWrap.style.display = (isCash || isMix) ? '' : 'none';
    if (el.payChangeWrap) el.payChangeWrap.style.display = (isCash || isMix) ? '' : 'none';

    if (isCard){
      if (el.payGiven) el.payGiven.value = '';
      if (el.payChange) el.payChange.value = '0,00';
    }
  }

  function calcPayChange(){
    const { total } = cart.totals();
    const m = el.payMethod?.value || 'efectivo';

    if (m === 'efectivo'){
      const given = parseMoney(el.payGiven?.value || '0');
      if (el.payChange) el.payChange.value = fmtMoney(Math.max(0, given - total));
      return;
    }
    if (m === 'mixto'){
      const card = parseMoney(el.payCard?.value || '0');
      const cash = parseMoney(el.payCash?.value || '0');
      const remaining = Math.max(0, total - card);
      const change = Math.max(0, cash - remaining);
      if (el.payChange) el.payChange.value = fmtMoney(change);
      return;
    }
    if (el.payChange) el.payChange.value = '0,00';
  }

  function openPayModal(){
    const { total } = cart.totals();
    if (!(total > 0)) return toast('No hay líneas');
    if (el.payTotal) el.payTotal.textContent = fmtEUR(total);
    if (el.payNote) el.payNote.value = el.noteName?.value || cart.active.noteName || '';
    if (el.payMethod) el.payMethod.value = cart.active.payMethod || 'efectivo';
    if (el.payGiven) el.payGiven.value = el.givenInput?.value || '';
    if (el.payCash) el.payCash.value = '';
    if (el.payCard) el.payCard.value = '';
    syncPayUI();
    calcPayChange();
    openModal(el.modalPay);
  }

  function confirmSaleFromUI({ fromModal=true }={}){
    const { total } = cart.totals();
    if (!(total > 0)) return toast('No hay total');

    let method, given, note, cashAmount=0, cardAmount=0;

    if (fromModal){
      method = el.payMethod?.value || cart.active.payMethod || 'efectivo';
      note = (el.payNote?.value || '').trim();

      if (method === 'efectivo'){
        given = parseMoney(el.payGiven?.value || '0');
      } else if (method === 'tarjeta'){
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

    if (method === 'efectivo' && given < total){
      if (!confirm('Entregado menor que total. ¿Confirmar igualmente?')) return;
    }
    if (method === 'mixto' && (cashAmount + cardAmount) < total){
      if (!confirm('Mixto: efectivo+tarjeta menor que total. ¿Confirmar igualmente?')) return;
    }

    const sale = saveSale({ payMethod: method, given, cashAmount, cardAmount, noteName: note });
    if (!sale) return toast('Error al guardar');

    if (el.ticketNo) el.ticketNo.textContent = sale.ticketNo;

    if (fromModal) closeModal(el.modalPay);

    cart.clear();
    toast(`Venta OK · ${sale.ticketNo}`);

    if (state.settings.autoPrint) {
      printSale(sale);
    } else {
      if (confirm('¿Imprimir ticket?')) printSale(sale);
    }
  }

  /* =========================
     REFUND (Admin)
  ========================== */
  function refundLast(){
    requireAdminOrPrompt(() => {
      const last = getLastSale();
      if (!last) return toast('No hay venta');
      const refund = {
        ...last,
        id: uid(),
        ticketNo: nextTicketNo(),
        date: nowEs(),
        payMethod: 'devolucion',
        lines: (last.lines || []).map(l => ({ ...l, qty: -Math.abs(l.qty) })),
        total: -Math.abs(last.total),
        noteName: `DEVOLUCIÓN de ${last.ticketNo}`,
        ts: Date.now()
      };
      state.sales.push(refund);
      state.lastSaleId = refund.id;
      save();
      audit('SALE_REFUND', { from: last.ticketNo, refund: refund.ticketNo, total: refund.total });
      toast('Devolución registrada');
      renderSales();
    });
  }

  /* =========================
     RENDER: HEADER / CATS / GRID / TICKET
  ========================== */
  function renderHeader(){
    // theme + business
    setTheme(state.settings.theme || 'day');

    if (el.userLabel) el.userLabel.textContent = state.session.user?.name || 'CAJERO';
    if (el.posUser) el.posUser.textContent = state.session.user?.name || 'CAJERO';

    if (el.shopName) el.shopName.textContent = state.settings.shopName || '';
    if (el.shopSub) el.shopSub.textContent = state.settings.shopSub || '';
    if (el.posBox) el.posBox.textContent = state.settings.boxName || 'CAJA-1';

    if (el.ticketDate) el.ticketDate.textContent = nowEs();

    const seq = state.counters.ticketSeq || 1;
    if (el.ticketNo) el.ticketNo.textContent = `T-${String(seq).padStart(6,'0')}`;

    renderAdminState();
    renderParkBadge();
  }

  function renderCategoryChips(){
    if (!el.catChips) return;
    el.catChips.innerHTML = '';
    normalizeCategories();

    for (const c of state.categories){
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

  function listProductsForSelectedCategory(){
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

    items.sort((a,b) => (Number(!!b.fav) - Number(!!a.fav)) || (a.name||'').localeCompare(b.name||''));
    return items.slice(0, 40);
  }

  function renderProductGrid(){
    if (!el.prodGrid) return;
    el.prodGrid.innerHTML = '';

    // tile: importe rápido
    el.prodGrid.appendChild(makeProdTile('Importe rápido', 'Manual', 'Teclado', () => openModal(el.modalQuick)));

    const items = listProductsForSelectedCategory();
    for (const p of items){
      const sub = p.barcode ? `BC: ${p.barcode}` : 'Manual';
      const btn = makeProdTile(p.name, fmtEUR(p.price||0), sub, () => cart.addProduct(p, 1));
      // long press/right click: editar producto (admin)
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

  function renderTicketLines(){
    if (!el.ticketLines) return;
    const thead = el.ticketLines.querySelector('.trow.thead');
    el.ticketLines.innerHTML = '';
    if (thead) el.ticketLines.appendChild(thead);

    cart.active.lines.forEach((l, idx) => {
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

      btnMinus.addEventListener('click', () => cart.inc(idx, -1));
      btnPlus.addEventListener('click', () => cart.inc(idx, +1));
      qtyIn.addEventListener('change', () => cart.setQty(idx, qtyIn.value));
      qtyIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); qtyIn.blur(); focusBarcodeSoon(); }
      });

      // right click delete
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); cart.removeLine(idx); });

      el.ticketLines.appendChild(row);
    });
  }

  function renderTotals(){
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
     RENDER: PRODUCTS TABLE / SALES / PROFIT
  ========================== */
  function fillCategorySelect(sel, includeAll=true){
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
      o.value = c.id; o.textContent = c.name;
      sel.appendChild(o);
    }
  }

  function renderProductsTable(){
    if (!el.productsTable) return;

    fillCategorySelect(el.prodSearchCat, true);

    const thead = el.productsTable.querySelector('.trow.thead');
    el.productsTable.innerHTML = '';
    if (thead) el.productsTable.appendChild(thead);

    const qName = String(el.prodSearchName?.value || '').trim().toLowerCase();
    const qBar  = String(el.prodSearchBarcode?.value || '').trim();
    const qCat  = String(el.prodSearchCat?.value || '').trim();

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
      el.productsTable.appendChild(row);
    }
  }

  function renderSales(){
    const { count, total, cash, card } = calcSalesSummary();
    if (el.statTickets) el.statTickets.textContent = String(count);
    if (el.statTotal) el.statTotal.textContent = fmtEUR(total);
    if (el.statCash) el.statCash.textContent = fmtEUR(cash);
    if (el.statCard) el.statCard.textContent = fmtEUR(card);

    // z info
    if (el.zInfo){
      const z = state.zClosures.slice(-1)[0];
      el.zInfo.textContent = z
        ? `${z.dateKey} · esperado ${fmtEUR(z.expectedCash)} · contado ${fmtEUR(z.countedCash)} · dif ${fmtEUR(z.diff)}`
        : 'Sin cierres.';
    }

    // sales table
    if (el.salesTable){
      const thead = el.salesTable.querySelector('.trow.thead');
      el.salesTable.innerHTML = '';
      if (thead) el.salesTable.appendChild(thead);

      const last = state.sales.slice(-80).reverse();
      for (const s of last){
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
        row.querySelector('[data-act="print"]').addEventListener('click', () => printSale(s));
        el.salesTable.appendChild(row);
      }
    }

    // profits + top
    const sales = state.sales.slice();
    const cost = sales.reduce((S,x)=>{
      const c = (x.lines||[]).reduce((sum,l)=>{
        if (l.cost == null) return sum;
        return sum + (Number(l.cost) * Number(l.qty||0));
      },0);
      return S + c;
    },0);
    const profit = total - cost;
    const margin = total > 0 ? (profit/total)*100 : 0;

    if (el.profitSales) el.profitSales.textContent = fmtEUR(total);
    if (el.profitCost) el.profitCost.textContent = fmtEUR(cost);
    if (el.profitValue) el.profitValue.textContent = fmtEUR(profit);
    if (el.profitMargin) el.profitMargin.textContent = `${margin.toLocaleString('es-ES',{minimumFractionDigits:1,maximumFractionDigits:1})} %`;

    // top products by revenue
    const map = new Map();
    for (const s of sales){
      for (const l of (s.lines||[])){
        const k = l.name;
        const v = (Number(l.price) * Number(l.qty||0));
        map.set(k, (map.get(k)||0) + v);
      }
    }
    const top = Array.from(map.entries()).sort((a,b)=>b[1]-a[1]).slice(0,5)
      .map(([n,v]) => `${n}: ${fmtEUR(v)}`).join(' · ');
    if (el.topProducts) el.topProducts.textContent = top || '—';
  }

  function renderAll(){
    renderHeader();
    renderAdminState();
    renderParkBadge();
    renderCategoryChips();
    renderProductGrid();
    renderTicketLines();
    renderTotals();
    renderProductsTable();
    renderSales();
  }

  /* =========================
     PRODUCT MODAL (edit/new)
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
    const categoryId = el.prodCat?.value || (state.categories.find(c=>c.id==='c_ot')?.id || 'c_all');
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
     QUICK AMOUNT + KEYPAD
  ========================== */
  function keypadInsert(k){
    const inp = el.quickAmount;
    if (!inp) return;
    let v = String(inp.value || '');
    if (k === 'c'){ v=''; inp.value=v; return; }
    if (k === 'bk'){ v = v.slice(0, -1); inp.value=v; return; }
    if (k === '.'){ // use comma
      if (v.includes(',') || v.includes('.')) return;
      inp.value = v + ',';
      return;
    }
    if (k === 'ok'){
      quickOk();
      return;
    }
    // digits / 00
    inp.value = v + String(k);
  }

  function quickOk(){
    const amt = parseMoney(el.quickAmount?.value || '0');
    const name = (el.quickName?.value || 'Importe').trim();
    if (!(amt > 0)) return toast('Importe inválido');
    cart.addManual(amt, name);
    closeModal(el.modalQuick);
    toast('Importe añadido');
    if (el.quickAmount) el.quickAmount.value = '';
  }

  /* =========================
     CSV / JSON IMPORT EXPORT
  ========================== */
  function exportProductsCSV(){
    // barcode,nombre,pvp,coste,categoria,fav,unidad
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

  function exportSalesCSV(){
    // date,ticket,pay,total,user,box,lines
    const rows = [['fecha','ticket','pago','total','cajero','caja','lineas']];
    for (const s of state.sales){
      rows.push([
        s.date, s.ticketNo, s.payMethod, fmtMoney(s.total||0), s.user, s.box,
        (s.lines||[]).map(l => `${l.name}(${l.qty}x${fmtMoney(l.price)})`).join(' | ')
      ]);
    }
    downloadText('tpv_ventas.csv', toCSV(rows), 'text/csv');
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

      // If no headers match, assume fixed order
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
          // create category automatically (admin not required for import)
          const created = createCategory(String(catName||'').trim());
          catId = created?.id || state.categories.find(c=>c.id==='c_ot')?.id || 'c_all';
        }

        const res = addOrUpdateProduct({ id: undefined, barcode: String(barcode||'').trim(), name: String(name).trim(), price, cost, categoryId: catId, fav, unit: String(unit||'ud').trim() });
        if (res.ok) imported++;
      }

      toast(`Importados: ${imported}`);
      renderAll();
    };
    reader.readAsText(file);
  }

  /* =========================
     SCANNER: ALWAYS LISTENING (Global buffer)
  ========================== */
  const scanner = {
    buf: '',
    lastTs: 0,
    timer: null,
    enabled(){ return !!state.settings.alwaysScan; },
    speedMs(){ return Math.max(15, Math.min(120, Number(state.settings.scanSpeedMs || 35))); },
    reset(){
      scanner.buf = '';
      scanner.lastTs = 0;
      if (scanner.timer) { clearTimeout(scanner.timer); scanner.timer = null; }
    },
    pushChar(ch){
      const t = Date.now();
      const gap = scanner.lastTs ? (t - scanner.lastTs) : 0;
      const maxGap = scanner.speedMs();

      // If gap too big, likely human typing -> restart buffer
      if (scanner.lastTs && gap > maxGap) scanner.buf = '';

      scanner.lastTs = t;
      scanner.buf += ch;

      // auto timeout finalize
      if (scanner.timer) clearTimeout(scanner.timer);
      scanner.timer = setTimeout(() => {
        // If no Enter from scanner, we can still attempt finalize if buffer is long enough
        if (scanner.buf.length >= 8) finalizeScan(scanner.buf);
        scanner.reset();
      }, maxGap + 120);
    }
  };

  function finalizeScan(code){
    const c = String(code||'').trim();
    if (!c) return;

    // Only act if we're not in a dialog and (preferably) in Venta page
    const openDlg = document.querySelector('dialog[open]');
    if (openDlg) return;

    // If user is typing in an input/textarea and scan is OFF, ignore
    const active = document.activeElement;
    const tag = active?.tagName?.toLowerCase();
    const typing = (tag === 'input' || tag === 'textarea' || tag === 'select');

    // We still accept scan in typing mode if it looks like scanner (long & fast)
    // Here we already filtered by speed; proceed.

    // add product
    const p = findProductByBarcode(c);
    if (p){
      cart.addProduct(p, 1);
      flashScan();
      toast('Escaneado ✓');
      // also clear barcode input if focused
      if (el.barcodeInput) el.barcodeInput.value = '';
    } else {
      // open product modal with barcode prefilled
      openNewProduct(c);
      toast('Barcode no encontrado: alta producto');
    }

    // focus back
    focusBarcodeSoon();
  }

  function flashScan(){
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
    el.btnTheme?.addEventListener('click', () => {
      setTheme(document.body.classList.contains('theme-day') ? 'night' : 'day');
    });

    el.btnLogin?.addEventListener('click', () => openModal(el.modalLogin));
    el.btnAdmin?.addEventListener('click', () => openModal(el.modalAdmin));
    el.btnAdminUnlock?.addEventListener('click', () => openModal(el.modalAdmin));
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
      renderAll();
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

    // pay modal
    el.payMethod?.addEventListener('change', () => { syncPayUI(); calcPayChange(); });
    el.payGiven?.addEventListener('input', calcPayChange);
    el.payCash?.addEventListener('input', calcPayChange);
    el.payCard?.addEventListener('input', calcPayChange);
    el.btnPayOk?.addEventListener('click', () => confirmSaleFromUI({ fromModal:true }));

    // quick modal buttons
    el.btnQuickOk?.addEventListener('click', quickOk);
    el.keypad?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-k]');
      if (!btn) return;
      keypadInsert(btn.dataset.k);
    });

    // product modal
    el.btnProductSave?.addEventListener('click', () => saveProductFromModal());

    // categories modal
    el.btnCreateCat?.addEventListener('click', createCatFromModal);

    // park modal
    el.btnParkNow?.addEventListener('click', () => cart.parkNow(el.parkName?.value || ''));

    // Z modal
    el.btnZOk?.addEventListener('click', saveZClosure);

    // email
    el.btnEmailSend?.addEventListener('click', sendEmailMailto);
  }

  function bindVenta(){
    el.btnQuickAmount?.addEventListener('click', () => openModal(el.modalQuick));
    el.btnPark?.addEventListener('click', () => cart.parkOpen());

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

    el.btnAddProductInline?.addEventListener('click', () => openNewProduct(''));

    // barcode input enter
    el.barcodeInput?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const code = (el.barcodeInput.value || '').trim();
      el.barcodeInput.value = '';
      if (!code) return;
      finalizeScan(code);
    });

    el.searchInput?.addEventListener('input', debounce(() => renderProductGrid(), 80));

    el.payTabs.forEach(p => p.addEventListener('click', () => {
      el.payTabs.forEach(x => x.classList.remove('is-active'));
      p.classList.add('is-active');
      cart.active.payMethod = p.dataset.pay || 'efectivo';
      save();
      renderTotals();
      focusBarcodeSoon();
    }));

    el.givenInput?.addEventListener('input', () => { cart.active.given = parseMoney(el.givenInput.value); save(); renderTotals(); });
    el.noteName?.addEventListener('input', () => { cart.active.noteName = el.noteName.value || ''; save(); });

    el.btnVoid?.addEventListener('click', () => {
      if (!cart.active.lines.length) return;
      if (!confirm('¿Anular ticket actual?')) return;
      cart.clear();
      audit('CART_VOID', {});
      toast('Ticket anulado');
    });

    el.btnRefund?.addEventListener('click', refundLast);

    el.btnPay?.addEventListener('click', () => {
      if (state.settings.directPay) confirmSaleFromUI({ fromModal:false });
      else openPayModal();
    });

    el.btnPrint?.addEventListener('click', () => {
      const last = getLastSale();
      if (last) return printSale(last);
      const prev = buildPreviewSale();
      if (!(prev.total > 0)) return toast('No hay ticket');
      printSale(prev);
    });

    el.btnLastTicket?.addEventListener('click', () => {
      const last = getLastSale();
      if (!last) return toast('No hay último ticket');
      printSale(last);
    });

    el.btnEmailTicket?.addEventListener('click', openEmailModal);

    // keep focus + activity
    document.addEventListener('click', () => touchActivity());
    document.addEventListener('keydown', () => touchActivity());
  }

  function bindProductos(){
    el.btnAddProduct?.addEventListener('click', () => openNewProduct(''));

    el.btnImportCsv?.addEventListener('click', () => el.fileCsv?.click());
    el.fileCsv?.addEventListener('change', () => {
      const f = el.fileCsv.files?.[0];
      if (!f) return;
      importProductsFromCSVFile(f);
      el.fileCsv.value = '';
    });

    el.btnExportCsv?.addEventListener('click', exportProductsCSV);
    el.btnBackupJson?.addEventListener('click', backupJSON);

    el.btnRestoreJson?.addEventListener('click', () => el.fileJson?.click());
    el.fileJson?.addEventListener('change', () => {
      const f = el.fileJson.files?.[0];
      if (!f) return;
      restoreJSONFromFile(f);
      el.fileJson.value = '';
    });

    const rer = debounce(renderProductsTable, 80);
    el.prodSearchName?.addEventListener('input', rer);
    el.prodSearchBarcode?.addEventListener('input', rer);
    el.prodSearchCat?.addEventListener('change', rer);
  }

  function bindVentas(){
    el.btnExportSalesCsv?.addEventListener('click', exportSalesCSV);
    el.btnCloseZ?.addEventListener('click', openZModal);
  }

  function bindAjustes(){
    // init values
    if (el.setShopName) el.setShopName.value = state.settings.shopName;
    if (el.setShopSub) el.setShopSub.value = state.settings.shopSub;
    if (el.setBoxName) el.setBoxName.value = state.settings.boxName;
    if (el.setFooterText) el.setFooterText.value = state.settings.footerText;

    if (el.setDirectPay) el.setDirectPay.value = state.settings.directPay ? '1':'0';
    if (el.setAutoPrint) el.setAutoPrint.value = state.settings.autoPrint ? '1':'0';
    if (el.setAlwaysScan) el.setAlwaysScan.value = state.settings.alwaysScan ? '1':'0';
    if (el.setScanSpeed) el.setScanSpeed.value = String(state.settings.scanSpeedMs || 35);
    if (el.setAutoLockMin) el.setAutoLockMin.value = String(state.settings.autoLockMin || 10);

    const apply = debounce(() => {
      state.settings.shopName = el.setShopName?.value || state.settings.shopName;
      state.settings.shopSub = el.setShopSub?.value || state.settings.shopSub;
      state.settings.boxName = el.setBoxName?.value || state.settings.boxName;
      state.settings.footerText = el.setFooterText?.value || state.settings.footerText;

      state.settings.directPay = (el.setDirectPay?.value || '0') === '1';
      state.settings.autoPrint = (el.setAutoPrint?.value || '0') === '1';
      state.settings.alwaysScan = (el.setAlwaysScan?.value || '1') === '1';

      state.settings.scanSpeedMs = Math.max(15, Math.min(120, Number(el.setScanSpeed?.value || 35)));
      state.settings.autoLockMin = Math.max(1, Math.min(120, Number(el.setAutoLockMin?.value || 10)));

      save();
      renderHeader();
      toast('Ajustes guardados');
    }, 140);

    el.setShopName?.addEventListener('input', apply);
    el.setShopSub?.addEventListener('input', apply);
    el.setBoxName?.addEventListener('input', apply);
    el.setFooterText?.addEventListener('input', apply);

    el.setDirectPay?.addEventListener('change', apply);
    el.setAutoPrint?.addEventListener('change', apply);
    el.setAlwaysScan?.addEventListener('change', apply);
    el.setScanSpeed?.addEventListener('input', apply);
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

  /* =========================
     SHORTCUTS
  ========================== */
  function bindShortcuts(){
    window.addEventListener('keydown', (e) => {
      touchActivity();

      const tag = document.activeElement?.tagName?.toLowerCase();
      const typing = (tag === 'input' || tag === 'textarea' || tag === 'select');

      // F4 pay
      if (e.key === 'F4'){
        e.preventDefault();
        state.settings.directPay ? confirmSaleFromUI({fromModal:false}) : openPayModal();
        return;
      }

      // F2 quick
      if (e.key === 'F2'){
        e.preventDefault();
        openModal(el.modalQuick);
        return;
      }

      // ESC close modal or clear cart
      if (e.key === 'Escape'){
        const open = document.querySelector('dialog[open]');
        if (open){ e.preventDefault(); closeModal(open); return; }
        if (!typing && cart.active.lines.length){
          if (confirm('¿Limpiar ticket actual?')) cart.clear();
        }
        return;
      }

      // DELETE last line
      if ((e.key === 'Delete' || e.key === 'Supr') && !typing){
        if (!cart.active.lines.length) return;
        e.preventDefault();
        cart.removeLine(cart.active.lines.length-1);
        return;
      }

      // +/- qty last line
      if (!typing && (e.key === '+' || e.key === '=')){
        if (!cart.active.lines.length) return;
        e.preventDefault();
        cart.inc(cart.active.lines.length-1, +1);
        return;
      }
      if (!typing && (e.key === '-' || e.key === '_')){
        if (!cart.active.lines.length) return;
        e.preventDefault();
        cart.inc(cart.active.lines.length-1, -1);
        return;
      }
    });
  }

  /* =========================
     GLOBAL SCAN LISTENER
  ========================== */
  function bindScannerGlobal(){
    window.addEventListener('keydown', (e) => {
      if (!scanner.enabled()) return;

      // ignore modifiers
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      // if any dialog open, do not capture as scan (avoid typing in modals)
      if (document.querySelector('dialog[open]')) return;

      // Accept digits and letters (some barcodes include letters)
      const k = e.key;

      // finalize on Enter
      if (k === 'Enter'){
        if (scanner.buf.length >= 4){
          const code = scanner.buf;
          scanner.reset();
          finalizeScan(code);
        }
        return;
      }

      // accept typical barcode characters
      if (k.length === 1 && /[0-9A-Za-z]/.test(k)){
        scanner.pushChar(k);
      } else {
        // other key breaks
        // don't reset immediately; just ignore
      }
    });
  }

  /* =========================
     INIT
  ========================== */
  async function init(){
    await ensureDefaultHashes();
    normalizeCategories();

    // apply theme
    setTheme(state.settings.theme || 'day');

    // initial selected category
    if (!state.ui.selectedCategoryId) state.ui.selectedCategoryId = 'c_all';

    // bind
    bindTabs();
    bindTop();
    bindModals();
    bindVenta();
    bindProductos();
    bindVentas();
    bindAjustes();
    bindShortcuts();
    bindScannerGlobal();

    // default tab
    setTab('venta');
    focusBarcodeSoon();

    // render
    renderAll();

    // clock refresh
    setInterval(() => {
      if (el.ticketDate) el.ticketDate.textContent = nowEs();
      renderAdminState();
    }, 15000);

    // scanner indicator
    if (el.scanDot){
      el.scanDot.style.opacity = state.settings.alwaysScan ? '1' : '.35';
    }
  }

  init();

})();

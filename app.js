/* =========================
TPV NADEEM LOCUTORIO — B/W PRO (PAQUETE PRO)
Archivo: app.js

- Escucha permanente de escaneo (barcode) + Enter o timeout rápido
- Categorías: crear/renombrar/borrar (Admin) + asignación por producto
- Venta: categorías debajo de barcode/buscar + grid productos por categoría
- Cobro PRO en panel derecho:
  - botones billetes + exacto + limpiar
  - teclado numérico (modal) para “Entregado”
  - cambio SIEMPRE visible (sin flash / sin ocultar a los 3s)
- Impresión ON/OFF: si OFF no se llama a window.print()
- Cierre Z:
  - calcula esperado (efectivo/tarjeta/mixto)
  - introduces contado -> descuadre +/- (se muestra en vivo)
  - imprime Z (si impresión ON)
  - cierra día: guarda en reportes y LIMPIA ventas abiertas
- Reportes: hoy/ayer/semana/mes/personalizado con tabla + top productos
- Export: productos CSV, ventas CSV, cierres Z CSV
- Backup/Restore JSON
- Seguridad: login local (cajero/admin) + PIN admin (hash) + auto-lock admin por inactividad
- Crédito: footer + Ajustes→About plegable + botón “Copiar info”
========================= */

(() => {
  'use strict';

  /* =========================
     HELPERS
  ========================== */
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  const LS_KEY = 'TPV_NADEEM_LOCUTORIO_PRO_V1';

  const pad = (n) => (n < 10 ? '0' : '') + n;
  const todayKey = () => new Date().toISOString().slice(0,10); // YYYY-MM-DD (UTC-ish). OK para día.
  const nowEs = () => {
    const d = new Date();
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
    return (...args) => { clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
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
    const out = [];
    for (const line of lines){
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
      } else cur += ch;
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
      version: 'pro-1.0',
      settings: {
        shopName: 'MALIK AHMAD NADEEM',
        shopSub: 'C/ Vitoria 139 · 09007 Burgos · Tlf 632 480 316 · CIF 72374062P',
        footerText: 'Gracias por su compra',
        boxName: 'CAJA-1',
        theme: 'day',

        // impresión
        printEnabled: true,
        autoPrint: false,

        // escáner
        alwaysScan: true,
        scanSpeedMs: 35, // 30–45 recomendado

        // seguridad
        adminPinHash: '', // default 1234 (hash)
        autoLockMin: 10,  // minutos para bloquear admin por inactividad
      },

      session: {
        user: { name: 'CAJERO', role: 'cashier' },
        adminUnlockedUntil: 0,
        lastActivity: Date.now(),
      },

      // login local demo
      users: [
        { username:'cajero', passHash:'', role:'cashier' },
        { username:'admin',  passHash:'', role:'admin'   },
      ],

      categories: [
        cat('c_all', 'Todos'),
        cat('c_fav', 'Favoritos'),
        cat('c_fr', 'Fruta'),
        cat('c_ve', 'Verdura'),
        cat('c_tr', 'Tropical'),
        cat('c_ot', 'Otros'),
      ],

      products: [
        { id:'P1', barcode:'1234567890123', name:'Plátano',  price:1.89, cost:1.20, categoryId:'c_fr', fav:true, unit:'ud' },
        { id:'P2', barcode:'7894561230123', name:'Manzana',  price:2.40, cost:1.50, categoryId:'c_fr', fav:true, unit:'ud' },
        { id:'P3', barcode:'2345678901234', name:'Naranja',  price:1.60, cost:0.95, categoryId:'c_fr', fav:true, unit:'ud' },
        { id:'P4', barcode:'3456789012345', name:'Tomate',   price:2.10, cost:1.25, categoryId:'c_ve', fav:true, unit:'ud' },
        { id:'P5', barcode:'4567890123456', name:'Lechuga',  price:1.20, cost:0.70, categoryId:'c_ve', fav:true, unit:'ud' },
        { id:'P6', barcode:'5678901234567', name:'Aguacate', price:3.90, cost:2.30, categoryId:'c_tr', fav:true, unit:'ud' },
        { id:'P7', barcode:'',              name:'Bolsa',    price:0.10, cost:null, categoryId:'c_ot', fav:true, unit:'ud' },
      ],

      ui: {
        selectedCategoryId: 'c_all',
      },

      counters: {
        ticketSeq: 1,
      },

      // Ticket en curso
      cart: {
        lines: [],
        payMethod: 'efectivo',
        given: 0,
        noteName: '',
      },

      // Aparcados
      parked: [], // [{id,name,cart,ts}]

      // Día abierto (ventas operativas)
      openDayKey: todayKey(),
      openSales: [], // ventas del día (abierto)

      // Reportes por día cerrado: [{ dayKey, sales, z, totals, ts }]
      dayReports: [],

      // Historial cierres Z (para export rápido)
      zClosures: [],

      // Última venta (reimpresión)
      lastSaleId: null,

      audit: [],
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
    billButtons: $$('.bill'),

    btnVoid: $('#btnVoid'),
    btnRefund: $('#btnRefund'),
    btnPay: $('#btnPay'),
    btnPrint: $('#btnPrint'),
    btnLastTicket: $('#btnLastTicket'),
    btnEmailTicket: $('#btnEmailTicket'),

    btnPrintToggle: $('#btnPrintToggle'),
    printState: $('#printState'),

    btnQuickAmount: $('#btnQuickAmount'),
    btnPark: $('#btnPark'),
    parkBadge: $('#parkBadge'),

    btnOpenZ: $('#btnOpenZ'),

    // Productos
    btnAddProduct: $('#btnAddProduct'),
    btnImportCsv: $('#btnImportCsv'),
    btnExportCsv: $('#btnExportCsv'),
    btnBackupJson: $('#btnBackupJson'),
    btnRestoreJson: $('#btnRestoreJson'),
    prodSearchName: $('#prodSearchName'),
    prodSearchBarcode: $('#prodSearchBarcode'),
    prodSearchCat: $('#prodSearchCat'),
    productsTable: $('#productsTable'),

    // Reportes
    repPreset: $('#repPreset'),
    repFrom: $('#repFrom'),
    repTo: $('#repTo'),

    statTickets: $('#statTickets'),
    statTotal: $('#statTotal'),
    statCash: $('#statCash'),
    statCard: $('#statCard'),

    topProducts: $('#topProducts'),
    zInfo: $('#zInfo'),
    salesTable: $('#salesTable'),

    btnExportSalesCsv: $('#btnExportSalesCsv'),
    btnExportZCsv: $('#btnExportZCsv'),

    // Ajustes
    btnAdminUnlock: $('#btnAdminUnlock'),
    setShopName: $('#setShopName'),
    setShopSub: $('#setShopSub'),
    setBoxName: $('#setBoxName'),
    setFooterText: $('#setFooterText'),

    setPrintEnabled: $('#setPrintEnabled'),
    setAutoPrint: $('#setAutoPrint'),

    setAlwaysScan: $('#setAlwaysScan'),
    setScanSpeed: $('#setScanSpeed'),

    setAdminPin: $('#setAdminPin'),
    setAutoLockMin: $('#setAutoLockMin'),

    aboutVersion: $('#aboutVersion'),
    btnCopyAbout: $('#btnCopyAbout'),

    // Files
    fileCsv: $('#fileCsv'),
    fileJson: $('#fileJson'),

    // Modals
    backdrop: $('#backdrop'),
    closeBtns: $$('[data-close]'),

    modalLogin: $('#modalLogin'),
    modalAdmin: $('#modalAdmin'),
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

    // quick
    quickAmount: $('#quickAmount'),
    quickName: $('#quickName'),
    keypadQuick: $('#keypadQuick'),
    btnQuickOk: $('#btnQuickOk'),

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

    // categories
    newCatName: $('#newCatName'),
    btnCreateCat: $('#btnCreateCat'),
    catList: $('#catList'),

    // parked
    parkName: $('#parkName'),
    btnParkNow: $('#btnParkNow'),
    parkList: $('#parkList'),

    // Z
    zExpected: $('#zExpected'),
    zCashCounted: $('#zCashCounted'),
    zNote: $('#zNote'),
    zDiff: $('#zDiff'),
    btnZOk: $('#btnZOk'),

    // Email
    emailTo: $('#emailTo'),
    emailMsg: $('#emailMsg'),
    btnEmailSend: $('#btnEmailSend'),

    // Print + toast
    printArea: $('#printArea'),
    toastHost: $('#toastHost'),
  };

  /* =========================
     TOAST + AUDIT + ACTIVITY
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
     DAY MANAGEMENT (open day)
  ========================== */
  function ensureOpenDay(){
    const t = todayKey();
    if (!state.openDayKey) state.openDayKey = t;
    // Si cambió el día y NO hay ventas abiertas, rotamos el openDayKey al día actual
    if (state.openDayKey !== t && (!state.openSales || state.openSales.length === 0)) {
      state.openDayKey = t;
      save();
    }
    // Si cambió el día y aún hay ventas abiertas, NO tocamos (se cerrará manual con Z)
  }

  /* =========================
     CATEGORIES
  ========================== */
  function normalizeCategories(){
    const ensure = (id, name) => {
      if (!state.categories.some(c => c.id === id)) state.categories.unshift({ id, name });
    };
    ensure('c_all', 'Todos');
    ensure('c_fav', 'Favoritos');
    save();
  }

  function getCatName(id){
    return state.categories.find(c => c.id === id)?.name || '—';
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
     CART (ticket en curso)
  ========================== */
  const cart = {
    get lines(){ return state.cart.lines; },

    totals(){
      const total = state.cart.lines.reduce((s,l) => s + (Number(l.price) * Number(l.qty||0)), 0);
      return { total, subtotal: total };
    },

    addProduct(p, qty=1){
      if (!p) return;
      const key = p.id || p.barcode || p.name;
      const idx = state.cart.lines.findIndex(l => l.key === key && !l.isManual);
      if (idx >= 0) state.cart.lines[idx].qty += qty;
      else state.cart.lines.push({
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
    },

    removeLine(index){
      state.cart.lines.splice(index, 1);
      save();
      renderAll();
    },

    setQty(index, qty){
      const q = Math.max(0, Math.floor(Number(qty||0)));
      if (q <= 0) return cart.removeLine(index);
      state.cart.lines[index].qty = q;
      save();
      renderAll();
    },

    inc(index, delta){
      const l = state.cart.lines[index];
      if (!l) return;
      cart.setQty(index, (l.qty||0) + delta);
    },

    clearTicket(){
      state.cart = { lines: [], payMethod: 'efectivo', given: 0, noteName: '' };
      save();
      renderAll();
    }
  };

  /* =========================
     PARKED
  ========================== */
  function renderParkBadge(){
    const n = state.parked.length;
    if (!el.parkBadge) return;
    el.parkBadge.hidden = n <= 0;
    el.parkBadge.textContent = String(n);
  }

  function openParkModal(){
    openModal(el.modalPark);
    renderParkedList();
  }

  function parkNow(nameOpt){
    if (!state.cart.lines.length) return toast('No hay líneas');
    const item = {
      id: 'K-' + uid(),
      name: String(nameOpt||'').trim(),
      cart: JSON.parse(JSON.stringify(state.cart)),
      ts: Date.now()
    };
    state.parked.unshift(item);
    cart.clearTicket();
    save();
    renderParkBadge();
    renderParkedList();
    toast('Aparcado');
  }

  function restoreParked(id){
    const idx = state.parked.findIndex(x => x.id === id);
    if (idx < 0) return;
    if (state.cart.lines.length) {
      if (!confirm('Hay un ticket en curso. ¿Reemplazarlo por el aparcado?')) return;
    }
    state.cart = state.parked[idx].cart;
    state.parked.splice(idx, 1);
    save();
    renderAll();
    renderParkBadge();
    renderParkedList();
    closeModal(el.modalPark);
    toast('Recuperado');
  }

  function deleteParked(id){
    const idx = state.parked.findIndex(x => x.id === id);
    if (idx < 0) return;
    state.parked.splice(idx, 1);
    save();
    renderParkBadge();
    renderParkedList();
  }

  function renderParkedList(){
    if (!el.parkList) return;
    el.parkList.innerHTML = '';
    const items = state.parked.slice();

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
      div.querySelector('[data-act="restore"]').addEventListener('click', () => restoreParked(it.id));
      div.querySelector('[data-act="del"]').addEventListener('click', () => deleteParked(it.id));
      el.parkList.appendChild(div);
    }
  }

  /* =========================
     PRINT + EMAIL
  ========================== */
  function canPrint(){
    return !!state.settings.printEnabled;
  }

  function renderPrintState(){
    if (el.printState) el.printState.textContent = canPrint() ? 'ON' : 'OFF';
    if (el.setPrintEnabled) el.setPrintEnabled.value = canPrint() ? '1' : '0';
  }

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

  function buildZHTML(z){
    // Z ticket 80mm
    const head = `
      <div style="text-align:center; font-weight:900; margin-bottom:4px;">${escapeHtml(state.settings.shopName)}</div>
      <div style="text-align:center; margin-bottom:8px;">${escapeHtml(state.settings.shopSub)}</div>
      <div style="border-top:1px dashed #000; margin:6px 0;"></div>
      <div style="text-align:center; font-weight:900;">CIERRE Z</div>
      <div>${escapeHtml(z.dayKey)}  ${escapeHtml(z.at)}</div>
      <div>Caja: ${escapeHtml(z.box)}  Cajero: ${escapeHtml(z.user)}</div>
      <div style="border-top:1px dashed #000; margin:6px 0;"></div>
    `;

    const body = `
      <div style="display:flex; justify-content:space-between;"><div>Tickets</div><div>${z.count}</div></div>
      <div style="display:flex; justify-content:space-between;"><div>Total</div><div>${fmtMoney(z.total)} €</div></div>
      <div style="display:flex; justify-content:space-between;"><div>Efectivo</div><div>${fmtMoney(z.cash)} €</div></div>
      <div style="display:flex; justify-content:space-between;"><div>Tarjeta</div><div>${fmtMoney(z.card)} €</div></div>
      <div style="border-top:1px dashed #000; margin:6px 0;"></div>
      <div style="display:flex; justify-content:space-between;"><div>Efectivo esperado</div><div>${fmtMoney(z.cashExpected)} €</div></div>
      <div style="display:flex; justify-content:space-between;"><div>Efectivo contado</div><div>${fmtMoney(z.cashCounted)} €</div></div>
      <div style="display:flex; justify-content:space-between; font-weight:900;"><div>Descuadre</div><div>${fmtMoney(z.diff)} €</div></div>
      ${z.note ? `<div style="margin-top:6px;">Nota: ${escapeHtml(z.note)}</div>` : ``}
    `;

    const foot = `
      <div style="border-top:1px dashed #000; margin:6px 0;"></div>
      <div style="text-align:center;">IVA incluido en los precios</div>
    `;
    return `<div>${head}${body}${foot}</div>`;
  }

  function printHTML(html){
    if (!el.printArea) return;
    if (!canPrint()) return; // ✅ impresión OFF => NO abrir panel
    el.printArea.innerHTML = html;
    window.print();
  }

  function printSale(s){
    printHTML(buildTicketHTML(s));
  }

  function printZ(z){
    printHTML(buildZHTML(z));
  }

  function buildReceiptText(s){
    const out = [];
    out.push(state.settings.shopName);
    out.push(state.settings.shopSub);
    out.push('------------------------------');
    out.push(`${s.ticketNo}   ${s.date}`);
    out.push(`Caja: ${s.box}   Cajero: ${s.user}`);
    out.push('------------------------------');
    for (const l of (s.lines||[])){
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

  function openEmailModal(){
    openModal(el.modalEmail);
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

  function buildPreviewSale(){
    const { total } = cart.totals();
    return {
      ticketNo: '(PREVIEW)',
      date: nowEs(),
      box: state.settings.boxName,
      user: state.session.user.name,
      payMethod: state.cart.payMethod,
      given: parseMoney(el.givenInput?.value || '0'),
      change: 0,
      noteName: (el.noteName?.value || '').trim(),
      lines: state.cart.lines.map(l => ({ name:l.name, qty:l.qty, price:l.price })),
      total
    };
  }

  function getLastSale(){
    if (!state.lastSaleId) return state.openSales[state.openSales.length-1] || null;
    return state.openSales.find(s => s.id === state.lastSaleId) ||
           // buscar también en reportes cerrados
           findSaleInReports(state.lastSaleId) ||
           state.openSales[state.openSales.length-1] ||
           null;
  }

  function findSaleInReports(id){
    for (let i=state.dayReports.length-1;i>=0;i--){
      const s = state.dayReports[i].sales?.find(x => x.id === id);
      if (s) return s;
    }
    return null;
  }

  /* =========================
     REPORT CALCS (from range)
  ========================== */
  function dateToKeyLocal(d){
    // d: Date
    const y = d.getFullYear();
    const m = pad(d.getMonth()+1);
    const dd = pad(d.getDate());
    return `${y}-${m}-${dd}`;
  }

  function rangeKeysFromPreset(preset){
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const toKey = (d) => dateToKeyLocal(d);

    if (preset === 'hoy') {
      const k = toKey(today);
      return { from:k, to:k };
    }
    if (preset === 'ayer') {
      const d = new Date(today); d.setDate(d.getDate()-1);
      const k = toKey(d);
      return { from:k, to:k };
    }
    if (preset === 'semana') {
      // Lunes a Domingo (es-ES)
      const d = new Date(today);
      const day = (d.getDay()+6)%7; // lunes=0
      d.setDate(d.getDate()-day);
      const from = toKey(d);
      const d2 = new Date(d); d2.setDate(d2.getDate()+6);
      const to = toKey(d2);
      return { from, to };
    }
    if (preset === 'mes') {
      const fromD = new Date(today.getFullYear(), today.getMonth(), 1);
      const toD = new Date(today.getFullYear(), today.getMonth()+1, 0);
      return { from: toKey(fromD), to: toKey(toD) };
    }
    return null;
  }

  function inRange(dayKey, fromKey, toKey){
    return dayKey >= fromKey && dayKey <= toKey;
  }

  function collectSalesForRange(fromKey, toKey){
    const sales = [];

    // 1) días cerrados
    for (const d of state.dayReports){
      if (inRange(d.dayKey, fromKey, toKey)) {
        for (const s of (d.sales || [])) sales.push({ ...s, _dayKey: d.dayKey, _closed: true });
      }
    }

    // 2) día abierto si cae en rango
    if (state.openDayKey && inRange(state.openDayKey, fromKey, toKey)) {
      for (const s of (state.openSales || [])) sales.push({ ...s, _dayKey: state.openDayKey, _closed: false });
    }

    // orden por ts
    sales.sort((a,b) => (a.ts||0) - (b.ts||0));
    return sales;
  }

  function calcSummaryFromSales(sales){
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

  function topProductsFromSales(sales, n=5){
    const map = new Map();
    for (const s of sales){
      for (const l of (s.lines||[])){
        const k = l.name;
        const v = (Number(l.price) * Number(l.qty||0));
        map.set(k, (map.get(k)||0) + v);
      }
    }
    return Array.from(map.entries())
      .sort((a,b)=>b[1]-a[1])
      .slice(0,n)
      .map(([name, val]) => `${name}: ${fmtEUR(val)}`)
      .join(' · ');
  }

  /* =========================
     SALE / PAY FLOW
  ========================== */
  function computeChange(){
    const { total } = cart.totals();
    const method = state.cart.payMethod || 'efectivo';
    const given = parseMoney(el.givenInput?.value ?? state.cart.given);

    let change = 0;
    if (method === 'efectivo') change = Math.max(0, given - total);
    else change = 0;

    // ✅ NO flash, NO ocultar, NO timeout: siempre actualizamos y lo dejamos visible
    if (el.changeInput) el.changeInput.value = fmtMoney(change);
    return { total, given, change };
  }

  function nextSaleFromCart(){
    const { total } = cart.totals();
    if (!(total > 0)) return null;

    const payMethod = state.cart.payMethod || 'efectivo';
    const given = parseMoney(el.givenInput?.value ?? state.cart.given);

    // Mixto (en este TPV: se registra como tarjeta si no implementas split aquí; dejamos split opcional future)
    // Para mantenerlo simple: si método mixto, pedimos valores por prompt admin en futuras mejoras.
    // Aquí: mixto se guarda como "mixto" con split null (puedes ampliarlo).
    const sale = {
      id: uid(),
      ticketNo: nextTicketNo(),
      date: nowEs(),
      dayKey: state.openDayKey,
      box: state.settings.boxName,
      user: state.session.user.name,
      payMethod,
      given: (payMethod === 'efectivo') ? Number(given||0) : 0,
      change: 0,
      noteName: String(el.noteName?.value || state.cart.noteName || '').trim(),
      lines: state.cart.lines.map(l => ({
        name: l.name,
        barcode: l.barcode || '',
        qty: Number(l.qty||0),
        price: Number(l.price||0),
        cost: l.cost == null ? null : Number(l.cost),
        isManual: !!l.isManual
      })),
      total,
      split: null,
      ts: Date.now()
    };

    if (payMethod === 'efectivo'){
      sale.change = Math.max(0, sale.given - sale.total);
    }
    return sale;
  }

  function confirmSale(){
    ensureOpenDay();
    const sale = nextSaleFromCart();
    if (!sale) return toast('No hay total');

    // Validación mínima
    if (sale.payMethod === 'efectivo' && sale.given < sale.total){
      if (!confirm('Entregado menor que total. ¿Confirmar igualmente?')) return;
    }

    state.openSales.push(sale);
    state.lastSaleId = sale.id;
    save();
    audit('SALE_CREATE', { ticketNo: sale.ticketNo, total: sale.total, payMethod: sale.payMethod });

    // impresión auto
    if (state.settings.autoPrint && canPrint()){
      printSale(sale);
    } else {
      // No forzamos confirm de impresión aquí; el usuario tiene botón Imprimir o autoPrint.
      // (Si quieres, lo cambias a confirm.)
    }

    // Limpieza ticket para seguir vendiendo rápido
    cart.clearTicket();
    if (el.ticketNo) el.ticketNo.textContent = sale.ticketNo;
    toast(`Venta OK · ${sale.ticketNo}`);

    // foco escáner
    focusBarcodeSoon();

    // refrescar reportes si están abiertos
    renderReports();
  }

  function refundLast(){
    requireAdminOrPrompt(() => {
      const last = getLastSale();
      if (!last) return toast('No hay venta');
      // devolucion negativa
      const refund = {
        ...last,
        id: uid(),
        ticketNo: nextTicketNo(),
        date: nowEs(),
        payMethod: 'devolucion',
        lines: (last.lines||[]).map(l => ({ ...l, qty: -Math.abs(l.qty) })),
        total: -Math.abs(last.total),
        noteName: `DEVOLUCIÓN de ${last.ticketNo}`,
        ts: Date.now()
      };
      // se registra en día abierto (operativa)
      state.openSales.push(refund);
      state.lastSaleId = refund.id;
      save();
      audit('SALE_REFUND', { from: last.ticketNo, refund: refund.ticketNo, total: refund.total });
      toast('Devolución registrada');
      renderReports();
    });
  }

  /* =========================
     Z CLOSE (print + close day)
  ========================== */
  function calcOpenSummary(){
    const sales = state.openSales.slice();
    const sum = calcSummaryFromSales(sales);
    return { sales, ...sum };
  }

  function openZModal(){
    requireAdminOrPrompt(() => {
      ensureOpenDay();
      const { count, total, cash, card } = calcOpenSummary();
      const expected = `Día: ${state.openDayKey}\nTickets: ${count}\nTotal: ${fmtEUR(total)}\nEfectivo: ${fmtEUR(cash)}\nTarjeta: ${fmtEUR(card)}`;
      if (el.zExpected) el.zExpected.textContent = expected.replaceAll('\n', ' · ');
      if (el.zCashCounted) el.zCashCounted.value = '';
      if (el.zNote) el.zNote.value = '';
      if (el.zDiff) el.zDiff.textContent = '—';
      openModal(el.modalZ);
    });
  }

  function updateZDiffLive(){
    const { cash } = calcOpenSummary();
    const counted = parseMoney(el.zCashCounted?.value || '0');
    const diff = counted - cash;
    if (el.zDiff) {
      const sign = diff >= 0 ? '+' : '−';
      el.zDiff.textContent = `Descuadre: ${sign}${fmtMoney(Math.abs(diff))} €`;
    }
  }

  function closeDayWithZ(){
    ensureOpenDay();
    const { sales, count, total, cash, card } = calcOpenSummary();
    const counted = parseMoney(el.zCashCounted?.value || '0');
    const diff = counted - cash;
    const note = (el.zNote?.value || '').trim();

    const z = {
      id: 'Z-' + uid(),
      at: nowEs(),
      dayKey: state.openDayKey,
      box: state.settings.boxName,
      user: state.session.user.name,
      count,
      total,
      cash,
      card,
      cashExpected: cash,
      cashCounted: counted,
      diff,
      note,
      ts: Date.now()
    };

    // Guardar report del día (ventas del día abierto)
    const dayReport = {
      dayKey: state.openDayKey,
      sales: sales,
      totals: { count, total, cash, card },
      z,
      ts: Date.now()
    };
    state.dayReports.push(dayReport);
    state.zClosures.push(z);

    audit('Z_CLOSE', { dayKey: z.dayKey, total: z.total, diff: z.diff });

    // Imprimir Z (si print ON)
    if (canPrint()){
      printZ(z);
    }

    // Cerrar día = limpiar ventas abiertas (pero ya guardadas)
    state.openSales = [];
    // Mantener openDayKey: si hoy es otro, rotar; si es el mismo, queda listo para nuevas ventas hoy
    const t = todayKey();
    if (state.openDayKey !== t) state.openDayKey = t;

    // Limpiar ticket en curso
    cart.clearTicket();

    save();
    closeModal(el.modalZ);
    toast('Día cerrado (Z) y ventas abiertas limpiadas');
    renderReports();
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
    renderPrintState();

    if (el.aboutVersion) el.aboutVersion.textContent = state.version;
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

    // Tile: teclado para "entregado"
    el.prodGrid.appendChild(makeProdTile('Teclado cobro', 'Entregado', 'Numérico', () => openPayKeypad()));

    // Tile: importe rápido (línea)
    el.prodGrid.appendChild(makeProdTile('Importe rápido', 'Línea manual', 'Teclado', () => openModal(el.modalQuick)));

    const items = listProductsForSelectedCategory();
    for (const p of items){
      const sub = p.barcode ? `BC: ${p.barcode}` : 'Manual';
      const btn = makeProdTile(p.name, fmtEUR(p.price||0), sub, () => cart.addProduct(p, 1));
      // click derecho: editar producto (admin)
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

  function renderTotalsAndPay(){
    const { total } = cart.totals();
    if (el.linesCount) el.linesCount.textContent = String(state.cart.lines.length);
    if (el.subTotal) el.subTotal.textContent = fmtEUR(total);
    if (el.grandTotal) el.grandTotal.textContent = fmtEUR(total);

    // keep note
    if (el.noteName && state.cart.noteName !== el.noteName.value) {
      // no forzamos, solo sincronizamos cuando está vacío
      if (!el.noteName.value) el.noteName.value = state.cart.noteName || '';
    }

    computeChange(); // ✅ cambio permanente
  }

  /* =========================
     PRODUCTS TABLE
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

  /* =========================
     REPORTES RENDER
  ========================== */
  function setReportDatesByPreset(){
    const preset = el.repPreset?.value || 'hoy';
    const r = rangeKeysFromPreset(preset);
    if (!r) return;
    if (el.repFrom) el.repFrom.value = r.from;
    if (el.repTo) el.repTo.value = r.to;
  }

  function renderReports(){
    if (!el.repFrom || !el.repTo) return;

    const preset = el.repPreset?.value || 'hoy';
    if (preset !== 'personal') setReportDatesByPreset();

    const fromKey = el.repFrom.value || todayKey();
    const toKey = el.repTo.value || todayKey();

    const sales = collectSalesForRange(fromKey, toKey);
    const sum = calcSummaryFromSales(sales);

    if (el.statTickets) el.statTickets.textContent = String(sum.count);
    if (el.statTotal) el.statTotal.textContent = fmtEUR(sum.total);
    if (el.statCash) el.statCash.textContent = fmtEUR(sum.cash);
    if (el.statCard) el.statCard.textContent = fmtEUR(sum.card);

    if (el.topProducts) el.topProducts.textContent = topProductsFromSales(sales) || '—';

    // cierres Z info: último cierre dentro del rango
    if (el.zInfo){
      const zs = state.zClosures.filter(z => inRange(z.dayKey, fromKey, toKey));
      const lastZ = zs.slice(-1)[0];
      el.zInfo.textContent = lastZ
        ? `${lastZ.dayKey} · esperado ${fmtEUR(lastZ.cashExpected)} · contado ${fmtEUR(lastZ.cashCounted)} · descuadre ${fmtEUR(lastZ.diff)}`
        : 'Sin cierres.';
    }

    // tabla ventas
    if (el.salesTable){
      const thead = el.salesTable.querySelector('.trow.thead');
      el.salesTable.innerHTML = '';
      if (thead) el.salesTable.appendChild(thead);

      const last = sales.slice().reverse().slice(0, 120);
      for (const s of last){
        const row = document.createElement('div');
        row.className = 'trow';
        row.innerHTML = `
          <div class="tcell mono">${escapeHtml(s.date)}${s._closed ? '' : ' · (abierto)'}</div>
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
  }

  /* =========================
     PRODUCT MODAL (new/edit)
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
     QUICK AMOUNT (línea) + keypad
  ========================== */
  function keypadInsertQuick(k){
    const inp = el.quickAmount;
    if (!inp) return;
    let v = String(inp.value || '');
    if (k === 'c'){ inp.value=''; return; }
    if (k === 'bk'){ inp.value = v.slice(0,-1); return; }
    if (k === ','){
      if (v.includes(',') || v.includes('.')) return;
      inp.value = v + ',';
      return;
    }
    if (k === 'ok'){ quickOk(); return; }
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
     PAY KEYPAD (Entregado) - modal creado por JS
  ========================== */
  let payPadDlg = null;

  function ensurePayPad(){
    if (payPadDlg) return;

    // CSS keypad ya existe; creamos un <dialog> similar
    payPadDlg = document.createElement('dialog');
    payPadDlg.className = 'modal';
    payPadDlg.id = 'modalPayPad';
    payPadDlg.setAttribute('aria-label', 'Teclado cobro');

    payPadDlg.innerHTML = `
      <div class="modal-head">
        <div>
          <div class="modal-title">Teclado cobro</div>
          <div class="muted small">Entregado → cambio inmediato</div>
        </div>
        <button class="icon-btn" data-close-local="1" aria-label="Cerrar">✕</button>
      </div>
      <div class="modal-body">
        <div class="field-row">
          <label class="field">
            <span>Entregado (€)</span>
            <input id="payPadValue" inputmode="decimal" placeholder="0,00" />
          </label>
          <label class="field">
            <span>Cambio</span>
            <input id="payPadChange" disabled placeholder="0,00" />
          </label>
        </div>

        <div class="keypad" id="keypadPay">
          <button class="key" data-k="7">7</button><button class="key" data-k="8">8</button><button class="key" data-k="9">9</button><button class="key key-fn" data-k="bk">⌫</button>
          <button class="key" data-k="4">4</button><button class="key" data-k="5">5</button><button class="key" data-k="6">6</button><button class="key key-fn" data-k="c">C</button>
          <button class="key" data-k="1">1</button><button class="key" data-k="2">2</button><button class="key" data-k="3">3</button><button class="key key-fn" data-k=",">,</button>
          <button class="key key-wide" data-k="0">0</button><button class="key" data-k="00">00</button><button class="key key-ok" data-k="ok">OK</button>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-close-local="1" type="button">Cancelar</button>
        <button class="btn btn-primary" id="btnPayPadOk" type="button">Aplicar</button>
      </div>
    `;

    document.body.appendChild(payPadDlg);

    // close
    payPadDlg.querySelectorAll('[data-close-local]').forEach(b => {
      b.addEventListener('click', () => {
        payPadDlg.close();
        if (el.backdrop) el.backdrop.hidden = true;
        focusBarcodeSoon();
      });
    });

    // keypad
    const padInput = payPadDlg.querySelector('#payPadValue');
    const padChange = payPadDlg.querySelector('#payPadChange');

    const update = () => {
      const { total } = cart.totals();
      const given = parseMoney(padInput.value || '0');
      const change = Math.max(0, given - total);
      padChange.value = fmtMoney(change);
    };

    padInput.addEventListener('input', update);

    payPadDlg.querySelector('#keypadPay').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-k]');
      if (!btn) return;
      const k = btn.dataset.k;

      let v = String(padInput.value || '');
      if (k === 'c'){ padInput.value=''; update(); return; }
      if (k === 'bk'){ padInput.value=v.slice(0,-1); update(); return; }
      if (k === ','){
        if (v.includes(',') || v.includes('.')) return;
        padInput.value = v + ',';
        update();
        return;
      }
      if (k === 'ok'){
        applyPayPadValue(padInput.value);
        return;
      }
      padInput.value = v + String(k);
      update();
    });

    payPadDlg.querySelector('#btnPayPadOk').addEventListener('click', () => applyPayPadValue(padInput.value));
  }

  function openPayKeypad(){
    ensurePayPad();
    if (el.backdrop) el.backdrop.hidden = false;
    payPadDlg.showModal();

    const padInput = payPadDlg.querySelector('#payPadValue');
    const padChange = payPadDlg.querySelector('#payPadChange');

    // preload current given
    padInput.value = (el.givenInput?.value || '').trim();
    const { total } = cart.totals();
    const given = parseMoney(padInput.value || '0');
    padChange.value = fmtMoney(Math.max(0, given - total));

    setTimeout(() => padInput.focus(), 25);
  }

  function applyPayPadValue(value){
    const v = parseMoney(value || '0');
    if (el.givenInput) el.givenInput.value = fmtMoney(v).replace('.', ','); // es-ES, aunque fmtMoney ya usa coma en UI
    state.cart.given = v;
    save();
    computeChange();
    payPadDlg.close();
    if (el.backdrop) el.backdrop.hidden = true;
    focusBarcodeSoon();
  }

  /* =========================
     EXPORTS / BACKUP
  ========================== */
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

  function exportSalesCSV(){
    // Exporta TODAS las ventas: abiertas + cerradas
    const rows = [['dia','fecha','ticket','pago','total','cajero','caja','lineas']];
    // cerradas
    for (const d of state.dayReports){
      for (const s of (d.sales||[])){
        rows.push([
          d.dayKey,
          s.date,
          s.ticketNo,
          s.payMethod,
          fmtMoney(s.total||0),
          s.user,
          s.box,
          (s.lines||[]).map(l => `${l.name}(${l.qty}x${fmtMoney(l.price)})`).join(' | ')
        ]);
      }
    }
    // abiertas
    for (const s of state.openSales){
      rows.push([
        state.openDayKey,
        s.date,
        s.ticketNo,
        s.payMethod,
        fmtMoney(s.total||0),
        s.user,
        s.box,
        (s.lines||[]).map(l => `${l.name}(${l.qty}x${fmtMoney(l.price)})`).join(' | ')
      ]);
    }
    downloadText('tpv_ventas.csv', toCSV(rows), 'text/csv');
  }

  function exportZCSV(){
    const rows = [['dia','hora','tickets','total','efectivo','tarjeta','esperado','contado','descuadre','nota']];
    for (const z of state.zClosures){
      rows.push([
        z.dayKey,
        z.at,
        z.count,
        fmtMoney(z.total||0),
        fmtMoney(z.cash||0),
        fmtMoney(z.card||0),
        fmtMoney(z.cashExpected||0),
        fmtMoney(z.cashCounted||0),
        fmtMoney(z.diff||0),
        z.note || ''
      ]);
    }
    downloadText('tpv_cierres_z.csv', toCSV(rows), 'text/csv');
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

        // categoría por nombre (crea si no existe)
        let catId = state.categories.find(c => c.name.toLowerCase() === String(catName||'').trim().toLowerCase())?.id;
        if (!catId){
          const created = createCategory(String(catName||'').trim());
          catId = created?.id || state.categories.find(c=>c.id==='c_ot')?.id || 'c_all';
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
     SCANNER (always listening)
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

      if (scanner.lastTs && gap > maxGap) scanner.buf = '';
      scanner.lastTs = t;
      scanner.buf += ch;

      if (scanner.timer) clearTimeout(scanner.timer);
      scanner.timer = setTimeout(() => {
        // Si el lector NO manda Enter, intentamos con buffer largo
        if (scanner.buf.length >= 8) finalizeScan(scanner.buf);
        scanner.reset();
      }, maxGap + 120);
    }
  };

  function finalizeScan(code){
    const c = String(code||'').trim();
    if (!c) return;

    // No capturar en diálogos abiertos
    if (document.querySelector('dialog[open]')) return;

    const p = findProductByBarcode(c);
    if (p){
      cart.addProduct(p, 1);
      toast('Escaneado ✓');
    } else {
      openNewProduct(c);
      toast('Barcode no encontrado: alta producto');
    }
    if (el.barcodeInput) el.barcodeInput.value = '';
    focusBarcodeSoon();
  }

  /* =========================
     BILL BUTTONS + PAY PANEL
  ========================== */
  function setGivenValue(val){
    const v = Math.max(0, Number(val||0));
    state.cart.given = v;
    if (el.givenInput) el.givenInput.value = fmtMoney(v);
    save();
    computeChange();
  }

  function addGiven(delta){
    const cur = parseMoney(el.givenInput?.value ?? state.cart.given);
    setGivenValue(cur + Number(delta||0));
  }

  function setExactGiven(){
    const { total } = cart.totals();
    setGivenValue(total);
  }

  function clearGiven(){
    setGivenValue(0);
  }

  /* =========================
     ABOUT COPY
  ========================== */
  function copyAbout(){
    const txt =
`TPV NADEEM LOCUTORIO
Versión: ${state.version}
Made by Arslan Waris · All rights reserved
Modo: Local (GitHub Pages) · IVA incluido`;
    navigator.clipboard?.writeText(txt).then(() => toast('Copiado')).catch(() => toast('No se pudo copiar'));
  }

  /* =========================
     RENDER ALL
  ========================== */
  function renderAll(){
    ensureOpenDay();
    renderHeader();
    renderCategoryChips();
    renderProductGrid();
    renderTicketLines();
    renderTotalsAndPay();
    renderProductsTable();
    renderReports();
  }

  /* =========================
     EVENTS
  ========================== */
  function bindTabs(){
    el.tabs.forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));
  }

  function bindTop(){
    el.btnTheme?.addEventListener('click', () => setTheme(document.body.classList.contains('theme-day') ? 'night' : 'day'));
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

    // admin pin
    el.btnAdminOk?.addEventListener('click', async () => {
      const pin = (el.adminPin?.value || '').trim();
      if (pin.length < 4) return toast('PIN inválido');
      if (!(await verifyAdminPin(pin))) return toast('PIN incorrecto');
      unlockAdmin(5);
      closeModal(el.modalAdmin);
      toast('Admin desbloqueado');
    });

    // quick keypad
    el.keypadQuick?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-k]');
      if (!btn) return;
      keypadInsertQuick(btn.dataset.k);
    });
    el.btnQuickOk?.addEventListener('click', quickOk);

    // product
    el.btnProductSave?.addEventListener('click', saveProductFromModal);

    // categories
    el.btnCreateCat?.addEventListener('click', createCatFromModal);

    // parked
    el.btnParkNow?.addEventListener('click', () => parkNow(el.parkName?.value || ''));

    // Z
    el.btnZOk?.addEventListener('click', closeDayWithZ);
    el.zCashCounted?.addEventListener('input', updateZDiffLive);

    // email
    el.btnEmailSend?.addEventListener('click', sendEmailMailto);
  }

  function bindVenta(){
    // Barcode enter (además de global scanner)
    el.barcodeInput?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const code = (el.barcodeInput.value || '').trim();
      el.barcodeInput.value = '';
      if (!code) return;
      finalizeScan(code);
    });

    // Search filters grid
    el.searchInput?.addEventListener('input', debounce(renderProductGrid, 80));

    // Pay method tabs
    el.payTabs.forEach(p => p.addEventListener('click', () => {
      el.payTabs.forEach(x => x.classList.remove('is-active'));
      p.classList.add('is-active');
      state.cart.payMethod = p.dataset.pay || 'efectivo';
      save();
      computeChange();
      focusBarcodeSoon();
    }));

    // Entregado manual -> cambio inmediato (sin flash)
    el.givenInput?.addEventListener('input', () => {
      state.cart.given = parseMoney(el.givenInput.value);
      save();
      computeChange();
    });

    // Nota
    el.noteName?.addEventListener('input', () => {
      state.cart.noteName = el.noteName.value || '';
      save();
    });

    // Billetes
    el.billButtons.forEach(b => b.addEventListener('click', () => {
      const v = b.dataset.bill;
      if (v === 'exacto') return setExactGiven();
      if (v === 'clear') return clearGiven();
      addGiven(Number(v));
    }));

    // Imprimir (manual)
    el.btnPrint?.addEventListener('click', () => {
      const last = getLastSale();
      if (last) return printSale(last);
      const prev = buildPreviewSale();
      if (!(prev.total > 0)) return toast('No hay ticket');
      printSale(prev);
    });

    // Impresión ON/OFF toggle
    el.btnPrintToggle?.addEventListener('click', () => {
      state.settings.printEnabled = !state.settings.printEnabled;
      save();
      renderPrintState();
      toast(`Impresión ${state.settings.printEnabled ? 'ON' : 'OFF'}`);
    });

    // Último
    el.btnLastTicket?.addEventListener('click', () => {
      const last = getLastSale();
      if (!last) return toast('No hay último ticket');
      printSale(last);
    });

    // Email
    el.btnEmailTicket?.addEventListener('click', openEmailModal);

    // Importe rápido (línea)
    el.btnQuickAmount?.addEventListener('click', () => openModal(el.modalQuick));

    // Aparcados
    el.btnPark?.addEventListener('click', openParkModal);

    // Anular ticket actual
    el.btnVoid?.addEventListener('click', () => {
      if (!state.cart.lines.length) return;
      if (!confirm('¿Anular ticket actual?')) return;
      cart.clearTicket();
      audit('CART_VOID', {});
      toast('Ticket anulado');
      focusBarcodeSoon();
    });

    // Devolución
    el.btnRefund?.addEventListener('click', refundLast);

    // Cobrar
    el.btnPay?.addEventListener('click', confirmSale);

    // Cierre Z
    el.btnOpenZ?.addEventListener('click', openZModal);

    // Cat actions
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

    // Add product inline
    el.btnAddProductInline?.addEventListener('click', () => openNewProduct(''));
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

  function bindReportes(){
    el.repPreset?.addEventListener('change', () => {
      renderReports();
    });
    el.repFrom?.addEventListener('change', renderReports);
    el.repTo?.addEventListener('change', renderReports);

    el.btnExportSalesCsv?.addEventListener('click', exportSalesCSV);
    el.btnExportZCsv?.addEventListener('click', exportZCSV);
  }

  function bindAjustes(){
    // init values
    if (el.setShopName) el.setShopName.value = state.settings.shopName;
    if (el.setShopSub) el.setShopSub.value = state.settings.shopSub;
    if (el.setBoxName) el.setBoxName.value = state.settings.boxName;
    if (el.setFooterText) el.setFooterText.value = state.settings.footerText;

    if (el.setPrintEnabled) el.setPrintEnabled.value = state.settings.printEnabled ? '1':'0';
    if (el.setAutoPrint) el.setAutoPrint.value = state.settings.autoPrint ? '1':'0';

    if (el.setAlwaysScan) el.setAlwaysScan.value = state.settings.alwaysScan ? '1':'0';
    if (el.setScanSpeed) el.setScanSpeed.value = String(state.settings.scanSpeedMs || 35);

    if (el.setAutoLockMin) el.setAutoLockMin.value = String(state.settings.autoLockMin || 10);

    const apply = debounce(() => {
      state.settings.shopName = el.setShopName?.value || state.settings.shopName;
      state.settings.shopSub = el.setShopSub?.value || state.settings.shopSub;
      state.settings.boxName = el.setBoxName?.value || state.settings.boxName;
      state.settings.footerText = el.setFooterText?.value || state.settings.footerText;

      state.settings.printEnabled = (el.setPrintEnabled?.value || '1') === '1';
      state.settings.autoPrint = (el.setAutoPrint?.value || '0') === '1';

      state.settings.alwaysScan = (el.setAlwaysScan?.value || '1') === '1';
      state.settings.scanSpeedMs = Math.max(15, Math.min(120, Number(el.setScanSpeed?.value || 35)));

      state.settings.autoLockMin = Math.max(1, Math.min(240, Number(el.setAutoLockMin?.value || 10)));

      save();
      renderHeader();
      toast('Ajustes guardados');
    }, 160);

    el.setShopName?.addEventListener('input', apply);
    el.setShopSub?.addEventListener('input', apply);
    el.setBoxName?.addEventListener('input', apply);
    el.setFooterText?.addEventListener('input', apply);

    el.setPrintEnabled?.addEventListener('change', () => {
      apply();
      renderPrintState();
    });
    el.setAutoPrint?.addEventListener('change', apply);

    el.setAlwaysScan?.addEventListener('change', apply);
    el.setScanSpeed?.addEventListener('input', apply);
    el.setAutoLockMin?.addEventListener('input', apply);

    // set admin pin (requires admin)
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

    // about copy
    el.btnCopyAbout?.addEventListener('click', copyAbout);
  }

  function bindShortcuts(){
    window.addEventListener('keydown', (e) => {
      touchActivity();

      const tag = document.activeElement?.tagName?.toLowerCase();
      const typing = (tag === 'input' || tag === 'textarea' || tag === 'select');

      if (e.key === 'F4'){ e.preventDefault(); confirmSale(); return; }
      if (e.key === 'F2'){ e.preventDefault(); openModal(el.modalQuick); return; }

      if (e.key === 'Escape'){
        const open = document.querySelector('dialog[open]');
        if (open){ e.preventDefault(); closeModal(open); return; }
        if (!typing && state.cart.lines.length){
          if (confirm('¿Limpiar ticket actual?')) cart.clearTicket();
        }
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Supr') && !typing){
        if (!state.cart.lines.length) return;
        e.preventDefault();
        cart.removeLine(state.cart.lines.length-1);
        return;
      }

      if (!typing && (e.key === '+' || e.key === '=')){
        if (!state.cart.lines.length) return;
        e.preventDefault();
        cart.inc(state.cart.lines.length-1, +1);
        return;
      }
      if (!typing && (e.key === '-' || e.key === '_')){
        if (!state.cart.lines.length) return;
        e.preventDefault();
        cart.inc(state.cart.lines.length-1, -1);
        return;
      }
    });
  }

  function bindScannerGlobal(){
    window.addEventListener('keydown', (e) => {
      if (!scanner.enabled()) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (document.querySelector('dialog[open]')) return;

      const k = e.key;

      if (k === 'Enter'){
        if (scanner.buf.length >= 4){
          const code = scanner.buf;
          scanner.reset();
          finalizeScan(code);
        }
        return;
      }

      if (k.length === 1 && /[0-9A-Za-z]/.test(k)){
        scanner.pushChar(k);
      }
    });
  }

  function bindGlobalClicks(){
    // Mantener foco “natural” hacia barcode cuando clickas fuera (sin molestar inputs)
    document.addEventListener('click', (e) => {
      touchActivity();
      const t = e.target;
      if (!t) return;
      if (t.closest('dialog')) return;
      const tag = t.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') return;
      focusBarcodeSoon();
    });

    document.addEventListener('keydown', () => touchActivity());
  }

  /* =========================
     INIT
  ========================== */
  async function init(){
    ensureOpenDay();
    normalizeCategories();
    await ensureDefaultHashes();

    // Inicializar método pago en UI
    state.cart.payMethod = state.cart.payMethod || 'efectivo';

    // Render
    renderAll();

    // Bindings
    bindTabs();
    bindTop();
    bindModals();
    bindVenta();
    bindProductos();
    bindReportes();
    bindAjustes();
    bindShortcuts();
    bindScannerGlobal();
    bindGlobalClicks();

    // Default tab
    setTab('venta');
    focusBarcodeSoon();

    // Clock + admin state refresh
    setInterval(() => {
      if (el.ticketDate) el.ticketDate.textContent = nowEs();
      renderAdminState();
    }, 15000);
  }

  init();
})();

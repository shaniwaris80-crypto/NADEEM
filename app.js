/* =========================
PARTE B — TPV TIENDA (OPCIÓN 1 / GITHUB)
Archivo: app.js
- Lógica POS (carrito, barcode, importe manual, cobro, ticket 80mm, mailto)
- Atajos teclado + foco escáner
- Persistencia local (LocalStorage) para: ajustes, productos (demo), sesión, carrito aparcado, ventas (básico)
- Parte C añadirá: CRUD completo productos + import/export CSV/JSON + reportes/gráficos + cierres Z avanzados

IMPORTANTE:
1) En index.html (PARTE A) hay un <script> inline de UI. Para usar app.js,
   QUITA o COMENTA el <script> inline final, y en su lugar añade:
   <script src="app.js" defer></script>
2) Si no lo quitas, no pasa nada grave, pero tendrás handlers duplicados.
========================= */

(() => {
  'use strict';

  /* =========================
     HELPERS
  ========================== */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const LS_KEY = 'TPV_BWPRO_V1';

  const pad = (n) => (n < 10 ? '0' : '') + n;

  const nowEs = () => {
    const d = new Date();
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // Money helpers (acepta coma o punto)
  const parseMoney = (s) => {
    if (s == null) return 0;
    const t = String(s).trim().replace(/\s/g, '').replace(',', '.');
    const v = Number(t);
    return Number.isFinite(v) ? v : 0;
  };

  const fmtMoney = (v) => {
    const n = Number(v || 0);
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const fmtMoneyEUR = (v) => `${fmtMoney(v)} €`;

  const uid = () => {
    // id corto sin libs
    return 'T' + Math.random().toString(36).slice(2, 8).toUpperCase() + Date.now().toString(36).slice(-4).toUpperCase();
  };

  const beep = () => {
    // Beep suave opcional (si navegador permite)
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880;
      g.gain.value = 0.03;
      o.start();
      setTimeout(() => { o.stop(); ctx.close(); }, 80);
    } catch (_) {}
  };

  /* =========================
     STATE (Local)
  ========================== */
  const defaultState = () => ({
    version: 1,
    settings: {
      shopName: 'Tu Tienda',
      shopSub: 'CIF / Dirección / Tel',
      footerText: 'Gracias por su compra',
      ticketWidth: '80mm',
      boxName: 'CAJA-1',
      theme: 'day',
      // Seguridad local (básica)
      adminPinHash: '', // se setea en Parte C (por ahora demo)
    },
    session: {
      user: { name: 'CAJERO', role: 'cashier' },
      adminUnlockedUntil: 0,
    },
    counters: {
      ticketSeq: 1,
    },
    products: [
      // DEMO (Parte C reemplaza con CRUD completo)
      { id: 'P1', barcode: '1234567890123', name: 'Plátano', price: 1.89, cost: 1.20, category: 'Fruta', fav: true },
      { id: 'P2', barcode: '7894561230123', name: 'Manzana', price: 2.40, cost: 1.50, category: 'Fruta', fav: true },
      { id: 'P3', barcode: '2345678901234', name: 'Naranja', price: 1.60, cost: 0.95, category: 'Fruta', fav: true },
      { id: 'P4', barcode: '3456789012345', name: 'Tomate', price: 2.10, cost: 1.25, category: 'Verdura', fav: true },
      { id: 'P5', barcode: '4567890123456', name: 'Lechuga', price: 1.20, cost: 0.70, category: 'Verdura', fav: true },
      { id: 'P6', barcode: '5678901234567', name: 'Aguacate', price: 3.90, cost: 2.30, category: 'Tropical', fav: true },
      // Manual sin barcode:
      { id: 'P7', barcode: '', name: 'Bolsa', price: 0.10, cost: null, category: 'Otros', fav: true },
    ],
    carts: {
      active: { lines: [], noteName: '', payMethod: 'efectivo', given: 0 },
      parked: null, // guarda una venta aparcada
    },
    sales: [], // ventas guardadas (básico)
    audit: [], // log básico (Parte C ampliará)
  });

  const store = {
    load() {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return defaultState();
        const parsed = JSON.parse(raw);
        // merge suave por si faltan campos
        return deepMerge(defaultState(), parsed);
      } catch (e) {
        console.warn('TPV: error load, reset', e);
        return defaultState();
      }
    },
    save() {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    }
  };

  function deepMerge(base, patch) {
    if (Array.isArray(base)) return Array.isArray(patch) ? patch : base;
    if (typeof base !== 'object' || base === null) return patch ?? base;
    const out = { ...base };
    if (typeof patch !== 'object' || patch === null) return out;
    for (const k of Object.keys(patch)) {
      if (k in base) out[k] = deepMerge(base[k], patch[k]);
      else out[k] = patch[k];
    }
    return out;
  }

  let state = store.load();

  /* =========================
     DOM REFS (PARTE A)
  ========================== */
  const el = {
    // tabs/pages
    tabs: $$('.tab'),
    pages: $$('.page'),

    // topbar
    btnTheme: $('#btnTheme'),
    themeLabel: $('#themeLabel'),
    btnLogin: $('#btnLogin'),
    userLabel: $('#userLabel'),
    btnAdmin: $('#btnAdmin'),

    // POS left
    barcodeInput: $('#barcodeInput'),
    searchInput: $('#searchInput'),
    chips: $$('.chip'),
    favGrid: $('.fav-grid'),

    btnQuickAmount: $('#btnQuickAmount'),
    btnPark: $('#btnPark'),
    btnAddProductInline: $('#btnAddProductInline'),

    // POS right/ticket
    ticketNo: $('#ticketNo'),
    ticketDate: $('#ticketDate'),
    shopName: $('#shopName'),
    shopSub: $('#shopSub'),
    posBox: $('#posBox'),
    posUser: $('#posUser'),

    linesWrap: $('.ticket-lines'),
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

    // Modals
    backdrop: $('#backdrop'),
    modalLogin: $('#modalLogin'),
    modalAdmin: $('#modalAdmin'),
    modalPay: $('#modalPay'),
    modalProduct: $('#modalProduct'),
    modalEmail: $('#modalEmail'),

    // modal close buttons
    closeBtns: $$('[data-close]'),

    // modal inputs/buttons
    loginUser: $('#loginUser'),
    loginPass: $('#loginPass'),
    btnLoginOk: $('#btnLoginOk'),

    adminPin: $('#adminPin'),
    btnAdminOk: $('#btnAdminOk'),

    // pay modal
    payTotal: $('#payTotal'),
    btnPayOk: $('#btnPayOk'),

    // product modal
    btnProductSave: $('#btnProductSave'),

    // email modal
    btnEmailSend: $('#btnEmailSend'),
  };

  /* =========================
     UI CORE (Tabs, Modals, Theme)
  ========================== */
  function setTab(name) {
    el.tabs.forEach(t => {
      const on = t.dataset.tab === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    el.pages.forEach(p => p.classList.toggle('is-active', p.dataset.page === name));
    // En venta, foco al barcode
    if (name === 'venta') focusBarcodeSoon();
  }

  function openModal(dialogEl) {
    if (!dialogEl) return;
    el.backdrop.hidden = false;
    dialogEl.showModal();
    const focusEl = dialogEl.querySelector('input,select,textarea,button');
    if (focusEl) setTimeout(() => focusEl.focus(), 20);
  }

  function closeModal(dialogEl) {
    if (!dialogEl) return;
    dialogEl.close();
    el.backdrop.hidden = true;
    focusBarcodeSoon();
  }

  function focusBarcodeSoon() {
    if (!el.barcodeInput) return;
    setTimeout(() => el.barcodeInput.focus(), 25);
  }

  function setTheme(mode) {
    const isNight = mode === 'night';
    document.body.classList.toggle('theme-day', !isNight);
    document.body.classList.toggle('theme-night', isNight);
    el.themeLabel.textContent = isNight ? 'Noche' : 'Día';
    state.settings.theme = isNight ? 'night' : 'day';
    store.save();
  }

  /* =========================
     CART LOGIC
  ========================== */
  const cart = {
    get active() { return state.carts.active; },
    clear() {
      state.carts.active = { lines: [], noteName: '', payMethod: 'efectivo', given: 0 };
      store.save();
      renderAll();
    },
    addProduct(prod, qty = 1) {
      if (!prod) return;
      const lineKey = prod.id || prod.barcode || prod.name;
      const lines = cart.active.lines;
      const idx = lines.findIndex(l => l.key === lineKey && !l.isManual);
      if (idx >= 0) {
        lines[idx].qty += qty;
      } else {
        lines.push({
          key: lineKey,
          productId: prod.id || null,
          barcode: prod.barcode || '',
          name: prod.name,
          price: Number(prod.price || 0),
          cost: prod.cost == null ? null : Number(prod.cost),
          qty: qty,
          isManual: false,
        });
      }
      store.save();
      renderAll();
      beep();
    },
    addManualAmount(amount, nameOpt = 'Importe') {
      const price = Number(amount || 0);
      if (!(price > 0)) return;
      cart.active.lines.push({
        key: 'M-' + uid(),
        productId: null,
        barcode: '',
        name: nameOpt?.trim() || 'Importe',
        price: price,
        cost: null,
        qty: 1,
        isManual: true,
      });
      store.save();
      renderAll();
      beep();
    },
    removeLine(index) {
      cart.active.lines.splice(index, 1);
      store.save();
      renderAll();
    },
    setQty(index, qty) {
      const q = Math.max(0, Math.floor(Number(qty || 0)));
      if (q <= 0) return cart.removeLine(index);
      cart.active.lines[index].qty = q;
      store.save();
      renderAll();
    },
    incQty(index, delta) {
      const l = cart.active.lines[index];
      if (!l) return;
      cart.setQty(index, (l.qty || 0) + delta);
    },
    totals() {
      const subtotal = cart.active.lines.reduce((sum, l) => sum + (Number(l.price) * Number(l.qty || 0)), 0);
      return { subtotal, total: subtotal }; // IVA incluido en el precio
    },
    park() {
      if (!cart.active.lines.length) return;
      state.carts.parked = JSON.parse(JSON.stringify(cart.active));
      cart.clear();
      audit('PARK_CART', { lines: state.carts.parked.lines.length });
      toast('Carrito aparcado');
    },
    unpark() {
      if (!state.carts.parked) return;
      state.carts.active = state.carts.parked;
      state.carts.parked = null;
      store.save();
      renderAll();
      toast('Carrito recuperado');
    }
  };

  /* =========================
     PRODUCTS (Demo / Search / Fav)
  ========================== */
  function findProductByBarcode(code) {
    const c = String(code || '').trim();
    if (!c) return null;
    return state.products.find(p => String(p.barcode || '').trim() === c) || null;
  }

  function findProductByName(name) {
    const q = String(name || '').trim().toLowerCase();
    if (!q) return [];
    return state.products.filter(p => (p.name || '').toLowerCase().includes(q));
  }

  function getFavProducts(category = 'favoritos', search = '') {
    let items = state.products.slice();
    const q = String(search || '').trim().toLowerCase();
    if (q) items = items.filter(p => (p.name || '').toLowerCase().includes(q) || (p.barcode || '').includes(q));
    if (category === 'favoritos') items = items.filter(p => !!p.fav);
    else items = items.filter(p => (p.category || '').toLowerCase() === category.toLowerCase());
    // orden: favoritos primero, luego nombre
    items.sort((a, b) => (Number(!!b.fav) - Number(!!a.fav)) || (a.name || '').localeCompare(b.name || ''));
    return items;
  }

  /* =========================
     SALES (Save + Ticket)
  ========================== */
  function nextTicketNo() {
    const n = state.counters.ticketSeq || 1;
    state.counters.ticketSeq = n + 1;
    store.save();
    return `T-${String(n).padStart(6, '0')}`;
  }

  function buildReceiptText(sale) {
    // Texto simple para email/mailto (sin adjunto)
    const lines = [];
    lines.push(state.settings.shopName);
    lines.push(state.settings.shopSub);
    lines.push('------------------------------');
    lines.push(`${sale.ticketNo}   ${sale.date}`);
    lines.push(`Caja: ${sale.box}   Cajero: ${sale.user}`);
    lines.push('------------------------------');
    for (const l of sale.lines) {
      const name = l.name;
      const qty = l.qty;
      const p = fmtMoney(l.price);
      const t = fmtMoney(l.price * l.qty);
      // formato compacto 80mm
      lines.push(`${name}`);
      lines.push(`  ${qty} x ${p}  = ${t}`);
    }
    lines.push('------------------------------');
    lines.push(`TOTAL: ${fmtMoney(sale.total)} €`);
    lines.push(`Pago: ${sale.payMethod}`);
    if (sale.payMethod === 'efectivo' || sale.payMethod === 'mixto') {
      if (sale.given != null) lines.push(`Entregado: ${fmtMoney(sale.given)} €`);
      if (sale.change != null) lines.push(`Cambio: ${fmtMoney(sale.change)} €`);
    }
    if (sale.noteName) lines.push(`Nota: ${sale.noteName}`);
    lines.push('------------------------------');
    lines.push(state.settings.footerText || 'Gracias por su compra');
    lines.push('IVA incluido en los precios');
    return lines.join('\n');
  }

  function saveSale({ payMethod, given, cardAmount, cashAmount, noteName }) {
    const { total } = cart.totals();
    if (!(total > 0)) return null;

    const ticketNo = nextTicketNo();
    const date = nowEs();

    const sale = {
      id: uid(),
      ticketNo,
      date,
      box: state.settings.boxName || 'CAJA-1',
      user: state.session.user?.name || 'CAJERO',
      payMethod: payMethod || cart.active.payMethod || 'efectivo',
      given: given ?? null,
      change: null,
      noteName: (noteName ?? '').trim(),
      lines: cart.active.lines.map(l => ({
        name: l.name,
        barcode: l.barcode || '',
        qty: Number(l.qty || 0),
        price: Number(l.price || 0),
        cost: l.cost == null ? null : Number(l.cost),
        isManual: !!l.isManual,
      })),
      subtotal: total,
      total: total,
      // Mixto (por ahora guardamos)
      split: (payMethod === 'mixto') ? { cash: Number(cashAmount || 0), card: Number(cardAmount || 0) } : null,
    };

    // Cambio (si aplica)
    if (sale.payMethod === 'efectivo') {
      const g = Number(given || 0);
      sale.change = Math.max(0, g - sale.total);
    } else if (sale.payMethod === 'mixto') {
      const cash = Number(cashAmount || 0);
      sale.change = Math.max(0, cash - Math.max(0, sale.total - Number(cardAmount || 0)));
    }

    state.sales.push(sale);
    audit('SALE_CREATE', { ticketNo: sale.ticketNo, total: sale.total, payMethod: sale.payMethod });
    store.save();
    return sale;
  }

  /* =========================
     ADMIN LOCK (Local)
  ========================== */
  function isAdminUnlocked() {
    return (state.session.adminUnlockedUntil || 0) > Date.now();
  }

  function unlockAdminTemporarily() {
    // En Parte C validaremos PIN real (hash). Por ahora, desbloquea 5 minutos si PIN no está configurado,
    // o exige 4 dígitos cualquiera si hay hash (simple placeholder)
    state.session.adminUnlockedUntil = Date.now() + 5 * 60 * 1000;
    store.save();
    audit('ADMIN_UNLOCK', { until: state.session.adminUnlockedUntil });
  }

  /* =========================
     AUDIT + TOAST
  ========================== */
  function audit(type, data = {}) {
    state.audit.push({
      ts: Date.now(),
      at: nowEs(),
      user: state.session.user?.name || 'CAJERO',
      type,
      data
    });
    // limitar tamaño
    if (state.audit.length > 2000) state.audit.splice(0, state.audit.length - 2000);
    store.save();
  }

  let toastTimer = null;
  function toast(msg) {
    // toast mini sin HTML adicional (crea y destruye)
    try {
      const t = document.createElement('div');
      t.style.position = 'fixed';
      t.style.left = '14px';
      t.style.bottom = '14px';
      t.style.zIndex = '9999';
      t.style.padding = '10px 12px';
      t.style.borderRadius = '12px';
      t.style.border = '1px solid var(--line)';
      t.style.background = 'color-mix(in srgb, var(--panel) 92%, transparent)';
      t.style.boxShadow = 'var(--shadow)';
      t.style.fontWeight = '900';
      t.textContent = msg;
      document.body.appendChild(t);
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.remove(), 1300);
    } catch (_) {}
  }

  /* =========================
     RENDER
  ========================== */
  function renderHeader() {
    // Theme
    setTheme(state.settings.theme || 'day');

    // User
    if (el.userLabel) el.userLabel.textContent = state.session.user?.name || 'Cajero';

    // Ticket header
    if (el.ticketDate) el.ticketDate.textContent = nowEs();
    if (el.shopName) el.shopName.textContent = state.settings.shopName || 'Tu Tienda';
    if (el.shopSub) el.shopSub.textContent = state.settings.shopSub || 'CIF / Dirección / Tel';
    if (el.posBox) el.posBox.textContent = state.settings.boxName || 'CAJA-1';
    if (el.posUser) el.posUser.textContent = state.session.user?.name || 'CAJERO';

    // Ticket number display (actual se asigna al cobrar; mientras mostramos seq actual)
    const seq = state.counters.ticketSeq || 1;
    if (el.ticketNo) el.ticketNo.textContent = `T-${String(seq).padStart(6, '0')}`;
  }

  function renderFavorites() {
    if (!el.favGrid) return;
    // chip activo
    const activeChip = el.chips.find(c => c.classList.contains('is-active'));
    const cat = activeChip ? activeChip.dataset.cat : 'favoritos';
    const q = el.searchInput ? el.searchInput.value : '';
    const items = getFavProducts(cat, q).slice(0, 24);

    el.favGrid.innerHTML = '';
    for (const p of items) {
      const btn = document.createElement('button');
      btn.className = 'fav';
      btn.type = 'button';
      btn.innerHTML = `
        <div class="fav-name">${escapeHtml(p.name)}</div>
        <div class="fav-price">${p.barcode ? fmtMoneyEUR(p.price) : 'Manual'}</div>
      `;
      btn.addEventListener('click', () => {
        if (!p.barcode && p.name.toLowerCase() === 'importe') {
          openModal(el.modalPay);
          return;
        }
        cart.addProduct(p, 1);
      });
      el.favGrid.appendChild(btn);
    }

    // Siempre añade accesos rápidos al final (importe / bolsa) si no salen por filtro
    const ensureQuick = (name, onClick, sub) => {
      const exists = Array.from(el.favGrid.children).some(x => x.querySelector('.fav-name')?.textContent === name);
      if (exists) return;
      const btn = document.createElement('button');
      btn.className = 'fav';
      btn.type = 'button';
      btn.innerHTML = `<div class="fav-name">${escapeHtml(name)}</div><div class="fav-price">${escapeHtml(sub)}</div>`;
      btn.addEventListener('click', onClick);
      el.favGrid.appendChild(btn);
    };
    ensureQuick('Importe', () => openModal(el.modalPay), 'Manual');
  }

  function renderLines() {
    if (!el.linesWrap) return;

    // Mantener cabecera (thead) y renderizar el resto
    const thead = el.linesWrap.querySelector('.trow.thead');
    el.linesWrap.innerHTML = '';
    if (thead) el.linesWrap.appendChild(thead);

    const lines = cart.active.lines;
    lines.forEach((l, idx) => {
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
            <input class="qty-in" value="${escapeAttr(l.qty)}" inputmode="numeric" />
            <button class="qty-btn" type="button" aria-label="más">+</button>
          </div>
        </div>
        <div class="tcell tcell-right mono">${fmtMoney(l.price)}</div>
        <div class="tcell tcell-right mono">${fmtMoney(l.price * l.qty)}</div>
      `;

      const [btnMinus, qtyIn, btnPlus] = row.querySelectorAll('.qty-btn, .qty-in');
      btnMinus.addEventListener('click', () => cart.incQty(idx, -1));
      btnPlus.addEventListener('click', () => cart.incQty(idx, +1));

      qtyIn.addEventListener('change', () => cart.setQty(idx, qtyIn.value));
      qtyIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          qtyIn.blur();
          focusBarcodeSoon();
        }
      });

      // Click derecho para borrar línea rápido
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        cart.removeLine(idx);
      });

      el.linesWrap.appendChild(row);
    });
  }

  function renderTotals() {
    const { total } = cart.totals();
    if (el.subTotal) el.subTotal.textContent = fmtMoneyEUR(total);
    if (el.grandTotal) el.grandTotal.textContent = fmtMoneyEUR(total);

    // Reflect note name
    if (el.noteName && cart.active.noteName !== el.noteName.value) {
      // no sobreescribir si usuario está escribiendo
    }

    // Cambio en pantalla principal
    const method = cart.active.payMethod || 'efectivo';
    const given = parseMoney(el.givenInput?.value ?? cart.active.given);
    const change = method === 'efectivo'
      ? Math.max(0, given - total)
      : 0;

    if (el.changeInput) el.changeInput.value = fmtMoney(change);
  }

  function renderAll() {
    renderHeader();
    renderFavorites();
    renderLines();
    renderTotals();
  }

  function escapeHtml(s) {
    return (s ?? '').toString()
      .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
      .replaceAll('"','&quot;').replaceAll("'","&#039;");
  }
  function escapeAttr(s) {
    return escapeHtml(String(s ?? ''));
  }

  /* =========================
     EVENTS / BINDINGS
  ========================== */
  function bindTabs() {
    el.tabs.forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));
  }

  function bindTheme() {
    if (!el.btnTheme) return;
    el.btnTheme.addEventListener('click', () => {
      const isDay = document.body.classList.contains('theme-day');
      setTheme(isDay ? 'night' : 'day');
    });
  }

  function bindModals() {
    if (el.backdrop) {
      el.backdrop.addEventListener('click', () => {
        const open = document.querySelector('dialog[open]');
        if (open) closeModal(open);
      });
    }

    el.closeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.close;
        const d = document.getElementById(id);
        closeModal(d);
      });
    });

    // top buttons
    if (el.btnLogin) el.btnLogin.addEventListener('click', () => openModal(el.modalLogin));
    if (el.btnAdmin) el.btnAdmin.addEventListener('click', () => openModal(el.modalAdmin));
    const btnAdminUnlock = $('#btnAdminUnlock');
    if (btnAdminUnlock) btnAdminUnlock.addEventListener('click', () => openModal(el.modalAdmin));

    // open pay
    if (el.btnPay) el.btnPay.addEventListener('click', () => openPayModal());
    if (el.btnQuickAmount) el.btnQuickAmount.addEventListener('click', () => openPayModal());

    // add product modal (Parte C gestionará el guardado real)
    if (el.btnAddProductInline) el.btnAddProductInline.addEventListener('click', () => openModal(el.modalProduct));
    const btnAddProduct = $('#btnAddProduct');
    if (btnAddProduct) btnAddProduct.addEventListener('click', () => openModal(el.modalProduct));

    // email modal
    if (el.btnEmailTicket) el.btnEmailTicket.addEventListener('click', () => openModal(el.modalEmail));

    // print
    if (el.btnPrint) el.btnPrint.addEventListener('click', () => window.print());

    // login OK (placeholder local)
    if (el.btnLoginOk) {
      el.btnLoginOk.addEventListener('click', () => {
        const u = (el.loginUser?.value || '').trim() || 'CAJERO';
        // Parte C: validación password hash
        state.session.user = { name: u.toUpperCase(), role: 'cashier' };
        audit('LOGIN', { user: state.session.user.name });
        store.save();
        closeModal(el.modalLogin);
        renderAll();
        toast('Sesión iniciada');
      });
    }

    // admin OK (placeholder)
    if (el.btnAdminOk) {
      el.btnAdminOk.addEventListener('click', () => {
        // Parte C: comparar PIN real
        const pin = (el.adminPin?.value || '').trim();
        if (pin.length < 4) {
          toast('PIN inválido');
          return;
        }
        unlockAdminTemporarily();
        closeModal(el.modalAdmin);
        toast('Admin desbloqueado (5 min)');
      });
    }

    // pay OK: confirmar venta
    if (el.btnPayOk) {
      el.btnPayOk.addEventListener('click', () => {
        confirmSaleFromModal();
      });
    }

    // product save (placeholder -> Parte C)
    if (el.btnProductSave) {
      el.btnProductSave.addEventListener('click', () => {
        toast('Guardado de producto: Parte C');
        closeModal(el.modalProduct);
      });
    }

    // email send (mailto)
    if (el.btnEmailSend) {
      el.btnEmailSend.addEventListener('click', () => {
        const emailInput = el.modalEmail?.querySelector('input[type="email"]');
        const msgArea = el.modalEmail?.querySelector('textarea');
        const to = (emailInput?.value || '').trim();
        const extra = (msgArea?.value || '').trim();

        const last = state.sales[state.sales.length - 1];
        const subject = last ? `Ticket ${last.ticketNo} - ${state.settings.shopName}` : `Ticket - ${state.settings.shopName}`;
        const body = (last ? buildReceiptText(last) : 'No hay ticket generado aún.\n') + (extra ? `\n\n${extra}` : '');

        // mailto (si no hay to, abre composer vacío)
        const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        window.location.href = url;
        closeModal(el.modalEmail);
      });
    }
  }

  function bindPOSInputs() {
    // Barcode: Enter -> buscar producto por barcode y añadir
    if (el.barcodeInput) {
      el.barcodeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const code = (el.barcodeInput.value || '').trim();
          el.barcodeInput.value = '';
          if (!code) return;

          const p = findProductByBarcode(code);
          if (p) {
            cart.addProduct(p, 1);
          } else {
            // no encontrado -> abrir alta producto con barcode precargado (Parte C guardará)
            openModal(el.modalProduct);
            const barcodeField = el.modalProduct?.querySelector('input[inputmode="numeric"]');
            if (barcodeField) barcodeField.value = code;
            toast('Barcode no encontrado: alta producto');
          }
        }
      });
    }

    // Search: filtra favoritos
    if (el.searchInput) {
      el.searchInput.addEventListener('input', () => renderFavorites());
    }

    // Chips categoría
    el.chips.forEach(c => c.addEventListener('click', () => {
      el.chips.forEach(x => x.classList.remove('is-active'));
      c.classList.add('is-active');
      renderFavorites();
    }));

    // Pay tabs (pantalla principal)
    el.payTabs.forEach(p => p.addEventListener('click', () => {
      el.payTabs.forEach(x => x.classList.remove('is-active'));
      p.classList.add('is-active');
      cart.active.payMethod = p.dataset.pay || 'efectivo';
      store.save();
      renderTotals();
      focusBarcodeSoon();
    }));

    // Given input -> change calc
    if (el.givenInput) {
      el.givenInput.addEventListener('input', () => {
        cart.active.given = parseMoney(el.givenInput.value);
        store.save();
        renderTotals();
      });
    }

    // Note name
    if (el.noteName) {
      el.noteName.addEventListener('input', () => {
        cart.active.noteName = el.noteName.value || '';
        store.save();
      });
    }

    // Void / Refund / Park / Last
    if (el.btnVoid) {
      el.btnVoid.addEventListener('click', () => {
        if (!cart.active.lines.length) return;
        cart.clear();
        audit('CART_VOID', {});
        toast('Ticket limpiado');
      });
    }

    if (el.btnRefund) {
      el.btnRefund.addEventListener('click', () => {
        if (!isAdminUnlocked()) {
          openModal(el.modalAdmin);
          toast('PIN admin requerido');
          return;
        }
        // Parte B: refund simple (marcar último ticket como devuelto) -> Parte C lo hará robusto
        const last = state.sales[state.sales.length - 1];
        if (!last) {
          toast('No hay venta para devolver');
          return;
        }
        // Creamos una venta negativa de devolución (simple)
        const refund = {
          ...last,
          id: uid(),
          ticketNo: nextTicketNo(),
          date: nowEs(),
          payMethod: 'devolucion',
          lines: last.lines.map(l => ({ ...l, qty: -Math.abs(l.qty) })),
          subtotal: -Math.abs(last.total),
          total: -Math.abs(last.total),
          noteName: `DEVOLUCIÓN de ${last.ticketNo}`,
        };
        state.sales.push(refund);
        audit('SALE_REFUND', { from: last.ticketNo, refund: refund.ticketNo, total: refund.total });
        store.save();
        toast('Devolución registrada (demo)');
      });
    }

    if (el.btnPark) {
      el.btnPark.addEventListener('click', () => {
        if (state.carts.parked) {
          cart.unpark();
        } else {
          cart.park();
        }
      });
    }

    if (el.btnLastTicket) {
      el.btnLastTicket.addEventListener('click', () => {
        const last = state.sales[state.sales.length - 1];
        if (!last) return toast('No hay ticket');
        // Mostrar modal email para reenvío rápido (o imprimir)
        toast(`Último: ${last.ticketNo}`);
      });
    }
  }

  /* =========================
     PAY MODAL FLOW
  ========================== */
  function openPayModal() {
    const { total } = cart.totals();
    if (!(total > 0)) {
      // Si no hay líneas -> pedir importe manual rápido
      const amt = prompt('Importe rápido (€):', '');
      if (amt == null) return;
      const val = parseMoney(amt);
      if (!(val > 0)) return toast('Importe inválido');
      const name = prompt('Nombre (opcional):', 'Importe') ?? 'Importe';
      cart.addManualAmount(val, name);
      return;
    }

    // Sincroniza total y método
    if (el.payTotal) el.payTotal.textContent = fmtMoneyEUR(total);

    openModal(el.modalPay);
  }

  function confirmSaleFromModal() {
    // Lectura de modal (modo simple)
    const modal = el.modalPay;
    if (!modal) return;

    const total = cart.totals().total;

    const methodSel = modal.querySelector('select');
    const method = methodSel ? (methodSel.value || '').toLowerCase() : (cart.active.payMethod || 'efectivo');

    const givenIn = modal.querySelector('input[inputmode="decimal"]');
    const given = parseMoney(givenIn?.value || '0');

    const noteIn = modal.querySelector('input[placeholder*="mesa"]');
    const note = (noteIn?.value || cart.active.noteName || '').trim();

    // Validación
    if (method === 'efectivo' && given < total) {
      // Permitimos igualmente (por si el usuario quiere), pero avisamos
      if (!confirm('Entregado menor que total. ¿Confirmar igualmente?')) return;
    }

    const sale = saveSale({
      payMethod: normalizePayMethod(method),
      given,
      noteName: note
    });

    if (!sale) {
      toast('No hay total');
      return;
    }

    // Actualiza UI ticket number visible a venta confirmada
    if (el.ticketNo) el.ticketNo.textContent = sale.ticketNo;

    // Auto imprimir opcional (por ahora no)
    closeModal(el.modalPay);

    // Limpiar carrito tras venta
    cart.clear();
    toast(`Venta OK · ${sale.ticketNo}`);

    // Imprime si el usuario quiere (rápido)
    // (si prefieres imprimir siempre, lo activamos en Ajustes en Parte C)
    if (confirm('¿Imprimir ticket?')) window.print();
  }

  function normalizePayMethod(methodText) {
    const m = String(methodText || '').toLowerCase();
    if (m.includes('tarj')) return 'tarjeta';
    if (m.includes('mix')) return 'mixto';
    if (m.includes('devol')) return 'devolucion';
    return 'efectivo';
  }

  /* =========================
     KEYBOARD SHORTCUTS
  ========================== */
  function bindShortcuts() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      const typing = (tag === 'input' || tag === 'textarea' || tag === 'select');

      // F4: cobrar
      if (e.key === 'F4') {
        e.preventDefault();
        openPayModal();
        return;
      }

      // Esc: limpiar (si no está en modal)
      if (e.key === 'Escape') {
        const open = document.querySelector('dialog[open]');
        if (open) {
          e.preventDefault();
          closeModal(open);
          return;
        }
        if (!typing && cart.active.lines.length) {
          if (confirm('¿Limpiar ticket actual?')) cart.clear();
        }
        return;
      }

      // Supr: borrar última línea
      if ((e.key === 'Delete' || e.key === 'Supr') && !typing) {
        if (!cart.active.lines.length) return;
        e.preventDefault();
        cart.removeLine(cart.active.lines.length - 1);
        return;
      }

      // + / -: cantidad de última línea
      if (!typing && (e.key === '+' || e.key === '=')) {
        if (!cart.active.lines.length) return;
        e.preventDefault();
        cart.incQty(cart.active.lines.length - 1, +1);
        return;
      }
      if (!typing && (e.key === '-' || e.key === '_')) {
        if (!cart.active.lines.length) return;
        e.preventDefault();
        cart.incQty(cart.active.lines.length - 1, -1);
        return;
      }

      // Enter fuera de inputs: foco barcode
      if (e.key === 'Enter' && !typing) {
        focusBarcodeSoon();
      }
    });
  }

  /* =========================
     INIT
  ========================== */
  function init() {
    // Aplicar theme
    setTheme(state.settings.theme || 'day');

    // Render base
    renderAll();

    // Bindings
    bindTabs();
    bindTheme();
    bindModals();
    bindPOSInputs();
    bindShortcuts();

    // Default tab Venta
    setTab('venta');
    focusBarcodeSoon();

    // Tick de hora/fecha en ticket
    setInterval(() => {
      if (el.ticketDate) el.ticketDate.textContent = nowEs();
    }, 15000);
  }

  init();

})();

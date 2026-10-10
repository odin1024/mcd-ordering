'use strict';
/* 麦门点单 —— 前端逻辑（零依赖原生 JS，双模式：演示/真实） */

(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const fmt = (fen) => '¥' + (fen / 100).toFixed(2);

  const state = {
    mock: true,
    stores: [],
    store: null,
    menu: [],
    cat: 0,
    cart: [],           // {productCode,name,image,price,quantity,rounds:[{roundName,choiceNames}]}
    takeWay: 'eat-in',
    current: 'stores',  // stores | menu | checkout | result
  };

  const el = {
    modeStrip: $('#modeStrip'), modeText: $('#modeText'), footMode: $('#footMode'),
    steps: $$('#steps .step'),
    panelStores: $('#panelStores'), panelMenu: $('#panelMenu'),
    panelCheckout: $('#panelCheckout'), panelResult: $('#panelResult'),
    storeGrid: $('#storeGrid'), btnRefreshStores: $('#btnRefreshStores'), storeNote: $('#storeNote'),
    catList: $('#catList'), mealGrid: $('#mealGrid'),
    menuStoreName: $('#menuStoreName'), btnChangeStore: $('#btnChangeStore'),
    mealModal: $('#mealModal'), mealModalMask: $('#mealModalMask'), mealModalBody: $('#mealModalBody'), btnCloseModal: $('#btnCloseModal'),
    cartBar: $('#cartBar'), cartBadge: $('#cartBadge'), cartTotalText: $('#cartTotalText'), cartCountText: $('#cartCountText'), btnCartGo: $('#btnCartGo'), cartInfo: $('#cartInfo'),
    drawer: $('#orderDrawer'), drawerMask: $('#orderDrawerMask'), orderListBox: $('#orderListBox'), btnCloseDrawer: $('#btnCloseDrawer'), btnOrderList: $('#btnOrderList'),
    takeWayRow: $('#takeWayRow'), orderItems: $('#orderItems'),
    sumSubtotal: $('#sumSubtotal'), sumDiscount: $('#sumDiscount'), sumTotal: $('#sumTotal'),
    btnPlaceOrder: $('#btnPlaceOrder'), orderTip: $('#orderTip'), btnBackMenu: $('#btnBackMenu'),
    resultIcon: $('#resultIcon'), resultTitle: $('#resultTitle'), resultSub: $('#resultSub'),
    rOrderId: $('#rOrderId'), rStore: $('#rStore'), rTakeWay: $('#rTakeWay'), rAmount: $('#rAmount'), rTime: $('#rTime'),
    btnAgain: $('#btnAgain'),
  };

  /* ============ 工具 ============ */
  async function api(path, opts) {
    const res = await fetch(path, opts);
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.ok === false) throw new Error(j.message || '请求失败');
    return j;
  }
  function show(elx) { elx.classList.remove('hidden'); }
  function hide(elx) { elx.classList.add('hidden'); }
  function setStep(n) {
    el.steps.forEach((s, i) => {
      s.classList.toggle('active', i === n - 1);
      s.classList.toggle('done', i < n - 1);
    });
  }
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2200);
  }

  /* ============ 初始化 ============ */
  async function init() {
    // mock 模式：直出数据已内联，零网络等待，首屏秒开
    if (window.__MCD_INITIAL__) {
      state.mock = !!window.__MCD_INITIAL__.mock;
      applyMode(!state.mock);
      await loadStores();
      // 支持 ?view=menu 直达菜单页（利于分享与直达体验）
      if (new URLSearchParams(location.search).get('view') === 'menu' && state.stores.length) {
        selectStore(state.stores[0].storeCode);
      }
      return;
    }
    try {
      const h = await api('/api/health');
      state.mock = h.mock;
      applyMode(!h.mock);
    } catch (e) {
      el.modeStrip.classList.add('demo');
      el.modeText.textContent = '离线';
    }
    await loadStores();
  }
  function applyMode(real) {
    el.modeStrip.classList.toggle('real', real);
    el.modeStrip.classList.toggle('demo', !real);
    el.modeText.textContent = real ? '真实模式 · 官方 MCP' : '演示模式 · Mock 数据';
    el.footMode.textContent = real ? '真实模式：直连麦当劳官方 MCP' : '演示模式：内置模拟数据（配置 MCD_MCP_TOKEN 即切换真实）';
    el.orderTip.textContent = real ? '将调用麦当劳官方接口创建真实订单' : '演示模式：将生成模拟订单，不会真实扣款';
  }

  /* ============ 门店 ============ */
  async function loadStores() {
    // mock 首屏直出数据优先
    if (window.__MCD_INITIAL__ && window.__MCD_INITIAL__.stores && state.mock) {
      state.stores = window.__MCD_INITIAL__.stores;
      renderStores();
      return;
    }
    el.storeGrid.innerHTML = '<div class="loading card-loading">正在获取附近门店…</div>';
    try {
      const j = await api('/api/stores');
      state.stores = j.stores || [];
      renderStores();
    } catch (e) {
      el.storeGrid.innerHTML = `<div class="loading card-loading">门店获取失败：${e.message}</div>`;
    }
  }
  function renderStores() {
    if (!state.stores.length) { el.storeGrid.innerHTML = '<div class="loading card-loading">暂无门店，试试刷新</div>'; return; }
    el.storeNote.textContent = state.mock
      ? '演示数据 · 以下为固定示例门店（配置 MCD_MCP_TOKEN 后按账号获取真实附近/收藏门店）'
      : '按麦当劳官方接口获取的附近 / 收藏门店，随账号与位置实时变化';
    el.storeGrid.innerHTML = state.stores.map((s) => `
      <div class="store-card ${state.store && state.store.storeCode === s.storeCode ? 'selected' : ''}" data-code="${s.storeCode}">
        <div class="s-name">${s.storeName}</div>
        <div class="s-addr">📍 ${s.address}${s.distance ? ' · 距你 ' + (s.distance > 0 ? s.distance + 'm' : '') : ''}</div>
        <div class="s-meta">
          <span class="tag">到店自取</span>
          ${s.reservation ? '<span class="tag">支持预约</span>' : '<span class="tag gray">暂不支持预约</span>'}
        </div>
        <span class="s-go">›</span>
      </div>`).join('');
    $$('#storeGrid .store-card').forEach((c) => {
      c.addEventListener('click', () => selectStore(c.dataset.code));
    });
  }
  async function selectStore(code) {
    const s = state.stores.find((x) => x.storeCode === code);
    if (!s) return;
    state.store = s;
    state.cat = 0;
    renderStores();
    el.menuStoreName.textContent = s.storeName;
    goMenu();
  }

  /* ============ 菜单 ============ */
  async function goMenu() {
    state.current = 'menu';
    hide(el.panelStores); show(el.panelMenu); hide(el.panelCheckout); hide(el.panelResult);
    setStep(2);
    // mock 首屏直出数据优先
    if (window.__MCD_INITIAL__ && window.__MCD_INITIAL__.menu && state.mock) {
      state.menu = window.__MCD_INITIAL__.menu;
      renderCat();
      renderMeals();
      return;
    }
    el.mealGrid.innerHTML = '<div class="loading card-loading">正在加载真实菜单…</div>';
    try {
      const j = await api('/api/menu?storeCode=' + encodeURIComponent(state.store.storeCode));
      state.menu = j.categories || [];
      renderCat();
      renderMeals();
    } catch (e) {
      el.mealGrid.innerHTML = `<div class="loading card-loading">菜单加载失败：${e.message}</div>`;
    }
  }
  function renderCat() {
    el.catList.innerHTML = state.menu.map((c, i) =>
      `<div class="cat-item ${i === state.cat ? 'active' : ''}" data-i="${i}">${c.name}</div>`).join('');
    $$('#catList .cat-item').forEach((c) => c.addEventListener('click', () => {
      state.cat = +c.dataset.i;
      renderCat(); renderMeals();
    }));
  }
  function renderMeals() {
    const cat = state.menu[state.cat];
    if (!cat) { el.mealGrid.innerHTML = '<div class="loading card-loading">暂无餐品</div>'; return; }
    el.mealGrid.innerHTML = (cat.meals || []).map((m) => `
      <div class="meal-card" data-code="${m.code}">
        ${m.image ? `<img class="m-img" src="${m.image}" alt="${m.name || ''}" loading="lazy" onerror="this.style.opacity=0">` : '<div class="m-img"></div>'}
        <div class="m-body">
          <div class="m-name">${m.name || '加载中…'}</div>
          ${m.tags && m.tags.length ? `<div class="m-tags">${m.tags.map((t) => `<span class="m-tag">${t}</span>`).join('')}</div>` : ''}
          <div class="m-foot">
            ${m.price ? `<span class="m-price">${fmt(m.price)}</span>` : '<span class="m-load">点击查看</span>'}
            <button class="add-btn" data-code="${m.code}">+</button>
          </div>
        </div>
      </div>`).join('');
    $$('#mealGrid .meal-card').forEach((c) => c.addEventListener('click', (e) => {
      if (e.target.classList.contains('add-btn')) { openMeal(c.dataset.code, true); return; }
      openMeal(c.dataset.code, false);
    }));
    $$('#mealGrid .add-btn').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      openMeal(b.dataset.code, true);
    }));
  }

  /* ============ 餐品详情弹层 ============ */
  let curMeal = null;
  async function openMeal(code, quickAdd) {
    show(el.mealModalMask); show(el.mealModal);
    el.mealModalBody.innerHTML = '<div class="loading">加载餐品详情…</div>';
    try {
      const j = await api('/api/meal?storeCode=' + encodeURIComponent(state.store.storeCode) + '&code=' + encodeURIComponent(code));
      curMeal = j.detail;
      renderMealModal(quickAdd);
    } catch (e) {
      el.mealModalBody.innerHTML = `<div class="loading">加载失败：${e.message}</div>`;
    }
  }
  function renderMealModal(quickAdd) {
    const d = curMeal;
    const sel = {}; // roundId -> choiceCode
    (d.rounds || []).forEach((r) => {
      const def = (r.choices || []).find((c) => c.isDefault === 1) || (r.choices || [])[0];
      if (def) sel[r.id] = def.code;
    });
    el.mealModalBody.innerHTML = `
      <div class="mdl-hero">
        ${d.image ? `<img class="mdl-img" src="${d.image}" alt="" onerror="this.style.opacity=0">` : '<div class="mdl-img"></div>'}
        <div class="mdl-info">
          <div class="mdl-name">${d.name || '加载中…'}</div>
          <div class="mdl-desc">${d.desc || '麦当劳官方 MCP 实时餐品数据'}</div>
          <div class="mdl-price" id="mdlPrice"><small>价格计算中…</small></div>
        </div>
      </div>
      ${(d.rounds || []).map((r) => `
        <div class="rounds">
          <div class="round" data-r="${r.id}">
            <h4>${r.name}</h4>
            <div class="r-sub">${r.minQuantity === r.maxQuantity ? '必选' : '可选'} · 最多 ${r.maxQuantity > 0 ? r.maxQuantity : '不限'} 项</div>
            ${(r.choices || []).map((c) => `
              <div class="choice ${sel[r.id] === c.code ? 'selected' : ''}" data-c="${c.code}">
                <span>${c.name}</span>
                <span class="diff">${c.diffPrice && c.diffPrice !== '+ ¥0' ? c.diffPrice : ''}</span>
              </div>`).join('')}
          </div>
        </div>`).join('')}
      <div class="mdl-footer">
        <div class="qty-stepper">
          <button id="qMinus">−</button><b id="qty">1</b><button id="qPlus">+</button>
        </div>
        <button class="primary-btn" id="btnAddCart">加入购物车</button>
      </div>`;
    // 选配点击
    $$('#mealModalBody .choice').forEach((ch) => ch.addEventListener('click', () => {
      const roundId = +ch.closest('.round').dataset.r;
      const code = ch.dataset.c;
      const r = d.rounds.find((x) => x.id === roundId);
      // 单选逻辑：同轮次互斥；多选（maxQuantity>1）：允许叠加
      const maxQ = r.maxQuantity > 0 ? r.maxQuantity : 1;
      if (maxQ === 1) {
        sel[roundId] = code;
        $$(`#mealModalBody .round[data-r="${roundId}"] .choice`).forEach((x) => x.classList.remove('selected'));
        ch.classList.add('selected');
      } else {
        ch.classList.toggle('selected');
      }
    }));
    $('#qMinus').addEventListener('click', () => { const q = +$('#qty').textContent; $('#qty').textContent = Math.max(1, q - 1); refreshPrice(); });
    $('#qPlus').addEventListener('click', () => { $('#qty').textContent = +$('#qty').textContent + 1; refreshPrice(); });
    $('#btnAddCart').addEventListener('click', () => addToCart());
    refreshPrice();
  }
  async function refreshPrice() {
    if (!curMeal) return;
    const q = +$('#qty').textContent;
    const base = curMeal.price || 0;
    if (base > 0) { $('#mdlPrice').innerHTML = `${fmt(base * q)}<small> ×${q}</small>`; return; }
    try {
      const j = await api('/api/price', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeCode: state.store.storeCode, items: [{ productCode: curMeal.code, quantity: q }] }) });
      curMeal.price = j.price.total / q;
      $('#mdlPrice').innerHTML = `${fmt(j.price.total)}<small> ×${q}</small>`;
    } catch { $('#mdlPrice').textContent = '计价失败'; }
  }
  function collectSelection() {
    const sel = {};
    $$('#mealModalBody .round').forEach((rEl) => {
      const rid = +rEl.dataset.r;
      const chosen = $$(`.choice.selected`, rEl).map((c) => c.dataset.c);
      if (chosen.length) sel[rid] = chosen;
    });
    return { quantity: +$('#qty').textContent, sel };
  }
  async function addToCart() {
    const { quantity, sel } = collectSelection();
    const d = curMeal;
    let price = d.price || 0;
    if (!price) {
      try {
        const j = await api('/api/price', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeCode: state.store.storeCode, items: [{ productCode: d.code, quantity: 1 }] }) });
        price = j.price.total;
      } catch { price = 0; }
    }
    const roundNames = (d.rounds || []).map((r) => {
      const chosen = sel[r.id] || [];
      const names = (r.choices || []).filter((c) => chosen.includes(c.code)).map((c) => c.name);
      return names.length ? `${r.name}: ${names.join('/')}` : '';
    }).filter(Boolean);
    const exist = state.cart.find((it) => it.productCode === d.code && JSON.stringify(it.rounds || []) === JSON.stringify(roundNames));
    if (exist) { exist.quantity += quantity; }
    else {
      state.cart.push({
        productCode: d.code, name: d.name || d.code, image: d.image || '', price,
        quantity, rounds: roundNames,
      });
    }
    closeMeal();
    renderCartBar();
    toast('已加入购物车 🍔');
  }

  /* ============ 购物车 ============ */
  function cartTotal() { return state.cart.reduce((s, it) => s + it.price * it.quantity, 0); }
  function cartCount() { return state.cart.reduce((s, it) => s + it.quantity, 0); }
  function renderCartBar() {
    const n = cartCount(), t = cartTotal();
    el.cartBadge.textContent = n;
    el.cartTotalText.textContent = fmt(t);
    el.cartCountText.textContent = n ? `共 ${n} 件 · 点击查看` : '购物车是空的';
    el.btnCartGo.disabled = !n;
    el.btnCartGo.textContent = n ? '去结算' : '去结算';
  }
  function openCartDrawer() {
    show(el.drawerMask); show(el.drawer);
    el.orderListBox.innerHTML = state.cart.length
      ? state.cart.map((it, i) => `
        <div class="cart-item">
          ${it.image ? `<img src="${it.image}" onerror="this.style.opacity=0">` : '<div class="m-img" style="width:52px;height:52px"></div>'}
          <div class="ci-info">
            <div class="ci-name">${it.name}</div>
            <div class="ci-meta">${it.rounds.join(' · ')}</div>
          </div>
          <div class="ci-price">${fmt(it.price)}</div>
          <div class="ci-ops">
            <button data-act="minus" data-i="${i}">−</button>
            <span style="min-width:20px;text-align:center;font-weight:700">${it.quantity}</span>
            <button data-act="plus" data-i="${i}">+</button>
            <button class="del" data-act="del" data-i="${i}">🗑</button>
          </div>
        </div>`).join('')
      : '<div class="loading">购物车是空的</div>';
    $$('#orderListBox .ci-ops button').forEach((b) => b.addEventListener('click', () => {
      const i = +b.dataset.i, act = b.dataset.act;
      if (act === 'plus') state.cart[i].quantity++;
      else if (act === 'minus') { state.cart[i].quantity--; if (state.cart[i].quantity <= 0) state.cart.splice(i, 1); }
      else if (act === 'del') state.cart.splice(i, 1);
      openCartDrawer(); renderCartBar();
    }));
    const t = cartTotal();
    const totalEl = el.orderListBox.parentElement.querySelector('.drawer-total');
    if (totalEl) totalEl.querySelector('b').textContent = fmt(t);
  }
  function closeCartDrawer() { hide(el.drawerMask); hide(el.drawer); }

  /* ============ 结算 ============ */
  function goCheckout() {
    if (!state.cart.length) { toast('购物车是空的'); return; }
    state.current = 'checkout';
    hide(el.panelMenu); show(el.panelCheckout); hide(el.panelResult);
    setStep(3);
    renderCheckout();
  }
  async function renderCheckout() {
    el.takeWayRow.innerHTML = `
      <div class="takeway ${state.takeWay === 'eat-in' ? 'selected' : ''}" data-w="eat-in"><b>🍽 堂食</b><span>店内用餐</span></div>
      <div class="takeway ${state.takeWay === 'take-in-store' ? 'selected' : ''}" data-w="take-in-store"><b>🥡 外带</b><span>店内自提</span></div>`;
    $$('#takeWayRow .takeway').forEach((t) => t.addEventListener('click', () => {
      state.takeWay = t.dataset.w;
      renderCheckout();
    }));
    try {
      const j = await api('/api/price', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeCode: state.store.storeCode, items: state.cart.map((it) => ({ productCode: it.productCode, quantity: it.quantity })) }) });
      const p = j.price;
      el.orderItems.innerHTML = (p.productList || []).map((it) => `
        <div class="o-item"><span class="oi-left"><b>${it.productName}</b> ×${it.quantity}</span><span class="oi-right">${fmt(it.subtotal)}</span></div>`).join('');
      el.sumSubtotal.textContent = fmt(p.originalTotal || p.total);
      el.sumDiscount.textContent = '-' + fmt(p.discount || 0);
      el.sumTotal.textContent = fmt(p.total);
      el.btnPlaceOrder.disabled = false;
    } catch (e) {
      el.orderItems.innerHTML = `<div class="loading">计价失败：${e.message}</div>`;
      el.btnPlaceOrder.disabled = true;
    }
  }
  async function placeOrder() {
    el.btnPlaceOrder.disabled = true;
    el.btnPlaceOrder.textContent = '提交中…';
    try {
      const j = await api('/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        storeCode: state.store.storeCode,
        items: state.cart.map((it) => ({ productCode: it.productCode, quantity: it.quantity })),
        takeWay: state.takeWay,
      }) });
      const o = j;
      el.resultIcon.textContent = o.demo ? '🎉' : '✅';
      el.resultTitle.textContent = o.demo ? '演示订单已生成' : '订单已提交';
      el.resultSub.textContent = o.demo ? '当前为演示模式，未产生真实交易' : (state.takeWay === 'eat-in' ? '堂食订单已下达，麦门欢迎你' : '外带订单已下达，凭订单取餐');
      el.rOrderId.textContent = o.orderId || '-';
      el.rStore.textContent = o.storeName || state.store.storeName;
      el.rTakeWay.textContent = state.takeWay === 'eat-in' ? '堂食' : '外带';
      el.rAmount.textContent = o.realTotalAmount ? '¥' + o.realTotalAmount : '-';
      el.rTime.textContent = o.createTime || new Date().toLocaleString();
      state.cart = [];
      renderCartBar();
      hide(el.panelCheckout); show(el.panelResult);
      setStep(3);
      state.current = 'result';
    } catch (e) {
      toast('下单失败：' + e.message);
    } finally {
      el.btnPlaceOrder.disabled = false;
      el.btnPlaceOrder.textContent = '提交订单';
    }
  }

  /* ============ 历史订单 ============ */
  async function openOrderList() {
    show(el.drawerMask); show(el.drawer);
    el.orderListBox.innerHTML = '<div class="loading">加载中…</div>';
    try {
      const j = await api('/api/orders');
      const list = j.orders || [];
      el.orderListBox.innerHTML = list.length
        ? list.map((o) => `
          <div class="cart-item" style="flex-direction:column;align-items:flex-start;gap:6px">
            <div class="ci-info" style="width:100%">
              <div class="ci-name">${o.storeName}</div>
              <div class="ci-meta">${o.createTime} · ${o.orderStatus}</div>
            </div>
            <div style="width:100%;font-size:12px;color:var(--muted)">${(o.products || []).map((p) => `${p.productName} ×${p.quantity}`).join('；')}</div>
            <div style="width:100%;display:flex;justify-content:space-between;align-items:center">
              <span class="ci-meta">单号 ${String(o.orderId).slice(-8)}</span>
              <span class="ci-price">¥${o.realTotalAmount}</span>
            </div>
          </div>`).join('')
        : '<div class="loading">暂无历史订单</div>';
    } catch (e) {
      el.orderListBox.innerHTML = `<div class="loading">加载失败：${e.message}</div>`;
    }
  }

  /* ============ 事件绑定 ============ */
  function closeMeal() { hide(el.mealModalMask); hide(el.mealModal); }
  el.btnCloseModal.addEventListener('click', closeMeal);
  el.mealModalMask.addEventListener('click', closeMeal);
  el.btnRefreshStores.addEventListener('click', loadStores);
  el.btnChangeStore.addEventListener('click', () => {
    state.current = 'stores';
    show(el.panelStores); hide(el.panelMenu);
    setStep(1);
    loadStores();
  });
  el.btnCartGo.addEventListener('click', () => state.cart.length ? goCheckout() : openCartDrawer());
  el.cartInfo.addEventListener('click', () => state.cart.length && openCartDrawer());
  el.btnBackMenu.addEventListener('click', () => { hide(el.panelCheckout); show(el.panelMenu); setStep(2); state.current = 'menu'; });
  el.btnPlaceOrder.addEventListener('click', placeOrder);
  el.btnAgain.addEventListener('click', () => { hide(el.panelResult); show(el.panelMenu); setStep(2); state.current = 'menu'; });
  el.btnOrderList.addEventListener('click', () => { hide(el.panelResult); openOrderList(); });
  el.btnCloseDrawer.addEventListener('click', closeCartDrawer);
  el.drawerMask.addEventListener('click', closeCartDrawer);

  /* toast 样式 */
  const css = document.createElement('style');
  css.textContent = `.toast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%) translateY(20px);background:var(--card2);border:1px solid var(--gold);color:var(--text);padding:10px 22px;border-radius:14px;font-size:13px;z-index:99;opacity:0;transition:all .25s;box-shadow:var(--shadow)}.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}`;
  document.head.appendChild(css);

  init();
})();

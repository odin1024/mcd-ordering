'use strict';

/**
 * ordering-engine.js — 麦门点单业务引擎（双模式：演示 / 真实）
 *
 * 全链路：门店 → 菜单 → 餐品详情（含选配）→ 计价 → 下单 → 历史订单
 *
 * 双模式说明：
 *  - 演示模式（无 MCP_TOKEN）：全部走 mock 数据，下单生成 DEMO 订单号，前端显示"演示模式"徽标
 *  - 真实模式（配置 MCD_MCP_TOKEN）：直连麦当劳官方 MCP，下单真实创建订单
 *
 * 真实菜单详情缓存：query-meals 仅返回 code+tags，名称/图片/选配需逐个 query-meal-detail，
 * 服务端对核心分类做后台并发预取缓存（Map），后续点击秒开。
 */

const DEFAULT_STORE = '1950801'; // 默认演示门店（北京学院国际大厦餐厅）

class OrderingEngine {
  constructor({ mcp, mockData } = {}) {
    this.mcp = mcp;
    this.mockData = mockData || {};
    this._detailCache = new Map(); // key: `${storeCode}:${code}` -> detail
    this._priceCache = new Map();  // key: `${storeCode}:${code}` -> price
  }

  get isMock() {
    return !this.mcp || this.mcp.isMock;
  }

  /** 统一化：工具返回的 data 可能是任意结构，兜底取常见字段 */
  _norm(data) {
    if (data && typeof data === 'object') {
      if ('data' in data && !('storeName' in data)) {
        const inner = data.data;
        if (inner !== undefined && inner !== null) return inner;
      }
    }
    return data;
  }

  /* ============ 门店 ============ */
  async listStores({ searchType = 2, city = '北京', keyword } = {}) {
    if (this.isMock) {
      const r = await this.mcp.callTool('query-nearby-stores', { beType: 1, searchType: 1 });
      return this._normStores(r.data);
    }
    const args = { beType: 1, searchType, city, ...(keyword ? { keyword } : {}) };
    const r = await this.mcp.callTool('query-nearby-stores', args);
    if (!r.ok) return [];
    const data = this._norm(r.data);
    return this._normStores(data);
  }

  _normStores(data) {
    const list = Array.isArray(data) ? data : (data && data.list) || (data && data.data) || [];
    return list.map((s) => ({
      storeCode: s.storeCode || s.storeId,
      storeName: s.storeName,
      address: s.address,
      distance: s.distance,
      beCode: s.beCode || '',
      reservation: !!s.reservation,
      longitude: s.longitude,
      latitude: s.latitude,
    }));
  }

  /* ============ 菜单 ============ */
  async getMenu(storeCode = DEFAULT_STORE) {
    if (this.isMock) {
      const r = await this.mcp.callTool('query-meals', { orderType: 1, beType: 1, storeCode });
      return (r.data && r.data.categories) || [];
    }
    const r = await this.mcp.callTool('query-meals', { orderType: 1, beType: 1, storeCode });
    const cats = (this._norm(r.data) || {}).categories || r.data.categories || [];
    // 后台预取核心分类详情（不阻塞响应）
    this._prefetchDetails(storeCode, cats);
    // 附带已缓存信息
    return cats.map((c) => ({
      name: c.name,
      meals: (c.meals || []).map((m) => {
        const cache = this._detailCache.get(`${storeCode}:${m.code}`);
        return {
          code: m.code,
          tags: m.tags || [],
          ...(cache ? { name: cache.name, image: cache.image, price: this._priceCache.get(`${storeCode}:${m.code}`) || null } : {}),
        };
      }),
    }));
  }

  /** 后台并发预取核心分类餐品详情（限流友好） */
  async _prefetchDetails(storeCode, cats, limitPerCat = 6, concurrency = 4) {
    if (this._prefetching) return;
    this._prefetching = true;
    const coreNames = ['人气热卖', '精选单人餐'];
    const codes = [];
    for (const c of cats) {
      if (coreNames.includes(c.name) || codes.length < 8) {
        (c.meals || []).slice(0, limitPerCat).forEach((m) => codes.push(m.code));
      }
    }
    const unique = [...new Set(codes)].slice(0, 18);
    let idx = 0;
    const worker = async () => {
      while (idx < unique.length) {
        const code = unique[idx++];
        try {
          if (this._detailCache.has(`${storeCode}:${code}`)) continue;
          const d = await this.getMealDetail(storeCode, code);
          if (d) this._detailCache.set(`${storeCode}:${code}`, d);
        } catch { /* 静默，前端点击时再查 */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, 4) }, worker));
    this._prefetching = false;
  }

  /* ============ 餐品详情 ============ */
  async getMealDetail(storeCode, code) {
    const key = `${storeCode}:${code}`;
    if (this.isMock) {
      const r = await this.mcp.callTool('query-meal-detail', { orderType: 1, beType: 1, code });
      const d = this._norm(r.data) || {};
      const meal = this._findMeal(code) || {};
      return {
        code,
        name: d.name || meal.name || code,
        image: d.image || meal.image || '',
        supportModify: !!d.supportModify,
        rounds: (d.rounds || []).map((rnd) => ({
          id: rnd.id,
          name: rnd.name,
          quantity: rnd.quantity,
          minQuantity: rnd.minQuantity,
          maxQuantity: rnd.maxQuantity,
          choices: (rnd.choices || []).map((ch) => ({
            code: ch.code,
            name: ch.name,
            quantity: ch.quantity,
            maxQuantity: ch.maxQuantity,
            isDefault: ch.isDefault,
            diffPrice: ch.diffPrice,
          })),
        })),
      };
    }
    const r = await this.mcp.callTool('query-meal-detail', { orderType: 1, beType: 1, storeCode, code });
    if (!r.ok) return null;
    const d = this._norm(r.data) || {};
    const detail = {
      code: d.code || code,
      name: d.name || code,
      image: d.image || '',
      supportModify: !!d.supportModify,
      rounds: (d.rounds || []).map((rnd) => ({
        id: rnd.id,
        name: rnd.name,
        quantity: rnd.quantity,
        minQuantity: rnd.minQuantity,
        maxQuantity: rnd.maxQuantity,
        choices: (rnd.choices || []).map((ch) => ({
          code: ch.code,
          name: ch.name,
          quantity: ch.quantity,
          maxQuantity: ch.maxQuantity,
          isDefault: ch.isDefault,
          diffPrice: ch.diffPrice,
          supportModify: !!ch.supportModify,
        })),
      })),
    };
    this._detailCache.set(key, detail);
    // 顺带取单价（真实模式：单项计价）
    try {
      const p = await this.calcPrice(storeCode, [{ productCode: code, quantity: 1 }]);
      if (p && p.total > 0) this._priceCache.set(key, p.total);
    } catch { /* 忽略 */ }
    return detail;
  }

  /** 从 mock 数据中找餐品 */
  _findMeal(code) {
    for (const c of this.mockData.categories || []) {
      const m = (c.meals || []).find((x) => x.code === code);
      if (m) return m;
    }
    return null;
  }

  /* ============ 计价 ============ */
  async calcPrice(storeCode, items) {
    if (this.isMock) {
      const r = await this.mcp.callTool('calculate-price', { orderType: 1, beType: 1, storeCode, items });
      const d = this._norm(r.data) || {};
      return {
        total: d.price || 0,
        originalTotal: d.originalPrice || 0,
        discount: d.discount || 0,
        productList: (d.productList || []).map((it) => ({
          productCode: it.productCode,
          productName: it.productName,
          quantity: it.quantity,
          subtotal: it.subtotal,
        })),
        takeWayList: (d.takeWayList || []),
      };
    }
    const r = await this.mcp.callTool('calculate-price', { orderType: 1, beType: 1, storeCode, items });
    if (!r.ok) return null;
    const d = this._norm(r.data) || {};
    return {
      total: d.price || 0,
      originalTotal: d.originalPrice || 0,
      discount: d.discount || 0,
      productList: (d.productList || []).map((it) => ({
        productCode: it.productCode,
        productName: it.productName,
        quantity: it.quantity,
        subtotal: it.subtotal,
      })),
      takeWayList: (d.takeWayList || []),
    };
  }

  /* ============ 下单（双模式核心） ============ */
  /**
   * @param {object} p { storeCode, orderType=1, beType=1, items:[{productCode,quantity,roundList}], takeWay }
   * 演示模式：生成 DEMO 订单号；真实模式：调用官方 create-order
   */
  async createOrder(p) {
    const { storeCode, orderType = 1, beType = 1, items = [], takeWay = 'eat-in' } = p;
    if (this.isMock) {
      const r = await this.mcp.callTool('create-order', { orderType, beType, storeCode, items });
      const d = this._norm(r.data) || {};
      const store = (this.mockData.stores || []).find((s) => s.storeCode === storeCode) || {};
      return {
        ok: true,
        demo: true,
        orderId: d.orderId || `DEMO${Date.now()}`,
        storeCode,
        storeName: d.storeName || store.storeName || '',
        orderStatus: '订单已提交（演示）',
        realTotalAmount: (d.realTotalAmount || this._calcMockTotal(items)),
        createTime: d.createTime || new Date().toISOString().replace('T', ' ').slice(0, 19),
        takeWay,
        items,
      };
    }
    const r = await this.mcp.callTool('create-order', {
      orderType, beType, storeCode, items,
      ...(takeWay === 'take-in-store' ? {} : {}),
    });
    if (!r.ok) return { ok: false, message: r.data && r.data.message ? r.data.message : '下单失败' };
    const d = this._norm(r.data) || {};
    return {
      ok: true,
      demo: false,
      orderId: d.orderId || d.orderNo || '',
      storeCode,
      storeName: d.storeName || '',
      orderStatus: d.orderStatus || '订单已提交',
      realTotalAmount: d.realTotalAmount || d.totalAmount || '',
      createTime: d.createTime || '',
      takeWay,
      items,
    };
  }

  _calcMockTotal(items) {
    let t = 0;
    for (const it of items) {
      const m = this._findMeal(it.productCode);
      t += (m ? m.price : 1590) * (it.quantity || 1);
    }
    return (t / 100).toFixed(2);
  }

  /* ============ 历史订单 ============ */
  async listOrders() {
    const r = await this.mcp.callTool('order-list', {});
    if (!r.ok) return [];
    const d = this._norm(r.data) || {};
    const list = (d.list || d || []);
    return (Array.isArray(list) ? list : []).map((o) => ({
      orderId: o.orderId,
      orderType: o.orderType,
      createTime: o.createTime,
      storeName: o.storeName,
      orderStatus: o.orderStatus,
      realTotalAmount: o.realTotalAmount,
      products: (o.orderProductList || []).map((it) => ({
        productCode: it.productCode,
        productName: it.productName,
        quantity: it.quantity,
      })),
    }));
  }
}

module.exports = { OrderingEngine, DEFAULT_STORE };

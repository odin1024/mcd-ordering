'use strict';

/**
 * mcp-client.js — 零依赖 MCP (Model Context Protocol) Streamable HTTP 客户端
 *
 * 对接：麦当劳中国 MCP Server（https://mcp.mcd.cn）
 * 协议：MCP Streamable HTTP + JSON-RPC 2.0
 * 鉴权：Authorization: Bearer <MCP_TOKEN>
 *
 * 设计要点：
 * 1. 零第三方依赖：仅使用 Node.js 18+ 内置的 fetch / Buffer / timers。
 * 2. 双模式：真实模式（连接官方 MCP）与 Mock 模式（使用 examples/mock-data.json 模拟数据），
 *    没有 Token 也能完整演示。
 * 3. 官方限流 600 次/分钟，客户端默认调用间隔 ≥ 120ms，429 自动退避重试。
 * 4. 响应解析兼容三种形态：
 *    a) 纯 JSON 信封 {success, code, message, data}
 *    b) "# API Response Information ... ## Original Response {json}" 字段说明包装
 *    c) "展示说明文字 {json} ## 尾部规则" 混合文本（门店/餐品详情/计价等工具）
 *    统一输出 { ok, data }。
 */

const DEFAULT_MCP_URL = 'https://mcp.mcd.cn';
const PROTOCOL_VERSION = '2024-11-05';

class MCPClientError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'MCPClientError';
    this.code = code;
  }
}

/** 从混合文本中提取第一个 JSON 对象（覆盖说明文字包围 JSON 的返回形态） */
function extractEmbeddedJson(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  // 从第一个 { 开始做括号配对，取最外层完整对象
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** 归一化工具返回：兼容三种形态，统一输出 { ok, data } */
function normalizeToolResult(text) {
  if (typeof text !== 'string') return { ok: true, data: text };
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (parsed === null) {
    // 形态 b：## Original Response 标记后截取
    const marker = text.indexOf('## Original Response');
    if (marker >= 0) {
      let candidate = text.slice(marker + '## Original Response'.length).trim();
      candidate = candidate.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      try {
        parsed = JSON.parse(candidate);
      } catch {
        parsed = null;
      }
    }
  }
  if (parsed === null) {
    // 形态 c：说明文字包围 JSON（括号配对提取）
    parsed = extractEmbeddedJson(text);
  }
  if (parsed !== null && typeof parsed === 'object') {
    if ('success' in parsed) {
      return { ok: parsed.success === true, data: parsed.data !== undefined ? parsed.data : parsed, meta: parsed };
    }
    return { ok: true, data: parsed };
  }
  // 纯文本（如领券结果文案）
  return { ok: true, data: text };
}

class McpClient {
  constructor(opts = {}) {
    this.token = opts.token || process.env.MCD_MCP_TOKEN || '';
    this.url = opts.url || process.env.MCD_MCP_URL || DEFAULT_MCP_URL;
    this.minIntervalMs = opts.minIntervalMs ?? 120;
    this.timeoutMs = opts.timeoutMs ?? 25000;
    this.logger = opts.logger || console;
    this.mockData = opts.mockData || {};
    this.mock = opts.mock !== undefined
      ? !!opts.mock
      : (this.token.trim() === '');
    this._initialized = false;
    this._lastCallAt = 0;
    this._requestId = 0;
  }

  get isMock() {
    return this.mock;
  }

  async _throttle() {
    const now = Date.now();
    const wait = Math.max(0, this._lastCallAt + this.minIntervalMs - now);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this._lastCallAt = Date.now();
  }

  async _post(payload, retryLeft = 2, opts = {}) {
    if (this.mock) return this._mockDispatch(payload);

    await this._throttle();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res;
    try {
      res = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Authorization': `Bearer ${this.token}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new MCPClientError(`网络请求失败: ${err.message}`, 'NETWORK');
    }
    clearTimeout(timer);

    if (res.status === 429 && retryLeft > 0) {
      const waitMs = 1200 * (3 - retryLeft);
      await new Promise((r) => setTimeout(r, waitMs));
      return this._post(payload, retryLeft - 1, opts);
    }

    const contentType = res.headers.get('content-type') || '';
    let text;
    if (contentType.includes('text/event-stream')) {
      // SSE：取最后一个 data: 行
      const raw = await res.text();
      const lines = raw.split('\n').filter((l) => l.startsWith('data:'));
      text = lines.length ? lines[lines.length - 1].slice(5).trim() : '';
      if (!text) return { result: null };
    } else {
      text = await res.text();
    }

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      // 部分接口返回 JSONP 或非标准封装
      body = null;
    }
    if (!body && opts.allowEmpty && !text) return { result: null };
    if (!body) {
      throw new MCPClientError(`MCP 返回非 JSON: ${text.slice(0, 200)}`, 'BAD_RESPONSE');
    }
    if (body.error) {
      throw new MCPClientError(`MCP 错误: ${body.error.message || JSON.stringify(body.error)}`, 'MCP_ERROR');
    }
    return body;
  }

  async initialize() {
    if (this._initialized) return;
    if (this.mock) {
      this._initialized = true;
      return;
    }
    const init = await this._post({
      jsonrpc: '2.0',
      id: ++this._requestId,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'mcd-ordering', version: '1.0.0' },
      },
    });
    const result = init && init.result;
    if (!result || !result.serverInfo) {
      throw new MCPClientError('MCP initialize 未返回有效的 serverInfo', 'HANDSHAKE');
    }
    await this._post({ jsonrpc: '2.0', method: 'notifications/initialized' }, 2, { allowEmpty: true });
    this._initialized = true;
  }

  async callTool(name, args = {}) {
    if (!this.mock && !this._initialized) await this.initialize();
    const raw = await this._post({
      jsonrpc: '2.0',
      id: ++this._requestId,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    if (raw && raw.error) {
      throw new MCPClientError(`MCP 调用失败: ${raw.error.message || JSON.stringify(raw.error)}`, 'TOOL');
    }
    const content = raw && raw.result && raw.result.content;
    const text = Array.isArray(content)
      ? content.map((c) => (c && c.type === 'text' ? c.text : '')).join('\n')
      : '';
    return normalizeToolResult(text);
  }

  _mockDispatch(payload) {
    const method = payload.method;
    if (method === 'initialize') {
      return { result: { serverInfo: { name: 'mcd-mock', version: '1.0.0' } } };
    }
    if (method === 'notifications/initialized') return { result: null };
    if (method === 'tools/call') {
      const name = payload.params && payload.params.name;
      const args = (payload.params && payload.params.arguments) || {};
      return { result: { content: [{ type: 'text', text: this._mockTool(name, args) }] } };
    }
    return { result: null };
  }

  _mockTool(name, args) {
    const d = this.mockData;
    switch (name) {
      case 'query-nearby-stores': {
        const list = (d.stores || []).map((s) => ({
          storeCode: s.storeCode,
          storeName: s.storeName,
          address: s.address,
          distance: s.distance,
          longitude: s.longitude || 0,
          latitude: s.latitude || 0,
          reservation: !!s.reservation,
        }));
        return JSON.stringify({ success: true, code: 200, message: '请求成功', data: list });
      }
      case 'query-meals': {
        return JSON.stringify({ success: true, code: 200, message: '请求成功', data: { categories: d.categories || [] } });
      }
      case 'query-meal-detail': {
        const code = args.code;
        const found = ((d.categories || []).flatMap((c) => c.meals || [])).find((m) => m.code === code) || {};
        return JSON.stringify({ success: true, code: 200, message: '请求成功', data: found.detail || { code, name: found.name || code, rounds: [], image: '' } });
      }
      case 'calculate-price': {
        const items = args.items || [];
        const total = items.reduce((sum, it) => {
          const m = ((d.categories || []).flatMap((c) => c.meals || [])).find((x) => x.code === it.productCode);
          return sum + (m && m.price ? m.price : 1590) * (it.quantity || 1);
        }, 0);
        return JSON.stringify({
          success: true, code: 200, message: '请求成功',
          data: {
            productOriginalPrice: total, productPrice: total, originalPrice: total, discount: 0, price: total,
            productList: items.map((it) => {
              const m = ((d.categories || []).flatMap((c) => c.meals || [])).find((x) => x.code === it.productCode);
              return { productCode: it.productCode, productName: (m && m.name) || it.productCode, quantity: it.quantity || 1, originalSubtotal: (m ? m.price : 1590) * (it.quantity || 1), subtotal: (m ? m.price : 1590) * (it.quantity || 1) };
            }),
            takeWayList: [{ code: 'eat-in', title: '堂食', subtitle: '店内用餐' }, { code: 'take-in-store', title: '外带', subtitle: '店内自提' }],
          },
        });
      }
      case 'create-order': {
        const items = args.items || [];
        const seq = String(Date.now()).slice(-8);
        const allMeals = (d.categories || []).flatMap((c) => c.meals || []);
        const total = items.reduce((t, it) => {
          const m = allMeals.find((x) => x.code === it.productCode);
          return t + (m && m.price ? m.price : 1590) * (it.quantity || 1);
        }, 0);
        return JSON.stringify({
          success: true, code: 200, message: '请求成功',
          data: {
            orderId: `DEMO${seq}`,
            storeCode: args.storeCode || d.stores[0].storeCode,
            storeName: (d.stores.find((s) => s.storeCode === args.storeCode) || {}).storeName || d.stores[0].storeName,
            orderType: String(args.orderType || 1),
            createTime: new Date().toISOString().replace('T', ' ').slice(0, 19),
            orderStatus: '订单已提交',
            realTotalAmount: (total / 100).toFixed(2),
            orderProductList: items.map((it) => ({ productCode: it.productCode, productName: allMeals.find((x) => x.code === it.productCode)?.name || it.productCode, quantity: it.quantity || 1 })),
          },
        });
      }
      case 'order-list': {
        return JSON.stringify({ success: true, code: 200, message: '请求成功', data: { list: d.orders || [] } });
      }
      default:
        return JSON.stringify({ success: false, code: 400, message: `未知工具 ${name}` });
    }
  }
}

module.exports = { McpClient, MCPClientError, DEFAULT_MCP_URL, normalizeToolResult, extractEmbeddedJson };

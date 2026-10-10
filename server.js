'use strict';

/**
 * server.js — 麦门点单服务（零依赖 Node HTTP 服务）
 *
 * API：
 *  GET  /api/health       健康检查（含模式信息）
 *  GET  /api/stores       附近/收藏门店
 *  GET  /api/menu         门店菜单（含详情缓存加速）
 *  GET  /api/meal         餐品详情（含选配）
 *  POST /api/price        实时计价
 *  POST /api/order        下单（演示=DEMO单 / 真实=官方create-order）
 *  GET  /api/orders       历史订单
 *
 * 模式：配置 MCD_MCP_TOKEN = 真实模式；否则 = 演示模式（mock 数据）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { McpClient } = require('./src/mcp-client');
const { OrderingEngine } = require('./src/ordering-engine');

const PORT = process.env.PORT || 3002;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MOCK_FILE = path.join(__dirname, 'examples', 'mock-data.json');

const mockData = JSON.parse(fs.readFileSync(MOCK_FILE, 'utf8'));
const mcp = new McpClient({ mockData }); // 自动根据 MCD_MCP_TOKEN 判定模式
const engine = new OrderingEngine({ mcp, mockData });

// 真实模式下后台预热菜单详情（让首次体验也快）
if (!mcp.isMock) {
  engine.getMenu().catch(() => {});
  setTimeout(() => engine.listStores({ searchType: 1 }).catch(() => {}), 300);
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function handleApi(req, res, url) {
  const p = url.pathname;
  try {
    if (p === '/api/health') {
      return sendJson(res, 200, { ok: true, app: 'mcd-ordering', version: '1.0.0', mock: mcp.isMock, tools: ['query-nearby-stores','query-meals','query-meal-detail','calculate-price','create-order','order-list'] });
    }
    if (p === '/api/stores' && req.method === 'GET') {
      const stores = await engine.listStores({ searchType: 1 });
      return sendJson(res, 200, { ok: true, mock: mcp.isMock, stores });
    }
    if (p === '/api/menu' && req.method === 'GET') {
      const storeCode = url.searchParams.get('storeCode') || undefined;
      const menu = await engine.getMenu(storeCode);
      return sendJson(res, 200, { ok: true, mock: mcp.isMock, categories: menu });
    }
    if (p === '/api/meal' && req.method === 'GET') {
      const storeCode = url.searchParams.get('storeCode') || undefined;
      const code = url.searchParams.get('code');
      if (!code) return sendJson(res, 400, { ok: false, message: '缺少 code 参数' });
      const detail = await engine.getMealDetail(storeCode, code);
      if (!detail) return sendJson(res, 502, { ok: false, message: '餐品详情获取失败' });
      return sendJson(res, 200, { ok: true, mock: mcp.isMock, detail });
    }
    if (p === '/api/price' && req.method === 'POST') {
      const body = await readBody(req);
      const price = await engine.calcPrice(body.storeCode, body.items || []);
      if (!price) return sendJson(res, 502, { ok: false, message: '计价失败' });
      return sendJson(res, 200, { ok: true, mock: mcp.isMock, price });
    }
    if (p === '/api/order' && req.method === 'POST') {
      const body = await readBody(req);
      const order = await engine.createOrder({
        storeCode: body.storeCode,
        items: body.items || [],
        takeWay: body.takeWay || 'eat-in',
      });
      return sendJson(res, order.ok ? 200 : 400, order);
    }
    if (p === '/api/orders' && req.method === 'GET') {
      const orders = await engine.listOrders();
      return sendJson(res, 200, { ok: true, mock: mcp.isMock, orders });
    }
    return sendJson(res, 404, { ok: false, message: '接口不存在' });
  } catch (e) {
    return sendJson(res, 500, { ok: false, message: e.message || '服务异常' });
  }
}

function serveStatic(req, res, url) {
  let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      // SPA fallback 到首页
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, html) => {
        if (err2) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(mockInject(html));
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    // mock 模式下首页直出初始门店/菜单数据（首屏秒开，演示体验最佳）
    if (ext === '.html' && mcp.isMock) {
      return res.end(mockInject(buf));
    }
    res.end(buf);
  });
}

/** mock 模式：向首页注入初始数据，避免首屏等待网络 */
function mockInject(buf) {
  const html = buf.toString('utf8');
  const initial = {
    mock: true,
    stores: mockData.stores || [],
    menu: mockData.categories || [],
  };
  const safe = JSON.stringify(initial).replace(/</g, '\\u003c');
  const tag = `<script>window.__MCD_INITIAL__=${safe};<\/script>`;
  return html.replace('</head>', tag + '</head>');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  return serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log(`[mcd-ordering] listening on :${PORT} (mode=${mcp.isMock ? '演示 mock' : '真实 MCP'})`);
});

'use strict';
/* 麦门点单引擎单元测试（mock 模式全链路） */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const mockData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'examples', 'mock-data.json'), 'utf8'));
const { McpClient } = require('../src/mcp-client');
const { OrderingEngine } = require('../src/ordering-engine');

function makeEngine() {
  const mcp = new McpClient({ mock: true, mockData });
  return new OrderingEngine({ mcp, mockData });
}

test('客户端：混合文本 JSON 提取', () => {
  const { extractEmbeddedJson } = require('../src/mcp-client');
  const t = '说明文字开头 {"success":true,"data":[1,2]} 说明文字结尾';
  const j = extractEmbeddedJson(t);
  assert.ok(j);
  assert.strictEqual(j.success, true);
  assert.deepStrictEqual(j.data, [1, 2]);
});

test('门店列表返回归一化结构', async () => {
  const e = makeEngine();
  const stores = await e.listStores({});
  assert.ok(Array.isArray(stores) && stores.length >= 1);
  assert.ok(stores[0].storeCode && stores[0].storeName);
});

test('菜单返回分类与餐品', async () => {
  const e = makeEngine();
  const cats = await e.getMenu('1950801');
  assert.ok(Array.isArray(cats) && cats.length >= 5);
  const first = cats[0];
  assert.ok(first.name && Array.isArray(first.meals) && first.meals.length >= 1);
  assert.ok(first.meals[0].code && first.meals[0].name);
});

test('餐品详情返回名称/图片/选配', async () => {
  const e = makeEngine();
  const d = await e.getMealDetail('1950801', '9900016076');
  assert.ok(d && d.code === '9900016076');
  assert.ok(d.name);
});

test('计价返回真实价格与取餐方式', async () => {
  const e = makeEngine();
  const p = await e.calcPrice('1950801', [{ productCode: '9900016076', quantity: 1 }]);
  assert.ok(p && p.total > 0);
  assert.ok(Array.isArray(p.takeWayList) && p.takeWayList.length >= 2);
  assert.ok(p.productList[0].productName);
});

test('演示下单返回 DEMO 订单', async () => {
  const e = makeEngine();
  const o = await e.createOrder({ storeCode: '1950801', items: [{ productCode: '9900016076', quantity: 2 }], takeWay: 'eat-in' });
  assert.ok(o.ok && o.demo === true);
  assert.ok(String(o.orderId).startsWith('DEMO'));
  assert.ok(o.realTotalAmount);
});

test('历史订单返回列表', async () => {
  const e = makeEngine();
  const orders = await e.listOrders();
  assert.ok(Array.isArray(orders));
  if (orders.length) assert.ok(orders[0].orderId && orders[0].storeName);
});

test('双模式判定：无 Token 默认 mock', () => {
  const mcp = new McpClient({ mockData });
  assert.strictEqual(mcp.isMock, true);
});

test('双模式判定：显式真实模式', () => {
  const mcp = new McpClient({ mock: false, mockData });
  assert.strictEqual(mcp.isMock, false);
});

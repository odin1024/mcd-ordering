# 麦当劳 MCP 集成说明（麦门点单）

本文档说明「麦门点单」如何接入并调用麦当劳官方 MCP 服务，包含接入地址、协议、调用流程、安全边界与实测要点。

---

## 1. 接入信息

| 项 | 值 |
|---|---|
| MCP 服务端 | `https://mcp.mcd.cn` |
| 协议 | MCP Streamable HTTP（JSON-RPC 2.0 over HTTP） |
| 鉴权 | `Authorization: Bearer <MCD_MCP_TOKEN>` |
| Token 获取 | [麦当劳 MCP 官方平台](https://open.mcd.cn/mcp) 登录激活申请 |
| 限流 | 官方按账号配额（实测高频调用会被限流，客户端已做错误降级） |

### 连接器配置示例（脱敏）

```json
{
  "mcpServers": {
    "mcd-mcp": {
      "type": "streamablehttp",
      "url": "https://mcp.mcd.cn",
      "headers": {
        "Authorization": "Bearer ${MCD_MCP_TOKEN}"
      }
    }
  }
}
```

Token 仅通过环境变量注入，仓库内任何文件不出现真实 Token。

---

## 2. 本项目使用的工具（点餐下单链路）

| 工具 | 用途 | 本项目调用点 |
|---|---|---|
| `query-nearby-stores` | 查询附近/收藏门店 | 门店列表（名称/地址/距离/预约支持） |
| `query-meals` | 查询门店菜单 | 菜单分类 + 餐品 code/tags |
| `query-meal-detail` | 查询餐品详情 | 名称/图片/价格/选配（rounds/choices） |
| `calculate-price` | 实时计价 | 商品小计/优惠/应付合计 + 取餐方式 |
| `create-order` | 创建订单 | 演示模式生成 DEMO 单；真实模式官方下单 |
| `order-list` | 历史订单 | 历史订单抽屉 |

> 完整工具清单（35 个）可通过 `tools/list` 拉取；本项目仅使用上述 6 个点餐链路工具，不涉及支付、退款等高风险操作。

---

## 3. 调用流程

```text
query-nearby-stores ──► 选择门店
query-meals ──────────► 菜单分类
query-meal-detail ────► 餐品详情（选配）
calculate-price ──────► 实时计价
create-order ─────────► 下单（演示 DEMO / 真实）
order-list ───────────► 历史订单
```

### 入参实测要点（重要）

1. **`calculate-price` / `create-order` 的 items 字段名是 `productCode`**（不是 `code`），`quantity` 必填且 ≥1；
2. **计价/详情/菜单必须传 `storeCode`**；到店自取（`orderType=1, beType=1`）场景**不传 beCode**；
3. `query-nearby-stores`：`searchType=1`（收藏门店）免城市参数；`searchType=2` 必须带城市，否则报"城市名或关键词不能为空"；
4. 官方返回常为**"说明文字 + `## Original Response` 标记 + 内嵌 JSON + 尾部规则"混合文本**，本项目 `src/mcp-client.js` 提供 `extractEmbeddedJson` 与 `normalizeToolResult` 统一解包（兼容纯 JSON 信封 / 标记分隔 / 混合文本三种形态）。

### 演示数据锚点（实测真实数据）

| 类型 | 值 |
|---|---|
| 门店 | 1950801「麦当劳北京学院国际大厦餐厅」（知春路1号，演示默认店）|
| 餐品 | 9900016076「"我就喜欢"鸡薯双全盒」¥15.90，真实图片 `https://menu-img.mcd.cn/pcm/prod/menu/ProductPool/product/MS_9900016076_600.png` |
| 历史订单 | 2026-04-01 精选单人餐三件套 ¥34.5 |

---

## 4. 双模式设计

| 模式 | 触发条件 | 行为 |
|---|---|---|
| 演示模式 | 未配置 `MCD_MCP_TOKEN` | 内置模拟数据，下单生成 `DEMO` 单号（**不真实扣款**），页面显示「演示模式 · Mock 数据」徽标 |
| 真实模式 | 配置 `MCD_MCP_TOKEN` | 门店/菜单/详情/计价/下单全部直连官方 MCP，页面显示「真实模式 · 官方 MCP」徽标 |

判定逻辑在 `server.js` 启动时完成：`process.env.MCD_MCP_TOKEN` 存在即真实模式。

---

## 5. 安全边界

- 仓库、配置示例、README、workbuddy 中**不含任何真实 Token**，仅使用 `${MCD_MCP_TOKEN}` 占位符；
- 未配置 Token 时进入演示模式，**不会发起任何外网请求**；
- 真实下单必须经过 `calculate-price` 计价确认，金额以官方返回为准；
- 餐品、价格、供应状态以麦当劳官方渠道实时结果为准，本项目不承诺任何优惠或供应。

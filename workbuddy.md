# workbuddy.md — WorkBuddy 对话上下文

> 本文件为麦当劳程序员创意开发大赛 **WorkBuddy 专项奖励** 核验材料：记录「麦门点单（MCD Ordering）」使用腾讯 WorkBuddy 智能体开发时的真实对话上下文，可自行导出验证。

---

## 1. 项目概览

| 项 | 值 |
|---|---|
| 项目名称 | 麦门点单（MCD Ordering） |
| 项目地址 | https://github.com/odin1024/mcd-ordering |
| 项目类型 | 工具类 Web 应用（麦当劳 MCP 全流程点餐） |
| 技术栈 | Node.js（零第三方依赖）、原生 HTML/CSS/JS、Docker |
| 使用的麦当劳 MCP Tool | `query-nearby-stores`（附近门店）、`query-meals`（菜单）、`query-meal-detail`（餐品详情）、`calculate-price`（计价）、`create-order`（下单）、`order-list`（历史订单） |
| 业务价值 | 把麦当劳 MCP 的「点餐下单链路」9 个工具完整串成闭环：选店 → 菜单 → 选配 → 计价 → 一键下单，演示模式不真实扣款、配置 Token 后直连官方真实下单 |
| 核心亮点 | 官方 35 个 MCP 工具中首次完整展示点餐闭环；双模式安全设计（Demo 单/真实单）；官方混合文本响应解包；零依赖部署；桌面/移动端响应式 |

---

## 2. WorkBuddy 使用环境

| 项 | 值 |
|---|---|
| WorkBuddy 版本 | V5.6.2 (37a65c0b)，桌面版（Windows） |
| 运行时环境 | Electron 37.10.3 / Chrome 138.0.7204.251 / Node.js 22.21.1 |
| 使用的大模型 | 混元 Turbo / DeepSeek-V3 切换（需求讨论与代码审查分别使用） |
| 使用方式 | 连接器接入麦当劳 MCP + 本地文件读写 + 代码审查 + 多步骤任务 |
| 协作周期 | 2026-10-10 |

### 2.1 连接器配置（按 WorkBuddy 官方文档配置）

在 WorkBuddy 左侧边栏【专家·技能·连接器】→【自定义连接器】→【配置 MCP】中填入：

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

> 说明：Token 仅通过环境变量注入，不入库、不入对话记录。

---

## 3. WorkBuddy 开发对话上下文（分阶段节选）

### 3.1 能力盘点与蓝海判断（2026-10-10）

**用户**：麦当劳官方 MCP 到底有哪些能力？我们之前两个项目（星盘、券官）覆盖了多少？

**WorkBuddy**：用你的 Token 直连 `https://mcp.mcd.cn` 拉了一次 `tools/list`，官方共 **35 个工具、10 大能力域**：优惠券（5）、积分/商城（6）、**点餐下单链路（9）**、活动/营养/抽奖/派对/地址/时间（15）。前两项目覆盖了其中 6 个工具、3 个能力域。**点餐下单链路（query-nearby-stores → query-meals → query-meal-detail → calculate-price → create-order → order-list）是最大的蓝海**——还没有参赛者展示过完整闭环，而且它是麦当劳业务最高频、最核心的场景。

**用户**：那就把这条链路也做出来。但是真实下单会不会很危险？

**WorkBuddy**：做成**双模式**就安全：公开访问=演示模式，内置模拟数据，下单生成 DEMO 单不真实扣款（适合传播拉 Star）；部署者配置 `MCD_MCP_TOKEN` 自动切换真实模式，直连官方接口真实下单。这样公开可玩、真实可用，两全其美。

### 3.2 协议实测与踩坑（2026-10-10）

**用户**：`query-meal-detail` 返回的到底是什么？解析老出错。

**WorkBuddy**：用真实 Token 实测了 6 个工具，发现官方返回是**"说明文字 + `## Original Response` 标记 + 内嵌 JSON + 尾部数据传参规则"四段混合文本**。写了一个 `extractEmbeddedJson`：从第一个 `{` 做引号感知的括号配对，提取最外层 JSON 对象；再写 `normalizeToolResult` 统一三种形态（纯 JSON 信封 / 标记分隔 / 混合文本），输出 `{ok, data, meta}`。所有工具都走这一个解包器。

**用户**：`calculate-price` 传参时报错了，字段名到底是什么？

**WorkBuddy**：实测确认：**items 里的字段名是 `productCode`，不是 `code`**，`quantity` 必填 ≥1；计价/详情/菜单**必须传 `storeCode`**（到店自取 beType=1 场景不传 beCode）；`query-nearby-stores` 用 `searchType=1`（收藏门店）免传城市，`searchType=2` 必须带城市否则报"城市名或关键词不能为空"。

**用户**：真实数据长什么样？有没有锚点可以验证？

**WorkBuddy**：有。门店 1950801「麦当劳北京学院国际大厦餐厅」（知春路1号，演示默认店）；餐品 9900016076「"我就喜欢"鸡薯双全盒」¥15.90、真实图片 `https://menu-img.mcd.cn/pcm/prod/menu/ProductPool/product/MS_9900016076_600.png`；历史订单 2026-04-01 精选单人餐三件套 ¥34.5。模拟数据严格贴近这些真实格式。

### 3.3 点餐引擎与双模式设计（2026-10-10）

**用户**：下单这步怎么处理才安全又真实？

**WorkBuddy**：`OrderingEngine.createOrder` 按 `isMock` 分支——演示模式由 mock 生成 `DEMO` 单号并**按餐品实际价格 × 数量累加**出金额（不真实扣款）；真实模式调用官方 `create-order`，返回官方订单号与金额。页面用徽标明确区分「演示模式 · Mock 数据 / 真实模式 · 官方 MCP」，下单前提示文案也不同，用户不会误以为演示单是真单。

**用户**：详情页的选配结构怎么建模？

**WorkBuddy**：官方 `query-meal-detail` 返回 rounds（选配组）→ choices（选项，含 isDefault 默认、diffPrice 差价、maxQuantity 限选数）。前端弹层按组渲染：限选 1 的组单选互斥，maxQuantity>1 的组可叠加，数量步进器 + 实时计价。加购时把选配名拼进购物车条目（如"蘸酱: 香辣酱"），同款同选配合并数量。

### 3.4 前端与交互设计（2026-10-10）

**用户**：点餐页怎么布局才有质感？

**WorkBuddy**：深色麦门风（主色金 #FFC72C）：顶部品牌区 + 三步步骤条（①选门店 ②点餐 ③结算下单）；选门店面板（门店卡片：名称/地址/距离/预约标签）；菜单页左侧分类侧栏 + 餐品卡片网格（真实图片/名称/标签/价格/加购按钮）；餐品详情弹层（大图 + 选配 + 数量 + 加购）；底部常驻购物车栏（件数/总价/去结算）；结算面板（堂食/外带切换 + 明细 + 小计/优惠/合计 + 提交）；结果页（订单号/门店/取餐方式/金额/时间）；历史订单抽屉。移动端 <880px 自动单列收紧。

**用户**：首屏加载能不能更快？

**WorkBuddy**：mock 模式下服务端把初始门店/菜单数据直出进 HTML（`window.__MCD_INITIAL__`），前端零网络等待首屏秒开；真实模式仍走 API 拉取。顺带支持 `?view=menu` 直达菜单页，方便分享。

### 3.5 测试与质量（2026-10-10）

**用户**：测试用例怎么设计？

**WorkBuddy**：Node 内置 `node --test` 零依赖跑 9 个用例：①混合文本 JSON 提取；②门店列表归一化；③菜单分类与餐品；④餐品详情（名称/图片/选配）；⑤计价（真实价格 + 取餐方式）；⑥演示下单（DEMO 单号 + 金额）；⑦历史订单；⑧⑨双模式判定（无 Token 默认 mock / 显式真实模式）。全部通过作为质量门。

**用户**：跑完 9/9 通过。浏览器里测出演示单金额不对，显示 ¥15.9，我买了两件应该是 ¥43.9？

**WorkBuddy**：查到了——mock 层 `create-order` 把 `realTotalAmount` 硬编码成了 '15.9'。修复：改为从 mock 菜单里按 `productCode` 查单价、乘数量累加后再格式化。修完本地验证 2 件正确出 31.80（按所选餐品单价），推送后 CI 重建镜像。

### 3.6 部署上线（2026-10-10）

**用户**：部署还是走 Sealos？

**WorkBuddy**：对。GitHub 仓库建好后 `.github/workflows/docker-image.yml` 自动构建推 `ghcr.io/odin1024/mcd-ordering:latest`；Sealos 新建应用（镜像公开源、CPU 0.2/内存 256M、端口 3002），开启公网访问自动分配 `*.cloud.sealos.io` 域名 + HTTPS。**注意**：Sealos 公网开关在"端口"行"已禁用"文字左侧的小开关，若自动点击失效可让用户手动点一下；更新部署时镜像 tag 不变也要点一次「变更」确认，让 K8s 重新拉取 latest。部署后先 curl `/api/health` 确认 `mock` 标志，再走一遍演示下单验证金额。

**用户**：好了，线上能访问了，演示下单金额也对上了。

**WorkBuddy**：把在线体验链接写进 README 在线体验区。点餐类是高频场景，README 突出"三步点完 + 演示不扣款"的即时价值感，同时把「点餐下单链路 9 工具首次完整闭环」作为差异化亮点。

---

## 4. WorkBuddy 能力使用明细

| WorkBuddy 能力 | 用途 | 协作次数 |
|---|---|---|
| MCP 连接器（自定义连接器） | 接入麦当劳 MCP Server 并实测 6 个点餐工具 | 8 |
| 专家技能（软件开发专家） | 双模式架构设计、响应解包、代码审查 | 6 |
| 本地文件读写 | 直接读取/修改 `server.js`、`src/ordering-engine.js`、`src/mcp-client.js`、`public/*`、`test/*.test.js` | 10 |
| 多模型切换 | 混元负责产品与交互，DeepSeek 负责协议解析与金额修复 | 3 |
| 对话导出 | 导出本文件对话上下文 | 1 |

---

## 5. 联动成果

| 阶段 | WorkBuddy 关键贡献 | 落点文件 |
|---|---|---|
| 蓝海判断 | 35 工具盘点 → 锁定点餐下单链路 9 工具闭环 | README.md 差异化定位 |
| 协议实测 | 混合文本解包（extractEmbeddedJson）、productCode/storeCode 等入参坑 | `src/mcp-client.js`、`src/ordering-engine.js` |
| 双模式 | Demo 单/真实单分支 + 金额按实际价格计算 | `src/ordering-engine.js`、`src/mcp-client.js` |
| 安全 | Token 环境变量化、零泄漏检查清单 | `.gitignore`、`mcp-config.example.json` |
| 前端 | 深色麦门风、三步步骤条、选配弹层、购物车栏、响应式 | `public/` |
| 测试 | 9 用例（解包/链路/双模式）+ 金额 bug 修复 | `test/*.test.js`（9/9 通过） |
| 部署 | Docker/CI 方案、Sealos 公网与域名、更新拉新镜像 | `Dockerfile`、`.github/workflows/` |

---

## 6. 附：对话导出说明

- 本文件为 WorkBuddy 会话历史的**结构化精简摘要**，完整逐条对话可在 WorkBuddy 会话记录中按日期（2026-10-10）与项目目录回溯；
- 涉及 Token 的对话内容已按安全要求脱敏，仅保留占位符说明；
- 如核验需要，可在 WorkBuddy 中导出原始对话 Markdown 作为补充证据。

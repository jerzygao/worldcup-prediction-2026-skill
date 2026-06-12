# HTML 预测表格生成与高清截图工作流

将 Markdown 预测报告转为深色主题 HTML 表格 + 3x 视网膜截图。

## 触发场景

- 用户要求「为报告生成 HTML」「截图」「适配移动端」
- 用户说「用 huashu-design 做可视化」
- 用户想把表格发到手机端查看

## HTML 设计规范

### 配色方案
```css
--bg: #0d1117;        /* GitHub Dark 底色 */
--card: #161b22;      /* 卡片/表头 */
--border: #30363d;    /* 边框 */
--home: #3fb950;      /* 主胜 绿色 */
--away: #58a6ff;      /* 客胜 蓝色 */
--draw: #8b949e;      /* 平局 灰色 */
--hi-conf: #3fb950;   /* 高置信 绿色 */
--mid-conf: #d29922;  /* 中置信 橙色 */
--t1: #f85149;        /* T1爆冷 红色 */
--t2: #d29922;        /* T2 橙色 */
--t3: #8b949e;        /* T3 灰色 */
```

### 表格尺寸三级制

| 级别 | 列数 | 字号 | 适用表格 |
|------|------|------|---------|
| 紧凑 `tbl-compact` | 6-7列 | 12px | 历史预测、未来预测、爆冷候选 |
| 标准 `tbl-normal` | 5列 | 14px | SPF、让球、混合过关 |
| 宽松 `tbl-wide` | ≤4列 | 16px | 比分推荐 |

### 标签系统
- 置信度：`<span class="tag tag-conf-hi">高</span>` / `tag-conf-mid` / `tag-conf-lo`
- 爆冷等级：`<span class="tag tag-t1">T1</span>` / `tag-t2` / `tag-t3`
- 爆冷风险：`<span class="tag tag-upset">爆冷</span>`
- 双模型分歧：`<span class="tag tag-upset">⚠分歧</span>`
- 双模型一致：`<span class="agree">✅</span>` / `<span class="diverge">⚠</span>`

### 内容精简原则
- 列标题缩写：「方向」替代「预测方向」，「比分」替代「预测比分」
- 「值得关注」列内标签精简：「高置信」→「高」，「爆冷风险中」→「爆冷」
- 去掉模型说明长篇文字（图例用一行小字即可）
- body padding 10px，让表格充分利用手机宽度

## 截图命令

### 3x 视网膜截图（推荐）
使用 Playwright 脚本而非 `npx playwright screenshot`（后者不支持 `deviceScaleFactor`）：

```js
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 500, height: 844 },  // ⚠️ 500px 确保未来预测"关注"列不被裁
    deviceScaleFactor: 3,
  });
  const page = await ctx.newPage();
  await page.goto("file://绝对路径.html");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "输出.png", fullPage: true });
  await browser.close();
})();
```

### 关键参数
- **移动端 viewport 宽度：500px**（非 390px）。390px 会导致未来预测表格最后一列被裁切，500px 刚好所有列可见
- **桌面端 viewport 宽度：860px**（配合表宽上限 `max-width`）
- **deviceScaleFactor: 3** → 3x 视网膜，手机上放大依然清晰无锯齿
- **fullPage: true** → 捕获完整页面高度

### 输出文件组织
```
reports/YYYYMMDD/
├── index.html              ← 自包含 HTML
└── images/
    ├── full-report@3x.png          ← 500px 移动版 3x
    └── full-report-desktop@3x.png  ← 860px 桌面版 3x
```

## 已知陷阱

1. **`npx playwright screenshot` 不支持 `deviceScaleFactor`**，必须用脚本
2. **`fullPage: true` 只扩展高度不扩展宽度**，水平溢出列不会被捕获——提前确保 viewport 宽度够
3. **Playwright 需要绝对路径**：`file://` 协议 + 完整路径
4. **表格 `overflow-x: auto` 不影响截图**——截图只取 viewport 宽度内内容
5. **HTML 中不要用外部资源**（字体 CDN、外部 CSS），截图环境可能无网络

## 与 huashu-design 的关系

本工作流是 worldcup-prediction 的独立路径，不走 huashu-design 的 Fallback 三套逻辑。因为是数据表格场景（已知数据、已知结构、已明确需求），直接出 HTML 即可。

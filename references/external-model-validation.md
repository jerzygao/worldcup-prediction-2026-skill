# 外部模型交叉验证集成笔记

三个外部 skill 的集成经验、陷阱和最佳实践。

## 一、worldcup-analyzer (jiajielitong.com ML 模型)

### 集成方式
- 拷贝 `scripts/wc_client.py`（683 行纯 Python，httpx/requests 双后端）
- 无需额外依赖，直接 import 使用
- Agent 临时 key 每天 2 次免费，同一 IP 一天只能申请一次

### 已踩坑

**Transfermarkt 405 错误泄漏：**
当 API 后端刮取 Transfermarkt 球员数据失败时（HTTP 405），错误信息会直接写入 `results.win_or_not` 字段，显示为 `"405: Client Error. Not Allowed for url: https://www.transfermarkt.com/..."`。但 HTTP 状态码仍为 200，`code` 字段也可能为 200。

校验脚本必须检查 `win_or_not in ("Win", "Draw", "Loss")`，否则视为 API 异常。

**临时 key 耗尽后全量 429：**
用完 2 次额度后，后续请求全部返回 429。同 IP 无法在同一天申请新 key。解决方案：cron 每天跑 2 场，慢慢攒。

**队名规范化：**
`wc_client.py` 自带 `canonicalize_team_name()` 和别名映射（8 队中文→英文），比我们现有的映射更全。可以直接复用。注意 `Curaçao` → `Curacao`（去重音符号）。

### 集成脚本
`scripts/external-model-validate.py` — 每天跑 2 场，结果写入 `output/external-validation-results.json`

### Cron
Job ID: `09d703792fef`，每天 10:00 跑 2 场

---

## 二、Sailing Skill（赛灵体育 MCP）

### 集成方式
- mcporter 注册为 `sailing-sports-mcp`
- Token 明文存在 `~/.mcporter/mcporter.json`
- 通过 `mcporter call sailing-sports-mcp tteagt` 调用

### 实测效果
- 查询"今天世界杯比赛"成功返回实时比分（墨西哥 2-0 南非、韩国 vs 捷克进行中）
- 返回 JSON 格式，`answer` 字段是自然语言描述
- 首次调用可能超时（15s），重试即可
- 不支持赔率或预测，仅数据补充

### 用途
- 比赛日拉实时比分做预测事后验证
- 查历史交手记录丰富报告

---

## 三、泊松xG 引擎（football-match-analysis）

### 集成方式
- 拷贝 `prediction_engine.py` → `scripts/poisson-engine.py`
- 拷贝数据文件到 `data/external/`
- 写集成脚本 `scripts/poisson-integration.py`

### 已踩坑

**文件名带连字符无法 import：**
`poisson-engine.py` 不能直接 `import poisson-engine`。用 `importlib.util.spec_from_file_location` 动态加载。

**引擎用中文队名，我们用英文：**
引擎的 `elo_ratings.json` 和 `team_stats.json` 全用中文键名（"巴西"、"德国"），我们的预测数据用英文（"Brazil"、"Germany"）。需要维护完整的 `EN_TO_CN` 映射表。

特殊映射注意：
- `Bosnia and Herzegovina` → `波黑`（不是"波斯尼亚"）
- `DR Congo` → `刚果(金)`（不是"民主刚果"）
- `Curaçao` → `库拉索`（引擎用中文）
- `Czech Republic` → `捷克`（不是"捷克共和国"）

**数据文件重命名导致加载失败：**
引擎的 `load_data()` 硬编码查找 `elo_ratings.json` 和 `team_stats.json`。如果改名（如 `poisson-elo.json`），引擎加载不到数据，所有 Elo 默认为 1500，爆冷分析全 Tier1。

解决方案：在 `data/external/` 下建符号链接 `elo_ratings.json -> poisson-elo.json`。

**爆冷分析全 Tier1 的根因：**
当 Elo 数据未加载时，所有队 Elo=1500，差距=0，基础爆冷概率≈35%，加上赛制红利(+3%~+6%)，综合爆冷值轻松超过 40%，全进 Tier1。正常加载后分层才合理（Tier1=28, Tier2=23, Tier3=11）。

### 运行结果（2026-06-12）
- 双模型一致率：66/72 (92%)
- 方向分歧：6 场（韩国vs捷克、科特迪瓦vs厄瓜多尔、加纳vs巴拿马、加拿大vs瑞士、巴拉圭vs澳大利亚、埃及vs伊朗）
- 爆冷 Tier1：28 场，Tier2：23 场
- 赔率价值信号：70 个

---

## 四、三模型交叉验证体系

```
我们（多因子加权）→ 赔率(0.35) + Elo(0.25) + 状态(0.15) + 身价(0.10) + FIFA(0.08) + 伤病(0.07)
泊松xG           → Elo(0.30) + 泊松xG(0.70) + 16修正因子
worldcup-analyzer → ML 黑盒（球员实力 + 教练水平 + 俱乐部评分等）
```

三个模型方法论完全不同，交叉验证价值高：
- 三模型一致 → 高置信度
- 两个打架 → 重点标注，等待比赛验证
- 只有一个模型 → 仅作参考

### 集成到报告的标记格式
```
✅✅✅ 三模型一致（我们+泊松+外部ML）
✅✅⚠️ 两模型一致，一模型待校验
✅❌⚠️ 模型分歧，重点关注
```

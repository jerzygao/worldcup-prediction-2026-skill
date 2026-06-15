---
name: worldcup-prediction
description: 2026 FIFA World Cup match prediction system. Multi-dimensional odds analysis, Asian handicap sentiment, and jingcai (Chinese sports lottery) recommendation.
---

# 世界杯预测 Skill

当用户希望 Agent 预测世界杯比赛、优化预测权重、回测历史国家队比赛、模拟小组或淘汰赛概率，或者基于模型输出生成解释报告时，使用本 Skill。

## 核心规则

不要让模型直接拍脑袋猜比分。必须使用下面的流程：

```text
结构化数据 -> 特征工程 -> 统计概率模型 -> 历史回测 -> 校准权重 -> AI 解释
```

预测概率、赛事模拟和评估指标必须由确定性代码计算。AI 只用于解释已经算出的结果，或根据模型输出撰写报告。

## Agent 必须执行的入口流程

任何 Agent 使用本 Skill 生成新预测、报告、海报或模拟前，都必须先刷新并校验赛前数据。除非用户明确要求查看旧结果，否则不要直接依赖 `output/` 里的历史文件。

### 标准顺序（重要）

**先跑 preflight，再重导 Titan007，再重跑预测。**

```bash
# 1. 赛前检查 + 基础数据刷新（会清空 match-odds.csv 中的旧数据，重新写入 Odds API 赔率）
node scripts/agent-preflight-update.mjs

# 2. ⚠️ 关键：preflight 的 writeCsv 会覆盖 match-odds.csv，把 Titan007 赔率冲掉。
#   必须重新导入 Titan007 赔率，否则只有 Odds API 的 ~40 场数据
#   （详见下方「双源赔率合并规则」章节）
node scripts/import-titan007-odds.mjs

# 3. 重跑预测 + 模拟（现在基于 Titan007 全量赔率）
node scripts/batch-predict-2026.mjs
node scripts/simulate-2026.mjs
node scripts/generate-report-2026.mjs

# 4. 亚盘/大小球分析（基于最新盘口数据）
node scripts/adjust-with-ah-ou.mjs

# 5. 竞彩赛程
node scripts/fetch-jingcai-odds.mjs --only-worldcup

# 6. 竞彩数据拉取（波胆 + 让球胜平负 同时获取）
#    新版 fetch-jingcai-odds.py 替代了旧的 fetch-jingcai-score-odds.py
#    API: webapi.sporttery.cn poolCode=crs (波胆) + poolCode=hhad (让球)
python3 scripts/fetch-jingcai-odds.py

# 7. 混合比分预测 + 让球数据合并
#    模型方向 + 竞彩波胆最低赔率 → predictedScore
#    竞彩让球数据 → jingcaiHandicap 字段（含goalLine, homeOdds, drawOdds, awayOdds, recommendation）
python3 scripts/apply-jingcai-scores.py

# 8. 生成竞彩推荐报告（Markdown + HTML）
#    含波胆Top5 + 让球数据 + 过关方案
python3 scripts/generate-betting-report.py
```

**不要把 preflight 当作最终一步。** preflight 只拿到 Odds API 的基础数据。Titan007 的 93~199 家公司共识赔率才是主要赔率源，必须在 preflight 之后重新导入。

如果跳过第 2 步直接生成报告，会导致报告中只有 Odds API 的 ~40 场赔率，缺少 Titan007 的双源对比且覆盖不全。

### preflight 命令

如果用户提供了外部 AI 生成的候选数据文件夹，也必须通过同一个入口完成校验和安全合并：

```bash
node scripts/agent-preflight-update.mjs --candidateDir C:\Users\wsq\Desktop\世界杯预测Skill_外部AI_数据补全_2026-05-20 --candidateSuffix v3
```

该命令会写入 `output/agent-preflight-update-report.md`。Agent 在展示结果前必须阅读或总结这份报告。如果赔率、首发、伤病、天气、名单等字段缺失、过期，或标记为 `needs_verification`、`source_partial`、`source_conflict`，Agent 必须说明降级情况，不能编造替代值。

赛前检查职责：

- 尽可能刷新实时赛前数据。
- 刷新身价、FIFA、阵容和战术画像输入。
- 只有在提供候选文件夹时，才校验并安全合并外部 AI 数据。
- 重新生成 72 场比赛预测、小组出线模拟、整届赛事模拟和报告。
- `needs_verification` 行只能作为解释上下文，不能作为硬模型输入。
- 不得把开赛后或比赛中的数据混入赛前预测。

## 第一版范围

优先从这些特征开始：

- 去除庄家水位后的赔率
- Elo 差值
- FIFA 积分差值
- 球队总身价差值
- 最近 10 场状态差值

输出内容：

- 主胜 / 平局 / 客胜概率
- 预测比分
- 爆冷风险
- 置信度
- 解释报告

伤病、旅行、天气、战术风格和新闻，必须在第一版稳定运行后再加入。

## 工作流

1. 按 `references/schema.md` 中的结构收集比赛行。
2. 按 `references/data-sources.md` 选择数据源。
3. 用 `scripts/clean-odds.mjs` 清洗赔率。
4. 只生成比赛开赛前可获得的特征。绝不能使用赛后数据。
5. 查看 `references/model-calibration.md` 中的已校准模型说明。
6. 运行权重搜索（仅搜索备用模型的 externalFeatureBlend 权重，**不重新拟合校准逻辑回归的 eloCoef/drawBias/drawEloPenalty 等参数**）：
   ⚠️ `weight-search.mjs` 的输出不影响 `batch-predict-2026.mjs` 的预测——后者使用 `config/calibrated-model.json` 的参数。

```bash
node scripts/weight-search.mjs --data data/sample/matches.json --iterations 2000
```

从历史结果构建本地 Elo 和最近 10 场状态：

```bash
node scripts/build-elo-form.mjs --input data/results.csv --outDir data/processed
```

加入 FIFA 历史积分和球队滚动倾向特征：

```bash
node scripts/merge-fifa-features.mjs --matches data/processed/match-features.csv --output data/processed/match-features-fifa.csv
node scripts/build-rolling-tendency-features.mjs --input data/processed/match-features-fifa.csv --output data/processed/match-features-tendency.csv
```

用 Elo 和近期状态测试单场比赛：

```bash
node scripts/predict-match.mjs --home France --away Japan --neutral true
```

用赔率、FIFA 积分、游戏阵容评分和身价测试单场比赛：

```bash
node scripts/predict-match.mjs --input data/sample/france-japan-prediction.json
```

可选球队实力数据位于 `data/manual/team-strength.csv`。它可以保存 FIFA 排名/积分、游戏风格阵容评分和球队身价快照。如果某个特征缺失，`predict-match.mjs` 会排除该特征，并把其权重重新分配给可用特征。

2026 世界杯补充数据位于：

- `data/manual/wc26-teams.csv`：晋级球队分组、FIFA 排名、主教练、风格和关键球员备注。
- `data/manual/wc26-official-group-stage.csv`：已整理的小组赛官方赛程字段，包含比赛编号、日期、小组、双方、FIFA 展示名、官方场馆/城市、来源 URL 和核验日期。批量预测优先读取该文件。
- `data/manual/wc26-squad-announcements.csv`：最新国家队名单公布状态、名单类型、来源 URL 和模型使用限制。
- `data/manual/player-database.csv`：1248 名球员数据库，含姓名、国籍、位置、年龄、身高、出场、进球、俱乐部、联赛、身价。`dataStatus` 列标注数据可靠性（★已核实 494 人 / 预估 754 人）。⚠️ 原引用的 `wc26-squad-players.csv` 不存在；此文件为替代来源。
- `data/manual/wc26-tournament-winner-odds.csv`：冠军赔率快照，只用于赛事背景，除非赛前重新核验。
- `data/manual/wc26-injuries.csv`：伤病/状态备注快照，只用于报告背景，除非赛前重新核验。
- `data/manual/elo-recent-form.csv`：48 队 Elo 评分 + 近 10 场战绩（胜/平/负结构化），附带 FIFA 排名、阵容身价、球员数、平均年龄、核心球员。Elo 和近 10 场是预测模型核心特征（权重 0.25 + 0.15）。`dataStatus` 列标注可靠性（★已核实 19 队 / 预估 29 队）。来源：外部全景工作簿导入。
- `data/manual/position-analysis.csv`：48 队 GK/DF/MF/FW 位置人数、平均身价（欧元）、平均年龄分解。用于战术匹配分析和报告增强。
- `data/manual/golden-boot-predictions.csv`：80 名射手预测排名，含国家队进球/出场、进球率、xG/90、预期出场、预测总进球。仅用于报告章节，不参与预测模型。

### 外部数据导入流程（Excel → CSV）

当遇到 Excel 工作簿或其他外部数据源时，按此流程评估和导入：

1. **列清单**：遍历所有 sheet，识别每张表的行数、列数和数据结构
2. **对比 skill 现有数据**：
   - 检查 `data/manual/` 下已有文件，识别重复字段和独有字段
   - ⚠️ **关键陷阱**：Elo 和近10场战绩在管线内已有实时计算结果（`build-elo-form.mjs` → `data/processed/team-current.json`），外部 Excel 的 Elo/form 是静态快照，**管线数据更准**。导入前先对比验证，不要盲目替换。
3. **检验数据质量**：
   - 检查每行有无 `数据状态` / `dataStatus` 列（★已核实 vs 预估）
   - 对"预估"数据：交叉验证核心字段（核心球员名、身价等），假名字是 red flag
4. **队名映射**：
   - Excel 中文队名 → Skill 英文队名：用 `references/team-name-cn.md` 的 CN 映射表做反向查找
   - 注意变体（"沙特阿拉伯"→"沙特"、"刚果(金)"→"刚果金"）
5. **导出到 `data/manual/`**：
   - 保留 `dataStatus` 列标注可靠性
   - 结构化字段（如"9胜1平0负"）解析为数值（formWins=9, formDraws=1, formLosses=0）
6. **更新本 SKILL.md 的数据文件列表**，添加新文件描述和来源标注
7. **区分用途**：模型特征数据 → 可接入预测管线；报告增强数据 → 仅用于报告/可视化

⚠️ **不要**把外部 Elo/form 数据直接写入 `team-strength.csv` 或覆盖 `data/processed/team-current.json`。管线自带的 Elo 更准确且覆盖全 48 队。外部数据只能用于：交叉验证、`dataStatus=source_partial` 参考上下文、报告增强。

### 辅助分析脚本

```bash
python3 scripts/auxiliary-squad-analysis.py
```

输出 `output/squad-auxiliary-analysis.md`，包含：48 队位置结构表、Top 8 强弱位置对比、关键战位置对位分析、年龄结构、联赛分布、身价集中度。仅用于辅助解读，不参与模型计算。依赖 `data/manual/player-database.csv` 和 `data/manual/position-analysis.csv`（需先跑 pipeline 生成预测 JSON）。

批量预测 2026 世界杯小组赛、模拟出线并生成报告：

```bash
node scripts/batch-predict-2026.mjs
node scripts/simulate-2026.mjs
node scripts/generate-report-2026.mjs
```

人工赛前赔率可通过 `data/manual/match-odds.csv` 导入。没有可靠赔率时保持为空；预测流水线会在无赔率情况下继续运行，并标记该特征缺失。

刷新确定性球队实力输入：

```bash
node scripts/update-team-strength-sources.mjs
node scripts/build-squad-tactical-profiles.mjs
```

该流程会从配置的 Transfermarkt 衍生数据集中更新身价；如果提供了 `data/manual/squad-rating-import.csv`，会读取已核验阵容评分；当没有已核验游戏评分时，会构建明确标注为代理值的阵容/战术画像。如果身价或赔率缺失，预测流水线会排除缺失特征并报告降级。派生阵容评分必须标注为代理评分，不得说成官方 EA/SoFIFA 评分。

刷新所有赛前实时输入并重新预测：

```bash
node scripts/update-realtime-prematch-data.mjs
```

该脚本会检查赔率、天气、确认首发、伤病、身价和阵容/战术画像，并把逐场状态表写入 `data/manual/pre-match-update-status.csv`。如果设置了 `ODDS_API_KEY`，脚本会尝试调用 The Odds API 的世界杯接口，并写入 `data/manual/match-odds.csv`。如果比赛日期进入 Open-Meteo 预报窗口，会写入 `data/manual/match-weather.csv`。确认首发和伤病可通过 `data/manual/match-lineups.csv` 与 `data/manual/match-injuries.csv` 导入。缺失数据应保持为空，并在报告中说明降级。

合并外部 AI 候选数据前，先校验：

```bash
node scripts/validate-external-candidates.mjs --candidateDir C:\Users\wsq\Desktop\世界杯预测Skill_外部AI_数据补全_2026-05-20
```

该命令会在候选目录写入 `candidate-validation-report.md` 和 `candidate-validation-issues.csv`，不会修改 Skill 数据。带有 `source_partial`、`source_conflict`、`partial_proxy` 或 `needs_verification` 的行，在人工或可信来源确认前只能作为上下文。

安全合并已校验的外部候选批次：

```bash
node scripts/merge-external-candidates.mjs --candidateDir C:\Users\wsq\Desktop\世界杯预测Skill_外部AI_数据补全_2026-05-20 --suffix v3
node scripts/build-squad-tactical-profiles.mjs
node scripts/batch-predict-2026.mjs
node scripts/simulate-2026.mjs
node scripts/generate-report-2026.mjs
```

合并脚本会保留更强的既有来源，过滤有效名单冲突，把代理位置评分存入 `data/manual/squad-position-ratings.csv`，并把 `needs_verification` 行仅作为上下文保留。

7. 在信任权重前，必须用更大的历史数据重新回测。
8. 用最佳权重产出预测和解释。

## 赛前数据新鲜度规则

越接近开赛，预测质量理论上越高。每次预测前，都要更新不包含赛后信息的最新数据。每个人工值或抓取值都要记录 `updatedAt`、来源和抓取时间。

按时间窗口更新：

- 开赛前 30 天以上：只使用稳定基线数据。优先 Elo、FIFA 排名/积分、长期球队倾向、赛事分组、教练/风格备注、球队身价和游戏风格阵容评分。
- 开赛前 14 到 7 天：刷新名单、伤病、停赛、旅行/休息差和身价。未确认伤病只能作为报告提示，不能作为硬模型输入。
- 开赛前 72 到 24 小时：刷新赔率、可能首发、伤病状态、场地/天气和战术新闻。可靠市场开盘后，赔率成为最高优先级外部信号。
- 开赛前 24 到 3 小时：更频繁刷新赔率，检查确认缺阵、当地天气、裁判信息和最新阵容报道。用确认报道替换过期伤病和阵容备注。
- 开赛前 90 到 30 分钟：使用确认首发、替补、门将、阵型、最后赔率快照和最终天气。这是最强的赛前更新窗口。
- 开赛后：除非明确做实时预测，否则不得用比赛中事件更新赛前预测。任何标注为赛前回测的结果，都不能混入实时数据。

特征新鲜度优先级：

- 赔率：24 小时内最有价值，3 小时内更强，开赛前 30 到 90 分钟最好。
- 首发和门将：只有确认首发发布后才最强。
- 伤病/停赛：只有官方球队、赛事方或可靠新闻源确认时才使用；否则标记不确定。
- 天气和场地：24 小时内有用，3 小时内更强。
- FIFA/Elo/近期状态/身价/游戏评分：属于稳定基线；除非官方排名、名单或评分更新，不需要过度刷新。

如果多个来源冲突，优先使用最新且可靠的来源，旧值只保留为备注。如果无法核验，宁可留空，也不要编造。

## 推荐初始权重

```json
{
  "odds": 0.35,
  "elo": 0.25,
  "recentForm": 0.15,
  "marketValue": 0.10,
  "fifaPoints": 0.08,
  "injurySchedule": 0.07
}
```

如果 MVP 数据里没有伤病和赛程修正，就把 `injurySchedule` 的权重重新分配给 `odds`、`elo` 和 `recentForm`。

## 评估指标

至少始终报告：

- Log Loss
- Brier 分数
- 准确率
- 样本量足够时的校准说明

如果做投注策略，也可以报告 ROI，但不要只优化 ROI，因为它噪声很大。

## 报告风格

每场预测都应包含：

- 概率表
- 预测比分
- 爆冷风险
- 前 3 个主要驱动因素
- 一句简短的不确定性提示

足球解释必须基于已有特征。不要编造伤病、首发或战术新闻。

## 报告生成规则

### 球队名称

生成任何预测报告、可视化页面或海报时，**所有球队名称必须使用中文**，禁止出现英文队名。完整映射表见 `references/team-name-cn.md`（48 队中英文对照 + Python 快速替换代码）。

包括但不限于：赛程表、预测概率表、夺冠概率、小组出线、赔率对比、体彩推荐、战术分析备注中的队名。如果其他数据源（如 matchupNotes、tactical profiles）包含英文队名，必须在输出前统一替换。

⚠️ **matchupNotes 特别提醒：** 模型生成的 `matchupNotes` 字段（如 "France 的转换推进可能冲击 Japan 的防线"）使用英文队名。生成报告时必须在输出前对整段 notes 做全量替换，简单写法：
```python
for eng, ch in CN.items():
    notes = notes.replace(eng, ch)
```

#### 英文文本全量中文化

球队名替换后，报告中仍可能残留英文短语。三类常见残留及处理方法见 `references/cn-report-translation.md`：

1. **模型驱动因素**（`drivers` 字段）：如 "has the Elo edge (352 points)" → 用正则匹配替换为中文
2. **战术风格标签**（`styleTags` 字段）：如 "transition|compact|setPieces" → 映射为 "转换、紧凑、定位球"
3. **市场情绪方向**（`ahDirection` 字段）：如 "favor_favorite" → 翻译为 "看好让球方"

生成报告后搜索 `has the`、`favor_`、`Recent form`、`neutral-site` 等关键词确认无残留。

### 报告完整结构

#### ⚠️ 报告落盘规则（重要）

**execute_code 生成的报告内容必须立即写入文件。** 不能只靠 print() 输出到 stdout 让用户看到，因为：
- execute_code 的输出只在当前回合可见，用户看不到完整的报告内容
- 用户期望报告是持久化的文件，可以随时打开查阅
- 上次失败根因：报告在内存中生成了（29501 字符），但只 print 了头尾 300 字符就结束了，用户看到的是"什么都没发生"

**两步走：**
1. 在 execute_code 内用 `open(path, 'w')` 或 `hermes_tools.write_file()` 写到目标路径
2. 完成后通过 `read_file` 或 `terminal('head -50')` 展示预览给用户确认

**标准目标路径：**
- 主存档：`~/open-workspace/worldcup-prediction/2026-worldcup-full-report.md`
- 备份：`~/.hermes/skills/sports/worldcup-prediction/output/2026-worldcup-full-report.md`

一份完整的预测报告应包含以下章节：

1. **模型配置** — 版本号、训练/验证窗口、验证指标、模型系数、外部特征混合权重
2. **夺冠概率** — 48 队全量排行，含中文名、小组、各轮次概率、身价、FIFA积分
3. **小组出线概率** — 12 组逐组展示，每队第1/第2/第3晋级概率、均分、身价、FIFA
4. **赛程 & 逐场预测（含体彩推荐）** — 按日期分组，每场包含：
   - 胜平负概率 + 预测比分 + 置信度 + 爆冷风险
   - 双源赔率对比（The Odds API + Titan007，带差异 ▲▼标注）
   - 亚盘/大小球市场情绪
   - 实力对比（FIFA排名、身价、阵容评分）
   - 战术分析备注（队名须替换为中文）
   - **🎯 体彩推荐（嵌入每场）：**
     - 单场胜平负（SPF）：概率≥50%时给出方向
     - 让球胜平负（RQSPF）：概率≥65%或强弱悬殊时推荐
     - 比分推荐：3个最可能比分
     - 总进球推荐
5. **混合过关方案推荐** — 独立章节，分两个子板块：
   - 按比赛日分组推荐：每日≥2场可组合时，推荐2串1/3串1 + 稳胆推荐
   - 跨日优选方案：全场最高概率Top 10 + 4串1旗舰方案 + 2串1优选方案
6. **数据来源说明**

**体彩推荐逻辑：**
- 单场胜平负仅在最高概率 ≥ 50% 时给出方向
- 让球胜平负在概率 ≥ 65% 或强弱悬殊时推荐
- 概率不明时（最高仅 35-49%），提示"倾向不明显，建议关注让球方向"
- 混合过关仅精选置信度高的场次
- 表中字段"FIFA积分"指国际足联排名积分（FIFA Points），不是排名位次

### 同步到飞书文档

Pipeline 跑完后，可自动将报告内容同步到飞书文档（替代手动传文件）。依赖 `lark-cli` 工具（需提前配置好）。

```bash
# 完整预测报告
cat ~/open-workspace/worldcup-prediction/2026-worldcup-full-report.md | lark-cli docs +update --doc <完整报告_token> --mode overwrite --markdown - --as bot

# 赛后验证报告
cat <skill_dir>/output/post-match-verification.md | lark-cli docs +update --doc <赛后验证_token> --mode overwrite --markdown - --as bot

# 竞彩推荐方案
cat <skill_dir>/output/jingcai-recommendations.md | lark-cli docs +update --doc <竞彩方案_token> --mode overwrite --markdown - --as bot
```

**⚠️ 权限限制：** lark-cli bot 身份可创建/更新文档，但无法自动为用户添加访问权限。用户在飞书里打开文档链接后，可在分享菜单中手动将 bot 添加为协作者，后续更新即可自动同步。

**文档 tokens 存储：** 记在 memory 中以便后续使用。同步前先通过 `session_search` 或 memory 查找已存储的 doc tokens。

生成 HTML 可视化页面时也须遵循中文队名规则，且页面中不应出现"博彩"等敏感字眼，改用"赔率分析""市场数据""体彩推荐"等表述。

### 报告格式规则（用户偏好）

1. **标题不加竞彩代码：** `#### 墨西哥 vs 南非` — 不要写成 `#### 周四001 墨西哥 vs 南非`
2. **过关方案不加场次编号：** 只显示对阵 + 方向 + 概率，不显示 `周四001` 或 `2026-WC-GS-001`
3. **日期用中国时区（UTC+8）：** 对竞彩赛事，分组日期使用 `jingcai-schedule.json` 中的 `date` 字段（已反映中国体彩的日期归类），而非模型的 FIFA 日期
4. **每场显示北京开赛时间：** 匹配信息中加入 `开赛：MM-DD HH:MM`（来自竞彩赛程的 `time` 字段）
5. **用竞彩映射获取中国日期：**
   ```python
   def get_jc(p):
       for jc in jc_schedule:
           he = cn_to_en.get(jc['home'], jc['home'])
           ae = cn_to_en.get(jc['away'], jc['away'])
           if he == p['homeTeam'] and ae == p['awayTeam']: return jc
       return None
   def china_date(p):
       jc = get_jc(p)
       return jc['date'] if jc else p['date']
   ```
6. **队名别名：** 竞彩赛程可能使用缩写或变体队名。已知别名：
   - `乌兹别克` → `Uzbekistan`（完整名：乌兹别克斯坦）
   - `刚果金` → `DR Congo`（引擎用 `刚果(金)`，竞彩无括号）
   ```python
   cn_to_en['乌兹别克'] = 'Uzbekistan'
   cn_to_en['刚果金'] = 'DR Congo'
   cn_to_en['刚果(金)'] = 'DR Congo'  # 两个变体共存
   ```
   完整队名别名表见 `references/team-name-aliases.md`。

### 简化报告格式规则（本会话新增）

用户要求出简洁报告时使用以下格式规范：

1. **时间格式：** 只保留日期（`MM-DD`），不显示 `HH:MM`。表格列名用「比赛日期」。
2. **排序规则：** 历史预测和未来预测表格**按时间升序排列**。体彩推荐的三个子表（SPF/RQSPF/比分）同样按时间排序，不做按概率排序。
3. **双模型命名：** 提到两个模型时用方法论名而非代称——「多因子模型」和「xG模型」。分歧提示写为 `⚠分歧:多因子XX vs xGXX`，不写 `我们XXvs泊松XX`。
4. **最后一天完整显示：** 未来预测表格须确保竞彩赛程中最后一天的比赛全部显示，不截断。缺失场次通常是队名映射遗漏。
5. **值得关注列指标说明：** 表格后必须附指标说明小节，解释「高/中/低置信」「爆冷风险」「xG:XX% T1/T2/T3」「⚠分歧」等标记的含义。
6. **单场胜平负仅显示 ≥50% 场次**，让球仅显示 ≥65% 场次。
7. **混合过关方案**优先推荐双模型一致 + 高置信度的场次组合，联合概率标注在方案描述中。

### 报告生成脚本的 Python 陷阱

**变量名覆盖：** 在 execute_code 的长脚本中，短变量名很容易被后续循环误覆盖。已知事故：

| 变量 | 用途 | 被谁覆盖 | 后果 |
|------|------|---------|------|
| `d` | 平局概率 `float(p['draw'])` | 驱动因素循环 `d = drv.strip()` | 所有比赛的平局概率显示为驱动因素文字，`max(hw, d, aw)` 报 `TypeError` |

**预防：**
- 不要在同一个作用域内用 `d` / `a` / `s` 等短名做两种事
- 驱动因素遍历用 `drv_cn` 而非 `d`
- `away_en` / `away_cn` 而非 `a` 或 `ae`
- CSV 列名未知时先 `print(list(reader.fieldnames))`

### ⚠️ generate-report-2026.mjs 模板文本陷阱

`generate-report-2026.mjs` 在报告头部硬编码了一段文本：

```
当前批量运行的 72 场比赛没有真实赛前赔率；可用时使用 FIFA、Elo、近期状态、身价和派生阵容/战术代理值。
```

**这段文本在导入 Titan007 全量赔率后是错的。** 只要跑了 `import-titan007-odds.mjs`（72/72 场），赛前赔率就是可用的。报告生成脚本不会自动检测赔率状态来切换文案。

**修复方法：** 生成报告后用 patch 替换头部文本。正确内容（含实际权重和赔率来源说明）：

```
## 模型配置

- **模型版本：** 多因子加权概率模型（已校准 softmax）
- **特征权重：** odds=0.35, elo=0.25, recentForm=0.15, marketValue=0.10, fifaPoints=0.08, injurySchedule=0.07
- **赔率来源：** Titan007 共识赔率（93~200家公司/场）覆盖 72/72 场 + The Odds API（~30家公司）覆盖 39/72 场
- **淘汰赛概率：** 20000 次蒙特卡洛模拟，32强交叉映射基于高种子对低种子的启发式规则
- **名单公布行：** 只用于阵容新鲜度上下文，不代表确认首发、伤病或比赛日可用性
```

**排查：** 报告头部如果出现"没有真实赛前赔率"字样，就是脚本模板没替换。先确认是否已导入 Titan007 赔率，已导入则直接 patch 头部文字。

### ⚠️ 报告模型配置段落验证（重要）

preflight 内置的 `generate-report` 会在报告开头写一段模型提示：

```
当前批量运行的 72 场比赛没有真实赛前赔率
```

**这是错误的。** Titan007 赔率在 preflight 之后已导入 72/72 场。报告生成后必须检查并修正这段：

1. 报告头部 `## 模型提示` 应改为 `## 模型配置`
2. 删掉"没有真实赛前赔率"这句
3. 替换为实际内容：特征权重、赔率来源（Titan007 覆盖 72/72 + Odds API 覆盖 39/72）、模拟次数等

标准替换文本：

```markdown
## 模型配置

- **模型版本：** 多因子加权概率模型（已校准 softmax）
- **特征权重：** odds=0.35, elo=0.25, recentForm=0.15, marketValue=0.10, fifaPoints=0.08, injurySchedule=0.07
- **赔率来源：** Titan007 共识赔率（93~200家公司/场）覆盖 72/72 场 + The Odds API（~30家公司）覆盖 39/72 场
- **淘汰赛概率：** 20000 次蒙特卡洛模拟，32强交叉映射基于高种子对低种子的启发式规则
- **名单公布行：** 只用于阵容新鲜度上下文，不代表确认首发、伤病或比赛日可用性
```

### 🧪 报告验证清单（补充）

除正文中的验证检查外，额外检查：

...
- **模型配置段落：** 确保没有"没有真实赛前赔率"这个错误描述
- **赛后验证完整性：** `post-match-update.py` 可能遗漏部分比赛，手动比对已完赛场次列表

`match-odds.csv` 同时存放 The Odds API 和 Titan007 两个来源的赔率行，通过 `bookmaker` 字段区分：
- `the-odds-api consensus average` — Odds API 数据（~40/72 场）
- `titan007 consensus average` — Titan007 共识赔率（~71/72 场）

`update-realtime-prematch-data.mjs` 的 `writeCsv` 使用**合并模式**写入，key = `date|homeTeam|awayTeam|bookmaker`，同 key 新行覆盖旧行。两个源的 bookmaker 值不同，互不干扰。

**不要**把 `writeCsv` 改回简单覆盖模式，否则跑一次 preflight 就会清掉 Titan007 数据。两个脚本写入同一文件：
- `update-realtime-prematch-data.mjs` — 合并模式写入 Odds API 行
- `import-titan007-odds.mjs` — 追加模式写入 Titan007 行

### 欧赔双源

| 数据源 | 覆盖 | 公司数 |
|--------|------|--------|
| The Odds API | 40/72 场 | ~30 家 |
| Titan007 共识 | 71/72 场 | 93~187 家/场 |

```bash
node scripts/import-titan007-odds.mjs
```

### ⚠️ import-titan007-odds.mjs 换行符陷阱（已修复）

该脚本以 `append` 模式写入 `match-odds.csv`：
```js
writeFileSync(path, (existingEndsWithNewline ? existing : existing + "\\n") + newRows.join("\\n") + "\\n");
```

**旧版 bug：** 如果 `match-odds.csv` 末尾没有换行符（例如 preflight 的 writeCsv 写入后），`existing + newRows.join(...)` 会把新行的第一行直接黏在 CSV 最后一行末尾，整行变成 17 字段（列名是 9 字段），导致该行被 CSV 解析器忽略，那场比赛的 Titan007 数据就丢了。

**实际后果：** 首场比赛（墨西哥 vs 南非）的 Titan007 赔率被黏在了上一行 sourceUrl 字段末尾，72 场变 71 场。

**排查方法：** 如果发现 Titan007 显示 71/72 场，检查 `match-odds.csv` 中是否有某行的逗号数远多于正常行（9 字段/行）。修复命令：
```bash
sed -i '' 's/\.js2026-/\.js\\n2026-/g' data/manual/match-odds.csv
```

### 双源赔率显示与差异标注

报告中每场比赛的赔率对比应按此格式呈现：

1. **Titan007 行在前**（覆盖更广，93~199家）
2. **Odds API 行在后**（~30家，作为交叉验证）
3. **模型概率行在末**（方便读者对比市场 vs 模型）
4. **差异提示**：当两个来源在同一方向的赔率差 > 2% 时，标注 ▲（Titan007 更高）或 ▼（Titan007 更低），如 `客胜: ▼6%`

```python
# Python 差异计算示例
t_h, o_h = float(titan['homeOdds']), float(oddsapi['homeOdds'])
diff = ((t_h - o_h) / o_h) * 100
if abs(diff) > 2:
    arrow = '▲' if diff > 0 else '▼'
    print(f"差异：主胜方向 {arrow}{abs(diff):.0f}%")
```

差异 > 5% 说明两个市场存在实质性分歧，报告中应补充解读。Titan007 的 `companiesCount` 字段显示该场次参与的公司数（93~199 家不等），可以作为数据可信度的参考。

### 亚盘/大小球市场情绪

从 Titan007 盘口页面提取每场比赛的庄家行为数据，输出市场情绪报告：

```bash
node scripts/adjust-with-ah-ou.mjs
```

输出文件：
- `output/match-predictions-ah-enhanced.csv` — 72 场亚盘/大小球数据
- `output/ah-ou-market-report.md` — 市场情绪报告

### 竞彩数据管线（波胆 + 让球胜平负）

**核心接口：** 竞彩官网 `webapi.sporttery.cn` 有开放 JSON API（不带 token，加 Referer 头即可），两个 poolCode：

| poolCode | 数据 | 状态 |
|----------|------|------|
| `crs` | 波胆（31种正确比分赔率） | ✅ 开放，HTTP 200 |
| `hhad` | 让球胜平负（让球数 + 三方向赔率） | ✅ 开放，HTTP 200（需 +Referer 头） |

**⚠️ 让球 API（hhad）需要 Referer 头：** 不加 `Referer: https://www.sporttery.cn/jc/jsq/zqbf/` 会返回 HTTP 403 WAF 拦截。`crs` 不需要。

**队名：** 返回中文队名（"巴西"、"刚果(金)"）。详见 `references/team-name-cn.md` 的 EN_TO_CN 映射。

**两步管线：**

```bash
# Step 1: 拉取全量数据（波胆 + 让球同时获取）
python3 scripts/fetch-jingcai-odds.py
# 输出: data/jingcai-odds.json（20场世界杯，每场31种比分赔率 + 让球数据）

# Step 2: 合并到预测数据
python3 scripts/apply-jingcai-scores.py
# 更新: match-predictions-2026.json（predictedScore + jingcaiScoreOdds + jingcaiHandicap）
```

**三合一 wrapper（fetch + apply + 报告生成）：**
```bash
bash scripts/run-score-odds-pipeline.sh
```

输出：
- `data/jingcai-odds.json` — 原始竞彩数据（波胆+让球）
- `match-predictions-2026.json` — 已更新预测数据
- `jingcai-recommendations.md` — Markdown 报告
- `reports/YYYYMMDD/betting-report.html` — HTML 报告

**混合比分逻辑：** 模型计算胜负平方向（home/draw/away）→ 在该方向下筛选竞彩比分池 → 取赔率最低的作为 predictedScore。

**让球数据字段（`jingcaiHandicap`）：**
| 字段 | 类型 | 说明 |
|------|------|------|
| `goalLine` | int | 让球数（负=主队让球，正=主队受让） |
| `goalLineDesc` | str | 中文描述（"让3球" / "受让2球"） |
| `homeOdds` | float | 让球后主胜赔率 |
| `drawOdds` | float | 让球后平赔率 |
| `awayOdds` | float | 让球后客胜赔率 |
| `recommendation` | str | 推荐选项（"让球胜"/"让球平"/"让球负"） |
| `bestOdds` | float | 推荐选项的对应赔率 |

**推荐逻辑：** 取让球后三方向中赔率最低的选项作为推荐。不依赖模型方向（让球推荐和方向推荐是独立维度）。

**队名映射：** 竞彩数据返回中文队名。`apply-jingcai-scores.py` 内嵌 `EN_TO_CN` 映射表（48队）。已知别名：`乌兹别克`→`乌兹别克斯坦`、`刚果金`→`刚果(金)`。

**定时任务：** 每天北京时间 10:00 自动执行（cron ID: 80d61678234b），调用 `run-score-odds-pipeline.sh`。

**保留的旧脚本：** `fetch-jingcai-score-odds.py`（仅波胆）已废弃，被 `fetch-jingcai-odds.py`（波胆+让球合并）替代。

### 数据文件

- `data/manual/titan007-match-ids.csv` — 72 场 ID 映射表（⚠️ 无 date 字段，需从 fixtures 查）
- `data/manual/jingcai-schedule.json` — 24 场竞彩赛程

### ⚠️ Titan007 日期传入陷阱

`titan007-match-ids.csv` 没有 `date` 列。`import-titan007-odds.mjs` 在写入 `match-odds.csv` 时，通过 `homeTeam|awayTeam` 从 `wc26-official-group-stage.csv` 查日期。

**如果 `import-titan007-odds.mjs` 写入的行 date 字段为空**，说明赛程文件路径不对或队名匹配失败。预测管线按 `date|homeTeam|awayTeam` 匹配赔率，空日期永远匹配不上，Titan007 数据等于没用上。

排查：检查 `data/manual/match-odds.csv` 里 Titan007 行首的日期字段是否为空。

### 🧩 辅助数据源（低权重，仅供报告参考）

以下文件不在预测管线中使用，但 LLM 撰写报告时可查阅以丰富球队画像、战术分析和球员维度的描述：

| 文件 | 内容 | 用途 |
|------|------|------|
| `data/manual/player-database.csv` | 1248 名球员明细（位置、年龄、身高、出场、进球、俱乐部、联赛、身价） | 阵容深度、核心球员、位置轮换分析 |
| `data/manual/position-analysis.csv` | 48 队 GK/DF/MF/FW 人数 + 各位置平均身价 + 平均年龄 | 位置结构对比、战术对位分析 |
| `data/manual/elo-recent-form.csv` | 48 队 Elo 评分 + 近 10 场战绩（结构化） | 注：Elo/form 管线已有更准确数据，此文件为 Excel 快照备用参考 |
| `data/manual/golden-boot-predictions.csv` | 80 名射手预测（xG/90、预期出场、预测总进球） | 金靴争夺、球员叙事 |

### 赛后验证自动链路脚本

| 脚本 | 用途 |
|------|------|
| `scripts/post-match-update.py` | 全自动赛后链路入口：验证 → 同步 → Elo重建 → 重预测 → 重模拟 → 重报告 |
| `scripts/sync-worldcup-results.mjs` | 将 prediction-log.json 的已验证赛果写入 data/results.csv，供主模型 build-elo-form 使用 |
| `scripts/fetch-jingcai-odds.py` | ⭐ 拉取竞彩数据（波胆31种比分赔率 + 让球胜平负3方向赔率），替代旧版抓取+硬编码阈值 |
| `scripts/apply-jingcai-scores.py` | 混合比分预测（模型方向 + 竞彩波胆）+ 让球数据合并（goalLine, odds, recommendation） |
| `scripts/run-score-odds-pipeline.sh` | fetch + apply 二合一 wrapper |

**使用原则：**
- 这些数据**不是**预测模型的特征输入，仅作为 LLM 撰写报告时的背景上下文
- 优先级低于模型输出和官方数据，仅在需要丰富描述、举例说明时翻阅
- `elo-recent-form.csv` 中的 "预估" 状态行（30 队）需在报告中注明为参考性质
- 可用 `scripts/auxiliary-squad-analysis.py` 一键生成 squad 维度的辅助分析报告

### ⚠️ 读取 CSV 文件的常见列名陷阱

CSV 列名速查表见 `references/reading-csv-columns.md`（包含 match-odds / match-weather / team-tactical-profiles / team-strength / elo-recent-form 五个文件的实际列名和常见错误）。

**高频踩坑：** 本 skill 的三个 CSV 文件的列名与"直觉"不同：
1. `match-odds.csv`：查 `homeOdds` 不是 `homeWin`
2. `match-weather.csv`：查 `temperatureMaxC` 不是 `tempC`
3. `team-tactical-profiles.csv`：查 `styleTags` 不是 `tacticalStyle`

快速确认列名的方法：
```python
with open('data/manual/match-odds.csv') as f:
    print(list(csv.DictReader(f).__next__().keys()))  # 打印实际列名
```

**天气数据（match-weather.csv）：** 列名 `temperatureMaxC` / `temperatureMinC` / `precipitationMm` / `windMaxKmh`（不是 `tempC` / `condition` / `precipMM` / `windSpeed`）

**赔率数据（match-odds.csv）：** 列名 `homeOdds` / `drawOdds` / `awayOdds`（不是 `homeWin` / `draw` / `awayWin`）。`bookmaker` 区分来源。

**球队实力（team-strength.csv）：** 列名 `marketValueEur`（不是 `marketValueEUR`，大小写敏感）。其他列：`fifaRank` / `fifaPoints` / `squadRating`。

**常见错误：** execute_code 脚本查了不存在的列名会静默返回 `None`，导致报告中显示 `?` 或空值。读取 CSV 后务必 `print(list(rows[0].keys()))` 确认实际列名。

### 📊 可视化仪表盘生成

完整报告和可视化页面的生成指南见 `references/report-generation.md`。核心模式是用 `execute_code` 里的 Python 脚本一次性读取所有数据文件，内联生成自包含的 HTML 或 Markdown 文件。

**生成后必须写文件，不能只 print()** — 见上方「报告落盘规则」⚠️。每次写文件后用以下步骤验证完整性：

```python
import os
# 1. 大小检查
fs = os.path.getsize(path)
assert fs > 10000, f"报告太小：{fs} bytes"

# 2. 章节完整性检查
required = ['模型配置', '夺冠概率', '小组出线', '逐场预测', '混合过关', '数据来源']
content = open(path).read()
for section in required:
    assert section in content, f"缺少章节：{section}"

# 3. 数据完整性检查
titan_rows = [l for l in content.split('\\n') if 'Titan007' in l and '|' in l]
api_rows = [l for l in content.split('\\n') if 'The Odds API' in l and '|' in l]
print(f"Titan007 赔率行: {len(titan_rows)}")  # 应 ≈ 72
print(f"Odds API 赔率行: {len(api_rows)}")    # 应 ≈ 40
```

**目标路径：**
- **桌面宽屏版：** `~/open-workspace/worldcup-prediction/2026-worldcup-dashboard.html`
- **小红书竖屏版（1080px）：** `~/open-workspace/worldcup-prediction/2026-worldcup-dashboard-mobile.html`
- **完整 MD 报告（含体彩推荐+混合过关方案）：** `~/open-workspace/worldcup-prediction/2026-worldcup-full-report.md`

刷新数据后需重新生成，不支持动态加载。

**设计规范（用户偏好）：**
- 报告和页面中所有球队名称必须使用中文（英文名仅作为辅助标注）
- 双数据源赔率并排显示，差异用 ▲▼ 标注
- 不出现"博彩"字眼，改用"赔率分析/市场数据/体彩推荐"
- 每场比赛显示两队 FIFA 排名、身价、阵容评分

## 参考文件索引

| 文件 | 内容 |
|------|------|
| `references/schema.md` | 比赛行数据结构和字段定义 |
| `references/data-sources.md` | 数据源选择指南 |
| `references/model-calibration.md` | 已校准模型说明 |
| `references/team-name-cn.md` | 48 队中英文对照映射表 |
| `references/team-name-aliases.md` | 跨数据源队名别名陷阱（竞彩/引擎/预测三方变体） |
| `references/draw-underprediction-diagnosis.md` | ⭐ 平局系统性低估：根因链、诊断 6 步、hotfix 记录、修复选项、weight-search 陷阱 |
| `references/reading-csv-columns.md` | CSV 列名速查 |
| `references/report-generation.md` | 完整报告和可视化生成指南 |
| `references/wc26-knockout-bracket-rules.md` | 淘汰赛对阵规则 |
| `references/external-odds-integration.md` | 外部赔率数据整合通用模式（The Odds API, Titan007, 体彩网 ) |
| `references/external-model-validation.md` | 外部模型交叉验证集成笔记（API 陷阱、队名映射、Sailing 实测） |
| `references/completed-matches-2026.md` | 已完赛场次记录（日期、比分、模型验证结果） |
| `references/post-match-workflow.md` | 赛后验证与简化报告工作流（格式规范、陷阱、脚本） |
| `references/jingcai-correct-score-odds.md` | ⭐ 竞彩数据采掘方案（波胆 API 接口、CRS 映射表、HHAD 让球数据、队名陷阱、脚本用法、集成方式） |

## 外部模型交叉验证

### worldcup-analyzer (jiajielitong.com ML 模型)

独立的国家队比赛预测 API，基于球员实力、教练水平、俱乐部评分等多维 ML 模型。作为我们多因子模型的第二意见源。

**API 限制：**
- Agent 临时 key 每天 2 次免费预测
- 同一组主客队 3 天内重复查询不消耗额度
- 永久 key 需在 https://www.jiajielitong.com 注册

**校验脚本：**
```bash
python3 scripts/external-model-validate.py [max_calls]
```

**输出文件：**
- `output/external-validation-results.json` — 逐场校验结果
- `output/external-validation-report.md` — 双模型对比报告

**Cron 自动攒数据：**
- Job ID: `09d703792fef`，每天 10:00 跑 2 场
- 15 场队列跑完约需 8 天

**集成到报告：**
生成完整报告时，读取 `external-validation-results.json`，在每场预测下方标注外部模型校验结果（一致 ✅ / 分歧 ❌ / 待校验 ⏳）。

⚠️ **API 陷阱：** 当后端刮取 Transfermarkt 球员数据失败（HTTP 405），错误信息会泄漏到 `results.win_or_not` 字段（显示为 "405: Client Error..."），但 `code` 仍为 200。校验脚本需检查 `win_or_not in ("Win", "Draw", "Loss")`，否则视为异常。详见 `references/external-model-validation.md`。

⚠️ **端点变更（2026-06-14）：** `/matches/predict/` 改为 `/matches/simulate/`（SoccerAssess 品牌升级）。`wc_client.py` 已修复。未更新前始终 404。同时临时 key 增加了文件持久化（`output/.agent_temp_key.json`），解决跨进程丢失问题。

### Sailing Skill（赛灵体育 MCP）

腾讯赛灵体育实时数据服务，通过 mcporter 调用。用于比赛期间的实时比分验证和交手记录查询。

**配置：**
- mcporter 已注册为 `sailing-sports-mcp`
- Token: 已配置在 `~/.mcporter/mcporter.json`

**使用示例：**
```bash
# 查今日世界杯比赛
mcporter call sailing-sports-mcp tteagt --args '{"query": "今天世界杯比赛", "project": "FBL"}'

# 查两队交手记录
mcporter call sailing-sports-mcp tteagt --args '{"query": "西班牙和法国历史交手记录", "project": "FBL"}'
```

**用途：**
- 比赛日拉实时比分，验证预测准确度
- 查询历史交手记录，丰富报告战术分析
- 注意：不提供赔率或预测能力，仅作数据补充

### 泊松xG 模型（Poisson Engine）

从 football-match-analysis skill 提取的 Elo + 泊松分布预测引擎，作为第三校验源。与我们的多因子模型和 worldcup-analyzer ML 模型形成三模型交叉验证体系。

**方法论：** Elo(0.30) + 泊松xG(0.70) + 16 修正因子

**数据文件：**
- `data/external/poisson-elo.json` — 48 队 Elo 评分（中文队名）
- `data/external/poisson-team-stats.json` — 48 队场均进球/失球
- `data/external/poisson-corrections.json` — 16 个修正因子参数库

**集成脚本：**
```bash
python3 scripts/poisson-integration.py
```

**输出文件：**
- `output/poisson-crosscheck.json` — 72 场三模型对比数据
- `output/poisson-crosscheck-report.md` — 交叉验证报告（含一致率、分歧场次、爆冷分析、赔率价值信号）
- `output/poisson-value-detection.json` — 赔率偏差检测结果

**爆冷分析三层判据（已集成到报告）：**

| 层级 | 因子 | 幅度 | 触发条件 |
|------|------|------|---------|
| 风格克制 | 铁桶克攻强守弱 | +4% | 强队场均进球>1.8 且失球>0.9，弱队失球<0.9 |
| 风格克制 | 反击克控球 | +3% | 弱队进球>1.3 且失球<1.0，强队进球>2.0 |
| 状态变量 | 内讧 | -4% | 强队更衣室矛盾 |
| 状态变量 | 核心伤缺 | -3% | 强队核心球员缺阵 |
| 状态变量 | 慢热 | +2% | 强队历来小组赛慢热 |
| 赛制红利 | 首轮不确定 | +3% | 小组首轮，双方未进入状态 |
| 赛制红利 | 末轮轮换 | +6% | 强队锁定出线后轮换主力 |
| 赛制红利 | 48队扩军 | +3% | 弱队容错率高，求胜欲强 |

**爆冷等级：** Tier1(≥40%) / Tier2(≥30%) / Tier3(≥20%)

**赔率价值检测：** 模型概率 vs 市场隐含概率（去水后），偏差 ≥3% 标记为价值信号。双模型（我们 + 泊松）同时标注。

**⚠️ 队名映射陷阱：** 引擎用中文队名（"波黑"、"刚果(金)"），我们预测数据用英文全名（"Bosnia and Herzegovina"、"DR Congo"）。集成脚本 `poisson-integration.py` 内维护完整映射表，新增球队需同步更新。

**⚠️ 数据加载陷阱：** 引擎的 `load_data()` 硬编码查找 `elo_ratings.json` 和 `team_stats.json`，我们的文件已重命名为 `poisson-elo.json` / `poisson-team-stats.json`。已在 `data/external/` 下创建符号链接解决。如果重新部署，需重建链接：
```bash
cd data/external && ln -sf poisson-elo.json elo_ratings.json && ln -sf poisson-team-stats.json team_stats.json
```

### 赛后验证与报告

### 赛后数据更新流程（全自动链）

每轮比赛结束后，只需一步：

```bash
python3 scripts/post-match-update.py
```

该脚本自动执行以下完整链路：

1. **赛后验证** — 自动扫描 `match-predictions-2026.json`，找出已完赛但未验证的场次
2. **拉取赛果** — 通过 Sailing MCP 获取实际比分（支持中文队名 "加拿大 1:1 波黑" 格式）
3. **更新 Poisson 模型** — 更新 `poisson-elo.json`（K=32 Elo）+ `poisson-team-stats.json`
4. **同步主模型** — 调用 `sync-worldcup-results.mjs`，将赛果写入 `data/results.csv`
5. **重建特征** — 重新运行 `build-elo-form.mjs`，更新 48 队的 Elo + 近 10 场状态
6. **重新预测** — `batch-predict-2026.mjs` 基于最新 Elo/Form 重新预测剩余比赛
7. **重新模拟** — `simulate-2026.mjs` 20000 次蒙特卡洛模拟
8. **重新出报告** — `generate-report-2026.mjs` 生成完整预测报告

**不再需要手动维护 prediction-log.json。** 赛果暂未获取到的场次标记为 ⏳ 待更新，下次运行会自动补齐。

#### ⚠️ Sailing MCP 失效时的手动回退方案

Sailing MCP 有每日 token 额度限制，超出后会返回 0 条结果。这种时候需要手动拉取赛果并更新管线。

**手动回退步骤：**

```bash
# 1. 从 web_search 获取实际赛果（Yahoo Sports / ESPN / Fox Sports）
#    搜索结果通常包含 "FINAL: Switzerland 1, Qatar 1" 格式
#    注意区分 home/away：Yahoo 按字母序排列不代表主客队顺序

# 2. 手动更新 prediction-log.json 和 match-predictions-2026.json：
#    - 准备一个 Python 脚本，把赛果写入 prediction-log.json
#    - 同时更新 match-predictions-2026.json 的 actualScore 字段
#    - 更新 poisson-elo.json（K=32 Elo 公式）和 poisson-team-stats.json

# 3. 同步到主模型 + 重建 Elo + 重预测（每步依次执行）：
node scripts/sync-worldcup-results.mjs
node scripts/build-elo-form.mjs
node scripts/batch-predict-2026.mjs
node scripts/simulate-2026.mjs
node scripts/generate-report-2026.mjs

# 4. 修复报告头部（generate-report-2026.mjs 有模板文本陷阱，详见下方）
#    然后拉取竞彩数据
python3 scripts/fetch-jingcai-odds.py
python3 scripts/apply-jingcai-scores.py
python3 scripts/generate-betting-report.py
```

**手动回退的 prediction-log.json 写入格式（含 actual_home_goals 字段）：**

```python
log.append({
    "match": "Qatar vs Switzerland",
    "date": "2026-06-13",
    "stage": "小组赛第1轮",
    "actual_score": "1-1",
    "actual_home_goals": 1,
    "actual_away_goals": 1,
    "actual_outcome": "平局",
    "our_prediction": {
        "direction": "客胜",
        "homeWin": 0.0734,
        "draw": 0.1378,
        "awayWin": 0.7888,
        "predicted_score": "0-2",
        "confidence": "high"
    },
    "verdict": {
        "our_direction": "❌",
        "our_score": "—",
        "notes": "预测客胜(79%)，实际1-1平局"
    }
})
```

**注意 `actual_home_goals` 新旧格式兼容：** 旧版 prediction-log.json 条目没有 `actual_home_goals`/`actual_away_goals` 字段，只有 `actual_score` 字符串（如 "2-0"）。Elo 更新循环需兼容两种格式：
```python
if "actual_home_goals" in r:
    hg = r["actual_home_goals"]
    ag = r["actual_away_goals"]
else:
    parts = r["actual_score"].split("-")
    hg = int(parts[0]) if parts[0].isdigit() else 0
    ag = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
```

#### ⚠️ post-match-update.py 已知陷阱

| 陷阱 | 现象 | 原因 | 修复状态 |
|------|------|------|---------|
| Sailing MCP 零结果 | 返回 0 场赛果 | 每日 token 额度用尽 | 使用上方手动回退方案 |
| 今天的比赛被误标为"已完赛" | June 14 比赛被标记为 ⏳ | `find_missing_matches` 用 `date+3h` 判断，但 date 是午夜 00:00，当天下午即触发 | ✅ 已修复：改用 `kickoffLocal+3h`，无精确时间时用 `date+22h` |
| old-format entries 导致 KeyError | Elo 更新时报 `KeyError: 'actual_home_goals'` | 旧版日志条目只有 `actual_score` 字符串字段 | ✅ 已修复：Elo 循环兼容两种格式 |

### 比分预测逻辑（predictedScore）— 本质是硬编码阈值映射

`predict-match.mjs`（及 `weight-search.mjs`）中的 `predictedScore()` 函数**不是模型输出的比分**，而是把胜平负概率通过 if-else 阈值表硬编码映射到9种比分。模型本身不知道 2-0 和 1-0 的区别——它只算了胜率，比分是后挂上去的。

| 指标 | 区间 | 主场 | 客场 |
|------|------|:----:|:----:|
| 平局 | 概率最高 或 ≥25% 或 ≥22%且胜率差<10% | 1-1 | 1-1 |
| 绝对碾压 | fave > 78% | 3-0 | 0-3 |
| 明显占优 | fave > 65% | 2-0 | 0-2 |
| 略占上风 | fave > 52% | 2-1 | 1-2 |
| 微弱优势 | fave ≤ 52% | 1-0 | 0-1 |

**⚠️ 局限（重要）：**
- 本质是「概率区间→固定比分」，不是真正的比分预测模型。用户评价：**"单纯的简单计算"**。
- 只有9种比分，永远预测不出 4-0、4-1、0-0（除非平局条件触发）等常见赛果
- `fave` 本身是概率估算值，如果模型低估了优势方（如美国vs巴拉圭仅估47%胜率），那映射出来的比分必然是保守的1-0，不可能出现4-1
- 美国4-1的实际赛果暴露了根因：**问题不在映射逻辑，在概率估算系统**（特征权重、赔率输入、Elo参数）低估了胜率

**⚠️ 平局系统性低估（详见 `references/draw-underprediction-diagnosis.md`）：** 模型平局概率均值 ~20%，全 72 场无平局方向预测。根因链：drawBias 过负（-0.15）→ softmax 压缩平局 logit → 赔率融合二次压缩 → predictedScore 阈值 0.28 不可达。2026-06-15 两轮 hotfix 后 predictedScore=1-1 从 0→20 场，平局均值 21.9%，但方向预测仍为 0。完整修复需跑逻辑回归重拟合。

**✅ 竞彩数据采掘脚本已就绪（波胆 + 让球双管线）**  
**2026-06-13 升级为混合模式**：不再是简单取最低赔率比分，而是 **模型方向 + 竞彩比分过滤**：

```
模型概率 (homeWin/draw/awayWin) → 判断胜负平方向
     ↓
在该方向下找竞彩赔率最低的比分
     ↓
写入 predictedScore + 附带 jingcaiScoreOdds 全量数据 + jingcaiHandicap 让球数据
```

同时拉取的让球胜平负数据（`poolCode=hhad`）写入 `jingcaiHandicap` 字段：
```json
{
  "goalLine": -1,
  "goalLineDesc": "让1球",
  "homeOdds": 2.70,
  "drawOdds": 3.26,
  "awayOdds": 2.21,
  "recommendation": "让球负",
  "bestOdds": 2.21
}
```
推荐逻辑：让球后三方向中赔率最低的选项。不依赖模型方向（独立维度）。

```bash
python3 scripts/fetch-jingcai-odds.py          # 拉取全量（波胆+让球）
python3 scripts/apply-jingcai-scores.py        # 混合合并到预测数据
python3 scripts/generate-betting-report.py     # 生成Markdown+HTML报告
```

三个脚本一起跑，每天 10:00 自动执行 cron job（ID: 80d61678234b）。

输出：`data/jingcai-odds.json`（20场世界杯比赛，每场31种比分赔率 + 让球数+赔率）
更新：`match-predictions-2026.json`（predictedScore + jingcaiScoreOdds + jingcaiHandicap 字段）

详见 `references/jingcai-correct-score-odds.md`。

### 简化预测报告格式

用户要求出简洁报告时，使用两章结构，以竞彩赛程（`jingcai-schedule.json`）为基准：

**第一章：历史预测** — 已完赛场次
| 比赛日期 | 对阵 | 预测方向 | 预测比分 | 实际赛果 | 实际比分 | 命中 |

**第二章：未来预测** — 未开场次
| 比赛日期 | 对阵 | 预测方向 | 预测比分 | 值得关注 |

**格式规则：**
- 对阵以竞彩定义为准（中文队名，`jc['home'] vs jc['away']`）
- 比赛日期用竞彩 `time` 字段（`MM-DD HH:MM` 格式）
- 预测方向格式：`主胜（主XX% 平XX% 客XX%）`
- "值得关注"列包含：置信度 / 爆冷风险 / 泊松校验 / 双模型分歧
- 表格后附指标说明小节，解释各指标含义

**⚠️ 竞彩队名别名：** `jingcai-schedule.json` 中 `乌兹别克` 是 `乌兹别克斯坦` 的缩写，映射表需同时包含两个变体。

**⚠️ drivers 字段是字符串不是列表：** 预测 JSON 中 `drivers` 字段是一个英文句子字符串（如 "Mexico has the Elo edge..."），不是数组。不要对其做 `', '.join()`，直接做全量中文化替换即可。报告简化版中不需要展示 drivers。

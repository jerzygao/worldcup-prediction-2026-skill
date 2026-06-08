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

先运行统一的赛前检查命令：

```bash
node scripts/agent-preflight-update.mjs
```

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
6. 运行权重搜索：

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
- `data/manual/wc26-squad-players.csv`：从已公布名单中解析出的球员行。行可标记为 `reported`、`source_partial` 或 `source_conflict`；不要把部分来源行当作最终首发数据。
- `data/manual/wc26-tournament-winner-odds.csv`：冠军赔率快照，只用于赛事背景，除非赛前重新核验。
- `data/manual/wc26-injuries.csv`：伤病/状态备注快照，只用于报告背景，除非赛前重新核验。

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

## Titan007 数据增强

本 skill 集成了 Titan007（球探网）的亚洲赔率数据作为补充数据源：

### 欧赔双源

| 数据源 | 覆盖 | 公司数 |
|--------|------|--------|
| The Odds API | 40/72 场 | ~30 家 |
| Titan007 共识 | 71/72 场 | 93~187 家/场 |

```bash
node scripts/import-titan007-odds.mjs
```

### 亚盘/大小球市场情绪

从 Titan007 盘口页面提取每场比赛的庄家行为数据，输出市场情绪报告：

```bash
node scripts/adjust-with-ah-ou.mjs
```

输出文件：
- `output/match-predictions-ah-enhanced.csv` — 72 场亚盘/大小球数据
- `output/ah-ou-market-report.md` — 市场情绪报告

### 竞彩推荐

基于中国体彩网 lottery.gov.cn 的竞彩赛程，结合模型预测和 Titan007 市场情绪，生成竞彩推荐方案：

```bash
node scripts/fetch-jingcai-odds.mjs --only-worldcup
node scripts/fetch-jingcai-odds.mjs --date=2026-06-11
```

输出文件：`output/jingcai-recommendations.md`

### 数据文件

- `data/manual/titan007-match-ids.csv` — 72 场 ID 映射表
- `data/manual/jingcai-schedule.json` — 24 场竞彩赛程

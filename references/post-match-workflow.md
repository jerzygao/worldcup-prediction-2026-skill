# 赛后验证与简化报告工作流

## 赛后更新流程

每轮比赛结束后：

1. **拉取赛果** — Sailing MCP
```bash
mcporter call sailing-sports-mcp tteagt --args '{"query": "2026年X月X日世界杯比赛结果", "project": "FBL"}'
```

2. **手动录入 prediction-log.json**
```json
{
  "match": "Mexico vs South Africa",
  "date": "2026-06-12",
  "actual_score": "2-0",
  "actual_home_goals": 2,
  "actual_away_goals": 0,
  "actual_outcome": "主胜",
  "our_prediction": {"direction": "主胜", "homeWin": 0.7189, ...},
  "poisson_prediction": {"direction": "主胜", ...},
  "verdict": {"our_direction": "✅", "our_score": "✅ (2-0 精确命中)", ...}
}
```

3. **运行更新脚本**
```bash
python3 scripts/post-match-update.py
```

4. **生成简化报告** — 两章结构（历史预测 + 未来预测），以竞彩赛程为基准

## 简化报告格式

### 第一章：历史预测

| 比赛日期 | 对阵 | 预测方向 | 预测比分 | 实际赛果 | 实际比分 | 命中 |

- 比赛日期：竞彩 `time` 字段（MM-DD HH:MM）
- 对阵：竞彩 `home vs away`（中文队名）
- 预测方向：`主胜（主72% 平16% 客12%）`
- 只列出已完赛场次

### 第二章：未来预测

| 比赛日期 | 对阵 | 预测方向 | 预测比分 | 值得关注 |

- "值得关注"列包含：置信度 / 爆冷风险 / 泊松校验 / 双模型分歧
- 格式：`高置信 / 爆冷风险中 / 泊松:主47% T1爆冷 / ⚠分歧:我们客胜vs泊松主胜`

### 指标说明（表格后附）

| 指标 | 含义 |
|------|------|
| 高置信 / 中置信 / 低置信 | 多因子模型预测置信度 |
| 爆冷风险中 / ⚠爆冷风险高 | 弱队获胜或平局概率偏高 |
| 泊松:主/客/平XX% | 泊松xG模型预测方向及概率 |
| T1爆冷 / T2 | 泊松爆冷等级：T1≥40%, T2≥30%, T3≥20% |
| ⚠分歧:我们XXvs泊松XX | 两个独立模型方向不一致 |

## 关键陷阱

### 竞彩队名别名
`jingcai-schedule.json` 中 `乌兹别克` 是 `乌兹别克斯坦` 缩写，CN_TO_EN 映射表需同时包含两个变体。

### drivers 字段是字符串不是列表
预测 JSON 中 `drivers` 是英文句子字符串，不是数组。不要 `', '.join()`。

### 队名映射方向
竞彩用中文 → 预测用英文。`find_pred()` 需要 CN_TO_EN 映射，不是 EN_TO_CN。

### 报告落盘
主存档：`~/open-workspace/worldcup-prediction/2026-worldcup-prediction-report.md`
备份：`~/.hermes/skills/sports/worldcup-prediction/output/2026-worldcup-prediction-report.md`

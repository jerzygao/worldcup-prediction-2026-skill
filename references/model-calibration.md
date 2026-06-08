# 模型校准说明

最后拟合时间：2026-05-19。

## 当前 Elo + 最近状态拟合

数据集：

- 来源：`data/processed/match-features.csv`
- 比赛：已有比分的国际比赛
- 日期过滤：从 1990-01-01 开始
- 训练集：1990-01-01 到 2021-12-31
- 验证集：2022-01-01 到 2026-03-31
- 训练行数：27,719
- 验证行数：4,421

模型：

```text
home_strength = eloCoef * (eloDiff / 100) + formCoef * recentFormDiff + homeCoef * homeAdvantage
away_strength = -home_strength
draw_logit = drawBias
  - drawEloPenalty * abs(eloDiff / 100)
  - drawFormPenalty * abs(recentFormDiff)
  + drawNeutralBoost * neutralFlag

probabilities = softmax(home_strength, draw_logit, away_strength)
```

当前最佳验证参数：

```json
{
  "eloCoef": 0.33666,
  "formCoef": 0.006931,
  "homeCoef": 0.420401,
  "drawBias": -0.028535,
  "drawEloPenalty": 0.079558,
  "drawFormPenalty": 0.103623,
  "drawNeutralBoost": -0.101033
}
```

指标：

| 数据集 | Log Loss | Brier 分数 | 准确率 |
|---|---:|---:|---:|
| 训练 | 0.898735 | 0.530180 | 0.584256 |
| 验证 | 0.879746 | 0.517669 | 0.597829 |

验证集校准：

| 结果 | 实际发生率 | 平均预测概率 |
|---|---:|---:|
| 主胜 | 0.4750 | 0.4881 |
| 平局 | 0.2298 | 0.2215 |
| 客胜 | 0.2952 | 0.2903 |

解释：

- Elo 是最主要的有效信号。
- 在已经包含 Elo 后，最近 10 场状态的拟合系数很小。
- 非中立场比赛中，主场优势仍然有意义。
- 验证集中平局概率略微低估。

## 第二轮窄范围搜索

围绕第一轮结果做过一次更窄范围的第二轮搜索。该搜索改善了抽样拟合集，但让验证集 Log Loss 变差：

| 轮次 | 验证 Log Loss | 验证 Brier | 验证准确率 |
|---|---:|---:|---:|
| 第一轮宽搜索 | 0.879746 | 0.517669 | 0.597829 |
| 第二轮窄搜索 | 0.881386 | 0.518497 | 0.598055 |

决策：

- 保留第一轮作为当前更优结果，因为验证集 Log Loss 和 Brier 分数更好。
- 不要为了抽样拟合集过度拟合平局参数。

## 下一步校准

### 加入 FIFA 积分

第二个拟合模型：

- 特征：Elo + 最近 10 场状态 + FIFA 历史积分
- 日期过滤：从 1994-01-01 开始
- 训练集：1994-01-01 到 2021-12-31
- 验证集：2022-01-01 到 2026-03-31
- 训练行数：25,334
- 验证行数：4,421

最佳参数：

```json
{
  "eloCoef": 0.335571,
  "fifaCoef": 0.002611,
  "formCoef": 0.017879,
  "homeCoef": 0.426418,
  "drawBias": -0.042849,
  "drawEloPenalty": 0.076508,
  "drawFifaPenalty": 0.000397,
  "drawFormPenalty": 0.128115,
  "drawNeutralBoost": -0.01726
}
```

指标：

| 数据集 | Log Loss | Brier 分数 | 准确率 |
|---|---:|---:|---:|
| 训练 | 0.895842 | 0.528085 | 0.587235 |
| 验证 | 0.879709 | 0.517718 | 0.598507 |

与 Elo + 状态模型的验证 Log Loss `0.879746` 相比，FIFA 只改善了 `0.000037`。拟合出的 `fifaCoef` 接近 0，所以当 Elo 可用时，FIFA 积分应保持为低权重辅助特征。

决策：

- 保留 FIFA 作为小权重降级/辅助特征。
- 不让 FIFA 积分明显覆盖 Elo。
- 如果 Elo 缺失，FIFA 积分可以获得更高降级权重。

下一步有价值的校准不是继续调 FIFA，而是加入与 Elo 冗余更低的特征：

```text
赔率 + 阵容评分 / 身价 + 球队特定平局/主客倾向
```

### 加入滚动球队倾向特征

第三个拟合模型：

- 特征：Elo + FIFA 积分 + 最近状态 + 滚动球队倾向
- 滚动倾向窗口：每队此前 30 场比赛
- 倾向特征：
  - `tendencyWinRateDiff`
  - `tendencyGoalDiffDiff`
  - `tendencyDrawRateAvg`
- 日期过滤：从 1994-01-01 开始
- 训练集：1994-01-01 到 2021-12-31
- 验证集：2022-01-01 到 2026-03-31
- 训练行数：25,334
- 验证行数：4,421

最佳参数：

```json
{
  "eloCoef": 0.325598,
  "fifaCoef": -0.001584,
  "formCoef": 0.00566,
  "winTendencyCoef": -0.350219,
  "gdTendencyCoef": 0.093198,
  "homeCoef": 0.404488,
  "drawBias": -0.078048,
  "drawEloPenalty": 0.088049,
  "drawFifaPenalty": 0.003312,
  "drawFormPenalty": 0.035192,
  "drawTendencyCoef": 1.018144,
  "drawNeutralBoost": -0.010283
}
```

指标：

| 模型 | 验证 Log Loss | Brier 分数 | 准确率 |
|---|---:|---:|---:|
| Elo + 状态 | 0.879746 | 0.517669 | 0.597829 |
| Elo + FIFA + 状态 | 0.879709 | 0.517718 | 0.598507 |
| Elo + FIFA + 状态 + 倾向 | 0.877067 | 0.516068 | 0.596698 |

验证集校准：

| 结果 | 实际发生率 | 平均预测概率 |
|---|---:|---:|
| 主胜 | 0.4750 | 0.4878 |
| 平局 | 0.2298 | 0.2185 |
| 客胜 | 0.2952 | 0.2937 |

决策：

- 保留滚动倾向特征，因为 Log Loss 和 Brier 分数有明显改善。
- `tendencyDrawRateAvg` 是最有用的新倾向特征。
- FIFA 继续保持很低权重；拟合符号不稳定，不能覆盖 Elo。
- 平局概率仍偏低，后续调参应重点关注平局校准。

### 已采用的保守优化

一次单独优化后，采用了保守候选方案。它只改动两个参数，保持同样的滚动窗口 `30`，同时改善验证 Log Loss。

更新参数：

```json
{
  "winTendencyCoef": -0.55,
  "drawTendencyCoef": 1.25
}
```

其他系数保持前一个校准模型不变。

指标：

| 模型 | 窗口 | 验证 Log Loss | Brier 分数 | 准确率 |
|---|---:|---:|---:|---:|
| 上一版校准模型 | 30 | 0.877067 | 0.516068 | 0.596698 |
| 保守更新 | 30 | 0.876161 | 0.515356 | 0.597150 |

决策：

- 采用保守更新，版本为 `elo-fifa-tendency-conservative-2026-05-19`。
- 不采用更激进的 robust 候选，因为其倾向系数更大，更可能是在补偿共线性。

### 已采用的现代稳健优化

经过受约束的稳健搜索后，采用现代时期候选作为默认模型。原因是它改善了 2022-2026 验证集，同时让 1994-2021 训练期 Log Loss 基本保持不变。

更新模型：

```text
elo-fifa-tendency-robust-modern-2026-05-20
```

参数：

```json
{
  "eloCoef": 0.315051,
  "fifaCoef": 0.035,
  "formCoef": -0.005,
  "winTendencyCoef": -0.949043,
  "gdTendencyCoef": 0.139084,
  "homeCoef": 0.341845,
  "drawBias": -0.15,
  "drawEloPenalty": 0.045,
  "drawFifaPenalty": 0,
  "drawFormPenalty": 0,
  "drawTendencyCoef": 1.413384,
  "drawNeutralBoost": 0.0039
}
```

指标：

| 模型 | 训练 Log Loss | 验证 Log Loss | 验证 Brier | 验证准确率 |
|---|---:|---:|---:|---:|
| 保守默认 | 0.891479 | 0.876161 | 0.515356 | 0.597150 |
| 现代稳健更新 | 0.891463 | 0.872836 | 0.513446 | 0.599864 |

决策：

- 采用现代稳健更新作为默认模型。
- 保留保守模型说明，便于回滚。
- 在真实赛前赔率、确认首发和已核验伤病数据可用前，仍应把本模型视为娱乐/分析模型。

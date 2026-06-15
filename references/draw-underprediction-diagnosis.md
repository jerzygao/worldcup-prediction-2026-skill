# 平局系统性低估排查指南

## 背景

预测模型系统性低估平局概率。校准文档在验证集上已发现此偏差（实际 22.98% vs 预测 21.85%），但记录"后续调参应重点关注平局校准"后未跟进。

## 根因链（4 层叠加）

| 层级 | 组件 | 问题 | 位置 |
|:---|:---|:---|:---|
| 1 | 校准模型 | drawBias 太负，softmax 压缩平局 logit | `calibrated-model.json` |
| 2 | 赔率融合 | odds 权重过大，市场赔率去水后平局本就偏低，双重压缩 | `calibrated-model.json` |
| 3 | 特征惩罚 | drawEloPenalty 对 Elo 差距大的比赛额外扣平局分 | `calibrated-model.json` |
| 4 | 比分映射 | predictedScore 平局触发阈值高于全 72 场最高平局概率 | `predict-match.mjs` |

## 标准化诊断流程（6 步）

### Step 1: 平局概率分布
```python
draws = [p.get('draw',0)*100 for p in preds]
print(f"均值:{sum(draws)/len(draws):.1f}% 最高:{max(draws):.1f}%")
print(f"≥25%:{sum(1 for d in draws if d>=25)} ≥28%:{sum(1 for d in draws if d>=28)}")
print(f"1-1:{sum(1 for p in preds if p.get('predictedScore')=='1-1')}")
```

### Step 2: 实际赛果平局率
拉取权威赛果（ESPN/Fox Sports），计算完赛场次的平局占比。

### Step 3: 确认 neutral 字段
只有东道主为 `neutral=FALSE`，其余应为 `TRUE`。如果全 FALSE，homeCoef 会错误应用到所有比赛。验证命令：
```bash
grep neutral data/manual/wc26-official-group-stage.csv
```

### Step 4: 赔率来源水位
检查 `match-odds.csv` 中平局比赛的去水后 draw 概率。`clean-odds.mjs` 简单比例法对平局不友好。

### Step 5: predictedScore 阈值
`predict-match.mjs` 第 431 行。如果全 72 场平局概率最高值 < 阈值，下调。

### Step 6: 追溯 drawBias 历史
查看 `config/calibrated-model.json` notes 和 `references/model-calibration.md`。

## Hotfix 记录

### v1 (2026-06-15)
- drawBias: -0.15 → -0.10
- predictedScore 阈值: 0.28 → 0.25
- 效果: predictedScore=1-1 0→10场

### v2 (2026-06-15)
- drawBias: -0.10 → -0.03
- drawEloPenalty: 0.045 → 0.025
- externalFeatureBlend.odds: 0.35 → 0.25
- 效果: predictedScore=1-1 10→20场，平局均值 20.5%→21.9%

## 修复选项（按推荐度）

### A. 完整逻辑回归重拟合
```bash
node scripts/build-elo-form.mjs --input data/results.csv --outDir data/processed
node scripts/merge-fifa-features.mjs --matches data/processed/match-features.csv --output data/processed/match-features-fifa.csv
node scripts/build-rolling-tendency-features.mjs --input data/processed/match-features-fifa.csv --output data/processed/match-features-tendency.csv
```
→ 对 match-features-tendency.csv 跑 logistic regression with softmax + log loss → 更新 calibrated-model.json

⚠️ `weight-search.mjs` 只搜备用模型的 externalFeatureBlend 权重，不碰 eloCoef/drawBias/drawEloPenalty。

### B. 赔率去水方法升级
`clean-odds.mjs` 简单比例法 → Power k 或 Shin 法

### C. 情境特征
加 `upsetDrawPotential`（弱队主场偷平）修正因子

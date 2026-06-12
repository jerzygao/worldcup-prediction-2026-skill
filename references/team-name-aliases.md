# 跨数据源队名别名陷阱

三个主要数据源的队名格式不同，映射遗漏会导致场次丢失或数据匹配失败。

## 问题根源

| 数据源 | 队名格式 | 示例 |
|--------|---------|------|
| 预测管线（match-predictions-2026.json） | 英文全名 | `Bosnia and Herzegovina`, `DR Congo` |
| 竞彩赛程（jingcai-schedule.json） | 中文，可能缩写/变体 | `波黑`, `刚果金`（无括号） |
| 泊松引擎（poisson-elo.json） | 中文，完整名 | `波黑`, `刚果(金)`（有括号） |

## 已知别名清单

### 竞彩特有变体（与引擎/管线不同）
| 竞彩名称 | 管线英文 | 引擎中文 | 备注 |
|---------|---------|---------|------|
| `乌兹别克` | `Uzbekistan` | `乌兹别克斯坦` | 竞彩使用缩写 |
| `刚果金` | `DR Congo` | `刚果(金)` | 竞彩无括号 |
| `波黑` | `Bosnia and Herzegovina` | `波黑` | 一致 |

### 英文名 → 中文名（管线 → 竞彩/引擎）
```python
EN_TO_CN_ALIASES = {
    "Bosnia and Herzegovina": "波黑",
    "Czech Republic": "捷克",
    "South Korea": "韩国",
    "United States": "美国",
    "Ivory Coast": "科特迪瓦",
    "Cape Verde": "佛得角",
    "Saudi Arabia": "沙特",
    "New Zealand": "新西兰",
    "South Africa": "南非",
    "DR Congo": "刚果(金)",
    "Curaçao": "库拉索",
}
```

### 中文名 → 英文名（竞彩/引擎 → 管线）
```python
CN_TO_EN_ALIASES = {
    "乌兹别克": "Uzbekistan",
    "乌兹别克斯坦": "Uzbekistan",
    "刚果金": "DR Congo",
    "刚果(金)": "DR Congo",
    "波黑": "Bosnia",
}
```

## 故障排查

**症状：** 未来预测表格最后一天少 1 场，或某场比赛在报告中不出现。

**根因：** 竞彩赛程的队名在 `CN_TO_EN` 映射表中找不到对应英文名，`find_pred()` 返回 `None`，该场被静默跳过。

**修复：** 
1. 逐场排查：用竞彩 `date` 分组，检查每组的场次数是否与竞彩赛程一致
2. 补充映射：在集成脚本的 `CN_TO_EN` 字典中添加缺失的别名
3. 两个变体同时保留（如 `刚果金` 和 `刚果(金)` 都映射到 `DR Congo`）

**预防：** 每次更新竞彩赛程后，执行：
```python
for jc in jc_schedule:
    if jc['home'] not in CN_TO_EN:
        print(f"⚠️ 缺失映射: home={jc['home']}")
    if jc['away'] not in CN_TO_EN:
        print(f"⚠️ 缺失映射: away={jc['away']}")
```

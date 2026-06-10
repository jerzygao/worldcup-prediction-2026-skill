# 报告 & 可视化生成指南

## 数据加载模式

所有报告和可视化页面都从以下文件读取数据（路径相对于 skill 根目录）：

| 数据 | 文件 | 格式 |
|------|------|------|
| 小组与球队 | `output/match-predictions-2026.json` → `.groups` | JSON |
| 夺冠/淘汰赛模拟 | `output/tournament-simulation-2026.json` → `.teams` | JSON |
| 小组出线概率 | `output/group-qualification-2026.csv` | CSV |
| 72场预测 | `output/match-predictions-2026.csv` | CSV |
| 赔率数据 | `data/manual/match-odds.csv` | CSV（bookmaker字段区分来源） |
| 球队实力 | `data/manual/team-strength.csv` | CSV |
| 战术画像 | `data/manual/team-tactical-profiles.csv` | CSV |
| 亚盘数据 | `output/match-predictions-ah-enhanced.csv` | CSV（可选，可能不存在） |
| 模型配置 | `config/calibrated-model.json` | JSON |
| 竞彩赛程 | `data/manual/jingcai-schedule.json` | JSON |

```python
# 一次性加载模式
SKILL_DIR = "~/.hermes/skills/sports/worldcup-prediction"
import json, csv
with open(f"{SKILL_DIR}/output/match-predictions-2026.json") as f: preds = json.load(f)
with open(f"{SKILL_DIR}/output/tournament-simulation-2026.json") as f: sim = json.load(f)
with open(f"{SKILL_DIR}/output/group-qualification-2026.csv") as f: qual = list(csv.DictReader(f))
with open(f"{SKILL_DIR}/output/match-predictions-2026.csv") as f: matches = list(csv.DictReader(f))
with open(f"{SKILL_DIR}/data/manual/match-odds.csv") as f: odds = list(csv.DictReader(f))
```

## 中文队名替换

使用 `references/team-name-cn.md` 中的 `CN` 映射表。

**关键陷阱：** 模型生成的 `matchupNotes` 字段包含英文队名（如 "France 的转换推进可能冲击 Japan 的防线"）。必须在输出前全量替换：

```python
CN = { ... }  # 48队完整映射
if m.get('matchupNotes'):
    notes = m['matchupNotes']
    for eng, ch in sorted(CN.items(), key=lambda x: -len(x[0])):
        notes = notes.replace(eng, ch)
```

按名称长度降序替换，避免 "South" 匹配到 "South Africa" 之前先被错误替换。

## 双源赔率对比

`match-odds.csv` 通过 `bookmaker` 字段区分来源：
- `the-odds-api consensus average` → Odds API
- `titan007 consensus average` → Titan007 球探网

按 `date|homeTeam|awayTeam` 分组，然后按 bookmaker 筛选：

```python
odds_by_match = {}
for o in odds_rows:
    key = f"{o.get('date','')}|{o.get('homeTeam','')}|{o.get('awayTeam','')}"
    odds_by_match.setdefault(key, []).append(o)

def get_odds(date, home, away):
    key = f"{date}|{home}|{away}"
    lst = odds_by_match.get(key, [])
    api = [o for o in lst if 'the-odds-api' in o.get('bookmaker','')]
    titan = [o for o in lst if 'titan007' in o.get('bookmaker','')]
    return api, titan
```

**差异标注：** 两个源都有数据时计算差值并标注 ▲▼：

```python
dh = float(api_h) - float(titan_h)
if abs(dh) < 0.01: "≈"
else: f"{'▲' if dh>0 else '▼'}{abs(dh):.2f}"
```

正值 = Odds API 赔率更高（更看好客队），负值 = Titan007 赔率更高。

## 体彩推荐逻辑

### 单场胜平负（SPF）

| 条件 | 推荐 |
|------|------|
| 最高概率 ≥ 50% | 给出方向（主胜/平局/客胜） |
| 最高概率 35-49% | 不推荐 SPF，提示"倾向不明显，建议关注让球方向" |
| 最高概率 < 35% | 不推荐 |

### 让球胜平负（RQSPF）

| 条件 | 推荐 |
|------|------|
| 最高概率 ≥ 65% | 推荐让球方向 |
| 最高概率 ≥ 55% 且主/客胜 ≥ 70% | 推荐让球方向 |
| 其他 | 不推荐 |

方向：主队占优 → 让球胜，客队占优 → 让球负。

### 比分推荐

取预测比分作为核心，补充 2 个变体：
- 预测比分本身（如 2-0）
- 零封版本（如 2-0 → 1-0）
- 差值+1 版本（如 2-0 → 3-0）

### 混合过关方案

**按日分组：** 每天 ≥ 2 场概率 ≥ 55% 的比赛可组合。
- 2 串 1：取当日概率最高的 2 场
- 3 串 1：取当日概率最高的 3 场（如果够）
- 稳胆推荐：概率 ≥ 70% 的比赛

**跨日优选：** 从全部 72 场中筛选概率 Top 10，推荐 4 串 1 旗舰方案和 2 串 1 优选方案。

**概率 ≈ 70% 的场次走让球胜平负**（让球胜/负），概率 55-69% 的场次走胜平负。

**综合过关概率计算：** 各场概率相乘（小数形式）。例如 89% × 88% × 85% × 83% = 55%。

## 可视化页面设计规范

### 桌面宽屏版

- 暗色主题（`#0a0e17` 背景）
- Tab 切换：夺冠概率 → 小组出线 → 赛程预测 → 赔率对比 → 球队实力
- 进度条可视化概率
- 响应式布局，移动端可用

### 小红书竖屏版

- 1080px 宽，纵向滚动
- 封面页（大赛标题 + 核心数据）
- 模型配置 → 夺冠 Top 10 → 小组出线(12组折叠) → 全部72场预测(含赔率对比) → 球队实力
- 每场比赛显示：中英文队名、概率、预测比分、置信度、双源赔率(带差异)、实力对比
- 适合截图发布到小红书等社交平台

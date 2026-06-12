# 报告中文翻译速查

生成预测报告时，模型输出的英文文本需翻译为中文。以下为三类主要翻译场景。

## 1. 模型驱动因素翻译

`match-predictions-2026.json` 每场的 `drivers` 字段包含 ~7 行英文，用 `|` 分隔。

```python
import re

DRIVER_TRANS = [
    (r'has the Elo edge \((\d+) points\)', r'Elo评分领先（\1分）'),
    (r'has better recent 10-match form', '近10场状态更佳'),
    (r'Recent form is close between the two teams', '两队近期状态接近'),
    (r'receives a home advantage adjustment', '获得主场优势加成'),
    (r'The match is treated as neutral-site, so no home advantage is applied',
     '本场在中立场地进行，无主场优势加成'),
    (r'Pre-match odds are included after bookmaker margin removal',
     '已考虑去除庄家水位后的市场赔率'),
    (r'has the stronger game-rating squad profile', '的阵容游戏评分占优'),
    (r'has the higher market-value profile', '的阵容身价占优'),
    (r'The Elo gap is small, so the matchup is relatively balanced',
     '双方Elo差距较小，实力较为均衡'),
    (r'Rolling team tendency features are included from recent historical match patterns',
     '已纳入近期历史比赛模式的球队倾向特征'),
    (r'Modern stats and other team tendency info is included',
     '已纳入现代统计数据及其他球队倾向信息'),
]

def translate_driver(text):
    for pattern, replacement in DRIVER_TRANS:
        text = re.sub(pattern, replacement, text)
    return text.rstrip('.')
```

**执行顺序：** 先替换队名 → 再翻译短语。团队名已在执行此步骤前通过 `cn_names` 映射表处理。

## 2. 战术风格标签翻译

`team-tactical-profiles.csv` 的 `styleTags` 字段（不是 `tacticalStyle`）用 `|` 分隔多个标签，如 `transition|compact|setPieces`。

完整映射见 `references/reading-csv-columns.md`。快速使用：

```python
STYLE_CN = {
    'possession': '控球',
    'pressing': '逼抢',
    'transition': '转换',
    'compact': '紧凑',
    'setPieces': '定位球',
    'creativeAttack': '创造性进攻',
}

def translate_style(tag_str):
    if not tag_str:
        return '?'
    tags = [t.strip() for t in tag_str.split('|') if t.strip()]
    return '、'.join(STYLE_CN.get(t, t) for t in tags)
```

## 3. 市场情绪方向翻译

`ahDirection` 字段为英文枚举值：

| 原文 | 中文 |
|------|------|
| `favor_favorite` | 看好让球方 |
| `favor_underdog` | 看好受让方 |
| 其他 | 保持原样 |

```python
def translate_ah_dir(direction):
    if 'favor_favorite' in direction:
        return '看好让球方'
    elif 'favor_underdog' in direction:
        return '看好受让方'
    return direction
```

## 4. 大小球方向翻译

`ouDirection` 字段：

| 原文 | 中文 |
|------|------|
| `over` | 倾向大球 |
| `under` | 倾向小球 |
| 其他 | 盘口稳定 |

```python
ou_label = '倾向大球' if ou_dir == 'over' else ('倾向小球' if ou_dir == 'under' else '盘口稳定')
```

## 5. 场馆名翻译

`stadium` 和 `city` 字段可选择性翻译：

```python
stadium_cn = stadium.replace('Mexico City Stadium', '墨西哥城体育场')
city_cn = city.replace('Mexico City', '墨西哥城')
```

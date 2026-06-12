# CSV 列名速查

读取 `data/manual/` 下 CSV 文件时，先列名再取值，避免 `KeyError` 或静默 `None`。

## match-odds.csv

```
date,homeTeam,awayTeam,bookmaker,homeOdds,drawOdds,awayOdds,timestamp,sourceUrl
```

- `bookmaker` = `titan007 consensus average` | `the-odds-api consensus average`
- `homeOdds/drawOdds/awayOdds` — 欧赔格式（小数），不是 `homeWin/draw/awayWin`
- 同 match+source 可能有重复行（多次抓取），用 `timestamp` 字段取最新
- Dedup 代码：
  ```python
  odds = {}
  for r in rows:
      key = (r['date'], r['homeTeam'], r['awayTeam'], r['bookmaker'])
      if key not in odds or r['timestamp'] > odds[key]['timestamp']:
          odds[key] = r
  ```

## match-weather.csv

```
matchId,date,homeTeam,awayTeam,city,country,venue,
temperatureMaxC,temperatureMinC,precipitationMm,windMaxKmh,source,sourceUrl,fetchedAt
```

- `temperatureMaxC` / `temperatureMinC` — 不是 `tempC`
- `precipitationMm` — 不是 `precipMM`
- `windMaxKmh` — 不是 `windSpeed`
- 没有 `condition` 字段（不要查这个列名）

## team-tactical-profiles.csv

```
team,styleTags,attackRating,midfieldRating,defenseRating,transitionRating,setPieceRating,squadTier,strengths,weaknesses,playingStyle,keyPlayers,source,updatedAt
```

- `styleTags` — 多标签用 `|` 分隔，如 `transition|compact|setPieces`，不是 `tacticalStyle`
- `squadTier` — 梯队评级：`strong` / `solid` 等
- `playingStyle` — 战术描述文本（英文）
- `keyPlayers` — 核心球员（英文）
- 8 队缺 `styleTags`：Argentina / Bosnia and Herzegovina / Curaçao / Czech Republic / DR Congo / Iraq / Sweden / Turkey

### styleTags → 中文映射

| 标签 | 中文 |
|------|------|
| `possession` | 控球 |
| `pressing` | 逼抢 |
| `transition` | 转换 |
| `compact` | 紧凑 |
| `setPieces` | 定位球 |
| `creativeAttack` | 创造性进攻 |

```python
def translate_style(tag_str):
    if not tag_str or tag_str == '?':
        return '?'
    mapping = {'possession':'控球','pressing':'逼抢','transition':'转换',
               'compact':'紧凑','setPieces':'定位球','creativeAttack':'创造性进攻'}
    tags = [t.strip() for t in tag_str.split('|') if t.strip()]
    return '、'.join(mapping.get(t, t) for t in tags)
```

## team-strength.csv

```
team,fifaRank,fifaPoints,marketValueEur,squadRating,marketValueSource,ratingSource,updatedAt,fifaRankSource,dataStatus
```

- `marketValueEur` — 不是 `marketValueEUR`（大小写敏感）
- `fifaRank` — 排名位次（数值越低越强）
- `fifaPoints` — FIFA 积分（数值越高越强）
- `squadRating` — 阵容评分（代理评分，非官方 EA/SoFIFA）

## elo-recent-form.csv

```
team,eloRating,recentFormWins,recentFormDraws,recentFormLosses,fifaRank,marketValueEur,playerCount,avgAge,corePlayers,dataStatus
```

- `eloRating` — Elo 评分数值
- `recentFormWins/Draws/Losses` — 近10场战绩结构化
- `dataStatus` = `★已核实` | `预估`（可靠性标注）

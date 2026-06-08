# 数据结构说明

第一版使用 JSON 数组。每一行比赛数据只能包含赛前信息。

## 比赛行

```json
{
  "matchId": "2022-FRA-AUS",
  "date": "2022-11-22",
  "homeTeam": "France",
  "awayTeam": "Australia",
  "actual": "H",
  "odds": {
    "home": 1.25,
    "draw": 5.8,
    "away": 11.0
  },
  "features": {
    "eloDiff": 410,
    "fifaPointsDiff": 280,
    "marketValueLogRatio": 1.35,
    "recentFormDiff": 0.42
  }
}
```

`actual` 取值：

- `H`：主队 / A 队获胜
- `D`：平局
- `A`：客队 / B 队获胜

## 特征含义

- `eloDiff`：主队 Elo 减客队 Elo。
- `fifaPointsDiff`：主队 FIFA 积分减客队 FIFA 积分。
- `marketValueLogRatio`：`ln(主队身价 / 客队身价)`。
- `recentFormDiff`：主队近期状态分减客队近期状态分，尽量保持在 `-1` 到 `1` 之间。

## 预测输出

```json
{
  "matchId": "2022-FRA-AUS",
  "homeWin": 0.64,
  "draw": 0.22,
  "awayWin": 0.14,
  "predictedScore": "2-1",
  "confidence": "medium",
  "upsetRisk": "medium"
}
```

## 保护规则

- 赔率必须先清洗并去除庄家水位。
- 不要把俱乐部名称和国家队名称混用。
- 不要使用开赛后的数据训练。
- 历史交锋除非被数据证明有效，否则权重应非常低。

## 球队实力快照

用 `data/manual/team-strength.csv` 保存可选的 FIFA、游戏评分和身价输入。

```csv
team,fifaRank,fifaPoints,squadRating,marketValueEur,marketValueSource,ratingSource,updatedAt
France,1,1885.0,84.5,1230000000,manual Transfermarkt-style snapshot,sample EA FC/SoFIFA-style snapshot,2026-05-19
```

字段：

- `fifaRank`：数值越低越强。
- `fifaPoints`：数值越高越强。
- `squadRating`：游戏风格阵容强度评分，不是身价。
- `marketValueEur`：球队身价，单位欧元。
- `marketValueSource`：身价来源说明。
- `ratingSource`：游戏评分来源说明。
- `updatedAt`：快照日期。

如果 FIFA 积分和 FIFA 排名都存在，优先使用 FIFA 积分。某个字段缺失时，预测应排除该特征并重新分配权重。

## 球队实力更新接口

用以下命令刷新确定性球队实力输入：

```bash
node scripts/update-team-strength-sources.mjs
node scripts/build-squad-tactical-profiles.mjs
```

输入和输出：

- 读取 `data/manual/team-strength.csv`。
- 从 `dcaribou/transfermarkt-datasets` 抓取 Transfermarkt 衍生国家队身价。
- 可选读取 `data/manual/squad-rating-import.csv` 中已核验的阵容评分。
- 写回更新后的 `data/manual/team-strength.csv`。
- 将覆盖和降级详情写入 `data/manual/team-strength-update-status.csv`。
- 将派生战术画像写入 `data/manual/team-tactical-profiles.csv`。

阵容评分导入结构：

```csv
team,squadRating,ratingSource,ratingSourceUrl,updatedAt,status,notes
France,84.5,EA FC / SoFIFA verified snapshot,https://example.com/source,2026-06-01,verified,Top squad or likely XI rating
```

只有已核验、非 sample 的行会被合并。空值或 `sample` 行会被忽略，`predict-match.mjs` 会通过排除阵容评分特征来降级。

当没有已核验游戏评分时，`build-squad-tactical-profiles.mjs` 会从身价、Elo、FIFA 数据、近期状态、世界杯履历和 `wc26-teams.csv` 画像备注中生成明确标注的代理阵容评分。这些值适合娱乐预测和对位分析，但不是官方游戏评分。

战术画像结构：

```csv
team,styleTags,attackRating,midfieldRating,defenseRating,transitionRating,setPieceRating,squadTier,strengths,weaknesses,playingStyle,keyPlayers,rosterType,rosterStatus,rosterPlayerCount,rosterSourceUrl,rosterUpdatedAt,source,updatedAt
Spain,possession|compact,86.1,88.1,87.5,85.4,84.7,elite,midfield control|defensive stability,no major proxy weakness,...,final_26,official_fifa,26,https://example.com,2026-05-20,...
```

## 2026 阵容公布快照

用 `data/manual/wc26-squad-announcements.csv` 跟踪名单新鲜度。该文件用于阵容强度、报告和风险提示，不是确认首发数据。

```csv
team,announcementDate,rosterType,rosterStatus,playerCount,source,sourceUrl,updatedAt,modelUse,notes
Iraq,2026-05-20,preliminary,official_fifa_partial_player_parse,34,FIFA,https://example.com,2026-05-20,profile_context,...
```

推荐状态：

- `official_fifa`：FIFA 直接确认。
- `official_federation`：国家队协会直接确认。
- `reported_final_crosschecked`：可靠媒体/AP/Reuters 风格报道，最终注册前仍需交叉核验。
- `source_partial`：由于来源文本不完整，球员行也不完整。
- `source_conflict`：来源文本冲突，硬模型使用前需要核验。

用 `data/manual/wc26-squad-players.csv` 保存从名单中解析出的球员行：

```csv
team,announcementDate,rosterType,positionGroup,player,club,sourceUrl,status,updatedAt,notes
Brazil,2026-05-18,final_26,Forward,Neymar,Santos,https://example.com,reported,2026-05-20,
```

预测流水线可以把名单公布状态用于解释上下文，但不能在没有单独核验的情况下推断首发、伤病或精确可用性。

## 单场预测输入

当单场比赛提供第一版全部特征时，使用这个结构：

```json
{
  "homeTeam": "France",
  "awayTeam": "Japan",
  "neutral": true,
  "odds": {
    "home": 1.72,
    "draw": 3.65,
    "away": 5.1
  },
  "fifaPoints": {
    "home": 1885,
    "away": 1620
  },
  "squadRating": {
    "home": 84.5,
    "away": 77.8
  },
  "marketValue": {
    "home": 1230000000,
    "away": 275000000
  }
}
```

## 已校准模型配置

默认拟合模型使用 `config/calibrated-model.json`。

重要字段：

- `version`：预测输出使用的模型版本。
- `trainedOn`：训练和验证元数据。
- `params`：Elo、FIFA、状态、主场优势和滚动倾向的 softmax 系数。
- `externalFeatureBlend`：赔率、游戏阵容评分和身价等赛前外部特征的修正权重。

`predict-match.mjs` 会先计算校准后的基础概率，再混合可用的赛前外部特征。如果赔率、阵容评分或身价缺失，就忽略它们。

## 实时赛前更新接口

生成新比赛预测前，使用这个命令：

```bash
node scripts/update-realtime-prematch-data.mjs
```

它会创建或刷新这些文件：

- `data/manual/pre-match-update-status.csv`：每场赛程的赔率、天气、首发、伤病和降级状态。
- `data/manual/match-odds.csv`：当 `ODDS_API_KEY` 可用时写入赔率快照。
- `data/manual/match-weather.csv`：当比赛进入预报窗口时写入 Open-Meteo 预报快照。
- `data/manual/match-lineups.csv`：确认首发导入模板。
- `data/manual/match-injuries.csv`：已核验伤病/停赛导入模板。

赔率结构：

```csv
date,homeTeam,awayTeam,bookmaker,homeOdds,drawOdds,awayOdds,timestamp,sourceUrl
2026-06-11,Mexico,South Africa,the-odds-api consensus average,1.85,3.40,4.20,2026-06-10T12:00:00Z,https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds
```

首发结构：

```csv
date,homeTeam,awayTeam,team,player,position,starter,confirmed,source,sourceUrl,updatedAt
2026-06-11,Mexico,South Africa,Mexico,Player Name,FW,true,true,official match center,https://example.com,2026-06-11T18:00:00Z
```

更新脚本绝不能编造值。缺失数据会记录在状态文件中，预测流水线会自动降级。

## 2026 小组赛官方赛程结构

`data/manual/wc26-official-group-stage.csv` 是批量预测和赛前更新的优先赛程来源。

```csv
matchId,matchNumber,stage,group,date,kickoffLocal,homeTeam,awayTeam,officialHomeTeam,officialAwayTeam,stadium,city,country,neutral,source,sourceUrl,verifiedAt,sourceStatus
2026-WC-GS-001,1,group,A,2026-06-11,,Mexico,South Africa,Mexico,South Africa,Mexico City Stadium,Mexico City,Mexico,FALSE,FIFA official match schedule article,...,2026-05-23,official_group_stage_replaced
```

说明：

- `homeTeam` / `awayTeam` 使用模型内部标准队名，保证 Elo、FIFA、阵容和身价数据能正确匹配。
- `officialHomeTeam` / `officialAwayTeam` 保存 FIFA 展示名，例如 `Korea Republic`、`Czechia`、`Türkiye`。
- `kickoffLocal` 暂时允许为空；如果之后从 FIFA 官方页稳定抓到开球时间，再补入。
- 淘汰赛完整 32 强交叉规则仍需单独接入，不能用小组赛文件替代。

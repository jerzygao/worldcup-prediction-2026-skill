# 数据源说明

最后检查时间：2026-05-20。

本文档用于给世界杯预测 Skill 排列数据源优先级。优先选择结构化、脚本可读取、稳定、并且能在开赛前获得的数据源。

## 推荐数据栈

| 数据类型 | 第一选择 | 模型用途 | 状态 |
|---|---|---:|---|
| 历史比赛结果 | `martj42/international_results` results CSV | 训练 / 回测 | 最优 |
| FIFA 排名 / 积分 | GitHub FIFA 排名 CSV 镜像，并与 FIFA 官方排名页交叉核验 | 特征 | 可用，需交叉核验 |
| Elo | 从历史结果本地重算，必要时与 World Football Elo Ratings 对照 | 特征 | 本地可控，最优 |
| 2026 赛程 / 场馆 | `wc26-mcp` 包或 FIFA 官方赛程页 | 模拟 / 休息 / 场地 | 可用 |
| 天气 / 气候 | Open-Meteo 预报和历史归档 API | 天气特征 | 可用 |
| 球队身价 | Transfermarkt 衍生公开数据集或人工整理快照 | 特征 | 有条件可用 |
| 游戏球员评分 | EA FC / SoFIFA 衍生数据集 | 阵容强度降级特征 | 有条件可用 |
| 赔率 | 付费赔率 API 或人工博彩公司 CSV 导入 | 市场特征 | 有条件可用 |
| 伤病 / 停赛 | 付费足球 API 或人工新闻追踪表 | 修正特征 | 有条件可用 |
| 战术风格 | 人工球探备注或可信分析数据集 | 初期仅作解释 | 后续加入 |

## 核心数据源计划

刷新比赛预测时，按以下顺序使用数据源。每个导入值都应尽可能保留 `source`、`sourceUrl`、`updatedAt` 和抓取时间。

| 优先级 | 数据 | 主来源 | 降级来源 | 当前处理方式 |
|---:|---|---|---|---|
| 1 | 历史结果 / 赛程 | `martj42/international_results` 原始 CSV | Zenodo 历史结果 | 已用于 Elo、近期状态和 2026 赛程框架 |
| 2 | Elo | 从结果 CSV 本地计算 | World Football Elo 作基准 | 已本地计算 |
| 3 | FIFA 排名 / 积分 | FIFA 官方排名页 + CSV 镜像 | 仅用最新 GitHub 镜像 | 已导入，支持排名降级 |
| 4 | 2026 赛程 / 场馆 | FIFA 官方赛程页 | `wc26-mcp@0.3.1` 包 | 小组赛已整理为 `data/manual/wc26-official-group-stage.csv`，淘汰赛路径仍需完整接入 |
| 5 | 赛前赔率 | The Odds API 世界杯接口 | API-FOOTBALL、BALLDONTLIE、OddsPortal 人工共识 | CSV 导入已准备，目前 72 场仍缺真实赛前赔率 |
| 6 | 阵容身价 | Transfermarkt 衍生公开快照 | 人工赛事阵容身价 CSV | 自动更新已准备，覆盖情况见 `team-strength-update-status.csv` |
| 7 | 阵容评分 / 战术画像 | 已核验 EA FC / SoFIFA 快照 | 由身价、Elo、FIFA、近期状态、名单状态和 wc26 画像派生代理值 | 48 队代理覆盖已完成，官方游戏评分仍为可选增强 |
| 8 | 伤病 / 停赛 | 官方球队/赛事报告、付费足球 API | 可靠新闻人工备注 | 未核验前仅作报告上下文 |
| 9 | 确认首发 | 开赛前 90 到 30 分钟的 FIFA/球队官方比赛中心 | 可信比赛中心首发 | 比赛日之前不用作硬输入 |
| 10 | 天气 | 临近开赛的 Open-Meteo 预报 API | 场馆历史气候 | 已作为未来特征预留 |

最小赛前刷新清单：

1. 市场开盘后，先刷新赔率。
2. 最终名单确定后，刷新阵容身价和游戏评分。
3. 开赛前 72 小时、24 小时、3 小时分别刷新伤病和停赛。
4. 开赛前 90 到 30 分钟刷新确认首发。
5. 开赛前 24 小时刷新天气，3 小时内再刷新一次热/雨风险。

如果关键来源不可用，保持字段为空，让流水线自动重新分配特征权重。不要编造数值。

Agent 使用规则：任何新预测或模拟前，先运行 `node scripts/agent-preflight-update.mjs`。如果无法运行，Agent 必须说明跳过了哪个更新步骤，并把结果标记为过期/离线结果。

当前更新命令：

```bash
node scripts/agent-preflight-update.mjs
node scripts/update-realtime-prematch-data.mjs
node scripts/update-team-strength-sources.mjs
node scripts/build-squad-tactical-profiles.mjs
node scripts/batch-predict-2026.mjs
node scripts/simulate-2026.mjs
node scripts/generate-report-2026.mjs
```

当前人工数据文件：

- `data/manual/match-odds.csv`：赛前赔率占位表。可靠赔率快照出现前保持为空。
- `data/manual/wc26-official-group-stage.csv`：小组赛官方赛程整理表。预测脚本优先读取该文件；模型队名保持内部标准名，同时保留 FIFA 展示名。
- `data/manual/team-strength.csv`：预测使用的 FIFA、身价和可选阵容评分输入。
- `data/manual/team-strength-update-status.csv`：身价和阵容评分覆盖报告。
- `data/manual/squad-rating-import.csv`：已核验游戏评分导入模板。空值会触发降级。
- `data/manual/team-tactical-profiles.csv`：派生阵容评分、优缺点、风格标签和对位输入。
- `data/manual/squad-position-ratings.csv`：从已校验外部候选批次导入的位置组代理评分；除非状态升级到 `derived_proxy` 以上，否则仅作上下文。
- `data/manual/wc26-squad-announcements.csv`：名单公布快照、来源 URL、状态、人数和模型使用限制。
- `data/manual/wc26-squad-players.csv`：解析出的名单球员行。`source_partial` 和 `source_conflict` 行在核验前只能作为报告上下文。
- `data/manual/wc26-availability.csv`：从已校验候选批次来的关键球员缺席、回归和健康上下文。`needs_verification` 行只能作为报告提示，不能作为硬模型输入。
- `data/manual/pre-match-update-status.csv`：每场比赛的赔率、天气、首发、伤病和降级状态。
- `data/manual/match-weather.csv`：进入预报窗口后的 Open-Meteo 比赛日天气快照。
- `data/manual/match-lineups.csv`：确认首发导入模板。
- `data/manual/match-injuries.csv`：已核验伤病/停赛导入模板。

实时更新环境变量：

```bash
ODDS_API_KEY=<The Odds API key>
```

没有该 key 时，赔率保持为空，状态表会记录 `missing_ODDS_API_KEY`。天气只会在比赛日期进入 Open-Meteo 预报窗口后更新。首发通常要等比赛日开赛前 90 到 30 分钟才可靠。

## 已测试数据源

### 历史比赛结果

**推荐：** GitHub 上 Mart Jürisoo 的 `international_results` CSV。

测试地址：

```text
https://raw.githubusercontent.com/martj42/international_results/master/results.csv
```

2026-05-19 检查结果：

- 脚本可读取 CSV。
- 总计 49,329 行。
- 49,257 场已有比分。
- 72 场未赛未来赛程。
- 已赛数据范围：1872-11-30 到 2026-03-31。
- 未赛行从 2026-06-11 开始。
- 字段包括 date、home team、away team、scores、tournament、city、country、neutral。

优先用于：

- 比赛历史结果
- 赛事过滤
- 中立场处理
- 近期状态计算
- 2026 赛程框架；训练时必须忽略 `NA` 比分行

限制：

- 未来赛程使用 `NA` 比分，必须排除出训练集。
- 不含赔率。
- 不含球员级数据。
- 球队名需要标准化。

**稳定备用：** Zenodo 国际足球结果 CSV。

测试地址：

```text
https://zenodo.org/records/5898313/files/results.csv?download=1
```

结果：

- 脚本可读取 CSV。
- 测试副本覆盖 1872 到 2020-09-08 的国际比赛。
- 字段包括 date、home team、away team、scores、tournament、city、country、neutral。
- 如果 GitHub 不可用，这是较好的归档备用。

限制：

- 比 GitHub 来源旧。
- 不含赔率。
- 不含球员级数据。
- 球队名需要标准化。

### FIFA 排名

**推荐：** 自动化时使用 CSV 镜像，再与 FIFA 官方排名页交叉核验。

测试地址：

```text
https://raw.githubusercontent.com/tadhgfitzgerald/fifa_ranking/master/fifa_ranking.csv
https://raw.githubusercontent.com/Dato-Futbol/fifa-ranking/refs/heads/master/ranking_fifa_historical.csv
```

结果：

- 两者都是脚本可读取 CSV。
- 第一个包含较详细排名字段。
- 第二个更简单，目前包含现代排名快照。

用于：

- `fifaPointsDiff`
- 排名趋势
- Elo 缺失时的强度降级特征

限制：

- GitHub 镜像可能落后于 FIFA 官方更新。
- 必须保存来源日期。
- 最终赛事预测前，应与 FIFA 官方页面交叉核验最新排名。

### Elo

**推荐：** 从历史结果数据集本地计算 Elo。

理由：

- Elo 是核心特征，Skill 应该控制计算逻辑。
- 本地 Elo 可以冻结在任意日期，避免赛后泄漏。
- 赛事权重、主场优势、中立场处理和 K 系数都可在回测中调优。

外部 Elo 只作基准，不作为唯一来源。

最小本地 Elo 字段：

```json
{
  "team": "France",
  "date": "2022-11-22",
  "eloBeforeMatch": 1994.2,
  "eloAfterMatch": 2001.8
}
```

### 2026 赛程和场馆

**推荐：** 用 `wc26-mcp` 提供 Agent 友好的 2026 上下文，同时用 FIFA 官方页面做最终核验。

测试包：

```text
wc26-mcp@0.3.1
```

包描述称其包含 2026 世界杯比赛、球队、场馆、画像、简报、伤病、赔率、积分榜和淘汰赛数据，且不需要 API key。

用于：

- 比赛列表
- 场馆城市
- 开球时间
- 小组和淘汰赛结构
- 主办城市元数据

限制：

- 只能视为便利来源，不是官方唯一真相。
- 赛程变化必须用 FIFA 官方页面核验。
- 包内赔率和伤病只能作为上下文，不应直接作为模型级市场数据。

### 天气

**推荐：** Open-Meteo API。

测试地址：

```text
https://api.open-meteo.com/v1/forecast?latitude=19.3029&longitude=-99.1505&daily=temperature_2m_max,precipitation_sum&timezone=auto
https://archive-api.open-meteo.com/v1/archive?latitude=25.7617&longitude=-80.1918&start_date=2022-06-01&end_date=2022-06-02&daily=temperature_2m_max,precipitation_sum&timezone=auto
```

结果：

- 脚本可读取 JSON。
- 预报 API 可用于未来天气。
- 归档 API 可用于历史天气。

用于：

- 高温风险
- 降雨风险
- 已知场馆坐标时的海拔/天气修正

限制：

- 距离赛事很久的天气只能当气候预期，不能当真实预报。
- 真实预报应在临近比赛日抓取。

### 球队身价

**推荐：** 保持为可导入快照，而不是实时爬页面。

候选来源：

```text
https://github.com/dcaribou/transfermarkt-datasets
```

该公开数据集提供 Transfermarkt 衍生 CSV/GZIP 文件。它适合球员和阵容估值，但国家队建模仍需要把球员映射到国家队和赛事名单。

用于：

- 球队总身价
- 已知首发时的首发身价
- 位置组强度

限制：

- Transfermarkt 本身不是官方开放 API。
- 公开镜像可能不反映最终世界杯名单。
- 国家队成员关系需要严格的快照日期。

MVP 做法：

- 每届赛事/球队人工整理一个 CSV 快照。
- 保留字段：team、player、position、age、marketValue、likelyStarter、status、snapshotDate、sourceUrl。

### 游戏球员评分

当真实身价或可靠阵容身价快照缺失时，游戏评分可以作为降级特征。它代表 **阵容强度**，不是实际市场价格。

候选来源：

```text
https://www.ea.com/games/ea-sports-fc/ratings
https://sofifa.com/document
https://api.sofifa.net/player/{id}
https://www.kaggle.com/datasets/sametozturkk/ea-sports-fc-25-real-player-data-sofifa-merge
https://www.kaggle.com/datasets/yusufaltunbas/fc25-players-ratings
https://www.futbin.com/25/players
https://www.fut.gg/25/players/
```

用于：

- 球队平均总评
- 可能首发 11 人平均评分
- 位置组评分：进攻、中场、防守、门将
- 明星球员数量，例如总评 >= 85 的球员数
- 深度评分，例如前 23 人平均

推荐派生字段：

```json
{
  "team": "France",
  "ratingSource": "EA FC / SoFIFA snapshot",
  "snapshotDate": "2026-06-01",
  "top23AverageOverall": 82.4,
  "starting11AverageOverall": 84.1,
  "attackRating": 86.2,
  "midfieldRating": 83.5,
  "defenseRating": 82.8,
  "goalkeeperRating": 85,
  "starPlayerCount85Plus": 6
}
```

限制：

- 游戏评分是编辑/球探性质评分，不是市场价格。
- 更新可能滞后于伤病、状态和最终赛事名单。
- 爬取游戏数据库站点不稳定；优先使用可下载数据集或人工保存快照。
- 不要把该特征和身价混成一个名字。应使用 `squadRatingDiff`，不要写成 `marketValueDiff`。

### 赔率

**推荐：** 严肃预测时，赔率要么作为必需 CSV 导入，要么使用付费赔率 API。

原因：

- 免费、稳定、历史国家队赔率数据很弱。
- 俱乐部联赛赔率网站只能作例子，不能解决世界杯覆盖。
- 赔率价值高，但授权和覆盖范围很重要。

MVP 赔率结构：

```json
{
  "matchId": "2026-001",
  "bookmaker": "manual-consensus",
  "homeOdds": 2.1,
  "drawOdds": 3.3,
  "awayOdds": 3.6,
  "timestamp": "2026-06-10T12:00:00Z"
}
```

建模前必须用 `scripts/clean-odds.mjs` 清洗赔率。

可用的赛前或实时赔率地址：

```text
The Odds API World Cup:
https://the-odds-api.com/sports/fifa-world-cup-odds.html
https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds

BALLDONTLIE FIFA World Cup API odds:
https://fifa.balldontlie.io/
https://api.balldontlie.io/fifa/worldcup/v1/odds

API-FOOTBALL odds docs:
https://www.api-football.com/documentation-v3#tag/Odds-(Pre-Match)
https://www.api-football.com/documentation-v3#tag/Odds-(Live)

OddsPortal World Cup page:
https://www.oddsportal.com/football/world/world-cup-2026/
```

实际建议：

- 稳定自动化优先使用真实赔率 API。
- 人工核验或应急降级时使用 OddsPortal 页面。
- 开赛前保存赔率快照和时间戳。
- 实时赔率需要连续保存快照；很多 API 赛后不会保留完整实时赔率历史。

赔率降级顺序：

1. 付费 API 的多博彩公司共识赔率。
2. 单一高流动性博彩公司赔率。
3. OddsPortal 人工核验共识。
4. 无赔率：把赔率权重重新分配给 Elo、FIFA 积分、阵容强度和近期状态。

### 伤病和停赛

**推荐：** 没有可靠来源前，不要放入 v1 模型权重。

v1 中只作为报告上下文或人工修正使用。

好的伤病数据需要：

- 球员
- 球队
- 状态
- 预计回归时间
- 来源时间戳
- 重要性 / 首发概率

如果拿不到可靠数据，不要编造伤病影响。

## v1 暂不采用的数据

| 来源类型 | 原因 |
|---|---|
| 没有结构化数据的纯 AI 预测 | 不可复现，难以回测 |
| 历史交锋作为主要特征 | 通常样本太少，容易过拟合 |
| 实时爬 Transfermarkt 页面 | 脆弱，容易失效 |
| 社交媒体伤病传闻 | 难核验，噪声大 |
| 提前数月的长期天气预报 | 不够可靠，不能作为模型特征 |

## 第一条数据流水线

1. 从 Zenodo 或 GitHub 下载历史国际比赛结果。
2. 从历史结果构建本地 Elo 快照。
3. 从 CSV 镜像导入 FIFA 排名快照，必要时与 FIFA 官方排名交叉核验。
4. 导入或人工整理身价快照。
5. 有赔率时导入赔率 CSV。
6. 从 `wc26-mcp` 或 FIFA 官方页面抓取 2026 赛程/场馆。
7. 临近比赛日从 Open-Meteo 抓取天气。
8. 生成特征并运行 `scripts/weight-search.mjs`。

## 缺失数据降级策略

用分层降级代替阻塞预测：

| 缺失数据 | 第一降级 | 第二降级 | 最终降级 |
|---|---|---|---|
| 赔率 | 临近开赛抓取赛前 API 赔率 | OddsPortal 人工共识 | 重新分配赔率权重 |
| 身价 | Transfermarkt 衍生快照 | EA FC / SoFIFA 阵容评分 | 重新分配阵容权重 |
| 伤病 | 付费 API 或可信追踪表 | 人工比赛日备注 | 伤病影响设为 0 并披露 |
| FIFA 积分 | 最新 CSV 镜像 | FIFA 官方页面人工核验 | 只使用 Elo |
| 天气 | Open-Meteo 预报 | 场馆历史气候 | 天气修正设为 0 |
| 首发 | 临近开赛官方首发 | 可信前瞻可能首发 | 使用整体阵容评分 / 身价 |

发生降级时，报告必须说明缺了哪些特征，以及使用了什么替代方案。

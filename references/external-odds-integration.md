# External Odds Data Integration (Generic)

Generic patterns for integrating external odds data into a prediction pipeline. These supplement the World Cup-specific odds handling documented in the main SKILL.md.

## Supported Sources

### 1. The Odds API (recommended primary)
- **URL**: `https://api.the-odds-api.com/v4/sports/{sport}/odds`
- **Auth**: API key via `apiKey` query param. Env var: `ODDS_API_KEY`
- **Regions**: `us,eu,uk` (comma-delimited)
- **Markets**: `h2h` (head-to-head), `spreads`, `totals`
- **Format**: `decimal` (preferred) or `american`
- **Pricing**: Free tier 500 credits/month (~16/day). A single call with `regions=us,eu,uk&markets=h2h` costs 3 credits
- **Track quota**: Read `X-Requests-Remaining` response header
- **Output format**: JSON array with `home_team`, `away_team`, `bookmakers[].markets[].outcomes[]`
- **Pros**: Stable API, consistent format, straightforward team name matching

### 2. Titan007 / 球探网 (free web scraping, Asian market)
- **Base URL**: `https://2026.titan007.com/`
- **Match schedule**: Parse `<a>` href for match IDs from homepage
- **European odds (JS interface, preferred)**: `https://1x2d.titan007.com/{matchId}.js`
  - Structured `var game=Array(...)` format, GBK/GB2312 encoded
  - 180+ Asian-facing bookmakers per match
- **Asian handicap**: `https://vip.titan007.com/AsianOdds_n.aspx?id={matchId}`
- **Over/Under**: `https://vip.titan007.com/OverDown_n.aspx?id={matchId}`
- **Historical analysis**: `https://zq.titan007.com/analysis/{matchId}cn.htm`
- **Encoding**: Attempt UTF-8 first; fallback to iconv-lite GB2312/GBK
- **Pros**: Free, no API key, Asian handicap data, 180+ bookmakers
- **Cons**: Web scraping (fragile), Chinese team names need mapping

### 3. Chinese Lottery (lottery.gov.cn) — JS-rendered
- **URL**: `https://www.lottery.gov.cn/jc/index.html` (schedule)
- **Odds page is JS SPA** — direct curl returns "统一错误页". Browser session required
- **Match codes**: Format `周XNNN` (e.g. 周四001)
- **Betting types**: 胜平负, 让球胜平负, 比分, 总进球数, 半全场
- **Team name truncations**: 阿尔及利→阿尔及利亚, 刚果金→刚果民主共和国, 乌兹别克→乌兹别克斯坦, 沙特→沙特阿拉伯, 哥斯达→哥斯达黎加

## Asian Handicap Signal Interpretation

| Indicator | Chinese | What it means | Signal |
|-----------|---------|---------------|--------|
| Up count | 升盘数 | Companies raising the handicap line | Up >> Down → favor favorite |
| Down count | 降盘数 | Companies lowering the handicap line | Down >> Up → favor underdog |
| High water | 高水数 | Favorite's odds are high (resistance) | Low >> High → favorite safe |
| Low water | 低水数 | Favorite's odds are low (pressure) | High >> Low → favorite has resistance |

The `>>` symbol means "远大于 / 显著多于" — only counts as a signal when one side far exceeds the other.

## Zero-Invasive Architecture

When the host pipeline may receive upstream updates:
1. **ADD new files only** — never modify the host's core prediction scripts
2. **Post-process instead of re-model** — run after the host pipeline, adjust outputs
3. **Hook into data input points** — write additional rows to existing CSV formats
4. **Wrapper scripts** — create a single entry-point that calls the host pipeline then your additions

## Common Pitfalls

### Titan007 Date Field Missing
`titan007-match-ids.csv` often lacks a `date` column. When writing to `match-odds.csv`, look up the date from the fixtures CSV by `homeTeam|awayTeam` match. Without a date, the prediction pipeline's `date|homeTeam|awayTeam` key matching fails silently.

### Multi-Source CSV Overwrite Conflicts
When multiple scripts write to the same CSV (e.g., Odds API + Titan007), never use full overwrite mode. Use key-based merge: key = `date|homeTeam|awayTeam|bookmaker`. Different bookmaker values naturally prevent cross-source overwrites.

### Per-Company vs Aggregate
180+ bookmakers allow variance/consensus analysis, not just averages. High odds variance = low market consensus = higher prediction uncertainty.

### Rate Limiting
- Titan007: No strict limits, but 1-2 req/sec is good practice
- The Odds API: Track `X-Requests-Remaining` header
- 429: Read `Retry-After` header, wait, retry once, then skip

## Reference Implementations
- [betdog-skill](https://github.com/yuchenyang1994/betdog-skill) — titan007 data scraper reference. Note: its `package.json` has a trailing comma in `keywords` array (invalid JSON), fix before `npm install`.

# 竞彩波胆（正确比分）+ 让球胜平负 数据采掘方案

## 数据源

竞彩官网开放 API（无身份验证，加 Referer 头即可）：

| poolCode | 数据 | 端点 | WAF |
|----------|------|------|-----|
| `crs` | 波胆（31种正确比分赔率） | `getMatchCalculatorV1.qry?channel=c&poolCode=crs` | 无（直接调） |
| `hhad` | 让球胜平负（让球数 + 三方向赔率） | `getMatchCalculatorV1.qry?channel=c&poolCode=hhad` | 需 `Referer` 头 |

**完整 URL：**
```
GET https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry?channel=c&poolCode=crs
GET https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry?channel=c&poolCode=hhad
```

**必要请求头：**
```
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36
Accept: application/json
Referer: https://www.sporttery.cn/jc/jsq/zqbf/   ← hhad 必须有，crs 不需要
```

## CRS（波胆）字段映射

返回的 `crs` 对象中，键名格式 `s{h}s{a}`，其中 `h`=主队进球数，`a`=客队进球数：

```
s00s00 → "0:0"
s01s00 → "1:0"    (主1客0)
s02s00 → "2:0"
s02s01 → "2:1"
s02s02 → "2:2"
s03s00 → "3:0"
s03s03 → "3:3"
s00s01 → "0:1"    (主0客1)
s00s02 → "0:2"
s01s02 → "1:2"
...
s1sh   → "胜其它"   (home win other)
s1sd   → "平其它"   (draw other)
s1sa   → "负其它"   (away win other)
```

完整31种比分（按展示顺序）：

**胜（13种）：** 1:0, 2:0, 2:1, 3:0, 3:1, 3:2, 4:0, 4:1, 4:2, 5:0, 5:1, 5:2, 胜其它

**平（5种）：** 0:0, 1:1, 2:2, 3:3, 平其它

**负（13种）：** 0:1, 0:2, 1:2, 0:3, 1:3, 2:3, 0:4, 1:4, 2:4, 0:5, 1:5, 2:5, 负其它

每个值均为 float（欧式赔率，如 4.0 代表赔4倍）。

## HHAD（让球胜平负）字段

```json
"hhad": {
  "goalLine": "-1",      // 让球数，负=主队让球，正=主队受让
  "goalLineValue": "-1.00",
  "h": "2.70",           // 让球后主胜赔率
  "d": "3.26",           // 让球后平赔率
  "a": "2.21",           // 让球后客胜赔率
  "hf": "0",             // 标志位(未知)
  "df": "0",
  "af": "0",
  "updateDate": "2026-06-13",
  "updateTime": "11:37:21"
}
```

**goalLine 解读：**
- `-1` = 主队让1球（德国 vs 库拉索: 让-3 = 德国让3球）
- `+1` = 主队受让1球（卡塔尔 vs 瑞士: 让+2 = 卡塔尔受让2球）
- `0` = 平手盘

## 队名返回格式

所有队名返回**中文全名**：
- "巴西"、"摩洛哥"
- "刚果(金)"（含括号！注意转义）
- "乌兹别克斯坦"（非"乌兹别克"）
- "沙特阿拉伯"（非"沙特"）
- "阿尔及利亚"（非"阿尔及利"）

## 脚本

### fetch-jingcai-odds.py（推荐，取代旧版）

同时拉取 crs + hhad，合并输出到 `data/jingcai-odds.json`。

关键代码逻辑：
```python
# 分两次调 API，按 matchId 合并在匹配条目
for mid in sorted(all_match_ids):
    m_crs = crs_data.get(mid, {})
    m_hhad = hhad_data.get(mid, {})
    # crs 提供基本信息 + scores
    # hhad 提供 handicap 数据
```

### fetch-jingcai-score-odds.py（旧版，仅crs，已废弃）

已不推荐使用。被 `fetch-jingcai-odds.py` 替代。

## 常见问题

### 让球数据为空？
`extract_hhad()` 只读 `hhad` 字段，来自 `poolCode=hhad` 的 API 响应。如果 `m = crs_data.get(mid) or hhad_data.get(mid)` 短路取到了 crs（不含 hhad），手环数据就丢了。**必须分开取两个响应然后合并字段**，不能 `or` 短路。

### poolCode=hhad 返回 403？
缺少 `Referer` 头。竞彩 WAF 对 `hhad` 端点的检查比对 `crs` 更严，必须加 `Referer: https://www.sporttery.cn/jc/jsq/zqbf/`。

### 队名有括号怎么办？
"刚果(金)" 的括号是普通 ASCII 括号，不是正则特殊字符。Python 字符串比较直接按字面匹配即可。

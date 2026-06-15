#!/usr/bin/env python3
"""fetch-jingcai-odds.py — 同时拉取竞彩波胆(crs) + 让球(hhad)数据

API: webapi.sporttery.cn 开放 JSON（无需 token）
poolCode: crs(波胆31种比分赔率) + hhad(让球胜平负)

用法: python3 scripts/fetch-jingcai-odds.py
输出: data/jingcai-odds.json (+ data/jingcai-score-odds.json 向后兼容)
"""

import json, os, sys, time, ssl, urllib.request, urllib.error

BASE_URL = "https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
REFERER = "https://www.sporttery.cn/jc/jsq/zqbf/"

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT = os.path.join(BASE_DIR, "data", "jingcai-odds.json")
OUTPUT_SCORE = os.path.join(BASE_DIR, "data", "jingcai-score-odds.json")

# SSL context (sporttery.cn has government CA)
SSL_CTX = ssl._create_unverified_context()

# CRS 键名 → 可读比分
CRS_KEY_MAP = {}
for h in range(6):
    for a in range(6):
        if h > a or h < a or h == a:
            CRS_KEY_MAP[f"s{h:02d}s{a:02d}"] = f"{h}:{a}"
CRS_KEY_MAP["s1sh"] = "胜其它"
CRS_KEY_MAP["s1sd"] = "平其它"
CRS_KEY_MAP["s1sa"] = "负其它"

# 31种比分分类
HOME_SCORES = ["1:0","2:0","2:1","3:0","3:1","3:2","4:0","4:1","4:2","5:0","5:1","5:2","胜其它"]
DRAW_SCORES = ["0:0","1:1","2:2","3:3","平其它"]
AWAY_SCORES = ["0:1","0:2","1:2","0:3","1:3","2:3","0:4","1:4","2:4","0:5","1:5","2:5","负其它"]


def fetch(pool_code, need_referer=False):
    url = f"{BASE_URL}?channel=c&poolCode={pool_code}"
    headers = {"User-Agent": UA, "Accept": "application/json"}
    if need_referer:
        headers["Referer"] = REFERER
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15, context=SSL_CTX) as resp:
            body = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"  ❌ HTTP {e.code} on {pool_code}")
        print(f"     {e.read().decode()[:300]}")
        return []
    except Exception as e:
        print(f"  ❌ Error on {pool_code}: {e}")
        return []

    # Navigate: value → matchInfoList → [subMatchList → [...matches...]]
    v = body.get("value", body)
    matches = []
    for day in v.get("matchInfoList", []):
        for sm in day.get("subMatchList", []):
            matches.append(sm)
    print(f"  ✓ {pool_code}: {len(matches)} total")
    return matches


def extract_match(sm, hhad_data=None):
    hn = sm.get("homeTeamAllName") or sm.get("homeTeamAbbName", "")
    an = sm.get("awayTeamAllName") or sm.get("awayTeamAbbName", "")

    # CRS scores
    scores = {}
    crs = sm.get("crs", {})
    for key, val in crs.items():
        name = CRS_KEY_MAP.get(key)
        if name:
            try:
                scores[name] = float(val)
            except (ValueError, TypeError):
                pass

    # HHAD
    handicap = None
    if hhad_data:
        try:
            handicap = {
                "goalLine": int(hhad_data.get("goalLine", "0") or 0),
                "homeOdds": float(hhad_data.get("h") or 0),
                "drawOdds": float(hhad_data.get("d") or 0),
                "awayOdds": float(hhad_data.get("a") or 0),
            }
        except (ValueError, TypeError):
            handicap = None

    return {
        "matchId": sm.get("matchId", ""),
        "matchNumStr": sm.get("matchNumStr", ""),
        "homeTeam": hn,
        "awayTeam": an,
        "matchDate": sm.get("matchDate", sm.get("businessDate", "")),
        "scores": scores,
        "oddsCount": len(scores),
        "handicap": handicap,
    }


def main():
    print("=== 竞彩数据拉取（波胆 + 让球）===\n")

    print("[1/2] Fetching crs (correct scores)...")
    crs_list = fetch("crs")
    time.sleep(0.5)

    print("[2/2] Fetching hhad (handicap)...")
    hhad_list = fetch("hhad", need_referer=True)

    # Build hhad index
    hhad_index = {}
    for sm in hhad_list:
        hhad_index[sm.get("matchId", "")] = sm.get("hhad", {})

    # Extract all matches (filter for World Cup via have CRS data)
    matches = []
    for sm in crs_list:
        m = extract_match(sm, hhad_index.get(sm.get("matchId", "")))
        # Only include if it has actual odds data
        if m["oddsCount"] > 0:
            matches.append(m)

    # Sort by matchNumStr
    matches.sort(key=lambda m: m.get("matchNumStr", ""))

    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)

    result = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "source": "webapi.sporttery.cn",
        "matches": matches,
        "count": len(matches),
    }
    with open(OUTPUT, "w") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    # Backward compat
    compat = {
        "generatedAt": result["generatedAt"],
        "source": result["source"],
        "matches": [{
            "homeTeam": m["homeTeam"],
            "awayTeam": m["awayTeam"],
            "matchId": m["matchId"],
            "matchNumStr": m["matchNumStr"],
            "matchDate": m["matchDate"],
            "scores": m["scores"],
        } for m in matches],
    }
    with open(OUTPUT_SCORE, "w") as f:
        json.dump(compat, f, ensure_ascii=False, indent=2)

    print(f"\n✓ 保存: {len(matches)} 场")
    for m in matches:
        hh = m.get("handicap") or {}
        gl = hh.get("goalLine", 0) if hh else 0
        if gl < 0:    gl_desc = f"让{-gl}球"
        elif gl > 0:  gl_desc = f"受让{gl}球"
        else:         gl_desc = "平手"
        has_hhad = f"hhad:{gl_desc}({hh.get('homeOdds','?'):.2f}/{hh.get('drawOdds','?'):.2f}/{hh.get('awayOdds','?'):.2f})" if hh else "hhad:—"
        print(f"  {m['matchNumStr']:6s} {m['homeTeam']:8s} vs {m['awayTeam']:8s}  "
              f"crs:{m['oddsCount']}种  {has_hhad}")

    print(f"\n已保存: {OUTPUT}")
    print(f"已保存: {OUTPUT_SCORE}")


if __name__ == "__main__":
    main()

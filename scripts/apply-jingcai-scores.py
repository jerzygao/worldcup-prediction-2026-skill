"""apply-jingcai-scores.py

【模型方向 + 竞彩波胆】混合比分预测

逻辑：
1. 模型算胜负平概率 → 确定方向（主胜/平/客胜）
2. 竞彩波胆赔率 → 在该方向内选赔率最低的比分
3. 方向判断标准：homeWin = max → 主胜，draw = max → 平，awayWin = max → 客胜

用法: python3 scripts/apply-jingcai-scores.py
输入: match-predictions-2026.json + data/jingcai-score-odds.json
输出: match-predictions-2026.json (原地更新 predictedScore + 新增 jingcaiScoreOdds)
"""

import json
import os
import shutil

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if not os.path.exists(os.path.join(BASE_DIR, "match-predictions-2026.json")):
    BASE_DIR = os.getcwd()
PRED_FILE = os.path.join(BASE_DIR, "output", "match-predictions-2026.json")
JC_FILE = os.path.join(BASE_DIR, "data", "jingcai-score-odds.json")

# 队名映射：英文 → 竞彩中文
EN_TO_CN = {
    "Algeria": "阿尔及利亚", "Argentina": "阿根廷",
    "Australia": "澳大利亚", "Austria": "奥地利",
    "Belgium": "比利时", "Bosnia and Herzegovina": "波黑",
    "Brazil": "巴西", "Canada": "加拿大",
    "Cape Verde": "佛得角", "Colombia": "哥伦比亚",
    "Croatia": "克罗地亚", "Curaçao": "库拉索",
    "Czech Republic": "捷克", "DR Congo": "刚果(金)",
    "Ecuador": "厄瓜多尔", "Egypt": "埃及",
    "England": "英格兰", "France": "法国",
    "Germany": "德国", "Ghana": "加纳",
    "Haiti": "海地", "Iran": "伊朗",
    "Iraq": "伊拉克", "Ivory Coast": "科特迪瓦",
    "Japan": "日本", "Jordan": "约旦",
    "Mexico": "墨西哥", "Morocco": "摩洛哥",
    "Netherlands": "荷兰", "New Zealand": "新西兰",
    "Norway": "挪威", "Panama": "巴拿马",
    "Paraguay": "巴拉圭", "Portugal": "葡萄牙",
    "Qatar": "卡塔尔", "Saudi Arabia": "沙特阿拉伯",
    "Scotland": "苏格兰", "Senegal": "塞内加尔",
    "South Africa": "南非", "South Korea": "韩国",
    "Spain": "西班牙", "Sweden": "瑞典",
    "Switzerland": "瑞士", "Tunisia": "突尼斯",
    "Turkey": "土耳其", "United States": "美国",
    "Uruguay": "乌拉圭", "Uzbekistan": "乌兹别克斯坦",
}

HOME_SCORES = ["1:0", "2:0", "2:1", "3:0", "3:1", "3:2",
               "4:0", "4:1", "4:2", "5:0", "5:1", "5:2", "胜其它"]
DRAW_SCORES = ["0:0", "1:1", "2:2", "3:3", "平其它"]
AWAY_SCORES = ["0:1", "0:2", "1:2", "0:3", "1:3", "2:3",
               "0:4", "1:4", "2:4", "0:5", "1:5", "2:5", "负其它"]


def find_best_score(scores, direction):
    pool = HOME_SCORES if direction == "home" else \
           DRAW_SCORES if direction == "draw" else AWAY_SCORES
    best, best_odds = None, 99999
    for sc in pool:
        odds = scores.get(sc)
        if odds and 0 < odds < best_odds:
            best_odds = odds
            best = sc
    return best or ""


def determine_direction(hw, d, aw):
    if hw >= d and hw >= aw: return "home"
    elif d >= hw and d >= aw: return "draw"
    else: return "away"


def fmt(s):
    if s == "胜其它": return "3-0"
    if s == "平其它": return "1-1"
    if s == "负其它": return "0-1"
    return s.replace(":", "-")


def main():
    with open(PRED_FILE) as f:
        pred = json.load(f)
    with open(JC_FILE) as f:
        jc_data = json.load(f)

    jc_index = {f"{m['homeTeam']}|{m['awayTeam']}": m for m in jc_data["matches"]}

    match_objects = []
    def collect(obj):
        if isinstance(obj, dict):
            if "predictedScore" in obj and "homeTeam" in obj:
                match_objects.append(obj)
            for v in obj.values(): collect(v)
        elif isinstance(obj, list):
            for item in obj: collect(item)
    collect(pred)

    updated, skipped, nomatch = 0, 0, 0
    for m in match_objects:
        hc, ac = EN_TO_CN.get(m["homeTeam"], ""), EN_TO_CN.get(m["awayTeam"], "")
        if not hc or not ac:
            skipped += 1; continue
        jc = jc_index.get(f"{hc}|{ac}")
        if not jc or not jc.get("scores"):
            nomatch += 1; continue

        scores = jc["scores"]
        direction = determine_direction(m.get("homeWin",0), m.get("draw",0), m.get("awayWin",0))
        best_label = find_best_score(scores, direction)
        if not best_label:
            nomatch += 1; continue

        new_score = fmt(best_label)
        old_score = m.get("predictedScore", "")
        m["predictedScore"] = new_score
        m["jingcaiScoreOdds"] = {
            "source": "竞彩官网波胆",
            "scoreLabel": best_label,
            "odds": scores.get(best_label),
            "direction": direction,
            "homeWin": m.get("homeWin", 0),
            "draw": m.get("draw", 0),
            "awayWin": m.get("awayWin", 0),
            "allScores": scores,
        }
        ov = m.get("modelVersion", "")
        if "jingcai-crs" not in ov:
            m["modelVersion"] = ov + " | jingcai-crs"
        updated += 1

        chk = "=" if new_score == old_score else "✓"
        print(f"  {chk} {m['homeTeam']} vs {m['awayTeam']}: {old_score} → {new_score} [{direction}] "
              f"(竞彩: {best_label}@{scores.get(best_label)})")

    shutil.copy2(PRED_FILE, PRED_FILE + ".bak")
    with open(PRED_FILE, "w") as f:
        json.dump(pred, f, ensure_ascii=False, indent=2)
    print(f"\n[*] 备份 → {PRED_FILE}.bak")
    print(f"[*] {updated} 场更新, {nomatch} 场无竞彩, {skipped} 场跳过")


if __name__ == "__main__":
    main()

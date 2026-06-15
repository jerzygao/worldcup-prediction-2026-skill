#!/usr/bin/env python3
"""generate-betting-report.py — 生成竞彩推荐报告（Markdown）

读取 match-predictions-2026.json + jingcai-odds.json + jingcai-schedule.json
输出: output/jingcai-betting-report.md
"""

import json, os
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRED_FILE = os.path.join(BASE_DIR, "output", "match-predictions-2026.json")
JC_ODDS_FILE = os.path.join(BASE_DIR, "data", "jingcai-odds.json")
JC_SCHEDULE = os.path.join(BASE_DIR, "data", "manual", "jingcai-schedule.json")
OUTPUT = os.path.join(BASE_DIR, "output", "jingcai-betting-report.md")

EN_TO_CN = {
    "Algeria": "阿尔及利亚", "Argentina": "阿根廷", "Australia": "澳大利亚",
    "Austria": "奥地利", "Belgium": "比利时", "Bosnia and Herzegovina": "波黑",
    "Brazil": "巴西", "Canada": "加拿大", "Cape Verde": "佛得角",
    "Colombia": "哥伦比亚", "Croatia": "克罗地亚", "Curaçao": "库拉索",
    "Czech Republic": "捷克", "DR Congo": "刚果(金)", "Ecuador": "厄瓜多尔",
    "Egypt": "埃及", "England": "英格兰", "France": "法国",
    "Germany": "德国", "Ghana": "加纳", "Haiti": "海地",
    "Iran": "伊朗", "Iraq": "伊拉克", "Ivory Coast": "科特迪瓦",
    "Japan": "日本", "Jordan": "约旦", "Mexico": "墨西哥",
    "Morocco": "摩洛哥", "Netherlands": "荷兰", "New Zealand": "新西兰",
    "Norway": "挪威", "Panama": "巴拿马", "Paraguay": "巴拉圭",
    "Portugal": "葡萄牙", "Qatar": "卡塔尔", "Saudi Arabia": "沙特阿拉伯",
    "Scotland": "苏格兰", "Senegal": "塞内加尔", "South Africa": "南非",
    "South Korea": "韩国", "Spain": "西班牙", "Sweden": "瑞典",
    "Switzerland": "瑞士", "Tunisia": "突尼斯", "Turkey": "土耳其",
    "United States": "美国", "Uruguay": "乌拉圭", "Uzbekistan": "乌兹别克斯坦",
}

CN_ALIASES = {"乌兹别克": "乌兹别克斯坦", "沙特": "沙特阿拉伯", "刚果金": "刚果(金)"}


def cn(name):
    """英文队名→中文"""
    return EN_TO_CN.get(name, name)


def jc_cn(name):
    """中文队名标准化"""
    return CN_ALIASES.get(name, name)


def gl_desc(goal_line):
    if goal_line < 0:
        return f"让{-goal_line}球"
    elif goal_line > 0:
        return f"受让{goal_line}球"
    return "平手"


def hhad_recommend(hh):
    """让球推荐：赔率最低的方向"""
    if not hh:
        return None, 0
    home, draw, away = hh.get("homeOdds", 0), hh.get("drawOdds", 0), hh.get("awayOdds", 0)
    if home <= draw and home <= away:
        return "让球胜", home
    elif draw <= home and draw <= away:
        return "让球平", draw
    else:
        return "让球负", away


def top_scores(scores, n=3):
    """赔率最低的 n 个比分（模型方向内的高赔优先？不，直接取最低赔率）"""
    items = [(k, v) for k, v in scores.items() if v > 0]
    items.sort(key=lambda x: x[1])
    return items[:n]


def main():
    with open(PRED_FILE) as f:
        pred_data = json.load(f)
    with open(JC_ODDS_FILE) as f:
        jc_data = json.load(f)
    with open(JC_SCHEDULE) as f:
        jc_schedule = json.load(f)

    preds = pred_data["predictions"]
    jc_matches = jc_data["matches"]

    # Build jingcai index by matchNumStr
    jc_by_code = {}
    for m in jc_matches:
        jc_by_code[m["matchNumStr"]] = m

    # Build schedule index
    sched_by_code = {}
    for s in jc_schedule:
        sched_by_code[s["code"]] = s

    # Build prediction index by cn team names
    pred_by_cn = {}
    for p in preds:
        hc = cn(p["homeTeam"])
        ac = cn(p["awayTeam"])
        pred_by_cn[f"{hc}|{ac}"] = p

    lines = []
    lines.append("# 世界杯竞彩推荐方案")
    lines.append("")
    lines.append(f"> 生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M')}（北京时间）")
    lines.append(f"> 数据来源: webapi.sporttery.cn + Titan007 共识赔率 + 多因子概率模型")
    lines.append("")
    lines.append("---")
    lines.append("")

    # Group by API matchDate (more accurate than schedule date)
    matches_by_date = {}
    for jc in jc_schedule:
        code = jc["code"]
        jm = jc_by_code.get(code)
        if not jm:
            continue
        hc = jc_cn(jc["home"])
        ac = jc_cn(jc["away"])
        pred = pred_by_cn.get(f"{hc}|{ac}")
        if not pred:
            continue
        # Use API matchDate for grouping
        api_date = jm.get("matchDate", jc["date"])
        matches_by_date.setdefault(api_date, []).append((jc, jm, pred))

    # Output by date
    for date in sorted(matches_by_date.keys()):
        items = matches_by_date[date]
        lines.append(f"## {date}")
        lines.append("")

        for jc, jm, p in items:
            code = jc["code"]
            hc = jc_cn(jc["home"])
            ac = jc_cn(jc["away"])
            kickoff = jc["time"]

            # Model probs
            hw = p.get("homeWin", 0) * 100
            dw = p.get("draw", 0) * 100
            aw = p.get("awayWin", 0) * 100
            best_dir = max([(hw, "主胜"), (dw, "平局"), (aw, "客胜")], key=lambda x: x[0])

            # Jingcai handicap
            hh = jm.get("handicap") or {}
            rec, best_odds = hhad_recommend(hh)

            # Top scores
            scores = jm.get("scores", {})
            top3 = top_scores(scores, 3)

            # Match info
            lines.append(f"### {code} {hc} vs {ac}")
            lines.append(f"**开赛:** {kickoff}（北京时间）")
            lines.append("")
            lines.append("| 项目 | 详情 |")
            lines.append("|------|------|")
            lines.append(f"| 模型概率 | 主{hw:.1f}% / 平{dw:.1f}% / 客{aw:.1f}% |")
            lines.append(f"| 模型方向 | **{best_dir[1]}**（{best_dir[0]:.1f}%） |")
            lines.append(f"| 预测比分 | {p.get('predictedScore', '?')} |")

            # Confidence
            conf = p.get("confidence", "?")
            lines.append(f"| 置信度 | {conf} |")

            # SPF recommendation
            if best_dir[0] >= 50 and best_dir[1] != "平局":
                lines.append(f"| 🎯 单场推荐 | **{best_dir[1]}**（概率 {best_dir[0]:.1f}% ≥ 50%） |")
            elif best_dir[0] >= 50 and best_dir[1] == "平局":
                lines.append(f"| 🎯 单场推荐 | **平局**（概率 {best_dir[0]:.1f}% ≥ 50%） |")

            # Handicap
            if hh:
                gl = hh.get("goalLine", 0)
                lines.append(f"| 🏹 让球盘 | **{gl_desc(gl)}** / 赔率: {hh.get('homeOdds',0):.2f} | {hh.get('drawOdds',0):.2f} | {hh.get('awayOdds',0):.2f} |")
                if rec:
                    lines.append(f"| 🏹 让球推荐 | **{rec}** @ {best_odds:.2f} |")

            # Score odds top 3
            if top3:
                score_str = " / ".join(f"{s} ({o:.2f})" for s, o in top3)
                lines.append(f"| ⚽ 波胆 Top3 | {score_str} |")

            lines.append("")

        # Check for accumulator opportunity
        if len(items) >= 2:
            high_conf = [(jc, p) for jc, _, p in items if p.get("homeWin", 0) >= 0.5 or p.get("awayWin", 0) >= 0.5]
            if high_conf:
                teams = [f"{jc_cn(jc['home'])} vs {jc_cn(jc['away'])}" for jc, _ in high_conf]
                lines.append(f"💡 **当日过关机会:** {len(high_conf)}/{len(items)} 场概率 ≥50%，{len(teams)}场可组合")
                lines.append("")

    # Accumulator section
    lines.append("---")
    lines.append("")
    lines.append("## 过关方案推荐")
    lines.append("")
    lines.append("> 仅精选模型方向明确（概率 ≥50%）且 handicap 无反向信号的场次。")
    lines.append("")

    all_high = []
    for date in sorted(matches_by_date.keys()):
        for jc, jm, p in matches_by_date[date]:
            hw = p.get("homeWin", 0) * 100
            aw = p.get("awayWin", 0) * 100
            if hw >= 55:
                all_high.append((jc, p, "主胜", hw))
            elif aw >= 55:
                all_high.append((jc, p, "客胜", aw))

    if all_high:
        lines.append(f"### 高置信场次（概率 ≥55%）")
        lines.append("")
        lines.append("| 比赛 | 方向 | 概率 | 预测比分 |")
        lines.append("|------|------|:---:|:---:|")
        for jc, p, direction, prob in sorted(all_high, key=lambda x: x[3], reverse=True):
            hc = jc_cn(jc["home"])
            ac = jc_cn(jc["away"])
            lines.append(f"| {jc['code']} {hc} vs {ac} | {direction} | {prob:.1f}% | {p.get('predictedScore','?')} |")

        if len(all_high) >= 2:
            lines.append("")
            lines.append(f"**2串1 推荐:** {all_high[0][0]['code']} {jc_cn(all_high[0][0]['home'])} vs {jc_cn(all_high[0][0]['away'])} {all_high[0][2]} + "
                         f"{all_high[1][0]['code']} {jc_cn(all_high[1][0]['home'])} vs {jc_cn(all_high[1][0]['away'])} {all_high[1][2]}")
            if len(all_high) >= 3:
                lines.append(f"**3串1 推荐:** 以上 + {all_high[2][0]['code']} {jc_cn(all_high[2][0]['home'])} vs {jc_cn(all_high[2][0]['away'])} {all_high[2][2]}")

    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("### ⚠️ 免责声明")
    lines.append("")
    lines.append("本报告仅为数据分析和概率模型输出，不构成投注建议。所有体彩推荐基于模型计算，实际比赛结果存在不确定性。理性投注，量力而行。")

    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w") as f:
        f.write("\n".join(lines))

    print(f"报告已生成: {OUTPUT}")
    print(f"共 {len(matches_by_date)} 天，{sum(len(v) for v in matches_by_date.values())} 场比赛")


if __name__ == "__main__":
    main()

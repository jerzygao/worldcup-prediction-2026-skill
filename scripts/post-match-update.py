#!/usr/bin/env python3
"""
赛后数据更新脚本
- 读取 prediction-log.json 中的赛果
- 更新 poisson-elo.json（K=32 Elo）
- 更新 poisson-team-stats.json（加权平均）
- 生成 post-match-verification.md
"""

import json
from pathlib import Path
from datetime import datetime, timezone, timedelta

CST = timezone(timedelta(hours=8))
SKILL_DIR = Path(__file__).resolve().parent.parent


def update_elo(elo_data, winner, loser, k=32):
    rw = elo_data[winner]
    rl = elo_data[loser]
    e_w = 1 / (1 + 10 ** ((rl - rw) / 400))
    elo_data[winner] = round(rw + k * (1 - e_w))
    elo_data[loser] = round(rl + k * (0 - (1 - e_w)))


def update_team_stats(stats_data, team, gf, ga, weight=0.3):
    old = stats_data[team]
    stats_data[team]["avg_goals"] = round(old["avg_goals"] * (1 - weight) + gf * weight, 1)
    stats_data[team]["avg_conceded"] = round(old["avg_conceded"] * (1 - weight) + ga * weight, 1)


def main():
    # 加载数据
    log_path = SKILL_DIR / "output" / "prediction-log.json"
    elo_path = SKILL_DIR / "data" / "external" / "poisson-elo.json"
    stats_path = SKILL_DIR / "data" / "external" / "poisson-team-stats.json"

    log = json.loads(log_path.read_text(encoding="utf-8"))
    elo = json.loads(elo_path.read_text(encoding="utf-8"))
    stats = json.loads(stats_path.read_text(encoding="utf-8"))

    # 中英文映射（引擎用中文）
    EN_TO_CN = {
        "Mexico": "墨西哥", "South Africa": "南非", "South Korea": "韩国",
        "Czech Republic": "捷克", "Canada": "加拿大", "Bosnia and Herzegovina": "波黑",
        "Qatar": "卡塔尔", "Switzerland": "瑞士", "Brazil": "巴西",
        "Morocco": "摩洛哥", "Haiti": "海地", "Scotland": "苏格兰",
        "United States": "美国", "Paraguay": "巴拉圭", "Australia": "澳大利亚",
        "Turkey": "土耳其", "Germany": "德国", "Curaçao": "库拉索",
        "Ivory Coast": "科特迪瓦", "Ecuador": "厄瓜多尔", "Netherlands": "荷兰",
        "Japan": "日本", "Sweden": "瑞典", "Tunisia": "突尼斯",
        "Belgium": "比利时", "Egypt": "埃及", "Iran": "伊朗",
        "New Zealand": "新西兰", "Spain": "西班牙", "Cape Verde": "佛得角",
        "Saudi Arabia": "沙特", "Uruguay": "乌拉圭", "France": "法国",
        "Senegal": "塞内加尔", "Iraq": "伊拉克", "Norway": "挪威",
        "Argentina": "阿根廷", "Algeria": "阿尔及利亚", "Austria": "奥地利",
        "Jordan": "约旦", "Portugal": "葡萄牙", "DR Congo": "刚果(金)",
        "Uzbekistan": "乌兹别克斯坦", "Colombia": "哥伦比亚", "England": "英格兰",
        "Croatia": "克罗地亚", "Ghana": "加纳", "Panama": "巴拿马",
    }

    # 更新 Elo 和 team_stats
    for r in log:
        home_en, away_en = r["match"].split(" vs ")
        home_cn = EN_TO_CN.get(home_en, home_en)
        away_cn = EN_TO_CN.get(away_en, away_en)

        hg = r["actual_home_goals"]
        ag = r["actual_away_goals"]

        if hg > ag:
            update_elo(elo, home_cn, away_cn)
        elif ag > hg:
            update_elo(elo, away_cn, home_cn)
        # 平局不更新 Elo（简化处理）

        update_team_stats(stats, home_cn, hg, ag)
        update_team_stats(stats, away_cn, ag, hg)

    # 写回
    elo_path.write_text(json.dumps(elo, ensure_ascii=False, indent=2), encoding="utf-8")
    stats_path.write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")

    # 生成验证报告
    lines = ["# 赛后验证报告", f"更新时间：{datetime.now(CST).isoformat()}", "", "## 已完赛", ""]
    lines.append("| 比赛 | 比分 | 我们方向 | 我们比分 | 泊松方向 | 备注 |")
    lines.append("|------|------|---------|---------|---------|------|")

    our_dir = 0
    our_score = 0
    poisson_dir = 0
    total = 0

    for r in log:
        total += 1
        od = "✅" if r["verdict"]["our_direction"] == "✅" else "❌"
        os = "✅" if "精确命中" in r["verdict"].get("our_score", "") else "—"
        pd = "✅" if r["verdict"]["poisson_direction"] == "✅" else "❌"
        if od == "✅": our_dir += 1
        if os == "✅": our_score += 1
        if pd == "✅": poisson_dir += 1
        lines.append(f"| {r['match']} | {r['actual_score']} | {od} | {os} | {pd} | {r['verdict']['notes']} |")

    lines.append("")
    lines.append("## 累计准确率")
    lines.append("")
    lines.append("| 模型 | 方向准确 | 比分准确 |")
    lines.append("|------|---------|---------|")
    lines.append(f"| 我们（多因子） | {our_dir}/{total} ({our_dir/total*100:.0f}%) | {our_score}/{total} ({our_score/total*100:.0f}%) |")
    lines.append(f"| 泊松xG | {poisson_dir}/{total} ({poisson_dir/total*100:.0f}%) | — |")
    lines.append("")
    lines.append("---")
    lines.append("*数据来源：Sailing Sports MCP 实时比分 + 模型预测对比*")

    report_path = SKILL_DIR / "output" / "post-match-verification.md"
    report_path.write_text("\n".join(lines), encoding="utf-8")

    print(f"Elo 已更新: {elo_path}")
    print(f"team_stats 已更新: {stats_path}")
    print(f"验证报告: {report_path}")
    print(f"累计: 我们 {our_dir}/{total} 方向, {our_score}/{total} 比分 | 泊松 {poisson_dir}/{total}")


if __name__ == "__main__":
    main()

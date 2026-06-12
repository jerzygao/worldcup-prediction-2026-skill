#!/usr/bin/env python3
"""
泊松xG模型集成脚本
从 football-match-analysis skill 提取：
1. Elo + 泊松xG 混合预测（第三校验源）
2. 爆冷分析三层判据（替换 upsetRisk 标签）
3. 赔率价值检测（模型概率 vs 市场隐含概率）

输出：
- output/poisson-crosscheck.json — 72场三模型对比
- output/poisson-upset-analysis.json — 爆冷分析结果
- output/poisson-value-detection.json — 赔率偏差检测
"""

import json
import sys
import os
from pathlib import Path
from datetime import datetime, timezone, timedelta

CST = timezone(timedelta(hours=8))
SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))

# 中英文队名映射（外部引擎用中文，我们用英文）
CN_TO_EN = {
    "墨西哥": "Mexico", "南非": "South Africa", "韩国": "South Korea",
    "捷克": "Czech Republic", "加拿大": "Canada", "波黑": "Bosnia",
    "卡塔尔": "Qatar", "瑞士": "Switzerland", "巴西": "Brazil",
    "摩洛哥": "Morocco", "海地": "Haiti", "苏格兰": "Scotland",
    "美国": "United States", "巴拉圭": "Paraguay", "澳大利亚": "Australia",
    "土耳其": "Turkey", "德国": "Germany", "库拉索": "Curaçao",
    "科特迪瓦": "Ivory Coast", "厄瓜多尔": "Ecuador", "荷兰": "Netherlands",
    "日本": "Japan", "瑞典": "Sweden", "突尼斯": "Tunisia",
    "比利时": "Belgium", "埃及": "Egypt", "伊朗": "Iran",
    "新西兰": "New Zealand", "西班牙": "Spain", "佛得角": "Cape Verde",
    "沙特": "Saudi Arabia", "乌拉圭": "Uruguay", "法国": "France",
    "塞内加尔": "Senegal", "伊拉克": "Iraq", "挪威": "Norway",
    "阿根廷": "Argentina", "阿尔及利亚": "Algeria", "奥地利": "Austria",
    "约旦": "Jordan", "葡萄牙": "Portugal", "刚果(金)": "DR Congo",
    "乌兹别克斯坦": "Uzbekistan", "哥伦比亚": "Colombia", "英格兰": "England",
    "克罗地亚": "Croatia", "加纳": "Ghana", "巴拿马": "Panama",
    "波黑": "Bosnia",  # 引擎用"波黑"
}
EN_TO_CN = {v: k for k, v in CN_TO_EN.items()}
# 补充：我们预测数据中的全名 → 引擎中文名
EN_TO_CN["Bosnia and Herzegovina"] = "波黑"
EN_TO_CN["Czech Republic"] = "捷克"
EN_TO_CN["South Korea"] = "韩国"
EN_TO_CN["United States"] = "美国"
EN_TO_CN["Ivory Coast"] = "科特迪瓦"
EN_TO_CN["Cape Verde"] = "佛得角"
EN_TO_CN["Saudi Arabia"] = "沙特"
EN_TO_CN["New Zealand"] = "新西兰"
EN_TO_CN["South Africa"] = "南非"
EN_TO_CN["DR Congo"] = "刚果(金)"
EN_TO_CN["Curaçao"] = "库拉索"


def load_our_predictions():
    preds_path = SKILL_DIR / "output" / "match-predictions-2026.json"
    return json.loads(preds_path.read_text(encoding="utf-8"))["predictions"]


def load_our_odds():
    """加载双源赔率"""
    import csv
    odds = {}
    path = SKILL_DIR / "data" / "manual" / "match-odds.csv"
    with open(path) as f:
        for row in csv.DictReader(f):
            key = f"{row['homeTeam']}|{row['awayTeam']}|{row['bookmaker']}"
            odds[key] = {
                "homeOdds": float(row["homeOdds"]),
                "drawOdds": float(row["drawOdds"]),
                "awayOdds": float(row["awayOdds"]),
            }
    return odds


def odds_to_implied_prob(home_odds, draw_odds, away_odds):
    """赔率转隐含概率（去水）"""
    raw_h = 1 / home_odds
    raw_d = 1 / draw_odds
    raw_a = 1 / away_odds
    total = raw_h + raw_d + raw_a
    return {
        "home": round(raw_h / total * 100, 1),
        "draw": round(raw_d / total * 100, 1),
        "away": round(raw_a / total * 100, 1),
        "vig": round((total - 1) * 100, 1),
    }


def run_poisson_predictions():
    """用泊松引擎跑72场预测"""
    import importlib.util
    
    # 动态加载 poisson-engine.py（文件名带连字符）
    engine_path = str(SCRIPT_DIR / "poisson-engine.py")
    spec = importlib.util.spec_from_file_location("poisson_engine", engine_path)
    engine_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(engine_module)
    
    engine = engine_module.FootballPredictionEngine(
        data_dir=str(SKILL_DIR / "data" / "external")
    )
    
    our_preds = load_our_predictions()
    corrections_data = json.loads(
        (SKILL_DIR / "data" / "external" / "poisson-corrections.json").read_text(encoding="utf-8")
    )
    
    results = []
    for p in our_preds:
        home_en = p["homeTeam"]
        away_en = p["awayTeam"]
        home_cn = EN_TO_CN.get(home_en)
        away_cn = EN_TO_CN.get(away_en)
        
        if not home_cn or not away_cn:
            results.append({
                "home": home_en, "away": away_en,
                "error": f"队名映射缺失: {home_en}→{home_cn}, {away_en}→{away_cn}"
            })
            continue
        
        # 基础预测
        try:
            pred = engine.predict(home_cn, away_cn)
        except Exception as e:
            results.append({
                "home": home_en, "away": away_en,
                "error": f"引擎预测失败: {e}"
            })
            continue
        
        # 爆冷分析
        is_first = p.get("group", "").startswith("Matchday 1") or "1" in str(p.get("matchNumber", ""))[:1]
        match_ctx = {
            "is_first_match": is_first,
            "expansion_format": True,
        }
        upset = engine.upset_analysis(home_cn, away_cn, match_ctx)
        
        results.append({
            "home": home_en,
            "away": away_en,
            "group": p.get("group", ""),
            "date": p.get("date", ""),
            # 泊松预测
            "poisson": {
                "elo_a": pred["elo_a"], "elo_b": pred["elo_b"],
                "xg_a": pred["xg_a"], "xg_b": pred["xg_b"],
                "poisson_probs": pred["poisson"],
                "combined_probs": pred["combined"],
                "final_probs": pred["final"],
                "top_scores": pred["top_scores"][:3],
            },
            # 我们模型
            "our_model": {
                "homeWin": p["homeWin"], "draw": p["draw"], "awayWin": p["awayWin"],
                "confidence": p["confidence"],
                "upsetRisk": p["upsetRisk"],
            },
            # 爆冷分析
            "upset_analysis": {
                "favorite": upset["favorite"],
                "underdog": upset["underdog"],
                "elo_gap": upset["elo_gap"],
                "base_upset_prob": upset["base_upset_prob"],
                "adjusted_upset_prob": upset["adjusted_upset_prob"],
                "corrections": upset["corrections"],
                "total_correction": upset["total_correction"],
                "upset_combined": upset["upset_combined"],
                "tier": upset["tier"],
            },
        })
    
    return results


def detect_value(poisson_results, our_odds):
    """赔率价值检测：模型概率 vs 市场隐含概率"""
    value_signals = []
    
    for r in poisson_results:
        if "error" in r:
            continue
        
        home = r["home"]
        away = r["away"]
        
        # 找 Titan007 赔率（优先，覆盖更广）
        t7_key = f"{home}|{away}|titan007 consensus average"
        oa_key = f"{home}|{away}|the-odds-api consensus average"
        
        market_odds = our_odds.get(t7_key) or our_odds.get(oa_key)
        if not market_odds:
            continue
        
        market_prob = odds_to_implied_prob(
            market_odds["homeOdds"], market_odds["drawOdds"], market_odds["awayOdds"]
        )
        
        # 泊松模型概率
        poisson_prob = {
            "home": r["poisson"]["final_probs"]["win_a"],
            "draw": r["poisson"]["final_probs"]["draw"],
            "away": r["poisson"]["final_probs"]["win_b"],
        }
        
        # 我们模型概率
        our_prob = {
            "home": r["our_model"]["homeWin"] * 100,
            "draw": r["our_model"]["draw"] * 100,
            "away": r["our_model"]["awayWin"] * 100,
        }
        
        # 偏差检测（≥3% 标记）
        signals = []
        for side, label in [("home", "主胜"), ("draw", "平局"), ("away", "客胜")]:
            # 泊松 vs 市场
            p_dev = poisson_prob[side] - market_prob[side]
            # 我们 vs 市场
            o_dev = our_prob[side] - market_prob[side]
            
            if abs(p_dev) >= 3 or abs(o_dev) >= 3:
                signals.append({
                    "side": label,
                    "market_prob": market_prob[side],
                    "poisson_prob": poisson_prob[side],
                    "poisson_dev": round(p_dev, 1),
                    "our_prob": our_prob[side],
                    "our_dev": round(o_dev, 1),
                })
        
        if signals:
            value_signals.append({
                "match": f"{home} vs {away}",
                "market_vig": market_prob["vig"],
                "source": "Titan007" if t7_key in our_odds else "Odds API",
                "signals": signals,
            })
    
    return value_signals


def generate_summary(poisson_results, value_signals):
    """生成汇总报告"""
    lines = []
    lines.append("# 泊松xG模型交叉验证报告")
    lines.append(f"生成时间：{datetime.now(CST).strftime('%Y-%m-%d %H:%M:%S')} (北京时间)")
    lines.append("")
    lines.append("## 模型对比")
    lines.append("")
    lines.append("| 模型 | 方法论 | 核心特征 |")
    lines.append("|------|--------|---------|")
    lines.append("| 我们（多因子） | 加权融合 | 赔率(0.35) + Elo(0.25) + 状态(0.15) + 身价(0.10) + FIFA(0.08) + 伤病(0.07) |")
    lines.append("| 泊松xG | Elo + 泊松分布 | Elo(0.30) + xG泊松(0.70) + 16修正因子 |")
    lines.append("| worldcup-analyzer | ML黑盒 | 球员实力 + 教练水平 + 俱乐部评分等 |")
    lines.append("")
    
    # 统计一致率
    total = 0
    agree = 0
    for r in poisson_results:
        if "error" in r:
            continue
        total += 1
        our = r["our_model"]
        poisson = r["poisson"]["final_probs"]
        
        our_winner = max(
            ("主胜", our["homeWin"]), ("平局", our["draw"]), ("客胜", our["awayWin"]),
            key=lambda x: x[1]
        )[0]
        p_winner = max(
            ("主胜", poisson["win_a"]), ("平局", poisson["draw"]), ("客胜", poisson["win_b"]),
            key=lambda x: x[1]
        )[0]
        
        if our_winner == p_winner:
            agree += 1
    
    lines.append(f"## 双模型一致率")
    lines.append(f"- 总场次：{total}")
    lines.append(f"- 方向一致：{agree} 场（{agree/total*100:.0f}%）")
    lines.append(f"- 方向分歧：{total - agree} 场")
    lines.append("")
    
    # 分歧场次
    lines.append("## 方向分歧场次")
    lines.append("")
    lines.append("| 场次 | 我们模型 | 泊松xG | Elo差 | 爆冷等级 |")
    lines.append("|------|---------|--------|-------|---------|")
    
    for r in poisson_results:
        if "error" in r:
            continue
        our = r["our_model"]
        poisson = r["poisson"]["final_probs"]
        
        our_winner = max(
            ("主胜", our["homeWin"]), ("平局", our["draw"]), ("客胜", our["awayWin"]),
            key=lambda x: x[1]
        )[0]
        p_winner = max(
            ("主胜", poisson["win_a"]), ("平局", poisson["draw"]), ("客胜", poisson["win_b"]),
            key=lambda x: x[1]
        )[0]
        
        if our_winner != p_winner:
            lines.append(
                f"| {r['home']} vs {r['away']} | {our_winner} | {p_winner} | "
                f"{r['upset_analysis']['elo_gap']} | {r['upset_analysis']['tier']} |"
            )
    
    lines.append("")
    
    # 爆冷候选
    lines.append("## 爆冷候选（Tier 1 & Tier 2）")
    lines.append("")
    upsets = [r for r in poisson_results if "error" not in r and "Tier" in r["upset_analysis"]["tier"]]
    upsets.sort(key=lambda r: -r["upset_analysis"]["upset_combined"])
    
    for r in upsets:
        ua = r["upset_analysis"]
        if "Tier 3" in ua["tier"] and ua["upset_combined"] < 25:
            continue
        lines.append(f"### {r['home']} vs {r['away']}")
        lines.append(f"- 强队：{ua['favorite']} | 弱队：{ua['underdog']} | Elo差：{ua['elo_gap']}")
        lines.append(f"- 基础爆冷概率：{ua['base_upset_prob']}% → 调整后：{ua['adjusted_upset_prob']}%")
        lines.append(f"- 修正因子：风格{ua['corrections']['style']}% / 状态{ua['corrections']['status']}% / 赛制{ua['corrections']['format']}%")
        lines.append(f"- 综合爆冷值：{ua['upset_combined']}% | 等级：**{ua['tier']}**")
        lines.append("")
    
    # 赔率价值信号
    lines.append("## 赔率价值信号（模型 vs 市场偏差 ≥3%）")
    lines.append("")
    if value_signals:
        for vs in value_signals:
            lines.append(f"### {vs['match']}")
            lines.append(f"- 数据源：{vs['source']} | 市场抽水：{vs['market_vig']}%")
            for s in vs["signals"]:
                lines.append(
                    f"- {s['side']}：市场{s['market_prob']}% | "
                    f"泊松{s['poisson_prob']}%（{'高估' if s['poisson_dev'] < 0 else '低估'}{abs(s['poisson_dev']):.1f}%） | "
                    f"我们{s['our_prob']}%（{'高估' if s['our_dev'] < 0 else '低估'}{abs(s['our_dev']):.1f}%）"
                )
            lines.append("")
    else:
        lines.append("暂无显著偏差信号。")
        lines.append("")
    
    lines.append("---")
    lines.append("*仅供统计参考，不构成投注建议。18+。*")
    
    return "\n".join(lines)


def main():
    print("=" * 60)
    print("泊松xG模型集成分析")
    print(f"时间：{datetime.now(CST).strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)
    
    # 1. 跑泊松预测
    print("\n[1/4] 运行泊松xG预测...")
    poisson_results = run_poisson_predictions()
    success = sum(1 for r in poisson_results if "error" not in r)
    errors = sum(1 for r in poisson_results if "error" in r)
    print(f"  成功: {success}, 失败: {errors}")
    
    # 2. 加载赔率做价值检测
    print("\n[2/4] 赔率价值检测...")
    our_odds = load_our_odds()
    value_signals = detect_value(poisson_results, our_odds)
    print(f"  发现 {len(value_signals)} 个价值信号")
    
    # 3. 生成报告
    print("\n[3/4] 生成汇总报告...")
    report = generate_summary(poisson_results, value_signals)
    
    report_path = SKILL_DIR / "output" / "poisson-crosscheck-report.md"
    report_path.write_text(report, encoding="utf-8")
    print(f"  报告: {report_path}")
    
    # 4. 保存结构化数据
    print("\n[4/4] 保存结构化数据...")
    
    crosscheck_path = SKILL_DIR / "output" / "poisson-crosscheck.json"
    json.dump(poisson_results, crosscheck_path.open("w", encoding="utf-8"), ensure_ascii=False, indent=2)
    
    value_path = SKILL_DIR / "output" / "poisson-value-detection.json"
    json.dump(value_signals, value_path.open("w", encoding="utf-8"), ensure_ascii=False, indent=2)
    
    print(f"  交叉验证: {crosscheck_path}")
    print(f"  价值检测: {value_path}")
    
    # 打印摘要
    print("\n" + "=" * 60)
    print("摘要")
    print("=" * 60)
    
    total = success
    agree = 0
    for r in poisson_results:
        if "error" in r:
            continue
        our = r["our_model"]
        poisson = r["poisson"]["final_probs"]
        our_winner = max(
            ("主胜", our["homeWin"]), ("平局", our["draw"]), ("客胜", our["awayWin"]),
            key=lambda x: x[1]
        )[0]
        p_winner = max(
            ("主胜", poisson["win_a"]), ("平局", poisson["draw"]), ("客胜", poisson["win_b"]),
            key=lambda x: x[1]
        )[0]
        if our_winner == p_winner:
            agree += 1
    
    print(f"  双模型一致率: {agree}/{total} ({agree/total*100:.0f}%)")
    
    tier1 = sum(1 for r in poisson_results if "error" not in r and "Tier 1" in r["upset_analysis"]["tier"])
    tier2 = sum(1 for r in poisson_results if "error" not in r and "Tier 2" in r["upset_analysis"]["tier"])
    print(f"  爆冷候选: Tier1={tier1}, Tier2={tier2}")
    print(f"  价值信号: {len(value_signals)}")
    
    return poisson_results, value_signals


if __name__ == "__main__":
    main()

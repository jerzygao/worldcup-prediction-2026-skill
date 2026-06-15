#!/usr/bin/env python3
"""
赛后数据更新脚本
- 扫描 match-predictions-2026.json，自动找出已完赛但未验证的场次
- 通过 Sailing MCP 获取实际比分
- 更新 poisson-elo.json（K=32 Elo）
- 更新 poisson-team-stats.json（加权平均）
- 生成 post-match-verification.md
"""

import json
import subprocess
import re
from pathlib import Path
from datetime import datetime, timezone, timedelta

CST = timezone(timedelta(hours=8))
SKILL_DIR = Path(__file__).resolve().parent.parent


def get_actual_scores_via_sailing():
    """通过 Sailing MCP 获取已完赛比赛的实际比分"""
    try:
        r = subprocess.run(
            ["mcporter", "call", "sailing-sports-mcp", "tteagt",
             "--args", '{"query": "今天世界杯比赛结果", "project": "FBL"}'],
            capture_output=True, text=True, timeout=30
        )
        out = r.stdout.strip()
        if not out:
            return {}
        data = json.loads(out)
        raw = json.dumps(data, ensure_ascii=False)
        results = {}
        # 先去掉 markdown 标记
        clean = re.sub(r'\*\*', '', raw)
        # 匹配中文格式："加拿大 1:1 波黑"
        for m in re.finditer(r'([\u4e00-\u9fff]{2,6})\s+(\d+)[:：](\d+)\s+([\u4e00-\u9fff]{2,6})', clean):
            home, hg, ag, away = m.group(1).strip(), int(m.group(2)), int(m.group(3)), m.group(4).strip()
            if len(home) > 0 and len(away) > 0:
                results[f"{home} vs {away}"] = {"score": f"{hg}-{ag}", "home_goals": hg, "away_goals": ag}
                # 也存英文key
                for en, cn in EN_TO_CN.items():
                    if cn == home:
                        for en2, cn2 in EN_TO_CN.items():
                            if cn2 == away:
                                results[f"{en} vs {en2}"] = {"score": f"{hg}-{ag}", "home_goals": hg, "away_goals": ag}
        return results
    except Exception as e:
        print(f"  [警告] Sailing MCP 获取赛果失败: {e}")
        return {}


def update_elo(elo_data, winner, loser, k=32):
    rw = elo_data.get(winner, 1500)
    rl = elo_data.get(loser, 1500)
    e_w = 1 / (1 + 10 ** ((rl - rw) / 400))
    elo_data[winner] = round(rw + k * (1 - e_w))
    elo_data[loser] = round(rl + k * (0 - (1 - e_w)))


def update_team_stats(stats_data, team, gf, ga, weight=0.3):
    if team not in stats_data:
        stats_data[team] = {"avg_goals": 1.5, "avg_conceded": 1.5}
    old = stats_data[team]
    stats_data[team]["avg_goals"] = round(old["avg_goals"] * (1 - weight) + gf * weight, 1)
    stats_data[team]["avg_conceded"] = round(old["avg_conceded"] * (1 - weight) + ga * weight, 1)


def find_missing_matches(all_predictions, existing_log):
    """从预测中找出已完赛但未验证的场次"""
    existing_keys = {r["match"] for r in existing_log}
    now = datetime.now(CST)
    missing = []
    for m in all_predictions:
        match_key = f"{m['homeTeam']} vs {m['awayTeam']}"
        if match_key in existing_keys:
            continue
        try:
            match_date = datetime.strptime(m.get("date", ""), "%Y-%m-%d").replace(tzinfo=CST)
            # 尝试用 kickoffLocal 精确判断开球时间
            # 没有精确时间时，用 date+22h 确保当天全部赛程结束再标记
            ko = m.get("kickoffLocal", "")
            if ko and "T" in ko:
                ko_dt = datetime.fromisoformat(ko)
                if ko_dt.tzinfo is None:
                    ko_dt = ko_dt.replace(tzinfo=CST)
                match_end = ko_dt + timedelta(hours=3)
            else:
                match_end = match_date + timedelta(hours=22)
            if match_end < now:
                missing.append(m)
        except (ValueError, KeyError):
            continue
    return missing


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

CN_TO_EN = {v: k for k, v in EN_TO_CN.items()}


def guess_verdict(pred, actual_hg, actual_ag):
    """生成验证判定"""
    hw = float(pred.get("homeWin", 0))
    dp = float(pred.get("draw", 0))
    aw = float(pred.get("awayWin", 0))
    pred_dir = "主胜" if hw > dp and hw > aw else ("平局" if dp > hw and dp > aw else "客胜")
    actual_dir = "主胜" if actual_hg > actual_ag else ("平局" if actual_hg == actual_ag else "客胜")
    our_dir = "✅" if pred_dir == actual_dir else "❌"

    pred_score = pred.get("predictedScore", "")
    our_score = "✅" if pred_score == f"{actual_hg}-{actual_ag}" else "—"
    if our_score == "✅":
        our_score_full = f"✅ ({pred_score} 精确命中)"
    elif pred_score and actual_hg and actual_ag:
        our_score_full = "—"
    else:
        our_score_full = "—"

    max_prob = max(hw, dp, aw)
    notes = f"预测方向{pred_dir}({max_prob*100:.0f}%)，实际{actual_dir}"
    if our_score == "✅":
        notes += "，比分精确命中"
    elif actual_hg == actual_ag:
        notes += "，模型低估了平局概率"
    elif (actual_hg > actual_ag and hw < aw) or (actual_ag > actual_hg and aw < hw):
        notes += "，方向完全相反"

    return {"our_direction": our_dir, "our_score": our_score_full, "notes": notes}


def main():
    # 加载数据
    pred_json_path = SKILL_DIR / "output" / "match-predictions-2026.json"
    log_path = SKILL_DIR / "output" / "prediction-log.json"
    elo_path = SKILL_DIR / "data" / "external" / "poisson-elo.json"
    stats_path = SKILL_DIR / "data" / "external" / "poisson-team-stats.json"

    # 加载预测数据（所有72场）
    with open(pred_json_path, encoding="utf-8") as f:
        pred_data = json.load(f)
    all_predictions = pred_data.get("predictions", pred_data if isinstance(pred_data, list) else [])

    # 加载现有验证日志
    log = json.loads(log_path.read_text(encoding="utf-8")) if log_path.exists() else []

    # 找出缺失的已完赛比赛
    missing = find_missing_matches(all_predictions, log)
    if missing:
        print(f"发现 {len(missing)} 场已完赛但未验证的比赛，尝试获取赛果...")
        sailing_results = get_actual_scores_via_sailing()
        print(f"  Sailing MCP 返回 {len(sailing_results)} 场赛果")

        for m in missing:
            match_key = f"{m['homeTeam']} vs {m['awayTeam']}"
            # 从 Sailing 结果中查找
            result = sailing_results.get(match_key)
            # 也试一下中文队名
            home_cn = EN_TO_CN.get(m['homeTeam'], m['homeTeam'])
            away_cn = EN_TO_CN.get(m['awayTeam'], m['awayTeam'])
            cn_key = f"{home_cn} vs {away_cn}"
            if not result:
                result = sailing_results.get(cn_key)

            if result:
                hg, ag = result["home_goals"], result["away_goals"]
                actual_score = result["score"]
                actual_outcome = "主胜" if hg > ag else ("平局" if hg == ag else "客胜")

                # 计算方向判定（简化版，没有泊松数据）
                verdict = guess_verdict(m, hg, ag)
                verdict["poisson_direction"] = "—"

                log.append({
                    "match": match_key,
                    "date": m.get("date", ""),
                    "stage": "小组赛",
                    "actual_score": actual_score,
                    "actual_home_goals": hg,
                    "actual_away_goals": ag,
                    "actual_outcome": actual_outcome,
                    "our_prediction": {
                        "direction": "主胜" if float(m.get("homeWin", 0)) > max(float(m.get("draw", 0)), float(m.get("awayWin", 0))) else ("平局" if float(m.get("draw", 0)) > max(float(m.get("homeWin", 0)), float(m.get("awayWin", 0))) else "客胜"),
                        "homeWin": float(m.get("homeWin", 0)),
                        "draw": float(m.get("draw", 0)),
                        "awayWin": float(m.get("awayWin", 0)),
                        "predicted_score": m.get("predictedScore", ""),
                        "confidence": m.get("confidence", "medium")
                    },
                    "verdict": verdict
                })
                print(f"  ✅ {match_key}: 实际{actual_score}")
            else:
                log.append({
                    "match": match_key,
                    "date": m.get("date", ""),
                    "stage": "小组赛",
                    "actual_score": "待更新",
                    "actual_home_goals": 0,
                    "actual_away_goals": 0,
                    "actual_outcome": "待更新",
                    "our_prediction": {
                        "direction": "主胜" if float(m.get("homeWin", 0)) > max(float(m.get("draw", 0)), float(m.get("awayWin", 0))) else ("平局" if float(m.get("draw", 0)) > max(float(m.get("homeWin", 0)), float(m.get("awayWin", 0))) else "客胜"),
                        "homeWin": float(m.get("homeWin", 0)),
                        "draw": float(m.get("draw", 0)),
                        "awayWin": float(m.get("awayWin", 0)),
                        "predicted_score": m.get("predictedScore", ""),
                        "confidence": m.get("confidence", "medium")
                    },
                    "verdict": {
                        "our_direction": "⏳",
                        "our_score": "⏳",
                        "poisson_direction": "⏳",
                        "notes": "赛果待获取，后续运行会补齐"
                    }
                })
                print(f"  ⏳ {match_key}: 赛果暂未获取到，标记待更新")

    # 更新 Elo 和 team_stats
    elo = json.loads(elo_path.read_text(encoding="utf-8"))
    stats = json.loads(stats_path.read_text(encoding="utf-8"))

    for r in log:
        if r["actual_score"] == "待更新":
            continue
        home_en, away_en = r["match"].split(" vs ")
        home_cn = EN_TO_CN.get(home_en, home_en)
        away_cn = EN_TO_CN.get(away_en, away_en)
        # 兼容新旧格式：新版有 actual_home_goals 字段，旧版只有 actual_score 字符串
        if "actual_home_goals" in r:
            hg = r["actual_home_goals"]
            ag = r["actual_away_goals"]
        else:
            parts = r["actual_score"].split("-")
            hg = int(parts[0]) if parts[0].isdigit() else 0
            ag = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
        if hg > ag:
            update_elo(elo, home_cn, away_cn)
        elif ag > hg:
            update_elo(elo, away_cn, home_cn)
        update_team_stats(stats, home_cn, hg, ag)
        update_team_stats(stats, away_cn, ag, hg)

    elo_path.write_text(json.dumps(elo, ensure_ascii=False, indent=2), encoding="utf-8")
    stats_path.write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")

    # 写回 prediction-log.json（保留已在日志中的完整字段）
    log_path.write_text(json.dumps(log, ensure_ascii=False, indent=2), encoding="utf-8")

    # 生成验证报告
    lines = ["# 赛后验证报告", f"更新时间：{datetime.now(CST).isoformat()}", "", "## 已完赛", ""]
    lines.append("| 比赛 | 比分 | 我们方向 | 我们比分 | 泊松方向 | 备注 |")
    lines.append("|------|------|---------|---------|---------|------|")

    our_dir = 0
    our_score = 0
    poisson_dir = 0
    total = 0

    for r in log:
        if r["actual_score"] == "待更新":
            lines.append(f"| {r['match']} | ⏳ 待更新 | ⏳ | ⏳ | ⏳ | {r['verdict']['notes']} |")
            continue
        total += 1
        od = "✅" if r["verdict"]["our_direction"] == "✅" else "❌"
        os_text = r["verdict"].get("our_score", "—")
        os_icon = "✅" if "精确命中" in os_text or os_text == "✅" else "—"
        pd = r["verdict"].get("poisson_direction", "—")
        if pd == "—":
            pd_display = "—"
        else:
            pd_display = "✅" if pd == "✅" else "❌"
        if od == "✅":
            our_dir += 1
        if os_icon == "✅":
            our_score += 1
        if pd_display == "✅":
            poisson_dir += 1
        lines.append(f"| {r['match']} | {r['actual_score']} | {od} | {os_icon} | {pd_display} | {r['verdict']['notes']} |")

    lines.append("")
    lines.append("## 累计准确率")
    lines.append("")
    lines.append("| 模型 | 方向准确 | 比分准确 |")
    lines.append("|------|---------|---------|")
    if total > 0:
        lines.append(f"| 我们（多因子） | {our_dir}/{total} ({our_dir/total*100:.0f}%) | {our_score}/{total} ({our_score/total*100:.0f}%) |")
        lines.append(f"| 泊松xG | {poisson_dir}/{total} ({poisson_dir/total*100:.0f}%) | — |")
    else:
        lines.append("| 我们（多因子） | 0/0 (—) | 0/0 (—) |")
        lines.append("| 泊松xG | 0/0 (—) | — |")
    lines.append("")
    lines.append("---")
    lines.append("*数据来源：Sailing MCP 实时比分 + match-predictions-2026.json 预测对比*")

    report_path = SKILL_DIR / "output" / "post-match-verification.md"
    report_path.write_text("\n".join(lines), encoding="utf-8")

    print(f"\nElo 已更新: {elo_path}")
    print(f"team_stats 已更新: {stats_path}")
    print(f"验证报告: {report_path}")
    print(f"累计: 我们 {our_dir}/{total} 方向, {our_score}/{total} 比分 | 泊松 {poisson_dir}/{total}")
    if missing:
        print(f"新增验证: {len(missing)} 场")

    # === 自动链入主预测管线 ===
    print("\n=== 同步赛果到主模型 results.csv ===")
    import subprocess as sp
    sync = sp.run(["node", "scripts/sync-worldcup-results.mjs"], capture_output=True, text=True, timeout=30)
    print(sync.stdout.strip())
    if sync.returncode != 0:
        print(f"  [警告] 同步失败: {sync.stderr.strip()}")

    print("\n=== 重建主模型 Elo + Form ===")
    elo_build = sp.run(["node", "scripts/build-elo-form.mjs"], capture_output=True, text=True, timeout=120)
    print(f"  matches={elo_build.returncode} (0=成功)")

    print("\n=== 重新预测剩余比赛 ===")
    sp.run(["node", "scripts/batch-predict-2026.mjs"], capture_output=True, text=True, timeout=120)

    print("=== 重新模拟淘汰赛 ===")
    sp.run(["node", "scripts/simulate-2026.mjs"], capture_output=True, text=True, timeout=120)

    print("=== 重新生成报告 ===")
    sp.run(["node", "scripts/generate-report-2026.mjs"], capture_output=True, text=True, timeout=120)

    print("\n✅ 全链路完成！")
    print("步骤：赛后验证 → 赛果同步 → Elo重建 → 预测 → 模拟 → 报告")


if __name__ == "__main__":
    main()

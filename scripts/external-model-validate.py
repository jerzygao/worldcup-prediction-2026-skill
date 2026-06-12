#!/usr/bin/env python3
"""
外部模型交叉验证脚本
- worldcup-analyzer (jiajielitong.com ML 模型): 每天 2 次免费预测
- 与我们的多因子模型对比，标注一致/分歧
"""

import json
import sys
import os
from pathlib import Path
from datetime import datetime, timezone, timedelta

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))

from wc_client import predict_match, format_prediction, WorldCupAPIError

# 北京时间
CST = timezone(timedelta(hours=8))

# 要校验的场次列表（按优先级排序）
VALIDATION_QUEUE = [
    # 高置信度场次（验证模型一致性）
    ("Spain", "Cape Verde"),
    ("Germany", "Curaçao"),
    ("France", "Iraq"),
    ("Brazil", "Haiti"),
    ("Jordan", "Argentina"),
    ("England", "Ghana"),
    ("Qatar", "Switzerland"),
    ("Ecuador", "Curaçao"),
    ("Canada", "Qatar"),
    ("Spain", "Saudi Arabia"),
    # 均势场次（验证分歧判断）
    ("Egypt", "Iran"),
    ("DR Congo", "Uzbekistan"),
    ("Canada", "Switzerland"),
    ("Cape Verde", "Saudi Arabia"),
    ("United States", "Turkey"),
]


def load_our_predictions():
    """加载我们模型的预测结果"""
    preds_path = SKILL_DIR / "output" / "match-predictions-2026.json"
    data = json.loads(preds_path.read_text(encoding="utf-8"))
    return data["predictions"]


def find_our_pred(preds, home, away):
    """在我们模型中找到对应场次"""
    for p in preds:
        if p["homeTeam"] == home and p["awayTeam"] == away:
            return p
    return None


def our_outcome(p):
    """我们模型的胜负方向"""
    hw, d, aw = p["homeWin"], p["draw"], p["awayWin"]
    if hw > d and hw > aw:
        return "Win"
    elif aw > hw and aw > d:
        return "Loss"
    else:
        return "Draw"


def load_existing_results():
    """加载已保存的外部校验结果"""
    results_path = SKILL_DIR / "output" / "external-validation-results.json"
    if results_path.exists():
        return json.loads(results_path.read_text(encoding="utf-8"))
    return {"results": {}, "lastUpdated": None}


def save_results(data):
    """保存校验结果"""
    results_path = SKILL_DIR / "output" / "external-validation-results.json"
    results_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def run_validation(max_calls=2):
    """运行外部模型校验，最多 max_calls 次 API 调用"""
    our_preds = load_our_predictions()
    existing = load_existing_results()
    results = existing["results"]

    calls_made = 0
    new_results = []

    for home, away in VALIDATION_QUEUE:
        key = f"{home}|{away}"
        if key in results:
            continue  # 已有结果，跳过

        if calls_made >= max_calls:
            break

        try:
            data = predict_match(home, away, "worldcup")
            ext = data["results"]
            results[key] = {
                "home": home,
                "away": away,
                "extOutcome": ext["win_or_not"],
                "extGoalDiff": float(ext["win_goals"]),
                "extSnapshot": ext.get("updatedAt"),
                "validatedAt": datetime.now(CST).isoformat(),
            }
            calls_made += 1
            new_results.append((home, away, ext))
            print(f"✅ {home} vs {away}: {ext['win_or_not']} (diff={ext['win_goals']})")
        except WorldCupAPIError as e:
            error_msg = str(e)
            results[key] = {
                "home": home,
                "away": away,
                "error": error_msg[:200],
                "validatedAt": datetime.now(CST).isoformat(),
            }
            print(f"❌ {home} vs {away}: {error_msg[:100]}")

    existing["lastUpdated"] = datetime.now(CST).isoformat()
    existing["results"] = results
    existing["totalValidated"] = len([r for r in results.values() if "extOutcome" in r])
    existing["totalErrors"] = len([r for r in results.values() if "error" in r])
    existing["totalQueued"] = len(VALIDATION_QUEUE)
    save_results(existing)

    # 生成对比报告
    generate_comparison_report(our_preds, results)

    return calls_made, new_results


def generate_comparison_report(our_preds, ext_results):
    """生成双模型对比报告"""
    lines = []
    lines.append("# 外部模型交叉验证报告")
    lines.append(f"生成时间：{datetime.now(CST).strftime('%Y-%m-%d %H:%M:%S')} (北京时间)")
    lines.append("")
    lines.append("## 数据来源")
    lines.append("- 我们模型：多因子加权（赔率 0.35 + Elo 0.25 + 近期状态 0.15 + 身价 0.10 + FIFA 0.08 + 伤病 0.07）")
    lines.append("- 外部模型：jiajielitong.com ML 模型（球员实力 + 教练水平 + 俱乐部评分等）")
    lines.append("")

    consistent = 0
    divergent = 0
    errors = 0

    table_lines = []
    table_lines.append("| 场次 | 我们模型 | 外部模型 | 净胜球 | 一致? |")
    table_lines.append("|------|---------|---------|--------|-------|")

    for key, ext in sorted(ext_results.items()):
        home, away = key.split("|")
        our = find_our_pred(our_preds, home, away)

        if "error" in ext:
            errors += 1
            table_lines.append(f"| {home} vs {away} | — | API异常 | — | ⚠️ |")
            continue

        our_out = our_outcome(our) if our else "?"
        ext_out = ext["extOutcome"]
        match = "✅" if our_out == ext_out else "❌ 分歧"

        if our_out == ext_out:
            consistent += 1
        else:
            divergent += 1

        our_prob = f"主{our['homeWin']:.0%}" if our else "?"
        table_lines.append(
            f"| {home} vs {away} | {our_out} ({our_prob}) | {ext_out} | {ext['extGoalDiff']:+.2f} | {match} |"
        )

    lines.append(f"## 校验结果汇总")
    lines.append(f"- 已校验：{consistent + divergent} 场")
    lines.append(f"- 一致：{consistent} 场")
    lines.append(f"- 分歧：{divergent} 场")
    lines.append(f"- API异常：{errors} 场")
    lines.append(f"- 一致率：{consistent/(consistent+divergent)*100:.0f}%" if (consistent+divergent) > 0 else "- 一致率：暂无数据")
    lines.append("")

    lines.extend(table_lines)
    lines.append("")
    lines.append("## 分歧场次分析")
    lines.append("")

    for key, ext in sorted(ext_results.items()):
        if "error" in ext:
            continue
        home, away = key.split("|")
        our = find_our_pred(our_preds, home, away)
        if not our:
            continue
        our_out = our_outcome(our)
        if our_out != ext["extOutcome"]:
            lines.append(f"### {home} vs {away}")
            lines.append(f"- 我们模型：**{our_out}**（主{our['homeWin']:.1%} / 平{our['draw']:.1%} / 客{our['awayWin']:.1%}）")
            lines.append(f"- 外部模型：**{ext['extOutcome']}**（净胜球 {ext['extGoalDiff']:+.2f}）")
            lines.append(f"- 置信度：{our['confidence']} | 爆冷风险：{our['upsetRisk']}")
            lines.append(f"- 驱动因素：{', '.join(our.get('drivers', ['无']))}")
            lines.append("")

    if divergent == 0:
        lines.append("暂无分歧场次。")
        lines.append("")

    lines.append("---")
    lines.append("*仅供统计参考，不构成投注建议。18+。*")

    report_path = SKILL_DIR / "output" / "external-validation-report.md"
    report_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n报告已写入：{report_path}")


if __name__ == "__main__":
    max_calls = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    print(f"开始外部模型校验（最多 {max_calls} 次 API 调用）...")
    print(f"时间：{datetime.now(CST).strftime('%Y-%m-%d %H:%M:%S')} (北京时间)")
    print()
    calls, results = run_validation(max_calls)
    print(f"\n完成：{calls} 次调用，{len(results)} 场新增")

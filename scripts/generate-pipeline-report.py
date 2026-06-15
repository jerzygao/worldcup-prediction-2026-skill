#!/usr/bin/env python3
"""生成世界杯预测完整报告（按 worldcup-report-pipeline 规范）

输出: reports/YYYYMMDD/2026-worldcup-prediction-report.md
"""
import json, os, re
from datetime import datetime

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRED_FILE = os.path.join(BASE, "output", "match-predictions-2026.json")
LOG_FILE = os.path.join(BASE, "output", "prediction-log.json")
POISSON_FILE = os.path.join(BASE, "output", "poisson-crosscheck.json")
JC_SCHEDULE = os.path.join(BASE, "data", "manual", "jingcai-schedule.json")
JC_ODDS = os.path.join(BASE, "data", "jingcai-odds.json")

TODAY = datetime.now().strftime("%Y%m%d")
REPORT_DIR = os.path.join(BASE, f"reports/{TODAY}")
OPENWORK_DIR = os.path.expanduser(f"~/open-workspace/worldcup-prediction/reports/{TODAY}")
os.makedirs(REPORT_DIR, exist_ok=True)
os.makedirs(OPENWORK_DIR, exist_ok=True)
os.makedirs(os.path.join(OPENWORK_DIR, "images"), exist_ok=True)
REPORT = os.path.join(REPORT_DIR, "2026-worldcup-prediction-report.md")

# === 队名映射 ===
EN_TO_CN = {
    "Algeria": "阿尔及利亚","Argentina": "阿根廷","Australia": "澳大利亚","Austria": "奥地利",
    "Belgium": "比利时","Bosnia and Herzegovina": "波黑","Brazil": "巴西","Canada": "加拿大",
    "Cape Verde": "佛得角","Colombia": "哥伦比亚","Croatia": "克罗地亚","Curaçao": "库拉索",
    "Czech Republic": "捷克","DR Congo": "刚果(金)","Ecuador": "厄瓜多尔","Egypt": "埃及",
    "England": "英格兰","France": "法国","Germany": "德国","Ghana": "加纳","Haiti": "海地",
    "Iran": "伊朗","Iraq": "伊拉克","Ivory Coast": "科特迪瓦","Japan": "日本","Jordan": "约旦",
    "Mexico": "墨西哥","Morocco": "摩洛哥","Netherlands": "荷兰","New Zealand": "新西兰",
    "Norway": "挪威","Panama": "巴拿马","Paraguay": "巴拉圭","Portugal": "葡萄牙",
    "Qatar": "卡塔尔","Saudi Arabia": "沙特阿拉伯","Scotland": "苏格兰","Senegal": "塞内加尔",
    "South Africa": "南非","South Korea": "韩国","Spain": "西班牙","Sweden": "瑞典",
    "Switzerland": "瑞士","Tunisia": "突尼斯","Turkey": "土耳其","United States": "美国",
    "Uruguay": "乌拉圭","Uzbekistan": "乌兹别克斯坦",
}
CN_ALIAS = {"刚果金": "刚果(金)", "乌兹别克": "乌兹别克斯坦", "沙特": "沙特阿拉伯"}

def cn_name(en):
    return EN_TO_CN.get(en, en)

def normalize_cn(name):
    return CN_ALIAS.get(name, name)

def fmt_date(date_str):
    return date_str[-5:] if len(date_str) >= 10 else date_str

def date_sort_key(date_str):
    m = re.search(r'(\d{2})-(\d{2})', date_str)
    return (int(m.group(1)), int(m.group(2))) if m else (99,99)

def main():
    with open(PRED_FILE) as f: preds = json.load(f)['predictions']
    with open(LOG_FILE) as f: log = json.load(f)
    with open(JC_SCHEDULE) as f: jc_sched = json.load(f)

    # Load poisson crosscheck
    poisson = {}
    if os.path.exists(POISSON_FILE):
        with open(POISSON_FILE) as f:
            pc = json.load(f)
        # pc might be a dict with 'crosscheck' or 'matches' key, or a list
        match_list = []
        if isinstance(pc, dict):
            match_list = pc.get('crosscheck', pc.get('matches', []))
        elif isinstance(pc, list):
            match_list = pc
        for m in match_list:
            if isinstance(m, dict):
                key = f"{cn_name(m.get('homeTeam',''))}|{cn_name(m.get('awayTeam',''))}"
                poisson[key] = m

    # Build prediction index
    pred_idx = {}
    for p in preds:
        key = f"{cn_name(p['homeTeam'])}|{cn_name(p['awayTeam'])}"
        pred_idx[key] = p

    # Build log index (convert English team names to Chinese for matching with schedule)
    log_idx = {}
    for e in log:
        m = e['match']
        for sep in [' vs ', '|']:
            if sep in m:
                parts = m.split(sep)
                t1, t2 = parts[0].strip(), parts[1].strip()
                # Try both English and Chinese forms
                t1c, t2c = cn_name(t1), cn_name(t2)
                for a, b in [(t1, t2), (t2, t1), (t1c, t2c), (t2c, t1c)]:
                    log_idx[f"{a}|{b}"] = e
                break

    lines = []
    lines.append("# 2026 世界杯预测报告")
    lines.append(f"> 生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M')}（北京时间）")
    lines.append(f"> 已完赛场次: {len(log)} 场")
    lines.append("")

    # === 历史预测 ===
    lines.append("## 历史预测")
    lines.append("")
    lines.append("| 日期 | 对阵 | 预测方向 | 预测比分 | 赛果 | 实际 | 方向 | 比分 |")
    lines.append("|:---:|:---|:---:|:---:|:---:|:---:|:---:|:---:|")

    for jc in jc_sched:
        hc = normalize_cn(jc['home'])
        ac = normalize_cn(jc['away'])
        # Find log entry
        le = None
        for k in [f"{hc}|{ac}", f"{ac}|{hc}"]:
            if k in log_idx:
                le = log_idx[k]
                break
        if not le:
            continue

        date = fmt_date(jc['time'])
        od = le.get('our_prediction', {})
        direction = od.get('direction', '?')
        pscore = od.get('predicted_score', '?')
        actual = le.get('actual_outcome', '?')
        ascore = le.get('actual_score', '?')
        v = le.get('verdict', {})
        dir_hit = v.get('our_direction', '?')
        score_hit = v.get('our_score', '—')

        lines.append(f"| {date} | {hc} vs {ac} | {direction} | {pscore} | {actual} | {ascore} | {dir_hit} | {score_hit} |")

    lines.append("")

    # === 未来预测 ===
    lines.append("## 未来预测")
    lines.append("")
    lines.append("| 日期 | 对阵 | 预测方向 | 预测比分 | 值得关注 |")
    lines.append("|:---:|:---|:---:|:---:|:---|")

    for jc in jc_sched:
        hc = normalize_cn(jc['home'])
        ac = normalize_cn(jc['away'])
        # Skip completed
        le = None
        for k in [f"{hc}|{ac}", f"{ac}|{hc}"]:
            if k in log_idx:
                le = log_idx[k]
                break
        if le and le.get('actual_score', '') not in ('', None):
            continue

        # Find prediction
        p = None
        for k in [f"{hc}|{ac}", f"{ac}|{hc}"]:
            if k in pred_idx:
                p = pred_idx[k]
                break
        if not p:
            continue

        date = fmt_date(jc['time'])
        hw, dw, aw = p.get('homeWin',0)*100, p.get('draw',0)*100, p.get('awayWin',0)*100
        best = max([(hw, '主胜'), (dw, '平局'), (aw, '客胜')], key=lambda x: x[0])
        direction = f"{best[1]}（主{hw:.0f}% 平{dw:.0f}% 客{aw:.0f}%）"
        pscore = p.get('predictedScore', '?')
        conf = p.get('confidence', '?')
        upset = p.get('upsetRisk', '?')
        conf_tag = {'high': '🟢高置信', 'medium': '🟡中置信', 'low': '🔴低置信'}.get(conf, conf)

        # Poisson check
        attention = [conf_tag]
        if upset and upset != 'low':
            upset_tag = {'high': '🔴爆冷风险', 'medium': '🟠爆冷风险'}.get(upset, upset)
            attention.append(upset_tag)
        if upset == 'high':
            attention.append('⚠强烈关注')

        pk = f"{hc}|{ac}"
        if pk in poisson:
            pm = poisson[pk]
            pp = pm.get('poissonProb', pm.get('poisson', {}))
            if pp:
                pd = pp.get('draw', 0) if isinstance(pp, dict) else 0
                if pd >= 0.25:
                    attention.append(f"泊松:平{pd*100:.0f}%")

        att_str = " / ".join(attention)
        lines.append(f"| {date} | {hc} vs {ac} | {direction} | {pscore} | {att_str} |")

    lines.append("")

    # === 体彩推荐 ===
    lines.append("## 体彩推荐")
    lines.append("")

    # SPF
    lines.append("### 单场胜平负（SPF）")
    lines.append("")
    lines.append("| 日期 | 对阵 | 推荐 | 概率 | 预测比分 |")
    lines.append("|:---:|:---|:---|:---:|:---:|")

    spf_entries = []
    for jc in jc_sched:
        hc = normalize_cn(jc['home'])
        ac = normalize_cn(jc['away'])
        p = None
        for k in [f"{hc}|{ac}", f"{ac}|{hc}"]:
            if k in pred_idx: p = pred_idx[k]; break
        if not p: continue
        le = None
        for k in [f"{hc}|{ac}", f"{ac}|{hc}"]:
            if k in log_idx: le = log_idx[k]; break
        if le and le.get('actual_score', '') not in ('', None): continue  # skip completed

        hw, dw, aw = p.get('homeWin',0)*100, p.get('draw',0)*100, p.get('awayWin',0)*100
        best_prob = max(hw, dw, aw)
        if best_prob < 50: continue
        best_dir = '主胜' if hw == best_prob else '平局' if dw == best_prob else '客胜'
        d = fmt_date(jc['time'])
        spf_entries.append((d, hc, ac, best_dir, best_prob, p.get('predictedScore','?')))

    spf_entries.sort(key=lambda x: date_sort_key(x[0]))
    for d, hc, ac, ddir, prob, score in spf_entries:
        lines.append(f"| {d} | {hc} vs {ac} | {ddir} | {prob:.1f}% | {score} |")
    lines.append("")

    # RQSPF — get from jingcai handicap data
    if os.path.exists(JC_ODDS):
        with open(JC_ODDS) as f: jc_odds = json.load(f)
        jc_by_code = {m['matchNumStr']: m for m in jc_odds['matches']}

        lines.append("### 让球胜平负（RQSPF）")
        lines.append("")
        lines.append("| 日期 | 对阵 | 让球 | 让球推荐 |")
        lines.append("|:---:|:---|:---|:---|")

        for jc in jc_sched:
            hc = normalize_cn(jc['home']); ac = normalize_cn(jc['away'])
            p = None
            for k in [f"{hc}|{ac}", f"{ac}|{hc}"]:
                if k in pred_idx: p = pred_idx[k]; break
            if not p: continue
            le = None
            for k in [f"{hc}|{ac}", f"{ac}|{hc}"]:
                if k in log_idx: le = log_idx[k]; break
            if le and le.get('actual_score', '') not in ('', None): continue

            hw = p.get('homeWin',0)*100
            jm = jc_by_code.get(jc['code'])
            if not jm: continue
            hh = jm.get('handicap') or {}
            gl = hh.get('goalLine', 0)
            gl_desc = f"让{-gl}球" if gl < 0 else f"受让{gl}球" if gl > 0 else "平手"
            # Recommendation
            ho, do, ao = hh.get('homeOdds',0), hh.get('drawOdds',0), hh.get('awayOdds',0)
            best_odds = min(ho, do, ao) if ho and do and ao else 99
            if best_odds == ho: rec = "让球胜"
            elif best_odds == do: rec = "让球平"
            else: rec = "让球负"

            d = fmt_date(jc['time'])
            lines.append(f"| {d} | {hc} vs {ac} | {gl_desc} | {rec} @{best_odds:.2f} |")
        lines.append("")

    # Score recommendations (top 3 from jingcai)
    lines.append("### 比分推荐")
    lines.append("")
    lines.append("| 日期 | 对阵 | 比分Top3 |")
    lines.append("|:---:|:---|:---|")

    for jc in jc_sched:
        hc = normalize_cn(jc['home']); ac = normalize_cn(jc['away'])
        le = None
        for k in [f"{hc}|{ac}", f"{ac}|{hc}"]:
            if k in log_idx: le = log_idx[k]; break
        if le and le.get('actual_score', '') not in ('', None): continue

        jm = jc_by_code.get(jc['code']) if os.path.exists(JC_ODDS) else None
        if not jm: continue
        scores = jm.get('scores', {})
        top = sorted([(k,v) for k,v in scores.items() if v>0], key=lambda x: x[1])[:3]
        score_str = " / ".join(f"{s}({o:.1f})" for s, o in top)
        d = fmt_date(jc['time'])
        lines.append(f"| {d} | {hc} vs {ac} | {score_str} |")

    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("### 指标说明")
    lines.append("")
    lines.append("- 🟢高置信 / 🟡中置信 / 🔴低置信：模型概率差距")
    lines.append("- 🔴爆冷风险：市场赔率与模型方向存在显著分歧")
    lines.append("- 泊松:平XX%：泊松xG模型给出较高平局概率的分歧信号")

    with open(REPORT, "w") as f:
        f.write("\n".join(lines))
    # Also copy to open-workspace
    openwork_md = os.path.join(OPENWORK_DIR, "2026-worldcup-prediction-report.md")
    with open(openwork_md, "w") as f:
        f.write("\n".join(lines))
    print(f"报告已生成: {REPORT}")
    print(f"同步到: {openwork_md}")
    print(f"共 {len(lines)} 行")

if __name__ == "__main__":
    main()

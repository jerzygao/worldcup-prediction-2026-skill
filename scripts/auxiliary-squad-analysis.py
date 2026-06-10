#!/usr/bin/env python3
"""辅助分析：结合球员数据库 + 位置分析 + 预测结果"""
import json, csv, os
from collections import defaultdict, Counter

BASE = '/Users/gaozhe/.hermes/skills/sports/worldcup-prediction'

with open(f'{BASE}/output/match-predictions-2026.json') as f:
    preds = json.load(f)

with open(f'{BASE}/data/manual/player-database.csv') as f:
    players = list(csv.DictReader(f))

with open(f'{BASE}/data/manual/position-analysis.csv') as f:
    positions = list(csv.DictReader(f))

pos_by_team = {p['team']: p for p in positions}
players_by_team = defaultdict(list)
for pl in players:
    players_by_team[pl['nationality']].append(pl)

lines = []
L = lambda s='': lines.append(s)

L("# 2026 世界杯辅助分析：阵容与位置")
L(f"生成时间：基于 pipeline 预测 + Excel 球员数据库 + 位置分析")
L()

# ============ 1. 位置结构 ============
L("## 1. 球队位置结构分析")
L()
L("| 球队 | GK | DF | MF | FW | GK均身价 | DF均身价 | MF均身价 | FW均身价 | 结构特点 |")
L("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")

# Sort by total value descending
def total_val(p):
    return sum(int(p.get(f'{pos.lower()}AvgValueEur', 0) or 0) for pos in ['GK','DF','MF','FW'])

for p in sorted(positions, key=total_val, reverse=True):
    t = p['team']
    gk, df, mf, fw = int(p['gkCount']), int(p['dfCount']), int(p['mfCount']), int(p['fwCount'])
    notes = []
    if mf < 5: notes.append(f"中场偏薄({mf}人)")
    if df < 7: notes.append(f"防线单薄({df}人)")
    if fw > 8: notes.append(f"锋线堆积({fw}人)")
    if not notes:
        notes.append("结构均衡")
    gk_v = f"{int(p['gkAvgValueEur'] or 0)/1e6:.1f}M"
    df_v = f"{int(p['dfAvgValueEur'] or 0)/1e6:.1f}M"
    mf_v = f"{int(p['mfAvgValueEur'] or 0)/1e6:.1f}M"
    fw_v = f"{int(p['fwAvgValueEur'] or 0)/1e6:.1f}M"
    L(f"| {t} | {gk} | {df} | {mf} | {fw} | {gk_v} | {df_v} | {mf_v} | {fw_v} | {'; '.join(notes)} |")

L()

# ============ 2. Top 8 争冠集团 ============
L("## 2. 争冠集团位置深度对比")
L()
top8 = ['Spain', 'Argentina', 'France', 'England', 'Brazil', 'Portugal', 'Netherlands', 'Colombia']
L("| 球队 | 最贵位置 | 最弱位置 | 身价集中位置 | 最贵球员 |")
L("| --- | --- | --- | --- | --- |")
for t in top8:
    p = pos_by_team.get(t)
    if not p:
        continue
    vals = {pos: int(p[f'{pos.lower()}AvgValueEur'] or 0) for pos in ['GK','DF','MF','FW']}
    best = max(vals, key=vals.get)
    worst = min(vals, key=vals.get)
    counts_vals = {pos: int(p[f'{pos.lower()}Count']) * vals[pos] for pos in ['GK','DF','MF','FW']}
    conc = max(counts_vals, key=counts_vals.get)
    t_players = players_by_team.get(t, [])
    top_p = max(t_players, key=lambda x: int(x['marketValueEur']) if x['marketValueEur'] else 0) if t_players else None
    top_name = top_p['playerName'] if top_p else '-'
    top_val = f"{int(top_p['marketValueEur'])/1e6:.0f}M" if top_p and top_p['marketValueEur'] else '-'
    L(f"| {t} | {best} | {worst} | {conc} | {top_name}({top_val}) |")
L()

# ============ 3. 关键战位置对位 ============
L("## 3. 关键小组赛位置对位分析")
L()
key_matches = [
    ('Brazil', 'Morocco', 'C组', '6月14日'),
    ('France', 'Senegal', 'I组', '6月12日'),
    ('Spain', 'Uruguay', 'H组', '6月15日'),
    ('Netherlands', 'Japan', 'F组', '6月13日'),
    ('Mexico', 'South Korea', 'A组', '6月17日'),
]
for h, a, grp, date in key_matches:
    hp, ap = pos_by_team.get(h), pos_by_team.get(a)
    if not hp or not ap:
        continue
    L(f"### {h} vs {a}（{grp} · {date}）")
    L()
    L("| 位置 | 主队人数 | 主队均身价 | 客队人数 | 客队均身价 | 对比 |")
    L("| --- | --- | --- | --- | --- | --- |")
    for pos_name in ['GK', 'DF', 'MF', 'FW']:
        h_count = hp[f'{pos_name.lower()}Count']
        a_count = ap[f'{pos_name.lower()}Count']
        h_v = int(hp[f'{pos_name.lower()}AvgValueEur'] or 0)
        a_v = int(ap[f'{pos_name.lower()}AvgValueEur'] or 0)
        h_v_s = f"{h_v/1e6:.1f}M"
        a_v_s = f"{a_v/1e6:.1f}M"
        if h_v > a_v * 1.5:
            arrow = "&#x1f7e2; 明显占优"
        elif a_v > h_v * 1.5:
            arrow = "&#x1f534; 明显劣势"
        elif abs(h_v - a_v) < 1000000:
            arrow = "&#x2192; 持平"
        else:
            arrow = f"+{(h_v-a_v)/1e6:+.1f}M"
        L(f"| {pos_name} | {h_count} | {h_v_s} | {a_count} | {a_v_s} | {arrow} |")
    L()

# ============ 4. 年龄结构 ============
L("## 4. 阵容年龄结构分析")
L()
team_ages = {}
for t, plist in players_by_team.items():
    ages = [int(p['age']) for p in plist if p['age'] and p['age'].isdigit()]
    if ages:
        team_ages[t] = sum(ages) / len(ages)
oldest = sorted(team_ages.items(), key=lambda x: -x[1])[:5]
youngest = sorted(team_ages.items(), key=lambda x: x[1])[:5]
L("**最年长球队（Top 5）：**")
for t, a in oldest:
    L(f"- {t}：{a:.1f}岁")
L()
L("**最年轻球队（Top 5）：**")
for t, a in youngest:
    L(f"- {t}：{a:.1f}岁")
L()

# ============ 5. 联赛来源 ============
L("## 5. 联赛来源分布")
L()
league_counts = Counter(p['league'] for p in players)
top5 = ['英超', '西甲', '德甲', '意甲', '法甲']
top5_total = sum(league_counts.get(l, 0) for l in top5)
total_players = len(players)
L(f"**Top 5 联赛球员：** {top5_total} 人（占总球员 {top5_total/total_players*100:.1f}%）")
L()
L("| 联赛 | 球员数 | 占比 |")
L("| --- | --- | --- |")
for l, c in league_counts.most_common(15):
    L(f"| {l} | {c} | {c/total_players*100:.1f}% |")
L()

# ============ 6. 身价集中度 ============
L("## 6. 身价集中度分析")
L()
L("| 球队 | 总身价 | 最高身价球员 | 占比 | 判断 |")
L("| --- | --- | --- | --- | --- |")
for t, plist in sorted(players_by_team.items(), key=lambda x: -sum(int(p['marketValueEur']) for p in x[1] if p['marketValueEur'])):
    vals_p = [int(p['marketValueEur']) for p in plist if p['marketValueEur']]
    total_v = sum(vals_p)
    if total_v == 0:
        continue
    top_p = max(plist, key=lambda x: int(x['marketValueEur']) if x['marketValueEur'] else 0)
    top_v = int(top_p['marketValueEur'])
    ratio = top_v / total_v * 100
    label = "\u26a0\ufe0f 严重依赖" if ratio > 25 else ("\u26a1 较集中" if ratio > 15 else "\u2713 分散")
    L(f"| {t} | {total_v/1e6:.0f}M | {top_p['playerName']}({top_v/1e6:.0f}M) | {ratio:.0f}% | {label} |")

L()
L("---")
L("*数据来源：Excel 球员数据库 + 位置分析 | 非模型输入，仅用于辅助解读*")

out_path = f'{BASE}/output/squad-auxiliary-analysis.md'
with open(out_path, 'w') as f:
    f.write('\n'.join(lines))
print(f"Written to {out_path}")
print(f"Total lines: {len(lines)}")

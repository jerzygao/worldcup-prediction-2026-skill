#!/usr/bin/env python3
"""逻辑回归重拟合脚本：在历史数据上优化 calibrated-model.json 的 12 个参数"""
import csv, json, math
from collections import Counter
import numpy as np
from scipy.optimize import minimize
from datetime import date
import os, sys

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def load_rows(path):
    rows = []
    with open(path) as f:
        for r in csv.DictReader(f):
            if r['actual'] not in ('H', 'D', 'A'):
                continue
            if not r.get('tendencyWinRateDiff') or r['tendencyWinRateDiff'] == '':
                continue
            if not r.get('fifaPointsDiff') or r['fifaPointsDiff'] == '':
                continue
            rows.append(r)
    return rows

def softmax(logits):
    max_val = np.max(logits)
    exps = np.exp(logits - max_val)
    return exps / exps.sum()

def predict(params, x):
    eloCoef, fifaCoef, formCoef, winTendCoef, gdTendCoef, homeCoef = params[:6]
    drawBias, drawEloPen, drawFifaPen, drawFormPen, drawTendCoef, drawNeutBoost = params[6:12]

    strength = (eloCoef * x['elo'] + fifaCoef * x['fifa'] + formCoef * x['form'] +
                winTendCoef * x['win_tend'] + gdTendCoef * x['gd_tend'] + homeCoef * x['home_adv'])

    draw_logit = (drawBias
                  - drawEloPen * abs(x['elo'])
                  - drawFifaPen * abs(x['fifa'])
                  - drawFormPen * abs(x['form'])
                  + drawTendCoef * x['draw_tend']
                  + drawNeutBoost * x['home_adv'])

    return softmax(np.array([strength, draw_logit, -strength]))

def neg_log_likelihood(params, X, y, reg=0.001):
    loss = 0
    for i, x in enumerate(X):
        probs = predict(params, x)
        loss += -math.log(max(probs[y[i]], 1e-12))
    loss_reg = reg * sum(p**2 for p in params)
    return (loss / len(X)) + loss_reg

def compute_metrics(params, X, y):
    nll = 0; brier = 0; correct = 0
    draw_pred, draw_actual_p = [], []
    calib = {'H': [], 'D': [], 'A': []}

    for i, x in enumerate(X):
        probs = predict(params, x)
        nll += -math.log(max(probs[y[i]], 1e-12))
        targets = [1 if y[i]==j else 0 for j in range(3)]
        brier += sum((probs[j] - targets[j])**2 for j in range(3))
        if np.argmax(probs) == y[i]:
            correct += 1
        draw_pred.append(probs[1])
        calib[{0:'H',1:'D',2:'A'}[y[i]]].append(probs[{0:0,1:1,2:2}[y[i]]])
        if y[i] == 1:
            draw_actual_p.append(probs[1])

    n = len(X)
    actual = Counter([{0:'H',1:'D',2:'A'}[y] for y in y])
    return {
        'log_loss': round(nll/n, 6),
        'brier': round(brier/n, 6),
        'accuracy': round(correct/n, 6),
        'draw_mean_pred': round(float(np.mean(draw_pred))*100, 2),
        'draw_actual_pred': round(float(np.mean(draw_actual_p))*100, 2) if draw_actual_p else 0,
        'actual_h_pct': round(actual.get('H',0)/n*100, 1),
        'actual_d_pct': round(actual.get('D',0)/n*100, 1),
        'actual_a_pct': round(actual.get('A',0)/n*100, 1),
    }

def main():
    rows = load_rows(f'{SKILL_DIR}/data/processed/match-features-tendency.csv')
    print(f"总可用行: {len(rows)}")

    train_cutoff = date(2022, 1, 1)
    val_cutoff = date(2026, 4, 1)

    train_rows = [r for r in rows if date.fromisoformat(r['date'][:10]) < train_cutoff
                  and date.fromisoformat(r['date'][:10]) >= date(1994, 1, 1)]
    val_rows = [r for r in rows if date.fromisoformat(r['date'][:10]) >= train_cutoff
                and date.fromisoformat(r['date'][:10]) < val_cutoff]

    print(f"训练: {len(train_rows)}  验证: {len(val_rows)}")

    # 提取特征
    def extract(rows):
        X, y = [], []
        for r in rows:
            X.append({
                'elo': float(r['eloDiff'])/100,
                'fifa': float(r['fifaPointsDiff'])/100,
                'form': float(r['recentFormDiff']),
                'win_tend': float(r['tendencyWinRateDiff']),
                'gd_tend': float(r['tendencyGoalDiffDiff']),
                'draw_tend': float(r['tendencyDrawRateAvg']),
                'home_adv': 1 if r['neutral'].upper() == 'FALSE' else 0
            })
            y.append({'H':0,'D':1,'A':2}[r['actual']])
        return X, y

    X_train, y_train = extract(train_rows)
    X_val, y_val = extract(val_rows)

    # 初始参数 (v2 hotfix)
    init_params = [
        0.315051, 0.035, -0.005, -0.949043, 0.139084, 0.341845,
        -0.03, 0.025, 0.0, 0.0, 1.413384, 0.0039
    ]

    bounds = [
        (0.0, 1.0), (-0.5, 0.5), (-0.5, 0.5),
        (-2.0, 0.5), (-0.5, 1.0), (0.0, 0.6),
        (-0.3, 0.1), (0.0, 0.15), (0.0, 0.1), (0.0, 0.2),
        (0.0, 2.5), (-0.2, 0.2)
    ]

    print(f"初始化—— train nll={neg_log_likelihood(init_params, X_train, y_train):.6f}  val nll={neg_log_likelihood(init_params, X_val, y_val):.6f}")
    print("优化中...")

    result = minimize(
        neg_log_likelihood, init_params, args=(X_train, y_train),
        method='L-BFGS-B', bounds=bounds,
        options={'maxiter': 500, 'ftol': 1e-8}
    )

    opt = result.x
    val_nll_opt = neg_log_likelihood(opt, X_val, y_val)
    train_nll_opt = neg_log_likelihood(opt, X_train, y_train)
    print(f"优化后—— train nll={train_nll_opt:.6f}  val nll={val_nll_opt:.6f}")

    # 验证集指标
    m_init = compute_metrics(init_params, X_val, y_val)
    m_opt = compute_metrics(opt, X_val, y_val)

    param_names = [
        'eloCoef', 'fifaCoef', 'formCoef', 'winTendencyCoef', 'gdTendencyCoef', 'homeCoef',
        'drawBias', 'drawEloPenalty', 'drawFifaPenalty', 'drawFormPenalty', 'drawTendencyCoef', 'drawNeutralBoost'
    ]

    print(f"\n{'='*60}")
    print(f"验证集 ({len(val_rows)}场)")
    print(f"  实际分布: 主{m_init['actual_h_pct']}% 平{m_init['actual_d_pct']}% 客{m_init['actual_a_pct']}%")
    print(f"  {'':>14s}  {'init':>10s}  {'opt':>10s}")
    print(f"  {'Log Loss':>14s}  {m_init['log_loss']:>10.6f}  {m_opt['log_loss']:>10.6f}")
    print(f"  {'Brier':>14s}  {m_init['brier']:>10.6f}  {m_opt['brier']:>10.6f}")
    print(f"  {'Accuracy':>14s}  {m_init['accuracy']:>10.4f}  {m_opt['accuracy']:>10.4f}")
    print(f"  {'平局预测均值':>13s}  {m_init['draw_mean_pred']:>9.1f}%  {m_opt['draw_mean_pred']:>9.1f}%")
    print(f"  {'平局实际预测':>13s}  {m_init['draw_actual_pred']:>9.1f}%  {m_opt['draw_actual_pred']:>9.1f}%")

    print(f"\n最优参数 vs 初始:")
    for name, i_val, o_val in zip(param_names, init_params, opt):
        arrow = "↑" if o_val > i_val else "↓" if o_val < i_val else "="
        print(f"  {name:20s}: {i_val:10.6f} → {o_val:10.6f} {arrow}")

    # 保存
    result_json = {
        'version': 'elo-fifa-tendency-recalibrated-2026-06-15',
        'params': {name: round(float(v), 6) for name, v in zip(param_names, opt)},
        'init_params': {name: round(float(v), 6) for name, v in zip(param_names, init_params)},
        'metrics': {
            'train_log_loss': round(float(train_nll_opt), 6),
            'val_log_loss': m_opt['log_loss'],
            'val_brier': m_opt['brier'],
            'val_accuracy': m_opt['accuracy'],
            'val_draw_mean_pred': m_opt['draw_mean_pred'],
            'val_actual_h': m_opt['actual_h_pct'],
            'val_actual_d': m_opt['actual_d_pct'],
            'val_actual_a': m_opt['actual_a_pct'],
            },
            'init_val': m_init,
        'train_size': len(train_rows),
        'val_size': len(val_rows),
    }
    output_path = f'{SKILL_DIR}/output/recalibration-result.json'
    with open(output_path, 'w') as f:
        json.dump(result_json, f, indent=2, ensure_ascii=False)
    print(f"\n已保存: {output_path}")

if __name__ == '__main__':
    main()

#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    input: "data/processed/match-features-tendency.csv",
    currentModel: "config/calibrated-model.json",
    aggressiveResult: "output/xiaomi-weight-optimization-2026-05-20/validation-pool/optimization-result.json",
    outputDir: "output/xiaomi-weight-optimization-2026-05-20/robust-constrained",
    iterations: "120000",
    seed: "202605206"
  };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1] ?? "true";
      i += 1;
    }
  }
  return args;
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function readCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? ""]));
  });
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand) {
  const u = Math.max(rand(), 1e-12);
  const v = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function softmax(logits) {
  const max = Math.max(...logits);
  const exps = logits.map((x) => Math.exp(x - max));
  const total = exps.reduce((sum, x) => sum + x, 0);
  return exps.map((x) => x / total);
}

function predict(row, p) {
  const elo = row.eloDiff / 100;
  const fifa = row.fifaPointsDiff / 100;
  const form = row.recentFormDiff;
  const winTendency = row.tendencyWinRateDiff;
  const gdTendency = row.tendencyGoalDiffDiff;
  const drawTendency = row.tendencyDrawRateAvg - 0.24;
  const homeAdv = row.neutral ? 0 : 1;
  const strength =
    p.eloCoef * elo +
    p.fifaCoef * fifa +
    p.formCoef * form +
    p.winTendencyCoef * winTendency +
    p.gdTendencyCoef * gdTendency +
    p.homeCoef * homeAdv;
  const drawLogit =
    p.drawBias -
    p.drawEloPenalty * Math.abs(elo) -
    p.drawFifaPenalty * Math.abs(fifa) -
    p.drawFormPenalty * Math.abs(form) +
    p.drawTendencyCoef * drawTendency +
    p.drawNeutralBoost * (row.neutral ? 1 : 0);
  const [homeWin, draw, awayWin] = softmax([strength, drawLogit, -strength]);
  return { H: homeWin, D: draw, A: awayWin };
}

function score(rows, p) {
  let loss = 0;
  let brier = 0;
  let correct = 0;
  const cal = { count: rows.length, homeRate: 0, drawRate: 0, awayRate: 0, avgHomeProb: 0, avgDrawProb: 0, avgAwayProb: 0 };
  for (const row of rows) {
    const probs = predict(row, p);
    loss -= Math.log(Math.max(1e-12, probs[row.actual]));
    brier += ["H", "D", "A"].reduce((sum, key) => sum + (probs[key] - (row.actual === key ? 1 : 0)) ** 2, 0);
    if (Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0] === row.actual) correct += 1;
    cal.homeRate += row.actual === "H" ? 1 : 0;
    cal.drawRate += row.actual === "D" ? 1 : 0;
    cal.awayRate += row.actual === "A" ? 1 : 0;
    cal.avgHomeProb += probs.H;
    cal.avgDrawProb += probs.D;
    cal.avgAwayProb += probs.A;
  }
  for (const key of Object.keys(cal)) if (key !== "count") cal[key] = Number((cal[key] / rows.length).toFixed(4));
  return {
    n: rows.length,
    logLoss: loss / rows.length,
    brier: brier / rows.length,
    accuracy: correct / rows.length,
    cal
  };
}

function roundObj(obj) {
  return Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, typeof value === "number" ? Number(value.toFixed(6)) : value]));
}

function clamp(key, value) {
  const bounds = {
    eloCoef: [0.22, 0.4],
    fifaCoef: [-0.01, 0.035],
    formCoef: [-0.005, 0.04],
    winTendencyCoef: [-0.95, -0.35],
    gdTendencyCoef: [0.06, 0.18],
    homeCoef: [0.3, 0.46],
    drawBias: [-0.15, -0.02],
    drawEloPenalty: [0.045, 0.12],
    drawFifaPenalty: [0, 0.02],
    drawFormPenalty: [0, 0.12],
    drawTendencyCoef: [0.9, 1.65],
    drawNeutralBoost: [-0.08, 0.03]
  };
  const [min, max] = bounds[key] ?? [-Infinity, Infinity];
  return Math.max(min, Math.min(max, value));
}

function mutate(base, rand, scale) {
  const steps = {
    eloCoef: 0.014,
    fifaCoef: 0.004,
    formCoef: 0.008,
    winTendencyCoef: 0.07,
    gdTendencyCoef: 0.015,
    homeCoef: 0.018,
    drawBias: 0.02,
    drawEloPenalty: 0.01,
    drawFifaPenalty: 0.003,
    drawFormPenalty: 0.018,
    drawTendencyCoef: 0.09,
    drawNeutralBoost: 0.018
  };
  return Object.fromEntries(Object.entries(base).map(([key, value]) => [key, clamp(key, value + gaussian(rand) * steps[key] * scale)]));
}

function blend(a, b, rand) {
  const ratio = 0.2 + rand() * 0.6;
  return Object.fromEntries(Object.keys(a).map((key) => [key, clamp(key, a[key] * ratio + b[key] * (1 - ratio))]));
}

function objective(metrics, baseline, trainMetrics, trainBaseline, holdoutMetrics, holdoutBaseline) {
  const validationGain = baseline.logLoss - metrics.logLoss;
  const trainDamage = Math.max(0, trainMetrics.logLoss - trainBaseline.logLoss);
  const holdoutDamage = Math.max(0, holdoutMetrics.logLoss - holdoutBaseline.logLoss);
  const drawMiss = Math.abs(metrics.cal.drawRate - metrics.cal.avgDrawProb);
  const homeMiss = Math.abs(metrics.cal.homeRate - metrics.cal.avgHomeProb);
  return -validationGain + trainDamage * 0.7 + holdoutDamage * 0.8 + drawMiss * 0.01 + homeMiss * 0.006;
}

function insertTop(list, item, limit) {
  list.push(item);
  list.sort((a, b) => a.objective - b.objective);
  if (list.length > limit) list.length = limit;
}

const args = parseArgs(process.argv);
const rand = mulberry32(Number(args.seed));
const current = JSON.parse(fs.readFileSync(args.currentModel, "utf8")).params;
const aggressive = JSON.parse(fs.readFileSync(args.aggressiveResult, "utf8")).bestByValidation.params;
const rows = readCsv(args.input)
  .map((row) => ({
    date: row.date,
    neutral: String(row.neutral).toLowerCase() === "true",
    actual: row.actual,
    eloDiff: Number(row.eloDiff),
    fifaPointsDiff: Number(row.fifaPointsDiff),
    recentFormDiff: Number(row.recentFormDiff),
    tendencyWinRateDiff: Number(row.tendencyWinRateDiff),
    tendencyDrawRateAvg: Number(row.tendencyDrawRateAvg),
    tendencyGoalDiffDiff: Number(row.tendencyGoalDiffDiff)
  }))
  .filter((row) => row.date >= "1994-01-01" && ["H", "D", "A"].includes(row.actual) && Object.values(row).every((value) => typeof value !== "number" || Number.isFinite(value)));

const train = rows.filter((row) => row.date <= "2021-12-31");
const validation = rows.filter((row) => row.date > "2021-12-31");
const recent = rows.filter((row) => row.date >= "2023-01-01");
const recent2024 = rows.filter((row) => row.date >= "2024-01-01");
const holdout = rows.filter((row) => row.date >= "2018-01-01" && row.date <= "2019-12-31");
const base = {
  train: score(train, current),
  validation: score(validation, current),
  recent: score(recent, current),
  recent2024: score(recent2024, current),
  holdout: score(holdout, current)
};

const anchors = [
  current,
  aggressive,
  blend(current, aggressive, () => 0.55),
  { ...current, fifaCoef: 0.012, winTendencyCoef: -0.72, gdTendencyCoef: 0.12, homeCoef: 0.35, drawBias: -0.1, drawTendencyCoef: 1.35 },
  { ...current, fifaCoef: 0.02, winTendencyCoef: -0.82, gdTendencyCoef: 0.13, homeCoef: 0.32, drawBias: -0.12, drawEloPenalty: 0.07, drawTendencyCoef: 1.42 }
].map((params) => Object.fromEntries(Object.entries(params).map(([key, value]) => [key, clamp(key, value)])));

const top = [];
for (let i = 0; i < Number(args.iterations); i += 1) {
  const anchor = i < anchors.length ? anchors[i] : anchors[Math.floor(rand() * anchors.length)];
  const seed = top.length && rand() < 0.45 ? blend(top[Math.floor(rand() * Math.min(top.length, 12))].params, anchor, rand) : anchor;
  const params = i < anchors.length ? seed : mutate(seed, rand, i < Number(args.iterations) * 0.45 ? 1.5 : 0.55);
  const metrics = {
    train: score(train, params),
    validation: score(validation, params),
    recent: score(recent, params),
    recent2024: score(recent2024, params),
    holdout: score(holdout, params)
  };
  if (metrics.validation.logLoss >= base.validation.logLoss) continue;
  if (metrics.train.logLoss - base.train.logLoss > 0.0009) continue;
  const item = {
    params,
    objective: objective(metrics.validation, base.validation, metrics.train, base.train, metrics.holdout, base.holdout),
    metrics
  };
  insertTop(top, item, 40);
}

const result = {
  generatedAt: new Date().toISOString(),
  method: "Constrained robustness search. Official model was not overwritten.",
  constraints: {
    validationMustImprove: true,
    maxTrainLogLossDamage: 0.0009
  },
  baseline: Object.fromEntries(Object.entries(base).map(([key, value]) => [key, roundObj(value)])),
  best: top[0]
    ? {
        params: roundObj(top[0].params),
        objective: Number(top[0].objective.toFixed(6)),
        metrics: Object.fromEntries(Object.entries(top[0].metrics).map(([key, value]) => [key, roundObj(value)]))
      }
    : null,
  top: top.slice(0, 12).map((item) => ({
    params: roundObj(item.params),
    objective: Number(item.objective.toFixed(6)),
    metrics: Object.fromEntries(Object.entries(item.metrics).map(([key, value]) => [key, roundObj(value)]))
  }))
};

fs.mkdirSync(args.outputDir, { recursive: true });
fs.writeFileSync(path.join(args.outputDir, "robust-candidate-result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({
  output: path.join(args.outputDir, "robust-candidate-result.json"),
  baselineValidation: result.baseline.validation,
  bestValidation: result.best?.metrics.validation ?? null,
  bestTrain: result.best?.metrics.train ?? null,
  bestParams: result.best?.params ?? null
}, null, 2));

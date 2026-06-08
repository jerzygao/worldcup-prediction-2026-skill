#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    input: "data/processed/match-features-tendency.csv",
    output: "output/fit-elo-fifa-tendency.json",
    iterations: "70000",
    since: "1994-01-01",
    trainUntil: "2021-12-31",
    seed: "43",
    maxFitRows: "6000"
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

function between(rand, min, max) { return min + rand() * (max - min); }

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

function scoreRows(rows, p) {
  const eps = 1e-12;
  let loss = 0, brier = 0, correct = 0;
  const calibration = { count: rows.length, homeRate: 0, drawRate: 0, awayRate: 0, avgHomeProb: 0, avgDrawProb: 0, avgAwayProb: 0 };
  for (const row of rows) {
    const probs = predict(row, p);
    loss -= Math.log(Math.max(eps, probs[row.actual]));
    brier += ["H", "D", "A"].reduce((sum, key) => sum + (probs[key] - (row.actual === key ? 1 : 0)) ** 2, 0);
    const pick = Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0];
    if (pick === row.actual) correct += 1;
    calibration.homeRate += row.actual === "H" ? 1 : 0;
    calibration.drawRate += row.actual === "D" ? 1 : 0;
    calibration.awayRate += row.actual === "A" ? 1 : 0;
    calibration.avgHomeProb += probs.H;
    calibration.avgDrawProb += probs.D;
    calibration.avgAwayProb += probs.A;
  }
  for (const key of Object.keys(calibration)) if (key !== "count") calibration[key] = Number((calibration[key] / rows.length).toFixed(4));
  return { logLoss: loss / rows.length, brierScore: brier / rows.length, accuracy: correct / rows.length, calibration };
}

function ranges() {
  return {
    eloCoef: [0.25, 0.42],
    fifaCoef: [-0.03, 0.04],
    formCoef: [0, 0.08],
    winTendencyCoef: [-0.3, 0.8],
    gdTendencyCoef: [-0.08, 0.16],
    homeCoef: [0.32, 0.55],
    drawBias: [-0.12, 0.12],
    drawEloPenalty: [0.02, 0.13],
    drawFifaPenalty: [0, 0.04],
    drawFormPenalty: [0, 0.25],
    drawTendencyCoef: [-0.4, 1.2],
    drawNeutralBoost: [-0.12, 0.04]
  };
}

function randomParams(rand, r) {
  return Object.fromEntries(Object.entries(r).map(([k, [a, b]]) => [k, between(rand, a, b)]));
}

function narrow(best) {
  const r = {};
  for (const [key, val] of Object.entries(best)) {
    const span = key.includes("Tendency") ? 0.12 : 0.05;
    r[key] = [val - span, val + span];
    if (key.includes("Penalty") || key === "formCoef") r[key][0] = Math.max(0, r[key][0]);
  }
  return r;
}

function roundObj(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, typeof v === "number" ? Number(v.toFixed(6)) : v]));
}

const args = parseArgs(process.argv);
const rand = mulberry32(Number(args.seed));
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
  .filter((row) => row.date >= args.since && ["H", "D", "A"].includes(row.actual) && Object.values(row).every((v) => typeof v !== "number" || Number.isFinite(v)));

const train = rows.filter((row) => row.date <= args.trainUntil);
const validation = rows.filter((row) => row.date > args.trainUntil);
const step = Math.max(1, Math.ceil(train.length / Number(args.maxFitRows)));
const fitTrain = train.filter((_, i) => i % step === 0);
if (!train.length || !validation.length) throw new Error("Train or validation split is empty.");

let best = null;
const top = [];
for (let i = 0; i < Math.floor(Number(args.iterations) * 0.55); i += 1) {
  const params = randomParams(rand, ranges());
  const metrics = scoreRows(fitTrain, params);
  const candidate = { params, fitTrain: metrics };
  if (!best || metrics.logLoss < best.fitTrain.logLoss) best = candidate;
  top.push(candidate);
}
const narrowed = narrow(best.params);
for (let i = 0; i < Math.ceil(Number(args.iterations) * 0.45); i += 1) {
  const params = randomParams(rand, narrowed);
  const metrics = scoreRows(fitTrain, params);
  const candidate = { params, fitTrain: metrics };
  if (!best || metrics.logLoss < best.fitTrain.logLoss) best = candidate;
  top.push(candidate);
}
top.sort((a, b) => a.fitTrain.logLoss - b.fitTrain.logLoss);
const result = {
  generatedAt: new Date().toISOString(),
  input: args.input,
  since: args.since,
  trainUntil: args.trainUntil,
  rows: { total: rows.length, train: train.length, fitTrain: fitTrain.length, validation: validation.length },
  best: {
    params: roundObj(best.params),
    fitTrain: roundObj(scoreRows(fitTrain, best.params)),
    train: roundObj(scoreRows(train, best.params)),
    validation: roundObj(scoreRows(validation, best.params))
  },
  top10: top.slice(0, 10).map((x) => ({ params: roundObj(x.params), fitLogLoss: Number(x.fitTrain.logLoss.toFixed(6)), fitBrier: Number(x.fitTrain.brierScore.toFixed(6)), fitAccuracy: Number(x.fitTrain.accuracy.toFixed(6)) }))
};
fs.mkdirSync(path.dirname(args.output), { recursive: true });
fs.writeFileSync(args.output, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

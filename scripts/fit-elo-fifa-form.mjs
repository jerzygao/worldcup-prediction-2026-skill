#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    input: "data/processed/match-features-fifa.csv",
    output: "output/fit-elo-fifa-form.json",
    iterations: "60000",
    since: "1994-01-01",
    trainUntil: "2021-12-31",
    seed: "42",
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

function between(rand, min, max) {
  return min + rand() * (max - min);
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
  const homeAdv = row.neutral ? 0 : 1;
  const strength = p.eloCoef * elo + p.fifaCoef * fifa + p.formCoef * form + p.homeCoef * homeAdv;
  const drawLogit =
    p.drawBias -
    p.drawEloPenalty * Math.abs(elo) -
    p.drawFifaPenalty * Math.abs(fifa) -
    p.drawFormPenalty * Math.abs(form) +
    p.drawNeutralBoost * (row.neutral ? 1 : 0);
  const [homeWin, draw, awayWin] = softmax([strength, drawLogit, -strength]);
  return { H: homeWin, D: draw, A: awayWin };
}

function scoreRows(rows, p) {
  const eps = 1e-12;
  let loss = 0;
  let brier = 0;
  let correct = 0;
  const calibration = {
    count: rows.length,
    homeRate: 0,
    drawRate: 0,
    awayRate: 0,
    avgHomeProb: 0,
    avgDrawProb: 0,
    avgAwayProb: 0
  };

  for (const row of rows) {
    const probs = predict(row, p);
    loss -= Math.log(Math.max(eps, probs[row.actual]));
    brier += ["H", "D", "A"].reduce((sum, key) => {
      const target = row.actual === key ? 1 : 0;
      return sum + (probs[key] - target) ** 2;
    }, 0);
    const pick = Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0];
    if (pick === row.actual) correct += 1;
    calibration.homeRate += row.actual === "H" ? 1 : 0;
    calibration.drawRate += row.actual === "D" ? 1 : 0;
    calibration.awayRate += row.actual === "A" ? 1 : 0;
    calibration.avgHomeProb += probs.H;
    calibration.avgDrawProb += probs.D;
    calibration.avgAwayProb += probs.A;
  }

  for (const key of Object.keys(calibration)) {
    if (key !== "count") calibration[key] = Number((calibration[key] / rows.length).toFixed(4));
  }

  return {
    logLoss: loss / rows.length,
    brierScore: brier / rows.length,
    accuracy: correct / rows.length,
    calibration
  };
}

function randomParams(rand, ranges) {
  return {
    eloCoef: between(rand, ranges.eloCoef[0], ranges.eloCoef[1]),
    fifaCoef: between(rand, ranges.fifaCoef[0], ranges.fifaCoef[1]),
    formCoef: between(rand, ranges.formCoef[0], ranges.formCoef[1]),
    homeCoef: between(rand, ranges.homeCoef[0], ranges.homeCoef[1]),
    drawBias: between(rand, ranges.drawBias[0], ranges.drawBias[1]),
    drawEloPenalty: between(rand, ranges.drawEloPenalty[0], ranges.drawEloPenalty[1]),
    drawFifaPenalty: between(rand, ranges.drawFifaPenalty[0], ranges.drawFifaPenalty[1]),
    drawFormPenalty: between(rand, ranges.drawFormPenalty[0], ranges.drawFormPenalty[1]),
    drawNeutralBoost: between(rand, ranges.drawNeutralBoost[0], ranges.drawNeutralBoost[1])
  };
}

function defaultRanges() {
  return {
    eloCoef: [0.15, 0.5],
    fifaCoef: [-0.15, 0.35],
    formCoef: [0.0, 0.6],
    homeCoef: [0.25, 0.6],
    drawBias: [-0.2, 0.25],
    drawEloPenalty: [0.0, 0.18],
    drawFifaPenalty: [0.0, 0.16],
    drawFormPenalty: [0.0, 0.5],
    drawNeutralBoost: [-0.18, 0.05]
  };
}

function narrowRanges(best) {
  return {
    eloCoef: [Math.max(0.01, best.eloCoef - 0.06), best.eloCoef + 0.06],
    fifaCoef: [best.fifaCoef - 0.08, best.fifaCoef + 0.08],
    formCoef: [Math.max(0, best.formCoef - 0.08), best.formCoef + 0.08],
    homeCoef: [Math.max(0, best.homeCoef - 0.08), best.homeCoef + 0.08],
    drawBias: [best.drawBias - 0.1, best.drawBias + 0.1],
    drawEloPenalty: [Math.max(0, best.drawEloPenalty - 0.06), best.drawEloPenalty + 0.06],
    drawFifaPenalty: [Math.max(0, best.drawFifaPenalty - 0.06), best.drawFifaPenalty + 0.06],
    drawFormPenalty: [Math.max(0, best.drawFormPenalty - 0.12), best.drawFormPenalty + 0.12],
    drawNeutralBoost: [best.drawNeutralBoost - 0.06, best.drawNeutralBoost + 0.06]
  };
}

function main() {
  const args = parseArgs(process.argv);
  const rand = mulberry32(Number(args.seed));
  const rows = readCsv(args.input)
    .map((row) => ({
      date: row.date,
      neutral: String(row.neutral).toLowerCase() === "true",
      actual: row.actual,
      eloDiff: Number(row.eloDiff),
      recentFormDiff: Number(row.recentFormDiff),
      fifaPointsDiff: Number(row.fifaPointsDiff)
    }))
    .filter((row) =>
      row.date >= args.since &&
      ["H", "D", "A"].includes(row.actual) &&
      Number.isFinite(row.eloDiff) &&
      Number.isFinite(row.recentFormDiff) &&
      Number.isFinite(row.fifaPointsDiff)
    );

  const train = rows.filter((row) => row.date <= args.trainUntil);
  const validation = rows.filter((row) => row.date > args.trainUntil);
  const step = Math.max(1, Math.ceil(train.length / Number(args.maxFitRows)));
  const fitTrain = train.filter((_, index) => index % step === 0);
  if (train.length === 0 || validation.length === 0) throw new Error("Train or validation split is empty.");

  let best = null;
  const top = [];
  const ranges = defaultRanges();
  for (let i = 0; i < Math.floor(Number(args.iterations) * 0.55); i += 1) {
    const params = randomParams(rand, ranges);
    const metrics = scoreRows(fitTrain, params);
    const candidate = { params, fitTrain: metrics };
    if (!best || metrics.logLoss < best.fitTrain.logLoss) best = candidate;
    top.push(candidate);
  }
  const narrowed = narrowRanges(best.params);
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
      params: Object.fromEntries(Object.entries(best.params).map(([k, v]) => [k, Number(v.toFixed(6))])),
      fitTrain: Object.fromEntries(Object.entries(best.fitTrain).map(([k, v]) => [k, typeof v === "number" ? Number(v.toFixed(6)) : v])),
      train: Object.fromEntries(Object.entries(scoreRows(train, best.params)).map(([k, v]) => [k, typeof v === "number" ? Number(v.toFixed(6)) : v])),
      validation: Object.fromEntries(Object.entries(scoreRows(validation, best.params)).map(([k, v]) => [k, typeof v === "number" ? Number(v.toFixed(6)) : v]))
    },
    top10: top.slice(0, 10).map((item) => ({
      params: Object.fromEntries(Object.entries(item.params).map(([k, v]) => [k, Number(v.toFixed(6))])),
      fitLogLoss: Number(item.fitTrain.logLoss.toFixed(6)),
      fitBrier: Number(item.fitTrain.brierScore.toFixed(6)),
      fitAccuracy: Number(item.fitTrain.accuracy.toFixed(6))
    }))
  };
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main();
